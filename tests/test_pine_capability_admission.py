"""WS-I Part 2 (2026-11-13): ADMISSION BY CAPABILITY, the server half.

A member's own copy of a script never hashes to a graded copy. With
`PINE_RUNTIME_CAPABILITY_ADMISSION=on` the browser pane's runtime lane also admits a script whose
every capability (`pine_capabilities.capabilities_of`) is admitted in the committed registry
(`api/data/pine_runtime_allowlist.json` `capabilities`, `rollout_gate.pine_capability_admission`).

Rails (each mutation-proved, `docs/pine/evidence/2026-11-13-capability-admission/EVIDENCE.md`):
  A1 a non-conformant row admits          A2 an unknown capability admits
  A3 an env variable adds a capability    A4 the kill list is ignored
  A5 a bad JSON admits                    A7 an object family admits without v2-run evidence
  A8 phantom evidence                     A9 a server lane admits by capability
  A10 a row added or changed on evidence graded at an older engine (2026-11-18)
(A6, the detector under-declaring, is `tests/test_pine_capabilities.py`.)
And: with the variable OFF (the default) every answer is the one before Part 2.
"""
from __future__ import annotations

import copy
import datetime
import json
import logging
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.routers import user_definitions as router_mod
from api.services import pine_capabilities as pc
from api.services import rollout_gate as rg
from api.services import runtime_definitions as rt
from api.services import user_definitions as svc

ROOT = Path(__file__).resolve().parents[1]

import sys  # noqa: E402

sys.path.insert(0, str(ROOT / "tools" / "vendor_harness"))
import licence_held  # noqa: E402 -- licence-held captures: read from the local store, skipped by name
import store_held  # noqa: E402 -- rows graded with production's library store: the one authority over their pins
FIXTURE = ROOT / "tests" / "fixtures" / "runtime_documents" / "documents.json"
DOCS = {d["slug"]: d for d in json.loads(FIXTURE.read_text(encoding="utf-8"))["documents"]}
ADX = DOCS["adx-and-di-for-v4"]["definition"]
VERDICTS_RT = ROOT / "docs" / "pine" / "vendor-harness" / "runtime-on" / "verdicts.json"
USER = "u-capadmit"

#: ⭐ THE CASE THIS SLICE EXISTS FOR: the graded ADX script with one comment line added, as a
#: member's own copy would be. Same capabilities, a different sha256, so the allowlist misses it.
MEMBER_COPY = ADX["compute"]["source"] + "\n// my own copy\n"
#: A script using a capability the committed registry does NOT admit (`collections:matrix`: no
#: runtime-drawn MATCH capture). It was `switch` until U3 admitted switch, then `udt` until U3b did.
UNADMITTED_CAP = "collections:matrix"
UNADMITTED_SCRIPT = ("//@version=5\nindicator('u')\nm = matrix.new<float>(2, 2, close)\n"
                     "plot(close)\n")


#: An object family the committed registry does NOT admit (no runtime-drawn capture): `polyline.*`.
POLYLINE_SNIPPET = ("var polyline p = na\n"
                    "p := polyline.new(array.from(chart.point.from_index(0, low), chart.point.from_index(1, high)))\n")
#: linefill.*, admitted by PARITY UNIT LF.
LINEFILL_SNIPPET = ("var linefill f = na\n"
                    "f := linefill.new(line.new(0, low, 1, low), line.new(0, high, 1, high), color.blue)\n")


def member_doc(source: str = MEMBER_COPY) -> dict:
    d = copy.deepcopy(ADX)
    d["compute"]["source"] = source
    d["meta"].pop("runtimeSourceHash", None)
    return d


@pytest.fixture(autouse=True)
def _own_store(tmp_path, monkeypatch):
    """Every test reads and writes its OWN persisted capability sets (no stale set across tests)."""
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch, _own_store):
    for k in (rt.STAGE_ENV, rt.SAVE_ENV, rt.KILL_ENV, rt.ALLOW_ENV, rt.CAPABILITY_ADMISSION_ENV,
              rt.CAPABILITY_DENY_ENV, rt.SERVER_STAGE_ENV, rt.SERVICE_URL_ENV, rt.SERVICE_SECRET_ENV):
        monkeypatch.delenv(k, raising=False)
    rt._reset_capability_cache(persisted=True)
    yield
    rt._reset_capability_cache(persisted=True)


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    from api.services import indicator_alert_service as ias
    alert_db = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(alert_db))
    monkeypatch.setattr(ias, "_DB_PATH", str(alert_db))
    ias.init_schema()
    return tmp_path


def _client(role="admin", plan="premium") -> TestClient:
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": USER, "role": role, "plan": plan}
    return TestClient(app)


def _registry_file(tmp_path, monkeypatch, mutate) -> None:
    doc = json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    out = mutate(doc)
    f = tmp_path / "allow.json"
    f.write_text(out if isinstance(out, str) else json.dumps(out), encoding="utf-8")
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(f))


EV2 = [{"capture": "c-1", "script": "A", "community": True, "verdict": "MATCH", "runtimePane": "on"},
       {"capture": "c-2", "script": "B", "community": False, "verdict": "MATCH", "runtimePane": "on"}]
ROW = {"status": "conformant", "admitted": True, "evidence": EV2}


# ═══ the case itself ═══════════════════════════════════════════════════════════

def test_the_member_copy_misses_the_allowlist_and_uses_only_admitted_capabilities(on):
    assert rt.source_hash(MEMBER_COPY) not in rt.allow_list()
    assert set(pc.capabilities_of(MEMBER_COPY)) == {"core", "reassign", "ternary"}
    assert rt.capability_admitted(MEMBER_COPY) == (True, [])
    assert rt.not_graded(MEMBER_COPY) is None


def test_the_committed_admitted_set_is_the_evidence_supported_one():
    assert rt.admitted_capabilities()["admitted"] == sorted([
        "core", "reassign", "ternary", "if-block", "var", "fn-single", "fn-multi", "for",
        "compound-assign", "history-expr", "tuple-destructure",
        # U1 (2026-11-15): object families on objects v2 runtime-on MATCH with records paired;
        # (obj:box came back in DRAW-1 with the count-at-cap carve-out: test_A7_obj_box_is_admitted_...)
        "obj:line", "obj:label", "obj:delete", "obj:collection",
        # U3 (2026-11-15): each on the one evidence rule over the S1-era corpus; realtime-state for
        # closed-bar history only (G6); max_bars_back by coordinator ruling (a)
        # (obj:linefill withdrawn in U3b: no x-graded linefill capture since U13; back in PARITY UNIT LF, below)
        "obj:getter", "switch", "for-in", "max_bars_back", "realtime-state",
        # U3b (2026-11-15): S20 supplied the second community scripts; calc-bars HELD (non-binding windows)
        "udt", "generics",
        # coordinator rulings 2026-11-13: the one evidence rule, no exceptions in either direction;
        # distinct script families, at least one community script (generics: probes only, out);
        # the array namespace on its own evidence (matrix and map have none)
        "while", "typed-array", "method-call", "collections:array",
        # COND-TA (U2, engine 58, 2026-11-15): conditional ta.* is exact-or-refused-by-name on the
        # runtime lane; 7 captures / 4 community scripts (`ast/condTaLanes.test.js` for the machinery)
        "conditional-ta",
        # DRAW-1 (2026-11-16, coordinator approval): table.* on Signal Ledger + RCT Mann-Kendall, both
        # drawn by the runtime lane, objects v2 MATCH with tables and cells paired
        "obj:table",
        # DRAW-1 (coordinator ruling 2026-11-16): box.* on its x-graded evidence, with the count-at-cap
        # carve-out (`objectPool.js` COUNT_AT_CAP_FAMILIES): a box family whose collector ran is withheld by name
        "obj:box",
        # (2026-11-18) strategy() run by the simulated broker: Q-SD1 / Q-SD2 (supertrend-strategy, community) and
        # W9-Q-S1p, MATCH runtime-on with the broker armed; a backtest is still served only on pinned broker rules
        "strategy-decl",
        # PARITY UNIT LF step 3 (2026-11-18): linefill.* on FVG Finder + AlgoAlpha Trend Targets, each drawn by its RUN
        # (LF step 1), with the count-at-cap carve-out (LF step 2): test_LF3_obj_linefill_is_admitted_on_run_drawn_captures
        "obj:linefill",
        # admit:request-other (coordinator ruling 2026-11-19): PA ZigZag at 1W / 1M (runtime lane) and SR-MTF (the
        # forced runtime lane, #1985), both community, MATCH at engine 84; for closed-bar history only (G6)
        "request-other"])


# ═══ flag OFF: the answers before Part 2 ═══════════════════════════════════════

@pytest.mark.parametrize("value", [None, "", "off", "1", "true", "yes", "enabled"])
def test_OFF_unless_exactly_on(monkeypatch, value):
    if value is not None:
        monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, value)
    assert rt.capability_admission_on() is False
    assert rt.not_graded(MEMBER_COPY)
    assert "capability_admission" not in rt.allow_report()
    assert rt.runtime_admission(MEMBER_COPY)["admitted"] is False


def test_OFF_the_default_is_pinned_in_SOURCE():
    assert rt.PINE_RUNTIME_MODE_FLAGS["PINE_RUNTIME_CAPABILITY_ADMISSION"] == ("off", ("off", "on"))


def test_OFF_the_kill_read_is_the_one_before_Part_2(store):
    body = _client().get("/api/user-definitions/runtime-kill").json()
    # RS Rating (2026-11-16): the committed allowlist now holds a record on the SUBSTITUTED path, so
    # the read also carries what that record discloses (`substituted`), and since Q-RS8 (its three
    # captures re-taken with the x table, objects v2 MATCH_SUBSTITUTED on master b7cd7a0e63) its
    # run-half evidence (`run_half_evidence`). Neither is a Part 2 key: `capability_admission` is
    # still absent while it is off.
    assert set(body) == {"kill", "allow", "save_enabled", "substituted", "run_half_evidence"}
    assert "capability_admission" not in body


def test_ON_the_kill_read_says_so(store, on):
    assert _client().get("/api/user-definitions/runtime-kill").json()["capability_admission"] is True


def test_OFF_a_stored_member_copy_is_served_stamped_and_ON_it_is_not(store, monkeypatch):
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    row = {"def_id": ADX["id"], "definition": member_doc()}
    assert "runtimeNotGraded" in rt.stamp_served(row)["definition"]["meta"]
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    assert rt.stamp_served(row) is row                          # untouched, not even copied


def test_the_save_door_follows_the_same_rule(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    with pytest.raises(ValueError, match="not yet been graded"):
        svc.save(USER, ADX["id"], member_doc(), role="admin")
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    svc.save(USER, ADX["id"], member_doc(), role="admin")
    assert svc.get(USER, ADX["id"])["definition"]["compute"]["source"] == MEMBER_COPY


def test_the_allow_report_carries_the_admission_only_while_ON(on):
    rep = rt.allow_report()["capability_admission"]
    assert "for" in rep["admitted"] and UNADMITTED_CAP not in rep["admitted"]
    # COND-TA: `conditional-ta` is admitted (conformant); it is no longer withheld
    assert "conditional-ta" in rep["admitted"] and "conditional-ta" not in rep["withheld"]
    assert rt.graded_allow_list() == ["d0853c4724651a1d3c63542a2ae767861030137cb1c75ea57a376c53a1630499",
                                      "caa94fe31a8788c0f52ca571dbb1b3f8a7499dae913ed5e710720fc8662c5af0"]


# ═══ A1 — a non-conformant row never admits ════════════════════════════════════

@pytest.mark.parametrize("row,needle", [
    (dict(ROW, admitted=False), "not marked admitted"),
    ({k: v for k, v in ROW.items() if k != "admitted"}, "not marked admitted"),
    (dict(ROW, admitted="true"), "not marked admitted"),
    (dict(ROW, status="divergent"), "divergent, not conformant"),
    (dict(ROW, status="ungraded"), "not conformant"),
    (dict(ROW, evidence=EV2[:1]), "1 MATCH captures"),
    (dict(ROW, evidence=[EV2[0], dict(EV2[1], script="A")]), "from 1 script"),
    (dict(ROW, evidence=[EV2[0], dict(EV2[1], capture="c-1", script="B")]), "1 MATCH captures"),
    (dict(ROW, evidence=[EV2[0], dict(EV2[1], verdict="DIVERGE")]), "1 MATCH captures"),
    (dict(ROW, evidence=[EV2[0], dict(EV2[1], verdict="INCONCLUSIVE")]), "1 MATCH captures"),
    (dict(ROW, evidence=[EV2[0], dict(EV2[1], runtimePane="off")]), "1 MATCH captures"),
    (dict(ROW, evidence=[EV2[0], {k: v for k, v in EV2[1].items() if k != "script"}]), "1 MATCH captures"),
    (dict(ROW, evidence=["c-1", "c-2"]), "0 MATCH captures"),
    (dict(ROW, evidence="c-1,c-2"), "0 MATCH captures"),
    ("junk", "not in the registry"),
    # evidence quality (ruling 2026-11-13): no community script, or one script family twice
    (dict(ROW, evidence=[dict(e, community=False) for e in EV2]), "no community script"),
    (dict(ROW, evidence=[dict(EV2[0], community="yes"), EV2[1]]), "no community script"),
    (dict(ROW, evidence=[EV2[0], dict(EV2[1], script="A")]), "from 1 script"),
])
def test_A1_each_rule_withholds_by_name(row, needle):
    reasons = rg.pine_capability_admission("for", row)
    assert reasons and any(needle in r for r in reasons), reasons


def test_A1_a_well_formed_row_admits():
    assert rg.pine_capability_admission("for", ROW) == []


def test_A1_a_script_using_a_withheld_capability_is_not_admitted(tmp_path, monkeypatch, on):
    def drop(doc):
        doc["capabilities"]["ternary"]["admitted"] = False
        return doc
    _registry_file(tmp_path, monkeypatch, drop)
    assert rt.capability_admitted(MEMBER_COPY) == (False, ["ternary"])
    assert rt.not_graded(MEMBER_COPY)


# ═══ A2 — closed world: an unknown capability withholds ════════════════════════

def test_A2_a_capability_absent_from_the_registry_withholds(on):
    ok, missing = rt.capability_admitted(UNADMITTED_SCRIPT)
    assert not ok and UNADMITTED_CAP in missing
    assert rt.not_graded(UNADMITTED_SCRIPT)


def test_A2_every_vocabulary_id_outside_the_admitted_set_withholds(on):
    admitted = set(rt.admitted_capabilities()["admitted"])
    for cap in sorted(pc.CAPABILITY_IDS - admitted):
        orig = pc.capabilities_of
        try:
            pc.capabilities_of = lambda _s, c=cap: frozenset({"core", c})
            rt._reset_capability_cache(persisted=True)
            assert rt.capability_admitted(MEMBER_COPY) == (False, [cap]), cap
        finally:
            pc.capabilities_of = orig
            rt._reset_capability_cache(persisted=True)


def test_C3_an_id_outside_the_vocabulary_counts_missing(tmp_path, monkeypatch, on):
    """Closed world at the gate: an id the detector returns that the vocabulary does not name is
    missing, even when a registry row of that name looks admitted."""
    def add(doc):
        doc["capabilities"]["zz-new"] = dict(ROW)
        return doc
    _registry_file(tmp_path, monkeypatch, add)
    orig = pc.capabilities_of
    try:
        pc.capabilities_of = lambda _s: frozenset({"core", "zz-new"})
        rt._reset_capability_cache(persisted=True)
        assert rt.capability_admitted(MEMBER_COPY) == (False, ["zz-new"])
    finally:
        pc.capabilities_of = orig
        rt._reset_capability_cache(persisted=True)


def test_C1_a_matrix_or_map_script_is_withheld(on, monkeypatch):
    """The collection namespaces are admitted on their own evidence: matrix and map have none."""
    # fresh detector runs back to back: this rail is admission POLICY, not the duty cycle (the GATE
    # rails test the cool-down). Without this the 2nd run can land inside the 1st one's cool-down
    # (2 x its run time, no floor) and answer pending: red on every Linux runner, green on Windows.
    monkeypatch.setattr(rt, "DETECTOR_DUTY_CYCLE", 1.0)
    for body, cap in (("m = matrix.new<float>(2, 2)\n", "collections:matrix"),
                      ("var mp = map.new<string, float>()\n", "collections:map")):
        ok, missing = rt.capability_admitted(MEMBER_COPY + body)
        assert not ok and cap in missing, (cap, missing)
    gauss = (ROOT / "corpus" / "committed").glob("one-sided-gaussian-support-resistance-rate-loxx__*.pine")
    src = next(gauss).read_text(encoding="utf-8")
    ok, missing = rt.capability_admitted(src)
    assert not ok and "collections:matrix" in missing


def test_A2_an_unreadable_source_withholds(on):
    for s in (None, "", "  ", 7):
        assert rt.capability_admitted(s) == (False, ["unreadable"])


def test_A2_a_registry_row_naming_no_detector_id_admits_nothing(tmp_path, monkeypatch):
    def add(doc):
        doc["capabilities"]["zz-made-up"] = dict(ROW)
        return doc
    _registry_file(tmp_path, monkeypatch, add)
    rep = rt.admitted_capabilities()
    assert "zz-made-up" not in rep["admitted"] and "zz-made-up" in rep["withheld"]


# ═══ A3 — no variable ever adds a capability ═══════════════════════════════════

def test_A3_deny_subtracts(monkeypatch, on):
    monkeypatch.setenv(rt.CAPABILITY_DENY_ENV, "Ternary, for")
    rep = rt.admitted_capabilities()
    assert "ternary" not in rep["admitted"] and "for" not in rep["admitted"]
    assert sorted(rep["denied"]) == ["for", "ternary"]
    assert rt.capability_admitted(MEMBER_COPY) == (False, ["ternary"])


def test_A3_no_variable_adds_a_capability(monkeypatch, on):
    base = set(rt.admitted_capabilities()["admitted"])
    for env in (rt.CAPABILITY_DENY_ENV, rt.ALLOW_ENV, rt.KILL_ENV, "PINE_RUNTIME_CAPABILITY_ALLOW",
                "PINE_RUNTIME_CAPABILITY_ADMIT"):
        monkeypatch.setenv(env, "udt,while,obj:table,conditional-ta," + "a" * 64)
        assert set(rt.admitted_capabilities()["admitted"]) <= base, env
        assert not rt.capability_admitted(UNADMITTED_SCRIPT)[0], env
        monkeypatch.delenv(env)


# ═══ A4 — the kill list is asked first, everywhere ═════════════════════════════

def test_A4_a_killed_member_copy_is_refused_at_every_door(store, monkeypatch, on):
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.KILL_ENV, rt.source_hash(MEMBER_COPY)[:16])
    assert rt.capability_admitted(MEMBER_COPY)[0]                  # admitted by capability ...
    assert rt.runtime_admission(MEMBER_COPY)["admitted"] is False   # ... and refused by the kill
    row = {"def_id": ADX["id"], "definition": member_doc()}
    assert "kill list" in rt.stamp_served(row)["definition"]["meta"]["runtimeKilled"]
    with pytest.raises(ValueError, match="kill list"):
        svc.save(USER, ADX["id"], member_doc(), role="admin")


