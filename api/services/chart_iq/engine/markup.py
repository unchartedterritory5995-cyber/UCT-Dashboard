# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
from . import _db
import json, math, os, sqlite3, statistics, sys
HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(HERE)
from . import pivot_v7 as P7
VERSION = 'claude_v1'
RO = _db.bars()

def ymd(t):
    s = str(int(t))
    return '%s-%s-%s' % (s[:4], s[4:6], s[6:])

def bars(sym, asof_ymd, n=520):
    t = int(asof_ymd.replace('-', ''))
    rows = RO.execute("SELECT ts,o,h,l,c,v FROM (SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?) ORDER BY ts", (sym, t, n)).fetchall()
    return [{'t': int(r[0]), 'o': float(r[1]), 'h': float(r[2]), 'l': float(r[3]), 'c': float(r[4]), 'v': float(r[5] or 0)} for r in rows]

def sma(xs, i, n):
    if i - n + 1 < 0:
        return None
    return sum(xs[i - n + 1:i + 1]) / n

def r3(x):
    return round(x, 3)

class Chart:

    def __init__(self, b, view_dates):
        self.b = b
        self.h = [x['h'] for x in b]
        self.l = [x['l'] for x in b]
        self.c = [x['c'] for x in b]
        self.o = [x['o'] for x in b]
        self.v = [x['v'] for x in b]
        self.d = [ymd(x['t']) for x in b]
        self.i = len(b) - 1
        idx = {d: k for k, d in enumerate(self.d)}
        self.v0 = idx.get(view_dates[0], max(0, self.i - len(view_dates) + 1))
        self.atr = [None] + [P7.atr(b, k) for k in range(1, len(b))]

    def a(self, k=None):
        return self.atr[self.i if k is None else k] or self.c[self.i] * 0.03

    def vavg(self, k, n=50):
        s = self.v[max(0, k - n):k]
        return sum(s) / len(s) if s else None

    def rvol(self, k):
        va = self.vavg(k)
        return self.v[k] / va if va else None

    def swings(self, k, lo, hi, kind='h'):
        xs = self.h if kind == 'h' else self.l
        out = []
        for j in range(max(lo, k), hi + 1):
            L = xs[max(0, j - k):j]
            R = xs[j + 1:min(hi + 1, j + k + 1)]
            if not L:
                continue
            if kind == 'h' and xs[j] >= max(L) and (not R or xs[j] >= max(R)):
                out.append(j)
            if kind == 'l' and xs[j] <= min(L) and (not R or xs[j] <= min(R)):
                out.append(j)
        return out

def base_candidates(C, modelbook):
    i, h, l, c = (C.i, C.h, C.l, C.c)
    out = []
    lo_lip = max(C.v0, i - 260)
    for L in range(lo_lip, i - 9):
        H = h[L]
        if H < max(h[max(0, L - 10):L + 1]):
            continue
        j = None
        bad = False
        for k in range(L + 1, i + 1):
            if c[k] > H:
                j = k
                break
            if h[k] > H * 1.03:
                bad = True
                break
        if bad:
            continue
        e = j - 1 if j is not None else i
        if modelbook and j is None:
            e = i - 1
        n = e - L + 1
        if n < 15:
            continue
        low = min(l[L:e + 1])
        depth = (H - low) / H
        if depth < 0.04 or depth > 0.45:
            continue
        pre = l[max(0, L - 65):L + 1]
        adv = H / min(pre) - 1 if pre else 0
        if adv < 0.18:
            continue
        if j is not None and j < i - 40:
            continue
        if j is None and c[i] < low:
            continue
        out.append({'L': L, 'H': H, 'e': e, 'j': j, 'n': n, 'low': low, 'depth': depth, 'adv': adv})
    return out

def pick_base(cands, i):
    if not cands:
        return None
    live = [x for x in cands if x['j'] is None or x['j'] >= i - 5]
    for group in (live, cands):
        for min_n in (25, 15):
            ok = [x for x in group if x['n'] >= min_n]
            if ok:
                return max(ok, key=lambda x: x['L'])
    return None

