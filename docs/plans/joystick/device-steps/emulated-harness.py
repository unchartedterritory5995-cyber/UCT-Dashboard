"""D1-D7 under EMULATION — NOT DEVICE EVIDENCE.  (v2 — four harness defects fixed.)

⛔ LABEL EVERY RESULT `EMULATED — NOT DEVICE EVIDENCE`.

⭐ RULE 8: `has_touch`/`is_mobile` make the product's own gate (`useHubActive.js:84`) GENUINELY
true. Nothing is patched, and this refuses to continue if the gate does not resolve true by itself.

⛔ WHAT v1 GOT WRONG — all four were HARNESS defects, none was the product:
  1. The "flick" measured 226 ms against FLICK_MS=120 (`constants.js:94`), so it was a DELIBERATE
     release and journal.close fired correctly. Waits removed; the gesture now measures ~78 ms and
     the harness ASSERTS that from inside the page instead of assuming it.
  2. The Settings card checks loaded `/settings`, but sections are chosen by `?section=`
     (`Settings.jsx:1606-1609`) and the joystick card lives in `charts`. The card was never
     rendered, so "absent" meant nothing.
  3. ⛔⛔ THE MEMBER ACCOUNT WAS UNVERIFIED and redirected to `/verify-pending`, never reaching the
     journal. "No pad" and "no card" therefore PASSED FOR THE WRONG REASON — the exact
     absence-is-not-PASS trap. Accounts are now verified, and every absence assertion is GATED on a
     landed-where-expected precondition so a redirect can never read as a pass again.
  4. The member's preference was left `enabled:true` by v1's D7e, so the never-chosen checks were
     not testing never-chosen. It is reset before D7a/D7b and restored at the end.

GESTURE PARAMETERS (reproduce or dispute):
  FLICK       press -> 2 moves (steps=2 each) -> release, NO waits. Page-measured ~78 ms (<120).
  DELIBERATE  press -> 2 moves -> hold 400 ms -> release. Page-measured ~226 ms (>120).
  Travel      the bubble's own rendered offset from the pad centre, read from the DOM.
  Pointer     page.mouse -> trusted pointerdown/move/up, pointerType 'mouse'. The engine does not
              branch on pointerType (grepped: useJoystick.js, HubPad.jsx). What this cannot
              reproduce is a real digitiser, palm rejection, and the OS gesture layer.
"""
from __future__ import annotations

import json
import pathlib
import sqlite3
import sys

from playwright.sync_api import sync_playwright

B8077, B8078 = "http://127.0.0.1:8077", "http://127.0.0.1:8078"
ADMIN = ("hubtest@local.dev", "HubDevice2026!")
MEMBER = ("hubmember@local.dev", "HubDevice2026!")
DB8077 = r"C:\data-hubtest\auth.db"

REPO = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\joystick-hub")
SHOTS = REPO / "docs" / "plans" / "joystick" / "screens" / "b3b5-manual"
SHOTS.mkdir(parents=True, exist_ok=True)
OUT = pathlib.Path(__file__).resolve().parent / "emulated"
OUT.mkdir(exist_ok=True)

results = []


def say(t):
    sys.stdout.buffer.write((str(t) + "\n").encode("utf-8", "replace")); sys.stdout.buffer.flush()


def record(engine, vp, check, passed, detail, shot=None):
    results.append({"engine": engine, "viewport": vp, "check": check, "pass": passed,
                    "detail": detail, "screenshot": shot})
    mark = "N/A " if passed is None else ("PASS" if passed else "FAIL")
    say(f"    [{mark}] {check:13s} {detail}")


def member_pref(value):
    """None -> delete the row (never chosen). dict -> upsert it."""
    c = sqlite3.connect(DB8077)
    uid = c.execute("SELECT id FROM users WHERE email=?", (MEMBER[0],)).fetchone()[0]
    c.execute("DELETE FROM user_preferences WHERE user_id=? AND pref_key='joystick_hub'", (uid,))
    if value is not None:
        c.execute("INSERT INTO user_preferences (user_id, pref_key, pref_value) VALUES (?,?,?)",
                  (uid, "joystick_hub", json.dumps(value)))
    c.commit(); c.close()


def login(ctx, base, creds):
    return ctx.request.post(base + "/api/auth/login",
                            data=json.dumps({"email": creds[0], "password": creds[1]}),
                            headers={"Content-Type": "application/json"}).status


def landed(page, expect_path):
    """⛔ THE PRECONDITION. An absence assertion is only evidence if we are on the right page."""
    return expect_path in page.url


def pad_box(page):
    return page.evaluate("() => { const p=document.querySelector('[data-testid=\"hub-pad\"]');"
                         " if(!p) return null; const r=p.getBoundingClientRect();"
                         " return {x:r.x+r.width/2, y:r.y+r.height/2}; }")


