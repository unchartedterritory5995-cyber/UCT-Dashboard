"""Regression tests for the Cream (EOD Top Flow) per-name contract cap.

The card used to collapse each ticker to its single biggest build, dropping a
name's genuine 2nd build (another strike/expiry, or the other side). `compute_cream`
now keys its dedup by CONTRACT and ranks each side with `_cream_rank_side`, which
keeps up to `max_per_ticker` contracts per name. These tests pin that pure ranker so
the behaviour is verified without a flow.db.
"""
from api.live_massive_router import (
    _cream_rank_side, _cream_row_direction, _cream_ck, _cream_meta_key,
)


def _row(sym, agg, direction="Bull", strike=0.0):
    return {"sym": sym, "_agg": float(agg), "_dir": direction, "strike": strike}


def test_second_build_on_a_name_survives_with_default_cap():
    rows = [
        _row("NVDA", 5_000_000, strike=200),
        _row("NVDA", 3_000_000, strike=210),   # the 2nd build the old card dropped
        _row("AMD", 2_000_000),
    ]
    out = _cream_rank_side(rows, "Bull", top_n=12, max_per_ticker=2)
    syms = [r["sym"] for r in out]
    assert syms.count("NVDA") == 2          # both NVDA builds present
    assert "AMD" in syms
    # ranked by aggregate ask premium, desc
    assert [r["_agg"] for r in out] == [5_000_000, 3_000_000, 2_000_000]


def test_cap_of_one_reproduces_the_old_one_row_per_ticker_card():
    rows = [
        _row("NVDA", 5_000_000, strike=200),
        _row("NVDA", 3_000_000, strike=210),
        _row("AMD", 2_000_000),
    ]
    out = _cream_rank_side(rows, "Bull", top_n=12, max_per_ticker=1)
    syms = [r["sym"] for r in out]
    assert syms.count("NVDA") == 1
    assert out[0]["_agg"] == 5_000_000       # keeps the biggest build for the name


def test_max_per_ticker_bounds_a_hyperactive_name():
    rows = [_row("HOOD", 9_000_000 - i, strike=50 + i) for i in range(5)]
    rows.append(_row("PLTR", 1_000_000))
    out = _cream_rank_side(rows, "Bull", top_n=12, max_per_ticker=2)
    syms = [r["sym"] for r in out]
    assert syms.count("HOOD") == 2           # capped, doesn't flood
    assert "PLTR" in syms


def test_top_n_is_applied_after_the_per_name_cap():
    rows = [_row(f"T{i}", 1_000_000 - i) for i in range(20)]
    out = _cream_rank_side(rows, "Bull", top_n=5, max_per_ticker=2)
    assert len(out) == 5


def test_only_the_requested_side_is_returned():
    rows = [
        _row("NVDA", 5_000_000, direction="Bull"),
        _row("SPY", 4_000_000, direction="Bear"),
    ]
    bull = _cream_rank_side(rows, "Bull", top_n=12, max_per_ticker=2)
    bear = _cream_rank_side(rows, "Bear", top_n=12, max_per_ticker=2)
    assert [r["sym"] for r in bull] == ["NVDA"]
    assert [r["sym"] for r in bear] == ["SPY"]


# ── size-tier direction recovery (_cream_row_direction) ──────────────────────
MIN = 1_000_000


def test_clean_aggregate_direction_wins_and_is_not_flagged():
    a = {"_direction": "Bull", "_tierKey": "alpha", "cp": "C", "aggAskPremium": 5e6}
    assert _cream_row_direction(a, MIN) == ("Bull", False)


def test_ask_confirmed_size_call_recovers_as_bull_flagged_unconfirmed():
    # STLD C150 $2.17M ask sweep, side left "Not Clean" by the per-print classifier.
    a = {"_direction": None, "_tierKey": "size", "cp": "C", "aggAskPremium": 2_168_952}
    assert _cream_row_direction(a, MIN) == ("Bull", True)


def test_ask_confirmed_size_put_recovers_as_bear_flagged_unconfirmed():
    # PANW P320 $3.28M ask.
    a = {"_direction": None, "_tierKey": "size", "cp": "P", "aggAskPremium": 3_283_500}
    assert _cream_row_direction(a, MIN) == ("Bear", True)


