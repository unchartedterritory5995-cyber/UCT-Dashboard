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
  E4 every committed objects-v2 claim is a real runtime-on grade (with a control that can fail).
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

def test_E1_by_default_nothing_is_served_and_the_kill_read_keeps_its_keys(monkeypatch):
    monkeypatch.delenv("PINE_RUNTIME_CAPABILITY_ADMISSION", raising=False)
    assert rt.run_half_evidence() == []
    got = _kill_read()
    assert "run_half_evidence" not in got
    assert set(got) <= {"kill", "allow", "save_enabled", "capability_admission", "substituted"}


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
