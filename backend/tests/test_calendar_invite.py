"""ICS generation (notify/calendar_invite.py) and notify's calendar_invite
delivery path. Every generated message is parsed back with icalendar."""
import email
import importlib
from datetime import datetime, timezone
from email import policy

import boto3
import pytest
from icalendar import Calendar
from moto import mock_aws

import calendar_invite

notify_handler = importlib.import_module("backend.lambda.notify.handler")

CONFIG = {
    "mailbox": "cec-calendar@example.edu",
    "sender": "spacebook@example.edu",
    "uid_domain": "spacebook.example.edu",
    "timezone": "America/New_York",
    "app_url": "https://spacebook.example.edu",
}
BOOKING = {
    "PK": "SITE#homewood", "SK": "ROOM#r5#DATE#2026-07-07#REQ#REQ-ABC",
    "id": "REQ-ABC", "site": "homewood", "room": "r5", "date": "2026-07-07",
    "start": "09:00", "end": "10:30", "title": "Board meeting", "org": "Test Org",
    "type": "internal", "activityType": "meeting", "attendance": 12,
    "techNeeds": ["Projector", "Zoom"], "setupTime": "15 min", "cleanupTime": "30 min",
    "firstname": "Ada", "lastname": "Lovelace", "email": "ada@private.example.com",
    "phone": "412-555-0199", "notes": "Secret door code 1234", "minors": "yes",
    "status": "approved", "calendarSequence": 0, "approvedBy": "staffer@example.edu",
}
LOCATION = "Homewood · Room 5"


def _event(ics_bytes):
    cal = Calendar.from_ical(ics_bytes)
    events = cal.walk("VEVENT")
    assert len(events) == 1
    return cal, events[0]


def _ics(method="REQUEST", recipient="staffer@example.edu", role="staff", **overrides):
    return calendar_invite.build_ics({**BOOKING, **overrides}, method, CONFIG, LOCATION, recipient, role)


def test_request_round_trips_with_required_itip_properties():
    cal, event = _event(_ics())
    assert cal["METHOD"] == "REQUEST"
    assert cal["VERSION"] == "2.0"
    assert str(event["UID"]) == "booking-REQ-ABC@spacebook.example.edu"
    assert event["SEQUENCE"] == 0
    assert event["STATUS"] == "CONFIRMED"
    assert event["SUMMARY"] == "Board meeting"
    assert event["LOCATION"] == LOCATION
    assert str(event["ORGANIZER"]) == "mailto:spacebook@example.edu"
    attendee = event["ATTENDEE"]
    assert str(attendee) == "mailto:staffer@example.edu"
    assert attendee.params["RSVP"] == "FALSE"
    assert attendee.params["CUTYPE"] == "INDIVIDUAL"
    assert event.decoded("DTSTAMP").tzinfo is not None


def test_uid_is_stable_across_updates_and_cancel():
    uids = {
        str(_event(_ics())[1]["UID"]),
        str(_event(_ics(start="11:00", end="12:00", calendarSequence=1))[1]["UID"]),
        str(_event(_ics("CANCEL", calendarSequence=2))[1]["UID"]),
    }
    assert uids == {"booking-REQ-ABC@spacebook.example.edu"}


def test_sequence_comes_from_the_booking():
    assert _event(_ics(calendarSequence=3))[1]["SEQUENCE"] == 3


def test_cancel_has_method_and_status_cancelled():
    cal, event = _event(_ics("CANCEL", calendarSequence=1))
    assert cal["METHOD"] == "CANCEL"
    assert event["STATUS"] == "CANCELLED"
    assert event["SEQUENCE"] == 1


def test_times_are_new_york_wall_clock_with_a_vtimezone():
    cal, event = _event(_ics())
    start = event.decoded("DTSTART")
    end = event.decoded("DTEND")
    assert (start.hour, start.minute, end.hour, end.minute) == (9, 0, 10, 30)
    assert str(start.tzinfo) == "America/New_York"
    # July → EDT, UTC-4.
    assert start.astimezone(timezone.utc).hour == 13
    assert "TZID=America/New_York" in event.to_ical().decode()
    timezones = cal.walk("VTIMEZONE")
    assert [str(tz["TZID"]) for tz in timezones] == ["America/New_York"]


