"""Diagnostic (13Q-Q1check): does ANY number of pure-JS editor.commands.focus('end')
retries, all occurring AFTER the page is already foreground (matching the real
product's own timing), ever land document.activeElement in .ProseMirror -- or is
this structurally unreachable from page JS regardless of attempt count?

Reuses the sandbox + provisioning exactly as the formal measurement does. Creates
ONE blank note via the real UI, then calls editor.commands.focus('end') up to 40
times from page.evaluate (a genuine JS-level call, the only kind the product can
make), checking document.activeElement after EACH call, with a short real wait
between calls so each call's own TipTap-internal requestAnimationFrame has a
chance to fire before the next one. Never uses Playwright's own pm.focus() or any
other CDP-level action.
"""
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q1check")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

SCRATCH = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad")
DATA_DIR = SCRATCH / "q1check-diag-data"
OUT = SCRATCH / "q1check-diag-out"
PORT = 8626
MEMBER = ("w13q1diag@local.dev", "LocalTest2026!", "w13q1diag")

DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

os.environ.update(w13q.SANDBOX_FLAGS)
os.environ.setdefault("FMP_API_KEY", "")
os.environ.setdefault("FINNHUB_API_KEY", "")
os.environ.setdefault("ALPHAVANTAGE_API_KEY", "")

CHECK_JS = """() => {
  const el = document.activeElement;
  return !!(el && el.closest && el.closest('.ProseMirror'));
}"""

MANUAL_FOCUS_JS = """() => {
  const pm = document.querySelector('.ProseMirror');
  if (!pm || !pm.editor) return {error: 'no editor'};
  try {
    pm.editor.commands.focus('end');
    return {ok: true};
  } catch (e) {
    return {error: String(e)};
  }
}"""


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
            print("hasFocusDoc:", pg.evaluate("() => document.hasFocus()"), flush=True)
            print("visibilityState:", pg.evaluate("() => document.visibilityState"), flush=True)
            landed_at = None
            for i in range(1, 41):
                r = pg.evaluate(MANUAL_FOCUS_JS)
                pg.wait_for_timeout(20)
                ok = pg.evaluate(CHECK_JS)
                print(f"attempt {i}: focus_call={r} landed={ok}", flush=True)
                if ok:
                    landed_at = i
                    break
            print("RESULT landed_at =", landed_at, flush=True)
    finally:
        stop_how = box.stop()
        print("stop_how:", stop_how, flush=True)
        print("WROTE-DIAG-DONE", flush=True)


if __name__ == "__main__":
    main()
