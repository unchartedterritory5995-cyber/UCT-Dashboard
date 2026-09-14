"""Rails for B4 (the refusal guard) and B5 (stale-anchor detection at gate time).

B4 owner ruling, 2026-09-14: "any harness that can leave a mutation in a working-tree file
must refuse to run unless cwd is a throwaway worktree matching a known pattern. The
integrator's tree is never a mutation target. Enforce in code, not memory."

B5 owner ruling, 2026-09-14: "Add a gate step that lists every mutation control whose
anchor text no longer matches the source, before the harness runs."

⛔ NOTHING HERE MUTATES A REAL TREE. Every case that exercises a write builds a synthetic
directory under tmp_path. Proving a mutation guard by mutating something would be the
instrument manufacturing a finding, which this repo has now done twice.

⛔ EVERY RAIL THAT SHELLS OUT OR ENUMERATES CARRIES A NON-VACUITY CONTROL. An empty result
satisfies almost every assertion anyone writes; an empty result is a failed invocation
until proven otherwise.
"""
from __future__ import annotations

import ast
import hashlib
import importlib.util
import io
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
INSTRUMENTS = REPO / "docs" / "discord-render" / "instruments"
HARNESS_GLOB = "mutation_harness*.py"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, INSTRUMENTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(name, mod)
    spec.loader.exec_module(mod)
    return mod


guard_mod = _load("harness_guard")
anchor_check = _load("anchor_check")


def _harnesses() -> list[Path]:
    return sorted(INSTRUMENTS.glob(HARNESS_GLOB))


def _worktree(root: Path) -> None:
    """A LINKED worktree: .git is a file holding a gitdir pointer."""
    (root / ".git").write_text("gitdir: /elsewhere/.git/worktrees/x\n", encoding="utf-8")


def _marker(root: Path, text: str = "throwaway worktree for mutation runs\n") -> None:
    (root / guard_mod.MARKER_NAME).write_text(text, encoding="utf-8")


# ══════════════════════════════════════════════════════════════════════════════
# B4 — the refusal guard
# ══════════════════════════════════════════════════════════════════════════════

def test_the_guard_has_exactly_one_definition_and_it_is_not_copy_pasted():
    """A guard repeated is a guard unproved — three copies cannot be mutation-proved.

    The sweep is over every Python file that could plausibly hold a second copy, and it
    asserts the sweep actually LOOKED at something before believing its own answer.
    """
    scanned, defs = 0, {"inspect_tree": [], "require_throwaway_worktree": []}
    for d in (INSTRUMENTS, REPO / "tools", REPO / "scripts", REPO / "tests"):
        for path in sorted(d.rglob("*.py")):
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"))
            except (SyntaxError, UnicodeDecodeError, OSError):
                continue
            scanned += 1
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef) and node.name in defs:
                    defs[node.name].append(path.relative_to(REPO).as_posix())

    # NON-VACUITY: a sweep that read nothing would report "exactly one" of nothing.
    assert scanned > 50, f"the sweep only parsed {scanned} files — it did not run"

    for fn, found in defs.items():
        assert found == ["docs/discord-render/instruments/harness_guard.py"], (
            f"{fn} must be defined exactly once, in the shared guard. Found: {found}")


def test_every_mutation_harness_imports_the_shared_guard_and_calls_it_before_any_write():
    """The guard is useless if a harness forgets it, or calls it after the first write."""
    harnesses = _harnesses()
    # NON-VACUITY: if the glob matched nothing this test would pass by iterating zero times.
    assert len(harnesses) >= 5, f"only {len(harnesses)} harnesses found — the glob is wrong"

    for h in harnesses:
        src = h.read_text(encoding="utf-8")
        tree = ast.parse(src)

        imported = any(
            isinstance(n, ast.ImportFrom) and n.module == "harness_guard"
            and any(a.name == "guard" for a in n.names)
            for n in ast.walk(tree))
        assert imported, f"{h.name} does not import the shared guard"

        call_lines = [n.lineno for n in tree.body
                      if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
                      and isinstance(n.value.func, ast.Name) and n.value.func.id == "guard"]
        assert call_lines, f"{h.name} imports the guard but never calls it at module level"

        write_lines = [n.lineno for n in ast.walk(tree)
                       if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                       and n.func.attr in ("write_bytes", "write_text")]
        assert write_lines, (
            f"{h.name} has no write call at all — this rail is watching the wrong thing")
        assert min(call_lines) < min(write_lines), (
            f"{h.name} calls guard() at line {min(call_lines)} but can write at line "
            f"{min(write_lines)} — the guard must come first")


