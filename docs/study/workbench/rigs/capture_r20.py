# Batch 21 (round 20, the revamp): the chart as the hero, one status line, one prompt line, four pills, one action, a
# plain lesson block, a full stage — captured part by part for the shell with WAITS that watch the page. Same files,
# same index.json entries, same gold box (pw_parts.shoot) as the other rigs. Desk at dsf 2, phone touch.
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_parts as R   # ENV, OUT, LAB, A, WT, locate, shoot

PID = "b21-hard"
CHART = "[data-testid=study-chart]"
STATES = {
    "intro": {"intro": "[data-testid=hard-intro]", "title": "[class*=heroBig]", "medal": "[data-testid=hard-intro] [class*=medalWrap]", "lockup": "[class*=lockup]",
              "start": "[data-testid=hard-start]"},
    "play": {"status": "[class*=hud]", "frame": "[class*=chartHeaderTop]", "chart": CHART, "spotlight": ("region", CHART, 0.55, 0.0, 1.0, 1.0),
             "prompt": "[class*=prompt]", "pills": "[data-testid=hard-cards]", "check": "[data-testid=hard-check]", "hint": "[class*=actionNote]"},
    "verdict": {"verdictLine": "[class*=prompt]", "runon": CHART, "ticker": "[data-testid=sym-label]", "cardcolors": "[data-testid=hard-cards]",
                "lesson": "[data-testid=hard-lesson]", "next": "[data-testid=hard-next]"},
    "end": {"end": "[data-testid=hard-done]", "medalEnd": "[data-testid=hard-done] [class*=medalWrap]", "gems": "[class*=gems]", "runlog": "[data-testid=run-log]"},
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
    for attempt in range(3):
        act(cards.nth(0)); time.sleep(0.6)
        act(page.get_by_test_id("hard-check"))
        if until(lambda: nxt.count() > 0, 60):
            break
        print("   first verdict stalled; reloading for another pool")
        page.reload(wait_until="load")
        until(lambda: start.count() > 0, 90); time.sleep(1.5); act(start)
        until(lambda: cards.count() >= 4, 60); time.sleep(3)
    time.sleep(3.2)
    shoot_state(page, vp_name, "verdict", index)
    act(nxt); until(lambda: cards.count() >= 4, 45); time.sleep(1.5)
    for i in range(2, 9):
        act(cards.nth(0)); time.sleep(0.6)
        act(page.get_by_test_id("hard-check"))
        ok = until(lambda: nxt.count() > 0, 75)
        time.sleep(2.2)
        if not ok:
            print("   stalled at chart", i); break
        # a chart whose reveal carries no lesson leaves the lesson part empty: take it on the first later chart that has one
        if not index.get(PID, {}).get("lesson", {}).get(vp_name) and page.locator("[data-testid=hard-lesson]").count() > 0:
            time.sleep(0.8)
            try:
                loc, region = R.locate(page, STATES["verdict"]["lesson"])
                if R.shoot(page, loc, region, os.path.join(R.OUT, PID, f"lesson__{vp_name}.png")):
                    index.setdefault(PID, {}).setdefault("lesson", {"desk": None, "phone": None, "note": ""})[vp_name] = f"parts/{PID}/lesson__{vp_name}.png"
                    print("   lesson taken on chart", i)
            except Exception as e:
                print("   lesson retry failed:", str(e)[:60])
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
    hint = index[PID].get("hint")
    if hint is not None and not hint.get("phone"):
        hint["note"] = "desktop only: a phone has no keyboard, so the hint is not shown there"
    missing = [f"{k}:{v2}" for k, v in index[PID].items() for v2 in ("desk", "phone") if not v.get(v2) and not (k == "hint" and v2 == "phone")]
    print("missing:", missing or "none")