def prior_base(cands, B):
    ok = [x for x in cands if x['j'] is not None and x['e'] < B['L'] and (x['n'] >= 25)]
    return max(ok, key=lambda x: x['L']) if ok else None

def contractions(C, L, e):
    hs = C.swings(3, L, e, 'h')
    ls = C.swings(3, L, e, 'l')
    seq = []
    for a in hs:
        nxt = [z for z in ls if z > a and (not [q for q in hs if a < q < z])]
        if nxt:
            z = min(nxt, key=lambda q: C.l[q])
            seq.append((a, z, (C.h[a] - C.l[z]) / C.h[a]))
    return seq

def classify(C, B):
    L, e, H, low, depth, n = (B['L'], B['e'], B['H'], B['low'], B['depth'], B['n'])
    h, l = (C.h, C.l)
    low_i = min(range(L, e + 1), key=lambda k: (l[k], k))
    pos = (low_i - L) / max(1, n - 1)
    a = C.a(e)
    res = {'ptype': None, 'pivot': None, 'why': ''}
    pole = H / min(l[max(0, L - 40):L + 1]) - 1
    if pole >= 0.9 and depth <= 0.25 and (10 <= n <= 30):
        return {'ptype': 'High tight flag', 'pivot': H, 'why': 'pole +%d%% into the lip, flag %.0f%% deep' % (pole * 100, depth * 100)}
    ls = [k for k in C.swings(4, L, e, 'l')]
    best = None
    for x in ls:
        for y in ls:
            if y - x < 10 or y <= x:
                continue
            if not (l[y] < l[x] and l[y] >= l[x] * 0.92):
                continue
            mid = max(range(x, y + 1), key=lambda k: h[k])
            if h[mid] < low + 0.5 * (H - low) or h[mid] >= H:
                continue
            if min(l[x:y + 1]) < l[y]:
                continue
            if best is None or y > best[1]:
                best = (x, y, mid)
    if best and n >= 30 and (0.1 <= depth <= 0.4):
        x, y, mid = best
        return {'ptype': 'Double bottom (undercut)', 'pivot': h[mid], 'db': best, 'why': 'second low %.2f undercuts the first %.2f; pivot at the middle peak' % (l[y], l[x])}
    if n >= 35 and 0.12 <= depth <= 0.4 and (0.2 <= pos <= 0.8):
        third = low + (H - low) / 3
        floor_bars = sum((1 for k in range(L, e + 1) if l[k] <= third))
        right_hi = max(h[low_i:e + 1])
        if floor_bars >= 0.12 * n and right_hi >= H * 0.85:
            rs = [k for k in C.swings(3, low_i + 5, e, 'h') if h[k] >= H * 0.85 and h[k] >= low + 0.5 * (H - low)]
            for R in sorted(rs, reverse=True):
                hn = e - R + 1
                hl = min(l[R:e + 1])
                hd = (h[R] - hl) / h[R]
                if 5 <= hn <= 30 and hd <= 0.15 and (hl >= low + 0.5 * (H - low)) and (max(h[R:e + 1]) <= h[R]):
                    return {'ptype': 'Cup with handle', 'pivot': h[R], 'handle': (R, e), 'why': 'U-shaped %.0f%% cup; handle %d bars, %.0f%% deep in the upper half; buy point at the handle high' % (depth * 100, hn, hd * 100)}
            return {'ptype': 'Cup without handle', 'pivot': None, 'why': 'U-shaped %.0f%% cup, no handle yet' % (depth * 100)}
    seq = contractions(C, L, e)
    if len(seq) >= 2:
        tail = seq[-3:] if len(seq) >= 3 else seq[-2:]
        dd = [s[2] for s in tail]
        if all((dd[k + 1] < dd[k] * 0.85 for k in range(len(dd) - 1))) and dd[-1] <= 0.1 and (n >= 20):
            piv = h[tail[-1][0]]
            if piv >= low + 0.5 * (H - low):
                return {'ptype': 'VCP', 'pivot': piv, 'why': 'contractions ' + ' > '.join(('%.0f%%' % (x * 100) for x in dd)) + "; buy point at the final contraction's high"}
    if n < 25 and depth > 0.2:
        return {'ptype': 'Faulty / wide and loose', 'pivot': None, 'why': '%.0f%% deep in only %.1f weeks' % (depth * 100, n / 5)}
    if depth <= 0.15 and n >= 25:
        return {'ptype': 'Flat base', 'pivot': None, 'why': '%.0f%% deep over %.1f weeks' % (depth * 100, n / 5)}
    if depth > 0.35:
        return {'ptype': 'Faulty / wide and loose', 'pivot': None, 'why': '%.0f%% deep' % (depth * 100)}
    return {'ptype': 'Square box / consolidation', 'pivot': None, 'why': '%.0f%% deep over %.1f weeks' % (depth * 100, n / 5)}

