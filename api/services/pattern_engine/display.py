"""Display-only annotations for detections (never read by any firing decision).

`end_t` on a detection is the last bar of the SCAN WINDOW for every geometry
detector (lab/geometry_eval REPORT.md fix 3), so a stored detection cannot say
whether its structure is live or ended weeks ago. It also feeds the memory
dedup hash and outcome tracking, so it is deliberately NOT changed here.

Instead `annotate(detections, bars)` adds, under `geometry.extras`:

  pattern_end_t     the newest bar time any of the detection's own anchors
                    (primary or `geometry.secondary`) sits on — the
                    structure's real last bar.
  pattern_age_bars  how many window bars came after it (0 = the structure is
                    on the last bar).

Both are derived from anchors the detector already emitted, after the fact, so
they cannot change what fires, its confidence or HIST_SCORE.

DRAWING GEOMETRY (lab/geometry_eval REPORT_TIERS_V2.md, 2026-10-17). The blind
v2 round judged whether the DRAWN shape is right and named five drawing
defects. `annotate` also stamps the display-only fixes for them, again under
`geometry.extras` and again never touching `anchors`, `levels`, `start_t`,
`end_t`, confidence or anything a firing decision reads:

  draw_anchors  the anchors the chart should DRAW in place of `anchors`.
                * double_bottom / double_top / head_shoulders: each anchor
                  snapped to the true extreme bar of its leg (the judges saw a
                  deeper low BETWEEN the two marked bottoms on most charts).
                  See `snap_to_extremes`.
                * flat_base: the base only (the prior-advance low no longer
                  stretches the box over the whole run-up), capped to the
                  consolidation by `consolidation_extent`.
  draw_ema      {period, points}: the EMA a pullback setup names
                (pullback_to_10ema / pullback_to_21ema / holy_grail's 20-EMA)
                over the pullback window, instead of one flat line.
  draw_pole     bull_flag: [pole base low, pole top high] -- the pole itself.
  draw_lanes    bull_flag: False when the flag's two lanes cross or diverge,
                or when a higher-confidence bull_flag of the same run already
                draws lanes over the same bars (`lanes_reason` says which).

v3 follow-ups (REPORT_TIERS_V3.md, 2026-10-17), still display-only:
  * draw_ema always spans at least PULLBACK_EMA_MIN_BARS bars ending on the
    last bar (a pullback bar that is itself the 10-bar swing high used to give
    < 2 points, so the overlay fell back to a flat line).
  * a capped base box ends AT its breakout / breakdown bar and is at most
    MAX_BOX_BARS wide (`consolidation_extent`).
  * the first anchor of a snapped chain never reaches back past the pattern's
    own start (`snap_to_extremes`), so it cannot land on an older deeper low.
  * `failed_breakout` names a box whose price closed above its top line and
    then back below it (a stale cup-with-handle; auto_structures drops it).
"""
from __future__ import annotations

import math
from bisect import bisect_right


def _anchor_times(geometry: dict) -> list:
    out = []
    for a in (geometry or {}).get("anchors") or []:
        t = a.get("t") if isinstance(a, dict) else None
        if isinstance(t, (int, float)):
            out.append(t)
    for sec in (geometry or {}).get("secondary") or []:
        if isinstance(sec, dict):
            out.extend(_anchor_times({"anchors": sec.get("anchors")}))
    return out


def pattern_end(detection: dict, bar_times: list):
    """(pattern_end_t, pattern_age_bars) or (None, None) when unknowable.

    Only anchor times that are REAL bar times of this window count, so a stray
    projected or index-shaped value can never masquerade as the pattern's end.
    """
    if not bar_times:
        return None, None
    present = set(bar_times)
    times = [t for t in _anchor_times(detection.get("geometry") or {}) if t in present]
    if not times:
        return None, None
    end_t = max(times)
    age = len(bar_times) - bisect_right(bar_times, end_t)
    return int(end_t), int(age)


