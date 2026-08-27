"""E-4 — the surface E-2's ``join_clause`` reaches, and the four counts a member reads.

E4-A5 gave E-4 the choice of three wirings and told it to record the one it took.
It took **its own endpoint** — ``GET /api/scans/definition-results``, in
``api/routers/scan_results.py``, registered in ``api/main.py``. The reasoning is
in that module's docstring; what this file gates is that the choice cannot rot:

  * ⛔ **NO SQL IS BUILT FROM A CLIENT STRING.** The ``def_hash`` is the one value
    a caller supplies, and it leaves the module only as a BOUND PARAMETER.
    Asserted twice — behaviourally (an injection payload selects NOTHING and the
    table survives) and structurally (an AST walk proving the SQL argument of
    every ``execute`` is built from literals and the fragment ``scan_store``
    returned, with no f-string, ``%`` or ``+`` anywhere in the module).
  * ⛔ **THE ROUTE IS PAID**, derived off ``router.routes`` rather than listed.
  * 🔴 **``coverage is None`` IS "NOBODY LOOKED", NEVER ZERO** (E6-A2). An unrun
    or pruned window must not reach the browser as a receipt of zeroes, because
    ``CoverageLine`` would render it as a fully-covered empty screen.
  * ⛔ **THE FOUR OUTCOMES SURVIVE THE TRIP.** ``not_computable`` folded into
    ``dropped`` on the way out makes a capped-history universe read as a failing
    screen (controller resolution 5), and no count in the store would move.

⚠️ THE COUNTS ARE NOT RESTATED. Every expectation is derived from the receipt
this test wrote through ``scan_store.record_coverage`` — the store is the
authority, and a test that retyped its numbers would be a second one.
"""
from __future__ import annotations

import ast as pyast
import contextlib
import datetime
import json
import sqlite3
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import scan_results as mod
from api.services import ast_freshness
from api.services.screener import scan_store, snapshot_db

ROOT = Path(__file__).resolve().parents[1]
MODULE_REL = "api/routers/scan_results.py"

DEF_HASH = "sha256:" + "a" * 64
TF = "D"
AS_OF = 20260807

FREE_USER = {"id": "free1", "role": "member", "plan": "free"}
PAID_USER = {"id": "paid1", "role": "member", "plan": "pro"}

#: The symbols the fake sweep answered, and the two it could not. ⛔ BUILT, never
#: restated: every count below is measured off these lists so the fixture and its
#: own arithmetic cannot drift (plan-review #10).
HITS = ["AAA", "BBB", "CCC"]
NOT_COMPUTABLE = ["DDD", "EEE"]
DROPPED = ["FFF"]
IN_SNAPSHOT = HITS + NOT_COMPUTABLE + DROPPED + ["ZZZ"]

#: ⛔ DERIVED, NOT TYPED. E-2's `record_coverage` defaults `freshness` to
#: `"unknown"` and E-3's interface note says the caller must pass
#: `ast_freshness.freshness_for(tree)["mode"]`. A literal here would be a second
#: copy of a vocabulary `FRESHNESS_MODES` already owns.
SCALAR_TREE = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "market_cap"}, {"type": "num", "value": 1}]}
FRESHNESS = ast_freshness.freshness_for(SCALAR_TREE)["mode"]


@pytest.fixture
def store(tmp_path, monkeypatch):
    """A screener database of this test's own, proved to be the one in use."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    monkeypatch.setattr(scan_store, "_INITED", set())
    assert snapshot_db.get_db_path() == str(path), (
        "SCREENER_DB_PATH did not reach snapshot_db — a module-level capture has "
        "appeared and this whole file is writing somewhere else")
    scan_store.init_db()
    with contextlib.closing(snapshot_db.connect()) as conn:
        for t in IN_SNAPSHOT:
            conn.execute("INSERT INTO screener_rows (ticker) VALUES (?)", (t,))
        conn.commit()
    return path


def _record():
    """One sweep's worth of rows, exactly as ``scan_evaluator`` would file them."""
    scan_store.record_hits(DEF_HASH, TF, AS_OF, HITS)
    dropped_symbols = (
        [{"ticker": t, "reason": "not-computable"} for t in NOT_COMPUTABLE]
        + [{"ticker": t, "reason": "no-bars"} for t in DROPPED]
    )
    scan_store.record_coverage(
        DEF_HASH, TF, AS_OF,
        evaluated=len(IN_SNAPSHOT),
        answered=len(IN_SNAPSHOT) - len(NOT_COMPUTABLE) - len(DROPPED),
        dropped=len(DROPPED),
        not_computable=len(NOT_COMPUTABLE),
        dropped_symbols=dropped_symbols,
        freshness=FRESHNESS,
    )


