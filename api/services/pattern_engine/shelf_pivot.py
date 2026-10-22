"""Shelf pivot -- ONE labelled horizontal level where price has stalled several times and is pressing now.

Pure geometry over daily bars [0..i] (bar i = the as-of bar, a COMPLETED session). Nothing here reads a store, a
clock or anything after bar i. Display only: it changes nothing any detector fires on.

Drawing round "r4" (SHELF_PIVOT_ROUND). Every constant below is that round's, frozen; a member gets the line only
while auto_structures.MEMBER_SHELF_PIVOT_ROUND equals this constant (fail closed).

The layer, end to end (`evaluate`):
  1. CONTEXT GATE (`context` / `context_gate`): no illiquid, pinned, collapsed or falling-knife chart, and a real
     move in the last 252 sessions.
  2. CANDIDATES (`chart_rows`): every level among the last 250 bars' highs / body tops / closes that is a CEILING
     (walking back from bar i-1, highs stay <= P + 0.75 ATR for >= 8 bars, and >= 2 three-session groups of highs
     come within 0.5 ATR of P), plus every line the chart's detectors produced (served or withheld). Each gets a
     geometry feature vector (`features`).
  3. RANKER (`ranker_scores`): a frozen gradient-boosted tree ensemble (api/data/shelf_pivot_ranker.json),
     evaluated here in pure Python; a candidate needs score >= THR.
  4. RULES (`eligible`): the shelf rules (ceiling source, touches, near price, recovered, not too deep, not
     falling, not a down-trend) and the level rules at the SNAPPED level L (the median of the test bars' nearest
     tops at the densest cluster of highs / body tops): touch groups separated by a real retreat, a middle test,
     a recent test, not falling away, not chop, a tight cluster, tight touch groups, something in the recent
     range reached the line, a gap-down level was retested, and never within / next to a served base.
  5. PICK (`pick`): the HIGHEST passing L (levels within 1 ATR are one shelf; the best ranker score among them).
     At most one line per chart, drawn from the first span bar that reaches it.
"""
from __future__ import annotations

import json
import math
import os

import numpy as np

#: The drawing round this code draws.
SHELF_PIVOT_ROUND = "r4"
#: The row id.
SHELF_PIVOT_ID = "draw:shelf-pivot"

# ---------------------------------------------------------------- candidate generator (ceilings)
CEIL_TOL = 0.75
TOUCH = 0.5
MIN_SPAN = 8
MAX_BACK = 250
DEDUP = 0.1
CMP_MIN = -8.0
#: The base drawing's candidate verdicts, in order (index = feature value).
BASE_GATES = ['no_lip', 'len', 'one_touch', 'shallow', 'too_deep', 'not_near', 'closed_above', 'no_advance',
              'peak_above', 'too_deep_atr', 'parabolic', 'right_side', 'short_history', 'below_200sma', 'PASS']
FAM = {
    'base': ('bc:base',),
    'flag': ('bull_flag', 'bc:high-tight-flag'),
    'flat': ('flat_base', 'bc:flat-base', 'uct_flat_top_breakout', 'bc:square-box', 'bc:darvas-box',
             'bc:three-weeks-tight'),
    'cup': ('bc:cup-with-handle', 'cup_handle', 'cup_handle_uct', 'bc:cup'),
    'db': ('draw:double-bottom', 'bc:double-bottom'),
    'pb': ('uct_pullback_ma_v5',),
    'other': (),
}
IGNORE = ('bc:range-10',)
#: Served rows that are a BASE (rule d): their region and pivot exclude the shelf line.
BASE_PIDS = ('bc:base', 'flat_base', 'bc:flat-base', 'uct_flat_top_breakout', 'bc:square-box', 'bc:darvas-box',
             'bc:three-weeks-tight', 'bc:cup-with-handle', 'cup_handle', 'cup_handle_uct', 'bc:cup',
             'draw:double-bottom', 'bc:double-bottom', 'bc:vcp', 'bc:base-on-base')

# ---------------------------------------------------------------- context gate
GATE = {
    'MIN_DV20': 5e6, 'MIN_CLOSE': 5.0,
    'PIN_ATR': 0.012, 'PIN_RANGE': 0.05,
    'COLLAPSE_DROP': 0.15, 'RECOVER': 0.95,
    'KNIFE_DD': 0.60,
    'MIN_ATRP': 0.0,
    'MIN_RUN': 1.0,
}
MIN_HISTORY_INDEX = 260

# ---------------------------------------------------------------- shelf rules (candidate level)
SHELF = {
    'DUP_ATR': 1.0,
    'MIN_TOUCH_G': 2,
    'NEAR_BELOW_ATR': 2.0, 'MAX_EXT_ATR': 1.0,
    'MAX_TOUCH_AGE': 999,
    'MIN_RECOVERY': 0.5, 'SHORT_N': 20, 'SHORT_TG': 3, 'MAX_DEPTH': 0.40, 'MIN_SLOPE20': -0.10,
    'DOWN50_SLOPE': -0.02, 'MIN_ADV120': -1.0,
}

