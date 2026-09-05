"""Phase 8, Package 8G-B — PEG-only admin/pilot canonical scanner authority.

Tests `pattern_join.apply_canonical_pilot_overlay`, the additive-only overlay
wired into the REAL served path (`query.run_scan`'s `out_rows`, right after
it reads `screener_rows`). Same `PATTERN_DB_PATH`-per-test-tmp-file idiom as
the sibling Wave-5 pattern_join test files.
"""
import time

import pytest

_NOW = int(time.time())


def _fresh(monkeypatch, tmp_path):
    db = tmp_path / "patterns.db"
    monkeypatch.setenv("PATTERN_DB_PATH", str(db))
    monkeypatch.setenv("PATTERN_CANONICAL_SCANNER_PILOT_ENABLED", "1")
    return db


def _detection(**overrides):
    base = {
        "id": "det-1",
        "sym": "CRM", "tf": "D",
        "pattern_id": "power_earnings_gap", "category": "uct", "direction": "bullish",
        "start_t": 1700000000, "end_t": 1700100000,
        "geometry": {"shape": "candle_mark", "anchors": [], "extras": {
            "gap_pct": 12.0, "gap_volume_ratio": 3.5, "post_gap_bars": 4,
            "gap_open": 105.0, "post_gap_low": 101.0,
            "post_gap_range_pct": 2.0, "gap_range_pct": 8.0,
            "days_to_earnings": -1, "earnings_linkage_verified": True,
        }},
        "levels": {"entry": 100.0, "entry_condition": "", "stop": 95.0,
                   "stop_basis": "", "target_primary": 110.0,
                   "target_secondary": None, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up",
                    "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "unknown",
                    "nearest_resistance": 110.0, "nearest_support": 95.0,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 90.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 75.0,
                               "context_score": 70.0, "historical_score": 50.0},
        "narrative": {"headline": "test headline", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready",
        "detected_at": _NOW, "last_seen_at": _NOW,
    }
    base.update(overrides)
    return base


def _row(ticker, ids_csv):
    """A minimal `screener_rows`-shaped row dict, exactly as `query.run_scan`
    would hand to the overlay -- MATCH_SEP-wrapped `pattern_engine_ids`."""
    from api.services.screener.pattern_join import MATCH_SEP
    return {"ticker": ticker, "pattern_engine_ids": MATCH_SEP + ids_csv + MATCH_SEP,
            "pattern_engine_conf": 100.0, "pattern_engine_dir": 1}


ADMIN = {"id": "u-admin", "role": "admin"}
ORDINARY = {"id": "u-member", "role": "member"}


def test_admin_plus_peg_gets_canonical_overlay(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_power_earnings_gap
    from api.services.screener.pattern_join import apply_canonical_pilot_overlay

    memory.store_detection(adapt_power_earnings_gap(_detection()))
    rows = [_row("CRM", "power_earnings_gap")]

    out = apply_canonical_pilot_overlay(rows, ADMIN)

    assert out[0]["pattern_canonical_pilot"]["pattern_id"] == "power_earnings_gap"
    assert out[0]["pattern_canonical_pilot"]["direction"] == "bullish"
    # Legacy fields untouched.
    assert out[0]["pattern_engine_conf"] == 100.0
    assert out[0]["pattern_engine_dir"] == 1


def test_admin_plus_htf_stays_legacy(monkeypatch, tmp_path):
    """Even a genuine, real HTF detection must never receive the overlay --
    HTF is excluded by the hardcoded family set, not by absence of data."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_high_tight_flag
    from api.services.screener.pattern_join import apply_canonical_pilot_overlay

    memory.store_detection(adapt_high_tight_flag(
        _detection(pattern_id="high_tight_flag", sym="NVDA")))
    rows = [_row("NVDA", "high_tight_flag")]

    out = apply_canonical_pilot_overlay(rows, ADMIN)

    assert "pattern_canonical_pilot" not in out[0]


def test_ordinary_user_plus_peg_stays_legacy(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_power_earnings_gap
    from api.services.screener.pattern_join import apply_canonical_pilot_overlay

    memory.store_detection(adapt_power_earnings_gap(_detection()))
    rows = [_row("CRM", "power_earnings_gap")]

    out = apply_canonical_pilot_overlay(rows, ORDINARY)

    assert "pattern_canonical_pilot" not in out[0]


def test_ordinary_user_plus_htf_stays_legacy(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_high_tight_flag
    from api.services.screener.pattern_join import apply_canonical_pilot_overlay

    memory.store_detection(adapt_high_tight_flag(
        _detection(pattern_id="high_tight_flag", sym="NVDA")))
    rows = [_row("NVDA", "high_tight_flag")]

    out = apply_canonical_pilot_overlay(rows, ORDINARY)

    assert "pattern_canonical_pilot" not in out[0]


def test_pilot_flag_off_stays_legacy_for_admin_too(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    monkeypatch.setenv("PATTERN_CANONICAL_SCANNER_PILOT_ENABLED", "0")
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_power_earnings_gap
    from api.services.screener.pattern_join import apply_canonical_pilot_overlay

    memory.store_detection(adapt_power_earnings_gap(_detection()))
    rows = [_row("CRM", "power_earnings_gap")]

    out = apply_canonical_pilot_overlay(rows, ADMIN)

    assert "pattern_canonical_pilot" not in out[0]


def test_no_user_at_all_is_treated_as_unauthorized(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_power_earnings_gap
    from api.services.screener.pattern_join import apply_canonical_pilot_overlay

    memory.store_detection(adapt_power_earnings_gap(_detection()))
    rows = [_row("CRM", "power_earnings_gap")]

    out = apply_canonical_pilot_overlay(rows, None)

    assert "pattern_canonical_pilot" not in out[0]


def test_unsupported_family_stays_legacy_even_if_legacy_ids_claim_peg(monkeypatch, tmp_path):
    """The legacy `pattern_engine_ids` string is client-adjacent, hand-shaped
    test data here -- if the ticker's real canonical 'best' detection is NOT
    power_earnings_gap (e.g. no PEG row was ever actually stored), the
    overlay must not attach anything, even though the row's legacy id list
    names PEG."""
    _fresh(monkeypatch, tmp_path)
    from api.services.screener.pattern_join import apply_canonical_pilot_overlay

    rows = [_row("GHOST", "power_earnings_gap")]  # no detection stored at all

    out = apply_canonical_pilot_overlay(rows, ADMIN)

    assert "pattern_canonical_pilot" not in out[0]


def test_canonical_read_failure_falls_back_safely(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    import api.services.screener.pattern_join as pj

    def _boom(targets):
        raise RuntimeError("simulated canonical read failure")

    monkeypatch.setattr(pj, "read_pattern_fields_canonical_shadow", _boom)
    rows = [_row("CRM", "power_earnings_gap")]

    out = pj.apply_canonical_pilot_overlay(rows, ADMIN)

    assert out == rows
    assert "pattern_canonical_pilot" not in out[0]


def test_missing_eligibility_json_still_produces_a_safe_explicit_summary(monkeypatch, tmp_path):
    """A PEG row stored WITHOUT going through the canonical adapter (no
    eligibility_json at all) must still get a safe, explicit summary --
    scanner_eligible: None, a 'no gate-evaluation trace' warning -- never a
    crash and never a fabricated True/False."""
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.screener.pattern_join import apply_canonical_pilot_overlay

    # Sparse extras -- NOT adapted, and no gap/event fields to reconstruct
    # from either, so this exercises the fully-bare "nothing computed yet"
    # case rather than the richer fixture's reconstructible extras.
    memory.store_detection(_detection(geometry={"shape": "candle_mark", "anchors": [], "extras": {}}))
    rows = [_row("CRM", "power_earnings_gap")]

    out = apply_canonical_pilot_overlay(rows, ADMIN)

    summary = out[0]["pattern_canonical_pilot"]
    assert summary["scanner_eligible"] is None
    assert "no gate-evaluation trace available for this family" in summary["warnings"]
    assert "no event provenance for this family" in summary["warnings"]


def test_no_existing_row_keys_are_ever_mutated(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_power_earnings_gap
    from api.services.screener.pattern_join import apply_canonical_pilot_overlay

    memory.store_detection(adapt_power_earnings_gap(_detection()))
    row = _row("CRM", "power_earnings_gap")
    original = dict(row)

    out = apply_canonical_pilot_overlay([row], ADMIN)

    for k, v in original.items():
        assert out[0][k] == v, f"legacy key {k!r} was mutated"


def test_rows_with_no_peg_token_are_never_looked_up(monkeypatch, tmp_path):
    """A perf/scope guard: a row that never legacy-matched PEG must not even
    trigger a canonical lookup attempt."""
    _fresh(monkeypatch, tmp_path)
    import api.services.screener.pattern_join as pj

    calls = []

    def _tracked(targets):
        calls.append(list(targets))
        return {}

    monkeypatch.setattr(pj, "read_pattern_fields_canonical_shadow", _tracked)
    rows = [_row("NVDA", "high_tight_flag")]

    pj.apply_canonical_pilot_overlay(rows, ADMIN)

    assert calls == []


def test_pattern_id_exact_token_match_not_substring(monkeypatch, tmp_path):
    """A row whose id list contains a longer/adjacent string must not
    false-positive as a PEG match -- MATCH_SEP-wrapped exact-token only."""
    _fresh(monkeypatch, tmp_path)
    import api.services.screener.pattern_join as pj

    calls = []
    monkeypatch.setattr(pj, "read_pattern_fields_canonical_shadow",
                         lambda targets: (calls.append(list(targets)), {})[1])

    # No leading/trailing MATCH_SEP around the token -> must not match.
    rows = [{"ticker": "ZZZZ", "pattern_engine_ids": "power_earnings_gap_variant"}]
    pj.apply_canonical_pilot_overlay(rows, ADMIN)

    assert calls == []


@pytest.mark.parametrize("bad_user", [{}, {"role": "member"}, {"role": None}, {"role": ""}])
def test_various_non_admin_shapes_stay_unauthorized(monkeypatch, tmp_path, bad_user):
    _fresh(monkeypatch, tmp_path)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_power_earnings_gap
    from api.services.screener.pattern_join import apply_canonical_pilot_overlay

    memory.store_detection(adapt_power_earnings_gap(_detection()))
    rows = [_row("CRM", "power_earnings_gap")]

    out = apply_canonical_pilot_overlay(rows, bad_user)

    assert "pattern_canonical_pilot" not in out[0]


# ─── End-to-end wiring: `query.run_scan` IS the served path ────────────────
# "Do not wire canonical authority into a helper the live scanner never
# calls" -- these exercise the REAL function `/api/screener/scan` invokes,
# not just the overlay in isolation.

def _seed_screener_row(tmp_path, monkeypatch):
    import importlib
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    db.init_db()
    db.upsert_rows([
        {"ticker": "CRM", "pattern_engine_ids": ",power_earnings_gap,",
         "pattern_engine_conf": 90.0, "pattern_engine_dir": 1,
         "snapshot_date": "2026-09-05", "built_at": 1},
    ])
    import api.services.screener.query as query
    importlib.reload(query)
    return query


def test_run_scan_attaches_the_overlay_for_an_authorized_admin(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    query = _seed_screener_row(tmp_path, monkeypatch)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_power_earnings_gap

    memory.store_detection(adapt_power_earnings_gap(_detection()))

    res = query.run_scan({"view": "patterns", "page": 1, "page_size": 10}, user=ADMIN)

    row = next(r for r in res["rows"] if r["ticker"] == "CRM")
    assert row["pattern_canonical_pilot"]["pattern_id"] == "power_earnings_gap"


def test_run_scan_never_attaches_the_overlay_for_an_ordinary_paid_member(monkeypatch, tmp_path):
    _fresh(monkeypatch, tmp_path)
    query = _seed_screener_row(tmp_path, monkeypatch)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_power_earnings_gap

    memory.store_detection(adapt_power_earnings_gap(_detection()))

    res = query.run_scan({"view": "patterns", "page": 1, "page_size": 10}, user=ORDINARY)

    row = next(r for r in res["rows"] if r["ticker"] == "CRM")
    assert "pattern_canonical_pilot" not in row


def test_run_scan_with_no_user_kwarg_at_all_behaves_exactly_as_before(monkeypatch, tmp_path):
    """Back-compat: an existing caller that never passes `user=` (there are
    none left in this repo after this package's own router edit, but the
    default must still be inert) gets the untouched legacy row."""
    _fresh(monkeypatch, tmp_path)
    query = _seed_screener_row(tmp_path, monkeypatch)
    from api.services.pattern_engine import memory
    from api.services.pattern_engine.canonical_adapter import adapt_power_earnings_gap

    memory.store_detection(adapt_power_earnings_gap(_detection()))

    res = query.run_scan({"view": "patterns", "page": 1, "page_size": 10})

    row = next(r for r in res["rows"] if r["ticker"] == "CRM")
    assert "pattern_canonical_pilot" not in row
