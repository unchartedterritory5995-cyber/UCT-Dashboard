"""Notebook finish program, lane WALK -- the items that are live the moment the landing branch
merges, walked with every wave 12-15 switch OFF (configuration c1), plus one UNPAID account.

Driven by tools/notebook_fin_walk.py (`--config c1`). Each step records what the product itself
answered (page text, the stored note, the response body), so a failed step can be judged PRODUCT
or INSTRUMENT afterwards from that answer. Never run on import.
"""
from __future__ import annotations

import json
import re
import sys
import time
import traceback
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO / "tools") not in sys.path:
    sys.path.insert(0, str(REPO / "tools"))

import notebook_perf_harness as h  # noqa: E402
import notebook_w14_onboarding_walk as w  # noqa: E402

MAIN_TEXT_JS = "() => (document.querySelector('[class*=\"_main_\"]') || document.body).innerText.trim().replace(/\\s+/g, ' ').slice(0, 500)"
PAID_ROUTES = ["/journal/notebook", "/journal/notebook?view=all", "/journal/notebook/setups", "/journal/insights",
               "/journal-2-0/playbook", "/journal/notebook/research/NVDA", "/journal/trades"]
PAID_APIS = [("GET", "/api/j2/notes?limit=5"), ("GET", "/api/j2/notebook/home"), ("POST", "/api/j2/onboarding/sample-notebook"),
             ("GET", "/api/j2/template-gallery"), ("GET", "/api/j2/plan-grades/discipline"), ("GET", "/api/j2/visual-playbook"),
             ("GET", "/api/j2/research-capture/passed-setups"), ("GET", "/api/j2/export/notebook?format=markdown")]


def sentence(body) -> str | None:
    """The human sentence of an error answer, or None when there is none."""
    d = body.get("detail") if isinstance(body, dict) else None
    if isinstance(d, dict):
        d = d.get("message") or d.get("detail")
    return d if isinstance(d, str) and " " in d and len(d) > 15 and "Traceback" not in d else None


