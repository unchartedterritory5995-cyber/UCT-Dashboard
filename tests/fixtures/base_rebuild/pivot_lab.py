"""Reference copy of the research prototype of the round-7 plain-base buy line (the "spike-aware pivot"), used as
the parity oracle for base_draw.plain_pivot in tests/test_base_draw_plain_pivot.py. Its code is the prototype's, line
for line (the module docstring and one comment are generic); do NOT edit it to match the port -- a port that drifts
must fail parity.

Input: bars [{t,o,h,l,c,v}] oldest first, and a round-6 plain base: lip (its left-side bar), i (the as-of bar; the
base is [lip, i-1]), H (the round-6 line = max high of [lip, i-1]), L (min low of [lip, i-1]).

 a. SPIKE TEST: isolation of H over the rest of the base (and, with `pre`, the PRE_BARS bars before the lip) in
    ATR(14), or a reversal candle (closes in its lower half, more than REV_ATR ATR under H) gated by rev_gate.
 b. RIGHT-SIDE CEILING: clustered swing highs after the H bar in the upper half of the base; `contained` when no
    later close is more than CONTAIN_ATR ATR over the candidate.
 c. v7 = the ceiling candidate if spike and a (contained) ceiling exists, else H. No +$0.10.
"""
import statistics

SPIKE_ATRS = (0.75, 1.0, 1.5)
CLUSTER_ATRS = (0.5, 0.75)
TIGHT_PCTS = (0.06, 0.08, 0.10)
CANDS = ('max', 'median', 'recent')
REV_ATR = 1.0
SWING_K = 2
MIN_APART = 3
TIGHT_N = (5, 15)
PRE_BARS = 5        # refinement R1: iso_pre also counts the PRE_BARS bars before the lip (the advance into the high)
CONTAIN_ATR = 0.25  # refinement R2: a ceiling is "contained" if no close after its first touch exceeds it by more than CONTAIN_ATR x ATR

# The provisional defaults: the reversal component is GATED -- it counts only when H also clears the rest of the
# base by more than rev_gate ATR (rev_gate None = the ungated spec form).
DEFAULT = {'spike_atr': 1.0, 'rev_gate': 0.5, 'cluster_atr': 0.75, 'cand': 'median', 'tight_pct': 0.08,
           'pre': True, 'contain': True}


def atr(b, i, n=14):
    k = max(1, i - n + 1)
    trs = [max(b[j]['h'], b[j - 1]['c']) - min(b[j]['l'], b[j - 1]['c']) for j in range(k, i + 1)]
    return sum(trs) / len(trs) if trs else None


def spike_test(b, lip, i, H, a):
    h = [x['h'] for x in b]
    m_h = max(range(lip, i), key=lambda m: (h[m], -m))
    rest = [h[m] for m in range(lip, i) if abs(m - m_h) > 1]
    iso = (H - max(rest)) / a if rest else 0.0
    rest_pre = rest + [h[m] for m in range(max(0, lip - PRE_BARS), lip) if abs(m - m_h) > 1]
    iso_pre = (H - max(rest_pre)) / a if rest_pre else 0.0
    x = b[m_h]
    rng = x['h'] - x['l']
    lower_half = rng > 0 and (x['c'] - x['l']) < 0.5 * rng
    close_gap = (H - x['c']) / a
    body_gap = (H - max(x['o'], x['c'])) / a
    return {'m_h': m_h, 'h_t': x['t'], 'iso_atr': iso, 'iso_pre_atr': iso_pre, 'lower_half': lower_half, 'close_gap_atr': close_gap,
            'body_gap_atr': body_gap, 'reversal': bool(lower_half and close_gap > REV_ATR)}


def swing_highs(b, s, i):
    """Indices j in [s, i-1] whose high is >= the SWING_K highs before and after (after truncated at i-1)."""
    h = [x['h'] for x in b]
    out = []
    for j in range(max(s, 1), i):
        left = h[max(0, j - SWING_K):j]
        right = h[j + 1:min(i, j + SWING_K + 1)]
        if left and h[j] >= max(left) and (not right or h[j] >= max(right)):
            out.append(j)
    return out


