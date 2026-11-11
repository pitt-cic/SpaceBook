import json

import boto3
import pytest
from moto import mock_aws

from backend.tests.test_rooms_admin_moto import _create_rooms_table, _event, rooms_admin_handler
from backend.tests.test_sites_admin_moto import _create_sites_table

UPLOAD = "/api/admin/sites/{site}/room-photos"
PREFIX = "https://photos.example.net/rooms/homewood/"


@pytest.fixture
def aws():
    with mock_aws():
        _create_rooms_table()
        _create_sites_table()
        rooms_admin_handler.sites_table.put_item(Item={"PK": "SITE#homewood", "SK": "CONFIG", "id": "homewood"})
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket="room-photos-test")
        yield s3


def _upload(site="homewood", content_type="image/jpeg", groups=("admin",)):
    return rooms_admin_handler.handler(_event("POST", UPLOAD, {"site": site}, body={"contentType": content_type}, groups=groups), None)


def _photo_url(aws):
    body = json.loads(_upload()["body"])
    key = body["photoUrl"].removeprefix("https://photos.example.net/")
    aws.put_object(Bucket="room-photos-test", Key=key, Body=b"jpeg")
    return body["photoUrl"], key


def test_upload_returns_a_size_limited_presigned_post_for_the_site(aws):
    result = _upload()
    assert result["statusCode"] == 201
    body = json.loads(result["body"])
    assert body["photoUrl"].startswith(PREFIX) and body["photoUrl"].endswith(".jpg")
    assert body["upload"]["fields"]["key"] == body["photoUrl"].removeprefix("https://photos.example.net/")
    assert body["upload"]["fields"]["Content-Type"] == "image/jpeg"
    assert "policy" in body["upload"]["fields"]


@pytest.mark.parametrize("kwargs, status", [
    ({"content_type": "image/gif"}, 400),
    ({"content_type": "text/html"}, 400),
    ({"site": "nowhere"}, 404),
    ({"groups": ("staff-homewood",)}, 403),
])
def test_upload_rejects_bad_type_unknown_site_and_non_admins(aws, kwargs, status):
    assert _upload(**kwargs)["statusCode"] == status


def test_room_saves_uploaded_photos_and_deletes_removed_ones(aws):
    (url_a, _), (url_b, key_b) = _photo_url(aws), _photo_url(aws)
    created = json.loads(rooms_admin_handler.handler(
        _event("POST", "/api/sites/{site}/rooms", {"site": "homewood"}, body={"name": "Gallery", "photos": [url_a, url_b]}), None,
    )["body"])
    assert created["photos"] == [url_a, url_b]

    path = {"site": "homewood", "roomId": created["id"]}
    updated = rooms_admin_handler.handler(_event("PUT", "/api/sites/{site}/rooms/{roomId}", path, body={"photos": [url_b]}), None)
    assert json.loads(updated["body"])["photos"] == [url_b]
    keys = [o["Key"] for o in aws.list_objects_v2(Bucket="room-photos-test").get("Contents", [])]
    assert keys == [key_b]


@pytest.mark.parametrize("photos", [
    ["https://example.com/a.jpg"],
    [PREFIX.replace("homewood", "hill-district") + "0" * 32 + ".jpg"],
    [PREFIX + "../x.jpg"],
    "not-a-list",
    [PREFIX + f"{i:032x}.jpg" for i in range(6)],
])
def test_room_photos_must_be_this_sites_uploads_and_at_most_five(aws, photos):
    result = rooms_admin_handler.handler(
        _event("POST", "/api/sites/{site}/rooms", {"site": "homewood"}, body={"name": "Gallery", "photos": photos}), None,
    )
    assert result["statusCode"] == 400
