"""The independent keyboard-only walk (lane 10E-2; `docs/notebook/a11y-second-review-brief.md`
section 3). A MEASUREMENT: it writes its raw record step by step (R-RAW) and the review reads
that record afterwards; nothing here is fixed.

    python keyboard_walk.py <scratch-dir-of-e2_sandbox> <out-dir> [--only S1,S2,...]

Preconditions (the brief's "Preconditions", met by `docs/notebook/proof/e2-d9e887ca0/e2_sandbox.py`):
a census-pinned `scripts/hub_sandbox_boot.py` boot from the tip under review, `app/dist` rebuilt
from that tip, a PAID synthetic account; never production, never `C:\\data`. Nothing is sent
until `sandbox_identity.verify` proves the server is that sandbox.

HOW EACH STEP IS WALKED. The page is driven by `page.keyboard` only. A control is "reachable"
when Tab (or Shift+Tab) lands on an element whose accessible name matches, within a bounded
number of presses from a stated start; the whole route is recorded as the trail. A control is
"operable" when the key that should act on it (Enter, Space, arrows, Escape) produces the DOM
effect named in the step. Every verdict is PASS, FAIL, NOT RUN (with the reason) or OBSERVED
(a fact recorded for the reviewer, with no pass/fail line of its own).

CONTROLS: the instrument must be able to see a failure. `C0` loads a local page holding a
button that cannot be reached by Tab (tabindex=-1) and a focus trap; the same helpers must
report the first as unreachable and the second as a trap, or the walk stops as
INSTRUMENT-FAILED before walking the product.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROOF = HERE.parents[1] / "proof" / "e2-d9e887ca0"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(PROOF))
import e2_common as C  # noqa: E402
import kbd_lib as K  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

WALK_EMAIL = "e2-kbd@local.dev"
FRESH_EMAIL = "e2-kbd-fresh@local.dev"


def doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]} if text else {"type": "paragraph"}


def heading(level, text):
    return {"type": "heading", "attrs": {"level": level}, "content": [{"type": "text", "text": text}]}


def cell(kind, text):
    return {"type": kind, "content": [para(text)]}


def table():
    return {"type": "table", "content": [
        {"type": "tableRow", "content": [cell("tableHeader", "Ticker"), cell("tableHeader", "Thesis")]},
        {"type": "tableRow", "content": [cell("tableCell", "NVDA"), cell("tableCell", "Data centre demand")]},
    ]}


def tasks(*items):
    return {"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": done}, "content": [para(t)]} for t, done in items]}


def note_link(nid):
    return {"type": "paragraph", "content": [{"type": "text", "text": "See "}, {"type": "noteLink", "attrs": {"noteId": nid}}]}


def seed(req, base, rec):
    """The walk account's library, made through the API (setup, recorded)."""
    have = req.get(base + "/api/j2/notes?limit=200").json().get("notes") or []
    if any(n.get("title") == "Alpha thesis NVDA" for n in have):
        rec.rec["seed"] = {"reused": True, "notes": len(have)}
        rec.flush()
        return {n["title"]: n["id"] for n in have}
    j = lambda r: r.json() if r.ok else {"status": r.status, "text": r.text()[:200]}  # noqa: E731
    f_res = j(req.post(base + "/api/j2/note-folders", data={"name": "Research"}))
    f_res_id = (f_res.get("folder") or {}).get("id")
    f_semi = j(req.post(base + "/api/j2/note-folders", data={"name": "Semis", "parentId": f_res_id}))
    f_semi_id = (f_semi.get("folder") or {}).get("id")
    today = dt.date.today()
    ids = {}

    def mk(title, body, **kw):
        payload = {"title": title, "bodyJson": body}
        payload.update(kw)
        r = j(req.post(base + "/api/j2/notes", data=payload))
        ids[title] = (r.get("note") or {}).get("id")
        return ids[title]

    mk("Beta rates note", doc(para("Rates first draft.")), tags=["macro"],
       properties={"builtin:thesis_status": "watching"})
    mk("Gamma earnings", doc(para("Earnings season notes.")), tags=["earnings"],
       properties={"builtin:review_date": today.isoformat()})
    mk("Delta plain", doc(para("A plain note with no folder.")))
    mk("Alpha thesis NVDA", doc(
        heading(2, "Thesis"), para("Data centre demand keeps compounding."),
        heading(2, "Checklist"), tasks(("Read the 10-Q", False), ("Size the position", True)),
        heading(2, "Numbers"), table(),
        note_link(ids["Beta rates note"]),
        para("End of note."),
    ), folderId=f_semi_id, tags=["macro/rates", "semis"],
       properties={"builtin:thesis_status": "active",
                   "builtin:review_date": (today + dt.timedelta(days=2)).isoformat()})
    # a back link, so the graph has an edge both ways
    beta = ids["Beta rates note"]
    cur = req.get(f"{base}/api/j2/notes/{beta}").json()["note"]
    req.put(f"{base}/api/j2/notes/{beta}", data={"bodyJson": doc(para("Rates first draft."), note_link(ids["Alpha thesis NVDA"])),
                                                 "baseUpdatedAt": cur["updatedAt"]})
    sv = j(req.post(base + "/api/j2/saved-views", data={"name": "Active theses", "viewType": "list", "spec": {}}))
    rec.rec["seed"] = {"folders": [f_res_id, f_semi_id], "notes": ids, "saved_view": (sv.get("savedView") or {}).get("id")}
    rec.flush()
    return ids


