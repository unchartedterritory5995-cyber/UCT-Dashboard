"""Textbook checks for the member setup TAGS (recertification C, 2026-10-24).

setup_tags.TEXTBOOK narrows a detection by the row alone; these narrow a tag by the BARS around the session it names,
because the blind recertification found tags that met the detector but not the textbook on the chart: a "kicker"
of two doji, a "gap support" whose gap was already filled, a "capitulation" after a one-day drop, and so on. Each
check is the recertification lab's rule unchanged (parity: tests/golden_judged/test_judged_setup_tags.py, which
replays the lab's own verdict on every judged detection) and only REMOVES a tag. It reads only the bars compute_tags is
handed. Fewer than 260 bars before the named session: no tag (the 200-day and its slope are not defined).

Judged result (four pre-registered blind packets per round, two fresh judges each; pass = the tag's pooled mean
>= 2.4, >= 70% of its cases >= 2 and mean >= 2.3 in both halves): episodic pivot 2.65, NR7 3.00, flag 2.58, kicker
2.73, oops reversal 2.93, slingshot 2.86 (round 1); capitulation 2.89, flat-top breakout 2.54, go signal 2.90,
launch pad 2.57, MA reclaim 2.61 (round 2). Highest volume in a year (3.00) and outside bar (2.43) passed as served
and have no check here. Gap support and trendline break failed both rounds and are withheld from members
(registry.SETUP_TAG_MEMBER_SET).
"""
import math


def _ema(x, n):
    out, k, e = [], 2.0 / (n + 1), None
    for v in x:
        e = v if e is None else e + k * (v - e)
        out.append(e)
    return out


def _sma(x, n):
    out, s = [], 0.0
    for i, v in enumerate(x):
        s += v
        if i >= n:
            s -= x[i - n]
        out.append(s / n if i >= n - 1 else None)
    return out


class S:
    def __init__(self, b):
        self.b = b
        self.o = [x['o'] for x in b]
        self.h = [x['h'] for x in b]
        self.l = [x['l'] for x in b]
        self.c = [x['c'] for x in b]
        self.v = [x['v'] for x in b]
        self.e8, self.e21, self.e4h = _ema(self.c, 8), _ema(self.c, 21), _ema(self.h, 4)
        self.s50, self.s200, self.s20 = _sma(self.c, 50), _sma(self.c, 200), _sma(self.c, 20)
        self.v50 = _sma(self.v, 50)

    def atr(self, i, n=14):
        return sum(max(self.h[j] - self.l[j], abs(self.h[j] - self.c[j - 1]), abs(self.l[j] - self.c[j - 1]))
                   for j in range(i - n + 1, i + 1)) / n

    def vavg(self, i):                      # 50-day average volume BEFORE bar i
        return sum(self.v[i - 50:i]) / 50

    def rising(self, s, i, n):
        return s[i] is not None and s[i - n] is not None and s[i] > s[i - n]

    def uptrend(self, i):
        return (self.s200[i] is not None and self.c[i] > self.s50[i] > self.s200[i] and self.rising(self.s50, i, 10))


def launch_pad(s, i):
    # round-0 faults: below a falling 50-day / 200-day overhead; cluster from a pullback; close inside the cluster
    ma = [s.e8[i], s.e21[i], s.s50[i]]
    tight = (max(ma) - min(ma)) / s.c[i] <= 0.03
    return (tight and s.c[i] > max(ma) and s.rising(s.s50, i, 10) and s.c[i] > s.s200[i]
            and s.rising(s.s200, i, 20) and s.c[i] >= s.o[i])


