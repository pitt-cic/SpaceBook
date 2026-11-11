import importlib
import json

import boto3
from moto import mock_aws

rooms_admin_handler = importlib.import_module("backend.lambda.rooms_admin.handler")


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


def _create_staff_pool(monkeypatch):
    client = boto3.client("cognito-idp", region_name="us-east-1")
    pool_id = client.create_user_pool(PoolName="staff-pool-test")["UserPool"]["Id"]
    monkeypatch.setattr(rooms_admin_handler, "STAFF_USER_POOL_ID", pool_id)
    return client, pool_id


def _event(method, resource, path_params=None, body=None, groups=("admin",)):
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
def test_create_site_succeeds_and_produces_the_row_and_both_cognito_groups(monkeypatch):
    _create_sites_table()
    client, pool_id = _create_staff_pool(monkeypatch)

    result = rooms_admin_handler.handler(
        _event("POST", "/api/sites", body={"label": "Hill District"}), None,
    )
    assert result["statusCode"] == 201
    body = json.loads(result["body"])
    assert body["id"] == "hill-district"
    assert body["label"] == "Hill District"
    assert body["active"] is True
    assert body["createdBy"] == "admin@example.com"

    item = rooms_admin_handler.sites_table.get_item(
        Key={"PK": "SITE#hill-district", "SK": "CONFIG"}
    )["Item"]
    assert item["label"] == "Hill District"

    group_names = {g["GroupName"] for g in client.list_groups(UserPoolId=pool_id)["Groups"]}
    assert {"staff-hill-district", "checkin-hill-district"} <= group_names


@mock_aws
def test_duplicate_site_id_creation_is_rejected(monkeypatch):
    _create_sites_table()
    _create_staff_pool(monkeypatch)

    first = rooms_admin_handler.handler(_event("POST", "/api/sites", body={"label": "Hill District"}), None)
    assert first["statusCode"] == 201

    second = rooms_admin_handler.handler(_event("POST", "/api/sites", body={"label": "Hill District"}), None)
    assert second["statusCode"] == 409


@mock_aws
def test_partial_cognito_failure_rolls_back_the_site_row_and_a_retry_recovers(monkeypatch):
    _create_sites_table()
    client, pool_id = _create_staff_pool(monkeypatch)

    real_create_group_idempotent = rooms_admin_handler.create_group_idempotent

    def flaky_create_group(group_name):
        if group_name.startswith("checkin-"):
            raise RuntimeError("simulated Cognito outage")
        real_create_group_idempotent(group_name)

    monkeypatch.setattr(rooms_admin_handler, "create_group_idempotent", flaky_create_group)

    failed = rooms_admin_handler.handler(_event("POST", "/api/sites", body={"label": "Hazelwood"}), None)
    assert failed["statusCode"] == 502

    # The Sites row was rolled back, but the group created before the
    # failure (staff-hazelwood) is intentionally left in place.
    rolled_back = rooms_admin_handler.sites_table.get_item(Key={"PK": "SITE#hazelwood", "SK": "CONFIG"})
    assert "Item" not in rolled_back
    group_names = {g["GroupName"] for g in client.list_groups(UserPoolId=pool_id)["Groups"]}
    assert "staff-hazelwood" in group_names
    assert "checkin-hazelwood" not in group_names

    # A plain retry of the same create is a full, safe recovery: the row
    # write succeeds again (no leftover row), and re-creating the
    # already-existing staff-hazelwood group is tolerated rather than raised.
    monkeypatch.setattr(rooms_admin_handler, "create_group_idempotent", real_create_group_idempotent)
    retried = rooms_admin_handler.handler(_event("POST", "/api/sites", body={"label": "Hazelwood"}), None)
    assert retried["statusCode"] == 201

    group_names = {g["GroupName"] for g in client.list_groups(UserPoolId=pool_id)["Groups"]}
    assert {"staff-hazelwood", "checkin-hazelwood"} <= group_names


@mock_aws
def test_update_site_edits_label_color_and_can_deactivate(monkeypatch):
    _create_sites_table()
    _create_staff_pool(monkeypatch)
    rooms_admin_handler.handler(_event("POST", "/api/sites", body={"label": "Hill District"}), None)

    edited = rooms_admin_handler.handler(
        _event("PUT", "/api/sites/{site}", {"site": "hill-district"}, body={"color": "#112233"}),
        None,
    )
    assert edited["statusCode"] == 200
    assert json.loads(edited["body"])["color"] == "#112233"

    deactivated = rooms_admin_handler.handler(
        _event("PUT", "/api/sites/{site}", {"site": "hill-district"}, body={"active": False}),
        None,
    )
    assert deactivated["statusCode"] == 200
    assert json.loads(deactivated["body"])["active"] is False


@mock_aws
def test_update_unknown_site_is_rejected(monkeypatch):
    _create_sites_table()
    _create_staff_pool(monkeypatch)

    result = rooms_admin_handler.handler(
        _event("PUT", "/api/sites/{site}", {"site": "nowhere"}, body={"active": False}), None,
    )
    assert result["statusCode"] == 404


@mock_aws
def test_list_sites_is_public_and_needs_no_admin_claim():
    _create_sites_table()

    result = rooms_admin_handler.handler(
        {"httpMethod": "GET", "resource": "/api/sites", "pathParameters": None, "body": None, "requestContext": {}},
        None,
    )
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["sites"] == []


@mock_aws
def test_non_admin_caller_cannot_create_a_site(monkeypatch):
    _create_sites_table()
    _create_staff_pool(monkeypatch)

    result = rooms_admin_handler.handler(
        _event("POST", "/api/sites", body={"label": "Nope"}, groups=("staff-homewood",)), None,
    )
    assert result["statusCode"] == 403
