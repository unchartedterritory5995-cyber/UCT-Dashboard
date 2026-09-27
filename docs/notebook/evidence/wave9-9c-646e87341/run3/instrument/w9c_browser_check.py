"""Wave 9 lane 9C -- the browser check (owner rule P-1). Real Chromium over a census-pinned
sandbox booted by `soak_sandbox_boot.py` from a `git archive` export of the lane tip.

    python w9c_browser_check.py --base http://127.0.0.1:8206 --export <export root>
        --integrity-log <export>/docs/plans/joystick/sandbox-runs/<ts>.md --out <evidence dir> --tip <sha>

PART A -- the study kit's CORE tasks (T1, T2, T4, T6, T8), walked as a participant would, on
a fresh sandbox account: T1 on the EMPTY account; the study notebook imported through the
product's own importer ("Choose a folder"); T2 paste-with-source; T4 the quick switcher;
T6 attach a 10-Q PDF and save a page-cited excerpt; T8 offline then reconnect. After each,
the facilitator's OWN silent-failure check from `facilitator-guide.md`. Screenshots per task.

PART B -- the soak: seeded activity from three populations, `GET /api/admin/notebook-soak`
read IN THE BROWSER by the admin (and refused to a member), the OBSERVER's own read code
(`tools/nb_observe.py` SOAK_JS + the sidecar writer) run against the sandbox page, and
`tools/nb_soak.py` rolling it up into a dashboard rendered in the browser.

Every step appends to steps[] with what the DOM or the API said. The JSON is rewritten after
every step, so a crash leaves the partial record. Waits are `wait_for` / `expect_*` with
deadlines, never a sleep followed by a sample.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
import pathlib
import re
import sys
import time
import traceback

ap = argparse.ArgumentParser()
ap.add_argument("--base", required=True)
ap.add_argument("--export", required=True)
ap.add_argument("--integrity-log", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--tip", required=True)
ARGS = ap.parse_args()
BASE = ARGS.base.rstrip("/")
EXPORT = pathlib.Path(ARGS.export)
OUT = pathlib.Path(ARGS.out)
OUT.mkdir(parents=True, exist_ok=True)
SHOTS = OUT / "screenshots"
SHOTS.mkdir(exist_ok=True)
PW = "LocalTest2026!9c"
ADMIN = "hubtest@local.dev"
# A fresh participant per sandbox life: T1 must run on an EMPTY account.
P1 = os.environ.get("W9C_PARTICIPANT", "p1.study@example.com")
SMOKE = "smoke@uctintelligence.internal"
GHOST = "ghost@uctintelligence.internal"
STUDY = EXPORT / "docs" / "notebook" / "user-study" / "study-notebook"
# example.com is reserved for documentation (RFC 2606) and every request to it is answered by
# the context's own route below, so nothing leaves the box. A `.com` host because the editor's
# autolink validates the TLD (a `.example` host is never linked).
ARTICLE_URL = "https://www.example.com/markets/earnings-season-read-closely"
ARTICLE_TITLE = "Earnings season, read closely"
ARTICLE_PARA = ("Guidance moved the stocks more than the quarter itself: companies that raised their "
                "outlook held their gains, and those that only beat the estimate faded by the close.")
FALLBACK_TEXT = "Something went wrong on this page"   # AppErrorFallback.jsx
RUN_START = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=2)
res = {"tip": ARGS.tip, "base": BASE, "started": dt.datetime.now(dt.timezone.utc).isoformat(),
       "run_start_utc": RUN_START.strftime("%Y-%m-%dT%H:%M:%SZ"),
       "steps": [], "route_fallbacks": [], "page_errors": []}


def save():
    (OUT / "browser-check.json").write_text(json.dumps(res, indent=1, default=str), encoding="utf-8")


def step(name, ok, **facts):
    rec = {"step": name, "ok": bool(ok), "at": dt.datetime.now(dt.timezone.utc).isoformat(), **facts}
    res["steps"].append(rec)
    print(("PASS " if ok else "FAIL ") + name + " " + json.dumps(facts, default=str)[:400], flush=True)
    save()
    return ok


def shot(pg, name, full=False):
    p = SHOTS / f"{name}.jpg"
    pg.screenshot(path=str(p), full_page=full, type="jpeg", quality=72)
    return str(p.relative_to(OUT)).replace("\\", "/")


# ── identity first: a port is not an identity ───────────────────────────────
sys.path.insert(0, str(EXPORT / "scripts"))
import sandbox_identity  # noqa: E402

v = sandbox_identity.verify(BASE, ARGS.integrity_log)
res["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence, "nonce": v.nonce}
save()
if not v.ok:
    print("REFUSED: " + v.sentence)
    raise SystemExit(3)
print("SANDBOX IDENTITY: " + v.sentence, flush=True)


def tiny_10q_pdf() -> bytes:
    """A one-page synthetic 10-Q with a real text layer (Helvetica), hand-built."""
    lines = ["Synthetic Example Corp. - Form 10-Q (study fixture, not a real filing)",
             "Condensed Consolidated Statement of Operations",
             "Total revenue 1,284.6 million",
             "Cost of revenue 512.3 million",
             "Gross profit 772.3 million"]
    content = "BT /F1 14 Tf 60 720 Td 22 TL\n" + "".join(f"({ln}) Tj T*\n" for ln in lines) + "ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
            "/Resources << /Font << /F1 5 0 R >> >> >>",
            f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{off:010d} 00000 n \n" for off in offsets).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def signup_or_login(req, email, name):
    """Sign-up is limited to 3/min per client: a 429 waits the window out and asks again."""
    last = None
    for path, data in (("/api/auth/signup", {"email": email, "password": PW, "display_name": name}),
                       ("/api/auth/login", {"email": email, "password": PW})):
        for _ in range(3):
            r = req.post(BASE + path, data=data)
            last = r.status
            if r.status != 429:
                break
            time.sleep(61)
        if r.status in (200, 201):
            return r.status
    return last


def dismiss_intro(pg):
    dialog = pg.locator('div[role="dialog"][aria-label="Welcome"]')
    try:
        dialog.first.wait_for(state="visible", timeout=2500)
    except Exception:  # noqa: BLE001
        return
    pg.keyboard.press("Escape")
    try:
        dialog.first.wait_for(state="detached", timeout=6000)
    except Exception:  # noqa: BLE001
        pg.get_by_role("button", name="Skip intro", exact=True).click(timeout=2000)
        dialog.first.wait_for(state="detached", timeout=6000)


def watch(pg, who):
    pg.on("pageerror", lambda e: (res["page_errors"].append({"who": who, "error": str(e)[:300]}), save()))
    return pg


def open_editor(ctx, url, who, pg=None, tries=4):
    """Navigate to a note and wait for EITHER the editor or the route fallback (one waiter).
    A fallback is recorded -- it is a product fact a participant would see -- and retried on a
    FRESH page, as the wave-7 walk does."""
    for attempt in range(1, tries + 1):
        if pg is None or attempt > 1:
            if pg is not None:
                with contextlib.suppress(Exception):
                    pg.close()
            pg = watch(ctx.new_page(), who)
        pg.goto(url)
        dismiss_intro(pg)
        either = pg.locator(".ProseMirror").or_(pg.get_by_text(FALLBACK_TEXT))
        either.first.wait_for(state="attached", timeout=45000)
        if pg.get_by_text(FALLBACK_TEXT).count():
            res["route_fallbacks"].append({"who": who, "url": url, "attempt": attempt,
                                           "screenshot": shot(pg, f"route-fallback-{len(res['route_fallbacks'])}")})
            save()
            continue
        pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
        return pg
    raise RuntimeError(f"the note editor never mounted after {tries} fresh pages: {url}")


def note_body(req, note_id):
    r = req.get(BASE + f"/api/j2/notes/{note_id}")
    return json.dumps(r.json().get("note", {}).get("bodyJson", {})) if r.ok else ""


def wait_server_has(req, note_id, needle, timeout_s=60.0):
    """Poll the server's copy of the note until `needle` is in its body (deadline-bounded)."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if needle in note_body(req, note_id):
            return True
        time.sleep(1.0)
    return False


