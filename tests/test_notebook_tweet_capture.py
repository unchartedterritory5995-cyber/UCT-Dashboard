"""Import a tweet, Task 2 -- the read side (`api/services/journal_two/tweet_capture.py`, the
`tweets_router` in `api/routers/notebook_research_capture.py`, `twitterapi_io.get_tweets_by_ids`).

What each section proves:
  * THE LINK: only a post link on exactly x.com / twitter.com (optionally www. / mobile.) yields
    an id; a look-alike host or a profile link yields None.
  * RESOLVE: the store answers first with NO vendor call; a vendor hit is NEVER written to
    tweets.db; a missing post is a 404 with its sentence; a vendor failure is a 503 with its
    sentence; the vendor is asked for the NUMERIC ID, never the member's URL.
  * RECENT: the Post shape (camelCase, no raw_json, tickers and media on every row, avatar from
    the stored payload, kind from the account); both scopes; the refusals.
  * THE DOOR: every route is a 404 while the flag is off (read per request), paid-only, and the
    resolve rate-limit refusal is its own 429.
  * THE VENDOR HELPER: `get_tweets_by_ids` normalizes, and `find_deleted_tweet_ids` still behaves.
Fixtures use invented handles and ids.
"""
from __future__ import annotations

import json
import os
import tempfile
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import tweet_store, twitterapi_io
from api.services.journal_two import tweet_capture

UID = "user-tw-a"
NOW = int(time.time())
AVATAR = "https://pbs.twimg.com/profile_images/111/fake_normal.jpg"
IMG = "https://pbs.twimg.com/media/FakeImg123.jpg"
RAW = json.dumps({"author": {"profilePicture": AVATAR}, "extendedEntities": {"media": [{"media_url_https": IMG}]}})


# ── fixtures ────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def store(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(tweet_store, "_DB_PATH", os.path.join(d, "tweets.db"))
        tweet_store._init_db()
        yield tweet_store


def _row(tid, handle="fakedesk_one", text="$NVDA is moving", created_at=None, raw=RAW, name=None):
    return {
        "id": tid, "author_handle": handle, "author_name": name or handle.upper(),
        "text": text, "created_at": created_at or NOW - 3600,
        "url": f"https://x.com/{handle}/status/{tid}",
        "reply_count": 0, "like_count": 0, "retweet_count": 0, "is_retweet": 0, "raw_json": raw,
    }


@pytest.fixture
def vendor(monkeypatch):
    """Records every vendor call; `answer` is what get_tweets_by_ids returns (or raises)."""
    calls = []
    box = {"answer": []}

    def fake(ids):
        calls.append(list(ids))
        if isinstance(box["answer"], Exception):
            raise box["answer"]
        return box["answer"]

    monkeypatch.setattr(twitterapi_io, "get_tweets_by_ids", fake)
    box["calls"] = calls
    return box


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv("NOTEBOOK_TWEET_IMPORT_ENABLED", "1")


@pytest.fixture
def client(store, monkeypatch):
    from api.routers import notebook_research_capture as r
    app = FastAPI()
    app.include_router(r.tweets_router)
    user = {"id": UID, "role": "member", "plan": "pro"}
    app.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)
    app.state.user = user
    yield TestClient(app)
    app.dependency_overrides.clear()


# ── the link ────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url,want", [
    ("https://x.com/a_b/status/123", "123"),
    ("https://twitter.com/a_b/status/123?s=20", "123"),
    ("https://mobile.twitter.com/a_b/status/123/photo/1", "123"),
    ("x.com/a_b/status/123", "123"),
    ("https://www.x.com/a_b/status/123", "123"),
    ("  https://x.com/a_b/status/123  ", "123"),
    ("https://x.com.evil.test/a/status/123", None),
    ("https://notx.com/a/status/123", None),
    ("https://evil.test/x.com/a/status/123", None),
    ("https://x.com@evil.test/a/status/123", None),
    ("https://x.com/a_b", None),
    ("https://x.com/a_b/status/abc", None),
    ("not a link", None),
    ("", None),
    (None, None),
    (12345, None),
])
def test_parse_status_id(url, want):
    assert tweet_capture.parse_status_id(url) == want


# ── resolve ─────────────────────────────────────────────────────────────────────────────

def test_resolve_prefers_the_store_and_makes_no_vendor_call(store, vendor):
    store.upsert_tweet(_row("9001"), ["NVDA"])
    post = tweet_capture.resolve_link("https://x.com/anyone/status/9001")
    assert post["id"] == "9001"
    assert post["handle"] == "fakedesk_one"
    assert post["tickers"] == ["NVDA"]
    assert vendor["calls"] == []


