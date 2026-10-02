"""Addendum to walk_rewalk2.py: the main run's forward-wrap probe (budget 60
Tabs) never returned to the first control on either door/page -- consistent
with an INSTRUMENT BUDGET limit (the chart's toolbar has a large control set:
tabs, timeframe buttons, MA/overlay toggles, period buttons, many drawing
tools), not a confirmed trap defect (escaped_forward was never True --
Tab never left the dialog in 60 presses, it just didn't finish a full lap).
This script settles it: count the TRUE number of focusable elements inside
the open dialog via JS, then re-run the forward-wrap with a budget sized to
that count + headroom, on the dashboard Enter door only (the representative
case; Open Positions showed the identical shape).

Same hard rules as the main script: no api.* import in this process (guarded
below), HTTP-only account provisioning, fresh data dir/port, integrity CLEAN
required at every checkpoint or the result does not count.
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
  return {present: true, role, name};
}
"""

COUNT_JS = r"""
() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return {found: false};
  const SEL = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
    'textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
  const nodes = [...dlg.querySelectorAll(SEL)].filter(n => {
    const cs = getComputedStyle(n);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && n.offsetParent !== null;
  });
  return {found: true, count: nodes.length,
    names: nodes.map(n => (n.getAttribute('aria-label') || (n.textContent||'').trim().slice(0,30) || n.tagName))};
}
"""


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
                            "email": "a11y2-wrapbudget@local.dev", "password": "A11yWrapBudget1!",
                            "display_name": "WrapBudget"})
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
                                                data={"email": "a11y2-wrapbudget@local.dev", "action": "grant"})
                        admin_ctx.request.post(base + "/api/auth/admin/verify-email",
                                                data={"email": "a11y2-wrapbudget@local.dev"})

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
                        fi = {}
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
                            first = page.evaluate(FOCUS_JS)
                            cnt = page.evaluate(COUNT_JS)
                            result["dialog_control_count"] = cnt
                            result["first_control"] = first
                            budget = (cnt.get("count") or 60) + 20
                            wrapped = False
                            names_seen = []
                            for i in range(budget):
                                page.keyboard.press("Tab")
                                page.wait_for_timeout(90)
                                f2 = page.evaluate(FOCUS_JS)
                                names_seen.append(f2.get("name"))
                                if f2.get("name") == first.get("name") and f2.get("role") == first.get("role"):
                                    wrapped = True
                                    result["wrapped_at_tab"] = i + 1
                                    break
                            result["budget_used"] = budget
                            result["wrapped_forward"] = wrapped
                            if not wrapped:
                                result["distinct_names_seen"] = sorted(set(n for n in names_seen if n))
                            page.keyboard.press("Escape")
                            page.wait_for_timeout(300)
                            after = page.evaluate(FOCUS_JS)
                            result["restored_after_escape"] = after
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
            shutil.copy(ipath, OUT_DIR / "integrity-rewalk2-wrapbudget.md")
        (OUT_DIR / "wrapbudget-result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
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
