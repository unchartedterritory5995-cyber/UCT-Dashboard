"""Wave 13 lane 13H-3 -- DIAGNOSTIC-ONLY instrumented walk, not part of the lane's finish line.

Purpose: measure WHY the first two of three touch taps on an armed Horizontal Line tool are
lost inside a Notebook chart embed at 390 px, per docs/notebook/wave13-13h2.md sections 4-5 and
the run-19 raw evidence. This tool answers the mechanism question with a document-level,
CAPTURE-phase event log (sees every pointerdown/touchstart/mousedown/click BEFORE any
descendant's own stopPropagation can hide it from an observer at the same or a shallower node)
plus a DOM-identity tag on the chart's canvases (proves or disproves a node-view remount between
taps) and the server-side stored-annotation count per tap (same technique as
tools/notebook_w13h2_walk.py's `_lines_after_tap`). It also runs the IDENTICAL tap sequence
against the bare /charts page in the same sandbox for a same-build, same-run A/B control.

R-RAW: this script's own raw output (the full event log, per tap) is written to --out and must
be committed BEFORE being read for conclusions.

Reuses tools/notebook_perf_harness.py's Sandbox (same launcher, same shared-root tripwire) and
tools/notebook_w13h2_walk.py's bars fixture + note helpers. Never imports api.*.

Run from PowerShell, ports 8675-8679 (this lane's range):

    python tools/notebook_w13h3_diag_walk.py --data-dir '<scratch>\\w13h3-diag-data' --port 8675 `
        --out 'docs\\notebook\\evidence\\wave13-13h3\\diag-<sha>'
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
from notebook_w13h2_walk import (  # noqa: E402
    MEMBER, embeds, install_bars_route, open_note, read_note, type_slash, wait_stored,
)
from secret_scrub import brief, scrub  # noqa: E402

INSTRUMENT_JS = r"""() => {
  window.__diag = [];
  const describe = (t) => {
    if (!t || t.nodeType !== 1) return String(t);
    const embedBody = !!(t.closest && t.closest('[data-widget-embed-body]'));
    const pm = !!(t.closest && t.closest('.ProseMirror'));
    return t.tagName + '.' + String(t.className || '').slice(0, 50)
      + (embedBody ? '[in-embed-body]' : '') + (pm ? '[in-ProseMirror]' : '');
  };
  const EV_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
    'touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click'];
  for (const ty of EV_TYPES) {
    document.addEventListener(ty, (e) => {
      window.__diag.push({
        ty, t: Math.round(performance.now()), target: describe(e.target),
        pointerType: e.pointerType || null, isTrusted: e.isTrusted,
        cancelable: e.cancelable, defaultPrevented: e.defaultPrevented,
        touches: e.touches ? e.touches.length : null,
      });
    }, true); // document + capture: sees the event before any descendant's own stopPropagation
  }
  window.__tagCanvases = (scopeSel) => {
    const scope = scopeSel ? document.querySelector(scopeSel) : document;
    if (!scope) return [];
    return [...scope.querySelectorAll('canvas')].map((c) => {
      if (!c.__uctTag) c.__uctTag = 'c' + Math.random().toString(36).slice(2, 9);
      return c.__uctTag;
    });
  };
  window.__drain = () => window.__diag.splice(0);
}"""


def biggest_canvas_box(pg, container_locator):
    boxes = container_locator.locator("canvas").evaluate_all(
        "cs => cs.map(c => { const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })")
    big = [b for b in boxes if b[2] > 150 and b[3] > 120]
    return max(big, key=lambda b: b[2] * b[3]) if big else None


def tap_sequence(pg, w, canvas_box, tag, touch, scope_sel, req=None, base=None, nid=None,
                  container_locator=None, remeasure=False):
    """Arm (once), then tap 3 times, recording the full instrumentation per tap.

    remeasure=True re-reads the biggest canvas's bounding box immediately before EVERY tap
    (via container_locator) instead of reusing the box measured once before any tool was armed
    -- the test for "does arming a specific drawing tool change the canvas's own geometry, so a
    position computed before arming it is stale by the time of a later tap"."""
    placed = 0
    for i, frac in enumerate((0.28, 0.5, 0.72)):
        box = canvas_box
        if remeasure and container_locator is not None:
            fresh = biggest_canvas_box(pg, container_locator)
            if fresh:
                box = fresh
        x0, y0, cw, ch = box
        before_tags = pg.evaluate("sel => window.__tagCanvases(sel)", scope_sel)
        pg.evaluate("() => window.__drain()")
        x, y = x0 + cw * 0.45, y0 + ch * frac
        elt_at_point = pg.evaluate(
            """([x, y]) => {
              const chain = [];
              let el = document.elementFromPoint(x, y);
              let d = el;
              while (d && chain.length < 8) {
                const r = d.getBoundingClientRect();
                chain.push({ tag: d.tagName, cls: String(d.className || '').slice(0, 60),
                  rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                  pe: getComputedStyle(d).pointerEvents, z: getComputedStyle(d).zIndex,
                  pos: getComputedStyle(d).position });
                d = d.parentElement;
              }
              return chain;
            }""", [x, y])
        if touch:
            pg.touchscreen.tap(x, y)
        else:
            pg.mouse.click(x, y)
        placed += 1
        pg.wait_for_timeout(500)
        events = pg.evaluate("() => window.__drain()")
        after_tags = pg.evaluate("sel => window.__tagCanvases(sel)", scope_sel)
        remounted = sorted(before_tags) != sorted(after_tags)
        row = {
            "attempt": placed, "frac": frac, "x": round(x, 1), "y": round(y, 1),
            "box_used": list(box), "remeasured": remeasure,
            "element_from_point_chain": elt_at_point,
            "canvas_tags_before": before_tags, "canvas_tags_after": after_tags,
            "canvas_remounted": remounted, "events": events,
        }
        if req is not None and nid is not None:
            n = read_note(req, base, nid)
            embs = embeds((n or {}).get("bodyJson") or {})
            lines_now = [d for d in (embs[0].get("annotations") or []) if d.get("type") == "horizontal"] if embs else []
            row["stored_count_after_500ms"] = len(lines_now)
        w.setdefault(f"{tag}_taps", []).append(row)
    return placed


