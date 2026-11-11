import importlib
import json
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from moto import mock_aws

from backend.tests.test_approve_conflict_moto import _create_bookings_table, _pending_item
from backend.tests.test_rooms_admin_moto import _create_rooms_table, _event

rooms_admin_handler = importlib.import_module("backend.lambda.rooms_admin.handler")
rooms_handler = importlib.import_module("backend.lambda.rooms.handler")
staff_handler = importlib.import_module("backend.lambda.requests_staff.handler")

HANDLERS = [
    importlib.import_module(f"backend.lambda.{name}.handler")
    for name in ("requests_public", "requests_requestor", "requests_staff", "rooms_admin", "rooms")
]


# DynamoDB returns numbers as Decimal. Serialized with default=str they reached
# the browser as strings, so the approve panel compared "30" < "4" as text and
# warned that a 30-seat room was too small for 4 people.
@pytest.mark.parametrize("module", HANDLERS, ids=lambda m: m.__name__.split(".")[-2])
def test_json_default_sends_decimals_as_numbers(module):
    body = json.loads(module.response(200, {"n": Decimal("30"), "x": Decimal("2.5")})["body"])
    assert body == {"n": 30, "x": 2.5}
    assert isinstance(body["n"], int)
    # Non-numeric fallbacks are still strings.
    assert module.json_default(datetime(2026, 1, 5, tzinfo=timezone.utc)) == "2026-01-05 00:00:00+00:00"


@mock_aws
def test_room_capacity_is_a_json_number():
    _create_rooms_table()
    created = json.loads(rooms_admin_handler.handler(
        _event("POST", "/api/sites/{site}/rooms", {"site": "homewood"}, body={"name": "Board Room", "capacity": 30}),
        None,
    )["body"])
    assert created["capacity"] == 30

    listing = json.loads(rooms_handler.handler(
        {"httpMethod": "GET", "resource": "/api/sites/{site}/rooms", "pathParameters": {"site": "homewood"}}, None,
    )["body"])
    room = next(r for r in listing["rooms"] if r["id"] == created["id"])
    assert room["capacity"] == 30 and isinstance(room["capacity"], int)


@mock_aws
def test_request_attendance_is_a_json_number():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(
        Item={**_pending_item("REQ-1", "r5", "2026-07-14", "09:00", "10:00"), "attendance": 4}
    )

    body = json.loads(staff_handler.list_site_requests(
        {"pathParameters": {"site": "homewood"}, "queryStringParameters": None}, ["staff-homewood"],
    )["body"])
    attendance = body["requests"][0]["attendance"]
    assert attendance == 4 and isinstance(attendance, int)
