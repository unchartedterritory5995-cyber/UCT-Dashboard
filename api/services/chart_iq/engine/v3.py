# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
import json, os, sys
from . import markup as M
from . import v2_bases as VB
from . import v2_setups as VS
from . import v3_bases as B3
from . import v3_levels as L3
from .uct_candles import candles as UC, candle_catalog as UCAT
VERSION = 'claude_v3'
SETUP_OF = {'Flat base': 'flat_top_breakout', 'Cup with handle': 'cup_handle', 'Cup without handle': 'cup_handle', 'Double bottom (undercut)': 'double_bottom', 'VCP': 'vcp', 'High tight flag': 'flag_htf', 'Flag / short base': 'bull_flag', 'Bull flag': 'bull_flag', 'Cup without handle': 'cup_no_handle', 'PEG flag': 'peg_flag', 'Three weeks tight': 'three_weeks_tight', 'Consolidation / range': 'support_level'}
EVENT_SETUP = {'Episodic pivot': 'ep', 'Power gap': 'ep', 'Kicker': 'kicker', 'Oops reversal': 'oops', 'Slingshot': 'slingshot', 'Undercut & reclaim': 'undercut_reclaim', 'Inside day': 'inside_day', 'Double inside day': 'inside_day', 'Buyable gap-up': 'buyable_gap_up', 'Wedge pop': 'wedge_pop', 'GO signal': 'go_signal', 'Climax / exhaustion': 'parabolic_short', 'Gap & fade (climax)': 'parabolic_short', 'Breakdown': 'breakdown', 'Failed breakout': 'failed_breakout', 'Gap up': 'news_gapper', 'Outside reversal': 'parabolic_short', 'Capitulation reversal': 'capitulation_long'}

def r3(x):
    return round(float(x), 4)

