"""iCalendar (RFC 5545 / iTIP RFC 5546) invites for confirmed bookings.

Each copy goes to one person — the requester, the staff member who approved
the booking (approvedBy), and optionally a CEC calendar mailbox — and names
only that recipient as ATTENDEE, so nobody sees anyone else's address.

Every confirmed booking occurrence is one VEVENT with a stable UID
(booking-<request id>@<uid domain>). Callers own the per-booking SEQUENCE (the
booking's calendarSequence attribute, bumped in the same write that changes the
booking), so a retried or resent message is the same event and calendars treat
it as a duplicate rather than a new meeting.

Setup/cleanup buffers go in DESCRIPTION only; DTSTART/DTEND are the event's own
time, which is what attendees need on their calendars. (The room itself is held
for the wider reserved window — see reserved_window in requests_staff.)

Privacy: beyond the recipient's own address, no requester name, phone, notes,
or minors info goes in the invite. Only the fields in describe() are included.
"""
import json
import os
from datetime import date as date_cls, datetime, timezone
from email.message import EmailMessage
from email.policy import SMTP
from zoneinfo import ZoneInfo

from icalendar import Calendar, Event, vCalAddress

PRODID = "-//SpaceBook//Calendar Invites//EN"
DEFAULT_TIMEZONE = "America/New_York"


def calendar_config(site):
    """Invite settings from the environment, or None when invites are off.
    Only CALENDAR_INVITES_ENABLED is needed: the sender defaults to the app's
    SES sender, and the UID domain to the sender's domain. The CEC mailbox
    (CALENDAR_INVITE_RECIPIENT, per-site via the optional JSON map
    CALENDAR_INVITE_RECIPIENT_OVERRIDES) is an optional extra recipient."""
    if os.environ.get("CALENDAR_INVITES_ENABLED", "false").lower() != "true":
        return None
    overrides = json.loads(os.environ.get("CALENDAR_INVITE_RECIPIENT_OVERRIDES") or "{}")
    sender = os.environ.get("CALENDAR_INVITE_FROM") or os.environ["SES_SENDER_EMAIL"]
    return {
        "mailbox": overrides.get(site) or os.environ.get("CALENDAR_INVITE_RECIPIENT") or None,
        "sender": sender,
        "uid_domain": os.environ.get("CALENDAR_UID_DOMAIN") or sender.rsplit("@", 1)[-1].lower(),
        "timezone": os.environ.get("CALENDAR_TIMEZONE") or DEFAULT_TIMEZONE,
        "app_url": (os.environ.get("SPACEBOOK_APP_URL") or "").rstrip("/"),
    }


def invite_recipients(request_item, config):
    """[(email, role)] — one copy each for the requester, the staff member who
    approved the booking, and the CEC mailbox if configured. Deduped
    case-insensitively, so a staff member booking for themselves gets one."""
    recipients = []
    for email, role in (
        (request_item.get("email"), "requester"),
        (request_item.get("approvedBy"), "staff"),
        (config.get("mailbox"), "mailbox"),
    ):
        if email and email.lower() not in {r.lower() for r, _ in recipients}:
            recipients.append((email, role))
    return recipients


def booking_uid(request_id, uid_domain):
    return f"booking-{request_id}@{uid_domain}"


