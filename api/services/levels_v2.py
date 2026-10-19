"""Member levels v2 (2026-10-18): support / resistance picked by READING the chart, not by nearness to price.

Port of the lab study lab/levels_v2 (pre-registered; PREREG.txt + PREREG.hashes frozen before the held-out half
was touched). Ground truth: the team's own pixel-calibrated drawn levels (lab/drawn_vs_team), split by posted
date at 2025-05-15; everything was chosen on the older half.

  * candidates: every pivot (strength >= 2, 500 bars), gap edge, the last bar's / the bar before's / 10-day /
    this week's / last week's high and low, 52-week and data high / low, volume-profile shelves and round
    numbers within 12 ATR of the close;
  * features at each candidate price (pivot strength, recency, broken or not, touch groups and their recency,
    crossings, how long the level has held, gap / named-level / volume-shelf / round-number confluence) and
    its distance from the close;
  * a logistic ranker fitted on the older half; the selection score down-weights the distance terms to
    ALPHA = 0.1 of their fitted weight, so a level is drawn for what the chart shows there;
  * greedy best-first, a level within 0.6 ATR of a chosen one is the same level, K = 3, at least one above
    the close whenever any candidate is (today's rules).

Held-out half (338 charts with team levels, 234 as-of dates), lab/benchmark/team_agreement.py unchanged:
F1 at 0.5 ATR 0.401 against the SAME drawer's random-chart base rate 0.327: LIFT +0.074 [+0.048, +0.099]
(paired bootstrap over dates). Today's drawer: +0.022 [-0.001, +0.045]; C2: F1 0.412, lift +0.028. Levels per
chart 3.0 (today 3.9). Blind AI-judge packet (20 random charts, 2 fresh judges, the team-set rubric):
placement mean 2.675 [2.45, 2.875], 95% >= 2.

Display only: nothing here touches what any detector fires on.
`drawn_levels(bars, last_bar_forming)` -> {'round': LEVELS_V2_ROUND, 'horizontals': [...]} or None. Only bars up
to the last COMPLETE bar are read (a forming last bar is dropped): no lookahead.
"""
from __future__ import annotations

import math
import types as _types

import numpy as np

#: The dated tier stamp of this drawing. Members are served levels v3 (api/services/levels_v3.py), which keeps
#: this module's three levels and frozen ranker and adds a guaranteed near support / resistance; auto_structures
#: no longer serves v2's drawn_levels directly.
LEVELS_V2_ROUND = "2026-10-18"

#: sha256 of the two verbatim blocks below as they stand in the lab (lab/levels_v2/lv2core.py after its imports;
#: drawer_v2.py from LABELS to the lab plug-in). tests/test_levels_v2_lab_parity.py re-checks them.
CORE_BLOCK_SHA256 = "eada71fcba52fbd7a9741871461fbbc16332cf1816d171a2ee52bbb173d7ab0c"
DRAWER_BLOCK_SHA256 = "52994fbcedb6fad4aad4f001130ef744003246cb1272bd9ad68d360fe0afc52d"

# ---- BEGIN VERBATIM lab/levels_v2/lv2core.py
MAX_STRENGTH = 60
PIVOT_LOOKBACK = 500
TOUCH_LOOKBACK = 250
TOUCH_ATR = 0.25
CONFLUENCE_ATR = 0.25
VOL_LOOKBACK = 120
MAX_CAND_ATR = 12.0
CAND_DEDUPE_ATR = 0.05


def atr(a, i, n=14):
    """the member drawer's ATR (auto_draw.atr), byte-for-byte in behaviour."""
    if i < n:
        return float(np.mean(a[:i + 1, 2] - a[:i + 1, 3])) if i >= 0 else None
    h, l, pc = a[i - n + 1:i + 1, 2], a[i - n + 1:i + 1, 3], a[i - n:i, 4]
    return float(np.mean(np.maximum(h, pc) - np.minimum(l, pc)))


