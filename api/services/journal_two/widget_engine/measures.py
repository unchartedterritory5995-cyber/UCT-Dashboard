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
   trades (spec 5.4), so a quiet session is left out here, never inside a measure.
3. `evaluate(measure, source_key, rows) -> Cell`: the value, its count, how many rows carry what
   the measure needs, and the small-sample state (`measures.small_sample`).

Pure: no I/O, no clock.
"""
from __future__ import annotations

from dataclasses import dataclass

from api.services.journal_two.measures import (
    DEFAULT_MIN_N, MEASURES, Measure, MeasureValue, small_sample,
)
from api.services.journal_two.notebook_widgets import _num

POSITIONS = "open_positions"
TRADING_DAYS = "trading_days"


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


def builder_measures() -> dict[str, Measure]:
    """Every measure a widget may pick: the shared module's offered ones plus the positions ones."""
    out = {k: m for k, m in MEASURES.items() if m.sources}
    for k, m in POSITION_MEASURES.items():
        assert k not in out, f"position measure {k} shadows a shared measure"
        out[k] = m
    return out


def measures_for(source_key: str) -> dict[str, Measure]:
    return {k: m for k, m in builder_measures().items() if source_key in m.sources}


def measure_input(source_key: str, rows: list[dict]) -> list[dict]:
    """The rows a measure reads. Trading days: only days with trades (spec 5.4)."""
    if source_key == TRADING_DAYS:
        return [r for r in rows if (r.get("trade_count") or 0) > 0]
    return rows


def evaluate(m: Measure, source_key: str, rows: list[dict]) -> Cell:
    mv = m.fn(measure_input(source_key, rows))
    return Cell(_num(mv.value), int(mv.n), mv.have, small_sample(m, mv))
