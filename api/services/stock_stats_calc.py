"""STAT, the pure half: one stock's statistical profile from its stored daily bars. No I/O, no
clock, no store: lists in, dicts out. `api/services/stock_stats.py` reads the bars and holds the
answers.

Every number here is computed from UCT's stored daily bars (split-adjusted, not dividend-adjusted:
PRICE returns), and every definition below is the one already used elsewhere on the site wherever
one exists. A statistic the history is too short for is `None` with what it needs, never 0.

1. VOLATILITY AND RANGE (the newest held session)
   ATR             Wilder's ATR(14) through `indicator_compute.compute_atr_raw` (the chart's and the
                   Screener's), over the newest `ATR_SEED_BARS` (400) sessions, the window the
                   Screener's row is built on, so the percent equals the Screener's `atr_pct`.
                   In dollars and as a percent of the newest close. Needs 15 sessions.
   realized vol    `realized_vol.annualized_hv` (the sample standard deviation of daily log
                   returns, x sqrt(252)) over the last 20 and 60 returns. Needs 21 / 61 sessions.
   ADR, 52 weeks,  the Screener's own `technicals.compute_technicals` over the same 400 sessions:
   rel. volume     ADR% (mean of (high - low) / close over 21 sessions), the distance from the
                   52-week high and low (intraday high / low of the last 252 sessions), relative
                   volume (`technicals.volume_ratio`: the newest session's volume over the mean of
                   the 30 sessions before it) and the 50-session average volume. ADR in dollars is
                   the mean of (high - low) over the same 21 sessions.
   avg volume 20   the mean of the last 20 sessions' volume (`technicals._mean_volume`'s rule: any
                   missing volume in the window and there is no average).
   up / down days  the share of daily close-to-close returns over the last year (sessions after the
                   same calendar day 12 months before the newest one) that rose, fell, or were flat.
                   Needs a held close on or before that day.
2. BETA AND CORRELATION (`fundamentals_pit.beta`, the declared Beta methodology)
   the trailing `beta.WINDOW` (252) daily returns on the days BOTH symbols traded
   (`beta.aligned_returns`), at least `beta.MIN_OBS` (200): beta = cov / var of the benchmark (OLS
   slope), correlation = cov / (sd stock x sd benchmark); versus SPY and versus the stock's sector
   fund. UP-CAPTURE: the stock's mean daily return on the days SPY rose over SPY's mean on those
   days, x 100 (DOWN-CAPTURE the same on the days SPY fell), over the same aligned returns, with at
   least `CAPTURE_MIN_DAYS` (20) such days. Daily, not the monthly convention fund reports use: one
   year holds only 12 months (the builder's default).
3. RETURNS
   1W is from the last close on or before the same day 7 calendar days earlier; 1M, 3M, 6M, 1Y, 3Y
   and 5Y from the last close on or before the same calendar day that many months earlier; YTD from
   the last close of the previous calendar year. A base close more than `MAX_GAP_DAYS` (10) before
   its day is a hole in the history, not a base. 3Y and 5Y also carry the yearly (compound) rate.
   BEST / WORST DAY: the largest and smallest close-to-close return; BEST / WORST WEEK: calendar
   (ISO) weeks, the week's last close over the previous week's last close (the newest week only once
   it has ended; a week after a week with no close is skipped). Both over the last year (as above)
   and over all held history. A tie goes to the earlier date. One that holds a move of more than 40%
   in one session (`price_reads.SUSPECT_JUMP`) is marked: it can be a split the history did not adjust.
4. ITS OWN DRAWDOWNS: `market_history_calc.find_episodes` (MKTH's one definition and finder) on the
   stock's closes, keeping the declines MKTH would call a bear market (`DRAWDOWN_MIN`, 20% or more,
   judged on the unrounded depth): a peak is a record close, a decline runs until the peak is
   regained, its trough is the lowest close inside it, and a double bottom is one decline. Each row
   says what `describe_episodes` says of a decline (depth, sessions down, the day the peak was
   regained or "not yet", sessions to recover), without the index rally it adds.
5. IN EVERY MARKET CORRECTION: for each S&P 500 decline MKTH found (its held answer, never a
   second correction finder) whose peak lies inside the stock's history:
     its drawdown   the deepest fall of the stock's closes inside the index's own window (the index
                    peak's session to the index low's), from the highest close in the window so far
     vs the index   that drawdown over the index's depth (1.5 means it fell one and a half times as
                    far) and the difference in percentage points
     new high first the first close after the index peak at or above the stock's 52-week closing
                    high on the index peak's day (the highest of the `NEW_HIGH_SESSIONS` (252)
                    sessions ending there), against the day the index regained its peak (the
                    builder's default reading of "a new high"; needs 252 sessions before the peak)
     3 months after the stock's return from the index low's session to the session MKTH measured the
                    index's 3-month rally at (the first index close on or after the same day 3
                    months later), less the index's return over the same two dates
"""
from __future__ import annotations

