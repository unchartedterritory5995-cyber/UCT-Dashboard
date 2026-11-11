# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
from dataclasses import dataclass, field
from typing import Callable, Optional
BODY_AVG_N = 15
RANGE_AVG_N = 20
ATR_N = 14
LONG_BODY_MULT = 1.5
SHORT_BODY_MULT = 0.5
DOJI_BODY = 0.1
NEAR_ZERO_WICK = 0.1
DRAGONFLY_BODY = 0.01
MARUBOZU_BODY = 0.9
SPINNING_BODY = 0.3
HIGH_WAVE_SHADOW_MULT = 3.0
EXTREME_LOOK = 10
EXTREME_BAND_ATR = 0.25
SMALL_SECOND_BODY = 0.5
MOVE_LOOK = 10
MOVE_ATR = 2.0
THRUST_MIN_DEPTH = 0.25
TREND_CONTEXT_KEYS = frozenset({'harami-cross', 'tri-star', 'separating-lines'})
MIN_RANGE_TICKS = 4
MIN_RANGE_PCT = 0.005
MIN_HISTORY = 20
CANDLE_RULES_ROUND = 2

def tick_size(price: float) -> float:
    return 0.01 if (price or 0) >= 1 else 0.0001

@dataclass(frozen=True)
class Pattern:
    key: str
    label: str
    axis: str
    bars: int
    bias: str
    kind: str
    rank: int
    desc: str
    detect: Optional[Callable] = None
    subsumes: tuple = field(default_factory=tuple)
    trend: Optional[str] = None

@dataclass(frozen=True)
class BarCtx:
    bars: list
    o: float
    h: float
    l: float
    c: float
    v: float
    rng: float
    body: float
    upper: float
    lower: float
    body_pct: float
    upper_pct: float
    lower_pct: float
    close_pos: float
    avg_body: float
    avg_range: float
    atr: float
    tick: float
    avg_range5: float
    noise: bool
    trend: str
    up: bool

    @property
    def long_body(self) -> bool:
        return bool(self.avg_body) and self.body > LONG_BODY_MULT * self.avg_body

    @property
    def short_body(self) -> bool:
        return bool(self.avg_body) and self.body < SHORT_BODY_MULT * self.avg_body

def classify_shape(x: BarCtx) -> str:
    if x.noise:
        return _plain(x)
    if x.body_pct <= DRAGONFLY_BODY:
        if x.upper_pct <= NEAR_ZERO_WICK and x.lower_pct >= 0.6:
            return 'dragonfly-doji'
        if x.lower_pct <= NEAR_ZERO_WICK and x.upper_pct >= 0.6:
            return 'gravestone-doji'
    if x.lower_pct >= 2 * x.body_pct and x.upper_pct <= NEAR_ZERO_WICK:
        if x.trend == 'down' and _at_extreme(x, 1, True) and _move_ok(x, 1, 'down'):
            return 'hammer'
        if x.trend == 'up' and _at_extreme(x, 1, False) and _move_ok(x, 1, 'up'):
            return 'hanging-man'
        return 'umbrella'
    if x.upper_pct >= 2 * x.body_pct and x.lower_pct <= NEAR_ZERO_WICK:
        if x.trend == 'down' and _at_extreme(x, 1, True) and _move_ok(x, 1, 'down'):
            return 'inverted-hammer'
        if x.trend == 'up' and _at_extreme(x, 1, False) and _move_ok(x, 1, 'up'):
            return 'shooting-star'
        return 'inverted-umbrella'
    if x.body_pct <= DOJI_BODY:
        if x.upper_pct >= 0.25 and x.lower_pct >= 0.25:
            return 'long-legged-doji'
        return 'doji'
    if x.body_pct >= MARUBOZU_BODY and x.long_body:
        return 'white-marubozu' if x.up else 'black-marubozu'
    if x.long_body:
        if x.up and x.lower_pct <= 0.02 and (x.trend == 'down') and _at_extreme(x, 1, True) and _move_ok(x, 1, 'down'):
            return 'bullish-belt-hold'
        if not x.up and x.upper_pct <= 0.02 and (x.trend == 'up') and _at_extreme(x, 1, False) and _move_ok(x, 1, 'up'):
            return 'bearish-belt-hold'
    if x.body_pct < SPINNING_BODY:
        long_range = bool(x.avg_range) and x.rng > 1.5 * x.avg_range
        if x.upper_pct + x.lower_pct >= HIGH_WAVE_SHADOW_MULT * x.body_pct and long_range:
            return 'high-wave'
        return 'spinning-top'
    return _plain(x)

def _plain(x: BarCtx) -> str:
    if x.long_body:
        return 'long-white' if x.up else 'long-black'
    if x.short_body:
        return 'short-white' if x.up else 'short-black'
    return 'white-candle' if x.up else 'black-candle'

def _at_extreme(ctx, n, bullish) -> bool:
    bs = ctx.bars
    if len(bs) < n + EXTREME_LOOK:
        return False
    pat, prior = (bs[-n:], bs[-n - EXTREME_LOOK:-n])
    band = EXTREME_BAND_ATR * ctx.atr
    if bullish:
        return min((x['l'] for x in pat)) <= min((x['l'] for x in prior)) + band
    return max((x['h'] for x in pat)) >= max((x['h'] for x in prior)) - band

