"""Days to the IPO lockup, this month's seasonality, the last report's 5-session drift, factor loadings and up / down
capture for the Screener: twelve columns worked out inside the nightly build's own per-stock bars pass, from the same
stored daily bars every other bar column of the row reads (and, for the drift, the report dates the build's one read of
the held earnings copies already holds). Never a vendor call, never a second read of the universe.

Every definition is the one a Terminal panel already prints, called here, never written a second time:

  days_to_lockup        IPO LOCKUP's estimate (`ipo_lockups.estimated_expiry`: the listing date plus `LOCKUP_DAYS`
                        calendar days, rolled forward to the next NYSE session), from the row's own listing date (the
                        IPO Date column), counted in calendar days from the row's date (as IPO LOCKUP counts
                        `days_to_go`). Negative = days since the estimated expiry, kept for IPO LOCKUP's own recent
                        window (`ipo_lockups.BEHIND_DAYS`). None with no listing date, a listing date after the row's
                        date, an expiry further back than that window, or a row that is not a common stock
                        (`LOCKUP_TYPE`, the Type column: IPO LOCKUP's list leaves funds out and the Screener's "Stock"
                        bucket is the reference data's common stock). Every value is an estimate: the prospectus sets
                        the real date and the server holds none.
  seas_month_avg, seas_month_up_pct, seas_month_years
                        SEAS's month (`seasonality.compute`): for the calendar month of the build's session (New York
                        time), the average month return and the share of up years, over every year the held bars cover
                        that month end to end, and how many years that is. A month is counted only when its last close
                        and the prior month's last close are both held; the month still running (the newest held) is
                        never one. All three None under SEAS's own minimum (`seasonality.MIN_YEARS` years: SEAS shows
                        those marked thin).
  post_earn_drift_5d    ERX's drift (`earnings_reaction_panel.quarter_rows`, its reacting-session choice and `DRIFT`):
                        for the newest reported quarter of the held earnings copy with a report date on or before the
                        build's session, the close `DRIFT` sessions after the reacting session over the reacting
                        session's close, in percent. None while those sessions have not traded ("pending" is never 0),
                        while the reacting session cannot be chosen yet (the session after the report date has not
                        traded), with no held copy, no dated report, or a copy that is behind (its own next report date
                        passed with no result in it: the last report would be the one before).
  factor_mkt, factor_size, factor_growth, factor_mom, factor_r2
                        FCTX's regression (`factor_exposure_calc.align` and `fit`) on the newest `WINDOW` daily returns
                        the stock and every fund of the model share, the model FCTX fits (all six factors, so each
                        loading equals FCTX's; quality and low volatility are fitted, not published here), with the
                        funds chosen by FCTX's rule (`factor_exposure_calc.FACTORS`' options, `fund_check`). A loading
                        is published only when FCTX shows it clearing its bar (`factor_exposure_calc.clears`: |t| above
                        `T_BAR`); one under the bar is None, never its estimate. `factor_growth` is FCTX's growth vs
                        value factor (positive = growth). R-squared is the share of the stock's daily variance the
                        factors explain (0 to 1). All None with fewer than `MIN_OBS` shared returns, a singular fit, or
                        no market fund.
  up_capture_1y, down_capture_1y
                        STAT's capture (`stock_stats_calc.beta_block`, `capture=True`): the stock's mean daily return on
                        the days SPY rose (fell) over SPY's mean on those days, x 100, over the trailing `beta.WINDOW`
                        returns both traded, against SPY's newest `stock_stats.BENCH_TAIL` closes as STAT reads them.
                        None with fewer than `beta.MIN_OBS` shared returns or fewer than `CAPTURE_MIN_DAYS` up (down)
                        days.

WHERE THE FUNDS COME FROM: `build_context`, ONCE per build: SPY is the build's own SPY read (the RS step's), the other
factor funds the same store read (`snapshot_builder._read_benchmark_bars`, current listing, cut at the build's session),
each turned into the closes FCTX and STAT read (`price_reads._closes_answer`: positive finite closes, one per date) and
cut to the newest closes FCTX reads (`factor_exposure.READ_SESSIONS`). An alternative fund is read only when the first is
not usable, exactly as FCTX does. Never a vendor call.

EACH ANSWER EQUALS THE PANEL'S on the same bars (tests/test_screener_row_columns.py proves each against the panel's own
code), from only the bars the answer reads, so the step costs a few milliseconds a row:
  * SEAS's months from the month-end closes only (`month_ends`: a month's return reads only its last close and the
    prior month's; one bisect per month over the build's sorted dates);
  * FCTX's newest window: when the stock's newest `WINDOW` + 1 closes fall on consecutive sessions every fund holds
    (nearly every stock, every night), `align`'s stock returns and spread columns are consecutive returns, and the
    spreads are worked out once per build (`shared_spreads`, `_fast_window`; bit for bit `align`'s); any other stock
    goes through `align` itself, over the newest `FACTOR_TAIL` bars and again over `READ_SESSIONS` when those hold
    fewer than `WINDOW` shared returns. The receipt counts each path (`factor_paths`). The regression is always
    `factor_exposure_calc.fit`;
  * STAT's capture from the stock's newest `CAPTURE_TAIL` bars (every bar inside SPY's held window when those hold
    fewer than `beta.WINDOW` shared returns), SPY cut to the stock's first date;
  * ERX's drift from the bars from just before the report date on.

A SERIES THAT CONTRADICTS ITSELF (`technicals.series_contradicts_itself`, the build's seam scan): each bar column whose
read reaches back to the newest seam is withheld, never computed across two price regimes (`volume_volatility`'s rule);
the build counts it. The months read the whole series and are withheld at any seam.

COST (measured 2026-11-24 on invented series, the dev PC shared with two other builders' test runs, not production; the
snapshot builder's receipt `stats["row_columns"]` carries the pod's own `ms_per_row`, each part's share and how many rows
took each factor path): about 8.8 ms of CPU per row over 200 invented 5,000-bar rows, so about 96 s over an 11,000-row
build; by part (wall) the factors 4.1 ms (about 45 s over 11,000 rows, every invented row on the fast path; through
`align` alone the same part measured 9.3 ms), capture 2.0, seasonality 1.6, drift 0.4, lockup 0.1. Memory: the one
context (seven invented 9,000-session funds read and cut to FCTX's depth) 0.11 s, peak 2.3 MB, 0.7 MB held through the
build; 0.17 MB of extra peak per row (one row at a time).
"""
from __future__ import annotations