# ---------------------------------------------------------------- level rules (snapped level)
PARAMS = {
    'TOUCH_ATR': 0.5, 'RETREAT_ATR': 1.0, 'SEP': 3, 'START_N': 8, 'MIN_TG': 3, 'MID_AGE': 10, 'PREV_AGE': 60,
    'NEAR_BELOW_ATR': 1.0, 'MAX_EXT_ATR': 0.75, 'NEAR_PCT': 0.03,
    'LAST_TEST_AGE': 15,
    'FALL_N': 5, 'FALL_ATR': 1.0,
    'CHOP_SHARE': 0.15, 'CHOP_X': 4, 'CHOP_NEAR': 0.25, 'CHOP_NEAR_X': 3,
    'MIN_SPAN': 15,
    'SAME_ATR': 1.0,
    'THR': 0.1,
    'SNAP_ATR': 0.25, 'MAX_SHIFT': 0.75, 'CLUSTER_ATR': 0.30, 'MIN_CLUSTER': 3,
    'MIN_TIGHT_TG': 3,
    'RECENT_N': 30, 'RECENT_EXCL': 2,
    'GAP_ATR': 1.0, 'GAP_LOOKBACK': 5, 'GAP_SKIP': 3, 'GAP_EXCL': 3,
    'BASE_SEP_ATR': 1.5,
}

_RANKER_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                            'data', 'shelf_pivot_ranker.json')
_RANKER = [None]


# ================================================================ bars
def arrays(rows):
    """rows [(t, o, h, l, c, v)] oldest first -> (T, O, H, L, C, V) numpy arrays."""
    a = np.asarray([[float(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5] or 0)]
                    for r in rows])
    return a[:, 0].astype(np.int64), a[:, 1], a[:, 2], a[:, 3], a[:, 4], a[:, 5]


def atr14(H, L, C, i, n=14):
    k = max(1, i - n + 1)
    tr = [max(H[j], C[j - 1]) - min(L[j], C[j - 1]) for j in range(k, i + 1)]
    return sum(tr) / len(tr) if tr else None


# ================================================================ context gate
def context(arr, i):
    T, O, H, L, C, V = arr
    a = atr14(H, L, C, i)
    dv20 = float(np.mean(C[max(0, i - 19):i + 1] * V[max(0, i - 19):i + 1]))
    hi252 = float(np.max(H[max(0, i - 251):i + 1]))
    lo252 = float(np.min(L[max(0, i - 251):i + 1]))
    worst, rec = 0.0, 1.0
    for k in range(max(1, i - 29), i + 1):
        d = min(C[k] / C[k - 1], O[k] / C[k - 1]) - 1
        if d < worst:
            worst, rec = d, C[i] / C[k - 1]
    s200 = float(np.mean(C[max(0, i - 199):i + 1]))
    s200p = float(np.mean(C[max(0, i - 219):max(1, i - 19)])) if i >= 220 else s200
    rng20 = (float(np.max(H[max(0, i - 19):i + 1])) - float(np.min(L[max(0, i - 19):i + 1]))) / C[i]
    return {'close': float(C[i]), 'dv20': dv20, 'atrp': a / C[i] if a else 0.0, 'rng20': rng20,
            'dd': C[i] / hi252, 's200sl': s200 / s200p - 1, 'run': hi252 / lo252 if lo252 > 0 else 1.0,
            'worst30': worst, 'rec30': rec}


def context_gate(c, p=GATE):
    """(ok, reason): the first failing rule names itself."""
    if c['close'] <= p['MIN_CLOSE'] or c['dv20'] < p['MIN_DV20']:
        return False, 'illiquid'
    if c['atrp'] < p['PIN_ATR'] and c['rng20'] < p['PIN_RANGE']:
        return False, 'pinned'
    if c['worst30'] <= -p['COLLAPSE_DROP'] and c['rec30'] < p['RECOVER']:
        return False, 'collapse'
    if c['dd'] < p['KNIFE_DD'] and c['s200sl'] < 0:
        return False, 'knife'
    if c['atrp'] < p['MIN_ATRP']:
        return False, 'quiet'
    if c['run'] < p['MIN_RUN']:
        return False, 'no_move'
    return True, 'PASS'


