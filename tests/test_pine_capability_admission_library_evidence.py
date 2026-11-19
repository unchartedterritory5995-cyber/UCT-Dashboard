"""Libraries chain L1 (2026-11-19): admission evidence for a library version carries the pin it was graded with.

`rollout_gate.pine_capability_admission` counts a `library:<Author>/<Lib>/<N>` row's evidence only when the
entry names that path AND the sha256 the row pins (U15). `capability_admission.py evidence` now stamps each
library capability's entry with the version the member door LINKED for that script (the lanes measurement's
`libraries`, the document's own `meta.libraries` pins), and drops the entry when the door linked nothing for
it: an empty store, or a version it refused, is no evidence for that version.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))

import capability_admission as ca  # noqa: E402
from api.services import rollout_gate as rg  # noqa: E402

LIB = "TradingView/ta/7"
CAP = "library:" + LIB
SHA = "c6888dbdf18c0c19fe5ba915d0df0cb2361f4f2f26f1e67953ac35a8f0d60876"
OTHER_SHA = "0" * 64


def _run(tmp_path, linked):
    """Two community capture scripts importing `LIB`, both MATCH runtime-on and drawn by the runtime lane;
    `linked` maps capture id -> the pins the door linked for it."""
    caps = ["core", "import", CAP]
    scripts = [{"key": "capture:" + cid, "population": "capture", "capture": cid, "script": title,
                "hash": "h" + cid, "caps": caps, "admitted": False, "missing": ["import", CAP]}
               for cid, title in (("a-rddt-1d", "Script A"), ("b-spy-1d", "Script B"))]
    lanes = [{"key": s["key"], "lane": "runtime", "ok": True, "libraries": linked.get(s["capture"], [])}
             for s in scripts]
    verdicts = {"results": [{"id": s["capture"], "script": s["script"], "verdict": "MATCH"} for s in scripts]}
    paths = {}
    for name, obj in (("in.json", {"scripts": scripts}), ("lanes.json", {"rows": lanes}),
                      ("verdicts.json", verdicts)):
        p = tmp_path / name
        p.write_text(json.dumps(obj), encoding="utf-8")
        paths[name] = str(p)
    out = tmp_path / "evidence.json"
    ca.cmd_evidence(argparse.Namespace(input=paths["in.json"], lanes=paths["lanes.json"],
                                       verdicts=paths["verdicts.json"], ledger=None, out=str(out)))
    return json.loads(out.read_text(encoding="utf-8"))


def _registry_row(evidence, pin=SHA):
    """The registry row a reviewer writes from the tool's evidence (verdict and pane added, as every row does)."""
    return {"admitted": True, "status": rg.PINE_CAPABILITY_CONFORMANT, "sha256": pin,
            "evidence": [dict(e, verdict=rg.PINE_CAPTURE_MATCH, runtimePane=rg.PINE_CAPTURE_PANE_ON)
                         for e in evidence]}


def test_a_library_capabilitys_evidence_carries_the_pin_the_door_linked(tmp_path):
    pin = [{"path": LIB, "sha256": SHA.upper()}]
    got = _run(tmp_path, {"a-rddt-1d": pin, "b-spy-1d": pin})
    ev = got[CAP]["evidence"]
    assert len(ev) == 2
    assert all(e["library"] == {"path": LIB, "sha256": SHA} for e in ev), ev   # lower-cased, one shape
    # a capability that is not a library version carries no pin
    assert all("library" not in e for e in got["core"]["evidence"])
    # end to end: the registry rule admits the version at the graded sha, and only at it
    assert rg.pine_capability_admission(CAP, _registry_row(ev)) == []
    assert rg.pine_capability_admission(CAP, _registry_row(ev, pin=OTHER_SHA)) != []


def test_a_script_whose_door_linked_nothing_is_no_evidence_for_the_version(tmp_path):
    """An empty store (or a version the door refused): the capture still counts for `core`, never for the library."""
    got = _run(tmp_path, {"a-rddt-1d": [{"path": LIB, "sha256": SHA}]})
    assert [e["capture"] for e in got[CAP]["evidence"]] == ["a-rddt-1d"]
    assert {e["capture"] for e in got["core"]["evidence"]} == {"a-rddt-1d", "b-spy-1d"}
    # one importing script is not enough for the row
    assert rg.pine_capability_admission(CAP, _registry_row(got[CAP]["evidence"])) != []


def test_a_pin_for_another_version_is_not_this_versions_evidence(tmp_path):
    got = _run(tmp_path, {"a-rddt-1d": [{"path": "TradingView/ta/8", "sha256": SHA}],
                          "b-spy-1d": [{"path": "TradingView/ta/8", "sha256": SHA}]})
    assert (got.get(CAP) or {}).get("evidence", []) == []   # no row at all: nothing graded it


def test_CONTROL_without_a_pin_the_registry_rule_refuses_the_evidence(tmp_path):
    """The reason the stamp exists: the same two MATCH captures with no `library` on their entries admit nothing."""
    pin = [{"path": LIB, "sha256": SHA}]
    ev = _run(tmp_path, {"a-rddt-1d": pin, "b-spy-1d": pin})[CAP]["evidence"]
    bare = [{k: v for k, v in e.items() if k != "library"} for e in ev]
    assert rg.pine_capability_admission(CAP, _registry_row(bare)) != []
