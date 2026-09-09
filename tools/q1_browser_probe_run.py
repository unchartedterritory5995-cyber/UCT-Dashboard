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

# ⛔⛔ SEVEN OUTCOMES, AND INFRASTRUCTURE NEVER COLLAPSES INTO "THE BROWSER
# CANNOT DO IT". A syntax error in our own page once produced "probe did not
# finish" on Firefox and WebKit, which reads exactly like a browser limitation
# and was a typo; a stranger on a shared port produced empty fetches that read
# the same way. Each of these is a different thing to go and fix.
HARNESS_ARTIFACT_INVALID = "HARNESS_ARTIFACT_INVALID"      # our page did not compile
SERVER_IDENTITY_MISMATCH = "SERVER_IDENTITY_MISMATCH"      # somebody else answered
SERVER_UNREACHABLE = "SERVER_UNREACHABLE"                  # nothing answered
TRANSPORT_TIMEOUT = "TRANSPORT_TIMEOUT"                    # slow, not wrong
BROWSER_API_UNSUPPORTED = "BROWSER_API_UNSUPPORTED"        # a real browser limit
BROWSER_TEST_FAILED = "BROWSER_TEST_FAILED"                # ran, and failed
PASS = "PASS"

# label -> (engine, how)
TARGETS = {
    "firefox": ("firefox", "launch"),
    "webkit": ("webkit", "launch"),
    "chromium-fresh": ("chromium", "persistent"),
    "chromium-incognito": ("chromium", "incognito"),
    "firefox-private": ("firefox", "private"),
}


def outcome_for(result: dict) -> str:
    """Map a finished probe result onto the classification. ⛔ Only a result
    that actually RAN may be described in browser terms."""
    if result.get("outcome") == SERVER_IDENTITY_MISMATCH:
        return SERVER_IDENTITY_MISMATCH
    verdict = (result.get("verdict") or {}).get("classification") or ""
    if verdict.startswith("DURABLE_OFFLINE_SUPPORTED"):
        return PASS
    if verdict.startswith("NO_DURABLE_OFFLINE") or verdict.startswith("EPHEMERAL_ONLY"):
        return BROWSER_API_UNSUPPORTED
    if verdict.startswith("INCOMPLETE"):
        return TRANSPORT_TIMEOUT
    return BROWSER_TEST_FAILED


