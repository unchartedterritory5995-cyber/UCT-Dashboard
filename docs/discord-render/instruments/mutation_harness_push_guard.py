"""D-06 Part 0 — can the push guard's cadence rail fail? Five mutations, five named reds.

⛔ THE REASON THIS HARNESS EXISTS RATHER THAN A REVIEW. `suspected_stacked_pushes` has
detected the stacked-push shape since 2026-09-14 and gated NOTHING — it lives behind
`--audit`, whose own docstring says *"Exit 0 always — this reports, never gates."* The
detector was correct and unwired for a day, through a 502. So the load-bearing mutation
here is not any single clause: it is **M5, which cuts the wire between the verdict and
`main()`** and must go red on the case that drives `main()`.

⛔ AND THE TWO CLAUSES MASK EACH OTHER ON REAL DATA. On the 2026-09-15 window BOTH
recency and burst fire at most points, so zeroing either one leaves the replay green
(`lesson_mutations_can_cancel_each_other`). M2 and M4 therefore name the single-clause
cases — the ones only their own clause can answer.

⛔ Anchors are matched as WHOLE LINES through `patch_guard`, both sides scanned for
escape-collapse signatures, the replacement sha256 round-tripped after the write, and
the original restored by bytes on every path.
"""
from __future__ import annotations

import hashlib
import pathlib
import subprocess
import sys
from dataclasses import dataclass

HERE = pathlib.Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import patch_guard  # noqa: E402

ROOT = HERE.parents[2]
TARGET = ROOT / "tools" / "pre_push_guard.py"
SUITE = "tests/test_pre_push_guard.py"


@dataclass(frozen=True)
class Mutation:
    name: str
    old: str
    new: str
    expect_red_case: str


MUTATIONS = (
    # ── (a) an unsettled deploy is ignored ───────────────────────────────────
    Mutation("M1 (a) a swap in flight stops mattering — any status passes",
             '    if status != "SUCCESS":', "    if False:",
             "test_any_unsettled_status_REFUSES"),
    # ── (b) N read as 0 ──────────────────────────────────────────────────────
    # ⛔ Named against the RECENCY-ONLY case. On the real window the burst clause
    # covers for it, so a replay-based expectation would stay green and report that
    # N is load-bearing when it is not.
    Mutation("M2 (b) the recency window is zero — a deploy seconds ago reads as quiet",
             "RECENT_PUSH_WINDOW_SECONDS = 600", "RECENT_PUSH_WINDOW_SECONDS = 0",
             "test_ONLY_recency_can_refuse_here"),
    # ── (c) fail-open ────────────────────────────────────────────────────────
    # ⚠️ The anchor is the RETURN, not `if dep.get("state") == UNREADABLE:` — that
    # line is byte-identical in `decide()` and `decide_cadence()`, so a whole-line
    # anchor on it matches twice and `patch_guard` correctly refuses. The message
    # text is what makes this one unique to the cadence guard.
    Mutation("M3 (c) the cadence guard fails OPEN when the list cannot be read",
             '        return REFUSE, ("cannot read the %s deployment list (%s). REFUSING: a cadence guard "',
             '        return OK, ("cannot read the %s deployment list (%s). REFUSING: a cadence guard "',
             "test_an_unreadable_list_REFUSES"),
    # ── the burst clause ─────────────────────────────────────────────────────
    Mutation("M4 the burst floor is unreachable — concurrent development reads as quiet",
             "BURST_MIN_DEPLOYS = 3", "BURST_MIN_DEPLOYS = 999",
             "test_ONLY_the_burst_clause_can_refuse_here"),
    # ── THE WIRE ─────────────────────────────────────────────────────────────
    # ⛔⛔ THE ONE THAT MATTERS MOST. This is the exact state the repo was already in:
    # a correct detector whose verdict reaches no decision. Every other mutation here
    # breaks a computation; this one breaks the only thing that makes it a guard.
    Mutation("M5 the cadence verdict stops reaching the refusal — a detector again",
             "    if verdict != OK or kverdict != OK:", "    if verdict != OK:",
             "test_a_busy_cadence_refuses_through_main"),
)


