"""Lane DR-A -- real-browser confirmation of design-review D-2, D-5 (keyboard/touch) and
D-6 (per-target verdict table) at the CURRENT tip.

Code review (before writing anything here) found D-1, D-2, D-5 and D-6 already fixed by
prior wave 10 lanes, each with its own committed instrument and evidence:
  * D-1  lane D2 (#242, commit f4cec49be): JournalLayout.compactHeader.test.jsx +
         NotebookTab.phoneNote.test.jsx + docs/notebook/proof/d2-instrument/d2_phone_measure.py.
         Re-run fresh at this tip: docs/notebook/proof/dra-<sha>/d1-phone-measure.json.
  * D-2  lane F5 (#228) put the "Meet Compass" card in the page flow
         (components/firstRun/firstRunStage.js, Layout.jsx's `data-first-run-slot`).
  * D-5  F5 + "D5 fix round 1/2" (NoteBoardView.jsx's `data-board-scroll-more` mask) +
         docs/notebook/proof/notebook_d5_scroll_probe.py.
  * D-6  F5 + D3P + L3 + K2 + WK + WK2: app/src/pages/journal-2-0/a11y/targetFloors.test.js
         is the structural rail (green, 42 tests) for every tracked target.

This script does NOT re-implement those fixes. It adds the real-browser confirmation the
task asks for that no committed instrument already produces:
  * D-2   the coachmark's box vs. the surface's own content, at 390 (list) and 1200
          (editor), on a FRESH member (coachmark unseen) -- does it overlap a control,
          is it dismissible, is the dismissal remembered across a reload.
  * D-5x  the scroll cue answers a KEYBOARD tab into an off-screen column (native
          scrollIntoView-on-focus) and a wheel-driven horizontal scroll (the closest a
          headless browser can come to a trackpad/touch swipe over `overflow-x: auto`).
  * D-6   real `getBoundingClientRect()` boxes for the exact controls the design review
          named (formatting row B / I / H1) plus one of each remaining tracked class
          (a folder's hover-revealed rename pencil, a tag's always-visible rename pencil)
          at 1200 px -- the per-target verdict table.

Sandbox boot + provisioning reuse tools/notebook_perf_harness.py, same as
docs/notebook/proof/d2-instrument/d2_phone_measure.py and
docs/notebook/proof/notebook_d5_scroll_probe.py.

    python docs/notebook/proof/dra-instrument/dra_walk.py --data-dir 'C:\\data-dra' \\
        --port 8242 --out docs/notebook/proof/dra-<sha>/d256-walk.json \\
        --art docs/notebook/proof/dra-<sha>/d256-shots --tip <sha>

Exit: 0 = ran end to end (rows may still individually record an error -- read them);
3 = refused or never started.
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO))

from tools import notebook_perf_harness as H  # noqa: E402

MEMBER = ("d256overlay@local.dev", "LocalTest2026!", "d256 overlay")

# ── D-2: the coachmark's box vs. every element it could cover ───────────────────────────
COACHMARK_JS = r"""() => {
  const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el);
    return el.getClientRects().length > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
             right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) }; };
  const card = document.querySelector('[data-orb-coachmark]');
  const cardVis = vis(card);
  const cardBox = cardVis ? box(card) : null;
  // Everything an operable control renders in the routed content -- note cards, folder rows,
  // saved-view rows, the editor's title/properties/evidence controls -- as candidates the card
  // could sit over. `[data-first-run-slot]` and its own descendants are excluded: the slot
  // holding the card in flow is not "content the card covers".
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
  // where the card sits in DOM order relative to the routed surface's own root, to confirm
  // "in the flow" rather than a fixed overlay painted after it.
  const slotIndex = slot ? Array.from(slot.parentElement.children).indexOf(slot) : null;
  return { present: !!card, visible: cardVis, box: cardBox, overlaps: overlaps.slice(0, 8),
           slot_index_in_main: slotIndex, dismiss_present: !!document.querySelector('[data-orb-coachmark] button') };
}"""

DISMISS_JS = r"""() => { const b = document.querySelector('[data-orb-coachmark] button'); if (b) b.click(); return !!b; }"""
SEEN_JS = r"""() => { try { return localStorage.getItem('voice.orb.coachmarkSeen'); } catch (e) { return 'ERR:' + e; } }"""


def d2_probe(pg, base: str, path: str, wait_sel: str, art: Path, tag: str) -> dict:
    pg.goto(base + path)
    H._dismiss_intro(pg)
    pg.wait_for_selector(wait_sel, state="attached", timeout=30000)
    pg.wait_for_timeout(1500)
    before = pg.evaluate(COACHMARK_JS)
    pg.screenshot(path=str(art / f"{tag}-before-dismiss.png"))
    row: dict = {"before": before}
    if before.get("present"):
        clicked = pg.evaluate(DISMISS_JS)
        pg.wait_for_timeout(400)
        after = pg.evaluate(COACHMARK_JS)
        seen_key = pg.evaluate(SEEN_JS)
        pg.reload()
        H._dismiss_intro(pg)
        pg.wait_for_selector(wait_sel, state="attached", timeout=30000)
        pg.wait_for_timeout(1200)
        after_reload = pg.evaluate(COACHMARK_JS)
        pg.screenshot(path=str(art / f"{tag}-after-reload.png"))
        row.update(dismiss_clicked=clicked, after_dismiss=after, seen_key_after_dismiss=seen_key,
                   after_reload=after_reload,
                   dismissal_remembered=(seen_key == "1" and not after_reload.get("visible")))
    return row


# ── D-5x: keyboard tab + wheel scroll over the board's own scroller ─────────────────────
BOARD_STATE_JS = r"""() => {
  const firstCol = document.querySelector('section[aria-label]');
  const el = firstCol ? firstCol.parentElement : null;
  if (!el) return { found: false };
  return { found: true, cue: el.getAttribute('data-board-scroll-more'),
           scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
}"""


def d5_extra(pg, art: Path) -> dict:
    row: dict = {}
    pg.wait_for_selector('section[aria-label]', timeout=15000)
    pg.wait_for_timeout(500)
    row["initial"] = pg.evaluate(BOARD_STATE_JS)

    # KEYBOARD: focus the LAST column's group-by-producing control (its `<select>` on the
    # first card, if any, else the column header) -- a real Tab lands here eventually; a
    # direct .focus() call exercises the same code path browsers use to decide whether a
    # newly-focused element needs scrolling into view, without needing dozens of Tab presses
    # to walk there in a 5-column board.
    cols = pg.locator('section[aria-label]')
    n = cols.count()
    last_select = cols.nth(n - 1).locator("select").first
    kb_reachable = last_select.count() > 0
    if kb_reachable:
        last_select.focus()
        pg.wait_for_timeout(400)
    row["keyboard"] = {
        "reachable": kb_reachable,
        "after_focus": pg.evaluate(BOARD_STATE_JS),
        "focused_is_target": (last_select.evaluate("(el) => el === document.activeElement")
                              if kb_reachable else False),
    }
    pg.screenshot(path=str(art / "d5-keyboard-focus.png"))

    # reset scroll before the touch/wheel probe so the two are independent
    pg.evaluate("() => { const s = document.querySelector('section[aria-label]'); const el = s && s.parentElement; if (el) el.scrollLeft = 0; }")
    pg.wait_for_timeout(300)
    box = cols.first.bounding_box()
    if box:
        pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.mouse.wheel(500, 0)
    pg.wait_for_timeout(400)
    row["wheel_scroll"] = pg.evaluate(BOARD_STATE_JS)
    pg.screenshot(path=str(art / "d5-after-wheel.png"))
    return row


# ── D-6: real boxes for the design review's named targets + one of each tracked class ───
TARGET_JS = r"""(sel) => { const el = document.querySelector(sel); if (!el) return { present: false, sel };
  const r = el.getBoundingClientRect();
  return { present: true, sel, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10,
           passes_24: r.width >= 24 && r.height >= 24, text: (el.textContent || '').trim().slice(0, 20) }; }"""

TARGET_BY_TEXT_JS = r"""(args) => {
  const [root, text] = args;
  const scope = root ? document.querySelector(root) : document;
  if (!scope) return { present: false, root, text };
  const btn = Array.from(scope.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text);
  if (!btn) return { present: false, root, text };
  const r = btn.getBoundingClientRect();
  return { present: true, root, text, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10,
           passes_24: r.width >= 24 && r.height >= 24 };
}"""


def d6_editor(pg) -> list[dict]:
    pg.wait_for_selector('[role="toolbar"][aria-label="Editor toolbar"]', timeout=15000)
    pg.wait_for_timeout(400)
    out = []
    for label in ("B", "I", "H1"):
        out.append(pg.evaluate(TARGET_BY_TEXT_JS, ['[role="toolbar"][aria-label="Editor toolbar"]', label]))
    return out


def d6_sidebar(pg, folder_name: str, tag_name: str) -> list[dict]:
    out = []
    row = pg.locator(f'button[aria-label="{folder_name}"]').first
    if row.count():
        row.hover()
        pg.wait_for_timeout(300)
    out.append(pg.evaluate(TARGET_JS, f'button[aria-label="Rename {folder_name}"]'))
    out.append(pg.evaluate(TARGET_JS, f'button[aria-label="Rename {tag_name}"]'))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8242)
    ap.add_argument("--out", required=True)
    ap.add_argument("--art", required=True)
    ap.add_argument("--tip", required=True)
    a = ap.parse_args()

    art = Path(a.art)
    art.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{a.port}"
    res: dict = {"tip": a.tip, "instrument": "dra_walk.py", "data_dir": a.data_dir, "port": a.port}

    refused = H.refuse_shared_root(a.data_dir) or (H.port_busy(a.port) and f"port {a.port} busy")
    if refused:
        print(f"NOT RUN: {refused}")
        return 3

    sb = H.Sandbox(a.data_dir, a.port, art / "sandbox-boot.log")
    not_run = None
    try:
        sb.start()
        if not sb.wait_healthy(base, 300):
            not_run = "sandbox never healthy"
        else:
            sb.wait_checkpoint(H.POST_BOOT, H.POST_BOOT_WAIT_S)
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch(ignore_default_args=["--hide-scrollbars"])
                try:
                    admin_ctx = browser.new_context()
                    member_ctx = browser.new_context()
                    H._provision(admin_ctx.request, member_ctx.request, base, member=MEMBER)
                    # One note (so NotebookTourGate's `!hasAnyNotes` precondition is false and
                    # the first-run TOUR never claims the stage -- isolating the coachmark).
                    doc, _m = H.paragraphs_doc(4, "d256-note")
                    nid = member_ctx.request.post(
                        base + "/api/j2/notes", data={"title": "D256 rich note", "bodyJson": doc, "tags": ["D6tag"]},
                    ).json()["note"]["id"]
                    fr = member_ctx.request.post(base + "/api/j2/note-folders", data={"name": "D6 folder"})
                    res["folder_create_status"] = fr.status
                    state = member_ctx.storage_state()

                    # ── D-2 at 390 (list) ────────────────────────────────────────────
                    ctx390 = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
                                                  is_mobile=True, storage_state=state)
                    pg390 = ctx390.new_page()
                    res["d2_list_390"] = d2_probe(pg390, base, "/journal/notebook?view=all",
                                                   "[data-note-card-id]", art, "d2-list-390")
                    ctx390.close()

                    # ── D-2 at 1200 (editor) ─────────────────────────────────────────
                    ctx1200 = browser.new_context(viewport={"width": 1200, "height": 900}, storage_state=state)
                    pg1200 = ctx1200.new_page()
                    res["d2_editor_1200"] = d2_probe(pg1200, base, f"/journal/notebook?note={nid}",
                                                      "[data-note-title]", art, "d2-editor-1200")

                    # ── D-6 editor targets (same page, coachmark already dismissed above) ──
                    res["d6_editor_1200"] = d6_editor(pg1200)
                    ctx1200.close()

                    # ── D-5x + D-6 sidebar, 1200, fresh context (no coachmark noise) ────
                    ctx_board = browser.new_context(viewport={"width": 1200, "height": 900}, storage_state=state)
                    pg_board = ctx_board.new_page()
                    pg_board.goto(base + "/journal/notebook?view=all")
                    H._dismiss_intro(pg_board)
                    pg_board.wait_for_selector("[data-note-card-id]", timeout=20000)
                    # dismiss the coachmark if it renders here too (it may -- a fresh
                    # storage_state context has its own localStorage), so it cannot sit over
                    # the board/sidebar this probe is about to measure.
                    pg_board.evaluate(DISMISS_JS)
                    pg_board.get_by_role("button", name="Board view").click(timeout=10000)
                    res["d5_extra_1200"] = d5_extra(pg_board, art)
                    res["d6_sidebar_1200"] = d6_sidebar(pg_board, "D6 folder", "D6tag")
                    pg_board.screenshot(path=str(art / "sidebar-1200.png"))
                    ctx_board.close()
                finally:
                    browser.close()
            sb.wait_checkpoint("post-prewarm (+120s)", 200)
    except Exception as e:  # noqa: BLE001
        not_run = f"{type(e).__name__}: {e}"
        res["traceback"] = traceback.format_exc()[-2000:]
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        integ = H.read_integrity(ipath, [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN])
        first = H.integrity_line(integ, not_run=not_run)
        res.update(integrity_log=ipath, integrity=integ, first_line=first, not_run=not_run)
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(json.dumps(res, indent=1, default=str) + "\n", encoding="utf-8", newline="\n")
        print(first)
    return 3 if not_run else 0


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())
