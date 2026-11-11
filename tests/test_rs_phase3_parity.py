"""Public-method parity for the Phase 3 RS columns (engineering map 2026-11-08
unit 3-13, plan §12.1): our `clenow_columns`, `vars_columns` and `rrg_columns`
against what the methods' public references actually publish.

Each fixture holds ONLY what its reference publishes (transcribed numbers and
short facts, with the URL and access date) and never our own output, so a test
here compares the function with an outside authority, not with itself:

* `rs_parity_clenow.json`: Quant Investing's worked example (90-day daily
  regression slope 0.05 %, annualised over 260 days = 13.88 %). The page gives
  no prices, so the test rebuilds the one series those inputs describe.
* `rs_parity_vars.json`: OANDA's VARS case study. Its VARS readings are chart
  images only (no dated sign changes, no series as text), so the sign-change
  test is a strict xfail that says so; the published parameters and the four
  state conditions are checked for real.
* `rs_parity_rrg_stockcharts.json`: a template for a person's reading of the
  StockCharts RRG (no API, a visual reading; map §6). Strict xfail until every
  cell is filled; then quadrant agreement must be ≥ 0.85. A miss reopens D1;
  the floor is never edited.
"""
from __future__ import annotations

import math

import pytest

from api.services import relative_strength as rs
from tests.test_indicator_golden import load_case

CLENOW = load_case("rs_parity_clenow")
VARS = load_case("rs_parity_vars")
RRG = load_case("rs_parity_rrg_stockcharts")

# ⛔ D1's floor. Pinned against the fixture's own copy so neither can be lowered
# alone; a miss reopens D1 (engineering map §2 unit 3-13), it never moves this.
RRG_AGREEMENT_FLOOR = 0.85
SPDR_SECTORS = {"XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"}


def _rel_diff(got, ref):
    return abs(got - ref) / abs(ref)


# ═════════════════════════════════════════════════════════════════════════════
# Clenow (Quant Investing worked example)
# ═════════════════════════════════════════════════════════════════════════════

def _clenow_published_series():
    """The series the page's inputs describe: `window_bars` closes rising exactly
    `daily_slope_pct` a bar. The start price is ours (the page gives none); the
    slope of ln C does not depend on it."""
    pub = CLENOW["published"]
    g = 1.0 + pub["daily_slope_pct"] / 100.0
    return [{"t": i, "c": 100.0 * g ** i} for i in range(pub["window_bars"])]


def _clenow_last(cols):
    return {k: v[-1] for k, v in cols.items()}


def test_clenow_equals_the_published_example_on_its_own_convention(monkeypatch):
    """The page's convention (260 bars a year): our annualised slope equals its
    published 13.88 % within 1 %, and the score follows its slope × R² rule."""
    pub = CLENOW["published"]
    monkeypatch.setattr(rs, "CLENOW_ANNUALISATION_BARS", pub["annualisation_bars"])
    last = _clenow_last(rs.clenow_columns(_clenow_published_series(), window=pub["window_bars"]))
    ref = pub["annual_increase_pct"] / 100.0
    assert _rel_diff(last["clenowAnnual"], ref) <= CLENOW["tolerance_rel"], (
        f"clenowAnnual {last['clenowAnnual']:.6f} vs published {ref} "
        f"({_rel_diff(last['clenowAnnual'], ref):.2%} apart)"
    )
    # A pure exponential is a perfect fit, so its Adjusted Slope is its annual slope.
    assert last["clenowR2"] == pytest.approx(1.0, abs=1e-9)
    assert last["clenowScore"] == pytest.approx(last["clenowAnnual"] * last["clenowR2"], rel=1e-12)


def test_clenow_shipped_252_bar_year_equals_the_published_example_rebased():
    """The product annualises over 252 bars (KB §4: sources differ; Quanterlab
    uses 252). Re-basing the published 13.88 % from a 260- to a 252-bar year,
    (1 + 0.1388)^(252/260) − 1, our shipped figure agrees within 1 %."""
    pub = CLENOW["published"]
    assert rs.CLENOW_ANNUALISATION_BARS == CLENOW["product_annualisation_bars"] == 252
    last = _clenow_last(rs.clenow_columns(_clenow_published_series(), window=pub["window_bars"]))
    ref = (1.0 + pub["annual_increase_pct"] / 100.0) ** (252.0 / pub["annualisation_bars"]) - 1.0
    assert _rel_diff(last["clenowAnnual"], ref) <= CLENOW["tolerance_rel"], (
        f"clenowAnnual {last['clenowAnnual']:.6f} vs rebased published {ref:.6f}"
    )


