"""
Options-flow classification fixes (2026-07-28):
  #2 — dominant-sweep exemption in _demote_multileg_structures (MU 835C class)
  #3 — OI-unknown premium-override exemption in _qualifies_curated (AMAT class)
"""

import os
import tempfile

os.environ.setdefault("RAILWAY_VOLUME_MOUNT_PATH", tempfile.mkdtemp(prefix="lmr_"))

# ⛔ NO `sys.modules.setdefault("api.flow_admin_auth", <two lambdas>)` HERE.
# This file used to install one at import time and never remove it, so THE
# FIRST IMPORTER DECIDED WHAT EVERY OTHER TEST IN THE PROCESS BOUND. Measured:
# `pytest test_flow_classification.py test_flow_proxy_auth.py` = 7 failed;
# the same two files reversed = 27 passed.
#
# The stub was VESTIGIAL. Its comment said the auth chain pulls bcrypt — bcrypt
# is installed, `import api.flow_admin_auth` succeeds, and these tests never
# resolve a FastAPI dependency (they call pure functions), so the real module
# costs nothing. Deleting beats fixturing. `tests/test_shared_state_landmines.py`
# is the rail: it reads every test module's AST and fails if one comes back.
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


# ── Alpha LEAPS — aggregate-conviction LEAP tier (2026-08-11) ────────────
# A LEAP (DTE>=180) is demoted out of Alpha Gold by design and would only
# reach the LEAPS tier. But a position BUILT with size — multiple ask-side
# prints (sweeps + blocks) on the SAME contract summing to a large AGGREGATE
# premium, near-the-money — is institutional conviction. The classifier grades
# the AGGREGATE (agg_ask_premium, from _build_session_ask_premium_ledger):
# counts blocks and ignores the <180 Alpha Gold DTE cap. Motivating case:
# CRWD 235C 12/17/2027 (~493 DTE), ~5% OTM, $12M of ask-side sweeps+blocks.

_LEAPTH = {"alpha_leaps_enabled": True,
           "alpha_leaps_min_aggregate_premium": 3_000_000,
           "alpha_leaps_max_otm_pct": 15.0}


def _leaprow(**over):
    # MAGENTA so it reaches the tier branch; DTE 493 = LEAP; ask side; V/OI>1
    # so a below-floor row cleanly falls to the LEAPS tier (not dropped).
    r = {"Color": "MAGENTA", "Type": "SWEEP", "Premium": "1740000", "Side": "A",
         "Dte": "493", "Volume": "6000", "OI": "5000", "Symbol": "CRWD"}
    r.update(over)
    return r


def test_leap_ask_cluster_over_floor_is_alpha_leaps(monkeypatch):
    monkeypatch.setattr(m, "_load_thresholds", lambda: _LEAPTH)
    monkeypatch.setattr(m, "_is_unusual_classification", lambda *a, **k: False)
    name, tier, _ = m._derive_alert_name(
        _leaprow(), "Bull", money_pct=-5.2, agg_ask_premium=12_010_000)
    assert tier == "alpha_leaps"
    assert name == "UCT Alpha LEAPS Bull"


def test_alpha_leaps_counts_blocks(monkeypatch):
    # BLOCK type is EXCLUDED from Alpha Gold, but Alpha LEAPS grades the whole
    # position — a block adding to the same strike still qualifies.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _LEAPTH)
    monkeypatch.setattr(m, "_is_unusual_classification", lambda *a, **k: False)
    r = _leaprow(Type="BLOCK", Premium="4490000")
    name, tier, _ = m._derive_alert_name(
        r, "Bull", money_pct=-5.2, agg_ask_premium=12_010_000)
    assert tier == "alpha_leaps"


def test_leap_under_aggregate_floor_falls_to_leaps(monkeypatch):
    # Aggregate below $3M → not conviction → normal LEAPS tier.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _LEAPTH)
    monkeypatch.setattr(m, "_is_unusual_classification", lambda *a, **k: False)
    name, tier, _ = m._derive_alert_name(
        _leaprow(), "Bull", money_pct=-5.2, agg_ask_premium=2_000_000)
    assert tier == "leaps"


