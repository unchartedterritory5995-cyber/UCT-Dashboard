"""Group fundamentals and breadth: the pure arithmetic behind `group_stats` (no reads, no clock).

Every definition the Terminal's group views state lives here, named, and is tested on invented numbers
(tests/test_group_stats.py).

FUNDAMENTALS (point in time, from the store `api/services/fundamentals_pit/` serves the charts and FUND):
  * a value is the one IN FORCE at a reference time, by the store's own as-of rule (asof.py): the newest
    point whose `t_eff` (when its filing became public) is at or before the reference time; a gap point
    (the store's `null`) is no value; a point whose fiscal period ended more than `MAX_PERIOD_AGE_DAYS`
    before the reference day is no value (a company that stopped filing goes blank, never flat);
  * the stored metrics are the catalog's own series (`STORED`); P/E, P/S and FCF yield are composed with
    the stock's stored close on the reference day exactly as the catalog's composers do (`compose`), and a
    zero or negative base is no value (P/E with negative EPS, P/S with no revenue);
  * revenue growth ACCELERATING (the screener-trend rule, `briefs/screener_trend_filters.md`, not yet
    merged anywhere: the count of consecutive quarters in which year-over-year quarterly revenue growth
    rose versus the quarter before; "accelerating" here is a count of at least one): the newest quarter's
    y/y growth in force is higher than the quarter before it, both as known at the reference time, and the
    two quarter ends are `ACCEL_GAP_DAYS` apart (a missing quarter is no answer, never a comparison across
    a gap);
  * a group's figure is the MEDIAN of its members' values and its middle half the interquartile range
    (linear interpolation between the closest ranks, numpy's default), and it is given only when at least
    `MIN_MEMBERS` members have a value: fewer gives the count and no median.

BREADTH (from stored daily closes, split-adjusted, price only):
  * above the 20, 50 and 200-day average: that day's close above the plain average of the stock's own
    last 20, 50 or 200 stored closes ending that day;
  * new 52-week high (low): that day's close above (below) every one of the stock's previous
    `HIGH_SESSIONS - 1` stored closes; within 5% of the 52-week high: that day's close at least
    `NEAR_HIGH` of the highest of the last `HIGH_SESSIONS` closes. All on CLOSING prices;
  * advance / decline: that day's close against the stock's previous stored close;
  * a stock counts on a day only when it has a close dated that session and enough closes for the measure.

RANK HISTORY (2026-11-22; from the same stored closes, in the same pass):
  * the points: the last session of each of the `RANK_WEEKS` calendar weeks before the newest session's week (the
    Friday close, or the Thursday's when the Friday is a holiday), then the newest session itself; a week with no
    session has no point;
  * a stock's 6-month (3-month) change at a point: its close dated that session against its own close 126 (63)
    stored sessions earlier, the RS rating's own lookbacks and formula (`rs_weighted_return.RS_TERMS` and
    `period_return`), on the closes up to that day only (no look-ahead); none when it has no close that day, fewer
    closes, or a base that is not a positive price;
  * a group's figure at a point: the median of its members' changes, given only when at least `MIN_MEMBERS` members
    have one; its rank: `rank` over the groups of its kind with a figure that week (highest first, ties share a
    place), out of that many groups;
  * the members are today's map at every point: the site keeps no history of group membership (survivorship).
"""
from __future__ import annotations

import math
from array import array
from bisect import bisect_right
from datetime import date
from typing import Iterable, Optional

from api.services.rs_weighted_return import RS_TERMS

