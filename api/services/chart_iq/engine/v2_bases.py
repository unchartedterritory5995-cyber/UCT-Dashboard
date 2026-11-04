# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
import os, sys
from . import pivot_v7 as P7
MIN_HELD = 2
LIP_OVER = 0.15
MAX_LOOK = 325
MIN_ADV = 0.2

def records(h, lo, e):
    out, best = ([], -1.0)
    for k in range(e, lo - 1, -1):
        if h[k] > best:
            out.append(k)
            best = h[k]
    return out
POKE_ATR = 1.5

def ceilings(b, h, c, lo, e, a):
    out = []
    mc = mh = -1.0
    for k in range(e, lo - 1, -1):
        if e - k >= MIN_HELD and h[k] >= max(h[max(lo, k - 3):k + 1]) and (mc <= h[k]) and (mh <= h[k] + POKE_ATR * a):
            out.append(k)
        mc = max(mc, c[k])
        mh = max(mh, h[k])
    return out

def find_base(b, i, view0=0):
    h = [x['h'] for x in b]
    l = [x['l'] for x in b]
    c = [x['c'] for x in b]
    tries = [(i - 1, i), (i, None)] + [(j - 1, j) for j in range(i - 1, i - 11, -1)]
    for e, jb in tries:
        today = jb is not None
        lo = max(view0, e - MAX_LOOK, 1)
        a = P7.atr(b, e) or c[e] * 0.03
        ce = ceilings(b, h, c, lo, e, a)
        if not ce:
            continue
        best = None
        for R in ce:
            okL = []
            piv = h[R]
            if today and (not (c[jb] > piv and c[jb - 1] <= piv)):
                continue
            if today and jb < i and (max(c[jb:i + 1]) > piv * 1.1 or c[i] < piv):
                continue
            if not today and c[i] > piv:
                continue
            for L in ce:
                if L > R:
                    continue
                if h[L] > piv * (1 + LIP_OVER):
                    break
                n = e - L + 1
                low = min(l[L:e + 1])
                depth = (h[L] - low) / h[L]
                pre = l[max(0, L - 65):L + 1]
                adv = h[L] / min(pre) - 1 if pre else 0
                short_ok = n >= 5 and (depth <= 0.15 and adv >= 0.3 or (depth <= 0.25 and adv >= 0.5))
                if (n >= 10 or short_ok) and 0.04 <= depth <= 0.45 and (adv >= MIN_ADV) and (piv >= low + 0.5 * (h[L] - low)):
                    okL.append((R, L, n, low, depth, adv, piv))
            if okL:
                within = [x for x in okL if x[4] <= 0.35]
                best = (within or okL)[-1]
                break
        if not best:
            continue
        R, L, n, low, depth, adv, piv = best
        v7 = None
        if R == L:
            try:
                res = P7.analyze(b, L, min(e + 1, i), h[L], low)
                v7 = P7.v7_default(res)
                vp = v7['pivot']
                if vp < piv - 1e-09 and (c[jb - 1] <= vp < c[jb] if today else c[i] <= vp):
                    piv = vp
            except Exception:
                v7 = None
        return {'L': L, 'R': R, 'e': e, 'n': n, 'H': h[L], 'low': low, 'depth': depth, 'adv': adv, 'pivot': piv, 'today': today, 'jb': jb, 'v7': v7}
    return None

def contractions(h, l, L, e, k=3):
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
    return seq

def classify(b, B):
    h = [x['h'] for x in b]
    l = [x['l'] for x in b]
    c = [x['c'] for x in b]
    v = [x['v'] for x in b]
    L, R, e, n, depth, H, low = (B['L'], B['R'], B['e'], B['n'], B['depth'], B['H'], B['low'])
    low_i = min(range(L, e + 1), key=lambda k: (l[k], k))
    pole = H / min(l[max(0, L - 40):L + 1]) - 1
    handle = R != L and e - R + 1 >= 5 and (h[R] >= low + 0.5 * (H - low))
    if pole >= 0.9 and depth <= 0.25 and (n <= 30):
        return ('High tight flag', 'pole +%d%% in 8 weeks, flag %d%% deep' % (pole * 100, depth * 100), {})
    lows = [k for k in range(L + 2, e - 1) if l[k] <= min(l[max(L, k - 4):k + 5])]
    db = None
    for x in lows:
        for y in lows:
            if y - x >= 10 and l[y] < l[x] and (l[y] >= l[x] * 0.93):
                mid = max(range(x, y + 1), key=lambda k: h[k])
                if h[mid] >= low + 0.5 * (H - low) and min(l[x:y + 1]) >= l[y]:
                    db = (x, y, mid)
    if db and n >= 30 and (0.1 <= depth <= 0.4) and (B['pivot'] <= h[db[2]] * 1.001 + 1e-09):
        return ('Double bottom (undercut)', 'second low undercuts the first; buy point at the middle peak', {'db': db})
    pos = (low_i - L) / max(1, n - 1)
    if n >= 30 and 0.12 <= depth <= 0.4 and (0.25 <= pos <= 0.75):
        third = low + (H - low) / 3
        floor = sum((1 for k in range(L, e + 1) if l[k] <= third))
        if floor >= 0.12 * n:
            if handle and (h[R] - min(l[R:e + 1])) / h[R] <= 0.15:
                return ('Cup with handle', 'U-shaped cup, handle %d bars' % (e - R + 1), {})
            if R == L or h[R] >= H * 0.97:
                return ('Cup without handle', 'U-shaped cup', {})
    seq = contractions(h, l, L, e)
    if len(seq) >= 2:
        dd = [s[2] for s in seq[-3:]]
        if all((dd[k + 1] < dd[k] * 0.85 for k in range(len(dd) - 1))) and dd[-1] <= 0.1:
            return ('VCP', 'contractions ' + ' > '.join(('%d%%' % round(x * 100) for x in dd)), {})
    if depth > 0.4:
        return ('Faulty / wide and loose', '%d%% deep' % round(depth * 100), {})
    if n < 25:
        wk = [c[k] for k in range(e, max(L, e - 15) - 1, -5)][:3]
        if len(wk) == 3 and (max(wk) - min(wk)) / max(wk) <= 0.015:
            return ('Three weeks tight', 'three weekly closes within 1.5%', {})
        return ('Flag / short base', '%.1f weeks, %d%% deep' % (n / 5, round(depth * 100)), {})
    if depth <= 0.15:
        return ('Flat base', '%d%% deep, %.1f weeks' % (round(depth * 100), n / 5), {})
    return ('Square box / consolidation', '%d%% deep, %.1f weeks' % (round(depth * 100), n / 5), {})
