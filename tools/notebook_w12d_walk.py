"""Wave 12 lane 12D -- the real-browser passes the scorecard rows still owe.

NO PRODUCT CODE. This driver measures; a FAIL is a finding for the controller, never something
this lane fixes. Spec: the "12D" section of docs/notebook/WAVE-12-PLAN.md.

⛔ THIS DRIVER NEVER IMPORTS `api.*` (it would arm the app's import-time readers in the
driver's own process, pointed at whatever paths this shell has). It owns its sandbox through
the perf harness's `Sandbox` (scripts/hub_sandbox_boot.py through the SIGBREAK shim, its own
process group, stopped gracefully so the launcher writes its SHUTDOWN checkpoint) and talks to
it over HTTP. The sandbox's own SQLite files are READ (never written) to prove what a deletion
removed, which is a file read, not an import. The last row asserts no `api.*` module loaded.

PHASE 1 -- `--phase sandbox` (ports 8590-8594 only; never 8077, never under C:\\data). Run from
POWERSHELL so the data dir keeps its backslashes (single-quote it):

    python tools/notebook_w12d_walk.py --phase sandbox --data-dir '<scratch>\\w12d-data' `
        --port 8590 --out docs/notebook/evidence/w12d/sandbox-<sha> --tip <sha>

Preconditions: app/dist built from this tree; the port free (refused, never killed); the data
dir outside the shared root (refused); Tesseract installed for G-045 (`--tesseract`, default
the Windows install path). The CHILD gets `J2_OCR_ENABLED=1` + `TESSERACT_BINARY` (the
capability flag `document_ocr_tesseract.FLAG` and its binary override) and
`ACCOUNT_TOMBSTONE_LOCAL_STORE` (account_tombstones.LOCAL_STORE_ENV: the sandbox's stand-in for
the off-site bucket, a directory beside the data dir). No model key: the launcher blanks them.

  G-003  account deletion through the product, end to end
    D1  sign up through the /signup form (a fresh member, not the harness's API recipe)
    D2  write a note in the editor ("+ New note", title, body) and attach a file through the
        editor's own upload input; the stored note carries the body and the attachment chip,
        the file is on disk, and the member's j2_* rows exist (the CONTROL for D5: the checks
        that must read zero afterwards read non-zero here)
    D3  the member files the deletion request through Settings -> Danger Zone (password +
        the typed sentence) and the page says a request is on file
    D4  the owner processes it through the Admin page's user list ("Del", the confirm dialog
        accepted); the DELETE answers 200 and its own purge report says ok
    D5  afterwards: the member's session is dead, the credentials no longer sign in, the users
        row is gone, every j2_* row for that id reads 0, the attachment directory is gone --
        and the tombstone exists in account_tombstones AND in the local object store
  G-045  a scanned PDF (one full-page image, NO text layer -- checked before upload) is
        attached through the editor; OCR reads it; the sidebar search finds a word that exists
        ONLY in the image, on a row marked "Scanned text"; a word in no note finds nothing
    S0  the engine: the sandbox's startup fingerprint says `active=True` (else S1-S3 are
        NOT RUN and the row moves to phase 2)
    S1  the fixture is honest: no extractable text, exactly one image, the word not in the
        file's bytes, the note's title and body do not contain it
    S2  the document settles with its page read by OCR (pagesFromOcr >= 1)
    S3  the sidebar search finds it (a "document page" row, the "Scanned text" chip, the word
        in the snippet); the API agrees with textOrigin "ocr"; the control word finds nothing
  W_no_page_errors · W_driver_never_imported_api

PHASE 2 -- `--phase production` is REFUSED before 2026-10-02T20:30:00Z (another session samples
the production web pod until then).

Exit: 0 = every row PASS and integrity CLEAN; 1 = a row FAILED; 2 = integrity not CLEAN;
3 = refused / not run.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import secrets
import sqlite3
import sys
import time
import traceback
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)

PORTS = range(8590, 8595)
DEFAULT_TESSERACT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
PRODUCTION_NOT_BEFORE = _dt.datetime(2026, 10, 2, 20, 30, tzinfo=_dt.timezone.utc)
PW = "LocalTest2026!"
SECRET_WORD = "tourmaline"           # in the scanned image ONLY
CONTROL_WORD = "zqxjvoobleck"        # in no note, no image
SCAN_LINES = ("Quarterly memo 2026", "Segment revenue grew 14 percent",
              "The vault password is TOURMALINE", "Review again before March 31")
FONT = REPO / "api" / "services" / "desk_assets" / "DejaVuSans-Bold.ttf"


class Walk:
    def __init__(self, out: Path):
        self.out = out
        self.rows: list[dict] = []
        self.raw: dict = {}
        self.errors: list[str] = []

    def record(self, rid, ok, detail, verdict=None):
        v = verdict or ("PASS" if ok else "FAIL")
        self.rows.append({"id": rid, "verdict": v, "detail": detail})
        print(f"  {rid}: {v} -- {detail}", flush=True)

    def shot(self, pg, name):
        p = self.out / f"{name}.jpg"
        try:
            pg.screenshot(path=str(p), type="jpeg", quality=60, full_page=False)
            return p.name
        except Exception as e:  # noqa: BLE001
            return f"screenshot failed: {e}"


# ── fixtures ────────────────────────────────────────────────────────────────────────────

def _pdf_bytes(text: str) -> bytes:
    """A one-page NATIVE-text PDF (the G-003 attachment): same recipe as notebook_proof_walk."""
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"]
    stream = ("BT /F1 18 Tf 72 700 Td (%s) Tj ET" % text).encode("latin-1")
    objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = b"%PDF-1.4\n"
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1) + b"0000000000 65535 f \n" + b"".join(b"%010d 00000 n \n" % o for o in offs)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n" % (len(objs) + 1, xref) + b"%%EOF\n"
    return out


def make_scanned_pdf(path: Path) -> dict:
    """A page that is ONE full-page raster image and nothing else -- the scan class
    `document_ocr.classify_page` certifies. Returns the honesty facts, read back with pypdf."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (1700, 2200), "white")
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(str(FONT), 64)
    y = 220
    for line in SCAN_LINES:
        d.text((150, y), line, fill="black", font=font)
        y += 160
    img.save(str(path), "PDF", resolution=200.0)
    from pypdf import PdfReader
    r = PdfReader(str(path))
    page = r.pages[0]
    text = (page.extract_text() or "").strip()
    n_images = sum(1 for _ in page.images)
    blob = path.read_bytes().lower()
    return {"pages": len(r.pages), "extractable_text_chars": len(text), "images_on_page": n_images,
            "word_in_file_bytes": SECRET_WORD.encode() in blob, "bytes": len(blob)}


