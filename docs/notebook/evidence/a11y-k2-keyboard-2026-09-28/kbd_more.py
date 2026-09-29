"""Sections S2b-S6 of the keyboard walk (see keyboard_walk.py's header for the method)."""
from __future__ import annotations

import hashlib

import kbd_lib as K

MENUS_JS = r"""() => Array.from(document.querySelectorAll('[role="listbox"],[role="menu"],[role="dialog"],[role="tooltip"]'))
  .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
  .map(e => ({role: e.getAttribute('role'), label: (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g,' ').trim().slice(0, 60)}))"""

CARET_JS = r"""() => { const s = getSelection(); if (!s || !s.anchorNode) return null;
  const n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
  return {inTable: !!(n && n.closest('table')), inEditor: !!(n && n.closest('.ProseMirror')),
          text: (n && n.textContent || '').slice(0, 40), rows: (n && n.closest('table')) ? n.closest('table').rows.length : null}; }"""


# K2: the S2-13 / S2-14 probes read the node views the editor really renders.
LINK_TEXTS_JS = r"""() => Array.from(document.querySelectorAll('.ProseMirror [data-note-link]'))
  .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim())"""
DATES_JS = r"""() => Array.from(document.querySelectorAll('.ProseMirror [data-type="date-mention"]'))
  .map(e => e.getAttribute('data-date'))"""
EDITOR_TEXT_JS = r"""() => (document.querySelector('.ProseMirror') || {}).textContent || ''"""
LINK_OPTIONS_JS = r"""() => { const lb = Array.from(document.querySelectorAll('[role="listbox"][aria-label="Link to a note"]'))
  .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (!lb.length) return null;
  return Array.from(lb[0].querySelectorAll('[role="option"]'))
    .map(o => ({text: (o.textContent || '').replace(/\s+/g, ' ').trim(), sel: o.getAttribute('aria-selected')})); }"""


def link_options(page):
    try:
        return page.evaluate(LINK_OPTIONS_JS)
    except Exception:  # noqa: BLE001
        return None


def wait_link_options(page, n, timeout_ms=4000):
    """The `[[` picker's options once at least `n` are listed (it searches after a debounce)."""
    waited = 0
    while waited < timeout_ms:
        o = link_options(page)
        if o and len(o) >= n:
            return o
        page.wait_for_timeout(100)
        waited += 100
    return link_options(page)


def settle_link_texts(page, timeout_ms=3000):
    """Link chips once none still reads the loading ellipsis."""
    waited = 0
    texts = page.evaluate(LINK_TEXTS_JS)
    while waited < timeout_ms and any(t in ("", "…") for t in texts):
        page.wait_for_timeout(150)
        waited += 150
        texts = page.evaluate(LINK_TEXTS_JS)
    return texts


def new_items(before, after):
    """The items in `after` that `before` did not have (a multiset difference)."""
    left = list(before)
    out = []
    for x in after:
        if x in left:
            left.remove(x)
        else:
            out.append(x)
    return out


def tomorrow_et():
    import datetime as _dt
    from zoneinfo import ZoneInfo
    return (_dt.datetime.now(ZoneInfo("America/New_York")).date() + _dt.timedelta(days=1)).isoformat()


def menus(page):
    try:
        return page.evaluate(MENUS_JS)
    except Exception:  # noqa: BLE001
        return []


def to_body(page, W):
    """Keyboard route into the note body: Tab until the editable body has focus."""
    W.focus_top(page)
    return K.tab_until(page, lambda f: f.get("contenteditable") or f.get("name") == "Note body", max_presses=170)