def v7_pivot(C, B):
    try:
        k = B['e'] + 1 if B['e'] + 1 <= C.i else C.i
        if k - B['L'] < 3:
            return (B['H'], None)
        res = P7.analyze(C.b, B['L'], k, B['H'], B['low'])
        pk = P7.v7_default(res)
        return (pk['pivot'], pk)
    except Exception:
        return (B['H'], None)

def mined_zones(C):
    i = C.i
    a = C.a()
    piv = []
    for k, kind in ((5, 'h'), (5, 'l'), (15, 'h'), (15, 'l')):
        for j in C.swings(k, max(0, i - 300), i - 2, kind):
            px = C.h[j] if kind == 'h' else C.l[j]
            w = C.l[max(0, j - k):j + k + 1] if kind == 'h' else C.h[max(0, j - k):j + k + 1]
            swing = px - min(w) if kind == 'h' else max(w) - px
            if swing >= 1.5 * C.a(j):
                piv.append((px, j, k))
    piv.sort()
    zones, cur = ([], [])
    for p in piv:
        if cur and p[0] - cur[0][0] > max(0.5 * a, 0.006 * p[0]):
            zones.append(cur)
            cur = []
        cur.append(p)
    if cur:
        zones.append(cur)
    out = []
    for z in zones:
        idxs = sorted(set((j for _, j, _ in z)))
        touches = [idxs[0]]
        for j in idxs[1:]:
            if j - touches[-1] >= 5:
                touches.append(j)
        if len(touches) < 2:
            continue
        lo = min((p for p, _, _ in z))
        hi = max((p for p, _, _ in z))
        midp = (lo + hi) / 2
        width = min(max(hi - lo, 0.3 * a), 1.0 * a)
        score = len(touches) + sum((1 for _, _, k in z if k == 15)) * 0.5 + (1.0 if max(touches) > i - 60 else 0)
        out.append({'mid': midp, 'top': midp + width / 2, 'bot': midp - width / 2, 'touches': touches, 'score': score})
    return out

def latest_gap(C, lookback=60):
    i = C.i
    best = None
    for k in range(max(1, i - lookback), i + 1):
        g = C.o[k] / C.c[k - 1] - 1
        rv = C.rvol(k) or 0
        if g >= 0.04 and C.l[k] > C.h[k - 1] * 0.995 and (rv >= 2.0):
            best = k
    return best