# Instruments that WRITE but are not mutate-and-restore harnesses, each with the reason.
# ⛔ An exemption list drifts like any other artifact, so the rail below asserts that every
# name here is a real file that really does write — a typo would exempt nothing and be
# invisible (`lesson_a_gate_list_drifts_like_any_other_artifact`).
NOT_MUTATORS = {
    "anchor_check.py": "writes only tempfiles under --self-check; the gate path never writes",
    "chaos_scenarios.py": "writes the evidence JSON the caller names with --out",
    "clock_sweep.py": "writes a pytest plugin into a tempdir, plus --out evidence",
    "determinism_runner.py": "writes the evidence JSON the caller names with --out",
    "golden_capture.py": "regenerates a golden on purpose; that is its whole job",
    "load_harness.py": "writes the evidence JSON the caller names with --out",
    "run_env_logs.py": "writes its own log file, not a source file",
    "soak_job.py": "writes its state file and the --out evidence",
}


def _writes_to_a_file(tree: ast.AST) -> bool:
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Attribute) and node.func.attr in ("write_bytes",
                                                                       "write_text"):
            return True
        if isinstance(node.func, ast.Name) and node.func.id == "open" and len(node.args) > 1:
            mode = node.args[1]
            if isinstance(mode, ast.Constant) and isinstance(mode.value, str) \
                    and "w" in mode.value:
                return True
    return False


def test_every_instrument_that_can_leave_a_mutation_imports_the_shared_guard():
    """B4 says "any harness that can leave a mutation in a working-tree file" — that is not
    the same set as `mutation_harness*.py`.

    ⚰️ `prove_eol_gate.py` plants real line-ending flips in TRACKED files, and its ROOT was
    the hard-coded literal `C:\\Users\\Patrick\\uct-worktrees\\discord-render` — the
    integrator's tree — so running it from anywhere mutated that tree. It is guarded now.
    """
    writers, unguarded = [], []
    for path in sorted(INSTRUMENTS.glob("*.py")):
        if path.name == "harness_guard.py":
            continue                       # it IS the guard; importing itself proves nothing
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError, OSError):
            continue
        if not _writes_to_a_file(tree):
            continue
        writers.append(path.name)
        if path.name in NOT_MUTATORS:
            continue
        guarded = any(isinstance(n, ast.ImportFrom) and n.module == "harness_guard"
                      for n in ast.walk(tree))
        if not guarded:
            unguarded.append(path.name)

    # NON-VACUITY: if the AST probe found no writers, it is broken, not the tree clean.
    assert len(writers) >= 10, f"only {len(writers)} writing instruments found: {writers}"

    # The exemption list must describe reality, or it is exempting names nobody has.
    for name in sorted(NOT_MUTATORS):
        assert (INSTRUMENTS / name).exists(), f"{name} is exempted but does not exist"
        assert name in writers, (
            f"{name} is exempted from a rail it would not trip — a stale exemption")

    assert not unguarded, (
        "these instruments can write to a working-tree file and do not import the shared "
        f"guard: {unguarded}. Either call guard()/require_throwaway_worktree(), or add the "
        "file to NOT_MUTATORS with the reason it cannot leave a mutation behind.")


@pytest.mark.parametrize("build,allowed,reason_fragment,why", [
    (lambda r: None, False, "not a git worktree at all",
     "a bare directory is not a git worktree"),
    (_worktree, False, "has not been sacrificed",
     "a linked worktree with no marker has not been sacrificed"),
    (lambda r: (_worktree(r), _marker(r, "")), False, "does not contain the token",
     "an empty marker is a reflex"),
    (lambda r: (_worktree(r), _marker(r, "keep this tree\n")), False,
     "does not contain the token", "a marker without the token is not a decision"),
    (lambda r: (_worktree(r), _marker(r)), True, "declares this tree throwaway",
     "a marked linked worktree is a sandbox"),
    (lambda r: ((r / ".git").mkdir(), _marker(r)), False, "MAIN CHECKOUT",
     "the MAIN CHECKOUT is refused even with a marker"),
])
def test_the_guard_decides_each_tree_shape_correctly(tmp_path, build, allowed,
                                                     reason_fragment, why):
    """⛔ The REASON is asserted, not just the verdict, and that is load-bearing.

    ⚰️ Asserting `allowed` alone made the `marker_exists` branch unprovable: deleting it
    let a tree with no marker fall through to the token check, which is also False when
    the file does not exist, so the guard still refused and every assertion stayed green
    (found by P03 of `prove_b45_rails.py`, GREEN UNDER MUTATION). That is
    `lesson_a_guard_repeated_is_a_guard_unproved` — two guards where one suffices, and the
    redundant one cannot be mutation-proved.

    The branches are kept apart rather than merged because they send the operator to
    different actions: "write the marker" vs "the marker you wrote says nothing". The
    reason fragment is what makes that difference real behaviour instead of dead code.
    """
    build(tmp_path)
    verdict = guard_mod.inspect_tree(tmp_path, env={})
    assert verdict.allowed is allowed, f"{why}: got {verdict.allowed} ({verdict.reason})"
    assert reason_fragment in verdict.reason, (
        f"{why}: the reason must say {reason_fragment!r}, got {verdict.reason!r}")


