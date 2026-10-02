"""Wave 11 lane 11D live walk -- the trade-plan canvas in a real Chromium, against a LOCAL
sandbox. The evidence it writes: docs/notebook/evidence/w11d/walk-<sha>/walk.json (+ the
launcher's integrity log and screenshots). It is NOT a pytest rail.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. It owns its sandbox through the perf harness's
`Sandbox` (scripts/hub_sandbox_boot.py, in its own process group, stopped gracefully so the
launcher writes its SHUTDOWN checkpoint), talks to it over HTTP only, and prints the
launcher's snapshot verdict (`SANDBOX INTEGRITY: ...`) as its FIRST output line.

No model is called (the canvas uses no AI). The sandbox has no market-data vendor, so a chart
card's bars request answers empty: the walk asserts WHAT the chart asked for (a frozen card's
`?to=` day), never that candles were drawn.

Run it from POWERSHELL with the gate in that same shell:

    $env:NOTEBOOK_TRADE_CANVAS_ENABLED = '1'     # auth NOTEBOOK_FLAGS -> notebook_trade_canvas_enabled
    python tools/notebook_w11d_canvas_walk.py --data-dir '<scratchpad>\\w11d-data' --port 8571 `
        --out docs/notebook/evidence/w11d/walk-<sha>/walk.json --tip <sha> `
        --artifacts docs/notebook/evidence/w11d/walk-<sha>

Preconditions: app/dist built from the tip; the port free (refused, never killed); the data
dir outside the shared root (refused).

  C0  the gate rides the auth payload ON; the sandbox is who it says it is
  C1  New note -> Templates -> "Trade-plan canvas": a canvas opens with the three-step hint
  C2  by MOUSE: a text card, a live chart, a frozen chart (as-of day reaches the bars request),
      entry/stop/target drawn on the chart, an arrow -- all in the stored body
  C3  by MOUSE: move, resize, delete (selection bar), undo (toolbar) -- each in the stored body
  C4  by KEYBOARD only: Tab to a card, arrows move, Alt+arrow resizes, Enter edits, T adds,
      Delete + Ctrl+Z, L adds a custom level, A draws an arrow, + / 0 zoom, ? keys; focus is
      never on <body>
  C5  390 px touch: no sideways scroll, every control >= 44 px, one-finger pan and two-finger
      pinch move the board, a level added through the Levels control
  C6  link from a thesis: the canvas's "Link from a thesis" -> pick -> Add link; the canvas
      shows "Linked from"; backlinks + graph agree. /canvas in the thesis makes and links a
      second canvas
  C7  reload: everything persisted, and opening a canvas writes nothing
  C8  offline edit, then reconnect: the edit lands, no fork (no sync-conflict note)
  C9  export: Markdown carries the levels, charts and dates, cards and arrows
  C10 200 cards: open time, cards in the DOM, pan and drag frame times, cards touched by a pan
      or a drag (raw numbers)
  C11 the gate OFF (the auth payload answered with the key false): no door renders and an
      existing canvas is read-only with its sentence
  C12 no unforced page error across the walk
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import sys
import time
import traceback
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))
from tools import notebook_perf_harness as H  # noqa: E402  (ONE sandbox + integrity reader)
import sandbox_identity  # noqa: E402

REQUIRED = [H.PRE_BOOT, H.POST_BOOT, H.PREWARM, H.SHUTDOWN]
EMAIL = "w11d@local.dev"
FLAG_KEY = "notebook_trade_canvas_enabled"
FROZEN_DAY = "2026-09-24"

res: dict = {"wave": 11, "lane": "11D", "checks": {}, "errors": [], "bars_requests": [], "puts": []}
LINES: list[str] = []
state: dict = {}


def record(key, verdict, **facts):
    res["checks"][key] = {"verdict": verdict, **facts}
    line = f"[{verdict}] {key}: " + json.dumps(facts, default=str, ensure_ascii=True)[:500]
    LINES.append(line)
    print(line, file=sys.stderr, flush=True)


def guarded(key):
    def wrap(fn):
        def inner(*a, **kw):
            try:
                fn(*a, **kw)
            except Exception as e:  # noqa: BLE001 -- one row never stops the rest
                record(key, "INCONCLUSIVE", reason=f"exception: {type(e).__name__}: {e}",
                       traceback=traceback.format_exc()[-1500:])
        return inner
    return wrap


def find_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            got = find_key(v, key)
            if got is not None:
                return got
    if isinstance(obj, list):
        for v in obj:
            got = find_key(v, key)
            if got is not None:
                return got
    return None


def set_key(obj, key, value):
    if isinstance(obj, dict):
        for k in list(obj):
            if k == key:
                obj[k] = value
            else:
                set_key(obj[k], key, value)
    elif isinstance(obj, list):
        for v in obj:
            set_key(v, key, value)


# The page-side instruments (C10). Installed by evaluate, read back raw.
PROBE_INSTALL = r"""
() => {
  const layer = document.querySelector('[role="application"] > div')
  const out = { frames: [], longtasks: [], touched: new Set(), mounted: 0, unmounted: 0 }
  let running = true
  let last = performance.now()
  const tick = (t) => { out.frames.push(t - last); last = t; if (running) requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  let po = null
  try {
    po = new PerformanceObserver((l) => { for (const e of l.getEntries()) out.longtasks.push(e.duration) })
    po.observe({ entryTypes: ['longtask'] })
  } catch (e) { out.longtaskUnsupported = String(e) }
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList' && r.target === layer) {
        r.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.hasAttribute('data-canvas-item')) out.mounted += 1 })
        r.removedNodes.forEach((n) => { if (n.nodeType === 1 && n.hasAttribute('data-canvas-item')) out.unmounted += 1 })
        continue
      }
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement
      const card = el && el.closest && el.closest('[data-canvas-item]')
      if (card) out.touched.add(card.getAttribute('data-canvas-item'))
    }
  })
  mo.observe(layer, { subtree: true, childList: true, attributes: true, characterData: true })
  window.__w11dProbe = { out, stop: () => { running = false; mo.disconnect(); if (po) po.disconnect() } }
  return true
}
"""
PROBE_READ = r"""
() => {
  const p = window.__w11dProbe
  if (!p) return null
  p.stop()
  const f = p.out.frames.slice(1).sort((a, b) => a - b)
  const pct = (q) => f.length ? f[Math.min(f.length - 1, Math.floor(q * f.length))] : null
  return { frames: p.out.frames.length, p50: pct(0.5), p95: pct(0.95), max: f.length ? f[f.length - 1] : null,
           longtasks: p.out.longtasks, longtaskUnsupported: p.out.longtaskUnsupported || null,
           touched: [...p.out.touched], mounted: p.out.mounted, unmounted: p.out.unmounted,
           rawFrames: p.out.frames.slice(0, 400) }
}
"""
EMPTY_POINT = r"""
() => {
  const vp = document.querySelector('[role="application"]')
  const r = vp.getBoundingClientRect()
  for (let y = r.top + 30; y < r.bottom - 30; y += 17) {
    for (let x = r.left + 30; x < r.right - 30; x += 17) {
      const el = document.elementFromPoint(x, y)
      if (el === vp) return { x, y }
    }
  }
  return null
}
"""

PICK_VISIBLE = r"""
() => {
  const vp = document.querySelector('[role="application"]').getBoundingClientRect()
  for (const el of document.querySelectorAll('[data-canvas-item][data-kind="text"]')) {
    const r = el.getBoundingClientRect()
    if (r.left < vp.left + 20 || r.right > vp.right - 300 || r.top < vp.top + 20 || r.bottom > vp.bottom - 80) continue
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (hit && hit.closest('[data-canvas-item]') === el) return el.getAttribute('data-canvas-item')
  }
  return null
}
"""


def text_card(i, x, y, text, kind="text"):
    d = {"id": f"w{i}", "kind": kind, "x": x, "y": y, "w": 240 if kind == "text" else 180,
         "h": 140 if kind == "text" else 110, "text": text}
    if kind == "sticky":
        d["color"] = "gold"
    return d


def canvas_body(board, search):
    return {"type": "doc", "content": [{"type": "tradeCanvas", "attrs": {"board": board, "searchText": search}},
                                       {"type": "paragraph"}]}


def run_walk(base: str, art: Path) -> None:
    from playwright.sync_api import sync_playwright

    run = time.strftime("r%H%M%S")
    res["run"] = run
    pw = secrets.token_urlsafe(18)   # a TEST value for this run only; never written anywhere

    def shot(pg, name):
        p = art / f"{name}.jpg"
        try:
            pg.screenshot(path=str(p), type="jpeg", quality=55)
            return p.name
        except Exception as e:  # noqa: BLE001
            return f"screenshot failed: {e}"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = browser.new_context()
        member = browser.new_context(viewport={"width": 1280, "height": 900})
        email = EMAIL.replace("@", f"-{run}@")
        res["member"] = email
        H._provision(admin.request, member.request, base, member=(email, pw, "Walker Eleven D"))
        api = member.request
        me = api.get(base + "/api/auth/me").json()
        res["server_flags"] = {FLAG_KEY: find_key(me, FLAG_KEY), "paid_equiv": find_key(me, "paid_equiv")}

        def on_request(req):
            u = req.url
            if "/api/bars/" in u:
                res["bars_requests"].append(u.split(base, 1)[-1])
            if req.method == "PUT" and "/api/j2/notes/" in u:
                hdr = req.headers.get("x-uct-notebook-schema")
                res["puts"].append({"path": u.split(base, 1)[-1], "schema": hdr})
        member.on("request", on_request)

        def new_page(ctx=member):
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
            return pg

        def get_note(nid):
            return api.get(base + f"/api/j2/notes/{nid}").json()["note"]

        def board_of(nid):
            return get_note(nid)["bodyJson"]["content"][0]["attrs"]["board"]

        def wait_board(nid, pred, timeout=20):
            end, b = time.time() + timeout, None
            while time.time() < end:
                b = board_of(nid)
                if pred(b):
                    return b, True
                time.sleep(0.4)
            return b, False

        def note_id_from(pg, timeout=20):
            end = time.time() + timeout
            while time.time() < end:
                nid = pg.evaluate("() => new URLSearchParams(location.search).get('note')")
                if nid:
                    return nid
                pg.wait_for_timeout(100)
            return None

        def app(pg):
            return pg.get_by_role("application", name=re.compile("Trade-plan canvas"))

        def open_canvas(pg, nid):
            pg.goto(base + f"/journal/notebook?note={nid}")
            H._dismiss_intro(pg)
            app(pg).wait_for(timeout=30000)

        def show_board(pg):
            # The board sits under the note's title, tags and properties: at 1280x900 its lower
            # half is below the fold (run 1, C3-moved-resized.jpg). A member scrolls it into
            # view; the mouse rows do the same, or their coordinates land outside the window.
            pg.get_by_role("application", name=re.compile("Trade-plan canvas")).evaluate(
                "el => el.scrollIntoView({block: 'center'})")
            pg.wait_for_timeout(200)

        def card(pg, item_id):
            return pg.locator(f'[data-canvas-item="{item_id}"]')

        def active_card(pg):
            return pg.evaluate("() => document.activeElement && document.activeElement.getAttribute('data-canvas-item')")

        def active_tag(pg):
            return pg.evaluate("() => document.activeElement ? document.activeElement.tagName : null")

        # ── C0 ─────────────────────────────────────────────────────────────
        @guarded("C0_gate_on")
        def c0():
            ok = res["server_flags"][FLAG_KEY] is True and res["server_flags"]["paid_equiv"] is True
            record("C0_gate_on", "PASS" if ok else "FAIL", flags=res["server_flags"])

        # ── C1 ─────────────────────────────────────────────────────────────
        @guarded("C1_create_from_new_note_sheet")
        def c1():
            pg = new_page()
            state["page"] = pg
            pg.goto(base + "/journal/notebook?view=all")
            H._dismiss_intro(pg)
            t0 = time.time()
            pg.get_by_role("button", name="Templates", exact=True).click()
            sheet = pg.get_by_role("dialog", name="New note")
            group = sheet.get_by_role("group", name="Plan a trade")
            group.get_by_role("button", name=re.compile("Trade-plan canvas")).click()
            app(pg).wait_for(timeout=30000)
            nid = note_id_from(pg)
            hint = pg.get_by_role("heading", name="Make your plan in three steps")
            hint.wait_for(timeout=10000)
            steps = [b.inner_text().strip() for b in pg.locator('[class*="hintSteps"] button').all()]
            elapsed = round((time.time() - t0) * 1000)
            shot(pg, "C1-new-canvas")
            note = get_note(nid) if nid else {}
            body = note.get("bodyJson") or {}
            state["canvas"] = nid
            state["t_easy_start"] = t0
            ok = (bool(nid) and body.get("content", [{}])[0].get("type") == "tradeCanvas"
                  and steps == ["Add a chart", "Add entry, stop and target", "Link it from your thesis"]
                  and "trade-plan" in (note.get("tags") or []))
            record("C1_create_from_new_note_sheet", "PASS" if ok else "FAIL", note_id=nid, hint_steps=steps,
                   ms_click_to_board=elapsed, tags=note.get("tags"), title=note.get("title"))

        # ── C2 ─────────────────────────────────────────────────────────────
        @guarded("C2_add_by_mouse")
        def c2():
            pg, nid = state["page"], state["canvas"]
            n_bars0 = len(res["bars_requests"])
            show_board(pg)
            # 1. a live chart, from the hint's first step
            pg.get_by_role("button", name="Add a chart").click()
            dlg = pg.get_by_role("dialog", name="Add a chart")
            dlg.get_by_label("Ticker").fill("NVDA")
            dlg.get_by_role("button", name="Add chart").click()
            dlg.wait_for(state="detached", timeout=5000)
            # 2. a frozen chart, from the toolbar
            pg.get_by_role("toolbar", name="Canvas tools").get_by_role("button", name=re.compile(r"^Chart")).click()
            dlg = pg.get_by_role("dialog", name="Add a chart")
            dlg.get_by_label("Ticker").fill("AMD")
            dlg.get_by_label(re.compile("^Frozen")).check()
            dlg.get_by_label("Frozen as of").fill(FROZEN_DAY)
            dlg.get_by_role("button", name="Add chart").click()
            dlg.wait_for(state="detached", timeout=5000)
            # 3. a text card
            pg.get_by_role("toolbar", name="Canvas tools").get_by_role("button", name=re.compile(r"^Text")).click()
            box = pg.get_by_role("textbox", name="Card text")
            box.fill("Base breakout over the 50-day on volume")
            # blur commits: a click on EMPTY board (run 1 clicked the toolbar's corner, which
            # was the Text button, and made a second card)
            ep = pg.evaluate(EMPTY_POINT)
            pg.mouse.click(ep["x"], ep["y"])
            # 4. entry / stop / target on the NVDA chart
            pg.get_by_role("toolbar", name="Canvas tools").get_by_role("button", name=re.compile(r"^Levels$")).click()
            dlg = pg.get_by_role("dialog", name="Add price levels")
            dlg.get_by_label("Entry price").fill("182.50")
            dlg.get_by_label("Stop price").fill("171")
            dlg.get_by_label("Target price").fill("205")
            dlg.get_by_label("Draw it on").select_option(label="NVDA · Daily")
            dlg.get_by_role("button", name="Add levels").click()
            dlg.wait_for(state="detached", timeout=5000)
            b, _ = wait_board(nid, lambda b: len(b["items"]) >= 3 and len(b["levels"]) >= 3)
            text = next(i for i in b["items"] if i["kind"] == "text")
            nvda = next(i for i in b["items"] if i["kind"] == "chart" and i["symbol"] == "NVDA")
            # 5. an arrow: select the text card, toolbar Arrow, pick the NVDA chart
            card(pg, text["id"]).click(position={"x": 8, "y": 8})
            pg.get_by_role("toolbar", name="Canvas tools").get_by_role("button", name=re.compile(r"^Arrow")).click()
            dlg = pg.get_by_role("dialog", name="Arrows")
            dlg.get_by_label("Draw an arrow to").select_option(label="NVDA Daily chart")
            dlg.get_by_label("Label (optional)").fill("if it holds")
            dlg.get_by_role("button", name="Add arrow").click()
            dlg.wait_for(state="detached", timeout=5000)
            b, saved = wait_board(nid, lambda b: len(b["edges"]) == 1)
            pg.wait_for_timeout(2500)   # let the chart cards ask for their bars
            shot(pg, "C2-board")
            amd = next((i for i in b["items"] if i["kind"] == "chart" and i["symbol"] == "AMD"), {})
            bars = res["bars_requests"][n_bars0:]
            frozen_req = [u for u in bars if "/api/bars/AMD" in u]
            live_req = [u for u in bars if "/api/bars/NVDA" in u]
            levels = sorted((l["role"], l["price"], l["chartId"] == nvda["id"]) for l in b["levels"])
            state["text_id"], state["nvda_id"], state["amd_id"] = text["id"], nvda["id"], amd.get("id")
            ok = (saved and amd.get("mode") == "frozen" and amd.get("asOf") == FROZEN_DAY
                  and levels == [("entry", 182.5, True), ("stop", 171, True), ("target", 205, True)]
                  and b["edges"][0]["from"] == text["id"] and b["edges"][0]["to"] == nvda["id"]
                  and text.get("text") == "Base breakout over the 50-day on volume"
                  and [i["kind"] for i in b["items"]].count("text") == 1
                  and frozen_req and all(f"to={FROZEN_DAY}" in u for u in frozen_req if "tf=D" in u)
                  and any("tf=D" in u for u in frozen_req)
                  and not any("warm=1" in u for u in frozen_req + live_req)
                  and live_req and not any("to=" in u for u in live_req))
            record("C2_add_by_mouse", "PASS" if ok else "FAIL", items=[(i["kind"], i.get("symbol"), i.get("mode"), i.get("asOf")) for i in b["items"]],
                   levels=levels, edges=b["edges"], frozen_bars_requests=frozen_req[:4], live_bars_requests=live_req[:4],
                   frozen_card_bytes=len(json.dumps(amd)), board_bytes=len(json.dumps(b)))

        # ── C3 ─────────────────────────────────────────────────────────────
        @guarded("C3_move_resize_delete_undo_by_mouse")
        def c3():
            pg, nid, tid = state["page"], state["canvas"], state["text_id"]
            before = next(i for i in board_of(nid)["items"] if i["id"] == tid)
            pg.get_by_role("button", name="Show everything").click()
            show_board(pg)
            box = card(pg, tid).bounding_box()
            sx, sy = box["x"] + 30, box["y"] + 30
            pg.mouse.move(sx, sy)
            pg.mouse.down()
            for s in range(1, 21):
                pg.mouse.move(sx + s * 8, sy + s * 4)
            pg.mouse.up()
            b, moved = wait_board(nid, lambda b: next(i for i in b["items"] if i["id"] == tid)["x"] != before["x"])
            after_move = next(i for i in b["items"] if i["id"] == tid)
            # resize by the handle (the card is selected after the drag). Fit first: run 1's
            # drag left the card at the board's lower edge, its handle under the selection bar.
            pg.get_by_role("button", name="Show everything").click()
            show_board(pg)
            handle = pg.locator(f'[data-canvas-resize="{tid}"]')
            hb = handle.bounding_box()
            hit = pg.evaluate("([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.getAttribute('data-canvas-resize') || String(e.className) || e.tagName) : null }",
                              [hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2])
            pg.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
            pg.mouse.down()
            for s in range(1, 11):
                pg.mouse.move(hb["x"] + hb["width"] / 2 + s * 8, hb["y"] + hb["height"] / 2 + s * 4)
            pg.mouse.up()
            b, resized = wait_board(nid, lambda b: next(i for i in b["items"] if i["id"] == tid)["w"] > before["w"])
            after_resize = next(i for i in b["items"] if i["id"] == tid)
            shot(pg, "C3-moved-resized")
            # delete from the selection bar, then undo from the toolbar
            pg.get_by_role("toolbar", name="Selected cards").get_by_role("button", name="Delete").click()
            b, deleted = wait_board(nid, lambda b: all(i["id"] != tid for i in b["items"]))
            edges_after_delete = len(b["edges"])
            pg.get_by_role("toolbar", name="Canvas tools").get_by_role("button", name="Undo").click()
            b, undone = wait_board(nid, lambda b: any(i["id"] == tid for i in b["items"]) and len(b["edges"]) == 1)
            ok = moved and resized and deleted and undone and edges_after_delete == 0
            record("C3_move_resize_delete_undo_by_mouse", "PASS" if ok else "FAIL",
                   before={k: before[k] for k in ("x", "y", "w", "h")},
                   after_move={k: after_move[k] for k in ("x", "y")}, after_resize={k: after_resize[k] for k in ("w", "h")},
                   deleted=deleted, edges_after_delete=edges_after_delete, undone=undone, handle_hit=hit)

        # ── C4 ─────────────────────────────────────────────────────────────
        @guarded("C4_keyboard_only")
        def c4():
            pg, nid = state["page"], state["canvas"]
            kb = pg.keyboard
            facts = {"lost_focus": []}

            def check_focus(tag):
                t = active_tag(pg)
                if t in (None, "BODY"):
                    facts["lost_focus"].append(tag)
            # setup: focus the last toolbar control, then the keyboard takes over
            pg.get_by_role("toolbar", name="Canvas tools").get_by_role("button", name="Keys").focus()
            kb.press("Escape")
            kb.press("Tab")                                   # -> the board itself
            facts["on_board"] = pg.evaluate("() => document.activeElement.getAttribute('role')")
            kb.press("Tab")                                   # -> the first card, reading order
            first = active_card(pg)
            facts["first_card"] = first
            b0 = board_of(nid)
            it0 = next(i for i in b0["items"] if i["id"] == first)
            kb.press("ArrowRight"); kb.press("ArrowRight"); kb.press("Shift+ArrowDown")
            b, moved = wait_board(nid, lambda b: next(i for i in b["items"] if i["id"] == first)["y"] == it0["y"] + 64)
            it1 = next(i for i in b["items"] if i["id"] == first)
            facts["moved"] = {"dx": it1["x"] - it0["x"], "dy": it1["y"] - it0["y"]}
            kb.press("Alt+ArrowRight")
            b, resized = wait_board(nid, lambda b: next(i for i in b["items"] if i["id"] == first)["w"] == it0["w"] + 8)
            check_focus("after move/resize")
            # T adds a text card (opens for writing), Escape commits and returns focus
            kb.press("t")
            pg.get_by_role("textbox", name="Card text").wait_for(timeout=5000)   # a person sees the box, then types
            kb.type("Keyboard card")
            kb.press("Escape")
            b, typed = wait_board(nid, lambda b: any(i.get("text") == "Keyboard card" for i in b["items"]))
            kid = active_card(pg)
            check_focus("after T")
            # Enter edits it, Escape commits
            kb.press("Enter")
            pg.get_by_role("textbox", name="Card text").wait_for(timeout=5000)
            kb.press("End")
            kb.type(" edited")
            kb.press("Escape")
            b, edited = wait_board(nid, lambda b: any(i.get("text") == "Keyboard card edited" for i in b["items"]))
            # Delete it; focus goes to a card; Ctrl+Z brings it back
            kb.press("Delete")
            b, deleted = wait_board(nid, lambda b: all(i["id"] != kid for i in b["items"]))
            facts["focus_after_delete"] = active_card(pg)
            check_focus("after Delete")
            kb.press("Control+z")
            b, undone = wait_board(nid, lambda b: any(i["id"] == kid for i in b["items"]))
            # L: a custom level through the dialog, by keyboard
            n_levels = len(b["levels"])
            kb.press("l")
            pg.get_by_role("dialog", name="Add price levels").wait_for(timeout=5000)
            kb.press("Tab"); kb.press("Tab"); kb.press("Tab")
            kb.type("Add-on")
            kb.press("Tab")
            kb.type("190")
            kb.press("Enter")
            b, levelled = wait_board(nid, lambda b: len(b["levels"]) == n_levels + 1)
            check_focus("after the levels dialog")
            # A: an arrow from the focused card (focus came back to it), label typed, Enter submits
            n_edges = len(b["edges"])
            facts["focus_after_levels_dialog"] = active_card(pg)
            kb.press("a")
            pg.get_by_role("dialog", name="Arrows").wait_for(timeout=5000)
            kb.press("Tab")
            kb.type("keys")
            kb.press("Enter")
            b, arrowed = wait_board(nid, lambda b: len(b["edges"]) == n_edges + 1)
            check_focus("after the arrow dialog")
            # zoom by keys, and the key list
            z0 = pg.get_by_role("button", name="Show everything").inner_text()
            kb.press("+")
            z1 = pg.get_by_role("button", name="Show everything").inner_text()
            kb.press("0")
            z2 = pg.get_by_role("button", name="Show everything").inner_text()
            kb.press("?")
            keys_open = pg.get_by_role("dialog", name="Canvas keys").is_visible()
            kb.press("Escape")
            check_focus("after the keys list")
            shot(pg, "C4-keyboard")
            facts.update({"resized": resized, "typed": typed, "edited": edited, "deleted": deleted, "undone": undone,
                          "levelled": levelled, "arrowed": arrowed, "zoom": [z0, z1, z2], "keys_dialog": keys_open})
            ok = (facts["on_board"] == "application" and moved and resized and typed and edited and deleted and undone
                  and levelled and arrowed and z1 != z0 and keys_open and facts["focus_after_delete"]
                  and not facts["lost_focus"])
            record("C4_keyboard_only", "PASS" if ok else "FAIL", **facts)

        # ── C5 ─────────────────────────────────────────────────────────────
        @guarded("C5_touch_390")
        def c5():
            nid = state["canvas"]
            phone = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                        is_mobile=True, has_touch=True, storage_state=member.storage_state())
            pg = new_page(phone)
            open_canvas(pg, nid)
            pg.wait_for_timeout(800)
            shot(pg, "C5-phone-top")
            # run 2: the board starts below the fold on a phone, and touches dispatched at its
            # coordinates landed outside the screen. A member scrolls to it; so does the walk.
            show_board(pg)
            shot(pg, "C5-phone")
            overflow = pg.evaluate("() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth")
            small = pg.evaluate("""() => [...document.querySelectorAll('[aria-label="Trade-plan canvas"] button')]
                .filter((b) => b.offsetParent !== null && getComputedStyle(b).pointerEvents !== 'none')
                .map((b) => ({ name: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 30), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }))
                .filter((b) => b.h < 44 || b.w < 44)""")
            cdp = phone.new_cdp_session(pg)
            vp = pg.get_by_role("application").bounding_box()
            empty = pg.evaluate(EMPTY_POINT)
            layer_t0 = pg.evaluate("() => document.querySelector('[role=\"application\"] > div').style.transform")
            ex, ey = (empty["x"], empty["y"]) if empty else (vp["x"] + 20, vp["y"] + vp["height"] - 20)

            def touch(kind, pts):
                cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})
            touch("touchStart", [{"x": ex, "y": ey, "id": 1}])
            for s in range(1, 11):
                touch("touchMove", [{"x": ex - s * 6, "y": ey - s * 4, "id": 1}])
            touch("touchEnd", [])
            pg.wait_for_timeout(200)
            layer_t1 = pg.evaluate("() => document.querySelector('[role=\"application\"] > div').style.transform")
            z0 = pg.get_by_role("button", name="Show everything").inner_text()
            # runs 3-4: the pinch left the zoom where it was. Record what the board RECEIVED.
            pg.evaluate("""() => {
              const vp = document.querySelector('[role="application"]')
              window.__w11dPtr = []
              for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart']) {
                vp.addEventListener(t, (e) => {
                  if (window.__w11dPtr.length < 80) window.__w11dPtr.push([t, e.pointerId ?? null, e.isPrimary ?? null,
                    Math.round(e.clientX ?? 0), Math.round(e.clientY ?? 0),
                    (e.target.closest && (e.target.closest('[data-canvas-item]')?.getAttribute('data-canvas-item')
                      || (e.target.closest('[data-canvas-chrome]') ? 'chrome' : e.target.tagName))) || null])
                }, true)
              }
            }""")
            cx, cy = vp["x"] + vp["width"] / 2, vp["y"] + vp["height"] / 2
            touch("touchStart", [{"x": cx - 30, "y": cy, "id": 1}, {"x": cx + 30, "y": cy, "id": 2}])
            for s in range(1, 11):
                touch("touchMove", [{"x": cx - 30 - s * 8, "y": cy, "id": 1}, {"x": cx + 30 + s * 8, "y": cy, "id": 2}])
            touch("touchEnd", [])
            pg.wait_for_timeout(200)
            z1 = pg.get_by_role("button", name="Show everything").inner_text()
            pinch_events = pg.evaluate("() => window.__w11dPtr")
            (art / "C5-pinch-events.json").write_text(json.dumps(pinch_events, indent=0), encoding="utf-8")
            # a level through the real control (no keyboard, no drag). Run 1: Playwright scrolled
            # the button to the very top, under the app's fixed phone header, and the tap landed on
            # the header. A member scrolls the board into view first; so does the walk.
            n = len(board_of(nid)["levels"])
            added, level_error = False, None
            try:
                show_board(pg)
                pg.get_by_role("toolbar", name="Canvas tools").get_by_role("button", name=re.compile(r"^Levels$")).tap(timeout=10000)
                dlg = pg.get_by_role("dialog", name="Add price levels")
                dlg.get_by_label("Custom level (optional)").fill("Phone level")
                dlg.get_by_label("Its price").fill("199")
                dlg.get_by_role("button", name="Add levels").tap(timeout=10000)
                b, added = wait_board(nid, lambda b: len(b["levels"]) == n + 1)
            except Exception as e:  # noqa: BLE001 -- recorded with the other facts
                level_error = f"{type(e).__name__}: {str(e)[:600]}"
            shot(pg, "C5-phone-after")
            ok = overflow <= 1 and not small and layer_t1 != layer_t0 and z1 != z0 and added
            record("C5_touch_390", "PASS" if ok else "FAIL", sideways_overflow_px=overflow, controls_under_44px=small,
                   pan_transform=[layer_t0, layer_t1], pinch_zoom=[z0, z1], pinch_events_head=(pinch_events or [])[:12],
                   pinch_at=[cx, cy], level_added=added, level_error=level_error)
            phone.close()

        # ── C6 ─────────────────────────────────────────────────────────────
        @guarded("C6_link_from_a_thesis")
        def c6():
            pg, nid = state["page"], state["canvas"]
            title = f"NVDA thesis {run}"
            r = api.post(base + "/api/j2/notes", data={"title": title, "bodyJson": {"type": "doc", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "Data centre cycle thesis."}]}]}})
            thesis = r.json()["note"]["id"]
            open_canvas(pg, nid)
            pg.get_by_role("toolbar", name="Canvas tools").get_by_role("button", name=re.compile("Link from a thesis")).click()
            dlg = pg.get_by_role("dialog", name="Link this plan from a note")
            dlg.get_by_label("Find the note to link from").fill(title)
            dlg.get_by_role("list", name="Notes").get_by_role("button", name=re.compile(re.escape(title))).first.click()
            offer = pg.get_by_role("region", name="Link a trade plan")
            offer.wait_for(timeout=15000)
            shot(pg, "C6-offer")
            offer.get_by_role("button", name="Add link").click()
            end, linked = time.time() + 20, False
            while time.time() < end and not linked:
                linked = nid in json.dumps(get_note(thesis)["bodyJson"])
                time.sleep(0.4)
            elapsed_easy = round((time.time() - state.get("t_easy_start", time.time())) * 1000)
            open_canvas(pg, nid)
            # run 2: the note's own "Linked from (1)" section starts COLLAPSED; the board now
            # shows its backlinks itself, open, above the toolbar.
            back = pg.get_by_role("navigation", name="Linked from")
            try:
                back.wait_for(timeout=15000)
                back_titles = back.inner_text()
            except Exception:  # noqa: BLE001 -- recorded as absent, the row continues
                back_titles = ""
            toasts = pg.evaluate("() => [...document.querySelectorAll('[role=status],[role=alert]')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 6)")
            shot(pg, "C6-linked-from")
            bl = api.get(base + f"/api/j2/notes/{nid}/backlinks").json()
            graph = api.get(base + "/api/j2/notes/graph").json()
            edge = any(e.get("source") == thesis and e.get("target") == nid for e in graph.get("edges", []))
            # /canvas in the thesis: makes and links a SECOND canvas at the caret
            pg.goto(base + f"/journal/notebook?note={thesis}")
            pg.locator(".ProseMirror").first.wait_for(timeout=20000)
            pg.locator(".ProseMirror").first.click()
            pg.keyboard.press("End")
            pg.keyboard.press("Enter")
            pg.keyboard.type("/canvas")
            item = pg.get_by_role("option", name=re.compile("Trade-plan canvas"))
            item.first.wait_for(timeout=5000)
            shot(pg, "C6-slash")
            pg.keyboard.press("Enter")
            pg.get_by_text(re.compile("Trade plan created and linked")).first.wait_for(timeout=15000)
            end, links = time.time() + 20, []
            while time.time() < end and len(links) < 2:
                body = get_note(thesis)["bodyJson"]
                links = re.findall(r'"noteId": ?"([^"]+)"', json.dumps(body))
                time.sleep(0.4)
            second = [x for x in links if x != nid]
            second_is_canvas = bool(second) and get_note(second[0])["bodyJson"]["content"][0]["type"] == "tradeCanvas"
            state["thesis"], state["second_canvas"] = thesis, second[0] if second else None
            ok = linked and title in back_titles and edge and second_is_canvas
            record("C6_link_from_a_thesis", "PASS" if ok else "FAIL", thesis=thesis, linked=linked, status_lines_on_canvas=toasts,
                   linked_from_text=back_titles[:200], backlinks_api=bl, graph_edge=edge,
                   slash_second_canvas=second, second_is_canvas=second_is_canvas,
                   ms_create_to_linked_scripted=elapsed_easy)

        # ── C7 ─────────────────────────────────────────────────────────────
        @guarded("C7_reload_persisted")
        def c7():
            pg, nid = state["page"], state["canvas"]
            before = get_note(nid)
            pg.goto(base + f"/journal/notebook?note={nid}")
            H._dismiss_intro(pg)
            app(pg).wait_for(timeout=30000)
            pg.reload()
            H._dismiss_intro(pg)
            app(pg).wait_for(timeout=30000)
            pg.wait_for_timeout(3000)
            after = get_note(nid)
            b = after["bodyJson"]["content"][0]["attrs"]["board"]
            dom_cards = pg.locator("[data-canvas-item]").count()
            dom_edges = pg.locator("[data-canvas-edge]").count()
            level_rows = pg.get_by_role("region", name="Plan levels").locator("li").count()
            shot(pg, "C7-reloaded")
            ok = (before["updatedAt"] == after["updatedAt"] and dom_cards == len(b["items"])
                  and dom_edges == len(b["edges"]) and level_rows == len(b["levels"]))
            record("C7_reload_persisted", "PASS" if ok else "FAIL", updatedAt_unchanged_by_open=before["updatedAt"] == after["updatedAt"],
                   stored={"items": len(b["items"]), "edges": len(b["edges"]), "levels": len(b["levels"])},
                   dom={"cards": dom_cards, "edges": dom_edges, "level_rows": level_rows})

        # ── C8 ─────────────────────────────────────────────────────────────
        @guarded("C8_offline_then_reconnect")
        def c8():
            pg, nid = state["page"], state["canvas"]
            notes_before = api.get(base + "/api/j2/notes", params={"limit": 200}).json()
            count_before = len(notes_before.get("notes", []))
            member.set_offline(True)
            pg.get_by_role("toolbar", name="Canvas tools").get_by_role("button", name=re.compile(r"^Sticky")).click()
            pg.get_by_role("textbox", name="Sticky note text").fill(f"Offline sticky {run}")
            pg.keyboard.press("Escape")
            pg.keyboard.press("ArrowRight")
            pg.wait_for_timeout(3500)
            # the API context is not the page: it still reaches the server, which must NOT have the edit yet
            server_had_it_while_offline = any(i.get("text") == f"Offline sticky {run}" for i in board_of(nid)["items"])
            shot(pg, "C8-offline")
            member.set_offline(False)
            b, landed = wait_board(nid, lambda b: any(i.get("text") == f"Offline sticky {run}" for i in b["items"]), timeout=45)
            notes_after = api.get(base + "/api/j2/notes", params={"limit": 200}).json().get("notes", [])
            forks = [n for n in notes_after if "sync-conflict" in (n.get("tags") or [])]
            shot(pg, "C8-reconnected")
            ok = landed and not forks and len(notes_after) == count_before
            ok = ok and not server_had_it_while_offline
            record("C8_offline_then_reconnect", "PASS" if ok else "FAIL",
                   server_had_it_while_offline=server_had_it_while_offline, landed=landed,
                   forks=[n.get("title") for n in forks], notes_before=count_before, notes_after=len(notes_after))

        # ── C9 ─────────────────────────────────────────────────────────────
        @guarded("C9_export_markdown")
        def c9():
            nid = state["canvas"]
            r = api.get(base + f"/api/j2/notes/{nid}/export")
            text = r.body().decode("utf-8", errors="replace")
            (art / "C9-export.md").write_text(text, encoding="utf-8")
            want = ["Trade-plan canvas", "Entry: 182.50", "Stop: 171.00", "Target: 205.00",
                    f"AMD · Daily · frozen as of {FROZEN_DAY}", "NVDA · Daily · live",
                    "Base breakout over the 50-day on volume", "→"]
            missing = [w for w in want if w not in text]
            record("C9_export_markdown", "PASS" if r.status == 200 and not missing else "FAIL",
                   status=r.status, bytes=len(text), missing=missing, content_type=r.headers.get("content-type"))

        # ── C10 ────────────────────────────────────────────────────────────
        @guarded("C10_200_cards")
        def c10():
            items = []
            for i in range(200):
                x, y = (i % 20) * 300, (i // 20) * 220
                if i % 20 == 7:
                    items.append({"id": f"w{i}", "kind": "chart", "x": x, "y": y, "w": 240, "h": 160,
                                  "symbol": "SPY", "tf": "D", "mode": "live", "asOf": None})
                else:
                    items.append(text_card(i, x, y, f"Card {i}: a note on the setup", kind="sticky" if i % 3 == 0 else "text"))
            board = {"v": 1, "items": items, "edges": [{"id": f"e{i}", "from": f"w{i}", "to": f"w{i + 1}", "label": ""}
                                                         for i in range(0, 40, 2)], "levels": []}
            r = api.post(base + "/api/j2/notes", data={"title": f"200 cards {run}", "bodyJson": canvas_body(board, "Trade-plan canvas"),
                                                        "tags": ["trade-plan"]})
            big = r.json()["note"]["id"]
            state["big"] = big
            pg = new_page()
            pg.goto(base + "/journal/notebook?view=all")
            H._dismiss_intro(pg)
            t0 = time.time()
            pg.goto(base + f"/journal/notebook?note={big}")
            app(pg).wait_for(timeout=60000)
            pg.locator("[data-canvas-item]").first.wait_for(timeout=30000)
            open_ms = round((time.time() - t0) * 1000)
            pg.wait_for_timeout(1000)
            at_fit = pg.locator("[data-canvas-item]").count()
            zoom_fit = pg.get_by_role("button", name="Show everything").inner_text()
            pg.get_by_role("application").focus()
            for _ in range(6):
                pg.keyboard.press("+")
            pg.wait_for_timeout(600)
            zoom_in = pg.get_by_role("button", name="Show everything").inner_text()
            zoomed = pg.locator("[data-canvas-item]").count()
            shot(pg, "C10-200-zoomed")
            # pan (empty space), instrumented
            pg.keyboard.press("0")
            show_board(pg)
            pg.wait_for_timeout(300)
            empty = pg.evaluate(EMPTY_POINT)
            pg.mouse.move(empty["x"], empty["y"])
            pg.mouse.down()
            pg.wait_for_timeout(150)
            pg.evaluate(PROBE_INSTALL)          # measure the MOVES, not the press
            for s in range(1, 61):
                pg.mouse.move(empty["x"] - s * 5, empty["y"] - s * 2)
            pg.mouse.up()
            pg.wait_for_timeout(300)
            pan = pg.evaluate(PROBE_READ)
            # drag one card, instrumented
            # the target must be ON SCREEN and on top (run 1 picked a card the pan had moved
            # out of the board and dragged the sidebar's text instead)
            tid = pg.evaluate(PICK_VISIBLE)
            state["drag_target"] = tid
            target = pg.locator(f'[data-canvas-item="{tid}"]')
            tb = target.bounding_box()
            x0 = next(i for i in items if i["id"] == tid)["x"]
            pg.mouse.move(tb["x"] + 10, tb["y"] + 10)
            pg.mouse.down()
            pg.wait_for_timeout(150)            # the press selects the card (one render); then measure the MOVES
            pg.evaluate(PROBE_INSTALL)
            for s in range(1, 61):
                pg.mouse.move(tb["x"] + 10 + s * 2, tb["y"] + 10 + s)
            pg.mouse.up()
            pg.wait_for_timeout(500)
            drag = pg.evaluate(PROBE_READ)
            moved_board, moved = wait_board(big, lambda b: next(i for i in b["items"] if i["id"] == tid)["x"] != x0)
            shot(pg, "C10-200-after-drag")
            (art / "C10-frames.json").write_text(json.dumps({"pan": pan, "drag": drag}, indent=1), encoding="utf-8")
            pan_touched = [t for t in (pan or {}).get("touched", [])]
            drag_touched = [t for t in (drag or {}).get("touched", [])]
            ok = (at_fit > 0 and zoomed < 200 and moved and not pan_touched and set(drag_touched) == {tid})
            summary = {k: (pan or {}).get(k) for k in ("frames", "p50", "p95", "max", "mounted", "unmounted")}
            dsum = {k: (drag or {}).get(k) for k in ("frames", "p50", "p95", "max", "mounted", "unmounted")}
            record("C10_200_cards", "PASS" if ok else "FAIL", open_ms_navigation_to_first_card=open_ms,
                   cards_in_dom_at_fit=at_fit, zoom_at_fit=zoom_fit, cards_in_dom_zoomed=zoomed, zoom_zoomed=zoom_in,
                   pan_frames=summary, pan_longtasks=(pan or {}).get("longtasks"), pan_cards_touched=pan_touched,
                   drag_frames=dsum, drag_longtasks=(drag or {}).get("longtasks"), drag_cards_touched=drag_touched,
                   drag_target=tid, drag_committed=moved, raw="C10-frames.json")
            pg.close()

        # ── C11 ────────────────────────────────────────────────────────────
        @guarded("C11_gate_off")
        def c11():
            off = browser.new_context(viewport={"width": 1280, "height": 900}, storage_state=member.storage_state())

            def flip(route):
                resp = route.fetch()
                try:
                    body = resp.json()
                except Exception:  # noqa: BLE001
                    route.fulfill(response=resp)
                    return
                set_key(body, FLAG_KEY, False)
                route.fulfill(response=resp, json=body)
            off.route("**/api/auth/me", flip)
            pg = new_page(off)
            pg.goto(base + "/journal/notebook?view=all")
            H._dismiss_intro(pg)
            pg.get_by_role("button", name="Templates", exact=True).click()
            sheet = pg.get_by_role("dialog", name="New note")
            sheet.get_by_text("Blank note").first.wait_for(timeout=10000)          # control: the sheet rendered
            sheet_door = sheet.get_by_role("group", name="Plan a trade").count()
            pg.keyboard.press("Escape")
            pg.goto(base + "/journal/notebook/research/NVDA")
            H._dismiss_intro(pg)
            pg.get_by_role("button", name=re.compile("New thesis")).wait_for(timeout=20000)   # control
            research_door = pg.get_by_role("button", name=re.compile("Plan this trade")).count()
            # /canvas is not offered in a text note
            if not state.get("thesis"):
                state["thesis"] = api.post(base + "/api/j2/notes", data={"title": f"Text note {run}", "bodyJson": {
                    "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}]}}).json()["note"]["id"]
            pg.goto(base + f"/journal/notebook?note={state['thesis']}")
            pg.locator(".ProseMirror").first.wait_for(timeout=20000)
            pg.locator(".ProseMirror").first.click()
            pg.keyboard.press("End")
            pg.keyboard.press("Enter")
            pg.keyboard.type("/canvas")
            pg.wait_for_timeout(800)
            slash_door = pg.get_by_role("option", name=re.compile("Trade-plan canvas")).count()
            pg.keyboard.press("Escape")
            for _ in range(len("/canvas")):
                pg.keyboard.press("Backspace")
            # an existing canvas: read-only, with its sentence, nothing hidden
            pg.goto(base + f"/journal/notebook?note={state['canvas']}")
            app(pg).wait_for(timeout=30000)
            sentence = pg.get_by_text(re.compile("Trade-plan canvases are switched off right now")).count()
            edit_buttons = pg.get_by_role("toolbar", name="Canvas tools").get_by_role("button", name=re.compile(r"^Text")).count()
            cards = pg.locator("[data-canvas-item]").count()
            shot(pg, "C11-gate-off-canvas")
            ok = sheet_door == 0 and research_door == 0 and slash_door == 0 and sentence == 1 and edit_buttons == 0 and cards > 0
            record("C11_gate_off", "PASS" if ok else "FAIL", method="the auth payload answered with notebook_trade_canvas_enabled=false by a Playwright route (the env var's only effect is that key; tests/test_notebook_trade_canvas.py)",
                   new_note_sheet_door=sheet_door, research_door=research_door, slash_door=slash_door,
                   read_only_sentence=sentence, edit_buttons=edit_buttons, cards_still_shown=cards)
            off.close()

        for row in (c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11):
            row()
        record("C12_no_page_errors", "PASS" if not res["errors"] else "FAIL", errors=res["errors"][:10])
        res["schema_headers_on_canvas_puts"] = sorted({p_["schema"] for p_ in res["puts"] if state.get("canvas", "?") in p_["path"]}, key=str)
        browser.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wave 11 lane 11D live walk (see the module header).")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8571)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tip", default=None)
    ap.add_argument("--artifacts", required=True)
    args = ap.parse_args(argv)
    base = f"http://127.0.0.1:{args.port}"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    art = Path(args.artifacts)
    art.mkdir(parents=True, exist_ok=True)
    res.update({"tip": args.tip, "base": base, "data_dir": args.data_dir,
                "instrument": os.path.relpath(__file__, REPO),
                "walk_process_env": {"NOTEBOOK_TRADE_CANVAS_ENABLED": os.environ.get("NOTEBOOK_TRADE_CANVAS_ENABLED")}})
    refused = H.refuse_shared_root(args.data_dir)
    if not refused and H.port_busy(args.port):
        refused = f"port {args.port} already has a listener (never killed)"
    if refused:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: {refused})")
        return 3
    sb = H.Sandbox(args.data_dir, args.port, art / "launcher.log")
    not_run = None
    try:
        sb.start()
        if not sb.wait_healthy(base, 300):
            not_run = "the sandbox never answered /api/health"
        else:
            sb.wait_checkpoint(H.POST_BOOT, H.POST_BOOT_WAIT_S)
            v = sandbox_identity.verify(base, sb.integrity_path())
            res["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
            if not v.ok:
                not_run = v.sentence
            else:
                try:
                    run_walk(base, art)
                except Exception as e:  # noqa: BLE001 -- setup failed; the sandbox still owes its verdict
                    not_run = f"{type(e).__name__}: {e}"
                    res["traceback"] = traceback.format_exc()[-2000:]
                res["prewarm_checkpoint_reached"] = sb.wait_checkpoint(H.PREWARM, H.PREWARM_WAIT_S)
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        integ = H.read_integrity(ipath, REQUIRED)
        if ipath and Path(ipath).is_file():
            kept = out.with_suffix(".integrity.md")
            shutil.move(ipath, kept)
            integ["path"] = str(kept)
        first = H.integrity_line(integ, not_run=not_run)
        res.update({"first_line": first, "integrity": integ, "not_run": not_run})
        out.write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
        print(first)
        for line in LINES:
            print(line)
        print(f"evidence: {out}")
    if not_run:
        return 3
    verdicts = {k: v["verdict"] for k, v in res["checks"].items()}
    if any(v == "FAIL" for v in verdicts.values()):
        return 1
    if not integ.get("clean") or any(v == "INCONCLUSIVE" for v in verdicts.values()):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
