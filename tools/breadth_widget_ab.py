"""A/B the `/charts` Breadth widget across two BUILDS of this app (R1 Task 3).

The Data Charts overhaul made `heatmapMetrics.js` an adapter over the one registry.
The heatmap tiles it builds are also what the `/charts` **Breadth widget** renders, so
that widget is the second surface the change can reach — and it is the one no test in
this programme looks at with a browser.

⛔ **PRODUCTION CANNOT SUPPLY BOTH SIDES.** It serves master, which is the "before";
the "after" is an unmerged branch. Capturing "before" from production and "after" from
a local build would put the BUILD ENVIRONMENT in the comparison alongside the change,
and a difference could then be honestly attributed to neither. So both sides are built
from the SAME worktree with the SAME node_modules, and the only variable between them
is the two registry files (see `--build-both`). Cost: one extra `vite build`.

⛔ **THE MEMBER-SMOKE ACCOUNT IS NEVER WRITTEN TO.** `/charts` renders whatever widgets
`charts_workspace_layout` holds, and neither default layout carries a Breadth widget —
so reaching this surface would ordinarily mean saving one onto the account. Instead the
layout is INJECTED into the preferences GET response and every preferences POST is
answered locally and counted (`pref_writes_blocked`), the same contract
`breadth_charts_rig.install_pref_routes` already ships. A run that records a write it
did not block is a failed run, not a caveat.

⭐ **The page is served from a local origin; `/api/**` is rewritten to production**, so
the data is a real member's data and only the BUNDLE is local. The server proves its own
identity with a nonce before the browser is pointed at it (a port assignment is not a
server identity — `CLAUDE.md`), and an `/api/auth/me` probe through the rewrite is the
non-vacuity control: without it every assertion below would pass over an empty page.

    python tools/breadth_widget_ab.py --self-check
    python tools/breadth_widget_ab.py --build-both --out docs/breadth/screenshots/registry-unification

Exit: 0 captured · 1 a measured difference the golden did not predict · 2 INCONCLUSIVE.
"""

import argparse
import functools
import hashlib
import http.server
import json
import os
import pathlib
import secrets
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from tools import flow_cold_paint_rig as fcr   # noqa: E402  login pacing + UA + uptime
from tools.secret_scrub import brief, scrub, scan_text   # noqa: E402  the ONE scrubber

BASE = fcr.BASE
UA = fcr.UA
PREFS_PATH = "/api/auth/preferences"
IDENTITY = "/__uct_ab_identity"
WIDTHS = {390: 844, 1280: 800}

# The two files that ARE the change. Swapped as exact bytes, restored as exact bytes,
# sha-verified — never `git checkout` (feedback_mutation_check_never_git_checkout).
SWAP = ("app/src/pages/breadth/chartMetrics.js",
        "app/src/pages/breadth/heatmapMetrics.js")

# One widget, filling the 24-col grid, so the viewport shot IS the widget: the workspace
# wraps widgets in CSS-module-hashed classes, and a selector built on those is a selector
# that breaks on the next build.
LAYOUT = {"widgets": [{"id": "ab-breadth", "type": "breadth",
                       "x": 0, "y": 0, "w": 24, "h": 20, "opts": {}}],
          "cols": 24}

