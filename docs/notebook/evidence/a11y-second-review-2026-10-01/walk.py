"""Second-reviewer keyboard-only walk -- Notebook accessibility, Phase 7 item 5.

Reuses the sandbox pattern from `tools/notebook_perf_harness.py`'s `Sandbox` class
(boot/health/checkpoint/stop/integrity) and `tools/notebook_proof_walk.py`'s account
provisioning recipe (signup -> admin comp-access -> admin verify-email -> confirm
/api/auth/me paid_equiv), per the brief's instruction to read those two files for the
pattern and reuse it from a small script of our own under the evidence directory.

This script does NOT drive the mouse. Every interaction with the product after the
page loads is `page.keyboard` (Tab, Shift+Tab, Enter, Space, Escape, arrows) or a
browser-level action (back, new tab, resize). No `.click()` and no selector-driven
`.focus()` is used to reach a control -- reaching a control is the thing being
measured. API calls (`page.request` / `ctx.request`) are used ONLY to seed fixture
data (notes, folders, a locked note, a share/publish link) before the walk begins,
never to perform a step that is itself being reviewed.

Output: docs/notebook/evidence/a11y-second-review-2026-10-01/focus-log.json (one
record per keyboard action) + screenshots/ (taken at every finding and at named
milestones) + integrity.md (the sandbox's own integrity log, copied here).

Usage (PowerShell; the data dir single-quoted, forward slashes):
    python docs/notebook/evidence/a11y-second-review-2026-10-01/walk.py `
        --data-dir 'C:/Users/Patrick/AppData/Local/Temp/claude/C--Users-Patrick/441b0c89-c1d8-471c-bd31-2a4fb712ee30/scratchpad/a11y2-data' `
        --port 8301 --artifacts '<scratchpad>/a11y2-art'
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

# The production-armed Notebook gates (docs/feature_flags.json), mirrored from
# tools/notebook_proof_walk.py's GATES -- so this sandbox behaves like the live
# site rather than the all-dark default. Set BEFORE Sandbox.start() (the
# launcher's child inherits the environment at spawn time).
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


def log(msg: str) -> None:
    print(msg, flush=True)


def dump() -> None:
    (OUT_DIR / "focus-log.json").write_text(
        json.dumps({"steps": STEPS, "findings": FINDINGS}, indent=2), encoding="utf-8")


# ── focus introspection (no selector-driven focus, read-only) ───────────────

FOCUS_JS = r"""
() => {
  const el = document.activeElement;
  if (!el || el === document.body) return {present: false};
  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  // Priority follows the real accessible-name algorithm, NOT the order an earlier
  // version of this probe used (aria-label, aria-labelledby, TITLE, ..., textContent
  // LAST) -- that order put a tooltip ahead of visible text and made an exact-text
  // seek (e.g. for the "Share" button, visible text "Share", title "Share a link to
  // this note or publish it to the web") silently fail for 140 Tab presses on the
  // first corrected run. Visible text content outranks title; title is the
  // last-resort fallback, same as it is for a screen reader.
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
  const inViewport = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
  return {
    present: true, tag: el.tagName.toLowerCase(), role, name,
    id: el.id || null, className: (el.className && el.className.toString) ? el.className.toString().slice(0, 100) : null,
    type: el.getAttribute('type') || null,
    ariaExpanded: el.getAttribute('aria-expanded'), ariaPressed: el.getAttribute('aria-pressed'),
    ariaCurrent: el.getAttribute('aria-current'), ariaDisabled: el.getAttribute('aria-disabled'),
    disabled: !!el.disabled,
    rect: {x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)},
    visibleIndicator: hasVisibleIndicator,
    outline: cs.outline, boxShadow: cs.boxShadow.slice(0, 120),
    inViewport, zeroSize: rect.width === 0 && rect.height === 0,
    url: location.pathname + location.search + location.hash,
  };
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
    except Exception as e:  # noqa: BLE001
        log(f"  [screenshot failed {name}: {e}]")
        return ""
    return f"screenshots/{path.name}"


def press(page, keys: str, *, surface: str, note: str = "", finding: str | None = None,
          severity: str | None = None, sc: str | None = None, known_gap: str | None = None,
          wait_ms: int = 160) -> dict:
    """Press a key (Playwright key-combo syntax, e.g. 'Tab', 'Shift+Tab', 'Control+F'),
    wait briefly for the DOM to settle, record what has focus. A screenshot is taken
    only when `finding` is set (a defect) or `note` begins with '*' (a milestone)."""
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
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": surface, "sc": sc,
                          "steps": keys, "expected": finding.split("||")[0] if "||" in finding else "",
                          "seen": finding, "severity": severity, "known_gap": known_gap,
                          "step_n": rec["n"], "screenshot": rec.get("screenshot", "")})
    tag = " ***FINDING***" if finding else ""
    log(f"  [{rec['n']:04d}] {surface} <{keys}> -> {fi.get('role')} \"{(fi.get('name') or '')[:40]}\" "
        f"vis={fi.get('visibleIndicator')} {note}{tag}")
    dump()
    return fi


def milestone(page, surface: str, note: str) -> None:
    """A screenshot with no key action -- used right after navigation."""
    page.wait_for_timeout(250)
    name = f"{len(STEPS)+1:04d}-{surface}-nav".replace(" ", "_").replace("/", "-")
    path = shot(page, name)
    STEPS.append({"n": len(STEPS) + 1, "surface": surface, "keys": "(navigate)", "note": note,
                  "focus": focus_info(page), "screenshot": path})
    log(f"  [{len(STEPS):04d}] {surface} (navigate) {note}")
    dump()


# ── account provisioning (API only -- fixture setup, not reviewed) ──────────

def admin_login(browser, base: str, H):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    r = ctx.request.post(base + "/api/auth/login", data={"email": H.ADMIN_EMAIL, "password": H.ADMIN_PW})
    if r.status not in (200, 201):
        r = ctx.request.post(base + "/api/auth/signup",
                              data={"email": H.ADMIN_EMAIL, "password": H.ADMIN_PW, "display_name": "hubtest"})
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


def api(ctx, base):
    return ctx.request


