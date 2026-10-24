"""Setup drawings, round 2 -- textbook rebuilds that passed two pre-registered blind packets each.

Pure geometry over daily bars [0..i] (bar i = the as-of bar, a COMPLETED session). Nothing here reads a store, a
clock or anything after bar i. Display only: it changes nothing any detector fires on, its confidence, HIST_SCORE or
`confirmed_only`.

Each setup below was rebuilt to its textbook definition and judged AS DRAWN by two fresh blind judges per packet on
two packets of 25 random liquid held-out charts each (bar: mean >= 2.3 AND >= 70% of charts scoring >= 2):
    rsi_bullish_divergence   A 2.56 / 96%   B 2.72 / 100%   (drawn on price AND on an RSI(14) panel)
    wyckoff_upthrust         A 2.56 / 100%  B 2.48 / 96%    (bearish)
    channel                  A 2.84 / 100%  B 2.48 / 100%
    pennant                  A 2.46 / 88%   B 2.34 / 80%
    darvas_box               A 2.62 / 96%   B 2.60 / 92%
    falling_wedge            A 2.84 / 100%  B 2.76 / 100%
    double_top               A 2.38 / 84%   B 2.56 / 88%    (bearish)
    golden_cross             A 2.52 / 88%   B 2.46 / 84%    (two curves, SMA 50 and SMA 200)
    death_cross              A 2.42 / 92%   B 2.34 / 92%    (bearish, two curves)
Every constant and every line of detection code below is the judged code, frozen (comments removed). The parity
rail tests/test_setup_draw_r2_parity.py pins this module's output, as-of every bar of embedded synthetic series, to
the judged code's output: change a constant and it goes red. A new round is a new constant AND a new blind check,
never an edit here.

A member gets a drawing only while auto_structures.MEMBER_<SETUP>_ROUND equals R2_DRAW_ROUND AND the row's id is in
registry.DISPLAY_MEMBER_SET (auto_structures.member_rows). Fail closed.

Shared inputs (as judged): the repo's swing pivots (primitives.pivots.detect_pivots, window 3) on the last PIV_SPAN
bars of the WINDOW bars ending at the as-of bar, and deal_gate (ATR14 >= 0.8% of the close, and
deal_status.price_pinned on the last 300 bars is None). The pending-deal NAME lists are the patterns route's
deal_hold, asked once before any layer runs.

Each detector returns a dict d = {facts..., 'dets': [detection rows], 'panel': optional RSI panel} or None. 'dets'
carry the geometry in the shapes PatternOverlay draws: horizontal_line, trendline_pair (4 anchors, log-space lanes,
optional extras.draw_pole), rectangle (2 corners) and neckline (2 anchors, the divergence segment). The RSI bullish
divergence also carries 'panel' = {'rsi': RSI(14) per bar of the window, 'p1', 'p2': window indices}: the judged
picture draws an RSI(14) panel under price with the same two points joined.
"""
from __future__ import annotations

import math

#: The judged drawing round of every setup here (the textbook rebuild, round 2), frozen.
R2_DRAW_ROUND = 2

def _atr(b, e, n=14):
    k = max(1, e - n + 1)
    trs = [max(b[j]['h'], b[j - 1]['c']) - min(b[j]['l'], b[j - 1]['c']) for j in range(k, e + 1)]
    a = sum(trs) / len(trs) if trs else 0.0
    return a if a > 0 else None


def _sma(b, e, n, key='c'):
    if e + 1 < n or e < 0:
        return None
    return sum(x[key] for x in b[e - n + 1:e + 1]) / n


def _ema_series(vals, n):
    out, k, e = [], 2.0 / (n + 1), None
    for v in vals:
        e = v if e is None else e + k * (v - e)
        out.append(e)
    return out


def _avg_vol(b, e, n=20):
    w = b[max(0, e - n):e]
    return sum(x['v'] for x in w) / len(w) if w else 0.0


def _say(why, r):
    if why is not None:
        why.append(r)
    return None


def _rsi(b, n=14):
    """Wilder RSI(14) on closes (seeded with the simple mean of the first n changes)."""
    c = [x['c'] for x in b]
    out = [None] * len(c)
    if len(c) <= n:
        return out
    g = [max(0.0, c[j] - c[j - 1]) for j in range(1, len(c))]
    lo = [max(0.0, c[j - 1] - c[j]) for j in range(1, len(c))]
    ag, al = sum(g[:n]) / n, sum(lo[:n]) / n
    out[n] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    for j in range(n + 1, len(c)):
        ag = (ag * (n - 1) + g[j - 1]) / n
        al = (al * (n - 1) + lo[j - 1]) / n
        out[j] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return out


WINDOW = 330

PIV_SPAN = 200

def _t(b, j):
    return int(b[j]['t'])


SMA_LONG, SMA_RISE_BARS = 200, 20

MIN_ATR_PCT = 0.008

def _pivots(b, w=3):
    from api.services.pattern_engine.primitives.pivots import detect_pivots
    s = max(0, len(b) - PIV_SPAN)
    hi, lo = [], []
    for p in detect_pivots(b[s:], window=w):
        (hi if p["type"] == "high" else lo).append(p["bar_index"] + s)
    return hi, lo


