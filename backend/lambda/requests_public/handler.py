import json
import os
import uuid
from datetime import date as date_cls, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
lambda_client = boto3.client("lambda")
cognito_idp = boto3.client("cognito-idp")

BOOKINGS_TABLE = os.environ["BOOKINGS_TABLE"]
NOTIFY_FUNCTION_NAME = os.environ["NOTIFY_FUNCTION_NAME"]
REQUESTOR_USER_POOL_ID = os.environ["REQUESTOR_USER_POOL_ID"]
SITES_TABLE = os.environ["SITES_TABLE"]
ROOMS_TABLE = os.environ["ROOMS_TABLE"]

bookings_table = dynamodb.Table(BOOKINGS_TABLE)
sites_table = dynamodb.Table(SITES_TABLE)
rooms_table = dynamodb.Table(ROOMS_TABLE)

# Hard cap on any series; a site's own maxOccurrences setting (rooms_admin) can
# only lower it.
MAX_OCCURRENCES = 52
SITE_TZ = ZoneInfo("America/New_York")

REQUIRED_FIELDS = [
    "firstname", "lastname", "email", "org", "title", "activityType",
    "type", "site", "room", "date", "start", "end", "attendance",
]


def handler(event, _context):
    method = event.get("httpMethod")
    resource = event.get("resource")

    try:
        if method == "GET" and resource == "/api/sites/{site}/availability":
            return get_availability(event)
        if method == "POST" and resource == "/api/requests":
            return submit_request(event)
        if method == "GET" and resource == "/api/requests/{id}/status":
            return get_status(event)
        return response(404, {"message": "Not found"})
    except ClientError as exc:
        return response(400, {"message": str(exc)})


class ClientError(Exception):
    pass


def get_availability(event):
    site = event["pathParameters"]["site"]
    params = event.get("queryStringParameters") or {}
    date = params.get("date")
    if not date:
        raise ClientError("date query parameter is required")

    # start/end are the reserved window (setup + event + cleanup) — what the
    # room is actually unavailable for; eventStart/eventEnd are the event's own.
    bookings = [
        {**availability_times(item), "room": item["room"], "id": item["id"]}
        for item in query_site_status_date(site, "approved", date)
    ]
    # Pending requests hold no slot lock, so they're returned separately (the
    # public form shows them as "pending"; staff views read only `bookings`).
    # Room+time only — no id, since these aren't bookings yet.
    pending = [
        {**availability_times(item), "room": item["room"]}
        for item in query_site_status_date(site, "pending_approval", date)
    ]
    return response(200, {"site": site, "date": date, "bookings": bookings, "pending": pending})


def availability_times(item):
    start, end = reserved_window(item)
    return {"start": start, "end": end, "eventStart": item["start"], "eventEnd": item["end"]}


def paginate(operation, **kwargs):
    """Yield every item from a Query across all pages. One call returns at most
    1 MB; stopping at the first page would silently drop the rest."""
    while True:
        result = operation(**kwargs)
        yield from result.get("Items", [])
        if "LastEvaluatedKey" not in result:
            return
        kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]


def query_site_status_date(site, status, date):
    return list(paginate(
        bookings_table.query,
        IndexName="BySiteStatus",
        KeyConditionExpression=Key("GSI2PK").eq(f"SITE#{site}")
        & Key("GSI2SK").begins_with(f"STATUS#{status}#DATE#{date}"),
    ))