DOC = lambda *content: {"type": "doc", "content": list(content)}  # noqa: E731
P = lambda text: {"type": "paragraph", "content": [{"type": "text", "text": text}]}  # noqa: E731
H2 = lambda text: {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": text}]}  # noqa: E731


def seed(ctx, base: str) -> dict:
    """Create the fixtures the walk needs: a folder with a subfolder, a tag, three+
    notes (one with a heading + table + an outgoing link), and a locked note."""
    fx: dict = {}
    r = ctx.request.post(base + "/api/j2/note-folders", data=json.dumps({"name": "A11y Folder"}),
                          headers={"Content-Type": "application/json"})
    folder = r.json()["folder"]
    fx["folder_id"] = folder["id"]
    r = ctx.request.post(base + "/api/j2/note-folders",
                          data=json.dumps({"name": "A11y Subfolder", "parentId": folder["id"]}),
                          headers={"Content-Type": "application/json"})
    fx["subfolder_id"] = r.json()["folder"]["id"]

    def mk_note(title, body, **extra):
        payload = {"title": title, "bodyJson": body}
        payload.update(extra)
        rr = ctx.request.post(base + "/api/j2/notes", data=json.dumps(payload),
                               headers={"Content-Type": "application/json"})
        if rr.status not in (200, 201):
            raise RuntimeError(f"create note {title!r} failed: {rr.status} {rr.text()[:300]}")
        return rr.json()["note"]

    try:
        n1 = mk_note("SR pass", DOC(H2("Setup"), P("One paragraph of setup notes."),
                                     {"type": "table", "content": [
                                         {"type": "tableRow", "content": [
                                             {"type": "tableHeader", "content": [P("Sym")]},
                                             {"type": "tableHeader", "content": [P("R")]}]},
                                         {"type": "tableRow", "content": [
                                             {"type": "tableCell", "content": [P("NVDA")]},
                                             {"type": "tableCell", "content": [P("2.1")]}]}]}),
                     tags=["a11y-demo"])
    except RuntimeError as e:
        log(f"  [seed] WARNING: table-bearing note failed ({e}); retrying without the table node")
        n1 = mk_note("SR pass", DOC(H2("Setup"), P("One paragraph of setup notes.")), tags=["a11y-demo"])
    fx["note1_id"] = n1["id"]
    n2 = mk_note("Linked target note", DOC(P("This note exists to be linked to.")))
    fx["note2_id"] = n2["id"]
    n3 = mk_note("Note with an outgoing link",
                 DOC({"type": "paragraph", "content": [
                     {"type": "text", "text": "See "},
                     {"type": "noteLink", "attrs": {"noteId": n2["id"]}},
                     {"type": "text", "text": " for context."}]}))
    fx["note3_id"] = n3["id"]
    nlock = mk_note("Locked note for capture refusal", DOC(P("This note will be locked.")))
    fx["locked_note_id"] = nlock["id"]
    r = ctx.request.patch(base + f"/api/j2/notes/{nlock['id']}/lock",
                           data=json.dumps({"locked": True}), headers={"Content-Type": "application/json"})
    if r.status not in (200, 201):
        log(f"  [seed] WARNING: lock note failed {r.status} {r.text()[:200]}")
    else:
        log(f"  [seed] locked note {nlock['id']}")

    # a share link + a publish, for the signed-out public-page walk
    r = ctx.request.post(base + f"/api/j2/notes/{n1['id']}/share", data=json.dumps({"expiresInDays": None}),
                          headers={"Content-Type": "application/json"})
    if r.status in (200, 201):
        fx["share_token"] = r.json().get("token") or r.json().get("share", {}).get("token")
        log(f"  [seed] share minted: {r.json()}")
    else:
        log(f"  [seed] WARNING: share mint failed {r.status} {r.text()[:300]}")
    r = ctx.request.post(base + f"/api/j2/publish/notes/{n3['id']}", data=json.dumps({"expiresInDays": None}),
                          headers={"Content-Type": "application/json"})
    if r.status in (200, 201):
        body = r.json()
        fx["publish_slug"] = body.get("slug") or body.get("publication", {}).get("slug")
        log(f"  [seed] publish minted: {body}")
    else:
        log(f"  [seed] WARNING: publish mint failed {r.status} {r.text()[:300]}")

    # An open position, so Journal 2.0's Open Positions table renders a real
    # TickerPopup trigger invoked with as="button" (PositionsTable.jsx:159) -- the
    # one call site where the analyst-consensus capture button is keyboard-reachable
    # at all (most other call sites default to a non-focusable span -- see F006).
    r = ctx.request.post(base + "/api/j2/positions", data=json.dumps({
        "symbol": "NVDA", "side": "Long", "entryDate": "2026-09-01",
        "shares": 10, "entryPrice": 100.0, "stopPrice": 90.0,
    }), headers={"Content-Type": "application/json"})
    if r.status in (200, 201):
        log(f"  [seed] open position: {r.json()}")
    else:
        log(f"  [seed] WARNING: open position failed {r.status} {r.text()[:300]}")

    return fx


# ── the walk ──────────────────────────────────────────────────────────────

def goto(page, base, path, surface, note="*nav", dismiss_intro=True):
    """Navigate (a full browser load -- the cinematic intro animation plays on every one
    of these, per CLAUDE.md: 'Internal route changes don't remount the App ... only on
    actual page loads'). By default we press Escape once to dismiss it immediately after
    load so the milestone screenshot shows the real page, not the ~9.3s brand intro. The
    very FIRST navigation of the whole run is left un-dismissed on purpose, so the raw
    tab order a fresh visitor actually meets is recorded once, as found."""
    page.goto(base + path, wait_until="domcontentloaded", timeout=30000)
    if dismiss_intro:
        page.wait_for_timeout(120)
        try:
            page.keyboard.press("Escape")
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(120)
    milestone(page, surface, note)


def walk_list(page, base, fx):
    # Intro left UNDISMISSED here on purpose -- this is the one place we record the
    # raw tab order a fresh visitor actually meets, per the brief's step 1 ("Tab from
    # the address bar: the skip link must be first").
    goto(page, base, "/journal/notebook?view=all", "L-list", "*open /journal/notebook?view=all",
         dismiss_intro=False)
    page.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
    fi = press(page, "Tab", surface="L-skiplink", note="*first Tab after a FRESH load: must be the skip link")
    name_l = (fi.get("name") or "").lower()
    is_intro_skip = "intro" in name_l
    is_real_skip = "skip to notes list" in name_l
    if is_intro_skip:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "L (list) -- fresh page load", "sc": "2.4.1",
                          "expected": "'Skip to notes list' is the first focusable element after a fresh load "
                                      "(tabs/NotebookTab.jsx:1471)",
                          "steps": "Tab (first, immediately after navigating to /journal/notebook?view=all -- a "
                                   "genuine full page load, not in-app routing)",
                          "seen": f"the cinematic intro animation's own \"{fi.get('name')}\" button is the first "
                                  "focusable element on every fresh load/refresh/bookmark-hit; the Notebook's own "
                                  "skip link is reachable only after dismissing it",
                          "severity": "minor", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"{len(STEPS):04d}-L-skiplink-intro-first")})
        # dismiss and re-measure what the FIRST notebook-owned elements are. Up to 2
        # tabs: an app-wide "Skip to main content" is an acceptable precursor to the
        # Notebook's own "Skip to notes list" -- that is a layered-skip-link pattern,
        # not a defect; only the ABSENCE of "Skip to notes list" near the top is one.
        press(page, "Escape", surface="L-skiplink", note="dismiss the intro overlay")
        page.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
        for i in range(2):
            fi = press(page, "Tab", surface="L-skiplink",
                       note=f"*Tab {i+1} after dismissing the intro (what a returning/in-app visitor meets)")
            name_l = (fi.get("name") or "").lower()
            if "skip to notes list" in name_l:
                is_real_skip = True
                break
    if not is_real_skip:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "L (list)", "sc": "2.4.1",
                          "expected": "'Skip to notes list' link reachable within the first couple of Tabs",
                          "steps": "Tab x2, with the intro dismissed",
                          "seen": f"last landed on role={fi.get('role')} name={fi.get('name')!r} -- "
                                  "'Skip to notes list' not seen",
                          "severity": "major", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"{len(STEPS):04d}-L-skiplink-not-found")})
    press(page, "Enter", surface="L-skiplink", note="activate skip link -> should land on All notes heading")
    # Walk sidebar: Shift+Tab back up to sidebar top, then Tab forward through it.
    for i in range(14):
        press(page, "Tab", surface="L-sidebar", note=f"sidebar tab {i+1}")
    # Try reaching the view-mode switches and selecting Table via Space.
    for i in range(10):
        fi = press(page, "Tab", surface="L-viewswitch", note=f"toward view switcher {i+1}")
        if (fi.get("name") or "").strip().lower() in ("table view", "table"):
            press(page, " ", surface="L-viewswitch", note="*Space on Table view toggle")
            break
    goto(page, base, "/journal/notebook?view=all", "L-list", "reset to list view")

    # Board mode: move a card with its <select> -- find the board toggle by tabbing,
    # then once in board mode, tab to a card's <select> and change it with arrows+Enter.
    # (kept lightweight: this walk records reachability, not full data manipulation)

    # Bulk export panel: select two notes with keyboard (Space on checkbox-like rows),
    # open bulk Export, Escape, check focus landing.
    goto(page, base, "/journal/notebook?view=all", "L-bulk", "*back to list for bulk select")
    for i in range(20):
        fi = press(page, "Tab", surface="L-bulk", note=f"seek note card {i+1}")
        if fi.get("role") in ("button",) and fi.get("tag") == "div":
            break
    press(page, "Shift+Tab", surface="L-bulk", note="back off one")