#: ⭐ THE LIVE HALF. `SCAN_LIVE_SWEEP_ENABLED` is unset in production, so
#: `scan_hits_live` is empty and the overlay's tail is empty with it — which is
#: exactly why the surface reading it was never checked. These rows are what the
#: day that variable is set looks like.
#:
#: ⛔ THE TICK IS ET-ANCHORED AND THE READ CLOCK IS FROZEN TO IT. `hits_for` gates
#: a live row on `live_session_ymd(row) == live_session_ymd(now)` AND on
#: `now - row <= live_max_age_s()`; a fixture that let either float would pass at
#: 10:42 and fail at midnight.
_ET = ZoneInfo("America/New_York")
LIVE_TICK = int(datetime.datetime(2026, 8, 26, 10, 42, tzinfo=_ET).timestamp())

#: Live-only names that ARE in `screener_rows` (so the join keeps them), plus one
#: that is NOT (so the join can be seen to bite on this half too).
LIVE_ONLY = ["LVA", "LVB", "LVC", "LVD"]
LIVE_ONLY_GONE = "LVGONE"


@pytest.fixture
def live_clock(monkeypatch):
    """`_now_for_reads` — the read path's ONE seam — pinned to the fixture tick."""
    monkeypatch.setattr(scan_store, "_now_for_reads", lambda: float(LIVE_TICK))
    return LIVE_TICK


def _add_snapshot_rows(tickers):
    with contextlib.closing(snapshot_db.connect()) as conn:
        for t in tickers:
            conn.execute("INSERT INTO screener_rows (ticker) VALUES (?)", (t,))
        conn.commit()


def _record_live(symbols):
    """One live cycle's worth of rows for this definition, at ``LIVE_TICK``."""
    scan_store.upsert_live_hits(
        DEF_HASH, TF,
        [{"symbol": s, "value": 1, "live_cols": 4, "src_price": 10.5} for s in symbols],
        LIVE_TICK)


def _client(user):
    app = FastAPI()
    app.include_router(mod.router)
    if user is not None:
        # ⚠️ THE OVERRIDES ARE ON THE IDENTITY DEPENDENCIES, NEVER ON
        # `require_paid` — overriding the gate means the test never runs it.
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def _get(user, **params):
    q = {"def_hash": DEF_HASH, "tf": TF, "as_of": str(AS_OF)}
    q.update(params)
    return _client(user).get("/api/scans/definition-results", params=q)


# ─── the gate, derived ───────────────────────────────────────────────────────

def test_every_route_this_module_mounts_is_PAID_and_the_set_is_DERIVED():
    routes = [r for r in mod.router.routes if getattr(r, "methods", None)]
    assert routes, "the router mounts nothing — this whole file would pass vacuously"
    for route in routes:
        calls = [d.call for d in route.dependant.dependencies]
        assert mod.require_paid in calls, (
            f"{sorted(route.methods)} {route.path} is mounted WITHOUT this module's "
            "own `require_paid`. `main.py` includes the router with no router-level "
            "dependency, so an ungated route here is reachable by anybody.")


