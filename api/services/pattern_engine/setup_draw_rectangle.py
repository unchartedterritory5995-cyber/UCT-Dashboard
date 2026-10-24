"""Setup drawing -- RECTANGLE (a horizontal trading range): ONE box, its top on the repeated highs, its floor on the
repeated lows, from where the prior trend ended to the as-of bar.

Pure geometry over daily bars [0..i] (bar i = the as-of bar, a COMPLETED session). Nothing here reads a store, a
clock or anything after bar i. Display only: it changes nothing any detector fires on, its confidence, HIST_SCORE or
`confirmed_only`.

Drawing round 1 passed two pre-registered blind packets (two fresh judges per packet, 25 seeded charts each, drawn
round-robin across 1995..2026 from the liquid cap universe; bar: mean >= 2.3 AND >= 70% of charts scoring >= 2):
    rectangle  round 1   A 2.44 / 100%   B 2.76 / 96%
Every constant below is that round's, frozen. tests/test_setup_draw_rectangle_parity.py pins this module's output
to the judged drawing code on an embedded synthetic fixture: change a constant and the parity rail goes red. A new
round is a new constant AND a new blind check, never an edit here.

The textbook (Edwards & Magee; Bulkowski): two roughly parallel horizontal lines, each touched at least twice, price
oscillating between them; the lines sit at the cluster of touches (a lone wick never sets one) and the range starts
where the prior trend ends. As built:
  * windows of 18..70 bars ending at the as-of bar; swings = extremes vs 2 bars each side (the right side cut at the
    as-of bar); swings < 4 bars apart are one touch; touch band tol = min(0.5 ATR, 0.15 box height);
  * each line = the densest cluster of touches at the edge of the closes; the validated level is the cluster's
    SECOND most extreme touch; the DRAWN level is halfway to the median body extreme of the line's touches, never
    inside a close;
  * the box starts at the first touch of the line the entry leg ran INTO (rising into it: the first top touch;
    falling: the first floor touch); a window whose range is older than itself is refused;
  * >= 2 touches per line (>= 2 before the last 5 bars, >= 2 with the body near the line), >= 4 alternating runs;
  * flat: close drift <= 0.20 H, no mid-box hump or dip (> 0.12 H), >= 4 mid-line crosses, closes in both outer
    30% bands; every close inside the box, the as-of close inside it; few, small wicks past a line;
  * box 15..45 bars, H >= 2 ATR, depth 3%..25%; then the shared bullish setup gate (setup_draw.setup_gate).

A member gets the drawing only while auto_structures.MEMBER_RECTANGLE_ROUND equals RECTANGLE_DRAW_ROUND here AND the
row's id is in registry.DISPLAY_MEMBER_SET (auto_structures.member_rows). Fail closed.
"""
from __future__ import annotations

from api.services.pattern_engine import setup_draw as _SD

#: The judged drawing round (int, frozen).
RECTANGLE_DRAW_ROUND = 1

WINDOW = _SD.WINDOW                 # 330: SMA200 + 20 + the deal read (300)
MIN_ASOF_INDEX = _SD.MIN_ASOF_INDEX  # 220

RC_WIN_MIN, RC_WIN_MAX = 18, 70     # candidate windows ending at the as-of bar
RC_NB = 2                           # swing = extreme vs 2 bars each side
RC_SEP = 4                          # swings < 4 bars apart are one touch
RC_TOL_ATR, RC_TOL_H = 0.5, 0.15    # touch band
RC_CLOSE_TOL_ATR, RC_CLOSE_TOL_H = 0.25, 0.05
RC_BODY_H = 0.25                    # a touch whose body extreme is within 0.25 H of the line
RC_EDGE_BARS = 5                    # >= 2 touches per line before the last 5 bars
RC_ZONE, RC_FILL = 0.30, 0.12       # >= 12% of closes in each outer 30% band
RC_MAX_POKE, RC_POKE_MAX_H = 2, 0.25
RC_MIN_TOUCH = 2
RC_MIN_RUNS = 4
RC_MIN_LEN, RC_MAX_LEN = 15, 45
RC_MIN_H_ATR, RC_MIN_DEPTH, RC_MAX_DEPTH = 2.0, 0.03, 0.25
RC_FLAT = 0.20
RC_HUMP = 0.12
RC_MIN_CROSS = 4
RC_DRAW_BODY = 0.5
RC_PRE_BARS, RC_PRE_INSIDE = 10, 0.5


def _swings(b, e, nb, top):
    out = []
    for j in range(nb, e + 1):
        lo, hi = j - nb, min(e, j + nb)
        if top:
            v = b[j]["h"]
            if all(v >= b[k]["h"] for k in range(lo, hi + 1)):
                out.append(j)
        else:
            v = b[j]["l"]
            if all(v <= b[k]["l"] for k in range(lo, hi + 1)):
                out.append(j)
    return out


