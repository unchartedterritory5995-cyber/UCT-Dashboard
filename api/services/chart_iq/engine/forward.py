# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
KINDS = ('Coiling at support', 'Pullback to the rising 20EMA', 'Tightening under the pivot', 'Wedge pop watch', 'Reversal extension, unconfirmed', 'Flag at highs', 'Slingshot watch', 'Higher low forming', 'Earnings gapper flagging', 'Launch pad')

def _r(x):
    return round(x, 2)

def watches(b, R, X=None):
    X = X or R.ctx(b)
    n = len(b)
    k = n - 1
    if n < 80:
        return []
    if sum((y['h'] / y['l'] - 1 for y in b[-10:])) / 10 < 0.008:
        return []
    x = b[k]
    c = x['c']
    a = R.atr(b, k) or 1e-09
    e9, e20, s50 = (X['e9'][k], X['e20'][k], X['s50'][k])
    c_ = [y['c'] for y in b]
    e10 = R.ema(c_, 10)
    av = sum((y['v'] for y in b[k - 50:k])) / 50 or 1e-09
    v3 = sum((y['v'] for y in b[k - 2:k + 1])) / 3 / av
    v5 = sum((y['v'] for y in b[k - 4:k + 1])) / 5 / av
    rng = lambda j: b[j]['h'] - b[j]['l']
    up = bool(s50 and c > s50 and X['s50'][k - 10] and (s50 > X['s50'][k - 10]))
    e20up = e20 > X['e20'][k - 5]
    today = {nm.split(' ·')[0] for j, nm, _, _ in R.candle_events(b, X, look=2) if j == k}
    buy_today = bool(today & set(R.BUYFAM))
    out = []

    def add(kind, text, trig, stop):
        if trig and stop and (trig > stop):
            out.append({'kind': kind, 'text': text, 'trigger': _r(trig), 'stop': _r(stop), 'dist_atr': round(max(0.0, (trig - c) / a), 2), 'risk_pct': round(100 * (1 - stop / trig), 1)})
    ev = R.confirmed(b, R.cycle_events(b, look=60))
    pend = [e for e in ev if e[1] == 'Reversal extension' and 'not confirmed yet' in e[2]]
    if pend:
        j = pend[-1][0]
        add(KINDS[4], 'reversal extension on %s, not confirmed yet: a close over its high %.2f confirms it, a lower low under %.2f kills it' % (R.md(b[j]['t']), b[j]['h'], b[j]['l']), b[j]['h'], b[j]['l'])
    if buy_today:
        return out
    inside = x['h'] <= b[k - 1]['h'] and x['l'] >= b[k - 1]['l']
    near = lambda m: m and -0.5 * a <= x['l'] - m <= 0.6 * a
    if up and (inside or rng(k) <= 0.7 * a) and (near(e9) or near(e20)) and (v3 <= 1.0):
        ma = '9EMA' if near(e9) else '20EMA'
        add(KINDS[0], "%s at the rising %s on light volume: a break of today's high %.2f is the buy, stop under %.2f" % ('inside day' if inside else 'tight day', ma, x['h'], min(x['l'], b[k - 1]['l'] if inside else x['l'])), x['h'], min(x['l'], b[k - 1]['l'] if inside else x['l']))
    h10 = max((y['h'] for y in b[k - 10:k]))
    if up and e20up and (h10 >= e20 + 1.5 * a) and (c < h10 - 1.0 * a) and (-0.3 * a <= c - e20 <= 1.0 * a) and (v3 <= 0.9) and (sum((b[j]['c'] < b[j - 1]['c'] for j in range(k - 3, k + 1))) >= 2):
        add(KINDS[1], "pulling back into the rising 20EMA (%.2f) on light volume (%.1fx): the buy is an oops / UnR there or a break of the prior day's high %.2f, stop under %.2f" % (e20, v3, x['h'], min(x['l'], e20 - 0.5 * a)), x['h'], min(x['l'], e20 - 0.5 * a))
    piv = max((y['h'] for y in b[k - 30:k - 2]))
    lo30 = min((y['l'] for y in b[k - 30:k + 1]))
    r5 = sum((rng(j) for j in range(k - 4, k + 1))) / 5
    r15 = sum((rng(j) for j in range(k - 19, k - 4))) / 15
    if up and piv / lo30 - 1 <= 0.25 and (0 <= piv / c - 1 <= 0.05) and (piv - c <= 2 * a) and (r5 <= 0.75 * r15) and (v5 <= 0.9) and (max((y['h'] for y in b[k - 2:k + 1])) <= piv):
        st = min((y['l'] for y in b[k - 4:k + 1]))
        add(KINDS[2], "tightening %.1f%% under its %.2f pivot on drying volume (%.1fx): the buy is a shakeout / UnR at the 20EMA (%.2f) or the break of the prior day's high; a close over %.2f on volume is the breakout, stop under %.2f" % (100 * (piv / c - 1), piv, v5, e20, piv, st), piv, st)
    hi_e = max(e10[k], e20)
    lo_e = min(e10[k], e20)
    if sum((c_[j] < X['e20'][j] for j in range(k - 15, k))) >= R.CYC['pop_under'] and r5 <= 0.85 * r15 and (c <= hi_e + 0.2 * a) and (c >= lo_e - 1.0 * a) and (not (s50 and c < s50 and X['s50'][k - 10] and (s50 < X['s50'][k - 10] * 0.97))):
        trig = max(hi_e, max((y['h'] for y in b[k - 4:k + 1])))
        st = min((y['l'] for y in b[k - 4:k + 1]))
        add(KINDS[3], 'wedging under the 10/20 EMA (%.2f-%.2f), ranges tightening: a close over %.2f (the EMAs and the last 5 highs) on volume is the wedge pop, stop under %.2f' % (lo_e, hi_e, trig, st), trig, st)
    fl = R.flag_at_highs(b, X)
    if fl and c <= fl[1]:
        add(KINDS[5], 'flag at highs (top %.2f, low %.2f): buy it at support, a shakeout / UnR or a hold of the 20EMA (%.2f), not up at the top; a close over %.2f is the add' % (fl[1], fl[2], e20, fl[1]), fl[1], fl[2])
    sl = R.slingshot_watch(b, X)
    if sl:
        add(KINDS[6], "slingshot watch: a close over the 4-day EMA of highs (%.2f) triggers it, stop under today's low %.2f" % (sl, x['l']), sl, x['l'])
    hl = R.higher_low(b, X)
    if hl and c <= b[hl[1]]['l'] * 1.04 and (k - hl[1] <= 10):
        add(KINDS[7], "higher low forming at %.2f (%s, over the %s low %.2f): a break of today's high %.2f is the buy, stop under %.2f" % (b[hl[1]]['l'], R.md(b[hl[1]]['t']), R.md(b[hl[0]]['t']), b[hl[0]]['l'], x['h'], b[hl[1]]['l']), x['h'], b[hl[1]]['l'])
    for j in range(k - 25, k - 3):
        avj = sum((y['v'] for y in b[j - 50:j])) / 50 or 1e-09
        if b[j]['o'] / b[j - 1]['c'] - 1 >= 0.05 and b[j]['v'] >= 2.5 * avj:
            if all((b[i]['c'] >= b[j]['l'] for i in range(j, k + 1))) and (c - e20) / a <= 1.2 and (v3 <= 1.0):
                add(KINDS[8], "earnings gapper (%s) flagging out into the MAs, holding the gap-day low %.2f: a break of today's high %.2f is the buy" % (R.md(b[j]['t']), b[j]['l'], x['h']), x['h'], b[j]['l'])
            break
    h20 = max((y['h'] for y in b[k - 19:k + 1]))
    l20 = min((y['l'] for y in b[k - 19:k + 1]))
    if s50 and abs(e20 / s50 - 1) <= 0.02 and (h20 / l20 - 1 <= 0.15) and (abs(c - e20) <= 1.0 * a):
        add(KINDS[9], 'launch pad: basing right on its converged 20EMA / 50SMA (%.2f / %.2f); a close over the base top %.2f is the go, stop under %.2f' % (e20, s50, h20, l20), h20, l20)
    return out

