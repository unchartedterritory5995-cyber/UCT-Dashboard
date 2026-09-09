"""Measure the review feed's budget in a REAL browser, on a phone viewport.

⛔ WHY A PROBE AND NOT A TEST. `ReviewFeed.test.jsx` proves the ceiling in jsdom
and the mutation check proves that rail can fail. Neither can answer the two
claims that decide whether this feature is shippable on a phone:

    heap growth over a long scroll, and whether it RETURNS TO BASELINE
    scroll smoothness while charts mount and unmount underneath the finger

Those are properties of a browser with layout, compositing and a real GC, and
this is the local instrument that has all three.

⛔ AND IT MUST BE A COARSE POINTER. The feed is a phone surface; desktop Chrome
reports `pointer: fine` at any width, so a plain browser would measure a surface
the member never sees. Playwright's mobile context answers honestly, and this
REFUSES to report if the pointer did not actually resolve coarse.

⚠️⚠️ WHAT THIS RUN CANNOT ESTABLISH, stated here rather than folded into a
number at the end. Against the fail-closed sandbox there is NO VENDOR ACCESS by
design, so `/api/bars` answers nothing and the charts mount without data. That
means:
  · the LIVE-CHART CEILING is measured honestly — mounting is what the window
    controls, and it does not depend on bars arriving;
  · the HEAP FIGURES ARE A FLOOR, not the real cost: a chart holding 126 bars
    of series data costs more than an empty one. A run against a data-bearing
    backend is the only way to close that, and until then the heap column says
    "floor" and means it.
A probe that quietly reported the floor as the answer would be worse than no
probe: it would retire a risk nobody had measured.

Usage: python tools/review_feed_probe.py [--base http://127.0.0.1:8093] [--cards 40]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from sandbox_account import SANDBOX_EMAIL, new_password, ensure_account  # noqa: E402

PASSWORD = new_password()
CRED = {"email": SANDBOX_EMAIL, "password": PASSWORD}

# Real, liquid tickers: if this is ever pointed at a data-bearing backend the
# same list produces the honest heap number with no edit.
UNIVERSE = [
    "NVDA", "AMD", "AVGO", "MU", "TSLA", "META", "GOOG", "AMZN", "AAPL", "MSFT",
    "NFLX", "CRM", "ORCL", "ADBE", "INTC", "QCOM", "TXN", "AMAT", "LRCX", "KLAC",
    "PANW", "CRWD", "SNOW", "DDOG", "NET", "SHOP", "SQ", "PYPL", "COIN", "HOOD",
    "SMCI", "ARM", "MRVL", "ON", "TER", "ASML", "TSM", "UBER", "ABNB", "RBLX",
]

STORAGE_KEY = "uct.review.session"

# The rAF sampler: the honest way to ask "did the scroll stay smooth" without a
# tracing profiler. Long frames are counted, not averaged away — a feed that
# holds 58 fps and drops one 400 ms frame per card is not a smooth feed.
FRAME_SAMPLER = """
() => {
  window.__frames = { n: 0, long: 0, worst: 0, t0: performance.now() }
  let last = performance.now()
  const tick = (now) => {
    const dt = now - last
    last = now
    const f = window.__frames
    f.n += 1
    if (dt > 32) f.long += 1          // worse than ~30 fps for that frame
    if (dt > f.worst) f.worst = dt
    if (!f.stop) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
"""

READ = """
() => {
  const m = window.__uctReviewFeed || null
  // ⛔ COUNT INSIDE THE FEED, AND ON THE PAGE, SEPARATELY. The shell's own chart
  // stays mounted UNDER the feed sheet by design ("returning is free"), so a
  // page-wide count reads 4 against a budget of 3 and looks like a breach. Both
  // numbers are real and they answer different questions: the feed's ceiling,
  // and what the phone is actually holding during a review.
  const scroll = document.querySelector("[data-testid='feed-scroll']")
  return {
    instrument: m,
    feedCharts: scroll ? scroll.querySelectorAll('.tv-lightweight-charts').length : 0,
    pageCharts: document.querySelectorAll('.tv-lightweight-charts').length,
    // ⛔ RAW BYTES. Rounding to MB in the sampler made 39 samples read as a
    // constant 125 and turned "flat within half a megabyte" into an unearned
    // "0 MB growth" — the instrument's resolution masquerading as the result.
    heapBytes: (performance && performance.memory)
      ? performance.memory.usedJSHeapSize : null,
  }
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8093")
    ap.add_argument("--cards", type=int, default=40)
    ap.add_argument("--out", default="tools/review_feed_probe_out")
    args = ap.parse_args()

    symbols = (UNIVERSE * ((args.cards // len(UNIVERSE)) + 1))[: args.cards]
    # De-duplicate while preserving order — the session refuses duplicates, and a
    # probe that handed it a set it would normalise differently would measure a
    # different list from the one it printed.
    seen, ordered = set(), []
    for s in symbols:
        if s not in seen:
            seen.add(s)
            ordered.append(s)

    ensure_account(args.base, PASSWORD)

    from playwright.sync_api import sync_playwright

    session = {
        "v": 1, "source": "scan", "sourceId": "probe", "label": "Feed probe",
        "sort": None, "symbols": ordered, "index": 0, "reviewed": [ordered[0]],
        # ⭐ PENDING, exactly as a real entry from a scan is — so this run also
        # exercises the handoff: if the flag were broken the shell's hydrated
        # symbol would destroy the session and there would be no control to tap.
        "pending": True,
    }
    # ⛔ A SCRIPT BODY, NOT A FUNCTION EXPRESSION. `add_init_script` EVALUATES
    # what it is given; `page.evaluate` CALLS it. Handing it `() => {...}` — the
    # shape every other Playwright call in this repo takes — creates the function
    # and discards it, so nothing is seeded and the run refuses with "the session
    # did not reach the chart", which reads as a product defect. It cost one run.
    seed = ("try { sessionStorage.setItem(%s, %s) } catch (e) {}"
            % (json.dumps(STORAGE_KEY), json.dumps(json.dumps(session))))

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {"base": args.base, "cards": len(ordered), "samples": []}

    with sync_playwright() as p:
        # ⛔⛔ `--enable-precise-memory-info` IS NOT OPTIONAL. Without it Chrome
        # returns a QUANTIZED, CACHED `performance.memory`, and the first run of
        # this probe duly reported the identical byte value for all 39 samples —
        # which printed as "heap growth 0.0 MB" and would have retired the
        # single biggest risk in this feature on an instrument that was not
        # moving. `--expose-gc` is what makes "returns to baseline" askable at
        # all: without a forced collection the question is unanswerable.
        browser = p.chromium.launch(args=[
            "--js-flags=--expose-gc",
            "--enable-precise-memory-info",
        ])
        # ONE login; the state is reused. Six logins tripped HTTP 429 on the
        # placement probe and cost a whole run.
        boot = browser.new_context()
        r = boot.request.post(f"{args.base}/api/auth/login", data=CRED)
        if r.status != 200:
            print(f"login failed: {r.status}")
            return 2
        state = boot.storage_state()
        boot.close()

        # ⛔ ASK WHETHER THERE IS DATA, never assume. The heap figure means two
        # different things depending on the answer, and this run must say which
        # one it is reporting instead of carrying a caveat written months ago.
        probe_bars = boot0 = None
        try:
            b = ctx0 = browser.new_context(storage_state=state)
            resp = b.request.get(f"{args.base}/api/bars/{ordered[0]}?tf=D&bars=20")
            body = resp.json() if resp.status == 200 else {}
            rows = body.get("bars") if isinstance(body, dict) else None
            probe_bars = len(rows) if isinstance(rows, list) else 0
            b.close()
        except Exception:
            probe_bars = None
        report["bars_available"] = probe_bars

        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  is_mobile=True, has_touch=True,
                                  device_scale_factor=3, storage_state=state)
        page = ctx.new_page()
        page.add_init_script(seed)
        page.goto(f"{args.base}/charts?sym={ordered[0]}&tf=D", wait_until="domcontentloaded")

        # ⛔ REFUSE ON A FINE POINTER rather than reporting a desktop measurement
        # under a phone heading.
        coarse = page.evaluate("() => matchMedia('(pointer: coarse)').matches")
        if not coarse:
            print("REFUSED: pointer did not resolve coarse — this would measure a "
                  "surface the member never sees.")
            return 3

        # The transport control appearing IS the proof the handoff survived.
        try:
            page.wait_for_selector("[data-review-nav]", timeout=45000)
        except Exception:
            print("REFUSED: no review control — the session did not reach the chart. "
                  "Nothing measured; this is the handoff failing, not the feed.")
            page.screenshot(path=str(out / "no-control.png"))
            return 4
        report["handoff"] = "adopted"

        page.click("[data-review-nav] button:nth-of-type(2)")
        page.wait_for_selector("[data-testid='feed-scroll']", timeout=20000)
        page.wait_for_timeout(1500)

        base_read = page.evaluate(READ)
        page.evaluate("() => { if (window.gc) window.gc() }")
        page.wait_for_timeout(400)
        report["baseline"] = page.evaluate(READ)

        page.evaluate(FRAME_SAMPLER)

        # Scroll the feed one card at a time, sampling after each settle. A
        # single fling would measure one composite; a review is read card by
        # card, and that is the motion the budget has to survive.
        card_h = page.evaluate(
            "() => { const c = document.querySelector('[data-feed-index]');"
            " return c ? Math.round(c.getBoundingClientRect().height) : 400 }")
        for i in range(1, len(ordered)):
            page.evaluate(
                "(y) => { const el = document.querySelector(\"[data-testid='feed-scroll']\");"
                " if (el) el.scrollTop = y }", card_h * i)
            page.wait_for_timeout(320)
            s = page.evaluate(READ)
            s["card"] = i
            report["samples"].append(s)

        report["frames_down"] = page.evaluate("() => ({...window.__frames})")

        # Back to the top, then a forced GC: "growth returns to baseline" is the
        # claim that separates a bounded feed from a slow leak, and it can only
        # be asked after collection.
        page.evaluate("() => { const el = document.querySelector(\"[data-testid='feed-scroll']\");"
                      " if (el) el.scrollTop = 0 }")
        page.wait_for_timeout(1500)
        page.evaluate("() => { if (window.gc) window.gc() }")
        page.wait_for_timeout(800)
        report["after_return"] = page.evaluate(READ)
        page.screenshot(path=str(out / "feed-top.png"), full_page=False)

        ctx.close()
        browser.close()

    peak_feed = max([s["feedCharts"] for s in report["samples"]] or [0])
    peak_page = max([s["pageCharts"] for s in report["samples"]] or [0])
    peak_instr = max([(s["instrument"] or {}).get("peakLive", 0) for s in report["samples"]] or [0])
    heaps = [s["heapBytes"] for s in report["samples"] if s["heapBytes"] is not None]
    mb = lambda b: (round(b / 1048576.0, 2) if b is not None else None)  # noqa: E731
    base_b = (report["baseline"] or {}).get("heapBytes")
    end_b = (report["after_return"] or {}).get("heapBytes")

    # ⛔ A FROZEN INSTRUMENT IS NOT A FLAT HEAP. If every sample is the same
    # byte, the reading says nothing about memory and must never be printed as a
    # result (`lesson_a_saturated_instrument_reports_zero`).
    distinct = len(set(heaps))
    report["heap_instrument_moved"] = distinct > 1
    report["heap_distinct_samples"] = distinct

    report["verdict"] = {
        "peak_charts_in_feed": peak_feed,
        "peak_charts_on_page": peak_page,
        "peak_live_reported": peak_instr,
        "budget": (base_read.get("instrument") or {}).get("budget"),
        "heap_baseline_mb": mb(base_b),
        "heap_peak_mb": mb(max(heaps)) if heaps else None,
        "heap_min_mb": mb(min(heaps)) if heaps else None,
        "heap_after_return_mb": mb(end_b),
        "heap_growth_mb": (mb(max(heaps) - base_b) if (heaps and base_b is not None) else None),
        "heap_residual_after_gc_mb": (mb(end_b - base_b) if (end_b is not None and base_b is not None) else None),
        "frames": report.get("frames_down"),
    }
    (out / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    v = report["verdict"]
    # ⛔ ASCII ONLY IN THE SUMMARY. A Windows console is cp1252, and a box-
    # drawing character raises UnicodeEncodeError AFTER the whole run has
    # succeeded — the report is on disk and the runner sees a traceback, which
    # reads as "the probe failed". Same family as the capture that only breaks
    # on the failure path.
    print("=== REVIEW FEED PROBE ==========================================")
    print(f"  cards                 {len(ordered)}")
    print(f"  handoff               {report.get('handoff')}")
    print(f"  charts IN THE FEED    {v['peak_charts_in_feed']} peak   (component reported {v['peak_live_reported']}, budget {v['budget']})")
    print(f"  charts ON THE PAGE    {v['peak_charts_on_page']} peak   <- + the shell's own chart, which stays mounted by design")
    print(f"  heap baseline         {v['heap_baseline_mb']} MB")
    print(f"  heap peak / min       {v['heap_peak_mb']} / {v['heap_min_mb']} MB")
    if not report["heap_instrument_moved"]:
        print("!! HEAP UNMEASURED: performance.memory returned one identical value for "
              f"all {len(heaps)} samples. Chrome quantizes and caches it without "
              "--enable-precise-memory-info; treat every heap figure below as ABSENT, "
              "not as zero growth.")
    n_bars = report.get("bars_available")
    qualifier = (f"real bars ({n_bars} on the probe symbol)" if n_bars
                 else "FLOOR — no bar data on this backend, so charts mounted empty")
    print(f"  heap growth           {v['heap_growth_mb']} MB   <- {qualifier}")
    print(f"  heap after return+gc  {v['heap_after_return_mb']} MB  (residual {v['heap_residual_after_gc_mb']} MB)")
    print(f"  frames                {v['frames']}")
    print(f"  report                {out / 'report.json'}")
    print("================================================================")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
