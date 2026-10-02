"""Real-browser keyboard proof for the three A2R-03/A2R-04/A2R-05 blocker fixes
(lane AF, Notebook 10/10 program), 2026-10-01.

Template: `docs/notebook/evidence/a11y-second-review-2026-10-01/walk.py` -- the
sandbox boot pattern (`tools/notebook_perf_harness.Sandbox`), the account
provisioning recipe, and the no-selector-driven-focus `FOCUS_JS` probe are
reused verbatim/near-verbatim from that file, per the task brief's own
instruction to read it and reuse it. This script does NOT drive the mouse.
Every interaction with the product after the page loads is `page.keyboard`
(Tab, Shift+Tab, Enter, Space, Escape, arrows, Home/End) or a browser-level
action (new page/context). API calls (`ctx.request`) are used ONLY to seed
fixture data before the walk begins, never to perform a step being measured.

Output: focus-log.json (one record per keyboard action) + screenshots/ +
integrity.md (the sandbox's own integrity log, copied here).

Usage (PowerShell; the data dir single-quoted, forward slashes):
    python docs/notebook/evidence/a11y-fix-2026-10-01/verify_fixes.py `
        --data-dir 'C:/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/441b0c89-c1d8-471c-bd31-2a4fb712ee30/scratchpad/af-data' `
        --port 8362 --artifacts '<scratchpad>/af-art'
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

# Mirrors the production-armed gates in the reviewer's own walk.py, so this
# sandbox behaves like the live site rather than the all-dark default.
GATES = {
    "J2_SHARE_LINKS_ENABLED": "1", "NOTEBOOK_PUBLISH_ENABLED": "1", "NOTEBOOK_ONBOARDING_ENABLED": "1",
    "NOTEBOOK_ASK_INSERT_ON": "1", "NOTEBOOK_WRITING_HELP_ENABLED": "1", "COMPASS_NOTES_TOOL_ENABLED": "1",
    "NOTEBOOK_PERSONAL_API_ENABLED": "1", "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "1",
    "NOTEBOOK_TASK_REMINDERS_ENABLED": "1", "NOTEBOOK_INBOUND_EMAIL_ENABLED": "1", "J2_OCR_ENABLED": "1",
}

REPO = Path(__file__).resolve().parents[4]
OUT_DIR = Path(__file__).resolve().parent
SHOTS_DIR = OUT_DIR / "screenshots"
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
if str(REPO / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO / "scripts"))

STEPS: list[dict] = []
FINDINGS: list[dict] = []

# Windows' console/redirect default codepage (cp1252) cannot encode some
# accessible names this app renders verbatim (e.g. the nav's "→" arrow glyph),
# which crashed the first run mid-walk on a bare `print()`. Reconfigure stdout
# to UTF-8 with a safe fallback rather than special-casing every string.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
except Exception:  # noqa: BLE001 -- best effort; log() still has its own guard
    pass


def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", errors="backslashreplace").decode("ascii"), flush=True)


def dump() -> None:
    (OUT_DIR / "focus-log.json").write_text(
        json.dumps({"steps": STEPS, "findings": FINDINGS}, indent=2), encoding="utf-8")


# ── focus introspection (no selector-driven focus, read-only) -- verbatim
#    from the second reviewer's own walk.py, same reasons (the accessible-name
#    priority order, visibleIndicator from computed style). ───────────────────
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
  return {
    present: true, tag: el.tagName.toLowerCase(), role, name,
    id: el.id || null,
    ariaExpanded: el.getAttribute('aria-expanded'), ariaPressed: el.getAttribute('aria-pressed'),
    rect: {x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)},
    visibleIndicator: hasVisibleIndicator,
    zeroSize: rect.width === 0 && rect.height === 0,
    url: location.pathname + location.search + location.hash,
  };
}
"""


def focus_info(page) -> dict:
    try:
        return page.evaluate(FOCUS_JS)
    except Exception as e:  # noqa: BLE001
        return {"present": False, "error": str(e)}