@pytest.mark.xfail(strict=True, reason=(
    "convention, measured: the page annualises over 260 bars and the product over 252, "
    "so the shipped clenowAnnual on the page's inputs is 13.42 %, 3.3 % below its 13.88 %. "
    "Strict, so changing the exponent turns this red for a review"))
def test_clenow_shipped_figure_is_not_the_page_figure_raw():
    pub = CLENOW["published"]
    last = _clenow_last(rs.clenow_columns(_clenow_published_series(), window=pub["window_bars"]))
    ref = pub["annual_increase_pct"] / 100.0
    assert _rel_diff(last["clenowAnnual"], ref) <= CLENOW["tolerance_rel"], (
        f"shipped clenowAnnual {last['clenowAnnual']:.6f} is {_rel_diff(last['clenowAnnual'], ref):.2%} "
        f"from the published {ref}"
    )


# ═════════════════════════════════════════════════════════════════════════════
# VARS (OANDA case study)
# ═════════════════════════════════════════════════════════════════════════════

def test_vars_defaults_are_the_published_parameters():
    pub = VARS["published"]
    assert rs.DEFAULT_ATR_LENGTH == pub["atr_length"]
    assert rs.DEFAULT_ATR_LENGTH in pub["atr_length_alternatives"]
    assert rs.DEFAULT_VARS_LOOKBACK == pub["lookback"]
    assert rs.DEFAULT_VARS_MA_LENGTH == pub["ma_length"]
    assert pub["ma_type"] == "SMA" and pub["timeframe"] == "daily" and pub["benchmark"] == "SPY"


def _wave_pair(n=420):
    """A share that swings in and out of strength against a steadily rising
    benchmark, with a real high-low range on both, so VARS crosses zero and its
    MA many times. Deterministic; synthetic, not a reference."""
    share, bench = [], []
    for i in range(n):
        c = 100.0 * (1.0 + 0.0004 * i) * (1.0 + 0.12 * math.sin(i / 23.0))
        b = 100.0 * (1.0 + 0.0004 * i)
        share.append({"t": i, "h": c * 1.01, "l": c * 0.99, "c": c})
        bench.append({"t": i, "h": b * 1.005, "l": b * 0.995, "c": b})
    return share, bench


def test_vars_state_codes_follow_the_published_four_states():
    """Every state code our column emits sits in the published state its
    condition names (sign of VARS, above or below its MA), and all four occur."""
    by_code = {s["product_code"]: s for s in VARS["published"]["states"]}
    assert sorted(by_code) == [1, 2, 3, 4]
    share, bench = _wave_pair()
    cols = rs.vars_columns(share, bench)
    seen = set()
    for v, m, code in zip(cols["vars"], cols["varsMa"], cols["varsState"]):
        if code is None:
            continue
        state = by_code[code]
        assert (1 if v > 0 else -1) == state["vars_sign"], (v, m, code)
        assert ("above" if v > m else "below") == state["vs_ma"], (v, m, code)
        seen.add(code)
    assert seen == {1, 2, 3, 4}, f"the synthetic pair reached only states {sorted(seen)}"


@pytest.mark.xfail(condition=not VARS["reproducible"], strict=True, reason=(
    "OANDA publishes its VARS only as chart images: no dated zero-line crossings and no "
    "price series as text (rs_parity_vars.json `not_published`), so its sign changes "
    "cannot be reproduced"))
def test_vars_matches_the_published_sign_changes():
    pub = VARS["published"]
    series = VARS["price_series"]
    assert pub["sign_changes"] and series, (
        "nothing to compare: the reference publishes no dated VARS sign changes and no price series"
    )
    share, bench = series["share"], series["benchmark"]
    cols = rs.vars_columns(share, bench, atr_length=pub["atr_length"],
                           lookback=pub["lookback"], ma_length=pub["ma_length"])
    at = {b["t"]: v for b, v in zip(share, cols["vars"])}
    order = [b["t"] for b in share]
    for change in pub["sign_changes"]:
        i = order.index(change["date"])
        before, after = at[order[i - 1]], at[change["date"]]
        assert before is not None and after is not None, change
        assert math.copysign(1, before) == change["from_sign"], (change, before)
        assert math.copysign(1, after) == change["to_sign"], (change, after)