def test_deep_otm_leap_not_alpha_leaps(monkeypatch):
    # Huge aggregate but deep OTM (lottery, not near-the-money) → not Alpha LEAPS.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _LEAPTH)
    monkeypatch.setattr(m, "_is_unusual_classification", lambda *a, **k: False)
    name, tier, _ = m._derive_alert_name(
        _leaprow(), "Bull", money_pct=-30.0, agg_ask_premium=12_010_000)
    assert tier == "leaps"


def test_short_dated_cluster_is_alpha_gold_not_alpha_leaps(monkeypatch):
    # DTE < 180 is NOT a LEAP — a big ask sweep goes to Alpha Gold as before.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _LEAPTH)
    monkeypatch.setattr(m, "_is_unusual_classification", lambda *a, **k: False)
    r = _leaprow(Dte="30", Premium="4490000")
    name, tier, _ = m._derive_alert_name(
        r, "Bull", money_pct=2.0, agg_ask_premium=12_010_000)
    assert tier == "alpha"


def test_alpha_leaps_disabled_falls_to_leaps(monkeypatch):
    # Kill switch: disabled → the same row reverts to the LEAPS tier.
    th = dict(_LEAPTH, alpha_leaps_enabled=False)
    monkeypatch.setattr(m, "_load_thresholds", lambda: th)
    monkeypatch.setattr(m, "_is_unusual_classification", lambda *a, **k: False)
    name, tier, _ = m._derive_alert_name(
        _leaprow(), "Bull", money_pct=-5.2, agg_ask_premium=12_010_000)
    assert tier == "leaps"


def test_alpha_leaps_ask_premium_ledger_sums_only_ask(monkeypatch):
    # The ledger sums A/AA premium per (symbol, strike, expiry) across the
    # session and maps every row_id to that contract total (bid rows included
    # for lookup, but they add 0). Order-independent.
    rows = [
        {"id": 1, "Symbol": "CRWD", "CallPut": "CALL", "Strike": "235",
         "ExpirationDate": "12/17/2027", "Side": "A",  "Premium": "1200000"},
        {"id": 2, "Symbol": "CRWD", "CallPut": "CALL", "Strike": "235",
         "ExpirationDate": "12/17/2027", "Side": "A",  "Premium": "4490000"},
        {"id": 3, "Symbol": "CRWD", "CallPut": "CALL", "Strike": "235",
         "ExpirationDate": "12/17/2027", "Side": "BB", "Premium": "9990000"},
    ]
    led = m._build_session_ask_premium_ledger(rows)
    assert led[1] == 5_690_000  # 1.2M + 4.49M ask; the BB print adds 0
    assert led[2] == 5_690_000
    assert led[3] == 5_690_000  # bid row still maps to the contract's ask total


# ── UCT Ask Accumulation — aggregate ask-build tier, any DTE (2026-09-04) ──
# Same aggregate-ask machinery as Alpha LEAPS but WITHOUT the 180-DTE cap and at a
# $1M floor. 2026-09-05 REDESIGN (both verified against flow.db):
#   (1) The ask ledger now counts BLANK-side SWEEPs as presumed-ask
#       (sweep_empty_side_as_ask), so a build made mostly of blank sweeps reaches
#       its true aggregate. PPTA 35C 01/15/27 = a $484.5K A-block + 3 blank sweeps
#       ($679.9K + $28.6K + $18.0K) = ~$1.21M; the old A/AA-only ledger saw only
#       the $484.5K block and fell under the floor.
#   (2) The noise guard is CONTRACT-LEVEL conviction (_ask_accum_conviction:
#       session ask VOLUME / contract OI >= ask_accum_min_contract_voi = a NEW
#       build), NOT name-level dormancy. PPTA is an ACTIVE name (alerts almost
#       daily) so the dormancy gate wrongly excluded it — yet the 35C build is
#       7,277 ask vol vs 2,321 OI = 3.1x, unambiguous new positioning.
# Precedence: Alpha LEAPS > Alpha Gold > Ask Accumulation > LEAPS/Unusual/Size.

