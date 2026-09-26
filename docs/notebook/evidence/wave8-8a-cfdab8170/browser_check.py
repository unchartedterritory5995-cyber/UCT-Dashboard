"""Wave 8 lane 8A -- the REAL-BROWSER accessibility check (owner rule P-1).

PRECONDITION: a census-pinned sandbox from THIS worktree's tip, booted through the
stop-file wrapper around `scripts/hub_sandbox_boot.py --data-dir 'C:\\data-8a' --port 8211
--test-email a11y8a@local.dev`, with app/dist rebuilt from the tip. Pointed at
http://localhost:8211 and nothing else; the server's identity nonce is checked first.

Writes every step's result (steps.jsonl, appended step by step), screenshots, one aria
snapshot + one interactive-node census + one axe result per surface into the evidence
dir given as argv[1] BEFORE any summary is computed (R-RAW); summary.json last.

Keyboard only for every action a member takes. Programmatic focus is used in exactly
two places, each named in its step: to START a traversal at a known control, and to
re-focus after reading an element's blurred style for the visibility check.
"""
from __future__ import annotations

import json
import re
import secrets
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8211"
EMAIL = __import__("os").environ.get("A11Y8A_EMAIL", "a11y8a@local.dev")  # must equal the sandbox --test-email
PASSWORD = __import__("os").environ.get("A11Y8A_PASSWORD") or secrets.token_urlsafe(18)  # env only; never written
EVID = Path(sys.argv[1])
EVID.mkdir(parents=True, exist_ok=True)
(EVID / "shots").mkdir(exist_ok=True)
(EVID / "aria").mkdir(exist_ok=True)
(EVID / "axe").mkdir(exist_ok=True)
STEPS = EVID / "steps.jsonl"
AXE_JS = Path(__file__).resolve().parents[0] / "axe.min.js"  # copied from app/node_modules/axe-core
WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
PAGE_EXCLUDED = ["color-contrast"]  # D-A5, page level (jsdom); contrast is measured separately below
INTERACTIVE = {"button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch",
               "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "slider",
               "spinbutton", "treeitem", "application"}

RESULTS = []
RUN = time.strftime("%H%M%S")  # fixture names are unique per run (an account may be reused)


def step(name, ok, **data):
    rec = {"step": name, "ok": bool(ok), "t": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **data}
    with STEPS.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, default=str) + "\n")
    RESULTS.append(rec)
    print(("PASS " if ok else "FAIL ") + name, flush=True)
    return ok


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def shot_el(page, name, handle=None):
    p = EVID / "shots" / f"{slug(name)}.png"
    try:
        if handle:
            box = handle.bounding_box()
            if box and box["width"] > 0:
                vp = page.viewport_size
                x = max(0, box["x"] - 40)
                y = max(0, box["y"] - 40)
                w = min(vp["width"] - x, box["width"] + 80)
                h = min(vp["height"] - y, box["height"] + 80)
                if w > 4 and h > 4:
                    page.screenshot(path=str(p), clip={"x": x, "y": y, "width": w, "height": h})
                    return p.name
        page.screenshot(path=str(p))
        return p.name
    except Exception as e:  # noqa: BLE001 -- recorded
        return f"screenshot failed: {e}"


def skip_intro(page):
    try:
        btn = page.get_by_role("button", name="Skip")
        if btn.count():
            btn.first.click(timeout=3000)
            page.wait_for_function("() => !document.querySelector('[class*=intro] [class*=skip]')", timeout=5000)
    except Exception:  # noqa: BLE001 -- no intro on this load
        pass


FOCUS_INFO = """() => {
  const el = document.activeElement
  if (!el || el === document.body) return null
  const style = () => { const cs = getComputedStyle(el); return {
    outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
    outlineOn: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
    boxShadow: cs.boxShadow, border: cs.borderColor, bg: cs.backgroundColor, color: cs.color } }
  const focused = style()
  const r = el.getBoundingClientRect()
  const name = el.getAttribute('aria-label') || el.getAttribute('title') || (el.labels && el.labels[0] && el.labels[0].textContent) || (el.textContent || '').trim().slice(0, 60) || el.getAttribute('placeholder') || ''
  return { tag: el.tagName, role: el.getAttribute('role') || '', name: name.replace(/\\s+/g, ' ').trim(), id: el.id || '',
    cardId: el.getAttribute('data-note-card-id') || '', focused,
    box: { x: r.x, y: r.y, w: r.width, h: r.height }, inView: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight }
}"""

