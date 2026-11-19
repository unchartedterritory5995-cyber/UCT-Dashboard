# -*- coding: utf-8 -*-
"""Store-held rows: the committed harness snapshots are graded with production's library store, and a run without
it (CI) never counts a row that needed it (libraries chain, coordinator ruling 2026-11-19).

  1. Both snapshots were graded with EXACTLY the allowlist's promote rows (`libraryStore`), and every row that
     reaches a promoted version names those versions at their pinned sha (`storeHeld`), and no other row does.
  2. A store-less reading of the committed snapshot never counts a store-held row as lost, as MATCH or as DIVERGE:
     it is "store-held: <path@sha>", named (`store_held.compare`, `snapshot_diff.py`).
  3. The coverage ratchet judges the same way: a script its snapshot measured WITH the store is store-held in a run
     without it, never lost.
"""
from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "vendor_harness"))
sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))
import coverage_ratchet as CR  # noqa: E402
import licence_held  # noqa: E402
import store_held as SH  # noqa: E402

import re  # noqa: E402

PROMOTED = SH.promoted_store()
#: the JS harness's own reading of an import line (`pineLibraryStore.importPathsOf`), restated ON PURPOSE: this rail
#: checks the marks the JS side wrote against an independent reading of the same captures
_IMPORT = re.compile(r"^import[ \t]+([A-Za-z0-9_]+)[ \t]*/[ \t]*([A-Za-z0-9_]+)[ \t]*/[ \t]*([1-9][0-9]*)", re.M)


def _snapshot(lane):
    return json.loads(Path(SH.SNAPSHOTS[lane]).read_text(encoding="utf-8"))


def _expected_pins(text, promoted=PROMOTED, allowlist=SH.ALLOWLIST):
    """path@sha of every promoted version `text` reaches through its import lines, closed over the promote rows'
    own `imports` (the store's view of the same closure the harness walks)."""
    sha = {e["path"]: e["sha256"] for e in promoted}
    imports = {r["path"]: r.get("imports") or [] for r in json.load(open(allowlist, encoding="utf-8"))["promote"]}
    out, queue, seen = set(), ["%s/%s/%s" % m for m in _IMPORT.findall(text or "")], set()
    while queue:
        p = queue.pop(0)
        if p in seen:
            continue
        seen.add(p)
        if p in sha:
            out.add(SH.pin_of(p, sha[p]))
            queue.extend(imports.get(p) or [])
    return sorted(out)


# ── 1. the committed snapshots are production's store, row by row ───────────────────────────────────────

@pytest.mark.parametrize("lane", ["production", "runtime-on"])
def test_the_snapshot_is_graded_with_productions_store(lane):
    doc = _snapshot(lane)
    assert doc.get("lane") == lane
    assert SH.snapshot_store_problems(doc, PROMOTED) == []


@pytest.mark.parametrize("lane", ["production", "runtime-on"])
def test_every_row_reaching_a_promoted_version_names_it_and_no_other_row_does(lane):
    doc = _snapshot(lane)
    absent, wrong, marked = [], [], 0
    for r in doc["results"]:
        fx = licence_held.fixture_path(r["file"])
        if fx is None or not fx.is_file():
            if SH.pins_of(r):
                absent.append(r["id"])
            continue
        raw = fx.read_bytes()
        text = (json.loads(raw).get("source") or {}).get("text") if b"import " in raw else ""
        want = _expected_pins(text)
        marked += bool(want)
        if SH.pins_of(r) != want:
            wrong.append((r["id"], SH.pins_of(r), want))
    assert wrong == []
    assert marked >= 5, "almost no row reaches a promoted version: the marking is not being read"
    if absent:
        pytest.skip("store-held rows whose licence-held capture is not on this machine: %s" % absent)


def test_the_closure_follows_nested_versions():
    """CONTROL for the rail above: a script reaching ta/7 also needs RelativeValue/2, which ta/7 imports."""
    text = "//@version=5\nindicator('x')\nimport TradingView/ta/7 as ta7\nplot(ta7.dema(close, 3))\n"
    got = _expected_pins(text)
    if not any(e["path"] == "TradingView/ta/7" for e in PROMOTED):
        pytest.skip("TradingView/ta/7 is not promoted on this tree")
    assert [SH.parse_pin(p)[0] for p in got] == ["TradingView/RelativeValue/2", "TradingView/ta/7"]


# ── 2. a store-less run never counts a store-held row ──────────────────────────────────────────────────

def _store_less(doc, verdict="INCONCLUSIVE"):
    """The committed snapshot as a run WITHOUT the store reads it: no `libraryStore`, and each store-held row graded
    `verdict` (refused at its import line, INCONCLUSIVE; MATCH and DIVERGE are what a consumer must not count either)."""
    run = copy.deepcopy(doc)
    run.pop("libraryStore", None)
    for r in run["results"]:
        if r.pop(SH.FIELD, None):
            r["verdict"] = verdict
    return run