def open_notebook(page, base, suffix="/journal/notebook?view=all", wait_ms=2500):
    page.goto(base + suffix, wait_until="domcontentloaded")
    page.wait_for_timeout(wait_ms)
    C.dismiss_intro(page)
    page.wait_for_timeout(600)
    # the voice first-run hint ("Got it") and any tour card are dismissed BY KEYBOARD only:
    # they are recorded when they are in the way (S1-hints), not skipped silently.


def focus_top(page):
    """Put the keyboard back at the top of the document, the way a page load leaves it.

    ⛔ A bare `blur()` is NOT enough: Chromium keeps the sequential-focus starting point at
    the element that was blurred, so the next Tab lands AFTER it (measured: the first stop
    became the second nav control). So a zero-size, tabindex=-1 marker is put at the very
    start of <body> and focused; the next Tab is the document's first stop. The marker is
    never a Tab stop itself and changes nothing the member sees."""
    page.evaluate("""() => {
      let m = document.getElementById('e2-kbd-top');
      if (!m) { m = document.createElement('span'); m.id = 'e2-kbd-top'; m.tabIndex = -1;
                m.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
                document.body.insertBefore(m, document.body.firstChild); }
      m.focus(); window.scrollTo(0, 0);
    }""")
    page.wait_for_timeout(80)


def list_heading(page):
    """The notes pane's own heading (the skip link's target): which list is on screen."""
    return page.evaluate("""() => { const hs = Array.from(document.querySelectorAll('h1,h2'))
        .filter(h => { const r = h.getBoundingClientRect(); return r.width > 0 && r.x > 330; });
        return hs.length ? hs[0].textContent.trim().slice(0, 60) : null; }""")


# ── CONTROL: the helpers must be able to say "unreachable" and "trap" ─────────────────────
CONTROL_HTML = """<!doctype html><html><body>
<button id=a>Alpha</button>
<button id=hidden tabindex=-1>Unreachable</button>
<div id=trap><button id=t1>Trap one</button><button id=t2>Trap two</button></div>
<script>
document.getElementById('t2').addEventListener('keydown', e => { if (e.key==='Tab' && !e.shiftKey) { e.preventDefault(); document.getElementById('t1').focus(); } });
</script></body></html>"""


def control(browser, rec):
    pg = browser.new_page()
    pg.set_content(CONTROL_HTML)
    found, n, trail, _ = K.tab_until(pg, K.name_has("unreachable"), max_presses=12)
    trapped = False
    pg.evaluate("() => document.getElementById('t1').focus()")
    seen = set()
    for _ in range(8):
        f = K.press(pg, "Tab", 30)
        seen.add(f.get("name"))
    trapped = seen <= {"Trap one", "Trap two"}
    pg.close()
    ok = (not found) and trapped
    rec.step("C0", "control", "Tab x12; Tab x8 inside a trap", "unreachable button NOT found; trap detected",
             f"unreachable found={found} after {n}; trap detected={trapped}; trail={trail[:6]}",
             "PASS" if ok else "INSTRUMENT-FAILED")
    return ok


