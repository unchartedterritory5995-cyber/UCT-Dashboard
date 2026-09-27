"""Wave 10 lane 10B live walk -- the Playwright script that produces
docs/notebook/gate-runs/wave10/walk-10B-<sha>.json. Kept in tools/ so the evidence is
reproducible; it is NOT a pytest rail.

It OWNS its sandbox (the perf harness's `Sandbox`: `scripts/hub_sandbox_boot.py` through
the SIGBREAK shim, in its own process group, stopped gracefully so the launcher's own
`finally` writes the SHUTDOWN checkpoint). Its FIRST OUTPUT LINE is the launcher's
snapshot verdict (`SANDBOX INTEGRITY: ...`, the harness's `integrity_line`), printed only
after the sandbox has stopped -- every row's line follows it.

Run it from POWERSHELL (a Windows path through the Bash tool loses its backslash), with
the sandbox's environment set in that same shell, every name read off its read site:

    $env:NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED = '1'   # document_extraction.image_docx_documents_enabled
    $env:NOTEBOOK_WRITING_HELP_ENABLED = '1'           # auth._access_payload / writing_help.enabled
    $env:J2_SHARE_LINKS_ENABLED = '1'                  # note_shares.flag -- row B9b's public page
    $env:ANTHROPIC_API_KEY = ''; $env:OPENAI_API_KEY = ''   # NO model key -- stated, never faked
    python tools/notebook_wave10b_walk.py --data-dir 'C:\\data-w10b' --port 8212 `
        --out docs/notebook/gate-runs/wave10/walk-10B-<sha>.json --tip <sha> `
        --artifacts <scratch>\\w10b-walk

Preconditions: app/dist rebuilt from the tip (`npm run build` in app/); the port free
(refused, never killed); the data dir outside the shared root (refused).

  B1  G-144 touch Undo / Redo at 390 px with touch: the control renders, is a 44 px
      target, undoes exactly the typed step and redoes it; hidden at 1280
  B2  G-134 table: sort by a numeric column (one undo step), drag a column edge,
      reload -- the order and the width are what the page and the API show
  B3  G-160 .xlsx under the gate: upload -> a document -> a cell word found by the
      document search AND shown in the sidebar search
  B4  Best matches over a note + a PDF page + a saved excerpt sharing one word
  B5  R-18 imports through the wizard: the Google Keep zip, the Logseq graph, and a
      OneNote Word file (the intake fix) -- what the notes carry afterwards
  B6  graph in the LIGHT theme: every ink the canvas reads, measured against its
      surface, and the canvas actually painting the node ink
  B7  G-165 autofill with NO model key: offered, what the route answers, nothing
      written -- INCONCLUSIVE by construction (no model output can be observed)
  B8  no unforced page error across the walk

Fix round 1 (the review's I-2 and M-5, measured in real Chromium, never jsdom):
  B9  a RESIZED table (3 x 400 px columns) at 390, 820 and 1200 px, against a control
      note without a table (same viewport, same page): the table adds NO width to the
      document or to any sideways scroller, its own wrapper scrolls, and scrolled to its
      end the table's right edge is on screen
  B9b the same, on the PUBLIC share page (`/share/n/<token>`, a stranger's browser) at
      390 px -- needs `$env:J2_SHARE_LINKS_ENABLED = '1'` in the run's shell
  B9c reported, not graded: the Notebook page's own chrome at 390 px with no table (the
      voice first-run hint seen and not seen) -- a pre-existing fact kept apart from B9
  B10 touch Undo at 390 px after typing 60 lines: the toolbar has scrolled away, the
      Undo button is inside the viewport and is what a finger at its centre touches,
      and tapping THERE undoes

`--only B9,B10` runs just those rows (the mutant-build run that shows each goes red);
the evidence run runs everything and holds the sandbox past its +120 s checkpoint, so
the integrity line names all four (pre-boot, +15 s, +120 s, shutdown).

Exit: 0 = every row PASS or INCONCLUSIVE-by-construction and integrity CLEAN; 1 = a row
FAILED; 2 = integrity not CLEAN/complete or a row INCONCLUSIVE for another reason; 3 =
refused / not run.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import secrets
import shutil
import sys
import time
import traceback
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))
from tools import notebook_perf_harness as H  # noqa: E402  (ONE sandbox + integrity reader)
import sandbox_identity  # noqa: E402

FIX = REPO / "app" / "src" / "pages" / "journal-2-0" / "lib" / "importer" / "__fixtures__" / "census"
# Review M-8: the evidence run holds the sandbox past +120 s, so all FOUR are required.
REQUIRED = [H.PRE_BOOT, H.POST_BOOT, H.PREWARM, H.SHUTDOWN]
EMAIL = "w10b@local.dev"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
S_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
# Rows that are INCONCLUSIVE by construction (the sandbox holds no model key; B9c is a
# measurement reported for the record, never graded).
BY_CONSTRUCTION = {"B7_autofill_no_key", "B9c_page_chrome_at_390_no_table"}

res: dict = {"wave": 10, "lane": "10B", "checks": {}, "errors": [], "instrument_notes": []}
LINES: list[str] = []
ONLY: list[str] = []        # --only: row-key prefixes to run (empty = every row)


# ── small pure helpers ───────────────────────────────────────────────────────

def record(key, verdict, **facts):
    entry = {"verdict": verdict, **facts}
    res["checks"][key] = entry
    line = f"[{verdict}] {key}: " + json.dumps(facts, default=str, ensure_ascii=True)[:400]
    LINES.append(line)
    print(line, file=sys.stderr, flush=True)
    return entry


def guarded(key):
    def wrap(fn):
        def inner(*a, **kw):
            try:
                fn(*a, **kw)
            except Exception as e:  # noqa: BLE001 -- one row never stops the rest
                record(key, "INCONCLUSIVE", reason=f"exception: {type(e).__name__}: {e}",
                       traceback=traceback.format_exc()[-1500:])
        inner.key = key
        return inner
    return wrap


# Fix round 1 (I-2): one read of a document's layout, the same on every surface, taken
# on the table note AND on a control note without a table, same viewport, same page.
#  * `scrollers`: the document and every ancestor of the editor that can scroll
#    sideways (overflow-x auto/scroll -- the app scrolls its inner .main), with their
#    scroll and client widths. The table must ADD NOTHING to any of them: whatever the
#    control shows (the page's own chrome, measured and reported beside it) is not the
#    table's.
#  * the table's own wrapper must scroll, and scrolled to its end the table's right
#    edge must be on screen (a 400 px column cannot fit a 390 px phone whole; what must
#    be reachable is the rest of the table).
LAYOUT_JS = """() => {
  const pm = document.querySelector('.ProseMirror');
  const de = document.documentElement;
  const scrollers = [{ cls: 'document', scrollWidth: de.scrollWidth, clientWidth: de.clientWidth }];
  for (let el = pm ? pm.parentElement : null; el; el = el.parentElement) {
    const ox = getComputedStyle(el).overflowX;
    if (ox === 'auto' || ox === 'scroll')
      scrollers.push({ cls: String(el.className).slice(0, 50), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
  }
  const w = document.querySelector('.ProseMirror .tableWrapper');
  if (!w) return { wrapper: false, scrollers, innerWidth: window.innerWidth };
  const t = w.querySelector('table');
  const before = { scrollWidth: w.scrollWidth, clientWidth: w.clientWidth, overflowX: getComputedStyle(w).overflowX };
  w.scrollLeft = w.scrollWidth;
  const cells = t ? t.querySelectorAll('tr:first-child > *') : [];
  const last = cells.length ? cells[cells.length - 1].getBoundingClientRect() : null;
  return { wrapper: true, scrollers, innerWidth: window.innerWidth,
           tableStyleWidth: t ? t.style.width : null, tableWidth: t ? Math.round(t.getBoundingClientRect().width) : null,
           wrapperBefore: before, wrapperScrollLeft: w.scrollLeft,
           lastCell: last && { left: Math.round(last.left), right: Math.round(last.right) } };
}"""


def table_verdict(m, control):
    """(ok, facts): the wrapper scrolls, the table's end is reachable, and no scroller is
    wider with the table than without it."""
    lc = m.get("lastCell") or {}
    wb = m.get("wrapperBefore") or {}
    scrolls = wb.get("overflowX") in ("auto", "scroll") and wb.get("scrollWidth", 0) > wb.get("clientWidth", 0)
    base = {s["cls"]: s["scrollWidth"] for s in (control or {}).get("scrollers") or []}
    added = [{"cls": s["cls"], "with_table": s["scrollWidth"], "without": base.get(s["cls"])}
             for s in m.get("scrollers") or [] if s["scrollWidth"] > base.get(s["cls"], s["clientWidth"]) + 1]
    reach = bool(lc) and 0 < lc.get("right", 10 ** 6) <= m.get("innerWidth", 0)
    ok = bool(m.get("wrapper") and scrolls and reach and not added and control)
    return ok, {"wrapper_scrolls": scrolls, "table_end_on_screen": reach, "table_added_overflow": added}


def P(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def DOC(*nodes):
    return {"type": "doc", "content": list(nodes)}


def _rgb(s):
    nums = [float(x) for x in re.findall(r"[\d.]+", s or "")]
    if len(nums) < 3:
        return None
    return nums[0], nums[1], nums[2], (nums[3] if len(nums) > 3 else 1.0)


def _lum(r, g, b):
    def ch(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(fg, bg):
    """WCAG ratio of two computed colours; an alpha < 1 foreground is composited over bg."""
    f, b = _rgb(fg), _rgb(bg)
    if not f or not b:
        return None
    a = f[3]
    fr, fg_, fb = (f[i] * a + b[i] * (1 - a) for i in range(3))
    l1, l2 = _lum(fr, fg_, fb), _lum(b[0], b[1], b[2])
    hi, lo = max(l1, l2), min(l1, l2)
    return round((hi + 0.05) / (lo + 0.05), 2)


def xlsx_bytes(word):
    workbook = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<workbook xmlns="{S_NS}" xmlns:r="{R_NS}"><sheets>'
                f'<sheet name="Trades" sheetId="1" r:id="rId1"/></sheets></workbook>')
    rels = (f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PKG_NS}">'
            f'<Relationship Id="rId1" Type="{R_NS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
    shared = f'<?xml version="1.0" encoding="UTF-8"?><sst xmlns="{S_NS}"><si><t>{word}</t></si></sst>'
    sheet = (f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="{S_NS}"><sheetData>'
             f'<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>120.5</v></c></row>'
             f'</sheetData></worksheet>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        z.writestr("xl/sharedStrings.xml", shared)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


def text_pdf(text):
    """A one-page PDF whose page carries real text (Helvetica), so pypdf extracts it."""
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
    ]
    stream = ("BT /F1 12 Tf 72 700 Td (" + text + ") Tj ET").encode("latin-1")
    objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = b"%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += str(i).encode() + b" 0 obj\n" + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 " + str(len(objs) + 1).encode() + b"\n0000000000 65535 f \n"
    for off in offsets:
        out += ("%010d 00000 n \n" % off).encode()
    out += (b"trailer\n<< /Size " + str(len(objs) + 1).encode() + b" /Root 1 0 R >>\nstartxref\n"
            + str(xref).encode() + b"\n%%EOF\n")
    return out


def zip_dir(path: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(path.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(path).as_posix())
    return buf.getvalue()


def task_items(node):
    out = []

    def text_of(n):
        if n.get("type") == "text":
            return n.get("text", "")
        return "".join(text_of(c) for c in n.get("content") or [])

    def visit(n):
        if not isinstance(n, dict):
            return
        if n.get("type") == "taskItem":
            out.append([text_of(n).strip(), bool((n.get("attrs") or {}).get("checked"))])
        for c in n.get("content") or []:
            visit(c)
    visit(node or {})
    return out


def find_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            hit = find_key(v, key)
            if hit is not None:
                return hit
    elif isinstance(obj, list):
        for v in obj:
            hit = find_key(v, key)
            if hit is not None:
                return hit
    return None


# ── the walk ─────────────────────────────────────────────────────────────────

def run_walk(base: str, art: Path) -> None:
    from playwright.sync_api import sync_playwright

    run = time.strftime("r%H%M%S")
    runword = "w" + "".join("abcdefghkm"[int(c)] if c.isdigit() else c for c in run)
    res["run"] = run
    pw = secrets.token_urlsafe(18)   # a TEST value for this run only; never written anywhere

    def pages_of(ctx):
        def new_page():
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
            return pg
        return new_page

    def shot(pg, name):
        p = art / f"{run}-{name}.png"
        try:
            pg.screenshot(path=str(p))
            return p.name
        except Exception as e:  # noqa: BLE001
            return f"screenshot failed: {e}"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = browser.new_context()
        member = browser.new_context(viewport={"width": 1280, "height": 800})
        # A member PER RUN: the data dir outlives a run (the box's system-path guard refuses
        # to remove C:\data-w10b), and a run's password is generated and never written, so
        # an earlier run's member can never sign in again.
        email = EMAIL.replace("@", f"-{run}@")
        res["member"] = email
        H._provision(admin.request, member.request, base, member=(email, pw, "Walker Ten B"))
        api = member.request
        me = api.get(base + "/api/auth/me").json()
        res["server_flags"] = {"notebook_writing_help_enabled": find_key(me, "notebook_writing_help_enabled"),
                               "paid_equiv": me.get("paid_equiv")}
        new_page = pages_of(member)

        def mk_note(title, body):
            r = api.post(base + "/api/j2/notes", data={"title": title, "bodyJson": body})
            if not r.ok:
                raise RuntimeError(f"create note {title!r}: HTTP {r.status} {r.text()[:200]}")
            return r.json()["note"]

        def get_note(nid):
            return api.get(base + f"/api/j2/notes/{nid}").json()["note"]

        def open_note(page_factory, nid, tries=3):
            last = None
            for _ in range(tries):
                pg = page_factory()
                pg.goto(f"{base}/journal/notebook?note={nid}")
                H._dismiss_intro(pg)
                try:
                    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                    return pg
                except Exception as e:  # noqa: BLE001
                    last = e
                    pg.close()
            raise RuntimeError(f"the editor never mounted for note {nid}: {last}")

        def editor_text(pg):
            return pg.locator(".ProseMirror").first.inner_text().strip()

        def wait_until(fn, timeout=20.0, every=0.4):
            end = time.time() + timeout
            val = fn()
            while not val and time.time() < end:
                time.sleep(every)
                val = fn()
            return val

        def wait_documents(nid, timeout=60.0):
            def settled():
                docs = api.get(base + f"/api/j2/notes/{nid}/documents").json().get("documents") or []
                return docs if docs and all(d.get("status") != "pending" for d in docs) else None
            return wait_until(settled, timeout=timeout, every=1.0) or \
                api.get(base + f"/api/j2/notes/{nid}/documents").json().get("documents")

        def list_notes():
            body = api.get(base + "/api/j2/notes?limit=200").json()
            return body.get("notes") if isinstance(body, dict) else body

        # ── B1 ──────────────────────────────────────────────────────────────
        @guarded("B1_touch_undo_redo")
        def b1():
            note = mk_note(f"B1 touch {run}", DOC(P("Start.")))
            touch = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                        device_scale_factor=2, storage_state=member.storage_state())
            pg = open_note(pages_of(touch), note["id"])
            ed = pg.locator(".ProseMirror").first
            ed.tap()
            pg.keyboard.press("Control+End")
            pg.keyboard.type(" one", delay=40)
            typed = wait_until(lambda: editor_text(pg) == "Start. one", 5)
            undo = pg.get_by_role("button", name="Undo", exact=True)
            redo = pg.get_by_role("button", name="Redo", exact=True)
            visible = undo.count() > 0 and undo.first.is_visible()
            box = undo.first.bounding_box() if visible else None
            enabled = visible and undo.first.is_enabled()
            pg.wait_for_timeout(700)   # past prosemirror-history's 500 ms grouping window
            if visible:
                undo.first.tap()
            after_undo = wait_until(lambda: editor_text(pg) == "Start.", 5) and editor_text(pg)
            if visible:
                redo.first.tap()
            after_redo = wait_until(lambda: editor_text(pg) == "Start. one", 5) and editor_text(pg)
            s = shot(pg, "B1-390")
            touch.close()
            desk = open_note(new_page, note["id"])
            desk_visible = desk.get_by_role("button", name="Undo", exact=True).count() > 0 and \
                desk.get_by_role("button", name="Undo", exact=True).first.is_visible()
            desk.close()
            ok = bool(typed and visible and enabled and box and box["width"] >= 44 and box["height"] >= 44
                      and after_undo == "Start." and after_redo == "Start. one" and not desk_visible)
            record("B1_touch_undo_redo", "PASS" if ok else "FAIL", typed=bool(typed), undo_visible_390=visible,
                   undo_enabled=enabled, undo_box=box, text_after_undo=after_undo, text_after_redo=after_redo,
                   undo_visible_1280=desk_visible, screenshot=s)

        # ── B2 ──────────────────────────────────────────────────────────────
        @guarded("B2_table_sort_resize_reload")
        def b2():
            def cell(kind, t):
                return {"type": kind, "attrs": {"colspan": 1, "rowspan": 1, "colwidth": None}, "content": [P(t)]}
            rows = [["Ticker", "Price"], ["NVDA", "120"], ["AMD", "9.5"], ["TSLA", "1,050"]]
            table = {"type": "table", "content": [
                {"type": "tableRow", "content": [cell("tableHeader" if i == 0 else "tableCell", t) for t in r]}
                for i, r in enumerate(rows)]}
            note = mk_note(f"B2 table {run}", DOC(P("Table walk."), table))
            pg = open_note(new_page, note["id"])

            def order():
                return pg.locator(".ProseMirror table tr").evaluate_all(
                    "rs => rs.map(r => [...r.children].map(c => c.innerText.trim()))")

            before = order()
            pg.locator(".ProseMirror td", has_text="120").first.click()
            sort_btn = pg.get_by_role("button", name="Sort rows by this column, A to Z")
            sort_btn.first.wait_for(state="visible", timeout=10000)
            sort_btn.first.click()
            want = [["Ticker", "Price"], ["AMD", "9.5"], ["NVDA", "120"], ["TSLA", "1,050"]]
            sorted_now = wait_until(lambda: order() == want, 5) and order()
            pg.keyboard.press("Control+z")
            undone = wait_until(lambda: order() == before, 5) and order()
            pg.keyboard.press("Control+Shift+z")
            redone = wait_until(lambda: order() == want, 5) and order()
            th = pg.locator(".ProseMirror table th").first
            b0 = th.bounding_box()
            x, y = b0["x"] + b0["width"] - 1, b0["y"] + b0["height"] / 2
            pg.mouse.move(x - 12, y)
            pg.mouse.move(x, y, steps=4)
            handle = wait_until(lambda: pg.locator(".column-resize-handle").count() > 0, 4)
            pg.mouse.down()
            pg.mouse.move(x + 45, y, steps=6)
            pg.mouse.move(x + 90, y, steps=6)
            pg.mouse.up()
            b1_ = th.bounding_box()

            def stored():
                body = get_note(note["id"]).get("bodyJson") or {}
                tbl = next((c for c in body.get("content", []) if c.get("type") == "table"), None)
                if not tbl:
                    return None
                cells = [[(c.get("attrs") or {}).get("colwidth") for c in r["content"]] for r in tbl["content"]]
                texts = [["".join(x.get("text", "") for p_ in c.get("content", []) for x in p_.get("content", []))
                          for c in r["content"]] for r in tbl["content"]]
                return {"colwidths": cells, "texts": texts}
            persisted = wait_until(lambda: (lambda s: s if s and s["texts"] == want and s["colwidths"][0][0]
                                            else None)(stored()), 25) or stored()
            s1 = shot(pg, "B2-before-reload")
            pg.close()
            pg2 = open_note(new_page, note["id"])
            after_reload = pg2.locator(".ProseMirror table tr").evaluate_all(
                "rs => rs.map(r => [...r.children].map(c => c.innerText.trim()))")
            b2_ = pg2.locator(".ProseMirror table th").first.bounding_box()
            s2 = shot(pg2, "B2-after-reload")
            pg2.close()
            cw = (persisted or {}).get("colwidths") or [[None]]
            col0 = [r[0] for r in cw]
            ok = bool(sorted_now == want and undone == before and redone == want and handle
                      and b1_["width"] >= b0["width"] + 40 and col0[0] and all(c == col0[0] for c in col0)
                      and (persisted or {}).get("texts") == want and after_reload == want
                      and abs(b2_["width"] - b1_["width"]) <= 3)
            record("B2_table_sort_resize_reload", "PASS" if ok else "FAIL", order_before=before,
                   order_after_sort=sorted_now, order_after_one_undo=undone, order_after_redo=redone,
                   resize_handle_seen=bool(handle), width_before=round(b0["width"], 1),
                   width_after_drag=round(b1_["width"], 1), width_after_reload=round(b2_["width"], 1),
                   stored=persisted, order_after_reload=after_reload, screenshots=[s1, s2])

        # ── B3 ──────────────────────────────────────────────────────────────
        @guarded("B3_xlsx_cell_found")
        def b3():
            word = f"kimberlite{runword}"
            note = mk_note(f"B3 xlsx {run}", DOC(P("Spreadsheet attached below.")))
            up = api.post(base + f"/api/j2/notes/{note['id']}/attachments",
                          multipart={"file": {"name": "trades.xlsx", "mimeType": XLSX_MIME, "buffer": xlsx_bytes(word)}})
            docs = wait_documents(note["id"]) or []
            d = docs[0] if docs else {}
            hits = api.get(base + f"/api/j2/notes/documents/search?q={word}").json().get("results") or []
            api_hit = any(h.get("documentId") == d.get("id") for h in hits)
            pg = new_page()
            pg.goto(f"{base}/journal/notebook?view=all")
            H._dismiss_intro(pg)
            # The sidebar's search is a TAB ("Search notes", FolderSidebar.jsx); its input
            # exists only once that tab is selected -- the member's own door.
            pg.get_by_role("tab", name="Search notes").first.click(timeout=20000)
            box = pg.get_by_label("Search your notes")
            box.first.wait_for(state="visible", timeout=20000)
            box.first.fill(word)
            shown = wait_until(lambda: pg.get_by_text(re.compile(word, re.I)).count() > 0, 20)
            s = shot(pg, "B3-search")
            pg.close()
            ok = bool(up.ok and d.get("status") == "ready" and api_hit and shown)
            record("B3_xlsx_cell_found", "PASS" if ok else "FAIL", upload_status=up.status,
                   document={k: d.get(k) for k in ("id", "status", "sourceKind", "pageCount", "name")},
                   search_api_hits=len(hits), search_api_has_doc=api_hit, sidebar_shows_word=bool(shown),
                   first_hit=(hits[0] if hits else None), screenshot=s)

        # ── B4 ──────────────────────────────────────────────────────────────
        @guarded("B4_best_matches")
        def b4():
            word = f"zircon{runword}"
            mk_note(f"B4 note {run}", DOC(P(f"My {word} thesis note.")))
            holder = mk_note(f"B4 pdf {run}", DOC(P("PDF holder.")))
            up = api.post(base + f"/api/j2/notes/{holder['id']}/attachments", multipart={"file": {
                "name": "report.pdf", "mimeType": "application/pdf",
                "buffer": text_pdf(f"The {word} deposit report shows strong grades in every drill hole "
                                   "this quarter, with the best results in the northern zone.")}})
            docs = wait_documents(holder["id"]) or []
            d = docs[0] if docs else {}
            ex = api.post(base + f"/api/j2/notes/{holder['id']}/excerpts",
                          data={"documentId": d.get("id"), "pageNumber": 1, "capturedText": f"The {word} deposit report"})
            pg = new_page()
            pg.goto(f"{base}/journal/notebook?view=all")
            H._dismiss_intro(pg)
            # The sidebar's search is a TAB ("Search notes", FolderSidebar.jsx); its input
            # exists only once that tab is selected -- the member's own door.
            pg.get_by_role("tab", name="Search notes").first.click(timeout=20000)
            box = pg.get_by_label("Search your notes")
            box.first.wait_for(state="visible", timeout=20000)
            box.first.fill(word)
            group = pg.locator('[data-testid="best-matches"]')
            seen = wait_until(lambda: group.count() > 0 and group.first.is_visible(), 25)
            text = group.first.inner_text() if seen else ""
            # innerText follows the stylesheet's `text-transform: uppercase` (run 2 read
            # "SAVED EXCERPT"), so the kind labels are matched case-blind, as a line.
            labels = [lab for lab in ("Note", "Saved excerpt", "Thesis review", "Document page")
                      if re.search(rf"(^|\n){re.escape(lab)}(\n|$)", text, re.IGNORECASE)]
            s = shot(pg, "B4-best-matches")
            sidebar = pg.locator("body").inner_text()
            pg.close()
            ok = bool(up.ok and d.get("status") == "ready" and ex.ok and seen and len(labels) >= 2)
            record("B4_best_matches", "PASS" if ok else "FAIL", pdf_status=d.get("status"),
                   excerpt_status=ex.status, group_visible=bool(seen), kind_labels=labels,
                   group_text=text[:600], sections_named=[s_ for s_ in ("Notes", "Documents", "Evidence")
                                                        if s_ in sidebar], screenshot=s)

        # ── B5 ──────────────────────────────────────────────────────────────
        def import_through_wizard(name, mime, payload, tag):
            pg = new_page()
            pg.goto(f"{base}/journal/notebook?view=all")
            H._dismiss_intro(pg)
            pg.locator('button[data-tour="import"]').first.click()
            pg.locator('[data-testid="import-file-input"]').set_input_files(
                files=[{"name": name, "mimeType": mime, "buffer": payload}])
            # The wizard's own Import, scoped to its dialog: the page carries a second
            # "Import" button (the header door, data-tour="import") -- run 1 clicked it.
            go = pg.get_by_role("dialog").get_by_role("button", name="Import", exact=True)
            go.first.wait_for(state="visible", timeout=30000)
            wait_until(lambda: go.first.is_enabled(), 10)
            preview = pg.get_by_role("dialog").first.inner_text()[:800]
            go.first.click()
            pg.get_by_text("Import complete").first.wait_for(timeout=90000)
            summary = pg.get_by_role("dialog").first.inner_text()[:800]
            s = shot(pg, f"B5-{tag}")
            pg.get_by_role("dialog").get_by_role("button", name="Done", exact=True).first.click()
            pg.close()
            return preview, summary, s

        def by_title():
            out = {}
            for n in list_notes() or []:
                out.setdefault(n.get("title"), n)
            return out

        @guarded("B5_import_google_keep")
        def b5_keep():
            preview, summary, s = import_through_wizard("takeout-keep.zip", "application/zip",
                                                        zip_dir(FIX / "google-keep"), "keep")
            titles = by_title()
            w = titles.get("Watchlist")
            wn = get_note(w["id"]) if w else {}
            ok = bool(w and "Cut losers fast" in titles and "Old idea I deleted" not in titles
                      and task_items(wn.get("bodyJson")) == [["NVDA into earnings", True], ["DDOG base breakout", False]]
                      and "Trading" in (wn.get("tags") or []))
            record("B5_import_google_keep", "PASS" if ok else "FAIL", detected_in_preview="Google Keep" in preview,
                   preview=preview, summary=summary, watchlist_tasks=task_items(wn.get("bodyJson")),
                   watchlist_tags=wn.get("tags"), trash_note_imported="Old idea I deleted" in titles,
                   untitled_note_present="Cut losers fast" in titles, screenshot=s)

        @guarded("B5_import_logseq")
        def b5_logseq():
            preview, summary, s = import_through_wizard("logseq-graph.zip", "application/zip",
                                                        zip_dir(FIX / "logseq"), "logseq")
            titles = by_title()
            page = titles.get("Setups/VCP")
            pn = get_note(page["id"]) if page else {}
            backup_hits = api.get(base + "/api/j2/notes?q=backup").json()
            backup_titles = [n.get("title") for n in (backup_hits.get("notes") if isinstance(backup_hits, dict)
                                                      else backup_hits) or []]
            ok = bool(page and "2026-09-22" in titles and "2026-09-21" in titles
                      and task_items(pn.get("bodyJson")) == [["Backtest the last ten", False],
                                                               ["Write the entry rules", True]]
                      and {"setup", "swing"} <= set(pn.get("tags") or [])
                      and "::" not in (pn.get("bodyPlain") or pn.get("body_plain") or "")
                      and not backup_titles)
            record("B5_import_logseq", "PASS" if ok else "FAIL", detected_in_preview="Logseq" in preview,
                   preview=preview, summary=summary, page_tasks=task_items(pn.get("bodyJson")),
                   page_tags=pn.get("tags"), journals_present=["2026-09-22" in titles, "2026-09-21" in titles],
                   backup_copy_notes=backup_titles, screenshot=s)

        @guarded("B5_import_onenote_docx")
        def b5_onenote():
            payload = (FIX / "onenote" / "Weekly review.docx").read_bytes()
            preview, summary, s = import_through_wizard("Weekly review.docx", DOCX_MIME, payload, "onenote")
            titles = by_title()
            w = titles.get("Weekly review")
            wn = get_note(w["id"]) if w else {}
            plain = wn.get("bodyPlain") or wn.get("body_plain") or ""
            ok = bool(w and "Waiting for the reclaim before adding kept the loss small." in plain)
            record("B5_import_onenote_docx", "PASS" if ok else "FAIL", preview=preview, summary=summary,
                   note_found=bool(w), body_has_text="Waiting for the reclaim" in plain, screenshot=s)

        # ── B7 ──────────────────────────────────────────────────────────────
        @guarded("B7_autofill_no_key")
        def b7():
            note = mk_note(f"B7 autofill {run}", DOC(P("Long NVDA into earnings on 2026-10-14. Thesis is active.")))
            props = api.get(base + f"/api/j2/notes/{note['id']}/properties").json()
            before = get_note(note["id"])
            pg = open_note(new_page, note["id"])
            btn = pg.get_by_role("button", name="Suggest values with Compass")
            offered = wait_until(lambda: btn.count() > 0, 10)
            posted = {}
            if offered:
                with pg.expect_response(lambda r: r.url.endswith("/writing-help/autofill"), timeout=30000) as info:
                    btn.first.click()
                r = info.value
                posted = {"status": r.status, "body": (r.text() or "")[:300]}
            region = pg.get_by_role("region", name="Suggested values")
            shown = wait_until(lambda: region.count() > 0, 15)
            sentence = region.first.inner_text() if shown else ""
            s = shot(pg, "B7-autofill")
            pg.close()
            after = get_note(note["id"])
            unchanged = before.get("updatedAt") == after.get("updatedAt") and \
                before.get("bodyJson") == after.get("bodyJson")
            verdict = "FAIL" if not unchanged else "INCONCLUSIVE"
            record("B7_autofill_no_key", verdict,
                   reason="no model key in the sandbox: no model output can be observed here; the production "
                          "proof is after L1 (bench@)",
                   offered=bool(offered), route_answer=posted, panel_text=sentence[:400],
                   note_unchanged=unchanged, property_candidates=[
                       x.get("id") for x in (props.get("properties") if isinstance(props, dict) else props) or []
                       if isinstance(x, dict) and x.get("source") == "user_set" and x.get("value") in (None, "", [])][:6],
                   screenshot=s)

        # ── B6 (last: it switches the theme) ─────────────────────────────────
        @guarded("B6_graph_light_theme")
        def b6():
            # One LINKED pair, so the canvas paints the linked-node ink and an edge, not
            # only orphans (run 1: every walk note was unlinked, legend "0 links", and a
            # node-ink pixel count of 0 was the data, not the product). A link is an
            # inline `noteLink` node (notes.py, j2_note_links).
            target = mk_note(f"B6 target {run}", DOC(P("Linked to.")))
            mk_note(f"B6 source {run}", DOC({"type": "paragraph", "content": [
                {"type": "text", "text": "See "}, {"type": "noteLink", "attrs": {"noteId": target["id"]}}]}))
            graph = api.get(base + "/api/j2/notes/graph").json()
            pref = api.post(base + "/api/auth/preferences", data={"key": "theme", "value": "light"})
            pg = new_page()
            pg.goto(f"{base}/journal/notebook?view=all")
            H._dismiss_intro(pg)
            pg.get_by_role("button", name="Graph view", exact=True).first.click()
            canvas = pg.locator('canvas[aria-label^="Note graph"]')
            canvas.first.wait_for(state="visible", timeout=30000)
            pg.wait_for_timeout(2500)   # the bounded layout settles; the read below is of the stylesheet
            m = pg.evaluate("""() => {
              const cv = document.querySelector('canvas[aria-label^="Note graph"]');
              let el = cv, bg = 'rgba(0, 0, 0, 0)';
              while (el) { const c = getComputedStyle(el).backgroundColor;
                if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) { bg = c; break } el = el.parentElement }
              const inks = [...document.querySelectorAll('[data-graph-ink]')].map(e =>
                ({ name: e.dataset.graphInk, color: getComputedStyle(e).color }));
              // Pixels of each ink COLOUR on the canvas (orphan, label and edge share one).
              let painted = {};
              try {
                const ctx = cv.getContext('2d'); const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
                for (const ink of inks) {
                  const nums = (ink.color.match(/[\\d.]+/g) || []).map(Number);
                  let hits = 0;
                  for (let i = 0; i < d.length; i += 4)
                    if (Math.abs(d[i]-nums[0]) <= 3 && Math.abs(d[i+1]-nums[1]) <= 3 && Math.abs(d[i+2]-nums[2]) <= 3 && d[i+3] > 200) hits++;
                  painted[ink.name] = hits;
                }
              } catch (e) { painted = 'unreadable: ' + e.message }
              return { theme: document.documentElement.dataset.theme, bg, inks,
                       ring: getComputedStyle(cv).color, painted };
            }""")
            text_inks = {"label", "labelHover"}
            rows = []
            for ink in m["inks"]:
                ratio = contrast(ink["color"], m["bg"])
                need = 4.5 if ink["name"] in text_inks else 3.0
                rows.append({**ink, "ratio": ratio, "min": need, "ok": ratio is not None and ratio >= need})
            ring = contrast(m["ring"], m["bg"])
            s = shot(pg, "B6-graph-light")
            pg.close()
            api.post(base + "/api/auth/preferences", data={"key": "theme", "value": "dark"})
            painted = m["painted"] if isinstance(m["painted"], dict) else {}
            edges = len(graph.get("edges") or [])
            ok = bool(pref.ok and m["theme"] == "light" and rows and all(r["ok"] for r in rows)
                      and len(rows) == 7 and ring and ring >= 3.0 and edges >= 1
                      and painted.get("node", 0) > 0 and painted.get("orphan", 0) > 0)
            record("B6_graph_light_theme", "PASS" if ok else "FAIL", theme=m["theme"], surface=m["bg"],
                   inks=rows, ring={"color": m["ring"], "ratio": ring}, graph_edges=edges,
                   ink_pixels_on_canvas=m["painted"], screenshot=s)

        # ── fix round 1: B9 / B9b (review I-2) ─────────────────────────────────
        def wide_table_note(title):
            """Three 400 px columns: a table the Wider button can make, and wider than
            the note column at every viewport the walk measures."""
            def cell(kind, t):
                return {"type": kind, "attrs": {"colspan": 1, "rowspan": 1, "colwidth": [400]}, "content": [P(t)]}
            rows = [["Ticker", "Thesis", "Stop"], ["NVDA", "Data-centre demand", "98.5"],
                    ["AMD", "Share gains", "9.1"]]
            table = {"type": "table", "content": [
                {"type": "tableRow", "content": [cell("tableHeader" if i == 0 else "tableCell", t) for t in r]}
                for i, r in enumerate(rows)]}
            return mk_note(title, DOC(P("A resized table."), table))

        # The voice first-run hint (VoiceInputButton, a one-time popover in the toolbar)
        # is marked seen in every B9 browser: it is a pre-existing, dismissable popover
        # that sticks out of the toolbar until tapped, and B9 measures the TABLE. The
        # control note (same page, no table) is what separates the two either way.
        HINT_SEEN = "try { localStorage.setItem('voice.dictation.hintSeen', '1') } catch (e) {}"

        @guarded("B9_table_scrolls_not_the_page")
        def b9():
            note = wide_table_note(f"B9 table {run}")
            control = mk_note(f"B9 control {run}", DOC(P("A resized table.")))
            per = {}
            for width, height, touch in ((390, 844, True), (820, 1180, True), (1200, 800, False)):
                ctx = browser.new_context(viewport={"width": width, "height": height}, has_touch=touch,
                                          is_mobile=width <= 640, storage_state=member.storage_state())
                ctx.add_init_script(HINT_SEEN)
                pgc = open_note(pages_of(ctx), control["id"])
                pgc.wait_for_timeout(800)
                c = pgc.evaluate(LAYOUT_JS)
                pgc.close()
                pg = open_note(pages_of(ctx), note["id"])
                pg.locator(".ProseMirror .tableWrapper").first.wait_for(state="attached", timeout=15000)
                pg.wait_for_timeout(800)
                m = pg.evaluate(LAYOUT_JS)
                ok, facts = table_verdict(m, c)
                per[str(width)] = {"ok": ok, **facts, "table": m, "control_scrollers": c.get("scrollers"),
                                   "shot": shot(pg, f"B9-{width}")}
                ctx.close()
            ok = all(v["ok"] for v in per.values())
            record("B9_table_scrolls_not_the_page", "PASS" if ok else "FAIL", widths=per)

        @guarded("B9b_shared_table_scrolls_not_the_page")
        def b9b():
            note = wide_table_note(f"B9b shared {run}")
            control = mk_note(f"B9b control {run}", DOC(P("A resized table.")))
            tokens = {}
            for key, n in (("table", note), ("control", control)):
                r = api.post(base + f"/api/j2/notes/{n['id']}/share", data={})
                if not r.ok:
                    record("B9b_shared_table_scrolls_not_the_page", "INCONCLUSIVE",
                           reason=f"minting a share link answered HTTP {r.status} (is J2_SHARE_LINKS_ENABLED set?)",
                           body=r.text()[:200])
                    return
                tokens[key] = (r.json().get("share") or {}).get("token")
            stranger = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
            stranger.add_init_script(HINT_SEEN)
            reads = {}
            for key in ("control", "table"):
                pg = pages_of(stranger)()
                pg.goto(f"{base}/share/n/{tokens[key]}")
                H._dismiss_intro(pg)
                pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                if key == "table":
                    pg.locator(".ProseMirror .tableWrapper").first.wait_for(state="attached", timeout=30000)
                pg.wait_for_timeout(800)
                reads[key] = pg.evaluate(LAYOUT_JS)
                reads[key + "_shot"] = shot(pg, f"B9b-shared-{key}-390")
                pg.close()
            stranger.close()
            for n in (note, control):
                api.delete(base + f"/api/j2/notes/{n['id']}/share")
            ok, facts = table_verdict(reads["table"], reads["control"])
            record("B9b_shared_table_scrolls_not_the_page", "PASS" if ok else "FAIL", **facts,
                   table=reads["table"], control_scrollers=reads["control"].get("scrollers"),
                   shots=[reads["control_shot"], reads["table_shot"]])

        # A PRE-EXISTING layout fact, measured and reported, not graded: the Notebook page
        # at 390 px WITHOUT any table, and with the voice hint NOT yet seen -- so the
        # report can say what the page's own chrome does, apart from the table.
        @guarded("B9c_page_chrome_at_390_no_table")
        def b9c():
            control = mk_note(f"B9c chrome {run}", DOC(P("No table here.")))
            out = {}
            for label, seen in (("hint_not_seen", False), ("hint_seen", True)):
                ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                          storage_state=member.storage_state())
                if seen:
                    ctx.add_init_script(HINT_SEEN)
                pg = open_note(pages_of(ctx), control["id"])
                pg.wait_for_timeout(800)
                out[label] = pg.evaluate(LAYOUT_JS).get("scrollers")
                out[label + "_shot"] = shot(pg, f"B9c-{label}")
                ctx.close()
            record("B9c_page_chrome_at_390_no_table", "INCONCLUSIVE", reason="reported, not graded: pre-existing "
                   "page chrome, no table involved", **out)

        # ── fix round 1: B10 (review M-5) ──────────────────────────────────────
        UNDO_JS = """() => {
          const b = document.querySelector('button[aria-label="Undo"]');
          const row = document.querySelector('[role="toolbar"][aria-label="Editor toolbar"]');
          if (!b) return { present: false };
          const r = b.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          const rr = row ? row.getBoundingClientRect() : null;
          const sn = b.parentElement && b.parentElement.previousElementSibling;
          const sr = sn ? sn.getBoundingClientRect() : null;
          return { present: true,
                   sentinel: sr && { top: Math.round(sr.top), bottom: Math.round(sr.bottom),
                     height: Math.round(sr.height), display: getComputedStyle(sn).display, cls: String(sn.className) }, rect: { left: Math.round(r.left), top: Math.round(r.top),
                     right: Math.round(r.right), bottom: Math.round(r.bottom) },
                   centre: [cx, cy], inViewport: r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0
                     && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
                   fingerLandsOnIt: !!hit && (hit === b || b.contains(hit)),
                   hitTag: hit ? hit.tagName + '.' + String(hit.className).slice(0, 40) : null,
                   floating: !!b.closest('[data-history-floating]'),
                   toolbarRowBottom: rr ? Math.round(rr.bottom) : null,
                   innerHeight: window.innerHeight };
        }"""

        @guarded("B10_touch_undo_reachable_after_60_lines")
        def b10():
            note = mk_note(f"B10 history {run}", DOC(P("Start.")))
            touch = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                        device_scale_factor=2, storage_state=member.storage_state())
            pg = open_note(pages_of(touch), note["id"])
            pg.locator(".ProseMirror").first.tap()
            pg.keyboard.press("Control+End")
            at_top = pg.evaluate(UNDO_JS)
            for i in range(1, 61):
                pg.keyboard.press("Enter")
                pg.keyboard.type(f"Line {i} of the walk", delay=4)
            typed = wait_until(lambda: "Line 60 of the walk" in editor_text(pg), 10)
            pg.wait_for_timeout(900)   # past prosemirror-history's 500 ms grouping window
            m = pg.evaluate(UNDO_JS)
            s = shot(pg, "B10-390-after-60-lines")
            undone = None
            if m.get("present") and m.get("inViewport"):
                # a finger at the button's centre -- no auto-scroll, unlike a locator tap
                pg.touchscreen.tap(m["centre"][0], m["centre"][1])
                undone = wait_until(lambda: "Line 60 of the walk" not in editor_text(pg), 5)
            # and with its place in the row back on screen, the pair is IN the row again
            # (not left floating): scroll the pair's place (the sentinel before it) into view
            pg.evaluate("""() => { const b = document.querySelector('button[aria-label="Undo"]');
              const sn = b && b.parentElement && b.parentElement.previousElementSibling;
              if (sn) sn.scrollIntoView({ block: 'center' }) }""")
            pg.wait_for_timeout(600)
            back = pg.evaluate(UNDO_JS)
            s2 = shot(pg, "B10-390-back-at-top")
            touch.close()
            scrolled_away = m.get("toolbarRowBottom") is not None and m["toolbarRowBottom"] <= 48
            ok = bool(typed and scrolled_away and m.get("inViewport") and m.get("fingerLandsOnIt") and undone
                      and m.get("floating") and back.get("present") and not back.get("floating"))
            record("B10_touch_undo_reachable_after_60_lines", "PASS" if ok else "FAIL", typed=bool(typed),
                   toolbar_scrolled_away=scrolled_away, before_typing=at_top, after_typing=m,
                   tap_at_centre_undid=bool(undone), back_at_top=back, screenshots=[s, s2])

        rows = (b1, b2, b3, b4, b5_keep, b5_logseq, b5_onenote, b7, b9, b9b, b9c, b10, b6)
        for fn in rows:
            if ONLY and not any(fn.key.startswith(o) for o in ONLY):
                continue
            fn()
        browser.close()

    errs = res["errors"]
    record("B8_no_page_errors", "PASS" if not errs else "FAIL", page_errors=len(errs), first=errs[:5])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wave 10 lane 10B live walk (see the module header).")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8212)
    ap.add_argument("--out", required=True, help="the evidence JSON")
    ap.add_argument("--tip", default=None)
    ap.add_argument("--artifacts", required=True, help="a scratch directory for screenshots and the launcher log")
    ap.add_argument("--only", default="", help="comma-separated row-key prefixes, e.g. B9,B10 (default: every row)")
    ap.add_argument("--no-hold", action="store_true",
                    help="do NOT hold the sandbox to its +120 s checkpoint (a mutant-build run only; "
                         "never the evidence run)")
    args = ap.parse_args(argv)
    ONLY[:] = [s.strip() for s in args.only.split(",") if s.strip()]
    res["only"] = list(ONLY)
    required = [c for c in REQUIRED if not (args.no_hold and c == H.PREWARM)]
    base = f"http://127.0.0.1:{args.port}"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    art = Path(args.artifacts)
    art.mkdir(parents=True, exist_ok=True)
    res.update({"tip": args.tip, "base": base, "data_dir": args.data_dir,
                "instrument": os.path.relpath(__file__, REPO),
                "walk_process_env": {k: bool(os.environ.get(k)) for k in (
                    "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED", "NOTEBOOK_WRITING_HELP_ENABLED",
                    "J2_SHARE_LINKS_ENABLED", "ANTHROPIC_API_KEY", "OPENAI_API_KEY")}})

    refused = H.refuse_shared_root(args.data_dir)
    if not refused and H.port_busy(args.port):
        refused = f"port {args.port} already has a listener (never killed)"
    if refused:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: {refused})")
        return 3

    sb = H.Sandbox(args.data_dir, args.port, art / "launcher.log")
    not_run = None
    try:
        sb.start()
        if not sb.wait_healthy(base, 300):
            not_run = "the sandbox never answered /api/health"
        else:
            sb.wait_checkpoint(H.POST_BOOT, H.POST_BOOT_WAIT_S)
            v = sandbox_identity.verify(base, sb.integrity_path())
            res["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
            if not v.ok:
                not_run = v.sentence
            else:
                try:
                    run_walk(base, art)
                except Exception as e:  # noqa: BLE001 -- setup failed; the sandbox still owes its verdict
                    not_run = f"{type(e).__name__}: {e}"
                    res["traceback"] = traceback.format_exc()[-2000:]
                if not args.no_hold:
                    # Review M-8: the evidence run's integrity line must cover +120 s too.
                    res["prewarm_checkpoint_reached"] = sb.wait_checkpoint(H.PREWARM, H.PREWARM_WAIT_S)
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        integ = H.read_integrity(ipath, required)
        kept = None
        if ipath and Path(ipath).is_file():
            kept = out.with_suffix(".integrity.md")
            shutil.move(ipath, kept)
            integ["path"] = str(kept)
        first = H.integrity_line(integ, not_run=not_run)
        res.update({"first_line": first, "integrity": integ, "not_run": not_run})
        out.write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
        print(first)
        for line in LINES:
            print(line)
        print(f"evidence: {out}")

    if not_run:
        return 3
    verdicts = {k: v["verdict"] for k, v in res["checks"].items()}
    if any(v == "FAIL" for v in verdicts.values()):
        return 1
    if not integ.get("clean") or any(v == "INCONCLUSIVE" and k not in BY_CONSTRUCTION for k, v in verdicts.items()):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
