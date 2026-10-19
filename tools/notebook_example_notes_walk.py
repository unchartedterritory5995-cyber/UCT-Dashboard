"""Notebook P3b (example notes for the community style library), Task 8 -- one real-browser walk of an example note's
whole story, the way an author, an admin and a second member meet it, read off the RENDERED pages.

Modelled on tools/notebook_style_library_walk.py (P3a's walk): its sandbox boot, census pins, C:\\data snapshot
checkpoints, PASS/FAIL/INCONCLUSIVE, per-viewport stories and raw output.

PRECONDITIONS (the run refuses or records NOT RUN without each; it never assumes one):
  * a sandbox booted from the tip under test, through scripts/hub_sandbox_boot.py (this tool boots its own via
    notebook_perf_harness.Sandbox, on an EMPTY data dir outside C:\\data, on a free port that is NOT 8077 -- the hub
    sandbox owns 8077; it refuses a busy port and never kills another process);
  * `app/dist` rebuilt from that tip (`cd app && npm run build`) -- the sandbox serves the built bundle;
  * NOTEBOOK_STYLE_LIBRARY_ENABLED=1 AND NOTEBOOK_EXAMPLE_NOTES_ENABLED=1 (with the gallery and journal styles,
    NOTEBOOK_TEMPLATE_GALLERY_ENABLED=1 and NOTEBOOK_JOURNAL_STYLES_ENABLED=1) in the sandbox env, on top of the flags
    the ledger records as armed on web (notebook_fin_walk.flag_sets()["c1"]); this tool sets them in its own
    environment, which the sandbox inherits;
  * TWO paid walk accounts on that data dir (the author and a second member), created here the way P3a's walk makes
    them: signed up through the app, then comped and email-verified by the admin through the app's own admin routes,
    and /api/auth/me must say paid-equivalent;
  * an ADMIN account through ADMIN_EMAILS: the launcher's default (notebook_perf_harness.ADMIN_EMAIL), promoted at
    sign-in.
  The accounts and their password are this tool's SANDBOX SEED (below, as every Notebook walk keeps them); they exist
  only in the throwaway data dir and are never printed.

THE STORY, once per viewport (1280, 820, 390), each with its own uniquely named style and note:
  1. the author writes a trade plan note containing "made $1,240 at Schwab", a position sizing block with an account
     size, and one pasted image (made through the routes the editor uses; then opened in the editor and read);
  2. the author shares the note's style (P3a's flow: Styles manager > "Share to community") and, from that style's
     Share form, adds the note as an example ("Add an example note" > the picker > the note);
  3. the preview sheet: its counts sentence, the replaced spans in place, and the image OFF;
  4. the author switches the image on through the second confirm, and submits for review;
  5. the admin approves the style and the example in the review queue (the example row names its style; its Preview
     shows the reduced body and the image);
  6. the second member opens the style's Preview: "In use" shows "your value here" and "your broker", and the image
     loads (the rendered <img>, and the route answering 200 with an image);
  7. the author withdraws the style (Your submissions > Unpublish); the image URL now answers 404.

--break unapproved-example is the DELIBERATELY BROKEN run: step 5 leaves the example unapproved, so step 6's "In use"
reads absent and the walk must say FAIL (never PASS, never only INCONCLUSIVE). It proves this walk can go red.

Every step records PASS, FAIL or INCONCLUSIVE with the rendered text it read. PASS needs every check to have read the
product's answer and found it right; FAIL is a product answer that was wrong; INCONCLUSIVE is a step the driver could
not read to its end (a timeout, an element that never came). INCONCLUSIVE is never a pass. R-RAW: walk.json is
rewritten after every step, before any verdict.

Usage (PowerShell, data dir single-quoted):
    python tools/notebook_example_notes_walk.py --data-dir 'C:\\data-p3bwalk' --port 8091 `
        --tip <sha> --out docs/notebook/evidence/p3b-walk-<UTC timestamp>

This driver never imports api.* in its own process. Never run on import.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import traceback
import zlib
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
for _p in (REPO / "tools", REPO / "scripts"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import notebook_perf_harness as h  # noqa: E402
import notebook_fin_walk as fw  # noqa: E402  -- flag_sets, settle_first_run, BENIGN, VIEWPORTS

VIEWPORTS = fw.VIEWPORTS
LIBRARY_FLAGS = ["NOTEBOOK_TEMPLATE_GALLERY_ENABLED", "NOTEBOOK_JOURNAL_STYLES_ENABLED", "NOTEBOOK_STYLE_LIBRARY_ENABLED"]
HUB_PORT = 8077     # the hub sandbox owns it (CLAUDE.md); this walk refuses it
STEPS_PER_VIEWPORT = 7
# Step 4 expects "the image was never read", which holds only while OCR is dark. The flag is not a NOTEBOOK_ name, so
# fs["all_names"] never pops it: without this, a box with J2_OCR_ENABLED set and an engine installed reads the image.
OCR_FLAG = "J2_OCR_ENABLED"
# Sandbox seed (throwaway data dir only; the walk tools' shared sandbox password).
AUTHOR = ("p3bwalk-author@local.dev", "LocalTest2026!", "P3b Author")
MEMBER = ("p3bwalk-member@local.dev", "LocalTest2026!", "P3b Member")
T = 30000
BREAKS = ("unapproved-example",)
BREAK: str | None = None

REC: dict = {"tool": "tools/notebook_example_notes_walk.py", "steps": [], "setup": []}
OUT: Path | None = None


# ── words read from the source, never typed ───────────────────────────────────────────────

def _const(rel: str, name: str) -> str:
    src = (REPO / rel).read_text(encoding="utf-8")
    m = re.search(r"(?:export const|^)\s*" + re.escape(name) + r"\s*=\s*(['\"])(.*?)\1", src, re.M)
    if not m:
        raise SystemExit(f"REFUSED: could not read {name} from {rel}")
    return m.group(2)


STY = "app/src/pages/journal-2-0/components/notebook/styles"
GAL_PY = "api/services/journal_two/template_gallery.py"
#: The server-only example switch (R-P3b-6: no auth-payload row), read from template_gallery.py, never typed twice.
EXAMPLE_FLAG = _const(GAL_PY, "EXAMPLE_FLAG")
SENT = _const(f"{STY}/ShareStyleForm.jsx", "SENT_SENTENCE")
ADD_EXAMPLE = _const(f"{STY}/AddExampleNoteDoor.jsx", "ADD_EXAMPLE_LABEL")
PICKER_TITLE = _const(f"{STY}/ExampleNotePicker.jsx", "PICKER_TITLE")
PREVIEW_TITLE = _const(f"{STY}/ExamplePreviewSheet.jsx", "PREVIEW_TITLE")
SHARE_IMAGE = _const(f"{STY}/ExamplePreviewSheet.jsx", "SHARE_IMAGE_LABEL")
CONFIRM = _const(f"{STY}/ExamplePreviewSheet.jsx", "CONFIRM_SENTENCE")
EXAMPLE_SENT = _const(f"{STY}/ExamplePreviewSheet.jsx", "EXAMPLE_SENT_SENTENCE")
IN_USE = _const(f"{STY}/ExamplesInUse.jsx", "IN_USE_HEADING")
# The words the reducer puts in place, read from example_sanitize.py's own constants.
VALUE_HERE = _const("api/services/journal_two/example_sanitize.py", "VALUE_TEXT")
YOUR_BROKER = _const("api/services/journal_two/example_sanitize.py", "BROKER_TEXT")

# The note's words (step 1). The raw values must never reach anything another member reads.
MONEY = "$1,240"
BROKER = "Schwab"
ACCOUNT_SIZE = 25000


# ── recorder ──────────────────────────────────────────────────────────────────────────────

def flush() -> None:
    if OUT is not None:
        tmp = OUT / "walk.json.tmp"
        tmp.write_text(json.dumps(REC, indent=1, ensure_ascii=False, default=str), encoding="utf-8", newline="\n")
        os.replace(tmp, OUT / "walk.json")


class Watch:
    """Console errors, page errors and every response >= 400 one page saw, per step."""

    def __init__(self, pg):
        self.events: list[dict] = []
        pg.on("console", lambda m: m.type == "error" and self.events.append({"console": m.text[:300]}))
        pg.on("pageerror", lambda e: self.events.append({"pageerror": str(e)[:300]}))
        pg.on("response", lambda r: r.status >= 400 and not any(b in r.url for b in fw.BENIGN)
              and self.events.append({"http": r.status, "url": r.url[:200]}))

    def take(self) -> list[dict]:
        out, self.events = self.events, []
        return out


class Step:
    def __init__(self, vp: str, n: int, title: str):
        self.row = {"viewport": vp, "step": n, "title": title, "checks": [], "rendered": [], "verdict": None}

    def read(self, what: str, text: str) -> str:
        self.row["rendered"].append({"what": what, "text": (text or "").strip()[:1500]})
        return text or ""

    def check(self, what: str, ok: bool, read: str) -> bool:
        self.row["checks"].append({"what": what, "ok": bool(ok), "read": (read or "")[:600]})
        return ok

    def must(self, what: str, ok: bool, read: str) -> None:
        """A check the rest of the step cannot go on without: recorded, then (when false) the step stops as FAIL."""
        if not self.check(what, ok, read):
            raise AssertionError(f"stopped: {what}")


def run_step(vp: str, n: int, title: str, fn, pages: dict) -> dict:
    st = Step(vp, n, title)
    try:
        fn(st)
        checks = st.row["checks"]
        st.row["verdict"] = "PASS" if checks and all(c["ok"] for c in checks) else "FAIL"
    except Exception as e:  # noqa: BLE001 -- a read the driver could not finish
        failed = [c for c in st.row["checks"] if not c["ok"]]
        st.row["verdict"] = "FAIL" if failed else "INCONCLUSIVE"
        st.row["error"] = f"{type(e).__name__}: {str(e)[:500]}"
        st.row["traceback"] = traceback.format_exc()[-1500:]
    for role, (pg, watch) in pages.items():
        st.row.setdefault("events", {})[role] = watch.take()
        try:
            shot = OUT / vp / f"step{n}-{role}.jpg"
            shot.parent.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(shot), type="jpeg", quality=55)
        except Exception:  # noqa: BLE001
            pass
        if st.row["verdict"] != "PASS":
            try:
                st.row.setdefault("page_text", {})[role] = pg.locator("body").inner_text(timeout=3000)[:2500]
            except Exception:  # noqa: BLE001
                pass
    REC["steps"].append(st.row)
    flush()
    print(f"[{vp}] step {n} {st.row['verdict']}: {title}", flush=True)
    return st.row


# ── accounts and pages ────────────────────────────────────────────────────────────────────

#: Each account's signed-in cookies, taken ONCE at provisioning and reused by every story's context. Run
#: p3b-walk-20261018T120827Z signed in afresh per context per viewport and the app's sign-in limiter answered 429 at
#: the second story (NOT RUN); a member does not sign in again to open a second tab either.
STATES: dict[str, dict] = {}


def new_ctx(browser, vp: str, email: str | None = None):
    wd, ht = VIEWPORTS[vp]
    touch = wd <= fw.TOUCH_MAX
    extra = {"storage_state": STATES[email]} if email else {}
    return browser.new_context(viewport={"width": wd, "height": ht}, has_touch=touch, is_mobile=touch,
                               reduced_motion="reduce", **extra)


def provision(browser, base: str) -> None:
    """Sign up the admin (promoted from ADMIN_EMAILS) and the two walk accounts; comp and verify them."""
    admin = browser.new_context()
    try:
        h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        for email, pw, name in (AUTHOR, MEMBER):
            c = browser.new_context()
            try:
                h._signup_or_login(c.request, base, email, pw, name)
                comp = admin.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
                ver = admin.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
                me = c.request.get(base + "/api/auth/me").json()
                STATES[email] = c.storage_state()
                REC["setup"].append({"account": name, "comp": comp.status, "verify": ver.status,
                                     "paid_equiv": bool(me.get("paid_equiv")),
                                     "role": me.get("role") or (me.get("user") or {}).get("role")})
                if not me.get("paid_equiv"):
                    raise h.SetupFailed(f"{name} is not paid-equivalent (comp {comp.status}, verify {ver.status})")
            finally:
                c.close()
        STATES[h.ADMIN_EMAIL] = admin.storage_state()
        me = admin.request.get(base + "/api/auth/me").json()
        role = me.get("role") or (me.get("user") or {}).get("role")
        REC["setup"].append({"account": "admin (ADMIN_EMAILS)", "role": role, "paid_equiv": bool(me.get("paid_equiv"))})
        if role != "admin":
            raise h.SetupFailed("the sandbox admin did not sign in as an admin")
    finally:
        admin.close()
    flush()


def signed_in(browser, base: str, vp: str, who) -> tuple:
    ctx = new_ctx(browser, vp, who[0])
    pg = ctx.new_page()
    watch = Watch(pg)
    pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(pg)
    fw.settle_first_run(pg)
    return ctx, pg, watch


def open_styles(pg, base: str):
    pg.goto(base + "/journal/notebook?styles=1", wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(pg)
    dlg = pg.get_by_role("dialog", name="Journal styles")
    dlg.wait_for(timeout=T)
    return dlg


def open_library(pg, base: str):
    dlg = open_styles(pg, base)
    dlg.get_by_role("button", name="Community", exact=True).click(timeout=T)
    lib = pg.get_by_role("dialog", name="Community styles")
    lib.wait_for(timeout=T)
    lib.get_by_role("heading", name="Community gallery").wait_for(timeout=T)
    return lib


def gallery_message(lib, exact: str) -> str:
    msg = lib.locator("[data-gallery-message]").filter(has_text=exact)
    msg.wait_for(timeout=T)
    return msg.inner_text()


def doc(*paras: str) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paras]}


def walk_nodes(d):
    if isinstance(d, dict):
        yield d
        for c in d.get("content") or []:
            yield from walk_nodes(c)


def png_bytes(w: int = 96, ht: int = 64) -> bytes:
    """A real PNG (a small two-tone chart-like picture), so the browser can decode it and naturalWidth is real."""
    rows = []
    for y in range(ht):
        row = bytearray([0])
        for x in range(w):
            on = (y > ht - 1 - (x * ht) // w)        # a rising line's area
            row += bytes((40, 160, 90) if on else (18, 22, 30))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, ht, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def letters(s: str) -> str:
    """Digits as letters, so a note title carries no number the reducer could read as an amount or an account."""
    return "".join("abcdefghij"[int(c)] if c.isdigit() else c for c in s)


IMG_LOADED_JS = "(el) => !!el && el.complete && el.naturalWidth > 0"


# ── the story ─────────────────────────────────────────────────────────────────────────────

def story(browser, base: str, vp: str, run: str) -> None:
    word = {"1280": "desk", "820": "tablet", "390": "phone"}.get(vp, letters(vp))
    name = f"P3b walk {vp} {run}"                          # the style (P3a's naming)
    note_title = f"Trade plan {word} {letters(run)}"       # the note (and the example's title)
    S: dict = {"style_name": name, "note_title": note_title}
    REC.setdefault("stories", {})[vp] = S
    actx, apg, aw = signed_in(browser, base, vp, AUTHOR)
    mctx, mpg, mw = signed_in(browser, base, vp, MEMBER)
    dctx = new_ctx(browser, vp, h.ADMIN_EMAIL)
    dpg = dctx.new_page()
    dw = Watch(dpg)
    dpg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(dpg)
    fw.settle_first_run(dpg)
    pages = {"author": (apg, aw), "member": (mpg, mw), "admin": (dpg, dw)}
    sheet_box: dict = {}

    def s1(st):
        # The style the note is written in: a trade plan with a position sizing block (the journal styles route, as
        # the editor's Save sends it).
        r = actx.request.post(base + "/api/j2/journal-styles", data={
            "name": name, "kindId": "trade_plan",
            "blocks": [{"block": "positionSizing", "enabled": True, "settings": {}}],
            "outlineBodyJson": doc("Author outline: the plan, the size, the stop."), "properties": {}})
        st.must("the style was created (HTTP 200)", r.status == 200, f"HTTP {r.status} {r.text()[:200]}")
        S["style_id"] = r.json()["style"]["id"]
        # A new note FROM the style (POST /api/j2/notes {styleId}: body, kind and blocks in one insert).
        r = actx.request.post(base + "/api/j2/notes", data={"styleId": S["style_id"], "title": note_title})
        st.must("a note was made from the style (HTTP 200)", r.status in (200, 201), f"HTTP {r.status} {r.text()[:200]}")
        note = r.json()["note"]
        S["note_id"] = note["id"]
        kind = (note.get("propertiesJson") or {}).get("builtin:note_kind")
        st.check("the note is a trade plan (its kind, as stamped)", kind == "trade_plan", f"builtin:note_kind={kind}")
        block = next((n for n in walk_nodes(note.get("bodyJson")) if n.get("type") == "widgetEmbed"
                      and (n.get("attrs") or {}).get("widgetId") == "positionSizing"), None)
        st.must("the style put a position sizing block in the note", block is not None,
                json.dumps([n.get("type") for n in (note.get("bodyJson") or {}).get("content") or []]))
        # One pasted image: the editor's own paste door (POST /notes/{id}/images, the inline kind).
        up = actx.request.post(base + f"/api/j2/notes/{S['note_id']}/images",
                               multipart={"file": {"name": "chart.png", "mimeType": "image/png", "buffer": png_bytes()}})
        st.must("the pasted image was uploaded (HTTP 200)", up.status == 200, f"HTTP {up.status} {up.text()[:200]}")
        S["attachment_url"] = up.json()["url"]
        # The body the member typed: the amount and the broker in a sentence, the block with an account size, the image.
        block["attrs"]["params"] = {**(block["attrs"].get("params") or {}), "accountSize": ACCOUNT_SIZE}
        body = {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text":
                f"Last week I made {MONEY} at {BROKER} on NVDA. Watching 132.40 for the entry."}]},
            block,
            {"type": "image", "attrs": {"src": S["attachment_url"], "alt": "NVDA daily chart"}},
        ]}
        put = actx.request.put(base + f"/api/j2/notes/{S['note_id']}",
                               data={"bodyJson": body, "baseUpdatedAt": note.get("updatedAt")})
        st.must("the note was saved (HTTP 200)", put.status == 200, f"HTTP {put.status} {put.text()[:200]}")
        # Read it back as the editor shows it.
        apg.goto(base + f"/journal/notebook?note={S['note_id']}", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(apg)
        pm = apg.locator(".ProseMirror").filter(has_text=f"made {MONEY} at {BROKER}")
        pm.first.wait_for(timeout=T)
        text = st.read("the note in the editor", pm.first.inner_text())
        st.check('the editor shows "made $1,240 at Schwab"', f"made {MONEY} at {BROKER}" in text, text[:300])
        img = pm.first.locator(f'img[src="{S["attachment_url"]}"]')
        img.first.wait_for(timeout=T)
        apg.wait_for_function(f"() => {{ const i = document.querySelector('.ProseMirror img[src=\"{S['attachment_url']}\"]');"
                              " return !!i && i.complete && i.naturalWidth > 0 }", timeout=T)
        st.check("the pasted image shows in the editor", True, S["attachment_url"])
        saved = actx.request.get(base + f"/api/j2/notes/{S['note_id']}").json().get("note") or {}
        sb = next((n for n in walk_nodes(saved.get("bodyJson")) if n.get("type") == "widgetEmbed"
                   and (n.get("attrs") or {}).get("widgetId") == "positionSizing"), {})
        st.check("the position sizing block holds the account size (the note read)",
                 (sb.get("attrs") or {}).get("params", {}).get("accountSize") == ACCOUNT_SIZE,
                 json.dumps((sb.get("attrs") or {}).get("params")))

    def share_form():
        dlg = open_styles(apg, base)
        dlg.get_by_role("button", name=f"Share {name} to community").click(timeout=T)
        form = apg.get_by_role("form", name=f"Share {name} to community")
        form.wait_for(timeout=T)
        return dlg, form

    def s2(st):
        dlg, form = share_form()
        form.get_by_label("Title in the library").fill(name)
        form.get_by_label("Category").select_option("trade_plan")
        form.get_by_label("Trading style (optional)").select_option("swing")
        with apg.expect_response(lambda r: r.url.endswith("/api/j2/template-gallery/styles") and r.request.method == "POST",
                                 timeout=T) as resp:
            form.get_by_role("button", name="Submit").click(timeout=T)
        S["gid"] = ((resp.value.json() or {}).get("template") or {}).get("id")
        st.must("the share was recorded (HTTP 200)", resp.value.status == 200 and bool(S["gid"]), f"HTTP {resp.value.status}")
        status = dlg.get_by_text(SENT, exact=True)
        status.wait_for(timeout=T)
        st.check("the Styles manager says the style was shared", True, st.read("status line", status.inner_text()))
        # The style is in the library now, so its Share form carries the door (P3b-T5-R5: on the next open). The door
        # sits in the form's SHEET, below the <form> itself (ShareStyleForm.jsx), so it is looked for in the sheet.
        dlg, form = share_form()
        door = apg.get_by_role("dialog", name=f"Share {name} to community").get_by_role("button", name=ADD_EXAMPLE, exact=True)
        door.wait_for(timeout=T)
        st.check(f'the Share form offers "{ADD_EXAMPLE}"', True, st.read("door", door.inner_text()))
        door.click(timeout=T)
        picker = apg.get_by_role("dialog", name=PICKER_TITLE)
        picker.wait_for(timeout=T)
        row = picker.locator(f'[data-example-note="{S["note_id"]}"]')
        row.wait_for(timeout=T)
        st.check("the picker lists the trade plan note", note_title in st.read("picker row", row.inner_text()),
                 row.get_attribute("aria-label") or "")
        row.click(timeout=T)
        sheet = apg.get_by_role("dialog", name=PREVIEW_TITLE)
        sheet.wait_for(timeout=T)
        st.check("the preview sheet opened for the note", True, PREVIEW_TITLE)
        sheet_box["sheet"] = sheet

    def s3(st):
        sheet = sheet_box["sheet"]
        summary = sheet.locator("p[role=status]").filter(has_text="Here is exactly what other members will see.")
        summary.first.wait_for(timeout=T)
        line = st.read("counts sentence", summary.first.inner_text())
        st.check("the counts sentence names the amount", re.search(r"\b1 amount\b", line) is not None, line)
        st.check("the counts sentence names the broker name", re.search(r"\b1 broker name\b", line) is not None, line)
        st.check("the counts sentence names the reset block", re.search(r"\b1 block\b", line) is not None, line)
        st.check("the counts sentence says the image was left out", re.search(r"\b1 image was left out\b", line) is not None, line)
        frame = sheet.get_by_role("region", name="What other members will see")
        frame.wait_for(timeout=T)
        apg.wait_for_function("(el) => el.querySelectorAll('[data-replaced]').length >= 2", arg=frame.element_handle(),
                              timeout=T)
        spans = frame.locator("[data-replaced]")
        marked = [{"kind": spans.nth(i).get_attribute("data-replaced"),
                   "text": spans.nth(i).evaluate("(el) => el.firstChild ? el.firstChild.textContent : ''")}
                  for i in range(spans.count())]
        st.read("replaced spans", json.dumps(marked))
        st.check(f'the amount reads "{VALUE_HERE}", marked as money',
                 {"kind": "money", "text": VALUE_HERE} in marked, json.dumps(marked))
        st.check(f'the broker reads "{YOUR_BROKER}", marked as broker',
                 {"kind": "broker", "text": YOUR_BROKER} in marked, json.dumps(marked))
        body = st.read("the body members will see", frame.inner_text())
        st.check("the author's amount and broker are not in the body", MONEY not in body and BROKER not in body, body[:400])
        st.check("the body shows no image while it is off", frame.locator("img").count() == 0,
                 f"{frame.locator('img').count()} img")
        row = sheet.locator(f'[data-example-image="{S["attachment_url"]}"]')
        row.wait_for(timeout=T)
        sw = row.get_by_role("switch", name=SHARE_IMAGE)
        st.read("image row", row.inner_text())
        st.check("the image's switch is off", sw.get_attribute("aria-checked") == "false",
                 f"aria-checked={sw.get_attribute('aria-checked')}")
        sheet_box["row"], sheet_box["switch"] = row, sw

    def s4(st):
        sheet, row, sw = sheet_box["sheet"], sheet_box["row"], sheet_box["switch"]
        # What the server says about the image, raw (the preview writes nothing): the OCR state the sheet decides from.
        raw = actx.request.post(base + "/api/j2/template-gallery/examples/preview",
                                data={"noteId": S["note_id"], "imagesOn": []})
        imgs = (raw.json() or {}).get("images") if raw.status == 200 else None
        st.read("the preview's image states (raw)", json.dumps(imgs))
        ocr_line = st.read("the OCR line under the image", row.inner_text())
        sw.click(timeout=T)
        ask = row.get_by_role("group", name=CONFIRM)
        try:
            ask.wait_for(timeout=10000)
            asked = True
        except Exception:  # noqa: BLE001 -- its absence is the product's answer, checked below
            asked = False
        # R-P3b-5: an image nobody has read must ask again. On a box with no OCR engine the image was never read, so
        # a missing question here is a product answer (FAIL), and the story goes on with the switch the click set.
        st.check("switching it on asks the second question (the image was never read: no OCR engine here)", asked,
                 f"asked={asked}; OCR line: {ocr_line[:200]}; states: {json.dumps(imgs)[:300]}")
        if asked:
            st.read("second confirm", ask.inner_text())
            st.check("the switch stays off until the answer", sw.get_attribute("aria-checked") == "false",
                     f"aria-checked={sw.get_attribute('aria-checked')}")
            ask.get_by_role("button", name="Share it", exact=True).click(timeout=T)
        frame = sheet.get_by_role("region", name="What other members will see")
        frame.locator("img").first.wait_for(timeout=T)
        st.check("the switch is on after the answer", sw.get_attribute("aria-checked") == "true",
                 f"aria-checked={sw.get_attribute('aria-checked')}")
        st.check("the body now shows the image", frame.locator("img").count() == 1, f"{frame.locator('img').count()} img")
        submit = sheet.get_by_role("button", name="Submit for review")
        apg.wait_for_function("(el) => !el.disabled", arg=submit.element_handle(), timeout=T)
        title = sheet.get_by_label("Title in the library").input_value()
        S["example_title"] = title
        st.read("title in the library", title)
        with apg.expect_response(lambda r: r.url.endswith("/api/j2/template-gallery/examples") and r.request.method == "POST",
                                 timeout=T) as resp:
            submit.click(timeout=T)
        sent = resp.value.request.post_data_json or {}
        S["exid"] = ((resp.value.json() or {}).get("template") or {}).get("id")
        st.check("the submit was taken (HTTP 200)", resp.value.status == 200 and bool(S["exid"]), f"HTTP {resp.value.status}")
        st.check("the submit sent the switched-on image and no body", sent.get("imagesOn") == [S["attachment_url"]]
                 and "bodyJson" not in sent, json.dumps(sent))
        said = apg.get_by_text(EXAMPLE_SENT, exact=True)
        said.wait_for(timeout=T)
        st.check("the door says it was sent for review", True, st.read("door status", said.inner_text()))

    def approve(st, lib, gid: str, title: str) -> None:
        row = lib.locator(f'[data-gallery-pending="{gid}"]')
        row.wait_for(timeout=T)
        row.get_by_role("button", name=f"Approve {title}").click(timeout=T)
        want = f"Approved “{title}”. It is listed now."
        st.check(f"the gallery says “{title}” is listed", want in st.read("message", gallery_message(lib, want)), want)

    def s5(st):
        lib = open_library(dpg, base)
        lib.get_by_role("button", name="Review queue").click(timeout=T)
        erow = lib.locator(f'[data-gallery-pending="{S["exid"]}"]')
        erow.wait_for(timeout=T)
        erow.get_by_text(re.compile(r"^An example of the style ")).wait_for(timeout=T)
        text = st.read("the example's review row", erow.inner_text())
        st.check("the example's row names its style", f"An example of the style “{name}”" in text, text)
        erow.get_by_role("button", name=f"Preview {S['example_title']}").click(timeout=T)
        prev = dpg.get_by_role("dialog", name=S["example_title"])
        prev.get_by_text(re.compile(VALUE_HERE)).first.wait_for(timeout=T)
        ptext = st.read("the reviewer's preview", prev.inner_text())
        st.check("the reviewer sees the reduced words", VALUE_HERE in ptext and YOUR_BROKER in ptext
                 and MONEY not in ptext and BROKER not in ptext, ptext[:400])
        pimg = prev.locator("img").first
        pimg.wait_for(timeout=T)
        dpg.wait_for_function(IMG_LOADED_JS, arg=pimg.element_handle(), timeout=T)
        st.check("the reviewer sees the image, from the gallery route",
                 re.fullmatch(rf"/api/j2/template-gallery/{S['exid']}/images/\d+", pimg.get_attribute("src") or "") is not None,
                 pimg.get_attribute("src") or "")
        prev.get_by_role("button", name="Close").first.click(timeout=T)
        prev.wait_for(state="hidden", timeout=T)
        approve(st, lib, S["gid"], name)
        if BREAK == "unapproved-example":
            REC["setup"].append({"viewport": vp, "what": "DELIBERATELY BROKEN RUN: the example is left unapproved",
                                 "verdict": "INFO"})
            flush()
            return
        approve(st, lib, S["exid"], S["example_title"])

    def s6(st):
        lib = open_library(mpg, base)
        lib.get_by_role("group", name="Filter by trading style").get_by_role("button", name="Swing").click(timeout=T)
        card = lib.locator(f'[data-library-style][data-gallery-id="{S["gid"]}"]')
        card.wait_for(timeout=T)
        card.get_by_role("button", name=f"Preview {name}").click(timeout=T)
        prev = mpg.get_by_role("dialog", name=name)
        prev.get_by_text("Author outline: the plan, the size, the stop.").wait_for(timeout=T)
        st.read("the style's Preview", prev.inner_text())
        section = prev.locator("[data-examples-in-use]")
        try:
            section.wait_for(timeout=10000)
        except Exception:  # noqa: BLE001 -- its absence is the product's answer, checked below
            pass
        st.must(f'the style\'s Preview has an "{IN_USE}" section', section.count() == 1,
                f"{section.count()} section(s); preview text: {prev.inner_text()[:300]}")
        text = st.read("In use", section.inner_text())
        st.check(f'"{IN_USE}" names the example', S["example_title"] in text, text[:300])
        st.check(f'"{IN_USE}" shows "{VALUE_HERE}"', VALUE_HERE in text, text[:400])
        st.check(f'"{IN_USE}" shows "{YOUR_BROKER}"', YOUR_BROKER in text, text[:400])
        st.check("the author's amount, broker and account size are not shown",
                 MONEY not in text and BROKER not in text and "25,000" not in text and "25000" not in text, text[:400])
        img = section.locator("img").first
        img.wait_for(timeout=T)
        S["image_url"] = img.get_attribute("src") or ""
        try:
            mpg.wait_for_function(IMG_LOADED_JS, arg=img.element_handle(), timeout=T)
        except Exception:  # noqa: BLE001 -- read below
            pass
        loaded = img.evaluate(IMG_LOADED_JS)
        st.check("the image loads in the member's browser", bool(loaded),
                 f"src={S['image_url']} naturalWidth={img.evaluate('(el) => el.naturalWidth')}")
        st.check("the image is on the gallery route, never the author's attachment",
                 re.fullmatch(rf"/api/j2/template-gallery/{S['exid']}/images/\d+", S["image_url"]) is not None,
                 S["image_url"])
        r = mctx.request.get(base + S["image_url"])
        S["image_ok"] = r.status == 200 and (r.headers.get("content-type") or "").startswith("image/")
        st.check("the image URL answers 200 with an image", S["image_ok"],
                 f"HTTP {r.status} {r.headers.get('content-type')}")
        item = mctx.request.get(base + f"/api/j2/template-gallery/{S['exid']}").json().get("template") or {}
        blk = next((n for n in walk_nodes((item.get("payload") or {}).get("bodyJson")) if n.get("type") == "widgetEmbed"
                    and (n.get("attrs") or {}).get("widgetId") == "positionSizing"), None)
        params = ((blk or {}).get("attrs") or {}).get("params") or {}
        st.check("the stored example's position sizing block carries no account size (the member's read)",
                 blk is not None and not params.get("accountSize"), json.dumps(params))

    def s7(st):
        # A 404 means something only if the same URL answered 200 before (step 6): otherwise it is a URL that never
        # served, and the step could pass on an example that was never made (run p3b-walk-20261018T115124Z did).
        st.must("there is an example whose image answered 200 before the withdraw", bool(S.get("exid"))
                and S.get("image_ok") is True, f"exid={S.get('exid')} image_ok={S.get('image_ok')}")
        lib = open_library(apg, base)
        lib.get_by_role("button", name="Your submissions").click(timeout=T)
        row = lib.locator(f'[data-gallery-row="{S["gid"]}"]')
        row.wait_for(timeout=T)
        title = row.locator("h4").inner_text()
        row.get_by_role("button", name=f"Unpublish {title}").click(timeout=T)
        row.get_by_role("group", name=f"Unpublish {title}?").get_by_role("button", name="Unpublish", exact=True).click(timeout=T)
        want = f"Unpublished “{title}”."
        st.check("the gallery says the style was withdrawn", want in st.read("message", gallery_message(lib, want)), want)
        url = S["image_url"]
        r = mctx.request.get(base + url)
        st.check("the example's image URL now answers 404", r.status == 404, f"GET {url} -> HTTP {r.status}")
        r2 = mctx.request.get(base + f"/api/j2/template-gallery/{S.get('exid')}")
        st.check("the example itself now answers 404", r2.status == 404, f"HTTP {r2.status}")

    try:
        for n, title, fn in ((1, "author writes a trade plan note: $1,240 at Schwab, a sizing block with an account size, one pasted image", s1),
                             (2, "author shares the style (P3a flow) and adds the note as an example", s2),
                             (3, "the preview: the counts sentence, the replaced spans, the image off", s3),
                             (4, "author switches the image on through the second confirm, and submits", s4),
                             (5, "admin approves it (the style and the example) in the review queue", s5),
                             (6, 'second member opens the style: In use shows "your value here" and "your broker", the image loads', s6),
                             (7, "author withdraws the style; the image URL answers 404", s7)):
            run_step(vp, n, title, fn, pages)
    finally:
        for c in (actx, mctx, dctx):
            c.close()
        flush()


# ── boot ──────────────────────────────────────────────────────────────────────────────────

def set_env(fs: dict) -> list[str]:
    on = sorted(set(fs["c1"]) | set(LIBRARY_FLAGS) | {EXAMPLE_FLAG})
    for name in fs["all_names"]:
        os.environ.pop(name, None)
    os.environ.pop(OCR_FLAG, None)
    for k in [k for k in os.environ if k.startswith("RAILWAY_")]:
        os.environ.pop(k, None)
    os.environ.update({name: "1" for name in on})
    os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    return on


def main(argv=None) -> int:
    global OUT, BREAK
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8091)
    ap.add_argument("--tip", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--viewports", default="1280,820,390")
    ap.add_argument("--break", dest="brk", choices=BREAKS, default=None,
                    help="a DELIBERATELY BROKEN run: unapproved-example leaves the example unapproved in step 5")
    args = ap.parse_args(argv)
    BREAK = args.brk
    viewports = [x.strip() for x in args.viewports.split(",") if x.strip()]
    if not viewports:
        print("REFUSED: --viewports names no viewport, so the walk would run no step and prove nothing")
        return 3
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port == HUB_PORT:
        print(f"REFUSED: port {HUB_PORT} belongs to the hub sandbox; pick another")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener (never killed)")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    OUT = Path(args.out)
    OUT.mkdir(parents=True, exist_ok=True)
    tree = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    fs = fw.flag_sets()
    on = set_env(fs)
    base = f"http://127.0.0.1:{args.port}"
    REC["ocr_engine_on_box"] = shutil.which("tesseract") or os.environ.get("TESSERACT_BINARY") or None
    REC["ocr_flag_in_sandbox_env"] = os.environ.get(OCR_FLAG)     # None: set_env popped it, so OCR is dark either way
    REC.update({"deliberately_broken": BREAK, "tip": args.tip, "tool_tree": tree, "base": base,
                "data_dir": str(data_dir), "flags_on": on,
                "started": datetime.now(timezone.utc).isoformat(timespec="seconds"), "status": "INCOMPLETE (run did not finish)"})
    flush()
    sb = h.Sandbox(str(data_dir), args.port, OUT / "sandbox.log")
    sb.start()
    REC["sandbox_pid"] = sb.proc.pid if sb.proc else None
    not_run, failure = None, None
    try:
        if not sb.wait_healthy(base, 400):
            not_run = "the sandbox never answered /api/health"
        else:
            sb.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
            import sandbox_identity
            v = sandbox_identity.verify(base, sb.integrity_path())
            REC["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
            if not v.ok:
                not_run = v.sentence
        if not not_run:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch()
                try:
                    provision(browser, base)
                    run = datetime.now(timezone.utc).strftime("%H%M%S")
                    for vp in viewports:
                        story(browser, base, vp, run)
                except h.SetupFailed as e:
                    not_run = str(e)[:400]
                except Exception as e:  # noqa: BLE001
                    failure = f"{type(e).__name__}: {str(e)[:400]}"
                    REC["traceback"] = traceback.format_exc()[-3000:]
                finally:
                    browser.close()
        sb.wait_checkpoint(h.PREWARM, h.PREWARM_WAIT_S)
    finally:
        REC["stop"] = sb.stop()
    integ = h.read_integrity(sb.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.PREWARM, h.SHUTDOWN])
    ipath = sb.integrity_path()
    if ipath and Path(ipath).is_file():
        kept = OUT / "integrity.md"
        kept.write_text(f"tip under test: {args.tip}\n\n" + Path(ipath).read_text(encoding="utf-8", errors="replace"),
                        encoding="utf-8", newline="\n")
        integ["path"] = str(kept)
    REC["integrity"] = integ
    REC["first_line"] = h.integrity_line(integ, f"stop: {sb.stop_how}", not_run=not_run)
    print(REC["first_line"])
    REC["driver_imported_api"] = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    counts = {v: sum(1 for s in REC["steps"] if s["verdict"] == v) for v in ("PASS", "FAIL", "INCONCLUSIVE")}
    expected = STEPS_PER_VIEWPORT * len(viewports)
    REC.update({"not_run": not_run, "failure": failure, "counts": counts, "port_free_after": not h.port_busy(args.port),
                "steps_expected": expected, "steps_recorded": len(REC["steps"]),
                "finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "status": "COMPLETE" if not (not_run or failure) else "NOT COMPLETE"})
    flush()
    print(f"VERDICT: {counts} not_run={not_run} failure={failure} broken={BREAK}; raw log: {OUT / 'walk.json'}")
    if not_run:
        return 3
    return exit_code(failure, counts, len(REC["steps"]), expected)


def exit_code(failure, counts: dict, recorded: int, expected: int) -> int:
    """0 only for a finished walk whose every expected step was recorded and passed; a short walk is never a pass."""
    if failure or counts["FAIL"] or counts["INCONCLUSIVE"]:
        return 1
    return 0 if expected > 0 and recorded == expected else 1


if __name__ == "__main__":
    sys.exit(main())
