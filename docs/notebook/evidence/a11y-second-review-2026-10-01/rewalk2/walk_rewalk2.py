"""Second-reviewer RE-WALK 2, restarted clean after a prior attempt's seeding
code wrote a fixture row into the shared local C:\\data\\desk.db (see the
"Re-walk 2" section of findings-and-wcag-map.md for the full incident writeup;
the failed attempt's script is preserved, NOT as evidence, at
.../scratchpad/a11y2-rewalk2-failed-script.py for the post-mortem).

HARD RULES for this restart (controller, 2026-10-01):
  1. This driver process NEVER imports `api.*` (or anything that imports it).
     Every fixture goes through the sandboxed server over HTTP
     (`ctx.request.post(base + ...)`), exactly like the J2 position/notes
     seeds below. A guard at the top (after all imports) and again at the end
     of the run asserts no module named `api` or `api.*` is in sys.modules.
  2. Controlled-mode TickerPopup: all seven `<TickerPopup open=...>` call
     sites were enumerated by source (grep `<TickerPopup\\s+sym=\\{\\w+\\}\\s+open\\b`).
     None can be reached both by REAL keyboard activation of their trigger AND
     seeded through a sandboxed-server-only HTTP endpoint (no direct import),
     so the controlled-mode check is recorded NOT RUN, with per-site reasons,
     below. Not invented: no seeding path is fabricated.
  3. Fresh data dir + fresh port (8300-8320 range, distinct from the crashed
     run's 8312). Integrity must read CLEAN at pre-boot, +15s, +120s AND
     shutdown, or the run is void.
  4. Raw evidence (this file, the focus log, screenshots, integrity log) is
     committed BEFORE the interpretive "Re-walk 2" section is written.

Checks, in order:
  1. RW-NEW-01 -- /dashboard: open a ticker popup with Enter, then (fresh
     reload) with Space; confirm focus lands inside the dialog immediately;
     Tab to "Save ... price to Notebook"; forward-wrap (Tab from the landing
     control all the way around back to itself, never escaping the dialog);
     backward-wrap (Shift+Tab from the landing control reaches the true last
     control, then one more Tab bounces back to the landing control); Escape
     restores focus to the trigger. Also one MOUSE click (the one click this
     review is allowed) on the dashboard, confirming focus still moves into
     the dialog that way.
  2. RW-NEW-01 continued -- /journal/trades?seg=open (Open Positions): same
     Enter/Space + wrap + restore checks, from a seeded position.
  3. Controlled-mode -- NOT RUN, with the seven-site citation and reasons.
  4. RW-NEW-02 -- lock a note by keyboard, then "Save ... price to Notebook"
     against it from a dashboard ticker popup; read the status region's
     role/aria-live/aria-atomic, whether it existed BEFORE the message, the
     text, and whether it is present at 0s/3s/7s and gone sometime after 8s.
     Then a successful capture (an unlocked note): confirm the success text
     renders in the SAME region and judge its (shorter) life.
  5. A2R-05, the two former exceptions -- /uct-20: the ticker chip is its own
     tab stop (not nested in the row's role=button), Enter opens the popup
     and does NOT expand the row; the caret button toggles aria-expanded via
     Enter AND Space and does NOT open the popup. NewsFeed: NOT RUN -- the
     default build strips it via Vite dead-code elimination on the
     VITE_TWITTER_UI_ENABLED fold (re-confirmed below by grep against the
     built bundle), and building+walking a second VITE_TWITTER_UI_ENABLED=0
     bundle was out of scope for this restart (recorded, not silently
     skipped).
  6. Regression checks -- hovering a ticker trigger never steals focus;
     typing in the popup's "Switch ticker" box never fires a page hotkey.
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

# ---------------------------------------------------------------------------
# HARD RULE 1, part A: putting REPO on sys.path is fine (needed below to
# import `tools.notebook_perf_harness` + `sandbox_identity`, both test infra,
# not the product's `api` package). What this driver must NEVER do is
# `from api... import ...` -- no direct service-layer import, anywhere in
# this file. The guard right after that lazy import, and again at the very
# end of the run, proves nothing in this process ever pulled api.* in.
# ---------------------------------------------------------------------------

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
    (OUT_DIR / "focus-log-rewalk2.json").write_text(
        json.dumps({"steps": STEPS, "findings": FINDINGS}, indent=2), encoding="utf-8")


def assert_no_api_import(where: str) -> None:
    offenders = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    if offenders:
        raise RuntimeError(
            f"HARD RULE 1 VIOLATION at {where}: these api.* modules are in "
            f"sys.modules, meaning something in this driver process imported "
            f"the product's backend directly: {offenders}. Every fixture must "
            f"go through the sandboxed server over HTTP instead.")
    log(f"  [guard] no api.* module in sys.modules ({where}) -- OK")


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
  const dialogAnc = el.closest ? el.closest('[role="dialog"]') : null;
  let nestedInInteractive = null;
  if (el.parentElement) {
    const p = el.parentElement.closest('[role="button"],a,button');
    nestedInInteractive = p ? {tag: p.tagName, role: p.getAttribute('role'), name: (p.getAttribute('aria-label')||p.textContent||'').trim().slice(0,40)} : null;
  }
  return {present: true, tag: el.tagName.toLowerCase(), role, name,
    ariaExpanded: el.getAttribute('aria-expanded'), ariaPressed: el.getAttribute('aria-pressed'),
    inDialog: !!dialogAnc, nestedInInteractive,
    rect: {x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)},
    visibleIndicator: !(outlineNone && boxShadowNone),
    outline: cs.outline, boxShadow: cs.boxShadow.slice(0,160)};
}
"""

_OVERLAY_JS = (
    "() => { const els=[...document.querySelectorAll('*')]; "
    "const ov = els.find(e => { const cs=getComputedStyle(e); return cs.position==='fixed' && "
    "parseInt(cs.zIndex||'0')>=99999; }); return !!ov; }"
)


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