def test_setup_and_cleanup_are_in_description_not_the_event_window():
    _, event = _event(_ics())
    description = str(event["DESCRIPTION"])
    assert "Setup before: 15 min" in description
    assert "Cleanup after: 30 min" in description
    assert "Event time: 09:00–10:30" in description
    assert event.decoded("DTSTART").hour == 9
    assert event.decoded("DTEND").minute == 30


def test_description_has_booking_details_and_staff_link():
    description = str(_event(_ics())[1]["DESCRIPTION"])
    for expected in ("Organization: Test Org", "Event type: internal", "Activity type: meeting",
                     "Expected attendance: 12", "Projector, Zoom", "Booking ID: REQ-ABC",
                     "https://spacebook.example.edu/staff/homewood/queue"):
        assert expected in description


def test_recipients_are_requester_approver_and_optional_mailbox():
    assert calendar_invite.invite_recipients(BOOKING, CONFIG) == [
        ("ada@private.example.com", "requester"),
        ("staffer@example.edu", "staff"),
        ("cec-calendar@example.edu", "mailbox"),
    ]
    no_mailbox = {**CONFIG, "mailbox": None}
    assert [r for r, _ in calendar_invite.invite_recipients(BOOKING, no_mailbox)] == [
        "ada@private.example.com", "staffer@example.edu",
    ]
    # Staff booking for themselves, or no recorded approver: one copy each.
    self_booked = {**BOOKING, "approvedBy": "ADA@private.example.com"}
    assert [r for r, _ in calendar_invite.invite_recipients(self_booked, no_mailbox)] == ["ada@private.example.com"]
    assert [r for r, _ in calendar_invite.invite_recipients({**BOOKING, "approvedBy": None}, no_mailbox)] == [
        "ada@private.example.com",
    ]


@pytest.mark.parametrize("recipient,role", [
    ("ada@private.example.com", "requester"),
    ("staffer@example.edu", "staff"),
    ("cec-calendar@example.edu", "mailbox"),
])
def test_each_copy_names_only_its_recipient_and_no_private_fields(recipient, role):
    unfolded = _ics(recipient=recipient, role=role).decode().replace("\r\n ", "")
    others = {"ada@private.example.com", "staffer@example.edu", "cec-calendar@example.edu"} - {recipient}
    for private in [*others, "412-555-0199", "Lovelace", "Ada", "Secret door code", "minors", "Minors"]:
        assert private not in unfolded
    _, event = _event(_ics(recipient=recipient, role=role))
    assert str(event["ATTENDEE"]) == f"mailto:{recipient}"


def test_requester_copy_has_no_staff_link_and_mailbox_is_a_resource():
    _, requester = _event(_ics(recipient="ada@private.example.com", role="requester"))
    assert "Staff view" not in str(requester["DESCRIPTION"])
    _, mailbox = _event(_ics(recipient="cec-calendar@example.edu", role="mailbox"))
    assert mailbox["ATTENDEE"].params["CUTYPE"] == "RESOURCE"


def test_email_has_text_calendar_part_with_method_and_ics_attachment():
    msg = calendar_invite.build_message(BOOKING, "REQUEST", CONFIG, LOCATION, "staffer@example.edu", "staff")
    parsed = email.message_from_bytes(msg.as_bytes(), policy=policy.default)
    assert parsed["To"] == "staffer@example.edu"
    assert parsed["From"] == "spacebook@example.edu"
    parts = {p.get_content_type(): p for p in parsed.walk()}
    assert "text/plain" in parts
    cal_part = parts["text/calendar"]
    assert cal_part.get_param("method") == "REQUEST"
    assert cal_part.get_param("charset").lower() == "utf-8"
    attachment = parts["application/ics"]
    assert attachment.get_filename() == "invite.ics"
    ics = cal_part.get_payload(decode=True)
    # RFC 5545 requires CRLF line endings.
    assert b"\r\nEND:VCALENDAR" in ics and b"\n\n" not in ics
    assert ics == attachment.get_payload(decode=True)
    _event(ics)
    assert "ada@private.example.com" not in parsed.get_body(("plain",)).get_content()


