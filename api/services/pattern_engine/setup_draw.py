"""Setup drawings -- remount, undercut & rally, donchian breakout (upside): ONE horizontal line each.

Pure geometry over daily bars [0..i] (bar i = the as-of bar, a COMPLETED session). Nothing here reads a store, a
clock or anything after bar i. Display only: it changes nothing any detector fires on, its confidence, HIST_SCORE or
`confirmed_only`.

These are the drawing rounds that passed two pre-registered blind packets each (two judges per packet, 25 random
liquid held-out charts per packet; bar: mean >= 2.3 AND >= 70% of charts scoring >= 2):
    remount            round 3   A 2.48 / 92%   B 2.42 / 92%
    u_and_r            round 2   A 2.56 / 100%  B 2.50 / 92%
    donchian_breakout  round 1   A 2.70 / 100%  B 2.80 / 100%
Every constant below is that round's, frozen. tests/test_setup_draw_parity.py pins this module's output to the
judged drawing code on an embedded fixture: change a constant and the parity rail goes red. A new round is a new
constant AND a new blind check, never an edit here.

A member gets a drawing only while auto_structures.MEMBER_<SETUP>_ROUND equals the round constant here AND the row's
id is in registry.DISPLAY_MEMBER_SET (auto_structures.member_rows). Fail closed.

Shared inputs (the judged ones, unchanged): the repo's swing pivots (primitives.pivots.detect_pivots, window 3) on the
last PIV_SPAN bars of the WINDOW bars ending at the as-of bar, and deal_status.price_pinned as part of the setup gate.

Each detector returns a dict d = {facts..., 'det': <detection row>} or None. 'det' carries the geometry in the exact
shape PatternOverlay's HorizontalLine draws: ONE full-width line at the mean of the first two anchor prices (both are
AT the level here), solid when the row has >= 3 anchors, else dashed.
"""
from __future__ import annotations

#: The judged drawing rounds (ints, frozen).
REMOUNT_DRAW_ROUND = 3
U_AND_R_DRAW_ROUND = 2
DONCHIAN_DRAW_ROUND = 1

#: setup key -> its drawing round. One authority; auto_structures reads it.
DRAW_ROUNDS = {
    "remount": REMOUNT_DRAW_ROUND,
    "u_and_r": U_AND_R_DRAW_ROUND,
    "donchian_breakout": DONCHIAN_DRAW_ROUND,
}
SETUPS = ("remount", "u_and_r", "donchian_breakout")

WINDOW = 330             # bars handed to a detector (the as-of bar is the last): SMA200 + 20 + the deal read (300)
PIV_SPAN = 200           # swing pivots are read on the last 200 bars only (every lookback here is shorter)
MIN_ASOF_INDEX = 220     # the as-of bar's index in the full series must be >= this (SMA200 + its 20-bar rise)


def _to_dicts(bars) -> list:
    out = []
    for r in bars:
        if isinstance(r, dict):
            out.append({"t": int(r["t"]), "o": float(r["o"]), "h": float(r["h"]), "l": float(r["l"]),
                        "c": float(r["c"]), "v": float(r.get("v") or 0)})
        else:
            out.append({"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]),
                        "v": float(r[5] or 0)})
    return out


# ------------------------------------------------------------------ helpers
def _atr(b, e, n=14):
    k = max(1, e - n + 1)
    trs = [max(b[j]["h"], b[j - 1]["c"]) - min(b[j]["l"], b[j - 1]["c"]) for j in range(k, e + 1)]
    a = sum(trs) / len(trs) if trs else 0.0
    return a if a > 0 else None


def _sma(b, e, n):
    if e + 1 < n:
        return None
    return sum(x["c"] for x in b[e - n + 1:e + 1]) / n


def _avg_vol(b, e, n=20):
    w = b[max(0, e - n):e]
    return sum(x["v"] for x in w) / len(w) if w else 0.0


