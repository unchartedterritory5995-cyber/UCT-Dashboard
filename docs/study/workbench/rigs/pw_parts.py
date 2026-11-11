# THE PART CAPTURE RIG (owner, 2026-11-04: "each category or object or area one at a time with images or highlights
# of that feature so I know directly what the lingo is referring to"). For every piece in batches 13-15, walks the
# piece through its states (start, play, verdict, ...) and, for every listed part, screenshots the viewport with a
# GOLD BOX around that part. Desktop and phone. Writes walkthrough/parts/<piece>/<part>__<vp>.png and
# walkthrough/parts/index.json ({piece: {part: {desk: path|null, phone: path|null, note}}}).
# Usage: python pw_parts.py [pieceId ...]   (no args = every piece that has a config)
import json, os, re, sys, time, io
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.join(HERE, "walkthrough")
OUT = os.path.join(WT, "parts")
ENV = json.load(open(os.path.join(HERE, "sandbox_env.json")))
LAB = "http://127.0.0.1:5232/lab.html?piece="
A = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
GOLD = (220, 187, 94, 255)

# A step: ("click", selector_or_role_regex) · ("tap_chart", fx, fy) · ("wait", seconds) · ("key", key) · ("eval", js)
# A part: selector string, or ("nth", selector, n), or ("region", selector, x0, y0, x1, y1) (fractions of the element)
# A piece config: {"url": piece number, "pre": [steps before load], "states": [ {"id", "steps", "parts": {partId: part}} ],
#                  "notes": {partId: "why there is no image"}}
CHART_RIGHT = ("region", "[class*=chartBox], [data-testid=challenge-chart]", 0.55, 0.0, 1.0, 1.0)
CHART_LEFT = ("region", "[class*=chartBox], [data-testid=challenge-chart]", 0.0, 0.0, 0.42, 1.0)
CHART = "[class*=chartBox], [data-testid=challenge-chart]"
START = "[class*=startCard]"

