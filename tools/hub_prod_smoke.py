"""Post-deploy PRODUCTION smoke for the joystick hub.

⛔ Runs as `smoke@uctintelligence.internal` ONLY — the one synthetic account an
automated tool may sign in as on production. Signup is never attempted: the
account exists, `COMING_SOON_MODE` would refuse anyway, and the request would
cost a row in the activity log that reads like an attempted breach.

⭐ ONE AUTHORITY, A DIFFERENT DRIVER. The gesture timing, the SHOWING predicate
and the fan reader are IMPORTED from `hub_critique_capture`, never re-implemented
here. A second copy of the pointerdown→pointermove timing would drift from the one
carrying I2's fix and would silently turn every drag back into a hold.

⛔ PRESENT IS NOT SHOWING, AND IT CUTS BOTH WAYS. At rest the bubbles must be
PRESENT in the DOM *and* NOT SHOWING. Asserting only "not visible" passes on a hub
that never mounted; asserting only "present" is the mistake the touch smoke
published once already.

Exit codes — 0 PASS | 1 a MEASURED failure | 2 INCONCLUSIVE (could not measure).
⛔ 1 and 2 are different facts. Collapsing them is how a smoke gets muted, and
H15 fires a rollback on 1 only.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hub_critique_capture import (  # noqa: E402  — one authority, imported
    PROFILES,
    SHOWING_JS,
    PTR_JS,
    FAN_JS,
    ensure_account,
)

PASS, FAIL, INCONCLUSIVE = "PASS", "FAIL", "INCONCLUSIVE"

# At rest a member should see exactly three things. Anything else on screen at rest
# is F1 — the fan drawn while closed — coming back.
REST_JS = """
() => {
  const q = (s) => document.querySelector(s);
  const vis = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { op: +cs.opacity, tf: cs.transform, disp: cs.display,
             w: Math.round(r.width), h: Math.round(r.height) };
  };
  const bubbles = [...document.querySelectorAll('[data-testid^="hub-bubble"]')].map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('data-testid'), op: +cs.opacity, tf: cs.transform,
             w: Math.round(r.width), h: Math.round(r.height) };
  });
  return {
    pad: vis(q('[data-testid="hub-pad"]')),
    chip: vis(q('[data-testid="hub-chip"]')),
    actions: vis(q('[data-testid="hub-actions"]')),
    bubbles,
  };
}
"""

# D-49: an undefined var() inside the `border-top` SHORTHAND is invalid at
# computed-value time, so the declaration takes its unset value and NOTHING
# renders. Measuring the computed width is the only way to see that.
#
# ⛔ SCOPED TO THE JOYSTICK CARD, AND THAT IS THE WHOLE POINT. A page-wide scan of
# /settings returns ~297 bordered divs and passes whether or not these two render —
# a fixture that cannot distinguish is not a rail. The card is found as the smallest
# ancestor holding both joystick controls, never by a nth-child or a copy string.
DIVIDER_JS = """
() => {
  let card = document.querySelector('[data-testid="joystick-enabled-toggle"]');
  while (card && !card.querySelector('[data-testid="joystick-surface"]')) card = card.parentElement;
  if (!card) return { found: false };
  const divs = [...card.querySelectorAll('div')].map((el) => {
    const cs = getComputedStyle(el);
    return { w: cs.borderTopWidth, style: cs.borderTopStyle, c: cs.borderTopColor };
  }).filter((d) => d.style === 'solid' && parseFloat(d.w) > 0);
  // CONTROL: the card must contain a known-borderless element too, so a scan that
  // matched everything would be visible as such.
  const total = card.querySelectorAll('div').length;
  return { found: true, dividers: divs, totalDivs: total };
}
"""


def result(rows, name, verdict, detail, **extra):
    rows.append(dict(check=name, verdict=verdict, detail=detail, **extra))
    mark = {PASS: "ok  ", FAIL: "FAIL", INCONCLUSIVE: "??  "}[verdict]
    print(f"  [{mark}] {name}: {detail}")


def dismiss_intro(page):
    """The cinematic intro plays on every page LOAD. Escape finishes it."""
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(700)
    except Exception:
        pass


def run_theme(browser, args, prof, theme, out, rows):
    ctx = browser.new_context(**prof)
    # ⛔ THE THEME COMES FROM THE PREFERENCE, NOT prefers-color-scheme (I3).
    # `Layout.jsx` writes documentElement.dataset.theme from prefs.theme, and
    # `prefers-color-scheme` appears nowhere in this app's stylesheets — passing
    # Playwright's color_scheme changed nothing and filed twelve dark frames as light.
    ctx.route(
        "**/api/auth/preferences",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "joystick_hub": json.dumps(
                        {"enabled": True, "handedness": "right", "surface": "simplified"}
                    ),
                    "theme": theme,
                }
            ),
        ),
    )
    ok, who = ensure_account(ctx, args.base, args.email, args.password, allow_signup=False)
    if not ok:
        result(rows, f"auth[{theme}]", INCONCLUSIVE, f"login failed: {who}")
        ctx.close()
        return

    page = ctx.new_page()
    page.goto(f"{args.base}/charts", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(3000)
    dismiss_intro(page)

    applied = page.evaluate(
        "() => ({attr: document.documentElement.dataset.theme || null,"
        " bg: getComputedStyle(document.body).backgroundColor})"
    )
    if applied["attr"] != theme:
        result(
            rows,
            f"theme[{theme}]",
            INCONCLUSIVE,
            f"asked for {theme!r}, page has {applied['attr']!r} — every row below "
            f"would be mislabelled, so none is kept",
        )
        ctx.close()
        return
    result(rows, f"theme[{theme}]", PASS, f"data-theme={applied['attr']} bg={applied['bg']}",
           bg=applied["bg"])

    show = page.evaluate(SHOWING_JS)
    if not show.get("showing"):
        result(rows, f"hub-showing[{theme}]", FAIL, f"hub not showing: {show.get('why')}",
               present=show.get("present"))
        ctx.close()
        return
    result(rows, f"hub-showing[{theme}]", PASS, f"box={show.get('box')}")

    # ── AT REST ──────────────────────────────────────────────────────────────
    r = page.evaluate(REST_JS)
    page.screenshot(path=str(out / f"prod_{theme}_rest.png"))
    # ⛔ ABSENT and PRESENT-BUT-HIDDEN are different facts, and only the second is a
    # product failure. A selector I typed wrong makes an element ABSENT, and reporting
    # that as FAIL would fire H15's roll-back-first rule on my own typo.
    missing = [k for k in ("pad", "chip", "actions") if r[k] is None]
    trio = {
        k: bool(r[k] and r[k]["w"] and r[k]["h"] and r[k]["op"] > 0.05)
        for k in ("pad", "chip", "actions")
    }
    lit = [b for b in r["bubbles"] if b["op"] > 0.05]
    if missing:
        result(rows, f"at-rest[{theme}]", INCONCLUSIVE,
               f"element(s) not in the DOM at all: {missing} — that is a selector or mount "
               f"question, NOT a measured product failure", trio=trio)
    elif not r["bubbles"]:
        result(rows, f"at-rest[{theme}]", INCONCLUSIVE,
               "no bubbles in the DOM at all — cannot distinguish 'correctly hidden' from "
               "'never mounted', and those are different products", trio=trio)
    elif all(trio.values()) and not lit:
        result(rows, f"at-rest[{theme}]", PASS,
               f"pad+chip+Actions showing; {len(r['bubbles'])} bubbles PRESENT and none "
               f"showing", trio=trio, sample_transform=r["bubbles"][0]["tf"],
               bubble_count=len(r["bubbles"]))
    else:
        result(rows, f"at-rest[{theme}]", FAIL,
               f"trio={trio}; {len(lit)} bubble(s) visible at rest (F1 regression if >0)",
               lit=[b["id"] for b in lit])

    # ── DRAG OPENS ───────────────────────────────────────────────────────────
    # ⛔ NO SCREENSHOT BETWEEN pointerdown AND pointermove. A Playwright shot takes
    # ~1s and HOLD_MS is 500, so a shot there reclassifies the gesture as a HOLD
    # (a scrub, not a fan push) and reports the instrument as a product defect.
    idle = page.evaluate(FAN_JS)["visible"]
    page.evaluate(PTR_JS, ["pointerdown", 0, 0])
    page.wait_for_timeout(60)
    page.evaluate(PTR_JS, ["pointermove", 0, -46])
    page.wait_for_timeout(280)
    fan = page.evaluate(FAN_JS)
    page.screenshot(path=str(out / f"prod_{theme}_fanopen.png"))
    if len(fan["visible"]) > len(idle):
        result(rows, f"drag-opens[{theme}]", PASS,
               f"{len(idle)} → {len(fan['visible'])} visible: {fan['visible']}",
               visible=fan["visible"], chip=fan.get("chipText"))
    else:
        result(rows, f"drag-opens[{theme}]", FAIL,
               f"drag did not open the fan ({len(idle)} → {len(fan['visible'])})")
    page.evaluate(PTR_JS, ["pointerup", 0, -46])
    page.wait_for_timeout(300)

    # ── DIVIDERS (D-49) ──────────────────────────────────────────────────────
    # ⛔ ?section=charts — Settings is TABBED and the Joystick card lives in the charts
    # section (`Settings.jsx:2311-2316`). A bare /settings renders a different section,
    # so the card is genuinely absent from the DOM and a checker looking there reports
    # "the control is missing" about a page that was never asked to draw it.
    page.goto(f"{args.base}/settings?section=charts", wait_until="domcontentloaded",
              timeout=45000)
    page.wait_for_timeout(4000)
    dismiss_intro(page)
    d = page.evaluate(DIVIDER_JS)
    page.screenshot(path=str(out / f"prod_{theme}_settings.png"), full_page=True)
    if not d.get("found"):
        result(rows, f"dividers[{theme}]", INCONCLUSIVE,
               "Joystick settings card not found on /settings — selector or mount question, "
               "not a measured product failure")
    else:
        divs = d["dividers"]
        if len(divs) == 2:
            result(rows, f"dividers[{theme}]", PASS,
                   f"exactly 2 dividers render inside the Joystick card "
                   f"(widths {[x['w'] for x in divs]}, colour {divs[0]['c']}) "
                   f"out of {d['totalDivs']} divs in the card — D-49 holds",
                   total_divs=d["totalDivs"])
        else:
            result(rows, f"dividers[{theme}]", FAIL,
                   f"{len(divs)} divider(s) render inside the Joystick card, expected 2 — "
                   f"D-49 regression if 0 (an undefined var() makes the border-top "
                   f"shorthand render nothing)", total_divs=d["totalDivs"])

    # ── THE SETTINGS SWITCH ITSELF ───────────────────────────────────────────
    sel = page.evaluate("""
      () => {
        const el = document.querySelector('[data-testid="joystick-surface"]');
        if (!el) return null;
        return { value: el.value,
                 options: [...el.options].map((o) => o.value) };
      }
    """)
    if sel is None and not d.get("found"):
        # The card itself is missing -> a mount/navigation question, not a product verdict.
        result(rows, f"surface-control[{theme}]", INCONCLUSIVE,
               "the Joystick card is not mounted here, so the switch's absence says nothing")
    elif sel is None:
        result(rows, f"surface-control[{theme}]", FAIL,
               "the Joystick card IS mounted but carries no full/default switch — the R4 "
               "surface variant would be unreachable (built, tested, no product caller)")
    else:
        result(rows, f"surface-control[{theme}]", PASS,
               f"switch present, value={sel['value']!r}, options={sel['options']}",
               options=sel["options"])
    ctx.close()


def run_kill_switch(browser, args, prof, theme, out, rows):
    """Prove the PRODUCTION BUNDLE hides the hub when the kill switch is false.

    ⭐ Done by intercepting `/api/auth/me` rather than setting HUB_PREVIEW_ENABLED=false
    on Railway. The variable is production-wide and `--set` also redeploys, so flipping
    it to take one screenshot costs every member a restart. This tests the half a
    FRONTEND deploy can actually regress — `useHubActive.js:56`, which reads
    `auth?.hubPreviewEnabled === false`. The SERVER half is railed per-request by
    `tests/test_hub_preview_flag.py`.
    ⚠️ State that scope beside the result; it is not the same as flipping the real flag.
    """
    ctx = browser.new_context(**prof)
    ctx.route(
        "**/api/auth/preferences",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"joystick_hub": json.dumps({"enabled": True}), "theme": theme}),
        ),
    )

    def kill(route):
        try:
            resp = route.fetch()
            data = resp.json()
            data["hub_preview_enabled"] = False
            route.fulfill(status=200, content_type="application/json", body=json.dumps(data))
        except Exception:
            route.continue_()

    ctx.route("**/api/auth/me", kill)
    ok, who = ensure_account(ctx, args.base, args.email, args.password, allow_signup=False)
    if not ok:
        result(rows, f"kill-switch[{theme}]", INCONCLUSIVE, f"login failed: {who}")
        ctx.close()
        return
    page = ctx.new_page()
    page.goto(f"{args.base}/charts", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(3000)
    dismiss_intro(page)
    s = page.evaluate(SHOWING_JS)
    page.screenshot(path=str(out / f"prod_{theme}_killswitch.png"))
    if not s.get("showing"):
        result(rows, f"kill-switch[{theme}]", PASS,
               f"hub hidden with hub_preview_enabled=false ({s.get('why')})",
               scope="client half on the production bundle; server half railed separately")
    else:
        result(rows, f"kill-switch[{theme}]", FAIL,
               "hub STILL SHOWING with hub_preview_enabled=false")
    ctx.close()


def run_surface_roundtrip(browser, args, prof, out, rows):
    """Flip full/simplified through PRODUCTION'S REAL preference storage.

    ⭐ This is the only check that does not stub `/api/auth/preferences`, and it is the
    one that matters most: the R4 surface variant was once built, tested, green and
    UNREACHABLE because `setHubSurface` had no product caller. Stubbing the route
    would re-create exactly that blind spot — the fan would render from a fixture and
    nobody would learn whether production stores and serves the preference at all.

    ⛔ It therefore WRITES to the smoke account, which is why the run restores the
    baseline afterwards. That is what "smoke reset first and last" is for.
    """
    ctx = browser.new_context(**prof)
    ok, who = ensure_account(ctx, args.base, args.email, args.password, allow_signup=False)
    if not ok:
        result(rows, "surface-roundtrip", INCONCLUSIVE, f"login failed: {who}")
        ctx.close()
        return

    def read_pref():
        r = ctx.request.get(f"{args.base}/api/auth/preferences")
        return r.json() if r.ok else None

    def write_hub(blob):
        return ctx.request.post(
            f"{args.base}/api/auth/preferences",
            data={"key": "joystick_hub", "value": json.dumps(blob)},
            headers={"Content-Type": "application/json"},
        )

    before = read_pref()
    if before is None:
        result(rows, "surface-roundtrip", INCONCLUSIVE, "could not read preferences")
        ctx.close()
        return
    baseline_hub = before.get("joystick_hub", "{}")

    counts = {}
    try:
        page = ctx.new_page()
        for surface in ("full", "simplified"):
            w = write_hub({"enabled": True, "handedness": "right", "surface": surface})
            if not w.ok:
                result(rows, "surface-roundtrip", INCONCLUSIVE,
                       f"writing surface={surface} returned HTTP {w.status}")
                ctx.close()
                return
            page.goto(f"{args.base}/charts", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(3000)
            dismiss_intro(page)
            page.evaluate(PTR_JS, ["pointerdown", 0, 0])
            page.wait_for_timeout(60)
            page.evaluate(PTR_JS, ["pointermove", 0, -46])
            page.wait_for_timeout(280)
            fan = page.evaluate(FAN_JS)
            counts[surface] = fan["visible"]
            page.screenshot(path=str(out / f"prod_surface_{surface}.png"))
            page.evaluate(PTR_JS, ["pointerup", 0, -46])
            page.wait_for_timeout(250)
    finally:
        # ⛔ RESTORE BEFORE ANY VERDICT. A run that leaves the account mutated makes the
        # NEXT run unable to tell a product change from this run's leftovers.
        restored = write_hub(json.loads(baseline_hub) if baseline_hub.strip() else {})
        after = read_pref() or {}
        same = after.get("joystick_hub") == baseline_hub
        result(rows, "smoke-reset-last",
               PASS if (restored.ok and same) else FAIL,
               f"joystick_hub restored to baseline {baseline_hub!r}: "
               f"{'byte-identical' if same else 'MISMATCH -> ' + repr(after.get('joystick_hub'))}")

    full, simp = counts.get("full", []), counts.get("simplified", [])
    if not full or not simp:
        result(rows, "surface-roundtrip", INCONCLUSIVE,
               f"one surface produced no open fan (full={len(full)}, simplified={len(simp)})")
    elif len(full) > len(simp):
        result(rows, "surface-roundtrip", PASS,
               f"production stores, serves and renders the preference: full={len(full)} "
               f"bubbles vs simplified={len(simp)} — the R4 cut is reachable from Settings",
               full=full, simplified=simp)
    else:
        result(rows, "surface-roundtrip", FAIL,
               f"flipping the preference did not change the fan (full={len(full)}, "
               f"simplified={len(simp)}) — the surface variant is not wired on production",
               full=full, simplified=simp)
    ctx.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://uctintelligence.com")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--profile", default="iphone", choices=sorted(PROFILES))
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []

    from playwright.sync_api import sync_playwright

    prof = PROFILES[args.profile]
    print(f"  profile={args.profile} base={args.base}")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--force-color-profile=srgb", "--disable-lcd-text"])
        try:
            for theme in ("dark", "light"):
                run_theme(browser, args, prof, theme, out, rows)
                run_kill_switch(browser, args, prof, theme, out, rows)
            # last, because it is the only step that writes to the account
            run_surface_roundtrip(browser, args, prof, out, rows)
        finally:
            browser.close()

    (out / "smoke.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    fails = [r for r in rows if r["verdict"] == FAIL]
    inc = [r for r in rows if r["verdict"] == INCONCLUSIVE]
    print(f"\n  {len(rows)} checks: {len(rows) - len(fails) - len(inc)} pass, "
          f"{len(fails)} FAIL, {len(inc)} inconclusive")
    if fails:
        print("  => exit 1 (MEASURED failure; H15: roll back first, diagnose second)")
        return 1
    if inc:
        print("  => exit 2 (INCONCLUSIVE — not a failure, must NOT trigger a rollback)")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
