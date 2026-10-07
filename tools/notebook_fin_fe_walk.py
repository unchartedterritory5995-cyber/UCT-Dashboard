"""Finish program, lane FE -- the real-browser check for findings C1 and I5 (plus the I7 look at
selecting a chart block), against a LOCAL sandbox with the chart-plan and fingerprint flags ON.

It OWNS its sandbox (tools/notebook_perf_harness.py's `Sandbox`: scripts/hub_sandbox_boot.py, its
own process group, stopped gracefully so the launcher writes the SHUTDOWN checkpoint). Its first
output line is the launcher's integrity verdict. It writes RAW evidence (every request the page
made, the API reads it took, screenshots) before any row is judged, and draws no conclusion beyond
the rows.

⛔ THIS DRIVER NEVER IMPORTS `api.*` (asserted by the last row).
⛔ THE BARS ARE A FIXTURE, AND SAID SO: the sandbox has no market vendor keys, so `/api/bars/<SYM>`
is answered with deterministic synthetic bars (the 13H-2 walk's own `synth_bars`). Everything else
is the product.

What it does, as one signed-in paid admin in one tab:

  A  (finding C1) The member has a "follow this line" alert made on the Charts page: a horizontal
     line on AMD in the browser's own drawing store, and an alert bound to that drawing, created
     through the product's alert route. They open a note holding an AMD chart with ONE drawn line of
     its own, open the chart's Plan panel and press "Arm alert at this level" on the note's line.
     Arming re-reads the alert list, so every mounted alert sync (the note chart's and the plan
     panel's) runs again with BOTH lines already seen: the moment each used to delete the other's
     alert. Recorded: every request. Rows: no DELETE to /api/watchlist-alerts is sent; the Charts
     alert and the plan alert both still exist.

  B  (finding I5) They open a second note holding an AMD chart with no frozen fingerprint, look at
     it, and leave. Rows: zero PUT/PATCH/POST/DELETE to that note (the one request allowed is the
     Recents beacon `POST /notes/<id>/opened`, wave B's "this note was opened" signal, which is not
     a write to the note and is listed in the raw evidence); no fingerprint freeze request; the
     note's stored `updatedAt` and chart block are what they were.

  C  (I7, observation rows) On a third note: does a click on the chart body select the block; can
     the block still be selected by mouse (its frame) and by keyboard; copied; deleted; undone.

  --expect-defects  is the CONTROL: run it against a build with the two fixes taken out, and the A
     and B rows must come back FAIL (the walk can see the defects). The verdict line says so.

Run from PowerShell, port 8133:

    python tools/notebook_fin_fe_walk.py --data-dir 'C:\\data-fin-fe' --port 8133 `
        --out 'docs\\notebook\\evidence\\fin-fe\\walk-<sha>'

Exit: 0 = every judged row PASS and integrity CLEAN (or, with --expect-defects, the defect rows
FAILED as expected); 1 = a row failed; 2 = integrity not CLEAN; 3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.*
from notebook_w13h2_walk import frame_of, install_bars_route, toolbar_button  # noqa: E402  -- reused, never re-typed
from secret_scrub import brief, scrub  # noqa: E402

SYM = "AMD"
NOTE_DAY = "2026-06-15"
CHART_LINE = {"id": "charts-line-1", "type": "horizontal", "points": [{"time": 1750000000, "price": 91.5}]}
WRITE_METHODS = ("PUT", "PATCH", "POST", "DELETE")


def chart_embed(embed_id: str, line_id: str, price: float, caption: str | None = "the plan chart") -> dict:
    """A chart block exactly as the editor stores one that was inserted earlier: a frozen daily
    chart with an archive image already recorded (so nothing about ARCHIVING is in play here) and
    one drawn horizontal line."""
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "chart",
        "params": {"symbol": SYM, "tf": "D", "to": NOTE_DAY},
        "capturedAt": "2026-06-15T19:55:00.000Z", "embedId": embed_id, "mode": "snapshot",
        "fallback": {"url": "/api/j2/notes/images/fin-fe-fixture.png", "w": 1200, "h": 600},
        "tradeRef": None, "tradeRefType": None,
        "annotations": [{"id": line_id, "type": "horizontal", "points": [{"time": 1750000000, "price": price}]}],
        "caption": caption, "layout": {"width": "full", "height": None},
        "searchText": f"{SYM} D chart", "ta": None,
    }}


def para(text: str) -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def make_note(req, base, title: str, embed_id: str, line_id: str, price: float, caption: str | None = "the plan chart") -> dict:
    doc = {"type": "doc", "content": [para("before the chart"), chart_embed(embed_id, line_id, price, caption), para("after the chart")]}
    r = req.post(base + "/api/j2/notes", data={"title": title, "bodyJson": doc})
    if r.status not in (200, 201):
        raise h.SetupFailed(f"creating the note '{title}' failed: HTTP {r.status} {r.text()[:300]}")
    return r.json()["note"]


def read_note(req, base, nid: str) -> dict:
    r = req.get(f"{base}/api/j2/notes/{nid}")
    j = r.json()
    return j.get("note") or j


def embeds_of(note: dict) -> list[dict]:
    body = note.get("bodyJson") or note.get("body_json") or {}
    if isinstance(body, str):
        body = json.loads(body)
    return [n for n in (body.get("content") or []) if n.get("type") == "widgetEmbed"]


class Recorder:
    """Every request the page makes, in order, with the response status when it arrives."""

    def __init__(self, page, base: str):
        self.rows: list[dict] = []
        self.base = base
        self.mark_at = 0
        page.on("request", self._on_request)
        page.on("response", self._on_response)

    def _on_request(self, r):
        if "/api/" not in r.url:
            return
        self.rows.append({"t": round(time.time(), 3), "method": r.method, "url": r.url.replace(self.base, ""),
                          "status": None, "_req": r})

    def _on_response(self, resp):
        for row in reversed(self.rows):
            if row.get("_req") is resp.request:
                row["status"] = resp.status
                return

    def mark(self) -> int:
        self.mark_at = len(self.rows)
        return self.mark_at

    def since(self, at: int | None = None) -> list[dict]:
        rows = self.rows[self.mark_at if at is None else at:]
        return [{k: v for k, v in r.items() if k != "_req"} for r in rows]

    def all(self) -> list[dict]:
        return self.since(0)


def spa_go(pg, path: str) -> None:
    """A client-side navigation (no document load), so the app's in-memory state is kept exactly as
    it is for a member clicking a link."""
    pg.evaluate("(p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')) }", path)


def wait_for(pg, fn, timeout_s: float, every_s: float = 0.5):
    """Poll `fn`, PUMPING the page between polls. A bare time.sleep() never lets Playwright's
    sync API deliver request/response events, so a recorder read after one sees nothing new
    (run 2 of this walk recorded an armed alert's POST with no status for exactly that reason)."""
    end = time.time() + timeout_s
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        pg.wait_for_timeout(int(every_s * 1000))
    return last


def pause(pg, seconds: float) -> None:
    """Wait while the page's events keep being delivered (never time.sleep in the walk)."""
    pg.wait_for_timeout(int(seconds * 1000))


def run(base: str, w, expect_defects: bool) -> None:
    from playwright.sync_api import sync_playwright
    served: list[dict] = []
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ctx = br.new_context(viewport={"width": 1280, "height": 1400}, reduced_motion="reduce")
        req = ctx.request
        # the paid sandbox admin: hubtest@local.dev is promoted by ADMIN_EMAILS, then comped
        h._signup_or_login(req, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        comp = req.post(base + "/api/auth/admin/comp-access", data={"email": h.ADMIN_EMAIL, "action": "grant"})
        req.post(base + "/api/auth/admin/verify-email", data={"email": h.ADMIN_EMAIL})
        me = req.get(base + "/api/auth/me").json()
        w.raw["me"] = {k: me.get(k) for k in ("paid_equiv", "notebook_chart_plan_enabled", "notebook_ta_fingerprint_enabled")}
        role = me.get("role") or (me.get("user") or {}).get("role")
        w.raw["me"].update({"role": role, "comp_status": comp.status, "payload_keys": sorted(me.keys())[:60]})
        flags_on = me.get("notebook_chart_plan_enabled") is True and me.get("notebook_ta_fingerprint_enabled") is True
        w.record("W0_admin_paid_flags_on", bool(flags_on and me.get("paid_equiv") and role == "admin"),
                 f"/api/auth/me {w.raw['me']}")
        if not flags_on:
            raise h.SetupFailed("the chart-plan and fingerprint flags are not both ON in the auth payload")

        # ── seed, through the product's own routes ─────────────────────────────────────────
        note_a = make_note(req, base, "fin-fe A: plan chart", "emb-a", "note-line-1", 88.0)
        note_b = make_note(req, base, "fin-fe B: just looking", "emb-b", "note-line-2", 87.0)
        note_c = make_note(req, base, "fin-fe C: selecting", "emb-c", "note-line-3", 86.0, caption=None)
        bound = req.post(base + "/api/watchlist-alerts", data={
            "sym": SYM, "target_price": CHART_LINE["points"][0]["price"], "direction": "above",
            "alert_type": "line", "drawing_id": CHART_LINE["id"]})
        w.raw["bound_alert_create"] = {"status": bound.status, "body": bound.text()[:400]}
        if bound.status not in (200, 201):
            raise h.SetupFailed(f"creating the bound alert failed: {w.raw['bound_alert_create']}")
        alerts0 = req.get(base + "/api/watchlist-alerts").json()
        w.dump("A0_alerts_before.json", alerts0)

        # the member's Charts drawing lives in the browser's own drawing store
        ctx.add_init_script(
            "try { if (!localStorage.getItem('uct-chart-drawings')) localStorage.setItem('uct-chart-drawings', "
            + json.dumps(json.dumps({SYM: [CHART_LINE]})) + ") } catch (e) {}")
        install_bars_route(ctx, served)
        pg = ctx.new_page()
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(brief(e, 300)))
        rec = Recorder(pg, base)

        # ── A: C1 ──────────────────────────────────────────────────────────────────────────
        pg.goto(f"{base}/journal/notebook?note={note_a['id']}", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        pg.wait_for_selector(".ProseMirror", timeout=60000)
        pg.wait_for_selector("[data-widget-embed-body] canvas", timeout=90000)
        got_list = wait_for(pg, lambda: any(r["url"].startswith("/api/watchlist-alerts") and r["method"] == "GET"
                                        and r["status"] == 200 for r in rec.all()), 60)
        stored = pg.evaluate("() => localStorage.getItem('uct-chart-drawings')")
        w.raw["A_charts_drawing_in_store"] = stored
        w.record("A1_note_chart_live_and_alert_sync_running",
                 bool(got_list) and CHART_LINE["id"] in (stored or ""),
                 f"chart canvas mounted; GET /api/watchlist-alerts seen={bool(got_list)}; Charts line in the drawing store="
                 f"{CHART_LINE['id'] in (stored or '')}")
        pause(pg, 4)
        # the member opens the chart's Plan panel and arms an alert on the NOTE's line. Arming
        # re-reads the alert list, so every mounted sync runs again with both lines already seen.
        n_before = sum(1 for r in rec.all() if r["url"].startswith("/api/watchlist-alerts") and r["method"] == "GET")
        frame = frame_of(pg, 0)
        toolbar_button(pg, frame, "Plan", False).click()
        arm = pg.get_by_role("button", name="Arm alert at this level, 88.00")
        arm.first.wait_for(state="visible", timeout=30000)
        arm.first.click()
        armed_post = wait_for(pg, lambda: [r for r in rec.all() if r["url"].startswith("/api/j2/chart-plan/alerts")
                                       and r["method"] == "POST" and r["status"] is not None], 30)
        w.raw["A_arm_post"] = [{k: r[k] for k in ("method", "url", "status")} for r in (armed_post or [])]

        def refetched():
            return sum(1 for r in rec.all() if r["url"].startswith("/api/watchlist-alerts") and r["method"] == "GET"
                       and r["status"] == 200) > n_before
        saw_refetch = wait_for(pg, refetched, 60, 0.5)
        pause(pg, 8)
        w.shot(pg, "A_note_open")
        a_requests = rec.all()
        w.dump("A_requests.json", a_requests)
        alerts1 = req.get(base + "/api/watchlist-alerts").json()
        w.dump("A1_alerts_after.json", alerts1)
        deletes = [r for r in a_requests if r["method"] == "DELETE" and "/api/watchlist-alerts" in r["url"]]
        still = [a for a in alerts1 if a.get("drawing_id") == CHART_LINE["id"] and a.get("is_active")]
        arm_ok = bool(armed_post) and armed_post[0]["status"] in (200, 201)
        w.record("A2_plan_alert_armed_and_alert_list_reread", bool(arm_ok and saw_refetch),
                 f"POST /api/j2/chart-plan/alerts -> {armed_post[0]['status'] if armed_post else None}; alert list re-read after it="
                 f"{bool(saw_refetch)} (without the re-read the rows below would prove nothing)")
        w.record("A3_no_alert_DELETE_sent", not deletes,
                 "no DELETE to /api/watchlist-alerts" if not deletes else f"DELETE sent: {[d['url'] for d in deletes]}")
        w.record("A4_charts_alert_still_exists", len(still) == 1,
                 f"active alerts bound to {CHART_LINE['id']}: {len(still)} (of {len(alerts1)} active)")
        plan_bound = [a for a in alerts1 if a.get("drawing_id") == "nb:emb-a:note-line-1" and a.get("is_active")]
        w.record("A5_plan_alert_still_exists", len(plan_bound) == 1,
                 f"active alerts bound to nb:emb-a:note-line-1: {len(plan_bound)}")

        # ── B: I5 ──────────────────────────────────────────────────────────────────────────
        before = read_note(req, base, note_b["id"])
        w.dump("B0_note_before.json", before)
        at = rec.mark()
        spa_go(pg, f"/journal/notebook?note={note_b['id']}")
        pg.wait_for_function("(id) => new URLSearchParams(location.search).get('note') === id", arg=note_b["id"], timeout=30000)
        pg.wait_for_selector("[data-widget-embed-body] canvas", timeout=90000)
        panel = pg.locator('[data-testid="fingerprint-panel"]')
        panel.first.wait_for(state="visible", timeout=60000)
        panel_text = panel.first.inner_text()
        pause(pg, 20)                      # look at it: longer than autosave's debounce and the first freeze retries
        w.shot(pg, "B_note_viewed")
        spa_go(pg, "/journal/notebook")     # and leave
        pg.wait_for_function("() => !new URLSearchParams(location.search).get('note')", timeout=30000)
        pause(pg, 8)
        b_requests = rec.since(at)
        w.dump("B_requests.json", b_requests)
        after = read_note(req, base, note_b["id"])
        w.dump("B1_note_after.json", after)
        nid = note_b["id"]
        beacon = f"/api/j2/notes/{nid}/opened"      # wave B's Recents signal: not a write to the note
        note_writes = [r for r in b_requests if r["method"] in WRITE_METHODS and f"/api/j2/notes/{nid}" in r["url"]
                       and not (r["method"] == "POST" and r["url"].split("?")[0] == beacon)]
        w.raw["B_recents_beacon_seen"] = [f"{r['method']} {r['url']} -> {r['status']}" for r in b_requests
                                          if r["url"].split("?")[0] == beacon]
        freezes = [r for r in b_requests if "/notebook-fingerprint/" in r["url"] and r["method"] != "GET"]
        all_writes = [f"{r['method']} {r['url']} -> {r['status']}" for r in b_requests if r["method"] in WRITE_METHODS]
        w.raw["B_all_non_GET_requests"] = all_writes
        w.raw["B_fingerprint_panel_text"] = panel_text
        w.record("B1_fingerprint_panel_was_on_screen", "technical fingerprint" in panel_text.lower(),
                 f"panel text: {panel_text[:140]!r}")
        w.record("B2_zero_writes_to_the_note", not note_writes,
                 "no PUT/PATCH/POST/DELETE to the note (the Recents beacon aside, listed in raw)" if not note_writes
                 else f"writes: {[(r['method'], r['url'], r['status']) for r in note_writes]}")
        w.record("B3_no_fingerprint_freeze_request", not freezes,
                 "no freeze request" if not freezes else f"freeze requests: {[(r['method'], r['url'], r['status']) for r in freezes]}")
        same_time = before.get("updatedAt") == after.get("updatedAt")
        same_body = json.dumps(embeds_of(before), sort_keys=True) == json.dumps(embeds_of(after), sort_keys=True)
        w.record("B4_note_not_redated_or_changed", bool(same_time and same_body),
                 f"updatedAt before={before.get('updatedAt')!r} after={after.get('updatedAt')!r}; chart block identical={same_body}")

        # ── C: I7, selecting a chart block (observations; only C_keyboard rows are judged) ────
        obs: dict = {}
        try:
            spa_go(pg, f"/journal/notebook?note={note_c['id']}")
            pg.wait_for_function("(id) => new URLSearchParams(location.search).get('note') === id", arg=note_c["id"], timeout=30000)
            pg.wait_for_selector("[data-widget-embed-body] canvas", timeout=90000)
            pause(pg, 2)
            sel_js = "() => !!document.querySelector('.ProseMirror .ProseMirror-selectednode')"
            count_js = "() => document.querySelectorAll('.ProseMirror [data-widget-embed-body]').length"
            body = pg.locator("[data-widget-embed-body]").first
            bb = body.bounding_box()
            pg.mouse.click(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
            pause(pg, 0.5)
            obs["click_on_chart_body_selects_block"] = pg.evaluate(sel_js)
            # the frame: the node view's own wrapper, outside the body
            wrap = pg.evaluate("""() => {
              const b = document.querySelector('[data-widget-embed-body]')
              let el = b
              while (el && !(el.classList && el.classList.contains('react-renderer')) && !el.hasAttribute?.('data-node-view-wrapper')) el = el.parentElement
              const host = el || b.parentElement
              const r = host.getBoundingClientRect(), rb = b.getBoundingClientRect()
              const cap = [...host.querySelectorAll('*')].find((n) => n.textContent === 'the plan chart' && n.children.length === 0)
              const rc = cap ? cap.getBoundingClientRect() : null
              return { host: [r.left, r.top, r.width, r.height], body: [rb.left, rb.top, rb.width, rb.height],
                       caption: rc ? [rc.left, rc.top, rc.width, rc.height] : null }
            }""")
            obs["geometry"] = wrap
            pg.locator(".ProseMirror p").first.click()
            pause(pg, 0.3)
            tried = []
            for name, pt in (("caption (none on this block)", wrap["caption"] and (wrap["caption"][0] + wrap["caption"][2] / 2, wrap["caption"][1] + wrap["caption"][3] / 2)),
                             ("frame_top_edge", (wrap["host"][0] + wrap["host"][2] / 2, wrap["host"][1] + 1)),
                             ("frame_left_edge", (wrap["host"][0] + 1, wrap["host"][1] + wrap["host"][3] / 2))):
                if not pt:
                    continue
                pg.locator(".ProseMirror p").first.click()
                pause(pg, 0.2)
                pg.mouse.click(pt[0], pt[1])
                pause(pg, 0.5)
                tried.append({"where": name, "selected": pg.evaluate(sel_js)})
            obs["mouse_click_outside_body"] = tried
            # keyboard: caret at the end of the paragraph above, then arrow onto the block
            pg.locator(".ProseMirror p").first.click()
            pg.keyboard.press("End")
            presses = 0
            while presses < 4 and not pg.evaluate(sel_js):
                pg.keyboard.press("ArrowRight")
                presses += 1
                pause(pg, 0.25)
            obs["keyboard_arrow_selects_block"] = {"selected": pg.evaluate(sel_js), "arrow_right_presses": presses}
            kb_selected = obs["keyboard_arrow_selects_block"]["selected"]
            if kb_selected:
                pg.keyboard.press("Control+c")
                pause(pg, 0.2)
                pg.keyboard.press("Backspace")
                pause(pg, 0.6)
                obs["after_backspace_block_count"] = pg.evaluate(count_js)
                pg.keyboard.press("Control+z")
                pause(pg, 0.8)
                obs["after_undo_block_count"] = pg.evaluate(count_js)
                # move by keyboard: select again, cut, caret into the last paragraph, paste
                pg.locator(".ProseMirror p").first.click()
                pg.keyboard.press("End")
                for _ in range(presses):
                    pg.keyboard.press("ArrowRight")
                    pause(pg, 0.2)
                if pg.evaluate(sel_js):
                    pg.keyboard.press("Control+x")
                    pause(pg, 0.6)
                    obs["after_cut_block_count"] = pg.evaluate(count_js)
                    pg.locator(".ProseMirror p").last.click()
                    pg.keyboard.press("End")
                    pg.keyboard.press("Control+v")
                    pause(pg, 1.5)
                    obs["after_paste_block_count"] = pg.evaluate(count_js)
                    obs["order_after_cut_paste"] = pg.evaluate("""() => [...document.querySelector('.ProseMirror').children].map((el) =>
                        el.querySelector('[data-widget-embed-body]') ? 'CHART' : (el.textContent || '').slice(0, 24))""")
            # the toolbar's own Remove button (mouse)
            pg.locator("[data-widget-embed-body]").first.hover()
            pause(pg, 0.4)
            rm = pg.get_by_role("button", name="Remove embed")
            obs["remove_button_present"] = rm.count()
            w.shot(pg, "C_note_selecting")
            # every surface of the block that is NOT the chart body: which of them select it by mouse?
            surfaces = pg.evaluate("""() => {
              const b = document.querySelector('[data-widget-embed-body]')
              let host = b
              while (host && !host.hasAttribute?.('data-widget-embed-view')) host = host.parentElement
              host = host || b.parentElement
              const out = []
              const seen = new Set()
              const r = host.getBoundingClientRect()
              for (let y = r.top + 3; y < r.bottom - 2; y += 9) {
                for (let x = r.left + 6; x < r.right - 4; x += 37) {
                  const el = document.elementFromPoint(x, y)
                  if (!el || !host.contains(el) || b.contains(el)) continue
                  if (el.closest('button, select, input, textarea, a')) continue
                  const key = (el.getAttribute('class') || el.tagName).split('_')[1] || el.tagName
                  if (seen.has(key)) continue
                  seen.add(key)
                  out.push({ what: key, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 40), x, y })
                }
              }
              return out
            }""")
            probed = []
            for sfc in surfaces[:8]:
                pg.locator(".ProseMirror p").first.click()
                pause(pg, 0.15)
                pg.mouse.click(sfc["x"], sfc["y"])
                pause(pg, 0.4)
                probed.append({**sfc, "selected": pg.evaluate(sel_js)})
            obs["mouse_surfaces_outside_body_no_caption"] = probed
        except Exception as e:  # noqa: BLE001 -- observations: recorded, never the walk's verdict
            obs["error"] = brief(e, 300)
        w.raw["C_observations"] = obs
        w.dump("C_observations.json", obs)
        w.record("C1_keyboard_selects_deletes_and_restores_a_chart_block",
                 bool(obs.get("keyboard_arrow_selects_block", {}).get("selected")) and obs.get("after_backspace_block_count") == 0
                 and obs.get("after_undo_block_count") == 1,
                 f"arrow selects={obs.get('keyboard_arrow_selects_block')}; after Backspace={obs.get('after_backspace_block_count')}; "
                 f"after undo={obs.get('after_undo_block_count')}")

        w.raw["bars_fixture_served"] = len(served)
        w.raw["page_errors"] = errors
        w.dump("all_requests.json", rec.all())
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8133)
    ap.add_argument("--out", required=True)
    ap.add_argument("--expect-defects", action="store_true",
                    help="the control: this build has the C1 and I5 fixes removed; A3/A4 and B2/B3/B4 must FAIL")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port != 8133:
        print("REFUSED: this walk is assigned port 8133 only")
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
    from notebook_w13h2_walk import Walk
    w = Walk(out)
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    # Written for the CHILD (Popen inherits it), never read here.
    os.environ.update({"NOTEBOOK_CHART_PLAN_ENABLED": "1", "NOTEBOOK_TA_FINGERPRINT_ENABLED": "1"})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    not_run = failure = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            try:
                run(base, w, args.expect_defects)
            except h.SetupFailed as e:
                not_run = scrub(str(e))[:300]
            except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
                import traceback
                failure = f"the walk raised {brief(e, 400)}"
                w.raw["traceback"] = scrub(traceback.format_exc())[-3000:]
            box.wait_checkpoint(h.POST_BOOT, 60)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    w.record("W9_driver_never_imported_api", not api_mods,
             "no api.* module in the driver's sys.modules" if not api_mods else f"imported: {api_mods[:5]}")
    port_free = not h.port_busy(args.port)
    w.record("W10_port_free_after_shutdown", port_free, f"port {args.port} has a listener after stop: {not port_free}")
    result = {"tool": "tools/notebook_fin_fe_walk.py", "base": base, "expect_defects": args.expect_defects,
              "integrity": integ, "failure": failure, "not_run": not_run, "rows": w.rows, "raw": w.raw}
    (out / "walk.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT: FAIL -- {failure}")
        return 1
    failed = [r["id"] for r in w.rows if r["verdict"] != "PASS"]
    if args.expect_defects:
        want = {"A3_no_alert_DELETE_sent", "B2_zero_writes_to_the_note"}
        seen = want & set(failed)
        print(f"VERDICT: CONTROL {'SAW' if seen == want else 'DID NOT SEE'} THE DEFECTS -- failed rows: {failed}")
        return 0 if seen == want else 1
    if failed:
        print("VERDICT: FAIL -- " + ", ".join(failed))
        return 1
    if not integ.get("clean"):
        print(f"VERDICT: INTEGRITY {integ.get('status')}")
        return 2
    print(f"VERDICT: PASS -- {len(w.rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