# ================================================================ base drawing candidate verdicts
def base_candidate_gates(arr, i, a):
    """[(verdict, pivot, lip)] for every candidate of the base drawing (round 2) at bar i: the first rule of
    base_draw._evaluate each candidate fails, or 'PASS'. A feature of the ranker only."""
    from api.services.pattern_engine import base_draw as m
    T, O, H, L, C, V = arr
    b = [{'t': int(T[k]), 'o': float(O[k]), 'h': float(H[k]), 'l': float(L[k]), 'c': float(C[k]),
          'v': float(V[k] or 0)} for k in range(i + 1)]
    out = []
    for k in m._candidates(b, i):
        out.append(_base_verdict(m, b, i, a, k))
    return out


def _base_verdict(m, b, i, a, k):
    piv = m._bt(b[k])
    j = i - 1
    stop = max(0, i - m.LOOK - 1)
    while j > stop and m._bt(b[j]) <= piv + m.BODY_TOL * a:
        j -= 1
    left = j + 1
    lip = next((x for x in range(left, i) if m._bt(b[x]) >= piv - m.TOUCH * a), None)
    if lip is None:
        return 'no_lip', piv, lip
    if lip - left < m.PRIOR_BARS:
        return 'no_lip', piv, lip
    n = i - lip
    if n < m.MIN_LEN or n > m.LOOK:
        return 'len', piv, lip
    piv = max(m._bt(b[x]) for x in range(lip, i))
    t = [x for x in range(lip, i) if m._bt(b[x]) >= piv - m.TOUCH * a]
    gs = m._groups(t, m.GAP)
    if len(gs) < 2 or gs[-1][0] - gs[0][0] < m.MIN_TOUCH_SEP:
        return 'one_touch', piv, lip
    mid = [m._f(b[x], 'l') for x in range(gs[0][-1], gs[-1][0] + 1)]
    if not mid or min(mid) > piv - m.MIN_DEPTH_ATR * a:
        return 'shallow', piv, lip
    low_i = min(range(lip, i), key=lambda x: (m._f(b[x], 'l'), x))
    low = m._f(b[low_i], 'l')
    depth = (piv - low) / piv
    if depth > m.MAX_DEPTH or depth <= 0:
        return 'too_deep', piv, lip
    c = m._f(b[i], 'c')
    if not (piv - m.NEAR_BELOW * a <= c <= piv + m.MAX_EXT * a):
        return 'not_near', piv, lip
    if any(m._f(b[x], 'c') > piv + m.BODY_TOL * a for x in range(lip, i)):
        return 'closed_above', piv, lip
    a0 = max(0, lip - m.ADV_BARS)
    if (m._f(b[lip], 'h') - m._f(b[a0], 'c')) / m._f(b[a0], 'c') < m.MIN_ADV:
        return 'no_advance', piv, lip
    pk0 = max(0, lip - m.PEAK_BARS)
    if lip > pk0 and max(m._f(b[x], 'h') for x in range(pk0, lip)) > piv + m.PEAK_ATR * a:
        return 'peak_above', piv, lip
    if (piv - low) / a > m.MAX_DEPTH_ATR:
        return 'too_deep_atr', piv, lip
    r0 = max(0, lip - m.RUN_BARS)
    floor = min(m._f(b[x], 'l') for x in range(r0, lip + 1))
    if floor > 0 and m._f(b[lip], 'h') / floor >= m.PARABOLIC_RUN and depth >= m.PARABOLIC_DEPTH \
            and n < m.PARABOLIC_MAX_LEN:
        return 'parabolic', piv, lip
    if i - 1 <= lip or max(m._bt(b[x]) for x in range(max(lip + 1, i - m.RIGHT_BARS), i)) < piv - m.RIGHT_ATR * a:
        return 'right_side', piv, lip
    if i + 1 < m.TREND_N:
        return 'short_history', piv, lip
    s200 = sum(m._f(x, 'c') for x in b[i - m.TREND_N + 1:i + 1]) / m.TREND_N
    if c <= s200 or piv <= s200:
        return 'below_200sma', piv, lip
    return 'PASS', piv, lip


# ================================================================ candidates + features
def fam_of(pid):
    for k, v in FAM.items():
        if pid in v:
            return k
    if 'cup' in pid:
        return 'cup'
    return 'other'


def groups(idx, gap=3):
    g, last = 0, -99
    for j in idx:
        if j - last >= gap:
            g += 1
        last = j
    return g


def _left(H, i, P, a):
    lo = max(1, i - MAX_BACK)
    seg = H[lo:i]
    over = np.nonzero(seg > P + CEIL_TOL * a)[0]
    return (lo + over[-1] + 1) if len(over) else lo


