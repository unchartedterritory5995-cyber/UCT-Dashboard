"""TERM-088 (item 15 ACC-02) -- the decision record gets a member surface.

THE STORE (verified, not assumed): `wire_universe` x `wire_issues` in the
engine's `uct_intelligence.db`, written by the Morning Wire engine. One row per
(issue, ticker) the wire CONSIDERED, with `dropped_at_stage` (NULL = passed
every stage) and `drop_reason`. The pod reads the Brain Pack's copy at
`<brain_dir>/data/uct_intelligence.db` -- the same path, and the same
`?mode=ro` open, as the admin Wisdom replay (`api/services/wisdom/evals/replay.py`).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR (backlog §5 acceptance a-d)
-----------------------------------------------------------------------
(a) A paid member reaches the route; FREE is 402, anonymous 401 -- and the
    gate is proved off the SERVED app's dependency tree by object identity.
(b) A ticker with a recorded rejection renders its stage; a ticker with no row
    answers `not_considered` -- and a store that could NOT be read answers
    `unavailable`, NEVER `not_considered` (a layer that could not be read is
    not a layer that is empty).
(c) The record's own coverage is DERIVED off the rows (issues held, span,
    weekdays in span) -- a fixture with different rows gives different numbers.
(d) No write reaches the engine store: the connection is opened `mode=ro` by
    URI, a write through it is refused by SQLite, and the file's bytes are
    unchanged after a request.
DARK: `DECISION_RECORD_MEMBER_ENABLED` unset/"0"/"false" -> the literal FastAPI
404 to every caller, admin included, and the engine DB is never opened.

Every store here is a tmp file; nothing sends a network request; nothing
depends on whether `app/dist` is built (the route is mounted ahead of the SPA
catch-all and the 404 compared against is the literal FastAPI body).
"""
from __future__ import annotations

import hashlib
import os
import sqlite3
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import (  # noqa: E402
    get_current_user as _get_current_user,
    get_current_user_with_plan as _get_current_user_with_plan,
)
from api.routers import decision_record as rt  # noqa: E402
from api.services import decision_record as svc  # noqa: E402
from tests.authclients import ADMIN, FREE_MEMBER, PAID_MEMBER, signed_in_as  # noqa: E402

FLAG = "DECISION_RECORD_MEMBER_ENABLED"
ROUTE = "/api/decision-record/ticker/{ticker}"
FASTAPI_404 = b'{"detail":"Not Found"}'


def url(t):
    return f"/api/decision-record/ticker/{t}"


# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    from api.main import app as real_app
    return real_app


@pytest.fixture
def client(app):
    yield TestClient(app, raise_server_exceptions=False)
    for dep in (_get_current_user, _get_current_user_with_plan):
        app.dependency_overrides.pop(dep, None)


@pytest.fixture
def armed(monkeypatch):
    monkeypatch.setenv(FLAG, "1")


# Three issues, 2026-09-21 (Mon) .. 2026-09-25 (Fri): 5 weekdays in the span,
# 3 issues held -- so the record is visibly NOT every session.
ISSUES = [("2026-09-21", "2026-09-21 11:35:00"), ("2026-09-23", "2026-09-23 11:36:00"),
          ("2026-09-25", "2026-09-25 11:34:00")]
UNIVERSE = [
    # issue, ticker, dropped_at_stage, drop_reason, is_exploration
    ("2026-09-21", "AMD", 2, "failed gate: rs_rank below floor", 0),
    ("2026-09-21", "NVDA", None, None, 0),
    ("2026-09-23", "AMD", 2, "failed gate: extended from 10ema", 0),
    ("2026-09-23", "NVDA", None, None, 0),
    ("2026-09-25", "AMD", None, None, 1),
    ("2026-09-25", "GAP", 3, "lens: no setup", 0),
]


def _build(path, issues=ISSUES, universe=UNIVERSE, *, with_tables=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path)
    if with_tables:
        con.execute("CREATE TABLE wire_issues (issue_id TEXT PRIMARY KEY, sent_at TEXT, regime_classification TEXT)")
        con.execute("CREATE TABLE wire_universe (issue_id TEXT, ticker TEXT, sources TEXT, feature_vector TEXT,"
                    " dropped_at_stage INTEGER, drop_reason TEXT, is_exploration INTEGER, created_at TEXT)")
        con.executemany("INSERT INTO wire_issues VALUES (?,?,NULL)", issues)
        con.executemany(
            "INSERT INTO wire_universe VALUES (?,?,'[]','{}',?,?,?,?)",
            [(i, t, s, r, x, f"{i} 11:00:00") for (i, t, s, r, x) in universe])
    else:
        con.execute("CREATE TABLE unrelated (x INTEGER)")
    con.commit()
    con.close()
    return path


