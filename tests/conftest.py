import os
import sys

import pytest

# ─── AUTH_DB_PATH isolation ────────────────────────────────────────────────
#
# `AUTH_DB_PATH` was unset and `C:\data` EXISTS on this box, so every
# auth-touching test in the repo wrote to ONE persistent shared file —
# `C:\data\auth.db`, 20,640 users deep at measurement and still growing — that
# survived every run. Any test ordering by `created_at`, counting users, or
# asserting on "the newest row" sat on that trapdoor; it is what turned five
# voice failures from flaky into deterministic.
#
# ⚠️ THE OBVIOUS FIX IS A GATE THAT CANNOT FAIL. `monkeypatch.setenv(
# "AUTH_DB_PATH", ...)` inside a fixture reaches NOTHING in `auth_db`:
#
#     api/services/auth_db.py:9   _DB_PATH = os.environ.get("AUTH_DB_PATH", ...)
#
# is executed ONCE, at import. `get_connection()` closes over that module
# global, never over `os.environ`. Measured: pop the env var, import
# `auth_db`, set the env var, call `get_connection()` — `PRAGMA database_list`
# still reports `C:\data\auth.db`. An AST census puts SIX product modules in
# that import-time class (auth_db, awareness.regime_snapshots, bar_provenance,
# bar_quarantine, bars_audit, indicator_alert_service) against seven
# journal_two modules that re-read per call. Roughly forty tests in this repo
# `setenv` and only ever reached the second group.
#
# So this runs at CONFTEST IMPORT — before pytest imports a single test module,
# therefore before those six capture anything — and the session fixture below
# repairs any module that was already imported (a run that collects `api/…`
# tests first gets there ahead of this file).
#
# ⚠️ THE STORE IS MINTED BY THE REPO-ROOT `conftest.py`, NOT HERE. A conftest
# only reaches its own directory, and the 93 test files under `api/**` have none
# — so `pytest api/...` ran with no isolation whatsoever and wrote into the real
# C:\data\auth.db. Root conftest.py sets AUTH_DB_PATH before any other conftest
# is imported; this file READS it back so the session has exactly ONE isolated
# store. Minting a second one here would point the six import-time capturers at
# a different file from the seven journal_two per-call readers. A KeyError here
# means the root conftest was deleted — which is the failure we want, loudly.
ISOLATED_AUTH_DB = os.environ["AUTH_DB_PATH"]


def unisolated_auth_db_path() -> str:
    """The file the product WOULD open with no isolation — derived, not typed.

    Re-executes `api/services/auth_db.py`'s own two-line resolution against an
    absent `AUTH_DB_PATH`, so the shared-store rail in
    `tests/test_shared_state_landmines.py` can never drift from the code it is
    protecting (and never hard-codes `C:\\data\\auth.db`).
    """
    path = "/data/auth.db"
    if not os.path.exists(os.path.dirname(path)):
        import api.services.auth_db as _adb

        path = os.path.join(os.path.dirname(_adb.__file__), "..", "..", "data", "auth.db")
    return path


def _captured_auth_db_holders():
    """Every ALREADY-IMPORTED module holding a module-level auth.db path.

    Derived by VALUE from `sys.modules` rather than from a typed list of module
    names: a module qualifies when one of its module-level attributes is a
    string equal to a path the un-isolated resolution produces. A seventh
    import-time reader added tomorrow is picked up for free.
    """
    stale = {os.path.normcase(os.path.abspath(p)) for p in
             ("/data/auth.db", unisolated_auth_db_path())}
    found = []
    for name, mod in list(sys.modules.items()):
        if not name.startswith("api.") or mod is None:
            continue
        try:
            items = list(vars(mod).items())
        except Exception:  # noqa: BLE001 — a module without a __dict__
            continue
        for attr, val in items:
            if (isinstance(val, str) and val.endswith("auth.db")
                    and os.path.normcase(os.path.abspath(val)) in stale):
                found.append((mod, attr))
    return found


