import os
import sys

# Bars series meta (bar contract): no background flusher in tests — a test that needs
# persistence calls `bars_sqlite.flush_meta()` itself (see `_isolate_bars_series_meta`).
os.environ.setdefault("BARS_META_FLUSH_SECONDS", "0")

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
def _isolate_fmp_response_cache(tmp_path, monkeypatch):
    """The on-disk FMP response cache is OFF in the suite (a stored body would answer the next test's
    mocked GET) and, if a test turns it on, points at a per-test file, never /data."""
    monkeypatch.setenv("FMP_RESPONSE_CACHE", "0")
    monkeypatch.setenv("FMP_RESPONSE_CACHE_PATH", str(tmp_path / "fmp_response_cache.db"))


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
def _reset_uct_agent_meters():
    """UCT Agent's request-rate windows, in-flight leases and spend ledger live in its store,
    which one test process shares: without this, a file that sends more than 20 turns a minute
    would be rate-limited by the tests before it. Looked up via sys.modules (no forced import)."""
    import sys

    def _clear():
        for name in ("api.services.uct_agent.limits", "api.services.uct_agent.budget"):
            mod = sys.modules.get(name)
            if mod is not None:
                try:
                    mod._reset_for_test()
                except Exception:  # noqa: BLE001 -- a store a test replaced may be gone
                    pass

    _clear()
    yield
    _clear()


@pytest.fixture(autouse=True)
def _reopen_the_bars_seed_pool_a_lifespan_test_stopped():
    """A test that runs the real `api.main` lifespan through its shutdown half (the boot time box, the SPA
    HEAD rail, any `with TestClient(app)` over api.main) stops the bars-seed pool for good, as a process
    shutdown should (stream.shutdown_seed_pool). One pytest process is many "processes" in a row: without
    this, every later test whose stream kicks a seed is silently refused (seen: a seed-kick test reading six
    refusals, and `api/routers/stream_bars_test.py` expecting `seeded == ["AAPL"]`).

    The same for the bars-warm pool (api/services/bars_fetch.py shutdown_bars_warm_pool, called by the same
    lifespan): it is created AT IMPORT, so "reopen" is a fresh pool from the module's own factory
    (`_new_bars_warm_pool`) in place of the stopped one (seen: test_bars_review_followups' warm_bars_async test
    reading nothing after test_boot_does_not_wait_on_bars_db). tests/test_bars_warm_pool_shutdown.py T7/T8 are
    the paired rails for both halves.

    A pool left closed is reopened BEFORE each test and AFTER each test. Both halves are needed:
      after   reaches the tests under api/** that follow in the same process (this conftest covers tests/
              only, and every test that runs the real lifespan lives under tests/);
      before  does not depend on fixture order. `monkeypatch` is created by the autouse fixtures above this
              one, so it is torn down AFTER this fixture: a test that stops the pool and only then patches
              `_seed_closed` back open records "closed" as the value to restore, and that undo runs after
              the reset below. The next test's setup half is what reopens it.
    Looked up via sys.modules (no forced import)."""
    import sys

    def _reopen():
        mod = sys.modules.get("api.routers.stream")
        if mod is not None and getattr(mod, "_seed_closed", False):
            mod._seed_closed = False
            mod._seed_pool = None
        warm = sys.modules.get("api.services.bars_fetch")
        if warm is not None and getattr(warm, "_bars_warm_closed", False):
            warm._bars_warm_closed = False
            warm._bars_warm_pool = warm._new_bars_warm_pool()

    _reopen()
    yield
    _reopen()


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


@pytest.fixture(autouse=True)
def _no_live_tbd_session_resolver(monkeypatch):
    """The calendar's Time-TBD resolver calls Nasdaq and SEC EDGAR over HTTP.
    Off for every test so a calendar fixture never reaches a live vendor; the
    resolver's own rails turn it back on with fakes in place."""
    monkeypatch.setenv("CALENDAR_TBD_RESOLVER", "0")


