"""S3 Entity Master admin status/ops routes — `api/routers/entity_master_admin.py`.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
--------------------------------------------
1. the router is MOUNTED ON THE APP THE PRODUCT SERVES. Asserted against
   `api.main:app`'s own route table, never a grep and never a private
   `FastAPI()` — `test_admin_guard_registered.py`'s whole reason for existing
   is that both halves of a severed wire stay individually correct and green.
2. the gate is real, and 401 and 403 are DIFFERENT facts. An anonymous caller
   has no identity (`get_current_user` → 401); a signed-in member has one and
   is refused (`require_admin` → 403). Collapsing them would hide a route that
   had silently dropped to "any account".
3. `/reconcile` does NOT run on the request path. Measured, not asserted from
   the source: the fake run BLOCKS, and the POST still returns.
4. `/reconcile` is idempotent — driven twice, for real, against a temp store.
5. `/status` answers on an EMPTY store. `figi_coverage_pct` divides by the
   entity count and a never-seeded store has zero of them.

⛔ THE IDENTITY IS OVERRIDDEN, THE GATE IS NOT. `tests/authclients.py` is the
one idiom: `get_current_user` is substituted, `require_admin` is left in the
dependency tree and runs on every request these tests make. Overriding the gate
would make a handler that had LOST its `Depends(require_admin)` look identical
to one that still carried it.

⛔ THE REAL `run_reconciliation` IS UNREACHABLE FROM THIS FILE unless a test
asks for it BY NAME. `_no_real_reconciliation` is autouse, so the unauthenticated
POST probe in the gating tests is harmless BY CONSTRUCTION rather than by
trusting the gate it is testing (`lesson_never_probe_a_mutating_endpoint_to_test_auth`
— firing a POST at a mutating route to test auth is safe only in the case the
test is NOT written to detect). The two tests that want the real thing rebind it
explicitly and stub Massive's reference feed, so nothing here reaches the
network either.

⛔ AND NOTHING HERE TOUCHES THE REAL STORE. `_isolated_entity_master` points
`entity_master.schema.DB_PATH` at `tmp_path` — the same fixture shape
`tests/test_alert_taxonomy_predicates.py` already uses — and the routes take no
`db_path` parameter, so a temp target is the only one reachable. The repo-root
conftest's pins are read, never overridden.
"""
from __future__ import annotations

import os
import sys
import threading
import time

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import (  # noqa: E402
    get_current_user as _get_current_user,
    get_current_user_with_plan as _get_current_user_with_plan,
)
from api.routers import entity_master_admin as rt  # noqa: E402
from api.services.entity_master import api as em_api  # noqa: E402
from api.services.entity_master import reconciliation  # noqa: E402
from api.services.entity_master import schema as em_schema  # noqa: E402
from api.services.entity_master import store as em_store  # noqa: E402
from tests.authclients import ADMIN, FREE_MEMBER, signed_in_as  # noqa: E402

STATUS = "/api/admin/entity-master/status"
RECONCILE = "/api/admin/entity-master/reconcile"

#: The genuine `run_reconciliation`, captured BEFORE the autouse fake replaces
#: it, so the two tests that want the real code path can name it rather than
#: re-import a module attribute the fixture has already overwritten.
_REAL_RUN_RECONCILIATION = reconciliation.run_reconciliation


@pytest.fixture(scope="module")
def app():
    """THE REAL APP. Imported, never rebuilt — a locally-constructed
    `FastAPI()` is how `AdminGuardMiddleware` stayed green for months while
    production had no guard at all."""
    from api.main import app as real_app
    return real_app


@pytest.fixture
def client(app):
    """⚠️ NOT a context manager. `TestClient.__enter__` runs `api.main`'s
    lifespan — the scheduler, the COT seed, the bars prewarm — and this file is
    about routing, gates and shapes, none of which need any of that running.
    Same reasoning as `test_exposed_routes_gated.py::app`.

    `raise_server_exceptions=False` so a handler fault surfaces as a status
    code rather than a traceback that reads like a test bug.
    """
    yield TestClient(app, raise_server_exceptions=False)
    # Leave no caller behind for the next module in the session.
    for dep in (_get_current_user, _get_current_user_with_plan):
        app.dependency_overrides.pop(dep, None)