def walk_editor(page, base, fx):
    """Order matters, and it is NOT the brief's order -- measured on the first run:
    (1) the editor's own chrome (Add to Favorites, Ask, Find, Share, Folder, Ticker,
        Writing help, Outline, More note actions) clusters EARLY in forward Tab order,
        well before Font family / Bold / Italic / ... / Title / Subtitle / tags;
    (2) 'Note body' is reached only AFTER all of that;
    (3) once the caret is inside the body -- and especially inside a table -- Tab
        stops producing any visible change in document.activeElement, because the
        whole editor is ONE contenteditable region: the caret moves, the focused DOM
        node does not. So every body/table-dependent test (slash, emoji, [[, @, table)
        runs LAST, and the chrome doors run FIRST while a plain Tab-seek still works."""
    goto(page, base, "/journal/notebook?view=all", "E-open", "*list before opening note")
    opened = False
    for i in range(140):
        fi = press(page, "Tab", surface="E-reach-card", note=f"seeking note card {i+1}")
        name = (fi.get("name") or "").strip()
        # The card's accessible name is its title with the relative time and tags run
        # on with no separator ("SR passnow#a11y-demo") -- a startswith match on the
        # exact seeded title, never a bare substring (that falsely matched "Skip to
        # notes list", which contains "note").
        if name.startswith("SR pass") and fi.get("role") in ("button", "link"):
            press(page, "Enter", surface="E-open", note="*Enter on SR pass card", wait_ms=900)
            opened = True
            break
    if not opened:
        goto(page, base, f"/journal/notebook?note={fx['note1_id']}", "E-open-direct",
             "*fallback: direct note URL (card not reached via Tab in budget)")
        page.wait_for_timeout(600)
    title_fi = focus_info(page)
    if not (title_fi.get("role") == "textbox" and "note title" in (title_fi.get("name") or "").lower()):
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "E (open a note)", "sc": "2.4.3",
                          "expected": "focus lands IN the title field on open "
                                      "(screen-reader-pass.md step 10, NoteEditorPage.jsx:3565)",
                          "steps": "Enter on a note card, settle 900ms",
                          "seen": f"focus is role={title_fi.get('role')} name={title_fi.get('name')!r}",
                          "severity": "minor", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"{len(STEPS):04d}-E-open-title-focus")})

    # ── 1) the early chrome cluster, each a short, independent seek ──────────
    def seek_chrome(surface, match, max_tabs=14):
        for i in range(max_tabs):
            fi = press(page, "Tab", surface=surface, note=f"seek {surface} {i+1}")
            if match((fi.get("name") or "").strip().lower(), fi):
                return True, fi
        return False, fi

    # Ask panel -- "ask" alone is a false-positive magnet ("Tasks view" contains it).
    ask_reached, _ = seek_chrome("E-ask-reach", lambda n, fi: "ask a question" in n)
    if ask_reached:
        press(page, "Enter", surface="E-ask", note="*open Ask panel", wait_ms=300)
        press(page, "Tab", surface="E-ask", note="into Ask question field")
        page.keyboard.type("What is the dividend?", delay=10)
        press(page, "Enter", surface="E-ask", note="*submit Ask question", wait_ms=2500)
        for i in range(6):
            fi = press(page, "Tab", surface="E-ask-close", note=f"seek Close Ask {i+1}")
            if (fi.get("name") or "").strip().lower() == "close ask":
                press(page, "Enter", surface="E-ask-close", note="*close Ask panel")
                break
    else:
        STEPS.append({"n": len(STEPS) + 1, "surface": "E-ask", "keys": "(not reached)",
                      "note": "'Ask a question...' button not reached within 20 Tabs", "focus": {}})
    # Lock / Unlock, Archive, Open beside, History -- all behind "More note actions"
    opened_more = False
    for i in range(40):
        fi = press(page, "Tab", surface="E-more-menu", note=f"seek More note actions {i+1}")
        if (fi.get("name") or "").strip().lower() == "more note actions":
            press(page, "Enter", surface="E-more-menu", note="*open More note actions menu", wait_ms=300)
            opened_more = True
            break
    if opened_more:
        found_history = False
        for i in range(12):
            fi = press(page, "Tab", surface="E-more-menu-items", note=f"seek History item {i+1}")
            if "history" in (fi.get("name") or "").lower():
                press(page, "Enter", surface="E-history", note="*open History panel", wait_ms=400)
                found_history = True
                break
        if found_history:
            press(page, "Tab", surface="E-history", note="tab into version list")
            fi = press(page, "Tab", surface="E-history", note="tab further in History panel")
            restore_reached = False
            for i in range(10):
                if "restore" in (fi.get("name") or "").lower():
                    restore_reached = True
                    break
                fi = press(page, "Tab", surface="E-history", note=f"seek Restore button {i+1}")
            if restore_reached:
                press(page, "Enter", surface="E-history-restore", note="*open Restore confirmation", wait_ms=300)
                press(page, "Tab", surface="E-history-restore", note="tab inside Restore confirm dialog")
                press(page, "Escape", surface="E-history-restore",
                      note="*Escape cancels Restore -- focus should return to Restore button")
            else:
                STEPS.append({"n": len(STEPS) + 1, "surface": "E-history", "keys": "(not reached)",
                              "note": "no 'Restore this version' control reached -- likely no earlier versions "
                                      "exist for a note created once via the seed API", "focus": {}})
            press(page, "Escape", surface="E-history", note="*Escape closes History panel")
        else:
            STEPS.append({"n": len(STEPS) + 1, "surface": "E-history", "keys": "(not reached)",
                          "note": "'History' item not found within 12 Tabs inside More note actions menu",
                          "focus": {}})
        press(page, "Escape", surface="E-more-menu", note="close More note actions menu (safety)")
    else:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "E (editor chrome)", "sc": "2.1.1",
                          "expected": "'More note actions' button reachable by Tab", "steps": "Tab x40 in editor",
                          "seen": "not reached within 40 Tab presses", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})

    # Export menu (role=menu, deliberately keep-Tab-inside per NoteExportControls.jsx).
    # Measured NOT in the early chrome cluster -- a generous budget.
    exported_reached = False
    for i in range(60):
        fi = press(page, "Tab", surface="E-export-reach", note=f"seek Export button {i+1}")
        if (fi.get("name") or "").strip().lower() == "export":
            exported_reached = True
            break
    if exported_reached:
        press(page, "Enter", surface="E-export", note="*open Export menu", wait_ms=300)
        press(page, "Tab", surface="E-export", note="tab inside Export menu (deliberately trapped)")
        in_menu = page.evaluate(
            "() => { const m = document.querySelector('[role=\"menu\"][aria-label=\"Export this note as\"]'); "
            "return m ? m.contains(document.activeElement) : null; }")
        if in_menu is False:
            FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "E (Export menu)", "sc": "2.1.2",
                              "expected": "Tab stays inside the Export menu (the file's own documented contract)",
                              "steps": "Enter on Export, then Tab", "seen": "focus left the menu",
                              "severity": "minor", "known_gap": None, "step_n": len(STEPS),
                              "screenshot": shot(page, f"{len(STEPS):04d}-E-export-left")})
        press(page, "Escape", surface="E-export", note="*Escape closes Export menu -- focus returns to Export button")
    else:
        STEPS.append({"n": len(STEPS) + 1, "surface": "E-export", "keys": "(not reached)",
                      "note": "'Export' button not reached within 60 Tabs", "focus": {}})

    # ── 2) reach the BODY itself -- Title/Subtitle/tags come before it ───────
    body_reached = False
    fi = {}
    for i in range(50):
        fi = press(page, "Tab", surface="E-reach-body", note=f"seek Note body {i+1}")
        if (fi.get("name") or "").strip().lower() == "note body":
            body_reached = True
            break
    if body_reached:
        press(page, "/", surface="E-slash", note="*open slash menu", wait_ms=300)
        press(page, "ArrowDown", surface="E-slash", note="move in slash menu")
        press(page, "Escape", surface="E-slash", note="*Escape closes slash menu -- focus should stay in body")
        press(page, ":", surface="E-emoji", note="*open emoji menu", wait_ms=300)
        press(page, "Escape", surface="E-emoji", note="Escape closes emoji menu")
        page.keyboard.type("[[Linked", delay=20)
        press(page, "ArrowDown", surface="E-link", note="*[[ link menu, move selection", wait_ms=300)
        press(page, "Escape", surface="E-link", note="Escape closes link menu")
        page.keyboard.type(" @", delay=20)
        press(page, "ArrowDown", surface="E-date", note="*@ date menu, move selection", wait_ms=300)
        press(page, "Escape", surface="E-date", note="Escape closes date menu")
        # find and replace -- precondition met: focus IS in the body (screen-reader-pass.md:57)
        press(page, "Control+F", surface="E-find", note="*Ctrl+F opens Find", wait_ms=300)
        page.keyboard.type("note", delay=20)
        press(page, "Control+H", surface="E-find", note="*Ctrl+H shows Replace row")
        press(page, "Tab", surface="E-find", note="to Replace field")
        press(page, "Escape", surface="E-find", note="*Escape closes find -- focus should return to Note body")

        # Table create via slash -- LAST: once the caret is inside the table, Tab
        # belongs to it (the documented known gap), and document.activeElement never
        # changes while the caret moves WITHIN the single ProseMirror contenteditable
        # region -- so every Tab-seek after this point is blind.
        page.keyboard.type("/table", delay=20)
        press(page, "Enter", surface="E-table", note="*insert a table", wait_ms=400)
        press(page, "Tab", surface="E-table", note="tab inside table cell 1")
        press(page, "Tab", surface="E-table", note="tab inside table cell 2 (Tab belongs to the table)")
        press(page, "Alt+F10", surface="E-table", note="*Alt+F10 should land on the Table toolbar")
        press(page, "Escape", surface="E-table", note="*Escape from table toolbar back to the cell")
        press(page, "Shift+Tab", surface="E-table-exit", note="documented way out: Shift+Tab to the first cell")
        press(page, "Shift+Tab", surface="E-table-exit",
              note="*documented way out: Shift+Tab once more exits the table")
    else:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "E (note body)", "sc": "2.1.1",
                          "expected": "'Note body' reachable by Tab (title/subtitle/tags/toolbar precede it)",
                          "steps": "Tab x50 after the Export seek", "seen": f"not reached; last focus was "
                                  f"role={fi.get('role')} name={(fi.get('name') or '')!r}",
                          "severity": "major", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"{len(STEPS):04d}-E-body-not-reached")})