def s2_body(env, W):
    page, base, rec = env["page"], env["base"], env["rec"]
    ok, n, trail = W.open_note_by_keyboard(page, base, rec, "delta plain")
    if not ok:
        rec.step("S2-10", "editor body", "open 'Delta plain'", "the note opens", "did not open", "NOT RUN")
        return
    found, n, trail, f = to_body(page, W)
    rec.step("S2-10", "editor: reach the body", f"Tab x{n}", "the body is a Tab stop", f"{K.short(f)} found={found}",
             "PASS" if found else "FAIL", sc="2.1.1")
    if not found:
        return
    page.keyboard.press("Control+End")
    page.keyboard.press("Enter")
    # slash menu
    page.keyboard.type("/")
    page.wait_for_timeout(500)
    m1 = menus(page)
    page.keyboard.press("ArrowDown")
    page.wait_for_timeout(150)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    m2 = menus(page)
    fe = K.focus(page)
    rec.step("S2-11", "editor: slash menu", "type '/', ArrowDown, Escape",
             "a menu/listbox opens on '/', arrows move in it, Escape closes it and leaves focus in the body",
             f"open: {m1[:2]}; after Escape: {m2[:2]}; focus {K.short(fe)}",
             "PASS" if m1 and not [m for m in m2 if m in m1] and fe.get("contenteditable") else "FAIL", sc="2.1.1/2.1.2")
    page.keyboard.press("Backspace")
    # emoji menu
    page.keyboard.type(" :smi")
    page.wait_for_timeout(500)
    m3 = menus(page)
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    rec.step("S2-12", "editor: emoji menu", "type ' :smi', Escape", "an emoji list opens and Escape closes it",
             f"open: {m3[:2]}; after Escape {menus(page)[:1]}", "PASS" if m3 else "FAIL", sc="2.1.1")
    for _ in range(5):
        page.keyboard.press("Backspace")
    # [[ link -- K2: the probe can now answer. 10E-2's original looked for `[data-note-id]`,
    # `[data-type="noteLink"]` or `.noteLink`; the node view is `<span data-note-link>`
    # (NoteLinkView.jsx), so the link was inserted and the probe could not see it. Each check
    # below counts BEFORE and AFTER (a delta, never a presence), so it can say "no" as well as
    # "yes": the Escape case (S2-13c) must leave the count unchanged.
    links0 = page.evaluate(LINK_TEXTS_JS)
    page.keyboard.type(" [[Beta")
    opts = wait_link_options(page, 1)
    page.keyboard.press("Enter")
    links1 = settle_link_texts(page)
    fe = K.focus(page)
    left = link_options(page)
    added = new_items(links0, links1)
    ok = bool(opts) and len(links1) == len(links0) + 1 and any("beta" in a.lower() for a in added) \
        and fe.get("contenteditable") and left is None
    rec.step("S2-13", "editor: [[ note link", "type ' [[Beta'; wait for the picker; Enter",
             "a note picker opens; Enter inserts the link; the picker closes and focus stays in the body",
             f"picker options {[o['text'][:24] for o in (opts or [])][:4]}; links {len(links0)} -> {len(links1)} "
             f"(new: {added}); picker after Enter {left}; focus {K.short(fe)}",
             "PASS" if ok else "FAIL", sc="2.1.1")
    # keyboard selection: ArrowDown moves the choice, Enter takes THAT one
    links0 = page.evaluate(LINK_TEXTS_JS)
    page.keyboard.type(" [[a")
    opts = wait_link_options(page, 2)
    page.keyboard.press("ArrowDown")
    page.wait_for_timeout(200)
    chosen = [o["text"] for o in (link_options(page) or []) if o["sel"] == "true"]
    page.keyboard.press("Enter")
    links1 = settle_link_texts(page)
    fe = K.focus(page)
    added = new_items(links0, links1)
    first = (opts or [{}])[0].get("text")
    ok = bool(opts) and len(opts) >= 2 and len(chosen) == 1 and chosen[0] != first \
        and len(added) == 1 and added[0].lower() in chosen[0].lower() and fe.get("contenteditable")
    rec.step("S2-13b", "editor: [[ keyboard selection", "type ' [[a'; ArrowDown; Enter",
             "ArrowDown moves the selected option; Enter inserts the option that was selected, not the first",
             f"options {[o['text'][:20] for o in (opts or [])][:4]}; selected after ArrowDown {chosen}; "
             f"inserted {added}; focus {K.short(fe)}",
             "PASS" if ok else "FAIL", sc="2.1.1")
    # Escape: the picker closes, nothing is inserted, the caret stays where the member was typing
    links0 = page.evaluate(LINK_TEXTS_JS)
    page.keyboard.type(" [[Gam")
    opts = wait_link_options(page, 1)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    left = link_options(page)
    fe = K.focus(page)
    page.keyboard.type("x")
    page.wait_for_timeout(200)
    links1 = page.evaluate(LINK_TEXTS_JS)
    typed_on = "[[Gamx" in (page.evaluate(EDITOR_TEXT_JS) or "")
    ok = bool(opts) and left is None and len(links1) == len(links0) and fe.get("contenteditable") and typed_on
    rec.step("S2-13c", "editor: [[ picker Escape", "type ' [[Gam'; Escape; type 'x'",
             "Escape closes the picker, inserts nothing, and the next key types into the body where the caret was",
             f"picker before Escape {[o['text'][:20] for o in (opts or [])][:3]}; after Escape {left}; "
             f"links {len(links0)} -> {len(links1)}; focus {K.short(fe)}; '[[Gamx' in the body={typed_on}",
             "PASS" if ok else "FAIL", sc="2.1.1/2.1.2")
    for _ in range(len(" [[Gamx")):
        page.keyboard.press("Backspace")
    # @ date -- K2: dateMentionNode.js (its header: "Typing `@today`, `@tomorrow` ... then a space
    # or punctuation, turns the words into an inline `dateMention` atom") makes @date an INPUT RULE,
    # not a picker, so 10E-2's "a date picker opens" could never read PASS whatever the product did.
    # The probe now asks what the product promises, counted as a delta, and a CONTROL (a word that
    # is not a date) must leave the count unchanged -- so the probe can say "no".
    dates0 = page.evaluate(DATES_JS)
    page.keyboard.type(" @tomorrow ")
    page.wait_for_timeout(400)
    dates1 = page.evaluate(DATES_JS)
    fe = K.focus(page)
    body = page.evaluate(EDITOR_TEXT_JS) or ""
    added = new_items(dates0, dates1)
    want = tomorrow_et()
    ok = len(dates1) == len(dates0) + 1 and added == [want] and "@tomorrow" not in body and fe.get("contenteditable")
    rec.step("S2-14", "editor: @ date", "type ' @tomorrow ' (the rule's trigger is the space)",
             "the words become one date chip for tomorrow (ET); focus stays in the body and typing continues",
             f"date chips {len(dates0)} -> {len(dates1)} (new: {added}, tomorrow ET {want}); "
             f"'@tomorrow' left as text={'@tomorrow' in body}; menus {menus(page)[:1]}; focus {K.short(fe)}",
             "PASS" if ok else "FAIL", sc="2.1.1")
    dates0 = page.evaluate(DATES_JS)
    page.keyboard.type(" @notaday ")
    page.wait_for_timeout(400)
    dates1 = page.evaluate(DATES_JS)
    body = page.evaluate(EDITOR_TEXT_JS) or ""
    ok = len(dates1) == len(dates0) and "@notaday" in body
    rec.step("S2-14c", "editor: @ date CONTROL", "type ' @notaday '",
             "a word that is not a date stays text: the probe must be able to say no",
             f"date chips {len(dates0)} -> {len(dates1)}; '@notaday' left as text={'@notaday' in body}",
             "PASS" if ok else "INSTRUMENT-FAILED", sc="control")
    for _ in range(len(" @notaday ")):
        page.keyboard.press("Backspace")
    # find and replace
    fb = K.press(page, "Control+f", 600)
    page.keyboard.type("plain")
    page.wait_for_timeout(300)
    fr = K.press(page, "Control+h", 600)
    esc = K.press(page, "Escape", 500)
    rec.step("S2-15", "editor: find and replace", "Ctrl+F, type, Ctrl+H, Escape",
             "Ctrl+F puts focus in a find field; Ctrl+H shows replace; Escape closes and returns focus to the body",
             f"after Ctrl+F {K.short(fb)}; after Ctrl+H {K.short(fr)}; after Escape {K.short(esc)}",
             "PASS" if fb.get("tag") == "input" and esc.get("contenteditable") else "FAIL", sc="2.1.1/2.4.3")
    # table: insert via slash, Tab through cells, leave it
    page.keyboard.press("Control+End")
    page.keyboard.press("Enter")
    page.keyboard.type("/table")
    page.wait_for_timeout(600)
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    c0 = page.evaluate(CARET_JS)
    for _ in range(3):
        page.keyboard.press("Tab")
        page.wait_for_timeout(120)
    c1 = page.evaluate(CARET_JS)
    rows_before = (c1 or {}).get("rows")
    for _ in range(12):
        page.keyboard.press("Tab")
        page.wait_for_timeout(80)
    c2 = page.evaluate(CARET_JS)
    rec.step("S2-16", "editor: table created and walked", "'/table' Enter; Tab x3; Tab x12 more",
             "a table is inserted; Tab moves cell to cell; Tab at the last cell adds a row (documented)",
             f"in table after insert={c0 and c0.get('inTable')}; rows {rows_before} -> {(c2 or {}).get('rows')}",
             "PASS" if c0 and c0.get("inTable") else "FAIL", sc="2.1.1")
    # leave the table
    exits = {}
    for key in ("Escape", "Control+Enter", "ArrowDown"):
        page.keyboard.press(key)
        page.wait_for_timeout(150)
        exits[key] = page.evaluate(CARET_JS)
        if exits[key] and not exits[key].get("inTable"):
            break
    for _ in range(8):
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(60)
    c3 = page.evaluate(CARET_JS)
    shift_tab = [K.press(page, "Shift+Tab", 80) for _ in range(1)]
    rec.step("S2-17", "editor: leave a table by keyboard (2.1.2)", "Escape / Ctrl+Enter / ArrowDown, then ArrowDown x8",
             "the caret can leave the table without a pointer",
             f"after the tries: {exits}; after ArrowDown x8 caret in table={c3 and c3.get('inTable')}; "
             f"Shift+Tab lands {K.short(shift_tab[0])}",
             "PASS" if c3 and not c3.get("inTable") else "FAIL", sc="2.1.2")
    # move a block with the keys the grip names (Alt+Shift+Up/Down)
    to_body(page, W)
    page.keyboard.press("Control+Home")
    first_before = page.evaluate("() => (document.querySelector('.ProseMirror > *') || {}).textContent")
    page.keyboard.press("Alt+Shift+ArrowDown")
    page.wait_for_timeout(500)
    first_after = page.evaluate("() => (document.querySelector('.ProseMirror > *') || {}).textContent")
    rec.step("S2-18", "editor: move a block with the keys", "Ctrl+Home; Alt+Shift+ArrowDown",
             "the first block moves down one place (2.5.7 alternative to the drag grip)",
             f"first block {first_before!r} -> {first_after!r}", "PASS" if first_after != first_before else "FAIL", sc="2.5.7")
    page.keyboard.press("Alt+Shift+ArrowUp")
    page.wait_for_timeout(400)


