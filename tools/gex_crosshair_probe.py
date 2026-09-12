"""GEX crosshair lag — the measured reproduction. TRACE, not a guess.

⛔ THE INSTRUMENT TRAP THIS MUST NOT FALL INTO: a synthetic pointer move that does
not reach the handler a real pointer reaches measures nothing. lightweight-charts
binds native listeners on its own canvas, and an untrusted
`dispatchEvent(new PointerEvent(...))` can be ignored by paths a real pointer
drives. Playwright's mouse.move goes through CDP Input.dispatchMouseEvent, which
produces TRUSTED events on the normal input pipeline — but that is an assumption
until verified, so `verify_drives_crosshair()` proves the crosshair actually
responds before any latency number is kept.
"""
import json, os, statistics, sys, time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="backslashreplace")
    except Exception:
        pass

BASE = "https://uctintelligence.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

# In-page instrumentation. No app file is edited; everything here is observation.
INSTRUMENT = """
(() => {
  const S = {
    events: [],        // Event Timing entries for pointermove
    longtasks: [],     // >50ms tasks
    loaf: [],          // long animation frames, WITH script attribution
    frames: [],        // rAF timestamps -> intervals, dropped frames
    domMutations: [],  // timestamped DOM changes inside the chart (legend etc)
    moves: [],         // our own dispatch marks
  };
  window.__gex = S;

  try {
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) {
        if (e.name === 'pointermove') S.events.push({
          startTime: e.startTime, processingStart: e.processingStart,
          processingEnd: e.processingEnd, duration: e.duration });
      }
    }).observe({type: 'event', durationThreshold: 0, buffered: true});
  } catch (e) { S.eventObsError = String(e).slice(0, 80); }

  try {
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) S.longtasks.push({
        startTime: e.startTime, duration: e.duration,
        attribution: (e.attribution || []).map(a => ({
          name: a.name, containerType: a.containerType,
          containerSrc: a.containerSrc, containerName: a.containerName })) });
    }).observe({type: 'longtask', buffered: true});
  } catch (e) { S.longtaskObsError = String(e).slice(0, 80); }

  // ⭐ THE ONE THAT NAMES FUNCTIONS. LoAF attributes a slow frame to scripts with
  // sourceURL + sourceFunctionName + character position.
  try {
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) S.loaf.push({
        startTime: e.startTime, duration: e.duration,
        blockingDuration: e.blockingDuration, renderStart: e.renderStart,
        styleAndLayoutStart: e.styleAndLayoutStart,
        scripts: (e.scripts || []).map(s => ({
          name: s.name, entryType: s.entryType, invoker: s.invoker,
          invokerType: s.invokerType, sourceURL: s.sourceURL,
          sourceFunctionName: s.sourceFunctionName,
          sourceCharPosition: s.sourceCharPosition,
          duration: s.duration, forcedStyleAndLayoutDuration:
            s.forcedStyleAndLayoutDuration })) });
    }).observe({type: 'long-animation-frame', buffered: true});
  } catch (e) { S.loafObsError = String(e).slice(0, 80); }

  (function tick(t) { S.frames.push(t); requestAnimationFrame(tick); })(performance.now());

  window.__gexWatchDom = (sel) => {
    const root = document.querySelector(sel);
    if (!root) return false;
    new MutationObserver(() => S.domMutations.push(performance.now()))
      .observe(root, {childList: true, subtree: true, characterData: true});
    return true;
  };
  window.__gexMark = (x, y) => S.moves.push({t: performance.now(), x, y});
  window.__gexReset = () => {
    S.events.length = 0; S.longtasks.length = 0; S.loaf.length = 0;
    S.frames.length = 0; S.domMutations.length = 0; S.moves.length = 0;
  };
  return true;
})()
"""


# ⛔⛔ TWO OBSERVATION CHANNELS DO NOT EXIST ON THIS SURFACE. Measured
# 2026-09-12, and the non-vacuity control is what caught both:
#
#   1. Event Timing does NOT emit `pointermove`. Chrome reports discrete
#      interactions; a continuous move produces no `event` entry, so
#      `input_to_paint_ms` came back with n=0. It is NOT that no input arrived —
#      a listener attached directly to the chart canvas counted 5 pointermove
#      and 5 mousemove for 5 synthetic moves, and elementFromPoint at the drive
#      centre is the CANVAS. Synthetic moves DO reach the same handler.
#   2. This chart renders NO DOM legend that changes on crosshair move, so a
#      MutationObserver reports 0 for a crosshair that is working perfectly.
#      The crosshair here is canvas-only.
#
# ⭐ So the usable channels are: a listener on the canvas for input arrival,
# `long-animation-frame` for per-frame script ATTRIBUTION (this is the one that
# names functions), and rAF intervals for dropped frames. A pixel sample of the
# canvas is the only way to timestamp the crosshair actually moving; frame timing
# is the proxy until that is built.