def _move_ok(ctx, n, trend) -> bool:
    bs = ctx.bars
    if trend not in ('up', 'down') or len(bs) < n + 1 + MOVE_LOOK or (not ctx.atr):
        return False
    d = bs[-n - 1]['c'] - bs[-n - 1 - MOVE_LOOK]['c']
    return d >= MOVE_ATR * ctx.atr if trend == 'up' else d <= -MOVE_ATR * ctx.atr

def context_ok(p, ctx) -> bool:
    if p.trend is not None:
        if not _move_ok(ctx, p.bars, p.trend):
            return False
    elif p.key in TREND_CONTEXT_KEYS:
        if not _move_ok(ctx, p.bars, ctx.trend):
            return False
    if p.kind != 'reversal' or p.bias not in ('bullish', 'bearish') or p.trend is None:
        return True
    return _at_extreme(ctx, p.bars, p.bias == 'bullish')

def _long(ctx, x) -> bool:
    return bool(ctx.avg_body) and _b(x) >= ctx.avg_body

def _b(x):
    return abs(x['c'] - x['o'])

def _r(x):
    return x['h'] - x['l']

def _up(x):
    return x['c'] >= x['o']

def _hi(x):
    return max(x['o'], x['c'])

def _lo(x):
    return min(x['o'], x['c'])

def _mid(x):
    return (x['o'] + x['c']) / 2.0

def _eq(ctx, a, b) -> bool:
    return abs(a - b) <= max(0.05 * ctx.atr, ctx.tick)

def _prev(ctx, n=1):
    i = -1 - n
    return ctx.bars[i] if len(ctx.bars) >= n + 1 else None

def _nontrivial(ctx, x) -> bool:
    return _b(x) > max(0.1 * ctx.avg_body, ctx.tick)

def _engulf(ctx, bullish: bool):
    p = _prev(ctx)
    if p is None or not _nontrivial(ctx, p):
        return False
    cur = ctx.bars[-1]
    if _up(cur) != bullish or _up(p) == bullish:
        return False
    lo, hi = (_lo(p), _hi(p))
    if bullish:
        return cur['o'] <= lo and cur['c'] >= hi and (cur['o'] < lo or cur['c'] > hi)
    return cur['o'] >= hi and cur['c'] <= lo and (cur['o'] > hi or cur['c'] < lo)

def d_bull_engulf(ctx):
    return _engulf(ctx, True) and ctx.trend == 'down'

def d_bear_engulf(ctx):
    return _engulf(ctx, False) and ctx.trend == 'up'

def d_last_eng_top(ctx):
    return _engulf(ctx, True) and ctx.trend == 'up'

def d_last_eng_bot(ctx):
    return _engulf(ctx, False) and ctx.trend == 'down'

def _harami(ctx, bullish: bool):
    p = _prev(ctx)
    if p is None or not _nontrivial(ctx, p):
        return False
    cur = ctx.bars[-1]
    if _up(p) == bullish:
        return False
    if _b(p) < ctx.avg_body:
        return False
    return _hi(cur) <= _hi(p) and _lo(cur) >= _lo(p) and (_b(cur) < _b(p)) and (_b(cur) <= SMALL_SECOND_BODY * _b(p))

def d_bull_harami(ctx):
    return _harami(ctx, True) and ctx.trend == 'down' and (not d_harami_cross(ctx))

def d_bear_harami(ctx):
    return _harami(ctx, False) and ctx.trend == 'up' and (not d_harami_cross(ctx))

def d_harami_cross(ctx):
    cur = ctx.bars[-1]
    if not (_r(cur) > 0 and _b(cur) / _r(cur) <= DOJI_BODY):
        return False
    return _harami(ctx, True) and ctx.trend == 'down' or (_harami(ctx, False) and ctx.trend == 'up')

def _pierce_depth(ctx):
    p = _prev(ctx)
    if p is None or _b(p) <= 0:
        return (None, None)
    return (p, (ctx.bars[-1]['c'] - _lo(p)) / _b(p) if not _up(p) else (_hi(p) - ctx.bars[-1]['c']) / _b(p))

def d_piercing(ctx):
    p, depth = _pierce_depth(ctx)
    cur = ctx.bars[-1]
    if p is None or _up(p) or (not _up(cur)) or (not _nontrivial(ctx, p)) or (not _long(ctx, p)):
        return False
    return ctx.trend == 'down' and cur['o'] < p['l'] and (depth > 0.5) and (cur['c'] < p['o'])

def d_dark_cloud(ctx):
    p, depth = _pierce_depth(ctx)
    cur = ctx.bars[-1]
    if p is None or not _up(p) or _up(cur) or (not _nontrivial(ctx, p)) or (not _long(ctx, p)):
        return False
    return ctx.trend == 'up' and cur['o'] > p['h'] and (depth > 0.5) and (cur['c'] > p['o'])

def d_thrusting(ctx):
    p, depth = _pierce_depth(ctx)
    cur = ctx.bars[-1]
    if p is None or _up(p) or (not _up(cur)) or (not _nontrivial(ctx, p)) or (not _long(ctx, p)):
        return False
    return ctx.trend == 'down' and cur['o'] < p['l'] and (THRUST_MIN_DEPTH <= depth <= 0.5)

def d_on_neck(ctx):
    p = _prev(ctx)
    cur = ctx.bars[-1]
    if p is None or _up(p) or (not _up(cur)) or (not _long(ctx, p)):
        return False
    return ctx.trend == 'down' and cur['o'] < p['l'] and _eq(ctx, cur['c'], p['l'])