import bisect
import math
import statistics
from datetime import date, timedelta
from typing import Callable, Iterable, Optional

from api.services import market_history_calc as MH
from api.services.fundamentals_pit import beta as BETA
from api.services.realized_vol import METHOD as HV_METHOD, annualized_hv
from api.services.session_calendar import add_months

#: Wilder ATR period
ATR_PERIOD = 14
#: sessions the ATR and the Screener's columns are computed over (snapshot_builder: `bars[-400:]`)
ATR_SEED_BARS = 400
#: realized volatility windows, in daily returns
RV_SESSIONS = (20, 60)
#: average volume windows, in sessions
VOLUME_SESSIONS = (20, 50)
#: the ADR window (the Screener's `adr_pct`)
ADR_SESSIONS = 21
#: relative volume's base: the sessions before the newest one (`technicals.volume_ratio`'s window)
RELVOL_BASE = 30
#: the 52-week window, in sessions
YEAR_SESSIONS = 252
#: "the last year": sessions after the same calendar day this many months before the newest
YEAR_MONTHS = 12
#: a base close this many calendar days or more before the day it stands for is a hole, not a base
MAX_GAP_DAYS = 10
#: the trailing returns: (key, plain label, kind, amount)
RETURN_PERIODS = (
    ("1W", "1 week", "days", 7), ("1M", "1 month", "months", 1), ("3M", "3 months", "months", 3),
    ("6M", "6 months", "months", 6), ("YTD", "Year to date", "ytd", None), ("1Y", "1 year", "months", 12),
    ("3Y", "3 years", "months", 36), ("5Y", "5 years", "months", 60),
)
#: up / down capture needs at least this many up (and down) benchmark days
CAPTURE_MIN_DAYS = 20
#: a drawdown of the stock counts from this deep (MKTH's bear-market line)
DRAWDOWN_MIN = MH.BEAR_MIN
#: the drawdowns listed, newest first (the answer says how many there were)
DRAWDOWNS_SHOWN = 40
#: sessions the stock's 52-week closing high is read over, ending on the index peak's day
NEW_HIGH_SESSIONS = 252
#: the rally window (calendar months, one of MKTH's `RALLY_MONTHS`) the stock is compared over
AFTER_MONTHS = 3
#: a one-session move larger than this is marked "check the chart" (`price_reads.SUSPECT_JUMP`)
SUSPECT_JUMP = 0.40

_INF = float("inf")


def pct(x: Optional[float], nd: int = 2) -> Optional[float]:
    """A fraction as percent units (0.12345 -> 12.35); None stays None."""
    return None if x is None else round(x * 100.0, nd)


def r2(x: Optional[float], nd: int = 2) -> Optional[float]:
    return None if x is None else round(x, nd)


def _d(s: str) -> date:
    return date.fromisoformat(s)


def _short(needed: int, held: int, unit: str = "sessions") -> dict:
    return {"state": "short", "needed": needed, "held": held, "unit": unit}


