# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
import os, sys
from . import pivot_v7 as P7
from . import v2_bases as V2
RIM_OVER = 0.15
MAX_DEPTH = 0.5
DB_GAP, DB_LOWS, DB_MID = (10, 0.96, 0.5)
CUP_POS, CUP_REC = ((0.15, 0.85), 0.6)

def downtrend(I, i):
    s50, s200, c = (I.s50, I.s200, I.c)
    if not s50[i] or not s50[i - 10]:
        return False
    if s200[i] and s200[i - 40] and (c[i] < s200[i]) and (s200[i] < s200[i - 40]) and (c[i] < s50[i]):
        return True
    return c[i] < s50[i] and s50[i] < s50[i - 10] and (s200[i] is None or c[i] < s200[i])

def lone_spike(b, k, lo, e, a):
    h = [x['h'] for x in b]
    others = [h[j] for j in range(lo, e + 1) if abs(j - k) > 1]
    if not others:
        return (False, None)
    second = max(others)
    rng = b[k]['h'] - b[k]['l']
    wick = (b[k]['h'] - max(b[k]['o'], b[k]['c'])) / rng if rng > 0 else 0
    big = rng >= 1.8 * a or (k > 0 and b[k]['o'] >= b[k - 1]['c'] * 1.04)
    alone = h[k] - second > max(1.0 * a, 0.025 * h[k])
    return (alone and (wick >= 0.35 or big), second)

def peg_flag(b, i, I, view0):
    h, l, c, o = (I.h, I.l, I.c, I.o)
    for g in range(i - 1, max(view0, i - 25), -1):
        gp = o[g] / c[g - 1] - 1
        rv = I.rvol(g)
        if not (gp >= 0.08 and rv >= 3 or (gp >= 0.03 and c[g] / c[g - 1] - 1 >= 0.1 and (rv >= 3))):
            continue
        L = max(range(g, i), key=lambda k: h[k])
        if i - L < 2 or min(c[g:i + 1]) < c[g - 1]:
            return None
        low = min(l[L:i + 1])
        depth = (h[L] - low) / h[L]
        if depth > 0.25:
            return None
        piv = h[L]
        today = c[i] > piv and c[i - 1] <= piv
        e = i - 1 if today else i
        return {'L': L, 'R': L, 'e': e, 'n': e - L + 1, 'H': h[L], 'low': low, 'depth': depth, 'adv': h[L] / c[g - 1] - 1, 'pivot': piv, 'today': today, 'jb': i if today else None, 'v7': None, 'peg': g}
    return None

def tight_pause(b, i, I, view0):
    h, l, c = (I.h, I.l, I.c)
    best = None
    for n in range(4, 16):
        L = i - n + 1
        if L <= view0 + 1:
            break
        top, bot = (max(h[L:i + 1]), min(l[L:i + 1]))
        if (top - bot) / top > 0.08:
            break
        if top >= max(h[max(view0, i - 40):i + 1]) * 0.995 and c[i] <= top:
            best = (L, top, bot, n)
    if not best:
        return None
    L, top, bot, n = best
    pre = l[max(0, L - 25):L + 1]
    return {'L': L, 'R': L, 'e': i, 'n': n, 'H': top, 'low': bot, 'depth': (top - bot) / top, 'adv': top / min(pre) - 1 if pre else 0, 'pivot': top, 'today': False, 'jb': None, 'v7': None, 'pause': True}

def prior_base(b, i, I, view0):
    h, c = (I.h, I.c)
    for k in range(i - 1, max(view0 + 60, i - 40), -1):
        if c[k] <= max(h[max(view0, k - 30):k - 1]) or c[k - 1] > max(h[max(view0, k - 30):k - 1]):
            continue
        Bk = V2.find_base(b[:k + 1], k, view0)
        if Bk and Bk['today'] and (Bk['jb'] == k):
            Bk['earlier'] = k
            return Bk
    return None