def strengths(a, i, lo):
    """(n, 4) int: for bars j in [lo, i] the left/right strength of the high and of the low (bars <= i only)."""
    H, L = a[:, 2], a[:, 3]
    out = np.zeros((i - lo + 1, 4), dtype=int)
    for q, j in enumerate(range(lo, i + 1)):
        for side, arr, lower in ((0, H, True), (2, L, False)):
            left, k = 0, j - 1
            while k >= 0 and left < MAX_STRENGTH and ((arr[k] < arr[j]) if lower else (arr[k] > arr[j])):
                left += 1
                k -= 1
            right, k = 0, j + 1
            while k <= i and right < MAX_STRENGTH and ((arr[k] < arr[j]) if lower else (arr[k] > arr[j])):
                right += 1
                k += 1
            out[q, side] = left
            out[q, side + 1] = right
    return out


def _ema(x, n):
    k = 2.0 / (n + 1)
    e = float(x[0])
    for v in x[1:]:
        e = e + k * (float(v) - e)
    return e


def _week_key(ts):
    s = str(int(ts))
    import datetime
    d = datetime.date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    y, w, _ = d.isocalendar()
    return y * 100 + w


def context(a, i):
    """everything the features need, computed once per chart."""
    at = atr(a, i)
    close = float(a[i, 4])
    lo = max(1, i - PIVOT_LOOKBACK + 1)
    S = strengths(a, i, lo)
    H, L, C, V, O = a[:, 2], a[:, 3], a[:, 4], a[:, 5], a[:, 1]
    piv = []   # (price, j, strength, is_high, broken_by_close_since)
    for q, j in enumerate(range(lo, i + 1)):
        hs, ls = min(S[q, 0], S[q, 1]), min(S[q, 2], S[q, 3])
        if hs >= 2:
            p = float(H[j])
            br = bool(j < i and C[j + 1:i + 1].max() > p)
            piv.append((p, j, int(hs), 1, br))
        if ls >= 2:
            p = float(L[j])
            br = bool(j < i and C[j + 1:i + 1].min() < p)
            piv.append((p, j, int(ls), 0, br))
    gaps = []  # (price, j, unfilled)
    g0 = max(1, i - TOUCH_LOOKBACK + 1)
    for j in range(g0, i + 1):
        if L[j] > H[j - 1]:          # gap up: the zone (H[j-1], L[j])
            fill = bool(j < i and L[j + 1:i + 1].min() <= H[j - 1])
            gaps.append((float(H[j - 1]), j, not fill))
            gaps.append((float(L[j]), j, not fill))
        elif H[j] < L[j - 1]:        # gap down: the zone (H[j], L[j-1])
            fill = bool(j < i and H[j + 1:i + 1].max() >= L[j - 1])
            gaps.append((float(L[j - 1]), j, not fill))
            gaps.append((float(H[j]), j, not fill))
    w52 = max(0, i - 251)
    named = {
        'ath': float(H[:i + 1].max()),
        'hi52': float(H[w52:i + 1].max()), 'lo52': float(L[w52:i + 1].min()),
        'pdh': float(H[i]), 'pdl': float(L[i]),
        'pph': float(H[i - 1]) if i >= 1 else float(H[i]), 'ppl': float(L[i - 1]) if i >= 1 else float(L[i]),
        'd10h': float(H[max(0, i - 9):i + 1].max()), 'd10l': float(L[max(0, i - 9):i + 1].min()),
    }
    # weeks: the week holding bar i (this week) and the week before it
    wk = [_week_key(a[j, 0]) for j in range(max(0, i - 15), i + 1)]
    base = max(0, i - 15)
    cur = wk[-1]
    cw = [base + q for q, w in enumerate(wk) if w == cur]
    prev_w = max([w for w in wk if w < cur], default=None)
    pw = [base + q for q, w in enumerate(wk) if w == prev_w] if prev_w else []
    named['wkh'], named['wkl'] = float(H[cw].max()), float(L[cw].min())
    if pw:
        named['pwh'], named['pwl'] = float(H[pw].max()), float(L[pw].min())
    # moving averages at i
    mas = []
    for n in (10, 20, 50, 200):
        if i + 1 >= n:
            mas.append(float(C[i - n + 1:i + 1].mean()))
    if i + 1 >= 21:
        mas.append(_ema(C[max(0, i - 120):i + 1], 21))
    # volume-at-price over VOL_LOOKBACK bars, bins of 0.1 ATR
    v0 = max(0, i - VOL_LOOKBACK + 1)
    vlo, vhi = float(L[v0:i + 1].min()), float(H[v0:i + 1].max())
    bw = 0.1 * at
    nb = max(1, int(math.ceil((vhi - vlo) / bw)) + 1)
    vp = np.zeros(nb)
    for j in range(v0, i + 1):
        a0 = int((L[j] - vlo) / bw)
        a1 = int((H[j] - vlo) / bw)
        vp[a0:a1 + 1] += V[j] / (a1 - a0 + 1)
    return {'atr': at, 'close': close, 'i': i, 'piv': piv, 'gaps': gaps, 'named': named, 'mas': mas,
            'vp': vp, 'vlo': vlo, 'bw': bw, 'H': H[:i + 1], 'L': L[:i + 1], 'C': C[:i + 1]}