@pytest.fixture(autouse=True)
def _isolated_entity_master(tmp_path, monkeypatch):
    """A throwaway entity_master.db per test. Same shape as
    `test_alert_taxonomy_predicates.py::_isolated_entity_master`."""
    em_db_path = str(tmp_path / "entity_master.db")
    monkeypatch.setattr(em_schema, "DB_PATH", em_db_path)
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False
    em_schema.init_db(db_path=em_db_path)
    yield em_db_path
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False


@pytest.fixture(autouse=True)
def _quiet_runner(monkeypatch):
    """Reset the router's per-process single-flight state between tests, and
    make the default `run_reconciliation` a no-op that neither writes nor
    reaches the network."""
    monkeypatch.setattr(rt, "_running", None, raising=False)
    monkeypatch.setattr(rt, "_last_run", None, raising=False)
    monkeypatch.setattr(
        reconciliation, "run_reconciliation",
        lambda dry_run=True, db_path=None, max_pages=60: {
            "dry_run": dry_run, "live_symbols_count": 0, "open_aliases_count": 0,
            "proposed_creates": [], "proposed_delists": [], "ambiguous": [],
            "skipped_existing_count": 0, "rejected": [],
        },
    )
    yield
    _wait_until_idle(timeout=10.0)
    rt._running = None
    rt._last_run = None


def _wait_until_idle(timeout: float = 20.0) -> bool:
    """Block until no reconcile thread is in flight. Returns False on timeout
    rather than hanging the suite; callers assert on it so a stuck runner is a
    named failure and not a 10-minute red."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if rt._reconcile_state()["in_flight"] is None:
            return True
        time.sleep(0.01)
    return False


def _anonymous(app) -> None:
    """Empty the cookie jar the only way that matters here: remove the identity
    overrides so the REAL `get_current_user` runs against no session. The gate
    itself is never touched."""
    for dep in (_get_current_user, _get_current_user_with_plan):
        app.dependency_overrides.pop(dep, None)


def _seed(alias: str, *, entity_type: str = "equity", valid_from: str = "2020-01-01",
          composite_figi: str | None = None, source: str = "admin_manual") -> str:
    payload = {"entity_type": entity_type, "initial_alias": alias,
               "initial_alias_valid_from": valid_from}
    if composite_figi:
        payload["composite_figi"] = composite_figi
    r = em_api.apply_event("new_entity", payload,
                           dedup_key=f"test:new_entity:{alias}", source=source)
    assert r.accepted, r.reason
    return r.entity_id


# ─── 1. the router is mounted on the app the product serves ─────────────────

def _route_table(app) -> set[tuple[str, str]]:
    """Every (METHOD, path) `api.main:app` actually serves. Derived from the
    app, so a route that is renamed or never mounted empties this set LOUDLY."""
    table: set[tuple[str, str]] = set()
    for r in app.routes:
        path = getattr(r, "path", None)
        methods = getattr(r, "methods", None)
        if path and methods:
            for m in methods:
                table.add((m, path))
    return table


class TestMounted:
    def test_both_routes_are_mounted_on_the_real_app(self, app):
        """Not a grep for `include_router`. The claim is "the served app answers
        here", and only the served app's route table can settle it."""
        table = _route_table(app)
        assert ("GET", STATUS) in table, (
            f"{STATUS} is not on api.main:app — the router is not mounted")
        assert ("POST", RECONCILE) in table, (
            f"{RECONCILE} is not on api.main:app — the router is not mounted")

    def test_the_route_walk_can_report_ABSENT(self, app):
        """The non-vacuity control. Without it, a walk that had started
        returning everything — or a membership test comparing the wrong thing —
        would satisfy the assertions above for the wrong reason."""
        table = _route_table(app)
        assert ("GET", "/api/admin/entity-master/__no_such_route__") not in table
        # …and the walk really is seeing this app, not an empty set.
        assert ("GET", "/api/cot/status") in table

    def test_the_admin_guard_middleware_does_NOT_claim_this_prefix(self):
        """Deliberate, and asserted so it stays a decision.

        `AdminGuardMiddleware` answers **403** before routing for the prefixes
        it owns. If `/api/admin/entity-master/` were added to that tuple, an
        anonymous caller would get 403 instead of 401 and the two facts this
        file keeps apart would collapse. The gate here is `Depends(require_admin)`,
        which distinguishes them.
        """
        from api.middleware import admin_guard

        assert not any(STATUS.startswith(p) for p in admin_guard.GUARDED_PREFIXES)
        # control: the tuple is non-empty and really does claim its own prefixes
        assert any("/api/admin/massive/".startswith(p)
                   for p in admin_guard.GUARDED_PREFIXES)


