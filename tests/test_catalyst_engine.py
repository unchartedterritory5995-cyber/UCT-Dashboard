import os
import tempfile
from unittest.mock import patch

import pytest

from api.services.catalyst import engine, store


@pytest.fixture
def s(monkeypatch):
    # Bypass the open-market-days-only guard so these pipeline tests run
    # deterministically on any calendar day (incl. weekends/holidays).
    monkeypatch.setenv("CATALYST_IGNORE_MARKET_CALENDAR", "1")
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        store._init_db()
        yield


def _candidate(ticker, gap_pct=5.0, vol_x=2.0, tweets=None, rss=None,
               earnings_meta=None):
    return {
        "ticker": ticker,
        "company": ticker,
        "price": 50.0,
        "gap_pct": gap_pct,
        "vol_x": vol_x,
        "market_cap": 1_000_000_000,
        "sector": "Tech",
        "tweets": tweets or [],
        "rss": rss or [],
        "earnings_meta": earnings_meta,
        "earnings_reported_recently": bool(earnings_meta),
        "earnings_just_reported": bool(earnings_meta),
        "tweet_mention_count": len(tweets or []),
        "rss_headline_count": len(rss or []),
        "scanner_setup": None,
        "sector_momentum_count": 0,
    }


def test_run_refresh_writes_top_12_to_store(s):
    cands = (
        [_candidate(f"CAT{i}", gap_pct=10 + i,
                    tweets=[{"id": str(i), "text": "x", "author_handle": "h", "url": "u"},
                            {"id": str(i)+"b", "text": "y", "author_handle": "h", "url": "u"}])
         for i in range(10)]
        + [_candidate(f"ERN{i}", gap_pct=5 + i,
                      earnings_meta={"reported_recently": True, "eps_actual": 1.0, "eps_estimate": 0.9})
           for i in range(5)]
        + [_candidate(f"GAP{i}", gap_pct=15 + i, vol_x=5.0) for i in range(5)]
    )
    fake_thesis = {
        "thesis_text": "test thesis",
        "thesis_model": "claude-opus-4-7",
        "thesis_at": 1000,
        "thesis_sources": "[]",
        "signals_hash": "hash",
        "was_cached": False,
        "input_tokens": 100,
        "output_tokens": 50,
    }
    with patch("api.services.catalyst.engine.sources.collect_all",
               return_value=cands), \
         patch("api.services.catalyst.engine.synthesize.synthesize_ticker",
               return_value=fake_thesis):
        engine.run_refresh()

    rows = store.get_for_date(engine._today_market_date())
    assert len(rows) == 20
    tags = {r["tag"] for r in rows}
    assert "Catalyst" in tags
    assert "Earnings" in tags


def test_run_refresh_handles_empty_candidates(s):
    with patch("api.services.catalyst.engine.sources.collect_all",
               return_value=[]):
        engine.run_refresh()
    rows = store.get_for_date(engine._today_market_date())
    assert rows == []


def test_run_refresh_unranks_dropped_tickers(s):
    md = engine._today_market_date()
    store.upsert_catalyst({
        "market_date": md, "ticker": "OLD_STAR", "rank": 1,
        "score": 100.0, "tag": "Catalyst", "price": 100.0, "gap_pct": 10.0,
        "vol_x": 5.0, "market_cap": 1e9, "sector": "Tech",
        "thesis_text": "old", "thesis_model": "claude-opus-4-7",
        "thesis_at": 1, "thesis_sources": "[]", "signals_hash": "old",
        "catalyst_at": None, "raw_signals": "{}",
    })
    cands = [_candidate(f"NEW{i}", gap_pct=10 + i,
                        tweets=[{"id": str(i), "text": "x", "author_handle": "h", "url": "u"},
                                {"id": str(i)+"b", "text": "y", "author_handle": "h", "url": "u"}])
             for i in range(15)]
    fake_thesis = {
        "thesis_text": "test", "thesis_model": "claude-opus-4-7",
        "thesis_at": 2, "thesis_sources": "[]",
        "signals_hash": "new", "was_cached": False,
        "input_tokens": 100, "output_tokens": 50,
    }
    with patch("api.services.catalyst.engine.sources.collect_all",
               return_value=cands), \
         patch("api.services.catalyst.engine.synthesize.synthesize_ticker",
               return_value=fake_thesis):
        engine.run_refresh()

    old = store.get_ticker_for_date("OLD_STAR", md)
    assert old is not None
    assert old["rank"] is None


# ---- hunter cadence gating (2026-07-02) -------------------------------------

def test_run_refresh_hunt_gating(s, monkeypatch, tmp_path):
    """hunt=False never hunts; default hunts deep once/day; hunt=True forces a
    light follow-up after the deep sweep ran."""
    monkeypatch.setenv("CATALYST_DB_PATH", str(tmp_path / "catalysts.db"))
    from api.services.catalyst import sources
    calls = []

    def fake_collect(run_hunter=False, hunter_mode="deep", existing_tickers=None):
        calls.append({"run_hunter": run_hunter, "hunter_mode": hunter_mode,
                      "existing_tickers": existing_tickers})
        return []

    monkeypatch.setattr(sources, "collect_all", fake_collect)

    engine.run_refresh(hunt=False)
    assert calls[-1]["run_hunter"] is False

    engine.run_refresh()  # first auto tick of the day -> deep hunt
    assert calls[-1] == {"run_hunter": True, "hunter_mode": "deep",
                         "existing_tickers": None}

    engine.run_refresh()  # deep already ran -> auto ticks stop hunting
    assert calls[-1]["run_hunter"] is False

    engine.run_refresh(hunt=True)  # explicit hunt tick -> light sweep
    assert calls[-1]["run_hunter"] is True
    assert calls[-1]["hunter_mode"] == "light"


# ---- grade-C hiding big-move floor (2026-07-13) ------------------------------

def test_should_hide_grade_c_hides_flat_noise():
    """A quiet-tape grade-C row stays hidden — the original intent."""
    assert engine._should_hide_grade_c(True, "C", 1.2, 5.0) is True
    assert engine._should_hide_grade_c(True, "C", 0.0, 5.0) is True
    assert engine._should_hide_grade_c(True, "C", None, 5.0) is True


def test_should_hide_grade_c_never_hides_big_movers():
    """The 2026-07-13 semis-selloff regression: MRVL -9.5% / ALAB -13.9% were
    graded C ("sector-wide") and vanished from the board. A real move must
    survive the grader's mood."""
    assert engine._should_hide_grade_c(True, "C", -9.5, 5.0) is False
    assert engine._should_hide_grade_c(True, "C", -13.9, 5.0) is False
    assert engine._should_hide_grade_c(True, "C", 8.0, 5.0) is False


def test_should_hide_grade_c_respects_flag_and_grade():
    assert engine._should_hide_grade_c(False, "C", 0.0, 5.0) is False
    assert engine._should_hide_grade_c(True, "B", 0.0, 5.0) is False
    assert engine._should_hide_grade_c(True, None, 0.0, 5.0) is False


def test_hide_c_min_move_pct_env(monkeypatch):
    monkeypatch.delenv("CATALYST_HIDE_C_MIN_MOVE_PCT", raising=False)
    assert engine._hide_c_min_move_pct() == 5.0
    monkeypatch.setenv("CATALYST_HIDE_C_MIN_MOVE_PCT", "3.5")
    assert engine._hide_c_min_move_pct() == 3.5
    monkeypatch.setenv("CATALYST_HIDE_C_MIN_MOVE_PCT", "junk")
    assert engine._hide_c_min_move_pct() == 5.0