def annotate(detections: list, bars: list) -> list:
    """Stamp pattern_end_t / pattern_age_bars and the drawing geometry in
    place. Never raises."""
    try:
        bar_times = [b["t"] for b in bars or []]
    except Exception:  # noqa: BLE001 -- display annotation must never break a scan
        return detections
    for d in detections or []:
        try:
            end_t, age = pattern_end(d, bar_times)
            if end_t is None:
                continue
            geom = d.setdefault("geometry", {})
            extras = geom.setdefault("extras", {})
            extras["pattern_end_t"] = end_t
            extras["pattern_age_bars"] = age
        except Exception:  # noqa: BLE001
            continue
    try:
        draw_geometry(detections, bars)
    except Exception:  # noqa: BLE001 -- display annotation must never break a scan
        pass
    return detections


# -- drawing geometry (REPORT_TIERS_V2.md, 2026-10-17) -----------------------

#: The extreme each anchor marks, in order. Alternating chains only.
EXTREME_CHAINS: dict = {
    "double_bottom": ("low", "high", "low"),
    "double_top": ("high", "low", "high"),
    "head_shoulders": ("high", "low", "high", "low", "high"),
}
#: Pullback setups and the EMA period each one names (holy_grail: the 20-EMA).
PULLBACK_EMA: dict = {"pullback_to_10ema": 10, "pullback_to_21ema": 21, "holy_grail": 20}
#: Bars before the pullback (touch) bar searched for the swing high it fell from.
PULLBACK_WINDOW_LOOKBACK = 10
#: The drawn EMA segment covers at least this many bars ending on the last bar
#: (v3: the swing-high window alone was often a 2-5 bar stub, or < 2 points).
PULLBACK_EMA_MIN_BARS = 15
#: The widest base box drawn, in bars, breakout / breakdown bar included (v3:
#: flat-base boxes still spanned the whole chart). base_catalog's own numbers
#: are untouched; only the drawn extent is capped.
MAX_BOX_BARS = 60
#: Box detections whose drawn extent is capped to the consolidation. The
#: bc:* boxes are capped in api/services/auto_structures.box_to_detection.
EXTENT_CAPPED = frozenset({"flat_base", "bc:flat-base", "bc:square-box"})
#: A flag's lanes "diverge" when the channel is more than this many times as
#: wide at its right end as at its left end.
LANE_DIVERGE_RATIO = 2.0


def _index(bars) -> dict:
    return {b["t"]: i for i, b in enumerate(bars)}


