"""The rail for the three baseline-diff directions — one case each, plus the mislabel it fixes.

⛔ THE DEFECT THIS PINS. The ad-hoc base-diff script printed, for an entry present in the baseline
but no longer failing at the base:

    "<== would be HUB-INTRODUCED and BLOCKS"

That direction is master-fixed / stale-baseline and NEVER blocks. Hub-introduced is the opposite:
a failure the BRANCH has that the base does not. A label saying BLOCKS on a non-blocking direction
is a wrong answer waiting for a reader in a hurry, so each direction now gets its own name, its own
consequence, and its own case here.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))

from gate_baseline_diff import BLOCKS, ADD, REMOVE, NOT_ASSESSED, classify, render  # noqa: E402

A = "src/a.test.js > d > only the branch fails this"
B = "src/b.test.js > d > only the base fails this"
C = "src/c.test.js > d > both fail this"
D = "src/d.test.js > d > only the baseline claims this"


def test_hub_introduced_is_branch_minus_base_and_it_blocks():
    r = classify(base={C}, baseline={C}, branch={A, C})
    assert r["hub_introduced"]["entries"] == [A]
    assert r["hub_introduced"]["consequence"] == BLOCKS
    assert "BLOCKED" in render(r)


def test_master_introduced_is_base_minus_baseline_and_it_is_added():
    r = classify(base={B, C}, baseline={C}, branch={C})
    assert r["master_introduced"]["entries"] == [B]
    assert r["master_introduced"]["consequence"] == ADD
    assert "citing the base hash" in r["master_introduced"]["consequence"]


def test_master_fixed_is_baseline_minus_base_and_it_NEVER_blocks():
    """⛔ THE MISLABELLED ONE. This is the direction the old script called HUB-INTRODUCED."""
    r = classify(base={C}, baseline={C, D}, branch={C})
    assert r["master_fixed"]["entries"] == [D]
    assert r["master_fixed"]["consequence"] == REMOVE
    assert "never blocks" in r["master_fixed"]["consequence"]
    # and it must NOT appear in the blocking direction, which is the actual bug
    assert r["hub_introduced"]["entries"] == []
    assert "BLOCKED" not in render(r)


def test_the_three_directions_do_not_overlap():
    """A single diff must place every entry in exactly one direction."""
    r = classify(base={B, C}, baseline={C, D}, branch={A, C})
    assert r["hub_introduced"]["entries"] == [A]
    assert r["master_introduced"]["entries"] == [B]
    assert r["master_fixed"]["entries"] == [D]
    seen = (r["hub_introduced"]["entries"] + r["master_introduced"]["entries"]
            + r["master_fixed"]["entries"])
    assert len(seen) == len(set(seen)), "an entry was classified into two directions"
    assert C not in seen, "a failure present everywhere is not a change and belongs in no direction"


def test_no_branch_measurement_is_reported_as_NOT_ASSESSED_never_as_clear():
    """⛔ The baseline file is a record of a PAST branch run and goes stale when master moves.
    Without a real branch measurement the tool must refuse to clear the branch rather than imply
    it — silence about the blocking direction is the failure mode that matters."""
    r = classify(base={C}, baseline={C, D})
    assert r["hub_introduced"]["entries"] is None
    assert r["hub_introduced"]["consequence"] == NOT_ASSESSED
    out = render(r)
    assert "cannot clear the branch" in out
    assert "no hub-introduced failures" not in out


def test_the_real_2026_09_09_diff_classifies_as_master_fixed_not_blocking():
    """The actual case: NoteEditorPage.durable was in the baseline, passed at the new base after
    master's 4fef130d9. The old script printed BLOCKS for it."""
    entry = ("src/pages/journal-2-0/components/notebook/NoteEditorPage.durable.test.jsx > "
             "the one-line rollback > the same keystroke DOES reach the store by DEFAULT")
    r = classify(base=set(), baseline={entry}, branch=set())
    assert r["master_fixed"]["entries"] == [entry]
    assert r["hub_introduced"]["entries"] == []
    assert "BLOCKED" not in render(r)
