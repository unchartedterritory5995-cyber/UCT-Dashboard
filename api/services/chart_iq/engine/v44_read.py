# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
def ema(xs, n):
    out, a, k = ([], None, 2 / (n + 1))
    for x in xs:
        a = x if a is None else a + k * (x - a)
        out.append(a)
    return out

def sma(xs, n):
    out, s = ([], 0.0)
    for k, x in enumerate(xs):
        s += x
        if k >= n:
            s -= xs[k - n]
        out.append(s / n if k >= n - 1 else None)
    return out

def atr(b, k, n=14):
    tr = [max(b[j]['h'], b[j - 1]['c']) - min(b[j]['l'], b[j - 1]['c']) for j in range(max(1, k - n + 1), k + 1)]
    return sum(tr) / len(tr) if tr else 0.0

def md(t):
    s = str(t).replace('-', '')
    return '%d/%d' % (int(s[4:6]), int(s[6:8]))

def ctx(b):
    c = [x['c'] for x in b]
    return {'e9': ema(c, 9), 'e20': ema(c, 20), 's50': sma(c, 50), 's200': sma(c, 200)}
RANK = {'Range breakout': 4.2, 'Oops reversal': 1, 'MA remount': 4.5, 'Higher low': 5, 'UnR': 0, 'Pocket pivot': 4, 'HVC': 2, 'Outside reversal': 3, 'Wedge pop': 3, 'Kicker': 2, 'Inside bar break': 3.9, 'Double inside bar break': 3.9, 'Gap up': 4, 'Heavy volume, closed weak': 4, 'Bearish engulfing': 2, 'ER breakdown': 1.5, 'Breakdown on news': 1.5, '20EMA tap': 3.5, 'Hammer at support': 5, 'Reversal off highs': 5, 'Gap down': 5, 'Inside day': 6, 'Tight closes': 7, 'Quiet day': 8}

def kicker(b, k):
    if k < 15:
        return False
    p, x = (b[k - 1], b[k])
    a = atr(b, k - 1) or 1e-09
    rng = x['h'] - x['l'] or 1e-09
    av = sum((y['v'] for y in b[max(0, k - 50):k])) / max(1, min(50, k))
    return p['c'] < p['o'] and p['o'] - p['c'] >= 0.5 * a and (x['o'] > p['o']) and (x['o'] - p['c'] >= a) and (x['c'] >= x['o']) and ((x['c'] - x['l']) / rng >= 0.7) and av and (x['v'] >= 1.5 * av)

