"""Rare-pattern drawings for the admin preview: CUP WITHOUT HANDLE and HIGH TIGHT FLAG.

DISPLAY ONLY and ADMIN ONLY. Nothing here is read by any detector, confidence, HIST_SCORE or `confirmed_only`.
The rows these drawings become (auto_structures.rare_preview_rows) exist only while
AUTO_STRUCTURES_RARE_PREVIEW_ENABLED is on, sit in neither registry display set, and carry member literals of
None, so member_rows drops every one of them. They are shown to the owner beside an approve / reject flow
(api/services/rare_preview.py); a pattern reaches members only by a LATER commit, after the release rule there
is met.

Why a preview instead of more blind rounds: these patterns are rare (a fraction of a percent of liquid stock
days), so the held-out pool cannot supply fresh blind packets fast enough. Each drawing round below is the
lab's first textbook round (more coverage) with the second round's fixes for the faults the judges named, and
without the second round's over-strict extras (it fired on 3 and 1 of 20,000 random liquid days):

    judged fault                                  fix here
    a spike wick taken as the buy point           ceiling-bar buy point (textbook_numbers.ceiling_bar)
    a W / double low                              a mid-cup rally on the closes AND on the lows
    a V                                           roundness + no cliff 5-bar drop / vertical 5-bar ramp
    a crash-led cup                               no single bar dropping a big share of the depth
    a cup giving back most of its run-up (NEW)    depth <= CNH_MAX_GIVEBACK of the prior advance
    a lip far under the old highs (NEW)           lip near the 52-week high
    a staircase pole                              no deep pullback and no long stall inside the pole
    a loose or sagging flag                       flag true range vs ATR; the close and the last highs hold up

Measured 2026-10-23 on the lab's own 20,000 random liquid held-out stock days (same seed and rule as its
coverage runs; draws are with replacement): cup without handle 14 hits (0.07%; 5 distinct days on 4 tickers),
high tight flag 7 hits (0.035%; 6 distinct days). The lab's first round fired 42 / 26 there and its second
round 3 / 1. Of the first round's fires, every one this code withholds is withheld for a judged fault (cup:
gives back more than half the advance, a W, a V; flag: a staircase or stalling pole, a loose or sagging flag).

The BUY POINT is the IBD convention: the ceiling bar's high + $0.10 (textbook_numbers.buy_point). Only a bar
that is part of the drawn ceiling counts -- its body top within base_draw.TOUCH ATR of the ceiling and its high
no more than textbook_numbers.SPIKE_MAX_ATR ATR over it -- so a lone wick is never the buy point.

`*_drawing(bars, i)` reads bars[:i+1] only (no lookahead) and returns the drawing (the same shape as
shape_draw's drawings, plus `buy_point` and `buy_label`) or None. Bars are {t, o, h, l, c, v} dicts, oldest
first.
"""
from __future__ import annotations

from typing import Optional

from api.services import textbook_numbers as tbn
from api.services.pattern_engine import shape_draw as _sd

#: The drawing round this code IS, per shape. Bump with every change to that shape's drawing.
CUP_NO_HANDLE_DRAW_ROUND = 1
HTF_DRAW_ROUND = 1
#: Bars handed to a drawing (the as-of bar is the last).
WINDOW = 600
#: The last this-many bars may close above the buy point (a breakout in progress); no close before them may.
BREAK_BARS = 3
#: The buy range: up to this far above the buy point; past it the pattern has run (IBD 5%).
BUY_ZONE = 0.05


def _atr(b, n=14):
    """ATR(n) over the last n true ranges of `b` (the lab's definition), or None."""
    k = min(n, len(b) - 1)
    trs = [max(float(b[j]["h"]), float(b[j - 1]["c"])) - min(float(b[j]["l"]), float(b[j - 1]["c"]))
           for j in range(len(b) - k, len(b))]
    a = sum(trs) / len(trs) if trs else 0.0
    return a if a > 0 else None


def _bt(x):
    return max(float(x["o"]), float(x["c"]))


def _bb(x):
    return min(float(x["o"]), float(x["c"]))