MIN_MEMBERS = 5                 # a median or a share needs at least this many members with a value
MAX_PERIOD_AGE_DAYS = 200       # asof.MAX_PERIOD_AGE: a point stops being in force once its period is older
ACCEL_GAP_DAYS = (60, 120)      # two quarter ends this many days apart are consecutive quarters
SMA_WINDOWS = (20, 50, 200)
HIGH_SESSIONS = 252             # a 52-week window of sessions
NEAR_HIGH = 0.95                # within 5% of the 52-week high
OFFSETS = (("now", 0), ("week", 5), ("month", 21))   # sessions back from the breadth session
LINE_SESSIONS = 252             # the line: one year of sessions
TAIL_SESSIONS = HIGH_SESSIONS + 21 + 1 + 50   # closes kept per stock: the month-ago high window, and the line's 50-day average
CLOSE_REACH_DAYS = 10           # a valuation close is the last stored close at most this many days before its reference day
SESSION_SHARE = 0.25            # a day is a session when at least this share of priced stocks has a close on it
NEWEST_SHARE = 0.5              # the breadth session is the newest one at least this share of priced stocks has reached

#: catalog id -> the stored series it is (catalog.py V1); railed equal to the catalog
STORED = {
    "revenue_growth_q": "revenue_growth_yoy_q",
    "eps_growth_q": "eps_growth_yoy_q",
    "gross_margin": "gross_margin_ttm",
    "operating_margin": "operating_margin_ttm",
    "net_margin": "net_margin_ttm",
    "fcf_margin": "fcf_margin_ttm",
    "roe": "roe_ttm",
}
#: catalog id -> the stored inputs its composer reads (catalog.py V1 `inputs`); railed equal to the catalog
COMPOSED = {
    "pe_ttm": ("eps_diluted_ttm",),
    "ps_ttm": ("shares_outstanding", "revenue_ttm"),
    "fcf_yield": ("shares_outstanding", "fcf_ttm"),
}
ACCEL_ID = "revenue_accelerating"
#: the metrics in the order every view lists them (growth, profitability, valuation)
FUND_ORDER = ("revenue_growth_q", "eps_growth_q", ACCEL_ID, "gross_margin", "operating_margin", "net_margin",
              "fcf_margin", "roe", "pe_ttm", "ps_ttm", "fcf_yield")
#: every stored series one company's read needs
SERIES_NEEDED = tuple(sorted(set(STORED.values()) | {s for ins in COMPOSED.values() for s in ins}))
REFS = ("now", "year_ago", "three_years_ago")
BREADTH_SHARES = ("above20", "above50", "above200", "near_high")


def _finite(v) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    v = float(v)
    return v if math.isfinite(v) else None


def _day(s) -> Optional[date]:
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


# ── fundamentals ─────────────────────────────────────────────────────────────────────────────

def in_force(points, ref_ts: float, ref_day: date) -> Optional[float]:
    """The value of a stored series in force at `ref_ts` (unix seconds), or None. `points` are the
    store's `[t_eff, value | None, 'YYYY-MM-DD' period end, method]`, ascending by `t_eff`."""
    best = None
    for p in points or ():
        try:
            t = float(p[0])
        except (TypeError, ValueError, IndexError):
            continue
        if t <= ref_ts:
            best = p
        else:
            break
    if best is None or len(best) < 3:
        return None
    v = _finite(best[1])
    end = _day(best[2])
    if v is None or end is None or (ref_day - end).days > MAX_PERIOD_AGE_DAYS:
        return None
    return v


def accelerating(points, ref_ts: float, ref_day: date) -> Optional[bool]:
    """True when the newest quarter's y/y revenue growth in force at `ref_ts` is higher than the quarter
    before it (as it stood when that quarter was the newest), False when it is not, None when either is
    missing, a gap, too old, or the two quarter ends are not consecutive quarters."""
    known: list = []
    for p in points or ():
        try:
            t = float(p[0])
        except (TypeError, ValueError, IndexError):
            continue
        if t > ref_ts:
            break
        known.append(p)
    if not known:
        return None
    latest = in_force(known, ref_ts, ref_day)
    if latest is None:
        return None
    latest_end = _day(known[-1][2])
    prior = None
    for p in reversed(known[:-1]):
        end = _day(p[2]) if len(p) >= 3 else None
        if end is not None and end < latest_end:
            prior = p
            break
    if prior is None:
        return None
    prior_v = _finite(prior[1])
    gap = (latest_end - _day(prior[2])).days
    if prior_v is None or not ACCEL_GAP_DAYS[0] <= gap <= ACCEL_GAP_DAYS[1]:
        return None
    return latest > prior_v