def deal_gate(tk, b, i):
    """Not a dead-flat chart (ATR14 >= MIN_ATR_PCT of the close) and not deal-pinned (deal_status.price_pinned on the
    last 300 bars <= as-of; a pin alone is treated as a deal). `tk` is unused here: the pending-deal NAME lists are
    the patterns route's deal_hold."""
    from api.services import deal_status
    a = _atr(b, i)
    if a is None or a / b[i]["c"] < MIN_ATR_PCT:
        return "dead_flat"
    if deal_status.price_pinned([(x["t"], x["o"], x["h"], x["l"], x["c"]) for x in b[max(0, i - 299):i + 1]]) \
            is not None:
        return "deal_pin"
    return None


def bull_gate(tk, b, i):
    """Close above a RISING 200-day SMA (above its value 20 sessions earlier), and deal_gate."""
    s = _sma(b, i, SMA_LONG)
    s0 = _sma(b, i - SMA_RISE_BARS, SMA_LONG)
    if s is None or s0 is None:
        return 'short_history'
    if b[i]['c'] <= s:
        return 'below_200d'
    if s <= s0:
        return 'falling_200d'
    return deal_gate(tk, b, i)


def _row(pid, name, b, shape, anchors_i, direction, extras=None, sub=None, start=None):
    g = {'shape': shape, 'anchors': [{'t': _t(b, j), 'price': round(float(p), 4)} for j, p in anchors_i],
         'extras': extras or {}}
    if sub:
        g['semantic_subtype'] = sub
    s0 = start if start is not None else min(j for j, _ in anchors_i)
    return {'pattern_id': pid, 'pattern_name': name, 'direction': direction, 'status': 'ready',
            'start_t': _t(b, s0), 'end_t': _t(b, len(b) - 1), 'geometry': g}


def _line_rows_pair(pid, name, b, up, lo, direction, pole=None):
    """trendline_pair with 4 anchors: upper (u0 -> u1), lower (l0 -> l1), each a log-space line."""
    ex = {'line_spaces': ['log', 'log']}
    if pole:
        ex['draw_pole'] = [{'t': _t(b, j), 'price': round(float(p), 4)} for j, p in pole]
    return _row(pid, name, b, 'trendline_pair', [up[0], up[1], lo[0], lo[1]], direction, ex, sub='converging_pair')


class LLine:
    """A straight line in log-price space through (x1, p1), (x2, p2)."""

    def __init__(self, x1, p1, x2, p2):
        self.x1, self.y1 = x1, math.log(p1)
        self.m = (math.log(p2) - math.log(p1)) / (x2 - x1)

    def at(self, x):
        return math.exp(self.y1 + self.m * (x - self.x1))


def _tol(b, j, atr, k):
    """k x ATR expressed as a log-space tolerance at bar j."""
    return k * atr / b[j]['c']


def _best_line(b, idxs, j_lo, j_hi, side, atr, tol_k, min_sep, must_first=None):
    """Brute force over pivot pairs (p1 < p2, p2 - p1 >= min_sep): the log-space line through them that bounds every
    bar in [p1, j_hi] (upper: highs <= line + tol; lower: lows >= line - tol; tol = tol_k x ATR / close). Returns
    (touches, span, line, p1, p2, touch list) for the pair with the most distinct pivot touches (>= min_sep apart),
    then the longest span. must_first: p1 must equal it."""
    import numpy as np
    key = 'h' if side == 'up' else 'l'
    cand = [p for p in idxs if j_lo <= p <= j_hi]
    if len(cand) < 2:
        return None
    x0 = cand[0]
    ys = np.log(np.array([b[j][key] for j in range(x0, j_hi + 1)]))
    tl = tol_k * atr / np.array([b[j]['c'] for j in range(x0, j_hi + 1)])
    xs = np.arange(x0, j_hi + 1)
    cy = np.array([ys[p - x0] for p in cand])
    ctl = np.array([tl[p - x0] for p in cand])
    cx = np.array(cand)
    best = None
    for a_ in range(len(cand)):
        p1 = cand[a_]
        if must_first is not None and p1 != must_first:
            continue
        for b_ in range(a_ + 1, len(cand)):
            p2 = cand[b_]
            if p2 - p1 < min_sep:
                continue
            m = (cy[b_] - cy[a_]) / (p2 - p1)
            seg = slice(p1 - x0, None)
            ly = cy[a_] + m * (xs[seg] - p1)
            d = ys[seg] - ly
            if side == 'up':
                if np.any(d > tl[seg]):
                    continue
            elif np.any(d < -tl[seg]):
                continue
            sel = cx >= p1
            near = np.abs(cy[sel] - (cy[a_] + m * (cx[sel] - p1))) <= ctl[sel]
            dist = []
            for p in cx[sel][near]:
                if not dist or p - dist[-1] >= min_sep:
                    dist.append(int(p))
            sc = (len(dist), p2 - p1)
            if best is None or sc > best[0]:
                best = (sc, p1, p2, dist)
    if best is None:
        return None
    (nt, span), p1, p2, dist = best
    return nt, span, LLine(p1, b[p1][key], p2, b[p2][key]), p1, p2, dist