def _say(why, r):
    if why is not None:
        why.append(r)
    return None


def _pivots(b):
    from api.services.pattern_engine.primitives.pivots import detect_pivots
    s = max(0, len(b) - PIV_SPAN)
    out = []
    for p in detect_pivots(b[s:], window=3):
        out.append((p["bar_index"] + s, p["type"], float(p["price"])))
    return out


# ================================================================== MANDATORY SETUP GATE (all three, bullish)
#: Close above a RISING 200-day SMA (above its value 20 sessions earlier), and not deal-pinned
#: (deal_status.price_pinned on the last 300 bars <= as-of; a pin alone is treated as a deal). The pending-deal NAME
#: lists are the patterns route's deal_hold, asked once before any layer runs.
SMA_LONG, SMA_RISE_BARS = 200, 20


def setup_gate(b, i):
    from api.services import deal_status
    s = _sma(b, i, SMA_LONG)
    s0 = _sma(b, i - SMA_RISE_BARS, SMA_LONG)
    if s is None or s0 is None:
        return "short_history"
    if b[i]["c"] <= s:
        return "below_200d"
    if s <= s0:
        return "falling_200d"
    if deal_status.price_pinned([(x["t"], x["o"], x["h"], x["l"], x["c"]) for x in b[max(0, i - 299):i + 1]]) \
            is not None:
        return "deal_pin"
    return None


def _hline(pid, name, b, anchors_i, direction="bullish", extras=None):
    """A horizontal_line row. anchors_i = [(bar index, price), ...]; PatternOverlay draws ONE full-width line at the
    mean of the first two anchor prices, solid when it has >= 3 anchors, else dashed."""
    return {"pattern_id": pid, "pattern_name": name, "direction": direction, "status": "ready",
            "start_t": int(b[min(j for j, _ in anchors_i)]["t"]), "end_t": int(b[-1]["t"]),
            "geometry": {"shape": "horizontal_line",
                         "anchors": [{"t": int(b[j]["t"]), "price": round(float(p), 4)} for j, p in anchors_i],
                         "extras": extras or {}}}


def _crossings(b, lo, hi, P):
    sg = [1 if b[j]["c"] >= P else -1 for j in range(lo, hi + 1)]
    return sum(1 for a, c in zip(sg, sg[1:]) if a != c)


def _bodies(b, lo, hi, P):
    return sum(1 for j in range(lo, hi + 1) if min(b[j]["o"], b[j]["c"]) < P < max(b[j]["o"], b[j]["c"]))


# ================================================================== REMOUNT (round 3)
#: The level is a HORIZONTAL swing pivot (high or low, <= RM_PIV_AGE bars before the remount bar); 5-30 consecutive
#: closes below it; the remount close above it within the last RM_FRESH bars on >= RM_VOL x the 20-bar volume; every
#: close since holds it; it held before it broke (>= RM_HOLD_MIN of the RM_HOLD_BARS closes before the breakdown at or
#: above it); it is not a chop line (<= RM_MAX_CROSS close crossings and <= RM_MAX_BODIES bodies cut in the
#: RM_CROSS_LOOK bars before the breakdown); the breakdown left it (a close >= RM_DEPTH_ATR x ATR under it); the remount
#: close and the as-of close >= level + RM_MARGIN_ATR x ATR; the as-of close <= level + RM_EXT_ATR x ATR. Several
#: qualifying levels: the most prior pivots within 0.5 ATR, then the latest pivot. Drawn AT the level, solid.
RM_FRESH = 3
RM_BELOW_MIN, RM_BELOW_MAX = 5, 30
RM_PIV_AGE = 120
RM_CROSS_LOOK = 60
RM_MAX_CROSS = 2
RM_MAX_BODIES = 3
RM_DEPTH_ATR = 0.5
RM_VOL = 1.2
RM_EXT_ATR = 2.0
RM_HOLD_BARS, RM_HOLD_MIN = 15, 10
RM_MARGIN_ATR = 0.25
RM_ROUND = REMOUNT_DRAW_ROUND