def compose(metric: str, close: Optional[float], x: dict) -> Optional[float]:
    """A price-composed valuation (catalog COMPOSERS): P/E = close / EPS TTM; P/S = close x shares /
    revenue TTM; FCF yield = FCF TTM / (close x shares), in percent. None on a missing input or a zero or
    negative base."""
    c = _finite(close)
    if c is None or c <= 0:
        return None
    if metric == "pe_ttm":
        eps = _finite(x.get("eps_diluted_ttm"))
        return c / eps if eps is not None and eps > 0 else None
    shares = _finite(x.get("shares_outstanding"))
    if shares is None or shares <= 0:
        return None
    mcap = c * shares
    if metric == "ps_ttm":
        rev = _finite(x.get("revenue_ttm"))
        return mcap / rev if rev is not None and rev > 0 else None
    if metric == "fcf_yield":
        fcf = _finite(x.get("fcf_ttm"))
        return fcf / mcap * 100.0 if fcf is not None else None
    return None


def stock_fundamentals(metrics: dict, ref_ts: float, ref_day: date, close: Optional[float]) -> dict:
    """{metric id: value} for one company at one reference time, from its artifact's `metrics`. The
    acceleration answer rides as True / False under `ACCEL_ID`; a metric with no value is absent."""
    out: dict = {}
    metrics = metrics or {}
    for mid, series in STORED.items():
        v = in_force(metrics.get(series), ref_ts, ref_day)
        if v is not None:
            out[mid] = v
    acc = accelerating(metrics.get(STORED["revenue_growth_q"]), ref_ts, ref_day)
    if acc is not None:
        out[ACCEL_ID] = acc
    for mid, inputs in COMPOSED.items():
        x = {s: in_force(metrics.get(s), ref_ts, ref_day) for s in inputs}
        v = compose(mid, close, x)
        if v is not None:
            out[mid] = v
    return out


def close_on_or_before(closes, day: date, reach_days: int = CLOSE_REACH_DAYS) -> Optional[float]:
    """The last close dated on or before `day` and at most `reach_days` before it, from `[(ISO date,
    close)]` ascending; None when there is none."""
    want = day.isoformat()
    lo, hi = 0, len(closes)
    while lo < hi:                        # the first index whose date is after `day`
        mid = (lo + hi) // 2
        if closes[mid][0] <= want:
            lo = mid + 1
        else:
            hi = mid
    if lo == 0:
        return None
    d, c = closes[lo - 1]
    got = _day(d)
    if got is None or (day - got).days > reach_days:
        return None
    return _finite(c)


# ── group figures ────────────────────────────────────────────────────────────────────────────

def quantile(sorted_vals: list, p: float) -> float:
    """Linear interpolation between the closest ranks (numpy's default) over an ASCENDING list."""
    n = len(sorted_vals)
    pos = (n - 1) * p
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def _r(v: Optional[float], nd: int = 2) -> Optional[float]:
    return None if v is None else round(v, nd)


def summarize(values: Iterable) -> dict:
    """{n, median, q1, q3}: the median and the middle half of the finite values, or the count alone (each
    figure None) when fewer than `MIN_MEMBERS` members have one."""
    vals = sorted(v for v in (_finite(x) for x in values) if v is not None)
    n = len(vals)
    if n < MIN_MEMBERS:
        return {"n": n, "median": None, "q1": None, "q3": None}
    return {"n": n, "median": _r(quantile(vals, 0.5)), "q1": _r(quantile(vals, 0.25)), "q3": _r(quantile(vals, 0.75))}


