import importlib
import json

import boto3
from moto import mock_aws

staff_handler = importlib.import_module("backend.lambda.requests_staff.handler")


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


def _create_sites_table():
    client = boto3.client("dynamodb", region_name="us-east-1")
    client.create_table(
        TableName="Sites-test",
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "SK", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
    )


def _add_site(site_id, active=True):
    staff_handler.sites_table.put_item(Item={
        "PK": f"SITE#{site_id}",
        "SK": "CONFIG",
        "id": site_id,
        "label": site_id.replace("_", " ").title(),
        "color": "#003594",
        "active": active,
    })


def _booking(site, request_id, status):
    return {
        "PK": f"SITE#{site}",
        "SK": f"ROOM#r1#DATE#2026-08-10#REQ#{request_id}",
        "GSI2PK": f"SITE#{site}",
        "GSI2SK": f"STATUS#{status}#DATE#2026-08-10#REQ#{request_id}",
        "id": request_id,
        "site": site,
        "status": status,
    }


@mock_aws
def test_admin_caller_still_gets_every_known_site():
    _create_bookings_table()
    _create_sites_table()
    _add_site("homewood")
    _add_site("hill_district")
    staff_handler.bookings_table.put_item(Item=_booking("homewood", "REQ-1", "approved"))

    result = staff_handler.sites_summary(["admin"])
    assert result["statusCode"] == 200

    body = json.loads(result["body"])
    assert set(body["sites"].keys()) == {"homewood", "hill_district"}
    assert body["sites"]["homewood"] == {"approved": 1}


@mock_aws
def test_non_admin_staff_caller_is_scoped_to_their_own_site_only():
    """UI redesign decision #6: a scoped staff account gets stats for its own
    sites, not a 403 — and never sees another site's data even if that other
    site has bookings."""
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_booking("homewood", "REQ-1", "approved"))
    staff_handler.bookings_table.put_item(Item=_booking("hill_district", "REQ-2", "pending_approval"))
    staff_handler.bookings_table.put_item(Item=_booking("hill_district", "REQ-3", "pending_approval"))

    result = staff_handler.sites_summary(["staff-hill_district"])
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert set(body["sites"].keys()) == {"hill_district"}
    assert body["sites"]["hill_district"] == {"pending_approval": 2}


@mock_aws
def test_checkin_only_caller_is_scoped_to_their_own_site():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_booking("hazelwood", "REQ-1", "denied"))

    result = staff_handler.sites_summary(["checkin-hazelwood"])
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["sites"] == {"hazelwood": {"denied": 1}}


@mock_aws
def test_caller_with_multiple_site_groups_sees_all_of_their_sites():
    _create_bookings_table()
    staff_handler.bookings_table.put_item(Item=_booking("homewood", "REQ-1", "approved"))
    staff_handler.bookings_table.put_item(Item=_booking("hill_district", "REQ-2", "denied"))

    result = staff_handler.sites_summary(["staff-homewood", "staff-hill_district"])
    body = json.loads(result["body"])
    assert set(body["sites"].keys()) == {"homewood", "hill_district"}


@mock_aws
def test_caller_with_no_site_membership_gets_403_not_admin_data():
    _create_bookings_table()

    try:
        staff_handler.sites_summary([])
        raise AssertionError("expected a 403")
    except staff_handler.ClientError as exc:
        assert exc.status_code == 403
