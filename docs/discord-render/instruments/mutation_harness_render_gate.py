"""C-09 — can the member-priority gate fail? Four mutations, each with a named red.

⛔ A gate that wins 60 of 60 races proves the code does something; it does not prove the code does
the RIGHT thing for the right reason. Each mutation removes one guarantee and names the case that
must go red — a mutation that reddens the suite somewhere else says nothing about the guard it
deleted.

⛔ Every anchor is ONE WHOLE LINE written with its line breaks on both sides, so an exact substring
match is a whole-line match and B5's `anchor_check` reads the same needle this applies. It goes
through `patch_guard`: both sides scanned for escape-collapse signatures, the replacement sha256
round-tripped after the write, and the original restored by bytes on every path.

⛔⛔ THE TREE GUARD LOOKS AT THE TREE THE EDITS LAND IN. Until 2026-11-24 `main()` handed the guard
the argv root while the edits went to `api/services/render_gate.py` in the tree this file sits in.
Now `ROOT` is the one tree this harness guards, mutates and races (its own copy of
`c09_gate_races.py`, which imports the gate from the tree it sits in), and `guard()` runs at module
level before any write.

Usage:  python docs/discord-render/instruments/mutation_harness_render_gate.py [repo-root] [--dry-check]
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
#: The ONE tree this harness reads, guards, mutates and races.
ROOT = Path(_POSITIONAL[0]).resolve() if _POSITIONAL else HERE.parents[2]

TARGET = "api/services/render_gate.py"
RACES = "docs/discord-render/instruments/c09_gate_races.py"

MUTATIONS = [
    # ⛔ The comparator IS the priority. Invert the class ordering and the gate becomes a
    # background-priority gate — which is the bug it was built to remove, wearing the fix's name.
    {"name": "M1 the priority comparator is inverted — background outranks members", "file": TARGET,
     "old": "\nMEMBER, BACKGROUND = 0, 1\n", "new": "\nMEMBER, BACKGROUND = 1, 0\n",
     "expect_red_case": "the member wins EVERY one of"},
    # ⛔ Without the fairness bound a pure priority queue starves background under sustained member
    # load — and this system HAS sustained member load in RTH.
    {"name": "M2 the fairness bound is removed — background can starve forever", "file": TARGET,
     "old": "\nBACKGROUND_STARVE_S = 25.0\n", "new": "\nBACKGROUND_STARVE_S = 1e9\n",
     # ⚰️ THIS NEEDLE WAS STALE AND THE HARNESS SAID SO: RED, but on a case I had not
     # named. The probe overrides `starve_s` to stay fast, so a mutation of the SHIPPED
     # constant is invisible to it -- which is exactly why the constant is asserted
     # directly, and that is the case this must break.
     "expect_red_case": "the SHIPPED fairness bound is finite"},
    # ⛔ The starvation check must be applied when deciding WHOSE TURN it is, not at grant time: at
    # grant time the heap has already handed a later-arriving member the turn.
    {"name": "M3 the starvation bound stops deciding whose turn it is", "file": TARGET,
     "old": "\n        if self._bg_starving(now):\n", "new": "\n        if False:\n",
     "expect_red_case": "background is served while members are STILL queued"},
    # ⛔ NON-VACUITY FOR THE WHOLE SUITE. If the gate stops queueing at all, every waiter races the
    # way a plain semaphore does — and the CONTROL case (which asserts the OLD behaviour still
    # loses) is what catches it, not the member-wins case.
    {"name": "M4 the waiter queue is ignored, so the gate degrades to a free-for-all", "file": TARGET,
     "old": "\n            if self._free and not self._waiting:\n", "new": "\n            if self._free:\n",
     "expect_red_case": "a newcomer cannot barge a slot"},
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
    out(f"TOTALS mutation_harness_render_gate --dry-check {'PASS' if not stale else 'FAIL'} "
        f"mutations={len(MUTATIONS)} stale={len(stale)}")
    return 0 if not stale else 1


if __name__ == "__main__" and "--dry-check" in sys.argv[1:]:
    raise SystemExit(dry_check())

# ⛔ B4/B5 — ONE shared guard, imported, never copy-pasted (a guard repeated is a guard
# unproved). It refuses to run unless ROOT is a sacrificed mutation sandbox, then refuses to
# start a run on an anchor that no longer matches its source.
from harness_guard import guard  # noqa: E402

guard(ROOT, __file__)


def _races() -> tuple:
    p = subprocess.run([sys.executable, str(ROOT / RACES)], cwd=str(ROOT), capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    totals = [l for l in out.splitlines() if l.startswith("TOTALS c09_gate_races")]
    return p.returncode, (totals[-1] if totals else "NO TOTALS LINE"), out


def _reds(out: str) -> list:
    return [l.strip() for l in out.splitlines() if l.strip().startswith("FAIL ")]


def run(out=print) -> int:
    declared, evaluated, failed = len(MUTATIONS), 0, 0
    path = ROOT / TARGET
    original = path.read_bytes()
    sha = hashlib.sha256(original).hexdigest()
    out(f"captured {path.name} sha256={sha[:16]} bytes={len(original)}")
    rc, totals, _ = _races()
    out(f"  CONTROL BEFORE: exit={rc}  {totals}")
    if rc != 0:
        out("  REFUSING to mutate: the control is not green.")
        out(f"TOTALS mutation_harness_render_gate INCONCLUSIVE declared={declared} evaluated=0 failed=1")
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
            rc, totals, mout = _races()
            path.write_bytes(original)
            assert hashlib.sha256(path.read_bytes()).hexdigest() == sha, f"RESTORE FAILED {m['name']}"
            evaluated += 1
            reds = _reds(mout)
            named = sum(1 for l in reds if m["expect_red_case"] in l)
            if rc == 0:
                out(f"  {m['name']}: GREEN — NOT CAUGHT  {totals}")
                failed += 1
            elif not named:
                out(f"  {m['name']}: RED but NOT on the named case ({m['expect_red_case']!r}); "
                    f"{len(reds)} other failure(s)")
                failed += 1
            else:
                out(f"  {m['name']}: RED (good) — {named} named case(s) of {len(reds)}")
    finally:
        path.write_bytes(original)
    rc, totals, _ = _races()
    out(f"  CONTROL AFTER: exit={rc}  {totals}")
    failed += (rc != 0)
    out(f"  restore verified sha256={hashlib.sha256(path.read_bytes()).hexdigest()[:16]}")
    if evaluated != declared:
        out(f"  ⛔ {declared - evaluated} declared mutation(s) NEVER EVALUATED"); failed += 1
    out(f"TOTALS mutation_harness_render_gate {'PASS' if not failed else 'FAIL'} "
        f"declared={declared} evaluated={evaluated} failed={failed}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(run())