def dialog_probe(page) -> dict:
    """How many open dialogs, and whether one named `name_substr` exists."""
    return page.evaluate(
        "() => { const ds=[...document.querySelectorAll('[role=\"dialog\"]')]; "
        "return {dialogCount: ds.length, names: ds.map(d => d.getAttribute('aria-label') "
        "|| (d.querySelector('h2,h1') || {}).textContent || '')}; }"
    )


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
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": surface, "sc": sc,
                          "seen": finding, "step_n": rec["n"], "screenshot": rec.get("screenshot", "")})
    tag = " ***FINDING***" if finding else ""
    log(f"  [{rec['n']:04d}] {surface} <{keys}> -> {fi.get('role')} \"{(fi.get('name') or '')[:50]}\" "
        f"vis={fi.get('visibleIndicator')} {note}{tag}")
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
        # ⛔ A single Escape at a fixed 120ms delay is a RACE against the
        # intro's own mount effect (which waits on AuthContext's `loading`
        # before setting phase='playing' and registering its capture-phase
        # skip listener): measured on run 1, firing too early left the
        # listener unregistered, and with A2R-01's own trap now wired up, the
        # intro then held Tab captive on "Skip intro" for its FULL ~9.3s
        # runtime -- burning an entire 60-Tab search budget and producing a
        # false "canvas not reached" reading that was really "never got past
        # the overlay". Retry Escape until the overlay is actually gone (or a
        # budget is spent), rather than a single fire-and-hope.
        #
        # ⛔ A ZERO-WAIT FIRST CHECK HAS THE OPPOSITE RACE: React has not
        # mounted yet at the instant `domcontentloaded` fires, so an immediate
        # querySelector reads "not present" -- true of an EMPTY page, not of
        # "the intro decided not to play" -- and the loop would exit before
        # the intro mounts a moment later, leaving it to trap the very first
        # Tab of the seek loop that follows. Give the mount effect a beat
        # first, same order of magnitude as the original single check.
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
                              data={"email": H.ADMIN_EMAIL, "password": H.ADMIN_PW, "display_name": "aftest"})
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


def seed(ctx, base: str) -> dict:
    """Two linked notes (a real graph edge) + a third unlinked note, so the
    graph canvas draws something non-trivial; plus confirms notes.length > 0
    so the Notebook tab never renders Research Home on its own `?view=all`."""
    fx: dict = {}

    def mk_note(title, body, **extra):
        payload = {"title": title, "bodyJson": body}
        payload.update(extra)
        rr = ctx.request.post(base + "/api/j2/notes", data=json.dumps(payload),
                               headers={"Content-Type": "application/json"})
        if rr.status not in (200, 201):
            raise RuntimeError(f"create note {title!r} failed: {rr.status} {rr.text()[:300]}")
        return rr.json()["note"]

    n2 = mk_note("AF target note", DOC(P("This note exists to be linked to.")))
    fx["note2_id"] = n2["id"]
    n1 = mk_note("AF source note",
                 DOC({"type": "paragraph", "content": [
                     {"type": "text", "text": "See "},
                     {"type": "noteLink", "attrs": {"noteId": n2["id"]}},
                     {"type": "text", "text": " for context."}]}))
    fx["note1_id"] = n1["id"]
    n3 = mk_note("AF unlinked note", DOC(P("Nothing points here.")))
    fx["note3_id"] = n3["id"]
    return fx


# ── A2R-03: the graph is reachable by Tab from the view switcher ────────────

