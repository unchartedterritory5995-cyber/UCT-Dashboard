import time
from playwright.sync_api import sync_playwright
BASE="http://127.0.0.1:8093"
P=lambda t: {"type":"paragraph","content":[{"type":"text","text":t}]}
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":800})
    ctx.request.post(BASE+"/api/auth/login",data={"email":"g064@local.dev","password":"LocalTest2026!"})
    nid=ctx.request.post(BASE+"/api/j2/notes",data={"title":"W1 waiter control","bodyJson":{"type":"doc","content":[P("x")]}}).json()["note"]["id"]
    pg=ctx.new_page(); pg.goto(f"{BASE}/journal/notebook?note={nid}")
    try:
        pg.locator('div[role="dialog"][aria-label="Welcome"]').first.wait_for(state="visible",timeout=2500); pg.keyboard.press("Escape")
    except Exception: pass
    pg.wait_for_selector(".ProseMirror",timeout=20000); pg.wait_for_timeout(1000)
    t=time.monotonic(); timed_out=False
    try:
        pg.wait_for_function("() => document.querySelector('.ProseMirror')?.getAttribute('contenteditable') === 'false'", timeout=1500)
    except Exception: timed_out=True
    print("CONTROL (never locked): timed_out=%s attr=%s waited_ms=%d" % (timed_out, pg.locator(".ProseMirror").get_attribute("contenteditable"), (time.monotonic()-t)*1000))
    b.close()
