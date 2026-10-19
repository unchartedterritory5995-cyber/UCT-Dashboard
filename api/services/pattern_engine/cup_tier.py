"""Cup tier: a display-confidence STAMP on a live bc:cup-with-handle row, plus its member drawing (round 4).

Display only: nothing here changes what the cup detector (primitives/cup.cup_with_handle_state) fires on, its
state, pivot, levels, HIST_SCORE or `confirmed_only`. A row the tier does not stamp is left exactly as it was
(auto_structures.cup_tier_stamp adds `extras.cup_tier` and nothing else).

Recognition (lab cup_tier_v2, confirmed on two fresh blind packets: 28 of 33 decided = 84.8% at T = 0.945, against
14.3% for the live detector alone): the live detector fires on the 400-bar working window AND a reference cup model
(lip L / cup low m / right-side peak R chosen by maximum conformance C = 0.5 x feature envelope + 0.5 x correlation
with a median team cup path) passes every gate in GATES, hump <= HUMP_MAX, hi300 >= HI300_MIN and C >= T.

Drawing round 4 (lab cup_draw_v4, pre-registered, two fresh blind drawing packets with two judges each: d1 mean 2.42
[2.20, 2.62], 96% of charts >= 2; d2 2.50 [2.28, 2.72], 88% >= 2; bar 2.3 and 70%): the pivot sits at the HANDLE HIGH
when the right side's highest high since the cup low is more than EPS_ATR ATR(14) short of the rim on closes (the
rim then stays as a faint reference), otherwise at the rim on closes from the lip; the handle box spans the
right-side peak to the last bar. The drawing is WITHHELD (the stamp carries `withheld`, nothing is drawn for
members), checked in this order:
  spike_lip    the rim bar's close is a one-bar spike (> SPIKE_ATR ATR above every other close within SPIKE_BARS);
  handle_low   the handle box floor sits in the cup's lower half (FLOOR_MIN);
  handle_deep  the handle box is deeper than HDEP_MAX of the cup's depth (rim on closes - cup low);
  pivot_short  the pivot sits more than PSHORT_MAX ATR below the rim (the right side is far short);
  above_pivot  a close since the right-side peak already sits > ABOVE_ATR ATR above the pivot.
Coverage cost: round 4 withholds 48.4% of the lab's 1,402 tier fires (pivot_short 22.0%, handle_deep 20.9%,
above_pivot 3.1%, spike_lip 2.4%); a withheld fire keeps its recognition stamp but draws nothing.
Served population (measured in the lab by the independent verifier, 2026-10-18): the admin display rounds mark
63.6% of the 1,402 tier fires stale BEFORE the stamp runs (failed_breakout 297, gap_island 176, rim_broken 173,
short_of_rim 164, ...), so those rows are never served at all, and round 4 withholds 169 more. End-to-end member
coverage is 341 of 1,402 tier fires = 24.3%. Of the 50 judged round-4 charts, the 21 a member can actually be
served score mean 2.36 [2.10, 2.62], 85.7% >= 2 (post hoc, not a pre-registered gate); served recognition is
8 of 8 decided.

Every read is on the bars up to the last one: no later bar exists for it to see. Needs at most the last 446 bars
(best_window's 325-bar lip search + the 120-bar prior-advance look-back), so the 600 bars auto_structures hands it
give the same answer as the full history.
"""
from __future__ import annotations

import numpy as np

#: The recognition threshold the blind packets confirmed (lab cup_tier_v2 dev_select).
T = 0.945
#: The drawing round the blind drawing packets confirmed (lab cup_draw_v4).
DRAW_ROUND = 4
TIER_NAME = "cup_conf"
TIER_VERSION = 2
WORKING_BARS = 400

# ---------------------------------------------------------------- reference cup model (lab refmodels/cup)
NPTS = 41
TEMPLATE = np.array([
    0.85122, 0.7901, 0.73432, 0.68618, 0.64789, 0.61702, 0.59114, 0.48863, 0.44551, 0.39821, 0.35473, 0.31582,
    0.28494, 0.27322, 0.26997, 0.25117, 0.23119, 0.2333, 0.23442, 0.19758, 0.22236, 0.23146, 0.26992, 0.26962,
    0.27483, 0.27901, 0.28803, 0.28925, 0.30068, 0.29289, 0.31916, 0.35786, 0.36225, 0.42109, 0.43517, 0.51897,
    0.57921, 0.69125, 0.75012, 0.7924, 0.83765])
