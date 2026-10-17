"""Learned auto-drawer: the horizontal levels and trendlines a trader would draw on a daily chart.

    from api.services.auto_draw import propose
    propose(bars, k=5)  -> [{kind, coords, score, why}, ...]

Display-only, admin-only (rides the Auto Structures layer behind AUTO_STRUCTURES_ENABLED). The score is
"how much this looks like a line a trader draws", NOT a signal: nothing here touches what any detector fires
on, its confidence, HIST_SCORE or `confirmed_only`.

Port of the lab auto-draw study's learned drawer (lab model fitted 2026-10-16 on the OLDER half of a set
of trader-drawn lines, charts posted before 2025-05-15; held-out half: trendline p@3 13.6% vs 5.7% for
the app's engine lines, horizontals on par with nearest-first engine levels). Two logistic rankers
(horizontal, trendline) over hand-built, interpretable features of candidate pivots and pivot pairs.
The fitted standardisation and coefficients are embedded below as constants; the parity rail
(tests/test_auto_draw.py) proves this file reproduces the lab drawer exactly when the lab is present.

`bars`: daily bars oldest first, as (ts, o, h, l, c, v) tuples or {t,o,h,l,c,v} dicts, ts = YYYYMMDD int.
Only bars up to the last bar (or `asof`, when given) are read: no lookahead.
coords:
  horizontal  {price, t_from}                 t_from = the anchoring bar's date
  trendline   {t1, p1, t2, p2, p_now}         two anchor pivots (dates, prices) and the line at the last bar
"""
from __future__ import annotations

import math

import numpy as np

TOUCH_ATR = 0.25        # a bar "touches" a level/line when its high (or low) is within this many ATR
MAX_STRENGTH = 60
TL_MIN_SPAN = 3
TL_MAX_SPAN = 120

H_FEATURES = ['strength_log', 'right_log', 'is_high', 'age_log', 'abs_dist', 'dist_signed', 'touches_log',
              'crosses_log', 'vol_ratio_log', 'ext20', 'ext60', 'ext_all', 'bar_range', 'is_prev_day',
              'is_gap_edge', 'nearest_rank_log', 'held_since']
T_FEATURES = ['span_log', 'abs_slope', 'slope_with_side', 'touches_log', 'viol_inside_log', 'viol_after_log',
              'broken_now', 'abs_dist_now', 'age_b_log', 'str_a_log', 'str_b_log', 'is_high', 'ext_ratio',
              'a_is_ext']

#: The lab model of 2026-10-16 (logistic; features standardised by `mean`/`scale` before `coef`).
MODEL_DATE = '2026-10-16'
MODEL = {
    'horizontal': {
        'features': H_FEATURES,
        'mean': [1.6057207339143378, 2.1522475217849553, 0.4919201520912547, 3.2617900727655265,
                 2.998420036155292, -1.0667501020513714, 2.149753636117803, 0.7952025875030092,
                 0.029520324458977256, 0.3487642585551331, 0.13773764258555132, 0.07243346007604563,
                 1.066179956166122, 0.07756653992395438, 0.07604562737642585, 1.9883683184829586,
                 0.45019011406844106],
        'scale': [0.9371884718118034, 1.1462660364730344, 0.4999347117952635, 1.313540458442829,
                  2.4511272616044835, 3.722981572016107, 0.9236430672345192, 0.8435262285152314,
                  0.6075331029340592, 0.4765792174545393, 0.34462441062777427, 0.25920427067751944,
                  0.641392609493796, 0.2674882648046309, 0.26507110354272934, 0.9510976469614645,
                  0.49751278904513574],
        'coef': [0.287203402733194, -0.07767239010381294, 0.0738435253865659, 0.06289983024030185,
                 -1.139438922535686, -0.33244297183827504, -0.019948415714588615, -0.554030446411918,
                 0.0466795315396517, 0.01582461734968429, -0.14657264804919065, -0.11256424986563228,
                 0.04853151960712362, -0.0851534756448982, -0.007927601344814073, -0.20504225925512787,
                 -0.14620141002185869],
        'intercept': -2.3118347016973813,
    },
    'trendline': {
        'features': T_FEATURES,
        'mean': [3.3577004945823616, 0.11085147652663715, -0.0023352406691285405, 1.862640048089465,
                 1.4666831695214866, 1.5417179800550036, 0.3762193698949825, 4.304268689625828,
                 3.2154816854117487, 1.3702295338018353, 1.3200121162706935, 0.5063943990665111,
                 1.6507378411351876, 0.042979385453131076],
        'scale': [0.839764952109081, 0.12627981285399204, 0.1680154386763064, 0.7661034483173887,
                  1.3806212278120946, 1.5941492687580114, 0.48443612128991276, 3.4500849100342545,
                  1.120382372768788, 0.8426088492557242, 0.7782315530540463, 0.4999591099890402,
                  1.6929937793866914, 0.20281064537941887],
        'coef': [-0.06285590301834232, -1.2037868270992496, 0.9467498656797377, 0.15178898178035893,
                 -0.17422239184471003, -0.11024439384598166, 0.1025516061781535, -0.5267174497562425,
                 -0.26887569316928167, 0.017062445537740785, 0.16574110136464487, 0.10012242719693512,
                 -0.11075535787404063, 0.13165156563572347],
        'intercept': -4.378595894667559,
    },
}