def _events(js, b, top, sep):
    """Swing bars < sep apart are one touch; each touch = (bar of its extreme, price)."""
    g = []
    for j in js:
        if g and j - g[-1][-1] < sep:
            g[-1].append(j)
        else:
            g.append([j])
    key = (lambda j: b[j]["h"]) if top else (lambda j: -b[j]["l"])
    out = []
    for grp in g:
        j = max(grp, key=key)
        out.append((j, b[j]["h"] if top else b[j]["l"]))
    return out


def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2.0


def _cluster(ev, tol, top, edge_close):
    """The densest cluster of touches at the edge of the closes (ties: the more extreme level); its level is the
    cluster's SECOND most extreme touch, so the single most extreme wick pokes through instead of setting it."""
    best = None
    for _, p in ev:
        if top and p < edge_close - tol:
            continue
        if not top and p > edge_close + tol:
            continue
        mem = [q for _, q in ev if abs(q - p) <= tol]
        k = (len(mem), p if top else -p)
        if best is None or k > best[0]:
            best = (k, mem)
    if best is None or len(best[1]) < 2:
        return None
    return sorted(best[1], reverse=top)[1]


def _slope(ys):
    n = len(ys)
    mx = (n - 1) / 2.0
    my = sum(ys) / n
    den = sum((x - mx) ** 2 for x in range(n))
    return sum((x - mx) * (y - my) for x, y in enumerate(ys)) / den if den else 0.0


def _fit(b, s, e, atr, sh, sl, why):
    """The box on [s, e] and every test, or None (the reason appended to `why`)."""
    def no(r):
        why.append(r)
        return None
    cl = [b[j]["c"] for j in range(s, e + 1)]
    evT = _events([j for j in sh if j >= s], b, True, RC_SEP)
    evB = _events([j for j in sl if j >= s], b, False, RC_SEP)
    if len(evT) < 2 or len(evB) < 2:
        return no("few_swings")
    tol = RC_TOL_ATR * atr
    T = _cluster(evT, tol, True, max(cl))
    B = _cluster(evB, tol, False, min(cl))
    if T is None or B is None or T <= B:
        return no("no_cluster")
    H = T - B
    tol = min(RC_TOL_ATR * atr, RC_TOL_H * H)
    T = _cluster(evT, tol, True, max(cl)) or T
    B = _cluster(evB, tol, False, min(cl)) or B
    H = T - B
    if H <= 0:
        return no("no_cluster")
    tT = [j for j, q in evT if abs(q - T) <= tol]
    tB = [j for j, q in evB if abs(q - B) <= tol]
    if len(tT) < 2 or len(tB) < 2:
        return no("few_touches")
    # the start: where the prior trend ended (entry direction from the closes before the first touch)
    f0 = min(tT[0], tB[0])
    pre = [b[j]["c"] for j in range(max(0, f0 - RC_PRE_BARS), f0)]
    if not pre:
        return no("no_pre")
    inside = sum(1 for c in pre if B <= c <= T) / len(pre)
    if inside > RC_PRE_INSIDE:
        return no("range_older_than_window")
    mid = (T + B) / 2.0
    from_below = sum(pre) / len(pre) < mid
    start = tT[0] if from_below else tB[0]
    tT = [j for j in tT if j >= start]
    tB = [j for j in tB if j >= start]
    if len(tT) < RC_MIN_TOUCH or len(tB) < RC_MIN_TOUCH:
        return no("few_touches_after_start")
    btT = [j for j in tT if max(b[j]["o"], b[j]["c"]) >= T - RC_BODY_H * H]
    btB = [j for j in tB if min(b[j]["o"], b[j]["c"]) <= B + RC_BODY_H * H]
    if len(btT) < RC_MIN_TOUCH or len(btB) < RC_MIN_TOUCH:
        return no("wick_only_touches")
    if (len([j for j in tT if j <= e - RC_EDGE_BARS]) < RC_MIN_TOUCH
            or len([j for j in tB if j <= e - RC_EDGE_BARS]) < RC_MIN_TOUCH):
        return no("touch_only_at_edge")
    if not (B <= b[e]["c"] <= T):
        return no("asof_close_outside")
    n = e - start + 1
    if n < RC_MIN_LEN:
        return no("short")
    if n > RC_MAX_LEN:
        return no("long")
    if H < RC_MIN_H_ATR * atr:
        return no("thin")
    depth = H / mid
    if not (RC_MIN_DEPTH <= depth <= RC_MAX_DEPTH):
        return no("depth")
    seq = sorted([(j, "T") for j in tT] + [(j, "B") for j in tB])
    runs = 1 + sum(1 for a, c in zip(seq, seq[1:]) if a[1] != c[1])
    if runs < RC_MIN_RUNS:
        return no("not_alternating")
    box = range(start, e + 1)
    ct = min(RC_CLOSE_TOL_ATR * atr, RC_CLOSE_TOL_H * H)
    if any(b[j]["c"] > T + ct or b[j]["c"] < B - ct for j in box):
        return no("close_outside")
    pokesT = [b[j]["h"] - T for j in box if b[j]["h"] > T + tol]
    pokesB = [B - b[j]["l"] for j in box if b[j]["l"] < B - tol]
    if len(pokesT) > RC_MAX_POKE or len(pokesB) > RC_MAX_POKE:
        return no("many_pokes")
    if any(x > RC_POKE_MAX_H * H for x in pokesT + pokesB):
        return no("big_spike")
    c2 = [b[j]["c"] for j in box]
    if abs(_slope(c2)) * (n - 1) > RC_FLAT * H:
        return no("tilted")
    k3 = n // 3
    m1 = sum(c2[:k3]) / k3
    m2 = sum(c2[k3:n - k3]) / (n - 2 * k3)
    m3 = sum(c2[n - k3:]) / k3
    if abs(m2 - (m1 + m3) / 2.0) > RC_HUMP * H:
        return no("hump_or_dip")
    if (sum(1 for c in c2 if c >= T - RC_ZONE * H) < RC_FILL * n
            or sum(1 for c in c2 if c <= B + RC_ZONE * H) < RC_FILL * n):
        return no("one_sided_fill")
    sg = [1 if c >= mid else -1 for c in c2]
    cross = sum(1 for a, c in zip(sg, sg[1:]) if a != c)
    if cross < RC_MIN_CROSS:
        return no("no_oscillation")
    w = RC_DRAW_BODY
    Td = (1 - w) * T + w * _median([max(b[j]["o"], b[j]["c"]) for j in tT])
    Bd = (1 - w) * B + w * _median([min(b[j]["o"], b[j]["c"]) for j in tB])
    Td, Bd = max(Td, max(c2)), min(Bd, min(c2))
    return {"start": start, "T": T, "B": B, "Td": Td, "Bd": Bd, "tT": tT, "tB": tB, "runs": runs, "cross": cross,
            "from_below": from_below, "n": n, "depth": depth, "pokes": len(pokesT) + len(pokesB),
            "h_atr": H / atr, "tilt": abs(_slope(c2)) * (n - 1) / H, "hump": (m2 - (m1 + m3) / 2.0) / H}


