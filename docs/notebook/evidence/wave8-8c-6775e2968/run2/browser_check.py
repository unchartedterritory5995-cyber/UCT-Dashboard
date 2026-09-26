"""Wave 8 lane 8C browser check (owner rule P-1) -- real Chromium over a census-pinned sandbox.

Preconditions: a sandbox from this tip on BASE, booted with NOTEBOOK_ONBOARDING_ENABLED=1 in ITS
environment and ADMIN_EMAILS=admin8c@local.dev (the launcher's --test-email); app/dist rebuilt.

    python browser_check.py <out_dir> <sandbox_data_dir>

Writes <out_dir>/browser-check.json (every step's result) and screenshots/downloads beside it.
Nothing here imports api.* (no /data resolution); the sandbox DB is read READ-ONLY.
"""
import glob
import io
import json
import os
import sqlite3
import sys
import time
import traceback
import zipfile
import xml.etree.ElementTree as ET

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8212"
OUT = sys.argv[1]
DATA_DIR = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
DL = os.path.join(OUT, "downloads")
os.makedirs(DL, exist_ok=True)

PW = "LocalTest2026!"
ADMIN = "admin8c@local.dev"
A = "tour8c@local.dev"        # fresh: tour + sample
B = "second8c@local.dev"      # one note: no tour, 409 by API, exports
C = "race8c@local.dev"        # empty page open, a note lands, the click is refused in the UI
REFUSED = "You already have notes, so we didn't add the sample. You can import notes instead."
TOUR_CARD = 'div[role="dialog"][aria-modal="true"][aria-labelledby]'
INTRO = 'div[role="dialog"][aria-label="Welcome"]'

res = {"base": BASE, "started": time.strftime("%Y-%m-%dT%H:%M:%S"), "steps": [], "errors": [], "console": []}


def step(sid, ok, **detail):
    res["steps"].append({"id": sid, "result": "PASS" if ok is True else ("FAIL" if ok is False else "INCONCLUSIVE"), **detail})
    print(sid, res["steps"][-1]["result"], {k: v for k, v in detail.items() if k != "trace"})


def shot(page, name):
    p = os.path.join(OUT, f"{name}.png")
    try:
        page.screenshot(path=p, full_page=False)
    except Exception as e:  # noqa: BLE001
        res["errors"].append(f"screenshot {name}: {e}")
    return os.path.basename(p)


def signup(req, email, name):
    r = req.post(BASE + "/api/auth/signup", data={"email": email, "password": PW, "display_name": name})
    if r.status not in (200, 201):
        r = req.post(BASE + "/api/auth/login", data={"email": email, "password": PW})
    return r.status


def dismiss_intro(pg):
    d = pg.locator(INTRO)
    try:
        d.first.wait_for(state="visible", timeout=2500)
    except Exception:  # noqa: BLE001
        return False
    pg.keyboard.press("Escape")
    try:
        d.first.wait_for(state="detached", timeout=6000)
    except Exception:  # noqa: BLE001
        try:
            pg.get_by_role("button", name="Skip intro", exact=True).click(timeout=1500)
            d.first.wait_for(state="detached", timeout=6000)
        except Exception:  # noqa: BLE001
            return False
    return True


def watch(page, who):
    page.on("pageerror", lambda e: res["errors"].append(f"[{who}] pageerror: {str(e)[:300]}"))
    page.on("console", lambda m: res["console"].append(f"[{who}] {m.type}: {m.text[:200]}") if m.type == "error" else None)

    def on_response(r):
        # Run 1 saw 400s on the preference writes: every POST /api/auth/preferences is
        # recorded with the key it sent and the server's answer.
        try:
            if r.url.endswith("/api/auth/preferences") and r.request.method == "POST":
                body = r.request.post_data or ""
                key = json.loads(body).get("key") if body else None
                res.setdefault("pref_writes", []).append(
                    {"who": who, "key": key, "status": r.status, "answer": r.text()[:200]})
        except Exception as e:  # noqa: BLE001
            res["errors"].append(f"[{who}] response hook: {e}")
    page.on("response", on_response)


def close_tour(page):
    """Run 1: with the tour's preference refused, the tour opens again on every load; close
    it (Escape) before driving the page underneath, and say that it had to."""
    if page.locator(TOUR_CARD).count():
        page.keyboard.press("Escape")
        page.wait_for_selector(TOUR_CARD, state="detached", timeout=5000)
        return True
    return False


