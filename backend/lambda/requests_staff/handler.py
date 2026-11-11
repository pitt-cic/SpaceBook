import json
import os
import traceback
import uuid
from datetime import date as date_cls, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer

dynamodb = boto3.resource("dynamodb")
dynamodb_client = boto3.client("dynamodb")
lambda_client = boto3.client("lambda")

BOOKINGS_TABLE = os.environ["BOOKINGS_TABLE"]
ROOMS_TABLE = os.environ["ROOMS_TABLE"]
SITES_TABLE = os.environ["SITES_TABLE"]
ROOMS_TABLE = os.environ["ROOMS_TABLE"]
NOTIFY_FUNCTION_NAME = os.environ["NOTIFY_FUNCTION_NAME"]

bookings_table = dynamodb.Table(BOOKINGS_TABLE)
rooms_table = dynamodb.Table(ROOMS_TABLE)
sites_table = dynamodb.Table(SITES_TABLE)
rooms_table = dynamodb.Table(ROOMS_TABLE)
SLOT_INTERVAL_MINUTES = 15
# Same series hard cap as requests_public. A site's maxOccurrences limit is a
# public-request rule and doesn't apply to staff-created bookings.
MAX_OCCURRENCES = 52
SITE_TZ = ZoneInfo("America/New_York")
BOOKING_REQUIRED_FIELDS = [
    "firstname", "lastname", "email", "org", "title", "activityType",
    "type", "room", "date", "start", "end", "attendance",
]
serializer = TypeSerializer()


class ClientError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def handler(event, _context):
    method = event.get("httpMethod")
    resource = event.get("resource")

    try:
        groups = get_groups(event)
        if method == "GET" and resource == "/api/sites/{site}/requests":
            return list_site_requests(event, groups)
        if method == "POST" and resource == "/api/sites/{site}/requests":
            return create_booking(event, groups)
        if method == "GET" and resource == "/api/requests/{id}":
            return get_request(event, groups)
        if method == "POST" and resource == "/api/requests/{id}/approve":
            return approve_request(event, groups)
        if method == "POST" and resource == "/api/requests/{id}/deny":
            return deny_request(event, groups)
        if method == "POST" and resource == "/api/requests/{id}/modify":
            return modify_request(event, groups)
        if method == "POST" and resource == "/api/requests/{id}/confirm-cancellation":
            return confirm_cancellation(event, groups)
        if method == "POST" and resource == "/api/requests/{id}/reject-cancellation":
            return reject_cancellation(event, groups)
        if method == "POST" and resource == "/api/requests/{id}/resend-invite":
            return resend_invite(event, groups)
        if method == "POST" and resource == "/api/requests/{id}/checkin":
            return checkin_request(event, groups)
        if method == "POST" and resource == "/api/requests/{id}/no-show":
            return no_show_request(event, groups)
        if method == "POST" and resource == "/api/requests/{id}/undo-checkin":
            return undo_checkin_request(event, groups)
        if method == "GET" and resource == "/api/admin/sites":
            return sites_summary(groups)
        return response(404, {"message": "Not found"})
    except ClientError as exc:
        return response(exc.status_code, {"message": exc.message})


