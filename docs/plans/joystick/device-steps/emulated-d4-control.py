"""D4 with its own positive control, across the three engine/viewport combos.

⛔ WHY THIS RE-RUN. The full pass produced 14 genuine sub-threshold flicks per engine, none of
which fired — but its CONTROL slot came back empty, because every scripted gesture happened to land
under FLICK_MS. "Nothing fired" is only evidence if the same gesture at the same offset CAN fire;
otherwise the flick might simply have been missing the bubble. So each engine now performs, at the
identical offset:

    N fast gestures   (< FLICK_MS)  -> must fire NOTHING          (the claim)
    1 slow gesture    (> FLICK_MS)  -> MUST open ClosePositionModal (the control)

A pass needs both halves. `flickable: false` is what makes them differ.
"""
from __future__ import annotations
import json, pathlib, sys
from playwright.sync_api import sync_playwright

B = "http://127.0.0.1:8077"
ADMIN = ("hubtest@local.dev", "HubDevice2026!")
SHOTS = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\joystick-hub\docs\plans\joystick\screens\b3b5-manual")
OUT = pathlib.Path(__file__).resolve().parent / "emulated"; OUT.mkdir(exist_ok=True)
FLICK_MS = 120
out = []


def say(t):
    sys.stdout.buffer.write((str(t) + "\n").encode("utf-8", "replace")); sys.stdout.buffer.flush()


def run(pw, engine, launcher, w, h):
    tag = f"{engine}-{w}x{h}"
    br = launcher.launch()
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=3,
                         is_mobile=True, has_touch=True)
    reqs = []
    page = ctx.new_page(); page.on("request", lambda r: reqs.append((r.method, r.url)))
    page.goto(B + "/", wait_until="domcontentloaded")
    ctx.request.post(B + "/api/auth/login", data=json.dumps({"email": ADMIN[0], "password": ADMIN[1]}),
                     headers={"Content-Type": "application/json"})

    def prime():
        page.goto(B + "/journal/trades", wait_until="domcontentloaded")
        page.evaluate("() => document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
        page.wait_for_timeout(2300)
        c = page.evaluate("() => { const p=document.querySelector('[data-testid=\"hub-pad\"]');"
                          " if(!p) return null; const r=p.getBoundingClientRect();"
                          " return {x:r.x+r.width/2,y:r.y+r.height/2}; }")
        if not c: return None, None
        page.mouse.move(c["x"], c["y"]); page.mouse.down(); page.mouse.up(); page.wait_for_timeout(600)
        offs = page.evaluate("() => { const p=document.querySelector('[data-testid=\"hub-pad\"]').getBoundingClientRect();"
                             " const cx=p.x+p.width/2, cy=p.y+p.height/2; const o={};"
                             " document.querySelectorAll('[data-action-id]').forEach(b=>{const r=b.getBoundingClientRect();"
                             " o[b.getAttribute('data-action-id')]={dx:r.x+r.width/2-cx,dy:r.y+r.height/2-cy};}); return o; }")
        page.evaluate("() => { window.__t={}; const pad=document.querySelector('[data-testid=\"hub-pad\"]');"
                      " pad.addEventListener('pointerdown',()=>{window.__t.down=Date.now()},true);"
                      " pad.addEventListener('pointerup',()=>{window.__t.up=Date.now()},true); }")
        return c, offs

    def gesture(c, off, slow):
        page.mouse.move(c["x"], c["y"]); page.mouse.down()
        page.mouse.move(c["x"] + off["dx"] / 2, c["y"] + off["dy"] / 2, steps=2)
        if slow: page.wait_for_timeout(260)
        page.mouse.move(c["x"] + off["dx"], c["y"] + off["dy"], steps=2)
        if slow: page.wait_for_timeout(260)
        page.mouse.up(); page.wait_for_timeout(700)
        t = page.evaluate("() => window.__t || {}")
        el = (t.get("up", 0) - t.get("down", 0)) if t.get("down") else None
        p = page.evaluate("() => ({ dialogs: document.querySelectorAll('[role=\"dialog\"]').length,"
                          " closeModal: Array.from(document.querySelectorAll('[role=\"dialog\"] label'))"
                          "   .some(l => (l.textContent||'').toLowerCase().includes('exit price')) })")
        return el, (p["dialogs"] > 0 or p["closeModal"])

    fast, writes = [], []
    for _ in range(8):
        c, offs = prime()
        if not offs or "journal.close" not in offs: break
        before = len(reqs)
        el, fired = gesture(c, offs["journal.close"], slow=False)
        writes += [f"{m} {u.split('8077')[-1]}" for m, u in reqs[before:]
                   if m in ("POST", "PUT", "PATCH", "DELETE") and "/api/" in u]
        if el is not None and el < FLICK_MS:
            fast.append((el, fired))
    page.screenshot(path=str(SHOTS / f"D4-close-flick-{tag}.png"))

    c, offs = prime()
    ctrl_el, ctrl_fired = gesture(c, offs["journal.close"], slow=True)
    page.screenshot(path=str(SHOTS / f"D4-control-deliberate-{tag}.png"))

    claim_ok = len(fast) >= 5 and not any(f for _, f in fast) and not writes
    ctrl_ok = ctrl_el is not None and ctrl_el > FLICK_MS and ctrl_fired
    say(f"  {tag}")
    say(f"    CLAIM  {len(fast)} flicks <{FLICK_MS}ms {[e for e,_ in fast]} -> fired={sum(1 for _,f in fast if f)} (want 0)  writes={writes or 'NONE'}")
    say(f"    CONTROL 1 deliberate @{ctrl_el}ms (>{FLICK_MS}) -> ClosePositionModal opened={ctrl_fired} (want True)")
    say(f"    => {'PASS' if (claim_ok and ctrl_ok) else 'FAIL'}")
    out.append({"engine": engine, "viewport": f"{w}x{h}", "check": "D4",
                "pass": bool(claim_ok and ctrl_ok),
                "fast_ms": [e for e, _ in fast], "fast_fired": sum(1 for _, f in fast if f),
                "control_ms": ctrl_el, "control_fired": ctrl_fired, "writes": writes,
                "screenshots": [f"D4-close-flick-{tag}.png", f"D4-control-deliberate-{tag}.png"]})
    ctx.close(); br.close()


with sync_playwright() as pw:
    run(pw, "chromium", pw.chromium, 393, 852)
    run(pw, "chromium", pw.chromium, 360, 800)
    run(pw, "webkit", pw.webkit, 393, 852)
(OUT / "d4-controlled.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
say(f"\n  D4 with control: {sum(1 for r in out if r['pass'])}/{len(out)} PASS")