def test_calendar_config_needs_only_the_enable_flag(monkeypatch):
    for name in ("CALENDAR_INVITES_ENABLED", "CALENDAR_INVITE_RECIPIENT", "CALENDAR_INVITE_FROM",
                 "CALENDAR_UID_DOMAIN", "CALENDAR_INVITE_RECIPIENT_OVERRIDES", "CALENDAR_TIMEZONE"):
        monkeypatch.delenv(name, raising=False)
    assert calendar_invite.calendar_config("homewood") is None
    monkeypatch.setenv("CALENDAR_INVITES_ENABLED", "true")
    config = calendar_invite.calendar_config("homewood")
    # Defaults: the app's SES sender (conftest: test@example.com) and its domain.
    assert config["sender"] == "test@example.com"
    assert config["uid_domain"] == "example.com"
    assert config["mailbox"] is None
    assert config["timezone"] == "America/New_York"


def test_calendar_config_optional_mailbox_and_site_overrides(monkeypatch):
    monkeypatch.setenv("CALENDAR_INVITES_ENABLED", "true")
    monkeypatch.setenv("CALENDAR_INVITE_RECIPIENT", "cec@example.edu")
    monkeypatch.setenv("CALENDAR_INVITE_FROM", "spacebook@example.edu")
    monkeypatch.setenv("CALENDAR_UID_DOMAIN", "uids.example.edu")
    monkeypatch.setenv("CALENDAR_INVITE_RECIPIENT_OVERRIDES", '{"hill-district": "hill@example.edu"}')
    assert calendar_invite.calendar_config("homewood")["mailbox"] == "cec@example.edu"
    assert calendar_invite.calendar_config("hill-district")["mailbox"] == "hill@example.edu"
    assert calendar_invite.calendar_config("homewood")["sender"] == "spacebook@example.edu"
    assert calendar_invite.calendar_config("homewood")["uid_domain"] == "uids.example.edu"


# --- notify handler: delivery + recorded result ---------------------------

class FakeSes:
    def __init__(self, fail=False):
        self.sent = []
        self.fail = fail

    def send_raw_email(self, **kwargs):
        if self.fail:
            raise RuntimeError("SES throttled")
        self.sent.append(kwargs)


@pytest.fixture
def invites_on(monkeypatch):
    monkeypatch.setenv("CALENDAR_INVITES_ENABLED", "true")
    monkeypatch.setenv("CALENDAR_INVITE_FROM", "spacebook@example.edu")
    monkeypatch.setenv("CALENDAR_UID_DOMAIN", "spacebook.example.edu")
    monkeypatch.delenv("CALENDAR_INVITE_RECIPIENT", raising=False)
    monkeypatch.delenv("CALENDAR_INVITE_RECIPIENT_OVERRIDES", raising=False)


def _tables():
    client = boto3.client("dynamodb", region_name="us-east-1")
    for name in ("Bookings-test", "Rooms-test", "Sites-test"):
        client.create_table(
            TableName=name, BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"},
                                  {"AttributeName": "SK", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"},
                       {"AttributeName": "SK", "KeyType": "RANGE"}],
        )
    notify_handler.sites_table.put_item(Item={"PK": "SITE#homewood", "SK": "CONFIG", "label": "Homewood"})
    notify_handler.rooms_table.put_item(Item={"PK": "SITE#homewood", "SK": "ROOM#r5", "name": "Room 5"})
    notify_handler.bookings_table.put_item(Item=BOOKING)


def _parsed(sent):
    return email.message_from_bytes(sent["RawMessage"]["Data"], policy=policy.default)


@mock_aws
def test_notify_sends_one_copy_each_to_requester_and_approver(monkeypatch, invites_on):
    _tables()
    ses = FakeSes()
    monkeypatch.setattr(notify_handler, "ses", ses)
    result = notify_handler.handler({"type": "calendar_invite", "method": "REQUEST", "requests": [BOOKING]}, None)
    assert result == {"sent": True}
    assert [s["Destinations"] for s in ses.sent] == [["ada@private.example.com"], ["staffer@example.edu"]]
    assert {s["Source"] for s in ses.sent} == {"spacebook@example.edu"}
    requester, staff = (_parsed(s) for s in ses.sent)
    # The requester's copy is their usual approval email, carrying the invite.
    assert requester["Subject"] == "Request approved: Board meeting"
    assert "has been approved" in requester.get_body(("plain",)).get_content()
    assert staff["Subject"] == "Booking: Board meeting (2026-07-07)"
    for msg, recipient in ((requester, "ada@private.example.com"), (staff, "staffer@example.edu")):
        ics = next(p for p in msg.walk() if p.get_content_type() == "text/calendar").get_payload(decode=True)
        _, event = _event(ics)
        assert event["LOCATION"] == "Homewood · Room 5"
        assert str(event["ATTENDEE"]) == f"mailto:{recipient}"
    stored = notify_handler.bookings_table.get_item(Key={"PK": BOOKING["PK"], "SK": BOOKING["SK"]})["Item"]
    assert stored["calendarInvite"]["status"] == "sent"
    assert stored["calendarInvite"]["method"] == "REQUEST"
    assert stored["calendarInvite"]["sequence"] == 0
    assert stored["calendarInvite"]["recipients"] == 2


