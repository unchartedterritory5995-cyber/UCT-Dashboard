"""Tests for the provider-coverage monitor (Task 22, 2026-08-05 data-
dependability migration). Mirrors the test shape of test_fundamentals_monitor.py.
"""
import importlib

import pytest


def _mod():
    import api.services.provider_coverage_monitor as pcm
    importlib.reload(pcm)
    return pcm


def _isolate_db(monkeypatch, pcm, tmp_path):
    """Every history/baseline test gets its own throwaway SQLite file so
    tests never see each other's rows and never touch the real DATA_DIR."""
    monkeypatch.setattr(pcm, "DB_PATH", str(tmp_path / "coverage_test.db"))


# ── _evaluate_field — the pure classification surface ─────────────────────────
def test_blank_field_is_always_a_defect():
    # sample>0 but observed==0.0 -- the exact class that hid two Finnhub
    # endpoints returning 403-on-every-call for months.
    pcm = _mod()
    d = pcm._evaluate_field("enrichment_with_em", 0.0, 500, baseline=None, provider_moved=False)
    assert d is not None
    assert d["kind"] == "blank"
    assert d["field"] == "enrichment_with_em"
    assert d["sample"] == 500


def test_floor_breach_detected():
    pcm = _mod()
    d = pcm._evaluate_field("ticker_name", 0.80, 25, baseline=None, provider_moved=False)
    assert d is not None and d["kind"] == "floor_breach" and d["floor"] == 0.95


def test_at_or_above_floor_is_not_a_defect():
    pcm = _mod()
    assert pcm._evaluate_field("ticker_name", 0.95, 25, baseline=None, provider_moved=False) is None
    assert pcm._evaluate_field("ticker_name", 0.99, 25, baseline=None, provider_moved=False) is None


def test_empty_sample_yields_none_not_a_defect():
    # Number(null) === 0 class: an unmeasured field must never register as a
    # 0% reading (which would itself masquerade as a "blank" defect).
    pcm = _mod()
    assert pcm._evaluate_field("price_target", None, 0, baseline=0.9, provider_moved=False) is None
    assert pcm._evaluate_field("price_target", 0.0, 0, baseline=0.9, provider_moved=False) is None


def test_legitimately_sparse_field_at_its_floor_is_not_a_defect():
    # calendar_hour_resolved floors at 60% because a real slice of past
    # reporters carry no session from the provider at all -- a field that sits
    # just above there FOREVER must never trip an alert on its own.
    # (This used analyst_actions until 2026-08-09; that field no longer grades
    # a sparse market fact -- see test_provider_coverage_analyst_reachability.)
    pcm = _mod()
    assert pcm._evaluate_field("calendar_hour_resolved", 0.62, 490, baseline=0.61,
                               provider_moved=False) is None


def test_sharp_drop_detected_even_with_no_absolute_floor():
    pcm = _mod()
    # enrichment_with_em has floor=None -- ONLY the drop detector can catch
    # this (95% -> 10% against its own history).
    d = pcm._evaluate_field("enrichment_with_em", 0.10, 500, baseline=0.95, provider_moved=False)
    assert d is not None and d["kind"] == "drop"


def test_steady_field_is_never_flagged_as_a_drop():
    # "a field that is always 40% is not [a signal]" -- the orchestrator's
    # exact framing for the requirement this test proves.
    pcm = _mod()
    assert pcm._evaluate_field("enrichment_with_em", 0.38, 500, baseline=0.40, provider_moved=False) is None
    assert pcm._evaluate_field("enrichment_with_em", 0.40, 500, baseline=0.40, provider_moved=False) is None


def test_provider_throttled_tag_when_denial_counter_moved():
    pcm = _mod()
    d = pcm._evaluate_field("price_target", 0.10, 25, baseline=0.9, provider_moved=True)
    assert d["provider"] == "provider_throttled"


def test_data_missing_tag_when_denial_counter_did_not_move():
    pcm = _mod()
    d = pcm._evaluate_field("price_target", 0.10, 25, baseline=0.9, provider_moved=False)
    assert d["provider"] == "data_missing"


# ── _denial_moved ────────────────────────────────────────────────────────────
def test_denial_moved_detects_increase():
    pcm = _mod()
    assert pcm._denial_moved({"finnhub": 5}, {"finnhub": 9}) == {"finnhub"}


