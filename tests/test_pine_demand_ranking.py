"""The demand ranking is the parity roadmap weighted by popularity, and nothing else (2026-11-20).

`docs/pine/demand-ranking.json` is DERIVED: `tools/pine_coverage/demand_ranking.py build` reads the committed
roadmap (`docs/pine/parity-roadmap.json`: each engine unit and the scripts a fix of it alone would serve) and the
boost count of each community script (`agreeCount`, `corpus/reference/*.json`). This rail re-derives it and
fails when the committed file differs, so a rebuilt roadmap, a re-fetched boost count or a hand edit is caught.

⛔ The repo is public. The file holds AGGREGATES PER UNIT ONLY; the last test here holds that.
"""
from __future__ import annotations

import copy
import json
import pathlib

import pytest

from tools.pine_coverage import demand_ranking as dr

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROADMAP = ROOT / "docs" / "pine" / "parity-roadmap.json"
RANKING = ROOT / "docs" / "pine" / "demand-ranking.json"
CORPUS = ROOT / "corpus" / "reference"


@pytest.fixture(scope="module")
def inputs():
    return json.loads(ROADMAP.read_text(encoding="utf-8")), dr.boosts_of(str(CORPUS))


def test_the_committed_ranking_is_what_the_roadmap_and_the_boost_counts_give():
    assert dr.check() == [], ("docs/pine/demand-ranking.json is stale (the roadmap or a boost count moved); "
                              "rebuild: python tools/pine_coverage/demand_ranking.py build")
    # byte for byte, so a hand edit of spacing or order is caught too
    roadmap, boosts = json.loads(ROADMAP.read_text(encoding="utf-8")), dr.boosts_of(str(CORPUS))
    assert RANKING.read_text(encoding="utf-8").replace("\r\n", "\n") == dr.text_of(dr.build(roadmap, boosts))


def test_it_fails_when_a_unit_gains_or_loses_a_script(inputs, tmp_path):
    """Control: a rebuilt roadmap that moves one sole script must not pass."""
    roadmap, _boosts = inputs
    moved = copy.deepcopy(roadmap)
    unit = next(u for u in moved["units"] if any(s.startswith("committed:") for s in u.get("soleScripts") or []))
    unit["soleScripts"] = [s for s in unit["soleScripts"] if not s.startswith("committed:")][:]
    p = tmp_path / "roadmap.json"
    p.write_text(json.dumps(moved), encoding="utf-8")
    assert "units" in dr.check(roadmap_path=str(p))


def test_it_fails_when_a_boost_count_moves(inputs, tmp_path):
    """Control: one more boost on one script that a unit unlocks alone must not pass."""
    roadmap, boosts = inputs
    stem = next(s.split(":", 1)[1] for u in roadmap["units"] for s in u.get("soleScripts") or []
                if s.split(":", 1)[0] in dr.COMMUNITY and s.split(":", 1)[1] in boosts)
    corpus = tmp_path / "reference"
    corpus.mkdir()
    for f in CORPUS.glob("*.json"):
        meta = json.loads(f.read_text(encoding="utf-8"))
        if f.stem == stem:
            meta["agreeCount"] = int(meta.get("agreeCount") or 0) + 1
        (corpus / f.name).write_text(json.dumps(meta), encoding="utf-8")
    assert "units" in dr.check(corpus_dir=str(corpus))
    # CONTROL OF THE CONTROL: the same copy, unchanged, passes
    (corpus / f"{stem}.json").write_text((CORPUS / f"{stem}.json").read_text(encoding="utf-8"), encoding="utf-8")
    assert dr.check(corpus_dir=str(corpus)) == []


