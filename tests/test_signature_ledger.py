"""The append-only signal ledger — the receipts the brand positioning rests on.

Every invariant here is enforced INSIDE the store (wire/store.py precedent), so
these tests drive the store directly rather than a caller: a future writer that
bypasses the caller must still hit the same rails.
"""
import ast
import json
import sqlite3
import threading
import types
from pathlib import Path

import pytest

from api.services.signature import ledger

# The one signal every test starts from. Positional to match the shipped
# signature exactly — a reordered parameter list must break these loudly.
BASE = ("fcb", "fcb-v1", "NVDA", "1D", "bull", 20260730)


@pytest.fixture
def tmp_ledger(tmp_path, monkeypatch):
    p = tmp_path / "signal_ledger.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_DB_PATH", str(p))   # BOTH — env AND module constant
    monkeypatch.setattr(ledger, "_INITED", False)
    return p


def _rows_on_disk(path) -> int:
    """Row count read straight off the file, bypassing the module entirely.

    `get_signals() == []` alone cannot prove "inserted nothing" — a read-path
    bug would report empty over a table that has rows in it."""
    if not Path(path).exists():
        return 0
    with sqlite3.connect(str(path)) as c:
        try:
            return c.execute("SELECT COUNT(*) FROM signature_signals").fetchone()[0]
        except sqlite3.OperationalError:      # table not created yet
            return 0


# ── The brief's contract ──────────────────────────────────────────────────

def test_insert_then_duplicate_is_fire_once(tmp_ledger):
    assert ledger.record_signal("fcb", "fcb-v1", "NVDA", "1D", "bull", 1753900000, 182.5) is True
    assert ledger.record_signal("fcb", "fcb-v1", "NVDA", "1D", "bull", 1753900000, 182.5) is False
    rows = ledger.get_signals("NVDA")
    assert len(rows) == 1 and rows[0]["direction"] == "bull"


def test_first_seen_at_never_rewritten(tmp_ledger):
    ledger.record_signal("fcb", "fcb-v1", "AMD", "1D", "bear", 1753900000, 150.0)
    first = ledger.get_signals("AMD")[0]["first_seen_at"]
    ledger.record_signal("fcb", "fcb-v1", "AMD", "1D", "bear", 1753900000, 150.0)
    assert ledger.get_signals("AMD")[0]["first_seen_at"] == first


def test_get_signals_filters_and_orders(tmp_ledger):
    ledger.record_signal("fcb", "fcb-v1", "A", "1D", "bull", 100, 1.0)
    ledger.record_signal("fcb", "fcb-v1", "B", "1D", "bull", 200, 2.0)
    assert [r["sym"] for r in ledger.get_signals()] == ["B", "A"]
    assert len(ledger.get_signals("A")) == 1


# ── bar_time normalization: three upstream encodings, ONE dedup key ───────

def test_yyyymmdd_int_and_iso_string_key_the_same_session(tmp_ledger):
    """bars_sqlite daily ts is a YYYYMMDD int; the fetch layer hands the same
    session as "YYYY-MM-DD". Stored raw, one session keys two ways, the nightly
    sweep re-records what the request path already recorded, and fire-once —
    the entire point of this table — silently breaks."""
    assert ledger.record_signal(*BASE, 182.5) is True
    assert ledger.record_signal("fcb", "fcb-v1", "NVDA", "1D", "bull", "2026-07-30", 182.5) is False

    rows = ledger.get_signals("NVDA")
    assert len(rows) == 1
    assert rows[0]["bar_time"] == 20260730 and isinstance(rows[0]["bar_time"], int)


def test_iso_datetime_strings_dedup_to_the_same_row(tmp_ledger):
    """A timestamped ISO string is the same session as its date."""
    assert ledger.record_signal(*BASE, 182.5) is True
    for stamped in ("2026-07-30T00:00:00", "2026-07-30T15:59:00-04:00",
                    "2026-07-30 09:30:00", " 2026-07-30 "):
        assert ledger.record_signal(
            "fcb", "fcb-v1", "NVDA", "1D", "bull", stamped, 182.5) is False, stamped
    assert _rows_on_disk(tmp_ledger) == 1


