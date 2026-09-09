"""Wave Q1 — run the browser certification probe in a disposable browser.

⛔ WHY THIS EXISTS AND WHAT IT MAY NOT DO
-----------------------------------------
§32 of the Wave Q directive makes the cross-browser matrix a HARD Q1
certification gate. The probe itself is `app/public/q1-probe.html`; this file
only *drives* it, in browsers that are not the owner's daily Chrome.

  · Every browser here is a Playwright-managed, throwaway binary with a
    throwaway profile. Nothing installs into the system, and no existing
    browser profile is read or modified.
  · The probe touches only databases named `uct_q1_browser_probe*`. It cannot
    reach `uct_notebook_<account>` — the delete helper refuses any other name.
  · ⛔ Playwright's WebKit is NOT Safari and is NOT iOS. It runs a WebKit build
    on this desktop OS, and the things most likely to break Wave Q1 on iOS
    (storage eviction under ITP, the iOS quota policy, Home-Screen-app
    behaviour) are exactly the things it does not model. It is recorded as
    supporting evidence for the engine and it does NOT close the Safari/iOS
    row. Do not let it.

USAGE
-----
    python tools/q1_browser_probe_run.py --url https://uctintelligence.com/q1-probe.html
    python tools/q1_browser_probe_run.py --url ... --browsers firefox,webkit
    python tools/q1_browser_probe_run.py --url ... --browsers chromium-fresh,chromium-incognito

Results are written to `docs/notebook/wave-q1-probe-results/<label>.json` and
summarised on stdout.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import tempfile
import time

REPO = pathlib.Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "docs" / "notebook" / "wave-q1-probe-results"

# label -> (engine, how)
TARGETS = {
    "firefox": ("firefox", "launch"),
    "webkit": ("webkit", "launch"),
    "chromium-fresh": ("chromium", "persistent"),
    "chromium-incognito": ("chromium", "incognito"),
}


def run_one(pw, label: str, url: str, timeout_s: int) -> dict:
    engine, how = TARGETS[label]
    browser_type = getattr(pw, engine)
    context = None
    browser = None
    tmpdir = None
    try:
        if how == "launch":
            browser = browser_type.launch(headless=True)
            context = browser.new_context()
        else:
            # A brand-new user-data-dir IS the fresh-profile case: first-ever
            # origin, no prior IndexedDB, no prior quota history.
            tmpdir = tempfile.mkdtemp(prefix=f"q1-{label}-")
            args = ["--incognito"] if how == "incognito" else []
            context = browser_type.launch_persistent_context(
                tmpdir, headless=True, args=args
            )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(url, wait_until="load", timeout=45_000)
        page.evaluate("window.__q1Run && window.__q1Run()")
        # The probe reloads itself once on purpose, so poll rather than wait on
        # a single navigation.
        deadline = time.time() + timeout_s
        result = None
        while time.time() < deadline:
            try:
                if page.evaluate("!!window.__q1Done"):
                    result = page.evaluate("window.__q1Result")
                    break
            except Exception:
                pass  # mid-navigation
            page.wait_for_timeout(400)
        if result is None:
            return {"label": label, "error": "probe did not finish", "url": url}
        result["_runner"] = {
            "label": label,
            "engine": engine,
            "mode": how,
            "playwrightBrowserVersion": (browser.version if browser else "persistent-context"),
            "url": url,
        }
        return result
    finally:
        try:
            if context:
                context.close()
        except Exception:
            pass
        try:
            if browser:
                browser.close()
        except Exception:
            pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="the deployed probe URL")
    ap.add_argument("--browsers", default="firefox,webkit,chromium-fresh,chromium-incognito")
    ap.add_argument("--timeout", type=int, default=90)
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright is not importable in this interpreter", file=sys.stderr)
        return 2

    labels = [b.strip() for b in args.browsers.split(",") if b.strip()]
    unknown = [b for b in labels if b not in TARGETS]
    if unknown:
        print(f"unknown target(s): {unknown}; known: {sorted(TARGETS)}", file=sys.stderr)
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rc = 0
    with sync_playwright() as pw:
        for label in labels:
            print(f"\n=== {label} ===")
            try:
                result = run_one(pw, label, args.url, args.timeout)
            except Exception as e:  # a browser that will not launch is a result too
                result = {"label": label, "error": f"{type(e).__name__}: {e}"}
            path = OUT_DIR / f"{label}.json"
            path.write_text(json.dumps(result, indent=1), encoding="utf-8")
            verdict = (result.get("verdict") or {}).get("classification") or result.get("error")
            ua = (result.get("env") or {}).get("userAgent", "")
            print(f"  ua      : {ua[:110]}")
            print(f"  verdict : {verdict}")
            wl = result.get("webLocks") or {}
            print(f"  locks   : present={wl.get('present')} exclusive={wl.get('exclusiveAcquired')} "
                  f"refusedWhileHeld={wl.get('secondContenderRefusedWhileHeld')}")
            rl = result.get("reload") or {}
            print(f"  reload  : survived={rl.get('noteSurvived')} bodyIntact={rl.get('bodyIntact')} "
                  f"outbox={rl.get('outboxSurvived')}")
            st = result.get("storage") or {}
            print(f"  storage : quotaMB={st.get('quotaMB')} persistedBefore={st.get('persistedBefore')} "
                  f"persistResult={st.get('persistResult')}")
            vc = result.get("versionchange") or {}
            print(f"  vchange : {json.dumps(vc.get('withHandler'))} / without={json.dumps(vc.get('withoutHandler'))}")
            print(f"  -> {path.relative_to(REPO)}")
            if result.get("error"):
                rc = 1
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