# ⛔ ASK THE PRODUCT'S OWN QUESTION. The first version waited for a `<canvas>` and timed
# out four times over a widget that had rendered perfectly — this heatmap is DOM tiles, and
# the treemap canvas belongs to a DIFFERENT view. A detector that cannot see a working
# product reports INCONCLUSIVE forever (`lesson_did_it_render_needs_the_products_own_answer`).
#
# The section captions are the right signal precisely because they are NOT under test:
# `named()` passes `isHeader` rows through untouched, so they read the same in both builds
# by construction, and keying readiness on a tile label would key it on the thing being
# compared.
READY_JS = """() => {
  const t = (document.body.innerText || '').toUpperCase();
  if (/UNKNOWN WIDGET TYPE/.test(t)) return 'unknown-widget';
  // ⛔ PRESENT IS NOT SHOWING. The cinematic intro plays on EVERY page load (~9.3s) and
  // covers the whole viewport, while the widget sits behind it in the DOM — so innerText
  // reads "ready" over a member who can see none of it. One 1280 capture caught the
  // "Welcome, Member." overlay: text IDENTICAL, 100% of pixels different, and the pixel
  // number was the only thing that noticed.
  if (/CHARTING THE MARKET|NAVIGATE THE MARKET, EFFECTIVELY/.test(t)) return '';
  const caps = ['PRIMARY BREADTH', 'MA BREADTH', 'REGIME', 'SENTIMENT'];
  if (caps.every(c => t.includes(c))) return 'ok';
  // ⛔ Below 640px `ChartsWorkspace` bypasses react-grid-layout entirely and renders
  // `MobileWorkspace`, which understands CHART widgets only. The Breadth widget does
  // not exist at phone width — that is the product, not a slow load, and calling it a
  // timeout would report a missing surface as a broken harness.
  if (/NO CHART IN THIS LAYOUT YET|OPEN A CHART/.test(t)) return 'mobile-workspace';
  if (/COULDN.T|DIDN.T LOAD|SESSION HAS ENDED|PART OF/.test(t)) return 'refused';
  return '';
}"""


# ⭐ THE VERDICT IS THE WIDGET'S OWN TEXT, NOT PIXELS.
# A full-page pixel diff of this surface is a NOISY instrument: the gold UIcon shimmer and
# the voice orb animate, so two captures of an unchanged page differ by ~2,200 scattered
# pixels at 1280 regardless of the change under test. Reporting that as the answer would
# either cry wolf or force a tolerance so loose it could hide a real label change.
#
# Every tile label, every value and every section caption is text, and text is exactly
# what the registry controls — so an exact string comparison answers the actual question
# and is immune to animation. The pixel diff stays as supporting evidence.
#
# The one wall-clock element (`Updated H:MM AM/PM ET`) is normalised: the two runs are
# minutes apart by construction and that stamp is not the registry's doing.
#
# ⛔ SCOPED TO THE WIDGET, NOT THE BODY. Comparing whole-page text made the first run
# report a difference of exactly one line: `9+`, the Community unread badge in the nav,
# which arrived between the two captures. Any long-lived page chrome — a badge, a toast,
# a coach mark — will eventually differ between two runs minutes apart, and a verdict
# that reds on somebody else's notification is a verdict people stop reading.
CONTENT_JS = r"""() => {
  // Smallest element containing every section caption = the widget subtree. Derived at
  // runtime because the workspace's classes are CSS-module hashes, and a selector built
  // on a hash breaks on the next build.
  const caps = ['PRIMARY BREADTH', 'MA BREADTH', 'REGIME', 'SENTIMENT'];
  let best = null;
  for (const el of document.querySelectorAll('div,section,article,main')) {
    const up = (el.innerText || '').toUpperCase();
    if (caps.every(c => up.includes(c))) {
      if (!best || (el.innerText || '').length < (best.innerText || '').length) best = el;
    }
  }
  const t = best ? (best.innerText || '') : '';
  return t.replace(/Updated\s+\d{1,2}:\d{2}\s*(AM|PM)\s*ET/gi, 'Updated <clock> ET')
          .split('\n').map(s => s.trim()).filter(Boolean).join('\n');
}"""


def say(msg):
    print(msg, flush=True)


def sha(p):
    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()


# ⛔ A PLAYWRIGHT ERROR CARRIES THE REQUEST HEADERS OF THE CALL THAT FAILED, AND ONE OF
# THOSE HEADERS IS THE MEMBER'S SESSION COOKIE. The first run of this tool crashed during
# teardown and printed a live one straight into the run log; the credential had to be
# rotated. Never print a raw playwright exception — print `brief(exc)`.
#
# ⛔ The scrubber lives in ONE place (`tools/secret_scrub.py`) and is imported, never
# copied. A second copy is the guard that never gets the next fix
# (`lesson_a_guard_repeated_is_a_guard_unproved`). Its own draft here was also narrower
# than the real leak: it required a word boundary before the cookie's name, which does not
# exist between the `uct_` prefix and the rest, so it redacted the unprefixed spelling and
# missed the actual one. Runbook: `docs/runbooks/rig-credential-hygiene.md`.