@pytest.fixture
def engine_db(tmp_path, monkeypatch):
    """The Brain Pack layout: <brain_dir>/data/uct_intelligence.db."""
    brain = tmp_path / "brain"
    monkeypatch.setenv("BRAIN_DIR", str(brain))
    path = str(brain / "data" / "uct_intelligence.db")
    return _build(path)


def _sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


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


def test_a_the_route_is_SERVED_and_carries_THIS_routers_require_paid(app):
    route = _route(app, ROUTE)
    calls = _calls(route.dependant)
    assert rt.require_paid in calls, "the member route must carry require_paid (object identity)"
    assert _get_current_user in calls, "require_paid must stand on the session dependency"
    # The dark switch runs FIRST: unarmed is a 404 before any identity is read.
    assert route.dependant.dependencies[0].call is rt._armed


def test_a_CONTROL_the_walk_can_say_a_gate_is_MISSING(app):
    """`/api/ticker-search` is anonymous by design -- a walk that found
    require_paid everywhere would pass the test above for the wrong reason."""
    assert rt.require_paid not in _calls(_route(app, "/api/ticker-search").dependant)


def test_a_armed_PAID_200_FREE_402_ANONYMOUS_401(client, armed, engine_db):
    with signed_in_as(PAID_MEMBER):
        assert client.get(url("AMD")).status_code == 200
    with signed_in_as(FREE_MEMBER):
        r = client.get(url("AMD"))
        assert r.status_code == 402, r.text
        assert "decision record" in r.json()["detail"].lower()
    assert client.get(url("AMD")).status_code == 401


# ── (b) stage for a rejection; "not considered" for no row ──────────────────

def test_b_a_RECORDED_rejection_carries_its_stage_its_reason_and_its_issue(client, armed, engine_db):
    with signed_in_as(PAID_MEMBER):
        body = client.get(url("amd")).json()
    assert body["status"] == "considered"
    assert body["ticker"] == "AMD"
    by_issue = {r["issue_id"]: r for r in body["rows"]}
    assert by_issue["2026-09-23"]["dropped_at_stage"] == 2
    assert by_issue["2026-09-23"]["stage_label"] == "gate"
    assert by_issue["2026-09-23"]["drop_reason"] == "failed gate: extended from 10ema"
    assert by_issue["2026-09-23"]["outcome"] == "dropped"
    assert by_issue["2026-09-23"]["sent_at"] == "2026-09-23 11:36:00"
    assert by_issue["2026-09-25"]["outcome"] == "passed"
    assert by_issue["2026-09-25"]["dropped_at_stage"] is None
    assert by_issue["2026-09-25"]["is_exploration"] is True
    # newest issue first
    assert [r["issue_id"] for r in body["rows"]] == ["2026-09-25", "2026-09-23", "2026-09-21"]


def test_b_the_rejections_are_SHOWN_beside_the_passes_never_filtered_to_picks(client, armed, engine_db):
    """Item 15: '19,611 rejections beside the picks is the point' -- a surface
    that shows only the picks has built the opposite feature."""
    with signed_in_as(PAID_MEMBER):
        body = client.get(url("AMD")).json()
    outcomes = sorted(r["outcome"] for r in body["rows"])
    assert outcomes == ["dropped", "dropped", "passed"]
    assert body["counts"] == {"rows": 3, "issues_considered": 3, "issues_passed": 1,
                              "issues_dropped": 2, "by_stage": {"2": 2}}


def test_b_a_ticker_with_NO_row_is_NOT_CONSIDERED(client, armed, engine_db):
    with signed_in_as(PAID_MEMBER):
        body = client.get(url("ZZZZ")).json()
    assert body["status"] == "not_considered"
    assert body["rows"] == []
    # The coverage still rides the answer: "not considered IN WHAT" is part of it.
    assert body["coverage"]["issues_held"] == 3


def test_b_a_store_that_could_NOT_be_read_is_UNAVAILABLE_never_not_considered(client, armed, tmp_path, monkeypatch):
    monkeypatch.setenv("BRAIN_DIR", str(tmp_path / "no-pack-here"))
    with signed_in_as(PAID_MEMBER):
        body = client.get(url("AMD")).json()
    assert body["status"] == "unavailable"
    assert body["status"] != "not_considered"
    assert body["reason"] == "source_file_missing"
    assert body["rows"] == [] and body["coverage"] is None and body["counts"] is None