def _ceiling(b, ks, ceil, atr):
    """(highest high, its index) over the ceiling bars among indices `ks`, or (None, None). A ceiling bar is the
    one textbook_numbers.ceiling_bar names (one authority over what a ceiling bar is)."""
    best = (None, None)
    for k in ks:
        if tbn.ceiling_bar(b[k], ceil, atr):
            h = float(b[k]["h"])
            if best[0] is None or h > best[0]:
                best = (h, k)
    return best


def _floor(b, ks, flo, atr):
    """The mirror of `_ceiling` for a base low: (lowest low, index) over bars whose body bottom is within TOUCH
    ATR of the body floor and whose low is at most SPIKE_MAX_ATR ATR under it (a lone wick is not the low)."""
    from api.services.pattern_engine import base_draw
    best = (None, None)
    for k in ks:
        x = b[k]
        if _bb(x) <= flo + base_draw.TOUCH * atr and float(x["l"]) >= flo - tbn.SPIKE_MAX_ATR * atr:
            if best[0] is None or float(x["l"]) < best[0]:
                best = (float(x["l"]), k)
    return best


def _buy(b, ks, ceil, atr, high):
    """The buy point for a ceiling whose ceiling-bar high is `high`, or None when the guard does not hold."""
    bp = tbn.buy_point(high)
    win = [b[k] for k in ks]
    return bp if tbn.buy_point_justified(win, bp, ceil, atr) else None


def _say(why, reason):
    if why is not None:
        why.append(reason)
    return None


# ================================================================================ CUP WITHOUT HANDLE
#: A cup lasts 7 to 65 weeks (O'Neil / Bulkowski; primitives.cup CUP_MIN_BARS / CUP_MAX_BARS).
CNH_MIN_BARS = 35
CNH_MAX_BARS = 325
#: Lip to base low, 12-33% (Bulkowski T9.1 O'Neil criteria; primitives.cup).
CNH_MIN_DEPTH = 0.12
CNH_MAX_DEPTH = 0.33
#: A prior advance of at least 30% into the lip (primitives.cup CUP_PRIOR_UPTREND, its 120-bar lookback).
CNH_PRIOR_UPTREND = 0.30
CNH_PRIOR_LOOK = 120
#: NEW: the cup gives back at most this share of the prior advance (lip - low <= share x (lip - prior low)).
#: A cup that hands back most or all of the run-up is a failed advance, not a base (judged fault).
CNH_MAX_GIVEBACK = 0.50
#: NEW: the lip within this share of the highest high of the year before it (a base near the highs, not a
#: rebound under old highs after a crash; judged fault).
CNH_LIP_NEAR_HIGH = 0.85
CNH_HIGH_LOOK = 250
#: The lip's body top tops the 50 bars before it (the base's left-side high, not a lower high inside it).
CNH_LIP_LEFT = 50
#: Ceiling bars are read within this many bars either side of the lip bar.
CNH_LIP_ZONE = 10
#: After the lip zone no high may stand more than this many ATR over the lip before the breakout bars (the
#: line already pierced: the spike-wick fault seen from the right side).
CNH_POKE_ATR = 0.5
#: No high in the CNH_LIP_LEFT bars before the lip more than this many ATR over it (a higher wick to the left
#: reads as "the lip is under an earlier high").
CNH_LEFT_WICK_ATR = 0.5
#: The low sits between these shares of the cup's span (not jammed at either end).
CNH_LOW_POS = (0.20, 0.80)
#: CRASH: no single close-to-close drop on the left side larger than this share of the cup's full depth.
CNH_MAX_BAR_DROP = 0.35
#: V: no 5-bar close drop on the left side over this share of the depth, no 5-bar rise on the right over this.
CNH_MAX_5BAR_DROP = 0.55
CNH_MAX_5BAR_RISE = 0.75
#: U not V (primitives.cup MIN_ROUNDNESS).
CNH_MIN_ROUND = 0.10
#: W: a mid-cup rally over this share of the depth, on 5-bar smoothed closes (cup_tier HUMP_MAX) ...
CNH_HUMP_MAX = 0.25
#: ... or on 3-bar smoothed lows (a W or an undercut in the wicks).
CNH_LOW_HUMP_MAX = 0.25
#: The right side's high is back within 5% of the lip, and no handle has formed: that high is in the last
#: CNH_NO_HANDLE_BARS bars (a handle is a week or more).
CNH_RIGHT_HIGH = 0.95
CNH_NO_HANDLE_BARS = 5
#: The as-of close within 5% of the lip.
CNH_CLOSE_MIN = 0.95


