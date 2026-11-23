"""The rail on tools/ci_mutant_manifests.py (2026-11-23): every mutant in ci/mutants/*.json still names text that exists
exactly once in its file, or is on the debt list ci/mutants-stale-baseline.json, which only shrinks.

WHY. A manifest is run only when someone dispatches it. An edit to a target file afterwards can leave a `from` that
matches nothing: the mutant would mutate nothing, and the manifest still reads as proof. On 2026-11-23, master
`80398c94`: 45 of 849 mutants, in 18 of 82 manifests, and no check had said so.

IF THIS IS RED ON YOUR PULL REQUEST: your change edited a line that a mutant's `from` quotes (the message names the
manifest and the mutant). Give that mutant the `from` and `to` of the new text and run it
(`python tools/ci_mutant_runner.py --manifest ci/mutants/<name>.json --out out.json`), or delete it with its reason.
Do not add it to the baseline.

Run ONLY this file:  python -m pytest tests/test_ci_mutant_manifests.py -q
Standard library. The controls at the bottom plant each kind of drift in a temp tree and require the judge to name it.
"""
from __future__ import annotations

import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import ci_mutant_manifests as T  # noqa: E402

#: the size of the debt list. It only goes DOWN: lower it when the list shrinks, never raise it. 45 the day it was
#: written; 0 since fix/stale-mutant-anchors (2026-11-23) re-anchored 44 and deleted 1 with its reason.
CEILING = 0


@pytest.fixture(scope="module")
def found():
    return T.census(ROOT)


def test_the_stale_set_is_exactly_the_baseline(found):
    out = T.problems(ROOT, found)
    assert not out, "\n".join(out)


def test_the_census_is_not_vacuous_and_the_debt_list_only_shrinks(found):
    assert found["manifests"] >= 60 and found["mutants"] >= 600, f"only {found['manifests']} manifests / {found['mutants']} mutants: the walk is broken"
    listed = sum(len(ids) for ids in T.load_baseline(ROOT).values())
    assert listed <= CEILING, f"{T.BASELINE} lists {listed} stale mutants, over the ceiling of {CEILING}: it takes no new entry"


# ---- controls: a temp tree with one target file and one manifest ---------------------------------------------------------
TARGET = "alpha = 1\nbeta = 2\nbeta = 2\ngamma = [\n    3,\n]\n"


def _tree(tmp_path, mutants, baseline=None, target=TARGET, schema="uct.ci-mutants/v1"):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "x.py").write_bytes(target.encode("utf-8"))
    (tmp_path / "ci" / "mutants").mkdir(parents=True)
    (tmp_path / "ci" / "mutants" / "m.json").write_text(json.dumps({"schema": schema, "mutants": mutants}), encoding="utf-8")
    if baseline is not None:
        (tmp_path / T.BASELINE).write_text(json.dumps({"schema": T.BASELINE_SCHEMA, "stale": baseline}), encoding="utf-8")
    return tmp_path


def _m(mid, old, new="changed", file="src/x.py"):
    return {"id": mid, "mutant": "a control", "file": file, "from": old, "to": new, "rail": "true"}


def test_CONTROL_a_tree_whose_mutants_all_resolve_is_clean(tmp_path):
    root = _tree(tmp_path, [_m("A", "alpha = 1"), _m("G", "gamma = [\n    3,\n]")])
    assert T.census(root) == {"manifests": 1, "mutants": 2, "stale": {}} and T.problems(root) == []


@pytest.mark.parametrize("label,mutant,word", [
    ("the text is gone", _m("A", "alpha = 99"), "occurs 0 times"),
    ("the text is there twice", _m("A", "beta = 2"), "occurs 2 times"),
    ("the file is gone", _m("A", "alpha = 1", file="src/gone.py"), "is not a file inside the repo"),
    ("the file is outside the repo", _m("A", "alpha = 1", file="../x.py"), "is not a file inside the repo"),
    ("nothing is mutated", _m("A", "alpha = 1", new="alpha = 1"), "nothing is mutated"),
    ("a field is missing", {"id": "A", "mutant": "m", "file": "src/x.py", "from": "alpha = 1", "to": "x"}, "missing or empty"),
])
def test_CONTROL_a_new_stale_mutant_is_named_and_the_baseline_does_not_take_it_silently(tmp_path, label, mutant, word):
    root = _tree(tmp_path, [mutant, _m("OK", "gamma = [")])
    out = T.problems(root)
    assert len(out) == 1 and "ci/mutants/m.json mutant" in out[0] and word in out[0] and "NEW" in out[0], (label, out)
    # ... and once it IS on the debt list, the two sets agree
    key = next(iter(T.census(root)["stale"]["m.json"]))
    (root / T.BASELINE).write_text(json.dumps({"schema": T.BASELINE_SCHEMA, "stale": {"m.json": [key]}}), encoding="utf-8")
    assert T.problems(root) == [], label


