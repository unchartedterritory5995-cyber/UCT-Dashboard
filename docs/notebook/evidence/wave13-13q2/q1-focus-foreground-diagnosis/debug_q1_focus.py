"""Ad-hoc debug script (13Q-2): why does a fresh blank note not end up focused
in the body in a REAL browser, when the same code path focuses it correctly
under jsdom? Boots the same sandbox the instrument uses, reuses its own
helpers (never reimplemented), and captures console + evaluates diagnostics
the instrument itself does not surface (it only listens for `pageerror`,
never `console`).
"""
import os
import sys
import time
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q2")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

DATA_DIR = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13q2-dbg1")
PORT = 8625
OUT = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13q2-dbg1-out")
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

os.environ.update(w13q.SANDBOX_FLAGS)
os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": ""})

box = h.Sandbox(str(DATA_DIR), PORT, OUT / "sandbox.log")
base = f"http://127.0.0.1:{PORT}"
box.start()
try:
    if not box.wait_healthy(base, 300):
        print("SANDBOX NEVER HEALTHY")
        sys.exit(1)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin = br.new_context()
        seedctx = br.new_context(viewport={"width": 1200, "height": 900})
        req = seedctx.request
        h._provision(admin.request, req, base, member=w13q.MEMBER)
        pg = seedctx.new_page()
        msgs = []
        pg.on("console", lambda m: msgs.append(f"[{m.type}] {m.text}"))
        pg.on("pageerror", lambda e: msgs.append(f"[pageerror] {e}"))
        pg.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(pg)
        pg.wait_for_timeout(1500)
        # click "+ New note"
        btn = pg.locator("[data-tour='new-note']").filter(visible=True)
        btn.first.wait_for(state="visible", timeout=20000)
        btn.first.click()
        pg.wait_for_url("**/journal/notebook?*note=*", timeout=20000)
        pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=20000)
        # IMMEDIATE check, same as the instrument
        immediate = pg.evaluate("() => { const el = document.activeElement; return {tag: el && el.tagName, ce: el && el.closest && !!el.closest('.ProseMirror')} }")
        print("IMMEDIATE activeElement:", immediate)
        pg.wait_for_timeout(500)
        settled = pg.evaluate("() => { const el = document.activeElement; return {tag: el && el.tagName, ce: el && el.closest && !!el.closest('.ProseMirror')} }")
        print("SETTLED(+500ms) activeElement:", settled)
        # manual focus attempt + check for exceptions
        manual = pg.evaluate("""() => {
          const pm = document.querySelector('.ProseMirror');
          if (!pm) return {error: 'no .ProseMirror found'};
          const ed = pm.editor;
          if (!ed) return {error: 'no .editor on the ProseMirror node', pmCount: document.querySelectorAll('.ProseMirror').length};
          try {
            ed.commands.focus('end');
            return {ok: true, activeIsPM: document.activeElement === pm, activeTag: document.activeElement && document.activeElement.tagName,
                    isDestroyed: ed.isDestroyed, isEditable: ed.isEditable, pmCount: document.querySelectorAll('.ProseMirror').length};
          } catch (e) {
            return {error: String(e && e.stack || e)};
          }
        }""")
        print("MANUAL focus attempt result:", manual)
        has_focus = pg.evaluate("() => document.hasFocus()")
        print("document.hasFocus():", has_focus)
        pg.bring_to_front()
        pg.wait_for_timeout(200)
        has_focus2 = pg.evaluate("() => document.hasFocus()")
        print("document.hasFocus() after bring_to_front:", has_focus2)
        manual2 = pg.evaluate("""() => {
          const pm = document.querySelector('.ProseMirror');
          const ed = pm && pm.editor;
          if (!ed) return {error: 'no editor'};
          ed.commands.focus('end');
          return {activeIsPM: document.activeElement === pm, activeTag: document.activeElement && document.activeElement.tagName};
        }""")
        print("MANUAL focus attempt AFTER bring_to_front:", manual2)
        # Playwright's OWN .focus() locator method (not a JS evaluate call)
        pg.locator(".ProseMirror").first.focus()
        pw_focus = pg.evaluate("() => { const el = document.activeElement; return {tag: el && el.tagName, ce: el && el.closest && !!el.closest('.ProseMirror')} }")
        print("Playwright locator.focus() result:", pw_focus)
        print("--- console/page messages ---")
        for m in msgs:
            print(m)
        pg.close()
        br.close()
finally:
    box.stop(grace_s=60)
print("DONE")