def downtrend_line(C, L, e):
    h = C.h
    sw = [k for k in C.swings(3, L + 3, e, 'h')]
    best = None
    for s in sw:
        if s - L < 8 or h[s] >= h[L]:
            continue
        slope = (h[s] - h[L]) / (s - L)
        a = C.a(s)
        line = lambda k: h[L] + slope * (k - L)
        if any((h[k] > line(k) + 0.3 * C.a(k) for k in range(L + 1, s + 1))):
            continue
        t = [k for k in sw if L < k <= s and abs(h[k] - line(k)) <= 0.5 * C.a(k)]
        if len(t) + 1 < 3:
            continue
        cand = (len(t), s, slope)
        if best is None or cand > best:
            best = cand
    if not best:
        return None
    _, s, slope = best
    line_now = h[L] + slope * (C.i - L)
    crossed = [k for k in range(s + 1, C.i + 1) if C.c[k] > h[L] + slope * (k - L)]
    if crossed and crossed[0] < C.i - 10:
        return None
    return {'L': L, 's': s, 'slope': slope, 'now': line_now, 'broke': crossed[0] if crossed else None}

def chart_downtrend(C):
    i, h = (C.i, C.h)
    sw = C.swings(5, max(C.v0, i - 150), i - 3, 'h')
    best = None
    for x in sw:
        for s in sw:
            if s - x < 15 or h[s] >= h[x]:
                continue
            slope = (h[s] - h[x]) / (s - x)
            line = lambda k: h[x] + slope * (k - x)
            if any((h[k] > line(k) + 0.3 * C.a(k) for k in range(x + 1, i + 1) if k <= s)):
                continue
            t = [k for k in sw if x < k <= s and abs(h[k] - line(k)) <= 0.5 * C.a(k)]
            if len(t) + 1 < 3:
                continue
            now = line(i)
            if abs(C.c[i] - now) > 3 * C.a():
                continue
            crossed = [k for k in range(s + 1, i + 1) if C.c[k] > line(k)]
            if crossed and crossed[0] < i - 10:
                continue
            cand = (len(t), -x, s, slope, x)
            if best is None or cand > best:
                best = cand
    if not best:
        return None
    _, _, s, slope, x = best
    return {'L': x, 's': s, 'slope': slope}

