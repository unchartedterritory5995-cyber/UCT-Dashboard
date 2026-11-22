"""THE SHIPPED-VERSION LEDGER of the named-indicator library (`api/data/named_indicators_shipped.json`).

The library's own rule is "an entry's maths never changes under the same version". It was held by
the fingerprint stored IN the library file, so a library file regenerated with empty fingerprints
(a seed script does exactly that) could move a shipped entry's formula and record the new
fingerprint as if it had always been version 1. Nothing went red. (Found 2026-11-18, while two
shipped entries were being given a second version.)

The ledger records every (entry, version) -> fingerprint once, when it ships. Held here:

* every version in the library is in the ledger with the same fingerprint, and the ledger records
  nothing the library has lost;
* the build tool refuses a library whose shipped version moved, even when that library carries NO
  stored fingerprint to compare with (the regenerated case), and refuses one that lost a shipped
  entry or version;
* a change made the right way, as a new version, passes, and `--ship` only ever ADDS.
"""
from __future__ import annotations

import copy
import json
import pathlib
import re
import sys

import pytest

from api.services import named_indicators as ni

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import named_indicators_build as build  # noqa: E402

LEDGER = json.loads(build.LEDGER.read_text(encoding="utf-8"))
SHIPPED = LEDGER["shipped"]
needs_node = pytest.mark.skipif(not (ROOT / "app/node_modules/esbuild").exists(),
                                reason="app/node_modules is needed to run the shipped parser")


def library():
    return json.loads(ni.PATH.read_text(encoding="utf-8"))


def as_a_seed_writes_it(doc):
    """The library the way a seed script regenerates it: every NEWEST version's fingerprint empty."""
    doc = copy.deepcopy(doc)
    for e in doc["indicators"]:
        e["versions"][-1]["maths"] = ""
    return doc


# ═══ 1. the ledger and the library agree ═════════════════════════════════════

def test_every_version_in_the_library_is_in_the_ledger_with_the_same_fingerprint():
    for e in ni.entries():
        for h in e["versions"]:
            assert SHIPPED.get(e["id"], {}).get(str(h["version"])) == h["maths"], (
                f"{e['id']} version {h['version']}: not in the ledger, or not what the ledger records. A NEW version is "
                "recorded with `python tools/named_indicators_build.py --ship`; a recorded one never changes.")


def test_the_ledger_records_nothing_the_library_has_lost():
    by_id = {e["id"]: e for e in ni.entries()}
    for entry_id, versions in SHIPPED.items():
        assert entry_id in by_id, f"{entry_id}: a shipped entry is gone from the library"
        have = {str(h["version"]) for h in by_id[entry_id]["versions"]}
        assert set(versions) <= have, (entry_id, sorted(set(versions) - have))


def test_the_ledger_is_well_formed():
    assert set(LEDGER) == {"_", "shipped"} and len(SHIPPED) >= 30
    for entry_id, versions in SHIPPED.items():
        assert re.fullmatch(r"[a-z][a-z0-9_]+", entry_id)
        assert list(versions) == [str(n) for n in range(1, len(versions) + 1)], entry_id       # 1, 2, 3 ... no gap
        assert all(re.fullmatch(r"sha256:[0-9a-f]{64}", f) for f in versions.values()), entry_id
        assert len(set(versions.values())) == len(versions), f"{entry_id}: two versions with one fingerprint"
    # the two entries that already have a second version, with the fingerprints version 1 shipped with
    assert SHIPPED["ease_of_movement"]["1"] == "sha256:d7955d5bcf6dcd462a5d5265d0d7e7682e633a2d5554e9ddf90aadb37bf0daea"
    assert SHIPPED["negative_volume_index"]["1"] == "sha256:c01e1334aefef55b9918d791f833678b196d08b3ae5aa47c2f533705c26a59b5"


# ═══ 2. the build tool refuses what the ledger forbids ═══════════════════════

