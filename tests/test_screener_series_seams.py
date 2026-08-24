"""A series that contradicts itself has its window statistics withheld.

Accuracy audit defect #7 and the addendum's finding: `bars.db` interleaves
split-adjusted and unadjusted rows for a handful of symbols, and EVERY window
statistic over such a series is computed across both price regimes. One
upstream corruption surfaced as six wrong columns and was reported three times
as three column bugs.
"""
from api.services.screener import technicals as T
from api.services.screener import snapshot_builder as sb


def _bar(c, o=None, h=None, l=None, v=1_000_000):
    o = c if o is None else o
    return {"o": o, "h": max(o, c) if h is None else h,
            "l": min(o, c) if l is None else l, "c": c, "v": v}


def _flat(n, price=100.0):
    return [_bar(price) for _ in range(n)]


def _with_ratios(n_before, ratios, n_after=1, price=100.0):
    """A flat series, then one bar per ratio, then flat again."""
    bars = _flat(n_before, price)
    cur = price
    for r in ratios:
        cur = cur * r
        bars.append(_bar(cur))
    bars.extend(_bar(cur) for _ in range(n_after))
    return bars


# ── detection ────────────────────────────────────────────────────────────────

def test_the_mnst_shape_is_interleaved():
    """MNST leaves the ~$95/~$47 regime and returns seven times, alternating
    almost exactly reciprocally. A real split happens once and stays."""
    bars = _with_ratios(300, [0.489, 1.956, 0.493, 1.941, 0.498, 1.919, 0.504])
    interleaved, since = T.series_contradicts_itself(bars)
    assert interleaved is True
    assert since == 1


def test_a_single_extreme_round_trip_is_interleaved():
    """BYND: a ~26x factor appearing and disappearing. No market does that,
    so one round trip is enough when the factor is this large."""
    bars = _with_ratios(300, [25.967, 0.034])
    assert T.series_contradicts_itself(bars)[0] is True


def test_one_ordinary_round_trip_is_NOT_flagged():
    """⛔ THE RULE THAT WAS REJECTED. YDES fell 56% and rose 136% the next
    session -- equally consistent with a genuine collapse-and-bounce. A single
    round trip stays a CANDIDATE; the honest place for a candidate is a receipt
    somebody reads, not a rule that blanks columns."""
    bars = _with_ratios(300, [0.442, 2.358])
    assert T.series_contradicts_itself(bars) == (False, None)


def test_two_large_moves_the_same_way_are_a_squeeze():
    """LVWR: 1.896 then 1.664. Two steps in one direction is momentum."""
    bars = _with_ratios(300, [1.896, 1.664])
    assert T.series_contradicts_itself(bars) == (False, None)


def test_a_readout_biotech_over_nineteen_months_is_not_corruption():
    """⛔ THE 81-SYMBOL FALSE POSITIVE, pinned. `len(seams) >= 2` -- the
    audit's own shape, measured over its own eleven-week window -- fires on
    2.18% of the universe once it sees the 400 bars this module is actually
    handed, and the list is a who's-who of trial-readout biotech. Far apart in
    time, so no round trip."""
    bars = _flat(60) + [_bar(45.0)] + _flat(150, 45.0) + [_bar(95.0)] + _flat(80, 95.0)
    assert T.series_contradicts_itself(bars) == (False, None)


def test_a_single_seam_is_a_real_split_or_crash_and_is_spared():
    bars = _with_ratios(300, [0.5])
    assert T.series_contradicts_itself(bars) == (False, None)


def test_an_ordinary_series_has_no_seams():
    assert T.series_contradicts_itself(_flat(300)) == (False, None)


def test_a_limit_move_does_not_trip_the_band():
    """The band has to clear an ordinary limit-down/limit-up day, or real
    volatility reads as corruption."""
    bars = _with_ratios(300, [0.75, 1.35, 0.72, 1.40])
    assert T.series_contradicts_itself(bars) == (False, None)


# ── the age gate: a statistic that does not reach the seam is fine ───────────

