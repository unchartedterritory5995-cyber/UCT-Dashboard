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


# Live-path thresholds (no timestamp on the alert => _side_confirms uses the live
# consolidated NBBO). Fill-path thresholds carry a timestamp on the alert.
FILL_THR = {"side_confirm_enabled": True, "side_confirm_use_fill_nbbo": True,
            "side_confirm_fill_lookback_ms": 2500, "side_confirm_ask_tol": 0.005}


def _fill_alert(**kw):
    # directional candidate WITH a fill timestamp -> fill-time confirm path
    base = {"ticker": "CBRS", "cp": "P", "strike": 100, "exp": "01-21-2028",
            "averageFillPrice": 32.30, "_direction": "Bear", "_side": "AA",
            "timestamp": 1_700_000_000.0}
    base.update(kw)
    return base


# ── LIVE path (no fill timestamp): confirm is now at-or-through-ask, not above-mid
def test_side_confirms_live_at_ask(monkeypatch):
    monkeypatch.setattr(lmr, "_consolidated_nbbo", lambda occ: (92.75, 93.5, 300.0))
    assert lmr._side_confirms(_dir_alert(averageFillPrice=93.5), CONF_THR) is True


def test_side_confirms_live_inside_spread_abstains(monkeypatch):
    # fresh quote, fill 93.25 inside 92.75/93.5 => ambiguous, no longer confirmed
    monkeypatch.setattr(lmr, "_consolidated_nbbo", lambda occ: (92.75, 93.5, 300.0))
    assert lmr._side_confirms(_dir_alert(averageFillPrice=93.25), CONF_THR) is False


def test_side_confirms_live_stale_abstains(monkeypatch):
    monkeypatch.setattr(lmr, "_consolidated_nbbo", lambda occ: (92.75, 93.5, 5285.0))
    assert lmr._side_confirms(_dir_alert(averageFillPrice=93.5), CONF_THR) is False


def test_side_confirms_no_quote_abstains(monkeypatch):
    monkeypatch.setattr(lmr, "_consolidated_nbbo", lambda occ: None)
    assert lmr._side_confirms(_dir_alert(), CONF_THR) is False


# ── FILL-TIME path: the CBRS case and its siblings
def test_side_confirms_fill_at_ask(monkeypatch):
    # clean at-ask lift against a FRESH book (<2.5s) => CONFIRM
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (31.10, 32.30, 800.0))
    assert lmr._side_confirms(_fill_alert(averageFillPrice=32.30), FILL_THR) is True


def test_side_confirms_fill_inside_spread_suppresses(monkeypatch):
    # the real CBRS print: $32.20 inside $31.10/$32.30 (10c under ask) => SUPPRESS
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (31.10, 32.30, 800.0))
    assert lmr._side_confirms(_fill_alert(averageFillPrice=32.20), FILL_THR) is False


def test_side_confirms_fill_stale_book_abstains(monkeypatch):
    # DASH 2026-11-04: a clean at-ask fill that WOULD have confirmed under the old
    # 30s window now abstains because the book is 6.8s stale (> 2.5s trust window).
    # A stale book on a thin LEAP is unreliable even for a clean-looking print.
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (31.10, 32.30, 6800.0))
    assert lmr._side_confirms(_fill_alert(averageFillPrice=32.30), FILL_THR) is False


def test_side_confirms_fill_stale_below_bid_not_bear(monkeypatch):
    # THE DASH regression: 500 @ 29.50 printed below a 29.70/30.00 book that was
    # 25s stale. Under the old 30s window this confirmed a BEAR off a dead quote;
    # with the 2.5s fresh guard it abstains (-> suppress), not a false bear card.
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (29.70, 30.00, 25000.0))
    assert lmr._side_confirms(_fill_alert(_side="BB", averageFillPrice=29.50), FILL_THR) is False
    # same below-bid print on a FRESH book still confirms bear (we only dropped the
    # stale-quote guesses, not genuine at/through-bid sells)
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (29.70, 30.00, 400.0))
    assert lmr._side_confirms(_fill_alert(_side="BB", averageFillPrice=29.50), FILL_THR) is True


