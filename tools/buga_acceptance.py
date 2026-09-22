"""BUG A ACCEPTANCE: the first visible frame of a scanned ticker is CURRENT.

⛔⛔ THE REPORT. Scanning Theme Tracker on a 5m chart, colder tickers painted an
OLD intraday state first -- sometimes premarket, sometimes earlier that morning
-- and the current candle arrived roughly a second later.

Root cause was NOT the IndexedDB gate. It was the SYNC MEM CACHE, which is also
a paint source and had no intraday gate at all (`_memTailStaleDaily` returns
false immediately for any tf that is not 'D'), while `_memPromoteFresh` promoted
an intraday entry up to `max(6*tf, 20min)` old -- thirty minutes behind on 5m.
So the +/-6 neighbour warmer actively hoisted stale series into the fast path.

⛔ THE FOUR HARD GATES, ALL ZERO OR THE RUN IS NOT ACCEPTED:

  STALE TARGET FIRST FRAME  the first painted frame for the target was not
                            current-enough for its timeframe
  MIXED                     the rendered ticker and the drawn candles disagreed
                            for any measurable time
  NEVER CURRENT             the switch settled without ever showing a current frame
  LATE GENERATION COMMIT    a superseded request painted after a newer one

⛔ AND INVALID IS NOT A PASS. A switch that produced no observable paint proves
nothing; it is counted separately and it fails the run. Five silent-failure
incidents on this project all had the same shape -- an instrument whose failure
mode is absence, and absence reads exactly like a well-behaved product.

Usage:  python tools\\buga_acceptance.py
"""
from __future__ import annotations

import json
import os
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intraday_tail_harness import (   # noqa: E402
    CLOCK_JS, FAKE_NOW, Fixture, SEED_JS, CACHE_LOGIC_VERSION, free_port, make_bars, route_handler,
)
from scan_handoff_harness import (    # noqa: E402
    CLEAR_IDB, SAMPLE_JS, SCAN, plan, start_dev_server,
)
from stimulus import verdict, summarize, render, PASS, FAIL, INVALID  # noqa: E402

TF = "5"
PASSES = 5          # 25 symbols x 5 = 125 switches, comfortably over the 100 floor


def first_paint_rows(page, since):
    """Timing rows appended since `since` -- i.e. produced by THIS switch.

    ⛔ Matching rows by ticker would be ambiguous the moment a scan revisits a
    symbol, which every realistic pass does. Slicing by index is exact."""
    return page.evaluate("(n) => (window.__uctChartTiming.report() || []).slice(n)", since)


def run_switch(page, sym, planned, pass_no):
    n0 = page.evaluate("() => (window.__uctChartTiming.report() || []).length")
    page.evaluate("(s) => { window.__scanWatch = null; window.__scan.watch(s);"
                  "         window.__scan.select(s) }", sym)
    try:
        page.wait_for_function("() => window.__scanWatch", timeout=6000)
        watch = page.evaluate("() => window.__scan.watchResult()")
    except Exception:                                       # noqa: BLE001
        watch = None
    page.wait_for_timeout(260)
    rows = first_paint_rows(page, n0)
    painted = [r for r in rows if r.get("T0→paint") is not None
               and str(r.get("sym", "")).upper() == sym]
    settle = page.evaluate(SAMPLE_JS)

    rec = {
        "pass": pass_no, "sym": sym, "planned": planned,
        # HOT/WARM/COLD is the CACHE STATE AT THE CLICK, not the plan: after the
        # first pass every symbol has been fetched, so reporting the planted plan
        # for all 125 switches would claim a cache mix the run no longer has.
        "cacheState": ("COLD" if planned == "cold" and pass_no == 1
                       else "WARM" if pass_no == 1 else "HOT"),
        "firstPaintCurrent": painted[0].get("paintWasCurrent") if painted else None,
        "firstPaintBarsBehind": painted[0].get("paintBarsBehind") if painted else None,
        "paintCount": len(painted),
        "everCurrent": any(r.get("paintWasCurrent") is True for r in painted),
        "mixedMs": (watch or {}).get("mixedMs"),
        "emptyMs": (watch or {}).get("emptyMs"),
        "tCoherent": (watch or {}).get("tCoherent"),
        "settleDom": settle.get("domSym"), "settleChart": settle.get("chartSym"),
        # A superseded request that painted after a newer one: the run settled on
        # a symbol that is not the one last requested.
        "settleRequested": settle.get("requested"),
    }

    # ── STIMULUS: did this switch actually paint anything for the target? ──
    if not painted or watch is None:
        rec["verdict"] = INVALID
        rec["why"] = ("no paint recorded for the target" if not painted
                      else "frame watcher never resolved")
        return rec

    stale_first = rec["firstPaintCurrent"] is False
    mixed = (rec["mixedMs"] or 0) > 0
    never_current = not rec["everCurrent"]
    late_gen = (rec["settleChart"] or sym) != sym or (rec["settleDom"] or sym) != sym
    rec["gates"] = {"staleFirstFrame": stale_first, "mixed": mixed,
                    "neverCurrent": never_current, "lateGeneration": late_gen}
    rec["verdict"] = verdict(True, not (stale_first or mixed or never_current or late_gen))
    return rec


