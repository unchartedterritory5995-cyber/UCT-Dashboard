"""Textbook support / resistance -- ZONES and major TRENDLINES on a daily chart (drawing round "r7").

Pure geometry over daily bars [0..i] (bar i = the as-of bar, a COMPLETED session). Nothing here reads a store, a
clock or anything after bar i: `draw` slices rows[:i+1] before it reads anything. Display only: it changes nothing
any detector fires on.

Drawing round "r7" (SR_ROUND). Every constant below is that round's, frozen; a member gets the layer only while
auto_structures.MEMBER_SR_ROUND equals this constant (fail closed). Round r7 passed the strict Edwards & Magee /
Bulkowski recertification on 100 fresh held-out charts (four pre-registered packets of 25, two fresh blind judges
each): 2.42 / 2.52 / 2.36 / 2.50, pooled 2.45; bar: every packet >= 2.3 and >= 70% >= 2, pooled >= 2.4. Its DEV
lookahead check passed. Round r2 (below, the base) passed a looser rubric and failed the strict one (pooled 2.06).

Round r7 = round r2's geometry with these zone rules (each constant is named where it is used):
  * A level needs at least two real reactions in every family: r2's 3-touch zones; two-touch levels whose reactions
    are >= PAIR_GAP (8) sessions apart, and a shorter family >= PAIR_GAP_SHORT (5) apart; congestion levels on
    +-CONG_K (2) session turns with >= CONG_MIN (3) reactions; and an unfilled gap (>= GAP_ATR ATR) whose edge price
    came back to and reacted at. No one-touch levels.
  * BREAKS: a close beyond the band by >= max(BRK_ATR (1) ATR, BRK_PCT (3%) of the edge) breaks it. A broken level is
    drawn in its new role ONLY after a held retest (from the RETEST_MIN-th session after the break price comes back to
    the band from the new side and closes outside it); until then it is not drawn. A close back inside the band, or
    back through it, cancels the break (the level keeps its old role).
  * At most MAX_ZONES (3), at most MAX_PER_SIDE (2) per side; the nearest support and resistance first, each the
    best-supported level within BEST_WIN ATR of the closest.
  * SERVING RULE: a chart with fewer than MIN_LEVELS (2) zones gets NO layer (zones and trendlines empty, withheld
    "too_few_levels"): about half of liquid charts get one.
Round r2's rules, still in force where r7 does not replace them:
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

A port of the frozen lab generator (recert/D_levels_candles/r7: sr6.py over the r2 generator, plus the serving rule);
tests/test_sr_levels_parity.py pins it to that generator's own output on every fixture chart and proves the rail fails
when one parameter moves.
"""
from __future__ import annotations

import math

#: The drawing round this code draws.
SR_ROUND = "r7"

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
# ------------------------------------------------------------------ constants added by rounds r5-r7 (frozen at r7)
#: A SIGNIFICANT penetration (a break): a close beyond the band edge by >= max(BRK_ATR x ATR(14), BRK_PCT x edge).
BRK_ATR = 1.0
BRK_PCT = 0.03
#: A held retest counts from the RETEST_MIN-th session after the break.
RETEST_MIN = 3
#: Two-touch levels: reactions >= PAIR_GAP sessions apart, and the short family >= PAIR_GAP_SHORT apart.
PAIR_GAP = 8
PAIR_GAP_SHORT = 5
#: Congestion: +-CONG_K-session turning points with >= CONG_MIN distinct reactions in the band.
CONG_K = 2
CONG_MIN = 3
#: An unfilled gap of >= GAP_ATR ATR whose edge was retested at least once.
GAP_ATR = 1.0
#: The nearest level of a side = the best-supported one within BEST_WIN ATR of the closest.
BEST_WIN = 2.0
#: Level families, strongest first (merge order and the nearest-pick tie-break).
TIER_R2, TIER_PAIR, TIER_CONG, TIER_PAIR5, TIER_GAP = 0, 1, 3, 4, 5
#: The SERVING RULE (round r7): a chart with fewer than MIN_LEVELS zones gets NO layer (withheld "too_few_levels").
MIN_LEVELS = 2

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


