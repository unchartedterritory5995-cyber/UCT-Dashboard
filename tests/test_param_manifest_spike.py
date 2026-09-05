"""Track F pre-implementation SPIKE — the 15-point proof gate.

Per DEC-006 and `TRACK_F_PARAMETER_ADR_V2*.md`: no broad Track F implementation
proceeds until these 15 properties are proven against REAL, RUNNING CODE, not
this ADR's prose. Each test below is named after the spike point(s) it proves.
This file does not touch `pine.js` (the Pine translator) — per instruction,
that stays untouched until a narrow v1 implementation is separately
authorized. Every test here exercises the REAL `api.services.user_definitions
.save()` and, where relevant, the REAL `api.services.alert_user_series`
registry — hand-constructed fixtures stand in for what the (untouched)
translator would eventually produce, exactly as a spike is meant to isolate
"does the save/validation/reconciliation architecture hold" from "does the
translator emit the right shape yet."
"""
from __future__ import annotations

import json

import pytest

from api.services import alert_rev_migration as rev
from api.services import alert_user_series as aus
from api.services import indicator_alert_service as ias
from api.services import param_manifest_spike as pms
from api.services import user_definitions as svc

USER = "spike-user"
DEF_ID = "u_0123456789ab"
DEF_ID_FRESH = "u_aaaa00000001"
DEF_ID_OTHER = "u_bbbb00000002"


@pytest.fixture
def store(tmp_path, monkeypatch):
    """Mirrors `tests/test_user_definitions.py::store` exactly — `save()`'s
    phase 2 migration reads the alert DB whenever `rev_bumped`, which every
    parameter-value-changing save in this file triggers."""
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    rev.init_schema()
    return tmp_path


def _sma_ast(period_value):
    """sma(close, <period_value>) -- the manifest's locator points at the
    period literal's exact position."""
    return {"type": "call", "name": "sma",
            "args": [{"type": "series", "name": "close"},
                     {"type": "num", "value": period_value}]}


def _definition(period_value, manifest=None, def_id=DEF_ID, extra_compute=None):
    compute = {"kind": "ast", "ast": _sma_ast(period_value), "source": f"sma(close, {period_value})"}
    if manifest is not None:
        compute["paramManifest"] = manifest
    if extra_compute:
        compute.update(extra_compute)
    return {"id": def_id, "compute": compute}


def _manifest_len(value=14, min_=1, max_=200, locator_path=None):
    return {
        "__uct_param_1": {
            "sourceName": "len", "title": "SMA Length", "type": "int",
            "default": 14, "min": min_, "max": max_, "step": 1, "options": None,
            "locators": [{"treeIndex": None, "astPath": locator_path or ["args", 1]}],
        }
    }


# ─── 1. one numeric parameter: sma(close, len) ───────────────────────────────

def test_1_one_numeric_parameter_imports_adjustable_and_overrides_cleanly(store):
    manifest = _manifest_len(value=14)
    r1 = svc.save(USER, DEF_ID, _definition(14, manifest))
    row1 = svc._newest(_conn(store), USER, DEF_ID)
    d1 = json.loads(row1["definition"])
    assert d1["compute"]["paramState"]["__uct_param_1"]["state"] == pms.ATTACHED
    assert d1["compute"]["paramState"]["__uct_param_1"]["value"] == 14

    r2 = svc.save(USER, DEF_ID, _definition(21, manifest))
    assert r2["ast_hash"] != r1["ast_hash"], "a new literal value must produce a new tree hash"
    row2 = svc._newest(_conn(store), USER, DEF_ID)
    d2 = json.loads(row2["definition"])
    assert d2["compute"]["paramState"]["__uct_param_1"]["value"] == 21


def _conn(tmp_path):
    import sqlite3
    c = sqlite3.connect(svc._DB_PATH)
    c.row_factory = sqlite3.Row
    return c


# ─── 2. two independent parameters ───────────────────────────────────────────