def candidates(cx):
    """candidate prices with their origin: every pivot, gap edge, named level and round number near price."""
    at, close = cx['atr'], cx['close']
    out = []
    for p, j, s, ih, br in cx['piv']:
        out.append((p, 'pivot'))
    for p, j, uf in cx['gaps']:
        out.append((p, 'gap'))
    for k, p in cx['named'].items():
        out.append((p, k))
    # volume shelves: local maxima of the profile
    vp = cx['vp']
    if len(vp) >= 5:
        sm = np.convolve(vp, np.ones(5) / 5, mode='same')
        for b in range(2, len(sm) - 2):
            if sm[b] == sm[b - 2:b + 3].max() and sm[b] > 1.2 * sm.mean():
                out.append((cx['vlo'] + (b + 0.5) * cx['bw'], 'vshelf'))
    st = round_step(close)
    k0 = math.floor((close - MAX_CAND_ATR * at) / st)
    k1 = math.ceil((close + MAX_CAND_ATR * at) / st)
    if k1 - k0 <= 60:
        for k in range(k0, k1 + 1):
            if k > 0:
                out.append((k * st, 'round'))
    out = [(p, s) for p, s in out if abs(p - close) <= MAX_CAND_ATR * at and p > 0]
    out.sort()
    ded = []
    for p, s in out:
        if ded and abs(p - ded[-1][0]) <= CAND_DEDUPE_ATR * at:
            ded[-1][1].add(s)
        else:
            ded.append((p, {s}))
    return ded


def round_step(price):
    """the chart's 'round number' grid: half the leading power of ten (45 -> 5, 150 -> 50, 8 -> 0.5)."""
    return 10 ** math.floor(math.log10(price)) / 2.0


FEATURES = ['d_signed', 'd_abs', 'd_abs_log', 'above',
            'piv_n', 'piv_n_log', 'piv_maxs_log', 'piv_major', 'piv_recent_log', 'piv_unbroken', 'piv_flip',
            'touch_groups_log', 'touch_pct_groups_log', 'touch_recent_log', 'cross_log', 'clean_bars_log',
            'gap_any', 'gap_unfilled', 'ath', 'hi52', 'lo52', 'pd', 'pp', 'd10', 'week', 'pweek',
            'vshelf', 'round1', 'round2', 'ma_n']