def candle_events(b, X=None, look=30):
    X = X or ctx(b)
    n = len(b)
    out = []
    for k in range(n - 1, max(21, n - look) - 1, -1):
        x, p = (b[k], b[k - 1])
        rng = x['h'] - x['l']
        if rng <= 0:
            continue
        av = sum((y['v'] for y in b[max(0, k - 50):k])) / max(1, min(50, k))
        vm = x['v'] / av if av else 0
        cp = (x['c'] - x['l']) / rng
        body = abs(x['c'] - x['o'])
        a = atr(b, k) or rng
        e20, e9, s50 = (X['e20'][k], X['e9'][k], X['s50'][k])
        ev = []
        ref_k = min(range(max(0, k - 15), k - 1), key=lambda j: b[j]['l'])
        ref = b[ref_k]['l']
        swing = all((b[ref_k]['l'] <= b[j]['l'] for j in range(max(0, ref_k - 3), min(k, ref_k + 3))))
        trend_ok = s50 and x['c'] >= 0.97 * s50
        flush = (max((y['h'] for y in b[k - 3:k])) - x['l']) / a > 3.3
        if ref * 0.95 <= x['l'] < ref < x['c'] and cp >= 0.5 and swing and trend_ok and (not flush):
            near = ' at the 20EMA' if abs(x['l'] / e20 - 1) <= 0.03 else ' at the 50SMA' if s50 and abs(x['l'] / s50 - 1) <= 0.03 else ''
            spring = ref <= min((y['l'] for y in b[max(0, k - 40):k - 1]))
            ev.append(('UnR · failed breakdown' if spring else 'UnR', 'undercut the %s low (%.2f)%s and closed back above%s' % (md(b[ref_k]['t']), ref, ', the low of the last 8 weeks' if spring else '', near), 'low'))
        downv = [b[j]['v'] for j in range(k - 10, k) if b[j]['c'] < b[j - 1]['c']]
        off_ma = min(x['l'], p['l']) <= max(e9, e20) * 1.01 and x['c'] > max(e9, e20)
        if x['c'] > p['c'] and downv and (x['v'] > max(downv)) and off_ma and s50 and (x['c'] > s50) and (vm >= 1.2) and (cp >= 0.5) and (not ev):
            ev.append(('Pocket pivot', 'up-day volume (%.1fx) above every down day of the last 10' % vm, 'low'))
        if p['c'] > p['o'] and x['o'] >= p['c'] and (x['c'] < p['o']) and (vm >= 1.5) and (cp <= 0.35) and e20 and (p['c'] < e20) and (x['h'] >= 0.99 * e20) and (x['c'] < e20):
            ev.append(('Bearish engulfing · 20EMA rejection', 'opened over the prior close and closed under the prior open on %.1fx volume, rejected at the 20EMA (%.2f)' % (vm, e20), 'high'))
        top_v = x['v'] >= max((y['v'] for y in b[max(0, k - 60):k]))
        first_bo = x['c'] > max((y['h'] for y in b[k - 20:k])) and p['c'] <= max((y['h'] for y in b[k - 21:k - 1]))
        catalyst = x['c'] - p['c'] >= 3 * a and vm >= 4
        if vm >= 3 and cp >= 0.6 and top_v and (rng >= a) and (x['o'] > p['h'] or first_bo or catalyst):
            ev.append(('HVC', 'high-volume close: %.1fx, the biggest volume in 3 months, on a gap / breakout, closed at %.2f' % (vm, x['c']), 'high'))
        elif vm >= 2.0 and cp <= 0.35:
            ev.append(('Heavy volume, closed weak', '%.1fx volume but closed near the low: sellers into strength' % vm, 'high'))
        if x['o'] > p['h'] and x['o'] / p['c'] - 1 >= 0.02:
            ev.append(('Gap up', 'gapped up %.1f%% on %.1fx volume' % (100 * (x['o'] / p['c'] - 1), vm), 'low'))
        elif x['o'] <= p['l'] * 1.005 and x['l'] <= p['l'] * 0.99 and (x['c'] >= p['l'] * 0.995) and (cp >= 0.5) and s50 and (x['c'] >= 0.95 * s50) and (x['c'] > p['c']) and (x['l'] <= 1.01 * min((y['l'] for y in b[k - 5:k]))) and (x['c'] >= p['c'] * 1.003 or x['c'] >= e20):
            ev.append(('Oops reversal', 'opened at/under the prior low (%.2f), undercut it and closed over the prior close' % p['l'], 'low'))
        elif x['l'] <= p['l'] * 0.97 and x['c'] > p['c'] and (cp >= 0.9) and s50 and (x['c'] >= 0.95 * s50) and (vm >= 1.0):
            ev.append(('Oops reversal', 'undercut the prior low (%.2f) by %.0f%% and closed at the top, over the prior close' % (p['l'], 100 * (1 - x['l'] / p['l'])), 'low'))
        elif x['o'] < p['l'] * 0.998 and x['c'] > p['l'] and (x['c'] >= p['c'] * 1.003) and (cp >= 0.6) and s50 and (x['c'] >= 0.95 * s50) and (abs(x['l'] / e20 - 1) <= 0.03 or abs(x['l'] / s50 - 1) <= 0.03):
            ev.append(('Oops reversal', 'opened under the prior low (%.2f) and closed back over the prior close, near the high (Williams oops)' % p['l'], 'low'))
        elif x['o'] < p['l'] and 1 - x['o'] / p['c'] >= 0.08 and (vm >= 3):
            ev.append(('ER breakdown', 'gapped down %.1f%% on %.1fx volume (likely earnings): no swing trade area' % (100 * (1 - x['o'] / p['c']), vm), 'high'))
        elif x['c'] <= 0.85 * p['c'] and vm >= 3 and s50 and (x['c'] < s50):
            ev.append(('Breakdown on news', 'closed %.0f%% down on %.1fx volume (news): no swing trade area' % (100 * (1 - x['c'] / p['c']), vm), 'high'))
        elif x['o'] < p['l'] and 1 - x['o'] / p['c'] >= 0.02:
            ev.append(('Gap down', 'gapped down %.1f%% on %.1fx volume' % (100 * (1 - x['o'] / p['c']), vm), 'high'))
        pb6 = x['l'] <= 0.94 * max((y['h'] for y in b[k - 10:k]))
        at_ma = abs(x['l'] / e20 - 1) <= 0.03 or (s50 and abs(x['l'] / s50 - 1) <= 0.03)
        if x['l'] < p['l'] and x['c'] > p['h'] and (x['o'] <= p['l'] * 1.005) and (vm >= 1.2) and (cp >= 0.7) and (at_ma or pb6) and (not any((e[0] == 'Oops reversal' for e in ev))):
            ev.append(('Oops reversal', 'opened at the prior low (%.2f), undercut it and closed over the prior high on %.1fx volume' % (p['l'], vm), 'low'))
        elif x['l'] < p['l'] and x['c'] > p['h'] and (not any((e[0] == 'Oops reversal' for e in ev))) and (vm >= 1.2) and (abs(x['l'] / e20 - 1) <= 0.03 or (s50 and abs(x['l'] / s50 - 1) <= 0.03)):
            ev.append(('Outside reversal', 'took out the prior low, then closed above the prior high', 'low'))
        lw = min(x['o'], x['c']) - x['l']
        if lw >= 2 * body and lw >= 0.55 * rng and (cp >= 0.6) and (abs(x['l'] / e20 - 1) <= 0.02 or (s50 and abs(x['l'] / s50 - 1) <= 0.02)):
            ev.append(('Hammer at support', 'long lower wick off the %s, closed in the top of its range' % ('20EMA' if abs(x['l'] / e20 - 1) <= 0.02 else '50SMA'), 'low'))
        uw = x['h'] - max(x['o'], x['c'])
        if uw >= 0.55 * rng and cp <= 0.4 and (x['h'] >= max((y['h'] for y in b[k - 20:k]))):
            ev.append(('Reversal off highs', 'new 20-day high rejected: long upper wick, closed near the low', 'high'))
        below = sum((b[j]['c'] < X['e20'][j] for j in range(k - 6, k))) >= 4
        s50r = X['s50'][k - 10] and s50 > X['s50'][k - 10]
        s200 = X['s200'][k]
        if below and x['c'] > e20 and (x['c'] > e9) and (cp >= 0.3) and s50 and (x['c'] > s50) and s50r and (not s200 or x['c'] > s200):
            ev.append(('MA remount', 'first close back over the 9 and 20 EMA (4 of the last 6 closes were under the 20), holding the 50SMA', 'low'))
        if all((e[0] == 'Gap down' for e in ev)) and e20 > X['e20'][k - 5] and s50 and (x['c'] > s50) and (0.99 * e20 <= x['l'] <= 1.015 * e20) and (x['c'] >= e20) and (cp >= 0.5):
            ev = [e for e in ev if e[0] != 'Gap down']
            ev.append(('20EMA tap', 'tapped the rising 20EMA (%.2f) and held it' % e20, 'low'))
        hi10 = max((y['h'] for y in b[k - 10:k]))
        lo10 = min((y['l'] for y in b[k - 10:k]))
        if x['c'] > hi10 and hi10 / lo10 - 1 <= 0.15 and (cp >= 0.7) and (vm >= 1.0) and s50 and (x['c'] > s50):
            ev.append(('Range breakout', 'closed over the 10-day range high %.2f (a %.0f%% range) on %.1fx volume' % (hi10, 100 * (hi10 / lo10 - 1), vm), 'low'))
        if kicker(b, k):
            ev.append(('Kicker', 'a red day, then an open over its open (gap +%.1f%%) and a strong close on %.1fx volume' % (100 * (x['o'] / p['c'] - 1), vm), 'low'))
        q = b[k - 2]
        sup_ = min(x['l'], p['l']) <= 1.03 * max(e9, e20) and min(x['l'], p['l']) >= 0.97 * min(e20, s50 or e20)
        if k >= 3 and p['h'] <= q['h'] and (p['l'] >= q['l']) and (x['c'] > q['h']) and (cp >= 0.6) and (vm >= 1.0) and s50 and (x['c'] > s50) and (p['h'] - p['l'] <= 0.8 * a) and sup_:
            two_ = b[k - 3]['h'] >= q['h'] and b[k - 3]['l'] <= q['l']
            ev.append(('Double inside bar break' if two_ else 'Inside bar break', 'closed over the %s high %.2f%s on %.1fx volume' % ("inside bars'" if two_ else "inside bar's mother", q['h'], '' if two_ else ' (the inside day was %s)' % md(p['t']), vm), 'low'))
        if x['h'] <= p['h'] and x['l'] >= p['l']:
            two = b[k - 2]['h'] >= p['h'] and b[k - 2]['l'] <= p['l']
            ev.append(('Inside day', ('2nd inside day in a row' if two else "inside the prior day's range") + ', volume %.1fx' % vm, 'high'))
        cl = [b[j]['c'] for j in range(k - 2, k + 1)]
        if max(cl) / min(cl) - 1 <= 0.01 and (not any((e[0] == 'Inside day' for e in ev))):
            ev.append(('Tight closes', '3 closes within 1%% (%.2f-%.2f)' % (min(cl), max(cl)), 'high'))
        if vm <= 0.5 and rng <= 0.6 * a and (not ev):
            ev.append(('Quiet day', 'narrow range on %.1fx volume: selling dried up' % vm, 'high'))
        if any((e[0] == 'Pocket pivot' for e in ev)) and any((e[0] == 'MA remount' for e in ev)):
            ev = [('Pocket pivot · MA remount', next((e[1] for e in ev if e[0] == 'Pocket pivot')) + '; the first close back over the 9/20 EMA', 'low') if e[0] == 'Pocket pivot' else e for e in ev if e[0] != 'MA remount']
        if any((e[0].endswith('nside bar break') for e in ev)):
            ev = [e for e in ev if e[0] not in ('20EMA tap', 'Range breakout')]
        ev.sort(key=lambda e: 3.0 if e[0].endswith('nside bar break') else 2.9 if e[0] == 'Pocket pivot · MA remount' else RANK.get(e[0], RANK.get(e[0].split(' ·')[0], 4)))
        for name, text, at in ev:
            out.append((k, name, text, at))
    return out