# ═══ A5 — a bad JSON admits nothing ════════════════════════════════════════════

@pytest.mark.parametrize("mutate", [
    lambda d: "{ not json",
    lambda d: "[]",
    lambda d: dict(d, capabilities=list(d["capabilities"])),
    lambda d: dict(d, capabilities="core,reassign,ternary"),
    lambda d: {k: v for k, v in d.items() if k != "capabilities"},
    lambda d: dict(d, capabilities={k: dict(v, evidence=[e["capture"] for e in v["evidence"]])
                                    if isinstance(v.get("evidence"), list) and v["evidence"]
                                    and isinstance(v["evidence"][0], dict) else v
                                    for k, v in d["capabilities"].items()}),
])
def test_A5_a_bad_registry_admits_nothing(tmp_path, monkeypatch, on, mutate):
    _registry_file(tmp_path, monkeypatch, mutate)
    assert rt.admitted_capabilities()["admitted"] == []
    assert rt.capability_admitted(MEMBER_COPY)[0] is False
    assert rt.not_graded(MEMBER_COPY)


def test_A5_a_missing_file_admits_nothing(monkeypatch, on, tmp_path):
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(tmp_path / "gone.json"))
    assert rt.admitted_capabilities()["admitted"] == []
    assert rt.not_graded(MEMBER_COPY)


# ═══ A7 — an object family needs objects v2 MATCH with the run drawing ═════════

OBJ_EV2 = [dict(e, objectsV2="MATCH", objectsLane="runtime", objectsPaired=12) for e in EV2]


def test_A7_an_object_family_without_v2_run_evidence_is_not_admitted():
    assert rg.pine_capability_admission("obj:line", ROW)
    half = [OBJ_EV2[0], dict(EV2[1], objectsV2="MATCH", objectsPaired=12)]
    assert rg.pine_capability_admission("obj:line", dict(ROW, evidence=half))
    host = [dict(e, objectsLane="host") for e in OBJ_EV2]
    assert rg.pine_capability_admission("obj:line", dict(ROW, evidence=host))
    v1_only = [dict(e, objectsV2="INCONCLUSIVE") for e in OBJ_EV2]
    assert rg.pine_capability_admission("obj:line", dict(ROW, evidence=v1_only))


@pytest.mark.parametrize("paired", [None, 0, -1, True, "12", 1.5])
def test_A7_a_capture_that_paired_nothing_is_not_evidence(paired):
    """U1: objects v2 MATCH over NO paired record compared nothing (`objectsV2.pairedNothing`)."""
    ev = [OBJ_EV2[0], {k: v for k, v in OBJ_EV2[1].items() if k != "objectsPaired"}]
    if paired is not None:
        ev[1]["objectsPaired"] = paired
    reasons = rg.pine_capability_admission("obj:line", dict(ROW, evidence=ev))
    assert reasons and any("records paired" in r for r in reasons), reasons


def test_A7_control_with_v2_run_evidence_it_would_admit():
    assert rg.pine_capability_admission("obj:line", dict(ROW, evidence=OBJ_EV2)) == []


def test_A7_probe_only_object_evidence_is_not_admitted():
    """U1 mutant 'a family admitted on probe-only evidence': two probe families, objects v2 MATCH."""
    probes = [dict(e, community=False) for e in OBJ_EV2]
    reasons = rg.pine_capability_admission("obj:line", dict(ROW, evidence=probes))
    assert reasons and any("no community script" in r for r in reasons), reasons


def test_A7_an_x_grade_that_DIVERGES_vetoes_the_family():
    """Coordinator ruling 2026-11-15: one x DIVERGE (U13) and the family is not admitted, even
    with otherwise sufficient evidence, and even on an entry that would not count."""
    veto = OBJ_EV2 + [dict(OBJ_EV2[0], capture="c-3", objectsX="DIVERGE")]
    reasons = rg.pine_capability_admission("obj:line", dict(ROW, evidence=veto))
    assert reasons and any("x grade that DIVERGES (c-3)" in r for r in reasons), reasons
    uncounted = OBJ_EV2 + [{"capture": "c-4", "objectsX": "DIVERGE"}]
    assert rg.pine_capability_admission("obj:line", dict(ROW, evidence=uncounted))
    # CONTROL: an x MATCH or INCONCLUSIVE is recorded and admits
    for x in ("MATCH", "INCONCLUSIVE"):
        ok = [dict(OBJ_EV2[0], objectsX=x), OBJ_EV2[1]]
        assert rg.pine_capability_admission("obj:line", dict(ROW, evidence=ok)) == [], x


#: U1 (2026-11-15): the object families admitted on objects v2 runtime-on evidence (y graded, G1).
U1_OBJECT_FAMILIES = ["obj:collection", "obj:delete", "obj:label", "obj:line"]
#: U3 (2026-11-15): two more object operations met the rule on S1's community scripts.
U3_OBJECT_FAMILIES = ["obj:getter"]   # obj:linefill withdrawn in U3b; back in LF (LF_OBJECT_FAMILIES)
#: DRAW-1 (2026-11-16): table.* met the rule on two community scripts drawn by the run.
DRAW1_OBJECT_FAMILIES = ["obj:table", "obj:box"]
#: PARITY UNIT LF step 3 (2026-11-18): linefill.* met the rule on two community scripts drawn by their runs.
LF_OBJECT_FAMILIES = ["obj:linefill"]


def test_A7_the_committed_object_families_are_U1s_four_and_U3s_two():
    rep = rt.admitted_capabilities()
    assert sorted(c for c in rep["admitted"] if c.startswith("obj:")) == sorted(
        U1_OBJECT_FAMILIES + U3_OBJECT_FAMILIES + DRAW1_OBJECT_FAMILIES + LF_OBJECT_FAMILIES)
    # polyline has no runtime-drawn evidence at all
    assert "obj:polyline" not in rep["admitted"]


#: ⭐ DRAW-1 (coordinator ruling 2026-11-16): obj:box was withheld on inside-bar-boxes' COUNT (vendor 52,
#: ours 50). Measured: both sides made 158 boxes (TradingView's newest id 158, ours 158), the 50 boxes both
#: hold agree on every graded field, and TradingView holds two more of the OLDEST: the batch collector
#: (`objectPool.js` C7) ran, and the reference calls the count approximate ("The count is approximate; more
#: drawings than the specified count may be displayed."). obj:box is admitted on its x-graded evidence WITH
#: a carve-out: on the runtime lane a BOX family whose collector ran in a script that reads a past value of a variable
#: holding a box (DRAW-1 GC, `objectPool.js::historyHeldOf`) is withheld by name
#: (`objects:count-at-cap`, `runtime/objectStore.js::collect`), so inside-bar-boxes' boxes are withheld,
#: never drawn at the wrong count.
OBJ_BOX_COUNT_CAPTURE = "inside-bar-boxes-rddt-1d-2026-11-14"


def test_A7_obj_box_is_admitted_with_the_count_at_cap_carve_out():
    doc = json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    assert "obj:box" in doc["capabilities"] and "obj:box" in rt.admitted_capabilities()["admitted"]
    readme = " ".join(doc["_readme"])
    assert "objects:count-at-cap" in readme and OBJ_BOX_COUNT_CAPTURE in readme
    # the reading the carve-out rests on: TradingView holds 52 boxes at a cap of 50 (the capture, below), and the run
    # WITHHOLDS the box family by name there. ⭐ Engine 68 (#1556: count-at-cap withholds only the shape no capture
    # witnesses) — re-graded on the engine-68 tree (feat/pine-host-known-divergence), the grade no longer reads "boxes
    # count of boxes held — vendor 52, ours 50" (the engine-66 run that drew 50): our boxes are withheld by name, and
    # every other family's counts and texts agree
    r = _verdicts()[OBJ_BOX_COUNT_CAPTURE]
    o = r["objectsV2"]
    assert "our boxes are withheld by name (objects:count-at-cap" in o["reason"], o["reason"]
    assert "every other object family's counts and texts agree" in o["reason"], o["reason"]
    boxes = next(f for f in o["families"] if f["family"] == "boxes")
    assert boxes["paired"] == 0 and boxes["differing"] == 0, boxes
    cap = json.loads((ROOT / r["file"]).read_text(encoding="utf-8"))
    tv = [b["id"] for b in cap["objects"]["records"]["boxes"]]
    assert len(tv) == 52 and tv == list(range(107, 159)), tv[:3]
    # it is evidence for nothing, and the carve-out is in the run's store, named
    assert all(e["capture"] != OBJ_BOX_COUNT_CAPTURE for e in doc["capabilities"]["obj:box"]["evidence"])
    store = (ROOT / "app/src/components/chart/engine/runtime/objectStore.js").read_text(encoding="utf-8")
    assert "withhold(fam, countAtCapReason(fam, cap))" in store
    pool = (ROOT / "app/src/components/chart/engine/objectPool.js").read_text(encoding="utf-8")
    assert "COUNT_AT_CAP_GUARD = 'objects:count-at-cap'" in pool


#: PARITY UNIT LF step 3: the captures obj:linefill is admitted on, and the ones it is NOT, each for its reason.
LF3_EVIDENCE = ("fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated-rddt-1d-2026-11-15",
                "trend-targets-algoalpha-rddt-1d-2026-11-15", "trend-targets-algoalpha-rddt-1d-2026-11-17")
#: objects v2 INCONCLUSIVE: taken before the x table (U3b withdrew the row on these three)
LF3_PRE_X = ("trend-targets-algoalpha-rddt-1d-2026-10-02", "trend-targets-algoalpha-spy-1d-2026-10-02",
             "fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated-rddt-1d-2026-11-14")
#: objects v2 MATCH, but the run holds its drawings back by name on SPY (format:tick-unsettled): the HOST program draws them
LF3_HOST_DRAWN = "trend-targets-algoalpha-spy-1d-2026-11-15"


def test_LF3_obj_linefill_is_admitted_on_run_drawn_captures():
    """U3b withdrew obj:linefill (no x-graded capture); S28 / DRAW-1 kept it out (FVG Finder alone: AlgoAlpha's linefills
    were its HOST program's). PARITY UNIT LF: step 1 gives a clean host program's runtime document its RUN's drawings
    (`runtimeObjectsDoor.js` hostFallback), step 2 withholds the linefill family by name once the line collector deletes a
    filled line, and step 3 admits the row on the regenerated snapshot. Which lane draws each entry is measured by
    `vendorHarness.objLinefillEvidence.test.js`; this holds the row's shape and the captures it must not count."""
    doc = json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    row = doc["capabilities"]["obj:linefill"]
    assert rg.pine_capability_admission("obj:linefill", row) == []
    assert sorted(e["capture"] for e in row["evidence"]) == sorted(LF3_EVIDENCE)
    assert {e["script"] for e in row["evidence"]} == {"FVG Finder", "AlgoAlpha - Trend Targets"}
    assert all(e["objectsLane"] == "runtime" for e in row["evidence"])
    readme = " ".join(doc["_readme"])
    assert "obj:linefill is ADMITTED" in readme and "LINEFILL_COUNT_AT_CAP_REASON" in readme
    v = _verdicts()
    for cid in LF3_PRE_X:
        assert v[cid]["objectsV2"]["verdict"] != "MATCH", cid
    # the host-drawn SPY capture grades MATCH and is still not evidence: its objects are not the run's
    assert v[LF3_HOST_DRAWN]["objectsV2"]["verdict"] == "MATCH"
    assert LF3_HOST_DRAWN not in {e["capture"] for e in row["evidence"]}
    # the carve-out the row rests on is in the run's store, named
    store = (ROOT / "app/src/components/chart/engine/runtime/objectStore.js").read_text(encoding="utf-8")
    assert "LINEFILL_COUNT_AT_CAP_REASON" in store


#: U3b: calc-bars is HELD. Its evidence passes the count, but a window the chart never exceeds
#: witnesses nothing: the picture is the same whether calc_bars_count is honoured or ignored.
CALC_BARS_BINDING_ONLY = "wyckoff-accumulation-distribution-spy-1d-2026-10-02"


def test_U3b_calc_bars_is_held_while_one_script_runs_past_its_window():
    import re
    doc = json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    assert "calc-bars" not in doc["capabilities"]
    readme = " ".join(doc["_readme"])
    assert "calc-bars is HELD" in readme and CALC_BARS_BINDING_ONLY in readme
    # the measurement the hold rests on: Sweep Reversal Map's window is wider than both charts
    for cid in ("high_engagement__23-sweep-reversal-map-plus-herman-rddt-1d-2026-11-15",
                "high_engagement__23-sweep-reversal-map-plus-herman-spy-1d-2026-11-15",
                CALC_BARS_BINDING_ONLY):
        cap = json.loads((ROOT / _verdicts()[cid]["file"]).read_text(encoding="utf-8"))
        window = int(re.search(r"calc_bars_count\s*=\s*(\d+)", cap["source"]["text"]).group(1))
        binding = window < len(cap["bars"]["rows"])
        assert binding is (cid == CALC_BARS_BINDING_ONLY), (cid, window, len(cap["bars"]["rows"]))


def test_A7_a_box_drawing_member_script_is_withheld(on):
    # (DRAW-1: obj:box is admitted; the unadmitted object family here was linefill until PARITY UNIT LF, now polyline)
    src = MEMBER_COPY + POLYLINE_SNIPPET
    ok, missing = rt.capability_admitted(src)
    assert not ok and missing == ["obj:polyline"], missing


def test_A7_an_object_drawing_member_script_is_withheld_while_its_family_is(on, monkeypatch):
    monkeypatch.setattr(rt, "DETECTOR_DUTY_CYCLE", 1.0)   # two fresh runs; a policy rail, not the cool-down
    src = MEMBER_COPY + POLYLINE_SNIPPET
    ok, missing = rt.capability_admitted(src)
    assert not ok and "obj:polyline" in missing
    # CONTROL: a line drawing alone now admits (U1), a table (DRAW-1), and a linefill (PARITY UNIT LF)
    assert rt.capability_admitted(MEMBER_COPY + LINEFILL_SNIPPET) == (True, [])
    line = MEMBER_COPY + "var line l = na\nl := line.new(bar_index, low, bar_index, high)\n"
    assert rt.capability_admitted(line) == (True, [])
    table = MEMBER_COPY + "var table t = table.new(position.top_right, 1, 1)\n"
    assert rt.capability_admitted(table) == (True, [])


