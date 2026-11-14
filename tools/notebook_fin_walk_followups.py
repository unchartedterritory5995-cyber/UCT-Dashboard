"""Notebook follow-ups (A to D, 2026-11-13) -- configuration c2's `followups` step.

Driven by tools/notebook_fin_walk_features.py (`run_c2`, step `followups`, between `discover` and `remove`), which hands
over its own helpers through `env`. Every check makes its OWN member (or a phone window of one), so nothing here changes
what a later step finds, and an `--attach --only followups` run gives the same answers as the full run.

What it walks, each as a member does it, each row read from the page's own answer:
  templates.*  follow-up C, one room for templates: Manage templates from the list's More menu; its Active, Archived and
               Recently deleted views; Archive of a template used in a note (the question names the count) and Restore
               from Archived; Delete and Undo ("Moved to Recently deleted."); Save as template (plain) from a note, then
               the Plain templates group's Use, Rename, Delete (its question); "Daily notes start from" set in the
               manager and shown by the New note sheet; the sheet's "Manage" link; My tools > Templates' button;
               `?styles=1&show=archived`; the manager at 1280 and 390 with no horizontal scroll.
  day.*        follow-up B, the two day pages one press apart: Journal Today's Quick actions "Daily brief"; the command
               palette's "Daily brief"; the phone folders drawer closes when Daily brief is chosen. (The setups board's
               "Back to Daily brief" is `discover.setups-card`.)
  held.*       follow-up B, held modules: Insert pressed straight after a page load (its chunk held back) shows its frame
               in the palette's slot with focus inside and a Close, the toolbar area keeps its height, a ticker typed at
               once never reaches the note; the same at 390 through "+" > "Chart or block"; "Or tell Notebook what to
               change" opens with focus in its field; the formula editor from Add property.
  bulk.*       follow-up A: Move to Trash on a selection straight after a page load (the library held back) completes.
  label.*      follow-up D: on a page load the save label reads "" then "Saved"; typing reads "Saving…" then "Saved".
  usage.*      follow-up A: one `view_used` per View menu choice, one `menu_row_used` per menu row, one
               `today_door_used` when Today's note opens, and no telemetry body carrying a note title.
(The walkthroughs, the Reviews tour's card without Back included, are the `tours*` steps: tools/notebook_w14q2_tours_walk.py
records `noBack`.)

Words a check compares against are read from the product's files, never retyped. Never run on import.
"""
from __future__ import annotations

import json
import os
import re
import time
import traceback
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
_J2 = REPO / "app" / "src" / "pages" / "journal-2-0"
_NB = _J2 / "components" / "notebook"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _grab(pattern: str, path: Path, group: int = 1) -> str:
    m = re.search(pattern, _read(path))
    if not m:
        raise RuntimeError(f"the walk's anchor {pattern!r} is no longer in {path.name}")
    return m.group(group)


# ── words read from the product ─────────────────────────────────────────────────────────────────────────────────────
MANAGER_VIEWS = [lbl for _k, lbl in re.findall(r"\['(\w+)', '([^']+)'\]",
                                                _grab(r"export const MANAGER_VIEWS = Object\.freeze\(\[(.*?)\]\)\n", _NB / "styles" / "StylesManager.jsx"))]
assert MANAGER_VIEWS == ["Active", "Archived", "Recently deleted"], MANAGER_VIEWS
PLAIN_TITLE = _grab(r"title: '([^']+)',", _NB / "MemberTemplates.jsx")
DAILY_DELETE_SENTENCE = _grab(r"dailyDelete: '([^']+)',", _NB / "MemberTemplates.jsx")
DAILY_CHANGE_LINK = _grab(r"onManage\('daily', e\.currentTarget\)\}\s*aria-label=\"([^\"]+)\"", _NB / "MemberTemplates.jsx")
PLAIN_MANAGE_LINK = _grab(r"onManage\('plain', e\.currentTarget\)\}\s*aria-label=\"([^\"]+)\"", _NB / "MemberTemplates.jsx")
OPEN_MANAGER = _grab(r"export const OPEN_MANAGER = '([^']+)'", _NB / "myTools" / "TemplatesTab.jsx")
INSERT_LOADING = _grab(r"export const INSERT_LOADING = '([^']+)'", _NB / "EditorToolSlots.jsx")
SAVED_WORDS = _grab(r"export const SAVED_WORDS = '([^']+)'", _J2 / "lib" / "offline" / "unsyncedCopy.js")
SAVING_WORDS = _grab(r"export const SAVING_WORDS = '([^']+)'", _J2 / "lib" / "offline" / "unsyncedCopy.js")
MORE_NOTE_ACTIONS = _grab(r"export const MORE_NOTE_ACTIONS = '([^']+)'", _NB / "NoteMoreMenu.jsx")
PHONE_PALETTE_ROW = _grab(r"\{ label: '([^']+)', onClick: \(\) => \{ paletteOpenerRef\.current = insertPhoneRef", _NB / "NoteEditorPage.jsx")
AI_ACTIONS_LABEL = _grab(r'aria-label="(Or tell Notebook what to change)"', _NB / "AiActionsPanel.jsx")
TODAY_ROW = _grab(r"\{ key: 'today', label: \"([^\"]+)\"", _J2 / "tabs" / "NotebookTab.jsx")
DAILY_BRIEF = _grab(r"\{ id: 'nb-daily-brief', kind: 'command', label: '([^']+)'", REPO / "app" / "src" / "components" / "CommandPalette.jsx")
TEMPLATE_ARCHIVE_ONE = _grab(r"\? `(It stays in your \$\{notesWord\(n\)\}\.[^`]*)`", _NB / "myTools" / "myToolsLib.js").replace("${notesWord(n)}", "1 note")
UNDO_DELETED = _grab(r"viewsOn \? `Deleted “\$\{undo\.name\}”\. ([^`]+)`", _NB / "styles" / "StylesManager.jsx")

FOCUS_JS = r"""() => { const a = document.activeElement; if (!a || a === document.body) return { tag: null };
  const dlg = a.closest('[role=dialog]');
  return { tag: a.tagName.toLowerCase(), id: a.id || null, label: a.getAttribute('aria-label'), role: a.getAttribute('role'),
           in_dialog: dlg ? (dlg.getAttribute('aria-label') || (dlg.querySelector('h2') || {}).textContent || '').trim().slice(0, 60) : null,
           in_editor: !!a.closest('.ProseMirror'), text: (a.textContent || '').trim().slice(0, 60) } }"""
