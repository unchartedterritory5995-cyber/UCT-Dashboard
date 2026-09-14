"""Item 11: warm re-entry to Options Flow vs UCT20, on React commits and bytes.

The standing claim is that WARM RE-ENTRY to Options Flow beats /uct-20 on both
DOM commits and bytes. The weekend figures it was first based on are not recorded
anywhere I can find, so both sides are measured HERE, today, head to head -- which
is the comparison the claim actually makes.

METHOD, and the two traps it avoids:
  - WARM means the SAME browser context: navigate to /options-flow, away to
    /dashboard, then BACK. A fresh context is the cache clear and would measure
    cold paint again (the cold-paint rig deliberately uses one context per run).
  - CLICK the nav entry, never page.goto. A full document load rebuilds the world
    and is not the transition a member makes -- the same reason R-27 requires
    clicking.

Commits are counted with the __REACT_DEVTOOLS_GLOBAL_HOOK__ shim from
tools/postdeploy_client_smoke.py: React's own onCommitFiberRoot count, installed
before the app boots. Bytes are counted from a streaming response wrapper, not
from getEntriesByType('resource'), which caps at 250 entries and drops.

Read-only. Nothing is written to production.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="backslashreplace")
    except Exception:                                          # noqa: BLE001
        pass

BASE = os.environ.get("RIG_BASE", "https://uctintelligence.com")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
ET = datetime.timezone(datetime.timedelta(hours=-4))

INIT = """
(() => {
  window.__uctCommits = 0;
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || {
    renderers: new Map(), supportsFiber: true,
    inject() { return 1; }, onCommitFiberUnmount() {},
  };
  const prev = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function (...args) {
    window.__uctCommits = (window.__uctCommits || 0) + 1;
    if (prev) try { return prev.apply(this, args); } catch (e) {}
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

  window.__uctBytes = 0; window.__uctReqs = 0; window.__uctUrls = [];
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    return orig.apply(this, arguments).then(r => {
      try {
        const c = r.clone();
        window.__uctReqs++;
        window.__uctUrls.push(String(url).slice(0, 160));
        c.arrayBuffer().then(b => { window.__uctBytes += (b && b.byteLength) || 0; })
                       .catch(() => {});
      } catch (e) {}
      return r;
    });
  };
})();
"""

READ = ("() => ({commits: window.__uctCommits || 0, bytes: window.__uctBytes || 0,"
        " reqs: window.__uctReqs || 0, urls: (window.__uctUrls || []).slice(-40)})")


def now_et():
    return datetime.datetime.now(datetime.timezone.utc).astimezone(ET).isoformat()


def uptime():
    import urllib.request
    try:
        rq = urllib.request.Request(BASE + "/api/health", headers={"User-Agent": UA})
        with urllib.request.urlopen(rq, timeout=20) as r:
            return json.loads(r.read().decode()).get("uptime_seconds")
    except Exception:                                          # noqa: BLE001
        return None


def click_nav(page, label):
    """Click the sidebar entry. Returns True if the URL moved."""
    before = page.url
    for sel in ("a[href='/%s']" % label.strip("/"),
                "a:has-text('%s')" % label):
        try:
            el = page.locator(sel).first
            if el.count() and el.is_visible():
                el.click(timeout=8000)
                page.wait_for_timeout(150)
                return page.url != before
        except Exception:                                      # noqa: BLE001
            continue
    return False


def settle(page, ms):
    page.wait_for_timeout(ms)


def one_run(pw, email, password, idx, settle_ms):
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(user_agent=UA,
                              viewport={"width": 1440, "height": 900})
    out = {"run": idx, "at_et": now_et(), "uptime_before": uptime()}
    try:
        r = ctx.request.post(BASE + "/api/auth/login",
                             data={"email": email, "password": password})
        if r.status != 200:
            out["error"] = "login http %s" % r.status
            return out
        ctx.add_init_script(INIT)
        page = ctx.new_page()
        page.goto(BASE + "/dashboard", wait_until="domcontentloaded", timeout=60000)
        settle(page, 6000)

        # --- COLD first visit (not the measurement, but it is what makes the
        #     next visit warm). Click, never goto.
        if not click_nav(page, "/options-flow"):
            page.goto(BASE + "/options-flow", wait_until="domcontentloaded",
                      timeout=60000)
            out["cold_used_goto"] = True
        settle(page, settle_ms)
        out["after_cold"] = page.evaluate(READ)

        # --- leave
        if not click_nav(page, "/dashboard"):
            page.goto(BASE + "/dashboard", wait_until="domcontentloaded",
                      timeout=60000)
        settle(page, 2500)
        base_flow = page.evaluate(READ)

        # --- WARM re-entry: same context, same page, back to Options Flow
        t0 = time.monotonic()
        moved = click_nav(page, "/options-flow")
        settle(page, settle_ms)
        after = page.evaluate(READ)
        out["flow_warm"] = {
            "url_changed": moved,
            "commits": after["commits"] - base_flow["commits"],
            "bytes": after["bytes"] - base_flow["bytes"],
            "reqs": after["reqs"] - base_flow["reqs"],
            "elapsed_ms": round((time.monotonic() - t0) * 1000),
            "url": page.url,
            "picks_present": page.evaluate(
                "() => !!document.querySelector('.of-picks')"),
        }

        # --- leave again, then UCT20 (also a warm in-app navigation)
        if not click_nav(page, "/dashboard"):
            page.goto(BASE + "/dashboard", wait_until="domcontentloaded",
                      timeout=60000)
        settle(page, 2500)
        base_uct = page.evaluate(READ)
        t0 = time.monotonic()
        moved_u = click_nav(page, "/uct-20")
        settle(page, settle_ms)
        after_u = page.evaluate(READ)
        out["uct20"] = {
            "url_changed": moved_u,
            "commits": after_u["commits"] - base_uct["commits"],
            "bytes": after_u["bytes"] - base_uct["bytes"],
            "reqs": after_u["reqs"] - base_uct["reqs"],
            "elapsed_ms": round((time.monotonic() - t0) * 1000),
            "url": page.url,
        }
        out["uptime_after"] = uptime()
    except Exception as e:                                     # noqa: BLE001
        out["error"] = repr(e)
    finally:
        try:
            ctx.close()
            browser.close()
        except Exception:                                      # noqa: BLE001
            pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=4)
    ap.add_argument("--settle-ms", type=int, default=9000)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    email = os.environ.get("MEMBER_SMOKE_EMAIL")
    password = os.environ.get("MEMBER_SMOKE_PASSWORD")
    if not email or not password:
        print("INCONCLUSIVE: MEMBER_SMOKE_* not set")
        return 2
    from playwright.sync_api import sync_playwright
    rows = []
    with sync_playwright() as pw:
        for i in range(1, a.runs + 1):
            r = one_run(pw, email, password, i, a.settle_ms)
            rows.append(r)
            f, u = r.get("flow_warm"), r.get("uct20")
            if r.get("error"):
                print("run %d ERROR %s" % (i, r["error"]))
            else:
                print("run %d | FLOW warm commits=%-4s bytes=%-9s reqs=%-3s moved=%s picks=%s"
                      % (i, f["commits"], f["bytes"], f["reqs"], f["url_changed"],
                         f["picks_present"]))
                print("        | UCT20     commits=%-4s bytes=%-9s reqs=%-3s moved=%s"
                      % (u["commits"], u["bytes"], u["reqs"], u["url_changed"]))
            if i < a.runs:
                time.sleep(14)          # stay clear of the 5/min login limiter
    ok = [r for r in rows if not r.get("error")]
    if ok:
        def med(key, side):
            v = sorted(r[side][key] for r in ok)
            return v[len(v) // 2]
        print("-" * 68)
        print("n=%d  FLOW warm  commits p50=%s  bytes p50=%s"
              % (len(ok), med("commits", "flow_warm"), med("bytes", "flow_warm")))
        print("      UCT20      commits p50=%s  bytes p50=%s"
              % (med("commits", "uct20"), med("bytes", "uct20")))
        print("      FLOW beats UCT20 on commits: %s   on bytes: %s"
              % (med("commits", "flow_warm") < med("commits", "uct20"),
                 med("bytes", "flow_warm") < med("bytes", "uct20")))
    if a.out:
        json.dump({"label": "RTH warm re-entry vs UCT20", "rows": rows},
                  open(a.out, "w", encoding="utf-8"), indent=1, default=str)
        print("saved: %s" % a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