# ── pure helpers (self-checked) ────────────────────────────────────────────────

def rewrite_target(page_url, base=BASE):
    """A local-origin `/api/...` URL, re-aimed at production. Query preserved."""
    u = urlsplit(page_url)
    return base + u.path + (("?" + u.query) if u.query else "")


def inject_layout(prefs, layout=LAYOUT):
    """Put one Breadth widget on the workspace WITHOUT writing to the account."""
    out = dict(prefs)
    out["charts_workspace_layout"] = json.dumps(layout)
    return out


def verdict(diff_pct, tolerance):
    """Same inputs must render the same. Anything above tolerance is a finding."""
    if diff_pct is None:
        return "INCONCLUSIVE"
    return "SAME" if diff_pct <= tolerance else "DIFFERENT"


def self_check() -> int:
    fails = []

    def case(name, ok):
        say(f"  {'ok  ' if ok else 'FAIL'} {name}")
        if not ok:
            fails.append(name)

    case("rewrite keeps path and query",
         rewrite_target("http://127.0.0.1:5501/api/breadth-monitor?days=365")
         == BASE + "/api/breadth-monitor?days=365")
    case("rewrite handles a bare path",
         rewrite_target("http://127.0.0.1:5501/api/auth/me") == BASE + "/api/auth/me")
    case("rewrite does not invent a query",
         "?" not in rewrite_target("http://127.0.0.1:5501/api/auth/me"))
    p = {"theme": "dark", "breadth_charts_state": "{}"}
    got = inject_layout(p)
    case("injection adds the layout", json.loads(got["charts_workspace_layout"])["widgets"][0]["type"] == "breadth")
    case("injection keeps the member's other prefs", got["theme"] == "dark")
    case("injection does not mutate its input", "charts_workspace_layout" not in p)
    case("verdict: identical is SAME", verdict(0.0, 0.15) == "SAME")
    case("verdict: a real difference is DIFFERENT", verdict(4.0, 0.15) == "DIFFERENT")
    case("verdict: unmeasured is INCONCLUSIVE, never SAME", verdict(None, 0.15) == "INCONCLUSIVE")
    case("the swap list is exactly the product change", len(SWAP) == 2 and all(
        (REPO / f).exists() for f in SWAP))
    # ⛔ SYNTHETIC VALUE ONLY. The first version of this block pasted a slice of the
    # REAL leaked token in as a fixture — in a committed file, in a PUBLIC repo. The
    # scanner found it, which is the entire argument for having a scanner. A rail for a
    # credential leak must never carry a credential, not even a partial one.
    fake = "cookie: " + "uct_" + "session=" + ("Z" * 40)
    case("scrub removes a session cookie", "Z" * 40 not in scrub(fake))
    case("scrub keeps the header name so the line still reads",
         "cookie" in scrub(fake).lower() and "<redacted>" in scrub(fake))
    case("scrub survives a multi-line playwright call log",
         "Z" * 40 not in scrub(f"Route.fetch failed\n  - {fake}\n  - x: 1"))
    case("scrub leaves ordinary text alone", scrub("charts-breadth__390__after.png")
         == "charts-breadth__390__after.png")
    case("brief drops the call log", "\n" not in brief(RuntimeError(f"boom\n  - {fake}")))
    case("this file carries no credential of its own",
         not scan_text(pathlib.Path(__file__).read_text(encoding="utf-8")))
    say("SELF-CHECK " + ("PASS" if not fails else f"FAIL ({len(fails)})"))
    return 0 if not fails else 1


# ── local origin ──────────────────────────────────────────────────────────────

class _SPA(http.server.SimpleHTTPRequestHandler):
    nonce = ""

    def log_message(self, *a):          # noqa: A003 - quiet
        pass

    def do_GET(self):                   # noqa: N802
        if self.path.split("?")[0] == IDENTITY:
            body = self.nonce.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        path = self.translate_path(self.path)
        if not os.path.isfile(path):    # SPA fallback — /charts is a client route
            self.path = "/index.html"
        return super().do_GET()