def test_the_refusal_is_loud_exits_with_a_distinct_code_and_names_what_it_saw(tmp_path):
    _worktree(tmp_path)
    buf, codes = io.StringIO(), []
    guard_mod.require_throwaway_worktree(tmp_path, "a_harness.py", stream=buf,
                                         exit_fn=codes.append)
    text = buf.getvalue()

    assert codes == [86], f"expected the distinct refusal code 86, got {codes}"
    assert codes[0] not in (0, 1), "the refusal code must not collide with a test result"
    assert str(tmp_path.resolve()) in text, "the refusal must name the tree it SAW"
    assert guard_mod.MARKER_NAME in text, "the refusal must name what it WANTED"
    assert guard_mod.OVERRIDE_ENV in text, "the refusal must name the deliberate override"
    assert text.count("\n") > 15, "the refusal must be a banner, not a line"


def test_the_override_is_deliberate_and_a_near_miss_is_refused(tmp_path):
    """An override exists so that it is a deliberate act, not so that it is the way past
    a red. `=1` and `=true` are what a reflex types; both are refused."""
    _worktree(tmp_path)
    exact = {guard_mod.OVERRIDE_ENV: guard_mod.OVERRIDE_VALUE}
    assert guard_mod.inspect_tree(tmp_path, env=exact).allowed is True
    assert guard_mod.inspect_tree(tmp_path, env=exact).overridden is True
    for near in ("1", "true", "yes", guard_mod.OVERRIDE_VALUE.upper()):
        v = guard_mod.inspect_tree(tmp_path, env={guard_mod.OVERRIDE_ENV: near})
        assert v.allowed is False, f"override value {near!r} must be refused, not honoured"


def test_the_marker_is_gitignored_so_it_can_never_arrive_by_checkout():
    """The whole argument for a marker over a name pattern: no pull, merge, worktree add
    or checkout can put it in the integrator's tree. That only holds if it is ignored.

    ⚰️ This asserted `MARKER_NAME in <the whole file>` and was GREEN UNDER MUTATION: a
    commented-out `#.mutation-sandbox` still CONTAINS the marker name as a substring, so
    the rail passed over a .gitignore that ignored nothing (found by P08 of
    `prove_b45_rails.py`). It now asserts an actual ignore RULE.
    """
    lines = [ln.strip() for ln
             in (REPO / ".gitignore").read_text(encoding="utf-8").splitlines()]
    rules = [ln for ln in lines if ln and not ln.startswith("#")]

    # NON-VACUITY: a .gitignore parsed down to nothing would satisfy nothing meaningful.
    assert len(rules) > 10, f"only {len(rules)} ignore rules parsed — the reader is broken"
    assert guard_mod.MARKER_NAME in rules, (
        f"{guard_mod.MARKER_NAME} must be a live rule in .gitignore, not a comment, or the "
        "marker can travel in a commit and land in the integrator's tree by checkout")


def test_the_guard_self_check_proves_it_can_fail():
    r = subprocess.run([sys.executable, str(INSTRUMENTS / "harness_guard.py")],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=120)
    out = r.stdout + r.stderr
    assert "GUARD SELF-CHECK TOTALS:" in out, "a run without a totals line is not a run"
    assert "failures=0" in out, out[-1500:]
    assert r.returncode == 0, out[-1500:]


# ══════════════════════════════════════════════════════════════════════════════
# B5 — stale-anchor detection
# ══════════════════════════════════════════════════════════════════════════════