def cup_no_handle_drawing(bars, i, _why=None) -> Optional[dict]:
    """The cup without handle as of bars[i], or None. Reads bars[:i+1] only."""
    import numpy as np
    from api.services.pattern_engine import cup_tier
    from api.services.pattern_engine.primitives import cup as _cup, shape as _shape
    b = list(bars[max(0, i + 1 - WINDOW):i + 1])
    n = len(b)
    if n < CNH_MIN_BARS + 60:
        return _say(_why, "short")
    atr = _atr(b)
    if atr is None:
        return _say(_why, "no_atr")
    last = n - 1
    pre = last - BREAK_BARS
    bt = [_bt(x) for x in b]
    # the lip REGION: the nearest high, at least CNH_MIN_BARS back, that tops everything to its right (bar the
    # breakout bars) and the CNH_LIP_LEFT bars to its left (the lab's round 1). The lip PRICE is not that high:
    # it is the highest high of the CEILING bars around it -- the line on the region's top body cluster -- so a
    # lone wick finds the region but is never the buy point.
    hs = [float(x["h"]) for x in b]
    run = max(hs[last - CNH_MIN_BARS + 1:pre + 1])
    j = None
    for k in range(last - CNH_MIN_BARS, max(-1, last - CNH_MAX_BARS - 1), -1):
        if hs[k] >= run and hs[k] >= max(hs[max(0, k - CNH_LIP_LEFT):k + 1]):
            j = k
            break
        run = max(run, hs[k])
    if j is None:
        return _say(_why, "no_lip")
    aj = _atr(b[:j + 1])
    if aj is None:
        return _say(_why, "no_atr")
    zone = range(max(0, j - CNH_LIP_ZONE), min(pre, j + CNH_LIP_ZONE) + 1)
    ceil = max(bt[k] for k in zone)
    lip, li = _ceiling(b, zone, ceil, aj)
    if lip is None:
        return _say(_why, "no_ceiling")
    bp = _buy(b, zone, ceil, aj, lip)
    if bp is None:
        return _say(_why, "buy_point_unjustified")
    span = last - li
    if not (CNH_MIN_BARS <= span <= CNH_MAX_BARS):
        return _say(_why, "length")
    if any(float(b[k]["c"]) > lip for k in range(li + 1, pre + 1)):
        return _say(_why, "closed_above_lip")
    if any(float(b[k]["h"]) > lip + CNH_POKE_ATR * aj for k in range(j + CNH_LIP_ZONE + 1, pre + 1)):
        return _say(_why, "poked_above_lip")
    if any(float(b[k]["h"]) > lip + CNH_LEFT_WICK_ATR * aj for k in range(max(0, li - CNH_LIP_LEFT), li)):
        return _say(_why, "higher_spike_left")
    flo = min(_bb(b[k]) for k in range(li + 1, n))
    low, low_i = _floor(b, range(li + 1, n), flo, atr)
    if low is None:
        return _say(_why, "no_floor")
    depth = (lip - low) / lip
    if depth < CNH_MIN_DEPTH:
        return _say(_why, "too_shallow")
    if depth > CNH_MAX_DEPTH:
        return _say(_why, "too_deep")
    pos = (low_i - li) / span
    if not (CNH_LOW_POS[0] <= pos <= CNH_LOW_POS[1]):
        return _say(_why, "low_at_edge")
    dd = lip - low
    # the crash / V shares are of the cup's FULL depth (to its lowest low, wicks included), as the lab's
    # round 1 measured them: the wick-free floor makes the depth smaller and every bar's share bigger
    dfull = lip - min(float(b[k]["l"]) for k in range(li, n))
    c = [float(x["c"]) for x in b]
    if any(c[k - 1] - c[k] > CNH_MAX_BAR_DROP * dfull for k in range(li + 1, low_i + 1)):
        return _say(_why, "crash_bar")
    if any(c[k - 5] - c[k] > CNH_MAX_5BAR_DROP * dfull for k in range(li + 5, low_i + 1)):
        return _say(_why, "v_left")
    if any(c[k] - c[k - 5] > CNH_MAX_5BAR_RISE * dfull for k in range(low_i + 5, n)):
        return _say(_why, "v_right")
    r_i = max(range(low_i, n), key=lambda k: (float(b[k]["h"]), k))
    if float(b[r_i]["h"]) < CNH_RIGHT_HIGH * lip:
        return _say(_why, "right_side_low")
    if last - r_i >= CNH_NO_HANDLE_BARS:
        return _say(_why, "handle_or_pullback")
    close = c[last]
    if close < CNH_CLOSE_MIN * lip:
        return _say(_why, "close_low")
    if close > bp * (1.0 + BUY_ZONE):
        return _say(_why, "extended")
    if close < bp and any(c[k] > bp for k in range(pre + 1, last)):
        return _say(_why, "failed_breakout")
    rnd = _shape.roundness(b, li, r_i)
    if rnd is None or rnd < CNH_MIN_ROUND:
        return _say(_why, "v_shape")
    cc = np.array(c[li:r_i + 1])
    hump = cup_tier._hump(cup_tier._smooth(cc, 5 if r_i - li >= 15 else 3))
    if hump is None or hump > CNH_HUMP_MAX:
        return _say(_why, "w_closes")
    ll = np.array([float(x["l"]) for x in b[li:r_i + 1]])
    ll[0], ll[-1] = lip, float(b[r_i]["h"])          # the rims are the highs; the inside is the lows
    lhump = cup_tier._hump(cup_tier._smooth(ll, 3))
    if lhump is None or lhump > CNH_LOW_HUMP_MAX:
        return _say(_why, "w_lows")
    pre_lows = [(float(b[k]["l"]), k) for k in range(max(0, li - CNH_PRIOR_LOOK), li) if float(b[k]["l"]) > 0]
    if len(pre_lows) < 20:
        return _say(_why, "short_history")
    plo, _plo_i = min(pre_lows)
    adv = (c[li] - plo) / plo if plo > 0 else 0.0
    if adv < CNH_PRIOR_UPTREND:
        return _say(_why, "no_prior_uptrend")
    giveback = dd / (lip - plo) if lip > plo else 1.0
    if giveback > CNH_MAX_GIVEBACK:
        return _say(_why, "gives_back_the_advance")
    old = max(float(x["h"]) for x in b[max(0, li - CNH_HIGH_LOOK):li + 1])
    if lip < CNH_LIP_NEAR_HIGH * old:
        return _say(_why, "lip_under_old_high")
    if _sd._spike(b, li, aj):
        return _say(_why, "spike_lip")
    if _cup.cup_with_handle_state(b) is not None:
        return _say(_why, "has_valid_handle")      # that is the cup with handle: do not draw it twice
    marks = [(li, lip, "lip"), (low_i, low, "low"), (r_i, float(b[r_i]["h"]), "right_high")]
    return _sd._out("cup-no-handle", CUP_NO_HANDLE_DRAW_ROUND, b, li, bp, low, low_i, atr, marks, {
        "lip": round(lip, 6), "buy_point": bp, "buy_label": "Cup w/o handle · Buy point %.2f" % bp,
        "pivot_from_t": int(b[li]["t"]), "path": True, "weeks": round(span / 5.0, 1),
        "base_depth": round(depth, 4), "roundness": round(rnd, 3), "hump": round(hump, 3),
        "low_hump": round(lhump, 3), "prior_advance": round(adv, 3), "giveback": round(giveback, 3),
        "lip_vs_52w_high": round(lip / old, 4)})