def test_only_windows_that_reach_the_seam_are_withheld():
    """NMRA's newest seam is ~48 bars back, so its 20-day statistics are
    measured entirely within one price regime and must survive."""
    bars = _with_ratios(300, [0.517, 1.936, 0.520, 1.921], n_after=48)
    cols = T.seam_withheld_columns(bars)
    assert "pct_vs_sma200" in cols and "chg_pct_1y" in cols
    assert "dist_52w_high_pct" in cols and "pct_vs_sma50" in cols
    assert "pct_vs_sma20" not in cols, "a 20-bar window clears a 48-bar-old seam"
    assert "chg_pct_1d" not in cols
    assert "adr_pct" not in cols


def test_a_fresh_seam_withholds_almost_everything():
    """MNST's newest seam is days old, so even the short windows span it."""
    bars = _with_ratios(300, [0.489, 1.956, 0.493, 1.941], n_after=2)
    cols = T.seam_withheld_columns(bars)
    for c in ("chg_pct_1w", "pct_vs_sma20", "pct_vs_sma50", "rsi14",
              "dist_52w_high_pct", "chg_pct_1y"):
        assert c in cols, c


def test_the_smoothed_indicators_are_withheld_at_any_seam_age():
    """⛔ `rsi14` and `pct_vs_ema20` are seeded-and-smoothed over EVERYTHING
    they are handed, not over a fixed window, so a seam anywhere in the series
    reaches them."""
    bars = _with_ratios(300, [0.517, 1.936, 0.520, 1.921], n_after=250)
    cols = T.seam_withheld_columns(bars)
    assert "rsi14" in cols and "pct_vs_ema20" in cols
    assert "pct_vs_sma200" not in cols, "a 200-bar window clears a 250-bar-old seam"


def test_an_ordinary_symbol_withholds_nothing():
    assert T.seam_withheld_columns(_flat(300)) == set()


# ── the anti-drift rail ──────────────────────────────────────────────────────

def test_every_column_this_module_writes_is_classified():
    """⛔ A HAND-TYPED TABLE BESIDE A REGISTRY DRIFTS. Derive the column list
    from what `compute_technicals` actually writes, so a column added later
    without a window is a RED TEST rather than a silently-unguarded value."""
    bars = [_bar(100 + (i % 7) * 0.5, v=1_000_000) for i in range(400)]
    written = set(T.compute_technicals(bars))
    classified = set(T._WINDOW_BARS) | T._SINGLE_BAR
    unclassified = written - classified
    assert not unclassified, (
        f"these columns have no declared window: {sorted(unclassified)}")


def test_the_table_names_no_column_the_module_does_not_write():
    """The other direction: a stale entry is a rule protecting nothing."""
    bars = [_bar(100 + (i % 7) * 0.5, v=1_000_000) for i in range(400)]
    written = set(T.compute_technicals(bars)) | set(T.ath_fields(bars))
    stale = (set(T._WINDOW_BARS) | T._SINGLE_BAR) - written
    assert not stale, f"declared but never written: {sorted(stale)}"


# ── integration ──────────────────────────────────────────────────────────────

def _dated(bars):
    """Stamp sequential `t` values — `bars_asof` reads the newest bar's."""
    for i, b in enumerate(bars):
        b["t"] = 20250101 + i
    return bars


def test_build_row_withholds_and_counts_a_contradicting_series():
    bars = _dated(_with_ratios(300, [0.489, 1.956, 0.493, 1.941], n_after=2))
    state = {}
    row = sb.build_row("MNST", bars, None, {}, identity_state=state)
    assert row["pct_vs_sma200"] is None
    assert row["chg_pct_1y"] is None
    e = state["series_contradicts_itself"]
    assert e["rows"] == 1 and e["withheld"] == 1
    assert "pct_vs_sma200" in e["columns"]
    assert row["ticker"] == "MNST", "the row is still written"
    assert row["bars_asof"] is not None, "and it can still date itself"


def test_build_row_leaves_an_ordinary_symbol_alone():
    bars = [_bar(100 + (i % 7) * 0.5) for i in range(400)]
    state = {}
    row = sb.build_row("AAPL", bars, None, {}, identity_state=state)
    assert row["pct_vs_sma200"] is not None
    assert "series_contradicts_itself" not in state