def test_the_arithmetic_by_hand():
    roadmap = {"headline": {"sample": 9, "memberServed": 4}, "units": [
        {"unit": "a", "kind": "engine", "size": 2, "soleScripts": ["committed:x__1", "reference:y__2", "builtin:z"]},
        {"unit": "b", "kind": "engine", "size": 1, "soleScripts": ["committed:x__1", "committed:gone__9", "other:q"]},
        {"unit": "c", "kind": "owner", "size": 4, "soleScripts": ["builtin:p", "builtin:q", "builtin:r", "builtin:s"]},
        {"unit": "d", "kind": "engine", "size": 0, "soleScripts": []},
    ]}
    doc = dr.build(roadmap, {"x__1": 100, "y__2": 30})
    rows = {r["unit"]: r for r in doc["units"]}
    assert rows["a"] == {"unit": "a", "kind": "engine", "size": 2, "soleScripts": 3, "soleCommunity": 2, "soleBuiltins": 1,
                         "soleOtherPopulation": 0, "soleWithoutMetadata": 0, "soleBoosts": 130, "soleBoostsPerSize": 65,
                         "rankByBoosts": 1, "rankByCount": 2}
    # a script the corpus has no metadata for, and one of an unknown population, are counted and SAID, never boosted
    assert (rows["b"]["soleScripts"], rows["b"]["soleCommunity"], rows["b"]["soleWithoutMetadata"],
            rows["b"]["soleOtherPopulation"], rows["b"]["soleBoosts"]) == (3, 2, 1, 1, 100)
    # built-ins add scripts and no boosts: first by count, behind every boosted unit by boosts
    assert (rows["c"]["rankByCount"], rows["c"]["rankByBoosts"], rows["c"]["soleBoosts"]) == (1, 3, 0)
    assert [r["unit"] for r in doc["units"]] == ["a", "b", "c", "d"]
    assert rows["d"]["soleBoostsPerSize"] == 0                              # a size of 0 does not divide
    assert doc["sample"] == {"scripts": 9, "memberServed": 4, "communityScriptsWithABoostCount": 2, "boostsInAll": 130}
    # a boost count that is not a count reads as none
    assert dr.build(roadmap, {"x__1": 0})["units"][0]["soleBoosts"] == 0


def test_every_script_a_unit_unlocks_alone_was_found_in_the_corpus():
    """A community script with no metadata adds nothing to the boosts. None is missing today; if one ever is, it is
    said in the file (`soleWithoutMetadata`) and this says which unit to look at."""
    doc = json.loads(RANKING.read_text(encoding="utf-8"))
    assert [(r["unit"], r["soleWithoutMetadata"], r["soleOtherPopulation"]) for r in doc["units"]
            if r["soleWithoutMetadata"] or r["soleOtherPopulation"]] == []
    assert sum(r["soleScripts"] for r in doc["units"]) > 100 and doc["sample"]["boostsInAll"] > 1_000_000


def test_the_file_holds_aggregates_only():
    """⛔ PUBLIC REPO: counts and totals per unit. No script name, link, author or member."""
    text = RANKING.read_text(encoding="utf-8")
    doc = json.loads(text)
    assert set(doc) == {"schema", "_comment", "sample", "units"}
    allowed = {"unit", "kind", "size", "soleScripts", "soleCommunity", "soleBuiltins", "soleOtherPopulation",
               "soleWithoutMetadata", "soleBoosts", "soleBoostsPerSize", "rankByBoosts", "rankByCount"}
    roadmap = json.loads(ROADMAP.read_text(encoding="utf-8"))
    units = {u["unit"] for u in roadmap["units"]}
    for row in doc["units"]:
        assert set(row) == allowed, sorted(set(row) ^ allowed)
        assert row["unit"] in units
        assert all(isinstance(v, int) or v is None or k in ("unit", "kind") for k, v in row.items()), row
    # no script of the sample is named anywhere in the file, and nothing that looks like a link or an address
    names = {s.split(":", 1)[1] for u in roadmap["units"] for s in u.get("soleScripts") or [] if ":" in s}
    assert len(names) > 100
    assert [n for n in names if n in text] == []
    body = json.dumps({k: v for k, v in doc.items() if k != "_comment"})
    for needle in ("http", "@", "committed:", "reference:", "builtin:"):
        assert needle not in body, needle
