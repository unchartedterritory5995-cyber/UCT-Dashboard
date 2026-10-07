"""Isolate the TWO candidate variables between 13Q-2's successful repro (debug_timing4) and
the failing real-flow repro (debug_timing3): (1) brand-new `br.new_context()` vs the existing
`seedctx`, and (2) note creation via a real MOUSE CLICK vs via Ctrl+K keyboard. Four cells.
"""
import os
import sys
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q3")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

DATA_DIR = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q1-bring-front-timing\data5")
PORT = 8633
OUT = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q1-bring-front-timing\out5")
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


def create_via_click(pg):
    pg.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(pg)
    pg.wait_for_timeout(1500)
    btn = pg.locator("[data-tour='new-note']").filter(visible=True)
    btn.first.wait_for(state="visible", timeout=20000)
    btn.first.click()
    pg.wait_for_url("**/journal/notebook?*note=*", timeout=20000)


def create_via_keyboard(pg):
    import re
    pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(pg)
    pg.wait_for_timeout(1500)
    pg.keyboard.press("Control+k")
    pg.keyboard.type("new note", delay=15)
    opt = pg.get_by_role("option", name=re.compile("New Note", re.I))
    opt.first.wait_for(state="visible", timeout=20000)
    pg.keyboard.press("Enter")
    pg.wait_for_url("**/journal/notebook?*note=*", timeout=20000)


def probe(pg, label):
    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=20000)
    pg.wait_for_timeout(500)
    before = pg.evaluate(w13q.FOCUS_DESC_JS)
    # 13Q-2's script called the manual focus command ONCE here too (expected to fail) before
    # bring_to_front -- testing whether that FIRST, failing call is load-bearing for the
    # second one succeeding.
    first_attempt = pg.evaluate("""() => {
      const pm = document.querySelector('.ProseMirror');
      const ed = pm && pm.editor;
      if (!ed) return {error: 'no editor'};
      ed.commands.focus('end');
      return {activeIsPM: document.activeElement === pm};
    }""")
    say(f"[{label}] first attempt (before bring_to_front): {first_attempt}")
    pg.bring_to_front()
    pg.wait_for_timeout(200)
    manual = pg.evaluate("""() => {
      const pm = document.querySelector('.ProseMirror');
      const ed = pm && pm.editor;
      if (!ed) return {error: 'no editor'};
      ed.commands.focus('end');
      return {activeIsPM: document.activeElement === pm, activeTag: document.activeElement && document.activeElement.tagName};
    }""")
    say(f"[{label}] before bring_to_front: {before}  |  manual focus AFTER bring_to_front: {manual}")


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

        # Cell 1: seedctx + click (13Q-2's shape -- expect SUCCESS)
        pg1 = seedctx.new_page()
        create_via_click(pg1)
        probe(pg1, "seedctx + CLICK")
        pg1.close()

        # Cell 2: seedctx + keyboard (same context, different input)
        pg2 = seedctx.new_page()
        create_via_keyboard(pg2)
        probe(pg2, "seedctx + KEYBOARD")
        pg2.close()

        # Cell 3: brand-new context + click (different context, same input as 13Q-2)
        ctx3 = br.new_context(viewport={"width": 1200, "height": 900}, storage_state=state)
        pg3 = ctx3.new_page()
        create_via_click(pg3)
        probe(pg3, "NEW CONTEXT + CLICK")
        ctx3.close()

        # Cell 4: brand-new context + keyboard (run_one's actual shape)
        ctx4 = br.new_context(viewport={"width": 1200, "height": 900}, storage_state=state)
        pg4 = ctx4.new_page()
        create_via_keyboard(pg4)
        probe(pg4, "NEW CONTEXT + KEYBOARD")
        ctx4.close()

        br.close()
finally:
    box.stop(grace_s=60)

(OUT / "RESULT.txt").write_text("\n".join(log), encoding="utf-8")
say(f"\nwritten to {OUT / 'RESULT.txt'}")