def rectangle(b, why=None):
    ia = len(b) - 1
    atr = _SD._atr(b, ia)
    if atr is None:
        return _SD._say(why, "no_atr")
    sh = _swings(b, ia, RC_NB, True)
    sl = _swings(b, ia, RC_NB, False)
    best, reasons, seen = None, [], set()
    for L in range(RC_WIN_MIN, RC_WIN_MAX + 1):
        s = ia - L + 1
        if s < RC_PRE_BARS + 2:
            break
        c = _fit(b, s, ia, atr, sh, sl, reasons)
        if c is None:
            continue
        key = (c["start"], round(c["T"], 6), round(c["B"], 6))
        if key in seen:
            continue
        seen.add(key)
        rank = (c["runs"], len(c["tT"]) + len(c["tB"]), c["n"])
        if best is None or rank > best[0]:
            best = (rank, c)
    if best is None:
        return _SD._say(why, "rc_" + (max(set(reasons), key=reasons.count) if reasons else "none"))
    c = best[1]
    g = _SD.setup_gate(b, ia)
    if g:
        return _SD._say(why, g)
    T, B, f = c["Td"], c["Bd"], c["start"]
    det = {"pattern_id": "rectangle", "pattern_name": "Rectangle", "direction": "bullish", "status": "ready",
           "start_t": int(b[f]["t"]), "end_t": int(b[ia]["t"]),
           "geometry": {"shape": "rectangle", "anchors": [{"t": int(b[f]["t"]), "price": round(T, 4)},
                                                          {"t": int(b[ia]["t"]), "price": round(B, 4)}],
                        "extras": {}}}
    cl = b[ia]["c"]
    return {"shape": "rectangle", "draw_round": RECTANGLE_DRAW_ROUND, "top": round(T, 4), "floor": round(B, 4),
            "touch_top": round(c["T"], 4), "touch_floor": round(c["B"], 4), "len": c["n"],
            "depth": round(c["depth"], 4), "top_touches": len(c["tT"]), "low_touches": len(c["tB"]),
            "runs": c["runs"], "mid_crosses": c["cross"], "entry": "from_below" if c["from_below"] else "from_above",
            "pokes": c["pokes"], "h_atr": round(c["h_atr"], 2), "tilt_h": round(c["tilt"], 3),
            "hump_h": round(c["hump"], 3), "close_pos": round((cl - B) / (T - B), 3), "det": det}


def detect(bars, why=None):
    """The rectangle drawing for `bars` (oldest first, the LAST one the as-of bar, a completed session; dicts
    {t,o,h,l,c,v} or (t,o,h,l,c,v) rows), or None. Only the last WINDOW bars are read."""
    b = list(bars or [])
    if len(b) - 1 < MIN_ASOF_INDEX:
        return _SD._say(why, "short_history")
    return rectangle(_SD._window(b), why)


def facts(d: dict) -> dict:
    return {k: v for k, v in d.items() if k != "det"}
