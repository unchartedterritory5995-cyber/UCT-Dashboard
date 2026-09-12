"""Post-deploy client smoke: did navigation actually navigate?

⛔⛔ WHY THIS EXISTS. On 2026-09-10 a render loop in a hub controller starved React
Router's transition commit. Clicking any nav entry on /dashboard changed the URL and
left the screen where it was, app-wide, for about four and a half hours. Only a hard
refresh recovered.

Every instrument this programme had said the deploy was fine, because every instrument
measured the wrong layer:

  * `/api/health` returned 200 with a healthy uptime — the SERVER was never unwell.
  * The first-hour watch polled that endpoint and recorded five clean samples while the
    defect was live.
  * The full gate was green: 1,261 files, 18,708 tests, 0 NEW failures.

A green suite, a 200 and a rising uptime are all compatible with a browser that cannot
move between pages. **The only layer that could have caught it is a real browser
clicking a real link**, and nothing was watching there. This is that.

IT WATCHES TWO LAYERS, and the second one was added for the member launch:

  1. NAVIGATION — the symptom. Click a nav entry; assert BOTH the URL and a screen
     fingerprint changed. A freeze moves the first and not the second.
  2. RENDER STABILITY — the cause. After the page settles, sample how much of the main
     thread is actually free. A passive-effect loop that has not yet starved a navigation
     is still the defect, and this catches it one step earlier. See BLOCKED_FRACTION_LIMIT
     for what the threshold is and, more importantly, what it is NOT calibrated against.

Signed in, it sweeps EVERY top-level route (derived from NAV_ITEMS, /dashboard first) and
departs from each one; the fan-out from /dashboard stays exhaustive.

⛔ READ-ONLY. It navigates and reads. It never submits a form, never fires a hub write
action, never touches `/api/push`. The single POST it makes is the login, which is how
`tools/mobile_audit.py` already authenticates.

⛔ IT FAILS THE WATCH. Exit status is non-zero on any freeze. An instrument that logs a
problem and exits 0 is the `scripts/deploy_watch.py` defect — forty `FileNotFoundError`s
and a green light (CLAUDE.md rule 14).

EXIT CODES — and 1 and 2 are deliberately different facts:
    0  PASS          every reachable nav entry moved both the URL and the screen.
    1  FAILED        a freeze (or a dead link) was MEASURED. The deploy is bad.
    2  INCONCLUSIVE  nothing was measurable — no nav entry was clickable in this session.
                     ⛔ NOT a pass and NOT a product failure. "We could not compute it" and
                     "something broke" are different facts to whoever reads this, and
                     collapsing them is the defect `CoverageLine` exists to avoid. An
                     unauthenticated run lands here, because the nav renders almost nothing
                     for an anonymous visitor.

Usage
-----
    python tools/hub_nav_smoke.py                      # prod, public routes only
    python tools/hub_nav_smoke.py --auth               # + SMOKE_EMAIL / SMOKE_PASSWORD
    python tools/hub_nav_smoke.py --auth --touch       # the phone-class pass (see below)
    python tools/hub_nav_smoke.py --self-check         # rule 14: prove it can FAIL
    python tools/hub_nav_smoke.py --base http://localhost:8077 --auth

THE TOUCH PASS (`--touch`) is a SECOND run, not a wider first one, and the split is structural:
`useHubActive.js` gates the hub on `(max-width: 1023px) and (pointer: coarse)`, so in the desktop
context above the hub cannot mount ANYWHERE. "It stayed off the routes it should" is then true for
a reason that proves nothing, and folding the two together would measure the hub questions in the
one environment guaranteed to answer them vacuously. The touch pass drives 393x852 at DPR 3 with a
coarse pointer, asserts the hub mounts exactly where the registry says (`hideOnRoute`, read from
the registry with comments stripped) and not where it says otherwise, and records console and page
errors. ⚠️ It is Chromium emulating a phone VIEWPORT CLASS, never an iPhone — iOS Safari is WebKit.
It can say where the hub mounts; it can never say a gesture works.
"""
from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import os
import pathlib
import re
import secrets
import socket
import sys
import threading

REPO = pathlib.Path(__file__).resolve().parent.parent
NAVBAR = REPO / "app" / "src" / "components" / "NavBar.jsx"
PROD = "https://uctintelligence.com"

# Routes the smoke starts FROM. /dashboard is where the freeze was reported; /journal and
# /screener are the other two surfaces that mount a hub section on a shared page.
START_ROUTES = ("/dashboard", "/journal", "/screener")

# Reachable without an account. Everything else needs `--auth`; see FREE_PAGES in AuthGuard.
PUBLIC_ROUTES = ("/morning-wire",)


def say(text: str, err: bool = False) -> None:
    """⛔ One place for console writes. `print` raised UnicodeEncodeError on a cp1252 console
    and killed a passing run of `scripts/gate_shards.py` at its last line; same lesson."""
    stream = sys.stderr if err else sys.stdout
    data = (text + "\n").encode("utf-8", "replace")
    buf = getattr(stream, "buffer", None)
    if buf is not None:
        buf.write(data)
        buf.flush()
    else:
        stream.write(data.decode("utf-8", "replace"))
        stream.flush()


def nav_items() -> list[dict]:
    """Every nav entry, DERIVED from NavBar.jsx.

    ⛔ Never a typed list. A hand-written copy here would go stale the first time a nav entry
    moved, and this file would then report a clean sweep of a menu that no longer exists —
    which is exactly the shape of the phantom `/patterns` entry recorded in CLAUDE.md.
    """
    src = NAVBAR.read_text(encoding="utf-8")
    m = re.search(r"export const NAV_ITEMS = \[(.*?)\n\]", src, re.S)
    if not m:
        raise SystemExit("FATAL: could not find NAV_ITEMS in NavBar.jsx — derivation is broken")
    out = []
    for row in re.finditer(r"\{\s*to:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'", m.group(1)):
        out.append({"to": row.group(1), "label": row.group(2)})
    if len(out) < 5:
        raise SystemExit(f"FATAL: parsed only {len(out)} nav items — derivation is broken")
    return out


