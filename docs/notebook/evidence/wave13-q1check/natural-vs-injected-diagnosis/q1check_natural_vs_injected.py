"""Diagnostic (13Q-Q1check): final isolation. Same note, same page. First read
whether the PRODUCT's own (now direct-DOM-focus) effect landed it naturally.
Then, WITHOUT closing anything, try the identical direct DOM .focus() call
again but via page.evaluate() (CDP-injected) and see if THAT succeeds where
the product's own call (natural context) did not -- on the SAME element, SAME
page, SAME timing window, back to back.
"""
import os
import sys
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q1check")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h
import notebook_w13q_clicks as w13q

SCRATCH = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad")
DATA_DIR = SCRATCH / "q1check-niv-data"
OUT = SCRATCH / "q1check-niv-out"
PORT = 8626
MEMBER = ("w13q1niv@local.dev", "LocalTest2026!", "w13q1niv")
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
os.environ.update(w13q.SANDBOX_FLAGS)
os.environ.setdefault("FMP_API_KEY", "")
os.environ.setdefault("FINNHUB_API_KEY", "")
os.environ.setdefault("ALPHAVANTAGE_API_KEY", "")

CHECK_JS = """() => { const el = document.activeElement; return !!(el && el.closest && el.closest('.ProseMirror')); }"""
INJECTED_FOCUS_JS = """() => { const pm = document.querySelector('.ProseMirror'); pm.focus(); return document.activeElement === pm; }"""

def main():
    box = h.Sandbox(str(DATA_DIR), PORT, OUT / "sandbox.log")
    base = f"http://127.0.0.1:{PORT}"
    box.start()
    try:
        assert box.wait_healthy(base, 300), "sandbox never healthy"
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True)
            admin = br.new_context()
            seedctx = br.new_context()
            h._provision(admin.request, seedctx.request, base, member=MEMBER)
            state = seedctx.storage_state()
            ctx = br.new_context(viewport={"width": 1200, "height": 900}, storage_state=state)
            pg = ctx.new_page()
            pg.bring_to_front()
            pg.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded", timeout=60000)
            h._dismiss_intro(pg)
            pg.wait_for_timeout(500)
            btn = pg.locator('[data-tour="new-note"]').filter(visible=True)
            btn.first.wait_for(state="visible", timeout=20000)
            btn.first.click()
            pg.wait_for_url("**/journal/notebook?*note=*", timeout=20000)
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=20000)
            pg.wait_for_timeout(2000)
            # 1) did the PRODUCT's own (direct-DOM-focus) effect land it naturally by now?
            print("1) product's own effect, natural, after 2s:", pg.evaluate(CHECK_JS), flush=True)
            # 2) now inject the SAME kind of call (direct DOM .focus()) via evaluate
            print("2) same call, injected via page.evaluate():", pg.evaluate(INJECTED_FOCUS_JS), flush=True)
            print("   activeElement in PM now:", pg.evaluate(CHECK_JS), flush=True)
    finally:
        stop_how = box.stop()
        print("stop_how:", stop_how, flush=True)
        print("WROTE-NIV-DONE", flush=True)

if __name__ == "__main__":
    main()