def settle(page, timeout=45000):
    try:
        page.wait_for_function(
            "(() => { const t=(document.body&&document.body.innerText||'');"
            " return t.length > 800 && t.indexOf('CHARTING THE MARKET') === -1; })()",
            timeout=timeout)
    except Exception:                                       # noqa: BLE001
        pass


def open_gex_chart(page):
    """Navigate a MEMBER to GEX -> Chart with Levels. Returns the chart box."""
    page.goto(BASE + "/options-flow", wait_until="commit", timeout=60000)
    settle(page)
    page.get_by_role("button", name="GEX", exact=True).first.click()
    page.wait_for_selector("text=Chart with Levels", timeout=60000)
    page.get_by_text("Chart with Levels", exact=False).first.click()
    page.wait_for_selector("canvas", timeout=60000)
    page.wait_for_timeout(4000)                 # let bars + lines settle
    # ⛔ SCROLL IT INTO VIEW FIRST, THEN RE-READ THE BOX. `mouse.move` takes
    # VIEWPORT coordinates: the GEX chart sits at y~1125 in a 1000px viewport, so
    # a box read before scrolling points off-screen and every synthetic move lands
    # nowhere. Measured 2026-09-12: the non-vacuity control caught it as
    # `dom mutations=0`, which a naive harness would have published as "the
    # crosshair never responds" — a product bug that does not exist.
    page.evaluate("""(() => {
      const cs = Array.from(document.querySelectorAll('canvas'));
      let best = null;
      for (const c of cs) { const r = c.getBoundingClientRect();
        if (r.height > 200 && r.width > 300 && (!best || r.height*r.width >
            best.getBoundingClientRect().height*best.getBoundingClientRect().width))
          best = c; }
      if (best) best.scrollIntoView({block: 'center'});
      return !!best; })()""")
    page.wait_for_timeout(1200)
    # the tallest canvas in the GEX panel is the chart
    box = page.evaluate("""(() => {
      const cs = Array.from(document.querySelectorAll('canvas'));
      let best = null;
      for (const c of cs) { const r = c.getBoundingClientRect();
        if (r.height > 200 && r.width > 300 && (!best || r.height*r.width > best.h*best.w))
          best = {x: r.x, y: r.y, w: r.width, h: r.height}; }
      return best; })()""")
    if box:
        # ⛔ The requirement is DRIVABLE, not wholly visible. A 590px chart whose
        # last 5px fall below the fold is perfectly measurable; demanding full
        # containment refused a good surface on the first attempt. Intersect with
        # the viewport and drive inside the VISIBLE band.
        vh = page.evaluate("window.innerHeight")
        top = max(box["y"], 0.0)
        bot = min(box["y"] + box["h"], float(vh))
        vis_h = bot - top
        if vis_h < 200 or box["w"] < 300:
            print("  only %.0fpx of the chart is on screen (w=%.0f) - REFUSING to "
                  "measure" % (vis_h, box["w"]))
            return None
        box = {"x": box["x"], "y": top, "w": box["w"], "h": vis_h,
               "visible_of": box["h"]}
    return box


def verify_drives_crosshair(page, box):
    """NON-VACUITY CONTROL — prove a synthetic move actually moves the crosshair
    before any latency number is believed. The product's own answer is the
    OHLCV legend changing, so DOM mutations inside the chart are the evidence."""
    page.evaluate(INSTRUMENT)
    attached = page.evaluate("window.__gexWatchDom('canvas') || false")
    # watch the chart's PARENT, because the legend is a sibling of the canvas
    page.evaluate("""(() => {
      const c = document.querySelector('canvas');
      let n = c; for (let i = 0; i < 4 && n && n.parentElement; i++) n = n.parentElement;
      if (!n) return false;
      new MutationObserver(() => window.__gex.domMutations.push(performance.now()))
        .observe(n, {childList: true, subtree: true, characterData: true});
      return true; })()""")
    page.evaluate("window.__gexReset()")
    cx, cy = box["x"] + box["w"] / 2, box["y"] + box["h"] / 2
    for dx in (-120, -60, 0, 60, 120):
        page.mouse.move(cx + dx, cy)
        page.wait_for_timeout(120)
    page.wait_for_timeout(400)
    st = page.evaluate("({e: window.__gex.events.length, d: window.__gex.domMutations.length,"
                       " f: window.__gex.frames.length, vis: document.visibilityState})")
    ok = st["d"] > 0 and st["f"] > 0
    print("  CONTROL  pointermove entries=%d  dom mutations=%d  frames=%d  vis=%s  -> %s"
          % (st["e"], st["d"], st["f"], st["vis"],
             "synthetic moves DO drive the crosshair" if ok
             else "!! THEY DO NOT - every latency below would be meaningless"))
    return ok, st