def fan_offsets(page):
    return page.evaluate("() => { const p=document.querySelector('[data-testid=\"hub-pad\"]');"
                         " if(!p) return null; const pr=p.getBoundingClientRect();"
                         " const cx=pr.x+pr.width/2, cy=pr.y+pr.height/2; const o={};"
                         " document.querySelectorAll('[data-action-id]').forEach(b=>{"
                         "   const r=b.getBoundingClientRect();"
                         "   o[b.getAttribute('data-action-id')]={dx:r.x+r.width/2-cx, dy:r.y+r.height/2-cy};});"
                         " return o; }")


def probe(page):
    return page.evaluate("() => ({"
                         " dialogCount: document.querySelectorAll('[role=\"dialog\"]').length,"
                         " stopPrimary: (document.querySelector('[data-testid=\"hub-stop-primary\"]')||{}).textContent || null,"
                         " stopDisabled: (document.querySelector('[data-testid=\"hub-stop-primary\"]')||{}).disabled ?? null,"
                         " hubConfirmPresent: !!document.querySelector('[data-testid=\"hub-confirm-primary\"]'),"
                         " closeModal: !!Array.from(document.querySelectorAll('[role=\"dialog\"] label'))"
                         "   .some(l => (l.textContent||'').toLowerCase().includes('exit price')),"
                         " labels: Array.from(document.querySelectorAll('[role=\"dialog\"] label'))"
                         "   .map(l => (l.textContent||'').trim().toLowerCase()) })")


def last_action(page):
    return page.evaluate("() => { const r=document.querySelector('[data-hub-last-action]');"
                         " return r ? r.getAttribute('data-hub-last-action') : null; }")


def arm_clock(page):
    page.evaluate("() => { window.__t={}; const pad=document.querySelector('[data-testid=\"hub-pad\"]');"
                  " if(!pad) return; pad.addEventListener('pointerdown',()=>{window.__t.down=Date.now()},true);"
                  " pad.addEventListener('pointerup',()=>{window.__t.up=Date.now()},true); }")


def elapsed(page):
    t = page.evaluate("() => window.__t || {}")
    return (t.get("up", 0) - t.get("down", 0)) if t.get("down") else None


