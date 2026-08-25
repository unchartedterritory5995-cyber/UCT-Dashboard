"""Technical indicators computed from local daily bars.

``bars`` is a list of dicts ``{"o","h","l","c","v"}`` ordered oldest -> newest.
Pure; returns Nones where there isn't enough history.
"""


def _sma(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None


def _ema(vals, n):
    if len(vals) < n:
        return None
    k = 2 / (n + 1)
    ema = sum(vals[:n]) / n
    for v in vals[n:]:
        ema = v * k + ema * (1 - k)
    return ema


def _rsi(closes, n=14):
    """Wilder's 14-period RSI, or ``None`` when it is not computable.

    🔴 THIS COLUMN USED TO BE **CUTLER'S** RSI PUBLISHED UNDER THE NAME
    "the nightly 14-period RSI". It summed the last 14 gains/losses, divided by
    14, and handed those SIMPLE averages to
    ``indicator_compute.rsi_from_wilder_averages`` — a function that only
    decides the ``0/0`` case and does no smoothing at all. Cutler's RSI is a
    real published definition, but it is not the one the phrase "14-period RSI"
    names anywhere a member has seen it, and — decisively — it is not the one
    THIS PLATFORM draws on the chart a member opens from the screener row:
    ``indicator_compute.compute_rsi_raw`` (and its ``indicators.js`` mirror) is
    textbook Wilder. One label, one product, two numbers.

    Measured 2026-08-23 over the 2,748 fresh rows, screener value vs Wilder on
    the identical closes: **median 6.16 RSI points apart**, 74% differ by more
    than 3, 25% by more than 10, worst 47.61 — and **525 rows sit on the wrong
    side of the 70/30 lines**, which are the entire point of the column
    (UTZ 32.43 vs 79.03, MKTX 45.30 vs 81.91, CLBK 84.02 vs 43.17, TSLA and
    SMCI both crossing 70 the wrong way).

    ⭐ WILDER WAS CHOSEN OVER DOCUMENTING CUTLER. Both were open: a `desc`
    saying "simple-average RSI" would have made the column honest. It would
    also have left the screener disagreeing with our own chart by six points on
    a standard indicator, and left every member-typed `rsi14 <= 30` meaning
    something no other tool means. The cost of this direction is that a saved
    scan written against the old values now selects a different set — that is
    the price of the correction, and it is paid once.

    ⛔ THE MATHS IS ``indicator_compute.compute_rsi_raw``'S, never a second
    Wilder RSI written here — the same chokepoint rule ``_atr_pct`` states, for
    the same reason: a private copy IS the defect, in a new place. That
    function is also where the ``0/0`` decision lives (SIM/TMTS/CWEN-A/DRDB/OBA
    no longer read 100.0 beside ``chg_pct_1d = 0.00``), and
    ``tests/test_single_authority_rails.py`` fails BY NAME on a second copy.

    ⚠️ IT IS SEEDED-AND-SMOOTHED OVER THE BARS IT IS GIVEN, exactly as
    ``_atr_pct`` is, and for RSI that dependence is measurably gone by the time
    the series is this long: over 277 sampled tickers the 400-bar value and the
    full-stored-history value agree to **3.1e-11 at worst** (200 bars: 9.2e-05;
    100 bars: 0.40, which is why a short window is not equivalent).
    ``snapshot_builder`` hands every ticker the same 400 daily bars, so the
    column is the canonical Wilder number and is comparable across the universe
    by construction.

    ⭐ THIS ALSO RETIRES THE FROZEN-ETF 100. **KBON** — a bond ETF whose last 14
    diffs are all zero-or-positive — published ``rsi14 = 100.00``, the top of
    the scale, because Cutler's window saw no loss at all. Wilder's long memory
    reaches the movement before it and reads **52.39**. The ``0/0`` guard was
    only ever half the protection; this is the other half, and it needed no
    special case.
    """
    from api.services import indicator_compute
    if len(closes) < n + 1:
        return None
    return indicator_compute.compute_rsi_raw(closes, n)[-1]


def _volume(bar):
    """A bar's volume, or ``None`` when it is not a usable number.

    ``bool`` is checked FIRST because it is a subclass of ``int`` — ``True``
    would otherwise pass as a volume of 1.
    """
    v = bar.get("v")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return v if (v == v and v >= 0) else None


def volume_ratio(bars, n=30):
    """Today's volume over the mean of the PRIOR ``n`` sessions — or ``None``.

    ⭐ THE ONE AUTHORITY FOR RELATIVE VOLUME. `bar_character` names bars off
    this exact number (Heavy / Huge / Climactic / Dried-Up, and the whole VSA
    tier), and the `vol_ratio` column filters on it. A second implementation in
    the character module would be the `atr_pct`/`adr_pct` defect in a new place:
    two differently-computed values wearing one name.

    ⛔ THE DENOMINATOR EXCLUDES TODAY (`bars[-n-1:-1]`). Averaging today in
    drags the mean toward the spike it is meant to measure — a genuine 10x day
    reads about 5.6x.

    ⚠️ THE WINDOW STAYS 30, not StockCharts' 50. `vol_ratio` is a member-facing
    filter and two saved screens key off it (`>= 3`, `>= 1.5`); widening the
    window moves every stored threshold's meaning and silently re-selects them.
    The VSA multiples below are ratios and read the same either way.

    Returns ``None`` — never ``0`` — when volume is missing or history is short:
    a 0 here would mean "no volume" and it sorts and filters.
    """
    if not bars:
        return None
    today_v = _volume(bars[-1])
    prior_v = [v for v in (_volume(b) for b in bars[-n - 1:-1]) if v is not None]
    if today_v is None or not prior_v:
        return None
    avg = sum(prior_v) / len(prior_v)
    return round(today_v / avg, 2) if avg else None


def _atr_pct(bars, n=14):
    """Wilder's ATR(``n``) as a percentage of the latest close — or ``None``.

    🔴 THIS COLUMN USED TO BE ``out["atr_pct"] = out["adr_pct"]``, on every row.
    Measured 2026-08-09: ``atr_pct == adr_pct`` on **3,708 of 3,708 rows**. They
    are two differently-defined, differently-named industry quantities: ADR is
    the mean of ``(h − l) / c`` and ignores the gap; ATR is the Wilder-smoothed
    **true** range, ``max(h − l, |h − c₋₁|, |l − c₋₁|)``, which includes it. So a
    member filtering on ATR% was handed ADR wearing ATR's name — median **+5.3%**
    understated, worst observed **TTE stored 1.64 vs a true 2.14 (+30%)**, on a
    volatility column that feeds position sizing.

    ⭐ COMPUTED, NOT RENAMED. Renaming was the other honest option, but
    ``atr_pct`` is a DECLARED SCALAR in ``closedTable.json`` — sentenced to
    members as *"the average true range percentage"* — so the name is already
    published and the fix is to make it true.

    ⛔ THE MATHS IS ``indicator_compute.compute_atr_raw``'S, not a second Wilder
    ATR written here: that function is the one the golden fixture
    ``tests/fixtures/indicators/atr_14.json`` pins in BOTH lanes at rel-tol 1e-9,
    and a private copy in the screener is precisely the ``atr_pct``/``adr_pct``
    defect in a new place.

    ⚠️ IT IS SEEDED-AND-SMOOTHED OVER THE BARS IT IS GIVEN, which is Wilder's
    definition and not a bug: the recursion means the value depends slightly on
    where the series starts. ``snapshot_builder`` hands this the same 400 daily
    bars for every ticker, so the column is comparable across the universe by
    construction rather than by luck.
    """
    from api.services import indicator_compute
    if len(bars) < n + 1:
        return None
    atr = indicator_compute.compute_atr_raw(bars, n)[-1]
    last_close = bars[-1]["c"]
    if atr is None or not last_close:
        return None
    return atr / last_close * 100


def _pct(a, b):
    # `if b` guarded the DENOMINATOR only, so a null numerator raised
    # TypeError instead of returning None — and a bar with a null close is
    # ordinary (halted names, a thin tape, a provider gap). That took down the
    # whole row build in snapshot_builder.build_row, not just this one field.
    # Both operands must be real numbers; anything else has no percentage.
    if a is None or not b:
        return None
    try:
        return round((a - b) / b * 100, 2)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _pole_pct(closes):
    """Trough→peak % gain in the last 22 closes — the momentum 'pole'.

    Verbatim arithmetic port of uct-intelligence
    scripts/scanner_candidates.py::_compute_pole_pct (read 2026-08-21); the
    snapshot is now the single authority for this number (spec §8). One
    deliberate deviation: insufficient history is None (the snapshot's
    not-computable convention), while a peak with no prior trough is a true
    0.0 — the scanner returned 0.0 for both.
    """
    window = closes[-22:]
    if len(window) < 5:
        return None
    peak_val = max(window)
    peak_idx = window.index(peak_val)
    if peak_idx == 0:
        return 0.0
    trough = min(window[:peak_idx])
    if trough <= 0:
        return None
    return round((peak_val - trough) / trough * 100, 1)


def _atr_ext_sma50(bars, closes, s50):
    """Extension above the 50SMA in ATR units: (close − SMA50) / ATR(14).

    Same Wilder ATR chokepoint as `_atr_pct` — never a private copy.
    """
    from api.services import indicator_compute
    if s50 is None or len(bars) < 15:
        return None
    atr = indicator_compute.compute_atr_raw(bars, 14)[-1]
    if not atr:
        return None
    return round((closes[-1] - s50) / atr, 2)


def _linear_slope(ys):
    """Least-squares slope in units-per-bar. Verbatim port of
    scanner_candidates._linear_slope (single authority now here)."""
    n = len(ys)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(ys) / n
    num = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(ys))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return num / den if den != 0 else 0.0