def d_tweezer_top(ctx):
    p = _prev(ctx)
    if p is None:
        return False
    cur = ctx.bars[-1]
    return ctx.trend == 'up' and _eq(ctx, cur['h'], p['h']) and _up(p) and (not _up(cur))

def d_tweezer_bottom(ctx):
    p = _prev(ctx)
    if p is None:
        return False
    cur = ctx.bars[-1]
    return ctx.trend == 'down' and _eq(ctx, cur['l'], p['l']) and (not _up(p)) and _up(cur)

def _marubozu_like(ctx, x, bullish):
    r = _r(x)
    if r <= 0 or _b(x) / r < MARUBOZU_BODY or (not _long(ctx, x)):
        return False
    return _up(x) == bullish

def d_kicking_bull(ctx):
    p = _prev(ctx)
    if p is None:
        return False
    cur = ctx.bars[-1]
    return _marubozu_like(ctx, p, False) and _marubozu_like(ctx, cur, True) and (cur['l'] > p['h'])

def d_kicking_bear(ctx):
    p = _prev(ctx)
    if p is None:
        return False
    cur = ctx.bars[-1]
    return _marubozu_like(ctx, p, True) and _marubozu_like(ctx, cur, False) and (cur['h'] < p['l'])

def d_matching_low(ctx):
    p = _prev(ctx)
    cur = ctx.bars[-1]
    if p is None or _up(p) or _up(cur):
        return False
    return ctx.trend == 'down' and _eq(ctx, cur['c'], p['c'])

def d_homing_pigeon(ctx):
    p = _prev(ctx)
    cur = ctx.bars[-1]
    if p is None or _up(p) or _up(cur) or (not _nontrivial(ctx, p)):
        return False
    return ctx.trend == 'down' and _hi(cur) <= _hi(p) and (_lo(cur) >= _lo(p)) and (_b(cur) < _b(p)) and _long(ctx, p) and (_b(cur) <= SMALL_SECOND_BODY * _b(p))

def d_separating_lines(ctx):
    p = _prev(ctx)
    cur = ctx.bars[-1]
    if p is None:
        return False
    order_ok = ctx.trend == 'up' and (not _up(p)) and _up(cur) or (ctx.trend == 'down' and _up(p) and (not _up(cur)))
    return order_ok and _eq(ctx, cur['o'], p['o']) and (_b(cur) >= ctx.avg_body)

def _body_gap_up(ctx, a, b):
    return _lo(b) > _hi(a) + _band(ctx)

def _body_gap_dn(ctx, a, b):
    return _hi(b) < _lo(a) - _band(ctx)

def _shadow_gap_up(ctx, a, b):
    return b['l'] > a['h'] + _band(ctx)

def _shadow_gap_dn(ctx, a, b):
    return b['h'] < a['l'] - _band(ctx)

def _band(ctx):
    return max(0.05 * ctx.atr, ctx.tick)

def _star(ctx, bullish: bool, doji_star=None):
    b1, b2, b3 = (_prev(ctx, 2), _prev(ctx, 1), ctx.bars[-1])
    if b1 is None or b2 is None:
        return False
    if _b(b1) < ctx.avg_body or _up(b1) == bullish:
        return False
    if _b(b2) >= _b(b1) * 0.5:
        return False
    r2 = _r(b2)
    is_doji = r2 > 0 and _b(b2) / r2 <= DOJI_BODY
    if doji_star is not None and is_doji != doji_star:
        return False
    if _up(b3) != bullish:
        return False
    gap_ok = _body_gap_dn(ctx, b1, b2) if bullish else _body_gap_up(ctx, b1, b2)
    if not gap_ok:
        return False
    mid1 = _mid(b1)
    deep = b3['c'] > mid1 if bullish else b3['c'] < mid1
    return deep and ctx.trend == ('down' if bullish else 'up')

def d_morning_star(ctx):
    return _star(ctx, True, doji_star=False)

def d_evening_star(ctx):
    return _star(ctx, False, doji_star=False)

def _abandoned(ctx, bullish):
    b1, b2, b3 = (_prev(ctx, 2), _prev(ctx, 1), ctx.bars[-1])
    if b1 is None or b2 is None:
        return False
    if not _b(b2) <= max(DOJI_BODY * _r(b2), ctx.tick):
        return False
    if not _long(ctx, b1):
        return False
    if bullish:
        return _shadow_gap_dn(ctx, b1, b2) and _shadow_gap_up(ctx, b2, b3) and (not _up(b1)) and _up(b3) and (ctx.trend == 'down')
    return _shadow_gap_up(ctx, b1, b2) and _shadow_gap_dn(ctx, b2, b3) and _up(b1) and (not _up(b3)) and (ctx.trend == 'up')

def d_abandoned_baby_bull(ctx):
    return _abandoned(ctx, True)

def d_abandoned_baby_bear(ctx):
    return _abandoned(ctx, False)

def d_morning_doji_star(ctx):
    return _star(ctx, True, doji_star=True) and (not _abandoned(ctx, True))

def d_evening_doji_star(ctx):
    return _star(ctx, False, doji_star=True) and (not _abandoned(ctx, False))