def features(cx, p):
    at, close, i = cx['atr'], cx['close'], cx['i']
    tol = CONFLUENCE_ATR * at
    d = (p - close) / at
    f = {'d_signed': d, 'd_abs': abs(d), 'd_abs_log': math.log1p(abs(d)), 'above': 1.0 if p > close else 0.0}
    near = [v for v in cx['piv'] if abs(v[0] - p) <= tol]
    f['piv_n'] = float(len(near))
    f['piv_n_log'] = math.log1p(len(near))
    f['piv_maxs_log'] = math.log1p(max([v[2] for v in near], default=0))
    f['piv_major'] = 1.0 if any(v[2] >= 5 for v in near) else 0.0
    f['piv_recent_log'] = math.log1p(min([i - v[1] for v in near], default=PIVOT_LOOKBACK))
    f['piv_unbroken'] = 1.0 if any(not v[4] for v in near) else 0.0
    # flip: a high now below the close (old resistance broken, support now) or a low now above it
    f['piv_flip'] = 1.0 if any((v[3] == 1 and p < close) or (v[3] == 0 and p > close) for v in near) else 0.0
    H, L, C = cx['H'], cx['L'], cx['C']
    t0 = max(0, i - TOUCH_LOOKBACK + 1)
    h, l, c = H[t0:], L[t0:], C[t0:]
    touch = (np.abs(h - p) <= TOUCH_ATR * at) | (np.abs(l - p) <= TOUCH_ATR * at)
    f['touch_groups_log'] = math.log1p(_groups(touch))
    tp = TOUCH_ATR * at / close * p           # the same tolerance in percent of price (log-scale reading)
    touchp = (np.abs(h - p) <= tp) | (np.abs(l - p) <= tp)
    f['touch_pct_groups_log'] = math.log1p(_groups(touchp))
    idx = np.nonzero(touch)[0]
    f['touch_recent_log'] = math.log1p((len(h) - 1 - idx[-1]) if len(idx) else TOUCH_LOOKBACK)
    side = np.sign(c - p)
    side = side[side != 0]
    ncross = int(np.sum(side[1:] != side[:-1])) if len(side) > 1 else 0
    f['cross_log'] = math.log1p(ncross)
    # bars since the last close on the other side of p (how long the level has held)
    other = (c < p) if close > p else (c > p)
    oi = np.nonzero(other)[0]
    f['clean_bars_log'] = math.log1p((len(c) - 1 - oi[-1]) if len(oi) else TOUCH_LOOKBACK)
    gn = [g for g in cx['gaps'] if abs(g[0] - p) <= tol]
    f['gap_any'] = 1.0 if gn else 0.0
    f['gap_unfilled'] = 1.0 if any(g[2] for g in gn) else 0.0
    nm = cx['named']

    def isn(*ks):
        return 1.0 if any(k in nm and abs(nm[k] - p) <= tol for k in ks) else 0.0
    f['ath'] = isn('ath')
    f['hi52'] = isn('hi52')
    f['lo52'] = isn('lo52')
    f['pd'] = isn('pdh', 'pdl')
    f['pp'] = isn('pph', 'ppl')
    f['d10'] = isn('d10h', 'd10l')
    f['week'] = isn('wkh', 'wkl')
    f['pweek'] = isn('pwh', 'pwl')
    vp = cx['vp']
    b = int((p - cx['vlo']) / cx['bw'])
    if 0 <= b < len(vp) and vp.mean() > 0:
        w = vp[max(0, b - 2):b + 3].mean()
        f['vshelf'] = math.log((w + 1e-9) / vp.mean() + 1e-3)
    else:
        f['vshelf'] = math.log(1e-3)
    st = round_step(close)
    f['round1'] = 1.0 if abs(p - round(p / st) * st) <= 0.1 * at else 0.0
    f['round2'] = 1.0 if abs(p - round(p / (2 * st)) * (2 * st)) <= 0.1 * at else 0.0
    f['ma_n'] = float(sum(1 for m in cx['mas'] if abs(m - p) <= tol))
    return f


def _groups(mask):
    if not mask.any():
        return 0
    m = mask.astype(np.int8)
    return int(m[0] + np.sum((m[1:] == 1) & (m[:-1] == 0)))


def feature_rows(a, i):
    cx = context(a, i)
    if not cx['atr'] or cx['atr'] <= 0:
        return cx, []
    rows = []
    for p, srcs in candidates(cx):
        rows.append({'price': float(p), 'srcs': sorted(srcs), 'f': features(cx, p)})
    return cx, rows
