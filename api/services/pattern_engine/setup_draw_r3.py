"""Setup drawings, round 3 -- textbook fixes that passed two pre-registered blind packets each.

Pure geometry over daily bars [0..i] (bar i = the as-of bar, a COMPLETED session). Nothing here reads a store, a
clock or anything after bar i. Display only: it changes nothing any detector fires on, its confidence, HIST_SCORE or
`confirmed_only`.

Each setup below was rebuilt to its textbook definition and judged AS DRAWN by two fresh blind judges per packet on
two packets of 25 random liquid held-out charts each (bar: mean >= 2.3 AND >= 70% of charts scoring >= 2):
    outside_bar              A 2.72 / 96%   B 2.96 / 100%
    descending_triangle      A 2.60 / 100%  B 2.86 / 100%   (bearish)
    inverse_head_shoulders   A 2.34 / 84%   B 2.30 / 84%
    bear_flag                A 2.32 / 96%   B 2.34 / 88%    (bearish)
    bollinger_squeeze        A 2.42 / 84%   B 2.30 / 88%
    major_trendlines         A 2.48 / 92%   B 2.74 / 96%
Every constant and every line of detection code below is the judged code, frozen (comments removed). The parity
rail tests/test_setup_draw_r3_parity.py pins this module's output, as-of every bar of embedded synthetic series, to
the judged code's output: change a constant and it goes red. A new round is a new constant AND a new blind check,
never an edit here.

A member gets a drawing only while auto_structures.MEMBER_<SETUP>_ROUND equals R3_DRAW_ROUND AND the row's id is in
registry.DISPLAY_MEMBER_SET (auto_structures.member_rows). Fail closed.

Shared inputs (as judged): the repo's swing pivots (primitives.pivots.detect_pivots, window 3) on the last PIV_SPAN
bars of the WINDOW bars ending at the as-of bar, and deal_gate (ATR14 >= 0.8% of the close, and
deal_status.price_pinned on the last 300 bars is None). The pending-deal NAME lists are the patterns route's
deal_hold, asked once before any layer runs.

Each detector returns a dict d = {facts..., 'dets': [detection rows], 'panel': optional RSI panel} or None. 'dets'
carry the geometry in the shapes PatternOverlay draws: horizontal_line, trendline_pair (4 anchors, log-space lanes,
optional extras.draw_pole; semantic_subtype single_trendline = ONE line), rectangle (2 corners) and neckline (5
anchors: shoulder, counter-swing, head, counter-swing, shoulder).
"""
from __future__ import annotations

import math

#: The judged drawing round of every setup here (the textbook fix, round 3), frozen.
R3_DRAW_ROUND = 3

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


def _line_rows_pair(pid, name, b, up, lo, direction, pole=None, space='log'):
    """trendline_pair with 4 anchors: upper (u0 -> u1), lower (l0 -> l1), each a log-space line (r3: or 'lin')."""
    ex = {'line_spaces': [space, space]}
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


class PLine:
    """r3: a straight line in PRICE space through (x1, p1), (x2, p2) -- drawn straight on the member's chart (round-1
    judges read log-space lines as curves: sym triangle, rising wedge, major trendline)."""

    def __init__(self, x1, p1, x2, p2):
        self.x1, self.p1 = x1, p1
        self.m = (p2 - p1) / (x2 - x1)

    def at(self, x):
        return self.p1 + self.m * (x - self.x1)


def _tol(b, j, atr, k):
    """k x ATR expressed as a log-space tolerance at bar j."""
    return k * atr / b[j]['c']


def _best_line(b, idxs, j_lo, j_hi, side, atr, tol_k, min_sep, must_first=None, space='log'):
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
    if space == 'lin':
        ys = np.array([b[j][key] for j in range(x0, j_hi + 1)], dtype=float)
        tl = np.full(len(ys), tol_k * atr)
    else:
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
    Line = PLine if space == 'lin' else LLine
    return nt, span, Line(p1, b[p1][key], p2, b[p2][key]), p1, p2, dist


def _interior(ts_, a, z, lo=0.15, hi=0.75):
    """A touch strictly inside the pattern (15% .. 75% of its span), not only at its ends."""
    return any(a + lo * (z - a) < p < a + hi * (z - a) for p in ts_)