CONFIG = {
  # ── batch 17: the drill after the owner's batch-16 notes ──
  # ── batch 18: Hard mode, in the product (plan piece 43; the name-enter-stop lab version waits on the levels rulings) ──
  "b18-hard": {"url": 65, "states": [
    {"id": "intro", "steps": [("wait", 7)], "parts": {"intro": START, "crowns": "[class*=crownRow]", "hidden": ("nth", "[class*=gem]", 0)}},
    {"id": "play", "steps": [("click", "role:Start hard mode"), ("wait", 6)], "parts": {"topbar": "[class*=topbar]", "bubble": "[class*=ask]", "chip": "[class*=qLine]", "chart": CHART, "pointer": CHART_RIGHT, "cards": "[data-testid=hard-cards]", "check": "[data-testid=hard-check]"}},
    {"id": "verdict", "steps": [("click", ("nth", "[data-testid=hard-cards] button", 0)), ("click", "[data-testid=hard-check]"), ("wait", 9)], "parts": {"stamp": "[class*=stamp]", "runon": CHART, "ticker": "[class*=qLine]", "lesson": "details[class*=whyCard]", "cardcolors": "[data-testid=hard-cards]", "next": "[data-testid=hard-next]"}},
    {"id": "end", "steps": [("click", "[data-testid=hard-next]"), ("wait", 2.5)] + 6 * [("click", ("nth", "[data-testid=hard-cards] button", 0)), ("click", "[data-testid=hard-check]"), ("wait", 8), ("click", "[data-testid=hard-next]"), ("wait", 2.5)] + [("click", ("nth", "[data-testid=hard-cards] button", 0)), ("click", "[data-testid=hard-check]"), ("wait", 8), ("click", "[data-testid=hard-next]"), ("wait", 3.5)], "parts": {"end": START, "crownsEnd": "[class*=crownRow]"}},
  ]},
  "b17-drill": {"url": "64&set=free", "states": [
    {"id": "ask", "steps": [("wait", 9)], "parts": {"bubble": "[class*=ask]", "facts": "[class*=qLine]", "journey": "[data-testid=progress-strip]", "chart": "[class*=chartBox]", "pointer": ("region", "[class*=chartBox]", 0.55, 0.0, 1.0, 1.0), "cards": "[class*=choices]", "check": "[data-testid=primary-action]"}},
    {"id": "verdict", "steps": [("click", ("nth", "[role=radio]", 0)), ("click", "[data-testid=primary-action]"), ("wait", 4)], "parts": {"takeover": ("region", "[data-testid=reveal-takeover]", 0.0, 0.0, 1.0, 0.42), "answer": "[class*=answer]", "lesson": "[data-testid=reveal-card]", "continue": "[data-testid=primary-action]"}},
    {"id": "end", "steps": [("click", "[data-testid=primary-action]"), ("wait", 2), ("drill_finish",), ("wait", 2)], "parts": {"end": "[data-testid=end-card]"}},
  ]},
  # ── batch 16: the daily drill itself (the real member DrillPlayer on a fresh free set) ──
  "b16-drill": {"url": "64&set=free", "states": [
    {"id": "ask", "steps": [("wait", 9)], "parts": {"bubble": "[class*=ask]", "chip": "[class*=qLine], [class*=framing]", "prog": "[class*=prog]", "chart": "[class*=chartBox]", "pointer": ("region", "[class*=chartBox]", 0.55, 0.0, 1.0, 1.0), "cards": "[class*=choices]", "check": "[data-testid=primary-action]"}},
    {"id": "verdict", "steps": [("click", ("nth", "[role=radio]", 0)), ("click", "[data-testid=primary-action]"), ("wait", 4)], "parts": {"stamp": "[class*=stamp]", "runon": "[class*=chartBox]", "cardcolors": "[class*=choices]", "reveal": "[data-testid=reveal-card]"}},
    {"id": "end", "steps": [("click", "[data-testid=primary-action]"), ("wait", 2), ("drill_finish",), ("wait", 2)], "parts": {"end": "[data-testid=end-card]"}},
  ]},
  # ── batch 15: the product ──
  "b15-blitz": {"url": 61, "states": [
    {"id": "start", "steps": [("wait", 7)], "parts": {"start": START, "bank": "[class*=startBtn] small", "how": "details[class*=whyCard]", "close": "[class*=close]"}},
    {"id": "play", "steps": [("click", "role:Start the clock"), ("wait", 5)], "parts": {"clock": "[data-testid=blitz-clock]", "points": "[class*=topbar]", "qchip": "[class*=qLine]", "chart": CHART, "pointer": CHART_RIGHT, "cards": "[data-testid=blitz-choices]"}},
    {"id": "flash", "steps": [("click", "[data-testid=blitz-choices] button"), ("wait", 0.12)], "parts": {"flash": "[data-testid=blitz-play]"}},
    {"id": "end", "steps": [("wait", 58)], "parts": {"end": START, "log": "[class*=runLog]"}},
  ]},
  "b15-boss": {"url": 62, "states": [
    {"id": "intro", "steps": [("wait", 7)], "parts": {"intro": START, "heart": "[class*=heartBig]"}},
    {"id": "play", "steps": [("click", "role:Face the boss"), ("wait", 5)], "parts": {"bubble": "[class*=ask]", "chart": CHART, "cards": "[class*=cards]", "check": "[data-testid=boss-check]"}},
    {"id": "verdict", "steps": [("click", ("nth", "[class*=cards] button", 0)), ("click", "[data-testid=boss-check]"), ("wait", 4)], "parts": {"stamp": "[class*=stamp]", "runon": CHART, "lesson": "details[class*=whyCard]", "next": "[data-testid=boss-next]", "heart": "[class*=bossTop]"}},
    {"id": "fail", "steps": [("click", "[data-testid=boss-next]"), ("wait", 3), ("click", ("nth", "[class*=cards] button", 1)), ("click", "[data-testid=boss-check]"), ("wait", 3), ("click", "[data-testid=boss-next]"), ("wait", 2)], "parts": {"fail": START}},
  ], "notes": {"win": "no image: needs ten right in a row on the live bank"}},
  "b15-kicker": {"url": 63, "states": [
    {"id": "start", "steps": [("wait", 7)], "parts": {"start": START}},
    {"id": "play", "steps": [("click", "role:^Start"), ("wait", 6)], "parts": {"bubble": "[class*=ask]", "gold": CHART, "chips": CHART_RIGHT, "tapchart": CHART, "cards": "[data-testid=kicker-cards]", "check": "[data-testid=kicker-check]"}},
    {"id": "verdict", "steps": [("click", ("last", "[data-testid=kicker-cards] button")), ("click", "[data-testid=kicker-check]"), ("wait", 5)], "parts": {"rules": "[data-testid=kicker-cards]", "stamp": "[class*=stamp]", "runon": CHART, "next": "[data-testid=kicker-next]"}},
    {"id": "end", "steps": [("click", "[data-testid=kicker-next]"), ("wait", 4), ("click", ("last", "[data-testid=kicker-cards] button")), ("click", "[data-testid=kicker-check]"), ("wait", 4), ("click", "[data-testid=kicker-next]"), ("wait", 4), ("click", ("last", "[data-testid=kicker-cards] button")), ("click", "[data-testid=kicker-check]"), ("wait", 4), ("click", "[data-testid=kicker-next]"), ("wait", 3)], "parts": {"end": START}},
  ]},
  # ── batch 14 ──
  "b14-logo": {"url": 52, "states": [
    {"id": "one", "steps": [("wait", 6)], "parts": {"shape": "[class*=coinStage]", "edges": "[class*=coinStage]", "light": "[class*=coinStage]", "glow": "[class*=coinStage]", "turn": "[class*=coinStage]", "throb": "[class*=coinStage]",
      "idle": ("nth", "[class*=coinCell]", 0), "think": ("nth", "[class*=coinCell]", 1), "happy": ("nth", "[class*=coinCell]", 2), "oops": ("nth", "[class*=coinCell]", 3), "fire": ("nth", "[class*=coinCell]", 4), "small": ("nth", "[class*=coinRow]", 1)}},
  ]},
  "b14-landing": {"url": 60, "states": [
    {"id": "one", "steps": [("wait", 6)], "parts": {"mark": ("region", "[class*=hero]", 0.0, 0.0, 0.2, 0.75), "herotext": "[class*=heroText]", "trail": "figure", "stations": ("nth", "[class*=deck]", 0), "found": ("nth", "[class*=deck]", 1), "chal": ("nth", "[class*=deck]", 2), "badges": "[class*=shelf]", "phone": "section"}},
  ]},
  # ── batch 13: the workbench versions ──
  "b13-logo": {"url": 52, "states": [
    {"id": "one", "steps": [("wait", 6)], "parts": {"shape": "[class*=coinStage]", "edges": "[class*=coinStage]", "move": "[class*=coinStage]", "glow": ("nth", "[class*=coinCell]", 2), "speed": ("nth", "[class*=coinCell]", 4)}},
  ]},
  "b13-blitz": {"url": 53, "pre": [("eval", "localStorage.setItem('study.blitz.tutorialSeen','1')")], "states": [
    {"id": "start", "steps": [("wait", 7)], "parts": {"start": START}},
    {"id": "how", "steps": [("click", "role:How it works"), ("wait", 2)], "parts": {"how": "[class*=tutSteps]"}},
    {"id": "practice", "steps": [("click", "role:Try one"), ("wait", 5)], "parts": {"practice": "[class*=lesson]"}},
    {"id": "play", "steps": [("click", ("nth", "[class*=cards] button", 1)), ("wait", 2), ("click", "role:Start the clock"), ("wait", 5)], "parts": {"clock": "[class*=clock]", "points": "[class*=topbar]", "qchip": "[class*=qLine]", "chart": CHART, "pointer": CHART_RIGHT, "cards": "[class*=cards]"}},
    {"id": "flash", "steps": [("click", ("nth", "[class*=cards] button", 0)), ("wait", 0.12)], "parts": {"flash": "[class*=lesson]"}},
    {"id": "end", "steps": [("wait", 58)], "parts": {"end": START, "log": "[class*=runLog]"}},
  ], "signin_part": "signin"},
  "b13-boss": {"url": 54, "states": [
    {"id": "intro", "steps": [("wait", 7)], "parts": {"intro": START, "heart": "[class*=heartBig]"}},
    {"id": "play", "steps": [("click", "role:Face the boss"), ("wait", 5)], "parts": {"bar": "[class*=bossTop]", "bubble": "[class*=ask]", "qchip": "[class*=qLine]", "chart": CHART, "check": "[class*=btn]"}},
    {"id": "verdict", "steps": [("click", ("nth", "[class*=cards] button", 0)), ("click", "[class*=footer] button"), ("wait", 4)], "parts": {"stamp": "[class*=stamp]", "runon": CHART, "lesson": "details[class*=whyCard]"}},
    {"id": "fail", "steps": [("click", "[class*=footer] button"), ("wait", 3), ("click", ("nth", "[class*=cards] button", 1)), ("click", "[class*=footer] button"), ("wait", 3), ("click", "[class*=footer] button"), ("wait", 2)], "parts": {"fail": START}},
  ], "notes": {"win": "no image: needs ten right in a row"}},
  "b13-hard": {"url": 55, "states": [
    {"id": "start", "steps": [("wait", 5)], "parts": {"start": START}},
    {"id": "name", "steps": [("click", "role:Start hard mode"), ("wait", 6)], "parts": {"name": "[class*=cards]", "chart": CHART, "pill": "[class*=stepPill], [class*=stepsCompact]"}},
    {"id": "enter", "steps": [("click", ("nth", "[class*=cards] button", 1)), ("click", "role:^Check"), ("wait", 2), ("click", "role:^Next"), ("wait", 3)], "parts": {"enter": CHART, "tags": CHART_LEFT, "pointer": CHART_RIGHT}},
    {"id": "stop", "steps": [("tap_chart", 0.5, 0.42), ("wait", 1), ("click", "role:^Check"), ("wait", 2), ("click", "role:^Next"), ("wait", 3)], "parts": {"stop": CHART, "why": "details[class*=whyCard]"}},
    {"id": "run", "steps": [("tap_chart", 0.5, 0.62), ("wait", 1), ("click", "role:^Check"), ("wait", 2), ("click", "role:^Next"), ("wait", 5)], "parts": {"run": CHART, "end": "[class*=footer]"}},
  ]},
  "b13-draw": {"url": 56, "states": [
    {"id": "ask", "steps": [("wait", 7)], "parts": {"start": "[class*=ask]", "ways": "[class*=howRow]", "pointer": CHART_RIGHT, "why": "details[class*=whyCard]", "strip": "[class*=liveStrip]"}},
    {"id": "tap", "steps": [("tap_chart", 0.5, 0.62), ("wait", 1.5)], "parts": {"mine": CHART_LEFT, "entry": CHART_LEFT}},
    {"id": "check", "steps": [("click", "role:Check my stop"), ("wait", 5)], "parts": {"house": CHART_LEFT, "verdict": "[class*=verdictRow]"}},
  ]},
  "b13-kicker": {"url": 57, "states": [
    {"id": "ask", "steps": [("wait", 7)], "parts": {"bubble": "[class*=ask]", "gold": CHART, "letters": CHART_RIGHT, "tapchart": CHART, "cards": "[class*=candRow]"}},
    {"id": "check", "steps": [("click", ("last", "[class*=candRow] button")), ("wait", 0.5), ("click", "role:^Check"), ("wait", 5)], "parts": {"rules": "[class*=candRow]", "stamp": "[class*=stamp]", "again": "[class*=footer] button"}},
  ]},
  "b13-ladder": {"url": 58, "states": [
    {"id": "one", "steps": [("wait", 7)], "parts": {"stage": "[class*=coinStage]", "grid": "[class*=ladder]", "labels": ("nth", "[class*=ladderCell]", 3), "moods": ("nth", "[class*=coinRow]", 0), "zero": ("nth", "[class*=ladderCell]", 0)}},
  ]},
}

