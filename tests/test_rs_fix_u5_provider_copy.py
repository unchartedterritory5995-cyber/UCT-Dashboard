"""Regression rails for the RS Phase 2a/2b review, unit U5 (chart provider and
evidence copy, 2026-11-07): findings #6, #7, #8, #13, #16, #19, #21, #22, #24.

Each test below failed on cb97c86931 and passes with the U5 fix. The fixtures
and helpers are the provider suite's own (`tests/test_rs_columns_provider.py`),
imported rather than retyped, so the hermetic reads (no industry map, no
rating table, an empty evidence data dir) hold here too.
"""
from __future__ import annotations

import pathlib
import sqlite3

import pytest

from api.routers import signature as sig
from api.services.signature import rs_provider as rsp
from api.services import rs_evidence_pull as ep
from api.services.signature import registry_defs as rd
from tests.test_rs_columns_provider import (  # noqa: F401 - fixtures are used by name
    _bars, _hermetic_reads, _long_daily, _no_cache, v2_row,
)
from tests.test_rs_evidence_pull import fixture_artifact, write_artifact


def _counting_fetcher(store):
    """Like the provider suite's `_fetcher`, but honours ``count`` the way the
    real bar reader does (the newest ``count`` bars), so a deeper read returns
    more history."""
    calls = []

    def fetch(sym, tf, count):
        calls.append((sym, tf, count))
        return list(store.get(sym.upper(), [])[-int(count):])
    fetch.calls = calls
    return fetch


@pytest.fixture
def fresh_gen(monkeypatch):
    """A cold data-generation memo for one test."""
    monkeypatch.setitem(rsp._RS_GEN_MEMO, "at", None)
    monkeypatch.setitem(rsp._RS_GEN_MEMO, "value", None)


# ── #6: the hit rate reads against the baseline; the floor is effective N ─────

def test_6_the_measured_sentence_carries_the_all_bars_baseline():
    line = ep.summary_line("rs_new_high_before_price", 63, fixture_artifact())
    assert "58.3% (likely between 52.0% and 64.4%) beat SPY from the next session's open" in line, \
        "the base is stated (N6), the hit rate with its likely range (VA3)"
    assert "against 50.2% for all bars" in line, line
    assert "on 240 sessions" in line, "the sessions the events fell on are printed"


def test_6_the_display_floor_is_checked_on_distinct_sessions_not_raw_n():
    art = fixture_artifact()
    block = art["per_signal"]["rs_new_high_red_day"]
    block["horizons"]["63"]["n"] = 5000            # raw n far over the floor ...
    block["dates"] = 40                            # ... on 40 red sessions: 40 observations
    ev = ep.evidence_for("rs_new_high_red_day", 63, art)
    assert ev["effective_n"] == 40 and ev["sessions"] == 40
    assert ev["displayable"] is False
    assert "% beat " not in ep.sentence_for(ev), "under the floor, no hit rate prints"
    block["dates"] = 100
    assert ep.evidence_for("rs_new_high_red_day", 63, art)["displayable"] is True
    # an artifact that does not say how many sessions has no effective N
    del block["dates"]
    assert ep.evidence_for("rs_new_high_red_day", 63, art)["displayable"] is False


# ── #7: sessions, not bars; the daily measurement says so on any chart ────────

def test_7_the_sentence_counts_sessions_on_daily_bars_never_bars():
    art = fixture_artifact()
    for signal in ep.CARD_SIGNALS.values():
        for h in (21, 63, 126):
            line = ep.summary_line(signal, h, art)
            assert "bars later" not in line and "21-bar" not in line, line
    line = ep.summary_line("rs_new_high", 63, art)
    assert "daily bars" in line and "63 sessions later (about 3 months" in line, line
    assert ep.SIGNAL_LABELS["rs_cross_up_21ema"] == "RS line crosses above its 21-day average"


def test_7_a_weekly_envelope_prints_no_weekly_horizon(v2_row, monkeypatch, tmp_path):
    write_artifact(tmp_path, fixture_artifact())
    store = _long_daily()
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _counting_fetcher(store))
    _no_cache(monkeypatch)
    ev = sig._rs_line_provider("NVDA", "W", {"benchmark": "SPY"})["payload"]["evidence"]
    for key, line in ev["sentence"].items():
        assert "bars later" not in line and "21-bar" not in line, (key, line)
    assert "63 sessions later" in ev["sentence"]["beforePrice"]


# ── #8: green on red counts red days in the window ────────────────────────────