def flag_at_highs(b, X=None):
    n = len(b)
    if n < 70:
        return None
    adr = sum((x['h'] / x['l'] - 1 for x in b[-20:])) / 20
    lim = min(0.1, max(0.06, 2.5 * adr))
    hi60 = max((x['h'] for x in b[-60:]))
    s = None
    for k in range(n - 1, n - 41, -1):
        top, low = (max((x['h'] for x in b[k:])), min((x['l'] for x in b[k:])))
        if top / low - 1 > lim:
            break
        s = k
    if s is None or n - s < 5:
        return None
    top, low = (max((x['h'] for x in b[s:])), min((x['l'] for x in b[s:])))
    if top < 0.97 * hi60 or b[-1]['c'] < low or b[-1]['c'] > top * 1.03:
        return None
    if top / min((x['l'] for x in b[max(0, s - 30):s])) - 1 < 0.12:
        return None
    return (s, top, low)

def _pct(a, b_):
    return 100 * (a / b_ - 1)

def higher_low(b, X=None, look=60):
    X = X or ctx(b)
    n = len(b)
    s50 = X['s50']
    if n < 70 or not s50[-1] or b[-1]['c'] < s50[-1] or (not s50[-11]) or (s50[-1] <= s50[-11]):
        return None
    sw = [k for k in range(n - look, n - 3) if all((b[k]['l'] <= b[j]['l'] for j in range(k - 3, k + 4) if j != k))]
    if len(sw) < 2:
        return None
    k0, k1 = (sw[-2], sw[-1])
    if b[k1]['l'] > b[k0]['l'] * 1.01 and n - 1 - k1 <= 25 and (k1 - k0 >= 5):
        if min((b[j]['c'] for j in range(k1, n))) < b[k1]['l']:
            return None
        return (k0, k1)
    return None

def news_crash(b, look=20):
    n = len(b)
    for k in range(n - 1, max(51, n - look) - 1, -1):
        p, x = (b[k - 1], b[k])
        av = sum((y['v'] for y in b[k - 50:k])) / 50
        vm = x['v'] / av if av else 0
        s50k = sum((y['c'] for y in b[k - 49:k + 1])) / 50
        if vm >= 3 and (x['c'] <= 0.85 * p['c'] or (x['o'] < p['l'] and x['o'] <= 0.92 * p['c'])) and (b[-1]['c'] <= 0.85 * p['c']) and (x['c'] < s50k):
            return (k, 100 * (1 - x['c'] / p['c']), vm)
    return None

def failed_breakout(b, X=None, look=30):
    n = len(b)
    if n < 60:
        return None
    br = [k for k, st, _ in cycle_events(b) if st == "Base n' break" and n - 1 - k <= look]
    if not br:
        return None
    kb = br[-1]
    top = max((x['h'] for x in b[kb - 10:kb]))
    s200 = sum((x['c'] for x in b[kb - 199:kb + 1])) / 200 if kb >= 199 else None
    if s200 and b[kb]['c'] < s200:
        return None
    return (kb, top) if b[-1]['c'] < 0.95 * min(b[kb]['l'], top) else None

def slingshot_watch(b, X=None):
    X = X or ctx(b)
    n = len(b)
    k = n - 1
    if n < 60 or not X['s50'][k] or b[k]['c'] < X['s50'][k] or (b[k]['c'] < X['e20'][k]):
        return None
    e4 = ema([x['h'] for x in b], 4)
    if not all((b[j]['c'] < e4[j] for j in range(k - 2, k + 1))):
        return None
    for j in range(n - 25, n - 3):
        av = sum((x['v'] for x in b[max(0, j - 50):j])) / max(1, min(50, j))
        if b[j]['c'] / b[j - 1]['c'] - 1 >= 0.04 and b[j]['v'] >= 1.5 * av or b[j]['o'] / b[j - 1]['c'] - 1 >= 0.08:
            return round(e4[k], 2)
    return None