def remount(b, why=None):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None:
        return _say(why, "no_atr")
    piv = None
    last = "rm_no_reclaim"
    for r in range(ia, ia - RM_FRESH, -1):
        if r < 60 or b[r]["c"] <= b[r - 1]["c"]:
            continue
        if piv is None:
            piv = _pivots(b)
        cands = []
        for (p, typ, P) in piv:
            if p < r - RM_PIV_AGE or not (b[r - 1]["c"] < P < b[r]["c"]):
                continue
            if min(b[r]["c"], b[ia]["c"]) < P + RM_MARGIN_ATR * atr:
                last = "rm_marginal_reclaim"
                continue
            n = 0
            while n <= RM_BELOW_MAX and b[r - 1 - n]["c"] < P:
                n += 1
            if not (RM_BELOW_MIN <= n <= RM_BELOW_MAX):
                last = "rm_breakdown_len"
                continue
            bs = r - n
            if p >= bs:
                continue
            if sum(1 for j in range(max(0, bs - RM_HOLD_BARS), bs) if b[j]["c"] >= P) < RM_HOLD_MIN:
                last = "rm_level_not_held_before"
                continue
            lo = max(1, bs - RM_CROSS_LOOK)
            if _crossings(b, lo, bs - 1, P) > RM_MAX_CROSS:
                last = "rm_crossed_often"
                continue
            if _bodies(b, lo, bs - 1, P) > RM_MAX_BODIES:
                last = "rm_bodies"
                continue
            if min(b[j]["c"] for j in range(bs, r)) > P - RM_DEPTH_ATR * atr:
                last = "rm_shallow_breakdown"
                continue
            av = _avg_vol(b, r)
            if av <= 0 or b[r]["v"] < RM_VOL * av:
                last = "rm_light_volume"
                continue
            if any(b[j]["c"] < P for j in range(r + 1, ia + 1)):
                last = "rm_lost_level"
                continue
            if b[ia]["c"] > P + RM_EXT_ATR * atr:
                last = "rm_extended"
                continue
            near = sum(1 for (q, _, Q) in piv if q < bs and abs(Q - P) <= 0.5 * atr)
            cands.append((near, p, P, typ, n, bs, r))
        if cands:
            near, p, P, typ, n, bs, r = max(cands, key=lambda x: (x[0], x[1]))
            g = setup_gate(b, ia)
            if g:
                return _say(why, g)
            lowj = min(range(bs, r), key=lambda j: b[j]["l"])
            det = _hline("remount", "Remount", b, [(p, P), (bs, P), (r, P), (lowj, b[lowj]["l"]), (r, b[r]["c"])])
            return {"shape": "remount", "draw_round": RM_ROUND, "level": round(P, 4), "level_type": "pivot_" + typ,
                    "pivot_age": r - p, "breakdown_bars": n, "remount_bars_ago": ia - r,
                    "level_pivots_near": near, "vol_ratio": round(b[r]["v"] / _avg_vol(b, r), 2),
                    "close_vs_level_atr": round((b[ia]["c"] - P) / atr, 2),
                    "breakdown_depth_atr": round((P - min(b[j]["c"] for j in range(bs, r))) / atr, 2), "det": det}
    return _say(why, last)