@needs_node
def test_a_shipped_formula_changed_through_a_regenerated_file_is_REFUSED():
    """THE HOLE, CLOSED. The file carries no fingerprint for the version (as a seed writes it), the
    formula has moved, and the tool still refuses: the ledger remembers what shipped."""
    doc = as_a_seed_writes_it(library())
    assert build.derive(doc)[1] == []                                       # CONTROL: regenerated and unchanged is fine
    obv = next(e for e in doc["indicators"] if e["id"] == "on_balance_volume")
    obv["outputs"][0]["formula"] = obv["outputs"][0]["formula"].replace("0 - volume", "0 - volume / 2")
    _built, problems = build.derive(doc)
    assert any("on_balance_volume" in p and "SHIPPED version 1 moved" in p for p in problems), problems
    # WITHOUT the ledger the same change passes silently, which is what happened before
    assert build.derive(doc, shipped={})[1] == []


@needs_node
def test_the_same_change_made_as_a_new_version_passes_and_is_then_recorded_once():
    doc = as_a_seed_writes_it(library())
    obv = next(e for e in doc["indicators"] if e["id"] == "on_balance_volume")
    first = SHIPPED["on_balance_volume"]["1"]
    obv["outputs"][0]["formula"] = obv["outputs"][0]["formula"].replace("0 - volume", "0 - volume / 2")
    obv["versions"] = [{"version": 1, "maths": first, "since": "2026-11-18", "why": "first entry"},
                       {"version": 2, "maths": "", "since": "2026-11-19", "why": "a test"}]
    built, problems = build.derive(doc)
    assert problems == []
    waiting = build.unshipped(built, SHIPPED)
    assert [(i, v) for i, v, _f in waiting] == [("on_balance_volume", "2")]
    assert waiting[0][2].startswith("sha256:") and waiting[0][2] != first


@needs_node
def test_a_shipped_entry_or_version_that_is_gone_is_refused():
    doc = library()
    doc["indicators"] = [e for e in doc["indicators"] if e["id"] != "mass_index"]
    assert any("mass_index" in p and "is gone from the library" in p for p in build.derive(doc)[1])
    doc = library()
    nvi = next(e for e in doc["indicators"] if e["id"] == "negative_volume_index")
    nvi["versions"] = [{**nvi["versions"][1], "version": 1}]                # version 2's maths, presented as the only version
    problems = build.derive(doc)[1]
    assert any("negative_volume_index" in p and ("SHIPPED version 2 is gone" in p or "SHIPPED version 1 moved" in p)
               for p in problems), problems


def test_ledger_problems_reads_only_what_it_is_handed():
    doc = library()
    assert build.ledger_problems(doc, SHIPPED) == []
    assert build.ledger_problems(doc, {}) == []
    wrong = {"mass_index": {"1": "sha256:" + "0" * 64}}
    (problem,) = build.ledger_problems(doc, wrong)
    assert "mass_index" in problem and "SHIPPED version 1 moved" in problem
    (problem,) = build.ledger_problems(doc, {"never_was": {"1": "sha256:" + "0" * 64}})
    assert "never_was" in problem and "gone from the library" in problem


def test_shipping_only_adds(tmp_path):
    path = tmp_path / "ledger.json"
    doc = library()
    assert build.write_ledger(doc, path) == sum(len(e["versions"]) for e in doc["indicators"])
    first = path.read_text(encoding="utf-8")
    assert json.loads(first)["shipped"] == SHIPPED                          # the committed ledger is what the tool writes
    assert build.write_ledger(doc, path) == 0 and path.read_text(encoding="utf-8") == first     # nothing new: unchanged
    # a recorded line is never rewritten, even when the library is handed in with another fingerprint
    moved = copy.deepcopy(doc)
    next(e for e in moved["indicators"] if e["id"] == "mass_index")["versions"][0]["maths"] = "sha256:" + "f" * 64
    assert build.write_ledger(moved, path) == 0 and path.read_text(encoding="utf-8") == first
    assert build.read_ledger(tmp_path / "missing.json") == {}


@needs_node
def test_the_check_fails_while_a_version_is_not_in_the_ledger(tmp_path, monkeypatch, capsys):
    """`--check` is what a person runs before they push: a new version that was never recorded with
    `--ship` fails it, by name."""
    assert build.main(["--check"]) == 0
    partial = {"_": "", "shipped": {k: v for k, v in SHIPPED.items() if k != "ulcer_index"}}
    path = tmp_path / "ledger.json"
    path.write_text(json.dumps(partial), encoding="utf-8")
    monkeypatch.setattr(build, "LEDGER", path)
    capsys.readouterr()
    assert build.main(["--check"]) == 1
    assert "NOT IN THE LEDGER: ulcer_index v1" in capsys.readouterr().out