def get_groups(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    raw = claims.get("cognito:groups", "")
    return [g for g in raw.replace(",", " ").split() if g]


def caller_email(event):
    """The staff caller's email (ID-token claim), or None. Recorded as
    approvedBy / counterProposedBy so that person gets the calendar invite."""
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    return claims.get("email")


def caller_identity(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    return claims.get("email") or claims.get("sub") or "unknown"


def has_staff_access(groups, site):
    return "admin" in groups or f"staff-{site}" in groups


def require_site_access(groups, site, checkin_ok=False):
    """admin and staff-<site> may do everything at a site. With checkin_ok,
    checkin-<site> also passes: front-desk accounts that can see the day's
    approved bookings and record arrivals, but not manage requests."""
    if has_staff_access(groups, site):
        return
    if checkin_ok and f"checkin-{site}" in groups:
        return
    raise ClientError(403, f"Not authorized for site {site}")


def paginate(operation, **kwargs):
    """Yield every item from a Query/Scan across all pages. One call returns at
    most 1 MB, which a site's booking history outgrows; stopping at the first
    page would silently drop the rest."""
    while True:
        result = operation(**kwargs)
        yield from result.get("Items", [])
        if "LastEvaluatedKey" not in result:
            return
        kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]


def get_all_active_site_ids():
    """Query the Sites table for all active sites."""
    items = paginate(
        sites_table.scan,
        FilterExpression="active = :active OR attribute_not_exists(active)",
        ExpressionAttributeValues={":active": True},
    )
    return [item["id"] for item in items]


def caller_sites(groups, checkin_ok=False):
    if "admin" in groups:
        return get_all_active_site_ids()
    prefixes = ("staff-", "checkin-") if checkin_ok else ("staff-",)
    return sorted({g.split("-", 1)[1] for g in groups if g.startswith(prefixes)})


def list_site_requests(event, groups):
    site = event["pathParameters"]["site"]
    require_site_access(groups, site, checkin_ok=True)
    params = dict(event.get("queryStringParameters") or {})
    if not has_staff_access(groups, site):
        # Check-in-only accounts see approved bookings, never the request queue.
        if params.get("status", "approved") != "approved":
            raise ClientError(403, f"Not authorized for site {site}")
        params["status"] = "approved"

    key_condition = Key("GSI2PK").eq(f"SITE#{site}")
    if params.get("status"):
        key_condition &= Key("GSI2SK").begins_with(f"STATUS#{params['status']}#")
    items = list(paginate(bookings_table.query, IndexName="BySiteStatus", KeyConditionExpression=key_condition))
    if params.get("room"):
        items = [i for i in items if i.get("room") == params["room"]]
    if params.get("type"):
        items = [i for i in items if i.get("type") == params["type"]]
    if params.get("date"):
        items = [i for i in items if i.get("date") == params["date"]]
    return response(200, {"requests": items})


def create_booking(event, groups):
    """Staff-created booking (the staff shell's New Booking page). Same fields
    as a public request (requests_public.submit_request), but it's approved on
    creation, so every occurrence takes its slot locks now. Hidden rooms are
    bookable here; requests_public rejects them.

    Each occurrence is its own transaction (one occurrence is at most ~97
    items, a whole series would blow the 100-item limit). Every occurrence is
    checked for conflicts up front; if one still loses a race mid-series,
    the occurrences already written are rolled back so the series is
    all-or-nothing."""
    site = event["pathParameters"]["site"]
    require_site_access(groups, site)
    body = json.loads(event.get("body") or "{}")
    missing = [f for f in BOOKING_REQUIRED_FIELDS if not body.get(f)]
    if missing:
        raise ClientError(400, f"Missing required fields: {', '.join(missing)}")
    if _to_minutes(body["end"]) <= _to_minutes(body["start"]):
        raise ClientError(400, "End time must be after start time")

    email = body["email"].strip().lower()
    now = now_iso()
    base = {
        "site": site,
        "room": body["room"],
        "altRoom1": body.get("altRoom1"),
        "altRoom2": body.get("altRoom2"),
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
        "minors": body.get("minors") or "no",
        "facilityRulesAccepted": bool(body.get("facilityRulesAccepted")),
        "firstname": body["firstname"],
        "lastname": body["lastname"],
        "email": email,
        "phone": body.get("phone"),
        "status": "approved",
        "bookedBy": caller_identity(event),
        "approvedBy": caller_email(event),
        "submittedAt": now,
        "updatedAt": now,
    }
    if calendar_invites_enabled():
        base["calendarSequence"] = 0

    recurring = body.get("recurring") or {}
    series_id = None
    occurrence_dates = [body["date"]]
    if recurring.get("enabled"):
        occurrence_dates = generate_occurrence_dates(recurring)
        series_id = f"SERIES-{uuid.uuid4().hex[:10].upper()}"
    if past_start_dates(occurrence_dates, body["start"]):
        raise ClientError(400, "That start time has already passed. Please choose a later time or date.")

    occurrences = []
    for occ_date in occurrence_dates:
        occ_id = f"REQ-{uuid.uuid4().hex[:12].upper()}"
        occ = {**base, "id": occ_id, "date": occ_date}
        if series_id:
            occ["seriesId"] = series_id
        occ.update(build_keys(site, occ["room"], occ_date, occ_id, occ["org"], email, "approved", series_id))
        occurrences.append(occ)

    conflicts = [o["date"] for o in occurrences if find_slot_lock_holder(o["PK"], o) is not None]
    if conflicts:
        raise ClientError(409, f"That room is already booked for an overlapping time on {', '.join(conflicts)}.")

    written = []
    for occ in occurrences:
        try:
            dynamodb_client.transact_write_items(TransactItems=booking_put_items(occ))
        except dynamodb_client.exceptions.TransactionCanceledException:
            rollback_bookings(written)
            raise ClientError(409, "That room was just booked for an overlapping time. Refresh and try again.")
        written.append(occ)

    if series_id:
        bookings_table.put_item(Item={
            "PK": f"SITE#{site}",
            "SK": f"SERIES#{series_id}",
            "seriesId": series_id,
            "pattern": recurring.get("pattern"),
            "days": recurring.get("days", []),
            "seriesStart": recurring.get("seriesStart"),
            "endMode": recurring.get("endMode"),
            "endVal": recurring.get("endVal"),
            "requestIds": [o["id"] for o in occurrences],
        })

    invoke_notify({"type": "approved", "request": occurrences[0]})
    invoke_calendar_invite("REQUEST", occurrences)
    return response(201, {
        "id": occurrences[0]["id"],
        "seriesId": series_id,
        "occurrences": [o["id"] for o in occurrences],
    })


def booking_put_items(item):
    typed = {k: serializer.serialize(v) for k, v in item.items()}
    transact_items = [{"Put": {"TableName": BOOKINGS_TABLE, "Item": typed}}]
    for slot_key in slot_keys_for(item):
        transact_items.append({
            "Put": {
                "TableName": BOOKINGS_TABLE,
                "Item": {"PK": {"S": item["PK"]}, "SK": {"S": slot_key}, "requestId": {"S": item["id"]}},
                "ConditionExpression": "attribute_not_exists(PK)",
            }
        })
    return transact_items


def rollback_bookings(items):
    with bookings_table.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
            for slot_key in slot_keys_for(item):
                batch.delete_item(Key={"PK": item["PK"], "SK": slot_key})


def local_now():
    """Wall-clock time at the sites (all in Pittsburgh), naive to compare with request date/start."""
    return datetime.now(SITE_TZ).replace(tzinfo=None)


def past_start_dates(dates, start):
    now = local_now()
    try:
        return [d for d in dates if datetime.fromisoformat(f"{d}T{start}") < now]
    except ValueError:
        raise ClientError(400, "Invalid date or start time")


def generate_occurrence_dates(recurring, limit=MAX_OCCURRENCES):
    # Duplicated from requests_public (no shared layer — see AGENTS.md).
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


def build_keys(site, room, date, request_id, org, email, status, series_id=None):
    # Duplicated from requests_public — keep the two in sync.
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


def find_booking_by_id(request_id, sites_to_search):
    for site in sites_to_search:
        items = paginate(
            bookings_table.query,
            IndexName="BySiteStatus",
            KeyConditionExpression=Key("GSI2PK").eq(f"SITE#{site}"),
        )
        match = next((i for i in items if i["id"] == request_id), None)
        if match:
            return match
    return None


def load_authorized_request(event, groups, checkin_ok=False):
    request_id = event["pathParameters"]["id"]
    params = event.get("queryStringParameters") or {}
    hinted_site = params.get("site")

    if "admin" in groups and hinted_site:
        sites_to_search = [hinted_site]
    elif "admin" in groups:
        sites_to_search = get_all_active_site_ids()
    else:
        sites_to_search = caller_sites(groups, checkin_ok)
        if not sites_to_search:
            raise ClientError(403, "No site membership on this account")

    item = find_booking_by_id(request_id, sites_to_search)
    if not item:
        raise ClientError(404, "Request not found")
    require_site_access(groups, item["site"], checkin_ok)
    return item


def get_request(event, groups):
    item = load_authorized_request(event, groups)
    return response(200, item)


def approve_request(event, groups):
    """Approve into the room staff assign (body {"room": ...}), which may be any
    active room at the site — the requestor's room/altRoom1/altRoom2 are only
    preferences. Without a body room it approves into the 1st choice."""
    item = load_authorized_request(event, groups)
    if item["status"] != "pending_approval":
        raise ClientError(409, f"Cannot approve a request in status {item['status']}")
    body = json.loads(event.get("body") or "{}")
    assigned_room = body.get("room") or item["room"]
    room_name = require_active_room(item["site"], assigned_room)["name"] if body.get("room") else None
    # Calendar invite bookkeeping: who approved it (they get a copy) and, with
    # invites on, the invite's starting SEQUENCE.
    calendar_fields = {"approvedBy": caller_email(event)}
    if calendar_invites_enabled():
        calendar_fields["calendarSequence"] = 0

    if assigned_room == item["room"]:
        update_expression = "SET #status = :status, GSI2SK = :gsi2sk, updatedAt = :now"
        values = {
            ":status": {"S": "approved"},
            ":gsi2sk": {"S": f"STATUS#approved#DATE#{item['date']}#REQ#{item['id']}"},
            ":now": {"S": now_iso()},
        }
        for name, value in calendar_fields.items():
            update_expression += f", {name} = :{name}"
            values[f":{name}"] = serializer.serialize(value)
        transact_items = [{
            "Update": {
                "TableName": BOOKINGS_TABLE,
                "Key": {"PK": {"S": item["PK"]}, "SK": {"S": item["SK"]}},
                "UpdateExpression": update_expression,
                "ExpressionAttributeNames": {"#status": "status"},
                "ExpressionAttributeValues": values,
            }
        }]
        item = {**item, **calendar_fields}
    else:
        # The booking's SK is keyed on room, so a different room means moving
        # the item. requestedRoom keeps the requestor's 1st choice.
        approved = {**item, **calendar_fields, "room": assigned_room, "requestedRoom": item["room"],
                    "status": "approved", "updatedAt": now_iso()}
        approved.update(build_keys(item["site"], assigned_room, item["date"], item["id"], item["org"],
                                   item["email"], "approved", item.get("seriesId")))
        transact_items = [
            {
                "Delete": {
                    "TableName": BOOKINGS_TABLE,
                    "Key": {"PK": {"S": item["PK"]}, "SK": {"S": item["SK"]}},
                    "ConditionExpression": "#status = :pending",
                    "ExpressionAttributeNames": {"#status": "status"},
                    "ExpressionAttributeValues": {":pending": {"S": "pending_approval"}},
                }
            },
            {
                "Put": {
                    "TableName": BOOKINGS_TABLE,
                    "Item": {k: serializer.serialize(v) for k, v in approved.items()},
                    "ConditionExpression": "attribute_not_exists(PK)",
                }
            },
        ]
        item = approved
    for slot_key in slot_keys_for(item):
        transact_items.append({
            "Put": {
                "TableName": BOOKINGS_TABLE,
                "Item": {"PK": {"S": item["PK"]}, "SK": {"S": slot_key}, "requestId": {"S": item["id"]}},
                "ConditionExpression": "attribute_not_exists(PK)",
            }
        })

    try:
        dynamodb_client.transact_write_items(TransactItems=transact_items)
    except dynamodb_client.exceptions.TransactionCanceledException:
        raise ClientError(409, "That room was just booked for an overlapping time. Refresh and try again.")

    item["status"] = "approved"
    invoke_notify({"type": "approved", "request": item, "roomName": room_name})
    invoke_calendar_invite("REQUEST", [item])
    return response(200, {"id": item["id"], "status": "approved", "room": item["room"]})


def require_active_room(site, room_id):
    room = rooms_table.get_item(Key={"PK": f"SITE#{site}", "SK": f"ROOM#{room_id}"}).get("Item")
    if not room or room.get("active") is False:
        raise ClientError(400, f"Room {room_id} isn't an active room at this site")
    return room


def deny_request(event, groups):
    item = load_authorized_request(event, groups)
    if item["status"] not in ("pending_approval", "counter_proposed"):
        raise ClientError(409, f"Cannot deny a request in status {item['status']}")
    body = json.loads(event.get("body") or "{}")
    reason = body.get("reason", "")

    bookings_table.update_item(
        Key={"PK": item["PK"], "SK": item["SK"]},
        UpdateExpression="SET #status = :status, GSI2SK = :gsi2sk, denyReason = :reason, updatedAt = :now",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "denied",
            ":gsi2sk": f"STATUS#denied#DATE#{item['date']}#REQ#{item['id']}",
            ":reason": reason,
            ":now": now_iso(),
        },
    )
    item["status"] = "denied"
    item["denyReason"] = reason
    invoke_notify({"type": "denied", "request": item, "reason": reason})
    return response(200, {"id": item["id"], "status": "denied"})


