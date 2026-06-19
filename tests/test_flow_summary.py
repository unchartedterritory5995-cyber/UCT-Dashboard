"""Tests for api.flow_summary.compute_top_conviction — the Dashboard
Options Flow preview board."""

from datetime import date

from api.flow_summary import compute_top_conviction

TODAY = date(2026, 5, 1)


def _row(**kw):
    """Build a flow.db-shaped row with sensible defaults."""
    base = {
        "Symbol": "AAA", "Type": "SWEEP", "Volume": "100", "Price": "1.00",
        "Side": "A", "CallPut": "CALL", "Strike": "100", "Spot": "100",
        "Premium": "1000000", "ExpirationDate": "7/17/2026", "Color": "YELLOW",
        "Dte": "77", "ER": "F", "Sector": "Tech", "MktCap": "5000000000",
    }
    base.update(kw)
    return base


def test_call_ask_is_bull_put_ask_is_bear():
    items = compute_top_conviction(
        [
            _row(Symbol="BULL", CallPut="CALL", Side="A"),
            _row(Symbol="BEAR", CallPut="PUT", Side="A"),
        ],
        today=TODAY,
    )
    by = {i["sym"]: i for i in items}
    assert by["BULL"]["dir"] == "BULL"
    assert by["BEAR"]["dir"] == "BEAR"


def test_bb_sweep_inverts_direction():
    # Selling calls on the bid (sweep) = bearish; selling puts on bid = bullish.
    items = compute_top_conviction(
        [
            _row(Symbol="SC", CallPut="CALL", Side="BB", Type="SWEEP"),
            _row(Symbol="SP", CallPut="PUT", Side="BB", Type="SWEEP"),
        ],
        today=TODAY,
    )
    by = {i["sym"]: i for i in items}
    assert by["SC"]["dir"] == "BEAR"
    assert by["SP"]["dir"] == "BULL"


def test_bb_block_is_ambiguous_dropped():
    # BB on a BLOCK (not a sweep) carries no direction -> excluded entirely.
    items = compute_top_conviction(
        [_row(Symbol="AMB", CallPut="CALL", Side="BB", Type="BLOCK")],
        today=TODAY,
    )
    assert items == []


def test_red_and_ml_rows_filtered():
    items = compute_top_conviction(
        [
            _row(Symbol="REDX", Color="#FF0000"),
            _row(Symbol="MLX", Type="ML/"),
        ],
        today=TODAY,
    )
    assert items == []


def test_net_premium_and_bull_pct():
    items = compute_top_conviction(
        [
            _row(Symbol="MIX", CallPut="CALL", Side="A", Premium="3000000"),
            _row(Symbol="MIX", CallPut="PUT", Side="A", Premium="1000000",
                 Strike="100", Spot="100"),
        ],
        today=TODAY,
    )
    assert len(items) == 1
    it = items[0]
    assert it["dir"] == "BULL"
    assert it["netPremium"] == 2_000_000  # 3M bull - 1M bear
    assert it["bullPct"] == 75           # 3M / 4M


def test_ranked_by_net_premium_desc_with_rank():
    items = compute_top_conviction(
        [
            _row(Symbol="SMALL", Premium="1000000"),
            _row(Symbol="BIG", Premium="9000000"),
            _row(Symbol="MID", Premium="5000000"),
        ],
        today=TODAY,
        limit=2,
    )
    assert [i["sym"] for i in items] == ["BIG", "MID"]
    assert [i["rank"] for i in items] == [1, 2]


def test_lottery_filter_drops_far_otm_short_dte_megacap():
    # Mega-cap, 3 DTE, call strike 30% OTM -> noise, dropped.
    items = compute_top_conviction(
        [_row(Symbol="MEGA", CallPut="CALL", Side="A", Strike="130", Spot="100",
              ExpirationDate="5/4/2026", Dte="3", MktCap="500000000000")],
        today=TODAY,
    )
    assert items == []


def test_deep_itm_block_is_arb_dropped():
    items = compute_top_conviction(
        [_row(Symbol="ARB", CallPut="CALL", Side="A", Type="BLOCK",
              Strike="80", Spot="100")],  # 20% ITM block
        today=TODAY,
    )
    assert items == []


def test_top_contract_picks_biggest_premium_with_moneyness():
    items = compute_top_conviction(
        [
            _row(Symbol="TC", CallPut="CALL", Side="A", Strike="120", Spot="100",
                 Premium="2000000", ExpirationDate="7/17/2026"),
            _row(Symbol="TC", CallPut="CALL", Side="A", Strike="120", Spot="100",
                 Premium="3000000", ExpirationDate="7/17/2026"),
        ],
        today=TODAY,
    )
    tc = items[0]["topContract"]
    assert tc["strike"] == 120
    assert tc["hits"] == 2
    assert tc["premium"] == 5_000_000
    assert tc["moneyness"] == "OTM"
    assert tc["otmPct"] == 20
    assert tc["exp"] == "7/17"  # current year -> no year suffix


def test_empty_rows_returns_empty():
    assert compute_top_conviction([], today=TODAY) == []
