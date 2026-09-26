"""H14 live check (read-only): on production, where is focus 600 ms after opening the Notebook's
Save view dialog? Opens and cancels; saves nothing. Smoke account, own Playwright context."""
import json, os, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
if BASE.startswith("http://127"):
    email, pw = "g064@local.dev", "LocalTest2026!"
out = {"base": BASE}
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(user_agent=UA, viewport={"width": 1280, "height": 800}); page = ctx.new_page()
    posts = []
    page.on("request", lambda r: posts.append(r.url) if "saved-views" in r.url and r.method != "GET" else None)
    page.goto(BASE + "/", wait_until="domcontentloaded")
    out["login"] = page.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw}).status
    page.goto(BASE + "/journal/notebook?view=all", wait_until="domcontentloaded")
    d = page.locator('div[role="dialog"][aria-label="Welcome"]')
    try:
        d.first.wait_for(state="visible", timeout=4000); page.keyboard.press("Escape"); d.first.wait_for(state="detached", timeout=6000)
    except Exception:
        pass
    tv = page.get_by_role("button", name="Table view", exact=True); tv.wait_for(state="visible", timeout=20000); tv.click(); page.wait_for_timeout(500)
    sv = page.get_by_role("button", name="Save view", exact=True); sv.wait_for(state="visible", timeout=10000)
    out["save_view_buttons"] = sv.count(); sv.first.click()
    page.locator("#save-view-name").wait_for(state="visible", timeout=5000)
    samples = []
    for ms in (0, 50, 150, 600):
        page.wait_for_timeout(ms if not samples else ms - [0, 50, 150, 600][len(samples) - 1])
        samples.append({"t_ms": ms, **page.evaluate("() => ({tag: document.activeElement?.tagName, id: document.activeElement?.id || null, isField: document.activeElement?.id === 'save-view-name'})")})
    out["focus_samples"] = samples
    page.keyboard.type("abc")   # what a member types right after the dialog opens
    out["field_value_after_typing"] = page.locator("#save-view-name").input_value()
    page.get_by_role("button", name="Cancel", exact=True).click()
    page.wait_for_timeout(300)
    out["save_requests"] = posts
    b.close()
print(json.dumps(out, indent=1))
