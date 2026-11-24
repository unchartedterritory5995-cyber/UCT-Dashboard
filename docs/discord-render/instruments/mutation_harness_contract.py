"""D-02 A5/A6 — can the EVIDENCE CONTRACT fail? Six mutations, each with a named red.

⛔⛔ THE CONTRACT IS NOW THE SINGLE THING DECIDING WHAT THE FLIP GATE IS ALLOWED TO JUDGE, which
makes it the highest-leverage place in the programme for a silent defect. The flip gate's own
three-state mutation set (run by `flip_preconditions.py --self-check`) proves the ROWS can fail;
this proves the SELECTOR underneath them can. They are separate because they fail for separate
reasons: a row that reads a verdict correctly off a set that was chosen wrongly is exactly the
defect D-02 exists to close, and only this harness can see it.

⭐ THE NON-VACUITY CONTROL IS THE ONE TO READ FIRST (`M6`). A contract that refused EVERYTHING would
make every row NOT MEASURABLE — the gate could never lie, and it could also never pass, which is a
gate nobody keeps running. M6 stops `select` ever admitting an artifact and asserts the suite goes
RED, so the green result above it is known to depend on artifacts being genuinely ADMITTED rather
than on universal exclusion.

⛔ EVERY ANCHOR IS ONE WHOLE LINE, WRITTEN WITH ITS LINE BREAKS ON BOTH SIDES
(`"\\n    if art.void:\\n"`). Substring counting cannot see indentation: `"    if art.void:"` occurs
inside `"        if art.void:"`, so a bare count reported three matches for a line that appears
exactly once — loud in that direction, and the same arithmetic in the other silently mutates the
WRONG branch. The breaks make an exact substring match mean "the line that IS this", and they make
the needle one B5's `anchor_check` can read, so the gate and this harness count the same thing.
`core.autocrlf=true` on this box, so the breaks are converted to the file's own line ending before
counting. NOT-APPLIED is a FAILURE here, never a skip.

⛔ RESTORE IS A WRITE-BACK OF CAPTURED BYTES, VERIFIED BY SHA256 — never `git checkout`, which has
already destroyed twenty minutes of unrelated finished work in this repository once
(`feedback_mutation_check_never_git_checkout`).

⛔⛔ THE TREE GUARD LOOKS AT THE TREE THE EDITS LAND IN. Until 2026-11-24 `main()` handed the guard
the argv root while every edit went to the files BESIDE THIS HARNESS, so the guard could approve a
marked sandbox while the writes landed in the tree the harness was launched from. Now `ROOT` is the
one tree this harness guards, mutates and self-checks, and `guard()` runs at module level before
any write.

Usage:  python docs/discord-render/instruments/mutation_harness_contract.py [repo-root] [--dry-check]
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# ⛔ FLAGS ARE NOT PATHS — eleven sibling harnesses took `--dry-check` as their repo root and
# died in the tree guard, which the old gate row then read as success.
_POSITIONAL = [a for a in sys.argv[1:] if not a.startswith("-")]
#: The ONE tree this harness reads, guards, mutates and self-checks.
ROOT = Path(_POSITIONAL[0]).resolve() if _POSITIONAL else HERE.parents[2]

INST = "docs/discord-render/instruments/"
CONTRACT = INST + "evidence_contract.py"
GATE = INST + "flip_preconditions.py"

#: `expect_red_case` is what the suite must START saying when this guard is gone. A mutation that
#: turns the suite red for SOME other reason proves nothing about the guard it removed, so the
#: expected failure is named and checked rather than inferred from the exit code.
MUTATIONS = [
    {"name": "M1 a VOID artifact is judged like any other", "file": CONTRACT,
     "old": "\n    if art.void:\n", "new": "\n    if False:\n",
     "expect_red_case": "THE VOID ARTIFACT"},
    {"name": "M2 the renderer stops mattering to S2 latency", "file": CONTRACT,
     "old": "\n    if art.renderer != RENDERER_PRODUCTION:\n", "new": "\n    if False:\n",
     "expect_red_case": "renderer=fallback"},
    {"name": "M3 an UNLABELLED load model is accepted for delivery", "file": CONTRACT,
     "old": "\n    if art.model not in MODELS:\n", "new": "\n    if False:\n",
     "expect_red_case": "no load model"},
    {"name": "M4 a chaos RIG run counts as a real one", "file": CONTRACT,
     "old": '\n        if not any(m.startswith("real") for m in modes):\n',
     "new": "\n        if False:\n",
     "expect_red_case": "A RIG RUN RENAMED"},
    # ⚰️ RE-AIMED 2026-11-24, AND ITS NAMED RED MOVED WITH IT. The anchor was
    # `elif _SMOKE_INDEX_MARK.search(text or ""):` — the ACCEPT branch — and `elif True:` accepted
    # any INDEX, so the undeclared index in the flip gate's "DIRECTORY NAMED SOMETHING ELSE" case
    # was SCORED and the row's STATE went wrong. R50 (46504fa881, 2026-09-17) turned that branch
    # into a REJECTION (`if not ...: continue`) and added two more in-band rejections (no commit
    # SHA, no run date), so this anchor matched nothing from that day on — unseen, because
    # `anchor_check` could not read this file's old shape. Re-aimed at the same guard with the same
    # defect (the declaration stops being required). That fixture's undeclared index names no
    # commit either, so R50's SHA rejection still keeps it out and the row's STATE stays right;
    # what goes red is the row's SENTENCE — the case requires the evidence to say "does not declare
    # itself" — and on a sentence-only failure the gate prints the case's NOTE, not its title.
    {"name": "M5 an INDEX no longer has to declare itself a 3.5 smoke", "file": GATE,
     "old": '\n        if not _SMOKE_INDEX_MARK.search(text or ""):\n',
     "new": "\n        if False:\n",
     "expect_red_case": "never says 'does not declare itself'"},
    {"name": "M6 NON-VACUITY: nothing is ever admitted, so no row can ever be MET", "file": CONTRACT,
     "old": "\n        if ruling.disposition == ADMIT:\n", "new": "\n        if False:\n",
     "expect_red_case": "PASS planted"},

    # ── D-03 Part 0.6 · the amended S5 / S5b / S5c ────────────────────────
    {"name": "M7 an UNREACHED refusal is counted as reached", "file": GATE,
     "old": "\n    elif late:\n", "new": "\n    elif False:\n",
     "expect_red_case": "did not reach the member"},
    # ⚰️ MY FIRST EXPECTATION FOR THIS ONE WAS WRONG AND THE HARNESS SAID SO: it went RED on a
    # different case. Naming the wrong case is not a smaller error than a green mutation — it is a
    # proof about a guard that was never exercised. Traced: with the floor on `refused`, the
    # design-burst case's 1-of-200 is EXACTLY 0.005 and `>` is false, so that case is untouched;
    # what breaks is the `failed` case, whose 2-of-200 stops being seen at all.
    {"name": "M8 the failure floor is applied to REFUSED instead of FAILED — an honest refusal "
             "becomes a breach and a real failure becomes invisible", "file": GATE,
     "old": '\n        frac = (sp.get("failed") or 0) / sp["offers"]\n',
     "new": '\n        frac = (sp.get("refused_by_admission") or 0) / sp["offers"]\n',
     "expect_red_case": "the failure floor bites on `failed`"},
    {"name": "M9 an INFORMATIONAL run is judged after all", "file": CONTRACT,
     "old": "\n    if art.purpose == PURPOSE_CHARACTERISATION:\n", "new": "\n    if False:\n",
     "expect_red_case": "reported, not judged"},
    {"name": "M10 the sum check is removed — a receipt that loses requests reads as a quieter "
             "system than the real one", "file": GATE,
     "old": '\n        if not sp.get("closes"):\n', "new": "\n        if False:\n",
     "expect_red_case": "do not sum"},
    {"name": "M11 the 3x tier ceiling is read as 10 % instead of 1 %", "file": GATE,
     "old": '\nS5B_TIERS = {"busiest60s": 0.0, "busiest10s": 0.0, "design": 0.0, "design3x": 0.01}\n',
     "new": '\nS5B_TIERS = {"busiest60s": 0.10, "busiest10s": 0.10, "design": 0.10, "design3x": 0.10}\n',
     "expect_red_case": "S5b: a refusal AT THE DESIGN BURST"},
]

# ⚰️ AND ONE MUTATION THAT DOES NOT BELONG HERE, RECORDED RATHER THAN QUIETLY DROPPED.
# I wrote an "outcome=busy row is keyed as a refusal again (OI-40 regression)" mutation against this
# gate and it came back **GREEN — NOT CAUGHT**. Traced rather than re-aimed until it went red: the
# gate CONSUMES an already-computed `admission_split`; the outcome keying that OI-40 fixed lives in
# `load_harness.admission_split`. A mutation of the gate can never regress it, so a green here is
# the correct answer to a question asked in the wrong file.
# ⛔ It lives in `mutation_harness_load_model` as M12, where the guard actually is. Moving a
# mutation because it went green is only honest when you can say WHY it could never have gone red.


def _eol(text: str, s: str) -> str:
    """The anchor in the target's own line ending (`core.autocrlf=true` on this box)."""
    return s.replace("\n", "\r\n") if "\r\n" in text else s