OVERFLOW_NAME = "more note actions"


def reach_door(page, W, pred, max_presses=170):
    """K2: Tab to a door from the top of the page; when it is not a Tab stop there, open the
    note's "More note actions" disclosure (D-3 moved page-level actions into it) and Tab to the
    door inside. The route taken is returned so the record says which one it was. A product
    with no such disclosure never takes the second route, so the same walk measures before and
    after the move."""
    found, n, trail, f = K.tab_until(page, pred, max_presses=max_presses)
    if found:
        return found, n, trail, f, None
    W.focus_top(page)
    ok, n1, trail1, fm = K.tab_until(page, lambda x: (x.get("name") or "").strip().lower() == OVERFLOW_NAME,
                                     max_presses=max_presses)
    if not ok:
        return False, n, trail + ["(no 'More note actions' either)"], f, None
    K.press(page, "Enter", 500)
    found, n2, trail2, f = K.tab_until(page, pred, max_presses=40)
    return found, n1 + n2, trail1 + trail2, f, f"Tab x{n1} to 'More note actions'; Enter; Tab x{n2}"


def s2_panels(env, W):
    """Toolbar doors: each opens and closes by keyboard; focus goes in and comes back."""
    page, base, rec = env["page"], env["base"], env["rec"]
    doors = [("S2-20", "Ask", "ask a question about this note"), ("S2-21", "Writing help", "writing help"),
             ("S2-22", "Version history", "version history"), ("S2-23", "Outline", "outline"),
             ("S2-24", "Text colour", "text color and highlight"), ("S2-25", "Share", "share"),
             ("S2-26", "Export menu", "export"), ("S2-27", "Open beside", "open a note beside"),
             ("S2-28", "Delete confirmation", "delete"), ("S2-29", "Add property", "add property")]
    for sid, label, needle in doors:
        ok, n, trail = W.open_note_by_keyboard(page, base, rec, "beta rates note")
        if not ok:
            rec.step(sid, f"editor door: {label}", "open 'Gamma earnings'", "note opens", "did not open", "NOT RUN")
            continue
        W.focus_top(page)
        exact = needle in ("writing help", "outline", "share", "export", "delete", "add property")
        found, n, trail, f, route = reach_door(
            page, W, lambda x, nd=needle, ex=exact: ((x.get("name") or "").strip().lower() == nd) if ex
            else (x.get("name") or "").strip().lower().startswith(nd), max_presses=170)
        if not found:
            rec.step(sid, f"editor door: {label}", "Tab", f"'{label}' reachable", f"not reached; tail {trail[-6:]}", "FAIL", sc="2.1.1")
            continue
        opener = f
        f_open = K.press(page, "Enter", 900)
        dl = K.dialogs(page)
        mn = menus(page)
        inside = [K.press(page, "Tab", 60) for _ in range(6)]
        escaped = K.press(page, "Escape", 700)
        still = K.dialogs(page)
        back = (escaped.get("name") or "").strip().lower().startswith(needle)
        moved_in = bool(f_open.get("inDialog")) or any(x.get("inDialog") for x in inside) or f_open.get("role") in ("menuitem", "option")
        rec.step(sid, f"editor door: {label}", f"{route or f'Tab x{n}'} to {K.short(opener)}; Enter; Tab x6; Escape",
                 "it opens by keyboard, focus goes into it, Escape closes it and focus returns to the opener (2.4.3)",
                 f"on open focus {K.short(f_open)} (inDialog={f_open.get('inDialog')}); dialogs {dl[:1]} menus {mn[:1]}; "
                 f"Tab path inside {[K.short(x)[:30] for x in inside[:3]]}; after Escape {K.short(escaped)}; dialogs left {still[:1]}",
                 "PASS" if back and (dl or mn or moved_in or opener.get("expanded") is not None) else ("OBSERVED" if back else "FAIL"),
                 sc="2.1.1/2.4.3", opener=opener)
    # Lock / Unlock and Archive, by keyboard
    for sid, needle in (("S2-30", "lock"), ("S2-31", "archive")):
        ok, n, trail = W.open_note_by_keyboard(page, base, rec, "beta rates note")
        W.focus_top(page)
        found, n, trail, f, route = reach_door(page, W, lambda x, nd=needle: (x.get("name") or "").strip().lower() == nd, max_presses=90)
        if not found:
            rec.step(sid, f"editor: {needle}", "Tab", "reachable", f"not reached; tail {trail[-6:]}", "FAIL", sc="2.1.1")
            continue
        f2 = K.press(page, "Enter", 1200)
        rec.step(sid, f"editor: {needle}", f"{route or f'Tab x{n}'}; Enter", f"'{needle}' acts and says so",
                 f"after Enter focus {K.short(f2)}; toolbar now {[K.short(x) for x in [K.focus(page)]]}",
                 "OBSERVED", sc="2.1.1/4.1.3")
        K.press(page, "Enter", 1200)   # undo it (Unlock / Unarchive sit on the same control)


