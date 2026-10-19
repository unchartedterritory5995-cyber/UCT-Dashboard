"""Member levels v3 (2026-10-18): v2's chart-reading levels PLUS a guaranteed near support and near resistance.

Port of the lab study lab/levels_v3 (pre-registered; PREREG.txt + PREREG.hashes frozen before any v3 level was drawn
on test data) and its confirmation packet lab/levels_v3_confirm (pre-registered the same way).

  1. v2's three chart-reading levels (api/services/levels_v2.py: the frozen ranker, best-first, 0.6 ATR dedupe,
     one above the close), unchanged;
  2. a near support in [close - 1.5 ATR, close) unless one is already drawn: the best v2-scored candidate there,
     else the prior-day low; then the same for near resistance in (close, close + 1.5 ATR], else the prior-day high;
  3. never more than 4 (C2's count): the lowest-scored v2 level that is not the only near level on its side goes;
  4. fewer than 4: the prior-day low / high fill, each unless within 0.6 ATR of a drawn level.
Labels: a named level keeps its name (the data high is 'major H'); a pivot high now below the close is
'old high / flip', a pivot low now above it 'old low / flip'; never 'round', never a bare 'level'.

Evidence. Team agreement on 301 fresh recovered team charts: a statistical tie with C2 (F1 +0.005 [-0.020, +0.031],
lift +0.016 [-0.015, +0.046], recall -3.1 pts); a support within 1.5 ATR below the close on 100% of charts (C2
91.5%). Blind AI judges, learned-levels rubric unchanged: packet J (20 charts, both drawers mixed) v3 2.70 vs C2
2.10, paired +0.60 [+0.30, +0.85]; confirmation (30 fresh charts where the two differ, two balanced packets, four
fresh judges, no judge saw both versions of a chart) v3 2.53 vs C2 2.20, 90% of v3 charts >= 2, paired +0.33,
90% CI [+0.15, +0.52], v3 better on 16, C2 on 6, 8 ties.

Display only: nothing here touches what any detector fires on.
`drawn_levels(bars, last_bar_forming)` -> {'round': LEVELS_V3_ROUND, 'asof_t', 'horizontals': [...]} or None. Only
bars up to the last COMPLETE bar are read (a forming last bar is dropped): no lookahead.
"""
from __future__ import annotations

import types as _types

import numpy as np

from api.services import levels_v2 as D2
from api.services.levels_v2 import K

#: The dated tier stamp of this drawing. auto_structures serves these levels in place of the C2 levels only while
#: the stamp equals its own MEMBER_LEVELS_ROUND literal (fail closed to the C2 drawer otherwise).
LEVELS_V3_ROUND = "2026-10-18-v3"

#: sha256 of the two verbatim blocks below as they stand in the lab (lab/levels_v3/v3core.py after its imports;
#: drawer_v3.py from `def label(` to the lab plug-in). tests/test_levels_v3_lab_parity.py re-checks them.
CORE_BLOCK_SHA256 = "0fc81158e01e57ce86a080efd19c004c42e2c6be91ebe0a6dfd82fabce12741d"
DRAWER_BLOCK_SHA256 = "9f161104a259b795be4e02dd9da6a9d53af8d343dce85ec91f42818a6914fcd3"

# ---- BEGIN VERBATIM lab/levels_v3/v3core.py
NEAR_ATR = 1.5
SEP_ATR = 0.6
CAP = 4
K_V2 = 3


def _near(rows, s, close, at, side):
    if side < 0:
        idx = [q for q, r in enumerate(rows) if close - NEAR_ATR * at <= r['price'] < close]
    else:
        idx = [q for q, r in enumerate(rows) if close < r['price'] <= close + NEAR_ATR * at]
    if not idx:
        return None
    return max(idx, key=lambda q: (s[q], -q))


def v2_set(rows, s, close, at):
    """exactly drawer_v2.draw_levels' selection (indices), before its nearest-first sort."""
    order = np.argsort(-s, kind='stable')
    chosen = []
    for q in order:
        p = rows[q]['price']
        if all(abs(p - rows[g]['price']) > SEP_ATR * at for g in chosen):
            chosen.append(int(q))
    out = chosen[:K_V2]
    if out and not any(rows[q]['price'] > close for q in out):
        ab = [q for q in chosen[K_V2:] if rows[q]['price'] > close]
        if ab:
            out = out[:K_V2 - 1] + [ab[0]]
    return out


def has_near(prices, close, at, side):
    if side < 0:
        return any(close - NEAR_ATR * at <= p < close for p in prices)
    return any(close < p <= close + NEAR_ATR * at for p in prices)


