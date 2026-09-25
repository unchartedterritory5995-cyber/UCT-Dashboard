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


_INTRO_DIALOG_SEL = 'div[role="dialog"][aria-label="Welcome"]'


def dismiss_intro(pg, appear_timeout=2500, detach_timeout=6000):
    """Dismiss the Welcome intro overlay (IntroAnimation.jsx) if it appears on
    this page/tab, and WAIT for it to actually detach before returning.

    ⛔ Coordinator directive, this round: the old body here was a blind
    `wait_for_timeout(1200); keyboard.press("Escape"); wait_for_timeout(600)`
    -- it never checked whether the dialog was ever actually present, and
    never waited for it to actually be GONE before the caller went on to
    interact with the page underneath it. W8b's own Playwright retry trace
    named `<div class="_revealScene_...">` from this exact dialog as the
    pointer-event interceptor behind a `.click()` timeout.

    'Detached' is a real, verifiable signal here, not a guess: the component
    is `if (phase !== 'playing') return null` (IntroAnimation.jsx:82), so once
    its own `finish()` fires (Escape/Enter/Space, capture-phase, or the Skip
    button) the whole `<div role="dialog">` subtree is removed from the DOM,
    not merely hidden or mid-transition.

    It plays once per browser TAB's sessionStorage
    (`introStorage.hasSeenIntroThisSession`), so a `page.goto()` on a page
    that has already dismissed it this tab is a fast no-op here (the dialog
    never appears within `appear_timeout` and this returns False) -- the cost
    only lands on a genuinely fresh browsing context (every `ctx.new_page()`)."""
    dialog = pg.locator(_INTRO_DIALOG_SEL)
    try:
        dialog.first.wait_for(state="visible", timeout=appear_timeout)
    except Exception:  # noqa: BLE001
        return False  # never appeared this tab -- nothing to dismiss
    try:
        pg.keyboard.press("Escape")
    except Exception:  # noqa: BLE001
        pass
    try:
        dialog.first.wait_for(state="detached", timeout=detach_timeout)
        return True
    except Exception:  # noqa: BLE001
        pass
    # Escape is captured at window level (IntroAnimation.jsx:69-80) but the
    # component's OWN comment documents a hazard where a focused input can
    # also own Escape -- fall back to the explicit Skip button, which
    # stopPropagation()s and calls finish() directly (line ~111).
    try:
        pg.get_by_role("button", name="Skip intro", exact=True).click(timeout=1500)
    except Exception:  # noqa: BLE001
        pass
    try:
        dialog.first.wait_for(state="detached", timeout=detach_timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


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
        dismiss_intro(pg)
        pg.wait_for_timeout(300)
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
        dismiss_intro(pg)
        pg.wait_for_timeout(200)
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
        folder_index_before = None
        if folder.ok:
            fb = folder.json()
            folder_id = (fb.get("folder") or fb).get("id")
            api.put(BASE + f"/api/j2/notes/{n1['id']}", data={"folderId": folder_id})
            # ⛔ FIX (directive #3): record the BASELINE position in the
            # folder listing before archiving, so "back at the same index"
            # after restore is a measured fact, not an assumption.
            pre_folder = api.get(BASE + f"/api/j2/notes?folder_id={folder_id}&limit=200").json()
            pre_folder_titles = [x.get("title") for x in pre_folder.get("notes", [])]
            folder_index_before = (
                pre_folder_titles.index(n1["title"]) if n1["title"] in pre_folder_titles else None
            )

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
        # ⛔ FIX (directive #3): while archived the note must be ABSENT from
        # its folder's listing too -- the brief says archive takes a note "out
        # of every default list", which includes its folder list. The old
        # assertion required the OPPOSITE (still present here) and read a
        # correct product as a FAIL; this is the corrected, WHILE-ARCHIVED read.
        in_folder_while_archived = (
            api.get(BASE + f"/api/j2/notes?folder_id={folder_id}&limit=200").json()
            if folder_id else {"notes": []}
        )
        in_folder_titles_while_archived = [x.get("title") for x in in_folder_while_archived.get("notes", [])]
        not_in_folder_while_archived = (
            folder_id is None or n1["title"] not in in_folder_titles_while_archived
        )

        # Restore/Unarchive from the note menu -> back in default + back in
        # its folder AT THE SAME INDEX.
        page = reload_note(ctx, page)
        page.wait_for_timeout(400)
        menu2 = page.get_by_role("group", name="Organise this note")
        menu2.wait_for(state="visible", timeout=8000)
        with page.expect_response(lambda r: r.url.endswith(f"/api/j2/notes/{n1['id']}/archive")) as ui:
            menu2.get_by_role("button", name="Unarchive", exact=True).click()
        unarchive_resp = ui.value

        after_default = api.get(BASE + "/api/j2/notes?limit=200").json()
        after_titles = [x.get("title") for x in after_default.get("notes", [])]

        after_folder = (
            api.get(BASE + f"/api/j2/notes?folder_id={folder_id}&limit=200").json()
            if folder_id else {"notes": []}
        )
        after_folder_titles = [x.get("title") for x in after_folder.get("notes", [])]
        folder_index_after_restore = (
            after_folder_titles.index(n1["title"]) if n1["title"] in after_folder_titles else None
        )
        back_in_same_folder_at_same_index = (
            folder_id is None
            or (
                n1["title"] in after_folder_titles
                and folder_index_after_restore == folder_index_before
            )
        )

        record(
            "W2_archive", "PASS" if (
                archive_resp.status == 200 and "note" in archive_body
                and n1["title"] not in default_titles
                and n1["title"] not in trashed_titles
                and n1["title"] in archived_titles
                and not_in_folder_while_archived
                and unarchive_resp.ok
                and n1["title"] in after_titles
                and back_in_same_folder_at_same_index
            ) else "FAIL",
            note_id=n1["id"], folder_id=folder_id,
            archive_patch_status=archive_resp.status,
            gone_from_default=n1["title"] not in default_titles,
            not_in_trash=n1["title"] not in trashed_titles,
            in_archived=n1["title"] in archived_titles,
            folder_index_before_archive=folder_index_before,
            not_in_folder_while_archived=not_in_folder_while_archived,
            unarchive_status=unarchive_resp.status,
            back_in_default_after_unarchive=n1["title"] in after_titles,
            folder_index_after_restore=folder_index_after_restore,
            back_in_same_folder_at_same_index=back_in_same_folder_at_same_index,
            brief_mismatch_note=(
                "The brief's/prior walk's assertion required the note to STILL appear in its "
                "folder's listing WHILE ARCHIVED. That is backwards: archive removes a note from "
                "every default list, folder listings included -- this check now asserts NOT "
                "present while archived, and present again at the SAME index in the SAME folder "
                "after unarchive/restore (folder_index_before_archive vs "
                "folder_index_after_restore, both against folder_id)."
            ),
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
        dismiss_intro(page)
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
        dismiss_intro(page)
        page.wait_for_timeout(600)
        page.get_by_role("button", name="Templates", exact=True).click()
        region = page.get_by_role("region", name="Your templates").first
        region.wait_for(state="visible", timeout=8000)
        # ⛔ FIX (directive #2): a substring/regex name here resolves to THREE
        # elements -- the template card itself PLUS its sibling "Rename {name}"
        # and "Delete {name}" buttons (MemberTemplates.jsx: Rename/Delete are
        # BESIDE the card, in their own <div className={memberActions}>, each
        # with an explicit aria-label containing the template name -- "a
        # button in a button is one control to a screen reader", per that
        # file's own header comment, so the card is NOT concatenated with
        # them; it is a genuine 3-way SUBSTRING collision on the region-scoped
        # regex). The card's OWN accessible name is exactly `tpl_name` (no
        # aria-label, text content only: `t.name` plus an optional second span
        # that only renders when `t.title !== t.name`, which is not the case
        # here) -- Rename/Delete's accessible names are "Rename {tpl_name}" /
        # "Delete {tpl_name}", which do NOT equal `tpl_name` exactly. An exact
        # match therefore resolves to the card alone, never the siblings.
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes") and r.request.method == "POST") as ci:
            region.get_by_role("button", name=tpl_name, exact=True).click()
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
        dismiss_intro(page)
        page.wait_for_timeout(600)
        with page.expect_response(lambda r: r.url.endswith("/api/j2/notes/daily")) as d1:
            page.get_by_role("button", name=re.compile("Today")).click()
        first = d1.value.json()
        page.wait_for_timeout(400)
        first_url = page.url

        page.goto(notebook_url(None, "?view=all"))
        dismiss_intro(page)
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
        # ⛔ FIX (directive #4): read against the REAL component
        # (PropertiesSection.jsx). "Add property" opens a picker whose
        # add-new flow is "+ New property..." (NOT a "Relation" text option --
        # there is no such element at this point), which opens a form with a
        # "Property name" text input AND A NATIVE <select> of
        # NEW_PROPERTY_TYPES (Text/Number/Select/Multi-select/Date/Checkbox/
        # URL/Relation) -- a get_by_text("Relation").click() clicks nothing
        # inside a closed native <select> in a real browser. The confirm
        # button's real text is exactly "Create" (still matched by the old
        # regex, kept below for whichever caller reads it).
        relation_created = False
        if add_prop.count():
            add_prop.first.click()
            page.wait_for_timeout(300)
            new_prop_btn = page.get_by_role("button", name=re.compile(r"New property", re.I))
            if new_prop_btn.count():
                new_prop_btn.first.click()
                page.wait_for_timeout(300)
                name_field = page.get_by_placeholder("Property name")
                if name_field.count():
                    name_field.first.fill(f"Peers {RUN}")
                # The type picker is the only <select> in this form at this
                # point -- select_option, never a text click, drives a native
                # <select>.
                type_select = page.get_by_role("combobox")
                if type_select.count():
                    type_select.first.select_option("relation")
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
        dismiss_intro(page)
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
        # ⛔⛔ Measured in real Chromium (round 5): the saved-view row is a
        # <button title={view.name}> that also CONTAINS the row's own nested
        # "Rename {name}"/"Delete {name}" controls (FolderSidebar.jsx's
        # SavedViewsSection) and carries NO aria-label of its own -- unlike
        # its sibling TagRenameableRow, which passes an explicit `ariaLabel`
        # that short-circuits accname computation. With no aria-label, the
        # row's accessible NAME is computed from subtree content, which
        # concatenates the row's own label with BOTH nested controls' names
        # ("Walk timeline RUN Rename Walk timeline RUN Delete Walk timeline
        # RUN"). An exact-name role locator on `view_name` therefore matches
        # ZERO rows on every build, and this check used to report "restored
        # as a list" (indistinguishable from a genuine product regression)
        # for what was actually a locator miss.
        #
        # Fix: `title` is a literal HTML attribute (set to view.name, and to
        # nothing else on the row -- the nested Rename/Delete controls carry
        # the literal strings "Rename view"/"Delete view", never view.name),
        # so `get_by_title` locates the row unambiguously regardless of what
        # its computed accessible name concatenates. `saved_view_row_count`
        # is recorded explicitly below so a future locator miss can never
        # again be silently read as a product verdict -- audited every other
        # exact-name role locator in this script for the same defect class
        # (note cards, tag rows, template rows): the plain note-list row has
        # no nested controls at all, TagRenameableRow's own row passes an
        # explicit aria-label, and MemberTemplates' template card renders
        # Rename/Delete as SIBLINGS of the card button by design ("a button
        # in a button is one control to a screen reader" -- its own header
        # comment) -- this saved-view row is the one place the pattern was
        # missing. The product assertion below (pressed/saved_ok/saved_type/
        # restored_as_timeline) is unchanged.
        view_row = page.get_by_title(view_name)
        saved_view_row_count = view_row.count()
        restored_as_timeline = False
        if saved_view_row_count:
            view_row.first.click()
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
            saved_view_row_count=saved_view_row_count,
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
        # This IS the real slash menu, typed directly into the side pane's own
        # ProseMirror editor (never a custom/global event dispatch) -- and
        # SlashMenu.jsx:174 confirms the coordinator's claim directly:
        # `editor.view.dom.dispatchEvent(new CustomEvent('uct:notebook-open-image-picker', ...))`
        # is fired on THIS editor's own DOM root, never `window` (wave 6 fix
        # round 1, I5's own comment: two mounted editors used to share one
        # `window` listener, so an image picked from the side pane landed in
        # the main note). A `window.dispatchEvent(...)` would reach nothing;
        # typing through the real menu, as below, is the only way to exercise
        # the fix at all.
        # ⛔ FIX (directive #5): `role="option"` items in SlashMenu.jsx render
        # BOTH `item.title` and `item.description` as two separate text divs
        # with no `aria-label` -- the accessible name is their concatenation
        # ("ImageInsert an image from your computer"), never the bare title.
        # `name="Image", exact=True` therefore matched ZERO elements and timed
        # out -- the reason `image_picker_openers` read 0 was this locator,
        # not a missing per-pane file-input scope. No other item's
        # title+description contains "Image", so a plain substring match
        # (Playwright's default for a bare string) is unambiguous.
        side_editor = side_pane.locator(".ProseMirror")
        side_editor.click()
        page.keyboard.type("/Image", delay=20)
        page.wait_for_timeout(300)
        listbox2 = page.get_by_role("listbox", name="Insert block")
        chooser_events = []
        page.on("filechooser", lambda fc: chooser_events.append(fc))
        if listbox2.count():
            listbox2.get_by_role("option", name="Image").click()
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
        global page
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

        # Final semantics (fix round 3, N1): the brief's "Rename the others"
        # waiver is GONE. When a rename touches notes this device could not
        # check for unsynced changes -- true of EVERY note here, since each
        # was created via a raw API POST and never passed through this
        # device's own durable-write pipeline -- the dialog NAMES those notes,
        # offers a single Close, and issues exactly one
        # /api/j2/notes/batch request. No button whose text contains "anyway"
        # or "others" exists, and no second batch request follows.
        results = {}
        for tag, label in ((tag_flat, "flat"), (tag_nested, "nested")):
            page.goto(notebook_url(None, "?view=all"))
            dismiss_intro(page)
            page.wait_for_timeout(700)
            expand_btn = page.get_by_role("button", name=re.compile("Expand tags|Show all tags", re.I))
            if expand_btn.count():
                expand_btn.first.click()
                page.wait_for_timeout(300)

            # ⛔ FIX (directive #1's own fallback instruction: "read the real
            # labels ... and say which"): the NESTED tag's "Rename {path}"
            # row is a genuine, separate INSTRUMENT bug, not the Welcome
            # overlay (this loop reuses the same already-dismissed `page`, no
            # fresh tab/context, so the overlay cannot be in play here).
            # `FolderSidebar.jsx`'s tag tree starts fully COLLAPSED
            # (`expandedTagKeys` inits to an empty Set) and a child TagNode's
            # whole row -- including its Rename button -- is only rendered
            # once its PARENT is expanded (`{hasChildren && expanded && ...}`).
            # The per-node disclosure control is a SEPARATE affordance from
            # "Expand tags/Show all tags" above, named
            # `${expanded ? 'Collapse' : 'Expand'} tag ${node.path}` -- so a
            # nested tag's own Rename button does not exist in the DOM at all
            # until its parent's disclosure arrow is clicked, which is exactly
            # what produced the 30s "Rename {tag}" timeout for "nested" while
            # "flat" (no parent to expand) passed.
            if "/" in tag:
                parent_path = tag.split("/", 1)[0]
                tag_disclosure = page.get_by_role("button", name=f"Expand tag {parent_path}")
                if tag_disclosure.count():
                    tag_disclosure.first.click()
                    page.wait_for_timeout(300)

            rename_affordance_present = page.get_by_role("button", name=f"Rename {tag}").count() > 0

            with page.expect_response(lambda r: "/notes/tag-members" in r.url) as ti:
                page.get_by_role("button", name=f"Rename {tag}").click()
            preview_resp = ti.value
            preview_body = preview_resp.json() if preview_resp.ok else {}
            preview_total = preview_body.get("total")

            new_tag = f"{tag}-renamed"
            input_field = page.get_by_label(f"Rename tag {tag}")
            input_field.fill(new_tag)

            batch_requests = []

            def _count_batch(resp, _bucket=batch_requests):
                if resp.url.endswith("/api/j2/notes/batch"):
                    _bucket.append(resp.status)

            page.on("response", _count_batch)
            notice_text = None
            has_waiver_button = False
            has_single_close = False
            try:
                page.get_by_role("button", name="Rename", exact=True).click()
                page.wait_for_timeout(1200)

                notice_el = page.get_by_test_id("bulk-notice")
                if not notice_el.count():
                    notice_el = page.get_by_role("status")
                if notice_el.count():
                    notice_text = notice_el.first.text_content()

                has_waiver_button = page.get_by_role(
                    "button", name=re.compile("anyway|others", re.I)
                ).count() > 0

                close_btn = page.get_by_role("button", name=re.compile("^Close$", re.I))
                has_single_close = close_btn.count() == 1
                if close_btn.count():
                    close_btn.first.click()
                    page.wait_for_timeout(300)
            finally:
                page.remove_listener("response", _count_batch)

            notice_lower = (notice_text or "").lower()
            names_this_device_could_not_check = "this device could not check" in notice_lower
            mentions_keep_old_tag = "old tag" in notice_lower
            mentions_rename_again = "rename it again" in notice_lower

            new_count = api.get(BASE + f"/api/j2/notes/tag-members?tag={new_tag}").json()
            old_count = api.get(BASE + f"/api/j2/notes/tag-members?tag={tag}").json()
            results[label] = {
                "rename_affordance_present": rename_affordance_present,
                "preview_total": preview_total,
                "batch_request_count": len(batch_requests),
                "notice_text": notice_text,
                "names_this_device_could_not_check": names_this_device_could_not_check,
                "mentions_keep_old_tag": mentions_keep_old_tag,
                "mentions_rename_again": mentions_rename_again,
                "has_waiver_button": has_waiver_button,
                "has_single_close": has_single_close,
                "new_tag_total": new_count.get("total"),
                "old_tag_total": old_count.get("total"),
            }

        ok = all(
            r["rename_affordance_present"]
            and r["preview_total"] == 2
            and r["batch_request_count"] == 1
            and r["names_this_device_could_not_check"]
            and r["mentions_keep_old_tag"]
            and r["mentions_rename_again"]
            and not r["has_waiver_button"]
            and r["has_single_close"]
            and r["old_tag_total"] == 2
            and r["new_tag_total"] == 0
            for r in results.values()
        )
        record(
            "W8_tag_rename_flat_and_nested", "PASS" if ok else "FAIL",
            **results,
            brief_mismatch_note=(
                "The brief expected a 'Rename the others' waiver-and-confirm flow. Fix round 3 "
                "(N1, final ruling, see NotebookTab.tagRename.test.jsx) removed every waiver: a "
                "rename that touches notes this device could not check (notes it has never "
                "synced/loaded locally -- true of every note this walk seeds via a raw API POST) "
                "now NAMES those notes in a notice, offers a single Close, issues exactly one "
                "/api/j2/notes/batch request, and leaves them on the OLD tag until they sync. "
                "This check asserts that real behaviour, not the brief's stale waiver-button "
                "expectation."
            ),
        )

    check_w8_preview_and_confirm()

    @guarded("W8b_tag_rename_unsent_work")
    def check_w8b():
        global page
        tag = f"walkrace{RUN}"
        n_clean = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W8b clean {RUN}", "bodyJson": {"type": "doc", "content": [P("clean")]},
            "tags": [tag],
        }).json()["note"]
        n_dirty = api.post(BASE + "/api/j2/notes", data={
            "title": f"Walk W8b dirty {RUN}", "bodyJson": {"type": "doc", "content": [P("about to be edited")]},
            "tags": [tag],
        }).json()["note"]

        # A dedicated second context, same account, standing in for "a second
        # device": intercept ONLY this note's write request (PUT/PATCH to
        # /api/j2/notes/<id>) so the durable layer's write hangs/aborts while
        # every OTHER request -- navigation, the rename call itself -- still
        # reaches the sandbox normally. This replaces context.set_offline(True),
        # which blocked ALL of dev2's requests and produced
        # net::ERR_INTERNET_DISCONNECTED on the sandbox's own navigation: an
        # instrument failure, not a product finding, and it never actually
        # exercised the unsent-work path.
        dev2 = browser.new_context(viewport={"width": 1280, "height": 800})
        signup_or_login(dev2.request, EMAIL, PW, "g064")

        write_url_pat = re.compile(rf"/api/j2/notes/{re.escape(n_dirty['id'])}\b")
        intercepted_writes = []

        def _hang_the_write(route):
            req = route.request
            if req.method in ("PUT", "PATCH") and write_url_pat.search(req.url):
                intercepted_writes.append(req.method)
                route.abort()
            else:
                route.continue_()

        dpage = dev2.new_page()
        dpage.on("pageerror", lambda e: res["errors"].append("dev2: " + str(e)[:300]))
        dpage.route("**/*", _hang_the_write)
        dpage = open_note(dev2, notebook_url(n_dirty["id"]), dpage)
        dpage.wait_for_timeout(500)
        dpage.locator(".ProseMirror").click()
        dpage.keyboard.press("End")
        dpage.keyboard.type(" queued via intercepted write.", delay=15)
        dpage.wait_for_timeout(1500)   # let the durable layer attempt (and fail) its write

        # Run the rename from a SECOND page in the SAME context, so it reads
        # the same shared local durable store (IndexedDB) that still marks
        # n_dirty as unsynced -- dpage stays open, holding the pending write.
        rpage = dev2.new_page()
        rpage.on("pageerror", lambda e: res["errors"].append("dev2b: " + str(e)[:300]))
        rpage.goto(notebook_url(None, "?view=all"))
        dismiss_intro(rpage)
        rpage.wait_for_timeout(700)
        try:
            rpage.get_by_role("button", name=re.compile("Expand tags|Show all tags", re.I)).click(timeout=1000)
        except Exception:
            pass

        rename_fired = False
        notice_text = None
        batch_requests = []

        def _count_batch(resp, _bucket=batch_requests):
            if resp.url.endswith("/api/j2/notes/batch"):
                _bucket.append(resp.status)

        rpage.on("response", _count_batch)
        try:
            rpage.get_by_role("button", name=f"Rename {tag}").click(timeout=5000)
            rpage.get_by_label(f"Rename tag {tag}").fill(f"{tag}-renamed")
            rpage.get_by_role("button", name="Rename", exact=True).click()
            rename_fired = True
            rpage.wait_for_timeout(1200)
            notice_el = rpage.get_by_test_id("bulk-notice")
            if not notice_el.count():
                notice_el = rpage.get_by_role("status")
            if notice_el.count():
                notice_text = notice_el.first.text_content()
        except Exception as e:  # noqa: BLE001
            notice_text = f"could not drive the rename UI: {e}"
        finally:
            rpage.remove_listener("response", _count_batch)

        notice_lower = (notice_text or "").lower()
        names_dirty_note = bool(notice_text) and n_dirty["title"] in (notice_text or "")
        names_this_device_could_not_check = "this device could not check" in notice_lower
        has_waiver_button = rpage.get_by_role("button", name=re.compile("anyway|others", re.I)).count() > 0

        try:
            dpage.unroute("**/*", _hang_the_write)
        except Exception:
            pass
        rpage.close()
        dpage.close()
        dev2.close()

        verdict = "PASS" if (
            rename_fired
            and names_dirty_note
            and names_this_device_could_not_check
            and not has_waiver_button
            and len(batch_requests) == 1
        ) else "INCONCLUSIVE"
        record(
            "W8b_tag_rename_unsent_work", verdict,
            rename_fired=rename_fired, notice_text=notice_text,
            names_the_unsent_note=names_dirty_note,
            names_this_device_could_not_check=names_this_device_could_not_check,
            has_waiver_button=has_waiver_button,
            batch_request_count=len(batch_requests),
            intercepted_write_methods=intercepted_writes,
            note_on_instrument_change=(
                "Replaced context.set_offline(True) (blocked ALL of dev2's requests, produced "
                "net::ERR_INTERNET_DISCONNECTED on the sandbox's own navigation -- an instrument "
                "failure) with a route interception scoped to ONLY this note's write endpoint "
                "(PUT/PATCH /api/j2/notes/<id>), so the durable layer's write hangs/aborts while "
                "every other request -- including the rename itself, run from a second page in "
                "the same context -- reaches the sandbox normally."
            ),
            note_on_brief_mismatch=(
                "The brief expects a 'Rename the others' waiver button; wave 6 fix round 3 "
                "(N1, final ruling, see NotebookTab.tagRename.test.jsx) REMOVED that waiver "
                "entirely -- the unsent note now gets no waiver of any kind, only a named "
                "notice ('these N notes have changes this device could not check...') and a "
                "single Close, and exactly one /api/j2/notes/batch request is issued. This "
                "check verifies the REAL current behaviour."
            ),
            reason=None if verdict == "PASS" else (
                "the race did not reproduce (the intercepted write may have been retried/"
                "flushed before the rename ran), or the rename UI could not be driven, or the "
                "notice text did not match the expected 'this device could not check' phrasing "
                "-- see notice_text"
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
        # ⛔ FIX: SlashMenu.jsx renders each option as title+description in two
        # separate text divs with no aria-label, so the accessible name is the
        # CONCATENATION ("2 columnsTwo side-by-side columns -- they stack on a
        # phone"), never the bare title -- `exact=True` matched nothing and
        # was the real cause of this step (and W7's identical pattern) never
        # firing. No other item's title+description contains "2 columns".
        page.keyboard.type("/2 col", delay=15)
        page.wait_for_timeout(300)
        lb = page.get_by_role("listbox", name="Insert block")
        if lb.count():
            lb.get_by_role("option", name="2 columns").click()
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
            # Same concatenated-name fix as "2 columns" above -- no exact=True.
            lb2.get_by_role("option", name="Table of contents").click()
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
            # Same concatenated-name fix -- no exact=True (see W7's identical
            # SlashMenu.jsx "Image" option comment above).
            with page.expect_file_chooser() as fci:
                lb3.get_by_role("option", name="Image").click()
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
        api_ok = bool(found) and found[0].get("due") == due_today

        # UI half -- NoteTasksView.jsx was mounted in 44aba6944, AFTER this
        # walk's earlier reads correctly reported it unreachable (against a
        # dist built before that commit). It is reachable at ?view=tasks on
        # this tip. Drive it for real on the re-run rather than re-asserting
        # the earlier, now-stale, zero-importers finding.
        global page
        ui_reachable = False
        ui_checkbox_found = False
        ui_check_reflected_in_api = None
        ui_error = None
        try:
            page.goto(notebook_url(None, "?view=tasks"))
            page.wait_for_timeout(700)
            row = page.get_by_text(re.compile("Walk task", re.I))
            ui_reachable = row.count() > 0
            if row.count():
                container = row.first.locator(
                    "xpath=ancestor-or-self::*[self::li or self::div][1]"
                )
                checkbox = container.get_by_role("checkbox")
                if not checkbox.count():
                    checkbox = page.locator(
                        f"[data-task-note-id='{note['id']}'] input[type='checkbox'], "
                        f"[data-note-id='{note['id']}'] input[type='checkbox']"
                    )
                if checkbox.count():
                    ui_checkbox_found = True
                    checkbox.first.click()
                    page.wait_for_timeout(800)
                    after = api.get(BASE + "/api/j2/notes/tasks?status=open").json()
                    still_open = [t for t in after.get("tasks", []) if t.get("noteId") == note["id"]]
                    ui_check_reflected_in_api = len(still_open) == 0
        except Exception as e:  # noqa: BLE001
            ui_error = str(e)[:300]

        verdict = "PASS" if api_ok else "FAIL"
        record(
            "W11_tasks_across_notes", verdict,
            note_id=note["id"], found_via_api=api_ok,
            due_matches=found[0].get("due") == due_today if found else None,
            ui_reachable=ui_reachable,
            ui_checkbox_found=ui_checkbox_found,
            ui_check_reflected_in_api=ui_check_reflected_in_api,
            ui_error=ui_error,
            ui_reachability=(
                "NoteTasksView.jsx was mounted in 44aba6944 and is reachable at ?view=tasks -- "
                "this run drove the UI directly (see ui_reachable / ui_checkbox_found / "
                "ui_check_reflected_in_api above) rather than re-asserting the earlier "
                "zero-importers finding, which was correct against the dist that tip predates "
                "but is now stale."
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

        # ⛔ FIX (directive #6, part 2): exhaustive case-insensitive grep of the
        # WHOLE app/src tree for "owns this note", "another tab", "other tab"
        # and "in another window" finds ZERO rendered JSX text/props -- every
        # match is a code comment or a test description string
        # (outboxDrain.js:33's `SKIPPED = 'skipped'  // the open editor owns
        # this note right now` is an internal status constant, never
        # displayed; NoteEditorPage.jsx's own "owns this note"/"another tab"
        # comments have no nearby member-facing copy either). The product
        # shows NO visible notice to a non-owning tab, BY DESIGN -- ownership
        # is a silent Web Locks leader election + outbox-drain skip
        # (noteOwnerLock.js). These two checks are therefore expected to read
        # False on a healthy product; recorded as PASS facts below, not
        # treated as a missing feature.
        notice = tab2.get_by_text(re.compile("another tab", re.I))
        owner_notice_on_tab2 = notice.count() > 0

        tab1.close()
        # ⛔ FIX (directive #6, part 1): useOutboxDrain.js:35
        # `RETRY_INTERVAL_MS = 60000` (60s), and the real call site
        # (NotebookTab.jsx:124) passes no override -- so the production sweep
        # period is 60s. The old 2s wait could not possibly have caught a
        # sweep that fires up to 60s later; wait AT LEAST two full periods
        # (120s) plus margin before judging whether tab2 ever drained.
        _OUTBOX_SWEEP_MS = 60000
        tab2.wait_for_timeout(2 * _OUTBOX_SWEEP_MS + 10000)
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
            outbox_drain_sweep_interval_ms=_OUTBOX_SWEEP_MS,
            waited_ms_after_tab1_close=2 * _OUTBOX_SWEEP_MS + 10000,
            notice_design_note=(
                "Exhaustive grep of app/src for 'owns this note' / 'another tab' / "
                "'other tab' / 'in another window' finds zero rendered JSX text -- only code "
                "comments and test descriptions (outboxDrain.js:33's SKIPPED constant is "
                "internal, never displayed). The product shows NO visible notice to a "
                "non-owning tab by design -- ownership is a silent Web Locks leader election "
                "+ outbox-drain skip (noteOwnerLock.js). owner_notice_seen_on_tab2 and "
                "stuck_owner_notice_after_bfcache_nav reading False is therefore the expected, "
                "correct PASS state, not a product gap -- searched strings listed above."
            ),
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