# ═══ G6 — realtime-state admits for CLOSED-BAR HISTORY only (ruling 2026-11-15) ══

RT_SCRIPT = MEMBER_COPY + "plot(barstate.isconfirmed ? close : open)" + chr(10)


def _with_realtime_row(tmp_path, monkeypatch, **extra):
    def add(doc):
        doc["capabilities"]["realtime-state"] = dict(ROW, **extra)
        return doc
    _registry_file(tmp_path, monkeypatch, add)


def test_G6_realtime_state_without_the_closed_bar_scope_is_not_admitted():
    for row in (ROW, dict(ROW, scope="all-bars"), dict(ROW, scope=None)):
        reasons = rg.pine_capability_admission("realtime-state", row)
        assert reasons and any("closed-bar-history" in r for r in reasons), reasons
    assert rg.pine_capability_admission("realtime-state", dict(ROW, scope="closed-bar-history")) == []
    # CONTROL: the scope is asked of the forming-ungraded ids only
    assert rg.pine_capability_admission("for", ROW) == []
    assert not rg.pine_capability_history_only("for", dict(ROW, scope="closed-bar-history"))


def test_G6_the_admitted_set_names_it_history_only(tmp_path, monkeypatch):
    _with_realtime_row(tmp_path, monkeypatch, scope="closed-bar-history")
    rep = rt.admitted_capabilities()
    # (2026-11-19) request-other is admitted for closed-bar history too (admit:request-other, G6)
    assert "realtime-state" in rep["admitted"] and rep["historyOnly"] == ["realtime-state", "request-other"]


def test_G6_the_door_answers_history_only_for_a_script_that_reads_bar_state(tmp_path, monkeypatch, store, on):
    _with_realtime_row(tmp_path, monkeypatch, scope="closed-bar-history")
    assert "realtime-state" in pc.capabilities_of(RT_SCRIPT)
    body = _client().post("/api/user-definitions/runtime-admission", json={"source": RT_SCRIPT}).json()
    assert body == {"sha256": rt.source_hash(RT_SCRIPT), "admitted": True, "missing": [],
                    "historyOnly": ["realtime-state"]}
    # CONTROL: a script that reads no bar state carries no restriction
    body = _client().post("/api/user-definitions/runtime-admission", json={"source": MEMBER_COPY}).json()
    assert body == {"sha256": rt.source_hash(MEMBER_COPY), "admitted": True, "missing": []}


def test_G6_a_set_that_cannot_be_re_read_is_not_admitted(tmp_path, monkeypatch, store, on):
    """FAIL CLOSED: the second read of the capability set fails -> pending, never admitted."""
    _with_realtime_row(tmp_path, monkeypatch, scope="closed-bar-history")
    calls = []
    real = rt.capabilities_for

    def flaky(source, **kw):
        calls.append(1)
        return real(source, **kw) if len(calls) == 1 else None
    monkeypatch.setattr(rt, "capabilities_for", flaky)
    got = rt.runtime_admission(RT_SCRIPT, member="u-x")
    assert got["admitted"] is False and got["missing"] == [rt.PENDING]


def test_G6_without_the_scope_the_door_withholds_it(tmp_path, monkeypatch, store, on):
    _with_realtime_row(tmp_path, monkeypatch)
    body = _client().post("/api/user-definitions/runtime-admission", json={"source": RT_SCRIPT}).json()
    assert body["admitted"] is False and "realtime-state" in body["missing"] and "historyOnly" not in body


# ═══ G6-VARIP — varip admits for CLOSED-BAR HISTORY only (coordinator ruling 2026-11-18) ══
# On a closed historical bar a `varip` is a `var`; it differs only within a FORMING bar, and no
# capture grades that. So any `varip` row needs `scope: closed-bar-history`, exactly as
# realtime-state does. No varip row is in the registry yet (it needs Q-VARIP-1 / Q-VARIP-2).

VARIP_SCRIPT = MEMBER_COPY + "varip int vipCount = 0" + chr(10) + "vipCount += 1" + chr(10)


def _with_varip_row(tmp_path, monkeypatch, **extra):
    def add(doc):
        doc["capabilities"]["varip"] = dict(ROW, **extra)
        return doc
    _registry_file(tmp_path, monkeypatch, add)


def test_G6_varip_without_the_closed_bar_scope_is_not_admitted():
    assert "varip" in rg.PINE_CAPABILITY_FORMING_UNGRADED
    for row in (ROW, dict(ROW, scope="all-bars"), dict(ROW, scope=None)):
        reasons = rg.pine_capability_admission("varip", row)
        assert reasons and any("closed-bar-history" in r for r in reasons), reasons
        assert not rg.pine_capability_history_only("varip", row)
    assert rg.pine_capability_admission("varip", dict(ROW, scope="closed-bar-history")) == []
    assert rg.pine_capability_history_only("varip", dict(ROW, scope="closed-bar-history"))


def test_G6_varip_the_committed_registry_holds_no_varip_row():
    doc = json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    assert "varip" not in doc["capabilities"]


def test_G6_varip_the_door_answers_history_only_with_the_scope(tmp_path, monkeypatch, store, on):
    _with_varip_row(tmp_path, monkeypatch, scope="closed-bar-history")
    caps = pc.capabilities_of(VARIP_SCRIPT)
    assert "varip" in caps and "realtime-state" not in caps, caps   # varip alone carries the rule here
    rep = rt.admitted_capabilities()
    assert "varip" in rep["admitted"] and "varip" in rep["historyOnly"]
    body = _client().post("/api/user-definitions/runtime-admission", json={"source": VARIP_SCRIPT}).json()
    assert body == {"sha256": rt.source_hash(VARIP_SCRIPT), "admitted": True, "missing": [],
                    "historyOnly": ["varip"]}


def test_G6_varip_without_the_scope_the_door_withholds_it(tmp_path, monkeypatch, store, on):
    _with_varip_row(tmp_path, monkeypatch)
    body = _client().post("/api/user-definitions/runtime-admission", json={"source": VARIP_SCRIPT}).json()
    assert body["admitted"] is False and "varip" in body["missing"] and "historyOnly" not in body


# ═══ A8 — every evidence id is a real capture graded MATCH, drawn by the run ═══

def _verdicts():
    return {r["id"]: r for r in json.loads(VERDICTS_RT.read_text(encoding="utf-8"))["results"]}


def _phantoms(registry: dict) -> list:
    v = _verdicts()
    bad = []
    for cap, row in registry.items():
        if not isinstance(row, dict) or row.get("admitted") is not True:
            continue
        for e in row["evidence"]:
            cid = e.get("capture")
            r = v.get(cid)
            if r is None:
                bad.append((cap, cid, "no such capture in the runtime-on verdicts"))
                continue
            if r["verdict"] != "MATCH":
                bad.append((cap, cid, f"runtime-on verdict is {r['verdict']}"))
            family, community = rg.pine_evidence_script(r.get("script"), cid)
            if e.get("script") != family:
                bad.append((cap, cid, "names another script"))
            if e.get("community") is not community:
                bad.append((cap, cid, "states the wrong community flag"))
            # ⭐ STORE-HELD (libraries chain, 2026-11-19): a library row's evidence row must have been GRADED WITH that
            # version at the sha the row pins (the snapshot row's `storeHeld`); a row graded without it drew nothing
            if cap.startswith(rg.PINE_CAPABILITY_LIBRARY_PREFIX):
                want = store_held.pin_of(cap[len(rg.PINE_CAPABILITY_LIBRARY_PREFIX):], row.get("sha256") or "")
                if want not in store_held.pins_of(r):
                    bad.append((cap, cid, "its snapshot row was not graded with that library version at the row's sha"))
            fixture = licence_held.fixture_path(r["file"])
            if fixture is None or not fixture.is_file():
                bad.append((cap, cid, "no fixture"))
                continue
            text = (json.loads(fixture.read_text(encoding="utf-8")).get("source") or {}).get("text")
            if cap not in pc.capabilities_of(text):
                bad.append((cap, cid, "the capture's script does not use it"))
            if cap.startswith(rg.PINE_CAPABILITY_OBJECT_PREFIX):
                bad += [(cap, cid, why) for why in _object_evidence_problems(cap, e, r)]
                sha = rt.source_hash(text)
                if sha in _x_vetoed_sources():
                    bad.append((cap, cid, "its script has a capture whose x DIVERGES"))
                if sha in rt.committed_kills():
                    bad.append((cap, cid, "its script is on the kill list"))
    return bad


def _x_vetoed_sources() -> set:
    """Coordinator ruling 2026-11-15: ONE capture whose x DIVERGES vetoes its SCRIPT (by source sha256)
    as evidence for every object family: the same source draws the same way on every chart."""
    out = set()
    for r in _verdicts().values():
        if _x_verdict(r.get("objectsV2") or {}) != "DIVERGE":
            continue
        at = licence_held.fixture_path(r["file"])
        try:
            text = (json.loads((at or ROOT / r["file"]).read_text(encoding="utf-8")).get("source") or {}).get("text")
        except (OSError, ValueError):
            continue
        if isinstance(text, str):
            out.add(rt.source_hash(text))
    return out


#: The objects v2 family whose OWN paired records witness an object capability; the operations
#: (delete, collection, getter) are witnessed by every paired record of the capture.
OBJECT_FAMILY_OF = {"obj:line": "lines", "obj:label": "labels", "obj:box": "boxes", "obj:table": "tables",
                    "obj:linefill": "linefills"}


def _object_evidence_problems(cap: str, e: dict, r: dict) -> list:
    """An `obj:*` evidence entry's objects claims, held to the committed runtime-on verdict: objects v2
    MATCH, records paired (never `pairedNothing`), the count it states, and any x grade it records
    (`objectsX`) held to the committed x-grade record (U13)."""
    out = []
    o = r.get("objectsV2") or {}
    if e.get("objectsV2") != o.get("verdict") or o.get("verdict") != "MATCH":
        out.append("its objects v2 grade is not a runtime-on MATCH")
    if o.get("pairedNothing") is not False:
        out.append("its objects v2 MATCH paired nothing")
    by = {f["family"]: f.get("paired") or 0 for f in o.get("families") or []}
    want = by.get(OBJECT_FAMILY_OF[cap], 0) if cap in OBJECT_FAMILY_OF else sum(by.values())
    if e.get("objectsPaired") != want or not want:
        out.append(f"states {e.get('objectsPaired')} paired records; the verdict pairs {want}")
    # U3b: since U13 (#1335) the verdict grades x itself; an entry's objectsX IS that verdict's x answer
    if e.get("objectsX") != _x_verdict(o):
        out.append(f"states x {e.get('objectsX')}; the verdict's x is {_x_verdict(o)}")
    return out


def _x_verdict(o: dict):
    """The x answer of one objects v2 grade: DIVERGE on any x difference, MATCH when x was graded and
    nothing was missing, INCONCLUSIVE when some x could not be graded, None when none was."""
    x = o.get("x") or {}
    if not x.get("graded"):
        return None
    return "DIVERGE" if x.get("differing") else ("INCONCLUSIVE" if x.get("missing") else "MATCH")


# ═══ RT1 — the committed kill list (2026-11-15) ════════════════════════════════

KILL_DOC = ROOT / "api" / "data" / "pine_runtime_killlist.json"


def _kill_entry_problems(s: dict, v: dict, today: datetime.date | None = None) -> list:
    """Why one kill entry is not held to its graded evidence: a committed capture of THAT source whose
    runtime-on grade is not MATCH, a reason in the member's words, and the condition that lifts it."""
    out = []
    ev = s.get("evidence") or {}
    r = v.get(ev.get("capture"))
    if r is None:
        return [f"{s.get('slug')}: names no committed capture"]
    if not (r["verdict"] == ev.get("verdict") != "MATCH"):
        out.append(f"{s.get('slug')}: its capture grades {r['verdict']}, the entry says {ev.get('verdict')}")
    text = json.loads((ROOT / r["file"]).read_text(encoding="utf-8"))["source"]["text"]
    if rt.source_hash(text) != s.get("sha256"):
        out.append(f"{s.get('slug')}: its capture is another source")
    src = ROOT / str(s.get("source"))
    if not src.is_file() or rt.source_hash(src.read_text(encoding="utf-8")) != s.get("sha256"):
        out.append(f"{s.get('slug')}: its source file is another source")
    if not (s.get("reason") and s.get("liftWhen")):
        out.append(f"{s.get('slug')}: no reason or no liftWhen")
    # ⭐ (2026-11-18) a HELD kill carries a hard expiry, and is red on its own once past it
    if s.get("status") == rt.KILL_PENDING:
        out.extend(_held_kill_expiry_problems(s, today))
    elif s.get("status") is not None:
        out.append(f"{s.get('slug')}: status {s.get('status')!r} is not a status this list knows")
    return out


def _held_kill_expiry_problems(s: dict, today: datetime.date | None = None) -> list:
    """A held kill (`status: pending`) names an ISO `expires` date, and today is not past it."""
    today = today or datetime.date.today()
    try:
        expires = datetime.date.fromisoformat(str(s.get("expires")))
    except ValueError:
        return [f"{s.get('slug')}: a held kill with no readable `expires` date"]
    if today > expires:
        return [f"{s.get('slug')}: a held kill past its expiry ({expires.isoformat()}): serve the kill or lift it"]
    return []


def held_kill_captures(rt_verdicts: dict, today: datetime.date | None = None) -> dict:
    """The REACH stops a held kill may carry: ``{capture: slug}`` for each `status: pending` entry of the committed
    kill list (`rt.pending_kills`, the one authority) that is not past its expiry and whose named capture's
    runtime-on record grades what the entry says (DIVERGE). Nothing else is ever accepted this way."""
    recs = {r["id"]: r for r in rt_verdicts["results"]}
    out = {}
    for s in rt.pending_kills().values():
        ev = s.get("evidence") or {}
        r = recs.get(ev.get("capture"))
        if _held_kill_expiry_problems(s, today) or r is None or r["verdict"] != ev.get("verdict") or ev.get("verdict") != "DIVERGE":
            continue
        out[ev["capture"]] = s.get("slug")
    return out


def test_RT1_every_committed_kill_is_held_to_its_graded_evidence():
    """Each entry names a committed capture of THAT source whose runtime-on grade is not MATCH, a reason
    in the member's words, and the condition that lifts it. 2026-11-16: the list is EMPTY (parabolic-sar
    lifted, below), which is a valid state; the rule is shown able to fail on a synthetic entry."""
    doc = json.loads(KILL_DOC.read_text(encoding="utf-8"))
    assert isinstance(doc["scripts"], list) and doc["_readme"]
    v = _verdicts()
    for s in doc["scripts"]:
        assert _kill_entry_problems(s, v) == [], s["slug"]
        if s.get("status") == rt.KILL_PENDING:
            # a HELD kill is recorded, never served: the script still draws
            assert s["sha256"] not in rt.kill_list() and s["sha256"] in rt.pending_kills(), s["slug"]
        else:
            assert s["sha256"] in rt.kill_list()
    # CONTROL: an entry whose capture grades MATCH (the lifted parabolic-sar entry, as it stood) is red;
    # the same entry on a capture that DIVERGES is green
    src = SYNTHETIC_KILL_SOURCE.read_text(encoding="utf-8")
    entry = {"slug": "synthetic-subject", "sha256": rt.source_hash(src),
             "source": "corpus/committed/parabolic-sar__xoeoPMOWGJ.pine", "reason": "SYNTHETIC",
             "liftWhen": "SYNTHETIC", "evidence": {"capture": "parabolic-sar-spy-1d-2026-11-15", "verdict": "DIVERGE"}}
    assert any("grades MATCH" in p for p in _kill_entry_problems(entry, v))
    moved = copy.deepcopy(v)
    moved["parabolic-sar-spy-1d-2026-11-15"]["verdict"] = "DIVERGE"
    assert _kill_entry_problems(entry, moved) == []
    # CONTROL (2026-11-18): the same entry HELD is green until its expiry, red the day after, red with no date
    held = dict(entry, status=rt.KILL_PENDING, expires="2026-11-21")
    assert _kill_entry_problems(held, moved, today=datetime.date(2026, 11, 21)) == []
    assert any("past its expiry" in p for p in _kill_entry_problems(held, moved, today=datetime.date(2026, 11, 22)))
    assert any("no readable `expires`" in p for p in _kill_entry_problems(dict(held, expires=None), moved))
    assert any("not a status" in p for p in _kill_entry_problems(dict(entry, status="paused"), moved))


