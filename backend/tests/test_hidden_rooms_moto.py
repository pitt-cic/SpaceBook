import importlib
import json

import pytest
from moto import mock_aws

from backend.tests.test_approve_conflict_moto import _create_bookings_table
from backend.tests.test_rooms_admin_moto import _create_rooms_table, _event
from backend.tests.test_sites_admin_moto import _create_sites_table

rooms_admin_handler = importlib.import_module("backend.lambda.rooms_admin.handler")
rooms_handler = importlib.import_module("backend.lambda.rooms.handler")
public_handler = importlib.import_module("backend.lambda.requests_public.handler")
staff_handler = importlib.import_module("backend.lambda.requests_staff.handler")

BOOKING = {
    "firstname": "Ada", "lastname": "Lovelace", "email": "Ada@Example.com", "org": "Test Org",
    "title": "Board meeting", "activityType": "meeting", "type": "internal",
    "room": "r5", "date": "2026-07-07", "start": "09:00", "end": "10:00", "attendance": 5,
    "minors": "no",
}


@pytest.fixture(autouse=True)
def no_side_effects(monkeypatch):
    monkeypatch.setattr(public_handler, "provision_requestor_user", lambda *a: None)
    monkeypatch.setattr(public_handler, "invoke_notify", lambda payload: None)
    monkeypatch.setattr(staff_handler, "invoke_notify", lambda payload: None)


def _put_room(room_id, hidden):
    rooms_admin_handler.rooms_table.put_item(Item={
        "PK": "SITE#homewood", "SK": f"ROOM#{room_id}", "id": room_id, "name": room_id, "hidden": hidden,
    })


def _public_submit(**overrides):
    body = {**BOOKING, "site": "homewood", "facilityRulesAccepted": True, **overrides}
    return public_handler.handler({"httpMethod": "POST", "resource": "/api/requests", "body": json.dumps(body)}, None)


def _staff_book(groups=("staff-homewood",), site="homewood", **overrides):
    return staff_handler.handler({
        "httpMethod": "POST",
        "resource": "/api/sites/{site}/requests",
        "pathParameters": {"site": site},
        "body": json.dumps({**BOOKING, **overrides}),
        "requestContext": {
            "authorizer": {"claims": {"cognito:groups": ",".join(groups), "email": "staff@example.com"}}
        },
    }, None)


def _locks():
    return [i for i in staff_handler.bookings_table.scan()["Items"] if i["SK"].startswith("SLOT#")]


def _bookings():
    return [i for i in staff_handler.bookings_table.scan()["Items"] if i["SK"].startswith("ROOM#")]


@mock_aws
def test_admin_can_hide_a_room_and_public_listing_flags_it():
    _create_rooms_table()
    created = json.loads(rooms_admin_handler.handler(
        _event("POST", "/api/sites/{site}/rooms", {"site": "homewood"}, body={"name": "Board Room", "hidden": True}),
        None,
    )["body"])
    assert created["hidden"] is True

    listing = json.loads(rooms_handler.handler(
        {"httpMethod": "GET", "resource": "/api/sites/{site}/rooms", "pathParameters": {"site": "homewood"}}, None,
    )["body"])
    assert next(r for r in listing["rooms"] if r["id"] == created["id"])["hidden"] is True

    updated = rooms_admin_handler.handler(
        _event("PUT", "/api/sites/{site}/rooms/{roomId}", {"site": "homewood", "roomId": created["id"]},
               body={"hidden": False}),
        None,
    )
    assert json.loads(updated["body"])["hidden"] is False


@mock_aws
def test_rooms_without_the_attribute_are_not_hidden():
    _create_rooms_table()
    rooms_admin_handler.rooms_table.put_item(Item={"PK": "SITE#homewood", "SK": "ROOM#r1", "id": "r1", "name": "Seeded"})

    listing = json.loads(rooms_handler.handler(
        {"httpMethod": "GET", "resource": "/api/sites/{site}/rooms", "pathParameters": {"site": "homewood"}}, None,
    )["body"])
    assert listing["rooms"][0]["hidden"] is False


