"""Tests for api.flow_curation — the Python port of the OptionsFlow.jsx
curation pipeline.

Every fixture is hand-built.  Rows are passed NEWEST-FIRST (a higher index is
EARLIER in time), matching the BBS CSV order the page consumes.
"""

from datetime import date

import pytest

from api.flow_curation import (
    _js_max,
    _js_min,
    auto_score,
    cap_band,
    cluster_key,
    compute_dte,
    curate,
    detect_patterns,
    format_exp,
    grade_cluster,
    js_num,
    js_parse_float,
    js_parse_int,
    js_round,
    parse_expiry,
    premium_filter,
    sort_rows_newest_first,
    tracker_key,
)

TODAY = date(2026, 5, 1)


def _row(**kw):
    """A flow.db-shaped row (every column TEXT) that survives the pipeline."""
    base = {
        "CreatedDate": "5/1/2026", "CreatedTime": "10:00:00 AM",
        "Symbol": "AAA", "Type": "SWEEP", "Volume": "1000", "Price": "1.00",
        "Side": "A", "CallPut": "CALL", "Strike": "200", "Spot": "190",
        "Premium": "1000000", "ExpirationDate": "6/20/2026", "Color": "YELLOW",
        "ImpliedVolatility": "0", "Dte": "60", "ER": "F", "StockEtf": "STOCK",
        "Sector": "Tech", "Uoa": "F", "MktCap": "5000000000", "OI": "500",
    }
    base.update(kw)
    return base


def _only(res):
    assert len(res["clusters"]) == 1, res["clusters"]
    return res["clusters"][0]


# ─── Key-format contract (PITFALL #2) ────────────────────────────────────────

def test_js_num_drops_trailing_zero_on_integral_floats():
    assert js_num(200.0) == "200"
    assert js_num(200) == "200"
    assert js_num(0.0) == "0"
    assert js_num(-0.0) == "0"
    assert js_num(207.5) == "207.5"
    assert js_num(1e21) == "1e+21"


def test_cluster_key_is_js_stringified_not_float_repr():
    assert cluster_key("AAPL", "C", 200.0, "6/20") == "AAPL|C|200|6/20"
    assert cluster_key("AAPL", "C", 207.5, "6/20") == "AAPL|C|207.5|6/20"


def test_tracker_key_matches_top_flow_picks_format():
    # Deliberately DIFFERENT from cluster_key: float(strike) => "200.0".
    assert tracker_key("aapl", "c", "200", "6/20/2026") == "AAPL|C|200.0|6/20/2026"


def test_pipeline_emits_both_key_flavours():
    c = _only(curate([_row(Strike="200")], today=TODAY))
    assert c["key"] == "AAA|C|200|6/20"
    assert c["tracker_key"] == "AAA|C|200.0|6/20"


# ─── Messy TEXT coercion (PITFALL #3) ────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("", None), ("N/A", None), ("-", None), (None, None),
    ("1234", 1234.0), ("1,234", 1.0), ("  42.5 ", 42.5), ("12abc", 12.0),
])
def test_js_parse_float_never_raises(raw, expected):
    got = js_parse_float(raw)
    if expected is None:
        assert got != got  # NaN
    else:
        assert got == expected


@pytest.mark.parametrize("raw,expected", [
    ("", None), ("N/A", None), ("-", None), ("7.9", 7.0), ("1,234", 1.0),
])
def test_js_parse_int_never_raises(raw, expected):
    got = js_parse_int(raw)
    if expected is None:
        assert got != got
    else:
        assert got == expected


def test_pipeline_survives_bbs_dirty_text():
    c = _only(curate([_row(
        Premium="$1,234,567.89", Volume="1,234", OI="1,500",
        MktCap="", ImpliedVolatility="N/A", Spot="-", Price="",
    )], today=TODAY))
    assert c["prem"] == pytest.approx(1234567.89)
    assert c["vol"] == 1234
    assert c["max_oi"] == 1500
    assert c["mktcap"] == 0
    assert c["cap_band"] == "Unknown"


# ─── Half-up rounding boundary (PITFALL #1) ──────────────────────────────────

@pytest.mark.parametrize("x,expected", [
    (0.5, 1), (1.5, 2), (2.5, 3), (3.5, 4), (-1.5, -1), (-2.5, -2), (2.4, 2),
])
def test_js_round_is_half_up_not_bankers(x, expected):
    assert js_round(x) == expected