def clean_bars(rows: Iterable) -> list[tuple]:
    """`[(YYYY-MM-DD, o, h, l, c, v)]` ascending, one per date (the last wins): positive finite
    prices with the high at or above the low; a volume that is not a finite number >= 0 is None
    (never 0). Anything else is dropped, never repaired."""
    seen: dict[str, tuple] = {}
    for row in rows or []:
        try:
            d, o, h, lo, c = row[0], float(row[1]), float(row[2]), float(row[3]), float(row[4])
        except (TypeError, ValueError, IndexError):
            continue
        # NaN fails every comparison, so these also refuse it
        if not (type(d) is str and len(d) == 10 and 0 < lo <= h < _INF and 0 < o < _INF and 0 < c < _INF):
            continue
        v = row[5] if len(row) > 5 else None
        if type(v) not in (int, float) or not 0 <= v < _INF:     # a bool is not a volume
            v = None
        seen[d] = (d, o, h, lo, c, v)
    return [seen[k] for k in sorted(seen)]


def closes_of(bars: list[tuple]) -> list[tuple[str, float]]:
    return [(b[0], b[4]) for b in bars]


def jumps_of(closes: list[tuple[str, float]]) -> list[str]:
    """Dates whose close moved more than `SUSPECT_JUMP` from the one before (as `price_reads`)."""
    return [closes[i][0] for i in range(1, len(closes)) if abs(closes[i][1] / closes[i - 1][1] - 1.0) > SUSPECT_JUMP]


def year_start(last: str) -> str:
    """The day "the last year" starts after: the same calendar day `YEAR_MONTHS` months before."""
    return add_months(_d(last), -YEAR_MONTHS).isoformat()


def _as_dicts(bars: list[tuple]) -> list[dict]:
    return [{"t": d, "o": o, "h": h, "l": lo, "c": c, "v": v} for d, o, h, lo, c, v in bars]


# ── 1. volatility and range ─────────────────────────────────────────────────────────────────────

def volatility(bars: list[tuple]) -> dict:
    """Section 1 from `clean_bars` output (ascending). Each block is `{state: 'ok', ...}` or a
    `_short` block saying what it needs."""
    from api.services import indicator_compute
    from api.services.screener import technicals

    n = len(bars)
    last_d, _o, _h, _l, last_c, last_v = bars[-1]
    seed = _as_dicts(bars[-ATR_SEED_BARS:])
    out: dict = {"as_of": last_d, "close": r2(last_c, 4), "sessions": n}

    if len(seed) >= ATR_PERIOD + 1:
        atr = indicator_compute.compute_atr_raw(seed, ATR_PERIOD)[-1]
        out["atr"] = ({"state": "ok", "period": ATR_PERIOD, "value": r2(atr, 4), "pct": pct(atr / last_c)}
                      if atr is not None else _short(ATR_PERIOD + 1, n))
    else:
        out["atr"] = _short(ATR_PERIOD + 1, n)

    closes = [b[4] for b in bars]
    rv = []
    for k in RV_SESSIONS:
        if len(closes) >= k + 1:
            v = annualized_hv(closes[-(k + 1):])
            rv.append({"state": "ok", "sessions": k, "pct": pct(v, 1)} if v is not None else {**_short(k + 1, n), "sessions": k})
        else:
            rv.append({**_short(k + 1, n), "sessions": k})
    out["realized"] = rv
    out["realized_method"] = HV_METHOD

    tech = technicals.compute_technicals(seed)
    if tech.get("adr_pct") is not None:
        window = seed[-ADR_SESSIONS:]
        out["adr"] = {"state": "ok", "sessions": ADR_SESSIONS, "pct": tech["adr_pct"],
                      "dollars": r2(sum(b["h"] - b["l"] for b in window) / len(window), 4)}
    else:
        out["adr"] = _short(ADR_SESSIONS, n)

    if tech.get("dist_52w_high_pct") is not None and n >= YEAR_SESSIONS:
        yr = bars[-YEAR_SESSIONS:]
        hi = max(yr, key=lambda b: (b[2], b[0]))      # the newest of equal highs
        lo = min(yr, key=lambda b: (b[3], b[0]))
        out["range_52w"] = {"state": "ok", "high": r2(hi[2], 4), "high_date": hi[0], "low": r2(lo[3], 4),
                            "low_date": lo[0], "from_high_pct": tech["dist_52w_high_pct"],
                            "from_low_pct": tech["dist_52w_low_pct"]}
    else:
        out["range_52w"] = _short(YEAR_SESSIONS, n)

    vols = [b["v"] for b in seed]
    avgs = {}
    for k in VOLUME_SESSIONS:
        m = technicals._mean_volume(vols, k)
        avgs[str(k)] = None if m is None else round(m)
    out["volume"] = {
        "last": None if last_v is None else round(last_v), "last_date": last_d,
        # the full base only: `volume_ratio` itself answers from fewer sessions
        "avg": avgs, "rel": technicals.volume_ratio(seed, RELVOL_BASE) if len(seed) > RELVOL_BASE else None,
        "rel_base_sessions": RELVOL_BASE,
    }

    start = year_start(last_d)
    if bars[0][0] <= start:
        rets = [bars[i][4] / bars[i - 1][4] - 1.0 for i in range(1, n) if bars[i][0] > start]
        up = sum(1 for r in rets if r > 0)
        down = sum(1 for r in rets if r < 0)
        tot = len(rets)
        out["days_1y"] = {"state": "ok", "from": start, "total": tot, "up": up, "down": down, "flat": tot - up - down,
                          "up_pct": pct(up / tot, 1) if tot else None, "down_pct": pct(down / tot, 1) if tot else None}
    else:
        out["days_1y"] = {"state": "short", "needed_from": start, "held_from": bars[0][0]}
    return out


