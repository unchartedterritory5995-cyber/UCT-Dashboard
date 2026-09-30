"""Lane DR-R -- the re-review's own live walk (wave 10 10/10 program, clause 6a).

Re-covers every surface the first review (`docs/notebook/design-review.md`, lane 10E-2,
tree fa6710394) covered -- list and sidebar, editor, all seven view modes, templates,
share and publish, search, phone -- at 390 / 820 / 1200, hands-on in a fresh sandbox at
THIS tree, using the first review's own measured facts: page-level horizontal overflow,
targets under 24px (44px on touch widths), and the visible headings
(`docs/notebook/proof/e2-d9e887ca0/design/uct_captures.py` -- OVERFLOW_JS/TARGETS_JS
carried over verbatim from `docs/notebook/evidence/a11y-second-review-2026-09-27/kbd_lib.py`,
the first review's own instrument).

It also re-derives, fresh, the closure evidence for D-2 (coachmark overlap, on a
never-visited member), D-3 (editor row count / Delete placement, embedding lane K2's own
measurement JS verbatim from `docs/notebook/proof/drb-instrument/drb_d3_measure.py`), and
D-5 (board scroll cue + overflow past the 4th column). D-1, D-4 and D-6 are read off this
same walk's general capture (D-1: the first screen's own heading order at 390; D-4: the
templates surface's breadth; D-6: the targets_lt_24/44 counts on every surface).

Boots its OWN sandbox (tools/notebook_perf_harness.Sandbox, the same launcher DR-A/DR-B/
DR-C used) rather than depending on any other lane's instance, with the SAME production-
armed flag set the first review used
(`docs/notebook/proof/e2-d9e887ca0/e2_sandbox.py::FLAGS`, no model key) so share/publish
are reachable and Ask/Writing-help answer their own failure sentence, which is what this
review reads them for.

    python docs/notebook/proof/drr-instrument/drr_walk.py --data-dir 'C:\\...\\drr-data' \\
        --port 8391 --out docs/notebook/proof/drr-<sha>/record.json \\
        --art docs/notebook/proof/drr-<sha>/shots --tip <sha>

Exit: 0 = ran end to end (rows may still individually record a finding -- read them);
2 = sandbox integrity not CLEAN; 3 = refused or never started.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools"))
sys.path.insert(0, str(REPO / "docs" / "notebook" / "proof" / "drb-instrument"))
import notebook_perf_harness as H  # noqa: E402
import drb_d3_measure as DRB  # noqa: E402  (MEASURE_JS / INSIDE_MORE_JS, D-3's own instrument)

WALK_EMAIL, WALK_PW = "drrwalk@local.dev", "LocalTest2026!"
FRESH_EMAIL, FRESH_PW = "drr-fresh@local.dev", "LocalTest2026!"
WIDTHS = ((390, 844, True), (820, 1180, True), (1200, 900, False))

# The first review's own production-armed flag set (docs/notebook/proof/e2-d9e887ca0/
# e2_sandbox.py::FLAGS), no model key -- kept verbatim so method matches method.
FLAGS = {
    "J2_SHARE_LINKS_ENABLED": "1",
    "NOTEBOOK_PUBLISH_ENABLED": "1",
    "NOTEBOOK_ONBOARDING_ENABLED": "1",
    "NOTEBOOK_PERSONAL_API_ENABLED": "1",
    "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "1",
    "NOTEBOOK_WRITING_HELP_ENABLED": "1",
    "NOTEBOOK_ASK_INSERT_ON": "1",
    "NOTEBOOK_INBOUND_EMAIL_ENABLED": "1",
    "ANTHROPIC_API_KEY": "",
    "OPENAI_API_KEY": "",
}

# ── the first review's own measured facts (carried over verbatim) ───────────────────────
OVERFLOW_JS = r"""
() => {
  const de = document.documentElement;
  const main = document.querySelector('main') || document.querySelector('[class*="main"]');
  return {docScrollW: de.scrollWidth, docClientW: de.clientWidth,
          bodyScrollW: document.body.scrollWidth,
          mainScrollW: main ? main.scrollWidth : null, mainClientW: main ? main.clientWidth : null};
}
"""

TARGETS_JS = r"""
(minPx) => {
  const sel = 'a[href],button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="checkbox"],[role="switch"],[tabindex]:not([tabindex="-1"])';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (r.width < minPx || r.height < minPx) {
      const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').replace(/\s+/g,' ').trim().slice(0, 50);
      out.push({tag: el.tagName.toLowerCase(), name, w: Math.round(r.width), h: Math.round(r.height)});
    }
  }
  return out;
}
"""

HEADS_JS = "() => Array.from(document.querySelectorAll('h1,h2')).filter(h => h.getBoundingClientRect().width > 0).map(h => h.textContent.trim().slice(0, 60)).slice(0, 8)"

BOARD_STATE_JS = r"""() => {
  const firstCol = document.querySelector('section[aria-label]');
  const el = firstCol ? firstCol.parentElement : null;
  if (!el) return { found: false };
  return { found: true, cue: el.getAttribute('data-board-scroll-more'),
           columns: document.querySelectorAll('section[aria-label]').length,
           scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
}"""

# D-2's own probe (dra-instrument/dra_walk.py::COACHMARK_JS), reproduced here so this walk
# owns its own fresh-member run rather than importing a script whose own main() drives a
# different sandbox.
COACHMARK_JS = r"""() => {
  const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el);
    return el.getClientRects().length > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
             right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) }; };
  const card = document.querySelector('[data-orb-coachmark]');
  const cardVis = vis(card);
  const cardBox = cardVis ? box(card) : null;
  const slot = document.querySelector('[data-first-run-slot]');
  const candSel = ['[data-note-card-id]', 'button', 'a[href]', 'input', 'select', 'textarea',
                   '[role="button"]', '.ProseMirror'];
  const seen = new Set();
  const overlaps = [];
  if (cardBox) {
    for (const sel of candSel) {
      for (const el of document.querySelectorAll(sel)) {
        if (slot && slot.contains(el)) continue;
        if (card.contains(el) || el.contains(card)) continue;
        if (seen.has(el)) continue;
        if (!vis(el)) continue;
        const b = box(el);
        if (!b || b.width === 0 || b.height === 0) continue;
        const ox = Math.max(0, Math.min(cardBox.right, b.right) - Math.max(cardBox.left, b.left));
        const oy = Math.max(0, Math.min(cardBox.bottom, b.bottom) - Math.max(cardBox.top, b.top));
        if (ox > 2 && oy > 2) {
          seen.add(el);
          overlaps.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 50), box: b,
                          overlap_px: { x: Math.round(ox), y: Math.round(oy) } });
        }
      }
    }
  }
  return { present: !!card, visible: cardVis, box: cardBox, overlaps: overlaps.slice(0, 8) };
}"""


def _capture(pg, tag: str, width: int, touch: bool, out_dir: Path, rows: list, shot_only: bool = False) -> dict:
    fname = f"drr-{tag}-{width}.png"
    pg.screenshot(path=str(out_dir / fname))
    row = {"surface": tag, "width": width, "touch": touch, "shot": fname}
    if not shot_only:
        ov = pg.evaluate(OVERFLOW_JS)
        row["overflow_px"] = ov["docScrollW"] - ov["docClientW"]
        row["targets_lt_24"] = len(pg.evaluate(TARGETS_JS, 24))
        row["targets_lt_44"] = len(pg.evaluate(TARGETS_JS, 44)) if touch else None
        row["headings"] = pg.evaluate(HEADS_JS)
    rows.append(row)
    print(json.dumps(row), flush=True)
    return row


def _seed(req, base: str) -> dict:
    """Everything through the app's OWN doors -- notes, properties, share, publish."""
    fr = req.post(base + "/api/j2/note-folders", data={"name": "Research"})
    folder_id = fr.json().get("folder", {}).get("id") if fr.status in (200, 201) else None

    def mk(title, ticker=None, folder=False, tags=None):
        body = {"type": "doc", "content": [{"type": "paragraph", "content": [
            {"type": "text", "text": f"{title} -- seeded for the DR-R design re-review."}]}]}
        payload = {"title": title, "bodyJson": body}
        if ticker:
            payload["ticker"] = ticker
        if folder and folder_id:
            payload["folderId"] = folder_id
        if tags:
            payload["tags"] = tags
        r = req.post(base + "/api/j2/notes", data=payload)
        return r.json().get("note", {}).get("id") if r.status in (200, 201) else None

    n1 = mk("Alpha thesis NVDA", ticker="NVDA", folder=True, tags=["swing", "ai"])
    n2 = mk("Beta thesis AMD", ticker="AMD")
    n3 = mk("Gamma thesis TSLA")
    n4 = mk("Delta thesis MSFT")
    n5 = mk("Epsilon thesis AAPL")  # left with NO thesis_status -- the board's "No value" column
    n6 = mk("Trade checklist -- AMD add")

    status = {n1: "active", n2: "watching", n3: "invalidated", n4: "closed"}
    for nid, val in status.items():
        if nid:
            req.put(base + f"/api/j2/notes/{nid}", data={"properties": {"builtin:thesis_status": val}})
    today = time.strftime("%Y-%m-%d")
    if n1:
        req.put(base + f"/api/j2/notes/{n1}", data={"properties": {"builtin:review_date": today}})
    if n2:
        import datetime
        later = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
        req.put(base + f"/api/j2/notes/{n2}", data={"properties": {"builtin:review_date": later}})

    # Share + publish -- through the app's own doors, so the Share sheet has real state
    # to show at every width rather than an empty first-run panel.
    share_status = req.post(base + f"/api/j2/notes/{n1}/share", data={}).status if n1 else None
    pub_status = req.post(base + f"/api/j2/publish/notes/{n1}", data={}).status if n1 else None

    return {"folder_id": folder_id, "n1": n1, "n2": n2, "n3": n3, "n4": n4, "n5": n5, "n6": n6,
            "share_status": share_status, "publish_status": pub_status}


