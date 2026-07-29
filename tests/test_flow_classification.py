"""
Options-flow classification fixes (2026-07-28):
  #2 — dominant-sweep exemption in _demote_multileg_structures (MU 835C class)
  #3 — OI-unknown premium-override exemption in _qualifies_curated (AMAT class)
"""

import os
import sys
import types
import tempfile

os.environ.setdefault("RAILWAY_VOLUME_MOUNT_PATH", tempfile.mkdtemp(prefix="lmr_"))
_fake_auth = types.ModuleType("api.flow_admin_auth")
_fake_auth.require_flow_admin = lambda *a, **k: {}
_fake_auth.require_flow_user = lambda *a, **k: {}
sys.modules.setdefault("api.flow_admin_auth", _fake_auth)

import pytest
from api import live_massive_router as m


# ── #2 multileg dominant-sweep exemption ────────────────────────────────

def _leg(ticker, strike, prem, direction="Bull", typ="SWEEP", ts=1000.0, cp="C", exp="8/1/2026"):
    return {"ticker": ticker, "strike": strike, "cp": cp, "exp": exp, "timestamp": ts,
            "_direction": direction, "_type": typ, "alertPremium": prem}


def _ml_thresholds(dom_frac=0.6):
    return {"multileg_window_sec": 90.0, "multileg_min_legs": 3,
            "multileg_dominant_premium_frac": dom_frac}


def test_dominant_sweep_survives_multileg_demote(monkeypatch):
    monkeypatch.setattr(m, "_load_thresholds", lambda: _ml_thresholds())
    dom = _leg("MU", 835, 5_000_000, ts=1000)             # the $5.17M-class sweep
    legs = [dom,
            _leg("MU", 825, 90_000, ts=1002),
            _leg("MU", 945, 70_000, ts=1004),
            _leg("MU", 950, 24_000, ts=1006)]
    m._demote_multileg_structures(legs)
    assert dom["_direction"] == "Bull"                    # dominant sweep KEPT
    assert dom.get("_multileg") is not True
    assert legs[1]["_direction"] is None                  # noise legs demoted
    assert legs[1]["alertName"] == "UCT Size - Not Clean"


def test_balanced_spread_all_demoted(monkeypatch):
    monkeypatch.setattr(m, "_load_thresholds", lambda: _ml_thresholds())
    legs = [_leg("SNDK", 1500, 1_000_000, ts=1000),
            _leg("SNDK", 1470, 1_000_000, ts=1001),
            _leg("SNDK", 1040, 1_000_000, ts=1002)]       # ~33% each, none ≥60%
    m._demote_multileg_structures(legs)
    assert all(l["_direction"] is None for l in legs)     # real spread → all demoted


def test_dom_frac_zero_disables_exemption(monkeypatch):
    monkeypatch.setattr(m, "_load_thresholds", lambda: _ml_thresholds(dom_frac=0))
    dom = _leg("MU", 835, 5_000_000, ts=1000)
    legs = [dom, _leg("MU", 825, 90_000, ts=1002), _leg("MU", 945, 70_000, ts=1004)]
    m._demote_multileg_structures(legs)
    assert dom["_direction"] is None                      # kill-switch → old behavior


def test_dominant_but_block_not_exempted(monkeypatch):
    # Only SWEEPs are exempted — a dominant BLOCK stays a possible spread leg.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _ml_thresholds())
    dom = _leg("MU", 835, 5_000_000, typ="BLOCK", ts=1000)
    legs = [dom, _leg("MU", 825, 90_000, ts=1002), _leg("MU", 945, 70_000, ts=1004)]
    m._demote_multileg_structures(legs)
    assert dom["_direction"] is None


# ── #3 curated OI-unknown exemption ─────────────────────────────────────

_TH = {
    "stack": {"min_signals": 2, "vOI": 1.0, "hit_count": 3, "grade": "B", "voi_required": True},
    "premium_by_cap": {"size": {"mid_small": 500_000, "large": 750_000, "mega": 1_000_000}},
    "cap_bands": {"mid_small_max": 10_000_000_000, "large_max": 200_000_000_000},
    "premium_override": {"enabled": True, "min_premium": 1_000_000, "require_sweep_or_block": True},
}


def _amat_like(**over):
    a = {"_tierKey": "size", "alertPremium": 2_344_960, "volumeOIRatio": None, "priorOI": None,
         "_hitCount": 1, "grade": "B", "_mktCap": 508_000_000_000, "_type": "SWEEP", "source": "stocks"}
    a.update(over)
    return a


def test_oi_unknown_big_sweep_passes_curated():
    assert m._qualifies_curated(_amat_like(), _TH) is True


def test_low_voi_with_known_oi_still_fails():
    # OI KNOWN + genuinely low V/OI → NOT exempted (a legit low-conviction drop).
    assert m._qualifies_curated(_amat_like(volumeOIRatio=0.1, priorOI=7917), _TH) is False


def test_oi_unknown_override_disabled_not_exempted():
    th = dict(_TH)
    th["premium_override"] = {"enabled": False, "min_premium": 1_000_000, "require_sweep_or_block": True}
    assert m._qualifies_curated(_amat_like(), th) is False


def test_oi_unknown_non_sweep_block_not_exempted():
    # require_sweep_or_block on + a non-sweep/block type → not the override population.
    assert m._qualifies_curated(_amat_like(_type="AUCTION"), _TH) is False