@mock_aws
def test_notify_adds_the_optional_cec_mailbox(monkeypatch, invites_on):
    monkeypatch.setenv("CALENDAR_INVITE_RECIPIENT", "cec-calendar@example.edu")
    _tables()
    ses = FakeSes()
    monkeypatch.setattr(notify_handler, "ses", ses)
    notify_handler.handler({"type": "calendar_invite", "method": "CANCEL",
                            "requests": [{**BOOKING, "calendarSequence": 1}]}, None)
    assert [s["Destinations"][0] for s in ses.sent] == [
        "ada@private.example.com", "staffer@example.edu", "cec-calendar@example.edu",
    ]
    assert _parsed(ses.sent[0])["Subject"] == "Cancellation confirmed: Board meeting"


@mock_aws
def test_approval_and_cancellation_emails_are_carried_by_the_invite(monkeypatch, invites_on):
    _tables()
    ses = FakeSes()
    monkeypatch.setattr(notify_handler, "ses", ses)
    for notification_type in ("approved", "cancellation_confirmed"):
        result = notify_handler.handler({"type": notification_type, "request": BOOKING}, None)
        assert result == {"sent": False, "carriedByInvite": True}
    # Never sent to the calendar (or invites off): the plain email still goes out.
    sent = []
    monkeypatch.setattr(notify_handler.ses, "send_email", lambda **kw: sent.append(kw), raising=False)
    legacy = {k: v for k, v in BOOKING.items() if k != "calendarSequence"}
    assert notify_handler.handler({"type": "approved", "request": legacy}, None) == {"sent": True}
    monkeypatch.setenv("CALENDAR_INVITES_ENABLED", "false")
    assert notify_handler.handler({"type": "approved", "request": BOOKING}, None) == {"sent": True}
    assert len(sent) == 2


@mock_aws
def test_notify_records_failure_and_raises_for_lambda_retry(monkeypatch, invites_on):
    _tables()
    monkeypatch.setattr(notify_handler, "ses", FakeSes(fail=True))
    with pytest.raises(RuntimeError):
        notify_handler.handler({"type": "calendar_invite", "method": "REQUEST", "requests": [BOOKING]}, None)
    stored = notify_handler.bookings_table.get_item(Key={"PK": BOOKING["PK"], "SK": BOOKING["SK"]})["Item"]
    assert stored["calendarInvite"]["status"] == "failed"
    assert "SES throttled" in stored["calendarInvite"]["error"]


@mock_aws
def test_older_sequence_result_does_not_overwrite_newer(monkeypatch, invites_on):
    _tables()
    monkeypatch.setattr(notify_handler, "ses", FakeSes())
    notify_handler.handler({"type": "calendar_invite", "method": "CANCEL",
                            "requests": [{**BOOKING, "calendarSequence": 1}]}, None)
    notify_handler.handler({"type": "calendar_invite", "method": "REQUEST", "requests": [BOOKING]}, None)
    stored = notify_handler.bookings_table.get_item(Key={"PK": BOOKING["PK"], "SK": BOOKING["SK"]})["Item"]
    assert stored["calendarInvite"]["method"] == "CANCEL"
    assert stored["calendarInvite"]["sequence"] == 1


def test_notify_sends_nothing_when_disabled(monkeypatch):
    monkeypatch.delenv("CALENDAR_INVITES_ENABLED", raising=False)
    ses = FakeSes()
    monkeypatch.setattr(notify_handler, "ses", ses)
    result = notify_handler.handler({"type": "calendar_invite", "method": "REQUEST", "requests": [BOOKING]}, None)
    assert result == {"sent": False}
    assert ses.sent == []


def test_dtstamp_is_utc_now():
    fixed = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
    ics = calendar_invite.build_ics(BOOKING, "REQUEST", CONFIG, LOCATION, "staffer@example.edu", "staff", now=fixed)
    assert _event(ics)[1].decoded("DTSTAMP") == fixed
