"""lab base_rebuild -- the PLAIN base (the stateless bc:base, "Buy point X" before any breakout), rebuilt from the
textbook (O'Neil / IBD: How to Make Money in Stocks; Bulkowski; Edwards & Magee). Pure; reads bars[:i+1] only.

    plain_base(bars, i) -> dict | None      bars: [{t,o,h,l,c,v}], oldest first; i: the as-of (completed) session

THE GEOMETRY (each step names the rubric criterion it serves)
 1. LEFT-SIDE HIGH (C4, C5). The base starts at the bar the decline began from: the EARLIEST bar `lip` in the last
    MAX_LEN sessions whose high is within RIM_TOL_ATR x ATR(14) of the highest high from it to the bar before the
    as-of bar (every later high sits at or under the ceiling it set). The ceiling LINE is the highest high of
    [lip, i-1] (H): the left-side high itself, or a later rim high that equals it within RIM_TOL_ATR. A later high
    clearly above the left side therefore never carries the line: that bar would itself be the left side, and the
    base would be what follows it.
 2. NOT UNDER AN OLDER PEAK (C4). No high in the PEAK_LOOK sessions before the lip above H.
 3. NOT A FRAGMENT (C4). The lip is the top of an ADVANCE, not a poke out of an earlier base: no bar in the
    FRAG_LOOK sessions before it (to FRAG_GAP sessions before it) has a high within FRAG_PCT of H with a dip of at
    least FRAG_DIP between that high and the lip.
 4. THE O'NEIL TABLE (C2, C3). depth = (H - L) / H, L the lowest low of [lip, i-1]. MIN_DEPTH <= depth <= MAX_DEPTH
    and H - L at least MIN_RANGE_ATR x ATR(14) (the label's own too-shallow floor);
    sessions from the lip to the as-of bar (inclusive, the printed weeks x 5) at least MIN_SESS_FLAT for a flat base
    (depth <= FLAT_MAX_DEPTH) and MIN_SESS_CUP for anything deeper (a cup / double bottom); at most MAX_LEN.
 5. NOT A V (C3, C4). A base deeper than V_DEPTH spends at least V_RIGHT_SHARE of its sessions from its low to the
    as-of bar, and at least V_LEFT_MIN sessions from the lip to its low.
 6. PRIOR ADVANCE (C1). From the base's own low-before-advance -- the lowest low of the sessions before the lip that
    the judged chart frame shows (frame_start) -- to H at least ADV_MIN. The largest single opening gap inside that
    advance leaves at least ADV_EX_GAP of advance without it (not a gap with no advance).
 7. NOT AFTER A PARABOLIC RUN (C4). H over the lowest low of the RUN_BARS sessions before the lip at most 1 + RUN_MAX.
 8. STAGE 2 (C1). The close above a RISING 200-day average: SMA200(i) > SMA200(i - SMA_RISE_BARS) x (1 + SMA_RISE),
    SMA200(i) > SMA200(lip), and SMA200 not below its value SMA_RISE_BARS earlier on more than SMA_FALL_SHARE of the
    base's sessions; at most UNDER200_SHARE of the base's closes under their 200-day average.
 9. CURRENT AND ACTIONABLE (C8). H is the highest high inside the base, so no earlier close broke out; the as-of close within
    [buy point x (1 - BELOW_BP), buy point x (1 + ABOVE_BP)] (buy point = H + $0.10).
 10. LONE WICK (C5). H at most WICK_MAX_ATR x ATR(14) above the highest candle body of the bars within WICK_NEAR
    sessions of the bar that set it (inside the base or just before it).
 11. STAGE (C7), the IBD base count read on the judged frame: from the low-before-advance, every earlier stretch from
    a running high to the bar that cleared it lasting STG_MIN_BARS+ sessions and STG_MIN_DEPTH+ deep is a base; the
    first is stage 1; a base whose low undercuts the prior base's low is stage 1; one forming above the prior buy
    point after a STG_GAIN advance from it is the next stage; anything else is the same stage (base on base).

Returns {pivot (H), start_t, end_t, low, low_t, bars, atr, label, low_label, stage, plain_round} or None.
"""
ROUND = 6
LABEL, LOW_LABEL = 'pivot', 'base low'