def generate(arr, det_lines, i):
    T, O, H, L, C, V = arr
    a = atr14(H, L, C, i)
    if not a or a <= 0 or i < 30:
        return a, []
    lo = max(1, i - MAX_BACK)
    lv = np.concatenate([H[lo:i], np.maximum(O[lo:i], C[lo:i]), C[lo:i]])
    lv = np.unique(np.round(lv, 6))
    lv = lv[(C[i] - lv) / a >= CMP_MIN]
    out = []
    for P in lv:
        left = _left(H, i, P, a)
        if i - left < MIN_SPAN:
            continue
        t = [k for k in range(left, i) if H[k] >= P - TOUCH * a]
        if groups(t) < 2:
            continue
        out.append({'P': float(P), 'left': int(left), 'src': 'ceil'})
    out.sort(key=lambda x: x['P'])
    ded = []
    for x in out:
        if ded and x['P'] - ded[-1]['P'] < DEDUP * a:
            continue
        ded.append(x)
    for pid, p, why in det_lines:
        if pid in IGNORE or not (p == p) or p <= 0:
            continue
        if any(abs(x['P'] - p) < DEDUP * a for x in ded):
            continue
        left = _left(H, i, p, a)
        ded.append({'P': float(p), 'left': int(min(left, i - 1)), 'src': 'det'})
    return a, ded


def _sma(x, i, n):
    return float(np.mean(x[max(0, i - n + 1):i + 1]))


def _ema(x, i, n):
    k = 2 / (n + 1)
    s = max(0, i - 4 * n)
    e = x[s]
    for j in range(s + 1, i + 1):
        e = x[j] * k + e * (1 - k)
    return float(e)


def chart_context(arr, i):
    T, O, H, L, C, V = arr
    a = atr14(H, L, C, i)
    sma50, sma200, ema21 = _sma(C, i, 50), _sma(C, i, 200), _ema(C, i, 21)
    sma200_20 = _sma(C, i - 20, 200) if i >= 220 else sma200
    v10 = float(np.mean(V[max(0, i - 9):i + 1]))
    v50 = float(np.mean(V[max(0, i - 59):max(1, i - 9)]))
    return {'T': T, 'O': O, 'H': H, 'L': L, 'C': C, 'V': V, 'i': i, 'a': a, 'sma50': sma50, 'sma200': sma200,
            'ema21': ema21, 'sma200_slope': (sma200 - sma200_20) / sma200 if sma200 else 0.0,
            'vol_dry': v10 / v50 if v50 > 0 else 1.0, 'hist': i + 1,
            'hi250': float(np.max(H[max(0, i - 249):i + 1])),
            'tight10': float(np.mean((H[i - 9:i + 1] - L[i - 9:i + 1]))) / a,
            'cstd10': float(np.std(C[i - 9:i + 1])) / a,
            'ret20': C[i] / C[max(0, i - 20)] - 1, 'ret60': C[i] / C[max(0, i - 60)] - 1,
            'vol_i': V[i] / float(np.mean(V[max(0, i - 50):i])) if np.mean(V[max(0, i - 50):i]) > 0 else 1.0,
            'range_i': (H[i] - L[i]) / a, 'clv_i': (C[i] - L[i]) / (H[i] - L[i]) if H[i] > L[i] else 0.5,
            'gap_i': (O[i] - C[i - 1]) / a, 'chg_i': (C[i] - C[i - 1]) / a,
            'ext_ema21_max10': float(max((C[j] - _ema(C, j, 21)) for j in range(i - 9, i + 1))) / a}


def _slope(y):
    if len(y) < 3:
        return 0.0
    x = np.arange(len(y), dtype=float)
    return float(np.polyfit(x, y, 1)[0])


def _cupness(y):
    if len(y) < 8:
        return 0.0
    x = np.linspace(-1, 1, len(y))
    co = np.polyfit(x, y, 2)
    f = np.polyval(co, x)
    ss = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - float(np.sum((y - f) ** 2)) / ss if ss > 0 else 0.0
    return float(np.sign(co[0]) * max(0.0, r2))


