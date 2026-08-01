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


# ── YELLOW whale promotion + "Accumulation" rename (2026-07-31) ──────────
# A $1M+ ASK sweep whose V/OI landed just under 1.5× is colored YELLOW and
# used to be walled out of Alpha Gold / Size (MAGENTA-only branch), surfacing
# as a generic "UCT Bullish Accumulation" row (INTC 90C $6.58M, CRWV 80C
# $3.53M). The premium override now promotes YELLOW → MAGENTA too, and the
# YELLOW label dropped the misleading "Accumulation" word.

_YTH = {"premium_override": {"enabled": True, "min_premium": 1_000_000,
                             "require_sweep_or_block": True}}


def _yrow(**over):
    r = {"Color": "YELLOW", "Type": "SWEEP", "Premium": "6580000", "Side": "A",
         "Dte": "21", "Volume": "7900", "OI": "6300", "Symbol": "INTC"}
    r.update(over)
    return r


def test_yellow_whale_ask_sweep_promotes_to_alpha_gold(monkeypatch):
    monkeypatch.setattr(m, "_load_thresholds", lambda: _YTH)
    monkeypatch.setattr(m, "_is_unusual_classification", lambda *a, **k: False)
    name, tier, _ = m._derive_alert_name(_yrow(), "Bull", money_pct=1.6)   # INTC
    assert tier == "alpha"
    assert name == "UCT Alpha Gold Bull"


def test_yellow_crwv_otm_sweep_promotes_to_alpha_gold(monkeypatch):
    monkeypatch.setattr(m, "_load_thresholds", lambda: _YTH)
    monkeypatch.setattr(m, "_is_unusual_classification", lambda *a, **k: False)
    r = _yrow(Symbol="CRWV", Premium="3530000", Volume="4500", OI="4200")
    name, tier, _ = m._derive_alert_name(r, "Bull", money_pct=-10.7)       # OTM
    assert tier == "alpha"


def test_yellow_whale_bid_side_promotes_to_size_not_alpha(monkeypatch):
    # $1M+ but BID-side → promoted to MAGENTA, fails the ask-only Alpha gate,
    # lands in Size (the "we also size bulls/bears" tier).
    monkeypatch.setattr(m, "_load_thresholds", lambda: _YTH)
    monkeypatch.setattr(m, "_is_unusual_classification", lambda *a, **k: False)
    r = _yrow(Side="BB", Premium="2000000", Volume="900", OI="800")
    name, tier, _ = m._derive_alert_name(r, "Bear", money_pct=-5.0)
    assert tier == "size"
    assert "Accumulation" not in name


def test_yellow_sub_million_stays_bullish_not_accumulation(monkeypatch):
    # Below the override floor → stays YELLOW → generic directional row, and
    # the label no longer says "Accumulation".
    monkeypatch.setattr(m, "_load_thresholds", lambda: _YTH)
    monkeypatch.setattr(m, "_is_unusual_classification", lambda *a, **k: False)
    r = _yrow(Premium="600000", Volume="700", OI="690")
    name, tier, _ = m._derive_alert_name(r, "Bull", money_pct=1.0)
    assert name == "UCT Bullish"
    assert "Accumulation" not in name
    assert tier == "bullish"


def test_override_disabled_yellow_whale_not_promoted(monkeypatch):
    # Rollback path: override off → YELLOW whale stays a generic directional
    # row (never reaches Alpha Gold). Confirms the toggle gates the promotion.
    th = {"premium_override": {"enabled": False, "min_premium": 1_000_000,
                               "require_sweep_or_block": True}}
    monkeypatch.setattr(m, "_load_thresholds", lambda: th)
    monkeypatch.setattr(m, "_is_unusual_classification", lambda *a, **k: False)
    name, tier, _ = m._derive_alert_name(_yrow(), "Bull", money_pct=1.6)
    assert name == "UCT Bullish"
    assert tier == "bullish"


# ── Open/close (profit-take) detector — Phase 1 marker (2026-07-31) ──────
# Session signed net-volume ledger (ask +, bid −). A bid-side SELL into a
# contract that built a NET-LONG earlier the same session = likely close /
# profit-take, not a new short. Phase 1 only MARKS it (a["_likelyClose"]);
# direction is untouched. See _build_session_flow_ledger / _mark_likely_close.

def test_signed_flow_vol_sign_convention():
    assert m._signed_flow_vol("A", 100) == 100
    assert m._signed_flow_vol("AA", 100) == 100
    assert m._signed_flow_vol("B", 100) == -100
    assert m._signed_flow_vol("BB", 100) == -100
    assert m._signed_flow_vol("", 100) == 0        # blank → unsigned
    assert m._signed_flow_vol(None, 100) == 0
    assert m._signed_flow_vol("A", None) == 0


def _frow(rid, side, vol, sym="X", cp="CALL", strike=100, exp="8/1/2026"):
    return {"id": rid, "Symbol": sym, "CallPut": cp, "Strike": strike,
            "ExpirationDate": exp, "Side": side, "Volume": vol}


def test_ledger_net_before_is_prior_only():
    rows = [_frow(1, "A", 500), _frow(2, "A", 300), _frow(3, "BB", 200)]
    nb = m._build_session_flow_ledger(rows)
    assert nb[1] == 0        # nothing before the first print
    assert nb[2] == 500      # after +500
    assert nb[3] == 800      # after +500 +300 (the sell itself not counted)


def test_ledger_separates_contracts():
    rows = [_frow(1, "A", 500, sym="AAA"),
            _frow(2, "A", 999, sym="BBB"),
            _frow(3, "BB", 100, sym="AAA")]
    nb = m._build_session_flow_ledger(rows)
    assert nb[3] == 500      # only AAA's prior +500 counts, not BBB's +999
    assert nb[2] == 0


def test_ledger_orders_by_id_not_input_order():
    rows = [_frow(3, "BB", 200), _frow(1, "A", 500), _frow(2, "A", 300)]  # shuffled
    nb = m._build_session_flow_ledger(rows)
    assert nb[3] == 800      # sorted by id regardless of fetch order


_CTH = {"close_detector_enabled": True, "close_net_frac": 1.0}


def _calert(rid, side, vol, direction="Bear"):
    return {"id": rid, "_side": side, "tradeSize": vol, "_direction": direction}


def test_close_flag_on_bid_into_net_long():
    a = _calert(3, "BB", 200)                     # sell 200 into +800 net long
    m._mark_likely_close(a, {3: 800.0}, _CTH)
    assert a.get("_likelyClose") is True
    assert a["_sessionNetBefore"] == 800
    assert a["_direction"] == "Bear"              # direction UNCHANGED (Phase 1)


def test_no_flag_when_net_short_msft_class():
    # MSFT-class: bid-dominated session → net_before negative → opening a
    # short, not a close. Must NOT flag (the control case).
    a = _calert(9, "BB", 13000)
    m._mark_likely_close(a, {9: -5000.0}, _CTH)
    assert "_likelyClose" not in a


def test_no_flag_when_net_long_smaller_than_print():
    a = _calert(3, "BB", 1000)                    # 200 net long < 1000 sold
    m._mark_likely_close(a, {3: 200.0}, _CTH)
    assert "_likelyClose" not in a


def test_ask_side_never_flagged_as_close():
    a = _calert(3, "A", 200)
    m._mark_likely_close(a, {3: 800.0}, _CTH)
    assert "_likelyClose" not in a


def test_close_detector_disabled_is_noop():
    a = _calert(3, "BB", 200)
    m._mark_likely_close(a, {3: 800.0}, {"close_detector_enabled": False})
    assert "_likelyClose" not in a
