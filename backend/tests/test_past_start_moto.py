import json
from datetime import datetime

import pytest
from moto import mock_aws

from backend.tests.test_approve_conflict_moto import _create_bookings_table
from backend.tests.test_hidden_rooms_moto import (  # noqa: F401 (no_side_effects is an autouse fixture)
    _bookings, _public_submit, _put_room, _staff_book, no_side_effects, public_handler, staff_handler,
)
from backend.tests.test_rooms_admin_moto import _create_rooms_table
from backend.tests.test_sites_admin_moto import _create_sites_table


@pytest.fixture(autouse=True)
def afternoon(monkeypatch):
    now = datetime(2026, 7, 7, 14, 40)
    monkeypatch.setattr(public_handler, "local_now", lambda: now)
    monkeypatch.setattr(staff_handler, "local_now", lambda: now)


@pytest.fixture
def tables():
    with mock_aws():
        _create_rooms_table()
        _create_sites_table()
        _create_bookings_table()
        _put_room("r5", hidden=False)
        yield


@pytest.mark.parametrize("submit", [_public_submit, _staff_book])
def test_start_time_earlier_today_is_rejected(tables, submit):
    result = submit(date="2026-07-07", start="14:30", end="15:30")
    assert result["statusCode"] == 400
    assert "already passed" in json.loads(result["body"])["message"]
    assert _bookings() == []


@pytest.mark.parametrize("submit", [_public_submit, _staff_book])
def test_later_today_and_future_dates_are_accepted(tables, submit):
    assert submit(date="2026-07-07", start="15:00", end="16:00")["statusCode"] == 201
    assert submit(date="2026-07-08", start="09:00", end="10:00")["statusCode"] == 201


def test_recurring_series_starting_in_the_past_is_rejected(tables):
    result = _public_submit(date="2026-07-14", start="09:00", end="10:00", recurring={
        "enabled": True, "pattern": "weekly", "seriesStart": "2026-06-30", "endMode": "count", "endVal": 3,
    })
    assert result["statusCode"] == 400
    assert _bookings() == []


def test_malformed_start_is_a_400(tables):
    assert _public_submit(start="9am")["statusCode"] == 400