def dry_check(out=print) -> int:
    """The cheap half: do all the anchors still match their source, exactly once?

    ⛔ A stale anchor is the failure this check exists for. It is reported as NOT APPLIED and it is
    a FAILURE — an anchor that matches nothing produces a mutation that was never applied, a run
    that stays green, and a harness that reads as a proof. It only READS, which is why it runs
    before the tree guard: the flip gate calls it from whatever tree the integrator is standing in."""
    stale = []
    for m in MUTATIONS:
        try:
            text = (ROOT / m["file"]).read_bytes().decode("utf-8")
        except Exception as e:  # noqa: BLE001
            stale.append(f"{m['name']}: cannot read {m['file']} ({type(e).__name__})")
            continue
        n = text.count(_eol(text, m["old"]))
        if n != 1:
            stale.append(f"{m['name']}: anchor matches {n} time(s) in {m['file']}, expected exactly 1")
    for s in stale:
        out(f"  NOT APPLIED: {s}")
    if not MUTATIONS:
        stale.append("the mutation set is EMPTY — a harness that mutated nothing proved nothing")
    out(f"TOTALS mutation_harness_contract --dry-check {'PASS' if not stale else 'FAIL'} "
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
    """Run the gate's own self-check IN ROOT. Returns (exit, totals line, full output).

    ⛔ THE TOTALS LINE IS READ, NOT THE EXIT CODE ALONE. A run that died at argument parsing and a
    run that evaluated 62 cases must never look the same to whoever reads this harness."""
    p = subprocess.run([sys.executable, str(ROOT / GATE), "--self-check"], cwd=str(ROOT),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    totals = [l for l in out.splitlines() if l.startswith("TOTALS flip_preconditions")]
    return p.returncode, (totals[-1] if totals else "NO TOTALS LINE"), out


def _failing_case_lines(out: str) -> list[str]:
    return [l for l in out.splitlines() if l.lstrip().startswith("FAIL ")]


def run(out=print) -> int:
    declared = len(MUTATIONS)
    evaluated = 0
    failed = 0

    originals = {p: p.read_bytes() for p in {ROOT / m["file"] for m in MUTATIONS}}
    shas = {p: hashlib.sha256(b).hexdigest() for p, b in originals.items()}
    for p, s in shas.items():
        out(f"captured {p.name} sha256={s[:16]} bytes={len(originals[p])}")

    rc, totals, _ = _self_check()
    out(f"  CONTROL BEFORE: exit={rc}  {totals}")
    if rc != 0:
        out("  REFUSING to mutate: the control is not green, so a red below would prove nothing.")
        out(f"TOTALS mutation_harness_contract INCONCLUSIVE declared={declared} evaluated=0 failed=1")
        return 2

    try:
        for m in MUTATIONS:
            path = ROOT / m["file"]
            text = originals[path].decode("utf-8")
            old, new = _eol(text, m["old"]), _eol(text, m["new"])
            n = text.count(old)
            if n != 1:
                out(f"  {m['name']}: ANCHOR MATCHES {n} TIME(S) — NOT APPLIED = FAIL")
                failed += 1
                evaluated += 1
                continue
            path.write_bytes(text.replace(old, new, 1).encode("utf-8"))
            rc, totals, mout = _self_check()
            path.write_bytes(originals[path])
            assert hashlib.sha256(path.read_bytes()).hexdigest() == shas[path], \
                f"RESTORE FAILED after {m['name']}"
            evaluated += 1
            reds = _failing_case_lines(mout)
            named = any(m["expect_red_case"] in l for l in reds)
            if rc == 0:
                out(f"  {m['name']}: GREEN — NOT CAUGHT  {totals}")
                failed += 1
            elif not named:
                # ⛔ RED FOR THE WRONG REASON IS NOT A PROOF. A mutation that breaks the suite
                # somewhere else says nothing about the guard it deleted.
                out(f"  {m['name']}: RED but NOT on the named case "
                    f"({m['expect_red_case']!r}); {len(reds)} other failure(s)")
                failed += 1
            else:
                out(f"  {m['name']}: RED (good) — "
                    f"{sum(m['expect_red_case'] in l for l in reds)} named "
                    f"case(s) failed of {len(reds)}")
    finally:
        # ⛔ RESTORE ON EVERY PATH. A harness killed mid-run once left a mutation in the
        # integrator's working tree; that is the incident `harness_guard` exists for.
        for p, b in originals.items():
            p.write_bytes(b)

    rc, totals, _ = _self_check()
    out(f"  CONTROL AFTER: exit={rc}  {totals}")
    if rc != 0:
        failed += 1
    for p in originals:
        out(f"  restore verified {p.name} sha256={hashlib.sha256(p.read_bytes()).hexdigest()[:16]}")

    # ⛔ DECLARED vs EVALUATED, PRINTED SEPARATELY (D-02 C1). `cases=N failed=0` was printed once in
    # this programme while five of twenty cases were actually checked, because the evaluation loop
    # sat in the middle of the appends. A count that rises while the checking does not is the exact
    # shape of the flip-gate rows this whole directive is about.
    if evaluated != declared:
        out(f"  ⛔ {declared - evaluated} declared mutation(s) were NEVER EVALUATED")
        failed += 1
    out(f"TOTALS mutation_harness_contract {'PASS' if not failed else 'FAIL'} "
        f"declared={declared} evaluated={evaluated} failed={failed}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(run())
