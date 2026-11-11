import importlib

handler = importlib.import_module("backend.lambda.requests_public.handler")


def test_generate_occurrence_dates_by_count():
    dates = handler.generate_occurrence_dates({
        "pattern": "weekly", "seriesStart": "2026-07-07", "endMode": "count", "endVal": "3",
    })
    assert dates == ["2026-07-07", "2026-07-14", "2026-07-21"]


def test_generate_occurrence_dates_by_end_date():
    dates = handler.generate_occurrence_dates({
        "pattern": "biweekly", "seriesStart": "2026-07-01", "endMode": "date", "endVal": "2026-07-29",
    })
    assert dates == ["2026-07-01", "2026-07-15", "2026-07-29"]


def test_build_keys_lowercases_email_and_omits_series_attrs_by_default():
    keys = handler.build_keys(
        site="homewood", room="r5", date="2026-07-14", request_id="REQ-1",
        org="Test Org", email="Contact@Example.com", status="pending_approval",
    )
    assert keys["PK"] == "SITE#homewood"
    assert keys["SK"] == "ROOM#r5#DATE#2026-07-14#REQ#REQ-1"
    assert keys["GSI2SK"] == "STATUS#pending_approval#DATE#2026-07-14#REQ#REQ-1"
    assert keys["GSI3PK"] == "REQUESTOR#contact@example.com"
    assert "GSI4PK" not in keys


def test_build_keys_includes_series_attrs_when_series_id_present():
    keys = handler.build_keys(
        site="homewood", room="r5", date="2026-07-14", request_id="REQ-1",
        org="Test Org", email="contact@example.com", status="pending_approval",
        series_id="SERIES-1",
    )
    assert keys["GSI4PK"] == "SERIES#SERIES-1"
    assert keys["GSI4SK"] == "DATE#2026-07-14#REQ#REQ-1"
