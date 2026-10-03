"""Wave 13 lane 13H-2 -- the real-browser walk for the chart plan (plan A.13H, the brief's seven
steps), at 1200 px (mouse + keyboard) and 390 px (touch).

It OWNS its sandbox (tools/notebook_perf_harness.py's `Sandbox`: scripts/hub_sandbox_boot.py through
the SIGBREAK shim, its own process group, stopped gracefully so the launcher's `finally` writes the
SHUTDOWN checkpoint). Its FIRST output line is the launcher's integrity verdict. It writes RAW
evidence only (walk.json, screenshots, the API reads it took) and draws no conclusion.

⛔ THIS DRIVER NEVER IMPORTS `api.*` (asserted by the last row).

⛔ THE BARS ARE A FIXTURE, AND SAID SO. The sandbox has no market vendor keys, so `/api/bars/<SYM>`
would answer empty and there would be nothing to draw on. The walk's browser contexts route that
ONE request to deterministic synthetic bars (`synth_bars`, recorded in walk.json with every request
it served). Everything else is the product: the chart, the drawing overlay, the panel, the plan
read by plan_extract on the server, the sizing, the alert row written by the existing alert route,
autosave, the slash menu.

Run from PowerShell (a Windows path through the Bash tool loses its backslash), ports 8615-8619:

    python tools/notebook_w13h2_walk.py --data-dir '<scratch>\\w13h2-walk-data' --port 8615 `
        --out 'docs\\notebook\\evidence\\wave13-13h2\\walk-<sha>'

Preconditions: app/dist rebuilt from this tree (`npm run build` in app/); the port free (refused,
never killed); the data dir outside the shared root (refused) and EMPTY.

Rows, per viewport V in (1200, 390):
  V-0  gate ON in the auth payload (once)
  V-1  insert a chart (/chart NVDA D <past day>, typed into the editor, Enter)
  V-2  draw three horizontal lines (Draw -> Horizontal Line -> click/tap on the chart, x3); mark
       them Target / Entry / Stop in the plan panel; the roles reach the STORED note
  V-3  R:R, risk/share and position size appear with the engine label; the server's reading
       (plan_extract) names the same entry/stop/target the lines carry
  V-4  arm an alert at the stop; it appears in the alerts list (GET /api/watchlist-alerts) bound
       to the chart-namespaced drawing id, and the panel says armed
  V-5  open bar replay ("what happened next"), step forward one bar
  V-6  switch the timeframe (embed toolbar -> W); params.tf W reaches the stored note
  V-7  insert /vs NVDA SPY: two charts, NVDA + SPY, the same `to`
  V-8  (390) no sideways scroll; the panel's controls are >= 44 px tall
  then: W9 /mtf NVDA W (1200) -- the weekly stack W / D / 60
        W10 gate OFF in the client: no Plan / Replay, no /vs
        W11 no unforced page errors
        W12 the driver never imported api.*

Exit: 0 = every row PASS and integrity CLEAN; 1 = a row FAILED; 2 = integrity not CLEAN;
3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)

MEMBER = ("w13h2@local.dev", "LocalTest2026!", "w13h2")
FLAG_KEY = "notebook_chart_plan_enabled"
NOTE_DAY = "2026-06-15"          # the chart's as-of: bars print after it, so replay has a future
SYMS = ("NVDA", "SPY")


# ── the bars fixture ────────────────────────────────────────────────────────────────────────

def _weekdays(start: date, end: date):
    d = start
    while d <= end:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


def synth_bars(sym: str, tf: str) -> list[dict]:
    """Deterministic OHLC: a smooth walk around a symbol-specific base, daily through today.
    W aggregates the dailies by ISO week; intraday answers 7 bars a session for 20 sessions."""
    base = 120.0 if sym == "NVDA" else 560.0 if sym == "SPY" else 80.0
    days = list(_weekdays(date(2025, 6, 2), date.today()))
    daily = []
    for i, d in enumerate(days):
        mid = base * (1 + 0.12 * math.sin(i / 23.0) + 0.0009 * i)
        o = mid * (1 + 0.004 * math.sin(i * 1.7))
        c = mid * (1 + 0.004 * math.sin(i * 1.7 + 1.3))
        hi, lo = max(o, c) * 1.011, min(o, c) * 0.989
        daily.append({"t": d.isoformat(), "o": round(o, 2), "h": round(hi, 2), "l": round(lo, 2),
                      "c": round(c, 2), "v": 1_000_000 + (i * 7919) % 400_000})
    if tf == "D":
        return daily
    if tf in ("W", "M"):
        out, cur, key = [], None, None
        for b in daily:
            d = date.fromisoformat(b["t"])
            k = d.isocalendar()[:2] if tf == "W" else (d.year, d.month)
            if k != key:
                if cur:
                    out.append(cur)
                key, cur = k, dict(b)
            else:
                cur["h"], cur["l"] = max(cur["h"], b["h"]), min(cur["l"], b["l"])
                cur["c"], cur["v"] = b["c"], cur["v"] + b["v"]
        if cur:
            out.append(cur)
        return out
    out = []
    for d, b in zip(days[-20:], daily[-20:]):
        t0 = int(datetime(d.year, d.month, d.day, 13, 30, tzinfo=timezone.utc).timestamp())
        for k in range(7):
            f = 1 + 0.002 * math.sin(k + d.toordinal())
            out.append({"t": t0 + k * 3600, "o": round(b["o"] * f, 2), "h": round(b["h"] * f, 2),
                        "l": round(b["l"] * f, 2), "c": round(b["c"] * f, 2), "v": 100_000})
    return out


_BARS_RE = re.compile(r"/api/bars/([A-Za-z.\-]+)(?:\?|$)")


def install_bars_route(ctx, served: list):
    def handler(route):
        u = route.request.url
        m = _BARS_RE.search(urlparse(u).path + ("?" if urlparse(u).query else ""))
        if not m:
            return route.continue_()
        sym = m.group(1).upper()
        tf = (parse_qs(urlparse(u).query).get("tf") or ["D"])[0]
        bars = synth_bars(sym, tf)
        served.append({"url": u.split("/api/", 1)[-1], "n": len(bars)})
        route.fulfill(status=200, content_type="application/json",
                      body=json.dumps({"ticker": sym, "tf": tf, "bars": bars}))
    ctx.route(re.compile(r".*/api/bars/[A-Za-z.\-]+(\?.*)?$"), handler)


# ── helpers ─────────────────────────────────────────────────────────────────────────────────

class Walk:
    def __init__(self, out: Path):
        self.out = out
        self.rows: list[dict] = []
        self.raw: dict = {}

    def record(self, rid, ok, detail):
        self.rows.append({"id": rid, "verdict": "PASS" if ok else "FAIL", "detail": detail})
        print(f"  {rid}: {'PASS' if ok else 'FAIL'} -- {detail}")

    def shot(self, pg, name):
        p = self.out / f"{name}.png"
        try:
            pg.screenshot(path=str(p), full_page=True)
        except Exception as e:  # noqa: BLE001 -- a screenshot is evidence, never the walk
            self.raw.setdefault("screenshot_errors", []).append(f"{name}: {str(e)[:200]}")
        return p.name

    def dump(self, name, data):
        (self.out / name).write_text(json.dumps(data, indent=1, ensure_ascii=False, default=str), encoding="utf-8")


def embeds(body) -> list[dict]:
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "widgetEmbed":
                out.append(n.get("attrs") or {})
            for c in n.get("content") or []:
                walk(c)
    walk(body)
    return out


def read_note(req, base, nid):
    r = req.get(f"{base}/api/j2/notes/{nid}")
    return r.json()["note"] if r.status == 200 else None


def wait_stored(req, base, nid, pred, timeout_s=40.0):
    """Poll the STORED note until `pred(embeds)` holds -- autosave is the member's own write."""
    end = time.time() + timeout_s
    last = None
    while time.time() < end:
        n = read_note(req, base, nid)
        last = embeds((n or {}).get("bodyJson") or {})
        try:
            if pred(last):
                return last, True
        except Exception:  # noqa: BLE001 -- a half-written shape is "not yet"
            pass
        time.sleep(0.8)
    return last, False


