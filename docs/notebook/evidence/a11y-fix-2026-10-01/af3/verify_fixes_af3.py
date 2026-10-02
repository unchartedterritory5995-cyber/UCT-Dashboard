"""Real-browser keyboard proof for RW-NEW-01 (focus order into the TickerPopup
chart modal) and RW-NEW-02 (the capture-result live region), lane AF3,
Notebook 10/10 program, 2026-10-01.

Template: `docs/notebook/evidence/a11y-fix-2026-10-01/verify_fixes.py` (lane AF)
-- the sandbox boot pattern (`tools/notebook_perf_harness.Sandbox`), the
account provisioning recipe, and the no-selector-driven-focus `FOCUS_JS` probe
are reused verbatim/near-verbatim, per the task brief's instruction to adapt
that script. This script does NOT drive the mouse. Every interaction with the
product after the page loads is `page.keyboard` (Tab, Shift+Tab, Enter) or a
browser-level action (new page/context, localStorage write for fixture
seeding -- the second reviewer's own A2R-05 rewalk used the identical
`localStorage['uct.jw.lastNote']` technique to point a capture at a pre-locked
note, and that precedent is followed here, never as a measured step).

Output: focus-log-af3.json (one record per keyboard action) + screenshots/ +
integrity.md (the sandbox's own integrity log, copied here).

Usage (PowerShell; the data dir single-quoted, forward slashes):
    python docs/notebook/evidence/a11y-fix-2026-10-01/af3/verify_fixes_af3.py `
        --data-dir 'C:/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/441b0c89-c1d8-471c-bd31-2a4fb712ee30/scratchpad/af3-data' `
        --port 8423 --artifacts '<scratchpad>/af3-art'
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

GATES = {
    "J2_SHARE_LINKS_ENABLED": "1", "NOTEBOOK_PUBLISH_ENABLED": "1", "NOTEBOOK_ONBOARDING_ENABLED": "1",
    "NOTEBOOK_ASK_INSERT_ON": "1", "NOTEBOOK_WRITING_HELP_ENABLED": "1", "COMPASS_NOTES_TOOL_ENABLED": "1",
    "NOTEBOOK_PERSONAL_API_ENABLED": "1", "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "1",
    "NOTEBOOK_TASK_REMINDERS_ENABLED": "1", "NOTEBOOK_INBOUND_EMAIL_ENABLED": "1", "J2_OCR_ENABLED": "1",
}

REPO = Path(__file__).resolve().parents[5]
OUT_DIR = Path(__file__).resolve().parent
SHOTS_DIR = OUT_DIR / "screenshots"
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
if str(REPO / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO / "scripts"))

STEPS: list[dict] = []
FINDINGS: list[dict] = []

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
except Exception:  # noqa: BLE001
    pass


def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", errors="backslashreplace").decode("ascii"), flush=True)


def dump() -> None:
    (OUT_DIR / "focus-log-af3.json").write_text(
        json.dumps({"steps": STEPS, "findings": FINDINGS}, indent=2), encoding="utf-8")


# ── focus introspection -- verbatim from the second reviewer's walk.py ──────
FOCUS_JS = r"""
() => {
  const el = document.activeElement;
  if (!el || el === document.body) return {present: false};
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const name = (
    el.getAttribute('aria-label') ||
    (el.getAttribute('aria-labelledby')
      ? (document.getElementById(el.getAttribute('aria-labelledby').split(' ')[0])?.textContent || '').trim()
      : '') ||
    el.getAttribute('placeholder') ||
    (el.tagName === 'IMG' ? el.getAttribute('alt') : '') ||
    (el.textContent || '').trim().slice(0, 80) ||
    el.getAttribute('title') ||
    el.getAttribute('value') || ''
  );
  const implicitRoles = {A: 'link', BUTTON: 'button', TEXTAREA: 'textbox',
    SELECT: 'combobox', SUMMARY: 'button', OPTION: 'option'};
  let implicitRole = implicitRoles[el.tagName];
  if (el.tagName === 'INPUT') {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    implicitRole = ({checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button',
      range: 'slider', search: 'searchbox'})[t] || 'textbox';
  }
  const role = el.getAttribute('role') || implicitRole || el.tagName.toLowerCase();
  const outlineNone = cs.outlineStyle === 'none' || cs.outlineWidth === '0px';
  const boxShadowNone = !cs.boxShadow || cs.boxShadow === 'none';
  const hasVisibleIndicator = !(outlineNone && boxShadowNone);
  const inDialog = !!el.closest('[role="dialog"]');
  return {
    present: true, tag: el.tagName.toLowerCase(), role, name,
    id: el.id || null, inDialog,
    rect: {x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)},
    visibleIndicator: hasVisibleIndicator,
    url: location.pathname + location.search + location.hash,
  };
}
"""

STATUS_JS = r"""
() => {
  const el = document.querySelector('[data-testid="capture-status"]');
  if (!el) return {present: false};
  return {
    present: true,
    role: el.getAttribute('role'),
    ariaLive: el.getAttribute('aria-live'),
    ariaAtomic: el.getAttribute('aria-atomic'),
    text: (el.textContent || '').trim(),
  };
}
"""


def focus_info(page) -> dict:
    try:
        return page.evaluate(FOCUS_JS)
    except Exception as e:  # noqa: BLE001
        return {"present": False, "error": str(e)}


def status_info(page) -> dict:
    try:
        return page.evaluate(STATUS_JS)
    except Exception as e:  # noqa: BLE001
        return {"present": False, "error": str(e)}


def shot(page, name: str) -> str:
    path = SHOTS_DIR / f"{name}.png"
    try:
        page.screenshot(path=str(path), full_page=False, timeout=8000)
    except Exception as e:  # noqa: BLE001
        log(f"  [screenshot failed {name}: {e}]")
        return ""
    return f"screenshots/{path.name}"


def press(page, keys: str, *, surface: str, note: str = "", finding: str | None = None,
          sc: str | None = None, wait_ms: int = 160) -> dict:
    page.keyboard.press(keys)
    page.wait_for_timeout(wait_ms)
    fi = focus_info(page)
    rec = {"n": len(STEPS) + 1, "surface": surface, "keys": keys, "note": note, "focus": fi}
    take_shot = bool(finding) or note.startswith("*")
    if take_shot:
        shot_name = f"{len(STEPS)+1:04d}-{surface}".replace(" ", "_").replace("/", "-")
        rec["screenshot"] = shot(page, shot_name)
    STEPS.append(rec)
    if finding:
        FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": surface, "sc": sc,
                          "seen": finding, "step_n": rec["n"], "screenshot": rec.get("screenshot", "")})
    tag = " ***FINDING***" if finding else ""
    log(f"  [{rec['n']:04d}] {surface} <{keys}> -> {fi.get('role')} \"{(fi.get('name') or '')[:50]}\" "
        f"inDialog={fi.get('inDialog')} {note}{tag}")
    dump()
    return fi


def milestone(page, surface: str, note: str) -> None:
    page.wait_for_timeout(250)
    name = f"{len(STEPS)+1:04d}-{surface}-nav".replace(" ", "_").replace("/", "-")
    path = shot(page, name)
    STEPS.append({"n": len(STEPS) + 1, "surface": surface, "keys": "(navigate)", "note": note,
                  "focus": focus_info(page), "screenshot": path})
    log(f"  [{len(STEPS):04d}] {surface} (navigate) {note}")
    dump()


def goto(page, base, path, surface, note="*nav", dismiss_intro=True):
    page.goto(base + path, wait_until="domcontentloaded", timeout=30000)
    if dismiss_intro:
        # Same intro-overlay race fix the second reviewer's rewalk and lane
        # AF's own verify_fixes.py both document: retry Escape against an
        # actual presence check, rather than one fixed-delay fire-and-hope.
        page.wait_for_timeout(300)
        for _ in range(40):
            present = page.evaluate(
                "() => !!document.querySelector('[aria-label=\"Welcome\"]')")
            if not present:
                break
            try:
                page.keyboard.press("Escape")
            except Exception:  # noqa: BLE001
                pass
            page.wait_for_timeout(250)
    milestone(page, surface, note)


# ── account provisioning (API only -- fixture setup, not reviewed) ──────────

def admin_login(browser, base: str, H):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    r = ctx.request.post(base + "/api/auth/login", data={"email": H.ADMIN_EMAIL, "password": H.ADMIN_PW})
    if r.status not in (200, 201):
        r = ctx.request.post(base + "/api/auth/signup",
                              data={"email": H.ADMIN_EMAIL, "password": H.ADMIN_PW, "display_name": "af3test"})
        if r.status not in (200, 201):
            raise RuntimeError(f"admin signup failed {r.status} {r.text()[:200]}")
    return ctx


def provision(browser, admin_ctx, base: str, email: str, pw: str, name: str):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    r = ctx.request.post(base + "/api/auth/signup", data={"email": email, "password": pw, "display_name": name})
    if r.status not in (200, 201):
        raise RuntimeError(f"signup {email} failed: {r.status} {r.text()[:200]}")
    c = admin_ctx.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
    v = admin_ctx.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
    me = ctx.request.get(base + "/api/auth/me").json()
    if not me.get("paid_equiv"):
        raise RuntimeError(f"{email} not paid-equivalent (comp {c.status}, verify {v.status}, me={me})")
    log(f"provisioned {email}: paid_equiv={me.get('paid_equiv')}")
    return ctx


DOC = lambda *content: {"type": "doc", "content": list(content)}  # noqa: E731
P = lambda text: {"type": "paragraph", "content": [{"type": "text", "text": text}]}  # noqa: E731


def seed_locked_note(ctx, base: str) -> dict:
    """One note, created then LOCKED via the product's own
    `PATCH /notes/{id}/lock` -- fixture setup over the API, not a reviewed
    keyboard step, matching the second reviewer's own precedent for this
    exact fixture (their RW-NEW-02 evidence names the identical mechanism)."""
    rr = ctx.request.post(base + "/api/j2/notes", data=json.dumps(
        {"title": "AF3 locked note", "bodyJson": DOC(P("Locked before any capture is attempted."))}),
        headers={"Content-Type": "application/json"})
    if rr.status not in (200, 201):
        raise RuntimeError(f"create note failed: {rr.status} {rr.text()[:300]}")
    note = rr.json()["note"]
    lk = ctx.request.patch(base + f"/api/j2/notes/{note['id']}/lock",
                            data=json.dumps({"locked": True}),
                            headers={"Content-Type": "application/json"})
    if lk.status != 200 or not lk.json().get("note", {}).get("locked"):
        raise RuntimeError(f"lock failed: {lk.status} {lk.text()[:300]}")
    log(f"seeded + locked note {note['id']}")
    return note


FOCUSABLE_QS = (
    "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),"
    "textarea:not([disabled]),summary,[tabindex]:not([tabindex=\"-1\"])"
)


# ── RW-NEW-01: focus moves into the TickerPopup chart modal on open ─────────

def verify_rw_new_01(page, base):
    goto(page, base, "/dashboard", "RW1-load", "*open /dashboard")

    reached = False
    fi = {}
    for i in range(140):
        fi = press(page, "Tab", surface="RW1-reach-trigger", note=f"seek a ticker trigger {i+1}")
        name_l = (fi.get("name") or "").lower()
        if fi.get("role") == "button" and name_l.startswith("view chart for"):
            reached = True
            break
    if not reached:
        FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": "RW1", "sc": "2.1.1",
                          "seen": "no ticker trigger reached within 140 Tabs on /dashboard",
                          "step_n": len(STEPS)})
        return
    opener_name = fi.get("name")
    log(f"  [RW1] reached trigger: {opener_name!r}")

    fi = press(page, "Enter", surface="RW1-enter", note="*Enter on the ticker trigger", wait_ms=300)
    # The defect this fix closes: focus must be INSIDE the dialog the instant
    # it opens, not merely "a modal rendered somewhere".
    if not fi.get("inDialog"):
        FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": "RW1", "sc": "2.4.3",
                          "seen": f"after Enter, focus was NOT inside the dialog: role="
                                  f"{fi.get('role')} name={(fi.get('name') or '')!r}",
                          "step_n": len(STEPS), "screenshot": shot(page, "rw1-not-in-dialog")})
        return
    log(f"  [RW1] PASS: focus moved inside the dialog immediately (role={fi.get('role')} "
        f"name={(fi.get('name') or '')!r})")

    # Reach "Save ... current price to Notebook" in a HANDFUL of Tabs, not 26.
    price_reached_at = None
    for i in range(10):
        fi = press(page, "Tab", surface="RW1-reach-price", note=f"seek Save price button {i+1}")
        if not fi.get("inDialog"):
            FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": "RW1", "sc": "2.1.2",
                              "seen": f"Tab #{i+1} left the dialog onto role={fi.get('role')} "
                                      f"name={(fi.get('name') or '')!r}", "step_n": len(STEPS),
                              "screenshot": shot(page, "rw1-tab-left-dialog")})
            return
        if "current price to notebook" in (fi.get("name") or "").lower():
            price_reached_at = i + 1
            break
    if price_reached_at is None:
        FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": "RW1", "sc": "2.4.3",
                          "seen": "'Save ... current price to Notebook' not reached within 10 Tabs "
                                  "of opening (was 26+ stops of background content before the fix)",
                          "step_n": len(STEPS)})
    else:
        log(f"  [RW1] PASS: reached the price-capture button in {price_reached_at} Tabs "
            "(was 26+ background stops before the fix)")

    # Tab cycles inside: walk a generous number of Tabs and confirm focus
    # never leaves the dialog.
    left = False
    for i in range(50):
        fi = press(page, "Tab", surface="RW1-cycle", note=f"cycle probe {i+1}")
        if not fi.get("inDialog"):
            left = True
            FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": "RW1", "sc": "2.1.2",
                              "seen": f"Tab left the dialog after {i+1} cycle-probe presses onto "
                                      f"role={fi.get('role')} name={(fi.get('name') or '')!r}",
                              "step_n": len(STEPS), "screenshot": shot(page, "rw1-cycle-left")})
            break
    if not left:
        log("  [RW1] PASS: Tab stayed inside the dialog across 50 presses (the trap wraps)")

    # Escape closes it and restores focus to the trigger.
    press(page, "Escape", surface="RW1-escape", note="*Escape closes the chart modal")
    after = focus_info(page)
    restored = (after.get("name") == opener_name)
    STEPS.append({"n": len(STEPS) + 1, "surface": "RW1-escape", "keys": "(compare)",
                  "note": f"after_close focus: {after}; restored={restored}", "focus": after})
    dump()
    if not restored:
        FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": "RW1", "sc": "2.4.3",
                          "seen": f"focus after Escape was {after.get('name')!r}, not the trigger "
                                  f"{opener_name!r}", "step_n": len(STEPS),
                          "screenshot": shot(page, "rw1-no-restore")})
    else:
        log("  [RW1] PASS: Escape closed the modal and restored focus to the trigger")


# ── RW-NEW-02: the capture-result live region, incl. a LOCKED last-opened
#    note -- read the region's role + text, confirm it survives past the old
#    2500ms window. ───────────────────────────────────────────────────────

def verify_rw_new_02(page, base, locked_note: dict):
    # Point the capture door at the pre-locked note the same way the product
    # itself does on every real note open (NoteEditorPage.jsx writes this key)
    # -- fixture setup, not a reviewed step; see seed_locked_note()'s docstring.
    page.evaluate(
        "(n) => { try { localStorage.setItem('uct.jw.lastNote', "
        "JSON.stringify({id: n.id, ts: Date.now(), title: n.title || null})) } catch (e) {} }",
        locked_note,
    )
    goto(page, base, "/dashboard", "RW2-load", "*open /dashboard, last-active note is LOCKED")

    reached = False
    fi = {}
    for i in range(140):
        fi = press(page, "Tab", surface="RW2-reach-trigger", note=f"seek a ticker trigger {i+1}")
        if fi.get("role") == "button" and (fi.get("name") or "").lower().startswith("view chart for"):
            reached = True
            break
    if not reached:
        FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": "RW2", "sc": "4.1.3",
                          "seen": "no ticker trigger reached within 140 Tabs", "step_n": len(STEPS)})
        return
    press(page, "Enter", surface="RW2-enter", note="*Enter opens the chart modal", wait_ms=300)

    before = status_info(page)
    STEPS.append({"n": len(STEPS) + 1, "surface": "RW2-before", "keys": "(evaluate)",
                  "note": f"status region before any capture: {before}", "focus": {}})
    dump()
    if not before.get("present") or before.get("role") != "status":
        FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": "RW2", "sc": "4.1.3",
                          "seen": f"the status region is not present with role=status before any "
                                  f"capture: {before}", "step_n": len(STEPS)})
        return
    log(f"  [RW2] PASS: the status region exists before any message: {before}")

    price_reached = False
    for i in range(10):
        fi = press(page, "Tab", surface="RW2-reach-price", note=f"seek Save price button {i+1}")
        if "current price to notebook" in (fi.get("name") or "").lower():
            price_reached = True
            break
    if not price_reached:
        FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": "RW2", "sc": "4.1.3",
                          "seen": "'Save ... current price to Notebook' not reached within 10 Tabs",
                          "step_n": len(STEPS)})
        return

    press(page, "Enter", surface="RW2-fire", note="*Enter fires the capture against a LOCKED note",
          wait_ms=600)
    status = status_info(page)
    STEPS.append({"n": len(STEPS) + 1, "surface": "RW2-fire", "keys": "(evaluate)",
                  "note": f"status region immediately after firing: {status}", "focus": {},
                  "screenshot": shot(page, "rw2-refusal-text")})
    dump()
    if not status.get("present") or status.get("role") != "status" \
            or "locked" not in (status.get("text") or "").lower():
        FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": "RW2", "sc": "4.1.3",
                          "seen": f"locked-note refusal did not land in role=status text: {status}",
                          "step_n": len(STEPS), "screenshot": shot(page, "rw2-no-refusal-text")})
        return
    log(f"  [RW2] PASS: refusal text is in role=status, aria-live={status.get('ariaLive')!r}: "
        f"{status.get('text')!r}")

    # Confirm it is STILL present after 3 seconds -- the window a scripted
    # probe lost a race against at 2500ms in the rewalk's own evidence.
    page.wait_for_timeout(3000)
    status_after = status_info(page)
    STEPS.append({"n": len(STEPS) + 1, "surface": "RW2-after-3s", "keys": "(wait 3000ms, evaluate)",
                  "note": f"status region after 3s: {status_after}", "focus": {},
                  "screenshot": shot(page, "rw2-after-3s")})
    dump()
    if status_after.get("text") != status.get("text"):
        FINDINGS.append({"id": f"AF3-{len(FINDINGS)+1:03d}", "surface": "RW2", "sc": "4.1.3",
                          "seen": f"the refusal text did not survive 3 seconds: before={status!r} "
                                  f"after={status_after!r}", "step_n": len(STEPS),
                          "screenshot": shot(page, "rw2-vanished-early")})
    else:
        log("  [RW2] PASS: the refusal text is still present after 3 seconds "
            f"(text={status_after.get('text')!r})")


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
                        admin_ctx = admin_login(browser, base, H)
                        reviewer_ctx = provision(browser, admin_ctx, base,
                                                  "af3-fix-verify@local.dev", "Af3FixVerify2026!", "AF3 Fix Verify")
                        locked_note = seed_locked_note(reviewer_ctx, base)
                        dump()

                        page = reviewer_ctx.new_page()
                        verify_rw_new_01(page, base)
                        verify_rw_new_02(page, base, locked_note)
                        page.close()

                        (OUT_DIR / "fixtures-af3.json").write_text(
                            json.dumps({"locked_note": locked_note}, indent=2), encoding="utf-8")
                    finally:
                        browser.close()
    except Exception as e:  # noqa: BLE001
        import traceback
        not_run = f"{type(e).__name__}: {e}"
        (OUT_DIR / "traceback.txt").write_text(traceback.format_exc(), encoding="utf-8")
        log(traceback.format_exc())
    finally:
        stop_how = sb.stop()
        ipath = sb.integrity_path()
        required = [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN]
        integ = H.read_integrity(ipath, required)
        if ipath and Path(ipath).is_file():
            shutil.copy(ipath, OUT_DIR / "integrity-af3.md")
        dump()
        log(f"STOP: {stop_how}")
        log("INTEGRITY: " + H.integrity_line(integ, not_run=not_run))
        log(f"steps recorded: {len(STEPS)}; findings: {len(FINDINGS)}")

    if not_run:
        log(f"NOT RUN: {not_run}")
        return 2
    if FINDINGS:
        log(f"FINDINGS: {len(FINDINGS)} -- see focus-log-af3.json")
        return 1
    log("ALL CLEAR: no findings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
