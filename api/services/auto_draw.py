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
#: Round 3 (REPORT_TEAM_SET_R2.md): the prior-day high / low is DELIBERATE, not silently dropped.
#: The chart's last bar IS the prior day as of the next session (the session the chart is read
#: for), so its high / low are that candle's own range and are not drawn -- they are listed in
#: `omitted` with this reason. When the last bar is a session still FORMING (drawn_set's
#: `last_bar_forming`, decided by the caller from the clock), the prior day is the bar before it
#: and its high / low are drawn like any other level.
PRIOR_DAY_IS_LAST_BAR = 'prior_day_is_last_bar'
#: Round 3: older swing-high RESISTANCE -- a confirmed pivot high (at least this many lower highs
#: on EACH side) inside the lookback, above the last close, that no later close has broken.
SWING_HIGH_STRENGTH = 3
#: ... searched over this many bars (the learned drawer's own lookback).
SWING_HIGH_LOOKBACK = 120
#: Two horizontals within this many ATR of each other are one level (the first kept wins).
#: Round 5 (REPORT_TEAM_SET_R4.md + _R4_CONFIRM.md: near-identical lines bunched together): 0.6,
#: was 0.5 (calibrated on the judged sets).
H_DUP_ATR = 0.6
#: How many ranked trendline candidates the drawn-set filter walks to find DRAWN_TRENDLINES keepers
#: (round 4: 20, was 12 -- the round-4 filters reject more of the ranking).
DRAWN_TL_POOL = 20
#: Two same-side trendlines are near-duplicates when their slopes differ by at most this many
#: ATR per bar AND their values at the last bar by at most TL_DUP_OFFSET_ATR ATR.
TL_DUP_SLOPE_ATR = 0.05
TL_DUP_OFFSET_ATR = 1.0
#: A trendline that has this many closes on its wrong side (beyond 0.1 ATR) strictly inside its
#: anchor span cuts through price and is not drawn.
TL_MAX_CUT_CLOSES = 2
#: Round 3: a close beyond a line by more than this many ATR AFTER its last anchor breaks it; a
#: line broken before the last bar is stale and not drawn (a break ON the last bar is news, kept).
TL_BREAK_ATR = 0.1
#: Round 4 (REPORT_TEAM_SET_R3.md): a line more than this many ATR from the last close is not
#: drawn -- price gapped away from it, it is not a line a trader reads now (on the round-3 judged
#: sets every line judged stale for this sat >= 2.9 ATR away, every line in a set judged 3 <= 1.3).
TL_MAX_DIST_ATR = 2.5
#: Round 4: a SUPPORT line (through lows) whose span (first anchor to the last bar) crosses a
#: CRASH -- closes falling more than TL_CRASH_ATR ATR (the ATR before the fall) within
#: TL_CRASH_BARS bars -- is not drawn. A resistance line falling from a peak over the decline is
#: the line a trader draws there, so it is not tested.
TL_CRASH_ATR = 5.0
TL_CRASH_BARS = 5
#: Round 4: a drawn line has at least this many separate TOUCHES (bars whose high / low is within
#: TOUCH_ATR of it, from the first anchor to the last bar, a run of adjacent touching bars counting
#: once, the anchors included) -- no two-point line through a far anchor and the current bar.
TL_MIN_TOUCHES = 3
#: Round 5 (REPORT_TEAM_SET_R4.md + _R4_CONFIRM.md: long lines through two far-apart anchors, the
#: current bar supplying the third touch): a line whose span (first anchor to the last bar) is at
#: least TL_LONG_SPAN bars needs TL_LONG_MIN_TOUCHES touches (calibrated).
TL_LONG_SPAN = 90
TL_LONG_MIN_TOUCHES = 4
#: Round 5 (the same reports: a redundant second support / resistance line): at most this many
#: drawn lines on each side (support through lows, resistance through highs), the best-ranked kept.
TL_PER_SIDE = 1
#: Round 4 (REPORT_TEAM_SET_R3.md: the major swing levels and the peak high were often missing,
#: micro levels from the last bars crowded them out): a MAJOR swing is a pivot with at least this
#: many lower highs (higher lows) on EACH side ...
MAJOR_SWING_STRENGTH = 5
#: ... within this many bars, unbroken by any close since. The nearest major swing high above the
#: close is ALWAYS drawn when one exists, then the nearest major swing low, then the window's peak.
MAJOR_SWING_LOOKBACK = 250
#: The major swing low and the peak high rank ahead only within this many ATR of the close (the
#: nearest major swing high above the close is drawn at any distance).
MAJOR_MAX_DIST_ATR = 8.0
#: A level anchored on one of the last MICRO_BARS bars (a fresh 10-day high / low, the learned
#: drawer's last-bar levels) is a MICRO level: drawn only after every structural level.
MICRO_BARS = 3


