import importlib
import json

import boto3
from moto import mock_aws

rooms_admin_handler = importlib.import_module("backend.lambda.rooms_admin.handler")
rooms_handler = importlib.import_module("backend.lambda.rooms.handler")


def _create_rooms_table():
    client = boto3.client("dynamodb", region_name="us-east-1")
    client.create_table(
        TableName="Rooms-test",
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


def _event(method, resource, path_params, body=None, groups=("admin",)):
    return {
        "httpMethod": method,
        "resource": resource,
        "pathParameters": path_params,
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {
            "authorizer": {"claims": {"cognito:groups": ",".join(groups), "email": "admin@example.com"}}
        },
    }


@mock_aws
def test_create_room_succeeds_and_produces_a_retrievable_room():
    _create_rooms_table()
    event = _event(
        "POST", "/api/sites/{site}/rooms", {"site": "homewood"},
        body={"name": "Test Room", "floor": "1st Floor", "capacity": 10},
    )

    result = rooms_admin_handler.handler(event, None)
    assert result["statusCode"] == 201
    room_id = json.loads(result["body"])["id"]

    item = rooms_admin_handler.rooms_table.get_item(
        Key={"PK": "SITE#homewood", "SK": f"ROOM#{room_id}"}
    )["Item"]
    assert item["name"] == "Test Room"
    assert item["capacity"] == 10
    assert item["active"] is True
    assert item["createdBy"] == "admin@example.com"


@mock_aws
def test_duplicate_id_create_is_rejected_by_the_conditional_write_guard(monkeypatch):
    _create_rooms_table()
    monkeypatch.setattr(rooms_admin_handler, "generate_room_id", lambda: "r-fixed")
    event = _event("POST", "/api/sites/{site}/rooms", {"site": "homewood"}, body={"name": "Room One"})

    first = rooms_admin_handler.handler(event, None)
    assert first["statusCode"] == 201

    second = rooms_admin_handler.handler(event, None)
    assert second["statusCode"] == 409


@mock_aws
def test_update_room_sets_active_false_and_public_listing_excludes_it():
    _create_rooms_table()
    created = json.loads(rooms_admin_handler.handler(
        _event("POST", "/api/sites/{site}/rooms", {"site": "homewood"}, body={"name": "Room To Deactivate"}),
        None,
    )["body"])
    room_id = created["id"]

    listing_before = json.loads(rooms_handler.handler(
        {"httpMethod": "GET", "resource": "/api/sites/{site}/rooms", "pathParameters": {"site": "homewood"}}, None,
    )["body"])
    assert any(r["id"] == room_id for r in listing_before["rooms"])

    update_result = rooms_admin_handler.handler(
        _event(
            "PUT", "/api/sites/{site}/rooms/{roomId}", {"site": "homewood", "roomId": room_id},
            body={"active": False},
        ),
        None,
    )
    assert update_result["statusCode"] == 200
    assert json.loads(update_result["body"])["active"] is False

    listing_after = json.loads(rooms_handler.handler(
        {"httpMethod": "GET", "resource": "/api/sites/{site}/rooms", "pathParameters": {"site": "homewood"}}, None,
    )["body"])
    assert all(r["id"] != room_id for r in listing_after["rooms"])

    admin_listing = json.loads(rooms_admin_handler.handler(
        _event("GET", "/api/admin/sites/{site}/rooms", {"site": "homewood"}), None,
    )["body"])
    deactivated = next(r for r in admin_listing["rooms"] if r["id"] == room_id)
    assert deactivated["active"] is False


@mock_aws
def test_non_admin_caller_is_rejected():
    _create_rooms_table()
    event = _event(
        "POST", "/api/sites/{site}/rooms", {"site": "homewood"},
        body={"name": "Nope"}, groups=("staff-homewood",),
    )
    result = rooms_admin_handler.handler(event, None)
    assert result["statusCode"] == 403

