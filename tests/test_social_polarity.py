"""FT-080 social polarity (owner ruling 2026-10-11: "store text but allow sorting, one
week, one month etc."): the deterministic classifier, the buzz.db social_posts store
and its retention sweep, the room and X write paths, the windowed read, and the dark
route. No network."""
from __future__ import annotations

import inspect
import sqlite3
from datetime import datetime, timezone

import pytest

from api.services import social_polarity as sp

NOW = datetime(2026, 10, 10, 20, tzinfo=timezone.utc)   # Sat 16:00 ET


def _ts(y, m, d, h=15):
    return int(datetime(y, m, d, h, tzinfo=timezone.utc).timestamp())


@pytest.fixture
def buzz(tmp_path, monkeypatch):
    from api.services import buzz_store
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv(sp.ENABLED_ENV, "1")
    monkeypatch.delenv(sp.RETENTION_ENV, raising=False)
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    yield buzz_store
    buzz_store._reset_for_tests()


# ── the classifier ──────────────────────────────────────────────────────────

class TestClassify:
    @pytest.mark.parametrize("text", [
        "$NVDA looking bullish, loading calls", "breaking out here \U0001F680\U0001F680",
        "bought more, to the moon", "upgrade from MS, strong beat",
    ])
    def test_bullish_cues(self, text):
        label, score = sp.classify(text)
        assert label == "bullish" and score > 0

    @pytest.mark.parametrize("text", [
        "bearish on $TSLA, buying puts", "this is breaking down \U0001F43B",
        "sold everything, weak tape", "downgrade, missed revenue",
    ])
    def test_bearish_cues(self, text):
        label, score = sp.classify(text)
        assert label == "bearish" and score < 0

    def test_negation_flips_a_word_cue(self):
        assert sp.classify("not bullish here")[0] == "bearish"
        assert sp.classify("I don't think it's bearish")[0] == "bullish"

    def test_neutral_and_time_horizon_phrases_are_not_direction(self):
        assert sp.classify("watching $AAPL into the conference call")[0] == "neutral"
        assert sp.classify("short term chart")[0] == "neutral"
        assert sp.classify("") == ("neutral", 0.0)
        assert sp.classify(None) == ("neutral", 0.0)

    def test_deterministic_and_bounded(self):
        t = "calls calls calls \U0001F680 bullish breakout"
        assert sp.classify(t) == sp.classify(t)
        assert -1 < sp.classify(t)[1] < 1
        assert -1 < sp.classify("puts puts bearish \U0001F43B crash")[1] < 1


# ── the store and retention ─────────────────────────────────────────────────

class TestStore:
    def test_record_is_idempotent_per_source_post_ticker(self, buzz):
        rows = sp.room_rows("c", "m1", "u1", _ts(2026, 10, 9), "NVDA calls", ["NVDA", "AMD", "NVDA"])
        assert len(rows) == 2
        assert buzz.record_posts(rows) == 2
        assert buzz.record_posts(rows) == 0

    def test_prune_removes_only_rows_past_retention(self, buzz, monkeypatch):
        monkeypatch.setenv(sp.RETENTION_ENV, "90")
        now = _ts(2026, 10, 10)
        old = now - 91 * 86400
        fresh = now - 5 * 86400
        buzz.record_posts(sp.room_rows("c", "old", "u", old, "bullish", ["NVDA"]))
        buzz.record_posts(sp.room_rows("c", "new", "u", fresh, "bullish", ["NVDA"]))
        assert sp.prune(now=now) == 1
        left = [r[0] for r in buzz.connect().execute("SELECT post_id FROM social_posts")]
        assert left == ["new"]

    def test_retention_is_a_named_knob_defaulting_to_90(self, monkeypatch):
        monkeypatch.delenv(sp.RETENTION_ENV, raising=False)
        assert sp.retention_days() == sp.DEFAULT_RETENTION_DAYS == 90
        monkeypatch.setenv(sp.RETENTION_ENV, "30")
        assert sp.retention_days() == 30
        monkeypatch.setenv(sp.RETENTION_ENV, "junk")
        assert sp.retention_days() == 90

    def test_prune_runs_with_the_flag_off(self, buzz, monkeypatch):
        buzz.record_posts(sp.room_rows("c", "old", "u", _ts(2026, 1, 1), "bullish", ["NVDA"]))
        monkeypatch.delenv(sp.ENABLED_ENV, raising=False)
        assert sp.prune(now=_ts(2026, 10, 10)) == 1

    def test_the_sweep_is_registered_and_the_guard_is_asked(self, buzz, monkeypatch):
        from api.services import store_retention as sr
        entry = sr.get("buzz")
        assert entry and entry.file == "buzz.db" and "social_posts" in entry.prunes
        assert sr.may_prune("buzz", "mentions") is False, "mention rows are never swept"
        buzz.record_posts(sp.room_rows("c", "old", "u", _ts(2026, 1, 1), "bullish", ["NVDA"]))
        monkeypatch.setattr(sr, "may_prune", lambda store, table: False)
        assert sp.prune(now=_ts(2026, 10, 10)) == 0, "an undeclared table must delete nothing"

    def test_maybe_prune_throttles(self, buzz, monkeypatch):
        calls = []
        monkeypatch.setattr(sp, "prune", lambda now=None: calls.append(1) or 0)
        monkeypatch.setattr(sp, "_last_prune", 0.0)
        sp.maybe_prune()
        sp.maybe_prune()
        assert len(calls) == 1

    def test_x_deletion_sync_drops_the_label(self, buzz):
        sp.record_tweet({"id": "t1", "text": "bullish", "created_at": _ts(2026, 10, 9),
                         "author_handle": "DeItaone"}, ["NVDA", "AMD"])
        assert buzz.delete_posts("x", ["t1"]) == 2


