"""Wisdom capture (S-A, D12) — every family reader against fixture stores in tmp_path.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a reader that raises into the runner instead of returning a NAMED gap;
2. a reader whose result is missing a contract key;
3. a reader that CREATES a product store where none exists (sqlite3.connect does
   that silently — the read-only open must refuse);
4. an as_of taken from the server clock where the source carries its own date
   (wire, candidates, screener, finviz) — the weekend double-observation class —
   and a stale source not being named;
5. the detections / outcomes / vision delta leaving its watermark window, or a
   re-run of the same as_of reading an EMPTY window (a false zero-row page);
6. the street reader exceeding its per-ticker bound or one dead leg sinking the
   others, and the RS reader recomputing instead of reading the cache.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import sqlite3
import time

import pytest

from api.services.wisdom.capture import families
from api.services.wisdom.capture.families import (
    breadth_intraday as f_breadth,
    candidates as f_candidates,
    catalysts as f_catalysts,
    detection_outcomes as f_outcomes,
    detections as f_detections,
    finviz as f_finviz,
    gex as f_gex,
    rs as f_rs,
    screener as f_screener,
    street as f_street,
    themes as f_themes,
    tweets as f_tweets,
    vision as f_vision,
    wire as f_wire,
    wire_inputs as f_wire_inputs,
)
from api.services.wisdom.capture.families._base import RESULT_KEYS, RowStream, et_day_start_epoch, slot_epoch
from api.services.wisdom.core import timeutil

ET = timeutil.ET
MONDAY = dt.date(2026, 9, 14)
MONDAY_EOD = dt.datetime(2026, 9, 14, 16, 52, tzinfo=ET)
MONDAY_MORNING = dt.datetime(2026, 9, 14, 5, 43, tzinfo=ET)
TUESDAY_MORNING = dt.datetime(2026, 9, 15, 5, 43, tzinfo=ET)
SATURDAY = dt.datetime(2026, 9, 12, 10, 0, tzinfo=ET)


@pytest.fixture(autouse=True)
def _no_retry_sleep(monkeypatch):
    monkeypatch.setattr(f_wire, "RETRY_DELAY_S", 0.0)


def _shape(out: dict, family: str) -> dict:
    assert set(RESULT_KEYS) <= set(out), sorted(out)
    assert out["family"] == family
    assert isinstance(out["gaps"], dict) and isinstance(out.get("meta"), dict)
    return out


def test_the_calendar_this_file_relies_on():
    assert timeutil.is_trading_day(MONDAY)
    assert not timeutil.is_trading_day(dt.date(2026, 9, 12))


# ── never raises, whatever the input ────────────────────────────────────────

@pytest.mark.parametrize("ds", families.DATASETS, ids=lambda d: d.name)
def test_no_reader_ever_raises_into_the_runner(ds):
    out = ds.read(as_of=None, now_et=None, state=None)
    _shape(out, ds.name)
    assert out["payload"] is None
    assert out["gaps"], "an unreadable source must be a NAMED gap"


# ── wire and candidates ─────────────────────────────────────────────────────

def test_wire_keys_on_the_payloads_own_date_and_names_a_stale_session(monkeypatch):
    from api.services import engine

    monkeypatch.setattr(engine, "_load_wire_data", lambda: {"date": "2026-09-14", "themes": {}, "breadth": {}})
    out = _shape(f_wire.read(as_of=None, now_et=MONDAY_EOD, state={}), "wire")
    assert (out["as_of"], out["rows"], out["gaps"]) == ("2026-09-14", 3, {})

    monkeypatch.setattr(engine, "_load_wire_data", lambda: {"date": "2026-09-11"})
    stale = f_wire.read(as_of=None, now_et=MONDAY_EOD, state={})
    assert stale["as_of"] == "2026-09-11" and "stale" in stale["gaps"]
    assert stale["meta"]["stale_session"] == "2026-09-14"
    # control: Saturday's run of Friday's payload is the SAME observation, not a stale one
    sat = f_wire.read(as_of=None, now_et=SATURDAY, state={})
    assert sat["as_of"] == "2026-09-11" and "stale" not in sat["gaps"]


def test_an_unreadable_wire_is_retried_once_then_named(monkeypatch):
    from api.services import engine

    calls: list = []
    monkeypatch.setattr(engine, "_load_wire_data", lambda: calls.append(1) or None)
    out = _shape(f_wire.read(as_of=None, now_et=MONDAY_EOD, state={}), "wire")
    assert out["payload"] is None and "wire_data" in out["gaps"] and len(calls) == 2

    def boom():
        raise OSError("volume gone")

    monkeypatch.setattr(engine, "_load_wire_data", boom)
    out = f_wire.read(as_of=None, now_et=MONDAY_EOD, state={})
    assert out["payload"] is None and "reader_exception" in out["gaps"]


def test_candidates_are_counted_through_the_one_envelope_reader(monkeypatch):
    from api.services import engine

    envelope = {"market_date": "2026-09-14", "generated_at": "2026-09-14 06:40:00 CT",
                "candidates": {"pullback_ma": [{"ticker": "AAA"}, {"ticker": "BBB"}],
                               "gapper_news": [{"ticker": "CCC"}], "remount": []}}
    monkeypatch.setattr(engine, "_load_wire_data", lambda: {"date": "2026-09-14", "candidates": envelope})
    monkeypatch.setattr(engine, "get_candidates", lambda: envelope)
    real_rows = engine.candidate_rows
    counted: list = []
    monkeypatch.setattr(engine, "candidate_rows", lambda *b: counted.append(b) or real_rows(*b))
    out = _shape(f_candidates.read(as_of=None, now_et=MONDAY_EOD, state={}), "candidates")
    assert out["rows"] == 3 and counted == [()] and out["payload"] is envelope
    assert out["as_of"] == "2026-09-14" and out["meta"]["buckets"] == ["gapper_news", "pullback_ma", "remount"]

    monkeypatch.setattr(engine, "get_candidates", lambda: {})
    missing = f_candidates.read(as_of=None, now_et=MONDAY_EOD, state={})
    assert missing["payload"] is None and "candidates" in missing["gaps"]


# ── screener, street, finviz ────────────────────────────────────────────────

@pytest.fixture
def screener_db(tmp_path, monkeypatch):
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    from api.services.screener import snapshot_db

    snapshot_db.init_db()
    with sqlite3.connect(path) as conn:
        for i, (ticker, bars, snap) in enumerate((("CCC", 20260910, "2026-09-10"),
                                                  ("AAA", 20260911, "2026-09-12"),
                                                  ("BBB", 20260911, "2026-09-12"))):
            conn.execute("INSERT INTO screener_rows (ticker, bars_asof, snapshot_date, short_float_pct, pt_target) "
                         "VALUES (?, ?, ?, ?, ?)", (ticker, bars, snap, 3.5 + i, 100.0 + i))
    return path


def test_screener_keys_on_the_median_bars_asof_and_streams_rows(screener_db):
    out = _shape(f_screener.read(as_of=None, now_et=MONDAY_MORNING, state={}), "screener")
    assert out["as_of"] == "2026-09-11" and out["rows"] == 3 and "stale" not in out["gaps"]
    assert out["meta"]["describe"]["mixed"] is True
    assert isinstance(out["payload"], RowStream)
    assert [r["ticker"] for r in out["payload"]] == ["AAA", "BBB", "CCC"]
    stale = f_screener.read(as_of=None, now_et=TUESDAY_MORNING, state={})
    assert stale["meta"]["stale_session"] == "2026-09-14" and "stale" in stale["gaps"]


def test_a_missing_screener_store_is_named_and_never_created(tmp_path, monkeypatch):
    path = tmp_path / "absent" / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    out = f_screener.read(as_of=None, now_et=MONDAY_MORNING, state={})
    assert out["payload"] is None and "screener_db" in out["gaps"]
    assert not path.exists()


def test_street_bounds_the_per_ticker_leg_and_a_dead_leg_costs_only_itself(screener_db, tmp_path, monkeypatch):
    from api.services import short_interest
    from api.services.catalyst import ticker_metadata
    from api.services.screener import analyst_pass

    meta_path = tmp_path / "catalyst_metadata.db"
    with sqlite3.connect(meta_path) as conn:
        conn.executescript(ticker_metadata._SCHEMA)
        conn.execute("INSERT INTO ticker_metadata (ticker, float_shares, shares_outstanding, fetched_at) "
                     "VALUES ('AAA', 10, 20, 1)")
    monkeypatch.setattr(ticker_metadata, "_DB_PATH", str(meta_path))
    names = {f"T{i:03d}" for i in range(f_street.PER_TICKER_MAX + 25)}
    monkeypatch.setattr(analyst_pass, "actives", lambda failures=None: set(names))
    fetched: list = []
    monkeypatch.setattr(short_interest, "get_short_interest",
                        lambda sym: fetched.append(sym) or {"ticker": sym, "as_of": 1757030400})
    out = _shape(f_street.read(as_of=None, now_et=MONDAY_EOD, state={}), "street")
    assert len(fetched) == f_street.PER_TICKER_MAX and "active_set_capped" in out["gaps"]
    assert len(out["payload"]["screener_columns"]) == 3
    assert out["payload"]["catalyst_metadata"][0]["float_shares"] == 10
    assert "price_targets_per_ticker" in out["gaps"] and out["as_of"] == "2026-09-14"

    def dead(failures=None):
        raise RuntimeError("auth.db locked")

    monkeypatch.setattr(analyst_pass, "actives", dead)
    out = f_street.read(as_of=None, now_et=MONDAY_EOD, state={})
    assert out["payload"]["short_interest"] is None and "short_interest" in out["gaps"]
    assert out["payload"]["screener_columns"] and out["rows"] == 3


def test_finviz_keys_on_the_artifacts_own_pull_and_hashes_the_bytes(tmp_path, monkeypatch):
    path = tmp_path / "screener_finviz.json"
    raw = json.dumps({"as_of": "2026-09-14T06:45:03+00:00", "missing_headers": [],
                      "rows": {"AAA": {"short_float_pct": 4.1}, "BBB": {"short_float_pct": 2.0}}}).encode()
    path.write_bytes(raw)
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(path))
    out = _shape(f_finviz.read(as_of=None, now_et=MONDAY_MORNING, state={}), "finviz")
    assert out["as_of"] == "2026-09-14" and out["rows"] == 2
    assert out["meta"]["source_sha256"] == hashlib.sha256(raw).hexdigest()
    stale = f_finviz.read(as_of=None, now_et=TUESDAY_MORNING, state={})
    assert stale["meta"]["stale_session"] == "2026-09-15"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(tmp_path / "none.json"))
    assert "finviz_artifact" in f_finviz.read(as_of=None, now_et=MONDAY_MORNING, state={})["gaps"]


# ── rs, gex, themes ─────────────────────────────────────────────────────────

def test_rs_reads_the_cache_only_and_never_recomputes(monkeypatch):
    from api.services import rs_ranking

    monkeypatch.setattr(rs_ranking, "compute_rs_scores",
                        lambda *a, **k: pytest.fail("capture must never run the RS rebuild"))
    monkeypatch.setattr(rs_ranking, "cached_rank_map", lambda: {})
    cold = _shape(f_rs.read(as_of=None, now_et=MONDAY_EOD, state={}), "rs")
    assert cold["payload"] is None and "cache_cold" in cold["gaps"]
    monkeypatch.setattr(rs_ranking, "cached_rank_map", lambda: {"BBB": {"rs_rank": 50}, "AAA": {"rs_rank": 99}})
    warm = f_rs.read(as_of=None, now_et=MONDAY_EOD, state={})
    assert warm["rows"] == 2 and list(warm["payload"]) == ["AAA", "BBB"] and warm["as_of"] == "2026-09-14"


def test_gex_is_a_named_gap_that_carries_the_costed_alternative():
    out = _shape(f_gex.read(as_of=None, now_et=MONDAY_EOD, state={}), "gex")
    assert out["payload"] is None and "gex_not_on_web" in out["gaps"]
    assert "different loop" in out["gaps"]["gex_not_on_web"]
    assert out["meta"]["alternative"]["calls_per_session"] > 0
    assert families.by_name("gex").pages == frozenset()


def test_themes_count_holdings_by_source_and_name_unreadable_tables(monkeypatch):
    from api.services import theme_db

    monkeypatch.setattr(theme_db, "get_all_themes", lambda: {
        "sectors": [{"id": "tech"}],
        "themes": [{"id": "ai", "holdings": [{"sym": "AAA", "source": "owner"}, {"sym": "BBB", "source": "engine"}]}]})
    monkeypatch.setattr(f_themes, "_seed_marks", lambda: {"theme_seed_version": "4.22.0"})
    out = _shape(f_themes.read(as_of=None, now_et=MONDAY_MORNING, state={}), "themes")
    assert out["rows"] == 2 and out["meta"]["holdings_by_source"] == {"engine": 1, "owner": 1}
    assert out["meta"]["taxonomy_version"] == "4.22.0" and out["as_of"] == "2026-09-14"

    def no_tables():
        raise sqlite3.OperationalError("no such table: theme_sectors")

    monkeypatch.setattr(theme_db, "get_all_themes", no_tables)
    assert "theme_tables" in f_themes.read(as_of=None, now_et=MONDAY_MORNING, state={})["gaps"]


# ── breadth path, tweets ────────────────────────────────────────────────────

def test_breadth_intraday_reads_one_session_and_keeps_unparseable_samples(tmp_path, monkeypatch):
    from api.services import breadth_intraday

    path = tmp_path / "breadth_intraday.db"
    monkeypatch.setenv("BREADTH_INTRADAY_DB", str(path))
    conn = sqlite3.connect(path)
    breadth_intraday._init_schema(conn)
    conn.executemany("INSERT INTO breadth_intraday (session_date, as_of, metrics) VALUES (?, ?, ?)", [
        ("2026-09-14", 1060, "{not json"), ("2026-09-14", 1000, json.dumps({"pct_above_50sma": 51.2})),
        ("2026-09-11", 900, "{}")])
    conn.commit()
    conn.close()
    out = _shape(f_breadth.read(as_of=None, now_et=MONDAY_EOD, state={}), "breadth_intraday")
    assert out["rows"] == 2 and out["payload"][0] == {"as_of": 1000, "metrics": {"pct_above_50sma": 51.2}}
    assert out["payload"][1]["metrics"] == "{not json" and "unparseable_metrics" in out["gaps"]
    monkeypatch.setenv("BREADTH_INTRADAY_DB", str(tmp_path / "absent.db"))
    assert "breadth_intraday_db" in f_breadth.read(as_of=None, now_et=MONDAY_EOD, state={})["gaps"]
    assert not (tmp_path / "absent.db").exists()


def test_tweets_capture_one_et_day_of_official_posts_only(tmp_path, monkeypatch):
    from api.services import tweet_store

    monkeypatch.setattr(tweet_store, "_DB_PATH", str(tmp_path / "tweets.db"))
    tweet_store._init_db()
    tweet_store.ensure_official_accounts()
    tweet_store.add_account("DeItaone")
    day = dt.datetime.fromtimestamp(time.time(), ET).date()
    start = et_day_start_epoch(day)

    def post(tid, handle, created):
        tweet_store.upsert_tweet({"id": tid, "author_handle": handle, "text": "t", "created_at": created,
                                  "url": f"https://x.com/{handle}/status/{tid}"}, ["AAA"])

    post("1", "TSDR_Trading", start + 3600)
    post("2", "Braczyy", start - 60)          # the day before
    post("3", "DeItaone", start + 7200)       # not an official account
    out = _shape(f_tweets.read(as_of=day, now_et=MONDAY_EOD, state={}), "tweets")
    assert out["rows"] == 1 and out["payload"][0]["id"] == "1" and out["payload"][0]["tickers"] == ["AAA"]
    assert out["meta"]["per_handle"] == {"TSDR_Trading": 1} and out["as_of"] == day.isoformat()
    # the hourly slot completes YESTERDAY at 00:29
    assert f_tweets.default_day(dt.datetime(2026, 9, 15, 0, 29, tzinfo=ET)) == MONDAY


def test_tweets_never_create_the_store(tmp_path, monkeypatch):
    from api.services import tweet_store

    path = tmp_path / "tweets.db"
    monkeypatch.setattr(tweet_store, "_DB_PATH", str(path))
    out = f_tweets.read(as_of=None, now_et=MONDAY_EOD, state={})
    assert "tweets_db" in out["gaps"] and not path.exists()


# ── detections, outcomes, vision: watermark windows ─────────────────────────

@pytest.fixture
def patterns_db(tmp_path, monkeypatch):
    from api.services.pattern_engine import pattern_db

    path = tmp_path / "patterns.db"
    monkeypatch.setenv("PATTERN_DB_PATH", str(path))
    with sqlite3.connect(path) as conn:
        conn.executescript(pattern_db._SCHEMA)
        for alter in pattern_db._PATTERN_ALTERS:
            conn.execute(alter)
    return path


def _detection(conn, did, detected, seen):
    conn.execute(
        "INSERT INTO pattern_detections (id, sym, tf, pattern_id, category, direction, start_t, end_t, confidence, "
        "quality_json, geometry_json, levels_json, context_json, narrative_json, status, detected_at, last_seen_at, "
        "hash_key) VALUES (?, 'AAA', 'D', 'vcp', 'classical', 'long', 1, 2, 0.5, '{}', '{}', '{}', '{}', '{}', "
        "'active', ?, ?, ?)", (did, detected, seen, f"h-{did}"))


def test_the_detections_delta_is_the_watermark_window_and_a_rerun_reads_it_again(patterns_db):
    from api.services.pattern_engine.memory import ACTIVE_WINDOW_SECS

    hi = slot_epoch(MONDAY, *f_detections.SLOT)
    lo = hi - 86400
    with sqlite3.connect(patterns_db) as conn:
        _detection(conn, "new", hi - 3600, hi - 3600)
        _detection(conn, "reseen", lo - 3 * 86400, hi - 100)
        _detection(conn, "outside_active_window", lo - ACTIVE_WINDOW_SECS - 60, hi - 100)
        _detection(conn, "already_captured", lo - 10, lo - 5)
        _detection(conn, "after_the_slot", hi + 10, hi + 10)
    out = _shape(f_detections.read(as_of=MONDAY, now_et=MONDAY_EOD, state={"watermark": lo}), "detections")
    assert isinstance(out["payload"], RowStream) and out["rows"] is None
    assert [r["id"] for r in out["payload"]] == ["reseen", "new"]
    assert (out["meta"]["window_lo"], out["meta"]["watermark_next"]) == (lo, hi)

    rerun_state = {"watermark": hi, "window_lo": lo, "window_as_of": MONDAY.isoformat()}
    again = f_detections.read(as_of=MONDAY, now_et=MONDAY_EOD, state=rerun_state)
    assert [r["id"] for r in again["payload"]] == ["reseen", "new"]
    # control: without the as_of match the same watermark yields an empty, NAMED window
    empty = f_detections.read(as_of=MONDAY, now_et=MONDAY_EOD, state={"watermark": hi})
    assert empty["payload"] == [] and empty["rows"] == 0 and "window_empty" in empty["gaps"]
    first = f_detections.read(as_of=MONDAY, now_et=MONDAY_EOD, state={})
    assert "first_window" in first["gaps"] and first["meta"]["window_lo"] == lo


def test_detections_name_the_shared_root_guard_instead_of_raising(monkeypatch):
    def guarded():
        raise RuntimeError("PatternDbSharedRootGuard: set PATTERN_DB_PATH")

    monkeypatch.setattr(f_detections, "resolve_path", guarded)
    out = f_detections.read(as_of=MONDAY, now_et=MONDAY_EOD, state={})
    assert out["payload"] is None and "patterns_db_path" in out["gaps"]


def test_outcomes_follow_resolved_at_inside_the_same_window(patterns_db):
    hi = slot_epoch(MONDAY, *f_detections.SLOT)
    lo = hi - 86400
    with sqlite3.connect(patterns_db) as conn:
        for did, resolved in (("in", hi - 5), ("before", lo), ("after", hi + 1)):
            _detection(conn, did, lo - 10, lo - 10)
            conn.execute("INSERT INTO pattern_outcomes (detection_id, resolved_at) VALUES (?, ?)", (did, resolved))
    out = _shape(f_outcomes.read(as_of=MONDAY, now_et=MONDAY_EOD, state={"watermark": lo}), "detection_outcomes")
    assert [r["detection_id"] for r in out["payload"]] == ["in"] and out["rows"] == 1


def test_vision_takes_verdicts_judged_inside_the_session_window(tmp_path, monkeypatch):
    from api.services.pattern_vision import store as vision_store

    monkeypatch.setenv("PATTERN_VISION_DB_PATH", str(tmp_path / "pattern_vision.db"))
    vision_store.init_db()
    start = et_day_start_epoch(MONDAY)
    hi = slot_epoch(MONDAY, *f_vision.SLOT)
    for ticker, judged in (("IN", start + 3600), ("YESTERDAY", start - 10), ("LATE", hi + 10)):
        vision_store.put_verdict({"ticker": ticker, "tf": "D", "setup": "vcp", "asof_date": "2026-09-11",
                                  "confirmed": 1, "judged_at": judged})
    out = _shape(f_vision.read(as_of=None, now_et=MONDAY_EOD, state={}), "vision")
    assert [r["ticker"] for r in out["payload"]] == ["IN"] and out["as_of"] == "2026-09-14"


# ── catalysts, wire inputs ──────────────────────────────────────────────────

def test_catalysts_keep_dropped_rows_and_never_create_the_store(tmp_path, monkeypatch):
    from api.services.catalyst import store as catalyst_store

    monkeypatch.setattr(catalyst_store, "_DB_PATH", str(tmp_path / "catalysts.db"))
    catalyst_store._init_db()
    with sqlite3.connect(tmp_path / "catalysts.db") as conn:
        conn.executemany("INSERT INTO catalysts (market_date, ticker, rank, score, refreshed_at) VALUES (?, ?, ?, ?, ?)",
                         [("2026-09-14", "BBB", None, 10.0, 5), ("2026-09-14", "AAA", 1, 90.0, 5),
                          ("2026-09-11", "CCC", 1, 50.0, 4)])
    out = _shape(f_catalysts.read(as_of=None, now_et=MONDAY_EOD, state={}), "catalysts")
    assert [r["ticker"] for r in out["payload"]] == ["AAA", "BBB"] and out["meta"]["ranked"] == 1

    absent = tmp_path / "other" / "catalysts.db"
    monkeypatch.setattr(catalyst_store, "_DB_PATH", str(absent))
    assert "catalysts_db" in f_catalysts.read(as_of=None, now_et=MONDAY_EOD, state={})["gaps"]
    assert not absent.exists()


def test_wire_inputs_read_the_brain_pack_as_of_the_wire_date(tmp_path, monkeypatch):
    from api.services import engine
    from api.services.cache import cache

    brain = tmp_path / "brain" / "data"
    brain.mkdir(parents=True)
    with sqlite3.connect(brain / "uct_intelligence.db") as conn:
        conn.execute("CREATE TABLE leadership_snapshots (snapshot_date TEXT, rank INTEGER, symbol TEXT)")
        conn.executemany("INSERT INTO leadership_snapshots VALUES (?, ?, ?)",
                         [("2026-09-11", 1, "AAA"), ("2026-09-11", 2, "BBB"), ("2026-09-15", 1, "ZZZ")])
        conn.execute("CREATE TABLE market_regimes (regime_date TEXT, phase TEXT)")
        conn.executemany("INSERT INTO market_regimes VALUES (?, ?)", [("2026-09-11", "uptrend"), ("2026-09-16", "x")])
    monkeypatch.setenv("BRAIN_DIR", str(tmp_path / "brain"))
    monkeypatch.setattr(engine, "_load_wire_data", lambda: {"date": "2026-09-14"})
    cache.invalidate("intraday_update")
    out = _shape(f_wire_inputs.read(as_of=None, now_et=MONDAY_EOD, state={}), "wire_inputs")
    assert [r["symbol"] for r in out["payload"]["leadership_snapshots"]] == ["AAA", "BBB"]
    assert [r["regime_date"] for r in out["payload"]["market_regimes"]] == ["2026-09-11"]
    assert out["rows"] == 3 and "intraday_update" in out["gaps"] and "morning_wire_state_json" in out["gaps"]

    monkeypatch.setenv("BRAIN_DIR", str(tmp_path / "no_brain"))
    none = f_wire_inputs.read(as_of=None, now_et=MONDAY_EOD, state={})
    assert none["payload"] is None and "brain_pack" in none["gaps"]
