"""D-02b Part 2 — can `load_harness`'s load model, gauge, spin ceiling and split fail?

⛔⛔ THIS FILE REPLACES A SCRATCHPAD SCRIPT. The OI-37 mutations (M1-M6) were proved once from a
temporary file in a session directory and then lost. A mutation proof nobody can re-run is a claim,
not a rail — and this is the instrument every S1, S2, S5 and admission number in the programme comes
out of, so it is the last place a claim should stand in for a rail.

⛔ Every mutation is applied through `patch_guard.safe_replace`: both strings are scanned for
escape-collapse signatures before any write, and the replacement is sha256 round-tripped after it.
Restore is a write-back of captured bytes verified by sha256 — never `git checkout`.

⛔ EVERY ANCHOR IS ONE WHOLE LINE, WRITTEN WITH ITS LINE BREAKS ON BOTH SIDES
(`"\\n            if release_early:\\n"`). Substring counting alone cannot see indentation; the breaks
make an exact substring match mean "the line that IS this", and they make the needle one B5's
`anchor_check` can read, so the gate and this harness count the same thing. The breaks are
converted to the file's own line ending (`core.autocrlf=true` on this box) before the patch.

⛔ NOT-APPLIED IS A FAILURE, NEVER A SKIP. An anchor that has gone stale produces a mutation that was
never applied, a run that stays green, and a harness that reads as a proof.

⛔ AND RED FOR THE WRONG REASON IS NOT A PROOF. Each mutation names the self-check case it must
break; a mutation that reddens the suite somewhere else says nothing about the guard it removed.

⛔⛔ THE TREE GUARD LOOKS AT THE TREE THE EDITS LAND IN. Until 2026-11-24 `main()` handed the guard
the argv root while every edit went to the `load_harness.py` BESIDE THIS HARNESS, so the guard could
approve a marked sandbox while the writes landed in the tree the harness was launched from. Now
`ROOT` is the one tree this harness guards, mutates and self-checks, and `guard()` runs at module
level before any write.

Usage:  python docs/discord-render/instruments/mutation_harness_load_model.py [repo-root] [--dry-check]
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
#: The ONE tree this harness reads, guards, mutates and self-checks.
ROOT = Path(_POSITIONAL[0]).resolve() if _POSITIONAL else HERE.parents[2]

TARGET = "docs/discord-render/instruments/load_harness.py"

#: `expect_red_case` is the self-check case this mutation MUST turn red, matched as a substring of
#: the case name.
MUTATIONS = [
    # ── OI-37: the load model itself (promoted from the lost scratchpad script) ──
    {"name": "M1 the in-flight PEAK is blinded", "file": TARGET,
     "old": "\n            peak = max(peak, inflight)\n", "new": "\n            peak = 0\n",
     "expect_red_case": "reaches EXACTLY N in flight"},
    {"name": "M2 the broken-variant control is neutered", "file": TARGET,
     "old": "\n            if release_early:\n", "new": "\n            if False:\n",
     "expect_red_case": "releasing before completion is CAUGHT"},
    {"name": "M3 the unlabelled-artifact reader accepts anything", "file": TARGET,
     "old": "\n    if model not in (OPEN_LOOP, CLOSED_LOOP):\n", "new": "\n    if False:\n",
     "expect_red_case": "pre-OI-37 artifact"},
    {"name": "M4 the 'exactly one load model' guard is deleted", "file": TARGET,
     "old": "\n    if (args.arrival_rate is None) == (args.concurrency is None):\n",
     "new": "\n    if False:\n",
     "expect_red_case": "load model given is refused BY NAME"},
    {"name": "M5 the removed --rate flag is silently accepted again", "file": TARGET,
     "old": "\n    if args.rate is not None:\n", "new": "\n    if False:\n",
     "expect_red_case": "--rate flag is refused BY NAME"},

    # ── C3: the spin ceiling (D-01 defect D3) ────────────────────────────
    {"name": "M6 the spin ceiling never fires — the 521,654-attempt run publishes its S1 again",
     "file": TARGET,
     "old": "\n    if observed > ceiling:\n", "new": "\n    if False:\n",
     "expect_red_case": "521,654-attempt spin is CAUGHT"},
    # ⭐ THE NON-VACUITY MUTATION, and it is the more interesting of the two. A ceiling tightened
    # until it also catches the REAL runs would make every load run INCONCLUSIVE — a harness that
    # refuses everything is as useless as one that refuses nothing, and only this direction finds it.
    {"name": "M7 the spin ceiling is tightened until it catches the REAL runs too", "file": TARGET,
     "old": "\nSPIN_TOLERANCE = 3.0\n", "new": "\nSPIN_TOLERANCE = 0.001\n",
     "expect_red_case": "is NOT caught (non-vacuity)"},

    # ── C2: the gauge publishes its own denominator ──────────────────────
    # ⚰️ This is the 2026-09-14 mistake made structural: I compared an open-loop artifact against the
    # closed loop's 0.5 s cadence and published a starved-gauge finding that did not exist. If the
    # two gauges describe themselves identically, that comparison is available to be made by hand
    # again.
    {"name": "M8 the two gauges describe themselves identically", "file": TARGET,
     "old": '\n        trigger = f"every {GAUGE_OPEN_EVERY_N}th arrival"\n',
     "new": '\n        trigger = f"every {GAUGE_CLOSED_INTERVAL_S}s"\n',
     "expect_red_case": "do not describe themselves identically"},
    {"name": "M9 a depth figure stops being labelled a FLOOR", "file": TARGET,
     "old": '\n        "depth_is_a_floor": True,\n', "new": '\n        "depth_is_a_floor": False,\n',
     "expect_red_case": "labelled a FLOOR"},

    # ── B1: the three-way split ──────────────────────────────────────────
    {"name": "M10 the split's arithmetic check always says it closes", "file": TARGET,
     "old": '\n        "closes": unresolved == 0 and offers > 0,\n', "new": '\n        "closes": True,\n',
     "expect_red_case": "leaves the receipt NOT closing"},
    {"name": "M11 a delivered-but-late member counts as served_in_slo", "file": TARGET,
     "old": "\n            if isinstance(f, (int, float)) and f <= slo_p99_ms:\n",
     "new": "\n            if True:\n",
     "expect_red_case": "served_late, never served_in_slo"},

    # ⭐ OI-40, WHERE THE GUARD ACTUALLY IS. This mutation was first written against the flip gate
    # and came back GREEN — correctly, because the gate consumes an already-computed split and the
    # outcome keying lives here. `queue_full` has three producers and only `refused_at_ack` is a
    # refusal; keying on the CLASS again turns a job that was admitted, ran and failed into an
    # honest refusal, which is the direction that flatters.
    {"name": "M12 an outcome=busy row is keyed as a refusal again (OI-40 regression)", "file": TARGET,
     "old": "\n            if cls in ADMISSION_REFUSAL_CLASSES and outcome == REFUSAL_EXPECTED_OUTCOME:\n",
     "new": "\n            if cls in ADMISSION_REFUSAL_CLASSES:\n",
     "expect_red_case": "outcome=busy is a FAILURE"},
]


def _eol(text: str, s: str) -> str:
    """The anchor in the target's own line ending (`core.autocrlf=true` on this box)."""
    return s.replace("\n", "\r\n") if "\r\n" in text else s


