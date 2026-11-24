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

⛔ Every anchor is ONE WHOLE LINE written with its line breaks on both sides, so an exact
substring match is a whole-line match and B5's `anchor_check` reads the same needle this
applies. It goes through `patch_guard`: both sides scanned for escape-collapse signatures,
the replacement sha256 round-tripped after the write, and the original restored by bytes
on every path.

⛔⛔ THE TREE GUARD LOOKS AT THE TREE THE EDITS LAND IN. Until 2026-11-24 `main()` handed
the guard the argv root while the edits went to `tools/pre_push_guard.py` in the tree this
file sits in. Now `ROOT` is the one tree this harness guards, mutates and tests, and
`guard()` runs at module level before any write.

Usage:  python docs/discord-render/instruments/mutation_harness_push_guard.py [repo-root] [--dry-check]
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import patch_guard  # noqa: E402

# ⛔ FLAGS ARE NOT PATHS: only a positional argument names the tree.
_POSITIONAL = [a for a in sys.argv[1:] if not a.startswith("-")]
#: The ONE tree this harness reads, guards, mutates and tests.
ROOT = Path(_POSITIONAL[0]).resolve() if _POSITIONAL else HERE.parents[2]

TARGET = "tools/pre_push_guard.py"
SUITE = "tests/test_pre_push_guard.py"

MUTATIONS = [
    # ── (a) an unsettled deploy is ignored ───────────────────────────────────
    {"name": "M1 (a) a swap in flight stops mattering — any status passes", "file": TARGET,
     "old": '\n    if status != "SUCCESS":\n', "new": "\n    if False:\n",
     "expect_red_case": "test_any_unsettled_status_REFUSES"},
    # ── (b) N read as 0 ──────────────────────────────────────────────────────
    # ⛔ Named against the RECENCY-ONLY case. On the real window the burst clause
    # covers for it, so a replay-based expectation would stay green and report that
    # N is load-bearing when it is not.
    {"name": "M2 (b) the recency window is zero — a deploy seconds ago reads as quiet",
     "file": TARGET,
     "old": "\nRECENT_PUSH_WINDOW_SECONDS = 600\n", "new": "\nRECENT_PUSH_WINDOW_SECONDS = 0\n",
     "expect_red_case": "test_ONLY_recency_can_refuse_here"},
    # ── (c) fail-open ────────────────────────────────────────────────────────
    # ⚠️ The anchor is the RETURN, not `if dep.get("state") == UNREADABLE:` — that
    # line is byte-identical in `decide()` and `decide_cadence()`, so a whole-line
    # anchor on it matches twice and `patch_guard` correctly refuses. The message
    # text is what makes this one unique to the cadence guard.
    {"name": "M3 (c) the cadence guard fails OPEN when the list cannot be read", "file": TARGET,
     "old": '\n        return REFUSE, ("cannot read the %s deployment list (%s). REFUSING: a cadence guard "\n',
     "new": '\n        return OK, ("cannot read the %s deployment list (%s). REFUSING: a cadence guard "\n',
     "expect_red_case": "test_an_unreadable_list_REFUSES"},
    # ── the burst clause ─────────────────────────────────────────────────────
    {"name": "M4 the burst floor is unreachable — concurrent development reads as quiet",
     "file": TARGET,
     "old": "\nBURST_MIN_DEPLOYS = 3\n", "new": "\nBURST_MIN_DEPLOYS = 999\n",
     "expect_red_case": "test_ONLY_the_burst_clause_can_refuse_here"},
    # ── THE WIRE ─────────────────────────────────────────────────────────────
    # ⛔⛔ THE ONE THAT MATTERS MOST. This is the exact state the repo was already in:
    # a correct detector whose verdict reaches no decision. Every other mutation here
    # breaks a computation; this one breaks the only thing that makes it a guard.
    {"name": "M5 the cadence verdict stops reaching the refusal — a detector again", "file": TARGET,
     "old": "\n    if verdict != OK or kverdict != OK:\n", "new": "\n    if verdict != OK:\n",
     "expect_red_case": "test_a_busy_cadence_refuses_through_main"},
]


