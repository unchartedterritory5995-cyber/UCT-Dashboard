"""Stage, validate and tear down the AUTHENTICATED auto-driving device harness.

⛔ WHY A LAUNCHER AND NOT JUST A FILE. Three constraints have to hold at once:
  1. the page must be SAME-ORIGIN with the API, or the session cookie the app
     needs is not the one the harness established — so it is served by the
     sandbox backend out of `app/dist/assets/` (the only statically-mounted
     directory besides /fonts; everything else hits the SPA catch-all and
     silently returns index.html, which is how the first attempt "200"ed while
     serving the wrong document);
  2. the harness SOURCE must be committed and reusable — it lives in
     `app/src/testing/device/`, and this script only copies it;
  3. the CREDENTIAL must never enter git, a screenshot, or a result payload —
     so it is written to a separate generated module that `--clean` deletes.

⛔ AND IT VALIDATES LOCALLY BEFORE ANY DEVICE MINUTE IS SPENT. A device session
is 60 seconds and unrepeatable; a harness defect discovered there costs a device
AND gets mistaken for a product defect. `--validate` drives the whole thing under
Playwright with an emulated coarse pointer — the one local instrument that can
evaluate `(pointer: coarse)` rules honestly — and refuses to conclude anything
if the pointer did not actually resolve coarse.

⛔ AND IT CAN BE SHOWN TO FAIL. `--break-auth` stages a deliberately wrong
credential; every downstream flow must then report BLOCKED. A harness nobody has
watched fail is not evidence.

Usage:
    python tools/device_auth_harness.py --stage
    python tools/device_auth_harness.py --validate
    python tools/device_auth_harness.py --validate --break-auth
    python tools/device_auth_harness.py --clean
"""
from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from sandbox_account import SANDBOX_EMAIL, new_password, ensure_account  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parent.parent
SRC = REPO / "app" / "src" / "testing" / "device"
OUT = REPO / "app" / "dist" / "assets"

PAGE = OUT / "uct-r1.html"
MODULE = OUT / "uct-r1.js"
CRED = OUT / "uct-r1.cred.js"           # generated - secret - always deleted
GENERATED = (PAGE, MODULE, CRED)

# The credential is GENERATED per run by `sandbox_account` and never written
# in source. See that module for why.
SANDBOX_PASSWORD = new_password()

# The negative control's credential.
BREAK_PASSWORD = "!!wrong-on-purpose!!"

_HEADER = "// GENERATED - deleted by `device_auth_harness.py --clean`. Never commit.\n"


def stage(break_auth: bool = False, base: str | None = None) -> None:
    # ⛔ The negative control deliberately wants the login to FAIL, so it must not
    # provision an account first — and it must not re-provision one either, since
    # a second run generates a different password and would fail for the WRONG
    # reason. A control that fails for an unintended reason proves nothing.
    if base and not break_auth:
        ensure_account(base, SANDBOX_PASSWORD)
    if not OUT.is_dir():
        raise SystemExit("no built dist at " + str(OUT) + " - run `npm run build` in app/ first")
    shutil.copyfile(SRC / "authHarness.js", MODULE)
    shutil.copyfile(SRC / "authHarness.page.html", PAGE)
    pw = BREAK_PASSWORD if break_auth else SANDBOX_PASSWORD
    body = "export const CRED = " + json.dumps({"email": SANDBOX_EMAIL, "password": pw})
    CRED.write_text(_HEADER + body + "\n", encoding="utf-8")
    note = "   [NEGATIVE CONTROL: credential deliberately wrong]" if break_auth else ""
    print("staged: " + str(PAGE.relative_to(REPO)) + "  (serve at /assets/uct-r1.html)" + note)


def clean() -> None:
    for p in GENERATED:
        if p.exists():
            p.unlink()
            print("removed " + str(p.relative_to(REPO)))
    print("no credential-bearing artifact remains")