def card(b, objs, dates, X=None, events=None):
    n_ = len(b)
    X = X or ctx(b)
    n = len(b)
    k = n - 1
    c = b[k]['c']
    e9, e20, s50, s200 = (X['e9'][k], X['e20'][k], X['s50'][k], X['s200'][k])
    a = atr(b, k)
    adr = 100 * sum((x['h'] / x['l'] - 1 for x in b[-20:])) / 20
    rising = lambda s, m=10: s[k] is not None and s[k - m] is not None and (s[k] > s[k - m])
    hi = max((x['h'] for x in b[-252:]))
    lines = []
    if s50 and c > e20 > s50 and rising(X['e20']) and rising(X['s50']) and (not s200 or s50 > s200):
        t = 'Uptrend: over a rising 20EMA and 50SMA' + (', 50 over the 200' if s200 else '')
        if c < e9:
            t += ', dipped under the 9EMA'
    elif s50 and c > s50 and rising(X['s50']):
        t = 'Uptrend, pulling back: under the 20EMA, holding the rising 50SMA'
    elif s50 and c < s50 and (not rising(X['s50'])):
        t = 'Downtrend: under a falling 50SMA' + (' and the 200SMA' if s200 and c < s200 else '')
    elif s50 and c < s50:
        t = 'Lost the 50SMA (still rising): watch whether it reclaims'
    else:
        t = 'Sideways: chopping around the 20EMA / 50SMA'
    ext = (c - e20) / a if a else 0
    t += ' · %+.0f%% vs 50SMA' % _pct(c, s50) if s50 else ''
    t += ' · %.1f ATR %s the 20EMA' % (abs(ext), 'over' if ext >= 0 else 'under')
    t += ' · %.0f%% off the 52-week high' % -_pct(c, hi) if c < hi * 0.995 else ' · at the 52-week high'
    for nm_, ma_ in (('20EMA', X['e20']), ('50SMA', X['s50'])):
        hk = []
        for j in range(max(1, n_ - 30), n_):
            if ma_[j] and ma_[j - 1] and (ma_[j] > ma_[max(0, j - 5)]) and (b[j]['l'] <= ma_[j] * 1.01) and (b[j]['c'] >= ma_[j] * 0.995) and (b[j]['c'] >= b[j]['l'] + 0.5 * (b[j]['h'] - b[j]['l'])) and (not hk or j - hk[-1] >= 3):
                hk.append(j)
        if len(hk) >= 2 and c > (ma_[-1] or 0):
            t += ' · held the rising %s %dx (%s)' % (nm_, len(hk), ', '.join((md(b[j]['t']) for j in hk[-3:])))
            break
    lines.append(('Trend', t))
    cl_ = cycle_line(b, cycle_events(b))
    leg_ = cycle_leg(confirmed(b, cycle_events(b)))
    k0_ = leg_[0][0] if leg_ else n_
    old_ = []
    for e in confirmed(b, cycle_events(b, look=200)):
        if e[0] < k0_ - 5 and (old_ or e[1] != 'Wedge drop') and (not (old_ and old_[-1][1] == e[1])):
            old_.append(e)
    if old_:
        txt_ = ['%s %s' % (s, md(b[k]['t'])) for k, s, _ in old_]
        cl_ += ' · earlier: ' + ' -> '.join(txt_ if len(txt_) <= 6 else txt_[:3] + ['...'] + txt_[-2:])
    lines.append(('Cycle', cl_))
    pats = []
    for o in objs:
        if o['kind'] in ('base', 'double_bottom') and o.get('start') in dates:
            s0 = dates.index(o['start'])
            e0 = dates.index(o['end']) if o.get('end') in dates else len(dates) - 1
            wk = max(1, round((e0 - s0 + 1) / 5))
            top = o.get('line') or o.get('pivot') or o.get('buy_point')
            lo = o.get('low') or o.get('low1')
            d = ' %d%% deep' % round(100 * (1 - lo / top)) if top and lo else ''
            bp = o.get('buy_point') or o.get('pivot')
            where = ''
            if bp:
                g = _pct(c, bp)
                where = ', buy point %.2f is %.1f%% above' % (bp, _pct(bp, c)) if g < 0 else ', %.1f%% past its buy point %.2f' % (g, bp) + (' (in the buy zone)' if g <= 5 else ' (extended)')
            pats.append('%s, %d wk%s%s%s' % (o.get('ptype') or 'Base', wk, 's' if wk > 1 else '', ',' + d if d else '', where))
    lines.append(('Pattern', '; '.join(pats[:2]) if pats else 'No base right now'))
    names = [o.get('ptype') or '' for o in objs]
    ev = events if events is not None else candle_events(b, X)
    fl = next((o for o in objs if o.get('ptype') == 'Flag at highs'), None)
    hold = next((o for o in objs if 'buy an UnR of' in (o.get('ptype') or '')), None)
    unr = next((e for e in ev if e[1].startswith('UnR') and e[0] >= k - 2), None)
    oo = next((e for e in ev if e[1].startswith('Oops reversal') and e[0] >= k - 3), None)
    hl0 = higher_low(b, X)
    if not oo:
        oo = next((e for e in ev if e[1].startswith('Outside reversal') and e[0] >= k - 3), None)
    ideal = oo if oo and hl0 and (abs(oo[0] - hl0[1]) <= 3) else None
    hl = higher_low(b, X)
    sl = slingshot_watch(b, X)
    if hl and c > b[hl[1]]['l'] * 1.08:
        hl = None
    fb = failed_breakout(b, X)
    nc = news_crash(b)
    if nc:
        s = 'No long setup: broke down on news on %s (%.0f%% on %.1fx volume); no swing trade area, let it base for weeks first' % (md(b[nc[0]]['t']), nc[1], nc[2])
    elif fb:
        s = 'Failed breakout: the %s break over %.2f closed back under the base (now %.1f%% below it); no long until it reclaims %.2f or builds a new base' % (md(b[fb[0]]['t']), fb[1], -_pct(c, fb[1]), fb[1])
    elif ideal:
        x = b[ideal[0]]
        s = 'Oops reversal at a higher low on %s: THE buy. Entry over its high %.2f, stop under its low %.2f (%.1f%% risk)' % (md(x['t']), x['h'], x['l'], 100 * (1 - x['l'] / x['h']))
    elif fl:
        risk = _pct(fl['low'], fl['line'])
        s = "Flag at highs (top %.2f): buy it at support, not up at the top: a shakeout / UnR / oops or a hold of the 20EMA (%.2f) and remount, triggered by a break of the prior day's high or a red-to-green move; stop under that day's low. A close over %.2f is the add, not the first buy (flag low %.2f, %.1f%% under the top)" % (fl['line'], e20, fl['line'], fl['low'], -risk)
    elif unr:
        x = b[unr[0]]
        s = 'UnR on %s: entry over its high %.2f, stop under its low %.2f' % (md(x['t']), x['h'], x['l'])
    elif hold:
        s = 'Buy an UnR of the %.2f hold (%.1f%% below), stop just under the undercut' % (hold['price'], -_pct(hold['price'], c))
    elif hl:
        s = 'Higher low %.2f on %s, over the %s low %.2f: buy the hold, stop under %.2f' % (b[hl[1]]['l'], md(b[hl[1]]['t']), md(b[hl[0]]['t']), b[hl[0]]['l'], b[hl[1]]['l'])
    elif sl:
        s = "Slingshot watch: a close over the 4-day EMA of highs (%.2f) triggers it; stop under today's low %.2f" % (sl, b[k]['l'])
    elif ext >= 3 or (s50 and c / s50 > 1.3):
        s = 'Extended (%.1f ATR over the 20EMA): wait for a pullback to the 9/20EMA or a new base' % ext
    elif s50 and rising(X['e20']) and (c > s50) and (min((x['l'] for x in b[-2:])) <= e20 * 1.015) and (c >= e20 * 0.98):
        s = "Pullback to the rising 20EMA (%.2f): the buy is an oops reversal / UnR there, or a reclaim of the 9EMA (%.2f), triggered by a break of the prior day's high (%.2f)" % (e20, e9, b[-1]['h'])
    elif s50 and c < s50 and (not rising(X['s50'])):
        re_ = [e for e in cycle_leg(confirmed(b, cycle_events(b))) if e[1] == 'Reversal extension' and len(b) - 1 - e[0] <= 40]
        if re_ and abs(c / e20 - 1) <= 0.05:
            s = "Reversal-extension leg near the 20EMA, still under a falling 50SMA: the buy is an oops reversal / reclaim of the 9-20EMA (%.2f-%.2f), or a break of today's high %.2f (tomorrow's prior-day high); stop under today's low %.2f. Second-tier: size down" % (min(e9, e20), max(e9, e20), b[-1]['h'], b[-1]['l'])
        else:
            s = 'No long setup under a falling 50SMA'
    else:
        bp = next((o.get('buy_point') for o in objs if o['kind'] == 'base' and o.get('buy_point') and (o['buy_point'] > c)), None)
        s = 'Building: buy point %.2f is %.1f%% above' % (bp, _pct(bp, c)) if bp else 'No clean entry today: let it set up'
    if s200 and c < s200 and (not s.startswith('No long setup')):
        s += ' · under the 200SMA: second-tier, size down'
    lines.append(('Setup', s))
    x = b[k]
    rng = x['h'] - x['l']
    cp = (x['c'] - x['l']) / rng if rng else 0.5
    av = sum((y['v'] for y in b[k - 50:k])) / 50
    vm = x['v'] / av if av else 0
    shape = 'up day' if x['c'] > b[k - 1]['c'] else 'down day'
    last = '%s %s, closed %s of its range, %.1fx volume' % (md(x['t']), shape, 'in the top third' if cp >= 0.67 else 'in the bottom third' if cp <= 0.33 else 'mid', vm)
    today = [e for e in ev if e[0] == k]
    if today:
        last = '%s %s (%s)' % (md(x['t']), ' + '.join((e[1] for e in today)), today[0][2])
    seen, older = (set(), [])
    for e in ev:
        if e[0] < k and e[1] not in seen and (len(older) < 3):
            seen.add(e[1])
            older.append('%s %s' % (md(b[e[0]]['t']), e[1]))
    lines.append(('Candles', last + (' · earlier: ' + ', '.join(older) if older else '')))
    v5 = sum((y['v'] for y in b[-5:])) / 5 / av if av else 0
    big = max(range(n - 20, n), key=lambda j: b[j]['v'])
    vb = b[big]['v'] / av if av else 0
    vt = 'Last 5 days %.1fx the 50-day average (%s)' % (v5, 'drying up' if v5 <= 0.75 else 'heavy' if v5 >= 1.5 else 'normal')
    vt += ' · biggest day in 20: %s, %.1fx, %s' % (md(b[big]['t']), vb, 'up' if b[big]['c'] >= b[big - 1]['c'] else 'down')
    vt += ' · ADR %.1f%%' % adr
    lines.append(('Volume', vt))
    lines.append(('Gaps', gaps_line(b, drendel_gaps(b))))
    return lines
