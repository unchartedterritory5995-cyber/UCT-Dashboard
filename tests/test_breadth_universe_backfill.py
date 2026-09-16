"""The PIT backfill loop: disarmed by default, floor-clamped, resumable.

⛔ The rail that matters most here is that a NORMAL backfill job cannot reach an
exchange universe below its approved start. Two layers are tested: the planner
never ASKS for a pre-floor chunk, and `sweep_history` refuses one anyway.
"""
import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_history_recon as recon
from api.services import breadth_universes as bu


@pytest.fixture()
def fresh_store(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "ohlc.db"))
    monkeypatch.delenv("BREADTH_UNIVERSE_BACKFILL_ENABLED", raising=False)
    store._INIT_DONE = False
    store._ensure_init()
    yield
    store._INIT_DONE = False


# ── armed / disarmed ─────────────────────────────────────────────────────────

def test_it_ships_dark(fresh_store, monkeypatch):
    assert recon.universe_backfill_enabled() is False
    out = recon.universe_backfill_tick("us")
    assert out["ok"] is False and out["disarmed"] is True
    monkeypatch.setenv("BREADTH_UNIVERSE_BACKFILL_ENABLED", "1")
    assert recon.universe_backfill_enabled() is True


def test_a_disarmed_tick_does_no_work_at_all(fresh_store, monkeypatch):
    def _boom(*a, **k):
        raise AssertionError("a disarmed tick must not sweep")
    monkeypatch.setattr(recon, "sweep_history", _boom)
    recon.universe_backfill_tick("us")          # must not raise


# ── the floor ────────────────────────────────────────────────────────────────

def test_the_planner_never_asks_below_an_exchange_floor(fresh_store):
    for uni in ("nasdaq", "nyse"):
        plan = recon.universe_backfill_plan(uni, target_floor="2008-01-02")
        assert plan["floor"] == "2011-01-01", uni
        assert plan["from"] >= "2011-01-01", uni
        assert plan["clamped"] is True


def test_a_target_floor_can_raise_but_never_lower_the_approved_start(fresh_store):
    raised = recon.universe_backfill_plan("us", target_floor="2015-01-01")
    assert raised["floor"] == "2015-01-01"      # asking for LESS history is fine
    lowered = recon.universe_backfill_plan("us", target_floor="1999-01-01")
    assert lowered["floor"] == "2008-01-02"     # asking for more is clamped


def test_the_sweep_refuses_a_pre_floor_chunk_even_if_the_planner_is_bypassed(monkeypatch):
    # ⛔ The second layer. A caller that skips the planner is a bug, not a case to
    # accommodate.
    monkeypatch.setattr("api.services.breadth_pit_frame.build_frame",
                        lambda *a, **k: (_ for _ in ()).throw(
                            AssertionError("must not reach the frame builder")))
    with pytest.raises(bu.BelowHistoryFloor):
        recon.sweep_history("2009-06-01", "2009-12-31", universe="nasdaq")


def test_uct_is_refused_outright(fresh_store):
    out = recon.universe_backfill_plan("uct")
    assert out["blocked"] is True and "not a PIT universe" in out["reason"]


# ── resume ───────────────────────────────────────────────────────────────────

def test_the_next_chunk_is_read_from_the_STORE_so_a_restart_resumes(fresh_store):
    # Nothing stored yet → the first chunk ends today.
    first = recon.universe_backfill_plan("us", chunk_days=365)
    assert first["blocked"] is False and first["coverage_first"] is None

    # Pretend a chunk landed. The next plan starts strictly below it.
    store.write_bulk([("2015-06-01", "pct_above_50sma", 1, 1, 1, 47.2)], universe="us")
    nxt = recon.universe_backfill_plan("us", chunk_days=365)
    assert nxt["coverage_first"] == "2015-06-01"
    assert nxt["to"] == "2015-05-31"
    assert nxt["from"] == "2014-06-01"

    # ⭐ No progress file: coverage IS the progress, so it cannot disagree with the
    # data it describes.


def test_it_reports_complete_once_coverage_reaches_the_floor(fresh_store):
    store.write_bulk([("2011-01-03", "pct_above_50sma", 1, 1, 1, 50.0)], universe="nasdaq")
    plan = recon.universe_backfill_plan("nasdaq")
    assert plan["blocked"] is True and plan["complete"] is True

    store.write_bulk([("2008-01-02", "pct_above_50sma", 1, 1, 1, 50.0)], universe="us")
    assert recon.universe_backfill_plan("us")["complete"] is True


def test_one_universe_coverage_does_not_end_another_universes_grind(fresh_store):
    # ⛔ `stats()` is universe-scoped for exactly this reason.
    store.write_bulk([("2008-01-02", "pct_above_50sma", 1, 1, 1, 19.9)], universe="us")
    assert recon.universe_backfill_plan("us")["complete"] is True
    assert recon.universe_backfill_plan("nasdaq")["blocked"] is False
    # and UCT's own published coverage is untouched by either
    assert store.stats()["rows"] == 0


def test_a_chunk_that_produces_no_sessions_ENDS_the_grind(fresh_store, monkeypatch):
    """⛔ Coverage is the progress marker, so a window yielding nothing would be
    re-planned identically forever. The tick must report exhaustion instead."""
    monkeypatch.setenv("BREADTH_UNIVERSE_BACKFILL_ENABLED", "1")
    calls = []

    def _empty_sweep(frm, to, **k):
        calls.append((frm, to))
        return {"ok": True, "sessions": 0, "rows": 0}

    monkeypatch.setattr(recon, "sweep_history", _empty_sweep)
    out = recon.universe_backfill_tick("us", chunk_days=30)
    assert len(calls) == 1
    assert out["blocked"] is True and out["exhausted"] is True


def test_a_productive_chunk_does_not_report_exhaustion(fresh_store, monkeypatch):
    monkeypatch.setenv("BREADTH_UNIVERSE_BACKFILL_ENABLED", "1")
    monkeypatch.setattr(recon, "sweep_history",
                        lambda frm, to, **k: {"ok": True, "sessions": 21, "rows": 880})
    out = recon.universe_backfill_tick("us", chunk_days=30)
    assert not out.get("exhausted")
    assert out["result"]["rows"] == 880