def _guarantees(rows, s, close, at, pdh, pdl):
    g = []
    qs = _near(rows, s, close, at, -1)
    if qs is not None:
        g.append((rows[qs]['price'], 'near_s', qs))
    elif pdl is not None and pdl < close:
        g.append((float(pdl), 'pdl_fallback', None))
    qr = _near(rows, s, close, at, +1)
    if qr is not None:
        g.append((rows[qr]['price'], 'near_r', qr))
    elif pdh is not None and pdh > close:
        g.append((float(pdh), 'pdh_fallback', None))
    return g


def select_v3(rows, s, close, at, pdh, pdl):
    if not rows:
        return []
    out = [(rows[q]['price'], 'v2', q) for q in v2_set(rows, s, close, at)]
    for p, tag, q in _guarantees(rows, s, close, at, pdh, pdl):
        side = -1 if tag in ('near_s', 'pdl_fallback') else 1
        if has_near([x[0] for x in out], close, at, side):
            continue
        dup = [x for x in out if x[1] == 'v2' and abs(x[0] - p) <= SEP_ATR * at
               and not has_near([x[0]], close, at, -side)]
        out = [x for x in out if x not in dup] + [(p, tag, q)]

    def protected(x):
        if x[1] != 'v2':
            return True
        for sd in (-1, 1):
            if has_near([x[0]], close, at, sd) and sum(has_near([y[0]], close, at, sd) for y in out) == 1:
                return True
        return False
    while len(out) > CAP:
        drop = [x for x in out if not protected(x)] or [x for x in out if x[1] == 'v2']
        out.remove(min(drop, key=lambda x: s[x[2]]))
    for p, t in sorted([(float(x), t) for x, t in ((pdl, 'pdl'), (pdh, 'pdh')) if x is not None],
                       key=lambda z: abs(z[0] - close)):
        if len(out) < CAP and all(abs(p - x[0]) > SEP_ATR * at for x in out):
            out.append((p, t, None))
    out.sort(key=lambda x: abs(x[0] - close))
    return out
# ---- END VERBATIM lab/levels_v3/v3core.py

# the lab drawer addresses the selection module as `V.`
V = _types.SimpleNamespace(select_v3=select_v3)


# ---- BEGIN VERBATIM lab/levels_v3/drawer_v3.py
def label(cx, srcs, p, tag):
    close = cx['close']
    if tag in ('pdl', 'pdl_fallback'):
        return 'PDL'
    if tag in ('pdh', 'pdh_fallback'):
        return 'PDH'
    for k, lab in D2.LABELS:
        if k in srcs:
            return 'major H' if lab == 'high' else lab
    if 'pivot' in srcs:
        near = [v for v in cx['piv'] if abs(v[0] - p) <= K.CAND_DEDUPE_ATR * cx['atr']]
        if near:
            hi = max(near, key=lambda v: v[2])[3] == 1
            if hi:
                return 'swing H' if p >= close else 'old high / flip'
            return 'swing L' if p <= close else 'old low / flip'
    if 'gap' in srcs:
        return 'gap'
    if 'vshelf' in srcs:
        return 'vol shelf'
    return 'support' if p < close else 'resistance'


def draw_levels(a, i):
    cx, rows = K.feature_rows(a, i)
    if not rows:
        return []
    s = D2._score(rows)
    pdh, pdl = float(a[i, 2]), float(a[i, 3])
    res = []
    for p, tag, q in V.select_v3(rows, s, cx['close'], cx['atr'], pdh, pdl):
        srcs = rows[q]['srcs'] if q is not None else [('pdl' if tag.startswith('pdl') else 'pdh')]
        res.append({'price': float(p), 'j': D2._anchor(cx, p), 'label': label(cx, srcs, p, tag), 'sources': srcs,
                    'score': float(s[q]) if q is not None else None, 'tag': tag})
    return res
# ---- END VERBATIM lab/levels_v3/drawer_v3.py


def drawn_levels(bars, last_bar_forming=False):
    """The v3 horizontals for daily `bars` ((ts, o, h, l, c, v) tuples, oldest first, already cleaned), in the
    auto_draw horizontal shape {source, label, price, t_from, score, why}. While the last bar is a session still
    forming it is dropped (the lab drew as of a complete bar). None when there are too few bars."""
    rows = [tuple(b[:6]) for b in bars or [] if None not in tuple(b[:5])]
    if last_bar_forming and rows:
        rows = rows[:-1]
    if len(rows) < 31:
        return None
    a = np.array([[float(x or 0) for x in r] for r in rows])
    i = len(a) - 1
    at = D2.atr(a, i)
    if not at or at <= 0:
        return None
    out = []
    for h in draw_levels(a, i):
        out.append({'source': 'levels_v3', 'label': h['label'], 'price': round(h['price'], 4),
                    't_from': int(a[h['j'], 0]),
                    'score': round(h['score'], 4) if h['score'] is not None else None,
                    'why': ', '.join(h['sources']) + ('' if h['tag'] == 'v2' else ' (%s)' % h['tag'])})
    return {'round': LEVELS_V3_ROUND, 'asof_t': int(a[i, 0]), 'horizontals': out}