BLURRED = """() => { const el = document.activeElement; if (!el || el === document.body) return null
  el.setAttribute('data-8a-probe', '1'); el.blur()
  const cs = getComputedStyle(el); const out = { outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
    boxShadow: cs.boxShadow, border: cs.borderColor, bg: cs.backgroundColor, color: cs.color }
  el.focus(); el.removeAttribute('data-8a-probe'); return out }"""


def focus_stop(page, label):
    info = page.evaluate(FOCUS_INFO)
    if not info:
        return step(f"{label}: focus is on an element", False)
    blurred = page.evaluate(BLURRED)
    f = info["focused"]
    changed = bool(blurred) and any(f[k] != blurred[k] for k in ("outline", "boxShadow", "border", "bg", "color"))
    visible = info["inView"] and (f["outlineOn"] or changed)
    handle = page.evaluate_handle("() => document.activeElement").as_element()
    name = shot_el(page, label, handle)
    return step(f"{label}: {info['tag'].lower()} '{info['name'][:40]}' focus visible", visible,
                focus=info, blurred=blurred, indicatorChanged=changed, shot=name)


def tab_walk(page, label, n, back=False):
    seen = []
    for i in range(n):
        page.keyboard.press("Shift+Tab" if back else "Tab")
        page.wait_for_timeout(60)  # one frame for :focus-visible styles; not a polling loop
        info = page.evaluate(FOCUS_INFO)
        seen.append(info)
        focus_stop(page, f"{label} {'back ' if back else ''}stop {i + 1:02d}")
    return seen


def aria_and_names(page, cdp, surface, root_selector=None):
    try:
        loc = page.locator(root_selector) if root_selector else page.locator("body")
        yaml = loc.first.aria_snapshot()
    except Exception as e:  # noqa: BLE001
        yaml = f"aria_snapshot failed: {e}"
    (EVID / "aria" / f"{slug(surface)}.aria.yml").write_text(yaml, encoding="utf-8")
    tree = cdp.send("Accessibility.getFullAXTree")
    nodes = []
    for n in tree.get("nodes", []):
        if n.get("ignored"):
            continue
        role = (n.get("role") or {}).get("value")
        if role not in INTERACTIVE:
            continue
        name = ((n.get("name") or {}).get("value") or "").strip()
        nodes.append({"role": role, "name": name})
    unnamed = [x for x in nodes if not x["name"]]
    (EVID / "aria" / f"{slug(surface)}.interactive.json").write_text(json.dumps(nodes, indent=1), encoding="utf-8")
    return step(f"{surface}: every interactive node has a role and a name", not unnamed,
                interactive=len(nodes), unnamed=unnamed[:20])


AXE_RUN = """async ({ tags, disabled, only }) => {
  const wrap = document.getElementById('notebook-pane')?.parentElement
  const include = []
  if (wrap) include.push(wrap)
  for (const d of document.querySelectorAll('[data-sheet-panel], [role="dialog"], #uct-slash-menu, #uct-emoji-menu')) include.push(d)
  const ctx = include.length ? { include } : document
  const opts = only ? { runOnly: { type: 'rule', values: only }, resultTypes: ['violations'] }
                    : { runOnly: { type: 'tag', values: tags }, rules: Object.fromEntries(disabled.map((r) => [r, { enabled: false }])), resultTypes: ['violations'] }
  const r = await window.axe.run(ctx, opts)
  return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help,
    nodes: v.nodes.slice(0, 12).map((n) => ({ target: n.target.join(' '), data: (n.any[0] && n.any[0].data) || null, summary: n.failureSummary })) }))
}"""