#: The by-name rails need a killed script, and the committed kill list is empty since parabolic-sar's kill
#: was lifted (2026-11-16). They kill a REAL source through a SYNTHETIC entry in a tmp kill list, so they
#: still prove "a killed script is refused by name at every door" without depending on a real kill.
SYNTHETIC_KILL_SOURCE = ROOT / "corpus" / "committed" / "parabolic-sar__xoeoPMOWGJ.pine"
SYNTHETIC_KILL_REASON = "SYNTHETIC kill for the by-name rails (no real kill is on the committed list)"


def synthetic_kill(tmp_path, monkeypatch) -> str:
    """Point the committed kill list at a tmp file killing SYNTHETIC_KILL_SOURCE; returns the source."""
    src = SYNTHETIC_KILL_SOURCE.read_text(encoding="utf-8")
    doc = {"_readme": ["tmp, synthetic"], "scripts": [{
        "slug": "synthetic-subject", "sha256": rt.source_hash(src), "source": str(SYNTHETIC_KILL_SOURCE),
        "reason": SYNTHETIC_KILL_REASON, "liftWhen": "never: a tmp file", "evidence": {}}]}
    f = tmp_path / "synthetic-killlist.json"
    f.write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setattr(rt, "KILLLIST_PATH", str(f))
    return src


def test_RT1_a_killed_script_is_refused_by_name_at_every_door(store, monkeypatch, on, tmp_path):
    src = SYNTHETIC_KILL_SOURCE.read_text(encoding="utf-8")
    # CONTROL first: on the committed (empty) list the same script is admitted (every capability it uses
    # is), and the served kill list does not hold it
    assert not rt.killed(None, src)
    assert pc.capabilities_of(src) <= set(rt.admitted_capabilities()["admitted"])
    assert rt.runtime_admission(src, member="u-x")["admitted"] is True
    assert rt.source_hash(src) not in _client().get("/api/user-definitions/runtime-kill").json()["kill"]
    # killed through the synthetic entry: refused by name at the verdict door, the served list and `killed`
    synthetic_kill(tmp_path, monkeypatch)
    why = rt.killed(None, src)
    assert why and SYNTHETIC_KILL_REASON in why, why
    assert rt.runtime_admission(src, member="u-x")["admitted"] is False
    body = _client().get("/api/user-definitions/runtime-kill").json()
    assert rt.source_hash(src) in body["kill"]


#: 2026-11-16 -- the parabolic-sar kill (s28: a label "654.4" where TradingView prints "654.41") is LIFTED
#: on its own `liftWhen` ("then a runtime-on re-grade to MATCH on RDDT and SPY"): the engine fix writes
#: `math.round_to_mintick`'s tick count as `x * (1 / syminfo.mintick)` (`ast/tickRound.js`).
PARABOLIC_SAR_LIFT = ("parabolic-sar-rddt-1d-2026-11-15", "parabolic-sar-spy-1d-2026-11-15")


def test_RT1_the_parabolic_sar_kill_is_lifted_on_its_own_condition():
    src = SYNTHETIC_KILL_SOURCE.read_text(encoding="utf-8")
    assert rt.source_hash(src) not in rt.committed_kills() and not rt.killed(None, src)
    v = _verdicts()
    for cid in PARABOLIC_SAR_LIFT:
        r = v[cid]
        text = json.loads((ROOT / r["file"]).read_text(encoding="utf-8"))["source"]["text"]
        assert rt.source_hash(text) == rt.source_hash(src), cid
        assert r["verdict"] == "MATCH" and r["objects"]["verdict"] == "MATCH", cid
        texts = next(t for t in r["objects"]["texts"] if t["family"] == "labels text")
        assert texts["agree"] is True and texts["onlyVendor"] == [] and texts["onlyOurs"] == [], cid
        o = r["objectsV2"]
        assert o["verdict"] == "MATCH" and o["pairedNothing"] is False, cid
    # the label that held the kill: TradingView printed "654.41" (no label text differs on SPY now)
    spy = json.loads((ROOT / v[PARABOLIC_SAR_LIFT[1]]["file"]).read_text(encoding="utf-8"))
    assert "654.41" in spy["objects"]["texts"]["labels"]
    # ...and lifting the kill ADMITS it: every capability it uses is admitted
    assert pc.capabilities_of(src) <= set(rt.admitted_capabilities()["admitted"])


#: The trend-targets kill (s28: its latest trade's lines on the wrong bar, x1 656 vs 653) was LIFTED by the
#: engine fix of PR #1374 (the runtime document's host object program carries the Pine tree stamps): its
#: `liftWhen` was "an engine fix, then a runtime-on re-grade to MATCH on RDDT and SPY".
TREND_TARGETS_LIFT = ("trend-targets-algoalpha-rddt-1d-2026-11-15", "trend-targets-algoalpha-spy-1d-2026-11-15")


def test_RT1_the_trend_targets_kill_is_lifted_on_its_own_condition():
    src = (ROOT / "corpus" / "committed" / "trend-targets-algoalpha__92ff5628d7.pine").read_text(encoding="utf-8")
    assert rt.source_hash(src) not in rt.committed_kills() and not rt.killed(None, src)
    v = _verdicts()
    for cid in TREND_TARGETS_LIFT:
        r = v[cid]
        text = json.loads((ROOT / r["file"]).read_text(encoding="utf-8"))["source"]["text"]
        assert rt.source_hash(text) == rt.source_hash(src), cid
        o = r["objectsV2"]
        assert r["verdict"] == "MATCH" and o["verdict"] == "MATCH" and o["pairedNothing"] is False, cid
        assert _x_verdict(o) == "MATCH" and o["x"]["graded"] == 15, (cid, o["x"])
    # ...and since PARITY UNIT LF admitted obj:linefill, its last unadmitted capability (conditional-ta came with
    # COND-TA), the script is admitted by capability: REACH holds every capture of it the runtime lane draws to no
    # DIVERGE (test_REACH_no_runtime_lane_DIVERGE_and_no_MATCH_to_DIVERGE). (Until LF: "lifting the kill admits nothing".)
    assert pc.capabilities_of(src) <= set(rt.admitted_capabilities()["admitted"])
    assert "obj:linefill" in pc.capabilities_of(src)


#: ⭐ DRAW-1 (2026-11-16, coordinator ruling): admitting obj:box and obj:table makes scripts servable on
#: capability evidence alone. Every script that uses either family, is admitted, and has a committed
#: capture grading DIVERGE on EITHER lane is on the committed kill list until its own `liftWhen`.
DRAW1_NEW_OBJECT_FAMILIES = {"obj:box", "obj:table"}
#: (contraction-box-doji-lines was the eighth: lifted on its own condition, below.)
DRAW1_KILLED_SLUGS = {"heat-map-seasons", "htf-candle-footprint-cartel-console",
                      "sonarlab-order-blocks", "vw-object-gc-a", "vw-object-gc-b", "vw-object-gc-c"}


#: The contraction-box-doji-lines kill (DRAW-1: SPY daily held one line more than TradingView, 205 vs 204 and 201 vs
#: 200) was LIFTED by engine 78 (#1858) (Pine's tolerant compare, #1858): the extra line was a near-tie comparison,
#: not the collector. Its `liftWhen` was "an engine fix to the line count, then a runtime-on re-grade to MATCH on
#: -spy-1d-2026-10-03 and -2026-11-15"; both re-graded MATCH in #1858's own pine-heavy run 44319610649.
CONTRACTION_LIFT = ("contraction-box-doji-lines-spy-1d-2026-10-03", "contraction-box-doji-lines-spy-1d-2026-11-15")


def test_RT1_the_contraction_box_kill_is_lifted_on_its_own_condition():
    src = (ROOT / "corpus" / "committed" / "contraction-box-doji-lines__1486658151.pine").read_text(encoding="utf-8")
    assert rt.source_hash(src) not in rt.committed_kills() and not rt.killed(None, src)
    v = _verdicts()
    for cid in CONTRACTION_LIFT:
        r = v[cid]
        text = json.loads((ROOT / r["file"]).read_text(encoding="utf-8"))["source"]["text"]
        assert rt.source_hash(text) == rt.source_hash(src), cid
        assert r["verdict"] == "MATCH" and r["objects"]["verdict"] == "MATCH", cid
        # the count that held the kill: every family's count agrees, lines included
        counts = {c["family"]: c for c in r["objects"]["counts"]}
        assert counts["lines"]["agree"] is True and counts["lines"]["vendor"] == counts["lines"]["ours"], cid
        assert all(c["agree"] for c in counts.values()), cid
        o = r["objectsV2"]
        # every paired record agrees field by field; x is not witnessed everywhere (a capture taken before U13,
        # or TradingView's off-chart timepoint), which is INCONCLUSIVE by name and never a difference
        assert o["verdictWithoutX"] == "MATCH" and o["pairedNothing"] is False and not o["x"]["differing"], cid
    # ...and the production lane's re-grade lifted its host known-divergence entry the same way
    from api.services import host_known_divergence as hkd
    assert hkd.refused(src) is None and rt.source_hash(src) not in hkd.committed()


def _draw1_unkilled_diverging(kills: dict) -> list:
    """Sources using obj:box / obj:table, admitted on capabilities, with a committed capture grading DIVERGE on
    either lane, whose sha256 is not in `kills`."""
    admitted = set(rt.admitted_capabilities()["admitted"])
    lanes = [json.loads(VERDICTS_RT.read_text(encoding="utf-8"))["results"],
             json.loads((ROOT / "docs" / "pine" / "vendor-harness" / "production" / "verdicts.json")
                        .read_text(encoding="utf-8"))["results"]]
    out = set()
    for results in lanes:
        for r in results:
            if r.get("verdict") != "DIVERGE":
                continue
            at = licence_held.fixture_path(r["file"])
            try:
                text = (json.loads((at or ROOT / r["file"]).read_text(encoding="utf-8")).get("source") or {}).get("text")
            except (OSError, ValueError):
                continue
            if not isinstance(text, str):
                continue
            caps = pc.capabilities_of(text)
            if caps & DRAW1_NEW_OBJECT_FAMILIES and caps <= admitted and rt.source_hash(text) not in kills:
                out.add((r["id"], rt.source_hash(text)))
    return sorted(out)


def test_DRAW1_every_newly_admitted_object_script_with_a_DIVERGE_capture_is_killed():
    kills = rt.committed_kills()
    assert _draw1_unkilled_diverging(kills) == []
    doc = json.loads(KILL_DOC.read_text(encoding="utf-8"))
    assert {s["slug"] for s in doc["scripts"]} >= DRAW1_KILLED_SLUGS
    # CONTROL: without the DRAW-1 entries the same scan names every one of their sources
    draw1 = {s["sha256"] for s in doc["scripts"] if s["slug"] in DRAW1_KILLED_SLUGS}
    named = {sha for _cid, sha in _draw1_unkilled_diverging({k: v for k, v in kills.items() if k not in draw1})}
    assert named == draw1, (named, draw1)


#: ⭐⭐ admit:request-other (coordinator ruling 2026-11-19): admitting `request-other` admits every source whose only missing
#: capability it was. Each one with a committed capture grading DIVERGE on either lane is on the committed kill list (the
#: DRAW-1 rule), by its sha, except rs-rating-fred6724, which is served through its own sha allowlist entry and is NOT
#: killed (SERVED_BY_OWN_SHA names its differences).
REQUEST_OTHER_KILLED_SLUGS = {"artemis-oscillator-pro", "average-day-range-adr-pivots",
                              "dual-view-htf-candlestick-patterns-theultimator5", "ema-ribbon-trend-filter-strixedge",
                              "htf-liquidity-dashboard-tfo", "pmax-explorer", "position-size-calc",
                              "request-realtime-alignment", "rs-seed-rsrating", "vold-market-breadth", "vw-other-symbol"}


def _request_other_unkilled_diverging(kills: dict) -> list:
    """Sources using request-other, admitted on capabilities, with a committed capture grading DIVERGE on either lane,
    whose sha256 is neither in `kills` nor served through its own sha allowlist entry."""
    admitted = set(rt.admitted_capabilities()["admitted"])
    own = _allowlisted_shas()
    lanes = [json.loads(VERDICTS_RT.read_text(encoding="utf-8"))["results"],
             json.loads(VERDICTS_PROD.read_text(encoding="utf-8"))["results"]]
    out = set()
    for results in lanes:
        for r in results:
            if r.get("verdict") != "DIVERGE":
                continue
            at = licence_held.fixture_path(r["file"])
            try:
                text = (json.loads((at or ROOT / r["file"]).read_text(encoding="utf-8")).get("source") or {}).get("text")
            except (OSError, ValueError):
                continue
            if not isinstance(text, str):
                continue
            caps = pc.capabilities_of(text)
            sha = rt.source_hash(text)
            if "request-other" in caps and caps <= admitted and sha not in kills and sha not in own:
                out.add((r["id"], sha))
    return sorted(out)


def test_REQOTHER_every_newly_admitted_request_script_with_a_DIVERGE_capture_is_killed():
    assert "request-other" in rt.admitted_capabilities()["admitted"]
    kills = rt.committed_kills()
    assert _request_other_unkilled_diverging(kills) == []
    doc = json.loads(KILL_DOC.read_text(encoding="utf-8"))
    assert {s["slug"] for s in doc["scripts"]} >= REQUEST_OTHER_KILLED_SLUGS
    # CONTROL: without those entries the same scan names exactly their sources
    mine = {s["sha256"] for s in doc["scripts"] if s["slug"] in REQUEST_OTHER_KILLED_SLUGS}
    named = {sha for _cid, sha in _request_other_unkilled_diverging({k: v for k, v in kills.items() if k not in mine})}
    assert named == mine, (named, mine)


def test_REQOTHER_rs_rating_is_served_by_its_own_sha_and_its_differences_are_re_proved():
    rtv = {r["id"]: r for r in json.loads(VERDICTS_RT.read_text(encoding="utf-8"))["results"]}
    src = (ROOT / "docs" / "pine" / "rs-rating" / "rs-rating-fred6724__pziQwiT2.pine").read_text(encoding="utf-8")
    assert rt.source_hash(src) in _allowlisted_shas() and rt.source_hash(src) not in rt.committed_kills()
    for cid in SERVED_BY_OWN_SHA:
        assert rtv[cid]["verdict"] == "DIVERGE" and served_by_own_sha(rtv[cid]), cid
    # CONTROL: a named capture whose PLOT diverges is no longer that shape; an unnamed DIVERGE never is
    doctored = copy.deepcopy(rtv[next(iter(SERVED_BY_OWN_SHA))])
    doctored["plots"][0]["verdict"] = "DIVERGE"
    assert not served_by_own_sha(doctored)
    other = next(r for r in rtv.values() if r["verdict"] == "DIVERGE" and r["id"] not in SERVED_BY_OWN_SHA)
    assert not served_by_own_sha(other)


def test_RT1_a_broken_committed_file_kills_nothing_extra(tmp_path, monkeypatch):
    for content in ("{ not json", "[]", '{"scripts": [{"sha256": "zz"}]}'):
        f = tmp_path / "kill.json"
        f.write_text(content, encoding="utf-8")
        monkeypatch.setattr(rt, "KILLLIST_PATH", str(f))
        assert rt.committed_kills() == {}, content
    monkeypatch.setenv(rt.KILL_ENV, "a" * 64)
    assert rt.kill_list() == ["a" * 64]


