# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
import math

def atr_series(b, n=14):
    out = [None] * len(b)
    trs = []
    for k in range(len(b)):
        tr = b[k]['h'] - b[k]['l'] if k == 0 else max(b[k]['h'], b[k - 1]['c']) - min(b[k]['l'], b[k - 1]['c'])
        trs.append(tr)
        if k >= n - 1:
            out[k] = sum(trs[k - n + 1:k + 1]) / n
    return out

def pivots(b, i, left, right, lo):
    hs, ls = ([], [])
    for k in range(max(lo, left), i - right + 1):
        H = b[k]['h']
        L = b[k]['l']
        if all((H >= b[j]['h'] for j in range(k - left, k + right + 1) if j != k)):
            hs.append(k)
        if all((L <= b[j]['l'] for j in range(k - left, k + right + 1) if j != k)):
            ls.append(k)
    return (hs, ls)

def sr_levels(b, i, look=250, n_side=2):
    lo = max(0, i - look)
    atr = atr_series(b)[i] or b[i]['c'] * 0.03
    v50 = lambda k: sum((x['v'] for x in b[max(0, k - 50):k])) / max(1, min(50, k)) or 1
    P = []
    for left, right, major in ((10, 5, False), (50, 10, True)):
        hs, ls = pivots(b, i, left, right, lo if not major else max(0, i - 500))
        for k in hs + ls:
            hi = k in hs
            px = b[k]['h'] if hi else b[k]['l']
            w = (1 + min(2.0, b[k]['v'] / v50(k))) * math.exp(-(i - k) / 250.0) * (1.5 if major else 1.0)
            bw = max(b[k]['h'] - b[k]['l'], 0.5 * atr)
            P.append((px, w, bw, k))
    if not P:
        return []
    close = b[i]['c']
    lmin = math.log(min((p[0] for p in P)) * 0.95)
    lmax = math.log(max((p[0] for p in P)) * 1.05)
    steps = 300
    grid = [lmin + (lmax - lmin) * s / steps for s in range(steps + 1)]
    dens = []
    for g in grid:
        d = 0.0
        for px, w, bw, k in P:
            bwl = bw / px
            u = abs(g - math.log(px)) / bwl
            if u < 1:
                d += w * (1 - u)
        dens.append(d)
    peaks = [s for s in range(1, steps) if dens[s] > dens[s - 1] and dens[s] >= dens[s + 1] and (dens[s] > 0)]
    peaks.sort(key=lambda s: -dens[s])
    chosen = []
    for s in peaks:
        p = math.exp(grid[s])
        if all((abs(p - q['mid']) >= 1.5 * atr for q in chosen)):
            mem = [(px, k) for px, w, bw, k in P if abs(math.log(px) - grid[s]) <= max(bw / px, 0.5 * atr / px)]
            ks = sorted(set((k for _, k in mem)))
            if len(ks) < 2:
                continue
            pxs = [px for px, _ in mem]
            half = min(max((max(pxs) - min(pxs)) / 2, 0.15 * atr), 0.5 * atr)
            chosen.append({'mid': p, 'top': p + half, 'bot': p - half, 'n': len(ks), 'score': dens[s], 'first': ks[0], 'last': ks[-1]})
    for z in chosen:
        z['touch'] = sum((1 for k in range(lo, i + 1) if b[k]['l'] <= z['top'] and b[k]['h'] >= z['bot']))
        z['score'] += 0.05 * z['touch']
    above = sorted([z for z in chosen if z['bot'] > close], key=lambda z: z['mid'])
    below = sorted([z for z in chosen if z['top'] < close], key=lambda z: -z['mid'])
    out = []
    for side, role in ((above, 'Resistance'), (below, 'Support')):
        near = [z for z in side if abs(z['mid'] - close) / close <= 0.2][:4]
        near.sort(key=lambda z: -z['score'])
        for z in sorted(near[:n_side], key=lambda z: abs(z['mid'] - close)):
            out.append(dict(z, role=role))
    return out

def best_trendline(b, i, kind, look=200):
    lo = max(0, i - look)
    A = atr_series(b)
    hs, ls = pivots(b, i, 10, 5, lo)
    piv = hs if kind == 'down' else ls
    key = 'h' if kind == 'down' else 'l'
    best = None
    for x in range(len(piv)):
        for y in range(x + 1, len(piv)):
            p1, p2 = (piv[x], piv[y])
            v1, v2 = (b[p1][key], b[p2][key])
            if p2 - p1 < 15 or (kind == 'down' and v1 - v2 < (A[p2] or 0)) or (kind == 'up' and v2 - v1 < (A[p2] or 0)):
                continue
            sl = (v2 - v1) / (p2 - p1)
            line = lambda k: v1 + sl * (k - p1)
            broke = None
            ok = True
            score = 0
            touches = 0
            for k in range(p1, i + 1):
                L = line(k)
                a = A[k] or 0
                body_hi, body_lo = (max(b[k]['o'], b[k]['c']), min(b[k]['o'], b[k]['c']))
                if kind == 'down':
                    if b[k]['c'] > L + 0.1 * a:
                        if k <= p2:
                            ok = False
                            break
                        broke = k
                        break
                    if b[k]['h'] >= L - 0.25 * a and body_hi <= L + 0.1 * a:
                        score += 2
                        touches += 1
                    elif b[k]['l'] > L:
                        score -= 1
                else:
                    if b[k]['c'] < L - 0.1 * a:
                        if k <= p2:
                            ok = False
                            break
                        broke = k
                        break
                    if b[k]['l'] <= L + 0.25 * a and body_lo >= L - 0.1 * a:
                        score += 2
                        touches += 1
                    elif b[k]['h'] < L:
                        score -= 1
            if not ok or touches < 3:
                continue
            if broke is not None and broke < i - 10:
                continue
            if broke is None and abs(b[i]['c'] - line(i)) > 3 * (A[i] or 1):
                continue
            cand = (score + 0.02 * (p2 - p1), p1, p2, broke)
            if best is None or cand > best:
                best = cand
    if not best:
        return None
    _, p1, p2, broke = best
    return {'p1': p1, 'p2': p2, 'v1': b[p1][key], 'v2': b[p2][key], 'broke': broke}