def test_js_round_disagrees_with_python_round_at_ties():
    # This is the whole point: round(2.5) == 2 in Python, 3 in JS.
    assert js_round(2.5) != round(2.5)
    assert js_round(0.5) != round(0.5)


def test_detect_patterns_uses_half_up_rounding():
    # spotRange = 5/200 = 0.025 -> *100 = 2.5 -> half-up 3, banker's 2.
    assert 5 / 200 * 100 == 2.5
    p = detect_patterns({
        "ivs": [1.0, 1.6, 1.6], "spots": [200, 205, 205],
        "sideTimes": [], "prices": [], "hits": 0,
    })
    assert p == [{"type": "IV_SURGE", "ivChange": 60, "spotRange": 3}]


# ─── Empty-min case (PITFALL #4) ─────────────────────────────────────────────

def test_empty_spread_min_max_are_infinities_not_exceptions():
    assert _js_min([]) == float("inf")
    assert _js_max([]) == float("-inf")
    assert _js_min([3, 1, 2]) == 1


def test_cluster_with_no_iv_data_does_not_raise():
    # bidIVs/askIVs empty -> the guarded ternaries in the dirty-cluster block.
    res = curate([_row(ImpliedVolatility="0"), _row(Side="B", ImpliedVolatility="")],
                 today=TODAY)
    assert isinstance(res["clusters"], list)


# ─── Grades ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("flags,expected", [
    (dict(hasSweep=True, hasBlock=True, clean=True, oiExceeded=True), "A+"),
    (dict(hasSweep=True, hasBlock=True, clean=True, oiExceeded=False), "A"),
    (dict(hasSweep=True, hasBlock=False, clean=True, oiExceeded=True), "A"),
    (dict(hasSweep=True, hasBlock=False, clean=True, oiExceeded=False), "B+"),
    (dict(hasSweep=True, hasBlock=True, clean=False, oiExceeded=False), "B"),
    (dict(hasSweep=True, hasBlock=False, clean=False, oiExceeded=False), "C"),
    (dict(hasSweep=False, hasBlock=True, clean=True, oiExceeded=True), "C"),
    (dict(hasSweep=False, hasBlock=False, clean=True, oiExceeded=True), "D"),
])
def test_grade_cluster_all_grades(flags, expected):
    assert grade_cluster(flags) == expected


def test_pipeline_grade_a_plus_needs_sweep_and_block():
    sweep_only = _only(curate([_row()], today=TODAY))
    assert sweep_only["grade"] == "A"
    both = _only(curate([_row(), _row(Type="BLOCK", CreatedTime="10:01:00 AM")],
                        today=TODAY))
    assert both["grade"] == "A+"


# ─── Cap bands ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("mktcap,expected", [
    (0, "Unknown"), (-5, "Unknown"), (5e9, "Mid-Small"), (10e9, "Large"),
    (499e9, "Large"), (500e9, "Mega"), (3e12, "Mega"),
])
def test_cap_band(mktcap, expected):
    assert cap_band(mktcap) == expected


@pytest.mark.parametrize("mktcap,expected", [
    ("600000000000", "Mega"), ("20000000000", "Large"),
    ("5000000000", "Mid-Small"), ("0", "Unknown"),
])
def test_pipeline_cap_band(mktcap, expected):
    c = _only(curate([_row(MktCap=mktcap)], today=TODAY))
    assert c["cap_band"] == expected


def test_premium_filter_only_gates_mega_caps():
    assert premium_filter(1_000, 5e9) is True
    assert premium_filter(1_000, 600e9) is False
    assert premium_filter(100_000, 600e9) is True
    # A $50K mega-cap print never reaches a cluster.
    assert curate([_row(MktCap="600000000000", Premium="50000")],
                  today=TODAY)["clusters"] == []


# ─── Dates (PITFALL #10 — injected `today`, never the clock) ─────────────────

def test_parse_expiry_three_part_and_two_digit_year():
    assert parse_expiry("6/20/2026", today=TODAY) == date(2026, 6, 20)
    assert parse_expiry("5/21/27", today=TODAY) == date(2027, 5, 21)


def test_parse_expiry_two_part_rolls_forward_including_today():
    assert parse_expiry("6/20", today=TODAY) == date(2026, 6, 20)
    assert parse_expiry("4/20", today=TODAY) == date(2027, 4, 20)
    # M/D == today is already past (midnight < now in JS) -> next year.
    assert parse_expiry("5/1", today=TODAY) == date(2027, 5, 1)


