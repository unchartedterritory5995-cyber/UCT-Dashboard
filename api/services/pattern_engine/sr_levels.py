"""Textbook support / resistance -- ZONES and major TRENDLINES on a daily chart (drawing round "r2").

Pure geometry over daily bars [0..i] (bar i = the as-of bar, a COMPLETED session). Nothing here reads a store, a
clock or anything after bar i: `draw` slices rows[:i+1] before it reads anything. Display only: it changes nothing
any detector fires on.

Drawing round "r2" (SR_ROUND). Every constant below is that round's, frozen; a member gets the layer only while
auto_structures.MEMBER_SR_ROUND equals this constant (fail closed). The round was judged blind on two fresh packets
of 25 random liquid held-out charts each (two fresh judges per packet): A 2.52 (96% of charts >= 2), B 2.36 (84%);
bar: mean >= 2.3 and >= 70% >= 2 on both. Its DEV lookahead check passed (0 mismatches against a wild and the real
future; a leaky control mismatched on every case).

The rules (each constant is named where it is used):
  * ZONES, not lines: at most MAX_ZONES (3), at most MAX_PER_SIDE (2) on one side of price. A zone is a band
    centre +- ZONE_HALF (0.25) ATR(14) holding >= MIN_TOUCH (3) touches -- a touch is a reaction high / low
    (+-PIV_K bars) inside the band; reactions within TOUCH_SEP bars are one touch. The band centre is re-centred on
    the MEDIAN of the reactions it captures until it stops moving (<= SNAP_ITERS steps, never losing a touch).
  * ROLE: "Support a-b" / "Resistance a-b" by where the close sits. The 3% CLOSE RULE: a close > BREAK (3%) through
    a zone breaks it; a broken zone is drawn only after price came back to it from the new side (the retest), in
    its new role, with >= RR_PRE_TOUCH touches before the break plus the retest. The LAST decisive break decides.
  * DE-CLUTTER: drawn items >= ZONE_GAP_ATR (1.5) ATR apart edge to edge AND >= VIS_GAP (6%) of the 1-year
    high-low range; a closer candidate is merged into the stronger one (not drawn).
  * NEAR PRICE: the nearest support and the nearest resistance first; a zone's nearer edge within ZONE_NEAR (15%)
    of the close, except the one nearest zone of a side with none within 15%, which may sit up to
    ZONE_NEAR_FALLBACK (25%) away; the remaining slots by score, within 15% only.
  * TRENDLINES: <= 1 per side, rising under swing lows / falling over swing highs; >= TL_MIN_TOUCH (3) swing pivots
    within TL_TOL (0.15) ATR of the line, >= TL_GAP bars apart, first -> last touch >= TL_MIN_SPAN sessions, the
    line moving >= TL_MIN_MOVE ATR over that span, slope <= TL_MAX_SLOPE_ATR ATR/bar, no bar through it by >
    TL_PIERCE ATR up to the last touch nor by > TL_PIERCE_AFTER ATR after it, no 3% close through it, its last
    touch within TL_MAX_AGE sessions, its as-of value within TL_NEAR (10%) of the close; a line that crowds a drawn
    zone (or the other line) is dropped.
  * PATTERNS WIN: a zone whose band +- PATTERN_ATR (1) ATR, or a trendline whose as-of value within 1 ATR, holds a
    price a served member pattern draws is suppressed (the next candidate may take its place).
  * PINNED instruments (ATR(14) < PINNED_ATR_PCT, 0.4%, of the close) get nothing.

A port, line for line, of the frozen lab generator (sr_textbook round 2, sr2.py); tests/test_sr_levels_parity.py
pins it to that generator's own output on every fixture chart and proves the rail fails when one parameter moves.
"""
from __future__ import annotations

import math

#: The drawing round this code draws.
SR_ROUND = "r2"

# ------------------------------------------------------------------ constants (frozen at round r2)
LOOK = 250
ATR_N = 14
PIV_K = 3
TOUCH_SEP = 5
ZONE_HALF = 0.25
MIN_TOUCH = 3
RR_PRE_TOUCH = 2
BREAK = 0.03
MAX_ZONES = 3
MAX_PER_SIDE = 2
ZONE_GAP_ATR = 1.5
VIS_GAP = 0.06
ZONE_NEAR = 0.15
ZONE_NEAR_FALLBACK = 0.25
SNAP_ITERS = 8
REC_HL = 60.0
REC_W = 2.0
TL_MIN_SPAN = 40
TL_MIN_TOUCH = 3
TL_TOL = 0.15
TL_PIERCE = 0.25
TL_PIERCE_AFTER = 0.5
TL_MIN_MOVE = 1.5
TL_GAP = 10
TL_NEAR = 0.10
TL_MAX_AGE = 60
TL_MAX_SLOPE_ATR = 0.5
PATTERN_ATR = 1.0
PINNED_ATR_PCT = 0.004
#: Fewer bars than this and nothing is drawn.
MIN_BARS = 61
#: Bars the drawing reads, counted back from the as-of bar: LOOK plus the PIV_K bars left of the first pivot window.
#: A history at least this long draws exactly what the full history draws.
BARS_NEEDED = LOOK + PIV_K


