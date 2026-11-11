import os
import traceback
from datetime import datetime, timezone

import boto3

from calendar_invite import build_message, calendar_config, invite_recipients

ses = boto3.client("ses")
dynamodb = boto3.resource("dynamodb")
SENDER = os.environ["SES_SENDER_EMAIL"]
bookings_table = dynamodb.Table(os.environ["BOOKINGS_TABLE"])
rooms_table = dynamodb.Table(os.environ["ROOMS_TABLE"])
sites_table = dynamodb.Table(os.environ["SITES_TABLE"])
# Requester emails that the calendar invite replaces, keyed by invite method.
INVITE_CARRIED_TYPES = {"approved": "REQUEST", "cancellation_confirmed": "CANCEL"}
REQUESTER_TEXT_TYPE = {method: t for t, method in INVITE_CARRIED_TYPES.items()}


def handler(event, _context):
    """Invoked directly by other Lambdas (lambda:InvokeFunction), not exposed
    via API Gateway. Payload: {"type": "...", "request": {...}, "reason": optional}.
    Covers the request lifecycle notifications: submitted, approved, denied
    (with reason), modified/counter-proposed, cancellation confirmed. type
    "calendar_invite" instead sends iCalendar invites (send_calendar_invites)."""
    notification_type = event.get("type")
    if notification_type == "calendar_invite":
        return send_calendar_invites(event.get("method"), event.get("requests", []))
    request_item = event.get("request", {})
    reason = event.get("reason")

    # With invites on, a booking that's on the calendar (calendarSequence set)
    # gets its approval/cancellation email as the calendar invite instead, so
    # the requester receives one email, not two.
    if (notification_type in INVITE_CARRIED_TYPES and "calendarSequence" in request_item
            and calendar_config(request_item.get("site"))):
        return {"sent": False, "carriedByInvite": True}

    subject, body = render(notification_type, request_item, reason, event.get("roomName"))
    if not subject:
        return {"sent": False}

    recipient = request_item.get("email")
    if not recipient:
        return {"sent": False}

    ses.send_email(
        Source=SENDER,
        Destination={"ToAddresses": [recipient]},
        Message={
            "Subject": {"Data": subject},
            "Body": {"Text": {"Data": body}},
        },
    )
    return {"sent": True}


def send_calendar_invites(method, request_items):
    """One email per booking occurrence per recipient (iTIP allows only one
    UID per message; one recipient per copy keeps addresses private). The
    requester's copy carries their usual approval/cancellation text. Each
    booking's result is recorded as calendarInvite so staff can see it; any
    failure is re-raised after the loop so Lambda's async retries run. A
    retry resends the same UID + SEQUENCE, which calendars treat as the same
    message."""
    if os.environ.get("CALENDAR_INVITES_ENABLED", "false").lower() != "true":
        return {"sent": False}
    failures = 0
    for request_item in request_items:
        sequence = int(request_item.get("calendarSequence") or 0)
        errors = []
        try:
            config = calendar_config(request_item.get("site"))
            site_label, room_name = place_names(request_item)
            location = f"{site_label} · {room_name}"
            recipients = invite_recipients(request_item, config)
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            recipients, errors = [], [str(exc)]
        for recipient, role in recipients:
            subject = text = None
            if role == "requester":
                subject, text = render(REQUESTER_TEXT_TYPE[method], request_item, None, room_name)
            try:
                msg = build_message(request_item, method, config, location, recipient, role, subject, text)
                ses.send_raw_email(
                    Source=config["sender"],
                    Destinations=[recipient],
                    RawMessage={"Data": msg.as_bytes()},
                )
            except Exception as exc:  # noqa: BLE001 — record it, then retry via Lambda
                traceback.print_exc()
                errors.append(f"{role}: {exc}")
        result = {"status": "sent", "method": method, "sequence": sequence, "recipients": len(recipients)}
        if errors or not recipients:
            failures += 1
            result.update(status="failed", error="; ".join(errors or ["No recipients"])[:500])
        record_invite_result(request_item, result)
    if failures:
        raise RuntimeError(f"Calendar invites failed for {failures} of {len(request_items)} bookings")
    return {"sent": True}


def place_names(request_item):
    """(site label, room name), falling back to the ids."""
    site = request_item.get("site", "")
    room = request_item.get("room", "")
    site_item = sites_table.get_item(Key={"PK": f"SITE#{site}", "SK": "CONFIG"}).get("Item") or {}
    room_item = rooms_table.get_item(Key={"PK": f"SITE#{site}", "SK": f"ROOM#{room}"}).get("Item") or {}
    return site_item.get("label") or site, room_item.get("name") or room


def record_invite_result(request_item, result):
    """Best-effort: never let the bookkeeping write fail the send. The
    condition skips a late-finishing older message (lower sequence) so it
    can't overwrite a newer result, and never recreates a moved/deleted item."""
    result["at"] = datetime.now(timezone.utc).isoformat()
    try:
        bookings_table.update_item(
            Key={"PK": request_item["PK"], "SK": request_item["SK"]},
            UpdateExpression="SET calendarInvite = :result",
            ConditionExpression=(
                "attribute_exists(PK) AND "
                "(attribute_not_exists(calendarInvite) OR calendarInvite.#seq <= :seq)"
            ),
            ExpressionAttributeNames={"#seq": "sequence"},
            ExpressionAttributeValues={":result": result, ":seq": result["sequence"]},
        )
    except bookings_table.meta.client.exceptions.ConditionalCheckFailedException:
        pass
    except Exception:  # noqa: BLE001
        traceback.print_exc()


def render(notification_type, request_item, reason, room_name=None):
    title = request_item.get("title", "your request")
    request_id = request_item.get("id", "")
    date = request_item.get("date", "")

    if notification_type == "submitted":
        return (
            f"Request received: {title}",
            f"Your space request \"{title}\" ({request_id}) for {date} has been received "
            f"and is pending review by CEC staff. Estimated response time: 2-3 business days.",
        )
    if notification_type == "approved":
        return (
            f"Request approved: {title}",
            f"Your space request \"{title}\" ({request_id}) for {date} "
            f"from {request_item.get('start')} to {request_item.get('end')} has been approved"
            f"{f' in {room_name}' if room_name else ''}.",
        )
    if notification_type == "denied":
        reason_text = f" Reason: {reason}" if reason else ""
        return (
            f"Request denied: {title}",
            f"Your space request \"{title}\" ({request_id}) for {date} has been denied.{reason_text}",
        )
    if notification_type == "modified":
        proposal = request_item.get("counterProposal", {})
        return (
            f"Alternative proposed for: {title}",
            f"CEC staff have proposed an alternative for \"{title}\" ({request_id}): "
            f"room {proposal.get('room')} on {proposal.get('date')} from "
            f"{proposal.get('start')} to {proposal.get('end')}. "
            f"Sign in to your requestor account to accept or decline.",
        )
    if notification_type == "cancellation_confirmed":
        return (
            f"Cancellation confirmed: {title}",
            f"Your cancellation request for \"{title}\" ({request_id}) on {date} has been confirmed.",
        )
    return (None, None)