def test_2_two_independent_parameters_change_without_disturbing_each_other(store):
    ast = {"type": "call", "name": "ema",
           "args": [{"type": "call", "name": "sma",
                     "args": [{"type": "series", "name": "close"}, {"type": "num", "value": 20}]},
                    {"type": "num", "value": 9}]}
    manifest = {
        "__uct_param_1": {"sourceName": "len1", "title": "SMA Length", "type": "int",
                          "default": 20, "min": 1, "max": 200, "step": 1, "options": None,
                          "locators": [{"treeIndex": None, "astPath": ["args", 0, "args", 1]}]},
        "__uct_param_2": {"sourceName": "len2", "title": "EMA Length", "type": "int",
                          "default": 9, "min": 1, "max": 200, "step": 1, "options": None,
                          "locators": [{"treeIndex": None, "astPath": ["args", 1]}]},
    }
    d = {"id": DEF_ID, "compute": {"kind": "ast", "ast": ast, "source": "ema(sma(close,20),9)",
                                    "paramManifest": manifest}}
    svc.save(USER, DEF_ID, d)

    # Change ONLY len2 (the outer EMA length) — len1 must be untouched.
    ast2 = json.loads(json.dumps(ast))
    ast2["args"][1]["value"] = 15
    d2 = {"id": DEF_ID, "compute": {"kind": "ast", "ast": ast2, "source": "ema(sma(close,20),15)",
                                     "paramManifest": manifest}}
    svc.save(USER, DEF_ID, d2)
    row = svc._newest(_conn(store), USER, DEF_ID)
    state = json.loads(row["definition"])["compute"]["paramState"]
    assert state["__uct_param_1"]["value"] == 20
    assert state["__uct_param_2"]["value"] == 15


# ─── 3. one parameter used at multiple safe locations ────────────────────────

def test_3_one_parameter_at_multiple_locations_updates_all_locators_atomically(store):
    # sma(close, len) - sma(close, len)[5]  -- same len, two use sites.
    ast = {"type": "op", "name": "-", "args": [
        {"type": "num", "value": 14},   # stand-in for use-site A (kept literal-shaped)
        {"type": "num", "value": 14},   # stand-in for use-site B
    ]}
    manifest = {
        "__uct_param_1": {"sourceName": "len", "title": "Length", "type": "int",
                          "default": 14, "min": 1, "max": 200, "step": 1, "options": None,
                          "locators": [{"treeIndex": None, "astPath": ["args", 0]},
                                       {"treeIndex": None, "astPath": ["args", 1]}]},
    }
    svc.save(USER, DEF_ID, {"id": DEF_ID, "compute": {
        "kind": "ast", "ast": ast, "source": "x", "paramManifest": manifest}})

    ast2 = {"type": "op", "name": "-", "args": [
        {"type": "num", "value": 21}, {"type": "num", "value": 21}]}
    svc.save(USER, DEF_ID, {"id": DEF_ID, "compute": {
        "kind": "ast", "ast": ast2, "source": "x", "paramManifest": manifest}})
    row = svc._newest(_conn(store), USER, DEF_ID)
    state = json.loads(row["definition"])["compute"]["paramState"]
    assert state["__uct_param_1"]["state"] == pms.ATTACHED
    assert state["__uct_param_1"]["value"] == 21


def test_3b_multiple_locators_that_DISAGREE_are_conflicted_not_silently_resolved(store):
    ast = {"type": "op", "name": "-", "args": [
        {"type": "num", "value": 14}, {"type": "num", "value": 14}]}
    manifest = {
        "__uct_param_1": {"sourceName": "len", "title": "Length", "type": "int",
                          "default": 14, "min": 1, "max": 200, "step": 1, "options": None,
                          "locators": [{"treeIndex": None, "astPath": ["args", 0]},
                                       {"treeIndex": None, "astPath": ["args", 1]}]},
    }
    svc.save(USER, DEF_ID, {"id": DEF_ID, "compute": {
        "kind": "ast", "ast": ast, "source": "x", "paramManifest": manifest}})

    # Manually edit ONE use-site only, as a member editing text might.
    ast2 = {"type": "op", "name": "-", "args": [
        {"type": "num", "value": 21}, {"type": "num", "value": 14}]}
    svc.save(USER, DEF_ID, {"id": DEF_ID, "compute": {
        "kind": "ast", "ast": ast2, "source": "x", "paramManifest": manifest}})
    row = svc._newest(_conn(store), USER, DEF_ID)
    state = json.loads(row["definition"])["compute"]["paramState"]
    assert state["__uct_param_1"]["state"] == pms.CONFLICTED
    assert state["__uct_param_1"]["value"] is None, "no value may be chosen silently"