# ------------------------------------------------------------------ helpers
def _atr(b, i):
    k = min(ATR_N, i)
    trs = [max(b[j][2], b[j - 1][4]) - min(b[j][3], b[j - 1][4]) for j in range(i - k + 1, i + 1)]
    a = sum(trs) / len(trs) if trs else 0.0
    return a if a > 0 else None


def _pivots(b, lo, i, is_high):
    """Reaction highs / lows in [lo, i-k]: the extreme of the 2k+1 bars around j (needs k bars on the right,
    so only bars <= i are read). Ties: the first of equal extremes within k bars."""
    k = PIV_K
    col = 2 if is_high else 3
    out = []
    for j in range(max(lo, k), i - k + 1):
        v = b[j][col]
        w = [b[x][col] for x in range(j - k, j + k + 1)]
        if (is_high and v >= max(w)) or (not is_high and v <= min(w)):
            if out and j - out[-1][0] <= k and out[-1][1] == v:
                continue
            out.append((j, float(v)))
    return out


def _groups(js, sep):
    """Touch episodes: sorted bar indices -> list of groups, a new group when the gap exceeds `sep` bars."""
    g = []
    for j in sorted(js):
        if g and j - g[-1][-1] <= sep:
            g[-1].append(j)
        else:
            g.append([j])
    return g


def fmt(p):
    return ("%.1f" % p) if p >= 50 else ("%.2f" % p)


# ------------------------------------------------------------------ zones
def _vis_range(b, i):
    lo = max(0, i - LOOK + 1)
    return max(x[2] for x in b[lo:i + 1]) - min(x[3] for x in b[lo:i + 1])


def _sep_ok(lo1, hi1, lo2, hi2, at, rng):
    """Two drawn items (bands, or a line's as-of value as a point) are far enough apart: edge gap >= ZONE_GAP_ATR
    ATR and >= VIS_GAP of the rendered range."""
    gap = max(lo2 - hi1, lo1 - hi2)
    return gap >= max(ZONE_GAP_ATR * at, VIS_GAP * rng)


def _zone_eval(b, i, at, ext, centre):
    """One candidate band around `centre`: touches, break / retest state. None if it fails the rules."""
    bot, top = centre - ZONE_HALF * at, centre + ZONE_HALF * at
    hits = [(j, p, h) for j, p, h in ext if bot <= p <= top]
    if not hits:
        return None
    gs = _groups([j for j, _, _ in hits], TOUCH_SEP)
    hits.sort()
    first_j = hits[0][0]
    side = 1 if hits[0][2] == 0 else -1     # a reaction LOW first in the band = price above it (support, +1)
    broken_at = None
    for j in range(first_j + 1, i + 1):     # the LAST decisive (> 3%) close through decides the current role
        c = b[j][4]
        if side == 1 and c < bot * (1 - BREAK):
            side, broken_at = -1, j
        elif side == -1 and c > top * (1 + BREAK):
            side, broken_at = 1, j
    rr, retest_j = False, None
    if broken_at is None:
        if len(gs) < MIN_TOUCH:
            return None
        n_touch = len(gs)
        touch_js = [g[0] for g in gs]
    else:
        # the retest: price came BACK to the band from the new side after the last break; the as-of bar counts.
        # "Held" = no later decisive close back through (that would be another break, handled above).
        if side == 1:
            rt = [j for j in range(broken_at + 1, i + 1) if b[j][3] <= top]
        else:
            rt = [j for j in range(broken_at + 1, i + 1) if b[j][2] >= bot]
        if not rt:
            return None
        retest_j = rt[0]
        pre = [g for g in gs if g[0] < broken_at]
        post = [g for g in gs if g[0] > broken_at]
        # the retest itself is a touch even when it is not an in-band reaction pivot
        n_touch = len(pre) + max(len(post), 1)
        if not (len(gs) >= MIN_TOUCH or (len(pre) >= RR_PRE_TOUCH and n_touch >= MIN_TOUCH)):
            return None
        n_touch = max(n_touch, len(gs))
        rr = True
        touch_js = [g[0] for g in gs]
        if not post:
            touch_js.append(retest_j)
    close = b[i][4]
    if close > top:
        role = "Support"
    elif close < bot:
        role = "Resistance"
    else:
        role = "Support" if side == 1 else "Resistance"
    last_j = max([j for j, _, _ in hits] + ([retest_j] if retest_j is not None else []))
    return {"bot": bot, "top": top, "mid": centre, "touches": n_touch, "first_j": first_j, "last_j": last_j,
            "role": role, "broken_retested": rr, "touch_js": sorted(touch_js),
            "score": n_touch + REC_W * math.exp(-(i - last_j) * math.log(2) / REC_HL)}


