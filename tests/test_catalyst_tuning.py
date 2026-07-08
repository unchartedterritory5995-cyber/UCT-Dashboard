# tests/test_catalyst_tuning.py
"""Tests for the evidence-based catalyst auto-tuning feature.

Each test isolates the SQLite catalysts DB + overrides JSON via tmp paths +
importlib.reload so module-level _DB_PATH / _OVERRIDES_PATH pick up the env.
"""
import importlib

import pytest


# ─────────────────────────────────────────────────────────────────────────
# TASK A — store enrichment + recent_feedback accessor
# ─────────────────────────────────────────────────────────────────────────

def _reload_store(monkeypatch, tmp_path):
    db = tmp_path / "catalysts.db"
    monkeypatch.setenv("CATALYST_DB_PATH", str(db))
    from api.services.catalyst import store as store_mod
    importlib.reload(store_mod)
    store_mod._init_db()
    return store_mod


def test_record_feedback_enriches_float_and_dollar_vol(monkeypatch, tmp_path):
    store = _reload_store(monkeypatch, tmp_path)
    monkeypatch.setattr(
        "api.services.catalyst.ticker_metadata.get_metadata",
        lambda ticker: {"float_shares": 12_000_000,
                        "shares_outstanding": 20_000_000,
                        "avg_volume_30d": 1_000_000},
    )
    store.record_feedback(
        user_id="u1", market_date="2026-06-15", ticker="junk",
        verdict="bad",
        row={"tag": "Gapper", "price": 4.0, "gap_pct": 8.0, "vol_x": 3.0},
    )
    rows = store.recent_feedback("bad", days=30)
    assert len(rows) == 1
    r = rows[0]
    assert r["ticker"] == "JUNK"
    assert r["float_shares"] == 12_000_000
    assert r["dollar_vol"] == 4.0 * 1_000_000
    importlib.reload(store)


def test_record_feedback_falls_back_to_shares_outstanding(monkeypatch, tmp_path):
    store = _reload_store(monkeypatch, tmp_path)
    monkeypatch.setattr(
        "api.services.catalyst.ticker_metadata.get_metadata",
        lambda ticker: {"float_shares": None,
                        "shares_outstanding": 7_000_000,
                        "avg_volume_30d": 500_000},
    )
    store.record_feedback(
        user_id="u1", market_date="2026-06-15", ticker="ABC",
        verdict="bad", row={"price": 10.0},
    )
    rows = store.recent_feedback("bad", days=30)
    assert rows[0]["float_shares"] == 7_000_000
    importlib.reload(store)


def test_recent_feedback_filters_by_verdict_and_window(monkeypatch, tmp_path):
    store = _reload_store(monkeypatch, tmp_path)
    monkeypatch.setattr(
        "api.services.catalyst.ticker_metadata.get_metadata",
        lambda ticker: {},
    )
    store.record_feedback(user_id="u", market_date="2026-06-15", ticker="GOOD",
                          verdict="good", row={"price": 50.0})
    store.record_feedback(user_id="u", market_date="2026-06-15", ticker="BAD",
                          verdict="bad", row={"price": 4.0})
    assert [r["ticker"] for r in store.recent_feedback("bad")] == ["BAD"]
    assert [r["ticker"] for r in store.recent_feedback("good")] == ["GOOD"]
    # A negative window puts the cutoff in the future -> nothing in range.
    assert store.recent_feedback("bad", days=-1) == []
    importlib.reload(store)


# ─────────────────────────────────────────────────────────────────────────
# TASK B — tuning engine
# ─────────────────────────────────────────────────────────────────────────

def _setup_tuning(monkeypatch, tmp_path):
    """Isolate the catalysts DB + overrides path, reload store + tuning."""
    db = tmp_path / "catalysts.db"
    ovr = tmp_path / "overrides.json"
    monkeypatch.setenv("CATALYST_DB_PATH", str(db))
    monkeypatch.setenv("CATALYST_TUNING_OVERRIDES_PATH", str(ovr))
    # Ensure no stale env knobs leak in from the shell.
    for k in ("CATALYST_MIN_PRICE", "CATALYST_MIN_DOLLAR_VOL",
              "CATALYST_MIN_FLOAT", "CATALYST_MIN_MARKET_CAP"):
        monkeypatch.delenv(k, raising=False)
    from api.services.catalyst import store as store_mod
    importlib.reload(store_mod)
    store_mod._init_db()
    from api.services.catalyst import tuning as tuning_mod
    importlib.reload(tuning_mod)
    return store_mod, tuning_mod


def _no_metadata(monkeypatch):
    monkeypatch.setattr(
        "api.services.catalyst.ticker_metadata.get_metadata",
        lambda ticker: {},
    )


def test_percentile_nearest_rank():
    from api.services.catalyst import tuning
    vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    assert tuning.percentile(vals, 75) == 8
    assert tuning.percentile([3.5], 75) == 3.5
    assert tuning.percentile([], 75) == 0.0


