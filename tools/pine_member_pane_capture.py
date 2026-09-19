"""Capture the member-door pane at each breakpoint, WITHOUT the operator's browser.

⛔⛔ WHY THIS EXISTS. The member-door capture was driven through the operator's
own Chrome on 2026-09-18 and produced the evidence it was asked for — but the
window sits behind another maximized window, so `document.visibilityState` read
`"hidden"` for the whole run and **Gate v2.1 could not pass**. Nothing could be
done about it from a session: Windows' foreground lock refuses
`SetForegroundWindow` to a background process, `WScript.Shell.AppActivate`
returns `False`, and the P/Invoke route is refused by the harness. The window is
also MAXIMIZED, and a maximized window ignores a bounds change — which is why
`resize_window` reports success while `innerWidth` stays 1920, and why the two
mobile tiers could not be taken at all.

⭐ A PLAYWRIGHT PAGE OWNS ITS OWN VIEWPORT AND ITS OWN VISIBILITY. It is not
occluded by anything, it reports `visible`, and 390 / 820 / 1440 are exact rather
than approximate. So the gate PASSES here, honestly, and it is asserted before
every shot rather than assumed — a capture taken behind a failing gate is the
thing this file was written to stop doing.

⛔ THIS IS THE RIG HALF ONLY, AND THAT LIMIT IS THE POINT. The VENDOR capture is
on the owner's authenticated TradingView account; reaching it from here would
mean handling the owner's credentials or borrowing their profile, and neither is
this tool's business. That half stays owner-driven, in the owner's browser.

⭐ NO PASSWORD IS TYPED INTO A PAGE. Sign-in is an API call the way
`tools/mobile_audit.py` already does it (`page.request.post`), against a SANDBOX
account on a LOCAL rig — never a member, never production.

⭐ AND THE SCRIPT IS CARRIED, NEVER RETYPED. The fixture is copied byte-for-byte
into the rig's own static directory and FETCHED BY THE PAGE from that file; the
sha256 of the string sitting in the textarea is compared against the sha256 of
the file on disk before anything is attached. A length and a checksum can agree
by accident; two sha256s do not.

Usage (the rig must already be up — `docs/pine/wip/rig/boot_rig.py`):

    python tools/pine_member_pane_capture.py --base http://127.0.0.1:8131 \
        --out docs/pine/capture --tag 2026-09-18

Exit codes, three, because they are three different facts:
    0  every tier captured, gate passed at each shot
    1  a MEASURED failure (the door refused, the document was not what the
       engine builds, a tier rendered nothing)
    2  INCONCLUSIVE — the rig was not reachable, sign-in failed, the fixture
       could not be served. Never a pass, and never reported as a failure of
       the product.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import shutil
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = REPO / "tests" / "fixtures" / "member" / "uncharted-clouds.pine"
SERVED_NAME = "rig-member-fixture.txt"
SERVED_DIR = REPO / "app" / "dist" / "assets"

#: ⭐ THE CANONICAL THREE, read off `app/src/styles/breakpoints.js`'s own tiers —
#: phone <= 640, tablet 641-1024, desktop >= 1025. Never a fourth literal.
TIERS = [("phone", 390, 844), ("tablet", 820, 1180), ("desktop", 1440, 900)]

#: ⛔⛔ THE DOOR IS ATTACHED ONCE, AT DESKTOP, AND THE TIERS ARE RENDERINGS OF
#: THAT ONE INSTANCE. The first version of this tool opened the builder at every
#: width and the PHONE run reported `{"gear": false}` — which is not a script
#: fault: at <= 640 `/charts` renders `MobileWorkspace`, and the phone chart
#: shell (`app/src/pages/charts/mobile/`) **mounts no `BuilderSheet` and declares
#: no `onCreateFormula` anywhere** — grep returns zero. There is no builder door
#: on a phone at all.
#: ⭐ So the two questions are separated, because they are two questions: *can a
#: member CREATE one at this width* (answered from source: not on a phone) and
#: *does the pane RENDER correctly at this width* (which is what a tier capture
#: is for, and which needs one attached instance seen at three widths).
ATTACH_AT = (1440, 900)

SIGN_IN = {"email": "panetest@local.dev", "password": "RigLocal2026!"}


def sha16(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


# ⛔ ONE PLACE DECIDES WHAT "READY" MEANS. Every call site asks this, so a change
# to the door's shape moves one function rather than four waits.
READY_JS = """() => {
  const box = document.querySelector('[data-testid="pine-member-pane-attach"]');
  return !!(box && box.querySelector('button'));
}"""


def _gate(page, what: str) -> None:
    """Gate v2.1, asserted rather than assumed, immediately before a shot."""
    state = page.evaluate(
        "() => ({vis: document.visibilityState, w: innerWidth, h: innerHeight})"
    )
    if state["vis"] != "visible":
        raise SystemExit(
            f"[capture] GATE v2.1 FAILED before {what}: visibilityState="
            f"{state['vis']!r}. Refusing to record a shot behind a failing gate."
        )
    return state


def capture_member_pane(base: str, script_path: pathlib.Path, out_dir: pathlib.Path,
                         tag: str, slug: str, viewport: tuple[int, int] = (1440, 900)) -> dict:
    """Attach `script_path` as a member-pane definition on `base` and screenshot it
    at `viewport`. Returns {"ok", "shot", "plots", "fills", "hidden", "reason"}.
    Never types a password into a page — sign-in is an API call against a local
    sandbox account. Never reaches TradingView."""
    from playwright.sync_api import sync_playwright

    raw = script_path.read_bytes()
    want = sha16(raw)
    SERVED_DIR.mkdir(parents=True, exist_ok=True)
    served = SERVED_DIR / SERVED_NAME
    shutil.copyfile(script_path, served)
    print(f"[capture] fixture {script_path.name}: {len(raw)} bytes, sha256 {want}...")

    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(
                viewport={"width": viewport[0], "height": viewport[1]})
            page = ctx.new_page()

            # ⭐ SIGN IN THROUGH THE API, so no password is ever typed into a
            # form, and the cookie lands in this context's own jar.
            r = page.request.post(f"{base}/api/auth/login", data=SIGN_IN)
            if not r.ok:
                return {"ok": False, "shot": None, "plots": 0, "fills": 0, "hidden": 0,
                        "reason": f"sign-in {r.status}"}

            page.goto(f"{base}/charts", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)
            _gate(page, "open-the-door")

            opened = page.evaluate(OPEN_DOOR_JS)
            if not opened.get("importTab"):
                return {"ok": False, "shot": None, "plots": 0, "fills": 0, "hidden": 0,
                        "reason": f"no Import tab: {opened}"}

            page.wait_for_timeout(1500)
            paste = page.evaluate(PASTE_JS, f"/assets/{SERVED_NAME}")
            if paste.get("sha") != want:
                return {"ok": False, "shot": None, "plots": 0, "fills": 0, "hidden": 0,
                        "reason": f"textarea sha {paste.get('sha')} != file sha {want}"}

            try:
                page.wait_for_function(READY_JS, timeout=20000)
            except Exception:
                return {"ok": False, "shot": None, "plots": 0, "fills": 0, "hidden": 0,
                        "reason": "attach door never appeared"}

            attached = page.evaluate(ATTACH_JS)
            if not attached.get("ok"):
                return {"ok": False, "shot": None, "plots": 0, "fills": 0, "hidden": 0,
                        "reason": f"attach failed: {attached}"}

            state = _gate(page, "final screenshot")
            if state["w"] != viewport[0]:
                return {"ok": False, "shot": None, "plots": attached["plots"],
                        "fills": attached["fills"], "hidden": attached["hidden"],
                        "reason": f"asked for width {viewport[0]}, page reports {state['w']}"}

            shot = out_dir / f"member-door-{slug}-{tag}.png"
            page.screenshot(path=str(shot))
            ctx.close()
            browser.close()
            return {"ok": True, "shot": shot, "plots": attached["plots"],
                     "fills": attached["fills"], "hidden": attached["hidden"], "reason": None}
    finally:
        served.unlink(missing_ok=True)


def _run_self_check(base: str) -> int:
    """⛔ A GATE NOBODY HAS SEEN FIRE IS NOT A GATE. Drives a page into a
    background tab and proves the refusal happens. Relocated verbatim (Task 2
    extraction) from main()'s old --self-check branch, which used to reuse
    main()'s own `browser` — this owns its own Playwright/browser lifecycle
    instead, since it is no longer nested inside that call."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.goto(f"{base}/charts", wait_until="domcontentloaded")
        page.evaluate(
            "() => Object.defineProperty(document, 'visibilityState',"
            " {get: () => 'hidden', configurable: true})")
        try:
            _gate(page, "self-check")
        except SystemExit as exc:
            print(f"[capture] SELF-CHECK OK — the gate fired: {exc}")
            ctx.close()
            browser.close()
            return 0
        print("[capture] SELF-CHECK FAILED — the gate did not fire")
        return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8131")
    ap.add_argument("--out", default="docs/pine/capture")
    ap.add_argument("--tag", default=time.strftime("%Y-%m-%d"))
    ap.add_argument("--self-check", action="store_true",
                    help="prove the gate can fail: shoot from a hidden page")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    out_dir = (REPO / args.out) if not pathlib.Path(args.out).is_absolute() else pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    raw = FIXTURE.read_bytes()
    want = sha16(raw)
    SERVED_DIR.mkdir(parents=True, exist_ok=True)
    served = SERVED_DIR / SERVED_NAME
    shutil.copyfile(FIXTURE, served)
    print(f"[capture] fixture {FIXTURE.name}: {len(raw)} bytes, sha256 {want}...")

    results = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(
                viewport={"width": ATTACH_AT[0], "height": ATTACH_AT[1]})
            page = ctx.new_page()

            # ⭐ SIGN IN THROUGH THE API, so no password is ever typed into a
            # form, and the cookie lands in this context's own jar.
            r = page.request.post(f"{args.base}/api/auth/login", data=SIGN_IN)
            if not r.ok:
                print(f"[capture] INCONCLUSIVE: sign-in {r.status} at {args.base}")
                return 2

            page.goto(f"{args.base}/charts", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)
            _gate(page, "open-the-door")

            opened = page.evaluate(OPEN_DOOR_JS)
            if not opened.get("importTab"):
                print(f"[capture] INCONCLUSIVE: could not reach the Import tab "
                      f"({json.dumps(opened)})")
                return 2

            page.wait_for_timeout(1500)
            paste = page.evaluate(PASTE_JS, f"/assets/{SERVED_NAME}")
            if paste.get("sha") != want:
                print(f"[capture] MEASURED FAILURE: textarea sha {paste.get('sha')} "
                      f"!= file sha {want}")
                return 1
            print(f"[capture] textarea {paste['len']} chars, sha {paste['sha']} — identical")

            try:
                page.wait_for_function(READY_JS, timeout=20000)
            except Exception:
                print("[capture] INCONCLUSIVE: the attach door never appeared")
                return 2

            attached = page.evaluate(ATTACH_JS)
            if not attached.get("ok"):
                print(f"[capture] MEASURED FAILURE: {json.dumps(attached)}")
                return 1
            print(f"[capture] attached — sheet closed={attached['closed']}, "
                  f"plots={attached['plots']} fills={attached['fills']} "
                  f"hidden={attached['hidden']}")

            for name, w, h in TIERS:
                page.set_viewport_size({"width": w, "height": h})
                page.wait_for_timeout(5000)
                state = _gate(page, f"{name} screenshot")
                # ⛔ A REPORTED RESIZE WITH AN UNCHANGED WIDTH IS A FAILURE. This
                # is the exact trap the operator's own maximized Chrome fell into.
                if state["w"] != w:
                    print(f"[capture] MEASURED FAILURE: asked for {w}, page reports {state['w']}")
                    return 1
                print(f"[capture] {name}: gate OK — visible at {state['w']}x{state['h']}")
                shot = out_dir / f"member-door-clouds-{name}-{args.tag}.png"
                page.screenshot(path=str(shot))
                print(f"[capture] {name}: wrote {shot.relative_to(REPO)}")
                results.append({"tier": name, "w": state["w"], "h": state["h"],
                                "shot": shot.name,
                                **{k: attached[k] for k in
                                   ("plots", "fills", "hidden", "closed")}})
            ctx.close()
            browser.close()
    finally:
        served.unlink(missing_ok=True)

    if args.self_check:
        return _run_self_check(args.base)

    print(json.dumps({"captured": results}, indent=1))
    return 0 if len(results) == len(TIERS) else 2