# ── 2. beta and correlation ─────────────────────────────────────────────────────────────────────

def beta_block(stock: list[tuple[str, float]], bench: list[tuple[str, float]], capture: bool = False) -> dict:
    """Beta and correlation of `stock` against `bench` over the trailing `beta.WINDOW` aligned
    daily returns (`beta.aligned_returns`, at least `beta.MIN_OBS`); with `capture`, up and down
    capture too. Inputs ascending `[(date, close)]`."""
    rets = BETA.aligned_returns(stock, bench)[-BETA.WINDOW:]
    n = len(rets)
    if n < BETA.MIN_OBS:
        return {"state": "short", "needed": BETA.MIN_OBS, "held": n, "unit": "returns"}
    rs = [r[1] for r in rets]
    rb = [r[2] for r in rets]
    ms, mb = sum(rs) / n, sum(rb) / n
    cov = sum((a - ms) * (b - mb) for a, b in zip(rs, rb)) / (n - 1)
    var_b = sum((b - mb) ** 2 for b in rb) / (n - 1)
    var_s = sum((a - ms) ** 2 for a in rs) / (n - 1)
    out = {"state": "ok", "returns": n, "from": rets[0][0], "to": rets[-1][0],
           "beta": r2(cov / var_b, 3) if var_b > 0 else None,
           "correlation": r2(cov / math.sqrt(var_s * var_b), 3) if var_s > 0 and var_b > 0 else None}
    if capture:
        for key, keep in (("up_capture", lambda b: b > 0), ("down_capture", lambda b: b < 0)):
            pairs = [(a, b) for a, b in zip(rs, rb) if keep(b)]
            mean_b = sum(b for _a, b in pairs) / len(pairs) if pairs else 0.0
            out[key] = (r2(sum(a for a, _b in pairs) / len(pairs) / mean_b * 100.0, 1)
                        if len(pairs) >= CAPTURE_MIN_DAYS and mean_b else None)
            out[key + "_days"] = len(pairs)
    return out


# ── 3. returns ─────────────────────────────────────────────────────────────────────────────────

def _base_at(closes: list[tuple[str, float]], dates: list[str], target: str) -> Optional[int]:
    """Index of the last close on or before `target`, or None when there is none or it is more
    than `MAX_GAP_DAYS` before it."""
    i = bisect.bisect_right(dates, target) - 1
    if i < 0:
        return None
    if (_d(target) - _d(dates[i])).days > MAX_GAP_DAYS:
        return None
    return i


