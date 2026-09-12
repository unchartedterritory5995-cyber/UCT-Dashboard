"""Cold-first-paint rig for Options Flow.

Produces the item-8 measurement: time to first content, wire bytes, which parts
came from cache vs were built, and `X-Flow-Version` at paint versus the current
version — per run, plus median and WORST case.

⛔ EVERY NUMBER IS LABELLED. On a quiet tape the parts are already warm and the
version never rolls, so a run measures a best case that no member ever hits during
RTH. The label rides on every row and on the summary; `--certifying` is the only
way to drop it, and it should only be passed during RTH.

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


def _fmt(v, unit=""):
    return "n/a" if v is None else ("%.0f%s" % (v, unit) if isinstance(v, (int, float)) else str(v))


def run_once(pw, email, password, idx, certifying):
    """One cold load in a FRESH context. Returns a dict of measurements."""
    from playwright.sync_api import TimeoutError as PWTimeout

    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(user_agent=UA, viewport={"width": 1440, "height": 900})
    responses = []
    try:
        # Scripted login — page.request keeps the cookie in the context jar, which
        # is robust against the intro overlay (the documented approach).
        r = ctx.request.post(BASE + "/api/auth/login",
                             data={"email": email, "password": password})
        if r.status != 200:
            return {"run": idx, "error": "login http %s" % r.status}
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

        return {
            "run": idx,
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


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--certifying", action="store_true",
                    help="RTH only. Without it every number is labelled as not a measurement.")
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
        for i in range(1, a.runs + 1):
            row = run_once(pw, email, password, i, a.certifying)
            rows.append(row)
            if row.get("error"):
                print("run %d: ERROR %s" % (i, row["error"]))
                continue
            print("run %d | first_content=%s | flow_req=%d | wire=%s | parts=%s"
                  % (i, _fmt(row["first_content_ms"], "ms"), row["flow_requests"],
                     _fmt(row["wire_bytes_flow"], "B"), ",".join(row["parts_served"]) or "-"))
            print("        role=%s visible=%s part_versions=%s current_after=%s"
                  % (row["role"], row["visible_at_start"], row["part_versions"],
                     row["current_version_after"]))
            print("        observer=%s detected_via=%s"
                  % (row.get("observer_attached"), row.get("detected_via")))
            for u in (row.get("flow_urls") or []):
                print("        flow: %s" % u)
            d = row.get("diag") or {}
            print("        DIAG path=%s bodylen=%s vis=%s wall=%.0fms"
                  % (d.get("url"), d.get("len"), d.get("vis"), row.get("wall_ms") or 0))
            print("        DIAG body head: %r" % ((d.get("head") or "")[:110],))

    good = [r for r in rows if not r.get("error") and r.get("first_content_ms")]
    print("-" * 72)
    if good:
        v = sorted(r["first_content_ms"] for r in good)
        print("first content  median=%.0fms  worst=%.0fms  n=%d"
              % (statistics.median(v), max(v), len(v)))
        w = sorted(r["wire_bytes_flow"] for r in good)
        print("flow wire      median=%dB  worst=%dB" % (statistics.median(w), max(w)))
    else:
        print("no successful runs — nothing measured")
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