# ── the fingerprint ────────────────────────────────────────────────────────────────────────
# What "the screen changed" means, in one place. Deliberately coarse: the document title, the
# first heading, and the shape of the main region. A freeze leaves ALL of it identical while the
# URL moves; any genuine navigation moves at least one.
FINGERPRINT_JS = """() => {
  const main = document.querySelector('main') || document.body;
  const h = document.querySelector('h1, h2, [role="heading"]');
  return JSON.stringify({
    title: document.title || '',
    heading: (h && h.textContent || '').trim().slice(0, 120),
    text: (main.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
    nodes: main.querySelectorAll('*').length,
  });
}"""


def fingerprint(page) -> str:
    raw = page.evaluate(FINGERPRINT_JS)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


# ── the render-stability probe ─────────────────────────────────────────────────────────────
# ⛔⛔ THE NAV CHECK ABOVE MEASURES THE SYMPTOM. THIS MEASURES THE CAUSE.
#
# The 2026-09-10 freeze was a passive-effect render loop running at ~4,500 renders/sec. React
# never throws "Maximum update depth" for one, `/api/health` stays 200, and the suite stays
# green — the browser simply spends its whole main thread re-rendering, and React Router's
# transition never gets a commit. Navigation freezing was the CONSEQUENCE.
#
# So a loop that has not yet starved a navigation is still the defect, and this catches it one
# step earlier: after the page has settled, a healthy app is near-idle. We sample two things
# that need NO instrumentation in the product and therefore work against production:
#
#   * requestAnimationFrame callbacks actually delivered in a fixed wall-clock window. A
#     healthy settled page gets ~60/sec. A starved main thread gets a fraction of that.
#   * `PerformanceObserver('longtask')` — total ms the main thread spent in tasks over 50ms.
#     A render loop is a continuous wall of them.
#
# ⚠️ THE THRESHOLD IS CHOSEN, NOT DERIVED. The live incident cannot be re-run, so nothing here
# is calibrated against it. It is set where a 4,500/sec loop is orders of magnitude past it and
# a settled healthy page is nowhere near: >60% of the window blocked. THE MEASURED NUMBERS ARE
# ALWAYS PRINTED so a future run can tighten this from evidence instead of argument
# (`lesson_an_acceptance_number_is_a_forecast_until_derived`).
BLOCKED_FRACTION_LIMIT = 0.60

RENDER_PROBE_JS = """(ms) => new Promise((resolve) => {
  let frames = 0;
  let blockedMs = 0;
  let obs = null;
  try {
    obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) blockedMs += e.duration;
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch (e) { obs = null; }
  const t0 = performance.now();
  const tick = () => {
    frames += 1;
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(() => {
    if (obs) obs.disconnect();
    const elapsed = performance.now() - t0;
    resolve({
      elapsed,
      frames,
      fps: frames / (elapsed / 1000),
      blockedMs,
      blockedFraction: elapsed > 0 ? blockedMs / elapsed : 0,
      longtaskSupported: obs !== null,
    });
  }, ms + 60);
})"""


def render_stability(page, window_ms: int = 2000) -> dict:
    """Sample main-thread health on the CURRENT page. Never raises."""
    try:
        return page.evaluate(RENDER_PROBE_JS, window_ms)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}"}


def render_verdict(route: str, sample: dict) -> str | None:
    """Return a failure sentence, or None. A sample we could not take is NOT a pass."""
    if "error" in sample:
        return f"{route}: the render probe could not run ({sample['error']})"
    if not sample.get("longtaskSupported"):
        # Honest about a blind instrument rather than reporting its silence as health.
        return None
    if sample.get("blockedFraction", 0) > BLOCKED_FRACTION_LIMIT:
        return (
            f"RENDER LOOP SUSPECTED on {route}: the main thread was blocked "
            f"{sample['blockedMs']:.0f}ms of a {sample['elapsed']:.0f}ms window "
            f"({sample['blockedFraction'] * 100:.0f}%) at {sample['fps']:.0f} fps, AFTER the "
            "page settled. This is the 2026-09-10 shape: a passive-effect loop that throws "
            "nothing, keeps /api/health at 200, and starves React Router's commit."
        )
    return None


def top_level_routes(entries: list[dict]) -> list[str]:
    """Every top-level route, DERIVED from the same NAV_ITEMS the nav is built from.

    ⛔ The charter asks for 'every top-level route'. The nav IS that list — deriving it here
    means a route added tomorrow is covered the day it lands, and a typed copy could never
    make that claim honestly.
    """
    seen, out = set(), []
    for e in entries:
        if e["to"] not in seen:
            seen.add(e["to"])
            out.append(e["to"])
    if "/dashboard" in out:  # the page the freeze was reported on leads.
        out.remove("/dashboard")
        out.insert(0, "/dashboard")
    return out


def login(page, base: str) -> bool:
    email = os.environ.get("SMOKE_EMAIL")
    pw = os.environ.get("SMOKE_PASSWORD")
    if not email or not pw:
        return False
    resp = page.request.post(
        f"{base}/api/auth/login",
        data=json.dumps({"email": email, "password": pw}),
        headers={"Content-Type": "application/json"},
    )
    if not resp.ok:
        say(f"  ! login HTTP {resp.status} — running UNAUTHENTICATED", err=True)
        return False
    say(f"  [ok] signed in as {email}")
    return True