def snap_to_extremes(bars: list, idxs: list, kinds, start_idx=None) -> list:
    """Snap each anchor bar index to the true extreme bar of its leg.

    Anchors alternate (low, high, low, ...). Walking left to right, anchor i is
    re-placed on the lowest low (a "low" anchor) or highest high (a "high"
    anchor) of its leg: the bars after the previous SNAPPED anchor and before
    the next ORIGINAL anchor. The first anchor's leg reaches back half the
    distance to its neighbour but NEVER before the pattern's own start
    (`start_idx`; default the first anchor itself, which is where every
    EXTREME_CHAINS detector puts start_t) -- v3: the reach-back pulled the
    first anchor onto an older, deeper extreme outside the pattern. The last
    anchor's leg reaches forward half the distance to its neighbour (clipped
    to the window). The original
    bar is always inside its leg, so a snapped anchor is never less extreme
    than the one the detector drew, and the anchors keep their order. Ties
    keep the earliest bar. Returns the snapped indices.
    """
    n = len(bars)
    m = len(idxs)
    first = idxs[0] if idxs else 0
    floor_i = first if start_idx is None else min(int(start_idx), first)
    out: list = []
    for i, (idx, kind) in enumerate(zip(idxs, kinds)):
        if i == 0:
            lo = max(floor_i, idx - ((idxs[1] - idx) // 2 if m > 1 else 0))
        else:
            lo = out[-1] + 1
        if i == m - 1:
            hi = idx + ((idx - idxs[i - 1]) // 2 if m > 1 else 0)
        else:
            hi = idxs[i + 1] - 1
        lo, hi = max(0, min(lo, idx)), min(n - 1, max(hi, idx))
        best = lo
        for j in range(lo, hi + 1):
            if kind == "low":
                if bars[j]["l"] < bars[best]["l"]:
                    best = j
            elif bars[j]["h"] > bars[best]["h"]:
                best = j
        out.append(best)
    return out


def consolidation_extent(bars: list, start_t, end_t, top, floor):
    """The drawn extent of a base box, capped to its consolidation.

    The consolidation BAND is the upper half of the box: closes at or above
    mid = (top + floor) / 2. The drawn box runs from the first bar whose close
    is in the band to the last bar whose close is in the band. Bars before
    that are the advance INTO the base (the judges: "the left edge and floor
    take in the run-up bars"); bars after it broke out of the band downward
    (a rollover or breakdown the box should not swallow). A shakeout that
    closes below the band and recovers stays inside. The drawn top / floor
    are the highest high / lowest low over the CONSOLIDATION bars (the break
    bar's own range is not part of the base).

    v3 (REPORT_TIERS_V3.md): the drawn box ENDS AT its break bar -- the first
    close outside the band after the consolidation:
      breakout   the first close ABOVE `top` after the band starts;
      breakdown  otherwise, the bar after the last close in the band when the
                 span runs on below it (never recovered, so not a shakeout).
    It is also at most MAX_BOX_BARS wide, break bar included (the oldest bars
    are the ones dropped). `break` says which ("breakout" / "breakdown" /
    None). For base_catalog boxes `top` is the window's own highest high, so
    only a breakdown can occur there; the breakout branch serves callers whose
    top line is a level (a rim, a pivot).

    Returns {start_t, end_t, top, floor, break}, or None when the span is
    unknown or no close is in the band.
    """
    pos = _index(bars)
    s, e = pos.get(start_t), pos.get(end_t)
    if s is None or e is None or top is None or floor is None:
        return None
    if s > e:
        s, e = e, s
    top = float(top)
    mid = (top + float(floor)) / 2.0
    inside = [i for i in range(s, e + 1) if bars[i]["c"] >= mid]
    if not inside:
        return None
    i0 = inside[0]
    brk, kind = None, None
    for j in range(i0 + 1, e + 1):
        if bars[j]["c"] > top:
            brk, kind = j, "breakout"
            break
    if brk is None and inside[-1] < e:
        brk, kind = inside[-1] + 1, "breakdown"
    cons_end = e if brk is None else brk - 1
    end = e if brk is None else brk
    start = min(cons_end, max(i0, end - MAX_BOX_BARS + 1))
    span = bars[start:cons_end + 1]
    return {
        "start_t": bars[start]["t"],
        "end_t": bars[end]["t"],
        "top": float(max(b["h"] for b in span)),
        "floor": float(min(b["l"] for b in span)),
        "break": kind,
    }


def failed_breakout(bars: list, start_t, end_t, line) -> bool:
    """True when a close in [start_t, end_t] went ABOVE `line` and the span's
    last close is back at or below it: the breakout already happened and
    failed, so a box drawn under `line` is stale (v3: cup-with-handle boxes
    "stale after a failed breakout"). False when the span is unknown, never
    broke out, or is still above the line."""
    pos = _index(bars)
    s, e = pos.get(start_t), pos.get(end_t)
    if s is None or e is None or line is None or s > e:
        return False
    line = float(line)
    broke = any(bars[i]["c"] > line for i in range(s, e + 1))
    return bool(broke and bars[e]["c"] <= line)


def handle_extent(bars: list, start_t, end_t, lip):
    """The drawn extent of a cup's HANDLE: from its first bar up to (not
    including) the first bar that CLOSES above the lip (the cup rim). Handle
    bars past a breakout are not handle (the v2 judges: "the handle is drawn
    after the breakout, too long"). top / floor are recomputed over the drawn
    bars. Returns {start_t, end_t, top, floor}; None when the span is unknown
    or the very first handle bar already broke out (no handle to draw).
    """
    pos = _index(bars)
    s, e = pos.get(start_t), pos.get(end_t)
    if s is None or e is None or lip is None or s > e:
        return None
    last = e
    for i in range(s, e + 1):
        if bars[i]["c"] > float(lip):
            last = i - 1
            break
    if last < s:
        return None
    span = bars[s:last + 1]
    return {
        "start_t": bars[s]["t"],
        "end_t": bars[last]["t"],
        "top": float(max(b["h"] for b in span)),
        "floor": float(min(b["l"] for b in span)),
    }


def extent_anchors(ext: dict) -> list:
    """A capped extent as the two-corner anchors a box renderer reads."""
    return [{"t": ext["start_t"], "price": ext["top"]},
            {"t": ext["end_t"], "price": ext["floor"]}]


def ema_series(closes: list, period: int) -> list:
    """EMA seeded exactly as the pullback detectors seed theirs (an SMA of the
    first `period` closes, then the recursion), so its last value IS the level
    the detector drew. None before the seed bar."""
    out: list = [None] * len(closes)
    if len(closes) < period:
        return out
    k = 2.0 / (period + 1)
    ema = sum(closes[:period]) / period
    out[period - 1] = ema
    for i in range(period, len(closes)):
        ema = closes[i] * k + ema * (1.0 - k)
        out[i] = ema
    return out


def _line_at(p1, p2, x, space):
    """The fitted line through (x1, price1), (x2, price2) at bar x."""
    (x1, y1), (x2, y2) = p1, p2
    if x1 == x2:
        return y1
    f = (x - x1) / (x2 - x1)
    if space == "log" and y1 > 0 and y2 > 0:
        return math.exp(math.log(y1) + (math.log(y2) - math.log(y1)) * f)
    return y1 + (y2 - y1) * f


def lane_verdict(bars: list, geometry: dict):
    """(draw_lanes, reason) for a flag's two lanes [u1, u2, l1, l2].

    Both lines are extended over the drawn span (first to last anchor bar),
    each in the space it was fitted in. 'crossing' when the upper lane is not
    above the lower one at either end; 'diverging' when the channel at the
    right end is more than LANE_DIVERGE_RATIO times as wide as at the left.
    """
    pos = _index(bars)
    a = geometry.get("anchors") or []
    if len(a) != 4:
        return True, None
    xs = [pos.get(p.get("t")) for p in a]
    if any(x is None for x in xs):
        return True, None
    spaces = list((geometry.get("extras") or {}).get("line_spaces") or []) + ["price", "price"]
    up = ((xs[0], a[0]["price"]), (xs[1], a[1]["price"]))
    dn = ((xs[2], a[2]["price"]), (xs[3], a[3]["price"]))
    left, right = min(xs), max(xs)
    w_left = _line_at(*up, left, spaces[0]) - _line_at(*dn, left, spaces[1])
    w_right = _line_at(*up, right, spaces[0]) - _line_at(*dn, right, spaces[1])
    if w_left <= 0 or w_right <= 0:
        return False, "crossing"
    if w_right > LANE_DIVERGE_RATIO * w_left:
        return False, "diverging"
    return True, None


def _bar_span(pos, d):
    idx = [pos.get(t) for t in (d.get("pivot_ts") or [])]
    idx = [i for i in idx if i is not None]
    return (min(idx), max(idx)) if idx else None


def draw_geometry(detections: list, bars: list) -> list:
    """Stamp the display-only drawing fixes (module docstring) in place.
    Each detection is independent: a failure skips that detection only."""
    if not bars:
        return detections
    pos = _index(bars)
    closes = None
    emas: dict = {}
    flags: list = []
    for d in detections or []:
        try:
            pid = d.get("pattern_id")
            geom = d.get("geometry")
            if not isinstance(geom, dict):
                continue
            anchors = geom.get("anchors") or []
            if pid in EXTREME_CHAINS:
                kinds = EXTREME_CHAINS[pid]
                idxs = [pos.get(a.get("t")) for a in anchors]
                if len(idxs) == len(kinds) and None not in idxs and idxs == sorted(idxs):
                    snapped = snap_to_extremes(bars, idxs, kinds,
                                               start_idx=pos.get(d.get("start_t")))
                    geom.setdefault("extras", {})["draw_anchors"] = [
                        {"t": bars[j]["t"],
                         "price": float(bars[j]["l"] if k == "low" else bars[j]["h"])}
                        for j, k in zip(snapped, kinds)
                    ]
            elif pid == "flat_base" and len(anchors) == 4:
                # [prior_advance_low, base_start@high, base_end@high, base_end@low]
                ext = consolidation_extent(bars, anchors[1]["t"], anchors[3]["t"],
                                           anchors[1]["price"], anchors[3]["price"])
                geom.setdefault("extras", {})["draw_anchors"] = (
                    extent_anchors(ext) if ext else [dict(anchors[1]), dict(anchors[3])])
            elif pid in PULLBACK_EMA:
                period = PULLBACK_EMA[pid]
                pts = d.get("pivot_ts") or []
                pb = pos.get(pts[0]) if pts else None
                if pb is None:
                    continue
                if closes is None:
                    closes = [b["c"] for b in bars]
                if period not in emas:
                    emas[period] = ema_series(closes, period)
                series = emas[period]
                lo = max(0, pb - PULLBACK_WINDOW_LOOKBACK)
                start = lo
                for j in range(lo, pb + 1):
                    if bars[j]["h"] > bars[start]["h"]:
                        start = j
                # v3: never a stub -- at least the last PULLBACK_EMA_MIN_BARS bars.
                start = max(0, min(start, len(bars) - PULLBACK_EMA_MIN_BARS))
                points = [{"t": bars[j]["t"], "price": round(series[j], 4)}
                          for j in range(start, len(bars)) if series[j] is not None]
                if len(points) >= 2:
                    geom.setdefault("extras", {})["draw_ema"] = {"period": period, "points": points}
            elif pid == "bull_flag":
                extras = geom.setdefault("extras", {})
                pts = d.get("pivot_ts") or []
                b0 = pos.get(pts[0]) if len(pts) > 1 else None
                b1 = pos.get(pts[1]) if len(pts) > 1 else None
                if b0 is not None and b1 is not None:
                    extras["draw_pole"] = [{"t": bars[b0]["t"], "price": float(bars[b0]["l"])},
                                           {"t": bars[b1]["t"], "price": float(bars[b1]["h"])}]
                ok, reason = lane_verdict(bars, geom)
                extras["draw_lanes"] = ok
                if reason:
                    extras["lanes_reason"] = reason
                flags.append(d)
        except Exception:  # noqa: BLE001 -- one detection's fix skips that one only
            continue
    # Overlapping bull_flags of one run: only the most confident keeps its lanes.
    kept: list = []
    for d in sorted(flags, key=lambda x: -(x.get("confidence") or 0)):
        try:
            extras = d["geometry"]["extras"]
            if not extras.get("draw_lanes"):
                continue
            span = _bar_span(pos, d)
            if span and any(k[0] <= span[1] and span[0] <= k[1] for k in kept):
                extras["draw_lanes"] = False
                extras["lanes_reason"] = "overlapped"
                continue
            if span:
                kept.append(span)
        except Exception:  # noqa: BLE001
            continue
    return detections