@pytest.fixture(autouse=True)
def _own_daily_bars_cannot_answer(monkeypatch):
    """The earnings run-up and past-moves helpers read our own daily bars first
    and Yahoo only when those cannot answer. Off for every test (the read
    answers "no bars"), so a test that stubs Yahoo keeps testing the Yahoo path
    and no test reaches the bar store or a vendor through it.
    `tests/test_earnings_moves_own_bars.py` overrides this fixture and drives
    the read itself.

    Stood in at the two names that read goes through in
    `earnings_reaction`: `last_stored_daily_session` (asked first: "the store
    holds nothing for this symbol", so no read is started and the bar store is
    never opened) and `daily_bars_since` (the read itself). That module
    imports only the standard library: this runs before every test, and
    importing `earnings_enrichment` here instead would load yfinance and
    pandas into every test process (about 2 s and 850 modules, measured)."""
    import api.services.earnings_reaction as _er
    monkeypatch.setattr(_er, "last_stored_daily_session", lambda sym: None)
    monkeypatch.setattr(_er, "daily_bars_since", lambda sym, since_iso: [])


@pytest.fixture(autouse=True)
def _reset_snapshot_movers_serve_stale():
    """Clear `/api/snapshot`'s and `/api/movers`' serve-stale slots (TERM-082).

    Same hazard as the Calendar fixture above: each route keeps its last
    COMPLETE payload in a module-level slot, so one test's faked snapshot or
    movers list would answer — as a stale-swr hit — for the next test that
    expects to drive a build of its own. Looked up via sys.modules so the
    fixture never imports either router into an unrelated test."""
    import sys

    def _clear():
        for mod_name, slot_name in (("api.routers.snapshot", "_SNAPSHOT_STALE"),
                                    ("api.routers.movers", "_MOVERS_STALE")):
            mod = sys.modules.get(mod_name)
            slot = getattr(mod, slot_name, None) if mod is not None else None
            if slot is not None:
                slot._slots.clear()

    _clear()
    yield
    _clear()


@pytest.fixture(autouse=True)
def _reset_earnings_serve_stale():
    """Clear `/api/earnings`' serve-stale slot (TERM-082, census rank 3).

    Same hazard as the snapshot/movers fixture above: the route keeps its last
    COMPLETE list in a module-level slot, and `/api/push` kicks a refresh when
    that slot holds something. So one test's faked earnings list would answer
    the next test's request as a stale-swr hit, or turn a later push test into
    a background rebuild against real providers. Looked up via sys.modules so
    the fixture never imports the router into an unrelated test."""
    import sys

    def _clear():
        mod = sys.modules.get("api.routers.earnings")
        slot = getattr(mod, "_EARNINGS_STALE", None) if mod is not None else None
        if slot is not None:
            slot._slots.clear()

    _clear()
    yield
    _clear()


@pytest.fixture(autouse=True)
def _reset_theme_day_metrics_serve_stale():
    """Clear `/api/theme-performance`'s and `/api/calendar/day-metrics-batch`'s
    serve-stale slots (TERM-082, census ranks 4 and 6).

    Same hazard as the earnings fixture above: each route keeps its last
    COMPLETE payload in a module-level slot, so one test's faked overlay or
    faked day of metrics would answer the next test's request as a stale-swr
    hit instead of letting it drive its own build. Looked up via sys.modules so
    the fixture never imports either router into an unrelated test."""
    import sys

    def _clear():
        for mod_name, slot_name in (("api.routers.theme_performance", "_THEME_STALE"),
                                    ("api.routers.calendar", "_METRICS_STALE")):
            mod = sys.modules.get(mod_name)
            slot = getattr(mod, slot_name, None) if mod is not None else None
            if slot is not None:
                slot._slots.clear()

    _clear()
    yield
    _clear()


@pytest.fixture(autouse=True)
def _reset_market_narrative_serve_stale():
    """Clear `/api/schwab/market-narrative`'s serve-stale state (TERM-070).

    The route keeps its last GOOD narrative in a module-level slot, a carried
    copy in the shared cache (so a deploy can re-seed the slot), and a brief
    negative memo of its last failure. Any one of them left behind answers the
    next test's request without running the handler it means to drive — a
    stale 200 where a rail expects the cost cap's 429. Looked up via
    sys.modules so the fixture never imports the router into an unrelated
    test."""
    import sys

    def _clear():
        mod = sys.modules.get("api.services.market_narrative_swr")
        if mod is not None:
            mod._reset_for_test()

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


