"""The member "base" drawing: the current base's extent, its pivot (breakout level) and its low.

DISPLAY ONLY. Nothing here is read by any detector, confidence, HIST_SCORE or `confirmed_only`.

Shape-agnostic (lab base_draw, 2026-10-18): a base is the bars under a CEILING that the candle bodies have
not closed above, whatever the shape underneath -- flat, cup-like, a double bottom or a long sideways range.
The team marks a base with its breakout line on the tops of the bodies (the lab's characterisation of the
team's own drawn charts: the line sits within 0.5 ATR of the base's highest body on 89% of charts, of its
highest wick on 60%), so the pivot is the top CLUSTER of body tops, not the highest wick.

The lab rule passed its pre-registered checks AS DRAWN here (lab/base_draw/PREREG.txt):
  * team axis, held-out half: a team line within 0.5 ATR of the pivot on 14 of 17 drawn charts (82%) vs
    33% for the drawer's pivots carried over from random other charts (lift CI above 0). A naive line
    on the 20-bar highest body hits 13 of 17 on the same charts, so the pivot PRICE is not where this
    rule adds value: its value is WHEN it draws (a real base, near its pivot) and the extent it draws;
  * the extent test (T2) is NOT validated against extents the team drew: the "team base" there is
    derived from the team's ceiling line by the lab's own span rule, and the test against team-drawn
    boxes had a single comparison (reported, not gated);
  * two fresh blind AI-judge packets ("is this the base and its breakout level?").

`base_drawing(bars, i)` reads bars[:i+1] only (no lookahead) and returns the drawing or None. Bars are
{t, o, h, l, c, v} dicts, oldest first.

Two drawing rounds live here, chosen by `draw_round`:
  * ROUND 1 -- the confirmed member drawing: a verbatim port of the lab's rule_bd.base_drawing
    (parity-railed in tests/test_base_draw_lab_parity.py); the constants are the lab's frozen PARAMS.
  * ROUND 2 -- lab base_draw_v2. Round 1 put the pivot on the top CLUSTER of body
    tops, so a base whose highest body stands alone -- a spike bar at the base's start, a single high
    day inside it -- was drawn with its pivot UNDER that body, in the bar (blind judges, lab
    base_metrics: "the pivot sits mid-body, well under the real left-side top"). Round 2 puts the
    pivot on the HIGHEST body top of the drawn region (lip .. the bar before the as-of bar), the level
    the team's own lines sit on (lab base_draw DEV: within 0.5 ATR of the base's highest body on 89%
    of team charts, the highest wick 60%). Every gate then reads that pivot. Round 2 also withholds a
    deep pullback straight after a parabolic run (PARABOLIC_RUN / PARABOLIC_DEPTH): a blow-off
    unwinding is not a base.
  * Rounds 2 and 4 draw nothing unless the as-of close is above a RISING 200-day average (`trend_ok`, round 4's
    textbook floor lifted to the whole chart, 2026-10-23): a "base" under a falling 200-day is a pause in a
    downtrend, not a buyable base (O'Neil; the trend template). The shelf pivot, the double bottom and the
    member path's base rows read the same `trend_ok`.
  * ROUND 4 (BASE_DRAW_ROUND) -- lab base_draw_v4, "textbook consolidation". Wherever round 2 draws,
    round 4 returns round 2's drawing UNCHANGED. Only where round 2 draws nothing, a second pass over
    round 2's own candidates admits one whose ONLY round-2 failures are a single touch of the pivot
    region and/or a lip reached from above, when it also meets the textbook floors (TB_*): at least
    5 weeks long, at most 35% deep, after a prior advance of at least 30% from a real low, the close
    above a RISING 200-day average, no pending deal (deal_status.price_pinned), and the region
    starting AT the left-side high (no high inside it or in the 30 sessions before it above the lip's
    high + 0.5 ATR, no candle body there above the pivot + 0.25 ATR). Pivot, low, label and selection are round 2's. Passed two
    pre-registered blind packets (A 2.86 [2.72, 2.98], B 2.96 [2.90, 3.00]) and a regression packet
    where round 2 draws (25 of 25 identical). Parity-railed against the lab rule in
    tests/test_base_draw_round4.py. Round 3 (a shelf under a higher peak) failed held-out and is
    not drawable here; the number is not reused.
  * ROUND 5 (BASE_DRAW_ROUND) -- the depth-floor lab round, "not a dead range". A REMOVAL-ONLY guard: round 4's
    drawing UNCHANGED, or nothing where `floor_refuses` says the drawn region is not a base at all --
      SHALLOW  depth (pivot - base low) / pivot under base_metrics.MIN_LABEL_DEPTH_PCT (the label's own
               too_shallow floor, read, never restated: the drawing and its label withhold together);
      DEAD     the region's median true range (a fraction of the prior close) under FLOOR_DEAD_VOL_RATIO of
               the stock's own median over the FLOOR_NORM_BARS sessions before the region, AND the depth under
               FLOOR_DEAD_DEPTH_NORM of those normal daily ranges; applied only with at least FLOOR_NORM_MIN
               readable sessions before the region.
    Every gate above is in ATR units, so a gap-then-flat range whose ATR collapsed clears them all; this floor
    is in the stock's own normal units. It covers the round-2 path too: wherever round 2 draws, round 4 IS
    that drawing, and round 5 reads round 4's. Pre-registered: no approved case dropped; the refused set
    scored 0.90 of 3 by blind judges. Parity-railed against the lab rule in tests/test_base_draw_round5.py.
    Every OTHER member base drawing (the base boxes, the detectors, the shapes, the shelf pivot) is put through
    the same floor on the member path: auto_structures.member_base_floor.
Members are served the round auto_structures.MEMBER_BASE_ROUND names (a literal).
"""
from __future__ import annotations

