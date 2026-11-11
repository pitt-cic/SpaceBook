import importlib
import json

import boto3
from moto import mock_aws

staff_admin_handler = importlib.import_module("backend.lambda.staff_admin.handler")

GROUPS = ["admin", "staff-homewood", "checkin-homewood"]


def _setup_pool_and_user(monkeypatch, username="jane@example.com", initial_groups=()):
    client = boto3.client("cognito-idp", region_name="us-east-1")
    pool_id = client.create_user_pool(PoolName="staff-pool-test")["UserPool"]["Id"]
    monkeypatch.setattr(staff_admin_handler, "STAFF_USER_POOL_ID", pool_id)

    for group in GROUPS:
        client.create_group(UserPoolId=pool_id, GroupName=group)

    client.admin_create_user(
        UserPoolId=pool_id,
        Username=username,
        UserAttributes=[{"Name": "email", "Value": username}],
        MessageAction="SUPPRESS",
    )
    for group in initial_groups:
        client.admin_add_user_to_group(UserPoolId=pool_id, Username=username, GroupName=group)

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
def test_listing_returns_real_group_memberships(monkeypatch):
    _setup_pool_and_user(monkeypatch, username="jane@example.com", initial_groups=["staff-homewood"])

    result = staff_admin_handler.handler(_event("GET", "/api/admin/staff"), None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert set(body["availableGroups"]) == set(GROUPS)
    jane = next(u for u in body["staff"] if u["email"] == "jane@example.com")
    assert jane["groups"] == ["staff-homewood"]


@mock_aws
def test_granting_a_valid_group_succeeds(monkeypatch):
    _setup_pool_and_user(monkeypatch, username="jane@example.com")

    result = staff_admin_handler.handler(
        _event(
            "PUT", "/api/admin/staff/{username}/groups", {"username": "jane@example.com"},
            body={"groups": ["staff-homewood"]},
        ),
        None,
    )
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["groups"] == ["staff-homewood"]


@mock_aws
def test_granting_an_unknown_group_name_is_rejected(monkeypatch):
    _setup_pool_and_user(monkeypatch, username="jane@example.com")

    result = staff_admin_handler.handler(
        _event(
            "PUT", "/api/admin/staff/{username}/groups", {"username": "jane@example.com"},
            body={"groups": ["staff-nonexistent"]},
        ),
        None,
    )
    assert result["statusCode"] == 400


@mock_aws
def test_revoking_removes_membership(monkeypatch):
    client, pool_id = _setup_pool_and_user(
        monkeypatch, username="jane@example.com", initial_groups=["staff-homewood", "checkin-homewood"],
    )

    result = staff_admin_handler.handler(
        _event(
            "PUT", "/api/admin/staff/{username}/groups", {"username": "jane@example.com"},
            body={"groups": ["staff-homewood"]},
        ),
        None,
    )
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["groups"] == ["staff-homewood"]

    remaining = client.admin_list_groups_for_user(UserPoolId=pool_id, Username="jane@example.com")
    assert [g["GroupName"] for g in remaining["Groups"]] == ["staff-homewood"]


@mock_aws
def test_non_admin_caller_is_rejected(monkeypatch):
    _setup_pool_and_user(monkeypatch, username="jane@example.com")

    result = staff_admin_handler.handler(_event("GET", "/api/admin/staff", groups=("staff-homewood",)), None)
    assert result["statusCode"] == 403


def _setup_email_username_pool(monkeypatch):
    # Mirrors auth-constructs.ts's StaffUserPool: signInAliases {email} makes
    # email the username attribute, so Cognito generates the actual username.
    client = boto3.client("cognito-idp", region_name="us-east-1")
    pool_id = client.create_user_pool(PoolName="staff-pool-test", UsernameAttributes=["email"])["UserPool"]["Id"]
    monkeypatch.setattr(staff_admin_handler, "STAFF_USER_POOL_ID", pool_id)
    for group in GROUPS + ["staff-oakland"]:
        client.create_group(UserPoolId=pool_id, GroupName=group)
    return client, pool_id


def _create(body, groups=("admin",)):
    return staff_admin_handler.handler(_event("POST", "/api/admin/staff", body=body, groups=groups), None)


@mock_aws
def test_creating_staff_invites_user_and_grants_groups(monkeypatch):
    client, pool_id = _setup_email_username_pool(monkeypatch)

    result = _create({"email": " New.Person@Example.com ", "groups": ["staff-homewood", "staff-oakland"]})
    assert result["statusCode"] == 201
    body = json.loads(result["body"])
    assert body["email"] == "new.person@example.com"
    assert body["status"] == "FORCE_CHANGE_PASSWORD"
    assert body["groups"] == ["staff-homewood", "staff-oakland"]

    user = client.admin_get_user(UserPoolId=pool_id, Username="new.person@example.com")
    attrs = {a["Name"]: a["Value"] for a in user["UserAttributes"]}
    assert attrs["email_verified"] == "true"
    groups = client.admin_list_groups_for_user(UserPoolId=pool_id, Username=user["Username"])
    assert sorted(g["GroupName"] for g in groups["Groups"]) == ["staff-homewood", "staff-oakland"]


@mock_aws
def test_creating_a_duplicate_email_is_a_conflict(monkeypatch):
    _setup_email_username_pool(monkeypatch)

    assert _create({"email": "jane@example.com", "groups": ["staff-homewood"]})["statusCode"] == 201
    result = _create({"email": "JANE@example.com", "groups": ["staff-oakland"]})
    assert result["statusCode"] == 409


@mock_aws
def test_creating_with_admin_or_non_staff_group_is_rejected(monkeypatch):
    client, pool_id = _setup_email_username_pool(monkeypatch)

    for groups in (["admin"], ["staff-homewood", "admin"], ["checkin-homewood"]):
        result = _create({"email": "jane@example.com", "groups": groups})
        assert result["statusCode"] == 400, groups
    assert client.list_users(UserPoolId=pool_id)["Users"] == []


@mock_aws
def test_creating_with_invalid_input_is_rejected(monkeypatch):
    client, pool_id = _setup_email_username_pool(monkeypatch)

    for body in (
        {"email": "not-an-email", "groups": ["staff-homewood"]},
        {"groups": ["staff-homewood"]},
        {"email": "jane@example.com", "groups": []},
        {"email": "jane@example.com", "groups": "staff-homewood"},
        {"email": "jane@example.com", "groups": ["staff-nonexistent"]},
    ):
        assert _create(body)["statusCode"] == 400, body
    assert client.list_users(UserPoolId=pool_id)["Users"] == []


@mock_aws
def test_non_admin_caller_cannot_create_staff(monkeypatch):
    client, pool_id = _setup_email_username_pool(monkeypatch)

    result = _create({"email": "jane@example.com", "groups": ["staff-homewood"]}, groups=("staff-homewood",))
    assert result["statusCode"] == 403
    assert client.list_users(UserPoolId=pool_id)["Users"] == []


@mock_aws
def test_group_grant_failure_after_create_reports_partial_account(monkeypatch):
    client, pool_id = _setup_email_username_pool(monkeypatch)
    # Simulates a group deleted between validation and the grant.
    monkeypatch.setattr(
        staff_admin_handler, "list_known_groups", lambda: GROUPS + ["staff-oakland", "staff-deleted"],
    )

    result = _create({"email": "jane@example.com", "groups": ["staff-deleted"]})
    assert result["statusCode"] == 500
    assert "was created" in json.loads(result["body"])["message"]
    assert len(client.list_users(UserPoolId=pool_id)["Users"]) == 1
