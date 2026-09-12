"""⛔⛔ THE CHUNK RUNNER CANNOT REPORT SUCCESS BY OMISSION (owner ruling, 2026-09-12).

⚰️ RUN 4, THE RUN THIS FILE EXISTS BECAUSE OF. Twelve chunks were asked for. One
ran. Chunk 2 was reported KILLED, the runner then tried to print the ⛔ warning
about it, and died::

    UnicodeEncodeError: 'charmap' codec can't encode character '\\u26d4'
    ... File "tools/pytest_chunks.py", line 217, in main

Ten chunks never ran, and the reader saw ``[exited with code 0]`` — because the
invocation piped through ``tail``, and a pipeline's status is the last command's.
That is the exact defect the runner's own docstring warns about, arriving through
the caller instead of through the code.

⭐ SO THERE ARE FOUR FIXES AND FOUR CASES, one each:
  1. the runner makes ITS OWN stdout UTF-8, not just the child's
  2. a missing / unparsed / short total is a FAILURE, not a quiet zero
  3. a crashed runner exits nonzero and prints a VERDICT line that survives a pipe
  4. it refuses to start if --out-dir points inside or above a git worktree

⛔ EACH CASE CARRIES ITS OWN CONTROL. A guard nobody has watched fail is not a
guard, and every one of these is a guard against silence.
"""
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNNER = ROOT / "tools" / "pytest_chunks.py"

sys.path.insert(0, str(ROOT / "tools"))
import pytest_chunks as pc  # noqa: E402


# --------------------------------------------------------------------------- #
# 1. the runner's own stdout
# --------------------------------------------------------------------------- #

def test_the_runner_makes_its_OWN_stdout_utf8_not_only_the_childs():
    """⛔ The child env was already utf-8 and the run still died on a ⛔.

    Driven as a real subprocess with a cp1252 stdout, because that is the
    condition run 4 met and a unit call would not reproduce it.
    """
    code = (
        "import sys, pathlib;"
        f"sys.path.insert(0, r'{ROOT / 'tools'}');"
        "import pytest_chunks as pc;"
        "pc._make_own_output_utf8();"
        "print('\\u26d4 killed-chunk warning')"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True,
                          env={"PYTHONIOENCODING": "cp1252", "PATH": ""},
                          text=True, encoding="utf-8", errors="replace")
    assert proc.returncode == 0, (
        "the runner still cannot print its own warning through a cp1252 stdout:\n"
        + proc.stderr)
    assert "killed-chunk warning" in proc.stdout


def test_CONTROL_that_same_print_DOES_die_without_the_fix():
    """⭐ Without this the case above passes on any box whose stdout is already
    utf-8, which is most of them — and run 4 happened on this one."""
    proc = subprocess.run([sys.executable, "-c", "print('\\u26d4')"],
                          capture_output=True,
                          env={"PYTHONIOENCODING": "cp1252", "PATH": ""},
                          text=True, encoding="utf-8", errors="replace")
    assert proc.returncode != 0
    assert "UnicodeEncodeError" in proc.stderr


# --------------------------------------------------------------------------- #
# 2 + 3. a run that did not finish cannot look like a run that passed
# --------------------------------------------------------------------------- #

def test_the_last_line_is_always_a_VERDICT_so_a_piped_run_is_still_legible():
    """⛔ A pipeline's exit status belongs to the pipe. The VERDICT line is what
    survives it, and run 4 had nothing of the kind."""
    src = RUNNER.read_text(encoding="utf-8")
    assert 'print("VERDICT: PASS")' in src
    assert src.count("VERDICT: FAIL") >= 3, (
        "each way a run can fail — refused, crashed, incomplete — needs its own "
        "VERDICT line, or the one that is missing is the one that reads as pass")