def features(cx, cand, det):
    """One candidate's feature vector (geometry of the level and its span, plus which detector lines sit on
    it). det: {'served': [(pid, [prices])], 'cand': [(pid, price, why)], 'base_cands': [(verdict, pivot, lip)]}."""
    H, L, C, O, V = cx['H'], cx['L'], cx['C'], cx['O'], cx['V']
    i, a = cx['i'], cx['a']
    P, left = cand['P'], cand['left']
    n = i - left
    sp = slice(left, i) if n > 0 else slice(i - 1, i)
    hs, ls, cs = H[sp], L[sp], C[sp]
    bt = np.maximum(O[sp], C[sp])
    idx = np.arange(sp.start, sp.stop)
    tmask = hs >= P - TOUCH * a
    t = idx[tmask]
    lo_k = int(idx[np.argmin(ls)])
    low = float(np.min(ls))
    f = {}
    f['src_det'] = float(cand['src'] == 'det')
    f['n'] = float(n)
    f['log_n'] = math.log1p(n)
    f['capped'] = float(left <= max(1, i - MAX_BACK))
    f['cmp'] = (C[i] - P) / a
    f['abs_cmp'] = abs(f['cmp'])
    f['prev_cmp'] = (C[i - 1] - P) / a
    f['hi_cmp'] = (H[i] - P) / a
    f['touch_n'] = float(len(t))
    f['touch_g'] = float(groups(list(t)))
    f['body_touch'] = float(np.sum(np.abs(bt - P) <= 0.25 * a))
    f['close_touch'] = float(np.sum(np.abs(cs - P) <= 0.25 * a))
    f['first_touch_frac'] = float((t[0] - left) / max(1, n)) if len(t) else 1.0
    f['last_touch_age'] = float(i - t[-1]) if len(t) else float(n)
    f['d_maxhigh'] = (P - float(np.max(hs))) / a
    f['d_maxbody'] = (P - float(np.max(bt))) / a
    f['d_maxclose'] = (P - float(np.max(cs))) / a
    f['depth_pct'] = (P - low) / P
    f['depth_atr'] = (P - low) / a
    f['low_pos'] = (lo_k - left) / max(1, n)
    f['since_low'] = float(i - lo_k)
    f['recovery'] = (C[i] - low) / (P - low) if P > low else 1.0
    f['lip_atr'] = (H[left - 1] - P) / a if left >= 1 else 0.0
    w0 = max(0, left - 60)
    pre = slice(w0, left)
    if left - w0 > 0:
        ph = H[pre]
        f['over60_atr'] = (float(np.max(ph)) - P) / a
        f['over60_age'] = float(left - (w0 + int(np.argmax(ph))))
        f['above_close60'] = float(np.sum(C[pre] > P + 0.25 * a))
        mn = float(np.min(L[pre]))
        f['adv60'] = (P - mn) / mn if mn > 0 else 0.0
    else:
        f['over60_atr'], f['over60_age'], f['above_close60'], f['adv60'] = 0.0, 0.0, 0.0, 0.0
    w1 = max(0, left - 120)
    mn = float(np.min(L[w1:left])) if left > w1 else P
    f['adv120'] = (P - mn) / mn if mn > 0 else 0.0
    f['slope_span'] = _slope(cs) / a if n >= 3 else 0.0
    m = min(n, 20)
    f['slope_20'] = _slope(C[i - m:i + 1]) / a if m >= 3 else 0.0
    f['cupness'] = _cupness(cs)
    f['tight10'] = cx['tight10']
    f['cstd10'] = cx['cstd10']
    f['vol_dry'] = cx['vol_dry']
    f['c_sma50'] = (C[i] - cx['sma50']) / a
    f['c_sma200'] = (C[i] - cx['sma200']) / a
    f['c_ema21'] = (C[i] - cx['ema21']) / a
    f['p_sma200'] = (P - cx['sma200']) / a
    f['p_sma50'] = (P - cx['sma50']) / a
    f['ma_stack'] = float(cx['sma50'] > cx['sma200'])
    f['sma200_slope'] = cx['sma200_slope']
    f['hi250_atr'] = (cx['hi250'] - P) / a
    f['p_hi250'] = P / cx['hi250']
    f['atr_pct'] = a / C[i]
    f['ret20'] = cx['ret20']
    f['ret60'] = cx['ret60']
    f['short_hist'] = float(cx['hist'] < 260)
    for k in ('vol_i', 'range_i', 'clv_i', 'gap_i', 'chg_i', 'ext_ema21_max10'):
        f[k] = cx[k]
    for k in FAM:
        f['srv_' + k] = 0.0
        f['wh_' + k] = 0.0
    for pid, lines in det['served']:
        if any(abs(l - P) <= 0.5 * a for l in lines):
            f['srv_' + fam_of(pid)] = 1.0
    for pid, p, why in det['cand']:
        if pid in IGNORE or why is None:
            continue
        if abs(p - P) <= 0.5 * a:
            f['wh_' + fam_of(pid)] = 1.0
    gi = [BASE_GATES.index(g) for g, p, lip in det['base_cands'] if abs(p - P) <= 0.5 * a]
    f['base_gate'] = float(max(gi)) if gi else -1.0
    f['chart_served'] = float(bool(det['served']))
    return f


def chart_rows(arr, det, i):
    """All candidates of one chart with features (plus within-chart relative features)."""
    dl = [(pid, p, why) for pid, p, why in det['cand']] + [(pid, l, None) for pid, ls in det['served'] for l in ls]
    a, cands = generate(arr, dl, i)
    if not cands:
        return a, []
    cx = chart_context(arr, i)
    fs = [features(cx, c, det) for c in cands]
    ac = np.array([x['abs_cmp'] for x in fs])
    order = np.argsort(np.argsort(ac, kind='stable'), kind='stable')
    ns = np.array([x['n'] for x in fs])
    nr = np.argsort(np.argsort(-ns, kind='stable'), kind='stable')
    Ps = np.array([c['P'] for c in cands])
    for k, x in enumerate(fs):
        x['rank_near'] = float(order[k])
        x['rank_len'] = float(nr[k])
        x['n_cands'] = float(len(cands))
        x['n_below'] = float(np.sum(Ps < cands[k]['P']))
        x['is_top'] = float(cands[k]['P'] == Ps.max())
    return a, [dict(c, f=x) for c, x in zip(cands, fs)]