def swing_high_resistance(a, i, lookback=None, strength=None):
    """Round 3 (REPORT_TEAM_SET_R2.md: "older swing-high resistance is missing"): confirmed pivot
    highs in the last `lookback` bars (min(left, right) strength >= `strength`, counting only bars
    up to i) priced ABOVE the last close and not broken since by any close. Oldest first, as
    {price, j}."""
    lookback = SWING_HIGH_LOOKBACK if lookback is None else lookback
    strength = SWING_HIGH_STRENGTH if strength is None else strength
    lo = max(1, i - lookback + 1)
    S = strengths(a, i, lo)
    close = float(a[i, 4])
    out = []
    for q, j in enumerate(range(lo, i + 1)):
        hl, hr = int(S[q][0]), int(S[q][1])
        if min(hl, hr) < strength:
            continue
        p = float(a[j, 2])
        if p <= close:
            continue
        if j < i and float(np.max(a[j + 1:i + 1, 4])) > p:
            continue                       # a later close already broke it
        out.append({'price': p, 'j': j})
    return out


def major_swings(a, i, is_high, lookback=None, strength=None):
    """Round 4: MAJOR swing pivots in the last `lookback` bars (min(left, right) strength >=
    `strength`, counting only bars up to i) beyond the last close -- highs above it, lows below it --
    and unbroken since by any close (the window's peak high, when it is a pivot, is among them).
    Nearest the close first, as {price, j}."""
    lookback = MAJOR_SWING_LOOKBACK if lookback is None else lookback
    strength = MAJOR_SWING_STRENGTH if strength is None else strength
    lo = max(1, i - lookback + 1)
    S = strengths(a, i, lo)
    close = float(a[i, 4])
    col, side = (2, 0) if is_high else (3, 2)
    out = {}
    for q, j in enumerate(range(lo, i + 1)):
        if min(int(S[q][side]), int(S[q][side + 1])) < strength:
            continue
        p = float(a[j, col])
        if (p <= close) if is_high else (p >= close):
            continue
        later = a[j + 1:i + 1, 4]
        if len(later) and ((float(np.max(later)) > p) if is_high else (float(np.min(later)) < p)):
            continue
        out[j] = p
    return sorted(({'price': p, 'j': j} for j, p in out.items()), key=lambda r: abs(r['price'] - close))


def _horizontals(a, i, at, bars, last_bar_forming=False):
    """(drawn horizontals, omitted) -- see drawn_set. Round 4: candidates are drawn in RANK order,
    not nearest first: (0) the nearest major swing high above the close, (1) the nearest major
    swing low below it and (2) the major window peak high, each within MAJOR_MAX_DIST_ATR, (3) the
    structural levels -- the learned
    fill, the 10-day high / low, unbroken swing-high resistance, a forming session's prior day --
    nearest first, (4) MICRO levels (anchored on the last MICRO_BARS bars) last. A level within
    H_DUP_ATR of a better-ranked one is the same level. At most DRAWN_HORIZONTALS, at least one
    above the close whenever any candidate is; returned nearest the close first."""
    close = float(a[i, 4])
    micro_from = i - MICRO_BARS + 1
    cands = []
    highs = major_swings(a, i, True)
    lows = major_swings(a, i, False)
    if highs:
        h = highs[0]
        cands.append((0, {'source': 'major_swing_high', 'label': 'swing H', 'price': h['price'],
                          't_from': int(a[h['j'], 0]), 'score': None, '_j': h['j']}))
        peak = max(highs, key=lambda r: r['price'])
        if peak is not h and peak['price'] - close <= MAJOR_MAX_DIST_ATR * at:
            cands.append((2, {'source': 'major_peak_high', 'label': 'peak H', 'price': peak['price'],
                              't_from': int(a[peak['j'], 0]), 'score': None, '_j': peak['j']}))
    if lows and close - lows[0]['price'] <= MAJOR_MAX_DIST_ATR * at:
        h = lows[0]
        cands.append((1, {'source': 'major_swing_low', 'label': 'swing L', 'price': h['price'],
                          't_from': int(a[h['j'], 0]), 'score': None, '_j': h['j']}))
    w10 = a[max(0, i - 9):i + 1]
    j_hi10 = max(0, i - 9) + int(np.argmax(w10[:, 2]))
    j_lo10 = max(0, i - 9) + int(np.argmin(w10[:, 3]))
    structural = [
        {'source': 'ten_day_high', 'label': '10D H', 'price': float(a[j_hi10, 2]), 't_from': int(a[j_hi10, 0]),
         'score': None, '_j': j_hi10},
        {'source': 'ten_day_low', 'label': '10D L', 'price': float(a[j_lo10, 3]), 't_from': int(a[j_lo10, 0]),
         'score': None, '_j': j_lo10},
    ]
    idx = {int(a[j, 0]): j for j in range(i + 1)}
    for r in propose(bars, k=DRAWN_LEARNED_FILL, kinds=('horizontal',)):
        t = int(r['coords']['t_from'])
        structural.append({'source': 'learned', 'label': 'learned', 'price': float(r['coords']['price']),
                           't_from': t, 'score': r['score'], 'why': r['why'], '_j': idx.get(t, i)})
    for sh in swing_high_resistance(a, i):     # round 3: older swing-high resistance
        structural.append({'source': 'swing_high', 'label': 'swing H', 'price': sh['price'],
                           't_from': int(a[sh['j'], 0]), 'score': None, '_j': sh['j']})
    omitted = []
    pd = i - 1 if last_bar_forming else i
    for src, label, col in (('prior_day_high', 'PDH', 2), ('prior_day_low', 'PDL', 3)):
        if not last_bar_forming:
            # the last bar IS the prior day: its own candle already shows this level
            omitted.append({'source': src, 'reason': PRIOR_DAY_IS_LAST_BAR})
        elif pd >= 0:
            # deliberate: a forming session's prior day is structural, never demoted as micro
            structural.append({'source': src, 'label': label, 'price': float(a[pd, col]),
                               't_from': int(a[pd, 0]), 'score': None, '_j': -1})
    for h in structural:
        cands.append((3, h))
    out = _rank_levels(cands, close, at, micro_from, DRAWN_HORIZONTALS)
    for h in out:
        h.pop('_j', None)
        h['price'] = round(h['price'], 4)
    return out, omitted


