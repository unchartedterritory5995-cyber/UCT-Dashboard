"""Wisdom capture (S-A, D12/D17) — the paid X backfill reader and the historical backfills.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. ANY paid call while WISDOM_X_BACKFILL_ENABLED is off — the smoke test included;
2. a spend cap that lets through a call that could cross it, or accepts a cap above HARD_MAX_USD;
3. pagination that loops on a repeated cursor, pages past the last page, keeps paging
   with no new ids, or ignores max_pages;
4. the smoke test making a second call, or echoing post text;
5. a backfill that writes anything on its default dry run, or a real backfill that pages
   or moves a live watermark;
6. a backfilled post from another author, or outside the requested window, being archived.
"""
from __future__ import annotations

import datetime as dt
import json
import sqlite3

import pytest

from api.services.wisdom.capture import archive, backfill, x_backfill
from api.services.wisdom.capture.families._base import et_day_start_epoch
from api.services.wisdom.core import r2, store, timeutil

ET = timeutil.ET
PAGE = x_backfill.PAGE_SIZE_ESTIMATE * x_backfill.PRICE_PER_TWEET_USD


@pytest.fixture
def gate_on(monkeypatch):
    monkeypatch.setenv("WISDOM_X_BACKFILL_ENABLED", "1")


@pytest.fixture
def gate_off(monkeypatch):
    monkeypatch.delenv("WISDOM_X_BACKFILL_ENABLED", raising=False)


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


class FakeR2:
    def __init__(self):
        self.objects: dict = {}
        self.puts: list = []      # canonical keys only — the keys a consumer reads
        self.staged: list = []    # wisdom/staging/<sha>/… — the disposable half

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        body, sha = self.objects[Key]
        return {"Metadata": {"sha256": sha}, "ContentLength": len(body)}

    def put_object(self, Bucket, Key, Body, ContentType, Metadata):
        assert Key not in self.objects, f"overwrite attempted: {Key}"
        self.objects[Key] = (Body, Metadata["sha256"])
        (self.staged if Key.startswith(r2.STAGING_PREFIX) else self.puts).append(Key)

    def copy_object(self, Bucket, Key, CopySource):
        """put_verified stages under wisdom/staging/<sha>/ and copies to the canonical key
        (CONTRACTS §8c.1.3). A fake without this models a product that no longer exists."""
        assert Key not in self.objects, f"overwrite attempted: {Key}"
        self.objects[Key] = self.objects[CopySource["Key"]]
        self.puts.append(Key)

    @property
    def canonical(self) -> dict:
        """Everything outside wisdom/staging/ — what a consumer can actually find."""
        return {k: v for k, v in self.objects.items() if not k.startswith(r2.STAGING_PREFIX)}


@pytest.fixture
def fake_r2(monkeypatch):
    fake = FakeR2()
    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (fake, "bucket"))
    return fake


@pytest.fixture
def pages(monkeypatch):
    sent: list = []
    from api.services import chart_health_alerts

    monkeypatch.setattr(chart_health_alerts, "emit", lambda key, *a, **k: sent.append(key) or True)
    return sent


def _runs():
    with store.read() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM wisdom_capture_runs ORDER BY session_date")]


def _tweet(tid, created, handle="TSDR_Trading", text="post body"):
    return {"id": str(tid), "author_handle": handle, "text": text, "created_at": created,
            "url": f"https://x.com/{handle}/status/{tid}"}


class PagedFeed:
    """A fake advanced_search keyed by cursor, recording every call."""

    def __init__(self, pages: dict):
        self.pages = pages
        self.calls: list = []

    def __call__(self, query, cursor=None):
        self.calls.append((query, cursor))
        tweets, has_next, nxt = self.pages[cursor]
        return {"status": 200, "tweets": tweets, "has_next_page": has_next, "next_cursor": nxt,
                "keys": ["has_next_page", "next_cursor", "tweets"]}


SINCE, UNTIL = 1_000_000, 2_000_000


# ── 1-2. the gate and the cap ───────────────────────────────────────────────

