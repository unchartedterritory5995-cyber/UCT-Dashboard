# The desktop b18-hard parts, on the walk probe_hard2.py proved (eight verdicts in 0.5-1.6 s): the same context,
# the same clicks, plus the rig's gold-box shots of the play, verdict and end states. Writes the same files and
# index.json entries as pw_parts.py / capture_hard.py.
import json, os, re, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_parts as R
from capture_hard import PID, STATES, shoot_state, until

idx_path = os.path.join(R.WT, "parts", "index.json")
index = json.load(open(idx_path, encoding="utf-8"))
with sync_playwright() as p:
    b = p.chromium.launch(args=R.A)
    ctx = b.new_context(viewport={"width": 1366, "height": 960}, device_scale_factor=2)
    ctx.add_init_script("window.__uctLogoPhase = 0.55")
    r = ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": R.ENV["EMAIL"], "password": R.ENV["UCT_SANDBOX_PASSWORD"]})
    print("login", r.status)
    page = ctx.new_page()
    page.goto(R.LAB + "65", wait_until="load")
    start = page.get_by_role("button", name=re.compile("Start hard mode")).first
    print("pool ready:", until(lambda: start.count() > 0, 90)); time.sleep(1.5)
    shoot_state(page, "desk", "intro", index)
    start.click(); time.sleep(5)
    cards = page.locator("[data-testid=hard-cards] button")
    print("play ready:", until(lambda: cards.count() >= 4, 60)); time.sleep(2)
    shoot_state(page, "desk", "play", index)
    nxt = page.get_by_test_id("hard-next")
    for i in range(1, 9):
        cards.nth(0).click(); time.sleep(0.5)
        page.get_by_test_id("hard-check").click()
        ok = until(lambda: nxt.count() > 0, 45)
        print(f"round {i}: verdict {'ok' if ok else 'STALLED'}")
        if not ok:
            page.screenshot(path=os.path.join(R.OUT, PID, "stall_desk.png"), full_page=True); break
        if i == 1:
            time.sleep(2.5); shoot_state(page, "desk", "verdict", index)
        nxt.click(); time.sleep(2.5)
    print("end card:", until(lambda: page.locator("[class*=heroWord]").count() > 0 and cards.count() == 0, 20)); time.sleep(2)
    shoot_state(page, "desk", "end", index)
    b.close()
with open(idx_path, "w", encoding="utf-8") as fh:
    json.dump(index, fh, ensure_ascii=False, indent=1)
print("missing:", [f"{k}:{v2}" for k, v in index[PID].items() for v2 in ("desk", "phone") if not v.get(v2)] or "none")
