"""Rails for the Notebook rollback chain (tools/notebook_rollback_chain.py; the procedure is
docs/notebook/wave5-rollback.md; scorecard clause 3b, lane R1 2026-09-28).

1. The chain names EVERY Notebook landing up to the tip it was measured at, and no landing
   after that tip is missing from it -- a landing the chain does not revert is a landing the
   procedure cannot roll back (derived from git, never a typed list).
2. The chain is newest first, one-parent squashes, each built on the next.
3. Rebuilding the chain from MEASURED_AT reproduces, tree for tree, the trees that were booted
   on a sandbox (docs/notebook/evidence/rollback-rehearsal-2026-09-28/chain/chain-primary-r2.jsonl),
   with both schema tables byte-identical to the tip at every step.
4. A conflict with no recorded rule stops the chain (fail closed), naming the file.

Every git call goes through `git -C <repo root>`; each assertion over git output has a
non-vacuity control (an empty answer is a failed invocation until proven otherwise).
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "notebook_rollback_chain.py"
RECORD = ROOT / "docs" / "notebook" / "evidence" / "rollback-rehearsal-2026-09-28" / "chain" / "chain-primary-r2.jsonl"
WAVE5 = "2c3ed3093"
# A Notebook landing: a one-parent commit whose SUBJECT names the Notebook (or wave 9C, the
# Notebook's soak instrument) and which changes shipped code (app/ or api/). Docs-only Notebook
# commits and other workstreams' commits that touch Journal files are not landings.
SUBJECT = re.compile(r"(?i)\bnotebook\b|^wave 9c\b")


def _load():
    spec = importlib.util.spec_from_file_location("nb_rollback_chain", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _git(*a: str) -> str:
    r = subprocess.run(["git", "-C", str(ROOT), *a], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, f"git {' '.join(a)} failed: {r.stderr}"
    return r.stdout


def _have(rev: str) -> bool:
    return subprocess.run(["git", "-C", str(ROOT), "cat-file", "-e", f"{rev}^{{commit}}"],
                          capture_output=True).returncode == 0


@pytest.fixture(scope="module")
def chain():
    mod = _load()
    # What the rail walks must be present (a shallow clone cut above wave 5 cannot see the
    # landings). NOT `--is-shallow-repository`: this box's clone is shallow far below wave 5.
    need = [f"{WAVE5}^", mod.MEASURED_AT, *mod.GUARD_PICKS]
    absent = [r for r in need if not _have(r)]
    if absent:
        pytest.skip(f"history this rail audits is not in the clone: {absent}")
    return mod


def full(rev: str) -> str:
    return _git("rev-parse", "--verify", f"{rev}^{{commit}}").strip()


def landings(rng: str) -> list[str]:
    """Notebook landings in `rng`, newest first (full SHAs)."""
    out = []
    for line in _git("log", "--format=%H %P%x09%s", rng).splitlines():
        head, subject = line.split("\t", 1)
        sha, *parents = head.split()
        if len(parents) != 1 or not SUBJECT.search(subject):
            continue
        files = _git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).splitlines()
        if any(f.startswith(("app/", "api/")) for f in files):
            out.append(sha)
    return out


def test_the_census_can_see_a_landing_and_can_refuse_a_neighbour(chain):
    """Non-vacuity: the derivation finds wave 5 and the tip it was measured at, and refuses two
    commits that sit right beside them -- a docs-only Notebook commit and another workstream's
    commit whose MESSAGE says notebook."""
    found = landings(f"{WAVE5}^..{chain.MEASURED_AT}")
    assert full(WAVE5) in found and full(chain.MEASURED_AT) in found
    assert full("dc2bdfeaa") not in found    # docs(notebook): ... -- docs only
    assert full("a8a91025d") not in found    # fix(voice): ... -- its body mentions the Notebook


def test_the_chain_names_every_notebook_landing_up_to_MEASURED_AT(chain):
    found = landings(f"{WAVE5}^..{chain.MEASURED_AT}")
    named = [full(s) for _k, s, _w in chain.CHAIN]
    assert found == named, (
        "tools/notebook_rollback_chain.py CHAIN must list every Notebook landing, newest first.\n"
        f"  landings git finds : {found}\n  CHAIN names        : {named}")


def test_no_notebook_landing_after_MEASURED_AT_is_left_out(chain):
    """A landing newer than the measured tip makes the procedure stale: the chain cannot revert
    it, and nothing about it was rehearsed. Add it to CHAIN (newest first), run the tool from
    the new tip, record a rule for any conflict it stops on, rehearse the new step on a sandbox,
    and move MEASURED_AT."""
    if subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", chain.MEASURED_AT, "HEAD"],
                      capture_output=True).returncode != 0:
        pytest.skip(f"HEAD does not contain {chain.MEASURED_AT}: nothing newer to audit on this branch")
    newer = landings(f"{chain.MEASURED_AT}..HEAD")
    named = {full(s) for _k, s, _w in chain.CHAIN}
    missing = [s[:9] for s in newer if s not in named]
    assert not missing, (f"Notebook landings after {chain.MEASURED_AT} that the rollback chain does not "
                         f"name: {missing}. " + (test_no_notebook_landing_after_MEASURED_AT_is_left_out.__doc__ or ""))


def test_the_chain_is_newest_first_one_parent_squashes(chain):
    shas = [s for _k, s, _w in chain.CHAIN]
    assert len(shas) == len(set(shas)) >= 2
    for s in shas:
        assert len(_git("show", "--no-patch", "--format=%P", s).split()) == 1, f"{s} is not a one-parent squash"
        assert subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", s, chain.MEASURED_AT],
                              capture_output=True).returncode == 0, f"{s} is not in {chain.MEASURED_AT}"
    for newer, older in zip(shas, shas[1:]):
        assert subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", older, newer],
                              capture_output=True).returncode == 0, f"{older} is not older than {newer}"
    for g in chain.GUARD_PICKS:
        assert _have(g), f"guard commit {g} is not in this repository (tag notebook-wave5-guard-{g})"
    assert chain.KEPT <= set(shas)


def test_rebuilding_from_MEASURED_AT_reproduces_the_rehearsed_trees(chain):
    """Tree for tree, the chain the sandbox booted. A changed rule, a dropped keep-path or a
    dropped schema restore changes a tree here before it changes a member's Notebook."""
    recorded = [json.loads(l) for l in RECORD.read_text(encoding="utf-8").splitlines()]
    want = [(d["squash"], d["tree"]) for d in recorded if "squash" in d]
    got, lines = [], []
    final = chain.run(chain.MEASURED_AT, "wave5", emit=lines.append)
    for line in lines[:-1]:
        d = json.loads(line)
        got.append((d["squash"][:9], d["tree"]))
        assert d["schema_identical_to_tip"], f"{d['squash']}: a schema table differs from the tip"
    assert len(got) == len(want) >= 13
    assert got == [(s[:9], t) for s, t in want]
    assert final["tree"] == want[-1][1]
    # the schema restore is not idle: wave 6's and wave 5's reverts would have changed a table
    changed = {json.loads(l)["key"]: json.loads(l)["schema_change_undone"] for l in lines[:-1]}
    assert {k for k, v in changed.items() if v} >= {"wave6", "wave5", "guard-8167f7aa0"}
    assert set(chain.SCHEMA_RAILS) <= set(changed["wave5"])