def _add_link_and_tasks(pg, base: str, ids: dict) -> dict:
    """Real editor typing (not raw JSON) so the graph's edge and the tasks view's rows are
    exactly what a member's own session would leave."""
    out = {}
    pg.goto(f"{base}/journal/notebook?note={ids['n1']}")
    H._dismiss_intro(pg)
    pg.wait_for_selector(".ProseMirror", timeout=20000)
    pm = pg.locator(".ProseMirror")
    pm.click()
    pg.keyboard.press("End")
    pg.keyboard.type(" See ")
    pg.keyboard.type("[[Beta thesis AMD")
    pg.wait_for_timeout(500)
    try:
        pg.get_by_role("option", name="Beta thesis AMD").first.click(timeout=3000)
        out["link_inserted"] = True
    except Exception as e:  # noqa: BLE001
        pg.keyboard.press("Escape")
        out["link_inserted"] = False
        out["link_error"] = str(e)[:200]
    pg.wait_for_timeout(400)

    pg.goto(f"{base}/journal/notebook?note={ids['n6']}")
    H._dismiss_intro(pg)
    pg.wait_for_selector(".ProseMirror", timeout=20000)
    pg.locator(".ProseMirror").click()
    pg.keyboard.press("End")
    pg.keyboard.type("\n[ ] Confirm the stop is under the swing low\n")
    pg.keyboard.type("[ ] Trim a third at the first target\n")
    pg.wait_for_timeout(400)
    out["task_items"] = pg.locator(".ProseMirror li[data-checked]").count()
    return out