# ================================================================ ranker (pure-Python tree ensemble)
def load_ranker(path=None):
    """The frozen tree ensemble. Raises on a missing / malformed file (the caller draws nothing)."""
    if path is None and _RANKER[0] is not None:
        return _RANKER[0]
    with open(path or _RANKER_PATH, encoding='utf-8') as fh:
        m = json.load(fh)
    if not (isinstance(m.get('features'), list) and isinstance(m.get('trees'), list) and m['trees']
            and isinstance(m.get('baseline'), float)):
        raise ValueError('malformed shelf pivot ranker')
    if path is None:
        _RANKER[0] = m
    return m


def _tree_value(nodes, x):
    nd = nodes[0]
    while len(nd) != 1:
        f, thr, miss_left, lft, rgt = nd
        v = x[f]
        if v != v:
            nd = nodes[lft] if miss_left else nodes[rgt]
        else:
            nd = nodes[lft] if v <= thr else nodes[rgt]
    return nd[0]


def ranker_scores(cands, model=None):
    """Probability per candidate: logistic(baseline + one leaf per tree, summed in tree order)."""
    from scipy.special import expit
    m = model or load_ranker()
    names = m['features']
    out = []
    for c in cands:
        x = [float(c['f'][n]) for n in names]
        raw = 0.0
        raw += m['baseline']
        for nodes in m['trees']:
            raw += _tree_value(nodes, x)
        out.append(float(expit(np.float64(raw))))
    return out


# ================================================================ shelf rules (candidate level)
def sma50_slope(C, i):
    return float(np.mean(C[i - 49:i + 1])) / float(np.mean(C[i - 59:i - 9])) - 1


def shelf_eligible(H, C, i, a, cand, served_lines, p=SHELF):
    if cand['src'] != 'ceil':
        return False, 'not_ceil'
    f = cand['f']
    P = cand['P']
    if any(abs(l - P) <= p['DUP_ATR'] * a for l in served_lines):
        return False, 'dup_served'
    if f['touch_g'] < p['MIN_TOUCH_G']:
        return False, 'touches'
    cmp_ = (C[i] - P) / a
    if not (-p['NEAR_BELOW_ATR'] <= cmp_ <= p['MAX_EXT_ATR']):
        return False, 'not_near'
    if f['last_touch_age'] > p['MAX_TOUCH_AGE']:
        return False, 'stale'
    if f['recovery'] < p['MIN_RECOVERY']:
        return False, 'not_recovered'
    if f['n'] < p['SHORT_N'] and f['touch_g'] < p['SHORT_TG']:
        return False, 'short_weak'
    if f['depth_pct'] > p['MAX_DEPTH']:
        return False, 'too_deep'
    if f['slope_20'] < p['MIN_SLOPE20']:
        return False, 'falling'
    if f['c_sma50'] < 0 and sma50_slope(C, i) < p['DOWN50_SLOPE']:
        return False, 'downtrend'
    if f['adv120'] < p['MIN_ADV120']:
        return False, 'no_prior_advance'
    return True, 'ok'


# ================================================================ level rules (snapped level)
def level_facts(H, C, i, a, P, left, p=PARAMS):
    tt = P - p['TOUCH_ATR'] * a
    rt = P - p['RETREAT_ATR'] * a
    grps, cur, retreated = [], None, True
    for k in range(left, i + 1):
        if H[k] >= tt:
            if cur is not None and (not retreated or k - cur[1] < p['SEP'] or k - left < p['START_N']):
                cur[1] = k
                retreated = False
            else:
                cur = [k, k]
                grps.append(cur)
                retreated = False
        elif H[k] < rt:
            retreated = True
    e = max(left, i - 3)
    seg = C[left:e]
    above = float((seg > P).mean()) if len(seg) else 0.0
    x = int(sum(1 for k in range(left + 1, e) if (C[k - 1] - P) * (C[k] - P) < 0))
    near = float((abs(C[left:i + 1] - P) <= 0.5 * a).mean())
    recent_max = float(max(C[max(0, i - p['FALL_N'] + 1):i + 1]))
    return {'tg': len(grps), 'groups': [tuple(g) for g in grps],
            'last_test_age': (i - grps[-1][1]) if grps else 999,
            'prev_test_age': (i - grps[-2][1]) if len(grps) >= 2 else 999,
            'mid_age': max([i - g[1] for g in grps[1:-1]], default=-1),
            'cmp': (C[i] - P) / a, 'pct': C[i] / P - 1, 'fall': (recent_max - C[i]) / a,
            'chop_share': above, 'chop_x': x, 'near_share': near, 'span': i - left}