def test_side_confirms_fill_bid_side(monkeypatch):
    # BB (sold into the bid): confirm only at/through the bid, on a FRESH book
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (31.10, 32.30, 100.0))
    assert lmr._side_confirms(_fill_alert(_side="BB", averageFillPrice=31.08), FILL_THR) is True
    assert lmr._side_confirms(_fill_alert(_side="BB", averageFillPrice=31.70), FILL_THR) is False


# ── Dark-pool-paired BLOCK = hedge, not a directional bet (PINS 2026-11-04) ──
DP_THR = {"block_darkpool_hedge_enabled": True, "block_dp_window_ms": 3000,
          "block_dp_min_shares": 50000, "block_darkpool_hedge_suppress": False}


def _block_alert(**kw):
    # a PUT BLOCK with a fill timestamp -> dark-pool pairing path
    base = {"ticker": "PINS", "cp": "P", "strike": 21, "exp": "02-19-2027",
            "averageFillPrice": 2.11, "_direction": "Bear", "_side": "A",
            "_type": "BLOCK", "timestamp": 1_700_000_000.0}
    base.update(kw)
    return base


def test_darkpool_paired_block_true(monkeypatch):
    # a 246k-share dark-pool (TRF exchange 9) print in the window => hedge
    monkeypatch.setattr(lmr, "_massive_rest",
                        lambda path, params, **kw: {"results": [{"size": 246000, "exchange": 9}]})
    assert lmr._darkpool_paired_block(_block_alert(), DP_THR) is True


def test_darkpool_paired_block_small_print_false(monkeypatch):
    # a dark-pool print, but below the share floor => not a block => no pairing
    monkeypatch.setattr(lmr, "_massive_rest",
                        lambda path, params, **kw: {"results": [{"size": 500, "exchange": 9}]})
    assert lmr._darkpool_paired_block(_block_alert(), DP_THR) is False


def test_darkpool_paired_block_lit_only_false(monkeypatch):
    # a large print but on a LIT exchange (not TRF 4/9, no trf_id) => not dark pool
    monkeypatch.setattr(lmr, "_massive_rest",
                        lambda path, params, **kw: {"results": [{"size": 246000, "exchange": 12}]})
    assert lmr._darkpool_paired_block(_block_alert(), DP_THR) is False


def test_darkpool_paired_block_trf_id_true(monkeypatch):
    # dark pool can also be marked by a trf_id rather than the exchange code
    monkeypatch.setattr(lmr, "_massive_rest",
                        lambda path, params, **kw: {"results": [{"size": 80000, "exchange": 11, "trf_id": 2}]})
    assert lmr._darkpool_paired_block(_block_alert(), DP_THR) is True


def test_darkpool_paired_block_rest_outage_fails_closed(monkeypatch):
    # REST returns nothing (outage) => False, so the normal directional path runs
    monkeypatch.setattr(lmr, "_massive_rest", lambda path, params, **kw: None)
    assert lmr._darkpool_paired_block(_block_alert(), DP_THR) is False


def test_relabel_dp_hedge_neutralizes():
    out = lmr._relabel_dp_hedge(_block_alert())
    assert out["_direction"] is None
    assert out["_dpHedge"] is True
    assert "Hedge Block" in out["alertName"]
    # original untouched
    assert _block_alert()["_direction"] == "Bear"


def test_block_darkpool_hedge_defaults_and_allowlisted():
    import inspect
    d = lmr.DEFAULT_THRESHOLDS
    assert d.get("block_darkpool_hedge_enabled") is True
    assert d.get("block_dp_window_ms") == 3000
    assert d.get("block_dp_min_shares") == 50000
    assert d.get("block_darkpool_hedge_suppress") is False
    src = inspect.getsource(lmr)
    for k in ("block_darkpool_hedge_enabled", "block_dp_window_ms",
              "block_dp_min_shares", "block_darkpool_hedge_suppress"):
        assert src.count(f'"{k}"') >= 2, k