def test_denial_moved_empty_when_unchanged():
    pcm = _mod()
    assert pcm._denial_moved({"finnhub": 5}, {"finnhub": 5}) == set()


def test_denial_moved_ignores_none_counters():
    pcm = _mod()
    assert pcm._denial_moved({"alphavantage": None}, {"alphavantage": None}) == set()


# ── history / baseline persistence (real sqlite, isolated tmp db) ─────────────
def test_baseline_uses_median_of_recent_readings(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    for v in (0.9, 0.92, 0.88, 0.5):  # one outlier must not dominate a median
        pcm._record_history("price_target", v, 25, pcm._now_iso())
    baseline = pcm._recent_baseline("price_target")
    assert baseline == pytest.approx(0.89)


def test_baseline_none_when_no_history(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    assert pcm._recent_baseline("price_target") is None


def test_baseline_ignores_null_observed_rows(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    pcm._record_history("price_target", None, 0, pcm._now_iso())
    pcm._record_history("price_target", 0.8, 10, pcm._now_iso())
    assert pcm._recent_baseline("price_target") == pytest.approx(0.8)


def test_history_write_and_prune_do_not_raise(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    pcm._record_history("consensus", 0.9, 10, pcm._now_iso())
    pcm._prune_history()  # must not raise even with a fresh/near-empty db


# ── warm-biased sampling ────────────────────────────────────────────────────────
def test_sample_prefers_warm_and_bounds_cold_tail(monkeypatch):
    pcm = _mod()
    monkeypatch.setattr(pcm, "_COLD_TAIL", 2)
    from api.services.cache import cache as real_cache
    monkeypatch.setattr(
        real_cache, "keys_with_prefix",
        lambda p: ["earnings_intel_WARMA", "earnings_intel_WARMB", "earnings_intel_WARMC"],
    )
    monkeypatch.setattr(pcm, "_load_universe", lambda: ["COLD1", "COLD2", "COLD3", "COLD4", "COLD5"])
    out = pcm._sample_tickers(12)
    assert len(out) == len(set(out))                     # deduped
    assert all(s == s.upper() for s in out)
    cold = [s for s in out if s.startswith("COLD")]
    assert len(cold) <= 2                                 # cold tail bounded
    warm = [s for s in out if s.startswith("WARM")]
    assert warm                                           # warm entries included


# ── self-heal: cache invalidation only, never a re-fetch ───────────────────────
def test_heal_intel_invalidates_exact_keys(monkeypatch):
    pcm = _mod()
    invalidated = []
    from api.services.cache import cache as real_cache
    monkeypatch.setattr(real_cache, "invalidate", lambda k: invalidated.append(k))
    pcm._heal_intel(["AAPL", "MSFT"])
    assert invalidated == ["earnings_intel_AAPL", "earnings_intel_MSFT"]


def test_heal_meta_invalidates_exact_keys(monkeypatch):
    pcm = _mod()
    invalidated = []
    from api.services.cache import cache as real_cache
    monkeypatch.setattr(real_cache, "invalidate", lambda k: invalidated.append(k))
    pcm._heal_meta(["AAPL"])
    assert invalidated == ["tmeta_AAPL"]


# ── run_cycle — end-to-end wiring with every measurer stubbed ──────────────────
def _stub_measurers(monkeypatch, pcm, *, price_target_obs=0.9, price_target_n=20,
                     analyst_obs=1.0, analyst_n=8, moved=None):
    # analyst_obs default is 1.0, not the old 0.5: the field measures whether
    # the grades PROVIDERS answer, so healthy is ~1.0. It used to measure how
    # many megacaps were re-rated in ~2 days, where 0.5 was aspirational
    # fiction (live: 0/8, all providers healthy) -- see
    # tests/test_provider_coverage_analyst_reachability.py.
    monkeypatch.setattr(pcm, "_sample_tickers", lambda n: ["AAPL", "NVDA"])
    monkeypatch.setattr(
        pcm, "_intel_map",
        lambda syms: {
            s: ({"price_target": {"x": 1}, "consensus": {"buy": 1}, "beat_history": [1, 2, 3, 4]}
                if i < round(price_target_obs * len(syms)) else {"price_target": None, "consensus": None, "beat_history": []})
            for i, s in enumerate(syms)
        } if price_target_n else {},
    )
    monkeypatch.setattr(pcm, "_meta_map", lambda syms: {s: {"name": "X", "industry": "Y"} for s in syms})
    monkeypatch.setattr(pcm, "_transcript_rate", lambda syms: {"observed": None, "sample": 0, "missing": []})
    monkeypatch.setattr(pcm, "_analyst_actions_rate",
                        lambda syms: {"observed": analyst_obs, "sample": analyst_n, "missing": []})
    monkeypatch.setattr(pcm, "_calendar_hour_rate", lambda: {"observed": 0.7, "sample": 100})
    monkeypatch.setattr(pcm, "_enrichment_with_em_rate", lambda: {"observed": 0.6, "sample": 200})
    monkeypatch.setattr(pcm, "_implied_fiscal_rate", lambda: {"observed": None, "sample": 0})
    monkeypatch.setattr(pcm, "_day_metrics_rate", lambda field: {"observed": 0.8, "sample": 50})
    monkeypatch.setattr(pcm, "_denial_snapshot", lambda: {"finnhub": 0, "alphavantage": None})
    if moved:
        calls = iter([{"finnhub": 0, "alphavantage": None}, {"finnhub": 10, "alphavantage": None}])
        monkeypatch.setattr(pcm, "_denial_snapshot", lambda: next(calls))


def test_run_cycle_no_defects_when_everything_healthy(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    _stub_measurers(monkeypatch, pcm, price_target_obs=1.0)
    out = pcm.run_cycle()
    assert out["defects"] == 0
    assert pcm.get_state()["defects_current"] == []


def test_run_cycle_flags_a_field_that_goes_to_zero(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    monkeypatch.setattr(pcm, "_sample_tickers", lambda n: ["AAPL", "NVDA"])
    monkeypatch.setattr(pcm, "_intel_map", lambda syms: {s: None for s in syms})  # every leg empty
    monkeypatch.setattr(pcm, "_meta_map", lambda syms: {s: {"name": "X", "industry": "Y"} for s in syms})
    monkeypatch.setattr(pcm, "_transcript_rate", lambda syms: {"observed": None, "sample": 0, "missing": []})
    monkeypatch.setattr(pcm, "_analyst_actions_rate",
                        lambda syms: {"observed": 1.0, "sample": 8, "missing": []})
    monkeypatch.setattr(pcm, "_calendar_hour_rate", lambda: {"observed": 0.7, "sample": 100})
    monkeypatch.setattr(pcm, "_enrichment_with_em_rate", lambda: {"observed": 0.6, "sample": 200})
    monkeypatch.setattr(pcm, "_implied_fiscal_rate", lambda: {"observed": None, "sample": 0})
    monkeypatch.setattr(pcm, "_day_metrics_rate", lambda field: {"observed": 0.8, "sample": 50})
    monkeypatch.setattr(pcm, "_denial_snapshot", lambda: {"finnhub": 0, "alphavantage": None})
    out = pcm.run_cycle()
    fields_flagged = {d["field"] for d in pcm.get_state()["defects_current"]}
    assert {"price_target", "consensus", "beat_history"} <= fields_flagged
    kinds = {d["field"]: d["kind"] for d in pcm.get_state()["defects_current"]}
    assert kinds["price_target"] == "blank"


def test_legitimately_sparse_field_never_flags(tmp_path, monkeypatch):
    """The orchestrator's explicit demonstration ask: a legitimately-sparse
    field must NOT alert. calendar_hour_resolved sitting a little above its
    60% floor is the standing example -- a genuine provider gap in how many
    past reporters carry a BMO/AMC session, not a regression."""
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    _stub_measurers(monkeypatch, pcm, price_target_obs=1.0)
    monkeypatch.setattr(pcm, "_calendar_hour_rate", lambda: {"observed": 0.62, "sample": 490})
    pcm.run_cycle()
    fields_flagged = {d["field"] for d in pcm.get_state()["defects_current"]}
    assert "calendar_hour_resolved" not in fields_flagged


def test_run_cycle_tags_provider_throttled_when_denial_counter_moves(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    monkeypatch.setattr(pcm, "_sample_tickers", lambda n: ["AAPL", "NVDA"])
    monkeypatch.setattr(pcm, "_intel_map", lambda syms: {s: None for s in syms})
    monkeypatch.setattr(pcm, "_meta_map", lambda syms: {s: {"name": "X", "industry": "Y"} for s in syms})
    monkeypatch.setattr(pcm, "_transcript_rate", lambda syms: {"observed": None, "sample": 0, "missing": []})
    monkeypatch.setattr(pcm, "_analyst_actions_rate",
                        lambda syms: {"observed": 0.5, "sample": 8, "missing": []})
    monkeypatch.setattr(pcm, "_calendar_hour_rate", lambda: {"observed": 0.7, "sample": 100})
    monkeypatch.setattr(pcm, "_enrichment_with_em_rate", lambda: {"observed": 0.6, "sample": 200})
    monkeypatch.setattr(pcm, "_implied_fiscal_rate", lambda: {"observed": None, "sample": 0})
    monkeypatch.setattr(pcm, "_day_metrics_rate", lambda field: {"observed": 0.8, "sample": 50})
    calls = iter([{"finnhub": 3, "alphavantage": None}, {"finnhub": 9, "alphavantage": None}])
    monkeypatch.setattr(pcm, "_denial_snapshot", lambda: next(calls))
    pcm.run_cycle()
    by_field = {d["field"]: d for d in pcm.get_state()["defects_current"]}
    assert by_field["price_target"]["provider"] == "provider_throttled"


def test_run_cycle_self_heals_missing_cache_backed_tickers(tmp_path, monkeypatch):
    pcm = _mod()
    _isolate_db(monkeypatch, pcm, tmp_path)
    invalidated = []
    from api.services.cache import cache as real_cache
    monkeypatch.setattr(real_cache, "invalidate", lambda k: invalidated.append(k))
    monkeypatch.setattr(pcm, "_sample_tickers", lambda n: ["AAPL", "NVDA"])
    monkeypatch.setattr(pcm, "_intel_map", lambda syms: {s: None for s in syms})
    monkeypatch.setattr(pcm, "_meta_map", lambda syms: {s: {"name": "X", "industry": "Y"} for s in syms})
    monkeypatch.setattr(pcm, "_transcript_rate", lambda syms: {"observed": None, "sample": 0, "missing": []})
    monkeypatch.setattr(pcm, "_analyst_actions_rate",
                        lambda syms: {"observed": 0.5, "sample": 8, "missing": []})
    monkeypatch.setattr(pcm, "_calendar_hour_rate", lambda: {"observed": 0.7, "sample": 100})
    monkeypatch.setattr(pcm, "_enrichment_with_em_rate", lambda: {"observed": 0.6, "sample": 200})
    monkeypatch.setattr(pcm, "_implied_fiscal_rate", lambda: {"observed": None, "sample": 0})
    monkeypatch.setattr(pcm, "_day_metrics_rate", lambda field: {"observed": 0.8, "sample": 50})
    monkeypatch.setattr(pcm, "_denial_snapshot", lambda: {"finnhub": 0, "alphavantage": None})
    pcm.run_cycle()
    assert "earnings_intel_AAPL" in invalidated
    assert "earnings_intel_NVDA" in invalidated


def test_get_state_shape():
    pcm = _mod()
    st = pcm.get_state()
    for k in ("enabled", "cycles_completed", "fields", "defects_current", "last_cycle_at"):
        assert k in st


# ── mutation control ────────────────────────────────────────────────────────
# Proves the "at or above floor produces none" test above is actually
# exercising the floor comparison and not vacuously passing: raising the
# floor above the stubbed observed value must flip the result to a defect.
def test_mutation_control_raising_floor_creates_a_defect(monkeypatch):
    pcm = _mod()
    assert pcm._evaluate_field("ticker_name", 0.95, 25, baseline=None, provider_moved=False) is None
    monkeypatch.setitem(pcm._FIELD_SPECS["ticker_name"], "floor", 0.999)
    d = pcm._evaluate_field("ticker_name", 0.95, 25, baseline=None, provider_moved=False)
    assert d is not None and d["kind"] == "floor_breach"
