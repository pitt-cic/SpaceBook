"""ICS generation for the staff calendar feed (calendar_feed/handler.py).
Every generated calendar is parsed back with icalendar."""
import importlib
from datetime import datetime, timezone

from icalendar import Calendar

feed = importlib.import_module("backend.lambda.calendar_feed.handler")


def _booking(**overrides):
    return {
        "id": "REQ-1",
        "room": "r1",
        "date": "2026-07-01",
        "start": "09:00",
        "end": "10:30",
        "title": "Board meeting",
        "org": "Acme, Inc.",
        "attendance": 12,
        "status": "approved",
        "firstname": "Ada",
        "lastname": "Lovelace",
        "email": "ada@example.com",
        "phone": "412-555-0100",
        "notes": "Private note",
        "updatedAt": "2026-06-01T12:00:00+00:00",
        **overrides,
    }


def _parse(body):
    cal = Calendar.from_ical(body)
    return cal, [c for c in cal.walk("VEVENT")]


def _utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


def test_local_to_utc_follows_daylight_saving():
    # EDT (UTC-4) in summer, EST (UTC-5) in winter.
    assert feed.local_to_utc("2026-07-01", "09:00") == _utc(2026, 7, 1, 13)
    assert feed.local_to_utc("2026-12-01", "09:00") == _utc(2026, 12, 1, 14)
    # 2026-11-01 is the fall-back day; 09:00 is already EST.
    assert feed.local_to_utc("2026-11-01", "09:00") == _utc(2026, 11, 1, 14)


def test_local_to_utc_accepts_end_of_day():
    assert feed.local_to_utc("2026-07-01", "24:00") == _utc(2026, 7, 2, 4)


def test_event_fields_round_trip():
    body = feed.build_calendar("SpaceBook – Homewood CEC",
                               [feed.build_vevent(_booking(), {"r1": "Room 101"}, "Homewood CEC")])
    cal, (event,) = _parse(body)
    assert str(cal["method"]) == "PUBLISH"
    assert str(cal["x-wr-calname"]) == "SpaceBook – Homewood CEC"
    assert str(event["uid"]) == "REQ-1@spacebook-feed"
    # No setup/cleanup: the event's own 09:00–10:30 EDT.
    assert event.decoded("dtstart") == _utc(2026, 7, 1, 13)
    assert event.decoded("dtend") == _utc(2026, 7, 1, 14, 30)
    assert str(event["summary"]) == "Board meeting"
    assert str(event["location"]) == "Room 101, Homewood CEC"


def test_event_spans_setup_and_cleanup():
    event = feed.build_vevent(_booking(setupTime="15 min", cleanupTime="1 hour"), {}, "Homewood")
    # 09:00–10:30 EDT event → room held 08:45–11:30 EDT.
    assert event.decoded("dtstart") == _utc(2026, 7, 1, 12, 45)
    assert event.decoded("dtend") == _utc(2026, 7, 1, 15, 30)
    description = str(event["description"])
    assert "Event time: 09:00–10:30 (room held 08:45–11:30 for setup/cleanup)" in description
    assert "Setup before: 15 min" in description
    assert "Cleanup after: 1 hour" in description


def test_reserved_window_is_clamped_to_the_day():
    event = feed.build_vevent(_booking(start="00:15", end="23:30", setupTime="1 hour", cleanupTime="1 hour"),
                              {}, "Homewood")
    assert event.decoded("dtstart") == _utc(2026, 7, 1, 4)    # 00:00 EDT
    assert event.decoded("dtend") == _utc(2026, 7, 2, 4)      # 24:00 EDT


def test_description_has_requester_and_request_details():
    booking = _booking(type="internal", activityType="meeting", minors="no", techNeeds=["Projector"],
                       approvedBy="staff@example.edu", seriesId="SERIES-1")
    description = str(feed.build_vevent(booking, {}, "Homewood")["description"])
    for line in [
        "Event time: 09:00–10:30",
        "Organization: Acme, Inc.",
        "Event type: internal",
        "Activity type: meeting",
        "Expected attendance: 12",
        "Minors involved: no",
        "Tech / equipment needs: Projector",
        "Notes: Private note",
        "Requested by: Ada Lovelace",
        "Email: ada@example.com",
        "Phone: 412-555-0100",
        "Approved by: staff@example.edu",
        "Recurring series: SERIES-1",
        "Booking ID: REQ-1",
    ]:
        assert line in description.split("\n"), line
    assert "room held" not in description


def test_description_skips_empty_fields():
    description = str(feed.build_vevent(_booking(phone=None, notes="", email=None), {}, "Homewood")["description"])
    assert "Phone:" not in description
    assert "Notes:" not in description
    assert "Email:" not in description
    assert "\n\n\n" not in description


def test_uid_is_stable_across_edits():
    before = feed.build_vevent(_booking(), {}, "Homewood")
    after = feed.build_vevent(_booking(start="13:00", end="14:00", updatedAt="2026-06-02T00:00:00+00:00"),
                              {}, "Homewood")
    assert str(before["uid"]) == str(after["uid"])
    assert after.decoded("dtstart") == _utc(2026, 7, 1, 17)
    assert after.decoded("last-modified") > before.decoded("last-modified")


def test_cancellation_requested_is_flagged_in_the_title():
    event = feed.build_vevent(_booking(status="cancellation_requested"), {}, "Homewood")
    assert str(event["summary"]) == "[Cancellation requested] Board meeting"


def test_calendar_is_crlf_with_refresh_hints():
    body = feed.build_calendar("x", [feed.build_vevent(_booking(), {}, "Homewood")])
    assert body.startswith("BEGIN:VCALENDAR\r\n")
    assert "\n" not in body.replace("\r\n", "")
    assert "X-PUBLISHED-TTL:PT1H\r\n" in body
    assert "REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n" in body


def test_long_titles_are_folded():
    body = feed.build_calendar("x", [feed.build_vevent(_booking(title="é" * 120), {}, "Homewood")])
    assert all(len(line.encode("utf-8")) <= 75 for line in body.split("\r\n"))
    _, (event,) = _parse(body)
    assert str(event["summary"]) == "é" * 120
