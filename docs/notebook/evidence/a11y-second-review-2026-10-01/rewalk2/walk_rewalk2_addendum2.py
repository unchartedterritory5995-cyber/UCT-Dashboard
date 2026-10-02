"""Second addendum to walk_rewalk2.py, closing two check-design bugs found
while reviewing the main run's results (not product defects -- MY harness's
own checks fired at the wrong moment):

  A) RW2-006 ("status region exists before any capture") was probed on
     /dashboard BEFORE the TickerPopup dialog was ever opened -- of course
     absent, the span lives inside the dialog. The real question is whether
     it exists once the dialog is open but BEFORE the capture button is
     pressed. Re-measured here.
  B) The Switch-ticker hotkey regression check Tab-sought "Switch ticker"
     for up to 10 Tabs after opening the dialog -- but the wrap-budget
     addendum already showed `first_control` on open IS the Switch-ticker
     box (focus lands there immediately), so the seek loop walked PAST it
     into the dialog's other 55 controls and never found it again within
     budget. Re-measured here by reading focus_info immediately after open,
     with no Tab at all.

Same hard rules: no api.* import in this process (guarded), HTTP-only
provisioning, fresh port, integrity required at the checkpoints reached.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
OUT_DIR = Path(__file__).resolve().parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
if str(REPO / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO / "scripts"))


def log(msg):
    print(msg, flush=True)


def assert_no_api_import(where):
    offenders = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    if offenders:
        raise RuntimeError(f"HARD RULE 1 VIOLATION at {where}: {offenders}")
    log(f"  [guard] no api.* module in sys.modules ({where}) -- OK")


FOCUS_JS = r"""
() => {
  const el = document.activeElement;
  if (!el || el === document.body) return {present: false};
  const role = el.getAttribute('role') || el.tagName.toLowerCase();
  const name = (el.getAttribute('aria-label') || (el.textContent||'').trim().slice(0,60) || '');
  return {present: true, tag: el.tagName.toLowerCase(), role, name};
}
"""

STATUS_PROBE_JS = (
    "() => { const el = document.querySelector('[data-testid=\"capture-status\"]'); "
    "if (!el) return {present: false}; "
    "return {present: true, role: el.getAttribute('role'), ariaLive: el.getAttribute('aria-live'), "
    "ariaAtomic: el.getAttribute('aria-atomic'), text: (el.textContent||'').trim()}; }"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--artifacts", required=True)
    args = ap.parse_args()

    assert_no_api_import("startup")

    from tools import notebook_perf_harness as H
    import sandbox_identity
    assert_no_api_import("after test-infra imports")

    base = f"http://127.0.0.1:{args.port}"
    refused = H.refuse_shared_root(args.data_dir)
    if not refused and H.port_busy(args.port):
        refused = f"port {args.port} already has a listener"
    if refused:
        log(f"REFUSED: {refused}")
        return 3

    art = Path(args.artifacts)
    art.mkdir(parents=True, exist_ok=True)
    sb = H.Sandbox(args.data_dir, args.port, art / "launcher.log")
    not_run = None
    result = {}
    try:
        sb.start()
        if not sb.wait_healthy(base, 300):
            not_run = "sandbox never answered /api/health"
        else:
            sb.wait_checkpoint(H.POST_BOOT, H.POST_BOOT_WAIT_S)
            ipath = sb.integrity_path()
            v = sandbox_identity.verify(base, ipath)
            if not v.ok:
                not_run = "identity check failed: " + v.sentence
            else:
                log("SANDBOX IDENTITY: " + v.sentence)
                from playwright.sync_api import sync_playwright
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True)
                    try:
                        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
                        r = ctx.request.post(base + "/api/auth/signup", data={
                            "email": "a11y2-addendum2@local.dev", "password": "A11yAddendum2x1!",
                            "display_name": "Addendum2"})
                        if r.status not in (200, 201):
                            raise RuntimeError(f"signup failed {r.status} {r.text()[:200]}")
                        admin_r = ctx.request.post(base + "/api/auth/login", data={
                            "email": H.ADMIN_EMAIL, "password": H.ADMIN_PW})
                        if admin_r.status not in (200, 201):
                            ctx2 = browser.new_context()
                            ctx2.request.post(base + "/api/auth/signup", data={
                                "email": H.ADMIN_EMAIL, "password": H.ADMIN_PW, "display_name": "hubtest"})
                            admin_ctx = ctx2
                        else:
                            admin_ctx = ctx
                        admin_ctx.request.post(base + "/api/auth/admin/comp-access",
                                                data={"email": "a11y2-addendum2@local.dev", "action": "grant"})
                        admin_ctx.request.post(base + "/api/auth/admin/verify-email",
                                                data={"email": "a11y2-addendum2@local.dev"})

                        page = ctx.new_page()
                        page.goto(base + "/dashboard", wait_until="domcontentloaded", timeout=30000)
                        page.wait_for_timeout(300)
                        for _ in range(30):
                            ov = page.evaluate(
                                "() => { const els=[...document.querySelectorAll('*')]; "
                                "return !!els.find(e => { const cs=getComputedStyle(e); "
                                "return cs.position==='fixed' && parseInt(cs.zIndex||'0')>=99999; }); }")
                            if not ov:
                                break
                            page.keyboard.press("Escape")
                            page.wait_for_timeout(250)
                        page.wait_for_timeout(300)

                        reached = False
                        for i in range(160):
                            page.keyboard.press("Tab")
                            page.wait_for_timeout(120)
                            fi = page.evaluate(FOCUS_JS)
                            if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
                                reached = True
                                break
                        if not reached:
                            result["error"] = "trigger not reached within 160 Tabs"
                        else:
                            page.keyboard.press("Enter")
                            page.wait_for_timeout(500)

                            # (A) status region right after open, BEFORE any capture press
                            result["status_region_after_open_before_capture"] = page.evaluate(STATUS_PROBE_JS)

                            # (B) focus right after open -- should already be the Switch-ticker box
                            on_open = page.evaluate(FOCUS_JS)
                            result["focus_right_after_open"] = on_open
                            is_switch_ticker = "switch ticker" in (on_open.get("name") or "").lower()
                            result["focus_is_switch_ticker_box"] = is_switch_ticker
                            if is_switch_ticker:
                                url_before = page.url
                                page.keyboard.type("j", delay=50)
                                page.wait_for_timeout(250)
                                typed = page.evaluate(
                                    "() => { const el = document.activeElement; "
                                    "return el && 'value' in el ? el.value : null; }")
                                url_after = page.url
                                result["hotkey_check"] = {
                                    "typed_value": typed, "url_before": url_before, "url_after": url_after,
                                    "no_navigation": url_before == url_after, "text_inserted": typed == "j"}
                            else:
                                result["hotkey_check"] = {"skipped": "focus was not on the Switch-ticker box on open"}
                            page.keyboard.press("Escape")
                    finally:
                        browser.close()
    except Exception as e:  # noqa: BLE001
        import traceback
        not_run = f"{type(e).__name__}: {e}"
        log(traceback.format_exc())
    finally:
        stop_how = sb.stop()
        ipath = sb.integrity_path()
        required = [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN]
        integ = H.read_integrity(ipath, required)
        if ipath and Path(ipath).is_file():
            import shutil
            shutil.copy(ipath, OUT_DIR / "integrity-rewalk2-addendum2.md")
        (OUT_DIR / "addendum2-result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        log(f"RESULT: {json.dumps(result)}")
        log(f"STOP: {stop_how}")
        log("INTEGRITY: " + H.integrity_line(integ, not_run=not_run))
        try:
            assert_no_api_import("end of run")
        except RuntimeError as e:
            log(f"HARD RULE 1 VIOLATION AT SHUTDOWN: {e}")
            if not not_run:
                not_run = str(e)
    if not_run:
        log(f"NOT RUN: {not_run}")
        return 2
    return 0


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())