def _alternations(ta, tb_):
    """How many times the touch sequence switches line (U L U L = 3)."""
    seq = sorted([(p, 0) for p in ta] + [(p, 1) for p in tb_])
    return sum(1 for x, y in zip(seq, seq[1:]) if x[1] != y[1])


BS_N, BS_K_BB, BS_K_KC = 20, 2.0, 1.5

BS_MIN_RUN = 6

BS_MAX_RUN = 30

BS_WIDE_ATR = 1.3

BS_MAX_H_ATR = 2.75

BS_BW_LOOK, BS_BW_TOL = 125, 1.10

BS_QUIET_MAX = 1.0

BS_QUIET_MEAN = 0.6

BS_H_NORMAL = 2.0

BS_DRIFT = 0.5

def _squeeze_series(b):
    """on[j] for every j (None before the warm-up): BB(20, 2 sd) inside KC(20 EMA +- 1.5 x ATR20)."""
    c = [x['c'] for x in b]
    ema = _ema_series(c, BS_N)
    on = [None] * len(b)
    bw = [None] * len(b)
    for j in range(max(BS_N + 1, 60), len(b)):
        w = c[j - BS_N + 1:j + 1]
        m = sum(w) / BS_N
        sd = (sum((v - m) ** 2 for v in w) / BS_N) ** 0.5
        atr = _atr(b, j, BS_N)
        if atr is None:
            continue
        bw[j] = 4 * sd / m if m > 0 else None
        on[j] = (m + BS_K_BB * sd < ema[j] + BS_K_KC * atr) and (m - BS_K_BB * sd > ema[j] - BS_K_KC * atr)
    return on, bw


def bollinger_squeeze(tk, b, why=None):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 200:
        return _say(why, 'no_atr')
    on, bw = _squeeze_series(b)
    e = ia
    fired = False
    if not on[ia]:
        return _say(why, 'bs_off')
    s = e
    while s - 1 > ia - 120 and on[s - 1]:
        s -= 1
    run = e - s + 1
    if run < BS_MIN_RUN:
        return _say(why, 'bs_short_run')
    s = max(s, e - BS_MAX_RUN + 1)
    hist = [x for x in bw[max(0, e - BS_BW_LOOK):e + 1] if x is not None]
    if not hist or min(bw[j] for j in range(s, e + 1) if bw[j] is not None) > BS_BW_TOL * min(hist):
        return _say(why, 'bs_bw_not_6m_low')
    a0 = _atr(b, s)
    if any(b[j]['h'] - b[j]['l'] > BS_WIDE_ATR * a0 for j in range(s, e + 1)):
        return _say(why, 'bs_wide_bar_inside')
    top = max(b[j]['h'] for j in range(s, e + 1))
    flo = min(b[j]['l'] for j in range(s, e + 1))
    if top - flo > BS_MAX_H_ATR * a0:
        return _say(why, 'bs_tall_box')
    norm = _atr(b, s - 1, 50)
    rg = [b[j]['h'] - b[j]['l'] for j in range(s, e + 1)]
    if norm is None or max(rg) > BS_QUIET_MAX * norm or sum(rg) / len(rg) > BS_QUIET_MEAN * norm:
        return _say(why, 'bs_not_quiet')
    if top - flo > BS_H_NORMAL * norm:
        return _say(why, 'bs_tall_vs_normal')
    if _drift([b[j]['c'] for j in range(s, e + 1)]) > BS_DRIFT * (top - flo):
        return _say(why, 'bs_drifting')
    g = deal_gate(tk, b, ia)
    if g:
        return _say(why, g)
    det = _row('bollinger_squeeze', 'Bollinger squeeze', b, 'rectangle', [(s, top), (e, flo)], 'neutral')
    return {'shape': 'bollinger_squeeze', 'run': run, 'boxed_bars': e - s + 1, 'fired_today': fired,
            'box_h_atr': round((top - flo) / a0, 2), 'dets': [det]}


def _drift(cl):
    n = len(cl)
    mx = (n - 1) / 2
    my = sum(cl) / n
    num = sum((k - mx) * (y - my) for k, y in enumerate(cl))
    den = sum((k - mx) ** 2 for k in range(n))
    return abs(num / den) * (n - 1) if den else 0.0


CV_TOL_ATR = 0.3

DT_LOOK = 80

DT_FLAT = 0.02

DT_MIN_TOUCH = 3