def dry_check(out=print) -> int:
    """Do all the anchors still match their source, exactly once? It only READS, which is why it
    runs before the tree guard: the flip gate calls it from whatever tree the integrator is in."""
    stale = []
    try:
        text = (ROOT / TARGET).read_bytes().decode("utf-8")
    except Exception as e:  # noqa: BLE001
        out(f"  NOT APPLIED: cannot read {TARGET}: {type(e).__name__}: {e}")
        out("TOTALS mutation_harness_load_model --dry-check FAIL mutations=0 stale=1")
        return 1
    for m in MUTATIONS:
        n = text.count(_eol(text, m["old"]))
        if n != 1:
            stale.append(f"{m['name']}: anchor matches {n} time(s), expected 1")
    if not MUTATIONS:
        stale.append("the mutation set is EMPTY — a harness that mutated nothing proved nothing")
    for s in stale:
        out(f"  NOT APPLIED: {s}")
    out(f"TOTALS mutation_harness_load_model --dry-check {'PASS' if not stale else 'FAIL'} "
        f"mutations={len(MUTATIONS)} stale={len(stale)}")
    return 0 if not stale else 1


if __name__ == "__main__" and "--dry-check" in sys.argv[1:]:
    raise SystemExit(dry_check())

# ⛔ B4/B5 — ONE shared guard, imported, never copy-pasted (a guard repeated is a guard
# unproved). It refuses to run unless ROOT is a sacrificed mutation sandbox, then refuses to
# start a run on an anchor that no longer matches its source.
from harness_guard import guard  # noqa: E402

