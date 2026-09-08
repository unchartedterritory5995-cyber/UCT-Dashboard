"""2F-2C mutation controls — does the carried-state suite actually bite?

A rail that stays green when the code under it is broken is a rail that proves
nothing (`lesson_gate_that_cannot_fail`). Every mutation below removes or flips
ONE decision the wave argued for; each must turn the suite RED.

BYTE-EXACT RESTORATION, NEVER `git checkout`
(`feedback_mutation_check_never_git_checkout`) — the working tree carries
uncommitted work in other files and a checkout has discarded it before. Each file
is snapshotted, mutated, restored, and the restored sha256 is compared against the
snapshot; a mismatch aborts the run.

A CLEAN-FILE CONTROL runs first: if the suite is not green before any mutation,
every "RED" below is meaningless.
"""
import hashlib
import subprocess
import sys
from pathlib import Path

NL = chr(13) + chr(10)
ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
ENG = APP / "src/components/chart/engine"
SUITE = "src/components/chart/engine/runtime/__tests__/carriedState.test.js"

VM = ENG / "runtime/vm.js"
FE = ENG / "ast/pineRuntimeFrontend.js"
IN = ENG / "ast/interpret.js"
LOWER = ENG / "runtime/lowerIr.js"

STEP_TAIL = "  st[o] = st[o] * (1 - k) + v * k" + NL + "  return st[o]"

# (label, file, find, replace, why it must be caught)
MUTATIONS = [
    # ── instance identity: the silent-wrong-result surface ──
    ("two call sites SHARE state", VM,
     "          const ci = carriedBase + a",
     "          const ci = a",
     "one EMA instance would serve every call site of a function"),
    ("call-site base never allocated", FE,
     "        cs.carriedBase = cbase",
     "        cs.carriedBase = 0",
     "the front end would hand every site the same block"),
    ("frame base not restored after RET", VM,
     "          carriedBase = frCarriedBase[depth]",
     "",
     "a caller would keep reading the callee's instances after the call returns"),
    # ── the recurrence itself ──
    ("state re-initialised every step", VM,
     "          budget.charge('CARRIED_STEPS', 1)",
     "          budget.charge('CARRIED_STEPS', 1); carSpec[ci].init(carState, carOffset[ci])",
     "the recurrence would warm up forever and emit only na"),
    ("wrong seed - first value, not the window mean", IN,
     "    if (st[o + 1] === n) { st[o] = st[o + 2] / n; return st[o] }",
     "    if (st[o + 1] === n) { st[o] = v; return st[o] }",
     "the left edge would be wrong forever and then converge to look right"),
    ("one bar late - emit the pre-step value", IN,
     STEP_TAIL,
     "  const was = st[o]" + NL + "  st[o] = st[o] * (1 - k) + v * k" + NL + "  return was",
     "every recurrent series would lag its own definition by one bar"),
    ("one bar early - step twice", IN,
     STEP_TAIL,
     "  st[o] = st[o] * (1 - k) + v * k" + NL + STEP_TAIL,
     "the filter would run ahead of the bars it was given"),
    ("alpha swapped between members", IN,
     "  ema: { cells: SMOOTH_CELLS, init: smoothInit, step: smoothStep, alpha: (n) => 2 / (n + 1) },",
     "  ema: { cells: SMOOTH_CELLS, init: smoothInit, step: smoothStep, alpha: (n) => 1 / n },",
     "ema would silently compute rma - a plausible curve, wrong on every bar"),
    ("the na rule flipped to HOLD", IN,
     "    smoothInit(st, o)" + NL + "    return NaN",
     "    return NaN",
     "our behaviour would change without the owner ruling the divergence"),
    # ── wiring ──
    ("source not pushed before CARRIED", LOWER,
     "        expr(e.source)" + NL + "        emit(OP.CARRIED, e.site)",
     "        emit(OP.CARRIED, e.site)",
     "the recurrence would consume whatever the stack happened to hold"),
    ("length ignored - alpha from a constant", VM,
     "  const carAlpha = carPlan.map((c, i) => carSpec[i].alpha(c.n))",
     "  const carAlpha = carPlan.map((c, i) => carSpec[i].alpha(14))",
     "every length would compute the same curve"),
    ("CARRIED_STEPS not charged", VM,
     "          budget.charge('CARRIED_STEPS', 1)",
     "",
     "a runaway program would run long instead of stopping by name"),
    ("carried state shares the persist block", VM,
     "  const carState = new Float64Array(carCells)",
     "  const carState = persist",
     "a member's `var` and a builtin's recurrence would overwrite each other"),
    ("classifier ignores the namespaced tree", FE,
     "  if (tree[name]) return null",
     "",
     "a future rewritten member would reach the bare entry - the highestbars defect"),
]


def run_suite():
    r = subprocess.run(
        ["npx", "vitest", "run", SUITE, "--reporter=dot"],
        cwd=APP, capture_output=True, shell=True,
    )
    # ⛔ BYTES, THEN DECODE WITH `replace`. `text=True` decodes as cp1252 here and
    # vitest prints its ⭐/⛔ glyphs only on the FAILURE path, so a text capture
    # works on every green run and explodes on the first red one — which is the
    # one that matters (`lesson_a_capture_that_only_breaks_on_failure`).
    out = (r.stdout or b"").decode("utf-8", "replace") + (r.stderr or b"").decode("utf-8", "replace")
    return r.returncode == 0, out


def main():
    ok, out = run_suite()
    if not ok:
        print("CONTROL FAILED - the suite is not green before any mutation.")
        print(out[-3000:])
        return 1
    print(f"CONTROL: clean tree GREEN ({SUITE})\n")

    survived, killed, skipped = [], [], []
    for label, path, find, repl, why in MUTATIONS:
        original = path.read_bytes()
        sha = hashlib.sha256(original).hexdigest()
        needle = find.encode()
        n = original.count(needle)
        if n != 1:
            skipped.append((label, f"anchor matched {n}x - not applied"))
            print(f"SKIP      {label}: anchor matched {n}x")
            continue
        restored_ok = False
        try:
            path.write_bytes(original.replace(needle, repl.encode(), 1))
            green, _ = run_suite()
        finally:
            path.write_bytes(original)
            restored_ok = hashlib.sha256(path.read_bytes()).hexdigest() == sha
        if not restored_ok:
            print(f"ABORT: {path} did not restore byte-identically")
            return 2
        (survived if green else killed).append((label, why))
        print(f"{'SURVIVED' if green else 'KILLED  '}  {label}")

    print(f"\nkilled {len(killed)}/{len(MUTATIONS) - len(skipped)}"
          f"  survived {len(survived)}  skipped {len(skipped)}")
    for label, why in survived:
        print(f"  SURVIVED: {label} - {why}")
    for label, why in skipped:
        print(f"  SKIPPED : {label} - {why}")
    return 0 if not survived and not skipped else 3


if __name__ == "__main__":
    sys.exit(main())
