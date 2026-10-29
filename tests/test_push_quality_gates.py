"""Rails for the auto-push quality gates (2026-10-29):

  • ex-dividend play exclusion  — _is_dividend_play
  • push-time side fresh-confirm — _side_confirms / _relabel_unverified

Both run ONLY on the single-print auto-push path and never touch the feed or a
manual force-push. These tests pin the discriminators that the live validation
established (PAGP excluded, MRVL kept; COIN/META relabel on a stale/contradicting
consolidated NBBO) without any network — the vendor reads are monkeypatched.

Scoped run:  python -m pytest tests/test_push_quality_gates.py -q
"""
from datetime import datetime, timedelta

import api.live_massive_router as lmr


def _tomorrow_iso():
    return (datetime.now(lmr.ET).date() + timedelta(days=1)).isoformat()


def _in_days_iso(n):
    return (datetime.now(lmr.ET).date() + timedelta(days=n)).isoformat()


DIV_THR = {"dividend_excl_enabled": True, "dividend_excl_days": 3,
           "dividend_extrinsic_buffer": 1.15}
CONF_THR = {"side_confirm_enabled": True, "side_confirm_max_age_ms": 2000}


# ── pure helpers ──────────────────────────────────────────────────────────────

def test_exp_parts_formats():
    assert lmr._exp_parts("6/17/2027") == (6, 17, 2027)
    assert lmr._exp_parts("01-21-2028") == (1, 21, 2028)
    assert lmr._exp_parts("2027-02-19") == (2, 19, 2027)
    assert lmr._exp_parts("garbage") == (None, None, None)


def test_alert_occ():
    assert lmr._alert_occ({"ticker": "META", "cp": "C", "strike": 600, "exp": "6/17/2027"}) \
        == "O:META270617C00600000"
    assert lmr._alert_occ({"ticker": "COIN", "cp": "P", "strike": 130, "exp": "2/19/2027"}) \
        == "O:COIN270219P00130000"
    assert lmr._alert_occ({"ticker": "", "cp": "C", "strike": 1, "exp": "x"}) is None


def test_classify_side_px():
    assert lmr._classify_side_px(9.15, 8.6, 9.2) == "A"      # above mid
    assert lmr._classify_side_px(93.25, 92.75, 93.5) == "A"
    assert lmr._classify_side_px(9.15, 9.3, 9.5) == "BB"     # below bid
    assert lmr._classify_side_px(93.2, 93.0, 93.6) == "B"    # below mid, inside spread
    assert lmr._classify_side_px(5, 6, 5) == ""              # crossed/invalid


# ── ex-dividend play exclusion ────────────────────────────────────────────────

def _call(**kw):
    base = {"cp": "C", "moneynessLabel": "ITM", "ticker": "PAGP",
            "strike": 26.0, "spot": 28.84, "averageFillPrice": 2.95,
            "exp": "11-20-2026"}
    base.update(kw)
    return base


def test_dividend_play_pagp_excluded(monkeypatch):
    # PAGP $26C: extrinsic 0.11 < 0.4175 dividend, ex-div tomorrow, before expiry
    monkeypatch.setattr(lmr, "_next_ex_div",
                        lambda s: {"date": _tomorrow_iso(), "amount": 0.4175})
    monkeypatch.setattr(lmr, "_exp_parts", lambda e: (11, 20, 2099))  # expiry far future
    assert lmr._is_dividend_play(_call(), DIV_THR) is True


def test_dividend_play_mrvl_kept(monkeypatch):
    # ITM call, ex-div tomorrow, but real extrinsic (1.84) >> a tiny 0.06 dividend
    monkeypatch.setattr(lmr, "_next_ex_div",
                        lambda s: {"date": _tomorrow_iso(), "amount": 0.06})
    monkeypatch.setattr(lmr, "_exp_parts", lambda e: (11, 20, 2099))
    a = _call(ticker="MRVL", strike=245.0, spot=274.66, averageFillPrice=31.5)
    assert lmr._is_dividend_play(a, DIV_THR) is False