# ⛔ Needles are built by CONCATENATION so nothing in this file is a literal that a scan
# of this file could match. Six instruments in this repo have matched their own prose.
_LIVE = "LIVE" + "_ANCHOR_X"
_GONE = "GONE" + "_ANCHOR_X"
_TWICE = "TWICE" + "_ANCHOR_X"
_PROSE = "PROSE" + "_ANCHOR_X"
_DOC = "DOC" + "_ANCHOR_X"
_MIXED = "MIXED" + "_ANCHOR_X"

_TARGET = "\n".join([
    '"""Module docstring."""',
    "",
    "def f():",
    "    " + _LIVE + " = 1",
    "    return " + _LIVE,
    "",
    "def g():",
    "    a = " + _TWICE,
    "    b = " + _TWICE,
    "    return a, b",
    "",
    "# a comment mentioning " + _PROSE,
    "",
    "def h():",
    '    """A docstring mentioning ' + _DOC + '."""',
    "    z = 3  # trailing note mentioning " + _MIXED,
    "    return z",
    "",
])


@pytest.mark.parametrize("needle,outcome,why", [
    (_LIVE + " = 1", "OK", "a live anchor matching once in code"),
    (_GONE, "STALE", "an anchor that no longer appears at all"),
    (_TWICE, "AMBIGUOUS", "an exact single replacement is impossible"),
    (_PROSE, "STALE", "⛔ the same anchor text inside a COMMENT is NOT a match"),
    (_DOC, "STALE", "⛔ the same anchor text inside a DOCSTRING is NOT a match"),
    ("    z = 3  # trailing note mentioning " + _MIXED, "OK",
     "⭐ an anchor that CONTAINS a comment is still a match — a checker that stripped "
     "comments before matching would call this stale, and a check that fires on the "
     "right answer is muted within a week"),
])
def test_the_three_outcomes_are_distinct_and_never_collapsed(needle, outcome, why):
    got, raw, code, detail = anchor_check.classify(_TARGET, needle)
    assert got == outcome, f"{why}: got {got} (raw={raw} code={code}) {detail}"


def test_stale_reports_a_DIFFERENT_detail_for_absent_and_for_comment_only():
    """Two causes, two sentences. Collapsing them would send the integrator to re-aim an
    anchor that is actually sitting in a comment."""
    _, _, _, absent = anchor_check.classify(_TARGET, _GONE)
    _, _, _, comment = anchor_check.classify(_TARGET, _PROSE)
    assert absent != comment
    assert "not in the file at all" in absent
    assert "comment or a docstring" in comment


def test_the_checker_enumerates_every_real_harness_and_reports_names(capsys):
    """The non-vacuity control ON THE REAL TREE: if the checker reports nothing it is
    because it read nothing, and that is a failed invocation, not a clean gate."""
    rep = anchor_check.check_tree(REPO)
    total = sum(rep.counts().values())

    assert len(rep.harnesses) >= 5, f"only {len(rep.harnesses)} harnesses read"
    assert total >= 100, f"only {total} controls enumerated from {len(rep.harnesses)} harnesses"
    assert not rep.errors, f"the checker could not read something: {rep.errors}"

    # It must report NAMES, not only a count.
    rc = anchor_check.render(rep)
    out = capsys.readouterr().out
    assert "TOTALS:" in out, "a run without a totals line is not a run"
    for f in rep.defects:
        assert f.control.name in out, f"defect {f.control.name!r} was counted but not named"
    assert rc in (anchor_check.EXIT_CLEAN, anchor_check.EXIT_FOUND_DEFECTS)


def test_zero_controls_is_a_failed_invocation_not_a_quiet_pass(tmp_path, capsys):
    empty = tmp_path / "instruments"
    empty.mkdir()
    assert anchor_check.render(anchor_check.check_tree(tmp_path, empty)) \
        == anchor_check.EXIT_VACUOUS, "no harness files at all must FAIL"
    capsys.readouterr()

    (empty / "mutation_harness_nothing.py").write_text("MUTATIONS = []\n", encoding="utf-8")
    assert anchor_check.render(anchor_check.check_tree(tmp_path, empty)) \
        == anchor_check.EXIT_VACUOUS, "a harness declaring zero controls must FAIL"
    assert "VACUOUS" in capsys.readouterr().out