def _suite() -> tuple:
    p = subprocess.run([sys.executable, "-m", "pytest", SUITE, "-q", "--no-header", "-p",
                        "no:cacheprovider"],
                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                       errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    totals = [l for l in out.splitlines()
              if (" passed" in l or " failed" in l) and " in " in l]
    return p.returncode, (totals[-1].strip() if totals else "NO TOTALS LINE"), out


def _reds(out: str) -> list:
    return [l.strip() for l in out.splitlines() if l.strip().startswith("FAILED ")]


def dry_check(out=print) -> int:
    stale = []
    lines = [l.rstrip() for l in TARGET.read_text(encoding="utf-8").split("\n")]
    for m in MUTATIONS:
        n = sum(1 for l in lines if l == m.old)
        if n != 1:
            stale.append(f"{m.name}: anchor matches {n} whole line(s), expected 1")
    for s in stale:
        out(f"  NOT APPLIED: {s}")
    out(f"TOTALS mutation_harness_push_guard --dry-check {'PASS' if not stale else 'FAIL'} "
        f"mutations={len(MUTATIONS)} stale={len(stale)}")
    return 0 if not stale else 1


def run(out=print) -> int:
    declared, evaluated, failed = len(MUTATIONS), 0, 0
    original = TARGET.read_bytes()
    sha = hashlib.sha256(original).hexdigest()
    out(f"captured {TARGET.name} sha256={sha[:16]} bytes={len(original)}")
    rc, totals, _ = _suite()
    out(f"  CONTROL BEFORE: exit={rc}  {totals}")
    if rc != 0:
        out("  REFUSING to mutate: the control is not green.")
        out(f"TOTALS mutation_harness_push_guard INCONCLUSIVE declared={declared} evaluated=0 failed=1")
        return 2
    try:
        for m in MUTATIONS:
            try:
                patch_guard.safe_replace(TARGET, m.old, m.new, whole_line=True)
            except (patch_guard.PatchRefused, patch_guard.RoundTripFailed) as e:
                out(f"  {m.name}: NOT APPLIED = FAIL — {e}")
                failed += 1; evaluated += 1
                continue
            rc, totals, mout = _suite()
            TARGET.write_bytes(original)
            assert hashlib.sha256(TARGET.read_bytes()).hexdigest() == sha, f"RESTORE FAILED {m.name}"
            evaluated += 1
            reds = _reds(mout)
            named = sum(1 for l in reds if m.expect_red_case in l)
            if rc == 0:
                out(f"  {m.name}: GREEN — NOT CAUGHT  {totals}")
                failed += 1
            elif not named:
                out(f"  {m.name}: RED but NOT on the named case ({m.expect_red_case}); "
                    f"{len(reds)} other failure(s): {reds[:2]}")
                failed += 1
            else:
                out(f"  {m.name}: RED (good) — {named} named case(s) of {len(reds)}")
    finally:
        TARGET.write_bytes(original)
    rc, totals, _ = _suite()
    out(f"  CONTROL AFTER: exit={rc}  {totals}")
    failed += (rc != 0)
    out(f"  restore verified sha256={hashlib.sha256(TARGET.read_bytes()).hexdigest()[:16]}")
    if evaluated != declared:
        out(f"  ⛔ {declared - evaluated} declared mutation(s) NEVER EVALUATED"); failed += 1
    out(f"TOTALS mutation_harness_push_guard {'PASS' if not failed else 'FAIL'} "
        f"declared={declared} evaluated={evaluated} failed={failed}")
    return 0 if not failed else 1


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    positional = [a for a in argv if not a.startswith("-")]
    root = pathlib.Path(positional[0]).resolve() if positional else ROOT
    if "--dry-check" in argv:
        return dry_check()
    from harness_guard import require_throwaway_worktree  # noqa: E402
    require_throwaway_worktree(root, pathlib.Path(__file__).name)
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
