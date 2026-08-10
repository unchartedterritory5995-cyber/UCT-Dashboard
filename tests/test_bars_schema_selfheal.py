"""The bars endpoint's fault classification and schema self-repair.

🔴 WRITTEN AFTER 2026-08-10, WHERE THIS EXACT GAP COST A TRADING SESSION.
`/data/bars.db` lost its `ohlcv` table mid-session. `init_db()` runs only at
STARTUP, so nothing recreated it, and every request returned 503 with
`error: "transient"` until a human restarted the pod.

⛔ THE LABEL WAS THE EXPENSIVE PART. "transient" is honest about the condition the
handler was written for — the ~30 s SQLite inode swap during `force_resync` — and
badly wrong about a table that is simply gone. An operator reading "transient"
goes and looks at rate limits. That is what happened, for twenty minutes, while
charts were dead.
"""
import importlib

import pytest

bars_router = importlib.import_module("api.routers.bars")


# --------------------------------------------------------------------------- #
# classification — three answers, three different actions
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("message,expected", [
    ("no such table: ohlcv", "schema-missing"),
    ("no such table: main.ohlcv", "schema-missing"),
    ("database disk image is malformed", "malformed"),
    ("file is not a database", "malformed"),
    ("database is locked", "transient"),
    ("attempt to write a readonly database", "transient"),
    ("", "transient"),
])
def test_a_fault_is_classified_by_what_the_operator_must_DO(message, expected):
    assert bars_router._fault_kind(Exception(message)) == expected


def test_the_two_NON_transient_faults_are_distinguishable_from_each_other():
    """⛔ NOT ONE 'broken' BUCKET. `schema-missing` repairs itself in-process;
    `malformed` needs a snapshot restore and a human (`R2_RECOVERY_ENABLED=1`).
    Collapsing them would send an operator to the wrong runbook."""
    a = bars_router._fault_kind(Exception("no such table: ohlcv"))
    b = bars_router._fault_kind(Exception("database disk image is malformed"))
    assert a != b
    assert "transient" not in (a, b)


# --------------------------------------------------------------------------- #
# the response contract does NOT change
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("kind", ["transient", "schema-missing", "malformed"])
def test_every_fault_still_returns_503_and_an_EMPTY_bars_list(kind):
    """⚠️ THE FRONTEND CONTRACT IS LOAD-BEARING AND UNCHANGED. 503 + `bars: []` is
    what makes the chart keep its last-known IndexedDB bars and retry, instead of
    blanking. A 200 with an empty list is indistinguishable from "this symbol has
    no data" and poisons every chart. Only the `error` string got more honest."""
    r = bars_router._fault_response("spy", "D", kind)
    assert r.status_code == 503
    body = r.body.decode() if isinstance(r.body, (bytes, bytearray)) else str(r.body)
    assert '"bars":[]' in body.replace(" ", "")
    assert kind in body
    assert "SPY" in body, "the ticker is upper-cased in the payload as it always was"
    assert "Retry-After" in r.headers


def test_a_malformed_store_asks_the_browser_to_back_OFF():
    """⚠️ A malformed image will not fix itself in five seconds. Telling the browser
    to hammer it adds load to an already-broken pod and buys nothing."""
    quick = int(bars_router._fault_response("spy", "D", "transient").headers["Retry-After"])
    slow = int(bars_router._fault_response("spy", "D", "malformed").headers["Retry-After"])
    assert slow > quick


# --------------------------------------------------------------------------- #
# the repair — throttled, idempotent, and it uses the app's own schema
# --------------------------------------------------------------------------- #

def test_the_repair_runs_once_then_is_THROTTLED():
    """⛔ THE FAILURE THIS PREVENTS IS A REPAIR STORM. An unauthenticated endpoint
    feeds this path, so without the cooldown a broken store turns every chart load
    into a schema write — driven by whoever is refreshing hardest."""
    bars_router._schema_repair_at = 0.0
    calls = []

    import api.services.bars_sqlite as bs
    original = bs.init_db
    bs.init_db = lambda: calls.append(1)
    try:
        assert bars_router._try_schema_repair() is True
        assert bars_router._try_schema_repair() is False, "the cooldown did not hold"
        assert bars_router._try_schema_repair() is False
        assert len(calls) == 1, "init_db ran more than once inside the cooldown"
    finally:
        bs.init_db = original
        bars_router._schema_repair_at = 0.0


def test_the_repair_calls_the_APP_S_OWN_init_db_not_hand_written_DDL():
    """⛔ A second copy of the schema in the router would be a second authority over
    the table definition, and the day they drifted the 'repair' would install the
    wrong one. Asserted structurally against the shipped source."""
    import ast
    import inspect

    src = inspect.getsource(bars_router._try_schema_repair)
    tree = ast.parse(src.strip())
    called = {n.func.attr for n in ast.walk(tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "init_db" in called
    assert "CREATE TABLE" not in src.upper(), "the router is writing its own DDL"


def test_a_failing_repair_reports_False_rather_than_raising():
    """⛔ A repair that raises inside an exception handler replaces a 503 with a 500
    and loses the classified reason on the way out."""
    bars_router._schema_repair_at = 0.0
    import api.services.bars_sqlite as bs
    original = bs.init_db

    def boom():
        raise RuntimeError("disk on fire")

    bs.init_db = boom
    try:
        assert bars_router._try_schema_repair() is False
    finally:
        bs.init_db = original
        bars_router._schema_repair_at = 0.0


def test_the_handler_ONLY_attempts_repair_for_the_schema_fault():
    """⚠️ `malformed` must NOT trigger `init_db()`. `CREATE TABLE IF NOT EXISTS`
    against a corrupt image either throws or writes into damage; either way it is
    not a repair, and pretending it is would mask the one fault that needs a human.
    Asserted against the shipped handler source."""
    import inspect

    src = inspect.getsource(bars_router.get_bars_route) if hasattr(
        bars_router, "get_bars_route") else inspect.getsource(bars_router)
    assert 'kind == "schema-missing" and _try_schema_repair()' in src, (
        "the repair is no longer gated on the schema-missing classification")