# ── the write paths ─────────────────────────────────────────────────────────

class TestWrites:
    def _msg(self, mid, content, bot=False):
        return {"id": str(mid), "content": content, "author": {"id": "u9", "bot": bot}}

    def test_room_ingest_keeps_text_only_while_armed(self, buzz, monkeypatch):
        from api.services import buzz_ingest
        mid = 1216816863313657886 << 1
        monkeypatch.delenv(sp.ENABLED_ENV, raising=False)
        buzz_ingest.ingest_messages("c", [self._msg(mid, "$NVDA ripping, calls")])
        assert buzz.connect().execute("SELECT COUNT(*) FROM social_posts").fetchone()[0] == 0
        assert buzz.connect().execute("SELECT COUNT(*) FROM mentions").fetchone()[0] == 1
        monkeypatch.setenv(sp.ENABLED_ENV, "1")
        buzz_ingest.ingest_messages("c", [self._msg(mid + 1, "$NVDA ripping, calls"),
                                          self._msg(mid + 2, "lunch?")])
        rows = buzz.connect().execute("SELECT ticker, text, label FROM social_posts").fetchall()
        assert [tuple(r) for r in rows] == [("NVDA", "$NVDA ripping, calls", "bullish")]

    def test_a_failed_text_write_never_stalls_the_mention_count(self, buzz, monkeypatch):
        from api.services import buzz_ingest
        monkeypatch.setattr(sp, "record_room", lambda rows: (_ for _ in ()).throw(sqlite3.OperationalError("x")))
        written, _ = buzz_ingest.ingest_messages("c", [self._msg(2 << 40, "$AMD puts")])
        assert written == 1

    def test_x_keeps_label_never_text_and_skips_mention_only_links(self, buzz):
        n = sp.record_tweet({"id": "t9", "text": "$NVDA beats, raises guidance; $AMD mentioned",
                             "created_at": _ts(2026, 10, 9), "author_handle": "DeItaone"},
                            ["NVDA", "AMD"], {"NVDA": True, "AMD": False})
        assert n == 1
        r = buzz.connect().execute("SELECT ticker, text, label, author FROM social_posts").fetchone()
        assert tuple(r) == ("NVDA", None, "bullish", "DeItaone")

    def test_x_is_a_noop_while_dark(self, buzz, monkeypatch):
        monkeypatch.delenv(sp.ENABLED_ENV, raising=False)
        assert sp.record_tweet({"id": "t1", "text": "bullish", "created_at": 1}, ["NVDA"]) == 0


# ── the read ────────────────────────────────────────────────────────────────

@pytest.fixture
def seeded(buzz, monkeypatch):
    rows = []
    rows += sp.room_rows("c", "r1", "u1", _ts(2026, 10, 9), "$NVDA bullish calls \U0001F680", ["NVDA"])
    rows += sp.room_rows("c", "r2", "u2", _ts(2026, 10, 8), "$NVDA puts, bearish", ["NVDA"])
    rows += sp.room_rows("c", "r3", "u3", _ts(2026, 10, 7), "$NVDA earnings next week", ["NVDA"])
    rows += sp.room_rows("c", "r4", "u1", _ts(2026, 9, 20), "$NVDA breaking out", ["NVDA"])   # 20 days back
    rows += sp.room_rows("c", "r5", "u1", _ts(2026, 10, 9), "$AMD bearish", ["AMD"])
    buzz.record_posts(rows)
    sp.record_tweet({"id": "t1", "text": "$NVDA downgrade", "created_at": _ts(2026, 10, 9, 13),
                     "author_handle": "Benzinga"}, ["NVDA"])
    monkeypatch.setattr(sp, "_x_texts", lambda ids: {})
    return buzz


