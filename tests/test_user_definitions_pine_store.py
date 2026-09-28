"""The definitions store takes a RUNTIME-LANE document (`compute.kind: 'pine'`)
behind its own flag — and every server-side reader of a stored definition says,
by name, why it cannot compute one.

⭐ THE GAP (2026-09-27). With `VITE_PINE_RUNTIME_LANE_ENABLED` on, a member's
Pine script the host lane refuses previews through the browser's runtime lane —
and "Add this script to my chart" was refused by `user_definitions.save`, which
took only `compute.kind == 'ast'`. A `pine` document stores the member's SOURCE
and the map from each plot key to a runtime output; the program is rebuilt in the
browser per chart. The server has no engine that can run it.

So this file holds three claims:

  1. THE FLAG. `PINE_RUNTIME_LANE_STORE_ENABLED`, default OFF, `== "1"` only, read
     per call. OFF is byte-identical to the store before this change: the same
     refusal sentence, nothing stored.
  2. THE SHAPE. ON, a `pine` document is validated server-side — the exact key
     set, the types, a source cap derived from the store's own row cap, and the
     handle `compute.fn` RE-DERIVED (FNV-1a over key-sorted JSON, mirrored from
     `app/src/components/chart/engine/pineRuntimeHandle.js` and held to one
     committed vector table from both sides).
  3. THE CONSUMERS. The scan sweep, the screener, the alert doors and relint each
     meet a stored `pine` row and REFUSE it by name
     (`user_definitions.RUNTIME_LANE_REASON`) — never a crash, never an empty
     answer read as a quiet market, never a fabricated number — and the sweep's
     `handed == swept + refused + duplicate + unswept` identity still closes.

⭐ THE ROUND TRIP IS THE STORE'S REAL ANSWER. `tests/fixtures/pine_store/
adx_round_trip.json` carries the document the member door builds (asserted by
`runtimeLaneStoreRoundTrip.test.jsx` against a fresh build) and the store's POST
and GET answers, which THIS file re-produces through the real router and compares
byte for byte. The vitest then mocks the backend with exactly those bodies.
Regenerate the response half only after a deliberate store change:

    PINE_STORE_WRITE_FIXTURE=1 python -m pytest tests/test_user_definitions_pine_store.py
"""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import alert_rev_migration as rev
from api.services import alert_user_series as aus
from api.services import indicator_alert_service as ias
from api.services import scan_definition
from api.services import user_definition_relint as relint
from api.services import user_definitions as svc
from api.services.screener import scan_evaluator

from tests.test_scan_evaluator import (  # noqa: F401  (fixtures by name)
    PRICE_TREE, SESSION, TF, _daily_bars, _definition, bars, clock,
)
from tests.test_scan_evaluator import store as scan_store_db  # noqa: F401

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "pine_store"
ROUND_TRIP = FIXTURES / "adx_round_trip.json"
VECTORS = FIXTURES / "handle_vectors.json"

FLAG = "PINE_RUNTIME_LANE_STORE_ENABLED"
USER = "member-1"
MINTED = "u_0123456789ab"
CREATED_AT = 1790000000

#: ⛔ THE SENTENCE THE STORE SPOKE BEFORE THIS CHANGE, TYPED — not imported. A
#: flag-off store must answer a `pine` document exactly as it always did, and a
#: sentence read off the module under test would move with it.
OLD_REFUSAL = ("definition: a user definition is a FORMULA — compute.kind must be "
               "'ast', got 'pine'")


def _fixture() -> dict:
    return json.loads(ROUND_TRIP.read_text(encoding="utf-8"))


def _doc() -> dict:
    """A fresh copy of the document the member door builds (the ADX script)."""
    return copy.deepcopy(_fixture()["request"]["definition"])


def _rehash(doc: dict) -> dict:
    """Recompute `compute.fn` after a deliberate edit, so a test isolates the ONE
    defect it plants rather than tripping the hash check first."""
    compute = {k: v for k, v in doc["compute"].items() if k != "fn"}
    doc["compute"]["fn"] = svc.runtime_lane_handle(compute)
    return doc


@pytest.fixture
def ud_store(tmp_path, monkeypatch):
    """The definitions store AND the alert DB a rev-bumping save migrates —
    `test_user_definitions.store`'s shape, for the same reason it gives."""
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    monkeypatch.delenv(FLAG, raising=False)
    return tmp_path