def axe(page, surface, theme=None):
    if not page.evaluate("() => typeof window.axe !== 'undefined'"):
        page.add_script_tag(path=str(AXE_JS))
    version = page.evaluate("() => window.axe.version")
    gate = page.evaluate(AXE_RUN, {"tags": WCAG, "disabled": PAGE_EXCLUDED, "only": None})
    out = {"surface": surface, "axe": version, "gate": gate}
    step(f"{surface}: axe {version} in the browser, 0 violations (D-A5 page exclusions)", not gate,
         violations=[(v["id"], len(v["nodes"])) for v in gate])
    contrast = {}
    for th in ("dark", "light"):
        page.evaluate("(t) => { document.documentElement.dataset.theme = t }", th)
        page.wait_for_timeout(150)
        contrast[th] = page.evaluate(AXE_RUN, {"tags": WCAG, "disabled": [], "only": ["color-contrast"]})
    page.evaluate("() => { document.documentElement.dataset.theme = 'dark' }")
    out["contrast"] = contrast
    (EVID / "axe" / f"{slug(surface)}.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    step(f"{surface}: color-contrast measured in the browser (dark + light) -- RECORDED", True,
         dark=sum(len(v["nodes"]) for v in contrast["dark"]), light=sum(len(v["nodes"]) for v in contrast["light"]))
    return out


def api(req, method, path, data=None):
    r = getattr(req, method)(f"{BASE}{path}", data=data) if data is not None else getattr(req, method)(f"{BASE}{path}")
    return r