# ── sandbox file reads (read-only; never an import) ──────────────────────────────────────

def find_auth_db(data_dir: Path) -> Path | None:
    direct = data_dir / "auth.db"
    if direct.is_file():
        return direct
    hits = sorted(data_dir.rglob("auth.db"))
    return hits[0] if hits else None


def ro(db: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True, timeout=5)


def user_footprint(db: Path, uid: str) -> dict:
    """Every j2_* row carrying this user_id, the users row, the tombstone row."""
    out: dict = {"j2_rows": {}, "users_row": None, "tombstone": None}
    with ro(db) as c:
        tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for t in tables:
            if not t.startswith("j2_"):
                continue
            cols = [r[1] for r in c.execute(f'PRAGMA table_info("{t}")')]
            if "user_id" not in cols:
                continue
            n = c.execute(f'SELECT COUNT(*) FROM "{t}" WHERE user_id = ?', (uid,)).fetchone()[0]
            if n:
                out["j2_rows"][t] = n
        out["users_row"] = c.execute("SELECT COUNT(*) FROM users WHERE id = ?", (uid,)).fetchone()[0]
        if "account_tombstones" in tables:
            row = c.execute("SELECT user_id, deleted_at, offsite_at FROM account_tombstones WHERE user_id = ?",
                            (uid,)).fetchone()
            out["tombstone"] = list(row) if row else None
        out["j2_tables_with_user_id"] = sum(
            1 for t in tables if t.startswith("j2_")
            and "user_id" in [r[1] for r in c.execute(f'PRAGMA table_info("{t}")')])
    out["j2_total"] = sum(out["j2_rows"].values())
    return out


