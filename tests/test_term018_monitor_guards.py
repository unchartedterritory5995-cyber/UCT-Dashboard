"""TERM-018: two monitor pages observed red-before-green (G-11, G-12).

* G-12 `fundamentals_monitor._alert`: a fundamentals regression that SURVIVES the
  self-heal pages `critical` ("fundamentals_regression").
* G-11 `provider_coverage_monitor._alert`: a newly breached coverage field pages
  `critical` ("provider_coverage_regression").

Each test drives the REAL `run_cycle` with only the inputs, the
Discord webhook and the sink replaced. Every firing test pins key and severity; every
CONTROL proves the guard says NO (a clean cycle, a standing defect).
"""
from __future__ import annotations

import importlib
import os

import pytest

from api.services import chart_health_alerts


@pytest.fixture
def pages(monkeypatch):
    seen: list[tuple[str, str]] = []
    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda key, sev, msg, meta=None, **k: seen.append((key, sev)) or True)
    from api.services import discord_notify
    monkeypatch.setattr(discord_notify, "_send_webhook", lambda payload: None)
    return seen


# ── G-12: fundamentals_monitor ──────────────────────────────────────────────

def _fm(tmp_path, monkeypatch):
    monkeypatch.setenv("FUNDAMENTALS_MONITOR_DB", os.path.join(str(tmp_path), "fm.db"))
    import api.services.fundamentals_monitor as fm
    importlib.reload(fm)
    monkeypatch.setattr(fm.cache, "invalidate", lambda k: None, raising=False)
    monkeypatch.setattr(fm.cache, "delete_prefix", lambda p: 0)
    monkeypatch.setattr(fm, "_is_fund", lambda s: False)
    monkeypatch.setattr(fm, "sec_newest_reported_quarter", lambda s: None)
    monkeypatch.setattr(fm, "_maybe_digest", lambda now: False)
    return fm


_DUP = {"ticker": "BAD", "annual": [], "quarterly": [
    {"label": "2026 Q1", "reported": True}, {"label": "2026 Q1", "reported": True}]}
_CLEAN = {"ticker": "OK", "annual": [], "quarterly": [
    {"label": "2026 Q2", "reported": True},
    {"label": "2026 Q3", "reported": False, "period_end": "2026-09-30"}]}


def test_fundamentals_a_regression_that_survives_the_heal_pages_critical(tmp_path, monkeypatch, pages):
    fm = _fm(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _DUP)
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["BAD"])
    out = fm.run_cycle()
    assert out["paged"] == 1
    assert pages == [("fundamentals_regression", "critical")]


def test_fundamentals_CONTROL_a_clean_cycle_and_a_standing_defect_never_page(tmp_path, monkeypatch, pages):
    fm = _fm(tmp_path, monkeypatch)
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _CLEAN)
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["OK"])
    fm.run_cycle()
    assert pages == []
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: _DUP)
    fm.run_cycle()                       # first detection pages once
    fm.run_cycle()                       # the same standing defect does not page again
    assert pages == [("fundamentals_regression", "critical")]


# ── G-11: provider_coverage_monitor ─────────────────────────────────────────

def _pcm(tmp_path, monkeypatch, *, intel_blank: bool):
    import api.services.provider_coverage_monitor as pcm
    importlib.reload(pcm)
    monkeypatch.setattr(pcm, "DB_PATH", str(tmp_path / "coverage_alerts_test.db"))
    monkeypatch.setattr(pcm, "_sample_tickers", lambda n: ["AAPL"])
    monkeypatch.setattr(pcm, "_meta_map", lambda syms: {s: {"name": "X", "industry": "Y"} for s in syms})
    monkeypatch.setattr(pcm, "_transcript_rate", lambda syms: {"observed": None, "sample": 0, "missing": []})
    monkeypatch.setattr(pcm, "_analyst_actions_rate", lambda syms: {"observed": 1.0, "sample": 8, "missing": []})
    monkeypatch.setattr(pcm, "_calendar_hour_rate", lambda: {"observed": 0.7, "sample": 100})
    monkeypatch.setattr(pcm, "_calendar_forward_multisource_rate", lambda: {"observed": 1.0, "sample": 4})
    monkeypatch.setattr(pcm, "_enrichment_with_em_rate", lambda: {"observed": 0.6, "sample": 200})
    monkeypatch.setattr(pcm, "_implied_fiscal_rate", lambda: {"observed": None, "sample": 0})
    monkeypatch.setattr(pcm, "_day_metrics_rate", lambda field: {"observed": 0.8, "sample": 50})
    monkeypatch.setattr(pcm, "_denial_snapshot", lambda: {"finnhub": 0, "alphavantage": None})
    if intel_blank:
        monkeypatch.setattr(pcm, "_intel_map", lambda syms: {s: None for s in syms})
    else:
        monkeypatch.setattr(pcm, "_intel_map", lambda syms: {
            s: {"price_target": {"x": 1}, "consensus": {"y": 1}, "beat_history": [1, 2, 3, 4]}
            for s in syms})
    for f, spec in pcm._FIELD_SPECS.items():
        if spec.get("heal"):
            monkeypatch.setitem(spec, "heal", lambda missing: None)
    return pcm


def test_provider_coverage_a_newly_breached_field_pages_critical(tmp_path, monkeypatch, pages):
    pcm = _pcm(tmp_path, monkeypatch, intel_blank=True)
    out = pcm.run_cycle()
    assert out["newly_alerted"] > 0
    assert pages == [("provider_coverage_regression", "critical")]


def test_provider_coverage_CONTROL_a_healthy_cycle_never_pages(tmp_path, monkeypatch, pages):
    pcm = _pcm(tmp_path, monkeypatch, intel_blank=False)
    out = pcm.run_cycle()
    assert out["newly_alerted"] == 0
    assert pages == []


def test_fundamentals_CONTROL_an_upstream_hole_is_recorded_never_paged(tmp_path, monkeypatch, pages):
    """A forward strip with a hole is a provider fact our code reproduces, not a regression
    in our pipeline: it is flagged for the health endpoint and pages nobody."""
    fm = _fm(tmp_path, monkeypatch)
    hole = {"ticker": "GAP", "annual": [], "quarterly": [
        {"label": "2026 Q2", "reported": True},
        {"label": "2026 Q4", "reported": False, "period_end": "2026-12-31"}]}
    monkeypatch.setattr(fm, "get_earnings_table", lambda s, now=None: hole)
    monkeypatch.setattr(fm, "_sample_tickers", lambda n: ["GAP"])
    out = fm.run_cycle()
    assert out["flagged"] == 1 and out["paged"] == 0
    assert pages == []


def test_provider_coverage_CONTROL_a_standing_breach_pages_once(tmp_path, monkeypatch, pages):
    pcm = _pcm(tmp_path, monkeypatch, intel_blank=True)
    pcm.run_cycle()
    pcm.run_cycle()
    assert pages == [("provider_coverage_regression", "critical")]
