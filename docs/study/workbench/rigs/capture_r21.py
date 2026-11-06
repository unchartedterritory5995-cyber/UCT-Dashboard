# Batch 22 (round 21, the owner's batch-21 ranks applied): every part of Hard mode captured for the shell, desk at dsf 2,
# phone touch, with WAITS that watch the page. Same files, same index.json shape, same gold box (pw_parts.shoot) as the
# other rigs. New this round: the pointer (the callout layer), the run-on to the culmination with its gold label, the
# coach's card on a chart that fired and on one where nothing did, the score ring and the stat cards.
# Usage: python capture_r21.py [desk|phone]
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_parts as R   # ENV, OUT, LAB, A, WT, locate, shoot

PID = "b22-hard"
CHART = "[data-testid=study-chart]"
STATES = {
    "intro": {"intro": "[data-testid=hard-intro]", "title": "[data-testid=hard-intro] [class*=titleMetal]",
              "medal": "[data-testid=hard-intro] [class*=medalWrap]", "rules": "[class*=rules]", "start": "[data-testid=hard-start]"},
    "play": {"status": "[class*=status]", "frame": "[class*=chartHeaderTop]", "chart": CHART,
             "pointer": ("region", CHART, 0.42, 0.0, 1.0, 0.86), "prompt": "[class*=prompt]", "pills": "[data-testid=hard-cards]",
             "check": "[data-testid=hard-check]"},
    "verdict": {"verdictLine": "[class*=prompt]", "runon": CHART, "ticker": "[data-testid=sym-label]",
                "cardcolors": "[data-testid=hard-cards]", "lesson": "[data-testid=hard-lesson]", "next": "[data-testid=hard-next]"},
    "end": {"end": "[data-testid=hard-done]", "score": "[data-testid=hard-done] [class*=art]", "stats": "[class*=stats]",
            "runlog": "[data-testid=run-log]"},
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


def rec(index, part_id, vp_name, path):
    r = index.setdefault(PID, {}).setdefault(part_id, {"desk": None, "phone": None, "note": ""})
    r[vp_name] = path


def shoot_one(page, vp_name, part_id, part, index):
    path = os.path.join(R.OUT, PID, f"{part_id}__{vp_name}.png")
    try:
        loc, region = R.locate(page, part)
        loc.scroll_into_view_if_needed(timeout=5000)
        time.sleep(0.5)
        if R.shoot(page, loc, region, path):
            rec(index, part_id, vp_name, f"parts/{PID}/{part_id}__{vp_name}.png")
            return True
    except Exception as e:
        print(f"   part failed {part_id} {vp_name}: {str(e)[:80]}")
    return False


def shoot_state(page, vp_name, state, index):
    try:
        page.mouse.move(2, 300)   # off the chart: no crosshair in the pictures
    except Exception:
        pass
    page.evaluate("window.scrollTo(0, 0)")
    time.sleep(0.4)
    for part_id, part in STATES[state].items():
        shoot_one(page, vp_name, part_id, part, index)


def run(b, vp_name, vp, dsf, touch, index):
    ctx = b.new_context(viewport=vp, device_scale_factor=dsf, is_mobile=touch, has_touch=touch)
    ctx.add_init_script("window.__uctLogoPhase = 0.55")
    r = ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": R.ENV["EMAIL"], "password": R.ENV["UCT_SANDBOX_PASSWORD"]})
    print(f"== {vp_name}: login {r.status}")
    page = ctx.new_page()
    act = (lambda loc: loc.tap()) if touch else (lambda loc: loc.click())
    page.goto(R.LAB + "65", wait_until="load")
    start = page.get_by_test_id("hard-start")
    print("   pool ready:", until(lambda: start.count() > 0 and start.inner_text().strip().lower().startswith("start"), 120)); time.sleep(1.8)
    shoot_state(page, vp_name, "intro", index)
    act(start)
    cards = page.locator("[data-testid=hard-cards] button")
    nxt = page.get_by_test_id("hard-next")
    print("   play ready:", until(lambda: cards.count() >= 4, 60)); time.sleep(3)
    shoot_state(page, vp_name, "play", index)
    got_fired = got_none = False
    done = page.get_by_test_id("hard-done")
    for i in range(1, 17):          # until the end stage: a reload after a stall starts a fresh run of eight
        # chart 1 names the first pill; charts 2-5 (and later ones until a nothing-fired chart comes up) say "Nothing
        # fired", so both kinds of lesson card come up
        pick = 0
        if i >= 2 and (i <= 5 or not got_none):   # keep saying it until a chart where nothing fired comes up
            texts = [cards.nth(k).inner_text() for k in range(cards.count())]
            pick = next((k for k, t in enumerate(texts) if "Nothing fired" in t), 0)
        act(cards.nth(pick)); time.sleep(0.6)
        act(page.get_by_test_id("hard-check"))
        if not until(lambda: nxt.count() > 0, 150):
            # the sandbox's background jobs can starve one answer: start a fresh run and keep the parts already taken
            print("   stalled at chart", i, "- reloading for a fresh run")
            page.reload(wait_until="load")
            until(lambda: start.count() > 0 and start.inner_text().strip().lower().startswith("start"), 120); time.sleep(1.5)
            act(start)
            until(lambda: cards.count() >= 4, 60); time.sleep(2)
            act(cards.nth(0)); time.sleep(0.6)
            act(page.get_by_test_id("hard-check"))
            if not until(lambda: nxt.count() > 0, 150):
                print("   stalled again at chart", i); break
        # the run-on is done when the page says so (every forward bar in, the culmination label placed)
        until(lambda: page.locator("[data-testid=hard-question][data-run=done]").count() > 0, 40)
        time.sleep(1.6)
        if i == 1:
            shoot_state(page, vp_name, "verdict", index)
        lesson = page.locator("[data-testid=hard-lesson]")
        if lesson.count() > 0:
            title = lesson.locator("h3").first.inner_text()
            if "nothing fired" in title.lower() and not got_none:
                got_none = shoot_one(page, vp_name, "lessonNone", "[data-testid=hard-lesson]", index)
                shoot_one(page, vp_name, "runonNone", CHART, index)
                print("   nothing-fired lesson on chart", i, got_none)
            elif "why it" in title.lower() and not got_fired and i > 1:
                got_fired = shoot_one(page, vp_name, "lessonFired", "[data-testid=hard-lesson]", index)
                print("   fired lesson on chart", i, got_fired)
        page.evaluate("window.scrollTo(0, 0)")
        act(nxt)
        until(lambda: done.count() > 0 or (cards.count() >= 4 and page.get_by_test_id("hard-check").count() > 0), 45)
        if done.count() > 0:
            break
        time.sleep(1.4)
    print("   end stage:", until(lambda: page.get_by_test_id("hard-done").count() > 0, 20)); time.sleep(2.6)
    shoot_state(page, vp_name, "end", index)
    ctx.close()


def run_none(b, vp_name, vp, dsf, touch, index, runs=4):
    """Only the two nothing-fired parts: say "Nothing fired" on every chart until a chart where nothing fired comes up
    (starting a fresh run when one ends), shoot the coach card and the run-on there, and stop."""
    ctx = b.new_context(viewport=vp, device_scale_factor=dsf, is_mobile=touch, has_touch=touch)
    ctx.add_init_script("window.__uctLogoPhase = 0.55")
    ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": R.ENV["EMAIL"], "password": R.ENV["UCT_SANDBOX_PASSWORD"]})
    page = ctx.new_page()
    act = (lambda loc: loc.tap()) if touch else (lambda loc: loc.click())
    page.goto(R.LAB + "65", wait_until="load")
    start = page.get_by_test_id("hard-start")
    cards = page.locator("[data-testid=hard-cards] button")
    nxt = page.get_by_test_id("hard-next")
    done = page.get_by_test_id("hard-done")
    for r in range(runs):
        until(lambda: start.count() > 0 and start.inner_text().strip().lower().startswith("start"), 120); time.sleep(1.5)
        act(start)
        for i in range(8):
            until(lambda: cards.count() >= 4 and page.get_by_test_id("hard-check").count() > 0, 60); time.sleep(1.2)
            texts = [cards.nth(k).inner_text() for k in range(cards.count())]
            act(cards.nth(next((k for k, t in enumerate(texts) if "Nothing fired" in t), 0))); time.sleep(0.5)
            act(page.get_by_test_id("hard-check"))
            if not until(lambda: nxt.count() > 0, 150):
                print("   stalled"); break
            until(lambda: page.locator("[data-testid=hard-question][data-run=done]").count() > 0, 40); time.sleep(1.6)
            lesson = page.locator("[data-testid=hard-lesson]")
            if lesson.count() > 0 and "nothing fired" in lesson.locator("h3").first.inner_text().lower():
                page.mouse.move(2, 300)
                ok1 = shoot_one(page, vp_name, "lessonNone", "[data-testid=hard-lesson]", index)
                ok2 = shoot_one(page, vp_name, "runonNone", CHART, index)
                print(f"   nothing-fired parts on run {r + 1} chart {i + 1}: {ok1} {ok2}")
                ctx.close()
                return True
            page.evaluate("window.scrollTo(0, 0)")
            act(nxt)
            until(lambda: done.count() > 0 or cards.count() >= 4, 45)
            if done.count() > 0:
                break
        if done.count() > 0:
            act(page.get_by_test_id("hard-again"))
    ctx.close()
    return False


if __name__ == "__main__":
    idx_path = os.path.join(R.WT, "parts", "index.json")
    index = json.load(open(idx_path, encoding="utf-8"))
    os.makedirs(os.path.join(R.OUT, PID), exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(args=R.A)
        for vp_name, vp, dsf, touch in (("desk", {"width": 1366, "height": 960}, 2, False), ("phone", {"width": 390, "height": 844}, 2, True)):
            if ONLY and ONLY.split("-")[0] != vp_name:
                continue
            if ONLY and ONLY.endswith("-none"):
                run_none(b, vp_name, vp, dsf, touch, index)
            else:
                run(b, vp_name, vp, dsf, touch, index)
        b.close()
    # re-read before writing: the other viewport may have written in between
    fresh = json.load(open(idx_path, encoding="utf-8"))
    for part_id, r in index.get(PID, {}).items():
        dst = fresh.setdefault(PID, {}).setdefault(part_id, {"desk": None, "phone": None, "note": ""})
        for v in ("desk", "phone"):
            if r.get(v):
                dst[v] = r[v]
    with open(idx_path, "w", encoding="utf-8") as fh:
        json.dump(fresh, fh, ensure_ascii=False, indent=1)
    want = ["intro", "title", "medal", "rules", "start", "status", "frame", "chart", "pointer", "prompt", "pills", "check",
            "verdictLine", "runon", "ticker", "cardcolors", "lesson", "next", "lessonFired", "lessonNone", "runonNone",
            "end", "score", "stats", "runlog"]
    have = fresh.get(PID, {})
    missing = [f"{k}:{v}" for k in want for v in ("desk", "phone") if not (have.get(k) or {}).get(v) and (not ONLY or v == ONLY.split("-")[0])]
    print("missing:", missing or "none")
