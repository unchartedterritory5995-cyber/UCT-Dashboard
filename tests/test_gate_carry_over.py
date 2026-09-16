"""Rails for `tools/gate_carry_over.py` — the interaction-based carry-over ruling.

⛔ WHY BOTH DIRECTIONS ARE MANDATORY HERE. A carry-over tool that answers CARRIES to
everything is indistinguishable from a working one on every disjoint branch, and disjoint
is the common case — which is exactly when nobody looks. Every check below is asserted
positively (it fires on a planted defect) AND negatively (it stays quiet otherwise), and
the `decide()` cases drive the real function end to end rather than restating its parts.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))

from gate_carry_over import (  # noqa: E402
    GitFailed, VERDICT_CARRIES, VERDICT_REGATE, branch_files, c4_command, check_c1,
    check_c2, check_c3, decide, incoming_files, self_check,
)


def _proc(stdout="", rc=0, stderr=""):
    return type("P", (), {"returncode": rc, "stdout": stdout, "stderr": stderr})()


def _runner(mapping):
    """A git stand-in keyed by the joined argv tail, so a test says WHICH call it answers."""
    def run(argv):
        key = " ".join(argv[3:])          # drop: git -C <repo>
        if key not in mapping:
            return _proc(rc=128, stderr=f"unexpected git call: {key}")
        return _proc(mapping[key])
    return run


# ── C1 ───────────────────────────────────────────────────────────────────────────────
def test_c1_passes_on_a_disjoint_set_and_fails_on_a_planted_overlap():
    ok, paths = check_c1(["a/x.js"], ["b/p.js"])
    assert ok and paths == []
    ok, paths = check_c1(["a/x.js", "b/p.js"], ["b/p.js"])
    assert not ok, "a shared file must fail C1"
    assert paths == ["b/p.js"], "C1 must NAME the offending path, not just count it"


# ── C2 ───────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("edges,expect_fail,why", [
    ({}, False, "an empty graph has no edges to find"),
    ({"a/x.js": {"b/p.js"}}, True, "direct import, incoming -> branch"),
    ({"b/p.js": {"a/x.js"}}, True, "REVERSE direction, branch -> incoming"),
    ({"a/x.js": {"m/1.js"}, "m/1.js": {"b/p.js"}}, True, "transitive at exactly depth 2"),
    ({"a/x.js": {"m/1.js"}, "m/1.js": {"m/2.js"}, "m/2.js": {"b/p.js"}}, False,
     "three hops is BEYOND the declared bound and must not fire"),
])
def test_c2_table(edges, expect_fail, why):
    ok, hits = check_c2(["a/x.js"], ["b/p.js"], edges)
    assert (not ok) is expect_fail, f"{why}: got ok={ok} hits={hits}"


def test_c2_names_the_edge_it_found():
    """⛔ A count is not a finding. The next reader has to see WHICH edge."""
    ok, hits = check_c2(["a/x.js"], ["b/p.js"], {"a/x.js": {"b/p.js"}})
    assert not ok and any("a/x.js" in h and "b/p.js" in h for h in hits), hits


# ── C3 ───────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("incoming,branch,expect_fail", [
    (["app/vite.config.js"], [], True),
    (["app/vitest.setup.js"], [], True),
    (["app/package-lock.json"], [], True),
    (["app/src/App.jsx"], [], True),
    (["api/services/foo.py"], ["api/services/foo.py"], True),
    (["api/services/unrelated.py"], ["app/src/x.js"], False),
    (["app/src/components/chart/legend/LegendRow.jsx"], ["app/src/pages/journal-2-0/x.js"], False),
])
def test_c3_table(incoming, branch, expect_fail):
    ok, hits = check_c3(incoming, branch)
    assert (not ok) is expect_fail, f"incoming={incoming} branch={branch} hits={hits}"


def test_c3_scopes_api_to_what_the_branch_actually_touches():
    """⭐ The rule is 'any api/ the branch touches', not 'any api/ at all'. A branch with
    no Python cannot be perturbed by a Python file it never imports, and treating all of
    api/ as infra would re-create the whole-directory defect this ruling replaced."""
    ok, _ = check_c3(["api/services/breadth_combined_pass.py"], ["app/src/pages/x.js"])
    assert ok


# ── decide(), end to end ─────────────────────────────────────────────────────────────
def test_decide_CARRIES_on_a_disjoint_branch():
    run = _runner({"diff --name-only G L": "a/x.js\n",
                   "diff --name-only B...G": "b/p.js\n"})
    r = decide("G", "L", "B", edges={}, run=run)
    assert r["verdict"] == VERDICT_CARRIES, r
    assert r["checks"]["C1"]["pass"] and r["checks"]["C2"]["pass"] and r["checks"]["C3"]["pass"]


def test_decide_RE_GATES_and_NAMES_the_failing_check():
    run = _runner({"diff --name-only G L": "a/x.js\nb/p.js\n",
                   "diff --name-only B...G": "b/p.js\n"})
    r = decide("G", "L", "B", edges={}, run=run)
    assert r["verdict"] == VERDICT_REGATE
    assert "C1" in r["reason"], r["reason"]
    assert r["checks"]["C1"]["paths"] == ["b/p.js"]


def test_decide_RE_GATES_on_an_import_edge_alone():
    """The files are disjoint; only the AST says they interact. C1 alone would carry."""
    run = _runner({"diff --name-only G L": "a/x.js\n",
                   "diff --name-only B...G": "b/p.js\n"})
    r = decide("G", "L", "B", edges={"a/x.js": {"b/p.js"}}, run=run)
    assert r["verdict"] == VERDICT_REGATE and "C2" in r["reason"], r


def test_an_ABSENT_import_graph_re_gates_and_is_never_a_pass():
    """⛔⛔ UNKNOWN IS NOT A PASS. This layer has twice published a finding where a thing
    that could not be READ was scored as a thing that was EMPTY. Same sign-flip."""
    run = _runner({"diff --name-only G L": "a/x.js\n",
                   "diff --name-only B...G": "b/p.js\n"})
    r = decide("G", "L", "B", edges=None, run=run)
    assert r["verdict"] == VERDICT_REGATE
    assert r["checks"]["C2"]["pass"] is None
    assert "could not evaluate" in r["reason"], r["reason"]


def test_C0_short_circuits_to_CARRIES_without_touching_git():
    def explode(argv):
        raise AssertionError("C0 must short-circuit BEFORE any git call")
    r = decide("G", "L", "B", edges=None, run=explode, read_identical=lambda a, b: (True, []))
    assert r["verdict"] == VERDICT_CARRIES and "C0" in r["reason"]


# ── the failure that must never be silent ────────────────────────────────────────────
def test_a_FAILED_git_call_raises_instead_of_reporting_an_empty_file_list():
    """⛔ An empty result is a failed invocation until proven otherwise (rule 14). Every
    check here passes trivially over an empty set, so a git failure that returned []
    would manufacture a confident CARRIES."""
    with pytest.raises(GitFailed):
        incoming_files("G", "L", run=lambda argv: _proc(rc=128, stderr="bad revision"))
    with pytest.raises(GitFailed):
        branch_files("B", "G", run=lambda argv: _proc(rc=128, stderr="bad revision"))


# ── C4 is reported, never silently narrowed ──────────────────────────────────────────
def test_c4_command_names_files_and_never_uses_a_filter_flag():
    cmds = c4_command(["app/src/a.test.jsx", "tests/test_b.py"], ["app/src/c.test.js"])
    blob = " ".join(cmds)
    assert "src/a.test.jsx" in blob and "src/c.test.js" in blob and "tests/test_b.py" in blob
    # ⛔ `-k` still collects the whole tree; a vitest `-t` matching nothing exits 0.
    assert " -k " not in blob and " -t " not in blob, blob


def test_the_self_check_passes():
    assert self_check() == 0


def test_a_C0_MISS_falls_through_to_C1_C3_and_is_NOT_a_failure():
    """⛔⛔ THE DEFECT THIS TOOL SHIPPED WITH, caught on its first real run.

    C0 is a short-circuit: IDENTICAL means CARRIES with no further check. A C0 MISS is
    the ordinary case — it is the entire situation the interaction ruling was written
    for — so folding it into the failed set made the tool answer RE-GATE for a tree
    whose C1, C2 and C3 all passed. That is the old directory-only rule surviving inside
    the tool built to replace it.
    """
    run = _runner({"diff --name-only G L": "a/x.js\n",
                   "diff --name-only B...G": "b/p.js\n"})
    r = decide("G", "L", "B", edges={}, run=run,
               read_identical=lambda a, b: (False, ["app/src"]))
    assert r["verdict"] == VERDICT_CARRIES, r
    assert r["c0"]["identical"] is False and r["c0"]["paths"] == ["app/src"]
    assert "C0" not in r["checks"], "a C0 miss must not sit in the verdict's check set"
