"""W1 diagnosis probe (controller, 2026-09-26). Read-only against the sandbox on
:8093 except for ONE note it creates and locks. Records, with timestamps, when
the editor's contenteditable flips after Lock, and every request after the click."""
import json, sys, time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8093"
EMAIL, PW = "g064@local.dev", "LocalTest2026!"
OUT = sys.argv[1]
P = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}
out = {"samples": [], "requests": [], "pageerrors": [], "console": []}

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800})
    r = ctx.request.post(BASE + "/api/auth/login", data={"email": EMAIL, "password": PW})
    out["login"] = r.status
    note = ctx.request.post(BASE + "/api/j2/notes", data={
        "title": "W1 probe " + time.strftime("%H%M%S"),
        "bodyJson": {"type": "doc", "content": [P("Original body.")]}}).json()["note"]
    nid = note["id"]
    out["note_id"] = nid
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: out["pageerrors"].append(str(e)[:300]))
    pg.on("console", lambda m: out["console"].append(f"{m.type}: {m.text[:200]}") if m.type in ("error", "warning") else None)
    pg.goto(f"{BASE}/journal/notebook?note={nid}")
    try:
        pg.locator('div[role="dialog"][aria-label="Welcome"]').first.wait_for(state="visible", timeout=2500)
        pg.keyboard.press("Escape")
        pg.locator('div[role="dialog"][aria-label="Welcome"]').first.wait_for(state="detached", timeout=6000)
    except Exception:
        pass
    pg.wait_for_selector(".ProseMirror", timeout=20000)
    pg.wait_for_timeout(1500)
    out["editable_before"] = pg.locator(".ProseMirror").get_attribute("contenteditable")
    menu = pg.get_by_role("group", name="Organise this note")
    menu.wait_for(state="visible", timeout=8000)
    t0 = time.monotonic()
    pg.on("request", lambda q: out["requests"].append(
        {"t_ms": round((time.monotonic() - t0) * 1000), "m": q.method, "url": q.url.replace(BASE, "")}))
    pg.on("response", lambda s: out["requests"].append(
        {"t_ms": round((time.monotonic() - t0) * 1000), "resp": s.status, "url": s.url.replace(BASE, "")}))
    menu.get_by_role("button", name="Lock", exact=True).click()
    first_false = None
    while time.monotonic() - t0 < 8.0:
        v = pg.locator(".ProseMirror").get_attribute("contenteditable")
        ms = round((time.monotonic() - t0) * 1000)
        if not out["samples"] or out["samples"][-1][1] != v:
            out["samples"].append([ms, v])
        if v == "false" and first_false is None:
            first_false = ms
        pg.wait_for_timeout(50)
    out["first_false_ms"] = first_false
    out["server_note_locked"] = ctx.request.get(BASE + f"/api/j2/notes/{nid}").json().get("note", {}).get("locked")
    out["menu_buttons"] = [bt.inner_text() for bt in menu.get_by_role("button").all()]
    try:
        out["status_text"] = pg.locator('[role="status"]').all_inner_texts()[:5]
    except Exception as e:
        out["status_text"] = str(e)
    b.close()

json.dump(out, open(OUT, "w", encoding="utf-8"), indent=1)
print(json.dumps({k: out[k] for k in ("note_id", "editable_before", "first_false_ms", "server_note_locked", "samples", "menu_buttons")}, indent=1))