def locate(page, part):
    if isinstance(part, tuple):
        kind = part[0]
        if kind == "nth":
            loc = page.locator(part[1]).nth(part[2]); return loc, None
        if kind == "last":
            loc = page.locator(part[1]); return loc.nth(loc.count() - 1), None
        if kind == "region":
            return page.locator(part[1]).first, part[2:]
    return page.locator(part).first, None

def click(page, target, touch):
    if isinstance(target, tuple):
        loc, _ = locate(page, target)
    elif target.startswith("role:"):
        loc = page.get_by_role("button", name=re.compile(target[5:])).first
    else:
        loc = page.locator(target).first
    loc.scroll_into_view_if_needed(timeout=5000)
    (loc.tap if touch else loc.click)(timeout=8000)

def tap_chart(page, fx, fy, touch):
    box = None
    for c in page.locator("canvas").all():
        bb = c.bounding_box()
        if bb and bb["width"] > 200: box = bb; break
    if not box: return
    x, y = box["x"] + box["width"] * fx, box["y"] + box["height"] * fy
    if touch: page.touchscreen.tap(x, y)
    else: page.mouse.move(x, y); time.sleep(0.3); page.mouse.click(x, y)

def drill_finish(page, touch):
    """Answer every remaining item of the member drill (choice, chart tap or inputs) until the end card shows."""
    click_ = (lambda loc: loc.tap()) if touch else (lambda loc: loc.click())
    for _ in range(14):
        if page.get_by_test_id("end-card").count(): return
        radios = page.locator("[role=radio]")
        if radios.count(): click_(radios.nth(0)); time.sleep(0.4)
        elif page.locator("[data-testid=tap-hud]").count(): tap_chart(page, 0.6, 0.5, touch); time.sleep(0.6)
        else:
            inputs = page.locator("input[type=number], input[type=text]")
            for k in range(inputs.count()): inputs.nth(k).fill("100"); time.sleep(0.2)
        btn = page.get_by_test_id("primary-action")
        if not btn.count() or not btn.is_enabled(): return
        click_(btn); time.sleep(3)
        btn = page.get_by_test_id("primary-action")
        if btn.count(): click_(btn); time.sleep(1.5)