def submit_request(event):
    body = json.loads(event.get("body") or "{}")
    missing = [f for f in REQUIRED_FIELDS if not body.get(f)]
    if missing:
        raise ClientError(f"Missing required fields: {', '.join(missing)}")
    if not body.get("facilityRulesAccepted"):
        raise ClientError("facilityRulesAccepted must be true")
    if body.get("minors") in (None, ""):
        raise ClientError("minors selection is required")
    reject_hidden_rooms(body["site"], [body["room"], body.get("altRoom1"), body.get("altRoom2")],
                        attendance=int(body.get("attendance") or 0))

    email = body["email"].strip().lower()
    request_id = f"REQ-{uuid.uuid4().hex[:12].upper()}"
    now = datetime.now(timezone.utc).isoformat()

    item = {
        "id": request_id,
        "site": body["site"],
        "room": body["room"],
        "altRoom1": body.get("altRoom1"),
        "altRoom2": body.get("altRoom2"),
        "date": body["date"],
        "start": body["start"],
        "end": body["end"],
        "org": body["org"],
        "title": body["title"],
        "type": body["type"],
        "activityType": body["activityType"],
        "attendance": int(body["attendance"]),
        "setupTime": body.get("setupTime"),
        "cleanupTime": body.get("cleanupTime"),
        "techNeeds": body.get("techNeeds", []),
        "notes": body.get("notes"),
        "minors": body["minors"],
        "facilityRulesAccepted": True,
        "firstname": body["firstname"],
        "lastname": body["lastname"],
        "email": email,
        "phone": body.get("phone"),
        "status": "pending_approval",
        "submittedAt": now,
        "updatedAt": now,
    }

    recurring = body.get("recurring") or {}
    series_id = None
    occurrence_dates = [body["date"]]
    if recurring.get("enabled"):
        site_max = get_site_max_occurrences(body["site"])
        # Generate one past the site's limit so an over-limit series is
        # detected and rejected rather than silently truncated.
        occurrence_dates = generate_occurrence_dates(
            recurring, limit=site_max + 1 if site_max else MAX_OCCURRENCES,
        )
        if site_max and len(occurrence_dates) > site_max:
            raise ClientError(
                f"This site allows at most {site_max} occurrences for a repeating request"
            )
        series_id = f"SERIES-{uuid.uuid4().hex[:10].upper()}"
    if past_start_dates(occurrence_dates, body["start"]):
        raise ClientError("That start time has already passed. Please choose a later time or date.")

    put_items = []
    occurrence_ids = []
    for occ_date in occurrence_dates:
        occ_id = request_id if occ_date == body["date"] else f"REQ-{uuid.uuid4().hex[:12].upper()}"
        occurrence_ids.append(occ_id)
        occ_item = dict(item)
        occ_item["id"] = occ_id
        occ_item["date"] = occ_date
        if series_id:
            occ_item["seriesId"] = series_id
        occ_item.update(build_keys(
            site=occ_item["site"], room=occ_item["room"], date=occ_date,
            request_id=occ_id, org=occ_item["org"], email=email,
            status=occ_item["status"], series_id=series_id,
        ))
        put_items.append(occ_item)

    if series_id:
        put_items.append({
            "PK": f"SITE#{body['site']}",
            "SK": f"SERIES#{series_id}",
            "seriesId": series_id,
            "pattern": recurring.get("pattern"),
            "days": recurring.get("days", []),
            "seriesStart": body["date"],
            "endMode": recurring.get("endMode"),
            "endVal": recurring.get("endVal"),
            "requestIds": occurrence_ids,
        })

    with bookings_table.batch_writer() as batch:
        for put_item in put_items:
            batch.put_item(Item=put_item)

    provision_requestor_user(email, body["firstname"], body["lastname"])

    invoke_notify({"type": "submitted", "request": item})

    return response(201, {"id": request_id, "seriesId": series_id, "occurrences": occurrence_ids})


def get_status(event):
    request_id = event["pathParameters"]["id"]
    params = event.get("queryStringParameters") or {}
    email = (params.get("email") or "").strip().lower()
    if not email:
        raise ClientError("email query parameter is required")

    items = paginate(
        bookings_table.query,
        IndexName="ByRequestorEmail",
        KeyConditionExpression=Key("GSI3PK").eq(f"REQUESTOR#{email}"),
    )
    match = next((i for i in items if i["id"] == request_id), None)
    if not match:
        return response(404, {"message": "Request not found for that id/email combination"})
    return response(200, public_view(match))


def reject_hidden_rooms(site, room_ids, attendance=0):
    """Hidden rooms are staff-only; also enforces that attendance ≤ room capacity."""
    for room_id in filter(None, room_ids):
        item = rooms_table.get_item(Key={"PK": f"SITE#{site}", "SK": f"ROOM#{room_id}"}).get("Item")
        if not item:
            continue
        if item.get("hidden"):
            raise ClientError("That room can only be booked by staff. Please choose another room.")
        capacity = int(item.get("capacity") or 0)
        if capacity > 0 and attendance > capacity:
            name = item.get("name", room_id)
            raise ClientError(
                f"{name} has a capacity of {capacity}. "
                f"Your group of {attendance} exceeds it — please choose a larger room or reduce attendance."
            )


def local_now():
    """Wall-clock time at the sites (all in Pittsburgh), naive to compare with request date/start."""
    return datetime.now(SITE_TZ).replace(tzinfo=None)


