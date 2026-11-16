"""RS RATING L8 -- the run half's object evidence, served from the SAME committed allowlist records.

`runtime_definitions.run_half_evidence` reports, for every SERVED allowlist record, its captures
that carry an `objectsV2` grade; `GET /api/user-definitions/runtime-kill` serves them as
`run_half_evidence` (ABSENT when empty); the member door latches them into
`engine/runHalfRailSeam.js::setRunHalfObjectEvidence`, which alone decides admission (2 distinct
captures, each MATCH, objects-v2 MATCH, runtime pane on; railed in
app/src/components/chart/engine/runHalfEvidenceLatch.test.js). Here:
  E1 by default nothing is served and the kill read keeps exactly its keys;
  E2 a served record's objects-v2 captures are passed on as the facts they record;
  E3 a withheld record, a prefix sha, a record with no objects-v2 capture contribute nothing;
  E4 every committed objects-v2 claim is a real runtime-on grade (with a control that can fail);
  E5 (L9) the L7 substituted path: a substituted record's MATCH_SUBSTITUTED captures count only when
     their own names equal the record's; a record without `admission` never counts them; < 2 never;
  E6 (L9) the server rule answers every case of tests/fixtures/ast/run_half_evidence_parity.json,
     which the client rule (runHalfEvidenceLatch.test.js) answers too.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services import runtime_definitions as rt

REPO = pathlib.Path(__file__).resolve().parents[1]
VERDICTS = REPO / "docs" / "pine" / "vendor-harness" / "runtime-on" / "verdicts.json"
REG = {"a": {"status": "conformant", "evidence": ["cap-1"]}}


def _cap(cid, verdict="MATCH", v2="MATCH", pane="on"):
    c = {"id": cid, "verdict": verdict, "runtimePane": pane}
    if v2 is not None:
        c["objectsV2"] = v2
    return c


def _allowlist(tmp_path, monkeypatch, scripts):
    f = tmp_path / "allow.json"
    f.write_text(json.dumps({"_readme": [], "scripts": scripts, "capabilities": REG}), encoding="utf-8")
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(f))


def _kill_read():
    from api.routers import user_definitions as router
    return router.runtime_kill(user={"id": "u1"})


# ── E1 ───────────────────────────────────────────────────────────────────────────────

def test_E1_by_default_nothing_is_served_and_the_kill_read_keeps_its_keys(tmp_path, monkeypatch):
    """A list whose records carry no objects-v2 capture serves no evidence, and the key is ABSENT."""
    monkeypatch.delenv("PINE_RUNTIME_CAPABILITY_ADMISSION", raising=False)
    _allowlist(tmp_path, monkeypatch, [{"slug": "plain", "sha256": "d" * 64, "capabilities": ["a"], "captures": [
        _cap("p-rddt", v2=None), _cap("p-spy", v2=None)]}])
    assert rt.run_half_evidence() == []
    got = _kill_read()
    assert "run_half_evidence" not in got
    assert set(got) <= {"kill", "allow", "save_enabled", "capability_admission", "substituted"}


def test_E1b_the_committed_list_serves_RS_Ratings_evidence_and_nothing_elses():
    """RS Rating (fred6724), admitted 2026-11-16 on the substituted path: its three captures, each
    objects v2 MATCH_SUBSTITUTED for exactly the record's substituted names. The MATCH-only record
    beside it (adx-and-di-for-v4) carries no objects-v2 capture and serves none."""
    ev = rt.run_half_evidence()
    assert [e["sha256"] for e in ev] == ["caa94fe31a8788c0f52ca571dbb1b3f8a7499dae913ed5e710720fc8662c5af0"]
    assert ev[0]["admission"] == "substituted" and ev[0]["substituted"] == ["syminfo.industry"]
    assert [c["capture"] for c in ev[0]["captures"]] == [
        f"rs-rating-fred6724-{s}-1d-2026-11-15" for s in ("rddt", "alab", "crwv")]
    assert all(c["verdict"] == "MATCH_SUBSTITUTED" and c["objectsV2"] is False and c["runtimeOn"] is True
               and c["objectsV2Substituted"] == ["syminfo.industry"] for c in ev[0]["captures"])
    assert _kill_read()["run_half_evidence"] == ev


# ── E2 ───────────────────────────────────────────────────────────────────────────────

def test_E2_a_served_records_objects_v2_captures_are_passed_on_as_recorded(tmp_path, monkeypatch):
    sha = "c" * 64
    _allowlist(tmp_path, monkeypatch, [{"slug": "rs", "sha256": sha, "capabilities": ["a"], "captures": [
        _cap("x-rddt"), _cap("x-nvda"), _cap("x-spy", v2="DIVERGE"), _cap("x-old", v2=None)]}])
    ev = rt.run_half_evidence()
    assert ev == [{"sha256": sha, "captures": [
        {"capture": "x-rddt", "verdict": "MATCH", "objectsV2": True, "runtimeOn": True},
        {"capture": "x-nvda", "verdict": "MATCH", "objectsV2": True, "runtimeOn": True},
        {"capture": "x-spy", "verdict": "MATCH", "objectsV2": False, "runtimeOn": True},
    ]}]
    assert _kill_read()["run_half_evidence"] == ev


# ── E3 ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("record", [
    # withheld: no MATCH capture with the pane on (R1)
    {"slug": "w1", "sha256": "d" * 64, "capabilities": ["a"], "captures": [_cap("y", pane="off")]},
    # withheld: a capability not in the registry
    {"slug": "w2", "sha256": "d" * 64, "capabilities": ["zz"], "captures": [_cap("y")]},
    # a sha256 PREFIX admits on the allowlist but names no one script's evidence
    {"slug": "w3", "sha256": "d" * 20, "capabilities": ["a"], "captures": [_cap("y")]},
    # served, but no capture carries an objects-v2 grade
    {"slug": "w4", "sha256": "d" * 64, "capabilities": ["a"], "captures": [_cap("y", v2=None)]},
])
def test_E3_records_that_contribute_nothing(tmp_path, monkeypatch, record):
    _allowlist(tmp_path, monkeypatch, [record])
    assert rt.run_half_evidence() == []
    assert "run_half_evidence" not in _kill_read()


def test_E3_an_unreadable_allowlist_serves_no_evidence(tmp_path, monkeypatch):
    monkeypatch.setattr(rt, "ALLOWLIST_PATH", str(tmp_path / "missing.json"))
    assert rt.run_half_evidence() == []


# ── E4 ───────────────────────────────────────────────────────────────────────────────

def _false_claims(scripts, results):
    by_id = {r.get("id"): r for r in results}
    bad = []
    for s in scripts:
        for c in s.get("captures") or []:
            if not isinstance(c, dict) or "objectsV2" not in c:
                continue
            r = by_id.get(c.get("id"))
            if r is None:
                bad.append(f"{s.get('slug')}: {c.get('id')} is not in the runtime-on verdicts")
                continue
            if c.get("verdict") != r.get("verdict"):
                bad.append(f"{s.get('slug')}: {c.get('id')} says {c.get('verdict')}, graded {r.get('verdict')}")
            v2 = (r.get("objectsV2") or {}).get("verdict")
            if c.get("objectsV2") != v2:
                bad.append(f"{s.get('slug')}: {c.get('id')} says objectsV2 {c.get('objectsV2')}, graded {v2}")
    return bad


def test_E4_every_committed_objects_v2_claim_is_a_real_runtime_on_grade():
    doc = json.loads(pathlib.Path(rt.ALLOWLIST_PATH).read_text(encoding="utf-8"))
    results = json.loads(VERDICTS.read_text(encoding="utf-8"))["results"]
    assert _false_claims(doc["scripts"], results) == []
    # CONTROL: a claim the verdicts do not support is caught, by name
    real = next(r for r in results if r.get("verdict") == "DIVERGE")
    fake = [{"slug": "fake", "captures": [_cap(real["id"]), _cap("no-such-capture")]}]
    got = _false_claims(fake, results)
    assert any("says MATCH, graded DIVERGE" in g for g in got) and any("not in the runtime-on verdicts" in g for g in got)


# ── E5 (RS RATING L9) ── the L7 substituted path, never a looser rule ─────────────────────
# A record with `admission: "substituted"` and `substituted: [names]` counts captures graded
# MATCH_SUBSTITUTED (objects-v2 MATCH, runtime pane on) whose OWN names equal the record's; a
# record without `admission` still counts MATCH only. The server serves only entries the rule
# admits; the client re-applies the same rule on what it receives. Both read
# tests/fixtures/ast/run_half_evidence_parity.json, so the two cannot drift.

NAMES = ["syminfo.industry"]
PARITY = json.loads((REPO / "tests" / "fixtures" / "ast" / "run_half_evidence_parity.json")
                    .read_text(encoding="utf-8"))


def _sub(cid, names=NAMES, verdict="MATCH_SUBSTITUTED", v2="MATCH", pane="on"):
    c = _cap(cid, verdict=verdict, v2=v2, pane=pane)
    if names is not None:
        c["substituted"] = list(names)
    return c


def _sub_record(captures, names=NAMES):
    return {"slug": "rs", "sha256": "e" * 64, "capabilities": ["a"], "admission": "substituted",
            "substituted": list(names), "captures": captures}


def test_E5_control_substituted_record_is_served_with_what_the_client_needs(tmp_path, monkeypatch):
    _allowlist(tmp_path, monkeypatch, [_sub_record([_sub("x-rddt"), _sub("x-nvda")])])
    ev = rt.run_half_evidence()
    assert ev == [{"sha256": "e" * 64, "admission": "substituted", "substituted": NAMES, "captures": [
        {"capture": "x-rddt", "verdict": "MATCH_SUBSTITUTED", "objectsV2": True, "runtimeOn": True,
         "substituted": NAMES},
        {"capture": "x-nvda", "verdict": "MATCH_SUBSTITUTED", "objectsV2": True, "runtimeOn": True,
         "substituted": NAMES},
    ]}]
    assert _kill_read()["run_half_evidence"] == ev


def test_E5_substituted_captures_on_a_record_without_admission_are_not_evidence(tmp_path, monkeypatch):
    # served on R1 by its MATCH capture (no objects-v2 grade); its two objects-v2 captures are
    # MATCH_SUBSTITUTED, which the plain path never counts
    rec = {"slug": "rs", "sha256": "e" * 64, "capabilities": ["a"],
           "captures": [_cap("x-served", v2=None), _sub("x-rddt"), _sub("x-nvda")]}
    _allowlist(tmp_path, monkeypatch, [rec])
    assert rt.allow_report(with_capabilities=False)["served"], "the record itself is served"
    assert rt.run_half_evidence() == []


def test_E5_captures_naming_other_inputs_are_not_evidence(tmp_path, monkeypatch):
    rec = _sub_record([_sub("x-served", v2=None),                       # serves the record (R1/L7)
                       _sub("x-rddt", names=["syminfo.sector"]),
                       _sub("x-nvda", names=["syminfo.industry", "syminfo.sector"])])
    _allowlist(tmp_path, monkeypatch, [rec])
    assert rt.allow_report(with_capabilities=False)["served"], "the record itself is served"
    assert rt.run_half_evidence() == []


def test_E5_fewer_than_two_distinct_substituted_captures_are_not_evidence(tmp_path, monkeypatch):
    for caps in ([_sub("x-rddt")], [_sub("x-rddt"), _sub("x-rddt")]):
        _allowlist(tmp_path, monkeypatch, [_sub_record(caps)])
        assert rt.run_half_evidence() == [], caps


# ── E6 ── the parity cases, server side ────────────────────────────────────────────────────

def test_E6_the_server_rule_answers_every_parity_case():
    assert PARITY["min_captures"] == rt.RUN_HALF_EVIDENCE_MIN_CAPTURES
    wrong = [c["name"] for c in PARITY["cases"] if rt.run_half_entry_admits(c["entry"]) is not c["admits"]]
    assert wrong == []
    assert any(c["admits"] for c in PARITY["cases"]) and any(not c["admits"] for c in PARITY["cases"])


# ── E7 (L9b) ── on the substituted path, objects-v2 may itself grade MATCH_SUBSTITUTED ─────────
# Coordinator ruling 2026-11-15 (after owner ruling (a)): a substituted run's drawings grade
# MATCH_SUBSTITUTED, never MATCH, so on a substituted record the objects-v2 grade may be
# MATCH_SUBSTITUTED when its own names (`objectsV2Substituted`) are exactly the record's.

def _sub_v2(cid, v2_names=NAMES):
    c = _sub(cid, v2="MATCH_SUBSTITUTED")
    if v2_names is not None:
        c["objectsV2Substituted"] = list(v2_names)
    return c


def test_E7_control_substituted_objects_v2_is_served_and_admits(tmp_path, monkeypatch):
    _allowlist(tmp_path, monkeypatch, [_sub_record([_sub_v2("x-rddt"), _sub_v2("x-nvda")])])
    ev = rt.run_half_evidence()
    assert [c["objectsV2Substituted"] for c in ev[0]["captures"]] == [NAMES, NAMES]
    assert [c["objectsV2"] for c in ev[0]["captures"]] == [False, False]
    assert _kill_read()["run_half_evidence"] == ev


def test_E7_substituted_objects_v2_naming_other_inputs_or_none_is_not_evidence(tmp_path, monkeypatch):
    for v2_names in (["syminfo.sector"], [], None):
        _allowlist(tmp_path, monkeypatch, [_sub_record([_sub_v2("x-rddt"), _sub_v2("x-nvda", v2_names)])])
        assert rt.run_half_evidence() == [], v2_names


def test_E7_substituted_objects_v2_never_counts_on_a_plain_record(tmp_path, monkeypatch):
    rec = {"slug": "rs", "sha256": "e" * 64, "capabilities": ["a"], "captures": [
        _cap("x-rddt", v2="MATCH_SUBSTITUTED"), _cap("x-nvda", v2="MATCH_SUBSTITUTED")]}
    for c in rec["captures"]:
        c["objectsV2Substituted"] = list(NAMES)
    _allowlist(tmp_path, monkeypatch, [rec])
    assert rt.allow_report(with_capabilities=False)["served"], "the record itself is served"
    assert rt.run_half_evidence() == []
