"""Phase 8, Package 8F — the live write-path integration test.

Exercises `api.main._scan_patterns_daily` directly (it is a plain,
self-contained, directly-callable function — no scheduler/HTTP layer
needed) against REAL fixture bars, through the REAL SQLite store, proving
the flag-gated canonical-adapt step behaves exactly as the ChatGPT relay
review required:

  - OFF by default — no behavior change from before this package.
  - Fail-safe — an adapter exception never loses the underlying legacy
    detection or breaks the scan; the row is still stored, un-enriched.
  - Scoped to HTF/PEG only — every other family is provably untouched.
  - Idempotent — a repeated scheduled run upserts one row, never duplicates.
"""
from __future__ import annotations

import pytest

from api.main import _scan_patterns_daily
from api.services import bars_sqlite
from api.services.pattern_engine import memory
from api.services.pattern_engine.pattern_db import init_db
from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures


def _firing_bars_tuples(family: str) -> list:
    for fx in load_all_fixtures(family, include_internal=False):
        if fx.expected_fires:
            return [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in fx.bars]
    raise AssertionError(f"no firing {family} fixture found")


class _Log:
    def debug(self, *a, **k): pass
    def warning(self, *a, **k): pass
    def info(self, *a, **k): pass


@pytest.fixture(autouse=True)
def _init():
    init_db()


@pytest.fixture
def htf_bars():
    return _firing_bars_tuples("high_tight_flag")


@pytest.fixture
def peg_bars():
    return _firing_bars_tuples("power_earnings_gap")


@pytest.fixture
def bull_flag_bars():
    return _firing_bars_tuples("bull_flag")


def _run_and_get(monkeypatch, sym, bars, pattern_id, env=None):
    """Run the real scan against `bars` and return the rows it stored for
    THIS ONE pattern_id — `detect_all` runs the full ~85-detector registry
    against any real bars, so many unrelated detectors legitimately also
    fire on the same series; every assertion here must be scoped to the
    family under test, never to the scan's total store count."""
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda s, tf, n: bars if s == sym else [])
    for k, v in (env or {}).items():
        monkeypatch.setenv(k, v)
    _scan_patterns_daily([sym], set(), _Log())
    return memory.get_active_detections(sym, "D", pattern_ids=[pattern_id])


def test_flag_off_by_default_writes_no_eligibility(monkeypatch, htf_bars):
    monkeypatch.delenv("PATTERN_CANONICAL_ADAPT_ENABLED", raising=False)
    rows = _run_and_get(monkeypatch, "SCANHTF1", htf_bars, "high_tight_flag")
    assert len(rows) == 1
    assert "eligibility" not in rows[0]
    assert "anchor_roles" not in rows[0]["geometry"]


def test_flag_on_writes_real_eligibility_and_semantic_geometry_for_htf(monkeypatch, htf_bars):
    rows = _run_and_get(
        monkeypatch, "SCANHTF2", htf_bars, "high_tight_flag",
        env={"PATTERN_CANONICAL_ADAPT_ENABLED": "1"},
    )
    assert len(rows) == 1
    d = rows[0]
    assert "eligibility" in d
    assert d["eligibility"]["eligible"] is True
    assert d["geometry"]["anchor_roles"] == [
        "pole_base", "pole_top", "flag_low", "flag_high",
    ]


def test_flag_on_writes_real_eligibility_for_peg(monkeypatch, peg_bars):
    rows = _run_and_get(
        monkeypatch, "SCANPEG1", peg_bars, "power_earnings_gap",
        env={"PATTERN_CANONICAL_ADAPT_ENABLED": "1"},
    )
    assert len(rows) == 1
    assert "eligibility" in rows[0]
    assert rows[0]["geometry"]["semantic_subtype"] == "gap_event"


def test_flag_on_does_not_affect_unrelated_families(monkeypatch, bull_flag_bars):
    rows = _run_and_get(
        monkeypatch, "SCANBF1", bull_flag_bars, "bull_flag",
        env={"PATTERN_CANONICAL_ADAPT_ENABLED": "1"},
    )
    assert len(rows) == 1
    assert "eligibility" not in rows[0]


def test_adapter_failure_is_fail_safe_and_still_stores_the_legacy_detection(
    monkeypatch, htf_bars,
):
    from api.services.pattern_engine import canonical_adapter

    def _boom(detection, **kw):
        raise RuntimeError("simulated adapter failure")

    monkeypatch.setattr(canonical_adapter, "adapt_high_tight_flag", _boom)
    rows = _run_and_get(
        monkeypatch, "SCANHTF3", htf_bars, "high_tight_flag",
        env={"PATTERN_CANONICAL_ADAPT_ENABLED": "1"},
    )
    # The scan must not raise, and the legacy detection must still land —
    # the canonical layer is never a new availability dependency.
    assert len(rows) == 1
    assert "eligibility" not in rows[0]
    assert rows[0]["pattern_id"] == "high_tight_flag"
    assert rows[0]["direction"] == "bullish"


def test_repeated_scheduled_run_upserts_one_row_not_duplicates(monkeypatch, htf_bars):
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda s, tf, n: htf_bars if s == "SCANHTF4" else [])
    monkeypatch.setenv("PATTERN_CANONICAL_ADAPT_ENABLED", "1")
    _scan_patterns_daily(["SCANHTF4"], set(), _Log())
    _scan_patterns_daily(["SCANHTF4"], set(), _Log())
    rows = memory.get_active_detections("SCANHTF4", "D", pattern_ids=["high_tight_flag"])
    assert len(rows) == 1
    assert "eligibility" in rows[0]