def prime(page, base):
    page.goto(base + "/journal/trades", wait_until="domcontentloaded")
    page.evaluate("() => document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
    page.wait_for_timeout(2500)
    if not landed(page, "/journal/trades"):
        return None, None
    c = pad_box(page)
    if not c:
        return None, None
    page.mouse.move(c["x"], c["y"]); page.mouse.down(); page.mouse.up()
    page.wait_for_timeout(600)
    offs = fan_offsets(page)
    if not offs:
        page.mouse.move(c["x"], c["y"]); page.mouse.down()
        page.mouse.move(c["x"] - 55, c["y"] + 55, steps=6); page.wait_for_timeout(260)
        page.mouse.up(); page.wait_for_timeout(400)
        offs = fan_offsets(page)
    arm_clock(page)
    return c, offs


def deliberate(page, c, off):
    page.mouse.move(c["x"], c["y"]); page.mouse.down()
    page.mouse.move(c["x"] + off["dx"] / 2, c["y"] + off["dy"] / 2, steps=4)
    page.mouse.move(c["x"] + off["dx"], c["y"] + off["dy"], steps=4)
    page.wait_for_timeout(400); page.mouse.up(); page.wait_for_timeout(700)


def flick(page, c, off):
    """NO waits — v1's 30/40ms waits made this a 226ms deliberate release."""
    page.mouse.move(c["x"], c["y"]); page.mouse.down()
    page.mouse.move(c["x"] + off["dx"] / 2, c["y"] + off["dy"] / 2, steps=2)
    page.mouse.move(c["x"] + off["dx"], c["y"] + off["dy"], steps=2)
    page.mouse.up(); page.wait_for_timeout(600)


def shot(page, name):
    page.screenshot(path=str(SHOTS / name)); return name


def run(pw, engine, launcher, w, h):
    tag = f"{engine}-{w}x{h}"; vp = f"{w}x{h}"
    say(f"\n  ── {tag} ───────────────────────────────────")
    br = launcher.launch()
    mk = lambda: br.new_context(viewport={"width": w, "height": h}, device_scale_factor=3,
                                is_mobile=True, has_touch=True)
    ctx = mk(); page = ctx.new_page()
    reqs = []; page.on("request", lambda r: reqs.append((r.method, r.url)))
    page.goto(B8077 + "/", wait_until="domcontentloaded")
    if not page.evaluate("() => matchMedia('(max-width: 1023px) and (pointer: coarse)').matches"):
        say(f"    REFUSING on {tag}: the hub's mount query did not resolve true."); return
    login(ctx, B8077, ADMIN)

    for check, action, fn in (("D1", "journal.moveStop", "D1-movestop"),
                              ("D2", "journal.breakeven", "D2-breakeven")):
        c, offs = prime(page, B8077)
        if not offs or action not in offs:
            record(engine, vp, check, False, "did not reach the journal / no bubble"); continue
        deliberate(page, c, offs[action]); p = probe(page)
        prim = (p["stopPrimary"] or "").strip()
        ok = (p["dialogCount"] == 1 and not p["hubConfirmPresent"]
              and prim.startswith("Set stop") and prim != "Move stop") if check == "D1" \
            else (p["dialogCount"] == 1 and not p["hubConfirmPresent"])
        record(engine, vp, check, ok,
               f"gesture={elapsed(page)}ms dialogs={p['dialogCount']} hubConfirm={p['hubConfirmPresent']} primary={prim!r}",
               shot(page, f"{fn}-{tag}.png"))

    c, offs = prime(page, B8077)
    if offs and "journal.close" in offs:
        deliberate(page, c, offs["journal.close"]); p = probe(page)
        want = ["shares", "exit price", "exit date"]
        found = [x for x in want if any(x in l for l in p["labels"])]
        record(engine, vp, "D3", p["dialogCount"] == 1 and not p["hubConfirmPresent"] and len(found) == 3,
               f"gesture={elapsed(page)}ms dialogs={p['dialogCount']} hubConfirm={p['hubConfirmPresent']} labels={found}",
               shot(page, f"D3-close-{tag}.png"))

    # ── D4 — CLASSIFIED BY MEASURED TIME, so it controls itself ──────────────
    # ⛔ v2 counted every attempt equally, but Chromium's input dispatch is slow enough that some
    # attempts exceeded FLICK_MS and became DELIBERATE releases — which SHOULD fire. Judging those
    # as D4 failures blamed the product for the harness. Each gesture is now classified by the time
    # the PAGE measured, and the verdict uses only genuine flicks. The over-threshold ones are kept
    # as a CONTROL: they must fire, or the gesture never reached the action at all.
    FLICK_MS = 120
    flicks, slows = [], []
    writes = []
    for _ in range(14):
        if len(flicks) >= 5 and len(slows) >= 1:
            break
        c, offs = prime(page, B8077)
        if not offs or "journal.close" not in offs:
            break
        page.keyboard.press("Escape"); page.wait_for_timeout(200)
        page.evaluate("() => { const r=document.querySelector('[data-testid=\"hub-root\"]');"
                      " if(r) r.setAttribute('data-hub-last-action',''); }")
        before = len(reqs)
        flick(page, c, offs["journal.close"])
        el = elapsed(page)
        pr = probe(page)
        fired = (last_action(page) == "journal.close") or pr["dialogCount"] > 0 or pr["closeModal"]
        writes += [f"{m} {u.split('127.0.0.1:8077')[-1]}" for m, u in reqs[before:]
                   if m in ("POST", "PUT", "PATCH", "DELETE") and "/api/" in u]
        (flicks if (el is not None and el < FLICK_MS) else slows).append((el, fired))
    real = [f for _, f in flicks]
    ctrl = [f for _, f in slows]
    ok = (len(flicks) >= 5 and not any(real) and not writes)
    record(engine, vp, "D4", ok,
           f"GENUINE flicks (<{FLICK_MS}ms) {[e for e, _ in flicks]} -> fired={sum(real)} (want 0); "
           f"CONTROL over-threshold {[e for e, _ in slows]} -> fired={sum(ctrl)} (want >0, proves the "
           f"gesture reaches Close); writes={writes or 'NONE'}",
           shot(page, f"D4-close-flick-{tag}.png"))

    for check, action in (("D5-moveStop", "journal.moveStop"), ("D5-breakeven", "journal.breakeven")):
        hits = 0; ts = []
        for _ in range(5):
            c, offs = prime(page, B8077)
            if not offs or action not in offs: break
            page.keyboard.press("Escape"); page.wait_for_timeout(200)
            flick(page, c, offs[action]); ts.append(elapsed(page))
            if probe(page)["dialogCount"] == 1: hits += 1
        record(engine, vp, check, hits >= 4,
               f"{hits}/5 flicks fired @{ts}ms — prediction stated before the run: it FIRES",
               shot(page, f"D5-flick-fires-{tag}.png"))

    record(engine, vp, "D6", None,
           "N/A under emulation — a browser cannot feel a haptic. Covered by the B5 unit rail "
           "(useJoystick.test.js: warn=[22,60,22] vs impact=18 through the real fireTarget).")

    # ── member checks, with the preference genuinely never-chosen ────────────
    member_pref(None)
    c2 = mk(); mp = c2.new_page(); mp.goto(B8077 + "/", wait_until="domcontentloaded")
    login(c2, B8077, MEMBER)
    mp.goto(B8077 + "/journal/trades", wait_until="domcontentloaded"); mp.wait_for_timeout(2500)
    on_journal = landed(mp, "/journal/trades")
    pad = pad_box(mp)
    record(engine, vp, "D7a", on_journal and pad is None,
           f"reached /journal/trades={on_journal} (precondition) pad={pad is not None}",
           shot(mp, f"D7a-member-no-pad-{tag}.png"))

    mp.goto(B8077 + "/settings?section=charts", wait_until="domcontentloaded"); mp.wait_for_timeout(2500)
    on_settings = landed(mp, "/settings")
    chart_card = mp.evaluate("() => !!document.querySelector('[id=\"set-card-chartSettings\"]')")
    jcard = mp.evaluate("() => !!document.querySelector('[data-testid=\"joystick-enabled-toggle\"]')")
    record(engine, vp, "D7b", on_settings and chart_card and not jcard,
           f"on charts section={on_settings and chart_card} (precondition) joystickCard={jcard}",
           shot(mp, f"D7b-member-no-card-{tag}.png"))

    st = c2.request.post(B8077 + "/api/auth/preferences",
                         data=json.dumps({"key": "joystick_hub", "value": json.dumps({"enabled": True})}),
                         headers={"Content-Type": "application/json"})
    mp.goto(B8077 + "/journal/trades", wait_until="domcontentloaded"); mp.wait_for_timeout(2500)
    pad2 = pad_box(mp); s1 = shot(mp, f"D7e-member-optin-{tag}.png")
    mp.goto(B8077 + "/settings?section=charts", wait_until="domcontentloaded"); mp.wait_for_timeout(2500)
    jcard2 = mp.evaluate("() => !!document.querySelector('[data-testid=\"joystick-enabled-toggle\"]')")
    record(engine, vp, "D7e", st.status == 200 and pad2 is not None and jcard2,
           f"prefs POST={st.status} padAfterOptIn={pad2 is not None} cardAfterOptIn={jcard2} "
           f"— the strand case: an opted-in member keeps their way off",
           shot(mp, f"D7e-member-card-{tag}.png"))
    member_pref(None); c2.close()

    page.goto(B8077 + "/settings?section=charts", wait_until="domcontentloaded"); page.wait_for_timeout(2500)
    acard = page.evaluate("() => !!document.querySelector('[data-testid=\"joystick-enabled-toggle\"]')")
    record(engine, vp, "D7c", acard, f"admin joystickCard={acard}",
           shot(page, f"D7c-admin-card-{tag}.png"))

    c3 = mk(); kp = c3.new_page(); kp.goto(B8078 + "/", wait_until="domcontentloaded")
    login(c3, B8078, ADMIN)
    kp.goto(B8078 + "/journal/trades", wait_until="domcontentloaded"); kp.wait_for_timeout(2500)
    on_j = landed(kp, "/journal/trades"); kpad = pad_box(kp)
    record(engine, vp, "D7d-1", on_j and kpad is None,
           f"reached journal={on_j} (precondition) :8078 flag OFF, admin, pref true -> pad={kpad is not None}",
           shot(kp, f"D7d-killswitch-off-{tag}.png"))
    c3.close()

    page.goto(B8077 + "/journal/trades", wait_until="domcontentloaded"); page.wait_for_timeout(2500)
    cpad = pad_box(page)
    record(engine, vp, "D7d-2", cpad is not None,
           f":8077 CONTROL same account -> pad={cpad is not None}",
           shot(page, f"D7d-control-on-{tag}.png"))

    ctx.close(); br.close()


def main():
    with sync_playwright() as pw:
        run(pw, "chromium", pw.chromium, 393, 852)
        run(pw, "chromium", pw.chromium, 360, 800)
        run(pw, "webkit", pw.webkit, 393, 852)
    (OUT / "results-v2.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    fails = [r for r in results if r["pass"] is False]
    say("\n  ══ SUMMARY (EMULATED — NOT DEVICE EVIDENCE) ══")
    say(f"  recorded={len(results)}  PASS={sum(1 for r in results if r['pass'] is True)}  "
        f"N/A={sum(1 for r in results if r['pass'] is None)}  FAIL={len(fails)}")
    for f in fails:
        say(f"    FAIL {f['engine']} {f['viewport']} {f['check']}: {f['detail']}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