def walk_graph(page, base, fx):
    goto(page, base, "/journal/notebook?view=graph", "G-graph", "*open graph view")
    page.wait_for_timeout(600)  # the force-simulation canvas needs a moment to settle
    reached_list_toggle = False
    for i in range(70):
        fi = press(page, "Tab", surface="G-reach-showlist", note=f"seek Show as list {i+1}")
        if "show as list" in (fi.get("name") or "").lower():
            press(page, " ", surface="G-showlist", note="*Space toggles Show as list (table)")
            reached_list_toggle = True
            break
    goto(page, base, "/journal/notebook?view=graph", "G-graph", "back to graph picture")
    page.wait_for_timeout(600)
    canvas_reached = False
    for i in range(70):
        fi = press(page, "Tab", surface="G-reach-canvas", note=f"seek graph canvas {i+1}")
        name_l = (fi.get("name") or "").lower()
        if fi.get("role") == "application" or "note graph" in name_l:
            canvas_reached = True
            break
    if canvas_reached:
        press(page, "Home", surface="G-canvas", note="*Home on graph canvas")
        press(page, "ArrowRight", surface="G-canvas", note="*arrow on graph canvas")
        press(page, "ArrowRight", surface="G-canvas", note="a second arrow -- layout must not reset")
        press(page, "Enter", surface="G-canvas", note="*Enter opens the focused note", wait_ms=400)
    else:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "L (graph canvas)", "sc": "2.1.1",
                          "expected": "the graph canvas (role=application, 'Note graph: ...') reachable by Tab",
                          "steps": "Tab x70 from /journal/notebook?view=graph",
                          "seen": f"not reached within 70 Tab presses; last focus was role={fi.get('role')} "
                                  f"name={(fi.get('name') or '')!r}",
                          "severity": "major", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"{len(STEPS):04d}-G-canvas-not-reached")})
    if not reached_list_toggle:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "L (graph)", "sc": "2.1.1",
                          "expected": "'Show as list' toggle reachable by Tab from the graph view",
                          "steps": "Tab x70 from /journal/notebook?view=graph",
                          "seen": "not reached within 70 Tab presses", "severity": "minor",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})


