"""MKTH, the pure half: every correction and bear market in a series of daily closes, the rally
after each low, and the leaders of each rally. No I/O, no clock, no store: lists in, dicts out.
`api/services/market_history.py` reads the stored closes and holds the answer.

THE ONE DEFINITION (each constant below is named and tested on invented series):

  * A PEAK is a close at or above every close before it. Two equal record closes: the later one is
    the peak (the last record before the fall).
  * A DECLINE is the stretch from a peak until a close regains it (closes at or above the peak
    close). Its TROUGH is the lowest close inside that stretch; two equal lows: the first one.
  * A decline counts when its depth, (peak - trough) / peak, is `CORRECTION_MIN` (10%) or more:
    a CORRECTION below `BEAR_MIN` (20%), a BEAR MARKET at 20% or more. A decline of exactly 10% or
    exactly 20% is on the deeper side of the line (`DEPTH_TOLERANCE` absorbs binary rounding only).
  * A NEW PEAK STARTS ONLY AFTER THE PRIOR PEAK IS REGAINED: a double bottom, or a rebound that
    falls short of the peak, is ONE decline, never two.
  * A decline the series never recovers from is ONGOING: its trough is the low so far, and the
    regain date and the sessions to recover are null ("not yet").
  * SESSIONS are the index's own closing days in the store: from the peak to the trough
    (`sessions_down`), and from the trough to the close that regained the peak
    (`sessions_to_recover`). A day the store does not hold is not counted.

THE RALLY AFTER EACH LOW: the index return from the trough close to the first close on or after the
same calendar day `RALLY_MONTHS` (1, 3, 6, 12) months later; null when the store has not reached it.

THE LEADERS: for each trough, every stock with a close ON the trough date AND on the date
`LEADER_SESSIONS` (63) index sessions later; the top `LEADERS_TOP` (25) by return, each with its
sector and its return less the index's over the same two dates (percentage points), and each
sector's median return over the same window. Fewer than `LEADERS_MIN_STOCKS` priced at both dates
and the list is not drawn ("thin"): a ranking of a handful of names is not a list of leaders.

Closes are price returns (split-adjusted, not dividend-adjusted), as the store holds them.
"""
from __future__ import annotations

import bisect
import statistics
from datetime import date
from typing import Iterable, Optional

from api.services.session_calendar import add_months

#: a decline of this much or more from the peak close is a correction
CORRECTION_MIN = 0.10
#: and of this much or more, a bear market
BEAR_MIN = 0.20
#: binary floating point may land a decline of exactly 10% at 0.0999999...; this absorbs that and
#: nothing a two-decimal close can produce (the smallest real difference is far larger)
DEPTH_TOLERANCE = 1e-9
#: calendar months after the trough the rally is measured at
RALLY_MONTHS = (1, 3, 6, 12)
#: index sessions after the trough the leaders are measured at (about three months)
LEADER_SESSIONS = 63
#: how many leaders each list keeps
LEADERS_TOP = 25
#: fewer stocks than this with closes at both dates and the list is not drawn (the builder's default)
LEADERS_MIN_STOCKS = 100
#: the sentence every leaders list carries, word for word
SURVIVORSHIP_NOTE = ("From stocks that trade today: companies later delisted or acquired are not in UCT's price "
                     "history, so this list can leave out some of that rally's leaders.")

KIND_CORRECTION = "correction"
KIND_BEAR = "bear"


def depth_of(peak: float, trough: float) -> float:
    """The decline from `peak` to `trough` as a fraction (0.1 is 10%). Computed as a difference over
    the peak, never `1 - trough / peak`, which lands a decline of exactly 10% below 0.1."""
    return (peak - trough) / peak


def qualifies(depth: float, line: float = CORRECTION_MIN) -> bool:
    """True when a decline of `depth` reaches `line` (exactly on the line counts)."""
    return depth >= line - DEPTH_TOLERANCE


def kind_of(depth: float) -> str:
    return KIND_BEAR if qualifies(depth, BEAR_MIN) else KIND_CORRECTION