def test_get_threshold_precedence(monkeypatch, tmp_path):
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    # default when nothing set
    assert tuning.get_threshold("CATALYST_MIN_PRICE", 3.0) == 3.0
    # override beats default (within bounds)
    tuning._write_overrides({"CATALYST_MIN_PRICE": 4.5})
    assert tuning.get_threshold("CATALYST_MIN_PRICE", 3.0) == 4.5
    # env beats override
    monkeypatch.setenv("CATALYST_MIN_PRICE", "6.0")
    assert tuning.get_threshold("CATALYST_MIN_PRICE", 3.0) == 6.0


def test_get_threshold_clamps_override_to_bounds(monkeypatch, tmp_path):
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    tuning._write_overrides({"CATALYST_MIN_PRICE": 999.0})  # above hi=5.0
    assert tuning.get_threshold("CATALYST_MIN_PRICE", 3.0) == 5.0
    tuning._write_overrides({"CATALYST_MIN_PRICE": 0.5})  # below lo=2.0
    assert tuning.get_threshold("CATALYST_MIN_PRICE", 3.0) == 2.0


def test_knob_ceilings_stay_near_defaults():
    """The hi bounds are the last line of defense against the tighten-runaway
    (2026-07-08: cap walked 300M -> 1B and the board shrank to 5 rows). Keep
    every ceiling within ~2x of its default."""
    from api.services.catalyst import tuning
    for knob, (default, lo, hi) in tuning.KNOBS.items():
        assert hi <= default * 2, f"{knob} ceiling {hi} > 2x default {default}"
        assert lo <= default <= hi


def _seed_bad(store, n, price):
    for i in range(n):
        store.record_feedback(user_id="u", market_date="2026-06-15",
                              ticker=f"B{i}", verdict="bad",
                              row={"price": price})


def test_autotune_tightens_min_price(monkeypatch, tmp_path):
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    _no_metadata(monkeypatch)
    monkeypatch.setattr(tuning, "_loosen_hits", lambda: {})
    _seed_bad(store, 12, 3.5)  # all bad rows at $3.50, no good rows
    res = tuning.run_autotune()
    assert res["enabled"] is True
    moved = tuning.get_threshold("CATALYST_MIN_PRICE", 3.0)
    assert moved > 3.0                      # tightened UP
    assert moved <= 3.0 * 1.15 + 1e-9       # bounded to one 15% step
    assert moved <= 8.0                      # within bound


def test_autotune_min_samples_noop(monkeypatch, tmp_path):
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    _no_metadata(monkeypatch)
    monkeypatch.setattr(tuning, "_loosen_hits", lambda: {})
    _seed_bad(store, 5, 3.5)  # < MIN_SAMPLES (10)
    res = tuning.run_autotune()
    assert res["changes"] == []
    assert tuning.get_threshold("CATALYST_MIN_PRICE", 3.0) == 3.0


def test_autotune_good_feedback_floor(monkeypatch, tmp_path):
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    _no_metadata(monkeypatch)
    monkeypatch.setattr(tuning, "_loosen_hits", lambda: {})
    _seed_bad(store, 12, 5.0)  # bad cluster at $5 -> p75 = 5
    # one good row at 3.2 caps the tighten target at 3.2
    store.record_feedback(user_id="u", market_date="2026-06-15", ticker="GOOD",
                          verdict="good", row={"price": 3.2})
    tuning.run_autotune()
    moved = tuning.get_threshold("CATALYST_MIN_PRICE", 3.0)
    assert moved <= 3.2 + 1e-9
    assert moved > 3.0  # still tightened toward the 3.2 cap


def test_autotune_loosen_beats_tighten(monkeypatch, tmp_path):
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    _no_metadata(monkeypatch)
    # Both a tighten signal (12 bad @ 5.0) AND a loosen signal exist.
    _seed_bad(store, 12, 5.0)
    monkeypatch.setattr(
        tuning, "_loosen_hits",
        lambda: {"CATALYST_MIN_PRICE": 5},  # >= LOOSEN_MIN_HITS
    )
    tuning.run_autotune()
    moved = tuning.get_threshold("CATALYST_MIN_PRICE", 3.0)
    assert moved < 3.0                       # moved DOWN (loosen won)
    assert moved >= 3.0 * (1 - 0.15) - 1e-9  # one step
    assert moved >= 2.0                       # within lo bound


def test_autotune_loosen_via_coverage_audit(monkeypatch, tmp_path):
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    _no_metadata(monkeypatch)
    # No tighten signal; loosen comes from a coverage report's excluded bucket.
    report = {"buckets": {"excluded": [
        {"ticker": "AAA", "gap_pct": 12, "reason": "price $2.10 below $3 floor"},
        {"ticker": "BBB", "gap_pct": 14, "reason": "price $2.50 below $3 floor"},
        {"ticker": "CCC", "gap_pct": 9, "reason": "price $1.90 below $3 floor"},
    ]}}
    monkeypatch.setattr(
        "api.services.catalyst.coverage_audit.get_audit",
        lambda d: report,
    )
    tuning.run_autotune()
    moved = tuning.get_threshold("CATALYST_MIN_PRICE", 3.0)
    assert moved < 3.0  # loosened down