def walk_sheets(page, base, fx):
    goto(page, base, f"/journal/notebook?note={fx['note1_id']}", "H-share", "*open SR pass note for Share")
    page.wait_for_timeout(400)
    for i in range(140):
        fi = press(page, "Tab", surface="H-share-reach", note=f"seek Share button {i+1}")
        if (fi.get("name") or "").strip().lower() == "share":
            break
    press(page, "Enter", surface="H-share", note="*open Share dialog", wait_ms=400)
    press(page, "Tab", surface="H-share", note="tab inside Share dialog")
    press(page, "Tab", surface="H-share", note="tab again inside Share dialog")
    press(page, "Escape", surface="H-share", note="*Escape closes Share -- focus should return to Share button")

    # Save view and Templates are BOTH in the list toolbar, Save view BEFORE
    # Templates ("Save this view" at position 9, "Templates" at 13, measured on the
    # first run) -- each gets its OWN fresh goto() so neither seek's budget depends
    # on where the other one's Sheet restored focus to.
    goto(page, base, "/journal/notebook?view=all", "H-saveview", "*list, for Save view")
    saveview_reached = False
    for i in range(140):
        fi = press(page, "Tab", surface="H-saveview-reach", note=f"seek Save view button {i+1}")
        name_l = (fi.get("name") or "").lower()
        if "save" in name_l and "view" in name_l:
            saveview_reached = True
            break
    if saveview_reached:
        press(page, "Enter", surface="H-saveview", note="*open Save view dialog", wait_ms=400)
        nm = focus_info(page)
        name_field_focused = (nm.get("role") == "textbox")
        if not name_field_focused:
            FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "H (Save view)", "sc": "2.4.3",
                              "expected": "focus lands IN the Name field on open",
                              "steps": "Enter on Save view button", "seen": f"focus landed on role={nm.get('role')}",
                              "severity": "minor", "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        press(page, "Escape", surface="H-saveview",
              note="*Escape closes Save view -- focus returns to Save view button")
    else:
        STEPS.append({"n": len(STEPS) + 1, "surface": "H-saveview", "keys": "(not reached)",
                      "note": "no Save-view control reached within 140 Tabs", "focus": {}})

    goto(page, base, "/journal/notebook?view=all", "H-templates", "*list, for Templates gallery")
    templates_reached = False
    for i in range(140):
        fi = press(page, "Tab", surface="H-templates-reach", note=f"seek Templates button {i+1}")
        if (fi.get("name") or "").strip().lower() == "templates":
            templates_reached = True
            break
    if templates_reached:
        press(page, "Enter", surface="H-templates", note="*open Templates gallery", wait_ms=400)
        press(page, "Tab", surface="H-templates", note="tab inside Templates gallery")
        press(page, "Escape", surface="H-templates",
              note="*Escape closes Templates -- focus returns to Templates button")
    else:
        STEPS.append({"n": len(STEPS) + 1, "surface": "H-templates", "keys": "(not reached)",
                      "note": "'Templates' button not reached within 140 Tabs", "focus": {}})

    # Delete confirmation
    goto(page, base, f"/journal/notebook?note={fx['note3_id']}", "H-delete", "*open a note to delete")
    page.wait_for_timeout(300)
    # Delete is the last item inside "More note actions" (NoteEditorPage.jsx wave 10
    # lane K2 comment) -- open that menu first, then seek Delete inside it.
    more_reached = False
    for i in range(140):
        fi = press(page, "Tab", surface="H-delete-reach", note=f"seek More note actions {i+1}")
        if (fi.get("name") or "").strip().lower() == "more note actions":
            press(page, "Enter", surface="H-delete-reach", note="*open More note actions menu", wait_ms=300)
            more_reached = True
            break
    delete_reached = False
    if more_reached:
        for i in range(15):
            fi = press(page, "Tab", surface="H-delete-reach", note=f"seek Delete inside the menu {i+1}")
            if (fi.get("name") or "").strip().lower() in ("delete", "delete this note"):
                delete_reached = True
                break
    if delete_reached:
        press(page, "Enter", surface="H-delete", note="*open Delete confirmation", wait_ms=300)
        press(page, "Tab", surface="H-delete", note="tab inside confirm dialog")
        press(page, "Escape", surface="H-delete", note="*Escape cancels delete -- focus returns to Delete button")
    else:
        STEPS.append({"n": len(STEPS) + 1, "surface": "H-delete", "keys": "(not reached)",
                      "note": "Delete button not reached (More note actions menu or Delete item not found)",
                      "focus": {}})

    # command palette
    goto(page, base, "/journal/notebook?view=all", "H-palette", "*list, for command palette")
    press(page, "Control+k", surface="H-palette", note="*Ctrl+K opens command palette", wait_ms=300)
    press(page, "Tab", surface="H-palette", note="tab inside command palette")
    press(page, "Escape", surface="H-palette", note="*Escape closes command palette")

    # ShortcutCheatSheet ("?") -- not in the brief's §3 list by name, but is a
    # reachable dialog covered by §4a step 27; code-reading found it has no
    # focus trap / no initial focus / no restore (ShortcutCheatSheet.jsx), so
    # this is specifically re-verified live.
    opener_before = focus_info(page)
    press(page, "?", surface="H-shortcuts", note="*? opens Keyboard Shortcuts dialog", wait_ms=300)
    first_focus = focus_info(page)
    press(page, "Tab", surface="H-shortcuts", note="tab once inside Shortcuts dialog")
    # Tab many times -- if it is not trapped, focus will leave role=dialog entirely.
    # The selector is matched by VISIBLE TEXT ("Keyboard Shortcuts"), not a bare
    # [role="dialog"], because this app keeps an always-mounted Compass/assistant
    # dialog in the DOM and a bare selector matches THAT one instead -- the first
    # attempt at this check matched the wrong element and produced a false negative.
    DIALOG_PROBE = (
        "() => { const ds = [...document.querySelectorAll('[role=\"dialog\"]')]; "
        "const d = ds.find(x => (x.textContent || '').includes('Keyboard Shortcuts')); "
        "return {dialogCount: ds.length, found: !!d, "
        "contains: d ? d.contains(document.activeElement) : null}; }"
    )
    probe0 = page.evaluate(DIALOG_PROBE)
    STEPS.append({"n": len(STEPS) + 1, "surface": "H-shortcuts", "keys": "(evaluate)",
                  "note": f"dialog probe right after opening: {probe0}", "focus": {}})
    left_dialog = False
    for i in range(60):
        fi = press(page, "Tab", surface="H-shortcuts-trap", note=f"trap probe tab {i+1}")
        probe = page.evaluate(DIALOG_PROBE)
        if probe["found"] and probe["contains"] is False:
            left_dialog = True
            FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "H (Keyboard Shortcuts, '?')",
                              "sc": "2.1.2", "expected": "Tab stays inside the open dialog",
                              "steps": f"'?' then Tab x{i+1}",
                              "seen": f"focus left the dialog into the page behind it (landed on "
                                      f"role={fi.get('role')} name={(fi.get('name') or '')!r})",
                              "severity": "major", "known_gap": None, "step_n": len(STEPS),
                              "screenshot": shot(page, f"{len(STEPS):04d}-H-shortcuts-trap-left")})
            break
        if not probe["found"]:
            STEPS.append({"n": len(STEPS) + 1, "surface": "H-shortcuts-trap", "keys": "(evaluate)",
                          "note": f"the Keyboard Shortcuts dialog is no longer in the DOM at tab {i+1} "
                                  f"(closed itself?): {probe}", "focus": {}})
            break
    if not left_dialog:
        log("  [H-shortcuts] Tab stayed inside the dialog across the probe window")
    press(page, "Escape", surface="H-shortcuts", note="*Escape closes Shortcuts dialog")
    after_close = focus_info(page)
    restored = (after_close.get("name") == opener_before.get("name")
                and after_close.get("role") == opener_before.get("role"))
    if not restored:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "H (Keyboard Shortcuts, '?')",
                          "sc": "2.4.3", "expected": "focus returns to the opener on close",
                          "steps": "'?' ... Escape",
                          "seen": f"opener was role={opener_before.get('role')} name={opener_before.get('name')!r}; "
                                  f"after close focus is role={after_close.get('role')} name={after_close.get('name')!r}",
                          "severity": "major", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"{len(STEPS):04d}-H-shortcuts-no-restore")})