# ─── 4. offset/window case: static-literal guarantee ─────────────────────────

def test_4_offset_window_case_the_literal_survives_a_parameter_change(store):
    # close[len] -- an offset node whose index is the adjustable parameter.
    ast = {"type": "offset", "value": 5, "args": [{"type": "series", "name": "close"}]}
    manifest = _manifest_len(value=5, locator_path=["value"])
    svc.save(USER, DEF_ID, {"id": DEF_ID, "compute": {
        "kind": "ast", "ast": ast, "source": "close[5]", "paramManifest": manifest}})
    ast2 = {"type": "offset", "value": 10, "args": [{"type": "series", "name": "close"}]}
    svc.save(USER, DEF_ID, {"id": DEF_ID, "compute": {
        "kind": "ast", "ast": ast2, "source": "close[10]", "paramManifest": manifest}})
    row = svc._newest(_conn(store), USER, DEF_ID)
    d = json.loads(row["definition"])
    assert d["compute"]["ast"]["value"] == 10, "the offset is still a plain literal, unchanged in kind"
    assert d["compute"]["paramState"]["__uct_param_1"]["value"] == 10


# ─── 5 & 6. manual edit of the value; deleted/renamed binding ────────────────

def test_5_manual_edit_of_the_binding_value_is_the_same_path_as_a_UI_edit(store):
    manifest = _manifest_len(14)
    svc.save(USER, DEF_ID, _definition(14, manifest))
    # A "manual edit" and a "UI edit" are indistinguishable inputs to save() —
    # both are just a new ast + the same manifest.
    svc.save(USER, DEF_ID, _definition(30, manifest))
    row = svc._newest(_conn(store), USER, DEF_ID)
    assert json.loads(row["definition"])["compute"]["paramState"]["__uct_param_1"]["value"] == 30


def test_6_a_deleted_binding_DETACHES_and_does_not_block_the_save(store):
    manifest = _manifest_len(14)
    svc.save(USER, DEF_ID, _definition(14, manifest))
    # The member rewrote the formula so the parameter's use-site is gone —
    # replace sma(close,14) with a constant. The manifest is still submitted
    # (as the client-side reconciliation would still carry it forward), but
    # its locator no longer resolves.
    ast = {"type": "num", "value": 42}
    svc.save(USER, DEF_ID, {"id": DEF_ID, "compute": {
        "kind": "ast", "ast": ast, "source": "42", "paramManifest": manifest}})
    row = svc._newest(_conn(store), USER, DEF_ID)
    d = json.loads(row["definition"])
    assert d["compute"]["ast"] == {"type": "num", "value": 42}, "the member's formula is untouched"
    assert d["compute"]["paramState"]["__uct_param_1"]["state"] == pms.DETACHED


def test_6b_a_binding_rewritten_to_a_non_literal_is_NON_LITERAL_not_a_crash(store):
    manifest = _manifest_len(14)
    svc.save(USER, DEF_ID, _definition(14, manifest))
    # `let len = close - open` equivalent: the locator resolves to a node,
    # but that node is no longer a plain numeric literal.
    ast = {"type": "call", "name": "sma", "args": [
        {"type": "series", "name": "close"},
        {"type": "op", "name": "-", "args": [{"type": "series", "name": "close"},
                                              {"type": "series", "name": "open"}]},
    ]}
    svc.save(USER, DEF_ID, {"id": DEF_ID, "compute": {
        "kind": "ast", "ast": ast, "source": "sma(close, close-open)", "paramManifest": manifest}})
    row = svc._newest(_conn(store), USER, DEF_ID)
    state = json.loads(row["definition"])["compute"]["paramState"]
    assert state["__uct_param_1"]["state"] == pms.NON_LITERAL


# ─── 7 & 8. lookback increase; budget/domain bust (out-of-range REJECT) ─────

def test_7_a_lookback_increasing_change_is_accepted_and_reflected(store):
    manifest = _manifest_len(14, max_=500)
    svc.save(USER, DEF_ID, _definition(14, manifest))
    svc.save(USER, DEF_ID, _definition(300, manifest))
    row = svc._newest(_conn(store), USER, DEF_ID)
    assert json.loads(row["definition"])["compute"]["paramState"]["__uct_param_1"]["value"] == 300


