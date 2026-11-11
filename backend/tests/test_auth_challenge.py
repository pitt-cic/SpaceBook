import importlib

define_auth_challenge = importlib.import_module("backend.lambda.auth_challenge.define_auth_challenge")
verify_auth_challenge = importlib.import_module("backend.lambda.auth_challenge.verify_auth_challenge")


def _define_event(session):
    return {"request": {"session": session}, "response": {}}


def test_first_attempt_issues_a_challenge():
    event = define_auth_challenge.handler(_define_event([]), None)
    assert event["response"]["challengeName"] == "CUSTOM_CHALLENGE"
    assert event["response"]["issueTokens"] is False
    assert event["response"]["failAuthentication"] is False


def test_correct_answer_issues_tokens():
    session = [{"challengeName": "CUSTOM_CHALLENGE", "challengeResult": True}]
    event = define_auth_challenge.handler(_define_event(session), None)
    assert event["response"]["issueTokens"] is True
    assert event["response"]["failAuthentication"] is False


def test_three_failed_attempts_fails_authentication():
    session = [{"challengeName": "CUSTOM_CHALLENGE", "challengeResult": False}] * 3
    event = define_auth_challenge.handler(_define_event(session), None)
    assert event["response"]["failAuthentication"] is True
    assert event["response"]["issueTokens"] is False


def test_verify_accepts_matching_code():
    event = {
        "request": {"privateChallengeParameters": {"answer": "123456"}, "challengeAnswer": "123456"},
        "response": {},
    }
    result = verify_auth_challenge.handler(event, None)
    assert result["response"]["answerCorrect"] is True


def test_verify_rejects_wrong_code():
    event = {
        "request": {"privateChallengeParameters": {"answer": "123456"}, "challengeAnswer": "000000"},
        "response": {},
    }
    result = verify_auth_challenge.handler(event, None)
    assert result["response"]["answerCorrect"] is False