import bisect
import math
import time
from datetime import date
from operator import itemgetter
from typing import Callable, Optional

import numpy as np

from api.services import factor_exposure_calc as FC
from api.services import seasonality as SEAS
from api.services import stock_stats_calc as SC
from api.services.fundamentals_pit import beta as BETA
from api.services.screener import volume_volatility as VV

#: snapshot columns, in the order the views show them
LOCKUP_COLUMNS = ("days_to_lockup",)
SEAS_COLUMNS = ("seas_month_avg", "seas_month_up_pct", "seas_month_years")
DRIFT_COLUMNS = ("post_earn_drift_5d",)
FACTOR_COLUMNS = ("factor_mkt", "factor_size", "factor_growth", "factor_mom", "factor_r2")
CAPTURE_COLUMNS = ("up_capture_1y", "down_capture_1y")
COLUMNS = LOCKUP_COLUMNS + SEAS_COLUMNS + DRIFT_COLUMNS + FACTOR_COLUMNS + CAPTURE_COLUMNS
#: the whole-number columns (the other nine are REAL)
INT_COLUMNS = ("days_to_lockup", "seas_month_up_pct", "seas_month_years")
#: the filter family the factor loadings and capture sit in (no existing family is about how a stock moves with the
#: market and the style funds)
FACTOR_CATEGORY = "factors_capture"
FACTOR_CATEGORY_LABEL = "Factors & Capture"
#: the filter category each column sits in (where a member looks for it)
CATEGORY = {"days_to_lockup": "events", "post_earn_drift_5d": "events",
            **{c: "performance" for c in SEAS_COLUMNS},
            **{c: FACTOR_CATEGORY for c in FACTOR_COLUMNS + CAPTURE_COLUMNS}}