def _interior(ts_, a, z, lo=0.15, hi=0.75):
    """A touch strictly inside the pattern (15% .. 75% of its span), not only at its ends."""
    return any(a + lo * (z - a) < p < a + hi * (z - a) for p in ts_)


def _alternations(ta, tb_):
    """How many times the touch sequence switches line (U L U L = 3)."""
    seq = sorted([(p, 0) for p in ta] + [(p, 1) for p in tb_])
    return sum(1 for x, y in zip(seq, seq[1:]) if x[1] != y[1])


RD_CONF = 2

RD_FRESH = 6

RD_NEWEXT = 60

RD_SEP_MIN, RD_SEP_MAX = 8, 40

RD_SWING_ATR = 1.0

RD_PX_ATR = 0.2

RD_OB, RD_OS = 65.0, 35.0

RD_RSI_GAP = 5.0

RD_BAR_ATR = 2.5

def _rsi_div(tk, b, why, bear):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 120:
        return _say(why, 'no_atr')
    r = _rsi(b)
    key = 'h' if bear else 'l'
    sgn = 1 if bear else -1

    def ext(j):
        return sgn * b[j][key]
    for j2 in range(ia - RD_CONF, ia - RD_FRESH - 1, -1):
        if not all(ext(j2) > ext(x) for x in range(j2 - 3, j2)):
            continue
        if not all(ext(j2) >= ext(x) for x in range(j2 + 1, ia + 1)):
            continue
        if ext(j2) < max(ext(x) for x in range(ia - RD_NEWEXT, ia + 1)):
            continue
        if b[j2]['h'] - b[j2]['l'] > RD_BAR_ATR * atr:
            return _say(why, 'rd_wide_second_bar')
        best = None
        for j1 in range(j2 - RD_SEP_MIN, j2 - RD_SEP_MAX - 1, -1):
            if j1 < 3 or not all(ext(j1) > ext(x) for x in list(range(j1 - 3, j1)) + list(range(j1 + 1, j1 + 4))):
                continue
            if any(ext(x) > ext(j1) for x in range(j1 + 1, j2)):
                continue

            if bear:
                swing = b[j1]['h'] - min(b[x]['l'] for x in range(j1 + 1, j2))
            else:
                swing = max(b[x]['h'] for x in range(j1 + 1, j2)) - b[j1]['l']
            if swing < RD_SWING_ATR * atr:
                continue

            if best is None or ext(j1) > ext(best):
                best = j1
        if best is None:
            return _say(why, 'rd_no_first_point')
        j1 = best
        if sgn * (b[j2][key] - b[j1][key]) < RD_PX_ATR * atr:
            return _say(why, 'rd_marginal_price')
        r1, r2 = r[j1], r[j2]
        if r1 is None or r2 is None:
            return _say(why, 'rd_no_rsi')
        if bear and not (r1 >= RD_OB and r2 <= r1 - RD_RSI_GAP):
            return _say(why, 'rd_rsi')
        if not bear and not (r1 <= RD_OS and r2 >= r1 + RD_RSI_GAP):
            return _say(why, 'rd_rsi')
        g = deal_gate(tk, b, ia)
        if g:
            return _say(why, g)
        pid = 'rsi_bearish_divergence' if bear else 'rsi_bullish_divergence'
        name = 'RSI bearish divergence' if bear else 'RSI bullish divergence'
        det = _row(pid, name, b, 'neckline', [(j1, b[j1][key]), (j2, b[j2][key])],
                   'bearish' if bear else 'bullish')
        panel = {'rsi': [None if v is None else round(v, 3) for v in r], 'p1': j1, 'p2': j2}
        return {'shape': pid, 'sep': j2 - j1, 'second_age': ia - j2, 'rsi1': round(r1, 1), 'rsi2': round(r2, 1),
                'px_diff_atr': round(sgn * (b[j2][key] - b[j1][key]) / atr, 2), 'dets': [det], 'panel': panel}
    return _say(why, 'rd_no_second_point')


def rsi_bullish_divergence(tk, b, why=None):
    return _rsi_div(tk, b, why, False)


WY_WINDOWS = (60, 50, 40, 30)

WY_TOUCH_ATR = 0.5

WY_SEP = 5

WY_DRIFT = 0.25

WY_FRESH = 3

WY_DEPTH_ATR = 2.0

WY_MINH, WY_MAXH = 0.06, 0.35

WY_BACK_ATR = 0.25

def _drift(cl):
    n = len(cl)
    mx = (n - 1) / 2
    my = sum(cl) / n
    num = sum((k - mx) * (y - my) for k, y in enumerate(cl))
    den = sum((k - mx) ** 2 for k in range(n))
    return abs(num / den) * (n - 1) if den else 0.0