@pytest.fixture(scope="session", autouse=True)
def _repair_auth_db_paths_captured_before_conftest():
    """Close the one gap the env var cannot: modules imported ahead of us."""
    holders = _captured_auth_db_holders()
    saved = [(m, a, getattr(m, a)) for m, a in holders]
    for mod, attr in holders:
        setattr(mod, attr, ISOLATED_AUTH_DB)
    yield
    for mod, attr, old in saved:
        setattr(mod, attr, old)


@pytest.fixture(scope="session")
def isolated_auth_db() -> str:
    """The per-session store every auth-touching test writes to."""
    return ISOLATED_AUTH_DB


@pytest.fixture(scope="session")
def shared_auth_db_path() -> str:
    """The file the product would open with no isolation (see above)."""
    return unisolated_auth_db_path()


@pytest.fixture(autouse=True)
def _isolate_auth_db(monkeypatch):
    """Per-test: keep the env var pointed at the isolated store.

    Several test modules assign `os.environ["AUTH_DB_PATH"]` at import time and
    never restore it, which would silently redirect the per-call readers
    (journal_two) for the rest of the session. This re-pins it around every
    test. A test that sets its own path afterwards still wins — its fixtures
    run after this one and monkeypatch unwinds in reverse.
    """
    monkeypatch.setenv("AUTH_DB_PATH", ISOLATED_AUTH_DB)
    yield


@pytest.fixture(autouse=True)
def _isolate_fundamentals_snapshot_store(tmp_path, monkeypatch):
    """Point the persistent fundamentals snapshot store at a per-test temp DB.

    Without this, tests would share a fundamentals_tables.db in the repo working
    dir and stale-while-revalidate would serve one test's persisted payload to
    another (or to a later full run)."""
    monkeypatch.setenv("FUNDAMENTALS_TABLES_DB_PATH", str(tmp_path / "fund_snapshots.db"))


@pytest.fixture(autouse=True)
def _isolate_signal_ledger(tmp_path, monkeypatch):
    """Point the Signature signal ledger at a per-test temp DB.

    🔴 THIS BECAME NECESSARY THE MOMENT THE LEDGER DOOR WAS WIRED. Until then
    `admit_alert_fire` had zero call sites, so nothing a test drove could reach
    `signature/ledger.py`; now `_run_one_cycle` accrues a receipt on every fire,
    and roughly a dozen tests drive that cycle for real with a builtin alert on
    a closed bar. `_DB_PATH` defaults to `/data/signal_ledger.db` — and `C:\\data`
    EXISTS on this box, exactly as the AUTH_DB_PATH block above records — so
    every one of those tests would append rows to the REAL, APPEND-ONLY ledger.
    That store has no rewrite path: a test row in it is a test row forever.

    ⚠️ THE ENV VAR ALONE REACHES NOTHING, for the reason this file already
    documents at length: `ledger._DB_PATH` is `os.environ.get(...)` executed ONCE
    at import, and `_connect()` closes over the module global. So BOTH are set,
    plus `_INITED` — otherwise the schema is created in the first test's temp
    file and every later one reads a database with no tables.

    The module is imported here rather than looked up in `sys.modules` because
    `admit_alert_fire` imports it LAZILY, inside the call: a `sys.modules` probe
    would find nothing on the first test to touch the door, the env var would be
    captured then, and every subsequent test would inherit that one test's temp
    path. It is a stdlib-only module (sqlite3/json/threading), so importing it
    for every test costs nothing.

    A test that wants its own ledger still wins — its fixtures run after this
    one and monkeypatch unwinds in reverse.
    """
    from api.services.signature import ledger

    path = tmp_path / "signal_ledger.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(path))
    monkeypatch.setattr(ledger, "_DB_PATH", str(path))
    monkeypatch.setattr(ledger, "_INITED", False)


@pytest.fixture(autouse=True)
def _reset_calendar_serve_stale():
    """Clear the Calendar's serve-stale slots between tests.

    Same hazard as the fundamentals fixture above: `/api/calendar` and the
    enrichment endpoints keep the last GOOD payload in module-level slots so a
    real user never pays the cold multi-provider rebuild. In a test process
    that state is shared, so one test's mocked week would be served to the
    next test that expects to drive a build of its own.

    Looked up via sys.modules rather than imported: forcing this heavy router
    into every unrelated test would be a side effect of the fixture itself."""
    import sys

    def _clear():
        mod = sys.modules.get("api.routers.calendar")
        if mod is None:
            return
        for slot in (getattr(mod, "_WEEKLY_STALE", None),
                     getattr(mod, "_ENRICH_STALE", None)):
            if slot is not None:
                slot._slots.clear()

    _clear()
    yield
    _clear()