def serve(dist: pathlib.Path):
    """Bind an OS-assigned port and PROVE the server answering it is this one."""
    nonce = secrets.token_hex(8)
    handler = functools.partial(_SPA, directory=str(dist))
    _SPA.nonce = nonce
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    import urllib.request
    for _ in range(40):
        try:
            got = urllib.request.urlopen(f"http://127.0.0.1:{port}{IDENTITY}", timeout=1).read().decode()
            if got == nonce:
                return httpd, port
            raise RuntimeError(f"another server owns port {port} (nonce mismatch)")
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("local server never answered its own identity probe")


# ── capture ───────────────────────────────────────────────────────────────────

def capture(dist, tag: str, out_dir: pathlib.Path, email, password, live: bool = False):
    """`live=True` captures the DEPLOYED build straight from production — the post-deploy
    smoke, where there is no second build to compare and the artifact under test is the
    one members are served. The preference injection and the POST block are unchanged, so
    the account is still never written to."""
    from playwright.sync_api import sync_playwright
    httpd = None
    if live:
        origin = BASE
        say(f"  [{tag}] LIVE against {origin} (the deployed artifact)")
    else:
        httpd, port = serve(dist)
        origin = f"http://127.0.0.1:{port}"
        say(f"  [{tag}] serving {dist.name} at {origin} (identity verified)")
    rec = {"tag": tag, "origin": origin, "shots": {}, "proxied": 0,
           "pref_writes_blocked": 0, "pref_write_keys": [], "auth_probe": None,
           "ready": {}, "content": {}, "errors": []}
    try:
        with sync_playwright() as pw:
            rq = pw.request.new_context(base_url=BASE, user_agent=UA)
            # ⛔ A 5xx AT THE EDGE IS TRANSPORT, NOT AN ANSWER. Measured during a burst of
            # unrelated master pushes: login returned 502 in 0.2s (an immediate edge
            # refusal, not a timeout) and 200 in 0.4s on the next attempt, with
            # `/api/health` reporting 200 and a rising uptime throughout — health is a
            # proxy and it was green over a login path that was not.
            #
            # ⛔ This is NOT a retry-loop to make a check pass: only 5xx is retried, the
            # attempt count is recorded, and a 4xx (a real refusal — wrong password,
            # rate limit) fails immediately and is never retried.
            r = None
            for attempt in range(3):
                fcr._pace_login()
                r = rq.post("/api/auth/login", data={"email": email, "password": password})
                rec["login_attempts"] = attempt + 1
                if r.status < 500:
                    break
                rec.setdefault("notes", []).append(f"login http {r.status} on attempt {attempt + 1}")
                time.sleep(12)
            if r is None or r.status != 200:
                rec["errors"].append(f"login http {r.status if r else 'none'} after "
                                     f"{rec.get('login_attempts')} attempt(s)")
                return rec
            storage = rq.storage_state()
            browser = pw.chromium.launch()
            for width, height in sorted(WIDTHS.items()):
                ctx = browser.new_context(storage_state=storage, user_agent=UA,
                                          device_scale_factor=1,
                                          viewport={"width": width, "height": height})

                def api(route, request):
                    # The widget keeps polling; a request still in flight when the
                    # context closes raises here. That is teardown, not a finding —
                    # swallow it, and NEVER let the raw error out (it carries the
                    # session cookie of the call that failed).
                    try:
                        target = rewrite_target(request.url)
                        path = urlsplit(request.url).path
                        if path == PREFS_PATH and request.method != "GET":
                            rec["pref_writes_blocked"] += 1
                            try:
                                rec["pref_write_keys"].append((request.post_data_json or {}).get("key"))
                            except Exception:                   # noqa: BLE001
                                rec["pref_write_keys"].append(None)
                            return route.fulfill(status=200, json={"ok": True})
                        resp = route.fetch(url=target)
                        rec["proxied"] += 1
                        if path == PREFS_PATH:
                            try:
                                data = resp.json()
                            except Exception:                   # noqa: BLE001
                                return route.fulfill(response=resp)
                            if isinstance(data, dict):
                                return route.fulfill(response=resp, json=inject_layout(data))
                        return route.fulfill(response=resp)
                    except Exception as e:                      # noqa: BLE001
                        rec["route_errors"] = rec.get("route_errors", 0) + 1
                        try:
                            route.abort()
                        except Exception:                       # noqa: BLE001
                            pass
                        return None

                ctx.route("**/api/**", api)
                page = ctx.new_page()
                page.on("pageerror", lambda e: rec["errors"].append(scrub(e)[:200]))
                page.goto(origin + "/charts", wait_until="commit", timeout=60000)
                # The intro is skippable; click it rather than waiting out ~9.3s twice a
                # width. Best-effort — if it is already gone, READY_JS settles anyway.
                for label in ("Skip", "SKIP"):
                    try:
                        b = page.get_by_role("button", name=label, exact=True)
                        if b.count() and b.first.is_visible():
                            b.first.click()
                            break
                    except Exception:                           # noqa: BLE001
                        pass
                # Non-vacuity control: the rewrite must actually reach production AS
                # the member. Without this the page can be a signed-out shell and
                # every screenshot below would still be "captured".
                if rec["auth_probe"] is None:
                    me = page.request.get(origin + "/api/auth/me")
                    rec["auth_probe"] = me.status
                state = ""
                for _ in range(60):
                    state = page.evaluate(READY_JS)
                    if state:
                        break
                    page.wait_for_timeout(500)
                rec["ready"][str(width)] = state or "timeout"
                # ⚰️ The first-visit "Meet Compass" coach mark is app chrome that sits over
                # the lower right of the widget. It is DISMISSED before capture, not
                # screenshotted into every frame — the same call `breadth_charts_rig`
                # makes. The dismissal writes a preference, which this run blocks and
                # counts like any other, so the account is still never written to.
                try:
                    got = page.get_by_role("button", name="Got it", exact=True)
                    if got.count() and got.first.is_visible():
                        got.first.click()
                        rec.setdefault("notes", []).append(f"{width}px: coach mark dismissed")
                        page.wait_for_timeout(400)
                except Exception:                               # noqa: BLE001
                    pass
                rec["content"][str(width)] = page.evaluate(CONTENT_JS)
                page.wait_for_timeout(2500)          # ECharts settle
                out_dir.mkdir(parents=True, exist_ok=True)
                shot = out_dir / f"charts-breadth__{width}__{tag}.png"
                page.screenshot(path=str(shot))
                rec["shots"][str(width)] = shot.name
                try:                       # drain in-flight routes before teardown
                    page.unroute_all(behavior="ignoreErrors")
                except Exception:                               # noqa: BLE001
                    pass
                ctx.close()
            browser.close()
    finally:
        if httpd is not None:
            httpd.shutdown()
    return rec


