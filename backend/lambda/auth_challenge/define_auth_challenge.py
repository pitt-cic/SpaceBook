MAX_ATTEMPTS = 3


def handler(event, _context):
    session = event["request"]["session"]

    if len(session) == 0:
        event["response"]["challengeName"] = "CUSTOM_CHALLENGE"
        event["response"]["issueTokens"] = False
        event["response"]["failAuthentication"] = False
    elif session[-1]["challengeName"] == "CUSTOM_CHALLENGE" and session[-1]["challengeResult"] is True:
        event["response"]["issueTokens"] = True
        event["response"]["failAuthentication"] = False
    elif len(session) >= MAX_ATTEMPTS and session[-1]["challengeResult"] is False:
        event["response"]["issueTokens"] = False
        event["response"]["failAuthentication"] = True
    else:
        event["response"]["challengeName"] = "CUSTOM_CHALLENGE"
        event["response"]["issueTokens"] = False
        event["response"]["failAuthentication"] = False

    return event