@pytest.fixture
def armed(ud_store, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    return ud_store


# ═══ 1. the flag ═════════════════════════════════════════════════════════════

@pytest.mark.parametrize("value", [None, "", "0", "true", "yes", "on", " 1", "1 ", "2"])
def test_flag_OFF_refuses_a_pine_document_with_the_UNCHANGED_sentence(ud_store, monkeypatch, value):
    """⛔ BYTE-IDENTICAL TO BEFORE: the same sentence, and nothing stored. Only
    the exact string "1" arms it — `"true"` and a padded `" 1"` are OFF."""
    if value is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, value)
    assert svc.runtime_lane_store_enabled() is False
    with pytest.raises(ValueError) as exc:
        svc.save(USER, "u_000000000001", _doc() | {"id": "u_000000000001"})
    assert str(exc.value) == OLD_REFUSAL
    assert svc.list_for_user(USER) == []


def test_the_flag_is_read_PER_CALL_not_at_import(ud_store, monkeypatch):
    doc = _doc() | {"id": "u_000000000001"}
    with pytest.raises(ValueError):
        svc.save(USER, "u_000000000001", doc)
    monkeypatch.setenv(FLAG, "1")
    out = svc.save(USER, "u_000000000001", doc)
    assert out["appended"] is True
    monkeypatch.setenv(FLAG, "0")
    with pytest.raises(ValueError) as exc:
        svc.save(USER, "u_000000000002", doc | {"id": "u_000000000002"})
    assert str(exc.value) == OLD_REFUSAL


def test_flag_ON_changes_nothing_for_an_AST_document(ud_store, monkeypatch):
    """The control: the same `ast` document saves to the same row either way."""
    ast_doc = _definition(PRICE_TREE, def_id="u_000000000001")
    off = svc.save(USER, "u_000000000001", copy.deepcopy(ast_doc))
    monkeypatch.setattr(svc, "_DB_PATH", str(ud_store / "second.db"))
    svc._init_db()
    monkeypatch.setenv(FLAG, "1")
    on = svc.save(USER, "u_000000000001", copy.deepcopy(ast_doc))
    for k in ("ast_hash", "rev", "repaint", "requirements", "version"):
        assert on[k] == off[k], k


def test_flag_ON_still_refuses_every_OTHER_non_ast_kind(armed):
    for kind in ("native", "server", "script", None):
        doc = _doc() | {"id": "u_000000000001"}
        doc["compute"] = {**doc["compute"], "kind": kind}
        with pytest.raises(ValueError) as exc:
            svc.save(USER, "u_000000000001", doc)
        assert str(exc.value) == ("definition: a user definition is a FORMULA — "
                                  f"compute.kind must be 'ast', got {kind!r}")


# ═══ 2. the shape ════════════════════════════════════════════════════════════

def test_the_member_doors_document_SAVES_and_its_row_names_the_runtime_lane(armed):
    out = svc.save(USER, "u_000000000001", _doc() | {"id": "u_000000000001"})
    doc = _doc()
    assert out["appended"] is True
    # ⭐ the row's identity IS the document's own handle, verified, not trusted
    assert out["ast_hash"] == doc["compute"]["fn"]
    assert out["ast_hash"].startswith("pine:")
    # the server cannot lint a program it cannot read: undecided, per plot
    assert out["repaint"] == {p["key"]: None for p in doc["plots"]}
    assert out["requirements"] == []
    row = svc.get(USER, "u_000000000001")
    assert row["definition"]["compute"] == doc["compute"]


