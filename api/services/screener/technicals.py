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
    """The screener's 14-period RSI, or ``None`` when it is not computable.

    ⛔ THE ZERO-MOVEMENT DECISION IS NOT MADE HERE. It is
    ``indicator_compute.rsi_from_wilder_averages``'s, and it is the reason SIM,
    TMTS, CWEN-A, DRDB and OBA no longer read ``rsi14 = 100.0`` beside
    ``chg_pct_1d = 0.00``. Read that function before changing this one.
    """
    from api.services import indicator_compute
    if len(closes) < n + 1:
        return None
    gains = losses = 0.0
    for i in range(len(closes) - n, len(closes)):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0)
        losses += max(-d, 0)
    return indicator_compute.rsi_from_wilder_averages(gains / n, losses / n)


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
    # Volume ratio: today vs prior 30-day average
    vols = [b.get("v") or 0 for b in bars]
    if len(vols) >= 2:
        prior = vols[-31:-1]
        avg = sum(prior) / len(prior) if prior else 0
        out["vol_ratio"] = round(vols[-1] / avg, 2) if avg else None
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