@pytest.fixture(autouse=True)
def _reset_broker_partner_health_cache():
    """Clear the SnapTrade partner-info cache between tests.

    Third instance of the hazard the two fixtures above already exist for, and
    the only one that was still live. `partner_health._cache` is a module-level
    dict with a **30-MINUTE TTL** — longer than any test session — so the first
    test to populate it answers for every later test in the process.

    MEASURED, and it took running the suite in a SECOND file order to see it:

        pytest tests/test_broker_partner_health.py tests/test_broker_fleet_monitor.py
          -> EXIT 1 · 5 failed
        pytest tests/test_broker_fleet_monitor.py tests/test_broker_partner_health.py
          -> EXIT 0

    `test_broker_partner_health.py` seeds a fixture payload in which WEBULL is
    `is_degraded: True`. `fleet_monitor.run_fleet_check()` then reads
    `partner_health.degraded_connected_brokers()`
    (`fleet_monitor.py:261`) off that stale cache and reports an extra
    `{"kind": "broker_degraded", "userId": None}` finding — so
    `test_healthy_fleet_pings_nothing` sees a ping, and the assertions that
    enumerate findings see one too many. The victim's own fixture is not at
    fault: it isolates its DB correctly, and no DB row is involved.

    ⚠️ The module SHIPS `_reset_cache_for_tests()` for exactly this and nothing
    ever called it. Looked up through `sys.modules` rather than imported, like
    the fixtures above, so this never drags the broker stack into unrelated
    tests as a side effect of itself.
    """
    import sys

    def _clear():
        mod = sys.modules.get("api.services.journal_two.broker.partner_health")
        if mod is None:
            return
        reset = getattr(mod, "_reset_cache_for_tests", None)
        if reset is not None:
            reset()

    _clear()
    yield
    _clear()


@pytest.fixture(autouse=True)
def _reset_signature_serve_stale():
    """Clear the Signature router's cross-test module state.

    Same hazard as the Calendar fixture above, plus two of its own:
    * the three routes are TTL-cached in the process-wide `cache` singleton for
      5-10 MINUTES, so without clearing the `sig:` keys the first test to build
      a symbol answers for every later test that expects to drive its own;
    * the GEX negative cache remembers an auth-down envelope for 60s, so a test
      that drives an outage would hand its error payload to the next test —
      and the "rebuilt after the TTL" test would pass for the wrong reason.

    Looked up via sys.modules rather than imported, so this fixture never
    drags the router into unrelated tests as a side effect of itself. The
    cache prefix is cleared unconditionally: `api.services.cache` is cheap and
    already imported everywhere, and the keys are namespaced to `sig:`."""
    import sys

    def _clear():
        try:
            from api.services.cache import cache
            cache.delete_prefix("sig:")
        except Exception:
            pass
        mod = sys.modules.get("api.routers.signature")
        if mod is None:
            return
        for name in ("_DPL_STALE", "_FCB_STALE", "_GXW_STALE"):
            slot = getattr(mod, name, None)
            if slot is not None:
                slot._slots.clear()
        neg = getattr(mod, "_GXW_NEG_CACHE", None)
        if neg is not None:
            neg.clear()

    _clear()
    yield
    _clear()


@pytest.fixture(scope="session", autouse=True)
def _setup_j2_database():
    """Initialize the J2 schema in the test auth.db.

    The app uses auth_db.get_connection() which was already isolated by the
    root conftest.py. This fixture just ensures the J2 schema is created
    in that isolated database. This is needed for HTTP endpoint tests that
    call actual service layers.
    """
    from api.services.auth_db import get_connection
    from api.services.journal_two import db as j2db

    conn = get_connection()
    try:
        j2db.ensure_schema(conn)
    finally:
        conn.close()

    yield