def share(flags: Iterable) -> dict:
    """{n, count, share}: how many of the members with an answer said yes, and that share in percent
    (None with fewer than `MIN_MEMBERS` answers)."""
    n = k = 0
    for f in flags:
        if f is None:
            continue
        n += 1
        k += 1 if f else 0
    return {"n": n, "count": k, "share": round(k / n * 100.0, 1) if n >= MIN_MEMBERS else None}


def rank(values: dict) -> dict:
    """{name: {position, of}} for every name with a value: position 1 is the highest; equal values share
    a position (1, 2, 2, 4). A name with no value has no rank."""
    have = {k: v for k, v in values.items() if v is not None}
    ordered = sorted(have.values(), reverse=True)
    out = {}
    for k, v in have.items():
        out[k] = {"position": 1 + sum(1 for o in ordered if o > v), "of": len(ordered)}
    return out


# ── breadth ──────────────────────────────────────────────────────────────────────────────────

def tail(closes, keep: int = TAIL_SESSIONS) -> tuple:
    """`(day ordinals, closes)` of the newest `keep` stored closes, as compact arrays."""
    part = closes[-keep:] if keep else []
    days, vals = array("i"), array("d")
    for d, c in part:
        dd = _day(d)
        cc = _finite(c)
        if dd is None or cc is None:
            continue
        days.append(dd.toordinal())
        vals.append(cc)
    return days, vals


def sessions_from(day_counts: dict, priced: int) -> tuple:
    """(sessions ascending as day ordinals, the breadth session) from how many priced stocks hold a close on
    each day: a day is a session when at least `SESSION_SHARE` of them do, and the breadth session is the
    newest one at least `NEWEST_SHARE` of them have reached. ((), None) when nothing qualifies."""
    if priced <= 0:
        return (), None
    sessions = tuple(sorted(d for d, n in day_counts.items() if n >= SESSION_SHARE * priced))
    newest = next((d for d in reversed(sessions) if day_counts[d] >= NEWEST_SHARE * priced), None)
    if newest is None:
        return (), None
    return tuple(d for d in sessions if d <= newest), newest


def stock_breadth(days, vals, targets: dict, line_days) -> dict:
    """One stock's answers. `targets`: {label: session ordinal} (now, week, month); `line_days`: the line's
    sessions. Returns {label: {above20, above50, above200, near_high, new_high, new_low, move}, 'line':
    [above50 per line session]}, each answer True / False / None (None = no close that session, or not
    enough closes for the measure). `move` is +1 / 0 / -1 against the previous stored close."""
    pos = {d: i for i, d in enumerate(days)}
    n = len(vals)
    pre = [0.0] * (n + 1)
    for i in range(n):
        pre[i + 1] = pre[i] + vals[i]

    def above(i: int, w: int) -> Optional[bool]:
        if i is None or i < w - 1:
            return None
        return vals[i] > (pre[i + 1] - pre[i + 1 - w]) / w

    def at(i: Optional[int]) -> dict:
        if i is None:
            return {"above20": None, "above50": None, "above200": None, "near_high": None,
                    "new_high": None, "new_low": None, "move": None}
        out = {f"above{w}": above(i, w) for w in SMA_WINDOWS}
        if i >= HIGH_SESSIONS - 1:
            window = vals[i - HIGH_SESSIONS + 1:i + 1]
            prev = vals[i - HIGH_SESSIONS + 1:i]
            out["near_high"] = vals[i] >= NEAR_HIGH * max(window)
            out["new_high"] = vals[i] > max(prev)
            out["new_low"] = vals[i] < min(prev)
        else:
            out["near_high"] = out["new_high"] = out["new_low"] = None
        out["move"] = None if i < 1 else (1 if vals[i] > vals[i - 1] else -1 if vals[i] < vals[i - 1] else 0)
        return out

    res = {label: at(pos.get(d)) for label, d in targets.items()}
    res["line"] = [above(pos.get(d), 50) for d in line_days]
    res["held"] = pos.get(targets.get("now")) is not None
    return res