def press(page, keys, *, surface, note="", finding=None, sc=None, severity=None, wait_ms=160, known_gap=None):
    page.keyboard.press(keys)
    page.wait_for_timeout(wait_ms)
    fi = focus_info(page)
    rec = {"n": len(STEPS) + 1, "surface": surface, "keys": keys, "note": note, "focus": fi}
    if finding or note.startswith("*"):
        rec["screenshot"] = shot(page, f"r2-{len(STEPS)+1:04d}-{surface}".replace(" ", "_").replace("/", "-"))
    STEPS.append(rec)
    if finding:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface, "sc": sc,
                          "expected": finding.split("||")[0] if "||" in finding else finding,
                          "seen": finding.split("||")[1] if "||" in finding else "",
                          "severity": severity, "known_gap": known_gap, "step_n": rec["n"],
                          "screenshot": rec.get("screenshot", "")})
    log(f"  [{rec['n']:04d}] {surface} <{keys}> -> {fi.get('role')} \"{(fi.get('name') or '')[:50]}\" {note}")
    dump()
    return fi


def goto(page, base, path, surface, note="*nav"):
    page.goto(base + path, wait_until="domcontentloaded", timeout=30000)
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
    p = shot(page, f"r2-{len(STEPS)+1:04d}-{surface}-nav".replace(" ", "_").replace("/", "-"))
    STEPS.append({"n": len(STEPS) + 1, "surface": surface, "keys": "(navigate)", "note": note,
                  "focus": focus_info(page), "screenshot": p})
    log(f"  [{len(STEPS):04d}] {surface} (navigate) {note}")
    dump()


def observe(page, surface, note):
    page.wait_for_timeout(150)
    fi = focus_info(page)
    p = shot(page, f"r2-{len(STEPS)+1:04d}-{surface}".replace(" ", "_").replace("/", "-"))
    STEPS.append({"n": len(STEPS) + 1, "surface": surface, "keys": "(observe)", "note": note,
                  "focus": fi, "screenshot": p})
    log(f"  [{len(STEPS):04d}] {surface} (observe) {note}")
    dump()
    return fi


# ── account provisioning + seeding (HTTP ONLY -- hard rule 1) ───────────────

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
    r = ctx.request.post(base + "/api/j2/positions", data=json.dumps({
        "symbol": "AAPL", "side": "Long", "entryDate": "2026-09-15",
        "shares": 5, "entryPrice": 200.0, "stopPrice": 180.0,
    }), headers={"Content-Type": "application/json"})
    if r.status not in (200, 201):
        raise RuntimeError(f"seed position failed {r.status} {r.text()[:300]}")
    log(f"  [seed] open position: {r.status}")

    def mk_note(title):
        rn = ctx.request.post(base + "/api/j2/notes", data=json.dumps({
            "title": title, "bodyJson": DOC(P("content " + title))}),
            headers={"Content-Type": "application/json"})
        if rn.status not in (200, 201):
            raise RuntimeError(f"create note {title!r}: {rn.status} {rn.text()[:200]}")
        return rn.json()["note"]["id"]

    fx["note_lock_id"] = mk_note("RW2 note to lock")
    fx["note_unlocked_id"] = mk_note("RW2 note unlocked")
    log(f"  [seed] notes: lock={fx['note_lock_id']} unlocked={fx['note_unlocked_id']}")
    return fx


# ── ticker-popup deep check (RW-NEW-01), shared by dashboard + Open Positions