def validate(base: str, landscape: bool, break_auth: bool) -> int:
    from playwright.sync_api import sync_playwright

    vp = {"width": 926, "height": 428} if landscape else {"width": 428, "height": 926}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport=vp, is_mobile=True, has_touch=True,
                                  device_scale_factor=3)
        page = ctx.new_page()
        # The sandbox is a full backend with schedulers; a cold or busy moment can
        # outlast the 30s default. Patience here is not a fixed sleep - the
        # navigation still completes on its own event.
        page.set_default_navigation_timeout(90000)
        page.set_default_timeout(90000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base + "/assets/uct-r1.html", wait_until="domcontentloaded")

        coarse = page.evaluate("() => matchMedia('(pointer: coarse)').matches")
        if not coarse:
            print("pointer did NOT resolve coarse - this instrument cannot evaluate "
                  "the coarse-gated rules, and no conclusion may be drawn.")
            browser.close()
            return 2

        try:
            page.wait_for_function("() => window.__r1 && window.__r1.summary", timeout=120000)
        except Exception:
            print("the harness never finished. Page errors:", errors or "(none)")
            print("panel:", page.inner_text("#panel")[:2000])
            browser.close()
            return 1

        out = page.evaluate("() => window.__r1")
        browser.close()

    s = out["summary"]
    print("")
    print("step                   tier  state    observed / note")
    for r in out["results"]:
        detail = r.get("observed") or ""
        if r.get("note"):
            detail = (str(detail) + " (" + r["note"] + ")") if detail else ("(" + r["note"] + ")")
        print("{:22} T{:<4} {:8} {}".format(r["id"], r["tier"], r["state"], str(detail)[:96]))
    print("")
    print("PASS {} - FAIL {} - BLOCKED {} / {}   elapsed {:.1f}s".format(
        s["pass"], s["fail"], s["blocked"], s["total"], out["elapsedMs"] / 1000))
    print("DEVICE_WORKSPACE_ROUNDTRIP = " + s["deviceWorkspaceRoundTrip"] + "  (host-side dry run)")
    print("cleanup: " + (" / ".join(out.get("cleaned") or []) or "nothing to clean"))

    # The credential must not have leaked into the machine-readable artifact.
    blob = json.dumps(out)
    if SANDBOX_PASSWORD in blob:
        print("FAIL - the credential appears in the result payload")
        return 3
    print("credential not present in the result payload: OK")

    if break_auth:
        # The control's whole point: nothing downstream may claim PASS.
        downstream = [r for r in out["results"] if r["id"] != "transport"]
        leaked = [r["id"] for r in downstream if r["state"] == "PASS"]
        auth = None
        for r in out["results"]:
            if r["id"] == "auth":
                auth = r
        print("")
        print("NEGATIVE CONTROL")
        print("  auth state        : " + (auth["state"] if auth else "(missing)"))
        print("  downstream PASSes : " + (", ".join(leaked) if leaked else "none"))
        if auth is None or auth["state"] != "FAIL" or leaked:
            print("  VERDICT: BROKEN - the gating is decorative, a false PASS is possible")
            return 4
        print("  VERDICT: SOUND - a broken login blocks every downstream flow")
        return 0

    return 0 if s["fail"] == 0 else 1


def main() -> int:
    # Windows consoles default to cp1252 and this report legitimately carries
    # non-ASCII. A printer that raises mid-report destroys the evidence it was
    # called to preserve - and only ever on the runs worth reading.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8091")
    ap.add_argument("--stage", action="store_true")
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--landscape", action="store_true")
    ap.add_argument("--clean", action="store_true")
    ap.add_argument("--break-auth", action="store_true",
                    help="negative control: stage a deliberately wrong credential")
    a = ap.parse_args()
    if a.clean:
        clean()
        return 0
    if a.stage or a.validate:
        stage(a.break_auth, a.base)
    if a.validate:
        return validate(a.base, a.landscape, a.break_auth)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
