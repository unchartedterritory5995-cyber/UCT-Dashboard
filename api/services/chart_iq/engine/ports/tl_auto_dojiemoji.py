# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Python port of "Auto Trendline [DojiEmoji]" (c) DojiEmoji, https://www.tradingview.com/script/xYaiqwD8/
# Ported for the UCT lab; behaviour kept identical to the Pine original at its default inputs.
import math
NAME = 'Auto Trendline (DojiEmoji)'
DEFAULTS = {'n': 10, 'col_hl': '#2196F3', 'show_hl': True, 'col_ll': '#787B86', 'show_ll': False, 'col_lh': '#FF5252', 'show_lh': True, 'col_hh': '#787B86', 'show_hh': False, 'ln_col_recent': '#9C27B0', 'lnwidth_recent': 'Width 1', 'ln_col_prev': '#787B86', 'lnwidth_prev': 'Width 1', 'max_pairs': 1, 'extend': 'Right', 'show_crosses': False}
MAX_LINES_COUNT = 500
SHAPE_WINDOW = 150
TYPE_UP = 1
TYPE_DOWN = -1
NA = None

def _isna(x):
    return x is None or (isinstance(x, float) and math.isnan(x))

def _get_width(s):
    return {'Width 1': 1, 'Width 2': 2}.get(s)

def _pine_bool(x):
    return not _isna(x) and x != 0

def pivothigh(src, left, right, i):
    c = i - right
    if c - left < 0 or c < 0:
        return NA
    v = src[c]
    if _isna(v):
        return NA
    for k in range(c - left, c):
        if _isna(src[k]) or src[k] > v:
            return NA
    for k in range(c + 1, c + right + 1):
        if _isna(src[k]) or src[k] >= v:
            return NA
    return v

def pivotlow(src, left, right, i):
    c = i - right
    if c - left < 0 or c < 0:
        return NA
    v = src[c]
    if _isna(v):
        return NA
    for k in range(c - left, c):
        if _isna(src[k]) or src[k] < v:
            return NA
    for k in range(c + 1, c + right + 1):
        if _isna(src[k]) or src[k] <= v:
            return NA
    return v

class _Line:
    __slots__ = ('x1', 'y1', 'x2', 'y2', 'extend', 'color', 'style', 'width', 'role', 'alive')

    def __init__(self, x1, y1, x2, y2, extend, color, style, width, role):
        self.x1, self.y1, self.x2, self.y2 = (x1, y1, x2, y2)
        self.extend, self.color, self.style, self.width, self.role = (extend, color, style, width, role)
        self.alive = True