def diff(before: pathlib.Path, after: pathlib.Path, out: pathlib.Path):
    """Fraction of pixels that differ. None when the pair is not comparable."""
    try:
        from PIL import Image, ImageChops
    except Exception:                                           # noqa: BLE001
        return None, "Pillow unavailable"
    a, b = Image.open(before).convert("RGB"), Image.open(after).convert("RGB")
    if a.size != b.size:
        return None, f"size {a.size} vs {b.size}"
    ch = ImageChops.difference(a, b)
    bbox = ch.getbbox()
    n = sum(1 for px in ch.getdata() if px != (0, 0, 0))
    pct = 100.0 * n / (a.size[0] * a.size[1])
    if bbox:
        ch.point(lambda v: min(255, v * 8)).save(out)
    return pct, (f"bbox {bbox}" if bbox else "identical")


def build(label):
    say(f"  building {label} …")
    t = time.monotonic()
    r = subprocess.run(["npm", "run", "build"], cwd=str(REPO / "app"),
                       capture_output=True, text=True, shell=(os.name == "nt"))
    if r.returncode != 0:
        say(r.stdout[-2000:] + r.stderr[-2000:])
        raise RuntimeError(f"{label} build failed")
    say(f"  built {label} in {time.monotonic() - t:.0f}s")