def _included_router_modules(src: str) -> set:
    """Every `api.routers.X` whose `.router` reaches `app.include_router`, BY AST.

    ⛔ AN AST, NEVER A GREP. A grep for the module name reports the import line,
    the comment above it and any prose that mentions it — this repo has already
    measured a probe that "found 5 call sites, all five of them prose". The alias
    is resolved off the `import ... as ...` statements so a rename of the local
    name cannot make this pass on a router nobody mounts.
    """
    tree = pyast.parse(src)
    alias_to_module = {}
    for node in pyast.walk(tree):
        if isinstance(node, pyast.ImportFrom) and (node.module or "").startswith("api.routers"):
            for a in node.names:
                alias_to_module[a.asname or a.name] = f"{node.module}.{a.name}"
    included = set()
    for node in pyast.walk(tree):
        if not (isinstance(node, pyast.Call) and isinstance(node.func, pyast.Attribute)
                and node.func.attr == "include_router" and node.args):
            continue
        arg = node.args[0]
        # `app.include_router(x_router.router)`
        if isinstance(arg, pyast.Attribute) and arg.attr == "router" and isinstance(arg.value, pyast.Name):
            included.add(alias_to_module.get(arg.value.id, arg.value.id))
    return included


def test_the_route_is_REGISTERED_in_main_so_a_derived_census_can_find_it():
    # ⛔ E-7 derives the path from `router.routes` and must not type it. A route
    # defined in a module nobody includes is invisible to that census, which is
    # the "built, tested, green and mounted nowhere" class this phase retires.
    #
    # ⚠️ THE APP IS NOT IMPORTED. `api.main` creates directories under the shared
    # `/data` root at import, and `conftest.py`'s tripwire refuses that inside a
    # test — correctly. The registration is read off `api/main.py`'s AST instead.
    included = _included_router_modules((ROOT / "api/main.py").read_text(encoding="utf-8"))
    assert mod.__name__ in included, (
        f"{mod.__name__} is not passed to include_router in api/main.py — the route "
        f"exists and nothing serves it. Mounted: {len(included)} routers.")


def test_the_registration_probe_is_NOT_vacuous():
    """A main.py WITHOUT the include must not satisfy the probe above."""
    with_it = _included_router_modules(
        "from api.routers import scan_results as scan_results_router\n"
        "app.include_router(scan_results_router.router)\n")
    without = _included_router_modules(
        "from api.routers import scan_results as scan_results_router\n"
        "# app.include_router(scan_results_router.router)\n")
    assert with_it == {"api.routers.scan_results"}
    assert without == set()


def test_a_free_member_is_REFUSED(store):
    _record()
    r = _get(FREE_USER)
    assert r.status_code == 402, r.text
    assert "paid plan" in r.json()["detail"]


def test_and_a_paid_member_is_ANSWERED(store):
    # A sweep that only proves refusals cannot tell a gate from an outage.
    _record()
    assert _get(PAID_USER).status_code == 200


# ─── the answer ──────────────────────────────────────────────────────────────

def test_the_hits_come_back_and_they_are_the_JOIN_against_screener_rows(store):
    _record()
    body = _get(PAID_USER).json()
    assert body["status"] == "evaluated"
    assert body["tickers"] == sorted(HITS)
    assert body["truncated"] is False
    # ⛔ AND THE NON-HITS ARE ABSENT. Without this the assertion above passes
    # against a handler that returned the whole snapshot.
    assert set(body["tickers"]).isdisjoint(NOT_COMPUTABLE + DROPPED + ["ZZZ"])


def test_a_hit_whose_screener_row_is_GONE_is_not_reported(store):
    # This is what the JOIN buys over reading `scan_hits` directly: a symbol the
    # nightly build dropped out of the snapshot is no longer a row a member can
    # act on, and reporting it would hand them a ticker with no data behind it.
    _record()
    with contextlib.closing(snapshot_db.connect()) as conn:
        conn.execute("DELETE FROM screener_rows WHERE ticker=?", (HITS[0],))
        conn.commit()
    body = _get(PAID_USER).json()
    assert HITS[0] not in body["tickers"]
    assert body["tickers"] == sorted(HITS[1:])


