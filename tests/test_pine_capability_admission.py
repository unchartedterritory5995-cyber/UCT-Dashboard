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
(A6, the detector under-declaring, is `tests/test_pine_capabilities.py`.)
And: with the variable OFF (the default) every answer is the one before Part 2.
"""
from __future__ import annotations

import copy
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
FIXTURE = ROOT / "tests" / "fixtures" / "runtime_documents" / "documents.json"
DOCS = {d["slug"]: d for d in json.loads(FIXTURE.read_text(encoding="utf-8"))["documents"]}
ADX = DOCS["adx-and-di-for-v4"]["definition"]
VERDICTS_RT = ROOT / "docs" / "pine" / "vendor-harness" / "runtime-on" / "verdicts.json"
USER = "u-capadmit"

#: ⭐ THE CASE THIS SLICE EXISTS FOR: the graded ADX script with one comment line added, as a
#: member's own copy would be. Same capabilities, a different sha256, so the allowlist misses it.
MEMBER_COPY = ADX["compute"]["source"] + "\n// my own copy\n"
SWITCH_SCRIPT = ("//@version=5\nindicator('s')\nlen = input.int(14)\n"
                 "x = switch len\n    14 => close\n    => open\nplot(x)\n")


def member_doc(source: str = MEMBER_COPY) -> dict:
    d = copy.deepcopy(ADX)
    d["compute"]["source"] = source
    d["meta"].pop("runtimeSourceHash", None)
    return d


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in (rt.STAGE_ENV, rt.SAVE_ENV, rt.KILL_ENV, rt.ALLOW_ENV, rt.CAPABILITY_ADMISSION_ENV,
              rt.CAPABILITY_DENY_ENV, rt.SERVER_STAGE_ENV, rt.SERVICE_URL_ENV, rt.SERVICE_SECRET_ENV):
        monkeypatch.delenv(k, raising=False)
    rt._CAPS_CACHE.clear()
    yield
    rt._CAPS_CACHE.clear()


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
        # coordinator rulings 2026-11-13: the one evidence rule, no exceptions in either direction;
        # distinct script families, at least one community script (generics: probes only, out);
        # the array namespace on its own evidence (matrix and map have none)
        "while", "typed-array", "method-call", "collections:array"])


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
    assert set(body) == {"kill", "allow", "save_enabled"}


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
    assert "for" in rep["admitted"] and "switch" not in rep["admitted"]
    assert "conditional-ta" in rep["withheld"]
    assert rt.graded_allow_list() == ["d0853c4724651a1d3c63542a2ae767861030137cb1c75ea57a376c53a1630499"]


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
    ok, missing = rt.capability_admitted(SWITCH_SCRIPT)
    assert not ok and "switch" in missing
    assert rt.not_graded(SWITCH_SCRIPT)


def test_A2_every_vocabulary_id_outside_the_admitted_set_withholds(on):
    admitted = set(rt.admitted_capabilities()["admitted"])
    for cap in sorted(pc.CAPABILITY_IDS - admitted):
        orig = pc.capabilities_of
        try:
            pc.capabilities_of = lambda _s, c=cap: frozenset({"core", c})
            rt._CAPS_CACHE.clear()
            assert rt.capability_admitted(MEMBER_COPY) == (False, [cap]), cap
        finally:
            pc.capabilities_of = orig
            rt._CAPS_CACHE.clear()


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
        rt._CAPS_CACHE.clear()
        assert rt.capability_admitted(MEMBER_COPY) == (False, ["zz-new"])
    finally:
        pc.capabilities_of = orig
        rt._CAPS_CACHE.clear()


def test_C1_a_matrix_or_map_script_is_withheld(on):
    """The collection namespaces are admitted on their own evidence: matrix and map have none."""
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
        monkeypatch.setenv(env, "switch,while,obj:line,conditional-ta," + "a" * 64)
        assert set(rt.admitted_capabilities()["admitted"]) <= base, env
        assert not rt.capability_admitted(SWITCH_SCRIPT)[0], env
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

def test_A7_an_object_family_without_v2_run_evidence_is_not_admitted():
    assert rg.pine_capability_admission("obj:line", ROW)
    half = [dict(EV2[0], objectsV2="MATCH", objectsLane="runtime"), dict(EV2[1], objectsV2="MATCH")]
    assert rg.pine_capability_admission("obj:line", dict(ROW, evidence=half))
    host = [dict(e, objectsV2="MATCH", objectsLane="host") for e in EV2]
    assert rg.pine_capability_admission("obj:line", dict(ROW, evidence=host))


def test_A7_control_with_v2_run_evidence_it_would_admit():
    full = [dict(e, objectsV2="MATCH", objectsLane="runtime") for e in EV2]
    assert rg.pine_capability_admission("obj:line", dict(ROW, evidence=full)) == []


def test_A7_no_object_family_is_admitted_in_the_committed_registry():
    rep = rt.admitted_capabilities()
    assert not [c for c in rep["admitted"] if c.startswith("obj:")]
    doc = json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    assert not [c for c, r in doc["capabilities"].items() if c.startswith("obj:") and r.get("admitted") is True]


def test_A7_an_object_drawing_member_script_is_withheld(on):
    src = MEMBER_COPY + "var line l = na\nl := line.new(bar_index, low, bar_index, high)\n"
    ok, missing = rt.capability_admitted(src)
    assert not ok and "obj:line" in missing


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
            fixture = ROOT / r["file"]
            if not fixture.is_file():
                bad.append((cap, cid, "no fixture"))
                continue
            text = (json.loads(fixture.read_text(encoding="utf-8")).get("source") or {}).get("text")
            if cap not in pc.capabilities_of(text):
                bad.append((cap, cid, "the capture's script does not use it"))
    return bad


def test_A8_no_phantom_evidence():
    doc = json.loads(Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    assert _phantoms(doc["capabilities"]) == []
    v = _verdicts()
    assert json.loads(VERDICTS_RT.read_text(encoding="utf-8"))["lane"] == "runtime-on"
    for cap, row in doc["capabilities"].items():
        if row.get("admitted") is True:
            assert rg.pine_capability_admission(cap, row) == [], cap
            assert all(v[e["capture"]]["verdict"] == "MATCH" for e in row["evidence"])


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
    got = {(c, why) for c, _id, why in _phantoms(fake)}
    assert ("for", "no such capture in the runtime-on verdicts") in got
    assert ("for", "runtime-on verdict is DIVERGE") in got
    assert ("for", "names another script") in got
    assert ("for", "states the wrong community flag") in got
    assert ("obj:polyline", "the capture's script does not use it") in got


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
    body = _client().post("/api/user-definitions/runtime-admission", json={"source": SWITCH_SCRIPT}).json()
    assert body["admitted"] is False and "switch" in body["missing"]


def test_the_door_with_the_flag_off_admits_nothing(store):
    body = _client().post("/api/user-definitions/runtime-admission", json={"source": MEMBER_COPY}).json()
    assert body == {"sha256": rt.source_hash(MEMBER_COPY), "admitted": False, "missing": []}


def test_B1_with_the_flag_off_the_door_never_runs_the_detector(store, monkeypatch):
    """B1a: OFF answers a constant; no request can spend server time on a door that admits nothing."""
    def boom(_s):
        raise AssertionError("the detector ran with the flag off")
    monkeypatch.setattr(pc, "capabilities_of", boom)
    rt._CAPS_CACHE.clear()
    r = _client().post("/api/user-definitions/runtime-admission", json={"source": MEMBER_COPY + "// x\n"})
    assert r.status_code == 200 and r.json()["admitted"] is False


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

REPORT = ROOT / "docs" / "pine" / "evidence" / "2026-11-13-capability-admission" / "runs" / "report.json"
VERDICTS_PROD = ROOT / "docs" / "pine" / "vendor-harness" / "production" / "verdicts.json"


def reach_rule_violations(report: dict, rt_verdicts: dict, prod_verdicts: dict) -> list:
    rton = {r["id"]: r["verdict"] for r in rt_verdicts["results"]}
    prod = {r["id"]: r["verdict"] for r in prod_verdicts["results"]}
    out = []
    if rt_verdicts.get("lane") != "runtime-on" or prod_verdicts.get("lane") != "production":
        out.append("a snapshot is not the lane it is read as")
    for c in report["captures"]:
        if c["lane"] == "runtime" and rton.get(c["capture"]) != "MATCH" and rton.get(c["capture"]) != "INCONCLUSIVE":
            out.append(f"{c['capture']}: drawn by the runtime lane and graded {rton.get(c['capture'])}")
    for cid, v in prod.items():
        if v == "MATCH" and rton.get(cid) == "DIVERGE":
            out.append(f"{cid}: MATCH -> DIVERGE")
    return out


def _admitted_capture_ids() -> set:
    out = set()
    for r in _verdicts().values():
        try:
            text = (json.loads((ROOT / r["file"]).read_text(encoding="utf-8")).get("source") or {}).get("text")
        except (OSError, ValueError):
            continue
        if isinstance(text, str) and text.strip() and rt.capability_admitted(text)[0]:
            out.add(r["id"])
    return out


def test_REACH_the_committed_reach_run_is_the_committed_registrys():
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    assert {c["capture"] for c in report["captures"]} == _admitted_capture_ids()
    assert report["stops"] == [] and report["matchToDiverge"] == []
    assert sum(1 for c in report["captures"] if c["lane"] == "runtime") >= 10   # not vacuous


def test_REACH_no_runtime_lane_DIVERGE_and_no_MATCH_to_DIVERGE():
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    problems = reach_rule_violations(report, json.loads(VERDICTS_RT.read_text(encoding="utf-8")),
                                     json.loads(VERDICTS_PROD.read_text(encoding="utf-8")))
    assert problems == [], problems


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