def attachment_dirs(data_dir: Path, uid: str) -> list[dict]:
    """Every directory named for this user under a j2_attachments tree, with its files."""
    found = []
    for root in data_dir.rglob("j2_attachments"):
        d = root / uid
        if d.is_dir():
            files = [str(p.relative_to(data_dir)) for p in d.rglob("*") if p.is_file()]
            found.append({"dir": str(d.relative_to(data_dir)), "files": files})
    return found


# ── browser helpers ─────────────────────────────────────────────────────────────────────

def note_id_from(pg, timeout_ms=20000):
    end = time.time() + timeout_ms / 1000
    while time.time() < end:
        nid = pg.evaluate("() => new URLSearchParams(location.search).get('note')")
        if nid:
            return nid
        pg.wait_for_timeout(150)
    return None


def write_note_with_attachment(pg, base, title, body, attach: Path, w: Walk, tag: str):
    """'+ New note' -> title -> body -> the editor's own upload input. -> (note id, chip seen)."""
    pg.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded")
    h._dismiss_intro(pg)
    try:
        pg.get_by_role("button", name=re.compile(r"^\+?\s*New note$")).first.click(timeout=30000)
    except Exception:
        w.shot(pg, f"{tag}-no-new-note-door")
        raise
    title_in = pg.locator('input[aria-label="Note title"]').first
    title_in.wait_for(state="visible", timeout=30000)
    nid = note_id_from(pg)
    title_in.click()
    title_in.fill(title)
    pm = pg.locator(".ProseMirror").first
    pm.wait_for(state="visible", timeout=30000)
    pm.click()
    pg.keyboard.type(body, delay=5)
    pg.keyboard.press("Enter")
    pg.locator('input[aria-label="Upload file attachment"]').first.set_input_files(str(attach))
    chip = pg.locator('.ProseMirror a[data-type="attachmentChip"]').first
    try:
        chip.wait_for(state="visible", timeout=30000)
        seen = True
    except Exception:  # noqa: BLE001 -- recorded by the caller's row
        seen = False
    w.shot(pg, f"{tag}-note-written")
    return nid, seen


def wait_note_settled(req, base, nid, must_contain: list[str], timeout_s=40):
    """The stored note, once its body carries every string in `must_contain` (the autosave
    landed). Returns the last note read either way."""
    end, last = time.time() + timeout_s, None
    while time.time() < end:
        r = req.get(f"{base}/api/j2/notes/{nid}")
        if r.status == 200:
            last = r.json().get("note")
            blob = json.dumps(last or {})
            if all(s in blob for s in must_contain):
                return last, True
        time.sleep(0.5)
    return last, False


def provision_member(admin_ctx, ctx, base, email, name):
    """The harness's recipe WITHOUT re-signing the admin: /api/auth/signup is limited to 3 a
    minute per IP (auth.py), and the admin context is already signed in."""
    r = ctx.request.post(base + "/api/auth/signup", data={"email": email, "password": PW, "display_name": name})
    if r.status not in (200, 201):
        raise h.SetupFailed(f"could not sign up {email}: HTTP {r.status}")
    c = admin_ctx.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
    v = admin_ctx.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
    if not ctx.request.get(base + "/api/auth/me").json().get("paid_equiv"):
        raise h.SetupFailed(f"{email} is not paid-equivalent (comp HTTP {c.status}, verify HTTP {v.status})")


# ── phase 1 ─────────────────────────────────────────────────────────────────────────────