def pct(x: Optional[float]) -> Optional[float]:
    """A fraction as percent units, two decimals (0.12345 -> 12.35); None stays None."""
    return None if x is None else round(x * 100.0, 2)


def clean_closes(rows: Iterable) -> list[tuple[str, float]]:
    """`[(YYYY-MM-DD, close)]` ascending with one close per date (the last wins), positive and
    finite only. Anything else in `rows` is dropped, never repaired."""
    seen: dict[str, float] = {}
    for row in rows or []:
        try:
            d, c = row[0], float(row[1])
        except (TypeError, ValueError, IndexError):
            continue
        if isinstance(d, str) and len(d) == 10 and c > 0 and c == c and c != float("inf"):
            seen[d] = c
    return sorted(seen.items())


def find_episodes(closes: list[tuple[str, float]]) -> list[dict]:
    """Every decline of `CORRECTION_MIN` or more in `closes` (ascending, from `clean_closes`), oldest
    first, as index positions: `{peak_i, trough_i, recover_i (None while ongoing)}`."""
    out: list[dict] = []
    if len(closes) < 2:
        return out
    peak_i = 0
    trough_i: Optional[int] = None
    for i in range(1, len(closes)):
        c = closes[i][1]
        if c >= closes[peak_i][1]:
            if trough_i is not None and qualifies(depth_of(closes[peak_i][1], closes[trough_i][1])):
                out.append({"peak_i": peak_i, "trough_i": trough_i, "recover_i": i})
            peak_i, trough_i = i, None
            continue
        if trough_i is None or c < closes[trough_i][1]:
            trough_i = i
    if trough_i is not None and qualifies(depth_of(closes[peak_i][1], closes[trough_i][1])):
        out.append({"peak_i": peak_i, "trough_i": trough_i, "recover_i": None})
    return out


def rally_after(closes: list[tuple[str, float]], trough_i: int, months: Iterable[int] = RALLY_MONTHS) -> list[dict]:
    """The index return from the trough close to the first close on or after the same day `m`
    calendar months later, for each `m`. `{months, target, date, return_pct}`; `date` and
    `return_pct` are None when the store does not reach that day yet."""
    dates = [d for d, _c in closes]
    t_date, t_close = closes[trough_i]
    out = []
    for m in months:
        target = add_months(date.fromisoformat(t_date), m).isoformat()
        j = bisect.bisect_left(dates, target, lo=trough_i + 1)
        if j >= len(closes):
            out.append({"months": m, "target": target, "date": None, "return_pct": None})
        else:
            out.append({"months": m, "target": target, "date": dates[j],
                        "return_pct": pct(closes[j][1] / t_close - 1.0)})
    return out


def describe_episodes(closes: list[tuple[str, float]], symbol: str) -> list[dict]:
    """`find_episodes` in the answer's words, NEWEST FIRST, each with its rally."""
    rows = []
    last_d, last_c = closes[-1] if closes else (None, None)
    for ep in find_episodes(closes):
        p_d, p_c = closes[ep["peak_i"]]
        t_d, t_c = closes[ep["trough_i"]]
        depth = depth_of(p_c, t_c)
        r_i = ep["recover_i"]
        ongoing = r_i is None
        rows.append({
            "id": f"{symbol}-{p_d}",
            "kind": kind_of(depth),
            "peak": {"date": p_d, "close": round(p_c, 2)},
            "trough": {"date": t_d, "close": round(t_c, 2)},
            "depth_pct": -pct(depth),
            "sessions_down": ep["trough_i"] - ep["peak_i"],
            "recovered": None if ongoing else closes[r_i][0],
            "sessions_to_recover": None if ongoing else r_i - ep["trough_i"],
            "ongoing": ongoing,
            # the store's first close is the peak: the real peak may be earlier than the history held
            "peak_at_history_start": ep["peak_i"] == 0,
            # an ongoing decline: how far below the peak the newest close is
            "below_peak_now_pct": -pct(depth_of(p_c, last_c)) if ongoing else None,
            "rally": rally_after(closes, ep["trough_i"]),
        })
    rows.reverse()
    return rows