def rs_line_trend(closes, spy_closes):
    """'up' / 'flat' / 'down' — slope of the ticker/SPY ratio over 20 bars.

    Verbatim port of scanner_candidates._compute_rs_slope; the ONE behavioral
    RS definition (spec §8 names the three RS spellings; this is the only
    server-side authority for RS-line behavior). Deviation: insufficient data
    is None (not-computable), where the scanner said 'flat'.
    """
    if not closes or not spy_closes:
        return None
    n = min(len(closes), len(spy_closes), 20)
    if n < 5:
        return None
    tc, sc = closes[-n:], spy_closes[-n:]
    rs = [t / s for t, s in zip(tc, sc) if s > 0]
    if len(rs) < 5:
        return None
    slope = _linear_slope(rs)
    rs_mean = sum(rs) / len(rs)
    slope_pct = slope / rs_mean if rs_mean != 0 else 0.0
    if slope_pct > 0.0005:
        return "up"
    if slope_pct < -0.0005:
        return "down"
    return "flat"


def usable_bars(bars: list[dict]) -> list[dict]:
    """Bars whose O/H/L/C are all real, finite numbers.

    The screener's four bar consumers — compute_technicals, single_candle,
    multi_candle, detect_patterns — all do bare arithmetic on these fields.
    A single null anywhere raised TypeError out of whichever one reached it
    first and killed the ENTIRE row in snapshot_builder.build_row: every
    field lost, for a ticker whose only problem was one session without a
    print. Bars are sanitized ONCE at the build_row boundary rather than
    guarded inside five functions.

    Requires all four fields, not just the close: `gap_pct` reads `o`, ADR
    reads `h`/`l`, and the candle/pattern modules read all four. A bar
    missing any of them cannot produce a screener row anyway.

    `x == x` rejects NaN (which is a float and passes isinstance); the bool
    check rejects True/False, which are ints in Python and would otherwise
    sail through as prices of 1 and 0.
    """
    def ok(v):
        return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v

    return [b for b in (bars or []) if all(ok(b.get(k)) for k in ("o", "h", "l", "c"))]


