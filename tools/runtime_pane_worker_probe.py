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

⭐⭐ P3 WS-H (2026-10-31) — the arming budgets B2 and B5 (`docs/pine/PHASE3-RUNTIME-PLAN.md` 4.3):

* ``--cpu-throttle R`` runs on a LOW-END PROFILE: Chromium's own CPU throttle
  (``Emulation.setCPUThrottlingRate``) at R times slower, on the page AND on the
  worker's own target. ⛔ A THROTTLE CONTROL RUNS FIRST: a fixed busy loop is timed
  in the worker unthrottled and throttled, and the ratio must reach at least half of
  R, or the run is INCONCLUSIVE (exit 2) -- a throttle that does not reach the
  worker would report a desktop number under a low-end label.
* ``--runs N`` attempts per script and length; the summary gives p50 / p95 of the
  WARM attempts (attempt 1 also fetches and compiles the bundle and is reported
  apart), against the 1,000 ms budget (B2).
* ``--checkpoint K`` measures the realtime rerun (B5): on the daily bars with the
  newest bar FORMING, one full run leaves the worker's session and checkpoint, then
  K ticks each change only the forming bar's close; each tick's turnaround
  (post -> answer, the row transfer included) is what a live chart pays per update.
* ``--lengths``, ``--slugs`` narrow the matrix; ``--symbol TICKER:EXCHANGE`` hands
  the run a symbol, as a chart does (without one, a script that reads
  ``syminfo.*`` stops on ``interpret:bind-time-text``, a harness artifact).
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


#: ⭐ P3 WS-H — the low-end page: the SAME worker bundle, its handler driven on this
#: page's own thread. Chromium throttles a PAGE's CPU and refuses a worker's
#: (`Emulation.setCPUThrottlingRate` on a worker target answers "Operation is only
#: supported for pages, not workers", and a page's throttle leaves its worker at full
#: speed: measured 2026-10-31). `self` is [Replaceable], so the bundle's
#: `self.onmessage` / `self.postMessage` land on a stand-in.
EMU_PAGE = """<!doctype html><meta charset="utf-8"><title>rf probe low-end</title><script>
window.__fake = { onmessage: null, postMessage: null };
window.__busy = (n) => { const t0 = performance.now(); let x = 0; for (let i = 0; i < n; i += 1) x = (x * 1.0000001 + i) % 1e9; return performance.now() - t0 + (x < 0 ? 1 : 0); };
window.__load = async (url) => { self = window.__fake; await import(url); return typeof window.__fake.onmessage === 'function'; };
window.__runHere = (msg) => new Promise((resolve) => {
  const t0 = performance.now();
  window.__fake.postMessage = (data) => resolve({ms: performance.now() - t0, ok: data.ok,
    guard: data.ok ? null : data.error.guard, columns: data.ok ? Object.keys(data.columns).length : 0});
  window.__fake.onmessage({ data: msg });
});
</script>"""

#: The throttle control's busy loop size, and the share of the asked-for rate the
#: control must reach.
BUSY_N = 20_000_000
THROTTLE_FLOOR = 0.5


def _pct(values, q):
    if not values:
        return None
    v = sorted(values)
    return v[min(len(v) - 1, max(0, int(round(q * (len(v) - 1)))))]


def _summary(runs, budget_ms=1000.0):
    """p50 / p95 of the WARM attempts per (slug, length), against the budget."""
    out = []
    keys = []
    for r in runs:
        k = (r["slug"], r["length"])
        if k not in keys:
            keys.append(k)
    for slug, length in keys:
        sel = [r for r in runs if r["slug"] == slug and r["length"] == length]
        warm = [r for r in sel if r["attempt"] > 1] or sel
        ms = [r["workerMs"] for r in warm]
        answers = sorted({("ok" if r["ok"] else r["guard"]) for r in sel})
        p95 = _pct(ms, 0.95)
        out.append({"slug": slug, "length": length, "n": len(ms), "coldMs": sel[0]["workerMs"],
                    "p50Ms": _pct(ms, 0.5), "p95Ms": p95, "answers": answers,
                    "withinBudget": bool(p95 is not None and p95 <= budget_ms and answers == ["ok"])})
    return out


