# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
import datetime as _datetime
from . import candle_catalog as cat
_DAY = _datetime.timedelta(days=1)

def _atr(bars, n=14):
    if len(bars) < 2:
        return 0.0
    trs = []
    for i in range(1, len(bars)):
        h, l, pc = (bars[i]['h'], bars[i]['l'], bars[i - 1]['c'])
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    window = trs[-n:] if len(trs) >= n else trs
    return sum(window) / len(window) if window else 0.0

def _ema(values, n):
    if not values:
        return []
    k = 2.0 / (n + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out

def _trend(bars, first_i, atr):
    n = len(bars)
    first = n + first_i if first_i < 0 else first_i
    anchor = first - 1
    if anchor < 40:
        return 'unknown'
    closes = [b['c'] for b in bars[:anchor + 1]]
    ema = _ema(closes, 10)
    if len(ema) < 4:
        return 'unknown'
    now, back3 = (ema[-1], ema[-4])
    b1 = bars[first]
    mid = (b1['o'] + b1['c']) / 2.0
    dead = 0.25 * atr
    if mid > now + dead and now > back3:
        return 'up'
    if mid < now - dead and now < back3:
        return 'down'
    return 'neutral'
_NO_SHAPE = {'candle_type': 'none', 'candle_label': None, 'candle_matches': None, 'candle_trend': None, 'avg_body': None, 'avg_range': None, 'body_pct': None, 'upper_wick_pct': None, 'lower_wick_pct': None, 'close_position': None, 'wide_bar': False, 'narrow_bar': False}

def _build_ctx(bars, pattern_bars, atr, wide, narrow):
    b = bars[-1]
    o, h, l, c = (b['o'], b['h'], b['l'], b['c'])
    rng = h - l
    body, upper, lower = (abs(c - o), h - max(o, c), min(o, c) - l)
    hist = bars[:-1]
    bodies = [abs(x['c'] - x['o']) for x in hist[-cat.BODY_AVG_N:]]
    ranges = [x['h'] - x['l'] for x in hist[-cat.RANGE_AVG_N:]]
    r5 = [x['h'] - x['l'] for x in hist[-5:]]
    tick = cat.tick_size(c)
    return cat.BarCtx(bars=bars, o=o, h=h, l=l, c=c, v=b.get('v') or 0, rng=rng, body=body, upper=upper, lower=lower, body_pct=body / rng, upper_pct=upper / rng, lower_pct=lower / rng, close_pos=(c - l) / rng, avg_body=sum(bodies) / len(bodies) if bodies else 0.0, avg_range=sum(ranges) / len(ranges) if ranges else 0.0, avg_range5=sum(r5) / len(r5) if r5 else 0.0, atr=atr, tick=tick, noise=rng < max(cat.MIN_RANGE_TICKS * tick, cat.MIN_RANGE_PCT * c), trend=_trend(bars, -pattern_bars, atr), up=c >= o)

def single_candle(bars: list[dict]) -> dict:
    if not bars:
        return dict(_NO_SHAPE)
    b = bars[-1]
    o, h, l, c = (b['o'], b['h'], b['l'], b['c'])
    rng = h - l
    if min(o, c) < l or max(o, c) > h:
        return dict(_NO_SHAPE)
    atr = _atr(bars)
    wide = rng > 1.5 * atr if atr else False
    narrow = rng < 0.5 * atr if atr else False
    if not rng > 0:
        return {**_NO_SHAPE, 'wide_bar': wide, 'narrow_bar': narrow}
    ctx1 = _build_ctx(bars, 1, atr, wide, narrow)
    shape = cat.classify_shape(ctx1)
    matched = [cat.BY_KEY[shape]]
    ctx_by_len = {1: ctx1}
    for p in cat.RELATIONS:
        if len(bars) < p.bars + 1:
            continue
        if any((x['h'] - x['l'] <= 0 for x in bars[-p.bars:])):
            continue
        ctx = ctx_by_len.get(p.bars)
        if ctx is None:
            ctx = ctx_by_len[p.bars] = _build_ctx(bars, p.bars, atr, wide, narrow)
        try:
            if p.detect(ctx) and cat.context_ok(p, ctx):
                matched.append(p)
        except (KeyError, TypeError, ZeroDivisionError):
            continue
    matched.sort(key=lambda p: (p.rank, p.key))
    primary, rest = (matched[0], matched[1:])
    label = primary.label
    if rest:
        label += f' ({rest[0].label})'
        if len(rest) > 1:
            label += f' +{len(rest) - 1}'
    keys = [p.key for p in matched]
    keys += [a for k in keys if (a := cat.LEGACY_ALIASES.get(k)) and a not in keys]
    return {'candle_type': primary.key, 'candle_label': label, 'avg_body': round(ctx1.avg_body, 6) if ctx1.avg_body > 0 else None, 'avg_range': round(ctx1.avg_range, 6) if ctx1.avg_range > 0 else None, 'candle_matches': cat.encode_matches(keys), 'candle_trend': ctx_by_len.get(primary.bars, ctx1).trend, 'body_pct': round(ctx1.body_pct, 4), 'upper_wick_pct': round(ctx1.upper_pct, 4), 'lower_wick_pct': round(ctx1.lower_pct, 4), 'close_position': round(ctx1.close_pos, 4), 'wide_bar': wide, 'narrow_bar': narrow}

def multi_candle(bars: list[dict]) -> dict:
    out = {'inside_bar_run': 0, 'tight_consolidation': False, 'pullback_depth_pct': None, 'higher_lows_run': 0, 'nr7': False, 'consecutive_up': 0, 'consecutive_down': 0, 'close_cv_pct': None, 'avg_body_pct_5': None}
    n = len(bars)
    if n < 2:
        return out
    run = 0
    for i in range(n - 1, 0, -1):
        b_i = bars[i]
        if b_i['h'] - b_i['l'] <= 0 or not (b_i.get('v') or 0):
            break
        if b_i['h'] <= bars[i - 1]['h'] and b_i['l'] >= bars[i - 1]['l']:
            run += 1
        else:
            break
    out['inside_bar_run'] = run
    if n >= 7:
        ranges = [bars[i]['h'] - bars[i]['l'] for i in range(n - 7, n)]
        out['nr7'] = ranges[-1] <= min(ranges)
    if n >= 10:
        closes = [b['c'] for b in bars[-10:]]
        mean = sum(closes) / len(closes)
        if mean:
            var = sum(((x - mean) ** 2 for x in closes)) / len(closes)
            cv_pct = var ** 0.5 / mean * 100
            out['close_cv_pct'] = round(cv_pct, 2)
            out['tight_consolidation'] = cv_pct < 2.5
    bodies = []
    for b in bars[-5:]:
        rng = b['h'] - b['l']
        if rng > 0:
            bodies.append(abs(b['c'] - b['o']) / rng)
    if bodies:
        out['avg_body_pct_5'] = round(sum(bodies) / len(bodies), 3)
    hl = 0
    for i in range(n - 1, 0, -1):
        if bars[i]['l'] > bars[i - 1]['l']:
            hl += 1
        else:
            break
    out['higher_lows_run'] = hl
    window = bars[-20:] if n >= 20 else bars
    hi = max((b['h'] for b in window))
    if hi:
        out['pullback_depth_pct'] = round((hi - bars[-1]['c']) / hi * 100, 2)
    up = down = 0
    for i in range(n - 1, 0, -1):
        if bars[i]['c'] > bars[i - 1]['c']:
            if down:
                break
            up += 1
        elif bars[i]['c'] < bars[i - 1]['c']:
            if up:
                break
            down += 1
        else:
            break
    out['consecutive_up'], out['consecutive_down'] = (up, down)
    return out
RECENT_WINDOW = 5

def recent_relation(bars: list[dict], window: int=RECENT_WINDOW) -> dict:
    from . import candle_catalog as cat
    out = {'candle_recent': None, 'candle_recent_bars_ago': None, 'candle_recent_status': None, 'candle_recent_label': None}
    if not bars:
        return out
    for age in range(max(1, window)):
        end = len(bars) - age
        if end < 2:
            break
        got = single_candle(bars[:end])
        rels = [cat.BY_KEY[k] for k in cat.decode_matches(got.get('candle_matches') or '') if k in cat.RELATION_KEYS]
        if rels:
            best = min(rels, key=lambda p: (p.rank, p.key))
            status = _confirmation(bars, age, best)
            suffix = '' if age == 0 else f' ({age}d ago)'
            if status in ('opened-with', 'opened-against'):
                suffix += ' — next open went ' + ('with it' if status == 'opened-with' else 'against it')
            return {'candle_recent': best.key, 'candle_recent_bars_ago': age, 'candle_recent_status': status, 'candle_recent_label': best.label + suffix}
    return out

def _confirmation(bars, age, pattern):
    if pattern.bias not in ('bullish', 'bearish'):
        return None
    if age <= 0:
        return 'provisional'
    end = len(bars) - age
    if end < 1 or end >= len(bars):
        return 'provisional'
    pat_close = bars[end - 1]['c']
    nxt_open = bars[end]['o']
    atr = _atr(bars[:end])
    tick = cat.tick_size(pat_close)
    band = max(0.05 * atr, tick) if atr else tick
    if pattern.bias == 'bullish':
        if nxt_open > pat_close + band:
            return 'opened-with'
        if nxt_open < pat_close - band:
            return 'opened-against'
    else:
        if nxt_open < pat_close - band:
            return 'opened-with'
        if nxt_open > pat_close + band:
            return 'opened-against'
    return 'opened-flat'

def _iso_date(ymd) -> str | None:
    try:
        n = int(ymd)
    except (TypeError, ValueError):
        return None
    y, m, d = (n // 10000, n // 100 % 100, n % 100)
    if not (1 <= m <= 12 and 1 <= d <= 31):
        return None
    return f'{y:04d}-{m:02d}-{d:02d}'

def weekly_candle(bars: list[dict]) -> dict:
    return _timeframe_candle(bars, 'weekly')

def monthly_candle(bars: list[dict]) -> dict:
    return _timeframe_candle(bars, 'monthly')
_HIGHER_TF = {'weekly': ('_resample_weekly_iso', lambda d: d.isoweekday() == 5), 'monthly': ('_resample_monthly_iso', lambda d: (d.replace(day=28) + _DAY * 4).replace(day=1) - _DAY == d)}

def _timeframe_candle(bars: list[dict], tf: str) -> dict:
    ck, lk = (f'candle_{tf}', f'candle_{tf}_label')
    out = {ck: None, lk: None}
    if not bars:
        return out
    from api.services import bars_fetch
    fn_name, is_closed = _HIGHER_TF[tf]
    iso = []
    for b in bars:
        t = _iso_date(b.get('t'))
        if t:
            iso.append({**b, 't': t})
    if len(iso) < 2:
        return out
    higher = getattr(bars_fetch, fn_name)(iso)
    if len(higher) < 2:
        return out
    got = single_candle(higher)
    if got['candle_type'] in (None, 'none'):
        return out
    import datetime as _dt
    try:
        forming = not is_closed(_dt.date.fromisoformat(iso[-1]['t']))
    except (ValueError, TypeError):
        forming = True
    return {ck: got['candle_type'], lk: got['candle_label'] + (' (forming)' if forming else '')}
