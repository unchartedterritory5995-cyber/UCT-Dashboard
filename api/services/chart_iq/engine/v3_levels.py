# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
from . import v2_levels as VL

def swings(I, lo, i, k):
    h, l = (I.h, I.l)
    hs, ls = ([], [])
    for j in range(max(lo, k), i - k + 1):
        if h[j] >= max(h[j - k:j + k + 1]):
            hs.append(j)
        if l[j] <= min(l[j - k:j + k + 1]):
            ls.append(j)
    return (hs, ls)

def gaps(I, lo, i):
    o, h, l, c = (I.o, I.h, I.l, I.c)
    out = []
    for g in range(max(lo, 1), i + 1):
        gp = o[g] / c[g - 1] - 1
        rv = I.rvol(g)
        if gp >= 0.04 and rv >= 2 or (gp >= 0.03 and c[g] / c[g - 1] - 1 >= 0.08 and (rv >= 3)):
            low_after = min(l[g:i + 1])
            out.append({'g': g, 'gap': gp, 'rv': rv, 'chg': c[g] / c[g - 1] - 1, 'prev_c': c[g - 1], 'day_low': l[g], 'day_close': c[g], 'filled': min(c[g:i + 1]) < c[g - 1], 'held_low': low_after >= l[g] * 0.995, 'ep': gp >= 0.08 and rv >= 3})
    return out