def capitulation(s, i):
    # faults: trivial slide (1-3 days); marked bar a green follow-through; volume only modestly heavy
    a = s.atr(i - 1)
    m, sd = s.s20[i], math.sqrt(sum((x - s.s20[i]) ** 2 for x in s.c[i - 19:i + 1]) / 20)
    slide = s.c[i - 1] <= 0.90 * max(s.c[i - 15:i - 1]) and sum(1 for j in range(i - 8, i) if s.c[j] < s.c[j - 1]) >= 5
    return (slide and s.c[i] < s.o[i] and (s.h[i] - s.l[i]) >= 2.0 * a and s.v[i] >= 2.0 * s.vavg(i)
            and s.c[i] < m - 2 * sd)


def flag(s, i):
    # faults: deep/sloppy pause (10-25%), closes under the 21-day, marked bar not pressing the top, no recent pole;
    # DEV pilot: a V-rebound under a falling 50-day read as a flag -> the flag must sit in an uptrend
    if not s.uptrend(i):
        return False
    for top in range(i - 5, i - 21, -1):                  # the flag pole's top, 4-20 bars before the marked bar
        if s.h[top] < max(s.h[top - 3:top + 1]) or s.h[top] < max(s.h[top:i]):
            continue
        base = min(s.l[top - 20:top])
        if s.h[top] < 1.20 * base:                        # pole >= 20% in <= 20 bars
            continue
        pause = range(top + 1, i)
        depth = (s.h[top] - min(s.l[j] for j in pause)) / s.h[top]
        if depth > 0.12 or depth > 0.5 * (s.h[top] - base) / s.h[top]:
            continue
        if any(s.c[j] < s.e21[j] for j in pause) or not s.rising(s.e21, i, 5):
            continue
        pole_v = sum(s.v[top - 10:top + 1]) / 11
        if sum(s.v[j] for j in pause) / len(pause) >= pole_v:
            continue
        ptop = max(s.h[j] for j in pause)
        return s.c[i] >= ptop and s.c[i] > s.o[i]
    return False


def kicker(s, i):
    # faults: near-doji bodies with no real gap between them (Nison: two long bodies)
    a = s.atr(i - 1)
    return (s.c[i - 1] < s.o[i - 1] and s.c[i] > s.o[i] and s.o[i] >= s.o[i - 1] + 0.05 * a
            and (s.o[i - 1] - s.c[i - 1]) >= 0.5 * a and (s.c[i] - s.o[i]) >= 0.5 * a)


def oops(s, i):
    # faults: open only level with the prior low; close barely above the prior close
    a = s.atr(i - 1)
    return s.o[i] <= s.l[i - 1] - 0.1 * a and s.c[i] >= s.c[i - 1] + 0.1 * a


def slingshot(s, i):
    # faults: under / at a falling 50-day (not a pullback in an uptrend); first-close ambiguity; weak close
    return s.uptrend(i) and s.c[i] > s.e4h[i] and s.c[i] > s.o[i]


def nr7(s, i):
    rng = [s.h[j] - s.l[j] for j in range(i - 6, i + 1)]
    return rng[-1] < min(rng[:-1])                          # strictly narrowest (ties read as not narrowest)


def episodic_pivot(s, i):
    # faults: gap only ~4%; volume only ~2x; out of an extended run, not a sideways base
    base = range(i - 40, i)
    hi, lo = max(s.h[j] for j in base), min(s.l[j] for j in base)
    rng = s.h[i] - s.l[i]
    return (s.o[i] >= 1.05 * s.c[i - 1] and s.v[i] >= 3.0 * s.vavg(i) and rng > 0 and (s.c[i] - s.l[i]) / rng >= 0.6
            and (hi - lo) / lo <= 0.35 and s.c[i - 1] <= 1.15 * s.c[i - 40])


# ================================================================ ROUND 2 (the seven that failed round 1)
# Each answers the round-1 judges' named faults (out/score_tags_r1.json 'low'); DEV-tuned only.

def capitulation_r2(s, i):
    # r1 faults: "no prior slide / a one-day collapse from near the highs"
    if not capitulation(s, i):
        return False
    top = max(range(i - 25, i - 1), key=lambda j: s.c[j])
    return s.c[i - 1] <= 0.85 * s.c[top] and (i - 1) - top >= 5


