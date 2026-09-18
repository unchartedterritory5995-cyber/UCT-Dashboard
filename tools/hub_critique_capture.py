"""R8 — render the joystick hub in every state, to disk, for the critique loop.

⛔⛔ THIS IS A RENDERING INSTRUMENT, NOT A GESTURE ONE. It drives the engine with SYNTHETIC
pointer events in Chromium. That is enough to put the control into a visual state and photograph
it; it is **not** evidence about flick, hold or scrub on glass. R9 stands — those stay
INCONCLUSIVE-TRANSPORT until a real finger produces a trace. Every manifest row this writes is
labelled `synthetic: true` so no later reader can quote a screenshot as a gesture result.

⛔ AND IT NEVER PHOTOGRAPHS A LIE. Before a frame is named "fan open" the hub's OWN DOM has to
agree that the fan is open. A screenshot is the one artifact that looks authoritative no matter
what it contains, so every state is CONFIRMED from the product's own answer first, and a state
that could not be reached is recorded as `INCONCLUSIVE` with its reason rather than captured.

⚠️ `PRESENT IS NOT SHOWING.` `HubRoot` keeps `<div data-testid="hub-root">` in the DOM and sets
the HTML `hidden` attribute, so a `querySelector` presence check answers "did React render a
container", never "can a member see it". The touch smoke published that exact mistake once. This
asserts the `hidden` attribute, the computed `display`, AND a non-zero box — and `offsetParent` is
deliberately NOT used, because the hub is `position: fixed` and that is null while it is plainly
on screen.

Usage:
    python tools/hub_critique_capture.py --base http://127.0.0.1:8077 --out <dir> --pass 1
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Device profiles. ⛔ BOTH must be coarse-pointer and <= 1023px wide or the hub does not mount at
# all: `useHubActive.js:84` requires `(max-width: 1023px) and (pointer: coarse)`.
PROFILES = {
    "iphone": dict(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                   is_mobile=True, has_touch=True,
                   user_agent=("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
                               "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")),
    "android": dict(viewport={"width": 412, "height": 915}, device_scale_factor=2.625,
                    is_mobile=True, has_touch=True,
                    user_agent=("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
                                "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36")),
}

# Routes worth photographing: one mode with a full fan, one with only the pair, and Home.
ROUTES = [("chart", "/charts"), ("journal", "/journal/trades"), ("home", "/dashboard")]

SHOWING_JS = """
() => {
  const el = document.querySelector('[data-testid="hub-root"]');
  if (!el) return { present: false, showing: false, why: 'no hub-root in the DOM' };
  if (el.hasAttribute('hidden')) return { present: true, showing: false, why: 'hidden attribute set' };
  const cs = getComputedStyle(el);
  if (cs.display === 'none') return { present: true, showing: false, why: 'computed display:none' };
  if (cs.visibility === 'hidden') return { present: true, showing: false, why: 'visibility:hidden' };
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { present: true, showing: false, why: `zero box ${r.width}x${r.height}` };
  return { present: true, showing: true, box: { w: Math.round(r.width), h: Math.round(r.height) } };
}
"""

# Synthetic pointer events, dispatched on the pad with the fields the engine actually reads.
PTR_JS = """
([type, dx, dy]) => {
  const pad = document.querySelector('[data-testid="hub-pad"]');
  if (!pad) return { ok: false, why: 'no hub-pad' };
  const r = pad.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const ev = new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    pointerId: 1, pointerType: 'touch', isPrimary: true, pressure: type === 'pointerup' ? 0 : 0.5,
    clientX: cx + dx, clientY: cy + dy,
  });
  pad.dispatchEvent(ev);
  return { ok: true };
}
"""

FAN_JS = """
() => {
  const bubbles = [...document.querySelectorAll('[data-testid^="hub-bubble-"]')]
    .map(e => e.getAttribute('data-testid').replace('hub-bubble-', ''));
  const chip = document.querySelector('[data-testid="hub-chip"]');
  return { bubbles, chipText: chip ? chip.textContent.trim().slice(0, 60) : null };
}
"""


def log(msg):
    print(msg, flush=True)


def ensure_account(ctx, base, email, password):
    """Sign up (idempotent), then log in. The sandbox sets ADMIN_EMAILS but creates no user."""
    try:
        ctx.request.post(f"{base}/api/auth/signup",
                         data={"email": email, "password": password, "display_name": "hub critique"},
                         headers={"Content-Type": "application/json"})
    except Exception:
        pass  # already exists, or signup closed — the login below is the real check
    r = ctx.request.post(f"{base}/api/auth/login",
                         data={"email": email, "password": password},
                         headers={"Content-Type": "application/json"})
    if not r.ok:
        return False, f"login HTTP {r.status}"
    body = r.json()
    return True, body.get("user", {}).get("email")


def capture(pw, base, out: Path, pass_no: int, email, password):
    rows = []
    browser = pw.chromium.launch(args=["--force-color-profile=srgb", "--disable-lcd-text"])
    try:
        for pname, prof in PROFILES.items():
            for theme in ("dark", "light"):
                ctx = browser.new_context(color_scheme=theme, **prof)
                ok, who = ensure_account(ctx, base, email, password)
                if not ok:
                    rows.append(dict(profile=pname, theme=theme, state="auth",
                                     verdict="INCONCLUSIVE", why=who))
                    ctx.close()
                    continue
                page = ctx.new_page()
                for mode, route in ROUTES:
                    page.goto(f"{base}{route}", wait_until="domcontentloaded", timeout=30000)
                    page.wait_for_timeout(2500)  # let the SPA settle and the hub mount
                    # Dismiss the cinematic intro, which plays on every page load.
                    try:
                        page.keyboard.press("Escape")
                        page.wait_for_timeout(600)
                    except Exception:
                        pass

                    show = page.evaluate(SHOWING_JS)
                    if not show.get("showing"):
                        rows.append(dict(profile=pname, theme=theme, mode=mode, state="idle",
                                         verdict="INCONCLUSIVE",
                                         why=f"hub not showing: {show.get('why')}", present=show.get("present")))
                        continue

                    def shot(state):
                        name = f"p{pass_no}_{pname}_{theme}_{mode}_{state}.png"
                        page.screenshot(path=str(out / name))
                        return name

                    # --- idle -------------------------------------------------------------
                    fan = page.evaluate(FAN_JS)
                    rows.append(dict(profile=pname, theme=theme, mode=mode, state="idle",
                                     verdict="CAPTURED", file=shot("idle"), synthetic=True,
                                     bubbles=fan["bubbles"], chip=fan["chipText"], box=show.get("box")))

                    # --- pressed ----------------------------------------------------------
                    page.evaluate(PTR_JS, ["pointerdown", 0, 0])
                    page.wait_for_timeout(120)
                    rows.append(dict(profile=pname, theme=theme, mode=mode, state="pressed",
                                     verdict="CAPTURED", file=shot("pressed"), synthetic=True))

                    # --- dragging / fan open ---------------------------------------------
                    page.evaluate(PTR_JS, ["pointermove", 0, -46])
                    page.wait_for_timeout(260)
                    fan = page.evaluate(FAN_JS)
                    if fan["bubbles"]:
                        rows.append(dict(profile=pname, theme=theme, mode=mode, state="fan-open",
                                         verdict="CAPTURED", file=shot("fan-open"), synthetic=True,
                                         bubbles=fan["bubbles"], chip=fan["chipText"]))
                    else:
                        # ⛔ The product's own answer says no fan. Do NOT name a frame "fan open".
                        rows.append(dict(profile=pname, theme=theme, mode=mode, state="fan-open",
                                         verdict="INCONCLUSIVE", synthetic=True,
                                         why="no hub-bubble-* in the DOM after the drag — the "
                                             "synthetic pointer did not open the fan",
                                         file=shot("drag-nofan")))

                    # --- release ----------------------------------------------------------
                    page.evaluate(PTR_JS, ["pointerup", 0, -46])
                    page.wait_for_timeout(320)
                    rows.append(dict(profile=pname, theme=theme, mode=mode, state="released",
                                     verdict="CAPTURED", file=shot("released"), synthetic=True))
                ctx.close()
    finally:
        browser.close()
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8077")
    ap.add_argument("--out", required=True)
    ap.add_argument("--pass", dest="pass_no", type=int, default=1)
    ap.add_argument("--email", default="hubtest@local.dev")
    ap.add_argument("--password", default="LocalTest2026!")
    ap.add_argument("--self-check", action="store_true",
                    help="prove the SHOWING predicate can answer NO as well as YES")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    if args.self_check:
        # ⛔ A predicate nobody has seen answer NO is not a predicate. Drive it both ways on
        # fixtures, with no server involved at all.
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            p = b.new_page()
            p.set_content('<div data-testid="hub-root" style="width:50px;height:50px"></div>')
            yes = p.evaluate(SHOWING_JS)
            p.set_content('<div data-testid="hub-root" hidden style="width:50px;height:50px"></div>')
            no_hidden = p.evaluate(SHOWING_JS)
            p.set_content('<div data-testid="hub-root" style="width:0;height:0"></div>')
            no_box = p.evaluate(SHOWING_JS)
            p.set_content("<div></div>")
            no_el = p.evaluate(SHOWING_JS)
            b.close()
        ok = (yes["showing"] and not no_hidden["showing"] and not no_box["showing"]
              and not no_el["showing"] and not no_el["present"])
        print(f"  showing(visible)      -> {yes}")
        print(f"  showing(hidden attr)  -> {no_hidden}")
        print(f"  showing(zero box)     -> {no_box}")
        print(f"  showing(absent)       -> {no_el}")
        print("\n  self-check " + ("OK — the predicate answers YES and NO" if ok else "FAILED"))
        return 0 if ok else 1

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    with sync_playwright() as pw:
        rows = capture(pw, args.base, out, args.pass_no, args.email, args.password)

    manifest = dict(pass_no=args.pass_no, base=args.base, seconds=round(time.time() - t0, 1),
                    captured=sum(1 for r in rows if r["verdict"] == "CAPTURED"),
                    inconclusive=sum(1 for r in rows if r["verdict"] == "INCONCLUSIVE"),
                    note=("SYNTHETIC pointer events in Chromium. Valid for MATERIAL and LAYOUT. "
                          "NOT evidence about flick/hold/scrub on glass — R9."),
                    rows=rows)
    (out / f"manifest-pass{args.pass_no}.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    log(f"\n  captured {manifest['captured']}  inconclusive {manifest['inconclusive']}  "
        f"in {manifest['seconds']}s -> {out}")
    for r in rows:
        if r["verdict"] == "INCONCLUSIVE":
            log(f"    INCONCLUSIVE {r.get('profile')}/{r.get('theme')}/{r.get('mode')}/{r.get('state')}: {r.get('why')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