def note_id_from(url):
    m = re.search(r"[?&]note=([^&#]+)", url)
    return m.group(1) if m else None


def notes_list(req):
    r = req.get(BASE + "/api/j2/notes?limit=100")
    return r.json().get("notes", []) if r.ok else []


from playwright.sync_api import TimeoutError as PWTimeout  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    res["chromium"] = browser.version
    vp = {"viewport": {"width": 1280, "height": 800}}
    admin = browser.new_context(**vp)
    step("admin (hubtest@local.dev, the sandbox's ADMIN_EMAILS) signed up or in",
         signup_or_login(admin.request, ADMIN, "hubtest") in (200, 201))
    p1 = browser.new_context(**vp, permissions=["clipboard-read", "clipboard-write"])
    p1.route("https://www.example.com/**", lambda route: route.fulfill(
        status=200, content_type="text/html; charset=utf-8",
        body=f"<html><head><title>{ARTICLE_TITLE}</title></head><body style='font:18px Georgia;"
             f"max-width:720px;margin:48px auto'><h1>{ARTICLE_TITLE}</h1><p id='para'>{ARTICLE_PARA}</p>"
             f"<p>A second paragraph the participant does not need.</p></body></html>"))
    signup_or_login(p1.request, P1, "P1")
    comp = admin.request.post(BASE + "/api/auth/admin/comp-access", data={"email": P1, "action": "grant"})
    ver = admin.request.post(BASE + "/api/auth/admin/verify-email", data={"email": P1})
    me = p1.request.get(BASE + "/api/auth/me").json()
    nb_keys = {k: v for k, v in me.items() if k.startswith("notebook_")}
    step("P1 provisioned the facilitator guide's way: comp-access + verify-email => paid_equiv",
         me.get("paid_equiv") is True, comp=comp.status, verify=ver.status,
         email_domain="example.com (a made-up address, never @uctintelligence.internal)", notebook_keys=nb_keys)
    step("pre-flight T8 (kit §5): notebook_offline_default_on is true on /api/auth/me",
         nb_keys.get("notebook_offline_default_on") is True, value=nb_keys.get("notebook_offline_default_on"))
    step("pre-flight T1 (kit §5): notebook_onboarding_enabled is ABSENT at this base (PLANNED, wave 8)",
         "notebook_onboarding_enabled" not in nb_keys, keys=sorted(nb_keys))

    page = None
    t1_note = None

    # ── T1 on the EMPTY account ──────────────────────────────────────────────
    # Run 1 (shake-out, committed raw) waited for the All-notes toolbar's "+ New note" on the
    # bare route -- which renders Research Home, and on an EMPTY account its first-run card
    # ("Welcome to your Notebook": Start a note / Create a thesis / Import notes;
    # ResearchHome.jsx). That card is what a participant sees at T1, so that is the door.
    try:
        n0 = notes_list(p1.request)
        page = watch(p1.new_page(), "p1")
        page.goto(BASE + "/journal/notebook")
        dismiss_intro(page)
        page.get_by_role("heading", name="Welcome to your Notebook").wait_for(state="visible", timeout=45000)
        new_btn = page.get_by_role("button", name="Start a note", exact=True)
        new_btn.wait_for(state="visible", timeout=45000)
        s_empty = shot(page, "T1-0-empty-notebook-first-run-card")
        t_start = time.time()
        new_btn.click()
        # the note id FIRST, so a later failure in this task cannot strand T2/T6/T8 (run 2)
        page.wait_for_url(re.compile(r"[?&]note="), timeout=45000)
        t1_note = note_id_from(page.url)
        # exact: the editor also has a "Subtitle" input, and a substring match is two elements
        # (run 2's strict-mode failure)
        title = page.get_by_placeholder("Title", exact=True)
        title.wait_for(state="visible", timeout=45000)
        page.locator(".ProseMirror").first.wait_for(state="visible", timeout=45000)
        title.fill("Plan for tomorrow's session")
        page.locator(".ProseMirror").first.click()
        page.keyboard.type("Wait for the opening range; only trade the two names on the list.")
        saved = wait_server_has(p1.request, t1_note, "Wait for the opening range")
        t1_s = round(time.time() - t_start, 1)
        s1 = shot(page, "T1-1-note-written")
        # the silent-failure check: the PARTICIPANT reloads; the note and their words are there
        page = open_editor(p1, page.url, "p1", pg=page)
        page.get_by_text("Wait for the opening range", exact=False).first.wait_for(state="visible", timeout=30000)
        title_after = page.get_by_placeholder("Title", exact=True).input_value()
        s1b = shot(page, "T1-2-check-after-reload")
        step("T1 core: 'Start a note with your plan for tomorrow's session.' -- on the EMPTY account; "
             "check: after a reload the note is there with their words",
             len(n0) == 0 and saved and title_after == "Plan for tomorrow's session",
             door="Research Home first-run card: 'Start a note'",
             notes_before=len(n0), note_id=t1_note, saved_on_server=saved,
             seconds_click_to_saved=t1_s, bar_under_2_min=t1_s < 120, title_after_reload=title_after,
             screenshots=[s_empty, s1, s1b])
    except Exception as e:  # noqa: BLE001
        step("T1 core", False, error=str(e)[:300], trace=traceback.format_exc()[-900:])
    if t1_note is None:
        # never strand the later tasks on T1's failure: T2/T6/T8 continue in the newest note,
        # and the record says so
        newest = sorted(notes_list(p1.request), key=lambda n: n.get("createdAt") or "", reverse=True)
        t1_note = newest[0]["id"] if newest else None
        res["t1_note_fallback"] = t1_note
        save()

    # ── the study notebook, through the product's own importer (D-9C8) ──────
    # Run 1: the toolbar's Import lives in the ALL NOTES view; the bare route is Research Home,
    # whose own "Import notes" shows only while the notebook is empty (and after T1 it is not).
    # The facilitator's path is therefore sidebar "All notes" -> Import -> Choose a folder.
    try:
        page.goto(BASE + "/journal/notebook")
        dismiss_intro(page)
        page.get_by_text("All notes", exact=True).first.click()
        page.wait_for_url(re.compile(r"[?&]view=all"), timeout=20000)
        page.get_by_role("button", name="Import", exact=True).first.click()
        page.get_by_role("button", name=re.compile("Choose a folder")).wait_for(state="visible", timeout=20000)
        s_drop = shot(page, "import-0-choose-a-folder")
        page.get_by_test_id("import-dir-input").set_input_files(str(STUDY))
        review = page.get_by_role("dialog").filter(has_text="Review your import")
        review.get_by_text(re.compile(r"\b12 notes\b")).first.wait_for(state="visible", timeout=60000)
        summary_line = review.get_by_text(re.compile(r"\b12 notes\b")).first.inner_text()
        s_rev = shot(page, "import-1-review-12-notes")
        review.get_by_role("button", name="Import", exact=True).click()
        done = page.get_by_role("dialog").filter(has_text="Import complete")
        done.get_by_role("button", name="Done", exact=True).wait_for(state="visible", timeout=90000)
        offered = False
        not_now = done.get_by_role("button", name="Not now", exact=True)
        with contextlib.suppress(PWTimeout):
            not_now.wait_for(state="visible", timeout=8000)
            offered = True
        s_done = shot(page, "import-2-complete")
        if offered:
            not_now.click()   # the facilitator guide: the live-chart offer is opt-in; choose not now
        done.get_by_role("button", name="Done", exact=True).click()
        notes = notes_list(p1.request)
        titles = [n.get("title") for n in notes]
        fr = p1.request.get(BASE + "/api/j2/note-folders")
        folders = sorted(f.get("name") for f in fr.json().get("folders", [])) if fr.ok else f"HTTP {fr.status}"
        need = ("Earnings season playbook", "Chipmaker guidance notes", "Software margin notes",
                "Retailer inventory notes")
        crwd = [t for t in titles if t and t.startswith("CRWD research")]
        step("the study notebook imported with 'Choose a folder' (D-9C8): 12 notes, its folders kept, "
             "the T4/T5 titles and the T7 CRWD note present",
             len(notes) == 13 and all(t in titles for t in need) and bool(crwd)
             and all(f in folders for f in ("Lessons", "Playbook", "Research", "Setups")),
             notes_after=len(notes), summary_line=summary_line, folders=folders, crwd_note=crwd,
             live_chart_offer_shown=offered, tickers_set=[n.get("ticker") for n in notes if n.get("ticker")],
             screenshots=[s_drop, s_rev, s_done])
    except Exception as e:  # noqa: BLE001
        step("import the study notebook", False, error=str(e)[:300], trace=traceback.format_exc()[-900:])

    # ── T2: save a paragraph with its source ─────────────────────────────────
    try:
        art = watch(p1.new_page(), "p1-article")
        art.goto(ARTICLE_URL)
        art.locator("#para").click(click_count=3)
        art.keyboard.press("Control+C")
        clip = art.evaluate("navigator.clipboard.readText()")
        s_art = shot(art, "T2-0-article-paragraph-selected")
        page = open_editor(p1, BASE + f"/journal/notebook?note={t1_note}", "p1", pg=page)
        page.locator(".ProseMirror").first.click()
        page.keyboard.press("Control+End")
        page.keyboard.press("Enter")
        page.keyboard.press("Control+V")
        pasted_by = "keyboard Ctrl+V"
        try:
            page.locator(".ProseMirror").get_by_text("Guidance moved the stocks", exact=False).first.wait_for(
                state="visible", timeout=8000)
        except PWTimeout:
            pasted_by = "synthetic paste event (Ctrl+V delivered nothing in headless Chromium)"
            page.evaluate("""(t) => { const dt = new DataTransfer(); dt.setData('text/plain', t);
                const pm = document.querySelector('.ProseMirror');
                pm.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})) }""",
                          ARTICLE_PARA)
            page.locator(".ProseMirror").get_by_text("Guidance moved the stocks", exact=False).first.wait_for(
                state="visible", timeout=8000)
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        page.keyboard.type("Source: " + ARTICLE_URL + " ")
        link = page.locator(f'.ProseMirror a[href="{ARTICLE_URL}"]').first
        link.wait_for(state="attached", timeout=20000)
        ok_srv = (wait_server_has(p1.request, t1_note, "Guidance moved the stocks")
                  and wait_server_has(p1.request, t1_note, ARTICLE_URL))
        s2 = shot(page, "T2-1-passage-and-source-in-note")
        # the silent-failure check: CLICK the source link in the saved passage -> the article opens.
        opened_by, opened_title, s2b = None, None, None
        for how, mods in (("plain click", None), ("Ctrl+click", ["Control"])):
            try:
                with p1.expect_page(timeout=6000) as pop:
                    link.click(modifiers=mods) if mods else link.click()
                o = pop.value
                o.wait_for_load_state()
                opened_by, opened_title = how, o.title()
                s2b = shot(o, "T2-2-check-source-link-opens-the-article")
                o.close()
                break
            except PWTimeout:
                continue
        href = link.get_attribute("href")
        step("T2 core: 'Save this paragraph into that note, keeping where it came from.' -- passage + source "
             "link in the note; check: CLICKING the link opens the article",
             ok_srv and opened_title == ARTICLE_TITLE,
             clipboard_had_paragraph=(clip or "").strip() == ARTICLE_PARA, pasted_by=pasted_by,
             on_server=ok_srv, link_href=href, link_target=link.get_attribute("target"),
             link_opened_by=opened_by or "NOTHING -- neither a click nor Ctrl+click on the link opened a tab",
             opened_title=opened_title, screenshots=[s_art, s2] + ([s2b] if s2b else []))
        art.close()
    except Exception as e:  # noqa: BLE001
        step("T2 core", False, error=str(e)[:300], trace=traceback.format_exc()[-900:])

    # ── T4: the quick switcher ───────────────────────────────────────────────
    try:
        page.goto(BASE + "/journal/notebook?view=all")
        dismiss_intro(page)
        page.get_by_role("button", name="+ New note", exact=True).wait_for(state="visible", timeout=45000)
        page.keyboard.press("Control+K")
        box = page.get_by_role("combobox", name="Search a security, company, or note")
        box.wait_for(state="visible", timeout=15000)
        box.fill("Earnings season")
        opt = page.get_by_role("option", name=re.compile(r"^Note: Earnings season playbook"))
        opt.first.wait_for(state="visible", timeout=20000)
        s4 = shot(page, "T4-0-switcher-finds-the-note")
        opt.first.click()
        page.wait_for_url(re.compile(r"[?&]note="), timeout=20000)
        page.locator(".ProseMirror").first.wait_for(state="visible", timeout=45000)
        page.wait_for_function(
            "() => { const t = document.querySelector('input[placeholder=\"Title\"]');"
            " return !!t && t.value === 'Earnings season playbook' }", timeout=30000)
        s4b = shot(page, "T4-1-check-the-open-note-is-the-target")
        step("T4 core: 'Find the note called Earnings season playbook without scrolling the list.' -- "
             "Ctrl+K; check: the open note's title is the target",
             True, url_note=note_id_from(page.url), screenshots=[s4, s4b])
    except Exception as e:  # noqa: BLE001
        step("T4 core", False, error=str(e)[:300], trace=traceback.format_exc()[-900:])

    # ── T6: attach a 10-Q and pull the revenue line in with its page ─────────
    try:
        pdf = OUT / "fixture-synthetic-10q.pdf"
        pdf.write_bytes(tiny_10q_pdf())
        page = open_editor(p1, BASE + f"/journal/notebook?note={t1_note}", "p1", pg=page)
        page.get_by_label("Upload file attachment").set_input_files(str(pdf))
        chip = page.locator('.ProseMirror a[data-type="attachmentChip"]').first
        chip.wait_for(state="visible", timeout=60000)
        s6a = shot(page, "T6-0-pdf-attached")
        chip.click()
        span = page.locator("[data-pdf-page-number='1'] span", has_text="Total revenue").first
        span.wait_for(state="visible", timeout=60000)
        b = span.bounding_box()
        page.mouse.move(b["x"] + 1, b["y"] + b["height"] / 2)
        page.mouse.down()
        page.mouse.move(b["x"] + b["width"] - 1, b["y"] + b["height"] / 2, steps=8)
        page.mouse.up()
        save_btn = page.get_by_role("button", name="Save excerpt", exact=True)
        save_btn.wait_for(state="visible", timeout=20000)
        s6b = shot(page, "T6-1-revenue-line-selected-save-excerpt")
        save_btn.click()
        ok_srv = wait_server_has(p1.request, t1_note, "documentExcerpt", timeout_s=60)
        page.keyboard.press("Escape")
        page.locator("[data-pdf-page-number='1']").first.wait_for(state="detached", timeout=20000)
        cite = page.locator('.ProseMirror button[data-type="documentExcerptCitation"]').first
        cite.wait_for(state="visible", timeout=30000)
        quote = page.locator(".ProseMirror [data-document-excerpt]").first.inner_text()
        cite_text, cite_page = cite.inner_text(), cite.get_attribute("data-page")
        s6c = shot(page, "T6-2-excerpt-in-the-note-citing-p1")
        # the silent-failure check: click the excerpt's citation -> the PDF at the cited page, which
        # carries the revenue line
        cite.click()
        page.locator("[data-pdf-page-number='1'] span", has_text="Total revenue").first.wait_for(
            state="visible", timeout=60000)
        s6d = shot(page, "T6-3-check-citation-opens-the-cited-page")
        page.keyboard.press("Escape")
        step("T6 core: 'Attach this 10-Q and pull the revenue line into your note with its page.' -- excerpt "
             "in the note citing p.1; check: clicking the citation opens page 1 carrying the revenue line",
             ok_srv and cite_page == "1" and "Total revenue" in quote,
             excerpt_on_server=ok_srv, card_text=quote[:160], citation=cite_text, citation_page=cite_page,
             screenshots=[s6a, s6b, s6c, s6d])
    except Exception as e:  # noqa: BLE001
        step("T6 core", False, error=str(e)[:300], trace=traceback.format_exc()[-900:])

    # ── T8: Wi-Fi off, a sentence, back on; checked from a second browser ────
    try:
        sentence = "Written with the wifi off, and it should still be here."
        page = open_editor(p1, BASE + f"/journal/notebook?note={t1_note}", "p1", pg=page)
        page.locator(".ProseMirror").first.click()
        page.keyboard.press("Control+End")
        p1.set_offline(True)
        page.keyboard.press("Enter")
        page.keyboard.type(sentence)
        # the typed text is in the editor; the server cannot have it (the page is offline)
        page.locator(".ProseMirror").get_by_text(sentence).first.wait_for(state="visible", timeout=10000)
        server_had_it_offline = sentence in note_body(p1.request, t1_note)
        s8a = shot(page, "T8-0-typed-with-the-network-off")
        p1.set_offline(False)
        ok_srv = wait_server_has(p1.request, t1_note, sentence, timeout_s=120)
        s8b = shot(page, "T8-1-back-online")
        dev2 = browser.new_context(**vp)
        login2 = dev2.request.post(BASE + "/api/auth/login", data={"email": P1, "password": PW}).status
        pg2 = open_editor(dev2, BASE + f"/journal/notebook?note={t1_note}", "p1-second-browser")
        pg2.locator(".ProseMirror").get_by_text(sentence).first.wait_for(state="visible", timeout=30000)
        s8c = shot(pg2, "T8-2-check-second-browser-reads-the-sentence")
        step("T8 core: 'Turn off your Wi-Fi, add a sentence, then turn it back on.' -- check: in a SECOND "
             "browser, after the reconnect, the sentence is there",
             ok_srv and not server_had_it_offline,
             server_had_it_while_offline=server_had_it_offline, reached_server_after_reconnect=ok_srv,
             second_browser_login=login2, screenshots=[s8a, s8b, s8c])
        dev2.close()
    except Exception as e:  # noqa: BLE001
        with contextlib.suppress(Exception):
            p1.set_offline(False)
        step("T8 core", False, error=str(e)[:300], trace=traceback.format_exc()[-900:])

    # ── PART B: seeded activity, then the soak read ──────────────────────────
    since = RUN_START.strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        smoke = browser.new_context(**vp)
        ghost = browser.new_context(**vp)
        signup_or_login(smoke.request, SMOKE, "smoke")
        signup_or_login(ghost.request, GHOST, "ghost")

        def tel(ctx, event, props):
            return ctx.request.post(BASE + "/api/j2/telemetry", data=json.dumps({"event": event, "props": props}),
                                    headers={"Content-Type": "application/json"}).status

        seeded = {
            "organic P1": [tel(p1, "save_failed", {"reason": "network", "offline": True}),
                           tel(p1, "conflict_forked", {"door": "outbox", "queued": False}),
                           tel(p1, "notebook_blocked_no_baseline", {}),
                           tel(p1, "search_used", {"ms": 64, "results": 3, "mode": "text"}),
                           tel(p1, "ask_used", {"ms": 910, "scope": "notebook", "inserted": False})],
            "synthetic smoke@": [tel(smoke, "save_failed", {"reason": "http", "status": 503}),
                                 tel(smoke, "note_open_ms", {"ms": 140, "source": "list"})],
            "unknown internal ghost@": [tel(ghost, "notebook_offline_opt_in", {})],
        }
        ce = p1.request.post(BASE + "/api/client-errors", data=json.dumps({"reports": [
            {"kind": "error", "name": "TypeError", "message": "x is not a function",
             "page": "/journal/notebook", "ts": int(time.time() * 1000)}]}),
            headers={"Content-Type": "application/json"})
        cc = p1.request.post(BASE + "/api/j2/notes", data=json.dumps({
            "title": "Plan for tomorrow's session (conflicted copy)", "tags": ["sync-conflict"],
            "bodyJson": {"type": "doc", "content": []}}), headers={"Content-Type": "application/json"})
        seeded["client error on /journal/notebook"] = [ce.status, ce.json() if ce.ok else None]
        seeded["a sync-conflict note through the notes door"] = cc.status
        flat = [s for k in ("organic P1", "synthetic smoke@", "unknown internal ghost@") for s in seeded[k]]
        step("seeded activity through the product's own doors: telemetry, the client-error beacon, the notes door",
             all(s == 200 for s in flat) and ce.ok and cc.ok, seeded=seeded)
        # Run 1: every seeded row was stamped in the SAME second as the read's `until`
        # (activity_log.created_at is CURRENT_TIMESTAMP, one-second resolution), and the read's
        # half-open [since, until) floors both ends to the second -- so a row in `until`'s own
        # second belongs to the NEXT tiled read, never to both and never to neither. This read
        # is taken after that second has passed (a boundary wait, not a sample).
        time.sleep(1.2)

        apg = watch(admin.new_page(), "admin")
        resp = apg.goto(BASE + f"/api/admin/notebook-soak?since={since}")
        raw = resp.text()
        body = resp.json()
        s_json = shot(apg, "soak-0-endpoint-as-admin-in-the-browser")
        (OUT / "soak-endpoint-response.json").write_text(json.dumps(body, indent=1), encoding="utf-8")
        ev = body["events"]
        split = {
            "save_failed organic": ev["save_failed"]["organic"]["events"],
            "save_failed synthetic": ev["save_failed"]["synthetic"]["events"],
            "offline opt-in unknown_internal": ev["notebook_offline_opt_in"]["unknown_internal"]["events"],
            "offline opt-in organic (P1's own browsing)": ev["notebook_offline_opt_in"]["organic"]["events"],
            "note_open_ms synthetic n": body["speed"]["note_open_ms"]["by_population"]["synthetic"]["n"],
            "conflict_forked organic by_door.outbox": ev["conflict_forked"]["organic"]["by_door"]["outbox"],
            "blocked-baseline organic": ev["notebook_blocked_no_baseline"]["organic"]["events"],
            "client errors organic": body["client_errors"]["by_population"]["organic"]["errors"],
            "conflicted copies offline_layer organic": body["conflicted_copies"]["offline_layer"]["organic"],
            "identities editing organic": body["exposure"]["identities_editing"]["organic"],
        }
        leaks = [x for x in (P1, SMOKE, GHOST, ADMIN, "Plan for tomorrow", "opening range", ARTICLE_URL)
                 if x in raw]
        step("GET /api/admin/notebook-soak as the admin, IN THE BROWSER: every seeded figure lands in its own "
             "population, never summed; aggregates only (no email, title or body text in the response)",
             resp.status == 200 and all(v >= 1 for v in split.values()) and not leaks,
             status=resp.status, split=split, leaks=leaks, config_served=body["config_served"],
             identities_editing=body["exposure"]["identities_editing"],
             note_open_ms=body["speed"]["note_open_ms"]["by_population"],
             exposure_basis=body["exposure"]["basis"], screenshots=[s_json])
        mpg = watch(p1.new_page(), "p1")
        r403 = mpg.goto(BASE + f"/api/admin/notebook-soak?since={since}")
        s_403 = shot(mpg, "soak-1-same-read-as-a-member-403")
        step("the same read as a MEMBER is refused", r403.status == 403, status=r403.status,
             body=r403.text()[:160], screenshots=[s_403])
        bad = apg.goto(BASE + "/api/admin/notebook-soak?since=yesterday")
        s_400 = shot(apg, "soak-2-malformed-since-400")
        step("a malformed `since` is a 400 with a sentence", bad.status == 400, status=bad.status,
             body=bad.text()[:220], screenshots=[s_400])
        mpg.close()

        # ── the OBSERVER's own read code, against the sandbox page ───────────
        os.environ["NB_OBSERVE_LOG"] = str(OUT / "soak-observation-log.md")
        os.environ["NB_SOAK_SAMPLES"] = str(OUT / "soak-samples.jsonl")
        os.environ["NB_SOAK_START"] = since
        sys.path.insert(0, str(EXPORT / "tools"))
        spec = importlib.util.spec_from_file_location("nb_observe", EXPORT / "tools" / "nb_observe.py")
        obs = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(obs)
        now = obs.utc_now()
        apg.goto(BASE + "/journal/notebook")
        dismiss_intro(apg)
        at = obs.et_now()
        act = apg.evaluate(obs.wc.ACTIVITY_JS, [obs.OPT_IN, obs.BLOCKED])
        oi = apg.evaluate(obs.OPTIN_JS, {"rigOwner": [e.lower() for e in obs.RIG_AND_OWNER],
                                         "synthetic": [e.lower() for e in obs.SYNTHETIC_MEMBERS],
                                         "internalDomain": obs.INTERNAL_DOMAIN})
        served = obs.render_config_served(apg.evaluate(obs.CONFIG_SERVED_JS, [e.lower() for e in obs.NOT_A_MEMBER]))
        notes = apg.evaluate(obs.NOTES_JS)
        cell = (f"{oi.get('latest') or '—'} · organic {oi['organic']['identities']} · synthetic "
                f"{oi['synthetic']['identities']} · rig/owner {oi['rigOwner']['identities']}"
                + (f" · ⛔ UNKNOWN INTERNAL {oi['unknownInternal']['identities']}"
                   if oi["unknownInternal"]["identities"] else ""))
        obs.append(obs.row(at, cell, (act.get(obs.OPT_IN) or {}).get("count", "ERR"), served,
                           (act.get(obs.BLOCKED) or {}).get("count", "ERR"), notes.get("conflicts", "ERR"),
                           0, 0, "OK (SANDBOX exercise of the observer's reads; not a production row)"))
        since2, clamped = obs.next_soak_since(obs.SOAK_SAMPLES, now)
        interval = obs.soak_read(apg, since2, now)
        start = obs.soak_start(now)
        cum = obs.cumulative_from(obs.soak_read(apg, start[0], now), start[0], now, start[1]) if start else None
        line = obs.soak_sample_line(at, since2, now, interval, clamped=clamped, cumulative=cum, now=now)
        obs.append_soak_sample(line)
        blank = watch(admin.new_page(), "admin-blank")
        failed = obs.soak_sample_line(at, now, now + dt.timedelta(seconds=1), obs.soak_read(blank, now, now), now=now)
        blank.close()
        lines = (OUT / "soak-samples.jsonl").read_text(encoding="utf-8").splitlines()
        step("the observer's SOAK_JS read the sandbox through the signed-in page and appended ONE sidecar "
             "line with figures + the from-the-start `cumulative`; a read that cannot be taken is `skipped`",
             len(lines) == 1 and "figures" in line and isinstance(cum, dict) and "skipped" not in cum
             and "figures" not in failed and bool(failed.get("skipped")),
             sidecar_lines=len(lines), interval=line["interval"],
             cumulative_identities=(cum or {}).get("identities_editing"),
             q1_optin_cell=cell, q1_config_served=served, q1_conflicts=notes.get("conflicts"),
             a_blank_page_read_is=failed.get("skipped"))
        smoke.close()
        ghost.close()
    except Exception as e:  # noqa: BLE001
        step("PART B soak", False, error=str(e)[:300], trace=traceback.format_exc()[-900:])

    # ── nb_soak: the roll-up, rendered in the browser ────────────────────────
    try:
        spec = importlib.util.spec_from_file_location("nb_soak", EXPORT / "tools" / "nb_soak.py")
        soak = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(soak)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = soak.main(["--log", str(OUT / "soak-observation-log.md"),
                            "--samples", str(OUT / "soak-samples.jsonl"),
                            "--start", since, "--start-sha", ARGS.tip,
                            "--repo", str(EXPORT), "--copies", str(EXPORT / "tools"),
                            "--state", str(OUT / "soak-alert-state.json"),
                            "--no-schtasks", "--no-alerts", "--out", str(OUT / "soak-dashboard.md")])
        stdout_line = buf.getvalue().strip()
        from markdown_it import MarkdownIt
        md = (OUT / "soak-dashboard.md").read_text(encoding="utf-8")
        html = ("<!doctype html><html><head><meta charset='utf-8'><title>Soak dashboard (sandbox)</title><style>"
                "body{font:14px/1.45 system-ui,sans-serif;max-width:1100px;margin:24px auto;color:#111}"
                "table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #bbb;padding:3px 8px}"
                "code{background:#f2f2f2;padding:0 3px}</style></head><body>"
                + MarkdownIt("commonmark").enable("table").render(md) + "</body></html>")
        (OUT / "soak-dashboard.html").write_text(html, encoding="utf-8")
        dctx = browser.new_context(viewport={"width": 1280, "height": 1000})
        dpg = dctx.new_page()
        dpg.goto((OUT / "soak-dashboard.html").as_uri())
        dpg.get_by_text("VERDICT:").first.wait_for(state="visible", timeout=10000)
        s_d = shot(dpg, "soak-3-dashboard-rendered", full=True)
        word = re.search(r"^VERDICT: \*\*(\w+)\*\*", md, re.M)
        step("tools/nb_soak.py rolled the sandbox evidence up; the dashboard renders in the browser",
             rc == 0 and word is not None and "%" not in md,
             rc=rc, verdict=word.group(1) if word else None, stdout_line=stdout_line[-400:],
             alert_state_written=(OUT / "soak-alert-state.json").exists(), screenshots=[s_d])
        dctx.close()
    except Exception as e:  # noqa: BLE001
        step("nb_soak roll-up", False, error=str(e)[:300], trace=traceback.format_exc()[-900:])

    browser.close()

res["finished"] = dt.datetime.now(dt.timezone.utc).isoformat()
res["summary"] = {"pass": sum(1 for s in res["steps"] if s["ok"]),
                  "fail": sum(1 for s in res["steps"] if not s["ok"]),
                  "route_fallbacks": len(res["route_fallbacks"]), "page_errors": len(res["page_errors"])}
save()
print("SUMMARY", json.dumps(res["summary"]), flush=True)