def ftb4_r2(s, i):
    # r1 faults: "no flat ceiling / V pullback / ceiling below the base's real top / 200-day falling"
    if not s.uptrend(i) or not s.rising(s.s200, i, 20):
        return False
    win = range(i - 40, i)
    ceil = max(s.h[j] for j in win)
    tests = [j for j in win if s.h[j] >= ceil * 0.99]
    spread = [t for k, t in enumerate(tests) if k == 0 or t - tests[k - 1] >= 5]
    depth = (ceil - min(s.l[j] for j in win)) / ceil
    return (len(spread) >= 2 and spread[-1] - spread[0] >= 10 and depth <= 0.20 and s.c[i] >= ceil * 0.995
            and s.c[i] > s.o[i])


def go_signal_r2(s, i):
    # r1 faults: "opened flat not weak / low only grazes the EMA / no swing low undercut / a pinned 1-cent stock"
    if not s.uptrend(i):
        return False
    a = s.atr(i - 1)
    rng = s.h[i] - s.l[i]
    if a / s.c[i] < 0.01 or rng <= 0 or (s.c[i] - s.l[i]) / rng < 0.67 or s.c[i] <= s.o[i]:
        return False
    swing_low = min(s.l[i - 10:i])
    return s.o[i] <= s.c[i - 1] - 0.2 * a and s.l[i] <= swing_low - 0.2 * a and s.c[i] > swing_low


def launch_pad_r2(s, i):
    # r1 faults: "the cluster formed from a V pullback, not a sideways tightening / loose"
    if not launch_pad(s, i):
        return False
    ma = [s.e8[i], s.e21[i], s.s50[i]]
    tight = (max(ma) - min(ma)) / s.c[i] <= 0.02
    box = (max(s.h[i - 10:i]) - min(s.l[i - 10:i])) / s.c[i - 1]
    return tight and box <= 0.10


def ma_reclaim_r2(s, i):
    # r1 faults: "only one close below / already closed above days earlier / barely above / light volume"
    a = s.atr(i)
    for ma in (s.s50, s.s200):
        if ma[i - 10] is None:
            continue
        if (all(s.c[j] < ma[j] for j in range(i - 5, i)) and s.c[i] >= ma[i] + 0.5 * a
                and ma[i] >= ma[i - 10] - 0.5 * a and s.c[i] > s.o[i] and s.v[i] >= s.vavg(i)):
            return True
    return False


#: id -> the check a member tag must also meet on the session it names (the round that passed blind judging).
CHECKS: dict = {
    "episodic_pivot": episodic_pivot, "nr7": nr7, "uct_flag_htf": flag, "uct_kicker": kicker,
    "uct_oops_reversal": oops, "uct_slingshot": slingshot,
    "uct_capitulation": capitulation_r2, "uct_flat_top_breakout_ftb4": ftb4_r2, "uct_go_signal": go_signal_r2,
    "uct_launch_pad_v4": launch_pad_r2, "uct_ma_reclaim": ma_reclaim_r2,
}
#: Bars a check needs before the session it names (the lab's floor).
MIN_INDEX = 260


def keep(pid: str, bars: list, t: int) -> bool:
    """True when the tag `pid` named on session `t` (YYYYMMDD) meets its textbook check on `bars` (completed daily
    {t,o,h,l,c,v}, oldest first, ending where compute_tags' slice ended). An id with no check passes. Unknown
    session, too little history or a failed computation: False (fail closed)."""
    check = CHECKS.get(pid)
    if check is None:
        return True
    idx = [k for k, x in enumerate(bars) if int(x["t"]) == int(t)]
    if not idx or idx[0] < MIN_INDEX:
        return False
    try:
        return bool(check(S(bars), idx[0]))
    except (IndexError, ZeroDivisionError, TypeError, ValueError):
        return False
