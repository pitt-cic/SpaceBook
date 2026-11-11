import json
import os
import traceback
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer

dynamodb = boto3.resource("dynamodb")
lambda_client = boto3.client("lambda")

BOOKINGS_TABLE = os.environ["BOOKINGS_TABLE"]
NOTIFY_FUNCTION_NAME = os.environ["NOTIFY_FUNCTION_NAME"]

bookings_table = dynamodb.Table(BOOKINGS_TABLE)

SLOT_INTERVAL_MINUTES = 15


class ClientError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def handler(event, _context):
    method = event.get("httpMethod")
    resource = event.get("resource")

    try:
        email = get_caller_email(event)
        if method == "GET" and resource == "/api/my-requests":
            return get_my_requests(email)
        if method == "POST" and resource == "/api/requests/{id}/cancel-request":
            return cancel_request(event, email)
        if method == "POST" and resource == "/api/requests/{id}/counter-proposal/accept":
            return accept_counter_proposal(event, email)
        if method == "POST" and resource == "/api/requests/{id}/counter-proposal/decline":
            return decline_counter_proposal(event, email)
        return response(404, {"message": "Not found"})
    except ClientError as exc:
        return response(exc.status_code, {"message": exc.message})
    except Exception:  # noqa: BLE001 — never leak a CORS-less 502 to the browser
        traceback.print_exc()
        return response(500, {"message": "Internal server error"})


def get_caller_email(event):
    """The caller's email is the ownership key for every request (GSI3PK), so
    only a verified one counts. Requestor users are created verified at
    submission time; an email changed afterwards is unverified until the
    owner of that inbox confirms it — and since the pool is case-sensitive,
    an unverified "VICTIM@X.COM" would otherwise lowercase into someone
    else's requests. The REST authorizer passes claims as strings."""
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    email = claims.get("email")
    if not email:
        raise ClientError(401, "Requestor identity not found on token")
    if str(claims.get("email_verified", "")).lower() != "true":
        raise ClientError(403, "Requestor email is not verified")
    return email.strip().lower()


def paginate(operation, **kwargs):
    """Yield every item from a Query across all pages. One call returns at most
    1 MB; stopping at the first page would silently drop the rest."""
    while True:
        result = operation(**kwargs)
        yield from result.get("Items", [])
        if "LastEvaluatedKey" not in result:
            return
        kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]


def requestor_items(email):
    return paginate(
        bookings_table.query,
        IndexName="ByRequestorEmail",
        KeyConditionExpression=Key("GSI3PK").eq(f"REQUESTOR#{email}"),
    )


def get_my_requests(email):
    return response(200, {"requests": list(requestor_items(email))})


def find_owned_item(email, request_id):
    item = next((i for i in requestor_items(email) if i["id"] == request_id), None)
    if not item:
        raise ClientError(404, "Request not found for this account")
    return item


def cancel_request(event, email):
    request_id = event["pathParameters"]["id"]
    item = find_owned_item(email, request_id)
    if item["status"] == "pending_approval":
        # Slot locks are only written at approve time, so a pending request
        # holds nothing staff would need to release — cancel it outright.
        new_status = "cancelled"
    elif item["status"] in ("approved", "counter_proposed"):
        new_status = "cancellation_requested"
    else:
        raise ClientError(409, f"Cannot request cancellation from status {item['status']}")

    try:
        bookings_table.update_item(
            Key={"PK": item["PK"], "SK": item["SK"]},
            UpdateExpression="SET #status = :status, GSI2SK = :gsi2sk, updatedAt = :now",
            ConditionExpression="#status = :expected",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": new_status,
                ":gsi2sk": f"STATUS#{new_status}#DATE#{item['date']}#REQ#{item['id']}",
                ":now": now_iso(),
                ":expected": item["status"],
            },
        )
    except bookings_table.meta.client.exceptions.ConditionalCheckFailedException:
        raise ClientError(409, "This request was just updated by staff. Refresh and try again.")
    return response(200, {"id": request_id, "status": new_status})


