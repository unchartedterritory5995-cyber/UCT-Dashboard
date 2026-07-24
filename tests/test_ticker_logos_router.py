import os
from unittest import mock
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


def test_logo_served_when_cached(tmp_path):
    from api.services import ticker_logos as tl
    p = os.path.join(str(tmp_path), "NVDA.png")
    with open(p, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\ndata")
    with mock.patch.object(tl, "get_logo_path", return_value=p):
        r = client.get("/api/ticker-logo/NVDA")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert "max-age" in r.headers.get("cache-control", "")


def test_logo_miss_returns_transparent_and_schedules_resolve():
    from api.services import ticker_logos as tl
    with mock.patch.object(tl, "get_logo_path", return_value=None), \
         mock.patch.object(tl, "schedule_resolve") as sched:
        r = client.get("/api/ticker-logo/ZZZZ")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    # schedule_resolve gained optional name=/alt= hints; assert the intent (one
    # resolve scheduled for the missing symbol) rather than pinning the exact
    # kwarg set, which made this fail on a purely additive signature change.
    sched.assert_called_once()
    assert sched.call_args.args[0] == "ZZZZ"