class TestView:
    def test_one_week_splits_by_label_and_names_covered_days(self, seeded):
        out = sp.view("nvda", window="1w", now=NOW)
        assert out["state"] == "ok" and out["auto_labelled"] is True
        assert out["totals"]["bullish"] == 1 and out["totals"]["bearish"] == 2 and out["totals"]["neutral"] == 1
        assert out["totals"]["bull_share_pct"] == pytest.approx(33.3)
        assert out["totals"]["by_source"] == {"room": 3, "x": 1}
        assert len(out["days"]) == 7
        assert {d["date"] for d in out["days"]} >= {"2026-10-09", "2026-10-04"}

    def test_one_month_reaches_further_back(self, seeded):
        assert sp.view("NVDA", window="1m", now=NOW)["totals"]["posts"] == 5

    def test_days_before_the_first_stored_post_are_not_covered_not_zero(self, seeded):
        out = sp.view("NVDA", window="3m", now=NOW)
        first = next(d for d in out["days"] if d["state"] == "ok")
        assert first["date"] == out["window"]["covered_from"] == "2026-09-20"
        assert out["days"][0]["state"] == "not_covered" and out["days"][0]["bullish"] is None

    def test_retention_bounds_what_a_window_covers(self, seeded, monkeypatch):
        monkeypatch.setenv(sp.RETENTION_ENV, "7")
        out = sp.view("NVDA", window="3m", now=NOW)
        assert out["window"]["covered_from"] == "2026-10-03"
        assert out["totals"]["posts"] == 4

    def test_sorts_and_label_filter(self, seeded):
        ids = lambda s, **k: [p["id"] for p in sp.view("NVDA", window="1m", sort=s, now=NOW, **k)["posts"]]
        assert ids("newest")[0] in ("t1", "r1") and ids("oldest")[0] == "r4"
        top = sp.view("NVDA", window="1m", sort="most_bullish", now=NOW)["posts"]
        assert top[0]["label"] == "bullish" and top[-1]["label"] == "bearish"
        assert sp.view("NVDA", window="1m", sort="most_bearish", now=NOW)["posts"][0]["label"] == "bearish"
        assert ids("newest", label="bearish") == ["t1", "r2"]
        assert sp.view("NVDA", window="1m", label="bearish", now=NOW)["totals"]["posts"] == 5, \
            "the filter narrows the list, never the split"

    def test_source_filter(self, seeded):
        out = sp.view("NVDA", window="1m", source="x", now=NOW)
        assert [p["id"] for p in out["posts"]] == ["t1"]

    def test_room_post_carries_text_and_a_jump_link_x_without_text_says_why(self, seeded):
        posts = {p["id"]: p for p in sp.view("NVDA", window="1w", now=NOW)["posts"]}
        assert posts["r1"]["text"].startswith("$NVDA bullish") and posts["r1"]["text_state"] == "kept"
        assert posts["r1"]["link"].startswith("https://discord.com/channels/") and posts["r1"]["author"] is None
        assert posts["t1"]["text"] is None and posts["t1"]["text_state"] == "x_window_passed"

    def test_x_text_is_read_from_the_tweet_store_while_it_holds_it(self, seeded, monkeypatch):
        monkeypatch.setattr(sp, "_x_texts", lambda ids: {"t1": {"id": "t1", "text": "$NVDA downgrade",
                                                                "url": "https://x.com/a/1", "author_handle": "Benzinga"}})
        p = {p["id"]: p for p in sp.view("NVDA", window="1w", now=NOW)["posts"]}["t1"]
        assert (p["text"], p["text_state"], p["link"], p["author"]) == (
            "$NVDA downgrade", "kept", "https://x.com/a/1", "Benzinga")

    def test_unknown_params_fall_back(self, seeded):
        out = sp.view("NVDA", window="9y", sort="?", source="?", label="?", limit=10_000, now=NOW)
        assert (out["window_key"], out["sort"], out["source_filter"], out["label_filter"]) == ("1m", "newest", "all", "all")

    def test_empty_and_missing_store_are_states(self, buzz, tmp_path, monkeypatch):
        assert sp.view("NVDA", now=NOW)["state"] == "no_store"
        monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "absent" / "buzz.db"))
        buzz._reset_for_tests()
        assert sp.view("NVDA", now=NOW)["state"] == "no_store"