def _three_run(ctx, bullish):
    b = [_prev(ctx, 2), _prev(ctx, 1), ctx.bars[-1]]
    if b[0] is None or b[1] is None:
        return None
    for x in b:
        if _up(x) != bullish or _b(x) < ctx.avg_body * 0.5 or _r(x) <= 0:
            return None
    for i in (1, 2):
        prv, cur = (b[i - 1], b[i])
        inside = _lo(prv) <= cur['o'] <= _hi(prv)
        advancing = cur['c'] > prv['c'] if bullish else cur['c'] < prv['c']
        if not (inside and advancing):
            return None
    return b

def d_identical_three_crows(ctx):
    b = _three_run(ctx, False)
    if b is None or ctx.trend != 'up' or (not all((_long(ctx, x) for x in b))):
        return False
    return _eq(ctx, b[1]['o'], b[0]['c']) and _eq(ctx, b[2]['o'], b[1]['c'])

def d_three_white_soldiers(ctx):
    b = _three_run(ctx, True)
    if b is None or ctx.trend != 'down' or (not all((_long(ctx, x) for x in b))):
        return False
    far = 0.6 * ctx.avg_range5
    for x in b:
        if x['h'] - x['c'] > 0.25 * _r(x):
            return False
    return not (_b(b[1]) < _b(b[0]) - far or _b(b[2]) < _b(b[1]) - far)

def d_three_black_crows(ctx):
    b = _three_run(ctx, False)
    if b is None or ctx.trend != 'up' or (not all((_long(ctx, x) for x in b))):
        return False
    for x in b:
        if x['c'] - x['l'] > 0.25 * _r(x):
            return False
    return not d_identical_three_crows(ctx)

def d_deliberation(ctx):
    b = _three_run(ctx, True)
    if b is None or ctx.trend != 'up':
        return False
    return _b(b[2]) < ctx.avg_body * SHORT_BODY_MULT

def d_advance_block(ctx):
    b = _three_run(ctx, True)
    if b is None or ctx.trend != 'up':
        return False
    far = 0.6 * ctx.avg_range5
    shrinking = _b(b[1]) < _b(b[0]) - far or _b(b[2]) < _b(b[1]) - far
    long_shadow = b[2]['h'] - b[2]['c'] > 0.25 * _r(b[2])
    return (shrinking or long_shadow) and (not d_deliberation(ctx))

def _inside_pair(ctx, bullish):
    a, b = (_prev(ctx, 2), _prev(ctx, 1))
    if a is None or b is None or _b(a) < ctx.avg_body or (_up(a) == bullish):
        return False
    return _hi(b) <= _hi(a) and _lo(b) >= _lo(a) and (_b(b) < _b(a)) and (_b(b) <= SMALL_SECOND_BODY * _b(a))

def _outside_pair(ctx, bullish):
    a, b = (_prev(ctx, 2), _prev(ctx, 1))
    if a is None or b is None or _b(a) <= 0 or (_up(a) == bullish) or (_up(b) != bullish):
        return False
    lo, hi = (_lo(a), _hi(a))
    if bullish:
        return b['o'] <= lo and b['c'] >= hi and (b['o'] < lo or b['c'] > hi)
    return b['o'] >= hi and b['c'] <= lo and (b['o'] > hi or b['c'] < lo)

def d_three_inside_up(ctx):
    return _inside_pair(ctx, True) and _up(ctx.bars[-1]) and (ctx.bars[-1]['c'] > _hi(_prev(ctx, 2))) and (ctx.trend == 'down')

def d_three_inside_down(ctx):
    return _inside_pair(ctx, False) and (not _up(ctx.bars[-1])) and (ctx.bars[-1]['c'] < _lo(_prev(ctx, 2))) and (ctx.trend == 'up')

def d_three_outside_up(ctx):
    return _outside_pair(ctx, True) and _up(ctx.bars[-1]) and (ctx.bars[-1]['c'] > _prev(ctx, 1)['c']) and (ctx.trend == 'down')

def d_three_outside_down(ctx):
    return _outside_pair(ctx, False) and (not _up(ctx.bars[-1])) and (ctx.bars[-1]['c'] < _prev(ctx, 1)['c']) and (ctx.trend == 'up')

def d_tri_star(ctx):
    bs = [_prev(ctx, 2), _prev(ctx, 1), ctx.bars[-1]]
    if bs[0] is None or bs[1] is None:
        return False
    for x in bs:
        r = _r(x)
        if not (r > 0 and _b(x) / r <= DOJI_BODY):
            return False
    if ctx.trend == 'up':
        return _body_gap_up(ctx, bs[0], bs[1]) and _body_gap_dn(ctx, bs[1], bs[2])
    if ctx.trend == 'down':
        return _body_gap_dn(ctx, bs[0], bs[1]) and _body_gap_up(ctx, bs[1], bs[2])
    return False

def d_stick_sandwich(ctx):
    b1, b2, b3 = (_prev(ctx, 2), _prev(ctx, 1), ctx.bars[-1])
    if b1 is None or b2 is None:
        return False
    return not _up(b1) and _up(b2) and (not _up(b3)) and _eq(ctx, b3['c'], b1['c']) and (ctx.trend == 'down')

def d_two_crows(ctx):
    b1, b2, b3 = (_prev(ctx, 2), _prev(ctx, 1), ctx.bars[-1])
    if b1 is None or b2 is None:
        return False
    return _up(b1) and _b(b1) >= ctx.avg_body and (not _up(b2)) and (not _up(b3)) and _body_gap_up(ctx, b1, b2) and (_lo(b2) <= b3['o'] <= _hi(b2)) and (_lo(b1) < b3['c'] < _hi(b1)) and (ctx.trend == 'up')

