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
    python tools/hub_nav_smoke.py --self-check         # rule 14: prove it can FAIL
    python tools/hub_nav_smoke.py --base http://localhost:8077 --auth
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


def self_check() -> int:
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

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
    if not loop_sample.get("longtaskSupported", False):
        say("SELF-CHECK FAILED — this browser reports no longtask entries, so the render probe "
            "is BLIND here. Silence from a blind instrument is not health.", err=True)
        return 1
    if frozen_caught and healthy_ok and loop_caught and idle_clean:
        say("SELF-CHECK PASS — both detectors fire on the thing they watch for and stay quiet "
            "on a healthy page.")
        return 0
    say("SELF-CHECK FAILED — this smoke cannot be trusted.", err=True)
    return 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=PROD)
    ap.add_argument("--auth", action="store_true", help="sign in with SMOKE_EMAIL / SMOKE_PASSWORD")
    ap.add_argument("--self-check", action="store_true", help="rule 14: prove the detector can fail")
    ap.add_argument("--full", action="store_true",
                    help="exhaustive fan-out from the three hub-hosting routes (slow; an "
                         "audit, not a post-deploy smoke)")
    args = ap.parse_args(argv)

    if args.self_check:
        return self_check()

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
