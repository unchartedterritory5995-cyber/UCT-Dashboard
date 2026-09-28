"""TERM-023 (FB-S3-01) -- the Entity Master's MEMBER path: a resolution route,
an adoption rail on ticker search, and the denominators beside the admin
status numbers.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
--------------------------------------------
1. (a) A PAID member can reach the resolution route -- asserted off the
   served app's DEPENDENCY TREE by object identity (the router's own
   `require_paid`), not off the route merely existing. Refused for a free
   member (402) and an anonymous caller (401) once armed.
2. (b) Item 16's own criterion, on a DATED FIXTURE: a ticker that changed
   hands (GM: Motors Liquidation until 2009-06-01, the new General Motors
   from 2010-11-18) resolves to the RIGHT ENTITY FOR THE RIGHT DATE, and a
   date in the gap resolves to nothing rather than to the nearest owner. The
   undated resolver the research tabs already use would answer "new GM" for
   2005 -- that is the pre-change path this rail went red on.
3. (c) No response on an ADOPTED surface is keyed by a bare ticker where the
   store holds an entity for it -- checked by one checker over the resolve
   route and over `/api/ticker-search`, with a CONTROL proving the checker
   names a bare row.
4. DARK. `ENTITY_MASTER_MEMBER_ENABLED` unset (or "0"): the route answers the
   FastAPI 404 body to everyone, admin included, and `entity_master.db` is
   never opened or created; `/api/ticker-search` answers byte-for-byte what
   it answers with the adoption hook removed, and never calls the hook.
5. The lesson "a symbol universe does not settle a ticker match": GAP and RS
   are real tickers and resolve; nothing here filters a query through
   cap_universe or a word list.

Every store here is a tmp file (`schema.DB_PATH` repointed), every source is
synthetic, and nothing sends a network request. No assertion depends on
whether `app/dist` is built: the route is mounted ahead of the SPA catch-all,
and the 404 compared against is the literal FastAPI body.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import (  # noqa: E402
    get_current_user as _get_current_user,
    get_current_user_with_plan as _get_current_user_with_plan,
)
from api.routers import entity_resolve as rt  # noqa: E402
from api.routers import ticker_search as ts_router  # noqa: E402
from api.services import delisted_registry  # noqa: E402
from api.services import ticker_search_index as tsi  # noqa: E402
from api.services.entity_master import api as em_api  # noqa: E402
from api.services.entity_master import member_resolve  # noqa: E402
from api.services.entity_master import schema as em_schema  # noqa: E402
from api.services.entity_master import store as em_store  # noqa: E402
from tests.authclients import ADMIN, FREE_MEMBER, PAID_MEMBER, signed_in_as  # noqa: E402

FLAG = "ENTITY_MASTER_MEMBER_ENABLED"
RESOLVE = "/api/entity/resolve"
SEARCH = "/api/ticker-search"
FASTAPI_404 = b'{"detail":"Not Found"}'


# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    """THE REAL APP, imported, never rebuilt."""
    from api.main import app as real_app
    return real_app


@pytest.fixture
def client(app):
    """Not a context manager: the lifespan (scheduler, prewarms) is not needed
    to test routing, gates and shapes."""
    yield TestClient(app, raise_server_exceptions=False)
    for dep in (_get_current_user, _get_current_user_with_plan):
        app.dependency_overrides.pop(dep, None)


def _reset_em_caches():
    em_store._local.conns = {}
    em_store._ALIAS_CACHE.clear()
    em_store._CACHE_LOADED = False


@pytest.fixture(autouse=True)
def em_db(tmp_path, monkeypatch):
    """A throwaway store path that does NOT exist yet -- so a test can tell
    "the dark path opened the store" (the file appears) from "it did not"."""
    path = str(tmp_path / "em" / "entity_master.db")
    monkeypatch.setattr(em_schema, "DB_PATH", path)
    _reset_em_caches()
    member_resolve.reset_counts()
    yield path
    _reset_em_caches()
    member_resolve.reset_counts()


@pytest.fixture
def armed(monkeypatch):
    monkeypatch.setenv(FLAG, "1")


@pytest.fixture
def unset(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)


def _new(alias, valid_from, key, entity_type="equity"):
    r = em_api.apply_event(
        "new_entity",
        {"entity_type": entity_type, "initial_alias": alias, "initial_alias_valid_from": valid_from},
        dedup_key=key, source="admin_manual",
    )
    assert r.accepted, r.reason
    return r.entity_id


@pytest.fixture
def gm(em_db):
    """THE DATED FIXTURE. Old GM held GM (and the registry's disambiguated
    GM-OLD key) until 2009-06-01; new GM took GM on 2010-11-18. Written through
    `apply_event`, so the write-time collision guard is exercised too: the two
    GM windows do not overlap, which is why the second one is accepted."""
    old = _new("GM", "1990-01-01", "fx:old-gm")
    assert em_api.apply_event("alias_added", {"entity_id": old, "alias": "GM-OLD", "valid_from": "1990-01-01"},
                              dedup_key="fx:old-gm:key", source="admin_manual").accepted
    for alias in ("GM", "GM-OLD"):
        assert em_api.apply_event("alias_retired", {"entity_id": old, "alias": alias, "valid_to": "2009-06-01"},
                                  dedup_key=f"fx:old-gm:close:{alias}", source="admin_manual").accepted
    assert em_api.apply_event("delisted", {"entity_id": old, "lifecycle_since": "2009-06-01"},
                              dedup_key="fx:old-gm:delist", source="admin_manual").accepted
    new = _new("GM", "2010-11-18", "fx:new-gm")
    gap = _new("GAP", "1976-05-20", "fx:gap")
    rs = _new("RS", "1994-01-01", "fx:rs")
    em_store.rebuild_cache()
    assert old != new
    return {"old": old, "new": new, "gap": gap, "rs": rs}


# ── (a) the gate, read off the dependency tree ──────────────────────────────

def _route(app, path):
    hits = [r for r in app.routes if getattr(r, "path", None) == path and "GET" in (getattr(r, "methods", None) or ())]
    assert len(hits) == 1, f"{path} is mounted {len(hits)} times on the served app"
    return hits[0]


def _calls(dependant):
    out = []
    for d in dependant.dependencies:
        out.append(d.call)
        out.extend(_calls(d))
    return out


def test_a_the_route_is_on_the_SERVED_app_and_its_dependency_is_THIS_routers_require_paid(app):
    route = _route(app, RESOLVE)
    calls = _calls(route.dependant)
    assert rt.require_paid in calls, (
        "the member resolution route must carry require_paid in its dependency tree "
        "(object identity -- a name in the source proves nothing)")
    # The dark switch runs FIRST, so an unarmed route is a 404 to everyone
    # before any identity is read.
    assert route.dependant.dependencies[0].call is rt._armed


def test_a_CONTROL_the_dependency_walk_can_say_a_gate_is_MISSING(app):
    """A walk that found `require_paid` everywhere would pass the test above
    for the wrong reason: `/api/ticker-search` is anonymous by design."""
    assert rt.require_paid not in _calls(_route(app, SEARCH).dependant)


def test_a_armed_PAID_reaches_it_FREE_is_402_ANONYMOUS_is_401(client, armed, gm):
    with signed_in_as(PAID_MEMBER):
        assert client.get(RESOLVE, params={"q": "GM"}).status_code == 200
    with signed_in_as(FREE_MEMBER):
        r = client.get(RESOLVE, params={"q": "GM"})
        assert r.status_code == 402, r.text
        assert "entity resolution" in r.json()["detail"].lower()
    assert client.get(RESOLVE, params={"q": "GM"}).status_code == 401


# ── (b) the dated fixture ───────────────────────────────────────────────────

@pytest.mark.parametrize("as_of, who", [
    ("2005-03-01", "old"),     # inside old GM's window
    ("2009-05-29", "old"),     # its last trading day
    ("2015-01-02", "new"),     # new GM
    ("2010-11-18", "new"),     # new GM's first day
])
def test_b_a_ticker_that_CHANGED_HANDS_resolves_to_the_right_entity_for_the_right_DATE(client, armed, gm, as_of, who):
    with signed_in_as(PAID_MEMBER):
        body = client.get(RESOLVE, params={"q": "gm", "as_of": as_of}).json()
    assert body["status"] == "resolved", body
    assert body["entityId"] == gm[who], (
        f"GM as of {as_of} is {who} GM ({gm[who]}); the route answered {body['entityId']}")
    assert body["asOf"] == as_of


def test_b_a_date_IN_THE_GAP_resolves_to_NOTHING_not_the_nearest_owner(client, armed, gm):
    with signed_in_as(PAID_MEMBER):
        body = client.get(RESOLVE, params={"q": "GM", "as_of": "2010-01-04"}).json()
    assert body["status"] == "not_found"
    assert body["entityId"] is None and body["entity"] is None


def test_b_no_as_of_means_NOW_and_the_dated_history_rides_with_the_entity(client, armed, gm):
    with signed_in_as(PAID_MEMBER):
        now = client.get(RESOLVE, params={"q": "GM"}).json()
        then = client.get(RESOLVE, params={"q": "GM", "as_of": "2001-01-02"}).json()
    assert now["entityId"] == gm["new"] and now["asOf"] is None
    old_history = {(a["alias"], a["validFrom"], a["validTo"]) for a in then["aliases"]}
    assert ("GM", "1990-01-01", "2009-06-01") in old_history
    assert then["entity"]["lifecycleState"] == "delisted"


@pytest.mark.parametrize("bad", ["2021-02-30", "20210201", "yesterday", "2021-2-1"])
def test_b_a_malformed_as_of_is_REFUSED_never_defaulted_to_now(client, armed, gm, bad):
    with signed_in_as(PAID_MEMBER):
        r = client.get(RESOLVE, params={"q": "GM", "as_of": bad})
    assert r.status_code == 422, r.text


def test_b_an_AMBIGUOUS_alias_names_every_candidate_and_keys_to_no_one(client, armed, gm):
    """Seeded BELOW the write guard, the only way a collision can exist."""
    conn = em_store._conn()
    conn.execute(
        "INSERT INTO entity_aliases(entity_id, alias, valid_from, valid_to, source, created_at) "
        "VALUES (?,?,?,NULL,?,?)", (gm["rs"], "GAP", "2020-01-01", "test:direct", "2020-01-01T00:00:00Z"))
    conn.commit()
    em_store.rebuild_cache()
    with signed_in_as(PAID_MEMBER):
        body = client.get(RESOLVE, params={"q": "GAP"}).json()
    assert body["status"] == "ambiguous"
    assert body["entityId"] is None
    assert sorted(body["candidates"]) == sorted([gm["gap"], gm["rs"]])


# ── the lesson: a symbol universe does not settle a ticker match ────────────

@pytest.mark.parametrize("word", ["GAP", "RS", "gap", " rs "])
def test_real_tickers_that_are_ENGLISH_WORDS_resolve(client, armed, gm, word):
    with signed_in_as(PAID_MEMBER):
        body = client.get(RESOLVE, params={"q": word}).json()
    assert body["status"] == "resolved"
    assert body["entityId"] == gm[word.strip().lower()]


# ── (c) the adoption rail ───────────────────────────────────────────────────

def bare_ticker_rows(rows):
    """THE CHECKER. Every row whose ticker the store resolves -- at the row's
    own date (a delisted row is dated by the registry's window, a live row is
    "now") -- must carry THAT entity id. Returns the offending tickers.

    Rows that are not instruments (UCT breadth / indicator pseudo-tickers) have
    no entity by construction and are out of scope; a ticker the store does
    not know is honestly null and is not an offence."""
    bad = []
    for row in rows:
        if row.get("breadth") or row.get("indicator"):
            continue
        t = row["ticker"]
        as_of = None
        if row.get("delisted"):
            rec = delisted_registry.get(t)
            as_of = rec["first_date"] if rec else None
            if as_of is None:
                continue
        r = em_api.resolve(t, as_of=as_of)
        if r.status == "resolved" and row.get("entity_id") != r.entity.entity_id:
            bad.append(t)
    return bad


def test_c_CONTROL_the_checker_NAMES_a_bare_ticker_row(gm):
    rows = [
        {"ticker": "GM", "type": "stock", "entity_id": None},              # bare -- offence
        {"ticker": "GAP", "type": "stock", "entity_id": gm["gap"]},        # keyed -- fine
        {"ticker": "ZZZZ", "type": "stock", "entity_id": None},            # unknown -- honest null
        {"ticker": "UCTA50", "type": "breadth", "breadth": True, "entity_id": None},
    ]
    assert bare_ticker_rows(rows) == ["GM"]
    # ...and a row keyed to the WRONG entity is an offence too.
    assert bare_ticker_rows([{"ticker": "GM", "type": "stock", "entity_id": gm["old"]}]) == ["GM"]


@pytest.fixture
def search_fixture(monkeypatch, gm):
    """A built index whose snapshot predates the seed (GM carries no id -- the
    stale-snapshot case), plus one delisted registry row for old GM."""
    rows = [
        {"sym": "GM", "name": "General Motors", "name_lc": "general motors", "type": "stock",
         "exch": "NYSE", "entity_id": None},
        {"sym": "GME", "name": "GameStop", "name_lc": "gamestop", "type": "stock",
         "exch": "NYSE", "entity_id": None},
    ]
    monkeypatch.setattr(tsi, "_INDEX", rows)
    monkeypatch.setattr(tsi, "_BY_SYM", {r["sym"]: r for r in rows})
    old_gm = {"ticker": "GM-OLD", "provider_symbol": "GM", "name": "Motors Liquidation Co",
              "delisted_date": "2009-06-01", "first_date": "1990-01-01", "last_date": "2009-06-01"}
    monkeypatch.setattr(delisted_registry, "search", lambda q, limit=20: [dict(old_gm)])
    monkeypatch.setattr(delisted_registry, "get", lambda sym: dict(old_gm) if (sym or "").upper() == "GM-OLD" else None)
    monkeypatch.setattr(ts_router, "_enqueue_name_backfill", lambda t: None)
    return gm


def test_c_ARMED_ticker_search_rows_are_keyed_by_entity_including_the_DELISTED_one(client, armed, search_fixture):
    body = client.get(SEARCH, params={"q": "GM"}).json()
    rows = body["results"]
    assert {r["ticker"] for r in rows} >= {"GM", "GME", "GM-OLD"}
    assert bare_ticker_rows(rows) == []
    by = {r["ticker"]: r for r in rows}
    assert by["GM"]["entity_id"] == search_fixture["new"]
    assert by["GM-OLD"]["entity_id"] == search_fixture["old"], (
        "the delisted row names the DEAD company -- resolved at its own dated window")
    assert by["GME"]["entity_id"] is None and by["GME"]["entity_status"] == "not_found"


def test_c_ARMED_resolve_route_is_keyed_by_entity_for_every_ticker_the_store_holds(client, armed, gm):
    rows = []
    with signed_in_as(PAID_MEMBER):
        for q in ("GM", "GAP", "RS", "ZZZZ"):
            b = client.get(RESOLVE, params={"q": q}).json()
            rows.append({"ticker": q, "entity_id": b["entityId"]})
    assert bare_ticker_rows(rows) == []


# ── DARK: unset is byte-identical ───────────────────────────────────────────

@pytest.mark.parametrize("value", [None, "0", "", "false"])
@pytest.mark.parametrize("who", [None, FREE_MEMBER, PAID_MEMBER, ADMIN])
def test_dark_the_route_is_the_FASTAPI_404_to_EVERYONE_and_never_opens_the_store(
        client, monkeypatch, em_db, gm_absent, value, who):
    if value is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, value)
    if who is None:
        r = client.get(RESOLVE, params={"q": "GM"})
    else:
        with signed_in_as(who):
            r = client.get(RESOLVE, params={"q": "GM"})
    assert r.status_code == 404
    assert r.content == FASTAPI_404
    assert not os.path.exists(em_db), "the dark route opened (and so created) entity_master.db"


@pytest.fixture
def gm_absent():
    """Named so the dark test reads as 'no store exists' -- nothing is seeded."""
    return None


def test_dark_ticker_search_is_BYTE_IDENTICAL_to_the_route_WITHOUT_the_adoption_hook(
        client, monkeypatch, search_fixture, em_db):
    # The ARMED answer with the hook neutralised = what the route said before
    # TERM-023 existed.
    monkeypatch.setenv(FLAG, "1")
    monkeypatch.setattr(member_resolve, "attach_entity_ids", lambda rows: rows)
    before = client.get(SEARCH, params={"q": "GM"}).content

    # UNSET, with a hook that would blow up if it were ever reached, and the
    # store repointed at a path that does not exist, so opening it would
    # create it. (Repointed, not deleted: an open SQLite file cannot be
    # removed on Windows.)
    monkeypatch.delenv(FLAG, raising=False)

    def _boom(rows):
        raise AssertionError("the adoption hook ran with the flag unset")

    monkeypatch.setattr(member_resolve, "attach_entity_ids", _boom)
    fresh = os.path.join(os.path.dirname(em_db), "unset", "entity_master.db")
    monkeypatch.setattr(em_schema, "DB_PATH", fresh)
    _reset_em_caches()
    after = client.get(SEARCH, params={"q": "GM"})
    assert after.status_code == 200, after.text
    assert after.content == before
    assert not os.path.exists(fresh), "unset ticker search opened entity_master.db"


def test_dark_CONTROL_armed_ticker_search_DIFFERS_so_the_identity_above_is_not_vacuous(
        client, monkeypatch, search_fixture):
    monkeypatch.delenv(FLAG, raising=False)
    off = client.get(SEARCH, params={"q": "GM"}).json()
    monkeypatch.setenv(FLAG, "1")
    on = client.get(SEARCH, params={"q": "GM"}).json()
    assert off != on
    assert bare_ticker_rows(off["results"]), "unset rows are bare -- that is what arming changes"


# ── observability: the denominators and the member-path counts ──────────────

def test_obs_admin_status_publishes_DENOMINATORS_and_member_path_counts(client, armed, gm):
    with signed_in_as(PAID_MEMBER):
        client.get(RESOLVE, params={"q": "GM"})
        client.get(RESOLVE, params={"q": "ZZZZ"})
    with signed_in_as(ADMIN):
        body = client.get("/api/admin/entity-master/status").json()
    assert body["figi_coverage_denominator"] == body["entities"] == 4
    # Open aliases: GM (new), GAP, RS -- old GM's two are closed.
    assert body["ambiguous_count_denominator"] == 3
    mp = body["member_path"]
    assert mp["enabled"] is True
    assert mp["resolve"] == {"resolved": 1, "not_found": 1, "ambiguous": 0, "total": 2}