#: feature: (lo, hi, weight); None = open bound
ENVELOPE = {
    'prior': (0.30, None, 1.0),
    'cup_wk': (3.0, 65.0, 1.0),
    'depth': (0.12, 0.55, 1.0),
    'lip_prom': (0.0, None, 2.0),
    'rim': (-0.10, 0.03, 1.5),
    'over': (None, 0.02, 1.0),
    'lowpos': (0.20, 0.75, 0.5),
    'dwell': (0.18, None, 1.0),
    'hump': (None, 0.40, 1.0),
    'h_depth': (None, 0.25, 1.0),
    'h_pos': (None, 0.65, 1.0),
    'h_bars': (0, 25, 0.5),
    'vs200': (0.0, None, 1.0),
}


def _smooth(x, k=5):
    if len(x) < k:
        return x.copy()
    pad = k // 2
    xp = np.concatenate([np.repeat(x[0], pad), x, np.repeat(x[-1], pad)])
    return np.convolve(xp, np.ones(k) / k, mode='valid')


def _cup_path(b, L, R, lip, low):
    c = _smooth(b[L:R + 1, 4], 5 if R - L >= 15 else 3)
    y = (c - low) / (lip - low)
    xs = np.linspace(0, len(y) - 1, NPTS)
    return np.interp(xs, np.arange(len(y)), y)


def _hump(cc):
    lo = float(cc.min())
    D = float(max(cc[0], cc[-1])) - lo
    if D <= 0 or len(cc) < 3:
        return None
    pmin = np.minimum.accumulate(cc)
    smin = np.minimum.accumulate(cc[::-1])[::-1]
    hj = cc[1:-1] - np.maximum(pmin[:-2], smin[2:])
    return max(float(hj.max()), 0.0) / D


def _feats(b, L, m, R, A):
    H, Lo, C = b[:, 2], b[:, 3], b[:, 4]
    lip = float(H[L])
    low = float(Lo[m])
    rsh = float(H[R])
    f = {}
    n = R - L
    f['cup_wk'] = n / 5.0
    f['depth'] = (lip - low) / lip
    f['lowpos'] = (m - L) / n if n > 0 else None
    f['rim'] = (rsh - lip) / lip
    pre = Lo[max(0, L - 120):L]
    f['prior'] = (lip / float(pre.min()) - 1.0) if len(pre) >= 20 else None
    prev = H[max(0, L - 60):L]
    f['lip_prom'] = (lip / float(prev.max()) - 1.0) if len(prev) >= 10 else None
    cc = C[L:R + 1]
    f['dwell'] = float(np.mean(cc <= low + (lip - low) / 3.0)) if n > 0 else None
    sc = _smooth(cc, 5 if n >= 15 else 3)
    f['hump'] = _hump(sc)
    f['rs_frac'] = (R - m) / n if n > 0 else None
    f['over'] = float(C[L + 1:R + 1].max()) / lip - 1.0 if n > 0 else None
    hb = A - R
    f['h_bars'] = hb
    if hb >= 1:
        hl = float(Lo[R + 1:A + 1].min())
        f['h_depth'] = (rsh - hl) / rsh
        f['h_pos'] = (lip - hl) / (lip - low)
    else:
        f['h_depth'] = 0.0
        f['h_pos'] = (lip - float(C[A])) / (lip - low)
    f['h_drift'] = None
    s200 = C[max(0, A - 199):A + 1]
    f['vs200'] = float(C[A]) / float(s200.mean()) - 1.0 if len(s200) >= 150 else None
    f['path'] = _cup_path(b, L, R, lip, low).tolist() if n >= 4 else None
    return f


def _in_range(k, v):
    lo, hi, _ = ENVELOPE[k]
    return (lo is None or v >= lo) and (hi is None or v <= hi)


def _conformance(f):
    num = den = 0.0
    fails = []
    for k, (lo, hi, w) in ENVELOPE.items():
        v = f.get(k)
        if v is None:
            continue
        den += w
        if _in_range(k, v):
            num += w
        else:
            fails.append(k)
    E = num / den if den else 0.0
    p = f.get('path')
    if p is None:
        S = 0.0
    else:
        p = np.array(p)
        S = 0.0 if np.std(p) < 1e-9 else float(np.corrcoef(p, TEMPLATE)[0, 1])
    return 0.5 * E + 0.5 * max(0.0, S), E, S, fails