def modify_request(event, groups):
    item = load_authorized_request(event, groups)
    if item["status"] != "pending_approval":
        raise ClientError(409, f"Cannot counter-propose a request in status {item['status']}")
    body = json.loads(event.get("body") or "{}")
    counter_proposal = {
        "room": body.get("room", item["room"]),
        "date": body.get("date", item["date"]),
        "start": body.get("start", item["start"]),
        "end": body.get("end", item["end"]),
        "message": body.get("message", ""),
    }
    if _to_minutes(counter_proposal["end"]) <= _to_minutes(counter_proposal["start"]):
        raise ClientError(400, "Counter-proposal end time must be after its start time")
    # The proposal keeps the request's setup/cleanup buffers.
    buffers = {"setupTime": item.get("setupTime"), "cleanupTime": item.get("cleanupTime")}
    if find_slot_lock_holder(item["PK"], {**counter_proposal, **buffers}) is not None:
        raise ClientError(409, "That room is already booked for an overlapping time. Pick another room or time.")

    bookings_table.update_item(
        Key={"PK": item["PK"], "SK": item["SK"]},
        UpdateExpression=(
            "SET #status = :status, GSI2SK = :gsi2sk, counterProposal = :proposal, "
            "counterProposedBy = :by, updatedAt = :now"
        ),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "counter_proposed",
            ":gsi2sk": f"STATUS#counter_proposed#DATE#{item['date']}#REQ#{item['id']}",
            ":proposal": counter_proposal,
            ":by": caller_email(event),
            ":now": now_iso(),
        },
    )
    item["status"] = "counter_proposed"
    item["counterProposal"] = counter_proposal
    invoke_notify({"type": "modified", "request": item})
    return response(200, {"id": item["id"], "status": "counter_proposed", "counterProposal": counter_proposal})