def test_compute_and_format_exp():
    assert compute_dte(date(2026, 6, 20), today=TODAY) == 50
    assert compute_dte(None, today=TODAY) == -1
    assert format_exp(date(2026, 6, 20), today=TODAY) == "6/20"
    assert format_exp(date(2027, 5, 21), today=TODAY) == "5/21/27"


def test_curate_is_reproducible_across_today_values():
    rows = [_row()]
    a = curate(rows, today=TODAY)
    b = curate(rows, today=TODAY)
    assert a["clusters"] == b["clusters"]


# ─── DTE precedence (PITFALL #5) + first-row DTE (PITFALL #6) ────────────────

def test_csv_dte_column_wins_over_expiry_derived():
    # Expiry says 50 DTE; the CSV column says 45.  The CSV column WINS.
    # (flow_summary.py does the opposite — do not copy it.)
    c = _only(curate([_row(Dte="45", ExpirationDate="6/20/2026")], today=TODAY))
    assert c["dte"] == 45


def test_dte_falls_back_to_expiry_when_column_unparseable():
    for bad in ("", "N/A", "-1"):
        c = _only(curate([_row(Dte=bad, ExpirationDate="6/20/2026")], today=TODAY))
        assert c["dte"] == 50, bad


def test_cluster_dte_is_first_row_seen_not_min_or_max():
    rows = [_row(Dte="60"), _row(Dte="30", CreatedTime="9:00:00 AM")]
    c = _only(curate(rows, today=TODAY))
    assert c["dte"] == 60
    # Reversing row order changes the cluster DTE — it is positional, not an
    # aggregate.  (min would be 30 and max 60 in BOTH orders.)
    c2 = _only(curate(list(reversed(rows)), today=TODAY))
    assert c2["dte"] == 30


def test_lottery_filter_uses_live_expiry_dte_not_the_csv_column():
    # Mega cap, 15% OTM, expiry 3 days out but the CSV claims Dte=60.
    # The lottery filter reads the EXPIRY-derived DTE, so direction is killed.
    rows = [_row(MktCap="600000000000", Dte="60", ExpirationDate="5/4/2026",
                 Strike="230", Spot="200", Premium="2000000")]
    assert curate(rows, today=TODAY)["clusters"] == []


# ─── Dirty-cluster exceptions (PITFALL #7 — newest-first ordering) ───────────

def _mixed(ask_iv, bid_iv, *, ask_prem="1000000", bid_prem="1000000",
           dte="60", bid_side="B", bid_type="SWEEP"):
    """[newest ... oldest] with the ASK print NEWEST and the BID print OLDEST."""
    return [
        _row(Side="A", ImpliedVolatility=ask_iv, Premium=ask_prem, Dte=dte,
             CreatedTime="11:00:00 AM"),
        _row(Side=bid_side, Type=bid_type, ImpliedVolatility=bid_iv,
             Premium=bid_prem, Dte=dte, Color="WHITE", CreatedTime="10:00:00 AM"),
    ]


def test_exception_1_profit_taking_ask_first_then_bb_sweep_short_dte():
    # Short DTE, ASK earlier (higher index), BB SWEEP later (index 0).
    rows = [
        _row(Side="BB", Type="SWEEP", Dte="10", Color="WHITE",
             CreatedTime="2:00:00 PM"),
        _row(Side="A", Dte="10", CreatedTime="10:00:00 AM"),
    ]
    assert len(curate(rows, today=TODAY)["clusters"]) == 1
    # Flip to ascending time and the exception no longer applies -> dirty.
    assert curate(list(reversed(rows)), today=TODAY)["clusters"] == []


def test_exception_2_escalation_bid_first_then_ask_with_non_falling_iv():
    rows = _mixed(ask_iv="50", bid_iv="50")
    assert len(curate(rows, today=TODAY)["clusters"]) == 1


def test_exception_2_inverts_if_rows_are_not_newest_first():
    # PITFALL #7: same rows, ascending time. Escalation no longer fires and
    # de-escalation needs a STRICTLY falling IV, so the cluster goes dirty.
    rows = _mixed(ask_iv="50", bid_iv="50")
    assert curate(list(reversed(rows)), today=TODAY)["clusters"] == []


def test_exception_3_de_escalation_ask_first_then_bid_with_falling_iv():
    # ASK earlier (index 1, IV 60) -> BID later (index 0, IV 40).
    rows = [
        _row(Side="B", ImpliedVolatility="40", Color="WHITE",
             CreatedTime="2:00:00 PM"),
        _row(Side="A", ImpliedVolatility="60", CreatedTime="10:00:00 AM"),
    ]
    assert len(curate(rows, today=TODAY)["clusters"]) == 1


