"""Cold-first-paint rig for Options Flow.

Produces the item-8 measurement: time to first content, wire bytes, which parts
came from cache vs were built, and `X-Flow-Version` at paint versus the current
version — per run, plus median and WORST case.

⛔ EVERY NUMBER IS LABELLED. On a quiet tape the parts are already warm and the
version never rolls, so a run measures a best case that no member ever hits during
RTH. The label rides on every row and on the summary; `--certifying` is the only
way to drop it, and it should only be passed during RTH.

⭐ THE OPERATING REQUIREMENTS LIVE IN `docs/runbooks/flow-cold-paint-rig.md`:
the TWO PATHS a session must measure separately (direct load, intro-gated, vs
in-app navigation, no intro) and the rule that EVERY run reports its transport
— whole-D vs parts — so a regression cannot hide behind a fast-looking number.
That file also records which half of the two-path requirement this tool does
NOT implement yet. Read it before quoting any number this script prints.

## The traps this encodes, each already paid for in this codebase

- ⛔ **A hidden tab never loads Options Flow at all.** `shouldFetchVersion` gates on
  `visibilityState === 'visible'`, so in a hidden tab dataVersion never resolves,
  ZERO `/api/flow/*` fire, and the page sits at `contentLen 244`. Asserted at
  runtime, not assumed.
- ⛔ **MutationObserver, never a timer,** for visible state. A timer is throttled
  and the state SEQUENCE goes wrong under load — that instrument error once had
  byte reductions reported while members still saw a full-page spinner.
- ⛔ **Streaming response capture, never `getEntriesByType('resource')`,** which
  caps at 250 entries and DROPS. It once reported "no raw arrays fetched" during a
  run where they were.
- ⛔ **Viewport pinned ≥1025px.** The left NavBar does not exist below that, and an
  unpinned viewport once reported every nav entry "not rendered for this account".
- ⛔ **A fresh context per run** — that is the cache clear. Reusing a context
  measures warm re-entry while calling it cold.

## Account

Reads `MEMBER_SMOKE_EMAIL` / `MEMBER_SMOKE_PASSWORD` from the environment. That
account is role=member, plan=pro/comped — a MEMBER session, which is the point: the
admin smoke account may render more regions than a member's, so an admin number is
not a member number. Run the admin account only as a labelled secondary comparison.

Usage:
    python tools/flow_cold_paint_rig.py --runs 5
    python tools/flow_cold_paint_rig.py --runs 5 --certifying     # RTH only
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.request

# ⛔ THE PAGE'S OWN TEXT IS PRINTED, AND A WINDOWS CONSOLE IS cp1252.
# 2026-09-12: run 1 measured the fix working, then the rig DIED on `⌘` in
# the body head — a UnicodeEncodeError that lost runs 2 and 3 and would have
# taken Monday's session with it. A rig that crashes on the content it is
# reporting is not measuring; reconfigure once, globally, rather than guarding
# each print and missing one.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="backslashreplace")
    except Exception:                                   # noqa: BLE001
        pass

BASE = os.environ.get("RIG_BASE", "https://uctintelligence.com")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

# Injected BEFORE any page script. Records the first DOM mutation that adds real
# content, and keeps its own response ledger so nothing depends on the capped
# resource-timing buffer.
_INIT = """
// ⛔ add_init_script runs at document-start, BEFORE documentElement exists — an
// unguarded observe() throws there and the observer silently never exists. That
// is exactly what happened on the first dry run: the page rendered 4,402 chars
// and firstContent stayed null for 45 s. Attach as soon as there is something to
// attach to, and carry a rAF belt so a thrown observer cannot silently mean
// "the page never painted".
window.__rig = {firstContent: null, visibleAtStart: document.visibilityState,
                observerAttached: false, via: null};