def test_8_an_out_of_range_override_is_REJECTED_not_clamped(store):
    manifest = _manifest_len(14, min_=1, max_=200)
    svc.save(USER, DEF_ID, _definition(14, manifest))
    with pytest.raises(pms.ParamManifestRejected):
        svc.save(USER, DEF_ID, _definition(500, manifest))
    # And the prior value is what's actually stored — no silent clamp landed.
    row = svc._newest(_conn(store), USER, DEF_ID)
    assert json.loads(row["definition"])["compute"]["ast"]["args"][1]["value"] == 14


def test_8b_the_boundary_values_are_inclusive_not_an_off_by_one(store):
    manifest = _manifest_len(14, min_=1, max_=200)
    svc.save(USER, DEF_ID, _definition(14, manifest))
    svc.save(USER, DEF_ID, _definition(200, manifest))  # exactly at max — must be accepted
    svc.save(USER, DEF_ID, _definition(1, manifest))    # exactly at min — must be accepted


# ─── 9. alert re-proof after a parameter change ──────────────────────────────

def test_9_forget_still_fires_on_every_save_that_carries_a_paramManifest(store, monkeypatch):
    calls = []
    monkeypatch.setattr(aus, "forget", lambda user_id=None: calls.append(user_id) or 0)
    manifest = _manifest_len(14)
    svc.save(USER, DEF_ID, _definition(14, manifest))
    svc.save(USER, DEF_ID, _definition(21, manifest))
    assert calls == [USER, USER], (
        "alert_user_series.forget() must fire on every save exactly as it always has -- "
        "the paramManifest hook must never short-circuit phase 4")


# ─── 10. scanner def_hash changes; old-hash results are not implicated ──────

def test_10_a_parameter_change_produces_a_new_ast_hash_for_scan_keying(store):
    manifest = _manifest_len(14)
    r1 = svc.save(USER, DEF_ID, _definition(14, manifest))
    r2 = svc.save(USER, DEF_ID, _definition(21, manifest))
    assert r1["ast_hash"] != r2["ast_hash"], (
        "scan_hits/scan_coverage are keyed by ast_hash (RISK-024's own store); a "
        "parameter change producing a stable hash would mean the scan lane could "
        "never tell the old parameter value's results from the new one's")
    assert r2["rev_bumped"] is True


# ─── 11, 12, 13: multi-tree logical parameter (spanning two trees) ──────────

def _multitree_definition(period_a, period_b, manifest):
    ast_a = _sma_ast(period_a)
    ast_b = {"type": "call", "name": "rsi",
             "args": [{"type": "series", "name": "close"}, {"type": "num", "value": period_b}]}
    trees = {"scan": ast_a, "rsiPlot": ast_b}
    return {
        "id": DEF_ID,
        "compute": {
            "kind": "ast", "ast": ast_a, "source": f"sma(close,{period_a})",
            "trees": trees,
            "treesHash": svc.trees_hash(trees),
            "scanPlot": "scan",
            "sources": {"scan": f"sma(close,{period_a})", "rsiPlot": f"rsi(close,{period_b})"},
            "paramManifest": manifest,
        },
        # Every tree needs a data-bearing plot (validate_v2's own "a tree with
        # no plot is computed for nobody" rule) — minimal, only what that
        # check reads.
        "plots": [{"key": "scan", "style": "line"}, {"key": "rsiPlot", "style": "line"}],
    }


def _multitree_manifest(min_=1, max_=200):
    return {
        "__uct_param_1": {
            "sourceName": "len", "title": "Shared Length", "type": "int",
            "default": 14, "min": min_, "max": max_, "step": 1, "options": None,
            "locators": [
                {"treeIndex": "scan", "astPath": ["args", 1]},
                {"treeIndex": "rsiPlot", "astPath": ["args", 1]},
            ],
        }
    }


def test_11_one_input_feeding_two_trees_updates_both_bindings_atomically(store):
    manifest = _multitree_manifest()
    svc.save(USER, DEF_ID, _multitree_definition(14, 14, manifest))
    svc.save(USER, DEF_ID, _multitree_definition(21, 21, manifest))
    row = svc._newest(_conn(store), USER, DEF_ID)
    d = json.loads(row["definition"])
    assert d["compute"]["paramState"]["__uct_param_1"]["state"] == pms.ATTACHED
    assert d["compute"]["paramState"]["__uct_param_1"]["value"] == 21
    assert d["compute"]["trees"]["scan"]["args"][1]["value"] == 21
    assert d["compute"]["trees"]["rsiPlot"]["args"][1]["value"] == 21