def ticker_popup_deep_check(page, surface_prefix, *, open_key, allow_mouse=False, max_tab_budget=160):
    """Tab to a 'View chart for X' trigger (or click it, if allow_mouse), open
    with open_key, confirm focus lands inside the dialog immediately, Tab to
    the price-capture button, forward-wrap (keep tabbing until focus returns
    to the FIRST landed control), backward-wrap (Shift+Tab from the first
    landed control reaches a different control still inside the dialog, then
    one more Tab bounces straight back), Escape restores focus to the
    trigger."""
    reached = False
    fi = {}
    trigger_name = None
    if allow_mouse:
        # the ONE allowed mouse click, scoped to this single check
        loc = page.locator('[aria-label^="View chart for"]').first
        try:
            loc.wait_for(state="visible", timeout=8000)
            trigger_name = loc.get_attribute("aria-label")
            loc.click()
            page.wait_for_timeout(450)
            fi = focus_info(page)
            STEPS.append({"n": len(STEPS)+1, "surface": f"{surface_prefix}-mouseclick", "keys": "(mouse click)",
                          "note": f"*the ONE allowed mouse click this review makes -- {trigger_name!r}",
                          "focus": fi, "screenshot": shot(page, f"r2-{len(STEPS)+1:04d}-{surface_prefix}-mouseclick")})
            dump()
            reached = fi.get("inDialog") is True
            if not reached:
                FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.1",
                                  "expected": "a mouse click on the trigger ALSO moves focus inside the dialog",
                                  "seen": f"focus after click: {fi}", "severity": "major", "known_gap": None,
                                  "step_n": len(STEPS), "screenshot": shot(page, f"r2-{len(STEPS):04d}-{surface_prefix}-mouseclick-fail")})
                dump()
                return {"mouse_opened_in_dialog": False}
            # confirm it, then close so the keyboard doors below start clean
            press(page, "Escape", surface=f"{surface_prefix}-mouseclick", note="close the mouse-opened popup")
            return {"mouse_opened_in_dialog": True}
        except Exception as e:  # noqa: BLE001
            FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.1",
                              "expected": "a mouse click on a ticker trigger opens the popup",
                              "seen": f"locator/click failed: {e}", "severity": "major", "known_gap": None,
                              "step_n": len(STEPS), "screenshot": ""})
            dump()
            return {"mouse_opened_in_dialog": False}

    for i in range(max_tab_budget):
        fi = press(page, "Tab", surface=f"{surface_prefix}-reach", note=f"seek a ticker chip {i+1}")
        if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
            reached = True
            break
    if not reached:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.1",
                          "expected": "a ticker chip ('View chart for ...') reachable by Tab",
                          "seen": f"not reached within {max_tab_budget} Tabs", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        dump()
        return {"reached": False}
    trigger_name = fi.get("name")

    fi = press(page, open_key, surface=f"{surface_prefix}-open",
               note=f"*{open_key} opens {trigger_name!r} -- where is focus NOW?", wait_ms=450)
    landed_in_dialog = fi.get("inDialog") is True
    first_control = dict(fi)
    if not landed_in_dialog:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.4.3",
                          "expected": f"{open_key} on the trigger moves focus into the dialog immediately",
                          "seen": f"focus after {open_key}: {fi}", "severity": "blocker", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": shot(page, f"r2-{len(STEPS):04d}-{surface_prefix}-not-in-dialog")})
        dump()
        return {"reached": True, "landed_in_dialog": False}

    # Tab to the price-capture button
    price_reached = False
    price_tabs = 0
    for i in range(40):
        fi2 = press(page, "Tab", surface=f"{surface_prefix}-inside", note=f"tab inside popup {i+1}")
        price_tabs = i + 1
        name_l = (fi2.get("name") or "").lower()
        if "save" in name_l and "price to notebook" in name_l:
            price_reached = True
            break
        if fi2.get("inDialog") is not True:
            FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.2",
                              "expected": "Tab stays inside the dialog while seeking the capture button",
                              "seen": f"left the dialog after {i+1} Tabs onto {fi2}", "severity": "blocker",
                              "known_gap": None, "step_n": len(STEPS),
                              "screenshot": shot(page, f"r2-{len(STEPS):04d}-{surface_prefix}-escaped-seeking-price")})
            dump()
            break
    if not price_reached:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.1",
                          "expected": "'Save ... price to Notebook' reachable inside the popup within a handful of Tabs",
                          "seen": f"not found within 40 Tabs (price_tabs budget exhausted)", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        dump()

    # forward-wrap: keep tabbing (bounded) until focus returns to first_control
    wrapped_forward = False
    escaped_forward = False
    seen_names = []
    for i in range(60):
        fi3 = press(page, "Tab", surface=f"{surface_prefix}-fwdwrap", note=f"forward-wrap probe {i+1}")
        seen_names.append((fi3.get("role"), fi3.get("name")))
        if fi3.get("inDialog") is not True:
            escaped_forward = True
            FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.2",
                              "expected": "Tab never leaves the dialog -- it wraps from the last control to the first",
                              "seen": f"left the dialog after {i+1} further Tabs onto {fi3}", "severity": "blocker",
                              "known_gap": None, "step_n": len(STEPS),
                              "screenshot": shot(page, f"r2-{len(STEPS):04d}-{surface_prefix}-fwdwrap-escaped")})
            dump()
            break
        if fi3.get("name") == first_control.get("name") and fi3.get("role") == first_control.get("role"):
            wrapped_forward = True
            break
    if not wrapped_forward and not escaped_forward:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.2",
                          "expected": "Tab wraps all the way around back to the first control within 60 Tabs",
                          "seen": f"never returned to {first_control.get('name')!r}; distinct names seen: "
                                  f"{sorted(set(n for _, n in seen_names))}", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        dump()

    # backward-wrap: from first_control (we should be back on it if wrapped_forward,
    # or wherever we stopped otherwise -- re-navigate to first_control deliberately
    # isn't possible without re-opening, so this check is only meaningful right
    # after landing; redo it freshly from a fresh open if the forward probe moved on)
    back_to_first = None
    wrapped_backward = None
    if wrapped_forward:
        fi4 = press(page, "Shift+Tab", surface=f"{surface_prefix}-backwrap",
                    note="*Shift+Tab from the first control -- should reach the TRUE last control, still inside")
        last_control = dict(fi4)
        wrapped_backward = fi4.get("inDialog") is True and not (
            fi4.get("name") == first_control.get("name") and fi4.get("role") == first_control.get("role"))
        if fi4.get("inDialog") is not True:
            FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.2",
                              "expected": "Shift+Tab from the first control stays inside the dialog (wraps to the last control)",
                              "seen": f"Shift+Tab left the dialog onto {fi4}", "severity": "blocker",
                              "known_gap": None, "step_n": len(STEPS),
                              "screenshot": shot(page, f"r2-{len(STEPS):04d}-{surface_prefix}-backwrap-escaped")})
            dump()
        else:
            fi5 = press(page, "Tab", surface=f"{surface_prefix}-backwrap",
                        note="*one more Tab should bounce straight back to the first control")
            back_to_first = (fi5.get("name") == first_control.get("name") and fi5.get("role") == first_control.get("role"))
            if not back_to_first:
                FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.1.2",
                                  "expected": "Tab from the true last control (reached via Shift+Tab) bounces back to the first",
                                  "seen": f"landed on {fi5} instead of {first_control.get('name')!r}", "severity": "major",
                                  "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
                dump()

    # Escape restores focus to the trigger
    press(page, "Escape", surface=f"{surface_prefix}-close", note="*Escape closes -- focus should return to trigger")
    after = focus_info(page)
    restored = (after.get("name") == trigger_name)
    STEPS.append({"n": len(STEPS)+1, "surface": f"{surface_prefix}-close", "keys": "(compare)",
                  "note": f"trigger={trigger_name!r} after_escape={after.get('name')!r} restored={restored}",
                  "focus": {}})
    if not restored:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": surface_prefix, "sc": "2.4.3",
                          "expected": "focus returns to the trigger on Escape",
                          "seen": f"trigger={trigger_name!r}, after={after.get('name')!r}", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
    dump()
    return {"reached": True, "landed_in_dialog": landed_in_dialog, "price_tabs": price_tabs,
            "price_reached": price_reached, "wrapped_forward": wrapped_forward,
            "wrapped_backward": wrapped_backward, "back_to_first": back_to_first, "restored": restored}


# ── 1+2) RW-NEW-01: dashboard + Open Positions ──────────────────────────────