def open_note(pg, base, nid):
    pg.goto(f"{base}/journal/notebook?note={nid}", wait_until="domcontentloaded")
    h._dismiss_intro(pg)
    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=90000)


def type_slash(pg, text: str, option: str, touch: bool):
    pm = pg.locator(".ProseMirror").first
    if touch:
        pm.tap()
    else:
        pm.click()
    pg.keyboard.press("Control+End")
    pg.keyboard.press("Enter")
    pg.keyboard.type(text, delay=25)
    opt = pg.get_by_role("option", name=option)
    opt.first.wait_for(state="visible", timeout=15000)
    pg.keyboard.press("Enter")


def frame_of(pg, nth: int = 0):
    return pg.locator('[data-widget-embed-view="chart"]').nth(nth)


def toolbar_button(pg, frame, name, touch):
    if not touch:
        frame.hover()
    btn = frame.get_by_role("button", name=name, exact=True)
    btn.first.wait_for(state="visible", timeout=20000)
    return btn.first


def press(btn, touch):
    if touch:
        btn.tap()
    else:
        btn.click()


def draw_three_lines(pg, frame, touch: bool, w: Walk, tag: str) -> int:
    """Draw mode -> Horizontal Line -> one click/tap per line, at three heights.

    Run 2 found the embed back in its plain toolbar after the Draw press. A probe (same build)
    recorded the press itself blurring and re-focusing the editor ~17 ms before draw mode engages,
    and WidgetEmbedView exits draw mode on an editor focus -- so the order of those two events
    decides. The event order is RECORDED here for every attempt, and a press that did not stick
    is retried (at most 3), never hidden."""
    pg.evaluate("""() => { window.__h2ev = []; const pm = document.querySelector('.ProseMirror');
      if (pm && !pm.__h2) { pm.__h2 = 1;
        pm.addEventListener('focus', () => window.__h2ev.push(['pm-focus', performance.now() | 0]), true);
        pm.addEventListener('blur', () => window.__h2ev.push(['pm-blur', performance.now() | 0]), true); }
      const f = document.querySelector('[data-widget-embed-view="chart"]');
      if (f && !f.__h2) { f.__h2 = 1; new MutationObserver(() => window.__h2ev.push(['class',
        f.className.includes('annotating') ? 'annotating' : 'plain', performance.now() | 0]))
        .observe(f, {attributes: true, attributeFilter: ['class']}) } }""")
    attempts = []
    for _ in range(3):
        press(toolbar_button(pg, frame, "Draw", touch), touch)
        try:
            frame.get_by_role("button", name="Done", exact=True).first.wait_for(state="visible", timeout=4000)
            pg.wait_for_timeout(600)
            stuck = frame.get_by_role("button", name="Done", exact=True).count() > 0
        except Exception:  # noqa: BLE001
            stuck = False
        attempts.append({"stuck": stuck, "events": pg.evaluate("() => window.__h2ev.splice(0)")})
        if stuck:
            break
    w.raw[f"{tag}_draw_attempts"] = attempts
    canvas_box = None
    for _ in range(40):
        boxes = frame.locator("canvas").evaluate_all(
            "cs => cs.map(c => { const r = c.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })")
        big = [b for b in boxes if b[2] > 150 and b[3] > 120]
        if big:
            canvas_box = max(big, key=lambda b: b[2] * b[3])
            break
        pg.wait_for_timeout(250)
    w.raw[f"{tag}_canvas_box"] = canvas_box
    if not canvas_box:
        return 0
    x0, y0, cw, ch = canvas_box
    placed = 0
    for frac in (0.28, 0.5, 0.72):
        # The drawing toolbar is the chart's own (ChartToolbar); it may portal outside the embed
        # frame, so it is looked for on the page. Run 1 found nothing inside the frame.
        tool = pg.get_by_role("button", name=re.compile(r"^Horizontal Line"))
        try:
            tool.first.wait_for(state="visible", timeout=15000)
        except Exception:
            w.raw[f"{tag}_buttons_when_tool_missing"] = pg.evaluate(
                "() => [...document.querySelectorAll('button')].map(b => [(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 50), !!b.offsetParent, Math.round(b.getBoundingClientRect().width)])")
            w.shot(pg, f"{tag}-2-draw-mode-no-tool")
            raise
        press(tool.first, touch)
        x, y = x0 + cw * 0.45, y0 + ch * frac
        if touch:
            pg.touchscreen.tap(x, y)
        else:
            pg.mouse.click(x, y)
        pg.wait_for_timeout(400)
        placed += 1
    press(toolbar_button(pg, frame, "Done", touch), touch)
    return placed


