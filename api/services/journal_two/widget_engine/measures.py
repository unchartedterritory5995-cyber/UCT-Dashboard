"""The builder's measure adapter (wave 8, Task 8.5) over the shared measure module.

`api/services/journal_two/measures.py` (Task 8.3) is the ONE authority on what a measure means.
This adapter imports it and never copies a formula. It adds three things the builder needs:

1. `builder_measures()`: the measures a widget may pick, with the source each applies to. The
   shared module's measures are offered exactly as declared (a measure whose `sources` is empty,
   `avg_true_r`, is never offered: ruling R-10). The open-positions measures live HERE because the
   shared module describes closed trades and trading days only, and a widget over open positions
   needs at least one measure to exist (Task 8.5 report, concern C-1).
2. `measure_input(source_key, rows)`: the rows a measure reads. Trading-days rows are one per
   session INCLUDING sessions with no trades (spec 5.3); the day measures count only days with
   trades (spec 5.4), so a quiet session is left out here, never inside a measure. Options
   strategies (wave 10, Task 10.6, ruling W10-R6): an OPEN strategy is listed but never
   measured, so it is left out here too; only "Strategies" (`COUNTS_OPEN`) counts it.
3. `evaluate(measure, source_key, rows) -> Cell`: the value, its count, how many rows carry what
   the measure needs, and the small-sample state (`measures.small_sample`).

Pure: no I/O, no clock.
"""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass

from api.services.journal_two.measures import (
    DEFAULT_MIN_N, MEASURES, Measure, MeasureValue, small_sample,
)
from api.services.journal_two.notebook_widgets import _num
from api.services.journal_two.routine_days import ROUTINE_MEASURES
from api.services.journal_two.tracker_days import TRACKER_MEASURES

POSITIONS = "open_positions"
TRADING_DAYS = "trading_days"
ROUTINE_HISTORY = "routine_history"
OPTIONS = "options_strategies"
NOTES = "notes"


@dataclass(frozen=True)
class Cell:
    """One measure's answer for one group. `value` is a finite float or None ("no data").
    `n` counts the measure's own unit; `have` the rows carrying its `needs` (None when it needs
    nothing); `sample` is "" | "small" | "hide" (`measures.small_sample`)."""
    value: float | None
    n: int
    have: int | None
    sample: str


# ── open positions ─────────────────────────────────────────────────────────────────────────────

def _present(rows: list[dict], key: str) -> list[float]:
    out = []
    for r in rows:
        v = _num(r.get(key))
        if v is not None:
            out.append(v)
    return out


def _mv(value, n: int, have: int | None = None) -> MeasureValue:
    return MeasureValue(_num(value), int(n), have)


def _open_positions(rows):
    return _mv(float(len(rows)), len(rows))


def _unrealised(rows):
    vals = _present(rows, "unrealised")
    return _mv(round(sum(vals), 2) if vals else None, len(rows), len(vals))


def _open_risk(rows):
    vals = _present(rows, "risk_dollars")
    return _mv(round(sum(vals), 2) if vals else None, len(rows), len(vals))


def _avg_days_open(rows):
    vals = _present(rows, "days_open")
    return _mv(sum(vals) / len(vals) if vals else None, len(rows), len(vals))


_POS = frozenset({POSITIONS})

POSITION_MEASURES: dict[str, Measure] = {m.key: m for m in [
    Measure("open_positions", "Open positions", "risk", "How many positions are open.",
            "positions", "count", DEFAULT_MIN_N, (), _POS, _open_positions),
    Measure("unrealised_pnl", "Unrealised P&L", "results",
            "Open profit or loss at the broker's last mark. Positions with no mark are left out.",
            "positions", "sum", DEFAULT_MIN_N, ("unrealised",), _POS, _unrealised),
    Measure("open_risk", "Risk to stops", "risk",
            "Money lost if every stop is hit. Positions with no stop set are left out.",
            "positions", "sum", DEFAULT_MIN_N, ("risk_dollars",), _POS, _open_risk),
    Measure("avg_days_open", "Average days open", "time",
            "Average days since entry. Positions with an estimated entry date are left out.",
            "positions", "average", DEFAULT_MIN_N, ("days_open",), _POS, _avg_days_open),
]}


# ── options strategies (wave 10, Task 10.6) ────────────────────────────────────────────────────

def _strategies(rows):
    return _mv(float(len(rows)), len(rows))


_OPT = frozenset({OPTIONS})