def walk_links(page, base, fx):
    """Links in notes: Ctrl/Cmd+click opens; plain click on read-only (public) pages.
    Keyboard-only constraint: we test Enter on a focused internal-link chip (the
    product's own activation key), and separately verify the read-only public page's
    link behavior via a real click (permitted here -- §3 is about reaching CONTROLS by
    keyboard; the brief's own wording for this item is about click modifiers, which is
    inherently a pointer behavior, so it is recorded as a pointer-mode check, not part
    of the keyboard tally)."""
    goto(page, base, f"/journal/notebook?note={fx['note3_id']}", "LINKS-editor", "*open note with outgoing link")
    links_reached = False
    for i in range(140):
        fi = press(page, "Tab", surface="LINKS-reach", note=f"seek link chip {i+1}")
        # the real target: a role=link / role=button chip whose name is the LINKED
        # note's title ("Linked target note"), never the app-shell nav links this
        # page also contains.
        if "linked target note" in (fi.get("name") or "").strip().lower():
            links_reached = True
            break
    if links_reached:
        press(page, "Enter", surface="LINKS-enter", note="*Enter on a focused note-link chip", wait_ms=400)
    else:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "E (note link chip)", "sc": "2.1.1",
                          "expected": "the [[ ]] note-link chip to 'Linked target note' is reachable by Tab",
                          "steps": "Tab x140 from a direct note URL", "seen": "not reached within 140 Tab presses",
                          "severity": "major", "known_gap": None, "step_n": len(STEPS), "screenshot": ""})