def tour_title(page):
    return page.locator(f"{TOUR_CARD} h2").inner_text(timeout=3000)


def keyboard_to(page, labels, limit=8):
    """Tab until the focused element's text is one of `labels`; returns that text or None."""
    for _ in range(limit):
        page.keyboard.press("Tab")
        t = page.evaluate("() => document.activeElement && document.activeElement.textContent.trim()")
        if t in labels:
            return t
    return None


def prefs(req):
    return req.get(BASE + "/api/auth/preferences").json()


def ro_db():
    cands = [p for p in glob.glob(os.path.join(DATA_DIR, "**", "auth.db"), recursive=True)]
    if not cands:
        return None, None
    path = sorted(cands, key=len)[0]
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True), path


RICH = {"type": "doc", "content": [
    {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Export check heading"}]},
    {"type": "paragraph", "content": [
        {"type": "text", "text": "Plain, "}, {"type": "text", "text": "bold", "marks": [{"type": "bold"}]},
        {"type": "text", "text": " and a "},
        {"type": "text", "text": "link", "marks": [{"type": "link", "attrs": {"href": "https://example.com/x"}}]},
        {"type": "text", "text": "; costs $5."}]},
    {"type": "bulletList", "content": [
        {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "first point"}]}]},
        {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "second point"}]}]}]},
    {"type": "table", "content": [
        {"type": "tableRow", "content": [
            {"type": "tableHeader", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": None}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Stage"}]}]},
            {"type": "tableHeader", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": None}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Action"}]}]}]},
        {"type": "tableRow", "content": [
            {"type": "tableCell", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": None}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Base"}]}]},
            {"type": "tableCell", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": None}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Wait"}]}]}]}]},
    {"type": "blockMath", "attrs": {"latex": "E = mc^2"}},
]}


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        actx = browser.new_context()
        res["admin_signup"] = signup(actx.request, ADMIN, "admin8c")
        ctxs = {}
        for email, name in ((A, "tour8c"), (B, "second8c"), (C, "race8c")):
            ctx = browser.new_context(viewport={"width": 1280, "height": 800}, accept_downloads=True)
            time.sleep(21)   # POST /api/auth/signup is limited to 3/minute
            res.setdefault("signup", {})[email] = signup(ctx.request, email, name)
            c = actx.request.post(BASE + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
            v = actx.request.post(BASE + "/api/auth/admin/verify-email", data={"email": email})
            res.setdefault("provision", {})[email] = {"comp": c.status, "verify": v.status}
            ctxs[email] = ctx
        for email, ctx in ctxs.items():
            me = ctx.request.get(BASE + "/api/auth/me").json()
            res.setdefault("me", {})[email] = {
                "paid_equiv": me.get("paid_equiv"), "plan": me.get("plan"),
                "notebook_onboarding_enabled": me.get("notebook_onboarding_enabled"),
                "user_id": (me.get("user") or {}).get("id")}
        ok = all(res["me"][e]["paid_equiv"] and res["me"][e]["notebook_onboarding_enabled"] is True for e in ctxs)
        step("S1-provision", ok, me=res["me"])
        if not ok:
            return

        # ── A: the tour auto-starts once, by keyboard, reopenable; the sample in and out ──
        ctx = ctxs[A]
        page = ctx.new_page()
        watch(page, "A")
        page.goto(BASE + "/journal/notebook")
        dismiss_intro(page)
        try:
            page.wait_for_selector(TOUR_CARD, timeout=15000)
            first = tour_title(page)
            progress = page.locator(f"{TOUR_CARD} p").first.inner_text()
            step("S2-tour-autostarts", True, title=first, progress=progress, shot=shot(page, "A-tour-step1"))
        except Exception as e:  # noqa: BLE001
            step("S2-tour-autostarts", False, error=str(e)[:300], shot=shot(page, "A-tour-missing"))
            return
        titles = [first]
        for _ in range(12):
            got = keyboard_to(page, ("Next", "Done"))
            if got is None:
                break
            page.keyboard.press("Enter")
            if got == "Done":
                break
            titles.append(tour_title(page))
        try:
            page.wait_for_selector(TOUR_CARD, state="detached", timeout=5000)
            closed = True
        except Exception:  # noqa: BLE001
            closed = False
        time.sleep(0.5)
        pref = prefs(ctx.request).get("notebook_tour")
        step("S3-tour-keyboard-done", closed and bool(pref) and json.loads(pref).get("state") == "done",
             titles=titles, pref=pref, shot=shot(page, "A-after-done"))

        page.reload()
        dismiss_intro(page)
        page.wait_for_selector("text=Welcome to your Notebook", timeout=15000)
        time.sleep(2.5)
        step("S4-tour-shows-once", page.locator(TOUR_CARD).count() == 0, shot=shot(page, "A-reload-no-tour"))

        res["tour_open_before_take_the_tour"] = close_tour(page)
        page.get_by_role("button", name="Take the tour").click()
        try:
            page.wait_for_selector(TOUR_CARD, timeout=5000)
            reopened = tour_title(page)
            page.keyboard.press("Escape")
            page.wait_for_selector(TOUR_CARD, state="detached", timeout=5000)
            time.sleep(0.5)
            pref = prefs(ctx.request).get("notebook_tour")
            focused = page.evaluate("() => document.activeElement && document.activeElement.textContent.trim()")
            step("S5-tour-reopen-escape", bool(pref) and json.loads(pref).get("state") == "dismissed",
                 reopened_at=reopened, pref=pref, focus_after=focused)
        except Exception as e:  # noqa: BLE001
            step("S5-tour-reopen-escape", False, error=str(e)[:300], shot=shot(page, "A-reopen-fail"))

        page.get_by_role("button", name="Add a sample notebook").click()
        try:
            page.wait_for_selector(".ProseMirror", timeout=20000)
            page.wait_for_selector("text=Welcome to your sample notebook", timeout=10000)
            st = ctx.request.get(BASE + "/api/j2/onboarding/sample-notebook").json()
            step("S6-sample-added-welcome-open", len(st.get("activeIds", [])) == 5, status=st, url=page.url,
                 shot=shot(page, "A-sample-welcome"))
        except Exception as e:  # noqa: BLE001
            step("S6-sample-added-welcome-open", False, error=str(e)[:300], shot=shot(page, "A-sample-fail"))

        # read-only DB proof: nothing armed by the sample
        db, dbpath = ro_db()
        uid = res["me"][A]["user_id"]
        facts = {"db": dbpath}
        if db:
            db.row_factory = sqlite3.Row
            q = lambda sql, *a: db.execute(sql, a).fetchone()[0]  # noqa: E731
            facts["notes"] = q("SELECT COUNT(*) FROM j2_notes WHERE user_id=? AND deleted_at IS NULL", uid)
            facts["mentions"] = q("SELECT COUNT(*) FROM j2_note_mentions WHERE user_id=?", uid)
            facts["embed_symbols"] = q("SELECT COUNT(*) FROM j2_note_embeds WHERE user_id=? AND symbol IS NOT NULL", uid)
            facts["tickers"] = q("SELECT COUNT(*) FROM j2_notes WHERE user_id=? AND ticker IS NOT NULL AND ticker != ''", uid)
            facts["property_defs"] = q("SELECT COUNT(*) FROM j2_note_properties WHERE user_id=?", uid)
            facts["properties_json"] = q("SELECT COUNT(*) FROM j2_notes WHERE user_id=? AND properties_json IS NOT NULL AND properties_json NOT IN ('', '{}')", uid)
            bodies = [r[0] for r in db.execute("SELECT body_json FROM j2_notes WHERE user_id=?", (uid,))]
            facts["date_mentions"] = sum(b.count('"dateMention"') for b in bodies)
            facts["task_items"] = sum(b.count('"taskItem"') for b in bodies)
            armed = {}
            for (t,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'"):
                low = t.lower()
                if not any(k in low for k in ("alert", "remind", "insight", "notif")):
                    continue
                cols = [c[1] for c in db.execute(f"PRAGMA table_info('{t}')")]
                if "user_id" in cols:
                    armed[t] = q(f"SELECT COUNT(*) FROM '{t}' WHERE user_id=?", uid)
            facts["alert_or_reminder_rows"] = armed
            db.close()
        quiet = (db is not None and facts.get("mentions") == 0 and facts.get("embed_symbols") == 0
                 and facts.get("tickers") == 0 and facts.get("date_mentions") == 0
                 and facts.get("property_defs") == 0 and not any(facts.get("alert_or_reminder_rows", {}).values()))
        step("S7-sample-arms-nothing-db-readonly", quiet, facts=facts)

        page.goto(BASE + "/journal/notebook")
        dismiss_intro(page)
        try:
            page.wait_for_selector("text=You're looking at the sample notebook", timeout=15000)
            s1 = shot(page, "A-strip")
            page.get_by_role("button", name="Remove it").click()
            page.wait_for_selector("text=The sample notes are in Trash. You can restore them from there.", timeout=10000)
            st = ctx.request.get(BASE + "/api/j2/onboarding/sample-notebook").json()
            step("S8-sample-removed", st.get("activeIds") == [] and len(st.get("ids", [])) == 5,
                 status=st, shots=[s1, shot(page, "A-removed")])
        except Exception as e:  # noqa: BLE001
            step("S8-sample-removed", False, error=str(e)[:300], shot=shot(page, "A-strip-fail"))

        # ── B: one note -> no tour; the sample refused (API); exports from the real UI ──
        ctx = ctxs[B]
        r = ctx.request.post(BASE + "/api/j2/notes", data={"title": "Export check", "bodyJson": RICH})
        note = r.json().get("note") or {}
        nid = note.get("id")
        page = ctx.new_page()
        watch(page, "B")
        page.goto(BASE + "/journal/notebook?view=all")
        dismiss_intro(page)
        page.wait_for_selector("text=Export check", timeout=15000)
        time.sleep(2.5)
        step("S9-one-note-no-tour", page.locator(TOUR_CARD).count() == 0, shot=shot(page, "B-no-tour"))
        r409 = ctx.request.post(BASE + "/api/j2/onboarding/sample-notebook")
        step("S10-sample-refused-409-api", r409.status == 409 and r409.json().get("detail") == REFUSED,
             status=r409.status, body=r409.json())

        def export_whole(label, fname):
            page.get_by_role("button", name="Export", exact=True).first.click()
            page.wait_for_selector("text=Export your notebook", timeout=8000)
            page.get_by_role("radio", name=label).check()
            with page.expect_download(timeout=60000) as dl:
                page.get_by_role("button", name=f"Download {label}").click()
            path = os.path.join(DL, fname)
            dl.value.save_as(path)
            page.get_by_role("button", name="Done").click()
            return path, dl.value.suggested_filename

        try:
            hz, hname = export_whole("Web page (HTML)", "notebook-html.zip")
            with zipfile.ZipFile(hz) as zf:
                names = zf.namelist()
                html_name = next(n for n in names if n.endswith(".html"))
                zf.extractall(os.path.join(DL, "html"))
            hp = page.context.new_page()
            hp.goto("file:///" + os.path.join(DL, "html", html_name).replace("\\", "/"))
            h1 = hp.locator("h1").all_inner_texts()
            cells = hp.locator("table th, table td").all_inner_texts()
            step("S11-export-html-opened", "Export check heading" in " ".join(h1) and "Stage" in cells,
                 file=hname, members=names, h1=h1, cells=cells, shot=shot(hp, "B-html-page"))
            hp.close()
        except Exception as e:  # noqa: BLE001
            step("S11-export-html-opened", False, error=str(e)[:300], trace=traceback.format_exc()[-800:], shot=shot(page, "B-html-fail"))

        try:
            jz, jname = export_whole("JSON", "notebook-json.zip")
            page.get_by_role("button", name="Import", exact=True).first.click()
            page.set_input_files('[data-testid="import-file-input"]', jz)
            dlg = page.locator('[role="dialog"]').last
            dlg.get_by_role("button", name="Import", exact=True).click(timeout=20000)
            page.get_by_role("button", name="Done").last.click(timeout=30000)
            lst = ctx.request.get(BASE + "/api/j2/notes?sort=title").json()
            items = lst.get("notes") if isinstance(lst, dict) else lst
            copies = [n for n in (items or []) if n.get("title") == "Export check"]
            bodies = [ctx.request.get(BASE + f"/api/j2/notes/{n['id']}").json() for n in copies]
            bodies = [(b.get("note") or b).get("bodyJson") for b in bodies]
            equal = len(bodies) == 2 and bodies[0] == bodies[1]
            step("S12-export-json-reimported-equal", equal, file=jname, copies=[n.get("id") for n in copies],
                 shot=shot(page, "B-after-json-import"))
        except Exception as e:  # noqa: BLE001
            step("S12-export-json-reimported-equal", False, error=str(e)[:300], trace=traceback.format_exc()[-800:], shot=shot(page, "B-json-fail"))

        try:
            page.goto(BASE + f"/journal/notebook?note={nid}")
            dismiss_intro(page)
            page.wait_for_selector(".ProseMirror", timeout=20000)
            page.locator('button[aria-haspopup="menu"]', has_text="Export").first.click()
            page.wait_for_selector('[role="menu"]', timeout=5000)
            s_menu = shot(page, "B-export-menu")
            with page.expect_download(timeout=60000) as dl:
                page.get_by_role("menuitem", name="Word (.docx)").click()
            dp = os.path.join(DL, "note.docx")
            dl.value.save_as(dp)
            with zipfile.ZipFile(dp) as zf:
                members = zf.namelist()
                parsed = {}
                for m in members:
                    if m.endswith(".xml") or m.endswith(".rels"):
                        ET.fromstring(zf.read(m))
                        parsed[m] = "ok"
                doc = zf.read("word/document.xml").decode("utf-8")
            step("S13-export-docx-valid", "Export check heading" in doc and "[Content_Types].xml" in members,
                 file=dl.value.suggested_filename, members=members, xml_parsed=parsed, shots=[s_menu])
        except Exception as e:  # noqa: BLE001
            step("S13-export-docx-valid", False, error=str(e)[:300], trace=traceback.format_exc()[-800:], shot=shot(page, "B-docx-fail"))

        # ── C: the tour's help link lands on /support; then the refusal as a sentence ──
        ctx = ctxs[C]
        page = ctx.new_page()
        watch(page, "C")
        page.goto(BASE + "/journal/notebook")
        dismiss_intro(page)
        try:
            page.wait_for_selector(TOUR_CARD, timeout=15000)
            for _ in range(12):
                if page.get_by_role("link", name="Read the Notebook help").count():
                    break
                page.get_by_role("button", name="Next").click()
            page.get_by_role("link", name="Read the Notebook help").click()
            page.wait_for_url("**/support", timeout=10000)
            page.wait_for_selector("text=How do I get started with the Notebook?", timeout=15000)
            qs = [t.strip() for t in page.locator("button[aria-expanded]").all_inner_texts() if t.strip().endswith("?")]
            q = page.get_by_role("button", name="How do I export my notes, and what does each format keep?")
            q.click()
            body = q.locator("xpath=..").inner_text()
            step("S14-support-articles", "Word (.docx)" in body and bool(qs) and qs[0] == "How do I get started with the Notebook?",
                 url=page.url, questions=qs[:20], shot=shot(page, "C-support"))
        except Exception as e:  # noqa: BLE001
            step("S14-support-articles", False, error=str(e)[:300], trace=traceback.format_exc()[-800:], shot=shot(page, "C-support-fail"))

        try:
            page.goto(BASE + "/journal/notebook")
            dismiss_intro(page)
            page.wait_for_selector("text=Add a sample notebook", timeout=15000)
            time.sleep(1)
            res["C_tour_open_before_race"] = close_tour(page) if page.locator(TOUR_CARD).count() else False
            try:
                page.wait_for_selector(TOUR_CARD, timeout=1500)
                res["C_tour_open_before_race"] = close_tour(page)
            except Exception:  # noqa: BLE001
                pass
            ctx.request.post(BASE + "/api/j2/notes", data={"title": "Written in another tab"})
            page.get_by_role("button", name="Add a sample notebook").click()
            alert = page.wait_for_selector('[role="alert"]', timeout=10000)
            text = alert.inner_text()
            step("S15-refusal-rendered-as-sentence", text.strip() == REFUSED, text=text, shot=shot(page, "C-409-sentence"))
        except Exception as e:  # noqa: BLE001
            step("S15-refusal-rendered-as-sentence", False, error=str(e)[:300], shot=shot(page, "C-409-fail"))

        browser.close()


try:
    run()
except Exception as e:  # noqa: BLE001
    res["errors"].append("RUN: " + str(e)[:400])
    res["trace"] = traceback.format_exc()[-2000:]
finally:
    res["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    res["summary"] = {k: sum(1 for s in res["steps"] if s["result"] == k) for k in ("PASS", "FAIL", "INCONCLUSIVE")}
    with open(os.path.join(OUT, "browser-check.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(json.dumps(res["summary"]))