def test_bid_side_size_row_is_skipped():
    # ~0 ask premium (bid-side / two-sided) → ambiguous, dropped.
    a = {"_direction": None, "_tierKey": "size", "cp": "P", "aggAskPremium": 0.0}
    assert _cream_row_direction(a, MIN) == (None, False)


def test_size_row_below_ask_floor_is_skipped():
    a = {"_direction": None, "_tierKey": "size", "cp": "C", "aggAskPremium": 750_000}
    assert _cream_row_direction(a, MIN) == (None, False)


def test_unsided_row_in_a_non_size_tier_is_not_recovered():
    # Only the size tier gets side recovery; an unsided algo/other row stays dropped.
    a = {"_direction": "Unclear", "_tierKey": "algo", "cp": "C", "aggAskPremium": 9e6}
    assert _cream_row_direction(a, MIN) == (None, False)


# ── weekly/has-sweep lookup key parity (_cream_ck) ───────────────────────────
# The block-only + weekly filters missed silently (and fail OPEN) whenever the DB
# meta key and the alert key disagreed on strike ("300" vs "300.0") or side
# ("PUT" vs "P"). _cream_ck must collapse all those spellings to ONE key.

def test_db_and_alert_keys_match_for_an_integer_strike_put():
    db = _cream_ck("SNOW", "PUT", 300.0, "1/21/2028")     # raw flow.db row shape
    db_str = _cream_ck("SNOW", "P", "300.0", "1/21/2028")  # strike as text
    alert = _cream_meta_key({"ticker": "SNOW", "cp": "P",
                             "strike": 300.0, "exp": "1/21/2028"})
    assert db == db_str == alert


def test_db_and_alert_keys_match_for_a_half_strike_call():
    db = _cream_ck("SPCX", "CALL", 152.5, "9/18/2026")
    alert = _cream_meta_key({"ticker": "SPCX", "cp": "C",
                             "strike": 152.5, "exp": "9/18/2026"})
    assert db == alert


def test_side_is_read_from_the_first_letter_only():
    assert _cream_ck("X", "CALL", 1, "e")[1] == "C"
    assert _cream_ck("X", "C", 1, "e")[1] == "C"
    assert _cream_ck("X", "PUT", 1, "e")[1] == "P"
    assert _cream_ck("X", "P", 1, "e")[1] == "P"


# ── has_sweep sweep-premium floor (_cream_contract_meta) ─────────────────────
# The raw-Type sweep query catches real blank-side sweeps AND tiny sub-floor
# micro-sweeps. A $3.5M BLOCK with a $20K stray sweep must NOT read as sweep-backed;
# a real $3.2M sweep must.

def test_micro_sweep_does_not_make_a_block_sweep_backed(tmp_path, monkeypatch):
    import sqlite3
    from api import live_massive_router as lmr

    db = tmp_path / "flow.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE flow(Symbol,CallPut,Strike,ExpirationDate,"
                "Weekly,Type,Premium,source,CreatedDate)")
    con.executemany(
        "INSERT INTO flow VALUES(?,?,?,?,?,?,?,?,?)",
        [("SNOW", "P", 300.0, "1/21/2028", "F", "BLOCK", "3465000", "stocks", "9/14/2026"),
         ("SNOW", "P", 300.0, "1/21/2028", "F", "SWEEP", "20000", "stocks", "9/14/2026"),
         ("CRWD", "C", 240.0, "1/21/2028", "F", "BLOCK", "3060800", "stocks", "9/14/2026"),
         ("CRWD", "C", 240.0, "1/21/2028", "F", "SWEEP", "3208343", "stocks", "9/14/2026")])
    con.commit(); con.close()
    monkeypatch.setattr(lmr, "DB_PATH", str(db))

    meta = lmr._cream_contract_meta("9/14/2026", min_sweep_prem=100000)
    snow = meta[_cream_ck("SNOW", "P", 300.0, "1/21/2028")]
    crwd = meta[_cream_ck("CRWD", "C", 240.0, "1/21/2028")]
    assert snow[1] is False   # $20K sweep < $100K floor → NOT sweep-backed → excl_bo drops it
    assert crwd[1] is True     # $3.2M sweep clears the floor → kept

    # floor of 0 restores the old lenient behaviour (any sweep counts)
    lenient = lmr._cream_contract_meta("9/14/2026", min_sweep_prem=0)
    assert lenient[_cream_ck("SNOW", "P", 300.0, "1/21/2028")][1] is True