def _median(ps):
    ps = sorted(ps)
    n = len(ps)
    return ps[n // 2] if n % 2 else 0.5 * (ps[n // 2 - 1] + ps[n // 2])


def _piv(b, lo, i, is_high, k):
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


def _thr(at, edge):
    """A SIGNIFICANT penetration: a close beyond the band edge by at least max(BRK_ATR x ATR, BRK_PCT x edge)."""
    return max(BRK_ATR * at, BRK_PCT * edge)


def _eval(b, i, at, ext, centre, min_touch, sep):
    """One candidate band around `centre`: the state machine over the bars after its first touch (rows[:i+1] only).
      intact     no significant close through the band (a close beyond it by >= _thr);
      broken     the LAST significant close through it has had no held retest yet: NOT drawn (returns None);
      confirmed  after that break, price came back to the band from the new side (from the RETEST_MIN-th session
                 on) and closed outside it (a held retest): drawn in the new role, broken_retested.
    A close back INSIDE the band, or back through it to the pre-break side, after a break is a FAILED break: the
    break is cancelled and the level keeps its pre-break role, intact again."""
    bot, top = centre - ZONE_HALF * at, centre + ZONE_HALF * at
    hits = sorted((j, p, h) for j, p, h in ext if bot <= p <= top)
    if not hits:
        return None
    gs = _groups([j for j, _, _ in hits], sep)
    first_j = hits[0][0]
    side = 1 if hits[0][2] == 0 else -1
    state, broken_at, retest_j = "intact", None, None
    for j in range(first_j + 1, i + 1):
        c, lo_, hi_ = b[j][4], b[j][3], b[j][2]
        if state != "intact" and ((side == 1 and c <= top) or (side == -1 and c >= bot)):   # a failed break:
            # a close back INSIDE the band, or back through it to the pre-break side (short of a new significant
            # break), undoes the break
            side, state, broken_at, retest_j = -side, "intact", None, None
            continue
        if side == 1 and c < bot - _thr(at, bot):
            side, state, broken_at, retest_j = -1, "broken", j, None
            continue
        if side == -1 and c > top + _thr(at, top):
            side, state, broken_at, retest_j = 1, "broken", j, None
            continue
        if state == "broken" and j >= broken_at + RETEST_MIN:       # a held retest
            if (side == 1 and lo_ <= top and c > top) or (side == -1 and hi_ >= bot and c < bot):
                state, retest_j = "confirmed", j
    pre = [g for g in gs if broken_at is not None and g[0] < broken_at]
    post = [g for g in gs if broken_at is not None and g[0] > broken_at]
    if state == "intact":
        if len(gs) < min_touch:
            return None
        n_touch = len(gs)
        touch_js = [g[0] for g in gs]
    elif state == "confirmed":
        n_touch = len(pre) + max(len(post), 1)
        if not (len(gs) >= min_touch or (len(pre) >= RR_PRE_TOUCH and n_touch >= min_touch)):
            return None
        n_touch = max(n_touch, len(gs))
        touch_js = [g[0] for g in gs] + ([] if post else [retest_j])
    else:                                   # broken, not yet retested: NOT drawn
        return None
    close = b[i][4]
    if close > top:
        role = "Support"
    elif close < bot:
        role = "Resistance"
    else:
        role = "Support" if side == 1 else "Resistance"
    last_j = max([j for j, _, _ in hits] + ([retest_j] if retest_j is not None else []))
    return {"bot": bot, "top": top, "mid": centre, "touches": n_touch, "first_j": first_j, "last_j": last_j,
            "role": role, "state": state, "broken_retested": state == "confirmed", "touch_js": sorted(touch_js),
            "score": n_touch + REC_W * math.exp(-(i - last_j) * math.log(2) / REC_HL)}


def _snap(b, i, at, ext, z, min_touch, sep):
    for _ in range(SNAP_ITERS):
        inb = [p for j, p, _ in ext if z["bot"] <= p <= z["top"]]
        if not inb:
            break
        med = _median(inb)
        if abs(med - z["mid"]) < 0.01 * at:
            break
        z2 = _eval(b, i, at, ext, med, min_touch, sep)
        if z2 is None or z2["touches"] < z["touches"]:
            break
        z = z2
    return z


def _cands(b, i, at, ext, min_touch, sep, tier):
    out, seen = [], set()
    for _, p0, _ in ext:
        z = _eval(b, i, at, ext, p0, min_touch, sep)
        if z is None:
            continue
        z = _snap(b, i, at, ext, z, min_touch, sep)
        key = round(z["mid"] / (0.05 * at))
        if key in seen:
            continue
        seen.add(key)
        z["tier"] = tier
        out.append(z)
    return out


def _best_near(side, close, at):
    """The level drawn nearest on one side is the BEST-SUPPORTED one among those within BEST_WIN ATR of the
    closest (most touches, then the stronger tier, then the most recent), not merely the closest."""
    if not side:
        return None
    dist = lambda z: abs(z["mid"] - close)  # noqa: E731
    d0 = min(dist(z) for z in side)
    pool = [z for z in side if dist(z) <= d0 + BEST_WIN * at]
    return max(pool, key=lambda z: (z["touches"], -z["tier"], z["last_j"]))


def _gap_cands(b, i, at, ext):
    """An UNFILLED gap's edge (the pre-gap bar's high for a gap up, its low for a gap down) as a level when price
    later came back to it and reacted there: the gap plus >= 1 reaction pivot inside the band = >= 2 real reactions.
    A close back through the edge fills the gap and removes the level."""
    lo = max(1, i - LOOK + 1)
    out = []
    for j in range(lo, i + 1):
        up = b[j][3] > b[j - 1][2] + GAP_ATR * at
        dn = b[j][2] < b[j - 1][3] - GAP_ATR * at
        if not (up or dn):
            continue
        edge = b[j - 1][2] if up else b[j - 1][3]
        if any((b[x][4] < edge - _thr(at, edge)) if up else (b[x][4] > edge + _thr(at, edge)) for x in range(j, i + 1)):
            continue                                             # filled: a significant close back through the edge
        bot, top = edge - ZONE_HALF * at, edge + ZONE_HALF * at
        tests = [x for x, p, h in ext if x > j and bot <= p <= top and h == (0 if up else 1)]
        if not tests:
            continue
        gs = _groups(tests, TOUCH_SEP)
        last_j = max(tests)
        n = 1 + len(gs)
        out.append({"bot": bot, "top": top, "mid": edge, "touches": n, "first_j": j - 1, "last_j": last_j,
                    "role": "Support" if up else "Resistance", "state": "intact", "broken_retested": False,
                    "touch_js": sorted([j] + [g[0] for g in gs]), "tier": TIER_GAP,
                    "score": n + REC_W * math.exp(-(i - last_j) * math.log(2) / REC_HL)})
    return out


def zones(b, i, at, pattern_pivots=()):
    lo = max(0, i - LOOK + 1)
    close = b[i][4]
    rng = _vis_range(b, i)
    ext3 = [(j, p, 1) for j, p in _pivots(b, lo, i, True)] + [(j, p, 0) for j, p in _pivots(b, lo, i, False)]
    a = _cands(b, i, at, ext3, MIN_TOUCH, TOUCH_SEP, TIER_R2)
    p2 = _cands(b, i, at, ext3, 2, PAIR_GAP, TIER_PAIR)     # two-touch, >= PAIR_GAP sessions apart
    p5 = _cands(b, i, at, ext3, 2, PAIR_GAP_SHORT, TIER_PAIR5)   # two-touch, PAIR_GAP_SHORT.. sessions apart
    ext2 = [(j, p, 1) for j, p in _piv(b, lo, i, True, CONG_K)] + [(j, p, 0) for j, p in _piv(b, lo, i, False, CONG_K)]
    cg = _cands(b, i, at, ext2, CONG_MIN, TOUCH_SEP, TIER_CONG)  # congestion: small swings
    sw = _gap_cands(b, i, at, ext3)                                   # retested gap edges (no one-touch levels)
    supp, ok = [], []
    for z in sorted(a, key=lambda z: (-z["score"], -z["last_j"], z["mid"])) + \
            sorted(p2, key=lambda z: (-z["score"], -z["last_j"], z["mid"])) + \
            sorted(cg, key=lambda z: (-z["score"], -z["last_j"], z["mid"])) + \
            sorted(p5, key=lambda z: (-z["score"], -z["last_j"], z["mid"])) + sw:
        near = 0.0 if z["bot"] <= close <= z["top"] else min(abs(z["bot"] - close), abs(z["top"] - close))
        z["near"] = near / close
        if z["near"] > ZONE_NEAR_FALLBACK or (z["near"] > ZONE_NEAR and z["tier"] != TIER_R2):
            continue
        if any(z["bot"] - PATTERN_ATR * at <= pv <= z["top"] + PATTERN_ATR * at for pv in pattern_pivots):
            supp.append(z)
            continue
        ok.append(z)
    reps, merged = [], 0
    for z in ok:                                       # higher tier first: a 3-touch zone absorbs a weaker level near it
        if all(_sep_ok(z["bot"], z["top"], r["bot"], r["top"], at, rng) for r in reps):
            reps.append(z)
        else:
            merged += 1
    sup = sorted([z for z in reps if z["role"] == "Support"], key=lambda z: -z["mid"])
    res = sorted([z for z in reps if z["role"] == "Resistance"], key=lambda z: z["mid"])
    near = [z for z in reps if z["near"] <= ZONE_NEAR]
    if near:                                           # the 25% fallback only when nothing is within 15%
        reps = near
        sup = [z for z in sup if z in near]
        res = [z for z in res if z in near]
    else:
        reps = sorted(reps, key=lambda z: z["near"])[:1]
        sup = [z for z in sup if z in reps]
        res = [z for z in res if z in reps]
    pick = [z for z in (_best_near(sup, close, at), _best_near(res, close, at)) if z]
    for z in sorted(reps, key=lambda z: (z["tier"], -z["score"])):
        if len(pick) >= MAX_ZONES:
            break
        if z in pick or sum(q["role"] == z["role"] for q in pick) >= MAX_PER_SIDE:
            continue
        pick.append(z)
    return pick, supp, merged


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
                             "state": z["state"],
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
    if len(out["zones"]) < MIN_LEVELS:      # the r7 serving rule: fewer than MIN_LEVELS levels -> no layer at all
        out = {**out, "zones": [], "trendlines": [], "withheld": "too_few_levels"}
    return out