def confirm_cancellation(event, groups):
    item = load_authorized_request(event, groups)
    if item["status"] != "cancellation_requested":
        raise ClientError(409, f"Cannot confirm cancellation for status {item['status']}")

    # Only bookings already sent to the calendar get a CANCEL: one that went
    # counter_proposed → cancellation_requested never had an invite.
    send_cancel = calendar_invites_enabled() and "calendarSequence" in item
    update_expression = "SET #status = :status, GSI2SK = :gsi2sk, updatedAt = :now"
    values = {
        ":status": {"S": "cancelled"},
        ":gsi2sk": {"S": f"STATUS#cancelled#DATE#{item['date']}#REQ#{item['id']}"},
        ":now": {"S": now_iso()},
    }
    if send_cancel:
        item["calendarSequence"] = int(item["calendarSequence"]) + 1
        update_expression += ", calendarSequence = :seq"
        values[":seq"] = {"N": str(item["calendarSequence"])}
    transact_items = [{
        "Update": {
            "TableName": BOOKINGS_TABLE,
            "Key": {"PK": {"S": item["PK"]}, "SK": {"S": item["SK"]}},
            "UpdateExpression": update_expression,
            "ExpressionAttributeNames": {"#status": "status"},
            "ExpressionAttributeValues": values,
        }
    }]
    for slot_key in held_slot_keys(item):
        transact_items.append({
            "Delete": {
                "TableName": BOOKINGS_TABLE,
                "Key": {"PK": {"S": item["PK"]}, "SK": {"S": slot_key}},
            }
        })

    dynamodb_client.transact_write_items(TransactItems=transact_items)

    item["status"] = "cancelled"
    invoke_notify({"type": "cancellation_confirmed", "request": item})
    if send_cancel:
        invoke_calendar_invite("CANCEL", [item])
    return response(200, {"id": item["id"], "status": "cancelled"})