def test_A8_a_script_with_an_x_DIVERGE_capture_is_evidence_for_no_object_family(monkeypatch, tmp_path):
    """The rail can fail: parabolic-sar (killed through a SYNTHETIC entry since its real kill was lifted,
    2026-11-16) named as obj:label evidence on its RDDT capture, which on its own grades MATCH with x; and
    the same entry once ANOTHER capture of that source grades an x that DIVERGES. (Until PR #1374 the
    committed example was trend-targets, x DIVERGE on RDDT; its fix left no committed x DIVERGE, so that
    half is shown on a copy of the snapshot.)"""
    synthetic_kill(tmp_path, monkeypatch)
    v = _verdicts()
    good, other = "parabolic-sar-rddt-1d-2026-11-15", "parabolic-sar-spy-1d-2026-11-15"
    r = v[good]
    fam, comm = rg.pine_evidence_script(r["script"], good)
    o = r["objectsV2"]
    labels = next(f["paired"] for f in o["families"] if f["family"] == "labels")
    fake = {"obj:label": {"admitted": True, "evidence": [
        {"capture": good, "script": fam, "community": comm, "verdict": "MATCH", "runtimePane": "on",
         "objectsV2": "MATCH", "objectsLane": "runtime", "objectsPaired": labels, "objectsX": _x_verdict(o)}]}}
    got = {why for _c, _id, why in _phantoms(fake)}
    assert "its script is on the kill list" in got, got
    # CONTROL: as committed, no capture of that source has an x that DIVERGES
    assert "its script has a capture whose x DIVERGES" not in got, got
    moved = copy.deepcopy(v)
    x = moved[other]["objectsV2"]["x"]
    assert x["graded"] and not x["differing"]
    x["differing"], x["agreeing"] = 1, x["agreeing"] - 1
    monkeypatch.setattr(sys.modules[__name__], "_verdicts", lambda: moved)
    got = {why for _c, _id, why in _phantoms(fake)}
    assert "its script has a capture whose x DIVERGES" in got, got


def test_A8_no_phantom_evidence():
    doc = json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    assert _phantoms(doc["capabilities"]) == []
    v = _verdicts()
    assert json.loads(VERDICTS_RT.read_text(encoding="utf-8"))["lane"] == "runtime-on"
    for cap, row in doc["capabilities"].items():
        if row.get("admitted") is True:
            assert rg.pine_capability_admission(cap, row) == [], cap
            assert all(v[e["capture"]]["verdict"] == "MATCH" for e in row["evidence"])


def test_A8_a_library_rows_evidence_was_graded_with_that_version(monkeypatch):
    """(libraries chain, 2026-11-19) A `library:` row's evidence counts only where the snapshot row was GRADED WITH that
    version at the row's sha (its `storeHeld`): a row graded without the store drew nothing of that library."""
    v = copy.deepcopy(_verdicts())
    cid = "kalman-psar-backquant-rddt-1d-2026-11-15"
    sha = "c" * 64
    v[cid]["verdict"] = "MATCH"
    v[cid][store_held.FIELD] = [store_held.pin_of("TradingView/ta/7", sha)]
    monkeypatch.setattr(sys.modules[__name__], "_verdicts", lambda: v)
    fam, comm = rg.pine_evidence_script(v[cid]["script"], cid)
    why_not = "its snapshot row was not graded with that library version at the row's sha"

    def whys(row_sha):
        row = {"admitted": True, "sha256": row_sha, "evidence": [{"capture": cid, "script": fam, "community": comm}]}
        return {w for _c, _i, w in _phantoms({"library:TradingView/ta/7": row})}

    assert why_not not in whys(sha)
    assert why_not in whys("d" * 64)          # graded with other code under the same version
    v[cid].pop(store_held.FIELD)
    assert why_not in whys(sha)               # graded without the store at all


def test_A8_the_rail_can_fail():
    """CONTROL: an invented id, a DIVERGE capture, a wrong script and an unused capability."""
    v = _verdicts()
    diverge = next(i for i, r in v.items() if r["verdict"] == "DIVERGE")
    match = next(i for i, r in v.items() if r["verdict"] == "MATCH" and r["format"] == "harness-v1")
    fam, comm = rg.pine_evidence_script(v[match]["script"], match)
    fake = {"for": {"admitted": True, "evidence": [
        {"capture": "no-such-capture-2026-01-01", "script": "x"},
        {"capture": diverge, "script": v[diverge]["script"]},
        {"capture": match, "script": "somebody else", "community": comm},
        {"capture": match, "script": fam, "community": not comm}]},
        "obj:polyline": {"admitted": True, "evidence": [{"capture": match, "script": fam, "community": comm}]}}
    # U1: an object entry whose capture paired nothing, or that overstates its paired records
    empty = next(i for i, r in v.items() if r["verdict"] == "MATCH"
                 and (r.get("objectsV2") or {}).get("verdict") == "MATCH" and r["objectsV2"].get("pairedNothing") is True)
    fe, ce = rg.pine_evidence_script(v[empty]["script"], empty)
    fake["obj:delete"] = {"admitted": True, "evidence": [
        {"capture": empty, "script": fe, "community": ce, "objectsV2": "MATCH", "objectsPaired": 3,
         "objectsX": "MATCH"}]}
    got = {(c, why) for c, _id, why in _phantoms(fake)}
    assert ("obj:delete", "its objects v2 MATCH paired nothing") in got
    assert ("obj:delete", "states 3 paired records; the verdict pairs 0") in got
    assert ("obj:delete", "states x MATCH; the verdict's x is None") in got
    assert ("for", "no such capture in the runtime-on verdicts") in got
    assert ("for", "runtime-on verdict is DIVERGE") in got
    assert ("for", "names another script") in got
    assert ("for", "states the wrong community flag") in got
    assert ("obj:polyline", "the capture's script does not use it") in got


# ═══ A10 — evidence freshness: a row ADDED or CHANGED is held to evidence graded at TODAY's engine ═══
#
# ⚰️ 2026-11-18: A8 checks that each evidence id EXISTS in the runtime-on snapshot and grades MATCH, never WHICH
# engine graded it. Both snapshots were last regenerated at engine 78 (f9a976fb47) while master shipped 80, so a
# new row could have been admitted on evidence two engines old. Ledger evidence already counts only at today's
# engine (`rollout_gate._pine_ledger_entry_fresh`); committed-snapshot evidence had no such rule.
# ⭐ The snapshot now names its engine (the corpus writer stamps `scriptEngineVersion`), and each admitted row
# carries `admission: {scriptEngineVersion, rowSha256}` written by tools/pine_coverage/stamp_admission.py, which
# refuses unless the snapshot is at today's engine. The digest is over the row's admission fields, so a NEW row
# with a copied stamp, or evidence edited after stamping, no longer matches: no git history is needed.
# ⛔ An engine bump invalidates NO existing row (coordinator ruling: it was valid when admitted).

import re  # noqa: E402

sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))
import stamp_admission as sa  # noqa: E402 -- the ONE definition of the row digest

VERDICTS_PROD = ROOT / "docs" / "pine" / "vendor-harness" / "production" / "verdicts.json"


def _engine_now() -> int:
    return svc.SCRIPT_ENGINE_VERSION


def _freshness_problems(caps: dict, snapshot_engine, current_engine: int) -> list:
    """(capability, why) for every admitted row not held to its stamp."""
    if not isinstance(snapshot_engine, int) or isinstance(snapshot_engine, bool):
        return [("*", "the runtime-on snapshot carries no scriptEngineVersion: regenerate it")]
    bad = []
    if snapshot_engine > current_engine:
        bad.append(("*", f"the runtime-on snapshot claims engine {snapshot_engine}, newer than today's {current_engine}"))
    for cap, row in caps.items():
        if not isinstance(row, dict) or row.get("admitted") is not True:
            continue
        st = row.get("admission")
        if not isinstance(st, dict):
            bad.append((cap, "no admission stamp: run tools/pine_coverage/stamp_admission.py"))
            continue
        at = st.get("scriptEngineVersion")
        if not isinstance(at, int) or isinstance(at, bool):
            bad.append((cap, "its stamp names no engine"))
            continue
        if st.get("rowSha256") != sa.row_digest(row):
            bad.append((cap, f"the row was added or changed since it was stamped: its evidence must be graded at "
                             f"today's engine {current_engine}. Regenerate the runtime-on snapshot at {current_engine} "
                             f"if it is not (`git log -1 -- docs/pine/vendor-harness/runtime-on/verdicts.json`), then "
                             f"`python tools/pine_coverage/stamp_admission.py {cap}`"))
        if at > snapshot_engine:
            bad.append((cap, f"stamped at engine {at}, newer than the snapshot's {snapshot_engine}"))
        if at > current_engine:
            bad.append((cap, f"stamped at engine {at}, newer than today's {current_engine}"))
    return bad


def _caps() -> dict:
    return json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))["capabilities"]


def _snap_engine() -> int:
    return json.loads(VERDICTS_RT.read_text(encoding="utf-8")).get("scriptEngineVersion")


def test_A10_C1_both_snapshots_carry_the_engine_that_graded_them():
    for p in (VERDICTS_RT, VERDICTS_PROD):
        v = json.loads(p.read_text(encoding="utf-8")).get("scriptEngineVersion")
        assert isinstance(v, int) and not isinstance(v, bool) and 0 < v <= _engine_now(), (p.name, v)
    assert sa.current_engine() == _engine_now(), "the tool and the server read different engine numbers"


def test_A10_C2_every_admitted_row_is_held_to_its_stamp():
    assert _freshness_problems(_caps(), _snap_engine(), _engine_now()) == []


def test_A10_C4_an_engine_bump_invalidates_no_existing_row():
    assert _freshness_problems(_caps(), _snap_engine(), _engine_now() + 5) == []


def test_A10_C6_a_new_row_with_a_copied_stamp_is_red_and_a_properly_stamped_one_is_not():
    caps = copy.deepcopy(_caps())
    snap = _snap_engine()
    new = copy.deepcopy(caps["core"])
    new["evidence"] = new["evidence"][:3]                       # a NEW row on (some of) the same evidence
    caps["new-cap"] = new                                       # ...with core's stamp copied along
    got = {c for c, _why in _freshness_problems(caps, snap, _engine_now())}
    assert got == {"new-cap"}, got
    new["admission"] = {"scriptEngineVersion": snap, "rowSha256": sa.row_digest(new)}   # CONTROL
    assert _freshness_problems(caps, snap, _engine_now()) == []
    new["admission"]["scriptEngineVersion"] = snap + 1          # a stamp claiming evidence newer than exists
    assert [c for c, _ in _freshness_problems(caps, snap, snap + 1)] == ["new-cap"]
    del new["admission"]
    assert [c for c, _ in _freshness_problems(caps, snap, _engine_now())] == ["new-cap"]


def test_A10_C3_the_rail_reads_the_snapshot_engine_it_is_given():
    caps = _caps()
    assert _freshness_problems(caps, None, _engine_now())[0][0] == "*"
    assert _freshness_problems(caps, _engine_now() + 1, _engine_now())[0][0] == "*"


def test_A10_the_digest_covers_the_evidence_and_not_the_note():
    row = copy.deepcopy(_caps()["core"])
    d = sa.row_digest(row)
    row["note"] = "prose changes are not an admission"
    assert sa.row_digest(row) == d
    row["evidence"] = row["evidence"][1:]
    assert sa.row_digest(row) != d


def test_A10_C5_the_stamp_tool_refuses_stale_evidence_and_writes_nothing(tmp_path):
    allow, snap = tmp_path / "allow.json", tmp_path / "verdicts.json"
    allow.write_bytes(Path(rt.ALLOWLIST_PATH).read_bytes())
    snap.write_bytes(VERDICTS_RT.read_bytes())
    s = _snap_engine()
    doc = json.loads(allow.read_text(encoding="utf-8"))
    edited = allow.read_text(encoding="utf-8").replace(
        json.dumps(doc["capabilities"]["core"]["evidence"][0], ensure_ascii=False) + ",\n", "", 1)
    allow.write_text(edited, encoding="utf-8", newline="")      # core's evidence changed after stamping
    before = allow.read_bytes()
    with pytest.raises(SystemExit, match="REFUSED"):
        sa.stamp(["core"], allowlist=allow, snapshot=snap, engine_now=s + 2)
    assert allow.read_bytes() == before, "a refused stamp wrote the allowlist"
    sa.stamp(["core"], allowlist=allow, snapshot=snap, engine_now=s)     # CONTROL: a fresh snapshot stamps
    out = allow.read_bytes()
    assert out != before and len(out.splitlines()) == len(before.splitlines())
    row = json.loads(out)["capabilities"]["core"]
    assert row["admission"] == {"scriptEngineVersion": s, "rowSha256": sa.row_digest(row)}


def test_A10_C7_the_snapshot_writer_stamps_the_engine_from_its_one_authority():
    src = (ROOT / "app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js").read_text(
        encoding="utf-8")
    assert re.search(r"^import \{ SCRIPT_ENGINE_VERSION \} from '\.\./\.\./scriptEngineVersion\.js'", src, re.M)
    block = src[src.index("fs.writeFileSync(path.join(OUT, 'verdicts.json')"):]
    block = block[:block.index("results: run.results")]
    assert "scriptEngineVersion: SCRIPT_ENGINE_VERSION," in block, "the writer no longer stamps the engine"


# ═══ A9 — the server lanes stay per-script ═════════════════════════════════════

def test_A9_a_server_lane_never_admits_by_capability(monkeypatch, on):
    monkeypatch.setenv(rt.STAGE_ENV, "all")
    monkeypatch.setenv(rt.SERVER_STAGE_ENV, "all")
    monkeypatch.setenv(rt.SERVICE_URL_ENV, "http://pine-runtime.internal")
    monkeypatch.setenv(rt.SERVICE_SECRET_ENV, "x" * 32)
    row = {"def_id": ADX["id"], "user_id": USER, "definition": member_doc()}
    assert rt.not_graded(MEMBER_COPY) is None                       # the pane admits it ...
    assert rt.not_graded(MEMBER_COPY, graded_only=True)             # ... the graded list does not
    assert rt.server_lane_refusal(row, lane="alert")[0] == "runtime:not-yet-graded"
    graded = {"def_id": ADX["id"], "user_id": USER, "definition": copy.deepcopy(ADX)}
    assert rt.server_lane_refusal(graded, lane="alert") is None     # CONTROL: the graded copy runs


# ═══ the door: POST /api/user-definitions/runtime-admission ════════════════════

def test_the_door_answers_sha_admitted_missing(store, on):
    body = _client().post("/api/user-definitions/runtime-admission", json={"source": MEMBER_COPY}).json()
    assert body == {"sha256": rt.source_hash(MEMBER_COPY), "admitted": True, "missing": []}
    body = _client().post("/api/user-definitions/runtime-admission", json={"source": UNADMITTED_SCRIPT}).json()
    assert body["admitted"] is False and UNADMITTED_CAP in body["missing"]


def test_the_door_with_the_flag_off_admits_nothing(store):
    body = _client().post("/api/user-definitions/runtime-admission", json={"source": MEMBER_COPY}).json()
    assert body == {"sha256": rt.source_hash(MEMBER_COPY), "admitted": False, "missing": []}


def test_B1_with_the_flag_off_the_door_never_runs_the_detector(store, monkeypatch):
    """B1a: OFF answers a constant; no request can spend server time on a door that admits nothing."""
    # a SPY, not a raiser: `capability_admitted` swallows an exception into "unreadable", which
    # would let a door that DID run the detector pass (mutant B1c survived that version)
    calls = []

    def spy(src):
        calls.append(1)
        return frozenset({"core"})
    monkeypatch.setattr(pc, "capabilities_of", spy)
    rt._reset_capability_cache(persisted=True)
    src = MEMBER_COPY + "// x\n"
    r = _client().post("/api/user-definitions/runtime-admission", json={"source": src})
    assert r.status_code == 200
    assert r.json() == {"sha256": rt.source_hash(src), "admitted": False, "missing": []}
    assert calls == []
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")             # CONTROL: on, the detector runs
    rt._reset_capability_cache(persisted=True)
    _client().post("/api/user-definitions/runtime-admission", json={"source": src})
    assert calls == [1]


def test_B1c_the_door_is_rate_limited_per_member(store, on):
    router_mod._runtime_admission_calls.clear()
    t0 = 1_000_000.0
    for i in range(router_mod.RUNTIME_ADMISSION_MAX_PER_MINUTE):
        router_mod._charge_runtime_admission("u1", now=t0 + i * 0.1)
    with pytest.raises(Exception) as e:
        router_mod._charge_runtime_admission("u1", now=t0 + 7)
    assert getattr(e.value, "status_code", None) == 429
    router_mod._charge_runtime_admission("u2", now=t0 + 7)                 # another member is unaffected
    router_mod._charge_runtime_admission("u1", now=t0 + 61)                # and the window slides
    router_mod._runtime_admission_calls.clear()


def test_B1c_the_route_charges_before_any_work(store, on, monkeypatch):
    router_mod._runtime_admission_calls.clear()
    monkeypatch.setattr(router_mod, "RUNTIME_ADMISSION_MAX_PER_MINUTE", 2)
    c = _client()
    codes = [c.post("/api/user-definitions/runtime-admission", json={"source": MEMBER_COPY}).status_code
             for _ in range(3)]
    assert codes == [200, 200, 429]
    assert c.post("/api/user-definitions/runtime-admission", json=[]).status_code == 429   # charged first
    router_mod._runtime_admission_calls.clear()


