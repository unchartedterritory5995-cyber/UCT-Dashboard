"""v4: run the EXACT body of `_trade_row` inline with per-iteration prints, to see
why it reports count()==0 throughout its 20s loop when an identical locator built
a moment later reports count()==1 on the SAME page.
"""
import os
import re
import sys
import time
from pathlib import Path
from datetime import date, timedelta

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w13q3")
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402

DATA_DIR = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q6-q13-diag\data4")
PORT = 8627
OUT = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\q6-q13-diag\out4")
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
        for t in w13q.SEED_TITLES:
            req.post(base + "/api/j2/notes", data={"title": t, "bodyJson": w13q._doc(f"{t} -- seeded body.")})
        d = (date.today() - timedelta(days=3)).isoformat()
        req.post(base + "/api/j2/trades", data={"symbol": "CRWD", "side": "Long", "shares": 50,
                 "entryPrice": 300, "entryDate": d, "exitPrice": 320, "exitDate": d, "originalStop": 290})
        r = req.post(base + "/api/j2/notes", data={"title": "Q6 diag note v4", "ticker": "CRWD",
                     "bodyJson": w13q._doc("x")})
        nid = r.json()["note"]["id"]
        state = seedctx.storage_state()

        vp = {"width": 390, "height": 844}
        ctx = br.new_context(viewport=vp, has_touch=True, is_mobile=True,
                             reduced_motion="reduce", storage_state=state)
        pg = ctx.new_page()
        pg.bring_to_front()
        w13q.open_note_start(w13q.Ctx(base=base, req=req), pg, nid)
        pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur() }")
        trades = pg.get_by_role("link", name=re.compile(r"^Trades")).filter(visible=True)
        trades.first.click()
        pg.wait_for_timeout(1500)
        closed = pg.get_by_role("button", name=re.compile(r"Closed", re.I)).filter(visible=True)
        if closed.count() == 0:
            closed = pg.get_by_role("tab", name=re.compile(r"Closed", re.I)).filter(visible=True)
        closed.first.click()
        pg.wait_for_timeout(2000)
        say(f"settled, url={pg.url}")

        sym = "CRWD"
        row = pg.locator("tr", has_text=sym).filter(visible=True)
        alt = pg.locator("a, button, [role=button], [role=row], li", has_text=re.compile(rf"{sym}")).filter(visible=True)
        say(f"row selector: {row}")
        say(f"alt selector: {alt}")
        end = time.time() + 6
        it = 0
        while time.time() < end:
            it += 1
            rc = row.count()
            ac = alt.count()
            say(f"  iter {it}: row.count()={rc}  alt.count()={ac}")
            if rc or ac:
                say("  -> WOULD RETURN HERE")
                break
            pg.wait_for_timeout(400)
        ctx.close()
        br.close()
finally:
    box.stop(grace_s=60)

(OUT / "RESULT.txt").write_text("\n".join(log), encoding="utf-8")
say(f"\nwritten to {OUT / 'RESULT.txt'}")