def test_an_unrecorded_conflict_stops_the_chain(chain, monkeypatch):
    """Fail closed: take away the rule for one known conflict (wave 8's api/main.py) and the
    chain must stop there and name the file, never resolve it some other way."""
    rules = {k: dict(v) for k, v in chain.RULES.items()}
    del rules["caf6d1b9e"]["api/main.py"]
    monkeypatch.setattr(chain, "RULES", rules)
    with pytest.raises(chain.ChainStopped, match=r"api/main\.py"):
        chain.run(chain.MEASURED_AT, "wave8", emit=lambda _l: None)


DOC = ROOT / "docs" / "notebook" / "wave5-rollback.md"
_DOC_ROW = re.compile(r"^\| `([^`]+)` \| `([0-9a-f]{9})` \| (.*?) \| (\*\*kept\*\*)? ?\|$")


def test_the_runbooks_chain_table_is_the_tools_chain():
    """The runbook's step-0 table restates CHAIN and KEPT for a reader; it must not drift from the
    tool (one authority: the tool; this rail ties the copy to it). Order, keys, squashes, and which
    rows are kept."""
    rows = [m.groups() for m in map(_DOC_ROW.match, DOC.read_text(encoding="utf-8").splitlines()) if m]
    assert len(rows) >= 10, f"non-vacuity: the runbook's chain table was not found ({len(rows)} rows)"
    mod = _load()
    assert [(k, s) for k, s, _w, _kept in rows] == [(k, s[:9]) for k, s, _w in mod.CHAIN]
    assert {s for _k, s, _w, kept in rows if kept} == {s[:9] for s in mod.KEPT}
