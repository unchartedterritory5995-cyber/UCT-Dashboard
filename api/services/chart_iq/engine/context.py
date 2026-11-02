# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
from . import _db
import functools, sqlite3, statistics
RO = _db.bars()
try:
    IM = {t: (s, i) for t, s, i in _db.industry().execute('SELECT ticker, sector, industry FROM industry_map') if i}
except sqlite3.Error:
    IM = {}
FUNDS = {t for t, (_, i) in IM.items() if i == 'Exchange Traded Fund' or i.startswith('Closed-End Fund')}
BY_IND = {}
for t_, (s_, i_) in IM.items():
    if t_ not in FUNDS:
        BY_IND.setdefault(i_, []).append(t_)

def _closes(t, day, n):
    return [(r[0], r[1]) for r in RO.execute("SELECT ts,c FROM (SELECT ts,c FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?) ORDER BY ts", (t, day, n)) if r[1]]

@functools.lru_cache(maxsize=4096)
def spy(day):
    return dict(_closes('SPY', day, 300))

def rs(b, day=None):
    day = day or b[-1]['t']
    S = spy(day)
    pts = [(x['t'], x['c'] / S[x['t']]) for x in b if S.get(x['t'])]
    if len(pts) < 70:
        return None
    base = pts[max(0, len(pts) - 190)][1]
    line = [(t, round(100 * v / base, 2)) for t, v in pts]
    v = [x for _, x in line]
    c = [x['c'] for x in b]
    nh52 = v[-1] >= max(v[-252:]) * 0.999
    nh63 = v[-1] >= max(v[-63:]) * 0.999
    px_hi = c[-1] >= max(c[-252:]) * 0.999
    slope = v[-1] / v[-21] - 1 if len(v) > 21 else 0.0
    return {'line': line, 'nh52': nh52, 'nh63': nh63, 'leads': (nh52 or nh63) and (not px_hi) and (c[-1] < max(c[-63:]) * 0.98), 'slope': slope}

@functools.lru_cache(maxsize=8192)
def _stats(t, day):
    c = [x for _, x in _closes(t, day, 70)]
    if len(c) < 64 or c[-1] < 3:
        return None
    return (c[-1] / c[-64] - 1, c[-1] > sum(c[-50:]) / 50)

def group(t, day):
    if t not in IM or t in FUNDS:
        return None
    sec, ind = IM[t]
    mem = [(m, _stats(m, day)) for m in BY_IND.get(ind, [])]
    mem = [(m, s) for m, s in mem if s]
    if len(mem) < 4:
        return None
    S = sorted(spy(day).items())
    s3 = S[-1][1] / S[-64][1] - 1 if len(S) > 64 else 0.0
    order = [m for m, _ in sorted(mem, key=lambda x: -x[1][0])]
    return {'industry': ind, 'sector': sec, 'n': len(mem), 'med3m': statistics.median((s[0] for _, s in mem)), 'spy3m': s3, 'over50': sum((s[1] for _, s in mem)) / len(mem), 'rank': order.index(t) + 1 if t in order else None, 'of': len(order)}

def weekly(b):
    import datetime
    W = []
    for x in b:
        d = datetime.date(int(str(x['t'])[:4]), int(str(x['t'])[4:6]), int(str(x['t'])[6:8]))
        wk = d.isocalendar()[:2]
        if W and W[-1]['wk'] == wk:
            w = W[-1]
            w['h'] = max(w['h'], x['h'])
            w['l'] = min(w['l'], x['l'])
            w['c'] = x['c']
            w['v'] += x.get('v') or 0
        else:
            W.append({'wk': wk, 'o': x['o'], 'h': x['h'], 'l': x['l'], 'c': x['c'], 'v': x.get('v') or 0, 't': x['t']})
    if len(W) < 30:
        return None
    c = [w['c'] for w in W]
    ma = lambda k: sum(c[k - 9:k + 1]) / 10
    m10, m10p = (ma(len(W) - 1), ma(len(W) - 4))
    tight = 1
    for j in range(len(W) - 2, max(0, len(W) - 8), -1):
        seg = c[j:]
        if max(seg) / min(seg) - 1 <= 0.015:
            tight = len(seg)
        else:
            break
    hi_k = max(range(len(W) - 52 if len(W) > 52 else 0, len(W)), key=lambda j: W[j]['h'])
    hi = W[hi_k]['h']
    base_w = len(W) - 1 - hi_k
    depth = 1 - min((w['l'] for w in W[hi_k:])) / hi if base_w else 0.0
    last = W[-1]
    rng = last['h'] - last['l']
    cp = (last['c'] - last['l']) / rng if rng else 0.5
    av = sum((w['v'] for w in W[-11:-1])) / 10 if len(W) > 11 else 0
    return {'over10': c[-1] > m10, 'rising10': m10 > m10p, 'tight': tight if tight >= 3 else 0, 'base_weeks': base_w, 'depth': depth, 'last_close_pos': cp, 'last_vol_x': last['v'] / av if av else None, 'at_high': base_w == 0}

