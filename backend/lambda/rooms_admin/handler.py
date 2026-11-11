import json
import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config

dynamodb = boto3.resource("dynamodb")
ROOMS_TABLE = os.environ["ROOMS_TABLE"]
SITES_TABLE = os.environ["SITES_TABLE"]
STAFF_USER_POOL_ID = os.environ["STAFF_USER_POOL_ID"]
rooms_table = dynamodb.Table(ROOMS_TABLE)
sites_table = dynamodb.Table(SITES_TABLE)
cognito = boto3.client("cognito-idp")
ROOM_PHOTOS_BUCKET = os.environ["ROOM_PHOTOS_BUCKET"]
ROOM_PHOTOS_DOMAIN = os.environ["ROOM_PHOTOS_DOMAIN"]
s3 = boto3.client("s3", config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))

ROOM_FIELDS = ["name", "floor", "area", "capacity", "equipment", "setups", "restrictions", "emoji", "openTime", "closeTime"]
SITE_FIELDS = ["label", "color"]
# Upper bound for a site's maxOccurrences setting — matches the hard cap
# requests_public.generate_occurrence_dates already applies to every series.
MAX_OCCURRENCES_CAP = 52
MAX_PHOTOS = 5
MAX_PHOTO_BYTES = 5 * 1024 * 1024
PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


class ClientError(Exception):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def handler(event, _context):
    method = event.get("httpMethod")
    resource = event.get("resource")

    try:
        # GET /api/sites is the one deliberately public route on this
        # otherwise admin-only function — checked before
        # require_admin so it works with no Cognito authorizer attached at
        # all (api-constructs.ts adds no MethodOptions for it).
        if method == "GET" and resource == "/api/sites":
            return list_sites()

        groups = get_groups(event)
        require_admin(groups)
        if method == "POST" and resource == "/api/sites/{site}/rooms":
            return create_room(event)
        if method == "PUT" and resource == "/api/sites/{site}/rooms/{roomId}":
            return update_room(event)
        # Admin-only full catalog listing (active + inactive): an admin must be
        # able to see a deactivated room in order to reactivate it. Same admin
        # trust boundary as the routes above, so it lives here rather than as a
        # competing function (see AGENTS.md).
        if method == "GET" and resource == "/api/admin/sites/{site}/rooms":
            return list_all_rooms(event)
        if method == "POST" and resource == "/api/admin/sites/{site}/room-photos":
            return create_photo_upload(event)
        if method == "POST" and resource == "/api/sites":
            return create_site(event)
        if method == "PUT" and resource == "/api/sites/{site}":
            return update_site(event)
        return response(404, {"message": "Not found"})
    except ClientError as exc:
        return response(exc.status_code, {"message": exc.message})


def get_groups(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    raw = claims.get("cognito:groups", "")
    return [g for g in raw.replace(",", " ").split() if g]


def caller_identity(event):
    claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    return claims.get("email") or claims.get("sub") or "unknown"


def require_admin(groups):
    if "admin" not in groups:
        raise ClientError(403, "Admin access required")


def generate_room_id():
    return f"r-{uuid.uuid4().hex[:8]}"


def create_room(event):
    site = event["pathParameters"]["site"]
    body = json.loads(event.get("body") or "{}")
    if not body.get("name"):
        raise ClientError(400, "name is required")

    open_t = body.get("openTime", "09:00")
    close_t = body.get("closeTime", "17:00")
    if open_t >= close_t:
        raise ClientError(400, "openTime must be before closeTime (both within the same day; 24-hour spans are not allowed)")

    now = now_iso()
    who = caller_identity(event)
    room_id = generate_room_id()
    item = {
        "PK": f"SITE#{site}",
        "SK": f"ROOM#{room_id}",
        "id": room_id,
        "name": body["name"],
        "floor": body.get("floor", ""),
        "area": body.get("area", ""),
        "capacity": int(body.get("capacity") or 0),
        "equipment": body.get("equipment", []),
        "setups": body.get("setups", []),
        "restrictions": body.get("restrictions", []),
        "emoji": body.get("emoji") or "🏢",
        "openTime": open_t,
        "closeTime": close_t,
        "active": True,
        "hidden": bool(body.get("hidden")),
        "photos": clean_photos(site, body.get("photos", [])),
        "createdBy": who,
        "createdAt": now,
        "updatedBy": who,
        "updatedAt": now,
    }

    try:
        rooms_table.put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
    except rooms_table.meta.client.exceptions.ConditionalCheckFailedException:
        raise ClientError(409, "Room id collision, please retry")

    return response(201, strip_keys(item))


def update_room(event):
    site = event["pathParameters"]["site"]
    room_id = event["pathParameters"]["roomId"]
    body = json.loads(event.get("body") or "{}")
    key = {"PK": f"SITE#{site}", "SK": f"ROOM#{room_id}"}

    existing = rooms_table.get_item(Key=key).get("Item")
    if not existing:
        raise ClientError(404, "Room not found")

    updates = {field: body[field] for field in ROOM_FIELDS if field in body}
    if "active" in body:
        updates["active"] = bool(body["active"])
    if "hidden" in body:
        updates["hidden"] = bool(body["hidden"])
    if "photos" in body:
        updates["photos"] = clean_photos(site, body["photos"])
    open_t = updates.get("openTime", existing.get("openTime", "09:00"))
    close_t = updates.get("closeTime", existing.get("closeTime", "17:00"))
    if "openTime" in updates or "closeTime" in updates:
        if open_t >= close_t:
            raise ClientError(400, "openTime must be before closeTime (both within the same day; 24-hour spans are not allowed)")
    if not updates:
        raise ClientError(400, "No updatable fields provided")

    updates["updatedBy"] = caller_identity(event)
    updates["updatedAt"] = now_iso()

    rooms_table.update_item(
        Key=key,
        UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in updates),
        ExpressionAttributeNames={f"#{k}": k for k in updates},
        ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
    )

    if "photos" in updates:
        delete_photos(set(existing.get("photos", [])) - set(updates["photos"]))

    updated = rooms_table.get_item(Key=key)["Item"]
    return response(200, strip_keys(updated))