def run_g003(base, br, admin_ctx, data_dir: Path, w: Walk, run: str):
    email = f"w12d-del-{run}@local.dev"
    w.raw["g003"] = g = {"email": email}
    ctx = br.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: w.errors.append(f"g003: {str(e)[:300]}"))

    # D1 -- sign up through the form
    pg.goto(base + "/signup", wait_until="domcontentloaded")
    h._dismiss_intro(pg)
    pg.get_by_label("Display Name").fill("W12D Deletion")
    pg.get_by_label("Email", exact=True).fill(email)
    pg.get_by_label("Password", exact=True).fill(PW)
    with pg.expect_response(lambda r: "/api/auth/signup" in r.url, timeout=30000) as resp:
        pg.get_by_role("button", name="Create Free Account").click()
    g["signup_status"] = resp.value.status
    me = ctx.request.get(base + "/api/auth/me")
    mej = me.json() if me.ok else {}
    uid = (mej.get("user") or mej).get("id") if isinstance(mej, dict) else None
    g["uid"] = uid
    w.shot(pg, "D1-signed-up")
    w.record("G-003.D1_signup_through_the_form", resp.value.status in (200, 201) and me.status == 200
             and bool(uid) and (mej.get("user") or mej).get("email") == email,
             f"POST /api/auth/signup {resp.value.status} from the /signup form; /api/auth/me {me.status} "
             f"names {email} (id {uid})")
    if not uid:
        return
    # the owner's comp + verify -- the Admin page's own endpoints (a member must be paid and
    # verified to open the Notebook at all; this is setup, not the row under test)
    c = admin_ctx.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
    v = admin_ctx.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
    g["comp_status"], g["verify_status"] = c.status, v.status
    paid = ctx.request.get(base + "/api/auth/me").json().get("paid_equiv")
    g["paid_equiv"] = paid
    if not paid:
        w.record("G-003.D2_note_with_attachment", False, f"setup: comp {c.status}, verify {v.status}, "
                 "member not paid-equivalent -- the Notebook would redirect")
        return

    # D2 -- a note with an attachment, through the editor
    marker = f"Deletion probe body {run}"
    att = w.out / f"w12d-attach-{run}.pdf"
    att.write_bytes(_pdf_bytes(f"Attachment for deletion {run}"))
    nid, chip = write_note_with_attachment(pg, base, f"W12D deletion probe {run}", marker, att, w, "D2")
    g["note_id"] = nid
    note, settled = wait_note_settled(ctx.request, base, nid, [marker, "attachmentChip"]) if nid else (None, False)
    on_disk = attachment_dirs(data_dir, uid)
    db = find_auth_db(data_dir)
    g["auth_db"] = str(db.relative_to(data_dir)) if db else None
    before = user_footprint(db, uid) if db else {}
    g["before"] = {"attachments": on_disk, "footprint": before}
    n_files = sum(len(d["files"]) for d in on_disk)
    ok2 = (bool(nid) and chip and settled and n_files >= 1 and before.get("users_row") == 1
           and before.get("j2_rows", {}).get("j2_notes", 0) >= 1 and before.get("tombstone") is None)
    w.record("G-003.D2_note_with_attachment", ok2,
             f"note {nid}: chip shown={chip}, stored body carries the text and the chip={settled}; "
             f"{n_files} attachment file(s) on disk under {[d['dir'] for d in on_disk]}; "
             f"j2 rows {before.get('j2_rows')}; users row {before.get('users_row')}; tombstone none="
             f"{before.get('tombstone') is None}")

    # D3 -- the member's deletion request, Settings -> Danger Zone
    pg.goto(base + "/settings?section=account", wait_until="domcontentloaded")
    h._dismiss_intro(pg)
    pg.get_by_role("button", name="Delete my account", exact=True).click(timeout=30000)
    pg.locator("#danger-reason").fill("W12D walk: proving the deletion path.")
    pg.locator("#danger-password").fill(PW)
    pg.locator("#danger-confirm").fill("delete my account")
    with pg.expect_response(lambda r: "/api/auth/request-deletion" in r.url, timeout=30000) as rq:
        pg.get_by_role("button", name="Submit deletion request").click()
    pending_text = pg.get_by_text("A deletion request is on file", exact=False)
    try:
        pending_text.first.wait_for(state="visible", timeout=15000)
        shown = True
    except Exception:  # noqa: BLE001
        shown = False
    dr = ctx.request.get(base + "/api/auth/deletion-request")
    drj = dr.json() if dr.ok else None
    g["request_deletion_status"], g["deletion_request"] = rq.value.status, drj
    w.shot(pg, "D3-deletion-requested")
    w.record("G-003.D3_member_requests_deletion", rq.value.status == 200 and shown and bool((drj or {}).get("id")),
             f"POST /api/auth/request-deletion {rq.value.status}; 'A deletion request is on file' shown={shown}; "
             f"GET /api/auth/deletion-request id={(drj or {}).get('id')}")

    # D4 -- the owner processes it on the Admin page
    apg = admin_ctx.new_page()
    apg.on("pageerror", lambda e: w.errors.append(f"admin: {str(e)[:300]}"))
    dialogs: list[str] = []

    def on_dialog(d):
        dialogs.append(d.message)
        d.accept()
    apg.on("dialog", on_dialog)
    apg.goto(base + "/admin", wait_until="domcontentloaded")
    h._dismiss_intro(apg)
    apg.get_by_label("Search users by email").fill(email)
    # the User Management row: a <tr> carrying the email AND the row's own Delete button
    # (another table on the page -- activity -- can carry the email too).
    user_rows = apg.locator("tr", has=apg.locator('button[title="Delete user"]')).filter(has_text=email)
    row = user_rows.first
    row.wait_for(state="visible", timeout=30000)
    w.shot(apg, "D4-admin-row")
    with apg.expect_response(lambda r: f"/api/auth/admin/users/{uid}" in r.url and r.request.method == "DELETE",
                             timeout=60000) as dl:
        row.locator('button[title="Delete user"]').click()
    body = {}
    try:
        body = dl.value.json()
    except Exception:  # noqa: BLE001
        pass
    g["delete_status"], g["delete_body"], g["dialogs"] = dl.value.status, body, dialogs
    try:
        apg.get_by_text("No users found", exact=True).first.wait_for(state="visible", timeout=15000)
        row_gone = user_rows.count() == 0
    except Exception:  # noqa: BLE001
        row_gone = False
    w.shot(apg, "D4-admin-after")
    purge = body.get("journal_two_purge") or {}
    w.record("G-003.D4_owner_deletes_on_the_admin_page",
             dl.value.status == 200 and body.get("deleted") is True and purge.get("ok") is True
             and any(email in m for m in dialogs) and row_gone,
             f"confirm dialog {dialogs!r} accepted; DELETE {dl.value.status}; purge ok={purge.get('ok')}, "
             f"rows {purge.get('total_rows_deleted')}, attachment dirs {purge.get('attachment_dirs_removed')}, "
             f"tombstone {purge.get('tombstone')}; the row left the list={row_gone}")

    # D5 -- what is left
    me_after = ctx.request.get(base + "/api/auth/me")
    fresh = br.new_context()
    login = fresh.request.post(base + "/api/auth/login", data={"email": email, "password": PW})
    fresh.close()
    admin_view = admin_ctx.request.get(base + f"/api/auth/admin/users/{uid}")
    after = user_footprint(db, uid) if db else {}
    on_disk_after = attachment_dirs(data_dir, uid)
    store = Path(os.environ["ACCOUNT_TOMBSTONE_LOCAL_STORE"])
    obj = store / "authdb" / "tombstones" / f"{uid}.json"
    obj_body = json.loads(obj.read_text(encoding="utf-8")) if obj.is_file() else None
    g["after"] = {"me_status": me_after.status, "login_status": login.status,
                  "admin_user_status": admin_view.status, "footprint": after,
                  "attachments": on_disk_after, "tombstone_object": str(obj.relative_to(store.parent)),
                  "tombstone_object_body": obj_body}
    tomb = after.get("tombstone")
    ok5 = (me_after.status == 401 and login.status not in (200, 201) and admin_view.status == 404
           and after.get("users_row") == 0 and after.get("j2_total") == 0 and not on_disk_after
           and bool(tomb) and tomb[0] == uid and bool(obj_body) and obj_body.get("user_id") == uid)
    w.record("G-003.D5_data_gone_tombstone_kept", ok5,
             f"/api/auth/me {me_after.status}; sign-in {login.status}; admin lookup {admin_view.status}; "
             f"users row {after.get('users_row')}; j2 rows {after.get('j2_total')} across "
             f"{after.get('j2_tables_with_user_id')} j2 tables (were {before.get('j2_total')}); attachment dirs "
             f"{len(on_disk_after)} (were {len(on_disk)}); tombstone row {tomb}; off-site object "
             f"{'present' if obj_body else 'MISSING'} {obj_body}")
    apg.close()
    ctx.close()


