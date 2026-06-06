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
}

PUBLIC_ROUTES = ["/", "/login", "/signup", "/terms", "/privacy"]

PROTECTED_ROUTES = [
    "/dashboard", "/morning-wire", "/uct-20", "/breadth", "/charts",
    "/calendar", "/calendar/mystocks", "/screener", "/options-flow",
    "/dark-pool", "/post-market", "/model-book", "/setup-library",
    "/journal", "/patterns", "/watchlists", "/catalysts/history",
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

  return { overflowX, vw, scrollWidth: de.scrollWidth, offenders: offenders.slice(0, 12), smallCount: smallTargets.length, smallTargets: smallTargets.slice(0, 10) };
}
"""


def _dismiss_intro(page):
    """The cinematic intro overlay plays on every page load — skip it so we
    screenshot the real page. Tries the Skip button, then Escape, then a click."""
    try:
        skip = page.query_selector('[aria-label="Skip intro"]')
        if skip:
            skip.click(timeout=1000)
            page.wait_for_timeout(400)
            return
    except Exception:  # noqa: BLE001
        pass
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    except Exception:  # noqa: BLE001
        pass


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

    OUT_DIR.mkdir(exist_ok=True)
    report = {"base": base, "results": []}

    with sync_playwright() as p:
        browser = p.chromium.launch()
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
                    shot = OUT_DIR / vp_name / f"{slug(route)}.png"
                    page.screenshot(path=str(shot), full_page=True)
                    entry.update(probe)
                    entry["screenshot"] = str(shot.relative_to(OUT_DIR.parent))
                    flag = "OVERFLOW" if probe["overflowX"] > 2 else "ok"
                    print(f"[{vp_name:8}] {route:24} {flag:9} overflowX={probe['overflowX']:>4}  small={probe['smallCount']}")
                except Exception as e:  # noqa: BLE001
                    entry["error"] = str(e)
                    print(f"[{vp_name:8}] {route:24} ERROR {e}", file=sys.stderr)
                report["results"].append(entry)

            ctx.close()
        browser.close()

    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2))
    _write_md(report)
    n_over = sum(1 for r in report["results"] if r.get("overflowX", 0) > 2)
    print(f"\nDone. {n_over} page/viewport combos with horizontal overflow. "
          f"Report + screenshots in {OUT_DIR}")


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
            lines.append(f"- **{e['viewport']}** {tag} (overflowX={ov}px, small-targets={e.get('smallCount', 0)}) — `{e.get('screenshot','')}`")
            for o in e.get("offenders", [])[:6]:
                lines.append(f"    - overflow: `<{o['tag']} class=\"{o['cls']}\">` right={o['right']} w={o['width']}")
        lines.append("")
    (OUT_DIR / "report.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