def photo_prefix(site):
    return f"https://{ROOM_PHOTOS_DOMAIN}/rooms/{site}/"


def create_photo_upload(event):
    """Presigned POST for one photo; the browser uploads it straight to S3,
    then saves the returned photoUrl in the room's photos list."""
    site = event["pathParameters"]["site"]
    body = json.loads(event.get("body") or "{}")
    ext = PHOTO_TYPES.get(body.get("contentType"))
    if not ext:
        raise ClientError(400, "Photos must be JPEG, PNG, or WebP images")
    if not sites_table.get_item(Key={"PK": f"SITE#{site}", "SK": "CONFIG"}).get("Item"):
        raise ClientError(404, "Site not found")
    key = f"rooms/{site}/{uuid.uuid4().hex}.{ext}"
    upload = s3.generate_presigned_post(
        ROOM_PHOTOS_BUCKET,
        key,
        Fields={"Content-Type": body["contentType"]},
        Conditions=[{"Content-Type": body["contentType"]}, ["content-length-range", 1, MAX_PHOTO_BYTES]],
        ExpiresIn=300,
    )
    return response(201, {"upload": upload, "photoUrl": f"https://{ROOM_PHOTOS_DOMAIN}/{key}"})


def clean_photos(site, photos):
    """Only photos uploaded for this site (see create_photo_upload) are accepted."""
    if not isinstance(photos, list) or not all(isinstance(u, str) for u in photos):
        raise ClientError(400, "photos must be a list of photo URLs")
    urls = list(dict.fromkeys(photos))
    if len(urls) > MAX_PHOTOS:
        raise ClientError(400, f"A room can have at most {MAX_PHOTOS} photos")
    prefix = re.escape(photo_prefix(site))
    for url in urls:
        if not re.fullmatch(prefix + r"[0-9a-f]{32}\.(jpg|png|webp)", url):
            raise ClientError(400, "Photos must be uploaded through the room editor")
    return urls


def delete_photos(urls):
    base = f"https://{ROOM_PHOTOS_DOMAIN}/"
    keys = [u[len(base):] for u in urls if u.startswith(base)]
    if keys:
        s3.delete_objects(Bucket=ROOM_PHOTOS_BUCKET, Delete={"Objects": [{"Key": k} for k in keys], "Quiet": True})


def list_all_rooms(event):
    site = event["pathParameters"]["site"]
    result = rooms_table.query(KeyConditionExpression=Key("PK").eq(f"SITE#{site}"))
    rooms = []
    for item in result.get("Items", []):
        room = strip_keys(item)
        room["active"] = item.get("active", True)
        room["hidden"] = item.get("hidden", False)
        rooms.append(room)
    return response(200, {"site": site, "rooms": rooms})


def slugify_site_id(label):
    # Site ids are used as path params and as the staff-<id>/checkin-<id>
    # Cognito group name suffix, so they need to be a stable, readable slug
    # rather than an opaque id like generate_room_id's r-<8 hex> — "Hill
    # District" -> "hill-district". Collisions are a real, user-visible 409
    # (see create_site) rather than silently retried with a random suffix,
    # since regenerating the slug would defeat the point of a readable id.
    slug = re.sub(r"[^a-z0-9]+", "-", label.strip().lower()).strip("-")
    if not slug:
        raise ClientError(400, "label must contain at least one letter or number")
    return slug


def list_sites():
    sites = []
    kwargs = {}
    while True:
        result = sites_table.scan(**kwargs)
        sites.extend(site_view(item) for item in result.get("Items", []))
        last_key = result.get("LastEvaluatedKey")
        if not last_key:
            break
        kwargs["ExclusiveStartKey"] = last_key
    sites.sort(key=lambda s: s.get("label", ""))
    return response(200, {"sites": sites})