def accept_counter_proposal(event, email):
    request_id = event["pathParameters"]["id"]
    item = find_owned_item(email, request_id)
    if item["status"] != "counter_proposed":
        raise ClientError(409, "Request has no pending counter-proposal")
    proposal = item.get("counterProposal")
    if not proposal:
        raise ClientError(409, "Request has no pending counter-proposal")

    new_site = item["site"]
    new_room = proposal.get("room", item["room"])
    new_date = proposal.get("date", item["date"])
    new_start = proposal.get("start", item["start"])
    new_end = proposal.get("end", item["end"])

    new_item = dict(item)
    new_item.update({
        "room": new_room, "date": new_date, "start": new_start, "end": new_end,
        "status": "approved", "updatedAt": now_iso(),
        # The staff member who proposed it gets the calendar invite.
        "approvedBy": item.get("counterProposedBy"),
    })
    new_item.pop("counterProposal", None)
    if calendar_invites_enabled():
        new_item["calendarSequence"] = 0
    new_item.update(build_keys(
        site=new_site, room=new_room, date=new_date, request_id=request_id,
        org=item["org"], email=email, status="approved", series_id=item.get("seriesId"),
    ))

    # The booking item's PK/SK are keyed on room+date (not time), so a
    # time-only counter-proposal (same room, same date — the common case)
    # produces new keys identical to the old ones. DynamoDB forbids a Delete
    # and a Put on the same item in one transaction (ValidationException), so
    # only move (delete old + conditional put new) when the keys actually
    # change; otherwise overwrite the existing item in place.
    keys_changed = new_item["PK"] != item["PK"] or new_item["SK"] != item["SK"]
    if keys_changed:
        transact_items = [
            {
                "Delete": {
                    "TableName": BOOKINGS_TABLE,
                    "Key": {"PK": {"S": item["PK"]}, "SK": {"S": item["SK"]}},
                }
            },
            {
                "Put": {
                    "TableName": BOOKINGS_TABLE,
                    "Item": to_dynamo_item(new_item),
                    "ConditionExpression": "attribute_not_exists(PK)",
                }
            },
        ]
    else:
        # Same key — overwrite in place (no attribute_not_exists condition,
        # since the item necessarily already exists).
        transact_items = [
            {
                "Put": {
                    "TableName": BOOKINGS_TABLE,
                    "Item": to_dynamo_item(new_item),
                }
            },
        ]
    # Locks cover the reserved window: the request's setup/cleanup buffers
    # around the proposal's event time.
    for slot_key in compute_slot_keys(new_room, new_date, *reserved_window(new_item)):
        transact_items.append({
            "Put": {
                "TableName": BOOKINGS_TABLE,
                "Item": {"PK": {"S": f"SITE#{new_site}"}, "SK": {"S": slot_key}, "requestId": {"S": request_id}},
                "ConditionExpression": "attribute_not_exists(PK)",
            }
        })

    dynamodb_client = boto3.client("dynamodb")
    try:
        dynamodb_client.transact_write_items(TransactItems=transact_items)
    except dynamodb_client.exceptions.TransactionCanceledException:
        raise ClientError(409, "That room was just booked for an overlapping time. Refresh and try again.")

    invoke_notify({"type": "approved", "request": new_item})
    invoke_calendar_invite("REQUEST", [new_item])
    return response(200, {"id": request_id, "status": "approved"})


def decline_counter_proposal(event, email):
    request_id = event["pathParameters"]["id"]
    item = find_owned_item(email, request_id)
    if item["status"] != "counter_proposed":
        raise ClientError(409, "Request has no pending counter-proposal")

    bookings_table.update_item(
        Key={"PK": item["PK"], "SK": item["SK"]},
        UpdateExpression="SET #status = :status, GSI2SK = :gsi2sk, updatedAt = :now REMOVE counterProposal",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "cancelled",
            ":gsi2sk": f"STATUS#cancelled#DATE#{item['date']}#REQ#{item['id']}",
            ":now": now_iso(),
        },
    )
    return response(200, {"id": request_id, "status": "cancelled"})


def compute_slot_keys(room_id, date, start, end):
    start_minutes = _to_minutes(start)
    end_minutes = _to_minutes(end)
    keys = []
    t = start_minutes
    while t < end_minutes:
        keys.append(f"SLOT#{room_id}#{date}#{t // 60:02d}{t % 60:02d}")
        t += SLOT_INTERVAL_MINUTES
    return keys


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


def to_dynamo_item(item):
    serializer = TypeSerializer()
    return {k: serializer.serialize(v) for k, v in item.items() if v is not None}


def invoke_notify(payload):
    lambda_client.invoke(
        FunctionName=NOTIFY_FUNCTION_NAME,
        InvocationType="Event",
        Payload=json.dumps(payload, default=json_default).encode("utf-8"),
    )


def calendar_invites_enabled():
    return os.environ.get("CALENDAR_INVITES_ENABLED", "false").lower() == "true"


def invoke_calendar_invite(method, items):
    """Duplicated from requests_staff (no shared layer). Best-effort: logged,
    never raised, so it can't break the accept that triggered it."""
    if not calendar_invites_enabled():
        return
    try:
        lambda_client.invoke(
            FunctionName=NOTIFY_FUNCTION_NAME,
            InvocationType="Event",
            Payload=json.dumps(
                {"type": "calendar_invite", "method": method, "requests": items}, default=json_default,
            ).encode("utf-8"),
        )
    except Exception:  # noqa: BLE001
        traceback.print_exc()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


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