def test_exception_4_premium_dominance_threshold_is_070_not_085():
    # 0.75 ask share: dirty under an 0.85 threshold, clean under the real 0.70.
    rows = _mixed(ask_iv="0", bid_iv="0", ask_prem="3000000", bid_prem="1000000")
    assert len(curate(rows, today=TODAY)["clusters"]) == 1
    # 50/50 -> no dominant side -> dirty.
    rows = _mixed(ask_iv="0", bid_iv="0", ask_prem="1000000", bid_prem="1000000")
    assert curate(rows, today=TODAY)["clusters"] == []


def test_short_dte_with_any_bid_side_is_always_dirty():
    rows = _mixed(ask_iv="0", bid_iv="0", dte="2", ask_prem="9000000",
                  bid_prem="1000")
    assert curate(rows, today=TODAY)["clusters"] == []


def test_block_only_cluster_needs_a_big_clean_ask_block():
    small = [_row(Type="BLOCK", Premium="400000")]
    assert curate(small, today=TODAY)["clusters"] == []
    big = [_row(Type="BLOCK", Premium="600000")]
    assert len(curate(big, today=TODAY)["clusters"]) == 1


# ─── 80% dominance override (exact float comparison, PITFALL #8) ─────────────

def test_dominant_direction_override_at_exactly_80_percent():
    # 8M bull / 2M bear = exactly 0.8 -> override fires, cluster is clean BULL.
    rows = [
        _row(Side="A", Premium="8000000", Dte="60"),
        _row(Side="BB", Type="SWEEP", Premium="2000000", Dte="60"),
    ]
    res = curate(rows, today=TODAY)
    assert len(res["clusters"]) == 1
    assert res["clusters"][0]["dir"] == "BULL"
    assert res["clusters"][0]["clean"] is True


# ─── autoScore ───────────────────────────────────────────────────────────────

def test_auto_score_hand_computed():
    c = {"grade": "A+", "hits": 1, "volOI": 2.0, "prem": 1_000_000,
         "mktcap": 5e9, "side": "AA", "uoa": False, "DTE": 60, "_timeConc": 0}
    # 2.5 grade + 1.5 single(p>=500K) + 1.5 prem(>=500K) + 1.0 v(>=2)
    # + 1.5 side(AA) = 8.0 ; premMult 1 ; 8.0/1.25*10 = 64 -> 6.4
    assert auto_score(c) == 6.4


def test_auto_score_premium_multiplier_penalises_sub_notable():
    c = {"grade": "A+", "hits": 1, "volOI": 2.0, "prem": 200_000,
         "mktcap": 5e9, "side": "AA", "uoa": False, "DTE": 60, "_timeConc": 0}
    # 2.5 + 0.5 + 1.0 + 1.0 + 1.5 = 6.5, Mid-Small <250K -> x0.4 = 2.6 -> 20.8 -> 2.1
    assert auto_score(c) == 2.1


def test_auto_score_is_capped_at_ten():
    c = {"grade": "A+", "hits": 60, "volOI": 40, "prem": 50_000_000,
         "mktcap": 5e9, "side": "AA", "uoa": True, "DTE": 400, "_timeConc": 9}
    assert auto_score(c) == 10


# ─── Watchlist (wlPopulate) ──────────────────────────────────────────────────

def _pick(sym, prem, strike="200"):
    return _row(Symbol=sym, Premium=prem, Strike=strike)


def test_watchlist_splits_by_direction():
    rows = [_pick("BUL", "2000000"),
            _row(Symbol="BEA", CallPut="PUT", Side="A", Strike="150",
                 Spot="190", Premium="2000000")]
    res = curate(rows, today=TODAY)
    assert [c["sym"] for c in res["watchlist_bull"]] == ["BUL"]
    assert [c["sym"] for c in res["watchlist_bear"]] == ["BEA"]


def test_watchlist_is_one_contract_per_ticker_highest_ranked():
    rows = [_pick("AAA", "5000000", strike="200"),
            _pick("AAA", "150000", strike="210"),
            _pick("BBB", "3000000", strike="300")]
    wl = curate(rows, today=TODAY)["watchlist_bull"]
    assert [c["sym"] for c in wl] == ["AAA", "BBB"]
    assert wl[0]["strike"] == 200


