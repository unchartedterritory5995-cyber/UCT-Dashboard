"""B4 — the refusal guard. ONE definition, imported by every mutation harness.

Owner ruling, 2026-09-14:

    "Harness hygiene, structural: any harness that can leave a mutation in a working-tree
     file must refuse to run unless cwd is a throwaway worktree matching a known pattern.
     The integrator's tree is never a mutation target. Enforce in code, not memory."

THE INCIDENT IT PREVENTS
    A harness was killed mid-run and LEFT A MUTATION IN `badge.py` in the integrator's
    working tree. It was recovered by writing back the committed blob and verifying the
    sha — the only sanctioned restore (`feedback_mutation_check_never_git_checkout`). The
    recovery worked. The point of this module is that the mutation should never have been
    written into that tree at all.

⭐ WHY A MARKER FILE AND NOT A NAME PATTERN
    A name pattern (`.worktrees/`, `uct-worktrees/<x>-mutation`) is a claim ABOUT a tree.
    A tree can be renamed, moved with `git worktree move`, or created by somebody who
    matched the pattern by accident — and the pattern would then permit mutations in a
    tree nobody meant to sacrifice. Worse, the failure is silent and in the wrong
    direction: the harness runs.

    A marker file is a fact IN the tree, and it has the one property a name cannot have:
    ⛔ IT CANNOT ARRIVE BY CHECKOUT. The marker is gitignored and untracked, so no pull,
    no merge, no `git worktree add`, no rebase and no `git checkout` can ever put it in
    the integrator's tree. Somebody has to stand in that directory and write it. That is
    exactly the deliberate act the ruling asks for.

    It is not enough for the file to EXIST: `touch` is a reflex. It must contain the token
    `throwaway`, so marking a tree costs a sentence saying you accept it will be mutated.

⛔ AND ONE DENIAL THE MARKER CANNOT LIFT
    If `<root>/.git` is a DIRECTORY, root is the main checkout — the repository itself,
    not a worktree — and it is refused even with a valid marker. That test is structural:
    a linked worktree has `.git` as a FILE containing a `gitdir:` pointer. You cannot
    rename your way past it.

THE OVERRIDE
    `UCT_MUTATION_HARNESS_ALLOW_UNSAFE_TREE=i-accept-mutations-in-this-tree`

    It exists so a human CAN run a harness somewhere unusual. It is a required exact
    value, not `1`, so it cannot be set by muscle memory, and it prints a loud banner
    naming the tree so any evidence artifact carries the fact that it was used.
    ⛔ An override exists so that it is a deliberate act, not so that it is the way past
    a red.

EXIT CODES (distinct, so a refusal is never mistaken for a test result)
    86  refused: this tree is not a sanctioned mutation sandbox
    87  refused: a mutation control's anchor no longer matches its source (B5 preflight)
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

MARKER_NAME = ".mutation-sandbox"
MARKER_TOKEN = "throwaway"

OVERRIDE_ENV = "UCT_MUTATION_HARNESS_ALLOW_UNSAFE_TREE"
OVERRIDE_VALUE = "i-accept-mutations-in-this-tree"

STALE_OVERRIDE_ENV = "UCT_MUTATION_HARNESS_STALE_ANCHORS_OK"
STALE_OVERRIDE_VALUE = "i-know-some-anchors-are-stale"

EXIT_REFUSED_TREE = 86
EXIT_REFUSED_STALE_ANCHORS = 87


@dataclass
class TreeVerdict:
    """What the guard wanted, and what it saw. Pure — it reads and decides nothing else."""
    root: str
    allowed: bool
    reason: str
    marker_path: str
    marker_exists: bool
    marker_has_token: bool
    git_kind: str                 # "file" (linked worktree) | "dir" (main checkout) | "absent"
    overridden: bool = False


def inspect_tree(root: os.PathLike | str, env: dict | None = None) -> TreeVerdict:
    """Decide whether `root` may be mutated. Pure: no output, no exit, no writes."""
    env = os.environ if env is None else env
    root = Path(root).resolve()
    marker = root / MARKER_NAME

    marker_exists = marker.is_file()
    marker_has_token = False
    if marker_exists:
        try:
            marker_has_token = MARKER_TOKEN in marker.read_text(
                encoding="utf-8", errors="replace").lower()
        except OSError:
            marker_has_token = False

    dotgit = root / ".git"
    git_kind = "dir" if dotgit.is_dir() else "file" if dotgit.is_file() else "absent"

    def v(allowed: bool, reason: str, overridden: bool = False) -> TreeVerdict:
        return TreeVerdict(str(root), allowed, reason, str(marker), marker_exists,
                           marker_has_token, git_kind, overridden)

    # The override is read FIRST so a human can reach an unusual tree deliberately, and
    # it is recorded on the verdict so no report can hide that it was used.
    if env.get(OVERRIDE_ENV, "").strip() == OVERRIDE_VALUE:
        return v(True, f"{OVERRIDE_ENV} was set to its exact deliberate value", True)
    if env.get(OVERRIDE_ENV, "").strip():
        return v(False, f"{OVERRIDE_ENV} is set but not to the exact required value "
                        f"{OVERRIDE_VALUE!r} — a near-miss is refused, never honoured")

    if git_kind == "dir":
        return v(False, "this is the MAIN CHECKOUT (.git is a directory), which is never "
                        "a mutation target — a marker file cannot lift this denial")
    if git_kind == "absent":
        return v(False, "this is not a git worktree at all (no .git), so a mutation left "
                        "behind could not even be diagnosed against a committed blob")
    if not marker_exists:
        return v(False, f"no {MARKER_NAME} marker — this tree has not been sacrificed")
    if not marker_has_token:
        return v(False, f"{MARKER_NAME} exists but does not contain the token "
                        f"{MARKER_TOKEN!r}; an empty marker is a reflex, not a decision")
    return v(True, f"{MARKER_NAME} declares this tree throwaway, and it is a linked worktree")


def _banner(verdict: TreeVerdict, harness: str) -> str:
    bar = "=" * 78
    return "\n".join([
        "", bar,
        "⛔⛔ MUTATION HARNESS REFUSED TO RUN — THIS TREE IS NOT A SANDBOX",
        bar,
        f"  harness       : {harness}",
        f"  mutation root : {verdict.root}",
        f"  cwd           : {os.getcwd()}",
        "",
        "  WHAT IT WANTED:",
        f"    - a LINKED git worktree (.git is a file)          -> saw: .git is {verdict.git_kind}",
        f"    - a marker file at {MARKER_NAME:<30}  -> saw: "
        f"{'present' if verdict.marker_exists else 'ABSENT'}",
        f"    - that marker containing the token {MARKER_TOKEN!r:<12}  -> saw: "
        f"{'present' if verdict.marker_has_token else 'ABSENT'}",
        "",
        f"  WHY: {verdict.reason}",
        "",
        "  This harness edits a real source file in place. Killed mid-run it LEAVES THE",
        "  MUTATION BEHIND — which is exactly what happened to badge.py in the",
        "  integrator's tree. The integrator's tree is never a mutation target.",
        "",
        "  TO PROCEED, pick one and mean it:",
        "",
        f"    1. Sacrifice a throwaway worktree (preferred). In THAT tree's root:",
        f"         echo 'throwaway worktree — mutation harnesses may edit files here' > {MARKER_NAME}",
        f"       The marker is gitignored, so it can never travel in a commit and can",
        f"       never arrive in another tree by checkout.",
        "",
        f"    2. Override deliberately, for one command, somewhere unusual:",
        f"         {OVERRIDE_ENV}={OVERRIDE_VALUE} python <harness> <root>",
        "",
        bar, "",
    ])


def _override_banner(verdict: TreeVerdict, harness: str) -> str:
    bar = "!" * 78
    return "\n".join([
        "", bar,
        "⚠️  MUTATION GUARD OVERRIDDEN — files in this tree WILL be edited in place",
        f"    harness : {harness}",
        f"    tree    : {verdict.root}",
        f"    via     : {OVERRIDE_ENV}={OVERRIDE_VALUE}",
        "    If this run is killed, the mutation stays. Restore by writing back the",
        "    captured bytes and verifying sha256 — NEVER `git checkout`.",
        bar, "",
    ])


def require_throwaway_worktree(root: os.PathLike | str, harness: str | None = None,
                               stream=None, exit_fn=None) -> TreeVerdict:
    """Refuse loudly and exit 86 unless `root` is a sanctioned mutation sandbox.

    Call this BEFORE any code path that can write to a working-tree file. It is the first
    statement after ROOT is resolved in every `mutation_harness*.py`.
    """
    stream = sys.stderr if stream is None else stream
    exit_fn = sys.exit if exit_fn is None else exit_fn
    harness = harness or Path(sys.argv[0]).name

    verdict = inspect_tree(root)
    if not verdict.allowed:
        _write(stream, _banner(verdict, harness))
        exit_fn(EXIT_REFUSED_TREE)
        return verdict
    if verdict.overridden:
        _write(stream, _override_banner(verdict, harness))
    return verdict


def preflight_anchors(root: os.PathLike | str, harness_file: str | None = None,
                      stream=None, exit_fn=None) -> int:
    """B5 at the top of a harness: refuse to start an 18-minute run on a stale anchor.

    Checks only THIS harness's own controls when `harness_file` is given. The repo-wide
    gate step is `anchor_check.py` run on its own; this is the per-run backstop so a
    harness can never spend the run only to report NOT APPLIED at the end.

    ⛔ `UCT_MUTATION_HARNESS_STALE_ANCHORS_OK=i-know-some-anchors-are-stale` proceeds
    anyway — for the case where 1 of 75 controls is stale and the other 74 are worth
    running. It is a deliberate act and the run says so in its output.
    """
    stream = sys.stdout if stream is None else stream
    exit_fn = sys.exit if exit_fn is None else exit_fn

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        import anchor_check
    except ImportError as exc:                                    # pragma: no cover
        _write(stream, f"⚠️ B5 preflight unavailable ({exc}); the harness will still "
                       f"report NOT APPLIED per control.")
        return 0

    only = Path(harness_file).resolve() if harness_file else None
    rep = anchor_check.check_tree(Path(root).resolve(), only=only)
    defects = rep.defects
    counts = rep.counts()
    total = sum(counts.values())

    # ⛔ NON-VACUITY: a preflight that enumerated nothing has not checked anything.
    if total == 0:
        _write(stream, "\n⛔ B5 PREFLIGHT VACUOUS: zero mutation controls were enumerated "
                       f"from {only or 'the instruments directory'}. That is a failed "
                       "check, not a clean one — refusing.")
        exit_fn(EXIT_REFUSED_STALE_ANCHORS)
        return EXIT_REFUSED_STALE_ANCHORS

    if not defects:
        _write(stream, f"B5 preflight: {total} anchors, all matching in code. "
                       f"(ok={counts[anchor_check.OK]})")
        return 0

    lines = ["", "=" * 78,
             "⛔⛔ B5 PREFLIGHT — MUTATION CONTROLS WHOSE ANCHOR NO LONGER MATCHES:",
             "=" * 78]
    lines += [f.line() for f in defects]
    lines += ["",
              f"TOTALS: controls={total} ok={counts[anchor_check.OK]} "
              f"stale={counts[anchor_check.STALE]} "
              f"ambiguous={counts[anchor_check.AMBIGUOUS]} "
              f"unreadable={counts[anchor_check.UNREADABLE]}"]

    if os.environ.get(STALE_OVERRIDE_ENV, "").strip() == STALE_OVERRIDE_VALUE:
        lines += ["", f"⚠️ PROCEEDING ANYWAY: {STALE_OVERRIDE_ENV} is set. The controls "
                      "named above will report NOT APPLIED and prove nothing.", "=" * 78, ""]
        _write(stream, "\n".join(lines))
        return 0

    lines += ["",
              "  Re-aim these anchors against the current source before running. Each one",
              "  is an 18-minute run that ends in NOT APPLIED.",
              "",
              f"  To run anyway, deliberately: {STALE_OVERRIDE_ENV}={STALE_OVERRIDE_VALUE}",
              "=" * 78, ""]
    _write(stream, "\n".join(lines))
    exit_fn(EXIT_REFUSED_STALE_ANCHORS)
    return EXIT_REFUSED_STALE_ANCHORS


def guard(root: os.PathLike | str, harness_file: str | None = None) -> TreeVerdict:
    """The one call a harness makes: refuse an unsanctioned tree, then refuse a stale run."""
    verdict = require_throwaway_worktree(root, Path(harness_file).name if harness_file else None)
    preflight_anchors(root, harness_file)
    return verdict


def _write(stream, text: str) -> None:
    """⚠️ Windows consoles are cp1252 and these banners are not ASCII. A guard that dies
    printing its own refusal is a guard that does not refuse."""
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError, OSError):
        pass
    try:
        print(text, file=stream, flush=True)
    except UnicodeEncodeError:
        print(text.encode("ascii", "replace").decode("ascii"), file=stream, flush=True)


def _self_check(stream=None) -> int:
    """Prove the guard can REFUSE and can ALLOW, in throwaway directories only.

    ⛔ Nothing here touches a real tree and nothing here mutates a file — proving a
    mutation guard by mutating something would be the instrument manufacturing a finding.
    """
    import tempfile

    stream = sys.stdout if stream is None else stream   # ⛔ never a default-arg binding
    failures: list[str] = []

    def case(label: str, want_allowed: bool, build, env: dict) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            build(root)
            v = inspect_tree(root, env)
            ok = v.allowed == want_allowed
            _write(stream, f"  {'PASS' if ok else 'FAIL'}  {label:<58} "
                           f"want_allowed={want_allowed!s:<5} got={v.allowed!s:<5} "
                           f"({v.reason[:52]})")
            if not ok:
                failures.append(label)

    def worktree(root: Path) -> None:
        (root / ".git").write_text("gitdir: /somewhere/.git/worktrees/x\n", encoding="utf-8")

    def marked(root: Path) -> None:
        worktree(root)
        (root / MARKER_NAME).write_text("throwaway worktree for mutation runs\n",
                                        encoding="utf-8")

    _write(stream, "-" * 78)
    _write(stream, "B4 GUARD SELF-CHECK — it must be able to refuse, and able to allow")
    _write(stream, "-" * 78)
    case("a bare directory (no .git)", False, lambda r: None, {})
    case("a linked worktree with NO marker", False, worktree, {})
    case("a linked worktree, marker present but EMPTY", False,
         lambda r: (worktree(r), (r / MARKER_NAME).write_text("", encoding="utf-8")), {})
    case("a linked worktree with a proper marker", True, marked, {})
    case("⛔ the MAIN CHECKOUT, marker and all", False,
         lambda r: ((r / ".git").mkdir(),
                    (r / MARKER_NAME).write_text("throwaway\n", encoding="utf-8")), {})
    case("override with the exact value", True, lambda r: None,
         {OVERRIDE_ENV: OVERRIDE_VALUE})
    case("⛔ override set to '1' is a near-miss and is REFUSED", False, worktree,
         {OVERRIDE_ENV: "1"})
    case("⛔ override set to 'true' is a near-miss and is REFUSED", False, marked,
         {OVERRIDE_ENV: "true"})

    # The refusal must be LOUD and exit non-zero with a distinct code.
    import io
    with tempfile.TemporaryDirectory() as td:
        buf, codes = io.StringIO(), []
        require_throwaway_worktree(td, "selfcheck", stream=buf, exit_fn=codes.append)
        text = buf.getvalue()
        checks = [("exits with the distinct code 86", codes == [EXIT_REFUSED_TREE]),
                  ("names the tree it saw", str(Path(td).resolve()) in text),
                  ("names the marker it wanted", MARKER_NAME in text),
                  ("names the override", OVERRIDE_ENV in text),
                  ("is loud (a banner, not a line)", text.count("\n") > 15)]
        for label, ok in checks:
            _write(stream, f"  {'PASS' if ok else 'FAIL'}  refusal {label}")
            if not ok:
                failures.append(f"refusal {label}")

    _write(stream, "")
    _write(stream, f"GUARD SELF-CHECK TOTALS: cases=13 failures={len(failures)}")
    for f in failures:
        _write(stream, f"  FAILED: {f}")
    if failures:
        _write(stream, "⛔ THE GUARD IS NOT TRUSTWORTHY.")
        return 1
    _write(stream, "✅ The guard refused every unsanctioned tree and allowed only a marked one.")
    return 0


if __name__ == "__main__":
    sys.exit(_self_check())