def test_autotune_bounded_step_and_clamp(monkeypatch, tmp_path):
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    _no_metadata(monkeypatch)
    monkeypatch.setattr(tuning, "_loosen_hits", lambda: {})
    # Huge bad cluster way above current — step must be bounded to 15%.
    _seed_bad(store, 12, 50.0)
    tuning.run_autotune()
    moved = tuning.get_threshold("CATALYST_MIN_PRICE", 3.0)
    assert abs(moved - 3.0 * 1.15) < 1e-6


def test_revert_clear_wipes_overrides(monkeypatch, tmp_path):
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    tuning._write_overrides({"CATALYST_MIN_PRICE": 4.0})
    out = tuning.revert(clear=True)
    assert out["cleared"] is True
    assert tuning.get_threshold("CATALYST_MIN_PRICE", 3.0) == 3.0


def test_revert_restores_prior_value(monkeypatch, tmp_path):
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    _no_metadata(monkeypatch)
    monkeypatch.setattr(tuning, "_loosen_hits", lambda: {})
    _seed_bad(store, 12, 3.5)
    tuning.run_autotune()
    after_tune = tuning.get_threshold("CATALYST_MIN_PRICE", 3.0)
    assert after_tune > 3.0
    tuning.revert(clear=False)
    # restored to the old_value logged at tune time (3.0)
    assert tuning.get_threshold("CATALYST_MIN_PRICE", 3.0) == 3.0


def test_autotune_disabled(monkeypatch, tmp_path):
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    monkeypatch.setenv("CATALYST_AUTOTUNE_ENABLED", "0")
    res = tuning.run_autotune()
    assert res == {"enabled": False, "changes": []}


# ─────────────────────────────────────────────────────────────────────────
# New-evidence brake — the same static 👎 pool must not compound nightly
# ─────────────────────────────────────────────────────────────────────────

def test_autotune_does_not_compound_on_stale_feedback(monkeypatch, tmp_path):
    """Second run with NO new feedback since the first tighten must be a
    no-op — this is the brake that stops the 15%/night runaway."""
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    _no_metadata(monkeypatch)
    monkeypatch.setattr(tuning, "_loosen_hits", lambda: {})
    _seed_bad(store, 12, 5.0)
    tuning.run_autotune()
    first = tuning.get_threshold("CATALYST_MIN_PRICE", 3.0)
    assert first > 3.0
    res2 = tuning.run_autotune()  # same pool, nothing new
    assert res2["changes"] == []
    assert tuning.get_threshold("CATALYST_MIN_PRICE", 3.0) == first


def test_autotune_resumes_on_fresh_feedback(monkeypatch, tmp_path):
    """New 👎 rows arriving after the last change re-arm the tighten."""
    store, tuning = _setup_tuning(monkeypatch, tmp_path)
    _no_metadata(monkeypatch)
    monkeypatch.setattr(tuning, "_loosen_hits", lambda: {})
    _seed_bad(store, 12, 5.0)
    tuning.run_autotune()
    first = tuning.get_threshold("CATALYST_MIN_PRICE", 3.0)
    # Fresh evidence: 3 new bad rows (>= CATALYST_AUTOTUNE_MIN_NEW_BAD default)
    # stamped strictly after the logged change.
    import time as _time
    _time.sleep(1.1)  # created_at is epoch-seconds; get past the change ts
    for i in range(3):
        store.record_feedback(user_id="u", market_date="2026-06-16",
                              ticker=f"N{i}", verdict="bad",
                              row={"price": 5.0})
    res2 = tuning.run_autotune()
    assert res2["changes"], "fresh feedback should re-arm the tighten"
    assert tuning.get_threshold("CATALYST_MIN_PRICE", 3.0) > first


def test_coverage_audit_excluded_falls_back_to_rejections(monkeypatch, tmp_path):
    """A gate-dropped mover must classify as 'excluded' (feeding the loosen
    signal) even when the in-memory exclusion cache is empty — e.g. after a
    redeploy — by falling back to the persistent rejections table."""
    store = _reload_store(monkeypatch, tmp_path)
    store.log_rejection(market_date="2026-07-08", ticker="UAN",
                        reason="liquidity $4.5M/day below $9M floor",
                        price=117.0, dollar_vol=4_500_000)
    from api.services.catalyst import coverage_audit
    importlib.reload(coverage_audit)
    monkeypatch.setattr(coverage_audit, "_biggest_movers",
                        lambda *a, **k: [{"ticker": "UAN", "gap_pct": 8.0,
                                          "dollar_vol": 4_500_000}])
    monkeypatch.setattr(coverage_audit, "_grade_analyst_coverage",
                        lambda d: {"total": 0, "caught": 0, "missed": []})
    # In-memory exclusion cache empty (fresh process) — the old behavior
    # classified UAN as "missed"; the fallback must classify it "excluded".
    monkeypatch.setattr("api.services.catalyst.engine.get_exclusion_reason",
                        lambda d, s: None)
    report = coverage_audit.run_audit("2026-07-08")
    assert report["counts"]["excluded"] == 1
    assert report["counts"]["missed"] == 0
    assert report["buckets"]["excluded"][0]["reason"].startswith("liquidity")
