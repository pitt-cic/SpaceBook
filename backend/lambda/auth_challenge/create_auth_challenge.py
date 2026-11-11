import os
import random

import boto3

ses = boto3.client("ses")
SENDER = os.environ["SES_SENDER_EMAIL"]

CODE_METADATA_PREFIX = "CODE-"


def handler(event, _context):
    request = event["request"]

    if request.get("challengeName") == "CUSTOM_CHALLENGE":
        session = request.get("session") or []
        code = _previous_code(session) or _generate_code()

        email = request["userAttributes"].get("email")
        if not email:
            raise ValueError(
                "No account found for this email. Please submit a space request first."
            )
        _send_code(email, code)

        event["response"]["publicChallengeParameters"] = {"email": email}
        event["response"]["privateChallengeParameters"] = {"answer": code}
        event["response"]["challengeMetadata"] = f"{CODE_METADATA_PREFIX}{code}"

    return event


def _previous_code(session):
    if not session:
        return None
    metadata = session[-1].get("challengeMetadata", "") or ""
    if metadata.startswith(CODE_METADATA_PREFIX):
        return metadata[len(CODE_METADATA_PREFIX):]
    return None


def _generate_code():
    return f"{random.randint(0, 999999):06d}"


def _send_code(email, code):
    ses.send_email(
        Source=SENDER,
        Destination={"ToAddresses": [email]},
        Message={
            "Subject": {"Data": "Your Meeting Booking sign-in code"},
            "Body": {"Text": {"Data": f"Your one-time sign-in code is {code}. It expires in 5 minutes."}},
        },
    )