def run(bars, **overrides):
    p = dict(DEFAULTS)
    unknown = set(overrides) - set(p)
    if unknown:
        raise KeyError('unknown inputs: %s' % sorted(unknown))
    p.update(overrides)
    n = int(p['n'])
    lnwidth_recent = _get_width(p['lnwidth_recent'])
    lnwidth_prev = _get_width(p['lnwidth_prev'])
    max_tl = int(p['max_pairs']) * 2
    str_extend = 'both' if p['extend'] == 'Both ways' else 'right'
    keep = math.floor(max_tl / 2)
    H = [b['h'] for b in bars]
    L = [b['l'] for b in bars]
    C = [b['c'] for b in bars]
    N = len(bars)
    all_lines = []
    arr_ln_up = []
    arr_ln_dn = []
    shapes = []

    def line_new(x1, y1, x2, y2, role):
        ln = _Line(x1, y1, x2, y2, str_extend, p['ln_col_recent'], 'dashed', lnwidth_recent, role)
        all_lines.append(ln)
        live = [l for l in all_lines if l.alive]
        if len(live) > MAX_LINES_COUNT:
            live[0].alive = False
        return ln

    def draw_trendline(ftype, x2, y2, x1, y1):
        role = 'Upper trendline' if ftype == TYPE_UP else 'Lower trendline'
        ln = line_new(x2, y2, x1, y1, role)
        arr = arr_ln_up if ftype == TYPE_UP else arr_ln_dn
        arr.insert(0, ln)
        if len(arr) > 1:
            arr[1].color = p['ln_col_prev']
            arr[1].width = lnwidth_prev
            while len(arr) > keep:
                arr.pop().alive = False
    recent_dn1 = recent_up1 = recent_dn2 = recent_up2 = NA
    i_recent_dn1 = i_recent_up1 = i_recent_dn2 = i_recent_up2 = NA
    prev_close = NA
    prev_y_up = prev_y_dn = NA
    for i in range(N):
        ph = pivothigh(H, n, n, i - 1) if i >= 1 else NA
        pl = pivotlow(L, n, n, i - 1) if i >= 1 else NA
        upfract = not _isna(ph)
        downfract = not _isna(pl)
        if downfract:
            recent_dn2, i_recent_dn2 = (recent_dn1, i_recent_dn1)
            recent_dn1, i_recent_dn1 = (L[i - n - 1], i - n - 1)
            draw_trendline(TYPE_DOWN, i_recent_dn2, recent_dn2, i_recent_dn1, recent_dn1)
        if upfract:
            recent_up2, i_recent_up2 = (recent_up1, i_recent_up1)
            recent_up1, i_recent_up1 = (H[i - n - 1], i - n - 1)
            draw_trendline(TYPE_UP, i_recent_up2, recent_up2, i_recent_up1, recent_up1)

        def gt(a, b):
            return not _isna(a) and (not _isna(b)) and (a > b)
        hh = _pine_bool(H[i - n - 1]) if upfract and gt(recent_up1, recent_up2) else False
        lh = _pine_bool(H[i - n - 1]) if upfract and gt(recent_up2, recent_up1) else False
        hl = _pine_bool(L[i - n - 1]) if downfract and gt(recent_dn1, recent_dn2) else False
        ll = _pine_bool(L[i - n - 1]) if downfract and gt(recent_dn2, recent_dn1) else False
        x = i - n - 1
        if p['show_hh'] and hh:
            shapes.append((x, i, {'type': 'label', 'x': x, 'y': H[x], 'text': 'HH', 'style': 'down', 'color': p['col_hh'], 'role': 'Higher high fractal'}))
        if p['show_lh'] and lh:
            shapes.append((x, i, {'type': 'label', 'x': x, 'y': H[x], 'text': 'LH', 'style': 'down', 'color': p['col_lh'], 'role': 'Lower high fractal'}))
        if p['show_ll'] and ll:
            shapes.append((x, i, {'type': 'label', 'x': x, 'y': L[x], 'text': 'LL', 'style': 'up', 'color': p['col_ll'], 'role': 'Lower low fractal'}))
        if p['show_hl'] and hl:
            shapes.append((x, i, {'type': 'label', 'x': x, 'y': L[x], 'text': 'HL', 'style': 'up', 'color': p['col_hl'], 'role': 'Higher low fractal'}))

        def solve(xA, yA, xB, yB):
            if _isna(xA) or _isna(yA) or _isna(xB) or _isna(yB) or (xB == xA):
                return NA
            m = (yB - yA) / (xB - xA)
            return m * i + yA - m * xA
        y_dn = solve(i_recent_dn1, recent_dn1, i_recent_dn2, recent_dn2)
        y_up = solve(i_recent_up1, recent_up1, i_recent_up2, recent_up2)

        def cross(a, b, a1, b1):
            if any((_isna(v) for v in (a, b, a1, b1))):
                return False
            return a > b and a1 <= b1 or (a < b and a1 >= b1)
        cross_upper = cross(C[i], y_up, prev_close, prev_y_up)
        cross_lower = cross(C[i], y_dn, prev_close, prev_y_dn)
        if p['show_crosses'] and cross_upper:
            shapes.append((i, i, {'type': 'label', 'x': i, 'y': L[i], 'text': '', 'style': 'up', 'color': '#2196F3', 'role': 'Crossed upper trendline'}))
        if p['show_crosses'] and cross_lower:
            shapes.append((i, i, {'type': 'label', 'x': i, 'y': H[i], 'text': '', 'style': 'down', 'color': '#FF5252', 'role': 'Crossed lower trendline'}))
        prev_close, prev_y_up, prev_y_dn = (C[i], y_up, y_dn)
    out = []
    for ln in all_lines:
        if not ln.alive or any((_isna(v) for v in (ln.x1, ln.y1, ln.x2, ln.y2))):
            continue
        out.append({'type': 'line', 'x1': ln.x1, 'y1': float(ln.y1), 'x2': ln.x2, 'y2': float(ln.y2), 'extend': ln.extend, 'style': ln.style, 'color': ln.color, 'width': ln.width, 'text': '', 'role': ln.role})
    cutoff = N - SHAPE_WINDOW
    for drawn, _emit, d in shapes:
        if drawn >= cutoff:
            out.append(d)
    return out