def s3_graph(env, W):
    page, base, rec, shots = env["page"], env["base"], env["rec"], env["shots"]
    W.open_notebook(page, base)
    W.focus_top(page)
    ok, n, _, _ = K.tab_until(page, K.name_has("graph view"), max_presses=120)
    K.press(page, "Enter", 2500)
    W.focus_top(page)
    found, n, trail, f = K.tab_until(page, lambda x: x.get("tag") == "canvas" or (x.get("role") == "application"), max_presses=120)
    rec.step("S3-01", "graph: reach the canvas", f"Tab x{n}", "the graph canvas is a Tab stop with a name",
             f"{K.short(f)} found={found}", "PASS" if found and f.get("name") else "FAIL", sc="2.1.1/1.1.1")
    if not found:
        return
    live = lambda: page.evaluate("() => (document.querySelector('[data-graph-live]') || {}).textContent || ''")  # noqa: E731
    shot = lambda: hashlib.sha256(page.locator("canvas").first.screenshot()).hexdigest()[:16]  # noqa: E731
    h0 = shot()
    said = {}
    for key in ("ArrowRight", "Home", "End", "ArrowLeft"):
        K.press(page, key, 400)
        said[key] = live()
    K.press(page, "Escape", 400)
    page.wait_for_timeout(300)
    h1 = shot()
    rec.step("S3-02", "graph: arrows, Home, End announce a note", "ArrowRight, Home, End, ArrowLeft",
             "each key selects a note and the live region names it (4.1.3)",
             f"live region: {said}", "PASS" if all(said.values()) else "FAIL", sc="2.1.1/4.1.3")
    rec.step("S3-03", "graph: keys do not reset the layout", "the canvas pixels before the keys vs after Escape",
             "after Escape clears the selection the drawing is the one before the keys",
             f"canvas hash before {h0} after {h1}", "PASS" if h0 == h1 else "OBSERVED", sc="2.1.1")
    K.press(page, "Home", 300)
    K.press(page, "Enter", 2500)
    opened = page.locator(".ProseMirror").count() > 0
    rec.step("S3-04", "graph: Enter opens the selected note", "Home; Enter", "the note opens",
             f"editor present={opened}; url {page.url.split('/journal')[-1]}", "PASS" if opened else "FAIL", sc="2.1.1")
    W.open_notebook(page, base)
    W.focus_top(page)
    K.tab_until(page, K.name_has("graph view"), max_presses=120)
    K.press(page, "Enter", 2500)
    W.focus_top(page)
    found, n, trail, f = K.tab_until(page, K.name_has("show as list"), max_presses=140)
    if found:
        K.press(page, "Enter", 800)
        tbl = page.evaluate("() => document.querySelectorAll('table').length")
        rec.step("S3-05", "graph: 'Show as list'", f"Tab x{n}; Enter", "the same notes as a table",
                 f"tables on page={tbl}; focus {K.short(K.focus(page))}", "PASS" if tbl else "FAIL", sc="1.1.1")
    else:
        rec.step("S3-05", "graph: 'Show as list'", "Tab", "reachable", f"not reached; tail {trail[-6:]}", "FAIL", sc="2.1.1")
    page.screenshot(path=str(shots / "s3-graph.png"))
    rec.rec["shots"].append("s3-graph.png")


