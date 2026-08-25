"""Single-bar and multi-bar candle structure classification from daily bars.

``bars`` is a list of dicts ``{"o","h","l","c","v"}`` ordered oldest -> newest.
All functions are pure and safe on short/empty input.

⭐ THE ARCHITECTURE, AND THE DEFECT IT REPLACES. Structure has TWO orthogonal
axes and the old chain fused them into one ``if/elif``:

  SHAPE    — single-bar morphology. A TOTAL partition: every bar has exactly
             one, always. Lives in ``candle_catalog.classify_shape``.
  RELATION — multi-bar structure. SPARSE: zero or many may hold at once.
             Collected INDEPENDENTLY, never in an ``elif``.

Fusing them made every shape branch short-circuit every relation branch, which
is three defects at once: a doji that was also an engulfing reported only
"doji"; a hammer could never also be a bullish engulfing; and — the big one — a
bar with body/range in [0.30, 0.85] that was not engulfing reached NO branch and
kept ``"none"``. Measured on the 2026-08-24 build: **1,620 of 3,714 rows
(43.6%)** carried a dash, and every single one was a fully measured bar. The
most common bar in the market had no name in the library.

The pipeline is: guard -> build context (incl. trend) -> classify shape ->
collect every relation -> rank -> render. Nothing is discarded during
classification, so ``candle_matches`` holds the COMPLETE set and filters query
that rather than the rendered head.
"""
from . import candle_catalog as cat