@pytest.mark.parametrize("raw", ['"SECRET_MARKER"', '["SECRET_MARKER"]', '{"source": ["SECRET_MARKER"]}',
                                 'not json SECRET_MARKER', '7'])
def test_the_door_never_echoes_a_non_object_body(store, on, raw):
    router_mod._runtime_admission_calls.clear()
    r = _client().post("/api/user-definitions/runtime-admission", content=raw,
                       headers={"content-type": "application/json"})
    assert r.status_code in (400, 422) and "SECRET_MARKER" not in r.text


def test_the_door_is_paid_gated(store, on):
    r = _client(role="user", plan="free").post("/api/user-definitions/runtime-admission",
                                               json={"source": MEMBER_COPY})
    assert r.status_code == 402


@pytest.mark.parametrize("payload,status", [({}, 400), ({"source": ""}, 400), ({"source": 12}, 400),
                                            ({"source": ["x"]}, 400)])
def test_the_door_refuses_a_non_script(store, on, payload, status):
    assert _client().post("/api/user-definitions/runtime-admission", json=payload).status_code == status


def test_the_door_caps_the_source_at_128_KiB_and_never_echoes_it(store, on):
    marker = "SECRET_MEMBER_SCRIPT_MARKER"
    big = MEMBER_COPY + "// " + marker + "\n// " + "é" * (rt.RUNTIME_MAX_DEFINITION_BYTES // 2)
    assert len(big) < rt.RUNTIME_MAX_DEFINITION_BYTES < len(big.encode("utf-8"))   # bytes, not chars
    r = _client().post("/api/user-definitions/runtime-admission", json={"source": big})
    assert r.status_code == 413 and marker not in r.text
    at_cap = MEMBER_COPY + "/" * (rt.RUNTIME_MAX_DEFINITION_BYTES - len(MEMBER_COPY.encode("utf-8")))
    assert _client().post("/api/user-definitions/runtime-admission", json={"source": at_cap}).status_code == 200


def test_the_door_stores_nothing_and_logs_no_source(store, on, caplog):
    marker = "SECRET_MEMBER_SCRIPT_MARKER"
    src = MEMBER_COPY + "// " + marker + "\n"
    caplog.set_level(logging.DEBUG)
    before = svc.list_for_user(USER)
    r = _client().post("/api/user-definitions/runtime-admission", json={"source": src})
    assert r.status_code == 200 and marker not in r.text
    assert svc.list_for_user(USER) == before
    assert not [rec for rec in caplog.records if marker in rec.getMessage()]


# ═══ THE REACH RULE (coordinator ruling 2026-11-13) ════════════════════════════
# No capture drawn by the RUNTIME lane under admission may DIVERGE, and no capture may move
# MATCH -> DIVERGE (production -> runtime-on). Read over the committed reach run
# (`runs/report.json`, whose lanes `capabilityEvidenceLane.test.js` re-asks of the door) and the
# committed harness snapshots of both lanes.

REPORT = ROOT / "docs" / "pine" / "evidence" / "2026-11-16-draw1-drawing-objects" / "runs" / "report.json"
# VERDICTS_PROD is bound once, above (the A10 evidence-freshness block); the REACH rails read the same path.


#: ⛔⛔ TEMPORARY (coordinator ruling 2026-11-15: RE-CAPTURE is preferred over a named exception).
#: TODO(COND-TA): remove `vw-deadband-ticks-brk-a-1d-2026-09-28` from this set — and the set and
#: `withheld_whole` with it, if it is then empty — when the capture agent's re-take of NYSE:BRK.A 1D
#: with `history.startsAtBar0` asserted lands; that capture is expected to grade MATCH on the
#: runtime lane (D03_dbhf already equals TradingView on 11,335 / 11,335 bars with the listing stated).
#: 2026-11-16: the re-take landed (`vw-deadband-ticks-brk-a-1d-2026-11-15`, #1373). Runtime-on it grades
#: INCONCLUSIVE, not MATCH: DBHF, D00, D02 and D03 agree on 11,369 / 11,369 bars and the bar colour
#: agrees, and D01_mintick has no column on our side. The 09-28 capture is still committed and still
#: grades as described below, so it stays named here until that capture is retired.
#: ⭐ COND-TA (engine 58, 2026-11-15) — ADMITTED CAPTURES THE RUNTIME LANE WITHHOLDS WHOLE, BY NAME.
#: Named one by one, each with why, and each re-proved from its own verdict record on every run
#: (`withheld_whole`): every plot INCONCLUSIVE because our side computed NO column for it, no
#: drawing object on either side, and the only DIVERGE a paint (B1 grades a paint our side did not
#: draw as a gap). Such a capture shows the member a by-name withholding, never a picture, so it is
#: not "drawn by the runtime lane". ⛔ A record that drifts from that shape (any plot compared, any
#: object, any non-paint DIVERGE) is a REACH stop again. ⛔ A capture not named here never gets this
#: reading: the set is closed.
WITHHELD_WHOLE = {
    "vw-deadband-ticks-brk-a-1d-2026-09-28": (
        "runtime:warmup-never-converges on every column: the capture does not assert its history "
        "starts at the listing (history.startsAtBar0 'not asserted'), so the run is off the listing and "
        "its two warm-up runs never agree exactly; with the history stated from bar 0 (its own "
        "D00_bar_index_CONTROL reads 0 on its first bar) D03_dbhf equals TradingView on 11,335 / 11,335 "
        "bars. The ATR branch holding the conditional ta.atr is never taken (Threshold Mode = Ticks). "
        "docs/pine/evidence/2026-11-15-cond-ta/EVIDENCE.md"),
}


#: ⭐⭐ admit:request-other (coordinator ruling 2026-11-19) — ONE SCRIPT IS SERVED THROUGH ITS OWN SHA ALLOWLIST ENTRY, NOT BY
#: CAPABILITY, AND IS NOT KILLED: rs-rating-fred6724 (the owner's priority script; `api/data/pine_runtime_allowlist.json`
#: `scripts`). Admitting `request-other` puts its captures in the reach run; four grade DIVERGE on the runtime-on lane (the
#: door draws them on the HOST lane under admission, so they list as host-drawn DIVERGE, never a REACH stop). They are its
#: known differences, named here with why and re-proved on every run (`served_by_own_sha`: its source is the allowlisted sha,
#: no plot diverges, and the family named does), so the kill rail's exemption for it covers exactly these and nothing else.
SERVED_BY_OWN_SHA = {
    "rs-rating-fred6724-pc-agl-1d-2026-11-17": (
        "objects", "the rating labels are WITHHELD by name (pine:object-removal-lost: the object gate withholds the whole "
        "drawing program for a lost removal) where TradingView holds 2 labels; the RS line and every plot agree"),
    "rs-rating-fred6724-pc-nvda-1d-2026-11-17": ("objects", "the same, on NASDAQ:NVDA 1D"),
    "rs-rating-fred6724-pc-rddt-1d-2026-11-17": ("objects", "the same, on NYSE:RDDT 1D"),
    "rs-rating-fred6724-pm-alab-1d-2026-11-16": (
        "objectsV2", "one label's y on the newest bar after the close (vendor 91.67, ours 89.91): TradingView read SP:SPX's "
        "same-session close there while its own witnesses read the previous session's, three minutes apart "
        "(docs/pine/capture-queue-2026-11-17-spx-after-close.md, Q-SPX-AFTERCLOSE); every plot agrees"),
}


def _allowlisted_shas() -> set:
    doc = json.loads((ROOT / "api" / "data" / "pine_runtime_allowlist.json").read_text(encoding="utf-8"))
    return {s.get("sha256") for s in doc.get("scripts") or [] if isinstance(s, dict)}


def served_by_own_sha(record: dict) -> bool:
    """Is this runtime-on verdict record one of SERVED_BY_OWN_SHA's, still in the shape named (above)?"""
    if not isinstance(record, dict) or record.get("id") not in SERVED_BY_OWN_SHA:
        return False
    at = licence_held.fixture_path(record["file"])
    try:
        text = (json.loads((at or ROOT / record["file"]).read_text(encoding="utf-8")).get("source") or {}).get("text")
    except (OSError, ValueError):
        return False
    if not isinstance(text, str) or rt.source_hash(text) not in _allowlisted_shas():
        return False
    if any(p.get("verdict") == "DIVERGE" for p in record.get("plots") or []):
        return False
    family = SERVED_BY_OWN_SHA[record["id"]][0]
    return (record.get(family) or {}).get("verdict") == "DIVERGE"


def withheld_whole(record: dict) -> bool:
    """Is this runtime-on verdict record a by-name withholding of the WHOLE run (see above)?"""
    if not isinstance(record, dict) or record.get("verdictWithoutPaints") != "INCONCLUSIVE":
        return False
    plots = record.get("plots") or []
    if not plots or any(p.get("verdict") != "INCONCLUSIVE"
                        or "our side produced no column" not in str(p.get("reason") or "") for p in plots):
        return False
    objs = record.get("objects") or {}
    if objs.get("verdict") not in (None, "MATCH") or "neither side draws" not in str(objs.get("reason") or "neither side draws"):
        return False
    paints = record.get("paints") or {}
    return paints.get("verdict") == "DIVERGE" and all(
        r.get("state") in ("notDrawn", "withheld") for r in (paints.get("rows") or [{"state": "x"}]))


def reach_rule_violations(report: dict, rt_verdicts: dict, prod_verdicts: dict, today: datetime.date | None = None) -> list:
    rton = {r["id"]: r["verdict"] for r in rt_verdicts["results"]}
    # ⭐ (2026-11-18) a HELD kill's one named capture, re-proved from its record and only until its expiry
    held = held_kill_captures(rt_verdicts, today)
    records = {r["id"]: r for r in rt_verdicts["results"]}
    prod = {r["id"]: r["verdict"] for r in prod_verdicts["results"]}
    out = []
    if rt_verdicts.get("lane") != "runtime-on" or prod_verdicts.get("lane") != "production":
        out.append("a snapshot is not the lane it is read as")
    for c in report["captures"]:
        if c["lane"] == "runtime" and rton.get(c["capture"]) != "MATCH" and rton.get(c["capture"]) != "INCONCLUSIVE":
            if c["capture"] in WITHHELD_WHOLE and withheld_whole(records.get(c["capture"])):
                continue
            if c["capture"] in held:
                continue
            out.append(f"{c['capture']}: drawn by the runtime lane and graded {rton.get(c['capture'])}")
    for cid, v in prod.items():
        if v == "MATCH" and rton.get(cid) == "DIVERGE":
            out.append(f"{cid}: MATCH -> DIVERGE")
    return out


def _admitted_capture_ids(held_absent: dict | None = None) -> set:
    """The captures the committed registry admits, from the detector itself (not the serving path,
    whose process-wide gate and cool-down answer "pending" between runs).

    A licence-held capture (docs/pine/vendor-harness/licence-held.json) is read from the local
    capture store; one that is not on this machine is recorded in `held_absent` {id: file}, so the
    caller can say so by name rather than count it either way."""
    admitted = set(rt.admitted_capabilities()["admitted"])
    out = set()
    for r in _verdicts().values():
        at = licence_held.fixture_path(r["file"])
        if at is None and licence_held.entry(r["file"]) is not None:
            if held_absent is not None:
                held_absent[r["id"]] = r["file"]
            continue
        try:
            text = (json.loads((at or ROOT / r["file"]).read_text(encoding="utf-8")).get("source") or {}).get("text")
        except (OSError, ValueError):
            continue
        if isinstance(text, str) and text.strip() and pc.capabilities_of(text) <= admitted \
                and not rt.killed(None, text):
            out.add(r["id"])
    return out


def test_REACH_the_committed_reach_run_is_the_committed_registrys():
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    held_absent: dict = {}
    admitted = _admitted_capture_ids(held_absent)
    # ⛔ A held capture that is not on this machine cannot be classified either way: it is taken
    # out of BOTH sides, every other capture is still held to exact equality, and the test then
    # SKIPS naming it (with its ledger verdict) instead of reporting a full pass.
    assert {c["capture"] for c in report["captures"]} - set(held_absent) == admitted
    # ⭐ COND-TA: the reach run lists a runtime-lane DIVERGE as a stop whatever its shape; the only
    # stops a committed run may carry are the captures named in WITHHELD_WHOLE, each re-proved from
    # its own verdict record by `reach_rule_violations` (the next test). Any other stop is red here.
    # ⭐ (2026-11-18) ...and the one named capture of each HELD kill on the committed kill list, until its expiry
    held = held_kill_captures(json.loads(VERDICTS_RT.read_text(encoding="utf-8")))
    assert {s["capture"] for s in report["stops"]} <= set(WITHHELD_WHOLE) | set(held), report["stops"]
    assert report["matchToDiverge"] == []
    assert sum(1 for c in report["captures"] if c["lane"] == "runtime") >= 10   # not vacuous
    if held_absent:
        pytest.skip(f"the other {len(admitted)} admitted captures were verified equal; "
                    + licence_held.note(sorted(held_absent.values())))


def test_REACH_no_runtime_lane_DIVERGE_and_no_MATCH_to_DIVERGE():
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    problems = reach_rule_violations(report, json.loads(VERDICTS_RT.read_text(encoding="utf-8")),
                                     json.loads(VERDICTS_PROD.read_text(encoding="utf-8")))
    assert problems == [], problems


def test_REACH_the_population_block_is_derived_from_its_rows():
    """⭐⭐ (2026-11-19, the e84 train's finding) the report's `populations` block is DERIVED from its rows
    (`capability_admission.py::populations_of`): git merged two units' identical hand-edits to it as one, and master's
    block was 4 rows off its own rows. Recomputed here; `capture` and `committed` sizes held to what they count."""
    sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))
    import capability_admission as ca  # noqa: PLC0415
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    assert report["populations"] == ca.populations_of(report)
    sizes = report["populationSizes"]
    assert sizes["capture"] == len(json.loads(VERDICTS_RT.read_text(encoding="utf-8"))["results"])
    assert sizes["committed"] == len(list((ROOT / "corpus" / "committed").glob("*.pine")))
    # CONTROL: one row's lane moved, or one row dropped, and the block no longer derives
    moved = copy.deepcopy(report)
    row = next(c for c in moved["captures"] if c["lane"] == "runtime")
    row["lane"] = "host"
    assert moved["populations"] != ca.populations_of(moved)
    dropped = copy.deepcopy(report)
    dropped["admittedGraded"] = dropped["admittedGraded"][1:]
    assert dropped["populations"] != ca.populations_of(dropped)


def held_kills_or_synthetic(rtv: dict, tmp_path, monkeypatch) -> dict:
    """The committed list's HELD kills; when it holds none (adx-and-di-for-v4 was LIFTED at engine 78: Q-FCMP ruled
    TOLERANCE, #1858, and its SPY capture re-graded MATCH), ONE synthetic held entry in a tmp kill list naming a real
    committed capture that grades DIVERGE, so the rule is still shown both ways. Read through `rt.pending_kills`."""
    pending = rt.pending_kills()
    if pending:
        return pending
    rec = next(r for r in rtv["results"] if r["verdict"] == "DIVERGE" and r["id"] not in WITHHELD_WHOLE
               and (ROOT / r["file"]).is_file())
    src = json.loads((ROOT / rec["file"]).read_text(encoding="utf-8"))["source"]["text"]
    entry = {"slug": "synthetic-held", "status": rt.KILL_PENDING,
             "expires": (datetime.date.today() + datetime.timedelta(days=3)).isoformat(),
             "sha256": rt.source_hash(src), "source": rec["file"], "reason": "SYNTHETIC", "liftWhen": "SYNTHETIC",
             "evidence": {"capture": rec["id"], "verdict": "DIVERGE"}}
    f = tmp_path / "held-killlist.json"
    f.write_text(json.dumps({"_readme": ["tmp, synthetic"], "scripts": [entry]}), encoding="utf-8")
    monkeypatch.setattr(rt, "KILLLIST_PATH", str(f))
    return rt.pending_kills()


