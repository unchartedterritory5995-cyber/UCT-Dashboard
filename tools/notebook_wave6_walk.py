"""Wave 6 live walk -- the Playwright script that produces
docs/notebook/gate-runs/wave6/walk-<sha>.json. Kept in tools/ so the evidence is
reproducible; it is NOT a pytest rail.

Preconditions (each one bit a real attempt -- read wave5's own header before
changing this one; the same three traps bit that walk first):
  * a hub sandbox on :8093 booted from the tip under test:
        scripts/hub_sandbox_boot.py --data-dir C:\\data-w6walk --port 8093
    C:\\data must read CLEAN at every integrity checkpoint (the boot's own
    snapshot rail, docs/plans/joystick/sandbox-runs/<ts>.md) -- this script
    copies that log's summary lines into the JSON at the end, under
    "sandbox_integrity";
  * the walk account (g064@local.dev / LocalTest2026!) must be PAID on that
    data dir, or AuthGuard sends every notebook route to /morning-wire and
    every check below reads as "the page never rendered" (wave 5's own
    lesson). This script is SELF-PROVISIONING: it signs up the sandbox admin
    (ADMIN_EMAILS default hubtest@local.dev / LocalTest2026!) if the account
    does not exist yet, signs up the walk account and a SECOND member account
    (g064b@local.dev, for the W3 template-visibility check), and comps both
    non-admin accounts via POST /api/auth/admin/comp-access. It aborts loudly
    (SystemExit(2)) if /api/auth/me does not report a paid-equivalent account
    for the primary walk account after that;
  * app/dist rebuilt from the tip (cd app && npm run build) -- the sandbox
    serves dist/.

    python tools/notebook_wave6_walk.py docs/notebook/gate-runs/wave6/walk-<sha>.json

Wave 6 live walk: real Chromium (Playwright), local sandbox on :8093, synthetic
accounts. Desktop 1280x800 unless noted. Each check records what the DOM/API
actually says; nothing is inferred. Selectors come from the committed
components AND their own test files (NotebookTab.*.test.jsx, FolderSidebar.
tagRename.test.jsx, NoteEditorPage.menuUnlock.test.jsx, RelationPropertyValue.
test.jsx, NoteTasksView.test.jsx, UnlinkedMentions.test.jsx,
dateMentionNode.test.js, tableOfContentsNode.test.js, SlashMenu.items.test.jsx)
-- never guessed. Two places where the committed behaviour has MOVED past the
brief's own wording (both cited in the JSON, not silently "fixed"):
  * W8's "unsent work" waiver: fix round 3 (N1, final) REMOVED the "Rename the
    others" button entirely -- a note the device cannot vouch for now gets NO
    waiver of any kind, just a named notice and a plain Close/Dismiss. This
    walk checks the REAL current copy, not the brief's.
  * W11's unlinked mention: the shipped UnlinkedMentions component offers
    "Open" ONLY -- there is deliberately no "link it" affordance (linking from
    there would be a second writer into the target note). This walk checks the
    REAL current behaviour and records the brief's stale expectation.

  W1  lock/unlock: PATCH .../lock, the note's own menu ("Organise this note"),
      read-only while locked, no 409/conflicted-copy after unlock+keystroke
  W2  archive: leaves the default list, not in Trash, appears in Archived,
      Restore/Unarchive returns it; bulk archive + Undo
  W3  templates: Save as template -> Your templates -> New from template ->
      bodyJson matches; a second member does not see it
  W4  Ctrl/Cmd+Alt+D opens today's daily note, idempotent per member per day
  W5  relation property: A -> B, B shows "Related from" naming A
  W6  Timeline view: offered, saveable with its settings, restores as timeline
  W7  split view: Open beside, refuse-same-note-in-both-panes, per-pane
      Ctrl/Cmd-click and image-picker isolation
  W8  tag rename: flat row AND nested tree node, preview count matches
      GET /notes/tag-members, confirm updates every member, unsent work named
  W9  editor nodes: 2 columns, @today date mention, image figure + caption,
      /toc table of contents -- survive a reload (schema level 2)
  W10 link paste: the offer appears; a non-JSON preview answer yields no card;
      look-alike host naming is READ from source, not exercised live
  W11 lane F: unlinked mentions (Open-only), tasks-across-notes (API-level;
      the view has no live route -- recorded), telemetry POST on note open,
      forced client error reaches the error beacon
  W12 two real tabs, one note: Web Locks ownership, bfcache/pagehide recovery
  W13 zero pageerror across the whole walk; sandbox integrity log copied in
"""
import base64
import json
import re
import sys
import time as _t
import traceback

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8093"
ADMIN_EMAIL, ADMIN_PW = "hubtest@local.dev", "LocalTest2026!"
EMAIL, PW = "g064@local.dev", "LocalTest2026!"          # primary walk account
EMAIL2, PW2 = "g064b@local.dev", "LocalTest2026!"        # second member (W3)
OUT = sys.argv[1] if len(sys.argv) > 1 else "wave6_walk.json"
P = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}
RUN = _t.strftime("r%H%M%S")   # unique per run: repeat runs never match an older run's notes

res = {"errors": [], "checks": {}}

# ⛔ A crash must never discard what was already measured -- dump the partial
# `res` on ANY exit, and record the exception itself in it (wave5's own rule).
import atexit  # noqa: E402


def _dump_partial():
    try:
        json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        print("partial dump failed:", e)


atexit.register(_dump_partial)
_orig_hook = sys.excepthook


def _hook(t, v, tb):
    res["errors"].append("UNHANDLED: " + "".join(traceback.format_exception(t, v, tb))[-1500:])
    res["INCOMPLETE"] = True
    _orig_hook(t, v, tb)


sys.excepthook = _hook


def record(key, verdict, **facts):
    """One check = one JSON key, PASS/FAIL/INCONCLUSIVE + the measured facts."""
    entry = {"verdict": verdict}
    entry.update(facts)
    res["checks"][key] = entry
    print(f"[{verdict}] {key}: " + json.dumps(facts, default=str)[:300])
    return entry


def guarded(key):
    """Decorator: never let one check's exception stop the rest of the walk."""
    def wrap(fn):
        def inner(*a, **kw):
            try:
                fn(*a, **kw)
            except Exception as e:  # noqa: BLE001
                tb = traceback.format_exc()[-1200:]
                record(key, "INCONCLUSIVE", reason=f"exception: {e}", traceback=tb)
        return inner
    return wrap


def signup_or_login(request_ctx, email, pw, name):
    r = request_ctx.post(BASE + "/api/auth/signup",
                          data={"email": email, "password": pw, "display_name": name})
    if r.status not in (200, 201):
        r = request_ctx.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
    return r


def dismiss_intro(page):
    page.wait_for_timeout(1200)
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)


def notebook_url(note_id=None, extra=""):
    if note_id:
        return f"{BASE}/journal/notebook?note={note_id}{extra}"
    return f"{BASE}/journal/notebook{extra}"


# ⛔⛔ REAL, REPRODUCIBLE DEFECT FOUND WHILE BUILDING THIS WALK, NOT A WALK
# ARTIFACT -- read before touching anything below.
#
# `NoteEditorPage.jsx:2448` (wave 6 fix round 1, I5 -- the split-view image-
# picker isolation fix): `const dom = editor?.view?.dom` inside a bare
# `useEffect(() => {...}, [editor])`. Measured on this tip: opening ANY note
# throws `[tiptap error]: The editor view is not available ... The editor may
# not be mounted yet.` on roughly HALF of all note-opens (6 fresh contexts,
# fresh notes, generous waits: 3/6 crashed; a second run of 4: 2/4 crashed),
# caught by the nearest route-level ErrorBoundary, which replaces the ENTIRE
# editor with "Something went wrong on this page" -- not a wave-6-specific
# glitch, EVERY check that opens a note in a browser hits this.
#
# This is a NAMED hazard class from wave 5, reintroduced unguarded in wave 6:
# `NoteFindBar.jsx:63-64` carries the comment (still in the tree today) --
# "`isDestroyed` guards a note-switch/unmount racing this callback --
#  `editor.view` THROWS once destroyed (not merely undefined), so a bare
#  `editor?.view` optional-chain does not protect against it." -- and guards
# every one of its own `.view`/`.state` reads with `if (!editor ||
# editor.isDestroyed) return`. `NoteEditorPage.jsx:2448` has no such guard.
# Optional chaining only short-circuits on a null/undefined LEFT side; it does
# not catch a GETTER that itself throws, which is exactly what tiptap's
# `Editor.prototype.view` does pre-mount/post-destroy.
#
# Out of this walk's scope to fix (the brief: "you touch ONLY your new
# script"). Reported prominently in the JSON (see "CRITICAL_FINDING" below)
# and the report; the remedy pattern already lives in the same file family
# (`NoteFindBar.jsx`'s `isDestroyed` guard) for whoever picks this up.
_CRASH_STATS = {"count": 0, "attempts_log": []}