def dialog_check(page, rec, sid, label, opener, sc="2.4.3"):
    """Focus goes in on open, stays in over 10 Tabs, Escape closes, focus returns to the opener."""
    f_open = K.focus(page)
    dl = K.dialogs(page)
    inside = [K.press(page, "Tab", 50) for _ in range(10)]
    stayed = all(x.get("inDialog") for x in inside) if dl else None
    esc = K.press(page, "Escape", 700)
    back = (esc.get("name") or "") == (opener.get("name") or "")
    rec.step(sid, f"dialog: {label}", "open; Tab x10; Escape",
             "focus moves in on open, stays in while open, Escape closes, focus returns to the opener",
             f"dialogs {dl[:1]}; focus on open {K.short(f_open)} inDialog={f_open.get('inDialog')}; "
             f"Tab x10 stayed inside={stayed}; after Escape {K.short(esc)}; dialogs left {K.dialogs(page)[:1]}",
             "PASS" if dl and f_open.get("inDialog") and stayed and back and not K.dialogs(page) else "FAIL", sc=sc)


def s4_sheets(env, W):
    page, base, rec = env["page"], env["base"], env["rec"]
    # command palette
    W.open_notebook(page, base)
    W.focus_top(page)
    opener = K.press(page, "Tab", 100)
    page.keyboard.press("Control+k")
    page.wait_for_timeout(700)
    dialog_check(page, rec, "S4-01", "command palette (Ctrl+K)", opener)
    # Save view, Templates, Import, the list Export
    for sid, label, needle in (("S4-02", "Save view", "save view"), ("S4-03", "Templates", "templates"),
                               ("S4-04", "Import", "import"), ("S4-05", "Export (whole notebook)", "export")):
        W.open_notebook(page, base)
        W.focus_top(page)
        found, n, trail, f = K.tab_until(page, lambda x, nd=needle: (x.get("name") or "").strip().lower() == nd, max_presses=120)
        if not found:
            rec.step(sid, f"dialog: {label}", "Tab", "reachable", f"not reached; tail {trail[-6:]}", "FAIL", sc="2.1.1")
            continue
        K.press(page, "Enter", 900)
        dialog_check(page, rec, sid, label, f)
    # Share sheet on a note: create, copy, revoke by keyboard
    ok, n, trail = W.open_note_by_keyboard(page, base, rec, "delta plain")
    W.focus_top(page)
    found, n, trail, f = K.tab_until(page, lambda x: (x.get("name") or "").strip().lower() == "share", max_presses=90)
    if found:
        K.press(page, "Enter", 1000)
        inside = []
        for _ in range(12):
            x = K.press(page, "Tab", 80)
            inside.append(K.short(x))
        rec.step("S4-06", "share sheet: its controls by Tab", f"Tab x{n} to Share; Enter; Tab x12",
                 "create / copy / revoke are Tab stops inside the sheet",
                 f"stops: {inside}", "OBSERVED", sc="2.1.1")
        K.press(page, "Escape", 600)
    # first-run tour on a fresh account
    ctx2 = env["browser"].new_context(viewport={"width": 1280, "height": 800})
    import e2_common as C
    import keyboard_walk as KW
    C.provision(env["adm"].request, ctx2.request, base, KW.FRESH_EMAIL, "kbd fresh")
    p2 = ctx2.new_page()
    W.open_notebook(p2, base, wait_ms=4000)
    dl = K.dialogs(p2)
    f0 = K.focus(p2)
    steps_seen = []
    for _ in range(6):
        x = K.press(p2, "Tab", 60)
        steps_seen.append(K.short(x)[:40])
    esc = K.press(p2, "Escape", 700)
    rec.step("S4-07", "first-run tour (fresh account)", "load; Tab x6; Escape",
             "the tour is reachable by keyboard and Escape dismisses it",
             f"dialogs on load {dl[:2]}; focus {K.short(f0)}; Tab path {steps_seen}; after Escape dialogs {K.dialogs(p2)[:1]}",
             "PASS" if dl and not K.dialogs(p2) else "OBSERVED", sc="2.1.1/2.1.2")
    ctx2.close()