# ── the route and the mention-series pointer ────────────────────────────────

class TestRoute:
    @pytest.fixture
    def client(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import research_depth as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        return route, TestClient(app)

    URL = "/api/research/mention-series/NVDA/polarity"

    def test_dark_is_a_404_and_needs_both_flags(self, client, seeded, monkeypatch):
        _, c = client
        monkeypatch.setenv("MENTION_SERIES_ENABLED", "1")
        monkeypatch.delenv(sp.ENABLED_ENV, raising=False)
        assert c.get(self.URL).status_code == 404
        monkeypatch.setenv(sp.ENABLED_ENV, "1")
        monkeypatch.delenv("MENTION_SERIES_ENABLED", raising=False)
        assert c.get(self.URL).status_code == 404

    def test_armed_serves_and_validates_params(self, client, seeded, monkeypatch):
        _, c = client
        monkeypatch.setenv("MENTION_SERIES_ENABLED", "1")
        r = c.get(self.URL, params={"window": "1w", "sort": "most_bearish"})
        assert r.status_code == 200 and r.json()["window_key"] == "1w"
        assert c.get(self.URL, params={"window": "1y"}).status_code == 422
        assert c.get(self.URL, params={"sort": "random"}).status_code == 422
        assert c.get(self.URL, params={"limit": 0}).status_code == 422

    def test_paid_only(self, seeded, monkeypatch):
        from fastapi import FastAPI, HTTPException
        from fastapi.testclient import TestClient
        from api.routers import research_depth as route
        app = FastAPI()
        app.include_router(route.router)

        def _free():
            raise HTTPException(status_code=402, detail="paid")
        app.dependency_overrides[route.require_paid] = _free
        monkeypatch.setenv("MENTION_SERIES_ENABLED", "1")
        assert TestClient(app).get(self.URL).status_code == 402

    def test_handler_is_sync(self, client):
        route, _ = client
        assert not inspect.iscoroutinefunction(route.social_polarity_route)

    def test_the_mention_series_payload_points_at_the_route_only_when_on(self, seeded, monkeypatch):
        from api.services import mention_series as ms
        monkeypatch.delenv(sp.ENABLED_ENV, raising=False)
        assert ms.series("NVDA", now=NOW)["polarity"]["state"] == "unavailable"
        monkeypatch.setenv(sp.ENABLED_ENV, "1")
        pol = ms.series("NVDA", now=NOW)["polarity"]
        assert pol["state"] == "available" and pol["route"] == self.URL and pol["windows"] == ["1w", "1m", "3m"]


# ── pre-arm review 2026-10-11 ────────────────────────────────────────────────
# Scored against ~220 real posts from the curated X feed: the first cut read the feed's
# styled headlines as nothing, a cashtag ($BULL, $BEAR) as a mood, "sold out" as selling,
# and the option side backwards. Each case below is one of those, not a model.

class TestClassifyReview:
    @pytest.mark.parametrize("text,tickers,want", [
        ("TOP 10 WEEKLY DOWNGRADES: $NKE $TE $BULL $APP $NFLX", None, "bearish"),
        ("$BEAR ripping higher today", None, "bullish"),
        ("$BULL looking weak, lost support", None, "bearish"),
        ("BULL looking weak, lost support", ["BULL"], "bearish"),
        ("$HUM | Baird \U0001d602\U0001d5fd\U0001d5f4\U0001d5ff\U0001d5ee\U0001d5f1\U0001d5f2\U0001d600 "
         "Humana to \U0001d5e2\U0001d602\U0001d601\U0001d5fd\U0001d5f2\U0001d5ff\U0001d5f3\U0001d5fc\U0001d5ff\U0001d5fa",
         None, "bullish"),                                          # Unicode mathematical bold
        ("$APP | BofA maintains Hold, cuts PT to $325 from $400", None, "bearish"),
        ("Barclays initiates Overweight on $RKLB, PT $85", None, "bullish"),
        ("CEO says its optical components are sold out through 2029 $LITE", None, "bullish"),
        ("sold puts on $AMD, free money", None, "bullish"),
        ("selling puts on NVDA into the dip", None, "bullish"),
        ("buying puts on $TSLA here", None, "bearish"),
        ("rip my $TSLA calls", None, "bearish"),
        ("covered my $TSLA shorts", None, "bullish"),
        ("The market back at ATHs $AMD $DELL", None, "bullish"),
        ("$ASTS is now down 64% from its May high", None, "bearish"),
        ("can't believe $SMCI tanked again", None, "bearish"),
    ])
    def test_real_feed_shapes(self, text, tickers, want):
        assert sp.classify(text, tickers)[0] == want

    @pytest.mark.parametrize("text", [
        "$NVDA to the moon /s",                       # sarcasm marker
        "\U0001F480\U0001F480 $AMC",                  # skull = laughter in chat
        "how long can $NVDA hold up here",            # "long" the adverb
        "he puts it nicely, $MSFT is a story stock",  # "puts" the verb
        "Zeta Introduces AthenaOS, the enterprise OS $ZETA",   # 'ath' inside a word
        "$LUNR could rip from here",                  # bare "rip" is ambiguous
    ])
    def test_not_a_direction(self, text):
        assert sp.classify(text)[0] == "neutral"

    def test_room_rows_mask_a_bare_ticker_that_is_a_cue_word(self):
        rows = sp.room_rows("c", "m", "u", 1, "BULL looking weak, lost support", ["BULL", "BULL"])
        assert len(rows) == 1 and rows[0][7] == "bearish"


class TestReviewFixes:
    def test_x_text_from_the_tweet_store_is_unescaped(self, seeded, monkeypatch):
        monkeypatch.setattr(sp, "_x_texts", lambda ids: {"t1": {"id": "t1", "text": "AT&amp;T $T: -6.75% &lt;wow&gt;",
                                                                "url": "https://x.com/a/1", "author_handle": "B"}})
        p = {p["id"]: p for p in sp.view("NVDA", window="1w", now=NOW)["posts"]}["t1"]
        assert p["text"] == "AT&T $T: -6.75% <wow>"

    def test_a_non_https_x_link_is_dropped(self, seeded, monkeypatch):
        monkeypatch.setattr(sp, "_x_texts", lambda ids: {"t1": {"id": "t1", "text": "x",
                                                                "url": "javascript:alert(1)", "author_handle": "B"}})
        p = {p["id"]: p for p in sp.view("NVDA", window="1w", now=NOW)["posts"]}["t1"]
        assert p["link"] is None

    def test_every_store_write_holds_the_store_write_lock(self, buzz, monkeypatch):
        """buzz.db has ONE cached connection and was written by ONE thread (the buzz poll).
        FT-080 added two more writers on other scheduler threads (the tweet poller and the X
        deletion-sync), so each write must hold the store lock or the total_changes deltas and
        the commits interleave on the shared handle."""
        real = buzz.connect()
        seen = []

        class Spy:
            def __getattr__(self, name):
                attr = getattr(real, name)
                if name in ("execute", "executemany", "executescript", "commit"):
                    def wrapped(*a, **k):
                        seen.append((name, buzz._write_lock._is_owned()))
                        return attr(*a, **k)
                    return wrapped
                return attr

        monkeypatch.setattr(buzz, "connect", lambda: Spy())
        buzz.record_posts(sp.room_rows("c", "m1", "u", 1_700_000_000, "bullish", ["NVDA"]))
        buzz.record_mentions([("m1", "c", "u", "NVDA", 1_700_000_000, "cashtag")])
        buzz.prune_posts(1)
        buzz.delete_posts("x", ["t1"])
        writes = [owned for name, owned in seen if name in ("executemany", "commit")
                  or name == "execute"]
        assert writes and all(writes), seen


class TestRouteReview:
    URL = "/api/research/mention-series/NVDA/polarity"

    @pytest.fixture
    def armed(self, monkeypatch):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from api.routers import research_depth as route
        app = FastAPI()
        app.include_router(route.router)
        app.dependency_overrides[route.require_paid] = lambda: {"id": "u1"}
        monkeypatch.setenv("MENTION_SERIES_ENABLED", "1")
        monkeypatch.setenv(sp.ENABLED_ENV, "1")
        return TestClient(app, raise_server_exceptions=False)

    def test_member_text_is_never_cached(self, armed, seeded):
        r = armed.get(self.URL)
        assert r.status_code == 200
        cc = r.headers.get("cache-control", "")
        assert "private" in cc and "no-store" in cc, cc

    def test_empty_store_unknown_ticker_and_junk_symbol_never_500(self, armed, buzz):
        assert armed.get(self.URL).json()["state"] == "no_store"
        assert armed.get("/api/research/mention-series/ZZZZ/polarity").status_code == 200
        assert armed.get("/api/research/mention-series/%24%24%24/polarity").status_code in (400, 404, 422)