CYCLE = ('Reversal extension', 'Wedge pop', 'EMA crossback', "Base n' break", 'Exhaustion extension', 'Wedge drop')
NEXT = {'Reversal extension': 'next: a wedge pop back over the 10/20 EMA', 'Wedge pop': 'next: buy the first EMA crossback (pullback to the 10/20 EMA that holds)', 'EMA crossback': 'the buy: hold over the 10/20 EMA, stop under the crossback low', "Base n' break": 'next: ride it; trim into an exhaustion extension', 'Exhaustion extension': "next: expect a pullback or a wedge drop; don't chase", 'Wedge drop': 'next: stay out; wait for a reversal extension and a new wedge pop'}

def cycle_events(b, look=120):
    c = [x['c'] for x in b]
    e10, e20 = (ema(c, 10), ema(c, 20))
    n = len(b)
    out = []
    last = None
    since_pop = None
    ext_on = False
    for k in range(max(25, n - look), n):
        x = b[k]
        rng = x['h'] - x['l'] or 1e-09
        cp = (x['c'] - x['l']) / rng
        a = atr(b, k) or rng
        lo_ema, hi_ema = (min(e10[k], e20[k]), max(e10[k], e20[k]))
        up20 = e20[k] > e20[k - 5]
        st = None
        t = ''
        if x['l'] <= e20[k] - CYC['rev_atr'] * a and (not up20) and (cp >= 0.5) and (last != 'Reversal extension'):
            st, t = ('Reversal extension', 'stretched %.1f ATR under the 20EMA, then closed in the top half' % ((e20[k] - x['l']) / a))
        av = sum((y['v'] for y in b[max(0, k - 50):k])) / max(1, min(50, k))
        if st:
            pass
        elif last != 'Wedge pop' and sum((c[j] < e20[j] for j in range(k - 15, k))) >= CYC['pop_under'] and (sum((b[j]['h'] - b[j]['l'] for j in range(k - 5, k))) / 5 < 0.85 * sum((b[j]['h'] - b[j]['l'] for j in range(k - 15, k - 5))) / 10 or any((b[j]['l'] < b[j - 1]['l'] * 0.99 and c[j] > c[j - 1] for j in range(k - 3, k)))) and (x['c'] > hi_ema) and (cp >= 0.6) and (x['v'] >= CYC['pop_vol'] * av) and (x['c'] > max((y['h'] for y in b[k - CYC['pop_hi']:k]))) and (not (x['c'] - c[k - 1] >= 3 * a and x['v'] >= 4 * av)) and (not (last == 'EMA crossback' and out and (k - out[-1][0] < 10))):
            st, t = ('Wedge pop', 'popped out of a tightening pullback, over the 10/20 EMA and the last 5 highs on %.1fx volume' % (x['v'] / av if av else 0))
            since_pop = k
        elif last in ('Wedge drop', 'Reversal extension') and all((c[j] > max(e10[j], e20[j]) for j in range(k - 2, k + 1))):
            st, t = ('Back over the EMAs', '3 closes back over the 10 and 20 EMA (no real pop)')
            since_pop = k - 2
        elif since_pop is not None and last in ('Wedge pop', 'Back over the EMAs', "Base n' break", 'Exhaustion extension') and (k - since_pop >= 3) and up20 and (x['l'] <= e20[k] * 1.02) and (x['c'] >= e20[k]) and (sum((b[j]['l'] > e10[j] for j in range(k - 3, k))) >= CYC['xb_prior']) and (cp >= 0.5):
            st, t = ('EMA crossback', 'first pullback into the 10/20 EMA (%.2f) held' % e20[k])
        elif last in ('EMA crossback', 'Wedge pop', 'Back over the EMAs', "Base n' break", 'Exhaustion extension') and x['c'] > max((y['h'] for y in b[k - 10:k])) and (x['c'] > e10[k] > e20[k]) and (max((y['h'] for y in b[k - 10:k])) / min((y['l'] for y in b[k - 10:k])) - 1 <= 0.15) and (k - (out[-1][0] if out else 0) >= 8):
            st, t = ("Base n' break", 'broke out of a %d-day base above the EMAs' % 10)
        elif x['c'] >= e20[k] + 3.5 * a and up20 and (not ext_on):
            st, t = ('Exhaustion extension', '%.1f ATR over the 20EMA: stretched' % ((x['c'] - e20[k]) / a))
        elif sum((c[j] > e20[j] for j in range(k - 10, k))) >= 8 and x['c'] < lo_ema and (cp <= 0.4) and (x['c'] < min((y['l'] for y in b[k - 3:k]))) and (last not in ('Wedge drop', 'Reversal extension')):
            st, t = ('Wedge drop', 'lost the 10 and 20 EMA (and the last 3 lows) after a run over them')
        if st == 'Exhaustion extension':
            ext_on = True
        elif x['c'] < e20[k] + 2.0 * a:
            ext_on = False
        if st:
            out.append((k, st, t))
            last = st
    return out
CYC = {'pop_under': 8, 'rev_atr': 2.5, 'xb_prior': 3, 'pending': 3, 'pop_vol': 1.05, 'pop_hi': 5}
BULL = ('Reversal extension', 'Wedge pop', 'Back over the EMAs', 'EMA crossback', "Base n' break", 'Exhaustion extension')
SHOW = ('Reversal extension', 'Wedge pop', 'EMA crossback')

def cycle_leg(ev):
    if not ev:
        return []
    if ev[-1][1] == 'Wedge drop':
        return ev[-1:]
    leg = []
    for e in reversed(ev):
        if e[1] == 'Wedge drop':
            break
        leg.insert(0, e)
    seen = set()
    return [e for e in leg if not (e[1] in seen or seen.add(e[1]))]