def run_live(C, browser, admin, base, fs, vp: str) -> None:
    ctx, email, me = C.member(browser, admin.request, base, f"c1L{vp}", vp)
    inst = C.Inst(ctx, "c1", vp)
    pg = ctx.new_page()
    M = ctx.request
    touch = inst.touch

    def run(name, fn):
        try:
            fn()
        except Exception as e:  # noqa: BLE001 -- recorded; the walk goes on
            C.step(pg, inst, "live: " + name, "driver exception (the step did not finish)", "FAIL",
                   error=f"{type(e).__name__}: {str(e)[:500]}", traceback=traceback.format_exc()[-1400:])

    def press(loc):
        (loc.tap if touch else loc.click)(timeout=15000)

    def note(title, blocks, ticker=None):
        st, body = C.api(ctx, inst, "POST", base, "/api/j2/notes", {"title": title, **({"ticker": ticker} if ticker else {}),
                                                                    "bodyJson": {"type": "doc", "content": blocks}})
        return body["note"]

    def stored(nid):
        r = M.get(f"{base}/api/j2/notes/{nid}")
        return (r.json().get("note") or {}) if r.status == 200 else {}

    # ── a brand-new member's first Journal page: no 500 in the network log ──────────────
    def first_journal():
        C.goto(pg, base, "/journal")
        pg.wait_for_timeout(6000)
        row = C.step(pg, inst, "live: first Journal page", "a brand-new member's first Journal page loads", "INFO", email=email,
                     page_text=pg.evaluate(MAIN_TEXT_JS)[:200])
        five = [f for f in row.get("failed_requests", []) if f["status"] >= 500 and not f["benign"]]
        row["verdict"] = "FAIL" if five or row.get("error_boundary") else "PASS"
        row["server_errors"] = five
        print(f"{row['verdict']:<7} [c1 {vp}] live: first Journal page: no 5xx in the network log {json.dumps(five)[:200]}", flush=True)
        C.flush()
    run("first Journal page", first_journal)

    # ── the Today button on Research Home ───────────────────────────────────────────────
    def today():
        C.goto(pg, base, "/journal/notebook")
        C.settle_first_run(pg)
        b = pg.get_by_role("button", name="Today", exact=True)
        there = C.vis_loc(b, 20000)
        landed, title = None, None
        if there:
            press(b.first)
            try:
                pg.wait_for_url(lambda u: "note=" in u, timeout=30000)
                pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                landed = pg.url.split(base)[-1]
                title = stored(landed.split("note=")[-1].split("&")[0]).get("title")
            except Exception as e:  # noqa: BLE001
                landed = f"(no note opened: {str(e)[:120]})"
        C.step(pg, inst, "live: Today button", "Today on Research Home opens today's daily note", "PASS" if there and title else "FAIL",
               button=there, landed=landed, note_title=title)
    run("Today button", today)

    # ── built-in templates, the walkthrough toggle, the Trade Plan template's properties ──
    def templates():
        C.goto(pg, base, "/journal/notebook?view=all")
        press(pg.get_by_role("button", name="Templates", exact=True).filter(visible=True).first)
        C.vis(pg, "[data-template-key]", 30000)
        pg.wait_for_timeout(1200)
        cards = pg.eval_on_selector_all("[data-template-key]", "els => els.map(e => [e.getAttribute('data-template-key'), e.getAttribute('aria-label')])")
        keys = list(dict.fromkeys(k for k, _ in cards))
        toggles = pg.evaluate("""() => [...document.querySelectorAll('input[type=checkbox], [role=switch], button[aria-pressed]')]
            .filter(e => e.getBoundingClientRect().width > 0).map(e => ({ label: (e.getAttribute('aria-label') || (e.closest('label') || e).innerText || '').trim().slice(0, 80),
              checked: e.checked ?? e.getAttribute('aria-checked') ?? e.getAttribute('aria-pressed') }))""")
        walk_t = [t for t in toggles if re.search(r"walkthrough|how to use", t["label"], re.I)]
        C.step(pg, inst, "live: templates", "the template picker lists the built-in templates and a walkthrough toggle",
               "PASS" if len(keys) >= 8 and walk_t else "FAIL", template_count=len(keys), keys=keys, labels=[l for _, l in cards][:len(keys)],
               walkthrough_toggle=walk_t, all_toggles=toggles[:8], scope=["[role=dialog]"])
        tp = next((k for k in keys if re.search(r"trade.?plan", k, re.I)), None)
        if not tp:
            C.step(pg, inst, "live: templates", "Trade Plan template: found in the picker", "FAIL", keys=keys)
            return
        made = []
        for i in range(2):
            C.goto(pg, base, f"/journal/notebook?new={tp}")
            pg.wait_for_url(lambda u: "note=" in u, timeout=45000)
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            pg.wait_for_timeout(2500)
            nid = pg.url.split("note=")[-1].split("&")[0]
            props = M.get(f"{base}/api/j2/notes/{nid}/properties").json().get("properties") or []
            made.append({"note": nid, "props": [(p.get("id"), p.get("name"), p.get("type")) for p in props]})
            if i == 0:   # give the first note's property a value: a second use must not touch it
                rows = pg.locator("li[data-prop-row] input").filter(visible=True)
                if rows.count():
                    rows.first.fill("123")
                    pg.keyboard.press("Enter")
                    pg.wait_for_timeout(1200)
        first_after = M.get(f"{base}/api/j2/notes/{made[0]['note']}/properties").json().get("properties") or []
        ids0, ids1 = [p[0] for p in made[0]["props"]], [p[0] for p in made[1]["props"]]
        kept = [(p.get("name"), p.get("value")) for p in first_after if p.get("value") not in (None, "", [])]
        C.step(pg, inst, "live: templates", "Trade Plan template creates its properties once; a second use reuses them and leaves the first note's values alone",
               "PASS" if ids0 and ids0 == ids1 and kept else "FAIL", template=tp, first=made[0], second_same_ids=ids0 == ids1,
               first_note_values_after=kept, scope=["li[data-prop-row]"])
    run("templates", templates)

    # ── a chart in a note: click selects it, Delete removes it, drag moves it ───────────
    def chart_block():
        x = C.x13
        n = note(f"Chart select {vp}", [x.para("First paragraph."), x.chart_block("NVDA", [], f"e-sel-{vp}"), x.para("Last paragraph.")])
        C.goto(pg, base, f"/journal/notebook?note={n['id']}", ".ProseMirror")
        body = pg.locator("[data-widget-embed-body]").first
        body.wait_for(state="visible", timeout=40000)
        pg.wait_for_timeout(2500)
        body.scroll_into_view_if_needed()
        box = body.bounding_box()
        (pg.touchscreen.tap if touch else pg.mouse.click)(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        pg.wait_for_timeout(500)
        sel = pg.evaluate("""() => { const n = document.querySelector('.ProseMirror-selectednode'); const v = document.querySelector('[data-widget-embed-view]');
            return { selectedNode: !!n, selectedIsEmbed: !!(n && (n.matches('[data-widget-embed-view]') || n.querySelector('[data-widget-embed-view]') || (v && n.contains(v)))),
                     viewClass: v ? v.className.slice(0, 120) : null, ariaSelected: v ? v.getAttribute('aria-selected') || v.getAttribute('data-selected') : null } }""")
        C.step(pg, inst, "live: chart block", "clicking a chart in a note selects it", "PASS" if sel["selectedIsEmbed"] or sel["ariaSelected"] else "FAIL",
               **sel, scope=["[data-widget-embed-view]"])
        actions = pg.get_by_role("button", name="Block actions", exact=True).filter(visible=True).count()
        if touch:
            C.step(pg, inst, "live: chart block", "touch widths: the chart block has a Block actions button and a toolbar that is always there",
                   "PASS" if actions else "FAIL", block_actions=actions,
                   toolbar_buttons=pg.evaluate("() => [...document.querySelectorAll('[data-widget-embed-view] button')].filter(b => b.getBoundingClientRect().width > 0).map(b => (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 24))"),
                   scope=["[data-widget-embed-view]"])
        pg.keyboard.press("Delete")
        gone = False
        for _ in range(30):
            if "widgetEmbed" not in json.dumps(stored(n["id"]).get("bodyJson") or {}):
                gone = True
                break
            pg.wait_for_timeout(400)
        C.step(pg, inst, "live: chart block", "Delete removes the selected chart, and the note is saved without it", "PASS" if gone else "FAIL",
               embeds_on_page=pg.locator("[data-widget-embed-view]").count())
        if touch:
            return   # drag is a mouse gesture; touch widths move a block with Block actions (lane FE's own walk)
        n2 = note(f"Chart drag {vp}", [x.chart_block("NVDA", [], f"e-drag-{vp}"), x.para("Paragraph A."), x.para("Paragraph B.")])
        C.goto(pg, base, f"/journal/notebook?note={n2['id']}", ".ProseMirror")
        b2 = pg.locator("[data-widget-embed-body]").first
        b2.wait_for(state="visible", timeout=40000)
        pg.wait_for_timeout(2500)
        tgt = pg.locator(".ProseMirror p", has_text="Paragraph B.").first
        tgt.scroll_into_view_if_needed()
        sb, tb = b2.bounding_box(), tgt.bounding_box()
        derr = None
        try:
            pg.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
            pg.mouse.down()
            for i in range(1, 13):
                pg.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2 + (tb["y"] + tb["height"] + 6 - sb["y"] - sb["height"] / 2) * i / 12)
                pg.wait_for_timeout(40)
            pg.mouse.up()
        except Exception as e:  # noqa: BLE001
            derr = str(e)[:200]
        order = None
        for _ in range(20):
            order = [c.get("type") for c in ((stored(n2["id"]).get("bodyJson") or {}).get("content") or [])]
            if order and order[0] != "widgetEmbed":
                break
            pg.wait_for_timeout(400)
        C.step(pg, inst, "live: chart block", "dragging the chart moves it below the paragraphs (stored order changes)",
               "PASS" if order and order[0] != "widgetEmbed" and "widgetEmbed" in order else "FAIL", stored_order=order, drag_error=derr,
               note="a synthetic mouse drag; a FAIL here needs the product's own answer before it is called a defect")
    run("chart block", chart_block)

    # ── the two Log Trade dialogs open on the first click ───────────────────────────────
    def log_trade():
        C.goto(pg, base, "/journal/trades")
        btn = pg.get_by_role("button", name="Log Trade").filter(visible=True)
        if not C.vis_loc(btn, 20000) and touch:
            more = pg.get_by_role("button", name="More", exact=True).filter(visible=True)
            if more.count():
                press(more.first)
        t0 = time.time()
        press(btn.first)
        pg.wait_for_timeout(700)
        items = [t.strip()[:40] for t in pg.locator("[role=menuitem], [role=menu] button").all_inner_texts()]
        opened = []
        if not pg.locator("[role=dialog]").filter(visible=True).count() and items:
            for i in range(min(2, len(items))):
                if i:
                    press(pg.get_by_role("button", name="Log Trade").filter(visible=True).first)
                    pg.wait_for_timeout(400)
                t0 = time.time()
                press(pg.locator("[role=menuitem], [role=menu] button").nth(i))
                d = pg.locator("[role=dialog]").filter(visible=True)
                ok = C.vis_loc(d, 15000)
                opened.append({"item": items[i], "opened_on_first_click": ok, "ms": int((time.time() - t0) * 1000),
                               "title": (d.first.inner_text()[:60].replace("\n", " ") if ok else None)})
                pg.keyboard.press("Escape")
                pg.wait_for_timeout(600)
        else:
            d = pg.locator("[role=dialog]").filter(visible=True)
            ok = C.vis_loc(d, 15000)
            opened.append({"item": "Log Trade", "opened_on_first_click": ok, "ms": int((time.time() - t0) * 1000),
                           "title": (d.first.inner_text()[:60].replace("\n", " ") if ok else None)})
            pg.keyboard.press("Escape")
        C.step(pg, inst, "live: Log Trade", "each Log Trade dialog opens on the first click", "PASS" if opened and all(o["opened_on_first_click"] for o in opened) else "FAIL",
               menu_items=items, dialogs=opened)
    run("Log Trade", log_trade)

    # ── upload size limits answer with a human sentence ─────────────────────────────────
    def uploads():
        s1, p1 = C.api(ctx, inst, "POST", base, "/api/j2/positions", {"symbol": "IBM", "side": "Long", "shares": 5, "entryPrice": 200.0,
                                                                    "stopPrice": 190.0, "entryDate": C.TODAY.isoformat()})
        s2, tr = C.api(ctx, inst, "POST", base, f"/api/j2/positions/{(p1 or {}).get('id')}/close", {"shares": 5, "exitPrice": 204.0, "exitDate": C.TODAY.isoformat()})
        tid = ((tr.get("trade") or tr) if isinstance(tr, dict) else {}).get("id")
        n = note(f"Upload limits {vp}", [C.x13.para("Attachments go here.")])
        png = b"\x89PNG\r\n\x1a\n" + b"\0" * (6 * 1024 * 1024)
        cases = [("oversized image on a trade (6 MB, limit 5 MB)", f"/api/j2/trades/{tid}/attachments", "big.png", "image/png", png),
                 ("oversized CSV import (11 MB, limit 10 MB)", "/api/j2/trades/import/preview", "big.csv", "text/csv", b"symbol,qty\n" + b"A,1\n" * (11 * 1024 * 1024 // 4)),
                 ("oversized note attachment (60 MB)", f"/api/j2/notes/{n['id']}/attachments", "big.pdf", "application/pdf", b"%PDF-1.4\n" + b"\0" * (60 * 1024 * 1024))]
        for label, path, fname, mime, buf in cases:
            r = M.post(base + path, multipart={"file": {"name": fname, "mimeType": mime, "buffer": buf}}, timeout=120000)
            try:
                body = r.json()
            except Exception:  # noqa: BLE001
                body = (r.text() or "")[:300]
            said = sentence(body)
            C.REC.setdefault("api_writes", []).append({"config": "c1", "viewport": vp, "method": "POST", "url": path, "status": r.status,
                                                       "request": f"multipart file {fname}, {len(buf)} bytes, {mime}", "response": json.dumps(body, default=str)[:600]})
            C.step(None, inst, "live: upload limits", label + ": refused with a sentence a member can read",
                   "PASS" if r.status in (400, 413, 422) and said else "FAIL", status=r.status, sentence=said,
                   response=json.dumps(body, default=str)[:300], request=f"POST {path} multipart file={fname} {len(buf)} bytes", shot=False)
    run("upload limits", uploads)

    # ── the bulk note import wizard, on a small real import ─────────────────────────────
    def importer():
        import tempfile
        d = Path(tempfile.mkdtemp(prefix="finwalk-import-"))
        files = []
        for i in (1, 2):
            p = d / f"Imported idea {vp} {i}.md"
            p.write_text(f"# Imported idea {vp} {i}\n\nA note written elsewhere, number {i}.\n\n- one\n- two\n", encoding="utf-8", newline="\n")
            files.append(str(p))
        C.goto(pg, base, "/journal/notebook?view=all")
        door = pg.get_by_role("button", name=re.compile(r"^Import( notes)?$")).filter(visible=True)
        if not door.count():
            for nm in ("More", "More actions", "Notebook actions"):
                m = pg.get_by_role("button", name=nm, exact=True).filter(visible=True)
                if m.count():
                    press(m.last)
                    pg.wait_for_timeout(500)
                    if door.count():
                        break
        trail, err = [], None
        try:
            press(door.first)
            pg.wait_for_timeout(1000)
            pg.locator("input[type=file]").first.set_input_files(files, timeout=15000)
            for _ in range(8):
                pg.wait_for_timeout(1500)
                if len([x for x in C.notes_list(ctx, base) if (x.get("title") or "").startswith(f"Imported idea {vp}")]) >= 2:
                    break
                nxt = pg.locator("[role=dialog] button").filter(has_text=re.compile(r"^(Next|Continue|Import|Import \d+ notes?|Confirm|Start import|Review)", re.I)).filter(visible=True)
                nxt = [b for b in nxt.all() if b.is_enabled()]
                if not nxt:
                    trail.append("(no enabled forward button)")
                    continue
                trail.append(nxt[-1].inner_text().strip()[:30])
                nxt[-1].click()
        except Exception as e:  # noqa: BLE001
            err = str(e)[:300]
        got = [x.get("title") for x in C.notes_list(ctx, base) if (x.get("title") or "").startswith(f"Imported idea {vp}")]
        dlg = pg.locator("[role=dialog]").filter(visible=True)
        C.step(pg, inst, "live: import wizard", "import two small Markdown files through the wizard: both become notes",
               "PASS" if len(got) == 2 else "FAIL", imported=got, buttons_pressed=trail, reach_error=err,
               wizard_text=(dlg.first.inner_text()[:400] if dlg.count() else None), door_found=door.count(), scope=["[role=dialog]"])
        pg.keyboard.press("Escape")
    run("import wizard", importer)

    # ── share a note, open the public page signed out ───────────────────────────────────
    def share():
        n = note(f"Shared idea {vp}", [C.x13.para("A public paragraph that anyone with the link can read."),
                                        {"type": "paragraph", "content": [{"type": "text", "text": "Bold words.", "marks": [{"type": "bold"}]}]}])
        st, body = C.api(ctx, inst, "POST", base, f"/api/j2/notes/{n['id']}/share", {"expiresInDays": 7})
        sh = (body or {}).get("share") or {} if isinstance(body, dict) else {}
        url = sh.get("url") or sh.get("path") or (f"/journal/share/{sh.get('token')}" if sh.get("token") else None)
        if not url:
            C.step(None, inst, "live: share", "mint a share link for a note", "FAIL", status=st, response=json.dumps(body, default=str)[:400], shot=False)
            return
        anon = C.new_ctx(browser, vp)
        ai = C.Inst(anon, "c1", vp)
        ap = anon.new_page()
        try:
            ap.goto(url if url.startswith("http") else base + url, wait_until="domcontentloaded", timeout=60000)
            ap.wait_for_timeout(5000)
            txt = ap.evaluate("() => document.body.innerText.trim().replace(/\\s+/g, ' ').slice(0, 500)")
            C.step(ap, ai, "live: share", "the shared note's public page, opened signed out, shows the note",
                   "PASS" if "A public paragraph that anyone with the link can read." in txt else "FAIL", share_status=st, url=url,
                   landed=ap.url.replace(base, ""), page_text=txt, scripts_in_note=ap.locator("article script, main script").count())
        finally:
            anon.close()
    run("share", share)

    # ── keyboard skip links ─────────────────────────────────────────────────────────────
    def skip_links():
        if touch:
            return
        out = {}
        for label, path in (("Research Home", "/journal/notebook"), ("All notes", "/journal/notebook?view=all")):
            C.goto(pg, base, path)
            pg.wait_for_timeout(2500)
            C.settle_first_run(pg)
            pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); window.scrollTo(0, 0) }")
            seen = []
            for _ in range(6):
                pg.keyboard.press("Tab")
                t = pg.evaluate("() => { const a = document.activeElement; return a ? [(a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 50), a.tagName, a.getAttribute('href')] : null }")
                if t and t[0].lower().startswith("skip"):
                    seen.append(t)
            moved = None
            if seen:
                # go back to the first skip link and use it
                pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur() }")
                for _ in range(6):
                    pg.keyboard.press("Tab")
                    if (pg.evaluate("() => (document.activeElement.innerText || '').trim().toLowerCase()") or "").startswith("skip"):
                        break
                pg.keyboard.press("Enter")
                pg.wait_for_timeout(500)
                moved = pg.evaluate("() => { const a = document.activeElement; return a ? [a.tagName, a.id, (a.getAttribute('aria-label') || '').slice(0, 40)] : null }")
            out[label] = {"skip_links_reached_by_tab": seen, "focus_after_using_the_first": moved}
        ok = all(v["skip_links_reached_by_tab"] and v["focus_after_using_the_first"] and v["focus_after_using_the_first"][0] != "BODY" for v in out.values())
        C.step(pg, inst, "live: skip links", "Tab from the top reaches a skip link, and using it moves focus into the page", "PASS" if ok else "FAIL", **{k.replace(" ", "_"): v for k, v in out.items()})
    run("skip links", skip_links)

    # ── Settings: the voice telemetry tile ──────────────────────────────────────────────
    def voice_tile():
        C.goto(pg, base, "/settings")
        sec = pg.get_by_text("Compass & Voice", exact=True)
        if C.vis_loc(sec, 15000):
            press(sec.first)
        pg.wait_for_timeout(5000)
        tiles = pg.evaluate("""() => [...document.querySelectorAll('h2,h3,h4')].filter(e => /cost|usage|telemetry|spend/i.test(e.textContent))
            .map(e => { const card = e.closest('section, article, [class*="card"], [class*="tile"]') || e.parentElement;
                        return { heading: e.textContent.trim().slice(0, 60), text: (card.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 300) } })""")
        row = C.step(pg, inst, "live: voice telemetry tile", "Settings, Compass and Voice: the cost block shows numbers or a sentence, never a gap", "INFO", tiles=tiles)
        bad = [f for f in row.get("failed_requests", []) if "/api/voice/" in f["url"] and f["status"] >= 500]
        filled = [t for t in tiles if len(t["text"]) > len(t["heading"]) + 12]
        row["verdict"] = "PASS" if tiles and filled and not bad else "FAIL"
        row["voice_5xx"] = bad
        print(f"{row['verdict']:<7} [c1 {vp}] live: voice telemetry tile tiles={len(tiles)} filled={len(filled)} voice_5xx={bad}", flush=True)
        C.flush()
    run("voice telemetry tile", voice_tile)
    ctx.close()


