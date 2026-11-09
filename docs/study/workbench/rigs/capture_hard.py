# The b18-hard parts, captured with WAITS that watch the page instead of fixed sleeps: the sandbox's skill sessions
# and attempt writes take 1-15 s after a restart, and the generic rig (pw_parts.py) clicked Start before the pool
# was there and shot the verdict before it arrived. Same files, same index.json entries, same gold box (shoot).
import json, os, re, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_parts as R   # ENV, OUT, LAB, A, START, CHART, CHART_RIGHT, locate, shoot

PID = "b18-hard"
STATES = {
    "intro": {"intro": R.START, "crowns": "[class*=crownRow]", "hidden": ("nth", "[class*=gem]", 0)},
    "play": {"topbar": "[class*=topbar]", "bubble": "[class*=ask]", "chip": "[class*=qLine]", "chart": R.CHART, "pointer": R.CHART_RIGHT,
             "cards": "[data-testid=hard-cards]", "check": "[data-testid=hard-check]"},
    "verdict": {"stamp": "[class*=stamp]", "runon": R.CHART, "ticker": "[class*=qLine]", "lesson": "details[class*=whyCard]",
                "cardcolors": "[data-testid=hard-cards]", "next": "[data-testid=hard-next]"},
    "end": {"end": R.START, "crownsEnd": "[class*=crownRow]"},
}
ONLY = sys.argv[1] if len(sys.argv) > 1 else None


def until(fn, secs, step=0.5):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            if fn():
                return True
        except Exception:
            pass
        time.sleep(step)
    return False


def shoot_state(page, vp_name, state, index):
    for part_id, part in STATES[state].items():
        path = os.path.join(R.OUT, PID, f"{part_id}__{vp_name}.png")
        try:
            loc, region = R.locate(page, part)
            ok = R.shoot(page, loc, region, path)
        except Exception as e:
            ok = False
            print(f"   part failed {state}/{part_id} {vp_name}: {str(e)[:70]}")
        rec = index.setdefault(PID, {}).setdefault(part_id, {"desk": None, "phone": None, "note": ""})
        if ok:
            rec[vp_name] = f"parts/{PID}/{part_id}__{vp_name}.png"


def run(b, vp_name, vp, dsf, touch, index):
    ctx = b.new_context(viewport=vp, device_scale_factor=dsf, is_mobile=touch, has_touch=touch)
    ctx.add_init_script("window.__uctLogoPhase = 0.55")
    r = ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": R.ENV["EMAIL"], "password": R.ENV["UCT_SANDBOX_PASSWORD"]})
    print(f"== {vp_name}: login {r.status}")
    page = ctx.new_page()
    act = (lambda loc: loc.tap()) if touch else (lambda loc: loc.click())
    page.goto(R.LAB + "65", wait_until="load")
    start = page.get_by_role("button", name=re.compile("Start hard mode")).first
    print("   pool ready:", until(lambda: start.count() > 0, 90)); time.sleep(1.5)
    shoot_state(page, vp_name, "intro", index)
    act(start)
    cards = page.locator("[data-testid=hard-cards] button")
    print("   play ready:", until(lambda: cards.count() >= 4, 60)); time.sleep(2.5)
    shoot_state(page, vp_name, "play", index)
    nxt = page.get_by_test_id("hard-next")
    # a recent chart's attempt can hang on the sandbox (no Massive key: the reveal's intraday fetch falls to a slow
    # yfinance); a stall on the first chart reloads for a reshuffled pool, up to three times
    for attempt in range(3):
        act(cards.nth(0)); time.sleep(0.5)
        act(page.get_by_test_id("hard-check"))
        if until(lambda: nxt.count() > 0, 60):
            break
        print("   first verdict stalled; reloading for another pool")
        page.reload(wait_until="load")
        until(lambda: start.count() > 0, 90); time.sleep(1.5); act(start)
        until(lambda: cards.count() >= 4, 60); time.sleep(2.5)
    time.sleep(2.5)
    shoot_state(page, vp_name, "verdict", index)
    act(nxt); until(lambda: cards.count() >= 4, 45); time.sleep(1.5)
    for i in range(2, 9):
        act(cards.nth(0)); time.sleep(0.5)
        act(page.get_by_test_id("hard-check"))
        ok = until(lambda: nxt.count() > 0, 75)
        time.sleep(2.5)                                  # the run-on and the stamp settle
        if not ok:
            print("   stalled at chart", i); break
        act(nxt)
        if i < 8:
            until(lambda: cards.count() >= 4, 45); time.sleep(1.5)
    print("   end card:", until(lambda: page.locator("[class*=heroWord]").count() > 0 and cards.count() == 0, 20)); time.sleep(2)
    shoot_state(page, vp_name, "end", index)
    ctx.close()


if __name__ == "__main__":
    idx_path = os.path.join(R.WT, "parts", "index.json")
    index = json.load(open(idx_path, encoding="utf-8"))
    with sync_playwright() as p:
        b = p.chromium.launch(args=R.A)
        for vp_name, vp, dsf, touch in (("desk", {"width": 1366, "height": 960}, 1, False), ("phone", {"width": 390, "height": 844}, 2, True)):
            if ONLY and ONLY != vp_name:
                continue
            run(b, vp_name, vp, dsf, touch, index)
        b.close()
    with open(idx_path, "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=1)
    missing = [f"{k}:{v2}" for k, v in index[PID].items() for v2 in ("desk", "phone") if not v.get(v2)]
    print("missing:", missing or "none")