def confirmed(b, ev):
    out = []
    for k, st, t in ev:
        if st == 'Reversal extension':
            ok = False
            for j in range(k + 1, min(len(b), k + 11)):
                if b[j]['l'] < b[k]['l']:
                    break
                if b[j]['c'] > b[k]['h']:
                    ok = True
                    break
            if not ok:
                if not (CYC['pending'] and len(b) - 1 - k <= CYC['pending'] and all((b[j]['l'] >= b[k]['l'] for j in range(k + 1, len(b))))):
                    continue
                t = t + '; not confirmed yet: needs a close over its high %.2f' % b[k]['h']
        elif st in ('Wedge pop', 'EMA crossback') and any((b[j]['c'] < b[k]['l'] for j in range(k + 1, len(b)))):
            continue
        out.append((k, st, t))
    return out

def wedge_drop(b, ev, within=40):
    d = next((e for e in reversed(ev) if e[1] == 'Wedge drop'), None)
    if not d or len(b) - 1 - d[0] > within or d[0] >= len(b) - 1:
        return None
    c = [x['c'] for x in b]
    e20 = ema(c, 20)
    k = d[0]
    av = sum((x['v'] for x in b[max(0, k - 50):k])) / max(1, min(50, k))
    run = c[k - 1] / min((x['l'] for x in b[max(0, k - 30):k])) - 1
    if b[k]['v'] < 1.2 * av or run < 0.12:
        return None
    a = atr(b, k) or 1e-09
    if e20[k] / e20[k - 10] - 1 < 0.025 or max(((c[j] - e20[j]) / a for j in range(k - 15, k))) < 1.5:
        return None
    if any((c[j] > b[k]['h'] or c[j] > e20[j] for j in range(k + 1, min(len(b), k + 3)))):
        return None
    if any((c[j] > e20[j] * 1.02 for j in range(k + 1, min(len(b), k + 4)))):
        return None
    if any((b[j]['o'] <= b[k]['l'] * 1.005 and b[j]['l'] < b[k]['l'] and (c[j] > c[k]) for j in range(k + 1, min(len(b), k + 3)))):
        return None
    return d

def cycle_line(b, ev):
    ev = confirmed(b, ev)
    leg = [e for e in cycle_leg(ev) if e[1] in SHOW]
    if ev and ev[-1][1] == 'Wedge drop':
        return 'Lost the 10/20 EMA on %s: no long cycle now · next: wait for a reversal extension, then a wedge pop' % md(b[ev[-1][0]]['t'])
    if leg and leg[-1][1] == 'Reversal extension' and (len(b) - 1 - leg[-1][0] > 30):
        leg = []
    if not leg:
        return 'No clean cycle signal yet (no reversal extension, wedge pop or EMA crossback in this leg)'
    path = ' -> '.join(('%s %s' % (s, md(b[k]['t'])) for k, s, _ in leg[-3:]))
    ago = len(b) - 1 - leg[-1][0]
    return '%s · now: %s%s · %s' % (path, leg[-1][1], ' (%d days ago)' % ago if ago > 15 else '', NEXT[leg[-1][1]])
GAP_COLOR = {'untested': '#9ca3af', 'support': '#34d399', 'resistance': '#f87171'}

def drendel_gaps(b, look=150):
    n = len(b)
    out = []
    for k in range(max(51, n - look), n):
        p, x = (b[k - 1], b[k])
        up, dn = (x['l'] > p['c'], x['h'] < p['c'])
        if not (up or dn):
            continue
        av = sum((y['v'] for y in b[k - 50:k])) / 50
        vm = x['v'] / av if av else 0
        pct = abs(x['o'] / p['c'] - 1)
        if not (pct >= 0.03 and vm >= 1.5 or (pct >= 0.015 and vm >= 2.5)):
            continue
        bot, top = (p['c'], x['l']) if up else (x['h'], p['c'])
        touched, filled = (False, False)
        for j in range(k + 1, n):
            y = b[j]
            if up:
                if y['c'] < bot:
                    filled = True
                    break
                if y['c'] < top:
                    top = y['c']
                touched |= y['l'] <= top
            else:
                if y['c'] > top:
                    filled = True
                    break
                if y['c'] > bot:
                    bot = y['c']
                touched |= y['h'] >= bot
            if top <= bot:
                filled = True
                break
        if filled or (top - bot) / bot < 0.003:
            continue
        state = ('support' if up else 'resistance') if touched else 'untested'
        out.append({'k': k, 'up': up, 'bot': bot, 'top': top, 'state': state, 'pct': 100 * pct, 'vm': vm})
    return out

def gaps_line(b, gs):
    if not gs:
        return 'No notable unfilled gaps'
    c = b[-1]['c']
    parts = []
    for g in sorted(gs, key=lambda g: abs((g['top'] + g['bot']) / 2 / c - 1))[:3]:
        parts.append('%s %s %+.1f%% on %.1fx, unfilled %.2f-%.2f (%s, %s)' % (md(b[g['k']]['t']), 'gap up' if g['up'] else 'gap down', g['pct'] if g['up'] else -g['pct'], g['vm'], g['bot'], g['top'], g['state'], 'below' if g['top'] < c else 'above' if g['bot'] > c else 'price inside it'))
    return ' · '.join(parts)
TREND_T = [('Uptrend: over a rising 20EMA and 50SMA, 50 over the 200, dipped under the 9EMA', 'an uptrend over its rising MAs, dipping to the 9EMA'), ('Uptrend: over a rising 20EMA and 50SMA', 'an uptrend over its rising MAs'), ('Uptrend, pulling back', 'an uptrend pulling back under the 20EMA but holding the rising 50SMA'), ('Sideways', 'a sideways range, chopping around its MAs'), ('Lost the 50SMA', 'a name that just lost its rising 50SMA'), ('Downtrend: under a falling 50SMA and the 200SMA', 'a downtrend under a falling 50SMA and the 200SMA'), ('Downtrend', 'a downtrend under a falling 50SMA')]
BEAR_MARKS = ('Wedge drop', 'Heavy volume, closed weak', 'Reversal off highs', 'Bearish engulfing', 'Gap down', 'Exhaustion extension', 'Failed breakout', 'Breakdown', 'Breakdown on news')
BUYFAM = ('UnR', 'Oops reversal', '20EMA tap', 'Inside bar break', 'Double inside bar break', 'Kicker', 'HVC', 'MA remount', 'Pocket pivot · MA remount', 'Hammer at support', 'Higher low', 'Outside reversal', 'EMA crossback', 'Wedge pop', 'Reversal extension', 'ER gap')
STRONG = ('Kicker', 'HVC', 'ER gap', 'Reversal extension', 'Wedge pop')