def test_side_unconfirmed_suppress_default_on_and_allowlisted():
    # Owner directive 2026-11-02: unconfirmable directional candidates are
    # SUPPRESSED, not relabeled-and-pushed. The default must be True, and the key
    # MUST be in BOTH DEFAULT_THRESHOLDS and the /thresholds allow-list or a save
    # 400s the whole payload (CLAUDE.md gotcha).
    import inspect
    d = lmr.DEFAULT_THRESHOLDS
    assert d.get("side_unconfirmed_suppress") is True
    assert d.get("side_confirm_use_fill_nbbo") is True
    assert d.get("side_confirm_fill_lookback_ms") == 2500
    assert d.get("side_confirm_ask_tol") == 0.005
    # each key present in BOTH defaults and the /thresholds allow-list (module literals)
    src = inspect.getsource(lmr)
    for k in ("side_unconfirmed_suppress", "side_confirm_use_fill_nbbo",
              "side_confirm_fill_lookback_ms", "side_confirm_ask_tol"):
        assert src.count(f'"{k}"') >= 2, k


# ── REST side-recovery (2026-11-04) ──────────────────────────────────────────
# A big print's Side is written BLANK at ingest and only filled by the worker's
# NBBO re-pass once the Q-pool re-covers the contract — which can lag the 10-min
# auto-push window, so a genuine directional print (MU 700C 11/4: a $73.7M ask
# SWEEP) never fires. Resolve the side from the consolidated REST NBBO-at-fill
# NOW instead of waiting. Vendor read monkeypatched; today's prints only.

def _blank_row(**kw):
    base = {"Symbol": "MU", "CallPut": "CALL", "Strike": "700",
            "ExpirationDate": "1/15/2027", "Price": "143.95", "Side": "",
            "Type": "SWEEP", "CreatedDate": lmr._today_mdyyyy(),
            "CreatedTime": "3:29:29 PM", "Premium": "73684880"}
    base.update(kw)
    return base


def _full_row(**kw):
    base = {
        "id": 1, "Symbol": "MU", "CallPut": "CALL", "Strike": "700",
        "ExpirationDate": "1/15/2027", "Price": "143.95", "Side": "",
        "Type": "SWEEP", "Color": "YELLOW", "Premium": "73684880",
        "Volume": "5120", "OI": "4153", "Spot": "794.455", "Dte": "72",
        "CreatedDate": lmr._today_mdyyyy(), "CreatedTime": "3:29:29 PM",
        "Sector": "Technology", "MktCap": "250000000000", "Weekly": "0",
        "ER": "", "Uoa": "", "source": "stocks",
    }
    base.update(kw)
    return base


def test_rest_side_recover_at_ask(monkeypatch):
    lmr._RS_MEMO.clear()
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (140.0, 143.95, 47.0))
    assert lmr._rest_side_recover(_blank_row(), lmr.DEFAULT_THRESHOLDS) == "A"


def test_rest_side_recover_at_bid(monkeypatch):
    # a genuine at-bid sell (price <= bid) recovers as BB — a sold call is Bear,
    # NOT neutral; recovery must not just presume ask.
    lmr._RS_MEMO.clear()
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (140.0, 143.95, 47.0))
    assert lmr._rest_side_recover(_blank_row(Price="140.0"), lmr.DEFAULT_THRESHOLDS) == "BB"


def test_rest_side_recover_inside_spread_none(monkeypatch):
    lmr._RS_MEMO.clear()
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (140.0, 143.95, 47.0))
    assert lmr._rest_side_recover(_blank_row(Price="142.0"), lmr.DEFAULT_THRESHOLDS) is None