def _green_on_red_bars():
    """260 sessions; the benchmark is down 1% on exactly four of the last
    twenty (245, 249, 253, 257) and up otherwise; the stock is up on the first
    three of them and down on the fourth."""
    reds = (245, 249, 253, 257)
    stock, bench = [], []
    c, b = 100.0, 400.0
    for i in range(260):
        b *= 0.99 if i in reds else 1.003
        if i in reds:
            c *= 1.005 if i != 257 else 0.995
        else:
            c *= 1.001
        stock.append({"t": 1000 + i, "o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": 1})
        bench.append({"t": 1000 + i, "o": b, "h": b, "l": b, "c": b, "v": 1})
    return stock, bench


def test_8_the_green_on_red_reason_names_the_red_days_it_counted():
    stock, bench = _green_on_red_bars()
    g = rsp._rs_checks(stock, bench, "SPY", -0.5)["greenOnRed"]
    assert g["count"] == 3 and g["redDays"] == 4 and g["of"] == 20
    assert g["reason"] == "up on 3 of 4 red days in the last 20 sessions", g["reason"]
    assert "of the last 20 red days" not in g["reason"]


# ── #13: the anchor is undecided when the benchmark's low is today ────────────

def test_13_the_anchor_is_not_a_fail_when_the_benchmark_low_is_today():
    n = 260
    bench = _bars([400.0 + i for i in range(n - 1)] + [300.0])       # today is the 20-session low
    stock = _bars([100.0 + 0.5 * i for i in range(n)])
    out = rsp._rs_checks(stock, bench, "SPY", -0.5)
    a = out["anchor"]
    assert a["pass"] is None and a["barsAgo"] == 0
    assert a["reason"] == "SPY's 20-session low is today"
    decided = [k for k in ("ma", "anchor", "pivotSpeed", "greenOnRed") if out[k]["pass"] is not None]
    assert "anchor" not in decided and out["of"] == len(decided)


# ── #16: the v2 cache key carries the rating session and the evidence asof ────

def _key_for(monkeypatch, rating, asof):
    monkeypatch.setitem(rsp._RS_GEN_MEMO, "at", None)
    monkeypatch.setitem(rsp._RS_GEN_MEMO, "value", None)
    monkeypatch.setattr(rsp, "_rs_newest_rating_session", lambda: rating)
    monkeypatch.setattr(rsp, "_rs_evidence_asof", lambda: asof)
    seen = {}
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: seen.update(key=k))
    sig._rs_line_provider("NVDA", "D", {"lookback": 20})
    return seen["key"]


def test_16_a_new_rating_session_or_artifact_is_a_new_key(v2_row, monkeypatch):
    n = 30
    store = {"NVDA": _bars([100.0 + i for i in range(n)]), "SPY": _bars([400.0] * n)}
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _counting_fetcher(store))
    monkeypatch.setattr(rsp, "_et_session_day", lambda: "2026-11-06")
    before = _key_for(monkeypatch, "20261104", "2026-11-04")
    after_rating = _key_for(monkeypatch, "20261105", "2026-11-04")
    after_pull = _key_for(monkeypatch, "20261105", "2026-11-05")
    assert len({before, after_rating, after_pull}) == 3
    assert before.endswith(":2026-11-06") and "r20261104|e2026-11-04" in before
    assert _key_for(monkeypatch, None, None).endswith("r-|e-:2026-11-06"), "unknown parts still key"


def test_16_the_flag_off_key_is_unchanged_and_reads_nothing(monkeypatch):
    monkeypatch.setattr(rd, "RS_V2_ENABLED", False)
    n = 30
    store = {"NVDA": _bars([100.0 + i for i in range(n)]), "SPY": _bars([400.0] * n)}
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _counting_fetcher(store))
    monkeypatch.setattr(rsp, "_et_session_day", lambda: "2026-11-06")

    def boom(*a, **k):
        raise AssertionError("a v1 compute must not read the data generation")
    monkeypatch.setattr(rsp, "_rs_data_generation", boom)
    seen = {}
    monkeypatch.setattr(sig.cache, "get", lambda k: None)
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: seen.update(key=k))
    env = sig._rs_line_provider("NVDA", "D", {"lookback": 20})
    assert "payload" not in env
    assert seen["key"].endswith('}:2026-11-06'), seen["key"]


