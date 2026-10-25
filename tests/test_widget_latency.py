"""Task 10.5 -- formula evaluation inside the run budget (spec 5.7, W9-R17).

Two readings:

* the formula evaluation alone: 5 formulas of 30 tokens each over the scan's cap (5,000 rows),
  `aggregate.evaluate` median of 5 under `FORMULA_BUDGET_S` -- always run, no database;
* the whole run on 5,000 seeded trades (the scan's cap) with those 5 formulas, under a generous
  `RUN_CEILING_S` -- always run, so a large regression in the run path goes red in a normal suite;
* the whole run on the 50,000-trade fixture with those 5 formulas: under `run.DEADLINE_S`, the
  formula evaluation under `FORMULA_BUDGET_S`, median of 5 -- opt-in (`UCT_WIDGET_50K=1`), because
  seeding 50,000 trades is slow (the Task 8.7 budget's own switch).

⚠️ Timings on a loaded box run 1.5-2x slower (the 10.2 ledger's 0.44 s busy-box reading); read a
miss on a quiet machine before calling it a regression.
"""
from __future__ import annotations

import os
import statistics
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two import widget_formula as wf
from api.services.journal_two.widget_engine import aggregate as A
from api.services.journal_two.widget_engine import plan as P
from api.services.journal_two.widget_engine import run
from api.services.journal_two.widget_engine import sources as S
from tests.test_widget_sources import UID, conn  # noqa: F401 -- `conn` is a fixture used by name

FORMULA_BUDGET_S = 0.300
#: Generous on purpose (a loaded box runs 1.5-2x slow): it catches a large regression, not drift.
RUN_CEILING_S = 3.0
NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)

#: Five formulas of exactly 30 tokens each (railed below), every kind the dialect evaluates.
EXPRS = (
    "If([net] > 0, [net] / Max([risk_dollars], 1), Round([r] * 2, 2) - Abs(-[fees]))",
    "Round(([gross] - [fees]) / Max([shares], 1), 2) + Abs([r]) * 2 - [r] * 3 + 4",
    "If(And([net] > 0, [r] >= 1), [net] * 2, If([r] < 0, [r] * 3, [fees]))",
    "Max([net], [gross], [fees]) - Min([net], [gross], [fees]) + Round([r] * 10, 1) + 1 + 2",
    "Round([hold_days] * 2 + Abs([net]) / Max([risk_dollars], 1) - [fees] / 3, 2) + [r] * 2 + 1",
)


def _plan() -> dict:
    return P.validate_plan({
        "v": 1, "source": "closed_trades", "range": {"token": "all"},
        "formulas": [{"id": f"f{i + 1}", "name": f"Field {i + 1}", "expr": e, "format": "number"}
                     for i, e in enumerate(EXPRS)],
        "measures": [{"formula": "f1", "agg": "avg"}, {"formula": "f2", "agg": "sum"},
                     {"formula": "f5", "agg": "max"}],
        "split": {"by": "setup"}, "view": {"type": "bar"}}, S.CATALOG)


def test_the_five_formulas_are_thirty_tokens_each():
    assert [len(wf._tokenize(e)) for e in EXPRS] == [30] * 5


def _rows(n: int) -> list[dict]:
    d0 = date(2020, 1, 1)
    out = []
    for i in range(n):
        net = float((i % 21) - 10) * 10
        out.append({"day": (d0 + timedelta(days=i % 2000)).isoformat(), "net": net,
                    "gross": net + 1.0, "fees": 1.0, "r": (i % 9 - 4) / 2 or None,
                    "risk_dollars": 50.0 if i % 7 else None, "shares": 10.0,
                    "hold_days": float(i % 5), "setup": ("Flag", "VCP", "EP", None)[i % 4],
                    "result": "Win" if net > 0 else "Loss", "flagged": False, "id": str(i)})
    return out


def test_formula_evaluation_over_the_scan_cap_under_budget():
    p = _plan()
    rows = _rows(5000)
    times = []
    for _ in range(5):
        t = time.perf_counter()
        res = A.evaluate(rows, p, S.CATALOG, check=lambda: None)
        times.append(time.perf_counter() - t)
    assert res.count == 5000 and len(res.groups) == 4
    assert statistics.median(times) < FORMULA_BUDGET_S, times


