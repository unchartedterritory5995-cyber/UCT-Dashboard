"""Mobile-responsiveness audit harness.

Boots Chromium at phone/tablet viewports, visits each route, and reports the
most common, objective mobile failures (horizontal overflow, sub-44px tap
targets) plus a screenshot per route per viewport for visual review.

Usage:
    # Public pages only (no login):
    python tools/mobile_audit.py --base https://uctintelligence.com

    # With login (env keeps creds out of argv/history):
    set MOBILE_AUDIT_EMAIL=you@example.com
    set MOBILE_AUDIT_PASSWORD=secret
    python tools/mobile_audit.py --base https://uctintelligence.com --auth

    # Subset of routes, single viewport:
    python tools/mobile_audit.py --routes /dashboard /breadth --viewport phone

Output: tools/mobile_audit_out/<viewport>/<route>.png  +  report.md / report.json
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT_DIR = Path(__file__).parent / "mobile_audit_out"

VIEWPORTS = {
    "phone": {"width": 375, "height": 812, "isMobile": True, "deviceScaleFactor": 2,
              "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                           "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"},
    "phone390": {"width": 390, "height": 844, "isMobile": True, "deviceScaleFactor": 3},
    "tablet": {"width": 820, "height": 1180, "isMobile": True, "deviceScaleFactor": 2},
    "desktop": {"width": 1280, "height": 1000, "deviceScaleFactor": 1, "isMobile": False},
}

# Vertical budget in "screens" per (route, viewport). A pair absent from
# this map is not budgeted. Phone and tablet legitimately scroll — the
# phone dashboard is ~2,768px — so budgeting them would be permanently
# red, and a permanently-red rail is one nobody reads.
HEIGHT_BUDGETS = {("/dashboard", "desktop"): 1.05}

PUBLIC_ROUTES = ["/", "/login", "/signup", "/terms", "/privacy"]

# ⚠️ HAND-TYPED BESIDE THE THING THAT OWNS IT (the NAV array in
# app/src/components/NavBar.jsx + App.jsx's route table) — the CLAUDE.md
# defect class, and it bit this file: "/patterns" sat here for weeks with no
# such route, so the harness audited the 404 page there, while FIVE live nav
# routes (/ai-search, /flow-scoreboard, /live-massive, /desk, /community)
# were never audited at all. When the nav moves, MEASURE NavBar.jsx and remake
# this list; do not trust it.
PROTECTED_ROUTES = [
    "/dashboard", "/morning-wire", "/uct-20", "/breadth", "/charts",
    "/ai-search", "/calendar", "/calendar/mystocks", "/screener",
    "/options-flow", "/flow-scoreboard", "/live-massive", "/dark-pool",
    "/post-market", "/model-book", "/setup-library", "/desk",
    "/journal", "/community", "/watchlists", "/catalysts/history",
    "/settings", "/support",
]

# JS run in the page to detect layout problems at the current viewport.
PROBE_JS = r"""
() => {
  const de = document.documentElement;
  const vw = window.innerWidth;
  const overflowX = de.scrollWidth - de.clientWidth;

  const offenders = [];
  const seen = new Set();
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    // element extends past the right edge (and started on-screen)
    if (r.right > vw + 2 && r.left < vw) {
      const cls = (el.className && el.className.toString) ? el.className.toString().slice(0, 50) : '';
      const key = el.tagName + '.' + cls + '@' + Math.round(r.right);
      if (seen.has(key)) return;
      seen.add(key);
      offenders.push({ tag: el.tagName.toLowerCase(), cls, right: Math.round(r.right), width: Math.round(r.width) });
    }
  });
  offenders.sort((a, b) => b.right - a.right);

  const smallTargets = [];
  const tseen = new Set();
  document.querySelectorAll('button, a[href], [role=button], input:not([type=hidden]), select, textarea').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (r.height < 40 || r.width < 24) {
      const label = (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24);
      if (tseen.has(label)) return;
      tseen.add(label);
      smallTargets.push({ label, w: Math.round(r.width), h: Math.round(r.height) });
    }
  });

  // The dashboard's scroll container is the flex child, not <html>.
  const sc = document.querySelector('[class*="_content_"]') || de;
  const scrollHeight = sc.scrollHeight;
  const viewportHeight = window.innerHeight;
  // viewportHeight <= 0 would make screens NaN, and `NaN > budget` is
  // false — a fail-open path in a rail whose whole job is to fail loud.
  // Report null instead so the Python side can flag it explicitly rather
  // than silently reading "ok".
  const screens = viewportHeight > 0 ? +(scrollHeight / viewportHeight).toFixed(2) : null;

  return {
    overflowX, vw, scrollWidth: de.scrollWidth,
    offenders: offenders.slice(0, 12), smallCount: smallTargets.length, smallTargets: smallTargets.slice(0, 10),
    scrollHeight, viewportHeight, screens,
    // Measurement-validity facts: Chromium can DROP pointer/touch emulation
    // mid-context (renderer swap), after which touch-gated UI branches render
    // their DESKTOP variants and every "finding" describes a page no tablet
    // user sees. The 2026-09-02 tablet sweep reported 64 phantom sub-44px
    // targets on /charts this way. The runner checks these against the
    // context's intent and retries/invalidates instead of reporting phantoms.
    pointerCoarse: matchMedia('(pointer: coarse)').matches,
    touchPoints: navigator.maxTouchPoints,
    // ⛔ REACHED-PAGE FACTS. Wave J shipped an audit that reported
    // "overflowX=0 small=0" for /journal three times while actually
    // measuring a 404 page, because the ROUTE never survived the shell (see
    // _validate_route). A clean number from the wrong page is worse than no
    // number, so the runner cross-checks these against what it ASKED for.
    href: location.href,
    pathname: location.pathname,
    // The SPA catch-all renders pages/NotFound.jsx ("404" + "Page not
    // found"). Matched on the copy rather than a test id because that file
    // has no stable hook and this must not silently stop working if one is
    // added later — a false "not 404" is the failure direction that matters.
    notFound: /Page not found/i.test(document.body.innerText || ''),
    // Did the SPA mount anything at all? A blank shell (chunk 404, auth
    // bounce mid-render) also measures as a clean zero.
    rootChildren: (document.getElementById('root') || {}).childElementCount || 0,
    bodyTextLen: (document.body.innerText || '').trim().length,
  };
}
"""


def validate_route(route):
    """Reject a route that cannot possibly be an app path, BEFORE browsing.

    ⛔ WAVE J SHIPPED THREE CLEAN AUDITS OF PAGES THAT WERE NOT THE TARGET.
    Two of them died right here, in the argument, and the third was the
    consequence:

      1. Git Bash / MSYS rewrote `--routes /journal` into
         `C:/Program Files/Git/journal` before Python ever saw it. The tool
         dutifully browsed `<base>C:/Program Files/Git/journal`.
      2. `--routes /journal,/journal/notebook` is ONE element to an
         `nargs="*"` argument, so the literal string `/journal,/journal/notebook`
         was requested as a single path.
      3. Both landed on the SPA catch-all, which has no horizontal overflow
         and no small tap targets, and were reported as `ok  overflowX=0
         small=0`.

    A vacuous PASS is worse than a failure: it is a claim of safety that was
    never measured. Returns an error string, or None when the route is
    plausible. This is a PURE function so it can be tested without a browser.
    """
    if not isinstance(route, str) or not route.strip():
        return "empty route"
    r = route.strip()
    if not r.startswith("/"):
        return (f"route must start with '/' (got {r!r}) — on Git Bash/MSYS a "
                f"leading-slash argument is rewritten to a Windows path; use "
                f"MSYS_NO_PATHCONV=1, PowerShell, or '//journal'")
    if re.match(r"^/[A-Za-z]:[\\/]", r) or "\\" in r:
        return (f"route looks like a filesystem path, not a URL path ({r!r}) — "
                f"shell path rewriting")
    if "," in r:
        return (f"route contains a comma ({r!r}) — --routes takes SPACE-separated "
                f"values; a comma-separated list is read as one literal route")
    if r.startswith("//"):
        return f"route has a protocol-relative prefix ({r!r})"
    return None


def check_reached(route, probe):
    """Cross-check what we MEASURED against what we ASKED for.

    Returns an error string, or None when the probe plausibly describes the
    requested page. Pure, for the same reason as validate_route.
    """
    if not probe:
        return "no probe data"
    expected = route.split("?", 1)[0].split("#", 1)[0].rstrip("/") or "/"
    actual = (probe.get("pathname") or "").rstrip("/") or "/"
    if probe.get("notFound"):
        return f"landed on the 404 surface (final path {actual!r})"
    if actual != expected:
        # A redirect away is not necessarily a bug in the app, but it IS a bug
        # in the audit: the numbers describe a different page than the row
        # claims. Report the final URL so the reader can tell which.
        return f"route not reached: asked {expected!r}, measured {actual!r}"
    if probe.get("rootChildren", 0) < 1:
        return "SPA shell never mounted (#root has no children)"
    if probe.get("bodyTextLen", 0) < 20:
        return f"page rendered essentially nothing (bodyTextLen={probe.get('bodyTextLen')})"
    return None


_INTRO_SEL = '[role="dialog"][aria-label="Welcome"]'


def _dismiss_intro(page):
    """Dismiss the cinematic intro so we screenshot the real page.

    ⛔ THIS SILENTLY PRODUCED A CLEAN AUDIT OF THE INTRO ITSELF. The runner sets
    `reduced_motion="reduce"`, which makes IntroAnimation render its
    reduced-motion branch — and that branch has NO Skip button (it dismisses via
    `onClick` on the overlay). The docstring here claimed a click fallback;
    the code only ever tried the Skip button and Escape, neither of which
    exists on that branch. Both quietly failed, the overlay stayed up, and
    /calendar scored `overflowX=0 small=0` on a page showing "Welcome, Local."

    So: try all three, then VERIFY the overlay is gone and raise if it isn't. A
    layout audit of a page that never rendered is worse than no audit — it
    reports safety it did not measure.
    """
    for attempt in (
        lambda: page.click('[aria-label="Skip intro"]', timeout=1000),
        lambda: page.click(_INTRO_SEL, timeout=1000),      # reduced-motion branch
        lambda: page.keyboard.press("Escape"),
    ):
        try:
            attempt()
            page.wait_for_timeout(300)
        except Exception:  # noqa: BLE001
            continue
        if page.query_selector(_INTRO_SEL) is None:
            return

    # Last resort: the reduced-motion fade is ~1.6s and self-finishes.
    try:
        page.wait_for_selector(_INTRO_SEL, state="detached", timeout=12000)
        return
    except Exception:  # noqa: BLE001
        pass

    raise RuntimeError(
        "intro overlay still present — refusing to audit it as if it were the page")


def slug(route: str) -> str:
    s = route.strip("/").replace("/", "_") or "root"
    return re.sub(r"[^a-z0-9_]+", "-", s.lower())


def do_login(page, base: str) -> bool:
    email = os.environ.get("MOBILE_AUDIT_EMAIL")
    pw = os.environ.get("MOBILE_AUDIT_PASSWORD")
    if not email or not pw:
        print("  ! --auth requested but MOBILE_AUDIT_EMAIL / MOBILE_AUDIT_PASSWORD not set", file=sys.stderr)
        return False
    # POST the login via the context's request API — the Set-Cookie persists
    # into the browser context's cookie jar, so subsequent navigations are
    # authenticated. Far more robust than driving the form past the intro overlay.
    try:
        resp = page.request.post(
            f"{base}/api/auth/login",
            data={"email": email, "password": pw},
            headers={"Content-Type": "application/json"},
        )
        if not resp.ok:
            print(f"  ! login HTTP {resp.status}", file=sys.stderr)
            return False
        body = resp.json()
        print(f"  [ok] logged in as {body.get('user', {}).get('email')} (plan={body.get('plan')})")
        return True
    except Exception as e:  # noqa: BLE001
        print(f"  ! login failed: {e}", file=sys.stderr)
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("MOBILE_AUDIT_BASE", "http://localhost:8000"))
    ap.add_argument("--auth", action="store_true", help="log in before visiting protected routes")
    ap.add_argument("--routes", nargs="*", help="explicit route list (overrides defaults)")
    ap.add_argument("--viewport", choices=list(VIEWPORTS), help="single viewport (default: all)")
    ap.add_argument("--settle", type=float, default=2.5, help="seconds to wait after load")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    viewports = {args.viewport: VIEWPORTS[args.viewport]} if args.viewport else VIEWPORTS

    if args.routes:
        routes = args.routes
    elif args.auth:
        routes = PUBLIC_ROUTES + PROTECTED_ROUTES
    else:
        routes = PUBLIC_ROUTES

    # Fail on a malformed route BEFORE launching a browser — the two Wave J
    # vacuous passes were both decided here, in the argument, long before any
    # page loaded. Exiting non-zero with the reason is the whole point: the
    # old behaviour was to browse the nonsense and report it clean.
    route_errors = [(r, validate_route(r)) for r in routes]
    route_errors = [(r, e) for r, e in route_errors if e]
    if route_errors:
        print("REFUSING TO RUN — malformed --routes:")
        for r, e in route_errors:
            print(f"  {r!r}: {e}")
        return 2

    OUT_DIR.mkdir(exist_ok=True)
    report = {"base": base, "results": []}

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME") or None)
        for vp_name, vp in viewports.items():
            (OUT_DIR / vp_name).mkdir(exist_ok=True)
            ctx = browser.new_context(
                viewport={"width": vp["width"], "height": vp["height"]},
                device_scale_factor=vp.get("deviceScaleFactor", 2),
                is_mobile=vp.get("isMobile", True),
                has_touch=True,
                user_agent=vp.get("userAgent"),
                reduced_motion="reduce",  # shortens the cinematic intro overlay
            )
            page = ctx.new_page()

            if args.auth:
                do_login(page, base)

            for route in routes:
                url = f"{base}{route}"
                entry = {"viewport": vp_name, "route": route}
                try:
                    # Streaming pages (charts, options-flow) never reach
                    # networkidle — use domcontentloaded and lean on the settle.
                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    except Exception:  # noqa: BLE001
                        pass  # partial load is fine; we still probe + screenshot
                    _dismiss_intro(page)
                    page.wait_for_timeout(int(args.settle * 1000))
                    probe = page.evaluate(PROBE_JS)
                    # Validity guard: a touch-intent context (isMobile) must
                    # still MEASURE as coarse-pointer, or the page rendered its
                    # desktop branches and the numbers describe a UI no touch
                    # user sees. Chromium drops the touch/pointer emulation
                    # override on a renderer swap and — with this pinned
                    # browser build — a same-page re-goto does NOT restore it
                    # (measured 2026-09-02: 24 of 28 tablet routes went
                    # fine-pointer mid-sweep and stayed there). A FRESH PAGE
                    # re-applies the context's emulation; if even that fails,
                    # a fresh context (+ re-login) is the last resort. Only
                    # after both is the row marked INVALID instead of being
                    # reported as findings.
                    if vp.get("isMobile", True) and not probe.get("pointerCoarse"):
                        def _remeasure(pg):
                            try:
                                pg.goto(url, wait_until="domcontentloaded", timeout=30000)
                            except Exception:  # noqa: BLE001
                                pass
                            _dismiss_intro(pg)
                            pg.wait_for_timeout(int(args.settle * 1000))
                            return pg.evaluate(PROBE_JS)

                        try:
                            page.close()
                        except Exception:  # noqa: BLE001
                            pass
                        page = ctx.new_page()
                        probe = _remeasure(page)
                        if not probe.get("pointerCoarse"):
                            try:
                                ctx.close()
                            except Exception:  # noqa: BLE001
                                pass
                            ctx = browser.new_context(
                                viewport={"width": vp["width"], "height": vp["height"]},
                                device_scale_factor=vp.get("deviceScaleFactor", 2),
                                is_mobile=vp.get("isMobile", True),
                                has_touch=True,
                                user_agent=vp.get("userAgent"),
                                reduced_motion="reduce",
                            )
                            page = ctx.new_page()
                            if args.auth:
                                do_login(page, base)
                            probe = _remeasure(page)
                        if not probe.get("pointerCoarse"):
                            entry["measurementInvalid"] = (
                                "pointer emulation lost — coarse=false in a "
                                "touch context; findings describe the desktop UI"
                            )
                    # Did we actually land on the page this row claims? This
                    # is the check whose absence let Wave J report three clean
                    # audits of a 404. It runs AFTER the pointer-emulation
                    # guard because both invalidate the same row, and the
                    # reached-page failure is the more fundamental one.
                    reach_err = check_reached(route, probe)
                    if reach_err and not entry.get("measurementInvalid"):
                        entry["measurementInvalid"] = reach_err
                    shot = OUT_DIR / vp_name / f"{slug(route)}.png"
                    page.screenshot(path=str(shot), full_page=True)
                    entry.update(probe)
                    entry["screenshot"] = str(shot.relative_to(OUT_DIR.parent))
                    flag = "OVERFLOW" if probe["overflowX"] > 2 else "ok"
                    if entry.get("measurementInvalid"):
                        flag = "INVALID"
                    # Vertical budget: /dashboard must fit one viewport.
                    # Baseline measured 2026-08-30: 5.5 screens at 2133x1050,
                    # 6.9 at 1277x1000. Target after Phase 3: <= 1.05.
                    # Three states MUST stay distinguishable in report.json:
                    # absent heightFlag = not budgeted; "ok" = checked and
                    # passed; "OVER_BUDGET" = checked and failed. A budgeted
                    # route therefore ALWAYS writes heightFlag, pass or fail —
                    # never only on the failure branch, or "checked, passed"
                    # and "never looked" become the same (missing) key.
                    budget = HEIGHT_BUDGETS.get((route, vp_name))
                    if budget is None:
                        hflag = "n/a"  # console-only; not budgeted, no entry key
                    else:
                        screens_val = probe.get("screens")
                        if screens_val is None:
                            # viewportHeight was <=0 in the probe — a real
                            # failure to measure, not a silent "ok".
                            hflag = "NO_HEIGHT_DATA"
                        elif screens_val > budget:
                            hflag = "OVER_BUDGET"
                        else:
                            hflag = "ok"
                        entry["heightFlag"] = hflag
                    # ONE line per route/viewport. The height columns were added
                    # as a second print(), which repeated the route and flag and
                    # made the report twice as long to read for no new fact.
                    print(f"[{vp_name:8}] {route:24} {flag:9} {hflag:12} "
                          f"screens={probe.get('screens')}  "
                          f"overflowX={probe['overflowX']:>4}  small={probe['smallCount']}")
                except Exception as e:  # noqa: BLE001
                    entry["error"] = str(e)
                    print(f"[{vp_name:8}] {route:24} ERROR {e}", file=sys.stderr)
                report["results"].append(entry)

            ctx.close()
        browser.close()

    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2))
    _write_md(report)
    n_over = sum(1 for r in report["results"] if r.get("overflowX", 0) > 2)
    n_invalid = sum(1 for r in report["results"] if r.get("measurementInvalid"))
    invalid_note = (
        f" !! {n_invalid} INVALID measurement(s) -- each row's reason is in report.md; "
        f"those rows measured SOMETHING ELSE and are not results."
        if n_invalid else ""
    )
    print(f"\nDone. {n_over} page/viewport combos with horizontal overflow."
          f"{invalid_note} Report + screenshots in {OUT_DIR}")

    # AN INVALID AUDIT IS NOT A PASS (directive 131). Wave J read
    # "Done. 0 page/viewport combos with horizontal overflow" off a run
    # that had measured a 404 three times. Exit non-zero so a caller --
    # a human skimming, or CI -- cannot mistake an unmeasured page for a
    # clean one.
    return 1 if n_invalid else 0


def _write_md(report):
    lines = [f"# Mobile audit — {report['base']}", ""]
    by_route = {}
    for r in report["results"]:
        by_route.setdefault(r["route"], []).append(r)
    for route, entries in by_route.items():
        lines.append(f"## `{route}`")
        for e in entries:
            if e.get("error"):
                lines.append(f"- **{e['viewport']}**: ERROR {e['error']}")
                continue
            ov = e.get("overflowX", 0)
            tag = "🔴 OVERFLOW" if ov > 2 else "🟢 ok"
            if e.get("measurementInvalid"):
                tag = "⚠️ INVALID — " + e["measurementInvalid"]
            lines.append(f"- **{e['viewport']}** {tag} (overflowX={ov}px, small-targets={e.get('smallCount', 0)}) — `{e.get('screenshot','')}`")
            for o in e.get("offenders", [])[:6]:
                lines.append(f"    - overflow: `<{o['tag']} class=\"{o['cls']}\">` right={o['right']} w={o['width']}")
            # The sub-44px list was COLLECTED and then thrown away — the report
            # showed only a count, which names nothing and so fixes nothing.
            for t in e.get("smallTargets", [])[:10]:
                lines.append(f"    - small-target: `{t['label']}` {t['w']}x{t['h']}px")
        lines.append("")
    (OUT_DIR / "report.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