#: the parts of the step, each timed apart in the receipt
PARTS = ("lockup", "seasonality", "drift", "factors", "capture")
#: the Type bucket a lockup is estimated for: the reference data's common stock (`screener_universe._coarse_type`)
LOCKUP_TYPE = "Stock"
#: FCTX factor key -> column: the loadings published (quality and low volatility are in the same model, not published)
FACTOR_LOADINGS = {"market": "factor_mkt", "size": "factor_size", "growth": "factor_growth",
                   "momentum": "factor_mom"}
#: the newest bars FCTX's newest window is first read from: a year of returns and room for a few sessions a fund did
#: not trade; read again over FCTX's own `READ_SESSIONS` when these hold fewer than `WINDOW` shared returns
FACTOR_TAIL = FC.WINDOW + 40
#: bars past the window the fast path reads, so a close or two it cannot count still leaves a full window
FAST_PAD = 5
#: the newest bars STAT's capture is first read from: a year of returns and a few sessions of room; read again over
#: every bar inside SPY's held window when these hold fewer than `beta.WINDOW` shared returns
CAPTURE_TAIL = BETA.WINDOW + 8
#: bars before the report date kept in the drift's slice (ERX's run-in and the session before it), so its session
#: choice reads what the whole history gives it
DRIFT_PAD = 7
#: an unbounded read (the months read the whole series)
WHOLE = 10 ** 9


def _t(b) -> int:
    """A bar's `t` as a YYYYMMDD int for bisecting (0 when it cannot be read: sorts first, never matches)."""
    return VV._ymd(b.get("t")) or 0


#: a bar's raw `t` (the month ends' fast path reads every bar's once, in C)
_T = itemgetter("t")


# ── the build's one context ──────────────────────────────────────────────────────────────────

def _closes(bars, key: Optional[str], tail: Optional[int] = None) -> list:
    """The closes FCTX and STAT read: `price_reads._closes_answer`'s `closes` (`[(YYYY-MM-DD, close)]`, a close that
    reads as a number above 0 and is not NaN, the last bar of a date kept, ascending), up to session `key`, the newest
    `tail` of them (None: all). Its own walk rather than a call only because the build's dates are YYYYMMDD ints, which
    it writes as text without `price_reads._iso`'s pattern match on every bar; tests/test_screener_row_columns.py holds
    the two answers equal on ordinary and broken bars alike."""
    from api.services.market_intel import price_reads as PR        # noqa: PLC0415 -- its date reader for text dates
    seen: dict = {}
    for b in bars or ():
        t = b.get("t")
        d = VV._iso(t) if type(t) is int else PR._iso(t)
        try:
            c = float(b.get("c"))
        except (TypeError, ValueError):
            continue
        if d and c > 0 and c == c:
            seen[d] = c
    out = [(d, c) for d, c in sorted(seen.items()) if key is None or d <= key]
    return out[-tail:] if tail else out