def reject_cancellation(event, groups):
    """Rejecting a cancellation request must restore the booking to 'approved',
    not deny the whole booking. The slot-lock was never removed while
    cancellation_requested, so no lock changes are needed here."""
    item = load_authorized_request(event, groups)
    if item["status"] != "cancellation_requested":
        raise ClientError(409, f"Cannot reject cancellation for status {item['status']}")

    bookings_table.update_item(
        Key={"PK": item["PK"], "SK": item["SK"]},
        UpdateExpression="SET #status = :status, GSI2SK = :gsi2sk, updatedAt = :now",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "approved",
            ":gsi2sk": f"STATUS#approved#DATE#{item['date']}#REQ#{item['id']}",
            ":now": now_iso(),
        },
    )
    return response(200, {"id": item["id"], "status": "approved"})


def resend_invite(event, groups):
    """Re-queue the calendar invite for a booking's current state at its
    current SEQUENCE, e.g. after a failed send. Safe to repeat: same UID +
    SEQUENCE is the same message to the mailbox."""
    if not calendar_invites_enabled():
        raise ClientError(409, "Calendar invites are not enabled for this deployment")
    item = load_authorized_request(event, groups)
    if item["status"] in ("approved", "cancellation_requested"):
        method = "REQUEST"
        if "calendarSequence" not in item:
            # Approved before invites were turned on — start its sequence now.
            result = bookings_table.update_item(
                Key={"PK": item["PK"], "SK": item["SK"]},
                UpdateExpression="SET calendarSequence = if_not_exists(calendarSequence, :zero)",
                ExpressionAttributeValues={":zero": 0},
                ReturnValues="UPDATED_NEW",
            )
            item["calendarSequence"] = result["Attributes"]["calendarSequence"]
    elif item["status"] == "cancelled" and "calendarSequence" in item:
        method = "CANCEL"
    else:
        raise ClientError(409, "This booking isn't on the calendar, so there's no invite to resend")
    invoke_calendar_invite(method, [item])
    return response(202, {"id": item["id"], "method": method, "sequence": int(item["calendarSequence"])})