def run_g045(base, br, admin_ctx, sandbox_log: Path, w: Walk, run: str):
    w.raw["g045"] = g = {}
    text = sandbox_log.read_text(encoding="utf-8", errors="replace")
    fp = next((ln.strip() for ln in text.splitlines() if "[startup] j2-ocr:" in ln), None)
    g["ocr_fingerprint"] = fp
    active = bool(fp and "active=True" in fp)
    w.record("G-045.S0_engine_present", active, f"startup fingerprint: {fp!r}")
    if not active:
        for rid in ("G-045.S1_fixture_is_a_scan", "G-045.S2_ocr_read_the_page", "G-045.S3_search_finds_image_word"):
            w.record(rid, False, "the sandbox has no OCR engine -- moved to phase 2 (production)",
                     verdict="NOT-RUN")
        return
    email = f"w12d-ocr-{run}@local.dev"
    ctx = br.new_context(viewport={"width": 1280, "height": 900})
    provision_member(admin_ctx, ctx, base, email, "W12D Scan")
    g["email"] = email
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: w.errors.append(f"g045: {str(e)[:300]}"))

    scan = w.out / f"w12d-scan-{run}.pdf"
    facts = make_scanned_pdf(scan)
    title, body = f"W12D scan probe {run}", "A scanned page is attached below."
    g["fixture"] = facts
    nid, chip = write_note_with_attachment(pg, base, title, body, scan, w, "S1")
    g["note_id"] = nid
    note, settled = wait_note_settled(ctx.request, base, nid, [body, "attachmentChip"]) if nid else (None, False)
    note_blob = json.dumps(note or {}).lower()
    ok1 = (facts["pages"] == 1 and facts["extractable_text_chars"] == 0 and facts["images_on_page"] == 1
           and not facts["word_in_file_bytes"] and chip and settled and SECRET_WORD not in note_blob)
    w.record("G-045.S1_fixture_is_a_scan", ok1,
             f"{facts}; attached through the editor (chip={chip}, stored={settled}); the note's own "
             f"title/body contain {SECRET_WORD!r}={SECRET_WORD in note_blob}")

    # S2 -- the document settles, its page read by OCR
    docs, end = None, time.time() + 240
    while time.time() < end:
        r = ctx.request.get(f"{base}/api/j2/notes/{nid}/documents")
        docs = (r.json().get("documents") if r.ok else None) or []
        if docs and (docs[0].get("pagesFromOcr", 0) >= 1 or docs[0].get("pagesUnreadable", 0) >= 1
                     or docs[0].get("status") in ("failed", "no_text")):
            break
        pg.wait_for_timeout(1500)
    g["documents"] = docs
    d0 = (docs or [{}])[0]
    w.record("G-045.S2_ocr_read_the_page", d0.get("pagesFromOcr", 0) >= 1 and not d0.get("ocrUnavailable"),
             f"document {d0.get('id')} status {d0.get('status')!r}: pagesTotal {d0.get('pagesTotal')}, "
             f"pagesFromOcr {d0.get('pagesFromOcr')}, pagesAwaitingOcr {d0.get('pagesAwaitingOcr')}, "
             f"ocrUnavailable {d0.get('ocrUnavailable')}")

    # S3 -- the sidebar search finds the image-only word; the control word finds nothing
    pg.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded")
    h._dismiss_intro(pg)
    pg.get_by_role("tab", name="Search notes").first.click(timeout=30000)
    box = pg.get_by_label("Search your notes").first
    box.wait_for(state="visible", timeout=30000)
    box.fill(SECRET_WORD)
    count = pg.get_by_text(re.compile(r"^\d+ document pages?$"))
    try:
        count.first.wait_for(state="visible", timeout=20000)
        count_text = count.first.inner_text()
    except Exception:  # noqa: BLE001
        count_text = None
    rows = pg.locator("button", has=pg.get_by_text("Scanned text", exact=True))
    row_texts = rows.all_inner_texts() if count_text else []
    w.shot(pg, "S3-search-hit")
    api_hit = ctx.request.get(base + "/api/j2/notes/documents/search", params={"q": SECRET_WORD}).json()
    opened = None
    if row_texts:
        rows.first.click()
        opened = note_id_from(pg)
        w.shot(pg, "S3-hit-opened")
        pg.get_by_role("tab", name="Search notes").first.click(timeout=15000)
        box = pg.get_by_label("Search your notes").first
        box.wait_for(state="visible", timeout=15000)
    box.fill(CONTROL_WORD)
    pg.get_by_text(re.compile("No notes match")).first.wait_for(state="visible", timeout=20000)
    pg.wait_for_timeout(1500)          # the document query is debounced separately; let it answer
    ctl_count = pg.get_by_text(re.compile(r"^\d+ document pages?$")).count()
    api_ctl = ctx.request.get(base + "/api/j2/notes/documents/search", params={"q": CONTROL_WORD}).json()
    w.shot(pg, "S3-search-control")
    hits = api_hit.get("results") or []
    g["search"] = {"ui_count": count_text, "ui_rows": row_texts, "api": api_hit, "row_opened_note": opened,
                   "control_ui_count_elements": ctl_count, "control_api": api_ctl}
    # the row's own page label is "p.1" (CSS may upper-case the rendered text)
    ok3 = (bool(count_text) and any(SECRET_WORD in t.lower() and re.search(r"\bp\.\s*1(?!\d)", t.lower())
                                    for t in row_texts) and opened == nid
           and any(x.get("noteId") == nid and x.get("textOrigin") == "ocr" for x in hits)
           and ctl_count == 0 and not (api_ctl.get("results") or []))
    w.record("G-045.S3_search_finds_image_word", ok3,
             f"sidebar search {SECRET_WORD!r}: {count_text!r}, Scanned-text rows {row_texts}, the row "
             f"opened note {opened} (the scan's note {nid}); API "
             f"{[(x.get('noteId'), x.get('pageNumber'), x.get('textOrigin')) for x in hits]}; control "
             f"{CONTROL_WORD!r}: {ctl_count} UI count lines, {len(api_ctl.get('results') or [])} API results")
    ctx.close()