def _best_window(b, A, max_back=325, min_cup=12, swing=5):
    H, Lo = b[:, 2], b[:, 3]
    if A < 60:
        return None
    a0 = max(0, A - 25)
    seg = H[a0:A + 1]
    R = a0 + int(len(seg) - 1 - np.argmax(seg[::-1]))
    best = None
    for L in range(max(swing, A - max_back), R - min_cup + 1):
        if H[L] < H[max(0, L - swing):L + swing + 1].max():
            continue
        m = L + 1 + int(np.argmin(Lo[L + 1:R]))
        if Lo[m] >= H[L]:
            continue
        f = _feats(b, L, m, R, A)
        C, E, S, fails = _conformance(f)
        if best is None or C > best['C']:
            best = {'C': C, 'E': E, 'S': S, 'fails': fails, 'L': L, 'm': m, 'R': R, 'A': A, 'f': f}
    return best


# ---------------------------------------------------------------- tier measures (lab cup_tier ct_common + ct2_tier)
def _atr(b, A, n=14):
    H, L, C = b[:, 2], b[:, 3], b[:, 4]
    if A < n:
        return None
    tr = np.maximum(H[A - n + 1:A + 1], C[A - n:A]) - np.minimum(L[A - n + 1:A + 1], C[A - n:A])
    return float(tr.mean())


def _sma(x, A, n):
    if A + 1 < n:
        return None
    return float(x[A - n + 1:A + 1].mean())


def tier_feats(b, A):
    """Reference anchors + the tier measures on b[:A+1]; None when no cup window exists."""
    b = b[:A + 1]
    w = _best_window(b, A)
    if w is None:
        return None
    H, Lo, C = b[:, 2], b[:, 3], b[:, 4]
    L, m, R = w['L'], w['m'], w['R']
    f = dict(w['f'])
    f.pop('path', None)
    out = {'C': w['C'], 'E': w['E'], 'S': w['S'], 'fails': w['fails'], 'L': L, 'm': m, 'R': R, 'A': A}
    out.update(f)
    a = _atr(b, A)
    out['atr'] = a
    lip = float(H[L])
    z0, z1 = max(0, L - 3), min(A, L + 3)
    rim_c = float(C[z0:z1 + 1].max())
    out['rim_close'] = rim_c
    out['lip_wick_atr'] = (lip - max(rim_c, float(max(b[L, 1], b[L, 4])))) / a if a else None
    h250 = float(H[max(0, A - 249):A + 1].max())
    out['lip_hi250'] = lip / h250
    s200, s200p = _sma(C, A, 200), _sma(C, A - 20, 200)
    out['s200_slope'] = (s200 / s200p - 1.0) if (s200 and s200p) else None
    out['rs_vs_rimc'] = float(C[L + 1:R + 1].max()) / rim_c - 1.0 if R > L else None
    out['cup_bars'] = R - L
    out['hi300'] = float(H[L]) / float(H[max(0, A - HI300_BARS + 1):A + 1].max())
    return out


GATES = (
    ('lip_hi250', 0.97, None), ('s200_slope', 1e-12, None), ('prior', 0.30, None),
    ('depth', 0.12, 0.50), ('cup_bars', 35, None), ('hump', None, 0.40), ('lip_wick_atr', None, 0.75),
    ('rs_vs_rimc', -0.05, 0.015), ('over', None, 0.0), ('h_bars', 3, None), ('h_depth', None, 0.10),
    ('h_pos', None, 0.50),
)
MAX_BACK = 240
HUMP_MAX = 0.25
HI300_MIN = 0.90
HI300_BARS = 300


def gate_fails(f) -> list:
    out = []
    for k, lo, hi in GATES:
        v = f.get(k)
        if v is None or (lo is not None and v < lo) or (hi is not None and v > hi):
            out.append(k)
    if f['A'] - f['L'] > MAX_BACK:
        out.append('max_back')
    if f.get('hump') is None or f['hump'] > HUMP_MAX:
        out.append('hump25')
    if f.get('hi300') is None or f['hi300'] < HI300_MIN:
        out.append('hi300')
    if f['C'] < T:
        out.append('C')
    return out


# ---------------------------------------------------------------- drawing v4 (lab cup_draw_v4 cd4_draw)
EPS_ATR = 0.12
SPIKE_ATR = 1.2
SPIKE_BARS = 3
LIP_ZONE = 3
ABOVE_ATR = 0.25
HDEP_MAX = 0.35
FLOOR_MIN = 0.5
PSHORT_MAX = 1.15