def test_REACH_a_held_kill_is_one_named_stop_until_its_expiry_and_nothing_else(tmp_path, monkeypatch):
    """(coordinator ruling 2026-11-18) A HELD kill (`status: pending` on the committed kill list) lets the REACH rule
    carry its ONE named capture as a stop, re-proved from that capture's record, and only until `expires`. CONTROLS:
    the day after expiry it is a stop again; the same capture graded MATCH (the held entry no longer true) is not
    accepted; another DIVERGE capture of the same script is not accepted."""
    rtv = json.loads(VERDICTS_RT.read_text(encoding="utf-8"))
    prodv = json.loads(VERDICTS_PROD.read_text(encoding="utf-8"))
    pending = held_kills_or_synthetic(rtv, tmp_path, monkeypatch)
    assert pending, "no held kill, committed or synthetic (vacuous)"
    for s in pending.values():
        cid = s["evidence"]["capture"]
        expires = datetime.date.fromisoformat(s["expires"])
        report = {"captures": [{"capture": cid, "lane": "runtime"}]}
        assert held_kill_captures(rtv, expires) == {cid: s["slug"]}
        assert all(cid not in p for p in reach_rule_violations(report, rtv, prodv, today=expires))
        late = expires + datetime.timedelta(days=1)
        assert any(cid in p for p in reach_rule_violations(report, rtv, prodv, today=late))
        healed = copy.deepcopy(rtv)
        for r in healed["results"]:
            if r["id"] == cid:
                r["verdict"] = "MATCH"
        assert cid not in held_kill_captures(healed, expires)
    other = next(r["id"] for r in rtv["results"] if r["verdict"] == "DIVERGE"
                 and r["id"] not in WITHHELD_WHOLE and r["id"] not in held_kill_captures(rtv))
    assert any(other in p for p in reach_rule_violations({"captures": [{"capture": other, "lane": "runtime"}]}, rtv, prodv))


def test_REACH_the_rule_can_fail():
    """CONTROLS: a runtime-lane capture graded DIVERGE, and a MATCH that moves to DIVERGE."""
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    rtv = json.loads(VERDICTS_RT.read_text(encoding="utf-8"))
    prodv = json.loads(VERDICTS_PROD.read_text(encoding="utf-8"))
    drawn = next(c["capture"] for c in report["captures"] if c["lane"] == "runtime")
    for r in rtv["results"]:
        if r["id"] == drawn:
            r["verdict"] = "DIVERGE"
    host_match = next(r["id"] for r in prodv["results"] if r["verdict"] == "MATCH" and r["id"] != drawn)
    for r in rtv["results"]:
        if r["id"] == host_match:
            r["verdict"] = "DIVERGE"
    got = reach_rule_violations(report, rtv, prodv)
    assert any(drawn in p and "runtime lane" in p for p in got), got
    assert any(host_match in p and "MATCH -> DIVERGE" in p for p in got), got


def test_REACH_a_whole_run_withholding_is_named_and_re_proved_and_nothing_else_reads_that_way():
    """COND-TA (engine 58). CONTROLS: each named capture's record IS the shape; the same record with
    one plot compared, or a capture not named, is a REACH stop."""
    rtv = json.loads(VERDICTS_RT.read_text(encoding="utf-8"))
    prodv = json.loads(VERDICTS_PROD.read_text(encoding="utf-8"))
    recs = {r["id"]: r for r in rtv["results"]}
    for cid in WITHHELD_WHOLE:
        assert recs[cid]["verdict"] == "DIVERGE" and withheld_whole(recs[cid]), cid
        report = {"captures": [{"capture": cid, "lane": "runtime"}]}
        assert all(cid not in p for p in reach_rule_violations(report, rtv, prodv))
        drifted = copy.deepcopy(rtv)
        for r in drifted["results"]:
            if r["id"] == cid:
                r["plots"][0] = dict(r["plots"][0], verdict="DIVERGE", reason="2 bars differ")
        assert any(cid in p for p in reach_rule_violations(report, drifted, prodv))
    # a DIVERGE capture NOT named never reads as withheld whole, whatever its record (a held kill's capture is the
    # other named exception, `test_REACH_a_held_kill_is_one_named_stop_until_its_expiry_and_nothing_else`)
    other = next(r["id"] for r in rtv["results"] if r["verdict"] == "DIVERGE" and r["id"] not in WITHHELD_WHOLE
                 and r["id"] not in held_kill_captures(rtv))
    assert any(other in p for p in reach_rule_violations({"captures": [{"capture": other, "lane": "runtime"}]}, rtv, prodv))


# ═══ SERVING COST, FLAG ON (re-verify of #1204, 2026-11-13) ════════════════════
# The capability set is computed ONCE per source and persisted (`runtime_capabilities`); serving
# reads it. A request does at most `DETECTOR_RUNS_PER_REQUEST` fresh runs (and none after
# `DETECTOR_SECONDS_PER_REQUEST`); history asks only the latest version; the in-process fallback
# is a TRUE LRU. Measured before: 200 near-cap rows 53 s cold, 300 rows 79 s then 87 s.

import sqlite3  # noqa: E402
import time  # noqa: E402


def _near_cap_source(tag: str, kb: int = 100) -> str:
    base = ADX["compute"]["source"] + f"\n// {tag}\n"
    lines, i = [], 0
    while len(base) + sum(map(len, lines)) < kb * 1024:
        lines.append(f"x{i} = ta.sma(close, {2 + i % 50}) + (close > open ? 1 : 0)\n")
        i += 1
    return base + "".join(lines)


def _seed_runtime_rows(monkeypatch, n: int, kb: int = 100) -> list:
    """n stored runtime rows whose sources are distinct, near-cap and capability-admitted
    (each the graded ADX script plus admitted-only lines). Saved small, then their stored
    source swapped in place, so the seed does not pay n save-door validations."""
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    monkeypatch.setenv(rt.ALLOW_ENV, rt.source_hash(ADX["compute"]["source"]))
    ids = []
    for _ in range(n):
        d = copy.deepcopy(ADX)
        did = svc.new_def_id()
        d["id"] = did
        svc.save(USER, did, d, role="admin")
        ids.append(did)
    with sqlite3.connect(svc._DB_PATH) as c:
        for k, did in enumerate(ids):
            rid, blob = c.execute("SELECT id, definition FROM user_definitions WHERE def_id = ?", (did,)).fetchone()
            d = json.loads(blob)
            d["compute"]["source"] = _near_cap_source(f"row {k}", kb)
            c.execute("UPDATE user_definitions SET definition = ? WHERE id = ?", (json.dumps(d), rid))
    monkeypatch.delenv(rt.ALLOW_ENV)
    return ids


def _count_detector(monkeypatch) -> list:
    calls = []
    real = pc.capabilities_of

    def counted(src):
        calls.append(1)
        return real(src)
    monkeypatch.setattr(pc, "capabilities_of", counted)
    return calls


def test_SERVE_the_list_with_50_near_cap_rows_cold_is_under_1s(store, monkeypatch):
    ids = _seed_runtime_rows(monkeypatch, 50)
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    # the server-lane composition stamp lexes each runtime source once per process (the repaint memo;
    # it lexed every row three times before, ~10 s for these 50 rows, `EVIDENCE.md`). A cold lex of 50
    # near-cap sources is still ~2 s and is not admission, so it is held still here; the rail below
    # serves the full list, server lanes included
    monkeypatch.setattr(svc, "server_lanes_stamp", lambda row: {})
    monkeypatch.setattr(rt, "DETECTOR_DUTY_CYCLE", 1.0)   # the per-request budget alone (the gate rails test the cool-down)
    rt._reset_capability_cache(persisted=True)
    calls = _count_detector(monkeypatch)
    t0 = time.perf_counter()
    body = _client().get("/api/user-definitions").json()
    elapsed = time.perf_counter() - t0
    assert len(body["definitions"]) == 50
    assert elapsed < 1.0, elapsed
    assert 1 <= len(calls) <= rt.DETECTOR_RUNS_PER_REQUEST
    pending = [r for r in body["definitions"] if "still being checked" in
               (r["definition"].get("meta") or {}).get("runtimeNotGraded", "")]
    assert len(pending) == 50 - len(calls)                       # past the budget: fail closed
    drawn = [r for r in body["definitions"] if "runtimeNotGraded" not in (r["definition"].get("meta") or {})]
    assert len(drawn) == len(calls)                              # computed ones are admitted
    # and they FILL on later requests: each serves the stored sets and computes the next batch
    for _ in range(60):
        rt._DETECTOR_IDLE_UNTIL[0] = 0.0          # the periodic re-read comes after the cool-down
        body = _client().get("/api/user-definitions").json()
        if all("runtimeNotGraded" not in (r["definition"].get("meta") or {}) for r in body["definitions"]):
            break
    assert all("runtimeNotGraded" not in (r["definition"].get("meta") or {}) for r in body["definitions"])
    assert len(calls) == 50                                      # each source computed exactly once


def test_SERVE_the_list_with_50_near_cap_rows_lexes_each_source_once_server_lanes_included(store, monkeypatch):
    """The precondition before `PINE_RUNTIME_SAVE_ENABLED` (memoise the repaint lex per source hash):
    the list's server-lane stamp asked `request_reads` three times per runtime row and each asked
    the lexer (150 lexes, 7-16.8 s for these 50 rows, flag on or off). With the memo, the FULL serve
    (nothing held still) lexes each distinct source once, and a second request lexes nothing."""
    from api.services import runtime_repaint as rr
    _seed_runtime_rows(monkeypatch, 50)
    rr._reset_repaint_memo()                       # a fresh process: the seed's saves warmed nothing here
    lexes = []
    real = rr.lex
    monkeypatch.setattr(rr, "lex", lambda src: (lexes.append(1), real(src))[1])
    body = _client().get("/api/user-definitions").json()
    assert len(body["definitions"]) == 50
    assert all(set(r["server_lanes"]) == {"alerts", "screener", "scans"} for r in body["definitions"])
    assert len(lexes) == 50, len(lexes)            # one per distinct source (was 150)
    lexes.clear()
    t0 = time.perf_counter()
    again = _client().get("/api/user-definitions").json()
    warm = time.perf_counter() - t0
    assert lexes == []                             # warm: the stamp lexes nothing
    assert again == body                           # and answers the same
    assert warm < 3.0, warm                        # generous: the count above is the exact rail