def _d3_measure(pg, base: str, note_id: str, width: int) -> dict:
    pg.goto(f"{base}/journal/notebook?note={note_id}")
    H._dismiss_intro(pg)
    pg.wait_for_selector("[data-note-title]", state="attached", timeout=15000)
    pg.wait_for_timeout(1500)
    row = pg.evaluate(DRB.MEASURE_JS)
    if not row.get("delete_on_screen") and row.get("more_note_actions"):
        pg.locator('button[aria-label="More note actions"]').first.click()
        pg.wait_for_timeout(400)
        row["inside_more_note_actions"] = pg.evaluate(DRB.INSIDE_MORE_JS)
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(200)
    return row


def _d2_probe(pg, base: str, width: int, out_dir: Path) -> dict:
    pg.goto(f"{base}/journal/notebook?view=all")
    H._dismiss_intro(pg)
    pg.wait_for_timeout(2000)
    row = pg.evaluate(COACHMARK_JS)
    pg.screenshot(path=str(out_dir / f"drr-d2-coachmark-{width}.png"))
    return row


def _walk_views(pg, base: str, width: int, touch: bool, out_dir: Path, rows: list) -> None:
    pg.goto(f"{base}/journal/notebook?view=all")
    H._dismiss_intro(pg)
    pg.wait_for_timeout(1500)
    _capture(pg, "list", width, touch, out_dir, rows)

    for view_id, label in (("table", "Table view"), ("board", "Board view"),
                            ("calendar", "Calendar view"), ("graph", "Graph view"),
                            ("timeline", "Timeline view")):
        try:
            pg.get_by_role("button", name=label, exact=True).click(timeout=8000)
            pg.wait_for_timeout(1200)
        except Exception as e:  # noqa: BLE001
            rows.append({"surface": view_id, "width": width, "error": f"could not switch: {e}"[:200]})
            continue
        row = _capture(pg, view_id, width, touch, out_dir, rows)
        if view_id == "board":
            row["board_state"] = pg.evaluate(BOARD_STATE_JS)

    pg.goto(f"{base}/journal/notebook?view=tasks")
    H._dismiss_intro(pg)
    pg.wait_for_timeout(1200)
    _capture(pg, "tasks", width, touch, out_dir, rows)


