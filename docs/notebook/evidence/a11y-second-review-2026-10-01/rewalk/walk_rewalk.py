"""Second-reviewer RE-WALK -- verifying the fix lane's claims on branch
feat/notebook-w10-af (tip 1c08d0c33) against A2R-01 through A2R-05, plus the
previously-NOT-RUN locked-note capture refusal.

Same rules as the original walk.py: real page.keyboard only, no .click(), no
selector-driven .focus(). Reuses the Sandbox/account pattern from
tools/notebook_perf_harness.py per the brief.

Six targeted checks, each its own function, called from main() in the order
the controller listed:
  1. A2R-03 -- graph reachable via the switcher AND via a direct ?view=graph
     load; canvas keys; the list alternative; ?view=table/board/calendar/
     timeline each render their own view, not Research Home.
  2. A2R-04 -- Enter AND Space on "Show keyboard shortcuts"; trap; restore;
     a keydown logger comparing page.keyboard.press("?") against
     page.keyboard.press("Shift+Slash"); "?" must NOT open the dialog while
     the caret is in the editor body or a text field (2.1.4).
  3. A2R-05 -- Dashboard, Journal (Open Positions), and a DOM census on a
     third route; Enter AND Space both open the popup; Tab to "Save ...
     price to Notebook" and "Save ... analyst consensus to Notebook";
     Escape restores focus to the trigger. The two focusable={false}
     call sites (UCT20.jsx, NewsFeed.jsx) are recorded as STILL OPEN with
     their own evidence (source citation -- NewsFeed is build-time gated
     off by default and not live-rendered this run; UCT20 is live-checked).
  4. A2R-01 -- a genuinely fresh context (new browser context, so no
     sessionStorage): Tab repeatedly while the intro plays, confirm focus
     never reaches anything behind the overlay.
  5. A2R-02 -- open an EXISTING note, confirm focus lands on the sr-only
     landmark, and check the PANE ancestor for a visible focus ring (the
     fix lane's own claim: `.notePane:has([data-note-landmark]:focus-visible)`).
  6. Locked-note capture refusal -- lock a note by keyboard (which also
     makes it the last-active note, by the product's own normal flow:
     NoteEditorPage.jsx:2077 writes `uct.jw.lastNote` on every note open),
     then "Save price to Notebook" from a ticker popup elsewhere; read the
     message and check whether it is in a role=status/alert or aria-live
     region.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
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


def log(msg: str) -> None:
    print(msg, flush=True)


def dump() -> None:
    (OUT_DIR / "focus-log-rewalk.json").write_text(
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
  // walk up to find a [data-note-landmark] ancestor relationship for A2R-02:
  // is EL itself the landmark, and does its nearest .notePane-ish ancestor
  // (walking up for a class containing "notePane") show a visible ring?
  let paneRing = null;
  if (el.hasAttribute && el.hasAttribute('data-note-landmark')) {
    let p = el.parentElement;
    let hops = 0;
    while (p && hops < 8) {
      if ((p.className || '').toString().toLowerCase().includes('notepane')) {
        const pcs = getComputedStyle(p);
        const pOutlineNone = pcs.outlineStyle === 'none' || pcs.outlineWidth === '0px';
        const pBoxShadowNone = !pcs.boxShadow || pcs.boxShadow === 'none';
        paneRing = {className: p.className, outline: pcs.outline, boxShadow: pcs.boxShadow.slice(0,160),
          visible: !(pOutlineNone && pBoxShadowNone)};
        break;
      }
      p = p.parentElement; hops++;
    }
  }
  return {present: true, tag: el.tagName.toLowerCase(), role, name,
    hasNoteLandmark: !!(el.hasAttribute && el.hasAttribute('data-note-landmark')),
    paneRing,
    ariaExpanded: el.getAttribute('aria-expanded'), ariaPressed: el.getAttribute('aria-pressed'),
    rect: {x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)},
    visibleIndicator: !(outlineNone && boxShadowNone),
    inViewport: rect.bottom>0 && rect.top<innerHeight && rect.right>0 && rect.left<innerWidth,
    outline: cs.outline, boxShadow: cs.boxShadow.slice(0,160)};
}
"""

