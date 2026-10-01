"""Second-reviewer RE-WALK supplement -- A2R-05's "at least two other pages"
requirement. The combined walk (walk_rewalk.py) confirmed the full Tab ->
Enter/Space -> Tab-through -> Escape -> restore sequence on /dashboard, then
could only reach ONE other surface live (the DOM census on /uct-20, which
exists to confirm the STILL-OPEN exception, not a working path) before its
160-Tab budget was spent trying to reach Open Positions from /journal's own
nav (same pre-existing limitation as the original review). /breadth rendered
zero TickerPopup triggers on this sandbox (no data to drive one). This script
is a second, independent full interactive pass on a page the earlier budget
never reached: Open Positions (`/journal/trades?seg=open`, the real route --
`app/src/pages/journal-2-0/j2tabRedirect.js`'s own map for `j2tab=positions`),
reached DIRECTLY by URL rather than by Tab-seeking the outer Journal shell,
with one open position seeded via the product's own `POST /api/j2/positions`
so a chip actually renders. `PositionsTable.jsx:236-241`'s chart-icon trigger
is an ordinary default-focusable `<TickerPopup as="button">` -- no
`focusable={false}` override, so this is a genuine "other page", not a
repeat of the UCT20/NewsFeed exceptions.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
OUT_DIR = Path(__file__).resolve().parent
SHOTS_DIR = OUT_DIR / "screenshots"
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
if str(REPO / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO / "scripts"))

GATES = {
    "J2_SHARE_LINKS_ENABLED": "1", "NOTEBOOK_PUBLISH_ENABLED": "1", "NOTEBOOK_ONBOARDING_ENABLED": "1",
    "NOTEBOOK_ASK_INSERT_ON": "1", "NOTEBOOK_WRITING_HELP_ENABLED": "1", "COMPASS_NOTES_TOOL_ENABLED": "1",
    "NOTEBOOK_PERSONAL_API_ENABLED": "1", "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "1",
    "NOTEBOOK_TASK_REMINDERS_ENABLED": "1", "NOTEBOOK_INBOUND_EMAIL_ENABLED": "1", "J2_OCR_ENABLED": "1",
}

STEPS: list[dict] = []
FINDINGS: list[dict] = []


def log(msg):
    print(msg, flush=True)


def dump():
    (OUT_DIR / "focus-log-rewalk-a2r05-page2.json").write_text(
        json.dumps({"steps": STEPS, "findings": FINDINGS}, indent=2), encoding="utf-8")


FOCUS_JS = r"""
() => {
  const el = document.activeElement;
  if (!el || el === document.body) return {present: false};
  let implicitRole = {A:'link',BUTTON:'button',TEXTAREA:'textbox',SELECT:'combobox',SUMMARY:'button',OPTION:'option'}[el.tagName];
  if (el.tagName === 'INPUT') {
    const t = (el.getAttribute('type')||'text').toLowerCase();
    implicitRole = ({checkbox:'checkbox',radio:'radio',button:'button',submit:'button'})[t] || 'textbox';
  }
  const role = el.getAttribute('role') || implicitRole || el.tagName.toLowerCase();
  const name = (el.getAttribute('aria-label') || (el.textContent||'').trim().slice(0,80) || el.getAttribute('title') || '');
  return {present:true, tag: el.tagName.toLowerCase(), role, name};
}
"""


def focus_info(page):
    try:
        return page.evaluate(FOCUS_JS)
    except Exception as e:  # noqa: BLE001
        return {"present": False, "error": str(e)}


def shot(page, name):
    path = SHOTS_DIR / f"{name}.png"
    try:
        page.screenshot(path=str(path), full_page=False, timeout=8000)
    except Exception:  # noqa: BLE001
        return ""
    return f"screenshots/{path.name}"


_OVERLAY_JS = (
    "() => { const els=[...document.querySelectorAll('*')]; "
    "const ov = els.find(e => { const cs=getComputedStyle(e); return cs.position==='fixed' && "
    "parseInt(cs.zIndex||'0')>=99999; }); return !!ov; }"
)


def dismiss_overlay(page, budget_s=12):
    """Same defence as walk_rewalk_lock.py's -- see that file's comment for
    the measured failure mode (the intro mounting LATE, after a goto()-time
    check already judged it absent)."""
    deadline = time.monotonic() + budget_s
    dismissed_any = False
    while time.monotonic() < deadline:
        try:
            present = page.evaluate(_OVERLAY_JS)
        except Exception:  # noqa: BLE001
            present = False
        if not present:
            return dismissed_any
        dismissed_any = True
        try:
            page.keyboard.press("Escape")
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(250)
    return dismissed_any


def press(page, keys, *, surface, note="", wait_ms=160):
    page.keyboard.press(keys)
    page.wait_for_timeout(wait_ms)
    fi = focus_info(page)
    rec = {"n": len(STEPS) + 1, "surface": surface, "keys": keys, "note": note, "focus": fi}
    if note.startswith("*"):
        rec["screenshot"] = shot(page, f"p2-{len(STEPS)+1:04d}-{surface}".replace(" ", "_"))
    STEPS.append(rec)
    log(f"  [{rec['n']:04d}] {surface} <{keys}> -> {fi.get('role')} \"{(fi.get('name') or '')[:50]}\" {note}")
    dump()
    return fi


def goto(page, base, path, surface, note="*nav", dismiss_intro=True):
    page.goto(base + path, wait_until="domcontentloaded", timeout=30000)
    if dismiss_intro:
        page.wait_for_timeout(300)
        for _ in range(40):
            try:
                present = page.evaluate(_OVERLAY_JS)
            except Exception:  # noqa: BLE001
                present = False
            if not present:
                break
            try:
                page.keyboard.press("Escape")
            except Exception:  # noqa: BLE001
                pass
            page.wait_for_timeout(250)
    page.wait_for_timeout(200)
    p = shot(page, f"p2-{len(STEPS)+1:04d}-{surface}-nav".replace(" ", "_"))
    STEPS.append({"n": len(STEPS) + 1, "surface": surface, "keys": "(navigate)", "note": note,
                  "focus": focus_info(page), "screenshot": p})
    log(f"  [{len(STEPS):04d}] {surface} (navigate) {note}")
    dump()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--artifacts", required=True)
    args = ap.parse_args()

    SHOTS_DIR.mkdir(parents=True, exist_ok=True)
    art = Path(args.artifacts)
    art.mkdir(parents=True, exist_ok=True)

    from tools import notebook_perf_harness as H
    import sandbox_identity

    base = f"http://127.0.0.1:{args.port}"
    refused = H.refuse_shared_root(args.data_dir)
    if not refused and H.port_busy(args.port):
        refused = f"port {args.port} already has a listener (never killed)"
    if refused:
        log(f"REFUSED: {refused}")
        return 3

    os.environ.update(GATES)
    sb = H.Sandbox(args.data_dir, args.port, art / "launcher.log")
    not_run = None
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
                        admin_ctx = browser.new_context(viewport={"width": 1280, "height": 900})
                        r = admin_ctx.request.post(base + "/api/auth/login",
                                                    data={"email": H.ADMIN_EMAIL, "password": H.ADMIN_PW})
                        if r.status not in (200, 201):
                            admin_ctx.request.post(base + "/api/auth/signup",
                                                    data={"email": H.ADMIN_EMAIL, "password": H.ADMIN_PW,
                                                          "display_name": "hubtest"})
                        email, pw = "a11y2-rwpage2@local.dev", "A11yRwPage2x2026!"
                        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
                        r = ctx.request.post(base + "/api/auth/signup",
                                              data={"email": email, "password": pw, "display_name": "RW Page2"})
                        if r.status not in (200, 201):
                            raise RuntimeError(f"signup failed {r.status} {r.text()[:200]}")
                        admin_ctx.request.post(base + "/api/auth/admin/comp-access",
                                                data={"email": email, "action": "grant"})
                        admin_ctx.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
                        me = ctx.request.get(base + "/api/auth/me").json()
                        if not me.get("paid_equiv"):
                            raise RuntimeError(f"not paid: {me}")
                        log(f"provisioned {email}: paid_equiv={me.get('paid_equiv')}")

                        rp = ctx.request.post(base + "/api/j2/positions", data=json.dumps({
                            "symbol": "QQQ", "side": "Long", "shares": 10, "entryPrice": 450.0,
                            "entryDate": "2026-09-15", "stopPrice": 440.0,
                        }), headers={"Content-Type": "application/json"})
                        if rp.status not in (200, 201):
                            raise RuntimeError(f"seed position failed {rp.status} {rp.text()[:300]}")
                        log(f"  [seed] open position: {rp.status}")

                        page = ctx.new_page()

                        def one_pass(trigger_key, wait_after_open):
                            goto(page, base, "/journal/trades?seg=open", "P2-OpenPositions",
                                 f"*Open Positions, direct URL (j2tabRedirect.js's own map for j2tab=positions), "
                                 f"{trigger_key}-door pass")
                            page.wait_for_timeout(500)
                            reached = False
                            table_activated = False
                            fi = {}
                            for i in range(90):
                                dismiss_overlay(page)
                                fi = press(page, "Tab", surface="P2-reach", note=f"seek a ticker chip {i+1}")
                                if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
                                    reached = True
                                    break
                                # Run 1 (60-Tab budget) wrapped the WHOLE page before ever
                                # finding the trigger -- the default view here is card/list
                                # mode (PositionsTable.jsx:388's TickerPopup), and the Tab
                                # order landed on the row's OWN link ("QQQ position detail")
                                # then jumped straight past the card's chart button to the
                                # Compass orb. Rather than guess why, switch to the explicit
                                # "Table" layout (PositionsTable.jsx:236's TickerPopup, the
                                # one already confirmed `as="button"` with no override) the
                                # FIRST time it is reached, and keep seeking from there.
                                if (not table_activated and fi.get("role") == "button"
                                        and (fi.get("name") or "").strip().lower() == "table"):
                                    press(page, "Enter", surface="P2-reach", note="*switch to Table view",
                                          wait_ms=400)
                                    table_activated = True
                            if not reached:
                                STEPS.append({"n": len(STEPS)+1, "surface": "P2-reach", "keys": "(not reached)",
                                              "note": f"no ticker chip reached within 90 Tabs "
                                                      f"(table_activated={table_activated}, {trigger_key})",
                                              "focus": {}})
                                dump()
                                return
                            trigger = fi
                            press(page, trigger_key, surface="P2-open",
                                  note=f"*{trigger_key} opens '{trigger.get('name')}'", wait_ms=wait_after_open)
                            price_btn = consensus_btn = False
                            inside_tabs = 0
                            for i in range(30):
                                dismiss_overlay(page)
                                fi = press(page, "Tab", surface="P2-inside", note=f"tab inside popup {i+1}")
                                inside_tabs += 1
                                nl = (fi.get("name") or "").lower()
                                if "save" in nl and "price to notebook" in nl:
                                    price_btn = True
                                if "save" in nl and "analyst consensus to notebook" in nl:
                                    consensus_btn = True
                                    break
                            STEPS.append({"n": len(STEPS)+1, "surface": "P2-summary", "keys": "(note)",
                                          "note": f"{trigger_key} door: price_btn_seen={price_btn} "
                                                  f"consensus_btn_seen={consensus_btn} tabs_inside={inside_tabs}",
                                          "focus": {}})
                            if not (price_btn and consensus_btn):
                                FINDINGS.append({
                                    "id": f"RWP2{len(FINDINGS)+1:03d}", "surface": "Open Positions ticker trigger",
                                    "sc": "2.1.1",
                                    "expected": "both 'Save ...price to Notebook' and 'Save ...analyst consensus "
                                                "to Notebook' reachable by Tab from the trigger within 30 Tabs",
                                    "seen": f"price_btn_seen={price_btn} consensus_btn_seen={consensus_btn} "
                                            f"after {inside_tabs} Tabs ({trigger_key} door)",
                                    "severity": "major", "known_gap": None, "step_n": len(STEPS),
                                    "screenshot": shot(page, f"p2-{len(STEPS):04d}-not-reached")})
                            press(page, "Escape", surface="P2-close",
                                  note="*Escape closes -- focus should return to trigger", wait_ms=300)
                            after = focus_info(page)
                            restored = (after.get("name") == trigger.get("name")
                                        and after.get("role") == trigger.get("role"))
                            STEPS.append({"n": len(STEPS)+1, "surface": "P2-close", "keys": "(compare)",
                                          "note": f"trigger={trigger.get('name')!r} "
                                                  f"after_escape={after.get('name')!r} restored={restored}",
                                          "focus": after})
                            if not restored:
                                FINDINGS.append({
                                    "id": f"RWP2{len(FINDINGS)+1:03d}", "surface": "Open Positions ticker trigger",
                                    "sc": "2.4.3",
                                    "expected": "Escape returns focus to the trigger that opened the popup",
                                    "seen": f"trigger={trigger.get('name')!r} after_escape={after.get('name')!r}",
                                    "severity": "minor", "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
                            dump()

                        one_pass("Enter", 500)
                        one_pass("Space", 500)

                        page.close()
                    finally:
                        browser.close()
    except Exception as e:  # noqa: BLE001
        import traceback
        not_run = f"{type(e).__name__}: {e}"
        (OUT_DIR / "traceback-rewalk-a2r05-page2.txt").write_text(traceback.format_exc(), encoding="utf-8")
        log(traceback.format_exc())
    finally:
        stop_how = sb.stop()
        ipath = sb.integrity_path()
        required = [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN]
        integ = H.read_integrity(ipath, required)
        if ipath and Path(ipath).is_file():
            import shutil
            shutil.copy(ipath, OUT_DIR / "integrity-rewalk-a2r05-page2.md")
        dump()
        log(f"STOP: {stop_how}")
        log("INTEGRITY: " + H.integrity_line(integ, not_run=not_run))
        log(f"steps recorded: {len(STEPS)}; findings: {len(FINDINGS)}")
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