# ------------------------------------------------------------------------------------------------ bars

def clean_bars(rows):
    """The bar cleaning the model was fitted on: drop rows with a missing price or a non-positive close,
    and clip a bad-print wick (high > 1.4x the body top -> body top; low < 0.6x the body bottom -> body
    bottom). `rows`: (ts, o, h, l, c, v) tuples oldest first."""
    out = []
    for r in rows or []:
        ts, o, h, l, c, v = tuple(r[:6])
        if None in (o, h, l, c) or c <= 0:
            continue
        top, bot = max(o, c), min(o, c)
        h = top if h > top * 1.4 else h
        l = bot if l < bot * 0.6 else l
        out.append((ts, o, h, l, c, v or 0))
    return out


def as_arrays(bars, asof=None):
    if asof is not None:
        asof = int(str(asof).replace('-', '')[:8])
    rows = []
    for b in bars:
        if isinstance(b, dict):
            r = (b['t'], b['o'], b['h'], b['l'], b['c'], b.get('v') or 0)
        else:
            r = tuple(b[:6])
        if asof is not None and int(r[0]) > asof:
            continue
        if None in r[:5]:
            continue
        rows.append(r)
    return np.array([[float(x) for x in r] for r in rows]) if rows else np.zeros((0, 6))


def atr(a, i, n=14):
    if i < n:
        return float(np.mean(a[:i + 1, 2] - a[:i + 1, 3])) if i >= 0 else None
    h, l, pc = a[i - n + 1:i + 1, 2], a[i - n + 1:i + 1, 3], a[i - n:i, 4]
    return float(np.mean(np.maximum(h, pc) - np.minimum(l, pc)))


def strengths(a, i, lo):
    """For bars j in [lo, i]: (left, right) strength of the high and of the low, counting only bars <= i.
    left = consecutive bars before j with a strictly lower high (higher low), capped; right likewise after j."""
    H, L = a[:, 2], a[:, 3]
    n = i - lo + 1
    out = np.zeros((n, 4), dtype=int)   # hl, hr, ll, lr
    for q, j in enumerate(range(lo, i + 1)):
        for side, arr, cmp in ((0, H, np.less), (2, L, np.greater)):
            left = 0
            k = j - 1
            while k >= 0 and left < MAX_STRENGTH and cmp(arr[k], arr[j]):
                left += 1
                k -= 1
            right = 0
            k = j + 1
            while k <= i and right < MAX_STRENGTH and cmp(arr[k], arr[j]):
                right += 1
                k += 1
            out[q, side] = left
            out[q, side + 1] = right
    return out