def events(b, i, I, v0, B, tg):
    o, h, l, c = (I.o, I.h, I.l, I.c)
    out = []
    G = gaps(I, max(v0, i - 130), i)
    big = [g for g in G if g['ep'] or (g['chg'] >= 0.1 and g['rv'] >= 3)]
    for g in big:
        g['score'] = g['chg'] * 100 + g['rv'] * 2
    recent = [g for g in big if g['g'] < i - 1 and (not g['filled'])]
    if recent:
        g = max(recent[-3:], key=lambda g: (g['g'] >= i - 60, g['score']))
        k = g['g']
        out.append({'bar': k, 'name': 'Episodic pivot' if g['ep'] else 'Power gap', 'at': 'high', 'prio': 92, 'why': 'gap %+.0f%%, closed %+.0f%% on %.1fx volume' % (g['gap'] * 100, g['chg'] * 100, g['rv'])})
    for g in big:
        if g['g'] >= i - 1:
            k = g['g']
            rng = h[k] - l[k]
            dcr = (c[k] - l[k]) / rng if rng > 0 else 0.5
            if dcr < 0.35 and I.ext50(k) >= 4 or dcr <= 0.2:
                out.append({'bar': k, 'name': 'Gap & fade (climax)', 'at': 'high', 'prio': 97, 'why': 'gapped %+.0f%% on %.1fx volume and closed near the low, %.1f ATR over the 50' % (g['gap'] * 100, g['rv'], I.ext50(k))})
            else:
                out.append({'bar': k, 'name': 'Episodic pivot' if g['ep'] else 'Power gap', 'at': 'high', 'prio': 100, 'why': 'gap %+.0f%%, closed %+.0f%% on %.1fx volume' % (g['gap'] * 100, g['chg'] * 100, g['rv'])})
    k = i
    rng = h[k] - l[k]
    dcr = (c[k] - l[k]) / rng if rng > 0 else 0.5
    if h[k] > h[k - 1] and l[k] < l[k - 1] and (c[k] / c[k - 1] - 1 <= -0.08):
        out.append({'bar': k, 'name': 'Outside reversal', 'at': 'high', 'prio': 96, 'why': 'new high, then closed %.0f%% down' % ((c[k] / c[k - 1] - 1) * 100)})
    elif o[k] / c[k - 1] - 1 >= 0.03 and dcr <= 0.2 and (not any((g['g'] == k for g in big))):
        out.append({'bar': k, 'name': 'Gap & fade (climax)', 'at': 'high', 'prio': 95, 'why': 'gapped up and closed at the low'})
    if B:
        piv = B['pivot']
        if B.get('today') and B['jb'] >= i - 5:
            jb = B['jb']
            thin = c[jb] - piv < 0.15 * I.A(jb)
            out.append({'bar': jb, 'name': 'Breakout attempt' if thin else 'Breakout' if I.rvol(jb) >= 1.2 else 'Breakout (light volume)', 'at': 'high', 'prio': 88, 'why': 'cleared %.2f on %.1fx volume' % (piv, I.rvol(B['jb']))})
        if B.get('failed'):
            out.append({'bar': i, 'name': 'Breakdown', 'at': 'low', 'prio': 86, 'why': 'closed under the base low %.2f' % B['low']})
        for k in range(max(B['L'] + 1, i - 5), i + 1):
            if h[k] > piv * 1.002 and c[k] < piv and (c[i] < piv) and (not B.get('today')):
                out.append({'bar': k, 'name': 'Failed breakout', 'at': 'high', 'prio': 80, 'why': 'traded over %.2f, closed back under it' % piv})
                break
    hs, ls = swings(I, max(v0, i - 100), i, 5)
    for k in range(i, max(v0, i - 15), -1):
        prior = [j for j in ls if j < k - 10 and j >= k - 60]
        if not prior:
            continue
        X = min((l[j] for j in prior[-2:]))
        a = I.A(k)
        rng_k = h[k] - l[k]
        dcr_k = (c[k] - l[k]) / rng_k if rng_k > 0 else 0.5
        if l[k] < X - 0.15 * a and l[k] <= min(l[k - 10:k]) and (max(c[k:min(i, k + 2) + 1]) > X) and (min(c[k:i + 1]) > X - 1.0 * a) and (I.rvol(k) >= 1.3 or (c[k] > X and dcr_k >= 0.6)):
            out.append({'bar': k, 'name': 'Undercut & reclaim', 'at': 'low', 'prio': 82 if k >= i - 8 else 70, 'why': 'undercut the %.2f low and closed back over it%s' % (X, ' on %.1fx volume' % I.rvol(k) if I.rvol(k) >= 1.5 else ''), 'level': X})
            break
    for k in range(i, max(v0, i - 60), -1):
        if any((e['bar'] == k for e in out)):
            continue
        a = I.A(k)
        rv = I.rvol(k)
        rng = h[k] - l[k]
        dcr = (c[k] - l[k]) / rng if rng > 0 else 0.5
        gp = o[k] / c[k - 1] - 1
        chg = c[k] / c[k - 1] - 1
        if 0.05 <= gp and rv >= 2 and (not any((g['g'] == k for g in big))):
            faded = c[k] < c[k - 1]
            out.append({'bar': k, 'name': 'Gap & fade' if faded else 'Gap up', 'at': 'high', 'prio': (70 if faded else 62) if k >= i - 20 else 50, 'why': 'gap %+.1f%% on %.1fx volume%s' % (gp * 100, rv, ', closed %+.1f%%' % (chg * 100) if faded else '')})
        elif gp <= -0.06 and rv >= 2.5:
            out.append({'bar': k, 'name': 'Gap down', 'at': 'low', 'prio': 66 if k >= i - 20 else 52, 'why': 'gap %.1f%% on %.1fx volume' % (gp * 100, rv)})
        elif k >= i - 20 and chg <= -0.05 and (rv >= 2) and (c[k] < min(l[max(v0, k - 20):k - 1]) - 0.5 * a):
            out.append({'bar': k, 'name': 'Breakdown', 'at': 'low', 'prio': 78 if k >= i - 10 else 56, 'why': '%.1f%% on %.1fx volume under the 20-day low' % (chg * 100, rv)})
        elif rv >= 3 and l[k] <= min(l[max(v0, k - 20):k + 1]) and (dcr >= 0.7) and (rng >= 1.5 * a) and (l[k] <= max(h[max(v0, k - 15):k]) * 0.8):
            out.append({'bar': k, 'name': 'Capitulation reversal', 'at': 'low', 'prio': 79 if k >= i - 10 else 57, 'why': 'new 20-day low, closed in the top of a wide bar on %.1fx volume' % rv})
        elif rv >= 3 and h[k] >= max(h[max(v0, k - 20):k + 1]) and (dcr <= 0.3) and (I.ext50(k) >= 5):
            out.append({'bar': k, 'name': 'Climax / reversal', 'at': 'high', 'prio': 74 if k >= i - 10 else 58, 'why': 'new high on %.1fx volume, closed near the low' % rv})
    if B and B.get('earlier') and (B['earlier'] < i - 5):
        out.append({'bar': B['earlier'], 'name': 'Breakout', 'at': 'high', 'prio': 76, 'why': 'cleared %.2f on %.1fx volume' % (B['pivot'], I.rvol(B['earlier']))})
    rename = {'Episodic pivot (EP)': None, 'Breakout day': None, 'Buyable gap-up': 'Buyable gap-up', 'Climax / exhaustion': 'Climax / exhaustion'}
    for t in tg:
        nm = rename.get(t['name'], t['name'])
        if nm is None or t['id'] in ('pocket_pivot', 'launch_pad', 'pullback_ma', 'ma_reclaim', 'undercut_reclaim', 'gap_support'):
            continue
        out.append({'bar': t['bar'], 'name': nm, 'at': t['at'], 'prio': t['prio'], 'why': t['why'], 'draw': t.get('draw')})
    by = {}
    for e in sorted(out, key=lambda e: -e['prio']):
        by.setdefault(e['bar'], []).append(e)
    marks = []
    for k, es in by.items():
        e0 = dict(es[0])
        e0['also'] = [x['name'] for x in es[1:2] if x['name'] != e0['name']]
        marks.append(e0)
    marks.sort(key=lambda e: -e['prio'])
    BEAR = ('Breakdown', 'Failed breakout', 'Gap down', 'Gap & fade (climax)', 'Climax / exhaustion', 'Climax / reversal', 'Outside reversal', 'Gap & fade')
    if any((e['bar'] >= i - 1 and e['name'] in BEAR for e in marks)):
        marks = [e for e in marks if not (e['bar'] >= i - 1 and e['name'] in ('GO signal', 'Slingshot', 'Oops reversal', 'Inside day', 'Double inside day', 'Buyable gap-up', 'Wedge pop'))]
    kept = []
    for e in marks:
        if all((abs(e['bar'] - q['bar']) > 3 for q in kept)):
            kept.append(e)
    marks = kept
    marks = [e for e in marks if e['bar'] >= i - 10 or e['prio'] >= 56]
    return (marks[:3], G)