#: The base drawing round this code IS. A row drawn by `base_drawing` carries extras.draw_round =
#: BASE_DRAW_ROUND; the member set serves only the confirmed round (auto_structures.MEMBER_BASE_ROUND,
#: a literal). Bump it with every new base drawing.
BASE_DRAW_ROUND = 5
#: Every round this module can draw (round 3 is not one: it failed its held-out check).
DRAW_ROUNDS = (1, 2, 4, 5)
#: The labels the judges saw.
PIVOT_LABEL = "pivot"
LOW_LABEL = "base low"

# -- the lab's frozen PARAMS (lab/base_draw/rule_bd.py; PREREG.hashes) --
#: Longest base, in bars from the lip to the as-of bar; candidates come from this window.
LOOK = 180
#: Shortest base, in bars.
MIN_LEN = 15
#: A body top may poke this many ATR(14) over the ceiling inside the base.
BODY_TOL = 0.25
#: A body top within this many ATR under the pivot is a touch (and the lip is the first such bar).
TOUCH = 0.5
#: The pivot is the top cluster of body tops within this many ATR (>= 2 of them).
CLUSTER = 0.25
#: The first and last touch groups at least this many bars apart.
MIN_TOUCH_SEP = 10
#: A pullback between the first and last touch at least this many ATR under the pivot.
MIN_DEPTH_ATR = 1.5
#: Deepest base, as a fraction of the pivot ...
MAX_DEPTH = 0.5
#: ... and in ATR.
MAX_DEPTH_ATR = 10.0
#: The as-of close within [pivot - NEAR_BELOW ATR, pivot + MAX_EXT ATR].
NEAR_BELOW = 1.5
MAX_EXT = 1.5
#: Touches within this many sessions form one group.
GAP = 3
#: The lip is reached from below: at least this many bars of the span lie before it.
PRIOR_BARS = 5
#: The lip's high is at least the close this many bars before it (the base follows an advance).
ADV_BARS = 60
MIN_ADV = 0.0
#: The highest body top of the RIGHT_BARS bars before the as-of bar reaches pivot - RIGHT_ATR ATR.
RIGHT_BARS = 10
RIGHT_ATR = 2.0
#: The as-of close and the pivot both above the TREND_N-day SMA of closes.
TREND_N = 200
#: No high in the PEAK_BARS bars before the lip above pivot + PEAK_ATR ATR (not a shelf under a peak).
PEAK_BARS = 30
PEAK_ATR = 2.0