def test_rest_side_recover_stale_none(monkeypatch):
    # pre-fill quote older than rest_side_recover_max_age_ms (2500) -> abstain,
    # same freshness principle as side-confirm (don't classify off a stale book).
    lmr._RS_MEMO.clear()
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (140.0, 143.95, 6800.0))
    assert lmr._rest_side_recover(_blank_row(), lmr.DEFAULT_THRESHOLDS) is None


def test_rest_side_recover_no_quote_none(monkeypatch):
    lmr._RS_MEMO.clear()
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: None)
    assert lmr._rest_side_recover(_blank_row(), lmr.DEFAULT_THRESHOLDS) is None


def test_rest_side_recover_memoized(monkeypatch):
    lmr._RS_MEMO.clear()
    calls = {"n": 0}

    def _spy(occ, ts):
        calls["n"] += 1
        return (140.0, 143.95, 47.0)

    monkeypatch.setattr(lmr, "_nbbo_at", _spy)
    r = _blank_row()
    assert lmr._rest_side_recover(r, lmr.DEFAULT_THRESHOLDS) == "A"
    assert lmr._rest_side_recover(r, lmr.DEFAULT_THRESHOLDS) == "A"
    assert calls["n"] == 1   # second call served from _RS_MEMO, no re-fetch


def test_rest_side_recover_bad_row_none(monkeypatch):
    lmr._RS_MEMO.clear()
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (140.0, 143.95, 47.0))
    assert lmr._rest_side_recover(_blank_row(ExpirationDate=""), lmr.DEFAULT_THRESHOLDS) is None
    assert lmr._rest_side_recover(_blank_row(Price="0"), lmr.DEFAULT_THRESHOLDS) is None


def test_rest_side_recover_defaults_and_allowlisted():
    import inspect
    d = lmr.DEFAULT_THRESHOLDS
    assert d.get("rest_side_recover_enabled") is True
    assert d.get("rest_side_recover_min_premium") == 1000000
    assert d.get("rest_side_recover_max_age_ms") == 2500
    src = inspect.getsource(lmr)
    for k in ("rest_side_recover_enabled", "rest_side_recover_min_premium",
              "rest_side_recover_max_age_ms"):
        assert src.count(f'"{k}"') >= 2, k   # in DEFAULT_THRESHOLDS AND the allow-list


def test_row_to_alert_recovers_blank_side_today(monkeypatch):
    # end-to-end: a blank-Side, today, $73.7M ask SWEEP comes out directional Bull
    # with _side='A' — so it counts in the net-flow split and tiers normally,
    # in-window, instead of waiting for the re-pass.
    lmr._RS_MEMO.clear()
    monkeypatch.setattr(lmr, "_load_thresholds", lambda: dict(lmr.DEFAULT_THRESHOLDS))
    monkeypatch.setattr(lmr, "_nbbo_at", lambda occ, ts: (140.0, 143.95, 47.0))
    a = lmr._row_to_alert(_full_row())
    assert a is not None
    assert a["_side"] == "A"
    assert a["_direction"] == "Bull"
    assert a["_directionUnconfirmed"] is False


def test_row_to_alert_recovery_gated_to_today(monkeypatch):
    # a prior-day blank print must NOT trigger a REST call (no history storm).
    lmr._RS_MEMO.clear()
    monkeypatch.setattr(lmr, "_load_thresholds", lambda: dict(lmr.DEFAULT_THRESHOLDS))
    calls = {"n": 0}

    def _spy(occ, ts):
        calls["n"] += 1
        return (140.0, 143.95, 47.0)

    monkeypatch.setattr(lmr, "_nbbo_at", _spy)
    lmr._row_to_alert(_full_row(CreatedDate="1/2/2020"))
    assert calls["n"] == 0