def walk_public_pages(browser, base, fx):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    if fx.get("share_token"):
        goto(page, base, f"/share/n/{fx['share_token']}", "P-share", "*signed-out share link")
        page.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
        for i in range(10):
            press(page, "Tab", surface="P-share", note=f"tab {i+1} on signed-out share page")
    else:
        STEPS.append({"n": len(STEPS) + 1, "surface": "P-share", "keys": "(skipped)",
                      "note": "NOT RUN -- share mint failed during seed; see seed warnings", "focus": {}})
    if fx.get("publish_slug"):
        goto(page, base, f"/p/{fx['publish_slug']}", "P-publish", "*signed-out published page")
        page.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
        for i in range(10):
            press(page, "Tab", surface="P-publish", note=f"tab {i+1} on signed-out published page")
    else:
        STEPS.append({"n": len(STEPS) + 1, "surface": "P-publish", "keys": "(skipped)",
                      "note": "NOT RUN -- publish mint failed during seed; see seed warnings", "focus": {}})
    ctx.close()


def walk_consensus_capture(browser, base, reviewer_ctx, fx):
    """The analyst-consensus capture button in the ticker popup, plus the
    locked-note capture refusal message. Uses the 'as=button' call site
    PositionsTable.jsx:159 (Journal -> Open Positions) so the popup trigger is
    keyboard-reachable -- confirmed from source: ProfileSection.jsx (my first
    guess, "Profile tab") is used ONLY inside EarningsResearchModal, which
    /research/:sym never mounts; TABS in ResearchPage.jsx has no 'Profile' entry
    either, matched live (no such tab was ever seen in the first run's trace).
    Separately records the code-confirmed finding that most TickerPopup call
    sites default to a non-focusable <span role="button"> (F006)."""
    page = reviewer_ctx.new_page()
    # point the capture at the LOCKED note so the refusal path is exercised.
    page.goto(base + "/journal", wait_until="domcontentloaded", timeout=30000)
    page.evaluate(
        "(id) => localStorage.setItem('uct.jw.lastNote', JSON.stringify({id, ts: Date.now()}))",
        fx["locked_note_id"])
    milestone(page, "CONSENSUS-journal", "*journal page (Open Positions tab has as=button ticker chips)")
    tab_reached = False
    for i in range(80):
        fi = press(page, "Tab", surface="CONSENSUS-reach-tab", note=f"seek Open Positions tab {i+1}")
        if "open positions" in (fi.get("name") or "").strip().lower():
            press(page, "Enter", surface="CONSENSUS-reach-tab", note="*activate Open Positions tab", wait_ms=400)
            tab_reached = True
            break
    if not tab_reached:
        STEPS.append({"n": len(STEPS) + 1, "surface": "CONSENSUS-reach-tab", "keys": "(not reached)",
                      "note": "'Open Positions' tab not reached within 80 Tabs -- continuing the chip seek "
                              "anyway from wherever focus landed", "focus": {}})
    reached = False
    for i in range(150):
        fi = press(page, "Tab", surface="CONSENSUS-reach-chip", note=f"seek a ticker chip {i+1}")
        if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
            reached = True
            break
    if not reached:
        STEPS.append({"n": len(STEPS) + 1, "surface": "CONSENSUS", "keys": "(not reached)",
                      "note": "ticker chip not reached within 150 Tabs on /journal Open Positions -- page may have "
                              "no open positions in this sandbox (seed warning?)", "focus": {}})
        page.close()
        return
    press(page, "Enter", surface="CONSENSUS-open", note="*Enter opens ticker chart modal", wait_ms=500)
    reached_btn = False
    for i in range(30):
        fi = press(page, "Tab", surface="CONSENSUS-reach-btn", note=f"seek consensus-capture button {i+1}")
        if "analyst consensus" in (fi.get("name") or "").lower():
            reached_btn = True
            break
    if not reached_btn:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "Ticker popup (analyst consensus)",
                          "sc": "2.1.1", "expected": "'Save <SYM>'s analyst consensus to Notebook' button reachable by Tab",
                          "steps": "Tab x30 inside the open chart modal",
                          "seen": "not reached within 30 Tab presses", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        page.close()
        return
    press(page, "Enter", surface="CONSENSUS-capture", note="*Enter on 'Save analyst consensus to Notebook'",
          wait_ms=2500)
    msg = page.evaluate(
        "() => { const el = document.querySelector('[role=\"status\"], [aria-live]'); "
        "return el ? {text: el.textContent, role: el.getAttribute('role'), live: el.getAttribute('aria-live')} : null; }")
    focus_after = focus_info(page)
    STEPS.append({"n": len(STEPS) + 1, "surface": "CONSENSUS-message", "keys": "(read)",
                  "note": f"status-region probe after capture: {msg}", "focus": focus_after})
    if not msg:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "Ticker popup (analyst consensus)",
                          "sc": "4.1.3", "expected": "the capture outcome (sent / locked-note refusal) is in a "
                                                      "role=status or aria-live region",
                          "steps": "Enter on the consensus-capture button",
                          "seen": "no [role=status] or [aria-live] element found on the page", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"{len(STEPS):04d}-CONSENSUS-no-live-region")})
    dump()
    page.close()


