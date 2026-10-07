"""Does calling the SAME focus command TWICE succeed WITHOUT bring_to_front() at all? If so,
bring_to_front() was never the active ingredient -- "attempted twice" is.
"""
import os
import sys
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q3")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

DATA_DIR = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q1-bring-front-timing\data8")
PORT = 8636
OUT = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q1-bring-front-timing\out8")
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

os.environ.update(w13q.SANDBOX_FLAGS)
os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": ""})

box = h.Sandbox(str(DATA_DIR), PORT, OUT / "sandbox.log")
base = f"http://127.0.0.1:{PORT}"
box.start()
log = []


def say(line):
    print(line)
    log.append(str(line))


FOCUS_JS = """() => {
  const pm = document.querySelector('.ProseMirror');
  const ed = pm && pm.editor;
  if (!ed) return {error: 'no editor'};
  ed.commands.focus('end');
  return {activeIsPM: document.activeElement === pm, activeTag: document.activeElement && document.activeElement.tagName};
}"""

try:
    if not box.wait_healthy(base, 300):
        say("SANDBOX NEVER HEALTHY")
        sys.exit(1)
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
        # deliberately NEVER call bring_to_front() in this test
        pg.goto(base + "/journal/notebook?new=blank", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(pg)
        pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=60000)
        pg.wait_for_timeout(500)

        attempt1 = pg.evaluate(FOCUS_JS)
        say(f"attempt 1 (no bring_to_front ever called): {attempt1}")
        attempt2 = pg.evaluate(FOCUS_JS)
        say(f"attempt 2 (still no bring_to_front ever called): {attempt2}")
        has_focus = pg.evaluate("() => document.hasFocus()")
        say(f"document.hasFocus(): {has_focus}")
        ctx.close()
        br.close()
finally:
    box.stop(grace_s=60)

(OUT / "RESULT.txt").write_text("\n".join(log), encoding="utf-8")
say(f"\nwritten to {OUT / 'RESULT.txt'}")