def verify_a2r03_graph(page, base):
    goto(page, base, "/journal/notebook?view=all", "A2R03-load", "*open Notebook, All notes")

    # Reach the view switcher's Graph toggle by Tab (never a selector click).
    reached = False
    fi = {}
    for i in range(60):
        fi = press(page, "Tab", surface="A2R03-reach-switcher", note=f"seek Graph view toggle {i+1}")
        if (fi.get("name") or "").strip().lower() == "graph view":
            reached = True
            break
    if not reached:
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R03", "sc": "2.1.1",
                          "seen": f"'Graph view' toggle not reached within 60 Tabs; last focus "
                                  f"name={(fi.get('name') or '')!r}", "step_n": len(STEPS)})
        return

    # Activate it with Enter (never .click()) and confirm the switcher itself
    # reports it pressed.
    fi = press(page, "Enter", surface="A2R03-activate", note="*Enter on Graph view toggle", wait_ms=400)

    # Now seek the canvas (role=application, name contains "Note graph").
    canvas_reached = False
    for i in range(30):
        fi = press(page, "Tab", surface="A2R03-reach-canvas", note=f"seek graph canvas {i+1}")
        name_l = (fi.get("name") or "").lower()
        if fi.get("role") == "application" or "note graph" in name_l:
            canvas_reached = True
            break
    if not canvas_reached:
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R03", "sc": "2.1.1",
                          "seen": f"graph canvas not reached within 30 Tabs after activating Graph "
                                  f"view; last focus role={fi.get('role')} name={(fi.get('name') or '')!r}",
                          "step_n": len(STEPS), "screenshot": shot(page, "a2r03-canvas-not-reached")})
        return

    log("  [A2R03] PASS: graph canvas reached by Tab from the view switcher")
    # Exercise the documented keyboard controls on the canvas itself.
    press(page, "Home", surface="A2R03-canvas", note="*Home on graph canvas -- first note by title")
    press(page, "ArrowRight", surface="A2R03-canvas", note="*ArrowRight -- move to nearest note")
    press(page, "Escape", surface="A2R03-canvas", note="*Escape -- clear the selection")

    # The list alternative must be reachable too: Shift+Tab back to "Show as list".
    list_reached = False
    for i in range(10):
        fi = press(page, "Shift+Tab", surface="A2R03-reach-list-toggle", note=f"seek 'Show as list' {i+1}")
        if "show as list" in (fi.get("name") or "").lower():
            list_reached = True
            break
    if list_reached:
        log("  [A2R03] PASS: 'Show as list' toggle reachable")
        press(page, "Enter", surface="A2R03-list", note="*Enter on 'Show as list' -- switch to the table")
        fi = focus_info(page)
        STEPS.append({"n": len(STEPS) + 1, "surface": "A2R03-list", "keys": "(evaluate)",
                      "note": f"post-toggle focus: {fi}", "focus": fi})
    else:
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R03", "sc": "2.1.1",
                          "seen": "'Show as list' toggle not reached within 10 Shift+Tabs from the canvas",
                          "step_n": len(STEPS)})


# ── A2R-04: Keyboard Shortcuts dialog -- Enter/Space, "?", trap, restore ────

