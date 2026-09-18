"""Does a sound gate on tree G carry to landing tree L? — owner ruling, 2026-09-15.

⛔⛔ WHAT THIS REPLACED, AND WHY. The old test was "IDENTICAL over GATE_READ_PATHS",
and that set holds `app/src` as a WHOLE DIRECTORY. So any frontend commit anywhere on
master invalidated carry-over — it was irrelevant that a chart-legend typography change
cannot interact with a Notebook door guard. Measured on the night of 2026-09-15: a gate
costs ~25 minutes and the frontend workstreams were landing in `app/src` about every 10,
so carry-over could NEVER hold while they were active. Two sound gates died to it in one
evening, the second superseded before it had even finished.

⭐ THE FIX IS NOT "NARROW THE DIRECTORY", IT IS "JUDGE INTERACTION". Narrowing the read
set would have been a guess about which paths matter, re-made by hand every time the tree
moved — the second-authority defect this repo keeps paying for. Interaction is derivable.

⛔⛔ THIS IS A DEFERRAL, NOT A SKIP, AND THE DISTINCTION IS THE WHOLE SAFETY ARGUMENT.
C5 — the `master deploy gate` workflow — runs the FULL gate against the ACTUAL LANDED
TREE before `production` moves, and Railway deploys from `production`. So: the local gate
proves the branch, C1-C4 prove the incoming commits cannot interact with it, and the
master gate re-verifies the merged reality before a single member sees it. Remove C5 and
this becomes a skip; keep it and the local gate is simply not re-run for commits that
provably cannot touch the branch.

THE CHECKS (all must pass; C0 short-circuits):
  C0 IDENTICAL over GATE_READ_PATHS            -> CARRIES immediately, no further check
  C1 FILE    incoming ∩ branch-own == ∅
  C2 IMPORT  no import edge either direction, depth 2, resolved by AST
  C3 INFRA   incoming touches no config/setup/router/manifest, and no api/ the branch does
  C4 SCOPED  named node ids green on L         <- reported by this tool, RUN by the caller
  C5 MASTER  the deploy-gate workflow on the landed SHA <- enforced by GitHub, not here

⚠️ C4 AND C5 ARE NOT DECIDED HERE, AND SAYING SO IS THE POINT. This tool answers the
mechanical half. It prints the exact C4 command so the caller cannot invent a narrower
one, and it never prints CARRIES without restating that C4/C5 are still owed — a tool
that appeared to grant the whole ruling would be read as granting it.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

# ⛔⛔ THE OPERATOR CONSOLE ON THIS BOX IS cp1252, AND THIS TOOL DIED PRINTING ITS
# OWN VERDICT. Measured 2026-09-18: it printed "RE-GATE ... failed: C3", then
# raised UnicodeEncodeError on the ⛔ in the very next line — the line that tells
# the caller what C4 still owes. So the verdict was half-delivered and the
# actionable half was lost, with a traceback where the instruction should be.
#
# ⭐ Same class CLAUDE.md already records for `flag_ledger_audit.py`, which
# reported "could not enumerate the project's services" — an encoding bug wearing
# an auth bug's clothes. A tool that cannot finish printing its answer is a tool
# nobody can act on, and the failure looks like the CHECK failing rather than the
# PRINTER failing. `q1_f5_matrix.py` and `q1_window_runner.py` both carry this
# guard; this one did not.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError, TypeError):
    pass

REPO = pathlib.Path(__file__).resolve().parents[1]

#: C3's roster. A change to any of these can alter what the suite DOES without touching a
#: single test the branch owns, so no interaction argument can cover them.
INFRA_SUBSTRINGS = (
    "vite.config", "vitest.config", "vitest.setup", "vitest.workspace",
    "setupTests", "test-setup", "testSetup",
    "package.json", "package-lock.json",
    "app/src/App.jsx", "app/src/main.jsx",
    "surface-matrix", "surfaceMatrix", "surfaces-manifest",
)
ROUTER_SUBSTRINGS = ("app/src/router", "app/src/routes")

#: ⛔⛔ THE PYTHON HALF, WHICH C0 CANNOT SEE — owner ruling 2026-09-17.
#: `GATE_READ_PATHS` (and therefore C0) describes what the SIX-SHARD VITEST GATE reads.
#: It says nothing about what the PYTHON suite reads. That gap shipped a false
#: reassurance on 2026-09-16: a landing carrying only Python answered `C0 IDENTICAL —
#: short-circuit` while master's merge had brought **32 files into `tests/`, including
#: `tests/conftest.py`**. The conftest change happened to be inert; the tool did not know
#: that and could not have. A check that is silent where it looks authoritative is the
#: PROXY failure this programme catalogued the same night.
PY_READ_PATHS = (
    "pytest.ini",
    "conftest.py",
    "tests/conftest.py",
    "tests/test_gate_shards.py",
    "tests/test_pre_push_guard.py",
    "scripts/",
    "tools/",
)

#: A branch diff touching any of these makes C4-PYTHON mandatory on the landing tree.
PY_TRIGGER_PREFIXES = ("scripts/", "tools/", "tests/", "api/")

VERDICT_CARRIES = "CARRIES"
VERDICT_REGATE = "RE-GATE"


def _git(*args, run=None) -> list[str]:
    runner = run or (lambda argv: subprocess.run(
        argv, cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace"))
    # ⛔ `git -C <repo>` and never the caller's cwd: git resolves pathspecs relative to the
    # cwd and --porcelain paths relative to the repo, and the two disagreeing is invisible.
    proc = runner(["git", "-C", str(REPO), *args])
    if getattr(proc, "returncode", 1) != 0:
        raise GitFailed(" ".join(args), (getattr(proc, "stderr", "") or "").strip())
    return [ln for ln in (proc.stdout or "").splitlines() if ln.strip()]


class GitFailed(RuntimeError):
    """⛔ A git call that FAILED must never be read as a git call that found nothing.
    An empty file list is the flattering answer to every check in this file."""

    def __init__(self, cmd: str, err: str):
        super().__init__(f"git {cmd} failed: {err or '(no stderr)'}")


def incoming_files(gated: str, landing: str, *, run=None) -> list[str]:
    """The files master brings in, i.e. `git diff G..L`.

    ⚰️ THE TRAP THIS FUNCTION EXISTS TO PREVENT, committed by hand on 2026-09-15 and
    caught only because the number was suspicious: diffing the gated tree against
    ORIGIN/MASTER (`git diff G M`) is a SYMMETRIC tree difference, so it lists the
    branch's OWN files too — as reversals. That reported an overlap of 35 against a
    branch of exactly 35 files, i.e. "C1 fails" for a branch that was in fact disjoint.
    L is the LANDING tree (the merge), not master's tip.
    """
    return sorted(_git("diff", "--name-only", gated, landing, run=run))


def branch_files(base: str, gated: str, *, run=None) -> list[str]:
    """What the branch itself changed — three-dot semantics, merge-base..HEAD."""
    return sorted(_git("diff", "--name-only", f"{base}...{gated}", run=run))


def check_c1(incoming, branch) -> tuple[bool, list[str]]:
    overlap = sorted(set(incoming) & set(branch))
    return (not overlap), overlap


def check_c3(incoming, branch) -> tuple[bool, list[str]]:
    hits = [f for f in incoming
            if any(s in f for s in INFRA_SUBSTRINGS) or any(s in f for s in ROUTER_SUBSTRINGS)]
    # ⭐ "any api/ the branch touches" — scoped to the branch, not all of api/. A branch
    # that touches no Python cannot be perturbed by a Python change it never imports.
    branch_api = {f for f in branch if f.startswith("api/")}
    if branch_api:
        hits += [f for f in incoming if f in branch_api]
    return (not hits), sorted(set(hits))


def check_c2(incoming, branch, edges: dict[str, set[str]], depth: int = 2):
    """No import edge between the two sets, either direction, within `depth` hops.

    `edges` maps repo-relative path -> set of repo-relative paths it imports.
    ⛔ INJECTED, so the rails can drive a known graph — and so a real graph that came
    back EMPTY cannot quietly pass every case (see `--self-check`'s vacuity control).
    """
    rev: dict[str, set[str]] = {}
    for src, outs in edges.items():
        for dst in outs:
            rev.setdefault(dst, set()).add(src)

    def reach(start, graph):
        seen, cur = {start}, {start}
        for _ in range(depth):
            nxt = set()
            for node in cur:
                for m in graph.get(node, ()):  # noqa: PERF401
                    if m not in seen:
                        seen.add(m)
                        nxt.add(m)
            cur = nxt
        seen.discard(start)
        return seen

    inc, brn = set(incoming), set(branch)
    hits = []
    for a, other, label in ((inc, brn, "incoming"), (brn, inc, "branch")):
        for f in a:
            for t in reach(f, edges):
                if t in other:
                    hits.append(f"{label} {f} -> imports -> {t}")
            for t in reach(f, rev):
                if t in other:
                    hits.append(f"{label} {f} <- imported by <- {t}")
    return (not hits), sorted(set(hits))


def python_landing(branch) -> list[str]:
    """Which branch files make C4-PYTHON mandatory. Empty list ⇒ the vitest half suffices.

    ⛔ Keyed on the BRANCH's own diff, not on master's incoming. The question is *"does this
    landing carry Python at all"*, and if it does, no amount of agreement about the vitest
    read set can speak for it.
    """
    return sorted(f for f in branch if f.startswith(PY_TRIGGER_PREFIXES))


#: ⛔ A FLOOR, NOT A DERIVATION, and labelled as one. A change to `scripts/gate_shards.py`
#: has NO test file in its own diff — its rails live in `tests/`. `c4_command` names test
#: files it can see, so for a Python landing it would have emitted an EMPTY command list
#: while reporting the obligation as mandatory: "you must run something", followed by
#: nothing. These are the rails that cover `scripts/` and `tools/`.
#: ⚠️ It is a MINIMUM. A landing that touches Python elsewhere must add that code's own
#: rails; this list cannot know about them and does not pretend to.
PY_RAIL_FLOOR = (
    "tests/test_gate_shards.py",
    "tests/test_gate_carry_over.py",
    "tests/test_gate_box_lock.py",
    "tests/test_gate_box_sampler.py",
    "tests/test_pre_push_guard.py",
)


def c4_command(incoming, branch, *, python_required: bool = False) -> list[str]:
    """The scoped run the caller still owes. Named files only — never a bare `-k`.

    ⛔ `-k` still COLLECTS the whole tree, and collection is where the memory goes (an
    unscoped collect reached 6.6 GB on this box and OOM-swept a worktree). And a vitest
    `-t` filter that matches nothing EXITS 0, which reads as a pass.
    """
    tests = sorted({f for f in list(incoming) + list(branch)
                    if (".test." in f or ".spec." in f or "/test_" in f
                        or f.split("/")[-1].startswith("test_"))})
    fe = [t[len("app/"):] for t in tests if t.startswith("app/src/")]
    py = [t for t in tests if t.endswith(".py")]
    if python_required:
        py = sorted(set(py) | set(PY_RAIL_FLOOR))
    cmds = []
    if fe:
        cmds.append("cd app && npx vitest run " + " ".join(fe))
    if py:
        cmds.append("python -m pytest " + " ".join(py) + " -q")
    return cmds


def decide(gated, landing, base, *, edges=None, run=None, read_identical=None) -> dict:
    """CARRIES or RE-GATE, with the failing check NAMED and its offending paths."""
    result = {"gated": gated, "landing": landing, "base": base, "checks": {}}

    if read_identical is not None:
        identical, differing = read_identical(gated, landing)
        # ⛔ C0 IS A SHORT-CIRCUIT, NOT A REQUIREMENT, and conflating the two made this
        # tool answer RE-GATE on its very first real run — for a tree whose C1, C2 and C3
        # all passed. A C0 miss is the ORDINARY case (it is what the whole interaction
        # ruling exists to handle); only a C0 HIT is load-bearing. So it is recorded
        # outside `checks`, which is the set the verdict is computed from.
        result["c0"] = {"identical": identical, "paths": differing}
        if identical:
            result["checks"]["C0"] = {"pass": True, "paths": []}
            result["verdict"] = VERDICT_CARRIES
            result["reason"] = "C0: IDENTICAL over GATE_READ_PATHS — short-circuit (VITEST half only)"
            # ⛔⛔ C0 SHORT-CIRCUITS THE VITEST HALF AND NOTHING ELSE. If the branch carries
            # Python, C4-PYTHON is still mandatory on the landing tree — C0 read a set that
            # does not contain a single Python path, so it cannot speak for one.
            branch = branch_files(base, gated, run=run)
            py = python_landing(branch)
            result["c4_python_required"] = bool(py)
            result["c4_python_paths"] = py[:8]
            result["c4_still_owed"] = c4_command([], branch, python_required=True) if py else []
            return result

    incoming = incoming_files(gated, landing, run=run)
    branch = branch_files(base, gated, run=run)
    result["incoming_count"], result["branch_count"] = len(incoming), len(branch)

    ok1, over = check_c1(incoming, branch)
    result["checks"]["C1"] = {"pass": ok1, "paths": over}
    ok3, infra = check_c3(incoming, branch)
    result["checks"]["C3"] = {"pass": ok3, "paths": infra}
    if edges is None:
        result["checks"]["C2"] = {"pass": None, "paths": [],
                                  "why": "no import graph supplied — UNKNOWN, never a pass"}
        ok2 = None
    else:
        ok2, hits = check_c2(incoming, branch, edges)
        result["checks"]["C2"] = {"pass": ok2, "paths": hits}

    failed = [k for k, v in result["checks"].items() if v["pass"] is False]
    unknown = [k for k, v in result["checks"].items() if v["pass"] is None]
    # ⛔ UNKNOWN IS NOT A PASS. A check that could not run must send this to a re-gate,
    # or "we could not tell" becomes "it carries" — the same sign-flip this programme
    # already published twice when an unreadable layer was scored as an empty one.
    if failed or unknown:
        result["verdict"] = VERDICT_REGATE
        result["reason"] = ("failed: " + ",".join(failed) if failed else "") + \
                           (("; " if failed and unknown else "") +
                            ("could not evaluate: " + ",".join(unknown) if unknown else ""))
    else:
        result["verdict"] = VERDICT_CARRIES
        result["reason"] = "C1, C2, C3 all pass — the incoming commits cannot interact"
    py = python_landing(branch)
    result["c4_python_required"] = bool(py)
    result["c4_python_paths"] = py[:8]
    result["c4_still_owed"] = c4_command(incoming, branch, python_required=bool(py))
    return result


def self_check() -> int:
    """⛔ Prove each check can FAIL before anyone trusts a CARRIES."""
    fails = []
    inc, brn = ["a/x.js", "a/y.js"], ["b/p.js"]

    ok, paths = check_c1(inc, brn)
    if not ok:
        fails.append("C1 said fail on a disjoint set")
    ok, paths = check_c1(inc + ["b/p.js"], brn)
    if ok or paths != ["b/p.js"]:
        fails.append("C1 did not fail on a PLANTED overlap")

    ok, _ = check_c2(inc, brn, {})
    if not ok:
        fails.append("C2 said fail on an empty graph")
    ok, hits = check_c2(inc, brn, {"a/x.js": {"b/p.js"}})
    if ok or not hits:
        fails.append("C2 did not fail on a PLANTED direct import edge")
    ok, _ = check_c2(inc, brn, {"a/x.js": {"m/mid.js"}, "m/mid.js": {"b/p.js"}})
    if ok:
        fails.append("C2 did not fail on a PLANTED depth-2 edge")
    # ⭐ depth is a BOUND, not a suggestion: a 3-hop chain must NOT fail the check.
    ok, _ = check_c2(inc, brn, {"a/x.js": {"m/1.js"}, "m/1.js": {"m/2.js"}, "m/2.js": {"b/p.js"}})
    if not ok:
        fails.append("C2 fired beyond depth 2 — the bound is not being applied")
    ok, _ = check_c2(inc, brn, {"b/p.js": {"a/x.js"}})
    if ok:
        fails.append("C2 missed the REVERSE direction")

    ok, _ = check_c3(["app/vite.config.js"], [])
    if ok:
        fails.append("C3 did not fail on a planted config change")
    ok, _ = check_c3(["api/services/foo.py"], ["api/services/foo.py"])
    if ok:
        fails.append("C3 did not fail on an api/ file the branch also touches")
    ok, _ = check_c3(["api/services/unrelated.py"], ["app/src/x.js"])
    if not ok:
        fails.append("C3 fired on an api/ file the branch does NOT touch")

    d = decide("G", "L", "B", edges=None,
               run=lambda argv: type("P", (), {"returncode": 0, "stdout": "", "stderr": ""})(),
               read_identical=None)
    if d["verdict"] != VERDICT_REGATE:
        fails.append("a missing import graph was treated as a pass — UNKNOWN must re-gate")

    for f in fails:
        print("  ⛔", f)
    print("self-check:", "PASS — every check can fail, and the depth bound holds" if not fails else "FAIL")
    return 1 if fails else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("gated", nargs="?")
    ap.add_argument("landing", nargs="?")
    ap.add_argument("base", nargs="?")
    ap.add_argument("--edges-json", help="path to {file: [imported,...]} produced by the AST walker")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    if not (args.gated and args.landing and args.base):
        ap.error("need gated, landing and base")

    edges = None
    if args.edges_json:
        raw = json.loads(pathlib.Path(args.edges_json).read_text(encoding="utf-8"))
        edges = {k: set(v) for k, v in raw.items()}
        if not edges:
            print("⛔ the import graph is EMPTY — refusing to read that as 'no edges'")
            edges = None

    sys.path.insert(0, str(REPO / "scripts"))
    try:
        from gate_shards import gate_read_identical  # noqa: PLC0415
        ri = gate_read_identical
    except Exception:  # noqa: BLE001
        ri = None

    r = decide(args.gated, args.landing, args.base, edges=edges, read_identical=ri)
    print(f"  {r['verdict']} — {r['reason']}")
    for name in ("C0", "C1", "C2", "C3"):
        c = r["checks"].get(name)
        if not c:
            continue
        mark = {True: "ok  ", False: "FAIL", None: "????"}[c["pass"]]
        print(f"    {mark} {name}" + (f"  {c['paths'][:6]}" if c["paths"] else ""))
    owed = r.get("c4_still_owed") or []
    if owed:
        print("  ⛔ C4 is still owed by the caller — run exactly:")
        for c in owed:
            print(f"      {c}")
    else:
        # ⛔ THE WART THIS REPLACES: the tool used to print "C4 is still owed" above an
        # EMPTY list on a C0 hit, which reads as "owed, contents unknown" — the worst of
        # both. Nothing owed is a fact; say it.
        print("  ✅ C4: nothing owed — C0 was identical and the branch carries no Python.")
    if r.get("c4_python_required"):
        print("  ⛔⛔ C4-PYTHON IS MANDATORY ON THE LANDING TREE AND IS NOT SHORT-CIRCUITED BY C0.")
        print("     C0 reads GATE_READ_PATHS, which contains no Python path, so it cannot")
        print("     speak for a landing that carries Python. Branch Python files:")
        for f in r.get("c4_python_paths") or []:
            print(f"       {f}")
    print("  ⛔ C5 is the master deploy-gate workflow on the LANDED sha. Production does")
    print("     not move without it; a red workflow means no deploy and an immediate report.")
    return 0 if r["verdict"] == VERDICT_CARRIES else 1


if __name__ == "__main__":
    raise SystemExit(main())