def ath_fields(all_bars: list[dict]) -> dict:
    """Distance to the all-time high of the STORED history (bars.db holds
    since-inception dailies for the cap universe; a recent IPO's 'all-time'
    is its whole life — that is the honest reading, same as any provider)."""
    out = {"dist_ath_pct": None, "new_ath": False}
    bars = usable_bars(all_bars)
    if not bars:
        return out
    hi = max(b["h"] for b in bars)
    out["dist_ath_pct"] = _pct(bars[-1]["c"], hi)
    out["new_ath"] = bars[-1]["h"] >= hi
    return out


# ─────────────────────────────────────────────────────────────────────────────
#  A series that contradicts itself
# ─────────────────────────────────────────────────────────────────────────────
#
# 🔴 ONE UPSTREAM DEFECT REPORTED THREE TIMES AS THREE COLUMN BUGS. The
# 2026-08-23 audit's flow lane reported `dp_level_dist_pct` WRONG on MNST
# (close $47.79 against a nearest dark-pool level of $95.76 → 100.38%) and
# blamed level staleness. The technicals lane independently reported MQ and
# CLBK wrong on `chg_pct_1y`, `pct_vs_sma50/200` and `dist_52w_high/low`. Same
# cause, and it is in neither column: **`bars.db` is interleaving
# split-adjusted and unadjusted rows for a handful of symbols.**
#
# MNST crosses the ~$95/~$47 boundary SEVEN TIMES in eleven weeks, alternating
# almost exactly reciprocally — 0.489, 1.956, 0.493, 1.941, 0.498, 1.919,
# 0.504. ⭐ A real split happens ONCE AND STAYS. A series that leaves a price
# regime and comes back has not had a corporate action, it has had two
# different answers merged into one table.
#
# Every window statistic over such a series is computed ACROSS BOTH REGIMES,
# which is why one corruption surfaced as six wrong columns simultaneously.
#
# ⛔ THE REPAIR IS NOT HERE, AND THIS IS NOT IT. `bars.db` owns the value;
# `bars_reconciliation.py` owns the repair. ⚠️ MEASURED 2026-08-24:
# `RECONCILE_ENABLED` is NOT set on either `web` or `flow-worker`, and the code
# default is ON (`os.environ.get("RECONCILE_ENABLED", "1") != "0"`, default-on
# since 2026-05-30) — **so reconciliation has been running the whole time and
# these six symbols are still interleaved.** That is a finding, not a to-do
# closed: the upstream fix does not currently cover this shape. ⛔ And do NOT
# hand-repair `bars.db` — that is how it was emptied on 2026-08-10.
#
# What this module owes a member in the meantime is the honest interim the
# audit's addendum asked for: a symbol whose own series contradicts itself has
# its window statistics WITHHELD AND COUNTED, not published.