def find_base(b, i, I, view0=0):
    h = I.h
    l = I.l
    c = I.c
    if downtrend(I, i):
        return None
    B = V2.find_base(b, i, view0)
    P = peg_flag(b, i, I, view0)
    if P and (not B or B['L'] < P['peg']):
        if B and abs(P['pivot'] / B['H'] - 1) <= 0.05 and (B['n'] >= 30):
            B['peg_handle'] = P['peg']
        else:
            B = P
    rng = False
    if not B:
        keep = V2.MIN_ADV
        try:
            V2.MIN_ADV = -1.0
            B = V2.find_base(b, i, view0)
        finally:
            V2.MIN_ADV = keep
        if B and (B['n'] < 25 or B['depth'] > 0.35):
            B = None
        rng = bool(B)
    if False and (not B or B.get('n', 99) > 60):
        T = tight_pause(b, i, I, view0)
        if T and (not B or B['L'] < T['L'] - 20):
            B = T
    if not B:
        B = prior_base(b, i, I, view0)
    if not B:
        return None
    B['range'] = rng
    L, R, e, piv = (B['L'], B['R'], B['e'], B['pivot'])
    a = I.A(e)
    lo = max(view0, e - V2.MAX_LOOK, 1)
    ce = V2.ceilings(b, h, c, lo, e, a)
    for L2 in [] if B.get('peg') is not None or B.get('earlier') else reversed(ce):
        if L2 >= L or h[L2] > piv * (1 + RIM_OVER) or h[L2] < piv * 0.97:
            continue
        low2 = min(l[L2:e + 1])
        depth2 = (h[L2] - low2) / h[L2]
        pre = l[max(0, L2 - 65):L2 + 1]
        adv = h[L2] / min(pre) - 1 if pre else 0
        k_low = min(range(L2, e + 1), key=lambda k: l[k])
        pos = (k_low - L2) / max(1, e - L2)
        u_shape = 0.2 <= pos <= 0.85 and piv >= low2 + 0.7 * (h[L2] - low2)
        if 0.12 <= depth2 <= MAX_DEPTH and e - L2 + 1 >= 30 and (adv >= 0.15) and (h[L2] <= piv * 1.05 or u_shape):
            B.update(L=L2, H=h[L2], low=low2, depth=depth2, n=e - L2 + 1, adv=adv, rim=True)
            L = L2
            break
    if not B.get('rim') and B['n'] < 30 and (B.get('peg') is None) and (not B.get('earlier')):
        for k in range(L - 20, max(view0 + 5, e - 250), -1):
            if not (h[k] >= max(h[k - 5:k + 6]) and piv * 0.95 <= h[k] <= piv * 1.05):
                continue
            lowk = min(l[k:L + 1])
            dep = (h[k] - lowk) / h[k]
            if 0.15 <= dep <= 0.4 and max(h[k + 1:L]) <= h[k] * 1.03:
                B.update(L=k, H=h[k], low=min(l[k:e + 1]), depth=(h[k] - min(l[k:e + 1])) / h[k], n=e - k + 1, rim=True)
                L = k
                break
    early = None
    if R != L:
        mid_low = min(l[L:R + 1])
        k_low = min(range(L, R + 1), key=lambda k: l[k])
        recovered = max(h[k_low:R + 1]) >= B['H'] - 0.5 * (B['H'] - mid_low)
        cupish = R - L >= 20 and (B['H'] - mid_low) / B['H'] >= 0.1 and recovered and (k_low < R - 3)
        if not cupish:
            if B['H'] <= piv * 1.12:
                early = piv
                piv = B['H']
                R = L
        B['kind'] = 'cup' if cupish else 'flag'
    else:
        B['kind'] = 'flag' if B['n'] < 25 else 'flat'
    seg_hi = max(h[R:e + 1])
    if seg_hi > piv * 1.0005:
        kk = max(range(R, e + 1), key=lambda k: h[k])
        isl_, _ = lone_spike(b, kk, L, e, a)
        if not isl_:
            if early is None and seg_hi > piv * 1.015:
                early = piv
            piv = seg_hi
    spike = None
    kp = max(range(L, e + 1), key=lambda k: h[k]) if abs(piv - max(h[L:e + 1])) < 1e-09 else R
    if abs(h[kp] - piv) < 1e-09:
        isl, second = lone_spike(b, kp, L, e, a)
        if isl and second and (second < piv):
            spike = (kp, h[kp])
            piv = second
            if early is not None and early >= piv:
                early = None
    if B['today'] and (not c[B['jb']] > piv):
        B['today'] = False
    top_line = B['H'] if B['H'] > piv * 1.003 else None
    if not B['today'] and piv > c[i] * 1.12:
        near = [k for k in V2.ceilings(b, h, c, max(L, 1), e, a) if h[k] > c[i] * 1.005 and h[k] < piv * 0.97 and (k > L)]
        if near:
            top_line = piv
            R = near[0]
            piv = h[R]
            early = None
    if top_line and top_line < piv + max(a, 0.02 * piv):
        top_line = None
    B['top_line'] = top_line if top_line and top_line <= c[i] * 1.25 and (not (spike and abs(top_line - spike[1]) < 1e-09)) else None
    B['R'] = R
    B['pivot'] = piv
    B['early'] = early if early is not None and early < piv * 0.985 else None
    B['spike'] = spike
    for k in range(max(B['L'] + 2, i - 20), i + 1):
        if I.o[k] / c[k - 1] - 1 <= -0.1 and l[k] < min(l[B['L']:k]):
            return None
    if B['n'] < 8 and B['depth'] >= 0.15 or (B['n'] < 20 and piv > c[i] * 1.15 and (not B['today'])) or (piv > c[i] * 1.18 and (not B['today'])):
        return None
    B['failed'] = False
    if not B['today'] and e == i and (i - 1 > L):
        low_before = min(l[L:i])
        if c[i] < low_before:
            B['failed'] = True
            B['low'] = low_before
            B['depth'] = (B['H'] - low_before) / B['H']
    return B