def snap(H, BT, i, a, P, left, p=PARAMS):
    """(L, n_votes) or (None, 0): the level the test bars' highs / body tops cluster at."""
    tb = [k for k in range(left, i) if H[k] >= P - p['TOUCH_ATR'] * a]
    if not tb:
        return None, 0
    tol = p['SNAP_ATR'] * a
    h, bt = H[tb], BT[tb]
    vs = np.concatenate([h, bt])
    dh, db = np.abs(h[None, :] - vs[:, None]), np.abs(bt[None, :] - vs[:, None])
    near = np.where(dh <= db, h[None, :], bt[None, :])
    hit = np.minimum(dh, db) <= tol
    cnt = hit.sum(1)
    order = np.lexsort((np.abs(vs - P), -cnt))
    b = order[0]
    L = float(np.median(near[b][hit[b]]))
    return L, int(cnt[b])


def near_top(H, BT, k, L, tol):
    return abs(H[k] - L) <= tol or abs(BT[k] - L) <= tol


def cluster_bars(H, BT, lo, hi, L, tol):
    return [k for k in range(max(0, lo), hi) if near_top(H, BT, k, L, tol)]


def served_bases(served, T, i, L_):
    """[(pivot, base_low, s0, s1)] for served base rows."""
    out = []
    tss = list(T[:i + 1])
    for pid, ls, sp in served:
        if not ls or not (pid in BASE_PIDS or 'cup' in pid):
            continue
        s0 = tss.index(int(sp[0])) if sp and int(sp[0]) in tss else max(0, i - 20)
        s1 = tss.index(int(sp[1])) if sp and int(sp[1]) in tss else i
        out.append((float(max(ls)), float(np.min(L_[s0:s1 + 1])), s0, s1))
    return out


def level_eligible(arr, i, a, cand, served, p=PARAMS):
    """(ok, reason, facts) for one candidate that already passed the shelf rules and the ranker threshold."""
    T, O, H, L_, C, V = arr
    BT = np.maximum(O, C)
    P0 = cand['P']
    Ls, nv = snap(H, BT, i, a, P0, cand['left'], p)
    if Ls is None:
        return False, 'a_no_tests', None
    if abs(Ls - P0) > p['MAX_SHIFT'] * a:
        return False, 'a_shift', None
    left = cand['left']
    tol = p['CLUSTER_ATR'] * a
    sl = [l for _, ls, _ in served for l in ls]
    if any(abs(l - Ls) <= SHELF['DUP_ATR'] * a for l in sl):
        return False, 'dup_served', None
    f = level_facts(H, C, i, a, Ls, left, p)
    f['P0'] = P0
    f['L'] = Ls
    f['left'] = left
    cb = cluster_bars(H, BT, left, i, Ls, tol)
    f['cluster'] = len(cb)
    if len(cb) < p['MIN_CLUSTER']:
        return False, 'a_cluster', f
    if f['span'] < p['MIN_SPAN']:
        return False, 'r7_short', f
    if not (-p['NEAR_BELOW_ATR'] <= f['cmp'] <= p['MAX_EXT_ATR']) or f['pct'] < -p['NEAR_PCT']:
        return False, 'r3_not_near', f
    if f['tg'] < p['MIN_TG']:
        return False, 'r1_touch_groups', f
    if f['mid_age'] < p['MID_AGE']:
        return False, 'r2_no_middle_test', f
    if f['prev_test_age'] > p['PREV_AGE']:
        return False, 'r1b_no_recent_prior_test', f

    def reach(k):
        return near_top(H, BT, k, Ls, tol) or H[k] > Ls

    f['tight_tg'] = sum(1 for g in f['groups'] if any(reach(k) for k in range(g[0], g[1] + 1)))
    if f['tight_tg'] < p['MIN_TIGHT_TG']:
        return False, 'a_tight_groups', f
    if not any(any(reach(k) for k in range(g[0], g[1] + 1))
               for g in f['groups'][1:-1] if i - g[1] >= p['MID_AGE']):
        return False, 'a_no_tight_middle_test', f
    if f['last_test_age'] > p['LAST_TEST_AGE']:
        return False, 'r4_no_recent_test', f
    if f['fall'] > p['FALL_ATR']:
        return False, 'r5_falling_away', f
    if f['chop_share'] > p['CHOP_SHARE'] or f['chop_x'] > p['CHOP_X']:
        return False, 'r6_chop', f
    if f['near_share'] > p['CHOP_NEAR'] and f['chop_x'] >= p['CHOP_NEAR_X']:
        return False, 'r6b_chop_at_line', f
    lo = max(left, i - p['RECENT_N'])
    if not any(reach(k) for k in range(lo, i - p['RECENT_EXCL'] + 1)):
        return False, 'b_above_recent_range', f
    for g in range(i - p['GAP_EXCL'], max(1, left - p['GAP_LOOKBACK']) - 1, -1):
        gap = H[g] < L_[g - 1] or O[g] <= C[g - 1] - p['GAP_ATR'] * a
        if gap and H[g - 1] >= Ls - tol and H[g] < Ls - tol:
            if sum(1 for gr in f['groups'] if gr[1] < g) <= 1 and \
                    not any(reach(k) for k in range(g + p['GAP_SKIP'], i - p['GAP_EXCL'] + 1)):
                return False, 'c_gap_never_retested', f
            break
    for piv, blow, s0, s1 in served_bases(served, T, i, L_):
        if s1 < left or s0 > i:
            continue
        if abs(Ls - piv) < p['BASE_SEP_ATR'] * a:
            return False, 'd_competes_base_pivot', f
        if blow <= Ls < piv:
            outside = [k for k in cb if k < s0 or k > s1]
            if not (Ls <= piv - p['BASE_SEP_ATR'] * a and len(outside) >= p['MIN_CLUSTER']):
                return False, 'd_inside_base', f
    f['disp_left'] = next((k for k in range(left, i) if reach(k)), left)
    return True, 'ok', f