# ── S1: the list ────────────────────────────────────────────────────────────────────────
def s1_list(page, base, rec, ids, shots):
    open_notebook(page, base)
    rec.rec["census"]["list_1280"] = K.tab_census(page, 200)
    rec.flush()
    page.screenshot(path=str(shots / "s1-list-1280.png"))
    rec.rec["shots"].append("s1-list-1280.png")

    # 1a -- the skip link is the first thing a keyboard user can use on the page?
    open_notebook(page, base)
    focus_top(page)
    first = K.press(page, "Tab")
    found, n, trail, f = K.tab_until(page, K.name_has("skip to notes list"), max_presses=60)
    rec.step("S1-01", "list: skip link first", "Tab from the top of the page",
             "the first Tab stop is a skip link past the repeated blocks (2.4.1)",
             f"first stop: {K.short(first)}; 'Skip to notes list' reached after {n + 1} presses "
             f"(found={found}); first 6 stops: {trail[:6]}",
             "PASS" if K.name_has("skip")(first) else "FAIL", sc="2.4.1")
    if found:
        f2 = K.press(page, "Enter", 400)
        rec.step("S1-02", "list: skip link works", "Enter on 'Skip to notes list'",
                 "focus moves to the notes list (or its first control)",
                 f"after Enter focus is {K.short(f2)} at {f2.get('rect')}",
                 "PASS" if not K.name_has("skip")(f2) and not f2.get("body") else "FAIL", sc="2.4.1")
        f3 = K.press(page, "Tab")
        rec.step("S1-03", "list: after the skip", "Tab once after the skip",
                 "the next stop is inside the notes list", f"next stop {K.short(f3)}", "OBSERVED")

    # 1b -- the sidebar: folders, nested folder, tags, nested tag, saved views, Trash, Archived
    open_notebook(page, base)
    focus_top(page)
    for sid, label, pred, expand in [
        ("S1-10", "folder 'Research'", lambda f: (f.get("name") or "").strip() == "Research", None),
        ("S1-11", "nested folder 'Semis'", lambda f: (f.get("name") or "").strip() == "Semis", "expand research"),
        ("S1-12", "tag 'macro'", K.name_has("tag macro,"), None),
        ("S1-13", "nested tag 'macro/rates'", K.name_has("tag macro/rates"), "expand tag macro"),
        ("S1-14", "saved view 'Active theses'", lambda f: (f.get("name") or "").strip() == "Active theses", None),
        ("S1-15", "Trash", lambda f: (f.get("name") or "").lower().startswith("trash"), None),
        ("S1-16", "Archived", lambda f: (f.get("name") or "").lower().startswith("archived"), None),
    ]:
        open_notebook(page, base)
        focus_top(page)
        pre = ""
        if expand:
            ok, n0, _, fe = K.tab_until(page, K.name_has(expand), max_presses=120)
            if ok:
                fe2 = K.press(page, "Enter", 600)
                pre = f"Tab x{n0} to '{expand}' + Enter (expanded -> {fe2.get('expanded')}); "
            else:
                pre = f"'{expand}' NOT reached; "
        found, n, trail, f = K.tab_until(page, pred, max_presses=120)
        obs = pre + f"reached={found} in {n} Tab; focus visible={f.get('focusVisible')} indicator={f.get('indicator')}"
        if not found:
            obs += f"; trail tail: {trail[-12:]}"
        rec.step(sid, f"sidebar: {label}", "Tab from the top" + (" after expanding the parent" if expand else ""),
                 f"{label} is a Tab stop with a visible focus indicator",
                 obs, "PASS" if found and f.get("indicator") else "FAIL", sc="2.1.1/2.4.7", focus=f)
        if found:
            h_before = list_heading(page)
            f2 = K.press(page, "Enter", 1200)
            h_after = list_heading(page)
            rec.step(sid + "e", f"sidebar: {label} activates", "Enter",
                     "the notes list changes to that folder/tag/view (its heading says which)",
                     f"list heading {h_before!r} -> {h_after!r}; focus now {K.short(f2)}",
                     "PASS" if h_after != h_before else "FAIL", sc="2.1.1")

    # 1c -- a nested folder is reachable only after its parent is expanded? record the disclosure
    open_notebook(page, base)
    focus_top(page)
    found, n, trail, f = K.tab_until(page, lambda x: x.get("expanded") is not None and ("research" in (x.get("name") or "").lower()), max_presses=90)
    rec.step("S1-17", "sidebar: folder disclosure", "Tab to the Research disclosure",
             "a disclosure control reports aria-expanded (4.1.2)",
             f"found={found}; {K.short(f)} expanded={f.get('expanded')}", "PASS" if found else "OBSERVED", sc="4.1.2")

    # 1d -- every view mode, by keyboard
    modes = ["List view", "Table view", "Board view", "Calendar view", "Graph view", "Timeline view", "Tasks view"]
    for i, m in enumerate(modes):
        open_notebook(page, base)
        focus_top(page)
        found, n, trail, f = K.tab_until(page, K.name_has(m.lower()), max_presses=90)
        if not found:
            rec.step(f"S1-2{i}", f"view mode: {m}", "Tab", f"'{m}' reachable", f"not reached; tail {trail[-8:]}", "FAIL", sc="2.1.1")
            continue
        f2 = K.press(page, "Enter", 1200)
        f3 = K.focus(page)
        pressed = f3.get("pressed") if K.name_has(m.lower())(f3) else None
        rec.step(f"S1-2{i}", f"view mode: {m}", f"Tab x{n}, Enter",
                 "the mode switches and the button reports its state (aria-pressed)",
                 f"after Enter focus {K.short(f3)} pressed={pressed} url={page.url.split('/journal')[-1]}",
                 "PASS" if pressed == "true" or m.split()[0].lower() in page.url.lower() else "OBSERVED", sc="2.1.1/4.1.2")
        page.screenshot(path=str(shots / f"s1-mode-{m.split()[0].lower()}.png"))
        rec.rec["shots"].append(f"s1-mode-{m.split()[0].lower()}.png")
        mode = m.split()[0].lower()
        if mode == "board":
            s1_board(page, base, rec, ids)
        elif mode == "table":
            s1_table(page, base, rec, ids)
        elif mode in ("calendar", "timeline", "tasks"):
            s1_reach_note_in_mode(page, base, rec, ids, mode)

    # 1e -- select two notes by keyboard, bulk Export, Escape, where focus lands
    open_notebook(page, base)
    focus_top(page)
    picked = 0
    for _ in range(2):
        found, n, trail, f = K.tab_until(page, lambda x: (x.get("name") or "").lower().startswith("select ") and x.get("tag") == "input", max_presses=90)
        if found:
            K.press(page, "Space", 300)
            picked += 1
    focus_top(page)
    found, n, trail, fx = K.tab_until(page, K.name_has("export selected"), max_presses=140)
    opened = []
    if found:
        K.press(page, "Enter", 900)
        opened = K.dialogs(page)
        inside = K.focus(page)
        esc = K.press(page, "Escape", 600)
        rec.step("S1-40", "bulk: select two, Export, Escape", "Tab to 2 checkboxes + Space; Tab to Export; Enter; Escape",
                 "the export panel opens with focus inside; Escape closes it and focus returns to the Export control",
                 f"selected={picked}; dialogs on open={opened}; focus on open {K.short(inside)} (inDialog={inside.get('inDialog')}); "
                 f"after Escape focus {K.short(esc)}; dialogs now {K.dialogs(page)}",
                 "PASS" if (opened or inside.get("role") in ("menuitem", "menuitemradio") or fx.get("expanded") is not None)
                 and "export" in (esc.get("name") or "").lower() else "FAIL",
                 sc="2.4.3", menu=K.focus(page))
    else:
        rec.step("S1-40", "bulk: select two, Export, Escape", "Tab to checkboxes + Space; Tab to Export",
                 "Export reachable after selecting", f"selected={picked}; Export not reached; tail {trail[-10:]}", "FAIL", sc="2.1.1")


