"""D-02 A5/A6 — can the EVIDENCE CONTRACT fail? Six mutations, each with a named red.

⛔⛔ THE CONTRACT IS NOW THE SINGLE THING DECIDING WHAT THE FLIP GATE IS ALLOWED TO JUDGE, which
makes it the highest-leverage place in the programme for a silent defect. `mutation_harness_flipgate`
proves the ROWS can fail; this proves the SELECTOR underneath them can. They are separate harnesses
because they fail for separate reasons: a row that reads a verdict correctly off a set that was
chosen wrongly is exactly the defect D-02 exists to close, and only this harness can see it.

⭐ THE NON-VACUITY CONTROL IS THE ONE TO READ FIRST (`M6`). A contract that refused EVERYTHING would
make every row NOT MEASURABLE — the gate could never lie, and it could also never pass, which is a
gate nobody keeps running. M6 stops `select` ever admitting an artifact and asserts the suite goes
RED, so the green result above it is known to depend on artifacts being genuinely ADMITTED rather
than on universal exclusion.

⛔ SINGLE-LINE ANCHORS ONLY. `core.autocrlf=true` on this box, so a decoded working file carries
"\\r\\n" and any anchor spanning a line break matches NOTHING — silently, which reads as a proved
rail. NOT-APPLIED is therefore a FAILURE here, never a skip.

⛔ RESTORE IS A WRITE-BACK OF CAPTURED BYTES, VERIFIED BY SHA256 — never `git checkout`, which has
already destroyed twenty minutes of unrelated finished work in this repository once
(`feedback_mutation_check_never_git_checkout`).
"""
from __future__ import annotations

import hashlib
import pathlib
import subprocess
import sys
from dataclasses import dataclass

HERE = pathlib.Path(__file__).resolve().parent
CONTRACT = HERE / "evidence_contract.py"
GATE = HERE / "flip_preconditions.py"


def _line_hits(text: str, anchor: str) -> list[int]:
    """Indexes of the lines that ARE this anchor — not the lines that merely contain it.

    ⛔ SUBSTRING COUNTING CANNOT SEE INDENTATION, and indentation is the only thing separating two
    copies of the same guard in different branches. `"    if art.void:"` occurs inside
    `"        if art.void:"`, so a substring count reported three matches for a line that appears
    exactly once — and the harness would have refused a perfectly good anchor. The failure was
    loud here; the same arithmetic in the other direction silently mutates the WRONG branch."""
    return [i for i, l in enumerate(text.split("\n")) if l.rstrip() == anchor]


@dataclass(frozen=True)
class Mutation:
    name: str
    target: pathlib.Path
    old: str
    new: str
    #: What the suite must START saying when this guard is gone. A mutation that turns the suite red
    #: for SOME other reason proves nothing about the guard it removed, so the expected failure is
    #: named and checked rather than inferred from the exit code.
    expect_red_case: str


MUTATIONS = (
    Mutation("M1 a VOID artifact is judged like any other", CONTRACT,
             "    if art.void:", "    if False:",
             "THE VOID ARTIFACT"),
    Mutation("M2 the renderer stops mattering to S2 latency", CONTRACT,
             "    if art.renderer != RENDERER_PRODUCTION:", "    if False:",
             "renderer=fallback"),
    Mutation("M3 an UNLABELLED load model is accepted for delivery", CONTRACT,
             "    if art.model not in MODELS:", "    if False:",
             "no load model"),
    Mutation("M4 a chaos RIG run counts as a real one", CONTRACT,
             '        if not any(m.startswith("real") for m in modes):', "        if False:",
             "A RIG RUN RENAMED"),
    Mutation("M5 an INDEX no longer has to declare itself a 3.5 smoke", GATE,
             '        elif _SMOKE_INDEX_MARK.search(text or ""):', "        elif True:",
             "DIRECTORY NAMED SOMETHING ELSE"),
    Mutation("M6 NON-VACUITY: nothing is ever admitted, so no row can ever be MET", CONTRACT,
             "        if ruling.disposition == ADMIT:", "        if False:",
             "PASS planted"),

    # ── D-03 Part 0.6 · the amended S5 / S5b / S5c ────────────────────────
    Mutation("M7 an UNREACHED refusal is counted as reached", GATE,
             "    elif late:", "    elif False:",
             "did not reach the member"),
    # ⚰️ MY FIRST EXPECTATION FOR THIS ONE WAS WRONG AND THE HARNESS SAID SO: it went RED on a
    # different case. Naming the wrong case is not a smaller error than a green mutation — it is a
    # proof about a guard that was never exercised. Traced: with the floor on `refused`, the
    # design-burst case's 1-of-200 is EXACTLY 0.005 and `>` is false, so that case is untouched;
    # what breaks is the `failed` case, whose 2-of-200 stops being seen at all.
    Mutation("M8 the failure floor is applied to REFUSED instead of FAILED — an honest refusal "
             "becomes a breach and a real failure becomes invisible", GATE,
             '        frac = (sp.get("failed") or 0) / sp["offers"]',
             '        frac = (sp.get("refused_by_admission") or 0) / sp["offers"]',
             "the failure floor bites on `failed`"),
    Mutation("M9 an INFORMATIONAL run is judged after all", CONTRACT,
             "    if art.purpose == PURPOSE_CHARACTERISATION:", "    if False:",
             "reported, not judged"),
    Mutation("M10 the sum check is removed — a receipt that loses requests reads as a quieter "
             "system than the real one", GATE,
             '        if not sp.get("closes"):', "        if False:",
             "do not sum"),
    Mutation("M11 the 3x tier ceiling is read as 10 % instead of 1 %", GATE,
             'S5B_TIERS = {"busiest60s": 0.0, "busiest10s": 0.0, "design": 0.0, "design3x": 0.01}',
             'S5B_TIERS = {"busiest60s": 0.10, "busiest10s": 0.10, "design": 0.10, "design3x": 0.10}',
             "S5b: a refusal AT THE DESIGN BURST"),
)