def best(ws):
    return min(ws, key=lambda w: (w['dist_atr'], w['risk_pct'])) if ws else None

def market(R, bars_fn, day):
    out = []
    for t in ('SPY', 'QQQ', 'IWM'):
        b = bars_fn(t, day)
        if len(b) < 210:
            continue
        X = R.ctx(b)
        k = len(b) - 1
        c = b[k]['c']
        tr = 'over a rising 20EMA and 50SMA' if c > X['e20'][k] > X['s50'][k] and X['s50'][k] > X['s50'][k - 10] else 'under the 20EMA, holding the 50SMA' if c > X['s50'][k] else 'under the 50SMA'
        ev = R.cycle_leg(R.confirmed(b, R.cycle_events(b)))
        st = ev[-1][1] if ev else ''
        out.append('%s %s%s' % (t, tr, ' (%s %s)' % (st[0].lower() + st[1:], R.md(b[ev[-1][0]]['t'])) if st else ''))
    return '; '.join(out)

def regime(R, bars_fn, day):
    s = []
    for t in ('SPY', 'QQQ'):
        b = bars_fn(t, day)
        if len(b) < 60:
            return 'n/a'
        X = R.ctx(b)
        k = len(b) - 1
        c = b[k]['c']
        s.append(2 if c > X['e20'][k] > X['s50'][k] else 0 if c < X['s50'][k] else 1)
    return 'risk on' if min(s) == 2 else 'risk off' if max(s) == 0 else 'mixed'