def create_group_idempotent(group_name):
    # Tolerates the group already existing so a retry after a partial
    # failure (see provision_site_groups) doesn't itself fail on whichever
    # group creation already succeeded last time.
    try:
        cognito.create_group(UserPoolId=STAFF_USER_POOL_ID, GroupName=group_name)
    except cognito.exceptions.GroupExistsException:
        pass


def provision_site_groups(site_id, site_key):
    """Create the staff-<site>/checkin-<site> Cognito groups for a new site
    (runtime group creation, so a new site is staffable without a redeploy).

    Partial-failure handling: if either CreateGroup call fails, the Sites row
    just written by create_site is rolled back (best-effort delete) rather
    than left behind half-provisioned. This keeps the operation atomic from
    the caller's point of view — a site never exists in DynamoDB without at
    least an attempt to make it staffable — and, combined with
    create_group_idempotent's tolerance of an already-existing group, means a
    plain retry of the same POST /api/sites is always a safe, complete way to
    recover: the conditional write in create_site will succeed again since
    the row is gone, and any group that was already created on the failed
    attempt is silently accepted rather than re-raised.
    """
    try:
        create_group_idempotent(f"staff-{site_id}")
        create_group_idempotent(f"checkin-{site_id}")
    except Exception as exc:
        sites_table.delete_item(Key=site_key)
        raise ClientError(
            502,
            "Site record rolled back: failed to provision Cognito groups for the new site. Please retry.",
        ) from exc


def parse_max_occurrences(value):
    """Validate a site's maxOccurrences setting. None/"" means no site-specific
    limit (requests_public then falls back to its 52-occurrence hard cap)."""
    if value in (None, ""):
        return None
    if isinstance(value, int) and not isinstance(value, bool):
        parsed = value
    elif isinstance(value, str) and value.strip().isdigit():
        parsed = int(value)
    else:
        raise ClientError(400, "maxOccurrences must be a whole number")
    if not 1 <= parsed <= MAX_OCCURRENCES_CAP:
        raise ClientError(400, f"maxOccurrences must be between 1 and {MAX_OCCURRENCES_CAP}")
    return parsed


def site_view(item):
    # maxOccurrences comes back from DynamoDB as a Decimal; response()'s
    # json_default sends it as a JSON number.
    return strip_keys(item)


def create_site(event):
    body = json.loads(event.get("body") or "{}")
    label = (body.get("label") or "").strip()
    if not label:
        raise ClientError(400, "label is required")

    site_id = slugify_site_id(label)
    color = body.get("color") or "#6B7280"
    max_occurrences = parse_max_occurrences(body.get("maxOccurrences"))
    now = now_iso()
    who = caller_identity(event)
    key = {"PK": f"SITE#{site_id}", "SK": "CONFIG"}
    item = {
        **key,
        "id": site_id,
        "label": label,
        "color": color,
        "active": True,
        "createdBy": who,
        "createdAt": now,
        "updatedBy": who,
        "updatedAt": now,
    }
    if max_occurrences is not None:
        item["maxOccurrences"] = max_occurrences

    try:
        sites_table.put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
    except sites_table.meta.client.exceptions.ConditionalCheckFailedException:
        raise ClientError(409, f"Site '{site_id}' already exists")

    provision_site_groups(site_id, key)

    return response(201, site_view(item))


def update_site(event):
    site_id = event["pathParameters"]["site"]
    body = json.loads(event.get("body") or "{}")
    key = {"PK": f"SITE#{site_id}", "SK": "CONFIG"}

    existing = sites_table.get_item(Key=key).get("Item")
    if not existing:
        raise ClientError(404, "Site not found")

    updates = {field: body[field] for field in SITE_FIELDS if field in body}
    if "active" in body:
        updates["active"] = bool(body["active"])
    removals = []
    if "maxOccurrences" in body:
        max_occurrences = parse_max_occurrences(body["maxOccurrences"])
        if max_occurrences is None:
            removals.append("maxOccurrences")
        else:
            updates["maxOccurrences"] = max_occurrences
    if not updates and not removals:
        raise ClientError(400, "No updatable fields provided")

    updates["updatedBy"] = caller_identity(event)
    updates["updatedAt"] = now_iso()

    update_expression = "SET " + ", ".join(f"#{k} = :{k}" for k in updates)
    if removals:
        update_expression += " REMOVE " + ", ".join(f"#{k}" for k in removals)
    sites_table.update_item(
        Key=key,
        UpdateExpression=update_expression,
        ExpressionAttributeNames={f"#{k}": k for k in [*updates, *removals]},
        ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
    )

    updated = sites_table.get_item(Key=key)["Item"]
    return response(200, site_view(updated))


def strip_keys(item):
    return {k: v for k, v in item.items() if k not in ("PK", "SK")}


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