def run_steps(page, steps, touch):
    for st in steps:
        try:
            if st[0] == "wait": time.sleep(st[1])
            elif st[0] == "click": click(page, st[1], touch)
            elif st[0] == "tap_chart": tap_chart(page, st[1], st[2], touch)
            elif st[0] == "eval": page.evaluate(st[1])
            elif st[0] == "drill_finish": drill_finish(page, touch)
        except Exception as e:
            print("   step failed", st, str(e)[:80])

def shoot(page, loc, region, path):
    loc.scroll_into_view_if_needed(timeout=5000)
    time.sleep(0.25)
    bb = loc.bounding_box()
    if not bb: return False
    vp = page.viewport_size
    img = Image.open(io.BytesIO(page.screenshot(type="png"))).convert("RGBA")
    scale = img.width / vp["width"]
    x0, y0, x1, y1 = bb["x"], bb["y"], bb["x"] + bb["width"], bb["y"] + bb["height"]
    if region:
        fx0, fy0, fx1, fy1 = region
        x0, x1 = bb["x"] + bb["width"] * fx0, bb["x"] + bb["width"] * fx1
        y0, y1 = bb["y"] + bb["height"] * fy0, bb["y"] + bb["height"] * fy1
    x0, y0 = max(0, x0 - 6), max(0, y0 - 6); x1, y1 = min(vp["width"], x1 + 6), min(vp["height"], y1 + 6)
    d = ImageDraw.Draw(img, "RGBA")
    # dim everything but the part, then the gold box
    mask = Image.new("RGBA", img.size, (0, 0, 0, 110))
    ImageDraw.Draw(mask).rectangle([x0 * scale, y0 * scale, x1 * scale, y1 * scale], fill=(0, 0, 0, 0))
    img = Image.alpha_composite(img, mask)
    d = ImageDraw.Draw(img, "RGBA")
    for w in range(0, int(4 * scale)):
        d.rectangle([x0 * scale - w, y0 * scale - w, x1 * scale + w, y1 * scale + w], outline=GOLD)
    img.convert("RGB").save(path, optimize=True)
    return True