def _seed(c, n):
    setups = ["Flag", "VCP", "Breakout", "Pullback", None, "Gap", "EP", "Base"]
    rows = []
    for i in range(n):
        day = f"2026-{(i % 9) + 1:02d}-{(i % 28) + 1:02d}"
        rows.append((str(uuid.uuid4()), UID, "manual", "NVDA", "Long", 10, 100.0, f"{day}T14:00:00Z",
                     110.0, f"{day}T18:00:00Z", 95.0, setups[i % len(setups)],
                     float((i % 21) - 10) * 10, 0.01, 1.0, 1, "Win" if i % 2 else "Loss", "{}",
                     "x", day, 10, 0.5, 0))
    c.executemany(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,
               exit_price, exit_date, original_stop, setup, pnl_dollar, pnl_percent, r_multiple,
               hold_days, result, context_at_entry, created_at, trading_day_et, hour_et, fees,
               analytics_excluded)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows)
    c.commit()


def test_a_5k_trade_run_with_five_formulas_stays_under_a_generous_ceiling(conn, monkeypatch):
    """Fix round 1 (m-5): default-on. The scan caps at 5,000 rows whatever the book's size, so a
    5,000-trade book is the run's real worst case; median of 3 under `RUN_CEILING_S`."""
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "wlat5k",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    _seed(conn, 5000)
    p = _plan()
    totals = []
    for _ in range(3):
        run._reset_state()
        t0 = time.perf_counter()
        out = run.run_plan(UID, p, {}, lane="run", now=NOW)
        totals.append(time.perf_counter() - t0)
    assert out["count"] == 5000
    assert statistics.median(totals) < RUN_CEILING_S, totals


@pytest.mark.skipif(os.environ.get("UCT_WIDGET_50K") != "1",
                    reason="seeding 50,000 trades is slow; set UCT_WIDGET_50K=1 to measure")
def test_run_50k_trades_with_five_formulas_under_budget(conn, monkeypatch, capsys):
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "wlat",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    setups = ["Flag", "VCP", "Breakout", "Pullback", None, "Gap", "EP", "Base"]
    rows = []
    for i in range(50_000):
        day = f"2026-{(i % 9) + 1:02d}-{(i % 28) + 1:02d}"
        rows.append((str(uuid.uuid4()), UID, "manual", "NVDA", "Long", 10, 100.0, f"{day}T14:00:00Z",
                     110.0, f"{day}T18:00:00Z", 95.0, setups[i % len(setups)],
                     float((i % 21) - 10) * 10, 0.01, 1.0, 1, "Win" if i % 2 else "Loss", "{}",
                     "x", day, 10, 0.5, 0))
    conn.executemany(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,
               exit_price, exit_date, original_stop, setup, pnl_dollar, pnl_percent, r_multiple,
               hold_days, result, context_at_entry, created_at, trading_day_et, hour_et, fees,
               analytics_excluded)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows)
    conn.commit()
    p = _plan()
    real_eval = A.evaluate
    spent: list[float] = []

    def timed(*a, **k):
        t = time.perf_counter()
        try:
            return real_eval(*a, **k)
        finally:
            spent.append(time.perf_counter() - t)

    monkeypatch.setattr(run.waggregate, "evaluate", timed)
    totals, evals = [], []
    for _ in range(5):
        run._reset_state()
        spent.clear()
        t0 = time.perf_counter()
        out = run.run_plan(UID, p, {}, lane="run", now=NOW)
        totals.append(time.perf_counter() - t0)
        evals.append(sum(spent))
    with capsys.disabled():
        print(f"\n50k + 5 formulas: total median {statistics.median(totals):.3f}s, "
              f"evaluate median {statistics.median(evals):.3f}s, count={out['count']}")
    assert out["capped"] is True and out["count"] == 5000
    assert statistics.median(totals) < run.DEADLINE_S
    assert statistics.median(evals) < FORMULA_BUDGET_S
