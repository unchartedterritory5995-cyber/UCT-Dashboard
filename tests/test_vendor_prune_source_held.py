# -*- coding: utf-8 -*-
"""#2848 ruling (b): a regenerated snapshot never carries this machine's licence-held built-in pins.

The corpus harness writes `sourceHeldStore` from every file of the local built-in source store. The regen tool
prunes the listing to the pins its own rows cite (`tools/vendor_harness/prune_source_held.mjs`), after the splice.
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
BOLL = {"id": "STD;Bollinger%1Bars", "sha256": "a" * 64}
VWAP = {"id": "STD;VWAP", "sha256": "b" * 64}
ROWS = [
    {"id": "builtin-vwap-spy-1d", "file": "tests/fixtures/vendor/harness/builtin-vwap-spy-1d.json", "verdict": "MATCH",
     "sourceHeld": ["source/STD;VWAP@" + "b" * 64], "x": 0.1, "y": 1e-07},
    {"id": "vw-plain-spy-1d", "file": "tests/fixtures/vendor/harness/vw-plain-spy-1d.json", "verdict": "DIVERGE"},
]

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is required for the snapshot serialiser")


def _write(tmp_path, doc):
    p = tmp_path / "verdicts.json"
    # the harness's own layout: JSON.stringify(doc, null, 1) + '\n'
    p.write_bytes(subprocess.check_output(
        ["node", "-e", "process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]), null, 1) + '\\n')",
         json.dumps(doc)]))
    return p


def _prune(p):
    return subprocess.run(["node", PRUNE, str(p)], capture_output=True, text=True, check=True).stdout


def _rows_text(text):
    return text[text.index('"results"'):]


def test_an_uncited_local_pin_is_dropped_and_a_cited_one_kept(tmp_path):
    p = _write(tmp_path, {"lane": "production", "sourceHeldStore": [BOLL, VWAP], "results": ROWS})
    before = p.read_text(encoding="utf-8")
    out = _prune(p)
    doc = json.loads(p.read_text(encoding="utf-8"))
    assert doc["sourceHeldStore"] == [VWAP]
    assert "Bollinger" not in p.read_text(encoding="utf-8")
    assert "dropped 1" in out
    # every record byte-identical: only the listing changed
    assert _rows_text(p.read_text(encoding="utf-8")) == _rows_text(before)


def test_no_cited_pin_drops_the_key(tmp_path):
    p = _write(tmp_path, {"lane": "runtime-on", "sourceHeldStore": [BOLL], "results": ROWS[1:]})
    _prune(p)
    assert "sourceHeldStore" not in json.loads(p.read_text(encoding="utf-8"))


def test_control_a_listing_every_pin_of_which_is_cited_is_left_byte_identical(tmp_path):
    p = _write(tmp_path, {"lane": "production", "sourceHeldStore": [VWAP], "results": ROWS})
    before = p.read_bytes()
    out = _prune(p)
    assert p.read_bytes() == before
    assert "dropped 0" in out


def test_the_regen_prunes_each_lane_after_its_splice(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(RS.PC, "check", lambda *a, **k: ([], []))
    monkeypatch.setattr(RS, "splice_held", lambda lane, store: calls.append(("splice", lane)) or 0)
    monkeypatch.setattr(RS, "prune_source_held", lambda lane: calls.append(("prune", lane)) or 0)
    monkeypatch.setattr(RS.SH, "snapshot_store_problems", lambda doc, promoted: [])
    monkeypatch.setattr(RS.SH, "promoted_store", lambda: [])
    snaps = {}
    for lane in ("production", "runtime-on"):
        snaps[lane] = str(_write(tmp_path / lane if (tmp_path / lane).mkdir() is None else tmp_path,
                                 {"lane": lane, "results": []}))
    monkeypatch.setattr(RS.SH, "SNAPSHOTS", snaps)
    assert RS.main(["--store", str(tmp_path), "--splice-only"]) == 0
    assert calls == [("splice", "production"), ("prune", "production"),
                     ("splice", "runtime-on"), ("prune", "runtime-on")]


def test_the_regen_refuses_when_the_prune_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(RS.PC, "check", lambda *a, **k: ([], []))
    monkeypatch.setattr(RS, "splice_held", lambda lane, store: 0)
    monkeypatch.setattr(RS, "prune_source_held", lambda lane: 3)
    assert RS.main(["--store", str(tmp_path), "--splice-only", "--lane", "production"]) == 3
