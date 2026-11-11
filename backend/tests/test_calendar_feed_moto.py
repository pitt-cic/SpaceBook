import importlib
import json

import boto3
from moto import mock_aws

feed_handler = importlib.import_module("backend.lambda.calendar_feed.handler")

GROUPS = ["admin", "staff-homewood", "staff-oakland", "checkin-homewood"]


def _create_table(name, gsi=False):
    attrs = [{"AttributeName": "PK", "AttributeType": "S"}, {"AttributeName": "SK", "AttributeType": "S"}]
    kwargs = {}
    if gsi:
        attrs += [{"AttributeName": "GSI2PK", "AttributeType": "S"}, {"AttributeName": "GSI2SK", "AttributeType": "S"}]
        kwargs["GlobalSecondaryIndexes"] = [{
            "IndexName": "BySiteStatus",
            "KeySchema": [
                {"AttributeName": "GSI2PK", "KeyType": "HASH"},
                {"AttributeName": "GSI2SK", "KeyType": "RANGE"},
            ],
            "Projection": {"ProjectionType": "ALL"},
        }]
    boto3.client("dynamodb", region_name="us-east-1").create_table(
        TableName=name,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=attrs,
        KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
        **kwargs,
    )


def _setup(monkeypatch, groups=("staff-homewood",)):
    _create_table("Bookings-test", gsi=True)
    _create_table("Rooms-test")
    _create_table("Sites-test")
    _create_table("CalendarFeeds-test")

    for site_id, label, active in [("homewood", "Homewood CEC", True), ("oakland", "Oakland", True),
                                   ("closed", "Closed Site", False)]:
        feed_handler.sites_table.put_item(Item={
            "PK": f"SITE#{site_id}", "SK": "CONFIG", "id": site_id, "label": label, "active": active,
        })
    feed_handler.rooms_table.put_item(Item={"PK": "SITE#homewood", "SK": "ROOM#r1", "id": "r1", "name": "Room 101"})
    feed_handler.rooms_table.put_item(Item={"PK": "SITE#oakland", "SK": "ROOM#r9", "id": "r9", "name": "Room 909"})

    client = boto3.client("cognito-idp", region_name="us-east-1")
    pool_id = client.create_user_pool(PoolName="staff-pool-test")["UserPool"]["Id"]
    monkeypatch.setattr(feed_handler, "STAFF_USER_POOL_ID", pool_id)
    for group in GROUPS:
        client.create_group(UserPoolId=pool_id, GroupName=group)
    client.admin_create_user(UserPoolId=pool_id, Username="jane", MessageAction="SUPPRESS")
    for group in groups:
        client.admin_add_user_to_group(UserPoolId=pool_id, Username="jane", GroupName=group)
    return client, pool_id


def _booking(site, request_id, status, date="2026-03-10", room="r1", title=None):
    feed_handler.bookings_table.put_item(Item={
        "PK": f"SITE#{site}",
        "SK": f"ROOM#{room}#DATE#{date}#REQ#{request_id}",
        "GSI2PK": f"SITE#{site}",
        "GSI2SK": f"STATUS#{status}#DATE#{date}#REQ#{request_id}",
        "id": request_id,
        "site": site,
        "room": room,
        "date": date,
        "start": "09:00",
        "end": "10:00",
        "title": title or f"Event {request_id}",
        "org": "Acme",
        "status": status,
        "updatedAt": "2026-01-01T00:00:00+00:00",
    })


def _token_event(method, groups=("staff-homewood",), username="jane"):
    return {
        "httpMethod": method,
        "resource": "/api/calendar/token",
        "requestContext": {"authorizer": {"claims": {
            "cognito:groups": ",".join(groups), "cognito:username": username,
        }}},
    }


def _feed_event(token, site=None):
    return {
        "httpMethod": "GET",
        "resource": "/api/calendar/feed/{token}",
        "pathParameters": {"token": f"{token}.ics"},
        "queryStringParameters": {"site": site} if site else None,
    }


def _create_token(groups=("staff-homewood",)):
    result = feed_handler.handler(_token_event("POST", groups), None)
    assert result["statusCode"] == 200
    return json.loads(result["body"])["token"]


def _uids(result):
    return {line[len("UID:"):] for line in result["body"].split("\r\n") if line.startswith("UID:")}


