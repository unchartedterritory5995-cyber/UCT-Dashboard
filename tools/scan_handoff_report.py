"""Classify what the MEMBER SAW, fail-closed, from scan_handoff_out.json.

⛔⛔ MISSING EVIDENCE IS A VERDICT, NOT A PASS. The previous version of this
classifier mapped a null probe onto "nothing drawn yet -> VALID_OLD" and
reported PASS over 360 samples that contained no evidence whatsoever (the probe
read two globals that do not exist in the ChartWidget context). Every required
observation is now checked, and anything missing/unparseable becomes
PROBE_INVALID, which FAILS the run.

Two independent, real signals per sample:
  domSym    the rendered ticker, read from the actual DOM
  chartSym  the symbol the drawn candles belong to, from the newest timing row
            that actually recorded a paint

Classification:
  VALID_OLD                both agree on the PREVIOUS symbol   (handoff holding)
  VALID_NEW_CURRENT        both agree on the requested symbol, paint was current
  VALID_NEW_AUTHORITATIVE  both agree, paint verified with nothing newer
  INVALID_MIXED            domSym != chartSym                  (the forbidden state)
  INVALID_STALE            both on requested, but materially stale + unverified
  INVALID_EMPTY            identity present, nothing drawn
  PROBE_INVALID            a required observation was missing
"""
from __future__ import annotations

import json
import os
import sys

TOLERANCE_BUCKETS = 1


def pct(n, d):
    return 0.0 if not d else round(100.0 * n / d, 1)


def q(v, p):
    return v[min(len(v) - 1, int(p * len(v)))] if v else None


def classify(s, prev_sym):
    """One sample -> one verdict. Fail-closed on every missing field."""
    req = s.get("requested")
    dom = s.get("domSym")
    chart = s.get("chartSym")
    if not req:
        return "PROBE_INVALID", "no requested symbol"
    if dom is None or dom == "":
        return "PROBE_INVALID", "no rendered identity in the DOM"
    if chart is None:
        # Nothing has EVER painted. Only legitimate before the first mount
        # settles; during a scan it means the canvas owns no symbol.
        return "INVALID_EMPTY", "no painted symbol"
    if dom != chart:
        return "INVALID_MIXED", f"dom={dom} chart={chart}"
    # Identity and candles agree. Which symbol are they on?
    if dom == str(req).upper():
        behind = s.get("chartBehind")
        cur = s.get("chartCurrent")
        if cur is True:
            return "VALID_NEW_CURRENT", ""
        if isinstance(behind, (int, float)) and behind <= TOLERANCE_BUCKETS:
            return "VALID_NEW_AUTHORITATIVE", f"{behind} bucket(s), verified"
        return "INVALID_STALE", f"behind={behind} current={cur}"
    if prev_sym and dom == str(prev_sym).upper():
        return "VALID_OLD", ""
    return "INVALID_MIXED", f"showing {dom}, neither requested {req} nor previous {prev_sym}"