def best_buy_days(b, X=None, look=40):
    X = X or ctx(b)
    n = len(b)
    if n < 80:
        return []
    ev = [(k, nm) for k, nm, _, _ in candle_events(b, X, look=look)]
    ev += [(k, st) for k, st, _ in confirmed(b, cycle_events(b, look=look + 30)) if st in ('EMA crossback', 'Wedge pop', 'Reversal extension') and k >= n - look]
    for k in range(max(51, n - look), n):
        av = sum((y['v'] for y in b[k - 50:k])) / 50
        if b[k]['o'] / b[k - 1]['c'] - 1 >= 0.05 and av and (b[k]['v'] >= 2.5 * av):
            ev.append((k, 'ER gap'))
    nc = news_crash(b)
    if nc:
        ev = [e for e in ev if e[0] < nc[0]]
    best = {}
    for k, nm in ev:
        base = nm.split(' ·')[0] if nm not in BUYFAM else nm
        if base not in BUYFAM and nm not in BUYFAM:
            continue
        x = b[k]
        e9, e20, s50 = (X['e9'][k], X['e20'][k], X['s50'][k])
        sup = any((m and abs(x['l'] / m - 1) <= 0.03 for m in (e9, e20, s50))) or base in STRONG
        if not sup or any((b[j]['c'] < x['l'] for j in range(k + 1, n))):
            continue
        run = max((y['h'] for y in b[k + 1:])) / x['c'] - 1 if k < n - 1 else 0.0
        if k not in best or RANK.get(base, 4) < RANK.get(best[k][0].split(' ·')[0], 4):
            best[k] = (nm, run)
    if not best:
        return []
    kb = max(best, key=lambda k: best[k][1])
    kr = max(best)
    out = [(kb,) + best[kb]]
    if kr - kb >= 5:
        out.append((kr,) + best[kr])
    return sorted(out)

def buy_days_text(b, X, first=0):
    bd = [(k, nm, r) for k, nm, r in best_buy_days(b, X) if k >= first]
    if not bd:
        return ''
    f = lambda k, nm, r: '%s (%s%s)' % (md(b[k]['t']), nm.split(' · ')[0].replace('Double inside bar break', 'double inside bar break')[0].lower() + nm.split(' · ')[0][1:] if not nm.startswith(('UnR', 'HVC', 'ER', 'MA ', 'EMA')) else nm.split(' · ')[0], ', +%.0f%% since' % (100 * r) if r >= 0.03 else '')
    if bd[-1][0] == len(b) - 1:
        nm_ = f(*bd[-1]).split(' (', 1)[1].rstrip(')')
        today = 'today (%s, %s) is a buy day' % (md(b[-1]['t']), nm_)
        return today if len(bd) == 1 else 'the best buy day so far was %s; %s' % (f(*bd[0]), today)
    if len(bd) == 1:
        return 'the buy day was ' + f(*bd[0])
    return 'the best buy day so far was %s; the most recent is %s' % (f(*bd[0]), f(*bd[1]))