class BreadthTally:
    """One group's breadth, added to one stock at a time."""

    def __init__(self, line_len: int):
        self.flags = {label: {k: [] for k in (*BREADTH_SHARES, "new_high", "new_low")} for label, _ in OFFSETS}
        self.moves: list = []
        self.priced = 0
        self.line_above = [0] * line_len
        self.line_n = [0] * line_len

    def add(self, b: dict) -> None:
        now = b.get("now") or {}
        if b.get("held"):
            self.priced += 1
        for label, _ in OFFSETS:
            got = b.get(label) or {}
            for k, lst in self.flags[label].items():
                lst.append(got.get(k))
        self.moves.append(now.get("move"))
        for i, f in enumerate(b.get("line") or ()):
            if f is None:
                continue
            self.line_n[i] += 1
            self.line_above[i] += 1 if f else 0

    def result(self) -> dict:
        out = {}
        for k in BREADTH_SHARES:
            out[k] = {label: share(self.flags[label][k]) for label, _ in OFFSETS}
        highs = share(self.flags["now"]["new_high"])
        lows = share(self.flags["now"]["new_low"])
        out["new_highs"] = {"n": highs["n"], "count": highs["count"]}
        out["new_lows"] = {"n": lows["n"], "count": lows["count"]}
        out["net_highs"] = highs["count"] - lows["count"] if highs["n"] >= MIN_MEMBERS else None
        mv = [m for m in self.moves if m is not None]
        out["advance_decline"] = {"n": len(mv), "advancers": sum(1 for m in mv if m > 0),
                                  "decliners": sum(1 for m in mv if m < 0), "unchanged": sum(1 for m in mv if m == 0)}
        out["line"] = [round(a / n * 100.0, 1) if n >= MIN_MEMBERS else None
                       for a, n in zip(self.line_above, self.line_n)]
        out["priced"] = self.priced
        return out


def change_points(now: Optional[float], then: Optional[float]) -> Optional[float]:
    """The change between two shares, in percentage points; None when either is missing."""
    return None if now is None or then is None else round(now - then, 1)


# ── rank history (2026-11-22) ────────────────────────────────────────────────────────────────

#: bars back on a stock's own stored closes, from the RS rating's one table of them (never typed here a second time)
_RS_BARS = {label: bars for label, bars, _w in RS_TERMS}
#: the two measures a group is ranked by: the median 6-month change (the rank) and the median 3-month change
RANK_MEASURES = (("m6", _RS_BARS["6m"]), ("m3", _RS_BARS["3m"]))
RANK_PRIMARY = "m6"
RANK_WEEKS = 52                 # the weekly points before the newest session's week
RANK_BACK = (("w4", 4), ("w13", 13), ("w52", 52))   # the rank this many weekly points back, and the places moved since
#: closes kept per stock for the rank: 52 weeks of sessions, the longest lookback before the oldest point, a margin
RANK_TAIL = RANK_WEEKS * 5 + max(bars for _mid, bars in RANK_MEASURES) + 14
NAN = float("nan")


def _monday(o: int) -> int:
    return o - date.fromordinal(o).weekday()


def week_points(sessions) -> tuple:
    """The rank's points as day ordinals, oldest first: the last session of each of the `RANK_WEEKS` calendar weeks
    before the newest session's week (None for a week that holds no session), then the newest session. () when there
    are no sessions."""
    if not sessions:
        return ()
    newest = sessions[-1]
    this_week = _monday(newest)
    last_of: dict = {}
    for o in sessions:                    # ascending: the week's last session wins
        w = _monday(o)
        if w < this_week:
            last_of[w] = o
    return tuple(last_of.get(this_week - 7 * k) for k in range(RANK_WEEKS, 0, -1)) + (newest,)