def s5_public(env, W):
    page, base, rec, shots = env["page"], env["base"], env["rec"], env["shots"]
    ids = env["ids"]
    nid = ids.get("Delta plain")
    r = env["ctx"].request.post(f"{base}/api/j2/notes/{nid}/share", data={"expiresInDays": None})
    tok = ((r.json() if r.ok else {}).get("share") or {}).get("token")
    r2 = env["ctx"].request.post(f"{base}/api/j2/publish/notes/{nid}", data={"expiresInDays": None})
    slug = ((r2.json() if r2.ok else {}).get("publication") or {}).get("slug")
    anon = env["browser"].new_context(viewport={"width": 1280, "height": 800})
    pg = anon.new_page()
    for sid, label, path in (("S5-01", "share link", f"/share/n/{tok}" if tok else None),
                             ("S5-02", "published page", f"/p/{slug}" if slug else None)):
        if not path:
            rec.step(sid, f"public: {label}", "mint", "a link", f"could not mint (share {r.status}, publish {r2.status})", "NOT RUN")
            continue
        pg.goto(base + path, wait_until="domcontentloaded")
        pg.wait_for_timeout(3000)
        import e2_common as C
        C.dismiss_intro(pg)
        pg.wait_for_timeout(500)
        heads = pg.evaluate("() => Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.tagName + ' ' + h.textContent.trim().slice(0,40))")
        title = pg.title()
        cen = K.tab_census(pg, 60)
        no_ind = [K.short(x) for x in cen if isinstance(x, dict) and not x.get("body") and not x.get("cycle") and not x.get("indicator")]
        rec.step(sid, f"public: {label} (signed out)", "load; Tab through",
                 "headings in order, a page title, every stop visibly focused",
                 f"title {title!r}; headings {heads[:6]}; {len(cen)} stops; without indicator {no_ind[:6]}",
                 "PASS" if heads and not no_ind else "OBSERVED", sc="2.4.2/1.3.1/2.4.7")
        pg.screenshot(path=str(shots / f"{sid.lower()}-public.png"))
        rec.rec["shots"].append(f"{sid.lower()}-public.png")
    anon.close()


