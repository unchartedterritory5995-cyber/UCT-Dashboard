# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = 'claude_v4'
LINE_RECENT, MARK_RECENT, BASE_RECENT, LEVEL_BAND = (60, 30, 20, 0.15)
PRIO = {'Breakout retest': 0, 'Base breakout': 0, 'Recent hold': 0, 'Buy point': 0, 'Early entry': 0, 'Buy point / pivot': 0, 'Gap-day low': 1, 'Gap fill': 1, 'Support': 2, 'Swing low': 2, 'Resistance': 2, 'Swing high': 2, '52-week high': 3, 'HVC': 3, 'Base top': 3}
OFF_HIGHS = ('Downtrend line', 'Flag line (early entry)', 'Pullback line')

def recent_hold(b, c, look=20, tol=0.025, min_touch=2):
    n = len(b)
    lows = []
    for k in range(max(2, n - look), n):
        left = all((b[k]['l'] <= b[j]['l'] for j in range(k - 2, k)))
        right = all((b[k]['l'] < b[j]['l'] for j in range(k + 1, min(n, k + 3))))
        if left and right and (b[k]['l'] < c):
            lows.append((b[k]['l'], k))
    best = None
    for p0, _ in lows:
        grp = [(p, k) for p, k in lows if abs(p / p0 - 1) <= tol]
        if len(grp) >= min_touch and (best is None or len(grp) > len(best) or (len(grp) == len(best) and max((k for _, k in grp)) > max((k for _, k in best)))):
            best = grp
    if not best:
        return None
    ps = sorted((p for p, _ in best))
    return (ps[len(ps) // 2], len(best), min((k for _, k in best)))

def recent_flag(b, look=25, pole=0.2, min_len=5):
    n = len(b)
    hi = max(range(n - look, n), key=lambda k: b[k]['h'])
    if n - 1 - hi < min_len:
        return None
    base_lo = min((x['l'] for x in b[max(0, hi - 30):hi]))
    if b[hi]['h'] < base_lo * (1 + pole):
        return None
    slope = max(((b[k]['h'] - b[hi]['h']) / (k - hi) for k in range(hi + 1, n)))
    if slope >= 0:
        return None
    return (hi, b[hi]['h'], n - 1, b[hi]['h'] + slope * (n - 1 - hi))

def ema(xs, n):
    out, a, k = ([], None, 2 / (n + 1))
    for x in xs:
        a = x if a is None else a + k * (x - a)
        out.append(a)
    return out

def strict_vcp(b, k0, k1):
    from . import v3_bases as B3
    h, l = ([x['h'] for x in b], [x['l'] for x in b])
    if k1 - k0 < 20:
        return False
    seq = B3.contractions3(h, l, k0, k1)
    dd = [x[2] for x in seq]
    if len(dd) < 3 or dd[0] < 0.1 or dd[-1] > 0.1 or any((dd[j + 1] > dd[j] * 0.8 for j in range(len(dd) - 1))):
        return False
    va = sum((x['v'] for x in b[k0:k1 + 1])) / (k1 - k0 + 1)
    last = b[seq[-1][0]:k1 + 1]
    return sum((x['v'] for x in last)) / len(last) <= 0.9 * va

def too_sharp(b, k, bars=3, atrs=3.3):
    hi = max((x['h'] for x in b[max(0, k - bars):k]))
    tr = [max(b[j]['h'], b[j - 1]['c']) - min(b[j]['l'], b[j - 1]['c']) for j in range(max(1, k - 13), k + 1)]
    a = sum(tr) / len(tr) if tr else 0
    return bool(a) and (hi - b[k]['l']) / a > atrs

def unr_20ema(b, e20, look=30):
    for k in range(len(b) - 1, max(25, len(b) - look) - 1, -1):
        if 0.96 * e20[k] <= b[k]['l'] < e20[k] < b[k]['c'] and e20[k] > e20[k - 5] and all((b[j]['c'] > e20[j] for j in range(k - 5, k))) and (b[k]['l'] < min((x['l'] for x in b[k - 10:k]))) and (not too_sharp(b, k)):
            return k
    return None

def strict_cup(b, k0, k1):
    n = k1 - k0 + 1
    if n < 30:
        return None
    h, l = ([x['h'] for x in b[k0:k1 + 1]], [x['l'] for x in b[k0:k1 + 1]])
    rim = max(h[:n // 3])
    m = min(range(n), key=lambda j: l[j])
    lo = l[m]
    d = (rim - lo) / rim
    if not (0.12 <= d <= 0.4 and n // 4 <= m <= 3 * n // 4) or sum((1 for x in l if x <= lo + 0.25 * (rim - lo))) < 5:
        return None
    r = max(range(m, n), key=lambda j: h[j])
    if h[r] < lo + 0.9 * (rim - lo):
        return None
    hl = min(l[r:]) if r < n - 1 else h[r]
    if 5 <= n - 1 - r <= 25 and hl >= lo + 0.6 * (rim - lo) and ((h[r] - hl) / h[r] <= 0.15):
        return 'Cup with handle'
    return 'Cup without handle' if n - 1 - r < 5 else None

def breakout_retest(b, c, look=120):
    n = len(b)
    best = None
    for s_ in range(max(3, n - look), n - 8):
        H = b[s_]['h']
        if not all((b[j]['h'] <= H for j in range(s_ - 3, min(n, s_ + 4)) if j != s_)):
            continue
        brk = next((j for j in range(s_ + 1, n) if b[j]['c'] > H * 1.01), None)
        if brk is None or any((b[j]['c'] > H * 1.15 for j in range(s_ + 1, brk))):
            continue
        tch = []
        for j in range(max(0, s_ - 30), brk):
            if H * 0.98 <= b[j]['h'] <= H * 1.02 and (not tch or j - tch[-1] >= 3):
                tch.append(j)
        if len(tch) < 3:
            continue
        rt = [j for j in range(brk + 2, n) if H * 0.97 <= b[j]['l'] <= H * 1.015 and b[j]['c'] >= H * 0.99]
        if not rt or any((b[j]['c'] < H * 0.97 for j in range(brk, n))) or c < H * 1.03:
            continue
        if best is None or (len(tch), rt[-1]) > (best[3], best[2]):
            best = (H, s_, rt[-1], len(tch))
    return best[:3] if best else None

def base_breakout(b, c, look=120):
    n = len(b)
    found = []
    for k in range(n - 1, max(61, n - look), -1):
        for L in (60, 40, 25):
            w = b[k - L:k]
            top = max((x['h'] for x in w))
            lo = min((x['l'] for x in w))
            if b[k]['c'] > top >= b[k - 1]['c'] and max(range(k - L, k), key=lambda j: b[j]['h']) <= k - 5 and ((top - lo) / top <= 0.5) and (b[k]['v'] >= 1.4 * sum((x['v'] for x in w)) / L) and (top < c) and (top >= 0.5 * c):
                if all((abs(top / t - 1) > 0.05 for _, _, t in found)):
                    found.append((k, k - L, top))
                break
        if len(found) == 2:
            break
    return found

def touch_start(b, p, k, back=150, tol=0.01, max_gap=30):
    first, k0 = (k, max(0, k - back))
    for j in range(k, k0 - 1, -1):
        if b[j]['l'] <= p * (1 + tol) and b[j]['h'] >= p * (1 - tol):
            first = j
        elif first - j > max_gap:
            break
    return first

def ep_ok(b, k):
    w = b[max(0, k - 60):k]
    if not w or b[k - 1]['c'] > 1.3 * min((x['l'] for x in w)):
        return False
    hi, lo = (max((x['h'] for x in w)), min((x['l'] for x in w)))
    av = sum((x['v'] for x in w[-50:])) / len(w[-50:])
    w6 = b[max(0, k - 120):k]
    lo6 = min((x['l'] for x in w6))
    return hi / lo - 1 <= 0.35 and abs(b[k - 1]['c'] / w[0]['c'] - 1) <= 0.15 and (b[k]['o'] / b[k - 1]['c'] - 1 >= 0.1) and (b[k]['v'] >= 3 * av) and (len(w6) >= 100) and (max((x['h'] for x in w6)) / lo6 - 1 <= 0.5) and (b[k - 1]['c'] <= 1.3 * lo6)

def kicker_ok(b, k):
    from . import v44_read as R4
    return R4.kicker(b, k)

def earnings_gap(b, c):
    best = None
    for k in range(51, len(b)):
        av = sum((x['v'] for x in b[k - 50:k])) / 50
        if not av or not (b[k]['l'] > b[k - 1]['h'] or b[k]['o'] >= b[k - 1]['c'] * 1.05):
            continue
        vm = b[k]['v'] / av
        if vm >= 3 and c > b[k]['c'] and (best is None or vm > best[3]):
            best = (k, b[k]['l'], b[k]['c'], vm)
    return best

def compose(cid, man, v3, ltb, dje):
    E = man['edit']
    dates = E['bars']['dates']
    ix = {d: k for k, d in enumerate(dates)}
    i = len(dates) - 1
    age = lambda d: i - ix[d] if d in ix else 10 ** 6
    src = (v3.get(cid) or {}).get('objects', [])
    out, levels = ([], [])
    bars_close = man.get('_close')
    for o in src:
        k = o['kind']
        if k in ('base', 'double_bottom'):
            if age(o.get('end') or dates[-1]) <= BASE_RECENT:
                out.append(o)
        elif k == 'trendline':
            if o.get('ptype') in OFF_HIGHS and age(o['d2']) <= LINE_RECENT:
                out.append(o)
        elif k == 'candle':
            if age(o['pts'][0]['d']) <= MARK_RECENT:
                out.append(o)
        elif k == 'hline':
            levels.append(o)
    B = man.get('_bars') or []
    off = len(B) - 1 - i
    e20 = ema([x['c'] for x in B], 20) if B else []

    def unr_ok(o):
        k = ix.get(o['pts'][0]['d'], -1) + off
        return 0 <= k < len(B) and 0.96 * e20[k] <= B[k]['l'] <= 1.02 * e20[k]
    keepc = []
    for o in out:
        if o['kind'] == 'candle':
            k = ix.get(o['pts'][0]['d'], -1) + off
            if any((w in str(o.get('ptype')) for w in ('Tasuki', 'Tweezer', 'Harami', 'Hanging Man', 'Engulfing', 'Three Outside', 'Three Inside', 'Matching Low', 'Inverted Hammer', 'Doji', 'Spinning', 'Marubozu'))):
                continue
            if o.get('ptype') == 'Gap up':
                continue
            if o.get('ptype') == 'Episodic pivot' and 0 < k < len(B) and (not ep_ok(B, k)):
                av_ = sum((x['v'] for x in B[max(0, k - 50):k])) / max(1, min(50, k))
                hv = B[k]['v'] >= 3 * av_ and B[k]['v'] >= max((x['v'] for x in B[max(0, k - 60):k]))
                o = dict(o, ptype='ER gap · HVC %.2f' % B[k]['c'] if hv else 'ER gap', why='big-volume gap, not out of neglect (likely earnings)' + ("; the gap day's close is the HVC" if hv else ''))
            if o.get('ptype') == 'Kicker' and 0 < k < len(B) and (not kicker_ok(B, k)):
                continue
            if str(o.get('ptype')).startswith('Gap & fade'):
                continue
            if o.get('ptype') == 'Power gap':
                o = dict(o, ptype='Gap up', why=o.get('why', ''))
        keepc.append(o)
    out = keepc
    for o in out:
        if o['kind'] == 'candle' and o.get('ptype') == 'Undercut & reclaim' and unr_ok(o):
            o['ptype'] = 'Undercut & reclaim at 20EMA'
    for o in out:
        if o['kind'] == 'base' and str(o.get('ptype')).startswith('Cup'):
            k0, k1 = (ix.get(o.get('start'), -1) + off, ix.get(o.get('end') or dates[-1], -1) + off)
            o['ptype'] = (strict_cup(B, k0, k1) if k0 >= off else None) or 'Base'
        if o['kind'] == 'base' and o.get('ptype') == 'VCP':
            k0, k1 = (ix.get(o.get('start'), -1) + off, ix.get(o.get('end') or dates[-1], -1) + off)
            if not (k0 >= off and strict_vcp(B, k0, k1)):
                lo, top = (o.get('low'), o.get('line'))
                o['ptype'] = 'Flat base' if lo and top and ((top - lo) / top <= 0.15) else 'Consolidation / range'
    ku = unr_20ema(B, e20) if len(B) >= 40 else None
    if ku is not None and ku - off >= 0 and (not any((o['kind'] == 'candle' and o['pts'][0]['d'] == dates[ku - off] for o in out))):
        out.append({'kind': 'candle', 'ptype': 'Undercut & reclaim at 20EMA', 'at': 'low', 'also': [], 'pts': [{'d': dates[ku - off], 'p': round(B[ku]['l'], 4)}], 'why': 'dipped under the rising 20EMA and closed back above', 'src': VERSION})
    from . import v44_read as R4
    B2 = man.get('_bars_long') or B
    off2 = len(B2) - 1 - i
    X2 = R4.ctx(B2)
    events = R4.candle_events(B2, X2)
    for o in out:
        if o['kind'] == 'candle' and str(o.get('ptype')).startswith('Undercut & reclaim'):
            o['ptype'] = 'UnR at 20EMA' if o['ptype'].endswith('20EMA') else 'UnR'
    s50L, s200L = (X2['s50'], X2['s200'])

    def ctx_ok(o):
        kk = ix.get(o['pts'][0]['d'], -1) + off2
        if kk < 0 or kk >= len(B2):
            return True
        nm_ = str(o.get('ptype'))
        if nm_ == 'Slingshot':
            e20L = R4.ema([x['c'] for x in B2], 20)
            tested = kk >= 6 and 0.94 <= min((B2[j]['l'] / e20L[j] for j in range(kk - 5, kk))) <= 1.01 and all((B2[j]['c'] >= 0.97 * e20L[j] for j in range(kk - 5, kk)))
            return bool(s50L[kk] and s200L[kk] and (B2[kk]['c'] > s50L[kk]) and (B2[kk]['c'] > s200L[kk]) and (B2[kk]['c'] > e20L[kk]) and tested)
        if nm_.startswith('HVC') or nm_.startswith('ER gap · HVC'):
            if B2[-1]['c'] >= 0.97 * B2[kk]['c']:
                return True
            if nm_.startswith('ER gap'):
                o['ptype'] = 'ER gap'
                o['why'] = str(o.get('why', '')).split('; the gap day')[0]
                return True
            return False
        return True
    out = [o for o in out if o['kind'] != 'candle' or ctx_ok(o)]
    have = {o['pts'][0]['d'] for o in out if o['kind'] == 'candle'}
    cyc = [(k, st, t) for k, st, t in R4.cycle_leg(R4.confirmed(B2, R4.cycle_events(B2))) if st in R4.SHOW and k - off2 >= 0 and (len(B2) - 1 - k <= 60)][-2:]
    if any((st == 'Wedge pop' for _, st, _ in cyc)):
        cyc = [e for e in cyc if e[1] != 'Reversal extension']
    if cyc and cyc[-1][1] == 'Reversal extension' and (len(B2) - 1 - cyc[-1][0] > 30):
        cyc = cyc[:-1]

    def gap_held_(k):
        for g in range(max(51, k - 30), k):
            av_ = sum((y['v'] for y in B2[g - 50:g])) / 50
            if B2[g]['o'] >= 1.05 * B2[g - 1]['c'] and av_ and (B2[g]['v'] >= 2.5 * av_) and (min((y['l'] for y in B2[g:])) >= 0.99 * B2[g - 1]['h']):
                return True
        return False
    cyc = [e for e in cyc if not (e[1] == 'Wedge drop' and gap_held_(e[0]))]
    wd = R4.wedge_drop(B2, R4.cycle_events(B2))
    if wd and gap_held_(wd[0]):
        wd = None
    if wd and B2[-1]['c'] > X2['e20'][-1] and all((x['c'] >= (X2['s50'][j] or 0) for j, x in enumerate(B2) if j > wd[0])):
        wd = None
    if wd and B2[-1]['c'] > B2[wd[0]]['h']:
        wd = None
    if wd and wd[0] - off2 >= 0 and all((k < wd[0] for k, _, _ in cyc)):
        cyc = sorted(cyc + [wd])[-3:]
    cyc_ = []
    for n_, (k, st, t) in enumerate(cyc):
        if st == 'Reversal extension':
            k2 = cyc[n_ + 1][0] if n_ + 1 < len(cyc) else len(B2)
            kl = min(range(k, k2), key=lambda j: B2[j]['l'])
            if kl != k and kl - off2 >= 0:
                t = 'the low of the extension leg (%.2f), %.1f ATR under the 20EMA' % (B2[kl]['l'], (X2['e20'][kl] - B2[kl]['l']) / (R4.atr(B2, kl) or 1))
                k = kl
        if st == 'EMA crossback' and k >= 50:
            av_ = sum((y['v'] for y in B2[k - 50:k])) / 50
            if B2[k]['v'] >= 2 * av_ and B2[k]['c'] > max((y['h'] for y in B2[k - 20:k])):
                st = 'Breakout'
                t = 'a breakout over the 20-day high on %.1fx volume (news / a big buyer), not a pullback buy' % (B2[k]['v'] / av_)
        kk_ = [e for e in events if e[1] == 'Kicker' and 1 <= k - e[0] <= 3]
        if st in ('Breakout', 'Wedge pop', 'EMA crossback') and kk_ and (kk_[0][0] - off2 >= 0):
            t = kk_[0][2] + '; the %s followed on %s' % (st.lower(), R4.md(B2[k]['t']))
            k = kk_[0][0]
            st = 'Kicker'
        if st == 'EMA crossback':
            ce_ = R4.confirmed(B2, R4.cycle_events(B2))
            kw_ = [e[0] for e in ce_ if e[1] == 'Wedge drop' and e[0] < k]
            if kw_ and any((e[1] in ('EMA crossback', "Base n' break", 'Wedge pop') and kw_[-1] - 80 <= e[0] < kw_[-1] for e in ce_)) and all((X2['s50'][j] and B2[j]['c'] >= X2['s50'][j] for j in range(kw_[-1], k + 1))):
                continue
        cyc_.append((k, st, t))
    cyc = cyc_
    fb_ = R4.failed_breakout(B2, X2)
    if fb_ and fb_[0] - off2 >= 0:
        cyc = [e for e in cyc if e[0] != fb_[0]] + [(fb_[0], 'Failed breakout', 'broke over the %.2f base top, then closed back under the base' % fb_[1])]
    for k, st, t in cyc:
        d = dates[k - off2]
        out = [o for o in out if not (o['kind'] == 'candle' and o['pts'][0]['d'] == d)]
        hi_ = st in ('Exhaustion extension', 'Wedge drop', 'Failed breakout')
        out.append({'kind': 'candle', 'ptype': st, 'at': 'high' if hi_ else 'low', 'also': [], 'why': t, 'src': VERSION, '_cyc': True, 'color': '#f472b6' if hi_ else '#22d3ee', 'pts': [{'d': d, 'p': round(B2[k]['h'] if hi_ else B2[k]['l'], 4)}]})
    have = {o['pts'][0]['d'] for o in out if o['kind'] == 'candle'}
    for k, name, text, at in events:
        d = dates[k - off2] if k - off2 >= 0 else None
        if name in ('Gap up', 'Gap down'):
            import re as _re
            mg = _re.search('([0-9.]+)% on ([0-9.]+)x', text)
            if not mg or not (float(mg.group(1)) >= 3 and float(mg.group(2)) >= 1.5 or (float(mg.group(1)) >= 1.5 and float(mg.group(2)) >= 2.5)):
                continue
        if name == 'Gap up' and re.search('([0-9.]+)% on ([0-9.]+)x', text):
            gp_, vx_ = map(float, re.search('([0-9.]+)% on ([0-9.]+)x', text).groups())
            if gp_ >= 8 and vx_ >= 3:
                hv_ = any((e[0] == k and e[1] == 'HVC' for e in events))
                name = 'ER gap · HVC %.2f' % B2[k]['c'] if hv_ else 'ER gap'
                text = 'gapped up %.1f%% on %.1fx volume (likely earnings)' % (gp_, vx_) + ("; the gap day's close is the HVC" if hv_ else '')
        if d and name.startswith(('ER gap', 'ER breakdown')) and (d in have) and (not any((o['kind'] == 'candle' and o['pts'][0]['d'] == d and str(o.get('ptype')).startswith(('ER gap', 'Episodic')) for o in out))):
            out = [o for o in out if not (o['kind'] == 'candle' and o['pts'][0]['d'] == d and (not o.get('_cyc')))]
            have.discard(d)
        if name == 'Kicker':
            nx_ = [o for o in out if o['kind'] == 'candle' and (not o.get('_cyc')) and str(o.get('ptype')).startswith('Breakout') and (1 <= ix.get(o['pts'][0]['d'], -99) - (k - off2) <= 3)]
            if nx_:
                out = [o for o in out if o not in nx_]
                have.discard(nx_[0]['pts'][0]['d'])
                text += '; broke out on %s' % R4.md(nx_[0]['pts'][0]['d'].replace('-', ''))
        if name == 'MA remount' and (len(B2) - 1 - k > 20 or any((o.get('ptype') == 'MA remount' for o in out))):
            continue
        if d and name not in ('Quiet day', 'Tight closes', 'Wedge pop') and (d not in have):
            if name == 'UnR' and '20EMA' in text:
                name = 'UnR at 20EMA'
            o_ = {'kind': 'candle', 'ptype': name, 'at': at, 'also': [], 'why': text, 'src': VERSION, 'pts': [{'d': d, 'p': round(B2[k]['l'] if at == 'low' else B2[k]['h'], 4)}]}
            if ctx_ok(o_):
                out.append(o_)
                have.add(d)
    hl = R4.higher_low(B2, X2)
    if hl and hl[1] - off2 >= 0:
        oo = [o for o in out if o['kind'] == 'candle' and o.get('ptype') == 'Oops reversal' and (abs(ix.get(o['pts'][0]['d'], -99) - (hl[1] - off2)) <= 3)]
        if oo:
            oo[0]['ptype'] = 'Oops reversal · Higher low'
            hl = None
    if hl and hl[1] - off2 >= 0 and (dates[hl[1] - off2] in have):
        for o in out:
            if o['kind'] == 'candle' and o['pts'][0]['d'] == dates[hl[1] - off2] and (o.get('ptype') in ('Hammer at support', 'Inside day', 'Outside reversal')):
                o['ptype'] = 'Higher low'
                o['why'] = 'swing low %.2f over the %s low %.2f' % (B2[hl[1]]['l'], R4.md(B2[hl[0]]['t']), B2[hl[0]]['l'])
    elif hl and hl[1] - off2 >= 0:
        out.append({'kind': 'candle', 'ptype': 'Higher low', 'at': 'low', 'also': [], 'src': VERSION, 'why': 'swing low %.2f over the %s low %.2f' % (B2[hl[1]]['l'], R4.md(B2[hl[0]]['t']), B2[hl[0]]['l']), 'pts': [{'d': dates[hl[1] - off2], 'p': round(B2[hl[1]]['l'], 4)}]})
        have.add(dates[hl[1] - off2])
    VR = {'Breakout': 1, 'Episodic pivot': 1, 'ER gap': 1.5, 'ER gap · HVC': 1.5, 'Power gap': 2, 'Kicker': 2, 'Slingshot': 3, 'Oops reversal': 3, 'Failed breakout': 2, 'Breakdown': 2, 'Gap & fade': 3, 'Double inside day': 5, 'UnR at 20EMA': 0, 'GO signal': 3.5}
    rk = lambda o: R4.RANK.get(o.get('ptype'), R4.RANK.get(str(o.get('ptype')).split(' ·')[0], VR.get(str(o.get('ptype')).split(' ·')[0], 4)))
    bg_ = [k for k in range(max(1, len(B2) - 20), len(B2)) if B2[k]['o'] / B2[k - 1]['c'] - 1 >= 0.05 and B2[k]['l'] > B2[k - 1]['h'] * 0.99 and (B2[k]['v'] >= 2 * (sum((y['v'] for y in B2[max(0, k - 50):k])) / max(1, min(50, k))))]
    if bg_ and X2['s50'][bg_[-1] - 1] and (B2[bg_[-1] - 1]['c'] > X2['s50'][bg_[-1] - 1] > (X2['s50'][bg_[-1] - 11] or 9000000000.0)) and (B2[bg_[-1] - 1]['c'] > (X2['s200'][bg_[-1] - 1] or 9000000000.0)):
        bg_ = []
    if bg_ and bg_[-1] - off2 >= 0:
        g0_ = dates[bg_[-1] - off2]
        out = [o for o in out if not (o['kind'] == 'candle' and (not o.get('_cyc')) and (o['pts'][0]['d'] < g0_) and (rk(o) >= 3))]
    eg_ = [o for o in out if o['kind'] == 'candle' and str(o.get('ptype')).startswith(('ER gap', 'Episodic pivot'))]
    if eg_:
        g1_ = max((o['pts'][0]['d'] for o in eg_))
        out = [o for o in out if not (o['kind'] == 'candle' and (not o.get('_cyc')) and (o['pts'][0]['d'] < g1_) and (o['pts'][0]['p'] < 0.75 * B2[-1]['c']))]

    def drop35_(o):
        nm_ = str(o.get('ptype'))
        if nm_ == 'Failed breakout' and (not o.get('_cyc')):
            return True
        if nm_ == 'Reversal off highs':
            k_ = ix.get(o['pts'][0]['d'], -99) + off2
            return not (0 <= k_ < len(B2) and any((B2[j]['c'] < X2['e20'][j] for j in range(k_ + 1, len(B2)))))
        return False
    out = [o for o in out if not (o['kind'] == 'candle' and drop35_(o))]
    for o in [o for o in out if o['kind'] == 'candle' and str(o.get('ptype')) == 'Breakdown' and (not o.get('_cyc'))]:
        k_ = ix.get(o['pts'][0]['d'], -99) + off2
        if 0 <= k_ < len(B2) - 1 and any((B2[j]['c'] > B2[k_]['h'] for j in range(k_ + 1, len(B2)))):
            kl = min(range(k_, min(len(B2), k_ + 6)), key=lambda j: B2[j]['l'])
            at_ = R4.atr(B2, kl) or 1
            out.remove(o)
            if kl - off2 >= 0 and (X2['e20'][kl] - B2[kl]['l']) / at_ >= 2:
                out.append({'kind': 'candle', 'ptype': 'Reversal extension', 'at': 'low', 'also': [], 'src': VERSION, 'color': '#22d3ee', '_cyc': True, 'why': 'the flush low (%.2f), %.1f ATR under the 20EMA, fully reclaimed since (not a breakdown)' % (B2[kl]['l'], (X2['e20'][kl] - B2[kl]['l']) / at_), 'pts': [{'d': dates[kl - off2], 'p': round(B2[kl]['l'], 4)}]})
    marks = sorted([o for o in out if o['kind'] == 'candle'], key=lambda o: (rk(o), -ix.get(o['pts'][0]['d'], 0)))
    downtrend = bool(B2) and X2['s50'][-1] and (B2[-1]['c'] < X2['s50'][-1]) and (X2['s50'][-1] < (X2['s50'][-11] or 0))
    nc_ = R4.news_crash(B2)
    if nc_ and nc_[0] - off2 >= 0:
        d0_ = dates[nc_[0] - off2]
        marks = [o for o in marks if o['pts'][0]['d'] < d0_ or str(o.get('ptype')).startswith(('Breakdown on news', 'ER breakdown'))]
        downtrend = True
    pickm = [o for o in marks if o.get('_cyc')]
    for o in marks:
        apart = all((abs(ix.get(o['pts'][0]['d'], 0) - ix.get(q['pts'][0]['d'], 0)) >= 4 for q in pickm))
        nb_ = [q for q in pickm if abs(ix.get(o['pts'][0]['d'], 0) - ix.get(q['pts'][0]['d'], 0)) < 4]
        if str(o.get('ptype')).startswith(('ER gap', 'Episodic pivot')) and all((q['at'] != 'high' for q in nb_)) and (len(nb_) <= 1):
            apart = True
            if nb_:
                k_ = ix[o['pts'][0]['d']] + off2
                o['at'] = 'high'
                o['pts'] = [{'d': o['pts'][0]['d'], 'p': round(B2[k_]['h'], 4)}]
        if o['pts'][0]['d'] == dates[-1] and all((q['pts'][0]['d'] != dates[-1] for q in pickm)):
            apart = True
        if not o.get('_cyc') and len(pickm) < 3 and apart and all((q.get('ptype') != o.get('ptype') for q in pickm)) and (not downtrend or str(o.get('ptype')).startswith(('ER breakdown', 'Breakdown on news'))):
            pickm.append(o)
    REC_ = ('Oops reversal', 'Inside day', 'UnR', 'UnR at 20EMA', 'Higher low', 'Hammer at support', 'Outside reversal', 'Kicker', 'Inside bar break', 'Pocket pivot', 'Slingshot', 'Breakout', 'Range breakout', 'Heavy volume, closed weak', 'Reversal off highs', 'MA remount', 'Pocket pivot · MA remount')
    pt_ = lambda q: {x.strip() for x in str(q.get('ptype')).split(' ·')}
    names_ = set().union(*[pt_(q) for q in pickm]) if pickm else set()
    for o in sorted(marks, key=lambda o: -ix.get(o['pts'][0]['d'], 0)):
        nm_ = str(o.get('ptype')).split(' ·')[0]
        if o not in pickm and i - ix.get(o['pts'][0]['d'], -99) <= 4 and (nm_ in REC_) and (not pt_(o) & names_) and all((q['pts'][0]['d'] != o['pts'][0]['d'] for q in pickm)) and (not downtrend or nm_ in R4.BEAR_MARKS) and (sum((1 for q in pickm if q.get('_recent'))) < 2):
            o['_recent'] = True
            o['_yield'] = True
            pickm.append(o)
            names_ |= pt_(o)
    bb_ = [] if downtrend else R4.best_buy_days(B2, X2)
    if bb_:
        kb_, nb_, rb_ = max(bb_, key=lambda x: x[2])
        db_ = dates[kb_ - off2] if kb_ - off2 >= 0 else None
        cat_ = [q['pts'][0]['d'] for q in out if q['kind'] == 'candle' and str(q.get('ptype')).startswith(('ER gap', 'Episodic pivot'))] + ([dates[bg_[-1] - off2]] if bg_ and bg_[-1] - off2 >= 0 else [])
        if db_ and cat_ and (db_ < max(cat_)):
            db_ = None
        if db_ and all((abs(ix.get(q['pts'][0]['d'], -99) - (kb_ - off2)) >= 3 for q in pickm)):
            evn_ = {e[1] for e in events if e[0] == kb_}
            nm_ = 'Breakout' if evn_ & {'Range breakout', 'Breakout'} else nb_
            pickm.append({'kind': 'candle', 'ptype': nm_, 'at': 'low', 'also': [], 'src': VERSION, 'why': 'the best buy day so far (+%.0f%% since)' % (100 * rb_), '_yield': True, 'pts': [{'d': db_, 'p': round(B2[kb_]['l'], 4)}]})
    rc_ = sorted([q for q in pickm if i - ix.get(q['pts'][0]['d'], -99) <= 4 and (not q.get('_cyc'))], key=lambda q: ix.get(q['pts'][0]['d'], 0))
    if len(rc_) >= 2 and any((q.get('_recent') for q in rc_)):
        rc_[-1]['text'] = ' → '.join(('%s %s' % (str(q.get('ptype')), R4.md(q['pts'][0]['d'].replace('-', ''))) for q in rc_))
        for q in rc_[:-1]:
            q['text'] = ''
            q['dot'] = True
    cm = sorted([o for o in pickm if o.get('_cyc')], key=lambda o: ix.get(o['pts'][0]['d'], 0))
    for o0, o1 in zip(cm, cm[1:]):
        if ix.get(o1['pts'][0]['d'], 0) - ix.get(o0['pts'][0]['d'], 0) < 6 and o1['at'] == o0['at']:
            k1 = ix[o1['pts'][0]['d']] + off2
            o1['at'] = 'high' if o0['at'] == 'low' else 'low'
            o1['pts'] = [{'d': o1['pts'][0]['d'], 'p': round(B2[k1]['h'] if o1['at'] == 'high' else B2[k1]['l'], 4)}]
    for o in pickm:
        o.pop('_cyc', None)
    out = [o for o in out if o['kind'] != 'candle'] + pickm
    c = bars_close
    near = lambda p: c is not None and abs(p / c - 1) <= LEVEL_BAND
    levels = [o for o in levels if near(o['price'])]
    for z in (ltb.get(cid) or {}).get('objects', []):
        if z['kind'] != 'zone' or not (near(z['top']) or near(z['bot'])):
            continue
        lo, hi = (min(z['top'], z['bot']), max(z['top'], z['bot']))
        if any((lo * 0.99 <= o.get('_mid', o.get('price')) <= hi * 1.01 for o in levels)):
            continue
        mid = (lo + hi) / 2
        levels.append({**z, 'kind': 'zone', 'ptype': 'Resistance zone' if mid > c else 'Support zone', 'role': 'Resistance' if mid > c else 'Support', 'start': dates[max(0, i - LINE_RECENT * 2)], 'nolabel': False, '_mid': mid, '_ltb': True})
    for bo in base_breakout(B, c) if len(B) >= 80 else []:
        if bo[1] - off >= 0 and (not any((o['kind'] == 'base' and abs((o.get('line') or 0) / bo[2] - 1) < 0.02 for o in out))):
            levels.append({'kind': 'hline', 'ptype': 'Base breakout (support)', 'price': round(bo[2], 4), 'start': dates[bo[1] - off], 'src': VERSION})
    rt_ = breakout_retest(B, c) if len(B) >= 60 else None
    if rt_ and rt_[1] - off >= 0 and (1 - rt_[0] / c <= 0.25) and (not any((abs(o.get('price', 0) / rt_[0] - 1) < 0.015 for o in levels))):
        levels.append({'kind': 'hline', 'ptype': 'Breakout retest', 'price': round(rt_[0], 4), 'start': dates[rt_[1] - off], 'src': VERSION, 'why': 'the %s high, broken and retested on %s' % (R4.md(B[rt_[1]]['t']), R4.md(B[rt_[2]]['t']))})
    hold = recent_hold(B, c) if len(B) >= 30 else None
    if hold and near(hold[0]):
        levels.append({'kind': 'hline', 'ptype': 'Recent hold (%dx)' % hold[1], 'price': round(hold[0], 4), 'start': dates[max(0, i - (len(B) - 1 - hold[2]))], 'src': VERSION})
    fh = R4.flag_at_highs(B2, X2)
    if fh and fh[0] - off2 >= 0 and (not any((o['kind'] == 'base' and abs((o.get('line') or 0) / fh[1] - 1) < 0.02 for o in out))):
        old = [o for o in out if o['kind'] == 'base']
        out = [o for o in out if o['kind'] != 'base' or o is (old[-1] if old else None)]
        out.append({'kind': 'base', 'ptype': 'Flag at highs', 'start': dates[fh[0] - off2], 'end': dates[i], 'line': round(fh[1], 4), 'buy_point': round(fh[1], 4), 'low': round(fh[2], 4), 'state': 'plain', 'src': VERSION})
    flag = recent_flag(B) if len(B) >= 60 and (not fh) else None
    if flag:
        k0, p0, k1, p1 = flag
        out = [o for o in out if not (o['kind'] == 'trendline' and o.get('ptype') in OFF_HIGHS)]
        out.append({'kind': 'trendline', 'ptype': 'Flag (lower highs)', 'd1': dates[i - (k1 - k0)], 'p1': round(p0, 4), 'd2': dates[i], 'p2': round(p1, 4), 'extend': False, 'src': VERSION})
    price = lambda o: o.get('_mid', o.get('price'))
    tr = [max(B[k]['h'], B[k - 1]['c']) - min(B[k]['l'], B[k - 1]['c']) for k in range(max(1, len(B) - 14), len(B))]
    gap = min(0.05, max(0.02, 0.8 * (sum(tr) / len(tr)) / c)) if tr else 0.02
    pick = []
    for side in (1, -1):
        cand = [o for o in levels if (price(o) - c) * side > 0 or (side == -1 and price(o) == c)]
        cand.sort(key=lambda o: (PRIO.get(str(o.get('ptype')).split(' (')[0], 2 if o['kind'] == 'zone' else 4), abs(price(o) / c - 1)))
        chosen = []
        for o in out:
            if o['kind'] == 'base':
                for bp in (o.get('buy_point'), o.get('line')):
                    if bp and (bp - c) * side > 0:
                        chosen.append({'price': bp, '_base': True})
        for o in cand:
            if all((abs(price(o) / price(q) - 1) > gap for q in chosen)):
                chosen.append(o)
            if len([q for q in chosen if not q.get('_base')]) == (1 if downtrend else 2):
                break
        pick += [q for q in chosen if not q.get('_base')]
    lz = [o for o in pick if o.get('_ltb')]
    z0 = min(lz, key=lambda o: abs(price(o) / c - 1)) if lz else None
    pick = [o for o in pick if not o.get('_ltb') or o is z0]
    nb = sum((1 for o in out if o['kind'] == 'base'))
    pick.sort(key=lambda o: (PRIO.get(str(o.get('ptype')).split(' (')[0], 2 if o['kind'] == 'zone' else 4), abs(price(o) / c - 1)))
    pick = pick[:max(1, 4 - 2 * nb)]
    eg = earnings_gap(B, c) if len(B) >= 60 else None
    KEEP = ('Recent hold', 'Buy point', 'Early entry', 'Base breakout', 'Breakout retest')
    keep = lambda o: str(o.get('ptype')).startswith(KEEP)
    if eg and eg[0] - off >= 0 and (0.03 <= 1 - eg[2] / c <= 0.3):
        k, lo, hvc, vm = eg
        hold_ = lambda o: str(o.get('ptype')).startswith(('Recent hold', 'Buy point', 'Early entry'))
        rest = [o for o in pick if hold_(o) or not lo * 0.98 <= price(o) <= hvc * 1.02]
        if len(rest) < 4 or not all((keep(o) for o in rest)):
            zone = {'kind': 'zone', 'ptype': 'Gap support / HVC %.2f' % hvc, 'role': 'Support', 'top': round(hvc, 4), 'bot': round(lo, 4), 'start': dates[k - off], 'nolabel': False, 'src': VERSION}
            while len(rest) >= 4:
                rest.remove(max([o for o in rest if not keep(o)], key=lambda o: abs(price(o) / c - 1)))
            pick = rest + [zone]
    gz = [g for g in R4.drendel_gaps(B2) if g['k'] - off2 >= 0 and abs((g['top'] + g['bot']) / 2 / c - 1) <= 0.3]
    pz = lambda o: price(o) if price(o) is not None else (o['top'] + o['bot']) / 2
    gsel = []
    below = [g for g in gz if g['top'] <= c * 1.005 and g['top'] >= c * 0.8]
    above = [g for g in gz if g['bot'] > c * 1.005 and g['bot'] <= c * 1.1]
    if below:
        gsel.append(max(below, key=lambda g: g['pct'] * g['vm']))
    if above:
        gsel.append(min(above, key=lambda g: g['bot']))
    if downtrend:
        gsel = gsel[:1]
    for g in gsel:
        d = dates[g['k'] - off2]
        tag = next((o['ptype'] for o in out if o['kind'] == 'candle' and o['pts'][0]['d'] == d and str(o.get('ptype')).startswith(('ER gap', 'Episodic pivot', 'Power gap'))), '').split(' ·')[0]
        z = {'kind': 'zone', 'ptype': 'Unfilled gap %s%s · %s' % (R4.md(B2[g['k']]['t']), ' (%s)' % tag if tag else '', g['state']), 'role': 'Support' if g['up'] else 'Resistance', 'top': round(g['top'], 4), 'bot': round(g['bot'], 4), 'start': d, 'nolabel': False, 'color': R4.GAP_COLOR[g['state']], 'src': VERSION}
        hz = next((o for o in pick if str(o.get('ptype')).startswith('Gap support') and o.get('start') == d), None)
        if hz:
            z.update(top=hz['top'], ptype='Unfilled gap %s%s + HVC %.2f · %s' % (R4.md(B2[g['k']]['t']), ' (%s)' % tag if tag else '', hz['top'], g['state']))
        pick = [o for o in pick if not (str(o.get('ptype')).startswith(('Gap support', 'Gap-day low', 'Gap fill')) and o.get('bot', o.get('price', 0)) <= g['top'] * 1.02 and (o.get('top', o.get('price', 0)) >= g['bot'] * 0.98))]
        pick = [o for o in pick if keep(o) or not (o['kind'] == 'hline' and g['bot'] * 0.99 <= o['price'] <= g['top'] * 1.01)]
        if g['up'] and g['pct'] * g['vm'] >= 20:
            pick = [o for o in pick if not (str(o.get('ptype')).startswith('Base breakout') and g['bot'] * 0.98 <= o['price'] <= g['top'] * 1.02)]
        while len(pick) >= 4 and [o for o in pick if not keep(o)]:
            pick.remove(max([o for o in pick if not keep(o)], key=lambda o: abs(pz(o) / c - 1)))
        if len(pick) < 4:
            pick.append(z)
    holds = sorted([o for o in pick if str(o.get('ptype')).startswith('Recent hold') and 0 < 1 - price(o) / c <= 0.08], key=lambda o: -price(o))
    if holds:
        h0 = holds[0]
        h0['ptype'] = '%s · buy an UnR of %.2f' % (h0['ptype'], h0['price'])
        pick = [o for o in pick if not (o.get('ptype') == 'Early entry' and o['price'] > c)]
    for o in pick:
        o.pop('_mid', None)
        o.pop('_ltb', None)
        if o['kind'] == 'hline' and o.get('start') in ix:
            o['start'] = dates[max(0, touch_start(B, o['price'], ix[o['start']] + off) - off)]
    for o in out:
        if o['kind'] == 'base' and o.get('start') in ix and (o.get('line') or o.get('buy_point')):
            ls = dates[max(0, touch_start(B, o.get('line') or o['buy_point'], ix[o['start']] + off) - off)]
            if ls < o['start']:
                o['line_start'] = ls
    if False:
        for t in (dje.get(cid) or {}).get('objects', []):
            if t['kind'] == 'trendline' and t.get('ptype') == 'Upper trendline' and (age(t['d2']) <= LINE_RECENT):
                out.append({**t, 'ptype': 'Trendline off the highs', 'nolabel': False})
                break
    objs = out + pick
    if not downtrend and len(B2) > 60:
        from . import launch as LB
        lbs = [x for x in LB.launch_bases(B2, keep=3) if x['e'] <= len(B2) - 11 and x['s'] - off2 >= 0 and (x['run'] >= 0.35) and (x['top'] >= 0.4 * B2[-1]['c'])]
        sel = [max(lbs, key=lambda x: x['run'])] if lbs else []
        for x in sel:
            px_ = [o.get('line') or o.get('buy_point') or o.get('price') for o in objs if o['kind'] in ('base', 'hline')]
            if any((t and abs(t / x['top'] - 1) <= 0.04 for t in px_)):
                continue
            if len(objs) >= 6:
                lv_ = [o for o in objs if o['kind'] == 'hline' and (not keep(o)) and (str(o.get('ptype')).split(' ·')[0] in ('Support', 'Resistance', 'Swing low', 'Swing high', '52-week high', 'Support zone', 'Resistance zone'))]
                if not lv_:
                    continue
                objs.remove(max(lv_, key=lambda o: abs(pz(o) / B2[-1]['c'] - 1)))
            objs.append({'kind': 'base', 'ptype': 'Base', 'start': dates[x['s'] - off2], 'end': dates[x['e'] - off2], 'line': x['top'], 'low': x['low'], 'buy_point': None, 'state': 'broke out', 'why': 'the %d-week base it broke out of on %s (+%d%% after)' % (max(1, round((x['e'] - x['s'] + 1) / 5)), R4.md(B2[x['bo']]['t']), round(100 * x['run'])), 'src': VERSION, '_launch': True})
    if not downtrend and len(B2) > 60:
        from . import launch as LB
        st_ = [x for x in LB.launch_bases(B2, keep=3) if x['run'] >= 1.0 and x['bo'] - off2 >= 0 and (x['top'] >= 0.2 * B2[-1]['c'])]
        if st_:
            x = max(st_, key=lambda x: x['run'])
            kb = x['bo'] - off2
            dbo = dates[kb]
            cand_ = [o for o in objs if o['kind'] == 'candle']
            near_ = [o for o in cand_ if abs(ix.get(o['pts'][0]['d'], -99) - kb) <= 2 and str(o.get('ptype')).startswith(('Breakout', 'Gap up · breakout', 'ER gap', 'Episodic pivot', 'Range breakout'))]
            plain_ = [o for o in cand_ if o.get('ptype') == 'Breakout' and o not in near_ and (i - ix.get(o['pts'][0]['d'], -99) > 4)]
            if near_:
                near_[0]['_story'] = True
            elif plain_ or len(cand_) < 3:
                objs = [o for o in objs if not (o in plain_[:1] or (o['kind'] == 'candle' and o['pts'][0]['d'] == dbo))]
                av_ = sum((y['v'] for y in B2[max(0, x['bo'] - 50):x['bo']])) / max(1, min(50, x['bo']))
                objs.append({'kind': 'candle', 'ptype': 'Breakout', 'at': 'low', 'also': [], 'src': VERSION, '_story': True, 'why': 'the launch: broke out of the %d-week base over %.2f on %.1fx volume; +%d%% since' % (max(1, round((x['e'] - x['s'] + 1) / 5)), x['top'], B2[x['bo']]['v'] / max(1, av_), round(100 * x['run'])), 'pts': [{'d': dbo, 'p': round(B2[x['bo']]['l'], 4)}]})
    if downtrend:
        objs = [o for o in objs if not (o['kind'] == 'trendline' and o.get('ptype') == 'Pullback line')]
    if any((o['kind'] == 'candle' and str(o.get('ptype')).startswith('ER breakdown') and (i - ix.get(o['pts'][0]['d'], 0) <= 5) for o in objs)):
        objs = [o for o in objs if not (o['kind'] in ('hline', 'zone') and (pz(o) if o['kind'] == 'zone' else o['price']) < c)]
    CYC = ('Reversal extension', 'Wedge pop', 'EMA crossback', 'Wedge drop')
    zd = {o.get('start') for o in objs if o['kind'] == 'zone' and str(o.get('ptype')).startswith('Unfilled gap')}
    for o in objs:
        if o['kind'] == 'candle' and o.get('ptype') == 'Gap up' and (o['pts'][0]['d'] in ix):
            k_ = ix[o['pts'][0]['d']] + off2
            if k_ >= 20 and B2[k_]['c'] > max((y['h'] for y in B2[k_ - 20:k_])):
                o['ptype'] = 'Gap up · breakout'
                o['why'] = str(o.get('why', '')) + ', closed over the 20-day high'
    objs = [o for o in objs if not (o['kind'] == 'candle' and o.get('ptype') in ('Gap up', 'Gap down') and (o['pts'][0]['d'] in zd))]
    objs = [o for o in objs if not (o['kind'] == 'candle' and o.get('ptype') in ('Gap down', 'Heavy volume, closed weak'))]
    objs = [o for o in objs if not (o['kind'] == 'candle' and o.get('ptype') == '20EMA tap' and (i - ix.get(o['pts'][0]['d'], 0) > 4))]
    rc2_ = sorted([o for o in objs if o['kind'] == 'candle' and (o.get('dot') or o.get('text'))], key=lambda o: o['pts'][0]['d'])
    if rc2_ and (not rc2_[-1].get('text')):
        objs = [o for o in objs if not (o.get('dot') and o.get('_recent'))]
        for o in objs:
            o.pop('dot', None)
            if o.get('text') == '':
                o.pop('text', None)
    while len([o for o in objs if not o.get('dot')]) > 6:
        rx_ = [o for o in objs if o.get('_yield') and (not o.get('dot'))]
        if rx_:
            x_ = rx_[-1]
            objs.remove(x_)
            if x_.get('text'):
                objs = [o for o in objs if not (o.get('dot') and o.get('_recent'))]
                for o in objs:
                    if o.get('dot'):
                        o.pop('dot', None)
                        o.pop('text', None)
            continue
        marks_ = [o for o in objs if o['kind'] == 'candle' and o.get('ptype') not in CYC and (not o.get('_story')) and (not o.get('dot')) and (not (o['pts'][0]['d'] == dates[-1] and (rk(o) <= 3 or str(o.get('ptype')).endswith('MA remount')))) and (not (rk(o) <= 1 and i - ix.get(o['pts'][0]['d'], 0) <= 15))]
        lv = [o for o in objs if o['kind'] in ('hline', 'zone') and (not keep(o))]
        if len([o for o in objs if o['kind'] == 'candle']) > 2 and marks_:
            x_ = max(marks_, key=lambda o: (rk(o) + ((i - ix.get(o['pts'][0]['d'], 0)) / (20.0 if str(o.get('ptype')).startswith(('ER gap', 'Episodic pivot')) else 10.0) if rk(o) <= 2 else 0), -ix.get(o['pts'][0]['d'], 0)))
            objs.remove(x_)
            if x_.get('text'):
                objs = [o for o in objs if not (o.get('dot') and o.get('_recent'))]
                for o in objs:
                    if o.get('dot'):
                        o.pop('dot', None)
                        o.pop('text', None)
        elif lv:
            objs.remove(max(lv, key=lambda o: abs(pz(o) / c - 1)))
        elif [o for o in objs if o['kind'] == 'trendline']:
            objs.remove([o for o in objs if o['kind'] == 'trendline'][-1])
        elif [o for o in objs if o.get('_launch')]:
            objs.remove([o for o in objs if o.get('_launch')][-1])
        else:
            break
    rc2_ = sorted([o for o in objs if o['kind'] == 'candle' and (o.get('dot') or o.get('text'))], key=lambda o: o['pts'][0]['d'])
    if len(rc2_) == 1:
        rc2_[0].pop('text', None)
        rc2_[0].pop('dot', None)
    elif rc2_:
        rc2_[-1]['text'] = ' → '.join(('%s %s' % (str(q.get('ptype')), R4.md(q['pts'][0]['d'].replace('-', ''))) for q in rc2_))
    for o in objs:
        o.pop('_launch', None)
        o.pop('_story', None)
        o.pop('_recent', None)
        o.pop('_yield', None)
    MRP = lambda t: t.replace('Pocket pivot', 'Mid-range pivot') if isinstance(t, str) else t
    for o in objs:
        o['ptype'] = MRP(o.get('ptype'))
        if o.get('text'):
            o['text'] = MRP(o['text'])
    card_ = [(t_, MRP(x_)) for t_, x_ in R4.card(B2, objs, dates, X2, events)]
    from . import quality as BQ
    bq_ = None
    for o in objs:
        if o.get('kind') == 'base' and o.get('start') in ix and (o.get('state') != 'broke out'):
            s_ = ix[o['start']] + off2
            e_ = ix.get(o.get('end'), i) + off2
            q_, parts_ = BQ.fitted(B2, s_, e_, o.get('line') or o.get('buy_point') or max((x['h'] for x in B2[s_:e_ + 1])), o.get('low') or min((x['l'] for x in B2[s_:e_ + 1])))
            o['quality'] = q_
            if bq_ is None or q_ > bq_[0]:
                bq_ = (q_, parts_)
    if bq_ and bq_[1]:
        good_ = [w for k, w in (('tight', 'tight right side'), ('dryup', 'volume drying up'), ('pivot', 'in position under the pivot')) if bq_[1].get(k, 0) >= 0.8]
        card_ = [(t_, x_ + ' · base quality %d/100%s' % (bq_[0], ' (' + ', '.join(good_) + ')' if good_ else '')) if t_ == 'Pattern' and (not x_.startswith('No base')) else (t_, x_) for t_, x_ in card_]
    th_ = R4.thesis(card_, objs, man.get('ticker', ''), buy=R4.buy_days_text(B2, X2, first=off2) if B2 else '')
    cx_ = {'sentence': '', 'card': [], 'rs': None}
    if B2 and man.get('ticker'):
        from . import context as CX
        try:
            cx_ = CX.line(man['ticker'], B2, B2[-1]['t'])
        except Exception:
            pass
    rsl_ = [{'d': '%s-%s-%s' % (str(t)[:4], str(t)[4:6], str(t)[6:8]), 'v': v} for t, v in cx_.get('rs') or []]
    return {'objects': [dict(o, id='v4_%d' % n, src=o.get('src') or VERSION) for n, o in enumerate(objs, 1)], 'card': card_ + [(k_, v_) for k_, v_ in cx_['card']], 'thesis': th_, 'context': cx_['sentence'], 'rs': [x for x in rsl_ if x['d'] in ix], 'labels': (v3.get(cid) or {}).get('labels', {}), 'read': (v3.get(cid) or {}).get('read', ''), 'version': VERSION}