def _mutations():
    """(name, edit, fragment the refusal must contain). Every edit is REHASHED
    unless it is the hash itself, so each case isolates one defect."""
    big = "x" * (svc.MAX_PINE_SOURCE_BYTES + 1)

    def c(fn):
        def edit(doc):
            fn(doc["compute"])
            return doc
        return edit

    return [
        ("source missing", c(lambda k: k.pop("source")), "compute.source"),
        ("source blank", c(lambda k: k.update(source="   ")), "compute.source"),
        ("source not text", c(lambda k: k.update(source=["plot(close)"])), "compute.source"),
        ("source over the cap", c(lambda k: k.update(source=big)), "compute.source"),
        ("an unknown compute key", c(lambda k: k.update(ast={"type": "num", "value": 0})), "compute.ast"),
        ("lane missing", c(lambda k: k.pop("lane")), "compute.lane"),
        ("lane option not a bool", c(lambda k: k["lane"].update(plotColours=1)), "compute.lane"),
        ("lane with an extra key", c(lambda k: k["lane"].update(extra=True)), "compute.lane"),
        ("columns empty", c(lambda k: k.update(columns={})), "compute.columns"),
        ("column output a bool", c(lambda k: k["columns"]["value"].update(output=True)), "compute.columns.value"),
        ("column output negative", c(lambda k: k["columns"]["value"].update(output=-1)), "compute.columns.value"),
        ("column output a float", c(lambda k: k["columns"]["value"].update(output=1.5)), "compute.columns.value"),
        ("column call blank", c(lambda k: k["columns"]["value"].update(call="")), "compute.columns.value"),
        ("column line text", c(lambda k: k["columns"]["value"].update(line="29")), "compute.columns.value.line"),
        ("column shift negative", c(lambda k: k["columns"]["value"].update(shift=-1)), "compute.columns.value.shift"),
        ("column unknown key", c(lambda k: k["columns"]["value"].update(colour=1)), "compute.columns.value"),
        ("column names no plot", c(lambda k: k["columns"].update(ghost={"output": 9, "call": "plot"})), "compute.columns.ghost"),
        ("a plot with no column", c(lambda k: k["columns"].pop("out3")), "out3"),
        ("input names no declared input", c(lambda k: k["inputs"].update(pine_zz="zz")), "compute.inputs.pine_zz"),
        ("input Pine name blank", c(lambda k: k["inputs"].update(pine_len="")), "compute.inputs.pine_len"),
        ("rev a bool", c(lambda k: k.update(rev=True)), "compute.rev"),
        ("rev negative", c(lambda k: k.update(rev=-1)), "compute.rev"),
    ]


@pytest.mark.parametrize("name,edit,fragment", _mutations(), ids=[m[0] for m in _mutations()])
def test_a_malformed_pine_document_is_REFUSED_BY_NAME(armed, name, edit, fragment):
    """Each defect is REHASHED where the handle can be taken at all, so the
    refusal is the SHAPE check's and not the hash check's."""
    doc = edit(_doc())
    try:
        _rehash(doc)
    except ValueError:
        pass                      # a number the handle refuses to format — see its own rail
    doc["id"] = "u_000000000001"
    with pytest.raises(ValueError) as exc:
        svc.save(USER, "u_000000000001", doc)
    assert fragment in str(exc.value), (name, str(exc.value))
    assert svc.list_for_user(USER) == []


@pytest.mark.parametrize("fn", ["pine:00000000", "sha256:" + "0" * 64, "", None, 7])
def test_a_handle_that_disagrees_with_the_document_is_REFUSED(armed, fn):
    doc = _doc() | {"id": "u_000000000001"}
    doc["compute"]["fn"] = fn
    with pytest.raises(ValueError) as exc:
        svc.save(USER, "u_000000000001", doc)
    assert "compute.fn" in str(exc.value)


def test_an_edit_to_the_SCRIPT_without_a_new_handle_is_REFUSED(armed):
    """⛔ THE HANDLE IS RE-DERIVED, NEVER TRUSTED: the same `fn` over a changed
    script would file one program under another's name."""
    doc = _doc() | {"id": "u_000000000001"}
    doc["compute"]["source"] += "\n// an edit"
    with pytest.raises(ValueError) as exc:
        svc.save(USER, "u_000000000001", doc)
    assert "compute.fn" in str(exc.value)
    _rehash(doc)
    assert svc.save(USER, "u_000000000001", doc)["appended"] is True


def test_the_source_cap_is_the_stores_own_row_cap():
    assert svc.MAX_PINE_SOURCE_BYTES == svc.MAX_DEFINITION_BYTES


# ═══ 3. the handle — one table, both lanes ══════════════════════════════════

def test_the_handle_matches_EVERY_committed_vector():
    vectors = json.loads(VECTORS.read_text(encoding="utf-8"))["vectors"]
    assert len(vectors) >= 6
    assert len({v["handle"] for v in vectors}) >= 5
    for v in vectors:
        assert svc.runtime_lane_handle(v["compute"]) == v["handle"], v["name"]