def check_rw_new_01(page, base):
    results = {}
    # dashboard, Enter door
    goto(page, base, "/dashboard", "R2-dash-enter", "*dashboard, Enter door")
    results["dash_enter"] = ticker_popup_deep_check(page, "R2-dash-enter", open_key="Enter")
    # dashboard, Space door (fresh reload)
    goto(page, base, "/dashboard", "R2-dash-space", "*dashboard, Space door, fresh reload")
    results["dash_space"] = ticker_popup_deep_check(page, "R2-dash-space", open_key=" ")
    # dashboard, the ONE allowed mouse click
    goto(page, base, "/dashboard", "R2-dash-mouse", "*dashboard, the one allowed mouse click")
    results["dash_mouse"] = ticker_popup_deep_check(page, "R2-dash-mouse", open_key=None, allow_mouse=True)

    # Open Positions: /journal/trades?seg=open. The table may default to card
    # view, so seek "Table" first and activate it if seen before the trigger.
    def open_positions_pass(open_key):
        goto(page, base, "/journal/trades?seg=open", "R2-op",
             f"*Open Positions, direct URL, {open_key!r}-door pass")
        page.wait_for_timeout(500)
        table_activated = False
        for i in range(90):
            fi = press(page, "Tab", surface="R2-op-reach", note=f"seek trigger or Table toggle {i+1}")
            if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
                # rewind one Tab's worth of bookkeeping is not possible; instead
                # re-run the deep check from here by treating this AS the reach
                # loop inside ticker_popup_deep_check would -- simplest correct
                # approach: Shift+Tab back one so ticker_popup_deep_check's own
                # reach loop lands on the same trigger fresh.
                press(page, "Shift+Tab", surface="R2-op-reach", note="back off one so the deep check reaches it itself")
                break
            if (not table_activated and fi.get("role") == "button"
                    and (fi.get("name") or "").strip().lower() == "table"):
                press(page, "Enter", surface="R2-op-reach", note="*switch to Table view", wait_ms=400)
                table_activated = True
        return ticker_popup_deep_check(page, f"R2-op-{open_key!r}", open_key=open_key, max_tab_budget=90)

    results["op_enter"] = open_positions_pass("Enter")
    results["op_space"] = open_positions_pass(" ")
    return results


# ── 3) controlled-mode: NOT RUN, with citations ─────────────────────────────

CONTROLLED_MODE_SITES = [
    ("app/src/pages/LiveFlowMassive.jsx:4929", "`<TickerPopup sym={chartSym} open darkPool onClose=...>`",
     "trigger is `onOpenChart={setChartSym}` wired through a long-press-only cell "
     "(`useLongPress`), with no `tabIndex`/`onKeyDown` -- not a data problem, a design "
     "one; out of scope for this a11y pass"),
    ("app/src/pages/LiveFlow.jsx:2368", "`<TickerPopup sym={chartSym} open onClose=...>`",
     "same long-press-only trigger family as LiveFlowMassive (`onOpenChart={setChartSym}`)"),
    ("app/src/pages/OptionsFlow.jsx:9718", "`<TickerPopup sym={chartSym} open onClose=...>`",
     "same long-press-only trigger family, via `ChartHoldCell`'s `onOpen={setChartSym}`"),
    ("app/src/components/research/sections/AskAiSection.jsx:52", "`<TickerPopup sym={chartSym} open onClose=...>`",
     "trigger is a ticker BUTTON rendered inside an AI Search answer (`AiSearchWidget`'s "
     "`onTicker={setChartSym}`), which needs a live Anthropic completion to populate; "
     "ANTHROPIC_API_KEY is not set in this sandbox's environment (confirmed: "
     "`'ANTHROPIC_API_KEY' in os.environ` is False), so no answer -- and therefore no "
     "ticker button -- can be produced locally"),
    ("app/src/pages/community/ThreadView.jsx:185", "`<TickerPopup sym={chipSym} open onClose=...>`",
     "trigger is `onClick={onChipClick}` on the whole `.threadView` container (delegated "
     "click), no `onKeyDown`; the chip itself (`tickerMention.js`'s `renderHTML`) is a "
     "bare `<span data-ticker=...>` with no `tabindex`/`role` -- not keyboard-reachable "
     "by design, a separate pre-existing gap"),
    ("app/src/pages/community/ChatView.jsx:267", "`<TickerPopup sym={chipSym} open onClose=...>`",
     "identical trigger family to ThreadView (delegated onClick, no onKeyDown, bare span chip)"),
    ("app/src/pages/desk/ArticleReader.jsx:698", "`<TickerPopup sym={chartSym} open onClose=...>`",
     "the ONE site with a genuinely keyboard-native trigger -- `visibleTickers.map` "
     "renders a real `<button type=\"button\" onClick={() => setChartSym(sym)}>` per "
     "ticker chip at the foot of an article. But reaching it needs a Desk article with "
     "tickers in its body, and `api/routers/desk.py` exposes no HTTP endpoint to CREATE "
     "one -- only `POST /articles/reindex`/`POST /articles/backfill` (rebuild/convert "
     "EXISTING posts) and `POST /publications/{id}/poll` (fetch a REAL external Substack "
     "feed over the network). Seeding one would need either the forbidden direct "
     "`api.services.desk_store` import (the exact mechanism that wrote into the shared "
     "C:\\data\\desk.db last run) or a live network fetch against a real Substack URL, "
     "which is out of this sandbox's local-only discipline. No seeding path is invented; "
     "this is recorded NOT RUN rather than reached by either forbidden route. The fix "
     "lane's OWN unit test (`app/src/components/TickerPopup.focusTrap.test.jsx`, "
     "describe block \"RW-NEW-01: controlled mode (open/onClose, no trigger)\") exercises "
     "the controlled-mode `open`/`onClose` contract directly -- `<TickerPopup sym=\"NVDA\" "
     "open onClose=...>` under a synthetic harness, in jsdom via vitest, not a real "
     "browser and not this review's own evidence, but worth citing as mechanism coverage "
     "that DOES exist."),
]


