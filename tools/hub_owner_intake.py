"""Owner-run intake — turn Patrick's trace + marked-up owner-run.md into box 1 and box 2 verdicts.

⛔⛔ IT DECIDES NOTHING THE ANALYSER ALREADY DECIDED. Every gesture's bucket comes from
`hub_trace_analyze.analyse()`; this file never re-classifies a flick, never re-reads a threshold,
never compares an angle. A second authority over "was that a flick?" would agree with the analyser
right up to the moment they disagreed — which is the only moment anyone would be reading this
(`lesson_a_second_authority_over_one_value`). What it adds is the mapping from a run to the two
LAUNCHED boxes, which is arithmetic and bookkeeping, not judgement.

⛔ AND IT NEVER INVENTS A RESULT. A row the owner left unmarked is UNMARKED — not a pass, not a
fail. `closure.md`'s own rule: a row that has not been asked is neither a PASS nor an
INCONCLUSIVE, and "absence recorded as a pass" is the failure this programme has refused four
times. An unmarked row blocks box 2 and says so by name.

Usage
-----
    python tools/hub_owner_intake.py trace-15pro.json docs/plans/joystick/owner-run.md
    python tools/hub_owner_intake.py --self-check

Exit codes — and they are three different facts:
    0  BOTH BOXES TICKABLE   box 1 resolved and box 2 all-clear.
    1  A RULING IS NEEDED    something FAILED, or box 1 did not resolve. Named, never summarised.
    2  UNUSABLE INPUT        unreadable trace, no marks at all, a capture that lost rows.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import hub_trace_analyze as hta  # noqa: E402  (path set above, deliberately)

# The §A protocol, in the order owner-run.md prints it. ⛔ Verified against the real parser on
# 2026-09-13: this expands to 25 entries and `--control 5` cuts at index 20, so the control block
# is exactly the A6 press block. Changing either list without re-running that check slides every
# later label by one.
SECTION_A_EXPECT = [
    "journal.close:4", "journal.moveStop:4", "journal.breakeven:4",
    "journal.planTrade:4", "scan.alert:4",
    "journal.close:1", "journal.moveStop:1", "journal.breakeven:1",
    "journal.planTrade:1", "scan.alert:1",
]
SECTION_A_CONTROL = 5

# A marked row: `| A1 | … | ☑ PASS ☐ FAIL |` or a struck box, or a written word.
# ⚠️ A ROW ID MAY CARRY A QUALIFYING SUFFIX (`D1-eye`). Added 2026-09-14, because "D1" named FOUR
# different checks across this programme's docs — the Wire-vs-Journal eye row here, the no-drag-door
# accessibility row in `glass-acceptance-steps.md`, and two more inside completed evidence forms.
# owner-run.md's OWN summary used both senses three lines apart. ⛔ Without the `-suffix` branch this
# regex would not see the renamed row at all, and a row this cannot see is SILENTLY absent from box 2.
ROW_RE = re.compile(r"^\|\s*(?P<id>[A-E]i?\d+[a-z]?(?:-[a-z0-9]+)?)\s*\|(?P<body>.*)\|\s*$", re.M)

# ⚰️ A TICK BINDS TO THE WORD THAT FOLLOWS IT, NEVER THE ONE BEFORE. The first version also
# accepted `\bPASS\b\s*(☑|☒)`, meaning to catch a "PASS ☑" ordering — and in the real cell shape
# `☐ PASS ☑ FAIL` that pattern matched the FAIL tick and read a failed row as a PASS. Every row
# then came back PASS or AMBIGUOUS and the discriminator control is what caught it. The sheet
# writes `☑ PASS ☐ FAIL`, so the tick always precedes its label.
# ⚰️ AND NOT EVERY ROW SAYS "PASS". Row **D1-eye** (G3-16(a)) asks whether the Wire bubble can be
# told from the Journal bubble by sight, and its cell is `☐ DISTINGUISHABLE ☐ CONFUSABLE` —
# deliberately, because "PASS" is a worse word for that question. Until 2026-09-14 this reader knew
# only PASS/FAIL, so a CORRECTLY marked D1-eye read as UNMARKED, box 2 came back NOT TICKABLE naming a
# row the owner had in fact answered, and the freeze did not lift. Measured against the real sheet:
# 26 of 27 rows marked, D1 blocking. The sheet is the authority on its own vocabulary, so the
# READER learns the word — the sheet is not rewritten to suit the tool, least of all mid-run while
# the owner may be holding a printed copy.
# ⛔ The tick still binds to the word that FOLLOWS it. In `☐ DISTINGUISHABLE ☑ CONFUSABLE` the
# tick precedes CONFUSABLE and this reads FAIL, which is the whole point of that ordering rule.
_PASS_WORDS = r"PASS|DISTINGUISHABLE"
_FAIL_WORDS = r"FAIL|CONFUSABLE"
PASS_RE = re.compile(rf"(☑|☒|\[x\])\s*({_PASS_WORDS})|\*\*({_PASS_WORDS})\*\*", re.I)
FAIL_RE = re.compile(rf"(☑|☒|\[x\])\s*({_FAIL_WORDS})|\*\*({_FAIL_WORDS})\*\*", re.I)
NA_RE = re.compile(r"\bN/?A\b|not applicable|skipped", re.I)


def say(s: str = "") -> None:
    print(s, flush=True)


# ── reading the marked-up sheet ─────────────────────────────────────────────────────────────────
def read_marks(md_text: str) -> dict[str, str]:
    """row id -> PASS | FAIL | N/A | UNMARKED.

    ⛔ BOTH BOXES TICKED IS NOT A PASS. A row marked `☑ PASS ☑ FAIL` is a mis-mark, and silently
    preferring one would invent the owner's answer. It is reported as AMBIGUOUS and blocks.
    """
    out: dict[str, str] = {}
    for m in ROW_RE.finditer(md_text):
        body = m.group("body")
        # only the LAST cell is the result cell
        cell = body.rsplit("|", 1)[-1] if "|" in body else body
        p, f = bool(PASS_RE.search(cell)), bool(FAIL_RE.search(cell))
        if p and f:
            out[m.group("id")] = "AMBIGUOUS"
        elif p:
            out[m.group("id")] = "PASS"
        elif f:
            out[m.group("id")] = "FAIL"
        elif NA_RE.search(cell):
            out[m.group("id")] = "N/A"
        else:
            out[m.group("id")] = "UNMARKED"
    return out


# ── box 1: G0-1 and D4 ──────────────────────────────────────────────────────────────────────────
def box_one(result: dict, marks: dict[str, str]) -> dict:
    """G0-1 is the TRACE. D4 is row A1 alone. They are not each other.

    ⭐ G0-1's question is not "did the flicks fire" — it is *does a real finger produce a
    down→up pair under FLICK_MS at all*. If most flicks land over the window, the threshold is
    fine as shipped and that is a FINDING, not a failure (`owner-run.md` §A).
    """
    consts = result.get("constants") or {}
    flick_ms = consts.get("FLICK_MS")
    gestures = [g for g in result["gestures"] if not g.get("isControl")]
    controls = [g for g in result["gestures"] if g.get("isControl")]

    timed = [g for g in gestures if isinstance(g.get("elapsed"), (int, float))]
    under = [g for g in timed if flick_ms is not None and g["elapsed"] < flick_ms]

    # D4: row A1 — journal.close, the only flickable:false action. The GUARD bucket is the
    # "opened, correctly, and fired nothing" outcome that row asks for.
    a1 = [g for g in gestures if g.get("expected") == "journal.close"]
    a1_guarded = [g for g in a1 if g.get("bucket") == hta.GUARD]
    a1_fired = [g for g in a1 if g.get("bucket") in (hta.A_FIRED, hta.D_WRONG)]

    return {
        "flickMs": flick_ms,
        "gestures": len(gestures),
        "controls": len(controls),
        "timed": len(timed),
        "underWindow": len(under),
        "a1Total": len(a1),
        "a1Guarded": len(a1_guarded),
        "a1Fired": len(a1_fired),
        "d4Mark": marks.get("A1", "UNMARKED"),
        # ⛔ The trace answers G0-1 only if it MEASURED something. No timed gesture = no answer.
        "g0Resolved": bool(timed),
        "d4Holds": len(a1_fired) == 0 and len(a1) > 0,
    }


# ── box 2: glass acceptance ─────────────────────────────────────────────────────────────────────
BOX2_PREFIXES = ("B", "C", "Ci", "D", "E")


def box_two(marks: dict[str, str]) -> dict:
    rows = {k: v for k, v in marks.items()
            if any(k.startswith(p) for p in BOX2_PREFIXES) and not k.startswith("A")}
    fails = sorted(k for k, v in rows.items() if v == "FAIL")
    ambiguous = sorted(k for k, v in rows.items() if v == "AMBIGUOUS")
    unmarked = sorted(k for k, v in rows.items() if v == "UNMARKED")
    ok = sorted(k for k, v in rows.items() if v in ("PASS", "N/A"))
    return {
        "rows": len(rows), "ok": ok, "fails": fails,
        "ambiguous": ambiguous, "unmarked": unmarked,
        "tickable": not fails and not ambiguous and not unmarked and bool(rows),
    }


# ── the §4 stage-2 note ─────────────────────────────────────────────────────────────────────────
def stage_note(b1: dict, b2: dict, control_ok: bool = True) -> str:
    # ⛔ control_ok FIRST: a run whose control block drifted cannot tick anything, however clean
    # the rest reads. Until 2026-09-14 a MISSING control block printed a warning and still returned
    # 0 — the freeze would have lifted on a trace that never demonstrated the instrument could tell
    # a press from a flick. `lesson_gate_that_cannot_fail`, in the one place it mattered most.
    if not (control_ok and b1["g0Resolved"] and b1["d4Holds"] and b2["tickable"]):
        return ("⛔ NOT YET. Boxes 1 and 2 are not both ticked on evidence, so the stage-2 PR "
                "stays unopened — the freeze is not lifted by a partial result.")
    return (
        "✅ **Boxes 1 and 2 are ticked on evidence** (this intake). The §4 freeze is lifted: the "
        "stage-2 branch may now be opened as a PR **for Patrick to merge** — a member-facing "
        "rollout is not an agent's call. Then `rollout.md` §3 b–f in order.\n"
        f"- Box 1: {b1['underWindow']}/{b1['timed']} timed flicks landed under "
        f"FLICK_MS={b1['flickMs']}ms; A1 (`journal.close`) fired {b1['a1Fired']} of {b1['a1Total']}.\n"
        f"- Box 2: {len(b2['ok'])} rows PASS or N/A, 0 FAIL, 0 unmarked."
    )


def report(trace_path: str, run_md: str | None) -> int:
    try:
        payload = hta.load(trace_path)
    except Exception as e:  # noqa: BLE001 — an unreadable capture is a fact, not a crash
        say(f"⛔ UNUSABLE — could not read the trace: {e}")
        return 2

    expect = hta.expectations(SECTION_A_EXPECT)
    result = hta.analyse(payload, expect, SECTION_A_CONTROL)

    win = result.get("window") or {}
    if win.get("dropped"):
        say(f"⛔ UNUSABLE — the capture OVERFLOWED and lost {win['dropped']} rows. A tool that "
            "averages over a partial capture invents a result.")
        return 2

    marks: dict[str, str] = {}
    if run_md:
        marks = read_marks(pathlib.Path(run_md).read_text(encoding="utf-8"))
        if not marks:
            say("⛔ UNUSABLE — no result rows found in the marked-up sheet. Either the file is the "
                "wrong one or its table shape changed; either way nothing below could be trusted.")
            return 2

    # ── the control block FIRST, because it decides whether anything else means anything ───────
    say("═══ CONTROL BLOCK — can the instrument tell a press from a flick? ═══")
    controls = [g for g in result["gestures"] if g.get("isControl")]
    say(f"  declared controls : {len(controls)} (expected {SECTION_A_CONTROL})")
    for g in controls:
        say(f"    seq {g.get('seq')}: {g.get('bucket')} — {g.get('why')}")
    control_ok = len(controls) == SECTION_A_CONTROL
    if not control_ok:
        say("  ⚠️ the control count does not match the protocol — the --expect list and what was "
            "actually performed have drifted, and every label after the drift is suspect.")
        say("  ⛔ THIS ALONE WITHHOLDS BOTH BOXES. The control block is what shows the instrument can "
            "tell a deliberate press from a flick; without it, every A-row label is unverified and a "
            "tick would rest on an instrument nobody proved could return the other answer.")

    b1 = box_one(result, marks)
    b2 = box_two(marks)

    say("")
    say("═══ BOX 1 — G0-1 (the trace) and D4 (row A1) ═══")
    say(f"  FLICK_MS (from the DEPLOYED build) : {b1['flickMs']}")
    say(f"  flick gestures / timed             : {b1['gestures']} / {b1['timed']}")
    say(f"  landed UNDER the window            : {b1['underWindow']}")
    say(f"  A1 journal.close: guarded {b1['a1Guarded']} / fired {b1['a1Fired']} of {b1['a1Total']}")
    say(f"  owner's own A1 mark                : {b1['d4Mark']}")
    if not b1["g0Resolved"]:
        say("  ⛔ G0-1 UNRESOLVED — no gesture carried an elapsed time, so nothing was measured.")
    elif b1["underWindow"] == 0:
        say("  ⭐ G0-1 RESOLVED as a FINDING: no real flick landed under the window, so a flick on "
            "glass is simply slower than FLICK_MS and the threshold is fine as shipped.")
    else:
        say(f"  ⭐ G0-1 RESOLVED: {b1['underWindow']} of {b1['timed']} landed under the window.")
    say("  " + ("✅ D4 HOLDS — journal.close never fired." if b1["d4Holds"]
               else "⛔ D4 FAILS — journal.close fired; a fast tap reached a destructive action."))

    say("")
    say("═══ BOX 2 — glass acceptance (§B / §C / §C-iOS / §D / §E) ═══")
    say(f"  rows seen: {b2['rows']}  ·  PASS or N/A: {len(b2['ok'])}")
    for label, key in (("FAIL", "fails"), ("AMBIGUOUS", "ambiguous"), ("UNMARKED", "unmarked")):
        if b2[key]:
            say(f"  ⛔ {label}: {', '.join(b2[key])}")
    say("  " + ("✅ TICKABLE." if b2["tickable"]
               else "⛔ NOT TICKABLE — every row above needs a mark or a ruling."))

    say("")
    say("═══ §4 STAGE-2 NOTE (draft) ═══")
    say(stage_note(b1, b2, control_ok))

    return 0 if (control_ok and b1["g0Resolved"] and b1["d4Holds"] and b2["tickable"]) else 1


# ── self-check ──────────────────────────────────────────────────────────────────────────────────
def _synthetic_trace(close_fires: bool) -> dict:
    """A capture in the shape `gestureTracePayload()` emits, 25 gestures in protocol order."""
    rows, seq = [], 0

    # ⚰️ THE FIXTURE SPEAKS THE ANALYSER'S ROW VOCABULARY, COPIED FROM ITS OWN SELF-CHECK
    # (`hub_trace_analyze.self_check`), not invented here. Two errors were made getting to this:
    # `phase` instead of `type` (so `gestures()` grouped NOTHING and every list came back empty),
    # and `target` as a STRING where `classify()` reads `target.get("id")` (an AttributeError).
    # ⛔ A fixture in a shape the product never emits tests nothing about the product.
    def gesture(action, elapsed, decision):
        nonlocal seq
        seq += 1
        rows.append({"seq": seq, "type": "pointerdown", "pointerType": "touch",
                     "x": 300, "y": 700})
        seq += 1
        rows.append({"seq": seq, "type": "pointerup", "pointerType": "touch",
                     "decision": decision, "target": {"id": action, "angle": 135},
                     "elapsed": elapsed, "flickMs": 120,
                     "travelled": 70, "openThreshold": 40,
                     "sinceDownEventTs": elapsed, "sinceDownPerfNow": elapsed,
                     "coalesced": 1, "phase": "pushing", "x": 340, "y": 700})

    order = ["journal.close", "journal.moveStop", "journal.breakeven", "journal.planTrade",
             "scan.alert"]
    for act in order:
        for _ in range(4):
            if act == "journal.close":
                gesture(act, 70, "flick-fire" if close_fires else "flick-open")
            else:
                gesture(act, 70, "flick-fire")
    for act in order:  # the A6 control block: deliberate presses
        gesture(act, 520, "press-fire")

    # ⛔ THE ENVELOPE MARKER IS REQUIRED. `load()` refuses any payload whose `trace` field is not
    # `uct-joystick-g0` — the guard that stops an excerpt or the wrong file being analysed as if it
    # were a capture. A fixture that omits it is refused too, correctly, which is how this was found.
    return {"trace": "uct-joystick-g0",
            "capturedAt": "2026-01-01T00:00:00Z",
            "device": {"ua": "synthetic", "dpr": 3},
            "constants": {"FLICK_MS": 120, "TRAVEL_PX": 24},
            "window": {"capacity": 400, "recorded": len(rows), "kept": len(rows), "dropped": 0,
                       "firstSeq": 1, "lastSeq": seq},
            "rows": rows}


def _synthetic_md(all_pass: bool) -> str:
    cell = "☑ PASS ☐ FAIL" if all_pass else "☐ PASS ☑ FAIL"
    lines = ["| # | Row | Do this | What should happen | Result |", "|---|---|---|---|---|"]
    lines.append(f"| A1 | G0 | flick close | nothing fires | {cell} |")
    for rid in ("B1", "B2", "C1", "Ci1", "D1", "E1"):
        lines.append(f"| {rid} | x | do it | it happens | {cell} |")
    return "\n".join(lines)


def self_check() -> int:
    fails: list[str] = []

    # 1. the protocol expands the way the analyser parses it — the arithmetic §A depends on.
    exp = hta.expectations(SECTION_A_EXPECT)
    if len(exp) != 25:
        fails.append(f"§A expands to {len(exp)}, expected 25")
    cut = max(0, len(exp) - SECTION_A_CONTROL)
    if exp[cut:] != ["journal.close", "journal.moveStop", "journal.breakeven",
                     "journal.planTrade", "scan.alert"]:
        fails.append("the control block is not the A6 press order")

    # 2. THE PASS SHAPE.
    res = hta.analyse(_synthetic_trace(close_fires=False), exp, SECTION_A_CONTROL)
    marks = read_marks(_synthetic_md(all_pass=True))
    b1, b2 = box_one(res, marks), box_two(marks)
    if not b1["d4Holds"]:
        fails.append("pass shape: D4 should hold when journal.close never fires")
    if not b2["tickable"]:
        fails.append(f"pass shape: box 2 should be tickable, got {b2}")
    if b1["controls"] != SECTION_A_CONTROL:
        fails.append(f"pass shape: {b1['controls']} controls, expected {SECTION_A_CONTROL}")

    # 3. THE FAIL SHAPE — and it must fail for the RIGHT reason, in both halves independently.
    res_f = hta.analyse(_synthetic_trace(close_fires=True), exp, SECTION_A_CONTROL)
    b1_f = box_one(res_f, read_marks(_synthetic_md(all_pass=True)))
    if b1_f["d4Holds"]:
        fails.append("fail shape: D4 must NOT hold when journal.close fires")
    b2_f = box_two(read_marks(_synthetic_md(all_pass=False)))
    if b2_f["tickable"]:
        fails.append("fail shape: box 2 must not be tickable with a FAIL row")
    if "B1" not in b2_f["fails"]:
        fails.append(f"fail shape: B1 should be named among failures, got {b2_f['fails']}")

    # 4. ⛔ AN UNMARKED ROW IS NOT A PASS — the rule this whole file exists to honour.
    md_missing = _synthetic_md(all_pass=True).replace("| B2 | x | do it | it happens | ☑ PASS ☐ FAIL |",
                                                      "| B2 | x | do it | it happens |  |")
    b2_u = box_two(read_marks(md_missing))
    if b2_u["tickable"] or "B2" not in b2_u["unmarked"]:
        fails.append(f"an UNMARKED row was treated as a pass: {b2_u}")

    # 5. both boxes ticked on one row is AMBIGUOUS, never silently a pass.
    md_amb = _synthetic_md(all_pass=True).replace("| C1 | x | do it | it happens | ☑ PASS ☐ FAIL |",
                                                  "| C1 | x | do it | it happens | ☑ PASS ☑ FAIL |")
    b2_a = box_two(read_marks(md_amb))
    if "C1" not in b2_a["ambiguous"]:
        fails.append(f"a double-marked row was not flagged AMBIGUOUS: {b2_a}")

    # 5b. ⛔ D1's OWN VOCABULARY. Without this the sheet's `☐ DISTINGUISHABLE ☐ CONFUSABLE` cell
    # reads UNMARKED on a correctly marked run and the freeze never lifts.
    d1_pass = read_marks("| D1-eye | G3-16(a) | look | tell them apart | ☑ DISTINGUISHABLE ☐ CONFUSABLE |")
    if d1_pass.get("D1-eye") != "PASS":
        fails.append(f"a ticked DISTINGUISHABLE did not read PASS: {d1_pass}")
    d1_fail = read_marks("| D1-eye | G3-16(a) | look | tell them apart | ☐ DISTINGUISHABLE ☑ CONFUSABLE |")
    if d1_fail.get("D1-eye") != "FAIL":
        fails.append(f"a ticked CONFUSABLE did not read FAIL: {d1_fail}")
    d1_blank = read_marks("| D1-eye | G3-16(a) | look | tell them apart | ☐ DISTINGUISHABLE ☐ CONFUSABLE |")
    if d1_blank.get("D1-eye") != "UNMARKED":
        fails.append(f"an unticked D1 must stay UNMARKED, got {d1_blank}")

    # 5c. ⛔ A MISSING CONTROL BLOCK WITHHOLDS THE BOXES.
    if stage_note({"g0Resolved": True, "d4Holds": True, "flickMs": 120, "underWindow": 20,
                   "timed": 20, "a1Fired": 0, "a1Total": 4},
                  {"tickable": True, "ok": []}, control_ok=False).startswith("✅"):
        fails.append("a drifted control block still lifted the freeze")
    if not stage_note({"g0Resolved": True, "d4Holds": True, "flickMs": 120, "underWindow": 20,
                       "timed": 20, "a1Fired": 0, "a1Total": 4},
                      {"tickable": True, "ok": []}, control_ok=True).startswith("✅"):
        fails.append("control-ok case must still be able to lift the freeze")

    # 6. the mark reader DISCRIMINATES — otherwise every case above passes for one reason.
    seen = set(read_marks(_synthetic_md(all_pass=True)).values()) | \
        set(read_marks(_synthetic_md(all_pass=False)).values())
    if seen != {"PASS", "FAIL"}:
        fails.append(f"the mark reader does not discriminate: {seen}")

    if fails:
        say("⛔ SELF-CHECK FAILED:\n  " + "\n  ".join(fails))
        return 1
    say("SELF-CHECK PASS — §A expands to 25 with the control block last; the pass shape ticks both "
        "boxes; the fail shape fails in each half independently; an UNMARKED row is never a pass; "
        "a double-marked row is AMBIGUOUS; and the mark reader tells PASS from FAIL.")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("trace", nargs="?", help="the pasted trace JSON")
    ap.add_argument("run", nargs="?", help="the marked-up owner-run.md")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()
    if not args.trace:
        ap.error("give a trace file and the marked-up owner-run.md, or --self-check")
    return report(args.trace, args.run)


if __name__ == "__main__":
    raise SystemExit(main())