# ================================================================================ HIGH TIGHT FLAG
#: The pole: at least 90% (Bulkowski: "at least 90%, shoot for a double, in 2 months or less"; IBD 100-120%),
#: no upper cap, in 8 to 40 bars (IBD 4-8 weeks; 8 bars admits a gap-and-go pole).
HTF_POLE_MIN_GAIN = 0.90
HTF_POLE_MIN_BARS = 8
HTF_POLE_MAX_BARS = 40
#: The pole starts at the LAST bar whose low is within 8% of the pole's lowest low (the launch, not a week of
#: basing before it).
HTF_LAUNCH = 1.08
#: NEAR-VERTICAL: no pullback inside the pole deeper than this off its running high (a staircase; judged fault).
HTF_POLE_MAX_DD = 0.22
#: ... and no stretch of more than this many bars inside the pole without a new pole high.
HTF_STALL_BARS = 10
#: The flag: 3-5 weeks (IBD), 5-25% deep (IBD 10-20%, sometimes 25%; under 5% was a merger-arbitrage pin).
HTF_FLAG_MIN_BARS = 15
HTF_FLAG_MAX_BARS = 25
HTF_FLAG_MIN_DEPTH = 0.05
HTF_FLAG_MAX_DEPTH = 0.25
#: TIGHT: the flag's mean true range at most this many ATR(14) at the peak (the flag quieter than the pole).
HTF_FLAG_TIGHT = 1.0
#: NOT SAGGING: the as-of close within 15% under the buy point, and the last 5 bars' high back in the upper
#: half of the flag (the lab's second round asked 10%, which removed a third of the first round's fires).
HTF_CLOSE_MIN = 0.85
HTF_HIGHS_HOLD = 0.50
#: The peak is a 250-bar high (a pole to new highs, not a rebound under old ones).
HTF_PEAK_LOOK = 250
#: No flag high more than this many ATR over the drawn peak before the breakout bars (the line already pierced).
HTF_SPIKE_ABOVE_ATR = 0.5