#: Day-over-day close ratios outside this band are a "seam". Wide on purpose:
#: the band has to clear an ordinary limit-down/limit-up day so that real
#: volatility is not read as corruption. These are the audit's own bounds.
_SEAM_LO, _SEAM_HI = 0.70, 1.42

#: A "round trip": two seams close together whose ratios multiply back to ~1 —
#: the series left a price regime and came back. ⛔ THE GAP IS SMALL ON
#: PURPOSE. Over a 400-bar window a biotech will fall 50% on a failed readout
#: and double a year later, and that is a market, not a merge.
_ROUND_TRIP_GAP, _ROUND_TRIP_TOL = 5, 0.15

#: A single seam this large is not a price move at anyone's definition — it is
#: an adjustment factor appearing and disappearing.
_EXTREME_RATIO = 5.0


def _seam_ratios(bars):
    """``[(index, ratio), …]`` for each day-over-day close jump out of band."""
    out = []
    for i in range(1, len(bars)):
        prev, cur = bars[i - 1].get("c"), bars[i].get("c")
        if not prev or not cur or prev <= 0:
            continue
        r = cur / prev
        if r < _SEAM_LO or r > _SEAM_HI:
            out.append((i, r))
    return out


def _round_trips(seams):
    """Seam pairs that leave a price regime and return within a few bars."""
    return [(i, j, ri, rj)
            for a, (i, ri) in enumerate(seams)
            for (j, rj) in seams[a + 1:]
            if j - i <= _ROUND_TRIP_GAP and abs(ri * rj - 1.0) <= _ROUND_TRIP_TOL]


def series_contradicts_itself(bars):
    """``(is_interleaved, bars_since_the_newest_offending_seam)``.

    ⭐ THE TEST IS A REPEATED ROUND TRIP, AND GETTING HERE TOOK THREE TRIES.
    Each rejected rule is recorded because each is the obvious one:

      1. ``len(seams) >= 2`` — the audit's own shape, measured over its own
         eleven-week window. Over the 400 bars this module is actually handed
         it fires on **81 of 3,711 symbols (2.18%)**, and the list is a
         who's-who of trial-readout biotech — ABVX, CMPS, EDIT, QURE, WVE.
         Those are markets, not merges.
      2. ``>= 2 seams that reverse direction`` — same problem. Nineteen months
         is long enough for any volatile small cap to move hard both ways.
      3. **One** near-reciprocal round trip — 12 symbols, and the shape is
         indistinguishable from a real crash-and-rebound (YDES −56% then +136%
         the next session).

    What survives is a series that round-trips REPEATEDLY, or once by a factor
    no market produces:

        MNST  7 seams, 7 round trips   0.489 1.956 0.493 1.941 0.498 1.919 …
        VCX   8 seams, 8 round trips   1.545 1.630 1.642 0.689 0.660 0.642 …
        RGC  15 seams, 2 round trips
        BYND  7 seams, 1 round trip at 25.967 × 0.034 — a ~26× factor
              appearing and disappearing

    **4 of 3,711 symbols (0.11%).** A real split happens ONCE AND STAYS; a
    series that leaves a price regime and comes back twice has two different
    answers merged into one table.

    ⚠️ WHAT THIS DELIBERATELY DOES NOT CATCH: a SINGLE round trip. NMRA, YDES,
    STRO and PLYX each show one, and each is equally consistent with a genuine
    collapse-and-bounce. They remain candidates, and the honest place for a
    candidate is a receipt somebody reads, not a rule that blanks columns.
    """
    seams = _seam_ratios(bars)
    trips = _round_trips(seams)
    if not trips:
        return False, None
    repeated = len(trips) >= 2
    extreme = any(max(ri, rj) >= _EXTREME_RATIO for _i, _j, ri, rj in trips)
    if not (repeated or extreme):
        return False, None
    newest = max(j for _i, j, _ri, _rj in trips)
    return True, (len(bars) - 1) - newest