def test_unparseable_bar_time_raises_and_inserts_nothing(tmp_ledger):
    """The ledger REFUSES an ambiguous key rather than guessing at one. There is
    no UPDATE path, so a key written wrong is wrong forever — failing loudly at
    the door is the only correction available to this store."""
    with pytest.raises(ValueError):
        ledger.record_signal("fcb", "fcb-v1", "NVDA", "1D", "bull", "garbage", 182.5)
    assert ledger.get_signals() == []
    assert _rows_on_disk(tmp_ledger) == 0


def test_every_hostile_bar_time_raises_valueerror_and_leaves_no_row(tmp_ledger):
    """Only ValueError may escape — a caller catching ValueError must not be
    blindsided by a TypeError from `int(None)` or an OverflowError from inf."""
    for bad in ("garbage", "", "   ", None, "not-a-date", "2026-13-45", "2026-02-30",
                "20-26-07", float("nan"), float("inf"), float("-inf"), [], {}, object()):
        with pytest.raises(ValueError):
            ledger.record_signal("fcb", "fcb-v1", "NVDA", "1D", "bull", bad, 182.5)
    assert _rows_on_disk(tmp_ledger) == 0


def test_epoch_and_numeric_string_forms_pass_through_unchanged(tmp_ledger):
    """An epoch int is already unambiguous — it must be stored verbatim (an
    intraday timeframe will key on it), and its string/float spellings are the
    same key."""
    assert ledger.record_signal("fcb", "fcb-v1", "NVDA", "5m", "bull", 1753900000, 182.5) is True
    for same in ("1753900000", 1753900000.0):
        assert ledger.record_signal(
            "fcb", "fcb-v1", "NVDA", "5m", "bull", same, 182.5) is False, same

    rows = ledger.get_signals("NVDA")
    assert len(rows) == 1 and rows[0]["bar_time"] == 1753900000


# ── The UNIQUE key: exactly six columns, no more, no fewer ────────────────

def test_every_component_of_the_unique_key_creates_a_new_row(tmp_ledger):
    """Mutation rail on the UNIQUE tuple. Dropping ANY column from it makes one
    of these variants collide and return False; the fire-once test above stays
    green either way, so this is the only place the key's membership is pinned."""
    assert ledger.record_signal(*BASE, 182.5) is True
    variants = {
        "indicator": ("dpl", "fcb-v1", "NVDA", "1D", "bull", 20260730),
        "version":   ("fcb", "fcb-v2", "NVDA", "1D", "bull", 20260730),
        "sym":       ("fcb", "fcb-v1", "AMD", "1D", "bull", 20260730),
        "tf":        ("fcb", "fcb-v1", "NVDA", "5m", "bull", 20260730),
        "direction": ("fcb", "fcb-v1", "NVDA", "1D", "bear", 20260730),
        "bar_time":  ("fcb", "fcb-v1", "NVDA", "1D", "bull", 20260731),
    }
    for field, args in variants.items():
        assert ledger.record_signal(*args, 182.5) is True, field
    assert _rows_on_disk(tmp_ledger) == 7


def test_price_and_meta_are_outside_the_dedup_key_and_never_rewrite_the_row(tmp_ledger):
    """A re-run that re-derives a slightly different price must NOT mint a second
    receipt, and must NOT edit the one that exists: the first observation is what
    was actually published. Widening the UNIQUE to include price fails the first
    assert; adding an upsert fails the last two."""
    assert ledger.record_signal(*BASE, 182.5) is True
    assert ledger.record_signal(*BASE, 999.0, {"note": "second pass"}) is False

    rows = ledger.get_signals()
    assert len(rows) == 1
    assert rows[0]["price"] == 182.5
    assert rows[0]["meta_json"] is None


def test_sym_is_upper_cased_on_both_write_and_read(tmp_ledger):
    """Case is a spelling, not a different ticker: 'nvda' and 'NVDA' are ONE
    session's signal, and either spelling must find it."""
    assert ledger.record_signal("fcb", "fcb-v1", "nvda", "1D", "bull", 20260730, 182.5) is True
    assert ledger.record_signal("fcb", "fcb-v1", "NVDA", "1D", "bull", 20260730, 182.5) is False

    assert ledger.get_signals()[0]["sym"] == "NVDA"
    assert len(ledger.get_signals("nvda")) == 1
    assert len(ledger.get_signals("NVDA")) == 1
    assert ledger.get_signals("amd") == []


# ── The row payload: pinned exactly, once ────────────────────────────────