def test_the_FOUR_outcomes_survive_the_trip_to_the_browser(store):
    _record()
    body = _get(PAID_USER).json()
    stored = scan_store.coverage(DEF_HASH, TF, AS_OF)
    # ⛔ DERIVED FROM THE STORE, not retyped. `not_computable` folded into
    # `dropped` on the way out makes a capped-history universe read as a failing
    # screen and no count in the database would move.
    for key in ("evaluated", "answered", "dropped", "not_computable"):
        assert body["coverage"][key] == stored[key], key
    assert body["coverage"]["not_computable"] == len(NOT_COMPUTABLE)
    assert body["coverage"]["dropped"] == len(DROPPED)
    assert body["coverage"]["not_computable"] != body["coverage"]["dropped"], (
        "the fixture cannot tell a fold from a pass-through — pick different sizes")
    assert (body["coverage"]["answered"] + body["coverage"]["dropped"]
            + body["coverage"]["not_computable"]) == body["coverage"]["evaluated"]
    assert {d["ticker"] for d in body["coverage"]["dropped_symbols"]} == set(
        NOT_COMPUTABLE + DROPPED)


def test_a_window_NOBODY_SWEPT_answers_not_run_and_a_NULL_receipt(store):
    # 🔴 E6-A2. `coverage() is None` is "nobody looked" and it is not zero. A
    # handler that returned `{"coverage": {...zeroes}}` here would make
    # `CoverageLine` draw a fully-covered empty screen for a scan that never ran.
    body = _get(PAID_USER, as_of="20260806").json()
    assert body["status"] == "not-run"
    assert body["coverage"] is None
    assert body["tickers"] == []


def test_the_row_cap_bounds_the_PAGE_and_never_the_COUNTS(store):
    _record()
    body = _get(PAID_USER, limit=2).json()
    assert body["tickers"] == sorted(HITS)[:2]
    assert body["truncated"] is True
    # The receipt is the authority on how many there were, and it is untouched.
    assert body["coverage"]["evaluated"] == len(IN_SNAPSHOT)


# ─── ⭐ THE LIVE-ONLY TAIL (X43 · A6) ─────────────────────────────────────────
#
# The route appends every FRESH live row this definition hit that the nightly
# scan did not return, marks it `in_nightly: False`, bounds it by the same page
# limit and reports the cut under `truncated`. Until W9l.1 nothing rendered any
# of it — the rows were built, capped and discarded on every request — and the
# defect was invisible because `SCAN_LIVE_SWEEP_ENABLED` is unset, so the tail is
# empty and the response is byte-identical either way.
#
# ⛔ THAT IS THE POINT OF THESE CASES: they plant the live rows the env flip would
# create, so the contract `app/src/components/screener/ScanResults.jsx` now reads
# fails HERE rather than on the day someone sets the variable.


def _hits_by_symbol(body):
    return {r["symbol"]: r for r in body["hits"]}


def test_a_LIVE_ONLY_hit_reaches_the_browser_under_hits_and_stays_OUT_of_tickers(store, live_clock):
    _record()
    _add_snapshot_rows(LIVE_ONLY[:1])
    # One symbol that is ALSO a nightly hit (so `in_nightly` really discriminates)
    # and one that is not.
    _record_live([HITS[0], LIVE_ONLY[0]])
    body = _get(PAID_USER).json()

    # ⛔ `tickers` DID NOT MOVE. It is the nightly half, and W5a's reader depends
    # on that; a live-only symbol promoted into it would claim the nightly scan
    # returned a name it never saw.
    assert body["tickers"] == sorted(HITS)
    rows = _hits_by_symbol(body)
    assert rows[LIVE_ONLY[0]]["in_nightly"] is False
    assert rows[LIVE_ONLY[0]]["tier"] == "live"
    assert rows[LIVE_ONLY[0]]["live_as_of"] == LIVE_TICK
    # ⛔ AND THE FIXTURE CAN TELL THE TWO APART. A nightly hit with a live row is
    # `tier: live` AND `in_nightly: True` — without this, "the tail arrived" is
    # satisfied by a response that marked every live row live-only.
    assert rows[HITS[0]]["tier"] == "live" and rows[HITS[0]]["in_nightly"] is True
    assert {r["in_nightly"] for r in body["hits"]} == {True, False}