def phase_sandbox(args) -> int:
    data_dir = Path(args.data_dir)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port not in PORTS:
        print("REFUSED: this lane's walk uses ports 8590-8594 only")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this walk never kills it")
        return 3
    if not (REPO / "app" / "dist" / "index.html").is_file():
        print("REFUSED: app/dist is not built from this tree")
        return 3
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    store = data_dir.parent / (data_dir.name + "-tombstone-store")
    store.mkdir(parents=True, exist_ok=True)
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    # Written for the CHILD (Popen inherits it), never read here except the store path.
    os.environ.update({"J2_OCR_ENABLED": "1", "ACCOUNT_TOMBSTONE_LOCAL_STORE": str(store),
                       "ANTHROPIC_API_KEY": "", "OPENAI_API_KEY": ""})
    if args.tesseract and Path(args.tesseract).is_file():
        os.environ["TESSERACT_BINARY"] = args.tesseract
    w = Walk(out)
    run = secrets.token_hex(3)
    w.raw.update({"run": run, "tip": args.tip, "port": args.port, "tombstone_store": store.name,
                  "started_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    failure = not_run = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                br = pw.chromium.launch()
                admin_ctx = br.new_context(viewport={"width": 1280, "height": 900})
                h._signup_or_login(admin_ctx.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
                for name, fn in (("G-003", lambda: run_g003(base, br, admin_ctx, data_dir, w, run)),
                                 ("G-045", lambda: run_g045(base, br, admin_ctx, out / "sandbox.log", w, run))):
                    if args.only and name not in args.only:
                        continue
                    try:
                        fn()
                    except Exception as e:  # noqa: BLE001 -- recorded; the next row group still runs
                        w.record(f"{name}.walk_raised", False, f"{type(e).__name__}: {str(e)[:400]}")
                        w.raw.setdefault("tracebacks", {})[name] = traceback.format_exc()[-3000:]
                br.close()
        box.wait_checkpoint(h.POST_BOOT, 60)
    except h.SetupFailed as e:
        not_run = str(e)[:300]
    except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
        failure = f"the walk raised {type(e).__name__}: {str(e)[:400]}"
        w.raw["traceback"] = traceback.format_exc()[-3000:]
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run), flush=True)
    w.raw["page_errors"] = w.errors
    w.record("W_no_page_errors", not w.errors, f"{len(w.errors)} unforced page errors"
             + (f": {w.errors[:3]}" if w.errors else ""))
    return finish(w, out, "sandbox", base, integ, failure, not_run)


def finish(w: Walk, out: Path, phase: str, base: str, integ, failure, not_run) -> int:
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    w.record("W_driver_never_imported_api", not api_mods,
             "no api.* module in the driver's sys.modules" if not api_mods else f"imported: {api_mods[:5]}")
    result = {"tool": "tools/notebook_w12d_walk.py", "phase": phase, "base": base, "integrity": integ,
              "failure": failure, "not_run": not_run, "rows": w.rows, "raw": w.raw,
              "finished_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")}
    (out / "walk.json").write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT: FAIL -- {failure}")
        return 1
    bad = [r["id"] for r in w.rows if r["verdict"] == "FAIL"]
    if bad:
        print("VERDICT: FAIL -- " + ", ".join(bad))
        return 1
    if integ is not None and not integ["clean"]:
        print(f"VERDICT: INTEGRITY {integ['status']}")
        return 2
    print(f"VERDICT: PASS -- {len(w.rows)} rows"
          + (f" ({sum(r['verdict'] == 'NOT-RUN' for r in w.rows)} NOT-RUN)" if any(
              r['verdict'] == 'NOT-RUN' for r in w.rows) else ""))
    return 0


def phase_production(args) -> int:
    now = _dt.datetime.now(_dt.timezone.utc)
    if now < PRODUCTION_NOT_BEFORE:
        print(f"REFUSED: production phase opens at {PRODUCTION_NOT_BEFORE.isoformat()}; it is {now.isoformat()}")
        return 3
    print("REFUSED: the production phase is not built in this revision of the driver")
    return 3


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--phase", choices=("sandbox", "production"), required=True)
    ap.add_argument("--data-dir")
    ap.add_argument("--port", type=int, default=8590)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tip", default=None)
    ap.add_argument("--tesseract", default=DEFAULT_TESSERACT)
    ap.add_argument("--only", nargs="*", default=None, help="row groups, e.g. G-003 G-045")
    args = ap.parse_args(argv)
    if args.phase == "sandbox":
        if not args.data_dir:
            print("REFUSED: --data-dir is required for the sandbox phase")
            return 3
        return phase_sandbox(args)
    return phase_production(args)


if __name__ == "__main__":
    sys.exit(main())