def record_controlled_mode_not_run():
    for loc, jsx, reason in CONTROLLED_MODE_SITES:
        STEPS.append({"n": len(STEPS)+1, "surface": "R2-controlled", "keys": "(source review)",
                      "note": f"{loc} -- {jsx} -- {reason}", "focus": {}})
    FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "controlled-mode TickerPopup (all 7 sites)",
                      "sc": "not applicable", "expected": "NOT RUN",
                      "seen": "all seven `<TickerPopup open=...>` call sites enumerated by source; six have "
                              "no keyboard-native trigger at all (a pre-existing design gap, not this review's "
                              "to fix); the seventh (ArticleReader.jsx) has a real button trigger but no "
                              "sandboxed-server-only way to seed the article data it needs, so it is recorded "
                              "NOT RUN rather than reached via a forbidden direct-import or live-network "
                              "seeding path. See the step log immediately above for all seven citations.",
                      "severity": "info", "known_gap": "NOT RUN -- recorded, not invented", "step_n": len(STEPS),
                      "screenshot": ""})
    dump()


# ── 4) RW-NEW-02: locked-note refusal + successful capture, status region ──

STATUS_PROBE_JS = (
    "() => { const el = document.querySelector('[data-testid=\"capture-status\"]'); "
    "if (!el) return {present: false}; "
    "return {present: true, role: el.getAttribute('role'), ariaLive: el.getAttribute('aria-live'), "
    "ariaAtomic: el.getAttribute('aria-atomic'), text: (el.textContent||'').trim()}; }"
)


def lock_note_by_keyboard(page, base, note_id):
    goto(page, base, f"/journal/notebook?note={note_id}", "R2-lock-open", "*open the note that will be locked")
    page.wait_for_timeout(500)
    opened_more = False
    for i in range(60):
        fi = press(page, "Tab", surface="R2-lock-more", note=f"seek More note actions {i+1}")
        if (fi.get("name") or "").strip().lower() == "more note actions":
            press(page, "Enter", surface="R2-lock-more", note="*open More note actions menu", wait_ms=300)
            opened_more = True
            break
    if not opened_more:
        STEPS.append({"n": len(STEPS)+1, "surface": "R2-lock", "keys": "(not reached)",
                      "note": "'More note actions' not reached within 60 Tabs", "focus": {}})
        dump()
        return False
    for i in range(12):
        fi = press(page, "Tab", surface="R2-lock-item", note=f"seek Lock item {i+1}")
        if (fi.get("name") or "").strip().lower() == "lock":
            press(page, "Enter", surface="R2-lock-item", note="*Enter on Lock -- locks the note by keyboard",
                  wait_ms=500)
            return True
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-lock", "keys": "(not reached)",
                  "note": "'Lock' item not found within 12 Tabs inside More note actions", "focus": {}})
    dump()
    return False