def test_the_spend_cap_is_bounded_and_refuses_the_call_that_could_cross_it():
    for bad in (0, -1, x_backfill.HARD_MAX_USD + 0.01):
        with pytest.raises(ValueError):
            x_backfill.SpendCap(max_usd=bad)
    cap = x_backfill.SpendCap(max_usd=PAGE * 2.5)
    assert cap.reserve_page("a") and cap.reserve_page("b")
    assert cap.reserve_page("c") is False and cap.refused == ["c"] and cap.calls == 2
    assert cap.charged_usd == pytest.approx(PAGE * 2)


def test_no_paid_call_is_made_while_the_gate_is_off(gate_off, monkeypatch):
    feed = PagedFeed({None: ([_tweet(1, SINCE + 1)], False, None)})
    cap = x_backfill.SpendCap(max_usd=1.0)
    with pytest.raises(x_backfill.BackfillRefused):
        x_backfill.backfill_handle("TSDR_Trading", SINCE, UNTIL, cap=cap, dry_run=False, fetch=feed)
    with pytest.raises(x_backfill.BackfillRefused):
        x_backfill.smoke_test(execute=True, fetch=feed)
    import requests

    monkeypatch.setattr(requests, "get", lambda *a, **k: pytest.fail("network call with the gate off"))
    with pytest.raises(x_backfill.BackfillRefused):
        x_backfill.fetch_page("from:TSDR_Trading since_time:1 until_time:2")
    assert feed.calls == [] and cap.calls == 0
    # the dry run needs no gate and makes no call
    plan = x_backfill.backfill_handle("TSDR_Trading", SINCE, UNTIL, cap=cap, fetch=feed)
    assert plan["dry_run"] is True and plan["pages"] == 0 and feed.calls == []
    assert x_backfill.smoke_test(fetch=feed)["calls"] == 0 and feed.calls == []


# ── 3. pagination guards ────────────────────────────────────────────────────

def test_pagination_follows_the_cursor_to_the_last_page(gate_on):
    feed = PagedFeed({
        None: ([_tweet(2, SINCE + 20), _tweet(1, SINCE + 10)], True, "c1"),
        "c1": ([_tweet(3, SINCE + 30), _tweet(9, SINCE + 5, handle="SomeoneElse")], True, "c2"),
        "c2": ([_tweet(4, UNTIL + 1)], False, ""),
    })
    walk = x_backfill.backfill_handle("TSDR_Trading", SINCE, UNTIL, cap=x_backfill.SpendCap(max_usd=1.0),
                                      dry_run=False, fetch=feed)
    assert [c[1] for c in feed.calls] == [None, "c1", "c2"] and walk["stopped"] == "last_page"
    assert [p["id"] for p in walk["posts"]] == ["1", "2", "3"]
    assert walk["outside_window"] == 1 and walk["foreign_author"] == 1


@pytest.mark.parametrize("pages_, stop", [
    ({None: ([_tweet(1, SINCE + 1)], True, "c1"), "c1": ([_tweet(2, SINCE + 2)], True, "c1")}, "repeated_cursor"),
    ({None: ([_tweet(1, SINCE + 1)], True, "c1"), "c1": ([_tweet(1, SINCE + 1)], True, "c2")}, "no_new_ids"),
    ({None: ([_tweet(1, SINCE + 1)], True, "c1"), "c1": ([], True, "c2")}, "empty_page"),
    ({None: ([_tweet(1, SINCE + 1)], True, None)}, "last_page"),
])
def test_every_pagination_guard_stops_the_walk(gate_on, pages_, stop):
    feed = PagedFeed(pages_)
    walk = x_backfill.backfill_handle("TSDR_Trading", SINCE, UNTIL, cap=x_backfill.SpendCap(max_usd=1.0),
                                      dry_run=False, fetch=feed)
    assert walk["stopped"] == stop and len(feed.calls) <= 2


def test_max_pages_and_the_spend_cap_each_end_the_walk(gate_on):
    endless = {None: ([_tweet(0, SINCE + 1)], True, "c1")}
    endless.update({f"c{i}": ([_tweet(i, SINCE + i + 1)], True, f"c{i + 1}") for i in range(1, 10)})
    feed = PagedFeed(endless)
    walk = x_backfill.backfill_handle("TSDR_Trading", SINCE, UNTIL, cap=x_backfill.SpendCap(max_usd=1.0),
                                      dry_run=False, max_pages=3, fetch=feed)
    assert walk["stopped"] == "max_pages" and len(feed.calls) == 3
    feed = PagedFeed(endless)
    capped = x_backfill.backfill_handle("TSDR_Trading", SINCE, UNTIL, cap=x_backfill.SpendCap(max_usd=PAGE * 1.5),
                                        dry_run=False, fetch=feed)
    assert capped["stopped"] == "spend_cap" and len(feed.calls) == 1