def test_dividend_play_otm_not_flagged(monkeypatch):
    called = {"n": 0}
    def _spy(_s):
        called["n"] += 1
        return {"date": _tomorrow_iso(), "amount": 1.0}
    monkeypatch.setattr(lmr, "_next_ex_div", _spy)
    assert lmr._is_dividend_play(_call(moneynessLabel="OTM"), DIV_THR) is False
    assert called["n"] == 0   # OTM never triggers the dividend lookup


def test_dividend_play_far_exdiv_kept(monkeypatch):
    monkeypatch.setattr(lmr, "_next_ex_div",
                        lambda s: {"date": _in_days_iso(10), "amount": 0.4175})
    monkeypatch.setattr(lmr, "_exp_parts", lambda e: (11, 20, 2099))
    assert lmr._is_dividend_play(_call(), DIV_THR) is False


def test_dividend_play_exdiv_after_expiry_kept(monkeypatch):
    # ex-div tomorrow but the option already expired yesterday => not a capture play
    monkeypatch.setattr(lmr, "_next_ex_div",
                        lambda s: {"date": _tomorrow_iso(), "amount": 0.4175})
    y = datetime.now(lmr.ET).date() - timedelta(days=1)
    monkeypatch.setattr(lmr, "_exp_parts", lambda e: (y.month, y.day, y.year))
    assert lmr._is_dividend_play(_call(), DIV_THR) is False


def test_dividend_play_disabled(monkeypatch):
    monkeypatch.setattr(lmr, "_next_ex_div",
                        lambda s: {"date": _tomorrow_iso(), "amount": 0.4175})
    assert lmr._is_dividend_play(_call(), {"dividend_excl_enabled": False}) is False


# ── side fresh-confirm ────────────────────────────────────────────────────────

def _dir_alert(**kw):
    base = {"ticker": "META", "cp": "C", "strike": 600, "exp": "6/17/2027",
            "averageFillPrice": 93.25, "_direction": "Bull"}
    base.update(kw)
    return base


def test_side_confirms_fresh_ask(monkeypatch):
    monkeypatch.setattr(lmr, "_consolidated_nbbo", lambda occ: (92.75, 93.5, 300.0))
    assert lmr._side_confirms(_dir_alert(), CONF_THR) is True


def test_side_confirms_stale_abstains(monkeypatch):
    monkeypatch.setattr(lmr, "_consolidated_nbbo", lambda occ: (92.75, 93.5, 5285.0))
    assert lmr._side_confirms(_dir_alert(), CONF_THR) is False


def test_side_confirms_contradicting_abstains(monkeypatch):
    # fresh quote, but fill below mid => bid-side => our ask push isn't confirmed
    monkeypatch.setattr(lmr, "_consolidated_nbbo", lambda occ: (93.3, 93.5, 100.0))
    assert lmr._side_confirms(_dir_alert(), CONF_THR) is False


def test_side_confirms_no_quote_abstains(monkeypatch):
    monkeypatch.setattr(lmr, "_consolidated_nbbo", lambda occ: None)
    assert lmr._side_confirms(_dir_alert(), CONF_THR) is False


def test_relabel_unverified_copies_and_neutralizes():
    a = _dir_alert()
    out = lmr._relabel_unverified(a)
    assert out is not a
    assert out["_direction"] is None
    assert out["_tierKey"] == "size"
    assert out["_directionUnconfirmed"] is True
    assert out["alertName"] == lmr._UNVERIFIED_NAME
    # original (feed row + dedup key) untouched
    assert a["_direction"] == "Bull"
    assert "alertName" not in a or a.get("alertName") != lmr._UNVERIFIED_NAME


# ── D2: aggregate-tier cards headline the build, not the triggering print ──────

def _leaps_alert(**kw):
    # CRWD 10/29: triggering print $570K/77, real build $12.87M/1,734, OI 5
    base = {"ticker": "CRWD", "cp": "C", "strike": 257.5, "exp": "1/21/2028",
            "dte": 449, "_direction": "Bull", "_tierKey": "alpha_leaps",
            "alertName": "UCT Alpha LEAPS Bull", "grade": "A+",
            "alertPremium": 569800, "tradeSize": 77, "priorOI": 5,
            "averageFillPrice": 74.0, "aggAskPremium": 12874515,
            "aggAskVolume": 1734, "spot": 258.46, "moneynessLabel": "ATM",
            "moneynessPct": 0.0, "timestamp": 1793293877}
    base.update(kw)
    return base


