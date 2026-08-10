"""The monitor that notices the bars store is GONE.

🔴 WRITTEN AFTER 2026-08-10. `/data/bars.db` lost its `ohlcv` table mid-session,
charts were dead for a session, and `bars_continuous_audit` — the one thing
watching — stayed SILENT rather than going red. Two different ways:

  1. A missing table makes `get_last_ts` RAISE, so the first ticker aborted the
     sampling loop into an `except` that only logs.
  2. An intact-but-EMPTY table is worse: every read answers None, every tf hits
     `continue`, `hot_checked` lands on 0, and `if hot_checked:` skips the whole
     block. Not one log line.

⭐ BOTH ARE "THE DENOMINATOR WENT TO ZERO". A ratio over bars that exist is
structurally incapable of reporting their absence, so the fix is not a better
threshold — it is asking the artifact directly, first.
"""
import importlib
import sqlite3

import pytest

bs = importlib.import_module("api.services.bars_sqlite")
bca = importlib.import_module("api.services.bars_continuous_audit")
alerts = importlib.import_module("api.services.chart_health_alerts")


@pytest.fixture(autouse=True)
def _clean_alerts():
    """Alerts are throttled per key; without this the 2nd case silently no-ops."""
    alerts._throttle.clear()
    alerts._alerts.clear()
    yield
    alerts._throttle.clear()
    alerts._alerts.clear()