_AATH = {"ask_accum_enabled": True,
         "ask_accum_min_aggregate_premium": 1_000_000,
         "ask_accum_max_otm_pct": 50.0,
         "ask_accum_require_unusual": True,
         "ask_accum_min_contract_voi": 1.0,
         "ask_accum_max_mktcap": 50_000_000_000,
         "fresh_strike_min_volume": 100}


def _accrow(**over):
    # MAGENTA so it reaches the tier branch; DTE 133 (NOT a LEAP, and a sub-$1M
    # single print so NOT Alpha Gold); ask side. Real PPTA 35C shape: OI 2321,
    # contract session ask volume ~7277 → V/OI ~3.1 (a NEW build).
    r = {"Color": "MAGENTA", "Type": "SWEEP", "Premium": "679865", "Side": "A",
         "Dte": "133", "Volume": "4000", "OI": "2321", "Symbol": "PPTA",
         "MktCap": "2977000000"}   # ~$2.98B — under the mega-cap ceiling
    r.update(over)
    return r


# agg_ask_premium ~$1.21M (PPTA 35C session ask total, blank sweeps incl.);
# agg_ask_volume 7277 vs OI 2321 → V/OI 3.1x (contract-level conviction).
_PPTA_PREM = 1_210_952
_PPTA_VOL = 7277


def test_ask_accum_fires_on_active_name_with_contract_conviction(monkeypatch):
    # THE PPTA CASE: an ACTIVE name (not dormant) whose 35C is a genuine NEW build
    # (ask vol >> OI). The single-print gates all miss it; this tier catches it.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _AATH)
    name, tier, _ = m._derive_alert_name(
        _accrow(), "Bull", money_pct=-28.6,
        agg_ask_premium=_PPTA_PREM, agg_ask_volume=_PPTA_VOL)
    assert tier == "ask_accum"
    assert name == "UCT Ask Accumulation Bull"


def test_ask_accum_counts_blocks(monkeypatch):
    # BLOCK is excluded from Alpha Gold, but Ask Accumulation grades the whole
    # position — the block premium is already in agg_ask_premium.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _AATH)
    r = _accrow(Type="BLOCK", Premium="484532")
    name, tier, _ = m._derive_alert_name(
        r, "Bull", money_pct=-28.6,
        agg_ask_premium=_PPTA_PREM, agg_ask_volume=_PPTA_VOL)
    assert tier == "ask_accum"


def test_ask_accum_yellow_print_promotes_and_fires(monkeypatch):
    # A moderate-V/OI print is YELLOW (not MAGENTA), so it never reached the tier
    # branch. The aggregate promotion pulls it in when the SESSION ask total clears
    # the floor AND the contract shows new-build conviction.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _AATH)
    r = _accrow(Color="YELLOW")
    name, tier, _ = m._derive_alert_name(
        r, "Bull", money_pct=-28.6,
        agg_ask_premium=_PPTA_PREM, agg_ask_volume=_PPTA_VOL)
    assert tier == "ask_accum"


def test_ask_accum_churn_on_existing_oi_does_not_fire(monkeypatch):
    # THE NOISE GUARD: a big aggregate but LOW contract V/OI — a roll/adjustment on
    # a large STANDING position (the megacap-churn shape that disabled accum). Ask
    # vol 900 vs OI 200000 = 0.005x → not a new build → must NOT fire.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _AATH)
    r = _accrow(OI="200000")
    res = m._derive_alert_name(
        r, "Bull", money_pct=-28.6,
        agg_ask_premium=_PPTA_PREM, agg_ask_volume=900)
    assert res is None or res[1] != "ask_accum"


def test_ask_accum_yellow_churn_not_promoted(monkeypatch):
    # Same churn shape, YELLOW: the aggregate promotion is also gated on contract
    # conviction, so a low-V/OI YELLOW row is not promoted to the tier.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _AATH)
    r = _accrow(Color="YELLOW", OI="200000")
    res = m._derive_alert_name(
        r, "Bull", money_pct=-28.6,
        agg_ask_premium=_PPTA_PREM, agg_ask_volume=900)
    assert res is None or res[1] != "ask_accum"


