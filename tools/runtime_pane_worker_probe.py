"""RF (2026-10-02) — prove the runtime pane's run happens OFF the main thread, in a
real browser, and measure what it costs there.

Loads the runtime worker bundle (a production build's `runtimeWorker-*.js`, or a
standalone build) into headless Chromium through Playwright, posts each document
the member door mints for the runtime-only corpus scripts with the chart's bars
exactly as `runtimeAsync.workerRunner` posts them, and records, per run:

* the worker's turnaround (post -> answer) and what it answered (columns or a
  named refusal such as ``runtime:time-budget``);
* the MAIN thread while the worker works: the largest gap between animation
  frames (the verdict instrument), and any long task the browser reports
  (recorded only: measured 2026-10-02, headless Chromium reports NO `longtask`
  entry even for a deliberate 400 ms block, so it cannot clear anything).

⛔ A CONTROL RUNS FIRST AND MUST SEE BLOCKING. The page spins its own main thread
for 400 ms; the frame-gap instrument has to report >= 350 ms, or the run is
INCONCLUSIVE (an instrument that cannot see a block cannot clear one). Exit
codes: 0 measured, 2 inconclusive, 1 a frame gap >= 100 ms was observed during a
worker run.

Inputs come from the opt-in census
(`runtimePaneReadiness.measure.test.js` with ``RF_DEFS_OUT``), which writes the
minted documents and the bars. Nothing here touches production or ``C:\\data``.

    python tools/runtime_pane_worker_probe.py --worker <bundle.js> \
        --defs <rf-defs.json> --out <result.json>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ORIGIN = "http://rf-probe.invalid"

PAGE = """<!doctype html><meta charset="utf-8"><title>rf probe</title><script>
window.__long = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({s: e.startTime, d: e.duration}); })
  .observe({entryTypes: ['longtask']});
window.__frames = [];
(function tick(t) { window.__frames.push(t); requestAnimationFrame(tick); })(performance.now());
window.__window = (t0, t1) => {
  // ⛔ the frames BRACKETING the window too: a window holding one frame (or none)
  // reads "gap 0" while the thread was blocked for the whole of it.
  const all = window.__frames;
  let a = 0; while (a < all.length - 1 && all[a + 1] <= t0) a += 1;
  let b = all.length - 1; while (b > 0 && all[b - 1] >= t1) b -= 1;
  const f = all.slice(a, b + 1);
  let gap = 0; for (let i = 1; i < f.length; i += 1) gap = Math.max(gap, f[i] - f[i - 1]);
  const lt = window.__long.filter((e) => e.s + e.d >= t0 && e.s <= t1);
  return {frames: f.length, maxFrameGapMs: gap, longTasks: lt.length, longestTaskMs: lt.reduce((m, e) => Math.max(m, e.d), 0)};
};
window.__spin = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) {} };
window.__run = (worker, msg) => new Promise((resolve) => {
  const t0 = performance.now();
  worker.onmessage = (ev) => {
    const t1 = performance.now();
    setTimeout(() => resolve({ms: t1 - t0, t0, t1, ok: ev.data.ok, guard: ev.data.ok ? null : ev.data.error.guard,
      columns: ev.data.ok ? Object.keys(ev.data.columns).length : 0}), 50);
  };
  const p0 = performance.now();
  worker.postMessage(msg);
  window.__postMs = performance.now() - p0;
});
</script>"""


def plain_def(d: dict) -> dict:
    """What `runtimeAsync.workerRunner` posts: id, compute, and the history fact."""
    return {"id": d.get("id"), "compute": d.get("compute"),
            "meta": {"runtimeHistory": (d.get("meta") or {}).get("runtimeHistory")}}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker", required=True)
    ap.add_argument("--defs", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    from playwright.sync_api import sync_playwright

    worker_src = Path(args.worker).read_bytes()
    data = json.loads(Path(args.defs).read_text(encoding="utf-8"))
    bars = data["bars"]
    result = {"worker": str(args.worker), "workerBytes": len(worker_src), "runs": []}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.route(f"{ORIGIN}/", lambda r: r.fulfill(status=200, content_type="text/html", body=PAGE))
        page.route(f"{ORIGIN}/w.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=worker_src))
        page.goto(f"{ORIGIN}/")
        page.wait_for_timeout(300)
        # ⛔ the control: a deliberate 400 ms main-thread block must be SEEN
        ctl = page.evaluate("""async () => { const t0 = performance.now(); __spin(400);
            await new Promise((r) => setTimeout(r, 200)); return __window(t0 - 5, performance.now()); }""")
        result["control"] = ctl
        if not ctl["maxFrameGapMs"] >= 350:
            result["verdict"] = "INCONCLUSIVE: the instrument did not see a deliberate 400 ms block"
            Path(args.out).write_text(json.dumps(result, indent=1), encoding="utf-8")
            print(result["verdict"])
            return 2
        page.evaluate(f"window.__w = new Worker('{ORIGIN}/w.js', {{type: 'module'}})")
        worst = 0.0
        for entry in data["defs"]:
            for length, ctx in (("D 5000", {"tf": "D", "newestBarIsForming": False, "historyFromListing": True}),
                                ("5m 32000", {"tf": "5", "newestBarIsForming": False, "historyFromListing": True})):
                rows = bars[length]
                for k in range(2):  # first run includes fetching/compiling the bundle
                    msg = {"id": k + 1, "def": plain_def(entry["def"]), "rows": rows, "ctx": ctx}
                    # ⛔ stage the message INTO the page first and let frames settle:
                    # Playwright's own transfer of 32,000 rows blocks the page for ~1 s
                    # and must not be scored as the product's cost.
                    page.evaluate("(m) => { window.__msg = m }", msg)
                    page.wait_for_timeout(300)
                    r = page.evaluate("async () => { const r = await __run(window.__w, window.__msg); return {...r, postMs: window.__postMs, main: __window(r.t0, r.t1)}; }")
                    worst = max(worst, r["main"]["maxFrameGapMs"])
                    result["runs"].append({"slug": entry["slug"], "length": length, "attempt": k + 1,
                                           "workerMs": round(r["ms"], 1), "postMessageMs": round(r["postMs"], 1),
                                           "ok": r["ok"], "guard": r["guard"],
                                           "columns": r["columns"], **{f"main_{a}": round(b, 1) for a, b in r["main"].items()}})
                    print(f"{entry['slug'][:34]:34} {length:9} #{k+1}: worker {r['ms']:7.1f} ms (post {r['postMs']:.0f} ms) "
                          f"{'ok' if r['ok'] else r['guard']}; main longest task {r['main']['longestTaskMs']:.0f} ms, "
                          f"max frame gap {r['main']['maxFrameGapMs']:.0f} ms over {r['main']['frames']} frames")
        browser.close()
    result["worstMainFrameGapMs"] = worst
    result["verdict"] = "BLOCKED" if worst >= 100 else "OFF-MAIN-THREAD"
    Path(args.out).write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(f"control: longest task {ctl['longestTaskMs']:.0f} ms, max frame gap {ctl['maxFrameGapMs']:.0f} ms")
    print(f"VERDICT: {result['verdict']} (worst main-thread frame gap during worker runs: {worst:.0f} ms)")
    return 1 if worst >= 100 else 0


if __name__ == "__main__":
    sys.exit(main())
