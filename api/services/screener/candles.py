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
import datetime as _datetime

from . import candle_catalog as cat

_DAY = _datetime.timedelta(days=1)


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
             "candle_trend": None, "avg_body": None, "avg_range": None,
             "body_pct": None, "upper_wick_pct": None,
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
    # ⭐ `avg_body` / `avg_range` ARE PUBLISHED SO THE LIVE TIER CAN REUSE THEM.
    # They are rolling means over COMPLETED sessions excluding the newest bar —
    # exactly the "level computed from completed sessions through bars_asof"
    # the live tier's anchor contract requires. Without them an intraday
    # classifier cannot tell a long body from a short one and would have to
    # invent a second definition of "long".
    return {"candle_type": primary.key,
            "candle_label": label,
            # ⚠️ A ZERO BASELINE IS REFUSED, NOT STORED. `avg_body == 0` means
            # every prior bar closed where it opened; comparing a real body
            # against it makes EVERY body "long" (`body > 1.5 * 0`). The
            # classifier already guards with `bool(avg_body)`, so None and 0
            # behave identically downstream — but None is the honest record of
            # "no usable baseline", and a 0 in a stored column sorts and filters.
            "avg_body": round(ctx1.avg_body, 6) if ctx1.avg_body > 0 else None,
            "avg_range": round(ctx1.avg_range, 6) if ctx1.avg_range > 0 else None,
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
    # 🔴 A SESSION THAT NEVER TRADED IS NOT PART OF A COIL. A zero-range bar is
    # trivially "inside" whatever came before it, so a halted or untraded name
    # accumulated an inside-bar run indistinguishable from a genuine tightening.
    # Measured 2026-08-24: of the 124 rows carrying a run of 2 or more, **34 were
    # no-trade sessions**, and of the 32 with a run of 3+, **19 were** — the
    # member-facing "Inside-Bar Run" filter was majority junk at the deep end.
    # ⭐ The run BREAKS on such a bar rather than skipping it: a coil is a
    # CONSECUTIVE narrowing, and a gap in the tape ends the sequence.
    run = 0
    for i in range(n - 1, 0, -1):
        b_i = bars[i]
        if (b_i["h"] - b_i["l"]) <= 0 or not (b_i.get("v") or 0):
            break
        if b_i["h"] <= bars[i - 1]["h"] and b_i["l"] >= bars[i - 1]["l"]:
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


#: How far back the recency lookback reaches. FIVE SESSIONS, not more: a
#: multi-bar reversal that completed a week ago has had a week of price action
#: to invalidate it, and reporting it beside today's bar would imply a currency
#: it no longer has.
RECENT_WINDOW = 5


def recent_relation(bars: list[dict], window: int = RECENT_WINDOW) -> dict:
    """The most recent MULTI-BAR pattern within ``window`` sessions.

    🔴 THE GAP THIS CLOSES. `single_candle` only ever looks at TODAY, and most
    days most stocks print no multi-bar structure at all. Measured 2026-08-24
    over 3,705 tickers: **796 (21.5%) had a multi-bar pattern today, and a
    further 1,425 (38.5%) had one in the previous four sessions** that the
    column could not see. Nearly twice as many rows carried a recent, still-live
    structure as carried one today.

    ⭐ AND A PATTERN THAT COMPLETED YESTERDAY IS OFTEN THE MORE ACTIONABLE ONE:
    it has had a session of follow-through a trader can actually check, which is
    exactly what the confirmation literature says a same-day label cannot claim.

    ⛔ SHAPES ARE EXCLUDED ON PURPOSE. Every bar has a shape, so a shape-inclusive
    lookback would return "Black Candle, 1 day ago" for the whole market and mean
    nothing. Only the sparse multi-bar relations are worth dating.

    Returns the age in sessions (0 = today) alongside the key, so a member can
    tell a fresh signal from a stale one rather than being handed both as equals.
    """
    from . import candle_catalog as cat
    out = {"candle_recent": None, "candle_recent_bars_ago": None,
           "candle_recent_status": None, "candle_recent_label": None}
    if not bars:
        return out
    for age in range(max(1, window)):
        end = len(bars) - age
        if end < 2:
            break
        got = single_candle(bars[:end])
        rels = [cat.BY_KEY[k] for k in cat.decode_matches(got.get("candle_matches") or "")
                if k in cat.RELATION_KEYS]
        if rels:
            best = min(rels, key=lambda p: (p.rank, p.key))
            status = _confirmation(bars, age, best)
            suffix = "" if age == 0 else f" ({age}d ago)"
            if status in ("opened-with", "opened-against"):
                suffix += " — next open went " + (
                    "with it" if status == "opened-with" else "against it")
            return {"candle_recent": best.key,
                    "candle_recent_bars_ago": age,
                    "candle_recent_status": status,
                    "candle_recent_label": best.label + suffix}
    return out


def _confirmation(bars, age, pattern):
    """Did the session AFTER the pattern open in the direction the pattern implies?

    ⭐ THE OPENING GAP IS THE ONLY ONE OF THE THREE CLASSICAL CONFIRMATION
    METHODS WITH MEASURED SUPPORT — Bulkowski put it at 82% against the next
    bar's colour at 13% and its close at 5%. Colour and close are what most
    retail material teaches, and both are close to worthless.

    🔴 BUT WE MEASURED WHAT IT IS ACTUALLY WORTH HERE, AND IT IS NOT EDGE.
    On 2026-08-24 across 1,043 resolved patterns: bullish "confirmed" 59.9%,
    bearish 36.4%. The universe's own opening-gap base rate over those same
    sessions was 51.1% up / 35.8% down — which predicts 59% and 41% BEFORE any
    pattern is considered. The patterns added nothing, and the bearish side came
    in slightly WORSE than chance.

    ⛔ SO THE STATES ARE NAMED FOR WHAT HAPPENED, NOT FOR A VERDICT.
    "Confirmed" would read to a member as evidence the pattern worked, when it
    mostly means the market gapped up that day — which it does about half the
    time. `opened-with` / `opened-against` assert only the fact, which is real
    information about that stock and survives the base-rate problem intact. It
    also keeps the column inside the standing rule that it describes and does not
    forecast.

    ⛔ AND IT IS WHY A SAME-DAY LABEL MAY NOT CLAIM A REVERSAL. StockCharts is
    blunt about it — *"without confirmation, these patterns would be considered
    neutral"* — so a pattern printed TODAY is `provisional` and nothing else. It
    becomes answerable only once a session has opened after it, which is exactly
    what the recency lookback already has in hand for anything older than today.

    ⚠️ A NEUTRAL PATTERN HAS NOTHING TO CONFIRM. Harami cross, tri-star and
    separating lines carry no directional claim, so they return ``None`` rather
    than being forced into a pass/fail they never asserted.
    """
    if pattern.bias not in ("bullish", "bearish"):
        return None
    if age <= 0:
        return "provisional"
    end = len(bars) - age
    if end < 1 or end >= len(bars):
        return "provisional"
    pat_close = bars[end - 1]["c"]
    nxt_open = bars[end]["o"]
    atr = _atr(bars[:end])
    # ⛔ A GAP, NOT A TICK. An open one cent above the close is not the market
    # opening in your favour; it is the same price. Same band the pattern
    # geometry uses, so "meaningfully different" means one thing in this module.
    tick = cat.tick_size(pat_close)
    band = max(0.05 * atr, tick) if atr else tick
    if pattern.bias == "bullish":
        if nxt_open > pat_close + band:
            return "opened-with"
        if nxt_open < pat_close - band:
            return "opened-against"
    else:
        if nxt_open < pat_close - band:
            return "opened-with"
        if nxt_open > pat_close + band:
            return "opened-against"
    return "opened-flat"         # the market declined to vote either way



def _iso_date(ymd) -> str | None:
    """``20260821`` -> ``"2026-08-21"``. The screener's bars key by YYYYMMDD int
    (``bars_sqlite.get_bars``); the shared resampler keys by ISO string."""
    try:
        n = int(ymd)
    except (TypeError, ValueError):
        return None
    y, m, d = n // 10000, (n // 100) % 100, n % 100
    if not (1 <= m <= 12 and 1 <= d <= 31):
        return None
    return f"{y:04d}-{m:02d}-{d:02d}"


def weekly_candle(bars: list[dict]) -> dict:
    """The newest WEEKLY bar's structure, resampled from the daily series.

    ⭐ WHY THIS IS FREE. 2,948 of the screener's 3,707 tickers have NO weekly
    bars in `bars.db` — but every single one of them has DAILY bars (median
    4,626, roughly eighteen years), and the repo already ships a weekly
    resampler. So the whole timeframe comes from data the builder has already
    loaded: no backfill, no provider fetch, and nothing added to the bars
    pipeline, whose prewarmer fanout has an outage precedent.

    ⛔ IT RESAMPLES THROUGH `bars_fetch._resample_weekly_iso` RATHER THAN
    ROLLING ITS OWN. That function owns the stable-Friday-key rationale (an
    in-progress week keeps ONE key as Mon..Fri bars land, so the candle is
    replaced rather than duplicated), and a private copy here would be a second
    authority on what a weekly bar IS.

    ⚠️ THE NEWEST WEEK IS USUALLY IN PROGRESS, AND THE LABEL SAYS SO. A weekly
    hammer that is only three days old is not a weekly hammer yet. The week is
    reported complete only when its last daily bar is a FRIDAY; a holiday-
    shortened week therefore reads as still forming, which understates
    completeness rather than overstating it — the safe direction for a label a
    member may act on.
    """
    return _timeframe_candle(bars, "weekly")


def monthly_candle(bars: list[dict]) -> dict:
    """The newest MONTHLY bar's structure, resampled from the same daily series.

    ⭐ FREE FOR THE SAME REASON WEEKLY WAS: the daily bars are already loaded and
    `bars_fetch._resample_monthly_iso` already exists. A monthly hammer or
    engulfing is a bigger statement again than a weekly one — it took a whole
    month of trading to print — and it costs one more resample of a list the
    builder is holding anyway.
    """
    return _timeframe_candle(bars, "monthly")


#: Each higher timeframe: the shared resampler that owns its bucketing, and the
#: test for whether the newest bucket is CLOSED.
#: ⛔ "Complete" is decided by the calendar, and both tests err toward FORMING —
#: a holiday-shortened week reads as still building rather than finished, which
#: understates completeness. That is the safe direction for a label a member may
#: trade on.
_HIGHER_TF = {
    "weekly": ("_resample_weekly_iso", lambda d: d.isoweekday() == 5),
    "monthly": ("_resample_monthly_iso",
                lambda d: (d.replace(day=28) + _DAY * 4).replace(day=1) - _DAY == d),
}


def _timeframe_candle(bars: list[dict], tf: str) -> dict:
    """Classify the newest bar of a HIGHER timeframe, resampled from daily.

    ⛔ ONE IMPLEMENTATION FOR EVERY HIGHER TIMEFRAME. Weekly and monthly differ
    ONLY in which shared resampler they call and how "the bucket is closed" is
    tested; everything else — the ISO adaptation, the thin-history refusal, the
    forming suffix — is identical. Two copies of this would be two authorities
    on what a resampled candle IS, and they would drift.
    """
    ck, lk = f"candle_{tf}", f"candle_{tf}_label"
    out = {ck: None, lk: None}
    if not bars:
        return out
    from api.services import bars_fetch
    fn_name, is_closed = _HIGHER_TF[tf]
    iso = []
    for b in bars:
        t = _iso_date(b.get("t"))
        if t:
            iso.append({**b, "t": t})
    if len(iso) < 2:
        return out
    higher = getattr(bars_fetch, fn_name)(iso)
    if len(higher) < 2:
        return out
    got = single_candle(higher)
    if got["candle_type"] in (None, "none"):
        return out
    import datetime as _dt
    try:
        forming = not is_closed(_dt.date.fromisoformat(iso[-1]["t"]))
    except (ValueError, TypeError):                       # pragma: no cover
        forming = True
    return {ck: got["candle_type"],
            lk: got["candle_label"] + (" (forming)" if forming else "")}