def test_ask_accum_excludes_megacap(monkeypatch):
    # A liquid MEGA-CAP ($1T) with the same $1.21M / 3x-OI aggregate is routine ATM
    # churn, not conviction — the mega-cap ceiling (primary noise guard) drops it.
    # On 9/4 the aggregate-V/OI test alone let 258 mega/index contracts through.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _AATH)
    r = _accrow(MktCap="1000000000000")   # $1T
    res = m._derive_alert_name(r, "Bull", money_pct=-28.6,
                               agg_ask_premium=_PPTA_PREM, agg_ask_volume=_PPTA_VOL)
    assert res is None or res[1] != "ask_accum"


def test_ask_accum_excludes_index_unknown_mktcap(monkeypatch):
    # Index options (SPX/NDX) report mktcap 0/unknown — the biggest 9/4 noise
    # ($98M SPX puts). Excluded by the ceiling's 0-lower-bound.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _AATH)
    r = _accrow(MktCap="0")
    res = m._derive_alert_name(r, "Bull", money_pct=-28.6,
                               agg_ask_premium=_PPTA_PREM, agg_ask_volume=_PPTA_VOL)
    assert res is None or res[1] != "ask_accum"


def test_ask_accum_fresh_strike_conviction(monkeypatch):
    # OI unknown/zero (a brand-new strike): every contract trading is new exposure
    # → qualifies when ask volume clears the fresh floor.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _AATH)
    r = _accrow(OI="0")
    name, tier, _ = m._derive_alert_name(
        r, "Bull", money_pct=-28.6,
        agg_ask_premium=_PPTA_PREM, agg_ask_volume=500)
    assert tier == "ask_accum"


def test_ask_accum_require_unusual_off_fires_without_conviction(monkeypatch):
    # With the guard relaxed, the aggregate alone qualifies — no contract-V/OI test.
    th = dict(_AATH, ask_accum_require_unusual=False)
    monkeypatch.setattr(m, "_load_thresholds", lambda: th)
    r = _accrow(OI="200000")
    name, tier, _ = m._derive_alert_name(
        r, "Bull", money_pct=-28.6,
        agg_ask_premium=_PPTA_PREM, agg_ask_volume=900)
    assert tier == "ask_accum"


def test_ask_accum_under_floor_does_not_fire(monkeypatch):
    # Aggregate below $1M → not a build → falls through to its single-print tier.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _AATH)
    name, tier, _ = m._derive_alert_name(
        _accrow(), "Bull", money_pct=-28.6,
        agg_ask_premium=900_000, agg_ask_volume=_PPTA_VOL)
    assert tier != "ask_accum"


def test_ask_accum_deep_otm_excluded(monkeypatch):
    # Huge aggregate + conviction but beyond the near-money bound → not a build.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _AATH)
    name, tier, _ = m._derive_alert_name(
        _accrow(), "Bull", money_pct=-60.0,
        agg_ask_premium=_PPTA_PREM, agg_ask_volume=_PPTA_VOL)
    assert tier != "ask_accum"


def test_ask_accum_bid_side_not_fired(monkeypatch):
    # Bid-side flow is not an ASK build — the ledger sums ask only, but guard the
    # side explicitly too.
    monkeypatch.setattr(m, "_load_thresholds", lambda: _AATH)
    r = _accrow(Side="BB")
    name, tier, _ = m._derive_alert_name(
        r, "Bear", money_pct=-28.6,
        agg_ask_premium=_PPTA_PREM, agg_ask_volume=_PPTA_VOL)
    assert tier != "ask_accum"


def test_ask_accum_kill_switch(monkeypatch):
    # Disabled → the same row reverts to its single-print tier.
    th = dict(_AATH, ask_accum_enabled=False)
    monkeypatch.setattr(m, "_load_thresholds", lambda: th)
    name, tier, _ = m._derive_alert_name(
        _accrow(), "Bull", money_pct=-28.6,
        agg_ask_premium=_PPTA_PREM, agg_ask_volume=_PPTA_VOL)
    assert tier != "ask_accum"


