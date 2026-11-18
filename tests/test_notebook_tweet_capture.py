"""Import a tweet, Task 2 -- the read side (`api/services/journal_two/tweet_capture.py`, the
`tweets_router` in `api/routers/notebook_tweet_capture.py`, `twitterapi_io.get_tweets_by_ids`).

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

import importlib
import io
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
    from api.routers import notebook_tweet_capture as r
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
    ("https://x.com/i/web/status/123", "123"),
    ("https://twitter.com/i/web/status/123?s=20", "123"),
    ("https://mobile.twitter.com/i/web/status/123/photo/1", "123"),
    ("x.com/i/web/status/123", "123"),
    ("https://x.com.evil.test/i/web/status/123", None),
    ("https://notx.com/i/web/status/123", None),
    ("https://x.com/i/web/status/abc", None),
    ("https://x.com/i/web/123", None),
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


def test_recent_shape_has_no_raw_json(notebook, store):
    _seed(store)
    posts = tweet_capture.recent("NVDA", "ticker", UID)
    assert [p["id"] for p in posts] == ["1", "2"]            # newest first, the 200h-old one is out
    want = {"id", "name", "handle", "avatarUrl", "text", "postedAt", "url", "tickers", "media", "kind",
            "savedInNote"}
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


def test_recent_all_is_the_feed(notebook, store):
    _seed(store)
    posts = tweet_capture.recent(None, "all", UID)
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


def test_recent_dual_class_symbol(notebook, store):
    store.upsert_tweet(_row("7", text="$BRK.B holds"), ["BRK-B"])
    for spelling in ("BRK.B", "brk-b", "$BRK.B"):
        assert [p["id"] for p in tweet_capture.recent(spelling, "ticker", UID)] == ["7"]


@pytest.mark.parametrize("symbol,scope", [
    (None, "ticker"), ("", "ticker"), ("   ", "ticker"), ("<script>", "ticker"),
    ("NVDA", "everything"), (None, ""), ("NVDA", "TICKER"),
])
def test_recent_refusals_are_400(store, symbol, scope):
    with pytest.raises(tweet_capture.TweetCaptureError) as e:
        tweet_capture.recent(symbol, scope, UID)
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


def test_recent_route(client, flag_on, notebook, store):
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
    from api.routers import notebook_tweet_capture as r
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
    assert "notebook-tweet-save" in text and "notebook_tweet_capture._SAVE_INFLIGHT" in text


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


@pytest.mark.parametrize("status", ["error", "ERROR", "fail", "", None, 500])
def test_a_200_whose_status_is_not_success_is_transient(monkeypatch, status):
    """Without this a 200 error body has no tweets in it, which reads as every post being gone."""
    monkeypatch.setenv("TWITTERAPI_IO_API_KEY", "k")
    monkeypatch.setattr(twitterapi_io.requests, "get",
                        lambda *a, **k: _Resp(200, {"status": status, "message": "try later"}))
    with pytest.raises(twitterapi_io.TwitterApiTransientError):
        twitterapi_io.find_deleted_tweet_ids(["1", "2"])
    with pytest.raises(twitterapi_io.TwitterApiTransientError):
        twitterapi_io.get_tweets_by_ids(["1"])


@pytest.mark.parametrize("body", [
    {"tweets": [_raw("1")]},                          # no status at all still works
    {"tweets": [_raw("1")], "status": "success"},
    {"tweets": [_raw("1")], "status": "SUCCESS"},
    {"tweets": [_raw("1")], "status": "ok"},
    {"tweets": [_raw("1")], "status": " OK "},
])
def test_a_200_with_a_good_or_absent_status_still_answers(monkeypatch, body):
    monkeypatch.setenv("TWITTERAPI_IO_API_KEY", "k")
    monkeypatch.setattr(twitterapi_io.requests, "get", lambda *a, **k: _Resp(200, body))
    assert twitterapi_io.find_deleted_tweet_ids(["1", "2"]) == {"2"}
    assert [t["id"] for t in twitterapi_io.get_tweets_by_ids(["1"])] == ["1"]


def test_a_200_with_a_non_json_body_is_transient(monkeypatch):
    class _NotJson(_Resp):
        def json(self):
            raise ValueError("not json")

    monkeypatch.setenv("TWITTERAPI_IO_API_KEY", "k")
    monkeypatch.setattr(twitterapi_io.requests, "get", lambda *a, **k: _NotJson(200, {}))
    with pytest.raises(twitterapi_io.TwitterApiTransientError):
        twitterapi_io.get_tweets_by_ids(["1"])
    with pytest.raises(twitterapi_io.TwitterApiTransientError):
        twitterapi_io.find_deleted_tweet_ids(["1"])


# ── saving into a note (Task 4) ─────────────────────────────────────────────────────────

OTHER = "user-tw-b"
SAVE_URL = "/api/j2/research-capture/tweets/save"


def _png() -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (1, 2, 3)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def images(monkeypatch):
    """`hotlink_fetch.download` answered locally. `fail` is the set of URL substrings that raise."""
    from api.services.journal_two import hotlink_fetch
    box = {"urls": [], "fail": set()}

    async def fake(url, **kwargs):
        box["urls"].append(url)
        if any(f in url for f in box["fail"]):
            raise RuntimeError("no image")
        return _png(), "image/png"

    monkeypatch.setattr(hotlink_fetch, "download", fake)
    return box


@pytest.fixture
def prices(monkeypatch):
    from api.services.journal_two import tweet_price
    box = {"point": None, "calls": [], "hook": None}

    def fake(symbol, posted_at, wait_until=None):
        box["calls"].append((symbol, posted_at))
        box["wait_until"] = wait_until
        if box["hook"]:
            box["hook"]()
        return box["point"]

    monkeypatch.setattr(tweet_price, "price_at_post", fake)
    monkeypatch.setattr(tweet_price, "still_comparable", lambda *a: True)

    def fake_start(symbol, wait_until=None):
        box.setdefault("refreshed", []).append(symbol)
        box["start_wait_until"] = wait_until

    monkeypatch.setattr(tweet_price, "start_refresh", fake_start)
    return box


def test_start_price_refreshes_asks_once_per_recent_ticker(prices, monkeypatch):
    from api.services.journal_two import tweet_capture as tw, tweet_price
    monkeypatch.setattr(tweet_price, "awaits_refresh", lambda posted_at: posted_at == 100)
    posts = {
        "1": {"tickers": ["AAPL"], "text": "$AAPL up", "postedAt": 100},
        "2": {"tickers": ["AAPL"], "text": "$AAPL again", "postedAt": 100},
        "3": {"tickers": ["NVDA"], "text": "$NVDA old", "postedAt": 5},
        "4": {"tickers": [], "text": "no cashtag", "postedAt": 100},
    }
    tw._start_price_refreshes(posts, None)
    assert prices["refreshed"] == ["AAPL"]


def test_starting_refreshes_stops_when_the_budget_is_spent(prices, monkeypatch):
    from api.services.journal_two import tweet_capture as tw, tweet_price
    monkeypatch.setattr(tweet_price, "awaits_refresh", lambda posted_at: True)
    posts = {"1": {"tickers": ["AAPL"], "text": "$AAPL up", "postedAt": 100}}
    tw._start_price_refreshes(posts, None, tw.time.monotonic() - 1)
    assert "refreshed" not in prices


def test_the_starts_and_the_reads_share_one_limit(notebook, store, prices, monkeypatch):
    from api.services.journal_two import tweet_capture as tc, tweet_price
    monkeypatch.setattr(tweet_price, "awaits_refresh", lambda posted_at: True)
    _seed_post(store, "790")
    before = tc.time.monotonic()
    tc.save(UID, _note(), ["790"])
    assert prices["refreshed"] == ["NVDA"]
    assert prices["start_wait_until"] == prices["wait_until"]
    assert prices["wait_until"] - before <= tc.PRICE_REFRESH_BUDGET_S + 1


@pytest.fixture
def notebook(monkeypatch, tmp_path, store, images, prices, vendor):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid, email in ((UID, "a@example.com"), (OTHER, "b@example.com")):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                     (uid, email, "x", uid, "member"))
    conn.commit()
    conn.close()
    from api.services.journal_two import notes as notes_svc
    monkeypatch.setenv("J2_ATTACHMENT_ROOT", str(tmp_path / "j2_attachments"))
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "j2_attachments")
    return auth_db


def _note(user_id=UID, ticker="NVDA") -> str:
    from api.services.journal_two import notes
    return notes.create_note(user_id, {"title": "Thesis", "ticker": ticker})["id"]


def _rows(sql, *args):
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    finally:
        c.close()


def _seed_post(store, tid, handle="fakedesk_one", text="$NVDA breaking out", tickers=("NVDA",), raw=RAW):
    store.upsert_tweet(_row(tid, handle=handle, text=text, raw=raw), list(tickers))


def _excerpt_nodes(note_id, user_id=UID):
    from api.services.journal_two import notes
    return [n["attrs"]["excerptId"] for n in notes.get_note(user_id, note_id)["bodyJson"]["content"]
            if n.get("type") == "documentExcerpt"]


def _assert_no_tweet_rows():
    for table in ("j2_note_excerpts", "j2_note_document_pages", "j2_note_documents", "j2_note_tweet_captures"):
        assert _rows(f"SELECT * FROM {table}") == [], table


def test_save_creates_excerpt_node_and_sidecar(notebook, store, prices):
    from api.services.journal_two import tweet_capture as tc
    from api.services.journal_two.tweet_price import PricePoint
    prices["point"] = PricePoint("NVDA", 188.2, "posted", None)
    _seed_post(store, "701")
    note_id = _note()
    out = tc.save(UID, note_id, ["701"])

    assert out["warnings"] == []
    ex = out["excerpts"][0]
    assert ex["capturedText"] == "$NVDA breaking out"
    assert ex["charStart"] == 0 and ex["charEnd"] == len("$NVDA breaking out")
    assert _excerpt_nodes(note_id) == [ex["id"]]

    from api.services.journal_two import notes
    assert out["note"] == {"id": note_id, "updatedAt": notes.get_note(UID, note_id)["updatedAt"]}

    doc = _rows("SELECT * FROM j2_note_documents")[0]
    assert doc["attachment_url"] == "x:701" and doc["name"] == "@fakedesk_one on X"
    assert (doc["source_kind"], doc["capture_type"]) == ("web", "web_passage")
    assert doc["source_url"] == "https://x.com/fakedesk_one/status/701"
    assert doc["page_count"] == 1
    page = _rows("SELECT * FROM j2_note_document_pages")[0]
    assert (page["page_number"], page["text"], page["text_origin"]) == (1, "$NVDA breaking out", "web_passage")

    car = _rows("SELECT * FROM j2_note_tweet_captures")[0]
    assert car["document_id"] == doc["id"] and car["user_id"] == UID and car["note_id"] == note_id
    assert (car["tweet_id"], car["author_handle"], car["author_name"]) == ("701", "fakedesk_one", "FAKEDESK_ONE")
    assert car["avatar_url"] == AVATAR and car["permalink"] == "https://x.com/fakedesk_one/status/701"
    assert car["posted_at"] == ex["tweet"]["postedAt"]
    assert (car["price_symbol"], car["price_at_post"], car["price_label"], car["price_session_date"]) == (
        "NVDA", 188.2, "posted", None)
    assert car["removed_at"] is None and car["gone_first_missed_at"] is None and car["created_at"]

    stored = json.loads(car["media_json"])
    assert len(stored) == 1 and stored[0].startswith(f"/api/j2/notes/attachments/{UID}/{note_id}/inline/")
    assert "pbs.twimg" not in car["media_json"]


def test_save_never_uses_client_text(client, flag_on, notebook, store):
    _seed_post(store, "702", text="$NVDA the real words")
    note_id = _note()
    r = client.post(SAVE_URL, json={"noteId": note_id, "tweetIds": ["702"], "text": "FORGED",
                                    "capturedText": "FORGED", "handle": "forged"})
    assert r.status_code == 200, r.text
    ex = r.json()["excerpts"][0]
    assert ex["capturedText"] == "$NVDA the real words"
    assert ex["tweet"]["handle"] == "fakedesk_one"
    assert "FORGED" not in json.dumps(_rows("SELECT * FROM j2_note_excerpts"))


def test_save_twice_is_one_excerpt_placed_once(notebook, store, images):
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "703")
    note_id = _note()
    first = tc.save(UID, note_id, ["703"])["excerpts"][0]
    copied = len(images["urls"])
    second = tc.save(UID, note_id, ["703"])["excerpts"][0]
    assert second["id"] == first["id"]
    assert _excerpt_nodes(note_id) == [first["id"]]
    assert len(_rows("SELECT * FROM j2_note_excerpts")) == 1
    assert len(_rows("SELECT * FROM j2_note_tweet_captures")) == 1
    assert len(images["urls"]) == copied          # the dedupe path copies nothing


def test_save_replaces_node_after_member_removed_it(notebook, store):
    from api.services.journal_two import notes, tweet_capture as tc
    _seed_post(store, "704")
    note_id = _note()
    ex_id = tc.save(UID, note_id, ["704"])["excerpts"][0]["id"]
    n = notes.get_note(UID, note_id)
    kept = [x for x in n["bodyJson"]["content"] if x.get("type") != "documentExcerpt"]
    notes.update_note(UID, note_id, {"bodyJson": {"type": "doc", "content": kept}}, client_schema=99)
    assert _excerpt_nodes(note_id) == []

    out = tc.save(UID, note_id, ["704"])
    assert out["excerpts"][0]["id"] == ex_id
    assert _excerpt_nodes(note_id) == [ex_id]
    assert len(_rows("SELECT * FROM j2_note_tweet_captures")) == 1
    tc.save(UID, note_id, ["704"])
    assert _excerpt_nodes(note_id) == [ex_id]


def test_save_to_locked_note_is_423_and_leaves_no_rows(notebook, store, images):
    from api.services import auth_db
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "705")
    note_id = _note()
    c = auth_db.get_connection()
    c.execute("UPDATE j2_notes SET locked = 1 WHERE id = ?", (note_id,))
    c.commit()
    c.close()
    with pytest.raises(tc.TweetCaptureError) as e:
        tc.save(UID, note_id, ["705"])
    assert e.value.status == 423
    _assert_no_tweet_rows()
    assert images["urls"] == []


def test_save_failure_after_the_excerpt_leaves_no_rows(notebook, store, monkeypatch):
    from api.services.journal_two import notes, tweet_capture as tc
    _seed_post(store, "706")
    note_id = _note()

    def boom(*a, **k):
        raise RuntimeError("disk trouble")

    monkeypatch.setattr(notes, "append_document_excerpt", boom)
    with pytest.raises(RuntimeError):
        tc.save(UID, note_id, ["706"])
    _assert_no_tweet_rows()


def test_save_to_other_members_note_is_404(notebook, store, vendor):
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "707")
    theirs = _note(OTHER)
    with pytest.raises(tc.TweetCaptureError) as e:
        tc.save(UID, theirs, ["707"])
    assert e.value.status == 404
    _assert_no_tweet_rows()
    assert vendor["calls"] == []


def test_save_over_20_is_400(notebook, vendor):
    from api.services.journal_two import tweet_capture as tc
    note_id = _note()
    with pytest.raises(tc.TweetCaptureError) as e:
        tc.save(UID, note_id, [str(i) for i in range(1, 22)])
    assert e.value.status == 400
    assert vendor["calls"] == []


@pytest.mark.parametrize("ids", [[], None, "701", [701], ["abc"], [""], ["1" * 26]])
def test_save_refuses_a_bad_id_list(notebook, vendor, ids):
    from api.services.journal_two import tweet_capture as tc
    note_id = _note()
    with pytest.raises(tc.TweetCaptureError) as e:
        tc.save(UID, note_id, ids)
    assert e.value.status == 400
    assert vendor["calls"] == []


def test_save_repeated_ids_keep_first_position(notebook, store):
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "711", text="$NVDA one")
    _seed_post(store, "712", text="$NVDA two")
    note_id = _note()
    out = tc.save(UID, note_id, ["711", "712", "711"])
    assert [x["capturedText"] for x in out["excerpts"]] == ["$NVDA one", "$NVDA two"]
    assert len(_excerpt_nodes(note_id)) == 2


def test_save_reads_store_first_then_one_vendor_call_in_requested_order(notebook, store, vendor):
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "721", text="$NVDA stored first")
    _seed_post(store, "723", text="$NVDA stored last")
    vendor["answer"] = [_row("724", handle="fakeperson", text="$AMD also linked", raw="{}"),
                        _row("722", handle="fakeperson", text="$AMD linked", raw="{}")]
    note_id = _note()
    out = tc.save(UID, note_id, ["721", "722", "723", "724"])
    assert [x["capturedText"] for x in out["excerpts"]] == [
        "$NVDA stored first", "$AMD linked", "$NVDA stored last", "$AMD also linked"]
    assert vendor["calls"] == [["722", "724"]]
    assert store.get_tweet("722") is None and store.count_tweets() == 2     # never written to tweets.db


def test_save_unresolvable_id_stops_and_reports_what_was_saved(notebook, store, vendor):
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "731", text="$NVDA saved before")
    _seed_post(store, "733", text="$NVDA never reached")
    vendor["answer"] = []
    note_id = _note()
    out = tc.save(UID, note_id, ["731", "732", "733"])
    assert set(out) == {"excerpts", "note", "warnings", "stopped"}
    assert "could not be found" in out["stopped"] and "1 post was saved" in out["stopped"]
    assert [x["capturedText"] for x in out["excerpts"]] == ["$NVDA saved before"]
    from api.services.journal_two import notes
    assert out["note"] == {"id": note_id, "updatedAt": notes.get_note(UID, note_id)["updatedAt"]}
    assert [r["captured_text"] for r in _rows("SELECT captured_text FROM j2_note_excerpts")] == ["$NVDA saved before"]
    assert len(_excerpt_nodes(note_id)) == 1


def test_save_stopped_keeps_the_warnings_already_collected(notebook, store, vendor, images):
    from api.services.journal_two import tweet_capture as tc
    images["fail"].add("FakeImg123")
    _seed_post(store, "734")
    vendor["answer"] = []
    out = tc.save(UID, _note(), ["734", "735"])
    assert out["warnings"] == ["An image from @fakedesk_one could not be copied."]
    assert "could not be found" in out["stopped"]


def test_save_unexpected_failure_after_a_saved_post_is_stopped_not_an_error(notebook, store, monkeypatch):
    from api.services.journal_two import notes, tweet_capture as tc
    _seed_post(store, "736", text="$NVDA first")
    _seed_post(store, "737", text="$NVDA second")
    note_id = _note()
    real = notes.append_document_excerpt
    calls = []

    def second_fails(*a, **k):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("disk trouble")
        return real(*a, **k)

    monkeypatch.setattr(notes, "append_document_excerpt", second_fails)
    out = tc.save(UID, note_id, ["736", "737"])
    assert out["stopped"] == f"{tc.SAVE_FAILED_SENTENCE} 1 post was saved before it."
    assert [x["capturedText"] for x in out["excerpts"]] == ["$NVDA first"]
    assert [r["captured_text"] for r in _rows("SELECT captured_text FROM j2_note_excerpts")] == ["$NVDA first"]
    assert len(_rows("SELECT * FROM j2_note_tweet_captures")) == 1


def test_save_route_partial_import_is_200_with_the_revision(client, flag_on, notebook, store, vendor):
    _seed_post(store, "738")
    vendor["answer"] = []
    note_id = _note()
    r = client.post(SAVE_URL, json={"noteId": note_id, "tweetIds": ["738", "7399"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["note"]["id"] == note_id and body["note"]["updatedAt"]
    assert len(body["excerpts"]) == 1 and "could not be found" in body["stopped"]


def test_save_unresolvable_first_id_says_nothing_was_saved(notebook, store, vendor):
    from api.services.journal_two import tweet_capture as tc
    vendor["answer"] = []
    with pytest.raises(tc.TweetCaptureError) as e:
        tc.save(UID, _note(), ["739"])
    assert e.value.status == 404
    assert str(e.value) == tc.NOT_FOUND_SENTENCE
    _assert_no_tweet_rows()


def test_save_vendor_down_is_503_and_saves_nothing(notebook, store, vendor):
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "741")
    vendor["answer"] = twitterapi_io.TwitterApiTransientError("x")
    with pytest.raises(tc.TweetCaptureError) as e:
        tc.save(UID, _note(), ["741", "742"])
    assert e.value.status == 503
    _assert_no_tweet_rows()


def test_save_a_post_with_no_words_is_refused(notebook, store):
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "751", text="   ", tickers=())
    with pytest.raises(tc.TweetCaptureError) as e:
        tc.save(UID, _note(), ["751"])
    assert e.value.status == 422
    _assert_no_tweet_rows()


def test_save_without_cashtag_has_no_price(notebook, store, prices):
    from api.services.journal_two import tweet_capture as tc
    from api.services.journal_two.tweet_price import PricePoint
    prices["point"] = PricePoint("NVDA", 188.2, "posted", None)
    _seed_post(store, "752", text="nothing to price here", tickers=())
    out = tc.save(UID, _note(), ["752"])
    assert prices["calls"] == []
    assert out["excerpts"][0]["tweet"]["price"] is None
    assert _rows("SELECT price_symbol FROM j2_note_tweet_captures")[0]["price_symbol"] is None


def test_save_prices_the_notes_own_ticker_when_the_post_names_it(notebook, store, prices):
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "753", text="$AMD and $NVDA both", tickers=("AMD", "NVDA"))
    tc.save(UID, _note(ticker="NVDA"), ["753"])
    assert [c[0] for c in prices["calls"]] == ["NVDA"]


def test_price_is_read_outside_the_write_transaction(notebook, store, prices, monkeypatch):
    from api.services.journal_two import notes, tweet_capture as tc
    note_id = _note()
    _seed_post(store, "754")
    opened = []
    real = notes.get_connection

    def recording():
        c = real()
        opened.append(c)
        return c

    monkeypatch.setattr(notes, "get_connection", recording)
    seen = []
    prices["hook"] = lambda: seen.append([c.in_transaction for c in opened])
    tc.save(UID, note_id, ["754"])
    assert seen and opened and all(not any(s) for s in seen), seen


def test_image_copy_failure_warns_and_keeps_post(notebook, store, images):
    from api.services.journal_two import tweet_capture as tc
    images["fail"].add("FakeImg123")
    _seed_post(store, "761")
    note_id = _note()
    out = tc.save(UID, note_id, ["761"])
    assert out["warnings"] == ["An image from @fakedesk_one could not be copied."]
    assert len(out["excerpts"]) == 1
    assert _excerpt_nodes(note_id) == [out["excerpts"][0]["id"]]
    assert _rows("SELECT media_json FROM j2_note_tweet_captures")[0]["media_json"] == "[]"


def test_only_pbs_twimg_images_are_copied_and_at_most_four(notebook, store, images, monkeypatch):
    from api.services.journal_two import tweet_capture as tc
    urls = [f"https://pbs.twimg.com/media/Img{i}.jpg" for i in range(6)]
    urls.insert(0, "https://evil.test/media/Bad.jpg")
    raw = json.dumps({"extendedEntities": {"media": [{"media_url_https": u} for u in urls]}})
    _seed_post(store, "762", raw=raw)
    original = tweet_store.get_tweet

    def with_media(tid):
        row = original(tid)
        row["media"] = urls
        return row

    monkeypatch.setattr(tweet_store, "get_tweet", with_media)
    tc.save(UID, _note(), ["762"])
    assert len(images["urls"]) == 4
    assert all(u.startswith("https://pbs.twimg.com/") for u in images["urls"])


def test_images_are_downloaded_at_the_large_rendition(notebook, store, images):
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "764")
    tc.save(UID, _note(), ["764"])
    assert len(images["urls"]) == 1
    assert images["urls"][0].startswith(IMG)
    assert "name=large" in images["urls"][0] and "name=small" not in images["urls"][0]


def test_stored_tweet_images_survive_the_attachment_gc(notebook, store):
    from api.services.journal_two import attachment_gc, tweet_capture as tc
    from api.services import auth_db
    _seed_post(store, "763")
    note_id = _note()
    tc.save(UID, note_id, ["763"])
    url = json.loads(_rows("SELECT media_json FROM j2_note_tweet_captures")[0]["media_json"])[0]
    conn = auth_db.get_connection()
    try:
        names = attachment_gc._referenced_names(conn, UID)
    finally:
        conn.close()
    assert url.rsplit("/", 1)[1] in names


def test_save_route(client, flag_on, notebook, store):
    _seed_post(store, "771")
    note_id = _note()
    r = client.post(SAVE_URL, json={"noteId": note_id, "tweetIds": ["771"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"excerpts", "note", "warnings"}
    assert body["note"]["id"] == note_id
    assert client.post(SAVE_URL, json={"noteId": note_id, "tweetIds": []}).status_code == 400
    assert client.post(SAVE_URL, json={"noteId": note_id}).status_code == 400
    assert client.post(SAVE_URL, json=[1]).status_code in (400, 422)


def test_save_rate_limit_is_its_own_429(client, flag_on, notebook, vendor, monkeypatch):
    from api.limiter import limiter
    from api.routers import notebook_tweet_capture as r
    monkeypatch.setattr(limiter, "enabled", True)
    monkeypatch.setattr(r, "TWEET_SAVE_RATE", "2/minute")
    monkeypatch.setattr(r, "SCOPE_TWEET_SAVE", f"notebook-tweet-save-test-{time.time_ns()}")
    vendor["answer"] = []
    note_id = _note()
    codes = [client.post(SAVE_URL, json={"noteId": note_id, "tweetIds": [str(i + 1)]}).status_code
             for i in range(3)]
    assert codes == [404, 404, 429]
    last = client.post(SAVE_URL, json={"noteId": note_id, "tweetIds": ["9"]})
    assert last.json()["detail"] == r.TWEET_SAVE_RATE_SENTENCE
    assert len(vendor["calls"]) == 2          # the refused press spent no vendor call


def test_the_save_rate_is_20_a_minute_per_member():
    from api.routers import notebook_tweet_capture as r
    assert r.TWEET_SAVE_RATE == "20/minute"
    assert r.SCOPE_TWEET_SAVE == "notebook-tweet-save"


def test_a_second_concurrent_save_is_429_and_the_first_finishes(client, flag_on, notebook, monkeypatch):
    import threading
    from api.routers import notebook_tweet_capture as r
    from api.services.journal_two import tweet_capture as tc
    entered, release = threading.Event(), threading.Event()
    done = {"excerpts": [], "note": {"id": "n", "updatedAt": None}, "warnings": []}

    def slow(*a):
        entered.set()
        assert release.wait(20)
        return done

    monkeypatch.setattr(tc, "save", slow)
    first = {}
    t = threading.Thread(target=lambda: first.update(
        r=client.post(SAVE_URL, json={"noteId": "n", "tweetIds": ["1"]})))
    t.start()
    try:
        assert entered.wait(20)
        second = client.post(SAVE_URL, json={"noteId": "n", "tweetIds": ["2"]})
        assert second.status_code == 429
        assert second.json()["detail"] == "An import is already running. Try again in a moment."
    finally:
        release.set()
        t.join(20)
    assert first["r"].status_code == 200
    assert client.post(SAVE_URL, json={"noteId": "n", "tweetIds": ["3"]}).status_code == 200
    assert r._SAVE_INFLIGHT == set()


def test_the_save_slot_is_released_after_a_failed_save(client, flag_on, notebook, store, monkeypatch):
    from api.routers import notebook_tweet_capture as r
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "772")
    theirs = _note(OTHER)
    assert client.post(SAVE_URL, json={"noteId": theirs, "tweetIds": ["772"]}).status_code == 404
    assert r._SAVE_INFLIGHT == set()

    def boom(*a):
        raise RuntimeError("disk trouble")

    monkeypatch.setattr(tc, "save", boom)
    with pytest.raises(RuntimeError):
        client.post(SAVE_URL, json={"noteId": theirs, "tweetIds": ["772"]})
    assert r._SAVE_INFLIGHT == set()


def test_one_members_running_save_does_not_block_another(client, flag_on, notebook, monkeypatch):
    from api.routers import notebook_tweet_capture as r
    from api.services.journal_two import tweet_capture as tc
    monkeypatch.setattr(tc, "save", lambda *a: {"excerpts": [], "note": {}, "warnings": []})
    assert r._claim_save("someone-else") is True
    try:
        assert client.post(SAVE_URL, json={"noteId": "n", "tweetIds": ["1"]}).status_code == 200
    finally:
        r._release_save("someone-else")


def test_save_route_is_404_while_the_flag_is_off(client, notebook, monkeypatch):
    monkeypatch.delenv("NOTEBOOK_TWEET_IMPORT_ENABLED", raising=False)
    assert client.post(SAVE_URL, json={"noteId": "n", "tweetIds": ["1"]}).status_code == 404


def test_save_route_is_paid_only(client, flag_on, notebook):
    free = {"id": UID, "role": "member", "plan": "free"}
    client.app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(free)
    assert client.post(SAVE_URL, json={"noteId": "n", "tweetIds": ["1"]}).status_code == 402


# ── reading a saved post ────────────────────────────────────────────────────────────────

def test_excerpt_read_carries_tweet_fields(notebook, store, prices):
    from api.services.journal_two import note_excerpts, tweet_capture as tc
    from api.services.journal_two.tweet_price import PricePoint
    prices["point"] = PricePoint("NVDA", 188.2, "close", "2026-11-06")
    _seed_post(store, "781")
    note_id = _note()
    saved = tc.save(UID, note_id, ["781"])["excerpts"][0]
    listed = note_excerpts.list_note_excerpts(UID, note_id)[0]
    single = note_excerpts.get_excerpt(UID, saved["id"])
    for ex in (saved, listed, single):
        tw = ex["tweet"]
        assert set(tw) == {"tweetId", "name", "handle", "avatarUrl", "url", "postedAt", "media", "price", "removed"}
        assert tw["tweetId"] == "781" and tw["handle"] == "fakedesk_one" and tw["name"] == "FAKEDESK_ONE"
        assert tw["avatarUrl"] == AVATAR and tw["url"] == "https://x.com/fakedesk_one/status/781"
        assert isinstance(tw["postedAt"], int) and tw["removed"] is False
        assert tw["price"] == {"symbol": "NVDA", "price": 188.2, "label": "close", "sessionDate": "2026-11-06"}
        assert len(tw["media"]) == 1 and tw["media"][0].startswith("/api/j2/notes/attachments/")


def test_excerpt_read_reports_a_removed_post(notebook, store):
    from api.services import auth_db
    from api.services.journal_two import note_excerpts, tweet_capture as tc
    _seed_post(store, "782")
    note_id = _note()
    tc.save(UID, note_id, ["782"])
    c = auth_db.get_connection()
    c.execute("UPDATE j2_note_tweet_captures SET removed_at = 'x'")
    c.commit()
    c.close()
    assert note_excerpts.list_note_excerpts(UID, note_id)[0]["tweet"]["removed"] is True


# ── "Saved in one of your notes" ────────────────────────────────────────────────────────

def _saved_flags(posts):
    return {p["id"]: p["savedInNote"] for p in posts}


def test_recent_says_which_posts_this_member_has_saved(notebook, store):
    _seed_post(store, "801")
    _seed_post(store, "802")
    tweet_capture.save(UID, _note(), ["801"])
    assert _saved_flags(tweet_capture.recent("NVDA", "ticker", UID)) == {"801": True, "802": False}
    assert _saved_flags(tweet_capture.recent(None, "all", UID)) == {"801": True, "802": False}


def test_another_members_save_does_not_show(notebook, store):
    _seed_post(store, "803")
    tweet_capture.save(OTHER, _note(OTHER), ["803"])
    assert _saved_flags(tweet_capture.recent("NVDA", "ticker", UID)) == {"803": False}
    # CONTROL: the same row does answer for the member who saved it.
    assert _saved_flags(tweet_capture.recent("NVDA", "ticker", OTHER)) == {"803": True}


def test_a_capture_marked_removed_does_not_count_as_saved(notebook, store):
    from api.services import auth_db
    _seed_post(store, "804")
    tweet_capture.save(UID, _note(), ["804"])
    assert _saved_flags(tweet_capture.recent("NVDA", "ticker", UID)) == {"804": True}
    c = auth_db.get_connection()
    c.execute("UPDATE j2_note_tweet_captures SET removed_at = 'x'")
    c.commit()
    c.close()
    assert _saved_flags(tweet_capture.recent("NVDA", "ticker", UID)) == {"804": False}


def test_recent_reads_the_saves_in_one_query(notebook, store, monkeypatch):
    from api.services.journal_two import notes
    for i in range(3):
        _seed_post(store, f"81{i}", text=f"$NVDA post {i}")
    tweet_capture.save(UID, _note(), ["810"])
    reads = []
    real = notes.get_connection

    def traced(*args, **kwargs):
        conn = real(*args, **kwargs)
        conn.set_trace_callback(lambda s: reads.append(s) if "j2_note_tweet_captures" in s else None)
        return conn

    monkeypatch.setattr(notes, "get_connection", traced)
    assert len(tweet_capture.recent("NVDA", "ticker", UID)) == 3
    assert len(reads) == 1, reads


def test_recent_with_no_posts_opens_no_query(notebook, store, monkeypatch):
    from api.services.journal_two import notes

    def refuse(*args, **kwargs):
        raise AssertionError("no posts means no query")

    monkeypatch.setattr(notes, "get_connection", refuse)
    assert tweet_capture.recent(None, "all", UID) == []


def test_recent_route_answers_for_the_signed_in_member(client, flag_on, notebook, store):
    _seed_post(store, "805")
    tweet_capture.save(UID, _note(), ["805"])
    url = "/api/j2/research-capture/tweets/recent?symbol=NVDA&scope=ticker"
    assert _saved_flags(client.get(url).json()["posts"]) == {"805": True}
    # The same request as somebody else.
    other = {"id": OTHER, "role": "member", "plan": "pro"}
    client.app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(other)
    assert _saved_flags(client.get(url).json()["posts"]) == {"805": False}


def _plain_excerpt(note_id, user_id=UID):
    """An ordinary (non-tweet) excerpt, through the base tables and `create_excerpt`."""
    from api.services import auth_db
    from api.services.journal_two import note_excerpts, notes
    c = auth_db.get_connection()
    c.execute("INSERT INTO j2_note_documents (id, user_id, note_id, attachment_url, status, created_at)"
              " VALUES (?,?,?,?, 'ready', 't')", ("doc-plain", user_id, note_id, "/att/x.pdf"))
    c.execute("INSERT INTO j2_note_document_pages (document_id, user_id, page_number, text) VALUES (?,?,1,?)",
              ("doc-plain", user_id, "plain page"))
    c.commit()
    c.close()
    ex = note_excerpts.create_excerpt(user_id, note_id, document_id="doc-plain", page_number=1, captured_text="plain")
    notes.append_document_excerpt(user_id, note_id, ex["id"])
    return ex["id"]


def test_excerpt_read_without_sidecar_has_no_tweet_key(notebook, monkeypatch):
    from api.services.journal_two import note_excerpts, tweet_price
    calls = []
    monkeypatch.setattr(tweet_price, "still_comparable", lambda *a: calls.append(a) or True)
    note_id = _note()
    ex_id = _plain_excerpt(note_id)
    listed = note_excerpts.list_note_excerpts(UID, note_id)
    assert len(listed) == 1 and "tweet" not in listed[0]
    assert "tweet" not in note_excerpts.get_excerpt(UID, ex_id)
    assert calls == []


def test_excerpt_read_uses_one_sidecar_query_however_many_excerpts(notebook, store):
    from api.services import auth_db
    from api.services.journal_two import note_excerpts, tweet_capture as tc
    for i in range(3):
        _seed_post(store, f"79{i}", text=f"$NVDA post {i}")
    note_id = _note()
    tc.save(UID, note_id, ["790", "791", "792"])
    conn = auth_db.get_connection()
    sidecar_reads = []
    conn.set_trace_callback(lambda s: sidecar_reads.append(s) if "j2_note_tweet_captures" in s else None)
    try:
        assert len(note_excerpts.list_note_excerpts(UID, note_id, conn=conn)) == 3
    finally:
        conn.set_trace_callback(None)
        conn.close()
    assert len(sidecar_reads) == 1, sidecar_reads


def test_excerpt_read_hides_price_after_split(notebook, store, prices, monkeypatch):
    from api.services.journal_two import note_excerpts, tweet_capture as tc, tweet_price
    from api.services.journal_two.tweet_price import PricePoint
    prices["point"] = PricePoint("NVDA", 188.2, "posted", None)
    _seed_post(store, "783")
    note_id = _note()
    tc.save(UID, note_id, ["783"])
    assert note_excerpts.list_note_excerpts(UID, note_id)[0]["tweet"]["price"] is not None
    monkeypatch.setattr(tweet_price, "still_comparable", lambda *a: False)
    assert note_excerpts.list_note_excerpts(UID, note_id)[0]["tweet"]["price"] is None


def test_deleting_the_document_removes_the_sidecar(notebook, store):
    from api.services import auth_db
    from api.services.journal_two import tweet_capture as tc
    _seed_post(store, "784")
    tc.save(UID, _note(), ["784"])
    c = auth_db.get_connection()
    c.execute("DELETE FROM j2_note_documents")
    c.commit()
    c.close()
    assert _rows("SELECT * FROM j2_note_tweet_captures") == []


# ── delete_stored_media ─────────────────────────────────────────────────────────────────

def test_delete_stored_media_removes_the_file_and_is_tenant_scoped(notebook):
    from api.services.journal_two import media_policy, notes as notes_svc
    note_id = _note()
    result = media_policy.normalize_media(_png(), "image/png", "x.png")
    stored = media_policy.store_media(UID, note_id, result, budget=media_policy.MediaBudget.for_member(UID))
    sub, name = stored.url.rsplit("/", 2)[1:]

    assert media_policy.delete_stored_media(OTHER, note_id, stored.url) is False
    assert media_policy.delete_stored_media(UID, "another-note", stored.url) is False
    assert media_policy.delete_stored_media(UID, note_id, "https://evil.test/x.png") is False
    assert notes_svc.serve_note_image_path(UID, note_id, sub, name) is not None

    assert media_policy.delete_stored_media(UID, note_id, stored.url) is True
    assert notes_svc.serve_note_image_path(UID, note_id, sub, name) is None
    assert media_policy.delete_stored_media(UID, note_id, stored.url) is False