@mock_aws
@pytest.mark.parametrize("overrides", [{"room": "r9"}, {"altRoom1": "r9"}, {"altRoom2": "r9"}])
def test_public_submission_naming_a_hidden_room_is_rejected(overrides):
    _create_rooms_table()
    _create_sites_table()
    _create_bookings_table()
    _put_room("r5", hidden=False)
    _put_room("r9", hidden=True)

    result = _public_submit(**overrides)
    assert result["statusCode"] == 400
    assert "only be booked by staff" in json.loads(result["body"])["message"]
    assert public_handler.bookings_table.scan()["Items"] == []


@mock_aws
def test_public_submission_for_a_visible_room_still_works():
    _create_rooms_table()
    _create_sites_table()
    _create_bookings_table()
    _put_room("r5", hidden=False)

    assert _public_submit()["statusCode"] == 201


@mock_aws
def test_staff_booking_is_approved_with_slot_locks():
    _create_bookings_table()

    result = _staff_book(room="r9")
    assert result["statusCode"] == 201
    request_id = json.loads(result["body"])["id"]

    [booking] = _bookings()
    assert booking["id"] == request_id
    assert booking["status"] == "approved"
    assert booking["GSI2SK"] == f"STATUS#approved#DATE#2026-07-07#REQ#{request_id}"
    assert booking["email"] == "ada@example.com"
    assert booking["bookedBy"] == "staff@example.com"
    assert sorted(lock["SK"] for lock in _locks()) == [
        "SLOT#r9#2026-07-07#0900", "SLOT#r9#2026-07-07#0915",
        "SLOT#r9#2026-07-07#0930", "SLOT#r9#2026-07-07#0945",
    ]


@mock_aws
def test_staff_booking_over_an_existing_booking_conflicts():
    _create_bookings_table()
    assert _staff_book()["statusCode"] == 201

    result = _staff_book(start="09:30", end="11:00")
    assert result["statusCode"] == 409
    assert len(_bookings()) == 1


@mock_aws
def test_staff_series_with_one_conflicting_date_writes_nothing():
    _create_bookings_table()
    assert _staff_book(date="2026-07-14")["statusCode"] == 201

    result = _staff_book(recurring={
        "enabled": True, "pattern": "weekly", "seriesStart": "2026-07-07", "endMode": "count", "endVal": 3,
    })
    assert result["statusCode"] == 409
    assert "2026-07-14" in json.loads(result["body"])["message"]
    assert len(_bookings()) == 1


@mock_aws
def test_staff_series_losing_a_race_mid_write_rolls_back(monkeypatch):
    _create_bookings_table()
    staff_handler.bookings_table.put_item(
        Item={"PK": "SITE#homewood", "SK": "SLOT#r5#2026-07-21#0900", "requestId": "REQ-OTHER"},
    )
    # Simulate the lock appearing after the up-front conflict check.
    monkeypatch.setattr(staff_handler, "find_slot_lock_holder", lambda pk, slot: None)

    result = _staff_book(recurring={
        "enabled": True, "pattern": "weekly", "seriesStart": "2026-07-07", "endMode": "count", "endVal": 3,
    })
    assert result["statusCode"] == 409
    assert _bookings() == []
    assert [lock["requestId"] for lock in _locks()] == ["REQ-OTHER"]


@mock_aws
def test_staff_series_creates_every_occurrence():
    _create_bookings_table()

    result = _staff_book(recurring={
        "enabled": True, "pattern": "weekly", "seriesStart": "2026-07-07", "endMode": "count", "endVal": 3,
    })
    assert result["statusCode"] == 201
    body = json.loads(result["body"])
    assert len(body["occurrences"]) == 3
    assert sorted(b["date"] for b in _bookings()) == ["2026-07-07", "2026-07-14", "2026-07-21"]
    assert all(b["seriesId"] == body["seriesId"] for b in _bookings())


@mock_aws
def test_staff_cannot_book_another_sites_room():
    _create_bookings_table()
    result = _staff_book(groups=("staff-oakland",))
    assert result["statusCode"] == 403
    assert _bookings() == []


@mock_aws
def test_staff_booking_requires_end_after_start():
    _create_bookings_table()
    assert _staff_book(start="10:00", end="09:00")["statusCode"] == 400