# ─── 2. the gate ────────────────────────────────────────────────────────────

class TestAdminGate:
    """⚠️ The POST probes below are safe BY CONSTRUCTION, not by trusting the
    gate: `_quiet_runner` has already replaced `run_reconciliation` with a
    no-op, so even the failure this class exists to detect cannot reach real
    work."""

    def test_an_anonymous_caller_gets_401_on_status(self, client, app):
        _anonymous(app)
        assert client.get(STATUS).status_code == 401

    def test_an_anonymous_caller_gets_401_on_reconcile(self, client, app):
        _anonymous(app)
        assert client.post(RECONCILE).status_code == 401

    def test_the_anonymous_probe_would_have_SEEN_an_open_door(self, client, app):
        """⭐ THE CONTROL. A sweep that refuses everything is also what a broken
        client or a 500ing app produces. The same empty cookie jar must get a
        NON-refusal somewhere, or the two 401s above are evidence of nothing."""
        _anonymous(app)
        assert client.get("/api/health").status_code not in (401, 402, 403)

    def test_a_signed_in_MEMBER_gets_403_on_status(self, client):
        with signed_in_as(FREE_MEMBER):
            r = client.get(STATUS)
        assert r.status_code == 403, (
            "a member with a real session must be refused by require_admin, "
            "not admitted — 403 is a different fact from the anonymous 401")

    def test_a_signed_in_MEMBER_gets_403_on_reconcile(self, client):
        with signed_in_as(FREE_MEMBER):
            r = client.post(RECONCILE)
        assert r.status_code == 403

    def test_a_PAID_member_is_still_refused(self, client):
        """There is no tier between member and admin. A paid plan buys product
        access, never ops access — asserted so "paid" can never drift into
        meaning "admin" on this surface."""
        paid = dict(FREE_MEMBER, plan="pro")
        with signed_in_as(paid):
            assert client.get(STATUS).status_code == 403

    def test_an_ADMIN_is_admitted(self, client):
        with signed_in_as(ADMIN):
            r = client.get(STATUS)
        assert r.status_code == 200

    def test_the_gate_in_the_dependency_tree_is_require_admin_BY_IDENTITY(self, app):
        """Read off `route.dependant` by object identity, never off source text
        — `test_exposed_routes_gated.py`'s rule, because a grep on this repo has
        already manufactured a ship-blocker out of three prose hits."""
        from api.middleware.auth_middleware import require_admin

        def _calls(dependant) -> set:
            found = {dependant.call}
            for sub in dependant.dependencies:
                found |= _calls(sub)
            return found

        seen = 0
        for r in app.routes:
            if getattr(r, "path", None) in (STATUS, RECONCILE):
                dep = getattr(r, "dependant", None)
                assert dep is not None, f"{r.path} exposes no dependency tree"
                assert require_admin in _calls(dep), (
                    f"{r.path} does not carry require_admin in its dependency tree")
                seen += 1
        assert seen == 2, f"expected 2 entity-master admin routes, walked {seen}"


# ─── 3. GET /status ─────────────────────────────────────────────────────────

_SPEC_FIELDS = ("entities", "aliases", "delisted", "figi_coverage_pct",
                "ambiguous_count", "last_seed_at", "last_reconcile_at")