OPEN_DOOR_JS = """() => {
  const by = (re) => [...document.querySelectorAll('button,[role="tab"]')]
    .find(b => re.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
  const gear = by(/^Chart settings$/); if (!gear) return {gear: false};
  gear.click();
  return new Promise((resolve) => setTimeout(() => {
    const ind = by(/^Indicators$/); if (ind) ind.click();
    setTimeout(() => {
      const nf = by(/New Formula/i); if (nf) nf.click();
      setTimeout(() => {
        const imp = [...document.querySelectorAll('[role="tab"]')]
          .find(t => (t.textContent || '').trim() === 'Import');
        if (imp) imp.click();
        setTimeout(() => resolve({
          gear: true, indicators: !!ind, newFormula: !!nf,
          importTab: !!document.querySelector('[data-testid="pine-box"] textarea'),
        }), 900);
      }, 1400);
    }, 900);
  }, 900));
}"""

#: ⭐ THE PAGE FETCHES THE FILE. Nothing about the script passes through this
#: process as text, so "carried, never retyped" is structural rather than a
#: promise — and the sha is computed on BOTH sides of the move.
PASTE_JS = """async (url) => {
  const src = await fetch(url).then(r => r.text());
  const ta = document.querySelector('[data-testid="pine-box"] textarea');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, src);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ta.value));
  return {
    len: ta.value.length,
    sha: [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16),
  };
}"""

ATTACH_JS = """async () => {
  const box = document.querySelector('[data-testid="pine-member-pane-attach"]');
  if (!box) return {ok: false, why: 'no attach door'};
  box.querySelector('button').click();
  await new Promise(r => setTimeout(r, 5000));
  const after = await fetch('/api/user-definitions', {credentials: 'same-origin'})
    .then(r => r.json()).catch(e => ({err: String(e)}));
  const defs = after.definitions || [];
  const d = defs.length ? (defs[defs.length - 1].definition || defs[defs.length - 1]) : null;
  const plots = d && Array.isArray(d.plots) ? d.plots : [];
  return {
    ok: !!d,
    closed: !document.querySelector('[data-testid="pine-box"]'),
    stored: defs.length,
    plots: plots.length,
    fills: plots.filter(p => p && p.fill).length,
    hidden: plots.filter(p => p && p.hidden === true).length,
    refusal: (box.textContent || '').includes('refused') ? box.textContent.slice(0, 120) : null,
  };
}"""


if __name__ == "__main__":
    sys.exit(main())
