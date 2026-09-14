"""D-02b Part 2 — can `load_harness`'s load model, gauge, spin ceiling and split fail?

⛔⛔ THIS FILE REPLACES A SCRATCHPAD SCRIPT. The OI-37 mutations (M1-M6) were proved once from a
temporary file in a session directory and then lost. A mutation proof nobody can re-run is a claim,
not a rail — and this is the instrument every S1, S2, S5 and admission number in the programme comes
out of, so it is the last place a claim should stand in for a rail.

⛔ Every mutation is applied through `patch_guard.safe_replace`: the anchor is matched as a WHOLE
LINE (substring counting cannot see indentation), both strings are scanned for escape-collapse
signatures before any write, and the replacement is sha256 round-tripped after it. Restore is a
write-back of captured bytes verified by sha256 — never `git checkout`.

⛔ NOT-APPLIED IS A FAILURE, NEVER A SKIP. An anchor that has gone stale produces a mutation that was
never applied, a run that stays green, and a harness that reads as a proof.

⛔ AND RED FOR THE WRONG REASON IS NOT A PROOF. Each mutation names the self-check case it must
break; a mutation that reddens the suite somewhere else says nothing about the guard it removed.
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

TARGET = HERE / "load_harness.py"


@dataclass(frozen=True)
class Mutation:
    name: str
    old: str
    new: str
    #: The self-check case this mutation MUST turn red, matched as a substring of the case name.
    expect_red_case: str


MUTATIONS = (
    # ── OI-37: the load model itself (promoted from the lost scratchpad script) ──
    Mutation("M1 the in-flight PEAK is blinded",
             "            peak = max(peak, inflight)", "            peak = 0",
             "reaches EXACTLY N in flight"),
    Mutation("M2 the broken-variant control is neutered",
             "            if release_early:", "            if False:",
             "releasing before completion is CAUGHT"),
    Mutation("M3 the unlabelled-artifact reader accepts anything",
             "    if model not in (OPEN_LOOP, CLOSED_LOOP):", "    if False:",
             "pre-OI-37 artifact"),
    Mutation("M4 the 'exactly one load model' guard is deleted",
             "    if (args.arrival_rate is None) == (args.concurrency is None):", "    if False:",
             "load model given is refused BY NAME"),
    Mutation("M5 the removed --rate flag is silently accepted again",
             "    if args.rate is not None:", "    if False:",
             "--rate flag is refused BY NAME"),

    # ── C3: the spin ceiling (D-01 defect D3) ────────────────────────────
    Mutation("M6 the spin ceiling never fires — the 521,654-attempt run publishes its S1 again",
             "    if observed > ceiling:", "    if False:",
             "521,654-attempt spin is CAUGHT"),
    # ⭐ THE NON-VACUITY MUTATION, and it is the more interesting of the two. A ceiling tightened
    # until it also catches the REAL runs would make every load run INCONCLUSIVE — a harness that
    # refuses everything is as useless as one that refuses nothing, and only this direction finds it.
    Mutation("M7 the spin ceiling is tightened until it catches the REAL runs too",
             "SPIN_TOLERANCE = 3.0", "SPIN_TOLERANCE = 0.001",
             "is NOT caught (non-vacuity)"),

    # ── C2: the gauge publishes its own denominator ──────────────────────
    # ⚰️ This is the 2026-09-14 mistake made structural: I compared an open-loop artifact against the
    # closed loop's 0.5 s cadence and published a starved-gauge finding that did not exist. If the
    # two gauges describe themselves identically, that comparison is available to be made by hand
    # again.
    Mutation("M8 the two gauges describe themselves identically",
             '        trigger = f"every {GAUGE_OPEN_EVERY_N}th arrival"',
             '        trigger = f"every {GAUGE_CLOSED_INTERVAL_S}s"',
             "do not describe themselves identically"),
    Mutation("M9 a depth figure stops being labelled a FLOOR",
             '        "depth_is_a_floor": True,', '        "depth_is_a_floor": False,',
             "labelled a FLOOR"),

    # ── B1: the three-way split ──────────────────────────────────────────
    Mutation("M10 the split's arithmetic check always says it closes",
             '        "closes": unresolved == 0 and offers > 0,', '        "closes": True,',
             "leaves the receipt NOT closing"),
    Mutation("M11 a delivered-but-late member counts as served_in_slo",
             "            if isinstance(f, (int, float)) and f <= slo_p99_ms:",
             "            if True:",
             "served_late, never served_in_slo"),
)


def _self_check() -> tuple[int, str, str]:
    """⛔ THE TOTALS LINE IS READ, NOT THE EXIT CODE ALONE. A run that died at argument parsing and a
    run that evaluated 59 cases must never look the same to whoever reads this harness."""
    p = subprocess.run([sys.executable, str(TARGET), "--self-check"], cwd=HERE.parents[2],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    totals = [l for l in out.splitlines() if l.startswith("TOTALS load_harness --self-check")]
    return p.returncode, (totals[-1] if totals else "NO TOTALS LINE"), out


def _red_cases(out: str) -> list[str]:
    return [l.strip() for l in out.splitlines() if l.strip().startswith("FAIL ")]


def dry_check(out=print) -> int:
    """Do all the anchors still match their source, exactly once, as whole lines?"""
    stale = []
    try:
        lines = [l.rstrip() for l in TARGET.read_text(encoding="utf-8").split("\n")]
    except Exception as e:  # noqa: BLE001
        out(f"  NOT APPLIED: cannot read {TARGET.name}: {type(e).__name__}: {e}")
        out("TOTALS mutation_harness_load_model --dry-check FAIL mutations=0 stale=1")
        return 1
    for m in MUTATIONS:
        n = sum(1 for l in lines if l == m.old)
        if n != 1:
            stale.append(f"{m.name}: anchor matches {n} whole line(s), expected 1")
    if not MUTATIONS:
        stale.append("the mutation set is EMPTY — a harness that mutated nothing proved nothing")
    for s in stale:
        out(f"  NOT APPLIED: {s}")
    out(f"TOTALS mutation_harness_load_model --dry-check {'PASS' if not stale else 'FAIL'} "
        f"mutations={len(MUTATIONS)} stale={len(stale)}")
    return 0 if not stale else 1


def run(out=print) -> int:
    declared, evaluated, failed = len(MUTATIONS), 0, 0
    original = TARGET.read_bytes()
    sha = hashlib.sha256(original).hexdigest()
    out(f"captured {TARGET.name} sha256={sha[:16]} bytes={len(original)}")

    rc, totals, _ = _self_check()
    out(f"  CONTROL BEFORE: exit={rc}  {totals}")
    if rc != 0:
        out("  REFUSING to mutate: the control is not green, so a red below would prove nothing.")
        out(f"TOTALS mutation_harness_load_model INCONCLUSIVE declared={declared} evaluated=0 failed=1")
        return 2

    try:
        for m in MUTATIONS:
            try:
                patch_guard.safe_replace(TARGET, m.old, m.new, whole_line=True)
            except (patch_guard.PatchRefused, patch_guard.RoundTripFailed) as e:
                out(f"  {m.name}: NOT APPLIED = FAIL — {e}")
                failed += 1
                evaluated += 1
                continue
            rc, totals, mout = _self_check()
            TARGET.write_bytes(original)
            assert hashlib.sha256(TARGET.read_bytes()).hexdigest() == sha, \
                f"RESTORE FAILED after {m.name}"
            evaluated += 1
            reds = _red_cases(mout)
            named = sum(1 for l in reds if m.expect_red_case in l)
            if rc == 0:
                out(f"  {m.name}: GREEN — NOT CAUGHT  {totals}")
                failed += 1
            elif not named:
                out(f"  {m.name}: RED but NOT on the named case ({m.expect_red_case!r}); "
                    f"{len(reds)} other failure(s) — proves nothing about the guard removed")
                failed += 1
            else:
                out(f"  {m.name}: RED (good) — {named} named case(s) failed of {len(reds)}")
    finally:
        # ⛔ RESTORE ON EVERY PATH. A harness killed mid-run once left a mutation in the integrator's
        # working tree; that is the incident `harness_guard` exists for.
        TARGET.write_bytes(original)

    rc, totals, _ = _self_check()
    out(f"  CONTROL AFTER: exit={rc}  {totals}")
    if rc != 0:
        failed += 1
    out(f"  restore verified sha256={hashlib.sha256(TARGET.read_bytes()).hexdigest()[:16]}")
    if evaluated != declared:
        out(f"  ⛔ {declared - evaluated} declared mutation(s) were NEVER EVALUATED")
        failed += 1
    out(f"TOTALS mutation_harness_load_model {'PASS' if not failed else 'FAIL'} "
        f"declared={declared} evaluated={evaluated} failed={failed}")
    return 0 if not failed else 1


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    positional = [a for a in argv if not a.startswith("-")]
    root = pathlib.Path(positional[0]).resolve() if positional else HERE.parents[2]
    if "--dry-check" in argv:
        return dry_check()
    from harness_guard import require_throwaway_worktree  # noqa: E402
    require_throwaway_worktree(root, pathlib.Path(__file__).name)
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