# ================================================================== UNDERCUT & RALLY (round 2)
#: Support = a REAL PRIOR LOW: a swing-low pivot UR_MIN_GAP..UR_PIV_AGE bars before the undercut, the lowest low from
#: UR_HOLD_LOOK bars before it up to the undercut, with a bounce off it of >= UR_BOUNCE_ATR x ATR; the undercut = 1..
#: UR_MAX_BELOW consecutive closes below it (the close before them above it), its low 0.5%-6% under it; the reclaim
#: close within the last UR_FRESH bars; every close since holds it; the reclaim close and the as-of close >= support +
#: UR_RECLAIM_FRAC x (support - undercut low); not a chop line; rally volume >= UR_VOL x the undercut average; the
#: as-of close <= support + UR_EXT_ATR x ATR. Several qualifying lows: the lowest, then the latest. Drawn AT the
#: support, solid.
UR_FRESH = 3
UR_MAX_BELOW = 5
UR_MIN_GAP, UR_PIV_AGE = 5, 60
UR_HOLD_LOOK = 10
UR_DEPTH_MIN, UR_DEPTH_MAX = 0.005, 0.06
UR_BOUNCE_ATR = 2.0
UR_EXT_ATR = 2.0
UR_VOL = 0.7
UR_RECLAIM_FRAC = 0.25
UR_CROSS_LOOK, UR_MAX_CROSS, UR_MAX_BODIES = 60, 2, 3
UR_ROUND = U_AND_R_DRAW_ROUND


def u_and_r(b, why=None):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None:
        return _say(why, "no_atr")
    piv = None
    last = "ur_no_reclaim"
    for r in range(ia, ia - UR_FRESH, -1):
        if r < 80 or b[r - 1]["c"] >= b[r]["c"]:
            continue
        if piv is None:
            piv = [(p, P) for (p, typ, P) in _pivots(b) if typ == "low"]
        cands = []
        for (p, S) in piv:
            if not (b[r - 1]["c"] < S < b[r]["c"]):
                continue
            n = 0
            while n <= UR_MAX_BELOW and b[r - 1 - n]["c"] < S:
                n += 1
            if not (1 <= n <= UR_MAX_BELOW):
                last = "ur_undercut_too_long"
                continue
            u0 = r - n
            if not (u0 - UR_PIV_AGE <= p <= u0 - UR_MIN_GAP):
                last = "ur_pivot_age"
                continue
            if min(b[j]["l"] for j in range(max(0, p - UR_HOLD_LOOK), u0)) < S:
                last = "ur_not_the_low"
                continue
            if max(b[j]["h"] for j in range(p + 1, u0)) < S + UR_BOUNCE_ATR * atr:
                last = "ur_no_bounce"
                continue
            ul = min(b[j]["l"] for j in range(u0, r))
            depth = (S - ul) / S
            if not (UR_DEPTH_MIN <= depth <= UR_DEPTH_MAX):
                last = "ur_depth"
                continue
            thr = S + UR_RECLAIM_FRAC * (S - ul)
            if b[r]["c"] < thr or b[ia]["c"] < thr:
                last = "ur_marginal_reclaim"
                continue
            lo = max(1, u0 - UR_CROSS_LOOK)
            if _crossings(b, lo, u0 - 1, S) > UR_MAX_CROSS or _bodies(b, lo, u0 - 1, S) > UR_MAX_BODIES:
                last = "ur_crossed_often"
                continue
            uv = sum(b[j]["v"] for j in range(u0, r)) / n
            if uv > 0 and b[r]["v"] < UR_VOL * uv:
                last = "ur_light_rally"
                continue
            if any(b[j]["c"] < S for j in range(r + 1, ia + 1)):
                last = "ur_lost_level"
                continue
            if b[ia]["c"] > S + UR_EXT_ATR * atr:
                last = "ur_extended"
                continue
            cands.append((S, p, n, u0, r, ul, depth))
        if cands:
            S, p, n, u0, r, ul, depth = min(cands, key=lambda x: (x[0], -x[1]))
            g = setup_gate(b, ia)
            if g:
                return _say(why, g)
            lowj = min(range(u0, r), key=lambda j: b[j]["l"])
            det = _hline("u_and_r", "Undercut & Rally", b, [(p, S), (p, S), (r - 1, S), (lowj, ul), (r, b[r]["c"])])
            return {"shape": "u_and_r", "draw_round": UR_ROUND, "level": round(S, 4), "pivot_age": u0 - p,
                    "undercut_bars": n, "undercut_depth": round(depth, 4), "reclaim_bars_ago": ia - r,
                    "close_vs_level_atr": round((b[ia]["c"] - S) / atr, 2), "det": det}
    return _say(why, last)