def _three_methods(ctx, bullish):
    if len(ctx.bars) < 5:
        return False
    b1, mids, b5 = (ctx.bars[-5], ctx.bars[-4:-1], ctx.bars[-1])
    if _up(b1) != bullish or _b(b1) < ctx.avg_body:
        return False
    for m in mids:
        if m['h'] > b1['h'] or m['l'] < b1['l'] or _b(m) > SMALL_SECOND_BODY * _b(b1):
            return False
    if _up(b5) != bullish or _b(b5) < ctx.avg_body * SHORT_BODY_MULT:
        return False
    if b5['o'] <= mids[-1]['c'] if bullish else b5['o'] >= mids[-1]['c']:
        return False
    return b5['c'] > b1['c'] if bullish else b5['c'] < b1['c']

def d_rising_three(ctx):
    return _three_methods(ctx, True) and ctx.trend == 'up'

def d_falling_three(ctx):
    return _three_methods(ctx, False) and ctx.trend == 'down'

def _tasuki(ctx, bullish):
    b1, b2, b3 = (_prev(ctx, 2), _prev(ctx, 1), ctx.bars[-1])
    if b1 is None or b2 is None:
        return False
    if _up(b1) != bullish or _up(b2) != bullish or _up(b3) == bullish:
        return False
    gap = _body_gap_up(ctx, b1, b2) if bullish else _body_gap_dn(ctx, b1, b2)
    if not gap:
        return False
    inside = _lo(b2) < b3['o'] < _hi(b2)
    holds = _hi(b1) < b3['c'] < _lo(b2) if bullish else _hi(b2) < b3['c'] < _lo(b1)
    return inside and holds

def d_upside_tasuki(ctx):
    return _tasuki(ctx, True) and ctx.trend == 'up'

def d_downside_tasuki(ctx):
    return _tasuki(ctx, False) and ctx.trend == 'down'

def _hikkake_setup(ctx, back=0):
    n = len(ctx.bars)
    j = n - 1 - back
    if j < 2:
        return 0
    b1, ins, brk = (ctx.bars[j - 2], ctx.bars[j - 1], ctx.bars[j])
    if not (ins['h'] < b1['h'] and ins['l'] > b1['l']):
        return 0
    if brk['h'] < ins['h'] and brk['l'] < ins['l']:
        return 1
    if brk['h'] > ins['h'] and brk['l'] > ins['l']:
        return -1
    return 0

def d_hikkake_bull(ctx):
    return _hikkake_setup(ctx) == 1

def d_hikkake_bear(ctx):
    return _hikkake_setup(ctx) == -1

def _hikkake_confirmed(ctx, bullish):
    if _hikkake_setup(ctx):
        return False
    n, c = (len(ctx.bars), ctx.bars[-1]['c'])
    for back in (1, 2, 3):
        sig = _hikkake_setup(ctx, back)
        if not sig:
            continue
        ins = ctx.bars[n - 2 - back]
        if bullish and sig == 1 and (c > ins['h']):
            return True
        if not bullish and sig == -1 and (c < ins['l']):
            return True
    return False

def d_hikkake_bull_confirmed(ctx):
    return _hikkake_confirmed(ctx, True)

def d_hikkake_bear_confirmed(ctx):
    return _hikkake_confirmed(ctx, False)