# ------------------------------------------------------------------------------------------------ horizontals

def h_candidates(a, i, lookback=120, min_strength=2):
    """Candidate horizontal levels visible after the close of bar i: swing pivots (min(left,right) >=
    min_strength, confirmed inside the window), the last bar's high/low, unfilled >=2% gap edges."""
    if i < 20:
        return []
    lo = max(1, i - lookback + 1)
    at = atr(a, i)
    if not at or at <= 0:
        return []
    S = strengths(a, i, lo)
    c = a[i, 4]
    cands = []
    for q, j in enumerate(range(lo, i + 1)):
        hl, hr, ll, lr = S[q]
        if min(hl, hr) >= min_strength:
            cands.append({'price': a[j, 2], 'j': j, 'is_high': 1, 'left': hl, 'right': hr, 'src': 'pivot'})
        if min(ll, lr) >= min_strength:
            cands.append({'price': a[j, 3], 'j': j, 'is_high': 0, 'left': ll, 'right': lr, 'src': 'pivot'})
    cands.append({'price': a[i, 2], 'j': i, 'is_high': 1, 'left': int(S[-1][0]), 'right': 0, 'src': 'prev_day'})
    cands.append({'price': a[i, 3], 'j': i, 'is_high': 0, 'left': int(S[-1][2]), 'right': 0, 'src': 'prev_day'})
    for j in range(max(1, i - 59), i + 1):
        pc, op = a[j - 1, 4], a[j, 1]
        if pc <= 0 or abs(op / pc - 1) < 0.02:
            continue
        after = a[j:i + 1]
        if op > pc and after[:, 3].min() <= pc:
            continue
        if op < pc and after[:, 2].max() >= pc:
            continue
        cands.append({'price': pc, 'j': j, 'is_high': int(op < pc), 'left': 0, 'right': i - j, 'src': 'gap_edge'})
    win = a[lo:i + 1]
    vol = a[:, 5]
    hi20, lo20 = a[max(0, i - 19):i + 1, 2].max(), a[max(0, i - 19):i + 1, 3].min()
    hi60, lo60 = a[max(0, i - 59):i + 1, 2].max(), a[max(0, i - 59):i + 1, 3].min()
    hiA, loA = win[:, 2].max(), win[:, 3].min()
    above = sorted([x['price'] for x in cands if x['price'] >= c])
    below = sorted([x['price'] for x in cands if x['price'] < c], reverse=True)
    for x in cands:
        p, j = x['price'], x['j']
        near = (np.abs(win[:, 2] - p) <= TOUCH_ATR * at) | (np.abs(win[:, 3] - p) <= TOUCH_ATR * at)
        jj = j - lo
        if 0 <= jj < len(near):
            near[max(0, jj - 1):jj + 2] = False
        after_c = a[j + 1:i + 1, 4]
        if len(after_c) > 1:
            sgn = np.sign(after_c - p)
            crosses = int(np.sum(sgn[1:] * sgn[:-1] < 0))
        else:
            crosses = 0
        pv = vol[max(0, j - 50):j]
        vr = (vol[j] / pv.mean()) if len(pv) and pv.mean() > 0 else 1.0
        if x['is_high']:
            held = float(np.all(a[j + 1:i + 1, 4] <= p)) if j < i else 1.0
        else:
            held = float(np.all(a[j + 1:i + 1, 4] >= p)) if j < i else 1.0
        rank = (above.index(p) if p >= c else below.index(p)) if (p in above or p in below) else 20
        d = (p - c) / at
        x['f'] = {
            'strength_log': math.log1p(min(x['left'], x['right'] if x['src'] == 'pivot' else x['left'])),
            'right_log': math.log1p(x['right']),
            'is_high': x['is_high'],
            'age_log': math.log1p(i - j),
            'abs_dist': min(abs(d), 10.0),
            'dist_signed': max(-10.0, min(10.0, d)),
            'touches_log': math.log1p(int(near.sum())),
            'crosses_log': math.log1p(crosses),
            'vol_ratio_log': math.log(max(vr, 0.05)),
            'ext20': float((x['is_high'] and p >= hi20) or (not x['is_high'] and p <= lo20)),
            'ext60': float((x['is_high'] and p >= hi60) or (not x['is_high'] and p <= lo60)),
            'ext_all': float((x['is_high'] and p >= hiA) or (not x['is_high'] and p <= loA)),
            'bar_range': min((a[j, 2] - a[j, 3]) / at, 5.0),
            'is_prev_day': float(x['src'] == 'prev_day'),
            'is_gap_edge': float(x['src'] == 'gap_edge'),
            'nearest_rank_log': math.log1p(rank),
            'held_since': held,
        }
        x['t'] = int(a[j, 0])
    return cands


