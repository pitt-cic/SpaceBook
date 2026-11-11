"""Staff calendar subscription: a per-user secret .ics URL that Outlook (or any
iCalendar client) polls. Calendar apps can't send a Cognito token, so the
feed route is public and the token in its path is the credential. The
owner's Cognito groups are re-read on every fetch, so removing someone's
site access (or disabling them) shrinks or kills their feed with no extra
revocation step."""
import json
import os
import secrets
import traceback
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.conditions import Key
from icalendar import Calendar, Event

dynamodb = boto3.resource("dynamodb")
dynamodb_client = boto3.client("dynamodb")
cognito = boto3.client("cognito-idp")

BOOKINGS_TABLE = os.environ["BOOKINGS_TABLE"]
ROOMS_TABLE = os.environ["ROOMS_TABLE"]
SITES_TABLE = os.environ["SITES_TABLE"]
CALENDAR_FEEDS_TABLE = os.environ["CALENDAR_FEEDS_TABLE"]
STAFF_USER_POOL_ID = os.environ["STAFF_USER_POOL_ID"]

bookings_table = dynamodb.Table(BOOKINGS_TABLE)
rooms_table = dynamodb.Table(ROOMS_TABLE)
sites_table = dynamodb.Table(SITES_TABLE)
feeds_table = dynamodb.Table(CALENDAR_FEEDS_TABLE)

SITE_TZ = ZoneInfo("America/New_York")
PRODID = "-//SpaceBook//Staff Calendar Feed//EN"
# Statuses where the room is actually booked. cancellation_requested is still
# a held booking until staff confirm the cancellation.
FEED_STATUSES = ("approved", "cancellation_requested")
# How far back the feed reaches; everything upcoming is always included.
PAST_DAYS = 60


class ClientError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def handler(event, _context):
    method = event.get("httpMethod")
    resource = event.get("resource")

    try:
        if method == "GET" and resource == "/api/calendar/feed/{token}":
            return get_feed(event)
        if method == "GET" and resource == "/api/calendar/token":
            return get_token(event)
        if method == "POST" and resource == "/api/calendar/token":
            return rotate_token(event)
        return response(404, {"message": "Not found"})
    except ClientError as exc:
        return response(exc.status_code, {"message": exc.message})
    except Exception:  # noqa: BLE001 — never leak a CORS-less 502 to the browser
        traceback.print_exc()
        return response(500, {"message": "Internal server error"})


# --- Token management (Pool A authorizer) ---------------------------------

def caller(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    raw = claims.get("cognito:groups", "")
    groups = [g for g in raw.replace(",", " ").split() if g]
    username = claims.get("cognito:username")
    if not username:
        raise ClientError(401, "Missing caller identity")
    if "admin" not in groups and not any(g.startswith("staff-") for g in groups):
        raise ClientError(403, "Calendar feeds are for staff accounts")
    return username


def get_token(event):
    username = caller(event)
    item = feeds_table.get_item(Key={"PK": f"USER#{username}", "SK": "FEED"}).get("Item")
    return response(200, {"token": item["token"] if item else None})


def rotate_token(event):
    """Create the caller's feed token, or replace it — the old URL stops
    working immediately. The user item is conditioned on the token we read,
    so two concurrent resets can't both succeed and leave an orphaned token
    that still works."""
    username = caller(event)
    user_key = {"PK": {"S": f"USER#{username}"}, "SK": {"S": "FEED"}}
    existing = feeds_table.get_item(Key={"PK": f"USER#{username}", "SK": "FEED"}).get("Item")
    old_token = existing["token"] if existing else None
    new_token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc).isoformat()

    user_put = {
        "TableName": CALENDAR_FEEDS_TABLE,
        "Item": {**user_key, "token": {"S": new_token}, "createdAt": {"S": now}},
    }
    if old_token:
        user_put["ConditionExpression"] = "#token = :old"
        user_put["ExpressionAttributeNames"] = {"#token": "token"}
        user_put["ExpressionAttributeValues"] = {":old": {"S": old_token}}
    else:
        user_put["ConditionExpression"] = "attribute_not_exists(PK)"

    items = [
        {"Put": user_put},
        {"Put": {
            "TableName": CALENDAR_FEEDS_TABLE,
            "Item": {
                "PK": {"S": f"TOKEN#{new_token}"},
                "SK": {"S": "FEED"},
                "username": {"S": username},
                "createdAt": {"S": now},
            },
        }},
    ]
    if old_token:
        items.append({"Delete": {
            "TableName": CALENDAR_FEEDS_TABLE,
            "Key": {"PK": {"S": f"TOKEN#{old_token}"}, "SK": {"S": "FEED"}},
        }})

    try:
        dynamodb_client.transact_write_items(TransactItems=items)
    except dynamodb_client.exceptions.TransactionCanceledException:
        raise ClientError(409, "Your calendar link was just changed. Please try again.")
    return response(200, {"token": new_token})