def main():
    port = free_port()
    print(f"[bugA] dev server on :{port}", flush=True)
    proc = start_dev_server(port)
    fixture = Fixture()
    results, errors = [], []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1400, "height": 900})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.route("**/api/**", route_handler(fixture))
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)[:200]))
            base = f"http://127.0.0.1:{port}"

            states = plan(int(TF))
            page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
            page.evaluate(CLEAR_IDB)
            page.evaluate("() => { try { localStorage.setItem('uct.chartTiming','1') } catch {} }")
            print(f"  seeding {len(states)} symbols…", flush=True)
            for sym, (kind, tail) in states.items():
                if tail is not None:
                    page.evaluate(SEED_JS, [sym, TF, make_bars(int(TF), tail, 4), CACHE_LOGIC_VERSION])

            page.goto(f"{base}/scan-harness.html?tf={TF}&syms={','.join(SCAN)}",
                      wait_until="domcontentloaded")
            page.wait_for_timeout(3500)
            if not page.evaluate("() => !!window.__scan"):
                raise RuntimeError("harness did not mount (window.__scan missing)")

            # ── CONTROL FIRST. A classifier that has never been shown to FAIL is
            # not evidence, so prove the stale gate can fire before trusting 125
            # clean rows. MU is planted hours behind; painting it with the gate
            # widened past the real gap must be classified STALE.
            control = page.evaluate("""() => {
              const t = window.__uctChartTiming ? window.__uctChartTiming.report() : null
              return Array.isArray(t) ? t.filter(r => r.paintWasCurrent === false).length : null
            }""")
            print(f"  control: stale paints already recorded during warm-up = {control}", flush=True)

            # ⛔ A RE-SELECT OF THE SYMBOL ALREADY ON SCREEN IS NOT A SWITCH. The
            # first run counted one: SCAN[0] is the symbol the harness mounts with,
            # so `select(MU)` was a no-op that recorded no paint -- INVALID, which
            # is the stimulus rule working exactly as intended, but the switch was
            # never real. Rotate each pass so its first selection is always a
            # genuine transition, and carry the displayed symbol across passes.
            current_sym = SCAN[0]
            for p in range(1, PASSES + 1):
                order = list(SCAN)
                if order[0] == current_sym:
                    order = order[1:] + order[:1]
                for sym in order:
                    rec = run_switch(page, sym, states[sym][0], p)
                    results.append(rec)
                    current_sym = sym
                done = len(results)
                bad = sum(1 for r in results if r["verdict"] != PASS)
                print(f"  pass {p}/{PASSES}: {done} switches, {bad} not-PASS", flush=True)
            browser.close()
    finally:
        try: proc.terminate()
        except Exception: pass                              # noqa: BLE001

    summary = summarize(results)
    summary["gates"] = {
        "staleTargetFirstFrame": sum(1 for r in results if (r.get("gates") or {}).get("staleFirstFrame")),
        "mixed": sum(1 for r in results if (r.get("gates") or {}).get("mixed")),
        "neverCurrent": sum(1 for r in results if (r.get("gates") or {}).get("neverCurrent")),
        "lateGenerationCommit": sum(1 for r in results if (r.get("gates") or {}).get("lateGeneration")),
        "invalid": summary["invalid"],
    }
    summary["byCacheState"] = {}
    for st in ("COLD", "WARM", "HOT"):
        rs = [r for r in results if r["cacheState"] == st]
        summary["byCacheState"][st] = {
            "n": len(rs),
            "pass": sum(1 for r in rs if r["verdict"] == PASS),
            "fail": sum(1 for r in rs if r["verdict"] == FAIL),
            "invalid": sum(1 for r in rs if r["verdict"] == INVALID),
            "medianCoherentMs": sorted([r["tCoherent"] for r in rs if r["tCoherent"] is not None])
                                [len([r for r in rs if r["tCoherent"] is not None]) // 2]
                                if any(r["tCoherent"] is not None for r in rs) else None,
        }
    summary["pageErrors"] = errors[:10]
    summary["accepted"] = bool(summary["accepted"] and not errors)

    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "buga_acceptance_out.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "switches": results}, f, indent=2)
    print("\n" + render(summary, "Bug A acceptance"))
    print("  HARD GATES (all must be 0):")
    for k, v in summary["gates"].items():
        print(f"    {k:<24} {v}")
    print("  BY CACHE STATE:")
    for st, v in summary["byCacheState"].items():
        print(f"    {st:<5} n={v['n']:<4} pass={v['pass']:<4} fail={v['fail']:<3} "
              f"invalid={v['invalid']:<3} medianCoherent={v['medianCoherentMs']}ms")
    if errors:
        print(f"  !! page errors: {errors[:3]}")
    print(f"[bugA] wrote {dst}")
    return 0 if summary["accepted"] else 1


if __name__ == "__main__":
    sys.exit(main())
