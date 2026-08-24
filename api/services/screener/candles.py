"""Single-bar and multi-bar candle structure classification from daily bars.

``bars`` is a list of dicts ``{"o","h","l","c","v"}`` ordered oldest -> newest.
All functions are pure and safe on short/empty input.
"""


def _atr(bars, n=14):
    if len(bars) < 2:
        return 0.0
    trs = []
    for i in range(1, len(bars)):
        h, l, pc = bars[i]["h"], bars[i]["l"], bars[i - 1]["c"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    window = trs[-n:] if len(trs) >= n else trs
    return sum(window) / len(window) if window else 0.0


#: The honest answer when the newest bar has no shape to describe. ``dict()``
#: it at every return — a shared mutable would let one caller's edit reach the
#: next.
_NO_SHAPE = {"candle_type": "none", "body_pct": None, "upper_wick_pct": None,
             "lower_wick_pct": None, "close_position": None,
             "wide_bar": False, "narrow_bar": False}


def single_candle(bars: list[dict]) -> dict:
    """Classify the newest bar's shape, or refuse when it has none.

    🔴 THE DEFECT THIS REFUSAL EXISTS FOR — caught by
    ``screener.identities`` on the 2026-08-24 snapshot, by three separate
    identities firing on the same rows (``candle_parts_close_to_one``, 81 of
    3,714; ``fraction_band__body_pct``; ``fraction_band__lower_wick_pct``).

    The guard used to be ``rng = max(h - l, 1e-9)``. On a bar that never moved
    (``o == h == l == c``) that does not prevent the division, it *completes*
    it: every part comes out ``0``, the three fractions sum to ``0`` instead of
    ``1``, ``close_position`` reads ``0.0`` — "closed at the low of its range" —
    and ``body_pct < 0.1`` then labels the bar a **doji**. Measured on the
    2026-08-24 build: **78 rows** carried a zero-range newest bar, **55 of them
    with zero volume**, and every one published ``candle_type = "doji"`` and
    ``close_position = 0.0``. ``candle_type`` is a member-facing enum filter
    (``filters.py``, "Candle Type → Doji") and ``close_position`` a member-facing
    range filter, so a member screening for indecision candles was handed 78
    names that mostly had not traded at all, each with a confident bearish
    close-position beside it.

    ⭐ A ZERO-RANGE BAR IS NOT A DOJI. A doji is a *contest* — buyers and
    sellers ranged over the session and finished where they started. A bar with
    no range had no contest to describe. The parts are ``0/0``: not small, not
    zero, **not computable**, and the house rule for that is an honest absence,
    because a ``0`` here is invisible, it sorts, and it filters.

    ⛔ ``wide_bar``/``narrow_bar`` SURVIVE THE ZERO-RANGE CASE, deliberately.
    They are not shape fractions; they compare a MEASURED range against ATR, and
    ``0 < 0.5 * atr`` is a true statement about a bar that really was the
    narrowest possible. Refusing what is not computable is this module's job;
    deleting a true measurement is not. (⚠️ Whether a *zero-volume* session
    should count as a narrow bar at all is a separate question about no-trade
    sessions — it needs its own measurement and it is not decided here.)

    ⚠️ THE SELF-CONTRADICTING BAR IS A GUARD, NOT A REPAIR: **0 of 3,712**
    tickers with a last daily bar have an open or close outside their own
    high/low today. It is here because ``EWCZ`` and ``MCW`` prove the shape is
    reachable — both publish ``candle_type = "marubozu"`` (maximum conviction)
    off ``body_pct`` near ``5.8e9``, from rows built when they still had bars.
    A bar that contradicts itself cannot be trusted for the ATR comparison
    either, so that case refuses everything.
    """
    if not bars:
        return dict(_NO_SHAPE)
    b = bars[-1]
    o, h, l, c = b["o"], b["h"], b["l"], b["c"]
    rng = h - l
    if min(o, c) < l or max(o, c) > h:
        return dict(_NO_SHAPE)
    atr = _atr(bars)
    wide = rng > 1.5 * atr if atr else False
    narrow = rng < 0.5 * atr if atr else False
    if not (rng > 0):
        return {**_NO_SHAPE, "wide_bar": wide, "narrow_bar": narrow}
    body = abs(c - o)
    upper = h - max(o, c)
    lower = min(o, c) - l
    body_pct = body / rng
    upper_pct = upper / rng
    lower_pct = lower / rng
    close_pos = (c - l) / rng

    # Order matters: one-sided-wick shapes win over the generic doji test so a
    # small-bodied hammer isn't mislabeled a doji.
    ctype = "none"
    if lower_pct > 0.5 and body_pct < 0.35 and upper_pct < 0.15:
        ctype = "hammer"
    elif upper_pct > 0.5 and body_pct < 0.35 and lower_pct < 0.15:
        ctype = "shooting-star"
    elif body_pct < 0.1:
        ctype = "doji"
    elif body_pct > 0.85:
        ctype = "marubozu"
    elif len(bars) >= 2:
        p = bars[-2]
        pbody_lo, pbody_hi = min(p["o"], p["c"]), max(p["o"], p["c"])
        if c > o and o <= pbody_lo and c >= pbody_hi:
            ctype = "bullish-engulfing"
        elif c < o and o >= pbody_hi and c <= pbody_lo:
            ctype = "bearish-engulfing"
        elif body_pct < 0.3:
            ctype = "spinning-top"
    elif body_pct < 0.3:
        ctype = "spinning-top"

    return {"candle_type": ctype, "body_pct": round(body_pct, 4),
            "upper_wick_pct": round(upper_pct, 4),
            "lower_wick_pct": round(lower_pct, 4),
            "close_position": round(close_pos, 4),
            "wide_bar": wide, "narrow_bar": narrow}


def multi_candle(bars: list[dict]) -> dict:
    out = {"inside_bar_run": 0, "tight_consolidation": False,
           "pullback_depth_pct": None, "higher_lows_run": 0, "nr7": False,
           "consecutive_up": 0, "consecutive_down": 0,
           "close_cv_pct": None, "avg_body_pct_5": None}
    n = len(bars)
    if n < 2:
        return out
    # inside-bar run (most recent backward)
    run = 0
    for i in range(n - 1, 0, -1):
        if bars[i]["h"] <= bars[i - 1]["h"] and bars[i]["l"] >= bars[i - 1]["l"]:
            run += 1
        else:
            break
    out["inside_bar_run"] = run
    # NR7: current range is the narrowest of the last 7
    if n >= 7:
        ranges = [bars[i]["h"] - bars[i]["l"] for i in range(n - 7, n)]
        out["nr7"] = ranges[-1] <= min(ranges)
    # tightness: CV of last 10 closes, kept as the NUMBER (the scanner's
    # close_cv_pct); the bool is derived from it at the same 2.5% line so the
    # two can never disagree (previously the bool destroyed the number).
    if n >= 10:
        closes = [b["c"] for b in bars[-10:]]
        mean = sum(closes) / len(closes)
        if mean:
            var = sum((x - mean) ** 2 for x in closes) / len(closes)
            cv_pct = (var ** 0.5) / mean * 100
            out["close_cv_pct"] = round(cv_pct, 2)
            out["tight_consolidation"] = cv_pct < 2.5
    # 5-bar average body fraction (scanner's avg_body_pct, promoted)
    bodies = []
    for b in bars[-5:]:
        rng = b["h"] - b["l"]
        if rng > 0:
            bodies.append(abs(b["c"] - b["o"]) / rng)
    if bodies:
        out["avg_body_pct_5"] = round(sum(bodies) / len(bodies), 3)
    # higher-lows run
    hl = 0
    for i in range(n - 1, 0, -1):
        if bars[i]["l"] > bars[i - 1]["l"]:
            hl += 1
        else:
            break
    out["higher_lows_run"] = hl
    # pullback depth from recent 20-bar high to last close
    window = bars[-20:] if n >= 20 else bars
    hi = max(b["h"] for b in window)
    if hi:
        out["pullback_depth_pct"] = round((hi - bars[-1]["c"]) / hi * 100, 2)
    # consecutive up/down closes
    up = down = 0
    for i in range(n - 1, 0, -1):
        if bars[i]["c"] > bars[i - 1]["c"]:
            if down:
                break
            up += 1
        elif bars[i]["c"] < bars[i - 1]["c"]:
            if up:
                break
            down += 1
        else:
            break
    out["consecutive_up"], out["consecutive_down"] = up, down
    return out