# ---- END VERBATIM lab/levels_v2/lv2core.py

# the lab drawer addresses the core module as `K.`
K = _types.SimpleNamespace(feature_rows=feature_rows, TOUCH_ATR=TOUCH_ATR, TOUCH_LOOKBACK=TOUCH_LOOKBACK,
                          CAND_DEDUPE_ATR=CAND_DEDUPE_ATR)

# frozen ranker constants (lab/levels_v2/model_v2.py, written by fit_final.py)
MODEL = {
 "fit_on": "drawn_vs_team charts posted < 2025-05-15 (DEV), 341 charts with team levels",
 "cols": [
  "piv_n_log",
  "piv_maxs_log",
  "piv_major",
  "piv_recent_log",
  "piv_unbroken",
  "piv_flip",
  "touch_groups_log",
  "touch_pct_groups_log",
  "touch_recent_log",
  "cross_log",
  "clean_bars_log",
  "gap_any",
  "gap_unfilled",
  "ath",
  "hi52",
  "lo52",
  "pd",
  "pp",
  "d10",
  "week",
  "pweek",
  "vshelf",
  "round1",
  "round2",
  "d_signed",
  "d_abs",
  "d_abs_log",
  "above"
 ],
 "mu": [
  1.4753788763,
  2.4361249547,
  0.7551432152,
  4.4270964502,
  0.3629138263,
  0.7077920093,
  1.8426548546,
  1.845729169,
  3.5224184175,
  1.7761783232,
  3.8743885169,
  0.5848745147,
  0.1761684957,
  0.0066945863,
  0.0136642925,
  0.0219790297,
  0.075474582,
  0.076544493,
  0.0698499068,
  0.0745269465,
  0.0718674533,
  -2.0086768352,
  0.1427261333,
  0.0707975423,
  -2.0016675573,
  4.9260035557,
  1.580181542,
  0.3459786629
 ],
 "sd": [
  0.7232291713,
  1.1447936045,
  0.4300022565,
  1.2624344198,
  0.4808402874,
  0.4547773981,
  0.8752677907,
  0.8887807018,
  1.6888540807,
  0.9543879754,
  1.4035828288,
  0.4927436633,
  0.3809634596,
  0.0815461153,
  0.1160929792,
  0.1466149798,
  0.2641555791,
  0.2658673243,
  0.2548938952,
  0.2626265052,
  0.2582683159,
  3.1315938588,
  0.349793346,
  0.2564863559,
  5.6164516276,
  3.3594182323,
  0.6777979635,
  0.4756862713
 ],
 "coef": [
  -0.1926646552,
  0.1361346813,
  0.0786481524,
  -0.0818611493,
  0.060405729,
  0.0634585883,
  0.1280562969,
  0.1253148934,
  -0.1928896347,
  -0.4379601271,
  -0.0529487701,
  0.0165209095,
  0.0309628898,
  0.0192537422,
  -0.0634449548,
  -0.0602590258,
  -0.0550580398,
  -0.028052709,
  0.0961437185,
  0.056084991,
  -0.0012215077,
  0.503251457,
  -0.0625969632,
  0.0558955182,
  -0.5484971672,
  -0.4376995671,
  -0.9212598667,
  0.1120155349
 ],
 "intercept": -2.9905310853,
 "dist_cols": [
  "d_signed",
  "d_abs",
  "d_abs_log",
  "above"
 ],
 "alpha": 0.1,
 "k": 3,
 "sep_atr": 0.6
}

# ---- BEGIN VERBATIM lab/levels_v2/drawer_v2.py
LABELS = [('pdh', 'PDH'), ('pdl', 'PDL'), ('d10h', '10D H'), ('d10l', '10D L'), ('wkh', 'wk H'), ('wkl', 'wk L'),
          ('pwh', 'prev wk H'), ('pwl', 'prev wk L'), ('ath', 'high'), ('hi52', '52w H'), ('lo52', '52w L'),
          ('pph', 'prior H'), ('ppl', 'prior L')]