# ------------------------------------------------------------------------------------------------ trendlines

def t_candidates(a, i, lookback=120, min_strength=1, max_pivots=40):
    """Candidate trendlines: pairs of same-side swing pivots (highs with highs, lows with lows) inside the
    window, span TL_MIN_SPAN..TL_MAX_SPAN bars, line through the two extremes, extended to bar i."""
    if i < 20:
        return []
    lo = max(1, i - lookback + 1)
    at = atr(a, i)
    if not at or at <= 0:
        return []
    S = strengths(a, i, lo)
    c = a[i, 4]
    out = []
    for is_high in (1, 0):
        col = 2 if is_high else 3
        piv = []
        for q, j in enumerate(range(lo, i + 1)):
            le, ri = (S[q][0], S[q][1]) if is_high else (S[q][2], S[q][3])
            if j == i:
                ri = 0
            if min(le, ri) >= min_strength or (j == i and le >= 3):
                piv.append((j, min(le, max(ri, 1) if j == i else ri), le, ri))
        if len(piv) > max_pivots:          # keep the strongest
            piv = sorted(piv, key=lambda z: -z[1])[:max_pivots]
            piv.sort()
        ext_j = lo + int(np.argmax(a[lo:i + 1, 2])) if is_high else lo + int(np.argmin(a[lo:i + 1, 3]))
        for u in range(len(piv)):
            for w in range(u + 1, len(piv)):
                ja, jb = piv[u][0], piv[w][0]
                span = jb - ja
                if span < TL_MIN_SPAN or span > TL_MAX_SPAN:
                    continue
                pa, pb = a[ja, col], a[jb, col]
                slope = (pb - pa) / span
                xs = np.arange(ja, i + 1)
                line = pa + slope * (xs - ja)
                seg = a[ja:i + 1]
                ext = seg[:, col]
                touch = np.abs(ext - line) <= TOUCH_ATR * at
                touch[0] = False
                touch[span] = False
                cl = seg[:, 4]
                if is_high:
                    viol = cl > line + 0.1 * at
                else:
                    viol = cl < line - 0.1 * at
                vin = int(viol[1:span].sum())
                vaft = int(viol[span + 1:].sum())
                lnow = line[-1]
                broken = float(viol[-1])
                out.append({'ja': ja, 'jb': jb, 'pa': pa, 'pb': pb, 'is_high': is_high, 'p_now': lnow, 'f': {
                    'span_log': math.log1p(span),
                    'abs_slope': min(abs(slope) / at, 2.0),
                    'slope_with_side': max(-2.0, min(2.0, (-slope if is_high else slope) / at)),
                    'touches_log': math.log1p(int(touch.sum())),
                    'viol_inside_log': math.log1p(vin),
                    'viol_after_log': math.log1p(vaft),
                    'broken_now': broken,
                    'abs_dist_now': min(abs(lnow - c) / at, 10.0),
                    'age_b_log': math.log1p(i - jb),
                    'str_a_log': math.log1p(piv[u][1]),
                    'str_b_log': math.log1p(piv[w][1]),
                    'is_high': is_high,
                    'ext_ratio': min((i - jb) / span, 5.0),
                    'a_is_ext': float(ja == ext_j),
                }})
    return out