def test_CONTROL_with_no_live_rows_NOTHING_is_live_only(store, live_clock):
    # The state production is in right now. If this ever grows an `in_nightly:
    # False` row, the surface would caption an ordinary nightly screen with a
    # live sweep that never ran.
    _record()
    body = _get(PAID_USER).json()
    assert body["hits"], "no rows at all — the assertion below would pass vacuously"
    assert all(r["in_nightly"] is True for r in body["hits"])
    assert all(r["tier"] == "nightly" for r in body["hits"])


def test_a_live_only_symbol_the_SNAPSHOT_no_longer_carries_is_not_reported(store, live_clock):
    # The route's own ⛔: the tail passes the SAME join the nightly page passes.
    # A symbol the nightly build dropped out of `screener_rows` is one a member
    # cannot act on, and a live hit is no exception.
    _record()
    _add_snapshot_rows(LIVE_ONLY[:1])
    _record_live([LIVE_ONLY[0], LIVE_ONLY_GONE])
    body = _get(PAID_USER).json()
    rows = _hits_by_symbol(body)
    assert LIVE_ONLY_GONE not in rows
    # …and the control: the symbol that IS in the snapshot came through, so the
    # absence above is the join and not an empty tail.
    assert rows[LIVE_ONLY[0]]["in_nightly"] is False


def test_the_live_only_tail_is_BOUNDED_by_the_page_limit_and_a_CUT_TAIL_says_truncated(store, live_clock):
    # ⛔ A CUT TAIL MUST SET `truncated`. A page that silently loses symbols
    # returns fewer hits and reads as a quiet market — the exact lie
    # `CoverageLine` exists to refuse, one list further down.
    _record()
    _add_snapshot_rows(LIVE_ONLY)
    _record_live(LIVE_ONLY)
    # `limit == len(HITS)` so the NIGHTLY half is whole and the only thing this
    # case can be measuring is the tail.
    body = _get(PAID_USER, limit=len(HITS)).json()
    assert body["tickers"] == sorted(HITS)
    live_only = [r["symbol"] for r in body["hits"] if not r["in_nightly"]]
    assert len(live_only) == len(HITS) < len(LIVE_ONLY)
    assert body["truncated"] is True


def test_CONTROL_a_tail_that_FITS_is_whole_and_says_nothing_about_a_cut(store, live_clock):
    _record()
    _add_snapshot_rows(LIVE_ONLY)
    _record_live(LIVE_ONLY)
    body = _get(PAID_USER, limit=len(LIVE_ONLY)).json()
    live_only = [r["symbol"] for r in body["hits"] if not r["in_nightly"]]
    assert sorted(live_only) == sorted(LIVE_ONLY)
    assert body["truncated"] is False


def test_a_PRODUCT_LABEL_timeframe_is_refused_and_TOLD_the_code(store):
    _record()
    r = _get(PAID_USER, tf="Daily")
    assert r.status_code == 400
    assert "'D'" in r.json()["detail"]


# ─── ⛔ NO SQL FROM A CLIENT STRING ───────────────────────────────────────────