def test_a_document_READ_BACK_with_sorted_keys_re_saves_as_the_same_row(armed):
    """⭐ THE REASON THE HANDLE IS KEY-SORTED. The blob is stored `sort_keys=True`,
    so `get()` hands back `columns` as `out2, out3, value` and each spec as
    `call, line, output`. Re-saving that read-back (the edit door's
    read-modify-write) must be the same document, not a hash mismatch."""
    svc.save(USER, "u_000000000001", _doc() | {"id": "u_000000000001"})
    back = svc.get(USER, "u_000000000001")["definition"]
    assert list(back["compute"]["columns"]) == sorted(back["compute"]["columns"])
    again = svc.save(USER, "u_000000000001", back)
    assert again["appended"] is False            # byte-identical, nothing appended
    assert again["ast_hash"] == _doc()["compute"]["fn"]


# ═══ 4. requirements — derived from the manifest, over the SOURCE ════════════

def test_requirement_tags_read_the_pine_source_for_the_manifests_own_names(armed):
    doc = _doc() | {"id": "u_000000000001"}
    doc["compute"]["source"] += "\ncumulative = ta.cum(volume)\n"
    _rehash(doc)
    assert svc.requirement_tags(doc) == ["window_dependent"]
    assert svc.requirement_tags(_doc()) == []             # the control
    first = _doc()
    first["compute"]["source"] += "\nstart = barstate.isfirst\n"
    assert svc.requirement_tags(_rehash(first)) == ["window_dependent"]


def test_requirement_tags_FAIL_CLOSED_on_a_pine_document_with_no_readable_source():
    doc = _doc()
    doc["compute"]["source"] = None
    assert svc.requirement_tags(doc) == svc._all_declared_tags()
    assert svc._all_declared_tags(), "the manifest declares no tag — this case is vacuous"


# ═══ 5. the router — the store's real answer IS the fixture ════════════════

def _client(monkeypatch, *, plan="pro"):
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "admin", "plan": plan}
    monkeypatch.setattr(svc, "new_def_id", lambda: MINTED)
    return TestClient(app)


def _pin_volatile(body):
    """`created_at` is the clock; everything else in the answer is the store's."""
    body = copy.deepcopy(body)
    rows = body.get("definitions") if isinstance(body, dict) and "definitions" in body else None
    for row in (rows or []):
        assert isinstance(row.get("created_at"), int)
        row["created_at"] = CREATED_AT
    return body


def test_POST_then_GET_answer_EXACTLY_what_the_client_fixture_carries(armed, monkeypatch):
    client = _client(monkeypatch)
    fx = _fixture()
    created = client.post("/api/user-definitions", json=fx["request"])
    assert created.status_code == 200, created.text
    listed = client.get("/api/user-definitions?graph=1")
    assert listed.status_code == 200, listed.text
    got_create, got_list = created.json(), _pin_volatile(listed.json())

    if os.environ.get("PINE_STORE_WRITE_FIXTURE") == "1":
        fx["createResponse"] = got_create
        fx["listResponse"] = got_list
        ROUND_TRIP.write_text(json.dumps(fx, indent=2, ensure_ascii=False) + "\n",
                              encoding="utf-8", newline="\n")

    assert got_create == fx["createResponse"]
    assert got_list == fx["listResponse"]
    # and what the fixture says is what this file claims about the store
    row = got_list["definitions"][0]
    assert row["def_id"] == MINTED and got_create["def_id"] == MINTED
    assert row["ast_hash"] == fx["request"]["definition"]["compute"]["fn"]
    assert row["scannable"] is False
    assert row["scan_refusal"]["gate"] == "kind"
    assert svc.RUNTIME_LANE_REASON in row["scan_refusal"]["detail"]


def test_the_router_with_the_flag_OFF_answers_400_with_the_unchanged_sentence(ud_store, monkeypatch):
    client = _client(monkeypatch)
    res = client.post("/api/user-definitions", json=_fixture()["request"])
    assert res.status_code == 400
    assert res.json()["detail"] == OLD_REFUSAL
    assert client.get("/api/user-definitions").json() == {"definitions": []}


# ═══ 6. the consumers — each refuses a stored `pine` row BY NAME ═════════════

def _stored_pine(monkeypatch, def_id="u_000000000001"):
    monkeypatch.setenv(FLAG, "1")
    svc.save(USER, def_id, _doc() | {"id": def_id})
    return svc.get(USER, def_id)