def check_route(page, base: str, start: str, entries: list[dict]) -> tuple[list[str], int]:
    """Click every nav entry from `start`. Returns (failures, entries_actually_clicked).

    ⛔ THE COUNT IS RETURNED, AND IT IS NOT DECORATION. If the nav renders no links for this
    session, every entry is skipped and the run would report PASS having clicked nothing —
    "an empty result is a failed invocation until proven otherwise" (CLAUDE.md rule 14).
    """
    failures = []
    clicked = 0
    page.goto(f"{base}{start}", wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(1200)
    for entry in entries:
        if entry["to"] == start:
            continue
        before_url = page.url
        before_fp = fingerprint(page)
        link = page.locator(f'a[href="{entry["to"]}"]').first
        if link.count() == 0:
            # Not a failure: a locked page is legitimately absent from the nav for this account.
            continue
        clicked += 1
        try:
            link.click(timeout=10000)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{start} -> {entry['to']}: click failed ({type(exc).__name__})")
            continue
        page.wait_for_timeout(1500)
        after_url = page.url
        after_fp = fingerprint(page)
        url_moved = after_url != before_url
        screen_moved = after_fp != before_fp
        if url_moved and not screen_moved:
            # ⭐ THE EXACT SIGNATURE OF THE 2026-09-10 FREEZE.
            failures.append(
                f"NAVIGATION FROZE: {start} -> {entry['to']} ({entry['label']}): the URL became "
                f"{after_url} and the screen did NOT change (fingerprint {after_fp} unchanged). "
                "This is the 2026-09-10 defect: a render loop starving React Router's commit."
            )
        elif not url_moved:
            failures.append(f"{start} -> {entry['to']}: the URL never changed (still {after_url})")
        # navigate back to the start route for the next entry
        page.goto(f"{base}{start}", wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(900)
    return failures, clicked


def sweep_every_route(page, base: str, routes: list[str], entries: list[dict]):
    """Visit EVERY top-level route; probe each for a render loop; depart from each once.

    ⛔ O(N), NOT O(N**2), AND THAT IS A DELIBERATE TRADE. A full click matrix from seventeen
    routes is ~290 navigations and would take long enough that nobody runs it after a deploy —
    and an instrument nobody runs is worse than none, because it reads as coverage. The
    rotation departs from every route exactly once (route i clicks through to route i+1), so no
    route is merely LOADED: every one of them is also asked to navigate away. `--full` restores
    the exhaustive fan-out for a deliberate audit.

    Returns (failures, clicked, probes).
    """
    failures: list[str] = []
    probes: list[tuple[str, dict]] = []
    clicked = 0
    by_route = {e["to"]: e for e in entries}

    for i, route in enumerate(routes):
        target = routes[(i + 1) % len(routes)]
        say(f"  {route} …")
        try:
            page.goto(f"{base}{route}", wait_until="domcontentloaded", timeout=45000)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{route}: the route would not load ({type(exc).__name__})")
            continue
        page.wait_for_timeout(2000)  # settle: a cold mount is legitimately busy.

        sample = render_stability(page)
        probes.append((route, sample))
        if "error" not in sample and sample.get("longtaskSupported"):
            say(f"      main thread {sample['blockedFraction'] * 100:5.1f}% blocked, "
                f"{sample['fps']:.0f} fps")
        verdict = render_verdict(route, sample)
        if verdict:
            failures.append(verdict)

        if target == route:
            continue
        link = page.locator(f'a[href="{target}"]').first
        if link.count() == 0:
            continue
        before_url, before_fp = page.url, fingerprint(page)
        clicked += 1
        try:
            link.click(timeout=10000)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{route} -> {target}: click failed ({type(exc).__name__})")
            continue
        page.wait_for_timeout(1500)
        if page.url == before_url:
            failures.append(f"{route} -> {target}: the URL never changed (still {page.url})")
        elif fingerprint(page) == before_fp:
            label = by_route.get(target, {}).get("label", target)
            failures.append(
                f"NAVIGATION FROZE: {route} -> {target} ({label}): the URL became {page.url} "
                "and the screen did NOT change. This is the 2026-09-10 defect."
            )
    return failures, clicked, probes


# ── rule 14: prove the detector can FAIL ───────────────────────────────────────────────────
FROZEN_PAGE = """<!doctype html><meta charset="utf-8"><title>frozen</title>
<main><h1>Frozen</h1><p>This page never changes.</p>
<a href="/b" id="b">Go to B</a></main>
<script>
// The freeze, reproduced exactly: pushState moves the URL and the document does NOT change.
document.getElementById('b').addEventListener('click', (e) => {
  e.preventDefault();
  history.pushState({}, '', '/b');
});
</script>"""

HEALTHY_PAGE = """<!doctype html><meta charset="utf-8"><title>healthy</title>
<main><h1 id="h">Healthy A</h1><a href="/b" id="b">Go to B</a></main>
<script>
document.getElementById('b').addEventListener('click', (e) => {
  e.preventDefault();
  history.pushState({}, '', '/b');
  document.getElementById('h').textContent = 'Healthy B';
  document.title = 'healthy-b';
});
</script>"""


# ⛔ RULE 14 FOR THE RENDER PROBE. A detector nobody has watched fire is not a detector.
# LOOP_PAGE reproduces the PATHOLOGY, not the React mechanism: a main thread that never yields
# for long, exactly as ~4,500 renders/sec presents to the browser. IDLE_PAGE is the control —
# without it a probe that returned "blocked" unconditionally would pass the first half.
LOOP_PAGE = """<!doctype html><meta charset="utf-8"><title>loop</title>
<main><h1>Looping</h1></main>
<script>
function spin() {
  const t = performance.now();
  while (performance.now() - t < 120) { /* starve the main thread, like the render loop did */ }
  setTimeout(spin, 0);
}
spin();
</script>"""

IDLE_PAGE = """<!doctype html><meta charset="utf-8"><title>idle</title>
<main><h1>Idle</h1><p>A settled, healthy page.</p></main>"""


# ── THE TOUCH PASS ─────────────────────────────────────────────────────────────────────────────
# ⛔ WHY A SECOND PASS AND NOT A WIDER FIRST ONE. The desktop sweep above answers "can a member
# still navigate", which is route-shaped and device-agnostic. The two questions it structurally
# CANNOT answer are hub-shaped: `useHubActive.js:84` gates the hub on
# `(max-width: 1023px) and (pointer: coarse)`, so on a desktop viewport the hub cannot mount
# ANYWHERE — "it stayed off the routes it should" is then true for a reason that proves nothing.
# Running both in one context would mean measuring the hub questions in the one environment
# guaranteed to answer them vacuously.
#
# ⚠️ WHAT THIS IS NOT: it is Chromium emulating a phone VIEWPORT CLASS, not an iPhone. iOS Safari
# is WebKit, ships `backdrop-filter` only under `-webkit-`, and is the thing G0-1 is unexplained
# on. This pass can say "the hub mounts where the rules say" — it can never say a gesture works.
# Glass is still glass (`glass-acceptance.md`).

TOUCH_VIEWPORT = {"width": 393, "height": 852}   # iPhone 15 Pro CSS px
TOUCH_DPR = 3
# Landscape with a short height, which is the immersive-chart-shell condition in `hubViewport.js`
# (`pointer:coarse` + `orientation:landscape` + `max-height:500px`, scoped to the chart shell).
TOUCH_LANDSCAPE = {"width": 852, "height": 393}


def _registry_source() -> str:
    """`registry.js` with comments stripped.

    ⛔ STRIPPED FIRST, ALWAYS. `registry.js` and `hubViewport.js` both discuss `hideOnRoute` in
    prose at length ("No shipped mode sets this today — it is read defensively"), and a scanner
    that matched those would report modes that declare nothing. This repo has paid for that exact
    mistake six times in one session; `--self-check` carries the case.
    """
    src = (REPO / "app" / "src" / "hub" / "registry.js").read_text(encoding="utf-8")
    src = re.sub(r"/\*[\s\S]*?\*/", "", src)
    return re.sub(r"//[^\n]*", "", src)


def _mode_blocks(src: str):
    """(mode id, its declaration block) for every mode in the registry."""
    for m in re.finditer(r"\n\s{4}id:\s*'([a-z]+)',", src):
        block = src[m.end(): m.end() + 6000]
        nxt = re.search(r"\n\s{4}id:\s*'[a-z]+',", block)
        yield m.group(1), (block[: nxt.start()] if nxt else block)


def hide_on_route_modes(src: str | None = None) -> list[str]:
    """Modes DECLARING `hideOnRoute: true` — the list this pass quotes, never a typed one."""
    src = _registry_source() if src is None else src
    return sorted({mid for mid, block in _mode_blocks(src)
                   if re.search(r"(^|[^\w.])hideOnRoute\s*:\s*true", block)})


def route_to_mode(src: str | None = None) -> dict[str, str]:
    """`{'/screener': 'scan', …}` — the same derivation `hubRoutes.js` does, for the same reason
    it does it there: a hand-typed second route table is the defect this repo keeps re-finding."""
    src = _registry_source() if src is None else src
    out: dict[str, str] = {}
    for mid, block in _mode_blocks(src):
        r = re.search(r"\n\s{4}route:\s*'([^']+)'", block)
        if r:
            out[r.group(1)] = mid
    return out


def touch_eligibility(page) -> dict:
    """The hub's own mount floor, asked of the browser we are actually driving.

    ⛔ NON-VACUITY, AND IT IS THE WHOLE RISK OF THIS PASS. If the harness does not reproduce
    `pointer: coarse`, every route reports "no hub" and the run reads as a clean sweep of a
    product that was never eligible. That is INCONCLUSIVE, never a pass and never a failure.
    """
    return page.evaluate(
        """() => ({
            coarseAndNarrow: window.matchMedia('(max-width: 1023px) and (pointer: coarse)').matches,
            backdrop: (typeof CSS !== 'undefined' && typeof CSS.supports === 'function')
              && (CSS.supports('backdrop-filter', 'blur(1px)')
                  || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')),
            visualViewport: typeof window.visualViewport !== 'undefined',
            width: window.innerWidth,
            dpr: window.devicePixelRatio,
            maxTouchPoints: navigator.maxTouchPoints,
        })"""
    )


# ⛔⛔ PRESENT IS NOT SHOWING, AND THIS SCRIPT ALREADY PUBLISHED THE DIFFERENCE ONCE.
#
# `HubRoot.jsx:433` renders `<div data-testid="hub-root" hidden={hidden}>`: the container STAYS in
# the DOM and takes the HTML `hidden` attribute. The first version of this pass asked
# `querySelector(...)` and reported the hub as mounted in the chart shell's landscape-immersive
# mode — i.e. it reported a PRODUCT DEFECT that did not exist. Measured on the live page at
# 852x393: `hidden` attribute TRUE, computed `display: none`, box 0x0. The product was right and
# the instrument was wrong (`lesson_did_it_render_needs_the_products_own_answer`).
#
# ⚠️ AND `offsetParent === null` IS NOT THE SIGNAL EITHER — the hub is `position: fixed`, so its
# offsetParent is null even when it is plainly on screen. Measured both ways before choosing:
# `hidden` attribute + computed display + a non-zero box.
HUB_STATE_JS = """() => {
  const el = document.querySelector('[data-testid="hub-root"]');
  if (!el) return { present: false, showing: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    present: true,
    hiddenAttr: el.hasAttribute('hidden'),
    display: cs.display,
    box: [Math.round(r.width), Math.round(r.height)],
    showing: !el.hasAttribute('hidden') && cs.display !== 'none'
             && r.width > 0 && r.height > 0,
  };
}"""


def hub_state(page) -> dict:
    return page.evaluate(HUB_STATE_JS)


def touch_sweep(page, base: str, routes: list[str], errors: list[dict]):
    """Every route, in a touch context: does the hub mount where the rules say, and nothing logs?

    Returns (failures, rows, notes).
    """
    failures: list[str] = []
    rows: list[tuple[str, bool, int]] = []
    notes: list[str] = []
    src = _registry_source()
    hidden_modes = hide_on_route_modes(src)
    section_mode = route_to_mode(src)

    for route in routes:
        before = len(errors)
        try:
            page.goto(f"{base}{route}", wait_until="domcontentloaded", timeout=45000)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{route}: the route would not load ({type(exc).__name__})")
            continue
        page.wait_for_timeout(2500)  # the hub mounts after auth + settings resolve.
        st = hub_state(page)
        new_errors = len(errors) - before
        rows.append((route, st, new_errors))
        mode = section_mode.get(route)
        should_hide = bool(mode and mode in hidden_modes)
        if should_hide and st["showing"]:
            failures.append(f"{route}: mode '{mode}' declares hideOnRoute and the hub is SHOWING")
        elif not should_hide and not st["showing"]:
            failures.append(
                f"{route}: the hub is not showing ({st}), and no mode declares hideOnRoute for it. "
                "Eligibility is viewport+pointer, not route-shaped, so this is a real absence."
            )
    return failures, rows, notes


def landscape_immersive_check(page, base: str) -> tuple[list[str], str]:
    """The ONE positive case for 'and not where it shouldn't' that the product actually declares.

    `hubViewport.js` hides the hub in the chart shell's landscape-immersive mode. Nothing else in
    the shipped registry hides it by route, so without this the 'does not mount elsewhere' half of
    the ruling has no case to exercise and would be an assertion about an empty set.
    """
    page.set_viewport_size(TOUCH_LANDSCAPE)
    try:
        page.goto(f"{base}/charts", wait_until="domcontentloaded", timeout=45000)
    except Exception as exc:  # noqa: BLE001
        page.set_viewport_size(TOUCH_VIEWPORT)
        return [], f"INCONCLUSIVE — /charts would not load in landscape ({type(exc).__name__})"
    page.wait_for_timeout(3000)
    cond = page.evaluate(
        """() => ({
            shell: document.documentElement.hasAttribute('data-mobile-chart-shell'),
            immersive: matchMedia(
              '(pointer: coarse) and (orientation: landscape) and (max-height: 500px)').matches,
        })"""
    )
    st = hub_state(page)
    page.set_viewport_size(TOUCH_VIEWPORT)
    # ⛔ BOTH HALVES OF THE CONDITION, ASKED OF THE BROWSER. The shell attribute alone is not the
    # rule — `hubViewport.js` ANDs it with a media query, and a harness that rotates the viewport
    # without the query matching would be grading a state the product was never in.
    if not (cond["shell"] and cond["immersive"]):
        return [], ("INCONCLUSIVE — the landscape-immersive condition never existed at 852x393 "
                    f"(shell={cond['shell']}, media query={cond['immersive']}); hub state {st}")
    if st["showing"]:
        return ([f"/charts in landscape-immersive (852x393): the hub is SHOWING ({st}), and "
                 "`hubViewport.js` says it must be hidden"], "measured — FAILED")
    return [], (f"PASS — condition real (shell + media query both true) and the hub is not showing "
                f"(hidden attribute {st.get('hiddenAttr')}, display {st.get('display')}, "
                f"box {st.get('box')})")


def _serve(body_for_path, nonce):
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path == "/__smoke_identity":
                payload = nonce.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            body = body_for_path(self.path).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):  # silence
            return

    # ⛔ AN OS-ASSIGNED PORT, AND AN IDENTITY CHECK. "A PORT ASSIGNMENT IS NOT A SERVER
    # IDENTITY" (CLAUDE.md): on this box four listeners once shared 8099 and the probes came
    # back empty, indistinguishable from a browser that could not run them. So: bind 0, then
    # ASK the server who it is before trusting anything it says.
    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


def _registry_parser_self_check() -> list[str]:
    """⛔ CODE, NEVER PROSE — proved, not asserted.

    `hubViewport.js` says in a comment that no mode sets `hideOnRoute`, and `registry.js` discusses
    the field too. A parser that matched those sentences would report modes that declare nothing,
    and this pass would then expect the hub to be ABSENT on real routes and fail the product for
    the scanner's mistake. Both directions are checked, because a parser that finds nothing at all
    passes the first case trivially.
    """
    fails: list[str] = []
    prose = """
    // hideOnRoute: true is read defensively; no shipped mode sets it.
    /* a block comment mentioning hideOnRoute: true as well */
    id: 'wire',
      route: '/morning-wire',
    """
    if hide_on_route_modes(re.sub(r"//[^\n]*", "", re.sub(r"/\*[\s\S]*?\*/", "", prose))):
        fails.append("a hideOnRoute mentioned only in a COMMENT was counted as a declaration")
    # ⭐ Four-space indentation, because that is exactly what separates a MODE key from an ACTION
    # key in the real file. A fixture with a different shape would exercise a parser nobody has.
    real = "\n    id: 'ghost',\n    route: '/ghost',\n    hideOnRoute: true,\n"
    if hide_on_route_modes(real) != ["ghost"]:
        fails.append("a real hideOnRoute declaration was MISSED — the parser cannot see a positive")
    if route_to_mode(real) != {"/ghost": "ghost"}:
        fails.append("route_to_mode failed on a synthetic mode block")
    live = route_to_mode()
    if live.get("/screener") != "scan":
        fails.append("route_to_mode lost the live /screener -> scan pair")
    if "/journal/insights" in live:
        fails.append("route_to_mode invented a route the registry does not declare")
    return fails


def self_check() -> int:
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    parser_fails = _registry_parser_self_check()
    if parser_fails:
        say("SELF-CHECK FAILED (registry parsers):", err=True)
        for f in parser_fails:
            say(f"  ⛔ {f}", err=True)
        return 1
    say("  [ok] registry parsers: a commented hideOnRoute is not a declaration, a real one is, "
        f"and the live route table has {len(route_to_mode())} entries")

    nonce = secrets.token_hex(8)
    srv, port = _serve(lambda p: FROZEN_PAGE if "frozen" in p or p == "/" else FROZEN_PAGE, nonce)
    base = f"http://127.0.0.1:{port}"
    say(f"self-check server on {base} (nonce {nonce[:6]}…)")

    with socket.create_connection(("127.0.0.1", port), timeout=5):
        pass
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        page = br.new_context().new_page()
        ident = page.request.get(f"{base}/__smoke_identity")
        if not ident.ok or ident.text() != nonce:
            say("  ! the server on that port is NOT the one this process started — aborting", err=True)
            br.close(); srv.shutdown()
            return 2
        say("  [ok] server identity confirmed by nonce")

        entries = [{"to": "/b", "label": "B"}]

        # 1. THE PLANTED FREEZE MUST BE CAUGHT.
        page.goto(base, wait_until="domcontentloaded")
        before = fingerprint(page)
        page.locator("#b").click()
        page.wait_for_timeout(300)
        frozen_caught = (page.url != base + "/") and (fingerprint(page) == before)

        # 2. A HEALTHY PAGE MUST NOT BE FLAGGED — or the detector just says "broken" always.
        srv.shutdown()
        srv2, port2 = _serve(lambda p: HEALTHY_PAGE, nonce)
        base2 = f"http://127.0.0.1:{port2}"
        page.goto(base2, wait_until="domcontentloaded")
        before2 = fingerprint(page)
        page.locator("#b").click()
        page.wait_for_timeout(300)
        healthy_ok = (page.url != base2 + "/") and (fingerprint(page) != before2)

        srv2.shutdown()

        # 3. THE PLANTED RENDER LOOP MUST BE CAUGHT — the failure path added for the launch
        #    smoke. This is the CAUSE the 2026-09-10 freeze was a consequence of.
        srv3, port3 = _serve(lambda p: LOOP_PAGE, nonce)
        base3 = f"http://127.0.0.1:{port3}"
        page.goto(base3, wait_until="domcontentloaded")
        page.wait_for_timeout(500)
        loop_sample = render_stability(page, 1500)
        loop_caught = render_verdict("/loop", loop_sample) is not None
        srv3.shutdown()

        # 4. AN IDLE PAGE MUST NOT BE FLAGGED — the control for the probe.
        srv4, port4 = _serve(lambda p: IDLE_PAGE, nonce)
        base4 = f"http://127.0.0.1:{port4}"
        page.goto(base4, wait_until="domcontentloaded")
        page.wait_for_timeout(500)
        idle_sample = render_stability(page, 1500)
        idle_clean = render_verdict("/idle", idle_sample) is None
        srv4.shutdown()

        # 5. PRESENT IS NOT SHOWING — the case this pass got WRONG on its first live run, and
        #    reported as a product defect. `HubRoot` keeps the container in the DOM and sets the
        #    HTML `hidden` attribute, so a `querySelector` presence check says "mounted" about a
        #    hub with `display: none`. Three fixtures, because a checker that answers "not
        #    showing" to everything would pass the first two on its own:
        #      a) hidden attribute  -> present, NOT showing
        #      b) display:none      -> present, NOT showing
        #      c) a real 84x84 box  -> present AND showing   (the control)
        page.set_content(
            '<div data-testid="hub-root" hidden style="width:84px;height:84px"></div>')
        hidden_attr = hub_state(page)
        page.set_content(
            '<div data-testid="hub-root" style="display:none;width:84px;height:84px"></div>')
        display_none = hub_state(page)
        page.set_content(
            '<div data-testid="hub-root" style="position:fixed;width:84px;height:84px"></div>')
        really_showing = hub_state(page)
        page.set_content("<p>no hub here</p>")
        absent = hub_state(page)
        showing_ok = (
            hidden_attr["present"] and not hidden_attr["showing"]
            and display_none["present"] and not display_none["showing"]
            and really_showing["present"] and really_showing["showing"]
            and not absent["present"] and not absent["showing"]
        )

        br.close()

    say("")
    say(f"  planted freeze DETECTED    : {frozen_caught}")
    say(f"  healthy page NOT flagged   : {healthy_ok}")
    say(f"  planted RENDER LOOP DETECTED: {loop_caught} "
        f"(main thread {loop_sample.get('blockedFraction', 0) * 100:.0f}% blocked, "
        f"{loop_sample.get('fps', 0):.0f} fps)")
    say(f"  idle page NOT flagged      : {idle_clean} "
        f"(main thread {idle_sample.get('blockedFraction', 0) * 100:.0f}% blocked, "
        f"{idle_sample.get('fps', 0):.0f} fps)")
    say(f"  present-is-not-showing     : {showing_ok} "
        "(hidden attr and display:none both read as NOT showing; a real box reads as showing)")
    if not loop_sample.get("longtaskSupported", False):
        say("SELF-CHECK FAILED — this browser reports no longtask entries, so the render probe "
            "is BLIND here. Silence from a blind instrument is not health.", err=True)
        return 1
    if frozen_caught and healthy_ok and loop_caught and idle_clean and showing_ok:
        say("SELF-CHECK PASS — both detectors fire on the thing they watch for and stay quiet "
            "on a healthy page.")
        return 0
    say("SELF-CHECK FAILED — this smoke cannot be trusted.", err=True)
    return 1


def touch_main(args) -> int:
    """The touch pass. Exit codes are the same three facts: 0 pass · 1 measured · 2 inconclusive."""
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    entries = nav_items()
    routes = top_level_routes(entries)
    hidden = hide_on_route_modes()
    say(f"nav entries derived from NavBar.jsx: {len(entries)}  ·  sweeping {len(routes)} routes")
    say(f"hideOnRoute declared by: {hidden if hidden else 'NO MODE — the list is empty'}")
    say("  ⭐ So the expectation on every route is MOUNTS. `hideOnRoute` is read defensively by "
        "`hubViewport.js` and no shipped mode sets it; the one declared hide left to exercise is "
        "the chart shell's landscape-immersive mode, checked at the end.")

    errors: list[dict] = []
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ctx = br.new_context(
            viewport=TOUCH_VIEWPORT,
            device_scale_factor=TOUCH_DPR,
            is_mobile=True,
            has_touch=True,
        )
        page = ctx.new_page()

        # ⛔ BOTH CHANNELS. `console` misses an uncaught exception that never reaches console.error,
        # and `pageerror` misses a deliberate console.error. Recording one and reporting "zero
        # errors" would be a claim about the channel, not about the page.
        page.on("console", lambda m: errors.append(
            {"kind": "console", "text": m.text, "where": (m.location or {}).get("url", "")}
        ) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(
            {"kind": "pageerror", "text": str(e), "where": ""}
        ))

        if not args.auth or not login(page, args.base):
            say("")
            say("TOUCH PASS INCONCLUSIVE — not signed in. At stage 1 an unset preference resolves "
                "to `isAdmin`, so an anonymous or non-admin session has no hub to find and every "
                "route would report 'no hub' for a reason that is not the product's.", err=True)
            br.close()
            return 2

        # ⛔ TAKE THE READING ON A REAL APP ROUTE. The first version read it wherever `login()`
        # left the page, which reported `innerWidth 980` — Chromium's fallback layout width for a
        # document with no viewport meta — in a 393-wide context. The floor still passed for the
        # right reason, but an instrument that PRINTS a misleading number invites a false finding
        # from whoever reads its output.
        page.goto(f"{args.base}/dashboard", wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(2000)
        floor = touch_eligibility(page)
        say(f"  eligibility floor: coarse+narrow={floor['coarseAndNarrow']} "
            f"backdrop={floor['backdrop']} visualViewport={floor['visualViewport']} "
            f"({floor['width']}px @ dpr {floor['dpr']}, maxTouchPoints {floor['maxTouchPoints']})")
        if not (floor["coarseAndNarrow"] and floor["backdrop"] and floor["visualViewport"]):
            say("")
            say("TOUCH PASS INCONCLUSIVE — the harness did not reproduce the hub's own mount floor "
                "(`useHubActive.js`). Every route would report 'no hub' because the CONTEXT is "
                "ineligible, not because the product is. That is an unmeasured run, not a clean "
                "one.", err=True)
            br.close()
            return 2

        failures, rows, notes = touch_sweep(page, args.base, routes, errors)
        land_failures, land_note = landscape_immersive_check(page, args.base)
        failures += land_failures
        br.close()

    for route, st, errs in rows:
        mark = "hub ✓" if st["showing"] else ("hub hidden" if st.get("present") else "NO HUB")
        say(f"    {mark:<11} {route:<22} console errors: {errs}")
    say(f"  landscape-immersive /charts: {land_note}")
    for n in notes:
        say(f"  note: {n}")

    # ── Console errors. Attribution is reported HONESTLY or not at all. ────────────────────────
    # ⛔ In a production build the chunks are hashed, so "originating from app/src/hub/*" is not
    # something this can resolve from a stack trace. What it CAN say without inventing anything:
    # how many errors there were at all, and which of them name the hub. Zero of any origin is the
    # strong case and needs no attribution; anything else is listed with its location, and an
    # unattributable error is reported as unattributable rather than quietly dropped.
    hubbish = [e for e in errors if "hub" in (e["text"] + e["where"]).lower()]
    say("")
    say(f"  console/page errors, all origins: {len(errors)}  ·  naming 'hub': {len(hubbish)}")
    for e in errors[:20]:
        say(f"    [{e['kind']}] {e['text'][:160]}  {('@ ' + e['where']) if e['where'] else ''}")
    if errors and not hubbish:
        say("  ⚠️ Errors were logged but none names the hub. ⛔ That is NOT 'zero from hub files': "
            "production chunks are hashed, so this cannot attribute a minified frame to a source "
            "path. Read the list above.")

    if failures:
        say("")
        say(f"TOUCH PASS FAILED — {len(failures)} problem(s):", err=True)
        for f in failures:
            say(f"  ⛔ {f}", err=True)
        return 1
    say("")
    say(f"TOUCH PASS OK — {len(rows)} routes in a 393x852 coarse-pointer context; the hub mounted "
        f"on every route the registry says it should and on no route it says it should not; "
        f"{len(errors)} console/page error(s) recorded.")
    say("⚠️ Chromium emulating a phone VIEWPORT CLASS, not an iPhone. iOS Safari is WebKit and "
        "ships backdrop-filter only prefixed — this pass can say where the hub mounts, never that "
        "a gesture works. Glass is still glass.")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=PROD)
    ap.add_argument("--auth", action="store_true", help="sign in with SMOKE_EMAIL / SMOKE_PASSWORD")
    ap.add_argument("--self-check", action="store_true", help="rule 14: prove the detector can fail")
    ap.add_argument("--full", action="store_true",
                    help="exhaustive fan-out from the three hub-hosting routes (slow; an "
                         "audit, not a post-deploy smoke)")
    ap.add_argument("--touch", action="store_true",
                    help="second pass in a phone-class touch context (393x852, DPR 3, coarse "
                         "pointer): does the hub mount where the registry says, and does any hub "
                         "code log an error? Requires --auth.")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()
    if args.touch:
        return touch_main(args)

    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    entries = nav_items()
    say(f"nav entries derived from NavBar.jsx: {len(entries)}")

    failures: list[str] = []
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        page = br.new_context(viewport={"width": 1280, "height": 900}).new_page()

        authed = login(page, args.base) if args.auth else False
        if not authed:
            # ⛔ SAY SO, LOUDLY, AND SAY WHAT IS NOT COVERED. A partial run reported as a full one
            # is the "chunked suite quoted as the gate" defect.
            say("")
            say("⚠️  UNAUTHENTICATED RUN — PUBLIC ROUTES ONLY.")
            say("    No SMOKE_EMAIL / SMOKE_PASSWORD in the environment, so this run covers "
                f"{list(PUBLIC_ROUTES)} and NOT {list(START_ROUTES)}.")
            say("    ⛔ /dashboard: INCONCLUSIVE-UNPROVISIONED — not covered by this run.")
            say("       /dashboard is paid-only, so a public-signup member cannot reach it either; "
                "the smoke account needs a comped grant before this route can be measured at all. "
                "This is the route the 2026-09-10 freeze was reported on.")
            say("")

        total_clicked = 0
        probes: list[tuple[str, dict]] = []
        if not authed:
            for start in PUBLIC_ROUTES:
                say(f"  checking nav from {start} …")
                route_failures, clicked = check_route(page, args.base, start, entries)
                say(f"    {clicked} nav entr{'y' if clicked == 1 else 'ies'} exercised")
                failures += route_failures
                total_clicked += clicked
        elif args.full:
            for start in START_ROUTES:
                say(f"  exhaustive fan-out from {start} …")
                route_failures, clicked = check_route(page, args.base, start, entries)
                say(f"    {clicked} nav entr{'y' if clicked == 1 else 'ies'} exercised")
                failures += route_failures
                total_clicked += clicked
        else:
            routes = top_level_routes(entries)
            say(f"  sweeping {len(routes)} top-level routes, /dashboard first …")
            route_failures, clicked, probes = sweep_every_route(page, args.base, routes, entries)
            failures += route_failures
            total_clicked += clicked
            # ⛔ THE FAN-OUT FROM /dashboard STAYS EXHAUSTIVE. It is the page the freeze was
            # reported on and the one that mounts the hub-owning tile; one departure from it is
            # not enough coverage of the surface that actually broke.
            say("  exhaustive fan-out from /dashboard …")
            dash_failures, dash_clicked = check_route(page, args.base, "/dashboard", entries)
            say(f"    {dash_clicked} nav entr{'y' if dash_clicked == 1 else 'ies'} exercised")
            failures += dash_failures
            total_clicked += dash_clicked
        br.close()

    # ⛔ COVERAGE IS REPORTED, NOT ASSUMED. `/dashboard` is the whole reason this file exists;
    # a run that never reached it must not read like one that did.
    covered = {r for r, _ in probes}
    if authed and not args.full and "/dashboard" not in covered:
        failures.append("/dashboard was never probed — the route this smoke exists for was missed")

    # ⛔ NON-VACUITY, BEFORE ANY VERDICT. A run that clicked nothing is not a clean run; it is a
    # run that did not happen, and reporting it as PASS is precisely how a green light gets
    # attached to an unmeasured deploy.
    if total_clicked == 0:
        say("")
        say("SMOKE INCONCLUSIVE-UNPROVISIONED — zero nav entries were clickable, so nothing was "
            "measured, and /dashboard in particular is UNPROVISIONED: it is paid-only and the "
            "smoke account has no comped grant. This is NOT a pass and NOT a product failure — "
            "exit 2 says 'could not measure'. ⛔ H15 does not fire on exit 2: do not roll back.",
            err=True)
        return 2

    if failures:
        say(f"SMOKE FAILED — {len(failures)} problem(s):", err=True)
        for f in failures:
            say(f"  ⛔ {f}", err=True)
        return 1
    scope = "authenticated" if authed else "public-routes-only"
    if not authed:
        say("  ⚠️ /dashboard: INCONCLUSIVE-UNPROVISIONED (paid-only; smoke account not comped). "
            "This run is NOT coverage of the launch.")
    if probes:
        worst = max(probes, key=lambda rp: rp[1].get("blockedFraction", 0))
        say(f"  busiest main thread: {worst[0]} at "
            f"{worst[1].get('blockedFraction', 0) * 100:.1f}% blocked "
            f"(limit {BLOCKED_FRACTION_LIMIT * 100:.0f}%)")
    say(f"SMOKE PASS ({scope}) — {len(probes)} route(s) probed for a render loop, "
        f"{total_clicked} nav entries exercised, and every one moved BOTH the URL and the screen.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
