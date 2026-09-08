"""2F-2B mutation controls — does the finite-window suite actually bite?

A rail that stays green when the code under it is broken is a rail that proves
nothing (`lesson_gate_that_cannot_fail`). Every mutation below removes or flips
ONE decision the wave argued for; each must turn the suite RED.

BYTE-EXACT RESTORATION, NEVER `git checkout` (`feedback_mutation_check_never_git_checkout`)
— the working tree carries uncommitted work in other files and a checkout has
discarded it before. Each file is snapshotted, mutated, restored, and the
restored sha256 is compared against the snapshot; a mismatch aborts the run.

A CLEAN-FILE CONTROL runs first: if the suite is not green before any mutation,
every "RED" below is meaningless.
"""
import hashlib
import subprocess
import sys
from pathlib import Path

CRLF = chr(13) + chr(10)
ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
ENG = APP / "src/components/chart/engine"
SUITE = "src/components/chart/engine/runtime/__tests__/finiteWindow.test.js"

VM = ENG / "runtime/vm.js"
FE = ENG / "ast/pineRuntimeFrontend.js"
IN = ENG / "ast/interpret.js"
LOWER = ENG / "runtime/lowerIr.js"

# (label, file, find, replace, why it must be caught)
MUTATIONS = [
    ("warmup off-by-one", VM,
     "if (committed < span - 1) { stack[sp++] = NaN; break }",
     "if (committed < span - 2) { stack[sp++] = NaN; break }",
     "one bar of the warm-up would answer a number off a partly-empty ring"),
    ("warmup guard deleted", VM,
     "if (committed < span - 1) { stack[sp++] = NaN; break }",
     "",
     "a fabricated number during warm-up is one a member could arm an alert on"),
    ("window filled newest-first", VM,
     "buf[span - 1 - k] = hist[off + ((committed - k) % depth)]",
     "buf[k] = hist[off + ((committed - k) % depth)]",
     "order-blind reducers (sma) would still agree; wma/rising/highestbars would not"),
    ("span taken from the call, not the table", FE,
     "const span = FINITE_WINDOW[win.table].span(n)",
     "const span = n",
     "`rising(x, n)` spans n+1 bars — the table owns that, not the call site"),
    ("per-site history base dropped", VM,
     "const hi = historyBase + w.historySlot",
     "const hi = w.historySlot",
     "two call sites would read one ring — P7.2's whole point"),
    ("the sign flip dropped", FE,
     "return win.negate ? unary('u-', call) : call",
     "return call",
     "ta.highestbars would answer the right magnitude with the wrong sign"),
    # ⛔ THE FIRST DRAFT OF THIS ONE SURVIVED, AND THE REASON IS WORTH KEEPING.
    # It cut only the integer/negative half, leaving `canonical.type !== 'num'`
    # standing — so every case the suite had still refused, and the "mutation"
    # changed no answer. A mutation that cannot change an answer measures the
    # harness, not the code (`lesson_mutations_can_cancel_each_other`). This one
    # removes the whole condition, so a runtime-derived length gets through.
    ("length fold accepts anything", FE,
     "if (!canonical || canonical.type !== 'num'" + CRLF
     + "      || !Number.isInteger(canonical.value) || canonical.value < 0) {",
     "if (!canonical) {",
     "a runtime-derived length would size a ring it cannot bound"),
    ("WINDOW_CELLS not charged", VM,
     "budget.charge('WINDOW_CELLS', span)",
     "",
     "a program whose windows are enormous would run long instead of stopping by name"),
    ("ring one bar too shallow", FE,
     "if (owner !== null) fnHistorySlotFor(owner, varSlot, span - 1, at)",
     "if (owner !== null) fnHistorySlotFor(owner, varSlot, span - 2, at)",
     "the oldest bar of every UDF window would come back NaN or stale"),
    ("live bar not placed in the window", VM,
     "buf[span - 1] = live",
     "buf[span - 1] = buf[span - 1]",
     "every window would be one bar stale — the classic off-by-one"),
    ("source-must-be-a-name dropped", FE,
     "if (!srcNode || srcNode.type !== 'name') {",
     "if (false) {",
     "`sma(x + 1, 5)` has no committed series; admitting it computes something else"),
    ("WINDOW lowers without pushing its source", LOWER,
     "        expr(e.source)\r\n        emit(OP.WINDOW, e.site)",
     "        emit(OP.WINDOW, e.site)",
     "the live bar would be whatever the stack happened to hold"),
    # ⛔ ALSO REBUILT. The first version added a SECOND `sma` path that computed
    # `rolling(series, n, windowMean)` — which is what the table already does, so
    # it was behaviour-identical and survived by construction. A second authority
    # that AGREES is undetectable by any value test; what is testable is the
    # runtime growing its own arithmetic instead of calling the table's.
    ("runtime grows its own reducer", VM,
     "    return spec.reduce",
     "    return (b, lo, hi) => { let t = 0; for (let i = lo; i <= hi; i += 1) t += b[i]; return t / (hi - lo + 1) }",
     "the runtime would re-implement every member as a mean — no second SMA to keep in step"),
]


def run_suite():
    r = subprocess.run(
        ["npx", "vitest", "run", SUITE, "--reporter=dot"],
        cwd=APP, capture_output=True, shell=True,
    )
    # ⛔ BYTES, THEN DECODE WITH `replace`. `text=True` decodes as cp1252 on
    # this box and vitest only prints the ⭐/⛔ glyphs on the FAILURE path — so a
    # text capture works on every green run and explodes on the first red one,
    # which is the one that matters (`lesson_a_capture_that_only_breaks_on_failure`).
    out = (r.stdout or b"").decode("utf-8", "replace") + (r.stderr or b"").decode("utf-8", "replace")
    return r.returncode == 0, out


def main():
    ok, out = run_suite()
    if not ok:
        print("CONTROL FAILED — the suite is not green before any mutation.")
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
            skipped.append((label, f"anchor matched {n}x — not applied"))
            print(f"SKIP  {label}: anchor matched {n}x")
            continue
        try:
            path.write_bytes(original.replace(needle, repl.encode(), 1))
            green, _ = run_suite()
        finally:
            path.write_bytes(original)
            back = hashlib.sha256(path.read_bytes()).hexdigest()
            restored_ok = back == sha
        if not restored_ok:
            print(f"ABORT: {path} did not restore byte-identically")
            return 2
        (survived if green else killed).append((label, why))
        print(f"{'SURVIVED' if green else 'KILLED  '}  {label}")

    print(f"\nkilled {len(killed)}/{len(MUTATIONS) - len(skipped)}"
          f"  survived {len(survived)}  skipped {len(skipped)}")
    for label, why in survived:
        print(f"  SURVIVED: {label} — {why}")
    for label, why in skipped:
        print(f"  SKIPPED : {label} — {why}")
    return 0 if not survived and not skipped else 3


if __name__ == "__main__":
    sys.exit(main())