def check_rw_new_02(page, base, fx):
    locked = lock_note_by_keyboard(page, base, fx["note_lock_id"])
    if not locked:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "R2-lock", "sc": "n/a",
                          "expected": "the note locks by keyboard so the refusal capture can be tested",
                          "seen": "could not lock the note -- see steps above", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        dump()
        return

    # before any capture: confirm the status region EXISTS and is EMPTY
    goto(page, base, "/dashboard", "R2-cap-refuse", "*dashboard, for the refusal capture")
    pre = page.evaluate(STATUS_PROBE_JS)
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-refuse-pre", "keys": "(evaluate)",
                  "note": f"status region BEFORE any capture: {pre}", "focus": {}})
    dump()
    if not pre.get("present"):
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "TickerPopup capture status", "sc": "4.1.3",
                          "expected": "the status region exists in the DOM before any capture (so AT has already "
                                      "discovered it when a message lands)",
                          "seen": f"{pre}", "severity": "major", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": ""})
        dump()

    reached = False
    fi = {}
    for i in range(160):
        fi = press(page, "Tab", surface="R2-cap-refuse-reach", note=f"seek a ticker chip {i+1}")
        if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
            reached = True
            break
    if not reached:
        STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-refuse", "keys": "(not reached)",
                      "note": "no ticker chip reached within 160 Tabs on /dashboard", "focus": {}})
        dump()
        return
    press(page, "Enter", surface="R2-cap-refuse", note="*Enter opens the chart modal", wait_ms=500)
    price_reached = False
    for i in range(30):
        fi = press(page, "Tab", surface="R2-cap-refuse-inside", note=f"seek 'Save ... price to Notebook' {i+1}")
        name_l = (fi.get("name") or "").lower()
        if "save" in name_l and "price to notebook" in name_l:
            price_reached = True
            break
    if not price_reached:
        STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-refuse", "keys": "(not reached)",
                      "note": "'Save price to Notebook' not reached within 30 Tabs inside the popup", "focus": {}})
        dump()
        return

    t0 = press(page, "Enter", surface="R2-cap-refuse", note="*Enter on 'Save price to Notebook' -- t=0", wait_ms=200)
    probe0 = page.evaluate(STATUS_PROBE_JS)
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-refuse-t0", "keys": "(evaluate)",
                  "note": f"status region at t~0.2s: {probe0}", "focus": {},
                  "screenshot": shot(page, f"r2-{len(STEPS)+1:04d}-cap-refuse-t0")})
    dump()
    page.wait_for_timeout(2800)
    probe3 = page.evaluate(STATUS_PROBE_JS)
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-refuse-t3", "keys": "(evaluate)",
                  "note": f"status region at t~3s: {probe3}", "focus": {}})
    dump()
    page.wait_for_timeout(4000)
    probe7 = page.evaluate(STATUS_PROBE_JS)
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-refuse-t7", "keys": "(evaluate)",
                  "note": f"status region at t~7s: {probe7}", "focus": {}})
    dump()
    page.wait_for_timeout(2000)
    probe9 = page.evaluate(STATUS_PROBE_JS)
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-refuse-t9", "keys": "(evaluate)",
                  "note": f"status region at t~9s: {probe9}", "focus": {},
                  "screenshot": shot(page, f"r2-{len(STEPS)+1:04d}-cap-refuse-t9")})
    dump()

    judgement = {
        "role_ok": probe0.get("role") == "status",
        "aria_live_ok": probe0.get("ariaLive") == "polite",
        "aria_atomic_ok": probe0.get("ariaAtomic") == "true",
        "present_before": pre.get("present") is True and not pre.get("text"),
        "text_at_t0": probe0.get("text"), "text_at_t3": probe3.get("text"),
        "text_at_t7": probe7.get("text"), "text_at_t9": probe9.get("text"),
        "held_through_7s": bool(probe3.get("text")) and bool(probe7.get("text")),
        "gone_by_t9": not probe9.get("text"),
    }
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-refuse-judge", "keys": "(judge)",
                  "note": f"RW-NEW-02 refusal judgement: {judgement}", "focus": {}})
    dump()
    if not (judgement["role_ok"] and judgement["aria_live_ok"] and judgement["aria_atomic_ok"]):
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "TickerPopup capture status (refusal)",
                          "sc": "4.1.2", "expected": "role=status, aria-live=polite, aria-atomic=true",
                          "seen": f"t0 probe: {probe0}", "severity": "major", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": ""})
        dump()
    if not judgement["held_through_7s"]:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "TickerPopup capture status (refusal)",
                          "sc": "2.2.1", "expected": "the refusal message (CAPTURE_TOAST_HOLD_MS=8000) is still "
                                                      "present at t=3s and t=7s",
                          "seen": f"t3={probe3.get('text')!r} t7={probe7.get('text')!r}", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        dump()
    else:
        log(f"  [RW-NEW-02] refusal message held through 7s: {judgement}")

    # successful capture (unlocked note is now last-active by virtue of the
    # lock flow above having made note_lock_id last-active; open the unlocked
    # note to make IT last-active instead, then capture again)
    goto(page, base, f"/journal/notebook?note={fx['note_unlocked_id']}", "R2-cap-success-setlast",
         "*open the UNLOCKED note so it becomes last-active")
    page.wait_for_timeout(400)
    goto(page, base, "/dashboard", "R2-cap-success", "*dashboard, for the successful capture")
    reached2 = False
    for i in range(160):
        fi = press(page, "Tab", surface="R2-cap-success-reach", note=f"seek a ticker chip {i+1}")
        if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
            reached2 = True
            break
    if not reached2:
        STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-success", "keys": "(not reached)",
                      "note": "no ticker chip reached within 160 Tabs", "focus": {}})
        dump()
        return
    press(page, "Enter", surface="R2-cap-success", note="*Enter opens the chart modal", wait_ms=500)
    price_reached2 = False
    for i in range(30):
        fi = press(page, "Tab", surface="R2-cap-success-inside", note=f"seek 'Save ... price to Notebook' {i+1}")
        name_l = (fi.get("name") or "").lower()
        if "save" in name_l and "price to notebook" in name_l:
            price_reached2 = True
            break
    if not price_reached2:
        STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-success", "keys": "(not reached)",
                      "note": "'Save price to Notebook' not reached within 30 Tabs", "focus": {}})
        dump()
        return
    press(page, "Enter", surface="R2-cap-success", note="*Enter on 'Save price to Notebook' (unlocked) -- t=0",
          wait_ms=200)
    sprobe0 = page.evaluate(STATUS_PROBE_JS)
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-success-t0", "keys": "(evaluate)",
                  "note": f"status region at t~0.2s (success case): {sprobe0}", "focus": {},
                  "screenshot": shot(page, f"r2-{len(STEPS)+1:04d}-cap-success-t0")})
    dump()
    page.wait_for_timeout(1200)
    sprobe1 = page.evaluate(STATUS_PROBE_JS)
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-success-t1_4", "keys": "(evaluate)",
                  "note": f"status region at t~1.4s: {sprobe1}", "focus": {}})
    dump()
    page.wait_for_timeout(2200)
    sprobe3_6 = page.evaluate(STATUS_PROBE_JS)
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-success-t3_6", "keys": "(evaluate)",
                  "note": f"status region at t~3.6s (past CAPTURE_TOAST_SUCCESS_MS=2500): {sprobe3_6}", "focus": {}})
    dump()
    s_judgement = {
        "same_region": sprobe0.get("role") == "status" and sprobe0.get("ariaLive") == "polite",
        "text_at_t0": sprobe0.get("text"), "text_at_t1_4": sprobe1.get("text"), "text_at_t3_6": sprobe3_6.get("text"),
        "life_shorter_than_refusal": bool(sprobe0.get("text")) and not sprobe3_6.get("text"),
    }
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-cap-success-judge", "keys": "(judge)",
                  "note": f"RW-NEW-02 success-capture judgement: {s_judgement}", "focus": {}})
    dump()
    if not s_judgement["same_region"]:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "TickerPopup capture status (success)",
                          "sc": "4.1.2", "expected": "the success message renders in the SAME role=status region",
                          "seen": f"{sprobe0}", "severity": "major", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": ""})
        dump()
    if not s_judgement["text_at_t0"]:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "TickerPopup capture status (success)",
                          "sc": "4.1.3", "expected": "a successful capture produces visible status text",
                          "seen": f"t0 probe empty: {sprobe0}", "severity": "major", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": ""})
        dump()


# ── 5) A2R-05: UCT20 chip/caret + NewsFeed NOT RUN ──────────────────────────