def _retouch_trees_hash(d):
    """Test-only helper: after manually mutating `d["compute"]["trees"]`,
    recompute the hash `validate_v2` checks — a spike test mutating a fixture
    by hand must keep it internally consistent the same way a real client
    would, or it is testing schema validation instead of parameter logic."""
    d["compute"]["treesHash"] = svc.trees_hash(d["compute"]["trees"])
    return d


def test_12_one_of_two_locators_disappearing_is_PARTIALLY_DETACHED_not_a_half_working_slider(store):
    manifest = _multitree_manifest()
    svc.save(USER, DEF_ID, _multitree_definition(14, 14, manifest))
    # The member's edit genuinely removes the rsiPlot tree's use of `len` —
    # the arg position the locator points at (`astPath: ["args", 1]`) no
    # longer exists at all, not merely a different value at the same spot
    # (that's test_13's CONFLICTED case). This is what "rsi(close, len)"
    # manually rewritten to "rsi(close)" looks like structurally: the
    # locator's `_walk()` must return None (out-of-range index), the actual
    # disappearance this state exists to detect — leaving the scan tree's
    # binding intact.
    d = _multitree_definition(14, 14, manifest)
    d["compute"]["trees"]["rsiPlot"] = {"type": "call", "name": "rsi",
                                         "args": [{"type": "series", "name": "close"}]}
    d["compute"]["sources"]["rsiPlot"] = "rsi(close)"
    _retouch_trees_hash(d)
    svc.save(USER, DEF_ID, d)
    row = svc._newest(_conn(store), USER, DEF_ID)
    state = json.loads(row["definition"])["compute"]["paramState"]
    assert state["__uct_param_1"]["state"] == pms.PARTIALLY_DETACHED
    assert state["__uct_param_1"]["value"] is None, "never show a partially-working slider's value as authoritative"
    # And both trees' actual formulas are preserved untouched — never corrupted.
    saved = json.loads(row["definition"])
    assert saved["compute"]["trees"]["rsiPlot"]["args"] == [{"type": "series", "name": "close"}]
    assert saved["compute"]["trees"]["scan"]["args"][1]["value"] == 14, "the surviving locator's tree is untouched"


def test_13_two_locators_that_disagree_across_trees_is_CONFLICTED(store):
    manifest = _multitree_manifest()
    svc.save(USER, DEF_ID, _multitree_definition(14, 14, manifest))
    d = _multitree_definition(21, 14, manifest)  # scan=21, rsiPlot still 14
    svc.save(USER, DEF_ID, d)
    row = svc._newest(_conn(store), USER, DEF_ID)
    state = json.loads(row["definition"])["compute"]["paramState"]
    assert state["__uct_param_1"]["state"] == pms.CONFLICTED
    assert state["__uct_param_1"]["value"] is None
    # Both trees' formulas are exactly what the member submitted — no value
    # was quietly propagated from one tree to the other.
    saved = json.loads(row["definition"])
    assert saved["compute"]["trees"]["scan"]["args"][1]["value"] == 21
    assert saved["compute"]["trees"]["rsiPlot"]["args"][1]["value"] == 14


# ─── 14. crafted PUT mutating an EXISTING parameter's immutable metadata ────

def test_14_a_crafted_manifest_widening_an_existing_parameters_bound_is_defeated(store):
    manifest = _manifest_len(14, min_=1, max_=200)
    svc.save(USER, DEF_ID, _definition(14, manifest))

    forged = json.loads(json.dumps(manifest))
    forged["__uct_param_1"]["max"] = 100000  # attacker widens their own ceiling
    # ...and submits a value that would be accepted under the FORGED bound
    # but rejected under the true, prior one.
    with pytest.raises(pms.ParamManifestRejected):
        svc.save(USER, DEF_ID, _definition(50000, forged))
    row = svc._newest(_conn(store), USER, DEF_ID)
    assert json.loads(row["definition"])["compute"]["ast"]["args"][1]["value"] == 14


