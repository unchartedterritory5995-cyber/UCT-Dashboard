"""P0 TRUTH CORPUS — slice "save" (Phase 0P: the server is the save authority).

Every case states ASKED / CLAIMED / DID and classifies the expected outcome.
The "before" behaviour of each case was measured on base `a92b96de2` by running
this file against the unpatched service; it is recorded in each docstring
(`BEFORE:`) and in `scratchpad/P0-save-report.md`.

The browser's save rule (`FormulaField.canSaveFormula`, BuilderSheet) is:
  * `repaints`          -> Save disabled (refused);
  * `preview-repaints`  -> Save only with the author's per-row acknowledgement;
  * budget              -> `nativeRegistry.validateAstLane` refuses (every tree).
Before this slice a DIRECT API caller (and the Pine attach door) skipped all three
— the store stamped the verdict and kept the row.

⛔ THE LEGACY GUARD: the new gates apply to NEW MATHS only (a create, or an edit
whose `ast_hash`/`treesHash` moved — the same question `rev_bumped` asks). A
presentation-only re-save of a row stored before the gate existed is admitted,
so no member is stranded on a definition they already own.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import alert_rev_migration as rev
from api.services import indicator_alert_service as ias
from api.services import user_definitions as svc

USER = "u1"

SMA20 = {"type": "call", "name": "sma",
         "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 20}]}
#: lookback 5000 > the 550-bar cap (`ast_budget.DEFAULT_BUDGET.maxLookback`).
SMA_HUGE = {"type": "call", "name": "sma",
            "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 5000}]}
#: measures `repaints` (reads the fetch's right edge, RT4).
LASTBARINDEX = {"type": "series", "name": "lastbarindex"}
#: measures `preview-repaints` (a bounded forward reach).
CHIKOU = {"type": "call", "name": "ichimokuChikou", "args": [
    {"type": "series", "name": "high"}, {"type": "series", "name": "low"},
    {"type": "series", "name": "close"}, {"type": "num", "value": 9},
    {"type": "num", "value": 26}, {"type": "num", "value": 52}]}
#: a call the closed table does not hold — canonical in SHAPE, unrunnable.
UNKNOWN_FN = {"type": "call", "name": "notafunctioninthetable",
              "args": [{"type": "series", "name": "close"}]}


def doc(tree, *, name="X", def_id=None, colour=None) -> dict:
    d = {
        "schemaVersion": 1, "version": 1,
        "meta": {"name": name, "shortName": "X"},
        "compute": {"kind": "ast", "ast": tree},
        "placement": {"target": "lower"},
        "plots": [{"key": "value", "style": "line", "role": "primary",
                   **({"color": colour} if colour else {})}],
        "inputs": [],
    }
    if def_id:
        d["id"] = def_id
    return d


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = \
        lambda: {"id": USER, "role": "user", "plan": "premium"}
    return TestClient(app)


def _plant_legacy(monkeypatch, tree, def_id="u_00000000a001") -> str:
    """A row stored BEFORE the save gate existed — planted through the real
    `svc.save` with only the new-maths admission switched off, so every other
    byte (hash, rev, repaint column) is what production holds today."""
    with monkeypatch.context() as m:
        m.setattr(svc, "_admit_new_maths", lambda *a, **k: None)
        svc.save(USER, def_id, doc(tree, def_id=def_id))
    return def_id


# ── 0P-a  repaints ──────────────────────────────────────────────────────────

def test_A1_REFUSAL_direct_api_save_of_a_repainting_formula(client):
    """ASKED: POST a formula the linter measures `repaints` (lastbarindex).
    CLAIMED (browser): Save is disabled for `repaints` — it is never stored.
    DID BEFORE: 200, stored with repaint={"value":"repaints"} — the browser's
    refusal was a UI property only (SILENT ADMISSION of a refused formula).
    EXPECTED: REFUSAL — 422, gate `repaint`, plot named."""
    r = client.post("/api/user-definitions", json={"definition": doc(LASTBARINDEX)})
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["refusal"]["gate"] == "repaint"
    assert body["refusal"]["plot"] == "value"
    assert body["refusal"]["mode"] == "repaints"
    assert isinstance(body["detail"], str) and "repaints" in body["detail"]
    assert client.get("/api/user-definitions").json()["definitions"] == []


def test_A2_REFUSAL_preview_repaints_without_acknowledgement(client):
    """ASKED: POST a `preview-repaints` formula (ichimokuChikou) with no ack.
    CLAIMED (browser): Save needs the author's acknowledgement of the badge.
    DID BEFORE: 200 — stored with no acknowledgement ever given.
    EXPECTED: REFUSAL — 422, gate `repaint-ack`."""
    r = client.post("/api/user-definitions", json={"definition": doc(CHIKOU)})
    assert r.status_code == 422, r.text
    assert r.json()["refusal"]["gate"] == "repaint-ack"
    assert r.json()["refusal"]["plot"] == "value"


@pytest.mark.parametrize("ack", [True, {"value": True}])
def test_A3_VALUE_preview_repaints_WITH_acknowledgement_is_saved(client, ack):
    """ASKED: the same formula, acknowledged (wholesale or for that plot).
    CLAIMED: saved, badge `preview-repaints`.
    DID BEFORE: 200 (ack field ignored — it did not exist).
    EXPECTED: VALUE — 200, and the ack is NOT persisted (it is a save-time
    gate; `meta.repaintAck`, the alert-arm ack, is a different fact)."""
    r = client.post("/api/user-definitions",
                    json={"definition": doc(CHIKOU), "repaint_acknowledged": ack})
    assert r.status_code == 200, r.text
    assert r.json()["repaint"] == {"value": "preview-repaints"}
    stored = svc.get(USER, r.json()["def_id"])["definition"]
    assert "repaintAck" not in stored["meta"]
    assert "repaint_acknowledged" not in stored


def test_A4_REFUSAL_an_ack_for_ANOTHER_plot_does_not_cover_this_one(client):
    """ASKED: preview-repaints plot `value`, ack given for plot `other`.
    EXPECTED: REFUSAL — an acknowledgement covers only what it names."""
    r = client.post("/api/user-definitions",
                    json={"definition": doc(CHIKOU), "repaint_acknowledged": {"other": True}})
    assert r.status_code == 422 and r.json()["refusal"]["gate"] == "repaint-ack"


# ── 0P-b  budget ────────────────────────────────────────────────────────────

def test_B1_REFUSAL_direct_api_save_of_an_over_budget_formula(client):
    """ASKED: POST sma(close, 5000) — lookback 5000 against a 550-bar cap.
    CLAIMED (browser): `validateAstLane` refuses it at registration.
    DID BEFORE: 200 — stored; it then refused at run and at alert admission
    only (a saved formula that can never draw).
    EXPECTED: REFUSAL — 422, gate `budget`, guard `budget:lookback`."""
    r = client.post("/api/user-definitions", json={"definition": doc(SMA_HUGE)})
    assert r.status_code == 422, r.text
    assert r.json()["refusal"]["gate"] == "budget"
    assert r.json()["refusal"]["guard"] == "budget:lookback"


def test_B2_REFUSAL_a_tree_naming_a_function_the_table_does_not_hold(client):
    """ASKED: POST notafunctioninthetable(close).
    CLAIMED: `assert_canonical` accepted the SHAPE; the browser refuses it at
    `checkBudget` (resolve:function).
    DID BEFORE: 200 — stored, lint `repaints` (fail-closed), never drawable.
    EXPECTED: REFUSAL — 422 naming the guard that decided (not 'budget')."""
    r = client.post("/api/user-definitions", json={"definition": doc(UNKNOWN_FN)})
    assert r.status_code == 422, r.text
    assert r.json()["refusal"]["gate"] == "tree"
    assert r.json()["refusal"]["guard"].startswith("resolve:")


def test_B3_REFUSAL_budget_is_checked_on_EVERY_tree_not_only_the_scan_alias(client):
    """ASKED: a two-plot document whose NON-scan tree is over budget.
    DID BEFORE: 200 (and the alert gate checks `compute.ast` only).
    EXPECTED: REFUSAL — 422 naming the plot."""
    trees = {"a": SMA20, "b": SMA_HUGE}
    d = doc(SMA20)
    d["plots"] = [{"key": "a", "style": "line", "role": "primary"},
                  {"key": "b", "style": "line", "role": "secondary"}]
    d["compute"].update(trees=trees, treesHash=svc.trees_hash(trees), scanPlot="a",
                        sources={"a": "sma(close, 20)", "b": "sma(close, 5000)"},
                        source="sma(close, 20)")
    r = client.post("/api/user-definitions", json={"definition": d})
    assert r.status_code == 422, r.text
    assert r.json()["refusal"]["gate"] == "budget" and r.json()["refusal"]["plot"] == "b"


# ── integrity (already enforced before this slice; pinned so it stays) ─────

def test_C1_CONTROLLED_ERROR_a_forged_compute_fn_is_refused(client):
    """ASKED: compute.fn that disagrees with astHash(compute.ast).
    DID BEFORE: 400 `compute.fn: …` (validate_v2) — EXACT, kept."""
    d = doc(SMA20)
    d["compute"]["fn"] = "0" * 64
    r = client.post("/api/user-definitions", json={"definition": d})
    assert r.status_code == 400 and r.json()["detail"].startswith("compute.fn")


def test_C2_CONTROLLED_ERROR_a_forged_treesHash_is_refused(client):
    trees = {"a": SMA20, "b": CHIKOU}
    d = doc(SMA20)
    d["plots"] = [{"key": "a", "style": "line", "role": "primary"},
                  {"key": "b", "style": "line", "role": "secondary"}]
    d["compute"].update(trees=trees, treesHash="f" * 64, scanPlot="a",
                        sources={"a": "sma(close, 20)", "b": "x"}, source="sma(close, 20)")
    r = client.post("/api/user-definitions", json={"definition": d,
                                                   "repaint_acknowledged": True})
    assert r.status_code == 400 and r.json()["detail"].startswith("compute.treesHash")


def test_C3_VALUE_a_clean_formula_still_saves_and_edits(client):
    """The control: the gate is not a wall."""
    r = client.post("/api/user-definitions", json={"definition": doc(SMA20)})
    assert r.status_code == 200, r.text
    def_id = r.json()["def_id"]
    e = client.put(f"/api/user-definitions/{def_id}",
                   json={"definition": doc(SMA20, name="Renamed", def_id=def_id)})
    assert e.status_code == 200 and e.json()["version"] == 2 and not e.json()["rev_bumped"]


# ── the legacy guard: nobody is stranded ────────────────────────────────────

@pytest.mark.parametrize("tree", [LASTBARINDEX, CHIKOU, SMA_HUGE, UNKNOWN_FN],
                         ids=["repaints", "preview-unacked", "over-budget", "unknown-fn"])
def test_D1_VALUE_a_presentation_only_edit_of_a_LEGACY_row_still_saves(client, monkeypatch, tree):
    """ASKED: rename a definition stored before this gate (same maths).
    CLAIMED: an edit of something the member already owns always saves.
    EXPECTED: VALUE — 200, version 2, rev unchanged; the gates refuse only
    NEW maths (a create, or an edit whose tree moved)."""
    def_id = _plant_legacy(monkeypatch, tree)
    r = client.put(f"/api/user-definitions/{def_id}",
                   json={"definition": doc(tree, name="Renamed", def_id=def_id)})
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 2 and r.json()["rev_bumped"] is False


def test_D2_REFUSAL_a_MATHS_edit_of_a_legacy_row_into_another_refused_formula(client, monkeypatch):
    """ASKED: edit a legacy repainting row into a DIFFERENT repainting tree.
    EXPECTED: REFUSAL — new maths meets today's gate; the stored row is
    untouched (still version 1)."""
    def_id = _plant_legacy(monkeypatch, LASTBARINDEX)
    other = {"type": "op", "name": "+",
             "args": [LASTBARINDEX, {"type": "num", "value": 1}]}
    r = client.put(f"/api/user-definitions/{def_id}",
                   json={"definition": doc(other, def_id=def_id)})
    assert r.status_code == 422, r.text
    assert svc.get(USER, def_id)["version"] == 1


def test_D3_VALUE_a_maths_edit_of_a_legacy_row_into_a_CLEAN_formula_saves(client, monkeypatch):
    """The way OUT of a legacy refused row is open: fix the maths, save."""
    def_id = _plant_legacy(monkeypatch, LASTBARINDEX)
    r = client.put(f"/api/user-definitions/{def_id}",
                   json={"definition": doc(SMA20, def_id=def_id)})
    assert r.status_code == 200 and r.json()["rev_bumped"] is True