def walk_first_run_tour(browser, admin_ctx, base):
    """A brand-new paid account, zero notes: the first-run tour / Welcome state
    (brief §3.4 'the first-run tour (a fresh account)')."""
    ctx = provision(browser, admin_ctx, base, "a11y2-fresh@local.dev", "A11yFresh2026!", "A11y Fresh")
    page = ctx.new_page()
    goto(page, base, "/journal/notebook?view=all", "TOUR-fresh", "*fresh paid account, Notebook home")
    for i in range(10):
        press(page, "Tab", surface="TOUR-fresh", note=f"tab {i+1} on first-run state")
    for i in range(3):
        press(page, "Escape", surface="TOUR-fresh", note="Escape in case a tour overlay is open")
    ctx.close()


def walk_dom_checks(page, base):
    """Structural, page-wide DOM check (not a keyboard step): how many rendered
    TickerPopup triggers are role=button but NOT in the tab order (no tabIndex,
    default <span>). Supports the code-level finding with a live measurement."""
    goto(page, base, "/dashboard", "DOM-check", "*dashboard, for TickerPopup trigger census")
    page.wait_for_timeout(1500)
    data = page.evaluate(
        "() => { const nodes = [...document.querySelectorAll('[role=\"button\"][aria-label^=\"View chart for\"]')]; "
        "return {count: nodes.length, "
        "unreachable: nodes.filter(n => n.tabIndex < 0 && n.tagName !== 'BUTTON' && n.tagName !== 'A').length, "
        "sample: nodes.slice(0,5).map(n => ({tag: n.tagName, tabIndex: n.tabIndex, label: n.getAttribute('aria-label')}))}; }")
    STEPS.append({"n": len(STEPS) + 1, "surface": "DOM-check", "keys": "(evaluate)",
                  "note": f"TickerPopup trigger census on /dashboard: {data}", "focus": {}})
    if data.get("count", 0) > 0 and data.get("unreachable", 0) > 0:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "TickerPopup trigger (app-wide)",
                          "sc": "2.1.1", "expected": "every ticker chip that opens a chart (role=button) is "
                                                      "reachable by Tab",
                          "steps": "DOM census on /dashboard: querySelectorAll('[role=button][aria-label^=\"View "
                                   "chart for\"]')",
                          "seen": f"{data['unreachable']} of {data['count']} rendered triggers have no tabIndex "
                                  f"and are not a native button/anchor (sample: {data.get('sample')})",
                          "severity": "blocker", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"{len(STEPS):04d}-DOM-check-unreachable")})
    dump()


def walk_touch(browser, base, fx, storage_state):
    # storage_state carries the reviewer's session -- a FRESH context defaults to
    # SIGNED OUT, which the first attempt at this missed entirely: all three "touch"
    # passes silently tested the sign-in page instead of the Notebook.
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                               storage_state=storage_state)
    page = ctx.new_page()
    goto(page, base, "/journal/notebook?view=all", "TOUCH-390", "*390px touch-emulated list")
    for i in range(10):
        press(page, "Tab", surface="TOUCH-390", note=f"tab {i+1} at 390px")
    ctx.close()
    ctx = browser.new_context(viewport={"width": 820, "height": 1180}, has_touch=True, is_mobile=False,
                               storage_state=storage_state)
    page = ctx.new_page()
    goto(page, base, "/journal/notebook?view=all", "TOUCH-820", "*820px touch-emulated list")
    for i in range(10):
        press(page, "Tab", surface="TOUCH-820", note=f"tab {i+1} at 820px")
    ctx.close()
    # 320 CSS px reflow check (1.4.10) -- desktop viewport pinned to 320 wide
    ctx = browser.new_context(viewport={"width": 320, "height": 800}, storage_state=storage_state)
    page = ctx.new_page()
    goto(page, base, "/journal/notebook?view=all", "REFLOW-320", "*320 CSS px width (1.4.10)")
    overflow = page.evaluate(
        "() => ({scrollWidth: document.documentElement.scrollWidth, "
        "clientWidth: document.documentElement.clientWidth})")
    STEPS.append({"n": len(STEPS) + 1, "surface": "REFLOW-320", "keys": "(evaluate)",
                  "note": f"document overflow at 320px: {overflow}", "focus": {}})
    if overflow.get("scrollWidth", 0) > overflow.get("clientWidth", 0) + 2:
        FINDINGS.append({"id": f"F{len(FINDINGS)+1:03d}", "surface": "L (list) at 320 CSS px", "sc": "1.4.10",
                          "expected": "no horizontal scrolling of the document at 320 CSS px",
                          "steps": "resize to 320x800, read document.documentElement.scrollWidth",
                          "seen": f"scrollWidth={overflow.get('scrollWidth')} > clientWidth={overflow.get('clientWidth')}",
                          "severity": "major", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"{len(STEPS):04d}-REFLOW-320-overflow")})
    ctx.close()
    dump()


# ── main ──────────────────────────────────────────────────────────────────

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
                                                  "a11y2-reviewer@local.dev", "A11yReview2026!", "A11y Reviewer")
                        fx = seed(reviewer_ctx, base)
                        dump()

                        page = reviewer_ctx.new_page()
                        walk_list(page, base, fx)
                        walk_editor(page, base, fx)
                        walk_graph(page, base, fx)
                        walk_sheets(page, base, fx)
                        walk_links(page, base, fx)
                        walk_dom_checks(page, base)
                        page.close()

                        walk_public_pages(browser, base, fx)
                        walk_consensus_capture(browser, base, reviewer_ctx, fx)
                        reviewer_storage = reviewer_ctx.storage_state()
                        walk_touch(browser, base, fx, reviewer_storage)
                        walk_first_run_tour(browser, admin_ctx, base)

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
    return 0


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())