# ── Wisdom scoped-run expected-failure baseline (owner ruling R21, 2026-09-14) ────────────────
#
# ⛔⛔ These tests are RED before any Wisdom session starts, and they live in
# docs/discord-render/, an OFF-LIMITS path under hard rule §0.4i ("Read through their APIs; never
# edit"). Marking them xfail here lets a Wisdom scoped run read 0 failed, so a genuinely NEW red
# is visible the moment it appears instead of hiding behind two permanent ones.
#
# The full record — ids, subject, owner, introducing commits, the failing assertion in one line
# each, and how "pre-existing" was established — is tests/wisdom/EXPECTED-FAILURES.md.
#
# ⭐ strict=True ON PURPOSE: if one of these starts PASSING, the run FAILS and the baseline must be
# updated. A non-strict xfail would let a fixed test sit in the baseline forever and the list would
# rot into things nobody has checked since.
#
# ⛔ SCOPED, NOT GLOBAL. The marks apply only when the same session also collected at least one
# test_wisdom_* file. The Discord render programme running its own suite sees these exactly as it
# always has — red and unmarked. Silencing another programme's failures inside THEIR runs would be
# a defect, not a courtesy.
#
# ⚰️ EMPTY since 2026-11-24. Its two entries (both `mutation_harness_flipgate.py` anchor checks) stopped
# naming any collected test when #2687 renamed that instrument to `flip_gate_mutations.py`: it plants
# evidence in a temp dir, has no source anchors by design, and is no longer collected as a mutation
# harness. #2686 made the other six harnesses' anchor checks green. The mechanism stays for the next
# baseline entry; the record of the two retired ones is in tests/wisdom/EXPECTED-FAILURES.md.
WISDOM_EXPECTED_FAILURES: dict = {}


def pytest_collection_modifyitems(config, items):
    import pytest as _pytest

    if not any("test_wisdom_" in item.nodeid for item in items):
        return  # not a Wisdom run; leave everyone else's failures exactly as they are
    for item in items:
        nodeid = item.nodeid.replace("\\", "/")
        reason = WISDOM_EXPECTED_FAILURES.get(nodeid)
        if reason:
            item.add_marker(_pytest.mark.xfail(strict=True, reason=f"R21 baseline — {reason}"))


@pytest.fixture(autouse=True)
def _no_test_leaks_a_dependency_override():
    """⛔⛔ NO TEST MAY LEAVE A `dependency_overrides` ENTRY ON THE SHARED APP.

    ⚰️ **F-CI-36 COST 41 FAILURES IN CI AND A REVERTED SHARD SPLIT.**
    `tests/test_thesis_reviews_router.py` installed
    `app.dependency_overrides[get_current_user] = lambda: {"id": user_id}` on the REAL
    `api.main.app` and never removed it. Every later test in the same process then got a
    stub user with **no plan and no subscription**, so an UNAUTHENTICATED request stopped
    returning 401 (the override supplies a user) and the paid gate returned **402**.

    ⭐ **It was invisible until the shard partition moved.** At 8 buckets the writer and the
    victim were in different processes; at 12 they shared one. **A defect that only appears
    when the partition changes is a defect the partition is not allowed to own.**

    ⛔ **THE CLASS IS WIDE.** Measured over `tests/**` with comments and docstrings
    stripped: **96 files install an override, 51 clear one, and 55 do neither.** Fixing 55
    files one at a time leaves the 56th to be written tomorrow; this makes the cleanup
    structural instead.

    ⛔ **RESTORE, NEVER `.clear()`** — another fixture may legitimately have installed an
    override before this test, and clearing would trade one leak for a different breakage.

    ⛔ **LAZY BY CONSTRUCTION.** It touches `sys.modules`, never `import api.main`: forcing
    the whole application to import for every test in the tree is exactly the collection
    cost this repository has been OOM-killed by.

    ⭐ Safe as a FUNCTION-scoped fixture because **no module-, class-, package- or
    session-scoped fixture anywhere under `tests/` touches `dependency_overrides`** —
    measured by AST, with a control confirming the same walk sees 77 non-function-scoped
    fixtures overall. Nothing relies on an override surviving between tests.
    """
    mod = sys.modules.get("api.main")
    before = dict(mod.app.dependency_overrides) if mod is not None else None
    try:
        yield
    finally:
        mod = sys.modules.get("api.main")
        if mod is not None:
            # `before is None` means the app was imported DURING this test, so the state to
            # restore is the empty mapping a fresh FastAPI app carries.
            mod.app.dependency_overrides.clear()
            mod.app.dependency_overrides.update(before or {})


