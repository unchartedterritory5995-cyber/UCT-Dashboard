# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
import math

def ema(xs, n):
    out, e, k = ([], None, 2 / (n + 1))
    for x in xs:
        e = x if e is None else x * k + e * (1 - k)
        out.append(e)
    return out

def sma(xs, n):
    out, s = ([], 0.0)
    for k, x in enumerate(xs):
        s += x
        if k >= n:
            s -= xs[k - n]
        out.append(s / n if k >= n - 1 else None)
    return out

class Ind:

    def __init__(self, b):
        self.b = b
        self.o = [x['o'] for x in b]
        self.h = [x['h'] for x in b]
        self.l = [x['l'] for x in b]
        self.c = [x['c'] for x in b]
        self.v = [x['v'] for x in b]
        self.e9 = ema(self.c, 9)
        self.e21 = ema(self.c, 21)
        self.s50 = sma(self.c, 50)
        self.s200 = sma(self.c, 200)
        self.s10 = sma(self.c, 10)
        self.e4h = ema(self.h, 4)
        self.av50 = [None] + sma(self.v, 50)[:-1]
        trs = [self.h[0] - self.l[0]] + [max(self.h[k], self.c[k - 1]) - min(self.l[k], self.c[k - 1]) for k in range(1, len(b))]
        self.atr = sma(trs, 14)

    def A(self, k):
        return self.atr[k] or self.c[k] * 0.03

    def rvol(self, k):
        return self.v[k] / self.av50[k] if self.av50[k] else 0

    def dcr(self, k):
        r = self.h[k] - self.l[k]
        return (self.c[k] - self.l[k]) / r if r > 0 else 0.5

    def gap(self, k):
        return self.o[k] / self.c[k - 1] - 1

    def inside(self, k):
        return self.h[k] <= self.h[k - 1] and self.l[k] >= self.l[k - 1]

    def ext50(self, k):
        return (self.c[k] - self.s50[k]) / self.A(k) if self.s50[k] else 0

    def up(self, k):
        return bool(self.s50[k] and self.c[k] > self.s50[k] and (self.s50[k] >= (self.s50[k - 10] or 0)) and (self.e21[k] > self.s50[k]))

    def s200_ok(self, k):
        return self.s200[k] is None or self.s200[k - 20] is None or self.c[k] > self.s200[k] or (self.s200[k] >= self.s200[k - 20])

