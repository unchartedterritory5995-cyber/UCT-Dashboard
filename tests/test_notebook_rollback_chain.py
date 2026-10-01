"""Rails for the Notebook rollback chain (tools/notebook_rollback_chain.py; the procedure is
docs/notebook/wave5-rollback.md; scorecard clause 3b, lane R1 2026-09-28).

1. The chain names EVERY Notebook landing up to the tip it was measured at (derived from git,
   never a typed list), and the tool is current AT that tip. Whether it is current at a LIVE base
   (origin/master moves) is the operator's `--check`, railed here on synthetic commits; this file
   never asserts it of HEAD, where the world moving would read as a defect (R1b fix round 1).
2. The chain is newest first, one-parent squashes, each built on the next.
3. Rebuilding the chain from MEASURED_AT reproduces, tree for tree, the trees that were booted
   on a sandbox (docs/notebook/evidence/rollback-rehearsal-2026-09-28/chain/chain-primary-r2.jsonl),
   with both schema tables byte-identical to the tip at every step.
4. A conflict with no recorded rule stops the chain (fail closed), naming the file.

Every git call goes through `git -C <repo root>`; each assertion over git output has a
non-vacuity control (an empty answer is a failed invocation until proven otherwise).

Mutation record (docs/notebook/evidence/rollback-rehearsal-2026-09-29/mutations-r1b*.log): the
mutation that reverts the whole-file fingerprint fix is killed by the TREE-REBUILD test
(test_rebuilding_from_MEASURED_AT_reproduces_the_rehearsed_trees: the recorded pin no longer
matches, so the chain stops), NOT by test_no_pin_is_the_fingerprint_of_nothing -- PINS is a typed
table, and reverting the code does not change what is typed in it.

Lane R1c, 2026-09-29: MEASURED_AT moved again, from f4cec49be to 0812b5ec3 (L4 #251, L5 #252).
Both new landings revert with 0 conflicts; the ten pins recorded at f4cec49be came back
byte-identical. One new conflict was found four steps further down, at wave 8's own revert
(`caf6d1b9e`, `app/src/pages/Support.jsx`): TERM-039 (e90fddc34, REVIEWED_NOT_LANDINGS) added an
import+render that sits on lines wave 8's revert also touches. New mutation record:
docs/notebook/evidence/rollback-rehearsal-2026-09-29-r1c/mutations-r1c.log.

Lane R1d, 2026-09-29: MEASURED_AT moved again, from 0812b5ec3 to 8d08da86f (L6 #253, L7 #254).
L6 ships no `app/` or `api/` code (rollback-chain tooling + rehearsal evidence for L4/L5, a
restore-drill fix, proof-walk evidence) -- it is in CHAIN anyway (a real wave-10 landing, selected
by PATH only; see the tool's own SUBJECT-criterion comment) and its revert is conflict-free, same
as L7's. Four more path-only commits in the window were read and ruled NOT Notebook landings
(TERM-038 the command palette, breadth read/write-safety, TERM-049 Research History, the re-land
of an unrelated "wave 2" H15 rollback) -- all four added to REVIEWED_NOT_LANDINGS. One of them,
TERM-038 (8393002716), interleaves its dark "saved" palette rows inside the SAME functions wave
5's own quick-switcher introduced in `app/src/components/CommandPalette.jsx`, seven conflict
hunks deep with no separable lines; ruled "ours" (keep the newer work), the same shape as wave 7's
`api/services/daily_counters.py` rule. The fifteen pins recorded at 0812b5ec3 came back
byte-identical; the one new pin is wave 5's CommandPalette.jsx conflict. New mutation record:
docs/notebook/evidence/rollback-rehearsal-2026-09-29-r1d/mutations-r1d.log.

Lane R1d, continued (2026-09-29): L8 #255 landed on master mid-lane (controller note). MEASURED_AT
moved a third time, from 8d08da86f to 6f563c158. Same shape as L6: ships no app/ or api/ file (a
parity-scorecard re-score + writing-help production evidence), in CHAIN by path only
(CHAIN_BY_PATH_ONLY). One more path-only commit alongside it, cd9ecc833 (Fundamentals V5 cutover,
dark), touches only api/main.py (a lifespan scheduler-registration block moved to the worker pod)
-- added to REVIEWED_NOT_LANDINGS. All sixteen pins recorded at 8d08da86f came back
byte-identical; zero new conflicts anywhere in the chain. `--check --from origin/master` reports
current.

Lane R1e, 2026-09-30: MEASURED_AT moved a fourth time, from 6f563c158 to 599cd44f1 -- three
landings: L9 #256 (89390fb85, the rollback-chain tool's own coverage for L6/L7/L8 -- R1d's PR,
merged after R1d wrote MEASURED_AT=6f563c158 so it could not measure itself), L10 #257
(8eb7f008b, the 25-template gallery + design-review close-out) and L12 #258 (599cd44f1, silent
failures, the server-side sort toggle, typing fixes, the quote-in-list disable, scorecard 40/61).
L9 ships no app/ or api/ file (same shape as L6/L8) -- in CHAIN by path only. L10 and L12 DO ship
real app/ and api/ Notebook code, but their squash subjects read "Notebook w10 LN: ..." rather
than "Notebook 10/10 -- wave 10 LN: ...", dropping the literal word "wave" NOTEBOOK_SUBJECT
requires -- also in CHAIN by path only, a NEW reason for the same declared exception (see the
tool's own SUBJECT-criterion comment). All three revert with 0 product conflicts; all sixteen
pins recorded at 8d08da86f came back byte-identical (`--record-pins --through wave5` from the new
MEASURED_AT). Nine more path-only commits in the window were read and ruled NOT Notebook
landings -- two econ-harness entries to the shared reachable.test.js rail, an event-loop fix and a
Terminal-Next router mount each touching only api/main.py, a Terminal-Next flag reader touching
only api/routers/auth.py, a BRK-01 router+flag mount, a revert/reapply pair of another
workstream's wave-3 Pine-engine integrate merge (touching vite.config.js and one Notebook-owned
test file's await/lazy-load pairing only), and a clock/build-budget perf commit sharing the same
vite.config.js plugin -- all nine added to REVIEWED_NOT_LANDINGS. New mutation record:
docs/notebook/evidence/rollback-rehearsal-2026-09-30-r1e/mutations-r1e.log.

Lane R1f, 2026-09-30: MEASURED_AT moved a fifth time, from 599cd44f1 to a680b0d40 -- one landing:
L13 #259 (G-062 analyst-consensus capture, smoke + master-red fixes, rollback chain through L12).
L13 ships real app/ and api/ Notebook code and its squash subject kept the literal word "wave"
("Notebook 10/10 wave 10 L13: ..."), so unlike L10/L12 it is selected by SUBJECT AND PATH both --
no new CHAIN_BY_PATH_ONLY exception needed. It reverts with 0 conflicts (not even a doc-only one);
all seven pins recorded at 599cd44f1 came back byte-identical (`--record-pins --through wave5`
from the new MEASURED_AT). One more path-only commit landed alongside it, 69beea8d1 (Terminal
TERM-073, the nightly analyst-revisions "what changed" timeline, dark), touching only api/main.py
(one router mount behind ANALYST_REVISIONS_ENABLED) -- added to REVIEWED_NOT_LANDINGS. New
mutation record: docs/notebook/evidence/rollback-rehearsal-2026-09-30-r1f/mutations-r1f.log.

Lane R1g, 2026-10-01: MEASURED_AT moved a sixth time, from a680b0d40 to c75bf6ea0 -- one landing:
L14 #260 (public links skip the intro, locked notes refuse captures, links open, tools kept off
live data). L14 ships real app/ and api/ Notebook code and its squash subject kept the literal
word "wave" ("Notebook 10/10 wave 10 L14: ..."), so like L13 it is selected by SUBJECT AND PATH
both -- no new CHAIN_BY_PATH_ONLY exception needed. Five more path-only commits landed in the
window (a680b0d40..c75bf6ea0, the same push that carried hotfix #261 one commit above L14): four
are a Terminal TERM-067 accessible-name pass, each touching exactly one shared file already in
the derived Notebook set (desk/TeamSection.jsx, Settings.jsx twice, styles/tokens.css); the
fifth, c75bf6ea0 (hotfix(tools) #261), un-pins tools/record_clock_parity.py (KEEP_PATHS, excluded
regardless) and adds a test to tests/test_tools_pin_the_root.py -- selected ONLY because L14
itself created that file. All five added to REVIEWED_NOT_LANDINGS; MEASURED_AT is moved past the
hotfix, not left at L14's own sha, because a REVIEWED_NOT_LANDINGS entry must fall inside the
measured window this rail checks. Reverting L14 onto the new tip (which carries the hotfix's own
edit to tests/test_tools_pin_the_root.py) is NOT conflict-free this time: a real modify/delete
conflict on that one file, resolved "ours" (keep the hotfix's newer, non-Notebook test-rail work,
same shape as wave 7's daily_counters.py rule) -- RULES["0e7d0561a"], one new pin. All seven pins
recorded at a680b0d40 for steps below L14 came back byte-identical. New mutation record:
docs/notebook/evidence/rollback-rehearsal-2026-10-01-r1g/mutations-r1g.log.
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
# Re-recorded at MEASURED_AT 0e7d0561a (L14 #260) by lane R1g, 2026-10-01. The R1f record
# (rollback-rehearsal-2026-09-30-r1f/chain/chain-through-wave5.jsonl) is the same chain one
# landing shorter, from a680b0d40; it stays as the evidence of that rehearsal. The R1e record
# (rollback-rehearsal-2026-09-30-r1e/chain/chain-through-wave5.jsonl) is shorter still, from
# 599cd44f1; the R1d record (rollback-rehearsal-2026-09-29-r1d/chain/chain-through-wave5.jsonl)
# shorter still, from 6f563c158; the R1c record
# (rollback-rehearsal-2026-09-29-r1c/chain/chain-through-wave5.jsonl) shorter still, from
# 0812b5ec3; the R1b record (rollback-rehearsal-2026-09-29/chain/chain-through-wave5.jsonl)
# shorter still, from f4cec49be; the R1 2026-09-28 record
# (rollback-rehearsal-2026-09-28/chain/chain-primary-r2.jsonl) shorter still, from 38bb9a421.
RECORD = ROOT / "docs" / "notebook" / "evidence" / "rollback-rehearsal-2026-10-01-r1g" / "chain" / "chain-through-wave5.jsonl"
WAVE5 = "2c3ed3093"
# The tip the chain was measured at BEFORE lane R1g moved MEASURED_AT. Every commit between it and
# MEASURED_AT that the census selects was read by a person: a landing is in CHAIN, anything else
# is in REVIEWED_NOT_LANDINGS.
PREVIOUS_MEASURED_AT = "a680b0d40"
# The census is the TOOL's (`notebook_landings`: a subject criterion and a path criterion). This
# file never restates it; it proves the two criteria agree where they were measured and that the
# tool refuses a base whose census it has not measured.


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


def synthetic_commit(parent: str, subject: str, path: str, edit) -> str:
    """A commit built from OBJECTS ONLY on top of `parent` (temporary index, no ref, no worktree):
    `edit(old_bytes) -> new_bytes` applied to `path`. Unreferenced; git gc reclaims it."""
    import os
    import tempfile
    fd, idx = tempfile.mkstemp(prefix="nb-rb-test-idx-")
    os.close(fd)
    os.remove(idx)
    env = dict(os.environ, GIT_INDEX_FILE=idx)
    try:
        def g(*a, inp=None):
            r = subprocess.run(["git", "-C", str(ROOT), *a], capture_output=True, env=env, input=inp)
            assert r.returncode == 0, r.stderr
            return r.stdout
        g("read-tree", parent)
        old = subprocess.run(["git", "-C", str(ROOT), "cat-file", "blob", f"{parent}:{path}"],
                             capture_output=True).stdout
        blob = g("hash-object", "-w", "--stdin", inp=edit(old)).decode().strip()
        g("update-index", "--add", "--cacheinfo", f"100644,{blob},{path}")
        tree = g("write-tree").decode().strip()
        return g("commit-tree", tree, "-p", parent, "-m", subject).decode().strip()
    finally:
        if os.path.exists(idx):
            os.remove(idx)


def test_the_census_can_see_a_landing_and_can_refuse_a_neighbour(chain):
    """Non-vacuity: the derivation finds wave 5 and the tip it was measured at, and refuses two
    commits that sit right beside them -- a docs-only Notebook commit and another workstream's
    commit whose MESSAGE says notebook."""
    found = [c["sha"] for c in chain.notebook_landings(f"{WAVE5}^..{chain.MEASURED_AT}")]
    assert full(WAVE5) in found and full(chain.MEASURED_AT) in found
    assert full("dc2bdfeaa") not in found    # docs(notebook): ... -- docs only
    assert full("a8a91025d") not in found    # fix(voice): ... -- its body mentions the Notebook


def test_the_chain_names_every_notebook_landing_up_to_MEASURED_AT(chain):
    """The SUBJECT criterion selects exactly CHAIN's subject-selected entries over the measured
    range (every entry except the declared CHAIN_BY_PATH_ONLY exceptions -- see the test above),
    and the PATH criterion selects EVERY CHAIN landing including those (it is derived from them).
    The path criterion also selects other workstreams' commits there -- the broad, fail-closed
    trade the runbook states."""
    rows = chain.notebook_landings(f"{WAVE5}^..{chain.MEASURED_AT}")
    named = [full(s) for _k, s, _w in chain.CHAIN]
    named_by_subject = [full(s) for _k, s, _w in chain.CHAIN if s[:9] not in CHAIN_BY_PATH_ONLY]
    by_subject = [c["sha"] for c in rows if c["by_subject"]]
    assert by_subject == named_by_subject, (
        "tools/notebook_rollback_chain.py CHAIN must list every Notebook landing, newest first.\n"
        f"  landings git finds : {[s[:9] for s in by_subject]}\n"
        f"  CHAIN names        : {[n[:9] for n in named_by_subject]}")
    in_chain = {c["sha"]: c for c in rows if c["sha"] in named}
    assert len(in_chain) == len(named) and all(c["by_path"] for c in in_chain.values())


# The files the round-1 re-review found the hand-typed path regex missed (every one a Notebook
# file), plus public_note_payload.py, which the tool's own RULES and PINS already name.
REVIEWER_MISSED = (
    "app/src/pages/journal-2-0/hooks/useJ2Notes.js",
    "app/src/pages/journal-2-0/lib/importer/commit.js",
    "api/services/journal_two/public_note_payload.py",
    "api/services/journal_two/notes_export.py",
    "api/services/journal_two/notes_export_formats.py",
    "api/services/journal_two/document_extraction.py",
)


def test_the_derived_notebook_file_set_covers_what_the_regex_missed(chain):
    files = chain.notebook_files()
    assert len(files) > 100                   # non-vacuity: a derivation, not a stub
    missing = [f for f in REVIEWER_MISSED if f not in files]
    assert not missing, f"the derived Notebook file set lacks: {missing}"
    kept = [f for f in files if any(f == k or f.startswith(k + "/") for k in chain.KEEP_PATHS)]
    assert not kept, f"kept (never reverted) paths leaked into the census: {kept[:5]}"


def test_every_path_the_rules_and_pins_name_is_in_the_derived_set(chain):
    """Internal consistency: a file the tool resolves a conflict in is, by the tool's own say-so,
    Notebook-owned -- so the census must see a later commit that touches it."""
    files = chain.notebook_files()
    named = {p for rules in (chain.RULES, chain.PINS) for per in rules.values() for p in per}
    assert len(named) >= 8
    outside = sorted(named - files)
    assert not outside, f"RULES/PINS name files the census cannot see: {outside}"


def test_a_subjectless_hotfix_to_useJ2Notes_stops_the_tool(chain):
    """Review round 2's scenario: a fix whose subject never says 'notebook', touching only a
    Notebook file the hand-typed regex missed. The derived set catches it by path."""
    sha = synthetic_commit(full(chain.MEASURED_AT), "fix(j2): correct the schema stamp on forwarding",
                           "app/src/pages/journal-2-0/hooks/useJ2Notes.js",
                           lambda b: b + b"\n// synthetic\n")
    with pytest.raises(chain.ChainStopped, match=sha[:9] + r".*selected by path.*useJ2Notes\.js"):
        chain.run(sha, "L1c", emit=lambda _l: None)


def test_the_chain_is_current_at_MEASURED_AT(chain):
    """The tool's own refusal, asked of the tip it was measured at: deterministic. ⚰️ Until R1b
    fix round 1 this asked HEAD, so the world moving (another workstream's commit on master, a
    lane's own commits) turned a correct chain red. Staleness at a LIVE base is the operator's
    question, answered by `--check --from origin/master` (railed below), not by this file."""
    assert chain.check_base(full(chain.MEASURED_AT)) is None, chain.check_base(full(chain.MEASURED_AT))


def _check(chain, capsys, rev):
    rc = chain.main(["--check", "--from", rev])
    return rc, json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def test_check_says_current_on_a_base_with_nothing_uncharted(chain, capsys):
    """`--check` exit 0: MEASURED_AT itself, and a later docs-only commit on top of it."""
    rc, out = _check(chain, capsys, chain.MEASURED_AT)
    assert (rc, out["check"]) == (0, "current") and "stopped" not in out
    sha = synthetic_commit(full(chain.MEASURED_AT), "docs(terminal): synthetic, not Notebook work",
                           "docs/notebook/wave5-rollback.md", lambda b: b + b"\n")
    rc, out = _check(chain, capsys, sha)
    assert (rc, out["check"], out["from"]) == (0, "current", sha)


def test_check_says_stale_and_why_on_an_uncharted_landing(chain, capsys):
    """`--check` exit 2, naming the commit: a synthetic Notebook landing on top of MEASURED_AT,
    and a base that does not contain MEASURED_AT at all."""
    sha = synthetic_commit(full(chain.MEASURED_AT), "fix(notebook): a landing the chain does not name",
                           "app/src/pages/journal-2-0/tabs/NotebookTab.module.css",
                           lambda b: b + b"/* synthetic */\n")
    rc, out = _check(chain, capsys, sha)
    assert (rc, out["check"]) == (2, "stale")
    assert re.search(sha[:9] + r".*subject and path", out["stopped"])
    rc, out = _check(chain, capsys, "4bba30b73")
    assert (rc, out["check"]) == (2, "stale") and "does not contain MEASURED_AT" in out["stopped"]


# L6 (wave 10, PR #253), L8 (wave 10, PR #255) and L9 (wave 10, PR #256) each ship no `app/` or
# `api/` file at all -- rollback-chain tooling + rehearsal evidence, a restore-drill fix,
# proof-walk evidence, the parity-scorecard re-score and (L9) the rollback tool's own coverage for
# L6/L7/L8 -- so `ships` is false and SUBJECT can never select any of them, however their subject
# reads. All three are real wave-10 landings (the tool's own SUBJECT-criterion comment states the
# exception) and belong in CHAIN anyway, selected by PATH only: L6's and L9's one Notebook-owned
# file is both tests/test_notebook_rollback_chain.py, the rollback tool's own test suite; L8's is
# tests/test_parity_scorecard.py.
#
# L10 (wave 10, PR #257) and L12 (wave 10, PR #258) are a DIFFERENT reason for the same exception:
# both DO ship real `app/`/`api/` Notebook code (`ships` is true), but their squash subjects read
# "Notebook w10 L10: ..." / "Notebook w10 L12: ..." -- a subject-convention drift, lane R1e,
# 2026-09-30, that drops the literal word "wave" `NOTEBOOK_SUBJECT` requires, so SUBJECT still
# never selects them. Declared here, not inferred, so a FUTURE by-path-only CHAIN entry -- for
# either reason -- still has to earn its way in by name.
CHAIN_BY_PATH_ONLY = {"3fb184cdf", "6f563c158", "89390fb85", "8eb7f008b", "599cd44f1"}


def test_the_subject_criterion_selects_every_chain_landing(chain):
    """NOTEBOOK_SUBJECT is read off CHAIN's own squash subjects: every CHAIN entry is selected by
    SUBJECT (it ships app/ or api/ and its subject takes a landing's form) -- except the declared
    CHAIN_BY_PATH_ONLY exceptions, which must still be selected by PATH (the census must SEE them;
    nothing in CHAIN is silently unmonitored)."""
    missed = []
    for key, s, _w in chain.CHAIN:
        rows = chain.notebook_landings(f"{s}^..{s}")
        if s[:9] in CHAIN_BY_PATH_ONLY:
            if not (rows and rows[0]["by_path"] and not rows[0]["by_subject"]):
                missed.append((key, _git("log", "-1", "--format=%s", s).strip()[:70],
                                "declared by-path-only but the census disagrees"))
            continue
        if not (rows and rows[0]["by_subject"]):
            missed.append((key, _git("log", "-1", "--format=%s", s).strip()[:70]))
    assert len(chain.CHAIN) >= 14 and not missed, f"CHAIN landings the SUBJECT criterion misses: {missed}"


# Commits on master after MEASURED_AT that are not Notebook landings; the SUBJECT criterion must
# not select them (R1b fix round 1, 2026-09-29). Measured under the old `\bnotebook\b` pattern:
# 3e5153f1d WAS subject-selected (its subject says "Notebook bytes"); 3646a4c19 was not (the
# reviewer's second master commit, kept as a control that the narrowing loses nothing).
NOT_LANDING_SUBJECTS = {
    "3e5153f1d": "perf(build): strip symbolScope.json's prose from the bundle (Notebook bytes back under budget)",
    "3646a4c19": "test(pine): param ids re-pinned after new inputs minted; a partial-rig regen no longer erases licence-held maps",
}


def test_the_subject_criterion_refuses_a_subject_that_only_mentions_the_notebook(chain):
    for sha, subject in NOT_LANDING_SUBJECTS.items():
        assert not chain.NOTEBOOK_SUBJECT.search(subject), subject
        if _have(sha):                                  # the real commit, when this clone has it
            rows = chain.notebook_landings(f"{sha}^..{sha}")
            assert not any(r["by_subject"] for r in rows), f"{sha} is selected by SUBJECT"
    # control: the same pattern still selects a real landing's subject and a hotfix's
    assert chain.NOTEBOOK_SUBJECT.search("Notebook 10/10 — wave 10 L2: phone Journal header (#242)")
    assert chain.NOTEBOOK_SUBJECT.search("hotfix(notebook): H14 -- depth cap (#203)")


def test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed(chain):
    """Lane R1b moved MEASURED_AT from 38bb9a421 to f4cec49be. Everything the census selects in
    between was ruled on: a landing is in CHAIN, anything else in REVIEWED_NOT_LANDINGS. Derived
    from the tool's census, never from a typed list of what was expected.

    ⚰️ Until lane R1g this asserted `full(MEASURED_AT) in named` -- "the newest landing is the
    measured tip", true by coincidence in every prior lane because the newest commit the census
    had selected was always itself a landing. Lane R1g's own window (a680b0d40..c75bf6ea0) ends
    on a REVIEWED, non-landing commit one past L14 (hotfix #261, which the census selects only
    because L14's own squash created the file it touches) -- MEASURED_AT must cover it (a
    REVIEWED_NOT_LANDINGS entry has to fall inside the window this test itself walks), so it is
    no longer always a CHAIN member. The real invariant, generalised: the newest CHAIN landing is
    an ancestor of (or equal to) MEASURED_AT -- nothing in CHAIN is ever newer than the tip the
    chain was measured at."""
    rows = chain.notebook_landings(f"{PREVIOUS_MEASURED_AT}..{chain.MEASURED_AT}")
    assert len(rows) >= 2, "non-vacuity: the census found nothing in the window it was asked about"
    named = {full(s) for _k, s, _w in chain.CHAIN}
    newest_landing = full(chain.CHAIN[0][1])
    assert subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor",
                           newest_landing, full(chain.MEASURED_AT)], capture_output=True).returncode == 0, (
        f"the newest CHAIN landing {newest_landing[:9]} is not an ancestor of MEASURED_AT")
    unruled = [f"{c['sha'][:9]} {c['subject'][:60]}" for c in rows
               if c["sha"] not in named and c["sha"] not in chain.REVIEWED_NOT_LANDINGS]
    assert not unruled, f"selected by the census, ruled on by nobody: {unruled}"


def test_a_reviewed_commit_is_real_selected_by_path_only_and_never_a_landing(chain):
    """REVIEWED_NOT_LANDINGS can only ever quiet the PATH criterion: an entry the SUBJECT criterion
    selects is a landing and must be in CHAIN, and an entry the census does not select at all is a
    stale ruling. Each reason is a sentence, not a placeholder."""
    reviewed = chain.REVIEWED_NOT_LANDINGS
    assert len(reviewed) >= 1
    rows = {c["sha"]: c for c in chain.notebook_landings(f"{WAVE5}^..{chain.MEASURED_AT}")}
    named = {full(s) for _k, s, _w in chain.CHAIN}
    for sha, why in reviewed.items():
        assert re.fullmatch(r"[0-9a-f]{40}", sha), f"{sha}: REVIEWED_NOT_LANDINGS keys are full shas"
        assert sha not in named, f"{sha[:9]} is in CHAIN and in REVIEWED_NOT_LANDINGS"
        assert sha in rows, f"{sha[:9]}: the census does not select it; the ruling is stale"
        assert rows[sha]["by_path"] and not rows[sha]["by_subject"], (
            f"{sha[:9]} is selected by SUBJECT: a Notebook landing, not a reviewed neighbour")
        assert len(why.split()) >= 6, f"{sha[:9]}: the reason must say why it is not a landing"


_EMPTY_FP = __import__("hashlib").sha256(b"").hexdigest()[:16]


def test_no_pin_is_the_fingerprint_of_nothing(chain):
    """A pin over no bytes matches every conflict of its kind, so it can never stop the chain. It is
    what a whole-file rule recorded from its (absent) conflict markers used to produce."""
    pins = [(s, p, fp) for s, per in chain.PINS.items() for p, fp in per.items()]
    assert len(pins) >= 14
    empty = [(s, p) for s, p, fp in pins if fp == _EMPTY_FP]
    assert not empty, f"pins over no bytes: {empty}"
    unpinned = [(s, p) for s, per in chain.RULES.items() for p in per if p not in chain.PINS.get(s, {})]
    assert not unpinned, f"rules with no pin: {unpinned}"


def test_a_later_edit_to_a_file_a_whole_file_rule_keeps_stops_the_chain(chain, monkeypatch):
    """R1b: wave 7's revert keeps `api/services/daily_counters.py` ("ours": two later features
    import it). A later commit that changes that file is not what the rule was measured on, so the
    chain must stop at wave 7 -- before the fingerprint fix it resolved silently."""
    sha = synthetic_commit(full(chain.MEASURED_AT), "feat(terminal): a synthetic counter change",
                           "api/services/daily_counters.py", lambda b: b + b"\n# synthetic\n")
    monkeypatch.setattr(chain, "REVIEWED_NOT_LANDINGS", {sha: "synthetic terminal counter edit, test"})
    assert chain.check_base(sha) is None
    with pytest.raises(chain.ChainStopped, match=r"f883e0996: the conflict in api/services/daily_counters\.py"):
        chain.run(sha, "wave7", emit=lambda _l: None)


def test_the_tool_refuses_a_base_that_does_not_contain_MEASURED_AT(chain):
    older = full("4bba30b73")                 # #225: one landing BELOW the measured tip
    with pytest.raises(chain.ChainStopped, match=r"does not contain MEASURED_AT"):
        chain.run(older, "wave9", emit=lambda _l: None)


def test_the_tool_refuses_an_uncharted_landing_selected_by_subject_and_path(chain):
    sha = synthetic_commit(full(chain.MEASURED_AT), "fix(notebook): a landing the chain does not name",
                           "app/src/pages/journal-2-0/tabs/NotebookTab.module.css",
                           lambda b: b + b"/* synthetic */\n")
    with pytest.raises(chain.ChainStopped, match=sha[:9] + r".*subject and path"):
        chain.run(sha, "L1c", emit=lambda _l: None)


def test_the_tool_refuses_a_landing_the_subject_criterion_misses(chain):
    """M6: a Notebook hotfix whose subject never says 'notebook' is caught by its PATHS."""
    sha = synthetic_commit(full(chain.MEASURED_AT), "hotfix(j2): H14 -- a synthetic door fix",
                           "api/services/journal_two/notes.py", lambda b: b + b"\n# synthetic\n")
    with pytest.raises(chain.ChainStopped, match=sha[:9] + r".*selected by path"):
        chain.run(sha, "L1c", emit=lambda _l: None)


def test_a_non_notebook_commit_on_top_runs_and_warns(chain):
    """Control for the refusals: a later commit that is neither Notebook work nor on a recorded
    conflict's lines runs, and the run says the check list and rehearsal are mandatory."""
    sha = synthetic_commit(full(chain.MEASURED_AT), "docs(terminal): synthetic, not Notebook work",
                           "docs/notebook/wave5-rollback.md", lambda b: b + b"\n")
    lines = []
    final = chain.run(sha, "L1c", emit=lines.append)
    assert "MANDATORY" in json.loads(lines[0]).get("warning", "")
    assert final["from"] == sha


def test_a_later_commit_on_a_recorded_conflicts_lines_stops_the_chain(chain, monkeypatch):
    """I1: a later master commit mounts a new (non-Notebook) router beside the journal_two mount.
    The wave-8 revert's recorded rule was measured on a hunk without that line, so the chain must
    STOP rather than resolve it; before the pins it exited 0 and dropped the new mount."""
    mount = b"app.include_router(journal_two_router.router, dependencies=_OPEN_READS)\n"

    def add_router(b):
        assert b.count(mount) == 1
        return b.replace(mount, mount + b"app.include_router(terminal_synthetic_router.router)\n")
    sha = synthetic_commit(full(chain.MEASURED_AT), "feat(terminal): mount a synthetic router",
                           "api/main.py", add_router)
    # api/main.py is in the derived Notebook file set, so the census flags this commit first
    # (the stated fail-closed trade) ...
    assert "api/main.py" in (chain.check_base(sha) or "")
    # ... and once a person rules it is not a Notebook landing, the PIN is what stops the chain.
    monkeypatch.setattr(chain, "REVIEWED_NOT_LANDINGS", {sha: "synthetic terminal router, test"})
    assert chain.check_base(sha) is None
    with pytest.raises(chain.ChainStopped, match=r"api/main\.py is not the one"):
        chain.run(sha, "wave7", emit=lambda _l: None)


def test_through_a_kept_hotfix_is_refused_not_skipped(chain):
    for key in [k for k, s, _w in chain.CHAIN if s in chain.KEPT]:
        with pytest.raises(chain.ChainStopped, match="kept server hotfix"):
            chain.plan(key)
    assert chain.plan("203", revert_hotfixes=True)[-1][1] == "c6a8a9d3a"


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


_HISTORY = re.compile(r"^## .*History", re.M)
_PICK_WORDS = re.compile(r"(?i)cherry-pick|re-appl|hand-pick|pick it|re-pick")
_NEGATION = re.compile(r"(?i)\b(not|never|cannot)\b")


def _chunks_outside_history(text: str) -> list[str]:
    """The runbook minus its History section, split into paragraphs and list items. A chunk that
    opens with the tombstone mark describes superseded text and is exempt."""
    m = _HISTORY.search(text)
    if m:
        nxt = re.search(r"^## ", text[m.end():], re.M)
        text = text[:m.start()] + (text[m.end() + nxt.start():] if nxt else "")
    chunks = re.split(r"\n\s*\n|\n(?=\s*(?:[-*]|\d+\.) )", text)
    return [c for c in chunks if not c.lstrip("> ").startswith("⚰")]


def test_the_runbook_never_recommends_re_applying_82c56dd63_below_wave5(chain):
    """I3 (review round 1): outside History, every passage that talks about picking or re-applying
    82c56dd63 says NOT/never/cannot -- hand-picking it onto a wave-5 rollback leaves names undefined
    and the editor throws on mount. The tool agrees (GUARD_PICKS), and the explicit NEVER sentence
    is present."""
    text = DOC.read_text(encoding="utf-8")
    hits = [c for c in _chunks_outside_history(text) if "82c56dd63" in c and _PICK_WORDS.search(c)]
    assert len(hits) >= 2, f"non-vacuity: expected the keep-list and the stop section, found {len(hits)}"
    bad = [c.strip()[:160] for c in hits if not _NEGATION.search(c)]
    assert not bad, f"a passage outside History recommends picking 82c56dd63: {bad}"
    assert not re.search(r"cherry-pick\s+82c56dd63", _HISTORY.split(text)[0]), "a command picks 82c56dd63"
    assert "NEVER hand-pick `82c56dd63` below wave 5" in text
    assert "82c56dd63" not in chain.GUARD_PICKS