SHAPES = [Pattern('hammer', 'Hammer', 'shape', 1, 'bullish', 'reversal', 200, trend='down', desc='A long lower wick after a decline: sellers pushed it down hard and buyers took the whole move back before the close. The same shape after an ADVANCE is a hanging man, not a hammer — the prior trend is what separates them.'), Pattern('hanging-man', 'Hanging Man', 'shape', 1, 'bearish', 'reversal', 201, trend='up', desc="A hammer's shape, printed after an advance instead of a decline. Sellers were able to press it well below the open mid-session, which is unwelcome news inside an uptrend."), Pattern('shooting-star', 'Shooting Star', 'shape', 1, 'bearish', 'reversal', 202, trend='up', desc='A long upper wick after an advance: buyers pushed to a new high and gave the entire gain back by the close. The identical shape after a DECLINE is an inverted hammer.'), Pattern('inverted-hammer', 'Inverted Hammer', 'shape', 1, 'bullish', 'reversal', 203, trend='down', desc="A shooting star's shape printed after a decline. Buyers finally managed a real push off the lows, even though they could not hold it into the close."), Pattern('umbrella', 'Umbrella', 'shape', 1, 'neutral', 'indecision', 210, desc='Long lower wick, small body near the high — the hammer/hanging-man geometry with no clear prior trend to name it. We print the shape rather than guess a direction the chart does not support.'), Pattern('inverted-umbrella', 'Inverted Umbrella', 'shape', 1, 'neutral', 'indecision', 211, desc='Long upper wick, small body near the low, with no clear prior trend. The shooting-star/inverted-hammer geometry, left unnamed because the trend that would name it is not there.'), Pattern('bullish-belt-hold', 'Bullish Belt Hold', 'shape', 1, 'bullish', 'reversal', 220, trend='down', desc='Opened at its low and ran all session. A long body with no lower wick after a decline — sellers never got a single tick.'), Pattern('bearish-belt-hold', 'Bearish Belt Hold', 'shape', 1, 'bearish', 'reversal', 221, trend='up', desc='Opened at its high and fell all session. A long body with no upper wick after an advance.'), Pattern('white-marubozu', 'White Marubozu', 'shape', 1, 'bullish', 'continuation', 250, desc='Body is at least 90% of the whole range — it opened near the low, closed near the high, and barely looked back. The cleanest one-bar statement of buying conviction.'), Pattern('black-marubozu', 'Black Marubozu', 'shape', 1, 'bearish', 'continuation', 251, desc='Body is at least 90% of the whole range, opening near the high and closing near the low. Selling with no meaningful pushback.'), Pattern('dragonfly-doji', 'Dragonfly Doji', 'shape', 1, 'bullish', 'reversal', 300, desc='Open and close together at the top, with a long tail below. The session sold off and every bit of it was bought back.'), Pattern('gravestone-doji', 'Gravestone Doji', 'shape', 1, 'bearish', 'reversal', 301, desc='Open and close together at the bottom, with a long spike above. The rally happened and then went entirely unpaid.'), Pattern('long-legged-doji', 'Long-Legged Doji', 'shape', 1, 'neutral', 'indecision', 302, desc='Open and close nearly level, with meaningful wicks BOTH ways. A wide, genuinely two-sided argument that settled where it began.'), Pattern('doji', 'Doji', 'shape', 1, 'neutral', 'indecision', 303, desc='Open and close within 10% of the range of each other — the session travelled and finished where it started. Indecision, not direction.'), Pattern('high-wave', 'High Wave', 'shape', 1, 'neutral', 'indecision', 340, desc='A small body with wicks at least 3x its size on a range well above normal. Not a quiet day — a violent argument that resolved nothing.'), Pattern('spinning-top', 'Spinning Top', 'shape', 1, 'neutral', 'indecision', 350, desc='A small body with wicks on both sides. Neither side finished the session in control, on an unremarkable range.'), Pattern('long-white', 'Long White', 'shape', 1, 'bullish', 'plain', 400, desc="An ordinary up bar, but with a body more than 1.5x the recent average — a decisive session with no special shape to it. Size is measured against this stock's own last 15 bodies, so it means the same thing on a $3 stock and a $900 one."), Pattern('long-black', 'Long Black', 'shape', 1, 'bearish', 'plain', 401, desc='An ordinary down bar with a body more than 1.5x the recent average — decisive selling, no distinctive shape.'), Pattern('white-candle', 'White Candle', 'shape', 1, 'bullish', 'plain', 410, desc="A normal up bar: closed above its open, body in line with this stock's recent average, nothing structurally notable."), Pattern('black-candle', 'Black Candle', 'shape', 1, 'bearish', 'plain', 411, desc='A normal down bar: closed below its open, body in line with the recent average, nothing structurally notable.'), Pattern('short-white', 'Short White', 'shape', 1, 'bullish', 'plain', 420, desc='An up bar with a body under half the recent average — a quiet session that happened to close green.'), Pattern('short-black', 'Short Black', 'shape', 1, 'bearish', 'plain', 421, desc='A down bar with a body under half the recent average — a quiet session that happened to close red.')]
RELATIONS = [Pattern('rising-three-methods', 'Rising Three Methods', 'relation', 5, 'bullish', 'continuation', 20, detect=d_rising_three, trend='up', desc='A long up bar, then three small bars that rest entirely INSIDE its range, then another up bar closing above the first. A tight pause inside an uptrend that resolved the way it was leaning.'), Pattern('falling-three-methods', 'Falling Three Methods', 'relation', 5, 'bearish', 'continuation', 21, detect=d_falling_three, trend='down', desc='A long down bar, three small bars fully inside its range, then a down bar closing below the first. A pause in a downtrend that resolved lower.'), Pattern('abandoned-baby-bullish', 'Abandoned Baby (Bull)', 'relation', 3, 'bullish', 'reversal', 10, detect=d_abandoned_baby_bull, trend='down', desc='A doji stranded below everything around it — its entire range, wicks included, gaps clear of both neighbours. Genuinely rare: expect zero or one across the whole market on a given day.'), Pattern('abandoned-baby-bearish', 'Abandoned Baby (Bear)', 'relation', 3, 'bearish', 'reversal', 11, detect=d_abandoned_baby_bear, trend='up', desc='A doji stranded above its neighbours with clear air on both sides, wicks included. The bearish mirror, and just as rare.'), Pattern('morning-doji-star', 'Morning Doji Star', 'relation', 3, 'bullish', 'reversal', 13, detect=d_morning_doji_star, trend='down', desc='A morning star whose middle bar is a true doji — the pause was total indecision rather than a small push.'), Pattern('evening-doji-star', 'Evening Doji Star', 'relation', 3, 'bearish', 'reversal', 14, detect=d_evening_doji_star, trend='up', desc='An evening star whose middle bar is a true doji.'), Pattern('morning-star', 'Morning Star', 'relation', 3, 'bullish', 'reversal', 15, detect=d_morning_star, trend='down', desc='A long down bar, a small body gapping below it, then an up bar closing back above the midpoint of that first body. Selling, a stall, then buyers taking back more than half the damage.'), Pattern('evening-star', 'Evening Star', 'relation', 3, 'bearish', 'reversal', 16, detect=d_evening_star, trend='up', desc='A long up bar, a small body gapping above it, then a down bar closing back below the midpoint of that first body.'), Pattern('three-black-crows', 'Three Black Crows', 'relation', 3, 'bearish', 'reversal', 17, detect=d_three_black_crows, trend='up', desc='Three straight down bars, each opening inside the last body and each closing near its low. Steady, orderly selling after an advance.'), Pattern('three-white-soldiers', 'Three White Soldiers', 'relation', 3, 'bullish', 'reversal', 18, detect=d_three_white_soldiers, trend='down', desc='Three straight up bars, each opening inside the last body and closing near its high, with no body shrinking away. Orderly accumulation rather than one panicked gap.'), Pattern('identical-three-crows', 'Identical Three Crows', 'relation', 3, 'bearish', 'reversal', 19, detect=d_identical_three_crows, trend='up', desc='Three black crows where each bar opens right at the prior close — no overnight relief at all between them.'), Pattern('three-outside-up', 'Three Outside Up', 'relation', 3, 'bullish', 'reversal', 22, detect=d_three_outside_up, trend='down', desc='An engulfing two bars back, now confirmed by a higher close. The confirmation is what separates this from a bare engulfing.'), Pattern('three-outside-down', 'Three Outside Down', 'relation', 3, 'bearish', 'reversal', 23, detect=d_three_outside_down, trend='up', desc='A bearish engulfing two bars back, confirmed by a lower close.'), Pattern('three-inside-up', 'Three Inside Up', 'relation', 3, 'bullish', 'reversal', 24, detect=d_three_inside_up, trend='down', desc="A bullish harami two bars back, now confirmed by a close above the mother bar's body."), Pattern('three-inside-down', 'Three Inside Down', 'relation', 3, 'bearish', 'reversal', 25, detect=d_three_inside_down, trend='up', desc="A bearish harami two bars back, confirmed by a close below the mother bar's body."), Pattern('tri-star', 'Tri-Star', 'relation', 3, 'neutral', 'reversal', 26, detect=d_tri_star, desc='Three dojis in a row. Three consecutive sessions that could not settle on a direction.'), Pattern('two-crows', 'Two Crows', 'relation', 3, 'bearish', 'reversal', 27, detect=d_two_crows, trend='up', desc='A long up bar, a down bar gapping above it, then a second down bar eating back into the first. The gap was given away.'), Pattern('upside-tasuki-gap', 'Upside Tasuki Gap', 'relation', 3, 'bullish', 'continuation', 28, detect=d_upside_tasuki, trend='up', desc='Two up bars with a gap between their bodies, then a down bar that opens inside the second and fails to close the gap. The gap held.'), Pattern('downside-tasuki-gap', 'Downside Tasuki Gap', 'relation', 3, 'bearish', 'continuation', 29, detect=d_downside_tasuki, trend='down', desc='Two down bars gapped apart, then an up bar that opens inside the second and cannot close the gap.'), Pattern('stick-sandwich', 'Stick Sandwich', 'relation', 3, 'bullish', 'reversal', 30, detect=d_stick_sandwich, trend='down', desc='Two down closes at effectively the same price with an up bar between them — the same level got defended twice.'), Pattern('advance-block', 'Advance Block', 'relation', 3, 'bearish', 'reversal', 31, detect=d_advance_block, trend='up', desc='Three up bars whose progress is visibly tiring — bodies shrinking or upper wicks lengthening. The advance is still up, but working noticeably harder for it.'), Pattern('deliberation', 'Deliberation', 'relation', 3, 'bearish', 'reversal', 32, detect=d_deliberation, trend='up', desc='Three up bars where the third body goes short against the recent average — the push ran out on the last one.'), Pattern('hikkake-bull-confirmed', 'Hikkake Confirmed (Bull)', 'relation', 6, 'bullish', 'reversal', 33, detect=d_hikkake_bull_confirmed, desc="A downside break out of an inside bar that trapped sellers, and the close has now taken back the inside bar's HIGH. The trap has sprung."), Pattern('hikkake-bear-confirmed', 'Hikkake Confirmed (Bear)', 'relation', 6, 'bearish', 'reversal', 34, detect=d_hikkake_bear_confirmed, desc="An upside break out of an inside bar that trapped buyers, and the close has now taken out the inside bar's LOW."), Pattern('hikkake-bull', 'Hikkake (Bull)', 'relation', 3, 'bullish', 'reversal', 35, detect=d_hikkake_bull, desc="An inside bar, then a session breaking DOWN out of it — a lower high and a lower low. Counter-intuitively that is the BULLISH form: the downside break is the trap, and it is confirmed if the close retakes the inside bar's high within three sessions. Needs no prior trend, which is rare here."), Pattern('hikkake-bear', 'Hikkake (Bear)', 'relation', 3, 'bearish', 'reversal', 36, detect=d_hikkake_bear, desc="An inside bar, then a session breaking UP out of it — a higher high and a higher low. The upside break is the trap; it is confirmed if the close loses the inside bar's low within three sessions."), Pattern('kicking-bullish', 'Kicking (Bull)', 'relation', 2, 'bullish', 'reversal', 40, detect=d_kicking_bull, desc='A black marubozu, then a white marubozu gapping clear above it — no overlap at all, wicks included. A complete overnight reversal of opinion.'), Pattern('kicking-bearish', 'Kicking (Bear)', 'relation', 2, 'bearish', 'reversal', 41, detect=d_kicking_bear, desc='A white marubozu, then a black marubozu gapping clear below it with no overlap.'), Pattern('bullish-engulfing', 'Bullish Engulfing', 'relation', 2, 'bullish', 'reversal', 45, detect=d_bull_engulf, trend='down', desc='An up bar whose body completely covers the prior down body, printed in a downtrend. The same geometry in an UPTREND is a last engulfing top, which behaves very differently.'), Pattern('bearish-engulfing', 'Bearish Engulfing', 'relation', 2, 'bearish', 'reversal', 46, detect=d_bear_engulf, trend='up', desc='A down bar whose body completely covers the prior up body, printed in an uptrend.'), Pattern('last-engulfing-top', 'Last Engulfing Top', 'relation', 2, 'bearish', 'reversal', 47, detect=d_last_eng_top, trend='up', desc="A bullish engulfing's exact geometry, but printed after an ADVANCE rather than a decline. Same shape, different situation entirely — which is why the trend is part of the definition here."), Pattern('last-engulfing-bottom', 'Last Engulfing Bottom', 'relation', 2, 'bullish', 'reversal', 48, detect=d_last_eng_bot, trend='down', desc="A bearish engulfing's geometry printed after a DECLINE instead of an advance."), Pattern('dark-cloud-cover', 'Dark Cloud Cover', 'relation', 2, 'bearish', 'reversal', 50, detect=d_dark_cloud, trend='up', desc='Opens above the prior HIGH, then closes back below the midpoint of that up body. A gap up that was sold all day.'), Pattern('piercing-line', 'Piercing Line', 'relation', 2, 'bullish', 'reversal', 51, detect=d_piercing, trend='down', desc='Opens below the prior LOW, then closes back above the midpoint of that down body. A gap down that was bought all day. Closing at or under the midpoint instead makes it a thrusting line.'), Pattern('harami-cross', 'Harami Cross', 'relation', 2, 'neutral', 'reversal', 52, detect=d_harami_cross, desc='A harami whose inside bar is a doji — the pause after a long bar was complete indecision.'), Pattern('bullish-harami', 'Bullish Harami', 'relation', 2, 'bullish', 'reversal', 53, detect=d_bull_harami, trend='down', desc='A long down bar, then a small body sitting entirely inside it. The selling did not follow through.'), Pattern('bearish-harami', 'Bearish Harami', 'relation', 2, 'bearish', 'reversal', 54, detect=d_bear_harami, trend='up', desc='A long up bar, then a small body entirely inside it. The buying did not follow through.'), Pattern('tweezer-top', 'Tweezer Top', 'relation', 2, 'bearish', 'reversal', 55, detect=d_tweezer_top, trend='up', desc='Two sessions rejected at effectively the same high. Equality is measured with a band floored at one tick, never exact ticks.'), Pattern('tweezer-bottom', 'Tweezer Bottom', 'relation', 2, 'bullish', 'reversal', 56, detect=d_tweezer_bottom, trend='down', desc='Two sessions that found support at effectively the same low.'), Pattern('thrusting', 'Thrusting Line', 'relation', 2, 'bearish', 'continuation', 57, detect=d_thrusting, trend='down', desc='Opens below the prior low and closes back INTO that body, but only to its midpoint or less. A piercing line that fell short — the exact-halfway case belongs here, not to piercing.'), Pattern('on-neck', 'On-Neck Line', 'relation', 2, 'bearish', 'continuation', 58, detect=d_on_neck, trend='down', desc='Opens below the prior low and closes right back at that low — the bounce reached exactly the old floor and stopped.'), Pattern('matching-low', 'Matching Low', 'relation', 2, 'bullish', 'reversal', 59, detect=d_matching_low, trend='down', desc='Two down bars closing at effectively the same price. A floor that has now been tested twice on a closing basis.'), Pattern('homing-pigeon', 'Homing Pigeon', 'relation', 2, 'bullish', 'reversal', 60, detect=d_homing_pigeon, trend='down', desc='Two down bars where the second sits entirely inside the first — a bullish harami built from two red bars.'), Pattern('separating-lines', 'Separating Lines', 'relation', 2, 'neutral', 'continuation', 61, detect=d_separating_lines, desc='Two opposite-coloured bars opening at the same price — the second session restarted from where the first began.')]
LEGACY_ALIASES = {'white-marubozu': 'marubozu', 'black-marubozu': 'marubozu'}
ALL_PATTERNS = SHAPES + RELATIONS
BY_KEY = {p.key: p for p in ALL_PATTERNS}
SHAPE_KEYS = {p.key for p in SHAPES}
RELATION_KEYS = {p.key for p in RELATIONS}
assert len(BY_KEY) == len(ALL_PATTERNS), 'duplicate pattern key in the registry'

def label_for(key: str) -> str:
    p = BY_KEY.get(key)
    return p.label if p else key
MATCH_SEP = ','

def encode_matches(keys) -> str:
    return MATCH_SEP + MATCH_SEP.join(keys) + MATCH_SEP

def match_value(key: str) -> str:
    return MATCH_SEP + key + MATCH_SEP

def decode_matches(blob: str) -> list:
    return [k for k in (blob or '').split(MATCH_SEP) if k]

def enum_options() -> list:
    out = [{'label': 'Any'}]
    for p in sorted(ALL_PATTERNS, key=lambda q: (q.axis != 'relation', q.rank)):
        out.append({'label': p.label, 'op': 'contains', 'value': match_value(p.key)})
    return out