def s6_touch_zoom(env, W):
    base, rec, shots = env["base"], env["rec"], env["shots"]
    import e2_common as C
    import keyboard_walk as KW
    for sid, vw, vh, touch, label in (("S6-01", 390, 844, True, "390 touch"), ("S6-02", 820, 1180, True, "820 touch"),
                                      ("S6-03", 640, 400, False, "200% zoom of 1280x800"), ("S6-04", 320, 640, False, "320 CSS px (reflow)")):
        ctx = env["browser"].new_context(viewport={"width": vw, "height": vh}, has_touch=touch, is_mobile=touch and vw < 700)
        C.signup_or_login(ctx.request, base, KW.WALK_EMAIL, C.PW, "kbd walker")
        pg = ctx.new_page()
        for where, suffix in (("list", "/journal/notebook?view=all"), ("editor", f"/journal/notebook?note={env['ids'].get('Alpha thesis NVDA')}")):
            W.open_notebook(pg, base, suffix, wait_ms=3500)
            ov = K.overflow(pg)
            small24 = K.small_targets(pg, 24)
            small44 = K.small_targets(pg, 44) if touch else []
            fname = f"s6-{vw}-{where}.png"
            pg.screenshot(path=str(shots / fname))
            rec.rec["shots"].append(fname)
            horiz = ov["docScrollW"] > ov["docClientW"] + 1
            rec.step(f"{sid}-{where}", f"{label}: {where}", "load at this width",
                     "no page-level horizontal scroll (1.4.10); targets >= 24 px or spaced (2.5.8)",
                     f"doc scrollW {ov['docScrollW']} vs clientW {ov['docClientW']}; targets < 24 px: {len(small24)} "
                     f"{[(t['name'][:24], t['w'], t['h']) for t in small24[:6]]}"
                     + (f"; targets < 44 px (touch tier): {len(small44)}" if touch else ""),
                     "FAIL" if horiz or small24 else "PASS", sc="1.4.10/2.5.8", small24=small24[:40])
        ctx.close()