def test_an_unresolvable_anchor_is_UNREADABLE_and_never_OK(tmp_path):
    """⛔ A control that could not be READ is not a control that is FINE. This repo has
    twice scored an unreadable layer as an empty one."""
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "m.py").write_text(_TARGET, encoding="utf-8")
    inst = tmp_path / "instruments"
    inst.mkdir()
    (inst / "mutation_harness_u.py").write_text(
        "T = 'pkg/m.py'\n"
        "MUTATIONS = [\n"
        "    {'name': 'U1 computed needle', 'file': T, 'old': f'{T}!', 'new': 'x', 'tests': []},\n"
        "    {'name': 'U2 missing file', 'file': 'pkg/nope.py', 'old': 'x', 'new': 'y', 'tests': []},\n"
        "]\n", encoding="utf-8")
    by_name = {f.control.name: f.outcome for f in anchor_check.check_tree(tmp_path, inst).findings}
    assert by_name["U1 computed needle"] == "UNREADABLE"
    assert by_name["U2 missing file"] == "UNREADABLE"


def test_a_stale_prelude_is_reported_as_its_own_control():
    """The harnesses require `text.count(pre_old) == 1` too, so a stale prelude is a
    NOT APPLIED the checker would otherwise miss entirely.

    ⚰️ This asserted only that the prelude list was non-empty and was GREEN UNDER MUTATION:
    deleting the tuple-extraction branch fell through to the `elif pre is not None`
    fallback, which still appends a prelude control — an UNREADABLE placeholder carrying no
    anchor. The list stayed non-empty and the rail passed while the checker had stopped
    reading preludes entirely (found by P15 of `prove_b45_rails.py`). Same shape as P03:
    a branch subsumed by its own fallback cannot be proved by a presence check.
    """
    preludes = [f for f in anchor_check.check_tree(REPO).findings
                if f.control.kind == "prelude"]
    assert preludes, "no prelude controls were enumerated — the extractor is not reading them"

    resolved = [f for f in preludes if f.control.needle is not None]
    assert resolved, (
        "prelude controls were enumerated but not one carried a resolvable anchor — the "
        "extractor is producing placeholders, not controls")
    assert any(f.outcome == anchor_check.OK for f in resolved), (
        "no prelude anchor was actually classified against its source file")


def test_the_gate_path_of_the_checker_never_writes_and_never_runs_a_test():
    """B5 is a READ. It must not execute any mutation, and it must not shell out."""
    tree = ast.parse((INSTRUMENTS / "anchor_check.py").read_text(encoding="utf-8"))
    gate_fns = {"check_tree", "classify", "extract_controls", "code_mask", "render",
                "_resolve", "_const_env"}
    # ⚠️ `replace` and `rename` are NOT in this set: `str.replace` is how the EOL
    # normalisation is done, and banning a method name rather than a write would make this
    # rail fire on the right answer. The dotted check below catches `os.replace` instead.
    banned_attrs = {"write_bytes", "write_text", "unlink", "remove", "rmdir", "mkdir",
                    "system", "Popen", "check_output", "check_call", "rmtree"}
    banned_modules = {"os", "shutil", "subprocess"}
    checked = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name in gate_fns:
            checked += 1
            for inner in ast.walk(node):
                if not isinstance(inner, ast.Call):
                    continue
                fn = inner.func
                name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", "")
                assert name not in banned_attrs, (
                    f"{node.name} calls {name}() — the gate path must only read")
                if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name):
                    assert fn.value.id not in banned_modules, (
                        f"{node.name} calls {fn.value.id}.{fn.attr}() — the gate path must "
                        "only read, and must never shell out")
    assert checked == len(gate_fns), (
        f"only found {checked} of {len(gate_fns)} gate functions — the rail is stale")
    assert "import subprocess" not in (INSTRUMENTS / "anchor_check.py").read_text(
        encoding="utf-8"), "the checker must never be able to run pytest"