def test_b_a_pack_WITHOUT_the_tables_is_UNAVAILABLE_not_empty(client, armed, tmp_path, monkeypatch):
    brain = tmp_path / "brain"
    monkeypatch.setenv("BRAIN_DIR", str(brain))
    _build(str(brain / "data" / "uct_intelligence.db"), with_tables=False)
    with signed_in_as(PAID_MEMBER):
        body = client.get(url("AMD")).json()
    assert body["status"] == "unavailable"
    assert body["reason"] == "table_missing:wire_universe"


def test_b_a_readable_but_EMPTY_record_says_so_and_is_not_not_considered(client, armed, tmp_path, monkeypatch):
    brain = tmp_path / "brain"
    monkeypatch.setenv("BRAIN_DIR", str(brain))
    _build(str(brain / "data" / "uct_intelligence.db"), issues=[], universe=[])
    with signed_in_as(PAID_MEMBER):
        body = client.get(url("AMD")).json()
    assert body["status"] == "empty_record"
    assert body["coverage"]["issues_held"] == 0


def test_b_a_symbol_universe_does_not_settle_a_ticker_match(client, armed, engine_db):
    """GAP is a real ticker. Nothing filters the query through a word list."""
    with signed_in_as(PAID_MEMBER):
        body = client.get(url("GAP")).json()
    assert body["status"] == "considered"
    assert body["rows"][0]["dropped_at_stage"] == 3
    assert body["rows"][0]["stage_label"] == "lens"


def test_b_an_unknown_stage_is_rendered_as_its_number_never_a_guessed_label(tmp_path):
    path = _build(str(tmp_path / "e.db"), universe=[("2026-09-21", "AMD", 7, "new stage", 0)])
    body = svc.ticker_record("AMD", path=path)
    assert body["rows"][0]["dropped_at_stage"] == 7
    assert body["rows"][0]["stage_label"] is None


# ── (c) the record's own coverage, DERIVED ──────────────────────────────────

def test_c_coverage_is_derived_from_the_rows(client, armed, engine_db):
    with signed_in_as(PAID_MEMBER):
        cov = client.get(url("AMD")).json()["coverage"]
    assert cov == {"issues_held": 3, "first_issue": "2026-09-21", "last_issue": "2026-09-25",
                   "span_days": 5, "weekdays_in_span": 5, "span_months": 0}


def test_c_MOVING_the_source_moves_the_numbers(tmp_path):
    """A typed count would stay put; a derived one follows the rows."""
    more = ISSUES + [("2026-10-30", "2026-10-30 11:30:00")]
    rows = UNIVERSE + [("2026-10-30", "AMD", 2, "failed gate", 0)]
    path = _build(str(tmp_path / "e.db"), issues=more, universe=rows)
    body = svc.ticker_record("AMD", path=path)
    assert body["coverage"]["issues_held"] == 4
    assert body["coverage"]["last_issue"] == "2026-10-30"
    assert body["coverage"]["weekdays_in_span"] == 30
    assert body["coverage"]["span_months"] == 1
    assert body["counts"]["issues_dropped"] == 3


def test_c_paging_is_bounded_and_says_how_many_rows_exist(client, armed, engine_db):
    with signed_in_as(PAID_MEMBER):
        body = client.get(url("AMD"), params={"limit": 1, "offset": 1}).json()
    assert [r["issue_id"] for r in body["rows"]] == ["2026-09-23"]
    assert body["paging"] == {"limit": 1, "offset": 1, "total_rows": 3}
    with signed_in_as(PAID_MEMBER):
        assert client.get(url("AMD"), params={"limit": 101}).status_code == 422


def test_c_the_source_and_its_as_of_ride_every_answer(client, armed, engine_db):
    with signed_in_as(PAID_MEMBER):
        src = client.get(url("AMD")).json()["source"]
    assert src["store"] == "uct_intelligence.db"
    assert src["tables"] == ["wire_universe", "wire_issues"]
    assert "pack_installed_at" in src


# ── (d) no write reaches the engine store ───────────────────────────────────

def test_d_the_connection_is_opened_READ_ONLY_by_uri(monkeypatch, tmp_path):
    path = _build(str(tmp_path / "e.db"))
    seen = []
    real = sqlite3.connect

    def spy(target, *a, **kw):
        seen.append((str(target), kw.get("uri")))
        return real(target, *a, **kw)

    monkeypatch.setattr(svc.sqlite3, "connect", spy)
    svc.ticker_record("AMD", path=path)
    assert seen, "the service opened nothing -- this rail would pass over an empty set"
    for target, uri in seen:
        assert uri is True and target.startswith("file:") and target.endswith("?mode=ro"), (target, uri)