def test_SERVE_a_saved_row_is_computed_at_save_and_never_on_the_hot_path(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    calls = _count_detector(monkeypatch)
    svc.save(USER, ADX["id"], member_doc(), role="admin")
    assert len(calls) == 1                                       # computed (and persisted) at the save
    rt._reset_capability_cache()                                 # a fresh process: only the store remains
    row = {"def_id": ADX["id"], "definition": member_doc()}
    assert rt.stamp_served(row, budget=rt.DetectorBudget(runs=0)) is row
    assert len(calls) == 1                                       # served from the store, no run


def test_SERVE_a_set_from_an_older_detector_is_recomputed(store, monkeypatch):
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    calls = _count_detector(monkeypatch)
    assert rt.capability_admitted(MEMBER_COPY)[0]
    rt._reset_capability_cache()
    monkeypatch.setattr(pc, "DETECTOR_VERSION", pc.DETECTOR_VERSION + 1)
    assert rt.capability_admitted(MEMBER_COPY, budget=rt.DetectorBudget(runs=0)) == (False, [rt.PENDING])
    assert rt.capability_admitted(MEMBER_COPY)[0] and len(calls) == 2


def test_SERVE_history_with_300_versions_asks_only_the_latest(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    svc.save(USER, ADX["id"], copy.deepcopy(ADX), role="admin")
    with sqlite3.connect(svc._DB_PATH) as c:
        c.row_factory = sqlite3.Row
        base = dict(c.execute("SELECT * FROM user_definitions WHERE def_id = ?", (ADX["id"],)).fetchone())
        for v in range(2, 301):
            d = json.loads(base["definition"])
            d["compute"]["source"] = _near_cap_source(f"version {v}", 20)
            row = dict(base, version=v, definition=json.dumps(d))
            row.pop("id")
            c.execute(f"INSERT INTO user_definitions ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
                      list(row.values()))
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    rt._reset_capability_cache(persisted=True)
    calls = _count_detector(monkeypatch)
    t0 = time.perf_counter()
    body = _client().get(f"/api/user-definitions/{ADX['id']}/history").json()
    elapsed = time.perf_counter() - t0
    assert len(body["versions"]) == 300
    assert elapsed < 1.0, elapsed
    assert len(calls) == 1                                       # the latest version only
    older = [v for v in body["versions"] if 1 < v["version"] < 300]     # v1 is the graded ADX itself
    assert len(older) == 298
    assert all("has not yet been graded" in v["definition"]["meta"]["runtimeNotGraded"] for v in older)


def test_SERVE_a_300_source_sweep_twice_the_second_pass_is_not_slower(monkeypatch):
    """The in-process fallback is a TRUE LRU sized for the working set: the verdict door's path
    (`persist=False`, nothing stored) sweeping 300 sources twice hits on the second pass. A FIFO
    of 256 misses every one of them again (measured before: 79 s, then 87 s)."""
    rt._reset_capability_cache(persisted=True)
    monkeypatch.setattr(rt, "DETECTOR_DUTY_CYCLE", 1.0)   # the LRU alone, no process cool-down
    srcs =[MEMBER_COPY + f"// sweep {i}\n" + "y = close > open ? 1 : 0\n" * 40 for i in range(300)]

    def sweep():
        t0 = time.perf_counter()
        for s in srcs:
            rt.capabilities_for(s, persist=False)
        return time.perf_counter() - t0
    first, second = sweep(), sweep()
    assert second <= max(first / 4, 0.05), (first, second)
    assert len(rt._CAPS_LRU) >= 300


def test_SERVE_the_lru_evicts_least_recently_used_not_oldest(monkeypatch):
    rt._reset_capability_cache()
    monkeypatch.setattr(rt, "_CAPS_LRU_MAX", 3)
    for k in ("a", "b", "c"):
        rt._lru_put(k, frozenset({k}))
    assert rt._lru_get("a") == frozenset({"a"})                  # touched: now the most recent
    rt._lru_put("d", frozenset({"d"}))
    assert rt._lru_get("b") is None and rt._lru_get("a") == frozenset({"a"})
    rt._reset_capability_cache()


def test_SERVE_the_budget_bounds_runs_and_time():
    b = rt.DetectorBudget(runs=2, seconds=10)
    assert b.take() and b.take() and not b.take()
    b = rt.DetectorBudget(runs=99, seconds=0.1)
    b.spent, b.done = 0.2, 1
    assert not b.take()


def test_SERVE_the_detector_version_moves_with_what_it_answers():
    """Bump `DETECTOR_VERSION` (and record the fingerprint) whenever the detector's answers can
    change: a stored set is valid only for the detector that computed it."""
    assert pc.detector_fingerprint() == pc.DETECTOR_FINGERPRINTS[pc.DETECTOR_VERSION]


# ═══ EVIDENCE CLASSIFIER (re-verify of #1204): our probes never count as community scripts ═════

@pytest.mark.parametrize("capture_id", [
    "probe-default-colour-v3-rddt-1d-2026-09-27", "probe-default-colour-v4-rddt-1d-2026-09-27",
    "probe-default-colour-v6-rddt-1d-2026-09-27", "probe-sparse-rows-rddt-1d-2026-09-27",
    "adx-14-2026-09-06", "atr-14-2026-09-06", "ema-close20-2026-09-06", "hma-close20-2026-09-06",
    "rma-close14-2026-09-06", "stoch-k-14-2026-09-06", "vw-library-import-rddt-1d-2026-10-02",
    # 2026-11-17: the W9 strategy probes (`W9_<ROW>` titles, `w9_probes.py`) are ours, the evidence the
    # strategy-decl admission was asked of (docs/pine/evidence/2026-11-17-admit-strategy-decl/EVIDENCE.md)
    "w9-k1-commission-pct-rddt-1d-2026-11-15", "w9-q-s1a-size-v2-rddt-1d-2026-11-15",
    "w9-d1-margin50-rpt-rddt-1d-2026-11-16", "w9-r1-risk-intraday-range-spy-15-2026-11-15",
])
def test_EVIDENCE_these_captures_are_ours_not_community(capture_id):
    title = _verdicts()[capture_id]["script"]
    family, community = rg.pine_evidence_script(title, capture_id)
    assert community is False, (capture_id, title)


def test_EVIDENCE_every_w9_strategy_capture_is_ours():
    """2026-11-17: every W9 strategy probe capture in the runtime-on run is one of OUR scripts, whatever its
    title: a `W9_<ROW>` title read as a COMMUNITY script would let a strategy capability admit on probes alone."""
    w9 = {cid: r for cid, r in _verdicts().items() if cid.startswith("w9-")}
    assert len(w9) >= 30, "non-vacuity: the W9 Strategy Tester captures are in the runtime-on verdicts"
    community = sorted(cid for cid, r in w9.items() if rg.pine_evidence_script(r.get("script"), cid)[1])
    assert community == [], community


def test_EVIDENCE_variants_are_one_family_and_community_titles_are_untouched():
    assert rg.pine_evidence_script("default colour v3", "probe-default-colour-v3-x")[0] == \
        rg.pine_evidence_script("default colour v6", "probe-default-colour-v6-x")[0]
    assert rg.pine_evidence_script("uct-dmi-parity-v1", "adx-14")[0] == "uct-dmi-parity"
    assert rg.pine_evidence_script("UCTPROBE_VW_INT_ARRAY_AVG_NEG", "vw-a")[0] == "UCTPROBE_VW_INT_ARRAY_AVG"
    assert rg.pine_evidence_script("ADX and DI for v4", "adx-and-di-for-v4-rddt") == ("ADX and DI for v4", True)


# ═══ THE PROCESS-WIDE GATE AND THE PROJECTED BUDGET (final verify of #1204) ═══════
# A2: eight requests each spending their own budget at once stalled each other (3.5-5.1 s each:
# the detector holds the GIL). ONE detector run at a time in the process; a request that cannot
# take the gate without waiting serves the row "still being checked". And the 0.9 s edge: a run is
# PROJECTED from the source's size before it starts, and a source over 64 KiB gets one run per
# request.

import threading  # noqa: E402


def _adversarial_source(tag: str) -> str:
    """The reviewer's adversarial near-cap shape (unclosed calls to ~126 KB): ~0.3 s here."""
    base = ADX["compute"]["source"] + f"\n// {tag}\n"
    unit = "f(a, b\n"
    return (base + unit * ((126 * 1024 - len(base)) // len(unit)))[: 126 * 1024]


def _seed_member_rows(monkeypatch, user: str, sources: list) -> None:
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    monkeypatch.setenv(rt.ALLOW_ENV, rt.source_hash(ADX["compute"]["source"]))
    ids = []
    for _ in sources:
        d = copy.deepcopy(ADX)
        did = svc.new_def_id()
        d["id"] = did
        svc.save(user, did, d, role="admin")
        ids.append(did)
    with sqlite3.connect(svc._DB_PATH) as c:
        for did, src in zip(ids, sources):
            rid, blob = c.execute("SELECT id, definition FROM user_definitions WHERE def_id = ? AND user_id = ?",
                                  (did, user)).fetchone()
            d = json.loads(blob)
            d["compute"]["source"] = src
            c.execute("UPDATE user_definitions SET definition = ? WHERE id = ?", (json.dumps(d), rid))
    monkeypatch.delenv(rt.ALLOW_ENV)


def test_GATE_8_concurrent_cold_list_requests_each_finish_under_1s(store, monkeypatch):
    members = [f"u-gate-{i}" for i in range(8)]
    for i, m in enumerate(members):
        _seed_member_rows(monkeypatch, m, [_adversarial_source(f"m{i} r{k}") for k in range(12)])
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setattr(svc, "server_lanes_stamp", lambda row: {})    # pre-existing, not admission
    rt._reset_capability_cache(persisted=True)
    calls = _count_detector(monkeypatch)
    walls, errors = {}, []
    start = threading.Barrier(len(members))

    def one(m):
        try:
            start.wait()
            t0 = time.perf_counter()
            body = router_mod.list_definitions(user={"id": m, "role": "admin", "plan": "premium"},
                                               graph=False, engine=None)
            walls[m] = time.perf_counter() - t0
            assert len(body["definitions"]) == 12
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
    threads = [threading.Thread(target=one, args=(m,)) for m in members]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert max(walls.values()) < 1.0, walls
    # ONE detector run in the whole burst: the gate refuses a second while it runs, and the cool-down
    # after it (2x its cost) outlasts every request. Without the gate, runs overlap (measured 5).
    assert len(calls) == 1, len(calls)


def test_GATE_a_busy_gate_serves_pending_and_never_waits(store, monkeypatch):
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    row = {"def_id": ADX["id"], "definition": member_doc()}
    assert rt._DETECTOR_GATE.acquire(blocking=False)
    try:
        t0 = time.perf_counter()
        served = rt.stamp_served(row, budget=rt.DetectorBudget())
        assert time.perf_counter() - t0 < 0.2                         # it did not wait
        meta = served["definition"]["meta"]
        assert "still being checked" in meta["runtimeNotGraded"] and meta["runtimePending"] is True
        assert _client().post("/api/user-definitions/runtime-admission",
                              json={"source": MEMBER_COPY}).json()["missing"] == [rt.PENDING]
    finally:
        rt._DETECTOR_GATE.release()
    assert rt.stamp_served(row, budget=rt.DetectorBudget()) is row       # the gate free: admitted


def _hold_gate(seconds: float) -> threading.Thread:
    """A thread that holds the process-wide detector gate for `seconds`."""
    held = threading.Event()

    def hold():
        assert rt._DETECTOR_GATE.acquire(timeout=5)
        held.set()
        time.sleep(seconds)
        rt._DETECTOR_GATE.release()
    t = threading.Thread(target=hold)
    t.start()
    assert held.wait(5)
    return t


def _hold_gate_until(release: threading.Event) -> threading.Thread:
    """A thread that holds the process-wide detector gate until `release` is set (30 s at most, so a
    failing test cannot hang the run). The busy state then lasts exactly as long as the test needs it,
    whatever the runner's speed."""
    held = threading.Event()

    def hold():
        assert rt._DETECTOR_GATE.acquire(timeout=5)
        held.set()
        release.wait(30)
        rt._DETECTOR_GATE.release()
    t = threading.Thread(target=hold)
    t.start()
    assert held.wait(5)
    return t


def test_F1_a_save_never_stores_an_unadmitted_row_while_the_check_is_busy(store, monkeypatch):
    """D6 holds: only a graded script is stored. A save waits at most `SAVE_WAIT_SECONDS` for the
    detector; past that it is refused as busy (retryable, 503), and nothing is stored.

    ⛔ The gate is held until the test RELEASES it, never for a fixed time. It was held for
    `SAVE_WAIT_SECONDS + 1.0` (1.7 s): the direct save times out at 0.7 s and the HTTP save then waits its own
    0.7 s, so the 503 needed the work between them (`svc.get`, building the FastAPI app and TestClient, the
    request's own work before the gate) to finish within 0.3 s. On the pine-twins leg (1262 tests in one process
    on a GitHub runner) it did not, the gate came free inside the HTTP save's wait, and the save stored: 200
    (run 44029625436 on #1541's 8c7d1c2303; the same test is green 3/3 alone on master and on that head). A wall
    clock in a test is a function of the runner's load (lesson_an_intermittent_red_can_be_a_population_not_a_test)."""
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    release = threading.Event()
    holder = _hold_gate_until(release)
    try:
        t0 = time.perf_counter()
        with pytest.raises(rt.CapabilityCheckBusy, match="try again in a moment"):
            svc.save(USER, ADX["id"], member_doc(), role="admin")
        assert time.perf_counter() - t0 < rt.SAVE_WAIT_SECONDS + 0.5          # bounded
        assert svc.get(USER, ADX["id"]) is None                                # nothing stored
        r = _client().post("/api/user-definitions", json={"definition": member_doc()})
        assert r.status_code == 503 and r.headers.get("Retry-After") and r.json()["retryable"] is True
        assert svc.get(USER, ADX["id"]) is None                                # nothing stored by HTTP either
    finally:
        release.set()
        holder.join(10)
    with sqlite3.connect(svc._DB_PATH) as c:
        c.execute(rt._CAPS_DDL)
        assert c.execute(f"SELECT COUNT(*) FROM {rt.CAPS_TABLE}").fetchone()[0] == 0


def test_F1_a_save_waits_out_a_short_busy_spell_and_stores_the_checked_row(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    holder = _hold_gate(0.2)
    try:
        svc.save(USER, ADX["id"], member_doc(), role="admin")                 # waited, checked, stored
    finally:
        holder.join(10)
    assert svc.get(USER, ADX["id"])["definition"]["compute"]["source"] == MEMBER_COPY
    with sqlite3.connect(svc._DB_PATH) as c:
        assert c.execute(f"SELECT COUNT(*) FROM {rt.CAPS_TABLE}").fetchone()[0] == 1


def test_F1_a_save_of_an_unadmitted_script_is_refused_not_stored(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    # (a table was the unadmitted example until DRAW-1 admitted obj:table and obj:box, then a linefill until PARITY
    # UNIT LF admitted obj:linefill; a polyline is not admitted)
    doc = member_doc(MEMBER_COPY + POLYLINE_SNIPPET)
    with pytest.raises(ValueError, match="not yet been graded"):
        svc.save(USER, ADX["id"], doc, role="admin")
    assert svc.get(USER, ADX["id"]) is None


def test_GATE_a_run_is_projected_before_it_starts(store, monkeypatch):
    """The 0.9 s edge: a request that has spent part of its budget does not START a run whose
    projected cost would cross it (a 60 KB source first, then the adversarial near-cap shape)."""
    first = _near_cap_source("small first", 60)
    srcs = [first] + [_adversarial_source(f"edge {k}") for k in range(20)]
    _seed_member_rows(monkeypatch, USER, srcs)
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setattr(svc, "server_lanes_stamp", lambda row: {})
    monkeypatch.setattr(rt, "_SECONDS_PER_BYTE", [2.5e-6])            # a calibrated estimate
    monkeypatch.setattr(rt, "DETECTOR_DUTY_CYCLE", 1.0)               # the projection alone, no cool-down
    rt._reset_capability_cache(persisted=True)
    calls = _count_detector(monkeypatch)
    rows = sorted(svc.list_for_user(USER), key=lambda r: len(r["definition"]["compute"]["source"]))
    budget = rt.DetectorBudget()
    t0 = time.perf_counter()
    for r in rows:
        rt.stamp_served(r, budget=budget)
    assert time.perf_counter() - t0 < 1.0
    assert len(calls) == 1, len(calls)                                # the small one; no big one after it


def test_GATE_one_big_source_per_request():
    b = rt.DetectorBudget(runs=8, seconds=10)
    big = rt.DETECTOR_BIG_SOURCE_BYTES + 1
    assert b.allows(big)
    b.charge(big, 0.01)
    assert not b.allows(big) and b.allows(1000)
    first = rt.DetectorBudget(runs=8, seconds=0.3)
    assert first.allows(10 ** 6)                                       # the first run always may start


def test_GATE_a_run_in_progress_refuses_a_second_concurrently(store, monkeypatch):
    """Deterministic: while one detector run holds the gate, a second request's run is refused at once
    (pending), whatever the timing of the threads. (A timing-only burst can miss an overlap.)"""
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setattr(rt, "DETECTOR_DUTY_CYCLE", 1.0)              # the gate alone
    rt._reset_capability_cache(persisted=True)
    started, release = threading.Event(), threading.Event()
    first = []

    def slow_then_fast(src):
        if not first:
            first.append(1)
            started.set()
            assert release.wait(10)
        return frozenset({"core"})
    monkeypatch.setattr(pc, "capabilities_of", slow_then_fast)
    holder = threading.Thread(target=lambda: rt.capabilities_for(MEMBER_COPY + "// first\n", persist=False))
    holder.start()
    try:
        assert started.wait(10)
        t0 = time.perf_counter()
        got = rt.capabilities_for(MEMBER_COPY + "// second\n", budget=rt.DetectorBudget(), persist=False)
        assert got is None and time.perf_counter() - t0 < 0.2       # refused, without waiting
    finally:
        release.set()
        holder.join(10)
    assert rt.capabilities_for(MEMBER_COPY + "// second\n", budget=rt.DetectorBudget(), persist=False) is not None



# ═══ RE-REVIEW F2: one hammering member cannot starve another member's check ═════════════

def test_F2_the_verdict_door_spends_from_the_members_own_budget(monkeypatch):
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    rt._reset_capability_cache(persisted=True)
    now = time.monotonic()
    rt._verdict_member_charge("u-hammer", now, rt.VERDICT_MEMBER_SECONDS)
    assert rt.runtime_admission(MEMBER_COPY + "// h\n", member="u-hammer")["missing"] == [rt.PENDING]
    assert rt.runtime_admission(MEMBER_COPY + "// o\n", member="u-other")["admitted"] is True
    rt._reset_capability_cache(persisted=True)


def test_F2_a_verdict_run_yields_to_persisted_work(monkeypatch):
    """A verdict run cools only the verdict door: a serve right after it may run; a second verdict may not."""
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    rt._reset_capability_cache(persisted=True)
    assert rt.runtime_admission(MEMBER_COPY + "// v1\n", member="u-a")["admitted"] is True
    assert rt.runtime_admission(MEMBER_COPY + "// v2\n", member="u-b")["missing"] == [rt.PENDING]
    assert rt.capabilities_for(MEMBER_COPY + "// serve\n", budget=rt.DetectorBudget()) is not None
    rt._reset_capability_cache(persisted=True)


def test_F2_a_hammering_member_cannot_keep_another_members_save_and_serve_from_being_checked(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setattr(svc, "server_lanes_stamp", lambda row: {})
    rt._reset_capability_cache(persisted=True)
    stop = threading.Event()
    answers = []

    def hammer():
        k = 0
        while not stop.is_set():
            answers.append(rt.runtime_admission(_adversarial_source(f"hammer {k}"), member="u-hammer"))
            k += 1
    h = threading.Thread(target=hammer)
    h.start()
    try:
        time.sleep(0.3)                                                       # the hammer is running
        svc.save(USER, ADX["id"], member_doc(), role="admin")                 # never refused as busy
        assert svc.get(USER, ADX["id"]) is not None
        # another member's stored, not-yet-checked row is checked on a serve within a few reads
        other = "u-other-member"
        _seed_member_rows(monkeypatch, other, [_near_cap_source("other member row", 20)])
        checked = False
        for _ in range(20):
            body = router_mod.list_definitions(user={"id": other, "role": "admin", "plan": "premium"},
                                               graph=False, engine=None)
            if "runtimePending" not in (body["definitions"][0]["definition"].get("meta") or {}):
                checked = True
                break
            time.sleep(0.15)
        assert checked
    finally:
        stop.set()
        h.join(30)
    assert any(a["missing"] == [rt.PENDING] for a in answers)                 # the hammer was held back
    spent = rt._verdict_member_spent("u-hammer", time.monotonic())
    assert spent <= rt.VERDICT_MEMBER_SECONDS + 1.0                          # its own budget, plus one run


# ═══ RE-REVIEW F3 / F4 ══════════════════════════════════════════════════════════════════

def test_F3_a_single_row_serve_marks_pending_too(store, monkeypatch):
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    row = {"def_id": ADX["id"], "definition": member_doc()}
    holder = _hold_gate(0.5)
    try:
        meta = rt.stamp_served(row)["definition"]["meta"]                    # budget None: GET /{id}, a share
    finally:
        holder.join(10)
    assert "still being checked" in meta["runtimeNotGraded"] and meta["runtimePending"] is True


def test_F4_a_written_back_stamp_is_never_stored_and_never_served(store, monkeypatch):
    monkeypatch.setenv(rt.SAVE_ENV, "1")
    monkeypatch.setenv(rt.STAGE_ENV, "admins")
    doc = copy.deepcopy(ADX)                                                   # the graded script itself
    doc["meta"].update(runtimePending=True, runtimeNotGraded="stale", runtimeKilled="stale")
    svc.save(USER, ADX["id"], doc, role="admin")
    stored = svc.get(USER, ADX["id"])["definition"]["meta"]
    assert not any(k in stored for k in rt.RUN_READ_STAMPS)                   # scrubbed at save
    # a row that already carries a stale stamp (stored before the scrub) is served without it
    with sqlite3.connect(svc._DB_PATH) as c:
        rid, blob = c.execute("SELECT id, definition FROM user_definitions WHERE def_id = ?", (ADX["id"],)).fetchone()
        d = json.loads(blob)
        d["meta"].update(runtimePending=True, runtimeNotGraded="stale")
        c.execute("UPDATE user_definitions SET definition = ? WHERE id = ?", (json.dumps(d), rid))
    served = _client().get(f"/api/user-definitions/{ADX['id']}").json()["definition"]["meta"]
    assert not any(k in served for k in rt.RUN_READ_STAMPS)


def test_F2_the_route_charges_the_calling_members_own_budget(store, monkeypatch):
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    rt._reset_capability_cache(persisted=True)
    router_mod._runtime_admission_calls.clear()
    assert _client().post("/api/user-definitions/runtime-admission",
                          json={"source": MEMBER_COPY + "// route\n"}).json()["admitted"] is True
    assert rt._verdict_member_spent(USER, time.monotonic()) > 0
    assert rt._verdict_member_spent("<anonymous>", time.monotonic()) == 0
    rt._reset_capability_cache(persisted=True)