def test_CONTROL_a_baselined_mutant_that_resolves_again_must_leave_the_list(tmp_path):
    root = _tree(tmp_path, [_m("A", "alpha = 1"), _m("B", "beta = 2")], baseline={"m.json": ["A", "B"], "gone.json": ["Z"]})
    out = T.problems(root)
    assert len(out) == 2 and all("only shrinks" in line for line in out), out
    assert "m.json mutant A" in out[1] and "gone.json mutant Z" in out[0], out      # B is still stale: not named


@pytest.mark.parametrize("label,write,word", [
    ("not JSON", lambda p: p.write_text("{not json", encoding="utf-8"), "cannot be read as JSON"),
    ("another schema", lambda p: p.write_text(json.dumps({"schema": "other", "mutants": [_m("A", "alpha = 1")]}), encoding="utf-8"), "schema must be"),
    ("no mutants", lambda p: p.write_text(json.dumps({"schema": "uct.ci-mutants/v1", "mutants": []}), encoding="utf-8"), "non-empty list"),
    ("a mutant that is not an object", lambda p: p.write_text(json.dumps({"schema": "uct.ci-mutants/v1", "mutants": ["x"]}), encoding="utf-8"), "must be an object"),
    ("one id twice", lambda p: p.write_text(json.dumps({"schema": "uct.ci-mutants/v1", "mutants": [_m("A", "alpha = 1"), _m("A", "gamma = [")]}), encoding="utf-8"), "duplicate id"),
])
def test_CONTROL_a_broken_manifest_is_named_and_can_never_be_baselined(tmp_path, label, write, word):
    root = _tree(tmp_path, [_m("A", "alpha = 1")])
    write(root / "ci" / "mutants" / "m.json")
    out = T.problems(root)
    assert len(out) == 1 and word in out[0] and "never baselined" in out[0], (label, out)
    (root / T.BASELINE).write_text(json.dumps({"schema": T.BASELINE_SCHEMA, "stale": {"m.json": [T.WHOLE]}}), encoding="utf-8")
    assert len(T.problems(root)) == 2, label        # still the manifest's problem, plus the list's own


@pytest.mark.parametrize("doc", [
    {"schema": "other", "stale": {}}, {"schema": T.BASELINE_SCHEMA, "stale": []}, {"schema": T.BASELINE_SCHEMA, "stale": {"m.json": []}},
    {"schema": T.BASELINE_SCHEMA, "stale": {"m.json": ["A", "A"]}}, {"schema": T.BASELINE_SCHEMA, "stale": {"m.json": "A"}},
])
def test_CONTROL_a_malformed_baseline_is_a_problem_not_an_empty_list(tmp_path, doc):
    root = _tree(tmp_path, [_m("A", "alpha = 1")])
    (root / T.BASELINE).write_text(json.dumps(doc), encoding="utf-8")
    out = T.problems(root)
    assert len(out) == 1 and T.BASELINE in out[0], out


def test_CONTROL_a_CRLF_checkout_is_judged_with_the_blobs_line_ends_and_nothing_is_written_in_the_repo(tmp_path):
    """core.autocrlf=true gives the same blobs with CRLF. A `from` with a newline in it must still resolve there, and a
    stale one must still be stale. The repo's own files are not rewritten."""
    crlf = TARGET.replace("\n", "\r\n")
    root = _tree(tmp_path, [_m("G", "gamma = [\n    3,\n]"), _m("A", "alpha = 99\n")], target=crlf)
    got = T.census(root)["stale"]
    assert list(got) == ["m.json"] and list(got["m.json"]) == ["A"] and "occurs 0 times" in got["m.json"]["A"], got
    assert (root / "src" / "x.py").read_bytes() == crlf.encode("utf-8")
    assert sorted(p.name for p in root.iterdir()) == ["ci", "src"]


def test_CONTROL_the_cli_exits_1_with_a_line_per_problem_and_0_when_the_sets_agree(tmp_path, capsys):
    root = _tree(tmp_path, [_m("A", "alpha = 99")])
    assert T.main(["--repo", str(root), "--list"]) == 1
    text = capsys.readouterr().out
    assert "1 manifests, 1 mutants, 1 stale in 1 manifests" in text and "::error::ci/mutants/m.json mutant A" in text
    (root / T.BASELINE).write_text(json.dumps({"schema": T.BASELINE_SCHEMA, "stale": {"m.json": ["A"]}}), encoding="utf-8")
    assert T.main(["--repo", str(root)]) == 0
