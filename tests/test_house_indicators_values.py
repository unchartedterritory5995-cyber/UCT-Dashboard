"""⭐ THE HOUSE SET'S VALUES — every UCT house indicator against an independent calculation.

`app/src/components/chart/house/houseIndicators.json` is what the UCT tab installs. For each
indicator, every output tree is evaluated by the server's own evaluator
(`ast_interpret.interpret`, the Python twin of the chart's) over deterministic daily bars, and
compared, bar by bar, with a calculation written here in plain Python from what the indicator is
SAID to do (its summary), using no engine code.

First run on real bars, 2026-11-16 (SPY and NVDA, 300 bars each): every output agreed on every
bar. This file holds that on synthetic bars so it runs anywhere and fails if the set, or the
engine under it, moves.

⛔ A house indicator with no reference here FAILS (`test_every_output_has_a_reference`): none can
be added to the set unchecked.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import pathlib
import random

import pytest

from api.services import ast_interpret

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOUSE = json.loads((ROOT / "app/src/components/chart/house/houseIndicators.json").read_text(encoding="utf-8"))
NAN = float("nan")


def ok(v):
    return v is not None and not (isinstance(v, float) and math.isnan(v))


def num(v):
    if v is True:
        return 1.0
    if v is False:
        return 0.0
    return float(v) if ok(v) else NAN


#: US market holidays in the span the bars cover. ⚠️ THEY MATTER: the engine knows the exchange
#: calendar, so a bar dated on a holiday is not a session it expects, and the week after one
#: came out a week behind on the first version of these bars (which traded every weekday).
#: Real bars have no such days; neither do these.
HOLIDAYS = {dt.date.fromisoformat(d) for d in (
    "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04",
    "2024-09-02", "2024-11-28", "2024-12-25",
    "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19",
    "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03",
    "2026-09-07", "2026-11-26", "2026-12-25")}


def _walk(seed: int, n: int = 620, drift: float = 0.0004, vol: float = 0.02, gaps: bool = True) -> list[dict]:
    """Daily bars on real trading days, with real ranges, overnight gaps, and volume surges."""
    rnd = random.Random(seed)
    out, close, day = [], 100.0, dt.date(2024, 1, 1)
    while len(out) < n:
        if day.weekday() < 5 and day not in HOLIDAYS:
            gap = rnd.choice([0.0] * 14 + [0.05, 0.06, -0.05]) if gaps else 0.0
            o = close * (1 + gap + rnd.uniform(-0.004, 0.004))
            c = o * (1 + drift + rnd.uniform(-vol, vol))
            h = max(o, c) * (1 + rnd.uniform(0.0, vol / 2))
            l = min(o, c) * (1 - rnd.uniform(0.0, vol / 2))
            v = 1_000_000 * (1 + rnd.random()) * (rnd.choice([1] * 8 + [2.2, 3.0]))
            out.append({"t": day.isoformat(), "o": round(o, 4), "h": round(h, 4), "l": round(l, 4),
                        "c": round(c, 4), "v": float(int(v))})
            close = c
        day += dt.timedelta(days=1)
    return out


BARS = _walk(7)
SPY = _walk(11, vol=0.008, gaps=False)

#: A RARE CONDITION NEEDS BARS ON WHICH IT OCCURS. The follow-through day is true on 0 of the default
#: series' last 300 bars, so agreement there would be 0 == 0 on every bar and would have passed the two
#: builds of it that could not fire at all (`test_the_conditions_actually_happen_on_these_bars` is what
#: refused it). On this wider-ranging series it is true on 7 of the last 300.
BARS_FOR = {"follow_through_day": _walk(41, vol=0.04)}


def bars_for(which: str) -> list[dict]:
    return BARS_FOR.get(which, BARS)


# ---- independent helpers: plain lists, NaN until a full window ---------------------------------
def sma(x, n):
    return [sum(x[i - n + 1:i + 1]) / n if i >= n - 1 and all(ok(a) for a in x[i - n + 1:i + 1]) else NAN
            for i in range(len(x))]


def ema(x, n):
    out, k, e = [], 2 / (n + 1), None
    for i, v in enumerate(x):
        if not ok(v):
            out.append(NAN)
            continue
        if e is None:
            w = x[i - n + 1:i + 1] if i >= n - 1 else None
            if w and all(ok(a) for a in w):
                e = sum(w) / n
        else:
            e = v * k + e * (1 - k)
        out.append(e if e is not None else NAN)
    return out


def roll(x, n, f):
    return [f(x[i - n + 1:i + 1]) if i >= n - 1 and all(ok(a) for a in x[i - n + 1:i + 1]) else NAN
            for i in range(len(x))]


def prev(x):
    return [NAN] + x[:-1]


def atr(h, l, c, n):
    tr = [h[0] - l[0]] + [max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])) for i in range(1, len(c))]
    out, a = [], None
    for i in range(len(tr)):
        if i == n - 1:
            a = sum(tr[:n]) / n
        elif i >= n:
            a = (a * (n - 1) + tr[i]) / n
        out.append(a if a is not None else NAN)
    return out


def weekly(bars):
    weeks, idx = [], []
    for b in bars:
        y, w, _ = dt.date.fromisoformat(b["t"]).isocalendar()
        if not weeks or weeks[-1]["k"] != (y, w):
            weeks.append({"k": (y, w), "h": b["h"], "l": b["l"], "c": b["c"]})
        else:
            wk = weeks[-1]
            wk["h"], wk["l"], wk["c"] = max(wk["h"], b["h"]), min(wk["l"], b["l"]), b["c"]
        idx.append(len(weeks) - 1)
    return weeks, idx


def references(which: str, bars: list[dict], spy: list[dict]) -> dict:
    """What each output of house indicator `which` (its slug) should be, from its description."""
    o = [b["o"] for b in bars]; h = [b["h"] for b in bars]; l = [b["l"] for b in bars]
    c = [b["c"] for b in bars]; v = [b["v"] for b in bars]
    n = len(c)
    c1, v1, h1, l1 = prev(c), prev(v), prev(h), prev(l)
    flag = lambda cond, known=True: (1.0 if cond else 0.0) if known else NAN       # noqa: E731
    R: dict = {}
    if which == "distribution_day_count":
        dd = [ok(c1[i]) and c[i] <= c1[i] * 0.998 and v[i] > v1[i] for i in range(n)]
        R["isDD"] = [flag(dd[i], i >= 1) for i in range(n)]
        R["ddCount"] = [NAN] * 25 + [float(sum(1 for j in range(i - 24, i + 1) if dd[j])) for i in range(25, n)]
    elif which in ("relative_strength_vs_spy", "rs_new_high_vs_spy"):
        sp = {b["t"]: b["c"] for b in spy}
        rs = [c[i] / sp[bars[i]["t"]] if bars[i]["t"] in sp else NAN for i in range(n)]
        hi = roll(rs, 252, max)
        R["rs"] = rs
        if which == "relative_strength_vs_spy":
            R["rsEma"] = ema(rs, 21)
            R["newHigh"] = [flag(ok(hi[i]) and rs[i] >= hi[i], ok(hi[i])) for i in range(n)]
        else:
            hh = roll(h, 252, max)
            R["sig"] = [flag(ok(hi[i]) and rs[i] >= hi[i] and h[i] < hh[i], ok(hi[i])) for i in range(n)]
    elif which == "atr_extension":
        s, a = sma(c, 50), atr(h, l, c, 14)
        R["ext"] = [(c[i] - s[i]) / a[i] if ok(s[i]) and ok(a[i]) else NAN for i in range(n)]
    elif which == "percent_distance_from_10_week_ma":
        weeks, idx = weekly(bars)
        ws = sma([w["c"] for w in weeks], 10)          # completed weeks only
        R["pctDist"] = [(c[i] - ws[idx[i] - 1]) / ws[idx[i] - 1] * 100 if idx[i] >= 1 and ok(ws[idx[i] - 1]) else NAN
                        for i in range(n)]
    elif which == "volume_with_50_average":
        a = sma(v, 50)
        R["vol"], R["avg"] = v, a
        # ⭐ 2026-11-18 (owner ruling) -- AN UP DAY IS A CLOSE ABOVE THE PREVIOUS CLOSE, a down day a
        # close below it. Close above the OPEN is an up BAR; version 1 of this indicator used that.
        # The first bar has no previous close, so the day is unknown there.
        R["upSurge"] = [flag(i >= 1 and ok(a[i]) and c[i] > c[i - 1] and v[i] > a[i] * 1.4, i >= 1 and ok(a[i])) for i in range(n)]
        R["downSurge"] = [flag(i >= 1 and ok(a[i]) and c[i] < c[i - 1] and v[i] > a[i] * 1.4, i >= 1 and ok(a[i])) for i in range(n)]
    elif which == "tight_weekly_closes":
        weeks, idx = weekly(bars)
        wc = [w["c"] for w in weeks]
        out = []
        for i in range(n):
            k = idx[i] - 1                             # the last completed week
            if k < 2:
                out.append(NAN)
                continue
            a3 = wc[k - 2:k + 1]
            out.append(flag((max(a3) - min(a3)) / min(a3) <= 0.015))
        R["tight"] = out
    elif which == "gap_up_on_volume":
        a = sma(v, 50)
        R["gapUpVol"] = [flag(ok(c1[i]) and ok(a[i]) and (o[i] - c1[i]) / c1[i] * 100 >= 4 and v[i] > a[i],
                              ok(a[i]) and ok(c1[i])) for i in range(n)]
    elif which == "inside_outside_bars":
        R["insideBar"] = [flag(i >= 1 and h[i] <= h1[i] and l[i] >= l1[i], i >= 1) for i in range(n)]
        R["outsideBar"] = [flag(i >= 1 and h[i] > h1[i] and l[i] < l1[i], i >= 1) for i in range(n)]
    elif which == "average_daily_range":
        r = [h[i] / l[i] - 1 for i in range(n)]
        a = sma(r, 20)
        R["adr"] = [a[i] * 100 if ok(a[i]) else NAN for i in range(n)]
        R["todayPct"] = [r[i] / a[i] * 100 if ok(a[i]) and a[i] else NAN for i in range(n)]
    elif which == "ema_10_21_trend":
        R["ema21"], R["ema10"] = ema(c, 21), ema(c, 10)
    elif which == "flat_base":
        out = []
        for i in range(n):
            if i < 251:
                out.append(NAN)
                continue
            hh, ll = max(h[i - 24:i + 1]), min(l[i - 24:i + 1])
            out.append(flag(hh <= ll * 1.15 and c[i] >= max(h[i - 251:i + 1]) * 0.85 and c[i - 25] >= c[i - 125] * 1.2))
        R["flatBase"] = out
    elif which == "up_down_volume_ratio_50":
        # ⭐ 2026-11-18 (owner ruling): volume on days that closed above the PREVIOUS close, over
        # volume on days that closed below it (the common up/down volume ratio). Fifty such days
        # need fifty-one bars: the first has no previous close.
        up = [v[i] if i >= 1 and c[i] > c[i - 1] else 0.0 for i in range(n)]
        dn = [v[i] if i >= 1 and c[i] < c[i - 1] else 0.0 for i in range(n)]
        udr = [sum(up[i - 49:i + 1]) / sum(dn[i - 49:i + 1]) if i >= 50 and sum(dn[i - 49:i + 1]) else NAN
               for i in range(n)]
        R["udr"] = udr
        R["strong"] = [flag(ok(u) and u > 1.2, ok(u)) for u in udr]
    elif which == "follow_through_day":
        out = []
        for i in range(n):
            if i < 50:
                out.append(NAN)
                continue
            lo = min(l[i - 49:i + 1])
            ago = min(k for k in range(50) if l[i - k] == lo)          # bars back to the low, the newest of a tie
            out.append(flag((c[i] - c[i - 1]) / c[i - 1] >= 0.017 and v[i] > v[i - 1] and 4 <= ago <= 12))
        R["ftd"] = out
    elif which == "previous_week_high_low":
        weeks, idx = weekly(bars)
        R["pwh"] = [weeks[idx[i] - 1]["h"] if idx[i] >= 1 else NAN for i in range(n)]
        R["pwl"] = [weeks[idx[i] - 1]["l"] if idx[i] >= 1 else NAN for i in range(n)]
    return R


#: outputs the engine adds for colouring (a hidden column per colour rule): they repeat a
#: condition already checked through the output they colour, and carry no value of their own.
def _is_helper(key: str) -> bool:
    return key.endswith("_cs") or key == "levels"


def _trees(defn: dict) -> dict:
    compute = defn["compute"]
    if isinstance(compute.get("trees"), dict):
        return dict(compute["trees"])
    plots = [p["key"] for p in defn.get("plots") or [] if not _is_helper(p["key"])]
    return {plots[0]: compute["ast"]}


#: smoothed outputs converge on their seed; everything else must agree to rounding.
SMOOTHED = {"rsEma", "ext", "ema21", "ema10"}
CASES = [(item["slug"], out) for item in HOUSE["indicators"] for out in _trees(item["definition"]) if not _is_helper(out)]


def test_the_set_is_here_and_every_output_has_a_reference():
    assert len(HOUSE["indicators"]) >= 11
    missing = [(k, o) for k, o in CASES if o not in references(k, bars_for(k), SPY)]
    assert not missing, f"house outputs with no independent calculation: {missing}"


@pytest.mark.parametrize("which,output", CASES)
def test_every_bar_agrees_with_the_independent_calculation(which, output):
    item = next(i for i in HOUSE["indicators"] if i["slug"] == which)
    tree = _trees(item["definition"])[output]
    bars = bars_for(which)
    got = [num(x) for x in ast_interpret.interpret(tree, bars, {}, None, None, {"tf": "D", "symbols": {"SPY": SPY}})]
    exp = references(which, bars, SPY)[output]
    tail = range(len(bars) - 300, len(bars))               # past every warm-up
    both = [i for i in tail if ok(got[i]) and ok(exp[i])]
    assert len(both) >= 40, f"only {len(both)} comparable bars: the check would prove nothing"
    # where the reference has a value the engine must too, and the other way round
    assert not [i for i in tail if ok(got[i]) != ok(exp[i])][:3], "the two disagree about WHICH bars have a value"
    slack = 5e-4 if output in SMOOTHED else 0.0
    bad = [(bars[i]["t"], got[i], exp[i]) for i in both
           if abs(got[i] - exp[i]) > 1e-6 * max(1.0, abs(exp[i])) + slack * max(1.0, abs(exp[i]))]
    assert not bad, bad[:3]


def test_the_conditions_actually_happen_on_these_bars():
    """A flag that is never true (or always true) would agree with anything: each condition
    output must be true on some bars and false on others."""
    for which, output in CASES:
        exp = [x for x in references(which, bars_for(which), SPY)[output][-300:] if ok(x)]
        if exp and set(exp) <= {0.0, 1.0}:
            assert 0 < sum(exp) < len(exp), f"{which}.{output} is constant on the test bars"


def test_CONTROL_a_wrong_window_is_caught():
    """The check can fail: the distribution count over 20 sessions is not the 25-session count."""
    item = next(i for i in HOUSE["indicators"] if i["slug"] == "distribution_day_count")
    tree = json.loads(json.dumps(_trees(item["definition"])["ddCount"]).replace('"value": 25', '"value": 20'))
    got = [num(x) for x in ast_interpret.interpret(tree, BARS, {}, None, None, {"tf": "D"})]
    exp = references("distribution_day_count", BARS, SPY)["ddCount"]
    assert any(ok(got[i]) and ok(exp[i]) and got[i] != exp[i] for i in range(len(BARS) - 300, len(BARS)))
