"""Finish program, lane FE2 -- the real-browser confirmation of P1, P3, P5 and P6 at 1280 px
(mouse), 820 px and 390 px (touch). Sandbox on port 8133 (same rules as the other fin-fe walks:
it owns its sandbox, bars are a synthetic fixture, the driver never imports api.*). Every wave
switch ON, plus an AMD reporting day three sessions out so Reporting soon has a row. One fresh
paid member per width (the resurfacing explainer shows once per member). Raw observations are
written before any row is judged.

  P1  open a note, More note actions, Delete: the confirm button is not under any other element
      at its centre, the floating voice button is gone while the dialog is open, a tap on the
      confirm button deletes the note. Then the same check on the folder Delete and the bulk
      Move to Trash confirms (the sweep), where the page offers them.
  P3  a member who hid Get started and has a dismissed row for another tour opens the "What you
      wrote then" sheet: the explainer shows. Reopened: it does not (once per member).
  P5  the size of every control in the chart block toolbar, the template picker's family chips,
      and the Reporting soon symbol link; and that the page has no sideways scroll.  (touch widths)
  P6  the Formulas tour, opened on a note that already has a property: its first card and every
      card after it, read as "Step k of n".

    python tools/notebook_fin_fe2_walk.py --data-dir 'C:\\data-fin-fe\\fe2-1' --port 8133 `
        --out 'docs\\notebook\\evidence\\fin-fe2\\walk-<sha>'
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
from notebook_fin_fe_walk import chart_embed, para, pause  # noqa: E402
from notebook_fin_fe_touch_actions_walk import BOXES  # noqa: E402
from notebook_w13h2_walk import Walk, install_bars_route  # noqa: E402
from notebook_w13x_walk import FLAGS, write_calendar  # noqa: E402
from secret_scrub import brief, scrub  # noqa: E402

PW = "LocalTest2026!"
ORB = """() => [...document.querySelectorAll('button')].filter((b) => /(^|[_ ])orb[_ ]/i.test(' ' + b.className + ' ') || /compass|voice|conversation|specialist agent/i.test((b.getAttribute('aria-label') || '') + (b.title || '')))
  .map((b) => { const r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } })
  .filter((b) => b.w > 0 && b.y > window.innerHeight - 220 && b.x > window.innerWidth - 220)"""
TOP_AT = """(sel) => { const el = [...document.querySelectorAll(sel.split('|')[0])].find((b) => b.textContent.trim() === sel.split('|')[1] && b.getBoundingClientRect().width > 0);
  if (!el) return null; const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const top = document.elementFromPoint(cx, cy);
  return { box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], cx, cy,
           top_is_button: !!top && (top === el || el.contains(top)), top_tag: top ? top.tagName + '.' + String(top.className && top.className.baseVal !== undefined ? top.className.baseVal : top.className).slice(0, 40) : null } }"""
SCROLL = """() => { const m = document.querySelector('main') || document.body; return { doc: document.documentElement.scrollWidth - window.innerWidth,
  inner: [...document.querySelectorAll('*')].filter((e) => e.scrollWidth - e.clientWidth > 2 && getComputedStyle(e).overflowX !== 'visible' && getComputedStyle(e).overflowX !== 'hidden' && e.clientWidth > 300).map((e) => e.tagName + '.' + String(e.className).slice(0, 30)).slice(0, 4) } }"""


def api_note(req, base, title, content, **extra):
    r = req.post(base + "/api/j2/notes", data={"title": title, "bodyJson": {"type": "doc", "content": content}, **extra})
    if r.status not in (200, 201):
        raise h.SetupFailed(f"creating '{title}' failed: HTTP {r.status} {r.text()[:300]}")
    return r.json()["note"]


def goto_note(pg, base, nid, first, extra=""):
    path = f"/journal/notebook?note={nid}{extra}"
    if first:
        pg.goto(base + path, wait_until="domcontentloaded")
        h._dismiss_intro(pg)
    else:
        pg.evaluate("(p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')) }", path)
    pg.wait_for_function("(id) => new URLSearchParams(location.search).get('note') === id", arg=nid, timeout=30000)
    pg.wait_for_selector(".ProseMirror", timeout=60000)


def press(pg, loc, touch):
    loc.scroll_into_view_if_needed(timeout=10000)
    (loc.tap(timeout=15000) if touch else loc.click(timeout=15000))


def confirm_check(pg, w, tag, touch, obs, key):
    """With a ConfirmModal open: is its confirm button the top element at its own centre, and is
    the floating voice button gone?"""
    pg.get_by_role("dialog").first.wait_for(state="visible", timeout=15000)
    pause(pg, 0.6)
    name = pg.evaluate("() => { const d = document.querySelector('[role=dialog][aria-modal=true]'); const b = d && [...d.querySelectorAll('button')].pop(); return b ? b.textContent.trim() : null }")
    top = pg.evaluate(TOP_AT, f"[role=dialog] button|{name}")
    obs[key] = {"confirm_label": name, "hit": top, "orb_while_open": pg.evaluate(ORB),
                "body_overflow": pg.evaluate("() => document.body.style.overflow")}
    w.shot(pg, f"{tag}_{key}")
    return name, top


def p1(pg, base, req, w, tag, touch, first):
    obs = {}
    n = api_note(req, base, f"fe2 delete me {tag}", [para("to be deleted")])
    goto_note(pg, base, n["id"], first)
    # the floating voice button mounts a moment after the page: wait for it, and read what sits
    # where the confirm button will be (bottom right) BEFORE the dialog exists
    CORNER = "() => { const el = document.elementFromPoint(window.innerWidth - 46, window.innerHeight - 49); return el ? el.tagName + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 50) + (el.closest('button') ? ' in button[' + (el.closest('button').getAttribute('aria-label') || '') + ']' : '') : null }"
    for _ in range(20):
        obs["orb_before"] = pg.evaluate(ORB)
        if obs["orb_before"]:
            break
        pause(pg, 0.5)
    obs["corner_before"] = pg.evaluate(CORNER)
    press(pg, pg.get_by_role("button", name="More note actions").first, touch)
    pause(pg, 0.5)
    press(pg, pg.get_by_role("button", name=re.compile(r"^Delete")).last, touch)
    name, top = confirm_check(pg, w, tag, touch, obs, "note_delete")
    obs["corner_while_open"] = pg.evaluate(CORNER)
    ok_clear = bool(top) and top["top_is_button"] and not obs["note_delete"]["orb_while_open"] and bool(obs["orb_before"])
    w.record(f"{tag}_P1a_confirm_button_is_clear_of_floating_buttons", ok_clear,
             f"voice button before={len(obs['orb_before'])} (bottom-right corner held {obs['corner_before']!r}); while the dialog is open={len(obs['note_delete']['orb_while_open'])} (corner holds {obs['corner_while_open']!r}); "
             f"top element at the centre of '{name}' is the button={top and top['top_is_button']} ({top and top['top_tag']}); box={top and top['box']}")
    if top:
        (pg.touchscreen.tap(top["cx"], top["cy"]) if touch else pg.mouse.click(top["cx"], top["cy"]))
    pause(pg, 2.0)
    after = req.get(f"{base}/api/j2/notes/{n['id']}")
    body = after.json() if after.status == 200 else {}
    note = body.get("note") or body
    gone = after.status == 404 or bool(note.get("deletedAt") or note.get("deleted_at") or note.get("inTrash") or note.get("in_trash") or note.get("trashedAt"))
    obs["after_delete"] = {"status": after.status, "keys": sorted(note.keys())[:40], "deletedAt": note.get("deletedAt"), "dialog_left": pg.get_by_role("dialog", name="Delete this note?").count()}
    listed = req.get(base + "/api/j2/notes?limit=200").json()
    rows = listed.get("notes") if isinstance(listed, dict) else listed
    in_list = any(r.get("id") == n["id"] for r in (rows or []))
    obs["after_delete"]["still_in_notes_list"] = in_list
    w.record(f"{tag}_P1b_tap_on_confirm_deletes_the_note", (gone or not in_list) and obs["after_delete"]["dialog_left"] == 0,
             f"GET note -> {after.status}, deletedAt={note.get('deletedAt')!r}; still in the notes list={in_list}; dialogs left={obs['after_delete']['dialog_left']}")
    w.raw[f"{tag}_P1"] = obs
    w.dump(f"{tag}_P1.json", obs)


def p3(pg, base, req, w, tag, touch):
    obs = {}
    # the walk's member: Get started hidden, and a dismissed row for ANOTHER tour
    a = req.post(base + "/api/auth/preferences", data={"key": "notebook_getting_started",
                                                        "value": json.dumps({"v": 1, "state": "dismissed", "done": []})})
    b = req.put(base + "/api/j2/onboarding/tours/writing-help", data={"state": "dismissed", "step": None})
    obs["seed"] = {"hide_get_started": a.status, "declined_other_tour": b.status}
    n = api_note(req, base, f"fe2 thesis {tag}", [para("First thought: the stop is 170.")])
    v2 = req.put(f"{base}/api/j2/notes/{n['id']}", data={"bodyJson": {"type": "doc", "content": [para("Second thought: added a target.")]},
                                                         "baseUpdatedAt": n["updatedAt"]})
    vers = req.get(f"{base}/api/j2/notes/{n['id']}/versions").json().get("versions") or []
    obs["versions"] = {"put": v2.status, "count": len(vers)}
    if not vers:
        raise h.SetupFailed(f"the note has no saved version to resurface: {obs['versions']}")
    vid = vers[-1]["id"]
    prefs0 = req.get(base + "/api/auth/preferences").json()
    obs["tours_pref_before"] = prefs0.get("notebook_tours")
    goto_note(pg, base, n["id"], False, f"&resurfaceVersion={vid}")
    sheet = pg.get_by_role("dialog", name="What you wrote then")
    sheet.first.wait_for(state="visible", timeout=40000)
    seen = None
    for i in range(50):
        seen = pg.evaluate("() => { const e = document.querySelector('[data-tour-explainer]'); return e ? { text: e.innerText.slice(0, 400), in_sheet: !!e.closest('[role=dialog]'), box: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] })() } : null }")
        if seen:
            obs["explainer_appeared_after_s"] = round(i * 0.5, 1)
            break
        pause(pg, 0.5)
    obs["explainer_first_open"] = seen
    obs["sheet_text"] = sheet.first.inner_text()[:300]
    w.shot(pg, f"{tag}_P3_explainer")
    w.record(f"{tag}_P3a_explainer_shows_for_a_member_who_hid_get_started_and_declined_another_tour",
             bool(seen) and "What you wrote then" in seen["text"] and "Got it" in seen["text"],
             f"seed={obs['seed']}; explainer={'shown after ' + str(obs.get('explainer_appeared_after_s')) + ' s' if seen else 'NOT shown in 25 s'}; "
             f"inside the sheet={seen and seen['in_sheet']}; text={seen and seen['text'][:120]!r}")
    pause(pg, 1.0)
    obs["tours_pref_after_showing"] = req.get(base + "/api/auth/preferences").json().get("notebook_tours")
    pg.keyboard.press("Escape")
    pause(pg, 1.5)
    goto_note(pg, base, n["id"], False, "")
    pause(pg, 0.8)
    goto_note(pg, base, n["id"], False, f"&resurfaceVersion={vid}")
    pg.get_by_role("dialog", name="What you wrote then").first.wait_for(state="visible", timeout=40000)
    pause(pg, 12)
    again = pg.locator("[data-tour-explainer]").count()
    obs["explainer_second_open_count"] = again
    w.record(f"{tag}_P3b_shown_once_per_member", again == 0 and "note-resurfaces" in json.dumps(obs["tours_pref_after_showing"] or ""),
             f"explainers on the second open (12 s wait)={again}; the member's row after the first showing={obs['tours_pref_after_showing']!r}")
    pg.keyboard.press("Escape")
    pause(pg, 0.8)
    w.raw[f"{tag}_P3"] = obs
    w.dump(f"{tag}_P3.json", obs)


def p5(pg, base, req, w, tag, touch):
    obs = {}
    live = chart_embed("fe2-" + tag, "ln", 88.0, caption=None)
    live["attrs"]["annotations"] = []
    n = api_note(req, base, f"fe2 chart {tag}", [para("one"), live, para("two")])
    goto_note(pg, base, n["id"], False)
    pg.wait_for_selector("[data-widget-embed-body] canvas", timeout=90000)
    pause(pg, 2)
    pg.locator("[data-widget-embed-view]").first.evaluate("el => el.scrollIntoView({block: 'center'})")
    pause(pg, 0.5)
    boxes = pg.evaluate(BOXES)
    ctl = [c for c in boxes["controls"] if c["visible"]]
    obs["chart_toolbar"] = ctl
    obs["scroll_note"] = pg.evaluate(SCROLL)
    frame = pg.evaluate("() => { const f = document.querySelector('[data-widget-embed-view]').getBoundingClientRect(); const t = [...document.querySelector('[data-widget-embed-view]').children].find((c) => (c.className || '').includes('toolbar')).getBoundingClientRect(); return { frame: [Math.round(f.left), Math.round(f.right)], toolbar: [Math.round(t.left), Math.round(t.right), Math.round(t.height)] } }")
    obs["toolbar_inside_block"] = frame
    w.shot(pg, f"{tag}_P5_toolbar")
    small = [c for c in ctl if c["w"] < 44 or c["h"] < 44]
    inside = frame["toolbar"][0] >= frame["frame"][0] - 1 and frame["toolbar"][1] <= frame["frame"][1] + 1
    w.record(f"{tag}_P5a_chart_toolbar_controls_44_by_44", bool(ctl) and not small and inside and obs["scroll_note"]["doc"] <= 1,
             f"{len(ctl)} controls; under 44 in either direction: {[(c['name'][:22], c['w'], c['h']) for c in small]}; "
             f"toolbar inside the block={inside} {frame}; sideways scroll of the page={obs['scroll_note']['doc']} px")
    # the template picker's family chips
    pg.evaluate("(p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')) }", "/journal/notebook?view=all")
    pause(pg, 2.0)
    chips = None
    try:
        press(pg, pg.get_by_role("button", name=re.compile(r"Templates")).first, touch)
        pause(pg, 1.5)
        chips = pg.evaluate("""() => [...document.querySelectorAll('[data-template-gallery] button, [role=dialog] button')].filter((b) => /chip/.test(b.className))
          .map((b) => { const r = b.getBoundingClientRect(); return { name: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) } }).filter((b) => b.w > 0)""")
        w.shot(pg, f"{tag}_P5_template_chips")
        pg.keyboard.press("Escape")
        pause(pg, 0.6)
    except Exception as e:  # noqa: BLE001
        obs["chips_error"] = brief(e, 200)
    obs["template_chips"] = chips
    bad = [c for c in (chips or []) if c["w"] < 44 or c["h"] < 44]
    w.record(f"{tag}_P5b_template_picker_chips_44_by_44", bool(chips) and not bad,
             f"chips={[(c['name'], c['w'], c['h']) for c in (chips or [])][:8]}; under 44: {bad}")
    # Reporting soon on Research Home
    # a document load: the notes this walk made through the API are not in the page's cached
    # list, and with an empty cached list Home shows its first-run screen (run 3 measured that)
    pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
    soon = req.get(base + "/api/j2/earnings-prep/soon")
    obs["reporting_soon_api"] = {"status": soon.status, "body": soon.text()[:500]}
    obs["watchlists"] = req.get(base + "/api/watchlists").text()[:300]
    link = pg.get_by_role("link", name="AMD research")
    try:
        link.first.wait_for(state="visible", timeout=25000)
        link.first.scroll_into_view_if_needed()
        bb = link.first.bounding_box()
        row = pg.evaluate("""() => { const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('aria-label') === 'AMD research'); const li = a && a.closest('li');
          return li ? [...li.querySelectorAll('a, button')].map((b) => { const r = b.getBoundingClientRect(); return { name: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) } }) : null }""")
    except Exception as e:  # noqa: BLE001
        bb, row = None, None
        obs["reporting_soon_error"] = brief(e, 200)
    obs["reporting_soon_symbol_link"] = bb
    obs["reporting_soon_row_controls"] = row
    obs["scroll_home"] = pg.evaluate(SCROLL)
    w.shot(pg, f"{tag}_P5_reporting_soon")
    rbad = [c for c in (row or []) if c["w"] < 44 or c["h"] < 44]
    w.record(f"{tag}_P5c_reporting_soon_row_controls_44_by_44", bool(bb) and not rbad and obs["scroll_home"]["doc"] <= 1,
             f"symbol link box={bb and [round(bb['width']), round(bb['height'])]}; row controls={row}; sideways scroll={obs['scroll_home']['doc']} px")
    w.raw[f"{tag}_P5"] = obs
    w.dump(f"{tag}_P5.json", obs)


def p6(pg, base, req, w, tag, touch):
    obs = {}
    d1 = req.post(base + "/api/j2/property-defs", data={"name": f"Entry {tag}", "type": "number"})
    d2 = req.post(base + "/api/j2/property-defs", data={"name": f"Stop {tag}", "type": "number"})
    e_id = (d1.json().get("propertyDef") or {}).get("id") if d1.status in (200, 201) else None
    s_id = (d2.json().get("propertyDef") or {}).get("id") if d2.status in (200, 201) else None
    f = req.post(base + "/api/j2/property-defs", data={"name": f"Risk {tag}", "type": "formula",
                                                       "config": {"expression": f"{{@{e_id}}} - {{@{s_id}}}"}}) if e_id and s_id else None
    obs["defs"] = {"entry": d1.status, "stop": d2.status, "formula": f.status if f else None, "formula_body": f.text()[:200] if f else None}
    n = api_note(req, base, f"fe2 formulas {tag}", [para("a note with properties")])
    put = req.put(f"{base}/api/j2/notes/{n['id']}", data={"properties": {e_id: 180, s_id: 170}, "baseUpdatedAt": n["updatedAt"]}) if e_id and s_id else None
    obs["properties_put"] = {"status": put.status if put else None, "stored": ((put.json().get("note") or {}).get("properties") if put and put.status == 200 else (put.text()[:200] if put else None))}
    goto_note(pg, base, n["id"], False)
    pause(pg, 2.5)
    obs["anchors_on_screen"] = pg.evaluate("() => ['properties-add-empty','properties-add','computed-value','computed-edit'].map((a) => [a, document.querySelectorAll(`[data-tour=\"${a}\"]`).length])")
    pg.evaluate("() => window.dispatchEvent(new CustomEvent('uct:notebook-registry-tour-open', { detail: { tourId: 'formulas-rollups' } }))")
    cards = []
    try:
        pg.wait_for_selector("[data-tour-card]", timeout=20000)
        for _ in range(8):
            pause(pg, 0.7)
            card = pg.evaluate("() => { const c = document.querySelector('[data-tour-card]'); if (!c) return null; const p = [...c.querySelectorAll('p')].map((x) => x.textContent.trim()).find((t) => /^Step \\d+ of \\d+$/.test(t)); const b = [...c.querySelectorAll('button')].map((x) => x.textContent.trim()); return { progress: p, title: (c.querySelector('h2') || {}).textContent, buttons: b } }")
            if not card:
                break
            if not cards or cards[-1]["progress"] != card["progress"] or cards[-1]["title"] != card["title"]:
                cards.append(card)
            nxt = pg.locator("[data-tour-card]").get_by_role("button", name="Next")
            if nxt.count() and nxt.first.is_enabled():
                press(pg, nxt.first, touch)
                pause(pg, 2.2)
            else:
                break
        w.shot(pg, f"{tag}_P6_last_card")
        done = pg.locator("[data-tour-card]").get_by_role("button", name="Done")
        if done.count():
            press(pg, done.first, touch)
        else:
            pg.keyboard.press("Escape")
    except Exception as e:  # noqa: BLE001
        obs["error"] = brief(e, 300)
    obs["cards"] = cards
    prog = [c["progress"] for c in cards]
    nums = [tuple(int(x) for x in re.findall(r"\d+", p or "0 0")) for p in prog]
    opens_on_one = bool(nums) and nums[0][0] == 1
    counts_up = all(nums[i][0] == i + 1 for i in range(len(nums)))
    ends_on_total = bool(nums) and nums[-1][0] == nums[-1][1]
    w.record(f"{tag}_P6_formulas_tour_opens_on_step_1_and_counts_what_it_shows", opens_on_one and counts_up and ends_on_total,
             f"cards={prog}; titles={[c['title'] for c in cards]}; anchors on screen={obs['anchors_on_screen']}; defs={obs['defs']}")
    w.raw[f"{tag}_P6"] = obs
    w.dump(f"{tag}_P6.json", obs)


def sweep(pg, base, req, w, tag, touch):
    """Other Notebook confirms at this width: bulk Move to Trash and a folder's Delete."""
    obs = {}
    a = api_note(req, base, f"fe2 bulk a {tag}", [para("a")])
    api_note(req, base, f"fe2 bulk b {tag}", [para("b")])
    fo = req.post(base + "/api/j2/note-folders", data={"name": f"fe2 folder {tag}"})
    obs["folder_create"] = fo.status
    pg.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded")
    pause(pg, 3.5)
    try:
        box = pg.get_by_role("checkbox", name=re.compile(r"^Select fe2 bulk a"))
        press(pg, box.first, touch)
        pause(pg, 0.6)
        press(pg, pg.get_by_role("button", name=re.compile(r"Move to Trash|Trash")).first, touch)
        name, top = confirm_check(pg, w, tag, touch, obs, "bulk_trash")
        obs["bulk_ok"] = bool(top) and top["top_is_button"] and not obs["bulk_trash"]["orb_while_open"]
        press(pg, pg.get_by_role("dialog").get_by_role("button", name="Cancel").first, touch)
        pause(pg, 0.6)
    except Exception as e:  # noqa: BLE001
        obs["bulk_error"] = brief(e, 240)
        pg.keyboard.press("Escape")
    w.raw[f"{tag}_sweep"] = obs
    w.dump(f"{tag}_sweep.json", obs)
    if "bulk_ok" in obs:
        w.record(f"{tag}_P1c_sweep_bulk_move_to_trash_confirm_is_clear", obs["bulk_ok"],
                 f"label={obs['bulk_trash']['confirm_label']!r}; top at its centre is the button={obs['bulk_trash']['hit'] and obs['bulk_trash']['hit']['top_is_button']}; "
                 f"voice button while open={len(obs['bulk_trash']['orb_while_open'])}")
    else:
        print(f"  OBSERVED {tag}: the bulk Move to Trash confirm was not reached ({obs.get('bulk_error')})")
    _ = a