def _wyckoff(tk, b, why, spring):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 120:
        return _say(why, 'no_atr')
    hi_p, lo_p = _pivots(b)
    for k in range(ia - WY_FRESH + 1, ia + 1):
        for W in WY_WINDOWS:
            r0, r1 = k - W, k - 1
            S = min(b[j]['l'] for j in range(r0, r1 + 1))
            R = max(b[j]['h'] for j in range(r0, r1 + 1))
            if not (WY_MINH <= (R - S) / S <= WY_MAXH):
                continue
            if spring and not (b[k]['l'] < S - 0.1 * atr and b[k]['l'] >= S - WY_DEPTH_ATR * atr):
                continue
            if not spring and not (b[k]['h'] > R + 0.1 * atr and b[k]['h'] <= R + WY_DEPTH_ATR * atr):
                continue

            if spring and min(b[j]['l'] for j in range(k, ia + 1)) < S - WY_DEPTH_ATR * atr:
                continue
            if not spring and max(b[j]['h'] for j in range(k, ia + 1)) > R + WY_DEPTH_ATR * atr:
                continue
            ts_ = [p for p in lo_p if r0 <= p <= r1 and b[p]['l'] <= S + WY_TOUCH_ATR * atr]
            tr_ = [p for p in hi_p if r0 <= p <= r1 and b[p]['h'] >= R - WY_TOUCH_ATR * atr]
            if not ts_ or not tr_ or ts_[-1] - ts_[0] < WY_SEP or tr_[-1] - tr_[0] < WY_SEP:
                continue
            cl = [b[j]['c'] for j in range(r0, r1 + 1)]
            if _drift(cl) > WY_DRIFT * (R - S):
                continue
            if sum(1 for c in cl if S <= c <= R) < 0.9 * len(cl):
                continue
            beyond = [(b[j]['c'] < S) if spring else (b[j]['c'] > R) for j in range(k, ia + 1)]
            run = mx = 0
            for x in beyond:
                run = run + 1 if x else 0
                mx = max(mx, run)
            if mx > 2:
                continue
            c = b[ia]['c']

            if spring and not (S + WY_BACK_ATR * atr <= c <= S + 0.5 * (R - S)):
                continue
            if not spring and not (R - 0.5 * (R - S) <= c <= R - WY_BACK_ATR * atr):
                continue
            g = deal_gate(tk, b, ia)
            if g:
                return _say(why, g)
            lvl = S if spring else R
            touches = ts_ if spring else tr_
            pid = 'wyckoff_spring' if spring else 'wyckoff_upthrust'
            anch = [(touches[0], lvl), (ia, lvl), (k, lvl)]
            det = _row(pid, 'Wyckoff spring' if spring else 'Wyckoff upthrust', b, 'horizontal_line', anch,
                       'bullish' if spring else 'bearish')
            det['touch_count'] = len(touches) + 1
            return {'shape': pid, 'range_bars': W, 'level': round(lvl, 4), 'height_pct': round(100 * (R - S) / S, 1),
                    'probe_bars_ago': ia - k, 'touches': len(touches), 'dets': [det]}
    return _say(why, 'wy_none')


def wyckoff_upthrust(tk, b, why=None):
    return _wyckoff(tk, b, why, False)


CH_LOOK = 150

CH_TOL_ATR = 0.3

CH_SEP = 6

CH_MIN_SPAN = 30

CH_MINW, CH_MAXW = 3.0, 10.0

CH_ALT = 3

CH_COVER = 0.4

def channel(tk, b, why=None):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 200:
        return _say(why, 'no_atr')
    hi_p, lo_p = _pivots(b)
    j_hi = ia - 2
    best = None
    for side, idxs, other, okey in (('up', hi_p, lo_p, 'l'), ('lo', lo_p, hi_p, 'h')):
        r = _best_line(b, idxs, ia - CH_LOOK, j_hi, side, atr, CH_TOL_ATR, CH_SEP)
        if r is None:
            continue
        nt, span, L, p1, p2, t_base = r

        if side == 'up':
            c = min(math.log(b[j]['l']) - L.m * j for j in range(p1, j_hi + 1))
        else:
            c = max(math.log(b[j]['h']) - L.m * j for j in range(p1, j_hi + 1))

        def P(x, c=c, L=L):
            return math.exp(c + L.m * x)
        t_oth = []
        for p in other:
            if p1 <= p <= j_hi and abs(math.log(b[p][okey]) - math.log(P(p))) <= _tol(b, p, atr, CH_TOL_ATR):
                if not t_oth or p - t_oth[-1] >= CH_SEP:
                    t_oth.append(p)
        tb = []
        for p in t_base:
            if not tb or p - tb[-1] >= CH_SEP:
                tb.append(p)
        if len(tb) < 2 or len(t_oth) < 2 or len(tb) + len(t_oth) < 5:
            continue
        s0 = min(tb[0], t_oth[0])
        if ia - s0 < CH_MIN_SPAN:
            continue
        if (tb[-1] - tb[0]) < CH_COVER * (ia - s0) or (t_oth[-1] - t_oth[0]) < CH_COVER * (ia - s0):
            continue
        if _alternations(tb, t_oth) < CH_ALT:
            continue
        up_at = (lambda x: L.at(x)) if side == 'up' else P
        lo_at = P if side == 'up' else (lambda x: L.at(x))
        w = (up_at(ia) - lo_at(ia)) / atr
        if not (CH_MINW <= w <= CH_MAXW):
            continue
        sc = (len(tb) + len(t_oth), ia - s0)
        if best is None or sc > best[0]:
            best = (sc, s0, up_at, lo_at, len(tb), len(t_oth), side, L.m)
    if best is None:
        return _say(why, 'ch_none')
    sc, s0, up_at, lo_at, nb, no, side, m = best

    for j in range(s0, j_hi + 1):
        if b[j]['c'] > up_at(j) + CH_TOL_ATR * atr or b[j]['c'] < lo_at(j) - CH_TOL_ATR * atr:
            return _say(why, 'ch_not_respected')
    c = b[ia]['c']
    if c > up_at(ia) + 1.0 * atr or c < lo_at(ia) - 1.0 * atr:
        return _say(why, 'ch_left')
    if b[ia - 2]['c'] > up_at(ia - 2) or b[ia - 2]['c'] < lo_at(ia - 2):
        return _say(why, 'ch_left_earlier')
    g = deal_gate(tk, b, ia)
    if g:
        return _say(why, g)
    slope_pct = 100 * (math.exp(m * 20) - 1)
    det = _line_rows_pair('channel', 'Price channel', b, [(s0, up_at(s0)), (ia, up_at(ia))],
                          [(s0, lo_at(s0)), (ia, lo_at(ia))], 'neutral')
    return {'shape': 'channel', 'span': ia - s0, 'touches': sc[0], 'slope_pct_per_20': round(slope_pct, 2),
            'width_atr': round((up_at(ia) - lo_at(ia)) / atr, 2), 'base': side, 'dets': [det]}