def test_the_screen_door_refuses_it_with_the_named_reason():
    with pytest.raises(scan_definition.ScanRefused) as exc:
        scan_definition.assert_scannable(_doc())
    assert exc.value.gate == "kind"
    assert svc.RUNTIME_LANE_REASON in exc.value.detail
    # the control: an ast screen still passes the same door
    scan_definition.assert_scannable(_definition(PRICE_TREE))


def test_the_nightly_sweep_REFUSES_it_BY_NAME_and_its_arithmetic_CLOSES(
        ud_store, scan_store_db, bars, clock, monkeypatch):
    """⛔ NOT SILENTLY SKIPPED. `definitions_to_sweep` used to drop every
    non-`ast` row at the door, so a stored runtime document was absent from the
    receipt — a member's saved script and a store with nothing in it read the
    same. It is now handed to the sweep and refused under `gate:kind` with
    `RUNTIME_LANE_REASON`, counted in `refused`, and
    `definitions == swept + refused + duplicate + unswept` still holds."""
    _stored_pine(monkeypatch)
    svc.save(USER, "u_000000000002", _definition(PRICE_TREE, def_id="u_000000000002"))
    handed = scan_evaluator.definitions_to_sweep()
    kinds = sorted(d["compute"]["kind"] for d in handed)
    assert kinds == ["ast", "pine"]

    bars["A"] = _daily_bars()
    out = scan_evaluator.run_sweep(handed, TF, universe=["A"], as_of=SESSION)
    assert out["definitions"] == 2
    assert out["swept"] == 1 and out["refused"] == 1
    assert (out["swept"] + out["refused"] + out["duplicate"] + out["unswept"]
            == out["definitions"])
    named = [r for r in out["refusals"] if svc.RUNTIME_LANE_REASON in r["detail"]]
    assert len(named) == 1 and named[0]["gate"] == "kind"


def test_the_LIVE_cycle_refuses_it_the_same_way(ud_store, scan_store_db, bars, clock, monkeypatch):
    """The live cycle shares `_resolve_entries` with the nightly sweep — one
    answer to "is this scannable", asserted from the live side too."""
    _stored_pine(monkeypatch)
    entries, refused, duplicate, refusals = scan_evaluator._resolve_entries(
        scan_evaluator.definitions_to_sweep())
    assert entries == [] and refused == 1 and duplicate == 0
    assert svc.RUNTIME_LANE_REASON in refusals[0]["detail"]


def test_the_alert_lane_door_refuses_it_by_name(ud_store, monkeypatch):
    row = _stored_pine(monkeypatch)
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._gate_lane(row)
    assert exc.value.gate == "lane"
    assert svc.RUNTIME_LANE_REASON in str(exc.value)


def test_the_alert_catalog_does_not_offer_it_and_the_refusal_list_says_why(ud_store, monkeypatch):
    _stored_pine(monkeypatch)
    assert aus.user_catalog(USER) == []
    refused = ias.user_definition_refusals(USER)
    assert [r["id"] for r in refused] == ["u_000000000001"]
    assert refused[0]["gate"] == "lane"
    assert svc.RUNTIME_LANE_REASON in refused[0]["messages"][0]


def test_arming_an_alert_on_it_is_refused_by_name(ud_store, monkeypatch):
    _stored_pine(monkeypatch)
    with pytest.raises(aus.AdmissionRefused) as exc:
        # `bars=[]`: the lane door refuses before any bar is read, and a test
        # that fetched would be proving the fetch, not the door
        aus.arm_for_alert(USER, "u_000000000001.value", "SPY", "D", bars=[])
    # ⭐ and sizing a fetch for it asks for no history it cannot use
    assert aus.lookback_for_alert({"indicator": "u_000000000001.value",
                                   "user_id": USER}) is None
    assert exc.value.gate == "lane"
    assert svc.RUNTIME_LANE_REASON in str(exc.value)


def test_relint_REPORTS_it_once_and_NEVER_writes_to_it(ud_store, monkeypatch):
    row = _stored_pine(monkeypatch)
    findings = relint.compare_row(row)
    assert len(findings) == 1
    assert findings[0]["verdict"] == relint.UNCOMPARABLE
    assert svc.RUNTIME_LANE_REASON in findings[0]["note"]
    before = svc.get(USER, "u_000000000001")
    relint.relint(heal=True)
    after = svc.get(USER, "u_000000000001")
    assert after["repaint"] == before["repaint"]
    assert after["definition"] == before["definition"]
    assert relint.heal_log(USER, "u_000000000001") == []