def capture_piece(b, pid, cfg, vps, index):
    for vp_name, vp, dsf, touch in vps:
        ctx = b.new_context(viewport=vp, device_scale_factor=dsf, is_mobile=touch, has_touch=touch)
        ctx.add_init_script("window.__uctLogoPhase = 0.55")
        ctx.request.post("http://127.0.0.1:8077/api/auth/login", data={"email": ENV["EMAIL"], "password": ENV["UCT_SANDBOX_PASSWORD"]})
        page = ctx.new_page()
        page.goto(LAB + str(cfg["url"]), wait_until="load")
        if cfg.get("pre"):
            run_steps(page, cfg["pre"], touch); page.goto(LAB + str(cfg["url"]), wait_until="load")
        for state in cfg["states"]:
            run_steps(page, state["steps"], touch)
            for part_id, part in state["parts"].items():
                os.makedirs(os.path.join(OUT, pid), exist_ok=True)
                path = os.path.join(OUT, pid, f"{part_id}__{vp_name}.png")
                try:
                    loc, region = locate(page, part)
                    ok = shoot(page, loc, region, path)
                except Exception as e:
                    ok = False; print("   part failed", pid, part_id, vp_name, str(e)[:80])
                rec = index.setdefault(pid, {}).setdefault(part_id, {"desk": None, "phone": None, "note": ""})
                if ok: rec[vp_name] = f"parts/{pid}/{part_id}__{vp_name}.png"
        # the signed-out card: a fresh context with no cookie
        if cfg.get("signin_part"):
            c2 = b.new_context(viewport=vp, device_scale_factor=dsf, is_mobile=touch, has_touch=touch)
            p2 = c2.new_page(); p2.goto(LAB + str(cfg["url"]), wait_until="load"); run_steps(p2, cfg.get("pre") or [], touch); p2.goto(LAB + str(cfg["url"]), wait_until="load"); time.sleep(6)
            path = os.path.join(OUT, pid, f"{cfg['signin_part']}__{vp_name}.png")
            try:
                ok = shoot(p2, p2.locator(START).first, None, path)
                rec = index.setdefault(pid, {}).setdefault(cfg["signin_part"], {"desk": None, "phone": None, "note": ""})
                if ok: rec[vp_name] = f"parts/{pid}/{cfg['signin_part']}__{vp_name}.png"
            except Exception as e:
                print("   signin part failed", str(e)[:80])
            c2.close()
        ctx.close()
    for part_id, note in (cfg.get("notes") or {}).items():
        index.setdefault(pid, {}).setdefault(part_id, {"desk": None, "phone": None, "note": note})["note"] = note

if __name__ == "__main__":
    want = sys.argv[1:] or list(CONFIG)
    os.makedirs(OUT, exist_ok=True)
    idx_path = os.path.join(OUT, "index.json")
    index = json.load(open(idx_path, encoding="utf-8")) if os.path.exists(idx_path) else {}
    vps = [("desk", {"width": 1366, "height": 960}, 1, False), ("phone", {"width": 390, "height": 844}, 2, True)]
    with sync_playwright() as p:
        b = p.chromium.launch(args=A)
        for pid in want:
            if pid not in CONFIG: print("no config for", pid); continue
            t0 = time.time(); print("==", pid, flush=True)
            capture_piece(b, pid, CONFIG[pid], vps, index)
            json.dump(index, open(idx_path, "w", encoding="utf-8"), indent=1)
            print("   done in %.0fs" % (time.time() - t0), flush=True)
        b.close()
    n = sum(1 for pid in index for pt in index[pid] if index[pid][pt].get("desk"))
    print("parts with a desktop image:", n)