#: column -> how many trailing bars its value READS. A statistic is withheld
#: when the newest seam falls inside its own window; one that does not reach
#: back that far is measured entirely within a single price regime and is fine.
#: ⛔ `rsi14` and `pct_vs_ema20` carry the WHOLE series because both are
#: seeded-and-smoothed over everything they are handed, not over a fixed window.
_WINDOW_BARS = {
    "chg_pct_1d": 2, "gap_pct": 2, "prev_day_open": 2, "prev_day_high": 2,
    "prev_day_low": 2, "prev_day_close": 2,
    "adr_pct_1w": 6, "chg_pct_1w": 6,
    "atr_pct": 15, "vol_ratio": 31,
    "adr_pct": 21, "dist_20d_high_pct": 20, "dist_20d_low_pct": 20,
    "pct_vs_sma20": 20, "chg_pct_1m": 22,
    "pct_vs_sma50": 50, "above_50sma": 50, "atr_ext_sma50": 50,
    "pole_pct": 60,
    "pct_vs_sma200": 200, "ma_stack": 200,
    "dist_52w_high_pct": 252, "dist_52w_low_pct": 252, "new_52w_high": 252,
    "chg_pct_ytd": 252, "chg_pct_1y": 253,
    "rsi14": 10 ** 9, "pct_vs_ema20": 10 ** 9,
    "dist_ath_pct": 10 ** 9, "new_ath": 10 ** 9,
}

#: Facts about ONE bar. They cannot span a seam, so they are never withheld —
#: and they are listed rather than inferred so the rail below can prove that
#: every column this module writes has been classified one way or the other.
_SINGLE_BAR = {"price", "chg_from_open_pct"}


def seam_withheld_columns(bars) -> set:
    """The columns whose window crosses a seam in a self-contradicting series.

    Empty for every ordinary symbol — this returns early on the seam count, so
    the cost on 3,469 of 3,475 tickers is one pass over the closes.
    """
    interleaved, since = series_contradicts_itself(bars)
    if not interleaved:
        return set()
    return {c for c, w in _WINDOW_BARS.items() if w > since}


