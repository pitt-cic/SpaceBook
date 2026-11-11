import importlib

import boto3
import pytest
from moto import mock_aws

requestor_handler = importlib.import_module("backend.lambda.requests_requestor.handler")


def _create_bookings_table():
    client = boto3.client("dynamodb", region_name="us-east-1")
    client.create_table(
        TableName="Bookings-test",
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "SK", "AttributeType": "S"},
            {"AttributeName": "GSI3PK", "AttributeType": "S"},
            {"AttributeName": "GSI3SK", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "ByRequestorEmail",
                "KeySchema": [
                    {"AttributeName": "GSI3PK", "KeyType": "HASH"},
                    {"AttributeName": "GSI3SK", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )


def _counter_proposed_item(request_id, room, date, start, end, proposal):
    return {
        "PK": "SITE#homewood",
        "SK": f"ROOM#{room}#DATE#{date}#REQ#{request_id}",
        "GSI3PK": "REQUESTOR#requestor@example.com",
        "GSI3SK": f"DATE#{date}#REQ#{request_id}",
        "id": request_id, "site": "homewood", "room": room, "date": date,
        "start": start, "end": end, "org": "Test Org", "title": "Test Meeting",
        "email": "requestor@example.com", "status": "counter_proposed",
        "counterProposal": proposal,
    }


def _put_approved_slot_lock(room, date, start, end, request_id):
    for slot_key in requestor_handler.compute_slot_keys(room, date, start, end):
        requestor_handler.bookings_table.put_item(Item={
            "PK": "SITE#homewood", "SK": slot_key, "requestId": request_id,
        })


@pytest.fixture(autouse=True)
def _stub_notify(monkeypatch):
    monkeypatch.setattr(requestor_handler, "invoke_notify", lambda payload: None)


@mock_aws
def test_accept_moves_the_booking_to_the_proposed_slot():
    _create_bookings_table()
    proposal = {"room": "r5", "date": "2026-07-21", "start": "10:00", "end": "10:30", "message": "how about this?"}
    requestor_handler.bookings_table.put_item(
        Item=_counter_proposed_item("REQ-1", "r5", "2026-07-14", "09:00", "09:30", proposal)
    )

    result = requestor_handler.accept_counter_proposal(
        {"pathParameters": {"id": "REQ-1"}}, "requestor@example.com",
    )
    assert result["statusCode"] == 200

    old_key = requestor_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "ROOM#r5#DATE#2026-07-14#REQ#REQ-1"}
    )
    assert "Item" not in old_key

    new_item = requestor_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "ROOM#r5#DATE#2026-07-21#REQ#REQ-1"}
    )["Item"]
    assert new_item["status"] == "approved"
    assert new_item["date"] == "2026-07-21"
    assert "counterProposal" not in new_item

    lock = requestor_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "SLOT#r5#2026-07-21#1000"}
    )
    assert "Item" in lock


@mock_aws
def test_accept_time_only_change_keeps_same_room_and_date():
    # Regression: a time-only counter-proposal (same room + same date) leaves
    # the item's PK/SK unchanged. The old code issued a Delete + Put on that
    # same key in one transaction, which real DynamoDB rejects with a
    # ValidationException — surfacing in the browser as "Failed to fetch".
    _create_bookings_table()
    proposal = {"room": "r5", "date": "2026-07-14", "start": "11:00", "end": "11:30", "message": "later that day?"}
    requestor_handler.bookings_table.put_item(
        Item=_counter_proposed_item("REQ-1", "r5", "2026-07-14", "09:00", "09:30", proposal)
    )

    result = requestor_handler.accept_counter_proposal(
        {"pathParameters": {"id": "REQ-1"}}, "requestor@example.com",
    )
    assert result["statusCode"] == 200

    item = requestor_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "ROOM#r5#DATE#2026-07-14#REQ#REQ-1"}
    )["Item"]
    assert item["status"] == "approved"
    assert item["start"] == "11:00" and item["end"] == "11:30"
    assert "counterProposal" not in item

    lock = requestor_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "SLOT#r5#2026-07-14#1100"}
    )
    assert "Item" in lock


@mock_aws
def test_accept_conflicts_when_the_proposed_slot_is_already_taken():
    _create_bookings_table()
    proposal = {"room": "r5", "date": "2026-07-21", "start": "10:00", "end": "10:30"}
    requestor_handler.bookings_table.put_item(
        Item=_counter_proposed_item("REQ-1", "r5", "2026-07-14", "09:00", "09:30", proposal)
    )
    # Someone else already holds the proposed slot.
    _put_approved_slot_lock("r5", "2026-07-21", "10:00", "10:30", "REQ-OTHER")

    try:
        requestor_handler.accept_counter_proposal(
            {"pathParameters": {"id": "REQ-1"}}, "requestor@example.com",
        )
        raise AssertionError("expected a 409 conflict")
    except requestor_handler.ClientError as exc:
        assert exc.status_code == 409

    # Atomicity: the original booking must still exist, untouched.
    old_item = requestor_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "ROOM#r5#DATE#2026-07-14#REQ#REQ-1"}
    )["Item"]
    assert old_item["status"] == "counter_proposed"