@pytest.mark.parametrize("payload", [
    "x' OR '1'='1",
    "x'; DROP TABLE screener_rows; --",
    "x' UNION SELECT ticker FROM screener_rows --",
])
def test_an_INJECTED_def_hash_selects_nothing_and_the_table_survives(store, payload):
    _record()
    r = _get(PAID_USER, def_hash=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    # No receipt for that handle, so the honest answer is "nobody looked".
    assert body["status"] == "not-run"
    assert body["tickers"] == []
    with contextlib.closing(sqlite3.connect(str(store))) as c:
        names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "screener_rows" in names
        assert c.execute("SELECT COUNT(*) FROM screener_rows").fetchone()[0] == len(IN_SNAPSHOT)


def test_an_injected_def_hash_cannot_reach_the_ROW_PATH_either(store, monkeypatch):
    """The case above stops at the receipt, so it proves nothing about the JOIN.

    ⚠️ THAT IS THE VACUITY THIS EXISTS TO CLOSE: a payload that never gets past
    ``coverage() is None`` would pass the injection test against a handler that
    built its WHERE clause by concatenation. So a receipt is planted UNDER the
    payload and the row path is driven with it.
    """
    payload = "x' OR '1'='1"
    scan_store.record_coverage(
        payload, TF, AS_OF, evaluated=1, answered=1, dropped=0, not_computable=0,
        dropped_symbols=[], freshness=FRESHNESS)
    scan_store.record_hits(DEF_HASH, TF, AS_OF, HITS)
    body = _get(PAID_USER, def_hash=payload).json()
    assert body["status"] == "evaluated"
    # ⛔ NOTHING. A concatenated `'1'='1'` would return the whole snapshot here.
    assert body["tickers"] == []


def test_the_module_builds_its_SQL_from_LITERALS_and_the_STORE_S_FRAGMENT_only():
    """The structural half, because the behavioural half above can only sample.

    Every ``execute`` argument in this module must be an expression made of
    string LITERALS and NAMES — no f-string, no ``%`` formatting, no ``.format``.
    ⛔ A grep would report the prose in the docstring; this walks the AST.
    """
    src = (ROOT / MODULE_REL).read_text(encoding="utf-8")
    tree = pyast.parse(src)

    def _offences(node):
        bad = []
        for n in pyast.walk(node):
            if isinstance(n, pyast.JoinedStr):
                bad.append("f-string")
            if isinstance(n, pyast.BinOp) and isinstance(n.op, pyast.Mod):
                bad.append("%-format")
            if (isinstance(n, pyast.Call) and isinstance(n.func, pyast.Attribute)
                    and n.func.attr == "format"):
                bad.append(".format")
        return bad

    def _is_execute(n):
        return (isinstance(n, pyast.Call) and isinstance(n.func, pyast.Attribute)
                and n.func.attr in {"execute", "executescript", "executemany"})

    executes = [n for n in pyast.walk(tree) if _is_execute(n)]
    assert executes, "no `execute` call found — this rail would pass on an empty module"
    for call in executes:
        assert _offences(call.args[0]) == [], (
            f"the SQL handed to `{call.func.attr}` at line {call.lineno} is BUILT, "
            "not composed from literals and a bound fragment")

    # …and the WHOLE FUNCTION around each one, so a helper that assembled the
    # string a line earlier cannot pass by handing a bare Name to `execute`.
    #
    # ⚠️ SCOPED TO THOSE FUNCTIONS RATHER THAN THE WHOLE MODULE, and the reason is
    # a live one: an f-string in a 402 message or a docstring is not a SQL defect,
    # and a rail that failed on one would be a rail the next author deletes.
    sql_fns = [f for f in pyast.walk(tree)
               if isinstance(f, (pyast.FunctionDef, pyast.AsyncFunctionDef))
               and any(_is_execute(n) for n in pyast.walk(f))]
    assert sql_fns, "no function carries an `execute` — the scoped rail has no subject"
    for fn in sql_fns:
        assert _offences(fn) == [], (
            f"`{fn.name}` formats a string; the SQL path must be literals plus "
            "`scan_store.join_clause`'s fragment, and nothing else")

    # The fragment really is the store's, by NAME, so a future edit that inlined
    # a copy of it here is a failure rather than a duplicate.
    called = {pyast.unparse(n.func) for n in pyast.walk(tree) if isinstance(n, pyast.Call)}
    assert "scan_store.join_clause" in called
    assert "scan_store.coverage" in called


def test_the_ast_rail_is_NOT_vacuous():
    """A planted concatenation must be caught, or the rail above proves nothing."""
    dirty = pyast.parse(
        "def f(conn, h):\n"
        "    return conn.execute(f'SELECT 1 FROM t WHERE h = {h}')\n")
    calls = [n for n in pyast.walk(dirty) if isinstance(n, pyast.Call)
             and isinstance(n.func, pyast.Attribute) and n.func.attr == "execute"]
    assert calls
    assert any(isinstance(n, pyast.JoinedStr) for n in pyast.walk(calls[0].args[0]))


def test_the_response_is_JSON_SERIALISABLE_end_to_end(store):
    # `dropped_symbols` comes back out of the store as parsed JSON; a receipt
    # carrying anything orjson refuses would 500 the whole screen.
    _record()
    r = _get(PAID_USER)
    assert r.status_code == 200
    json.loads(r.content)
