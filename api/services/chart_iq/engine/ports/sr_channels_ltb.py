# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Python port of "Support Resistance Channels" (c) LonesomeTheBlue, https://www.tradingview.com/script/Ej53t8Wv/
# Ported for the UCT lab; behaviour kept identical to the Pine original at its default inputs.
import math
NAME = 'S/R Channels (LonesomeTheBlue)'
NA = float('nan')
DEFAULTS = {'prd': 10, 'ppsrc': 'High/Low', 'ChannelW': 5, 'minstrength': 1, 'maxnumsr': 6, 'loopback': 290, 'res_col': '#f23645', 'sup_col': '#00e676', 'inch_col': '#787b86', 'showpp': False, 'showsrbroken': False, 'showthema1en': False, 'showthema1len': 50, 'showthema1type': 'SMA', 'showthema2en': False, 'showthema2len': 200, 'showthema2type': 'SMA'}
PLOTSHAPE_WINDOW = 150
_LIME = '#00e676'
_RED = '#f23645'

def _isna(x):
    return x is None or (isinstance(x, float) and math.isnan(x))

def _pbool(x):
    return not _isna(x) and x != 0

def ta_pivothigh(src, left, right):
    n = len(src)
    out = [NA] * n
    for i in range(left + right, n):
        c = i - right
        v = src[c]
        if _isna(v):
            continue
        ok = True
        for j in range(c + 1, c + right + 1):
            if _isna(src[j]) or src[j] >= v:
                ok = False
                break
        if ok:
            for j in range(c - left, c):
                if _isna(src[j]) or src[j] > v:
                    ok = False
                    break
        if ok:
            out[i] = v
    return out

def ta_pivotlow(src, left, right):
    n = len(src)
    out = [NA] * n
    for i in range(left + right, n):
        c = i - right
        v = src[c]
        if _isna(v):
            continue
        ok = True
        for j in range(c + 1, c + right + 1):
            if _isna(src[j]) or src[j] <= v:
                ok = False
                break
        if ok:
            for j in range(c - left, c):
                if _isna(src[j]) or src[j] < v:
                    ok = False
                    break
        if ok:
            out[i] = v
    return out

def ta_highest(src, length):
    return [NA if i < length - 1 else max(src[i - length + 1:i + 1]) for i in range(len(src))]

def ta_lowest(src, length):
    return [NA if i < length - 1 else min(src[i - length + 1:i + 1]) for i in range(len(src))]

def _le(a, b):
    return not (_isna(a) or _isna(b)) and a <= b

def _ge(a, b):
    return not (_isna(a) or _isna(b)) and a >= b

def _lt(a, b):
    return not (_isna(a) or _isna(b)) and a < b

def _gt(a, b):
    return not (_isna(a) or _isna(b)) and a > b