def self_test():
    """⛔ THE RAIL FOR THE FAILURE THAT ALREADY HAPPENED. The previous classifier
    turned a null probe into a PASS over 360 empty samples. Each case below is a
    way evidence can go missing; none of them may produce a valid verdict. Run
    with --self-test; the harness runs it before trusting any real verdict."""
    cases = [
        ("the EXACT previous bug: both probe globals null",
         {"requested": "B", "domSym": None, "chartSym": None}, "PROBE_INVALID"),
        ("no rendered identity",
         {"requested": "B", "domSym": None, "chartSym": "B"}, "PROBE_INVALID"),
        ("empty rendered identity string",
         {"requested": "B", "domSym": "", "chartSym": "B"}, "PROBE_INVALID"),
        ("no requested symbol",
         {"requested": None, "domSym": "B", "chartSym": "B"}, "PROBE_INVALID"),
        ("identity present, nothing ever painted",
         {"requested": "B", "domSym": "B", "chartSym": None}, "INVALID_EMPTY"),
        ("B label over A candles",
         {"requested": "B", "domSym": "B", "chartSym": "A"}, "INVALID_MIXED"),
        ("A label over B candles",
         {"requested": "B", "domSym": "A", "chartSym": "B"}, "INVALID_MIXED"),
        ("B shown with a materially stale unverified chart",
         {"requested": "B", "domSym": "B", "chartSym": "B",
          "chartCurrent": False, "chartBehind": 38}, "INVALID_STALE"),
        ("B shown current — the success case",
         {"requested": "B", "domSym": "B", "chartSym": "B",
          "chartCurrent": True, "chartBehind": 0}, "VALID_NEW_CURRENT"),
        ("B shown one bucket behind, verified — authoritative",
         {"requested": "B", "domSym": "B", "chartSym": "B",
          "chartCurrent": False, "chartBehind": 1}, "VALID_NEW_AUTHORITATIVE"),
    ]
    bad = 0
    print("classifier self-test")
    for label, sample, want in cases:
        got, why = classify(sample, "A")
        ok = got == want
        bad += 0 if ok else 1
        print(f"  [{'ok ' if ok else 'FAIL'}] {label:<52} -> {got}")
    # VALID_OLD needs the previous symbol, checked separately.
    got, _ = classify({"requested": "B", "domSym": "A", "chartSym": "A"}, "A")
    ok = got == "VALID_OLD"
    bad += 0 if ok else 1
    print(f"  [{'ok ' if ok else 'FAIL'}] {'A label over A candles while B prepares':<52} -> {got}")
    print("self-test PASSED" if not bad else f"self-test FAILED ({bad})")
    return 0 if not bad else 1