DT_TOUCH_ATR = 0.35

DT_SPIKE_ATR = 0.3

DT_RES_TOUCH = 3

def descending_triangle(tk, b, why=None):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 200:
        return _say(why, 'no_atr')
    hi_p, lo_p = _pivots(b)
    lo_w = ia - DT_LOOK
    j_hi = ia - 3
    vals = [(b[j]['h'], j) for j in range(lo_w, ia - 10)]
    A = max(vals)[1]
    if A not in hi_p or any(b[j]['h'] > b[A]['h'] for j in range(A + 1, ia + 1)):
        return _say(why, 'dt_start')
    S = min(b[j]['l'] for j in range(A, j_hi + 1))
    tS = []
    for p in lo_p:
        if A < p <= j_hi and b[p]['l'] <= S * (1 + DT_FLAT):
            if not tS or p - tS[-1] >= 5:
                tS.append(p)
    if len(tS) < DT_MIN_TOUCH:
        return _say(why, 'dt_support_touches')
    jS = min(j for j in range(A, j_hi + 1) if b[j]['l'] == S)
    if not any(abs(p - jS) <= 1 for p in tS):
        return _say(why, 'dt_low_not_touch')

    tc = sorted(b[p]['l'] for p in tS)
    med = tc[len(tc) // 2]
    tS = [p for p in tS if abs(b[p]['l'] - med) <= DT_TOUCH_ATR * atr]
    if len(tS) < DT_MIN_TOUCH or med - S > DT_SPIKE_ATR * atr:
        return _say(why, 'dt_floor_not_cluster')
    S = med
    ru = _best_line(b, hi_p, A, j_hi, 'up', atr, CV_TOL_ATR, 5, must_first=A)
    if ru is None or ru[0] < DT_RES_TOUCH:
        return _say(why, 'dt_no_resistance')
    _, _, U, u1, u2, tu = ru
    if _alternations(tu, tS) < 3:
        return _say(why, 'dt_no_alternation')
    if not (_interior(tu, A, ia) and _interior(tS, A, ia)):
        return _say(why, 'dt_no_interior_touch')
    if U.at(ia) - U.at(A) > -1.0 * atr:
        return _say(why, 'dt_resistance_flat')
    w0, w1 = U.at(A) - S, U.at(ia) - S
    if w1 <= 0 or w1 > 0.65 * w0:
        return _say(why, 'dt_not_converging')
    for j in range(A, ia - 2):
        if b[j]['c'] < S - 0.5 * atr or b[j]['c'] > U.at(j) + 0.5 * atr:
            return _say(why, 'dt_close_outside')
    c = b[ia]['c']
    if c > U.at(ia):
        return _say(why, 'dt_broke_up')
    if c > S + 0.5 * (U.at(ia) - S):
        return _say(why, 'dt_not_at_floor')
    if c < S and c < S * 0.95:
        return _say(why, 'dt_extended_down')
    g = deal_gate(tk, b, ia)
    if g:
        return _say(why, g)
    det = _line_rows_pair('descending_triangle', 'Descending triangle', b, [(A, U.at(A)), (ia, U.at(ia))],
                          [(tS[0], S), (ia, S)], 'bearish')
    return {'shape': 'descending_triangle', 'span': ia - A, 'support_touches': len(tS), 'res_touches': len(tu),
            'dets': [det]}


HS_HEAD_ATR = 1.0

HS_PRE = 15

HS_LEG = 5

HS_SHOULDER = 0.5

HS_FRESH = 20

HS_SPAN = 120

HS_SH_DEPTH = 0.4

HS_SH_EQ = 0.3

HS_NL_SLOPE = 0.5

HS_FRESH_R3 = 12

HS_NL_SLOPE_R3 = 0.25

HS_SH_EQ_R3 = 0.2

HS_TIME_R3 = (0.6, 1.67)

HS_HEAD_R3 = 1.5

def _hs(tk, b, why, inverse):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 200:
        return _say(why, 'no_atr')
    hi_p, lo_p = _pivots(b)
    ext_p, cnt_p = (lo_p, hi_p) if inverse else (hi_p, lo_p)
    sgn = -1 if inverse else 1
    key, ck = ('l', 'h') if inverse else ('h', 'l')

    def e(j):
        return sgn * b[j][key]

    def ce(j):
        return -sgn * b[j][ck]
    rs_c = [p for p in ext_p if ia - HS_FRESH_R3 <= p <= ia - 3]
    for RS in reversed(rs_c):
        if any(e(j) > e(RS) for j in range(RS + 1, ia + 1)):
            continue
        for H in reversed([p for p in ext_p if RS - HS_SPAN < p <= RS - HS_LEG]):
            if e(H) < e(RS) + HS_HEAD_R3 * atr:
                continue
            N2 = max(range(H + 1, RS), key=lambda j: (ce(j), j))
            if any(e(j) > e(RS) for j in range(N2, RS)):
                continue
            for LS in reversed([p for p in ext_p if RS - HS_SPAN <= p <= H - HS_LEG]):
                if e(H) < e(LS) + HS_HEAD_R3 * atr:
                    continue

                if any(e(p) > e(LS) for p in ext_p if LS < p < H) or any(e(p) > e(RS) for p in ext_p if H < p < RS):
                    continue
                if max(e(j) for j in range(LS, RS + 1)) > e(H) + 1e-12:
                    continue
                N1 = max(range(LS + 1, H), key=lambda j: (ce(j), -j))
                if any(e(j) > e(LS) for j in range(LS + 1, N1 + 1)):
                    continue
                if any(e(j) > e(LS) for j in range(max(0, LS - HS_PRE), LS)):
                    continue
                l1, l2 = H - LS, RS - H
                if not (HS_TIME_R3[0] <= l1 / l2 <= HS_TIME_R3[1]):
                    continue
                depth = sgn * (b[H][key] - (b[LS][key] + b[RS][key]) / 2)
                if abs(b[LS][key] - b[RS][key]) > HS_SHOULDER * depth:
                    continue

                n1p, n2p = b[N1][ck], b[N2][ck]

                def NL(x, n1p=n1p, n2p=n2p, N1=N1, N2=N2):
                    return n1p + (n2p - n1p) * (x - N1) / (N2 - N1)
                if -sgn * (NL(LS) - b[LS][key]) < 1.0 * atr or -sgn * (NL(RS) - b[RS][key]) < 1.0 * atr:
                    continue

                hd = -sgn * (NL(H) - b[H][key])
                sd_l, sd_r = -sgn * (NL(LS) - b[LS][key]), -sgn * (NL(RS) - b[RS][key])
                if min(sd_l, sd_r) < HS_SH_DEPTH * hd or abs(sd_l - sd_r) > HS_SH_EQ_R3 * hd:
                    continue
                if abs(n1p - n2p) > HS_NL_SLOPE_R3 * hd:
                    continue
                pre = [b[j][ck] for j in range(max(0, LS - 40), LS)]
                if not pre:
                    continue
                trend_ok = (max(pre) - b[LS]['l'] >= 3 * atr) if inverse else (b[LS]['h'] - min(pre) >= 3 * atr)
                if not trend_ok:
                    continue
                c = b[ia]['c']
                thr = -sgn * (c - NL(ia))

                if thr <= 0 and any(-sgn * (b[j]['c'] - NL(j)) > 0 for j in range(RS + 1, ia)):
                    continue
                if thr > 0:
                    first = None
                    for j in range(RS + 1, ia + 1):
                        if -sgn * (b[j]['c'] - NL(j)) > 0:
                            first = j
                            break
                    if first is None or first < ia - 2 or thr > 1.5 * atr:
                        continue
                g = deal_gate(tk, b, ia)
                if g:
                    return _say(why, g)
                pid = 'inverse_head_shoulders' if inverse else 'head_shoulders'
                det = _row(pid, 'Inverse head and shoulders' if inverse else 'Head and shoulders', b, 'neckline',
                           [(LS, b[LS][key]), (N1, n1p), (H, b[H][key]), (N2, n2p), (RS, b[RS][key])],
                           'bullish' if inverse else 'bearish')
                return {'shape': pid, 'span': RS - LS, 'rs_age': ia - RS, 'head_depth_atr': round(depth / atr, 2),
                        'time_ratio': round(l1 / l2, 2), 'broke_neckline': thr > 0, 'dets': [det]}
    return _say(why, 'hs_none')


def inverse_head_shoulders(tk, b, why=None):
    return _hs(tk, b, why, True)


BF_POLE_MAX = 12

BF_POLE_PCT = 0.12

BF_POLE_ATR = 4.0

BF_MIN, BF_MAX = 5, 20

BF_RETR = 0.5

BF_WIDTH = 0.5

BF_SLOPE = 0.5

BF_MAX_R3 = 12

BF_POLE_BARS = 8

BF_POLE_BOUNCE = 0.25

BF_RETR_R3 = 0.38

BF_WIDTH_R3 = 0.35

BF_LANE_TOUCH = 2

def bear_flag(tk, b, why=None):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 200:
        return _say(why, 'no_atr')
    lo = ia - 25
    Lv = min(b[j]['l'] for j in range(lo, ia + 1))
    P = max(j for j in range(lo, ia + 1) if b[j]['l'] == Lv)
    if not (BF_MIN <= ia - P <= BF_MAX_R3):
        return _say(why, 'bf_length')
    s_lo = P - BF_POLE_BARS
    Hv = max(b[j]['h'] for j in range(s_lo, P + 1))
    S = max(j for j in range(s_lo, P + 1) if b[j]['h'] == Hv)
    if P - S < 3:
        return _say(why, 'bf_pole_short')
    pole = Hv - Lv
    if pole / Hv < BF_POLE_PCT or pole < BF_POLE_ATR * atr:
        return _say(why, 'bf_no_pole')

    run_lo = b[S]['l']
    for j in range(S + 1, P + 1):
        if b[j]['h'] - run_lo > BF_POLE_BOUNCE * pole:
            return _say(why, 'bf_staircase')
        run_lo = min(run_lo, b[j]['l'])
    fl = list(range(P, ia + 1))
    lc = [math.log(b[j]['c']) for j in fl]
    n = len(fl)
    mx = (n - 1) / 2
    my = sum(lc) / n
    m = sum((k - mx) * (y - my) for k, y in enumerate(lc)) / sum((k - mx) ** 2 for k in range(n))
    if m < 0:
        return _say(why, 'bf_falling')
    if m > BF_SLOPE * (math.log(Hv) - math.log(Lv)) / (P - S):
        return _say(why, 'bf_steep')
    if max(b[j]['h'] for j in fl) > Lv + BF_RETR_R3 * pole:
        return _say(why, 'bf_retrace')
    j_hi = ia - 2
    cu = max(math.log(b[j]['h']) - m * j for j in range(P, j_hi + 1))
    cl = min(math.log(b[j]['l']) - m * j for j in range(P, j_hi + 1))

    def up(x):
        return math.exp(cu + m * x)

    def dn(x):
        return math.exp(cl + m * x)
    if up(ia) - dn(ia) > BF_WIDTH_R3 * pole:
        return _say(why, 'bf_wide')
    tu_ = sum(1 for j in range(P, j_hi + 1) if up(j) - b[j]['h'] <= 0.25 * atr)
    tl_ = sum(1 for j in range(P, j_hi + 1) if b[j]['l'] - dn(j) <= 0.25 * atr)
    if tu_ < BF_LANE_TOUCH or tl_ < BF_LANE_TOUCH:
        return _say(why, 'bf_lane_floats')
    c = b[ia]['c']
    if c > up(ia) + 0.5 * atr:
        return _say(why, 'bf_broke_up')
    if c < dn(ia):
        if c < dn(ia) - 1.5 * atr or b[ia - 2]['c'] < dn(ia - 2):
            return _say(why, 'bf_left')
    g = deal_gate(tk, b, ia)
    if g:
        return _say(why, g)
    det = _line_rows_pair('bear_flag', 'Bear flag', b, [(P, up(P)), (ia, up(ia))], [(P, dn(P)), (ia, dn(ia))],
                          'bearish', pole=[(S, Hv), (P, Lv)])
    return {'shape': 'bear_flag', 'pole_pct': round(100 * pole / Hv, 1), 'pole_bars': P - S, 'len': ia - P,
            'slope_pct_per_bar': round(100 * (math.exp(m) - 1), 3), 'dets': [det]}


MT_LOOK = 200

MT_TOL_ATR = 0.3

MT_SEP = 10

MT_MIN_SPAN = 60

MT_NEAR_ATR = 2.0

MT_NEAR_R3 = 1.0

MT_MAX_GAP = 0.5

def major_trendlines(tk, b, why=None):
    ia = len(b) - 1
    atr = _atr(b, ia)
    if atr is None or ia < 220:
        return _say(why, 'no_atr')
    hi_p, lo_p = _pivots(b)
    best = None
    for side, idxs, key in (('lo', lo_p, 'l'), ('up', hi_p, 'h')):
        r = _best_line(b, idxs, ia - MT_LOOK, ia - 1, side, atr, MT_TOL_ATR, MT_SEP, space='lin')
        if r is None:
            continue
        nt, span, L, p1, p2, tl = r
        tt = []
        for p in tl:
            if not tt or p - tt[-1] >= MT_SEP:
                tt.append(p)
        if len(tt) < 3 or ia - tt[0] < MT_MIN_SPAN:
            continue
        if not _interior(tt, tt[0], ia, 0.25, 0.75):
            continue

        if max(y - x for x, y in zip(tt + [ia], (tt + [ia])[1:])) > MT_MAX_GAP * (ia - tt[0]):
            continue
        if side == 'lo' and any(b[j]['c'] < L.at(j) for j in range(tt[0], ia)):
            continue
        if side == 'up' and any(b[j]['c'] > L.at(j) for j in range(tt[0], ia)):
            continue
        d_ = (b[ia]['l'] - L.at(ia)) if side == 'lo' else (L.at(ia) - b[ia]['h'])
        if d_ > MT_NEAR_R3 * atr:
            continue
        thr = (L.at(ia) - b[ia]['c']) if side == 'lo' else (b[ia]['c'] - L.at(ia))
        if thr > 0.5 * atr:
            continue
        sc = (len(tt), ia - tt[0])
        if best is None or sc > best[0]:
            best = (sc, side, L, tt)
    if best is None:
        return _say(why, 'mt_none')
    sc, side, L, tt = best
    g = deal_gate(tk, b, ia)
    if g:
        return _say(why, g)
    det = _row('major_trendlines', 'Major trendline', b, 'trendline_pair', [(tt[0], L.at(tt[0])), (ia, L.at(ia))],
               'bullish' if side == 'lo' else 'bearish', {'line_spaces': ['lin']}, sub='single_trendline')
    return {'shape': 'major_trendlines', 'side': 'support' if side == 'lo' else 'resistance', 'touches': len(tt),
            'span': ia - tt[0], 'dets': [det]}


OB_POKE_ATR, OB_RANGE_ATR = 0.2, 1.0

def outside_bar(tk, b, why=None):
    ia = len(b) - 1
    if ia < 30:
        return _say(why, 'short')
    if not (b[ia]['h'] > b[ia - 1]['h'] and b[ia]['l'] < b[ia - 1]['l']):
        return _say(why, 'ob_no')
    atr = _atr(b, ia)
    if not atr or atr <= 0:
        return _say(why, 'no_atr')
    if min(b[ia]['h'] - b[ia - 1]['h'], b[ia - 1]['l'] - b[ia]['l']) < OB_POKE_ATR * atr:
        return _say(why, 'ob_poke_small')
    if b[ia]['h'] - b[ia]['l'] < OB_RANGE_ATR * atr:
        return _say(why, 'ob_range_small')
    g = deal_gate(tk, b, ia)
    if g:
        return _say(why, g)
    det = _row('outside_bar', 'Outside bar', b, 'rectangle', [(ia - 3, b[ia - 1]['h']), (ia - 1, b[ia - 1]['l'])],
               'neutral')
    return {'shape': 'outside_bar', 'up_close': b[ia]['c'] > b[ia]['o'],
            'poke_up_atr': round((b[ia]['h'] - b[ia - 1]['h']) / atr, 3),
            'poke_dn_atr': round((b[ia - 1]['l'] - b[ia]['l']) / atr, 3), 'dets': [det]}


# ================================================================== entry points
#: setup key -> detector. One authority; auto_structures reads SETUPS / DETECT / DRAW_ROUNDS.
DETECT = {
    "outside_bar": outside_bar,
    "descending_triangle": descending_triangle,
    "inverse_head_shoulders": inverse_head_shoulders,
    "bear_flag": bear_flag,
    "bollinger_squeeze": bollinger_squeeze,
    "major_trendlines": major_trendlines,
}
SETUPS = tuple(DETECT)
DRAW_ROUNDS = {s: R3_DRAW_ROUND for s in SETUPS}
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