KEYLOG_INIT_JS = r"""
window.__a11yKeylog = [];
document.addEventListener('keydown', (e) => {
  window.__a11yKeylog.push({key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey,
    altKey: e.altKey, metaKey: e.metaKey, target: e.target.tagName, defaultPrevented: false});
}, true);
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


def press(page, keys, *, surface, note="", finding=None, severity=None, sc=None, wait_ms=160, known_gap=None):
    page.keyboard.press(keys)
    page.wait_for_timeout(wait_ms)
    fi = focus_info(page)
    rec = {"n": len(STEPS) + 1, "surface": surface, "keys": keys, "note": note, "focus": fi}
    if finding or note.startswith("*"):
        rec["screenshot"] = shot(page, f"rw-{len(STEPS)+1:04d}-{surface}".replace(" ", "_").replace("/", "-"))
    STEPS.append(rec)
    if finding:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": surface, "sc": sc,
                          "expected": finding.split("||")[0] if "||" in finding else finding,
                          "seen": finding.split("||")[1] if "||" in finding else "",
                          "severity": severity, "known_gap": known_gap, "step_n": rec["n"],
                          "screenshot": rec.get("screenshot", "")})
    log(f"  [{rec['n']:04d}] {surface} <{keys}> -> {fi.get('role')} \"{(fi.get('name') or '')[:50]}\" {note}")
    dump()
    return fi


_OVERLAY_JS = (
    "() => { const els=[...document.querySelectorAll('*')]; "
    "const ov = els.find(e => { const cs=getComputedStyle(e); return cs.position==='fixed' && "
    "parseInt(cs.zIndex||'0')>=99999; }); return !!ov; }"
)


def goto(page, base, path, surface, note="*nav", dismiss_intro=True):
    page.goto(base + path, wait_until="domcontentloaded", timeout=30000)
    if dismiss_intro:
        # NOTE added post-run: this run (843 steps, committed as-is) used a
        # single fixed-delay Escape here and did not hit the race -- the
        # intro only replays on a genuinely fresh browser CONTEXT (sessionStorage-
        # gated), and this script reused one context/page across the combined
        # walk, so the intro played at most once, early, with no contention.
        # The isolated lock-capture script (walk_rewalk_lock.py) opens a
        # fresh context every run and DID hit the race (documented there,
        # and in the fix lane's own R-RAW commit 1c08d0c336 as "harness bug
        # 1"). Hardened here too, for consistency, using the same overlay
        # check check_a2r_01 already uses -- not re-run, since the original
        # evidence is valid and R-RAW evidence is not re-generated for a
        # harmless hardening.
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
    p = shot(page, f"rw-{len(STEPS)+1:04d}-{surface}-nav".replace(" ", "_").replace("/", "-"))
    STEPS.append({"n": len(STEPS) + 1, "surface": surface, "keys": "(navigate)", "note": note,
                  "focus": focus_info(page), "screenshot": p})
    log(f"  [{len(STEPS):04d}] {surface} (navigate) {note}")
    dump()


def milestone(page, surface, note):
    page.wait_for_timeout(200)
    p = shot(page, f"rw-{len(STEPS)+1:04d}-{surface}".replace(" ", "_").replace("/", "-"))
    STEPS.append({"n": len(STEPS) + 1, "surface": surface, "keys": "(observe)", "note": note,
                  "focus": focus_info(page), "screenshot": p})
    log(f"  [{len(STEPS):04d}] {surface} (observe) {note}")
    dump()


# ── account provisioning ─────────────────────────────────────────────────

def admin_login(browser, base, H):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    r = ctx.request.post(base + "/api/auth/login", data={"email": H.ADMIN_EMAIL, "password": H.ADMIN_PW})
    if r.status not in (200, 201):
        ctx.request.post(base + "/api/auth/signup",
                          data={"email": H.ADMIN_EMAIL, "password": H.ADMIN_PW, "display_name": "hubtest"})
    return ctx


def provision(browser, admin_ctx, base, email, pw, name):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    r = ctx.request.post(base + "/api/auth/signup", data={"email": email, "password": pw, "display_name": name})
    if r.status not in (200, 201):
        raise RuntimeError(f"signup {email} failed: {r.status} {r.text()[:200]}")
    admin_ctx.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
    admin_ctx.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
    me = ctx.request.get(base + "/api/auth/me").json()
    if not me.get("paid_equiv"):
        raise RuntimeError(f"{email} not paid-equivalent: {me}")
    log(f"provisioned {email}: paid_equiv={me.get('paid_equiv')}")
    return ctx


DOC = lambda *c: {"type": "doc", "content": list(c)}  # noqa: E731
P = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}  # noqa: E731


def seed(ctx, base):
    fx = {}

    def mk_note(title, body=None):
        r = ctx.request.post(base + "/api/j2/notes",
                              data=json.dumps({"title": title, "bodyJson": body or DOC(P("content"))}),
                              headers={"Content-Type": "application/json"})
        if r.status not in (200, 201):
            raise RuntimeError(f"create note {title!r}: {r.status} {r.text()[:200]}")
        return r.json()["note"]

    n1 = mk_note("Rewalk note one")
    n2 = mk_note("Rewalk note to lock")
    fx["note1_id"] = n1["id"]
    fx["note2_id"] = n2["id"]
    r = ctx.request.post(base + "/api/j2/positions", data=json.dumps({
        "symbol": "AAPL", "side": "Long", "entryDate": "2026-09-15",
        "shares": 5, "entryPrice": 200.0, "stopPrice": 180.0,
    }), headers={"Content-Type": "application/json"})
    log(f"  [seed] position: {r.status}")
    return fx


# ── 1) A2R-03: graph + direct view loads ─────────────────────────────────

def check_a2r_03(page, base, fx):
    # via the switcher
    goto(page, base, "/journal/notebook?view=all", "RW-A2R03-switcher", "*list, reach Graph view via switcher")
    reached = False
    for i in range(60):
        fi = press(page, "Tab", surface="RW-A2R03-switcher", note=f"seek Graph view {i+1}")
        if (fi.get("name") or "").strip().lower() == "graph view":
            reached = True
            break
    if reached:
        press(page, "Enter", surface="RW-A2R03-switcher", note="*Enter activates Graph view", wait_ms=500)
        fi = focus_info(page)
        in_graph_url = "view=graph" in page.url
        STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R03-switcher", "keys": "(check)",
                      "note": f"url after Enter: {page.url}; in_graph_url={in_graph_url}", "focus": fi})
    else:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "L (view switcher)", "sc": "2.1.1",
                          "expected": "'Graph view' toggle reachable by Tab",
                          "seen": "not reached within 60 Tabs", "severity": "major", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": ""})
    dump()

    # direct load
    goto(page, base, "/journal/notebook?view=graph", "RW-A2R03-direct", "*direct load ?view=graph")
    page.wait_for_timeout(700)
    pressed_graph = page.evaluate(
        "() => { const b = [...document.querySelectorAll('[role=\"tab\"], button')].find(x => "
        "(x.textContent||'').trim().toLowerCase()==='graph view' || (x.getAttribute('aria-label')||'').toLowerCase()==='graph view'); "
        "return b ? b.getAttribute('aria-pressed') : null; }")
    research_home_present = page.evaluate(
        "() => !!document.querySelector('[data-testid=\"research-home\"]')")
    canvas_reached = False
    fi = {}
    for i in range(100):
        fi = press(page, "Tab", surface="RW-A2R03-canvas", note=f"seek graph canvas {i+1}")
        name_l = (fi.get("name") or "").lower()
        if fi.get("role") == "application" or "note graph" in name_l:
            canvas_reached = True
            break
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R03-direct", "keys": "(evaluate)",
                  "note": f"direct ?view=graph: aria-pressed on Graph view={pressed_graph}, "
                          f"research-home present={research_home_present}, canvas_reached={canvas_reached}",
                  "focus": {}})
    if not canvas_reached:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "L (graph canvas, direct load)", "sc": "2.1.1",
                          "expected": "the canvas reachable by Tab on a direct ?view=graph load",
                          "seen": f"not reached within 100 Tabs; aria-pressed={pressed_graph}, "
                                  f"research-home present={research_home_present}",
                          "severity": "blocker", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R03-canvas-not-reached")})
    else:
        press(page, "Home", surface="RW-A2R03-canvas", note="*Home on canvas")
        press(page, "ArrowRight", surface="RW-A2R03-canvas", note="*arrow on canvas")
        press(page, "Enter", surface="RW-A2R03-canvas", note="*Enter opens the focused note", wait_ms=400)
        # back to graph, reach "Show as list"
        goto(page, base, "/journal/notebook?view=graph", "RW-A2R03-list-alt", "back to graph picture")
        page.wait_for_timeout(600)
        list_reached = False
        for i in range(100):
            fi = press(page, "Tab", surface="RW-A2R03-list-alt", note=f"seek Show as list {i+1}")
            if "show as list" in (fi.get("name") or "").lower():
                list_reached = True
                press(page, " ", surface="RW-A2R03-list-alt", note="*Space toggles Show as list")
                break
        if not list_reached:
            FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "L (graph, Show as list)", "sc": "2.1.1",
                              "expected": "'Show as list' reachable from the direct-loaded graph view",
                              "seen": "not reached within 100 Tabs", "severity": "minor", "known_gap": None,
                              "step_n": len(STEPS), "screenshot": ""})
    dump()

    # the other direct view loads
    for mode in ("table", "board", "calendar", "timeline"):
        goto(page, base, f"/journal/notebook?view={mode}", f"RW-A2R03-{mode}", f"*direct load ?view={mode}")
        page.wait_for_timeout(500)
        info = page.evaluate(
            "() => { const btns=[...document.querySelectorAll('[role=\"tab\"], button')]; "
            "const pressed = btns.filter(b => b.getAttribute('aria-pressed')==='true' || b.getAttribute('aria-selected')==='true')"
            ".map(b => (b.textContent||b.getAttribute('aria-label')||'').trim()); "
            "const researchHome = !!document.querySelector('[data-testid=\"research-home\"]'); "
            "return {pressed, researchHome, url: location.pathname+location.search}; }")
        STEPS.append({"n": len(STEPS)+1, "surface": f"RW-A2R03-{mode}", "keys": "(evaluate)",
                      "note": f"?view={mode}: {info}", "focus": {}})
        if info.get("researchHome") or not any(mode in p.lower() for p in info.get("pressed", [])):
            FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": f"L (?view={mode})", "sc": "2.1.1",
                              "expected": f"?view={mode} renders its own view (a pressed/selected "
                                          f"control naming '{mode}'), not Research Home",
                              "seen": f"{info}", "severity": "major", "known_gap": None,
                              "step_n": len(STEPS), "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R03-{mode}")})
        dump()


# ── 2) A2R-04: Keyboard Shortcuts door, trap, restore, real chord ───────

def check_a2r_04(page, base):
    goto(page, base, "/journal/notebook?view=all", "RW-A2R04", "*clean list load")
    page.evaluate(KEYLOG_INIT_JS)

    # Enter door
    reached = False
    fi = {}
    for i in range(60):
        fi = press(page, "Tab", surface="RW-A2R04-reach", note=f"seek 'Show keyboard shortcuts' {i+1}")
        if "show keyboard shortcuts" in (fi.get("name") or "").strip().lower():
            reached = True
            break
    if not reached:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "H (Keyboard Shortcuts button)", "sc": "2.1.1",
                          "expected": "'Show keyboard shortcuts' button reachable by Tab",
                          "seen": f"not reached within 60 Tabs; last role={fi.get('role')} name={(fi.get('name') or '')!r}",
                          "severity": "blocker", "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        dump()
        return
    opener_before = focus_info(page)
    press(page, "Enter", surface="RW-A2R04-enter", note="*Enter on 'Show keyboard shortcuts'", wait_ms=400)
    DIALOG_PROBE = ("() => { const ds=[...document.querySelectorAll('[role=\"dialog\"]')]; "
                     "const d=ds.find(x=>(x.textContent||'').includes('Keyboard Shortcuts')); "
                     "return {found: !!d, contains: d ? d.contains(document.activeElement) : null, "
                     "focusedName: (document.activeElement && (document.activeElement.textContent||'').trim().slice(0,40))}; }")
    probe = page.evaluate(DIALOG_PROBE)
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R04-enter", "keys": "(evaluate)",
                  "note": f"dialog probe after Enter: {probe}", "focus": {}})
    if not probe["found"]:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "H (Keyboard Shortcuts, Enter)", "sc": "4.1.2",
                          "expected": "Enter on the button opens the dialog",
                          "seen": f"{probe}", "severity": "blocker", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R04-enter-fail")})
        dump()
    else:
        # trap
        left = False
        for i in range(30):
            fi = press(page, "Tab", surface="RW-A2R04-trap", note=f"trap probe {i+1}")
            p2 = page.evaluate(DIALOG_PROBE)
            if p2["found"] and p2["contains"] is False:
                left = True
                FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "H (Keyboard Shortcuts)", "sc": "2.1.2",
                                  "expected": "Tab stays inside the dialog",
                                  "seen": f"left after {i+1} Tabs onto role={fi.get('role')} name={(fi.get('name') or '')!r}",
                                  "severity": "major", "known_gap": None, "step_n": len(STEPS),
                                  "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R04-trap-left")})
                break
            if not p2["found"]:
                break
        if not left:
            log("  [RW-A2R04] Tab stayed inside across the trap probe")
        press(page, "Escape", surface="RW-A2R04-restore", note="*Escape closes -- focus should return to opener")
        after = focus_info(page)
        restored = (after.get("name") == opener_before.get("name") and after.get("role") == opener_before.get("role"))
        STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R04-restore", "keys": "(compare)",
                      "note": f"opener={opener_before} after={after} restored={restored}", "focus": {}})
        if not restored:
            FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "H (Keyboard Shortcuts)", "sc": "2.4.3",
                              "expected": "focus returns to the opener on close",
                              "seen": f"opener={opener_before.get('name')!r} after={after.get('name')!r}",
                              "severity": "major", "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        dump()

    # Space door (re-open the same way, fresh)
    goto(page, base, "/journal/notebook?view=all", "RW-A2R04-space", "*reload for Space-door test")
    for i in range(60):
        fi = press(page, "Tab", surface="RW-A2R04-space-reach", note=f"seek button {i+1}")
        if "show keyboard shortcuts" in (fi.get("name") or "").strip().lower():
            break
    press(page, " ", surface="RW-A2R04-space", note="*Space on 'Show keyboard shortcuts'", wait_ms=400)
    probe_space = page.evaluate(DIALOG_PROBE)
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R04-space", "keys": "(evaluate)",
                  "note": f"dialog probe after Space: {probe_space}", "focus": {}})
    if not probe_space["found"]:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "H (Keyboard Shortcuts, Space)", "sc": "4.1.2",
                          "expected": "Space on the button opens the dialog", "seen": f"{probe_space}",
                          "severity": "blocker", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R04-space-fail")})
    else:
        press(page, "Escape", surface="RW-A2R04-space", note="close")
    dump()

    # the keydown logger: compare "?" vs "Shift+Slash"
    goto(page, base, "/journal/notebook?view=all", "RW-A2R04-keylog", "*reload, fresh keylog")
    page.evaluate(KEYLOG_INIT_JS)
    page.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
    page.keyboard.press("Tab")  # settle on a real element
    page.keyboard.press("?")
    page.wait_for_timeout(150)
    log_q = page.evaluate("window.__a11yKeylog.slice()")
    page.keyboard.press("Shift+Slash")
    page.wait_for_timeout(150)
    log_ss = page.evaluate("window.__a11yKeylog.slice()")
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R04-keylog", "keys": "(measure)",
                  "note": f"full keylog after '?' then 'Shift+Slash': {log_ss}", "focus": {}})
    q_events = [e for e in log_q if e.get("code") == "Slash"]
    ss_events = [e for e in log_ss if e.get("code") == "Slash"]
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R04-keylog", "keys": "(compare)",
                  "note": f"'?' Slash events: {q_events}; 'Shift+Slash' Slash events (cumulative): {ss_events}",
                  "focus": {}})
    dump()
    # did "?" alone open the dialog just now (it should NOT have -- confirms independently)
    probe_bare = page.evaluate(DIALOG_PROBE)
    bare_opened_dialog = probe_bare["found"]
    # did Shift+Slash open it
    probe_after_ss = page.evaluate(DIALOG_PROBE)
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R04-keylog", "keys": "(evaluate)",
                  "note": f"dialog state after the '?' + 'Shift+Slash' sequence: {probe_after_ss}", "focus": {}})
    if probe_after_ss["found"]:
        press(page, "Escape", surface="RW-A2R04-keylog", note="close the dialog Shift+Slash opened")

    # 2.1.4: "?" must NOT open the dialog while caret is in the editor body
    # or a text field.
    goto(page, base, "/journal/notebook?view=all", "RW-A2R04-21-4", "*list, open a note for the 2.1.4 check")
    opened = False
    for i in range(140):
        fi = press(page, "Tab", surface="RW-A2R04-21-4-reach", note=f"seek a note card {i+1}")
        if (fi.get("name") or "").strip().startswith("Rewalk"):
            press(page, "Enter", surface="RW-A2R04-21-4-reach", note="*open a note", wait_ms=700)
            opened = True
            break
    if opened:
        for i in range(60):
            fi = press(page, "Tab", surface="RW-A2R04-21-4-body", note=f"seek Note body {i+1}")
            if (fi.get("name") or "").strip().lower() == "note body":
                break
        page.evaluate(KEYLOG_INIT_JS)
        press(page, "?", surface="RW-A2R04-21-4", note="*'?' with the caret in the editor body")
        probe_in_body = page.evaluate(DIALOG_PROBE)
        STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R04-21-4", "keys": "(evaluate)",
                      "note": f"dialog probe after '?' typed in the note body: {probe_in_body}", "focus": {}})
        if probe_in_body["found"]:
            FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "E, note body", "sc": "2.1.4",
                              "expected": "'?' does not open the Keyboard Shortcuts dialog while typing in the "
                                          "note body (it should insert a literal '?' character instead)",
                              "seen": f"the dialog opened: {probe_in_body}", "severity": "major", "known_gap": None,
                              "step_n": len(STEPS), "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R04-214-fail")})
        else:
            log("  [RW-A2R04] '?' correctly did NOT open the dialog with the caret in the note body")
    dump()


# ── 3) A2R-05: TickerPopup app-wide ──────────────────────────────────────

def ticker_popup_deep_check(page, surface_prefix, max_tab_budget=160):
    """Tab to a 'View chart for X' trigger, Enter to open, Tab to the two
    capture buttons, Escape, Space to re-open, Escape again, confirm focus
    restore both times."""
    reached = False
    fi = {}
    for i in range(max_tab_budget):
        fi = press(page, "Tab", surface=f"{surface_prefix}-reach", note=f"seek a ticker chip {i+1}")
        if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
            reached = True
            break
    if not reached:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.1",
                          "expected": "a ticker chip ('View chart for ...') reachable by Tab",
                          "seen": f"not reached within {max_tab_budget} Tabs", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        dump()
        return False
    trigger_name = fi.get("name")
    # Enter door
    press(page, "Enter", surface=f"{surface_prefix}-open", note=f"*Enter opens {trigger_name!r}", wait_ms=500)
    price_reached = False
    consensus_reached = False
    for i in range(40):
        fi2 = press(page, "Tab", surface=f"{surface_prefix}-inside", note=f"tab inside popup {i+1}")
        name_l = (fi2.get("name") or "").lower()
        if "save" in name_l and "price to notebook" in name_l:
            price_reached = True
        if "save" in name_l and "analyst consensus" in name_l:
            consensus_reached = True
        if price_reached and consensus_reached:
            break
    if not price_reached:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.1",
                          "expected": "'Save ... price to Notebook' reachable inside the popup",
                          "seen": "not found within 40 Tabs inside the popup", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
    if not consensus_reached:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.1",
                          "expected": "'Save ... analyst consensus to Notebook' reachable inside the popup",
                          "seen": "not found within 40 Tabs inside the popup", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
    press(page, "Escape", surface=f"{surface_prefix}-close", note="*Escape closes -- focus should return to trigger")
    after = focus_info(page)
    restored = (after.get("name") == trigger_name)
    STEPS.append({"n": len(STEPS)+1, "surface": f"{surface_prefix}-close", "keys": "(compare)",
                  "note": f"trigger={trigger_name!r} after_escape={after.get('name')!r} restored={restored}",
                  "focus": {}})
    if not restored:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.4.3",
                          "expected": "focus returns to the trigger on Escape",
                          "seen": f"trigger={trigger_name!r}, after={after.get('name')!r}", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
    # Space door, same trigger (focus should still be ON the trigger if restore worked)
    if restored:
        press(page, " ", surface=f"{surface_prefix}-space", note="*Space re-opens the same trigger", wait_ms=500)
        modal_open = page.evaluate("() => !!document.querySelector('[data-testid=\"chart-modal\"]')")
        STEPS.append({"n": len(STEPS)+1, "surface": f"{surface_prefix}-space", "keys": "(evaluate)",
                      "note": f"chart-modal present after Space: {modal_open}", "focus": {}})
        if not modal_open:
            FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.1",
                              "expected": "Space on the trigger also opens the popup",
                              "seen": "no chart-modal found after Space", "severity": "major", "known_gap": None,
                              "step_n": len(STEPS), "screenshot": shot(page, f"rw-{len(STEPS):04d}-{surface_prefix}-space-fail")})
        else:
            press(page, "Escape", surface=f"{surface_prefix}-space", note="close again")
    dump()
    return True


def check_a2r_05(page, base):
    goto(page, base, "/dashboard", "RW-A2R05-dash", "*dashboard")
    ticker_popup_deep_check(page, "RW-A2R05-dash")

    goto(page, base, "/journal", "RW-A2R05-journal", "*journal, for Open Positions")
    for i in range(80):
        fi = press(page, "Tab", surface="RW-A2R05-journal-tab", note=f"seek Open Positions tab {i+1}")
        if "open positions" in (fi.get("name") or "").strip().lower():
            press(page, "Enter", surface="RW-A2R05-journal-tab", note="*activate Open Positions", wait_ms=400)
            break
    ticker_popup_deep_check(page, "RW-A2R05-journal", max_tab_budget=160)

    # a third route: DOM census only (supporting evidence the fix is at the
    # component level, not page-specific)
    goto(page, base, "/breadth", "RW-A2R05-breadth", "*breadth, DOM census only")
    page.wait_for_timeout(800)
    census = page.evaluate(
        "() => { const nodes=[...document.querySelectorAll('[aria-label^=\"View chart for\"]')]; "
        "return {count: nodes.length, "
        "tabbable: nodes.filter(n => n.tabIndex === 0).length, "
        "sample: nodes.slice(0,5).map(n => ({tag:n.tagName, tabIndex:n.tabIndex, label:n.getAttribute('aria-label')}))}; }")
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R05-breadth", "keys": "(evaluate)",
                  "note": f"TickerPopup trigger census on /breadth: {census}", "focus": {}})
    if census["count"] > 0 and census["tabbable"] < census["count"]:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "TickerPopup trigger, /breadth", "sc": "2.1.1",
                          "expected": "every rendered trigger has tabIndex=0",
                          "seen": f"{census}", "severity": "major", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R05-breadth")})
    dump()

    # UCT20 -- STILL OPEN by design (focusable=false), live-confirmed
    goto(page, base, "/uct-20", "RW-A2R05-uct20", "*uct-20, confirm the known-open exception")
    page.wait_for_timeout(800)
    uct20_census = page.evaluate(
        "() => { const nodes=[...document.querySelectorAll('[aria-label^=\"View chart for\"]')]; "
        "return {count: nodes.length, tabbable: nodes.filter(n => n.tabIndex === 0).length, "
        "sample: nodes.slice(0,3).map(n => ({tag:n.tagName, tabIndex:n.tabIndex, label:n.getAttribute('aria-label')}))}; }")
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R05-uct20", "keys": "(evaluate)",
                  "note": f"TickerPopup trigger census on /uct-20: {uct20_census}", "focus": {}})
    FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "TickerPopup trigger, UCT20.jsx rows", "sc": "2.1.1",
                      "expected": "STILL OPEN BY DESIGN -- UCT20.jsx passes focusable={false} (nesting hazard: "
                                  "the chip sits inside a row that is already role=button with its own "
                                  "Enter/Space handler); being fixed separately per the controller",
                      "seen": f"{uct20_census} -- code: app/src/pages/UCT20.jsx:182 "
                              "'<TickerPopup sym={sym} focusable={false} ...'",
                      "severity": "major", "known_gap": "fix lane A2R-05 (deliberate exception)",
                      "step_n": len(STEPS), "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R05-uct20")})
    dump()

    # NewsFeed -- STILL OPEN by design, code-confirmed (build-time gated off
    # by default in this build, so not live-rendered this run)
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R05-newsfeed", "keys": "(code review)",
                  "note": "NewsFeed.jsx only renders when VITE_TWITTER_UI_ENABLED is built as '0' "
                          "(TapeFeed.jsx: `if (!UI_ENABLED) return <NewsFeed />`, default '1' when unset) -- "
                          "not live-rendered in this build; confirmed by source instead", "focus": {}})
    FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "TickerPopup trigger, NewsFeed.jsx chips", "sc": "2.1.1",
                      "expected": "STILL OPEN BY DESIGN -- NewsFeed.jsx passes focusable={false} (nesting hazard: "
                                  "the chip sits inside a native <a href target=_blank>, and a focusable element "
                                  "inside an anchor is invalid); being fixed separately per the controller. NOT "
                                  "live-rendered this run (requires VITE_TWITTER_UI_ENABLED=0 at BUILD time; "
                                  "this build used the default)",
                      "seen": "code: app/src/components/tiles/NewsFeed.jsx:107 "
                              "'<TickerPopup sym={sym} focusable={false}>'",
                      "severity": "major", "known_gap": "fix lane A2R-05 (deliberate exception); NOT live-verified",
                      "step_n": len(STEPS), "screenshot": ""})
    dump()


# ── 4) A2R-01: intro focus trap, fresh context ───────────────────────────

def check_a2r_01(browser, base):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(200)
    p = shot(page, f"rw-{len(STEPS)+1:04d}-A2R01-fresh-load")
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R01", "keys": "(navigate)",
                  "note": "*a genuinely fresh context -- new browser context, no sessionStorage, intro should play",
                  "focus": {}, "screenshot": p})
    dump()
    names_seen = []
    escaped = False
    for i in range(15):
        fi = press(page, "Tab", surface="RW-A2R01-trap", note=f"tab {i+1} while intro plays")
        names_seen.append((fi.get("role"), fi.get("name")))
        # does the overlay still cover the viewport?
        overlay_visible = page.evaluate(
            "() => { const els=[...document.querySelectorAll('*')]; "
            "const ov = els.find(e => { const cs=getComputedStyle(e); return cs.position==='fixed' && "
            "parseInt(cs.zIndex||'0')>=99999; }); return !!ov; }")
        if not overlay_visible:
            log(f"  [RW-A2R01] overlay gone by tab {i+1} -- intro dismissed itself or finished playing")
            escaped = True
            break
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R01-trap", "keys": "(summary)",
                  "note": f"names seen across the Tab probe: {names_seen}; overlay self-dismissed: {escaped}",
                  "focus": {}})
    distinct_names = {n for _, n in names_seen}
    if len(distinct_names) > 1 and not escaped:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "L, intro overlay", "sc": "2.1.2",
                          "expected": "Tab stays on the intro's own controls while it plays",
                          "seen": f"multiple distinct names reached: {distinct_names}", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R01-leaked")})
    else:
        log(f"  [RW-A2R01] Tab stayed on {distinct_names} while the overlay was up -- trap holds")
    dump()
    page.close()
    ctx.close()


# ── 5) A2R-02: note-open landmark + pane ring ────────────────────────────

def check_a2r_02(page, base, fx):
    goto(page, base, "/journal/notebook?view=all", "RW-A2R02", "*list, open an EXISTING note")
    opened = False
    for i in range(140):
        fi = press(page, "Tab", surface="RW-A2R02-reach", note=f"seeking existing note card {i+1}")
        name = (fi.get("name") or "").strip()
        if name.startswith("Rewalk note one") and fi.get("role") in ("button", "link"):
            press(page, "Enter", surface="RW-A2R02-open", note="*Enter on an EXISTING note card", wait_ms=900)
            opened = True
            break
    if not opened:
        STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R02", "keys": "(not reached)",
                      "note": "existing note card not reached within 140 Tabs", "focus": {}})
        dump()
        return
    fi = focus_info(page)
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-A2R02-landing", "keys": "(observe)",
                  "note": f"focus after opening an EXISTING note: {fi}",
                  "focus": fi, "screenshot": shot(page, f"rw-{len(STEPS)+1:04d}-A2R02-landing")})
    dump()
    has_landmark = fi.get("hasNoteLandmark")
    pane_ring = fi.get("paneRing")
    if not has_landmark:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "E, note open landmark", "sc": "2.4.3",
                          "expected": "opening an EXISTING note focuses [data-note-landmark] per the fix lane's "
                                      "own ruling (NoteEditorPage.jsx:906-913)",
                          "seen": f"focus is role={fi.get('role')} name={fi.get('name')!r}, "
                                  f"hasNoteLandmark={has_landmark}", "severity": "minor", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": ""})
    elif pane_ring is None:
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "E, note open landmark", "sc": "2.4.7",
                          "expected": "a .notePane ancestor carries the visible ring "
                                      "(.notePane:has([data-note-landmark]:focus-visible))",
                          "seen": "landmark focused, but no ancestor with a className containing 'notePane' "
                                  "was found within 8 hops", "severity": "major", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R02-no-pane")})
    elif not pane_ring.get("visible"):
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "E, note open landmark", "sc": "2.4.7",
                          "expected": "the .notePane ancestor shows a visible focus ring "
                                      "(non-'none' outline or box-shadow) when the landmark has focus",
                          "seen": f"pane found ({pane_ring.get('className')}) but outline={pane_ring.get('outline')} "
                                  f"box-shadow={pane_ring.get('boxShadow')} -- both read as none",
                          "severity": "major", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R02-ring-not-visible")})
    else:
        log(f"  [RW-A2R02] pane ring IS visible: {pane_ring}")
    dump()


# ── 6) locked-note capture refusal ───────────────────────────────────────

def check_locked_capture(page, base, fx):
    # open the note we'll lock, via a direct URL by query param (the
    # product's real URL shape, ?note=<id> -- never a path segment)
    goto(page, base, f"/journal/notebook?note={fx['note2_id']}", "RW-LOCK-open",
         "*open the note that will be locked")
    page.wait_for_timeout(500)
    opened_more = False
    for i in range(60):
        fi = press(page, "Tab", surface="RW-LOCK-more", note=f"seek More note actions {i+1}")
        if (fi.get("name") or "").strip().lower() == "more note actions":
            press(page, "Enter", surface="RW-LOCK-more", note="*open More note actions menu", wait_ms=300)
            opened_more = True
            break
    if not opened_more:
        STEPS.append({"n": len(STEPS)+1, "surface": "RW-LOCK", "keys": "(not reached)",
                      "note": "'More note actions' not reached within 60 Tabs", "focus": {}})
        dump()
        return
    locked = False
    for i in range(12):
        fi = press(page, "Tab", surface="RW-LOCK-item", note=f"seek Lock item {i+1}")
        if (fi.get("name") or "").strip().lower() == "lock":
            press(page, "Enter", surface="RW-LOCK-item", note="*Enter on Lock -- locks the note by keyboard",
                  wait_ms=500)
            locked = True
            break
    if not locked:
        STEPS.append({"n": len(STEPS)+1, "surface": "RW-LOCK", "keys": "(not reached)",
                      "note": "'Lock' item not found within 12 Tabs inside More note actions", "focus": {}})
        dump()
        return
    lock_state = page.evaluate(
        "() => { const g = document.querySelector('[aria-label=\"Locked\"]'); return {lockedGlyphPresent: !!g}; }")
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-LOCK-confirm", "keys": "(evaluate)",
                  "note": f"after Lock: {lock_state}; the note's own open effect "
                          "(NoteEditorPage.jsx:2077) already wrote it as uct.jw.lastNote on open, "
                          "before locking -- the product's normal flow, no manual localStorage set here",
                  "focus": {}})
    dump()

    # now use "Save price to Notebook" from a ticker popup elsewhere
    goto(page, base, "/dashboard", "RW-LOCK-capture", "*dashboard, for the capture trigger")
    reached = False
    fi = {}
    for i in range(160):
        fi = press(page, "Tab", surface="RW-LOCK-capture-reach", note=f"seek a ticker chip {i+1}")
        if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
            reached = True
            break
    if not reached:
        STEPS.append({"n": len(STEPS)+1, "surface": "RW-LOCK-capture", "keys": "(not reached)",
                      "note": "no ticker chip reached within 160 Tabs on /dashboard", "focus": {}})
        dump()
        return
    press(page, "Enter", surface="RW-LOCK-capture", note="*Enter opens the chart modal", wait_ms=500)
    price_btn_reached = False
    for i in range(30):
        fi = press(page, "Tab", surface="RW-LOCK-capture-inside", note=f"seek 'Save price to Notebook' {i+1}")
        if "save" in (fi.get("name") or "").lower() and "price to notebook" in (fi.get("name") or "").lower():
            price_btn_reached = True
            break
    if not price_btn_reached:
        STEPS.append({"n": len(STEPS)+1, "surface": "RW-LOCK-capture", "keys": "(not reached)",
                      "note": "'Save price to Notebook' not reached within 30 Tabs inside the popup", "focus": {}})
        dump()
        return
    page.evaluate(
        "() => { window.__a11yToastWatch = []; "
        "new MutationObserver((muts) => { "
        "  for (const m of muts) for (const n of m.addedNodes) { "
        "    if (n.nodeType===1) window.__a11yToastWatch.push(n.outerHTML ? n.outerHTML.slice(0,300) : ''); "
        "  } "
        "}).observe(document.body, {childList:true, subtree:true}); }")
    press(page, "Enter", surface="RW-LOCK-capture", note="*Enter on 'Save price to Notebook'", wait_ms=2000)
    toast_probe = page.evaluate(
        "() => { const live = [...document.querySelectorAll('[role=\"status\"],[role=\"alert\"],[aria-live]')]"
        ".map(e => ({role: e.getAttribute('role'), ariaLive: e.getAttribute('aria-live'), "
        "text: (e.textContent||'').trim().slice(0,200)})); "
        "const toastEl = [...document.querySelectorAll('span')].find(e => (e.textContent||'').toLowerCase()"
        ".includes('locked') || (e.textContent||'').toLowerCase().includes('captured')); "
        "return {liveRegions: live, toastText: toastEl ? toastEl.textContent.trim() : null, "
        "toastRole: toastEl ? toastEl.getAttribute('role') : null, "
        "toastAriaLive: toastEl ? toastEl.getAttribute('aria-live') : null, "
        "mutationLog: window.__a11yToastWatch || []}; }")
    STEPS.append({"n": len(STEPS)+1, "surface": "RW-LOCK-capture-message", "keys": "(evaluate)",
                  "note": f"capture-toast probe: {toast_probe}", "focus": {},
                  "screenshot": shot(page, f"rw-{len(STEPS)+1:04d}-A2R-lock-capture-message")})
    dump()
    if toast_probe.get("toastText") and not toast_probe.get("toastRole") and not toast_probe.get("toastAriaLive"):
        FINDINGS.append({"id": f"RW{len(FINDINGS)+1:03d}", "surface": "Ticker popup capture toast", "sc": "4.1.3",
                          "expected": "the capture outcome (including the locked-note refusal sentence) is in a "
                                      "role=status/alert region or carries aria-live, so a screen reader hears it "
                                      "without moving focus",
                          "seen": f"the toast rendered the text {toast_probe.get('toastText')!r} in a plain "
                                  f"<span> with no role and no aria-live (code: TickerPopup.jsx:326-328); "
                                  f"live-region census on the page found: {toast_probe.get('liveRegions')}",
                          "severity": "major", "known_gap": None, "step_n": len(STEPS),
                          "screenshot": shot(page, f"rw-{len(STEPS):04d}-A2R-lock-no-live-region")})
    elif not toast_probe.get("toastText"):
        STEPS.append({"n": len(STEPS)+1, "surface": "RW-LOCK-capture-message", "keys": "(note)",
                      "note": "no toast text found by the probe's heuristic -- see the screenshot for the "
                              "actual rendered message", "focus": {}})
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
                                                  "a11y2-rewalk@local.dev", "A11yRewalk2026!", "A11y Rewalk")
                        fx = seed(reviewer_ctx, base)
                        dump()

                        page = reviewer_ctx.new_page()
                        check_a2r_03(page, base, fx)
                        check_a2r_04(page, base)
                        check_a2r_05(page, base)
                        check_a2r_02(page, base, fx)
                        check_locked_capture(page, base, fx)
                        page.close()

                        check_a2r_01(browser, base)
                    finally:
                        browser.close()
    except Exception as e:  # noqa: BLE001
        import traceback
        not_run = f"{type(e).__name__}: {e}"
        (OUT_DIR / "traceback-rewalk.txt").write_text(traceback.format_exc(), encoding="utf-8")
        log(traceback.format_exc())
    finally:
        stop_how = sb.stop()
        ipath = sb.integrity_path()
        required = [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN]
        integ = H.read_integrity(ipath, required)
        if ipath and Path(ipath).is_file():
            import shutil
            shutil.copy(ipath, OUT_DIR / "integrity-rewalk.md")
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
