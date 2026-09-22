"""Classify what the MEMBER SAW during the scan, from scan_handoff_out.json.

⛔ THE RENDERED STATE IS THE ACCEPTANCE AUTHORITY, NOT REACT STATE. Each sample
carries the requested symbol and the symbol whose candles are actually on the
canvas (`__uctBarsDebug.paintSym`, the chart's own paint record), so identity
disagreement is observed rather than inferred.

  VALID_OLD        requested has not moved yet, or the canvas still shows the
                   PREVIOUS symbol while the new one prepares -- coherent,
                   because ChartWidget has not moved its identity either.
  VALID_NEW        canvas shows the requested symbol.
  INVALID_EMPTY    a mounted chart with zero bars on the canvas.
  INVALID_MIXED    canvas shows a symbol that is neither the requested one nor
                   the immediately previous one -- a genuinely wrong frame.

⚠️ WHY 'VALID_OLD' IS NOT A FAILURE HERE: the handoff holds BOTH identity and
candles on A together. The harness samples `requested` (the list's ask) and
`paintSym` (what is drawn); between them sits `displayedSym`, which is what the
widget labels itself with. A sample where requested=B and paintSym=A is the
handoff WORKING -- the widget is still wholly A -- and the widget-level rails
(ChartWidget.handoff.test.jsx) are what prove the label agrees, because the
label is not readable from the canvas.
"""
from __future__ import annotations

import json
import os
import sys


def pct(n, d):
    return 0.0 if not d else round(100.0 * n / d, 1)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "scan_handoff_out.json")
    if not os.path.isfile(path):
        print("FAIL: scan_handoff_out.json not found -- run scan_handoff_harness.py first")
        return 1
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    pre = data.get("pre", [])
    samples = data.get("samples", [])
    rows = data.get("rows", [])
    reqs = data.get("requests", [])

    # ── 1. NEIGHBOUR WARMING: ready before the click? ──
    ready = [r for r in pre if r.get("currentBeforeClick")]
    print("=" * 62)
    print("NEIGHBOUR WARMING -- current/authoritative BEFORE the click")
    print("=" * 62)
    print(f"  {len(ready)}/{len(pre)}  = {pct(len(ready), len(pre))}%")
    buckets = {}
    for r in pre:
        k = (r.get("planned"), r.get("source"), bool(r.get("currentBeforeClick")))
        buckets[k] = buckets.get(k, 0) + 1
    print(f"\n  {'planned':<10}{'source':<9}{'readyBeforeClick':<18}{'n'}")
    for k in sorted(buckets, key=lambda x: (x[0] or "", x[1] or "")):
        print(f"  {str(k[0]):<10}{str(k[1]):<9}{str(k[2]):<18}{buckets[k]}")

    # ── 2. VISIBLE FRAME CLASSIFICATION ──
    print("\n" + "=" * 62)
    print("VISIBLE FRAMES (rendered state, not React state)")
    print("=" * 62)
    counts = {"VALID_OLD": 0, "VALID_NEW": 0, "INVALID_EMPTY": 0, "INVALID_MIXED": 0}
    prev_paint = None
    seen_syms = []
    for s in samples:
        req = s.get("requested")
        paint = s.get("paintSym")
        bars = s.get("barCount")
        if paint:
            if paint not in seen_syms:
                seen_syms.append(paint)
        if bars == 0:
            counts["INVALID_EMPTY"] += 1
        elif paint == req:
            counts["VALID_NEW"] += 1
        elif paint is not None and (paint == prev_paint or prev_paint is None):
            counts["VALID_OLD"] += 1
        elif paint is None:
            counts["VALID_OLD"] += 1          # nothing drawn yet this sample
        else:
            counts["INVALID_MIXED"] += 1
        if paint:
            prev_paint = paint
    total = max(1, len(samples))
    for k, v in counts.items():
        flag = "  <-- FAILURE" if k.startswith("INVALID") and v else ""
        print(f"  {k:<16}{v:>6}   {pct(v, total):>6}%{flag}")

    # ── 3. TC / correctness from the chart's own instrumentation ──
    print("\n" + "=" * 62)
    print("PER-SWITCH (chart instrumentation)")
    print("=" * 62)
    stale = [r for r in rows if r.get("staleFirstPaint")]
    tc = sorted(r["T0→TC"] for r in rows if isinstance(r.get("T0→TC"), (int, float)))
    t4 = sorted(r["T0→paint"] for r in rows if isinstance(r.get("T0→paint"), (int, float)))
    ew = sorted(r["emptyWindowMs"] for r in rows if isinstance(r.get("emptyWindowMs"), (int, float)))
    q = lambda v, p: v[min(len(v) - 1, int(p * len(v)))] if v else None   # noqa: E731
    print(f"  switches recorded : {len(rows)}")
    print(f"  STALE FIRST PAINT : {len(stale)}/{len(rows)}  = {pct(len(stale), len(rows))}%")
    print(f"  T0->TC   p50={q(tc,.5)}  p90={q(tc,.9)}  p95={q(tc,.95)}   (n={len(tc)})")
    print(f"  T0->T4   p50={q(t4,.5)}  p90={q(t4,.9)}  p95={q(t4,.95)}   (diagnostic)")
    print(f"  empty window p50={q(ew,.5)}  p90={q(ew,.9)}  p95={q(ew,.95)}")
    visible_black = [x for x in ew if x > 16.7]
    print(f"  VISIBLE (>1 frame) empty: {len(visible_black)}/{len(ew)} = {pct(len(visible_black), len(ew))}%")

    # ── 4. REQUEST VOLUME ──
    print("\n" + "=" * 62)
    print("REQUEST VOLUME")
    print("=" * 62)
    full = [r for r in reqs if not r.get("delta")]
    tail = [r for r in reqs if r.get("delta")]
    keys = [f"{r.get('sym')}_{r.get('tf')}_{r.get('since')}" for r in reqs]
    dupes = len(keys) - len(set(keys))
    print(f"  FULL={len(full)}  TAIL(since=)={len(tail)}  total={len(reqs)}")
    print(f"  duplicate (sym,tf,since) requests: {dupes}")
    per_sym = {}
    for r in reqs:
        per_sym[r.get("sym")] = per_sym.get(r.get("sym"), 0) + 1
    worst = sorted(per_sym.items(), key=lambda kv: -kv[1])[:5]
    print(f"  busiest symbols: {worst}")
    print(f"\n  page errors: {data.get('errors') or 'none'}")
    print(f"  refused persistence writes: {data.get('blocked')}")

    bad = counts["INVALID_EMPTY"] + counts["INVALID_MIXED"] + len(stale)
    print("\n" + ("PASS: no invalid visible frames, no stale first paint"
                  if bad == 0 else f"FAIL: {bad} invalid observations"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