@mock_aws
def test_get_token_is_null_until_created(monkeypatch):
    _setup(monkeypatch)
    result = feed_handler.handler(_token_event("GET"), None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"]) == {"token": None}

    token = _create_token()
    result = feed_handler.handler(_token_event("GET"), None)
    assert json.loads(result["body"]) == {"token": token}


@mock_aws
def test_reset_invalidates_the_old_link(monkeypatch):
    _setup(monkeypatch)
    old = _create_token()
    new = _create_token()
    assert old != new
    assert feed_handler.handler(_feed_event(old), None)["statusCode"] == 404
    assert feed_handler.handler(_feed_event(new), None)["statusCode"] == 200


@mock_aws
def test_reset_conflicts_if_token_changed_underneath(monkeypatch):
    _setup(monkeypatch)
    _create_token()
    real_get = feed_handler.feeds_table.get_item
    # Simulate a concurrent reset: we read a token that's already been replaced.
    monkeypatch.setattr(feed_handler.feeds_table, "get_item",
                        lambda **kw: {"Item": {"token": "stale-token"}} if kw["Key"]["PK"].startswith("USER#")
                        else real_get(**kw))
    result = feed_handler.handler(_token_event("POST"), None)
    assert result["statusCode"] == 409


@mock_aws
def test_token_routes_require_a_staff_group(monkeypatch):
    _setup(monkeypatch)
    result = feed_handler.handler(_token_event("POST", groups=("checkin-homewood",)), None)
    assert result["statusCode"] == 403


@mock_aws
def test_feed_includes_only_held_bookings(monkeypatch):
    _setup(monkeypatch)
    for request_id, status in [("A", "approved"), ("B", "cancellation_requested"), ("C", "pending_approval"),
                               ("D", "denied"), ("E", "cancelled"), ("F", "counter_proposed")]:
        _booking("homewood", request_id, status)
    token = _create_token()

    result = feed_handler.handler(_feed_event(token), None)
    assert result["statusCode"] == 200
    assert result["headers"]["Content-Type"].startswith("text/calendar")
    assert _uids(result) == {"A@spacebook-feed", "B@spacebook-feed"}
    assert "LOCATION:Room 101\\, Homewood CEC" in result["body"]
    assert "X-WR-CALNAME:SpaceBook – Homewood CEC" in result["body"]


@mock_aws
def test_feed_skips_bookings_older_than_the_window(monkeypatch):
    _setup(monkeypatch)
    # local_now is pinned to 2026-01-05, so the window starts 2025-11-06.
    _booking("homewood", "OLD", "approved", date="2025-10-01")
    _booking("homewood", "NEW", "approved", date="2025-12-01")
    token = _create_token()
    assert _uids(feed_handler.handler(_feed_event(token), None)) == {"NEW@spacebook-feed"}


@mock_aws
def test_staff_feed_is_scoped_to_their_sites(monkeypatch):
    _setup(monkeypatch, groups=("staff-homewood",))
    _booking("homewood", "H", "approved")
    _booking("oakland", "O", "approved", room="r9")
    token = _create_token()

    assert _uids(feed_handler.handler(_feed_event(token), None)) == {"H@spacebook-feed"}
    # A site outside their access is an empty calendar, not an error.
    result = feed_handler.handler(_feed_event(token, site="oakland"), None)
    assert result["statusCode"] == 200
    assert _uids(result) == set()


@mock_aws
def test_admin_feed_covers_every_active_site_and_filters_by_site(monkeypatch):
    _setup(monkeypatch, groups=("admin",))
    _booking("homewood", "H", "approved")
    _booking("oakland", "O", "approved", room="r9")
    _booking("closed", "X", "approved")
    token = _create_token(groups=("admin",))

    result = feed_handler.handler(_feed_event(token), None)
    assert _uids(result) == {"H@spacebook-feed", "O@spacebook-feed"}
    assert "X-WR-CALNAME:SpaceBook – All my sites" in result["body"]
    assert _uids(feed_handler.handler(_feed_event(token, site="oakland"), None)) == {"O@spacebook-feed"}


@mock_aws
def test_removing_site_access_empties_the_feed(monkeypatch):
    client, pool_id = _setup(monkeypatch, groups=("staff-homewood",))
    _booking("homewood", "H", "approved")
    token = _create_token()
    assert _uids(feed_handler.handler(_feed_event(token), None)) == {"H@spacebook-feed"}

    client.admin_remove_user_from_group(UserPoolId=pool_id, Username="jane", GroupName="staff-homewood")
    result = feed_handler.handler(_feed_event(token), None)
    assert result["statusCode"] == 200
    assert _uids(result) == set()


@mock_aws
def test_disabled_or_deleted_user_feed_empties(monkeypatch):
    # Empty rather than an error, so Outlook drops its cached copy on refresh.
    client, pool_id = _setup(monkeypatch)
    _booking("homewood", "H", "approved")
    token = _create_token()
    client.admin_disable_user(UserPoolId=pool_id, Username="jane")
    result = feed_handler.handler(_feed_event(token), None)
    assert result["statusCode"] == 200
    assert _uids(result) == set()

    client.admin_delete_user(UserPoolId=pool_id, Username="jane")
    result = feed_handler.handler(_feed_event(token), None)
    assert result["statusCode"] == 200
    assert _uids(result) == set()


@mock_aws
def test_unknown_token_is_not_found(monkeypatch):
    _setup(monkeypatch)
    assert feed_handler.handler(_feed_event("nope"), None)["statusCode"] == 404