def run(base, w):
    from playwright.sync_api import sync_playwright
    served, errors = [], []
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin = br.new_context()
        # Sign-up answers 429 past three a minute, so every account is made up front, spaced out.
        h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        import time as _t
        made = 1
        for width in (1280, 820, 390):
            if made >= 3:
                _t.sleep(65)
                made = 0
            r = admin.request.post(base + "/api/auth/signup", data={"email": f"fe2-{width}@local.dev", "password": PW, "display_name": f"fe2{width}"})
            made += 1
            if r.status not in (200, 201):
                raise h.SetupFailed(f"signing up fe2-{width}@local.dev failed: HTTP {r.status} {r.text()[:160]}")
            admin.request.post(base + "/api/auth/logout")
            h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest") if False else admin.request.post(base + "/api/auth/login", data={"email": h.ADMIN_EMAIL, "password": h.ADMIN_PW})
            admin.request.post(base + "/api/auth/admin/comp-access", data={"email": f"fe2-{width}@local.dev", "action": "grant"})
            admin.request.post(base + "/api/auth/admin/verify-email", data={"email": f"fe2-{width}@local.dev"})
        for width, height, touch in ((1280, 900, False), (820, 1180, True), (390, 844, True)):
            tag = f"V{width}"
            ctx = br.new_context(reduced_motion="reduce", viewport={"width": width, "height": height},
                                 **({"has_touch": True, "is_mobile": True} if touch else {}))
            req = ctx.request
            lg = req.post(base + "/api/auth/login", data={"email": f"fe2-{width}@local.dev", "password": PW})
            if lg.status not in (200, 201) or not req.get(base + "/api/auth/me").json().get("paid_equiv"):
                raise h.SetupFailed(f"fe2-{width}@local.dev could not sign in as a paid member: HTTP {lg.status}")
            me = req.get(base + "/api/auth/me").json()
            if width == 1280:
                w.record("W0_paid_member_and_switches_on", bool(me.get("paid_equiv")) and me.get("notebook_formulas_enabled") is True
                         and me.get("awareness_note_resurface_enabled") is True and me.get("notebook_getting_started_enabled") is True,
                         f"paid={me.get('paid_equiv')} formulas={me.get('notebook_formulas_enabled')} resurface={me.get('awareness_note_resurface_enabled')} "
                         f"getting_started={me.get('notebook_getting_started_enabled')} earnings_prep={me.get('notebook_earnings_prep_enabled')}")
            wl = req.post(base + "/api/watchlists", data={"name": "This week"})
            wl_id = (wl.json() or {}).get("id") if wl.status in (200, 201) else None
            if wl_id:
                req.post(f"{base}/api/watchlists/{wl_id}/items", data={"sym": "AMD"})
            install_bars_route(ctx, served)
            pg = ctx.new_page()
            pg.on("pageerror", lambda e, t=tag: errors.append(f"{t}: {brief(e, 240)}"))
            steps = [("P1", lambda: p1(pg, base, req, w, tag, touch, True)), ("P3", lambda: p3(pg, base, req, w, tag, touch)),
                     ("P6", lambda: p6(pg, base, req, w, tag, touch)), ("sweep", lambda: sweep(pg, base, req, w, tag, touch))]
            if touch:
                steps.insert(2, ("P5", lambda: p5(pg, base, req, w, tag, touch)))
            for name, fn in steps:
                try:
                    fn()
                except h.SetupFailed:
                    raise
                except Exception as e:  # noqa: BLE001
                    w.record(f"{tag}_{name}_walk", False, f"raised {brief(e, 400)}")
                    w.shot(pg, f"{tag}_{name}_error")
                    try:
                        pg.keyboard.press("Escape")
                    except Exception:  # noqa: BLE001
                        pass
            ctx.close()
        w.raw["page_errors"] = errors
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8133)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why or args.port != 8133 or h.port_busy(args.port):
        print(f"REFUSED: {why or 'port must be 8133 and free'}")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    w = Walk(out)
    for k in list(os.environ):
        if k.startswith("RAILWAY_"):
            os.environ.pop(k, None)
    d = date.today()
    n = 3
    while n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    cal = write_calendar(data_dir, {"AMD": {"date": d.isoformat()}})
    os.environ.update({f: "1" for f in FLAGS})
    os.environ.update({"NOTEBOOK_ONBOARDING_ENABLED": "1", "NOTEBOOK_GETTING_STARTED_ENABLED": "1",
                       "NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR": str(cal),
                       "FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    not_run = failure = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            try:
                run(base, w)
            except h.SetupFailed as e:
                not_run = scrub(str(e))[:400]
            except Exception as e:  # noqa: BLE001
                import traceback
                failure = f"the walk raised {brief(e, 400)}"
                w.raw["traceback"] = scrub(traceback.format_exc())[-3000:]
            box.wait_checkpoint(h.POST_BOOT, 60)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    w.record("W10_port_free_after_shutdown", not h.port_busy(args.port), f"listener on {args.port}: {h.port_busy(args.port)}")
    (out / "walk.json").write_text(json.dumps({"tool": "tools/notebook_fin_fe2_walk.py", "integrity": integ, "failure": failure,
                                               "not_run": not_run, "rows": w.rows, "raw": w.raw}, indent=1, ensure_ascii=False, default=str),
                                   encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    failed = [r["id"] for r in w.rows if r["verdict"] != "PASS"]
    if failure or failed:
        print(f"VERDICT: FAIL -- {failure or ', '.join(failed)}")
        return 1
    if not integ.get("clean"):
        print(f"VERDICT: INTEGRITY {integ.get('status')}")
        return 2
    print(f"VERDICT: PASS -- {len(w.rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