def check_a2r_05(page, base):
    goto(page, base, "/uct-20", "R2-uct20", "*uct-20")
    reached = False
    fi = {}
    for i in range(120):
        fi = press(page, "Tab", surface="R2-uct20-reach", note=f"seek a ticker chip {i+1}")
        if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
            reached = True
            break
    if not reached:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "UCT20 ticker chip", "sc": "2.1.1",
                          "expected": "a ticker chip reachable by Tab on /uct-20",
                          "seen": "not reached within 120 Tabs", "severity": "major", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": ""})
        dump()
        return
    nested = fi.get("nestedInInteractive")
    if nested:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "UCT20 ticker chip", "sc": "4.1.2",
                          "expected": "the chip's own tab stop is NOT nested inside another interactive element "
                                      "(the row no longer carries role=button per the fix lane's change)",
                          "seen": f"nestedInInteractive={nested}", "severity": "blocker", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": shot(page, f"r2-{len(STEPS):04d}-uct20-nested")})
        dump()
    else:
        log(f"  [A2R-05] UCT20 chip is its own tab stop, not nested in an interactive ancestor")
    trigger_name = fi.get("name")
    row_expanded_before = page.evaluate(
        "() => { const b = [...document.querySelectorAll('button[aria-expanded]')]; "
        "return b.length ? b.map(x => x.getAttribute('aria-expanded')) : null; }")
    press(page, "Enter", surface="R2-uct20-chip", note="*Enter on the ticker chip -- should open popup, NOT expand row",
          wait_ms=450)
    modal_open = page.evaluate("() => !!document.querySelector('[role=\"dialog\"]')")
    row_expanded_after = page.evaluate(
        "() => { const b = [...document.querySelectorAll('button[aria-expanded]')]; "
        "return b.length ? b.map(x => x.getAttribute('aria-expanded')) : null; }")
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-uct20-chip", "keys": "(evaluate)",
                  "note": f"modal_open={modal_open} row_expanded before={row_expanded_before} after={row_expanded_after}",
                  "focus": {}})
    dump()
    if not modal_open:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "UCT20 ticker chip", "sc": "2.1.1",
                          "expected": "Enter on the chip opens the TickerPopup dialog",
                          "seen": f"no [role=dialog] found after Enter", "severity": "blocker", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": shot(page, f"r2-{len(STEPS):04d}-uct20-no-modal")})
        dump()
    if row_expanded_before != row_expanded_after:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "UCT20 ticker chip", "sc": "4.1.2",
                          "expected": "Enter on the chip does NOT also toggle the row's expand state",
                          "seen": f"before={row_expanded_before} after={row_expanded_after}", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        dump()
    else:
        log("  [A2R-05] Enter on the chip opened the popup and did NOT expand the row")
    if modal_open:
        press(page, "Escape", surface="R2-uct20-chip", note="close")

    # the caret button: Enter and Space both toggle aria-expanded, neither opens the popup
    goto(page, base, "/uct-20", "R2-uct20-caret", "*uct-20, fresh, for the caret button")
    caret_reached = False
    for i in range(120):
        fi = press(page, "Tab", surface="R2-uct20-caret-reach", note=f"seek the caret button {i+1}")
        name_l = (fi.get("name") or "").lower()
        if fi.get("role") == "button" and ("expand" in name_l or "collapse" in name_l) and "details" in name_l:
            caret_reached = True
            break
    if not caret_reached:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "UCT20 caret button", "sc": "2.1.1",
                          "expected": "the row's caret/expand button reachable by Tab",
                          "seen": "not reached within 120 Tabs", "severity": "major", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": ""})
        dump()
        return
    before_exp = fi.get("ariaExpanded")
    for key in ("Enter", " "):
        fi_after = press(page, key, surface="R2-uct20-caret", note=f"*{key!r} on the caret", wait_ms=350)
        after_exp = page.evaluate(
            "() => { const el = document.activeElement; return el ? el.getAttribute('aria-expanded') : null; }")
        modal_now = page.evaluate("() => !!document.querySelector('[role=\"dialog\"]')")
        STEPS.append({"n": len(STEPS)+1, "surface": "R2-uct20-caret", "keys": "(evaluate)",
                      "note": f"{key!r}: before_exp={before_exp} after_exp={after_exp} modal_open={modal_now}",
                      "focus": {}})
        dump()
        if after_exp == before_exp:
            FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "UCT20 caret button", "sc": "4.1.2",
                              "expected": f"{key!r} toggles the caret's aria-expanded",
                              "seen": f"before={before_exp} after={after_exp}", "severity": "major",
                              "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
            dump()
        if modal_now:
            FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "UCT20 caret button", "sc": "4.1.2",
                              "expected": f"{key!r} on the caret must NOT open the TickerPopup dialog",
                              "seen": "a [role=dialog] appeared after activating the caret", "severity": "blocker",
                              "known_gap": None, "step_n": len(STEPS),
                              "screenshot": shot(page, f"r2-{len(STEPS):04d}-uct20-caret-opened-modal")})
            dump()
            press(page, "Escape", surface="R2-uct20-caret", note="close the unexpected modal")
        before_exp = after_exp

    # NewsFeed -- NOT RUN, re-confirmed by grep against the built bundle
    dist = REPO / "app" / "dist" / "assets"
    bundle_has_newsfeed = False
    try:
        for f in dist.glob("*.js"):
            if "data-ticker-chip" in f.read_text(encoding="utf-8", errors="ignore"):
                bundle_has_newsfeed = True
                break
    except Exception:  # noqa: BLE001
        pass
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-newsfeed", "keys": "(bundle grep)",
                  "note": f"grepped app/dist/assets/*.js for 'data-ticker-chip' (NewsFeed's unique signal vs "
                          f"TapeFeed, both share TileCard title=\"News\"): found={bundle_has_newsfeed}",
                  "focus": {}})
    FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "TickerPopup trigger, NewsFeed.jsx chips",
                      "sc": "not applicable", "expected": "NOT RUN",
                      "seen": f"NewsFeed.jsx only renders when VITE_TWITTER_UI_ENABLED is built as '0' "
                              f"(TapeFeed.jsx: `if (!UI_ENABLED) return <NewsFeed />`, default '1' when unset); "
                              f"this sandbox's app/dist was built with the default flag, and the bundle grep for "
                              f"'data-ticker-chip' (NewsFeed's unique DOM signal) found={bundle_has_newsfeed} -- "
                              f"consistent with NewsFeed's code being stripped by Vite dead-code elimination. "
                              f"A second VITE_TWITTER_UI_ENABLED=0 build + separate sandbox walk would be the only "
                              f"way to exercise it, and that second build/walk cycle was out of scope for this "
                              f"restart (recorded here rather than silently skipped).",
                      "severity": "info", "known_gap": "NOT RUN -- build-flag dead-code elimination, by design",
                      "step_n": len(STEPS), "screenshot": ""})
    dump()


# ── 6) regression checks ─────────────────────────────────────────────────────