def _score(rows):
    cols = MODEL['cols']
    X = np.array([[r['f'][c] for c in cols] for r in rows], float)
    Z = (X - np.array(MODEL['mu'])) / np.array(MODEL['sd'])
    w = np.array(MODEL['coef'], float)
    w = np.where([c in MODEL['dist_cols'] for c in cols], w * MODEL['alpha'], w)
    return Z @ w


def _anchor(cx, p):
    """the bar the level is drawn from: its earliest touch in the last 120 bars, else its latest touch, else i."""
    H, L, i, at = cx['H'], cx['L'], cx['i'], cx['atr']
    lo = max(0, i - 119)
    t = np.nonzero((np.abs(H[lo:] - p) <= K.TOUCH_ATR * at) | (np.abs(L[lo:] - p) <= K.TOUCH_ATR * at))[0]
    if len(t):
        return lo + int(t[0])
    lo2 = max(0, i - K.TOUCH_LOOKBACK + 1)
    t = np.nonzero((np.abs(H[lo2:] - p) <= K.TOUCH_ATR * at) | (np.abs(L[lo2:] - p) <= K.TOUCH_ATR * at))[0]
    return lo2 + int(t[-1]) if len(t) else i


def _label(cx, srcs, p):
    for k, lab in LABELS:
        if k in srcs:
            return lab
    if 'pivot' in srcs:
        near = [v for v in cx['piv'] if abs(v[0] - p) <= K.CAND_DEDUPE_ATR * cx['atr']]
        if near:
            return 'swing H' if max(near, key=lambda v: v[2])[3] == 1 else 'swing L'
    if 'gap' in srcs:
        return 'gap'
    if 'vshelf' in srcs:
        return 'vol shelf'
    if 'round' in srcs:
        return 'round'
    return 'level'


def draw_levels(a, i):
    cx, rows = K.feature_rows(a, i)
    if not rows:
        return []
    at, close = cx['atr'], cx['close']
    s = _score(rows)
    order = np.argsort(-s, kind='stable')
    chosen = []
    for q in order:
        p = rows[q]['price']
        if all(abs(p - rows[g]['price']) > MODEL['sep_atr'] * at for g in chosen):
            chosen.append(int(q))
    k = MODEL['k']
    out = chosen[:k]
    if out and not any(rows[q]['price'] > close for q in out):
        ab = [q for q in chosen[k:] if rows[q]['price'] > close]
        if ab:
            out = out[:k - 1] + [ab[0]]
    res = []
    for q in out:
        p = rows[q]['price']
        res.append({'price': float(p), 'j': _anchor(cx, p), 'label': _label(cx, rows[q]['srcs'], p),
                    'sources': rows[q]['srcs'], 'score': float(s[q])})
    res.sort(key=lambda h: abs(h['price'] - close))
    return res
# ---- END VERBATIM lab/levels_v2/drawer_v2.py


def drawn_levels(bars, last_bar_forming=False):
    """The v2 horizontals for daily `bars` ((ts, o, h, l, c, v) tuples, oldest first, already cleaned), in the
    auto_draw horizontal shape {source, label, price, t_from, score, why}. While the last bar is a session
    still forming it is dropped (the lab drew as of a complete bar). None when there are too few bars."""
    rows = [tuple(b[:6]) for b in bars or [] if None not in tuple(b[:5])]
    if last_bar_forming and rows:
        rows = rows[:-1]
    if len(rows) < 31:
        return None
    a = np.array([[float(x or 0) for x in r] for r in rows])
    i = len(a) - 1
    at = atr(a, i)
    if not at or at <= 0:
        return None
    out = []
    for h in draw_levels(a, i):
        out.append({'source': 'levels_v2', 'label': h['label'], 'price': round(h['price'], 4),
                    't_from': int(a[h['j'], 0]), 'score': round(h['score'], 4), 'why': ', '.join(h['sources'])})
    return {'round': LEVELS_V2_ROUND, 'asof_t': int(a[i, 0]), 'horizontals': out}