# ── one viewport's walk ─────────────────────────────────────────────────────────────────────

def walk_viewport(br, state, base, req, w: Walk, width: int, errors: list, served: list):
    touch = width < 640
    tag = f"V{width}"
    ctx = br.new_context(viewport={"width": width, "height": 900 if not touch else 844}, is_mobile=touch,
                         has_touch=touch, reduced_motion="reduce", storage_state=state)
    install_bars_route(ctx, served)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(f"{tag}: {str(e)[:300]}"))
    note = req.post(base + "/api/j2/notes", data={"title": f"Chart plan walk {width}", "bodyJson": {
        "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "The plan:"}]}]}})
    nid = note.json()["note"]["id"]
    w.raw[f"{tag}_note"] = nid
    open_note(pg, base, nid)

    # 1 -- insert a chart
    type_slash(pg, f"/chart NVDA D {NOTE_DAY}", f"Chart — NVDA · D @ {datetime.fromisoformat(NOTE_DAY):%b} "
               f"{int(NOTE_DAY[-2:])}, {NOTE_DAY[:4]}", touch)
    frame = frame_of(pg, 0)
    frame.wait_for(state="visible", timeout=30000)
    stored, ok1 = wait_stored(req, base, nid, lambda e: any((a.get("params") or {}).get("symbol") == "NVDA" for a in e))
    chart = next((a for a in stored or [] if (a.get("params") or {}).get("symbol") == "NVDA"), {})
    embed_id = chart.get("embedId")
    w.raw[f"{tag}_inserted_chart"] = {k: chart.get(k) for k in ("embedId", "params", "mode")}
    w.record(f"{tag}-1_insert_chart", ok1 and bool(embed_id) and (chart.get("params") or {}).get("to") == NOTE_DAY,
             f"/chart typed + Enter -> stored widgetEmbed NVDA D to={(chart.get('params') or {}).get('to')} embedId={embed_id}")
    pg.wait_for_timeout(1500)
    w.shot(pg, f"{tag}-1-chart")

    # 2 -- draw three lines, then mark their roles in the panel
    placed = draw_three_lines(pg, frame, touch, w, tag)
    stored, drew = wait_stored(req, base, nid, lambda e: len([d for d in (e[0].get("annotations") or [])
                                                               if d.get("type") == "horizontal"]) >= 3)
    lines = [d for d in (stored[0].get("annotations") or []) if d.get("type") == "horizontal"] if stored else []
    w.raw[f"{tag}_drawn"] = [{"id": d.get("id"), "price": (d.get("points") or [{}])[0].get("price")} for d in lines]
    press(toolbar_button(pg, frame, "Plan", touch), touch)
    panel = pg.locator("[data-chart-plan-panel]").first
    panel.wait_for(state="visible", timeout=30000)
    rows = panel.locator("li[data-level-id]")
    rows.nth(2).wait_for(state="visible", timeout=20000)
    ids = [rows.nth(i).get_attribute("data-level-id") for i in range(rows.count())]
    for i, role in ((0, "target"), (1, "entry"), (2, "stop")):
        press(rows.nth(i).locator(f'[data-role="{role}"]'), touch)
        pg.wait_for_timeout(300)
    stored, roled = wait_stored(req, base, nid, lambda e: sorted(d.get("role") for d in (e[0].get("annotations") or [])
                                                                 if d.get("role")) == ["entry", "stop", "target"])
    by_role = {d["role"]: d for d in (stored[0].get("annotations") or []) if d.get("role")} if stored else {}
    price_of = lambda d: ((d or {}).get("points") or [{}])[0].get("price")  # noqa: E731
    w.raw[f"{tag}_roles_stored"] = {r: {"id": d.get("id"), "price": price_of(d), "has_price_copy": "price" in d}
                                    for r, d in by_role.items()}
    ordered = (price_of(by_role.get("target")) or 0) > (price_of(by_role.get("entry")) or 0) > (price_of(by_role.get("stop")) or 0)
    w.record(f"{tag}-2_draw_and_assign_roles",
             placed == 3 and drew and roled and ordered and not any("price" in d for d in by_role.values()),
             f"{placed} lines placed by {'tap' if touch else 'click'}, {len(lines)} stored; roles stored "
             f"{ {r: price_of(d) for r, d in by_role.items()} } (target > entry > stop: {ordered}); no price copy")
    w.shot(pg, f"{tag}-2-roles")

    # 3 -- R:R and size with the engine label, from the server's plan_extract reading
    shares_cell = panel.locator('[data-plan-value="shares"]')
    try:
        pg.wait_for_function("() => { const e = document.querySelector('[data-plan-value=\"shares\"]'); "
                             "return e && e.textContent.trim() !== '—' }", timeout=30000)
    except Exception as e:  # noqa: BLE001
        w.raw[f"{tag}_size_wait_error"] = str(e)[:300]
    vals = {k: (panel.locator(f'[data-plan-value="{k}"]').first.inner_text() if panel.locator(f'[data-plan-value="{k}"]').count() else None)
            for k in ("rr", "rps", "acct", "shares")}
    label_el = panel.locator("[data-sized-by]")
    label = label_el.first.inner_text() if label_el.count() else None
    reading = req.post(base + "/api/j2/chart-plan/size", data={"annotations": stored[0].get("annotations"), "symbol": "NVDA"})
    rj = reading.json() if reading.status == 200 else {"status": reading.status}
    w.dump(f"{tag}-size-reading.json", rj)
    plan = (rj or {}).get("plan") or {}
    same = (plan.get("entry") == price_of(by_role.get("entry")) and plan.get("stop") == price_of(by_role.get("stop"))
            and plan.get("target") == price_of(by_role.get("target")))
    w.raw[f"{tag}_panel_values"] = {**vals, "label": label}
    w.record(f"{tag}-3_rr_and_size_with_engine_label",
             bool(vals["rr"] and vals["rr"].endswith("R") and vals["shares"] and vals["shares"].endswith("sh")
                  and label and label.startswith("Sized by")) and same,
             f"panel R:R={vals['rr']} risk/share={vals['rps']} account risk={vals['acct']} size={vals['shares']}; "
             f"label={label!r}; server plan_extract reading entry/stop/target == the drawn roles: {same}")
    w.shot(pg, f"{tag}-3-sized")

    # 4 -- arm an alert at the stop; it appears in the alerts list
    stop_row = rows.nth(2)
    arm = stop_row.get_by_role("button", name=re.compile(r"^Arm alert at this level"))
    press(arm.first, touch)
    armed_ui = False
    try:
        stop_row.get_by_text("Alert armed").first.wait_for(state="visible", timeout=30000)
        armed_ui = True
    except Exception as e:  # noqa: BLE001
        w.raw[f"{tag}_arm_wait_error"] = str(e)[:300]
        w.raw[f"{tag}_panel_text_after_arm"] = panel.inner_text()[:1500]
    alerts = req.get(base + "/api/watchlist-alerts").json()
    w.dump(f"{tag}-alerts-list.json", alerts)
    want = f"nb:{embed_id}:{by_role.get('stop', {}).get('id')}"
    hit = next((a for a in alerts if a.get("drawing_id") == want), None)
    w.record(f"{tag}-4_arm_alert_listed",
             armed_ui and bool(hit) and hit.get("sym") == "NVDA" and hit.get("direction") == "below"
             and abs(float(hit.get("target_price") or 0) - float(price_of(by_role.get("stop")) or -1)) < 1e-6,
             f"panel says armed={armed_ui}; alerts list row drawing_id={want!r} found={bool(hit)} "
             f"sym={(hit or {}).get('sym')} direction={(hit or {}).get('direction')} price={(hit or {}).get('target_price')}")
    w.shot(pg, f"{tag}-4-armed")

    # 5 -- bar replay, step forward
    press(toolbar_button(pg, frame, "Replay", touch), touch)
    dlg = pg.get_by_role("dialog", name="What happened next · NVDA")
    ok5 = False
    try:
        dlg.wait_for(state="visible", timeout=20000)
        pg.get_by_text("At the note — step forward").first.wait_for(state="visible", timeout=30000)
        press(pg.get_by_role("button", name="Step forward one bar"), touch)
        pg.get_by_text(re.compile(r"^1 bar after the note")).first.wait_for(state="visible", timeout=10000)
        ok5 = True
    except Exception as e:  # noqa: BLE001
        w.raw[f"{tag}_replay_error"] = str(e)[:300]
    w.raw[f"{tag}_replay_status"] = dlg.inner_text()[:600] if dlg.count() else None
    w.record(f"{tag}-5_replay_step_forward", ok5, "dialog opened at the note's as-of; Step -> '1 bar after the note'")
    w.shot(pg, f"{tag}-5-replay")
    if dlg.count():
        press(pg.get_by_role("button", name="Close replay"), touch)

    # 6 -- switch the timeframe
    sel = frame.get_by_label("Embed timeframe")
    if not touch:
        frame.hover()
    sel.select_option("W")
    stored, ok6 = wait_stored(req, base, nid, lambda e: (e[0].get("params") or {}).get("tf") == "W")
    w.raw[f"{tag}_tf_after"] = (stored[0].get("params") if stored else None)
    w.record(f"{tag}-6_timeframe_switch", ok6 and any("tf=W" in s["url"] for s in served),
             f"embed toolbar -> W; stored params.tf={(stored[0].get('params') or {}).get('tf') if stored else None}; "
             f"a tf=W bars request was made={any('tf=W' in s['url'] for s in served)}")
    pg.wait_for_timeout(1200)
    w.shot(pg, f"{tag}-6-weekly")

    # 7 -- /vs
    type_slash(pg, "/vs NVDA SPY", "Versus — NVDA vs SPY", touch)
    stored, ok7 = wait_stored(req, base, nid, lambda e: any((a.get("params") or {}).get("symbol") == "SPY" for a in e))
    spy = next((a for a in stored or [] if (a.get("params") or {}).get("symbol") == "SPY"), {})
    pair = [a for a in stored or [] if a.get("caption") in (f"NVDA · vs SPY", "vs SPY")]
    same_to = len(pair) == 2 and pair[0]["params"].get("to") == pair[1]["params"].get("to")
    w.raw[f"{tag}_vs_pair"] = [{k: a.get(k) for k in ("caption", "params", "layout")} for a in pair]
    w.record(f"{tag}-7_vs_insert", ok7 and same_to and (spy.get("layout") or {}).get("width") == "half",
             f"/vs NVDA SPY -> {len(pair)} half-width charts, same to={same_to}")
    pg.wait_for_timeout(1500)
    w.shot(pg, f"{tag}-7-vs")

    if touch:
        open_note(pg, base, nid)
        frame = frame_of(pg, 0)
        frame.wait_for(state="visible", timeout=30000)
        press(toolbar_button(pg, frame, "Plan", touch), touch)
        pg.locator("[data-chart-plan-panel]").first.wait_for(state="visible", timeout=30000)
        geo = pg.evaluate("""() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
            controls: [...document.querySelectorAll('[data-chart-plan-panel] button, [data-chart-plan-panel] select')]
              .filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect();
                return {name: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40), h: Math.round(r.height), w: Math.round(r.width)} })})""")
        small = [c for c in geo["controls"] if c["h"] < 44]
        w.raw[f"{tag}_geometry"] = geo
        w.record(f"{tag}-8_phone_floor_and_no_sideways_scroll", geo["sw"] <= geo["cw"] + 1 and not small and geo["controls"],
                 f"scrollWidth {geo['sw']} vs clientWidth {geo['cw']}; {len(geo['controls'])} panel controls, "
                 f"under 44px: {small}")
        w.shot(pg, f"{tag}-8-panel-390")
    ctx.close()
    return nid


def run(base: str, w: Walk) -> None:
    from playwright.sync_api import sync_playwright
    errors: list[str] = []
    served: list[dict] = []
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
        req = ctx.request
        h._provision(admin_ctx.request, req, base, member=MEMBER)
        me = req.get(base + "/api/auth/me").json()
        w.record("W0_gate_on_payload", me.get(FLAG_KEY) is True, f"/api/auth/me {FLAG_KEY}={me.get(FLAG_KEY)!r}")
        # the member's sizing inputs, through the product's own routes: account size stays the
        # default; max risk per trade 1%
        accts = req.get(base + "/api/j2/accounts").json().get("accounts") or []
        acct_id = (accts[0] or {}).get("id") if accts else None
        cur = req.get(f"{base}/api/j2/accounts/{acct_id}/settings").json() if acct_id else {}
        put = req.put(f"{base}/api/j2/accounts/{acct_id}/settings", data={**cur, "maxRiskPerTradePct": 1}) if acct_id else None
        w.raw["account_seed"] = {"account": acct_id, "put": put.status if put else None,
                                 "accountSize": cur.get("accountSize")}
        if not put or put.status != 200:
            raise h.SetupFailed(f"setting max risk per trade failed: {w.raw['account_seed']}")
        state = ctx.storage_state()

        for width in (1200, 390):
            try:
                walk_viewport(br, state, base, req, w, width, errors, served)
            except Exception as e:  # noqa: BLE001 -- recorded; the other viewport still runs
                import traceback
                w.record(f"V{width}-x_walk_raised", False, f"{type(e).__name__}: {str(e)[:300]}")
                w.raw[f"V{width}_traceback"] = traceback.format_exc()[-3000:]

        # W9 -- /mtf NVDA W at 1200
        c9 = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce", storage_state=state)
        install_bars_route(c9, served)
        p9 = c9.new_page()
        p9.on("pageerror", lambda e: errors.append(f"W9: {str(e)[:300]}"))
        n9 = req.post(base + "/api/j2/notes", data={"title": "Weekly stack walk", "bodyJson": {
            "type": "doc", "content": [{"type": "paragraph"}]}}).json()["note"]["id"]
        try:
            open_note(p9, base, n9)
            type_slash(p9, "/mtf NVDA W", "MTF stack — NVDA · W / D / 1h", False)
            stored, ok9 = wait_stored(req, base, n9, lambda e: len(e) == 3)
            tfs = [(a.get("params") or {}).get("tf") for a in stored or []]
            w.record("W9_mtf_weekly_stack", ok9 and tfs == ["W", "D", "60"], f"/mtf NVDA W -> stored tfs {tfs}")
            p9.wait_for_timeout(1500)
            w.shot(p9, "W9-mtf-weekly")
        except Exception as e:  # noqa: BLE001
            w.record("W9_mtf_weekly_stack", False, f"{type(e).__name__}: {str(e)[:300]}")
        c9.close()

        # W10 -- gate OFF in the client (the auth payload answers false)
        off = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce", storage_state=state)
        install_bars_route(off, served)

        def fake_me(route):
            resp = route.fetch()
            data = resp.json()
            data[FLAG_KEY] = False
            route.fulfill(response=resp, body=json.dumps(data),
                          headers={**resp.headers, "content-type": "application/json"})
        off.route("**/api/auth/me", fake_me)
        po = off.new_page()
        plan_reqs: list[str] = []
        po.on("request", lambda r: plan_reqs.append(r.url) if "/api/j2/chart-plan/" in r.url else None)
        po.on("pageerror", lambda e: errors.append(f"W10: {str(e)[:300]}"))
        try:
            open_note(po, base, w.raw.get("V1200_note"))
            fr = frame_of(po, 0)
            fr.wait_for(state="visible", timeout=30000)
            fr.hover()
            fr.get_by_role("button", name="Draw", exact=True).first.wait_for(state="visible", timeout=20000)
            no_plan = fr.get_by_role("button", name="Plan", exact=True).count() == 0
            no_replay = fr.get_by_role("button", name="Replay", exact=True).count() == 0
            pm = po.locator(".ProseMirror").first
            pm.click()
            po.keyboard.press("Control+End")
            po.keyboard.press("Enter")
            po.keyboard.type("/vs NVDA", delay=25)
            po.wait_for_timeout(1200)
            no_vs = po.get_by_role("option", name=re.compile(r"^Versus")).count() == 0
            po.keyboard.press("Escape")
            w.record("W10_gate_off_client", no_plan and no_replay and no_vs and not plan_reqs,
                     f"Plan absent={no_plan}, Replay absent={no_replay}, /vs offers nothing={no_vs}, "
                     f"chart-plan requests={plan_reqs}")
            w.shot(po, "W10-gate-off-1200")
        except Exception as e:  # noqa: BLE001
            w.record("W10_gate_off_client", False, f"{type(e).__name__}: {str(e)[:300]}")
        off.close()

        w.raw["bars_fixture_served"] = served
        w.record("W11_no_page_errors", not errors, f"{len(errors)} unforced page errors" + (f": {errors[:3]}" if errors else ""))
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8615)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if not 8615 <= args.port <= 8619:
        print("REFUSED: this lane's walk uses ports 8615-8619 only")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this walk never kills it")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty -- a re-run must not inherit a previous run's notes")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    w = Walk(out)
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    # ⛔ Written for the CHILD (Popen inherits it), never read here: the gate's one parse lives in
    # the app (notebook_flags.flag_on).
    os.environ.update({"NOTEBOOK_CHART_PLAN_ENABLED": "1"})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    not_run = failure = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            try:
                run(base, w)
            except h.SetupFailed as e:
                not_run = str(e)[:300]
            except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
                import traceback
                failure = f"the walk raised {type(e).__name__}: {str(e)[:400]}"
                w.raw["traceback"] = traceback.format_exc()[-3000:]
            box.wait_checkpoint(h.POST_BOOT, 60)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    w.record("W12_driver_never_imported_api", not api_mods,
             "no api.* module in the driver's sys.modules" if not api_mods else f"imported: {api_mods[:5]}")
    result = {"tool": "tools/notebook_w13h2_walk.py", "base": base, "integrity": integ, "failure": failure,
              "not_run": not_run, "rows": w.rows, "raw": w.raw}
    (out / "walk.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT: FAIL -- {failure}")
        return 1
    if any(r["verdict"] != "PASS" for r in w.rows):
        print("VERDICT: FAIL -- " + ", ".join(r["id"] for r in w.rows if r["verdict"] != "PASS"))
        return 1
    if not integ.get("clean"):
        print(f"VERDICT: INTEGRITY {integ.get('status')}")
        return 2
    print(f"VERDICT: PASS -- {len(w.rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