def check_regressions(page, base):
    # hover never steals focus
    goto(page, base, "/dashboard", "R2-regress-hover", "*dashboard, for the hover-steals-focus check")
    page.wait_for_timeout(300)
    before = page.evaluate("() => ({tag: document.activeElement ? document.activeElement.tagName : null})")
    loc = page.locator('[aria-label^="View chart for"]').first
    try:
        loc.wait_for(state="visible", timeout=8000)
        loc.hover()
        page.wait_for_timeout(600)
    except Exception as e:  # noqa: BLE001
        STEPS.append({"n": len(STEPS)+1, "surface": "R2-regress-hover", "keys": "(hover)",
                      "note": f"hover locator failed: {e}", "focus": {}})
        dump()
        return
    after = page.evaluate("() => ({tag: document.activeElement ? document.activeElement.tagName : null, "
                          "isBody: document.activeElement === document.body})")
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-regress-hover", "keys": "(hover, no click)",
                  "note": f"before={before} after_hover={after}", "focus": {}})
    dump()
    if before != {"tag": after.get("tag")}:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "TickerPopup trigger hover", "sc": "2.4.3",
                          "expected": "hovering a ticker trigger never moves focus",
                          "seen": f"before={before} after={after}", "severity": "major", "known_gap": None,
                          "step_n": len(STEPS), "screenshot": shot(page, f"r2-{len(STEPS):04d}-hover-stole-focus")})
        dump()
    else:
        log("  [regression] hover did not steal focus")

    # typing in "Switch ticker" never fires a page hotkey
    goto(page, base, "/dashboard", "R2-regress-hotkey", "*dashboard, for the Switch-ticker hotkey check")
    reached = False
    for i in range(160):
        fi = press(page, "Tab", surface="R2-regress-hotkey-reach", note=f"seek a ticker chip {i+1}")
        if fi.get("role") == "button" and "view chart for" in (fi.get("name") or "").lower():
            reached = True
            break
    if not reached:
        STEPS.append({"n": len(STEPS)+1, "surface": "R2-regress-hotkey", "keys": "(not reached)",
                      "note": "no ticker chip reached within 160 Tabs", "focus": {}})
        dump()
        return
    press(page, "Enter", surface="R2-regress-hotkey", note="*Enter opens the chart modal", wait_ms=500)
    switch_reached = False
    for i in range(10):
        fi = press(page, "Tab", surface="R2-regress-hotkey-inside", note=f"seek 'Switch ticker' {i+1}")
        if "switch ticker" in (fi.get("name") or "").lower() or fi.get("role") == "textbox":
            switch_reached = True
            break
    if not switch_reached:
        STEPS.append({"n": len(STEPS)+1, "surface": "R2-regress-hotkey", "keys": "(not reached)",
                      "note": "'Switch ticker' textbox not reached within 10 Tabs", "focus": {}})
        dump()
        return
    url_before = page.url
    page.keyboard.type("j", delay=50)  # a common SPA list-nav hotkey letter
    page.wait_for_timeout(250)
    typed = page.evaluate("() => { const el = document.activeElement; return el && 'value' in el ? el.value : null; }")
    url_after = page.url
    STEPS.append({"n": len(STEPS)+1, "surface": "R2-regress-hotkey", "keys": "(type 'j')",
                  "note": f"typed into Switch-ticker box: value={typed!r} url_before={url_before} url_after={url_after}",
                  "focus": {}, "screenshot": shot(page, f"r2-{len(STEPS)+1:04d}-hotkey-typed")})
    dump()
    if typed != "j" or url_before != url_after:
        FINDINGS.append({"id": f"RW2-{len(FINDINGS)+1:03d}", "surface": "TickerPopup Switch-ticker box", "sc": "2.1.4",
                          "expected": "typing a letter in the Switch-ticker box inserts it as text and triggers no "
                                      "page-level hotkey/navigation",
                          "seen": f"value={typed!r} url_before={url_before} url_after={url_after}", "severity": "major",
                          "known_gap": None, "step_n": len(STEPS), "screenshot": ""})
        dump()
    else:
        log("  [regression] typing 'j' in Switch-ticker box inserted text and fired no page hotkey")
    press(page, "Escape", surface="R2-regress-hotkey", note="close")


# ── main ──────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--artifacts", required=True)
    args = ap.parse_args()

    assert_no_api_import("startup, before any sandbox/playwright import")

    SHOTS_DIR.mkdir(parents=True, exist_ok=True)
    art = Path(args.artifacts)
    art.mkdir(parents=True, exist_ok=True)

    from tools import notebook_perf_harness as H
    import sandbox_identity
    assert_no_api_import("after importing tools.notebook_perf_harness + sandbox_identity")

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
                                                  "a11y2-rewalk2b@local.dev", "A11yRewalk2bB!", "A11y Rewalk2b")
                        fx = seed(reviewer_ctx, base)
                        dump()

                        page = reviewer_ctx.new_page()
                        check_rw_new_01(page, base)
                        record_controlled_mode_not_run()
                        check_rw_new_02(page, base, fx)
                        check_a2r_05(page, base)
                        check_regressions(page, base)
                        page.close()
                    finally:
                        browser.close()
    except Exception as e:  # noqa: BLE001
        import traceback
        not_run = f"{type(e).__name__}: {e}"
        (OUT_DIR / "traceback-rewalk2.txt").write_text(traceback.format_exc(), encoding="utf-8")
        log(traceback.format_exc())
    finally:
        stop_how = sb.stop()
        ipath = sb.integrity_path()
        required = [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN]
        integ = H.read_integrity(ipath, required)
        if ipath and Path(ipath).is_file():
            import shutil
            shutil.copy(ipath, OUT_DIR / "integrity-rewalk2.md")
        dump()
        log(f"STOP: {stop_how}")
        log("INTEGRITY: " + H.integrity_line(integ, not_run=not_run))
        log(f"steps recorded: {len(STEPS)}; findings: {len(FINDINGS)}")
        try:
            assert_no_api_import("end of run, in the finally block")
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
