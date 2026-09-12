"""G0-1 — read a pasted gesture trace and say WHY each flick ended where it did.

The owner runs the phone script in `docs/plans/joystick/g0-flick-trace-plan.md`, presses
"Copy trace", and pastes the JSON back. This turns that JSON into one table and one verdict
per hypothesis — the same (a)-(d) classification the sticky-fan question was settled with:

    (a) FIRED THE INTENDED ACTION     the flick did what the thumb asked
    (b) FLICK WINDOW MISSED           the flick branch was not taken — reports `elapsed` vs
                                      FLICK_MS, or `travelled` vs the open threshold when travel is
                                      the bar that was not cleared. ⚠️ The OUTCOME of a missed
                                      window is not always "the fan opened": a `press-fire` release
                                      still fires the action as a deliberate press, and the row says
                                      which happened. Naming the bucket after the CAUSE keeps the
                                      five control drags — which are meant to land here — legible.
    (c) NO ENGINE TRANSITION          the pointer never reached the engine — reports the first
                                      event actually seen for that gesture
    (d) FIRED A DIFFERENT ACTION      an angle/resolution error — reports the angle measured and
                                      the action it landed on versus the one expected

⛔ IT DERIVES NOTHING THE ENGINE ALREADY DECIDED. `decision` and `target` are read from the row
the gesture engine itself wrote (`useJoystick.js::withTrace`); this tool never re-computes whether
something "was" a flick, never compares an angle against a wedge centre of its own. A second
authority over that question would agree with the engine right up to the moment they disagreed —
which is the only moment anyone would be reading this (`lesson_a_second_authority_over_one_value`).
What it adds is arithmetic the engine has no reason to do: distributions, the three-clock
comparison, and the diff between two devices.

⛔ INTENT IS DECLARED, NEVER GUESSED. Which bubble the owner was aiming at is not in the trace, so
it is passed in with `--expect` in the order the script runs. Without it the tool still reports
every decision, and says plainly that it cannot classify (a) against (d) — an absence, not a blank.

Usage
-----
    python tools/hub_trace_analyze.py trace-15pro.json \
        --expect scan.chartIt:10 --expect scan.flag:10 --expect scan.chartIt:5

    python tools/hub_trace_analyze.py -            # read the JSON from stdin
    python tools/hub_trace_analyze.py a.json --compare b.json     # SE vs 15 Pro, side by side
    python tools/hub_trace_analyze.py --self-check                # prove the classifier can fail

Exit codes — and 2 is not a failure of the product:
    0  ANALYSED       the trace was readable and every gesture was classified.
    2  UNREADABLE     empty buffer, wrong payload, no touch pointers, or a buffer that overflowed
                      and lost the beginning of the session. ⛔ NOT a device result. A capture that
                      lost rows is a failed capture, and a tool that averages over it invents one.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter

# The decision vocabulary `useJoystick.js` writes. Kept as prefixes/members, never re-derived.
FLICK_FIRE = "flick-fire"
FLICK_OPEN = "flick-open"          # a flickable:false action — the D4 guard doing its job
FLICK_NONE = "flick-none-"         # flick direction matched no outer action
PRESS = "press-"                   # the flick branch was not taken: handled as a deliberate press
NO_PUSH = ("tap-pending", "double-tap", "home")
SCRUB = "scrub-commit"

# The buckets this tool reports. ⭐ `flick-open` is its OWN bucket and not folded into (b): on an
# action declaring `flickable: false` it is the CORRECT outcome, and counting a working guard as a
# missed flick would manufacture a defect out of the feature under test.
A_FIRED = "a) fired the intended action"
B_MISSED = "b) flick window missed — taken as a deliberate press"
C_NO_ENGINE = "c) no engine transition"
D_WRONG = "d) fired a different action"
GUARD = "guard) flickable:false — opened, correctly, and fired nothing"
OTHER = "other) not a flick attempt"
UNKNOWN_INTENT = "?) intent not declared"


def say(text: str, err: bool = False) -> None:
    """One place for console writes — a cp1252 console must not kill a finished analysis."""
    stream = sys.stderr if err else sys.stdout
    data = (text + "\n").encode("utf-8", "replace")
    buf = getattr(stream, "buffer", None)
    if buf is not None:
        buf.write(data)
        buf.flush()
    else:
        stream.write(data.decode("utf-8", "replace"))
        stream.flush()


def load(path: str) -> dict:
    raw = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    payload = json.loads(raw)
    if payload.get("trace") != "uct-joystick-g0":
        raise ValueError(
            f"not a joystick G0 trace (trace={payload.get('trace')!r}) — paste the whole JSON "
            f'the "Copy trace" button produced, not an excerpt'
        )
    return payload


def gestures(rows: list[dict]) -> list[dict]:
    """Split the flat event stream into gestures.

    A gesture opens on `pointerdown` and closes on `pointerup`/`pointercancel`. ⛔ Rows before the
    first `pointerdown` are kept as an ORPHAN gesture rather than dropped: a capture that begins
    mid-gesture is exactly the ring-buffer overflow the payload's `dropped` count warns about, and
    silently discarding those rows would hide it.
    """
    out: list[dict] = []
    cur: dict | None = None
    for r in rows:
        t = r.get("type")
        if t == "pointerdown":
            if cur is not None:
                cur["unterminated"] = True
                out.append(cur)
            cur = {"rows": [r], "down": r, "end": None, "unterminated": False, "orphan": False}
            continue
        if cur is None:
            cur = {"rows": [], "down": None, "end": None, "unterminated": False, "orphan": True}
        cur["rows"].append(r)
        if t in ("pointerup", "pointercancel"):
            cur["end"] = r
            out.append(cur)
            cur = None
    if cur is not None:
        cur["unterminated"] = True
        out.append(cur)
    return out


def classify(g: dict, expected: str | None) -> tuple[str, str]:
    """(bucket, the one measured number that explains it). Never a verdict of its own invention."""
    end = g["end"]
    if end is None or end.get("type") == "pointercancel" or g["down"] is None or g["orphan"]:
        first = (g["rows"][0].get("type") if g["rows"] else None) or "nothing"
        if end is not None and end.get("type") == "pointercancel":
            return C_NO_ENGINE, f"pointercancel at phase={end.get('phase')!r}; first event {first}"
        return C_NO_ENGINE, f"no pointerup; first event seen: {first}"

    decision = end.get("decision")
    target = end.get("target") or {}
    tid = target.get("id")
    elapsed, flick_ms = end.get("elapsed"), end.get("flickMs")
    travelled, open_at = end.get("travelled"), end.get("openThreshold")

    if decision == FLICK_OPEN:
        return GUARD, f"target {tid} declares flickable:false; elapsed {elapsed}ms < {flick_ms}ms"

    if decision == FLICK_FIRE:
        if expected is None:
            return UNKNOWN_INTENT, f"fired {tid} in {elapsed}ms (no --expect for this gesture)"
        if tid == expected:
            return A_FIRED, f"{elapsed}ms, {travelled}px, angle {target.get('angle')}"
        return D_WRONG, f"expected {expected}, fired {tid} at angle {target.get('angle')} (ring {target.get('ring')})"

    if decision and decision.startswith(FLICK_NONE):
        return D_WRONG, f"flick matched no outer action ({decision}); expected {expected or 'n/a'}"

    if decision and decision.startswith(PRESS):
        over = None
        if isinstance(elapsed, (int, float)) and isinstance(flick_ms, (int, float)):
            over = elapsed - flick_ms
        tail = f"elapsed {elapsed}ms vs FLICK_MS {flick_ms}ms"
        if over is not None:
            tail += f" (+{over:g}ms over)" if over >= 0 else f" ({over:g}ms under — travel, not time)"
        if tid and expected and tid == expected and decision == "press-fire":
            tail += f" — it still fired {tid}, as a deliberate press"
        return B_MISSED, tail

    if decision in NO_PUSH:
        return B_MISSED, f"{decision}: travelled {travelled}px vs openThreshold {open_at}px"

    if decision == SCRUB:
        return OTHER, f"scrub commit after {elapsed}ms"

    return OTHER, f"decision={decision!r}"


def expectations(specs: list[str]) -> list[str]:
    """`--expect scan.chartIt:10` → ten entries. Order is the order the phone script runs."""
    out: list[str] = []
    for spec in specs:
        name, _, count = spec.partition(":")
        n = int(count) if count else 1
        if n < 1:
            raise ValueError(f"--expect {spec}: count must be >= 1")
        out.extend([name.strip()] * n)
    return out


def analyse(payload: dict, expect: list[str]) -> dict:
    rows = payload.get("rows") or []
    win = payload.get("window") or {}
    consts = payload.get("constants") or {}
    gs = gestures(rows)

    # ⛔ Only gestures that reached a release are matched against the declared intent, in order.
    # Pairing by position would otherwise slide by one every time the phone dropped a gesture, and
    # every later row would be mis-labelled with total confidence.
    attempts = [g for g in gs if g["end"] is not None and g["end"].get("type") == "pointerup"]
    # ⛔ Keyed by IDENTITY, not equality: two gestures with identical contents are two gestures, and
    # `list.index` on a dict would hand the second one the first one's expectation.
    order = {id(g): i for i, g in enumerate(attempts)}
    results = []
    for g in gs:
        idx = order.get(id(g))
        exp = expect[idx] if idx is not None and idx < len(expect) else None
        bucket, why = classify(g, exp)
        end = g["end"] or {}
        results.append({
            "seq": (g["down"] or (g["rows"][0] if g["rows"] else {})).get("seq"),
            "expected": exp,
            "bucket": bucket,
            "why": why,
            "decision": end.get("decision"),
            "elapsed": end.get("elapsed"),
            "travelled": end.get("travelled"),
            "sinceDownEventTs": end.get("sinceDownEventTs"),
            "sinceDownPerfNow": end.get("sinceDownPerfNow"),
            "coalesced": max([r.get("coalesced") or 0 for r in g["rows"]] or [0]),
            "pointerType": (g["down"] or {}).get("pointerType"),
            "target": (end.get("target") or {}).get("id"),
        })
    return {
        "device": payload.get("device") or {},
        "constants": consts,
        "window": win,
        "capturedAt": payload.get("capturedAt"),
        "gestures": results,
    }


def nums(values) -> list[float]:
    return [v for v in values if isinstance(v, (int, float))]


def readable(a: dict) -> tuple[bool, list[str]]:
    """⛔ Non-vacuity FIRST. An unreadable capture is not a device result."""
    problems = []
    win = a["window"]
    if not a["gestures"]:
        problems.append("the buffer holds no gestures at all")
    if win.get("dropped"):
        problems.append(
            f"the ring buffer OVERFLOWED and lost {win['dropped']} events "
            f"(kept {win.get('kept')} of {win.get('recorded')}) — the beginning of the session is gone"
        )
    kinds = {g["pointerType"] for g in a["gestures"] if g["pointerType"]}
    if kinds and "touch" not in kinds:
        problems.append(f"no touch pointers in this capture (saw {sorted(kinds)}) — not a finger on glass")
    return (not problems), problems


def report(a: dict, label: str) -> None:
    dev = a["device"]
    consts = a["constants"]
    say(f"\n═══ {label} ═══")
    say(f"  captured {a['capturedAt']}  ·  {dev.get('innerWidth')}×{dev.get('innerHeight')} css px "
        f"@ dpr {dev.get('devicePixelRatio')}  ·  maxTouchPoints {dev.get('maxTouchPoints')}")
    say(f"  UA: {(dev.get('userAgent') or '')[:110]}")
    say(f"  build constants: FLICK_MS={consts.get('FLICK_MS')} TRAVEL_PX={consts.get('TRAVEL_PX')} "
        f"OPEN_AT_RATIO={consts.get('OPEN_AT_RATIO')}")
    win = a["window"]
    say(f"  window: recorded {win.get('recorded')} · kept {win.get('kept')} · dropped {win.get('dropped')} "
        f"· seq {win.get('firstSeq')}–{win.get('lastSeq')}")

    ok, problems = readable(a)
    if not ok:
        say("\n  ⛔ UNREADABLE — nothing below would mean anything:")
        for p in problems:
            say(f"     · {p}")
        return

    say("\n  seq   expected            bucket                                       why")
    say("  " + "─" * 104)
    for g in a["gestures"]:
        say(f"  {str(g['seq'] or '?'):<5} {str(g['expected'] or '—'):<19} {g['bucket']:<44} {g['why']}")

    buckets = Counter(g["bucket"] for g in a["gestures"])
    say("\n  counts")
    for b, n in buckets.most_common():
        say(f"    {n:>3}  {b}")

    # ── The verdicts. One line per hypothesis, each naming the number it rests on. ──────────────
    flick_ms = consts.get("FLICK_MS")
    elapsed = nums(g["elapsed"] for g in a["gestures"] if g["bucket"] in (A_FIRED, B_MISSED, D_WRONG, GUARD))
    travelled = nums(g["travelled"] for g in a["gestures"])
    ev = nums(g["sinceDownEventTs"] for g in a["gestures"])
    pn = nums(g["sinceDownPerfNow"] for g in a["gestures"])
    coalesced = nums(g["coalesced"] for g in a["gestures"])

    say("\n  verdicts")
    if elapsed and isinstance(flick_ms, (int, float)):
        med, mx = statistics.median(elapsed), max(elapsed)
        over = sum(1 for e in elapsed if e >= flick_ms)
        say(f"    A  timing   : median elapsed {med:g}ms, max {mx:g}ms, {over}/{len(elapsed)} at or over "
            f"FLICK_MS {flick_ms}ms → " + ("**A IS LIVE**" if over else "not implicated"))
    else:
        say("    A  timing   : no elapsed values — cannot say")
    if elapsed and ev and pn:
        say(f"    A′ delivery : median elapsed {statistics.median(elapsed):g}ms vs sinceDownPerfNow "
            f"{statistics.median(pn):g}ms vs sinceDownEventTs {statistics.median(ev):g}ms; "
            f"max coalesced {int(max(coalesced)) if coalesced else 0}")
        say("               ⭐ elapsed and perfNow large while eventTs is small = the events were "
            "DELIVERED late, and the fix is what elapsed is measured FROM, not what it is compared against.")
    if travelled:
        say(f"    B  travel   : median travelled {statistics.median(travelled):g}px, min {min(travelled):g}px")
    else:
        say("    B  travel   : no travel values — cannot say")
    wrong = buckets.get(D_WRONG, 0)
    say(f"    C  geometry : {wrong} gesture(s) resolved onto an action other than the expected one → "
        + ("**C IS LIVE**" if wrong else "not implicated"))
    if buckets.get(C_NO_ENGINE):
        say(f"    D  delivery : {buckets[C_NO_ENGINE]} gesture(s) never reached a release — the pointer "
            "did not complete in the engine at all")
    if buckets.get(UNKNOWN_INTENT):
        say(f"    ?  intent   : {buckets[UNKNOWN_INTENT]} gesture(s) had no --expect, so (a) vs (d) is "
            "UNDECIDED for them — pass --expect to settle it rather than reading the fired id as intent")


def self_check() -> int:
    """⛔ Prove the classifier can fail, and that each bucket is reachable and distinguishable."""
    def row(**kw):
        base = dict(type="pointerup", seq=2, decision=None, elapsed=80, flickMs=120, travelled=70,
                    openThreshold=40, target=None, pointerType="touch", sinceDownEventTs=80,
                    sinceDownPerfNow=80, coalesced=1, phase="pushing")
        base.update(kw)
        return base

    def gesture(end):
        return {"rows": [dict(type="pointerdown", seq=1, pointerType="touch"), end],
                "down": dict(type="pointerdown", seq=1, pointerType="touch"),
                "end": end, "unterminated": False, "orphan": False}

    cases = [
        ("fired the intended one", gesture(row(decision=FLICK_FIRE, target={"id": "scan.flag", "angle": 135})),
         "scan.flag", A_FIRED),
        ("fired a DIFFERENT one", gesture(row(decision=FLICK_FIRE, target={"id": "scan.alert", "angle": 101})),
         "scan.flag", D_WRONG),
        ("missed the flick window", gesture(row(decision="press-fire", elapsed=190,
                                                target={"id": "scan.flag"})), "scan.flag", B_MISSED),
        ("never travelled", gesture(row(decision="tap-pending", travelled=6)), "scan.flag", B_MISSED),
        ("the flickable:false guard", gesture(row(decision=FLICK_OPEN, target={"id": "journal.close"})),
         "journal.close", GUARD),
        ("never reached the engine", {"rows": [dict(type="pointerdown", seq=1)], "down": dict(type="pointerdown", seq=1),
                                      "end": None, "unterminated": True, "orphan": False}, "scan.flag", C_NO_ENGINE),
    ]
    fails = []
    for name, g, exp, want in cases:
        got, why = classify(g, exp)
        if got != want:
            fails.append(f"{name}: expected {want!r}, got {got!r}")
        if not why:
            fails.append(f"{name}: classified with no measured reason attached")

    # The control that makes the above non-vacuous: the SAME row, with intent withheld, must NOT
    # be reported as a success. Reading the fired id as the intent is the whole error this guards.
    got, _ = classify(cases[0][1], None)
    if got != UNKNOWN_INTENT:
        fails.append(f"no --expect must be UNDECIDED, got {got!r}")

    # A capture that lost rows must be refused rather than averaged.
    lost = {"device": {}, "constants": {}, "window": {"dropped": 7, "kept": 500, "recorded": 507},
            "capturedAt": None, "gestures": [{"pointerType": "touch", "bucket": A_FIRED}]}
    if readable(lost)[0]:
        fails.append("an overflowed buffer was accepted as readable")
    healthy = {"device": {}, "constants": {}, "window": {"dropped": 0, "kept": 12, "recorded": 12},
               "capturedAt": None, "gestures": [{"pointerType": "touch", "bucket": A_FIRED}]}
    if not readable(healthy)[0]:
        fails.append("a healthy capture was refused — the readable() gate cries wolf")

    # `--expect` arithmetic, since a miscount slides every later label by one.
    if expectations(["scan.chartIt:10", "scan.flag:2"]) != ["scan.chartIt"] * 10 + ["scan.flag"] * 2:
        fails.append("--expect expansion is wrong")

    if fails:
        say("SELF-CHECK FAILED:\n  " + "\n  ".join(fails), err=True)
        return 1
    say(f"SELF-CHECK PASS — {len(cases)} buckets each reached by the row that means them, "
        "intent-withheld stays UNDECIDED, an overflowed buffer is refused and a healthy one is not.")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("trace", nargs="?", help="the pasted JSON file, or - for stdin")
    ap.add_argument("--expect", action="append", default=[],
                    help="intended action id, optionally :count — in the order the script runs "
                         "(e.g. --expect scan.chartIt:10)")
    ap.add_argument("--compare", help="a second trace (the other device) to print beside the first")
    ap.add_argument("--self-check", action="store_true", help="prove the classifier can fail")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()
    if not args.trace:
        ap.error("give a trace file (or - for stdin), or --self-check")

    expect = expectations(args.expect)
    first = analyse(load(args.trace), expect)
    report(first, args.trace)
    ok = readable(first)[0]

    if args.compare:
        second = analyse(load(args.compare), expect)
        report(second, args.compare)
        ok = ok and readable(second)[0]
        say("\n═══ diff — stop at the FIRST line that differs; everything after it is downstream ═══")
        for name, a in ((args.trace, first), (args.compare, second)):
            b = Counter(g["bucket"] for g in a["gestures"])
            e = nums(g["elapsed"] for g in a["gestures"])
            say(f"  {name:<28} decisions {dict(Counter(g['decision'] for g in a['gestures']))}")
            say(f"  {'':<28} median elapsed {statistics.median(e):g}ms" if e else
                f"  {'':<28} median elapsed —")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
