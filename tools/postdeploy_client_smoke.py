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
                     or an opt-in key was set), OR a nav link was in the DOM but
                     still not visible after the retry (`absent_verdict`). NOT a
                     pass and NOT a product failure — "we could not compute it"
                     and "something broke" are different facts to whoever reads
                     this.

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
# ⛔⛔ A LINK NOT VISIBLE AT FIRST LOOK IS LOOKED AT AGAIN BEFORE ANYTHING IS SAID ABOUT IT.
# ⚰️ 2026-11-17 (and 2026-09-25 before it): one run printed SEVEN nav entries "not rendered for
# this account" — Desk, Journal, Community, Support among them — and the next run on the same
# account, viewport and tool clicked all seven. Read-only probes found every one in the DOM
# (43x28, inside a 900px nav that does not overflow) and visible 0.13-0.56 s after any load. A
# silently-absent TAIL is exactly where a real nav freeze would hide, and the old line read
# like a paid-gate result. So: "not rendered for this account" is printed ONLY when the link is
# absent from the DOM after this retry; a link that is in the DOM and still not visible is
# INCONCLUSIVE (exit 2), with its evidence recorded (`link_state`).
ABSENT_RETRY_MS = 2000
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
# ⚰️ AND 60 COMMITS PER IDLE WAS THE SAME MISTAKE ONE LEVEL UP — MEASURED 2026-09-25. During
# the session, /charts (a five-widget board, 15 canvases) idled at 51 / 63 / 86 commits per 5 s
# on three runs and this tool printed "RENDER LOOP … H4: roll back first" twice, on a change
# that touches no file /charts imports, while every navigation — /charts included — PASSED.
# The controlled experiment (docs/terminal-research/10-roadmap/evidence/2026-09-25-charts-
# commit-ceiling/): same build, same minute, the live tape removed at the NETWORK (stream,
# live-prices and snapshot requests aborted) → 10 / 10 / 5 commits; tape on → 86 / 67 / 88.
# The commits ARE the tape repainting the board, ~15 per second; the 2026-09-10 loop ran
# ~4,500 per second. A ceiling of 60 per 5 s cannot tell a live market from a loop — exactly
# the mutation mistake above, repeated for commits. So commits get the same two-band shape:
# above COMMIT_NOISY they are REPORTED as live data, above COMMIT_CEILING they FAIL.
# 600 per 5 s is 120/s: 7× the busiest live reading measured (88) and 37× under the loop's
# ~22,500. ⛔ Do not re-tune either number from the next single run; re-derive from an
# experiment like the one cited, which is what these numbers came from.
# ⚠️ The first no-tape arm of that experiment used the app's own kill switches
# (`uct.barsPush.enabled=0`, `uct.ssePool.disabled=1`) and read 77–88 — those keys RE-ROUTE
# live data (Finnhub poll, legacy per-instance SSE), they do not remove it. Withdrawn.
COMMIT_NOISY = 60          # above this it is REPORTED as live data, and it is not a failure
COMMIT_CEILING = 600       # above this React is looping, whatever the tape is doing

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
#
# ⚰️ 2026-11-16, THE SAME DEFECT BY ANOTHER DOOR. `/dashboard` became a redirect to
# `/charts` (App.jsx), so the "known start" silently BECAME the first nav entry and
# `/charts` reported "URL never changed within 6000ms" + "H4: roll back first" on a
# healthy production build. Comparing the entry with the NAME of the start cannot see
# that: the start has to be judged by where the browser actually LANDED
# (`landed_on_target`), and the starts are now two real pages that redirect nowhere.
NAV_START = "/breadth"
NAV_START_ALT = "/screener"


