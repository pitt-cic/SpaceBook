import importlib
import json

import pytest
from moto import mock_aws

from backend.tests.test_approve_conflict_moto import _create_bookings_table

staff_handler = importlib.import_module("backend.lambda.requests_staff.handler")


@pytest.fixture(autouse=True)
def _stub_env(monkeypatch):
    monkeypatch.setenv("BOOKINGS_TABLE", "Bookings-test")
    monkeypatch.setenv("SITES_TABLE", "Sites-test")
    monkeypatch.setenv("NOTIFY_FUNCTION_NAME", "notify-test")
    importlib.reload(staff_handler)


def _approved_item(request_id, room="r5", date="2026-07-14", start="10:00", end="11:00"):
    return {
        "PK": "SITE#homewood",
        "SK": f"ROOM#{room}#DATE#{date}#REQ#{request_id}",
        "GSI2PK": "SITE#homewood",
        "GSI2SK": f"STATUS#approved#DATE#{date}#REQ#{request_id}",
        "id": request_id,
        "site": "homewood",
        "room": room,
        "date": date,
        "start": start,
        "end": end,
        "org": "Test Org",
        "title": "Test Meeting",
        "email": "requestor@example.com",
        "status": "approved",
    }


def _stored(request_id, room="r5", date="2026-07-14"):
    return staff_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": f"ROOM#{room}#DATE#{date}#REQ#{request_id}"}
    )["Item"]


def _checkin(request_id):
    return staff_handler.checkin_request(
        {"pathParameters": {"id": request_id}, "queryStringParameters": None},
        ["staff-homewood"],
    )


def _no_show(request_id):
    return staff_handler.no_show_request(
        {"pathParameters": {"id": request_id}, "queryStringParameters": None},
        ["staff-homewood"],
    )


def _undo(request_id):
    return staff_handler.undo_checkin_request(
        {"pathParameters": {"id": request_id}, "queryStringParameters": None},
        ["staff-homewood"],
    )


@mock_aws
def test_checkin_sets_status_and_time():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_approved_item("REQ-1"))

    result = _checkin("REQ-1")
    assert result["statusCode"] == 200

    item = _stored("REQ-1")
    assert item["checkInStatus"] == "checked_in"
    assert "checkInTime" in item
    # Main booking status must remain 'approved' — GSI2SK unchanged
    assert item["status"] == "approved"
    assert item["GSI2SK"] == "STATUS#approved#DATE#2026-07-14#REQ#REQ-1"


@mock_aws
def test_no_show_sets_status():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_approved_item("REQ-1"))

    result = _no_show("REQ-1")
    assert result["statusCode"] == 200

    item = _stored("REQ-1")
    assert item["checkInStatus"] == "no_show"
    assert item["status"] == "approved"


@mock_aws
def test_undo_checkin_removes_checkin_status():
    _create_bookings_table()
    base = _approved_item("REQ-1")
    base["checkInStatus"] = "checked_in"
    base["checkInTime"] = "2026-07-14T10:05:00+00:00"
    staff_handler.bookings_table.put_item(Item=base)

    result = _undo("REQ-1")
    assert result["statusCode"] == 200

    item = _stored("REQ-1")
    assert "checkInStatus" not in item
    assert "checkInTime" not in item
    assert item["status"] == "approved"


@mock_aws
def test_undo_no_show_reverts_to_approved():
    _create_bookings_table()
    base = _approved_item("REQ-1")
    base["checkInStatus"] = "no_show"
    staff_handler.bookings_table.put_item(Item=base)

    result = _undo("REQ-1")
    assert result["statusCode"] == 200

    item = _stored("REQ-1")
    assert "checkInStatus" not in item
    assert item["status"] == "approved"


@mock_aws
def test_checkin_on_missing_request_returns_404():
    _create_bookings_table()
    with pytest.raises(staff_handler.ClientError) as exc:
        _checkin("REQ-NONEXISTENT")
    assert exc.value.status_code == 404


@mock_aws
def test_checkin_on_non_approved_request_returns_409():
    _create_bookings_table()
    pending = {**_approved_item("REQ-1"), "status": "pending_approval",
               "GSI2SK": "STATUS#pending_approval#DATE#2026-07-14#REQ#REQ-1"}
    staff_handler.bookings_table.put_item(Item=pending)

    with pytest.raises(staff_handler.ClientError) as exc:
        _checkin("REQ-1")
    assert exc.value.status_code == 409


@mock_aws
def test_undo_with_no_checkin_status_returns_409():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_approved_item("REQ-1"))

    with pytest.raises(staff_handler.ClientError) as exc:
        _undo("REQ-1")
    assert exc.value.status_code == 409


def _list(groups, params=None):
    return staff_handler.list_site_requests(
        {"pathParameters": {"site": "homewood"}, "queryStringParameters": params},
        groups,
    )


@mock_aws
def test_checkin_only_account_can_check_in_at_its_site():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_approved_item("REQ-1"))

    event = {"pathParameters": {"id": "REQ-1"}, "queryStringParameters": None}
    assert staff_handler.checkin_request(event, ["checkin-homewood"])["statusCode"] == 200
    assert staff_handler.undo_checkin_request(event, ["checkin-homewood"])["statusCode"] == 200
    assert staff_handler.no_show_request(event, ["checkin-homewood"])["statusCode"] == 200


@mock_aws
def test_checkin_only_account_cannot_act_at_another_site():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_approved_item("REQ-1"))

    with pytest.raises(staff_handler.ClientError) as exc:
        staff_handler.checkin_request(
            {"pathParameters": {"id": "REQ-1"}, "queryStringParameters": None},
            ["checkin-hill-district"],
        )
    assert exc.value.status_code == 404


@mock_aws
def test_checkin_only_account_cannot_manage_requests():
    _create_bookings_table()
    pending = {**_approved_item("REQ-1"), "status": "pending_approval",
               "GSI2SK": "STATUS#pending_approval#DATE#2026-07-14#REQ#REQ-1"}
    staff_handler.bookings_table.put_item(Item=pending)

    with pytest.raises(staff_handler.ClientError) as exc:
        staff_handler.get_request(
            {"pathParameters": {"id": "REQ-1"}, "queryStringParameters": None},
            ["checkin-homewood"],
        )
    assert exc.value.status_code == 403


@mock_aws
def test_checkin_only_listing_is_limited_to_approved_bookings():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_approved_item("REQ-1"))
    staff_handler.bookings_table.put_item(Item={
        **_approved_item("REQ-2", start="12:00", end="13:00"), "status": "pending_approval",
        "GSI2SK": "STATUS#pending_approval#DATE#2026-07-14#REQ#REQ-2",
    })

    body = json.loads(_list(["checkin-homewood"])["body"])
    assert [r["id"] for r in body["requests"]] == ["REQ-1"]

    with pytest.raises(staff_handler.ClientError) as exc:
        _list(["checkin-homewood"], {"status": "pending_approval"})
    assert exc.value.status_code == 403

    with pytest.raises(staff_handler.ClientError) as exc:
        _list(["checkin-hill-district"])
    assert exc.value.status_code == 403

    # Staff still see the whole queue.
    staff_body = json.loads(_list(["staff-homewood"])["body"])
    assert {r["id"] for r in staff_body["requests"]} == {"REQ-1", "REQ-2"}