def compute(bars, **overrides):
    p = dict(DEFAULTS)
    unknown = set(overrides) - set(DEFAULTS)
    if unknown:
        raise TypeError('unknown inputs: %s' % sorted(unknown))
    p.update(overrides)
    prd = p['prd']
    ChannelW = p['ChannelW']
    minstrength = p['minstrength']
    maxnumsr = p['maxnumsr'] - 1
    loopback = p['loopback']
    res_col, sup_col, inch_col = (p['res_col'], p['sup_col'], p['inch_col'])
    n = len(bars)
    high = [float(b['h']) for b in bars]
    low = [float(b['l']) for b in bars]
    close = [float(b['c']) for b in bars]
    opn = [float(b['o']) for b in bars]
    if p['ppsrc'] == 'High/Low':
        src1, src2 = (high, low)
    else:
        src1 = [max(c, o) for c, o in zip(close, opn)]
        src2 = [min(c, o) for c, o in zip(close, opn)]
    PH = ta_pivothigh(src1, prd, prd)
    PL = ta_pivotlow(src2, prd, prd)
    HH300 = ta_highest(high, 300)
    LL300 = ta_lowest(low, 300)
    pivotvals = []
    pivotlocs = []
    suportresistance = [0.0] * 20
    srchannels = [None] * 10
    boxes = {}
    next_box_id = 0
    box_order = []
    MAX_BOXES = 50
    signals = []
    debug = {'last_pivot_bar': None, 'last_stren': None, 'last_supres': None, 'last_pivotvals': None, 'last_pivotlocs': None, 'cwidth_at_last_pivot': None}

    def hist(series, i, k):
        j = i - k
        return series[j] if j >= 0 else NA
    for bar_index in range(n):
        ph = PH[bar_index]
        pl = PL[bar_index]
        cl = close[bar_index]
        if p['showpp']:
            pb = bar_index - prd
            if _pbool(ph):
                signals.append({'type': 'label', 'x': pb, 'y': high[pb], 'text': 'H', 'style': 'down', 'color': _RED, 'role': 'Pivot high'})
            if _pbool(pl):
                signals.append({'type': 'label', 'x': pb, 'y': low[pb], 'text': 'L', 'style': 'up', 'color': _LIME, 'role': 'Pivot low'})
        prdhighest = HH300[bar_index]
        prdlowest = LL300[bar_index]
        cwidth = NA if _isna(prdhighest) or _isna(prdlowest) else (prdhighest - prdlowest) * ChannelW / 100
        is_piv = _pbool(ph) or _pbool(pl)
        if is_piv:
            pivotvals.insert(0, ph if _pbool(ph) else pl)
            pivotlocs.insert(0, float(bar_index))
            for x in range(len(pivotvals) - 1, -1, -1):
                if bar_index - pivotlocs[x] > loopback:
                    pivotvals.pop()
                    pivotlocs.pop()
                    continue
                break

        def get_sr_vals(ind):
            lo = pivotvals[ind]
            hi = lo
            numpp = 0
            for y in range(0, len(pivotvals)):
                cpp = pivotvals[y]
                wdth = hi - cpp if cpp <= hi else cpp - lo
                if _le(wdth, cwidth):
                    if cpp <= hi:
                        lo = min(lo, cpp)
                    else:
                        hi = max(hi, cpp)
                    numpp = numpp + 20
            return (hi, lo, numpp)

        def changeit(x, y):
            tmp = suportresistance[y * 2]
            suportresistance[y * 2] = suportresistance[x * 2]
            suportresistance[x * 2] = tmp
            tmp = suportresistance[y * 2 + 1]
            suportresistance[y * 2 + 1] = suportresistance[x * 2 + 1]
            suportresistance[x * 2 + 1] = tmp
        if is_piv:
            supres = []
            stren = [0.0] * 10
            for x in range(0, len(pivotvals)):
                hi, lo, strength = get_sr_vals(x)
                supres.append(float(strength))
                supres.append(hi)
                supres.append(lo)
            for x in range(0, len(pivotvals)):
                h = supres[x * 3 + 1]
                l = supres[x * 3 + 2]
                s = 0
                for y in range(0, loopback + 1):
                    hy = hist(high, bar_index, y)
                    ly = hist(low, bar_index, y)
                    if _le(hy, h) and _ge(hy, l) or (_le(ly, h) and _ge(ly, l)):
                        s = s + 1
                supres[x * 3] = supres[x * 3] + s
            debug_supres_before = list(supres)
            for k in range(20):
                suportresistance[k] = 0.0
            src = 0
            for x in range(0, len(pivotvals)):
                stv = -1.0
                stl = -1
                for y in range(0, len(pivotvals)):
                    if supres[y * 3] > stv and supres[y * 3] >= minstrength * 20:
                        stv = supres[y * 3]
                        stl = y
                if stl >= 0:
                    hh = supres[stl * 3 + 1]
                    ll = supres[stl * 3 + 2]
                    suportresistance[src * 2] = hh
                    suportresistance[src * 2 + 1] = ll
                    stren[src] = supres[stl * 3]
                    for y in range(0, len(pivotvals)):
                        if supres[y * 3 + 1] <= hh and supres[y * 3 + 1] >= ll or (supres[y * 3 + 2] <= hh and supres[y * 3 + 2] >= ll):
                            supres[y * 3] = -1
                    src = src + 1
                    if src >= 10:
                        break
            for x in range(0, 9):
                for y in range(x + 1, 10):
                    if stren[y] > stren[x]:
                        tmp = stren[y]
                        stren[y] = stren[x]
                        changeit(x, y)
            debug.update(last_pivot_bar=bar_index, last_stren=list(stren), last_supres=debug_supres_before, last_pivotvals=list(pivotvals), last_pivotlocs=list(pivotlocs), cwidth_at_last_pivot=cwidth)

        def get_level(ind):
            ret = NA
            if ind < len(suportresistance):
                if suportresistance[ind] != 0:
                    ret = suportresistance[ind]
            return ret

        def get_color(ind):
            ret = None
            if ind < len(suportresistance):
                if suportresistance[ind] != 0:
                    a, b = (suportresistance[ind], suportresistance[ind + 1])
                    ret = res_col if a > cl and b > cl else sup_col if a < cl and b < cl else inch_col
            return ret
        for x in range(0, min(9, maxnumsr) + 1):
            bid = srchannels[x]
            if bid is not None and bid in boxes:
                del boxes[bid]
            srcol = get_color(x * 2)
            if srcol is not None:
                top, bot = (get_level(x * 2), get_level(x * 2 + 1))
                a, b = (suportresistance[x * 2], suportresistance[x * 2 + 1])
                role = 'Resistance channel' if a > cl and b > cl else 'Support channel' if a < cl and b < cl else 'Channel (price inside)'
                boxes[next_box_id] = {'type': 'box', 'left': bar_index, 'top': top, 'right': bar_index + 1, 'bottom': bot, 'extend': 'both', 'color': srcol, 'text': '', 'role': role, '_slot': x}
                box_order.append(next_box_id)
                srchannels[x] = next_box_id
                next_box_id += 1
                alive = [b for b in box_order if b in boxes]
                while len(alive) > MAX_BOXES:
                    del boxes[alive.pop(0)]
                box_order = alive
        resistancebroken = False
        supportbroken = False
        not_in_a_channel = True
        for x in range(0, min(9, maxnumsr) + 1):
            if cl <= suportresistance[x * 2] and cl >= suportresistance[x * 2 + 1]:
                not_in_a_channel = False
        if not_in_a_channel:
            c1 = hist(close, bar_index, 1)
            for x in range(0, min(9, maxnumsr) + 1):
                if _le(c1, suportresistance[x * 2]) and cl > suportresistance[x * 2]:
                    resistancebroken = True
                if _ge(c1, suportresistance[x * 2 + 1]) and cl < suportresistance[x * 2 + 1]:
                    supportbroken = True
        if p['showsrbroken'] and resistancebroken:
            signals.append({'type': 'label', 'x': bar_index, 'y': low[bar_index], 'text': '', 'style': 'up', 'color': _LIME, 'role': 'Resistance broken'})
        if p['showsrbroken'] and supportbroken:
            signals.append({'type': 'label', 'x': bar_index, 'y': high[bar_index], 'text': '', 'style': 'down', 'color': _RED, 'role': 'Support broken'})
    out = []
    for bid in sorted(boxes, key=lambda b: boxes[b]['_slot']):
        d = dict(boxes[bid])
        d.pop('_slot')
        out.append(d)
    cutoff = n - PLOTSHAPE_WINDOW
    out.extend((s for s in signals if s['x'] >= cutoff))
    debug['suportresistance'] = list(suportresistance)
    debug['PH'], debug['PL'] = (PH, PL)
    return (out, debug)

def run(bars, **overrides):
    return compute(bars, **overrides)[0]