# ⚰️ AND ONE MUTATION THAT DOES NOT BELONG HERE, RECORDED RATHER THAN QUIETLY DROPPED.
# I wrote an "outcome=busy row is keyed as a refusal again (OI-40 regression)" mutation against this
# gate and it came back **GREEN — NOT CAUGHT**. Traced rather than re-aimed until it went red: the
# gate CONSUMES an already-computed `admission_split`; the outcome keying that OI-40 fixed lives in
# `load_harness.admission_split`. A mutation of the gate can never regress it, so a green here is
# the correct answer to a question asked in the wrong file.
# ⛔ It lives in `mutation_harness_load_model` as M12, where the guard actually is. Moving a
# mutation because it went green is only honest when you can say WHY it could never have gone red.


def _self_check() -> tuple[int, str, str]:
    """Run the gate's own self-check. Returns (exit, totals line, full output).

    ⛔ THE TOTALS LINE IS READ, NOT THE EXIT CODE ALONE. A run that died at argument parsing and a
    run that evaluated 62 cases must never look the same to whoever reads this harness."""
    p = subprocess.run([sys.executable, str(GATE), "--self-check"], cwd=HERE.parents[2],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    totals = [l for l in out.splitlines() if l.startswith("TOTALS flip_preconditions")]
    return p.returncode, (totals[-1] if totals else "NO TOTALS LINE"), out


def _failing_case_lines(out: str) -> list[str]:
    return [l for l in out.splitlines() if l.lstrip().startswith("FAIL ")]


def dry_check(out=print) -> int:
    """The cheap half: do all six anchors still match their source, exactly once?

    ⛔ A stale anchor is the failure this check exists for. It is reported as NOT APPLIED and it is
    a FAILURE — an anchor that matches nothing produces a mutation that was never applied, a run
    that stays green, and a harness that reads as a proof."""
    stale = []
    for m in MUTATIONS:
        try:
            text = m.target.read_text(encoding="utf-8")
        except Exception as e:  # noqa: BLE001
            stale.append(f"{m.name}: cannot read {m.target.name} ({type(e).__name__})")
            continue
        hits = _line_hits(text, m.old)
        if len(hits) != 1:
            stale.append(f"{m.name}: anchor matches {len(hits)} whole line(s) in "
                         f"{m.target.name}, expected exactly 1")
    for s in stale:
        out(f"  NOT APPLIED: {s}")
    if not MUTATIONS:
        stale.append("the mutation set is EMPTY — a harness that mutated nothing proved nothing")
    out(f"TOTALS mutation_harness_contract --dry-check {'PASS' if not stale else 'FAIL'} "
        f"mutations={len(MUTATIONS)} stale={len(stale)}")
    return 0 if not stale else 1


def run(out=print) -> int:
    declared = len(MUTATIONS)
    evaluated = 0
    failed = 0

    originals = {p: p.read_bytes() for p in {m.target for m in MUTATIONS}}
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
            text = originals[m.target].decode("utf-8")
            hits = _line_hits(text, m.old)
            if len(hits) != 1:
                out(f"  {m.name}: ANCHOR MATCHES {len(hits)} LINE(S) — NOT APPLIED = FAIL")
                failed += 1
                evaluated += 1
                continue
            lines = text.split("\n")
            lines[hits[0]] = m.new
            m.target.write_bytes("\n".join(lines).encode("utf-8"))
            rc, totals, mout = _self_check()
            m.target.write_bytes(originals[m.target])
            assert hashlib.sha256(m.target.read_bytes()).hexdigest() == shas[m.target], \
                f"RESTORE FAILED after {m.name}"
            evaluated += 1
            reds = _failing_case_lines(mout)
            named = any(m.expect_red_case in l for l in reds)
            if rc == 0:
                out(f"  {m.name}: GREEN — NOT CAUGHT  {totals}")
                failed += 1
            elif not named:
                # ⛔ RED FOR THE WRONG REASON IS NOT A PROOF. A mutation that breaks the suite
                # somewhere else says nothing about the guard it deleted.
                out(f"  {m.name}: RED but NOT on the named case "
                    f"({m.expect_red_case!r}); {len(reds)} other failure(s)")
                failed += 1
            else:
                out(f"  {m.name}: RED (good) — {sum(m.expect_red_case in l for l in reds)} named "
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


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    # ⛔ FLAGS ARE NOT PATHS — eleven sibling harnesses took `--dry-check` as their repo root and
    # died in the tree guard, which the old gate row then read as success.
    positional = [a for a in argv if not a.startswith("-")]
    root = pathlib.Path(positional[0]).resolve() if positional else HERE.parents[2]
    if "--dry-check" in argv:
        # Plants nothing, mutates nothing, needs no sandbox: the gate calls it from the
        # integrator's tree.
        return dry_check()
    from harness_guard import require_throwaway_worktree  # noqa: E402
    require_throwaway_worktree(root, pathlib.Path(__file__).name)
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