def test_the_stored_row_shape_is_pinned_exactly(tmp_ledger):
    """Every other test reads two or three keys and would survive a renamed or
    dropped column. This is the one place the full receipt is pinned."""
    ledger.record_signal("fcb", "fcb-v1", "nvda", "1D", "bull", "2026-07-30", 182.5,
                         {"callPrem": 2_000_000.0, "putPrem": 0.0})
    row = ledger.get_signals()[0]

    assert set(row) == {"id", "indicator", "version", "sym", "tf", "direction",
                        "bar_time", "price", "first_seen_at", "meta_json"}
    assert row["id"] == 1
    assert row["indicator"] == "fcb"
    assert row["version"] == "fcb-v1"
    assert row["sym"] == "NVDA"
    assert row["tf"] == "1D"
    assert row["direction"] == "bull"
    assert row["bar_time"] == 20260730 and isinstance(row["bar_time"], int)
    assert row["price"] == 182.5 and isinstance(row["price"], float)
    assert isinstance(row["first_seen_at"], float) and row["first_seen_at"] > 1_700_000_000
    assert json.loads(row["meta_json"]) == {"callPrem": 2000000.0, "putPrem": 0.0}
    json.dumps(row, allow_nan=False)     # a private surface will serialize this


def test_absent_meta_is_stored_as_null(tmp_ledger):
    ledger.record_signal(*BASE, 182.5)
    ledger.record_signal("fcb", "fcb-v1", "AMD", "1D", "bull", 20260730, 1.0, {})
    assert [r["meta_json"] for r in ledger.get_signals()] == [None, None]


def test_first_seen_at_is_stamped_by_the_store_not_the_caller(tmp_ledger):
    """It is not a parameter — a caller cannot backdate a receipt."""
    import inspect
    params = list(inspect.signature(ledger.record_signal).parameters)
    assert "first_seen_at" not in params
    assert params == ["indicator", "version", "sym", "tf", "direction",
                      "bar_time", "price", "meta"]


# ── Non-finite numbers must never enter an append-only table ─────────────

def test_non_finite_price_is_refused_before_insert(tmp_ledger):
    """A NaN price cannot be corrected later (there is no UPDATE path) and would
    break `json.dumps(..., allow_nan=False)` on every future read of the whole
    list — one poisoned row takes the surface down, permanently."""
    for bad in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(ValueError):
            ledger.record_signal(*BASE, bad)
    assert _rows_on_disk(tmp_ledger) == 0


def test_meta_that_cannot_round_trip_as_json_is_refused_before_insert(tmp_ledger):
    for bad in ({"prem": float("nan")}, {"prem": float("inf")}, {"legs": {1, 2}}):
        with pytest.raises((ValueError, TypeError)):
            ledger.record_signal(*BASE, 182.5, bad)
    assert _rows_on_disk(tmp_ledger) == 0


# ── INSERT-only: no rewrite path may exist, dormant or live ──────────────

def test_no_update_statement_is_executed_on_any_path(tmp_ledger, monkeypatch):
    """Behavioural rail. `first_seen_at_never_rewritten` passes against an upsert
    that happens to re-stamp the same value; this watches the actual SQL. An
    `ON CONFLICT ... DO UPDATE` does not START with UPDATE, hence both checks."""
    seen = []
    real_connect = sqlite3.connect

    def spy_connect(*a, **k):
        conn = real_connect(*a, **k)
        conn.set_trace_callback(seen.append)
        return conn

    monkeypatch.setattr(ledger.sqlite3, "connect", spy_connect)
    ledger.record_signal(*BASE, 182.5)
    ledger.record_signal(*BASE, 182.5)      # the dedup path
    ledger.get_signals("NVDA")

    assert seen, "trace callback never fired — this test proves nothing"
    assert not [s for s in seen if s.lstrip().upper().startswith("UPDATE")], seen
    assert not [s for s in seen if "ON CONFLICT" in s.upper()], seen