class TestStatusShape:
    def test_an_EMPTY_store_answers_instead_of_dividing_by_zero(self, client):
        """A never-seeded store has zero entities, and `figi_coverage_pct`'s
        denominator is that count. This is the assertion that would have caught
        a bare division."""
        with signed_in_as(ADMIN):
            r = client.get(STATUS)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["entities"] == 0
        assert body["aliases"] == 0
        assert body["figi_coverage_pct"] == 0.0
        assert body["last_seed_at"] is None
        assert body["last_reconcile_at"] is None

    def test_every_field_the_spec_names_is_present(self, client):
        with signed_in_as(ADMIN):
            body = client.get(STATUS).json()
        missing = [f for f in _SPEC_FIELDS if f not in body]
        assert not missing, f"entity-master-spec §7.3 fields missing: {missing}"

    def test_counts_and_figi_coverage_are_read_off_the_rows(self, client):
        _seed("AAPL", composite_figi="BBG000B9XRY4")
        _seed("MSFT", composite_figi="BBG000BPH459")
        _seed("NOFIGI")
        with signed_in_as(ADMIN):
            body = client.get(STATUS).json()
        assert body["entities"] == 3
        assert body["aliases"] == 3
        assert body["open_aliases"] == 3
        assert body["entities_with_composite_figi"] == 2
        assert body["figi_coverage_pct"] == pytest.approx(66.67, abs=0.01)
        assert body["events"] == 3
        assert body["rejected_events"] == 0

    def test_a_delisted_entity_is_counted_as_delisted(self, client):
        eid = _seed("BSC-OLD")
        assert em_api.apply_event(
            "delisted", {"entity_id": eid, "lifecycle_since": "2008-05-30"},
            dedup_key="test:delist:BSC-OLD", source="admin_manual").accepted
        with signed_in_as(ADMIN):
            body = client.get(STATUS).json()
        assert body["delisted"] == 1
        assert body["lifecycle_states"]["delisted"] == 1

    def test_a_genuine_alias_COLLISION_is_reported_not_hidden(self, client):
        """PRD §17 AC-6's construction: seed the collision directly at the
        SQLite layer, BELOW `apply_event`'s write-time guard, because the guard
        is what makes it unreachable from application code. `ambiguous_count`
        counts ALIASES, so two entities colliding on one alias is ONE."""
        a = _seed("DUPE")
        b = _seed("OTHER")
        conn = em_store._conn()
        conn.execute(
            "INSERT INTO entity_aliases(entity_id, alias, valid_from, valid_to, source, created_at) "
            "VALUES (?,?,?,NULL,?,?)",
            (b, "DUPE", "2021-01-01", "test:direct", "2021-01-01T00:00:00Z"),
        )
        conn.commit()
        em_store.rebuild_cache()
        assert em_api.resolve("DUPE").status == "ambiguous"  # control
        assert a != b

        with signed_in_as(ADMIN):
            body = client.get(STATUS).json()
        assert body["ambiguous_count"] == 1, (
            "a collision the store itself reports as ambiguous must be visible "
            "on the ops surface — that is PRD §13.1's defect signal")

    def test_a_CLEAN_store_reports_zero_ambiguous(self, client):
        """The control for the test above: if `ambiguous_count` were wired to
        something that always counted, the collision assertion would pass for
        the wrong reason."""
        _seed("AAPL")
        _seed("MSFT")
        with signed_in_as(ADMIN):
            assert client.get(STATUS).json()["ambiguous_count"] == 0

    def test_last_seed_and_last_reconcile_come_from_the_EVENT_TRAIL(self, client):
        """Derived from the rows, by `source`, never from a counter kept beside
        them (`lesson_health_check_reads_a_proxy_not_the_artifact`)."""
        _seed("AAPL", source="admin_manual")
        with signed_in_as(ADMIN):
            body = client.get(STATUS).json()
        assert body["last_seed_at"] is not None
        assert body["last_reconcile_at"] is None, (
            "an admin_manual seed event must not be reported as a reconcile")

        _seed("NVDA", source="reconciliation")
        with signed_in_as(ADMIN):
            body = client.get(STATUS).json()
        assert body["last_reconcile_at"] is not None

    def test_status_reports_the_reconcile_runner_state(self, client):
        with signed_in_as(ADMIN):
            body = client.get(STATUS).json()
        assert body["reconcile"] == {"in_flight": None, "last_run": None}


# ─── 4. POST /reconcile — off the request path ──────────────────────────────

