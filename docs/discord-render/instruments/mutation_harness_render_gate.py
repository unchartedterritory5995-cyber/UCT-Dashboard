"""C-09 — can the member-priority gate fail? Four mutations, each with a named red.

⛔ A gate that wins 60 of 60 races proves the code does something; it does not prove the code does
the RIGHT thing for the right reason. Each mutation removes one guarantee and names the case that
must go red — a mutation that reddens the suite somewhere else says nothing about the guard it
deleted.

⛔ Anchors are matched as WHOLE LINES through `patch_guard`, both sides scanned for escape-collapse
signatures, the replacement sha256 round-tripped after the write, and the original restored by bytes
on every path.
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
TARGET = ROOT / "api" / "services" / "render_gate.py"
RACES = HERE / "c09_gate_races.py"


@dataclass(frozen=True)
class Mutation:
    name: str
    old: str
    new: str
    expect_red_case: str


MUTATIONS = (
    # ⛔ The comparator IS the priority. Invert the class ordering and the gate becomes a
    # background-priority gate — which is the bug it was built to remove, wearing the fix's name.
    Mutation("M1 the priority comparator is inverted — background outranks members",
             "MEMBER, BACKGROUND = 0, 1", "MEMBER, BACKGROUND = 1, 0",
             "the member wins EVERY one of"),
    # ⛔ Without the fairness bound a pure priority queue starves background under sustained member
    # load — and this system HAS sustained member load in RTH.
    Mutation("M2 the fairness bound is removed — background can starve forever",
             "BACKGROUND_STARVE_S = 25.0", "BACKGROUND_STARVE_S = 1e9",
             "background is STILL served"),
    # ⛔ The starvation check must be applied when deciding WHOSE TURN it is, not at grant time: at
    # grant time the heap has already handed a later-arriving member the turn.
    Mutation("M3 the starvation bound stops deciding whose turn it is",
             "        if self._bg_starving(now):", "        if False:",
             "background is STILL served"),
    # ⛔ NON-VACUITY FOR THE WHOLE SUITE. If the gate stops queueing at all, every waiter races the
    # way a plain semaphore does — and the CONTROL case (which asserts the OLD behaviour still
    # loses) is what catches it, not the member-wins case.
    Mutation("M4 the waiter queue is ignored, so the gate degrades to a free-for-all",
             "            if self._free and not self._waiting:", "            if self._free:",
             "the member wins EVERY one of"),
)


def _races() -> tuple:
    p = subprocess.run([sys.executable, str(RACES)], cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    totals = [l for l in out.splitlines() if l.startswith("TOTALS c09_gate_races")]
    return p.returncode, (totals[-1] if totals else "NO TOTALS LINE"), out


def _reds(out: str) -> list:
    return [l.strip() for l in out.splitlines() if l.strip().startswith("FAIL ")]


def dry_check(out=print) -> int:
    stale = []
    lines = [l.rstrip() for l in TARGET.read_text(encoding="utf-8").split("\n")]
    for m in MUTATIONS:
        n = sum(1 for l in lines if l == m.old)
        if n != 1:
            stale.append(f"{m.name}: anchor matches {n} whole line(s), expected 1")
    for s in stale:
        out(f"  NOT APPLIED: {s}")
    out(f"TOTALS mutation_harness_render_gate --dry-check {'PASS' if not stale else 'FAIL'} "
        f"mutations={len(MUTATIONS)} stale={len(stale)}")
    return 0 if not stale else 1


def run(out=print) -> int:
    declared, evaluated, failed = len(MUTATIONS), 0, 0
    original = TARGET.read_bytes()
    sha = hashlib.sha256(original).hexdigest()
    out(f"captured {TARGET.name} sha256={sha[:16]} bytes={len(original)}")
    rc, totals, _ = _races()
    out(f"  CONTROL BEFORE: exit={rc}  {totals}")
    if rc != 0:
        out("  REFUSING to mutate: the control is not green.")
        out(f"TOTALS mutation_harness_render_gate INCONCLUSIVE declared={declared} evaluated=0 failed=1")
        return 2
    try:
        for m in MUTATIONS:
            try:
                patch_guard.safe_replace(TARGET, m.old, m.new, whole_line=True)
            except (patch_guard.PatchRefused, patch_guard.RoundTripFailed) as e:
                out(f"  {m.name}: NOT APPLIED = FAIL — {e}")
                failed += 1; evaluated += 1
                continue
            rc, totals, mout = _races()
            TARGET.write_bytes(original)
            assert hashlib.sha256(TARGET.read_bytes()).hexdigest() == sha, f"RESTORE FAILED {m.name}"
            evaluated += 1
            reds = _reds(mout)
            named = sum(1 for l in reds if m.expect_red_case in l)
            if rc == 0:
                out(f"  {m.name}: GREEN — NOT CAUGHT  {totals}")
                failed += 1
            elif not named:
                out(f"  {m.name}: RED but NOT on the named case ({m.expect_red_case!r}); "
                    f"{len(reds)} other failure(s)")
                failed += 1
            else:
                out(f"  {m.name}: RED (good) — {named} named case(s) of {len(reds)}")
    finally:
        TARGET.write_bytes(original)
    rc, totals, _ = _races()
    out(f"  CONTROL AFTER: exit={rc}  {totals}")
    failed += (rc != 0)
    out(f"  restore verified sha256={hashlib.sha256(TARGET.read_bytes()).hexdigest()[:16]}")
    if evaluated != declared:
        out(f"  ⛔ {declared - evaluated} declared mutation(s) NEVER EVALUATED"); failed += 1
    out(f"TOTALS mutation_harness_render_gate {'PASS' if not failed else 'FAIL'} "
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