def test_d_a_write_through_the_services_connection_is_REFUSED(tmp_path):
    path = _build(str(tmp_path / "e.db"))
    con = svc._open_ro(path)
    try:
        with pytest.raises(sqlite3.OperationalError):
            con.execute("DELETE FROM wire_universe")
    finally:
        con.close()


def test_d_a_request_leaves_the_engine_store_byte_identical(client, armed, engine_db):
    before = _sha(engine_db)
    with signed_in_as(PAID_MEMBER):
        for t in ("AMD", "ZZZZ", "GAP"):
            assert client.get(url(t)).status_code == 200
    assert _sha(engine_db) == before


# ── DARK ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("value", [None, "0", "", "false"])
@pytest.mark.parametrize("who", [None, FREE_MEMBER, PAID_MEMBER, ADMIN])
def test_dark_the_route_is_the_FASTAPI_404_to_EVERYONE_and_never_opens_the_store(
        client, monkeypatch, engine_db, value, who):
    if value is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, value)
    opened = []
    monkeypatch.setattr(svc, "_open_ro", lambda p: opened.append(p) or (_ for _ in ()).throw(AssertionError("opened")))
    if who is None:
        r = client.get(url("AMD"))
    else:
        with signed_in_as(who):
            r = client.get(url("AMD"))
    assert r.status_code == 404
    assert r.content == FASTAPI_404
    assert opened == []


def test_dark_CONTROL_armed_the_same_request_is_NOT_a_404(client, armed, engine_db):
    with signed_in_as(PAID_MEMBER):
        assert client.get(url("AMD")).status_code == 200


# ── the auth payload flag (the Research tab's switch) ───────────────────────

@pytest.fixture
def access_payload():
    from api.routers import auth
    return auth._access_payload


@pytest.mark.parametrize("raw,expected", [
    (None, False), ("0", False), ("", False), ("false", False), ("banana", False),
    ("1", True), ("true", True), (" on ", True),
])
def test_the_auth_payload_carries_the_flag_read_per_request(access_payload, monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, raw)
    member = {"id": "u1", "email": "m@example.com", "role": "member"}
    assert access_payload(member, "free")["decision_record_enabled"] is expected


def test_the_payload_and_the_route_read_ONE_authority(monkeypatch):
    """Flip the service's reader; the payload must follow -- two env reads of
    one name would drift."""
    from api.routers import auth
    monkeypatch.delenv(FLAG, raising=False)
    monkeypatch.setattr(svc, "is_enabled", lambda: True)
    member = {"id": "u1", "email": "m@example.com", "role": "member"}
    assert auth._access_payload(member, "free")["decision_record_enabled"] is True


# ── TERM-023: a name resolves to an ENTITY at the row's own date ───────────

def test_entity_dark_rows_carry_no_entity_and_say_so(tmp_path, monkeypatch):
    monkeypatch.delenv("ENTITY_MASTER_MEMBER_ENABLED", raising=False)
    path = _build(str(tmp_path / "e.db"))
    body = svc.ticker_record("AMD", path=path)
    assert body["entity"] == {"enabled": False, "distinct_entities": None}
    assert all("entity_id" not in r for r in body["rows"])


def test_entity_armed_each_row_resolves_AT_ITS_ISSUE_DATE(tmp_path, monkeypatch):
    from api.services.entity_master import api as em_api
    monkeypatch.setenv("ENTITY_MASTER_MEMBER_ENABLED", "1")
    asked = []

    class _E:
        def __init__(self, eid):
            self.entity_id = eid

    class _R:
        def __init__(self, eid):
            self.status, self.entity = ("resolved", _E(eid)) if eid else ("not_found", None)

    def fake_resolve(alias, as_of=None):
        asked.append((alias, as_of))
        return _R("e_old" if as_of < "2026-09-24" else "e_new")

    monkeypatch.setattr(em_api, "resolve", fake_resolve)
    path = _build(str(tmp_path / "e.db"))
    body = svc.ticker_record("AMD", path=path)
    assert sorted(asked) == [("AMD", "2026-09-21"), ("AMD", "2026-09-23"), ("AMD", "2026-09-25")]
    assert {r["issue_id"]: r["entity_id"] for r in body["rows"]} == {
        "2026-09-25": "e_new", "2026-09-23": "e_old", "2026-09-21": "e_old"}
    assert body["entity"] == {"enabled": True, "distinct_entities": 2}
