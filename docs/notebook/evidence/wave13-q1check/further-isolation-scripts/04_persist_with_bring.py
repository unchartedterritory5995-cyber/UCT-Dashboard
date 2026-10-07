"""Diagnostic (13Q-Q1check): persistent single context/page (like a real
member's own tab), but WITH a ONE-TIME bring_to_front() right after the page
is created (before first navigation) -- never repeated for later reps. Creates
5 blank notes in a row on the SAME page. If later reps succeed where rep 1
does not, the defect is specific to a page's first-ever focus-eligible moment,
not a persistent, ongoing one.
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
DATA_DIR = SCRATCH / "q1check-pb-data"
OUT = SCRATCH / "q1check-pb-out"
PORT = 8626
MEMBER = ("w13q1pb@local.dev", "LocalTest2026!", "w13q1pb")
REPS = 5

DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

os.environ.update(w13q.SANDBOX_FLAGS)
os.environ.setdefault("FMP_API_KEY", "")
os.environ.setdefault("FINNHUB_API_KEY", "")
os.environ.setdefault("ALPHAVANTAGE_API_KEY", "")

ACTIVE_ELEMENT_JS = """() => {
  const el = document.activeElement;
  return { tag: el ? el.tagName : null, inPM: !!(el && el.closest && el.closest('.ProseMirror')), hasFocusDoc: document.hasFocus() };
}"""


def main():
    box = h.Sandbox(str(DATA_DIR), PORT, OUT / "sandbox.log")
    base = f"http://127.0.0.1:{PORT}"
    box.start()
    rows = []
    try:
        assert box.wait_healthy(base, 300), "sandbox never healthy"
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True)
            admin = br.new_context()
            ctx = br.new_context(viewport={"width": 1200, "height": 900})
            h._provision(admin.request, ctx.request, base, member=MEMBER)
            pg = ctx.new_page()
            pg.bring_to_front()  # ONCE, before anything else -- never again
            pg.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded", timeout=60000)
            h._dismiss_intro(pg)
            pg.wait_for_timeout(500)

            for rep in range(1, REPS + 1):
                row = {"rep": rep}
                btn = pg.locator('[data-tour="new-note"]').filter(visible=True)
                btn.first.wait_for(state="visible", timeout=20000)
                t0 = time.time()
                btn.first.click()
                pg.wait_for_url("**/journal/notebook?*note=*", timeout=20000)
                readings = []
                for target_ms in (100, 500, 2000):
                    elapsed = (time.time() - t0) * 1000
                    wait_ms = max(0, target_ms - elapsed)
                    if wait_ms:
                        pg.wait_for_timeout(wait_ms)
                    info = pg.evaluate(ACTIVE_ELEMENT_JS)
                    info["t_ms"] = round((time.time() - t0) * 1000, 1)
                    readings.append(info)
                row["readings"] = readings
                row["in_body_at_2s"] = readings[-1]["inPM"]
                print(json.dumps(row), flush=True)
                rows.append(row)
                pg.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded", timeout=60000)
                pg.wait_for_timeout(300)
    finally:
        stop_how = box.stop()
        (OUT / "results.json").write_text(json.dumps({"rows": rows, "stop_how": stop_how}, indent=2), encoding="utf-8")
        print("stop_how:", stop_how, flush=True)
        print("WROTE-PB-DONE", flush=True)


if __name__ == "__main__":
    main()