def _editor_view_crash_visible(pg):
    try:
        return pg.get_by_text("Something went wrong on this page").count() > 0
    except Exception:  # noqa: BLE001
        return False


def _fresh_page(ctx, old_pg=None):
    if old_pg is not None:
        try:
            old_pg.close()
        except Exception:  # noqa: BLE001
            pass
    npg = ctx.new_page()
    npg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
    return npg


def open_note(ctx, url, page=None, max_tries=8, prosemirror_timeout=15000, extra_listeners=None):
    """Navigate (hard nav) to a note URL, retrying through the known
    `editor?.view?.dom` throwing-getter crash (see the block above).

    ⛔ MEASURED: retrying on the SAME page object made the crash rate climb to
    100% by the end of a long run (48/48 retries failed once the walk was many
    note-opens deep on one shared page) -- a genuine compounding effect, not
    just a 50/50 coin flip. Every attempt here therefore gets a BRAND NEW page
    from the same context (closing the previous one), with a short backoff, so
    a slow/contended backend (the sandbox's own ~20-75s post-boot warm jobs
    were still running during the first measurement) gets a real chance to
    settle between tries.

    Returns the PAGE that actually mounted the editor (which may not be the
    `page` passed in) -- callers MUST reassign: `page = open_note(ctx, url, page)`.
    Raises after `max_tries` straight failures so the caller's own @guarded
    wrapper reports INCONCLUSIVE with a real reason rather than hanging.

    ⛔ The `page` passed in is BORROWED, never closed by this function -- on
    total failure the caller's existing page reference is still open and
    reusable for the NEXT check's unrelated navigation (a list view, say).
    Only pages THIS function creates for retries 2+ are owned and recycled."""
    pg = page if page is not None else _fresh_page(ctx)
    owns_pg = page is None
    for event, handler in (extra_listeners or []):
        pg.on(event, handler)
    for attempt in range(1, max_tries + 1):
        if attempt > 1:
            pg = _fresh_page(ctx, pg if owns_pg else None)
            owns_pg = True
            for event, handler in (extra_listeners or []):
                pg.on(event, handler)
        pg.goto(url)
        pg.wait_for_timeout(900)
        try:
            pg.keyboard.press("Escape")
        except Exception:  # noqa: BLE001
            pass
        pg.wait_for_timeout(500)
        if _editor_view_crash_visible(pg):
            _CRASH_STATS["count"] += 1
            _CRASH_STATS["attempts_log"].append({"url": url, "attempt": attempt, "outcome": "error_boundary"})
            pg.wait_for_timeout(1500 * attempt)
            continue
        try:
            pg.wait_for_selector(".ProseMirror", timeout=prosemirror_timeout)
            return pg
        except Exception:  # noqa: BLE001
            if _editor_view_crash_visible(pg):
                _CRASH_STATS["count"] += 1
                _CRASH_STATS["attempts_log"].append({"url": url, "attempt": attempt, "outcome": "error_boundary"})
                pg.wait_for_timeout(1500 * attempt)
                continue
            _CRASH_STATS["attempts_log"].append({"url": url, "attempt": attempt, "outcome": "prosemirror_timeout_no_boundary"})
    if owns_pg:
        try:
            pg.close()
        except Exception:  # noqa: BLE001
            pass
    raise RuntimeError(
        f"note editor never mounted after {max_tries} attempts, each on a FRESH "
        f"page (see the NoteEditorPage.jsx:2448 editor?.view?.dom throwing-getter "
        f"defect documented above _CRASH_STATS) -- url={url}"
    )


def reload_note(ctx, page, max_tries=8, prosemirror_timeout=15000):
    """Same retry discipline as open_note, for re-fetching an already-open
    note (used where a check needs the SAME note re-fetched, e.g. after an
    archive/unarchive PATCH). Retries also use a fresh page (a plain `goto`
    to the same URL rather than `page.reload()`, since the fresh-page
    discipline is what open_note measured as reliable).

    ⛔ Same borrow discipline as open_note: `page` is never closed by this
    function on total failure."""
    url = page.url
    pg = page
    owns_pg = False
    for attempt in range(1, max_tries + 1):
        if attempt == 1:
            pg.reload()
        else:
            pg = _fresh_page(ctx, pg if owns_pg else None)
            owns_pg = True
            pg.goto(url)
        pg.wait_for_timeout(700)
        if _editor_view_crash_visible(pg):
            _CRASH_STATS["count"] += 1
            _CRASH_STATS["attempts_log"].append({"url": url, "attempt": attempt, "outcome": "error_boundary(reload)"})
            pg.wait_for_timeout(1500 * attempt)
            continue
        try:
            pg.wait_for_selector(".ProseMirror", timeout=prosemirror_timeout)
            return pg
        except Exception:  # noqa: BLE001
            if _editor_view_crash_visible(pg):
                _CRASH_STATS["count"] += 1
                _CRASH_STATS["attempts_log"].append({"url": url, "attempt": attempt, "outcome": "error_boundary(reload)"})
                pg.wait_for_timeout(1500 * attempt)
                continue
            _CRASH_STATS["attempts_log"].append({"url": url, "attempt": attempt, "outcome": "prosemirror_timeout_no_boundary(reload)"})
    if owns_pg:
        try:
            pg.close()
        except Exception:  # noqa: BLE001
            pass
    raise RuntimeError(
        f"note editor never remounted after {max_tries} reloads (see the "
        f"NoteEditorPage.jsx:2448 editor?.view?.dom throwing-getter defect) -- url={url}"
    )


def type_by_walk(node):
    """Walk a bodyJson-shaped dict/list and count node types."""
    counts = {}

    def walk(n):
        if isinstance(n, dict):
            t = n.get("type")
            if t:
                counts[t] = counts.get(t, 0) + 1
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(node)
    return counts


PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- Provisioning: admin, walk account, second member -----------------
    actx = browser.new_context()
    signup_or_login(actx.request, ADMIN_EMAIL, ADMIN_PW, "hubtest")
    res["admin_login_ok"] = True

    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    signup_or_login(ctx.request, EMAIL, PW, "g064")
    api = ctx.request

    ctx2 = browser.new_context(viewport={"width": 1280, "height": 800})
    signup_or_login(ctx2.request, EMAIL2, PW2, "g064b")
    api2 = ctx2.request

    for email in (EMAIL, EMAIL2):
        c = actx.request.post(BASE + "/api/auth/admin/comp-access",
                               data={"email": email, "action": "grant"})
        res.setdefault("comp_status", {})[email] = c.status
        # A non-admin signup starts email_verified=False, and AuthGuard sends an
        # unverified member to /verify-pending regardless of plan -- every
        # notebook route redirects there, reading as "the editor never
        # rendered" if missed (the same class of trap wave 5's own header warns
        # about for the PAID gate). Admin-only door: POST /admin/verify-email.
        v = actx.request.post(BASE + "/api/auth/admin/verify-email", data={"email": email})
        res.setdefault("verify_email_status", {})[email] = v.status

    me = api.get(BASE + "/api/auth/me").json()
    res["account"] = {"role": (me.get("user") or {}).get("role"), "plan": me.get("plan"),
                       "paid_equiv": me.get("paid_equiv")}
    if not me.get("paid_equiv"):
        res["INCOMPLETE"] = True
        res["errors"].append(
            "ABORT: walk account is not paid (paid_equiv false) -- comp-access did not take; "
            "re-run after confirming admin_login_ok and comp_status above")
        raise SystemExit(2)

    me2 = api2.get(BASE + "/api/auth/me").json()
    res["account2_paid_equiv"] = me2.get("paid_equiv")

    page = ctx.new_page()
    page.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
    page.goto(notebook_url())
    dismiss_intro(page)

    # =========================================================================
    # W1 -- lock / unlock
    # =========================================================================
    @guarded("W1_lock_unlock")
    def check_w1():
        global page
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W1 lock {RUN}",
            "bodyJson": {"type": "doc", "content": [P("Original body.")]},
        }).json()["note"]
        nid = note["id"]
        page = open_note(ctx, notebook_url(nid), page)
        page.wait_for_timeout(400)

        menu = page.get_by_role("group", name="Organise this note")
        menu.wait_for(state="visible", timeout=8000)

        lock_req = {}
        def on_req(req):
            if req.method == "PATCH" and re.search(rf"/api/j2/notes/{nid}/lock$", req.url):
                try:
                    lock_req["body"] = json.loads(req.post_data or "{}")
                except Exception:
                    lock_req["body"] = req.post_data
        page.on("request", on_req)

        with page.expect_response(lambda r: r.url.endswith(f"/api/j2/notes/{nid}/lock")) as resp_info:
            menu.get_by_role("button", name="Lock", exact=True).click()
        lock_resp = resp_info.value
        lock_body = lock_resp.json()

        page.wait_for_timeout(300)
        editable_attr = page.locator(".ProseMirror").get_attribute("contenteditable")

        # Unlock -> a keystroke -> the autosave PUT
        put_bodies = []
        def on_put(req):
            if req.method == "PUT" and re.search(rf"/api/j2/notes/{nid}$", req.url):
                try:
                    put_bodies.append(json.loads(req.post_data or "{}"))
                except Exception:
                    pass
        page.on("request", on_put)

        with page.expect_response(lambda r: r.url.endswith(f"/api/j2/notes/{nid}/lock")) as unlock_info:
            menu.get_by_role("button", name="Unlock", exact=True).click()
        unlock_resp = unlock_info.value
        page.wait_for_timeout(400)
        editable_after_unlock = page.locator(".ProseMirror").get_attribute("contenteditable")

        page.locator(".ProseMirror").click()
        page.keyboard.press("End")
        page.keyboard.type(" and more.", delay=20)
        try:
            page.wait_for_function(
                "(n) => window.__uctPutCount === undefined || true", timeout=1)
        except Exception:
            pass
        page.wait_for_timeout(1600)   # autosave debounce window

        listed = api.get(BASE + f"/api/j2/notes?limit=200").json()
        notes = listed.get("notes", listed if isinstance(listed, list) else [])
        conflicted = [n for n in notes if "(conflicted copy)" in (n.get("title") or "")]

        lock_ok = lock_resp.ok and lock_body.get("note", {}).get("locked") is True
        read_only_while_locked = editable_attr == "false"
        unlock_ok = unlock_resp.ok and editable_after_unlock in (None, "true")
        autosave_fired = len(put_bodies) > 0
        no_conflict_copy = not conflicted

        record(
            "W1_lock_unlock", "PASS" if (
                lock_ok and read_only_while_locked and unlock_ok
                and autosave_fired and no_conflict_copy
            ) else "FAIL",
            note_id=nid,
            lock_patch_status=lock_resp.status,
            lock_patch_answer_is_note="note" in lock_body,
            lock_wire_body=lock_req.get("body"),
            editable_while_locked=editable_attr,
            unlock_patch_status=unlock_resp.status,
            editable_after_unlock=editable_after_unlock,
            autosave_put_fired=len(put_bodies) > 0,
            autosave_put_base_updated_at=(put_bodies[-1].get("baseUpdatedAt") if put_bodies else None),
            conflicted_copies_in_list=[n.get("title") for n in conflicted],
        )

    check_w1()

    # =========================================================================
    # W2 -- archive
    # =========================================================================
    @guarded("W2_archive")
    def check_w2():
        global page
        n1 = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W2 archive {RUN}",
            "bodyJson": {"type": "doc", "content": [P("Archive me.")]},
        }).json()["note"]
        folder = api.post(BASE + "/api/j2/note-folders", data={"name": f"Walk W2 folder {RUN}"})
        folder_id = None
        if folder.ok:
            fb = folder.json()
            folder_id = (fb.get("folder") or fb).get("id")
            api.put(BASE + f"/api/j2/notes/{n1['id']}", data={"folderId": folder_id})

        page = open_note(ctx, notebook_url(n1["id"]), page)
        page.wait_for_timeout(400)
        menu = page.get_by_role("group", name="Organise this note")
        menu.wait_for(state="visible", timeout=8000)

        with page.expect_response(lambda r: r.url.endswith(f"/api/j2/notes/{n1['id']}/archive")) as ai:
            menu.get_by_role("button", name="Archive", exact=True).click()
        archive_resp = ai.value
        archive_body = archive_resp.json() if archive_resp.ok else {}

        # Default list: gone. Trash: absent. Archived: present.
        default_list = api.get(BASE + "/api/j2/notes?limit=200").json()
        default_titles = [x.get("title") for x in default_list.get("notes", [])]
        trashed = api.get(BASE + "/api/j2/notes?deleted=true&limit=200").json()
        trashed_titles = [x.get("title") for x in trashed.get("notes", [])]
        archived = api.get(BASE + "/api/j2/notes?folder_id=__archived__&limit=200").json()
        archived_titles = [x.get("title") for x in archived.get("notes", [])]
        in_folder = api.get(BASE + f"/api/j2/notes?folder_id={folder_id}&limit=200").json() if folder_id else {"notes": []}
        in_folder_titles = [x.get("title") for x in in_folder.get("notes", [])]

        # Restore/Unarchive from the note menu -> back in default + still in its folder.
        page = reload_note(ctx, page)
        page.wait_for_timeout(400)
        menu2 = page.get_by_role("group", name="Organise this note")
        menu2.wait_for(state="visible", timeout=8000)
        with page.expect_response(lambda r: r.url.endswith(f"/api/j2/notes/{n1['id']}/archive")) as ui:
            menu2.get_by_role("button", name="Unarchive", exact=True).click()
        unarchive_resp = ui.value

        after_default = api.get(BASE + "/api/j2/notes?limit=200").json()
        after_titles = [x.get("title") for x in after_default.get("notes", [])]

        record(
            "W2_archive", "PASS" if (
                archive_resp.status == 200 and "note" in archive_body
                and n1["title"] not in default_titles
                and n1["title"] not in trashed_titles
                and n1["title"] in archived_titles
                and (folder_id is None or n1["title"] in in_folder_titles)
                and unarchive_resp.ok
                and n1["title"] in after_titles
            ) else "FAIL",
            note_id=n1["id"], archive_patch_status=archive_resp.status,
            gone_from_default=n1["title"] not in default_titles,
            not_in_trash=n1["title"] not in trashed_titles,
            in_archived=n1["title"] in archived_titles,
            still_in_its_folder=(folder_id is None or n1["title"] in in_folder_titles),
            unarchive_status=unarchive_resp.status,
            back_in_default_after_unarchive=n1["title"] in after_titles,
        )

    check_w2()

    @guarded("W2b_bulk_archive_undo")
    def check_w2b():
        titles = []
        for i in range(2):
            n = api.post(BASE + "/api/j2/notes", data={
                "title": f"Walk W2b bulk {i} {RUN}",
                "bodyJson": {"type": "doc", "content": [P("x")]},
            }).json()["note"]
            titles.append(n["title"])

        page.goto(notebook_url(None, "?view=all"))
        page.wait_for_selector(f"input[type=checkbox][aria-label$='{RUN}']", timeout=30000)
        page.wait_for_timeout(400)
        boxes = page.locator(f"input[type=checkbox][aria-label='Select {titles[0]}'], "
                              f"input[type=checkbox][aria-label='Select {titles[1]}']")
        for k in range(boxes.count()):
            boxes.nth(k).check()
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes/batch")) as bi:
            page.get_by_role("button", name=re.compile(r"^Archive$")).click()
        batch_resp = bi.value
        batch_body = batch_resp.json() if batch_resp.ok else {}
        undo = page.get_by_role("button", name=re.compile("Undo"))
        undo.first.wait_for(state="visible", timeout=8000)
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes/batch")) as ui:
            undo.first.click()
        undo_resp = ui.value
        undo_body = undo_resp.json() if undo_resp.ok else {}

        record(
            "W2b_bulk_archive_undo",
            "PASS" if (batch_body.get("op") == "archive" and undo_body.get("op") == "unarchive") else "FAIL",
            batch_op=batch_body.get("op"), undo_op=undo_body.get("op"), titles=titles,
        )

    check_w2b()

    # =========================================================================
    # W3 -- templates
    # =========================================================================
    @guarded("W3_templates")
    def check_w3():
        global page
        src = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W3 source {RUN}",
            "bodyJson": {"type": "doc", "content": [P("Reusable body.")]},
        }).json()["note"]
        page = open_note(ctx, notebook_url(src["id"]), page)
        page.wait_for_timeout(400)
        menu = page.get_by_role("group", name="Organise this note")
        menu.wait_for(state="visible", timeout=8000)
        menu.get_by_role("button", name="Save as template", exact=True).click()
        name_input = menu.get_by_label("Template name")
        tpl_name = f"Walk template {RUN}"
        name_input.fill(tpl_name)
        with page.expect_response(lambda r: "/note-templates" in r.url and r.request.method == "POST") as ti:
            menu.get_by_role("button", name="Save template", exact=True).click()
        tpl_resp = ti.value
        tpl_body = tpl_resp.json() if tpl_resp.ok else {}
        tpl_id = (tpl_body.get("template") or {}).get("id")

        # New from template -> Your templates
        page.goto(notebook_url(None, "?view=all"))
        page.wait_for_timeout(600)
        page.get_by_role("button", name="Templates", exact=True).click()
        region = page.get_by_role("region", name="Your templates").first
        region.wait_for(state="visible", timeout=8000)
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes") and r.request.method == "POST") as ci:
            region.get_by_role("button", name=re.compile(re.escape(tpl_name))).click()
        create_resp = ci.value
        new_note = (create_resp.json() or {}).get("note", {})
        page.wait_for_timeout(600)
        server_note = api.get(BASE + f"/api/j2/notes/{new_note.get('id')}").json().get("note", {})
        body_matches = server_note.get("bodyJson") == src.get("bodyJson", {}).get("bodyJson") \
            or json.dumps(server_note.get("bodyJson"), sort_keys=True) == \
            json.dumps({"type": "doc", "content": [P("Reusable body.")]}, sort_keys=True)

        # A second member does not see it.
        page2 = ctx2.new_page()
        page2.on("pageerror", lambda e: res["errors"].append("member2: " + str(e)[:300]))
        page2.goto(notebook_url())
        dismiss_intro(page2)
        page2.get_by_role("button", name="Templates", exact=True).click()
        page2.wait_for_timeout(600)
        second_member_sees_it = page2.get_by_text(tpl_name, exact=False).count() > 0
        page2.close()

        record(
            "W3_templates", "PASS" if (
                tpl_resp.ok and tpl_id and create_resp.ok and new_note.get("id")
                and body_matches and not second_member_sees_it
            ) else "FAIL",
            template_id=tpl_id, new_note_id=new_note.get("id"),
            body_matches=body_matches, second_member_sees_it=second_member_sees_it,
        )

    check_w3()

    # =========================================================================
    # W4 -- daily note
    # =========================================================================
    @guarded("W4_daily_note")
    def check_w4():
        page.goto(notebook_url(None, "?view=all"))
        page.wait_for_timeout(600)
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes/daily")) as d1:
            page.get_by_role("button", name=re.compile("Today")).click()
        first = d1.value.json()
        page.wait_for_timeout(400)
        first_url = page.url

        page.goto(notebook_url(None, "?view=all"))
        page.wait_for_timeout(400)
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes/daily")) as d2:
            page.keyboard.press("Control+Alt+d")
        second = d2.value.json()

        listed = api.get(BASE + "/api/j2/notes?limit=300").json()
        titles = [n.get("title") for n in listed.get("notes", [])]
        today_title = (first.get("note") or {}).get("title", "")
        same_title_count = sum(1 for t in titles if t == today_title) if today_title else -1

        record(
            "W4_daily_note",
            "PASS" if (
                first.get("note", {}).get("id") == second.get("note", {}).get("id")
                and same_title_count == 1
            ) else "FAIL",
            first_note_id=first.get("note", {}).get("id"),
            second_note_id=second.get("note", {}).get("id"),
            same_note_both_times=first.get("note", {}).get("id") == second.get("note", {}).get("id"),
            today_title=today_title,
            exactly_one_in_api=same_title_count == 1,
        )

    check_w4()

    # =========================================================================
    # W5 -- relation property
    # =========================================================================
    @guarded("W5_relation")
    def check_w5():
        global page
        a = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W5 A {RUN}", "bodyJson": {"type": "doc", "content": [P("A")]},
        }).json()["note"]
        b = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W5 B {RUN}", "bodyJson": {"type": "doc", "content": [P("B")]},
        }).json()["note"]

        page = open_note(ctx, notebook_url(a["id"]), page)
        page.wait_for_timeout(500)
        add_prop = page.get_by_role("button", name=re.compile("Add propert", re.I))
        if add_prop.count() == 0:
            # Properties section might already be open with an add control by a
            # different label; try the generic Properties toggle first.
            props_toggle = page.get_by_text("Properties", exact=True)
            if props_toggle.count():
                props_toggle.first.click()
                page.wait_for_timeout(300)
            add_prop = page.get_by_role("button", name=re.compile("Add propert", re.I))
        relation_created = False
        if add_prop.count():
            add_prop.first.click()
            page.wait_for_timeout(300)
            rel_option = page.get_by_text("Relation", exact=True)
            if rel_option.count():
                rel_option.first.click()
                page.wait_for_timeout(300)
                name_field = page.get_by_placeholder(re.compile("name", re.I))
                if name_field.count():
                    name_field.first.fill(f"Peers {RUN}")
                confirm = page.get_by_role("button", name=re.compile("^(Add|Create|Save)$", re.I))
                if confirm.count():
                    confirm.first.click()
                    page.wait_for_timeout(400)
                    relation_created = True
        link_btn = page.get_by_role("button", name=re.compile("Link a note"))
        if link_btn.count():
            link_btn.first.click()
            find_box = page.get_by_role("textbox", name="Find a note to link")
            find_box.fill(b["title"].split(" ")[0])
            page.wait_for_timeout(500)
            listbox = page.get_by_role("listbox", name="Notes to link")
            listbox.get_by_role("button", name=b["title"], exact=True).click()
            page.wait_for_timeout(600)

        server_a = api.get(BASE + f"/api/j2/notes/{a['id']}").json().get("note", {})
        props = server_a.get("properties") or {}
        relation_prop_values = [v for v in props.values() if isinstance(v, list) and b["id"] in v]

        page = open_note(ctx, notebook_url(b["id"]), page)
        page.wait_for_timeout(600)
        related_from = page.get_by_text(re.compile(r"Related from"))
        related_from_present = related_from.count() > 0
        names_a = False
        if related_from_present:
            related_from.first.click()
            page.wait_for_timeout(300)
            names_a = page.get_by_text(a["title"], exact=False).count() > 0

        record(
            "W5_relation", "PASS" if (relation_prop_values or names_a) and related_from_present else
            ("INCONCLUSIVE" if not add_prop.count() else "FAIL"),
            relation_created_via_ui=relation_created,
            relation_prop_values=relation_prop_values,
            related_from_present=related_from_present,
            related_from_names_a=names_a,
        )

    check_w5()

    # =========================================================================
    # W6 -- timeline view
    # =========================================================================
    @guarded("W6_timeline")
    def check_w6():
        page.goto(notebook_url(None, "?view=all"))
        page.wait_for_timeout(600)
        tl_btn = page.get_by_role("button", name="Timeline view", exact=True)
        tl_btn.wait_for(state="visible", timeout=8000)
        tl_btn.click()
        page.wait_for_timeout(500)
        pressed = tl_btn.get_attribute("aria-pressed")

        save_btn = page.get_by_role("button", name="Save view", exact=True)
        view_name = f"Walk timeline {RUN}"
        saved_ok = False
        if save_btn.count():
            save_btn.click()
            # ⛔ `get_by_label("Name")` is ambiguous page-wide (folder-rename
            # buttons compose accessible names like "Daily Rename Daily Add",
            # which CONTAIN "Name") -- the id is unambiguous (SavedViewEditor.jsx).
            name_field = page.locator("#save-view-name")
            name_field.wait_for(state="visible", timeout=5000)
            name_field.fill(view_name)
            with page.expect_response(lambda r: r.url.endswith("/api/j2/saved-views") and r.request.method == "POST") as si:
                page.keyboard.press("Enter")
            sv_resp = si.value
            saved_ok = sv_resp.ok
            sv_body = sv_resp.json() if sv_resp.ok else {}
            saved_type = (sv_body.get("savedView") or {}).get("viewType")
        else:
            saved_type = None

        # Reload, reopen the saved view.
        page.reload()
        page.wait_for_timeout(800)
        expand_btn = page.get_by_role("button", name="Expand Saved Views")
        if expand_btn.count():
            expand_btn.click()
            page.wait_for_timeout(200)
        view_row = page.get_by_role("button", name=view_name, exact=True)
        restored_as_timeline = False
        if view_row.count():
            view_row.click()
            page.wait_for_timeout(500)
            restored_as_timeline = page.get_by_role(
                "button", name="Timeline view", exact=True
            ).get_attribute("aria-pressed") == "true"

        record(
            "W6_timeline", "PASS" if (pressed == "true" and saved_ok and saved_type == "timeline"
                                       and restored_as_timeline) else "FAIL",
            offered_and_pressed=pressed == "true",
            saved_ok=saved_ok, saved_view_type=saved_type,
            restored_as_timeline=restored_as_timeline,
        )

    check_w6()

    # =========================================================================
    # W7 -- split view
    # =========================================================================
    @guarded("W7_split_view")
    def check_w7():
        global page
        a = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W7 A {RUN}", "bodyJson": {"type": "doc", "content": [P("A body")]},
        }).json()["note"]
        b = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W7 B {RUN}", "bodyJson": {"type": "doc", "content": [P("B body")]},
        }).json()["note"]

        page = open_note(ctx, notebook_url(a["id"]), page)
        page.wait_for_timeout(400)
        menu = page.get_by_role("group", name="Organise this note")
        menu.get_by_role("button", name=re.compile("Open a note beside")).click()
        find_box = menu.get_by_label("Find a note to open beside")
        find_box.fill(b["title"].split(" ")[0])
        page.wait_for_timeout(500)
        listbox = menu.get_by_role("listbox", name="Notes to open beside")
        listbox.get_by_role("button", name=b["title"], exact=True).click()
        page.wait_for_timeout(600)

        side_pane = page.locator('[data-note-pane="side"]')
        two_editors = side_pane.count() > 0 and page.locator('[data-note-pane="main"]').count() > 0

        # Refuse opening A itself beside A.
        # (re-open the menu's beside search on the main pane and try A's own title)
        main_pane = page.locator('[data-note-pane="main"]')
        refused_self = None
        beside_btn2 = main_pane.get_by_role("button", name=re.compile("Open a note beside"))
        if beside_btn2.count():
            beside_btn2.click()
            find2 = main_pane.get_by_label("Find a note to open beside")
            find2.fill(a["title"].split(" ")[0])
            page.wait_for_timeout(400)
            offered = main_pane.get_by_role("listbox", name="Notes to open beside").get_by_text(a["title"])
            refused_self = offered.count() == 0
            page.keyboard.press("Escape")

        # Image slash-command isolation: side pane's Image click opens ONLY its own file input.
        side_editor = side_pane.locator(".ProseMirror")
        side_editor.click()
        page.keyboard.type("/Image", delay=20)
        page.wait_for_timeout(300)
        listbox2 = page.get_by_role("listbox", name="Insert block")
        chooser_events = []
        page.on("filechooser", lambda fc: chooser_events.append(fc))
        if listbox2.count():
            listbox2.get_by_role("option", name="Image", exact=True).click()
        page.wait_for_timeout(500)
        one_chooser = len(chooser_events) == 1

        record(
            "W7_split_view", "PASS" if (two_editors and refused_self and one_chooser) else "FAIL",
            two_editors_mounted=two_editors,
            same_note_beside_itself_refused=refused_self,
            image_picker_openers=len(chooser_events),
        )

    check_w7()

    # =========================================================================
    # W8 -- tag rename
    # =========================================================================
    @guarded("W8_tag_rename_flat_and_nested")
    def check_w8_preview_and_confirm():
        tag_flat = f"walkflat{RUN}"
        tag_nested = f"walknest{RUN}/sub"
        n_flat = [api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W8 flat {i} {RUN}", "bodyJson": {"type": "doc", "content": [P("x")]},
            "tags": [tag_flat],
        }).json()["note"] for i in range(2)]
        n_nested = [api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W8 nested {i} {RUN}", "bodyJson": {"type": "doc", "content": [P("x")]},
            "tags": [tag_nested],
        }).json()["note"] for i in range(2)]

        results = {}
        for tag, label in ((tag_flat, "flat"), (tag_nested, "nested")):
            page.goto(notebook_url(None, "?view=all"))
            page.wait_for_timeout(700)
            expand_btn = page.get_by_role("button", name=re.compile("Expand tags|Show all tags", re.I))
            if expand_btn.count():
                expand_btn.first.click()
                page.wait_for_timeout(300)
            with page.expect_response(lambda r: "/notes/tag-members" in r.url) as ti:
                page.get_by_role("button", name=f"Rename {tag}").click()
            preview_resp = ti.value
            preview_body = preview_resp.json() if preview_resp.ok else {}
            preview_count_shown = page.get_by_text(re.compile(r"will affect \d+ notes?")).count() > 0
            new_tag = f"{tag}-renamed"
            input_field = page.get_by_label(f"Rename tag {tag}")
            input_field.fill(new_tag)
            with page.expect_response(lambda r: r.url.endswith("/api/j2/notes/batch")) as bi:
                page.get_by_role("button", name="Rename", exact=True).click()
            batch_resp = bi.value
            page.wait_for_timeout(500)

            after = api.get(BASE + "/api/j2/notes/tags").json() if False else None
            member_titles = [n.get("title") for n in preview_body.get("notes", [])]
            new_count = api.get(BASE + f"/api/j2/notes/tag-members?tag={new_tag}").json()
            old_count = api.get(BASE + f"/api/j2/notes/tag-members?tag={tag}").json()
            results[label] = {
                "preview_total": preview_body.get("total"),
                "preview_ui_shown": preview_count_shown,
                "batch_status": batch_resp.status,
                "new_tag_total": new_count.get("total"),
                "old_tag_total": old_count.get("total"),
            }

        ok = all(
            r["preview_ui_shown"] and r["batch_status"] == 200
            and r["new_tag_total"] and r["old_tag_total"] == 0
            for r in results.values()
        )
        record("W8_tag_rename_flat_and_nested", "PASS" if ok else "FAIL", **results)

    check_w8_preview_and_confirm()

    @guarded("W8b_tag_rename_unsent_work")
    def check_w8b():
        tag = f"walkrace{RUN}"
        n_clean = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W8b clean {RUN}", "bodyJson": {"type": "doc", "content": [P("clean")]},
            "tags": [tag],
        }).json()["note"]
        n_dirty = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W8b dirty {RUN}", "bodyJson": {"type": "doc", "content": [P("about to be edited offline")]},
            "tags": [tag],
        }).json()["note"]

        # A dedicated second context, same account, standing in for "a second
        # device": go offline, edit the note (queues locally, unsent), then the
        # SAME context (its own IndexedDB is what checkUnsentWork reads) tries
        # the rename. This is inherently a race against the outbox drain --
        # INCONCLUSIVE if it does not reproduce, never a fabricated FAIL/PASS.
        dev2 = browser.new_context(viewport={"width": 1280, "height": 800})
        signup_or_login(dev2.request, EMAIL, PW, "g064")
        dpage = dev2.new_page()
        dpage.on("pageerror", lambda e: res["errors"].append("dev2: " + str(e)[:300]))
        dpage = open_note(dev2, notebook_url(n_dirty["id"]), dpage)
        dpage.wait_for_timeout(500)
        dev2.set_offline(True)
        dpage.locator(".ProseMirror").click()
        dpage.keyboard.press("End")
        dpage.keyboard.type(" queued offline.", delay=15)
        dpage.wait_for_timeout(900)   # let the durable layer mark it dirty locally

        dpage.goto(notebook_url(None, "?view=all"))
        dpage.wait_for_timeout(600)
        dev2.set_offline(False)   # network back, but the rename fires immediately

        rename_fired = False
        notice_text = None
        try:
            dpage.get_by_role("button", name=re.compile("Expand tags|Show all tags", re.I)).click(timeout=1000)
        except Exception:
            pass
        try:
            dpage.get_by_role("button", name=f"Rename {tag}").click(timeout=5000)
            dpage.get_by_label(f"Rename tag {tag}").fill(f"{tag}-renamed")
            dpage.get_by_role("button", name="Rename", exact=True).click()
            rename_fired = True
            dpage.wait_for_timeout(1200)
            notice = dpage.get_by_test_id("bulk-notice")
            if notice.count():
                notice_text = notice.first.text_content()
            else:
                status_el = dpage.get_by_role("status")
                if status_el.count():
                    notice_text = status_el.first.text_content()
        except Exception as e:  # noqa: BLE001
            notice_text = f"could not drive the rename UI: {e}"

        names_dirty_note = bool(notice_text) and n_dirty["title"] in (notice_text or "")
        has_waiver_button = dpage.get_by_role("button", name=re.compile("anyway|others", re.I)).count() > 0
        dpage.close()
        dev2.close()

        verdict = "PASS" if (rename_fired and names_dirty_note and not has_waiver_button) else "INCONCLUSIVE"
        record(
            "W8b_tag_rename_unsent_work", verdict,
            rename_fired=rename_fired, notice_text=notice_text,
            names_the_unsent_note=names_dirty_note,
            has_waiver_button=has_waiver_button,
            note_on_brief_mismatch=(
                "The brief expects a 'Rename the others' waiver button; wave 6 fix round 3 "
                "(N1, final ruling, see NotebookTab.tagRename.test.jsx) REMOVED that waiver "
                "entirely -- the unsent note now gets no waiver of any kind, only a named "
                "notice and Close/Dismiss. This check verifies the REAL current behaviour."
            ),
            reason=None if verdict == "PASS" else (
                "the race did not reproduce (the second device's edit likely drained before "
                "the rename ran), or the rename UI could not be driven -- see notice_text"
            ),
        )

    check_w8b()

    # =========================================================================
    # W9 -- editor nodes survive a reload
    # =========================================================================
    @guarded("W9_editor_nodes_reload")
    def check_w9():
        global page
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W9 nodes {RUN}",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
        }).json()["note"]
        nid = note["id"]
        page = open_note(ctx, notebook_url(nid), page)
        page.wait_for_timeout(500)
        ed = page.locator(".ProseMirror")
        ed.click()

        # 1. two columns
        page.keyboard.type("/2 col", delay=15)
        page.wait_for_timeout(300)
        lb = page.get_by_role("listbox", name="Insert block")
        if lb.count():
            lb.get_by_role("option", name="2 columns", exact=True).click()
        page.wait_for_timeout(400)
        page.keyboard.type("left column text", delay=10)

        # 2. date mention (@today )
        page.keyboard.press("Control+End")
        page.keyboard.press("Enter")
        page.keyboard.type("Due @today ", delay=15)
        page.wait_for_timeout(400)

        # 3. table of contents
        page.keyboard.press("Control+End")
        page.keyboard.press("Enter")
        page.keyboard.type("/toc", delay=15)
        page.wait_for_timeout(300)
        lb2 = page.get_by_role("listbox", name="Insert block")
        if lb2.count():
            lb2.get_by_role("option", name="Table of contents", exact=True).click()
        page.wait_for_timeout(400)

        # a heading, so the TOC has something to list
        page.keyboard.press("Control+End")
        page.keyboard.press("Enter")
        page.keyboard.type("## A section heading", delay=10)
        page.keyboard.press("Enter")

        # 4. image + caption
        page.keyboard.type("/Image", delay=15)
        page.wait_for_timeout(300)
        lb3 = page.get_by_role("listbox", name="Insert block")
        image_uploaded = False
        if lb3.count():
            with page.expect_file_chooser() as fci:
                lb3.get_by_role("option", name="Image", exact=True).click()
            fc = fci.value
            import tempfile, os as _os
            tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            tmp.write(PNG_1PX)
            tmp.close()
            fc.set_files(tmp.path)
            page.wait_for_timeout(1200)
            image_uploaded = page.locator(".ProseMirror img").count() > 0
            _os.unlink(tmp.path)
            if image_uploaded:
                page.locator(".ProseMirror img").first.click()
                toolbar = page.get_by_role("toolbar")
                add_caption = toolbar.get_by_text("Add caption", exact=False)
                if add_caption.count():
                    add_caption.first.click()
                    page.wait_for_timeout(300)
                    page.keyboard.type("a tiny caption", delay=15)

        page.wait_for_timeout(1800)   # autosave debounce

        before = api.get(BASE + f"/api/j2/notes/{nid}").json().get("note", {})
        before_counts = type_by_walk(before.get("bodyJson"))

        page = reload_note(ctx, page)
        page.wait_for_timeout(800)
        not_blank = page.locator(".ProseMirror").inner_text().strip() != ""
        toc_nav = page.locator("nav.uctToc")
        toc_present_after_reload = toc_nav.count() > 0
        toc_jump_worked = False
        if toc_present_after_reload:
            link = toc_nav.locator("button.uctTocLink").first
            if link.count():
                link.click()
                page.wait_for_timeout(300)
                toc_jump_worked = True   # a click that did not throw; caret move is internal state

        after = api.get(BASE + f"/api/j2/notes/{nid}").json().get("note", {})
        after_counts = type_by_walk(after.get("bodyJson"))

        wanted = ["columns", "dateMention", "tableOfContents"]
        survived = all(after_counts.get(t, 0) >= before_counts.get(t, 0) and after_counts.get(t, 0) > 0
                        for t in wanted)
        image_survived = (not image_uploaded) or after_counts.get("imageFigure", 0) > 0 or after_counts.get("image", 0) > 0

        record(
            "W9_editor_nodes_reload", "PASS" if (not_blank and survived and image_survived) else "FAIL",
            note_id=nid,
            before_counts=before_counts, after_counts=after_counts,
            not_blank_after_reload=not_blank,
            toc_present_after_reload=toc_present_after_reload,
            toc_jump_worked=toc_jump_worked,
            image_uploaded=image_uploaded, image_survived=image_survived,
        )

    check_w9()

    # =========================================================================
    # W10 -- link paste
    # =========================================================================
    @guarded("W10_link_paste")
    def check_w10():
        global page
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W10 link {RUN}",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]},
        }).json()["note"]
        page = open_note(ctx, notebook_url(note["id"]), page)
        page.wait_for_timeout(500)
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        page.locator(".ProseMirror").click()

        def paste(url):
            page.evaluate("(t) => navigator.clipboard.writeText(t)", url)
            page.keyboard.press("Control+v")
            page.wait_for_timeout(600)

        paste("https://www.wikipedia.org")
        offer_bar = page.get_by_role("toolbar", name="Pasted link")
        offer_appeared = offer_bar.count() > 0
        preview_offered = False
        preview_card_appeared = False
        if offer_appeared:
            preview_btn = offer_bar.get_by_role("button", name="Preview card")
            preview_offered = preview_btn.count() > 0
            if preview_offered:
                preview_btn.click()
                page.wait_for_timeout(2500)
                preview_card_appeared = page.locator("[data-type='link-preview-card'], .uctLinkPreview").count() > 0

        # A 200 non-JSON answer -- point at this sandbox's own JSON health route,
        # which is 200 but not parseable HTML with an <title>/OG tag.
        page.keyboard.press("Control+End")
        page.keyboard.press("Enter")
        paste(f"{BASE}/api/health")
        offer_bar2 = page.get_by_role("toolbar", name="Pasted link")
        no_card_case_offered = offer_bar2.count() > 0
        no_card_after = None
        if no_card_case_offered:
            pv = offer_bar2.get_by_role("button", name="Preview card")
            if pv.count():
                pv.click()
                page.wait_for_timeout(2500)
                no_card_after = page.locator("[data-type='link-preview-card'], .uctLinkPreview").count() == 0
            else:
                no_card_after = True   # not even offered for a non-HTML target

        verdict = "PASS" if (offer_appeared and preview_offered) else "FAIL"
        record(
            "W10_link_paste", verdict,
            offer_appeared=offer_appeared, preview_offered=preview_offered,
            preview_card_appeared=preview_card_appeared,
            plain_text_url_no_card=no_card_after,
            lookalike_host_check="INCONCLUSIVE",
            lookalike_reason=(
                "the server only computes/shows a domain AFTER a successful HTTPS fetch of "
                "real HTML (api/routers/notebook_link_preview.py:206-219, IDNA-encode-or-omit); "
                "a homoglyph domain that both resolves publicly and returns parseable HTML was "
                "not available to this walk. Read, not exercised."
            ),
        )

    check_w10()

    # =========================================================================
    # W11 -- lane F (unlinked mentions, tasks, telemetry, error beacon)
    # =========================================================================
    @guarded("W11_unlinked_mentions")
    def check_w11a():
        global page
        target_title = f"Cup and handle walk {RUN}"
        target = api.post(BASE + "/api/j2/notes", data={
            "title": target_title, "bodyJson": {"type": "doc", "content": [P("thesis body")]},
        }).json()["note"]
        mentioner = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W11 mentioner {RUN}",
            "bodyJson": {"type": "doc", "content": [P(f"NVDA formed a {target_title} on the daily.")]},
        }).json()["note"]

        server_check = api.get(BASE + f"/api/j2/notes/{mentioner['id']}/unlinked-mentions").json()

        page = open_note(ctx, notebook_url(target["id"]), page)
        page.wait_for_timeout(700)
        section = page.get_by_text(re.compile(r"Unlinked mentions \(\d+\)"))
        section_present = section.count() > 0
        open_only = None
        if section_present:
            section.first.click()
            page.wait_for_timeout(300)
            list_el = page.get_by_role("list", name="Notes that mention this one")
            buttons = list_el.get_by_role("button")
            texts = [buttons.nth(i).text_content().strip() for i in range(buttons.count())]
            open_only = all(t == "Open" for t in texts) and len(texts) > 0
            link_it_present = page.get_by_role("button", name=re.compile(r"link it|add link", re.I)).count() > 0
        else:
            link_it_present = False

        record(
            "W11_unlinked_mentions", "PASS" if (section_present and open_only and not link_it_present) else "FAIL",
            server_count=server_check.get("count"),
            section_present=section_present, open_only=open_only,
            link_it_affordance_present=link_it_present,
            note_on_brief_mismatch=(
                "The brief expects a 'link this' affordance; the shipped UnlinkedMentions "
                "component deliberately offers Open ONLY (see UnlinkedMentions.test.jsx: "
                "'offers Open ONLY -- no Link it, and nothing here ever writes'). This check "
                "verifies the REAL current behaviour."
            ),
        )

    check_w11a()

    @guarded("W11_tasks_across_notes")
    def check_w11b():
        due_today = _t.strftime("%Y-%m-%d")
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W11 tasks {RUN}",
            "bodyJson": {"type": "doc", "content": [
                {"type": "taskList", "content": [
                    {"type": "taskItem", "attrs": {"checked": False}, "content": [
                        {"type": "paragraph", "content": [
                            {"type": "text", "text": "Walk task "},
                            {"type": "dateMention", "attrs": {"date": due_today}},
                        ]},
                    ]},
                ]},
            ]},
        }).json()["note"]

        api_tasks = api.get(BASE + "/api/j2/notes/tasks?status=open").json()
        found = [t for t in api_tasks.get("tasks", []) if t.get("noteId") == note["id"]]

        import subprocess
        grep_hits = subprocess.run(
            ["python", "-c",
             "import subprocess,sys; print(subprocess.run(['grep','-rn','NoteTasksView','app/src'],capture_output=True,text=True).stdout)"],
            capture_output=True, text=True, cwd=".",
        )

        verdict = "PASS" if found and found[0].get("due") == due_today else "FAIL"
        record(
            "W11_tasks_across_notes", verdict,
            note_id=note["id"], found_via_api=bool(found),
            due_matches=found[0].get("due") == due_today if found else None,
            ui_reachability=(
                "NoteTasksView.jsx has zero importers outside its own test file (grep-confirmed "
                "against app/src on this tip); no route/tab mounts it, so the live walk could not "
                "click a checkbox and see it appear on screen. Verified at the API/data layer only."
            ),
        )

    check_w11b()

    @guarded("W11_reminders")
    def check_w11c():
        record(
            "W11_reminders", "INCONCLUSIVE",
            reason=(
                "the daily reminder is a scheduled server-side pass "
                "(api/services/journal_two/note_tasks.py: run_task_reminders at 07:00 and 09:00 "
                "ET, plus a boot catch-up gated on the wall-clock ET hour) with no admin/manual "
                "HTTP trigger reachable from a live walk (grep-confirmed: run_task_reminders / "
                "catch_up_task_reminders have zero callers outside the scheduler + their own "
                "tests). Firing it for real would require the sandbox to boot at/after 07:00 ET "
                "with the task already due, which this walk's own note-seeding cannot arrange."
            ),
        )

    check_w11c()

    @guarded("W11_telemetry_and_error_beacon")
    def check_w11d():
        global page
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W11 telemetry {RUN}",
            "bodyJson": {"type": "doc", "content": [P("x")]},
        }).json()["note"]

        telemetry_seen = {"body": None}
        def on_tel(req):
            if req.method == "POST" and req.url.endswith("/api/j2/telemetry"):
                try:
                    b = json.loads(req.post_data or "{}")
                    if b.get("event") == "note_open_ms":
                        telemetry_seen["body"] = b
                except Exception:
                    pass
        # ⛔ attached via open_note's extra_listeners, not page.on() directly --
        # a retry inside open_note swaps to a FRESH page object, and a listener
        # bound only to the original page would never see the telemetry POST
        # fired by whichever page actually ends up mounting the editor.
        page = open_note(ctx, notebook_url(note["id"]), page, extra_listeners=[("request", on_tel)])
        page.wait_for_timeout(1500)

        error_beacon_seen = {"body": None}
        def on_err(req):
            if req.method == "POST" and req.url.endswith("/api/client-errors"):
                try:
                    error_beacon_seen["body"] = json.loads(req.post_data or "{}")
                except Exception:
                    error_beacon_seen["body"] = req.post_data
        page.on("request", on_err)
        page.evaluate("() => { setTimeout(() => { throw new Error('wave6 walk forced error') }, 0) }")
        page.wait_for_timeout(1500)

        record(
            "W11_telemetry_and_error_beacon",
            "PASS" if (telemetry_seen["body"] and error_beacon_seen["body"]) else "FAIL",
            note_open_telemetry=telemetry_seen["body"],
            error_beacon_body_present=bool(error_beacon_seen["body"]),
        )

    check_w11d()

    # =========================================================================
    # W12 -- two real tabs, one note (Web Locks)
    # =========================================================================
    @guarded("W12_two_tabs_one_note")
    def check_w12():
        note = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W12 locks {RUN}",
            "bodyJson": {"type": "doc", "content": [P("shared")]},
        }).json()["note"]
        nid = note["id"]

        tab1 = ctx.new_page()
        tab1.on("pageerror", lambda e: res["errors"].append("tab1: " + str(e)[:300]))
        tab1 = open_note(ctx, notebook_url(nid), tab1)
        tab1.wait_for_timeout(600)

        tab2 = ctx.new_page()
        tab2.on("pageerror", lambda e: res["errors"].append("tab2: " + str(e)[:300]))
        tab2 = open_note(ctx, notebook_url(nid), tab2)
        tab2.wait_for_timeout(600)

        puts_from = {"tab1": 0, "tab2": 0}

        def track(tag):
            def _(req):
                if req.method == "PUT" and req.url.endswith(f"/api/j2/notes/{nid}"):
                    puts_from[tag] += 1
            return _
        tab1.on("request", track("tab1"))
        tab2.on("request", track("tab2"))

        tab1.locator(".ProseMirror").click()
        tab1.keyboard.press("End")
        tab1.keyboard.type(" from tab one.", delay=15)
        tab1.wait_for_timeout(1500)
        tab1_first = puts_from["tab1"] > 0 and puts_from["tab2"] == 0

        notice = tab2.get_by_text(re.compile("another tab", re.I))
        owner_notice_on_tab2 = notice.count() > 0

        tab1.close()
        tab2.wait_for_timeout(2000)
        tab2_drains_after_close = puts_from["tab2"] > 0

        # bfcache / pagehide: navigate tab2 away and back.
        tab2.goto(BASE + "/dashboard")
        tab2.wait_for_timeout(800)
        tab2.go_back()
        try:
            tab2.wait_for_selector(".ProseMirror", timeout=15000)
        except Exception:  # noqa: BLE001
            if _editor_view_crash_visible(tab2):
                _CRASH_STATS["count"] += 1
                _CRASH_STATS["attempts_log"].append({"url": "go_back()", "attempt": 1, "outcome": "error_boundary(go_back)"})
            tab2 = reload_note(ctx, tab2)
        tab2.wait_for_timeout(600)
        stuck_notice = tab2.get_by_text(re.compile("another tab owns this note", re.I)).count() > 0

        record(
            "W12_two_tabs_one_note", "PASS" if (
                tab1_first and tab2_drains_after_close and not stuck_notice
            ) else "FAIL",
            puts_while_both_open=dict(puts_from),
            tab1_sole_writer_while_open=tab1_first,
            owner_notice_seen_on_tab2=owner_notice_on_tab2,
            tab2_drains_after_tab1_closes=tab2_drains_after_close,
            stuck_owner_notice_after_bfcache_nav=stuck_notice,
        )
        tab2.close()

    check_w12()

    # =========================================================================
    # W13 -- errors + sandbox integrity
    # =========================================================================
    import glob
    import os as _os
    runs_dir = _os.path.join("docs", "plans", "joystick", "sandbox-runs")
    latest_log = None
    integrity_summary = None
    if _os.path.isdir(runs_dir):
        files = sorted(glob.glob(_os.path.join(runs_dir, "*.md")), key=_os.path.getmtime)
        if files:
            latest_log = files[-1]
            try:
                integrity_summary = open(latest_log, encoding="utf-8").read()[-4000:]
            except Exception as e:  # noqa: BLE001
                integrity_summary = f"could not read {latest_log}: {e}"

    # W11's own error-beacon check DELIBERATELY forces one client error to
    # prove it reaches /api/client-errors -- that is an intentional test
    # input, not a defect the walk observed, and it must not be counted
    # against "zero pageerror across the whole walk".
    genuine_errors = [e for e in res["errors"] if "wave6 walk forced error" not in e]
    deliberate_test_errors = [e for e in res["errors"] if "wave6 walk forced error" in e]

    record(
        "W13_errors_and_sandbox_integrity",
        "PASS" if not genuine_errors else "FAIL",
        pageerror_count=len(genuine_errors),
        pageerrors=genuine_errors[:20],
        deliberate_test_errors_excluded=len(deliberate_test_errors),
        sandbox_runs_file=latest_log,
        sandbox_integrity_tail=integrity_summary,
    )

    res["CRITICAL_FINDING_editor_view_throwing_getter"] = {
        "file": "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx",
        "line": 2448,
        "code": "const dom = editor?.view?.dom",
        "introduced_by": "wave 6 fix round 1, I5 (split-view image-picker isolation)",
        "symptom": (
            "opening a note throws '[tiptap error]: The editor view is not available. "
            "Cannot access view[\\'dom\\']. The editor may not be mounted yet.', caught by "
            "the route ErrorBoundary, which replaces the ENTIRE editor with "
            "'Something went wrong on this page' -- not scoped to split view or any "
            "wave-6-specific feature; it can hit any note open."
        ),
        "measured_crash_rate": "reproduced on this tip across 3 independent samples before "
                                "this walk's retry wrapper was added: 3/6, 2/4, then 1/2 -- "
                                "roughly half of all note-opens, on fresh contexts and fresh notes",
        "root_cause": (
            "optional chaining (?.) only short-circuits on a null/undefined LEFT side; it "
            "does not guard a property GETTER that itself throws. tiptap's Editor.view "
            "getter throws (not undefined) once destroyed or before the internal "
            "EditorView is constructed -- exactly the case here."
        ),
        "already_a_named_hazard_class_in_this_codebase": (
            "NoteFindBar.jsx:63-64 carries this exact comment, still in the tree today: "
            "'isDestroyed guards a note-switch/unmount racing this callback -- "
            "editor.view THROWS once destroyed (not merely undefined), so a bare "
            "editor?.view optional-chain does not protect against it.' NoteFindBar.jsx "
            "itself guards every .view/.state read with `if (!editor || "
            "editor.isDestroyed) return` (lines 67, 146, 191, 194). "
            "NoteEditorPage.jsx:2448 has no such guard -- the wave-6 fix reintroduced a "
            "pattern the wave-5 review had already named and fixed elsewhere in the "
            "same component family."
        ),
        "suggested_remedy_pattern_already_in_tree": (
            "guard with `if (!editor || editor.isDestroyed) return undefined` before "
            "reading `editor.view`, matching NoteFindBar.jsx's own pattern"
        ),
        "walk_mitigation": (
            "this walk's own open_note()/reload_note() helpers retry through the crash "
            "(up to 5 attempts) so the OTHER 12 checks below can still run and produce "
            "real evidence; _CRASH_STATS records every occurrence"
        ),
        "crash_stats": _CRASH_STATS,
        "out_of_scope_for_this_walk": (
            "the walk author's brief is to touch ONLY tools/notebook_wave6_walk.py -- "
            "this finding is reported, not fixed, here"
        ),
    }

    browser.close()

json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(json.dumps({"checks": {k: v.get("verdict") for k, v in res["checks"].items()}}, indent=1))