def compute_technicals(bars: list[dict]) -> dict:
    out = {k: None for k in (
        "chg_pct_1d", "chg_pct_1w", "chg_pct_1m", "rsi14", "pct_vs_sma20",
        "pct_vs_sma50", "pct_vs_sma200", "pct_vs_ema20", "adr_pct", "atr_pct",
        "vol_ratio", "gap_pct", "dist_52w_high_pct", "dist_52w_low_pct", "price",
        "chg_pct_1y", "chg_pct_ytd", "chg_from_open_pct", "adr_pct_1w",
        "dist_20d_high_pct", "dist_20d_low_pct", "pole_pct", "atr_ext_sma50",
        "prev_day_open", "prev_day_high", "prev_day_low", "prev_day_close")}
    out["ma_stack"] = None
    out["above_50sma"] = None
    out["new_52w_high"] = False
    if not bars:
        return out

    # Drop bars without a usable numeric close BEFORE anything reads them.
    # `_rsi`, `_sma`, `_ema` and the ADR loop each do bare arithmetic on
    # `closes`, so ONE null close anywhere in the series raised TypeError out
    # of compute_technicals and killed the entire row in
    # snapshot_builder.build_row — every field lost, not just the one that
    # touched the gap. Guarding each consumer would be a game of whack-a-mole
    # across five functions; sanitizing the input once fixes the family.
    #
    # Filtered as WHOLE BARS, never as a separate `closes` list: `gap_pct`,
    # ADR and the 52-week window index off `bars` while everything else
    # indexes off `closes`, so filtering only one of them would silently pair
    # today's open with some other session's close. A dropped bar shifts the
    # lookbacks by design — "vs the prior session that actually printed" is
    # the honest reading of a gap in the tape.
    bars = usable_bars(bars)
    if not bars:
        return out

    closes = [b["c"] for b in bars]
    price = closes[-1]
    out["price"] = price
    if len(closes) >= 2:
        out["chg_pct_1d"] = _pct(price, closes[-2])
        out["gap_pct"] = _pct(bars[-1]["o"], closes[-2])
    if len(closes) >= 6:
        out["chg_pct_1w"] = _pct(price, closes[-6])
    if len(closes) >= 22:
        out["chg_pct_1m"] = _pct(price, closes[-22])
    rsi = _rsi(closes)
    out["rsi14"] = round(rsi, 2) if rsi is not None else None
    s20, s50, s200 = _sma(closes, 20), _sma(closes, 50), _sma(closes, 200)
    e20 = _ema(closes, 20)
    out["pct_vs_sma20"] = _pct(price, s20) if s20 else None
    out["pct_vs_sma50"] = _pct(price, s50) if s50 else None
    out["pct_vs_sma200"] = _pct(price, s200) if s200 else None
    out["pct_vs_ema20"] = _pct(price, e20) if e20 else None
    out["above_50sma"] = (price > s50) if s50 else None
    if s20 and s50 and s200:
        if price > s20 > s50 > s200:
            out["ma_stack"] = "full-bull"
        elif price < s20 < s50 < s200:
            out["ma_stack"] = "bear"
        else:
            out["ma_stack"] = "partial"
    # ADR% over the last 21 sessions.
    #
    # ⛔ THE NUMERATOR AND THE DENOMINATOR MUST COUNT THE SAME BARS. This used to
    # skip bars with a falsy close in the SUM (`... for b in window if b["c"]`)
    # while dividing by `len(window)`, so a single zero close in the 21-bar
    # window understated ADR by ~4.8% with nothing reported — and `usable_bars`
    # admits `c == 0` (it checks finiteness, not positivity), so the path is
    # reachable and one such row exists in the daily store today. Filtering the
    # window ONCE makes the two agree by construction.
    window = [b for b in (bars[-21:] if len(bars) >= 21 else bars) if b["c"]]
    if window:
        adr = sum((b["h"] - b["l"]) / b["c"] for b in window) / len(window)
        out["adr_pct"] = round(adr * 100, 2)
    # ATR% is Wilder's TRUE range — NOT a second name for ADR. See `_atr_pct`.
    atr_pct = _atr_pct(bars)
    out["atr_pct"] = round(atr_pct, 2) if atr_pct is not None else None
    # Relative volume: the NEWEST stored session's volume ÷ the mean volume of
    # the 30 sessions BEFORE it.
    #
    # ⛔ AN ABSENT VOLUME IS NOT A ZERO. This read `[b.get("v") or 0 for b in
    # bars]`, which collapsed `None` — and any other falsy value — into a hard
    # `0` on BOTH sides of the division. As a numerator that publishes a
    # confident `0.00×` for "we hold no volume for this session", which is the
    # exact shape the house rule bans: invisible, and it both sorts and filters.
    # Inside the denominator it is worse and quieter — a missing session counted
    # as zero drags the 30-day mean DOWN and inflates every ratio measured
    # against it, on a row that looks entirely healthy. There are no NULL daily
    # volumes in the store today (measured 2026-08-23, 0 of ~14M `D` rows), so
    # this is the guard rather than the repair — but `usable_bars` deliberately
    # does not require `v`, so the path is reachable the day a provider drops one.
    #
    # ⭐ A STORED `0` IS KEPT, DELIBERATELY. It is a MEASURED zero-volume
    # session, not an absence, and the audit's reading of it as fabricated did
    # not survive re-measurement: on 2026-08-23 every one of the 56 rows
    # publishing `vol_ratio = 0.0` off a zero-volume newest bar was corroborated
    # share-for-share by yfinance (AVB, EQR, KBON, SORN, ZKP … all `0` in both
    # stores). `0.00×` also behaves correctly under every threshold this column
    # ships — it fails `>= 1.5`, passes `<= 0.5`, and sorts first ascending,
    # which is what "maximally quiet" should do. Blanking those rows would be a
    # repair aimed at a phantom.
    #
    # ⛔ THIS 30-BAR WINDOW IS NOT `avg_volume_30d`'S, and the difference is
    # deliberate. That column is the mean of the last 30 bars INCLUDING today —
    # a liquidity measure. This denominator EXCLUDES today, because a baseline
    # containing the very session being compared against it drags the ratio
    # toward 1 and blunts exactly the spike the column exists to find. Two
    # different windows, one of them each right for its own question.
    #
    # 🔴 KNOWN, AND NOT FIXABLE HERE: THE NUMERATOR CAN BE A PARTIAL SESSION.
    # `bars.db` does not replace the newest daily bar's volume with the official
    # consolidated figure before the nightly build reads it. Measured 2026-08-23
    # on 95 random fresh tickers against yfinance: the prior session matches to
    # the SHARE on every name, while the newest session is short by a **median
    # 10.3%**, 36% of names by more than 20%, worst −69.9% — putting **12.6% of
    # the sample on the wrong side of `vol_ratio >= 1.0`** (JPM publishes 0.77
    # against a true 1.12). ⛔ DO NOT "FIX" IT IN THIS MODULE. The value in
    # question is a session's volume, `bars.db` owns it, and half a dozen other
    # consumers (`avg_volume_30d`, `dollar_vol_30d`, `vol_updown_ratio`,
    # `vol_nweek_low`, setup scoring, the pattern engine) read the same field —
    # healing it here would make this module a second authority over one value
    # and leave every one of them silently wrong. The fix belongs at the bars
    # boundary; it is filed as a requirement in the accuracy report.
    # ⭐ THE ARITHMETIC NOW LIVES IN `volume_ratio` (module level, above) so
    # `bar_character` can name a bar off the SAME number this column filters on.
    # Everything documented in this block still describes that value.
    out["vol_ratio"] = volume_ratio(bars)
    # 52-week high/low distance + new-high flag (today's high vs window)
    yr = bars[-252:] if len(bars) >= 252 else bars
    hi = max(b["h"] for b in yr)
    lo = min(b["l"] for b in yr)
    out["dist_52w_high_pct"] = _pct(price, hi)
    out["dist_52w_low_pct"] = _pct(price, lo)
    out["new_52w_high"] = bars[-1]["h"] >= hi

    # ── Wave 1: performance ──────────────────────────────────────────────
    if len(closes) >= 253:
        out["chg_pct_1y"] = _pct(price, closes[-253])
    out["chg_from_open_pct"] = _pct(price, bars[-1]["o"])
    # YTD = vs the last close of the PRIOR calendar year when the window holds
    # one; a name that listed this year has no YTD baseline and stays None.
    t_last = bars[-1].get("t")
    if t_last is not None and len(str(t_last)) >= 4:
        year = str(t_last)[:4]
        prior = [b for b in bars
                 if b.get("t") is not None and str(b["t"])[:4] < year]
        if prior:
            out["chg_pct_ytd"] = _pct(price, prior[-1]["c"])
    # 5-bar ADR — the range-based weekly volatility (same formula as adr_pct,
    # 5-session window). NOT a stdev; the parity matrix maps Finviz
    # "Volatility W" here and "Volatility M" to the existing adr_pct.
    w5 = [b for b in bars[-5:] if b["c"]]
    if w5:
        out["adr_pct_1w"] = round(
            sum((b["h"] - b["l"]) / b["c"] for b in w5) / len(w5) * 100, 2)
    w20 = bars[-20:]
    out["dist_20d_high_pct"] = _pct(price, max(b["h"] for b in w20))
    out["dist_20d_low_pct"] = _pct(price, min(b["l"] for b in w20))
    out["pole_pct"] = _pole_pct(closes)
    out["atr_ext_sma50"] = _atr_ext_sma50(bars, closes, s50)
    # prev-day OHLC — trigger levels; collapses Live Scan's SSE-fallback
    # second authority (spec §2.1)
    if len(bars) >= 2:
        p = bars[-2]
        out["prev_day_open"], out["prev_day_high"] = p["o"], p["h"]
        out["prev_day_low"], out["prev_day_close"] = p["l"], p["c"]
    return out