def _walk_templates(pg, base: str, width: int, touch: bool, out_dir: Path, rows: list) -> None:
    pg.goto(f"{base}/journal/notebook?view=all")
    H._dismiss_intro(pg)
    pg.wait_for_timeout(1200)
    try:
        if pg.locator("[data-template-gallery]").count() == 0:
            pg.get_by_role("button", name="Templates", exact=True).click(timeout=8000)
        pg.wait_for_selector("[data-template-gallery]", timeout=10000)
    except Exception as e:  # noqa: BLE001
        rows.append({"surface": "templates", "width": width, "error": f"gallery never opened: {e}"[:200]})
        return
    pg.wait_for_timeout(500)
    row = _capture(pg, "templates", width, touch, out_dir, rows)
    row["builtin_card_count"] = pg.locator("[data-template-key]").count()
    pg.keyboard.press("Escape")


def _walk_search(pg, base: str, width: int, touch: bool, out_dir: Path, rows: list) -> None:
    pg.goto(f"{base}/journal/notebook?view=all")
    H._dismiss_intro(pg)
    pg.wait_for_timeout(1200)
    try:
        pg.get_by_role("tab", name="Search notes", exact=True).click(timeout=5000)
        box = pg.get_by_label("Search your notes")
        box.click(timeout=5000)
        box.fill("thesis")
        pg.wait_for_timeout(700)
        row = _capture(pg, "search-sidebar", width, touch, out_dir, rows)
        row["best_matches_present"] = pg.locator('[role="group"][aria-label="Best matches"]').count() > 0
        box.fill("")
    except Exception as e:  # noqa: BLE001
        rows.append({"surface": "search-sidebar", "width": width, "error": str(e)[:200]})

    try:
        pg.keyboard.press("Control+k")
        pg.wait_for_selector('[role="dialog"][aria-label="Command palette"]', timeout=5000)
        pg.keyboard.type("amd")
        pg.wait_for_timeout(700)
        row = _capture(pg, "search-palette", width, touch, out_dir, rows)
        row["best_matches_present"] = pg.locator('[role="listbox"][aria-label="Search results"]').count() > 0
        pg.keyboard.press("Escape")
    except Exception as e:  # noqa: BLE001
        rows.append({"surface": "search-palette", "width": width, "error": str(e)[:200]})


def _walk_share(pg, base: str, width: int, touch: bool, ids: dict, out_dir: Path, rows: list) -> None:
    pg.goto(f"{base}/journal/notebook?note={ids['n1']}")
    H._dismiss_intro(pg)
    pg.wait_for_selector("[data-note-title]", timeout=15000)
    pg.wait_for_timeout(800)
    try:
        pg.get_by_role("button", name="Share", exact=True).click(timeout=8000)
        pg.wait_for_selector('[aria-label="Share this note"]', timeout=8000)
        pg.wait_for_timeout(500)
        row = _capture(pg, "share-publish", width, touch, out_dir, rows)
        row["seeded_share_status"] = ids.get("share_status")
        row["seeded_publish_status"] = ids.get("publish_status")
        pg.keyboard.press("Escape")
    except Exception as e:  # noqa: BLE001
        rows.append({"surface": "share-publish", "width": width, "error": str(e)[:200]})