PN_POLE_MAX = 12

PN_POLE_PCT = 0.12

PN_POLE_ATR = 4.0

PN_MIN, PN_MAX = 5, 20

PN_DEPTH = 0.5

def pennant(tk, b, why=None):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 200:
        return _say(why, 'no_atr')
    lo = ia - 25
    H = max(b[j]['h'] for j in range(lo, ia + 1))
    P = max(j for j in range(lo, ia + 1) if b[j]['h'] == H)
    if not (PN_MIN <= ia - P <= PN_MAX):
        return _say(why, 'pn_length')
    s_lo = P - PN_POLE_MAX
    L0 = min(b[j]['l'] for j in range(s_lo, P + 1))
    S = max(j for j in range(s_lo, P + 1) if b[j]['l'] == L0)
    if P - S < 3:
        return _say(why, 'pn_pole_short')
    pole = H - L0
    if pole / L0 < PN_POLE_PCT or pole < PN_POLE_ATR * atr:
        return _say(why, 'pn_no_pole')

    best_m, H2 = None, None
    for j in range(P + 2, ia):
        m = (math.log(b[j]['h']) - math.log(H)) / (j - P)
        if best_m is None or m > best_m:
            best_m, H2 = m, j
    if H2 is None or H2 > ia - 1:
        return _say(why, 'pn_no_upper')
    U = LLine(P, H, H2, b[H2]['h'])
    if H - U.at(ia) < 0.5 * atr:
        return _say(why, 'pn_upper_flat')

    L1v = min(b[j]['l'] for j in range(P + 1, ia + 1))
    L1 = min(j for j in range(P + 1, ia + 1) if b[j]['l'] == L1v)
    if L1 > P + (ia - P) // 2 + 1:
        return _say(why, 'pn_low_late')
    best_m, L2 = None, None
    for j in range(L1 + 2, ia + 1):
        m = (math.log(b[j]['l']) - math.log(L1v)) / (j - L1)
        if best_m is None or m < best_m:
            best_m, L2 = m, j
    if L2 is None:
        return _say(why, 'pn_no_lower')
    Lw = LLine(L1, L1v, L2, b[L2]['l'])
    if Lw.at(ia) - L1v < 0.3 * atr:
        return _say(why, 'pn_lower_flat')
    if Lw.at(ia) >= U.at(ia):
        return _say(why, 'pn_crossed')
    if (H - L1v) > PN_DEPTH * pole:
        return _say(why, 'pn_deep')
    c = b[ia]['c']
    if c < Lw.at(ia):
        return _say(why, 'pn_broke_down')
    if c > U.at(ia):
        if c > U.at(ia) + 1.5 * atr or b[ia - 2]['c'] > U.at(ia - 2):
            return _say(why, 'pn_left')
    g = bull_gate(tk, b, ia)
    if g:
        return _say(why, g)
    det = _line_rows_pair('pennant', 'Pennant', b, [(P, H), (ia, U.at(ia))], [(L1, L1v), (ia, Lw.at(ia))],
                          'bullish', pole=[(S, L0), (P, H)])
    return {'shape': 'pennant', 'pole_pct': round(100 * pole / L0, 1), 'pole_bars': P - S, 'len': ia - P,
            'depth_of_pole': round((H - L1v) / pole, 2), 'dets': [det]}


DV_FRESH = 2

DV_MAX_DEPTH = 0.12

DV_MAX_LEN = 30

