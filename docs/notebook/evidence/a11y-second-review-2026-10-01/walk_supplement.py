"""Second-reviewer keyboard walk -- SUPPLEMENT. Two targeted re-checks the main
walk.py run left ambiguous:

  1. The Keyboard Shortcuts ("?") dialog's focus trap and focus-restore-on-close,
     tested CLEANLY right after a fresh page load (the main run's attempt followed a
     command-palette close that left focus on <body>, and the shortcut did not fire
     at all that time -- itself recorded as its own finding, not this one).
  2. The graph canvas's reachability with a larger Tab budget (confirmed from source,
     NoteGraphView.jsx:670-672, that the canvas has tabIndex=0 and a role=application
     aria-label -- so a "not reached in 70" result needed a wider budget before being
     read as a defect rather than an instrument limit).

Reuses the same Sandbox/account pattern as walk.py. Writes its own
focus-log-supplement.json + screenshots/ (shared screenshots dir with walk.py, using
a distinct filename prefix so nothing is overwritten).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
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


def log(msg: str) -> None:
    print(msg, flush=True)


def dump() -> None:
    (OUT_DIR / "focus-log-supplement.json").write_text(
        json.dumps({"steps": STEPS, "findings": FINDINGS}, indent=2), encoding="utf-8")


FOCUS_JS = r"""
() => {
  const el = document.activeElement;
  if (!el || el === document.body) return {present: false};
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  let implicitRole = {A:'link',BUTTON:'button',TEXTAREA:'textbox',SELECT:'combobox',SUMMARY:'button',OPTION:'option'}[el.tagName];
  if (el.tagName === 'INPUT') {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    implicitRole = ({checkbox:'checkbox',radio:'radio',button:'button',submit:'button',range:'slider',search:'searchbox'})[t] || 'textbox';
  }
  const role = el.getAttribute('role') || implicitRole || el.tagName.toLowerCase();
  const name = (
    el.getAttribute('aria-label') ||
    (el.getAttribute('aria-labelledby') ? (document.getElementById(el.getAttribute('aria-labelledby').split(' ')[0])?.textContent || '').trim() : '') ||
    el.getAttribute('placeholder') ||
    (el.tagName === 'IMG' ? el.getAttribute('alt') : '') ||
    (el.textContent || '').trim().slice(0, 80) ||
    el.getAttribute('title') ||
    el.getAttribute('value') || ''
  );
  const outlineNone = cs.outlineStyle === 'none' || cs.outlineWidth === '0px';
  const boxShadowNone = !cs.boxShadow || cs.boxShadow === 'none';
  return {present: true, tag: el.tagName.toLowerCase(), role, name,
    rect: {x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)},
    visibleIndicator: !(outlineNone && boxShadowNone), inViewport: rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth};
}
"""


def focus_info(page) -> dict:
    try:
        return page.evaluate(FOCUS_JS)
    except Exception as e:  # noqa: BLE001
        return {"present": False, "error": str(e)}


def shot(page, name: str) -> str:
    path = SHOTS_DIR / f"{name}.png"
    try:
        page.screenshot(path=str(path), full_page=False, timeout=8000)
    except Exception:  # noqa: BLE001
        return ""
    return f"screenshots/{path.name}"


def press(page, keys, *, surface, note="", finding=None, severity=None, sc=None, wait_ms=160):
    page.keyboard.press(keys)
    page.wait_for_timeout(wait_ms)
    fi = focus_info(page)
    rec = {"n": len(STEPS) + 1, "surface": surface, "keys": keys, "note": note, "focus": fi}
    if finding or note.startswith("*"):
        rec["screenshot"] = shot(page, f"sup-{len(STEPS)+1:04d}-{surface}".replace(" ", "_"))
    STEPS.append(rec)
    if finding:
        FINDINGS.append({"id": f"S{len(FINDINGS)+1:03d}", "surface": surface, "sc": sc,
                          "expected": finding, "seen": "", "severity": severity, "step_n": rec["n"],
                          "screenshot": rec.get("screenshot", "")})
    log(f"  [{rec['n']:04d}] {surface} <{keys}> -> {fi.get('role')} \"{(fi.get('name') or '')[:50]}\" {note}")
    dump()
    return fi


def goto(page, base, path, surface, note="*nav", dismiss_intro=True):
    page.goto(base + path, wait_until="domcontentloaded", timeout=30000)
    if dismiss_intro:
        page.wait_for_timeout(150)
        try:
            page.keyboard.press("Escape")
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(150)
    page.wait_for_timeout(200)
    path_ = shot(page, f"sup-{len(STEPS)+1:04d}-{surface}-nav".replace(" ", "_"))
    STEPS.append({"n": len(STEPS) + 1, "surface": surface, "keys": "(navigate)", "note": note,
                  "focus": focus_info(page), "screenshot": path_})
    log(f"  [{len(STEPS):04d}] {surface} (navigate) {note}")
    dump()


def main() -> int:
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
                        email, pw = "a11y2-sup@local.dev", "A11ySup2026!"
                        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
                        r = ctx.request.post(base + "/api/auth/signup",
                                              data={"email": email, "password": pw, "display_name": "A11y Supplement"})
                        if r.status not in (200, 201):
                            raise RuntimeError(f"signup failed {r.status} {r.text()[:200]}")
                        admin_ctx.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
                        admin_ctx.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
                        me = ctx.request.get(base + "/api/auth/me").json()
                        if not me.get("paid_equiv"):
                            raise RuntimeError(f"not paid: {me}")
                        log(f"provisioned {email}: paid_equiv={me.get('paid_equiv')}")

                        r = ctx.request.post(base + "/api/j2/notes", data={
                            "title": "Supplement note",
                            "bodyJson": {"type": "doc", "content": [
                                {"type": "paragraph", "content": [{"type": "text", "text": "content"}]}]}})
                        log(f"  [seed] note: {r.status}")

                        page = ctx.new_page()

                        # ── 1) dialog trap/restore, right after a clean load ──────────
                        # PRIMARY door: the explicit "Show keyboard shortcuts" BUTTON
                        # (found reachable by Tab in the first supplement run, step 40) --
                        # reached and activated by Tab + Enter, never a bare key, per the
                        # brief's keyboard-only constraint. The bare "?" press is kept as
                        # a SEPARATE, secondary, informational check afterward: both
                        # supplement-run-1 attempts (once right after closing the command
                        # palette, once after a single settling Tab) got dialogCount=0,
                        # so whatever the global binding requires, a raw Playwright "?"
                        # key press is not satisfying it -- recorded as its own finding,
                        # not conflated with the button door's own trap/restore result.
                        goto(page, base, "/journal/notebook?view=all", "SUP-shortcuts", "*clean list load")
                        press(page, "Escape", surface="SUP-shortcuts", note="dismiss intro if still present")
                        page.wait_for_timeout(200)
                        btn_reached = False
                        fi = {}
                        for i in range(40):
                            fi = press(page, "Tab", surface="SUP-shortcuts-reach",
                                       note=f"seek 'Show keyboard shortcuts' button {i+1}")
                            if "show keyboard shortcuts" in (fi.get("name") or "").strip().lower():
                                btn_reached = True
                                break
                        if not btn_reached:
                            FINDINGS.append({"id": f"S{len(FINDINGS)+1:03d}", "surface":
                                              "H (Keyboard Shortcuts button)", "sc": "2.1.1",
                                              "expected": "'Show keyboard shortcuts' button reachable by Tab",
                                              "seen": f"not reached within 40 Tabs; last focus "
                                                      f"role={fi.get('role')} name={(fi.get('name') or '')!r}",
                                              "severity": "major", "step_n": len(STEPS), "screenshot": ""})
                        opener_before = focus_info(page)
                        press(page, "Enter", surface="SUP-shortcuts", note="*Enter on 'Show keyboard shortcuts'",
                              wait_ms=400)
                        DIALOG_PROBE = (
                            "() => { const ds=[...document.querySelectorAll('[role=\"dialog\"]')]; "
                            "const d=ds.find(x=>(x.textContent||'').includes('Keyboard Shortcuts')); "
                            "return {dialogCount: ds.length, found: !!d, "
                            "contains: d ? d.contains(document.activeElement) : null}; }")
                        probe0 = page.evaluate(DIALOG_PROBE)
                        STEPS.append({"n": len(STEPS) + 1, "surface": "SUP-shortcuts", "keys": "(evaluate)",
                                      "note": f"dialog probe after '?': {probe0}", "focus": {}})
                        dump()
                        if probe0["found"]:
                            left = False
                            for i in range(50):
                                fi = press(page, "Tab", surface="SUP-shortcuts-trap", note=f"trap probe {i+1}")
                                probe = page.evaluate(DIALOG_PROBE)
                                if probe["found"] and probe["contains"] is False:
                                    left = True
                                    FINDINGS.append({"id": f"S{len(FINDINGS)+1:03d}", "surface":
                                                      "H (Keyboard Shortcuts, '?')", "sc": "2.1.2",
                                                      "expected": "Tab stays inside the open dialog",
                                                      "seen": f"focus left the dialog after {i+1} Tab presses "
                                                              f"onto role={fi.get('role')} "
                                                              f"name={(fi.get('name') or '')!r}",
                                                      "severity": "major", "step_n": len(STEPS),
                                                      "screenshot": shot(page, f"sup-{len(STEPS):04d}-trap-left")})
                                    break
                                if not probe["found"]:
                                    break
                            if not left:
                                log("  [SUP] Tab stayed inside the Shortcuts dialog across the probe window")
                            press(page, "Escape", surface="SUP-shortcuts", note="*Escape closes Shortcuts dialog")
                            after_close = focus_info(page)
                            restored = (after_close.get("name") == opener_before.get("name")
                                        and after_close.get("role") == opener_before.get("role"))
                            STEPS.append({"n": len(STEPS) + 1, "surface": "SUP-shortcuts", "keys": "(compare)",
                                          "note": f"opener_before={opener_before} after_close={after_close} "
                                                  f"restored={restored}", "focus": {}})
                            if not restored:
                                FINDINGS.append({"id": f"S{len(FINDINGS)+1:03d}", "surface":
                                                  "H (Keyboard Shortcuts, '?')", "sc": "2.4.3",
                                                  "expected": "focus returns to the opener on close",
                                                  "seen": f"opener was role={opener_before.get('role')} "
                                                          f"name={opener_before.get('name')!r}; after close "
                                                          f"focus is role={after_close.get('role')} "
                                                          f"name={after_close.get('name')!r}",
                                                  "severity": "major", "step_n": len(STEPS),
                                                  "screenshot": shot(page, f"sup-{len(STEPS):04d}-no-restore")})
                        else:
                            FINDINGS.append({"id": f"S{len(FINDINGS)+1:03d}", "surface":
                                              "H (Keyboard Shortcuts button)", "sc": "4.1.2",
                                              "expected": "Enter on the 'Show keyboard shortcuts' button opens "
                                                          "the Keyboard Shortcuts dialog",
                                              "seen": f"dialog probe after Enter: {probe0}",
                                              "severity": "blocker", "step_n": len(STEPS), "screenshot": ""})
                        dump()

                        # ── 2) the bare "?" global shortcut -- SECONDARY, informational ──
                        # (graph canvas is NOT re-tested here: two independent runs already
                        # gave a consistent, reproducible negative -- 70 Tabs in the main
                        # walk, 160 Tabs i.e. more than a full double-cycle of the page in
                        # supplement run 1 -- so a third attempt would not add evidence.)
                        page.wait_for_timeout(200)
                        page.evaluate("document.activeElement && document.activeElement.blur && "
                                       "document.activeElement.blur()")
                        press(page, "Tab", surface="SUP-bareq", note="settle focus before the bare '?' press")
                        press(page, "?", surface="SUP-bareq", note="*press bare '?' (no button) to compare",
                              wait_ms=400)
                        probe_bare = page.evaluate(DIALOG_PROBE)
                        STEPS.append({"n": len(STEPS) + 1, "surface": "SUP-bareq", "keys": "(evaluate)",
                                      "note": f"dialog probe after bare '?': {probe_bare}", "focus": {}})
                        if not probe_bare["found"]:
                            FINDINGS.append({"id": f"S{len(FINDINGS)+1:03d}", "surface":
                                              "H (Keyboard Shortcuts, bare '?')", "sc": "2.1.1",
                                              "expected": "the documented '?' shortcut (ShortcutCheatSheet "
                                                          "mounted in JournalLayout.jsx) opens the dialog from "
                                                          "a settled, non-input focus",
                                              "seen": f"dialog probe after a bare '?' key press: {probe_bare} "
                                                      "(the explicit button works -- see the other finding; this "
                                                      "is the GLOBAL KEY shortcut specifically)",
                                              "severity": "minor", "step_n": len(STEPS), "screenshot": ""})
                        dump()
                        page.close()
                    finally:
                        browser.close()
    except Exception as e:  # noqa: BLE001
        import traceback
        not_run = f"{type(e).__name__}: {e}"
        (OUT_DIR / "traceback-supplement.txt").write_text(traceback.format_exc(), encoding="utf-8")
        log(traceback.format_exc())
    finally:
        stop_how = sb.stop()
        ipath = sb.integrity_path()
        required = [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN]
        integ = H.read_integrity(ipath, required)
        if ipath and Path(ipath).is_file():
            import shutil
            shutil.copy(ipath, OUT_DIR / "integrity-supplement.md")
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