def _rank_levels(cands, close, at, micro_from, k):
    """Round 4: the drawn levels from (tier, level) candidates -- a structural level (tier 3)
    anchored on a bar at or after `micro_from` is MICRO (tier 4); ranked by tier, then nearest the
    close; a level within H_DUP_ATR of a better-ranked one is the same level; the first `k`, with
    one above the close whenever any candidate is; returned nearest the close first."""
    tiered = [(4 if t == 3 and h.get('_j', -1) >= micro_from else t, h) for t, h in cands]
    ranked = [h for _, h in sorted(tiered, key=lambda th: (th[0], abs(th[1]['price'] - close)))]
    chosen = []
    for h in ranked:
        if all(abs(h['price'] - g['price']) > H_DUP_ATR * at for g in chosen):
            chosen.append(h)
    out = chosen[:k]
    if out and not any(h['price'] > close for h in out):
        above = [h for h in chosen[k:] if h['price'] > close]
        if above:
            out = out[:k - 1] + [above[0]]
    out.sort(key=lambda h: abs(h['price'] - close))
    return out


def _broken_before_last(a, i, at, ja, jb, p1, slope, is_high):
    """True when a close AFTER the line's last anchor `jb` and BEFORE the last bar `i` sits beyond
    the line by more than TL_BREAK_ATR ATR (above a resistance line through highs, below a support
    line through lows). The last bar itself never counts: a break on it is the news, not stale."""
    for j in range(jb + 1, i):
        line = p1 + slope * (j - ja)
        cl = float(a[j, 4])
        if (cl > line + TL_BREAK_ATR * at) if is_high else (cl < line - TL_BREAK_ATR * at):
            return True
    return False


def _crosses_crash(a, i, ja):
    """Round 4: True when, between bar `ja` and the last bar `i`, closes fall more than TL_CRASH_ATR
    ATR -- the ATR at the start of the fall -- within TL_CRASH_BARS bars."""
    for j in range(max(ja, 1), i):
        aj = atr(a, j)
        if not aj or aj <= 0:
            continue
        lowest = float(np.min(a[j + 1:min(i, j + TL_CRASH_BARS) + 1, 4]))
        if float(a[j, 4]) - lowest > TL_CRASH_ATR * aj:
            return True
    return False


def _touches(a, i, at, ja, p1, slope, is_high):
    """Round 4: the separate touches of a line from its first anchor `ja` to the last bar `i`: bars
    whose high (resistance) / low (support) sits within TOUCH_ATR ATR of the line, a run of
    adjacent touching bars counting once. The anchors are touches."""
    col = 2 if is_high else 3
    n, prev = 0, False
    for j in range(ja, i + 1):
        hit = abs(float(a[j, col]) - (p1 + slope * (j - ja))) <= TOUCH_ATR * at
        if hit and not prev:
            n += 1
        prev = hit
    return n


