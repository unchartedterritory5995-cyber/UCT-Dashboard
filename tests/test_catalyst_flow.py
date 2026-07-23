"""Options-flow catalyst source: surface + enrich from the flow conviction board."""
import json

import pytest

from api.services.catalyst import sources, filters, tagging, scoring, synthesize


# ── _pull_options_flow (fetch + fail-soft) ───────────────────────────────
def test_flow_pull_disabled_returns_empty(monkeypatch):
    monkeypatch.setenv("CATALYST_FLOW_ENABLED", "0")
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://worker")
    assert sources._pull_options_flow() == {}


def test_flow_pull_no_worker_url_returns_empty(monkeypatch):
    monkeypatch.setenv("CATALYST_FLOW_ENABLED", "1")
    monkeypatch.delenv("WORKER_INTERNAL_URL", raising=False)
    assert sources._pull_options_flow() == {}


def test_flow_pull_parses_leaderboard(monkeypatch):
    monkeypatch.setenv("CATALYST_FLOW_ENABLED", "1")
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://worker")
    payload = {"date": "2026-07-23", "count": 2, "items": [
        {"sym": "SMCI", "dir": "BULL", "netPremium": 4.2e6, "bullPct": 78},
        {"sym": "hut",  "dir": "BEAR", "netPremium": -1.1e6, "bullPct": 20},
    ]}

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return payload

    monkeypatch.setattr("requests.get", lambda *a, **k: _Resp())
    out = sources._pull_options_flow()
    assert set(out.keys()) == {"SMCI", "HUT"}          # upper-cased
    assert out["SMCI"]["rank"] == 1 and out["HUT"]["rank"] == 2


def test_flow_pull_failsoft_on_error(monkeypatch):
    monkeypatch.setenv("CATALYST_FLOW_ENABLED", "1")
    monkeypatch.setenv("WORKER_INTERNAL_URL", "http://worker")

    def boom(*a, **k):
        raise RuntimeError("worker down")
    monkeypatch.setattr("requests.get", boom)
    assert sources._pull_options_flow() == {}           # never raises


# ── flow surfaces a name past the activity gate ──────────────────────────
def test_flow_notable_passes_activity_gate():
    # A flat name (no gap, no vol, no earnings) surfaces on unusual flow alone.
    passed, _ = filters.is_real_catalyst(
        {"gap_pct": 0.4, "vol_x": 1.0, "flow_notable": True})
    assert passed is True


def test_flat_earnings_still_dropped_without_flow():
    passed, _ = filters.is_real_catalyst(
        {"gap_pct": 0.4, "vol_x": 1.0, "earnings_just_reported": True})
    assert passed is False


def test_flow_rescues_flat_earnings_name():
    passed, _ = filters.is_real_catalyst(
        {"gap_pct": 0.4, "vol_x": 1.0, "earnings_just_reported": True,
         "flow_notable": True})
    assert passed is True


# ── flow tags + scores ───────────────────────────────────────────────────
def test_flow_notable_tags_catalyst():
    assert tagging.assign_tag({"flow_notable": True}) == "Catalyst"


def test_flow_notable_adds_score(monkeypatch):
    base = scoring.score({"gap_pct": 2.0, "vol_x": 1.5})
    with_flow = scoring.score({"gap_pct": 2.0, "vol_x": 1.5, "flow_notable": True})
    assert (with_flow - base) >= 12


# ── flow signal formatting (for curator + synthesis) ─────────────────────
def test_format_flow_block():
    s = synthesize._format_flow_block({"options_flow": {
        "dir": "BULL", "netPremium": 4.2e6, "bullPct": 78,
        "topContract": {"cp": "CALL", "strike": 60, "exp": "Aug 16", "hits": 12}}})
    assert "$4.2M" in s and "BULL" in s and "78% bull" in s and "CALL $60" in s


def test_format_flow_block_empty_when_no_flow():
    assert synthesize._format_flow_block({}) == ""
    assert synthesize._format_flow_block({"options_flow": None}) == ""
