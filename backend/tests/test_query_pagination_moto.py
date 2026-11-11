import importlib
import json

import boto3
import pytest
from moto import mock_aws

staff_handler = importlib.import_module("backend.lambda.requests_staff.handler")
requestor_handler = importlib.import_module("backend.lambda.requests_requestor.handler")
public_handler = importlib.import_module("backend.lambda.requests_public.handler")

EMAIL = "requestor@example.com"
STATUSES = ["pending_approval", "approved", "denied", "approved", "pending_approval"]


def _create_bookings_table():
    client = boto3.client("dynamodb", region_name="us-east-1")
    client.create_table(
        TableName="Bookings-test",
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": name, "AttributeType": "S"}
            for name in ("PK", "SK", "GSI2PK", "GSI2SK", "GSI3PK", "GSI3SK")
        ],
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": index,
                "KeySchema": [
                    {"AttributeName": f"{prefix}PK", "KeyType": "HASH"},
                    {"AttributeName": f"{prefix}SK", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
            for index, prefix in (("BySiteStatus", "GSI2"), ("ByRequestorEmail", "GSI3"))
        ],
    )


def _seed_bookings():
    for n, status in enumerate(STATUSES, start=1):
        request_id = f"REQ-{n}"
        date = f"2026-08-1{n}"
        staff_handler.bookings_table.put_item(Item={
            "PK": "SITE#homewood",
            "SK": f"ROOM#r1#DATE#{date}#REQ#{request_id}",
            "GSI2PK": "SITE#homewood",
            "GSI2SK": f"STATUS#{status}#DATE#{date}#REQ#{request_id}",
            "GSI3PK": f"REQUESTOR#{EMAIL}",
            "GSI3SK": f"DATE#{date}#REQ#{request_id}",
            "id": request_id, "site": "homewood", "room": "r1", "date": date,
            "start": "09:00", "end": "10:00", "title": "Test Meeting", "email": EMAIL, "status": status,
        })


@pytest.fixture
def one_item_pages(monkeypatch):
    """Force every bookings Query to return one item per page, standing in for
    DynamoDB's 1 MB page limit on a large partition."""
    for module in (staff_handler, requestor_handler, public_handler):
        real_query = module.bookings_table.query
        monkeypatch.setattr(module.bookings_table, "query", lambda real=real_query, **kw: real(Limit=1, **kw))


@mock_aws
def test_staff_request_list_returns_every_page(one_item_pages):
    _create_bookings_table()
    _seed_bookings()

    result = staff_handler.list_site_requests({"pathParameters": {"site": "homewood"}}, ["staff-homewood"])

    ids = {r["id"] for r in json.loads(result["body"])["requests"]}
    assert ids == {f"REQ-{n}" for n in range(1, len(STATUSES) + 1)}


@mock_aws
def test_staff_lookup_finds_request_past_the_first_page(one_item_pages):
    _create_bookings_table()
    _seed_bookings()

    # GSI2SK sorts by status first, so REQ-3 (denied) lands on the first page and
    # REQ-5 (pending_approval) on a later one.
    match = staff_handler.find_booking_by_id("REQ-5", ["homewood"])

    assert match is not None and match["id"] == "REQ-5"


@mock_aws
def test_dashboard_counts_include_every_page(one_item_pages):
    _create_bookings_table()
    _seed_bookings()

    result = staff_handler.sites_summary(["staff-homewood"])

    assert json.loads(result["body"])["sites"]["homewood"] == {
        "pending_approval": 2, "approved": 2, "denied": 1,
    }


@mock_aws
def test_my_requests_returns_every_page(one_item_pages):
    _create_bookings_table()
    _seed_bookings()

    result = requestor_handler.get_my_requests(EMAIL)

    assert len(json.loads(result["body"])["requests"]) == len(STATUSES)
    assert requestor_handler.find_owned_item(EMAIL, "REQ-5")["id"] == "REQ-5"


@mock_aws
def test_public_status_lookup_finds_request_past_the_first_page(one_item_pages):
    _create_bookings_table()
    _seed_bookings()

    result = public_handler.get_status({"pathParameters": {"id": "REQ-5"}, "queryStringParameters": {"email": EMAIL}})

    assert result["statusCode"] == 200