def _eol(text: str, s: str) -> str:
    """The anchor in the target's own line ending (`core.autocrlf=true` on this box)."""
    return s.replace("\n", "\r\n") if "\r\n" in text else s


def dry_check(out=print) -> int:
    """Read-only, so it runs before the tree guard: the flip gate calls it from any tree."""
    stale = []
    text = (ROOT / TARGET).read_bytes().decode("utf-8")
    for m in MUTATIONS:
        n = text.count(_eol(text, m["old"]))
        if n != 1:
            stale.append(f"{m['name']}: anchor matches {n} time(s), expected 1")
    for s in stale:
        out(f"  NOT APPLIED: {s}")
    out(f"TOTALS mutation_harness_push_guard --dry-check {'PASS' if not stale else 'FAIL'} "
        f"mutations={len(MUTATIONS)} stale={len(stale)}")
    return 0 if not stale else 1


if __name__ == "__main__" and "--dry-check" in sys.argv[1:]:
    raise SystemExit(dry_check())

# ⛔ B4/B5 — ONE shared guard, imported, never copy-pasted (a guard repeated is a guard
# unproved). It refuses to run unless ROOT is a sacrificed mutation sandbox, then refuses to
# start a run on an anchor that no longer matches its source.
from harness_guard import guard  # noqa: E402

guard(ROOT, __file__)


def _suite() -> tuple:
    p = subprocess.run([sys.executable, "-m", "pytest", SUITE, "-q", "--no-header", "-p",
                        "no:cacheprovider"],
                       cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8",
                       errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    totals = [l for l in out.splitlines()
              if (" passed" in l or " failed" in l) and " in " in l]
    return p.returncode, (totals[-1].strip() if totals else "NO TOTALS LINE"), out


def _reds(out: str) -> list:
    return [l.strip() for l in out.splitlines() if l.strip().startswith("FAILED ")]


def run(out=print) -> int:
    declared, evaluated, failed = len(MUTATIONS), 0, 0
    path = ROOT / TARGET
    original = path.read_bytes()
    sha = hashlib.sha256(original).hexdigest()
    out(f"captured {path.name} sha256={sha[:16]} bytes={len(original)}")
    rc, totals, _ = _suite()
    out(f"  CONTROL BEFORE: exit={rc}  {totals}")
    if rc != 0:
        out("  REFUSING to mutate: the control is not green.")
        out(f"TOTALS mutation_harness_push_guard INCONCLUSIVE declared={declared} evaluated=0 failed=1")
        return 2
    text = original.decode("utf-8")
    try:
        for m in MUTATIONS:
            try:
                patch_guard.safe_replace(path, _eol(text, m["old"]), _eol(text, m["new"]))
            except (patch_guard.PatchRefused, patch_guard.RoundTripFailed) as e:
                out(f"  {m['name']}: NOT APPLIED = FAIL — {e}")
                failed += 1; evaluated += 1
                continue
            rc, totals, mout = _suite()
            path.write_bytes(original)
            assert hashlib.sha256(path.read_bytes()).hexdigest() == sha, f"RESTORE FAILED {m['name']}"
            evaluated += 1
            reds = _reds(mout)
            named = sum(1 for l in reds if m["expect_red_case"] in l)
            if rc == 0:
                out(f"  {m['name']}: GREEN — NOT CAUGHT  {totals}")
                failed += 1
            elif not named:
                out(f"  {m['name']}: RED but NOT on the named case ({m['expect_red_case']}); "
                    f"{len(reds)} other failure(s): {reds[:2]}")
                failed += 1
            else:
                out(f"  {m['name']}: RED (good) — {named} named case(s) of {len(reds)}")
    finally:
        path.write_bytes(original)
    rc, totals, _ = _suite()
    out(f"  CONTROL AFTER: exit={rc}  {totals}")
    failed += (rc != 0)
    out(f"  restore verified sha256={hashlib.sha256(path.read_bytes()).hexdigest()[:16]}")
    if evaluated != declared:
        out(f"  ⛔ {declared - evaluated} declared mutation(s) NEVER EVALUATED"); failed += 1
    out(f"TOTALS mutation_harness_push_guard {'PASS' if not failed else 'FAIL'} "
        f"declared={declared} evaluated={evaluated} failed={failed}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(run())