def test_resolve_vendor_hit_is_not_written_to_tweets_db(store, vendor):
    vendor["answer"] = [_row("9002", handle="fakeperson", text="Long $AAPL and $BRK.B today")]
    before = store.count_tweets()
    post = tweet_capture.resolve_link("https://twitter.com/fakeperson/status/9002?s=20")
    assert post["id"] == "9002"
    assert post["tickers"] == ["AAPL", "BRK-B"]
    assert post["media"] and post["media"][0].startswith(IMG)
    assert post["avatarUrl"] == AVATAR
    assert post["kind"] == "commentary"          # an author UCT does not track
    assert store.count_tweets() == before == 0
    assert store.count_ticker_links() == 0
    assert store.get_tweet("9002") is None


def test_resolve_asks_the_vendor_by_numeric_id_never_the_url(store, vendor):
    vendor["answer"] = [_row("9003")]
    tweet_capture.resolve_link("https://x.com/a_b/status/9003/photo/1?utm=http://169.254.169.254/")
    assert vendor["calls"] == [["9003"]]


def test_resolve_missing_post_is_404_with_sentence(store, vendor):
    vendor["answer"] = []
    with pytest.raises(tweet_capture.TweetCaptureError) as e:
        tweet_capture.resolve_link("https://x.com/a_b/status/9004")
    assert e.value.status == 404
    assert str(e.value) == "That post could not be found. It may be deleted or private."


def test_resolve_ignores_a_vendor_row_for_a_different_id(store, vendor):
    vendor["answer"] = [_row("5555")]
    with pytest.raises(tweet_capture.TweetCaptureError) as e:
        tweet_capture.resolve_link("https://x.com/a_b/status/9004")
    assert e.value.status == 404


@pytest.mark.parametrize("exc", [
    twitterapi_io.TwitterApiTransientError("boom"),
    twitterapi_io.TwitterApiAuthError("nope"),
    twitterapi_io.TwitterApiPaymentRequired("credits"),
    twitterapi_io.TwitterApiRateLimited("slow"),
    twitterapi_io.TwitterApiConfigError("no key"),
])
def test_resolve_vendor_error_is_503_with_sentence(store, vendor, exc):
    vendor["answer"] = exc
    with pytest.raises(tweet_capture.TweetCaptureError) as e:
        tweet_capture.resolve_link("https://x.com/a_b/status/9005")
    assert e.value.status == 503
    assert str(e.value) == "X is not answering right now. Try again in a moment."


def test_resolve_a_non_post_link_is_a_400_and_no_call(store, vendor):
    with pytest.raises(tweet_capture.TweetCaptureError) as e:
        tweet_capture.resolve_link("https://x.com/a_b")
    assert e.value.status == 400
    assert vendor["calls"] == []


# ── recent ──────────────────────────────────────────────────────────────────────────────

def _seed(store):
    store.set_account_content_kind  # exists
    store.add_account("fakedesk_one", "Fake Desk One")
    store.set_account_content_kind("fakedesk_one", "news")
    store.upsert_tweet(_row("1", text="$NVDA up"), ["NVDA"])
    store.upsert_tweet(_row("2", handle="fakevoice", text="$NVDA and $AMD", created_at=NOW - 7200, raw="{}"),
                       ["NVDA", "AMD"])
    store.upsert_tweet(_row("3", handle="fakevoice", text="$AMD only", created_at=NOW - 10800, raw="{}"),
                       ["AMD"])
    store.upsert_tweet(_row("4", text="$NVDA old", created_at=NOW - 200 * 3600), ["NVDA"])


def test_recent_shape_has_no_raw_json(store):
    _seed(store)
    posts = tweet_capture.recent("NVDA", "ticker")
    assert [p["id"] for p in posts] == ["1", "2"]            # newest first, the 200h-old one is out
    want = {"id", "name", "handle", "avatarUrl", "text", "postedAt", "url", "tickers", "media", "kind"}
    for p in posts:
        assert set(p) == want
        assert "raw_json" not in p
        assert isinstance(p["tickers"], list) and isinstance(p["media"], list)
        assert isinstance(p["postedAt"], int)
    first, second = posts
    assert first["avatarUrl"] == AVATAR and first["media"][0].startswith(IMG)
    assert first["kind"] == "news"
    assert second["avatarUrl"] is None and second["media"] == []
    assert second["kind"] == "commentary"                    # unknown to the account list
    assert sorted(second["tickers"]) == ["AMD", "NVDA"]      # tickers attached for a ticker query