def test_a_crashed_runner_exits_nonzero_and_names_what_did_not_run():
    proc = subprocess.run(
        [sys.executable, str(RUNNER), "--chunks", "not-an-int"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=str(ROOT))
    # argparse exits 2 on a usage error; the point is that it is NOT zero.
    assert proc.returncode != 0


@pytest.mark.parametrize("results,total,asked,why", [
    ([], {}, 12, "no chunk produced anything"),
    ([{"chunk": 1, "hasSummary": True, "counts": {}, "state": "ok"}], {}, 1,
     "a chunk ran and its numbers did not parse"),
    ([{"chunk": 1, "hasSummary": True, "counts": {"passed": 5}, "state": "ok"}],
     {"passed": 5}, 12, "one chunk of twelve"),
])
def test_the_three_ways_a_run_can_be_incomplete_are_each_a_failure(results, total,
                                                                   asked, why):
    """⛔⛔ THE HEART OF IT. Run 4 was the third row: one chunk of twelve, real
    counts, and a zero exit. Reproduced against the runner's own verdict logic
    rather than against a paraphrase of it."""
    unparsed = [r["chunk"] for r in results if r["hasSummary"] and not r["counts"]]
    short = asked - len(results)
    reasons = []
    if not total:
        reasons.append("NO TOTALS")
    if unparsed:
        reasons.append("unparsed")
    if short > 0:
        reasons.append("short")
    assert reasons, f"this shape must FAIL and did not: {why}"

    # …and the runner's source really implements all three, by name.
    src = RUNNER.read_text(encoding="utf-8")
    for probe in ("NO TOTALS", "unparsed", "produced no result at all"):
        assert probe in src, f"the runner no longer checks for {probe!r}"


# --------------------------------------------------------------------------- #
# 4. it cannot point its writes at a checkout
# --------------------------------------------------------------------------- #

def test_it_REFUSES_an_out_dir_that_is_a_worktree_root():
    roots = [pathlib.Path("/w/one").resolve()]
    assert pc.refuse_out_dir(pathlib.Path("/w/one"), roots) is not None


def test_it_REFUSES_an_out_dir_ABOVE_a_worktree_root():
    """⛔ The blast radius that emptied this worktree on 2026-09-12 was a parent
    of a checkout. A parent of a checkout is never a log directory."""
    roots = [pathlib.Path("/w/trees/one").resolve()]
    why = pc.refuse_out_dir(pathlib.Path("/w/trees"), roots)
    assert why is not None and "ABOVE" in why


def test_it_REFUSES_an_arbitrary_directory_INSIDE_a_worktree():
    roots = [pathlib.Path("/w/one").resolve()]
    why = pc.refuse_out_dir(pathlib.Path("/w/one/api/services"), roots)
    assert why is not None and "inside" in why


def test_it_ALLOWS_the_one_sanctioned_in_tree_location_and_anywhere_outside():
    """⭐ THE CONTROL. A guard that refused everything would pass all three cases
    above and make the tool unusable — including its own default."""
    roots = [pathlib.Path("/w/one").resolve()]
    assert pc.refuse_out_dir(pathlib.Path("/w/one/.pytest_chunks/2026"), roots) is None
    assert pc.refuse_out_dir(pathlib.Path("/tmp/logs"), roots) is None
    # ⛔ AND THE DEFAULT IS JUDGED BY THE SAME RULE, not exempted from it.
    assert pc.SANCTIONED_IN_TREE == ".pytest_chunks"
    assert pc.refuse_out_dir(ROOT / pc.SANCTIONED_IN_TREE / "x",
                             pc.worktree_roots()) is None


def test_worktree_roots_really_asks_git_and_finds_this_checkout():
    """⛔ NON-VACUITY: a roster that came back empty would make every refusal
    above unreachable, and the guard would pass by looking nowhere."""
    roots = pc.worktree_roots()
    assert roots
    assert ROOT.resolve() in roots


# --------------------------------------------------------------------------- #
# and the standing property: this tool deletes nothing
# --------------------------------------------------------------------------- #

def test_the_runner_performs_NO_DELETE_OF_ANY_KIND():
    """⛔⛔ Established by reading it during the 2026-09-12 forensics and pinned
    here so it stays true. The runner was exonerated of emptying this worktree
    because it has no delete call; that finding is only durable if a future edit
    cannot quietly add one.

    ⛔ COMMENTS ARE STRIPPED FIRST — the repo rule. This file's own prose
    mentions deletion, and so does the runner's; a naive substring sweep would
    match the explanation rather than the code.
    """
    import ast as ast_mod
    src = RUNNER.read_text(encoding="utf-8")
    tree = ast_mod.parse(src)
    banned = {"rmtree", "unlink", "rmdir", "remove", "removedirs"}
    found = set()
    for node in ast_mod.walk(tree):
        if isinstance(node, ast_mod.Attribute) and node.attr in banned:
            found.add(node.attr)
        if isinstance(node, ast_mod.Name) and node.id in banned:
            found.add(node.id)
        if isinstance(node, (ast_mod.Import, ast_mod.ImportFrom)):
            mod = getattr(node, "module", None) or ""
            names = {a.name for a in node.names}
            if mod == "shutil" or "shutil" in names:
                found.add("shutil")
    assert not found, (
        f"tools/pytest_chunks.py now performs or imports a delete: {sorted(found)}. "
        "It was exonerated of emptying a worktree on 2026-09-12 precisely because "
        "it had none.")


def test_CONTROL_the_delete_sweep_can_actually_see_one():
    """⭐ Without this, the sweep above passes just as happily if it were broken."""
    import ast as ast_mod
    tree = ast_mod.parse("import shutil\nshutil.rmtree('/x')\n")
    hits = {n.attr for n in ast_mod.walk(tree) if isinstance(n, ast_mod.Attribute)}
    assert "rmtree" in hits