# ─── ⛔⛔ A PATCHED FUNCTION CAPTURED BY AN IMPORT OUTLIVES THE PATCH ─────────────────────────
#
# ⚰️ 2026-11-17: 34 tests in three files (Notebook email-in, voice notes, plan grading) failed with
# `no such table` whenever `tests/test_term086_inbound_alerts.py` ran earlier in the same process,
# and passed alone (runs 44122066704 red in company; 44123855004, 44123863322, 44123874234 green
# alone). Its fixture did `monkeypatch.setattr(auth_db, "get_connection", _conn)` and THEN imported
# `api.main`. Every product module that `api.main` imported for the first time ran
# `from api.services.auth_db import get_connection` while the patch stood, and so bound the TEST's
# `_conn` (a scratch file holding one `users` table). Monkeypatch put `auth_db.get_connection` back
# at teardown; nothing can put back a name another module copied. `note_personal_api`,
# `voice_usage` and `plan_grading` then opened that scratch file for the rest of the session.
#
# ⭐ The rail: after every test, a product module FIRST IMPORTED during that test may not hold, at
# module level, a function or mock defined in a test file. It runs after every fixture (and
# every monkeypatch) has been torn down, so a patch the test itself put on a module is already
# undone; what is left is a copy nothing will ever undo. Only the modules new to `sys.modules` are
# read, so the cost is paid once per module per session, never per test.
_TESTS_ROOT = os.path.dirname(os.path.abspath(__file__))


def _is_test_code(path: str) -> bool:
    path = os.path.abspath(path)
    base = os.path.basename(path)
    if base == "conftest.py":
        return False                      # session-wide shims are installed on purpose
    return (path.startswith(_TESTS_ROOT + os.sep) or base.startswith("test_")
            or base.endswith("_test.py"))


def captured_test_objects(module_names) -> list[str]:
    """`module.attr <- where` for each product module in `module_names` holding a test's
    function (or a unittest.mock object) at module level."""
    from unittest import mock

    out = []
    for name in sorted(module_names):
        last = name.rsplit(".", 1)[-1]
        if not name.startswith("api.") or last.startswith("test_") or last.endswith("_test"):
            continue
        mod = sys.modules.get(name)
        try:
            items = list(vars(mod).items())
        except TypeError:
            continue
        for attr, val in items:
            if isinstance(val, mock.NonCallableMock):
                out.append(f"{name}.{attr} <- a unittest.mock object")
                continue
            code = getattr(val, "__code__", None)
            if code is not None and _is_test_code(code.co_filename):
                where = os.path.relpath(os.path.abspath(code.co_filename), os.path.dirname(_TESTS_ROOT))
                out.append(f"{name}.{attr} <- {getattr(val, '__qualname__', attr)} "
                           f"({where.replace(os.sep, '/')}:{code.co_firstlineno})")
    return out


_MODULES_BEFORE = pytest.StashKey[set]()


@pytest.hookimpl(wrapper=True)
def pytest_runtest_setup(item):
    item.stash[_MODULES_BEFORE] = set(sys.modules)        # before any fixture of this test runs
    return (yield)


@pytest.hookimpl(wrapper=True)
def pytest_runtest_teardown(item, nextitem):
    result = yield                                         # every fixture and patch is undone now
    before = item.stash.get(_MODULES_BEFORE, None)
    if before is not None:
        captured = captured_test_objects(set(sys.modules) - before)
        if captured:
            pytest.fail(
                "a product module imported during this test bound a test's function, and keeps it "
                "after the patch was undone (patch the DATA the function reads, e.g. "
                "`auth_db._DB_PATH`, or import the module before patching): "
                + "; ".join(captured[:8]) + (f" (+{len(captured) - 8} more)" if len(captured) > 8 else ""),
                pytrace=False)
    return result


