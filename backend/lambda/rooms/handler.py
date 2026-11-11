import json
import os
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
ROOMS_TABLE = os.environ["ROOMS_TABLE"]
rooms_table = dynamodb.Table(ROOMS_TABLE)


def handler(event, _context):
    method = event.get("httpMethod")
    resource = event.get("resource")

    if method == "GET" and resource == "/api/sites/{site}/rooms":
        return list_rooms(event)
    return response(404, {"message": "Not found"})


def list_rooms(event):
    site = event["pathParameters"]["site"]
    result = rooms_table.query(KeyConditionExpression=Key("PK").eq(f"SITE#{site}"))
    # Seeded rooms have no `active` attribute at all — absence means active
    # so only an explicit `active: false` hides one.
    rooms = [strip_keys(item) for item in result.get("Items", []) if item.get("active", True)]
    # Hidden (staff-only) rooms stay in this listing so the staff views that
    # share it (calendar, queue, New Booking) can show them; the public request
    # form filters them out and requests_public rejects a submission naming one.
    for room in rooms:
        room["hidden"] = room.get("hidden", False)
    return response(200, {"site": site, "rooms": rooms})


def strip_keys(item):
    return {k: v for k, v in item.items() if k not in ("PK", "SK")}


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