def checkin_request(event, groups):
    item = load_authorized_request(event, groups, checkin_ok=True)
    if item["status"] != "approved":
        raise ClientError(409, f"Cannot check in a request in status {item['status']}")
    now = now_iso()
    bookings_table.update_item(
        Key={"PK": item["PK"], "SK": item["SK"]},
        UpdateExpression="SET checkInStatus = :cs, checkInTime = :now, updatedAt = :now",
        ExpressionAttributeValues={":cs": "checked_in", ":now": now},
    )
    return response(200, {"id": item["id"], "checkInStatus": "checked_in", "checkInTime": now})


def no_show_request(event, groups):
    item = load_authorized_request(event, groups, checkin_ok=True)
    if item["status"] != "approved":
        raise ClientError(409, f"Cannot mark no-show for a request in status {item['status']}")
    bookings_table.update_item(
        Key={"PK": item["PK"], "SK": item["SK"]},
        UpdateExpression="SET checkInStatus = :cs, updatedAt = :now",
        ExpressionAttributeValues={":cs": "no_show", ":now": now_iso()},
    )
    return response(200, {"id": item["id"], "checkInStatus": "no_show"})


def undo_checkin_request(event, groups):
    item = load_authorized_request(event, groups, checkin_ok=True)
    if item["status"] != "approved":
        raise ClientError(409, f"Cannot undo check-in for a request in status {item['status']}")
    if not item.get("checkInStatus"):
        raise ClientError(409, "No check-in status to undo")
    bookings_table.update_item(
        Key={"PK": item["PK"], "SK": item["SK"]},
        UpdateExpression="REMOVE checkInStatus, checkInTime SET updatedAt = :now",
        ExpressionAttributeValues={":now": now_iso()},
    )
    return response(200, {"id": item["id"]})