def high_tight_flag_drawing(bars, i, _why=None) -> Optional[dict]:
    """The high tight flag as of bars[i], or None. Reads bars[:i+1] only."""
    b = list(bars[max(0, i + 1 - WINDOW):i + 1])
    n = len(b)
    if n < 80:
        return _say(_why, "short")
    last = n - 1
    pre = last - BREAK_BARS
    bt = [_bt(x) for x in b]
    lo_w = max(0, last - HTF_FLAG_MAX_BARS - HTF_POLE_MAX_BARS)
    # the peak REGION is the highest high before the breakout bars (the lab's round 1); the peak PRICE is the
    # highest high of the ceiling bars within 5 bars of it (the line on the top body cluster), so a lone wick
    # finds the region but is never the buy point
    p0 = max(range(lo_w, pre + 1), key=lambda k: (float(b[k]["h"]), k))
    ap = _atr(b[:p0 + 1])
    if ap is None:
        return _say(_why, "no_atr")
    zone = range(max(0, p0 - 5), min(pre, p0 + 5) + 1)
    ceil = max(bt[k] for k in zone)
    peak, p = _ceiling(b, zone, ceil, ap)
    if peak is None:
        return _say(_why, "no_ceiling")
    bp = _buy(b, zone, ceil, ap, peak)
    if bp is None:
        return _say(_why, "buy_point_unjustified")
    flag_bars = last - p
    if not (HTF_FLAG_MIN_BARS <= flag_bars <= HTF_FLAG_MAX_BARS):
        return _say(_why, "flag_length")
    if any(float(b[k]["c"]) > peak for k in range(p + 1, pre + 1)):
        return _say(_why, "closed_above_peak")
    if any(float(b[k]["h"]) > peak + HTF_SPIKE_ABOVE_ATR * ap for k in range(p + 1, pre + 1)):
        return _say(_why, "spike_above_peak")
    o = min(range(max(0, p - HTF_POLE_MAX_BARS), p + 1), key=lambda k: (float(b[k]["l"]), -k))
    if float(b[o]["l"]) <= 0:
        return _say(_why, "bad_px")
    launch = max(k for k in range(o, p + 1) if float(b[k]["l"]) <= HTF_LAUNCH * float(b[o]["l"]))
    base = float(b[launch]["l"])
    pole_bars = p - launch
    # the gain is measured from the pole's lowest low (the lab's round 1); the launch bar only places the pole's
    # start for its length, pullback and stall tests
    gain = (peak - float(b[o]["l"])) / float(b[o]["l"])
    if gain < HTF_POLE_MIN_GAIN:
        return _say(_why, "pole_small")
    if pole_bars < HTF_POLE_MIN_BARS:
        return _say(_why, "pole_too_fast")
    # the pole's running high is read on BODY TOPS, so one wick never fakes a pullback or a stall
    m, pdd = 0.0, 0.0
    for k in range(launch, p + 1):
        m = max(m, bt[k])
        pdd = max(pdd, (m - float(b[k]["l"])) / m)
    if pdd > HTF_POLE_MAX_DD:
        return _say(_why, "pole_pullback")
    m, last_new, stall = bt[launch], launch, 0
    for k in range(launch + 1, p + 1):
        if bt[k] > m:
            m, last_new = bt[k], k
        stall = max(stall, k - last_new)
    if stall > HTF_STALL_BARS:
        return _say(_why, "pole_stalls")
    fl_i = min(range(p + 1, n), key=lambda k: (float(b[k]["l"]), k))
    fl = float(b[fl_i]["l"])
    depth = (peak - fl) / peak
    if depth > HTF_FLAG_MAX_DEPTH:
        return _say(_why, "flag_deep")
    if depth < HTF_FLAG_MIN_DEPTH:
        return _say(_why, "flag_pinned")
    if p < HTF_PEAK_LOOK - 1 or max(float(x["h"]) for x in b[p - HTF_PEAK_LOOK + 1:p + 1]) > \
            peak + tbn.SPIKE_MAX_ATR * ap:
        return _say(_why, "peak_not_high")
    close = float(b[last]["c"])
    if close < HTF_CLOSE_MIN * bp:
        return _say(_why, "flag_sagging")
    if max(float(x["h"]) for x in b[last - 4:]) < fl + HTF_HIGHS_HOLD * (peak - fl):
        return _say(_why, "highs_sagging")
    trs = [max(float(b[k]["h"]), float(b[k - 1]["c"])) - min(float(b[k]["l"]), float(b[k - 1]["c"]))
           for k in range(p + 1, n)]
    tight = (sum(trs) / len(trs)) / ap
    if tight > HTF_FLAG_TIGHT:
        return _say(_why, "flag_loose")
    pv = sum(float(x["v"] or 0) for x in b[launch:p + 1]) / (pole_bars + 1)
    fv = sum(float(x["v"] or 0) for x in b[p + 1:n]) / flag_bars
    if not fv < pv:
        return _say(_why, "flag_volume_not_drying")
    if close > bp * (1.0 + BUY_ZONE):
        return _say(_why, "extended")
    if close < bp and any(float(b[k]["c"]) > bp for k in range(pre + 1, last)):
        return _say(_why, "failed_breakout")
    atr = _atr(b) or ap
    marks = [(launch, base, "pole_low"), (p, peak, "peak"), (fl_i, fl, "flag_low")]
    return _sd._out("htf", HTF_DRAW_ROUND, b, launch, bp, fl, fl_i, atr, marks, {
        "peak": round(peak, 6), "buy_point": bp, "buy_label": "High tight flag · Buy point %.2f" % bp,
        "pivot_from_t": int(b[p]["t"]), "path": True, "pole_gain": round(gain, 3), "pole_bars": pole_bars,
        "flag_bars": flag_bars, "flag_depth": round(depth, 4), "pole_max_dd": round(pdd, 3),
        "pole_stall": stall, "flag_tight": round(tight, 3), "flag_vol_ratio": round(fv / pv, 3) if pv else None})