# ------------------------------------------------------------------------------------------------ scoring

def score_rows(rows, m):
    """logistic score from a {features, mean, scale, coef, intercept} block."""
    if not rows:
        return np.zeros(0)
    X = np.array([[r['f'][k] for k in m['features']] for r in rows], dtype=float)
    Z = (X - np.array(m['mean'])) / np.array(m['scale'])
    z = Z @ np.array(m['coef']) + m['intercept']
    return 1.0 / (1.0 + np.exp(-z))


def nms_h(cands, scores, at, k, sep=0.5):
    order = np.argsort(-scores)
    kept = []
    for q in order:
        if all(abs(cands[q]['price'] - cands[r]['price']) > sep * at for r in kept):
            kept.append(q)
        if len(kept) >= k:
            break
    return kept


def nms_t(cands, scores, at, k, sep=0.5):
    order = np.argsort(-scores)
    kept = []
    for q in order:
        x = cands[q]
        dup = False
        for r in kept:
            y = cands[r]
            if x['is_high'] != y['is_high']:
                continue
            ya = y['pa'] + (y['pb'] - y['pa']) / (y['jb'] - y['ja']) * (x['ja'] - y['ja'])
            if abs(ya - x['pa']) <= sep * at and abs(y['p_now'] - x['p_now']) <= sep * at:
                dup = True
                break
        if not dup:
            kept.append(q)
        if len(kept) >= k:
            break
    return kept


def _why_h(x):
    f = x['f']
    parts = []
    if x['src'] == 'prev_day':
        parts.append("prior day's %s" % ('high' if x['is_high'] else 'low'))
    elif x['src'] == 'gap_edge':
        parts.append('unfilled gap edge')
    else:
        s = min(x['left'], x['right'])
        parts.append('swing %s (%d bars each side)' % ('high' if x['is_high'] else 'low', s))
    if f['ext60']:
        parts.append('60-day %s' % ('high' if x['is_high'] else 'low'))
    elif f['ext20']:
        parts.append('20-day %s' % ('high' if x['is_high'] else 'low'))
    t = int(round(math.expm1(f['touches_log'])))
    if t:
        parts.append('%d touches' % t)
    parts.append('%.1f ATR %s price' % (f['abs_dist'], 'above' if f['dist_signed'] >= 0 else 'below'))
    return ', '.join(parts)


def _why_t(x):
    f = x['f']
    span = int(round(math.expm1(f['span_log'])))
    t = int(round(math.expm1(f['touches_log'])))
    kind = ('falling' if x['pb'] < x['pa'] else 'rising') + (' resistance through highs' if x['is_high']
                                                            else ' support through lows')
    s = '%s, %d-bar span, %d extra touches' % (kind, span, t)
    if f['broken_now']:
        s += ', price now through it'
    else:
        s += ', %.1f ATR from price' % f['abs_dist_now']
    return s


def propose(bars, k=5, lookback=120, kinds=('horizontal', 'trendline'), asof=None, model=None):
    """Top-k horizontals and top-k trendlines (each ranked by the learned score, near-duplicates within
    0.5 ATR suppressed), merged and sorted by score. Each horizontal also carries `src`
    ('pivot' | 'prev_day' | 'gap_edge'). [] when fewer than 31 bars."""
    m = model or MODEL
    a = as_arrays(bars, asof)
    i = len(a) - 1
    if i < 30:
        return []
    at = atr(a, i)
    out = []
    if 'horizontal' in kinds:
        hc = h_candidates(a, i, lookback)
        if hc:
            s = score_rows(hc, m['horizontal'])
            for q in nms_h(hc, s, at, k):
                x = hc[q]
                out.append({'kind': 'horizontal', 'coords': {'price': round(float(x['price']), 4), 't_from': x['t']},
                            'score': round(float(s[q]), 4), 'why': _why_h(x), 'src': x['src'],
                            'is_high': int(x['is_high'])})
    if 'trendline' in kinds:
        tc = t_candidates(a, i, lookback)
        if tc:
            s = score_rows(tc, m['trendline'])
            for q in nms_t(tc, s, at, k):
                x = tc[q]
                out.append({'kind': 'trendline', 'coords': {
                    't1': int(a[x['ja'], 0]), 'p1': round(float(x['pa']), 4), 't2': int(a[x['jb'], 0]),
                    'p2': round(float(x['pb']), 4), 'p_now': round(float(x['p_now']), 4)},
                    'score': round(float(s[q]), 4), 'why': _why_t(x), 'is_high': int(x['is_high'])})
    out.sort(key=lambda r: -r['score'])
    return out


