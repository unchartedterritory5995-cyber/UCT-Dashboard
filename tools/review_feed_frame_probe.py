"""WHAT IS EACH LONG FRAME? — correlate the feed's frame tail with real events.

⛔ WHY THIS EXISTS AND WHY IT COMES BEFORE ANY DEVICE TIME. The feed's frame
tail measured 33 ms / 167 ms / 667 ms across three identical runs. A worst frame
that swings by twenty times is not a number, it is an unanswered question, and
optimising from a guess is how a real cause survives a "fix". This run does not
optimise anything: it records WHAT COINCIDED with every long frame and reports
it, including the possibility that the probe itself is the cause.

⛔ NOTHING HERE TOUCHES PRODUCT CODE. Every signal is observable from outside:
  · long frames             — a rAF sampler, timestamped
  · long tasks              — PerformanceObserver('longtask'), the browser's own
  · chart mount / unmount   — MutationObserver on `.tv-lightweight-charts`
  · snapshot swap           — MutationObserver on the feed's `<img>` placeholder
  · skeleton swap           — MutationObserver on the skeleton node
  · bars arrival            — PerformanceObserver('resource') on /api/bars
  · scroll command          — the probe marks its own instruction
  · probe read              — the probe marks its OWN evaluate calls
The last one is the point: a harness that cannot see its own cost will happily
attribute itself to the product.

⚠️ A LONG FRAME IS A COINCIDENCE REPORT, NOT A CAUSE. This says what happened in
the same window; it does not prove causation, and the summary says so. What it
CAN do is rank the candidates so the next change is aimed at something measured.

Usage: python tools/review_feed_frame_probe.py [--base ...] [--cards 40]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from sandbox_account import SANDBOX_EMAIL, new_password, ensure_account  # noqa: E402

PASSWORD = new_password()
CRED = {"email": SANDBOX_EMAIL, "password": PASSWORD}

UNIVERSE = [
    "NVDA", "AMD", "AVGO", "MU", "TSLA", "META", "GOOG", "AMZN", "AAPL", "MSFT",
    "NFLX", "CRM", "ORCL", "ADBE", "INTC", "QCOM", "TXN", "AMAT", "LRCX", "KLAC",
    "PANW", "CRWD", "SNOW", "DDOG", "NET", "SHOP", "SQ", "PYPL", "COIN", "HOOD",
    "SMCI", "ARM", "MRVL", "ON", "TER", "ASML", "TSM", "UBER", "ABNB", "RBLX",
]
STORAGE_KEY = "uct.review.session"

# Installed BEFORE any app script, so nothing that happens during boot is missed.
INSTALL = r"""
window.__ev = [];
window.__frames = [];
// ⭐ CARRIED ON EVERY FRAME SAMPLE, not looked up afterwards. Reconstructing
// "which card, how many charts" by scanning the event list for the nearest
// preceding marker is a second derivation of a fact the sampler could simply
// record — and it silently guesses whenever two events share a millisecond.
//
// ⚰️ THIS COUNTER WAS A MUTATION TALLY AND IT READ ZERO ON EVERY FRAME while the
// feed was visibly drawing charts. lightweight-charts builds its node before the
// container is attached, so the observer saw a container with nothing in it and
// the predicate never matched — a column of confident zeros. It is now SAMPLED
// from the DOM once per card (39 queries a run, outside the frame path) because
// a number that cannot be wrong beats a cheaper one that can.
window.__chartCount = 0;
window.__card = 0;
const push = (kind, detail) => { window.__ev.push({ t: performance.now(), kind, detail: detail || null }); };
window.__mark = (kind, detail) => push(kind, detail);

// ── frames ────────────────────────────────────────────────────────────────
let last = performance.now();
const tick = (now) => {
  const dt = now - last;
  last = now;
  window.__frames.push({ t: now, dt: dt, charts: window.__chartCount, card: window.__card });
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

// ── long tasks: the browser's own verdict on main-thread blocking ─────────
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      push('longtask', { dur: Math.round(e.duration), start: Math.round(e.startTime),
        attribution: (e.attribution || []).map(a => a.name + ':' + (a.containerName || a.containerType || '')) });
    }
  }).observe({ entryTypes: ['longtask'] });
} catch (e) { push('longtask-unavailable'); }