def test_14b_a_crafted_manifest_changing_type_or_frozen_status_is_ignored(store):
    manifest = _manifest_len(14, min_=1, max_=200)
    svc.save(USER, DEF_ID, _definition(14, manifest))
    forged = json.loads(json.dumps(manifest))
    forged["__uct_param_1"]["type"] = "float"
    forged["__uct_param_1"]["title"] = "TOTALLY DIFFERENT TITLE"
    svc.save(USER, DEF_ID, _definition(21, forged))
    row = svc._newest(_conn(store), USER, DEF_ID)
    stored_entry = json.loads(row["definition"])["compute"]["paramManifest"]["__uct_param_1"]
    assert stored_entry["type"] == "int", "the TRUE prior type wins, not the client's forged one"
    assert stored_entry["title"] == "SMA Length", "the TRUE prior title wins, not the client's forged one"


def test_14c_a_genuinely_new_parameter_on_a_FRESH_creation_is_legitimately_trusted(store):
    """The one honest, necessarily-client-side trust boundary (ADR V2.2 S4):
    a brand-new definition (prev is None) is trusted for its own manifest."""
    manifest = _manifest_len(14, min_=1, max_=200)
    r = svc.save(USER, DEF_ID_FRESH, _definition(14, manifest, def_id=DEF_ID_FRESH))
    assert r["appended"] is True
    row = svc._newest(_conn(store), USER, DEF_ID_FRESH)
    assert json.loads(row["definition"])["compute"]["paramManifest"]["__uct_param_1"]["max"] == 200


# ─── 15. crafted PUT inventing a brand-new parameter id on an EXISTING def ──

def test_15_a_crafted_PUT_cannot_invent_a_new_trusted_parameter_on_an_existing_definition(store):
    """The owner's 15th condition. A definition already exists with
    __uct_param_1 established. A later, ordinary edit tries to ALSO claim a
    brand-new __uct_param_2 — absent from the trusted prior manifest — with
    permissive, attacker-chosen bounds. This must be refused outright, not
    silently promoted to trusted status merely because the id was new."""
    manifest = _manifest_len(14, min_=1, max_=200)
    svc.save(USER, DEF_ID, _definition(14, manifest))

    ast2 = {"type": "call", "name": "ema", "args": [
        {"type": "call", "name": "sma", "args": [
            {"type": "series", "name": "close"}, {"type": "num", "value": 14}]},
        {"type": "num", "value": 999999}]}
    forged_manifest = dict(manifest)
    forged_manifest["__uct_param_2"] = {
        "sourceName": "evil", "title": "totally legitimate", "type": "int",
        "default": 9, "min": 0, "max": 10_000_000, "step": 1, "options": None,
        "locators": [{"treeIndex": None, "astPath": ["args", 1]}],
    }
    with pytest.raises(pms.ParamManifestRejected, match="__uct_param_2"):
        svc.save(USER, DEF_ID, {"id": DEF_ID, "compute": {
            "kind": "ast", "ast": ast2, "source": "ema(sma(close,14),999999)",
            "paramManifest": forged_manifest}})

    # And the whole save was refused -- not partially applied. The prior,
    # single-parameter definition is exactly what's still stored.
    row = svc._newest(_conn(store), USER, DEF_ID)
    d = json.loads(row["definition"])
    assert "__uct_param_2" not in d["compute"]["paramManifest"]
    assert d["compute"]["ast"] == _sma_ast(14), "the forged save must not have appended at all"
    assert row["version"] == 1


def test_15b_a_second_definition_may_legitimately_have_its_own_fresh_parameter(store):
    """Control: condition 15's refusal is about an id being new RELATIVE TO
    THIS definition's own trusted history, not new parameter ids being
    forbidden everywhere forever."""
    manifest = _manifest_len(14)
    svc.save(USER, DEF_ID, _definition(14, manifest))
    other_manifest = {"__uct_param_2": {
        "sourceName": "len", "title": "Other Def's Length", "type": "int",
        "default": 9, "min": 1, "max": 200, "step": 1, "options": None,
        "locators": [{"treeIndex": None, "astPath": ["args", 1]}],
    }}
    r = svc.save(USER, DEF_ID_OTHER, _definition(9, other_manifest, def_id=DEF_ID_OTHER))
    assert r["appended"] is True
