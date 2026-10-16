"""Read-mostly probe: does the slash menu open on production, and what does it list for /plan?
Smoke account, own context; makes one note and trashes it. Prints facts only."""
import json, os, sys, pathlib
BASE, OUT = sys.argv[1].rstrip("/"), pathlib.Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
email, pw = os.environ["SMOKE_EMAIL"], os.environ["SMOKE_PASSWORD"]
assert email.endswith("@uctintelligence.internal")
from playwright.sync_api import sync_playwright
from mobile_audit import _dismiss_intro
facts = {}
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    ctx = br.new_context(viewport={"width": 1280, "height": 800}); req = ctx.request
    req.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
    me = req.get(BASE + "/api/auth/me").json()
    acc = me.get("access") or {}
    facts["styles_flag"] = me.get("notebook_journal_styles_enabled", acc.get("notebook_journal_styles_enabled"))
    facts["chips_flag"] = me.get("notebook_smart_chips_enabled", acc.get("notebook_smart_chips_enabled"))
    j = req.post(BASE + "/api/j2/notes", data={"title": "slash probe", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}).json()
    nid = (j.get("note") or j).get("id")
    try:
        pg = ctx.new_page()
        errs = []; pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:200]))
        pg.goto(f"{BASE}/journal/notebook?note={nid}", wait_until="domcontentloaded"); _dismiss_intro(pg)
        pg.wait_for_selector(".ProseMirror", timeout=30000)
        pm = pg.locator(".ProseMirror").first; pm.click(); pg.keyboard.press("Control+End")
        pg.wait_for_timeout(1500)
        pg.keyboard.type("/", delay=60); pg.wait_for_timeout(2500)
        facts["options_after_slash"] = pg.get_by_role("option").all_inner_texts()[:12]
        pg.keyboard.type("plan", delay=80); pg.wait_for_timeout(2500)
        facts["options_after_plan"] = pg.get_by_role("option").all_inner_texts()[:12]
        pg.keyboard.type(" NVDA", delay=80); pg.wait_for_timeout(3000)
        facts["options_after_plan_nvda"] = pg.get_by_role("option").all_inner_texts()[:12]
        facts["focused"] = pg.evaluate("() => document.activeElement && document.activeElement.className")
        facts["console_errors"] = errs[:8]
        pg.screenshot(path=str(OUT / "slash-probe.png"))
    finally:
        facts["delete"] = req.delete(f"{BASE}/api/j2/notes/{nid}").status
        br.close()
(OUT / "slash-probe.json").write_text(json.dumps(facts, indent=1), encoding="utf-8")
print(json.dumps(facts, indent=1))
