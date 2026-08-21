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


def single_candle(bars: list[dict]) -> dict:
    if not bars:
        return {"candle_type": "none", "body_pct": None, "upper_wick_pct": None,
                "lower_wick_pct": None, "close_position": None,
                "wide_bar": False, "narrow_bar": False}
    b = bars[-1]
    o, h, l, c = b["o"], b["h"], b["l"], b["c"]
    rng = max(h - l, 1e-9)
    body = abs(c - o)
    upper = h - max(o, c)
    lower = min(o, c) - l
    body_pct = body / rng
    upper_pct = upper / rng
    lower_pct = lower / rng
    close_pos = (c - l) / rng
    atr = _atr(bars)
    wide = rng > 1.5 * atr if atr else False
    narrow = rng < 0.5 * atr if atr else False

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