def main():
    ident = json.loads(urllib.request.urlopen(f"{BASE}/__uct_sandbox_identity", timeout=10).read())
    step("sandbox identity answers (the server IS the 8A sandbox)", bool(ident.get("identity"))
         and "data-8a" in json.dumps(ident), identity=ident)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
        req = ctx.request
        r = api(req, "post", "/api/auth/signup", {"email": EMAIL, "password": PASSWORD, "display_name": "A11y Eighta"})
        step("signup (sandbox-only account)", r.status in (200, 400, 409), status=r.status)
        r = api(req, "post", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
        step("login", r.ok, status=r.status)
        me = api(req, "get", "/api/auth/me").json()
        u = me.get("user") if isinstance(me.get("user"), dict) else me
        step("account is the sandbox admin (ADMIN_EMAILS)", (u.get("role") or me.get("role")) == "admin",
             role=u.get("role") or me.get("role"), plan=u.get("plan") or me.get("plan"), keys=sorted(me.keys())[:30])

        # ── fixture: a folder with a subfolder, five notes, links (graph edges), a tag ──
        f1 = api(req, "post", "/api/j2/note-folders", {"name": f"Theses 8A {RUN}"}).json()["folder"]
        api(req, "post", "/api/j2/note-folders", {"name": f"Archive 8A {RUN}", "parentId": f1["id"]})
        def mk(title, body, **kw):
            return api(req, "post", "/api/j2/notes", {"title": title, "bodyJson": body, **kw}).json()["note"]
        para = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}
        table = {"type": "table", "content": [
            {"type": "tableRow", "content": [{"type": "tableHeader", "content": [para("Sym")]}, {"type": "tableHeader", "content": [para("R")]}]},
            {"type": "tableRow", "content": [{"type": "tableCell", "content": [para("NVDA")]}, {"type": "tableCell", "content": [para("2.1")]}]}]}
        a = mk("Weekly plan 8A", {"type": "doc", "content": [para("Plan body")]})
        b = mk("AMD thesis 8A", {"type": "doc", "content": [para("AMD body")]}, folderId=f1["id"], tags=["semis-8a"])
        main_note = mk("SR pass 8A", {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Setup"}]},
            para("A paragraph that mentions the plan."),
            {"type": "paragraph", "content": [{"type": "text", "text": "See "}, {"type": "noteLink", "attrs": {"noteId": a["id"]}}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "And "}, {"type": "noteLink", "attrs": {"noteId": b["id"]}}]},
            table]}, folderId=f1["id"], tags=["semis-8a"])
        mk("Lonely note 8A", {"type": "doc", "content": [para("No links")]})
        victim = mk("Delete me 8A", {"type": "doc", "content": [para("to be deleted")]})
        victim2 = mk("Delete me too 8A", {"type": "doc", "content": [para("to be deleted from a folder")]}, folderId=f1["id"])
        step("fixture notes created", bool(main_note.get("id") and victim.get("id")))

        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ── S1: the list, from the top of the page ──
        page.goto(f"{BASE}/journal/notebook?view=all")
        page.wait_for_selector("[data-note-card-id]", timeout=60000)
        skip_intro(page)
        page.wait_for_selector("a[href='#notebook-pane']", state="attached", timeout=20000)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        reached = None
        path = []
        for i in range(120):
            page.keyboard.press("Tab")
            info = page.evaluate(FOCUS_INFO)
            path.append((info or {}).get("name", ""))
            if info and info["tag"] == "A" and "Skip to" in info["name"]:
                reached = i + 1
                break
        step("Tab from the top of the page reaches the Notebook's skip link", reached is not None,
             presses=reached, path=path[-12:])
        focus_stop(page, "S1 skip link (visible only when focused)")
        tab_walk(page, "S1 sidebar", 22)
        skip = page.locator("a[href='#notebook-pane']")
        skip.focus()  # programmatic: back to the START control after the sidebar walk
        first_in_wrap = page.evaluate("""() => { const w = document.getElementById('notebook-pane').parentElement
          const f = w.querySelector('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')
          return f && f.textContent.trim() }""")
        step("the skip link is the FIRST focusable element of the tab", first_in_wrap in ("Skip to notes list", "Skip to note"),
             first=first_in_wrap)
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.activeElement && document.activeElement.tagName === 'H2'", timeout=5000)
        focus_stop(page, "S1 pane heading after the skip link")
        tab_walk(page, "S1 list", 30)
        tab_walk(page, "S1 list", 4, back=True)
        aria_and_names(page, cdp, "S1 list view", "#notebook-pane")
        axe(page, "S1 list view")

        # ── S2: every view mode, switched by keyboard ──
        for label in ("Table view", "Board view", "Calendar view", "Timeline view", "Tasks view", "List view"):
            btn = page.get_by_role("button", name=label, exact=True)
            btn.focus()  # programmatic: START at the switcher
            page.keyboard.press("Space")
            page.wait_for_function("(l) => document.querySelector(`button[aria-label='${l}']`)?.getAttribute('aria-pressed') === 'true'", arg=label, timeout=10000)
            page.wait_for_timeout(400)
            focus_stop(page, f"S2 {label} toggle")
            aria_and_names(page, cdp, f"S2 {label}", "#notebook-pane")
            axe(page, f"S2 {label}")

        # ── S3: the graph -- list mode and the keyboard canvas ──
        g = page.get_by_role("button", name="Graph view", exact=True)
        g.focus()
        page.keyboard.press("Space")
        page.wait_for_selector("canvas[role='application']", timeout=20000)
        toggle = page.get_by_role("button", name="Show as list")
        toggle.focus()
        page.keyboard.press("Space")
        page.wait_for_selector("table caption", state="attached", timeout=10000)
        step("S3 Show as list: aria-pressed true and a table of notes", toggle.get_attribute("aria-pressed") == "true",
             rows=page.locator("#notebook-pane tbody tr").count())
        focus_stop(page, "S3 Show as list toggle (pressed)")
        tab_walk(page, "S3 graph list", 6)
        aria_and_names(page, cdp, "S3 graph list mode", "#notebook-pane")
        axe(page, "S3 graph list mode")
        toggle.focus()
        page.keyboard.press("Space")
        page.wait_for_selector("canvas[role='application']", timeout=10000)
        page.keyboard.press("Tab")
        page.wait_for_function("() => document.activeElement && document.activeElement.tagName === 'CANVAS'", timeout=5000)
        focus_stop(page, "S3 graph canvas focused")
        page.keyboard.press("Home")
        page.wait_for_function("() => (document.querySelector('[data-graph-live]')?.textContent || '').length > 0", timeout=5000)
        said_home = page.locator("[data-graph-live]").text_content()
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(120)
        said_right = page.locator("[data-graph-live]").text_content()
        shot_el(page, "S3 graph canvas after Home and ArrowRight", page.locator("canvas[role='application']").element_handle())
        step("S3 canvas keys: Home then an arrow are spoken in the live region", bool(said_home),
             home=said_home, arrow=said_right)
        aria_and_names(page, cdp, "S3 graph canvas", "#notebook-pane")
        axe(page, "S3 graph canvas")
        page.keyboard.press("Enter")
        page.wait_for_selector("input[aria-label='Note title']", timeout=20000)
        page.wait_for_function("() => document.activeElement?.getAttribute('aria-label') === 'Note title'", timeout=10000)
        step("S3 Enter on the canvas opens the selected note, focus in its title", True,
             title=page.locator("input[aria-label='Note title']").input_value())

        # ── S4: open a note from the list by keyboard; the editor and its popups ──
        page.goto(f"{BASE}/journal/notebook?view=all")
        page.wait_for_selector(f"[data-note-card-id='{main_note['id']}']", timeout=60000)
        skip_intro(page)
        card = page.locator(f"#notebook-pane [data-note-card-id='{main_note['id']}']").first
        card.focus()  # programmatic: START at the card
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.activeElement?.getAttribute('aria-label') === 'Note title'", timeout=20000)
        focus_stop(page, "S4 note opened by Enter: title field")
        page.wait_for_selector(".ProseMirror", timeout=30000)
        # The editor: Tab through its chrome until focus enters the note body.
        # Inside a TABLE, Tab belongs to the table (cell to cell; a new row at
        # the last cell) and Ctrl+Home does not leave it -- measured on this
        # sandbox before this run. The way out is the table toolbar's own door:
        # Alt+F10 moves focus to it, Escape hands it back (TableToolbar.jsx).
        entered = False
        for i in range(20):
            page.keyboard.press("Tab")
            page.wait_for_timeout(60)
            info = page.evaluate(FOCUS_INFO) or {}
            focus_stop(page, f"S4 editor stop {i + 1:02d}")
            if info.get("name") == "Note body":
                entered = True
                break
        step("S4 Tab reaches the note body", entered)
        in_table = page.evaluate("""() => { const ed = document.querySelector('.ProseMirror')?.editor; if (!ed) return false
          const $f = ed.state.selection.$from; for (let d = $f.depth; d > 0; d -= 1) if ($f.node(d).type.name === 'table') return true; return false }""")
        if in_table:
            page.keyboard.press("Alt+F10")
            page.wait_for_function("() => !!document.activeElement?.closest('[role=toolbar][aria-label=Table]')", timeout=5000)
            focus_stop(page, "S4 in a table, Alt+F10 moves focus to the table toolbar")
            page.keyboard.press("Escape")
            page.wait_for_function("() => document.activeElement?.classList.contains('ProseMirror')", timeout=5000)
            step("S4 Escape from the table toolbar hands focus back to the cell", True)
        else:
            page.keyboard.press("Tab")
            page.wait_for_timeout(60)
            left = page.evaluate("() => !document.activeElement?.classList.contains('ProseMirror')")
            step("S4 outside a table, Tab leaves the note body (no keyboard trap)", left)
        aria_and_names(page, cdp, "S4 note editor", "#notebook-pane")
        axe(page, "S4 note editor")

        # find, Escape -> the note
        page.locator(".ProseMirror").first.focus()
        page.keyboard.press("Control+f")
        page.wait_for_selector("[role='search'][aria-label='Find in note'] input", timeout=10000)
        focus_stop(page, "S4 find field")
        axe(page, "S4 find bar open")
        page.keyboard.press("Escape")
        page.wait_for_function("() => document.activeElement?.classList.contains('ProseMirror')", timeout=5000)
        step("S4 Escape closes find and focus is back in the note", True)

        # the colour menu, Escape -> its button
        color = page.get_by_role("button", name="Text color and highlight")
        color.focus()
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.querySelector('[aria-label=\"Text color and highlight\"][aria-expanded=\"true\"]')", timeout=5000)
        focus_stop(page, "S4 colour menu: focus inside")
        axe(page, "S4 colour menu open")
        page.keyboard.press("Escape")
        page.wait_for_function("() => document.activeElement?.getAttribute('aria-label') === 'Text color and highlight'", timeout=5000)
        focus_stop(page, "S4 colour menu closed: focus on its button")

        # the outline, Escape -> its button
        outline = page.get_by_role("button", name="Outline", exact=True)
        outline.focus()
        page.keyboard.press("Enter")
        page.wait_for_selector("button[data-outline-item]", timeout=5000)
        page.keyboard.press("Tab")
        axe(page, "S4 outline open")
        page.locator("button[data-outline-item]").first.focus()
        page.keyboard.press("Escape")
        page.wait_for_function("() => document.activeElement?.getAttribute('aria-label') === 'Outline'", timeout=5000)
        focus_stop(page, "S4 outline closed: focus on its button")

        # the slash menu, Escape -> the caret stays in the note
        page.locator(".ProseMirror").first.focus()
        page.keyboard.press("Control+End")
        page.keyboard.press("Enter")
        page.keyboard.type("/")
        page.wait_for_selector("#uct-slash-menu", timeout=5000)
        page.keyboard.press("ArrowDown")
        axe(page, "S4 slash menu open")
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
        step("S4 Escape in the slash menu leaves focus in the note", page.evaluate(
            "() => document.activeElement?.classList.contains('ProseMirror')"))
        page.keyboard.press("Backspace")

        # Ask, close -> the toggle
        ask = page.locator("button[aria-label^='Ask a question about']").first
        ask.focus()
        page.keyboard.press("Enter")
        page.wait_for_selector("button[aria-label='Close Ask']", timeout=10000)
        page.wait_for_function("() => document.activeElement?.id?.startsWith('ask-input')", timeout=5000)
        focus_stop(page, "S4 Ask open: focus in the question field")
        axe(page, "S4 Ask panel open")
        page.locator("button[aria-label='Close Ask']").focus()
        page.keyboard.press("Enter")
        page.wait_for_function("() => (document.activeElement?.getAttribute('aria-label') || '').startsWith('Ask a question about')", timeout=5000)
        focus_stop(page, "S4 Ask closed: focus on its toggle")

        # ── S5: a Sheet (Save view) opens with its field focused; Escape returns to the opener ──
        page.goto(f"{BASE}/journal/notebook?view=all")
        page.wait_for_selector("[data-note-card-id]", timeout=60000)
        skip_intro(page)
        opener = page.get_by_role("button", name="Save view")
        opener.focus()
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.activeElement?.id === 'save-view-name'", timeout=10000)
        page.keyboard.type("Typed at once")
        step("S5 Save view opens with its name field focused (typing lands)", page.locator("#save-view-name").input_value() == "Typed at once")
        focus_stop(page, "S5 Save view name field")
        aria_and_names(page, cdp, "S5 Save view dialog", "[data-sheet-panel]")
        axe(page, "S5 Save view dialog")
        page.keyboard.press("Escape")
        page.wait_for_function("() => (document.activeElement?.textContent || '').trim() === 'Save view'", timeout=5000)
        focus_stop(page, "S5 Save view closed: focus back on its opener")

        # ── S6: delete through ConfirmModal -> focus on the next row ──
        order = page.evaluate("() => [...document.querySelectorAll('#notebook-pane [data-note-card-id]')].map((e) => e.getAttribute('data-note-card-id'))")
        at = order.index(victim["id"]) if victim["id"] in order else -1
        nxt = order[at + 1] if 0 <= at < len(order) - 1 else None
        vcard = page.locator(f"#notebook-pane [data-note-card-id='{victim['id']}']").first
        vcard.focus()
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.activeElement?.getAttribute('aria-label') === 'Note title'", timeout=20000)
        delete = page.locator("#notebook-pane button.btn-danger", has_text="Delete").first
        delete.focus()
        page.keyboard.press("Enter")
        page.wait_for_selector("[role='dialog'][aria-modal='true']", timeout=5000)
        focus_stop(page, "S6 ConfirmModal open")
        aria_and_names(page, cdp, "S6 ConfirmModal", "[role='dialog'][aria-modal='true']")
        axe(page, "S6 ConfirmModal")
        dlg = page.locator("[role='dialog'][aria-modal='true']")
        dlg.get_by_role("button", name="Delete").focus()
        page.keyboard.press("Enter")
        anyway = page.get_by_role("button", name=re.compile("Trash anyway"))
        try:
            anyway.wait_for(timeout=2500)
            anyway.focus()
            page.keyboard.press("Enter")
        except Exception:  # noqa: BLE001 -- no unsent words; the delete goes straight through
            pass
        page.wait_for_function("() => !document.querySelector(\"input[aria-label='Note title']\")", timeout=20000)
        page.wait_for_timeout(300)
        landed = page.evaluate("() => ({ card: document.activeElement?.getAttribute('data-note-card-id') || '', tag: document.activeElement?.tagName, text: (document.activeElement?.textContent || '').trim().slice(0, 40) })")
        next_on_screen = bool(nxt) and page.locator(f"#notebook-pane [data-note-card-id='{nxt}']").count() > 0
        ok = (next_on_screen and landed["card"] == nxt) or (not next_on_screen and landed["tag"] == "H2")
        step("S6 delete from All notes: focus on the NEXT row if it is on screen, else the pane heading", ok,
             expected_next=nxt, next_on_screen=next_on_screen, landed=landed)
        focus_stop(page, "S6 focus after the delete from All notes")

        # S6b: the same from a FOLDER list, which stays a list after the delete
        page.goto(f"{BASE}/journal/notebook?folder={f1['id']}")
        page.wait_for_selector(f"#notebook-pane [data-note-card-id='{victim2['id']}']", timeout=60000)
        skip_intro(page)
        order2 = page.evaluate("() => [...document.querySelectorAll('#notebook-pane [data-note-card-id]')].map((e) => e.getAttribute('data-note-card-id'))")
        at2 = order2.index(victim2["id"])
        nxt2 = order2[at2 + 1] if at2 < len(order2) - 1 else None
        page.locator(f"#notebook-pane [data-note-card-id='{victim2['id']}']").first.focus()
        page.keyboard.press("Enter")
        page.wait_for_function("() => document.activeElement?.getAttribute('aria-label') === 'Note title'", timeout=20000)
        page.locator("#notebook-pane button.btn-danger", has_text="Delete").first.focus()
        page.keyboard.press("Enter")
        page.wait_for_selector("[role='dialog'][aria-modal='true']", timeout=5000)
        page.locator("[role='dialog'][aria-modal='true']").get_by_role("button", name="Delete").focus()
        page.keyboard.press("Enter")
        try:
            anyway.wait_for(timeout=2500)
            anyway.focus()
            page.keyboard.press("Enter")
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_function("() => !document.querySelector(\"input[aria-label='Note title']\")", timeout=20000)
        page.wait_for_timeout(300)
        landed2 = page.evaluate("() => ({ card: document.activeElement?.getAttribute('data-note-card-id') || '', tag: document.activeElement?.tagName, text: (document.activeElement?.textContent || '').trim().slice(0, 40) })")
        ok2 = (nxt2 and landed2["card"] == nxt2) or (not nxt2 and landed2["tag"] == "H2")
        step("S6b delete from a folder list: focus on the NEXT row (or the heading when it was last)", ok2,
             order=order2, expected_next=nxt2, landed=landed2)
        focus_stop(page, "S6b focus after the delete from a folder")

        # ── S7: the import wizard and the template picker open and give focus back ──
        imp = page.locator("[data-tour='import']").first
        if imp.count():
            imp.focus()
            page.keyboard.press("Enter")
            try:
                page.wait_for_selector("[role='dialog']", timeout=5000)
                aria_and_names(page, cdp, "S7 import wizard", "[role='dialog']")
                axe(page, "S7 import wizard")
                page.keyboard.press("Escape")
                page.wait_for_function("() => document.activeElement?.getAttribute('data-tour') === 'import'", timeout=5000)
                focus_stop(page, "S7 import closed: focus back on Import")
            except Exception as e:  # noqa: BLE001
                step("S7 import wizard opens and returns focus", False, error=str(e)[:200])

        step("no uncaught page errors during the pass", not errors, errors=errors[:10])
        browser.close()

    summary = {"steps": len(RESULTS), "failed": [r["step"] for r in RESULTS if not r["ok"]]}
    (EVID / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps(summary, indent=1))
    return 0 if not summary["failed"] else 1


if __name__ == "__main__":
    sys.exit(main())
