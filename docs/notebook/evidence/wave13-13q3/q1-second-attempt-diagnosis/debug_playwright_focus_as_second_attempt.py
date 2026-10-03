
import os, sys
from pathlib import Path
REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q3")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h
import notebook_w13q_clicks as w13q

DATA_DIR = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q1-bring-front-timing\data9")
PORT = 8637
OUT = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q1-bring-front-timing\out9")
DATA_DIR.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
os.environ.update(w13q.SANDBOX_FLAGS)
os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": ""})
box = h.Sandbox(str(DATA_DIR), PORT, OUT / "sandbox.log")
base = f"http://127.0.0.1:{PORT}"
box.start()
log = []
def say(l):
    print(l); log.append(str(l))
try:
    if not box.wait_healthy(base, 300):
        say("NEVER HEALTHY"); sys.exit(1)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin = br.new_context()
        seedctx = br.new_context(viewport={"width": 1200, "height": 900})
        req = seedctx.request
        h._provision(admin.request, req, base, member=w13q.MEMBER)
        state = seedctx.storage_state()
        ctx = br.new_context(viewport={"width": 1200, "height": 900}, storage_state=state)
        pg = ctx.new_page()
        pg.bring_to_front()
        pg.goto(base + "/journal/notebook?new=blank", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(pg)
        pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=60000)
        pg.wait_for_timeout(500)
        before = pg.evaluate(w13q.FOCUS_DESC_JS)
        say(f"product's own natural attempt result (unaided): {before}")
        # attempt 2 via PLAYWRIGHT'S OWN .focus() method, not evaluate
        pg.locator(".ProseMirror").first.focus()
        after = pg.evaluate(w13q.FOCUS_DESC_JS)
        say(f"after Playwright .focus() as the ONLY extra attempt: {after}")
        ctx.close(); br.close()
finally:
    box.stop(grace_s=60)
(OUT / "RESULT.txt").write_text("\n".join(log), encoding="utf-8")
say(f"written to {OUT / 'RESULT.txt'}")