(function () {
  function mark(via) {
    if (window.__rig.firstContent !== null) return;
    var b = document.body;
    if (!b) return;
    // ⛔ THE INTRO ANIMATION PAINTS FIRST AND IS NOT THE PAGE. It plays on every
    // load (~9.3s, SKIP button) and renders ~657 chars of compass/coordinate text.
    // A naive body-text threshold marks IT as first content — a flattering ~470ms
    // that has nothing to do with Options Flow. Require the page's own chrome to be
    // present and a volume of text the intro never reaches.
    var txt = (b.innerText || '').trim();
    if (txt.length > 1500 && txt.indexOf('CHARTING THE MARKET') === -1) {
      window.__rig.firstContent = performance.now();
      window.__rig.via = via;
    }
  }
  function attach() {
    var root = document.documentElement || document.body;
    if (!root) { requestAnimationFrame(attach); return; }
    try {
      new MutationObserver(function () { mark('mutation'); })
        .observe(root, {childList: true, subtree: true, characterData: true});
      window.__rig.observerAttached = true;
    } catch (e) { window.__rig.observerAttached = String(e).slice(0, 60); }
  }
  attach();
  // rAF belt: frame-synced, not a throttled timer, and the tab is asserted visible.
  (function tick() {
    mark('raf');
    if (window.__rig.firstContent === null) requestAnimationFrame(tick);
  })();
})();
"""


def _uptime():
    """The web pod's uptime in seconds, or None if it could not be read.

    ⛔ EVERY MASTER PUSH REBUILDS WEB. A run that straddles a deploy swap is
    measuring two different pods, and the failure does not announce itself as a
    deploy: on 2026-09-12 another workstream pushed five times in six minutes and
    the rig reported `login http 502` on three consecutive runs, which reads
    exactly like a broken product. `/api/health` was 502 in that window and 200
    with a 46 s uptime immediately after.
    """
    try:
        req = urllib.request.Request(BASE + "/api/health", headers={"User-Agent": UA})
        body = json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
        return float(body["uptime_seconds"])
    except Exception:                                       # noqa: BLE001
        return None


# ⛔⛔ `/api/auth/login` IS `@limiter.limit("5/minute")`, KEYED BY CLIENT IP
# (api/routers/auth.py:246, slowapi). Every rig run opens a FRESH context — that
# is the cache clear, so it cannot be avoided — and therefore logs in once. A
# naive sequence of runs trips the limiter on the 6th login inside any minute.
#
# ⚰️ Measured 2026-09-12: three consecutive path-B runs came back
# `login http 429` and read exactly like a broken product. On a Monday open that
# costs the measurement window, which is the one thing that cannot be re-run.
#
# ⭐ 4 per minute, not 5. The limiter's window is the SERVER's, not ours: our
# clock, the request's travel time and any retry all shift where a login lands
# inside it. One slot of headroom turns a boundary race into a non-event.
_LOGIN_MAX_PER_MIN = 4
_LOGIN_WINDOW_S = 60.0
_LOGIN_TIMES = []


def _login_wait_s(times, now, max_per_min=None, window_s=None):
    """Seconds a login must wait, 0 when it is clear. PURE - no clock, no sleep,
    so the decision is testable without spending a minute to reach it."""
    cap = _LOGIN_MAX_PER_MIN if max_per_min is None else max_per_min
    win = _LOGIN_WINDOW_S if window_s is None else window_s
    recent = [t for t in times if now - t < win]
    if len(recent) < cap:
        return 0.0, recent
    return win - (now - min(recent)) + 0.5, recent


def _pace_login(now=None):
    """Block until a login would not trip the limiter. Returns seconds slept.

    Kept as a module-level ledger rather than per-run state on purpose: the
    limiter counts per IP across every run, path and account, so a per-run
    counter would be blind to exactly the sequence that trips it.
    """
    import time as _t
    now = _t.monotonic() if now is None else now
    slept = 0.0
    while True:
        wait, recent = _login_wait_s(_LOGIN_TIMES, now)
        del _LOGIN_TIMES[:]
        _LOGIN_TIMES.extend(recent)
        if wait <= 0:
            _LOGIN_TIMES.append(now)
            return slept
        print("        [pace] %d logins in the last %.0fs - waiting %.1fs so the "
              "5/minute limiter cannot cost a run"
              % (len(recent), _LOGIN_WINDOW_S, wait))
        _t.sleep(max(wait, 0.1))
        slept += max(wait, 0.1)
        now = _t.monotonic()


# ⛔ A POD THIS YOUNG IS COLD, NOT MERELY UNSWAPPED. Measured 2026-09-12: a run
# that began on a 38-second-old pod reported `parts served: NONE` with the page
# shell rendered, because the deploy had just completed and the parts cache was
# empty. The same run on a 232-second-old pod served all six parts. At the open
# that run would read as a MEMBER FAILURE, which is exactly the misreading this
# threshold exists to prevent.
#
# ⭐ 120s is a floor derived from the observed warm/cold pair (38 cold, 232 warm),
# not a tuned number — it is deliberately generous, because the cost of an extra
# INCONCLUSIVE is one re-run and the cost of a false failure is a wrong diagnosis
# at the open. Override with --min-pod-age when there is a reason to.
MIN_POD_AGE_S = 120.0


def _swap_verdict(up_before, up_after, elapsed_s, min_pod_age=None):
    """(invalid, why) — whether a DEPLOY invalidated this run, and how.

    FOUR ways, checked in this order, and the order is load-bearing: the
    pod-younger-than-the-run case is reported as such before the cold-start case
    so its message stays specific rather than being swallowed by the broader one.

        1. uptime unreadable      — during a swap `/api/health` itself 502s, so
                                    "could not tell" is the swap wearing a blank face
        2. uptime went BACKWARD   — a swap landed mid-run
        3. pod younger than run   — a swap landed mid-run even though uptime rose
        4. pod too young at START — no swap during the run, but the pod is COLD

    ⛔ FAILS CLOSED. Every branch returns True. Forward uptime proves only that no
    swap happened DURING the run; it says nothing about whether the pod was warm
    enough to measure, which is what (4) adds.

    The field on a row stays `deploy_swapped` because every one of these is caused
    by a deploy; `swap_reason` is what distinguishes them.
    """
    floor = MIN_POD_AGE_S if min_pod_age is None else min_pod_age
    if up_before is None or up_after is None:
        return True, "uptime unreadable (health 502 during a swap reads like this)"
    if up_after < up_before:
        return True, "uptime went BACKWARD %.0fs -> %.0fs" % (up_before, up_after)
    if up_after < elapsed_s:
        return True, ("pod is younger (%.0fs) than the run (%.0fs)"
                      % (up_after, elapsed_s))
    if up_before < floor:
        return True, ("pod was only %.0fs old at the START (floor %.0fs) - COLD, "
                      "caches unwarmed; a parts miss here is not a member failure"
                      % (up_before, floor))
    return False, ""


def _fmt(v, unit=""):
    return "n/a" if v is None else ("%.0f%s" % (v, unit) if isinstance(v, (int, float)) else str(v))


def run_once(pw, email, password, idx, certifying, min_pod_age=None):
    """One cold load in a FRESH context. Returns a dict of measurements."""
    from playwright.sync_api import TimeoutError as PWTimeout

    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(user_agent=UA, viewport={"width": 1440, "height": 900})
    responses = []
    try:
        # ⛔ BEFORE anything else: a run that straddles a deploy swap measures two
        # pods and must be discarded, not averaged. See _swap_verdict.
        up_before = _uptime()
        t_run = time.monotonic()
        # Scripted login — page.request keeps the cookie in the context jar, which
        # is robust against the intro overlay (the documented approach).
        _pace_login()
        r = ctx.request.post(BASE + "/api/auth/login",
                             data={"email": email, "password": password})
        if r.status != 200:
            up_after = _uptime()
            swapped, why = _swap_verdict(up_before, up_after, time.monotonic() - t_run,
                                       min_pod_age)
            if r.status == 429:
                # ⛔ The limiter measured nothing. Reported as INCONCLUSIVE rather
                # than an error, because "login refused" reads like a broken product
                # and this one is the harness's own footprint.
                swapped, why = True, ("login RATE-LIMITED (5/minute per IP) - nothing "
                                      "was measured; space the runs")
            return {"run": idx, "error": "login http %s" % r.status,
                    "deploy_swapped": swapped, "swap_reason": why,
                    "uptime_before": up_before, "uptime_after": up_after}
        role = ((r.json() or {}).get("user") or {}).get("role")

        page = ctx.new_page()
        page.add_init_script(_INIT)
        page.on("response", lambda resp: responses.append({
            "url": resp.url,
            "status": resp.status,
            "part": resp.headers.get("x-flow-part"),
            "version": resp.headers.get("x-flow-version"),
            "clen": resp.headers.get("content-length"),
        }))

        t0 = time.monotonic()
        page.goto(BASE + "/options-flow", wait_until="commit", timeout=60000)
        # ⚠️ DO NOT press Escape here. Tried 2026-09-12: dismissing the intro that
        # way dropped the rendered body from 4,402 chars to 540 and produced a
        # duplicated aggregate+data round — it disturbs the app, it does not just
        # skip an overlay. The intro is excluded by the DETECTOR instead (see _INIT),
        # which costs up to ~9s of wall time per run and measures the right thing.
        # Wait for first content or a bounded ceiling — never a fixed sleep.
        try:
            page.wait_for_function("window.__rig && window.__rig.firstContent !== null",
                                   timeout=45000)
        except PWTimeout:
            pass
        rig = page.evaluate("window.__rig") or {}
        diag = page.evaluate(
            "({url: location.pathname, title: document.title,"
            " len: (document.body && document.body.innerText || '').length,"
            " vis: document.visibilityState,"
            " head: (document.body && document.body.innerText || '').slice(0,120)})")
        # Let deferred/interaction parts land so the ledger is complete.
        page.wait_for_timeout(6000)
        wall_ms = (time.monotonic() - t0) * 1000

        flow = [x for x in responses if "/api/flow/" in x["url"]]
        parts = {x["part"]: x for x in flow if x["part"]}
        vers = sorted({x["version"] for x in flow if x["version"]})
        wire = sum(int(x["clen"]) for x in flow if (x["clen"] or "").isdigit())

        cur = ctx.request.get(BASE + "/api/flow/version")
        cur_v = cur.text().strip()[:40] if cur.status == 200 else None

        up_after = _uptime()
        swapped, why = _swap_verdict(up_before, up_after, time.monotonic() - t_run,
                                       min_pod_age)

        return {
            "run": idx,
            "deploy_swapped": swapped,
            "swap_reason": why,
            "uptime_before": up_before,
            "uptime_after": up_after,
            "role": role,
            "visible_at_start": rig.get("visibleAtStart"),
            "observer_attached": rig.get("observerAttached"),
            "detected_via": rig.get("via"),
            "first_content_ms": rig.get("firstContent"),
            "wall_ms": wall_ms,
            "flow_requests": len(flow),
            "parts_served": sorted(parts),
            "part_versions": vers,
            "current_version_after": cur_v,
            "wire_bytes_flow": wire,
            "flow_urls": [x["url"].split("/api/flow/")[-1][:70] for x in flow],
            "certifying": certifying,
            "diag": diag,
        }
    finally:
        ctx.close()
        browser.close()


# ─────────────────────────────────────────────────────────────────────────────
# PATH B — in-app navigation. The number WITHOUT the intro animation.
# ─────────────────────────────────────────────────────────────────────────────
# ⛔ CLICK, NEVER `goto`. A full page load rebuilds the world and replays the
# intro — that is path A wearing path B's label, and it is exactly what hid the
# 2026-09-10 app-wide navigation freeze from every instrument that looked.
#
# ⛔ A BODY-TEXT THRESHOLD CANNOT WORK HERE. The page you navigate FROM already
# exceeds any threshold, so "lots of text" is true before the click. Path B keys
# on Options Flow's OWN DOM instead, and reports two signals rather than one:
#
#     shell_ms  `.of-mroot`  — the page's root rendered
#     picks_ms  `.of-picks`  — the TOP 10 FLOW PICKS table rendered, which is the
#                              PRODUCT of `part=TOP_PICKS`. A shell without picks
#                              is a page that painted without its content.
#
# ⛔ AND THE URL IS REPORTED SEPARATELY. A URL that moves while the screen does
# not is the freeze signature; collapsing the two into one "it loaded" would make
# that indistinguishable from a slow render.
_NAV_JS = """
(() => {
  const t0 = performance.now();
  window.__rigB = {t0: t0, shell: null, picks: null, attached: false,
                   startUrl: location.pathname};
  const mark = () => {
    const b = window.__rigB;
    if (b.shell === null && document.querySelector('.of-mroot')) b.shell = performance.now() - t0;
    if (b.picks === null && document.querySelector('.of-picks')) b.picks = performance.now() - t0;
  };
  try {
    new MutationObserver(mark).observe(document.documentElement,
      {childList: true, subtree: true});
    window.__rigB.attached = true;
  } catch (e) { window.__rigB.attached = String(e).slice(0, 60); }
  // rAF belt, frame-synced rather than a throttled timer; the tab is asserted visible.
  (function tick() {
    mark();
    if (window.__rigB.picks === null) requestAnimationFrame(tick);
  })();
  mark();
})();
"""


def run_once_path_b(pw, email, password, idx, certifying,
                    start_route="/dashboard", min_pod_age=None):
    """One IN-APP navigation into Options Flow, in a FRESH context."""
    from playwright.sync_api import TimeoutError as PWTimeout

    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(user_agent=UA, viewport={"width": 1440, "height": 900})
    responses = []
    try:
        up_before = _uptime()
        t_run = time.monotonic()
        _pace_login()
        r = ctx.request.post(BASE + "/api/auth/login",
                             data={"email": email, "password": password})
        if r.status != 200:
            up_after = _uptime()
            swapped, why = _swap_verdict(up_before, up_after, time.monotonic() - t_run,
                                       min_pod_age)
            if r.status == 429:
                # ⛔ The limiter measured nothing. Reported as INCONCLUSIVE rather
                # than an error, because "login refused" reads like a broken product
                # and this one is the harness's own footprint.
                swapped, why = True, ("login RATE-LIMITED (5/minute per IP) - nothing "
                                      "was measured; space the runs")
            return {"run": idx, "path": "B", "error": "login http %s" % r.status,
                    "deploy_swapped": swapped, "swap_reason": why,
                    "uptime_before": up_before, "uptime_after": up_after}
        role = ((r.json() or {}).get("user") or {}).get("role")

        page = ctx.new_page()
        page.on("response", lambda resp: responses.append({
            "url": resp.url, "status": resp.status,
            "part": resp.headers.get("x-flow-part"),
            "version": resp.headers.get("x-flow-version"),
            "clen": resp.headers.get("content-length"),
        }))

        # Land somewhere that is NOT the target: clicking the entry for the page
        # you are already on changes no URL, which reads exactly like a freeze.
        page.goto(BASE + start_route, wait_until="commit", timeout=60000)
        # Let the intro finish on ITS load, so path B measures none of it.
        try:
            page.wait_for_function(
                "(() => { const t=(document.body&&document.body.innerText||'');"
                " return t.length > 1500 && t.indexOf('CHARTING THE MARKET') === -1; })()",
                timeout=45000)
        except PWTimeout:
            return {"run": idx, "path": "B",
                    "error": "start route never settled past the intro"}
        page.wait_for_timeout(1500)      # let the start route quiesce

        link = page.locator('a[href="/options-flow"]').first
        if link.count() == 0:
            return {"run": idx, "path": "B",
                    "error": "no /options-flow nav link (viewport below 1025px?)"}

        # ⚠️ Instrument overhead is REAL and stated: t0 is taken inside the
        # injection, and the click is a separate round trip a few ms later. It is
        # charged to the page, which is the conservative direction.
        before = len(responses)
        page.evaluate(_NAV_JS)
        link.click()
        try:
            page.wait_for_function("window.__rigB && window.__rigB.picks !== null",
                                   timeout=45000)
        except PWTimeout:
            pass
        rigb = page.evaluate("window.__rigB") or {}
        page.wait_for_timeout(6000)      # let deferred parts land

        diag = page.evaluate(
            "({url: location.pathname,"
            " len: (document.body && document.body.innerText || '').length,"
            " shell: !!document.querySelector('.of-mroot'),"
            " picks: !!document.querySelector('.of-picks'),"
            " vis: document.visibilityState})")

        # Only the requests the CLICK caused — the start route's own traffic is
        # not Options Flow's cost.
        flow = [x for x in responses[before:] if "/api/flow/" in x["url"]]
        parts = {x["part"]: x for x in flow if x["part"]}
        wire = sum(int(x["clen"]) for x in flow if (x["clen"] or "").isdigit())

        up_after = _uptime()
        swapped, why = _swap_verdict(up_before, up_after, time.monotonic() - t_run,
                                       min_pod_age)

        return {
            "run": idx, "path": "B", "role": role,
            "deploy_swapped": swapped,
            "swap_reason": why,
            "uptime_before": up_before,
            "uptime_after": up_after,
            "start_route": start_route,
            "url_changed": diag.get("url") != start_route,
            "observer_attached": rigb.get("attached"),
            "shell_ms": rigb.get("shell"),
            "picks_ms": rigb.get("picks"),
            "flow_requests": len(flow),
            "parts_served": sorted(parts),
            "part_versions": sorted({x["version"] for x in flow if x["version"]}),
            "wire_bytes_flow": wire,
            "flow_urls": [x["url"].split("/api/flow/")[-1][:70] for x in flow],
            "certifying": certifying,
            "diag": diag,
        }
    finally:
        ctx.close()
        browser.close()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--certifying", action="store_true",
                    help="RTH only. Without it every number is labelled as not a measurement.")
    ap.add_argument("--path", choices=("a", "b", "both"), default="both",
                    help="a = direct load (intro plays). b = in-app navigation (no "
                         "intro). BOTH is the default because one number alone is "
                         "not a measurement of the page - see "
                         "docs/runbooks/flow-cold-paint-rig.md.")
    ap.add_argument("--min-pod-age", type=float, default=MIN_POD_AGE_S,
                    help="a run starting on a pod younger than this (seconds) is "
                         "INCONCLUSIVE - the caches are cold and a parts miss is "
                         "not a member failure. Default %(default)s.")
    ap.add_argument("--start-route", default="/dashboard",
                    help="path B starts here, then CLICKS the Options Flow "
                         "nav entry. It must NOT be /options-flow: clicking "
                         "the entry for the page you are on moves no URL.")
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)

    email = os.environ.get("MEMBER_SMOKE_EMAIL")
    password = os.environ.get("MEMBER_SMOKE_PASSWORD")
    if not (email and password):
        print("INCONCLUSIVE: MEMBER_SMOKE_EMAIL / MEMBER_SMOKE_PASSWORD not set.")
        print("This is NOT a pass — nothing was measured.")
        return 2

    label = ("RTH CERTIFYING RUN" if a.certifying
             else "QUIET TAPE - NOT A MEASUREMENT (parts pre-warm, version frozen)")
    print("=" * 72)
    print("Options Flow cold first paint - %s" % label)
    print("base=%s  runs=%d  account=%s" % (BASE, a.runs, email))
    print("throttling: NONE (no network or CPU throttle applied)")
    print("=" * 72)

    from playwright.sync_api import sync_playwright
    rows = []
    with sync_playwright() as pw:
        if a.path in ("a", "both"):
            print("")
            print("PATH A - DIRECT LOAD (the intro animation PLAYS and is excluded")
            print("         by the detector; ~9.3s of wall time is not the page)")
            for i in range(1, a.runs + 1):
                row = run_once(pw, email, password, i, a.certifying, a.min_pod_age)
                row["path"] = "A"
                rows.append(row)
                if row.get("error"):
                    print("run %d: ERROR %s%s" % (
                        i, row["error"],
                        "  -> INCONCLUSIVE, not a product failure: %s"
                        % row.get("swap_reason") if row.get("deploy_swapped") else ""))
                    continue
                print("run %d | first_content=%s | flow_req=%d | wire=%s | parts=%s"
                      % (i, _fmt(row["first_content_ms"], "ms"), row["flow_requests"],
                         _fmt(row["wire_bytes_flow"], "B"),
                         ",".join(row["parts_served"]) or "-"))
                print("        role=%s visible=%s part_versions=%s current_after=%s"
                      % (row["role"], row["visible_at_start"], row["part_versions"],
                         row["current_version_after"]))
                print("        observer=%s detected_via=%s"
                      % (row.get("observer_attached"), row.get("detected_via")))
                for u in (row.get("flow_urls") or []):
                    print("        flow: %s" % u)
                d = row.get("diag") or {}
                print("        DIAG path=%s bodylen=%s vis=%s wall=%.0fms"
                      % (d.get("url"), d.get("len"), d.get("vis"),
                         row.get("wall_ms") or 0))
                print("        pod age at start=%s  after=%s"
                      % (_fmt(row.get("uptime_before"), "s"),
                         _fmt(row.get("uptime_after"), "s")))
                if row.get("deploy_swapped"):
                    print("        !! INCONCLUSIVE - a deploy invalidated this run "
                          "(%s). DISCARDED from the summary." % row.get("swap_reason"))

        if a.path in ("b", "both"):
            print("")
            print("PATH B - IN-APP NAVIGATION (started on %s, CLICKED the nav entry;"
                  % a.start_route)
            print("         no intro, so this is the page's own cost)")
            for i in range(1, a.runs + 1):
                row = run_once_path_b(pw, email, password, i, a.certifying,
                                      a.start_route, a.min_pod_age)
                rows.append(row)
                if row.get("error"):
                    print("run %d: ERROR %s%s" % (
                        i, row["error"],
                        "  -> INCONCLUSIVE, not a product failure: %s"
                        % row.get("swap_reason") if row.get("deploy_swapped") else ""))
                    continue
                print("run %d | shell=%s | picks=%s | flow_req=%d | wire=%s | parts=%s"
                      % (i, _fmt(row["shell_ms"], "ms"), _fmt(row["picks_ms"], "ms"),
                         row["flow_requests"], _fmt(row["wire_bytes_flow"], "B"),
                         ",".join(row["parts_served"]) or "-"))
                print("        role=%s url_changed=%s observer=%s part_versions=%s"
                      % (row["role"], row["url_changed"],
                         row.get("observer_attached"), row["part_versions"]))
                for u in (row.get("flow_urls") or []):
                    print("        flow: %s" % u)
                d = row.get("diag") or {}
                print("        DIAG url=%s shell=%s picks=%s bodylen=%s"
                      % (d.get("url"), d.get("shell"), d.get("picks"), d.get("len")))
                # ⛔ The freeze signature, reported rather than inferred: a URL that
                # moved with nothing on screen is the 2026-09-10 defect exactly.
                if row["url_changed"] and row["shell_ms"] is None:
                    print("        !! URL MOVED, SHELL NEVER RENDERED - this is the "
                          "navigation-freeze signature, not a slow page")
                print("        pod age at start=%s  after=%s"
                      % (_fmt(row.get("uptime_before"), "s"),
                         _fmt(row.get("uptime_after"), "s")))
                if row.get("deploy_swapped"):
                    print("        !! INCONCLUSIVE - a deploy invalidated this run "
                          "(%s). DISCARDED from the summary." % row.get("swap_reason"))

    print("-" * 72)
    # ⛔ NOT `label` — that name holds the quiet-tape warning printed below, and
    # shadowing it here made the rig print "[!] PATH B picks ..." where the
    # NOT-A-MEASUREMENT banner belongs. The label is the one line that stops a
    # quiet-tape number being quoted as a member number; it must survive.
    for row_label, key in (("PATH A first content", "first_content_ms"),
                           ("PATH B shell", "shell_ms"),
                           ("PATH B picks (the TOP_PICKS product)", "picks_ms")):
        want = "A" if row_label.startswith("PATH A") else "B"
        # ⛔ A RUN THAT OVERLAPS ANY MASTER PUSH IS INCONCLUSIVE (hard rule,
        # owner 2026-09-12). Discarded, never averaged - two pods are not one
        # measurement, and the symptom looks like a product failure.
        cand = [r for r in rows if r.get("path") == want and not r.get("error")]
        discarded = [r for r in cand if r.get("deploy_swapped")]
        good = [r for r in cand if not r.get("deploy_swapped") and r.get(key)]
        if good:
            v = sorted(r[key] for r in good)
            w = sorted(r["wire_bytes_flow"] for r in good)
            print("%-38s median=%6.0fms  worst=%6.0fms  n=%d  wire median=%dB"
                  % (row_label, statistics.median(v), max(v), len(v),
                     statistics.median(w)))
        else:
            print("%-38s no usable runs - NOTHING MEASURED" % row_label)
        if discarded:
            # ⛔ NOT "a swap straddled them" — that wording was wrong the moment
            # the cold-start branch landed, and a discard message that names the
            # wrong cause sends the next operator looking for the wrong thing.
            print("%-38s %d run(s) DISCARDED as INCONCLUSIVE (deploy swap or a "
                  "cold pod):" % ("", len(discarded)))
            for r in discarded:
                print("%-38s   run %s: %s" % ("", r.get("run"), r.get("swap_reason")))

    print("[!] %s" % label)
    if not a.certifying:
        print("   Do NOT quote these as the member cold-paint number. On a quiet tape")
        print("   the parts are already warm and the version never rolls, so this is a")
        print("   best case no member hits during RTH. The rig is being proven, not the page.")

    if a.out:
        json.dump({"label": label, "rows": rows}, open(a.out, "w"), indent=1)
        print("saved: %s" % a.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