def test_watchlist_caps_at_twenty_per_direction():
    rows = [_pick(f"T{i:02d}", str(1_000_000 + i * 1000)) for i in range(25)]
    wl = curate(rows, today=TODAY)["watchlist_bull"]
    assert len(wl) == 20
    assert len({c["sym"] for c in wl}) == 20


def test_watchlist_ranked_by_auto_score_descending():
    rows = [_pick("SMALL", "300000"), _pick("BIG", "8000000")]
    wl = curate(rows, today=TODAY)["watchlist_bull"]
    assert [c["sym"] for c in wl] == ["BIG", "SMALL"]
    assert wl[0]["auto_score"] >= wl[1]["auto_score"]


def test_exit_penalty_applies_when_pick_history_shows_oi_unwind():
    # OI collapsed 100 -> 50 (-50%) and vol/maxOI < 0.3 -> _isExit, rank x0.4.
    rows = [_pick("EXIT", "3000000"), _pick("HOLD", "2000000", strike="300")]
    hist = {tracker_key("EXIT", "C", 200, "6/20"): [{"oi": 1000}, {"oi": 400}]}
    plain = curate(rows, today=TODAY)["watchlist_bull"]
    assert [c["sym"] for c in plain] == ["EXIT", "HOLD"]
    penalised = curate(rows, today=TODAY, pick_history=hist)["watchlist_bull"]
    assert [c["sym"] for c in penalised] == ["HOLD", "EXIT"]
    assert penalised[1]["is_exit"] is True


def test_accumulation_overrides_the_exit_penalty():
    # vol/maxOI = 1000/500 = 2.0 >= 0.3 -> fresh accumulation, no exit flag.
    rows = [_pick("EXIT", "3000000")]
    hist = {tracker_key("EXIT", "C", 200, "6/20"): [{"oi": 1000}, {"oi": 400}]}
    wl = curate(rows, today=TODAY, pick_history=hist)["watchlist_bull"]
    assert wl[0]["is_exit"] is False


# ─── Cluster shape ───────────────────────────────────────────────────────────

def test_cluster_carries_every_documented_field():
    c = _only(curate([_row(Uoa="T", ER="T")], today=TODAY))
    for field in ("sym", "cp", "strike", "exp", "dte", "dir", "grade",
                  "auto_score", "score", "hits", "prem", "ask_prem", "bid_prem",
                  "max_oi", "vol_oi", "side", "uoa", "er", "sector", "mktcap",
                  "cap_band", "clean", "oi_exceeded", "is_exit", "patterns"):
        assert field in c, field
    assert c["sym"] == "AAA" and c["cp"] == "C" and c["strike"] == 200
    assert c["exp"] == "6/20" and c["side"] == "ASK"
    assert c["uoa"] is True and c["er"] is True and c["sector"] == "Tech"
    assert c["vol_oi"] == pytest.approx(1000 / 500)


# ─── Row ordering helper ─────────────────────────────────────────────────────

def test_sort_rows_newest_first():
    rows = [
        _row(Symbol="OLD", CreatedDate="4/30/2026", CreatedTime="3:00:00 PM"),
        _row(Symbol="NEW", CreatedDate="5/1/2026", CreatedTime="9:00:00 AM"),
        _row(Symbol="NEWEST", CreatedDate="5/1/2026", CreatedTime="3:00:00 PM"),
    ]
    got = [r["Symbol"] for r in sort_rows_newest_first(rows)]
    assert got == ["NEWEST", "NEW", "OLD"]


def test_sort_rows_newest_first_handles_two_digit_years():
    rows = [_row(Symbol="A", CreatedDate="1/2/25"),
            _row(Symbol="B", CreatedDate="1/2/26")]
    assert [r["Symbol"] for r in sort_rows_newest_first(rows)] == ["B", "A"]


# ─── Structural sanity ───────────────────────────────────────────────────────

def test_empty_input():
    res = curate([], today=TODAY)
    assert res["clusters"] == [] and res["conv"] == []
    assert res["watchlist_bull"] == [] and res["watchlist_bear"] == []


def test_conv_is_the_same_list_as_clusters_and_is_score_sorted():
    rows = [_pick("AAA", "1000000"), _pick("BBB", "9000000", strike="300")]
    res = curate(rows, today=TODAY)
    assert res["conv"] == res["clusters"]
    scores = [c["score"] for c in res["clusters"]]
    assert scores == sorted(scores, reverse=True)