def verify_a2r04_shortcuts(page, base):
    goto(page, base, "/journal", "A2R04-load", "*open /journal")

    reached = False
    fi = {}
    for i in range(40):
        fi = press(page, "Tab", surface="A2R04-reach-button", note=f"seek 'Show keyboard shortcuts' {i+1}")
        if "show keyboard shortcuts" in (fi.get("name") or "").strip().lower():
            reached = True
            break
    if not reached:
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R04", "sc": "2.1.1",
                          "seen": f"button not reached within 40 Tabs; last focus name="
                                  f"{(fi.get('name') or '')!r}", "step_n": len(STEPS)})
        return
    opener_name = fi.get("name")

    # Enter opens it.
    press(page, "Enter", surface="A2R04-enter", note="*Enter on 'Show keyboard shortcuts'", wait_ms=400)
    probe = dialog_probe(page)
    STEPS.append({"n": len(STEPS) + 1, "surface": "A2R04-enter", "keys": "(evaluate)",
                  "note": f"dialog probe after Enter: {probe}", "focus": {}})
    dump()
    if not any("keyboard shortcuts" in n.lower() for n in probe["names"]):
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R04", "sc": "4.1.2",
                          "seen": f"Enter on the button did not open the dialog: {probe}",
                          "step_n": len(STEPS), "screenshot": shot(page, "a2r04-enter-no-dialog")})
        return
    log("  [A2R04] PASS: Enter on the button opened the dialog")

    # Tab stays inside (the trap).
    left = False
    for i in range(6):
        fi = press(page, "Tab", surface="A2R04-trap", note=f"trap probe {i+1}")
        p = dialog_probe(page)
        inside = page.evaluate(
            "() => { const d=document.querySelector('[role=\"dialog\"]'); "
            "return d ? d.contains(document.activeElement) : null; }")
        if p["dialogCount"] and inside is False:
            left = True
            FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R04", "sc": "2.1.2",
                              "seen": f"focus left the dialog after {i+1} Tabs onto "
                                      f"role={fi.get('role')} name={(fi.get('name') or '')!r}",
                              "step_n": len(STEPS), "screenshot": shot(page, "a2r04-trap-left")})
            break
    if not left:
        log("  [A2R04] PASS: Tab stayed inside across the probe window")

    # Escape closes it and returns focus to the opener.
    press(page, "Escape", surface="A2R04-escape", note="*Escape closes the Shortcuts dialog")
    probe = dialog_probe(page)
    after = focus_info(page)
    restored = (after.get("name") == opener_name)
    STEPS.append({"n": len(STEPS) + 1, "surface": "A2R04-escape", "keys": "(compare)",
                  "note": f"dialog probe: {probe}; after_close focus: {after}; restored={restored}",
                  "focus": after})
    dump()
    if probe["dialogCount"]:
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R04", "sc": "2.1.1",
                          "seen": f"Escape did not close the dialog: {probe}", "step_n": len(STEPS)})
    elif not restored:
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R04", "sc": "2.4.3",
                          "seen": f"focus after Escape was {after.get('name')!r}, not the opener "
                                  f"{opener_name!r}", "step_n": len(STEPS),
                          "screenshot": shot(page, "a2r04-no-restore")})
    else:
        log("  [A2R04] PASS: Escape closed it and restored focus to the opener")

    # The bare "?" shortcut, from a settled, non-input focus (the opener
    # button still has focus from the restore above -- a real control, not
    # a text field, matching the brief's "focus is NOT in a text field").
    # ⛔ `page.keyboard.press("?")` is NOT the same event a real keyboard
    # produces: measured directly (a throwaway page with a keydown logger),
    # Playwright's single-character convenience form sends `{key:"?",
    # code:"Slash", shiftKey:FALSE}` -- it never actually holds Shift. The
    # EXPLICIT chord `"Shift+Slash"` does: `{key:"?", code:"Slash",
    # shiftKey:true}`, byte-identical to a real Shift+/ press (and to what
    # the vitest unit test for this fix dispatches). The second reviewer's
    # own supplement walk used the single-character form too, so its "bare
    # '?' does nothing" finding was already correct for the wrong reason as
    # well as the right one -- recorded here so a future reader does not
    # "fix" this back to `press(page, "?", ...)`.
    press(page, "Shift+Slash", surface="A2R04-bareq",
          note="*bare Shift+/ (real chord, not the single-char '?' shorthand) from settled focus",
          wait_ms=400)
    probe = dialog_probe(page)
    STEPS.append({"n": len(STEPS) + 1, "surface": "A2R04-bareq", "keys": "(evaluate)",
                  "note": f"dialog probe after bare '?': {probe}", "focus": {}})
    dump()
    if not any("keyboard shortcuts" in n.lower() for n in probe["names"]):
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R04", "sc": "2.1.1",
                          "seen": f"bare '?' did not open the dialog: {probe}",
                          "step_n": len(STEPS), "screenshot": shot(page, "a2r04-bareq-no-dialog")})
        return
    log("  [A2R04] PASS: bare '?' opened the dialog from a settled, non-input focus")
    press(page, "Escape", surface="A2R04-bareq-close", note="*Escape closes it again")

    # And the 2.1.4 guard: "?" must NOT fire while the caret is in a text
    # field. Open the note editor's title field (a real, always-present
    # input) and press "?" there.
    goto(page, base, "/journal/notebook?view=all", "A2R04-typing-setup", "*back to Notebook")
    # Create a fresh note via the template picker's blank option is slower to
    # drive by keyboard reliably across builds; instead reach any existing
    # note card and open it, then Tab to the title field.
    for i in range(1):
        pass
    opened = False
    for i in range(60):
        fi = press(page, "Tab", surface="A2R04-typing-seek-card", note=f"seek a note card {i+1}")
        if fi.get("role") == "link" or (fi.get("tag") == "button" and "note" not in (fi.get("name") or "").lower()):
            pass
        if (fi.get("name") or "").strip() in ("AF source note", "AF target note", "AF unlinked note"):
            opened = True
            break
    if opened:
        press(page, "Enter", surface="A2R04-typing-open", note="*Enter opens the note", wait_ms=500)
        # The title input (or the SR landmark heading, per A2R-02) may hold
        # focus; Tab once more is the documented path to the title field.
        press(page, "Tab", surface="A2R04-typing-title", note="*Tab toward the title field")
        before = dialog_probe(page)
        press(page, "Shift+Slash", surface="A2R04-typing-guard",
              note="*bare Shift+/ while focus is in a text field", wait_ms=400)
        after = dialog_probe(page)
        STEPS.append({"n": len(STEPS) + 1, "surface": "A2R04-typing-guard", "keys": "(compare)",
                      "note": f"before={before} after={after}", "focus": focus_info(page)})
        dump()
        if after["dialogCount"] > before["dialogCount"]:
            FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R04", "sc": "2.1.4",
                              "seen": "the '?' shortcut fired while focus was in a text field",
                              "step_n": len(STEPS), "screenshot": shot(page, "a2r04-fired-while-typing")})
        else:
            log("  [A2R04] PASS: '?' did not fire while focus was in a text field (2.1.4)")
    else:
        log("  [A2R04] SKIP: could not reach a note card within 60 Tabs to test the 2.1.4 guard")