# ── 4. smoke test and the HTTP boundary ─────────────────────────────────────

def test_the_smoke_test_makes_exactly_one_call_and_never_echoes_text(gate_on):
    now = 1_800_000_000
    until = now - 86400
    since = until - x_backfill.SMOKE_WINDOW_DAYS * 86400
    feed = PagedFeed({None: ([_tweet(1, since + 10, text="PRIVATE-BODY"), _tweet(2, until + 5, text="PRIVATE-BODY")],
                             True, "next-cursor-abc")})
    out = x_backfill.smoke_test(execute=True, now_unix=now, fetch=feed)
    assert len(feed.calls) == 1 and feed.calls[0][1] is None and out["calls"] == 1
    assert (out["tweets"], out["tweets_at_or_after_until"], out["next_cursor_present"]) == (2, 1, True)
    assert "PRIVATE-BODY" not in json.dumps(out)


def test_fetch_page_sends_the_bounds_and_cursor_and_keeps_the_key_in_the_header(gate_on, monkeypatch):
    import requests

    from api.services import twitterapi_io as tio

    monkeypatch.setenv("TWITTERAPI_IO_API_KEY", "k-secret-value")
    seen: dict = {}

    class Resp:
        def __init__(self, status, body):
            self.status_code, self._body, self.text = status, body, "server said no"

        def json(self):
            return self._body

    body = {"tweets": [{"id": "7", "author": {"userName": "TSDR_Trading"}, "text": "t",
                        "createdAt": "Mon Sep 14 12:00:00 +0000 2026"}],
            "has_next_page": True, "next_cursor": "abc"}

    def fake_get(url, params=None, headers=None, timeout=None):
        seen.update(url=url, params=params, headers=headers)
        return Resp(200, body)

    monkeypatch.setattr(requests, "get", fake_get)
    query = x_backfill.query_for("TSDR_Trading", SINCE, UNTIL)
    page = x_backfill.fetch_page(query, "c0")
    assert seen["url"].endswith("/twitter/tweet/advanced_search")
    assert seen["params"] == {"query": "from:TSDR_Trading since_time:1000000 until_time:2000000",
                              "queryType": "Latest", "cursor": "c0"}
    assert seen["headers"] == {"x-api-key": "k-secret-value"}
    assert page["tweets"][0]["id"] == "7" and page["next_cursor"] == "abc" and page["has_next_page"] is True
    monkeypatch.setattr(requests, "get", lambda *a, **k: Resp(402, {}))
    with pytest.raises(tio.TwitterApiPaymentRequired) as refused:
        x_backfill.fetch_page(query)
    assert "k-secret-value" not in str(refused.value)


# ── 5-6. the backfills ──────────────────────────────────────────────────────

def _catalysts_db(tmp_path):
    from api.services.catalyst import store as catalyst_store

    path = tmp_path / "catalysts.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(catalyst_store._SCHEMA)
        conn.executemany("INSERT INTO catalysts (market_date, ticker, rank, score) VALUES (?, ?, ?, ?)",
                         [("2026-09-10", "AAA", 1, 9.0), ("2026-09-10", "BBB", None, 1.0), ("2026-09-11", "CCC", 1, 5.0)])
    return str(path)


def test_the_catalysts_backfill_defaults_to_a_dry_run_that_writes_nothing(wisdom_db, fake_r2, pages, tmp_path):
    db = _catalysts_db(tmp_path)
    plan = backfill.catalysts_history(db)
    assert plan["dry_run"] is True and [d["session_date"] for d in plan["days"]] == ["2026-09-10", "2026-09-11"]
    assert plan["cost"]["bytes"] > 0 and fake_r2.puts == [] and _runs() == []
    done = backfill.catalysts_history(db, dry_run=False)
    assert fake_r2.puts == ["wisdom/context/2026-09-10/catalysts.json.gz", "wisdom/context/2026-09-11/catalysts.json.gz"]
    assert [r["row_count"] for r in _runs()] == [2, 1] and pages == [] and done["cost"]["objects"] == 2
    body = archive.decode(fake_r2.objects[fake_r2.puts[0]][0])
    assert [r["ticker"] for r in body["payload"]] == ["AAA", "BBB"] and body["meta"]["origin"] == "backfill"