def _ticks(run, rows, ctx, slug, k_ticks):
    """B5: one full run with the newest bar FORMING leaves the session; then each tick
    changes only the forming bar's close. -> the per-tick turnarounds."""
    rows = [dict(b) for b in rows]
    full = run(rows, ctx)
    times = []
    answers = set()
    for k in range(k_ticks):
        last = dict(rows[-1])
        last["c"] = last["c"] + 0.01 * (k + 1)
        last["h"] = max(last["h"], last["c"])
        rows[-1] = last
        r = run(rows, ctx)
        times.append(r["ms"])
        answers.add("ok" if r["ok"] else r["guard"])
    return {"slug": slug, "fullMs": round(full["ms"], 1), "fullAnswer": "ok" if full["ok"] else full["guard"],
            "ticks": k_ticks, "tickP50Ms": round(_pct(times, 0.5), 1) if times else None,
            "tickP95Ms": round(_pct(times, 0.95), 1) if times else None,
            "tickMaxMs": round(max(times), 1) if times else None, "answers": sorted(answers)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker", required=True)
    ap.add_argument("--defs", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs", type=int, default=2, help="attempts per script and length (attempt 1 is cold)")
    ap.add_argument("--lengths", default="D 5000,5m 32000", help="comma-separated: 'D 5000', '5m 32000'")
    ap.add_argument("--slugs", default="", help="comma-separated slugs; empty = every document in --defs")
    ap.add_argument("--symbol", default="", help="TICKER:EXCHANGE handed to every run, as a chart does")
    ap.add_argument("--cpu-throttle", type=float, default=0.0,
                    help="also measure on a low-end profile, Chromium's CPU throttle at this rate")
    ap.add_argument("--checkpoint", type=int, default=0, help="B5: ticks of the forming bar after one full run")
    args = ap.parse_args(argv)
    from playwright.sync_api import sync_playwright

    worker_src = Path(args.worker).read_bytes()
    data = json.loads(Path(args.defs).read_text(encoding="utf-8"))
    bars = data["bars"]
    lengths = [s.strip() for s in args.lengths.split(",") if s.strip()]
    slugs = {s.strip() for s in args.slugs.split(",") if s.strip()}
    entries = [e for e in data["defs"] if not slugs or e["slug"] in slugs]
    symbol = None
    if args.symbol:
        ticker, _, exchange = args.symbol.partition(":")
        symbol = {"ticker": ticker, "exchange": exchange or None}
    ctx_of = {"D 5000": {"tf": "D", "newestBarIsForming": False, "historyFromListing": True},
              "5m 32000": {"tf": "5", "newestBarIsForming": False, "historyFromListing": True}}

    def ctx_for(length, forming=False):
        ctx = dict(ctx_of[length])
        if forming:
            ctx["newestBarIsForming"] = True
        if symbol:
            ctx["symbol"] = symbol
        return ctx

    result = {"worker": str(args.worker), "workerBytes": len(worker_src), "runs": [],
              "options": {"runs": args.runs, "lengths": lengths, "slugs": sorted(slugs), "symbol": args.symbol,
                          "cpuThrottle": args.cpu_throttle, "checkpoint": args.checkpoint}}
    exit_code = 0
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

        def worker_run(rows, ctx, def_):
            msg = {"id": 1, "def": plain_def(def_), "rows": rows, "ctx": ctx}
            # ⛔ stage the message INTO the page first and let frames settle:
            # Playwright's own transfer of 32,000 rows blocks the page for ~1 s
            # and must not be scored as the product's cost.
            page.evaluate("(m) => { window.__msg = m }", msg)
            page.wait_for_timeout(300)
            return page.evaluate("async () => { const r = await __run(window.__w, window.__msg); "
                                 "return {...r, postMs: window.__postMs, main: __window(r.t0, r.t1)}; }")

        for entry in entries:
            for length in lengths:
                rows = bars[length]
                for k in range(args.runs):  # first run includes fetching/compiling the bundle
                    r = worker_run(rows, ctx_for(length), entry["def"])
                    worst = max(worst, r["main"]["maxFrameGapMs"])
                    result["runs"].append({"slug": entry["slug"], "length": length, "attempt": k + 1,
                                           "workerMs": round(r["ms"], 1), "postMessageMs": round(r["postMs"], 1),
                                           "ok": r["ok"], "guard": r["guard"],
                                           "columns": r["columns"], **{f"main_{a}": round(b, 1) for a, b in r["main"].items()}})
                    print(f"{entry['slug'][:34]:34} {length:9} #{k+1}: worker {r['ms']:7.1f} ms (post {r['postMs']:.0f} ms) "
                          f"{'ok' if r['ok'] else r['guard']}; main longest task {r['main']['longestTaskMs']:.0f} ms, "
                          f"max frame gap {r['main']['maxFrameGapMs']:.0f} ms over {r['main']['frames']} frames")
        result["summary"] = _summary(result["runs"])

        if args.checkpoint and "D 5000" in bars:
            # ⭐ B5 in the REAL worker: the session lives in the worker module, as in the product
            result["checkpoint"] = []
            for entry in entries:
                def tick_run(rows, ctx, d=entry["def"]):
                    page.evaluate("(m) => { window.__msg = m }", {"id": 1, "def": plain_def(d), "rows": rows, "ctx": ctx})
                    return page.evaluate("async () => await __run(window.__w, window.__msg)")
                c = _ticks(tick_run, bars["D 5000"], ctx_for("D 5000", forming=True), entry["slug"], args.checkpoint)
                result["checkpoint"].append(c)
                print(f"B5 {entry['slug'][:34]:34} full {c['fullMs']} ms ({c['fullAnswer']}); "
                      f"tick p50 {c['tickP50Ms']} / p95 {c['tickP95Ms']} / max {c['tickMaxMs']} ms {c['answers']}")

        if args.cpu_throttle:
            emu = browser.new_page()
            emu.route(f"{ORIGIN}/", lambda r: r.fulfill(status=200, content_type="text/html", body=EMU_PAGE))
            emu.route(f"{ORIGIN}/w.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=worker_src))
            emu.goto(f"{ORIGIN}/")
            if not emu.evaluate(f"__load('{ORIGIN}/w.js')"):
                result["lowEnd"] = {"verdict": "INCONCLUSIVE: the bundle did not install its handler on the stand-in"}
                exit_code = 2
            else:
                cdp = emu.context.new_cdp_session(emu)
                emu.evaluate(f"__busy({BUSY_N})")  # warm the loop's JIT before timing it
                base = sorted(emu.evaluate(f"__busy({BUSY_N})") for _ in range(3))[1]
                cdp.send("Emulation.setCPUThrottlingRate", {"rate": args.cpu_throttle})
                slow = sorted(emu.evaluate(f"__busy({BUSY_N})") for _ in range(3))[1]
                ratio = slow / base if base else 0.0
                low = {"rate": args.cpu_throttle, "control": {"busyMs": round(base, 1), "throttledBusyMs": round(slow, 1),
                                                              "ratio": round(ratio, 2)}, "runs": []}
                print(f"low-end control: busy loop {base:.0f} ms -> {slow:.0f} ms throttled "
                      f"(x{ratio:.2f}, asked x{args.cpu_throttle:g})")
                if ratio < THROTTLE_FLOOR * args.cpu_throttle:
                    low["verdict"] = (f"INCONCLUSIVE: the throttle reached x{ratio:.2f}, under "
                                      f"{THROTTLE_FLOOR:g} of the x{args.cpu_throttle:g} asked")
                    exit_code = 2
                else:
                    def emu_run(rows, ctx, d):
                        emu.evaluate("(m) => { window.__msg = m }", {"id": 1, "def": plain_def(d), "rows": rows, "ctx": ctx})
                        return emu.evaluate("async () => await __runHere(window.__msg)")
                    for entry in entries:
                        for length in lengths:
                            for k in range(args.runs):
                                r = emu_run(bars[length], ctx_for(length), entry["def"])
                                low["runs"].append({"slug": entry["slug"], "length": length, "attempt": k + 1,
                                                    "workerMs": round(r["ms"], 1), "ok": r["ok"], "guard": r["guard"]})
                                print(f"LOW-END x{args.cpu_throttle:g} {entry['slug'][:28]:28} {length:9} #{k+1}: "
                                      f"{r['ms']:7.1f} ms {'ok' if r['ok'] else r['guard']}")
                    low["summary"] = _summary(low["runs"])
                    if args.checkpoint and "D 5000" in bars:
                        low["checkpoint"] = []
                        for entry in entries:
                            c = _ticks(lambda rows, ctx, d=entry["def"]: emu_run(rows, ctx, d), bars["D 5000"],
                                       ctx_for("D 5000", forming=True), entry["slug"], args.checkpoint)
                            low["checkpoint"].append(c)
                            print(f"LOW-END B5 {entry['slug'][:28]:28} full {c['fullMs']} ms ({c['fullAnswer']}); "
                                  f"tick p50 {c['tickP50Ms']} / p95 {c['tickP95Ms']} / max {c['tickMaxMs']} ms {c['answers']}")
                    low["verdict"] = "MEASURED"
                result["lowEnd"] = low
            emu.close()
        browser.close()
    result["worstMainFrameGapMs"] = worst
    result["verdict"] = "BLOCKED" if worst >= 100 else "OFF-MAIN-THREAD"
    Path(args.out).write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(f"control: longest task {ctl['longestTaskMs']:.0f} ms, max frame gap {ctl['maxFrameGapMs']:.0f} ms")
    print(f"VERDICT: {result['verdict']} (worst main-thread frame gap during worker runs: {worst:.0f} ms)")
    if worst >= 100:
        return 1
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
