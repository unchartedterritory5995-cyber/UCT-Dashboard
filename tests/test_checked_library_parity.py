"""THE DOOR AND THE WINDOW RECOGNISE A LIBRARY FORMULA BY THE SAME RULE.

The window shows a checked library indicator's Inputs as the entry's own settings and reads it back
in one phrase (`app/src/components/chart/builder/authoring/checkedLibrary.js`). To do that it
recognises a library formula by its shape, with a port of the door's own rule
(`named_indicators.output_in`). Two implementations of one rule drift unless something holds them
together, so both run ONE list of cases: `tests/fixtures/authoring/checked_library_cases.json`. Each
case is a recipe applied to an entry's output tree and what the result must be recognised as, known
by construction. This file is the door's half; `checkedLibrary.test.js` is the window's.

It also holds the window's copy of the library to the library itself.
"""
from __future__ import annotations

import copy
import json
import pathlib
import subprocess
import sys

import pytest

from api.services import named_indicators as ni

ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests/fixtures/authoring/checked_library_cases.json").read_text(encoding="utf-8"))["cases"]
BROWSER = ROOT / "app/src/components/chart/builder/authoring/checkedLibrary.json"
ENTRIES = {e["id"]: e for e in ni.entries()}


def _at(tree, path):
    for i in path:
        tree = tree["args"][i]
    return tree


def built(case):
    """The case's tree: the recipe applied to the entry's output tree."""
    e = ENTRIES[case["entry"]]
    o = next(x for x in e["outputs"] if x["key"] == case["output"])
    tree = copy.deepcopy(o["tree"])
    for key, value in (case.get("set") or {}).items():
        for path in o["sites"][key]:
            _at(tree, path)["value"] = value
    if case.get("set_one"):
        key, n, value = case["set_one"]
        _at(tree, o["sites"][key][n])["value"] = value
    if case.get("series"):
        for path in o["sites"][case["series"]]:
            _at(tree, path[:-1])["args"][path[-1]] = {"type": "series", "name": "myOwnSetting"}
    if case.get("bump"):
        path, d = case["bump"]
        _at(tree, path)["value"] += d
    if case.get("wrap"):
        tree = {"type": "op", "name": ">", "args": [tree, {"type": "num", "value": 987654}]}
    return e, o, tree


def at_root(tree, e, o, inputs):
    """The door's rule for 'the WHOLE tree is this output': the parameters' numbers, or None."""
    params = {p["key"]: p for p in e["params"]}
    sites = {tuple(path): key for key, paths in (o.get("sites") or {}).items() for path in paths}
    bound = {}
    if not ni._same(tree, o["tree"], (), sites, params, frozenset(inputs), bound):
        return None
    return {k: (v[1] if v[0] == "num" else None) for k, v in bound.items()}


def test_the_cases_cover_every_output_and_every_parameter():
    seen = {(c["entry"], c["output"]) for c in CASES if c["kind"] == "defaults"}
    assert seen == {(e["id"], o["key"]) for e in ENTRIES.values() for o in e["outputs"]}, "run the case generator"
    for e in ENTRIES.values():
        for o in e["outputs"]:
            for key in o["sites"]:
                kinds = {c["kind"] for c in CASES if (c["entry"], c["output"]) == (e["id"], o["key"])}
                assert f"{key} over its maximum" in kinds and f"{key} under its minimum" in kinds, (e["id"], o["key"], key)
    # both answers appear, so neither half can pass by always saying yes or always saying no
    assert sum(1 for c in CASES if c["expect"] is None) > 100 and sum(1 for c in CASES if c["expect"] is not None) > 60
    assert any(c["kind"].endswith("in one place and another in the next") for c in CASES)
    assert any(c["kind"].endswith("driven by the member's own input") for c in CASES)


@pytest.mark.parametrize("case", CASES, ids=[f"{c['entry']}.{c['output']}: {c['kind']}" for c in CASES])
def test_the_door_recognises_each_case_as_constructed(case):
    e, o, tree = built(case)
    inputs = case.get("inputs") or []
    got = at_root(tree, e, o, inputs)
    want = case["expect"]
    assert (got is None) == (want is None), (got, want)
    if want is not None:
        assert got == {k: (None if v is None else float(v)) for k, v in want.items()}
    if "expect_inside" in case:
        inside = ni.output_in(tree, e, o, inputs)
        assert inside == {k: float(v) for k, v in case["expect_inside"].items()}


def test_the_shared_cases_are_what_the_generator_writes_today():
    """A new entry, a new parameter or a moved range changes the cases. The file is generated, so it
    is held to its generator: stale means run `python tools/checked_library_cases.py`."""
    done = subprocess.run([sys.executable, str(ROOT / "tools" / "checked_library_cases.py"), "--check"],
                          capture_output=True, text=True, cwd=str(ROOT))
    assert done.returncode == 0, done.stdout + done.stderr


def test_the_windows_copy_is_the_library_and_nothing_else():
    doc = json.loads(BROWSER.read_text(encoding="utf-8"))
    assert doc["contract"] == "uct.named-indicators.browser/1" and doc["_"].startswith("GENERATED")
    assert [e["id"] for e in doc["indicators"]] == [e["id"] for e in ni.entries()]
    for mine, e in zip(doc["indicators"], ni.entries()):
        assert set(mine) == {"id", "name", "version", "params", "outputs"}                   # no evidence, aliases or formula text
        assert mine["name"] == e["name"] and mine["version"] == ni.version(e)
        assert mine["params"] == [{k: p[k] for k in ("key", "label", "default", "min", "max", "integer")} for p in e["params"]]
        assert [set(o) for o in mine["outputs"]] == [{"key", "label", "says", "tree", "sites"}] * len(e["outputs"])
        for o, lib in zip(mine["outputs"], e["outputs"]):
            assert (o["key"], o["label"], o["says"], o["tree"], o["sites"]) == (
                lib["key"], lib["label"], lib["says"], lib["tree"], lib["sites"])


def test_the_build_tool_fails_when_the_windows_copy_is_stale(tmp_path, monkeypatch):
    sys.path.insert(0, str(ROOT / "tools"))
    try:
        import named_indicators_build as build
    finally:
        sys.path.pop(0)
    assert build.BROWSER_COPY == BROWSER
    assert build.main(["--check"]) == 0                                       # CONTROL: as committed, nothing is stale
    stale = tmp_path / "checkedLibrary.json"
    stale.write_text(BROWSER.read_text(encoding="utf-8").replace('"Efficiency length"', '"Efficiency"'), encoding="utf-8")
    monkeypatch.setattr(build, "BROWSER_COPY", stale)
    monkeypatch.setattr(build, "ROOT", tmp_path)
    assert build.main(["--check"]) == 1
    missing = tmp_path / "none.json"
    monkeypatch.setattr(build, "BROWSER_COPY", missing)
    assert build.main(["--check"]) == 1
