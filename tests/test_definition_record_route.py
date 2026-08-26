"""`GET /api/scans/definition-record` — the E-6 record READ, which had no reader.

Measured 2026-08-25: `definition_record.claim_for` is imported by nothing under
`api/routers/`; the record was written nightly and read by tests only. This is
its door, and every rule below has a CONTROL.

⛔ THE RECORD KEYS ON THE PRODUCT LABEL (`1D`), the route takes the bars-store
CODE (`D`) the rest of the scan surface speaks — the map is `ledger._BARS_STORE_
TF_KEYS`, read, never retyped. ⛔ A claim proves a window only by CONTAINMENT in
ONE row per symbol, and the sweep writes ONE ROW PER CLOSED MONTH — so the
default window is the latest closed month's common window, derived from the
record itself, and a claim across months refuses in the record's own words.
"""
from __future__ import annotations

import ast as pyast
import dataclasses
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import definition_record as mod
from api.services import definition_record as dr
from api.services import entitlements as ent
from api.services import user_definitions as defs
from api.services.entitlements import limits_dependency
from api.services.signature import ledger

ROOT = Path(__file__).resolve().parents[1]

PAID = {"id": "paid1", "role": "member", "plan": "pro"}
DEF_ID = "u_0123456789ab"
REV = 1
AT = 1_700_100_000.0
TREE = {"type": "op", "name": ">", "args": [
    {"type": "series", "name": "close"},
    {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"}, {"type": "num", "value": 5}]}]}
DEF_HASH = defs.ast_hash(TREE)
ROW = {"def_id": DEF_ID, "version": 1, "rev": REV,
       "definition": {"compute": {"kind": "ast", "ast": TREE, "rev": REV, "fn": DEF_HASH}}}

#: One closed month, two symbols with the same window and a third listed
#: mid-month. ⛔ EVERY EXPECTED NUMBER BELOW IS SUMMED FROM THIS LIST.
JULY = [
    {"sym": "AAA", "first_bar_time": 20260701, "through_bar_time": 20260731,
     "bars_evaluated": 22, "bars_true": 9},
    {"sym": "BBB", "first_bar_time": 20260701, "through_bar_time": 20260731,
     "bars_evaluated": 22, "bars_true": 4},
]
LATE = {"sym": "CCC", "first_bar_time": 20260715, "through_bar_time": 20260731,
        "bars_evaluated": 12, "bars_true": 3}

#: Two more symbols listed the same day CCC was, so the default window has THREE
#: unproven names and a cap of two has something to bite on.
LATER = [{**LATE, "sym": s} for s in ("DDD", "EEE")]


@pytest.fixture
def store(tmp_path, monkeypatch):
    """The record's file, isolated — the same shape `tests/test_definition_record.py`
    uses: the record resolves through `ledger._DB_PATH` at call time."""
    p = tmp_path / "signal_ledger.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_INITED", False)
    monkeypatch.setattr(dr, "_INITED", set())
    return p


def _client(monkeypatch, user=PAID, *, row=ROW):
    #: ⛔ THE STORE ALWAYS SCOPES TO `PAID["id"]`, AND THERE IS NO KNOB TO MOVE IT.
    #: The first draft of this file gave `_client` an `owner=` parameter and wrote
    #: the "another member's def_id is a 404" case by flipping IT — which cannot
    #: fail: the stub refuses whatever id it is handed, so a route that hard-coded
    #: a member still 404s. The caller moves instead (see that test).
    def get(user_id, def_id, version=None):
        return (dict(row) if (row and def_id == row["def_id"]
                              and str(user_id) == PAID["id"]) else None)
    monkeypatch.setattr(defs, "get", get)
    app = FastAPI()
    app.include_router(mod.router)
    if user is not None:
        # ⚠️ overrides on the IDENTITY dependencies, never on `require_paid`
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def _get(client, **params):
    q = {"def_id": DEF_ID, "tf": "D"}
    q.update(params)
    return client.get("/api/scans/definition-record", params=q)


# ─── the gate, derived off the route table ───────────────────────────────────

def test_every_route_is_PAID_carries_the_ENTITLEMENT_and_the_set_is_derived():
    routes = [r for r in mod.router.routes if getattr(r, "methods", None)]
    assert routes, "the router mounts nothing — this file would pass vacuously"
    for route in routes:
        calls = [d.call for d in route.dependant.dependencies]
        assert mod.require_paid in calls, f"{route.path} is not gated by THIS module's require_paid"
        assert limits_dependency in calls, (
            f"{route.path} reads the definition record without the E-7 entitlement — "
            "tests/test_entitlements.py's census classifies it and requires this")


def test_an_anonymous_caller_is_refused(monkeypatch):
    r = _client(monkeypatch, user=None).get("/api/scans/definition-record",
                                            params={"def_id": DEF_ID})
    assert r.status_code in (401, 403), r.status_code


def test_a_free_member_gets_THIS_routers_402_sentence(monkeypatch):
    r = _get(_client(monkeypatch, user={"id": "free1", "role": "member", "plan": "free"}))
    assert r.status_code == 402
    assert r.json()["detail"] == "A definition's forward record requires a paid plan"


# ─── the claim ───────────────────────────────────────────────────────────────

def test_a_definition_with_NO_record_says_so_in_the_RECORDS_words(monkeypatch, store):
    r = _get(_client(monkeypatch))
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["def_hash"] == DEF_HASH and body["rev"] == REV
    assert body["tf"] == "D" and body["tf_label"] == "1D"
    assert body["window"] is None
    assert body["claim"]["refusal"] == dr.NO_RECORD_YET
    assert body["claim"]["hit_rate"] is None and body["claim"]["hits"] is None


def test_the_default_window_is_the_latest_closed_months_COMMON_window_and_the_claim_is_PROVEN(monkeypatch, store):
    out = dr.record_evaluations(DEF_HASH, REV, "1D", JULY, at=AT)
    assert out["written"] == len(JULY), out
    body = _get(_client(monkeypatch)).json()
    assert body["window"] == {"first": 20260701, "through": 20260731, "anchor": "AAA",
                              "symbols_at_through": 2, "symbols_known": 2, "derived": True}
    claim = body["claim"]
    assert claim["coverage"] == "proven" and claim["refusal"] is None
    assert claim["hits"] == sum(r["bars_true"] for r in JULY)
    assert claim["evaluated"] == sum(r["bars_evaluated"] for r in JULY)
    assert claim["hit_rate"] == pytest.approx(claim["hits"] / claim["evaluated"])
    assert claim["symbols"] == {"requested": 2, "proven": 2, "unproven": []}


def test_the_CONTROL_a_symbol_listed_mid_month_makes_the_claim_PARTIAL_and_is_NAMED(monkeypatch, store):
    dr.record_evaluations(DEF_HASH, REV, "1D", JULY + [LATE], at=AT)
    body = _get(_client(monkeypatch)).json()
    assert body["window"]["first"] == 20260701 and body["window"]["symbols_at_through"] == 3
    claim = body["claim"]
    assert claim["coverage"] == "partial"
    assert claim["refusal"] == dr.PARTIAL_RECORD
    assert claim["symbols"]["unproven"] == ["CCC"]
    assert claim["hits"] is None            # withheld, never summed over survivors


def test_an_explicit_window_overrides_the_derivation_and_a_backwards_one_refuses_in_the_records_words(monkeypatch, store):
    dr.record_evaluations(DEF_HASH, REV, "1D", JULY + [LATE], at=AT)
    body = _get(_client(monkeypatch), **{"from": "20260715", "to": "2026-07-31"}).json()
    assert body["window"] == {"first": 20260715, "through": 20260731, "anchor": None,
                              "symbols_at_through": None, "symbols_known": None, "derived": False}
    assert body["claim"]["coverage"] == "proven"
    assert body["claim"]["hits"] == sum(r["bars_true"] for r in JULY + [LATE])
    back = _get(_client(monkeypatch), **{"from": "20260731", "to": "20260701"}).json()
    assert back["claim"]["refusal"] == dr.REFUSALS["backwards"]
    half = _get(_client(monkeypatch), **{"from": "20260715"})
    assert half.status_code == 400 and "together" in half.json()["detail"]


def test_ANOTHER_MEMBER_asking_is_a_404_and_a_label_where_a_code_belongs_is_a_400(monkeypatch, store):
    """⛔ THE CALLER MOVES, NOT THE STORE — and that is the whole rail.

    The obvious spelling flips the fixture's owner so the store refuses; measured,
    it CANNOT FAIL: a route that hard-codes a member id (or drops `user["id"]`
    entirely) still gets `None` back and still 404s, because the stub was refusing
    everybody. Here the definition stays `paid1`'s and somebody else asks, so the
    404 can only come from the route scoping the lookup to the caller it was
    handed — and the CONTROL below proves the owner is still served.
    """
    stranger = {"id": "paid2", "role": "member", "plan": "pro"}
    assert _get(_client(monkeypatch, user=stranger)).status_code == 404
    assert _get(_client(monkeypatch)).status_code == 200      # CONTROL: the owner
    r = _get(_client(monkeypatch), tf="1D")
    assert r.status_code == 400 and "1D" in r.json()["detail"]


def test_a_definition_without_a_usable_rev_is_refused_the_record_is_keyed_on_it(monkeypatch, store):
    row = {**ROW, "definition": {"compute": {"kind": "ast", "ast": TREE}}}
    r = _get(_client(monkeypatch, row=row))
    assert r.status_code == 400 and "rev" in r.json()["detail"]


# ─── the entitlement, DRIVEN ─────────────────────────────────────────────────

def test_the_ROUTE_reaches_limits_dependency_WITHOUT_an_override(monkeypatch, store):
    """⛔ THE INJECTED-DEPENDENCY TRAP, NAMED AND CLOSED BEFORE THE NEXT TEST OPENS
    IT. `lesson_injected_dependency_hides_the_fetch`: the cap test below MUST
    override `limits_dependency` (one ungated toolkit ships, so a downgrade is
    unobservable otherwise), and an override is exactly how a feature ships green
    and unreachable. This one drives the REAL dependency, unfaked, and requires
    the real answer — the shipped toolkit is ungated, so nothing is withheld.
    """
    dr.record_evaluations(DEF_HASH, REV, "1D", JULY + [LATE] + LATER, at=AT)
    claim = _get(_client(monkeypatch)).json()["claim"]
    assert claim["symbols"]["unproven"] == ["CCC", "DDD", "EEE"]
    assert "unproven_withheld" not in claim["symbols"]
    assert "withheld_reason" not in claim["symbols"]


def test_the_named_UNPROVEN_symbols_are_CAPPED_by_the_toolkit_and_the_cap_is_DISCLOSED(
        monkeypatch, store):
    """⛔ THE ENTITLEMENT APPLIED, NOT MERELY LOOKED UP — the eight-features lesson.
    A route that took `limits` and never sliced with it would pass the census
    (which reads the dependency off `router.routes`) and withhold nothing, so the
    structural rail alone cannot see this. The UNGATED arm is the control: it
    proves the shorter list is the CAP and not the fixture.
    """
    dr.record_evaluations(DEF_HASH, REV, "1D", JULY + [LATE] + LATER, at=AT)
    cap = 2
    small = dataclasses.replace(ent.TOOLKITS[ent.DEFAULT_TOOLKIT],
                                toolkit="small", max_symbols=cap)

    def _for(limits):
        client = _client(monkeypatch)
        client.app.dependency_overrides[limits_dependency] = lambda: limits
        return _get(client).json()["claim"]["symbols"]

    ungated = _for(ent.TOOLKITS[ent.DEFAULT_TOOLKIT])
    capped = _for(small)

    assert len(ungated["unproven"]) == 3 > cap
    assert "unproven_withheld" not in ungated

    assert capped["unproven"] == ungated["unproven"][:cap]
    assert capped["unproven_withheld"] == len(ungated["unproven"]) - cap
    assert capped["withheld_reason"] == ent.SYMBOLS_WITHHELD
    # ⛔ AND THE COUNTS THE RECORD OWNS ARE UNTOUCHED. `requested` / `proven`
    # describe what the SWEEP evaluated, for everybody; a read-time cap that moved
    # them would claim the record holds less than it does.
    for key in ("requested", "proven"):
        assert capped[key] == ungated[key], key


# ─── the mount ───────────────────────────────────────────────────────────────

def _mounted() -> set:
    """Every `api.routers.X` reaching `include_router` in main.py — an AST, never
    a grep, and `api.main` is deliberately NOT imported (it builds caches under
    the shared data root; the conftest write guard fails the session for it)."""
    tree = pyast.parse((ROOT / "api" / "main.py").read_text(encoding="utf-8"))
    aliases = {}
    for n in pyast.walk(tree):
        if isinstance(n, pyast.ImportFrom) and n.module == "api.routers":
            for a in n.names:
                aliases[a.asname or a.name] = f"api.routers.{a.name}"
    out = set()
    for n in pyast.walk(tree):
        if (isinstance(n, pyast.Call) and isinstance(n.func, pyast.Attribute)
                and n.func.attr == "include_router" and n.args):
            a = n.args[0]
            if isinstance(a, pyast.Attribute) and isinstance(a.value, pyast.Name):
                out.add(aliases.get(a.value.id))
    return out


def test_the_router_is_mounted_in_main_and_the_probe_sees_a_neighbour():
    mounted = _mounted()
    assert "api.routers.definition_record" in mounted
    assert "api.routers.scan_results" in mounted      # CONTROL: the probe can see