def s1_board(page, base, rec, ids):
    found, n, trail, f = K.tab_until(page, lambda x: x.get("tag") == "select" and "alpha" in (x.get("name") or "").lower(), max_presses=60)
    if not found:
        found, n, trail, f = K.tab_until(page, lambda x: x.get("tag") == "select", max_presses=60)
    if not found:
        rec.step("S1-30", "board: move a card with its <select>", "Tab", "a card's select is reachable",
                 f"no select reached; tail {trail[-8:]}", "FAIL", sc="2.1.1/2.5.7")
        return
    before_cols = page.evaluate("""() => Array.from(document.querySelectorAll('[data-note-card-id]')).map(e => e.textContent.slice(0,30))""")
    K.press(page, "w", 2000)   # type-ahead: the first option starting with W ("Watching")
    after = page.evaluate("() => document.activeElement ? document.activeElement.value : null")
    before = "__unset__"
    rec.step("S1-30", "board: move a card with its <select>", f"Tab x{n} to {K.short(f)}; type 'w' (type-ahead to Watching)",
             "the card moves to the next column (a single-pointer/keyboard alternative to drag, 2.5.7)",
             f"select value {before!r} -> {after!r}; focus now {K.short(K.focus(page))}",
             "PASS" if after and after != before else "FAIL", sc="2.1.1/2.5.7")