def test_the_vision_backfill_groups_by_judged_day_and_moves_no_watermark(wisdom_db, fake_r2, pages, tmp_path, monkeypatch):
    from api.services.pattern_vision import store as vision_store

    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pattern_vision.db"))
    vision_store.init_db()
    for ticker, day in (("AAA", dt.date(2026, 9, 10)), ("BBB", dt.date(2026, 9, 11)), ("CCC", dt.date(2026, 9, 11))):
        vision_store.put_verdict({"ticker": ticker, "tf": "D", "setup": "vcp", "asof_date": "2026-09-09",
                                  "judged_at": et_day_start_epoch(day) + 12 * 3600})
    done = backfill.vision_history(str(tmp_path / "pattern_vision.db"), dry_run=False)
    assert [d["rows"] for d in done["days"]] == [1, 2] and pages == []
    with store.read() as conn:
        row = conn.execute("SELECT watermark FROM wisdom_capture_datasets WHERE dataset = 'vision'").fetchone()
    assert row["watermark"] is None


def test_the_detections_backfill_counts_on_a_dry_run_and_shards_for_real(wisdom_db, fake_r2, pages, tmp_path):
    from api.services.pattern_engine import pattern_db

    path = tmp_path / "patterns.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(pattern_db._SCHEMA)
        for i, day in enumerate((dt.date(2026, 9, 10), dt.date(2026, 9, 10), dt.date(2026, 9, 11))):
            t = et_day_start_epoch(day) + 3600 + i
            conn.execute("INSERT INTO pattern_detections (id, sym, tf, pattern_id, category, direction, start_t, end_t, "
                         "confidence, quality_json, geometry_json, levels_json, context_json, narrative_json, status, "
                         "detected_at, last_seen_at, hash_key) VALUES (?, 'A', 'D', 'vcp', 'c', 'long', 1, 2, 0.5, "
                         "'{}', '{}', '{}', '{}', '{}', 'active', ?, ?, ?)", (f"d{i}", t, t, f"h{i}"))
    plan = backfill.detections_retention(str(path))
    assert [(d["session_date"], d["rows"]) for d in plan["days"]] == [("2026-09-10", 2), ("2026-09-11", 1)]
    assert plan["cost"]["bytes"] == 3 * backfill.DETECTION_GZ_BYTES_PER_ROW_MEASURED and fake_r2.puts == []
    done = backfill.detections_retention(str(path), dry_run=False, max_days=1)
    assert fake_r2.puts == ["wisdom/context/2026-09-10/detections-001.json.gz",
                            "wisdom/context/2026-09-10/detections.json.gz"]
    assert done["days"][0]["rows"] == 2 and pages == []


def test_the_x_backfill_archives_by_et_day_without_paging(wisdom_db, fake_r2, pages, gate_on):
    d1, d2 = et_day_start_epoch(dt.date(2026, 9, 10)), et_day_start_epoch(dt.date(2026, 9, 11))
    feed = PagedFeed({None: ([_tweet(1, d1 + 3600), _tweet(2, d2 + 3600), _tweet(3, d2 + 7200)], False, None)})
    out = backfill.x_posts(["TSDR_Trading"], d1, d2 + 86400, max_usd=1.0, dry_run=False, fetch=feed)
    assert fake_r2.puts == ["wisdom/context/2026-09-10/tweets.json.gz", "wisdom/context/2026-09-11/tweets.json.gz"]
    assert out["spend"]["calls"] == 1 and [r["row_count"] for r in _runs()] == [1, 2] and pages == []
    body = archive.decode(fake_r2.objects[fake_r2.puts[1]][0])
    assert body["meta"] == {"origin": "x_backfill", "per_handle": {"TSDR_Trading": 2}}