#: "Strategies" counts every strategy the widget read, open ones included (W10-R6).
STRATEGY_MEASURES: dict[str, Measure] = {m.key: m for m in [
    Measure("strategies", "Strategies", "results", "How many options strategies.",
            "strategies", "count", DEFAULT_MIN_N, (), _OPT, _strategies),
]}
#: The measures that read every row, an open strategy included (the rest read `measure_input`).
COUNTS_OPEN = frozenset(STRATEGY_MEASURES)
#: The shared measures an options-strategies widget may pick: the SAME `measures.MEASURES` entries
#: (their functions, never a copy) with `options_strategies` added to `sources` here. They read a
#: closed strategy's `net` (`pnl_dollar`, already net of fees), `result`, `r` and `day`.
OPTION_WIDENED = ("net_pnl", "wins", "losses", "win_rate", "avg_win", "avg_loss", "payoff",
                  "profit_factor", "expectancy", "expectancy_r", "total_r", "best_trade",
                  "worst_trade", "max_drawdown", "max_win_streak", "max_loss_streak",
                  "current_streak")
#: How a measure's unit reads on a source whose rows are not trades (the payload's noun, the
#: brief's literal rule): "Not enough strategies yet (3)". A decisive count reads "strategies"
#: too; its `n` is still the decisive count.
_UNIT_BY_SOURCE = {OPTIONS: {"trades": "strategies", "decisive": "strategies"}}


# ── notes (wave 10, Task 10.7) ─────────────────────────────────────────────────────────────────

def _notes(rows):
    return _mv(float(len(rows)), len(rows))


def prop_key(prop: str) -> str:
    """The row key holding note property `prop`'s number (`sources.scan_notes` writes it only for
    one of the member's own number properties; it is absent, so None, otherwise)."""
    return "prop:" + prop


def _unbound_property_sum(rows):
    # `bind_prop` gives the measure its property; unbound it has none to add up ("no data")
    return _mv(None, len(rows), 0)


_NOTE = frozenset({NOTES})

NOTE_MEASURES: dict[str, Measure] = {m.key: m for m in [
    Measure("notes", "Notes", "results", "How many notes.", "notes", "count", DEFAULT_MIN_N, (),
            _NOTE, _notes),
    Measure("property_sum", "Sum of a property", "results",
            "One of your number properties added up over the notes. Notes with no value are left "
            "out.", "notes", "sum", DEFAULT_MIN_N, (), _NOTE, _unbound_property_sum),
]}


def bind_prop(m: Measure, prop: str) -> Measure:
    """`property_sum` for one property: it reads `prop_key(prop)` from each row (the notes with a
    value), and is None when no note has one. The plan carries `prop` beside the key."""
    key = prop_key(prop)

    def fn(rows):
        vals = _present(rows, key)
        return _mv(sum(vals) if vals else None, len(rows), len(vals))

    return dataclasses.replace(m, needs=(key,), fn=fn)


def unit_for(m, source_key: str) -> str:
    """The noun a measure counts in on `source_key` (a shared measure says "trades")."""
    return _UNIT_BY_SOURCE.get(source_key, {}).get(m.unit, m.unit)


def builder_measures() -> dict[str, Measure]:
    """Every measure a widget may pick: the shared module's offered ones, the positions ones, and
    (wave 9) the routine and tracker history ones, (wave 10) the options strategies ones, the
    shared measures widened to options strategies, and the notes ones. No key may shadow another."""
    out = {k: m for k, m in MEASURES.items() if m.sources}
    for k in OPTION_WIDENED:
        out[k] = dataclasses.replace(out[k], sources=out[k].sources | _OPT)
    for group, extra in (("position", POSITION_MEASURES), ("routine", ROUTINE_MEASURES),
                         ("tracker", TRACKER_MEASURES), ("strategy", STRATEGY_MEASURES),
                         ("note", NOTE_MEASURES)):
        for k, m in extra.items():
            assert k not in out, f"{group} measure {k} shadows another measure"
            out[k] = m
    return out


def measures_for(source_key: str) -> dict[str, Measure]:
    return {k: m for k, m in builder_measures().items() if source_key in m.sources}


def measure_input(source_key: str, rows: list[dict]) -> list[dict]:
    """The rows a measure reads. Trading days: only days with trades (spec 5.4). Options
    strategies: only closed ones (an open strategy is listed, never measured, W10-R6)."""
    if source_key == TRADING_DAYS:
        return [r for r in rows if (r.get("trade_count") or 0) > 0]
    if source_key == OPTIONS:
        return [r for r in rows if not r.get("open")]
    return rows


def rows_for(m, source_key: str, rows: list[dict]) -> list[dict]:
    """The rows measure `m` reads: every row for a `COUNTS_OPEN` measure, else `measure_input`."""
    if getattr(m, "key", None) in COUNTS_OPEN:
        return rows
    return measure_input(source_key, rows)


def evaluate(m: Measure, source_key: str, rows: list[dict]) -> Cell:
    inp = rows_for(m, source_key, rows)
    if source_key == OPTIONS and rows and not inp:
        # only open strategies: listed, never measured -- "no data", never a $0 or a 0 count
        return Cell(None, 0, 0 if m.needs else None, "")
    mv = m.fn(inp)
    return Cell(_num(mv.value), int(mv.n), mv.have, small_sample(m, mv))
