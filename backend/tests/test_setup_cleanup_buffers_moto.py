import importlib
import json

import pytest
from moto import mock_aws

from backend.tests.test_accept_counter_proposal_moto import _create_bookings_table as _create_table_with_requestor_index
from backend.tests.test_approve_conflict_moto import _create_bookings_table, _pending_item

staff_handler = importlib.import_module("backend.lambda.requests_staff.handler")
requestor_handler = importlib.import_module("backend.lambda.requests_requestor.handler")
public_handler = importlib.import_module("backend.lambda.requests_public.handler")

DATE = "2026-07-14"


@pytest.fixture(autouse=True)
def _stub_notify(monkeypatch):
    for module in (staff_handler, requestor_handler, public_handler):
        monkeypatch.setattr(module, "invoke_notify", lambda payload: None)


def _put_pending(request_id, start, end, setup=None, cleanup=None):
    item = _pending_item(request_id, "r5", DATE, start, end)
    item.update({"setupTime": setup, "cleanupTime": cleanup})
    staff_handler.bookings_table.put_item(Item=item)


def _approve(request_id):
    return staff_handler.approve_request({"pathParameters": {"id": request_id}}, ["staff-homewood"])


def _lock_holder(hhmm):
    item = staff_handler.bookings_table.get_item(Key={"PK": "SITE#homewood", "SK": f"SLOT#r5#{DATE}#{hhmm}"})
    return item.get("Item", {}).get("requestId")


@pytest.mark.parametrize("module", [staff_handler, requestor_handler, public_handler])
def test_reserved_window_wraps_the_event_in_its_buffers(module):
    assert module.reserved_window({"start": "10:00", "end": "11:00"}) == ("10:00", "11:00")
    assert module.reserved_window(
        {"start": "10:00", "end": "11:00", "setupTime": "45 min", "cleanupTime": "15 min"}
    ) == ("09:15", "11:15")
    assert module.reserved_window(
        {"start": "10:00", "end": "11:00", "setupTime": "1 hour", "cleanupTime": "None"}
    ) == ("09:00", "11:00")
    # Clamped to the day.
    assert module.reserved_window({"start": "00:15", "end": "23:45", "setupTime": "30 min",
                                   "cleanupTime": "30 min"}) == ("00:00", "24:00")


@mock_aws
def test_approve_locks_the_setup_and_cleanup_slots():
    _create_bookings_table()
    _put_pending("REQ-1", "10:00", "11:00", setup="30 min", cleanup="15 min")

    assert _approve("REQ-1")["statusCode"] == 200
    for hhmm in ("0930", "0945", "1000", "1045", "1100"):
        assert _lock_holder(hhmm) == "REQ-1"
    assert _lock_holder("0915") is None
    assert _lock_holder("1115") is None


@mock_aws
def test_a_booking_overlapping_only_the_buffer_conflicts():
    _create_bookings_table()
    _put_pending("REQ-1", "10:00", "11:00", cleanup="30 min")
    _put_pending("REQ-2", "11:15", "12:00")
    _approve("REQ-1")

    with pytest.raises(staff_handler.ClientError) as exc:
        _approve("REQ-2")
    assert exc.value.status_code == 409


@mock_aws
def test_counter_proposal_conflict_check_includes_the_buffers():
    _create_bookings_table()
    _put_pending("REQ-1", "09:00", "10:00")
    _put_pending("REQ-2", "13:00", "14:00", setup="30 min")
    _approve("REQ-1")

    # 10:15 is free for the event itself, but its 30-min setup reaches 09:45.
    with pytest.raises(staff_handler.ClientError) as exc:
        staff_handler.modify_request(
            {"pathParameters": {"id": "REQ-2"}, "body": json.dumps({"start": "10:15", "end": "11:00"})},
            ["staff-homewood"],
        )
    assert exc.value.status_code == 409


@mock_aws
def test_confirm_cancellation_releases_only_its_own_locks():
    """A booking approved before buffers were locked holds only event-time
    slots; releasing it must not delete a neighbour's lock on its buffer."""
    _create_bookings_table()
    _put_pending("REQ-NEIGHBOUR", "09:30", "10:00")
    _approve("REQ-NEIGHBOUR")
    legacy = _pending_item("REQ-LEGACY", "r5", DATE, "10:00", "11:00")
    legacy.update({"setupTime": "30 min", "status": "cancellation_requested"})
    staff_handler.bookings_table.put_item(Item=legacy)
    for slot_key in staff_handler.compute_slot_keys("r5", DATE, "10:00", "11:00"):
        staff_handler.bookings_table.put_item(Item={"PK": "SITE#homewood", "SK": slot_key, "requestId": "REQ-LEGACY"})

    result = staff_handler.confirm_cancellation({"pathParameters": {"id": "REQ-LEGACY"}}, ["staff-homewood"])
    assert result["statusCode"] == 200
    assert _lock_holder("1000") is None
    assert _lock_holder("0930") == "REQ-NEIGHBOUR"
    assert _lock_holder("0945") == "REQ-NEIGHBOUR"


@mock_aws
def test_accepting_a_counter_proposal_locks_the_buffers_around_the_new_time():
    _create_table_with_requestor_index()
    item = _pending_item("REQ-1", "r5", DATE, "09:00", "10:00")
    item.update({
        "status": "counter_proposed", "setupTime": "15 min", "cleanupTime": "15 min",
        "GSI3PK": "REQUESTOR#requestor@example.com", "GSI3SK": f"DATE#{DATE}#REQ#REQ-1",
        "counterProposal": {"room": "r5", "date": DATE, "start": "13:00", "end": "14:00"},
    })
    requestor_handler.bookings_table.put_item(Item=item)

    result = requestor_handler.accept_counter_proposal({"pathParameters": {"id": "REQ-1"}}, "requestor@example.com")
    assert result["statusCode"] == 200
    assert _lock_holder("1245") == "REQ-1"
    assert _lock_holder("1400") == "REQ-1"
    assert _lock_holder("1415") is None


@mock_aws
def test_availability_reports_the_reserved_window_and_the_event_time():
    _create_bookings_table()
    _put_pending("REQ-1", "10:00", "11:00", setup="45 min", cleanup="30 min")
    _approve("REQ-1")

    result = public_handler.handler(
        {"httpMethod": "GET", "resource": "/api/sites/{site}/availability",
         "pathParameters": {"site": "homewood"}, "queryStringParameters": {"date": DATE}},
        None,
    )
    assert json.loads(result["body"])["bookings"] == [{
        "room": "r5", "id": "REQ-1", "start": "09:15", "end": "11:30", "eventStart": "10:00", "eventEnd": "11:00",
    }]