def measures(b, A, f) -> dict:
    """The drawing's measures on the tier's anchors (b[:A+1] only)."""
    b = b[:A + 1]
    H, Lo, C = b[:, 2], b[:, 3], b[:, 4]
    L, m, R = int(f['L']), int(f['m']), int(f['R'])
    at = float(f['atr'])
    rim = float(f['rim_close'])
    z0, z1 = max(0, L - LIP_ZONE), min(A, L + LIP_ZONE)
    jr = z0 + int(np.argmax(C[z0:z1 + 1]))
    nb = [j for j in range(max(0, jr - SPIKE_BARS), min(A, jr + SPIKE_BARS) + 1) if j != jr]
    spike = (rim - float(C[nb].max())) / at
    short = (rim - float(H[m + 1:A + 1].max())) / at
    top = min(float(H[R:A + 1].max()), rim)
    pivot = top if short > EPS_ATR else rim
    floor = float(Lo[R + 1:A + 1].min()) if A > R else top
    cl = float(Lo[m])
    depth = rim - cl
    return {'short_atr': short, 'spike_atr': spike, 'pivot': pivot, 'rim': rim, 'top': top, 'floor': floor,
            'above_atr': (float(C[R:A + 1].max()) - pivot) / at,
            'hdep': (top - floor) / depth if depth > 0 else 9.0,
            'hfloor': (floor - cl) / depth if depth > 0 else -9.0,
            'pshort_atr': (rim - pivot) / at}


def drawing(b, A, f) -> dict:
    """The v4 member drawing on the tier's anchors (b[:A+1] only)."""
    b = b[:A + 1]
    Ts = b[:, 0]
    L, R = int(f['L']), int(f['R'])
    ms = measures(b, A, f)
    meas = {k: round(float(ms[k]), 4) for k in ('short_atr', 'spike_atr', 'above_atr', 'hdep', 'hfloor',
                                                 'pshort_atr')}
    why = None
    if ms['spike_atr'] > SPIKE_ATR:
        why = 'spike_lip'
    elif ms['hfloor'] < FLOOR_MIN:
        why = 'handle_low'
    elif ms['hdep'] > HDEP_MAX:
        why = 'handle_deep'
    elif ms['pshort_atr'] > PSHORT_MAX:
        why = 'pivot_short'
    elif ms['above_atr'] > ABOVE_ATR:
        why = 'above_pivot'
    if why:
        return {'v': DRAW_ROUND, 'withheld': why, 'm': meas}
    rim = ms['rim']
    handle = {'start_t': int(Ts[R]), 'end_t': int(Ts[A]), 'top': round(ms['top'], 4), 'floor': round(ms['floor'], 4)}
    rim_line = {'start_t': int(Ts[L]), 'end_t': int(Ts[A]), 'price': round(rim, 4)}
    if ms['short_atr'] > EPS_ATR:
        return {'v': DRAW_ROUND, 'withheld': None, 'pivot_at': 'handle_high', 'm': meas,
                'pivot': {'start_t': int(Ts[R]), 'end_t': int(Ts[A]), 'price': round(ms['pivot'], 4)},
                'rim_ref': rim_line, 'handle': handle}
    return {'v': DRAW_ROUND, 'withheld': None, 'pivot_at': 'rim', 'm': meas, 'pivot': rim_line, 'rim_ref': None,
            'handle': handle}


# ---------------------------------------------------------------- the stamp
def as_array(bars: list) -> np.ndarray:
    return np.array([[float(x['t']), float(x['o']), float(x['h']), float(x['l']), float(x['c']),
                      float(x.get('v') or 0)] for x in bars], dtype=float)


def stamp(bars: list) -> dict | None:
    """The tier stamp for the LAST bar of `bars` (oldest first, {t,o,h,l,c,v} dicts), or None when the tier does not
    hold (including when the live cup detector does not fire on the 400-bar working window)."""
    if not bars or len(bars) < 221:
        return None
    from api.services.pattern_engine.primitives import cup as _cup
    if _cup.cup_with_handle_state(list(bars[-WORKING_BARS:])) is None:
        return None
    b = as_array(bars)
    A = len(b) - 1
    f = tier_feats(b, A)
    if f is None or gate_fails(f):
        return None
    d = drawing(b, A, f)
    out = {'tier': TIER_NAME, 'v': TIER_VERSION, 't': T, 'C': round(float(f['C']), 4),
           'lip_t': int(b[f['L'], 0]), 'low_t': int(b[f['m'], 0]), 'right_t': int(b[f['R'], 0]),
           'asof_t': int(b[A, 0]), 'atr': round(float(f['atr']), 4), 'draw_round': DRAW_ROUND,
           'withheld': d['withheld'], 'm': d['m']}
    if not d['withheld']:
        out.update({'pivot_at': d['pivot_at'], 'pivot': d['pivot'], 'rim_ref': d['rim_ref'], 'handle': d['handle']})
    return out