class TestReconcileIsNotInline:
    def test_the_POST_returns_while_the_run_is_still_BLOCKED(self, client, monkeypatch):
        """🔴 THE LOAD-BEARING TEST.

        The fake blocks on an Event that nothing has set. If the run were on the
        request path — inline, OR via `BackgroundTasks`, which TestClient waits
        on before returning — this request could not come back at all and the
        test would time out at the `join` below instead of asserting. It returns
        because the work is on a dedicated daemon thread.
        """
        entered = threading.Event()
        release = threading.Event()
        ran_on: list[str] = []

        def _blocking(dry_run=True, db_path=None, max_pages=60):
            ran_on.append(threading.current_thread().name)
            entered.set()
            assert release.wait(timeout=20), "the runner thread was never released"
            return {"dry_run": dry_run, "proposed_creates": [], "proposed_delists": [],
                    "ambiguous": [], "rejected": [], "live_symbols_count": 0,
                    "open_aliases_count": 0, "skipped_existing_count": 0}

        monkeypatch.setattr(reconciliation, "run_reconciliation", _blocking)

        with signed_in_as(ADMIN):
            r = client.post(RECONCILE)
            assert r.status_code == 200, r.text
            assert r.json()["started"] is True
            assert entered.wait(timeout=10), "the runner thread never started"
            assert not release.is_set(), (
                "the response arrived only after the run finished — it is on the "
                "request path")

            # …and while it is in flight, /status says so.
            in_flight = client.get(STATUS).json()["reconcile"]["in_flight"]
            assert in_flight is not None and in_flight["dry_run"] is True

            release.set()
            assert _wait_until_idle(), "the reconcile thread never finished"

            after = client.get(STATUS).json()["reconcile"]
            assert after["in_flight"] is None
            assert after["last_run"]["ok"] is True

        assert ran_on and ran_on[0] == "entity-master-reconcile", (
            f"the run happened on {ran_on!r}; it must be on its own daemon "
            "thread, not the shared anyio threadpool a BackgroundTask borrows")

    def test_a_SECOND_request_while_one_is_in_flight_is_refused(self, client, monkeypatch):
        """Single-flight. Two overlapping 60-page Massive walks is waste at
        best and a double-spend at worst; the second caller is told, never
        silently merged into the first."""
        release = threading.Event()
        entered = threading.Event()
        calls: list[int] = []

        def _blocking(dry_run=True, db_path=None, max_pages=60):
            calls.append(1)
            entered.set()
            assert release.wait(timeout=20)
            return {"dry_run": dry_run, "proposed_creates": [], "proposed_delists": [],
                    "ambiguous": [], "rejected": []}

        monkeypatch.setattr(reconciliation, "run_reconciliation", _blocking)

        with signed_in_as(ADMIN):
            assert client.post(RECONCILE).status_code == 200
            assert entered.wait(timeout=10)
            second = client.post(RECONCILE)
            assert second.status_code == 409, second.text
            assert "already in flight" in second.json()["detail"]
            release.set()
            assert _wait_until_idle()

        assert len(calls) == 1, f"{len(calls)} runs started; single-flight failed"

    def test_a_FAILED_run_is_recorded_rather_than_lost(self, client, monkeypatch):
        """A background run that dies silently is indistinguishable from one
        that never started. The failure has to be readable off `/status`."""
        def _boom(dry_run=True, db_path=None, max_pages=60):
            raise RuntimeError("massive unreachable")

        monkeypatch.setattr(reconciliation, "run_reconciliation", _boom)
        with signed_in_as(ADMIN):
            assert client.post(RECONCILE).status_code == 200
            assert _wait_until_idle()
            last = client.get(STATUS).json()["reconcile"]["last_run"]
        assert last["ok"] is False
        assert "massive unreachable" in last["error"]
        # …and the slot is released, so the surface is not wedged at 409.
        assert rt._reconcile_state()["in_flight"] is None


# ─── 5. POST /reconcile — explicit, dry by default, idempotent ──────────────

#: A fixed stand-in for `massive.list_reference_tickers`'s canonicalized output.
#: The route never reaches the network in this file; this is what the real
#: `run_reconciliation` diffs against.
_FAKE_LIVE_ROWS = {
    "AAPL": {"ticker": "AAPL", "type": "CS", "list_date": "1980-12-12",
             "composite_figi": "BBG000B9XRY4"},
    "MSFT": {"ticker": "MSFT", "type": "CS", "list_date": "1986-03-13",
             "composite_figi": "BBG000BPH459"},
    "SPY": {"ticker": "SPY", "type": "ETF", "list_date": "1993-01-29",
            "composite_figi": "BBG000BDTBL9"},
}