def darvas_box(tk, b, why=None):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 270:
        return _say(why, 'no_atr')
    for T in range(ia - 6, ia - DV_MAX_LEN - 1, -1):
        top = b[T]['h']
        if top < max(b[j]['h'] for j in range(T - 251, T + 1)):
            continue
        if not all(b[j]['h'] < top for j in range(T + 1, T + 4)):
            continue

        if any(b[j]['h'] > top for j in range(T + 1, ia - DV_FRESH + 1)):
            continue
        Bv = min(b[j]['l'] for j in range(T + 1, ia + 1))
        B = max(j for j in range(T + 1, ia + 1) if b[j]['l'] == Bv)
        if B > ia - 3:
            return _say(why, 'dv_bottom_unconfirmed')
        if (top - Bv) / top > DV_MAX_DEPTH:
            return _say(why, 'dv_deep')
        c = b[ia]['c']
        if c > top:
            if c > top + atr or any(b[j]['c'] > top for j in range(T + 1, ia - DV_FRESH + 1)):
                return _say(why, 'dv_left')
        g = bull_gate(tk, b, ia)
        if g:
            return _say(why, g)
        det = _row('bc:darvas-box', 'Darvas box', b, 'rectangle', [(T, top), (ia, Bv)], 'bullish')
        return {'shape': 'bc:darvas-box', 'len': ia - T, 'depth_pct': round(100 * (top - Bv) / top, 1),
                'breakout': c > top, 'dets': [det]}
    return _say(why, 'dv_none')


CV_LOOK = 100

CV_MIN_SPAN = 15

CV_TOL_ATR = 0.3

CV_MIN_TOUCH = 5

CV_MOVE_ATR = 1.0

CV_CONV = 0.65

CV_SEP = 4

def _converging(tk, b, why, kind):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 200:
        return _say(why, 'no_atr')
    hi_p, lo_p = _pivots(b)
    j_hi = ia - 2
    lo_w = ia - CV_LOOK
    from_high = kind in ('symmetrical_triangle', 'falling_wedge')
    key = 'h' if from_high else 'l'
    vals = [(b[j][key], j) for j in range(lo_w, ia - 7)]
    if not vals:
        return _say(why, 'cv_none')
    A = (max(vals) if from_high else min(vals, key=lambda x: (x[0], -x[1])))[1]
    if from_high and any(b[j]['h'] > b[A]['h'] for j in range(A + 1, ia + 1)):
        return _say(why, 'cv_exceeded')
    if not from_high and any(b[j]['l'] < b[A]['l'] for j in range(A + 1, ia + 1)):
        return _say(why, 'cv_exceeded')
    if ia - A < CV_MIN_SPAN:
        return _say(why, 'cv_short')
    if from_high:
        if A not in hi_p:
            return _say(why, 'cv_start_not_pivot')
        ru = _best_line(b, hi_p, A, j_hi, 'up', atr, CV_TOL_ATR, CV_SEP, must_first=A)
        rl = _best_line(b, lo_p, A + 1, j_hi, 'lo', atr, CV_TOL_ATR, CV_SEP)
    else:
        if A not in lo_p:
            return _say(why, 'cv_start_not_pivot')
        rl = _best_line(b, lo_p, A, j_hi, 'lo', atr, CV_TOL_ATR, CV_SEP, must_first=A)
        ru = _best_line(b, hi_p, A + 1, j_hi, 'up', atr, CV_TOL_ATR, CV_SEP)
    if ru is None or rl is None:
        return _say(why, 'cv_no_lines')
    nu, _, U, u1, u2, tu = ru
    nl, _, Lw, l1, l2, tl = rl
    if nu < 2 or nl < 2 or nu + nl < CV_MIN_TOUCH:
        return _say(why, 'cv_touches')

    if _alternations(tu, tl) < 3:
        return _say(why, 'cv_no_alternation')

    if not (_interior(tu, A, ia) and _interior(tl, A, ia)):
        return _say(why, 'cv_no_interior_touch')

    for j in range(A, j_hi + 1):
        if math.log(b[j]['h']) > math.log(U.at(j)) + _tol(b, j, atr, CV_TOL_ATR):
            return _say(why, 'cv_high_outside')
        if math.log(b[j]['l']) < math.log(Lw.at(j)) - _tol(b, j, atr, CV_TOL_ATR):
            return _say(why, 'cv_low_outside')
    du = U.at(ia) - U.at(A)
    dl = Lw.at(ia) - Lw.at(A)
    mv = CV_MOVE_ATR * atr
    if kind == 'symmetrical_triangle' and not (du <= -mv and dl >= mv):
        return _say(why, 'cv_slopes')
    if kind == 'falling_wedge' and not (du <= -mv and dl <= -max(mv, 0.25 * abs(du)) and U.m < Lw.m):
        return _say(why, 'cv_slopes')
    if kind == 'rising_wedge' and not (dl >= mv and du >= max(mv, 0.25 * dl) and Lw.m > U.m):
        return _say(why, 'cv_slopes')
    w0 = U.at(A) - Lw.at(A)
    w1 = U.at(ia) - Lw.at(ia)
    if w0 <= 0 or w1 <= 0 or w1 > CV_CONV * w0:
        return _say(why, 'cv_not_converging')
    if U.at(ia + 3) <= Lw.at(ia + 3):
        return _say(why, 'cv_apex_passed')
    c = b[ia]['c']
    for j in range(A, ia - 1):
        if b[j]['c'] > U.at(j) + CV_TOL_ATR * atr or b[j]['c'] < Lw.at(j) - CV_TOL_ATR * atr:
            return _say(why, 'cv_close_outside')
    if c > U.at(ia):
        if kind == 'rising_wedge' or c > U.at(ia) + 1.5 * atr:
            return _say(why, 'cv_left_up')
    if c < Lw.at(ia):
        if kind == 'falling_wedge' or c < Lw.at(ia) - 1.5 * atr:
            return _say(why, 'cv_left_down')
    g = deal_gate(tk, b, ia)
    if g:
        return _say(why, g)
    s_u = A if from_high else u1
    s_l = l1 if from_high else A
    name = {'symmetrical_triangle': 'Symmetrical triangle', 'falling_wedge': 'Falling wedge',
            'rising_wedge': 'Rising wedge'}[kind]
    direc = {'symmetrical_triangle': 'neutral', 'falling_wedge': 'bullish', 'rising_wedge': 'bearish'}[kind]
    det = _line_rows_pair(kind, name, b, [(s_u, U.at(s_u)), (ia, U.at(ia))], [(s_l, Lw.at(s_l)), (ia, Lw.at(ia))],
                          direc)
    return {'shape': kind, 'span': ia - A, 'touches_upper': nu, 'touches_lower': nl,
            'conv': round(w1 / w0, 2), 'dets': [det]}