def run_one(pw, label: str, url: str, timeout_s: int, user_data_dir: str | None = None) -> dict:
    engine, how = TARGETS[label]
    browser_type = getattr(pw, engine)
    context = None
    browser = None
    tmpdir = user_data_dir
    try:
        if how == "launch":
            browser = browser_type.launch(headless=True)
            context = browser.new_context()
        elif how == "private":
            # Firefox's own private-browsing mode, not a fresh profile: the
            # distinction matters because §28 asks what the browser TELLS us
            # about durability, and a clean profile is durable while a private
            # window is not.
            browser = browser_type.launch(
                headless=True,
                firefox_user_prefs={"browser.privatebrowsing.autostart": True},
            )
            context = browser.new_context()
        else:
            # A brand-new user-data-dir IS the fresh-profile case: first-ever
            # origin, no prior IndexedDB, no prior quota history.
            if tmpdir is None:
                tmpdir = tempfile.mkdtemp(prefix=f"q1-{label}-")
            args = ["--incognito"] if how == "incognito" else []
            context = browser_type.launch_persistent_context(
                tmpdir, headless=True, args=args
            )
        page = context.pages[0] if context.pages else context.new_page()
        try:
            page.goto(url, wait_until="load", timeout=45_000)
        except Exception as e:
            msg = str(e)
            unreachable = "ERR_CONNECTION" in msg or "NS_ERROR_CONNECTION" in msg or "Could not connect" in msg
            return {"label": label, "url": url,
                    "outcome": SERVER_UNREACHABLE if unreachable else TRANSPORT_TIMEOUT,
                    "error": msg[:300]}

        # 1 · IS OUR OWN ARTIFACT EXECUTABLE? A page that renders perfectly can
        # still have failed to compile — that is not a browser finding.
        if not page.evaluate("typeof window.__q1Run === 'function'"):
            return {"label": label, "url": url, "outcome": HARNESS_ARTIFACT_INVALID,
                    "error": "the probe page rendered but its script did not compile"}

        # 2 · IS THE RIGHT SERVER ANSWERING? Only meaningful when the harness
        # asserted an identity by passing `?expect=`.
        if "expect=" in url:
            page.wait_for_timeout(600)
            if page.evaluate("window.__q1IdentityOk") is not True:
                return {"label": label, "url": url, "outcome": SERVER_IDENTITY_MISMATCH,
                        "received": page.evaluate("window.__q1Identity || null")}
        # ⛔ Do NOT await it. `__q1Run` is async and its first act is to reload
        # the page, so a plain `evaluate` waits on a promise that can never
        # resolve -- Chromium throws when the context dies, Firefox and WebKit
        # simply hang, which is how this runner sat silent for twelve minutes.
        page.evaluate("setTimeout(function () { window.__q1Run && window.__q1Run() }, 0)")
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
            # ⛔ NOT "the browser could not do it". We do not know that.
            return {"label": label, "url": url, "outcome": TRANSPORT_TIMEOUT,
                    "error": f"the probe did not finish within {timeout_s}s"}
        result["outcome"] = outcome_for(result)
        result["_runner"] = {
            "label": label,
            "engine": engine,
            "mode": how,
            "playwrightBrowserVersion": (browser.version if browser else "persistent-context"),
            "url": url,
            "userDataDir": tmpdir,
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


def self_check(pw) -> int:
    """⛔ THE HARNESS-INTEGRITY CONTROLS. Run these before believing any browser.

    Three questions, and they must have three different answers:
      A  the right server  → the page verifies and runs
      B  the WRONG server  → the page REFUSES and emits no metrics
      C  a SLOW server     → still verified; slow is not wrong
    """
    sys.path.insert(0, str(REPO))
    from tools.q1_probe_server import PortAlreadyOwned, ProbeServer, verify_identity

    failures = []
    server = ProbeServer()
    try:
        base = server.start()
    except PortAlreadyOwned as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2

    browser = pw.chromium.launch(headless=True)
    try:
        # ── A · the control ────────────────────────────────────────────────
        page = browser.new_context().new_page()
        page.goto(f"{base}/q1-probe.html?expect={server.nonce}", wait_until="load", timeout=30_000)
        page.wait_for_timeout(900)
        a_ok = page.evaluate("window.__q1IdentityOk") is True
        a_runnable = page.evaluate("typeof window.__q1Run === 'function'")
        print(f"  A right server   : identityOk={a_ok} runnable={a_runnable}")
        if not (a_ok and a_runnable):
            failures.append("A: the right server was not accepted")

        # ── B · ⛔ THE WRONG SERVER ────────────────────────────────────────
        page_b = browser.new_context().new_page()
        page_b.goto(f"{base}/q1-probe.html?expect=a-nonce-this-server-never-minted",
                    wait_until="load", timeout=30_000)
        page_b.wait_for_timeout(900)
        b_identity = page_b.evaluate("window.__q1IdentityOk")
        b_disabled = page_b.evaluate("document.getElementById('run').disabled")
        page_b.evaluate("setTimeout(function(){ window.__q1Run && window.__q1Run() }, 0)")
        page_b.wait_for_timeout(2500)
        b_result = page_b.evaluate("window.__q1Result || null") or {}
        b_no_metrics = "verdict" not in b_result and "idb" not in b_result
        b_says_so = b_result.get("outcome") == SERVER_IDENTITY_MISMATCH
        print(f"  B wrong server   : identityOk={b_identity} runDisabled={b_disabled} "
              f"outcome={b_result.get('outcome')} emittedNoMetrics={b_no_metrics}")
        if b_identity is not False or not b_disabled or not b_no_metrics or not b_says_so:
            failures.append("B: a wrong-nonce server was not refused, or metrics leaked out of it")

        # ── C · slow is not wrong ──────────────────────────────────────────
        ok, reason, payload = verify_identity(base, server.nonce, timeout=10.0,
                                              path="/__uct_probe_slow_identity?ms=1200")
        print(f"  C slow server    : ok={ok} reason={reason} delayedMs={(payload or {}).get('delayedMs')}")
        if not ok or reason != "OK":
            failures.append("C: a slow but correct server was not accepted")
        ok2, reason2, _ = verify_identity(base, server.nonce, timeout=0.4,
                                          path="/__uct_probe_slow_identity?ms=2500")
        print(f"  C impatient      : ok={ok2} reason={reason2}")
        if ok2 or reason2 != TRANSPORT_TIMEOUT:
            failures.append("C: running out of patience was not classified as a timeout")
    finally:
        browser.close()
        server.stop()

    if failures:
        print()
        print("HARNESS SELF-CHECK FAILED:")
        for f in failures:
            print(f"  ✗ {f}")
        return 1
    print()
    print("HARNESS SELF-CHECK PASSED — identity proven, wrong server refused, slow != wrong.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="an already-served probe URL (e.g. production)")
    ap.add_argument("--serve", action="store_true",
                    help="start a local probe server on an OS-assigned port, prove its "
                         "identity, and run against it")
    ap.add_argument("--browsers", default="firefox,webkit,chromium-fresh,chromium-incognito")
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--self-check", action="store_true",
                    help="run the harness-integrity controls and exit")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright is not importable in this interpreter", file=sys.stderr)
        return 2

    if args.self_check:
        with sync_playwright() as pw:
            return self_check(pw)

    if not args.url and not args.serve:
        print("give --url, --serve or --self-check", file=sys.stderr)
        return 2

    labels = [b.strip() for b in args.browsers.split(",") if b.strip()]
    unknown = [b for b in labels if b not in TARGETS]
    if unknown:
        print(f"unknown target(s): {unknown}; known: {sorted(TARGETS)}", file=sys.stderr)
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    server = None
    url = args.url
    if args.serve:
        sys.path.insert(0, str(REPO))
        from tools.q1_probe_server import PortAlreadyOwned, ProbeServer, verify_identity

        server = ProbeServer()
        try:
            base = server.start()
        except PortAlreadyOwned as e:
            print(f"REFUSED: {e}", file=sys.stderr)
            return 2
        # ⛔ Prove it BEFORE a browser is launched, and prove it again on the
        # exact URL the browser will be handed — verifying one URL and driving
        # another is the same defect wearing a different hat.
        ok, reason, ident = verify_identity(base, server.nonce)
        if not ok:
            server.stop()
            print(f"{reason}: the local probe server could not prove it was ours", file=sys.stderr)
            return 2
        url = f"{base}/q1-probe.html?expect={server.nonce}"
        print(f"[harness] serving {url}")
        print(f"[harness] identity verified: run_id={ident['run_id']} pid={ident['pid']}")

    rc = 0
    with sync_playwright() as pw:
        for label in labels:
            print(f"\n=== {label} ===")
            try:
                if args.serve and label == "chromium-incognito":
                    # the private-mode control needs two launches against one
                    # profile; keep it for production runs where that is cheap
                    result = run_one(pw, label, url, args.timeout)
                elif label == "chromium-incognito":
                    # ⛔ THE CONTROL. `--incognito` on a persistent context can
                    # silently hand back an ORDINARY page, and a private-mode
                    # result taken in a normal profile is worse than none. So run
                    # it TWICE against the SAME user-data-dir: a genuine private
                    # session cannot find its own carryover record on the second
                    # launch, and an ordinary profile always will.
                    shared = tempfile.mkdtemp(prefix="q1-incognito-")
                    result = run_one(pw, label, url, args.timeout, user_data_dir=shared)
                    second = run_one(pw, label, url, args.timeout, user_data_dir=shared)
                    carried = bool((second.get("carryover") or {}).get("found"))
                    result["privateContext"] = {
                        "secondLaunchFoundCarryover": carried,
                        "confirmedPrivate": not carried,
                        "note": ("an ordinary profile keeps its carryover across launches; a private "
                                 "session cannot. confirmedPrivate=false means this run measured an "
                                 "ORDINARY profile and must NOT be read as private-mode evidence."),
                    }
                else:
                    result = run_one(pw, label, url, args.timeout)
            except Exception as e:  # a browser that will not launch is a result too
                result = {"label": label, "error": f"{type(e).__name__}: {e}"}
            # ⛔⛔ A LOCAL SHAKE-OUT IS NOT CERTIFICATION EVIDENCE, and it must
            # not be able to overwrite any. The §32 matrix was measured against
            # production; a run against a localhost server answers a different
            # question (is the harness sound?) and gets a different filename.
            result["certifying"] = not args.serve
            prefix = "local-" if args.serve else ""
            path = OUT_DIR / f"{prefix}{label}.json"
            path.write_text(json.dumps(result, indent=1), encoding="utf-8")
            outcome = result.get("outcome", "?")
            verdict = (result.get("verdict") or {}).get("classification") or result.get("error")
            ua = (result.get("env") or {}).get("userAgent", "")
            print(f"  outcome : {outcome}")
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
            if result.get("outcome") != PASS:
                rc = 1
    if server is not None:
        server.stop()
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