def test_card_aggregate_headlines_build():
    desc = lmr._build_massive_embed(_leaps_alert(), mode="single")["description"]
    assert "$12.87M ask build" in desc           # aggregate, not the $570K print
    assert "Volume (ask): 1,734" in desc         # aggregate volume, not 77
    assert "346" in desc                         # Vol/OI from agg_vol/oi, not 15.4x
    assert "570" not in desc and "77" not in desc


def test_card_unverified_relabel_still_shows_build():
    relbl = lmr._relabel_unverified(_leaps_alert())
    desc = lmr._build_massive_embed(relbl, mode="single")["description"]
    assert "$12.87M ask build" in desc           # neutral card keeps the build size
    assert "Volume (ask): 1,734" in desc


def test_card_plain_single_print_unchanged():
    a = {"ticker": "NVDA", "cp": "C", "strike": 205, "exp": "4/16/2027", "dte": 170,
         "_direction": "Bull", "_tierKey": "bullish", "alertName": "UCT Bullish",
         "grade": "B", "alertPremium": 1250000, "tradeSize": 200, "priorOI": 800,
         "averageFillPrice": 6.25, "aggAskPremium": 0, "aggAskVolume": 0,
         "spot": 210.0, "moneynessLabel": "ITM", "moneynessPct": 2.4,
         "timestamp": 1793293877}
    desc = lmr._build_massive_embed(a, mode="single")["description"]
    assert "$1.25M" in desc and "ask build" not in desc
    assert "Volume: 200" in desc


# ── directional one-sidedness ("Flow: X% one-sided (ask/bid)") ────────────────

def test_flow_split_call_bull_is_ask():
    flow = {"CRWD|C|257.5|1/21/2028": {"Bull": 8_100_000.0, "Bear": 500_000.0}}
    push = _leaps_alert()
    lmr._stamp_flow_split(push, _leaps_alert(), flow)
    assert push["_flowPct"] == 94
    assert push["_flowSide"] == "ask"
    assert push["_flowDom"] == 8_100_000.0 and push["_flowOther"] == 500_000.0


def test_flow_split_put_bought_is_ask():
    # a PUT bought (Bear) is ask-side buying
    flow = {"ARM|P|200|6/17/2027": {"Bull": 200_000.0, "Bear": 3_000_000.0}}
    p = {"ticker": "ARM", "cp": "P", "strike": 200, "exp": "6/17/2027", "_direction": "Bear"}
    lmr._stamp_flow_split(p, dict(p), flow)
    assert p["_flowSide"] == "ask" and p["_flowPct"] == 94


def test_flow_split_put_written_is_bid():
    # a PUT sold (Bull) is bid-side writing
    flow = {"PAGP|P|26|1/15/2027": {"Bull": 1_000_000.0, "Bear": 100_000.0}}
    p = {"ticker": "PAGP", "cp": "P", "strike": 26, "exp": "1/15/2027", "_direction": "Bull"}
    lmr._stamp_flow_split(p, dict(p), flow)
    assert p["_flowSide"] == "bid"


def test_flow_split_no_data_noops():
    push = _leaps_alert()
    lmr._stamp_flow_split(push, _leaps_alert(), {})      # no entry for this contract
    assert "_flowPct" not in push


def test_card_renders_flow_line():
    flow = {"CRWD|C|257.5|1/21/2028": {"Bull": 8_100_000.0, "Bear": 500_000.0}}
    push = _leaps_alert()
    lmr._stamp_flow_split(push, _leaps_alert(), flow)
    desc = lmr._build_massive_embed(push, mode="single")["description"]
    assert "📐 Flow: 94% one-sided (ask)" in desc
    assert "$8.10M vs $500K" in desc


def test_unverified_relabel_has_no_flow_line():
    # relabel is never stamped -> no Flow line on a neutral card
    desc = lmr._build_massive_embed(_relabel_helper(), mode="single")["description"]
    assert "Flow:" not in desc


def _relabel_helper():
    return lmr._relabel_unverified(_leaps_alert())