def period_returns(closes: list[tuple[str, float]]) -> list[dict]:
    dates = [d for d, _c in closes]
    last_d, last_c = closes[-1]
    last = _d(last_d)
    out = []
    for key, label, kind, amount in RETURN_PERIODS:
        if kind == "days":
            target = (last - timedelta(days=amount)).isoformat()
        elif kind == "ytd":
            target = date(last.year - 1, 12, 31).isoformat()
        else:
            target = add_months(last, -amount).isoformat()
        i = _base_at(closes, dates, target)
        if i is None:
            out.append({"key": key, "label": label, "target": target, "state": "short",
                        "needed_from": target, "held_from": dates[0]})
            continue
        ret = last_c / closes[i][1] - 1.0
        row = {"key": key, "label": label, "target": target, "state": "ok", "from": dates[i],
               "base_close": r2(closes[i][1], 4), "return_pct": pct(ret)}
        if kind == "months" and amount > 12:
            row["yearly_pct"] = pct((1.0 + ret) ** (12.0 / amount) - 1.0) if ret > -1.0 else None
        out.append(row)
    return out


def daily_returns(closes: list[tuple[str, float]]) -> list[tuple[str, float]]:
    return [(closes[i][0], closes[i][1] / closes[i - 1][1] - 1.0) for i in range(1, len(closes))]


def weekly_returns(closes: list[tuple[str, float]], last_week_complete: bool) -> list[tuple[str, float, str]]:
    """`[(the week's last session, return, the week's first session)]` for calendar (ISO) weeks:
    the week's last close over the previous week's last close. The newest week is left out unless
    it has ended; a week right after a week with no close is skipped (its return would span two)."""
    weeks: list[list] = []        # [the week's Monday as a day number, first date, last date, last close]
    for d, c in closes:
        day = _d(d)
        monday = day.toordinal() - day.weekday()
        if weeks and weeks[-1][0] == monday:
            weeks[-1][2], weeks[-1][3] = d, c
        else:
            weeks.append([monday, d, d, c])
    if weeks and not last_week_complete:
        weeks.pop()
    return [(cur[2], cur[3] / prev[3] - 1.0, cur[1]) for prev, cur in zip(weeks, weeks[1:]) if cur[0] - prev[0] == 7]


def week_complete(last: str, is_trading_day: Callable[[date], bool]) -> bool:
    """True when no trading day is left in `last`'s calendar week after it."""
    d = _d(last)
    end = d + timedelta(days=6 - d.weekday())
    nxt = d + timedelta(days=1)
    while nxt <= end:
        if is_trading_day(nxt):
            return False
        nxt += timedelta(days=1)
    return True


def _pick(rows: list, best: bool, jumps: list[str], span_first: Optional[Callable] = None) -> Optional[dict]:
    if not rows:
        return None
    # a tie goes to the earlier date: rows are oldest first and max/min keep the first
    row = max(rows, key=lambda r: r[1]) if best else min(rows, key=lambda r: r[1])
    first = span_first(row) if span_first else row[0]
    check = any(first <= j <= row[0] for j in jumps)
    out = {"date": row[0], "return_pct": pct(row[1]), "check": check}
    if span_first:
        out["from"] = first
    return out


def extremes(closes: list[tuple[str, float]], jumps: list[str], last_week_complete: bool) -> dict:
    days = daily_returns(closes)
    weeks = weekly_returns(closes, last_week_complete)
    start = year_start(closes[-1][0])
    full_year = closes[0][0] <= start

    def block(ds, ws, span):
        return {"state": "ok", "from": span,
                "best_day": _pick(ds, True, jumps), "worst_day": _pick(ds, False, jumps),
                "best_week": _pick(ws, True, jumps, lambda r: r[2]), "worst_week": _pick(ws, False, jumps, lambda r: r[2])}

    out = {"all": block(days, weeks, closes[0][0]) if days else {"state": "short", "needed": 2, "held": len(closes), "unit": "sessions"}}
    if full_year:
        out["year"] = block([r for r in days if r[0] > start], [w for w in weeks if w[2] > start], start)
    else:
        out["year"] = {"state": "short", "needed_from": start, "held_from": closes[0][0]}
    return out


# ── 4. its own drawdowns ────────────────────────────────────────────────────────────────────────

