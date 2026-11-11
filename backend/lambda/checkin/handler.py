import json


def handler(_event, _context):
    """Future-phase placeholder for visitor check-in (booking check-in lives in
    requests_staff). Not wired to any API Gateway route yet; kept as a minimal,
    valid deployable unit so the directory/CDK convention is in place for that
    phase to fill in."""
    return {
        "statusCode": 501,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
        },
        "body": json.dumps({"message": "checkin is a phase 2 feature, not yet implemented"}),
    }