MAX_LEN = 230
RIM_TOL_ATR = 0.20
PEAK_LOOK = 250
FRAG_LOOK, FRAG_GAP, FRAG_PCT, FRAG_DIP = 60, 3, 0.03, 0.08
MIN_DEPTH, FLAT_MAX_DEPTH, MAX_DEPTH, MIN_RANGE_ATR = 0.05, 0.15, 0.33, 1.5
MIN_SESS_FLAT, MIN_SESS_CUP = 25, 35
V_DEPTH, V_RIGHT_SHARE, V_LEFT_MIN = 0.20, 0.20, 5
ADV_MIN, ADV_EX_GAP = 0.30, 0.20
RUN_BARS, RUN_MAX = 40, 0.75
SMA_N, SMA_RISE_BARS, SMA_RISE, SMA_FALL_SHARE, UNDER200_SHARE = 200, 20, 0.0, 0.25, 0.15
BELOW_BP, ABOVE_BP = 0.05, 0.05
WICK_MAX_ATR, WICK_NEAR = 1.0, 3
STG_MIN_BARS, STG_MIN_DEPTH, STG_GAIN = 20, 0.08, 0.20
FRAME_MIN, FRAME_PAD, FRAME_MAX = 140, 60, 300
TICK = 0.10


def _atr(b, i, n=14):
    k = max(1, i - n + 1)
    trs = [max(b[j]['h'], b[j - 1]['c']) - min(b[j]['l'], b[j - 1]['c']) for j in range(k, i + 1)]
    return sum(trs) / len(trs) if trs else None


def _bt(x):
    return x['o'] if x['o'] > x['c'] else x['c']


def frame_start(i, lip):
    """First bar index of the judged chart frame (the renderer's window: max(FRAME_MIN, base sessions + FRAME_PAD),
    capped at FRAME_MAX, ending at the as-of bar)."""
    show = min(FRAME_MAX, max(FRAME_MIN, i - lip + FRAME_PAD))
    return max(0, i + 1 - show)


def stage_of(b, adv_i, lip, H, L):
    """The base count of the base [lip, ..] on the bars from the low-before-advance `adv_i` (rule step 11)."""
    bases = []
    hi, hi_i = float(b[adv_i]['h']), adv_i
    for j in range(adv_i + 1, lip + 1):
        h = float(b[j]['h'])
        if h > hi:
            if j - hi_i >= STG_MIN_BARS and j - hi_i >= 2:
                low = min(float(b[m]['l']) for m in range(hi_i + 1, j))
                if (hi - low) / hi >= STG_MIN_DEPTH:
                    bases.append({'lh': hi, 'low': low})
            hi, hi_i = h, j
    bases.append({'lh': H, 'low': L})
    stage, prev = 0, None
    for x in bases:
        if prev is None or x['low'] < prev['low']:
            stage = 1
        elif x['low'] > prev['lh'] + TICK and x['lh'] >= (prev['lh'] + TICK) * (1.0 + STG_GAIN):
            stage += 1
        prev = x
    return stage


