import importlib
import json

import pytest
from moto import mock_aws

from backend.tests.test_accept_counter_proposal_moto import _create_bookings_table
from backend.tests.test_rooms_admin_moto import _create_rooms_table
from backend.tests.test_sites_admin_moto import _create_sites_table, _event

rooms_admin_handler = importlib.import_module("backend.lambda.rooms_admin.handler")
public_handler = importlib.import_module("backend.lambda.requests_public.handler")

SITE_KEY = {"PK": "SITE#homewood", "SK": "CONFIG"}


def _seed_site(max_occurrences=None):
    item = {**SITE_KEY, "id": "homewood", "label": "Homewood", "color": "#003594", "active": True}
    if max_occurrences is not None:
        item["maxOccurrences"] = max_occurrences
    rooms_admin_handler.sites_table.put_item(Item=item)


def _update_site(body):
    return rooms_admin_handler.handler(
        _event("PUT", "/api/sites/{site}", path_params={"site": "homewood"}, body=body), None,
    )


def _submit(recurring):
    body = {
        "firstname": "Ada", "lastname": "Lovelace", "email": "ada@example.com", "org": "Test Org",
        "title": "Weekly sync", "activityType": "meeting", "type": "internal", "site": "homewood",
        "room": "r5", "date": "2026-07-07", "start": "09:00", "end": "10:00", "attendance": 5,
        "minors": "no", "facilityRulesAccepted": True,
        "recurring": {"enabled": True, "pattern": "weekly", "seriesStart": "2026-07-07", **recurring},
    }
    return public_handler.handler(
        {"httpMethod": "POST", "resource": "/api/requests", "body": json.dumps(body)}, None,
    )


@pytest.fixture
def no_side_effects(monkeypatch):
    monkeypatch.setattr(public_handler, "provision_requestor_user", lambda *a: None)
    monkeypatch.setattr(public_handler, "invoke_notify", lambda payload: None)


@mock_aws
def test_admin_sets_and_clears_max_occurrences():
    _create_sites_table()
    _seed_site()

    result = _update_site({"maxOccurrences": 8})
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["maxOccurrences"] == 8

    listed = json.loads(rooms_admin_handler.handler(_event("GET", "/api/sites"), None)["body"])
    assert listed["sites"][0]["maxOccurrences"] == 8

    result = _update_site({"maxOccurrences": None})
    assert result["statusCode"] == 200
    assert "maxOccurrences" not in json.loads(result["body"])
    assert "maxOccurrences" not in rooms_admin_handler.sites_table.get_item(Key=SITE_KEY)["Item"]


@mock_aws
@pytest.mark.parametrize("value", [0, 53, -1, 2.5, "abc", True])
def test_invalid_max_occurrences_is_rejected(value):
    _create_sites_table()
    _seed_site()

    assert _update_site({"maxOccurrences": value})["statusCode"] == 400


@mock_aws
def test_non_admin_cannot_set_max_occurrences():
    _create_sites_table()
    _seed_site()

    result = rooms_admin_handler.handler(
        _event("PUT", "/api/sites/{site}", path_params={"site": "homewood"},
               body={"maxOccurrences": 8}, groups=("staff-homewood",)),
        None,
    )
    assert result["statusCode"] == 403


@mock_aws
def test_series_over_site_limit_by_count_is_rejected(no_side_effects):
    _create_sites_table()
    _create_bookings_table()
    _create_rooms_table()
    _seed_site(max_occurrences=8)

    result = _submit({"endMode": "count", "endVal": 9})
    assert result["statusCode"] == 400
    assert "at most 8 occurrences" in json.loads(result["body"])["message"]
    assert public_handler.bookings_table.scan()["Items"] == []


@mock_aws
def test_series_over_site_limit_by_end_date_is_rejected(no_side_effects):
    _create_sites_table()
    _create_bookings_table()
    _create_rooms_table()
    _seed_site(max_occurrences=8)

    # Weekly from 2026-07-07 through 2026-09-01 is 9 dates.
    result = _submit({"endMode": "date", "endVal": "2026-09-01"})
    assert result["statusCode"] == 400


@mock_aws
def test_series_at_site_limit_is_accepted(no_side_effects):
    _create_sites_table()
    _create_bookings_table()
    _create_rooms_table()
    _seed_site(max_occurrences=8)

    result = _submit({"endMode": "count", "endVal": 8})
    assert result["statusCode"] == 201
    assert len(json.loads(result["body"])["occurrences"]) == 8


@mock_aws
def test_site_without_limit_falls_back_to_hard_cap(no_side_effects):
    _create_sites_table()
    _create_bookings_table()
    _create_rooms_table()
    _seed_site()

    result = _submit({"endMode": "count", "endVal": 60})
    assert result["statusCode"] == 201
    assert len(json.loads(result["body"])["occurrences"]) == public_handler.MAX_OCCURRENCES