# -- round 2 only (lab base_draw_v2/PREREG.txt; calibrated on DEV-dated bars only) --
#: The run into the lip: the lip's high over the lowest low of the RUN_BARS bars before it ...
RUN_BARS = 60
#: ... at least this multiple is a PARABOLIC run ...
PARABOLIC_RUN = 3.0
#: ... and a base at least this deep (a fraction of the pivot) ...
PARABOLIC_DEPTH = 0.30
#: ... and SHORTER than this many sessions (7 weeks) straight after one is withheld: the run unwinding,
#: not a base. On DEV a 3x run was followed by team-marked bases 22% deep / 20 bars and 49% deep / 115 bars;
#: neither is withheld.
PARABOLIC_MAX_LEN = 35

# -- round 4 only: the textbook floors (lab base_draw_v4/PREREG.txt FROZEN; chosen on DEV-dated bars only) --
#: Shortest admitted base, in sessions from the lip to the as-of bar (5 weeks).
TB_MIN_LEN = 25
#: Deepest admitted base, (pivot - base low) / pivot.
TB_MAX_DEPTH = 0.35
#: The lip's high over the prior REAL low (below) is at least 1 + this.
TB_MIN_ADV = 0.30
#: The prior low is the lowest low of the TB_ADV_WIN sessions before the lip ...
TB_ADV_WIN = 126
#: ... and also the lowest low of the TB_REAL_LOW_BARS sessions before IT (a trough, not a falling window edge).
TB_REAL_LOW_BARS = 20
#: The TREND_N-day average of closes at the as-of bar is above its value this many sessions earlier.
TB_SMA_RISE_BARS = 20
#: No high inside the region, nor in the TB_LEFT_CLEAR_BARS sessions before the lip, above the lip's
#: high + TB_HH_TOL_ATR ATR(14): the region starts at the left-side high.
TB_HH_TOL_ATR = 0.5
TB_LEFT_CLEAR_BARS = 30
#: No candle body in those TB_LEFT_CLEAR_BARS sessions above the pivot + BODY_TOL ATR.
TB_LEFT_BODY_CLEAR = True

# -- round 5 only: the floor (the depth-floor lab round, pre-registered and frozen) --
#: The shallowest drawn base, (pivot - base low) / pivot, is the label's own floor
#: (base_metrics.MIN_LABEL_DEPTH_PCT), read per call by `_floor_min_depth`: never restated here.
#: A region whose median true range (as a fraction of the prior close) is under this share of the stock's own
#: median over the FLOOR_NORM_BARS sessions before the region ...
FLOOR_DEAD_VOL_RATIO = 0.30
#: ... AND whose depth is under this many of those normal daily ranges is a dead range, not a base.
FLOOR_DEAD_DEPTH_NORM = 1.5
FLOOR_NORM_BARS = 252
#: Fewer readable sessions before the region than this: the volatility test is not applied.
FLOOR_NORM_MIN = 60


def _f(b, k):
    return float(b[k])


def _atr(bars, i, n=14):
    k = max(1, i - n + 1)
    trs = [max(_f(bars[j], "h"), _f(bars[j - 1], "c")) - min(_f(bars[j], "l"), _f(bars[j - 1], "c"))
           for j in range(k, i + 1)]
    return sum(trs) / len(trs) if trs else None


def _bt(x):
    o, c = float(x["o"]), float(x["c"])
    return o if o > c else c


