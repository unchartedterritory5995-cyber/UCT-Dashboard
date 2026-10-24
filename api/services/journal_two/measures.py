"""Notebook widgets wave 8 -- the ONE module that defines every measure the widget builder offers.

Each measure is a label, a theme, a one-line meaning, a unit, a kind, its own minimum sample
(`min_n`), the per-trade fields it needs (`needs`), the sources it reads, and a pure function over
plain row dicts. Rows are the closed-trades rows Task 8.5 builds:

    {"net", "gross", "fees", "result", "r", "hold_days", "day"}  (plus an optional "id")

where `net` is `pnl_dollar - fees`, `r` is the effective R (`analytics._effective_r_map`: stop-R,
else True R, else None) and `day` is the ET trading day (`filters._DAY`).

PARITY: the 16 `metrics_registry.VOCABULARY_KEYS` are defined here exactly as
`metrics_registry.build_vocabulary` defines them, so a builder card and an analytics card agree.
The one deliberate difference is `profit_factor`, capped at `PF_CAP` and given a value (the cap)
when there are wins and no losses, where the registry has none.

Every value passes `notebook_widgets._num`: a NaN or an infinity anywhere in the figures a measure
reads makes that measure's value None ("no data"), never NaN and never a silent 0.

Pure: no I/O, no clock.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Iterable, Literal, NamedTuple

from api.services.journal_two.notebook_widgets import _num

#: Profit factor is capped here and displayed "5+" at the cap.
PF_CAP = 5.0
#: Below this many units a `rate`/`average` measure wears the "small sample" badge (spec §5.6).
SMALL_SAMPLE_N = 20
#: The default per-measure minimum; under it the value is replaced by "Not enough trades yet".
DEFAULT_MIN_N = 5
#: `payoff`'s own minimum: `metrics_registry._MIN_DECISIVE` (its payoff_kelly gate). Restated as a
#: literal so this module imports no SQL; `tests/test_measures.py` pins the two equal.
PAYOFF_MIN_N = 20

_SOURCES = frozenset({"closed_trades"})
_DOLLARS = ("net", "gross", "fees")

Theme = Literal["results", "winloss", "risk", "time", "process"]
Unit = Literal["trades", "decisive", "days", "entries"]
Kind = Literal["sum", "count", "rate", "average", "extreme"]


class MeasureValue(NamedTuple):
    """`value` is a finite float or None. `n` counts the measure's own unit (trades, decisive
    trades, or days with trades). `have` is the number of rows carrying every `needs` field, and
    None when the measure needs nothing."""
    value: float | None
    n: int
    have: int | None


@dataclass(frozen=True)
class Measure:
    key: str
    label: str
    theme: Theme
    meaning: str
    unit: Unit
    kind: Kind
    min_n: int
    needs: tuple[str, ...]
    sources: frozenset[str]
    fn: Callable[[list[dict]], MeasureValue]


def small_sample(m: Measure, mv: MeasureValue) -> Literal["", "small", "hide"]:
    """"hide" under the measure's `min_n`, "small" under 20, else "". Only a `rate` or an
    `average` is ever badged or hidden; sums, counts and extremes always show with their count.
    A measure with `needs` is counted in the rows that carry them (`have`), else in `n`."""
    if m.kind not in ("rate", "average"):
        return ""
    count = (mv.have or 0) if m.needs else mv.n
    if count < m.min_n:
        return "hide"
    if count < SMALL_SAMPLE_N:
        return "small"
    return ""


# ── helpers ─────────────────────────────────────────────────────────────────────────────────────

def _f(v) -> float:
    """A row figure as a float. A missing figure counts as 0 (the registry's `or 0`); a NaN or an
    infinity passes through so `_poisoned` can see it."""
    if v is None or isinstance(v, bool):
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _poisoned(rows: Iterable[dict], fields: Iterable[str]) -> bool:
    fields = tuple(fields)
    for row in rows:
        for k in fields:
            v = row.get(k)
            if isinstance(v, float) and not math.isfinite(v):
                return True
    return False


def _has(row: dict, field: str) -> bool:
    return _num(row.get(field)) is not None


def _wins(rows):
    return [_f(r.get("net")) for r in rows if r.get("result") == "Win"]


def _losses(rows):
    return [_f(r.get("net")) for r in rows if r.get("result") == "Loss"]


def _daily(rows) -> list[tuple[str, float]]:
    """Net P&L per ET day, days with trades only, in day order (`metrics_registry._daily_net`)."""
    by: dict[str, float] = {}
    for r in rows:
        d = r.get("day")
        if d:
            d = str(d)[:10]
            by[d] = by.get(d, 0.0) + _f(r.get("net"))
    return sorted(by.items())


def _ordered(rows) -> list[dict]:
    """Day, then id (the scan's tiebreak); stable on input order where both are absent."""
    return sorted(rows, key=lambda r: (str(r.get("day") or "")[:10], str(r.get("id") or "")))


def _mv(value, n: int, have: int | None = None) -> MeasureValue:
    return MeasureValue(_num(value), int(n), have)


def _div(a: float, b: float):
    return a / b if b else None


# ── the measure functions ──────────────────────────────────────────────────────────────────────
# Each mirrors `metrics_registry.build_vocabulary` where the key is one of its 16.

def _net_pnl(rows):
    if _poisoned(rows, _DOLLARS):
        return _mv(None, len(rows))
    return _mv(round(sum(_f(r.get("net")) for r in rows), 2), len(rows))


def _gross_pnl(rows):
    if _poisoned(rows, ("gross",)):
        return _mv(None, len(rows))
    return _mv(round(sum(_f(r.get("gross")) for r in rows), 2), len(rows))


def _fees(rows):
    if _poisoned(rows, ("fees",)):
        return _mv(None, len(rows))
    return _mv(round(sum(_f(r.get("fees")) for r in rows), 2), len(rows))


def _trades(rows):
    return _mv(float(len(rows)), len(rows))


def _wins_count(rows):
    return _mv(float(len(_wins(rows))), len(rows))


def _losses_count(rows):
    return _mv(float(len(_losses(rows))), len(rows))


def _win_rate(rows):
    w, l = len(_wins(rows)), len(_losses(rows))
    return _mv(_div(w, w + l), w + l)


def _avg_win(rows):
    w = _wins(rows)
    if _poisoned(rows, ("net",)):
        return _mv(None, len(w))
    return _mv(_div(sum(w), len(w)) if w else None, len(w))


def _avg_loss(rows):
    lo = _losses(rows)
    if _poisoned(rows, ("net",)):
        return _mv(None, len(lo))
    return _mv((abs(sum(lo)) / len(lo)) if lo else None, len(lo))


def _payoff(rows):
    w, lo = _wins(rows), _losses(rows)
    n = len(w) + len(lo)
    if _poisoned(rows, ("net",)):
        return _mv(None, n)
    if not (w and lo and abs(sum(lo)) > 1e-9):
        return _mv(None, n)
    return _mv((sum(w) / len(w)) / (abs(sum(lo)) / len(lo)), n)


def _profit_factor(rows):
    """Net profit factor, capped at PF_CAP; PF_CAP when there are wins and no losses."""
    if _poisoned(rows, ("net",)):
        return _mv(None, len(rows))
    sum_w = sum(p for p in _wins(rows) if p > 0)
    sum_l = abs(sum(p for p in _losses(rows) if p < 0))
    if sum_l <= 1e-9:
        return _mv(PF_CAP if sum_w > 0 else None, len(rows))
    return _mv(min(sum_w / sum_l, PF_CAP), len(rows))


def _expectancy(rows):
    if _poisoned(rows, ("net",)):
        return _mv(None, len(rows))
    return _mv(_div(sum(_f(r.get("net")) for r in rows), len(rows)), len(rows))


def _days_traded(rows):
    d = _daily(rows)
    return _mv(float(len(d)), len(d))


def _profitable_days(rows):
    d = _daily(rows)
    if _poisoned(rows, ("net",)):
        return _mv(None, len(d))
    return _mv(float(sum(1 for _d, p in d if p > 0)), len(d))


def _profitable_days_pct(rows):
    d = _daily(rows)
    if _poisoned(rows, ("net",)):
        return _mv(None, len(d))
    return _mv(_div(sum(1 for _d, p in d if p > 0), len(d)), len(d))


def _avg_day_pnl(rows):
    d = _daily(rows)
    if _poisoned(rows, ("net",)):
        return _mv(None, len(d))
    return _mv(_div(sum(p for _d, p in d), len(d)), len(d))


def _r_values(rows) -> list[float]:
    return [float(r["r"]) for r in rows if _has(r, "r")]


def _avg_r(rows):
    rs = _r_values(rows)
    return _mv(_div(sum(rs), len(rs)), len(rows), len(rs))


def _total_r(rows):
    rs = _r_values(rows)
    return _mv(sum(rs) if rs else None, len(rows), len(rs))


def _max_drawdown(rows):
    """Deepest fall of the cumulative daily net curve from its running peak, starting at 0."""
    if _poisoned(rows, ("net",)):
        return _mv(None, len(rows))
    run = peak = max_dd = 0.0
    for _d, p in _daily(rows):
        run += p
        peak = max(peak, run)
        max_dd = min(max_dd, run - peak)
    return _mv(round(max_dd, 2), len(rows))


def _best_trade(rows):
    if _poisoned(rows, ("net",)) or not rows:
        return _mv(None, len(rows))
    return _mv(max(_f(r.get("net")) for r in rows), len(rows))


def _worst_trade(rows):
    if _poisoned(rows, ("net",)) or not rows:
        return _mv(None, len(rows))
    return _mv(min(_f(r.get("net")) for r in rows), len(rows))


def _avg_hold_days(rows):
    hv = [float(r["hold_days"]) for r in rows if _has(r, "hold_days")]
    return _mv(_div(sum(hv), len(hv)), len(rows), len(hv))


def _runs(rows) -> list[tuple[str, int]]:
    """Consecutive (result, length) runs in day-then-id order. A breakeven (or any result other
    than Win/Loss) ends the run it interrupts and starts none."""
    out: list[tuple[str, int]] = []
    for r in _ordered(rows):
        res = r.get("result")
        if res not in ("Win", "Loss"):
            out.append(("", 0))
            continue
        if out and out[-1][0] == res:
            out[-1] = (res, out[-1][1] + 1)
        else:
            out.append((res, 1))
    return out


def _max_win_streak(rows):
    runs = _runs(rows)
    return _mv(float(max((k for res, k in runs if res == "Win"), default=0)), len(rows))


def _max_loss_streak(rows):
    runs = _runs(rows)
    return _mv(float(max((k for res, k in runs if res == "Loss"), default=0)), len(rows))


def _current_streak(rows):
    """Signed: +n for n wins in a row at the newest end, -n for n losses. None when the newest
    trade is not a win or a loss (no run is open), never a 0."""
    runs = _runs(rows)
    if not runs or runs[-1][0] == "":
        return _mv(None, len(rows))
    res, k = runs[-1]
    return _mv(float(k if res == "Win" else -k), len(rows))


# ── the catalog ────────────────────────────────────────────────────────────────────────────────

def _m(key, label, theme, meaning, unit, kind, fn, *, min_n=DEFAULT_MIN_N, needs=()):
    return Measure(key, label, theme, meaning, unit, kind, min_n, tuple(needs), _SOURCES, fn)


MEASURES: dict[str, Measure] = {m.key: m for m in [
    # The 16 metrics_registry.VOCABULARY_KEYS.
    _m("net_pnl", "Net P&L", "results", "Money made or lost after fees.",
       "trades", "sum", _net_pnl),
    _m("gross_pnl", "Gross P&L", "results", "Money made or lost before fees.",
       "trades", "sum", _gross_pnl),
    _m("fees", "Fees", "process", "Commissions and fees paid.",
       "trades", "sum", _fees),
    _m("trades", "Trades", "results", "How many closed trades.",
       "trades", "count", _trades),
    _m("wins", "Wins", "winloss", "How many trades closed as wins.",
       "trades", "count", _wins_count),
    _m("losses", "Losses", "winloss", "How many trades closed as losses.",
       "trades", "count", _losses_count),
    _m("win_rate", "Win rate", "winloss",
       "Share of wins among wins and losses. Breakeven trades are left out.",
       "decisive", "rate", _win_rate),
    _m("avg_win", "Average win", "winloss", "Average net P&L of a winning trade.",
       "trades", "average", _avg_win),
    _m("avg_loss", "Average loss", "winloss", "Average size of a losing trade, after fees.",
       "trades", "average", _avg_loss),
    _m("payoff", "Payoff ratio", "winloss", "Average win divided by average loss.",
       "decisive", "rate", _payoff, min_n=PAYOFF_MIN_N),
    _m("profit_factor", "Profit factor", "winloss",
       "Money won divided by money lost, after fees. Shown as 5+ at 5.",
       "trades", "rate", _profit_factor),
    _m("expectancy", "Expectancy", "results",
       "Average net P&L per trade, breakeven trades included.",
       "trades", "average", _expectancy),
    _m("days_traded", "Days traded", "time", "Days with at least one closed trade.",
       "days", "count", _days_traded),
    _m("profitable_days", "Profitable days", "time",
       "Days whose closed trades made money in total.",
       "days", "count", _profitable_days),
    _m("avg_true_r", "Average R", "risk",
       "Average result in R, over the trades whose R is known.",
       "trades", "average", _avg_r, needs=("r",)),
    _m("max_drawdown", "Max drawdown", "risk",
       "Deepest drop of your running P&L from its high, by day.",
       "trades", "extreme", _max_drawdown),
    # The new measures (spec §5.6).
    _m("expectancy_r", "Expectancy (R)", "risk",
       "Average R per trade, over the trades whose R is known.",
       "trades", "average", _avg_r, needs=("r",)),
    _m("total_r", "Total R", "risk", "R added up over the trades whose R is known.",
       "trades", "sum", _total_r, needs=("r",)),
    _m("best_trade", "Best trade", "results", "The largest net P&L on one trade.",
       "trades", "extreme", _best_trade),
    _m("worst_trade", "Worst trade", "results", "The smallest net P&L on one trade.",
       "trades", "extreme", _worst_trade),
    _m("avg_hold_days", "Average hold (days)", "time", "Average days a trade was held.",
       "trades", "average", _avg_hold_days, needs=("hold_days",)),
    _m("profitable_days_pct", "Profitable days %", "time",
       "Share of days with trades that made money in total.",
       "days", "rate", _profitable_days_pct),
    _m("max_win_streak", "Longest win streak", "winloss",
       "Most wins in a row. A breakeven trade ends a run.",
       "trades", "extreme", _max_win_streak),
    _m("max_loss_streak", "Longest loss streak", "winloss",
       "Most losses in a row. A breakeven trade ends a run.",
       "trades", "extreme", _max_loss_streak),
    _m("current_streak", "Current streak", "winloss",
       "Wins (+) or losses (-) in a row up to your latest trade.",
       "trades", "extreme", _current_streak),
    _m("avg_day_pnl", "Average day P&L", "time",
       "Average net P&L of a day with trades.",
       "days", "average", _avg_day_pnl),
    _m("green_day_pct", "Green day %", "time",
       "Share of days with trades that ended green.",
       "days", "rate", _profitable_days_pct),
]}