# --- Public feed ----------------------------------------------------------

def get_feed(event):
    token = (event.get("pathParameters") or {}).get("token") or ""
    if token.endswith(".ics"):
        token = token[: -len(".ics")]
    item = feeds_table.get_item(Key={"PK": f"TOKEN#{token}", "SK": "FEED"}).get("Item") if token else None
    if not item:
        raise ClientError(404, "Calendar not found")

    # Lost access is an empty calendar, not an error: on an error Outlook keeps
    # showing its last copy forever, while an empty feed clears it on the next
    # refresh.
    groups = live_groups(item["username"])
    sites = active_sites()
    allowed = feed_site_ids(groups, sites)

    params = event.get("queryStringParameters") or {}
    if params.get("site"):
        allowed = [params["site"]] if params["site"] in allowed else []

    if len(allowed) == 1:
        name = f"SpaceBook – {sites[allowed[0]].get('label') or allowed[0]}"
    else:
        name = "SpaceBook – All my sites"

    from_date = (local_now().date() - timedelta(days=PAST_DAYS)).isoformat()
    events = []
    for site_id in allowed:
        room_names = room_names_for(site_id)
        site_label = sites[site_id].get("label") or site_id
        for booking in site_bookings(site_id, from_date):
            events.append(build_vevent(booking, room_names, site_label))

    return {
        "statusCode": 200,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'inline; filename="spacebook.ics"',
            "Cache-Control": "private, max-age=300",
        },
        "body": build_calendar(name, events),
    }


def live_groups(username):
    """The token owner's current Cognito groups; none for a deleted or
    disabled user, so their feed empties."""
    try:
        user = cognito.admin_get_user(UserPoolId=STAFF_USER_POOL_ID, Username=username)
    except cognito.exceptions.UserNotFoundException:
        return []
    if not user.get("Enabled", True):
        return []

    groups = []
    kwargs = {"UserPoolId": STAFF_USER_POOL_ID, "Username": username}
    while True:
        result = cognito.admin_list_groups_for_user(**kwargs)
        groups.extend(g["GroupName"] for g in result.get("Groups", []))
        if not result.get("NextToken"):
            return groups
        kwargs["NextToken"] = result["NextToken"]


def active_sites():
    """Every active Sites row by id (a missing `active` attribute means active)."""
    sites = {}
    kwargs = {}
    while True:
        result = sites_table.scan(**kwargs)
        for site in result.get("Items", []):
            if site.get("active", True):
                sites[site["id"]] = site
        if "LastEvaluatedKey" not in result:
            return sites
        kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]


def feed_site_ids(groups, sites):
    """Same access rule as requests_staff.require_site_access: admin sees every
    active site, otherwise each staff-<site> group. checkin-<site> alone
    doesn't grant the request queue, so it doesn't grant the feed either."""
    if "admin" in groups:
        return sorted(sites)
    return sorted(g.split("-", 1)[1] for g in groups if g.startswith("staff-") and g.split("-", 1)[1] in sites)


def room_names_for(site_id):
    result = rooms_table.query(KeyConditionExpression=Key("PK").eq(f"SITE#{site_id}"))
    return {room["id"]: room.get("name") or room["id"] for room in result.get("Items", [])}


def site_bookings(site_id, from_date):
    items = []
    for status in FEED_STATUSES:
        kwargs = {
            "IndexName": "BySiteStatus",
            # "~" sorts after every digit, so this is "from from_date onward".
            "KeyConditionExpression": Key("GSI2PK").eq(f"SITE#{site_id}")
            & Key("GSI2SK").between(f"STATUS#{status}#DATE#{from_date}", f"STATUS#{status}#DATE#~"),
        }
        while True:
            result = bookings_table.query(**kwargs)
            items.extend(i for i in result.get("Items", []) if i.get("date") and i.get("start") and i.get("end"))
            if "LastEvaluatedKey" not in result:
                break
            kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]
    return items


def local_now():
    """Wall-clock time at the sites (all in Pittsburgh), naive like request dates."""
    return datetime.now(SITE_TZ).replace(tzinfo=None)


# --- iCalendar (RFC 5545) -------------------------------------------------

