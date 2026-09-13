"""D2 CP3 — the durable dual-compute sample store.

⚰️ The gate this replaces was *"200 production samples, zero inequality"* against
an IN-PROCESS counter, on a pod that redeployed 167 commits' worth in one day. It
was unreachable by construction. These tests pin the properties that make the
replacement reachable AND honest.
"""
from __future__ import annotations

import os
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services.canonical import dual_sample_store as store

_ET = ZoneInfo("America/New_York")

# A Wednesday inside RTH, and the same day outside it.
RTH = datetime(2026, 9, 16, 11, 0, tzinfo=_ET)
PRE = datetime(2026, 9, 16, 7, 0, tzinfo=_ET)
OPENISH = datetime(2026, 9, 16, 9, 40, tzinfo=_ET)
CLOSEISH = datetime(2026, 9, 16, 15, 50, tzinfo=_ET)
SAT = datetime(2026, 9, 19, 11, 0, tzinfo=_ET)


@pytest.fixture(autouse=True)
def _fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv(store.ENABLED_ENV, raising=False)
    monkeypatch.delenv(store.PERSIST_PCT_ENV, raising=False)
    monkeypatch.delenv(store.RTH_ONLY_ENV, raising=False)
    store.init_db()
    yield


def _fill(n, *, outcome="agreed", when=RTH, reader="ticker_returns._close"):
    for i in range(n):
        assert store.record(reader, "ohlcv.c", 1.0 + i, 1.0 + i, outcome, now=when)


# ─────────────────────────── the durability property ────────────────────────

def test_a_sample_survives_the_process_that_wrote_it():
    """⭐ THE WHOLE POINT. The old ledger was a module-level list."""
    _fill(3)
    import importlib
    importlib.reload(store)          # a new "process" reading the same DATA_DIR
    assert store.gate_status()["rows"] == 3


def test_the_store_lives_under_DATA_DIR_not_a_module_global(tmp_path):
    assert str(tmp_path) in store.db_path()


# ───────────────────── it must never change what is served ──────────────────

def test_record_never_raises_even_when_the_database_is_unusable(tmp_path, monkeypatch):
    # ⚰️ This pointed DATA_DIR at a string containing a NUL byte. os.environ
    # refuses to hold one, so the ValueError came out of monkeypatch and the
    # module under test was never reached — a test that failed red without ever
    # exercising its subject, which is the same class of lie as a test that
    # passes green without exercising it. A path *inside a regular file* is a
    # real unopenable database path.
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x", encoding="utf-8")
    monkeypatch.setenv("DATA_DIR", str(blocker / "nested"))
    assert store.record("r", "k", 1, 1, "agreed", now=RTH) is False


def test_gate_status_never_raises_and_says_so_when_it_could_not_read(tmp_path, monkeypatch):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x", encoding="utf-8")
    monkeypatch.setenv("DATA_DIR", str(blocker / "nested"))
    s = store.gate_status()
    assert s["observed"] is False
    assert "NOT zero samples" in s["why"], (
        "an unreadable store must not be reported as an empty one")