def test_recent_all_is_the_feed(store):
    _seed(store)
    posts = tweet_capture.recent(None, "all")
    assert [p["id"] for p in posts] == ["1", "2", "3"]
    assert all("raw_json" not in p for p in posts)


def test_recent_does_not_change_what_the_existing_routes_return(store):
    """with_links must not mutate rows `tweets_for_ticker` hands back, and that function keeps
    its bare shape."""
    _seed(store)
    rows = store.tweets_for_ticker("NVDA", hours=168)
    assert "tickers" not in rows[0] and "media" not in rows[0]
    store.with_links(rows)
    assert "tickers" not in rows[0]


def test_recent_dual_class_symbol(store):
    store.upsert_tweet(_row("7", text="$BRK.B holds"), ["BRK-B"])
    for spelling in ("BRK.B", "brk-b", "$BRK.B"):
        assert [p["id"] for p in tweet_capture.recent(spelling, "ticker")] == ["7"]


@pytest.mark.parametrize("symbol,scope", [
    (None, "ticker"), ("", "ticker"), ("   ", "ticker"), ("<script>", "ticker"),
    ("NVDA", "everything"), (None, ""), ("NVDA", "TICKER"),
])
def test_recent_refusals_are_400(store, symbol, scope):
    with pytest.raises(tweet_capture.TweetCaptureError) as e:
        tweet_capture.recent(symbol, scope)
    assert e.value.status == 400


# ── the door ────────────────────────────────────────────────────────────────────────────

