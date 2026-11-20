"""THE SERVED SET, BY WHAT THE MEMBER'S CHART DRAWS (census tools, 2026-11-19).

`docs/pine/parity-roadmap.json` splits member-served three ways from the map's `renderGaps` (the runtime-on render
sweep, `renderGaps.measure.test.js` -> `tools/pine_coverage/render_gaps.py` -> `coverage_map.py --render-gaps`):
servedFully, servedWithDisclosedGap, servedUnmeasured, and servedDiverging (a capture grades DIVERGE: never "fully",
coordinator ruling 2026-11-19). These rails hold the split to the map it is derived from:

  * the four classes are disjoint and sum to memberServed, and their union IS the served set;
  * "fully" never holds a script the map records a gap or a DIVERGE capture for, nor one no capture measured;
  * every gap class is a ranked wall naming exactly the served scripts it touches;
  * the join refuses a sweep measured on another lane or library store, deduplicates captures, names a withheld
    text by the run's own kind, and writes keys and counts only; the map refuses a sweep of another census.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import pytest

from tools.pine_coverage import parity_roadmap as pr
from tools.pine_coverage import render_gaps as rg

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAP = ROOT / "docs" / "pine" / "coverage-map.json"
ROADMAP = ROOT / "docs" / "pine" / "parity-roadmap.json"


@pytest.fixture(scope="module")
def docs():
    return json.loads(MAP.read_text(encoding="utf-8")), json.loads(ROADMAP.read_text(encoding="utf-8"))


def served_of(m, rd):
    served, _walls, _enum, _missing = pr.member_model(m, rd["facts"]["scripts"])
    return served


# ═══ 1. the committed split ══════════════════════════════════════════════

def test_the_map_holds_a_render_sweep_and_the_roadmap_splits_by_it(docs):
    m, rd = docs
    assert m.get("renderGaps") and m["renderGaps"]["lane"] == "runtime-on"
    h = rd["headline"]
    assert None not in (h["servedFully"], h["servedWithDisclosedGap"], h["servedUnmeasured"], h["servedDiverging"])


CLASSES = (("fully", "servedFully"), ("withDisclosedGap", "servedWithDisclosedGap"), ("unmeasured", "servedUnmeasured"),
           ("diverging", "servedDiverging"))


def test_the_four_classes_are_disjoint_and_sum_to_member_served(docs):
    m, rd = docs
    h, s = rd["headline"], rd["renderGaps"]
    sets = [set(s[c]) for c, _ in CLASSES]
    assert [len(x) for x in sets] == [h[n] for _, n in CLASSES]
    for i, a in enumerate(sets):
        for b in sets[i + 1:]:
            assert not (a & b)
    assert sum(h[n] for _, n in CLASSES) == h["memberServed"]
    assert set().union(*sets) == served_of(m, rd)


def test_fully_never_holds_a_gap_script_a_diverging_one_nor_an_unmeasured_one(docs):
    m, rd = docs
    sc = m["renderGaps"]["scripts"]
    for k in rd["renderGaps"]["fully"]:
        assert sc[k]["measured"] > 0 and not sc[k]["gaps"] and sc[k]["withGap"] == 0 and sc[k]["diverge"] == 0, k
    for k, walls in rd["renderGaps"]["withDisclosedGap"].items():
        assert sc[k]["measured"] > 0 and sc[k]["withGap"] > 0 and walls == sorted(sc[k]["gaps"]), k
        assert sc[k]["diverge"] == 0, k
    for k in rd["renderGaps"]["unmeasured"]:
        assert not (sc.get(k) or {}).get("measured") and not (sc.get(k) or {}).get("diverge"), k
    for k in rd["renderGaps"]["diverging"]:
        assert sc[k]["diverge"] > 0, k


def test_every_gap_class_is_a_ranked_wall_over_the_scripts_it_touches(docs):
    _m, rd = docs
    gap = rd["renderGaps"]["withDisclosedGap"]
    rows = {r["wall"]: r for r in rd["renderWalls"]}
    assert set(rows) == {w for ws in gap.values() for w in ws}
    for w, r in rows.items():
        assert r["unit"] == pr.RENDER_UNIT and w.startswith("render:")
        assert r["any"] == sum(1 for ws in gap.values() if w in ws)
        assert r["soleScripts"] == sorted(k for k, ws in gap.items() if ws == [w])
    ranks = [(-r["sole"], -r["any"], r["wall"]) for r in rd["renderWalls"]]
    assert ranks == sorted(ranks)


def test_CONTROL_the_split_moves_a_script_out_of_fully_when_the_map_records_a_gap(docs):
    """The split reads the map: a gap recorded for a 'fully' script moves it, and the sum still holds."""
    m, rd = docs
    served = served_of(m, rd)
    k = rd["renderGaps"]["fully"][0]
    scripts = json.loads(json.dumps(m["renderGaps"]["scripts"]))
    scripts[k]["withGap"] = 1
    scripts[k]["gaps"] = {rg.COORDINATE: {"captures": 1, "drawings": 1, "families": {"label": 1}}}
    fully, gap, unmeasured, diverging = pr.render_split(served, {"scripts": scripts})
    assert k not in fully and gap[k] == [rg.COORDINATE]
    assert len(fully) + len(gap) + len(unmeasured) + len(diverging) == len(served)
    scripts[k]["diverge"] = 1                                   # a DIVERGE capture outranks the gap, never "fully"
    fully, gap, unmeasured, diverging = pr.render_split(served, {"scripts": scripts})
    assert k in diverging and k not in gap and k not in fully
    del scripts[k]
    fully, gap, unmeasured, diverging = pr.render_split(served, {"scripts": scripts})
    assert k in unmeasured and k not in fully
    assert pr.render_split(served, None) is None


# ═══ 2. the join ═════════════════════════════════════════════════════════

SRC_A = "//@version=6\nindicator('a', overlay=true)\nlabel.new(time + 86400000 * 15, close, 'x', xloc=xloc.bar_time)\n"
SRC_B = "//@version=6\nindicator('b')\nplot(close)\n"
STORE = [{"path": "TradingView/ta/7", "sha256": "c" * 64}]


def _cache(tmp_path, store=STORE):
    c = tmp_path / "cache"
    c.mkdir()
    rows = []
    for key, src in (("committed:a", SRC_A), ("reference:b", SRC_B)):
        p = c / (key.replace(":", "_") + ".pine")
        p.write_text(src, encoding="utf-8")
        rows.append({"key": key, "path": str(p)})
    (c / "census_input.json").write_text(json.dumps(rows), encoding="utf-8")
    (c / "library_store.json").write_text(json.dumps(store), encoding="utf-8")
    return c


def _capture(tmp_path, cid, src):
    p = tmp_path / ("%s.json" % cid)
    # whitespace differs from the sample's source: the join is norm_src's, whitespace-insensitive
    p.write_text(json.dumps({"id": cid, "source": {"text": src.replace("\n", "\r\n  ")}}), encoding="utf-8")
    return str(p)


def _rows(tmp_path, rows, name="rows.json", lane="runtime-on", store=STORE, engine=85):
    p = tmp_path / name
    p.write_text(json.dumps({"schema": rg.ROWS_SCHEMA, "lane": lane, "engine": engine, "libraryStore": store,
                             "rows": rows}), encoding="utf-8")
    return str(p)


def test_the_join_names_each_class_per_script_and_writes_keys_and_counts_only(tmp_path):
    cache = _cache(tmp_path)
    a1, a2 = _capture(tmp_path, "a-rddt", SRC_A), _capture(tmp_path, "a-spy", SRC_A)
    b1, x1 = _capture(tmp_path, "b-rddt", SRC_B), _capture(tmp_path, "probe", "//@version=6\nindicator('p')\n")
    rows = [
        {"file": a1, "id": "a-rddt", "verdict": "INCONCLUSIVE", "status": "measured", "held": 4, "coordinate": {"label": 1},
         "textWithheld": {"label": 2}, "textKinds": ["format:tie"]},
        {"file": a2, "id": "a-spy", "verdict": "DIVERGE", "status": "refused"},
        {"file": a1, "id": "a-rddt", "status": "measured", "held": 4},              # a duplicate: the first row wins
        {"file": b1, "id": "b-rddt", "status": "measured", "held": 0},
        {"file": x1, "id": "probe", "status": "measured", "held": 1, "coordinate": {"line": 1}},
    ]
    out = rg.build([_rows(tmp_path, rows)], str(cache))
    assert out["captures"] == {"rows": 4, "duplicates": 1, "matched": 3, "unmatched": 1,
                               "status": {"measured": 3, "refused": 1},
                               "verdicts": {"DIVERGE": 1, "INCONCLUSIVE": 1, "None": 1}}
    a = out["scripts"]["committed:a"]
    assert (a["captures"], a["measured"], a["withGap"], a["diverge"]) == (2, 1, 1, 1)
    assert a["gaps"] == {
        rg.COORDINATE: {"captures": 1, "drawings": 1, "families": {"label": 1}},
        rg.TEXT + "format:tie": {"captures": 1, "drawings": 2, "families": {"label": 2}},
    }
    assert out["scripts"]["reference:b"] == {"captures": 1, "measured": 1, "withGap": 0, "diverge": 0, "gaps": {}}
    text = json.dumps(out)
    assert "indicator" not in text and "label.new" not in text                  # no source leaves
    assert rg.gaps_of({"textWithheld": {"cell": 3}}) == {rg.TEXT + "unnamed": 3}
    assert rg.gaps_of({"withheld": {"objects:collector": 2}}) == {rg.WITHHELD + "objects:collector": 2}


def test_the_join_refuses_another_lane_another_store_or_a_mixed_sweep(tmp_path):
    cache = _cache(tmp_path)
    with pytest.raises(SystemExit, match="lane"):
        rg.build([_rows(tmp_path, [], lane="production")], str(cache))
    with pytest.raises(SystemExit, match="library store"):
        rg.build([_rows(tmp_path, [], store=[])], str(cache))
    with pytest.raises(SystemExit, match="different engines"):
        rg.build([_rows(tmp_path, [], "r1.json"), _rows(tmp_path, [], "r2.json", engine=84)], str(cache))
    # CONTROL: the same rows, the census's own store, are joined
    assert rg.build([_rows(tmp_path, [], "r3.json")], str(cache))["scripts"] == {}


def test_the_map_refuses_a_sweep_of_another_census(tmp_path):
    sys.path.insert(0, str(ROOT / "tools" / "pine_coverage"))
    import coverage_map as cm
    good = {"schema": cm.RENDER_GAPS_SCHEMA, "lane": "runtime-on", "engine": 85, "libraryStore": STORE,
            "captures": {"rows": 1}, "scripts": {"committed:a": {"captures": 1, "measured": 1, "withGap": 0, "gaps": {}}}}
    p = tmp_path / "rg.json"

    def section(doc, store=STORE, keys=("committed:a", "reference:b")):
        p.write_text(json.dumps(doc), encoding="utf-8")
        return cm.render_gaps_section(str(p), store, set(keys))

    assert section(good)["scripts"] == good["scripts"]
    for bad, store, keys, why in (
        ({**good, "schema": "x"}, STORE, ("committed:a",), "schema"),
        ({**good, "lane": "production"}, STORE, ("committed:a",), "lane"),
        (good, [], ("committed:a",), "library store"),
        (good, STORE, ("reference:b",), "another census"),
    ):
        with pytest.raises(SystemExit, match=why):
            section(bad, store, keys)


def test_the_tools_run_as_documented(tmp_path):
    cache = _cache(tmp_path)
    rows = _rows(tmp_path, [{"file": _capture(tmp_path, "b", SRC_B), "id": "b", "status": "measured", "held": 0}])
    out = tmp_path / "rg.json"
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "pine_coverage" / "render_gaps.py"), "--rows", rows,
                        "--cache", str(cache), "--out", str(out)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert json.loads(out.read_text(encoding="utf-8"))["schema"] == rg.SCHEMA