def run_unpaid(C, browser, admin, base, vp: str) -> None:
    """An UNPAID, verified member: every paid Notebook surface must show the upgrade path."""
    ctx = C.new_ctx(browser, vp)
    inst = C.Inst(ctx, "c1", vp)
    email = f"fwunpaid{vp}{int(time.time()) % 1000000}@local.dev"
    w.signup(ctx.request, base, email, "LocalTest2026!", "fwunpaid")
    admin.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
    me = ctx.request.get(base + "/api/auth/me").json()
    pg = ctx.new_page()
    C.step(None, inst, "unpaid", "an account with no paid plan (control: paid_equiv is false)", "PASS" if me.get("paid_equiv") is False else "FAIL",
           email=email, paid_equiv=me.get("paid_equiv"), plan=me.get("plan"), shot=False)
    for path in PAID_ROUTES:
        try:
            pg.goto(base + path, wait_until="domcontentloaded", timeout=60000)
            h._dismiss_intro(pg)
            pg.wait_for_timeout(3500)
            landed = pg.url.replace(base, "")
            txt = pg.evaluate("() => document.body.innerText.trim().replace(/\\s+/g, ' ').slice(0, 260)")
            C.step(pg, inst, "unpaid", f"{path}: the upgrade path, not an error screen", "PASS" if landed.startswith("/subscribe") else "FAIL",
                   landed=landed, page_text=txt)
        except Exception as e:  # noqa: BLE001
            C.step(pg, inst, "unpaid", f"{path} (driver exception)", "FAIL", error=str(e)[:300])
    rows = []
    for method, path in PAID_APIS:
        r = getattr(ctx.request, method.lower())(base + path)
        try:
            body = r.json()
        except Exception:  # noqa: BLE001
            body = (r.text() or "")[:200]
        rows.append({"request": f"{method} {path}", "status": r.status, "sentence": sentence(body), "response": json.dumps(body, default=str)[:200]})
    bad = [x for x in rows if x["status"] >= 500 or (x["status"] in (401, 402, 403) and not x["sentence"])]
    C.step(None, inst, "unpaid", "paid Notebook routes answer an unpaid member with 402 and a sentence, never a 500",
           "PASS" if not bad and any(x["status"] == 402 for x in rows) else "FAIL", answers=rows, shot=False)
    ctx.close()


if __name__ == "__main__":
    print("This module holds configuration c1's live-on-merge steps. Run: python tools/notebook_fin_walk.py --config c1 ...")
    sys.exit(0)