def build_vevent(booking, room_names, site_label):
    room = room_names.get(booking["room"], booking["room"])
    title = booking.get("title") or "SpaceBook booking"
    if booking["status"] == "cancellation_requested":
        title = f"[Cancellation requested] {title}"
    stamp = parse_iso(booking.get("updatedAt")) or datetime.now(timezone.utc)
    held_start, held_end = reserved_window(booking)

    event = Event()
    # Stable across edits, so a changed time/room updates the existing event
    # in Outlook instead of adding a second one. Deliberately not the
    # calendar-invite UID (booking-<id>@<domain>): the feed is its own
    # subscribed calendar, and sharing a UID with an invite already in the
    # user's own calendar can make clients merge or reject one of them.
    event.add("uid", f"{booking['id']}@spacebook-feed")
    event.add("dtstamp", stamp)
    event.add("last-modified", stamp)
    # The room's whole reserved window (setup through cleanup), since that's
    # what staff are scheduling around; the event's own times are in
    # DESCRIPTION. UTC, so the feed needs no VTIMEZONE.
    event.add("dtstart", local_to_utc(booking["date"], held_start))
    event.add("dtend", local_to_utc(booking["date"], held_end))
    event.add("summary", title)
    event.add("location", f"{room}, {site_label}")
    event.add("description", describe(booking, held_start, held_end))
    event.add("status", "CONFIRMED")
    event.add("transp", "OPAQUE")
    return event


def describe(booking, held_start, held_end):
    """The staff request-detail fields, as "Label: value" lines. Includes the
    requester's contact details — staff need them, and the feed URL is a
    per-staff secret (Reset link revokes a leaked one)."""
    event_time = f"{booking['start']}–{booking['end']}"
    if (held_start, held_end) != (booking["start"], booking["end"]):
        event_time += f" (room held {held_start}–{held_end} for setup/cleanup)"
    requester = " ".join(p for p in (booking.get("firstname"), booking.get("lastname")) if p)
    details = [
        ("Event time", event_time),
        ("Setup before", booking.get("setupTime")),
        ("Cleanup after", booking.get("cleanupTime")),
        ("Organization", booking.get("org")),
        ("Event type", booking.get("type")),
        ("Activity type", booking.get("activityType")),
        ("Expected attendance", booking.get("attendance")),
        ("Minors involved", booking.get("minors")),
        ("Tech / equipment needs", ", ".join(booking.get("techNeeds") or [])),
        ("Notes", booking.get("notes")),
        ("", None),
        ("Requested by", requester),
        ("Email", booking.get("email")),
        ("Phone", booking.get("phone")),
        ("Approved by", booking.get("approvedBy") or booking.get("bookedBy")),
        ("", None),
        ("Recurring series", booking.get("seriesId")),
        ("Booking ID", booking["id"]),
    ]
    lines = []
    for label, value in details:
        if not label:
            if lines and lines[-1]:
                lines.append("")  # section break
        elif value not in (None, ""):
            lines.append(f"{label}: {value}")
    return "\n".join(lines).strip()


def buffer_minutes(value):
    """Setup/cleanup option ("15 min", "1 hour", None) → minutes."""
    parts = str(value or "").split()
    if not parts or not parts[0].isdigit():
        return 0
    return int(parts[0]) * (60 if parts[1:2] == ["hour"] else 1)


def reserved_window(item):
    """The time the room is actually held: setupTime before the event's start
    through cleanupTime after its end. Duplicated from requests_staff (no
    shared layer), which uses it for slot locks and conflict checks."""
    start = max(0, _to_minutes(item["start"]) - buffer_minutes(item.get("setupTime")))
    end = min(24 * 60, _to_minutes(item["end"]) + buffer_minutes(item.get("cleanupTime")))
    return f"{start // 60:02d}:{start % 60:02d}", f"{end // 60:02d}:{end % 60:02d}"


def _to_minutes(hhmm):
    hh, mm = hhmm.split(":")
    return int(hh) * 60 + int(mm)


def build_calendar(name, events):
    cal = Calendar()
    cal.add("prodid", PRODID)
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("method", "PUBLISH")
    cal.add("x-wr-calname", name)
    cal.add("x-wr-timezone", "America/New_York")
    # Refresh hints: classic Outlook desktop honors X-PUBLISHED-TTL;
    # Outlook on the web picks its own interval regardless.
    cal.add("x-published-ttl", "PT1H")
    cal.add("refresh-interval", timedelta(hours=1), parameters={"VALUE": "DURATION"})
    for event in events:
        cal.add_component(event)
    return cal.to_ical().decode("utf-8")


def local_to_utc(date_str, hhmm):
    """Site-local date + "HH:MM" (incl. "24:00") → aware UTC datetime."""
    hh, mm = hhmm.split(":")
    midnight = datetime.strptime(date_str, "%Y-%m-%d")
    local = (midnight + timedelta(hours=int(hh), minutes=int(mm))).replace(tzinfo=SITE_TZ)
    return local.astimezone(timezone.utc)


def parse_iso(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
        },
        "body": json.dumps(body),
    }