def tags(b, i):
    I = Ind(b)
    o, h, l, c, v = (I.o, I.h, I.l, I.c, I.v)
    out = []

    def add(tid, name, k, at, prio, why, grade=None, draw=None):
        out.append({'id': tid, 'name': name, 'bar': k, 'at': at, 'prio': prio, 'why': why, 'grade': grade, 'draw': draw or []})
    for k in (i, i - 1):
        a = I.A(k)
        if I.gap(k) >= 0.08 and I.rvol(k) >= 3 and (I.dcr(k) >= 0.5):
            add('ep', 'Episodic pivot (EP)', k, 'high', 100, 'gap %+.0f%% on %.1fx volume' % (I.gap(k) * 100, I.rvol(k)), draw=[('hline', l[k], 'Stop', 'EP-day low')])
        elif c[k - 1] < I.e21[k - 1] and o[k] >= c[k - 1] * 1.01 and (h[k] > h[k - 1]) and (c[k] > max(I.e9[k], I.e21[k])) and (c[k] > o[k] * 0.995):
            add('kicker', 'Kicker', k, 'high', 90, 'weak close under the 21 EMA, then a gap and a close over the 9/21 EMA', grade='A' if o[k] > h[k - 1] and I.s200[k] and (c[k] > I.s200[k]) else 'B' if I.ext50(k) < 2 else 'C')
        elif I.gap(k) >= 0.04 and I.rvol(k) >= 1.5 and (I.dcr(k) >= 0.5) and I.s50[k] and (c[k] > I.s50[k]):
            mid = (l[k] + h[k - 1]) / 2
            add('buyable_gap_up', 'Buyable gap-up', k, 'high', 60, 'gap %+.1f%%, %.1fx volume' % (I.gap(k) * 100, I.rvol(k)), draw=[('hline', mid, 'Stop', 'Gap midpoint (BGU stop)')])
        if o[k] < c[k - 1] and l[k] < l[k - 1] and (l[k] < o[k]) and (c[k] > c[k - 1]) and (c[k - 1] < c[k - 2]) and (I.up(k) or (I.s50[k] and c[k] > I.s50[k])):
            add('oops', 'Oops reversal', k, 'low', 80, 'opened under the prior close, undercut its low, closed green')
        if c[k] > I.e4h[k] and all((c[k - j] < I.e4h[k - j] for j in (1, 2, 3))) and (c[k] > 5) and any((c[j] / c[j - 1] > 1.04 and v[j] > (I.av50[j] or 1e+18) for j in range(k - 25, k))) and I.s50[k] and (c[k] > I.s50[k]):
            add('slingshot', 'Slingshot', k, 'high', 70, 'first close over the 4-day EMA of highs after 3 below it')
        for nm, ma in (('50', I.s50), ('200', I.s200)):
            if ma[k] and ma[k - 10] and (c[k - 1] < ma[k - 1]) and (c[k] > ma[k]) and (sum((1 for j in range(k - 10, k) if c[j] < ma[j])) >= 3) and (ma[k] >= ma[k - 10] * 0.995) and (I.dcr(k) >= 0.6):
                add('ma_reclaim', 'MA reclaim (%s)' % nm, k, 'low', 45, 'close back over a flat/rising %s-day' % nm)
    k = i
    a = I.A(k)
    for k in (i, i - 1):
        if I.inside(k) and (k == i or (h[i] <= h[k] * 1.02 and l[i] >= l[k - 1])):
            dbl = I.inside(k - 1)
            ctx = c[k] > I.e21[k] and I.s50[k] and (c[k] > I.s50[k]) and (I.s200[k] is None or c[k] > I.s200[k])
            add('inside_day', 'Double inside day' if dbl else 'Inside day', k, 'high', 65, 'range inside the prior bar' + (', resting above the 21/50/200' if ctx else ', below its moving averages'), grade='A' if ctx and dbl else 'B' if ctx else 'C', draw=[('hline', h[k], 'Buy point / pivot', 'Inside-day high (trigger)'), ('hline', l[k], 'Stop', 'Inside-day low (stop)')])
            break
    for k in (i, i - 1, i - 2):
        mas = [I.e9[k], I.e21[k], I.s50[k]]
        if not (all(mas) and I.s50[k - 10]):
            break
        ak = I.A(k)
        pinch = (max(mas) - min(mas)) / ak
        if pinch <= 1.5 and all((abs(c[k] - m) / ak <= 2.0 for m in mas)) and (c[k] >= min(mas)):
            gates = [I.s200_ok(k), I.s50[k] >= I.s50[k - 10] - 0.3 * ak, I.e21[k] >= I.e21[k - 5] - 0.2 * ak, (max(h[k - 4:k + 1]) - min(l[k - 4:k + 1])) / ak <= 2.5]
            g = 'A' if all(gates) and I.s200[k] and (I.s50[k] > I.s200[k]) else 'B' if sum(gates) >= 3 else 'C'
            add('launch_pad', 'Launch pad', i, 'low', 55, '9/21/50 within %.1f ATR, price on them (grade %s)' % (pinch, g), grade=g, draw=[('hline', min(l[i - 4:i + 1]), 'Stop', 'Pad low')])
            break
    if I.up(k):
        for nm, ma in (('21', I.e21), ('50', I.s50)):
            m = ma[k]
            if m and l[k] <= m + 0.25 * a and (c[k] >= m - 0.25 * a) and (I.dcr(k) >= 0.6):
                add('pullback_ma', 'Pullback to the %s' % nm, k, 'low', 50, 'low tagged the %s, closed in the upper part' % nm)
                break
    lvls = [('21 EMA', I.e21[k]), ('50-day', I.s50[k]), ('200-day', I.s200[k])]
    shelf = [j for j in range(i - 60, i - 3) if l[j] <= min(l[max(0, j - 3):j + 4])]
    if shelf:
        lvls.append(('shelf', l[shelf[-1]]))
    if I.s50[k] and (c[k] > I.s50[k] or I.s50[k] >= I.s50[k - 10]):
        for nm, X in lvls:
            if X and min(l[k - 4:k + 1]) < X - 0.1 * a and (c[k] > X) and (I.dcr(k) >= 0.6) and (c[k] > o[k]):
                add('undercut_reclaim', 'Undercut & reclaim', k, 'low', 75, 'undercut the %s (%.2f) and closed back over it' % (nm, X), draw=[('hline', X, 'Support', 'Undercut level (%s)' % nm)])
                break
    for g in range(i - 3, max(1, i - 250), -1):
        if l[g] > h[g - 1] and I.rvol(g) >= 1.5 and (o[g] / c[g - 1] - 1 >= 0.03) and (min(c[g:i + 1]) >= c[g - 1]):
            top, bot = (l[g], c[g - 1])
            if l[k] <= top + 0.25 * a and c[k] >= bot and (I.dcr(k) >= 0.5):
                add('gap_support', 'Gap support test', k, 'low', 72, 'tested the unfilled %s gap (%.2f-%.2f)' % (I.b[g]['t'], bot, top), draw=[('hline', bot, 'Gap level', 'Gap support (prior close)')])
            break
    if c[k] > I.e9[k] and c[k] > I.e21[k] and (c[k - 1] <= max(I.e9[k - 1], I.e21[k - 1])) and (sum((1 for j in range(k - 8, k) if c[j] < I.e21[j])) >= 5) and (I.rvol(k) >= 1.3):
        add('wedge_pop', 'Wedge pop', k, 'high', 58, 'back over the 9/21 EMA after a contraction under them')
    sw = min(l[k - 5:k])
    if I.up(k) and l[k] < sw and (sw - l[k] <= 0.6 * a) and (c[k] > sw) and (min(o[k], c[k]) - l[k] >= 0.4 * (h[k] - l[k])) and (I.dcr(k) >= 0.6) and (I.ext50(k) < 3):
        add('go_signal', 'GO signal', k, 'low', 85, 'swept the 5-day low %.2f and closed back strong' % sw, draw=[('hline', l[k], 'Stop', 'Sweep low')])
    downs = [v[j] for j in range(k - 10, k) if c[j] < c[j - 1]]
    if c[k] > c[k - 1] and downs and (v[k] > max(downs)) and I.e21[k] and (0 <= (c[k] - I.e21[k]) / a <= 1.5) and I.s50[k] and (c[k] > I.s50[k]) and (I.ext50(k) <= 3):
        add('pocket_pivot', 'Pocket pivot', k, 'high', 30, 'up day on more volume than any down day of the prior 10 (lab)')
    for k in (i, i - 1):
        run = c[k] / min(c[k - 20:k + 1]) - 1
        ups = 0
        while ups < 15 and c[k - ups] > c[k - ups - 1]:
            ups += 1
        if I.ext50(k) >= 5 and c[k] / I.e9[k] - 1 >= 0.12 and (run >= 0.25) and (ups >= 2):
            add('parabolic_short', 'Climax / exhaustion', k, 'high', 95, '+%d%% in 20 days, %.1fx ATR over the 50, %d%% over the 9 EMA' % (run * 100, I.ext50(k), (c[k] / I.e9[k] - 1) * 100), grade='A' if I.ext50(k) >= 7 else 'B', draw=[('hline', I.e9[i], 'Target', '9 EMA (mean-reversion target)')])
            break
    return (out, I)