def eligible(arr, i, a, cand, served, p=PARAMS):
    T, O, H, L_, C, V = arr
    sl = [l for _, ls, _ in served for l in ls]
    ok, why = shelf_eligible(H, C, i, a, cand, sl)
    if not ok:
        return False, why, None
    return level_eligible(arr, i, a, cand, served, p)


def pick(arr, i, a, cands, scores, served, p=PARAMS):
    """(index of the drawn candidate or None, its facts incl. the snapped 'L', 'left' and 'disp_left')."""
    if not cands or not a:
        return None, None
    ok_ = []
    for j, c in enumerate(cands):
        if scores[j] < p['THR']:
            continue
        ok, _, f = eligible(arr, i, a, c, served, p)
        if ok:
            ok_.append((j, f))
    if not ok_:
        return None, None
    top = max(f['L'] for _, f in ok_)
    same = [(j, f) for j, f in ok_ if f['L'] >= top - p['SAME_ATR'] * a]
    return max(same, key=lambda x: (scores[x[0]], x[1]['L']))


# ================================================================ the layer
def evaluate(rows, served=(), lines=(), *, p=PARAMS, gate=GATE, model=None):
    """The shelf-pivot layer as of the last row.

    rows: [(t, o, h, l, c, v)] oldest first; the last row is the as-of bar and must be a COMPLETED session.
    served: the drawings the chart serves, [(pattern_id, [drawn prices], (start_t, end_t) or None)].
    lines: every detector line on the chart, served or withheld, [(pattern_id, price, withheld)] in the order the
      member path produced them (a ranker input).
    Returns {'gate', 'pick' (dict or None), 'score', 'atr', 'scores'}; never mutates its inputs."""
    served = [(pid, [float(x) for x in ls], tuple(sp) if sp else None) for pid, ls, sp in served]
    arr = arrays(rows)
    i = len(rows) - 1
    out = {'gate': None, 'pick': None, 'score': None, 'atr': None, 'scores': []}
    if i < MIN_HISTORY_INDEX:
        out['gate'] = 'short_history'
        return out
    ok, why = context_gate(context(arr, i), gate)
    out['gate'] = why
    if not ok:
        return out
    a = atr14(arr[2], arr[3], arr[4], i)
    det = {'served': [(pid, ls) for pid, ls, _ in served],
           'cand': [(pid, float(pr), 'withheld' if wh else None) for pid, pr, wh in lines],
           'base_cands': base_candidate_gates(arr, i, a) if a else []}
    a, cands = chart_rows(arr, det, i)
    out['atr'] = a
    if not cands:
        out['gate'] = 'no_cands'
        return out
    sc = ranker_scores(cands, model)
    out['scores'] = [(c['P'], c['left'], c['src'], s) for c, s in zip(cands, sc)]
    j, f = pick(arr, i, a, cands, sc, served, p)
    if j is None:
        out['gate'] = 'no_shelf'
        return out
    T, C = arr[0], arr[4]
    out['pick'] = {'P': f['L'], 'P_cand': cands[j]['P'], 'left': f['left'], 'disp_left': f['disp_left'],
                   'left_t': int(T[f['left']]), 'disp_left_t': int(T[f['disp_left']]), 'asof_t': int(T[i]),
                   'close': float(C[i]), 'touch_groups': f['tg'], 'tight_groups': f['tight_tg'],
                   'cluster_bars': f['cluster']}
    out['score'] = sc[j]
    return out