def build_ics(request_item, method, config, location, recipient, role, now=None):
    """One VCALENDAR with a single VEVENT, as bytes, for one recipient.
    method: REQUEST or CANCEL. role: requester, staff, or mailbox."""
    if method not in ("REQUEST", "CANCEL"):
        raise ValueError(f"Unsupported iTIP method {method}")
    tz = ZoneInfo(config["timezone"])
    date = request_item["date"]

    cal = Calendar()
    cal.add("prodid", PRODID)
    cal.add("version", "2.0")
    cal.add("method", method)

    event = Event()
    event.add("uid", booking_uid(request_item["id"], config["uid_domain"]))
    event.add("sequence", int(request_item.get("calendarSequence") or 0))
    event.add("dtstamp", now or datetime.now(timezone.utc))
    event.add("dtstart", datetime.fromisoformat(f"{date}T{request_item['start']}").replace(tzinfo=tz))
    event.add("dtend", datetime.fromisoformat(f"{date}T{request_item['end']}").replace(tzinfo=tz))
    event.add("summary", request_item.get("title") or "SpaceBook booking")
    event.add("location", location)
    # The staff-page link is no use to the requester.
    event.add("description", describe(request_item, "" if role == "requester" else config["app_url"]))
    event.add("status", "CANCELLED" if method == "CANCEL" else "CONFIRMED")
    event.add("transp", "OPAQUE")

    organizer = vCalAddress(f"mailto:{config['sender']}")
    organizer.params["CN"] = "SpaceBook"
    event.add("organizer", organizer)
    attendee = vCalAddress(f"mailto:{recipient}")
    attendee.params["CUTYPE"] = "RESOURCE" if role == "mailbox" else "INDIVIDUAL"
    attendee.params["ROLE"] = "REQ-PARTICIPANT"
    attendee.params["PARTSTAT"] = "NEEDS-ACTION"
    attendee.params["RSVP"] = "FALSE"
    event.add("attendee", attendee)

    cal.add_component(event)
    # VTIMEZONE for the TZID used by DTSTART/DTEND, limited to the event's
    # year (the library default spans 1970–2038, ~100 lines of RDATEs).
    year = int(date[:4])
    cal.add_missing_timezones(first_date=date_cls(year, 1, 1), last_date=date_cls(year + 1, 1, 1))
    return cal.to_ical()


def describe(request_item, app_url):
    lines = [
        f"Organization: {request_item.get('org') or '—'}",
        f"Event type: {request_item.get('type') or '—'}",
        f"Activity type: {request_item.get('activityType') or '—'}",
        f"Expected attendance: {request_item.get('attendance') or '—'}",
        f"Tech / equipment needs: {', '.join(request_item.get('techNeeds') or []) or 'None'}",
        f"Event time: {request_item['start']}–{request_item['end']}",
    ]
    if request_item.get("setupTime"):
        lines.append(f"Setup before: {request_item['setupTime']}")
    if request_item.get("cleanupTime"):
        lines.append(f"Cleanup after: {request_item['cleanupTime']}")
    lines.append(f"Booking ID: {request_item['id']}")
    if app_url:
        lines.append(f"Staff view: {app_url}/staff/{request_item['site']}/queue")
    return "\n".join(lines)


def build_message(request_item, method, config, location, recipient, role, subject=None, text=None, now=None):
    """MIME message: a text/plain body and the text/calendar part with the
    iTIP method (what calendar clients process), plus invite.ics as an
    attachment for clients that only look at attachments. subject/text
    override the default staff-facing wording (notify passes the requester
    their usual approval/cancellation email text)."""
    ics = build_ics(request_item, method, config, location, recipient, role, now=now)
    title = request_item.get("title") or "SpaceBook booking"
    when = f"{request_item['date']} {request_item['start']}–{request_item['end']}"

    # SMTP policy: CRLF line endings, which RFC 5322 and RFC 5545 both require.
    msg = EmailMessage(policy=SMTP)
    msg["From"] = config["sender"]
    msg["To"] = recipient
    if method == "CANCEL":
        msg["Subject"] = subject or f"Cancelled: {title} ({request_item['date']})"
        text = text or f"SpaceBook booking {request_item['id']} has been cancelled: {title}, {when}, {location}."
    else:
        msg["Subject"] = subject or f"Booking: {title} ({request_item['date']})"
        text = text or f"SpaceBook booking {request_item['id']} is confirmed: {title}, {when}, {location}."
    msg.set_content(text + "\n")
    # Bytes, not str: a str body gets its CRLFs normalized away.
    msg.add_alternative(ics, maintype="text", subtype="calendar", params={"method": method, "charset": "UTF-8"})
    msg.add_attachment(ics, maintype="application", subtype="ics", filename="invite.ics")
    return msg