# ─── a bars background refresh ends with the test that started it ───────────
#
# `bars_fetch` answers a stale stored series at once and refreshes it on a daemon thread: the thread asks a
# provider, and when the provider answers it writes the rows with `bars_sqlite.put_bars`, into whatever
# `bars_sqlite._DB_PATH` names AT THAT MOMENT. A test that starts one and returns leaves it running, and every
# bars rail re-points `_DB_PATH` at a temp file of its own: the write lands in a LATER test's store.
#
# ⚰️ MEASURED 2026-11-22/23 (gate 45085093354, PR runs 45056547092 and 45015805620; about 1 run in 100):
# tests/test_bars_since_index_scan.py stored AAPL daily 06-10 .. 06-16, read `since` 06-12 and was served
# ['2026-11-20']. tests/test_bars_server_timing.py::test_layer_stale_swr_on_daily_rows, 39 tests earlier, had
# started `bars-bg-AAPL-D` with no provider stubbed: on a runner that is a real request to Yahoo, and its
# answer (the last session's AAPL bar and nothing else) came back about a second later. On the census run
# 45265666676 that thread lived 1.13 s and ended four tests AFTER the one that failed in those three runs.
# With that row beside its own five, the serve path's listing cutoff (`listing_break.is_break`: a long hole in
# the dates starts a new listing) kept only the row after the hole.
#
# ⛔ `bars_fetch._inflight` IS NOT A REGISTER OF THEM. tests/test_bars_server_timing.py's own fixture clears it
# before the next test, while the thread is still asking. That is why #2365's drain, which waited on it, did
# not hold on a runner (reverted in bd8ce6e230). The threads themselves are the only complete list.
#
# So a test's body is not over until its refreshes are: they are joined here, after the body returns and BEFORE
# any fixture is undone, so the write lands in the store, and through the stubs, of the test that started it.
# One still running after BARS_REFRESH_ENDS_WITHIN_S fails THAT test by name. The rail is
# tests/test_bars_refresh_ends_with_its_test.py.
#
#: The refresh threads, by the names `bars_fetch` gives them:
#:   bars-bg-<SYM>-<tf>[-partial]   `_get_bars_inner`'s stale-while-revalidate refresh
#:   bars-sincebg-<SYM>-<tf>        `_enqueue_since_bg_heal`: the same refresh, started by the `since=` poll
BARS_REFRESH_THREADS = ("bars-bg-", "bars-sincebg-")
#: A refresh ends when its provider answers or gives up (the daily tail-fill gives Yahoo 3.5 s, a deep fetch
#: 20 s). One that outlasts this is not slow: its provider is held and nothing will release it.
BARS_REFRESH_ENDS_WITHIN_S = 30.0
#: ⛔ THE RULE'S ONLY CLOCK, HELD FROM CONFTEST IMPORT. The rule runs after a test's body and BEFORE its patches are
#: undone, so `time.monotonic()` looked up then is whatever the test left there. ⚰️ 2026-11-23:
#: tests/test_polygon_options_chain.py::test_get_chain_pagination_stops_at_wall_clock_budget patches it with a
#: two-value iterator and uses both, and the rule's deadline raised "RuntimeError: generator raised StopIteration"
#: in that test. Nothing else here reads a clock: `Thread.join` and `Event.wait` time their own waits (`threading`
#: holds its clock from its own import). The same goes for the other names the rule needs from a module a test
#: may patch: all are held from here. Rail: test_7 / test_8 of tests/test_bars_refresh_ends_with_its_test.py.
from concurrent.futures import ThreadPoolExecutor as _REAL_POOL  # noqa: E402
from threading import Event as _REAL_EVENT, enumerate as _REAL_THREADS  # noqa: E402
from time import monotonic as _REAL_MONOTONIC  # noqa: E402


def live_bars_refreshes() -> list:
    """Every bars refresh thread running in this process right now."""
    return [t for t in _REAL_THREADS() if t.name.startswith(BARS_REFRESH_THREADS)]


def end_bars_refreshes(timeout_s: float = BARS_REFRESH_ENDS_WITHIN_S) -> list:
    """Wait for every running bars refresh thread, `timeout_s` in all. Returns the names of those still running."""
    deadline = _REAL_MONOTONIC() + timeout_s
    for t in live_bars_refreshes():
        t.join(max(0.0, deadline - _REAL_MONOTONIC()))
    return sorted(t.name for t in live_bars_refreshes())


# ⚰️ THE SAME LEAK THROUGH A POOL (merge-queue run 45274569039, 2026-11-23): tests/test_bars_derived_tail_local_first
# .py::test_Z2, whose fresh store must stay empty, held "[('AAPL', 'D'), ('QQQ', 'D')], 6 bars".
# tests/test_bars_data_auth.py, five files earlier, had asked `/api/bars/AAPL?tf=D&bars=3` and the same for QQQ:
# a cold symbol, so `bars_fetch._kick_cold_fetch` queued its first fetch on the cold pool with no provider
# stubbed, and the pool wrote the provider's three bars per symbol when it answered.
# A pool's worker threads never end, so its work cannot be joined by name. And `bars_fetch._cold_bg_inflight` is
# no register either (tests replace and clear it). What a first-in-first-out pool does allow is exact: one gate
# job per worker. All of them can be running at once only when every job accepted before them has finished.
#
#: (module, the pool's name in it, its worker threads' name prefix): pools whose jobs fetch from a provider and
#: write the store when it answers.
#:   bars_fetch._cold_bg_pool   `_kick_cold_fetch`: a cold symbol's first fetch
BARS_WORK_POOLS = (("api.services.bars_fetch", "_cold_bg_pool", "bars-cold-bg"),)


