"""W4a — run-now as a JOB: one definition over ≤ 500 symbols the member named,
computed through the SWEEP'S OWN LOOP on a single-worker pool, written nowhere.

⭐ THE HASH IS THE SWEEP'S. `scan_run._run_job` — the function `_POOL` executes,
and the ONLY caller of `scan_evaluator.evaluate_one` in that module — calls it
with `mode='on-demand'`; the on-demand `def_hash` is therefore the nightly one by
construction, and `tests/test_phase_e_acceptance.py` reads both off the artifact.

⭐ ONE PARAMETER, `mode`, DECIDES PERSISTENCE (controller ruling 8/25, replacing
the brief's `persist=False`): `'nightly'` is byte-for-byte the sweep, `'live'` is
RESERVED for W4b.3, `'on-demand'` writes nothing, and anything else is refused
BEFORE a bar is read.

⛔ NOTHING IS TYPED THAT CAN BE DERIVED. The tree helpers, the bars fixture and
the session are IMPORTED from `tests/test_scan_evaluator.py`; the gate set is
derived from the sweep's; the pool's worker count and the `mode` literal are
read off `scan_run.py` by AST.

⚠️ THE WORKER IS A REAL THREAD. Every test that submits a job WAITS for it to
finish inside the test (`_run`), or gates the worker on an Event it releases
itself (`slow_worker`) — a job outliving its test would run against patches
that are already undone, i.e. against the real bars store, which the repo-root
`conftest.py` tripwire turns into a whole-run failure. `_drain` is the rail.
"""
from __future__ import annotations

import ast as pyast
import contextlib
import pathlib
import sqlite3
import threading
import time
from types import SimpleNamespace

import pytest

from api.services import user_definitions
from api.services.screener import scan_evaluator, scan_store, snapshot_db
from tests.test_scan_evaluator import (
    SESSION, TF, _daily_bars, _definition, _num, _op, _series,
)

ROOT = pathlib.Path(__file__).resolve().parents[1]

ALICE = "alice"
BOB = "bob"

DEF_ID = "u_0000000000aa"
#: `close > 100` — bars-only (no snapshot gate), and `_daily_bars(start_close=…)`
#: decides the answer per symbol: 150.. climbs above 100, 10.. never does.
DEFINITION = _definition(_op(">", _series("close"), _num(100)), def_id=DEF_ID)
DEF_HASH = DEFINITION["compute"]["fn"]


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A screener database of this test's own, PROVED to be the one in use."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    assert snapshot_db.get_db_path() == str(path)
    scan_store.init_db()
    return path


@pytest.fixture
def bars(monkeypatch):
    """A stub bars store keyed by ticker. Missing ticker == no bars."""
    from api.services import bars_sqlite
    table: dict = {}

    def _get(ticker, tf, max_bars):
        return list(table.get(str(ticker).upper()) or [])[-max_bars:]

    monkeypatch.setattr(bars_sqlite, "get_bars", _get)
    table["NVDA"] = _daily_bars(start_close=150.0)   # a hit
    table["INTC"] = _daily_bars(start_close=10.0)    # answered, not a hit
    return table


@pytest.fixture
def defs(tmp_path, monkeypatch):
    """ALICE owns DEF_ID. BOB owns nothing."""
    monkeypatch.setattr(user_definitions, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    user_definitions.save(ALICE, DEF_ID, DEFINITION)
    return DEF_ID


def _arm_writers(monkeypatch):
    """Every writer the nightly path touches, made to raise. ⛔ THE RAIL for
    'writes nothing' — a behavioural half beside the AST half below."""
    def _boom(*a, **k):
        raise AssertionError("the on-demand run wrote to the shared store")
    monkeypatch.setattr(scan_store, "record_hits", _boom)
    monkeypatch.setattr(scan_store, "record_coverage", _boom)
    monkeypatch.setattr(scan_evaluator, "_write_rule_record", _boom)


# ═══ the hand-back: `evaluate_one(..., mode=…)` ═════════════════════════════

def test_evaluate_one_mode_on_demand_WRITES_NOTHING_and_returns_hit_rows(store, bars, monkeypatch):
    """🔴 THE HAND-BACK'S RAIL. The nightly path writes three things; the
    on-demand path must write none of them and still answer with the same hash."""
    _arm_writers(monkeypatch)

    out = scan_evaluator.evaluate_one(
        DEFINITION, TF, universe=["NVDA", "INTC", "NOBARS"], as_of=SESSION, mode="on-demand")

    assert out["def_hash"] == DEF_HASH
    assert out["hits"] == ["NVDA"]
    assert out["hit_rows"] == [{"symbol": "NVDA", "value": 1.0, "bar_time": SESSION}]
    assert out["mode"] == "on-demand"
    assert out["persisted"] is False
    assert out["recorded"] == 0 and out["record_refused"] == 0
    assert out["evaluated"] == out["answered"] + out["dropped"] + out["not_computable"] == 3
    assert scan_store.coverage(DEF_HASH, TF, SESSION) is None


def test_and_mode_nightly_is_the_UNCHANGED_default(store, bars):
    """The control: without the keyword the sweep still files its receipt, so the
    hand-back changed nothing for the scheduler."""
    out = scan_evaluator.evaluate_one(DEFINITION, TF, universe=["NVDA", "INTC"], as_of=SESSION)
    assert out["mode"] == "nightly"
    assert out["persisted"] is True
    assert scan_store.coverage(DEF_HASH, TF, SESSION) is not None
    assert sorted(scan_store.hits(DEF_HASH, TF, SESSION)) == ["NVDA"]
    assert out["hit_rows"] == [{"symbol": "NVDA", "value": 1.0, "bar_time": SESSION}]


def test_mode_live_is_RESERVED_accepted_and_runs(store, bars):
    """`'live'` is W4b.3's branch. Until it lands the kwarg is ACCEPTED and the run
    completes; what it persists (`scan_hits_live`) is that lane's to pin, so this
    test deliberately does not."""
    out = scan_evaluator.evaluate_one(DEFINITION, TF, universe=["NVDA", "INTC"], as_of=SESSION, mode="live")
    assert out["mode"] == "live"
    assert out["evaluated"] == 2 and out["hits"] == ["NVDA"]
    assert "persisted" in out


def test_an_unknown_mode_is_refused_BEFORE_anything_is_read_or_written(store, bars, monkeypatch):
    """⛔ CLOSED SET. A mode nobody declared must not quietly behave as one of the
    three — it is the one authority over what a run writes."""
    _arm_writers(monkeypatch)
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("bars were read")))
    with pytest.raises(ValueError) as exc:
        scan_evaluator.evaluate_one(DEFINITION, TF, universe=["NVDA"], as_of=SESSION, mode="persist")
    assert "'persist'" in str(exc.value)
    assert scan_store.coverage(DEF_HASH, TF, SESSION) is None