def run_protocol(page, box, moves=60, span_ms=1000):
    """60 moves across the chart width in ~1s, then collect. Returns raw dict."""
    page.evaluate("window.__gexReset()")
    y = box["y"] + box["h"] / 2
    x0, x1 = box["x"] + 20, box["x"] + box["w"] - 20
    step_ms = max(int(span_ms / moves), 1)
    for i in range(moves):
        x = x0 + (x1 - x0) * i / float(moves - 1)
        page.evaluate("window.__gexMark(%f, %f)" % (x, y))
        page.mouse.move(x, y)
        page.wait_for_timeout(step_ms)
    page.wait_for_timeout(1200)                  # let the last paints land
    return page.evaluate("""(() => { const S = window.__gex; return {
      events: S.events, longtasks: S.longtasks, loaf: S.loaf,
      frames: S.frames, domMutations: S.domMutations, moves: S.moves,
      errs: {e: S.eventObsError, l: S.longtaskObsError, f: S.loafObsError}}; })()""")


def analyse(raw):
    ev = raw["events"]
    dur = sorted(e["duration"] for e in ev) if ev else []
    proc = sorted(e["processingEnd"] - e["processingStart"] for e in ev) if ev else []
    fr = raw["frames"]
    ivs = sorted(fr[i + 1] - fr[i] for i in range(len(fr) - 1)) if len(fr) > 1 else []
    dropped = sum(1 for v in ivs if v > 24.0)
    # perceived: each dispatched move -> first DOM change after it
    lat = []
    dm = sorted(raw["domMutations"])
    j = 0
    for m in raw["moves"]:
        while j < len(dm) and dm[j] < m["t"]:
            j += 1
        if j < len(dm):
            lat.append(dm[j] - m["t"])
    def pct(v, p):
        return v[min(int(len(v) * p), len(v) - 1)] if v else None
    return {
        "n_moves": len(raw["moves"]), "n_events": len(ev),
        "input_to_paint_ms": {"median": pct(dur, .5), "p95": pct(dur, .95),
                              "max": (dur[-1] if dur else None)},
        "handler_ms": {"median": pct(proc, .5), "p95": pct(proc, .95)},
        "move_to_dom_ms": {"median": pct(sorted(lat), .5), "p95": pct(sorted(lat), .95),
                           "n": len(lat)},
        "frames": len(fr), "frame_iv_median": pct(ivs, .5), "dropped_frames": dropped,
        "longtasks": len(raw["longtasks"]),
        "longtask_max_ms": max([t["duration"] for t in raw["longtasks"]] or [0]),
        "loaf": len(raw["loaf"]),
        "loaf_max_ms": max([f["duration"] for f in raw["loaf"]] or [0]),
        "errs": raw["errs"],
    }


def _rig():
    import importlib.util
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "tools", "flow_cold_paint_rig.py")
    if not os.path.exists(p):
        p = r"C:/Users/Patrick/uct-worktrees/flow-watch-rail/tools/flow_cold_paint_rig.py"
    spec = importlib.util.spec_from_file_location("rig", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main(runs=1, label="GEX BEFORE", hook=None, out=None):
    rig = _rig()
    up = rig._uptime()
    print("=" * 74)
    print("%s — pod uptime %ss (floor %s)" % (label, up, rig.MIN_POD_AGE_S))
    if up is None or up < rig.MIN_POD_AGE_S:
        print("  INCONCLUSIVE: pod too young / unreadable. Nothing measured.")
        return 2
    from playwright.sync_api import sync_playwright
    rows = []
    with sync_playwright() as pw:
        for i in range(1, runs + 1):
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(user_agent=UA, viewport={"width": 1600, "height": 1000})
            try:
                rig._pace_login()
                r = ctx.request.post(BASE + "/api/auth/login",
                                     data={"email": os.environ["MEMBER_SMOKE_EMAIL"],
                                           "password": os.environ["MEMBER_SMOKE_PASSWORD"]})
                if r.status != 200:
                    print("  run %d: login http %s -> INCONCLUSIVE" % (i, r.status))
                    continue
                page = ctx.new_page()
                box = open_gex_chart(page)
                if not box:
                    print("  run %d: no chart canvas found" % i); continue
                ok, st = verify_drives_crosshair(page, box)
                if not ok:
                    print("  run %d: harness cannot drive the crosshair -> STOP" % i)
                    return 2
                if hook:
                    hook(page)
                a = analyse(run_protocol(page, box))
                a["run"] = i
                rows.append(a)
                print("  run %d | input->paint med=%sms p95=%sms | move->dom med=%sms "
                      "p95=%sms | frames=%d dropped=%d | longtasks=%d(max %.0fms) "
                      "| LoAF=%d(max %.0fms)"
                      % (i, a["input_to_paint_ms"]["median"], a["input_to_paint_ms"]["p95"],
                         a["move_to_dom_ms"]["median"], a["move_to_dom_ms"]["p95"],
                         a["frames"], a["dropped_frames"], a["longtasks"],
                         a["longtask_max_ms"], a["loaf"], a["loaf_max_ms"]))
            finally:
                ctx.close(); b.close()
    if rows and out:
        json.dump({"label": label, "rows": rows}, open(out, "w"), indent=1)
        print("  saved: %s" % out)
    return 0 if rows else 1


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--label", default="GEX BEFORE")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    raise SystemExit(main(a.runs, a.label, None, a.out))