def end_bars_pool_work(timeout_s: float = BARS_REFRESH_ENDS_WITHIN_S) -> list:
    """Wait until every job the bars work pools have accepted so far has finished, `timeout_s` in all. Returns the
    names of the pools still busy. A pool that never started a worker has never had a job and is left alone, as is
    a test's stand-in for one, and a pool that has been stopped (it accepts no gate, and dropped what it had queued)."""
    deadline = _REAL_MONOTONIC() + timeout_s
    busy = []
    for mod_name, attr, prefix in BARS_WORK_POOLS:
        pool = getattr(sys.modules.get(mod_name), attr, None)
        if not isinstance(pool, _REAL_POOL):
            continue
        if not any(t.name.startswith(prefix) for t in _REAL_THREADS()):
            continue
        release = _REAL_EVENT()
        running = [_REAL_EVENT() for _ in range(pool._max_workers)]

        def _gate(mine, _release=release):
            mine.set()
            _release.wait()

        try:
            for ev in running:
                pool.submit(_gate, ev)
            if not all(ev.wait(max(0.0, deadline - _REAL_MONOTONIC())) for ev in running):
                busy.append(f"{attr} ({prefix})")
        except RuntimeError:
            pass
        finally:
            release.set()                                  # a gate still queued behind a held job returns at once
    return busy


def end_bars_background_work() -> list:
    """Everything the rule waits for when a test's body returns. Returns what is still running after the wait."""
    return end_bars_refreshes() + end_bars_pool_work()


@pytest.hookimpl(wrapper=True)
def pytest_runtest_call(item):
    try:
        result = yield
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException:
        end_bars_background_work()                         # the test's own outcome is the report
        raise
    left = end_bars_background_work()
    if left:
        pytest.fail(
            f"bars background work was still running {BARS_REFRESH_ENDS_WITHIN_S:.0f} s after this test's body "
            f"returned: {', '.join(left)}. When its provider answers it writes into whatever store a LATER test "
            "owns: stub the provider it asks, or release it before the test returns.",
            pytrace=False)
    return result


@pytest.fixture
def routed_schema(monkeypatch):
    """The kill switch (UCT_AGENT_CONSTANT_SCHEMA=0): for tests of the routed schema, which it must keep restoring exactly."""
    monkeypatch.setenv("UCT_AGENT_CONSTANT_SCHEMA", "0")

@pytest.fixture(autouse=True)
def _reset_screener_live_rest():
    """Clear `live_tier._LAST_WORK`, the screener sweeper's rest ledger.

    A real sweep that happens to take over a second on a slow box would make
    the NEXT test's `sweep_job()` rest instead of run. Looked up via
    sys.modules so the fixture never imports the screener into an unrelated test."""
    def _clear():
        # A test may park a stand-in module there (the surface tests do), so
        # read the attribute defensively rather than assume the real module.
        mod = sys.modules.get("api.services.screener.live_tier")
        try:
            ledger = mod.__dict__.get("_LAST_WORK") if mod is not None else None
        except Exception:  # noqa: BLE001 -- a deliberately exploding stand-in
            ledger = None
        if isinstance(ledger, list):
            ledger.clear()

    _clear()
    yield
    _clear()


@pytest.fixture(autouse=True)
def _isolate_bars_series_meta():
    """Per-test: the bars store's in-process meta state (queued proofs, store floors)
    starts empty, so one test's `_mark_tail_verified` cannot verify another's tail."""
    def _clear():
        try:
            from api.services import bars_sqlite as _bs
        except Exception:
            return
        _bs.reset_meta_state_for_tests()
        try:
            from api.services import bar_contract as _bc
            _bc._stream_rev_cache.clear()
            # a series_rev read still running from the previous test lands nowhere
            getattr(_bc, "reset_stream_rev_for_tests", lambda: None)()
        except Exception:
            pass

    _clear()
    yield
    _clear()