def dashboard_sites(groups):
    """Which sites the Dashboard should fan out over for this caller: every
    active site in the Sites table for admin, or the union of a non-admin
    account's own staff-<site>/checkin-<site> group memberships — so a scoped
    staff account gets its own stats instead of a 403 (UI redesign decision
    #6: one Dashboard for every role, replacing the old admin-only
    /admin/overview)."""
    if "admin" in groups:
        return get_all_active_site_ids()
    sites = set()
    for g in groups:
        if g.startswith("staff-") or g.startswith("checkin-"):
            sites.add(g.split("-", 1)[1])
    return sorted(sites)


def sites_summary(groups):
    sites = dashboard_sites(groups)
    if not sites:
        raise ClientError(403, "No site membership on this account")

    summary = {}
    for site in sites:
        items = paginate(
            bookings_table.query,
            IndexName="BySiteStatus",
            KeyConditionExpression=Key("GSI2PK").eq(f"SITE#{site}"),
        )
        counts = {}
        for i in items:
            counts[i["status"]] = counts.get(i["status"], 0) + 1
        summary[site] = counts
    return response(200, {"sites": summary})


def compute_slot_keys(room_id, date, start, end):
    start_minutes = _to_minutes(start)
    end_minutes = _to_minutes(end)
    keys = []
    t = start_minutes
    while t < end_minutes:
        keys.append(f"SLOT#{room_id}#{date}#{t // 60:02d}{t % 60:02d}")
        t += SLOT_INTERVAL_MINUTES
    return keys


def slot_keys_for(item):
    """Slot-lock keys covering item's reserved window (setup + event + cleanup)."""
    return compute_slot_keys(item["room"], item["date"], *reserved_window(item))


def held_slot_keys(item):
    """Slot-lock keys item actually holds within its reserved window. A booking
    approved before setup/cleanup counted toward the reservation holds only its
    event-time locks, so releasing by computed keys could delete a neighbour's
    lock on the buffer slots; filtering on requestId can't."""
    keys = slot_keys_for(item)
    result = bookings_table.query(KeyConditionExpression=Key("PK").eq(item["PK"]) & Key("SK").between(keys[0], keys[-1]))
    return [i["SK"] for i in result.get("Items", []) if i.get("requestId") == item["id"]]


def find_slot_lock_holder(pk, slot):
    """Request id holding any slot lock in slot's room/date/start–end, or None.
    Slot-lock SKs sort by HHMM within a room+date, so one range Query covers
    the whole window. This is a read-time check only: nothing is reserved
    until the requestor accepts, and accept_counter_proposal's conditional
    slot-lock puts remain the real enforcement against a race. The window
    includes slot's setupTime/cleanupTime buffers (see reserved_window)."""
    keys = slot_keys_for(slot)
    result = bookings_table.query(
        KeyConditionExpression=Key("PK").eq(pk) & Key("SK").between(keys[0], keys[-1]),
        Limit=1,
    )
    items = result.get("Items", [])
    return items[0]["requestId"] if items else None


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


def invoke_notify(payload):
    lambda_client.invoke(
        FunctionName=NOTIFY_FUNCTION_NAME,
        InvocationType="Event",
        Payload=json.dumps(payload, default=json_default).encode("utf-8"),
    )


def calendar_invites_enabled():
    return os.environ.get("CALENDAR_INVITES_ENABLED", "false").lower() == "true"


def invoke_calendar_invite(method, items):
    """Queue iCalendar invites (METHOD:REQUEST/CANCEL) for the CEC calendar
    mailbox via notify. Best-effort: a failure is logged, never raised, so it
    can't break the booking change that triggered it."""
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