def main():
    if "--self-test" in sys.argv:
        return self_test()
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "scan_handoff_out.json")
    if not os.path.isfile(path):
        print("FAIL: scan_handoff_out.json not found")
        return 1
    data = json.load(open(path, encoding="utf-8"))
    pre, samples, rows = data.get("pre", []), data.get("samples", []), data.get("rows", [])
    reqs, control = data.get("requests", []), data.get("control")

    # ── 0. THE CONTROL: the classifier must be able to FAIL ──
    print("=" * 66)
    print("CLASSIFIER CONTROL (a classifier that cannot fail is not evidence)")
    print("=" * 66)
    if not control:
        print("  ⛔ NO CONTROL SAMPLE — cannot trust any verdict below.")
        return 1
    if self_test() != 0:
        print("FAIL: the classifier self-test did not pass.")
        return 1
    print()
    verdict, why = classify(control, None)
    ok = verdict == "INVALID_MIXED"
    print(f"  injected a wrong rendered ticker -> {verdict} ({why})")
    print(f"  control {'PASSES: the probe detects a mismatch' if ok else 'FAILS: THE PROBE IS BLIND'}")
    if not ok:
        print("\nFAIL: classifier could not detect an injected mismatch.")
        return 1

    # ── 1. FRAME CLASSIFICATION ──
    print("\n" + "=" * 66)
    print("VISIBLE FRAMES (rendered DOM identity vs painted symbol)")
    print("=" * 66)
    counts, examples = {}, {}
    prev = None
    order = []
    for s in samples:
        f = s.get("forSym")
        if f not in order:
            order.append(f)
            prev = order[-2] if len(order) > 1 else data.get("firstSym")
        v, why = classify(s, prev)
        counts[v] = counts.get(v, 0) + 1
        if v.startswith(("INVALID", "PROBE")) and v not in examples:
            examples[v] = f"forSym={f} {why}"
    total = max(1, len(samples))
    for k in ["VALID_OLD", "VALID_NEW_CURRENT", "VALID_NEW_AUTHORITATIVE",
              "INVALID_EMPTY", "INVALID_MIXED", "INVALID_STALE", "PROBE_INVALID"]:
        v = counts.get(k, 0)
        flag = "   <-- FAILURE" if (k.startswith(("INVALID", "PROBE")) and v) else ""
        ex = f"   e.g. {examples[k]}" if k in examples else ""
        print(f"  {k:<26}{v:>6}  {pct(v, total):>6}%{flag}{ex}")

    # ── 2. TRUE MEMBER LATENCY: click -> coherent current ──
    print("\n" + "=" * 66)
    print("TRUE MEMBER LATENCY  T0_CLICK -> TC")
    print("=" * 66)
    by_sym = {}
    for s in samples:
        f = s.get("forSym")
        if f is None:
            continue
        v, _ = classify(s, None)
        if v in ("VALID_NEW_CURRENT", "VALID_NEW_AUTHORITATIVE") and f not in by_sym:
            t0, ts = s.get("t0_click"), s.get("ts")
            if isinstance(t0, (int, float)) and isinstance(ts, (int, float)):
                by_sym[f] = round(ts - t0)
    lat = sorted(by_sym.values())
    plan = {p["sym"]: (p.get("planned"), p.get("currentBeforeClick")) for p in pre}
    print(f"  measured on {len(lat)}/{len(pre)} switches")
    print(f"  OVERALL  p50={q(lat,.5)}  p90={q(lat,.9)}  p95={q(lat,.95)}  max={lat[-1] if lat else None}")
    groups = {}
    for sym, ms in by_sym.items():
        planned, ready = plan.get(sym, ("?", None))
        key = f"{planned}/{'ready' if ready else 'not-ready'}"
        groups.setdefault(key, []).append(ms)
    print(f"\n  {'class':<22}{'n':>4}{'p50':>7}{'p90':>7}{'max':>7}")
    for k in sorted(groups):
        v = sorted(groups[k])
        print(f"  {k:<22}{len(v):>4}{q(v,.5):>7}{q(v,.9):>7}{v[-1]:>7}")

    # ── 3. INITIAL MOUNT, REPORTED SEPARATELY ──
    print("\n" + "=" * 66)
    print("PER-SWITCH (chart instrumentation) — initial mount kept separate")
    print("=" * 66)
    first = rows[0] if rows else None
    switches = rows[1:] if rows else []
    stale = [r for r in switches if r.get("staleFirstPaint")]
    tore = [r for r in switches if (r.get("emptyFrames") or 0) > 0]
    nc = [r for r in switches if r.get("T0→TC") is None]
    print(f"  initial mount  : sym={first.get('sym') if first else '?'} "
          f"teardown={(first.get('emptyFrames') or 0) > 0 if first else '?'} "
          f"(blank is legitimate before any chart exists)")
    print(f"  switches       : {len(switches)}")
    print(f"  STALE FIRST PAINT : {len(stale)}/{len(switches)} = {pct(len(stale), len(switches))}%")
    print(f"  TEARDOWN FIRED    : {len(tore)}/{len(switches)} = {pct(len(tore), len(switches))}%")
    print(f"  never reached current: {len(nc)}")

    # ── 4. REQUESTS ──
    print("\n" + "=" * 66)
    print("REQUEST VOLUME")
    print("=" * 66)
    full = [r for r in reqs if not r.get("delta")]
    tail = [r for r in reqs if r.get("delta")]
    keys = [f"{r.get('sym')}_{r.get('tf')}_{r.get('since')}" for r in reqs]
    print(f"  FULL={len(full)}  TAIL(since=)={len(tail)}  total={len(reqs)}  duplicates={len(keys)-len(set(keys))}")
    print(f"  page errors: {data.get('errors') or 'none'}")
    print(f"  refused persistence writes: {data.get('blocked')}")

    bad = sum(counts.get(k, 0) for k in
              ("INVALID_EMPTY", "INVALID_MIXED", "INVALID_STALE", "PROBE_INVALID"))
    print("\n" + ("PASS: every visible frame coherent, no stale paint, probe proven able to fail"
                  if bad == 0 else f"FAIL: {bad} invalid/unproven observations"))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
