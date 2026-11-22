# Batch 19 (round 18): the Hard mode rebuilt on the Study UI kit, captured part by part for the shell with WAITS that
# watch the page (the sandbox's attempt writes take 1-15 s). Same files, same index.json entries, same gold box
# (pw_parts.shoot) as the other rigs; the selectors are the kit's (pages/study/ui/study.module.css classes keep their
# names inside the hashed class) and the component's test ids. Desk at dsf 2 (the walk probe_hard2 proved), phone touch.
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_parts as R   # ENV, OUT, LAB, A, WT, locate, shoot

PID = "b19-hard"
CHART = "[data-testid=challenge-chart]"
STATES = {
    "intro": {"intro": "[class*=stageCard]", "toggles": "[class*=toggles]", "crowns": "[class*=stageCard] [class*=crowns]", "start": "[data-testid=hard-start]"},
    "play": {"hud": "[class*=hud]", "segs": "[class*=segs]", "bubble": "[class*=bubble]", "chip": "[class*=qLine]", "frame": "[class*=chartHeaderTop]",
             "tfbar": "[class*=tfBar]", "chart": CHART, "pointer": ("region", CHART, 0.55, 0.0, 1.0, 1.0), "cards": "[data-testid=hard-cards]",
             "check": "[data-testid=hard-check]", "footer": "[class*=footer]"},
    "verdict": {"stamp": "[class*=stampWrap]", "runon": CHART, "ticker": "[data-testid=sym-label]", "lesson": "[data-testid=hard-lesson]",
                "cardcolors": "[data-testid=hard-cards]", "next": "[data-testid=hard-next]", "bubbleVerdict": "[class*=bubble]"},
    "end": {"end": "[data-testid=hard-done]", "crownsEnd": "[data-testid=hard-done] [class*=crowns]", "gems": "[class*=gems]"},
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
    try:
        page.mouse.move(2, 300)   # off the chart: no crosshair in the pictures
    except Exception:
        pass
    time.sleep(0.4)
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
    start = page.get_by_test_id("hard-start")
    print("   pool ready:", until(lambda: start.count() > 0 and "Start hard mode" in start.inner_text(), 90)); time.sleep(1.5)
    shoot_state(page, vp_name, "intro", index)
    act(start)
    cards = page.locator("[data-testid=hard-cards] button")
    print("   play ready:", until(lambda: cards.count() >= 4, 60)); time.sleep(3)
    shoot_state(page, vp_name, "play", index)
    nxt = page.get_by_test_id("hard-next")
    # a recent chart's attempt can hang on the sandbox (no Massive key: the reveal's intraday fetch falls to a slow
    # yfinance); a stall on the first chart reloads for a reshuffled pool, up to three times
    for attempt in range(3):
        act(cards.nth(0)); time.sleep(0.6)
        act(page.get_by_test_id("hard-check"))
        if until(lambda: nxt.count() > 0, 60):
            break
        print("   first verdict stalled; reloading for another pool")
        page.reload(wait_until="load")
        until(lambda: start.count() > 0, 90); time.sleep(1.5); act(start)
        until(lambda: cards.count() >= 4, 60); time.sleep(3)
    time.sleep(3.2)                                      # the stamp lands, the run-on arrives, the badge reveals
    shoot_state(page, vp_name, "verdict", index)
    act(nxt); until(lambda: cards.count() >= 4, 45); time.sleep(1.5)
    for i in range(2, 9):
        act(cards.nth(0)); time.sleep(0.6)
        act(page.get_by_test_id("hard-check"))
        ok = until(lambda: nxt.count() > 0, 75)
        time.sleep(2.2)
        if not ok:
            print("   stalled at chart", i); break
        act(nxt)
        if i < 8:
            until(lambda: cards.count() >= 4, 45); time.sleep(1.2)
    print("   end card:", until(lambda: page.get_by_test_id("hard-done").count() > 0, 20)); time.sleep(2.4)
    shoot_state(page, vp_name, "end", index)
    ctx.close()


if __name__ == "__main__":
    idx_path = os.path.join(R.WT, "parts", "index.json")
    index = json.load(open(idx_path, encoding="utf-8"))
    os.makedirs(os.path.join(R.OUT, PID), exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(args=R.A)
        for vp_name, vp, dsf, touch in (("desk", {"width": 1366, "height": 960}, 2, False), ("phone", {"width": 390, "height": 844}, 2, True)):
            if ONLY and ONLY != vp_name:
                continue
            run(b, vp_name, vp, dsf, touch, index)
        b.close()
    with open(idx_path, "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=1)
    missing = [f"{k}:{v2}" for k, v in index[PID].items() for v2 in ("desk", "phone") if not v.get(v2)]
    print("missing:", missing or "none")