def stock_changes(days, vals, points) -> array:
    """One stock's change at each point, in percent: `[each measure's value at every point]`, measure by measure in
    `RANK_MEASURES` order, NaN where there is none. At a point the stock needs a close dated that session; the change
    is that close against its own close `bars` stored sessions earlier, `rs_weighted_return.period_return` on the
    closes up to that day (nothing after the point is read). None with fewer closes or a base that is not positive."""
    p_n = len(points)
    out = array("d", [NAN]) * (len(RANK_MEASURES) * p_n)
    if not len(days):
        return out
    for j, p in enumerate(points):
        if p is None:
            continue
        i = bisect_right(days, p) - 1
        if i < 0 or days[i] != p:
            continue
        current = vals[i]
        for m, (_mid, bars) in enumerate(RANK_MEASURES):
            k = i - bars
            if k < 0:
                continue
            ref = vals[k]
            if ref > 0:
                out[m * p_n + j] = (current - ref) / ref * 100.0
    return out


def group_rank_history(members: dict, n_points: int) -> tuple:
    """Every group's median change and rank at each point, per measure. `members`: {group name: [each member's
    `stock_changes`]}. Returns ({name: {measure: {"rank": [...], "median": [...], "n": [...]}}}, {measure: [groups
    ranked at each point]}). A median needs `MIN_MEMBERS` members with a change at that point; the rank is `rank`
    over the unrounded medians of that point (highest first, ties share a place); the stored median is rounded."""
    out: dict = {name: {} for name in members}
    ofs: dict = {}
    for m, (mid, _bars) in enumerate(RANK_MEASURES):
        base = m * n_points
        exact: dict = {}
        for name, arrs in members.items():
            ns = [0] * n_points
            med: list = [None] * n_points
            for j in range(n_points):
                col = sorted(v for v in (a[base + j] for a in arrs) if v == v)       # NaN is not equal to itself
                ns[j] = len(col)
                if len(col) >= MIN_MEMBERS:
                    med[j] = quantile(col, 0.5)
            exact[name] = med
            out[name][mid] = {"rank": [None] * n_points, "median": [_r(v, 1) for v in med], "n": ns}
        of_line = [0] * n_points
        for j in range(n_points):
            for name, r in rank({name: exact[name][j] for name in members}).items():
                out[name][mid]["rank"][j] = r["position"]
                of_line[j] = r["of"]
        ofs[mid] = of_line
    return out, ofs


def rank_summary(ranks, ofs, ns, medians, dates) -> dict:
    """One group's rank on one measure: now (the last point), `RANK_BACK` points back with the change in places to now
    (positive = climbed), and its best and worst point (the most recent one on a tie). A point: {position (None when
    fewer than `MIN_MEMBERS` members have a change), of (groups ranked that week), n (members with a change), median,
    date}; a week with no session, or before the history, is None."""
    last = len(dates) - 1
    out: dict = {"now": None, **{label: None for label, _b in RANK_BACK}, "best": None, "worst": None, "weeks_ranked": 0}
    if last < 0:
        return out

    def point(i: int) -> dict:
        return {"position": ranks[i], "of": ofs[i], "n": ns[i], "median": medians[i], "date": dates[i]}

    now = out["now"] = point(last)
    for label, back in RANK_BACK:
        i = last - back
        if i < 0 or dates[i] is None:
            continue
        then = point(i)
        then["change"] = (then["position"] - now["position"]
                          if then["position"] is not None and now["position"] is not None else None)
        out[label] = then
    have = [i for i in range(last + 1) if ranks[i] is not None]
    if have:
        out["best"] = point(min(have, key=lambda i: (ranks[i], -i)))
        out["worst"] = point(max(have, key=lambda i: (ranks[i], i)))
    out["weeks_ranked"] = len(have)
    return out
