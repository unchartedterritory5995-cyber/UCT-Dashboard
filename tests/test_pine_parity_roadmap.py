"""The parity roadmap's counts are the census map's counts (docs/pine/PARITY-ROADMAP-2026-11-18.md).

`docs/pine/parity-roadmap.json` is DERIVED: `tools/pine_coverage/parity_roadmap.py build` reads the committed
census map (`docs/pine/coverage-map.json`) and the roadmap's own `facts` block (identifiers measured locally:
admission, tokens, capture ids). This rail re-derives every section and fails when one differs, so a re-measured
map that moves a wall, or a hand edit to a count, is caught here, and progress is re-checked by re-running the
census and `build`.

WHY THE CENSUS ITSELF DOES NOT RUN HERE: 413 of the 679 sample scripts (271 reference, 142 built-in) are
licence-held sources in a local cache that is never committed (the repo is public), so CI cannot re-run the
door over the sample. CI re-derives the roadmap from the census OUTPUT the map commits, and re-reads the facts
of the 266 committed corpus scripts from their committed sources.
"""
from __future__ import annotations

import copy
import json
import pathlib

import pytest

from tools.pine_coverage import parity_roadmap as pr

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAP = ROOT / "docs" / "pine" / "coverage-map.json"
ROADMAP = ROOT / "docs" / "pine" / "parity-roadmap.json"


@pytest.fixture(scope="module")
def docs():
    return json.loads(MAP.read_text(encoding="utf-8")), json.loads(ROADMAP.read_text(encoding="utf-8"))


def test_every_count_is_the_census_maps():
    assert pr.check(str(MAP), str(ROADMAP)) == [], (
        "parity-roadmap.json is not what the census map gives; rebuild: python tools/pine_coverage/"
        "parity_roadmap.py build --facts docs/pine/parity-roadmap.json")


def _write(tmp_path, name, obj):
    p = tmp_path / name
    p.write_text(json.dumps(obj), encoding="utf-8")
    return str(p)


def test_the_rail_fails_when_the_map_moves_a_wall(docs, tmp_path):
    """Control: a re-measured map in which one not-served script loses a runtime wall must not pass."""
    m, rd = docs
    moved = copy.deepcopy(m)
    by_script = moved["runtimeOn"]["walls"]["byScript"]
    key = next(k for k, ws in sorted(by_script.items()) if len(set(ws)) >= 2)
    by_script[key] = [w for w in by_script[key] if w != by_script[key][0]]
    bad = pr.check(_write(tmp_path, "map.json", moved), str(ROADMAP))
    assert "memberWalls" in bad or "scripts" in bad


def test_the_rail_fails_on_a_hand_edited_count(docs, tmp_path):
    m, rd = docs
    edited = copy.deepcopy(rd)
    edited["headline"]["memberServed"] += 1
    edited["units"][0]["sole"] += 1
    p = _write(tmp_path, "roadmap.json", edited)
    # the map is the committed one, byte for byte
    (tmp_path / "map.json").write_bytes(MAP.read_bytes())
    bad = pr.check(str(tmp_path / "map.json"), p)
    assert "headline" in bad and "units" in bad


def test_the_headline_is_the_member_rule(docs):
    """served = host-clean + (runtime-lane draws it AND the server admits it); what is not served has walls."""
    m, rd = docs
    h = rd["headline"]
    host = sum(1 for s in m["scripts"] if s["clean"])
    assert h["hostOnly"] == host
    assert h["runtimeOn"] == m["runtimeOn"]["transfer"]
    admitted = h["admission"].get("allowlisted", 0) + h["admission"].get("capability", 0)
    assert h["memberServed"] == host - h["runtimeLost"] + admitted
    assert h["memberServed"] + h["notServed"] == h["sample"] == len(m["scripts"])
    assert all(rd["scripts"][k] for k in rd["scripts"]), "every script not served names at least one wall"


def test_a_ruling_by_name_is_a_never_serve_script_with_its_witness(docs):
    """PARITY UNIT 1 (coordinator, 2026-11-18): Q-OBJ1-3 read crypto pairs as symbol input defaults the facts hold
    no venue for, and TradingView refuses them at their defaults ("Invalid symbol"): ruled never-serve BY NAME
    (`RULED_NEVER_SERVE`), each with the run that witnessed it, and left out of every unit's servable count."""
    m, rd = docs
    keys = {s["key"] for s in m["scripts"]}
    never = {c["class"]: c for c in rd["neverServe"]}
    assert pr.RULED_NEVER_SERVE, "the ruling list is not empty"
    for key, (cls, why) in pr.RULED_NEVER_SERVE.items():
        assert key in keys, "a ruled script is a census script: %s" % key
        assert key in rd["scripts"], "a ruled script is not served: %s" % key
        assert key in never[cls]["scripts"], key
        assert never[cls]["ruledByName"][key] == why and "run " in why, "the witness rides beside it: %s" % key
        for u in rd["units"]:
            # no capture is asked for a never-serve script: it leaves every unit's evidence queue
            assert key not in {e["script"] for e in u["evidence"]["queue"]}, (u["unit"], key)
            assert key not in u["soleScripts"] or u["soleServable"] < u["sole"], (u["unit"], key)
    # CONTROL: without the ruling, the detectors alone do not classify them (the reason the ruling exists), and
    # the objects unit asks a capture of each
    saved = dict(pr.RULED_NEVER_SERVE)
    try:
        pr.RULED_NEVER_SERVE.clear()
        again = pr.build(m, rd["facts"], rd["map"]["sha256"])
        unruled = {c["class"]: c for c in again["neverServe"]}
        assert not set(saved) & set(unruled["other-feeds"]["scripts"])
        objects = next(u for u in again["units"] if u["unit"] == "objects")
        assert objects["soleServable"] == next(u for u in rd["units"] if u["unit"] == "objects")["soleServable"] + 3
        assert set(saved) <= {e["script"] for e in objects["evidence"]["queue"] if e["status"] == "none"}
    finally:
        pr.RULED_NEVER_SERVE.update(saved)


def test_every_wall_has_a_unit(docs):
    _m, rd = docs
    unmapped = [w["wall"] for w in rd["memberWalls"] if w["unit"] == "unmapped"]
    assert unmapped == [], "walls no unit rule names: %s (add them to UNITS)" % unmapped


def test_committed_scripts_facts_are_their_sources(docs):
    """The facts of the committed corpus scripts, re-read from the committed sources: the admission answer
    against the registry snapshot the facts were measured with (the server's own detector and rule)."""
    _m, rd = docs
    facts = rd["facts"]
    admitted = set(facts["admittedCapabilities"])
    history_only = set(facts.get("historyOnly") or [])
    checked = 0
    for key, f in sorted(facts["scripts"].items()):
        if not key.startswith("committed:") or not f.get("admission"):
            continue
        src_path = ROOT / "corpus" / "committed" / (key.split(":", 1)[1] + ".pine")
        if not src_path.exists():
            continue
        src = src_path.read_bytes().decode("utf-8")
        again = pr._admission(src, admitted, [], history_only)
        stored = f["admission"]
        # the kill list and the graded allowlist are their own committed files with their own rails; what is
        # re-read here is the detector over the source against the registry snapshot
        if "killed" in (stored["status"], again["status"]) or stored["status"] == "allowlisted":
            continue
        assert again["missing"] == stored["missing"], key
        assert again["historyOnly"] == stored["historyOnly"], key
        checked += 1
    assert checked >= 100, "the committed half must be re-read (%d checked)" % checked
