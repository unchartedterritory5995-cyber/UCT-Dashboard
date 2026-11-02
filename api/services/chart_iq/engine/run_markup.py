# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
from . import _db
import importlib, json, multiprocessing as mp, os, sqlite3, sys, time, traceback
HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(HERE)
PORTS = os.path.join(HERE, 'ports')
NBARS = 1500

def ymd(t):
    s = str(int(t))
    return '%s-%s-%s' % (s[:4], s[4:6], s[6:])

def load_bars(sym, asof):
    ro = _db.bars()
    try:
        rows = ro.execute("SELECT ts,o,h,l,c,v FROM (SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? ORDER BY ts DESC LIMIT ?) ORDER BY ts", (sym, int(asof.replace('-', '')), NBARS)).fetchall()
    finally:
        ro.close()
    return [dict(t=int(r[0]), o=float(r[1]), h=float(r[2]), l=float(r[3]), c=float(r[4]), v=float(r[5] or 0)) for r in rows]

def ports():
    return sorted((f[:-3] for f in os.listdir(PORTS) if f.endswith('.py') and (not f.startswith(('test_', '_')))))

def r4(x):
    return round(float(x), 4)
MAX_PIECES = 12

def chain_segments(draws):
    lines = [w for w in draws if w.get('type') == 'line' and (w.get('extend') or 'none') == 'none']
    rest = [w for w in draws if not (w.get('type') == 'line' and (w.get('extend') or 'none') == 'none')]
    by_role = {}
    for w in lines:
        by_role.setdefault(w.get('role') or '', []).append(w)
    out = list(rest)
    for role, ws in by_role.items():
        ws = sorted(ws, key=lambda w: min(w['x1'], w['x2']))
        chains, cur = ([], [])
        for w in ws:
            a, b = sorted([(w['x1'], w['y1']), (w['x2'], w['y2'])])
            if cur and cur[-1][1][0] == a[0] and (abs(cur[-1][1][1] - a[1]) <= 1e-06 * max(1.0, abs(a[1]))):
                cur.append((a, b, w))
            else:
                if cur:
                    chains.append(cur)
                cur = [(a, b, w)]
        if cur:
            chains.append(cur)
        for ch in chains:
            if len(ch) < 3:
                out += [w for _, _, w in ch]
                continue
            pts = [ch[0][0]] + [b for _, b, _ in ch]
            step = max(1, -(-(len(pts) - 1) // MAX_PIECES))
            keep = pts[::step] + ([pts[-1]] if (len(pts) - 1) % step else [])
            w0 = ch[0][2]
            out.append({'type': 'polyline', 'points': [list(p) for p in keep], 'closed': False, 'color': w0.get('color', ''), 'text': w0.get('text', ''), 'role': role})
    return out

def convert(draws, bars, dates, key):
    d = [ymd(b['t']) for b in bars]
    i = len(bars) - 1
    v0 = next((k for k, x in enumerate(d) if x >= dates[0]), 0)
    D = lambda k: d[max(v0, min(i, int(k)))]
    close = bars[-1]['c']
    out = []
    cur = {}

    def add(o):
        o['_w'] = cur.get('w', {})
        out.append(o)

    def seg(x1, y1, x2, y2, extend, role, text):
        x1, x2 = (int(x1), int(x2))
        if x2 < x1:
            x1, y1, x2, y2 = (x2, y2, x1, y1)
        reaches_right = extend in ('right', 'both')
        if x2 < v0 and (not reaches_right):
            return
        if x1 < v0:
            if x2 == x1:
                return
            if x2 < v0:
                return
            y1 = y1 + (y2 - y1) * (v0 - x1) / (x2 - x1)
            x1 = v0
        name = text or role or 'Line'
        if abs(y2 - y1) <= 1e-09 * max(1.0, abs(y1)) and (reaches_right or x2 >= i - 1):
            add({'kind': 'hline', 'ptype': name, 'price': r4(y1), 'start': D(x1)})
        else:
            o = {'kind': 'trendline', 'ptype': name, 'd1': D(x1), 'p1': r4(y1), 'd2': D(x2), 'p2': r4(y2), 'extend': bool(reaches_right)}
            if o['d1'] == o['d2'] and (not o['extend']):
                return
            add(o)
    draws = chain_segments(draws)
    seen_boxes = set()
    for w in draws:
        cur['w'] = w
        t = w.get('type')
        role = w.get('role') or ''
        text = (w.get('text') or '').strip()
        if t == 'polyline' and w.get('closed'):
            continue
        if t == 'line':
            sig = ('L',) + tuple(sorted([(w['x1'], round(w['y1'], 6)), (w['x2'], round(w['y2'], 6))])) + (w.get('extend') or 'none',)
            if sig in seen_boxes:
                continue
            seen_boxes.add(sig)
        if t == 'box':
            sig = (min(w['left'], w['right']), max(w['left'], w['right']), round(w['top'], 6), round(w['bottom'], 6))
            if sig in seen_boxes:
                continue
            seen_boxes.add(sig)
        if t == 'line':
            ext = w.get('extend') or 'none'
            x1, y1, x2, y2 = (w['x1'], w['y1'], w['x2'], w['y2'])
            if ext in ('right', 'both') and max(x1, x2) < v0 and (x1 != x2):
                s = (y2 - y1) / (x2 - x1)
                x1, y1, x2, y2 = (v0, y1 + s * (v0 - x1), i, y1 + s * (i - x1))
            seg(x1, y1, x2, y2, ext, role, text)
        elif t == 'polyline':
            pts = w.get('points') or []
            for (a, pa), (b, pb) in zip(pts, pts[1:]):
                seg(a, pa, b, pb, 'none', role, text)
        elif t == 'box':
            L, R = (int(min(w['left'], w['right'])), int(max(w['left'], w['right'])))
            ext = (w.get('extend') or 'none') in ('right', 'both')
            if (w.get('extend') or 'none') in ('left', 'both'):
                L = 0
            if R < v0 and (not ext):
                continue
            top, bot = (max(w['top'], w['bottom']), min(w['top'], w['bottom']))
            res = 'resist' in role.lower() or ('support' not in role.lower() and bot > close)
            o = {'kind': 'zone', 'ptype': text or role or ('Resistance' if res else 'Support'), 'role': 'Resistance' if res else 'Support', 'top': r4(top), 'bot': r4(bot), 'start': D(L), 'end': D(i if ext else R), 'state': 'intact', 'end_ext_px': 40 if ext or R >= i else 0}
            add(o)
        elif t == 'label':
            x = int(w['x'])
            if x < v0 or x > i:
                continue
            st = w.get('style') or 'none'
            at = 'low' if st == 'up' else 'high' if st == 'down' else 'low' if w['y'] <= bars[x]['l'] else 'high'
            add({'kind': 'candle', 'ptype': text or role or 'Signal', 'also': [], 'at': at, 'pts': [{'d': d[x], 'p': r4(bars[x]['l'] if at == 'low' else bars[x]['h'])}], 'why': role})
    for n, o in enumerate(out, 1):
        o.update(id='%s_%d' % (key, n), added=True, src='tv_' + key)
        w = o.pop('_w', {})
        if w.get('color'):
            o['color'] = w['color']
        if w.get('style') in ('dashed', 'dotted') and w.get('type') != 'label':
            o['dash'] = w['style']
        if not (w.get('text') or '').strip():
            o['nolabel'] = True
    return out

def work(job):
    ent, keys, ov, outkey = job
    E = ent['edit']
    dates = E['bars']['dates']
    b = load_bars(ent['ticker'], dates[-1])
    res, errs = ({}, [])
    if len(b) < 60 or ymd(b[-1]['t']) != dates[-1]:
        return (ent['id'], res, [('*', 'no bars for %s %s' % (ent['ticker'], dates[-1]))])
    for k in keys:
        try:
            mod = importlib.import_module('.ports.' + k, __package__)
            res[k] = convert(mod.run(b, **ov), b, dates, outkey.get(k, k))
        except Exception:
            errs.append((k, traceback.format_exc()[-600:]))
    return (ent['id'], res, errs)