def ceiling(b, start, i, H, L, a, cluster_atr):
    mid = L + 0.5 * (H - L)
    tol = cluster_atr * a
    t = [(b[j]['h'], j) for j in swing_highs(b, start, i) if mid <= b[j]['h'] < H]
    for px, j in sorted(t, key=lambda z: (-z[0], -z[1])):
        mem = [(p, k) for p, k in t if px - tol <= p <= px]
        idx = [k for _, k in mem]
        if len(mem) >= 2 and max(idx) - min(idx) >= MIN_APART:
            mem.sort(key=lambda z: z[1])
            mc = max(b[k]['c'] for k in range(mem[0][1], i))
            r = {'max': px, 'median': statistics.median(p for p, _ in mem), 'recent': mem[-1][0],
                 'touches': [(b[k]['t'], p) for p, k in mem], 'n': len(mem), 'max_close_after': mc}
            r['contained'] = {cd: mc <= r[cd] + CONTAIN_ATR * a for cd in ('max', 'median', 'recent')}
            return r
    return None


def tight_area(b, i, pct):
    for n in range(TIGHT_N[1], TIGHT_N[0] - 1, -1):
        if i - n < 0:
            continue
        w = b[i - n:i]
        hi, lo = max(x['h'] for x in w), min(x['l'] for x in w)
        if hi - lo <= pct * b[i - 1]['c']:
            return {'n': n, 'pivot': hi, 'range_pct': (hi - lo) / b[i - 1]['c']}
    return None


def analyze(b, lip, i, H=None, L=None):
    """Every component on every parameter of the grid for one round-6 hit."""
    h = [x['h'] for x in b]
    lo = [x['l'] for x in b]
    if H is None:
        H = max(h[lip:i])
    if L is None:
        L = min(lo[lip:i])
    a = atr(b, i)
    sp = spike_test(b, lip, i, H, a)
    low_i = min(range(lip, i), key=lambda m: (lo[m], m))
    out = {'H': H, 'L': L, 'atr': a, 'lip_t': b[lip]['t'], 'i_t': b[i]['t'], 'low_t': b[low_i]['t'], 'spike': sp,
           'ceil_after_h': {}, 'ceil_after_low': {}, 'v7': {}, 'tight': {}}
    for ca in CLUSTER_ATRS:
        out['ceil_after_h'][ca] = ceiling(b, sp['m_h'] + 1, i, H, L, a, ca)
        out['ceil_after_low'][ca] = ceiling(b, low_i + 1, i, H, L, a, ca)
    for sa in SPIKE_ATRS:
        is_spike = sp['iso_atr'] > sa or sp['reversal']
        for ca in CLUSTER_ATRS:
            c = out['ceil_after_h'][ca] if is_spike else out['ceil_after_low'][ca]
            for cand in CANDS:
                v = c[cand] if (is_spike and c) else H
                out['v7'][(sa, ca, cand)] = {'spike': is_spike, 'ceiling': c is not None, 'pivot': v,
                                             'move': (H - v) / H}
    for tp in TIGHT_PCTS:
        out['tight'][tp] = tight_area(b, i, tp)
    return out


def v7_pick(res, spike_atr, rev_gate, cluster_atr, cand, pre=False, contain=False):
    sp = res['spike']
    iso = sp['iso_pre_atr'] if pre else sp['iso_atr']
    is_spike = iso > spike_atr or (sp['reversal'] and (rev_gate is None or iso > rev_gate))
    c = res['ceil_after_h'][cluster_atr] if is_spike else res['ceil_after_low'][cluster_atr]
    use = is_spike and c and (not contain or c['contained'][cand])
    v = c[cand] if use else res['H']
    return {'spike': is_spike, 'ceiling': c is not None, 'pivot': v, 'move': (res['H'] - v) / res['H'], 'cluster': c}


def v7_default(res, p=DEFAULT):
    return v7_pick(res, p['spike_atr'], p['rev_gate'], p['cluster_atr'], p['cand'], p['pre'], p['contain'])