def _median(ps):
    ps = sorted(ps)
    n = len(ps)
    return ps[n // 2] if n % 2 else 0.5 * (ps[n // 2 - 1] + ps[n // 2])


def zones(b, i, at, pattern_pivots=()):
    lo = max(0, i - LOOK + 1)
    close = b[i][4]
    rng = _vis_range(b, i)
    ext = [(j, p, 1) for j, p in _pivots(b, lo, i, True)] + [(j, p, 0) for j, p in _pivots(b, lo, i, False)]
    cands, seen = [], set()
    for _, p0, _ in ext:
        z = _zone_eval(b, i, at, ext, p0)
        if z is None:
            continue
        # re-centre on the median of the captured extremes until it stops moving (never losing touches)
        for _ in range(SNAP_ITERS):
            med = _median([p for j, p, _ in ext if z["bot"] <= p <= z["top"]])
            if abs(med - z["mid"]) < 0.01 * at:
                break
            z2 = _zone_eval(b, i, at, ext, med)
            if z2 is None or z2["touches"] < z["touches"]:
                break
            z = z2
        key = round(z["mid"] / (0.05 * at))
        if key in seen:
            continue
        seen.add(key)
        cands.append(z)
    cands.sort(key=lambda z: (-z["score"], -z["last_j"], z["mid"]))
    ok, supp = [], []
    for z in cands:
        near = min(abs(z["bot"] - close), abs(z["top"] - close)) if not (z["bot"] <= close <= z["top"]) else 0.0
        z["near"] = near / close
        if near / close > ZONE_NEAR_FALLBACK:
            continue
        if any(z["bot"] - PATTERN_ATR * at <= pv <= z["top"] + PATTERN_ATR * at for pv in pattern_pivots):
            supp.append(z)
            continue
        ok.append(z)
    # MERGE: strongest first; a candidate too close to a kept one is absorbed into it (not drawn)
    reps, merged = [], 0
    for z in [z for z in ok if z["near"] <= ZONE_NEAR] + [z for z in ok if z["near"] > ZONE_NEAR]:
        if all(_sep_ok(z["bot"], z["top"], r["bot"], r["top"], at, rng) for r in reps):
            reps.append(z)
        else:
            merged += 1
    # order of choice: the NEAREST support and the NEAREST resistance first, then the rest by score; at most
    # MAX_PER_SIDE on one side
    sup = sorted([z for z in reps if z["role"] == "Support"], key=lambda z: -z["mid"])
    res = sorted([z for z in reps if z["role"] == "Resistance"], key=lambda z: z["mid"])
    pick = [s[0] for s in (sup, res) if s]           # the nearest of a side (<= 25% only if none <= 15%)
    for z in [z for z in reps if z["near"] <= ZONE_NEAR]:   # the rest: <= 15% only
        if len(pick) >= MAX_ZONES:
            break
        if z in pick or sum(q["role"] == z["role"] for q in pick) >= MAX_PER_SIDE:
            continue
        pick.append(z)
    return pick, supp, merged


# ------------------------------------------------------------------ trendlines
def _tl_side(b, i, at, is_high, pattern_pivots):
    lo = max(0, i - LOOK + 1)
    piv = _pivots(b, lo, i, bool(is_high))
    close = b[i][4]
    best, supp = None, None
    n = len(piv)
    for x in range(n):
        ja, pa = piv[x]
        for y in range(x + 1, n):
            jb, pb = piv[y]
            if jb - ja < TL_GAP:
                continue
            slope = (pb - pa) / (jb - ja)
            if is_high and slope >= 0:        # resistance must FALL
                continue
            if not is_high and slope <= 0:    # support must RISE
                continue
            if abs(slope) > TL_MAX_SLOPE_ATR * at:
                continue
            # touches = swing pivots (+-PIV_K bars) within TL_TOL ATR of the line, episodes >= TL_GAP bars apart
            tj = [j for j, p in piv[x:] if abs(p - (pa + slope * (j - ja))) <= TL_TOL * at]
            gs = _groups(tj, TL_GAP)
            if len(gs) < TL_MIN_TOUCH:
                continue
            last_j = max(tj)
            if last_j - ja < TL_MIN_SPAN or i - last_j > TL_MAX_AGE:
                continue
            if abs(slope) * (last_j - ja) < TL_MIN_MOVE * at:     # a flat line is a level, not a trend
                continue
            ok = True
            for j in range(ja, i + 1):
                v = pa + slope * (j - ja)
                tol = (TL_PIERCE if j <= last_j else TL_PIERCE_AFTER) * at
                if (not is_high and b[j][3] < v - tol) or (is_high and b[j][2] > v + tol):
                    ok = False
                    break
                c = b[j][4]
                if (not is_high and c < v * (1 - BREAK)) or (is_high and c > v * (1 + BREAK)):   # 3% close
                    ok = False
                    break
            if not ok:
                continue
            vnow = pa + slope * (i - ja)
            if vnow <= 0 or abs(vnow - close) / close > TL_NEAR:
                continue
            score = len(gs) + (last_j - ja) / 100.0 - (i - last_j) / 60.0
            cand = {"side": "resistance" if is_high else "support", "ja": ja, "pa": pa, "slope": slope,
                    "touches": len(gs), "last_j": last_j, "value_asof": vnow, "touch_js": [g[0] for g in gs],
                    "score": score}
            if any(abs(vnow - pv) < PATTERN_ATR * at for pv in pattern_pivots):
                if supp is None or score > supp["score"]:
                    supp = cand
                continue
            if best is None or score > best["score"]:
                best = cand
    return best, supp


# ------------------------------------------------------------------ the drawing
def draw(rows, i=None, pattern_pivots=()):
    """The textbook S/R drawing as of bar i (default: the last row). rows = [(t, o, h, l, c, v), ...] oldest first;
    reads rows[:i+1] only. `pattern_pivots`: every price a served member pattern draws on this chart. Returns a
    JSON-able dict, or None (fewer than MIN_BARS bars, or no ATR)."""
    if i is None:
        i = len(rows) - 1
    b = [(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5] or 0)) for r in rows[:i + 1]]
    i = len(b) - 1
    if i < MIN_BARS - 1:
        return None
    at = _atr(b, i)
    if not at:
        return None
    pp = [float(p) for p in pattern_pivots]
    base = {"round": SR_ROUND, "asof": b[i][0], "close": b[i][4], "atr": round(at, 6), "zones": [], "trendlines": [],
            "pattern_pivots": [round(p, 4) for p in pp]}
    if at / b[i][4] < PINNED_ATR_PCT:
        return {**base, "withheld": "pinned", "suppressed_by_pattern": {"zones": 0, "trendlines": 0},
                "zones_merged": 0, "trendlines_dropped_crowding": 0}
    rng = _vis_range(b, i)
    zs, zsupp, merged = zones(b, i, at, pp)
    tls, tsupp = [], []
    n_crowd = 0
    for is_high in (0, 1):
        t, s = _tl_side(b, i, at, is_high, pp)
        # a line whose as-of value crowds a drawn zone is dropped (the zone carries that price)
        if t and any(not _sep_ok(t["value_asof"], t["value_asof"], z["bot"], z["top"], at, rng) for z in zs):
            t, n_crowd = None, n_crowd + 1
        if t:
            tls.append(t)
        if s:
            tsupp.append(s)
    if len(tls) == 2 and not _sep_ok(tls[0]["value_asof"], tls[0]["value_asof"], tls[1]["value_asof"],
                                     tls[1]["value_asof"], at, rng):
        tls = [max(tls, key=lambda t: t["score"])]
        n_crowd += 1
    T = lambda j: b[j][0]  # noqa: E731
    out = {**base, "suppressed_by_pattern": {"zones": len(zsupp), "trendlines": len(tsupp)},
           "zones_merged": merged, "trendlines_dropped_crowding": n_crowd}
    for z in sorted(zs, key=lambda z: -z["mid"]):
        out["zones"].append({"role": z["role"], "bot": round(z["bot"], 4), "top": round(z["top"], 4),
                             "touches": z["touches"], "first_t": T(z["first_j"]), "last_t": T(z["last_j"]),
                             "touch_ts": [T(j) for j in z["touch_js"]], "broken_retested": z["broken_retested"],
                             "label": "%s %s-%s" % (z["role"], fmt(z["bot"]), fmt(z["top"]))})
    for t in tls:
        p_end = t["pa"] + t["slope"] * (i - t["ja"])
        out["trendlines"].append({"side": t["side"], "t1": T(t["ja"]), "p1": round(t["pa"], 4), "t2": b[i][0],
                                  "p2": round(p_end, 4), "slope_per_bar": round(t["slope"], 6),
                                  "touches": t["touches"], "last_touch_t": T(t["last_j"]),
                                  "span_bars": t["last_j"] - t["ja"],
                                  "touch_ts": [T(j) for j in t["touch_js"]],
                                  "label": "Uptrend line (support)" if t["side"] == "support"
                                  else "Downtrend line (resistance)"})
    return out