@pytest.mark.parametrize("lane", ["production", "runtime-on"])
@pytest.mark.parametrize("verdict", ["INCONCLUSIVE", "MATCH", "DIVERGE"])
def test_a_store_less_run_never_counts_a_store_held_row(lane, verdict):
    doc = _snapshot(lane)
    held = sorted(r["id"] for r in doc["results"] if SH.pins_of(r))
    assert held, "no store-held row in the snapshot: this rail would prove nothing"
    d = SH.compare(doc, _store_less(doc, verdict))
    assert sorted(d["storeHeld"]) == held
    assert all(v.startswith("store-held: ") and "@" in v for v in d["storeHeld"].values())
    counted = set(d["lost"]) | set(d["toDiverge"]) | {m[0] for m in d["moved"]}
    assert counted.isdisjoint(held)


def test_the_compare_still_counts_every_other_row():
    """CONTROL: a row that needs no store and moved IS counted, and the same store loaded judges a store-held row."""
    doc = _snapshot("runtime-on")
    run = _store_less(doc)
    plain = next(r for r in run["results"] if r["verdict"] == "MATCH" and not SH.pins_of(r))
    plain["verdict"] = "DIVERGE"
    d = SH.compare(doc, run)
    assert plain["id"] in d["lost"] and plain["id"] in d["toDiverge"]
    same = copy.deepcopy(doc)
    row = next(r for r in same["results"] if SH.pins_of(r))
    row["verdict"] = "DIVERGE" if row["verdict"] != "DIVERGE" else "MATCH"
    d2 = SH.compare(doc, same)
    assert row["id"] not in d2["storeHeld"] and row["id"] in {m[0] for m in d2["moved"]}


# ── 3. the coverage ratchet judges the same way ──────────────────────────────────────────────────────────

PIN = SH.pin_of("TradingView/ta/7", "c" * 64)


def _ratchet_doc(held):
    return {"schema": CR.SCHEMA, "lanes": {"runtime-on": {"count": 2, "scripts": {"committed:a": "x", "committed:b": "y"},
                                                          **({"storeHeld": held} if held else {})}}}


def test_the_ratchet_names_a_store_held_script_instead_of_losing_it():
    doc = _ratchet_doc({"committed:b": [PIN]})
    rows_without_store = {"committed:a": {"key": "committed:a"}, "committed:b": {"key": "committed:b"}}
    held = CR.store_held_of(doc, "runtime-on", rows_without_store)
    assert held == {"committed:b": SH.reading([PIN])}
    lost, gained = CR.judge(doc["lanes"]["runtime-on"]["scripts"], {"committed:a"}, held)
    assert lost == [] and gained == []
    # CONTROL: the same run, the same miss, nothing marked store-held: that IS a loss
    lost2, _ = CR.judge(doc["lanes"]["runtime-on"]["scripts"], {"committed:a"}, CR.store_held_of(_ratchet_doc({}), "runtime-on",
                                                                                                    rows_without_store))
    assert lost2 == ["committed:b"]
    # CONTROL: a run WITH the store holds the pin, so the script is judged, and a miss is a loss
    rows_with_store = dict(rows_without_store, **{"committed:b": {"key": "committed:b", SH.FIELD: [PIN]}})
    held3 = CR.store_held_of(doc, "runtime-on", rows_with_store)
    assert held3 == {} and CR.judge(doc["lanes"]["runtime-on"]["scripts"], {"committed:a"}, held3)[0] == ["committed:b"]


def test_the_ratchet_refuses_a_malformed_store_mark():
    scripts = {"committed:a": {"sha": "x"}, "committed:b": {"sha": "y"}}
    floors = dict(CR.FLOORS)
    try:
        CR.FLOORS["runtime-on"] = 1
        assert CR.snapshot_problems(_ratchet_doc({"committed:b": [PIN]}), "runtime-on", scripts) == []
        assert CR.snapshot_problems(_ratchet_doc({"committed:b": ["not a pin"]}), "runtime-on", scripts) != []
        assert CR.snapshot_problems(_ratchet_doc({"committed:zz": [PIN]}), "runtime-on", scripts) != []
    finally:
        CR.FLOORS.clear()
        CR.FLOORS.update(floors)


def test_the_pin_spelling_is_one_rule():
    assert SH.parse_pin(PIN) == ("TradingView/ta/7", "c" * 64)
    for bad in ("TradingView/ta/7", "TradingView/ta/7@" + "c" * 63, "TradingView/ta/0@" + "c" * 64, "a/b@" + "c" * 64, None):
        assert SH.parse_pin(bad) is None