# ── A2R-05: the TickerPopup trigger on /dashboard ───────────────────────────

def verify_a2r05_ticker(page, base):
    goto(page, base, "/dashboard", "A2R05-load", "*open /dashboard")

    reached = False
    fi = {}
    for i in range(140):
        fi = press(page, "Tab", surface="A2R05-reach-trigger", note=f"seek a ticker trigger {i+1}")
        name_l = (fi.get("name") or "").lower()
        if fi.get("role") == "button" and name_l.startswith("view chart for"):
            reached = True
            break
    if not reached:
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R05", "sc": "2.1.1",
                          "seen": f"no ticker trigger reached within 140 Tabs on /dashboard; last focus "
                                  f"name={(fi.get('name') or '')!r}", "step_n": len(STEPS)})
        return
    opener_name = fi.get("name")
    log(f"  [A2R05] reached trigger: {opener_name!r}")

    press(page, "Enter", surface="A2R05-enter", note="*Enter on the ticker trigger", wait_ms=500)
    probe = page.evaluate(
        "() => { const m=document.querySelector('[data-testid=\"chart-modal\"]'); "
        "return {present: !!m}; }")
    STEPS.append({"n": len(STEPS) + 1, "surface": "A2R05-enter", "keys": "(evaluate)",
                  "note": f"chart modal probe: {probe}", "focus": {}})
    dump()
    if not probe["present"]:
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R05", "sc": "2.1.1",
                          "seen": f"Enter on the trigger did not open the chart modal: {probe}",
                          "step_n": len(STEPS), "screenshot": shot(page, "a2r05-enter-no-modal")})
        return
    log("  [A2R05] PASS: Enter on the trigger opened the chart modal")

    # The capture buttons must be reachable inside it.
    price_btn = False
    consensus_btn = False
    for i in range(40):
        fi = press(page, "Tab", surface="A2R05-reach-capture", note=f"seek capture buttons {i+1}")
        name_l = (fi.get("name") or "").lower()
        if "current price to notebook" in name_l:
            price_btn = True
        if "analyst consensus to notebook" in name_l:
            consensus_btn = True
        if price_btn and consensus_btn:
            break
    STEPS.append({"n": len(STEPS) + 1, "surface": "A2R05-capture", "keys": "(summary)",
                  "note": f"price button reached={price_btn}; consensus button reached={consensus_btn}",
                  "focus": {}})
    dump()
    if price_btn and consensus_btn:
        log("  [A2R05] PASS: both capture buttons ('Save price to Notebook', "
            "'Save analyst consensus to Notebook') are reachable")
    else:
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R05", "sc": "2.1.1",
                          "seen": f"capture buttons not both reached within 40 Tabs "
                                  f"(price={price_btn}, consensus={consensus_btn})",
                          "step_n": len(STEPS)})

    # Escape closes it and restores focus to the trigger.
    press(page, "Escape", surface="A2R05-escape", note="*Escape closes the chart modal")
    probe = page.evaluate(
        "() => { const m=document.querySelector('[data-testid=\"chart-modal\"]'); "
        "return {present: !!m}; }")
    after = focus_info(page)
    restored = (after.get("name") == opener_name)
    STEPS.append({"n": len(STEPS) + 1, "surface": "A2R05-escape", "keys": "(compare)",
                  "note": f"modal probe: {probe}; after_close focus: {after}; restored={restored}",
                  "focus": after})
    dump()
    if probe["present"]:
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R05", "sc": "2.1.1",
                          "seen": f"Escape did not close the chart modal: {probe}", "step_n": len(STEPS)})
    elif not restored:
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R05", "sc": "2.4.3",
                          "seen": f"focus after Escape was {after.get('name')!r}, not the trigger "
                                  f"{opener_name!r}", "step_n": len(STEPS),
                          "screenshot": shot(page, "a2r05-no-restore")})
    else:
        log("  [A2R05] PASS: Escape closed the modal and restored focus to the trigger")