# ------------------------------------------------------------------------------------------------ chart set

#: How many learned trendlines the chart draws (lab recommendation: top 2-3).
DRAWN_TRENDLINES = 3
#: How many horizontals the chart draws, nearest price first (round 2 of the team-set blind check,
#: REPORT_TEAM_SET.md 2026-10-17: five read as clutter -- the four nearest).
DRAWN_HORIZONTALS = 4
#: The learned horizontals offered as fill (they replace the swing_pivots layer: its learned top 3).
DRAWN_LEARNED_FILL = 3
#: A prior-day high / low within this many ATR of the last bar's range edges is dropped: it IS
#: that bar's edge, drawn right at the last candle, and the judges read it as clutter.
PRIOR_DAY_EDGE_ATR = 0.3
#: Two horizontals within this many ATR of each other are one level (the first kept wins).
H_DUP_ATR = 0.5
#: How many ranked trendline candidates the drawn-set filter walks to find DRAWN_TRENDLINES keepers.
DRAWN_TL_POOL = 12
#: Two same-side trendlines are near-duplicates when their slopes differ by at most this many
#: ATR per bar AND their values at the last bar by at most TL_DUP_OFFSET_ATR ATR.
TL_DUP_SLOPE_ATR = 0.05
TL_DUP_OFFSET_ATR = 1.0
#: A trendline that has this many closes on its wrong side (beyond 0.1 ATR) strictly inside its
#: anchor span cuts through price and is not drawn.
TL_MAX_CUT_CLOSES = 2


def _horizontals(a, i, at, bars):
    """The drawn horizontals (see drawn_set), nearest the last close first, at most DRAWN_HORIZONTALS."""
    close = float(a[i, 4])
    t_last = int(a[i, 0])
    w10 = a[max(0, i - 9):i + 1]
    j_hi10 = max(0, i - 9) + int(np.argmax(w10[:, 2]))
    j_lo10 = max(0, i - 9) + int(np.argmin(w10[:, 3]))
    edges = (float(a[i, 2]), float(a[i, 3]))
    prior = [
        {'source': 'prior_day_high', 'label': 'PDH', 'price': float(a[i, 2]), 't_from': t_last, 'score': None},
        {'source': 'prior_day_low', 'label': 'PDL', 'price': float(a[i, 3]), 't_from': t_last, 'score': None},
    ]
    ten = [
        {'source': 'ten_day_high', 'label': '10D H', 'price': float(a[j_hi10, 2]), 't_from': int(a[j_hi10, 0]),
         'score': None},
        {'source': 'ten_day_low', 'label': '10D L', 'price': float(a[j_lo10, 3]), 't_from': int(a[j_lo10, 0]),
         'score': None},
    ]
    chosen = []

    def _add(h):
        if all(abs(h['price'] - g['price']) > H_DUP_ATR * at for g in chosen):
            chosen.append(h)

    for h in ten:
        _add(h)
    learned = propose(bars, k=DRAWN_LEARNED_FILL, kinds=('horizontal',))
    for r in learned:
        _add({'source': 'learned', 'label': 'learned', 'price': float(r['coords']['price']),
              't_from': int(r['coords']['t_from']), 'score': r['score'], 'why': r['why']})
    # round 2: a prior-day level only when it is NOT the last bar's own edge and not a duplicate
    for h in prior:
        if min(abs(h['price'] - e) for e in edges) > PRIOR_DAY_EDGE_ATR * at:
            _add(h)
    chosen.sort(key=lambda h: abs(h['price'] - close))
    chosen = chosen[:DRAWN_HORIZONTALS]
    for h in chosen:
        h['price'] = round(h['price'], 4)
    return chosen