def plain_base(bars, i, why=None):
    """The plain base at bar i, or None. `why`, a dict, receives the first failed step under 'fail' (diagnostics)."""
    def no(k):
        if why is not None:
            why['fail'] = k
        return None
    try:
        if not isinstance(i, int) or isinstance(i, bool) or i < SMA_N + SMA_RISE_BARS + 40 or i >= len(bars):
            return no('history')
        b = bars[:i + 1]
        a = _atr(b, i)
        if not a or a <= 0:
            return no('atr')
        h = [float(x['h']) for x in b]
        lo = [float(x['l']) for x in b]
        c = [float(x['c']) for x in b]
        # 1. the left-side high: the earliest bar of the last MAX_LEN at the ceiling of everything after it
        start = max(1, i - MAX_LEN)
        suf = [0.0] * (i + 1)          # suf[j] = max high of [j, i-1]
        run = float('-inf')
        for j in range(i - 1, start - 1, -1):
            run = max(run, h[j])
            suf[j] = run
        lip = next((j for j in range(start, i) if h[j] >= suf[j] - RIM_TOL_ATR * a), None)
        if lip is None:
            return no('lip')
        n_sess = i - lip + 1
        H = suf[lip]
        L = min(lo[lip:i])
        low_i = min(range(lip, i), key=lambda m: (lo[m], m))
        # 2. not under an older peak (nor a base longer than MAX_LEN: its left side is out of the window)
        p0 = max(0, lip - PEAK_LOOK)
        if lip > p0 and max(h[p0:lip]) > H:
            return no('older_peak')
        # 3. not a fragment of an earlier base
        for k in range(max(0, lip - FRAG_LOOK), lip - FRAG_GAP + 1):
            if h[k] >= H * (1.0 - FRAG_PCT) and min(lo[k:lip + 1]) <= h[k] * (1.0 - FRAG_DIP):
                return no('fragment')
        # 4. the O'Neil table
        depth = (H - L) / H
        if depth < MIN_DEPTH:
            return no('shallow')
        if depth > MAX_DEPTH:
            return no('deep')
        if (H - L) / a < MIN_RANGE_ATR:
            return no('shallow')
        if n_sess < (MIN_SESS_FLAT if depth <= FLAT_MAX_DEPTH else MIN_SESS_CUP):
            return no('short')
        # 5. not a V
        if depth > V_DEPTH and (i - low_i < V_RIGHT_SHARE * n_sess or low_i - lip < V_LEFT_MIN):
            return no('v_shape')
        # 6. the prior advance off the base's own low-before-advance, on the judged frame
        f0 = frame_start(i, lip)
        if lip - f0 < 5:
            return no('frame')
        adv_i = min(range(f0, lip), key=lambda m: (lo[m], -m))
        adv_low = lo[adv_i]
        if not adv_low > 0 or H / adv_low - 1.0 < ADV_MIN:
            return no('advance')
        gap = max([float(b[m]['o']) / c[m - 1] for m in range(adv_i + 1, lip + 1) if c[m - 1] > 0] or [1.0])
        if gap > 1.0 and H / adv_low / gap - 1.0 < ADV_EX_GAP:
            return no('gap_advance')
        # 7. not straight after a parabolic run
        r0 = max(0, lip - RUN_BARS)
        if lip > r0 and H / min(lo[r0:lip + 1]) - 1.0 > RUN_MAX:
            return no('parabolic')
        # 8. stage 2: above a rising 200-day
        cs = [0.0]
        for x in c:
            cs.append(cs[-1] + x)

        def sma(k):
            return (cs[k + 1] - cs[k + 1 - SMA_N]) / SMA_N if k + 1 - SMA_N >= 0 else None
        s_i, s_p, s_l = sma(i), sma(i - SMA_RISE_BARS), sma(lip)
        if None in (s_i, s_p, s_l) or not c[i] > s_i or not s_i > s_p * (1.0 + SMA_RISE) or not s_i > s_l:
            return no('trend')
        if lip - SMA_RISE_BARS + 1 - SMA_N < 0:
            return no('history')
        falls = sum(1 for k in range(lip, i + 1) if sma(k) < sma(k - SMA_RISE_BARS))
        if falls > SMA_FALL_SHARE * n_sess:
            return no('trend_falling')
        under = sum(1 for k in range(lip, i + 1) if c[k] < sma(k))
        if under > UNDER200_SHARE * n_sess:
            return no('under_200')
        # 9. current and actionable (no close inside the base is above H: H is the base's highest high)
        bp = round(H + TICK, 2)
        if not (bp * (1.0 - BELOW_BP) <= c[i] <= bp * (1.0 + ABOVE_BP)):
            return no('not_near_buy_point')
        # 10. the ceiling is not a lone wick: H within WICK_MAX_ATR of the highest body near the bar that set it
        m_h = max(range(lip, i), key=lambda m: (h[m], -m))
        if H - max(_bt(b[m]) for m in range(max(0, m_h - WICK_NEAR), min(i, m_h + WICK_NEAR + 1))) > WICK_MAX_ATR * a:
            return no('spike_wick')
        # 11. the stage
        st = stage_of(b, adv_i, lip, H, L)
        return {'pivot': H, 'start_t': int(b[lip]['t']), 'end_t': int(b[i]['t']), 'low': L,
                'low_t': int(b[low_i]['t']), 'bars': i - lip, 'atr': float(a), 'label': LABEL,
                'low_label': LOW_LABEL, 'stage': int(st), 'plain_round': ROUND}
    except (KeyError, TypeError, ValueError, ZeroDivisionError, IndexError):
        return no('error')