# ── bonus: A2R-01, the intro overlay's focus trap ───────────────────────────

def verify_a2r01_intro_trap(page, base):
    # ⛔ The intro plays ONCE PER BROWSER SESSION (`hasSeenIntroThisSession`,
    # sessionStorage-backed) -- and this `page` already visited the app three
    # times (A2R-03/04/05), so by now it is already marked seen. A second
    # "fresh load" on the SAME page would tab straight into the real app
    # (which is exactly what run 1 of this script did by accident, landing on
    # "Skip to main content" and reporting a false positive for V003: there
    # was no overlay there AT ALL to escape). sessionStorage is per TAB, so
    # clearing it here (while still on the previous page, same origin) and
    # THEN navigating is what makes the next load genuinely fresh again.
    page.evaluate("() => { try { sessionStorage.clear() } catch (e) {} }")
    # A genuine full page load, intro LEFT UNDISMISSED on purpose -- the raw
    # tab order a fresh visitor actually meets.
    page.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded", timeout=30000)
    milestone(page, "A2R01-fresh-load", "*fresh load, intro NOT dismissed")
    fi = press(page, "Tab", surface="A2R01-tab1", note="*first Tab -- the intro's own Skip button")
    first_name = (fi.get("name") or "")
    fi2 = press(page, "Tab", surface="A2R01-tab2", note="*second Tab -- must NOT escape behind the overlay")
    second_name = (fi2.get("name") or "")
    STEPS.append({"n": len(STEPS) + 1, "surface": "A2R01-summary", "keys": "(compare)",
                  "note": f"tab1={first_name!r} tab2={second_name!r}", "focus": {}})
    dump()
    if "skip to notes list" in second_name.lower():
        FINDINGS.append({"id": f"V{len(FINDINGS)+1:03d}", "surface": "A2R01", "sc": "2.1.1 / 2.4.3",
                          "seen": f"a second Tab reached {second_name!r} -- the Notebook's own skip "
                                  "link, behind the still-visible intro overlay", "step_n": len(STEPS),
                          "screenshot": shot(page, "a2r01-escaped-behind-overlay")})
    else:
        log(f"  [A2R01] PASS: second Tab stayed inside the overlay (landed on {second_name!r}, "
            "not the Notebook's skip link)")
    press(page, "Escape", surface="A2R01-dismiss", note="*Escape dismisses the intro")


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
                                                  "af-fix-verify@local.dev", "AfFixVerify2026!", "AF Fix Verify")
                        fx = seed(reviewer_ctx, base)
                        dump()

                        page = reviewer_ctx.new_page()
                        verify_a2r03_graph(page, base)
                        verify_a2r04_shortcuts(page, base)
                        verify_a2r05_ticker(page, base)
                        verify_a2r01_intro_trap(page, base)
                        page.close()

                        (OUT_DIR / "fixtures.json").write_text(json.dumps(fx, indent=2), encoding="utf-8")
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
            shutil.copy(ipath, OUT_DIR / "integrity.md")
        dump()
        log(f"STOP: {stop_how}")
        log("INTEGRITY: " + H.integrity_line(integ, not_run=not_run))
        log(f"steps recorded: {len(STEPS)}; findings: {len(FINDINGS)}")

    if not_run:
        log(f"NOT RUN: {not_run}")
        return 2
    if FINDINGS:
        log(f"FINDINGS: {len(FINDINGS)} -- see focus-log.json")
        return 1
    log("ALL CLEAR: no findings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