# ── Ask ledger — blank-side SWEEPs count as presumed-ask (THE PPTA BUG FIX) ──
# The 9/4 PPTA 35C build in flow.db: one A BLOCK + three BLANK-side SWEEPs. The
# old ledger query pulled Side IN (A/AA/B/BB) only, so the aggregate was just the
# $484.5K block — under the $1M floor — and ask_accum could never fire, dormancy
# gate or not. These pin the presumption into the CONTRACT aggregate.

def _ppta_ledger_rows():
    K = dict(Symbol="PPTA", CallPut="CALL", Strike="35", ExpirationDate="1/15/2027")
    return [
        {"id": 1, "Side": "",  "Type": "SWEEP", "Premium": "679865", "Volume": "4000", **K},
        {"id": 2, "Side": "A", "Type": "BLOCK", "Premium": "484532", "Volume": "3000", **K},
        {"id": 3, "Side": "",  "Type": "SWEEP", "Premium": "28560",  "Volume": "168",  **K},
        {"id": 4, "Side": "",  "Type": "SWEEP", "Premium": "17995",  "Volume": "109",  **K},
    ]


def test_ask_premium_ledger_counts_blank_sweeps():
    led = m._build_session_ask_premium_ledger(_ppta_ledger_rows(), presume_sweep_ask=True)
    assert led[1] == 1_210_952           # full contract aggregate on every row
    assert led[2] == 1_210_952


def test_ask_premium_ledger_strict_excludes_blank_sweeps():
    led = m._build_session_ask_premium_ledger(_ppta_ledger_rows(), presume_sweep_ask=False)
    assert led[2] == 484_532             # only the A block — the pre-fix behaviour


def test_ask_volume_ledger_counts_blank_sweeps():
    led = m._build_session_ask_volume_ledger(_ppta_ledger_rows(), presume_sweep_ask=True)
    assert led[1] == 7277                # 4000 + 3000 + 168 + 109
    assert led[2] == 7277


def test_ask_ledger_blank_block_stays_strict():
    # A BLANK-side BLOCK (not a sweep) is NOT presumed ask — blocks stay strict.
    rows = [{"id": 9, "Side": "", "Type": "BLOCK", "Premium": "999999", "Volume": "500",
             "Symbol": "X", "CallPut": "CALL", "Strike": "10", "ExpirationDate": "1/1/2027"}]
    assert m._build_session_ask_premium_ledger(rows, presume_sweep_ask=True)[9] == 0.0


def test_ask_accum_conviction_helper():
    th = {"ask_accum_min_contract_voi": 1.0, "fresh_strike_min_volume": 100}
    assert m._ask_accum_conviction(2321, 7277, th) is True     # PPTA: 3.1x
    assert m._ask_accum_conviction(200000, 900, th) is False   # churn: 0.005x
    assert m._ask_accum_conviction(0, 500, th) is True         # fresh strike, over floor
    assert m._ask_accum_conviction(0, 50, th) is False         # fresh strike, under floor


# ── Deep-OTM lottery EXEMPTION (the deepest PPTA blocker) ───────────────────
# The PPTA 35C 01/15/27 at spot ~$24.81 is ~41% OTM vs spot — past the 30%-BLOCK
# lottery bar in _row_to_alert's noise filter 2, so it was discarded BEFORE
# classification, no matter how the tier gates were tuned. _ask_accum_qualifies
# now exempts a real ask BUILD from that drop. These run the FULL _row_to_alert.

def _ppta_full_row(**over):
    r = {"id": 2, "Symbol": "PPTA", "CallPut": "CALL", "Strike": "35",
         "ExpirationDate": "1/15/2027", "Dte": "133", "CreatedDate": "9/4/2026",
         "CreatedTime": "12:00:00", "Side": "A", "Type": "BLOCK",
         "Premium": "484532", "Volume": "3000", "OI": "2321", "Spot": "24.81",
         "Price": "1.62", "Color": "YELLOW", "StockEtf": "stock", "Sector": "Materials",
         "ER": "", "Uoa": "", "Weekly": "", "source": "stocks",
         "MktCap": "2000000000", "ImpliedVolatility": "0.8"}
    r.update(over)
    return r