def drawdowns(closes: list[tuple[str, float]], sym: str, jumps: list[str]) -> dict:
    # MKTH's finder (`find_episodes`) and MKTH's line, decided on the unrounded depth; the rows carry
    # what `describe_episodes` says of each decline, without the index rally it adds
    last_d, last_c = closes[-1]
    rows = []
    for ep in reversed(MH.find_episodes(closes)):
        (p_d, p_c), (t_d, t_c) = closes[ep["peak_i"]], closes[ep["trough_i"]]
        depth = MH.depth_of(p_c, t_c)
        if MH.kind_of(depth) != MH.KIND_BEAR:
            continue
        r_i = ep["recover_i"]
        ongoing = r_i is None
        end = last_d if ongoing else closes[r_i][0]
        rows.append({
            "id": f"{sym}-{p_d}", "peak": {"date": p_d, "close": r2(p_c, 4)}, "trough": {"date": t_d, "close": r2(t_c, 4)},
            "depth_pct": -pct(depth), "sessions_down": ep["trough_i"] - ep["peak_i"],
            "recovered": None if ongoing else closes[r_i][0],
            "sessions_to_recover": None if ongoing else r_i - ep["trough_i"], "ongoing": ongoing,
            "peak_at_history_start": ep["peak_i"] == 0,
            "below_peak_now_pct": -pct(MH.depth_of(p_c, last_c)) if ongoing else None,
            "check": any(p_d < j <= end for j in jumps),
        })
    hi_i = max(range(len(closes)), key=lambda i: (closes[i][1], i))       # the later of equal record closes
    depths = [r["depth_pct"] for r in rows]
    recov = [r["sessions_to_recover"] for r in rows if r["sessions_to_recover"] is not None]
    deepest = min(rows, key=lambda r: (r["depth_pct"], r["peak"]["date"])) if rows else None
    return {
        "as_of": closes[-1][0], "first": closes[0][0], "min_depth_pct": round(DRAWDOWN_MIN * 100),
        "high": {"date": closes[hi_i][0], "close": r2(closes[hi_i][1], 4),
                 "from_high_pct": pct(closes[-1][1] / closes[hi_i][1] - 1.0)},
        "total": len(rows), "shown": min(len(rows), DRAWDOWNS_SHOWN),
        "ongoing": sum(1 for r in rows if r["ongoing"]), "recovered": len(recov),
        "median_depth_pct": round(statistics.median(depths), 2) if depths else None,
        "median_recovery_sessions": statistics.median(recov) if recov else None,
        "deepest": deepest,
        "episodes": rows[:DRAWDOWNS_SHOWN],
    }


# ── 5. in every market correction ───────────────────────────────────────────────────────────────

def _on_or_before(dates: list[str], target: str) -> Optional[int]:
    i = bisect.bisect_right(dates, target) - 1
    if i < 0 or (_d(target) - _d(dates[i])).days > MAX_GAP_DAYS:
        return None
    return i