def falling_wedge(tk, b, why=None):
    return _converging(tk, b, why, 'falling_wedge')


MX_EQ = 0.03

MX_EQ_ATR = 0.6

MX_SWING_ATR = 2.0

MX_SEP = 10

MX_MIN_SPAN = 30

MX_NL_EQ = 0.3

MX_TREND_ATR = 3.0

MX_NL_ATR = 1.5

DTOP_MAX_SPAN = 120

MX_FRESH = 20

MX_PRE = 15

MX_SPAN = 150

DTOP_DECL = 0.10

def _multi(tk, b, why, n_ext, top):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 200:
        return _say(why, 'no_atr')
    hi_p, lo_p = _pivots(b)
    ext_p = hi_p if top else lo_p
    sgn = 1 if top else -1
    key, ck = ('h', 'l') if top else ('l', 'h')

    def e(j):
        return sgn * b[j][key]
    lasts = [p for p in ext_p if ia - MX_FRESH <= p <= ia - 3]
    for E3 in reversed(lasts):
        if any(e(j) > e(E3) for j in range(E3 + 1, ia + 1)):
            continue
        cands = [p for p in ext_p if E3 - MX_SPAN <= p <= E3 - MX_SEP]

        def chain(last, need):
            if need == 0:
                return [[]]
            res = []
            for p in reversed([q for q in cands if q <= last - MX_SEP]):
                for rest in chain(p, need - 1):
                    res.append(rest + [p])
                if len(res) > 40:
                    break
            return res
        for prev in chain(E3, n_ext - 1):
            E = prev + [E3]
            ps = [b[j][key] for j in E]
            if max(ps) / min(ps) - 1 > MX_EQ or max(ps) - min(ps) > MX_EQ_ATR * atr:
                continue
            if E[-1] - E[0] < MX_MIN_SPAN or (n_ext == 2 and E[-1] - E[0] > DTOP_MAX_SPAN):
                continue

            if n_ext == 3 and not (1 / 3 <= (E[1] - E[0]) / (E[2] - E[1]) <= 3):
                continue
            ext_most = max(e(j) for j in E)
            if any(e(j) > ext_most + 1e-12 for j in range(E[0], E[-1] + 1)):
                continue
            if any(e(j) > e(E[0]) for j in range(max(0, E[0] - MX_PRE), E[0])):
                continue
            N = []
            ok = True
            for a_, z_ in zip(E, E[1:]):
                cj = (min if top else max)(range(a_ + 1, z_), key=lambda j: b[j][ck])
                sw = sgn * (min(b[a_][key], b[z_][key]) - b[cj][ck]) if top else (b[cj][ck] - max(b[a_][key], b[z_][key]))
                if sw < MX_SWING_ATR * atr:
                    ok = False
                    break
                if n_ext == 2 and top and (b[a_][key] - b[cj][ck]) / b[a_][key] < DTOP_DECL:
                    ok = False
                    break
                N.append(cj)
            if not ok:
                continue
            ph = max(abs(b[n_][ck] - b[E[0]][key]) for n_ in N)
            if n_ext == 3 and abs(b[N[0]][ck] - b[N[1]][ck]) > min(MX_NL_EQ * ph, MX_NL_ATR * atr):
                continue
            pre = [b[j][ck] for j in range(max(0, E[0] - 40), E[0])]
            if not pre or (max(pre) - b[E[0]]['l'] if not top else b[E[0]]['h'] - min(pre)) < MX_TREND_ATR * atr:
                continue

            if n_ext == 3:
                def NL(x, N=N):
                    return b[N[0]][ck] + (b[N[1]][ck] - b[N[0]][ck]) * (x - N[0]) / (N[1] - N[0])
            else:
                def NL(x, N=N):
                    return b[N[0]][ck]
            c = b[ia]['c']
            thr = -sgn * (c - NL(ia))
            if thr > 0:
                first = next((j for j in range(E3 + 1, ia + 1) if -sgn * (b[j]['c'] - NL(j)) > 0), None)
                if first is None or first < ia - 2 or thr > 1.5 * atr:
                    continue
            g = deal_gate(tk, b, ia)
            if g:
                return _say(why, g)
            pid = {(3, False): 'triple_bottom', (3, True): 'triple_top', (2, True): 'double_top'}[(n_ext, top)]
            name = {'triple_bottom': 'Triple bottom', 'triple_top': 'Triple top', 'double_top': 'Double top'}[pid]
            anch = []
            for k_, j in enumerate(E):
                anch.append((j, b[j][key]))
                if k_ < len(N):
                    anch.append((N[k_], b[N[k_]][ck]))
            det = _row(pid, name, b, 'neckline', anch, 'bearish' if top else 'bullish')
            return {'shape': pid, 'span': E[-1] - E[0], 'last_age': ia - E3,
                    'spread_pct': round(100 * (max(ps) / min(ps) - 1), 2), 'broke': thr > 0, 'dets': [det]}
    return _say(why, 'mx_none')