def choose_funds(key: str, spy_closes: list, read_closes: Callable[[str], list]) -> dict:
    """FCTX's fund set for session `key` (`factor_exposure.read_funds`' rule, over the build's own store read): each
    factor's first option whose every fund passes `factor_exposure_calc.fund_check`, else its alternative, else left
    out; no market fund, no model. SPY is the build's own read (`spy_closes`); every other fund is read once, only
    when it is looked at (`read_closes(sym)` -> its settled closes, newest `READ_SESSIONS`)."""
    checks: dict = {}
    series: dict = {}

    def usable(sym: str) -> bool:
        if sym not in checks:
            try:
                closes = spy_closes if sym == "SPY" else read_closes(sym)
                state = "ok"
            except Exception:  # noqa: BLE001 -- one fund's failed read is that fund's state, said in the receipt
                closes, state = [], "unavailable"
            checks[sym] = FC.fund_check(closes or [], key, state)
            if checks[sym]["state"] == "ok":
                series[sym] = closes
        return checks[sym]["state"] == "ok"

    chosen: dict = {}
    for f in FC.FACTORS:
        for option in f["options"]:
            if all([usable(s) for s in option]):            # a list: every fund of the option is looked at
                chosen[f["key"]] = option
                break
        if not chosen.get("market"):
            break                                           # no market fund, no model: the rest is not read
    used = {s for opt in chosen.values() for s in opt}
    series = {s: v for s, v in series.items() if s in used}
    legs = FC.legs_of(chosen) if chosen.get("market") else None
    return {"state": "ok" if legs else "unavailable", "key": key, "checks": checks, "chosen": chosen,
            "series": series, "legs": legs, "dates": {s: [d for d, _c in v] for s, v in series.items()},
            **(shared_spreads(series, legs) if legs else {})}


def shared_spreads(series: dict, legs: list) -> dict:
    """ONCE per build, for the fast path (`_fast_window`): the sessions every fund of the model holds, in order
    (`pos`: date -> place), and each leg's daily return spread between consecutive ones (`spreads`, one row per return,
    into the later session; a column per leg in `legs`' order), worked out with `beta.aligned_returns`' arithmetic
    (close over close less 1) and `factor_exposure_calc.align`'s spread (the long fund's return less the short fund's).
    For a stock whose sessions are an unbroken run of these, they are `align`'s own columns, bit for bit."""
    syms = sorted({s for _k, a, b in legs for s in (a, b) if s})
    shared = sorted(set.intersection(*(set(d for d, _c in series[s]) for s in syms)))
    if len(shared) < 2:
        return {"pos": {}, "spreads": np.zeros((0, len(legs))), "keys": [k for k, _a, _b in legs]}
    rets = {}
    for s in syms:
        at = dict(series[s])
        cl = [at[d] for d in shared]
        rets[s] = [b1 / b0 - 1.0 for b0, b1 in zip(cl, cl[1:])]
    cols = [[ra - rb for ra, rb in zip(rets[a], rets[b])] if b else list(rets[a]) for _k, a, b in legs]
    return {"pos": {d: i for i, d in enumerate(shared)},
            "spreads": np.array(cols, dtype=float).T.reshape(len(shared) - 1, len(legs)),
            "keys": [k for k, _a, _b in legs]}