def levels(b, i, I, v0, B, G, marks):
    o, h, l, c, v = (I.o, I.h, I.l, I.c, I.v)
    close = c[i]
    a = I.A(i)
    cand = []
    hs, ls = swings(I, max(v0, i - 250), i, 5)
    pts = [(h[j], j, 'high') for j in hs] + [(l[j], j, 'low') for j in ls]
    pts.sort()
    used = set()
    for p, j, side in pts:
        if j in used:
            continue
        mem = [(q, jj, s) for q, jj, s in pts if abs(q - p) <= 0.5 * a]
        js = sorted(set((jj for _, jj, _ in mem)))
        if len(js) < 2 and (not (side == 'high' and j < i - 5 and (p == max(h[max(v0, i - 250):i + 1])))):
            continue
        for _, jj, _ in mem:
            used.add(jj)
        q, jj, s = max(mem, key=lambda m: m[1])
        react = len(js)
        touches = sum((1 for k in range(max(v0, i - 250), i + 1) if l[k] <= q + 0.25 * a and h[k] >= q - 0.25 * a))
        score = 2.0 * react + 0.02 * min(touches, 40) + (1.0 if jj >= i - 60 else 0.0)
        if q < close and close / q - 1 > 0.1:
            continue
        cand.append({'price': q, 'k': js[0], 'why': '%d reactions (%s %s)' % (react, b[jj]['t'], 'high' if s == 'high' else 'low'), 'name': None, 'score': score})
    for g in G:
        if g['filled']:
            continue
        if g['g'] >= i - 1:
            if g['ep'] or g['chg'] >= 0.08 or g['gap'] >= 0.06:
                cand.append({'price': g['prev_c'], 'k': g['g'] - 1, 'name': 'Gap fill', 'score': 6.0, 'why': 'close before the %s gap' % b[g['g']]['t']})
            continue
        if g['ep'] or g['chg'] >= 0.08 or g['gap'] >= 0.06:
            cand.append({'price': g['day_low'], 'k': g['g'], 'name': 'Gap-day low', 'score': 6.0 + g['rv'] * 0.2, 'why': 'low of the %s gap day (%+.0f%%, %.1fx)' % (b[g['g']]['t'], g['gap'] * 100, g['rv'])})
            cand.append({'price': g['prev_c'], 'k': g['g'] - 1, 'name': 'Gap fill', 'score': 4.5, 'why': 'close before the %s gap' % b[g['g']]['t']})
            if g['ep'] and g['g'] < i - 4:
                cand.append({'price': g['day_close'], 'k': g['g'], 'name': 'HVC', 'score': 5.0, 'why': 'close of the %s event day (%.1fx volume)' % (b[g['g']]['t'], g['rv'])})
    h3, l3 = swings(I, max(v0, i - 40), i, 3)
    lows = [j for j in l3 if l[j] < close and j <= i - 2]
    if lows:
        j = lows[-1]
        cand.append({'price': l[j], 'k': j, 'name': 'Swing low', 'score': 5.0, 'why': 'last swing low (%s)' % b[j]['t']})
    highs = [j for j in h3 if h[j] > close and j <= i - 2]
    if highs:
        j = highs[-1]
        cand.append({'price': h[j], 'k': j, 'name': 'Swing high', 'score': 4.2, 'why': 'last swing high (%s)' % b[j]['t']})
    lo = max(1, i - 251)
    hv = max(range(lo, i + 1), key=lambda k: v[k])
    if hv <= i - 5 and c[hv] > c[hv - 1]:
        cand.append({'price': c[hv], 'k': hv, 'name': 'HVC', 'score': 4.0, 'why': "close of the year's highest-volume day (%s)" % b[hv]['t']})
    k52 = max(range(lo, i + 1), key=lambda k: h[k])
    if k52 <= i - 5 and close >= 0.88 * h[k52]:
        cand.append({'price': h[k52], 'k': k52, 'name': '52-week high', 'score': 5.5, 'why': 'high of %s' % b[k52]['t']})
    taken = []
    if B:
        taken += [B['pivot'], B['low']] + ([B['early']] if B.get('early') else []) + ([B['top_line']] if B.get('top_line') else [])
    lo_win = min(l[v0:i + 1])
    hi_win = max(h[v0:i + 1])
    sep = max(0.8 * a, 0.04 * (hi_win - lo_win))
    out = {'Resistance': [], 'Support': []}
    for z in sorted(cand, key=lambda z: -z['score']):
        if len(out['Resistance']) + len(out['Support']) >= 3:
            break
        p = z['price']
        if not lo_win <= p <= hi_win:
            continue
        role = 'Resistance' if p > close else 'Support'
        dist = abs(p / close - 1)
        if dist > 0.2 or abs(p - close) < 0.1 * a:
            continue
        if any((abs(p - q) < sep for q in taken)):
            continue
        if len(out[role]) >= 2:
            continue
        out[role].append(dict(z, role=role))
        taken.append(p)
    return out['Resistance'] + out['Support']

