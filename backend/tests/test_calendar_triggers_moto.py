"""Which booking changes queue a calendar invite (and with what method and
SEQUENCE). The notify Lambda invoke is captured instead of sent; notify's
own delivery is covered by test_calendar_invite.py. Also covers approving
into a staff-assigned room."""
import importlib
import json

import boto3
import pytest
from moto import mock_aws

staff_handler = importlib.import_module("backend.lambda.requests_staff.handler")
requestor_handler = importlib.import_module("backend.lambda.requests_requestor.handler")
public_handler = importlib.import_module("backend.lambda.requests_public.handler")

EMAIL = "requestor@example.com"


class FakeLambda:
    def __init__(self):
        self.payloads = []

    def invoke(self, **kwargs):
        self.payloads.append(json.loads(kwargs["Payload"]))

    def invites(self):
        return [p for p in self.payloads if p["type"] == "calendar_invite"]


@pytest.fixture
def lambdas(monkeypatch):
    fake = FakeLambda()
    for module in (staff_handler, requestor_handler, public_handler):
        monkeypatch.setattr(module, "lambda_client", fake)
    monkeypatch.setattr(public_handler, "provision_requestor_user", lambda *a: None)
    monkeypatch.setenv("CALENDAR_INVITES_ENABLED", "true")
    return fake


