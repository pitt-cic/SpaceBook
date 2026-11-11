def handler(event, _context):
    expected = event["request"]["privateChallengeParameters"]["answer"]
    actual = event["request"]["challengeAnswer"]
    event["response"]["answerCorrect"] = expected == actual
    return event