def test_row_to_alert_exempts_ask_accum_build_from_deep_otm_drop(monkeypatch):
    # 41% OTM vs spot, but a ~$1.21M ask build at 3.1x contract V/OI → conviction,
    # NOT a lottery. Survives noise filter 2 and classifies ask_accum end-to-end.
    monkeypatch.setattr(m, "_load_thresholds", lambda: dict(m.DEFAULT_THRESHOLDS))
    a = m._row_to_alert(_ppta_full_row(),
                        agg_ask_premium=1_210_952, agg_ask_volume=7277)
    assert a is not None and a["_tierKey"] == "ask_accum"
    assert a["aggAskPremium"] == 1_210_952


def test_row_to_alert_still_drops_deep_otm_lottery(monkeypatch):
    # SAME 41%-OTM contract but a lone thin print with NO session aggregate → the
    # retail lottery the filter exists to drop. Exemption must NOT rescue it.
    monkeypatch.setattr(m, "_load_thresholds", lambda: dict(m.DEFAULT_THRESHOLDS))
    a = m._row_to_alert(_ppta_full_row(Premium="8000", Volume="50"),
                        agg_ask_premium=0.0, agg_ask_volume=0.0)
    assert a is None


# ── Incremental path threads the aggregate (the LIVE-feed blocker) ──────────
# incremental_scan is ON in prod: the tape routes through _incr_classify, which
# cached _row_to_alert WITHOUT the ledgers AND keyed the cache on row bytes only.
# So ask_accum/alpha_leaps could never fire live, and a row cached as "not a build"
# early would never reclassify as its contract aggregate accrued. Both are fixed.

def test_incr_classify_threads_aggregate(monkeypatch):
    monkeypatch.setattr(m, "_load_thresholds", lambda: dict(m.DEFAULT_THRESHOLDS))
    m._incr_alert_cache_clear()
    a = m._incr_classify(_ppta_full_row(id=701),
                         agg_ask_premium=1_210_952, agg_ask_volume=7277)
    assert a is not None and a["_tierKey"] == "ask_accum"
    assert a["aggAskPremium"] == 1_210_952


def test_incr_classify_reclassifies_when_aggregate_crosses_floor(monkeypatch):
    # Same row bytes, aggregate accrues across the session: must NOT serve the
    # stale "under floor" classification once the build clears $1M.
    monkeypatch.setattr(m, "_load_thresholds", lambda: dict(m.DEFAULT_THRESHOLDS))
    m._incr_alert_cache_clear()
    row = _ppta_full_row(id=702)
    early = m._incr_classify(row, agg_ask_premium=500_000, agg_ask_volume=7277)
    assert early is None or early.get("_tierKey") != "ask_accum"   # under floor → dropped
    later = m._incr_classify(row, agg_ask_premium=1_210_952, agg_ask_volume=7277)
    assert later is not None and later["_tierKey"] == "ask_accum"  # cache reclassified


# ── Curated + auto-push: ask_accum BLOCK anchor survives hide_block_only ────
# The tape's default view is non-curated so PPTA shows there; the CURATED feed +
# Discord auto-push both run _qualifies_curated. PPTA's anchor is a BLOCK and its
# sweeps are blank-side, so with hide_block_only on and no sweep registered in
# contract_types the lone-block filter hid it — the last thing keeping the card
# from firing. The ask_accum own-path now runs BEFORE that filter.

def test_ask_accum_curated_survives_hide_block_only():
    a = {"_tierKey": "ask_accum", "_type": "BLOCK", "_direction": "Bull",
         "ticker": "PPTA", "cp": "C", "strike": "35", "exp": "1/15/2027"}
    th = {"hide_block_only": True, "hide_sizeless": True}
    assert m._qualifies_curated(a, th, contract_types={}) is True
    # a direction-unconfirmed aggregate is still rejected (never auto-fire that)
    assert m._qualifies_curated(dict(a, _directionUnconfirmed=True), th,
                                contract_types={}) is False


