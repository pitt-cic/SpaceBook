import importlib
import json

import pytest
from moto import mock_aws

from backend.tests.test_approve_conflict_moto import _create_bookings_table, _pending_item
from backend.tests.test_rooms_admin_moto import _create_rooms_table

staff_handler = importlib.import_module("backend.lambda.requests_staff.handler")
notify_handler = importlib.import_module("backend.lambda.notify.handler")

DATE = "2026-07-14"


@pytest.fixture
def notified(monkeypatch):
    payloads = []
    monkeypatch.setattr(staff_handler, "invoke_notify", payloads.append)
    return payloads


def _setup():
    _create_bookings_table()
    _create_rooms_table()
    for room_id, name, active in (("r5", "Classroom 103", True), ("r6", "Conference Room 114", True),
                                  ("r7", "Old Room", False)):
        staff_handler.rooms_table.put_item(Item={"PK": "SITE#homewood", "SK": f"ROOM#{room_id}", "id": room_id,
                                                 "name": name, "active": active})
    item = _pending_item("REQ-1", "r5", DATE, "10:00", "11:00")
    item.update({"altRoom1": "r6", "GSI3PK": "REQUESTOR#requestor@example.com"})
    staff_handler.bookings_table.put_item(Item=item)


def _approve(request_id, room=None):
    event = {"pathParameters": {"id": request_id}}
    if room:
        event["body"] = json.dumps({"room": room})
    return staff_handler.approve_request(event, ["staff-homewood"])


def _get(room, request_id="REQ-1"):
    return staff_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": f"ROOM#{room}#DATE#{DATE}#REQ#{request_id}"}
    ).get("Item")


def _lock_holder(room, hhmm):
    item = staff_handler.bookings_table.get_item(Key={"PK": "SITE#homewood", "SK": f"SLOT#{room}#{DATE}#{hhmm}"})
    return item.get("Item", {}).get("requestId")


@mock_aws
def test_approve_into_another_room_moves_the_booking_and_keeps_the_first_choice(notified):
    _setup()

    result = _approve("REQ-1", room="r6")
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["room"] == "r6"

    assert _get("r5") is None
    moved = _get("r6")
    assert moved["status"] == "approved"
    assert moved["room"] == "r6"
    assert moved["requestedRoom"] == "r5"
    assert moved["altRoom1"] == "r6"
    assert moved["GSI2SK"] == f"STATUS#approved#DATE#{DATE}#REQ#REQ-1"
    assert moved["GSI3PK"] == "REQUESTOR#requestor@example.com"
    assert _lock_holder("r6", "1000") == "REQ-1"
    assert _lock_holder("r5", "1000") is None
    assert notified[0]["roomName"] == "Conference Room 114"


@mock_aws
def test_approve_into_the_first_choice_by_name_stays_in_place(notified):
    _setup()

    assert _approve("REQ-1", room="r5")["statusCode"] == 200
    item = _get("r5")
    assert item["status"] == "approved"
    assert "requestedRoom" not in item
    assert _lock_holder("r5", "1000") == "REQ-1"


@mock_aws
def test_approve_into_a_booked_room_conflicts_and_leaves_the_request_pending(notified):
    _setup()
    other = _pending_item("REQ-2", "r6", DATE, "10:30", "11:30")
    staff_handler.bookings_table.put_item(Item=other)
    _approve("REQ-2")

    with pytest.raises(staff_handler.ClientError) as exc:
        _approve("REQ-1", room="r6")
    assert exc.value.status_code == 409
    assert _get("r5")["status"] == "pending_approval"
    assert _get("r6") is None


@pytest.mark.parametrize("room", ["r7", "r99"])
@mock_aws
def test_approve_rejects_an_inactive_or_unknown_room(notified, room):
    _setup()

    with pytest.raises(staff_handler.ClientError) as exc:
        _approve("REQ-1", room=room)
    assert exc.value.status_code == 400
    assert _get("r5")["status"] == "pending_approval"


def test_approved_email_names_the_assigned_room():
    _, body = notify_handler.render("approved", {"title": "Talk", "id": "REQ-1", "date": DATE, "start": "10:00",
                                                 "end": "11:00"}, None, "Conference Room 114")
    assert body.endswith("has been approved in Conference Room 114.")
