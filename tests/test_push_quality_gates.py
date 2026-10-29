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