def candle_tags(C, pivot, base):
    i, o, h, l, c, v = (C.i, C.o, C.h, C.l, C.c, C.v)
    tags = []

    def body(k):
        return abs(c[k] - o[k])

    def rng(k):
        return max(1e-09, h[k] - l[k])
    lo_k = max(C.v0, i - 60)
    if pivot is not None and base is not None:
        for k in range(base['e'] + 1, i + 1):
            if c[k] > pivot and c[k - 1] <= pivot:
                rv = C.rvol(k) or 0
                tags.append((10, k, 'Breakout day', 'low' if False else 'high', 'volume %.1fx the 50-day average' % rv))
                break
    for k in range(max(1, lo_k), i + 1):
        g = o[k] / c[k - 1] - 1
        rv = C.rvol(k) or 0
        if g >= 0.03 and l[k] > h[k - 1] and (rv >= 1.5):
            if c[k - 1] < o[k - 1] and o[k] > o[k - 1]:
                tags.append((9, k, 'Kicker', 'high', 'gap %.1f%%, prior bar down' % (g * 100)))
            else:
                tags.append((8 if k >= i - 20 else 5, k, 'Gap up', 'high', 'gap %.1f%%, volume %.1fx' % (g * 100, rv)))
        elif g <= -0.04 and h[k] < l[k - 1] and (rv >= 1.5):
            tags.append((6 if k >= i - 20 else 3, k, 'Gap down', 'low', 'gap %.1f%%' % (g * 100)))
    pp = []
    for k in range(max(11, i - 25), i + 1):
        if c[k] > c[k - 1] and c[k] > o[k]:
            downs = [v[j] for j in range(k - 10, k) if c[j] < c[j - 1]]
            s50 = sma(c, k, 50)
            if downs and v[k] > max(downs) and s50 and (c[k] >= s50) and ((c[k] - s50) / s50 <= 0.1):
                pp.append(k)
    for k in pp[-2:]:
        tags.append((7, k, 'Pocket pivot', 'high', 'volume above every down day of the prior 10'))
    for k in range(max(C.v0 + 10, i - 15), i + 1):
        prior = [j for j in C.swings(4, k - 40, k - 3, 'l')]
        if not prior:
            continue
        sl = l[max(prior, key=lambda j: j)]
        if l[k] < sl and c[k] > sl and ((c[k] - l[k]) / rng(k) >= 0.5):
            tags.append((8, k, 'Undercut & reclaim', 'low', 'undercut %.2f and closed back above' % sl))
            break
    k = i
    if h[k] < h[k - 1] and l[k] > l[k - 1]:
        if h[k - 1] < h[k - 2] and l[k - 1] > l[k - 2]:
            tags.append((8, k, 'Double inside day', 'high', 'two inside days in a row'))
        else:
            tags.append((7, k, 'Inside day', 'high', 'range inside the prior bar'))
    elif rng(k) <= min((rng(j) for j in range(k - 6, k))):
        tags.append((6, k, 'NR7', 'high', 'narrowest range of 7'))
    for k in range(i - 2, i + 1):
        lw = min(o[k], c[k]) - l[k]
        uw = h[k] - max(o[k], c[k])
        down_into = c[k - 1] < c[max(0, k - 6)]
        if down_into and lw >= 2 * max(body(k), 0.1 * rng(k)) and (uw <= 0.3 * rng(k)) and ((c[k] - l[k]) / rng(k) >= 0.6):
            tags.append((6, k, 'Hammer', 'low', 'long lower shadow after a pullback'))
        if c[k - 1] < o[k - 1] and c[k] > o[k] and (o[k] <= c[k - 1]) and (c[k] >= o[k - 1]) and (body(k) > body(k - 1)) and down_into:
            tags.append((6, k, 'Bullish engulfing', 'low', 'body engulfs the prior down bar'))
        if uw >= 2 * max(body(k), 0.1 * rng(k)) and lw <= 0.25 * rng(k) and (c[k - 1] > c[max(0, k - 6)]) and (h[k] >= max(h[max(0, k - 20):k + 1])):
            tags.append((5, k, 'Shooting star', 'high', 'long upper shadow at a high'))
    vk = max(range(C.v0, i + 1), key=lambda j: v[j])
    if c[vk] >= c[vk - 1]:
        tags.append((4, vk, 'High volume close (HVC)', 'high', 'highest volume on the chart'))
    s50 = sma(c, i, 50)
    if s50 and c[i] > s50 * 1.4:
        ck = max(range(i - 10, i + 1), key=lambda j: (c[j] - c[j - 1]) / c[j - 1])
        if (c[ck] - c[ck - 1]) / c[ck - 1] >= 0.06:
            tags.append((7, ck, 'Climax / exhaustion', 'high', 'largest up day %.0f%% above the 50-day' % ((c[i] / s50 - 1) * 100)))
    by = {}
    for t in tags:
        if t[1] < C.v0:
            continue
        if t[1] not in by or t[0] > by[t[1]][0]:
            by[t[1]] = t
    keep = sorted(by.values(), key=lambda t: (-t[0], -t[1]))[:6]
    return sorted(keep, key=lambda t: t[1])
SETUP_OF_TYPE = {'Flat base': 'flat_top_breakout', 'Cup with handle': 'cup_handle', 'Cup without handle': 'cup_handle', 'Double bottom (undercut)': 'double_bottom', 'VCP': 'vcp', 'High tight flag': 'flag_htf'}