def in_correction(closes: list[tuple[str, float]], ep: dict) -> Optional[dict]:
    """The stock inside one index decline (`ep` is one of MKTH's episodes). None when the index
    peak is outside the stock's history (no close within `MAX_GAP_DAYS` on or before it)."""
    dates = [d for d, _c in closes]
    p_date, t_date = ep["peak"]["date"], ep["trough"]["date"]
    i_p = _on_or_before(dates, p_date)
    i_t = _on_or_before(dates, t_date)
    if i_p is None or i_t is None or i_t < i_p:
        return None
    idx_depth = ep.get("depth_pct")
    run_hi, run_hi_i, dd, dd_hi_i, dd_lo_i = closes[i_p][1], i_p, 0.0, i_p, i_p
    for j in range(i_p, i_t + 1):
        c = closes[j][1]
        if c > run_hi:
            run_hi, run_hi_i = c, j
        fall = c / run_hi - 1.0
        if fall < dd:
            dd, dd_hi_i, dd_lo_i = fall, run_hi_i, j
    dd_pct = pct(dd)
    out = {
        "from": dates[i_p], "to": dates[i_t],
        "drawdown_pct": dd_pct,
        "high": {"date": dates[dd_hi_i], "close": r2(closes[dd_hi_i][1], 4)},
        "low": {"date": dates[dd_lo_i], "close": r2(closes[dd_lo_i][1], 4)},
        "window_return_pct": pct(closes[i_t][1] / closes[i_p][1] - 1.0),
        "vs_index_ratio": (round(dd_pct / idx_depth, 2) if (idx_depth and dd_pct is not None) else None),
        "vs_index_pts": (round(dd_pct - idx_depth, 2) if (idx_depth is not None and dd_pct is not None) else None),
    }

    # back to its 52-week closing high before the index regained its peak?
    recovered = ep.get("recovered")
    if i_p + 1 < NEW_HIGH_SESSIONS:
        out["new_high"] = {"state": "short", "needed": NEW_HIGH_SESSIONS, "held": i_p + 1}
    else:
        ref = max(c for _d2, c in closes[i_p - NEW_HIGH_SESSIONS + 1:i_p + 1])
        j = next((k for k in range(i_p + 1, len(closes)) if closes[k][1] >= ref), None)
        hit = dates[j] if j is not None else None
        if hit and (recovered is None or hit < recovered):
            state = "first"
        elif hit and hit == recovered:
            state = "same_day"
        elif hit:
            state = "after"
        elif recovered:
            state = "index_only"
        else:
            state = "neither"
        lead = None
        if hit and recovered:
            k_rec = bisect.bisect_left(dates, recovered)
            lead = k_rec - j          # stock sessions from its high to the index's regain (positive: first)
        out["new_high"] = {"state": state, "high": r2(ref, 4), "date": hit, "index_date": recovered, "lead_sessions": lead}

    # the 3 months after the index low
    rally = next((r for r in ep.get("rally") or [] if r.get("months") == AFTER_MONTHS), None)
    if not rally or not rally.get("date") or rally.get("return_pct") is None:
        out["after"] = {"state": "not_yet", "months": AFTER_MONTHS, "target": (rally or {}).get("target")}
    else:
        i_end = _on_or_before(dates, rally["date"])
        if i_end is None or i_end < i_t:
            out["after"] = {"state": "gap", "months": AFTER_MONTHS, "date": rally["date"]}
        else:
            s_ret = pct(closes[i_end][1] / closes[i_t][1] - 1.0)
            out["after"] = {"state": "ok", "months": AFTER_MONTHS, "from": dates[i_t], "date": dates[i_end],
                            "return_pct": s_ret, "index_return_pct": rally["return_pct"],
                            "vs_index_pts": round(s_ret - rally["return_pct"], 2)}
    return out


def corrections(closes: list[tuple[str, float]], index_block: dict) -> dict:
    """Section 5: every episode of MKTH's index block (newest first) the stock's history covers."""
    rows, before = [], 0
    for ep in index_block.get("episodes") or []:
        if not isinstance(ep, dict) or not isinstance(ep.get("peak"), dict) or not isinstance(ep.get("trough"), dict):
            continue
        got = in_correction(closes, ep)
        if got is None:
            before += 1
            continue
        rows.append({
            "id": ep.get("id"), "kind": ep.get("kind"), "peak": ep["peak"], "trough": ep["trough"],
            "depth_pct": ep.get("depth_pct"), "recovered": ep.get("recovered"), "ongoing": bool(ep.get("ongoing")),
            "stock": got,
        })
    ratios = [r["stock"]["vs_index_ratio"] for r in rows if r["stock"]["vs_index_ratio"] is not None]
    after = [r["stock"]["after"]["vs_index_pts"] for r in rows if r["stock"]["after"]["state"] == "ok"]
    judged = [r for r in rows if r["stock"]["new_high"]["state"] in ("first", "same_day", "after", "index_only")]
    return {
        "episodes": rows, "before_history": before,
        "summary": {
            "count": len(rows),
            "fell_less": sum(1 for x in ratios if x < 1.0),
            "fell_more": sum(1 for x in ratios if x > 1.0),
            "median_ratio": round(statistics.median(ratios), 2) if ratios else None,
            "new_high_first": sum(1 for r in judged if r["stock"]["new_high"]["state"] == "first"),
            "new_high_judged": len(judged),
            "after_beat": sum(1 for x in after if x > 0),
            "after_count": len(after),
            "median_after_vs_index_pts": round(statistics.median(after), 2) if after else None,
        },
    }