BOX_JS = r"""(el) => { const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(1), height: +b.height.toFixed(1), bottom: +b.bottom.toFixed(1) } }"""
HSCROLL_JS = r"""(sel) => { const d = document.documentElement; const out = { page: d.scrollWidth - d.clientWidth, boxes: [] };
  for (const el of document.querySelectorAll(sel)) { const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    out.boxes.push({ over: el.scrollWidth - el.clientWidth, right: +r.right.toFixed(1), left: +r.left.toFixed(1), vw: innerWidth }) }
  return out }"""
# The note-saved label as a timeline: every text `[data-save-indicator]` holds, in order, from the first paint
# (an init script, so the first state of a fresh page load is seen).
LABEL_RECORDER = r"""(() => { window.__labels = []; const seen = () => { const el = document.querySelector('[data-save-indicator]');
    const t = el ? (el.textContent || '').trim() : null; const L = window.__labels;
    if (!L.length || L[L.length - 1] !== t) L.push(t) };
  new MutationObserver(seen).observe(document, { subtree: true, childList: true, characterData: true }); seen() })()"""


def run(env: dict) -> None:
    C, base, inst, cfg = env["C"], env["base"], env["inst"], env["cfg"]
    new_member, at, phone_of, HOLD = env["new_member"], env["at"], env["phone_of"], env["HOLD"]
    open_templates, cover_js = env["open_templates"], env["cover_js"]
    tag = str(int(time.time()) % 100000)
    titles: list[str] = []          # every note title this step makes (the usage row's privacy check reads them)
    telemetry: list[dict] = []      # every POST /api/j2/telemetry body seen by any context this step opens

    def listen(ctx_):
        def on_req(req):
            try:
                if req.method == "POST" and "/api/j2/telemetry" in req.url:
                    telemetry.append({"body": req.post_data or "", "t": time.time()})
            except Exception:  # noqa: BLE001 -- an event handler never raises into the walk
                pass
        ctx_.on("request", on_req)

    def mk_note(c_, i_, title, text):
        titles.append(title)
        doc = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}
        st, body = C.api(c_, i_, "POST", base, "/api/j2/notes", {"title": title, "bodyJson": doc})
        return ((body or {}).get("note") or {}).get("id") if isinstance(body, dict) else None

    def manager(p_):
        return p_.get_by_role("dialog", name="Manage templates")

    def list_more(p_, row):
        btn = p_.get_by_role("button", name="More notebook actions", exact=True)
        C.vis_loc(btn, 30000)
        C.press_through(p_, btn.first)
        p_.get_by_role("menu", name="More notebook actions").get_by_role("menuitem", name=row, exact=True).first.click(timeout=15000)

    def tab(p_, name):
        return manager(p_).get_by_role("tab", name=name, exact=True)

    def guarded(name, fn):
        HOLD.clear()
        try:
            fn()
        except Exception as e:  # noqa: BLE001 -- recorded, and the next check still runs
            pg_ = HOLD.get("pg")
            try:
                if pg_ is not None and pg_.is_closed():
                    pg_ = None            # its context was closed on the way out: the traceback is the record
            except Exception:  # noqa: BLE001
                pg_ = None
            HOLD["pg"] = pg_
            C.step(HOLD.get("pg"), HOLD.get("inst") or inst, f"followups.{name}", "driver exception (the check did not finish)", "FAIL",
                   error=f"{type(e).__name__}: {str(e)[:600]}", traceback=traceback.format_exc()[-1600:], shot=HOLD.get("pg") is not None)

    # ── templates: one room (1280), then the same room at 390 ───────────────────────────────────────────────────────
    def templates():
        c_, _e, _me, i_, p_ = new_member("c2fut", "1280")
        listen(c_)
        try:
            used_name, del_name = f"Walk used template {tag}", f"Walk delete template {tag}"
            _s1, b1 = C.api(c_, i_, "POST", base, "/api/j2/journal-styles", {"name": used_name, "kindId": "thesis", "blocks": []})
            used_id = (((b1 or {}).get("style") or {}) if isinstance(b1, dict) else {}).get("id")
            titles.append(f"Made from {used_name}")
            C.api(c_, i_, "POST", base, "/api/j2/notes", {"styleId": used_id, "title": f"Made from {used_name}"})
            _s2, b2 = C.api(c_, i_, "POST", base, "/api/j2/journal-styles", {"name": del_name, "kindId": "thesis", "blocks": []})
            del_id = (((b2 or {}).get("style") or {}) if isinstance(b2, dict) else {}).get("id")
            src_title = f"Plain template source {tag}"
            src_text = f"Walk plain template body {tag}"
            src_id = mk_note(c_, i_, src_title, src_text)

            # 1. the door and the three views
            at(p_, base, "/journal/notebook", first_run=True)
            list_more(p_, "Manage templates")
            m = manager(p_)
            opened = C.vis_loc(m, 20000)
            tabs = [t.strip() for t in m.get_by_role("tab").all_inner_texts()] if opened else []
            C.step(p_, i_, "followups.templates.door", "the list's More > Manage templates opens the manager with its views Active, Archived, Recently deleted",
                   "PASS" if opened and tabs == MANAGER_VIEWS else "FAIL", tabs=tabs, expected=MANAGER_VIEWS)
            views = {}
            for v in MANAGER_VIEWS:
                tab(p_, v).first.click(timeout=10000)
                p_.wait_for_timeout(1200)
                views[v] = {"selected": tab(p_, v).first.get_attribute("aria-selected"),
                            "alerts": [a[:160] for a in m.get_by_role("alert").all_inner_texts()]}
            ok = all(x["selected"] == "true" and not x["alerts"] for x in views.values())
            C.step(p_, i_, "followups.templates.views", "each view is chosen in turn (aria-selected) and draws without an error", "PASS" if ok else "FAIL",
                   views=views, scope=['[role=dialog][aria-label="Manage templates"]'])

            # 2. Archive a template used in a note: the question names the count; Restore it from Archived
            tab(p_, "Active").first.click(timeout=10000)
            arch_btn = m.get_by_role("button", name=f"Archive {used_name}", exact=True)
            C.vis_loc(arch_btn, 20000)
            arch_btn.first.scroll_into_view_if_needed(timeout=5000)
            arch_btn.first.click(timeout=10000)
            panel = m.locator('[data-testid="my-tools-archive"]')
            C.vis_loc(panel, 15000)
            sentence = ""
            for _ in range(40):
                sentence = (panel.locator('[data-testid="archive-sentence"]').first.text_content() or "").strip() if panel.count() else ""
                if sentence and not sentence.startswith("Checking"):
                    break
                p_.wait_for_timeout(250)
            asked = sentence == TEMPLATE_ARCHIVE_ONE
            panel.get_by_role("button", name="Archive", exact=True).first.click(timeout=10000)
            archived_line = C.vis_loc(m.get_by_text(f"Archived “{used_name}”.", exact=False), 15000)
            listing = c_.request.get(base + "/api/j2/journal-styles").json()
            gone_from_live = used_id not in [s.get("id") for s in (listing.get("styles") or [])]
            C.step(p_, i_, "followups.templates.archive-used", "Archive on a template used in 1 note asks first, naming the count; Archive then takes it out of the list",
                   "PASS" if asked and archived_line and gone_from_live else "FAIL", sentence=sentence, expected=TEMPLATE_ARCHIVE_ONE,
                   archived_line=archived_line, gone_from_live_list=gone_from_live)
            tab(p_, "Archived").first.click(timeout=10000)
            restore = m.get_by_role("button", name=f"Restore {used_name}", exact=True)
            shown_archived = C.vis_loc(restore, 20000)
            if shown_archived:
                restore.first.click(timeout=10000)
            back_live = False
            for _ in range(30):
                listing = c_.request.get(base + "/api/j2/journal-styles").json()
                if used_id in [s.get("id") for s in (listing.get("styles") or [])]:
                    back_live = True
                    break
                p_.wait_for_timeout(500)
            restored_line = [t[:160] for t in m.get_by_role("status").all_inner_texts() if "Restored" in t]
            C.step(p_, i_, "followups.templates.restore-archived", "Archived lists it with Restore; Restore puts it back in the template list",
                   "PASS" if shown_archived and back_live else "FAIL", listed_in_archived=shown_archived, back_in_live_list=back_live,
                   status=restored_line)

            # 3. soft Delete and Undo, then Recently deleted lists a deleted one with Restore
            tab(p_, "Active").first.click(timeout=10000)
            del_btn = m.get_by_role("button", name=f"Delete {del_name}", exact=True)
            C.vis_loc(del_btn, 20000)
            del_btn.first.scroll_into_view_if_needed(timeout=5000)
            del_btn.first.click(timeout=10000)
            want_line = f"Deleted “{del_name}”. {UNDO_DELETED}"
            line = C.vis_loc(m.get_by_text(want_line, exact=False), 15000)
            undo = m.get_by_role("button", name="Undo", exact=True)
            undo_on = C.vis_loc(undo, 5000)
            if undo_on:
                undo.first.click(timeout=10000)
            restored = C.vis_loc(m.get_by_text("Template restored.", exact=False), 15000)
            live = [s.get("id") for s in (c_.request.get(base + "/api/j2/journal-styles").json().get("styles") or [])]
            C.step(p_, i_, "followups.templates.delete-undo", f"Delete says '{want_line}' with Undo; Undo brings it back",
                   "PASS" if line and undo_on and restored and del_id in live else "FAIL", line=line, expected=want_line, undo=undo_on,
                   restored_line=restored, back_in_list=del_id in live)
            del_btn.first.click(timeout=10000)
            C.vis_loc(m.get_by_text(want_line, exact=False), 15000)
            tab(p_, "Recently deleted").first.click(timeout=10000)
            r2 = m.get_by_role("button", name=f"Restore {del_name}", exact=True)
            in_deleted = C.vis_loc(r2, 20000)
            if in_deleted:
                r2.first.click(timeout=10000)
            back2 = False
            for _ in range(30):
                if del_id in [s.get("id") for s in (c_.request.get(base + "/api/j2/journal-styles").json().get("styles") or [])]:
                    back2 = True
                    break
                p_.wait_for_timeout(500)
            C.step(p_, i_, "followups.templates.recently-deleted", "a deleted template is in Recently deleted with Restore; Restore brings it back",
                   "PASS" if in_deleted and back2 else "FAIL", listed=in_deleted, back_in_list=back2)
            p_.keyboard.press("Escape")
            p_.wait_for_timeout(600)

            # 4. Save as template (plain) from a note; the Plain templates group lists it
            plain_name = f"Walk plain {tag}"
            C.goto(p_, base, f"/journal/notebook?note={src_id}", ".ProseMirror")
            p_.wait_for_timeout(1500)
            more = p_.get_by_role("button", name=MORE_NOTE_ACTIONS, exact=True).filter(visible=True)
            C.vis_loc(more, 20000)
            more.first.click(timeout=10000)
            p_.get_by_role("button", name="Save as template", exact=True).filter(visible=True).first.click(timeout=10000)
            plain_btn = p_.get_by_role("button", name="Plain", exact=True).filter(visible=True)
            plain_default = plain_btn.first.get_attribute("aria-pressed") if plain_btn.count() else None
            p_.get_by_label("Template name").last.fill(plain_name)
            with p_.expect_response(lambda r: r.request.method == "POST" and "/api/j2/note-templates" in r.url, timeout=20000) as saved_r:
                p_.get_by_role("button", name="Save template").last.click()
            save_status = saved_r.value.status
            p_.keyboard.press("Escape")
            C.goto(p_, base, "/journal/notebook?styles=1&show=plain")
            m = manager(p_)
            C.vis_loc(m, 20000)
            group = m.locator("[data-plain-templates]")
            row = group.locator("[data-plain-template]").filter(has_text=plain_name)
            listed = C.vis_loc(row, 20000)
            heading = group.get_by_role("heading", name=PLAIN_TITLE, exact=True).count()
            C.step(p_, i_, "followups.templates.plain-saved", f"More > Save as template (Plain, the default) from a note; the manager's '{PLAIN_TITLE}' group lists it",
                   "PASS" if save_status in (200, 201) and listed and heading and plain_default == "true" else "FAIL", save_status=save_status,
                   plain_pressed=plain_default, listed=listed, group_heading=heading, scope=["[data-plain-templates]"])

            # 5. Rename
            new_name = f"Walk plain renamed {tag}"
            group.get_by_role("button", name=f"Rename {plain_name}", exact=True).first.click(timeout=10000)
            box = group.get_by_label(f"New name for {plain_name}")
            box.first.fill(new_name)
            group.get_by_role("button", name="Save", exact=True).first.click(timeout=10000)
            renamed = C.vis_loc(group.get_by_text(f"Renamed to “{new_name}”.", exact=False), 15000)
            stored = [t.get("name") for t in ((c_.request.get(base + "/api/j2/note-templates").json() or {}).get("templates") or [])]
            C.step(p_, i_, "followups.templates.plain-rename", "Rename in the Plain templates group: the sentence says the new name, the server holds it",
                   "PASS" if renamed and new_name in stored else "FAIL", renamed_line=renamed, stored=stored[:10])

            # 6. "Daily notes start from" set in the manager, shown by the New note sheet's line
            pick = group.get_by_label("Daily notes start from")
            C.vis_loc(pick, 15000)
            with p_.expect_response(lambda r: r.request.method == "POST" and "/api/auth/preferences" in r.url, timeout=15000) as pref_r:
                pick.first.select_option(label=new_name)
            pref_status = pref_r.value.status
            p_.keyboard.press("Escape")
            p_.wait_for_timeout(800)
            open_templates(p_)
            line_el = p_.locator("[data-daily-line]")
            line_txt = re.sub(r"\s+", " ", line_el.first.text_content() or "").strip() if C.vis_loc(line_el, 15000) else None
            want_daily = f"Daily notes start from: {new_name}."
            C.step(p_, i_, "followups.templates.daily", f"the manager's 'Daily notes start from' is set; the New note sheet then reads '{want_daily} Change'",
                   "PASS" if pref_status == 200 and line_txt and line_txt.startswith(want_daily) and line_txt.endswith("Change") else "FAIL",
                   pref_status=pref_status, sheet_line=line_txt, expected=want_daily)

            # 7. the sheet's "Manage" link opens the manager at the group
            p_.get_by_role("button", name=PLAIN_MANAGE_LINK, exact=True).first.click(timeout=10000)
            m = manager(p_)
            opened = C.vis_loc(m, 15000)
            p_.wait_for_timeout(1200)
            focus = p_.evaluate(FOCUS_JS)
            head_box = m.locator("#js-plain-templates").first.evaluate(cover_js) if m.locator("#js-plain-templates").count() else {}
            C.step(p_, i_, "followups.templates.sheet-manage", "the New note sheet's Manage link opens Manage templates at the Plain templates group (focus on its heading, in view)",
                   "PASS" if opened and focus.get("id") == "js-plain-templates" and head_box.get("above_fold") else "FAIL",
                   focus=focus, heading=head_box)

            # 8. Use, then Delete with its question (the daily one, which says so)
            group = m.locator("[data-plain-templates]")
            group.get_by_role("button", name=f"Use {new_name}", exact=True).first.click(timeout=10000)
            made = None
            try:
                p_.wait_for_url(lambda u: "note=" in u, timeout=30000)
                made = p_.url.split("note=")[-1].split("&")[0]
                p_.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                p_.wait_for_timeout(1200)
            except Exception:  # noqa: BLE001 -- the row says what it saw
                pass
            body = p_.locator(".ProseMirror").first.inner_text() if made else ""
            closed = not manager(p_).count() or not manager(p_).first.is_visible()
            C.step(p_, i_, "followups.templates.plain-use", "Use in the Plain templates group closes the manager and makes a note holding the template's words",
                   "PASS" if made and made != src_id and src_text in body and closed else "FAIL", note=made, has_words=src_text in body, manager_closed=closed)
            C.goto(p_, base, "/journal/notebook?styles=1&show=plain")
            m = manager(p_)
            C.vis_loc(m, 20000)
            group = m.locator("[data-plain-templates]")
            group.get_by_role("button", name=f"Delete {new_name}", exact=True).first.click(timeout=10000)
            ask = group.get_by_role("group", name=f"Delete {new_name}?")
            ask_txt = re.sub(r"\s+", " ", ask.first.text_content() or "") if C.vis_loc(ask, 10000) else ""
            ask.get_by_role("button", name="Delete", exact=True).first.click(timeout=10000)
            done = C.vis_loc(group.get_by_text(f"Deleted “{new_name}”.", exact=False), 15000)
            left = [t.get("name") for t in ((c_.request.get(base + "/api/j2/note-templates").json() or {}).get("templates") or [])]
            prefs = c_.request.get(base + "/api/auth/preferences").json()
            daily_left = prefs.get("notebook_daily_template")
            C.step(p_, i_, "followups.templates.plain-delete", "Delete asks once (naming the daily use), then deletes; the daily choice is cleared",
                   "PASS" if DAILY_DELETE_SENTENCE in ask_txt and done and new_name not in left and daily_left in (None, "", '""') else "FAIL",
                   question=ask_txt[:300], deleted_line=done, left=left, daily_pref_after=daily_left)
            p_.keyboard.press("Escape")

            # 9. My tools > Templates: one sentence and the button into the manager
            at(p_, base, "/journal/notebook")
            list_more(p_, "My tools")
            tools = p_.get_by_role("dialog", name="My tools")
            C.vis_loc(tools, 20000)
            t_tab = tools.get_by_role("tab", name="Templates", exact=True)
            if not t_tab.count():
                t_tab = tools.get_by_role("button", name="Templates", exact=True)
            t_tab.first.click(timeout=10000)
            open_btn = tools.get_by_role("button", name=OPEN_MANAGER, exact=True)
            has_btn = C.vis_loc(open_btn, 10000)
            if has_btn:
                open_btn.first.click(timeout=10000)
            opened = C.vis_loc(manager(p_), 20000)
            tools_closed = not tools.count() or not tools.first.is_visible()
            C.step(p_, i_, "followups.templates.my-tools", f"My tools > Templates holds '{OPEN_MANAGER}'; it closes My tools and opens Manage templates",
                   "PASS" if has_btn and opened and tools_closed else "FAIL", button=has_btn, manager_opened=opened, my_tools_closed=tools_closed,
                   url_after=p_.url.split("://")[-1].split("/", 1)[-1])
            p_.keyboard.press("Escape")

            # 10. ?styles=1&show=archived opens on Archived, and the address is cleaned
            C.goto(p_, base, "/journal/notebook?styles=1&show=archived")
            m = manager(p_)
            C.vis_loc(m, 20000)
            p_.wait_for_timeout(1200)
            sel = tab(p_, "Archived").first.get_attribute("aria-selected") if tab(p_, "Archived").count() else None
            clean = "styles=" not in p_.url and "show=" not in p_.url
            C.step(p_, i_, "followups.templates.url-archived", "?styles=1&show=archived opens Manage templates on Archived and takes both out of the address",
                   "PASS" if sel == "true" and clean else "FAIL", archived_selected=sel, url_after=p_.url.split("://")[-1].split("/", 1)[-1])
            hs = {v: None for v in MANAGER_VIEWS}
            for v in MANAGER_VIEWS:
                tab(p_, v).first.click(timeout=10000)
                p_.wait_for_timeout(1000)
                hs[v] = p_.evaluate(HSCROLL_JS, '[role=dialog][aria-label="Manage templates"], [role=dialog][aria-label="Manage templates"] *')
            ok = all(x["page"] <= 1 and all(b["right"] <= b["vw"] + 0.5 and b["left"] >= -0.5 for b in x["boxes"]) for x in hs.values())
            C.step(p_, i_, "followups.templates.layout-1280", "1280: every view of the manager fits the window (no horizontal scroll, nothing past the edge)",
                   "PASS" if ok else "FAIL", widest={v: max([b["right"] for b in x["boxes"]] or [0]) for v, x in hs.items()},
                   page_overflow={v: x["page"] for v, x in hs.items()}, scope=['[role=dialog][aria-label="Manage templates"]'])
            p_.keyboard.press("Escape")

            # 11. the room at 390
            c9, i9, p9 = phone_of(c_)
            listen(c9)
            try:
                at(p9, base, "/journal/notebook?styles=1&show=plain")
                m9 = manager(p9)
                C.vis_loc(m9, 20000)
                p9.wait_for_timeout(1500)
                hs9 = {}
                for v in MANAGER_VIEWS:
                    t9 = m9.get_by_role("tab", name=v, exact=True)
                    if t9.count():
                        t9.first.click(timeout=10000)
                        p9.wait_for_timeout(1000)
                    hs9[v] = p9.evaluate(HSCROLL_JS, '[role=dialog][aria-label="Manage templates"], [role=dialog][aria-label="Manage templates"] *')
                ok9 = all(x["page"] <= 1 and all(b["right"] <= b["vw"] + 0.5 and b["left"] >= -0.5 for b in x["boxes"]) for x in hs9.values())
                past = {v: [b for b in x["boxes"] if b["right"] > b["vw"] + 0.5 or b["left"] < -0.5][:5] for v, x in hs9.items()}
                C.step(p9, i9, "followups.templates.layout-390", "390: the manager opens, each view and the Plain templates group fit the window (no horizontal scroll)",
                       "PASS" if ok9 and len(hs9) == 3 else "FAIL", page_overflow={v: x["page"] for v, x in hs9.items()}, past_edge=past,
                       scope=['[role=dialog][aria-label="Manage templates"]'])
            finally:
                c9.close()
        finally:
            c_.close()

    # ── day pages ────────────────────────────────────────────────────────────────────────────────────────────────────
    def day_pages():
        c_, _e, _me, i_, p_ = new_member("c2fud", "1280")
        listen(c_)
        try:
            # Today draws its Quick actions only for a member with data (TodaySurface.jsx `!zeroData`; a member with none
            # gets the first-edge onboarding instead): one open position, through the member's own route.
            C.api(c_, i_, "POST", base, "/api/j2/positions", {"symbol": "MSFT", "side": "Long", "shares": 5, "entryPrice": 400.0,
                                                               "stopPrice": 380.0, "entryDate": C.TODAY.isoformat()})
            at(p_, base, "/journal")
            qa = p_.locator('[data-testid="qa-daily-brief"]')
            shown = C.vis_loc(qa, 30000)
            if shown:
                qa.first.click(timeout=10000)
            for _ in range(40):
                if "/journal/notebook" in p_.url and "view=today" in p_.url:
                    break
                p_.wait_for_timeout(250)
            on_brief = "/journal/notebook" in p_.url and "view=today" in p_.url
            heading = C.vis_loc(p_.get_by_role("heading", name="Daily brief", exact=True), 15000)
            C.step(p_, i_, "followups.day.journal-quick-action", "Journal Today's Quick actions 'Daily brief' lands on the Daily brief (?view=today)",
                   "PASS" if shown and on_brief and heading else "FAIL", button=shown, url=p_.url.split("://")[-1].split("/", 1)[-1], heading=heading)

            at(p_, base, "/journal/notebook?view=all")
            p_.keyboard.press("Control+k")
            box = p_.get_by_role("dialog", name="Command palette").locator("input").first
            opened = C.vis_loc(box, 10000)
            row_seen = False
            if opened:
                box.fill("daily brief")
                row = p_.get_by_role("dialog", name="Command palette").get_by_text(DAILY_BRIEF, exact=True)
                row_seen = C.vis_loc(row, 10000)
                if row_seen:
                    row.first.click(timeout=10000)
            for _ in range(40):
                if "view=today" in p_.url:
                    break
                p_.wait_for_timeout(250)
            on_brief = "view=today" in p_.url
            heading = C.vis_loc(p_.get_by_role("heading", name="Daily brief", exact=True), 15000)
            C.step(p_, i_, "followups.day.palette", f"the command palette's '{DAILY_BRIEF}' opens the Daily brief",
                   "PASS" if opened and row_seen and on_brief and heading else "FAIL", palette=opened, row=row_seen,
                   url=p_.url.split("://")[-1].split("/", 1)[-1], heading=heading)

            c9, i9, p9 = phone_of(c_)
            listen(c9)
            try:
                at(p9, base, "/journal/notebook?view=all")
                door = p9.get_by_role("button", name=re.compile(r"^Folder: "))
                C.vis_loc(door, 30000)
                door.first.click(timeout=10000)
                panel = p9.locator("#notebook-folders-panel")
                drawer_open = C.vis_loc(panel, 10000)
                row = p9.get_by_role("treeitem", name="Daily brief", exact=True)
                row_on = C.vis_loc(row, 10000)
                if row_on:
                    row.first.click(timeout=10000)
                for _ in range(40):
                    if "view=today" in p9.url:
                        break
                    p9.wait_for_timeout(250)
                p9.wait_for_timeout(1200)
                on_brief = "view=today" in p9.url
                still = panel.count() > 0 and panel.first.is_visible()
                expanded = door.first.get_attribute("aria-expanded") if door.count() else None
                C.step(p9, i9, "followups.day.phone-drawer", "390: choosing Daily brief in the folders drawer opens the brief and closes the drawer",
                       "PASS" if drawer_open and row_on and on_brief and not still else "FAIL", drawer_opened=drawer_open, row=row_on,
                       url=p9.url.split("://")[-1].split("/", 1)[-1], drawer_still_shown=still, door_expanded=expanded)
            finally:
                c9.close()
        finally:
            c_.close()

    # ── held modules ─────────────────────────────────────────────────────────────────────────────────────────────────
    class Held:
        """Hold back every fetch of one lazy chunk (`/assets/<name>-<hash>.js`) until `release()`: the cold case made
        deterministic, so the press happens while the chunk is still on its way (the pattern of discover.note-second-views).
        A sync route handler must not sleep (it blocks the driver), so held requests are kept and continued later."""
        def __init__(self, ctx_, name):
            self.ctx, self.rx, self.routes = ctx_, re.compile(rf"/assets/{name}-[^/.]+\.js"), []
            ctx_.route(self.rx, lambda route: self.routes.append(route))

        def release(self) -> int:
            n = len(self.routes)
            self.ctx.unroute(self.rx)
            for r_ in self.routes:
                try:
                    r_.continue_()
                except Exception:  # noqa: BLE001 -- a request the page gave up on
                    pass
            return n

    def insert_cold(vp):
        def go():
            if vp == "1280":
                c_, _e, _me, i_, p_ = new_member("c2fui", "1280")
            else:
                c0, _e, _me, i0, _p0 = new_member("c2fui9", "1280")
                c_, i_, p_ = phone_of(c0)
                c0.close()
            listen(c_)
            try:
                nid = mk_note(c_, i_, f"Insert walk {vp} {tag}", f"Insert walk words {tag}")
                held = Held(c_, "WidgetPalette")
                C.goto(p_, base, f"/journal/notebook?note={nid}", ".ProseMirror")
                text0 = p_.locator(".ProseMirror").first.inner_text()
                bar = p_.locator('[data-tour="note-toolbar"]').first
                before = bar.evaluate(BOX_JS)
                door = p_.locator('[data-tour="note-toolbar"]').get_by_role("button", name=re.compile(r"^Insert( widget)?$")).filter(visible=True)
                door.first.click(timeout=10000)
                via = "Insert"
                if vp != "1280":
                    row = p_.get_by_role("button", name=PHONE_PALETTE_ROW, exact=True).filter(visible=True)
                    if C.vis_loc(row, 5000):
                        row.first.click(timeout=10000)
                        via = f"+ > {PHONE_PALETTE_ROW}"
                frame = p_.locator("[data-palette-stand-in]")
                frame_on = C.vis_loc(frame, 3000)
                frame_words = (frame.first.text_content() or "").strip() if frame_on else None
                p_.wait_for_timeout(200)
                focus_frame = p_.evaluate(FOCUS_JS)
                close_btn = frame.get_by_role("button", name="Close insert panel").count() if frame_on else 0
                with_frame = bar.evaluate(BOX_JS)
                p_.keyboard.type("NVDA", delay=40)
                p_.wait_for_timeout(1500)          # the chunk is still held: the frame must keep the keys out of the note
                text_held = p_.locator(".ProseMirror").first.inner_text()
                held_n = held.release()
                palette = p_.locator('[role=dialog][aria-label="Insert widget"]:not([data-palette-stand-in])')
                landed = C.vis_loc(palette, 15000)
                p_.wait_for_timeout(600)
                with_palette = bar.evaluate(BOX_JS)
                sym = p_.locator("#uct-palette-sym")
                field = sym.first.input_value() if sym.count() else None
                palette_close = palette.get_by_role("button", name="Close insert panel").count() if landed else 0
                focus_palette = p_.evaluate(FOCUS_JS)
                text1 = p_.locator(".ProseMirror").first.inner_text()
                same_h = abs(before["height"] - with_frame["height"]) < 0.6 and abs(before["height"] - with_palette["height"]) < 0.6
                ok = (frame_on and frame_words == INSERT_LOADING and focus_frame.get("in_dialog") == "Insert widget" and close_btn
                      and same_h and landed and palette_close and held_n >= 1 and text_held == text0 and text1 == text0
                      and (field in ("NVDA", "") or field is None))
                C.step(p_, i_, f"followups.held.insert-cold-{vp}",
                       f"{vp}: Insert ({via}) pressed straight after a page load, its chunk held: the frame in the palette's slot holds focus and a Close, the toolbar keeps its height, NVDA typed at once never reaches the note",
                       "PASS" if ok else "FAIL", via=via, frame=frame_on, frame_words=frame_words, expected_words=INSERT_LOADING,
                       focus_on_frame=focus_frame, close_button=close_btn, toolbar_before=before, toolbar_with_frame=with_frame,
                       toolbar_with_palette=with_palette, chunk_requests_held=held_n, palette_landed=landed, palette_close=palette_close,
                       palette_field=field, focus_after=focus_palette, note_text_while_held=text_held[:200],
                       note_text_unchanged=text1 == text0, note_text_after=text1[:200], scope=['[data-tour="note-toolbar"]'])
                p_.keyboard.press("Escape")
            finally:
                c_.close()
        return go

    def ai_actions():
        c_, _e, me, i_, p_ = new_member("c2fua", "1280")
        listen(c_)
        try:
            mk_note(c_, i_, f"AI walk {tag}", f"AI walk words {tag}")
            held = Held(c_, "AiActionsPanel")
            at(p_, base, "/journal/notebook?view=all")
            ai = p_.get_by_role("button", name="AI", exact=True).filter(visible=True)
            C.vis_loc(ai, 20000)
            ai.first.click(timeout=10000)
            sec = p_.locator(f'section[aria-label="{AI_ACTIONS_LABEL}"]')
            on = C.vis_loc(sec, 15000)
            toggle = sec.get_by_role("button", name=AI_ACTIONS_LABEL).first
            if on:
                toggle.click(timeout=10000)
            p_.wait_for_timeout(800)
            focus_held = p_.evaluate(FOCUS_JS)          # the box is still held: focus is on the frame's status line
            held_n = held.release()
            field = sec.locator("textarea, input[type=text]").first
            landed = C.vis_loc(field, 15000)
            p_.wait_for_timeout(500)
            focus = p_.evaluate(FOCUS_JS)
            in_field = landed and field.evaluate("e => e === document.activeElement")
            C.step(p_, i_, "followups.held.ai-actions", f"the AI section's '{AI_ACTIONS_LABEL}' pressed while its chunk is held opens with focus in its field once it lands",
                   "PASS" if on and landed and in_field and held_n >= 1 and not focus_held.get("in_editor") else "FAIL", section=on, field=landed,
                   focus=focus, focus_while_held=focus_held, chunk_requests_held=held_n,
                   switch_on=me.get("notebook_ai_actions_enabled"))
        finally:
            c_.close()

    def formula_editor():
        c_, _e, _me, i_, p_ = new_member("c2fuf", "1280")
        listen(c_)
        try:
            nid = mk_note(c_, i_, f"Formula editor walk {tag}", f"Formula editor words {tag}")
            held = Held(c_, "FormulaEditor")
            C.goto(p_, base, f"/journal/notebook?note={nid}", ".ProseMirror")
            p_.wait_for_timeout(800)
            det = p_.locator("button[aria-expanded='false']").filter(has_text=re.compile(r"details", re.I))
            if det.count() and det.first.is_visible():
                det.first.click()
                p_.wait_for_timeout(400)
            p_.get_by_role("button", name="Add property").filter(visible=True).first.click(timeout=10000)
            p_.get_by_role("button", name="+ New property…").filter(visible=True).first.click(timeout=10000)
            typ = p_.get_by_role("combobox", name="Property type")
            typ.wait_for(state="visible", timeout=8000)
            typ.select_option(label="Formula")
            p_.wait_for_timeout(800)
            focus_held = p_.evaluate(FOCUS_JS)
            held_n = held.release()
            group = p_.get_by_role("group", name="Start from a trader formula")
            shown = C.vis_loc(group, 15000)
            p_.wait_for_timeout(300)
            focus = p_.evaluate(FOCUS_JS)
            in_form = p_.evaluate("""() => { const a = document.activeElement; const t = document.querySelector('[aria-label="Property type"]');
                return !!a && !!t && !a.closest('.ProseMirror') && !!(t.closest('form') || t.parentElement.parentElement).contains(a) }""")
            C.step(p_, i_, "followups.held.formula-editor", "Add property > Formula (the editor's chunk held, then released): the editor arrives, and focus stays in the property form, never the note",
                   "PASS" if shown and in_form and not focus.get("in_editor") and not focus_held.get("in_editor") else "FAIL", editor=shown, focus=focus,
                   focus_while_held=focus_held, focus_in_form=in_form, chunk_requests_held=held_n)
        finally:
            c_.close()

    # ── bulk: Move to Trash straight after a page load ──────────────────────────────────────────────────────────────
    def bulk():
        c_, _e, _me, i_, p_ = new_member("c2fub", "1280")
        listen(c_)
        try:
            t1, t2 = f"Bulk walk one {tag}", f"Bulk walk two {tag}"
            n1, n2 = mk_note(c_, i_, t1, "one"), mk_note(c_, i_, t2, "two")
            held = Held(c_, "noteBatch")
            C.goto(p_, base, "/journal/notebook?view=all")
            box = p_.get_by_role("checkbox", name=f"Select {t1}")
            C.vis_loc(box, 30000)
            box.first.check(timeout=10000)
            bar = p_.get_by_role("group", name="Actions for the selected notes")   # BulkActionBar.jsx
            bar_on = C.vis_loc(bar, 10000)
            trash = bar.get_by_role("button", name="Move to Trash")
            t0 = time.time()
            trash.first.click(timeout=10000)
            p_.wait_for_timeout(1500)        # the library is held: the press must wait for it, not be dropped
            row_while_held = p_.get_by_role("checkbox", name=f"Select {t1}").count()
            held_n = held.release()
            notice = p_.get_by_test_id("bulk-undo-notice").or_(p_.get_by_test_id("bulk-notice"))
            told = C.vis_loc(notice, 20000)
            ms = round((time.time() - t0) * 1000)
            words = re.sub(r"\s+", " ", notice.first.text_content() or "")[:200] if told else None
            p_.wait_for_timeout(800)
            row_left = p_.get_by_role("checkbox", name=f"Select {t1}").count() == 0
            ids = [n.get("id") for n in C.notes_list(c_, base)]
            other_kept = p_.get_by_role("checkbox", name=f"Select {t2}").count() > 0
            C.step(p_, i_, "followups.bulk.trash-cold", "Move to Trash on a selection straight after a page load (the library held, then released): it completes, the note leaves the list, the other stays",
                   "PASS" if bar_on and told and row_left and n1 not in ids and n2 in ids and other_kept and held_n >= 1 else "FAIL", bar=bar_on, notice=words,
                   chunk_requests_held=held_n, row_still_listed_while_held=row_while_held,
                   ms_press_to_notice=ms, row_left=row_left, note_left_server_list=n1 not in ids, other_kept=other_kept)
        finally:
            c_.close()

    # ── the save label ───────────────────────────────────────────────────────────────────────────────────────────────
    def label():
        c_, _e, _me, i_, p_ = new_member("c2ful", "1280")
        listen(c_)
        try:
            nid = mk_note(c_, i_, f"Label walk {tag}", f"Label walk words {tag}")
            c_.add_init_script(LABEL_RECORDER)
            C.goto(p_, base, f"/journal/notebook?note={nid}", ".ProseMirror")
            for _ in range(60):
                L = p_.evaluate("() => window.__labels || []")
                if L and L[-1] == SAVED_WORDS:
                    break
                p_.wait_for_timeout(250)
            seq_open = [x for x in p_.evaluate("() => window.__labels || []") if x is not None]
            ok_open = bool(seq_open) and seq_open[-1] == SAVED_WORDS and set(seq_open) <= {"", SAVED_WORDS} and seq_open[0] == ""
            C.step(p_, i_, "followups.label.open", f"after a page load on a note the save label reads '' until the device answers, then '{SAVED_WORDS}' (never another word)",
                   "PASS" if ok_open else "FAIL", sequence=seq_open[:20], expected=["", SAVED_WORDS])
            p_.evaluate("() => { window.__labels = [] }")
            ed = p_.locator(".ProseMirror").first
            ed.click()
            p_.keyboard.press("End")
            p_.keyboard.press("Control+End")
            p_.keyboard.type(" more", delay=60)
            saw = None
            for _ in range(80):
                L = p_.evaluate("() => window.__labels || []")
                if SAVING_WORDS in L and L[-1] == SAVED_WORDS:
                    saw = L
                    break
                p_.wait_for_timeout(250)
            seq_type = [x for x in p_.evaluate("() => window.__labels || []") if x is not None]
            order_ok = SAVING_WORDS in seq_type and seq_type[-1] == SAVED_WORDS and seq_type.index(SAVING_WORDS) < len(seq_type) - 1
            C.step(p_, i_, "followups.label.typing", f"typing shows '{SAVING_WORDS}' then '{SAVED_WORDS}'",
                   "PASS" if order_ok and saw else "FAIL", sequence=seq_type[:20])
        finally:
            c_.close()

    # ── usage events ─────────────────────────────────────────────────────────────────────────────────────────────────
    def usage():
        c_, _e, _me, i_, p_ = new_member("c2fuu", "1280")
        listen(c_)
        try:
            mk_note(c_, i_, f"Usage walk note {tag}", "words")
            at(p_, base, "/journal/notebook?view=all")
            p_.wait_for_timeout(1500)

            def events_since(t0):
                out = []
                for e in telemetry:
                    if e["t"] < t0:
                        continue
                    try:
                        out.append(json.loads(e["body"]))
                    except Exception:  # noqa: BLE001
                        out.append({"unreadable": e["body"][:200]})
                return out

            def count(evs, name, **props):
                return sum(1 for e in evs if e.get("event") == name and all((e.get("props") or {}).get(k) == v for k, v in props.items()))

            t0 = time.time()
            vb = p_.locator('[data-tour="view-switcher"]').filter(visible=True)
            C.vis_loc(vb, 20000)
            vb.first.click(timeout=10000)
            p_.get_by_role("menu", name="View").get_by_role("menuitemradio", name=re.compile(r"^Table")).first.click(timeout=10000)
            p_.wait_for_timeout(2500)
            ev = events_since(t0)
            a = {"view_used_table_menu": count(ev, "view_used", mode="table", via="menu"), "view_used_all": count(ev, "view_used"),
                 "menu_row_view_table": count(ev, "menu_row_used", menu="view", row="table"), "menu_row_all": count(ev, "menu_row_used")}
            C.step(p_, i_, "followups.usage.view", "View menu > Table: one view_used {table, menu} and one menu_row_used {view, table}",
                   "PASS" if a["view_used_table_menu"] == 1 and a["view_used_all"] == 1 and a["menu_row_view_table"] == 1 and a["menu_row_all"] == 1 else "FAIL",
                   counts=a, events=ev[:10], shot=False)

            t0 = time.time()
            list_more(p_, "Manage templates")
            C.vis_loc(manager(p_), 20000)
            p_.wait_for_timeout(2000)
            ev = events_since(t0)
            b = {"menu_row_manage": count(ev, "menu_row_used", menu="list_more", row="manage_templates"), "menu_row_all": count(ev, "menu_row_used")}
            C.step(p_, i_, "followups.usage.menu-row", "the list's More > Manage templates: one menu_row_used {list_more, manage_templates}",
                   "PASS" if b["menu_row_manage"] == 1 and b["menu_row_all"] == 1 else "FAIL", counts=b, events=ev[:10], shot=False)
            p_.keyboard.press("Escape")
            p_.wait_for_timeout(800)

            t0 = time.time()
            btn = p_.get_by_role("button", name=TODAY_ROW, exact=True).filter(visible=True)
            C.vis_loc(btn, 15000)
            btn.first.click(timeout=10000)
            try:
                p_.wait_for_url(lambda u: "note=" in u, timeout=30000)
                p_.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            except Exception:  # noqa: BLE001 -- the counts say what happened
                pass
            p_.wait_for_timeout(2500)
            ev = events_since(t0)
            d = {"today_door": count(ev, "today_door_used"), "today_door_list_button": count(ev, "today_door_used", door="list_button")}
            C.step(p_, i_, "followups.usage.today-door", f"the list's '{TODAY_ROW}' opens today's note: one today_door_used {{list_button}}",
                   "PASS" if d["today_door"] == 1 and d["today_door_list_button"] == 1 else "FAIL", counts=d, events=ev[:10], note_opened="note=" in p_.url)
        finally:
            c_.close()

    def privacy():
        """Run last: every telemetry body this step saw, against every note title it made (and the sample's)."""
        sample_titles = list(env["S"].get("sample_titles") or [])
        needles = [t for t in titles + sample_titles if t and len(t) >= 6]
        hits = [{"title": t, "body": e["body"][:200]} for e in telemetry for t in needles if t in e["body"]]
        # The same bodies may not carry ANY free text: every property is a fixed id or a boolean.
        events = []
        for e in telemetry:
            try:
                events.append(json.loads(e["body"]))
            except Exception:  # noqa: BLE001
                events.append({"unreadable": e["body"][:200]})
        names = sorted({str(e.get("event")) for e in events})
        C.step(None, inst, "followups.usage.no-titles", "no POST /api/j2/telemetry body carries a note title (every body this step's windows sent, against every title it made)",
               "PASS" if telemetry and not hits else "FAIL", bodies=len(telemetry), titles_checked=len(needles), hits=hits[:10],
               event_names=names, shot=False)

    checks = (("templates", templates), ("day", day_pages),
              ("held.insert-cold-1280", insert_cold("1280")), ("held.insert-cold-390", insert_cold("390")),
              ("held.ai-actions", ai_actions), ("held.formula-editor", formula_editor),
              ("bulk", bulk), ("label", label), ("usage", usage), ("usage.no-titles", privacy))
    # Development only: FINWALK_FOLLOWUPS_ONLY=bulk,label runs those checks (the coverage row then names the rest).
    pick = {x.strip() for x in os.environ.get("FINWALK_FOLLOWUPS_ONLY", "").split(",") if x.strip()}
    for name, fn in checks:
        if not pick or name in pick:
            guarded(name, fn)
    want = {"followups.templates.door", "followups.templates.views", "followups.templates.archive-used", "followups.templates.restore-archived",
            "followups.templates.delete-undo", "followups.templates.recently-deleted", "followups.templates.plain-saved",
            "followups.templates.plain-rename", "followups.templates.daily", "followups.templates.sheet-manage", "followups.templates.plain-use",
            "followups.templates.plain-delete", "followups.templates.my-tools", "followups.templates.url-archived",
            "followups.templates.layout-1280", "followups.templates.layout-390", "followups.day.journal-quick-action", "followups.day.palette",
            "followups.day.phone-drawer", "followups.held.insert-cold-1280", "followups.held.insert-cold-390", "followups.held.ai-actions",
            "followups.held.formula-editor", "followups.bulk.trash-cold", "followups.label.open", "followups.label.typing",
            "followups.usage.view", "followups.usage.menu-row", "followups.usage.today-door", "followups.usage.no-titles"}
    seen = {s.get("feature") for s in C.REC["steps"] if s.get("config") == cfg}
    missing = sorted(want - seen)
    C.step(None, inst, "followups.coverage", f"every one of the {len(want)} follow-up rows left a row in the record",
           "PASS" if not missing else "FAIL", missing=missing, shot=False)


if __name__ == "__main__":
    print("Run through tools/notebook_fin_walk.py --config c2 (step `followups`); this module is never run directly.")