def _create_tables():
    client = boto3.client("dynamodb", region_name="us-east-1")
    attrs = ["PK", "SK", "GSI2PK", "GSI2SK", "GSI3PK", "GSI3SK"]
    client.create_table(
        TableName="Bookings-test", BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[{"AttributeName": a, "AttributeType": "S"} for a in attrs],
        KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
        GlobalSecondaryIndexes=[
            {"IndexName": name, "Projection": {"ProjectionType": "ALL"},
             "KeySchema": [{"AttributeName": f"{gsi}PK", "KeyType": "HASH"},
                           {"AttributeName": f"{gsi}SK", "KeyType": "RANGE"}]}
            for name, gsi in (("BySiteStatus", "GSI2"), ("ByRequestorEmail", "GSI3"))
        ],
    )
    for name in ("Rooms-test", "Sites-test"):
        client.create_table(
            TableName=name, BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"},
                                  {"AttributeName": "SK", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
        )
    for room_id in ("r5", "r6"):
        staff_handler.rooms_table.put_item(Item={
            "PK": "SITE#homewood", "SK": f"ROOM#{room_id}", "id": room_id, "name": f"Room {room_id}",
        })
    staff_handler.rooms_table.put_item(Item={
        "PK": "SITE#homewood", "SK": "ROOM#r9", "id": "r9", "name": "Room r9", "active": False,
    })


def _put_booking(status, request_id="REQ-1", room="r5", date="2026-07-07", start="09:00", end="10:00", **extra):
    item = {
        "id": request_id, "site": "homewood", "room": room, "date": date, "start": start, "end": end,
        "org": "Test Org", "title": "Board meeting", "email": EMAIL, "status": status,
        **staff_handler.build_keys("homewood", room, date, request_id, "Test Org", EMAIL, status),
        **extra,
    }
    staff_handler.bookings_table.put_item(Item=item)
    if status in ("approved", "cancellation_requested"):
        for slot_key in staff_handler.compute_slot_keys(room, date, start, end):
            staff_handler.bookings_table.put_item(Item={"PK": "SITE#homewood", "SK": slot_key, "requestId": request_id})
    return item


def _staff(action, request_id="REQ-1", body=None, method="POST"):
    return staff_handler.handler({
        "httpMethod": method,
        "resource": f"/api/requests/{{id}}/{action}",
        "pathParameters": {"id": request_id},
        "queryStringParameters": {"site": "homewood"},
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {"authorizer": {"claims": {"cognito:groups": "staff-homewood", "email": "s@example.com"}}},
    }, None)


def _booking(request_id="REQ-1"):
    items = staff_handler.bookings_table.scan()["Items"]
    return next(i for i in items if i.get("id") == request_id and i["SK"].startswith("ROOM#"))


def _locks():
    return sorted(i["SK"] for i in staff_handler.bookings_table.scan()["Items"] if i["SK"].startswith("SLOT#"))


# --- 1. staff approval -------------------------------------------------------

@mock_aws
def test_approve_sends_request_at_sequence_zero(lambdas):
    _create_tables()
    _put_booking("pending_approval")
    assert _staff("approve")["statusCode"] == 200
    [invite] = lambdas.invites()
    assert invite["method"] == "REQUEST"
    assert [r["id"] for r in invite["requests"]] == ["REQ-1"]
    assert int(invite["requests"][0]["calendarSequence"]) == 0
    assert invite["requests"][0]["approvedBy"] == "s@example.com"
    assert _booking()["calendarSequence"] == 0
    assert _booking()["approvedBy"] == "s@example.com"


@mock_aws
def test_approve_into_assigned_room_moves_booking_and_invite_uses_it(lambdas):
    _create_tables()
    _put_booking("pending_approval", room="r5")
    result = _staff("approve", body={"room": "r6"})
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["room"] == "r6"
    booking = _booking()
    assert booking["room"] == "r6"
    assert booking["requestedRoom"] == "r5"
    assert booking["SK"] == "ROOM#r6#DATE#2026-07-07#REQ#REQ-1"
    assert booking["status"] == "approved"
    assert all(k.startswith("SLOT#r6#") for k in _locks())
    assert lambdas.invites()[0]["requests"][0]["room"] == "r6"


@mock_aws
def test_approve_into_inactive_or_unknown_room_is_rejected(lambdas):
    _create_tables()
    _put_booking("pending_approval")
    assert _staff("approve", body={"room": "r9"})["statusCode"] == 400
    assert _staff("approve", body={"room": "nope"})["statusCode"] == 400
    assert _booking()["status"] == "pending_approval"
    assert lambdas.invites() == []


@mock_aws
def test_approve_conflict_sends_nothing(lambdas):
    _create_tables()
    _put_booking("approved", request_id="REQ-OTHER", room="r6")
    _put_booking("pending_approval", room="r5")
    assert _staff("approve", body={"room": "r6"})["statusCode"] == 409
    assert lambdas.invites() == []


# --- 2. counter-proposal accepted -------------------------------------------

@mock_aws
def test_accepted_counter_proposal_sends_final_room_and_time(lambdas):
    _create_tables()
    proposal = {"room": "r6", "date": "2026-07-08", "start": "13:00", "end": "14:00", "message": ""}
    _put_booking("counter_proposed", counterProposal=proposal, counterProposedBy="proposer@example.com")
    result = requestor_handler.accept_counter_proposal({"pathParameters": {"id": "REQ-1"}}, EMAIL)
    assert result["statusCode"] == 200
    [invite] = lambdas.invites()
    sent = invite["requests"][0]
    assert invite["method"] == "REQUEST"
    assert (sent["room"], sent["date"], sent["start"], sent["end"]) == ("r6", "2026-07-08", "13:00", "14:00")
    assert int(sent["calendarSequence"]) == 0
    # The staff member who proposed the change gets the invite.
    assert sent["approvedBy"] == "proposer@example.com"


@mock_aws
def test_counter_proposal_records_who_proposed_it(lambdas):
    _create_tables()
    _put_booking("pending_approval")
    assert _staff("modify", body={"start": "11:00", "end": "12:00"})["statusCode"] == 200
    assert _booking()["counterProposedBy"] == "s@example.com"


@mock_aws
def test_declined_counter_proposal_sends_nothing(lambdas):
    _create_tables()
    _put_booking("counter_proposed", counterProposal={"room": "r6", "date": "2026-07-08",
                                                      "start": "13:00", "end": "14:00", "message": ""})
    requestor_handler.decline_counter_proposal({"pathParameters": {"id": "REQ-1"}}, EMAIL)
    assert lambdas.invites() == []


# --- 4. cancellation after approval ------------------------------------------

@mock_aws
def test_confirmed_cancellation_sends_cancel_with_bumped_sequence(lambdas):
    _create_tables()
    _put_booking("cancellation_requested", calendarSequence=1, approvedBy="approver@example.com")
    assert _staff("confirm-cancellation")["statusCode"] == 200
    [invite] = lambdas.invites()
    assert invite["method"] == "CANCEL"
    # Cancel goes to whoever got the original invite (the stored approver).
    assert invite["requests"][0]["approvedBy"] == "approver@example.com"
    assert int(invite["requests"][0]["calendarSequence"]) == 2
    assert _booking()["calendarSequence"] == 2


@mock_aws
def test_cancellation_of_a_never_invited_booking_sends_nothing(lambdas):
    # counter_proposed → cancellation_requested: never on the calendar.
    _create_tables()
    _put_booking("cancellation_requested")
    assert _staff("confirm-cancellation")["statusCode"] == 200
    assert lambdas.invites() == []


@mock_aws
def test_requestor_cancel_of_approved_waits_for_staff(lambdas):
    _create_tables()
    _put_booking("approved", calendarSequence=0)
    requestor_handler.cancel_request({"pathParameters": {"id": "REQ-1"}}, EMAIL)
    assert lambdas.invites() == []


@mock_aws
def test_deny_and_counter_propose_send_nothing(lambdas):
    _create_tables()
    _put_booking("pending_approval")
    _put_booking("pending_approval", request_id="REQ-2", date="2026-07-08")
    assert _staff("deny", body={"reason": "no"})["statusCode"] == 200
    assert _staff("modify", request_id="REQ-2", body={"start": "11:00", "end": "12:00"})["statusCode"] == 200
    assert lambdas.invites() == []


@mock_aws
def test_pending_submission_sends_nothing(lambdas):
    _create_tables()
    body = {"firstname": "A", "lastname": "B", "email": EMAIL, "org": "Org", "title": "T",
            "activityType": "meeting", "type": "internal", "site": "homewood", "room": "r5",
            "date": "2026-07-07", "start": "09:00", "end": "10:00", "attendance": 3,
            "minors": "no", "facilityRulesAccepted": True}
    result = public_handler.handler({"httpMethod": "POST", "resource": "/api/requests", "body": json.dumps(body)}, None)
    assert result["statusCode"] == 201
    assert lambdas.invites() == []


# --- 5. staff New Booking ------------------------------------------------------

@mock_aws
def test_staff_series_booking_sends_one_invite_per_occurrence(lambdas):
    _create_tables()
    body = {"firstname": "A", "lastname": "B", "email": EMAIL, "org": "Org", "title": "Weekly",
            "activityType": "meeting", "type": "internal", "room": "r5", "date": "2026-07-07",
            "start": "09:00", "end": "10:00", "attendance": 3,
            "recurring": {"enabled": True, "pattern": "weekly", "seriesStart": "2026-07-07",
                          "endMode": "count", "endVal": 3}}
    result = staff_handler.handler({
        "httpMethod": "POST", "resource": "/api/sites/{site}/requests",
        "pathParameters": {"site": "homewood"}, "body": json.dumps(body),
        "requestContext": {"authorizer": {"claims": {"cognito:groups": "staff-homewood",
                                                     "email": "booker@example.com"}}},
    }, None)
    assert result["statusCode"] == 201
    occurrences = json.loads(result["body"])["occurrences"]
    [invite] = lambdas.invites()
    assert invite["method"] == "REQUEST"
    assert [r["id"] for r in invite["requests"]] == occurrences
    assert len({r["id"] for r in invite["requests"]}) == 3
    assert all(int(r["calendarSequence"]) == 0 for r in invite["requests"])
    assert all(r["approvedBy"] == "booker@example.com" for r in invite["requests"])


# --- resend + disabled ---------------------------------------------------------

@mock_aws
def test_resend_reuses_current_sequence(lambdas):
    _create_tables()
    _put_booking("approved", calendarSequence=2)
    result = _staff("resend-invite")
    assert result["statusCode"] == 202
    [invite] = lambdas.invites()
    assert invite["method"] == "REQUEST"
    assert int(invite["requests"][0]["calendarSequence"]) == 2
    assert _booking()["calendarSequence"] == 2


@mock_aws
def test_resend_for_cancelled_sends_cancel_and_legacy_approved_starts_at_zero(lambdas):
    _create_tables()
    _put_booking("cancelled", calendarSequence=1)
    _put_booking("approved", request_id="REQ-LEGACY", date="2026-07-08")
    assert _staff("resend-invite")["statusCode"] == 202
    assert _staff("resend-invite", request_id="REQ-LEGACY")["statusCode"] == 202
    cancel, legacy = lambdas.invites()
    assert cancel["method"] == "CANCEL"
    assert legacy["method"] == "REQUEST"
    assert int(legacy["requests"][0]["calendarSequence"]) == 0
    assert _booking("REQ-LEGACY")["calendarSequence"] == 0


@mock_aws
def test_resend_rejects_bookings_never_on_the_calendar(lambdas):
    _create_tables()
    _put_booking("pending_approval")
    _put_booking("cancelled", request_id="REQ-2")
    assert _staff("resend-invite")["statusCode"] == 409
    assert _staff("resend-invite", request_id="REQ-2")["statusCode"] == 409


@mock_aws
def test_nothing_is_queued_or_sequenced_when_disabled(lambdas, monkeypatch):
    monkeypatch.setenv("CALENDAR_INVITES_ENABLED", "false")
    _create_tables()
    _put_booking("pending_approval")
    assert _staff("approve")["statusCode"] == 200
    assert lambdas.invites() == []
    assert "calendarSequence" not in _booking()
    assert _staff("resend-invite")["statusCode"] == 409


@mock_aws
def test_invite_queue_failure_never_breaks_approval(lambdas, monkeypatch):
    class Broken(FakeLambda):
        def invoke(self, **kwargs):
            if json.loads(kwargs["Payload"])["type"] == "calendar_invite":
                raise RuntimeError("Lambda throttled")
            super().invoke(**kwargs)

    monkeypatch.setattr(staff_handler, "lambda_client", Broken())
    _create_tables()
    _put_booking("pending_approval")
    assert _staff("approve")["statusCode"] == 200
    assert _booking()["status"] == "approved"
