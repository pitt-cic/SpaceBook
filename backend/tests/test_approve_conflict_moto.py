import importlib
import json

import boto3
import pytest
from moto import mock_aws

staff_handler = importlib.import_module("backend.lambda.requests_staff.handler")


@pytest.fixture(autouse=True)
def _stub_notify(monkeypatch):
    # These tests are about the DynamoDB conflict-locking transaction, not
    # notification delivery — invoke_notify would otherwise fail because no
    # mock "notify-test" Lambda function exists in moto's Lambda service.
    monkeypatch.setattr(staff_handler, "invoke_notify", lambda payload: None)


def _create_bookings_table():
    client = boto3.client("dynamodb", region_name="us-east-1")
    client.create_table(
        TableName="Bookings-test",
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "SK", "AttributeType": "S"},
            {"AttributeName": "GSI2PK", "AttributeType": "S"},
            {"AttributeName": "GSI2SK", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "BySiteStatus",
                "KeySchema": [
                    {"AttributeName": "GSI2PK", "KeyType": "HASH"},
                    {"AttributeName": "GSI2SK", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )


def _pending_item(request_id, room, date, start, end):
    return {
        "PK": "SITE#homewood",
        "SK": f"ROOM#{room}#DATE#{date}#REQ#{request_id}",
        "GSI2PK": "SITE#homewood",
        "GSI2SK": f"STATUS#pending_approval#DATE#{date}#REQ#{request_id}",
        "id": request_id, "site": "homewood", "room": room, "date": date,
        "start": start, "end": end, "org": "Test Org", "title": "Test Meeting",
        "email": "requestor@example.com", "status": "pending_approval",
    }


@mock_aws
def test_approve_creates_slot_locks_and_flips_status():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-1", "r5", "2026-07-14", "09:00", "09:30"))

    result = staff_handler.approve_request({"pathParameters": {"id": "REQ-1"}}, ["staff-homewood"])
    assert result["statusCode"] == 200

    item = staff_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "ROOM#r5#DATE#2026-07-14#REQ#REQ-1"}
    )["Item"]
    assert item["status"] == "approved"

    lock = staff_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "SLOT#r5#2026-07-14#0900"}
    )["Item"]
    assert lock["requestId"] == "REQ-1"


@mock_aws
def test_approving_an_overlapping_request_conflicts_and_leaves_it_pending():
    """Core correctness requirement: two staff approving overlapping
    requests for the same room/date must not both succeed."""
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-1", "r5", "2026-07-14", "09:00", "09:30"))
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-2", "r5", "2026-07-14", "09:15", "09:45"))

    staff_handler.approve_request({"pathParameters": {"id": "REQ-1"}}, ["staff-homewood"])

    try:
        staff_handler.approve_request({"pathParameters": {"id": "REQ-2"}}, ["staff-homewood"])
        raise AssertionError("expected a 409 conflict")
    except staff_handler.ClientError as exc:
        assert exc.status_code == 409

    item = staff_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "ROOM#r5#DATE#2026-07-14#REQ#REQ-2"}
    )["Item"]
    assert item["status"] == "pending_approval"


@mock_aws
def test_approving_a_non_overlapping_request_in_the_same_room_succeeds():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-1", "r5", "2026-07-14", "09:00", "09:30"))
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-2", "r5", "2026-07-14", "09:30", "10:00"))

    staff_handler.approve_request({"pathParameters": {"id": "REQ-1"}}, ["staff-homewood"])
    result = staff_handler.approve_request({"pathParameters": {"id": "REQ-2"}}, ["staff-homewood"])
    assert result["statusCode"] == 200


@mock_aws
def test_confirm_cancellation_frees_the_slot_locks():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-1", "r5", "2026-07-14", "09:00", "09:30"))
    staff_handler.approve_request({"pathParameters": {"id": "REQ-1"}}, ["staff-homewood"])

    staff_handler.bookings_table.update_item(
        Key={"PK": "SITE#homewood", "SK": "ROOM#r5#DATE#2026-07-14#REQ#REQ-1"},
        UpdateExpression="SET #status = :status, GSI2SK = :gsi2sk",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": "cancellation_requested",
            ":gsi2sk": "STATUS#cancellation_requested#DATE#2026-07-14#REQ#REQ-1",
        },
    )

    result = staff_handler.confirm_cancellation({"pathParameters": {"id": "REQ-1"}}, ["staff-homewood"])
    assert result["statusCode"] == 200

    lock = staff_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "SLOT#r5#2026-07-14#0900"}
    )
    assert "Item" not in lock

    # The freed room/time should now be approvable again by a new request.
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-2", "r5", "2026-07-14", "09:00", "09:30"))
    result = staff_handler.approve_request({"pathParameters": {"id": "REQ-2"}}, ["staff-homewood"])
    assert result["statusCode"] == 200


def _modify(request_id, **proposal):
    return staff_handler.modify_request(
        {"pathParameters": {"id": request_id}, "body": json.dumps(proposal)}, ["staff-homewood"]
    )


@mock_aws
def test_counter_proposing_into_an_approved_slot_conflicts_and_leaves_it_pending():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-1", "r5", "2026-07-14", "09:00", "10:00"))
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-2", "r6", "2026-07-14", "09:00", "10:00"))
    staff_handler.approve_request({"pathParameters": {"id": "REQ-1"}}, ["staff-homewood"])

    # Partial overlap (09:30–10:30 against 09:00–10:00) in REQ-1's room.
    with pytest.raises(staff_handler.ClientError) as exc:
        _modify("REQ-2", room="r5", start="09:30", end="10:30")
    assert exc.value.status_code == 409

    item = staff_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "ROOM#r6#DATE#2026-07-14#REQ#REQ-2"}
    )["Item"]
    assert item["status"] == "pending_approval"
    assert "counterProposal" not in item


@mock_aws
def test_counter_proposing_a_free_adjacent_slot_succeeds():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-1", "r5", "2026-07-14", "09:00", "10:00"))
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-2", "r5", "2026-07-14", "09:00", "10:00"))
    staff_handler.approve_request({"pathParameters": {"id": "REQ-1"}}, ["staff-homewood"])

    result = _modify("REQ-2", start="10:00", end="11:00")
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["status"] == "counter_proposed"


@mock_aws
def test_counter_proposal_with_end_before_start_is_rejected():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_pending_item("REQ-1", "r5", "2026-07-14", "09:00", "10:00"))

    with pytest.raises(staff_handler.ClientError) as exc:
        _modify("REQ-1", start="11:00", end="10:00")
    assert exc.value.status_code == 400