def _use_real_reconciliation(monkeypatch) -> None:
    """The real diff-and-apply logic, with only its ONE network call stubbed."""
    monkeypatch.setattr(reconciliation, "run_reconciliation", _REAL_RUN_RECONCILIATION)
    monkeypatch.setattr(reconciliation, "_massive_reference_rows_canonical",
                        lambda max_pages=60: dict(_FAKE_LIVE_ROWS))


class TestReconcileWrites:
    def test_the_DEFAULT_call_is_a_dry_run_and_writes_NOTHING(self, client, monkeypatch):
        """`run_reconciliation`'s own contract is "callers must opt IN to real
        writes", and `scripts/entity_master_seed.py --dry-run` is the same
        discipline. The route must not be the place that quietly inverts it."""
        _use_real_reconciliation(monkeypatch)
        with signed_in_as(ADMIN):
            r = client.post(RECONCILE)
            assert r.json()["dry_run"] is True
            assert _wait_until_idle()
            body = client.get(STATUS).json()

        assert body["entities"] == 0, "a dry run wrote to the store"
        assert body["events"] == 0
        last = body["reconcile"]["last_run"]
        assert last["ok"] is True and last["dry_run"] is True
        assert last["proposed_creates_count"] == 3
        assert sorted(last["proposed_creates_sample"]) == ["AAPL", "MSFT", "SPY"]

    def test_a_REAL_run_needs_dry_run_false_EXPLICITLY(self, client, monkeypatch):
        _use_real_reconciliation(monkeypatch)
        with signed_in_as(ADMIN):
            r = client.post(RECONCILE, params={"dry_run": "false"})
            assert r.status_code == 200
            assert r.json()["dry_run"] is False
            assert _wait_until_idle()
            body = client.get(STATUS).json()

        assert body["entities"] == 3
        assert body["reconcile"]["last_run"]["created"] == 3
        assert body["last_reconcile_at"] is not None, (
            "a reconcile-sourced event must move last_reconcile_at")

    def test_a_REAL_run_REPEATED_changes_nothing(self, client, monkeypatch):
        """🔴 IDEMPOTENCE, DRIVEN THROUGH THE ROUTE, NOT ASSERTED FROM THE
        SERVICE'S DOCSTRING. Two full runs, same store; the second must create
        nothing and leave every count identical."""
        _use_real_reconciliation(monkeypatch)
        with signed_in_as(ADMIN):
            assert client.post(RECONCILE, params={"dry_run": "false"}).status_code == 200
            assert _wait_until_idle()
            first = client.get(STATUS).json()

            assert client.post(RECONCILE, params={"dry_run": "false"}).status_code == 200
            assert _wait_until_idle()
            second = client.get(STATUS).json()

        assert first["entities"] == 3  # control: the first run really did write
        for field in ("entities", "aliases", "open_aliases", "delisted",
                      "vendor_symbols", "relations", "ambiguous_count"):
            assert second[field] == first[field], (
                f"'{field}' moved on a repeat run: {first[field]} -> {second[field]}")
        assert second["reconcile"]["last_run"]["created"] == 0
        assert second["reconcile"]["last_run"]["proposed_creates_count"] == 0
        assert second["rejected_events"] == 0

    def test_a_symbol_that_LEFT_the_live_feed_is_proposed_for_DELISTING(self, client, monkeypatch):
        """The other half of the diff, so "idempotent" cannot be satisfied by a
        runner that had stopped proposing anything at all."""
        _use_real_reconciliation(monkeypatch)
        _seed("GONE", valid_from="2005-01-01")
        with signed_in_as(ADMIN):
            assert client.post(RECONCILE).status_code == 200
            assert _wait_until_idle()
            last = client.get(STATUS).json()["reconcile"]["last_run"]
        assert last["proposed_delists_count"] == 1
        assert last["proposed_delists_sample"] == ["GONE"]