def _trendlines(a, i, at, bars):
    """The drawn trendlines: the learned ranking, walked best-first, keeping a line only when it
    (round 2, REPORT_TEAM_SET.md) does not cut through TL_MAX_CUT_CLOSES+ closes inside its span,
    shares no anchor with a kept line (no fan from one pivot), and is not a near-duplicate
    (slope and last-bar value within TL_DUP_*_ATR) of a kept same-side line."""
    idx = {int(a[j, 0]): j for j in range(i + 1)}
    kept, anchors = [], set()
    for r in propose(bars, k=DRAWN_TL_POOL, kinds=('trendline',)):
        c = r['coords']
        ja, jb = idx.get(int(c['t1'])), idx.get(int(c['t2']))
        if ja is None or jb is None or jb <= ja:
            continue
        is_high = int(r['is_high'])
        slope = (float(c['p2']) - float(c['p1'])) / (jb - ja)
        cut = 0
        for j in range(ja + 1, jb):
            line = float(c['p1']) + slope * (j - ja)
            cl = float(a[j, 4])
            if (cl > line + 0.1 * at) if is_high else (cl < line - 0.1 * at):
                cut += 1
        if cut >= TL_MAX_CUT_CLOSES:
            continue
        keys = {(is_high, int(c['t1'])), (is_high, int(c['t2']))}
        if keys & anchors:
            continue
        if any(k['is_high'] == is_high and abs(k['slope'] - slope) <= TL_DUP_SLOPE_ATR * at
               and abs(k['p_now'] - float(c['p_now'])) <= TL_DUP_OFFSET_ATR * at for k in kept):
            continue
        kept.append({'is_high': is_high, 'slope': slope, 'p_now': float(c['p_now']), 'r': r})
        anchors |= keys
        if len(kept) >= DRAWN_TRENDLINES:
            break
    return [k['r'] for k in kept]


def drawn_set(bars):
    """The chart's default learned drawing for `bars` (oldest first, as of the last bar):

      trendlines   the learned ranking filtered by `_trendlines` (no line cutting through closes,
                   one line per anchor, no near-duplicates), at most DRAWN_TRENDLINES
      horizontals  10-day high/low, then the learned top DRAWN_LEARNED_FILL as fill, then the prior
                   day's high/low ONLY when not within PRIOR_DAY_EDGE_ATR of the last bar's range
                   edges; near-duplicates within H_DUP_ATR dropped, the DRAWN_HORIZONTALS nearest
                   the last close kept, nearest first.

    Round 2 of the team-set blind check (REPORT_TEAM_SET.md, 2026-10-17), display-only.
    None when there are too few bars. Never raises past bad input shapes it can reject."""
    a = as_arrays(bars)
    i = len(a) - 1
    if i < 30:
        return None
    at = atr(a, i)
    if not at or at <= 0:
        return None
    close = float(a[i, 4])
    t_last = int(a[i, 0])
    trend = _trendlines(a, i, at, bars)
    return {
        'model': 'auto_draw logistic ' + MODEL_DATE,
        'asof_t': t_last,
        'last_close': round(close, 4),
        'atr': round(at, 4),
        'horizontals': _horizontals(a, i, at, bars),
        'trendlines': [{**r['coords'], 'score': r['score'], 'why': r['why'], 'is_high': r['is_high']}
                       for r in trend],
    }