def pullback_line(b, i, I):
    h, c = (I.h, I.c)
    k0 = max(range(i - 20, i - 1), key=lambda k: h[k])
    if c[i] > h[k0] or c[i] < h[k0] * 0.8 or i - k0 < 3:
        return None
    best = None
    for j in range(k0 + 6, i):
        if not (h[j] >= max(h[j - 1], h[min(i, j + 1)]) and h[j] < h[k0]):
            continue
        sl = (h[j] - h[k0]) / (j - k0)
        line = lambda k: h[k0] + sl * (k - k0)
        if all((c[k] <= line(k) + 0.05 * I.A(k) for k in range(k0, i))) and all((h[k] <= line(k) + 0.3 * I.A(k) for k in range(k0, j + 1))):
            best = (j, sl)
    if not best:
        return None
    j, sl = best
    broke = i if c[i] > h[k0] + sl * (i - k0) else None
    return {'p1': k0, 'p2': j, 'v1': h[k0], 'v2': h[j], 'broke': broke, 'kind': 'flag'}

def trendlines(b, i, I, B, v0):
    a = I.A(i)
    c = I.c
    out = []
    pl = pullback_line(b, i, I)
    if pl and pl['p1'] >= v0:
        out.append(pl)
    major = None
    for kind in ('down', 'up'):
        t = VL.best_trendline(b, i, kind)
        if not t or t['p1'] < v0:
            continue
        key = 'h' if kind == 'down' else 'l'
        sl = (t['v2'] - t['v1']) / (t['p2'] - t['p1'])
        if any(((b[k][key] - (t['v1'] + sl * (k - t['p1']))) * (1 if kind == 'down' else -1) > 1.5 * I.A(k) for k in range(t['p1'], t['p2']))):
            continue
        if pl and kind == 'down' and (t['p2'] >= pl['p1'] - 2):
            continue
        t['kind'] = kind
        major = t
        break
    if major:
        out.append(major)
    return out