def test_module_source_contains_no_update_statement():
    """Source rail for a DORMANT rewrite path the tests never execute. Reads only
    non-docstring string literals, so the module may still DOCUMENT that it has
    no UPDATE path (the brief's docstring does)."""
    tree = ast.parse(Path(ledger.__file__).read_text(encoding="utf-8"))
    docstrings = {ast.get_docstring(n, clean=False)
                  for n in ast.walk(tree)
                  if isinstance(n, (ast.Module, ast.FunctionDef,
                                    ast.AsyncFunctionDef, ast.ClassDef))}
    sql = [n.value for n in ast.walk(tree)
           if isinstance(n, ast.Constant) and isinstance(n.value, str)
           and n.value not in docstrings]
    offenders = [s for s in sql if "UPDATE" in s.upper()]
    assert not offenders, offenders


# ── Ordering, limit, and the store's dark/cold states ────────────────────

def test_rows_stamped_in_the_same_clock_tick_still_order_newest_first(tmp_ledger, monkeypatch):
    """`time.time()` is coarse on Windows, so two signals recorded in one sweep
    routinely share a first_seen_at. Ordering on that column ALONE is then
    undefined and the feed reorders itself between reads."""
    monkeypatch.setattr(ledger, "time", types.SimpleNamespace(time=lambda: 1753900000.0))
    ledger.record_signal("fcb", "fcb-v1", "A", "1D", "bull", 20260730, 1.0)
    ledger.record_signal("fcb", "fcb-v1", "B", "1D", "bull", 20260730, 2.0)
    ledger.record_signal("fcb", "fcb-v1", "C", "1D", "bull", 20260730, 3.0)

    rows = ledger.get_signals()
    assert [r["first_seen_at"] for r in rows] == [1753900000.0] * 3
    assert [r["sym"] for r in rows] == ["C", "B", "A"]


def test_limit_keeps_the_newest(tmp_ledger):
    for sym in ("A", "B", "C"):
        ledger.record_signal("fcb", "fcb-v1", sym, "1D", "bull", 20260730, 1.0)
    assert [r["sym"] for r in ledger.get_signals(limit=2)] == ["C", "B"]
    assert [r["sym"] for r in ledger.get_signals("C", limit=2)] == ["C"]
    assert ledger.get_signals(limit=0) == []


def test_reading_before_anything_is_ever_written_is_an_empty_list(tmp_ledger):
    """The dark state. wire/store.py 500ed in prod (2026-07-31) because its
    schema was created by an enabled-only scheduler block while the read path
    was live for everyone. Every entry point here inits lazily."""
    assert ledger.get_signals() == []
    assert ledger.get_signals("NVDA") == []


def test_a_missing_parent_directory_is_created(tmp_path, monkeypatch):
    """/data exists on Railway but not on a dev box or in CI."""
    p = tmp_path / "nested" / "deeper" / "signal_ledger.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_INITED", False)

    assert ledger.record_signal(*BASE, 182.5) is True
    assert p.exists()


def test_the_db_is_in_wal_mode(tmp_ledger):
    """The nightly sweep writes while a request path reads."""
    ledger.record_signal(*BASE, 182.5)
    with sqlite3.connect(str(tmp_ledger)) as c:
        assert c.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"


def test_concurrent_recorders_of_one_signal_fire_exactly_once(tmp_ledger):
    """Fire-once is a claim about a RACE — the request path and the nightly
    sweep can hit the same signal at the same instant. Deliberately does not
    pre-init: schema creation races too."""
    results = []
    guard = threading.Lock()
    barrier = threading.Barrier(8)

    def worker():
        barrier.wait()
        r = ledger.record_signal(*BASE, 182.5)
        with guard:
            results.append(r)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    assert not [t for t in threads if t.is_alive()], "a recorder deadlocked"
    assert results.count(True) == 1, results
    assert results.count(False) == 7, results
    assert _rows_on_disk(tmp_ledger) == 1


# ── The env var and the module constant are both real ────────────────────

def test_db_path_comes_from_the_env_var_and_defaults_to_the_railway_volume(monkeypatch):
    """The house double-patch fixture sets BOTH the env var and the module
    constant, which would pass even if the env var were never consulted. This is
    the one place the env name is proven live, and the default pinned."""
    import importlib
    try:
        monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", "/tmp/probe_signal_ledger.db")
        assert importlib.reload(ledger)._DB_PATH == "/tmp/probe_signal_ledger.db"

        monkeypatch.delenv("SIGNAL_LEDGER_DB_PATH")
        assert importlib.reload(ledger)._DB_PATH == "/data/signal_ledger.db"
    finally:
        monkeypatch.undo()
        importlib.reload(ledger)      # leave the module as the next test found it