# ═════════════════════════════════════════════════════════════════════════════
# RRG (StockCharts, read by a person)
# ═════════════════════════════════════════════════════════════════════════════

def _our_quadrants():
    """{(date, ticker): quadrant name} from `rrg_columns` (D1's Terminal formula,
    its defaults) on the fixture's weekly closes."""
    w = RRG["weekly_closes"]
    bench = [{"t": t, "c": c} for t, c in zip(w["t"], w[RRG["benchmark"]])]
    out = {}
    for sym in RRG["tickers"]:
        bars = [{"t": t, "c": c} for t, c in zip(w["t"], w[sym])]
        quad = rs.rrg_columns(bars, bench)["quadrant"]
        for t, code in zip(w["t"], quad):
            out[(t, sym)] = rs.RRG_QUADRANT_NAMES[code - 1] if code else None
    return out


def _reading_cells():
    return [(d, s, RRG["readings"][d][s]["stockcharts_quadrant"])
            for d in RRG["dates"] for s in RRG["tickers"]]


def test_rrg_template_is_complete_and_computable():
    """The template the owner fills: the 11 SPDR sectors, ≥ 12 weekly dates,
    one `stockcharts_quadrant` per cell (null or a quadrant name), closes for
    every symbol on one calendar, and our quadrant known on every reading date."""
    assert RRG["agreement_floor"] == RRG_AGREEMENT_FLOOR == 0.85
    assert set(RRG["tickers"]) == SPDR_SECTORS and len(RRG["tickers"]) == 11
    assert len(RRG["dates"]) >= 12 and RRG["dates"] == sorted(RRG["dates"])
    assert list(RRG["quadrant_names"]) == list(rs.RRG_QUADRANT_NAMES)
    assert set(RRG["readings"]) == set(RRG["dates"])
    for d in RRG["dates"]:
        assert set(RRG["readings"][d]) == SPDR_SECTORS, d
        for s in SPDR_SECTORS:
            cell = RRG["readings"][d][s]
            assert "stockcharts_quadrant" in cell, (d, s)
            assert cell["stockcharts_quadrant"] in (None, *rs.RRG_QUADRANT_NAMES), (d, s, cell)
    w = RRG["weekly_closes"]
    assert set(RRG["dates"]) <= set(w["t"])
    for sym in [RRG["benchmark"], *RRG["tickers"]]:
        assert len(w[sym]) == len(w["t"]), sym
        assert all(isinstance(c, (int, float)) and c > 0 for c in w[sym]), sym
    ours = _our_quadrants()
    missing = [(d, s) for d in RRG["dates"] for s in RRG["tickers"] if ours[(d, s)] is None]
    assert not missing, f"our quadrant is still in warm-up at {missing[:5]}"


_RRG_UNREAD = sum(1 for *_, q in _reading_cells() if q is None)


@pytest.mark.xfail(condition=_RRG_UNREAD > 0, strict=True,
                   reason="awaiting owner StockCharts readings")
def test_rrg_quadrant_agreement_with_stockcharts():
    cells = _reading_cells()
    assert _RRG_UNREAD == 0, f"{_RRG_UNREAD} of {len(cells)} StockCharts readings are still null"
    ours = _our_quadrants()
    agree = [ours[(d, s)] == q for d, s, q in cells]
    rate = sum(agree) / len(agree)
    misses = sorted({s for (d, s, q), ok in zip(cells, agree) if not ok})
    assert rate >= RRG_AGREEMENT_FLOOR, (
        f"measured quadrant agreement {rate:.1%} ({sum(agree)}/{len(agree)}) is under "
        f"{RRG_AGREEMENT_FLOOR:.0%}; misses on {misses}. Record this number, mark this test xfail "
        f"with it and REOPEN D1 (engineering map 3-13). Do not edit the floor."
    )