def test_row_to_alert_recovery_gated_by_premium(monkeypatch):
    # below rest_side_recover_min_premium, a blank print is NOT REST-resolved.
    lmr._RS_MEMO.clear()
    monkeypatch.setattr(lmr, "_load_thresholds", lambda: dict(lmr.DEFAULT_THRESHOLDS))
    calls = {"n": 0}

    def _spy(occ, ts):
        calls["n"] += 1
        return (140.0, 143.95, 47.0)

    monkeypatch.setattr(lmr, "_nbbo_at", _spy)
    lmr._row_to_alert(_full_row(Premium="50000", Volume="3"))
    assert calls["n"] == 0


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


def test_card_renders_flow_bar_default():
    # default on: a colored ANSI bar (green bull fill) + the dollars line
    flow = {"CRWD|C|257.5|1/21/2028": {"Bull": 8_100_000.0, "Bear": 500_000.0}}
    push = _leaps_alert()
    lmr._stamp_flow_split(push, _leaps_alert(), flow)
    desc = lmr._build_massive_embed(push, mode="single")["description"]
    assert "```ansi" in desc                 # colored bar block present
    assert "\x1b[0;32m" in desc               # green = bullish fill
    assert "94%" in desc and "ask" in desc    # percent + side label on the bar
    assert "$8.10M vs $500K" in desc          # dollars retained beneath the bar


def test_flow_bar_bear_is_red_with_amber_tail():
    # a less-than-100% bearish card: red dominant fill + amber opposing share
    flow = {"ARM|P|200|6/17/2027": {"Bull": 200_000.0, "Bear": 3_000_000.0}}
    p = {"ticker": "ARM", "cp": "P", "strike": 200, "exp": "6/17/2027", "dte": 200,
         "_direction": "Bear", "_tierKey": "bearish", "alertName": "UCT Bearish",
         "grade": "B", "alertPremium": 3_000_000, "tradeSize": 100, "priorOI": 50,
         "averageFillPrice": 20.0, "aggAskPremium": 0, "aggAskVolume": 0,
         "spot": 195.0, "moneynessLabel": "OTM", "moneynessPct": 2.5,
         "timestamp": 1793293877}
    lmr._stamp_flow_split(p, dict(p), flow)
    desc = lmr._build_massive_embed(p, mode="single")["description"]
    assert "\x1b[0;31m" in desc               # red = bearish fill
    assert "\x1b[0;33m" in desc               # amber = opposing side (94% -> 6% tail)


def test_flow_bar_100pct_all_dominant_no_amber():
    p = {"ticker": "MSTR", "cp": "C", "strike": 131, "exp": "11/6/2026",
         "_direction": "Bull", "_flowPct": 100, "_flowSide": "ask",
         "_flowDom": 72_000.0, "_flowOther": 0.0}
    bar = lmr._flow_bar_block(p)
    assert bar.count("█") == lmr._FLOW_BAR_CELLS   # every cell filled
    assert "\x1b[0;33m" not in bar                      # no amber at 100%
    assert "\x1b[0;32m" in bar and "100%" in bar


def test_flow_bar_disabled_falls_back_to_text(monkeypatch):
    monkeypatch.setattr(lmr, "_load_thresholds", lambda: {"flow_bar_enabled": False})
    flow = {"CRWD|C|257.5|1/21/2028": {"Bull": 8_100_000.0, "Bear": 500_000.0}}
    push = _leaps_alert()
    lmr._stamp_flow_split(push, _leaps_alert(), flow)
    desc = lmr._build_massive_embed(push, mode="single")["description"]
    assert "```ansi" not in desc
    assert "📐 Flow: 94% one-sided (ask)" in desc
    assert "$8.10M vs $500K" in desc


def test_flow_bar_no_stamp_renders_nothing():
    assert lmr._flow_bar_block({"_direction": "Bull"}) == ""   # no _flowPct


def test_unverified_relabel_has_no_flow_line():
    # relabel is never stamped -> no Flow bar/line on a neutral card
    desc = lmr._build_massive_embed(_relabel_helper(), mode="single")["description"]
    assert "Flow" not in desc
    assert "```ansi" not in desc


def _relabel_helper():
    return lmr._relabel_unverified(_leaps_alert())
