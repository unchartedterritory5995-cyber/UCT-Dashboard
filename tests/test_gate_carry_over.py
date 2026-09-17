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
    GitFailed, PY_READ_PATHS, VERDICT_CARRIES, VERDICT_REGATE, branch_files, c4_command,
    check_c1, check_c2, check_c3, decide, incoming_files, python_landing, self_check,
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


def test_C0_short_circuits_past_C1_C2_C3_but_still_reads_the_BRANCH_diff():
    """⚰️ THE CONTRACT CHANGED ON 2026-09-17 AND THIS RAIL RECORDS WHY, rather than being
    deleted. It used to assert C0 short-circuits before ANY git call. It cannot any more:
    C0 covers the VITEST half only, so the tool must still ask whether the branch carries
    PYTHON — and that question is a branch diff. What C0 still skips is the expensive part
    and the part that would be wrong to skip silently: the INCOMING diff (C1) and the AST
    walk (C2/C3).

    ⛔ Deleting this rail instead of amending it would have removed the only statement of
    what C0 is allowed to do."""
    seen = []

    def watch(argv):
        seen.append(" ".join(argv[3:]))
        return _proc("scripts/gate_shards.py" + chr(10))

    r = decide("G", "L", "B", edges=None, run=watch, read_identical=lambda a, b: (True, []))
    assert r["verdict"] == VERDICT_CARRIES and "C0" in r["reason"]
    assert all("B...G" in c for c in seen), f"C0 ran a non-branch git call: {seen}"
    assert not any("G L" in c for c in seen), "C0 must NOT run the incoming (C1) diff"
    for name in ("C1", "C2", "C3"):
        assert name not in r["checks"], f"{name} ran despite the C0 short-circuit"


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


# ══════════════════════════════════════════════════════════════════════════════════════
# C4-PYTHON — the half C0 cannot see (owner ruling 2026-09-17)
#
# ⚰️ THE FALSE REASSURANCE THIS EXISTS FOR. On 2026-09-16 a landing carrying ONLY Python
# got `C0 IDENTICAL — short-circuit` while master's merge had brought 32 files into
# `tests/`, including `tests/conftest.py`. `GATE_READ_PATHS` describes what the VITEST
# gate reads; it contains no Python path at all. The conftest change happened to be
# inert — the tool did not know that and could not have.
# ══════════════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("branch,expect", [
    (["scripts/gate_shards.py"], True),
    (["tools/gate_box_lock.py"], True),
    (["tests/conftest.py"], True),          # ⛔ THE PLANTED-CONFTEST CONTROL
    (["tests/test_gate_shards.py"], True),
    (["api/main.py"], True),
    (["app/src/pages/x.js"], False),        # a pure frontend landing needs no python run
    (["docs/notebook/foo.md"], False),      # docs alone likewise
])
def test_python_landing_fires_on_exactly_the_paths_that_carry_python(branch, expect):
    assert bool(python_landing(branch)) is expect, (branch, python_landing(branch))


def test_a_C0_HIT_still_makes_C4_PYTHON_MANDATORY_when_the_branch_carries_python():
    """⛔⛔ THE WHOLE RULING IN ONE CASE. C0 short-circuits the VITEST half and nothing
    else. A landing that carries Python must still run its Python rails on the LANDING
    tree, because C0 read a set containing no Python path."""
    run = _runner({"diff --name-only B...G": "scripts/gate_shards.py\n"})
    r = decide("G", "L", "B", edges=None, run=run, read_identical=lambda a, b: (True, []))
    assert r["verdict"] == VERDICT_CARRIES, "the vitest half does carry"
    assert r["c4_python_required"] is True, "C0 must NOT short-circuit the python half"
    assert r["c4_still_owed"], "the tool must name the python command it still owes"
    assert any("pytest" in c for c in r["c4_still_owed"]), r["c4_still_owed"]


def test_a_C0_HIT_on_a_FRONTEND_ONLY_branch_owes_NOTHING():
    """⭐ THE CONTROL. Without it, 'mandatory' could be hard-wired true and every landing
    would carry a python obligation it does not have — which is how a real obligation
    stops being read."""
    run = _runner({"diff --name-only B...G": "app/src/pages/x.js\n"})
    r = decide("G", "L", "B", edges=None, run=run, read_identical=lambda a, b: (True, []))
    assert r["verdict"] == VERDICT_CARRIES
    assert r["c4_python_required"] is False
    assert r["c4_still_owed"] == [], "nothing is owed; saying otherwise is the old wart"


def test_the_python_obligation_survives_the_NON_short_circuit_path_too():
    run = _runner({"diff --name-only G L": "a/x.js\n",
                   "diff --name-only B...G": "tools/gate_box_lock.py\n"})
    r = decide("G", "L", "B", edges={}, run=run)
    assert r["verdict"] == VERDICT_CARRIES and r["c4_python_required"] is True


def test_PY_READ_PATHS_names_the_files_the_python_suite_actually_reads():
    """⛔ NON-VACUITY on the roster itself: a list that named nothing real would make the
    rule unfalsifiable."""
    for rel in ("pytest.ini", "tests/conftest.py", "scripts/", "tools/"):
        assert rel in PY_READ_PATHS, rel
    root = pathlib.Path(__file__).resolve().parent.parent
    for rel in ("pytest.ini", "tests/conftest.py"):
        assert (root / rel).exists(), f"{rel} is in PY_READ_PATHS but not on disk"