// ── bars arriving ─────────────────────────────────────────────────────────
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (String(e.name).indexOf('/api/bars') === -1) continue;
      push('bars', { url: String(e.name).split('/api/bars')[1].slice(0, 40),
                     dur: Math.round(e.duration) });
    }
  }).observe({ entryTypes: ['resource'] });
} catch (e) { push('resource-unavailable'); }

// ── chart / placeholder churn ─────────────────────────────────────────────
const isChart = (n) => n.nodeType === 1 && (n.classList && n.classList.contains('tv-lightweight-charts')
  || (n.querySelector && n.querySelector('.tv-lightweight-charts')));
const shotOf = (n) => (n.nodeType === 1 && n.getAttribute && (n.getAttribute('data-testid') || '').indexOf('feed-shot-') === 0)
  ? n.getAttribute('data-testid') : null;
const skelOf = (n) => (n.nodeType === 1 && n.getAttribute && (n.getAttribute('data-testid') || '').indexOf('feed-skeleton-') === 0)
  ? n.getAttribute('data-testid') : null;
new MutationObserver((muts) => {
  for (const m of muts) {
    for (const n of m.addedNodes) {
      if (isChart(n)) push('chart+');
      const s = shotOf(n); if (s) push('shot+', s);
      const k = skelOf(n); if (k) push('skel+', k);
    }
    for (const n of m.removedNodes) {
      if (isChart(n)) push('chart-');
      const s = shotOf(n); if (s) push('shot-', s);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
"""

# The snapshot path, timed in isolation. ⛔ NOT a re-implementation for its own
# sake: `captureSnapshot` runs `drawImage` + `toDataURL('image/webp')` on unmount,
# which is synchronous main-thread work and the most plausible product suspect for
# a long frame. Timing the identical operations on a REAL chart canvas answers
# "could this be it" without adding a permanent instrument to product code.
SNAP_COST = r"""
() => {
  const all = [...document.querySelectorAll('.tv-lightweight-charts canvas')];
  let best = null;
  for (const c of all) { const a = (c.width||0)*(c.height||0); if (a > 0 && (!best || a > best.a)) best = { c, a }; }
  if (!best) return null;
  const src = best.c;
  const runs = [];
  for (let i = 0; i < 8; i++) {
    const t0 = performance.now();
    const scale = Math.min(1, 320 / (src.width || 320));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(src.width * scale));
    out.height = Math.max(1, Math.round(src.height * scale));
    const ctx = out.getContext('2d');
    ctx.drawImage(src, 0, 0, out.width, out.height);
    const url = out.toDataURL('image/webp', 0.6);
    runs.push({ ms: +(performance.now() - t0).toFixed(2), bytes: url.length });
  }
  return { srcW: src.width, srcH: src.height, runs };
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8093")
    ap.add_argument("--cards", type=int, default=40)
    ap.add_argument("--out", default="tools/review_feed_probe_out/frames")
    # ⛔ THE CONTROL THAT CAN FALSIFY THE WHOLE MEASUREMENT. Same browser, same
    # page, same feed, same duration — and NO scrolling. If an idle feed shows
    # the same long-frame rate, the tail is the environment's rAF scheduling and
    # has nothing to do with the product. A performance number with no idle
    # control is a claim about a browser dressed up as a claim about a feature.
    ap.add_argument("--control", action="store_true",
                    help="idle instead of scrolling — the falsification run")
    # ⛔ ABLATION, NOT INSPECTION. Correlation named a suspect; only removing it
    # can promote that to a cause. `captureSnapshot` already treats a failing
    # `toDataURL` as "no snapshot" and falls back to the skeleton, so breaking
    # that ONE call from outside disables the snapshot path exactly — no product
    # edit, no flag, and the rest of the feed behaves identically.
    ap.add_argument("--no-snapshot", action="store_true",
                    help="ablate the snapshot capture and re-measure the tail")
    # ⛔⛔ THE HARNESS ABLATION. Driving the scroll with one `page.evaluate` per
    # card puts TWO CDP round-trips on the main thread per transition, inside the
    # window being measured — the instrument standing in its own photograph.
    # Self-drive installs a timer loop INSIDE the page and then touches nothing
    # until the end, so the frames recorded are the product's alone.
    ap.add_argument("--selfdrive", action="store_true",
                    help="drive the scroll from inside the page — zero round-trips while measuring")
    # ⛔ THE SUSPECT FOR THE 667 ms OUTLIER, and it is the instrument. Under
    # `--enable-precise-memory-info` a `performance.memory` read is not a cheap
    # property fetch — it can walk (or force a collection over) the whole heap.
    # The heap probe reads it once per card; this frame probe does not, and the
    # outlier only ever appeared in the heap probe. Adding the read here is the
    # experiment that settles it.
    ap.add_argument("--mem-read", action="store_true",
                    help="read performance.memory once per card, as the heap probe does")
    args = ap.parse_args()

    seen, ordered = set(), []
    for s in (UNIVERSE * ((args.cards // len(UNIVERSE)) + 1))[: args.cards]:
        if s not in seen:
            seen.add(s)
            ordered.append(s)

    ensure_account(args.base, PASSWORD)
    from playwright.sync_api import sync_playwright

    session = {"v": 1, "source": "scan", "sourceId": "probe", "label": "Frame probe",
               "sort": None, "symbols": ordered, "index": 0, "reviewed": [ordered[0]],
               "pending": True}
    seed = ("try { sessionStorage.setItem(%s, %s) } catch (e) {}"
            % (json.dumps(STORAGE_KEY), json.dumps(json.dumps(session))))

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--js-flags=--expose-gc", "--enable-precise-memory-info"])
        boot = browser.new_context()
        r = boot.request.post(f"{args.base}/api/auth/login", data=CRED)
        if r.status != 200:
            print(f"login failed: {r.status}")
            return 2
        state = boot.storage_state()
        boot.close()

        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                  has_touch=True, device_scale_factor=3, storage_state=state)
        page = ctx.new_page()
        page.add_init_script(seed)
        page.add_init_script(INSTALL)
        if args.no_snapshot:
            page.add_init_script(
                "HTMLCanvasElement.prototype.toDataURL = function () "
                "{ throw new Error('ablated') };")
        page.goto(f"{args.base}/charts?sym={ordered[0]}&tf=D", wait_until="domcontentloaded")

        try:
            page.wait_for_selector("[data-review-nav]", timeout=45000)
        except Exception:
            print("REFUSED: no review control — nothing measured.")
            return 4

        page.evaluate("() => window.__mark('open-feed')")
        page.click("[data-review-nav] button:nth-of-type(2)")
        page.wait_for_selector("[data-testid='feed-scroll']", timeout=20000)
        page.wait_for_timeout(2000)

        # ⚠️ The cost probe calls the very function the ablation breaks, so it is
        # skipped there — measuring it under the ablation would either throw (it
        # did) or report the cost of a path that is switched off.
        snap_cost = None if args.no_snapshot else page.evaluate(SNAP_COST)

        page.evaluate("() => window.__mark('scroll-begin')")
        card_h = page.evaluate(
            "() => { const c = document.querySelector('[data-feed-index]');"
            " return c ? Math.round(c.getBoundingClientRect().height) : 400 }")

        if args.selfdrive:
            page.evaluate(
                """(cfg) => {
                  const el = document.querySelector("[data-testid='feed-scroll']")
                  let i = 1
                  const step = () => {
                    if (i >= cfg.n) { window.__mark('scroll-end'); return }
                    window.__card = i
                    window.__chartCount = document.querySelectorAll('.tv-lightweight-charts').length
                    window.__mark('scroll', cfg.h * i)
                    if (el) el.scrollTop = cfg.h * i
                    if (cfg.mem && performance.memory) {
                      const t0 = performance.now()
                      const used = performance.memory.usedJSHeapSize
                      window.__mark('mem-read', { ms: +(performance.now() - t0).toFixed(1), used: used })
                    }
                    i += 1
                    setTimeout(step, cfg.every)
                  }
                  setTimeout(step, cfg.every)
                }""", {"n": len(ordered), "h": card_h, "every": 320,
                      "mem": bool(args.mem_read)})
            page.wait_for_timeout(320 * len(ordered) + 1500)
            data = page.evaluate("() => ({ ev: window.__ev, frames: window.__frames })")
            ctx.close()
            browser.close()
            return _summarise(args, ordered, data, snap_cost, out)

        for i in range(1, len(ordered)):
            if not args.control:
                page.evaluate(
                    "(y) => { window.__mark('scroll', y); const el = document.querySelector(\"[data-testid='feed-scroll']\");"
                    " if (el) el.scrollTop = y }", card_h * i)
            page.wait_for_timeout(320)
            # ⛔ MARKED, so a spike caused by the harness reading the page cannot be
            # filed against the product.
            page.evaluate("() => { window.__mark('probe-read'); return document.querySelectorAll('.tv-lightweight-charts').length }")
        page.evaluate("() => window.__mark('scroll-end')")

        data = page.evaluate("() => ({ ev: window.__ev, frames: window.__frames })")
        ctx.close()
        browser.close()

    return _summarise(args, ordered, data, snap_cost, out)


def _summarise(args, ordered, data, snap_cost, out):
    frames = data["frames"]
    events = data["ev"]
    begin = next((e["t"] for e in events if e["kind"] == "scroll-begin"), 0)
    end = next((e["t"] for e in events if e["kind"] == "scroll-end"), 10 ** 12)
    during = [f for f in frames if begin <= f["t"] <= end]
    long_frames = [f for f in during if f["dt"] > 32]

    rows = []
    for f in long_frames:
        lo, hi = f["t"] - f["dt"] - 10, f["t"] + 10   # the frame's span, padded for
        # observer callbacks that land just after it
        inside = [e for e in events if lo <= e["t"] <= hi]
        kinds = [e["kind"] for e in inside]
        rows.append({
            "t": round(f["t"], 1),
            "dt": round(f["dt"], 1),
            "card": f.get("card"),
            "symbol": (ordered[f["card"]] if isinstance(f.get("card"), int)
                       and 0 <= f["card"] < len(ordered) else None),
            "charts": f.get("charts"),
            "events": kinds,
            "detail": [e for e in inside if e["kind"] in ("longtask", "bars", "shot+", "mem-read")][:3],
        })

    # Which event kinds accompany the long frames, and how often.
    tally = {}
    for r in rows:
        for k in set(r["events"]):
            tally[k] = tally.get(k, 0) + 1

    # The distribution is the tell: a main-thread block lands anywhere, while a
    # dropped vsync tick lands on an exact multiple of the display interval.
    def near_multiple(dt, base=16.67, tol=1.5):
        k = round(dt / base)
        return k >= 2 and abs(dt - k * base) <= tol

    multiples = [f for f in long_frames if near_multiple(f["dt"])]

    report = {
        "mode": ("idle-control" if args.control
                 else ("scroll-no-snapshot" if args.no_snapshot
                       else (("scroll-selfdrive-memread" if args.mem_read
                              else "scroll-selfdrive") if args.selfdrive else "scroll"))),
        "long_frames_on_vsync_multiple": len(multiples),
        "cards": len(ordered),
        "frames_during_scroll": len(during),
        "long_frames": len(long_frames),
        "worst_ms": round(max([f["dt"] for f in during] or [0]), 1),
        "coincidence_tally": dict(sorted(tally.items(), key=lambda kv: -kv[1])),
        "snapshot_cost": snap_cost,
        "rows": rows,
    }
    (out / "frames.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("=== FRAME TAIL CORRELATION ====================================")
    print(f"  mode                  {report['mode']}")
    print(f"  frames during scroll  {report['frames_during_scroll']}")
    print(f"  long frames (>32ms)   {report['long_frames']}")
    print(f"  worst frame           {report['worst_ms']} ms")
    print(f"  on a vsync multiple   {report['long_frames_on_vsync_multiple']}/{report['long_frames']}"
          "   <- an exact 2x/3x/4x of 16.67ms is a DROPPED TICK, not a blocked main thread")
    if snap_cost:
        ms = [r["ms"] for r in snap_cost["runs"]]
        print(f"  snapshot capture      {min(ms)}-{max(ms)} ms on a {snap_cost['srcW']}x{snap_cost['srcH']} canvas")
    print("  what coincided with a long frame:")
    for k, n in report["coincidence_tally"].items():
        print(f"     {n:>3} x {k}")
    print("  worst 15 frames:")
    print(f"     {'ms':>7}  {'t':<9} {'card':<5} {'symbol':<6} {'charts':<6} events")
    for r in sorted(rows, key=lambda r: -r["dt"])[:15]:
        print(f"     {r['dt']:>7}  {r['t']:<9} {str(r['card']):<5} {str(r['symbol'] or '-'):<6} "
              f"{str(r['charts']):<6} {','.join(r['events']) or '(nothing observed)'}")
    print(f"  report                {out / 'frames.json'}")
    print("===============================================================")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