def classify(b, B, I, G):
    h, l, c = (I.h, I.l, I.c)
    L, R, e, n, depth, H, low = (B['L'], B['R'], B['e'], B['n'], B['depth'], B['H'], B['low'])
    piv = B['pivot']
    pre = l[max(0, L - 40):L + 1]
    pole40 = H / min(pre) - 1 if pre else 0
    pre25 = l[max(0, L - 25):L + 1]
    pole25 = H / min(pre25) - 1 if pre25 else 0
    if pole40 >= 0.9 and depth <= 0.25 and (n <= 30):
        return ('High tight flag', 'pole +%d%% in 8 weeks, flag %d%% deep' % (pole40 * 100, depth * 100), {})
    peg = [g for g in G if g['ep'] and L - 15 <= g['g'] <= L + 2]
    if peg and n <= 30 and (depth <= 0.3):
        return ('PEG flag', 'flag on top of the %s earnings/news gap' % b[peg[-1]['g']]['t'], {'peg': peg[-1]['g']})
    pt, note, extra = V2.classify(b, B)
    if pt.startswith('Double bottom'):
        x, y, mid = extra['db']
        if y - x >= DB_GAP and l[y] >= l[x] * DB_LOWS and (h[mid] >= low + DB_MID * (H - low)):
            return (pt, note, extra)
        pt = '?'
    k_low = min(range(L, e + 1), key=lambda k: (l[k], k))
    pos = (k_low - L) / max(1, n - 1)
    rec = max(h[k_low:e + 1]) >= low + 0.7 * (H - low)
    if n >= 30 and 0.15 <= depth <= MAX_DEPTH and (CUP_POS[0] <= pos <= CUP_POS[1]) and (max(h[k_low:e + 1]) >= low + CUP_REC * (H - low)):
        hl = min(l[R:e + 1]) if R != L else None
        if R != L and e - R + 1 >= 3 and (hl is not None) and ((h[R] - hl) / h[R] <= 0.15) and (h[R] >= low + 0.5 * (H - low)):
            return ('Cup with handle', 'U-shaped cup, handle %d bars' % (e - R + 1), {})
        return ('Cup without handle', 'U-shaped cup', {})
    if n <= 20:
        if pole25 >= 0.15 and depth <= 0.2 and (n >= 5):
            return ('Bull flag', 'pole +%d%% into a %d-bar flag' % (pole25 * 100, n), {})
        if depth <= 0.15:
            return ('Flat base', '%d%% deep, %d bars (short)' % (round(depth * 100), n), {})
        return ('Consolidation / range', '%d%% deep, %d bars' % (round(depth * 100), n), {})
    if n >= 30 and 0.18 <= depth <= MAX_DEPTH and (0.25 <= pos <= 0.8) and rec:
        hl = min(l[R:e + 1]) if R != L else None
        if R != L and e - R + 1 >= 3 and (hl is not None) and ((h[R] - hl) / h[R] <= 0.15) and (h[R] >= low + 0.5 * (H - low)):
            return ('Cup with handle', 'U-shaped cup, handle %d bars' % (e - R + 1), {})
        return ('Cup without handle', 'U-shaped cup', {})
    if depth <= 0.22:
        return ('Flat base', '%d%% deep, %.1f weeks' % (round(depth * 100), n / 5), {})
    if pt == 'VCP':
        return (pt, note, extra)
    if depth > MAX_DEPTH:
        return ('Faulty / wide and loose', '%d%% deep' % round(depth * 100), {})
    return ('Consolidation / range', '%d%% deep, %.1f weeks' % (round(depth * 100), n / 5), {})

def contractions3(h, l, L, e, k=3):
    hs, ls = ([], [])
    for j in range(L + 1, e):
        a, z = (max(L, j - k), min(e, j + k))
        if h[j] >= max(h[a:z + 1]):
            hs.append(j)
        if l[j] <= min(l[a:z + 1]):
            ls.append(j)
    hs = [L] + hs
    seq = []
    for a in hs:
        nxt = [z for z in ls if z > a and (not [q for q in hs if a < q < z])]
        if nxt:
            z = min(nxt, key=lambda q: l[q])
            seq.append((a, z, (h[a] - l[z]) / h[a]))
    return [x for x in seq if x[2] >= 0.02]

def is_vcp(I, B):
    seq = contractions3(I.h, I.l, B['L'], B['e'])
    if len(seq) < 2:
        return None
    dd = [x[2] for x in seq[-3:]]
    lows = [I.l[x[1]] for x in seq[-3:]]
    if all((dd[j + 1] <= dd[j] * 0.8 for j in range(len(dd) - 1))) and dd[-1] <= 0.12 and (lows[-1] >= lows[0] * 0.995):
        return dd
    return None