def levels(b, i, I):
    o, h, l, c, v = (I.o, I.h, I.l, I.c, I.v)
    out = []
    for g in range(i, max(1, i - 60), -1):
        if (I.gap(g) >= 0.1 or c[g] / c[g - 1] - 1 >= 0.1) and I.rvol(g) >= 3 and (min(l[g:i + 1]) >= c[g - 1]):
            out.append({'kind': 'gap', 'g': g, 'top': l[g], 'bot': c[g - 1], 'peg': True, 'why': 'power gap %+.0f%% on %.1fx volume, still unfilled' % ((o[g] / c[g - 1] - 1) * 100, I.rvol(g))})
            break
    else:
        for g in range(i, max(1, i - 60), -1):
            if l[g] > h[g - 1] and I.rvol(g) >= 1.5 and (min(l[g:i + 1]) >= c[g - 1]) and (l[g] - h[g - 1] >= 0.3 * I.A(g)):
                out.append({'kind': 'gap', 'g': g, 'top': l[g], 'bot': h[g - 1], 'peg': False, 'why': 'unfilled gap on %.1fx volume' % I.rvol(g)})
                break
    lo = max(1, i - 251)
    hv = max(range(lo, i + 1), key=lambda k: v[k])
    if hv >= i - 120 and c[hv] > c[hv - 1]:
        out.append({'kind': 'hvc', 'k': hv, 'price': c[hv], 'why': 'close of the highest-volume day of the year (%s)' % I.b[hv]['t']})
    return out