def run_embed(br, state, base, req, w: dict, width: int, served: list, remeasure: bool = False):
    import re
    touch = width < 640
    tag = f"embed_V{width}" + ("_remeasured" if remeasure else "")
    ctx = br.new_context(viewport={"width": width, "height": 900 if not touch else 844}, is_mobile=touch,
                         has_touch=touch, reduced_motion="reduce", storage_state=state)
    install_bars_route(ctx, served)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(scrub(str(e))[:300]))
    note = req.post(base + "/api/j2/notes", data={"title": f"diag embed {width}", "bodyJson": {
        "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "The plan:"}]}]}})
    nid = note.json()["note"]["id"]
    open_note(pg, base, nid)
    type_slash(pg, "/chart NVDA D 2026-06-15", "Chart — NVDA · D @ Jun 15, 2026", touch)
    frame = pg.locator('[data-widget-embed-view="chart"]').first
    frame.wait_for(state="visible", timeout=30000)
    wait_stored(req, base, nid, lambda e: any((a.get("params") or {}).get("symbol") == "NVDA" for a in e))
    pg.wait_for_timeout(4200)  # past the self-archive settle window, same idiom as the h2 walk

    pg.evaluate(INSTRUMENT_JS)
    frame.evaluate("el => el.scrollIntoView({block: 'center', inline: 'nearest'})")
    if not touch:
        frame.hover()
    draw_btn = frame.get_by_role("button", name="Draw", exact=True)
    draw_btn.first.wait_for(state="visible", timeout=20000)
    if touch:
        draw_btn.first.tap()
    else:
        draw_btn.first.click()
    pg.wait_for_timeout(300)

    canvas_box = None
    for _ in range(40):
        boxes = frame.locator("canvas").evaluate_all(
            "cs => cs.map(c => { const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })")
        big = [b for b in boxes if b[2] > 150 and b[3] > 120]
        if big:
            canvas_box = max(big, key=lambda b: b[2] * b[3])
            break
        pg.wait_for_timeout(250)
    w[f"{tag}_canvas_box"] = canvas_box
    if not canvas_box:
        w[f"{tag}_error"] = "no canvas box found"
        ctx.close()
        return

    tool = pg.get_by_role("button", name=re.compile(r"^Horizontal Line"))
    tool.first.wait_for(state="visible", timeout=15000)
    if touch:
        tool.first.tap()
    else:
        tool.first.click()
    pg.wait_for_timeout(300)
    armed_info = tool.first.evaluate(
        "el => ({ariaPressed: el.getAttribute('aria-pressed'), boxShadow: getComputedStyle(el).boxShadow})")
    w[f"{tag}_armed_after_press"] = armed_info
    # Which toolbar is actually mounted (MobileDrawBar sets aria-pressed; ChartToolbar does not)
    w[f"{tag}_mobile_draw_bar_present"] = pg.locator('[data-testid="mobile-draw-bar"]').count() > 0

    # Re-measure the canvas box AFTER the Horizontal Line tool is armed (the 13H-2 walk, and
    # this walk above, both measured it BEFORE arming any specific tool) -- does ChartToolbar
    # change the canvas's own geometry once a tool (not just Draw mode) is armed?
    canvas_box_after_arm = None
    boxes2 = frame.locator("canvas").evaluate_all(
        "cs => cs.map(c => { const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })")
    big2 = [b for b in boxes2 if b[2] > 150 and b[3] > 120]
    if big2:
        canvas_box_after_arm = max(big2, key=lambda b: b[2] * b[3])
    w[f"{tag}_canvas_box_after_tool_armed"] = canvas_box_after_arm

    tap_sequence(pg, w, canvas_box, tag, touch, '[data-widget-embed-view="chart"]', req=req, base=base, nid=nid,
                 container_locator=frame, remeasure=remeasure)
    w[f"{tag}_errors"] = errors
    ctx.close()


def run_bare_charts(br, state, base, w: dict, width: int, served: list):
    import re
    touch = width < 640
    tag = f"bare_V{width}"
    ctx = br.new_context(viewport={"width": width, "height": 900 if not touch else 844}, is_mobile=touch,
                         has_touch=touch, reduced_motion="reduce", storage_state=state)
    install_bars_route(ctx, served)
    # 13H-4: arm the tool ONCE, same as the original diagnostic always did, but
    # the 3 taps `tap_sequence` places afterward assume the tool STAYS armed
    # across all three -- true only with Repeat ON. StockChart defaults
    # Repeat OFF (`localStorage.getItem('uct-draw-repeat') === 'true'`), so a
    # fresh sandbox browser (empty storage) reverts to cursor after the FIRST
    # placed line, and taps 2-3 land on an unarmed canvas (measured: 3 taps,
    # 1 line, no amount of settle-wait changes it -- it is not a timing race).
    # Setting this via `add_init_script` is what turning the REAL Repeat
    # toggle on does, not a bypass of it.
    # ⛔ `add_init_script` EVALUATES THE STRING AS A RAW SCRIPT, it does not
    # call a function the way `page.evaluate()` does -- an arrow-function
    # STRING here would define-and-discard an unused function and never run
    # the body (measured: `bare_V390_repeat_flag` read back `None` with that
    # form). A plain top-level statement is what actually executes.
    ctx.add_init_script("try { localStorage.setItem('uct-draw-repeat', 'true') } catch (e) {}")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(scrub(str(e))[:300]))
    pg.goto(f"{base}/charts", wait_until="domcontentloaded")
    h._dismiss_intro(pg)
    pg.wait_for_timeout(2000)

    pg.evaluate(INSTRUMENT_JS)
    canvas_box = None
    for _ in range(40):
        boxes = pg.locator("canvas").evaluate_all(
            "cs => cs.map(c => { const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })")
        big = [b for b in boxes if b[2] > 150 and b[3] > 120]
        if big:
            canvas_box = max(big, key=lambda b: b[2] * b[3])
            break
        pg.wait_for_timeout(250)
    w[f"{tag}_canvas_box"] = canvas_box
    if not canvas_box:
        w[f"{tag}_error"] = "no canvas box found"
        ctx.close()
        return

    tool = pg.get_by_role("button", name=re.compile(r"^Horizontal Line"))
    try:
        tool.first.wait_for(state="visible", timeout=8000)
    except Exception:
        # 13H-4: the mobile /charts shell's drawbar is collapsed behind a
        # TWO-step door, not one -- "More tools" (MobileChartToolbar.jsx)
        # opens a sheet (MobileMoreSheet.jsx) whose "Draw on chart" row calls
        # StockChart's expandDrawToolbar(). A bare `name=~"draw"` button does
        # not exist on the page until that sheet is open, so the direct
        # lookup below found nothing (`menu.count()==0`) and the original
        # fallback skipped straight to waiting for "^Horizontal", timing out
        # with the drawbar never opened (measured:
        # docs/notebook/evidence/wave13-13h4/charts-control/ before this fix).
        menu = pg.get_by_role("button", name=re.compile(r"draw", re.I))
        if not menu.count():
            more = pg.get_by_role("button", name=re.compile(r"^More tools"))
            if more.count():
                (more.first.tap() if touch else more.first.click())
                pg.wait_for_timeout(300)
                menu = pg.get_by_role("button", name=re.compile(r"draw", re.I))
        if menu.count():
            (menu.first.tap() if touch else menu.first.click())
        tool = pg.get_by_role("button", name=re.compile(r"^Horizontal"))
        tool.first.wait_for(state="visible", timeout=15000)
    if touch:
        tool.first.tap()
    else:
        tool.first.click()
    pg.wait_for_timeout(300)
    armed_info = tool.first.evaluate(
        "el => ({ariaPressed: el.getAttribute('aria-pressed'), boxShadow: getComputedStyle(el).boxShadow})")
    w[f"{tag}_armed_after_press"] = armed_info
    w[f"{tag}_mobile_draw_bar_present"] = pg.locator('[data-testid="mobile-draw-bar"]').count() > 0

    # 13H-4: NOT `tap_sequence` here -- it reads `canvas_box` ONCE, before any
    # tap, and reuses it for all three. Measured: on the bare /charts page the
    # FIRST placed line widens the right price-scale (to fit the new price
    # label), shrinking the drawing overlay canvas (z-index 4 -- the one
    # `onPointerDown` actually lives on, ChartDrawingOverlay.jsx) out from
    # under the stale box, so taps 2-3 land on the plain candle-pane canvas
    # underneath instead (z-index 2, `elementFromPoint` confirmed this: 390x736
    # -> 314x622 after tap 1). Re-measure the z-4 canvas fresh before EVERY
    # tap, the same principle tools/notebook_w13h2_walk.py's own
    # `biggest_canvas_box` comment already states for the Notebook embed
    # ("arming the tool can itself scroll the page ... moves every VIEWPORT-
    # relative coordinate") -- here the resize is a SECOND cause of the same
    # "a box read once can go stale" class, not a new principle.
    def overlay_box():
        return pg.evaluate(
            "() => { const cs = [...document.querySelectorAll('canvas')]"
            ".filter(c => getComputedStyle(c).zIndex === '4'); "
            "if (!cs.length) return null; const r = cs[0].getBoundingClientRect(); "
            "return [r.x, r.y, r.width, r.height] }")
    count_js_inline = ("() => { try { const all = JSON.parse(localStorage.getItem('uct-chart-drawings') || '{}'); "
                        "return Object.values(all).flat().filter(d => d && d.type === 'horizontal').length } "
                        "catch { return -1 } }")
    w[f"{tag}_repeat_flag"] = pg.evaluate("() => localStorage.getItem('uct-draw-repeat')")
    placed = 0
    for frac in (0.28, 0.5, 0.72):
        box = overlay_box() or canvas_box
        x0, y0, cw, ch = box
        x, y = x0 + cw * 0.45, y0 + ch * frac
        armed_before_tap = tool.first.evaluate(
            "el => ({ariaPressed: el.getAttribute('aria-pressed'), boxShadow: getComputedStyle(el).boxShadow})")
        if touch:
            pg.touchscreen.tap(x, y)
        else:
            pg.mouse.click(x, y)
        placed += 1
        pg.wait_for_timeout(400)
        armed_after_tap = tool.first.evaluate(
            "el => ({ariaPressed: el.getAttribute('aria-pressed'), boxShadow: getComputedStyle(el).boxShadow})")
        w.setdefault(f"{tag}_taps", []).append({
            "frac": frac, "box": list(box), "x": round(x, 1), "y": round(y, 1),
            "armed_before_tap": armed_before_tap, "armed_after_tap": armed_after_tap,
            "count_after_tap": pg.evaluate(count_js_inline),
        })
    # 13H-4: the bare /charts page has no note to store a server-side
    # annotation against -- its drawings persist to localStorage
    # ('uct-chart-drawings', keyed by symbol -- drawingsStore.js) instead of a
    # j2_notes row, so `tap_sequence`'s own req/nid-based `stored_count_after_
    # 500ms` (wired for the Notebook embed) is never populated here. Read the
    # same fact from its own storage: count every `type: 'horizontal'`
    # drawing across all symbols (a fresh sandbox browser has none but the
    # ones these taps just placed).
    #
    # SETTLE, don't sample once: tools/notebook_w13h2_walk.py's own
    # draw_three_lines learned this the hard way on this exact widget ("the
    # final count ... was 1, not 3" on a flat wait) -- poll for up to 10s for
    # the count to reach `placed` before reading a final (possibly still
    # mid-flight) number.
    count_js = ("() => { try { const all = JSON.parse(localStorage.getItem('uct-chart-drawings') || '{}'); "
                "return Object.values(all).flat().filter(d => d && d.type === 'horizontal').length } "
                "catch { return -1 } }")
    stored = pg.evaluate(count_js)
    settle_tries = 0
    while stored < placed and settle_tries < 20:
        pg.wait_for_timeout(500)
        stored = pg.evaluate(count_js)
        settle_tries += 1
    w[f"{tag}_drawings_stored"] = stored
    w[f"{tag}_drawings_settle_tries"] = settle_tries
    w[f"{tag}_errors"] = errors
    ctx.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8675)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if not 8675 <= args.port <= 8679:
        print("REFUSED: this lane's walk uses ports 8675-8679 only")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this walk never kills it")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    os.environ.update({"NOTEBOOK_CHART_PLAN_ENABLED": "1"})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    w: dict = {}
    failure = not_run = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            try:
                from playwright.sync_api import sync_playwright
                served: list = []
                with sync_playwright() as pw:
                    br = pw.chromium.launch()
                    admin_ctx = br.new_context()
                    ctx = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
                    req = ctx.request
                    h._provision(admin_ctx.request, req, base, member=MEMBER)
                    state = ctx.storage_state()
                    run_embed(br, state, base, req, w, 390, served, remeasure=False)
                    run_embed(br, state, base, req, w, 390, served, remeasure=True)
                    try:
                        run_bare_charts(br, state, base, w, 390, served)
                    except Exception as e:  # noqa: BLE001 -- the embed finding is the point; the control is extra
                        w["bare_V390_error"] = brief(e, 300)
                    br.close()
            except h.SetupFailed as e:
                not_run = scrub(str(e))[:300]
            except Exception as e:  # noqa: BLE001
                import traceback
                failure = f"the diag walk raised {brief(e, 400)}"
                w["traceback"] = scrub(traceback.format_exc())[-4000:]
            box.wait_checkpoint(h.POST_BOOT, 60)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    result = {"tool": "tools/notebook_w13h3_diag_walk.py", "base": base, "integrity": integ,
              "failure": failure, "not_run": not_run, "raw": w}
    (out / "walk.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT: FAIL -- {failure}")
        return 1
    print("VERDICT: DIAGNOSTIC COMPLETE -- see walk.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