def _trendlines(a, i, at, bars):
    """The drawn trendlines: the learned ranking, walked best-first, keeping a line only when it
    (round 2, REPORT_TEAM_SET.md) does not cut through TL_MAX_CUT_CLOSES+ closes inside its span,
    (round 3) has not been broken by a close after its last anchor before the last bar (stale),
    (round 4, REPORT_TEAM_SET_R3.md) sits within TL_MAX_DIST_ATR of the last close, as a support
    line crosses no crash (`_crosses_crash`), and has at least TL_MIN_TOUCHES separate touches
    (`_touches`),
    shares no anchor with a kept line (no fan from one pivot), and is not a near-duplicate
    (slope and last-bar value within TL_DUP_*_ATR) of a kept same-side line. Round 5
    (REPORT_TEAM_SET_R4.md + _R4_CONFIRM.md): at most TL_PER_SIDE lines per side, and a line
    spanning TL_LONG_SPAN+ bars needs TL_LONG_MIN_TOUCHES touches."""
    idx = {int(a[j, 0]): j for j in range(i + 1)}
    close = float(a[i, 4])
    kept, anchors, sides = [], set(), set()
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
        if _broken_before_last(a, i, at, ja, jb, float(c['p1']), slope, is_high):
            continue                       # round 3: stale -- price already closed through it
        if abs(float(c['p_now']) - close) > TL_MAX_DIST_ATR * at:
            continue                       # round 4: price gapped away from it
        if not is_high and _crosses_crash(a, i, ja):
            continue                       # round 4: a long support line across a crash
        if is_high in sides:
            continue                       # round 5: one line per side, the best-ranked
        need = TL_LONG_MIN_TOUCHES if i - ja >= TL_LONG_SPAN else TL_MIN_TOUCHES
        if _touches(a, i, at, ja, float(c['p1']), slope, is_high) < need:
            continue                       # round 4: a two-point line; round 5: a long one needs 4
        keys = {(is_high, int(c['t1'])), (is_high, int(c['t2']))}
        if keys & anchors:
            continue
        if any(k['is_high'] == is_high and abs(k['slope'] - slope) <= TL_DUP_SLOPE_ATR * at
               and abs(k['p_now'] - float(c['p_now'])) <= TL_DUP_OFFSET_ATR * at for k in kept):
            continue
        kept.append({'is_high': is_high, 'slope': slope, 'p_now': float(c['p_now']), 'r': r})
        anchors |= keys
        if sum(1 for k in kept if k['is_high'] == is_high) >= TL_PER_SIDE:
            sides.add(is_high)
        if len(kept) >= DRAWN_TRENDLINES:
            break
    return [k['r'] for k in kept]


def drawn_set(bars, last_bar_forming=False):
    """The chart's default learned drawing for `bars` (oldest first, as of the last bar):

      trendlines   the learned ranking filtered by `_trendlines` (no line cutting through closes,
                   none already broken before the last bar, none gapped away from price, no
                   support line across a crash, at least TL_MIN_TOUCHES touches, one line per
                   anchor, no
                   near-duplicates), at most DRAWN_TRENDLINES
      horizontals  ranked by `_horizontals` (round 4): the nearest MAJOR swing high above the
                   close (always, when one exists within MAJOR_SWING_LOOKBACK bars), the nearest
                   major swing low, the window's peak high, then the structural levels (learned
                   fill, 10-day high/low, unbroken swing-high resistance, a forming session's prior
                   day), MICRO levels from the last MICRO_BARS bars last; near-duplicates within
                   H_DUP_ATR dropped, at most DRAWN_HORIZONTALS (at least one above the close when
                   any candidate is), nearest first. The prior day's high/low only when
                   `last_bar_forming` (then the prior day is the bar before the last).
      omitted      level types deliberately not drawn, each with its reason -- the prior-day
                   pair is listed here (PRIOR_DAY_IS_LAST_BAR) when the last bar IS the prior day,
                   so the drop is stated, never silent.

    Rounds 2-4 of the team-set blind check (REPORT_TEAM_SET.md / _R2.md / _R3.md, 2026-10-17),
    display-only.
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
    horizontals, omitted = _horizontals(a, i, at, bars, last_bar_forming=bool(last_bar_forming))
    return {
        'model': 'auto_draw logistic ' + MODEL_DATE,
        'asof_t': t_last,
        'last_close': round(close, 4),
        'atr': round(at, 4),
        'last_bar_forming': bool(last_bar_forming),
        'horizontals': horizontals,
        'omitted': omitted,
        'trendlines': [{**r['coords'], 'score': r['score'], 'why': r['why'], 'is_high': r['is_high']}
                       for r in trend],
    }
