"""R-27 — POST-DEPLOY APP-WIDE CLIENT SMOKE, on the rig, against production.

⛔⛔ WHY THIS IS REQUIRED FOR EVERY FLAG-ON DEPLOY.

On 2026-09-10 a render loop in a hub controller starved React Router's transition
commit. Clicking any nav entry changed the URL and left the screen where it was,
app-wide, for about four and a half hours. `/api/health` returned 200 the whole
time with a rising uptime; the full gate was green at 0 NEW failures; the
first-hour watch recorded five clean samples.

⭐ THE LESSON THAT MAKES THIS MANDATORY RATHER THAN NICE: **the defect was in a
SHARED component, so it was exposure for every member regardless of which flag
shipped.** A canary that exercises only the flagged feature cannot see it. This
walks the whole app instead, and it runs IN ADDITION to the feature's own canary,
never instead of it.

⛔ A FAILURE HERE IS H4: ROLL BACK FIRST, diagnose second.

────────────────────────────────────────────────────────────────────────────────
WHAT IT MEASURES, AND WHY IN THAT WAY

1. **Client-side navigation, by CLICKING.** Not `goto`. A full page load rebuilds
   the world and always works — it is precisely what masked the freeze from every
   instrument that looked. The defect only exists in the in-app transition, so
   the in-app transition is what gets clicked. A route is PASS only when the URL
   moved AND the rendered screen changed, within `NAV_BOUND_MS`.

2. **Render stability across 5 seconds of idle**, by two independent signals:

   · **React commit count.** A `__REACT_DEVTOOLS_GLOBAL_HOOK__` shim is installed
     by `add_init_script` BEFORE the app boots, and counts `onCommitFiberRoot`.
     That is React's own count of committed renders — the same quantity that read
     ~4,500/sec on the looping tile and ~0/sec on the page that looked fine.
   · **DOM mutations**, via a MutationObserver. A loop that commits must also
     touch the DOM.

   ⛔ THE PRODUCT EXPOSES NO MOUNT OR REGISTRATION COUNTER, and this tool does not
   pretend otherwise — nothing here reads a `window.__uctHubMounts`, because no
   such thing exists. It measures React's own commit traffic and the DOM churn
   that follows it: the OBSERVABLE CONSEQUENCE of the loop, at the layer the
   member lives on. If such a counter is ever exported, read it here as a THIRD
   signal; do not replace these two with it.

3. **The key is UNSET.** A smoke run that has quietly opted this browser in is
   measuring a different product from the one members get. It is asserted, and a
   set key is INCONCLUSIVE, never a pass.

EXIT CODES — 1 and 2 are deliberately different facts:
    0  PASS          every route navigated and every surface settled.
    1  FAILED        a freeze, a dead route, or a render loop was MEASURED. H4.
    2  INCONCLUSIVE  nothing was measurable (rig would not start, not signed in,
                     or an opt-in key was set). NOT a pass and NOT a product
                     failure — "we could not compute it" and "something broke"
                     are different facts to whoever reads this.

Usage
-----
    python tools/postdeploy_client_smoke.py
    python tools/postdeploy_client_smoke.py --idle 5 --json out.json
    python tools/postdeploy_client_smoke.py --self-check    # prove it can FAIL
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import window_check as wc          # noqa: E402  — the rig, and only the rig
import hub_nav_smoke as hns        # noqa: E402  — the nav roster, derived once

# ── Bounds ──────────────────────────────────────────────────────────────────
NAV_BOUND_MS = 6000        # an in-app transition slower than this has frozen
IDLE_SECONDS = 5           # R-27
# ⛔ The desktop tier. The canonical boundary is 1025px (breakpoints.js); below it
# the app renders MobileNav and the left NavBar does not exist at all.
VIEWPORT_W, VIEWPORT_H = 1440, 900
# ⛔⛔ COMMITS ARE THE DISCRIMINATOR. MUTATIONS ARE NOT.
#
# ⚰️ The first version of this failed /screener at 1,598 mutations in 5s against a
# 1,500 ceiling — and /screener had committed SEVEN renders in that window. Seven
# is quiet. The mutations were live price cells repainting, which is the product
# working; the looping tile on 2026-09-10 committed ~4,500 PER SECOND, i.e. about
# 22,500 across an idle like this one. A ceiling that cannot tell 7 from 22,500
# manufactured a finding on a healthy page — the same class of error this wave
# already paid for twice (`lesson_a_quantised_instrument_can_manufacture_a_finding`).
#
# So: a RENDER LOOP is defined by commits. Mutations stay as a second signal for a
# genuine runaway only, and the gap between the two is reported as NOISY —
# informational, never a failure.
COMMIT_CEILING = 60        # committed renders tolerated across the whole idle

# Measured basis, not a guess: the busiest surface in this app (/screener, live
# prices over a scan table) sits near 1,600 mutations per 5s idle. This is >12x
# that, so it catches a true runaway and stays silent about ordinary live data.
MUTATION_CEILING = 20000
MUTATION_NOISY = 1200      # above this it is REPORTED, and it is not a failure

# ⛔ Each entry is clicked from a known nav-bearing page. When the entry IS that
# page, clicking it correctly changes nothing — so the start moves. ⚰️ Without
# this, /dashboard reported "URL never changed within 6000ms", which is the
# nav-freeze signature, for a click that had nowhere to go. An instrument that
# cannot tell "did not move" from "was already there" invents the defect it was
# built to find.
NAV_START = "/dashboard"
NAV_START_ALT = "/breadth"

# ⛔ Routes R-27 names that are NOT nav entries, so `nav_items()` cannot find
# them. Stated explicitly rather than silently skipped. "Scanner" has no route of
# its own in this app — it is a /charts widget and part of /screener — so it is
# covered there, and that mapping is written down instead of assumed.
EXTRA_ROUTES = (
    ("/settings", "Settings"),
    ("/catalysts/history", "Catalysts"),
    ("/journal/notebook", "Notebook"),
)

PROBE_INIT = """
(() => {
  // React's own commit counter, installed before the app boots.
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || {
    renderers: new Map(), supportsFiber: true,
    inject: () => 1, onCommitFiberUnmount: () => {},
  };
  window.__uctCommits = 0;
  const prev = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function (...args) {
    window.__uctCommits++;
    if (typeof prev === 'function') { try { prev.apply(this, args); } catch {} }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

  window.__uctMutations = 0;
  const start = () => {
    try {
      new MutationObserver((m) => { window.__uctMutations += m.length; })
        .observe(document.documentElement,
                 {childList: true, subtree: true, attributes: true, characterData: true});
    } catch {}
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
"""

READ_PROBE = "() => ({commits: window.__uctCommits || 0, mutations: window.__uctMutations || 0})"

# The screen fingerprint: what a member would say changed. Deliberately NOT a
# per-route selector — a per-route selector is a hand-typed roster that goes
# stale, and this only has to answer "did the view change".
FINGERPRINT = """() => {
  const m = document.querySelector('main') || document.body;
  const t = (m.innerText || '').slice(0, 4000);
  return {chars: t.length, head: t.slice(0, 160)};
}"""

KEY_PROBE = """() => {
  const out = {};
  for (const k of ['uct.j2.offline.enabled', 'uct.nb.capture.enabled']) {
    try { out[k] = window.localStorage.getItem(k); } catch { out[k] = 'UNREADABLE'; }
  }
  return out;
}"""


def say(msg: str) -> None:
    print(msg, flush=True)


def measure_idle(page, seconds: int) -> dict:
    """Commits + DOM mutations accumulated across `seconds` of doing nothing."""
    before = page.evaluate(READ_PROBE)
    page.wait_for_timeout(seconds * 1000)
    after = page.evaluate(READ_PROBE)
    return {
        "commits": after["commits"] - before["commits"],
        "mutations": after["mutations"] - before["mutations"],
        "seconds": seconds,
    }


def stability_verdict(idle: dict) -> tuple[bool, str]:
    """(ok, detail). ⛔ Only a COMMIT storm, or a true mutation runaway, fails."""
    if idle["commits"] > COMMIT_CEILING:
        return False, (f"RENDER LOOP: {idle['commits']} React commits in "
                       f"{idle['seconds']}s idle (ceiling {COMMIT_CEILING})")
    if idle["mutations"] > MUTATION_CEILING:
        return False, (f"DOM RUNAWAY: {idle['mutations']} mutations in "
                       f"{idle['seconds']}s idle (ceiling {MUTATION_CEILING})")
    if idle["mutations"] > MUTATION_NOISY:
        # ⭐ Reported, NOT failed. Live data repainting is the product working, and
        # the commit count is what says whether React is looping.
        return True, (f"stable but NOISY ({idle['commits']} commits, "
                      f"{idle['mutations']} mutations — live data, not a loop)")
    return True, f"stable ({idle['commits']} commits, {idle['mutations']} mutations)"


def click_nav(page, entry: dict) -> tuple[str, str]:
    """Click one nav entry from wherever we are. Returns (status, detail)."""
    before_url = page.url
    before = page.evaluate(FINGERPRINT)
    link = page.locator('a[href="' + entry["to"] + '"]').first
    try:
        if link.count() == 0 or not link.is_visible():
            return "ABSENT", "not rendered for this account"
    except Exception as e:            # noqa: BLE001
        return "ABSENT", f"not interrogable ({type(e).__name__})"

    t0 = time.time()
    try:
        link.click(timeout=NAV_BOUND_MS)
    except Exception as e:            # noqa: BLE001
        return "FAIL", f"click did not complete: {type(e).__name__}"

    moved_url = moved_screen = False
    while (time.time() - t0) * 1000 < NAV_BOUND_MS:
        page.wait_for_timeout(150)
        if page.url != before_url:
            moved_url = True
        now = page.evaluate(FINGERPRINT)
        if now["head"] != before["head"] or abs(now["chars"] - before["chars"]) > 40:
            moved_screen = True
        if moved_url and moved_screen:
            return "PASS", f"{int((time.time() - t0) * 1000)}ms"
    if moved_url and not moved_screen:
        # ⛔ THIS IS THE 2026-09-10 DEFECT, EXACTLY.
        return "FAIL", ("URL moved and the SCREEN DID NOT within "
                        f"{NAV_BOUND_MS}ms — the nav-freeze signature")
    if not moved_url:
        return "FAIL", f"URL never changed within {NAV_BOUND_MS}ms"
    return "FAIL", "neither URL nor screen settled"


def self_check() -> int:
    """Rule 14: prove the verdicts can FAIL, without a browser."""
    bad = 0

    def case(name, ok):
        nonlocal bad
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad += 0 if ok else 1

    case("a quiet page is stable",
         stability_verdict({"commits": 3, "mutations": 40, "seconds": 5})[0] is True)
    case("⛔ a render loop FAILS",
         stability_verdict({"commits": 22000, "mutations": 9, "seconds": 5})[0] is False)
    case("⛔ a DOM runaway FAILS",
         stability_verdict({"commits": 1, "mutations": 99999, "seconds": 5})[0] is False)
    case("⭐ /screener's REAL numbers pass — 7 commits, 1598 mutations, measured",
         stability_verdict({"commits": 7, "mutations": 1598, "seconds": 5})[0] is True)
    case("⭐ ...and are reported as NOISY rather than silently swallowed",
         "NOISY" in stability_verdict({"commits": 7, "mutations": 1598, "seconds": 5})[1])
    case("⛔ CONTROL — the ceiling still separates 7 commits from the 2026-09-10 storm",
         stability_verdict({"commits": 22500, "mutations": 1598, "seconds": 5})[0] is False)
    case("⭐ CONTROL — the loop verdict names the number it saw",
         "22000" in stability_verdict({"commits": 22000, "mutations": 9, "seconds": 5})[1])
    case("the ceilings are not zero (a live ticker may legitimately move)",
         COMMIT_CEILING > 0 and MUTATION_CEILING > 0)
    case("the nav roster is DERIVED from NavBar.jsx, not typed here",
         len(hns.nav_items()) > 5)
    case("⛔ the extra routes name only what the nav cannot supply",
         all(r not in [e["to"] for e in hns.nav_items()] for r, _ in EXTRA_ROUTES))
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 1 if bad else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--idle", type=int, default=IDLE_SECONDS)
    ap.add_argument("--json", default=None)
    ap.add_argument("--reset-keys", action="store_true",
                    help="clear the per-browser opt-in keys before measuring "
                         "(a past run's opt-out leaves '0' behind, which is NOT unset)")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()

    entries = hns.nav_items()
    say(f"nav entries derived from NavBar.jsx: {len(entries)}")
    say("extra routes R-27 names that the nav cannot supply: "
        + ", ".join(r for r, _ in EXTRA_ROUTES))

    from playwright.sync_api import sync_playwright
    proc, endpoint, version = wc.spawn_rig()
    if not version:
        say("INCONCLUSIVE — the rig did not answer")
        return 2

    result = {"routes": [], "stability": [], "failures": [], "keys": None}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            ctx.add_init_script(PROBE_INIT)
            page = ctx.new_page()      # a NEW page, so the init script is in force
            # ⛔⛔ THE WIDTH IS PART OF THE MEASUREMENT, SO IT IS STATED.
            # The left `NavBar` exists only at >=1025px; at or below 1024 this app
            # renders `MobileNav` instead, whose entries live behind a menu button
            # and carry no `a[href]` until it is opened. The first run of this tool
            # reported all sixteen entries ABSENT for exactly that reason — a
            # confident "not rendered for this account" about a nav that was never
            # on screen. Pin the viewport rather than inherit whatever size the rig
            # window happens to have.
            page.set_viewport_size({"width": VIEWPORT_W, "height": VIEWPORT_H})
            page.goto(wc.PROD + "/dashboard", wait_until="domcontentloaded")
            page.wait_for_timeout(7000)
            say(f"viewport pinned to {VIEWPORT_W}x{VIEWPORT_H} (desktop NavBar tier)")

            keys = page.evaluate(KEY_PROBE)
            result["keys_as_found"] = keys
            say(f"\nopt-in keys on the rig, as found: {keys}")
            if any(v is not None for v in keys.values()):
                # ⛔⛔ '0' IS NOT 'UNSET', AND THE DIFFERENCE IS THE WHOLE POINT.
                # Today, with the default false, both behave the same. After the
                # flip the default is TRUE and a stored '0' means OPTED OUT — so a
                # rig carrying it would measure a product no member has. Past runs
                # leave these behind (the opt-out step writes '0'), which is why
                # this is checked before anything else is measured.
                if not a.reset_keys:
                    say("INCONCLUSIVE — an opt-in key is SET on this browser, so this "
                        "run would measure a different product from the member's.")
                    say("   Re-run with --reset-keys to clear them first.")
                    return 2
                page.evaluate("""() => {
                  for (const k of ['uct.j2.offline.enabled', 'uct.nb.capture.enabled']) {
                    try { window.localStorage.removeItem(k); } catch {}
                  }
                }""")
                page.reload(wait_until="domcontentloaded")
                page.wait_for_timeout(7000)
                keys = page.evaluate(KEY_PROBE)
                say(f"--reset-keys: cleared, re-read as {keys}")
                if any(v is not None for v in keys.values()):
                    say("INCONCLUSIVE — the keys did not clear.")
                    return 2
            result["keys"] = keys

            signed_in = page.evaluate(
                "async () => (await fetch('/api/auth/me',{credentials:'include'})).status")
            say(f"/api/auth/me: {signed_in}")
            if signed_in != 200:
                say("INCONCLUSIVE — the rig is not signed in; the nav renders almost "
                    "nothing for an anonymous visitor.")
                return 2

            # ── 1. every nav entry, CLICKED ────────────────────────────────
            say("\n── CLIENT-SIDE NAVIGATION (clicked, never goto) ──")
            clicked = 0
            for e in entries:
                # ⛔⛔ RETURN TO A NAV-BEARING PAGE FIRST.
                # ⚰️ Without this the run reported ELEVEN entries as "not rendered
                # for this account": the fifth click landed on a surface that does
                # not render the left nav, so every later lookup found nothing and
                # said so confidently. That is a cascade, not a finding — and it
                # reads exactly like a paid-gate result, which is what makes it
                # dangerous. Each entry is now clicked from the same known start,
                # so ABSENT means absent FOR THIS ACCOUNT and nothing else.
                start = NAV_START if e["to"] != NAV_START else NAV_START_ALT
                if page.url.rstrip("/") != wc.PROD + start:
                    page.goto(wc.PROD + start, wait_until="domcontentloaded")
                    page.wait_for_timeout(2500)
                status, detail = click_nav(page, e)
                result["routes"].append({"to": e["to"], "label": e["label"],
                                         "status": status, "detail": detail})
                say(f"  {status:7} {e['to']:20} {detail}")
                if status == "PASS":
                    clicked += 1
                elif status == "FAIL":
                    result["failures"].append(f"{e['to']}: {detail}")

            if clicked == 0:
                say("\nINCONCLUSIVE — no nav entry was clickable in this session.")
                return 2

            # ── 2. the routes the nav cannot reach ─────────────────────────
            say("\n── ROUTES R-27 NAMES THAT ARE NOT NAV ENTRIES ──")
            for route, label in EXTRA_ROUTES:
                page.goto(wc.PROD + route, wait_until="domcontentloaded")
                page.wait_for_timeout(4000)
                fp = page.evaluate(FINGERPRINT)
                ok = fp["chars"] > 80
                result["routes"].append({"to": route, "label": label,
                                         "status": "PASS" if ok else "FAIL",
                                         "detail": f"{fp['chars']} chars"})
                say(f"  {'PASS' if ok else 'FAIL':7} {route:22} rendered {fp['chars']} chars")
                if not ok:
                    result["failures"].append(f"{route}: rendered {fp['chars']} chars")

            # ── 3. render stability on the surfaces carrying shared hooks ──
            say(f"\n── RENDER STABILITY ({a.idle}s idle each) ──")
            for route in ("/dashboard", "/charts", "/screener", "/journal"):
                page.goto(wc.PROD + route, wait_until="domcontentloaded")
                page.wait_for_timeout(6000)          # let first paint settle
                idle = measure_idle(page, a.idle)
                ok, detail = stability_verdict(idle)
                result["stability"].append({"route": route, **idle, "ok": ok,
                                            "detail": detail})
                say(f"  {'PASS' if ok else 'FAIL':7} {route:14} {detail}")
                if not ok:
                    result["failures"].append(f"{route}: {detail}")
    finally:
        wc.teardown()

    if a.json:
        pathlib.Path(a.json).write_text(json.dumps(result, indent=2), encoding="utf-8")
        say(f"\nrecorded → {a.json}")

    if result["failures"]:
        say(f"\n⛔⛔ FAILED — {len(result['failures'])} finding(s). This is H4: roll back first.")
        for f in result["failures"]:
            say(f"   · {f}")
        return 1
    say(f"\n✅ PASS — {len(result['routes'])} routes navigated, "
        f"{len(result['stability'])} surfaces stable across {a.idle}s idle.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