def summarize(episodes: list[dict], first: Optional[str]) -> dict:
    """The counts and medians the summary line reads. Depth over every decline (ongoing too, at its
    low so far); recovery over the declines that recovered."""
    depths = [e["depth_pct"] for e in episodes]
    recov = [e["sessions_to_recover"] for e in episodes if e["sessions_to_recover"] is not None]
    return {
        "since": first,
        "corrections": sum(1 for e in episodes if e["kind"] == KIND_CORRECTION),
        "bear_markets": sum(1 for e in episodes if e["kind"] == KIND_BEAR),
        "ongoing": sum(1 for e in episodes if e["ongoing"]),
        "recovered": len(recov),
        "median_depth_pct": round(statistics.median(depths), 2) if depths else None,
        "median_recovery_sessions": statistics.median(recov) if recov else None,
    }


# ── the leaders ────────────────────────────────────────────────────────────────────────────────

def leader_window(closes: list[tuple[str, float]], trough_date: str, sessions: int = LEADER_SESSIONS) -> dict:
    """The two dates a trough's leaders are measured between: `{trough, end, sessions_so_far,
    index_return_pct}`. `end` is None (and the return too) while fewer than `sessions` index
    sessions have closed since the trough."""
    dates = [d for d, _c in closes]
    i = bisect.bisect_left(dates, trough_date)
    if i >= len(dates) or dates[i] != trough_date:
        return {"trough": trough_date, "end": None, "sessions_so_far": None, "index_return_pct": None}
    j = i + sessions
    if j >= len(closes):
        return {"trough": trough_date, "end": None, "sessions_so_far": len(closes) - 1 - i, "index_return_pct": None}
    return {"trough": trough_date, "end": dates[j], "sessions_so_far": sessions,
            "index_return_pct": pct(closes[j][1] / closes[i][1] - 1.0)}


class WindowTally:
    """Every stock's return over ONE window, gathered one stock at a time (the build reads each
    stock's closes once for all windows), then ranked. Holds a float per stock, never a series."""

    __slots__ = ("trough", "end", "priced_at_trough", "returns")

    def __init__(self, trough: str, end: str):
        self.trough, self.end = trough, end
        self.priced_at_trough = 0
        self.returns: list[tuple[float, str, bool]] = []    # (return as a fraction, symbol, a suspect jump inside)

    def add(self, sym: str, by_date: dict, jumps: Iterable[str] = ()) -> None:
        a = by_date.get(self.trough)
        if not a:
            return
        self.priced_at_trough += 1
        b = by_date.get(self.end)
        if not b:
            return
        flagged = any(self.trough < j <= self.end for j in jumps)
        self.returns.append((b / a - 1.0, sym, flagged))

    def result(self, index_return_pct: Optional[float], sectors: dict, top: int = LEADERS_TOP,
               min_stocks: int = LEADERS_MIN_STOCKS) -> dict:
        n = len(self.returns)
        base = {"trough": self.trough, "end": self.end, "priced_at_trough": self.priced_at_trough,
                "priced_both": n, "index_return_pct": index_return_pct}
        if n < min_stocks:
            return {**base, "state": "thin", "top": [], "sectors": [], "no_sector": 0}
        best = sorted(self.returns, key=lambda r: (-r[0], r[1]))[:top]   # a tie goes to the first symbol A to Z
        rows = []
        for ret, sym, flagged in best:
            r_pct = pct(ret)
            rows.append({"sym": sym, "sector": sectors.get(sym) or None, "return_pct": r_pct,
                         "vs_index_pct": None if index_return_pct is None else round(r_pct - index_return_pct, 2),
                         "check": flagged})
        groups: dict[str, list[float]] = {}
        no_sector = 0
        for ret, sym, _f in self.returns:
            s = sectors.get(sym)
            if not s:
                no_sector += 1
                continue
            groups.setdefault(s, []).append(ret)
        secs = [{"sector": s, "median_pct": pct(statistics.median(v)), "count": len(v)} for s, v in groups.items()]
        secs.sort(key=lambda x: (-x["median_pct"], x["sector"]))
        return {**base, "state": "ok", "top": rows, "sectors": secs, "no_sector": no_sector}