def test_the_checker_self_check_proves_it_can_fail():
    r = subprocess.run([sys.executable, str(INSTRUMENTS / "anchor_check.py"), "--self-check"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=180)
    out = r.stdout + r.stderr
    assert "SELF-CHECK TOTALS:" in out, "a run without a totals line is not a run"
    assert "failures=0" in out, out[-2000:]
    assert r.returncode == 0, out[-2000:]


# ══════════════════════════════════════════════════════════════════════════════
# The two together, end to end — on a synthetic tree, never a real one
# ══════════════════════════════════════════════════════════════════════════════

def _synthetic_sandbox(tmp_path: Path, anchor: str) -> tuple[Path, Path]:
    root = tmp_path / "sandbox"
    (root / "pkg").mkdir(parents=True)
    target = root / "pkg" / "m.py"
    target.write_text(_TARGET, encoding="utf-8")
    _worktree(root)
    _marker(root)
    inst = root / "instruments"
    inst.mkdir()
    harness = inst / "mutation_harness_fake.py"
    harness.write_text("\n".join([
        "import sys",
        "from pathlib import Path",
        "ROOT = Path(sys.argv[1]).resolve()",
        f"sys.path.insert(0, {str(INSTRUMENTS)!r})",
        "from harness_guard import guard",
        "guard(ROOT, __file__)",
        "MUTATIONS = [",
        "    {'name': 'F1', 'file': 'pkg/m.py', 'old': " + repr(anchor)
        + ", 'new': 'BOOM', 'tests': []},",
        "]",
        "for m in MUTATIONS:",
        "    p = ROOT / m['file']",
        "    p.write_bytes(p.read_bytes().replace(m['old'].encode(), m['new'].encode()))",
        "print('HARNESS RAN AND MUTATED')",
    ]), encoding="utf-8")
    return harness, target


def _run(harness: Path, root: Path, env_extra: dict | None = None):
    env = dict(os.environ)
    env.pop(guard_mod.OVERRIDE_ENV, None)
    env.pop(guard_mod.STALE_OVERRIDE_ENV, None)
    env.update(env_extra or {})
    # The fake harness resolves its own guard by absolute path, and the real harnesses find
    # it beside themselves; PYTHONPATH is not what is under test here.
    return subprocess.run([sys.executable, str(harness), str(root)], capture_output=True,
                          text=True, encoding="utf-8", errors="replace", timeout=180, env=env)


def test_an_unmarked_tree_is_refused_before_the_harness_can_write_a_single_byte(tmp_path):
    harness, target = _synthetic_sandbox(tmp_path, _LIVE + " = 1")
    (harness.parent.parent / guard_mod.MARKER_NAME).unlink()      # un-sacrifice the tree
    before = hashlib.sha256(target.read_bytes()).hexdigest()

    r = _run(harness, harness.parent.parent)

    assert r.returncode == guard_mod.EXIT_REFUSED_TREE, (r.stdout + r.stderr)[-1500:]
    assert "HARNESS RAN AND MUTATED" not in r.stdout
    assert hashlib.sha256(target.read_bytes()).hexdigest() == before, (
        "⛔ the harness wrote to the target despite the refusal")


def test_a_marked_sandbox_passes_B4_and_is_then_stopped_by_B5_before_any_write(tmp_path):
    """The whole point of B5: NOT-APPLIED detection at gate time, not after 18 minutes."""
    harness, target = _synthetic_sandbox(tmp_path, _GONE)          # a stale anchor
    before = hashlib.sha256(target.read_bytes()).hexdigest()

    r = _run(harness, harness.parent.parent)
    out = r.stdout + r.stderr

    assert r.returncode == guard_mod.EXIT_REFUSED_STALE_ANCHORS, out[-1500:]
    assert "F1" in out, "the stale control must be named, never merely counted"
    assert "TOTALS:" in out
    assert "HARNESS RAN AND MUTATED" not in r.stdout
    assert hashlib.sha256(target.read_bytes()).hexdigest() == before


def test_a_marked_sandbox_with_current_anchors_is_allowed_through(tmp_path):
    """⭐ The control on the guard: it must be able to say YES, or its refusals mean
    nothing and every red above would pass for the wrong reason."""
    harness, target = _synthetic_sandbox(tmp_path, _LIVE + " = 1")
    r = _run(harness, harness.parent.parent)
    out = r.stdout + r.stderr
    assert r.returncode == 0, out[-1500:]
    assert "HARNESS RAN AND MUTATED" in r.stdout, out[-1500:]
    assert "B5 preflight:" in out
    assert "BOOM" in target.read_text(encoding="utf-8")            # the synthetic tree only


def test_the_stale_override_is_deliberate_and_says_so_in_the_run(tmp_path):
    harness, _ = _synthetic_sandbox(tmp_path, _GONE)
    r = _run(harness, harness.parent.parent,
             {guard_mod.STALE_OVERRIDE_ENV: guard_mod.STALE_OVERRIDE_VALUE})
    out = r.stdout + r.stderr
    assert r.returncode == 0, out[-1500:]
    assert "PROCEEDING ANYWAY" in out, "an override must announce itself in the output"
    assert guard_mod.STALE_OVERRIDE_ENV in out

    bad = _run(harness, harness.parent.parent, {guard_mod.STALE_OVERRIDE_ENV: "1"})
    assert bad.returncode == guard_mod.EXIT_REFUSED_STALE_ANCHORS, (
        "a near-miss override value must be refused, not honoured")