def _d1_phone_first_screen(pg, base: str, ids: dict, out_dir: Path, rows: list) -> None:
    """D-1's own condition: a cold `?note=` URL at 390 -- does the note or the folder panel
    own the first screen. `Full navigation`, not an in-app route change."""
    pg.goto(f"{base}/journal/notebook?note={ids['n1']}", wait_until="domcontentloaded")
    H._dismiss_intro(pg)
    pg.wait_for_timeout(2000)
    row = _capture(pg, "phone-cold-note-url", 390, True, out_dir, rows)
    row["title_input_visible"] = pg.locator("[data-note-title]").is_visible()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--art", required=True)
    ap.add_argument("--tip", default=None)
    args = ap.parse_args(argv)

    why = H.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if H.port_busy(args.port):
        print(f"REFUSED: port {args.port} is already answering")
        return 3

    out_dir = Path(args.art)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{args.port}"
    os.environ.update(FLAGS)

    sb = H.Sandbox(args.data_dir, args.port, out_dir / "sandbox.log")
    rows: list[dict] = []
    errors: list[str] = []
    setup_error: str | None = None
    d2_rows: dict = {}
    d3_rows: dict = {}
    ids: dict = {}
    link_task: dict = {}
    started = False
    try:
        sb.start()
        started = True
        if not sb.wait_healthy(base, 240.0):
            setup_error = "sandbox never answered /api/health"
        else:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                br = pw.chromium.launch()
                admin_ctx = br.new_context()
                seed_ctx = br.new_context(viewport={"width": 1280, "height": 900})
                try:
                    H._provision(admin_ctx.request, seed_ctx.request, base, member=(WALK_EMAIL, WALK_PW, "drr walk"))
                except H.SetupFailed as e:
                    setup_error = str(e)
                if setup_error is None:
                    ids = _seed(seed_ctx.request, base)
                    seed_pg = seed_ctx.new_page()
                    seed_pg.on("pageerror", lambda e: errors.append(f"pageerror: {str(e)[:300]}"))
                    link_task = _add_link_and_tasks(seed_pg, base, ids)
                    seed_pg.close()

                    for width, height, touch in WIDTHS:
                        ctx = br.new_context(viewport={"width": width, "height": height},
                                              has_touch=touch, is_mobile=touch and width < 700)
                        H._signup_or_login(ctx.request, base, WALK_EMAIL, WALK_PW, "drr walk")
                        pg = ctx.new_page()
                        pg.on("pageerror", lambda e: errors.append(f"pageerror {width}: {str(e)[:300]}"))
                        try:
                            _walk_views(pg, base, width, touch, out_dir, rows)
                            pg.goto(f"{base}/journal/notebook?note={ids['n1']}")
                            H._dismiss_intro(pg)
                            pg.wait_for_selector("[data-note-title]", timeout=15000)
                            pg.wait_for_timeout(1200)
                            _capture(pg, "editor", width, touch, out_dir, rows)
                            if width == 1200:
                                d3_rows["editor"] = _d3_measure(pg, base, ids["n1"], width)
                            _walk_templates(pg, base, width, touch, out_dir, rows)
                            _walk_search(pg, base, width, touch, out_dir, rows)
                            _walk_share(pg, base, width, touch, ids, out_dir, rows)
                            if width == 390:
                                _d1_phone_first_screen(pg, base, ids, out_dir, rows)
                        except Exception as e:  # noqa: BLE001
                            errors.append(f"width {width}: {type(e).__name__}: {e}")
                            traceback.print_exc()
                        ctx.close()

                    # D-2: a FRESH member, never visited the notebook, at 390 and 1200.
                    for width, height, touch in ((390, 844, True), (1200, 900, False)):
                        try:
                            fctx = br.new_context(viewport={"width": width, "height": height},
                                                   has_touch=touch, is_mobile=touch and width < 700)
                            H._signup_or_login(fctx.request, base, FRESH_EMAIL, FRESH_PW, "drr fresh")
                            admin_ctx.request.post(base + "/api/auth/admin/comp-access",
                                                    data={"email": FRESH_EMAIL, "action": "grant"})
                            admin_ctx.request.post(base + "/api/auth/admin/verify-email",
                                                    data={"email": FRESH_EMAIL})
                            fpg = fctx.new_page()
                            d2_rows[str(width)] = _d2_probe(fpg, base, width, out_dir)
                            fctx.close()
                        except Exception as e:  # noqa: BLE001
                            errors.append(f"D-2 width {width}: {type(e).__name__}: {e}")
                br.close()
        if setup_error is None:
            sb.wait_checkpoint(H.PREWARM, H.PREWARM_WAIT_S)
    finally:
        stop_how = sb.stop() if started else "never-started"

    integ = H.read_integrity(sb.integrity_path(), required=["pre-boot (baseline)", "shutdown"])
    line = H.integrity_line(integ, note=f"stop: {stop_how}", not_run=setup_error)
    print(line)

    record = {
        "walk": "notebook-drr",
        "tip": args.tip,
        "data_dir": args.data_dir,
        "port": args.port,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "setup_error": setup_error,
        "seed": ids,
        "seed_link_task": link_task,
        "rows": rows,
        "d2_coachmark": d2_rows,
        "d3_editor_rows": d3_rows,
        "errors": errors,
        "sandbox_integrity": integ,
        "sandbox_log": str(out_dir / "sandbox.log"),
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(record, indent=2, default=str), encoding="utf-8")
    print(f"record: {args.out}")

    if setup_error:
        return 3
    if not integ.get("clean"):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