def markup(ent):
    E = ent['edit']
    dates = E['bars']['dates']
    b = M.bars(ent['ticker'], dates[-1])
    if len(b) < 120 or M.ymd(b[-1]['t']) != dates[-1]:
        return None
    i = len(b) - 1
    d = [M.ymd(x['t']) for x in b]
    v0 = next((k for k, x in enumerate(d) if x >= dates[0]), 0)
    D = lambda k: d[max(v0, min(i, k))]
    pp = (E['price']['top'] - E['price']['bottom']) / (E['plot']['y1'] - E['plot']['y0'])
    tg, I = VS.tags(b, i)

    def _keep(t):
        k = t['bar']
        if t['id'] == 'oops':
            return I.o[k] < I.l[k - 1] and I.c[k] > I.l[k - 1]
        if t['id'] == 'undercut_reclaim':
            return any((I.l[j] < px for j in (k - 1, k) for _, px, _, _ in t['draw'][:1]))
        if t['id'] == 'launch_pad':
            rk = I.h[i] - I.l[i]
            if rk > 0 and I.c[i] < I.o[i] and ((I.h[i] - max(I.o[i], I.c[i])) / rk >= 0.5):
                return False
            return bool(I.s50[i]) and I.c[i] >= I.s50[i] and (not (I.c[i] / I.c[i - 1] - 1 < -0.02 and I.rvol(i) > 1.3))
        return True
    tg = [t for t in tg if _keep(t)]
    c, h, l = (I.c, I.h, I.l)
    close, a = (c[i], I.A(i))
    objs, read, setups = ([], [], [])
    n = [0]

    def add(o):
        n[0] += 1
        o.update(id='v%d' % n[0], added=True, src=VERSION)
        objs.append(o)
        return o
    s50, s200 = (I.s50[i], I.s200[i])
    hi52 = max(h[max(0, i - 251):i + 1])
    lo52 = min(l[max(0, i - 251):i + 1])
    template = bool(s50 and s200 and (close > s50 > s200) and I.s200_ok(i) and (close >= 0.75 * hi52) and (close >= 1.3 * lo52))
    ext = I.ext50(i)
    down = B3.downtrend(I, i)
    B = B3.find_base(b, i, I, v0)
    if B and B['pivot'] > close * 1.25:
        B = None
    G0 = L3.gaps(I, max(v0, i - 130), i)
    state = None
    if B:
        pt, note, extra = B3.classify(b, B, I, G0)
        if B.get('rim') and (not pt.startswith(('Cup', 'Double'))):
            pt, note = ('Cup with handle', 'cup from the %s rim' % d[B['L']]) if B['R'] != B['L'] else ('Cup without handle', 'U-shaped cup')
        vc = B3.is_vcp(I, B)
        if vc and pt in ('Flat base', 'Consolidation / range', 'Bull flag', 'Square box / consolidation'):
            pt, note = ('VCP', 'contractions ' + ' > '.join(('%d%%' % round(x * 100) for x in vc)))
        if vc:
            setups.append('vcp')
        if B.get('range') and (not pt.startswith(('Cup', 'Double', 'Flat', 'VCP'))):
            pt, note = ('Consolidation / range', 'stage-1 range, no prior advance')
        if B.get('earlier'):
            note += ', broke out %s' % d[B['earlier']]
        if 'db' in extra:
            x_, y_, _ = extra['db']
            mp = max(h[x_:y_ + 1])
            if mp > B['pivot'] * 1.002 and (not B['today']):
                B['early'] = B['pivot'] if B['pivot'] < mp * 0.985 else B.get('early')
                B['pivot'] = mp
            if B.get('top_line') and B['top_line'] < B['pivot'] + max(I.A(i), 0.02 * B['pivot']):
                B['top_line'] = None
        piv = B['pivot']
        if B['today']:
            state = 'breakout' if close <= piv * 1.05 or B['jb'] == i else 'extended'
        else:
            state = 'failed' if B.get('failed') else 'plain'
        vd = sum(I.v[B['e'] - 9:B['e'] + 1]) / 10 / (I.av50[B['e']] or 1)
        bgrade = 'C' if pt == 'Faulty / wide and loose' or not I.s200_ok(i) or state == 'failed' else 'A' if template and vd < 0.85 else 'B'
        if 'db' in extra:
            x, y, mid = extra['db']
            add({'kind': 'double_bottom', 'ptype': pt, 'grade': bgrade, 'pivot': r3(piv), 'low1': r3(l[x]), 'low1_date': D(x), 'low2': r3(l[y]), 'low2_date': D(y), 'start': D(B['L']), 'pivot_start': D(mid), 'end': D(B['e']), 'pivot_ext_px': 40})
        else:
            add({'kind': 'base', 'ptype': pt, 'grade': bgrade, 'start': D(B['L']), 'end': D(B['e']), 'line': r3(piv), 'buy_point': r3(piv), 'low': r3(B['low']), 'state': state, 'line_ext_px': 40})
        box_top = B['H'] if B['H'] > piv * 1.003 and (not (B.get('spike') and abs(B['H'] - B['spike'][1]) < 1e-09)) else None
        if box_top and objs and (objs[-1]['kind'] == 'base'):
            objs[-1]['line'] = r3(box_top)
            if box_top >= piv * 1.01:
                add({'kind': 'hline', 'ptype': 'Buy point', 'price': r3(piv), 'start': D(B['R'] if B['R'] != B['L'] else B['L'])})
        elif B.get('top_line'):
            add({'kind': 'hline', 'ptype': 'Base top', 'price': r3(B['top_line']), 'start': D(B['L'])})
        if B.get('early'):
            add({'kind': 'hline', 'ptype': 'Early entry', 'price': r3(B['early']), 'start': D(B['R'] if B['R'] != B['L'] else B['L'] + 1)})
        if state == 'breakout':
            txt = 'breaking out' + (' today' if B['jb'] == i else ' (%d days ago)' % (i - B['jb'])) + (', %.0f%% over the buy point' % ((close / piv - 1) * 100) if close > piv * 1.05 else '')
        elif state == 'extended':
            txt = 'broke out, now %.0f%% past the buy point' % ((close / piv - 1) * 100)
        elif state == 'failed':
            txt = 'broke down through the base low %.2f today' % B['low']
        else:
            txt = '%.1f%% under the buy point' % ((1 - close / piv) * 100) if close <= piv else 'over the buy point'
        read.append('%s%s, %d%% deep, %.1f weeks; buy point %.2f%s%s; %s.' % (pt, '' if 'deep' in note or 'bars' in note else ' (%s)' % note, round(B['depth'] * 100), B['n'] / 5, piv, ' (early entry %.2f)' % B['early'] if B.get('early') else '', ' (the %.2f spike is not the pivot)' % B['spike'][1] if B.get('spike') else '', txt))
        actionable = state == 'breakout' and B['jb'] >= i - 2 or (state == 'plain' and close >= piv * 0.95)
        if SETUP_OF.get(pt) and actionable:
            setups.append(SETUP_OF[pt])
        tests = [k for k in range(B['L'], B['e'] + 1) if h[k] >= piv - 0.5 * I.A(k) and h[k] >= max(h[max(B['L'], k - 2):k + 3])]
        sep = [k for n_, k in enumerate(tests) if n_ == 0 or k - tests[n_ - 1] >= 4]
        if len(sep) >= 3 and actionable:
            setups.append('flat_top_breakout')
            read.append('Flat top: %d tests of %.2f.' % (len(sep), piv))
    elif down:
        read.append('Downtrend: under a falling 50-day and the 200-day, no base.')
    else:
        read.append('No base at the right edge.')
    for tl in L3.trendlines(b, i, I, B, v0):
        nm = {'flag': 'Flag line (early entry)' if B and (not down) else 'Pullback line', 'down': 'Downtrend line', 'up': 'Uptrend line'}[tl['kind']]
        sl_ = (tl['v2'] - tl['v1']) / max(1, tl['p2'] - tl['p1'])
        at_i = tl['v1'] + sl_ * (i - tl['p1'])
        live = (tl['broke'] is None or tl['broke'] >= i - 1) and abs(sl_) * 14 <= 2.5 * a and (abs(at_i - close) <= 4 * a)
        add({'kind': 'trendline', 'ptype': nm, 'd1': D(tl['p1']), 'p1': r3(tl['v1']), 'd2': D(tl['p2']), 'p2': r3(tl['v2']), 'extend': True, **({} if live else {'ext_to': d[tl['broke'] if tl['broke'] is not None else i]})})
        if tl['broke'] is not None:
            read.append('%s broken %s.' % (nm, 'today' if tl['broke'] == i else 'on ' + d[tl['broke']]))
            if tl['kind'] in ('down', 'flag') and tl['broke'] == i and (I.rvol(i) >= 1.0):
                setups.append('trendline_break')
        else:
            read.append('%s at %.2f.' % (nm, tl['v1'] + (tl['v2'] - tl['v1']) * (i - tl['p1']) / (tl['p2'] - tl['p1'])))
    marks, G = L3.events(b, i, I, v0, B, tg)
    launched = B and B.get('today') and (B['jb'] >= i - 5) or any((g['ep'] and g['g'] >= i - 5 for g in G))
    if launched:
        marks = [e for e in marks if e['name'] not in ('Climax / exhaustion', 'Climax / reversal')]
    marks = [e for e in marks if e['bar'] >= v0]
    for e in sorted(marks, key=lambda e: e['bar']):
        k = e['bar']
        add({'kind': 'candle', 'ptype': e['name'], 'also': e.get('also', []), 'at': e['at'], 'pts': [{'d': d[k], 'p': r3(h[k] if e['at'] == 'high' else l[k])}], 'why': e['why']})
        if EVENT_SETUP.get(e['name']) and e['bar'] >= i - (15 if e['name'] == 'Undercut & reclaim' else 1):
            if e['name'] not in ('Breakdown', 'Failed breakout') or down:
                setups.append(EVENT_SETUP[e['name']])
    for e in [] if any((x['bar'] >= i - 1 and x['name'] in ('Breakdown', 'Failed breakout', 'Gap down') for x in marks)) else marks:
        if B and e['name'] in ('Inside day', 'Double inside day'):
            break
        if e['bar'] >= i - 1 and e.get('draw'):
            for kind_, px, ptype, nm in e['draw'][:1]:
                if abs(px - close) <= max(2.5 * a, 0.08 * close):
                    add({'kind': 'hline', 'ptype': ptype, 'price': r3(px), 'start': D(e['bar']), 'engine_name': nm})
            break
    if marks:
        read.append('Marked: ' + '; '.join(('%s %s (%s)' % (e['name'], 'today' if e['bar'] == i else d[e['bar']], e['why']) for e in marks)) + '.')
    LV = L3.levels(b, i, I, v0, B, G, marks)
    for z in LV:
        add({'kind': 'hline', 'ptype': z['name'] or z['role'], 'price': r3(z['price']), 'start': D(z['k']), 'engine_name': z['why']})
        if z['name'] == 'HVC' and abs(z['price'] / close - 1) <= 0.05:
            setups.append('hve')
    if any((not g['filled'] and g['g'] <= i - 3 and (g['ep'] or g['gap'] >= 0.04) and any((0 <= close / p - 1 <= 0.06 or l[i] <= p <= close for p in (g['day_low'], g['prev_c']))) for g in G)):
        setups.append('gap_support')
    if any((z['role'] == 'Support' and l[i] <= z['price'] * 1.005 and (close > z['price']) for z in LV)) or (B and l[i] <= B['low'] * 1.005 and (close > B['low'])):
        setups.append('support_level')
    for g in G:
        if g['ep'] and (not g['filled']):
            if g['g'] >= i - 10:
                setups.append('ep')
            if i - 25 <= g['g'] <= i - 3 and close >= g['prev_c']:
                setups.append('peg_flag')
    BASIC = {'long-white', 'long-black', 'white-candle', 'black-candle', 'short-white', 'short-black', 'spinning-top', 'umbrella', 'inverted-umbrella', 'high-wave'}
    CANDLE_SETUP = {'bullish-engulfing': 'engulfing', 'last-engulfing-bottom': 'engulfing', 'kicking-bullish': 'kicker', 'hammer': 'reversal_candle', 'inverted-hammer': 'reversal_candle', 'dragonfly-doji': 'reversal_candle', 'morning-star': 'reversal_candle', 'morning-doji-star': 'reversal_candle', 'piercing-line': 'reversal_candle', 'bullish-harami': 'reversal_candle', 'tweezer-bottom': 'reversal_candle', 'abandoned-baby-bullish': 'reversal_candle', 'three-outside-up': 'reversal_candle', 'three-inside-up': 'reversal_candle', 'hikkake-bull-confirmed': 'reversal_candle', 'bearish-engulfing': 'short_other', 'evening-star': 'short_other', 'shooting-star': 'short_other', 'dark-cloud-cover': 'short_other', 'three-black-crows': 'short_other', 'kicking-bearish': 'short_other'}
    named = []
    for k in (i - 1, i):
        try:
            mt = [x for x in UC.single_candle(b[:k + 1]).get('candle_matches', '').strip(',').split(',') if x and x not in BASIC]
        except Exception:
            mt = []
        if mt:
            labs = [UCAT.BY_KEY[x].label for x in mt if x in UCAT.BY_KEY]
            named.append((k, mt, labs))
            at_low = l[k] <= min(l[k - 10:k + 1]) + I.A(k)
            at_high = h[k] >= max(h[k - 10:k + 1]) - I.A(k)
            for x in mt:
                st_ = CANDLE_SETUP.get(x)
                if st_ and k >= i - 1 and (st_ in ('reversal_candle', 'engulfing') and at_low or (st_ == 'short_other' and at_high) or st_ == 'kicker'):
                    setups.append(st_)
    MINOR = ('hikkake', 'doji', 'marubozu', 'belt-hold', 'harami-cross', 'separating-lines')
    for k, mt, labs in named:
        major = [UCAT.BY_KEY[x].label for x in mt if x in UCAT.BY_KEY and (not any((m_ in x for m_ in MINOR)))]
        read.append('Candle %s: %s.' % ('today' if k == i else d[k], ', '.join(labs)))
        if not major:
            continue
        labs = major
        mark = next((o for o in objs if o['kind'] == 'candle' and o['pts'][0]['d'] == d[k]), None)
        if mark:
            mark['also'] = (mark.get('also') or [])[:1] + labs[:1]
        elif len([o for o in objs if o['kind'] == 'candle']) < 3:
            add({'kind': 'candle', 'ptype': labs[0], 'also': labs[1:2], 'at': 'high', 'pts': [{'d': d[k], 'p': r3(h[k])}], 'why': 'candle catalog: ' + ', '.join(labs)})
    o_ = I.o
    a1 = I.A(i)
    lows3 = [j for j in range(i - 25, i - 1) if l[j] <= min(l[max(0, j - 3):j + 4])]
    highs3 = [j for j in range(i - 60, i - 1) if h[j] >= max(h[max(0, j - 3):j + 4])]
    if o_[i] <= c[i - 1] * 0.98 and close > c[i - 1] and (close > o_[i]) and (I.rvol(i) >= 1.2):
        setups.append('red_to_green')
        read.append("Red to green: opened under yesterday's close, closed over it.")
    if lows3 and l[i] < l[lows3[-1]] and (close > h[i - 1]):
        setups.append('two_b_reversal')
        read.append("2B reversal: took out the %.2f low, closed over yesterday's high." % l[lows3[-1]])
    wk = [c[i], c[i - 5], c[i - 10]]
    if (max(wk) - min(wk)) / max(wk) <= 0.015 and (s50 and close > s50):
        setups.append('three_weeks_tight')
        read.append('Three weeks tight: weekly closes within 1.5%.')
    if len(highs3) >= 2:
        h1, h2 = (highs3[-2], highs3[-1])
        if h2 - h1 >= 10 and abs(h[h2] / h[h1] - 1) <= 0.02 and (close < min(l[h1:h2 + 1]) - 0.5 * a1) and (I.rvol(i) >= 1.2):
            setups.append('double_top')
            read.append('Double top %.2f / %.2f, closed under the middle low.' % (h[h1], h[h2]))
    if down and close >= min(l[i - 10:i + 1]) * 1.05 and (max(h[i - 5:i + 1]) < max(h[i - 30:i - 10])):
        setups.append('bear_flag')
    if s50 and close < s50 and (close < min(I.e9[i], I.e21[i])) and (c[i - 1] >= min(I.e9[i - 1], I.e21[i - 1])) and (sum((1 for j in range(i - 8, i) if c[j] > I.e21[j])) >= 5) and (I.rvol(i) >= 1.3):
        setups.append('wedge_drop')
        read.append('Wedge drop: lost the 9/21 EMA on volume after riding them.')
    if any((e['bar'] >= i - 1 and e['name'] in ('Gap & fade', 'Gap & fade (climax)') for e in marks)) and ext < 4:
        setups.append('news_failure')
    for t in tg:
        if t['id'] in ('launch_pad', 'gap_support', 'undercut_reclaim') and t['bar'] >= i - 1:
            if t['id'] == 'launch_pad' and t.get('grade') == 'C':
                continue
            setups.append(t['id'])
            read.append('%s (%s).' % (t['name'], t['why']))
    if I.up(i) or (s50 and close > s50 and (I.e21[i] > s50)):
        for nm, ma in (('21 EMA', I.e21[i]), ('50-day', s50)):
            if ma and min(l[i - 1:i + 1]) <= ma + 0.3 * a and (close >= ma - 0.1 * a) and (max(c[i - 10:i - 1]) >= ma + 1.5 * a):
                setups.append('pullback_ma')
                read.append('Pullback to the %s.' % nm)
                break
    for nm, ma in (('50', I.s50), ('200', I.s200)):
        if ma[i] and ma[i - 13] and (close > ma[i]):
            for k in range(i, i - 3, -1):
                if c[k] > ma[k] and c[k - 1] <= ma[k - 1] and (sum((1 for j in range(k - 10, k) if c[j] < ma[j])) >= 3):
                    setups.append('ma_reclaim')
                    read.append('Reclaimed the %s-day.' % nm)
                    break
    for k in (i, i - 1):
        rngk = h[k] - l[k]
        dck = (c[k] - l[k]) / rngk if rngk > 0 else 0.5
        if l[k] <= min(l[k - 10:k]) and dck >= 0.6 and (c[k] > I.o[k]):
            setups.append('reversal_candle')
            if c[k] / max(c[k - 20:k]) - 1 <= -0.25 and I.rvol(k) >= 2:
                setups.append('capitulation_long')
        if c[k] > I.o[k] and c[k - 1] < I.o[k - 1] and (I.o[k] <= c[k - 1]) and (c[k] >= I.o[k - 1]) and (rngk > I.A(k)):
            setups.append('engulfing')
    fresh = any((e['bar'] >= i - 1 and e['name'] in ('Episodic pivot', 'Power gap', 'Breakout', 'Kicker') for e in marks))
    pct50 = close / s50 - 1 if s50 else 0
    if ext >= 5 and pct50 >= 0.15 and (not fresh):
        setups.append('extended')
        read.append('Extended: %.1fx ATR above the 50-day.' % ext)
    if template and close >= 0.95 * hi52:
        setups.append('rs_leader')
    if (s50 and s200 and (close < s50) and (close < s200) or down) and (not any((e['bar'] >= i - 1 and e['name'] in ('Episodic pivot', 'Power gap', 'Breakout', 'Kicker') for e in marks))):
        setups.append('broken')
    if launched:
        setups = [s for s in setups if s not in ('parabolic_short', 'extended')]
    setups = [s for s in dict.fromkeys(setups) if s]
    ctx = ('rs_leader', 'support_level', 'hve', 'extended')
    setups = (['broken'] if 'broken' in setups else []) + ([s for s in setups if s not in ctx and s != 'broken'] + [s for s in setups if s in ctx])
    setups = setups[:5]
    entry = [e for e in marks if e['bar'] >= i - 1 and e['name'] not in ('Breakdown', 'Failed breakout', 'Gap & fade (climax)', 'Climax / exhaustion', 'Outside reversal')]
    bad = [e for e in marks if e['bar'] >= i - 1 and e['name'] in ('Breakdown', 'Failed breakout', 'Gap & fade (climax)', 'Climax / exhaustion', 'Outside reversal', 'Gap & fade')]
    chg = (close / c[i - 1] - 1) * 100
    off_hi = (1 - close / hi52) * 100
    v21 = (close - I.e21[i]) / a
    rv = I.rvol(i)
    if down and (not entry) or (ext <= 0.5 and v21 <= -1.0 and (rv > 0.85)):
        grade = 'Not a setup'
    elif bad or (B and state == 'failed') or (not I.s200_ok(i)) or (ext <= 0.5 and (v21 <= -1.0 or not template)) or (off_hi > 13 and v21 <= 0):
        grade = 'C'
    elif chg > 5.5 and off_hi <= 11 and (v21 > 1.7) or (template and B and objs and (objs[0].get('grade') == 'A')):
        grade = 'A'
    else:
        grade = 'B'
    if not B and (not entry) and (grade in ('A', 'B')) and (not template):
        grade = 'C'
    breakout_now = B and state == 'breakout' and (B['jb'] >= i - 1) and (c[B['jb']] - piv >= 0.15 * I.A(B['jb']))
    if bad or 'parabolic_short' in setups or grade == 'Not a setup' or (ext >= 7 and pct50 >= 0.15 and (not fresh)):
        trade = 'pass'
    elif v21 <= -0.47 and (rv > 1.56 or ext <= -0.27):
        trade = 'pass'
    elif chg > 2.2 and off_hi <= 24 and (rv > 1.35 or chg > 7) or (breakout_now and off_hi <= 2) or (chg > 2.2 and 24 < off_hi <= 37 and (rv > 0.82)):
        trade = 'buy'
    else:
        trade = 'watch'
    shorts = [x for x in ('double_top', 'bear_flag', 'breakdown', 'failed_breakout', 'wedge_drop', 'news_failure') if x in setups]
    if shorts and trade == 'pass':
        lows_ = [j for j in range(i - 15, i) if l[j] <= min(l[max(0, j - 3):j + 4])]
        trig = l[lows_[-1]] if lows_ else l[i]
        read.append('Short side: %s; a close under %.2f confirms it.' % (', '.join((x.replace('_', ' ') for x in shorts)), trig))
    read.append({'buy': 'Call: buy.', 'watch': 'Call: watch for the entry.', 'pass': 'Call: pass.'}[trade] + (' Trend template intact.' if template else ''))

    def prio(o):
        if o['kind'] in ('base', 'double_bottom'):
            return 100
        if o['kind'] == 'hline' and o.get('ptype') in ('Buy point', 'Early entry', 'Stop', 'Base top'):
            return 80
        if o['kind'] == 'candle':
            return 70 if o['pts'][0]['d'] >= d[i - 5] else 30
        if o['kind'] == 'trendline':
            return 60 if o.get('ptype', '').startswith('Flag') else 50
        if o['kind'] == 'hline':
            return 40 - min(30, 100 * abs(o['price'] / close - 1))
        return 45
    while len(objs) > 9:
        objs.remove(min(objs, key=prio))
    return {'objects': objs, 'labels': {'setups': setups, 'grade': grade, 'trade': trade}, 'read': ' '.join(read), 'version': VERSION}