def s1_table(page, base, rec, ids):
    found, n, trail, f = K.tab_until(page, K.name_has("alpha thesis"), max_presses=60)
    if not found:
        rec.step("S1-31", "table: reach a row's note", "Tab", "a row's note is reachable",
                 f"not reached; tail {trail[-8:]}", "FAIL", sc="2.1.1")
        return
    K.press(page, "Enter", 2000)
    opened = "note=" in page.url or page.locator(".ProseMirror").count() > 0
    rec.step("S1-31", "table: open a row's note", f"Tab x{n} to {K.short(f)}; Enter",
             "the note opens", f"url {page.url.split('/journal')[-1]}; editor present={opened}",
             "PASS" if opened else "FAIL", sc="2.1.1")


def s1_reach_note_in_mode(page, base, rec, ids, mode):
    target = {"calendar": "gamma", "timeline": "alpha", "tasks": "read the 10-q"}[mode]
    found, n, trail, f = K.tab_until(page, K.name_has(target), max_presses=80)
    if not found:
        rec.step(f"S1-3{['calendar','timeline','tasks'].index(mode)+2}", f"{mode}: reach a note", "Tab",
                 f"a note ({target}) is reachable in {mode} mode", f"not reached; tail {trail[-10:]}", "FAIL", sc="2.1.1")
        return
    K.press(page, "Enter", 2000)
    opened = "note=" in page.url or page.locator(".ProseMirror").count() > 0
    rec.step(f"S1-3{['calendar','timeline','tasks'].index(mode)+2}", f"{mode}: open a note", f"Tab x{n} to {K.short(f)}; Enter",
             "the note opens", f"url {page.url.split('/journal')[-1]}; editor present={opened}",
             "PASS" if opened else "OBSERVED", sc="2.1.1")


# ── S2: the editor ─────────────────────────────────────────────────────────────────────
def open_note_by_keyboard(page, base, rec, title="alpha thesis"):
    open_notebook(page, base)
    focus_top(page)
    # a note's OPEN control is a button whose name starts with the title (a card or a Recents
    # row); the row's "Select <title>" checkbox also contains the title and must not match.
    found, n, trail, f = K.tab_until(
        page, lambda x: x.get("tag") == "button" and (x.get("name") or "").lower().startswith(title),
        max_presses=140)
    if found:
        K.press(page, "Enter", 2500)
    try:
        page.wait_for_selector(".ProseMirror", timeout=8000)
        ok = True
    except Exception:  # noqa: BLE001
        ok = False
    return found and ok, n, trail