def past_start_dates(dates, start):
    now = local_now()
    try:
        return [d for d in dates if datetime.fromisoformat(f"{d}T{start}") < now]
    except ValueError:
        raise ClientError("Invalid date or start time")


def get_site_max_occurrences(site):
    item = sites_table.get_item(Key={"PK": f"SITE#{site}", "SK": "CONFIG"}).get("Item") or {}
    value = item.get("maxOccurrences")
    return int(value) if value is not None else None


def generate_occurrence_dates(recurring, limit=MAX_OCCURRENCES):
    pattern = recurring.get("pattern", "weekly")
    interval_days = {"weekly": 7, "biweekly": 14, "monthly": 30}.get(pattern, 7)
    start = date_cls.fromisoformat(recurring["seriesStart"])
    end_mode = recurring.get("endMode", "count")
    if end_mode == "count":
        count = min(int(recurring.get("endVal", 1)), limit)
        return [(start + timedelta(days=i * interval_days)).isoformat() for i in range(count)]
    end_date = date_cls.fromisoformat(recurring["endVal"])
    dates = []
    current = start
    while current <= end_date and len(dates) < limit:
        dates.append(current.isoformat())
        current += timedelta(days=interval_days)
    return dates


def provision_requestor_user(email, firstname, lastname):
    try:
        cognito_idp.admin_create_user(
            UserPoolId=REQUESTOR_USER_POOL_ID,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "given_name", "Value": firstname},
                {"Name": "family_name", "Value": lastname},
            ],
            MessageAction="SUPPRESS",
            DesiredDeliveryMediums=[],
        )
    except cognito_idp.exceptions.UsernameExistsException:
        pass


def invoke_notify(payload):
    lambda_client.invoke(
        FunctionName=NOTIFY_FUNCTION_NAME,
        InvocationType="Event",
        Payload=json.dumps(payload, default=json_default).encode("utf-8"),
    )


def build_keys(site, room, date, request_id, org, email, status, series_id=None):
    keys = {
        "PK": f"SITE#{site}",
        "SK": f"ROOM#{room}#DATE#{date}#REQ#{request_id}",
        "GSI1PK": f"ORG#{org}",
        "GSI1SK": f"DATE#{date}#REQ#{request_id}",
        "GSI2PK": f"SITE#{site}",
        "GSI2SK": f"STATUS#{status}#DATE#{date}#REQ#{request_id}",
        "GSI3PK": f"REQUESTOR#{email.lower()}",
        "GSI3SK": f"DATE#{date}#REQ#{request_id}",
    }
    if series_id:
        keys["GSI4PK"] = f"SERIES#{series_id}"
        keys["GSI4SK"] = f"DATE#{date}#REQ#{request_id}"
    return keys


def public_view(item):
    return {
        "id": item["id"],
        "site": item["site"],
        "room": item["room"],
        "date": item["date"],
        "start": item["start"],
        "end": item["end"],
        "title": item["title"],
        "status": item["status"],
        "denyReason": item.get("denyReason"),
        "counterProposal": item.get("counterProposal"),
    }


def _to_minutes(hhmm):
    hh, mm = hhmm.split(":")
    return int(hh) * 60 + int(mm)


def buffer_minutes(value):
    """Setup/cleanup option ("15 min", "1 hour", None) → minutes."""
    parts = str(value or "").split()
    if not parts or not parts[0].isdigit():
        return 0
    return int(parts[0]) * (60 if parts[1:2] == ["hour"] else 1)


def reserved_window(item):
    """The time the room is actually held: setupTime before the event's start
    through cleanupTime after its end. The item's start/end stay the event's
    own times; slot locks, conflict checks, and availability all use this."""
    start = max(0, _to_minutes(item["start"]) - buffer_minutes(item.get("setupTime")))
    end = min(24 * 60, _to_minutes(item["end"]) + buffer_minutes(item.get("cleanupTime")))
    return f"{start // 60:02d}:{start % 60:02d}", f"{end // 60:02d}:{end % 60:02d}"


def json_default(value):
    """json.dumps fallback. DynamoDB returns every number as Decimal; send it as
    a JSON number (the frontend's types expect numbers — as strings, "30" < "4"
    compares as text), and anything else (e.g. datetimes) as a string."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return str(value)


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
        },
        "body": json.dumps(body, default=json_default),
    }