def _cluster_top(vals, tol):
    hs = sorted(vals, reverse=True)
    for h in hs:
        cl = [x for x in hs if h - tol <= x <= h]
        if len(cl) >= 2:
            cl.sort()
            return cl[len(cl) // 2]
    return hs[0] if hs else None


def _groups(idx, gap):
    out, last = [], -99
    for j in idx:
        if j - last >= gap:
            out.append([])
        out[-1].append(j)
        last = j
    return out


def _candidates(bars, i):
    lo = max(2, i - LOOK)
    hi = i - MIN_LEN
    bt = {k: _bt(bars[k]) for k in range(max(0, lo - 2), i)}
    out = []
    for k in range(lo, hi + 1):
        v = bt[k]
        if all(v >= bt[m] for m in range(k - 2, min(i - 1, k + 2) + 1) if m != k and m in bt):
            out.append(k)
    return out


def trend_ok(closes, i) -> bool:
    """The trend floor every member-visible bullish base drawing applies (round 4's rule, lifted here so the
    shelf pivot, the double bottom and the member path read the same one): the close at bar `i` above the
    TREND_N-day average of closes, and that average above its value TB_SMA_RISE_BARS sessions earlier (the
    trend template's "above a RISING 200-day"). `closes` is any sequence of closes, oldest first; only
    closes[:i+1] are read. False without the history to tell."""
    if not isinstance(i, int) or i - TB_SMA_RISE_BARS - TREND_N + 1 < 0 or i >= len(closes):
        return False
    s200 = sum(float(x) for x in closes[i - TREND_N + 1:i + 1]) / TREND_N
    s200p = sum(float(x) for x in closes[i - TB_SMA_RISE_BARS - TREND_N + 1:i - TB_SMA_RISE_BARS + 1]) / TREND_N
    return float(closes[i]) > s200 and s200 > s200p


def _evaluate(bars, i, a, k, rnd=1, waive=False):
    """One candidate base at bar k as round `rnd` judges it, or None. With `waive` (round 4's second pass
    only) a lip reached from above ("no_lip") and a single touch of the pivot region ("one_touch") are
    recorded in the result's "waived" instead of rejecting it -- with the single touch waived, the pullback
    check reads the whole region's lows -- and every other gate applies exactly as without it."""
    b = bars
    C = _bt(b[k])
    j = i - 1
    stop = max(0, i - LOOK - 1)
    while j > stop and _bt(b[j]) <= C + BODY_TOL * a:
        j -= 1
    left = j + 1
    lip = next((m for m in range(left, i) if _bt(b[m]) >= C - TOUCH * a), None)
    if lip is None:
        return None
    waived = []
    if lip - left < PRIOR_BARS:
        if not waive:
            return None
        waived.append("no_lip")
    n = i - lip
    if n < MIN_LEN or n > LOOK:
        return None
    if rnd == 1:
        piv = _cluster_top([_bt(b[m]) for m in range(lip, i)], CLUSTER * a)
    else:
        # round 2: the pivot is the TOP of the drawn base -- its highest body, a spike bar at the lip included
        piv = max(_bt(b[m]) for m in range(lip, i))
    t = [m for m in range(lip, i) if _bt(b[m]) >= piv - TOUCH * a]
    gs = _groups(t, GAP)
    if len(gs) < 2 or gs[-1][0] - gs[0][0] < MIN_TOUCH_SEP:
        if not waive:
            return None
        waived.append("one_touch")
        mid = [_f(b[m], "l") for m in range(lip, i)]
    else:
        mid = [_f(b[m], "l") for m in range(gs[0][-1], gs[-1][0] + 1)]
    if not mid or min(mid) > piv - MIN_DEPTH_ATR * a:
        return None
    low_i = min(range(lip, i), key=lambda m: (_f(b[m], "l"), m))
    low = _f(b[low_i], "l")
    depth = (piv - low) / piv
    if depth > MAX_DEPTH or depth <= 0:
        return None
    c = _f(b[i], "c")
    if not (piv - NEAR_BELOW * a <= c <= piv + MAX_EXT * a):
        return None
    if any(_f(b[m], "c") > piv + BODY_TOL * a for m in range(lip, i)):
        return None
    a0 = max(0, lip - ADV_BARS)
    if (_f(b[lip], "h") - _f(b[a0], "c")) / _f(b[a0], "c") < MIN_ADV:
        return None
    pk0 = max(0, lip - PEAK_BARS)
    if lip > pk0 and max(_f(b[m], "h") for m in range(pk0, lip)) > piv + PEAK_ATR * a:
        return None
    if (piv - low) / a > MAX_DEPTH_ATR:
        return None
    if rnd != 1:
        # round 2: a deep pullback straight after a parabolic run is a blow-off unwinding, not a base
        r0 = max(0, lip - RUN_BARS)
        floor = min(_f(b[m], "l") for m in range(r0, lip + 1))
        if (floor > 0 and _f(b[lip], "h") / floor >= PARABOLIC_RUN and depth >= PARABOLIC_DEPTH
                and n < PARABOLIC_MAX_LEN):
            return None
    if i - 1 <= lip or max(_bt(b[m]) for m in range(max(lip + 1, i - RIGHT_BARS), i)) < piv - RIGHT_ATR * a:
        return None
    if i + 1 < TREND_N:
        return None
    s200 = sum(_f(x, "c") for x in b[i - TREND_N + 1:i + 1]) / TREND_N
    if c <= s200 or piv <= s200:
        return None
    d = {"pivot": float(piv), "lip": lip, "low": float(low), "low_i": low_i, "len": n,
         "close_minus_pivot_atr": (c - piv) / a}
    if waive:
        d.update(waived=tuple(waived), depth=depth)
    return d


def _textbook_ok(b, i, a, d) -> bool:
    """Round 4: a candidate that failed round 2 ONLY on the waived gates is admitted only on the textbook
    floors (TB_*), all reading b[:i+1]."""
    lip, piv, n = d["lip"], d["pivot"], d["len"]
    if n < TB_MIN_LEN:
        return False
    if d["depth"] > TB_MAX_DEPTH:
        return False
    lip_h = _f(b[lip], "h")
    # the region starts at the left-side high: no higher high inside it ...
    if any(_f(b[m], "h") > lip_h + TB_HH_TOL_ATR * a for m in range(lip + 1, i)):
        return False
    if TB_LEFT_CLEAR_BARS:
        l0 = max(0, lip - TB_LEFT_CLEAR_BARS)
        # ... nor in the sessions just before it (not a shelf under a higher peak) ...
        if lip > l0 and max(_f(b[m], "h") for m in range(l0, lip)) > lip_h + TB_HH_TOL_ATR * a:
            return False
        # ... and the region does not begin just after the real top's bodies
        if TB_LEFT_BODY_CLEAR and lip > l0 and max(_bt(b[m]) for m in range(l0, lip)) > piv + BODY_TOL * a:
            return False
    # a prior advance from a REAL low: the lowest low of the TB_ADV_WIN sessions before the lip (the latest
    # on a tie), which is also the lowest of the TB_REAL_LOW_BARS sessions before it
    w0 = max(0, lip - TB_ADV_WIN)
    if lip - w0 < 2:
        return False
    lo_i = min(range(w0, lip), key=lambda m: (_f(b[m], "l"), -m))
    lo = _f(b[lo_i], "l")
    r0 = lo_i - TB_REAL_LOW_BARS
    if r0 < 0 or any(_f(b[m], "l") < lo for m in range(r0, lo_i)):
        return False
    adv = lip_h / lo - 1.0 if lo > 0 else 0.0
    if adv < TB_MIN_ADV:
        return False
    # the close above a RISING 200-day average: base_drawing applied trend_ok before any candidate was read
    return True


def _textbook_drawing(bars, i):
    """Round 4's own drawing where round 2 draws nothing, or None. Same dict shape as `base_drawing`."""
    try:
        if not isinstance(i, int) or i < MIN_LEN + 5 or i >= len(bars):
            return None
        b = bars[:i + 1]
        a = _atr(b, i)
        if not a or a <= 0:
            return None
        seen, cands = set(), []
        for k in _candidates(b, i):
            d = _evaluate(b, i, a, k, 2, waive=True)
            if d is None or not d["waived"] or not _textbook_ok(b, i, a, d):
                continue
            if (d["lip"], round(d["pivot"], 8)) in seen:
                continue
            seen.add((d["lip"], round(d["pivot"], 8)))
            cands.append(d)
        if not cands:
            return None
        # not a pending deal: a price pinned to a deal is not a base (bars only, no news read)
        from api.services import deal_status
        if deal_status.price_pinned(b) is not None:
            return None
        best = None
        for d in cands:
            key = (abs(d["close_minus_pivot_atr"]), -d["len"])
            if best is None or key < best[0]:
                best = (key, d)
        d = best[1]
        return {"pivot": d["pivot"], "start_t": int(b[d["lip"]]["t"]), "end_t": int(b[i]["t"]),
                "low": d["low"], "low_t": int(b[d["low_i"]]["t"]), "bars": d["len"], "atr": float(a),
                "label": PIVOT_LABEL, "low_label": LOW_LABEL}
    except (KeyError, TypeError, ValueError, ZeroDivisionError, IndexError):
        return None


def _floor_min_depth() -> float:
    """Round 5's SHALLOW floor as a fraction: base_metrics.MIN_LABEL_DEPTH_PCT (a percentage), read per call."""
    from api.services import base_metrics
    return base_metrics.MIN_LABEL_DEPTH_PCT / 100.0


def _trp(b, j):
    """Bar j's true range as a fraction of the prior close, or None when that close is not positive."""
    pc = _f(b[j - 1], "c")
    return (max(_f(b[j], "h"), pc) - min(_f(b[j], "l"), pc)) / pc if pc > 0 else None


def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2.0


def floor_refuses(bars, i, d) -> bool:
    """Round 5: True when drawing `d` ({start_t, pivot, low}) at bar `i` is not a base -- too shallow, or a
    volatility-collapsed range with no correction. Reads bars[:i+1] only. A drawing whose region start is not
    found before bar `i` refuses nothing; an unreadable volatility norm skips the DEAD test only."""
    lip = next((m for m in range(i, -1, -1) if int(bars[m]["t"]) == int(d["start_t"])), None)
    if lip is None or lip >= i:
        return False
    piv, low = float(d["pivot"]), float(d["low"])
    depth = (piv - low) / piv if piv > 0 else None
    if depth is None or depth < _floor_min_depth():
        return True
    inside = [x for x in (_trp(bars, j) for j in range(max(1, lip + 1), i + 1)) if x is not None]
    norm = [x for x in (_trp(bars, j) for j in range(max(1, lip - FLOOR_NORM_BARS), lip)) if x is not None]
    if len(norm) < FLOOR_NORM_MIN:
        return False
    in_atrp = _median(inside) if inside else None
    n_atrp = _median(norm)
    # a zero median is unreadable (no ratio), exactly as in the lab rule
    if not in_atrp or not n_atrp:
        return False
    return in_atrp / n_atrp < FLOOR_DEAD_VOL_RATIO and depth / n_atrp < FLOOR_DEAD_DEPTH_NORM


def base_drawing(bars: list, i: int, draw_round: int | None = None):
    """The base drawing at bar `i` from bars[:i+1] only, or None:
    {pivot, start_t (the lip), end_t (bar i), low, low_t, bars, atr (ATR(14) at bar i), label,
    low_label}.
    Of every valid candidate base, the one whose pivot is NEAREST the as-of close (ties: the longer).
    `draw_round` picks the round (DRAW_ROUNDS); None is BASE_DRAW_ROUND, anything else draws nothing."""
    try:
        rnd = BASE_DRAW_ROUND if draw_round is None else draw_round
        if type(rnd) is not int or rnd not in DRAW_ROUNDS:
            return None
        if not isinstance(i, int) or isinstance(i, bool) or i < MIN_LEN + 5 or i >= len(bars):
            return None
        # rounds 2, 4 and 5 (the member rounds): no bullish base under a falling 200-day (round 1, the lab port,
        # is unchanged)
        if rnd != 1 and not trend_ok([_f(x, "c") for x in bars[:i + 1]], i):
            return None
        if rnd == 5:
            # round 5 IS round 4, minus the drawings the floor refuses
            d4 = base_drawing(bars, i, draw_round=4)
            return None if d4 is not None and floor_refuses(bars[:i + 1], i, d4) else d4
        if rnd == 4:
            # round 4 IS round 2 wherever round 2 draws; its own pass runs only where round 2 draws nothing
            d2 = base_drawing(bars, i, draw_round=2)
            return d2 if d2 is not None else _textbook_drawing(bars, i)
        b = bars[:i + 1]
        a = _atr(b, i)
        if not a or a <= 0:
            return None
        seen, best = set(), None
        for k in _candidates(b, i):
            d = _evaluate(b, i, a, k, rnd)
            if d is None or (d["lip"], round(d["pivot"], 8)) in seen:
                continue
            seen.add((d["lip"], round(d["pivot"], 8)))
            key = (abs(d["close_minus_pivot_atr"]), -d["len"])
            if best is None or key < best[0]:
                best = (key, d)
        if best is None:
            return None
        d = best[1]
        return {"pivot": d["pivot"], "start_t": int(b[d["lip"]]["t"]), "end_t": int(b[i]["t"]),
                "low": d["low"], "low_t": int(b[d["low_i"]]["t"]), "bars": d["len"], "atr": float(a),
                "label": PIVOT_LABEL, "low_label": LOW_LABEL}
    except (KeyError, TypeError, ValueError, ZeroDivisionError, IndexError):
        return None
