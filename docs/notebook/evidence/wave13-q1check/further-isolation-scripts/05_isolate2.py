"""Diagnostic (13Q-Q1check): same reused context (no separate seedctx -> new
context + storage_state transfer) as the persistent tests, WITH one
bring_to_front(), testing BOTH the product's natural effect AND a manual
page.evaluate() focus call on the SAME note, to isolate whether the
"third context created via storage_state from a separate login context"
shape (used by the formal measurement AND by the diagnostic that succeeded)
is itself part of what made the earlier manual-evaluate attempt succeed.
"""
import os
import sys
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q1check")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

SCRATCH = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad")
DATA_DIR = SCRATCH / "q1check-iso2-data"
OUT = SCRATCH / "q1check-iso2-out"
PORT = 8626
MEMBER = ("w13q1iso2@local.dev", "LocalTest2026!", "w13q1iso2")

DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
os.environ.update(w13q.SANDBOX_FLAGS)
os.environ.setdefault("FMP_API_KEY", "")
os.environ.setdefault("FINNHUB_API_KEY", "")
os.environ.setdefault("ALPHAVANTAGE_API_KEY", "")

CHECK_JS = """() => { const el = document.activeElement; return !!(el && el.closest && el.closest('.ProseMirror')); }"""
MANUAL_FOCUS_JS = """() => { const pm = document.querySelector('.ProseMirror'); if (!pm || !pm.editor) return {error:'no editor'}; pm.editor.commands.focus('end'); return {ok:true}; }"""


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
            ctx = br.new_context(viewport={"width": 1200, "height": 900})
            h._provision(admin.request, ctx.request, base, member=MEMBER)
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
            print("natural after 2s:", pg.evaluate(CHECK_JS), flush=True)
            r = pg.evaluate(MANUAL_FOCUS_JS)
            print("manual focus_call:", r, "landed immediately:", pg.evaluate(CHECK_JS), flush=True)
    finally:
        stop_how = box.stop()
        print("stop_how:", stop_how, flush=True)
        print("WROTE-ISO2-DONE", flush=True)


if __name__ == "__main__":
    main()