def line(t, b, day=None):
    day = day or b[-1]['t']
    R_, G, Wk = (rs(b, day), group(t, day), weekly(b))
    parts, card = ([], [])
    if R_:
        if R_['leads']:
            s = 'the RS line is at a new %s high while price is still under its high (the leader tell)' % ('52-week' if R_['nh52'] else '3-month')
        elif R_['nh52']:
            s = 'the RS line is at a new 52-week high with price'
        elif R_['slope'] <= -0.08:
            s = 'the RS line is falling (lagging the market by %.0f%% this month)' % (-100 * R_['slope'])
        elif R_['slope'] >= 0.08:
            s = 'the RS line is rising (beating the market by %.0f%% this month)' % (100 * R_['slope'])
        else:
            s = ''
        if s:
            parts.append(s)
        card.append(('RS', 'RS line %s · 1 month vs SPY %+.0f%%%s' % ('at a new 52-week high' if R_['nh52'] else 'at a new 3-month high' if R_['nh63'] else 'below its highs', 100 * R_['slope'], ' · leads price' if R_['leads'] else '')))
    if G:
        strong = G['med3m'] - G['spy3m'] >= 0.03 and G['over50'] >= 0.55
        weak = G['med3m'] - G['spy3m'] <= -0.1 and G['over50'] <= 0.45 or G['over50'] <= 0.25
        lead = G['rank'] is not None and G['rank'] <= max(2, round(0.15 * G['of']))
        gname = G['industry'].replace(' - ', ' / ')
        if strong:
            s = ('a leader in a leading group (%s, #%d of %d)' if lead else 'in a leading group (%s, #%d of %d)') % (gname, G['rank'] or 0, G['of'])
        elif weak:
            s = ('a lone leader in a weak group (%s)' if lead else 'in a weak group (%s)') % gname
        else:
            s = 'a leader in its group (%s, #%d of %d)' % (gname, G['rank'], G['of']) if lead else ''
        if s:
            parts.append(s)
        card.append(('Group', '%s (%s): median 3 months %+.0f%% vs SPY %+.0f%%, %.0f%% over the 50SMA · this stock #%s of %d' % (gname, G['sector'], 100 * G['med3m'], 100 * G['spy3m'], 100 * G['over50'], G['rank'] or '-', G['of'])))
    if Wk:
        bits = []
        if Wk['tight']:
            bits.append('%d tight weekly closes' % Wk['tight'])
        if Wk['over10'] and Wk['rising10']:
            bits.append('over a rising 10-week line')
        elif not Wk['over10']:
            bits.append('under the 10-week line')
        if Wk['base_weeks'] >= 3:
            bits.append('a %d-week base (%.0f%% deep) on the weekly' % (Wk['base_weeks'], 100 * Wk['depth']))
        elif Wk['at_high']:
            bits.append('at a new weekly high')
        if bits:
            parts.append('weekly: ' + ', '.join(bits))
        card.append(('Weekly', ', '.join(bits) or 'no weekly read'))
    sent = 'Context: ' + '; '.join(parts) + '.' if parts else ''
    return {'sentence': sent, 'card': card, 'rs': R_ and R_['line'][-190:]}
