"""verify-1009 -- the Notebook features fin-walk listed as "asked for and not walked" (sections 2 F3,
5 and 8.4 K6/K1 of docs/notebook/fin-walk.md), walked in a real browser against a LOCAL SANDBOX.

Called by tools/notebook_fin_walk.py (`--config verify`), which owns the boot through
scripts/hub_sandbox_boot.py, the recorder, the integrity checkpoints and the port (8143). The
verify config arms the same switches as `keyedai` and lets the two model keys through; the keys
reach the sandbox only through the key helper, and this file never reads, prints or stores one.

    python <scratch>/fin/with_model_keys.py -- python tools/notebook_fin_walk.py --config verify \
        --tip <sha> --data-root C:/data-verify-sbx --port 8143 --out docs/notebook/evidence/verify-1009/sbx

Steps (ORDER), each at 1280x800 and 390x844 touch unless the step says otherwise:
  bulk      bulk trash from the notes list (no confirm by design: Move to Trash, then an Undo notice)
  folder    folder delete: the confirm's Delete button is the top element at its centre, and the folder goes
  views     saved-view delete from the notes list, from Research Home, and beside an open note
  restore   version restore: History > Restore this version > Restore
  gallery   gallery unpublish: share a template, the sandbox admin approves it, the member unpublishes it
  chartplan the sample's AAPL chart plan: role buttons pressed and Arm alert, with what was stored and said
  publish   a note with bold, italic, a heading, a list, a link, a table and a task list, published; the
            public page read signed-out
  thesis    the thesis chip sheet on touch (390 only): open, read, close; open again and follow it
  docask    Ask from a Word document's own preview sheet, reached the way a member reaches it (MODEL)
  drag      a chart block dragged with the mouse (1280 only), every mouse path tried, stored order after each
  longask   the 1,878-character PLTR note, Research Home Ask, twice at 1280 and twice at 390 (MODEL)

VERIFY_NO_MODEL=1 stops the two model steps just before the question is sent (development only).
A step that could not be driven is NOT_RUN with its reason. This driver never imports api.* in its own
process (the one seeding child does, in its own process, under the launcher's sandbox env).
Never run on import.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import traceback
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
for _p in (REPO / "tools", REPO / "scripts"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import notebook_perf_harness as h  # noqa: E402
import notebook_fin_walk_keyed as K  # noqa: E402  -- NOTE_A/B, doc_of, make_docx, unsupported
import notebook_fin_walk_keyed_ai as KA  # noqa: E402  -- LONG_PARAS, Q_LONG (the earlier walk's own text)
import notebook_fin_walk_features as F  # noqa: E402  -- toolbar_button (scrolls an embed toolbar clear of the header)

ORDER = ["bulk", "folder", "views", "restore", "gallery", "chartplan", "publish", "thesis", "docask", "drag", "longask"]
VPS = ("1280", "390")
PW = "LocalTest2026!"
NO_MODEL = os.environ.get("VERIFY_NO_MODEL") == "1"

# The confirm button, read at its own centre: is it the element a finger or a pointer lands on there?
TOP_JS = r"""(b) => { const r = b.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const e = document.elementFromPoint(x, y);
  const d = (n) => n ? (n.tagName + '.' + String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : (n.className || '')).slice(0, 50)
                        + (n.getAttribute('aria-label') ? '[' + n.getAttribute('aria-label') + ']' : '')) : null;
  const fabs = [...document.querySelectorAll('[aria-label="Tap to start a conversation"],[data-testid="hub-root"],[aria-label="Show joystick"],[aria-label="Log a trade"]')]
    .filter(f => { const q = f.getBoundingClientRect(); return q.width > 0 && q.height > 0 && !f.hidden })
    .map(f => { const q = f.getBoundingClientRect(); return { label: f.getAttribute('aria-label') || f.getAttribute('data-testid'),
               box: [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)],
               overlaps_button: !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom) } });
  return { on_top: !!e && (e === b || b.contains(e)), in_viewport: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight,
           x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height), text: (b.innerText || '').trim().slice(0, 40),
           covered_by: e && !(e === b || b.contains(e)) ? d(e) : null, floating_buttons: fabs } }"""

PROJECT_CHILD = r'''
import json, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo); sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services import auth_db
from api.services.journal_two import note_levels as nl
conn = auth_db.get_connection()
uid = conn.execute("SELECT id FROM users WHERE email = ?", (spec["email"],)).fetchone()["id"]
nl.ensure_schema(conn)
done = 0
for nid in spec["note_ids"]:
    row = conn.execute("SELECT id, ticker, body_json, properties_json, updated_at FROM j2_notes WHERE id = ? AND user_id = ?", (nid, uid)).fetchone()
    if row is not None:
        nl.project_note(conn, uid, row); done += 1
conn.commit()
levels = [dict(r) for r in conn.execute("SELECT note_id, level_id, role, price FROM j2_note_levels WHERE user_id = ?", (uid,))]
conn.close()
print("PROJECTED " + json.dumps({"projected": done, "levels": levels}, default=str))
'''


def run(C, browser, admin, base, fs, data_dir, only) -> None:
    S = C.STATE
    cfg = "verify"
    steps = [s for s in ORDER if (not only or s in only)]
    a_inst = C.Inst(admin, cfg, "1280")

    def enter(key, tag, vp):
        """A paid member, made once and re-entered on a later --attach."""
        if S.get(key):
            ctx_ = C.new_ctx(browser, vp)
            ctx_.request.post(base + "/api/auth/login", data={"email": S[key], "password": PW})
            if not ctx_.request.get(base + "/api/auth/me").json().get("paid_equiv"):
                raise h.SetupFailed(f"could not re-enter {S[key]}")
            return ctx_
        ctx_, email, _me = C.member(browser, admin.request, base, tag, vp)
        S[key] = email
        C.flush()
        return ctx_

    def guard(name, vp, pg_, inst_, fn):
        try:
            fn()
        except h.SetupFailed:
            raise
        except Exception as e:  # noqa: BLE001 -- recorded; the walk goes on
            C.step(pg_, inst_, name, f"driver exception at {vp} (the step did not finish)", "FAIL",
                   error=f"{type(e).__name__}: {str(e)[:700]}", traceback=traceback.format_exc()[-1800:])

    def press(loc, touch):
        (loc.tap if touch else loc.click)(timeout=15000)

    def top(loc):
        loc.scroll_into_view_if_needed(timeout=10000)
        return loc.evaluate(TOP_JS)

    def note_json(req, nid):
        r = req.get(f"{base}/api/j2/notes/{nid}")
        return (r.json().get("note") or {}) if r.status == 200 else {"_status": r.status}

    def mk(ctx_, inst_, title, body, ticker=None, key=None):
        if key and S.get(key):
            return S[key]
        data = {"title": title, "bodyJson": body}
        if ticker:
            data["ticker"] = ticker
        st, b_ = C.api(ctx_, inst_, "POST", base, "/api/j2/notes", data)
        nid = b_["note"]["id"]
        if key:
            S[key] = nid
        return nid

    def list_ids(req):
        return {n.get("id") for n in ((req.get(base + "/api/j2/notes?limit=500").json() or {}).get("notes") or [])}

    def goto(pg_, path, wait=None):
        C.goto(pg_, base, path, wait)
        C.settle_first_run(pg_)
        for name_ in ("Got it", "Dismiss tip"):   # first-run cards a member closes once
            b_ = pg_.get_by_role("button", name=name_, exact=True)
            try:
                if b_.count() and b_.first.is_visible():
                    b_.first.click(timeout=3000)
                    pg_.wait_for_timeout(250)
            except Exception:  # noqa: BLE001
                pass

    def dialog_confirm(pg_, title_re, button):
        dlg = pg_.locator('[role="dialog"][aria-modal="true"]').filter(has_text=title_re).last
        dlg.wait_for(state="visible", timeout=15000)
        return dlg, dlg.get_by_role("button", name=button, exact=True)

    # ══ 1. confirm buttons ════════════════════════════════════════════════════════════════════
    def bulk(pg_, inst_, ctx_, vp, touch, edge=False):
        """`edge`: the member's ONLY notes are the two trashed, so the notebook becomes empty (the
        first-run tour's auto-start condition, NotebookTour.jsx). Otherwise a third note is kept."""
        M = ctx_.request
        if not edge:
            mk(ctx_, inst_, f"Keeper {vp}", K.doc_of(["This note stays, so the notebook is never empty."]), key=f"keeper_{vp}")
        tag = "1 bulk trash" + (" (all of the member's notes)" if edge else "")
        ids = [mk(ctx_, inst_, f"Bulk {w} {vp}", K.doc_of([f"Bulk trash walk, note {w}."]), key=f"bulk_{w}_{vp}{'_edge' if edge else ''}") for w in ("one", "two")]
        goto(pg_, "/journal/notebook?view=all")
        for w in ("one", "two"):
            cb = pg_.get_by_role("checkbox", name=f"Select Bulk {w} {vp}", exact=True).filter(visible=True).first
            cb.wait_for(state="visible", timeout=20000)
            press(cb, touch)
            pg_.wait_for_timeout(300)
        bar = pg_.get_by_role("group", name="Actions for the selected notes")
        bar_text = bar.first.inner_text()[:200] if bar.count() else None
        btn = pg_.get_by_role("button", name="Move to Trash", exact=True).filter(visible=True).first
        t = top(btn)
        C.step(pg_, inst_, tag, f"{vp}: Move to Trash is the top element at its centre", "PASS" if t["on_top"] and t["in_viewport"] else "FAIL",
               button=t, bar_text=bar_text)
        press(btn, touch)
        pg_.wait_for_timeout(1200)
        dialogs = pg_.locator('[role="dialog"][aria-modal="true"]').filter(visible=True).count()
        undo = pg_.get_by_role("button", name="Undo", exact=True).filter(visible=True)
        t_undo = top(undo.first) if undo.count() else None
        notice = pg_.locator('[data-testid="bulk-undo-notice"]').first.inner_text()[:200] if pg_.locator('[data-testid="bulk-undo-notice"]').count() else None
        gone = False
        for _ in range(25):
            if not (set(ids) & list_ids(M)):
                gone = True
                break
            pg_.wait_for_timeout(400)
        after = {i: {k: note_json(M, i).get(k) for k in ("deletedAt", "trashedAt", "_status")} for i in ids}
        modal = [x[:160] for x in pg_.locator('[role="dialog"][aria-modal="true"]').filter(visible=True).all_inner_texts()]
        C.step(pg_, inst_, tag, f"{vp}: both notes leave the list (no confirm dialog by design; an Undo notice instead), and Undo is the top element at its centre",
               "PASS" if gone and t_undo and t_undo["on_top"] else "FAIL", modal_dialogs_open_after_trash=modal, notice=notice, undo_button=t_undo,
               notes_left_the_list=gone, stored_after=after, notebook_left_empty=edge)
        skip = pg_.get_by_role("button", name="Skip tour", exact=True).filter(visible=True)
        if skip.count():   # a member closes the tour; then the Undo notice, if it is still there, is measured again
            press(skip.first, touch)
            pg_.wait_for_timeout(600)
            undo2 = pg_.get_by_role("button", name="Undo", exact=True).filter(visible=True)
            C.step(pg_, inst_, tag, f"{vp}: after Skip tour, the Undo notice", "INFO", undo_button=top(undo2.first) if undo2.count() else None,
                   undo_notice_still_shown=undo2.count())

    def folder(pg_, inst_, ctx_, vp, touch):
        M = ctx_.request
        name = f"Verify folder {vp}"
        if not S.get(f"folder_{vp}"):
            st, b_ = C.api(ctx_, inst_, "POST", base, "/api/j2/note-folders", {"name": name})
            S[f"folder_{vp}"] = (b_.get("folder") or b_).get("id")
        fid = S[f"folder_{vp}"]
        goto(pg_, "/journal/notebook?view=all")
        row = pg_.get_by_role("treeitem", name=name).first
        row.wait_for(state="visible", timeout=20000)
        if not touch:
            row.hover()
        d = pg_.locator(f'button[title="Delete folder"][aria-label="Delete {name}"]').first
        press(d, touch)
        dlg, ok = dialog_confirm(pg_, re.compile(r"Delete folder"), "Delete")
        t = top(ok)
        dtext = dlg.inner_text()[:300]
        C.step(pg_, inst_, "1 folder delete", f"{vp}: the confirm's Delete is the top element at its centre", "PASS" if t["on_top"] and t["in_viewport"] else "FAIL",
               button=t, dialog_text=dtext)
        press(ok, touch)
        gone = False
        for _ in range(25):
            fl = M.get(base + "/api/j2/note-folders").json()
            fl = fl.get("folders") if isinstance(fl, dict) else fl
            if not any(f.get("id") == fid for f in (fl or [])):
                gone = True
                break
            pg_.wait_for_timeout(400)
        C.step(pg_, inst_, "1 folder delete", f"{vp}: the folder is deleted", "PASS" if gone else "FAIL", folder=fid, deleted=gone,
               dialog_still_open=pg_.locator('[role="dialog"][aria-modal="true"]').filter(has_text="Delete folder").count())

    def views(pg_, inst_, ctx_, vp, touch):
        M = ctx_.request
        host = mk(ctx_, inst_, f"View host {vp}", K.doc_of(["A note to have open beside the saved views."]), key=f"viewhost_{vp}")
        places = [("notes list", "/journal/notebook?view=all"), ("Research Home", "/journal/notebook"), ("beside an open note", f"/journal/notebook?note={host}")]
        for place, path in places:
            name = f"Verify view {place.split()[0]} {vp}"
            if not S.get(f"view_{place}_{vp}"):
                st, b_ = C.api(ctx_, inst_, "POST", base, "/api/j2/saved-views", {"name": name, "viewType": "list", "spec": {}})
                S[f"view_{place}_{vp}"] = (b_.get("savedView") or {}).get("id")
            vid = S[f"view_{place}_{vp}"]
            goto(pg_, path, ".ProseMirror" if "note=" in path else None)
            pg_.wait_for_timeout(1500)
            d = pg_.locator(f'button[title="Delete view"][aria-label="Delete {name}"]')
            shown = d.filter(visible=True).count()
            opened_panel = None
            if not shown:
                for door in ("Show folders panel", "Show folders"):
                    b_ = pg_.get_by_role("button", name=door, exact=True).filter(visible=True)
                    if b_.count():
                        press(b_.first, touch)
                        pg_.wait_for_timeout(800)
                        opened_panel = door
                        shown = d.filter(visible=True).count()
                        if shown:
                            break
            if not shown:
                C.step(pg_, inst_, "1 saved view delete", f"{vp}, {place}: no Delete control for the saved view on this page", "NOT_RUN",
                       reason=("no visible 'Delete <view>' control here (see screenshot); the saved views live in the folders panel, which"
                               " NotebookTab.module.css hides at <=640 px while a note is open (.wrap[data-note-open] .sidebarSlot)"),
                       tried_door=opened_panel, sidebar_present=pg_.locator('[aria-label="Saved Views"], h2:has-text("Saved Views"), h3:has-text("Saved Views")').count(),
                       view=vid, landed=pg_.url.split(base)[-1])
                continue
            row = pg_.locator(f'button[title="{name}"]').filter(visible=True)
            if not touch and row.count():
                row.first.hover()
            press(d.filter(visible=True).first, touch)
            dlg, ok = dialog_confirm(pg_, re.compile(r"Delete view"), "Delete")
            t = top(ok)
            dtext = dlg.inner_text()[:300]
            C.step(pg_, inst_, "1 saved view delete", f"{vp}, {place}: the confirm's Delete is the top element at its centre",
                   "PASS" if t["on_top"] and t["in_viewport"] else "FAIL", button=t, dialog_text=dtext, landed=pg_.url.split(base)[-1], opened_panel=opened_panel)
            press(ok, touch)
            gone = False
            for _ in range(25):
                vs = M.get(base + "/api/j2/saved-views").json()
                vs = vs.get("savedViews") if isinstance(vs, dict) else vs
                if not any(v.get("id") == vid for v in (vs or [])):
                    gone = True
                    break
                pg_.wait_for_timeout(400)
            C.step(pg_, inst_, "1 saved view delete", f"{vp}, {place}: the saved view is deleted", "PASS" if gone else "FAIL", view=vid, deleted=gone,
                   landed_after=pg_.url.split(base)[-1])

    def restore(pg_, inst_, ctx_, vp, touch):
        M = ctx_.request
        v1, v2 = f"Version one text {vp}.", f"Version two text {vp}."
        nid = S.get(f"restore_{vp}")
        if not nid:
            nid = mk(ctx_, inst_, f"Restore me {vp}", K.doc_of([v1]), key=f"restore_{vp}")
            n = note_json(M, nid)
            C.api(ctx_, inst_, "PUT", base, f"/api/j2/notes/{nid}", {"bodyJson": K.doc_of([v2]), "baseUpdatedAt": n.get("updatedAt")})
        vers = (M.get(f"{base}/api/j2/notes/{nid}/versions").json().get("versions") or [])
        goto(pg_, f"/journal/notebook?note={nid}", ".ProseMirror")
        pg_.wait_for_timeout(1200)
        press(pg_.get_by_role("button", name="More note actions").filter(visible=True).first, touch)
        pg_.wait_for_timeout(500)
        press(pg_.get_by_role("button", name="Version history").filter(visible=True).first, touch)
        rb = pg_.get_by_role("button", name="Restore this version", exact=True)
        rb.first.wait_for(state="visible", timeout=20000)
        pg_.wait_for_timeout(800)
        press(rb.first, touch)
        dlg, ok = dialog_confirm(pg_, re.compile(r"Restore this version\?"), "Restore")
        t = top(ok)
        dtext = dlg.inner_text()[:300]
        C.step(pg_, inst_, "1 version restore", f"{vp}: the confirm's Restore is the top element at its centre", "PASS" if t["on_top"] and t["in_viewport"] else "FAIL",
               button=t, dialog_text=dtext, versions_listed_by_server=len(vers))
        press(ok, touch)
        back = False
        for _ in range(25):
            if v1 in json.dumps(note_json(M, nid).get("bodyJson") or {}):
                back = True
                break
            pg_.wait_for_timeout(400)
        status = pg_.locator('[role="status"]').filter(has_text="Restored").first.inner_text()[:200] if pg_.locator('[role="status"]').filter(has_text="Restored").count() else None
        C.step(pg_, inst_, "1 version restore", f"{vp}: the note holds the earlier version's words again", "PASS" if back else "FAIL", note=nid,
               restored=back, said=status, editor_text=pg_.locator(".ProseMirror").first.inner_text()[:160])

    def gallery(pg_, inst_, ctx_, vp, touch):
        M = ctx_.request
        title = f"Verify gallery {vp}"
        if not S.get(f"gal_{vp}"):
            src = mk(ctx_, inst_, f"Template source {vp}", K.doc_of(["Setup:", "Entry:", "Stop:"]), key=f"galsrc_{vp}")
            st, tb = C.api(ctx_, inst_, "POST", base, "/api/j2/note-templates", {"noteId": src, "name": f"Verify template {vp}"})
            tid = (tb.get("template") or {}).get("id")
            st2, gb = C.api(ctx_, inst_, "POST", base, "/api/j2/template-gallery", {"templateId": tid, "title": title, "description": "A walk template.", "category": "journal"})
            gid = (gb.get("template") or gb.get("item") or gb).get("id")
            qs, q = C.api(admin, a_inst, "GET", base, "/api/j2/template-gallery/admin/queue")
            items = q.get("templates") or q.get("items") or q.get("queue") or [] if isinstance(q, dict) else q
            row = next((x for x in items if x.get("id") == gid), {})
            ap, apb = C.api(admin, a_inst, "PATCH", base, f"/api/j2/template-gallery/admin/items/{gid}",
                            {"action": "approve", "note": "", "reviewedUpdatedAt": row.get("updatedAt")})
            S[f"gal_{vp}"] = gid
            S[f"gal_setup_{vp}"] = {"template": st, "submit": st2, "approve": ap, "approved_state": (apb.get("template") or {}).get("status") if isinstance(apb, dict) else None}
        gid = S[f"gal_{vp}"]
        goto(pg_, "/journal/notebook?view=all")
        press(pg_.get_by_role("button", name="Templates", exact=True).filter(visible=True).first, touch)
        door = pg_.get_by_role("button", name="Browse the community gallery")
        door.first.wait_for(state="visible", timeout=20000)
        press(door.first, touch)
        mine = pg_.get_by_role("button", name="Your submissions", exact=True)
        mine.first.wait_for(state="visible", timeout=20000)
        press(mine.first, touch)
        un = pg_.get_by_role("button", name=f"Unpublish {title}", exact=True)
        un.first.wait_for(state="visible", timeout=20000)
        press(un.first, touch)
        grp = pg_.get_by_role("group", name=f"Unpublish {title}?")
        grp.first.wait_for(state="visible", timeout=10000)
        ok = grp.first.get_by_role("button", name="Unpublish", exact=True)
        t = top(ok)
        C.step(pg_, inst_, "1 gallery unpublish", f"{vp}: the inline confirm's Unpublish is the top element at its centre", "PASS" if t["on_top"] and t["in_viewport"] else "FAIL",
               button=t, confirm_text=grp.first.inner_text()[:200], setup=S.get(f"gal_setup_{vp}"), scope=["[role=dialog]"])
        press(ok, touch)
        pg_.wait_for_timeout(1500)
        said = pg_.get_by_text(re.compile(r"^Unpublished")).first.inner_text()[:200] if pg_.get_by_text(re.compile(r"^Unpublished")).count() else None
        mine_now = M.get(base + "/api/j2/template-gallery?section=mine").json().get("templates") or []
        listed = [x.get("id") for x in (M.get(base + "/api/j2/template-gallery").json().get("templates") or [])]
        rowm = next((x for x in mine_now if x.get("id") == gid), None)
        C.step(pg_, inst_, "1 gallery unpublish", f"{vp}: the template leaves the community gallery", "PASS" if gid not in listed and (rowm is None or rowm.get("status") != "approved") else "FAIL",
               said=said, still_listed_in_gallery=gid in listed, my_submission_after=rowm, scope=["[role=dialog]"])

    # ══ 2. the sample chart plan ══════════════════════════════════════════════════════════════
    def chartplan(pg_, inst_, ctx_, vp, touch):
        M = ctx_.request
        if not S.get(f"sample_{vp}"):
            st, b_ = C.api(ctx_, inst_, "POST", base, "/api/j2/onboarding/sample-notebook", {})
            S[f"sample_{vp}"] = st
        notes = M.get(base + "/api/j2/notes?limit=500").json().get("notes") or []
        n = next((x for x in notes if x.get("title") == "Trade plan: example -- AAPL pullback"), None)
        if not n:
            C.step(None, inst_, "2 sample chart plan", f"{vp}: the sample's AAPL plan note", "NOT_RUN", reason="the sample has no AAPL plan note",
                   titles=[x.get("title") for x in notes], shot=False)
            return
        nid = n["id"]

        def ann():
            e = F.h2.embeds(note_json(M, nid).get("bodyJson") or {})
            return [{"id": d.get("id"), "role": d.get("role"), "price": ((d.get("points") or [{}])[0]).get("price")} for d in (e[0].get("annotations") or [])] if e else None
        before = ann()
        goto(pg_, f"/journal/notebook?note={nid}", ".ProseMirror")
        frame = F.h2.frame_of(pg_, 0)
        frame.wait_for(state="visible", timeout=40000)
        pg_.wait_for_timeout(2500)
        show = frame.get_by_role("button", name="Show toolbar", exact=True)
        if show.count() and show.first.is_visible():
            press(show.first, touch)
            pg_.wait_for_timeout(400)
        embed_buttons = frame.evaluate("e => [...e.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 30))")
        try:
            plan_btn = F.toolbar_button(pg_, frame, "Plan", touch)
        except Exception as e:  # noqa: BLE001
            C.step(pg_, inst_, "2 sample chart plan", f"{vp}: open the plan panel from the sample chart", "FAIL", reach_error=str(e)[:300],
                   embed_buttons=embed_buttons, annotations=before)
            return
        press(plan_btn, touch)
        panel = pg_.locator("[data-chart-plan-panel]").first
        panel.wait_for(state="visible", timeout=30000)
        rows = panel.locator("li[data-level-id]")
        rows.first.wait_for(state="visible", timeout=20000)
        seen_rows = [{"id": rows.nth(i).get_attribute("data-level-id"), "role": rows.nth(i).get_attribute("data-level-role")} for i in range(rows.count())]
        C.step(pg_, inst_, "2 sample chart plan", f"{vp}: the plan panel opens on the sample chart", "PASS" if len(seen_rows) >= 3 else "FAIL",
               rows=seen_rows, stored_annotations=before, panel_text=panel.inner_text()[:500], scope=["[data-chart-plan-panel]"])
        # press the role buttons: the entry line becomes Target, then Entry again; record what is stored after each press
        presses = []
        erow = panel.locator('li[data-level-role="entry"]').first
        eid = erow.get_attribute("data-level-id")
        for role in ("target", "none", "entry"):
            r_ = panel.locator(f'li[data-level-id="{eid}"]').first
            b_ = r_.locator(f'[data-role="{role}"]').first
            press(b_, touch)
            stored, ok = F.h2.wait_stored(M, base, nid, lambda e, role=role: any(d.get("id") == eid and (d.get("role") or "none") == role for d in (e[0].get("annotations") or [])), timeout_s=25)
            presses.append({"pressed": role, "aria_checked_after": r_.locator(f'[data-role="{role}"]').first.get_attribute("aria-checked"),
                            "stored_role": next(((d.get("role") or "none") for d in (stored[0].get("annotations") or []) if d.get("id") == eid), None) if stored else None,
                            "stored_in_time": ok})
        C.step(pg_, inst_, "2 sample chart plan", f"{vp}: the role buttons on the entry line (Target, None, Entry): each press is stored",
               "PASS" if all(p["stored_in_time"] for p in presses) else "FAIL", line=eid, presses=presses, panel_text=panel.inner_text()[:400],
               scope=["[data-chart-plan-panel]"])
        srow = panel.locator('li[data-level-role="stop"]').first
        sid = srow.get_attribute("data-level-id")
        arm = srow.get_by_role("button", name=re.compile(r"^Arm alert at this level"))
        if not arm.count():
            C.step(pg_, inst_, "2 sample chart plan", f"{vp}: Arm alert on the stop", "FAIL", reason="no Arm alert button on the stop row", row_text=srow.inner_text()[:300])
            return
        t = top(arm.first)
        press(arm.first, touch)
        armed = C.vis_loc(srow.get_by_text("Alert armed"), 30000)
        pg_.wait_for_timeout(800)
        said = [x.strip() for x in panel.locator('[role="status"]').all_inner_texts() if x.strip()]
        alerts = M.get(base + "/api/watchlist-alerts").json()
        hits = [a for a in (alerts if isinstance(alerts, list) else (alerts.get("alerts") or [])) if str(a.get("drawing_id") or "").endswith(f":{sid}")]
        C.step(pg_, inst_, "2 sample chart plan", f"{vp}: Arm alert at the stop: what the server stored and what the screen said",
               "PASS" if armed and hits and hits[0].get("sym") == "AAPL" else "FAIL", arm_button=t, alert_armed_shown=armed, panel_said=said,
               server_alerts=[{k: a.get(k) for k in ("sym", "direction", "target_price", "drawing_id", "is_active")} for a in hits],
               row_text=srow.inner_text()[:300], scope=["[data-chart-plan-panel]"])

    # ══ 3. the published-note page ═══════════════════════════════════════════════════════════
    def rich_doc(vp):
        tx = lambda t, *m: {"type": "text", "text": t, **({"marks": list(m)} if m else {})}  # noqa: E731
        p = lambda *c: {"type": "paragraph", "content": list(c)}  # noqa: E731
        cell = lambda kind, t: {"type": kind, "content": [p(tx(t))]}  # noqa: E731
        return {"type": "doc", "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [tx(f"Publish heading {vp}")]},
            p(tx("Plain words, "), tx("bold words", {"type": "bold"}), tx(", "), tx("italic words", {"type": "italic"}), tx(" and "),
              tx("an example link", {"type": "link", "attrs": {"href": "https://example.com/verify"}}), tx(".")),
            {"type": "bulletList", "content": [{"type": "listItem", "content": [p(tx("List item one"))]}, {"type": "listItem", "content": [p(tx("List item two"))]}]},
            {"type": "table", "content": [{"type": "tableRow", "content": [cell("tableHeader", "Head A"), cell("tableHeader", "Head B")]},
                                          {"type": "tableRow", "content": [cell("tableCell", "Cell A1"), cell("tableCell", "Cell B1")]}]},
            {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": True}, "content": [p(tx("Task done"))]},
                                             {"type": "taskItem", "attrs": {"checked": False}, "content": [p(tx("Task open"))]}]},
        ]}

    PUB_JS = r"""() => { const root = document.querySelector('main') || document.body; const q = (s) => [...root.querySelectorAll(s)];
      return { headings: q('h1,h2,h3,h4').map(e => e.tagName + ':' + e.textContent.trim().slice(0, 60)),
               bold: q('strong,b').map(e => e.textContent.trim()), italic: q('em,i').map(e => e.textContent.trim()).filter(Boolean),
               links: q('a[href]').filter(a => /example\.com/.test(a.href)).map(a => [a.textContent.trim(), a.href, a.getAttribute('target'), a.getAttribute('rel')]),
               list_items: q('ul li').map(e => e.textContent.trim().slice(0, 40)), tables: q('table').length,
               cells: q('th,td').map(e => e.tagName + ':' + e.textContent.trim()),
               task_items: q('li[data-type="taskItem"], li[data-checked], ul[data-type="taskList"] li').map(e => [e.textContent.trim().slice(0, 40), e.getAttribute('data-checked')]),
               checkboxes: q('input[type=checkbox]').map(e => [e.checked, e.disabled]),
               text: root.innerText.replace(/\s+/g, ' ').slice(0, 900) } }"""

    def publish(pg_, inst_, ctx_, vp, touch):
        M = ctx_.request
        nid = mk(ctx_, inst_, f"Published walk {vp}", rich_doc(vp), key=f"pub_{vp}")
        stored = note_json(M, nid).get("bodyJson") or {}
        kinds = sorted({n_.get("type") for n_ in json.loads(json.dumps(stored), object_hook=lambda d: d).get("content", [])} if stored else set())
        goto(pg_, f"/journal/notebook?note={nid}", ".ProseMirror")
        pg_.wait_for_timeout(1500)
        editor = pg_.evaluate(PUB_JS.replace("document.querySelector('main') || document.body", "document.querySelector('.ProseMirror')"))
        share = pg_.locator('[data-tour="note-share"]').filter(visible=True)
        press(share.first, touch)
        dlg = pg_.get_by_role("dialog", name="Share this note")
        dlg.first.wait_for(state="visible", timeout=15000)
        addr = dlg.first.get_by_role("textbox", name="Published page address")
        if not addr.count():
            press(dlg.first.get_by_role("button", name="Publish this note", exact=True), touch)
            addr.first.wait_for(state="visible", timeout=20000)
        url = addr.first.input_value()
        said = [x.strip() for x in dlg.first.locator('[role="status"]').all_inner_texts() if x.strip()]
        C.step(pg_, inst_, "3 published page", f"{vp}: Share > Publish this note gives a page address", "PASS" if "/p/" in url else "FAIL",
               address=url, said=said, stored_top_level_nodes=kinds, editor_rendering=editor, scope=["[role=dialog]"])
        if "/p/" not in url:
            return
        out = C.new_ctx(browser, vp)
        oi = C.Inst(out, cfg, vp)
        op = out.new_page()
        try:
            path = url.split("://", 1)[-1].split("/", 1)[-1]
            op.goto(base + "/" + path, wait_until="domcontentloaded", timeout=60000)
            try:
                op.get_by_text(f"Publish heading {vp}").first.wait_for(state="visible", timeout=30000)
            except Exception:  # noqa: BLE001
                pass
            op.wait_for_timeout(1500)
            me = out.request.get(base + "/api/auth/me").status
            got = op.evaluate(PUB_JS)
            slug = path.split("p/", 1)[-1].split("/")[0]
            api_body = out.request.get(f"{base}/api/j2/published/{slug}")
            api_json = api_body.json() if api_body.status == 200 else {"status": api_body.status}
            survives = {
                "bold": "bold words" in got["bold"], "italic": "italic words" in got["italic"],
                "heading": any(f"Publish heading {vp}" in x for x in got["headings"]),
                "bullet list": any("List item one" in x for x in got["list_items"]),
                "link": bool(got["links"]), "table": got["tables"] >= 1 and any("Cell B1" in c for c in got["cells"]),
                "task list": len(got["task_items"]) >= 2 or len(got["checkboxes"]) >= 2,
            }
            C.step(op, oi, "3 published page", f"{vp}: the public page, signed out: which formatting survives",
                   "PASS" if all(survives.values()) else "FAIL", signed_out_me_status=me, survives=survives, rendered=got,
                   public_payload_nodes=sorted({n_.get("type") for n_ in ((api_json.get("note") or api_json).get("bodyJson") or api_json.get("body") or {}).get("content", [])}) if isinstance(api_json, dict) else None,
                   public_payload=json.dumps(api_json)[:2500])
        finally:
            out.close()

    # ══ 4. the thesis chip sheet on touch ═══════════════════════════════════════════════════
    def thesis(pg_, inst_, ctx_, vp, touch, email_key):
        M = ctx_.request
        x = C.x13
        if not S.get(f"thesis_{vp}"):
            nid = mk(ctx_, inst_, f"IBM thesis {vp}", x.doc_with(x.para("Long IBM into the mainframe cycle."),
                     x.chart_block("IBM", [x.level("entry", 200.0, "t-entry"), x.level("stop", 190.0, "t-stop"), x.level("target", 230.0, "t-target")], f"e-th-{vp}")), ticker="IBM")
            n = note_json(M, nid)
            C.api(ctx_, inst_, "PUT", base, f"/api/j2/notes/{nid}", {"properties": {"builtin:thesis_status": "active"}, "baseUpdatedAt": n.get("updatedAt")})
            ps, pb = C.api(ctx_, inst_, "POST", base, "/api/j2/positions", {"symbol": "IBM", "side": "Long", "shares": 10, "entryPrice": 201.0,
                                                                         "stopPrice": 190.0, "entryDate": C.TODAY.isoformat()})
            env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
            r = subprocess.run([sys.executable, "-c", PROJECT_CHILD, str(REPO), str(data_dir), json.dumps({"email": S[email_key], "note_ids": [nid]})],
                               cwd=str(REPO), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
            (C.OUT / f"project-child-{vp}.log").write_text(newline=chr(10), data=(r.stdout or "")[-3000:] + "\n--- stderr ---\n" + (r.stderr or "")[-5000:], encoding="utf-8")
            line = [ln for ln in (r.stdout or "").splitlines() if ln.startswith("PROJECTED ")]
            S[f"thesis_{vp}"] = nid
            S[f"thesis_setup_{vp}"] = {"position": ps, "projection": json.loads(line[-1][10:]) if line else {"error": f"rc {r.returncode}"}}
        nid = S[f"thesis_{vp}"]
        goto(pg_, "/journal?j2tab=positions")
        chip = pg_.locator(f'[data-thesis-chip="{nid}"] button').filter(visible=True)
        try:
            chip.first.wait_for(state="visible", timeout=40000)
        except Exception:  # noqa: BLE001
            C.step(pg_, inst_, "4 thesis chip sheet", f"{vp}: the chip on the IBM position row", "FAIL", reason="no chip rendered",
                   setup=S.get(f"thesis_setup_{vp}"), chips=pg_.locator("[data-thesis-chip]").count(),
                   chips_api=(M.post(base + "/api/j2/thesis-chips", data={"symbols": ["IBM"]}).text() or "")[:500])
            return
        cname = chip.first.get_attribute("aria-label") or chip.first.inner_text()
        t_chip = top(chip.first)
        press(chip.first, touch)
        sheet = pg_.locator('[role="dialog"]').filter(visible=True).last
        sheet.wait_for(state="visible", timeout=15000)
        pg_.wait_for_timeout(600)
        stext = sheet.inner_text()[:500]
        geo = sheet.evaluate("e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }")
        name_ = sheet.evaluate("e => { const id = e.getAttribute('aria-labelledby'); const t = id && document.getElementById(id); return e.getAttribute('aria-label') || (t ? t.textContent.trim() : null) }")
        has_levels = all(v in stext for v in ("200", "190", "230"))
        C.step(pg_, inst_, "4 thesis chip sheet", f"{vp}: tapping the chip opens its sheet with the note's levels", "PASS" if has_levels else "FAIL",
               chip_name=cname, chip=t_chip, sheet_name=name_, sheet_box=geo, sheet_text=stext, scope=['[role="dialog"]'])
        close = sheet.get_by_role("button", name="Close", exact=True)
        t_close = top(close.first)
        press(close.first, touch)
        pg_.wait_for_timeout(800)
        closed = pg_.locator('[role="dialog"]').filter(visible=True).filter(has_text=stext[:20]).count() == 0
        C.step(pg_, inst_, "4 thesis chip sheet", f"{vp}: Close shuts the sheet", "PASS" if closed and t_close["on_top"] else "FAIL", close_button=t_close, closed=closed)
        press(chip.first, touch)
        sheet = pg_.locator('[role="dialog"]').filter(visible=True).last
        sheet.wait_for(state="visible", timeout=15000)
        link = sheet.get_by_role("link", name="Open note")
        t_link = top(link.first)
        press(link.first, touch)
        landed = None
        try:
            pg_.wait_for_url(lambda u: "note=" in u, timeout=20000)
            pg_.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            landed = pg_.url.split(base)[-1]
        except Exception as e:  # noqa: BLE001
            landed = f"(no note: {str(e)[:120]})"
        C.step(pg_, inst_, "4 thesis chip sheet", f"{vp}: Open note in the sheet opens the thesis note", "PASS" if nid in (landed or "") else "FAIL",
               open_note_link=t_link, landed=landed)

    # ══ 5 and 7: Ask ═════════════════════════════════════════════════════════════════════════
    def ask_ui(p_, question, input_id, timeout=180):
        box = p_.locator(f"#{input_id}")
        box.wait_for(state="visible", timeout=15000)
        if NO_MODEL:
            return {"skipped": "VERIFY_NO_MODEL=1: the question was not sent"}
        box.fill(question)
        box.press("Enter")
        ans = p_.locator('[data-testid="ask-answer"][aria-busy="false"]')
        alert = p_.locator('[role="dialog"] [role="alert"], [role="alert"]').filter(visible=True)
        t0 = time.time()
        while time.time() - t0 < timeout:
            if (ans.count() and ans.first.is_visible()) or (alert.count() and alert.first.is_visible()):
                break
            p_.wait_for_timeout(500)
        p_.wait_for_timeout(900)
        a = p_.locator('[data-testid="ask-answer"]')
        return {"answer": a.first.inner_text() if a.count() else "",
                "alert": alert.first.inner_text() if alert.count() and alert.first.is_visible() else None,
                "chips": p_.locator('[data-testid="ask-answer"] [data-citation]').count(),
                "chip_labels": [c.get_attribute("aria-label") for c in p_.locator('[data-testid="ask-answer"] [data-citation]').all()][:8],
                "sources": [x.replace("\n", " ") for x in p_.locator('[data-testid="ask-sources"] button').all_inner_texts()],
                "coverage": (p_.locator('[data-testid="ask-coverage"]').first.inner_text() if p_.locator('[data-testid="ask-coverage"]').count() else None),
                "seconds": round(time.time() - t0, 1)}

    DOC_NAME = "quillmoor-memo.docx"
    DOC_PARAS = ["Quillmoor harbour memo.", "The Quillmoor ferry terminal reopens on April 14 after the dredging survey.",
                 "Nothing else in this memo concerns markets."]
    DOC_Q = "When does the Quillmoor ferry terminal reopen?"

    def docask(pg_, inst_, ctx_, vp, touch):
        M = ctx_.request
        nid = S.get("doc_note")
        if not nid:
            nid = mk(ctx_, inst_, "Harbour memo", K.doc_of(["The memo is attached below."]), key="doc_note")
            up = M.post(f"{base}/api/j2/notes/{nid}/attachments", multipart={"file": {"name": DOC_NAME,
                        "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "buffer": K.make_docx(DOC_PARAS)}})
            att = up.json() if up.status == 200 else {}
            C.REC.setdefault("api_writes", []).append({"config": cfg, "viewport": vp, "method": "POST", "url": f"/api/j2/notes/{nid}/attachments",
                                                        "status": up.status, "request": f"multipart file {DOC_NAME}", "response": json.dumps(att)[:800]})
            n = note_json(M, nid)
            body = K.doc_of(["The memo is attached below."])
            body["content"].append({"type": "paragraph", "content": [{"type": "attachmentChip", "attrs": {"href": att.get("url"), "name": att.get("name") or DOC_NAME, "size": att.get("size")}}]})
            C.api(ctx_, inst_, "PUT", base, f"/api/j2/notes/{nid}", {"bodyJson": body, "baseUpdatedAt": n.get("updatedAt")})
            S["doc_attachment"] = {k: att.get(k) for k in ("url", "name", "size")}
        rows, t0 = [], time.time()
        while time.time() - t0 < 120:
            j = M.get(f"{base}/api/j2/notes/{nid}/documents").json()
            rows = (j.get("documents") if isinstance(j, dict) else j) or []
            if rows and all(str(d.get("status")) not in ("pending", "processing", "queued") for d in rows):
                break
            time.sleep(3)
        docs = [{k: d.get(k) for k in ("id", "name", "sourceKind", "status", "pageCount", "attachmentUrl")} for d in rows]
        # the member's path to a Word file's sheet: search the Notebook for a word only the file holds,
        # and open the document hit (the in-note chip opens a sheet only for a PDF; NoteEditorPage.jsx)
        goto(pg_, "/journal/notebook?view=all")
        box = pg_.get_by_label("Search your notes").filter(visible=True)
        if not box.count():
            press(pg_.locator('[aria-label="Search notes"]').filter(visible=True).first, touch)
        box = pg_.get_by_label("Search your notes").filter(visible=True).first
        box.wait_for(state="visible", timeout=20000)
        box.fill("Quillmoor dredging")
        pg_.wait_for_timeout(3500)
        hits = pg_.evaluate("""() => [...document.querySelectorAll('[role=option], [role=listitem], li button, li a')].filter(e => e.getBoundingClientRect().width > 0 && /quillmoor|harbour memo/i.test(e.textContent))
            .map(e => e.tagName + '|' + (e.getAttribute('aria-label') || '') + '|' + e.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120)).slice(0, 10)""")
        cand = pg_.locator("button, a, [role=option]").filter(has_text=re.compile(r"quillmoor", re.I)).filter(visible=True)
        sheet = pg_.get_by_role("dialog", name=f"Preview of {DOC_NAME}")
        opened_by = None
        for i in range(min(cand.count(), 4)):
            try:
                press(cand.nth(i), touch)
                sheet.first.wait_for(state="visible", timeout=8000)
                opened_by = cand.nth(i).inner_text()[:120] if cand.nth(i).count() else "search hit"
                break
            except Exception:  # noqa: BLE001
                continue
        if not opened_by:
            C.step(pg_, inst_, "5 ask from a document's sheet", f"{vp}: reach the Word file's preview sheet from Notebook search", "NOT_RUN",
                   reason="no search hit opened the document's preview sheet", documents=docs, search_hits=hits, url=pg_.url.split(base)[-1])
            return
        url_after = pg_.url.split(base)[-1]
        ask_btn = sheet.first.get_by_role("button", name="Ask a question about this document")
        C.step(pg_, inst_, "5 ask from a document's sheet", f"{vp}: Notebook search opens the Word file's own preview sheet, and it offers Ask",
               "PASS" if ask_btn.count() else "FAIL", opened_by=opened_by, url=url_after, documents=docs, search_hits=hits,
               ask_buttons=ask_btn.count(), sheet_text=sheet.first.inner_text()[:400], scope=['[role="dialog"]'])
        if not ask_btn.count():
            return
        press(ask_btn.first, touch)
        a = ask_ui(pg_, DOC_Q, "ask-input-document")
        if a.get("skipped"):
            C.step(pg_, inst_, "5 ask from a document's sheet", f"{vp}: the question", "NOT_RUN", reason=a["skipped"])
            return
        bad = K.unsupported(a["answer"], " ".join(DOC_PARAS) + " " + DOC_Q + " " + DOC_NAME)
        invented = bool(bad["numbers"] or bad["proper_nouns"])
        cites_file = a["chips"] > 0 and (any(DOC_NAME in (l or "") for l in a["chip_labels"]) or any(DOC_NAME in s_ for s_ in a["sources"]))
        C.step(pg_, inst_, "5 ask from a document's sheet", f"{vp}: asked from the sheet, the answer has the date and cites the file",
               "PASS" if "April 14" in a["answer"] and cites_file and not invented and not a["alert"] else "FAIL", question=DOC_Q, **a,
               cites_the_file=cites_file, not_in_file=bad, INVENTED=bad if invented else None, scope=['[role="dialog"]'])

    def chip_in_body(pg_, inst_, vp, touch):
        """INFO: what clicking the Word file's chip in the note body does (a sheet opens only for a PDF, by design)."""
        nid = S.get("doc_note")
        if not nid:
            return
        goto(pg_, f"/journal/notebook?note={nid}", ".ProseMirror")
        chip = pg_.locator('a[data-type="attachmentChip"]').filter(visible=True)
        n = chip.count()
        dl = None
        if n:
            try:
                with pg_.expect_download(timeout=8000) as d:
                    press(chip.first, touch)
                dl = d.value.suggested_filename
            except Exception as e:  # noqa: BLE001
                dl = f"(no download: {type(e).__name__})"
            pg_.wait_for_timeout(800)
        C.step(pg_, inst_, "5 ask from a document's sheet", f"{vp}: the Word file's chip in the note body (control)", "INFO", chips_in_body=n,
               download=dl, sheet_opened=pg_.get_by_role("dialog", name=f"Preview of {DOC_NAME}").count(),
               note="NoteEditorPage opens the preview sheet from a chip only for a PDF; a Word chip downloads")

    def longask(pg_, inst_, ctx_, vp, touch, runs=2):
        M = ctx_.request
        ids = [mk(ctx_, inst_, K.NOTE_A[0], K.doc_of(K.NOTE_A[2]), ticker=K.NOTE_A[1], key="ask_a"),
               mk(ctx_, inst_, K.NOTE_B[0], K.doc_of(K.NOTE_B[2]), ticker=K.NOTE_B[1], key="ask_b"),
               mk(ctx_, inst_, KA.LONG_TITLE, K.doc_of(KA.LONG_PARAS), ticker=KA.LONG_TICKER, key="ask_long")]
        long_chars = sum(len(p) for p in KA.LONG_PARAS)
        corpus = " ".join([K.NOTE_A[0], K.NOTE_B[0], KA.LONG_TITLE] + K.NOTE_A[2] + K.NOTE_B[2] + KA.LONG_PARAS)
        if not S.get("ask_seen"):
            for nid in ids:
                goto(pg_, f"/journal/notebook?note={nid}", ".ProseMirror")
                pg_.wait_for_timeout(1200)
            S["ask_seen"] = True
        for i in range(1, runs + 1):
            goto(pg_, "/journal/notebook")
            pg_.wait_for_timeout(1200)
            door = pg_.locator('button[aria-label="Ask a question about my notebook"]').filter(visible=True)
            press(door.first, touch)
            a = ask_ui(pg_, KA.Q_LONG, "ask-input-notebook")
            if a.get("skipped"):
                C.step(pg_, inst_, "7 long-note ask", f"{vp}: run {i}", "NOT_RUN", reason=a["skipped"])
                continue
            ans = a["answer"]
            text = re.sub(r"\bI['\u2019](m|ve|d|ll)\b", "I", ans.replace("-", " "))
            bad = K.unsupported(text, corpus + " " + KA.Q_LONG + " searched")
            invented = bool(bad["numbers"] or bad["proper_nouns"])
            facts = {"entry 26.35": "26.35" in ans, "stop 24.85": "24.85" in ans,
                     "risk: budget timing": bool(re.search(r"budget|Army|contract renewal", ans, re.I)),
                     "risk: stock based compensation": bool(re.search(r"compensation|dilut", ans, re.I)),
                     "final rule: no adds until above 28 for two days": bool(re.search(r"\b28\b", ans)) and bool(re.search(r"two (days|sessions|closes)|2 days|two consecutive|consecutive", ans, re.I)),
                     "a citation chip": a["chips"] > 0, "cites PLTR deep dive": any(KA.LONG_TITLE in s_ for s_ in a["sources"]) or any(KA.LONG_TITLE in (l or "") for l in a["chip_labels"])}
            not_found = bool(re.search(r"could ?n[o\u2019']t find|did ?n[o\u2019']t find|no (mention|record)", ans, re.I))
            C.step(pg_, inst_, "7 long-note ask", f"{vp}: Research Home Ask over the {long_chars}-character PLTR note (run {i})",
                   "PASS" if all(facts.values()) and not not_found and not invented and not a["alert"] else "FAIL",
                   question=KA.Q_LONG, **a, facts_found=facts, says_it_could_not_find_it=not_found,
                   says_a_note_is_defective=KA.DEFECT.findall(ans), not_in_notes=bad, INVENTED=bad if invented else None)

    # ══ 6. chart block drag (mouse, 1280) ════════════════════════════════════════════════════
    def drag(pg_, inst_, ctx_, vp):
        M = ctx_.request
        x = C.x13

        def fresh(tag):
            return mk(ctx_, inst_, f"Chart drag {tag}", {"type": "doc", "content": [x.chart_block("NVDA", [], f"e-dr-{tag}"), x.para("Paragraph A."), x.para("Paragraph B.")]})

        def order(nid):
            return [c.get("type") for c in ((note_json(M, nid).get("bodyJson") or {}).get("content") or [])]

        def wait_order(nid, before, secs=10):
            o = order(nid)
            end = time.time() + secs
            while time.time() < end and o == before:
                pg_.wait_for_timeout(500)
                o = order(nid)
            return o

        def open_(nid, chart_top_at=None):
            """Open the note. `chart_top_at`: scroll the note's own scroller so the chart's TOP sits that
            many px below the window top (the grip is placed beside a block's top edge, blockHandle.js
            place()); otherwise Paragraph B is scrolled into view, as fin-walk F3's gesture did."""
            goto(pg_, f"/journal/notebook?note={nid}", ".ProseMirror")
            b_ = pg_.locator("[data-widget-embed-body]").first
            b_.wait_for(state="visible", timeout=40000)
            pg_.wait_for_timeout(2500)
            if chart_top_at is None:
                pg_.locator(".ProseMirror p", has_text="Paragraph B.").first.scroll_into_view_if_needed()
            else:
                F.h2.frame_of(pg_, 0).evaluate("""(el, off) => { let n = el.parentElement;
                    while (n && n !== document.body) { const cs = getComputedStyle(n);
                      if (n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(cs.overflowY)) break; n = n.parentElement }
                    const dy = el.getBoundingClientRect().top - off;
                    if (n && n !== document.body) n.scrollTop += dy; else window.scrollBy(0, dy) }""", chart_top_at)
                pg_.wait_for_timeout(400)
            return b_

        GRIP_JS = """() => [...document.querySelectorAll('button.uctBlockHandle')].map(b => { const r = b.getBoundingClientRect(); const s = getComputedStyle(b);
                return { label: b.getAttribute('aria-label'), draggable: b.getAttribute('draggable'), hidden: b.hidden, pos: b.dataset.pos || null,
                         box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
                         visible: r.width > 0 && !b.hidden && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' } })"""

        def grip_for_embed():
            """Where does the block grip appear as the pointer rests on the chart? Several resting points
            are tried, each reached by a short pointer move (the grip follows `mousemove` on the editor,
            blockHandle.js onMove). The first point at which a visible grip sits beside the chart wins."""
            frame = F.h2.frame_of(pg_, 0)
            fb = frame.bounding_box()
            probes = []
            pts = [("chart frame, 6 px inside its top-left", fb["x"] + 6, fb["y"] + 6), ("chart frame, top centre", fb["x"] + fb["width"] / 2, fb["y"] + 8),
                   ("chart, centre", fb["x"] + fb["width"] / 2, fb["y"] + fb["height"] / 2), ("chart, 40 px in", fb["x"] + 40, fb["y"] + 40),
                   ("just left of the chart", fb["x"] - 8, fb["y"] + 30)]
            win = None
            for label, px, py in pts:
                pg_.mouse.move(px - 3, py - 3)
                pg_.mouse.move(px, py, steps=3)
                pg_.wait_for_timeout(500)
                gi = pg_.evaluate(GRIP_JS)
                beside = [g_ for g_ in gi if g_["visible"] and abs(g_["box"][1] - fb["y"]) < 40 and 0 <= g_["box"][1] <= 800]
                probes.append({"rest": label, "grip": gi, "beside_the_chart": bool(beside)})
                if beside:
                    win = label
                    break
            # control: the grip for a paragraph
            pb = pg_.locator(".ProseMirror p", has_text="Paragraph A.").first.bounding_box()
            pg_.mouse.move(pb["x"] + 20, pb["y"] + pb["height"] / 2, steps=3)
            pg_.wait_for_timeout(500)
            ctrl = pg_.evaluate(GRIP_JS)
            if win:   # come back to the resting point that showed the chart's grip
                label, px, py = next(p_ for p_ in pts if p_[0] == win)
                pg_.mouse.move(px, py, steps=3)
                pg_.wait_for_timeout(500)
            g = pg_.locator("button.uctBlockHandle")
            return g, {"probes": probes, "chart_grip_shown_at": win, "paragraph_control": ctrl}, fb

        attempts = []

        def attempt(name, fn):
            nid = fresh(name.split(":")[0])
            before = order(nid)
            err, extra = None, {}
            try:
                extra = fn(nid) or {}
            except Exception as e:  # noqa: BLE001
                err = f"{type(e).__name__}: {str(e)[:300]}"
            after = wait_order(nid, before)
            moved = bool(after) and after[0] != "widgetEmbed" and "widgetEmbed" in after
            row = {"attempt": name, "note": nid, "order_before": before, "stored_order_after": after, "moved_below_a_paragraph": moved, "error": err, **extra}
            attempts.append(row)
            C.step(pg_, inst_, "6 chart block drag", f"{vp}: {name}", "PASS" if moved else "FAIL", **row,
                   how_to_read="FAIL means the stored order did not change after this gesture; whether a member can do it is judged from all attempts together")

        def body_pointer(nid):
            b_ = open_(nid)
            sb = b_.bounding_box()
            tb = pg_.locator(".ProseMirror p", has_text="Paragraph B.").first.bounding_box()
            x0, y0, y1 = sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2, tb["y"] + tb["height"] - 2
            pg_.mouse.move(x0, y0)
            pg_.mouse.down()
            pg_.wait_for_timeout(250)
            for i in range(1, 31):
                pg_.mouse.move(x0 + (i % 3), y0 + (y1 - y0) * i / 30)
                pg_.wait_for_timeout(35)
            pg_.mouse.up()

        def body_pointer_quick(nid):
            b_ = open_(nid)
            sb = b_.bounding_box()
            tb = pg_.locator(".ProseMirror p", has_text="Paragraph B.").first.bounding_box()
            pg_.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
            pg_.mouse.down()
            pg_.mouse.move(tb["x"] + 20, tb["y"] + 14)
            pg_.mouse.up()

        def body_pointer_chart_in_view(nid):
            b_ = open_(nid, chart_top_at=170)
            sb = b_.bounding_box()
            tb = pg_.locator(".ProseMirror p", has_text="Paragraph B.").first.bounding_box()
            pg_.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
            pg_.mouse.down()
            pg_.mouse.move(tb["x"] + 20, tb["y"] + 14, steps=10)
            pg_.mouse.up()
            return {"chart_box": [round(v) for v in (sb["x"], sb["y"], sb["width"], sb["height"])], "paragraph_b_box": [round(v) for v in (tb["x"], tb["y"], tb["width"], tb["height"])]}

        def body_drag_to(nid):
            b_ = open_(nid)
            b_.drag_to(pg_.locator(".ProseMirror p", has_text="Paragraph B.").first, target_position={"x": 20, "y": 14})

        def page_dnd(nid):
            open_(nid)
            pg_.drag_and_drop('[data-widget-embed-body]', '.ProseMirror p:has-text("Paragraph B.")', target_position={"x": 20, "y": 14})

        def grip_pointer(nid):
            open_(nid, chart_top_at=170)
            g, info, fb = grip_for_embed()
            vis = g.filter(visible=True)
            if not vis.count() or not info["chart_grip_shown_at"]:
                return {"grip": info, "grip_visible_beside_the_chart": False}
            gb = vis.first.bounding_box()
            tb = pg_.locator(".ProseMirror p", has_text="Paragraph B.").first.bounding_box()
            pg_.mouse.move(gb["x"] + gb["width"] / 2, gb["y"] + gb["height"] / 2)
            pg_.mouse.down()
            pg_.wait_for_timeout(200)
            y1 = tb["y"] + tb["height"] - 2
            for i in range(1, 31):
                pg_.mouse.move(gb["x"] + gb["width"] / 2 + 30, gb["y"] + (y1 - gb["y"]) * i / 30)
                pg_.wait_for_timeout(35)
            pg_.mouse.up()
            return {"grip": info}

        def grip_drag_to(nid):
            open_(nid, chart_top_at=170)
            g, info, fb = grip_for_embed()
            vis = g.filter(visible=True)
            if not vis.count() or not info["chart_grip_shown_at"]:
                return {"grip": info, "grip_visible_beside_the_chart": False}
            vis.first.drag_to(pg_.locator(".ProseMirror p", has_text="Paragraph B.").first, target_position={"x": 20, "y": 14})
            return {"grip": info}

        def grip_menu(nid):
            open_(nid, chart_top_at=170)
            g, info, fb = grip_for_embed()
            vis = g.filter(visible=True)
            if not vis.count() or not info["chart_grip_shown_at"]:
                return {"grip": info, "grip_visible_beside_the_chart": False}
            vis.first.click()
            pg_.wait_for_timeout(500)
            grp = pg_.get_by_role("group", name="Move block")
            items = grp.first.inner_text()[:120] if grp.count() else None
            pg_.get_by_role("button", name="Move down", exact=True).filter(visible=True).first.click(timeout=8000)
            pg_.wait_for_timeout(600)
            vis2 = pg_.locator("button.uctBlockHandle").filter(visible=True)
            if pg_.get_by_role("button", name="Move down", exact=True).filter(visible=True).count():
                pg_.get_by_role("button", name="Move down", exact=True).filter(visible=True).first.click(timeout=8000)
            elif vis2.count():
                vis2.first.click()
                pg_.wait_for_timeout(400)
                pg_.get_by_role("button", name="Move down", exact=True).filter(visible=True).first.click(timeout=8000)
            return {"grip": info, "menu": items}

        # where the chart's grip appears when the chart's top edge is above the window (the state fin-walk F3's
        # gesture started from: Paragraph B scrolled into view under a tall chart)
        try:
            nid0 = fresh("grip-probe")
            open_(nid0)
            _g, ginfo, gfb = grip_for_embed()
            C.step(pg_, inst_, "6 chart block drag", f"{vp}: where the chart's grip sits when the chart's top edge is scrolled above the window", "INFO",
                   chart_box=[round(v) for v in (gfb["x"], gfb["y"], gfb["width"], gfb["height"])], grip=ginfo)
        except Exception as e:  # noqa: BLE001
            C.step(pg_, inst_, "6 chart block drag", f"{vp}: grip probe", "INFO", error=str(e)[:300])
        for name, fn in (("A: pointer down on the chart body, 30 moves, up (fin-walk F3's gesture)", body_pointer),
                         ("A2: pointer down on the chart body, one move to Paragraph B, up (no hold)", body_pointer_quick),
                         ("A3: as A2 but with the chart's top in view first and 10 pointer steps", body_pointer_chart_in_view),
                         ("B: locator.drag_to from the chart body to Paragraph B (synthesised HTML5 drag)", body_drag_to),
                         ("C: page.drag_and_drop from the chart body to Paragraph B (synthesised HTML5 drag)", page_dnd),
                         ("D: the block grip 'Move this block': pointer down, moves, up", grip_pointer),
                         ("E: locator.drag_to from the block grip to Paragraph B", grip_drag_to),
                         ("F: click the block grip, then Move down twice (a mouse path that is not a drag)", grip_menu)):
            attempt(name, fn)
        C.step(None, inst_, "6 chart block drag", f"{vp}: summary of every mouse attempt", "INFO",
               attempts=[{k: r_.get(k) for k in ("attempt", "stored_order_after", "moved_below_a_paragraph", "error")} for r_ in attempts], shot=False)

    # ══ run ══════════════════════════════════════════════════════════════════════════════════
    for vp in VPS:
        touch = vp != "1280"
        if any(s in steps for s in ("bulk", "folder", "views", "restore", "gallery", "publish", "thesis")):
            ctx = enter(f"m_{vp}", f"vm{vp}", vp)
            inst = C.Inst(ctx, cfg, vp)
            pg = ctx.new_page()
            if "bulk" in steps:
                ectx = enter(f"edge_{vp}", f"ve{vp}", vp)
                einst = C.Inst(ectx, cfg, vp)
                epg = ectx.new_page()
                guard("bulk", vp, epg, einst, lambda: bulk(epg, einst, ectx, vp, touch, edge=True))
                ectx.close()
            for name, fn in (("bulk", bulk), ("folder", folder), ("views", views), ("restore", restore), ("gallery", gallery), ("publish", publish)):
                if name in steps:
                    guard(name, vp, pg, inst, lambda fn=fn: fn(pg, inst, ctx, vp, touch))
            if "thesis" in steps and touch:
                guard("thesis", vp, pg, inst, lambda: thesis(pg, inst, ctx, vp, touch, f"m_{vp}"))
            ctx.close()
        if "chartplan" in steps:
            ctx = enter(f"cp_{vp}", f"vc{vp}", vp)
            inst = C.Inst(ctx, cfg, vp)
            pg = ctx.new_page()
            guard("chartplan", vp, pg, inst, lambda: chartplan(pg, inst, ctx, vp, touch))
            ctx.close()
        if "drag" in steps and not touch:
            ctx = enter("drag_1280", "vd", vp)
            inst = C.Inst(ctx, cfg, vp)
            pg = ctx.new_page()
            guard("drag", vp, pg, inst, lambda: drag(pg, inst, ctx, vp))
            ctx.close()
        if "docask" in steps:
            ctx = enter("doc_member", "vdoc", vp)
            inst = C.Inst(ctx, cfg, vp)
            pg = ctx.new_page()
            guard("docask", vp, pg, inst, lambda: docask(pg, inst, ctx, vp, touch))
            guard("docask", vp, pg, inst, lambda: chip_in_body(pg, inst, vp, touch))
            ctx.close()
        if "longask" in steps:
            ctx = enter("ask_member", "vask", vp)
            inst = C.Inst(ctx, cfg, vp)
            pg = ctx.new_page()
            guard("longask", vp, pg, inst, lambda: longask(pg, inst, ctx, vp, touch))
            ctx.close()


if __name__ == "__main__":
    print("run this through tools/notebook_fin_walk.py --config verify")
    sys.exit(2)
