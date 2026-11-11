import importlib
import json

from moto import mock_aws

from backend.tests.test_dashboard_scoping_moto import _create_bookings_table

public_handler = importlib.import_module("backend.lambda.requests_public.handler")


def _put(request_id, status, date="2026-07-07", room="r5", start="09:00", end="10:00"):
    item = {"id": request_id, "site": "homewood", "room": room, "date": date,
            "start": start, "end": end, "status": status}
    item.update(public_handler.build_keys(
        site="homewood", room=room, date=date, request_id=request_id,
        org="Test Org", email="ada@example.com", status=status,
    ))
    public_handler.bookings_table.put_item(Item=item)


def _availability(date="2026-07-07"):
    result = public_handler.handler(
        {"httpMethod": "GET", "resource": "/api/sites/{site}/availability",
         "pathParameters": {"site": "homewood"}, "queryStringParameters": {"date": date}},
        None,
    )
    assert result["statusCode"] == 200
    return json.loads(result["body"])


@mock_aws
def test_availability_splits_approved_and_pending():
    _create_bookings_table()
    _put("REQ-APPROVED", "approved")
    _put("REQ-PENDING", "pending_approval", start="13:00", end="14:30")
    _put("REQ-DENIED", "denied", start="15:00", end="16:00")
    _put("REQ-OTHER-DAY", "pending_approval", date="2026-07-08")

    body = _availability()
    assert body["bookings"] == [{"room": "r5", "start": "09:00", "end": "10:00", "eventStart": "09:00",
                                 "eventEnd": "10:00", "id": "REQ-APPROVED"}]
    # Pending entries expose room+time only, never the request id.
    assert body["pending"] == [{"room": "r5", "start": "13:00", "end": "14:30", "eventStart": "13:00",
                                "eventEnd": "14:30"}]