def test_alpha_leaps_curated_survives():
    # Alpha LEAPS is an AGGREGATE tier and must pass Curated — curated defaults ON in
    # the UI, and alpha_leaps had no own-path, so it fell through the `tier not in
    # (...)` reject and was DROPPED from the default view since the tier launched
    # (the IREN 65C 3/19/27 $7.07M build was invisible until this fix).
    a = {"_tierKey": "alpha_leaps", "_type": "SWEEP", "_direction": "Bull",
         "ticker": "IREN", "cp": "C", "strike": "65", "exp": "3/19/2027"}
    th = {"hide_block_only": True, "hide_sizeless": True}
    assert m._qualifies_curated(a, th, contract_types={}) is True
    assert m._qualifies_curated(dict(a, _directionUnconfirmed=True), th,
                                contract_types={}) is False


def test_ask_accum_grades_on_aggregate_not_anchor(monkeypatch):
    # The row must grade on the $1.21M / 7,277-vol BUILD, not the $484K anchor print
    # (which alone graded C). aggAskPremium carries the build for display.
    monkeypatch.setattr(m, "_load_thresholds", lambda: dict(m.DEFAULT_THRESHOLDS))
    a = m._row_to_alert(_ppta_full_row(), agg_ask_premium=1_210_952, agg_ask_volume=7277)
    assert a["_tierKey"] == "ask_accum"
    assert a["grade"][0] in ("A", "B")          # lifted off C by the aggregate
    assert a["aggAskPremium"] == 1_210_952       # the value the row displays
    # grading the anchor print alone (the old behaviour) would be strictly worse
    anchor = m._compute_conviction(premium=484532, oi=2321, volume=3000,
                                   tier_priority=m.TIER_PRIORITY["ask_accum"],
                                   moneyness_label="OTM", moneyness_pct=-29.1, is_leaps=False)
    assert anchor[1][0] == "C"                   # anchor-only would be C


def test_alpha_gold_beats_ask_accum(monkeypatch):
    # A $1M+ single ASK print (<180 DTE) is still Alpha Gold — Ask Accumulation
    # runs only AFTER Alpha declines the row.
    th = dict(_AATH, alpha_max_itm_pct=25.0, alpha_min_vol_oi_ratio=1.0,
              alpha_exclude_block_type=True, alpha_max_weekly_dte=7)
    monkeypatch.setattr(m, "_load_thresholds", lambda: th)
    monkeypatch.setattr(m, "_is_dormant_ticker", lambda *a, **k: True)
    r = _accrow(Premium="1200000", Volume="4000", OI="1500")
    name, tier, _ = m._derive_alert_name(
        r, "Bull", money_pct=2.0, agg_ask_premium=1_500_000)
    assert tier == "alpha"


def test_alpha_leaps_beats_ask_accum(monkeypatch):
    # A near-money LEAP over the $3M aggregate floor is still Alpha LEAPS even on
    # a dormant name — Alpha LEAPS is checked first.
    th = dict(_AATH, alpha_leaps_enabled=True,
              alpha_leaps_min_aggregate_premium=3_000_000,
              alpha_leaps_max_otm_pct=15.0)
    monkeypatch.setattr(m, "_load_thresholds", lambda: th)
    monkeypatch.setattr(m, "_is_dormant_ticker", lambda *a, **k: True)
    r = _accrow(Dte="493")
    name, tier, _ = m._derive_alert_name(
        r, "Bull", money_pct=-5.2, agg_ask_premium=12_010_000)
    assert tier == "alpha_leaps"


def test_qualifies_curated_ask_accum_path():
    # The curated gate (a second gate on every auto-pushed single print) trusts
    # the tier and passes a directional aggregate, rejects a direction-unconfirmed
    # one. Uses defaults so it doesn't depend on the file thresholds.
    base = m.DEFAULT_THRESHOLDS
    ok = {"_tierKey": "ask_accum", "alertPremium": 679900,
          "volumeOIRatio": 2.6, "grade": "B"}
    assert m._qualifies_curated(ok, base) is True
    bad = dict(ok, _directionUnconfirmed=True)
    assert m._qualifies_curated(bad, base) is False


