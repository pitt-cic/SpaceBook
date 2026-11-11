import importlib
import json

from moto import mock_aws

from backend.tests.test_accept_counter_proposal_moto import _create_bookings_table

requestor_handler = importlib.import_module("backend.lambda.requests_requestor.handler")


def _item(request_id, email):
    return {
        "PK": "SITE#homewood",
        "SK": f"ROOM#r5#DATE#2026-07-14#REQ#{request_id}",
        "GSI3PK": f"REQUESTOR#{email}",
        "GSI3SK": f"DATE#2026-07-14#REQ#{request_id}",
        "id": request_id, "site": "homewood", "room": "r5", "date": "2026-07-14",
        "start": "09:00", "end": "09:30", "org": "Test Org", "title": "Test Meeting",
        "email": email, "status": "pending_approval",
    }


def _event(resource, method="GET", request_id=None, **claims):
    # Mirrors what API Gateway's REST Cognito authorizer passes: string claims.
    return {
        "httpMethod": method,
        "resource": resource,
        "pathParameters": {"id": request_id} if request_id else None,
        "requestContext": {"authorizer": {"claims": claims}},
    }


def _seed_two_requestors():
    _create_bookings_table()
    requestor_handler.bookings_table.put_item(Item=_item("REQ-ALICE", "alice@example.com"))
    requestor_handler.bookings_table.put_item(Item=_item("REQ-BOB", "bob@example.com"))


@mock_aws
def test_my_requests_returns_only_the_callers_own_requests():
    _seed_two_requestors()

    result = requestor_handler.handler(
        _event("/api/my-requests", email="alice@example.com", email_verified="true"), None,
    )

    assert result["statusCode"] == 200
    ids = [r["id"] for r in json.loads(result["body"])["requests"]]
    assert ids == ["REQ-ALICE"]


@mock_aws
def test_unverified_case_variant_of_another_email_is_rejected():
    """The attack: a requestor rewrites their own email to an upper-cased copy
    of someone else's (the pool is case-sensitive, so Cognito accepts it,
    unverified). Lowercased, it would match the victim's GSI3PK."""
    _seed_two_requestors()

    result = requestor_handler.handler(
        _event("/api/my-requests", email="BOB@EXAMPLE.COM", email_verified="false"), None,
    )

    assert result["statusCode"] == 403
    assert "REQ-BOB" not in result["body"]


@mock_aws
def test_unverified_email_cannot_cancel_someone_elses_request():
    _seed_two_requestors()

    result = requestor_handler.handler(
        _event("/api/requests/{id}/cancel-request", "POST", "REQ-BOB",
               email="BOB@EXAMPLE.COM", email_verified="false"),
        None,
    )

    assert result["statusCode"] == 403
    stored = requestor_handler.bookings_table.get_item(
        Key={"PK": "SITE#homewood", "SK": "ROOM#r5#DATE#2026-07-14#REQ#REQ-BOB"}
    )["Item"]
    assert stored["status"] == "pending_approval"


def test_missing_email_verified_claim_is_rejected():
    result = requestor_handler.handler(_event("/api/my-requests", email="alice@example.com"), None)
    assert result["statusCode"] == 403


def test_missing_email_claim_is_rejected():
    result = requestor_handler.handler(_event("/api/my-requests", email_verified="true"), None)
    assert result["statusCode"] == 401