guard(ROOT, __file__)


def _self_check() -> tuple[int, str, str]:
    """⛔ THE TOTALS LINE IS READ, NOT THE EXIT CODE ALONE. A run that died at argument parsing and a
    run that evaluated 59 cases must never look the same to whoever reads this harness."""
    p = subprocess.run([sys.executable, str(ROOT / TARGET), "--self-check"], cwd=str(ROOT),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    totals = [l for l in out.splitlines() if l.startswith("TOTALS load_harness --self-check")]
    return p.returncode, (totals[-1] if totals else "NO TOTALS LINE"), out


def _red_cases(out: str) -> list[str]:
    return [l.strip() for l in out.splitlines() if l.strip().startswith("FAIL ")]


def run(out=print) -> int:
    declared, evaluated, failed = len(MUTATIONS), 0, 0
    path = ROOT / TARGET
    original = path.read_bytes()
    sha = hashlib.sha256(original).hexdigest()
    out(f"captured {path.name} sha256={sha[:16]} bytes={len(original)}")

    rc, totals, _ = _self_check()
    out(f"  CONTROL BEFORE: exit={rc}  {totals}")
    if rc != 0:
        out("  REFUSING to mutate: the control is not green, so a red below would prove nothing.")
        out(f"TOTALS mutation_harness_load_model INCONCLUSIVE declared={declared} evaluated=0 failed=1")
        return 2

    text = original.decode("utf-8")
    try:
        for m in MUTATIONS:
            try:
                patch_guard.safe_replace(path, _eol(text, m["old"]), _eol(text, m["new"]))
            except (patch_guard.PatchRefused, patch_guard.RoundTripFailed) as e:
                out(f"  {m['name']}: NOT APPLIED = FAIL — {e}")
                failed += 1
                evaluated += 1
                continue
            rc, totals, mout = _self_check()
            path.write_bytes(original)
            assert hashlib.sha256(path.read_bytes()).hexdigest() == sha, \
                f"RESTORE FAILED after {m['name']}"
            evaluated += 1
            reds = _red_cases(mout)
            named = sum(1 for l in reds if m["expect_red_case"] in l)
            if rc == 0:
                out(f"  {m['name']}: GREEN — NOT CAUGHT  {totals}")
                failed += 1
            elif not named:
                out(f"  {m['name']}: RED but NOT on the named case ({m['expect_red_case']!r}); "
                    f"{len(reds)} other failure(s) — proves nothing about the guard removed")
                failed += 1
            else:
                out(f"  {m['name']}: RED (good) — {named} named case(s) failed of {len(reds)}")
    finally:
        # ⛔ RESTORE ON EVERY PATH. A harness killed mid-run once left a mutation in the integrator's
        # working tree; that is the incident `harness_guard` exists for.
        path.write_bytes(original)

    rc, totals, _ = _self_check()
    out(f"  CONTROL AFTER: exit={rc}  {totals}")
    if rc != 0:
        failed += 1
    out(f"  restore verified sha256={hashlib.sha256(path.read_bytes()).hexdigest()[:16]}")
    if evaluated != declared:
        out(f"  ⛔ {declared - evaluated} declared mutation(s) were NEVER EVALUATED")
        failed += 1
    out(f"TOTALS mutation_harness_load_model {'PASS' if not failed else 'FAIL'} "
        f"declared={declared} evaluated={evaluated} failed={failed}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(run())