def test_routes_404_when_flag_off(client, vendor, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_TWEET_IMPORT_ENABLED", raising=False)
    assert client.get("/api/j2/research-capture/tweets/recent?scope=all").status_code == 404
    r = client.post("/api/j2/research-capture/tweets/resolve", json={"url": "https://x.com/a/status/1"})
    assert r.status_code == 404
    assert vendor["calls"] == []


def test_the_flag_is_read_per_request(client, store, monkeypatch):
    monkeypatch.setenv("NOTEBOOK_TWEET_IMPORT_ENABLED", "1")
    assert client.get("/api/j2/research-capture/tweets/recent?scope=all").status_code == 200
    monkeypatch.setenv("NOTEBOOK_TWEET_IMPORT_ENABLED", "0")
    assert client.get("/api/j2/research-capture/tweets/recent?scope=all").status_code == 404


def test_routes_are_paid_only(client, flag_on, monkeypatch):
    # The module's own require_paid: a free plan reads 402 on both routes.
    app = client.app
    free = {"id": UID, "role": "member", "plan": "free"}
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(free)
    assert client.get("/api/j2/research-capture/tweets/recent?scope=all").status_code == 402
    r = client.post("/api/j2/research-capture/tweets/resolve", json={"url": "https://x.com/a/status/1"})
    assert r.status_code == 402


def test_recent_route(client, flag_on, store):
    _seed(store)
    r = client.get("/api/j2/research-capture/tweets/recent?symbol=NVDA&scope=ticker")
    assert r.status_code == 200
    assert [p["id"] for p in r.json()["posts"]] == ["1", "2"]
    r = client.get("/api/j2/research-capture/tweets/recent?scope=ticker")
    assert r.status_code == 400
    assert client.get("/api/j2/research-capture/tweets/recent?scope=nope").status_code == 400


def test_resolve_route(client, flag_on, store, vendor):
    vendor["answer"] = [_row("9100", handle="fakeperson")]
    r = client.post("/api/j2/research-capture/tweets/resolve", json={"url": "https://x.com/fakeperson/status/9100"})
    assert r.status_code == 200 and r.json()["post"]["id"] == "9100"
    assert store.count_tweets() == 0
    vendor["answer"] = []
    r = client.post("/api/j2/research-capture/tweets/resolve", json={"url": "https://x.com/fakeperson/status/9101"})
    assert r.status_code == 404 and "could not be found" in r.json()["detail"]
    vendor["answer"] = twitterapi_io.TwitterApiTransientError("x")
    r = client.post("/api/j2/research-capture/tweets/resolve", json={"url": "https://x.com/fakeperson/status/9102"})
    assert r.status_code == 503
    for bad in ({}, {"url": 5}, {"url": ""}, {"url": "https://x.com/a"}, {"url": "x" * 5000}):
        assert client.post("/api/j2/research-capture/tweets/resolve", json=bad).status_code == 400


def test_resolve_rate_limit_is_its_own_429(client, flag_on, store, vendor, monkeypatch):
    from api.limiter import limiter
    from api.routers import notebook_research_capture as r
    monkeypatch.setattr(limiter, "enabled", True)
    monkeypatch.setattr(r, "TWEET_RESOLVE_RATE", "2/minute")
    monkeypatch.setattr(r, "SCOPE_TWEET_RESOLVE", f"notebook-tweet-resolve-test-{time.time_ns()}")
    vendor["answer"] = []
    codes = [client.post("/api/j2/research-capture/tweets/resolve",
                         json={"url": f"https://x.com/a/status/{i}"}).status_code for i in range(3)]
    assert codes == [404, 404, 429]
    last = client.post("/api/j2/research-capture/tweets/resolve", json={"url": "https://x.com/a/status/9"})
    assert last.json()["detail"] == r.TWEET_RESOLVE_RATE_SENTENCE
    assert len(vendor["calls"]) == 2          # the refused press spent no vendor call


def test_the_scope_is_recorded_in_the_single_process_list():
    from pathlib import Path
    text = (Path(__file__).resolve().parents[1] / "CLAUDE.md").read_text(encoding="utf-8")
    assert "notebook-tweet-resolve" in text


def test_the_payload_key_is_derived_and_defaults_off(monkeypatch):
    from api.routers import auth
    monkeypatch.delenv("NOTEBOOK_TWEET_IMPORT_ENABLED", raising=False)
    assert auth.NOTEBOOK_FLAGS["NOTEBOOK_TWEET_IMPORT_ENABLED"] is False
    assert auth._notebook_flags()["notebook_tweet_import_enabled"] is False
    monkeypatch.setenv("NOTEBOOK_TWEET_IMPORT_ENABLED", "1")
    assert auth._notebook_flags()["notebook_tweet_import_enabled"] is True


# ── the vendor helper ───────────────────────────────────────────────────────────────────

class _Resp:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self._body = body if body is not None else {}
        self.text = json.dumps(self._body)

    def json(self):
        return self._body


def _raw(tid, handle="fakeperson"):
    return {"id": tid, "text": f"post {tid}", "createdAt": "Mon Jan 05 12:00:00 +0000 2026",
            "author": {"userName": handle, "name": "Fake Person"}}


def test_get_tweets_by_ids_normalizes_and_batches(monkeypatch):
    monkeypatch.setenv("TWITTERAPI_IO_API_KEY", "k")
    seen = []

    def fake_get(url, params=None, headers=None, timeout=None):
        seen.append(params["tweet_ids"])
        return _Resp(200, {"tweets": [_raw(i) for i in params["tweet_ids"].split(",")]})

    monkeypatch.setattr(twitterapi_io.requests, "get", fake_get)
    monkeypatch.setattr(twitterapi_io, "_TWEETS_BY_IDS_BATCH", 2)
    out = twitterapi_io.get_tweets_by_ids(["1", "2", "3"])
    assert seen == ["1,2", "3"]
    assert [t["id"] for t in out] == ["1", "2", "3"]
    assert out[0]["author_handle"] == "fakeperson" and out[0]["created_at"] > 0
    assert set(out[0]) >= {"id", "author_handle", "author_name", "text", "created_at", "url", "raw_json"}
    assert twitterapi_io.get_tweets_by_ids([]) == []


@pytest.mark.parametrize("status,exc", [
    (401, twitterapi_io.TwitterApiAuthError), (402, twitterapi_io.TwitterApiPaymentRequired),
    (429, twitterapi_io.TwitterApiRateLimited), (500, twitterapi_io.TwitterApiTransientError),
    (418, twitterapi_io.TwitterApiTransientError),
])
def test_both_vendor_readers_share_the_error_handling(monkeypatch, status, exc):
    monkeypatch.setenv("TWITTERAPI_IO_API_KEY", "k")
    monkeypatch.setattr(twitterapi_io.requests, "get", lambda *a, **k: _Resp(status, {}))
    with pytest.raises(exc):
        twitterapi_io.get_tweets_by_ids(["1"])
    with pytest.raises(exc):
        twitterapi_io.find_deleted_tweet_ids(["1"])


def test_find_deleted_tweet_ids_is_unchanged(monkeypatch):
    monkeypatch.setenv("TWITTERAPI_IO_API_KEY", "k")
    monkeypatch.setattr(twitterapi_io.requests, "get",
                        lambda *a, **k: _Resp(200, {"tweets": [_raw("1")]}))
    assert twitterapi_io.find_deleted_tweet_ids(["1", "2"]) == {"2"}
    assert twitterapi_io.find_deleted_tweet_ids([]) == set()