def _atr(bars, n=14):
    if len(bars) < 2:
        return 0.0
    trs = []
    for i in range(1, len(bars)):
        h, l, pc = bars[i]["h"], bars[i]["l"], bars[i - 1]["c"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    window = trs[-n:] if len(trs) >= n else trs
    return sum(window) / len(window) if window else 0.0


def _ema(values, n):
    """EMA series over ``values``; returns the full series so a slope is cheap."""
    if not values:
        return []
    k = 2.0 / (n + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def _trend(bars, first_i, atr):
    """Prior trend for a pattern whose FIRST bar is at index ``first_i``.

    ⭐ ANCHOR AT THE PATTERN'S FIRST BAR, MA THROUGH THE BAR BEFORE IT — so the
    pattern can never define its own trend. For a 3-bar pattern that is
    today-2 and today-3. Every authority that anchors at all anchors here;
    TA-Lib anchors nowhere, which is why 41 of its 61 CDL files carry a verbatim
    disclaimer telling the caller to supply the trend themselves.

    ⭐ HAVING A GATE MATTERS ENORMOUSLY; TUNING IT MATTERS ALMOST NOTHING.
    Caginalp & Laurent measured the gate itself as 45.05% -> 71.22% (Z=36),
    while Lu/Chen/Hsu found the result does not depend on which average is used
    (MA3 vs EMA10 vs Levy). So this is Morris's EMA(10) rule, hardened with a
    slope test and a dead zone, and nobody should spend time optimizing the 10.

    Returns one of ``up`` / ``down`` / ``neutral`` / ``unknown``. On anything but
    a clear read the caller emits the GEOMETRY name — never a directional guess.
    """
    n = len(bars)
    first = n + first_i if first_i < 0 else first_i
    anchor = first - 1
    if anchor < 40:                       # not enough history to have a trend
        return "unknown"
    closes = [b["c"] for b in bars[:anchor + 1]]
    ema = _ema(closes, 10)
    if len(ema) < 4:
        return "unknown"
    now, back3 = ema[-1], ema[-4]
    b1 = bars[first]
    mid = (b1["o"] + b1["c"]) / 2.0
    dead = 0.25 * atr                     # ⭐ a dead zone, so a flat tape reads
    if mid > now + dead and now > back3:  # "neutral" instead of manufacturing
        return "up"                       # a direction out of noise
    if mid < now - dead and now < back3:
        return "down"
    return "neutral"


#: The honest answer when the newest bar has no shape to describe. ``dict()``
#: it at every return — a shared mutable would let one caller's edit reach the
#: next.
_NO_SHAPE = {"candle_type": "none", "candle_label": None, "candle_matches": None,
             "candle_trend": None, "body_pct": None, "upper_wick_pct": None,
             "lower_wick_pct": None, "close_position": None,
             "wide_bar": False, "narrow_bar": False}


def _build_ctx(bars, pattern_bars, atr, wide, narrow):
    """One context per pattern LENGTH, because trend is anchored per pattern."""
    b = bars[-1]
    o, h, l, c = b["o"], b["h"], b["l"], b["c"]
    rng = h - l
    body, upper, lower = abs(c - o), h - max(o, c), min(o, c) - l
    hist = bars[:-1]
    bodies = [abs(x["c"] - x["o"]) for x in hist[-cat.BODY_AVG_N:]]
    ranges = [x["h"] - x["l"] for x in hist[-cat.RANGE_AVG_N:]]
    r5 = [x["h"] - x["l"] for x in hist[-5:]]
    tick = cat.tick_size(c)
    return cat.BarCtx(
        bars=bars, o=o, h=h, l=l, c=c, v=b.get("v") or 0,
        rng=rng, body=body, upper=upper, lower=lower,
        body_pct=body / rng, upper_pct=upper / rng, lower_pct=lower / rng,
        close_pos=(c - l) / rng,
        avg_body=sum(bodies) / len(bodies) if bodies else 0.0,
        avg_range=sum(ranges) / len(ranges) if ranges else 0.0,
        avg_range5=sum(r5) / len(r5) if r5 else 0.0,
        atr=atr, tick=tick,
        noise=rng < max(cat.MIN_RANGE_TICKS * tick, cat.MIN_RANGE_PCT * c),
        trend=_trend(bars, -pattern_bars, atr),
        up=c >= o,
    )


def single_candle(bars: list[dict]) -> dict:
    """Name the newest bar, or refuse when it has no shape to name.

    🔴 THE DEFECT THIS REFUSAL EXISTS FOR — caught by ``screener.identities`` on
    the 2026-08-24 snapshot by three separate identities firing on the same rows
    (``candle_parts_close_to_one``, 81 of 3,714; ``fraction_band__body_pct``;
    ``fraction_band__lower_wick_pct``).

    The guard used to be ``rng = max(h - l, 1e-9)``. On a bar that never moved
    (``o == h == l == c``) that does not prevent the division, it *completes*
    it: every part comes out ``0``, the three fractions sum to ``0`` instead of
    ``1``, ``close_position`` reads ``0.0`` — "closed at the low of its range" —
    and ``body_pct < 0.1`` then labels the bar a **doji**. Measured on the
    2026-08-24 build: **78 rows** carried a zero-range newest bar, **55 of them
    with zero volume**, and every one published ``candle_type = "doji"``.

    ⭐ A ZERO-RANGE BAR IS NOT A DOJI. A doji is a *contest* — buyers and
    sellers ranged over the session and finished where they started. A bar with
    no range had no contest to describe. The parts are ``0/0``: not small, not
    zero, **not computable**, and the house rule for that is an honest absence,
    because a ``0`` here is invisible, it sorts, and it filters.

    ⛔ ``wide_bar``/``narrow_bar`` SURVIVE THE ZERO-RANGE CASE, deliberately.
    They are not shape fractions; they compare a MEASURED range against ATR, and
    ``0 < 0.5 * atr`` is a true statement about a bar that really was the
    narrowest possible.

    ⚠️ THE SELF-CONTRADICTING BAR IS A GUARD, NOT A REPAIR: **0 of 3,712**
    tickers with a last daily bar have an open or close outside their own
    high/low today. It is here because ``EWCZ`` and ``MCW`` prove the shape is
    reachable — both published ``candle_type = "marubozu"`` off ``body_pct``
    near ``5.8e9``.

    ⚠️ THESE TWO REFUSALS ARE THE ONLY WAY OUT WITHOUT A NAME. Everything else
    is named: ``classify_shape`` is total by construction, so a bar that clears
    the guards ALWAYS leaves here with a label.
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

    # ── classify: the shape is TOTAL, so this always yields exactly one key ──
    ctx1 = _build_ctx(bars, 1, atr, wide, narrow)
    shape = cat.classify_shape(ctx1)
    matched = [cat.BY_KEY[shape]]

    # ── collect: every relation, independently. ⛔ NEVER an elif — a relation
    # that loses the render must still reach `candle_matches`, or "screen for
    # hammer" silently drops every hammer that was also an engulfing.
    ctx_by_len = {1: ctx1}
    for p in cat.RELATIONS:
        if len(bars) < p.bars + 1:
            continue
        # ⛔ A RELATION MAY NOT BE BUILT ON A BAR THAT NEVER TRADED. The
        # newest-bar refusal above protects only bars[-1]; a NEIGHBOUR with no
        # range slips straight into a multi-bar predicate. Measured 2026-08-24:
        # POLE published `abandoned-baby-bearish` — an "island gap" — where the
        # star and the bar before it were BOTH zero-range no-trade sessions on a
        # $10.85 name. A session with no range has no structure to contribute,
        # so the whole window has to be real.
        if any((x["h"] - x["l"]) <= 0 for x in bars[-p.bars:]):
            continue
        ctx = ctx_by_len.get(p.bars)
        if ctx is None:
            ctx = ctx_by_len[p.bars] = _build_ctx(bars, p.bars, atr, wide, narrow)
        try:
            if p.detect(ctx):
                matched.append(p)
        except (KeyError, TypeError, ZeroDivisionError):
            continue          # a malformed neighbour costs its pattern, not the row

    # ── rank and render. `rank` is ordering only and never reaches a member. ──
    matched.sort(key=lambda p: (p.rank, p.key))
    primary, rest = matched[0], matched[1:]
    label = primary.label
    if rest:
        label += f" ({rest[0].label})"
        if len(rest) > 1:
            label += f" +{len(rest) - 1}"

    keys = [p.key for p in matched]
    keys += [a for k in keys if (a := cat.LEGACY_ALIASES.get(k)) and a not in keys]

    # ⭐ REPORT THE TREND THE RENDERED PATTERN WAS JUDGED AGAINST. Each pattern
    # gates on its OWN anchor (a 3-bar pattern reads the trend at today-3), so
    # publishing the 1-bar anchor unconditionally put "neutral" beside NKLR's
    # Three White Soldiers — a pattern that only fires in a downtrend. The
    # column and the label now answer the same question.
    return {"candle_type": primary.key,
            "candle_label": label,
            "candle_matches": cat.encode_matches(keys),
            "candle_trend": ctx_by_len.get(primary.bars, ctx1).trend,
            "body_pct": round(ctx1.body_pct, 4),
            "upper_wick_pct": round(ctx1.upper_pct, 4),
            "lower_wick_pct": round(ctx1.lower_pct, 4),
            "close_position": round(ctx1.close_pos, 4),
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