def _emitted():
    return [a for a in alerts._alerts if a["alert_key"] == "bars_store_unhealthy"]


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A real SQLite file standing in for the bars store."""
    conn = sqlite3.connect(str(tmp_path / "bars.db"))
    monkeypatch.setattr(bs, "_conn", lambda: conn)
    yield conn
    conn.close()


def _make_table(conn):
    conn.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INTEGER, c REAL)")


# --------------------------------------------------------------------------- #
# store_health reads the ARTIFACT
# --------------------------------------------------------------------------- #

def test_a_populated_store_is_healthy(store):
    _make_table(store)
    store.execute("INSERT INTO ohlcv VALUES ('SPY','D',1,1.0)")
    h = bs.store_health()
    assert h["ok"] is True and h["kind"] == bs.STORE_OK


def test_an_EMPTY_table_is_a_fault_of_its_own(store):
    """🔴 THE CASE THAT WAS COMPLETELY INVISIBLE. Nothing raises — every query
    just answers "no rows" — so the request path's exception handler can never
    see it. If this function did not name it, nothing would."""
    _make_table(store)
    h = bs.store_health()
    assert h["ok"] is False
    assert h["kind"] == bs.STORE_EMPTY


def test_a_MISSING_table_is_reported_as_schema_missing(store):
    h = bs.store_health()          # no CREATE TABLE at all
    assert h["ok"] is False
    assert h["kind"] == bs.STORE_SCHEMA_MISSING


def test_store_health_NEVER_raises_even_when_the_handle_is_dead(monkeypatch):
    """⛔ A health check that can crash its own caller is how the last one
    stayed quiet — the exception went to a log nobody was reading."""
    def boom():
        raise sqlite3.DatabaseError("database disk image is malformed")

    monkeypatch.setattr(bs, "_conn", boom)
    h = bs.store_health()
    assert h["ok"] is False and h["kind"] == bs.STORE_MALFORMED


def test_health_does_not_COUNT_the_table(store):
    """⛔ `COUNT(*)` on 119M rows is a table scan, and an expensive monitor gets
    its interval raised until it is useless.

    ⛔ ASSERTED OVER THE AST, NOT THE TEXT. A grep of the source matches the
    docstring's own "deliberately NOT COUNT(*)" and fails on the explanation
    for the rule it is enforcing — a probe that reads prose as code
    (`lesson_probe_names_must_be_derived_not_typed`).
    """
    import ast
    import inspect
    import textwrap

    tree = ast.parse(textwrap.dedent(inspect.getsource(bs.store_health)))
    fn = tree.body[0]
    # ⛔ Drop the docstring node before walking. It EXPLAINS the rule ("one
    # SELECT 1 ... LIMIT 1", "deliberately NOT COUNT(*)"), so leaving it in
    # makes the probe grade the justification instead of the query.
    if (fn.body and isinstance(fn.body[0], ast.Expr)
            and isinstance(fn.body[0].value, ast.Constant)
            and isinstance(fn.body[0].value.value, str)):
        fn.body = fn.body[1:]
    sql = [n.value.upper() for n in ast.walk(fn)
           if isinstance(n, ast.Constant) and isinstance(n.value, str)
           and "SELECT" in n.value.upper()]
    assert sql, "no SQL literal found in store_health"
    assert all("COUNT(" not in q for q in sql), f"store_health scans: {sql}"
    assert any("LIMIT 1" in q for q in sql), f"store_health is unbounded: {sql}"


# --------------------------------------------------------------------------- #
# one authority for the classification
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("msg,expected", [
    ("no such table: ohlcv", bs.STORE_SCHEMA_MISSING),
    ("database disk image is malformed", bs.STORE_MALFORMED),
    ("file is not a database", bs.STORE_MALFORMED),
    ("database is locked", bs.STORE_TRANSIENT),
])
def test_classify_fault(msg, expected):
    assert bs.classify_fault(Exception(msg)) == expected


def test_a_malformed_image_reporting_a_missing_table_is_NOT_self_repairable():
    """⛔ ORDER MATTERS. A corrupt image can report a missing table as a
    SYMPTOM; classifying that as `schema-missing` would run CREATE TABLE
    against damage and mask the one fault that needs a human."""
    both = Exception("no such table: ohlcv (database disk image is malformed)")
    assert bs.classify_fault(both) == bs.STORE_MALFORMED


def test_the_router_and_the_monitor_share_ONE_classifier():
    """⛔ Two copies would let the request path and the alert tell an operator
    different stories about one database."""
    import inspect
    from api.routers import bars as bars_router

    assert bars_router._fault_kind(Exception("no such table: ohlcv")) == \
        bs.classify_fault(Exception("no such table: ohlcv"))
    src = inspect.getsource(bars_router._fault_kind)
    assert "classify_fault" in src, "the router grew its own copy of the rules"
    assert "no such table" not in src, "the router is re-implementing the rules"


# --------------------------------------------------------------------------- #
# the monitor actually FIRES — and stays quiet when it should
# --------------------------------------------------------------------------- #

def _stub_freshness(monkeypatch, hot=("SPY",)):
    """Neutralise everything downstream of the store check so these tests speak
    only about the store check."""
    import api.services.bars_fetch as bf
    monkeypatch.setattr(bf, "get_hot_intraday_tickers", lambda n: list(hot))
    monkeypatch.setattr(bf, "_is_cold_stale_intraday", lambda tf, ts: False)


@pytest.mark.parametrize("kind", [
    bs.STORE_EMPTY, bs.STORE_SCHEMA_MISSING, bs.STORE_MALFORMED,
])
def test_the_monitor_goes_CRITICAL_on_an_unhealthy_store(kind, monkeypatch):
    _stub_freshness(monkeypatch)
    monkeypatch.setattr(bs, "store_health",
                        lambda: {"ok": False, "kind": kind, "detail": "x"})
    bca._run_5min_check()

    fired = _emitted()
    assert fired, f"the store was {kind} and the monitor said NOTHING"
    assert fired[0]["severity"] == "critical"
    assert kind in fired[0]["message"], "the alert must NAME the fault"


def test_the_monitor_STOPS_rather_than_burying_the_outage(monkeypatch):
    """⛔ Continuing would compute freshness from rows the store cannot produce
    and bury a total outage under '0/0 cold' noise."""
    _stub_freshness(monkeypatch)
    monkeypatch.setattr(bs, "store_health",
                        lambda: {"ok": False, "kind": bs.STORE_EMPTY, "detail": ""})

    touched = []
    monkeypatch.setattr(bs, "get_last_ts",
                        lambda t, tf: touched.append((t, tf)))
    bca._run_5min_check()
    assert touched == [], "it sampled freshness against a store that has no rows"


def test_THE_CONTROL_a_healthy_store_emits_NOTHING(monkeypatch):
    """⛔ Without this, an unconditional `emit` would satisfy every case above
    and the whole rail would be theatre (`lesson_gate_that_cannot_fail`)."""
    _stub_freshness(monkeypatch)
    monkeypatch.setattr(bs, "store_health",
                        lambda: {"ok": True, "kind": bs.STORE_OK, "detail": ""})
    monkeypatch.setattr(bs, "get_last_ts", lambda t, tf: 1_700_000_000)
    monkeypatch.setattr(bs, "get_all_tickers", lambda: [])
    bca._run_5min_check()
    assert _emitted() == [], "a healthy store raised a store alert"


def test_the_wire_is_load_bearing(monkeypatch):
    """⭐ THE TEST THAT REDS WHEN THE WIRE IS CUT while both parts stay correct
    — the shape the 2026-08-08 audit said was missing everywhere. If someone
    deletes the `store_health()` call from the monitor, `store_health` still
    passes its own tests and `emit` still works; only this fails."""
    import inspect
    src = inspect.getsource(bca._run_5min_check)
    assert "store_health()" in src, "the monitor no longer asks the store"
    assert "bars_store_unhealthy" in src, "the monitor no longer alerts on it"