def stage(dest: pathlib.Path):
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(REPO / "app" / "dist", dest)


def build_both(work: pathlib.Path):
    """after = this tree. before = master's two registry files, restored by BYTES."""
    originals = {f: (REPO / f).read_bytes() for f in SWAP}
    shas = {f: sha(REPO / f) for f in SWAP}
    build("after (this branch)")
    stage(work / "dist-after")
    swapped = False
    try:
        for f in SWAP:
            blob = subprocess.run(["git", "show", f"origin/master:{f}"], cwd=str(REPO),
                                  capture_output=True, check=True).stdout
            if blob == originals[f]:
                raise RuntimeError(f"{f} is identical to master — nothing to A/B")
            (REPO / f).write_bytes(blob)
        swapped = True
        build("before (origin/master registry)")
        stage(work / "dist-before")
    finally:
        if swapped:
            for f in SWAP:
                (REPO / f).write_bytes(originals[f])
            for f in SWAP:
                now = sha(REPO / f)
                if now != shas[f]:
                    raise RuntimeError(f"RESTORE FAILED for {f}: {now} != {shas[f]}")
            say("  restored both files; sha verified")
    return work / "dist-before", work / "dist-after"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default="docs/breadth/screenshots/registry-unification")
    ap.add_argument("--work", default="")
    ap.add_argument("--build-both", action="store_true")
    ap.add_argument("--before-dist", default="")
    ap.add_argument("--after-dist", default="")
    ap.add_argument("--tolerance", type=float, default=0.15)
    ap.add_argument("--live", default="", metavar="TAG",
                    help="capture the DEPLOYED build from production under this tag (post-deploy smoke)")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()

    email, password = os.environ.get("MEMBER_SMOKE_EMAIL"), os.environ.get("MEMBER_SMOKE_PASSWORD")
    if not (email and password):
        say("INCONCLUSIVE: MEMBER_SMOKE_EMAIL / MEMBER_SMOKE_PASSWORD not set.")
        return 2

    out_dir = (REPO / a.out) if not os.path.isabs(a.out) else pathlib.Path(a.out)
    work = pathlib.Path(a.work) if a.work else pathlib.Path(os.environ.get("TEMP", "/tmp")) / "uct_ab"
    work.mkdir(parents=True, exist_ok=True)

    if a.live:
        rec = capture(None, a.live, out_dir, email, password, live=True)
        ok = rec["auth_probe"] == 200 and any(v == "ok" for v in rec["ready"].values())
        for w, st in rec["ready"].items():
            say(f"  {w}px  {st}" + ("  (NOT APPLICABLE — MobileWorkspace)" if st == "mobile-workspace" else ""))
        say(f"  auth {rec['auth_probe']} · proxied {rec['proxied']} · preference writes blocked "
            f"{rec['pref_writes_blocked']} · errors {len(rec['errors'])}")
        (out_dir / f"live-{a.live}.json").write_text(json.dumps(rec, indent=2))
        say("LIVE SMOKE: " + ("widget renders on the deployed build" if ok else "INCONCLUSIVE"))
        return 0 if ok else 2

    if a.build_both:
        # ⛔ Only the SWAP path needs a clean tree: it rewrites two tracked files and
        # restores them by bytes. Gating the pre-built path on it too refused a re-run
        # that touches nothing (and did, on the run that produced this comment).
        if subprocess.run(["git", "status", "--porcelain"], cwd=str(REPO),
                          capture_output=True, encoding="utf-8", errors="replace").stdout.strip():
            say("INCONCLUSIVE: the worktree is dirty; the byte-swap harness refuses to run.")
            return 2
        before_dist, after_dist = build_both(work)
    else:
        before_dist, after_dist = pathlib.Path(a.before_dist), pathlib.Path(a.after_dist)
        if not (before_dist.is_dir() and after_dist.is_dir()):
            say("INCONCLUSIVE: pass --build-both, or both --before-dist and --after-dist.")
            return 2

    report = {"utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "runs": {}, "diff": {}}
    for tag, dist in (("before", before_dist), ("after", after_dist)):
        report["runs"][tag] = capture(dist, tag, out_dir, email, password)

    bad = False
    for tag, rec in report["runs"].items():
        if rec["auth_probe"] != 200:
            say(f"INCONCLUSIVE [{tag}]: /api/auth/me through the rewrite returned {rec['auth_probe']}.")
            bad = True
        if rec["pref_writes_blocked"] and any(k for k in rec["pref_write_keys"]):
            say(f"  [{tag}] blocked {rec['pref_writes_blocked']} preference write(s): {rec['pref_write_keys']}")
        for w, st in rec["ready"].items():
            if st == "mobile-workspace":
                say(f"  [{tag}] {w}px  NOT APPLICABLE — /charts renders MobileWorkspace at this "
                    f"width; the Breadth widget has no phone surface to compare.")
            elif st != "ok":
                say(f"INCONCLUSIVE [{tag}] {w}px: widget never rendered ({st}).")
                bad = True
    if bad:
        (out_dir / "ab-report.json").write_text(json.dumps(report, indent=2))
        return 2

    # ── PRIMARY: the widget's own text, compared exactly ──────────────────────────
    text_same, compared = True, 0
    for w in sorted(WIDTHS):
        states = {report["runs"][t_]["ready"].get(str(w)) for t_ in ("before", "after")}
        if states == {"mobile-workspace"}:
            report["diff"][str(w)] = {"not_applicable": "MobileWorkspace — no widget at this width"}
            continue
        cb = report["runs"]["before"]["content"].get(str(w), "")
        ca = report["runs"]["after"]["content"].get(str(w), "")
        if not cb or not ca:
            say(f"  {w}px  TEXT INCONCLUSIVE — one side captured nothing")
            (out_dir / "ab-report.json").write_text(json.dumps(report, indent=2))
            return 2
        compared += 1
        same = cb == ca
        text_same &= same
        report["diff"][str(w)] = {"text_identical": same, "chars": len(ca)}
        say(f"  {w}px  TEXT {'IDENTICAL' if same else 'DIFFERS'}  ({len(ca)} chars, "
            f"{len(ca.splitlines())} lines)")
        if not same:
            import difflib
            delta = [l for l in difflib.unified_diff(cb.splitlines(), ca.splitlines(),
                                                     "before", "after", lineterm="", n=1)][:40]
            (out_dir / f"text-diff__{w}.txt").write_text("\n".join(delta), encoding="utf-8")
            for line in delta[:12]:
                say("      " + line)

    # ── SUPPORTING: pixels, reported but never the verdict (animated chrome) ───────
    for w in sorted(WIDTHS):
        b = out_dir / f"charts-breadth__{w}__before.png"
        f = out_dir / f"charts-breadth__{w}__after.png"
        pct, note = diff(b, f, out_dir / f"charts-breadth__{w}__diff.png")
        report["diff"].setdefault(str(w), {}).update({"pixel_pct": pct, "pixel_note": note})
        say(f"  {w}px  pixels {('%.4f%%' % pct) if pct is not None else '—'} "
            f"(supporting only — the orb and icon shimmer animate)  ({note})")

    (out_dir / "ab-report.json").write_text(json.dumps(report, indent=2))
    say(f"report → {out_dir / 'ab-report.json'}")
    if compared == 0:
        # ⛔ "Nothing differed" over zero comparisons is not a pass.
        say("INCONCLUSIVE: no width rendered the widget on both sides — nothing was compared.")
        return 2
    say("VERDICT: " + ("the /charts Breadth widget renders IDENTICAL text before and after"
                       if text_same else "TEXT DIFFERS — a finding"))
    return 0 if text_same else 1


if __name__ == "__main__":
    # ⛔ EXIT 1 MEANS "A DIFFERENCE WAS MEASURED". An uncaught exception would exit 1
    # too, which makes a crash indistinguishable from a finding — the exact collapse
    # `CoverageLine` and `hub_nav_smoke` exist to avoid. A crash is INCONCLUSIVE (2).
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except BaseException as _e:                                 # noqa: BLE001
        say(f"INCONCLUSIVE: the run did not complete — {brief(_e)}")
        raise SystemExit(2) from None