def test_16_the_generation_is_memoised_briefly(monkeypatch, fresh_gen):
    reads = []
    monkeypatch.setattr(rsp, "_rs_newest_rating_session", lambda: reads.append(1) or "20261105")
    monkeypatch.setattr(rsp, "_rs_evidence_asof", lambda: "2026-11-05")
    assert rsp._rs_data_generation(now=1000.0) == "r20261105|e2026-11-05"
    monkeypatch.setattr(rsp, "_rs_newest_rating_session", lambda: reads.append(1) or "20261106")
    assert rsp._rs_data_generation(now=1000.0 + rsp._RS_GEN_TTL_S - 1) == "r20261105|e2026-11-05"
    assert rsp._rs_data_generation(now=1000.0 + rsp._RS_GEN_TTL_S + 1) == "r20261106|e2026-11-05"
    assert len(reads) == 2


def test_16_the_rating_session_read_is_read_only(monkeypatch, tmp_path):
    from api.services.screener import rs_history
    db = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(db))
    assert rsp._rs_newest_rating_session() is None, "no table is None"
    with sqlite3.connect(db) as conn:
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert rs_history.TABLE not in names, "the read never creates the table on a dark pod"
    with sqlite3.connect(db) as conn:
        rs_history.ensure_schema(conn)
        conn.executemany(f"INSERT INTO {rs_history.TABLE} (session, ticker, ibd) VALUES (?, ?, ?)",
                         [("20261104", "NVDA", 90), ("20261105", "NVDA", 91), ("20261105", "AAPL", 50)])
    assert rsp._rs_newest_rating_session() == "20261105"


def test_16_the_evidence_asof_comes_from_the_local_artifact(tmp_path):
    assert rsp._rs_evidence_asof() is None
    write_artifact(tmp_path, fixture_artifact())
    assert rsp._rs_evidence_asof() == "2026-11-04"


# ── #19: the regime does not depend on the RS lookback ────────────────────────

def test_19_the_regime_is_identical_at_every_lookback(v2_row, monkeypatch):
    store = _long_daily(n=1200)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _counting_fetcher(store))
    _no_cache(monkeypatch)
    regimes = [sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY", "lookback": lb})["payload"]["regime"]
               for lb in (20, 252, 500)]
    assert regimes[0]["volSamples"] == rsp._RS_VOL_DIST_MAX
    assert regimes[0] == regimes[1] == regimes[2]


# ── #21: the threshold comment no longer cites a starter that does not exist ──

def test_21_the_green_on_red_threshold_cites_no_6_of_20_starter():
    src = pathlib.Path(rsp.__file__).read_text(encoding="utf-8")
    assert "(6 of 20)" not in src
    assert rsp._RS_GREEN_ON_RED_PASS == 6


# ── #22: below the floor, say what was measured ───────────────────────────────

def test_22_a_signal_under_the_floor_says_what_was_measured():
    art = fixture_artifact()
    line = ep.summary_line("rs_new_high_red_day", 63, art)
    # Pin moved 2026-11-07 (unit VA3): the requirement in plain words, not "(floor 100)".
    assert line == ("UCT measured 40 events on 12 sessions, too few to print a hit rate: it needs at least "
                    "100 events on at least 100 different sessions.")
    assert "has not measured" not in line
    assert "has not measured" not in ep.summary_line("mansfield_cross_up", 63, art)
    # no artifact, or no block for the signal: the honesty line stands
    assert ep.summary_line("rs_new_high_red_day", 63, {"version": 1}) == ep.HONESTY_SENTENCE
    assert ep.summary_line("nope", 63, art) == ep.HONESTY_SENTENCE


# ── #24: a known reason is the label, never the "needs more history" fallback ─

def test_24_weekly_and_same_symbol_put_the_reason_in_the_label(v2_row, monkeypatch):
    store = _long_daily()
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _counting_fetcher(store))
    _no_cache(monkeypatch)
    p = sig._rs_line_provider("NVDA", "W", {"benchmark": "SPY"})["payload"]
    assert p["regime"]["label"] == "daily charts only" and p["regime"]["reason"] is None
    assert p["checks"]["summary"] == "daily charts only"
    p = sig._rs_line_provider("SPY", "D", {"benchmark": "SPY"})["payload"]
    assert p["regime"]["label"] == "benchmark is the symbol"
    assert p["checks"]["summary"] == "benchmark is the symbol"
    # a daily chart that merely lacks history keeps the null label and its reason
    short = _long_daily(n=120)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", _counting_fetcher(short))
    p = sig._rs_line_provider("NVDA", "D", {"benchmark": "SPY"})["payload"]
    assert p["regime"]["label"] is None and "200-day" in p["regime"]["reason"]
