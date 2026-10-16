"""The nightly scan sweep excludes the rows an interactive scan excludes.

PR #340 made `query.stale_gate` keep a row out of every interactive scan when its
own `bars_asof` is more than `snapshot_builder.stale_price_sessions()` behind the
snapshot's newest. The saved-scan sweep (`scan_evaluator.evaluate_one`) reads
`screener_rows` without `query.py`, so a saved screen could still hit, alert and
report "new names" on a dead name. These rails pin that the sweep now asks the
SAME gate, books each exclusion as `dropped` (reason `stale-bars`), keeps its
closed identity, and writes the count where it writes its coverage.
"""
from __future__ import annotations

import pytest

from api.services.screener import scan_evaluator
from api.services.screener import scan_store
from api.services.screener import snapshot_builder
from tests.test_scan_evaluator import (  # noqa: F401  (fixtures by name)
    PRICE_TREE, SCALAR_TREE, SESSION, TF, _daily_bars, _definition, _snapshot,
    bars, clock, store)

FRESH = ["AAA", "BBB", "CCC"]
DEAD = "DEAD"
#: Months behind the fresh rows: past any threshold a real night could produce.
DEAD_ASOF = "20260601"


def _seed(bars):
    rows = {s: {"market_cap": 2e9, "bars_asof": str(SESSION)} for s in FRESH}
    rows[DEAD] = {"market_cap": 2e9, "bars_asof": DEAD_ASOF}
    _snapshot(rows)
    # ⭐ The dead name's BARS are current for the session, so the per-bar
    # `stale-bars` check cannot be what excludes it: only the row gate can.
    for s in FRESH + [DEAD]:
        bars[s] = _daily_bars()
    return FRESH + [DEAD]


def test_a_row_the_interactive_scan_excludes_is_DROPPED_by_the_sweep(store, bars):
    universe = _seed(bars)
    r = scan_evaluator.evaluate_one(_definition(SCALAR_TREE), TF,
                                    universe=universe, as_of=SESSION)
    assert DEAD not in r["hits"]
    assert sorted(r["hits"]) == sorted(FRESH)
    assert r["stale_excluded"] == 1
    assert r["dropped"] == 1 and r["not_computable"] == 0
    assert r["evaluated"] == r["answered"] + r["dropped"] + r["not_computable"]
    [entry] = r["dropped_symbols"]
    assert entry["ticker"] == DEAD and entry["reason"] == "stale-bars"
    assert entry["reason"] in scan_evaluator.DROP_REASONS
    assert DEAD_ASOF in entry["detail"]


def test_the_sweep_excludes_EXACTLY_the_set_the_interactive_gate_excludes(store, bars):
    """One predicate: the sweep's excluded set is `query.stale_gate`'s negation."""
    from api.services.screener import query, snapshot_db
    _seed(bars)
    with snapshot_db.connect() as conn:
        gate = query.stale_gate(conn)
        excluded = {r[0] for r in conn.execute(
            f"SELECT ticker FROM screener_rows WHERE NOT {gate['sql']}",
            gate["params"])}
    assert excluded == {DEAD}
    _gate, stale = scan_evaluator._stale_rows()
    assert set(stale) == excluded


def test_the_threshold_is_the_builders_and_moving_it_moves_the_sweep(
        store, bars, monkeypatch):
    """⛔ No restated threshold: widen `stale_price_sessions` and the dead row is
    screened again. A literal in the sweep would leave it excluded."""
    universe = _seed(bars)
    monkeypatch.setenv("SCREENER_STALE_PRICE_SESSIONS", "400")
    assert snapshot_builder.stale_price_sessions() == 400
    r = scan_evaluator.evaluate_one(_definition(SCALAR_TREE), TF,
                                    universe=universe, as_of=SESSION)
    assert r["stale_excluded"] == 0
    assert DEAD in r["hits"]


def test_a_bars_only_tree_never_reads_the_row_and_is_not_gated(store, bars):
    """The gate applies where its reason applies: a tree naming no scalar reads
    nothing from `screener_rows`, and its own bars are held to the session."""
    universe = _seed(bars)
    r = scan_evaluator.evaluate_one(_definition(PRICE_TREE), TF,
                                    universe=universe, as_of=SESSION)
    assert r["stale_excluded"] == 0
    assert DEAD in r["hits"]


def test_no_stale_row_means_nothing_changes(store, bars):
    """The control: with every row current the gate does not bite at all."""
    _snapshot({s: {"market_cap": 2e9, "bars_asof": str(SESSION)} for s in FRESH})
    for s in FRESH:
        bars[s] = _daily_bars()
    r = scan_evaluator.evaluate_one(_definition(SCALAR_TREE), TF,
                                    universe=FRESH, as_of=SESSION)
    assert r["stale_excluded"] == 0 and r["dropped"] == 0
    assert sorted(r["hits"]) == sorted(FRESH)


def test_the_exclusion_is_RECORDED_in_the_coverage_receipt_and_the_sweep(
        store, bars, clock):
    universe = _seed(bars)
    d = _definition(SCALAR_TREE)
    out = scan_evaluator.run_sweep([d], TF, universe=universe, as_of=SESSION)
    assert out["swept"] == 1
    assert out["stale_excluded"] == 1
    r = scan_evaluator.evaluate_one(d, TF, universe=universe, as_of=SESSION,
                                    mode=scan_evaluator.ON_DEMAND)
    cov = scan_store.coverage(r["def_hash"], TF, SESSION)
    assert cov is not None
    assert cov["dropped"] == 1
    assert cov["evaluated"] == cov["answered"] + cov["dropped"] + cov["not_computable"]
    assert [e["reason"] for e in cov["dropped_symbols"]] == ["stale-bars"]
    assert DEAD not in scan_store.hits_for(r["def_hash"], TF)["rows"] and all(
        (row.get("symbol") if isinstance(row, dict) else row) != DEAD
        for row in scan_store.hits_for(r["def_hash"], TF)["rows"])