def test_should_auto_push_ask_accum():
    cfg = dict(m._AUTO_PUSH_CFG, ask_accum=True)
    a = {"_tierKey": "ask_accum", "alertName": "UCT Ask Accumulation Bull",
         "source": "stocks", "grade": "B"}
    assert m.should_auto_push(a, cfg) is True
    assert m.should_auto_push(a, dict(cfg, ask_accum=False)) is False


# ── Clean-directional gate — drop contaminated bid-sells (2026-07-31) ────
# Session long-build ledger = cumulative ASK-side volume per contract. A
# bid-side SELL on a contract with meaningful prior ask-buying is a mix of
# writing + profit-taking → demoted to "UCT Size - Not Clean" so it leaves the
# directional tiers/curated. Clean writes + ask-side buys stay directional.
# See _build_session_long_ledger / _demote_contaminated_sell.

def _frow(rid, side, vol, sym="X", cp="CALL", strike=100, exp="8/1/2026"):
    return {"id": rid, "Symbol": sym, "CallPut": cp, "Strike": strike,
            "ExpirationDate": exp, "Side": side, "Volume": vol}


def test_long_ledger_total_ask_per_contract():
    # gross_ask = TOTAL ask-side volume on the contract (order-independent);
    # bids add 0, but every row (incl. bids) maps to the contract total.
    rows = [_frow(1, "A", 500), _frow(2, "BB", 300),
            _frow(3, "A", 200), _frow(4, "BB", 100)]
    g = m._build_session_long_ledger(rows)
    assert g[1] == 700       # 500 + 200 ask total (bids don't build a long)
    assert g[2] == 700       # a bid row maps to its contract's total ask
    assert g[4] == 700


def test_long_ledger_separates_contracts():
    rows = [_frow(3, "BB", 100, sym="AAA"),
            _frow(1, "A", 500, sym="AAA"),
            _frow(2, "A", 999, sym="BBB")]
    g = m._build_session_long_ledger(rows)
    assert g[3] == 500       # AAA's total ask only (not BBB's 999)
    assert g[1] == 500
    assert g[2] == 999       # BBB's own total


_GTH = {"close_detector_enabled": True, "close_min_long_frac": 0.5}


def _dalert(rid, side, vol, direction="Bear"):
    return {"id": rid, "_side": side, "tradeSize": vol, "_direction": direction,
            "alertName": "UCT Size Bears", "_tierKey": "bearish"}


def test_contaminated_sell_demoted_to_not_clean():
    a = _dalert(4, "BB", 10000)                    # sell 10K into 6K prior buying
    m._demote_contaminated_sell(a, {4: 6000.0}, _GTH)   # 6000 >= 10000×0.5
    assert a["_direction"] is None
    assert a["alertName"] == "UCT Size - Not Clean"
    assert a["_tierKey"] == "size"
    assert a["_directionUnconfirmed"] is True
    assert a["_closeExcluded"] is True
    assert a["_grossAskSession"] == 6000


def test_clean_write_no_prior_buying_kept():
    a = _dalert(4, "BB", 10000)                    # no prior ask-buying → clean write
    m._demote_contaminated_sell(a, {4: 0.0}, _GTH)
    assert a["_direction"] == "Bear"               # untouched
    assert a["_tierKey"] == "bearish"


def test_small_prior_buying_below_frac_kept():
    a = _dalert(4, "BB", 10000)                    # 2K prior < 0.5×10K = 5K
    m._demote_contaminated_sell(a, {4: 2000.0}, _GTH)
    assert a["_direction"] == "Bear"


def test_ask_side_never_demoted():
    a = _dalert(4, "A", 10000, direction="Bull")
    m._demote_contaminated_sell(a, {4: 9000.0}, _GTH)
    assert a["_direction"] == "Bull"


def test_clean_gate_disabled_is_noop():
    a = _dalert(4, "BB", 10000)
    m._demote_contaminated_sell(a, {4: 9000.0}, {"close_detector_enabled": False})
    assert a["_direction"] == "Bear"
