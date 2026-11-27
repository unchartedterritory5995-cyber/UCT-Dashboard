# -*- coding: utf-8 -*-
"""#2848 ruling (b): a regenerated snapshot never carries this machine's local licence-held built-in listing.

The corpus harness writes `sourceHeldStore` from every file of the local built-in source store. The regen tool
(`tools/vendor_harness/prune_source_held.mjs`, after the splice) keeps the pins master's snapshot already carries and
the pins a row cites, and drops every other pin.
The real case: #2848's unpruned regen (131263b7e6) listed STD;Bollinger%1Bars (this PC's, staged for a capture not
committed yet) and STD;VWAP (master carries it). The ruling keeps VWAP and drops Bollinger.
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "vendor_harness"))

import regenerate_snapshots as RS  # noqa: E402

PRUNE = os.path.join(ROOT, "tools", "vendor_harness", "prune_source_held.mjs")
# #2848's real unpruned listing, both lanes (131263b7e6)
BOLL = {"id": "STD;Bollinger%1Bars", "sha256": "aa9fbace8e1573174be41bec7b770ad11ee617b3f4085a8703e358fc4d26f49d"}
VWAP = {"id": "STD;VWAP", "sha256": "670d21c04b7d81b5ec5dfd0d614386628b8e020a1f2e12514a9ae83b77bb1541"}
ROWS = [
    {"id": "vw-plotshape-top-spy-1d-2026-11-26", "file": "tests/fixtures/vendor/harness/vw-plotshape-top-spy-1d-2026-11-26.json",
     "verdict": "MATCH", "x": 0.1, "y": 1e-07},
    {"id": "kernel-channel-backquant-regime-spy-1d-2026-11-26", "verdict": "INCONCLUSIVE",
     "file": "tests/fixtures/vendor/harness/kernel-channel-backquant-regime-spy-1d-2026-11-26.json"},
]

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is required for the snapshot serialiser")


def _write(path, doc):
    # the harness's own layout: JSON.stringify(doc, null, 1) + '\n'
    path.write_bytes(subprocess.check_output(
        ["node", "-e", "process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]), null, 1) + '\\n')",
         json.dumps(doc)]))
    return path


def _prune(snap, master):
    return subprocess.run(["node", PRUNE, str(snap), str(master)], capture_output=True, text=True, check=True).stdout


def _rows_text(text):
    return text[text.index('"results"'):]


@pytest.mark.parametrize("lane", ["production", "runtime-on"])
def test_the_real_case_bollinger_local_is_dropped_and_masters_vwap_kept(tmp_path, lane):
    # master's committed snapshot is the baseline, read as the regen reads it
    master = tmp_path / "master.json"
    master.write_text(open(RS.SH.SNAPSHOTS[lane], encoding="utf-8").read(), encoding="utf-8")
    assert json.loads(master.read_text(encoding="utf-8")).get("sourceHeldStore") == [VWAP], \
        "fixture premise: master carries VWAP only"
    snap = _write(tmp_path / "verdicts.json", {"lane": lane, "sourceHeldStore": [BOLL, VWAP], "results": ROWS})
    before = snap.read_text(encoding="utf-8")
    out = _prune(snap, master)
    after = snap.read_text(encoding="utf-8")
    assert json.loads(after)["sourceHeldStore"] == [VWAP]
    assert "Bollinger" not in after
    assert "dropped 1" in out
    assert _rows_text(after) == _rows_text(before)   # every record byte-identical


def test_a_pin_a_row_cites_is_kept_though_master_lacks_it(tmp_path):
    master = _write(tmp_path / "master.json", {"lane": "production", "results": []})
    rows = ROWS + [{"id": "builtin-bb-spy-1d", "verdict": "MATCH", "sourceHeld": ["source/%s@%s" % (BOLL["id"], BOLL["sha256"])]}]
    snap = _write(tmp_path / "verdicts.json", {"lane": "production", "sourceHeldStore": [BOLL], "results": rows})
    _prune(snap, master)
    assert json.loads(snap.read_text(encoding="utf-8"))["sourceHeldStore"] == [BOLL]


def test_same_id_other_bytes_is_not_masters_pin(tmp_path):
    master = _write(tmp_path / "master.json", {"lane": "production", "sourceHeldStore": [VWAP], "results": []})
    other = {"id": "STD;VWAP", "sha256": "0" * 64}
    snap = _write(tmp_path / "verdicts.json", {"lane": "production", "sourceHeldStore": [other], "results": ROWS})
    _prune(snap, master)
    assert "sourceHeldStore" not in json.loads(snap.read_text(encoding="utf-8"))


def test_control_masters_own_listing_is_left_byte_identical(tmp_path):
    master = _write(tmp_path / "master.json", {"lane": "production", "sourceHeldStore": [VWAP], "results": []})
    snap = _write(tmp_path / "verdicts.json", {"lane": "production", "sourceHeldStore": [VWAP], "results": ROWS})
    before = snap.read_bytes()
    assert "dropped 0" in _prune(snap, master)
    assert snap.read_bytes() == before


def test_the_regen_prunes_each_lane_after_its_splice(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(RS.PC, "check", lambda *a, **k: ([], []))
    monkeypatch.setattr(RS, "splice_held", lambda lane, store: calls.append(("splice", lane)) or 0)
    monkeypatch.setattr(RS, "prune_source_held", lambda lane: calls.append(("prune", lane)) or 0)
    monkeypatch.setattr(RS.SH, "snapshot_store_problems", lambda doc, promoted: [])
    monkeypatch.setattr(RS.SH, "promoted_store", lambda: [])
    snaps = {}
    for lane in ("production", "runtime-on"):
        (tmp_path / lane).mkdir()
        snaps[lane] = str(_write(tmp_path / lane / "verdicts.json", {"lane": lane, "results": []}))
    monkeypatch.setattr(RS.SH, "SNAPSHOTS", snaps)
    assert RS.main(["--store", str(tmp_path), "--splice-only"]) == 0
    assert calls == [("splice", "production"), ("prune", "production"),
                     ("splice", "runtime-on"), ("prune", "runtime-on")]


def test_the_regen_refuses_when_the_prune_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(RS.PC, "check", lambda *a, **k: ([], []))
    monkeypatch.setattr(RS, "splice_held", lambda lane, store: 0)
    monkeypatch.setattr(RS, "prune_source_held", lambda lane: 3)
    assert RS.main(["--store", str(tmp_path), "--splice-only", "--lane", "production"]) == 3


def test_the_prune_refuses_when_masters_snapshot_is_unreadable(monkeypatch, tmp_path):
    # never the repo's own snapshot: a refusal that fails to refuse must not rewrite a tracked file
    snap = _write(tmp_path / "verdicts.json", {"lane": "production", "sourceHeldStore": [VWAP], "results": ROWS})
    monkeypatch.setattr(RS.SH, "SNAPSHOTS", {"production": str(snap)})
    monkeypatch.setattr(RS, "master_snapshot", lambda lane, ref=RS.MASTER_REF: None)
    ran = []
    monkeypatch.setattr(RS.subprocess, "call", lambda *a, **k: ran.append(a) or 0)
    assert RS.prune_source_held("production") == 2
    assert ran == []   # the pruner never ran without master's listing


def test_the_regen_hands_the_pruner_masters_snapshot(monkeypatch, tmp_path):
    seen = {}
    def fake_call(argv, cwd=None):
        seen["argv"] = argv
        seen["master"] = open(argv[-1], encoding="utf-8").read()
        return 0
    monkeypatch.setattr(RS.subprocess, "call", fake_call)
    monkeypatch.setattr(RS.SH, "SNAPSHOTS", {"production": str(tmp_path / "verdicts.json")})
    assert RS.prune_source_held("production", master_text='{"sourceHeldStore": []}') == 0
    assert seen["argv"][1].endswith("prune_source_held.mjs") and seen["argv"][2] == RS.SH.SNAPSHOTS["production"]
    assert seen["master"] == '{"sourceHeldStore": []}'
    assert not os.path.exists(seen["argv"][-1])   # the temp baseline is removed