# ================================================================== DONCHIAN BREAKOUT, UPSIDE (round 1)
#: UPSIDE only; the 55-bar channel only; the channel high (the latest bar reaching the prior 55 bars' max wick) at
#: least DC_MIN_AGE bars before the breakout; the breakout = the FIRST close above the channel (the bar before it inside
#: its own channel) within the last DC_FRESH bars on >= DC_VOL x the 20-bar average volume; every close since holds the
#: line; after the breakout bar the as-of close <= line + DC_EXT_ATR x ATR. Drawn AT the line, 2 anchors = dashed.
DC_N = 55
DC_FRESH = 3
DC_MIN_AGE = 8
DC_VOL = 1.0
DC_EXT_ATR = 3.0
DC_ROUND = DONCHIAN_DRAW_ROUND


def _chan(b, k):
    w = range(k - DC_N, k)
    H = max(b[j]["h"] for j in w)
    hj = max(j for j in w if b[j]["h"] == H)
    return H, hj


def donchian_breakout(b, why=None):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < DC_N + 30:
        return _say(why, "no_atr")
    for k in range(ia, ia - DC_FRESH, -1):
        H, hj = _chan(b, k)
        if b[k]["c"] <= H:
            continue
        H1, _ = _chan(b, k - 1)
        if b[k - 1]["c"] > H1:
            continue                       # not the first close above the channel: look earlier
        if k - hj < DC_MIN_AGE:
            return _say(why, "dc_channel_high_too_recent")
        av = _avg_vol(b, k)
        if av <= 0 or b[k]["v"] < DC_VOL * av:
            return _say(why, "dc_light_volume")
        if any(b[j]["c"] < H for j in range(k + 1, ia + 1)):
            return _say(why, "dc_failed")
        if k < ia and b[ia]["c"] > H + DC_EXT_ATR * atr:
            return _say(why, "dc_extended")
        g = setup_gate(b, ia)
        if g:
            return _say(why, g)
        det = _hline("donchian_breakout", "Donchian breakout (55-bar)", b, [(hj, H), (ia, H)])
        return {"shape": "donchian_breakout", "draw_round": DC_ROUND, "level": round(H, 4),
                "channel_high_age": k - hj, "breakout_bars_ago": ia - k, "vol_ratio": round(b[k]["v"] / av, 2),
                "close_vs_level_atr": round((b[ia]["c"] - H) / atr, 2), "det": det}
    return _say(why, "dc_no_breakout")


# ================================================================== entry points
DETECT = {"remount": remount, "u_and_r": u_and_r, "donchian_breakout": donchian_breakout}


def _window(bars) -> list:
    """The ONLY way a detector sees bars: the WINDOW bars ending at the as-of bar (the last one), nothing after it."""
    return _to_dicts(list(bars)[-WINDOW:])


def detect(setup: str, bars, why=None):
    """One setup's drawing for `bars` (oldest first, the LAST one the as-of bar, a completed session; dicts {t,o,h,
    l,c,v} or (t,o,h,l,c,v) rows), or None. `bars` may hold the whole series: only the last WINDOW are read."""
    b = list(bars or [])
    if len(b) - 1 < MIN_ASOF_INDEX:
        return _say(why, "short_history")
    return DETECT[setup](_window(b), why)


def detect_all(bars) -> dict:
    """{setup: drawing or None} for every setup, from one window."""
    b = list(bars or [])
    if len(b) - 1 < MIN_ASOF_INDEX:
        return {s: None for s in SETUPS}
    w = _window(b)
    return {s: DETECT[s](w, None) for s in SETUPS}


def facts(d: dict) -> dict:
    return {k: v for k, v in d.items() if k != "det"}