def double_top(tk, b, why=None):
    return _multi(tk, b, why, 2, True)


GC_FRESH = 3

GC_SHOW = 120

GC_CLEAN = 60

def _cross(tk, b, why, golden):
    ia = len(b) - 1
    if ia < GC_SHOW + 200:
        return _say(why, 'short')
    s50 = {j: _sma(b, j, 50) for j in range(ia - GC_SHOW, ia + 1)}
    s200 = {j: _sma(b, j, 200) for j in range(ia - GC_SHOW, ia + 1)}
    k = None
    for j in range(ia, ia - GC_FRESH, -1):
        a, z = s50[j] - s200[j], s50[j - 1] - s200[j - 1]
        if (golden and a > 0 >= z) or (not golden and a < 0 <= z):
            k = j
            break
    if k is None:
        return _say(why, 'gc_no')
    if any((s50[j] - s200[j]) * (s50[j - 1] - s200[j - 1]) <= 0 for j in range(max(ia - GC_SHOW + 1, k - GC_CLEAN), k)):
        return _say(why, 'gc_whipsaw')
    if (golden and s50[ia] <= s50[ia - 10]) or (not golden and s50[ia] >= s50[ia - 10]):
        return _say(why, 'gc_s50_against')
    g = deal_gate(tk, b, ia)
    if g:
        return _say(why, g)
    pid = 'golden_cross' if golden else 'death_cross'
    dets = []
    for s in (s50, s200):
        pts = [{'t': _t(b, j), 'price': round(s[j], 4)} for j in range(ia - GC_SHOW, ia + 1)]
        dets.append(_row(pid, 'Golden cross' if golden else 'Death cross', b, 'horizontal_line',
                         [(ia - GC_SHOW, s[ia - GC_SHOW]), (ia, s[ia])], 'bullish' if golden else 'bearish',
                         {'draw_ema': {'points': pts}}))
    return {'shape': pid, 'cross_bars_ago': ia - k, 'dets': dets}


def golden_cross(tk, b, why=None):
    return _cross(tk, b, why, True)


def death_cross(tk, b, why=None):
    return _cross(tk, b, why, False)


# ================================================================== entry points
#: setup key -> detector. One authority; auto_structures reads SETUPS / DETECT / DRAW_ROUNDS.
DETECT = {
    "rsi_bullish_divergence": rsi_bullish_divergence,
    "wyckoff_upthrust": wyckoff_upthrust,
    "channel": channel,
    "pennant": pennant,
    "darvas_box": darvas_box,
    "falling_wedge": falling_wedge,
    "double_top": double_top,
    "golden_cross": golden_cross,
    "death_cross": death_cross,
}
SETUPS = tuple(DETECT)
DRAW_ROUNDS = {s: R2_DRAW_ROUND for s in SETUPS}
MIN_ASOF_INDEX = 220     # the as-of bar's index in the full series must be >= this (MIN_INDEX 260 - 40, as judged)


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


def _window(bars) -> list:
    """The ONLY way a detector sees bars: the WINDOW bars ending at the as-of bar (the last one), nothing after it."""
    return _to_dicts(list(bars)[-WINDOW:])


def detect(setup: str, bars, why=None):
    """One setup's drawing for `bars` (oldest first, the LAST one the as-of bar, a completed session), or None."""
    b = list(bars or [])
    if len(b) - 1 < MIN_ASOF_INDEX:
        return _say(why, "short_history")
    return DETECT[setup](None, _window(b), why)


def detect_all(bars) -> dict:
    b = list(bars or [])
    if len(b) - 1 < MIN_ASOF_INDEX:
        return {s: None for s in SETUPS}
    w = _window(b)
    return {s: DETECT[s](None, w, None) for s in SETUPS}


def facts(d: dict) -> dict:
    return {k: v for k, v in d.items() if k not in ("dets", "panel")}