def markup(ent):
    E = ent['edit']
    dates = E['bars']['dates']
    sym, asof = (ent['ticker'], dates[-1])
    b = bars(sym, asof)
    if len(b) < 120 or ymd(b[-1]['t']) != asof:
        return (None, 'no bars')
    C = Chart(b, dates)
    i = C.i
    a = C.a()
    pp = (E['price']['top'] - E['price']['bottom']) / (E['plot']['y1'] - E['plot']['y0'])
    modelbook = ent['id'].startswith('m')
    objs, read, setups = ([], [], [])
    oid = [0]

    def nid(p):
        oid[0] += 1
        return 'c%s%d' % (p, oid[0])

    def D(k):
        return C.d[max(C.v0, min(C.i, k))]
    close = C.c[i]
    s50, s200 = (sma(C.c, i, 50), sma(C.c, i, 200))
    s200_prev = sma(C.c, i - 20, 200)
    hi52 = max(C.h[max(0, i - 251):i + 1])
    lo52 = min(C.l[max(0, i - 251):i + 1])
    cands = base_candidates(C, modelbook)
    B = pick_base(cands, i)
    PB = prior_base(cands, B) if B else None
    pivot = state = None
    base_obj = None
    if B:
        cl = classify(C, B)
        vp, pk = v7_pivot(C, B)
        if PB and cl['ptype'] in ('Square box / consolidation', 'Flat base', 'Faulty / wide and loose'):
            pv_prev = PB['H']
            if 0 < B['H'] / pv_prev - 1 < 0.2 and B['low'] >= pv_prev * 0.92:
                cl = dict(cl, ptype='Base-on-base', why='built on top of the prior base (pivot %.2f) before a 20%% advance' % pv_prev)
        pivot = cl['pivot'] if cl['pivot'] is not None else vp
        spike_moved = cl['pivot'] is None and pk and pk.get('spike') and (vp < B['H'] - 1e-09)
        ext = (close - pivot) / pivot
        if ext > 0.2:
            read.append('Last base (%s, buy point %.2f) is %.0f%% behind price: too extended to draw.' % (cl['ptype'], pivot, ext * 100))
            B, pivot = (None, None)
        if B:
            broke = C.c[i] > pivot or any((C.c[k] > pivot for k in range(B['e'] + 1, i + 1)))
            state = 'extended' if ext > 0.05 and broke else 'breakout' if broke and ext >= 0 else 'plain'
            vd = C.vavg(B['e'] + 1, 10) / (C.vavg(B['L'], 50) or 1) if B['e'] > B['L'] + 10 else 1
            faulty = cl['ptype'] == 'Faulty / wide and loose'
            trend_ok = s200 and close > s200 and (s200_prev is None or s200 >= s200_prev)
            bg = 'C' if faulty or not trend_ok else 'A' if vd < 0.85 and B['depth'] <= 0.3 and (cl['ptype'] not in ('Square box / consolidation',)) else 'B'
            if cl.get('db'):
                x, y, mid = cl['db']
                base_obj = {'id': nid('d'), 'added': True, 'src': VERSION, 'kind': 'double_bottom', 'ptype': cl['ptype'], 'grade': bg, 'pivot': r3(pivot), 'low1': r3(C.l[x]), 'low1_date': D(x), 'low2': r3(C.l[y]), 'low2_date': D(y), 'start': D(B['L']), 'pivot_start': D(mid), 'end': D(B['e']), 'pivot_ext_px': 40}
            else:
                base_obj = {'id': nid('b'), 'added': True, 'src': VERSION, 'kind': 'base', 'ptype': cl['ptype'], 'grade': bg, 'start': D(B['L']), 'end': D(B['e']), 'line': r3(pivot), 'buy_point': r3(pivot), 'low': r3(B['low']), 'state': state, 'line_ext_px': 40}
            objs.append(base_obj)
            if B['L'] < C.v0:
                base_obj['start'] = D(C.v0)
            st_txt = {'extended': 'extended %.1f%% past the buy point' % (ext * 100), 'breakout': 'in the buy zone, %.1f%% above the buy point' % (ext * 100), 'plain': '%.1f%% below the buy point' % (-ext * 100)}[state]
            read.append('%s, %.0f%% deep, %.1f weeks (%s); buy point %.2f, %s.' % (cl['ptype'], B['depth'] * 100, B['n'] / 5, cl['why'], pivot, st_txt))
            if pivot < B['H'] * 0.995:
                objs.append({'id': nid('h'), 'added': True, 'src': VERSION, 'kind': 'hline', 'ptype': 'Resistance', 'price': r3(B['H']), 'start': D(B['L'])})
                read.append('Base top %.2f stays overhead%s.' % (B['H'], ' (the high was a spike, so the buy point is the ceiling under it)' if spike_moved else ''))
            if SETUP_OF_TYPE.get(cl['ptype']):
                setups.append(SETUP_OF_TYPE[cl['ptype']])
            if state == 'extended':
                setups.append('extended')
            tl = downtrend_line(C, B['L'], B['e'] if B['j'] is None else B['e'])
            if tl:
                objs.append({'id': nid('t'), 'added': True, 'src': VERSION, 'kind': 'trendline', 'ptype': 'Downtrend line (lower highs)', 'd1': D(tl['L']), 'p1': r3(C.h[tl['L']]), 'd2': D(tl['s']), 'p2': r3(C.h[tl['s']]), 'extend': True})
                read.append('Down trendline across the base highs is the early entry%s.' % (' (crossed on %s)' % C.d[tl['broke']] if tl['broke'] else ', now near %.2f' % tl['now']))
                setups.append('trendline_break')
    else:
        tl = chart_downtrend(C)
        if tl:
            objs.append({'id': nid('t'), 'added': True, 'src': VERSION, 'kind': 'trendline', 'ptype': 'Downtrend line (lower highs)', 'd1': D(tl['L']), 'p1': r3(C.h[tl['L']]), 'd2': D(tl['s']), 'p2': r3(C.h[tl['s']]), 'extend': True})
            read.append('No qualifying base at the right edge; the down trendline across the last swing highs is the level to watch.')
        else:
            read.append('No qualifying base at the right edge.')
    levels = []
    if pivot is not None:
        levels.append(pivot)
    if B and pivot < B['H'] * 0.995:
        levels.append(B['H'])
    far = lambda p: all((abs(p - q) >= 1.0 * a for q in levels))
    above = lambda: sum((1 for q in levels if q > close))
    below = lambda: sum((1 for q in levels if q <= close))
    if hi52 > close and (hi52 - close) / close <= 0.15 and far(hi52):
        k52 = max(range(max(0, i - 251), i + 1), key=lambda k: C.h[k])
        objs.append({'id': nid('h'), 'added': True, 'src': VERSION, 'kind': 'hline', 'ptype': '52-week high', 'price': r3(hi52), 'start': D(k52)})
        levels.append(hi52)
    gk = latest_gap(C)
    if gk is not None and C.l[gk] < close and far(C.l[gk]) and (below() < 3):
        objs.append({'id': nid('h'), 'added': True, 'src': VERSION, 'kind': 'hline', 'ptype': 'Gap level', 'price': r3(C.l[gk]), 'start': D(gk)})
        levels.append(C.l[gk])
        read.append("Gap-day low %.2f (%s) is the gap's support." % (C.l[gk], C.d[gk]))
    zs = mined_zones(C)
    sup = sorted([z for z in zs if z['top'] < close and (close - z['mid']) / close <= 0.12 and far(z['mid'])], key=lambda z: -z['score'])
    res = sorted([z for z in zs if z['bot'] > close and (z['mid'] - close) / close <= 0.12 and far(z['mid'])], key=lambda z: -z['score'])
    for z, role, room in ((sup[0] if sup else None, 'Support', below() < 3), (res[0] if res else None, 'Resistance', above() < 3)):
        if z and room and far(z['mid']):
            objs.append({'id': nid('z'), 'added': True, 'src': VERSION, 'kind': 'zone', 'role': role, 'ptype': 'Support' if role == 'Support' else 'Resistance', 'top': r3(z['top']), 'bot': r3(z['bot']), 'start': D(z['touches'][0]), 'end': D(i), 'state': 'intact', 'end_ext_px': 40})
            levels.append(z['mid'])
            read.append('%s zone %.2f-%.2f (%d touches).' % (role, z['bot'], z['top'], len(z['touches'])))
    for pr, k, name, where, why in candle_tags(C, pivot, B):
        y = C.h[k] + 16 * pp if where == 'high' else C.l[k] - 10 * pp
        objs.append({'id': nid('k'), 'added': True, 'src': VERSION, 'kind': 'candle', 'ptype': name, 'pts': [{'d': C.d[k], 'p': r3(y)}], 'why': why})
        if name in ('Pocket pivot',):
            setups.append('pocket_pivot')
        if name in ('Kicker',):
            setups.append('kicker')
        if name == 'Undercut & reclaim':
            setups.append('undercut_reclaim')
        if name in ('Inside day', 'Double inside day') and k == i:
            setups.append('inside_day')
        if name == 'Gap up' and k >= i - 2:
            g = C.o[k] / C.c[k - 1] - 1
            setups.append('ep' if g >= 0.08 and (C.rvol(k) or 0) >= 3 else 'buyable_gap_up')
        if name == 'Climax / exhaustion':
            setups.append('parabolic_short')
    near_high = close >= 0.95 * hi52
    template = bool(s50 and s200 and (close > s50 > s200) and (s200_prev is None or s200 >= s200_prev) and (close >= 0.75 * hi52) and (close >= 1.3 * lo52))
    if template and near_high:
        setups.append('rs_leader')
    if s50 and s200 and (close < s200) and (close < s50):
        setups.append('broken')
    e10 = sma(C.c, i, 10)
    e21 = sma(C.c, i, 21)
    if template and (not B):
        for nm, ma in (('10-day', e10), ('21-day', e21), ('50-day', s50)):
            if ma and 0 <= (close - ma) / ma <= 0.02 and (C.l[i] <= ma * 1.01):
                setups.append('pullback_ma')
                read.append('Pulling back to the %s line (%.2f).' % (nm, ma))
                break
    w = 10
    rng10 = (max(C.h[i - w + 1:i + 1]) - min(C.l[i - w + 1:i + 1])) / close
    if template and rng10 <= 0.08 and e10 and e21 and (e10 >= e21) and (close >= 0.9 * hi52):
        setups.append('launch_pad')
        read.append('Tight %.0f%% range over 10 bars sitting on the rising 10/21-day lines.' % (rng10 * 100))
    if ent.get('type', '').startswith('playbook:'):
        setups.append(ent['type'].split(':', 1)[1])
    setups = list(dict.fromkeys(setups))
    if 'broken' in setups or not (s200 and close > s200):
        grade = 'Not a setup' if not B else 'C'
    elif B and template and (base_obj.get('grade') == 'A') and (state in ('plain', 'breakout')):
        grade = 'A'
    elif B and template:
        grade = 'B'
    elif template:
        grade = 'B' if any((s in setups for s in ('pullback_ma', 'launch_pad', 'inside_day', 'pocket_pivot', 'buyable_gap_up', 'ep', 'kicker'))) else 'C'
    else:
        grade = 'C'
    if 'parabolic_short' in setups:
        trade = 'pass'
    elif B and state == 'breakout':
        trade = 'buy'
    elif B and state == 'plain' and ((pivot - close) / pivot <= 0.05) and (grade in ('A', 'B')):
        trade = 'watch'
    elif not B and grade == 'B':
        trade = 'watch'
    else:
        trade = 'pass'
    if B and state == 'extended':
        trade = 'pass'
    read.append({'buy': 'Buy: in the buy zone.', 'watch': 'Watch for the entry.', 'pass': 'Pass for now.'}[trade] + (' Trend template intact.' if template else ' Trend template not intact.'))
    return ({'objects': objs, 'labels': {'setups': setups, 'grade': grade, 'trade': trade}, 'read': ' '.join(read), 'version': VERSION}, 'ok')