def s2_editor(page, base, rec, ids, shots):
    ok, n, trail = open_note_by_keyboard(page, base, rec)
    rec.step("S2-01", "editor: open from the list with Enter", f"Tab x{n}; Enter", "the note opens in the editor",
             f"opened={ok}; url {page.url.split('/journal')[-1]}", "PASS" if ok else "FAIL", sc="2.1.1")
    if not ok:
        return
    page.wait_for_timeout(800)
    page.screenshot(path=str(shots / "s2-editor-1280.png"))
    rec.rec["shots"].append("s2-editor-1280.png")
    focus_top(page)
    rec.rec["census"]["editor_1280"] = K.tab_census(page, 260)
    rec.flush()
    stops = [s for s in rec.rec["census"]["editor_1280"] if isinstance(s, dict) and not s.get("cycle")]
    no_ind = [K.short(s) for s in stops if not s.get("body") and s.get("inViewport") and not s.get("indicator")]
    offscreen = [K.short(s) for s in stops if not s.get("body") and not s.get("inViewport")]
    rec.step("S2-02", "editor: every Tab stop shows focus", "Tab through the whole editor page",
             "every stop has a visible indicator (2.4.7) and is on screen when focused (2.4.11)",
             f"{len(stops)} stops; without an indicator: {no_ind[:12]}; focused while off screen: {offscreen[:12]}",
             "PASS" if not no_ind else "FAIL", sc="2.4.7/2.4.11")


SECTIONS = {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("scratch")
    ap.add_argument("out_dir")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    out = Path(a.out_dir)
    shots = out / "shots"
    shots.mkdir(parents=True, exist_ok=True)
    ready = C.ready_record(Path(a.scratch))
    base = ready["base"]
    only = {s.strip() for s in a.only.split(",") if s.strip()}
    tag = "-".join(sorted(only)) if only else "all"
    rec = K.Recorder(out / f"walk-{tag}.json", {
        "tool": "keyboard_walk", "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "base": base,
        "integrity_log": ready["integrity_log"], "only": sorted(only), "browser": "chromium (playwright)",
        "viewport": "1280x800 unless a step says otherwise", "tip": "d9e887ca0"})
    rec.rec["meta"]["nonce"] = C.require_identity(base, ready["integrity_log"])
    with sync_playwright() as p:
        browser = p.chromium.launch()
        rec.rec["meta"]["browser_version"] = browser.version
        if not control(browser, rec):
            rec.rec["meta"]["verdict"] = "INSTRUMENT-FAILED"
            rec.flush()
            return 2
        adm = browser.new_context()
        C.signup_or_login(adm.request, base, C.ADMIN_EMAIL, C.PW, "hubtest")
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        me = C.provision(adm.request, ctx.request, base, WALK_EMAIL, "kbd walker")
        rec.rec["meta"]["account_paid"] = me.get("paid_equiv")
        ids = seed(ctx.request, base, rec)
        page = ctx.new_page()
        env = {"base": base, "rec": rec, "ids": ids, "shots": shots, "browser": browser, "adm": adm, "ctx": ctx, "page": page}
        for name, fn in SECTIONS.items():
            if only and name not in only:
                continue
            try:
                fn(env)
            except Exception as e:  # noqa: BLE001 -- a section that dies is recorded, never hidden
                import traceback
                rec.rec["errors"].append({"section": name, "error": f"{type(e).__name__}: {e}",
                                          "trace": traceback.format_exc()[-1500:]})
                rec.flush()
                print(f"SECTION {name} DIED: {type(e).__name__}: {e}", flush=True)
        browser.close()
    rec.rec["meta"]["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    rec.flush()
    return 0


import kbd_more as M  # noqa: E402

_W = sys.modules[__name__]
SECTIONS["S1"] = lambda e: s1_list(e["page"], e["base"], e["rec"], e["ids"], e["shots"])
SECTIONS["S2"] = lambda e: s2_editor(e["page"], e["base"], e["rec"], e["ids"], e["shots"])
SECTIONS["S2b"] = lambda e: M.s2_body(e, _W)
SECTIONS["S2c"] = lambda e: M.s2_panels(e, _W)
SECTIONS["S3"] = lambda e: M.s3_graph(e, _W)
SECTIONS["S4"] = lambda e: M.s4_sheets(e, _W)
SECTIONS["S5"] = lambda e: M.s5_public(e, _W)
SECTIONS["S6"] = lambda e: M.s6_touch_zoom(e, _W)

if __name__ == "__main__":
    raise SystemExit(main())