def thesis(card, objs, ticker='', buy=''):
    import re
    N_ = '([0-9]+(?:\\.[0-9]+)?)'
    d = dict(card)
    tr = d.get('Trend', '')
    trend = next((t for k, t in TREND_T if tr.startswith(k)), 'a chart')
    e_ = re.search('([0-9.]+) ATR (over|under) the 20EMA', tr)
    v_ = re.search('([+-]\\d+)% vs 50SMA', tr)
    pat_ = d.get('Pattern', '')
    if tr.startswith('Sideways') and pat_ and (not pat_.startswith('No base')) and e_ and v_ and (-0.7 <= float(e_.group(1)) * (1 if e_.group(2) == 'over' else -1) <= 1.6) and (-3 <= int(v_.group(1)) <= 10) and re.search('(\\d+)% deep', pat_) and (int(re.search('(\\d+)% deep', pat_).group(1)) <= 25):
        trend = 'a launch pad: basing right on its converged 20EMA / 50SMA'
    off = re.search('(\\d+)% off the 52-week high', tr)
    where = ' at the 52-week high' if 'at the 52-week high' in tr else ' %s%% off the high' % off.group(1) if off and int(off.group(1)) <= 15 else ''
    pat = d.get('Pattern', '')
    m = re.match('([^,;]+), (\\d+) wks, (\\d+)% deep', pat)
    base = ''
    if m:
        nm = m.group(1).replace('Consolidation / range', 'range').replace('Cup with handle', 'cup and handle').replace('PEG flag', 'post-earnings flag (PEG)')
        if nm == 'Bull flag' and int(m.group(3)) <= 12:
            nm = 'tight flag'
        nm = nm if nm.lower().startswith(('base', 'range', 'post-earnings', 'tight flag', 'cup and')) else nm.lower() if not nm.startswith(('PEG', 'HTF')) else nm
        base = ', in %s %s-week %s (%s%% deep%s)' % ('an' if m.group(2) in ('8', '11', '18') or m.group(2).startswith('8') else 'a', m.group(2), nm if nm not in ('Base', 'base') else 'base', m.group(3), ', in the buy zone' if 'in the buy zone' in pat else ', extended past its buy point' if '(extended)' in pat else '')
    marks = sorted([o for o in objs if o.get('kind') == 'candle' and o.get('pts')], key=lambda o: o['pts'][0]['d'])
    last = ''
    if marks:
        o = marks[-1]
        nm = re.sub(' [0-9.]+$', '', str(o.get('ptype'))).replace('ER gap · HVC', 'ER gap')
        bear = any((nm.startswith(b_) for b_ in BEAR_MARKS))
        nm = nm.replace(' · ', ' + ').replace('Heavy volume, closed weak', 'heavy-volume day that closed weak')
        nm = re.sub('\\+ ([A-Z][a-z])', lambda m_: '+ ' + m_.group(1).lower(), nm)
        if not nm.startswith(('UnR', 'ER', 'HVC', 'MA ', 'EMA')) and (not (len(nm) > 1 and nm[1].isupper())):
            nm = nm[0].lower() + nm[1:]
        art = 'an' if nm[:1].lower() in 'aeiou' or nm.startswith(('ER', 'HVC', 'MA ')) else 'a'
        last = '; the latest signal is %s%s on %d/%d' % ('a bearish ' if bear and (not nm.startswith('bearish')) else art + ' ', nm, int(o['pts'][0]['d'][5:7]), int(o['pts'][0]['d'][8:10]))
    gl = d.get('Gaps', '')

    def gapinfo(o_):
        md_ = '%d/%d' % (int(o_['pts'][0]['d'][5:7]), int(o_['pts'][0]['d'][8:10]))
        g_ = re.search(re.escape(md_) + ' gap (?:up|down) ([+-][0-9]+(?:\\.[0-9]+)?)% on ([0-9]+(?:\\.[0-9]+)?)x', gl)
        return (md_, '%s%% on %sx volume' % g_.groups() if g_ else 'on big volume')
    ext_ = re.search('([0-9.]+) ATR (over|under) the 20EMA', tr)
    ext_ = float(ext_.group(1)) * (1 if ext_.group(2) == 'over' else -1) if ext_ else 0
    erb = [o for o in marks if str(o.get('ptype')).startswith(('ER breakdown', 'Breakdown on news'))]
    erg = [o for o in marks if str(o.get('ptype')).startswith(('ER gap', 'Episodic pivot'))]
    if erb and str(erb[-1].get('ptype')).startswith('Breakdown on news') and (not [o for o in erg if o['pts'][0]['d'] > erb[-1]['pts'][0]['d']]):
        md_ = '%d/%d' % (int(erb[-1]['pts'][0]['d'][5:7]), int(erb[-1]['pts'][0]['d'][8:10]))
        return '%s broke down on news (%s, %s). Plan: not a long chart now; no swing trade area, let it base for weeks before looking again.' % (ticker or 'This', md_, str(erb[-1].get('why', '')).split(' (news)')[0].replace('closed ', ''))
    if erb and erb[-1] is marks[-1]:
        md_, gi_ = gapinfo(erb[-1])
        return '%s is an earnings breakdown (%s, %s), %s. Plan: no swing trade area; let it base before looking again.' % (ticker or 'This', md_, gi_, trend.replace('a downtrend ', 'now '))
    if erg:
        md_, gi_ = gapinfo(erg[-1])
        now_ = 'now flagging out into the MAs' if ext_ <= 1.2 else 'extended %.1f ATR over the 20EMA' % ext_ if ext_ >= 3 else 'holding up after the gap'
        last = last if marks[-1] is not erg[-1] else ''
        s1 = '%s is an earnings gapper (%s, %s), %s%s%s.' % (ticker or 'This', md_, gi_, now_, base, last)
    else:
        s1 = '%s is %s%s%s%s.' % (ticker or 'This', trend, (',' if where else '') + where, base, last)
    st = d.get('Setup', '')
    cyc = d.get('Cycle', '')
    nxt = re.search('next: ([^·]+)', cyc)
    second = 'second-tier' in st.lower()
    st0 = st.split(' · under the')[0]
    g = lambda pat_: re.search(pat_, st0)
    xb = re.search('([0-9]+(?:\\.[0-9]+)?)% past its buy point ([0-9]+(?:\\.[0-9]+)?) \\(extended\\)', pat)
    bz = re.search('([0-9]+(?:\\.[0-9]+)?)% past its buy point ([0-9]+(?:\\.[0-9]+)?) \\(in the buy zone\\)', pat)
    if st0.startswith('No clean entry') and xb:
        s2 = 'Plan: it broke out and is %s%% past the %s buy point; the next buy is the first pullback to the 10/20EMA or a new flag.' % xb.groups()
    elif st0.startswith('No clean entry') and bz:
        s2 = 'Plan: it is in the buy zone, %s%% past the %s buy point; a buy here keeps a tight stop under the breakout.' % bz.groups()
    elif st0.startswith(('No clean entry', 'No long setup')):
        s2 = 'Plan: no long trade under the falling 50SMA; the question is whether it can base and reclaim the MAs.' if tr.startswith('Downtrend') else 'Plan: no trade yet; the question is whether it %s.' % (nxt.group(1).strip().replace('wait for ', 'can set up ') if nxt else 'can build a base')
    elif st0.startswith('Extended'):
        s2 = "Plan: don't chase it extended; wait for a pullback to the 9/20EMA or a new base."
    elif st0.startswith('Building'):
        bp = g('buy point ([0-9]+(?:\\.[0-9]+)?) is ([0-9]+(?:\\.[0-9]+)?)% above')
        s2 = "Plan: buy it at support inside the base (a shakeout, higher low or oops at the 20EMA), on a break of the prior day's high; the move through %s (%s%% above) is the add." % bp.groups() if bp else 'Plan: let it finish the base.'
    elif st0.startswith('Pullback to the rising 20EMA') and g('20EMA \\(([0-9]+(?:\\.[0-9]+)?)\\).*9EMA \\(([0-9]+(?:\\.[0-9]+)?)\\)'):
        s2 = "Plan: buy the pullback to the rising 20EMA (%s): an oops reversal / UnR there, or a reclaim of the 9EMA (%s), on a break of the prior day's high." % g('20EMA \\(([0-9]+(?:\\.[0-9]+)?)\\).*9EMA \\(([0-9]+(?:\\.[0-9]+)?)\\)').groups()
    elif st0.startswith('Flag at highs (top') and g('top %s\\): .*?20EMA \\(%s\\)' % (N_, N_)):
        t_, e_ = g('top %s\\): .*?20EMA \\(%s\\)' % (N_, N_)).groups()
        s2 = "Plan: buy it at support, not up at the top (%s): a shakeout / UnR / oops or a 20EMA hold and remount (%s), on a break of the prior day's high or a red-to-green move; a close over %s is the add." % (t_, e_, t_)
    elif st0.startswith('Flag at highs') and g('trigger over ([0-9]+(?:\\.[0-9]+)?), stop under ([0-9]+(?:\\.[0-9]+)?) \\(([0-9]+(?:\\.[0-9]+)?)% risk'):
        s2 = 'Plan: buy the flag at highs through %s, stop under %s (%s%% risk).' % g('trigger over ([0-9]+(?:\\.[0-9]+)?), stop under ([0-9]+(?:\\.[0-9]+)?) \\(([0-9]+(?:\\.[0-9]+)?)% risk').groups()
    elif st0.startswith('Slingshot watch') and g("\\(([0-9]+(?:\\.[0-9]+)?)\\) triggers it; stop under today's low ([0-9]+(?:\\.[0-9]+)?)"):
        s2 = "Plan: slingshot watch; a close over the 4-day EMA of highs (%s) triggers it, stop under today's low %s." % g("\\(([0-9]+(?:\\.[0-9]+)?)\\) triggers it; stop under today's low ([0-9]+(?:\\.[0-9]+)?)").groups()
    elif st0.startswith('Reversal-extension leg') and g("9-20EMA \\(([0-9]+(?:\\.[0-9]+)?)-([0-9]+(?:\\.[0-9]+)?)\\), or a break of today's high ([0-9]+(?:\\.[0-9]+)?).*?low ([0-9]+(?:\\.[0-9]+)?)"):
        s2 = "Plan: buy an oops reversal / reclaim of the 9-20EMA (%s-%s) or a break of today's high %s, stop under %s." % g("9-20EMA \\(([0-9]+(?:\\.[0-9]+)?)-([0-9]+(?:\\.[0-9]+)?)\\), or a break of today's high ([0-9]+(?:\\.[0-9]+)?).*?low ([0-9]+(?:\\.[0-9]+)?)").groups()
    elif 'THE buy' in st0:
        hd_ = st0.split(': THE buy')[0]
        s2 = 'Plan: THE buy is the ' + hd_[0].lower() + hd_[1:] + '; ' + st0.split('THE buy')[1].lstrip('. ').replace('Entry', 'entry').rstrip('.') + '.'
    else:
        s2 = 'Plan: ' + (st0 if st0.startswith(('UnR', 'THE', 'EMA', 'MA ')) else st0[0].lower() + st0[1:]) + ('' if st0.endswith('.') else '.')
    if buy:
        s2 = s2.rstrip('.') + '; ' + buy + '.'
    return s1 + ' ' + s2 + (' Second-tier: size down.' if second else '')