def build_context(session: Optional[date], spy_bars, read_bars: Optional[Callable[[str], list]] = None,
                  today: Optional[date] = None) -> dict:
    """ONCE per build: the session's month, the row's date, SPY's closes as STAT reads them, FCTX's fund set (the
    other funds read through `read_bars(sym)` -> bar dicts, only when looked at), the reports map `reports` the
    earnings read fills, and the step's counters (its receipt)."""
    from api.services import factor_exposure as FX                 # noqa: PLC0415 -- FCTX's read depth only
    from api.services import stock_stats as STAT                   # noqa: PLC0415 -- STAT's SPY depth only
    t0 = time.perf_counter()
    key = session.isoformat() if session else None
    ctx = {"session": key, "month": session.month if session else None, "today": today or date.today(),
           "reports": {}, "spy_stat": [], "factors": None, "rows": 0, "ms": 0.0, "seam_withheld": 0,
           "part_ms": {p: 0.0 for p in PARTS}, "factor_paths": {"fast": 0, "align": 0}}
    if key is not None:
        ctx["spy_stat"] = _closes(spy_bars, key, STAT.BENCH_TAIL)
        ctx["spy_dates"] = [d for d, _c in ctx["spy_stat"]]
        spy_fx = _closes(spy_bars, key, FX.READ_SESSIONS)
        ctx["factors"] = choose_funds(
            key, spy_fx, lambda sym: _closes(read_bars(sym) if read_bars else [], key, FX.READ_SESSIONS))
        ctx["read_depth"] = FX.READ_SESSIONS
    ctx["context_ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
    return ctx


def receipt(ctx: Optional[dict]) -> dict:
    """What the step did, counts and time only (the closes and the reports stay out)."""
    ctx = ctx or {}
    rows = ctx.get("rows") or 0
    ms = round(ctx.get("ms") or 0.0, 1)
    fx = ctx.get("factors") or {}
    return {"session": ctx.get("session"), "month": ctx.get("month"),
            "today": ctx["today"].isoformat() if isinstance(ctx.get("today"), date) else None,
            "spy_closes": len(ctx.get("spy_stat") or ()), "reports": len(ctx.get("reports") or ()),
            "funds_state": fx.get("state"), "funds": {k: list(v) for k, v in (fx.get("chosen") or {}).items()},
            "fund_checks": {s: c.get("state") for s, c in (fx.get("checks") or {}).items()},
            "context_ms": ctx.get("context_ms"), "rows": rows, "ms": ms,
            "ms_per_row": round(ms / rows, 3) if rows else None,
            "part_ms": {p: round(v, 1) for p, v in (ctx.get("part_ms") or {}).items()},
            "factor_paths": dict(ctx.get("factor_paths") or {}),
            "seam_withheld": ctx.get("seam_withheld") or 0}


# ── the five families, one row ───────────────────────────────────────────────────────────────

def lockup_fields(ipo_date, security_type, today: date) -> dict:
    """`{days_to_lockup}` by IPO LOCKUP's rule, or {} (see the module docstring)."""
    from api.services import ipo_lockups as IPO                    # noqa: PLC0415 -- IPO LOCKUP's own rule
    if security_type != LOCKUP_TYPE:
        return {}
    listing = IPO._ymd(ipo_date)
    if listing is None or listing > today:
        return {}
    expiry = IPO.estimated_expiry(listing)
    if expiry is None:
        return {}
    days = (expiry - today).days
    if days < -IPO.BEHIND_DAYS:
        return {}
    return {"days_to_lockup": days}


def _seas_close(b) -> Optional[float]:
    """A bar's close as SEAS counts it (`seasonality._clean`: readable as a number and above 0), else None."""
    try:
        c = float(b.get("c"))
    except (TypeError, ValueError, AttributeError):
        return None
    return c if c > 0 else None


def month_ends(bars, months=None) -> list:
    """Each held month's last bar with a close SEAS would count (`seasonality._clean`'s test: a readable date, a close
    above 0), as `{t, c}`, oldest month first: the only closes SEAS's month returns read, so `seasonality.compute` over
    these gives the whole series' months.

    `months` (a set of calendar months): only those months' ends, plus the newest month end (SEAS skips the newest
    held month as still running, so it must stay the newest): exactly the whole list with every other month left out.

    The build's own series (YYYYMMDD ints, ascending, as the store hands them) takes the fast path: one bisect per
    month over the dates, never a step per bar. Anything else (text dates, an unsorted list) takes the general one."""
    bars = bars or []
    try:
        ts = list(map(_T, bars))
    except (KeyError, TypeError, AttributeError):
        return _keep_months(_month_ends_any(bars), months)
    if not (ts and set(map(type, ts)) == {int} and 10_000_000 <= ts[0] and ts[-1] <= 99_999_999
            and ts == sorted(ts)):
        return _keep_months(_month_ends_any(bars), months)
    n = len(ts)
    if months is None:
        out, lo = [], 0
        while lo < n:
            hi = bisect.bisect_right(ts, ts[lo] // 100 * 100 + 99, lo)     # past this month's last bar
            end = _month_end(bars, ts, hi, ts[lo] // 100)
            if end:
                out.append(end)
            lo = hi
        return out
    out = []
    for y in range(ts[0] // 10_000, ts[-1] // 10_000 + 1):
        for mo in sorted(months):
            ym = y * 100 + mo
            end = _month_end(bars, ts, bisect.bisect_right(ts, ym * 100 + 99), ym)
            if end:
                out.append(end)
    newest = _month_end(bars, ts, n, None)
    if newest and (not out or newest["t"] != out[-1]["t"]):
        out.append(newest)
    return out


def _month_end(bars, ts, hi: int, ym: Optional[int]) -> Optional[dict]:
    """The last bar before `hi` with a close SEAS counts, inside month `ym` (YYYYMM; None: any month), as `{t, c}`."""
    for i in range(hi - 1, -1, -1):                                       # a later bar of the month wins
        if ym is not None and ts[i] // 100 != ym:
            return None
        c = _seas_close(bars[i])
        if c is not None:
            return {"t": ts[i], "c": c}
    return None


def _keep_months(ends: list, months) -> list:
    """`month_ends`' `months` rule over a whole list: those months' ends and the newest end."""
    if months is None:
        return ends
    return [e for e in ends[:-1] if _month_of(e["t"]) in months] + ends[-1:]


def _month_ends_any(bars) -> list:
    """`month_ends` for any list: one step per bar."""
    best: dict = {}
    for b in bars or ():
        t = b.get("t")
        if type(t) is int:                                          # the store's own shape: no text round trip
            if not 10_000_000 <= t <= 99_999_999:
                continue
            ym, day = t // 100, t
        else:
            d = SEAS._ymd(t)
            if not d:
                continue
            ym, day = d[0] * 100 + d[1], d[0] * 10_000 + d[1] * 100 + d[2]
        c = _seas_close(b)
        if c is None:
            continue
        cur = best.get(ym)
        if cur is None or day >= cur[0]:                            # a later bar of the month wins, as SEAS's sort
            best[ym] = (day, t, c)
    return [{"t": best[k][1], "c": best[k][2]} for k in sorted(best)]


def _month_of(t) -> Optional[int]:
    """The calendar month of a month end's `t` (a YYYYMMDD int, or a date SEAS reads)."""
    if type(t) is int:
        return t // 100 % 100
    d = SEAS._ymd(t)
    return d[1] if d else None


def seasonality_fields(bars_full, month: Optional[int]) -> dict:
    """`{seas_month_avg, seas_month_up_pct, seas_month_years}` for calendar month `month` from SEAS's months, or {}
    (no month, or fewer than SEAS's minimum years)."""
    if not month or not bars_full:
        return {}
    # SEAS's figure for `month` reads only the month-ends of `month` and the month before it, and SEAS never counts
    # the newest held month (it may still be running): those are all `compute` is handed, so its answer for `month`
    # is the whole series' (its other eleven months are not this column's)
    m = SEAS.compute(month_ends(bars_full, {month, (month - 2) % 12 + 1}))["months"]
    got = m[month - 1] if len(m) >= month else None
    if not got or got["n"] < SEAS.MIN_YEARS or got["avg_pct"] is None:
        return {}
    return {"seas_month_avg": got["avg_pct"], "seas_month_up_pct": got["pct_up"], "seas_month_years": got["n"]}


def drift_fields(bars_full, report: Optional[dict]) -> tuple[dict, int]:
    """`({post_earn_drift_5d}, bars read)` by ERX's rule for one report `{report_date, label}`, or `({}, bars read)`."""
    from api.services import earnings_reaction_panel as ERX        # noqa: PLC0415 -- ERX's own rule
    day = (report or {}).get("report_date")
    ymd = VV._ymd(str(day or "").replace("-", ""))
    if not bars_full or ymd is None:
        return {}, 0
    at = bisect.bisect_left(bars_full, ymd, key=_t)
    lo = max(0, at - DRIFT_PAD)
    window = [{"t": VV._iso(b.get("t")), "o": b.get("o"), "c": b.get("c")} for b in bars_full[lo:]]
    reach = len(bars_full) - max(0, at - 1)
    rows = ERX.quarter_rows([{"reported": True, "report_date": str(day)[:10], "label": report.get("label")}],
                            window, limit=1)
    r = rows[0] if rows else {}
    if r.get("drift_state") != "measured" or r.get("drift_pct") is None:
        return {}, reach
    return {"post_earn_drift_5d": r["drift_pct"]}, reach


def _fast_window(bars_full, fx: dict) -> Optional[tuple]:
    """`(dates, y, f, keys, bars read)` of FCTX's newest window without `align`, or None (take `align`).

    It applies only when the stock's newest `WINDOW` + 1 closes fall on consecutive sessions every fund of the model
    holds (`shared_spreads`' `pos`): then those are the newest shared sessions of `align`, a return spans two
    consecutive ones, and `align`'s stock returns and spread columns are these, worked out with the same arithmetic.
    Any other stock (a session a fund lacks, a gap of its own, a value that is not finite) is read by `align`."""
    pos, spreads = fx.get("pos"), fx.get("spreads")
    need = FC.WINDOW + 1
    if not pos or spreads is None or len(bars_full) < need:
        return None
    tail = bars_full[-(need + FAST_PAD):]
    win = _closes(tail, fx["key"])[-need:]
    if len(win) < need:
        return None
    p0 = pos.get(win[0][0])
    if p0 is None or any(pos.get(d) != p0 + k for k, (d, _c) in enumerate(win)):
        return None
    y = [c1 / c0 - 1.0 for (_d0, c0), (_d1, c1) in zip(win, win[1:])]
    f = spreads[p0:p0 + FC.WINDOW]
    if len(f) != FC.WINDOW or not all(map(math.isfinite, y)) or not np.isfinite(f).all():
        return None
    return [d for d, _c in win[1:]], np.array(y, dtype=float), f, list(fx["keys"]), len(tail)


def factor_inputs(bars_full, ctx: Optional[dict]) -> Optional[tuple]:
    """`(dates, y, f, keys, bars read, path)`: the newest `WINDOW` shared returns FCTX fits, through the fast path when
    it applies (`_fast_window`), else through `factor_exposure_calc.align` itself (first over the newest `FACTOR_TAIL`
    bars, again over FCTX's `READ_SESSIONS` when those hold fewer than `WINDOW`). None without a market fund."""
    fx = (ctx or {}).get("factors") or {}
    if fx.get("state") != "ok" or not bars_full:
        return None
    fast = _fast_window(bars_full, fx)
    if fast is not None:
        return (*fast, "fast")
    key, legs, series, dates_of = fx["key"], fx["legs"], fx["series"], fx["dates"]
    depth = ctx.get("read_depth") or FACTOR_TAIL
    for n in (FACTOR_TAIL, depth):
        stock = _closes(bars_full[-n:], key)
        if not stock:
            return [], np.zeros(0), np.zeros((0, len(legs))), [k for k, _a, _b in legs], 0, "align"
        first = stock[0][0]
        # every fund from the stock's first date on: the shared sessions are the stock's, so the cut changes nothing
        cut = {s: v[bisect.bisect_left(dates_of[s], first):] for s, v in series.items()}
        dates, y, f, keys = FC.align(stock, cut, legs)
        if len(y) >= FC.WINDOW or n >= depth or len(bars_full) <= n:
            break
    return dates[-FC.WINDOW:], y[-FC.WINDOW:], f[-FC.WINDOW:], keys, min(n, len(bars_full)), "align"


def factor_fields(bars_full, ctx: Optional[dict]) -> tuple[dict, int]:
    """`({factor_mkt?, factor_size?, factor_growth?, factor_mom?, factor_r2}, bars read)` from FCTX's regression
    (`factor_exposure_calc.fit`) over the newest `WINDOW` shared returns, or `({}, bars read)`."""
    got = factor_inputs(bars_full, ctx)
    if got is None:
        return {}, 0
    dates, y, f, keys, reach, path = got
    paths = ctx.get("factor_paths")
    if paths is not None:
        paths[path] = paths.get(path, 0) + 1
    block, _raw = FC.fit(dates, y, f, keys)
    if block.get("state") != "ok":
        return {}, reach
    out = {}
    if block.get("r2") is not None:
        out["factor_r2"] = block["r2"]
    for r in block["loadings"]:
        col = FACTOR_LOADINGS.get(r["key"])
        if col and r.get("clears") and r.get("loading") is not None:
            out[col] = r["loading"]
    return out, reach


def capture_fields(bars_full, ctx: Optional[dict]) -> tuple[dict, int]:
    """`({up_capture_1y?, down_capture_1y?}, bars read)` from STAT's capture against SPY, or `({}, bars read)`."""
    bench = (ctx or {}).get("spy_stat") or []
    if not bench or not bars_full:
        return {}, 0
    dates = ctx.get("spy_dates") or [d for d, _c in bench]
    at = bisect.bisect_left(bars_full, int(bench[0][0].replace("-", "")), key=_t)
    for start in (max(at, len(bars_full) - CAPTURE_TAIL), at):
        stock = SC.closes_of(VV.stat_bars(bars_full[start:]))
        if not stock:
            return {}, len(bars_full) - start
        # SPY from the stock's first date on: only the stock's own dates are ever matched, so the cut changes nothing
        got = SC.beta_block(stock, bench[bisect.bisect_left(dates, stock[0][0]):], capture=True)
        if got.get("returns", got.get("held", 0)) >= BETA.WINDOW or start == at:
            break
    reach = len(bars_full) - start
    if got.get("state") != "ok":
        return {}, reach
    out = {}
    for col, k in (("up_capture_1y", "up_capture"), ("down_capture_1y", "down_capture")):
        v = got.get(k)
        if v is not None and math.isfinite(v):
            out[col] = v
    return out, reach


def row_fields(bars_full, ctx: Optional[dict] = None, *, ticker: str = "", ipo_date=None, security_type=None,
               seam_since: Optional[int] = None) -> dict:
    """The twelve columns for one row (every key present, None where it cannot be said).

    `bars_full` is the build's sanitized deep series, `ctx` the build's `build_context` (None: only the lockup, counted
    from today), `seam_since` the bars since the newest seam of a series that contradicts itself (None for an ordinary
    series). A column whose read reaches the seam is withheld."""
    out = {c: None for c in COLUMNS}
    ctx = ctx if ctx is not None else {}
    timing = ctx.get("part_ms")
    today = ctx.get("today") or date.today()

    def timed(part, fn):
        t0 = time.perf_counter()
        try:
            return fn()
        finally:
            if timing is not None:
                timing[part] = timing.get(part, 0.0) + (time.perf_counter() - t0) * 1000.0

    out.update(timed("lockup", lambda: lockup_fields(ipo_date, security_type, today)))
    reached: dict = {}
    seas = timed("seasonality", lambda: seasonality_fields(bars_full, ctx.get("month")))
    out.update(seas)
    reached[SEAS_COLUMNS] = WHOLE
    report = (ctx.get("reports") or {}).get(str(ticker or "").upper())
    drift, reached[DRIFT_COLUMNS] = timed("drift", lambda: drift_fields(bars_full, report))
    out.update(drift)
    fac, reached[FACTOR_COLUMNS] = timed("factors", lambda: factor_fields(bars_full, ctx))
    out.update(fac)
    cap, reached[CAPTURE_COLUMNS] = timed("capture", lambda: capture_fields(bars_full, ctx))
    out.update(cap)
    if seam_since is not None:
        for cols, reach in reached.items():
            if reach > seam_since:
                for c in cols:
                    out[c] = None
    return out
