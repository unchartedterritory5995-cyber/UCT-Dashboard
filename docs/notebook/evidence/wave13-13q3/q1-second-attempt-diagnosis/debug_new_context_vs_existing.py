"""Does bring_to_front() behave differently for a page in a BRAND NEW BrowserContext
(what run_one does per row) vs a page in an ALREADY-ESTABLISHED context (what 13Q-2's
successful diagnosis script used -- seedctx, alive since before this page was created)?
"""
import os
import sys
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q3")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

DATA_DIR = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q1-bring-front-timing\data2")
PORT = 8627
OUT = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q1-bring-front-timing\out2")
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


def check_body_focus(pg):
    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=60000)
    pg.wait_for_timeout(500)
    return pg.evaluate(w13q.FOCUS_DESC_JS)


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

        # (A) NEW page in the EXISTING seedctx (13Q-2's successful shape)
        pg_a = seedctx.new_page()
        pg_a.bring_to_front()
        pg_a.goto(base + "/journal/notebook?new=blank", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(pg_a)
        say(f"(A) existing seedctx, new page, bring_to_front before nav: {check_body_focus(pg_a)}")
        pg_a.close()

        # (B) brand-new CONTEXT (run_one's actual shape)
        ctx_b = br.new_context(viewport={"width": 1200, "height": 900}, storage_state=state)
        pg_b = ctx_b.new_page()
        pg_b.bring_to_front()
        pg_b.goto(base + "/journal/notebook?new=blank", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(pg_b)
        say(f"(B) BRAND NEW context, new page, bring_to_front before nav: {check_body_focus(pg_b)}")
        ctx_b.close()

        # (C) brand-new context, but ALSO bring_to_front AFTER nav, AND once more right
        #     before the check (maximal effort)
        ctx_c = br.new_context(viewport={"width": 1200, "height": 900}, storage_state=state)
        pg_c = ctx_c.new_page()
        pg_c.bring_to_front()
        pg_c.goto(base + "/journal/notebook?new=blank", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(pg_c)
        pg_c.bring_to_front()
        pg_c.wait_for_timeout(300)
        pg_c.bring_to_front()
        say(f"(C) BRAND NEW context, bring_to_front x3: {check_body_focus(pg_c)}")
        ctx_c.close()

        br.close()
finally:
    box.stop(grace_s=60)

(OUT / "RESULT.txt").write_text("\n".join(log), encoding="utf-8")
say(f"\nwritten to {OUT / 'RESULT.txt'}")