def features(b, R, ws, rank, score, prior, reg, X=None):
    X = X or R.ctx(b)
    k = len(b) - 1
    at = R.atr(b, k) or 1e-09
    av = sum((y['v'] for y in b[k - 50:k])) / 50 or 1e-09
    return {'rank': rank, 'score': score, 'ret3m': b[k]['c'] / b[max(0, k - 63)]['c'] - 1, 'adr': sum((y['h'] / y['l'] - 1 for y in b[-20:])) / 20, 'ext': (b[k]['c'] - X['e20'][k]) / at, 'off_hi': 1 - b[k]['c'] / max((y['h'] for y in b[-252:])), 'v5': sum((y['v'] for y in b[-5:])) / 5 / av, 'dist': min([w['dist_atr'] for w in ws] or [9]), 'risk': min([w['risk_pct'] for w in ws] or [30]), 'prior': prior, 'regime': reg, 'kinds': sorted({w['kind'] for w in ws})}
VEC = [('rank', lambda f: f['rank']), ('daily score', lambda f: f['score'] / 20), ('3-month return', lambda f: f['ret3m']), ('ADR', lambda f: 10 * f['adr']), ('ATR over the 20EMA', lambda f: max(-4, min(4, f['ext']))), ('off the high', lambda f: f['off_hi']), ('5-day volume', lambda f: min(3, f['v5'])), ('ATR to the trigger', lambda f: min(9, f['dist'])), ('stop risk', lambda f: min(30, f['risk']) / 10), ('risk on', lambda f: float(f['regime'] == 'risk on')), ('risk off', lambda f: float(f['regime'] == 'risk off')), ('any watch', lambda f: float(bool(f['kinds'])))]
VEC += [(kd, (lambda kd_: lambda f: float(kd_ in f['kinds']))(kd)) for kd in KINDS]

def vec(f, prior=True):
    return [g(f) for _, g in VEC] + ([float(f['prior'])] if prior else [])

def score_watch(f, M):
    import math
    v = vec(f, M['prior'])
    names = [n for n, _ in VEC] + (['team called it this month'] if M['prior'] else [])
    z = [(x - m) / s for x, m, s in zip(v, M['mu'], M['sd'])]
    parts = [c * x for c, x in zip(M['coef'], z)]
    p = 1 / (1 + math.exp(-(M['b'] + sum(parts))))
    why = [names[i] for i in sorted(range(len(parts)), key=lambda i: -parts[i]) if parts[i] > 0.15][:3]
    return (p, why)
