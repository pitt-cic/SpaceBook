import importlib

from moto import mock_aws

from backend.tests.test_accept_counter_proposal_moto import _create_bookings_table

requestor_handler = importlib.import_module("backend.lambda.requests_requestor.handler")


def _item(request_id, status):
    return {
        "PK": "SITE#homewood",
        "SK": f"ROOM#r5#DATE#2026-07-14#REQ#{request_id}",
        "GSI3PK": "REQUESTOR#requestor@example.com",
        "GSI3SK": f"DATE#2026-07-14#REQ#{request_id}",
        "id": request_id, "site": "homewood", "room": "r5", "date": "2026-07-14",
        "start": "09:00", "end": "09:30", "org": "Test Org", "title": "Test Meeting",
        "email": "requestor@example.com", "status": status,
    }


def _cancel(request_id):
    return requestor_handler.cancel_request(
        {"pathParameters": {"id": request_id}}, "requestor@example.com",
    )


def _stored(request_id):
    return requestor_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": f"ROOM#r5#DATE#2026-07-14#REQ#{request_id}"}
    )["Item"]


@mock_aws
def test_pending_request_is_cancelled_outright():
    _create_bookings_table()
    requestor_handler.bookings_table.put_item(Item=_item("REQ-1", "pending_approval"))

    result = _cancel("REQ-1")
    assert result["statusCode"] == 200

    item = _stored("REQ-1")
    assert item["status"] == "cancelled"
    assert item["GSI2SK"] == "STATUS#cancelled#DATE#2026-07-14#REQ#REQ-1"


@mock_aws
def test_approved_request_still_goes_through_staff_confirmation():
    _create_bookings_table()
    requestor_handler.bookings_table.put_item(Item=_item("REQ-1", "approved"))

    _cancel("REQ-1")
    assert _stored("REQ-1")["status"] == "cancellation_requested"


@mock_aws
def test_cancel_conflicts_if_status_changed_since_read(monkeypatch):
    _create_bookings_table()
    requestor_handler.bookings_table.put_item(Item=_item("REQ-1", "pending_approval"))

    # Simulate staff approving between the requestor's read and write.
    real_find = requestor_handler.find_owned_item

    def find_then_approve(email, request_id):
        item = real_find(email, request_id)
        requestor_handler.bookings_table.update_item(
            Key={"PK": item["PK"], "SK": item["SK"]},
            UpdateExpression="SET #status = :s",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={":s": "approved"},
        )
        return item

    monkeypatch.setattr(requestor_handler, "find_owned_item", find_then_approve)
    try:
        _cancel("REQ-1")
        raise AssertionError("expected a 409 conflict")
    except requestor_handler.ClientError as exc:
        assert exc.status_code == 409
    assert _stored("REQ-1")["status"] == "approved"
