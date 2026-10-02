"""Second-reviewer RE-WALK supplement -- isolated check for the locked-note
capture refusal, on a FRESH, otherwise-untouched account (the combined run's
account had accumulated enough sidebar clutter from the earlier checks that
"More note actions" fell outside a 60-Tab budget; a clean account keeps this
simple and fast rather than guessing a bigger number).
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
    (OUT_DIR / "focus-log-rewalk-lock.json").write_text(
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


def press(page, keys, *, surface, note="", wait_ms=160):
    page.keyboard.press(keys)
    page.wait_for_timeout(wait_ms)
    fi = focus_info(page)
    rec = {"n": len(STEPS)+1, "surface": surface, "keys": keys, "note": note, "focus": fi}
    if note.startswith("*"):
        rec["screenshot"] = shot(page, f"rwlock-{len(STEPS)+1:04d}-{surface}".replace(" ", "_"))
    STEPS.append(rec)
    log(f"  [{rec['n']:04d}] {surface} <{keys}> -> {fi.get('role')} \"{(fi.get('name') or '')[:50]}\" {note}")
    dump()
    return fi


_OVERLAY_JS = (
    "() => { const els=[...document.querySelectorAll('*')]; "
    "const ov = els.find(e => { const cs=getComputedStyle(e); return cs.position==='fixed' && "
    "parseInt(cs.zIndex||'0')>=99999; }); return !!ov; }"
)


def dismiss_overlay(page, budget_s=12):
    """Measured on run 2 of this script: the goto()-time dismiss loop is not
    enough on its own. On that run the overlay check inside goto() correctly
    found nothing present (so goto() returned at once), and the intro then
    mounted LATE -- after goto() had already judged it absent -- during the
    very next Tab-seek loop ("More note actions"), trapping Tab on "Skip
    intro" for 48 of that loop's 60-Tab budget (steps 9-57 of run 2's own
    focus-log-rewalk-lock.json). AuthContext's `loading` resolution time is
    apparently not bounded by the ~300ms this script waits at nav time.
    Called at the TOP of every seek-loop iteration below so a late mount
    costs a few Escape presses against ITS OWN budget, never the seek
    loop's -- and is a near-free no-op (one evaluate() call) when the
    overlay never shows."""
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


def goto(page, base, path, surface, note="*nav", dismiss_intro=True):
    page.goto(base + path, wait_until="domcontentloaded", timeout=30000)
    if dismiss_intro:
        # A single Escape at a fixed delay races the intro's own mount effect
        # -- firing too early leaves its capture-phase skip listener
        # unregistered, and (on a fresh context, where the intro replays)
        # that holds Tab captive on "Skip intro" for its full runtime,
        # burning a Tab-seek budget on a screen that was never reached. Give
        # the mount effect a beat first (a zero-wait check reads "not
        # present" before React has mounted it, which is the opposite race),
        # then retry Escape until the SAME overlay check check_a2r_01 uses
        # (position:fixed, z-index >= 99999) reports it gone, or the budget
        # is spent.
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
    p = shot(page, f"rwlock-{len(STEPS)+1:04d}-{surface}-nav".replace(" ", "_"))
    STEPS.append({"n": len(STEPS)+1, "surface": surface, "keys": "(navigate)", "note": note,
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
                        email, pw = "a11y2-rwlock@local.dev", "A11yRwLock2026!"
                        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
                        r = ctx.request.post(base + "/api/auth/signup",
                                              data={"email": email, "password": pw, "display_name": "RW Lock"})
                        if r.status not in (200, 201):
                            raise RuntimeError(f"signup failed {r.status} {r.text()[:200]}")
                        admin_ctx.request.post(base + "/api/auth/admin/comp-access",
                                                data={"email": email, "action": "grant"})
                        admin_ctx.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
                        me = ctx.request.get(base + "/api/auth/me").json()
                        if not me.get("paid_equiv"):
                            raise RuntimeError(f"not paid: {me}")
                        log(f"provisioned {email}: paid_equiv={me.get('paid_equiv')}")

                        rn = ctx.request.post(base + "/api/j2/notes", data=json.dumps({
                            "title": "Note to lock", "bodyJson": {"type": "doc", "content": [
                                {"type": "paragraph", "content": [{"type": "text", "text": "content"}]}]}}),
                            headers={"Content-Type": "application/json"})
                        note_id = rn.json()["note"]["id"]
                        log(f"  [seed] note: {rn.status} id={note_id}")

                        page = ctx.new_page()
                        goto(page, base, f"/journal/notebook?note={note_id}", "RWLOCK-open",
                             "*open the note to lock (query-param URL, the real shape)")
                        page.wait_for_timeout(500)
                        opened_more = False
                        for i in range(60):
                            dismiss_overlay(page)
                            fi = press(page, "Tab", surface="RWLOCK-more", note=f"seek More note actions {i+1}")
                            if (fi.get("name") or "").strip().lower() == "more note actions":
                                press(page, "Enter", surface="RWLOCK-more", note="*open More note actions",
                                      wait_ms=300)
                                opened_more = True
                                break
                        locked = False
                        if opened_more:
                            for i in range(12):
                                dismiss_overlay(page)
                                fi = press(page, "Tab", surface="RWLOCK-item", note=f"seek Lock {i+1}")
                                if (fi.get("name") or "").strip().lower() == "lock":
                                    press(page, "Enter", surface="RWLOCK-item",
                                          note="*Enter on Lock -- locks by keyboard", wait_ms=500)
                                    locked = True
                                    break
                        STEPS.append({"n": len(STEPS)+1, "surface": "RWLOCK-status", "keys": "(note)",
                                      "note": f"opened_more={opened_more} locked={locked}", "focus": {}})
                        dump()

                        if locked:
                            lock_state = page.evaluate(
                                "() => ({lockedGlyph: !!document.querySelector('[aria-label=\"Locked\"]')})")
                            STEPS.append({"n": len(STEPS)+1, "surface": "RWLOCK-confirm", "keys": "(evaluate)",
                                          "note": f"after Lock: {lock_state}", "focus": {},
                                          "screenshot": shot(page, f"rwlock-{len(STEPS)+1:04d}-locked")})
                            dump()

                            goto(page, base, "/dashboard", "RWLOCK-capture", "*dashboard, for the capture trigger")
                            reached = False
                            fi = {}
                            for i in range(160):
                                dismiss_overlay(page)
                                fi = press(page, "Tab", surface="RWLOCK-capture-reach",
                                           note=f"seek a ticker chip {i+1}")
                                if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
                                    reached = True
                                    break
                            if reached:
                                press(page, "Enter", surface="RWLOCK-capture", note="*Enter opens the chart modal",
                                      wait_ms=500)
                                price_btn = False
                                for i in range(30):
                                    dismiss_overlay(page)
                                    fi = press(page, "Tab", surface="RWLOCK-capture-inside",
                                               note=f"seek 'Save price to Notebook' {i+1}")
                                    nl = (fi.get("name") or "").lower()
                                    if "save" in nl and "price to notebook" in nl:
                                        price_btn = True
                                        break
                                if price_btn:
                                    page.evaluate(
                                        "() => { window.__a11yMsgSeen = null; "
                                        "new MutationObserver((muts) => { for (const m of muts) for (const n of "
                                        "m.addedNodes) { if (n.nodeType===1 && (n.textContent||'').toLowerCase()"
                                        ".includes('locked')) window.__a11yMsgSeen = n.outerHTML.slice(0,400); } "
                                        "}).observe(document.body, {childList:true, subtree:true}); }")
                                    press(page, "Enter", surface="RWLOCK-capture",
                                          note="*Enter on 'Save price to Notebook' (targets the LOCKED note)",
                                          wait_ms=2500)
                                    probe = page.evaluate(
                                        "() => { const live=[...document.querySelectorAll("
                                        "'[role=\"status\"],[role=\"alert\"],[aria-live]')].map(e => "
                                        "({role:e.getAttribute('role'),ariaLive:e.getAttribute('aria-live'),"
                                        "text:(e.textContent||'').trim().slice(0,200)})); "
                                        "const toastEl=[...document.querySelectorAll('span')].find(e => "
                                        "(e.textContent||'').toLowerCase().includes('locked')); "
                                        "return {liveRegions:live, toastText: toastEl?toastEl.textContent.trim():null, "
                                        "toastRole: toastEl?toastEl.getAttribute('role'):null, "
                                        "toastAriaLive: toastEl?toastEl.getAttribute('aria-live'):null, "
                                        "mutationSeen: window.__a11yMsgSeen}; }")
                                    STEPS.append({"n": len(STEPS)+1, "surface": "RWLOCK-message", "keys": "(evaluate)",
                                                  "note": f"capture-toast probe: {probe}", "focus": {},
                                                  "screenshot": shot(page, f"rwlock-{len(STEPS)+1:04d}-message")})
                                    dump()
                                    if probe.get("toastText") and not probe.get("toastRole") and not probe.get("toastAriaLive"):
                                        FINDINGS.append({"id": "RWLOCK001", "surface": "Ticker popup capture toast",
                                                          "sc": "4.1.3",
                                                          "expected": "the locked-note refusal sentence is in a "
                                                                      "role=status/alert region or carries "
                                                                      "aria-live",
                                                          "seen": f"rendered as plain text with no role/aria-live: "
                                                                  f"{probe.get('toastText')!r}; page-wide live "
                                                                  f"region census: {probe.get('liveRegions')}",
                                                          "severity": "major", "known_gap": None,
                                                          "step_n": len(STEPS),
                                                          "screenshot": shot(page, f"rwlock-{len(STEPS):04d}-no-live")})
                                    elif probe.get("toastText"):
                                        log(f"  [RWLOCK] toast exposed via role/aria-live: {probe}")
                                    else:
                                        log(f"  [RWLOCK] no toast text found by heuristic -- see screenshot: {probe}")
                                else:
                                    STEPS.append({"n": len(STEPS)+1, "surface": "RWLOCK-capture", "keys": "(not reached)",
                                                  "note": "'Save price to Notebook' not reached within 30 Tabs",
                                                  "focus": {}})
                            else:
                                STEPS.append({"n": len(STEPS)+1, "surface": "RWLOCK-capture", "keys": "(not reached)",
                                              "note": "no ticker chip reached within 160 Tabs on /dashboard",
                                              "focus": {}})
                        dump()
                        page.close()
                    finally:
                        browser.close()
    except Exception as e:  # noqa: BLE001
        import traceback
        not_run = f"{type(e).__name__}: {e}"
        (OUT_DIR / "traceback-rewalk-lock.txt").write_text(traceback.format_exc(), encoding="utf-8")
        log(traceback.format_exc())
    finally:
        stop_how = sb.stop()
        ipath = sb.integrity_path()
        required = [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN]
        integ = H.read_integrity(ipath, required)
        if ipath and Path(ipath).is_file():
            import shutil
            shutil.copy(ipath, OUT_DIR / "integrity-rewalk-lock.md")
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