def landed_on_target(current_url: str, target: str) -> bool:
    """Is the browser ALREADY on the page this click is meant to reach?

    Judged from the address the browser reports, never from the address it was sent to:
    a start page that redirects lands somewhere else. Query and trailing slash ignored."""
    try:
        path = "/" + (current_url or "").split("://", 1)[-1].split("/", 1)[1]
    except IndexError:
        path = "/"
    path = path.split("?", 1)[0].split("#", 1)[0].rstrip("/") or "/"
    return path == ((target or "").rstrip("/") or "/")

# ⛔ Routes R-27 names that are NOT nav entries, so `nav_items()` cannot find
# them. Stated explicitly rather than silently skipped. "Scanner" has no route of
# its own in this app — it is a /charts widget and part of /screener — so it is
# covered there, and that mapping is written down instead of assumed.
EXTRA_ROUTES = (
    ("/settings", "Settings"),
    # ⚰️ ("/catalysts/history", "Catalysts") lived here until 2026-09-24. It became a
    # real sidebar entry on 2026-09-21 (NAV_ITEMS, 19 entries), so the nav sweep already
    # clicks it and the self-check case "the extra routes name only what the nav cannot
    # supply" was red for three days. The list is what the nav CANNOT reach — nothing else.
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
    if idle["mutations"] > MUTATION_NOISY or idle["commits"] > COMMIT_NOISY:
        # ⭐ Reported, NOT failed. Live data repainting is the product working — in DOM
        # mutations AND in React commits (a live /charts board commits ~15/s during the
        # session, measured); only a commit count in the loop's own order of magnitude
        # says React is looping.
        return True, (f"stable but NOISY ({idle['commits']} commits, "
                      f"{idle['mutations']} mutations — live data, not a loop)")
    return True, f"stable ({idle['commits']} commits, {idle['mutations']} mutations)"


#: What a nav link's absence is made of: how many matching links the DOM holds, the first one's
#: box, the first ancestor that hides it (display:none, visibility:hidden or inert), and how long
#: after the last full page load this look happened. ⛔ Kept as evidence on every ABSENT and
#: INCONCLUSIVE row, so a reader can tell "not in the page" from "in the page, not showing".
LINK_STATE_JS = """(href) => {
  const els = [...document.querySelectorAll('a[href="' + href + '"]')];
  const out = {count: els.length, box: null, hiddenBy: null, msSinceLoad: Math.round(performance.now())};
  if (!els.length) return out;
  const el = els[0];
  const r = el.getBoundingClientRect();
  out.box = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cs = getComputedStyle(n);
    const cls = (n.getAttribute('class') || '').trim().split(' ')[0];
    const name = n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (cls ? '.' + cls : '');
    if (cs.display === 'none') { out.hiddenBy = 'display:none on ' + name; break; }
    if (cs.visibility === 'hidden') { out.hiddenBy = 'visibility:hidden on ' + name; break; }
    if (n.inert || n.hasAttribute('inert')) { out.hiddenBy = 'inert on ' + name; break; }
  }
  return out;
}"""


def link_state(page, href: str) -> dict:
    """The link's evidence (`LINK_STATE_JS`) plus Playwright's own visibility verdict."""
    link = page.locator('a[href="' + href + '"]').first
    state = page.evaluate(LINK_STATE_JS, href)
    state["visible"] = bool(state["count"]) and link.is_visible()
    return state


def absent_verdict(first: dict, retry: dict, waited_ms: int) -> tuple[str, str]:
    """(status, detail) for a nav link that was still not visible after the retry.

    ⛔ "not rendered for this account" ONLY when the link is absent from the DOM after the
    retry. In the DOM and not visible is INCONCLUSIVE: it is not a paid-gate result, and the
    evidence says why it could not be clicked."""
    last = retry or first
    if not last["count"]:
        return "ABSENT", f"not rendered for this account (absent from the DOM after a {waited_ms}ms retry)"
    return "INCONCLUSIVE", (
        f"in the DOM but not visible after a {waited_ms}ms retry: {last['count']} link(s), "
        f"box {last['box']}, {last['hiddenBy'] or 'no hiding ancestor (zero-size box?)'}, "
        f"{last['msSinceLoad']}ms since load (first look: {first['msSinceLoad']}ms, "
        f"{first['hiddenBy'] or 'no hiding ancestor'})")


def click_nav(page, entry: dict, retry_ms: int = ABSENT_RETRY_MS) -> tuple[str, str, dict]:
    """Click one nav entry from wherever we are. Returns (status, detail, evidence)."""
    before_url = page.url
    before = page.evaluate(FINGERPRINT)
    link = page.locator('a[href="' + entry["to"] + '"]').first
    evidence: dict = {}
    retried = ""
    try:
        first = link_state(page, entry["to"])
        if not first["visible"]:
            # ⭐ Look again, by polling, for up to `retry_ms` — at least once, so "after the
            # retry" is always true of whatever is said next.
            t_retry = time.time()
            retry = link_state(page, entry["to"])
            while not retry["visible"] and (time.time() - t_retry) * 1000 < retry_ms:
                page.wait_for_timeout(150)
                retry = link_state(page, entry["to"])
            waited = int((time.time() - t_retry) * 1000)
            evidence = {"first": first, "retry": retry, "waited_ms": waited}
            if not retry["visible"]:
                return (*absent_verdict(first, retry, waited), evidence)
            retried = f" (visible only after a {waited}ms retry)"
    except Exception as e:            # noqa: BLE001
        return "INCONCLUSIVE", f"not interrogable ({type(e).__name__})", evidence

    t0 = time.time()
    try:
        link.click(timeout=NAV_BOUND_MS)
    except Exception as e:            # noqa: BLE001
        return "FAIL", f"click did not complete: {type(e).__name__}{retried}", evidence

    moved_url = moved_screen = False
    while (time.time() - t0) * 1000 < NAV_BOUND_MS:
        page.wait_for_timeout(150)
        if page.url != before_url:
            moved_url = True
        now = page.evaluate(FINGERPRINT)
        if now["head"] != before["head"] or abs(now["chars"] - before["chars"]) > 40:
            moved_screen = True
        if moved_url and moved_screen:
            return "PASS", f"{int((time.time() - t0) * 1000)}ms{retried}", evidence
    if moved_url and not moved_screen:
        # ⛔ THIS IS THE 2026-09-10 DEFECT, EXACTLY.
        return "FAIL", ("URL moved and the SCREEN DID NOT within "
                        f"{NAV_BOUND_MS}ms — the nav-freeze signature{retried}"), evidence
    if not moved_url:
        return "FAIL", f"URL never changed within {NAV_BOUND_MS}ms{retried}", evidence
    return "FAIL", f"neither URL nor screen settled{retried}", evidence


def spawn_rig_or_reason(spawn=None):
    """`(spawned, None)` when the rig came up, `(None, why)` when it REFUSED to start.

    ⚰️ 2026-09-25: a chain ran this tool without `--profile`; `wc.spawn_rig()`
    raised its STOP (no rig profile at this checkout's default path) as a string
    `SystemExit`, which Python reports as exit **1** — the MEASURED-failure code,
    the one H15 rolls back on. Nothing had been measured. A rig that will not
    start is "rig down", which this tool's own contract files under exit 2
    (INCONCLUSIVE), so the refusal is converted here and the reason is kept.
    `spawn` is late-bound so the self-check can prove the conversion without a
    browser."""
    spawn = spawn or wc.spawn_rig
    try:
        return spawn(), None
    except SystemExit as e:
        return None, (str(e) or "the rig refused to start").strip()


def _app_source() -> str:
    """app/src/App.jsx, where a route that only redirects is declared."""
    try:
        return (pathlib.Path(__file__).resolve().parent.parent / "app" / "src" / "App.jsx").read_text(encoding="utf-8")
    except OSError:
        return ""


def redirects_elsewhere(route: str, app_source: str) -> bool:
    """Does App.jsx declare `route` as nothing but a `<Navigate>` to another page?"""
    import re
    return bool(re.search(r'path="%s"\s+element=\{<Navigate\b' % re.escape(route), app_source or ""))


#: The nav fixture for `--self-check`: a page whose link is in the DOM but hidden for ~600 ms
#: after load (the 2026-11-17 shape), one whose link never shows, one with no link, and the page
#: the link leads to. Served from an intercepted origin, so no network and no rig.
FIXTURE_ORIGIN = "http://r27-fixture.test"
_FIXTURE_LINK = '<nav><div class="navGroup"{hide}><a href="/x" id="l">Journal</a></div></nav>'
FIXTURE_PAGES = {
    "/late": ("<!doctype html><html><body>" + _FIXTURE_LINK.format(hide=' style="display:none"')
              + "<main>" + "Start page, the nav is still settling. " * 6 + "</main>"
              + "<script>setTimeout(() => { document.querySelector('.navGroup').style.display = '' }, 600)"
              + "</script></body></html>"),
    "/never": ("<!doctype html><html><body>" + _FIXTURE_LINK.format(hide=' style="display:none"')
               + "<main>" + "Start page, the link never shows. " * 6 + "</main></body></html>"),
    "/none": ("<!doctype html><html><body><nav></nav><main>" + "Start page, no such link. " * 6
              + "</main></body></html>"),
    "/x": ("<!doctype html><html><body><nav></nav><main>" + "Arrived: a different screen. " * 6
           + "</main></body></html>"),
}


def fixture_click_cases(retry_ms: int = ABSENT_RETRY_MS) -> dict:
    """`click_nav` against `FIXTURE_PAGES` in headless Chromium: {page: (status, detail, evidence)}."""
    from playwright.sync_api import sync_playwright
    out = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.route(FIXTURE_ORIGIN + "/**", lambda route: route.fulfill(
                status=200, content_type="text/html",
                body=FIXTURE_PAGES.get("/" + route.request.url.split("/", 3)[-1].split("?")[0], "")))
            for start in ("/late", "/never", "/none"):
                page.goto(FIXTURE_ORIGIN + start, wait_until="domcontentloaded")
                out[start] = click_nav(page, {"to": "/x"}, retry_ms=retry_ms)
        finally:
            browser.close()
    return out


def self_check() -> int:
    """Rule 14: prove the verdicts can FAIL — the nav cases in a real DOM, the rest without one."""
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
    case("⭐ /charts' REAL live-market numbers pass — 88 commits, measured 2026-09-25 with the tape on",
         stability_verdict({"commits": 88, "mutations": 1844, "seconds": 5})[0] is True)
    case("⭐ ...and are reported as NOISY, never silently swallowed",
         "NOISY" in stability_verdict({"commits": 88, "mutations": 40, "seconds": 5})[1])
    case("⛔ CONTROL — one commit over COMMIT_CEILING still FAILS, so the band has an edge",
         stability_verdict({"commits": COMMIT_CEILING + 1, "mutations": 40, "seconds": 5})[0] is False
         and stability_verdict({"commits": COMMIT_CEILING, "mutations": 40, "seconds": 5})[0] is True)
    case("⭐ CONTROL — the loop verdict names the number it saw",
         "22000" in stability_verdict({"commits": 22000, "mutations": 9, "seconds": 5})[1])
    case("the ceilings are not zero (a live ticker may legitimately move)",
         COMMIT_CEILING > 0 and MUTATION_CEILING > 0)
    case("the nav roster is DERIVED from NavBar.jsx, not typed here",
         len(hns.nav_items()) > 5)
    case("⛔ the extra routes name only what the nav cannot supply",
         all(r not in [e["to"] for e in hns.nav_items()] for r, _ in EXTRA_ROUTES))
    case("⛔ a start page that REDIRECTED onto the entry is seen by where the browser landed",
         landed_on_target("https://uctintelligence.com/charts", "/charts")
         and landed_on_target("https://uctintelligence.com/charts/?x=1#top", "/charts")
         and landed_on_target("https://uctintelligence.com/desk?section=posts", "/desk"))
    case("⭐ CONTROL — a different page, a deeper page and a look-alike are NOT the entry",
         not landed_on_target("https://uctintelligence.com/breadth", "/charts")
         and not landed_on_target("https://uctintelligence.com/charts/popout", "/charts")
         and not landed_on_target("https://uctintelligence.com/chartsx", "/charts")
         and not landed_on_target("", "/charts"))
    case("⛔ neither start is a route that App.jsx redirects elsewhere",
         _app_source() != "" and not any(redirects_elsewhere(s, _app_source()) for s in (NAV_START, NAV_START_ALT)))
    case("⭐ CONTROL — that check CAN see a redirect, and does not see one in an ordinary route",
         redirects_elsewhere("/old", '<Route path="/old" element={<Navigate to="/new" replace />} />')
         and not redirects_elsewhere("/new", '<Route path="/new" element={<Page />} />')
         and not redirects_elsewhere("/old", '<Route path="/older" element={<Navigate to="/new" replace />} />'))
    refused = spawn_rig_or_reason(spawn=lambda: (_ for _ in ()).throw(SystemExit("STOP: no rig profile at X")))
    case("⛔ a rig that REFUSES to start is a reason, not a measurement (→ exit 2, never 1)",
         refused[0] is None and "no rig profile" in refused[1])
    case("⭐ CONTROL — a rig that starts is passed through untouched",
         spawn_rig_or_reason(spawn=lambda: ("proc", "ws://x", "v"))[0] == ("proc", "ws://x", "v"))

    # ── a nav link that is not visible: absent for the account, or present and not showing ──
    gone = {"count": 0, "box": None, "hiddenBy": None, "msSinceLoad": 2900, "visible": False}
    hidden = {"count": 1, "box": [0, 557, 0, 0], "hiddenBy": "display:none on div.navGroup",
              "msSinceLoad": 2900, "visible": False}
    case("⛔ a link ABSENT from the DOM after the retry is 'not rendered for this account'",
         absent_verdict(gone, gone, 2000)[0] == "ABSENT"
         and "for this account" in absent_verdict(gone, gone, 2000)[1])
    case("⛔⛔ a link IN the DOM and not visible is INCONCLUSIVE, never a paid-gate result",
         absent_verdict(hidden, hidden, 2000)[0] == "INCONCLUSIVE"
         and "for this account" not in absent_verdict(hidden, hidden, 2000)[1])
    case("⭐ ...and its evidence names the count, the box, the hiding ancestor and the time",
         all(s in absent_verdict(hidden, hidden, 2000)[1]
             for s in ("1 link(s)", "[0, 557, 0, 0]", "display:none on div.navGroup", "2900ms since load")))
    try:
        real = fixture_click_cases()
        mutant = fixture_click_cases(retry_ms=0)      # ⛔ the retry REMOVED
    except Exception as e:                            # noqa: BLE001 — a fixture that cannot run is RED, never skipped
        real = mutant = {}
        print(f"  (the nav fixture could not run: {type(e).__name__}: {e})")
    late, late0 = real.get("/late"), mutant.get("/late")
    case("⭐⭐ FIXTURE — a link hidden for ~600 ms after load PASSES after the retry, and says so",
         bool(late) and late[0] == "PASS" and "retry" in late[1])
    case("⭐ ...the fixture really was hidden at first look (else this case proves nothing)",
         bool(late) and late[2].get("first", {}).get("visible") is False
         and late[2]["first"]["count"] == 1 and late[2]["first"]["msSinceLoad"] < 600)
    case("⛔⛔ MUTATION — the retry REMOVED, the same link reads INCONCLUSIVE, not 'absent for this account'",
         bool(late0) and late0[0] == "INCONCLUSIVE" and "for this account" not in late0[1])
    case("⛔ FIXTURE — a link that never shows is INCONCLUSIVE, its hiding ancestor named",
         bool(real.get("/never")) and real["/never"][0] == "INCONCLUSIVE"
         and "display:none on div.navGroup" in real["/never"][1])
    case("⭐ CONTROL — a link the page does not have is 'not rendered for this account'",
         bool(real.get("/none")) and real["/none"][0] == "ABSENT"
         and "for this account" in real["/none"][1])
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
    ap.add_argument("--allow-cold", action="store_true",
                    help="judge a pod younger than hub_nav_smoke.COLD_POD_FLOOR_S anyway")
    ap.add_argument("--profile", default=None,
                    help="the ONE canonical rig profile; else UCT_Q1_RIG_PROFILE, else this "
                         "checkout's own .worktrees/ default (a SIGNED-OUT one from any other worktree)")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()

    # ⚰️ 2026-09-24: this entry point spawned the rig on window_check's module DEFAULT
    # and never consulted `--profile` / UCT_Q1_RIG_PROFILE — so run from any worktree
    # but the main one it refused with a STOP whose own text promised those two doors.
    # Same resolution as window_check's main (CLI beats env beats default).
    wc.use_profile(wc.resolve_profile(a.profile))

    # Same floor as hub_nav_smoke, same reason (see COLD_POD_FLOOR_S there): a run on a pod
    # under three minutes old measures the boot, and R-27's "within ten minutes" leaves room.
    verdict = hns.cold_pod_verdict(hns.pod_age_seconds(wc.PROD), allow_cold=a.allow_cold)
    if verdict:
        say(verdict)
        return 2

    entries = hns.nav_items()
    say(f"nav entries derived from NavBar.jsx: {len(entries)}")
    say("extra routes R-27 names that the nav cannot supply: "
        + ", ".join(r for r, _ in EXTRA_ROUTES))

    from playwright.sync_api import sync_playwright
    spawned, why = spawn_rig_or_reason()
    if spawned is None:
        say(f"INCONCLUSIVE — the rig refused to start: {why}")
        return 2
    proc, endpoint, version = spawned
    if not version:
        say("INCONCLUSIVE — the rig did not answer")
        return 2

    result = {"routes": [], "stability": [], "failures": [], "inconclusive": [], "keys": None}
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
                # ⛔ Where it LANDED, not where it was sent: a start that redirects onto the
                # entry leaves the click with nowhere to go (see NAV_START).
                if landed_on_target(page.url, e["to"]):
                    start = NAV_START_ALT if start != NAV_START_ALT else NAV_START
                    page.goto(wc.PROD + start, wait_until="domcontentloaded")
                    page.wait_for_timeout(2500)
                status, detail, evidence = click_nav(page, e)
                result["routes"].append({"to": e["to"], "label": e["label"],
                                         "status": status, "detail": detail,
                                         **({"evidence": evidence} if evidence else {})})
                say(f"  {status:7} {e['to']:20} {detail}")
                if status == "PASS":
                    clicked += 1
                elif status == "FAIL":
                    result["failures"].append(f"{e['to']}: {detail}")
                elif status == "INCONCLUSIVE":
                    result["inconclusive"].append(f"{e['to']}: {detail}")

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
    if result["inconclusive"]:
        # ⛔ Not a pass: a nav entry was in the page and could not be clicked, so whether it
        # navigates was never measured. Not a failure either: nothing broke that was seen.
        say(f"\nINCONCLUSIVE — {len(result['inconclusive'])} nav entr(y/ies) in the DOM but "
            "not visible after the retry, so never clicked:")
        for f in result["inconclusive"]:
            say(f"   · {f}")
        return 2
    say(f"\n✅ PASS — {len(result['routes'])} routes navigated, "
        f"{len(result['stability'])} surfaces stable across {a.idle}s idle.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