def test_the_serving_path_is_unchanged_by_a_dead_store(monkeypatch):
    """observe() returns legacy on every branch — including a broken store."""
    from api.services.canonical import dual_read
    monkeypatch.setattr(store, "record",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    assert dual_read.observe("ohlcv.c", 42.0, 42.0) == 42.0


# ───────────────── the three outcomes stay three, not two ───────────────────

def test_book_unavailable_is_NULL_equal_and_is_never_folded_into_disagreed():
    """⛔ Folding it into equal=0 makes a deleted manifest read as a wrong answer."""
    store.record("r", "ohlcv.c", 1.0, None, "book_unavailable", now=RTH)
    store.record("r", "ohlcv.c", 1.0, 2.0, "disagreed", now=RTH)
    store.record("r", "ohlcv.c", 1.0, 1.0, "agreed", now=RTH)
    import sqlite3
    con = sqlite3.connect(store.db_path())
    rows = dict(con.execute("SELECT outcome, equal FROM d2_dual_samples").fetchall())
    con.close()
    assert rows["book_unavailable"] is None
    assert rows["disagreed"] == 0
    assert rows["agreed"] == 1
    s = store.gate_status()
    assert s["disagreed"] == 1 and s["book_unavailable"] == 1


# ─────────────────────────── the RTH sampling rule ──────────────────────────

def test_it_records_during_RTH():
    assert store.record("r", "k", 1, 1, "agreed", now=RTH) is True


def test_it_does_NOT_record_premarket_or_on_a_weekend():
    assert store.record("r", "k", 1, 1, "agreed", now=PRE) is False
    assert store.record("r", "k", 1, 1, "agreed", now=SAT) is False
    assert store.gate_status()["rows"] == 0


def test_the_kill_switch_is_an_env_var_and_never_a_delete(monkeypatch):
    """⛔ STANDING OWNER RULE: stopping a dark run must never be a DELETE against
    collected data. Turning this off must leave every existing row in place."""
    _fill(4)
    monkeypatch.setenv(store.ENABLED_ENV, "0")
    assert store.record("r", "k", 1, 1, "agreed", now=RTH) is False
    assert store.gate_status()["rows"] == 4, "the kill switch destroyed evidence"


def test_the_fraction_is_read_at_call_time_not_bound_at_import(monkeypatch):
    """F-S7-5 cost this programme a wrong finding for exactly this reason."""
    monkeypatch.setenv(store.PERSIST_PCT_ENV, "0")
    assert store.should_persist(RTH) is False
    monkeypatch.setenv(store.PERSIST_PCT_ENV, "100")
    assert store.should_persist(RTH) is True


def test_market_hours_come_from_the_ONE_existing_authority():
    """⛔ A second copy of 09:30-16:00 would be a second authority over one value."""
    src = open("api/services/canonical/dual_sample_store.py", encoding="utf-8").read()
    assert "from api.services.bars_liveness import is_market_open" in src
    assert "930" not in src and "1600" not in src, (
        "market-hours literals have been restated in this module")


# ──────────────────────────────── the gate ──────────────────────────────────

def test_an_empty_store_LEADS_with_what_it_observed_not_with_four_zeroes():
    s = store.gate_status()
    assert s["rows"] == 0 and s["gate_met"] is False
    assert "not 'no disagreements'" in s["why"]


def test_the_gate_is_NOT_met_below_two_hundred_rows():
    _fill(199, when=RTH)
    s = store.gate_status()
    assert s["gate_met"] is False
    assert "199 AGREED rows" in s["why"]


def test_two_hundred_rows_that_do_not_span_a_session_do_NOT_meet_the_gate():
    """200 rows all at 11:00 is not a trading session."""
    _fill(200, when=RTH)
    s = store.gate_status()
    assert s["gate_met"] is False
    assert "no session yet spans" in s["why"]


def test_the_gate_is_met_by_two_hundred_rows_spanning_one_session_with_zero_inequality():
    store.record("r", "ohlcv.c", 1.0, 1.0, "agreed", now=OPENISH)
    _fill(198, when=RTH)
    store.record("r", "ohlcv.c", 1.0, 1.0, "agreed", now=CLOSEISH)
    s = store.gate_status()
    assert s["rows"] == 200
    assert s["gate_met"] is True, s["why"]
    assert len(s["covered_sessions"]) == 1


def test_ONE_inequality_fails_the_gate_however_many_rows_agree():
    store.record("r", "ohlcv.c", 1.0, 1.0, "agreed", now=OPENISH)
    _fill(198, when=RTH)
    store.record("r", "ohlcv.c", 1.0, 2.0, "disagreed", now=CLOSEISH)
    s = store.gate_status()
    assert s["rows"] == 200 and s["gate_met"] is False
    assert "INEQUALITIES" in s["why"]


def test_a_book_unavailable_run_does_not_quietly_satisfy_the_gate():
    """⛔ 200 rows of 'the book could not answer' is not 200 rows of agreement.
    It has zero inequalities, so a naive gate would PASS on a deleted manifest."""
    store.record("r", "ohlcv.c", 1.0, None, "book_unavailable", now=OPENISH)
    _fill(198, outcome="book_unavailable", when=RTH)
    store.record("r", "ohlcv.c", 1.0, None, "book_unavailable", now=CLOSEISH)
    s = store.gate_status()
    assert s["book_unavailable"] == 200 and s["agreed"] == 0
    assert s["gate_met"] is False, (
        "the gate passed on 200 samples where the book never answered — "
        "zero inequality is not the same as zero disagreement")


# ────────────────────────── append-only, and no prune ───────────────────────

def test_the_module_contains_no_prune_and_no_update():
    """⚰️ `scan_store.prune` had zero callers, so retention was an ABSENCE
    pretending to be a policy. Do not repeat it here."""
    src = open("api/services/canonical/dual_sample_store.py", encoding="utf-8").read()
    assert "def prune" not in src
    assert "UPDATE d2_dual_samples" not in src
    # the one DELETE is the test fixture, and it says so
    assert src.count("DELETE FROM d2_dual_samples") == 1
    assert "TESTS ONLY" in src


def test_the_reader_is_recorded_so_a_second_migrated_reader_is_distinguishable():
    store.record("ticker_returns._close", "ohlcv.c", 1.0, 1.0, "agreed", now=RTH)
    store.record("some_future_reader", "ohlcv.o", 1.0, 1.0, "agreed", now=RTH)
    assert store.gate_status()["readers"] == ["some_future_reader", "ticker_returns._close"]


def test_the_one_migrated_reader_names_itself_at_the_call_site():
    src = open("api/services/ticker_returns.py", encoding="utf-8").read()
    assert 'reader="ticker_returns._close"' in src, (
        "the only migrated reader passes no name, so every row would say 'unknown'")


# ─────────────────────────────────────────────────────────────────────────────
# ⚰️ THE STORE SHIPPED WITH init_db() WIRED INTO NOTHING.
#
# On the pod every record() raised `no such table: d2_dual_samples`, was
# swallowed by the never-raises contract, and returned False. Monday would have
# collected ZERO rows, and a zero here is indistinguishable from a cold reader.
#
# ⛔ THE SUITE COULD NOT SEE IT because the fixture above calls init_db(), which
# production never did. A fixture that performs a step production omits is blind
# to the step being missing — it was caught by an in-pod read instead.
#
# These tests deliberately DO NOT use that fixture's init.
# ─────────────────────────────────────────────────────────────────────────────

def test_record_works_on_a_VIRGIN_data_dir_with_no_explicit_init(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "virgin"))
    (tmp_path / "virgin").mkdir()
    import importlib
    importlib.reload(store)                    # a fresh process, nothing initialised
    assert store.record("r", "ohlcv.c", 1.0, 1.0, "agreed", now=RTH) is True, (
        "record() failed on a database nobody had created — this is the defect that "
        "would have collected nothing on Monday")
    assert store.gate_status()["rows"] == 1


def test_gate_status_works_on_a_VIRGIN_data_dir_and_reports_ZERO_not_UNREADABLE(
        tmp_path, monkeypatch):
    """⛔ The two must stay distinguishable. Before the fix a virgin store read as
    'could not be read', which is the right words for the wrong reason."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "virgin2"))
    (tmp_path / "virgin2").mkdir()
    import importlib
    importlib.reload(store)
    s = store.gate_status()
    assert s["observed"] is True, "a virgin store reported as unreadable"
    assert s["rows"] == 0
    assert "not 'no disagreements'" in s["why"]
