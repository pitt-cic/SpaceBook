import os

# Handler modules read these at import time; set dummy values before any test
# imports a handler so module-level boto3 client/resource construction and
# os.environ[...] lookups succeed without touching real AWS.
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
# Force fake credentials (not setdefault) and drop any exported profile, so
# boto3 never resolves a real/SSO credential chain — an expired SSO token
# otherwise fails every moto test with TokenRetrievalError, and a live one
# would let an unmocked call reach real AWS.
os.environ.pop("AWS_PROFILE", None)
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ.pop("AWS_SESSION_TOKEN", None)
os.environ.setdefault("BOOKINGS_TABLE", "Bookings-test")
os.environ.setdefault("ROOMS_TABLE", "Rooms-test")
os.environ.setdefault("SITES_TABLE", "Sites-test")
os.environ.setdefault("CALENDAR_FEEDS_TABLE", "CalendarFeeds-test")
os.environ.setdefault("NOTIFY_FUNCTION_NAME", "notify-test")
os.environ.setdefault("REQUESTOR_USER_POOL_ID", "us-east-1_test")
os.environ.setdefault("STAFF_USER_POOL_ID", "us-east-1_stafftest")
os.environ.setdefault("SES_SENDER_EMAIL", "test@example.com")
os.environ.setdefault("ROOM_PHOTOS_BUCKET", "room-photos-test")
os.environ.setdefault("ROOM_PHOTOS_DOMAIN", "photos.example.net")

import importlib
import sys
from datetime import datetime
from pathlib import Path

import pytest

# moto only intercepts boto3 clients created after moto is imported, and the
# handlers build theirs at import time. Import it here, before any test module
# imports a handler, or a pure-logic test file that happens to import a handler
# first leaves every later moto test in that run calling real AWS.
import moto  # noqa: F401

# On Lambda each function's directory is the import root, so notify's handler
# does a top-level `from calendar_invite import ...`; mirror that here.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lambda" / "notify"))

# Fixture data uses fixed 2026 dates; pin "now" before them so the
# past-start-time check doesn't reject every booking once those dates pass.
PINNED_NOW = datetime(2026, 1, 5, 8, 0)


@pytest.fixture(autouse=True)
def pinned_now(monkeypatch):
    for name in ("requests_public", "requests_staff", "calendar_feed"):
        module = importlib.import_module(f"backend.lambda.{name}.handler")
        monkeypatch.setattr(module, "local_now", lambda: PINNED_NOW)
    return PINNED_NOW
