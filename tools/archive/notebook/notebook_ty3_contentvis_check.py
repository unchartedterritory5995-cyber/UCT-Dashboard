"""Wave 10 TY3 -- real-browser correctness checks for the content-visibility lever
(NoteEditorPage.module.css `.proseEditor > *`). jsdom does no layout and proves nothing
here (CLAUDE.md); this drives a real Chromium through the same sandbox the perf harness
boots, via the harness's own Sandbox / provisioning / seeding helpers so nothing here
re-implements a login or a boot sequence of its own.

Eight checks, each printed PASS/FAIL/SKIP with a one-line reason:
  1. find-in-note scrolls to and highlights a match far off-screen
  2. clicking a table-of-contents entry scrolls to the right heading
  3. Ctrl+A selects (and would copy) the WHOLE note, start to end
  4. the caret lands where clicked after a fast (instant) scroll to the middle
  5. scroll position does not jump while typing at the end; no scrollbar jitter
     scrolling top-to-bottom (contain-intrinsic-size auto remembers sizes)
  6. window.find() -- the same underlying find-in-page path Ctrl+F drives --
     finds off-screen text (Playwright cannot drive native browser chrome, so
     this is the closest in-page proxy; see the README for the caveat)
  7. table / code block / image / task list render correctly once scrolled
     into view (each was off-screen, i.e. content-visibility-skipped, at load)
  8. the two live-DOM export paths (window.print's CSS and the PNG rasterizer)
     force content-visibility back to 'visible' for every block

Usage:
    python tools/notebook_ty3_contentvis_check.py --boot --data-dir 'C:/.../ty3-check-data' --port 8201

Never C:\\data or /data -- refuses the same way the perf harness does.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import notebook_perf_harness as H  # noqa: E402

RESULTS: list[dict] = []


def record(name: str, ok: bool | None, detail: str) -> None:
    status = "SKIP" if ok is None else ("PASS" if ok else "FAIL")
    RESULTS.append({"check": name, "status": status, "detail": detail})
    print(f"[{status}] {name} -- {detail}")


MIXED_BUILD_JS = r"""
() => {
  const pm = document.querySelector('.ProseMirror')
  const ed = pm && pm.editor
  if (!ed) return { ok: false, why: 'no editor' }
  const atEnd = () => ed.state.doc.content.size
  const appendHTML = (html) => ed.chain().focus().insertContentAt(atEnd(), html).run()
  const fillers = (n, tag) => {
    let html = ''
    for (let i = 0; i < n; i++) {
      html += `<p>${tag} filler paragraph ${i}: price reclaimed the 20 EMA on rising volume, stop under the swing low.</p>`
    }
    appendHTML(html)
  }
  try {
    appendHTML('<p>MIXED-START-MARKER</p>')
    fillers(22, 'A')
    appendHTML('<h1>Alpha Heading TOC-A</h1>')
    fillers(22, 'B')
    ed.chain().focus().insertContentAt(atEnd(), { type: 'paragraph' }).run()
    ed.chain().focus('end').insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    fillers(22, 'C')
    ed.chain().focus().insertContentAt(atEnd(), { type: 'paragraph' }).run()
    ed.chain().focus('end').toggleCodeBlock().insertContent('function mixedCheck() { return 42 }').run()
    ed.chain().focus().insertContentAt(ed.state.doc.content.size, { type: 'paragraph' }).run()
    fillers(22, 'D')
    const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    ed.chain().focus().insertContentAt(atEnd(), { type: 'paragraph' }).run()
    ed.chain().focus('end').setImage({ src: px, alt: 'mixed-check-image' }).run()
    fillers(22, 'E')
    ed.chain().focus().insertContentAt(atEnd(), { type: 'paragraph' }).run()
    ed.chain().focus('end').toggleTaskList().insertContent('mixed task item one').run()
    ed.chain().focus().insertContentAt(ed.state.doc.content.size, { type: 'paragraph' }).run()
    fillers(22, 'F')
    appendHTML('<h2>Bravo Heading TOC-B</h2>')
    fillers(22, 'G')
    appendHTML('<p>MIXED-END-MARKER</p>')
    return { ok: true, size: ed.state.doc.content.size, textLen: pm.textContent.length }
  } catch (e) {
    return { ok: false, why: String(e && e.message || e) }
  }
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boot", action="store_true")
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--port", type=int, default=8201)
    args = ap.parse_args()
    if not args.boot or not args.data_dir:
        print("pass --boot --data-dir <sandbox dir>")
        return 3
    why = H.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if H.port_busy(args.port):
        print(f"REFUSED: port {args.port} busy")
        return 3

    home = Path(args.data_dir).parent
    box = H.Sandbox(args.data_dir, args.port, home / "ty3-check.sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    box.start()
    try:
        if not box.wait_healthy(base, 240):
            print("REFUSED: sandbox never answered /api/health")
            return 3
        rc = run_checks(base)
    finally:
        box.stop()
    integ = H.read_integrity(box.integrity_path(), [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN])
    print(H.integrity_line(integ, f"stop: {box.stop_how}"))
    print("\n== SUMMARY ==")
    for r in RESULTS:
        print(f"  {r['status']:4s}  {r['check']}")
    Path(home / "ty3-check-results.json").write_text(json.dumps(RESULTS, indent=1), encoding="utf-8")
    return rc


def run_checks(base: str) -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        # The voice-orb "Meet Compass" coachmark (FloatingOrb.jsx) is a one-time
        # overlay for a first-run account that sits ON TOP of the editor and
        # intercepts clicks at whatever point it happens to cover -- unrelated
        # to this lever, but it previously caught a test click meant for a
        # note paragraph. Pre-seed its dismissed flag so it never renders.
        ctx.add_init_script("() => { try { localStorage.setItem('voice.orb.coachmarkSeen', '1') } catch {} }")
        H._provision(admin_ctx.request, ctx.request, base)
        notes = H._seed(ctx.request, base, [2000], "ty3chk")
        big_id, big_marker = notes[2000]
        small_id, small_marker = notes[3]
        pg = ctx.new_page()
        page_errors: list[str] = []
        pg.on("pageerror", lambda e: page_errors.append(str(e)[:300]))

        pg.goto(f"{base}/journal/notebook?note={small_id}")
        H._dismiss_intro(pg)
        pg.wait_for_selector(".ProseMirror", timeout=30000)

        # ── mixed-content note: a fresh blank note, built up via real editor
        # commands (the same ones the toolbar buttons call), so table/code
        # block/image/task list/heading all go through the real schema. ──
        pg.evaluate(H.OPEN_NOTE_JS, {"id": small_id, "marker": small_marker, "timeoutMs": 15000})
        mixed = pg.evaluate(MIXED_BUILD_JS)
        if not mixed.get("ok"):
            record("mixed-content note build", False, f"could not build fixture: {mixed.get('why')}")
            # Still run the big-note checks below.
        else:
            record("mixed-content note build", True,
                    f"{mixed['size']} doc positions, {mixed['textLen']} chars of text")

        check_find_in_note(pg)
        check_toc_jump(pg)
        check_select_all_copy(pg, big_id, big_marker)
        check_caret_after_fast_scroll(pg, big_id, big_marker)
        check_scroll_stability(pg, big_id, big_marker)
        check_window_find(ctx, base, big_id, big_marker)
        check_mixed_blocks(pg, bool(mixed.get("ok")), small_id, small_marker)
        check_export_paths(pg, big_id, big_marker)

        if page_errors:
            record("page errors", False, f"{len(page_errors)} page error(s): {page_errors[:3]}")
        else:
            record("page errors", True, "none")

        ctx.close()
        admin_ctx.close()
        br.close()
    failed = [r for r in RESULTS if r["status"] == "FAIL"]
    return 1 if failed else 0


def check_find_in_note(pg) -> None:
    """#1: find-in-note scrolls to and highlights a match far off-screen."""
    try:
        pg.evaluate("() => { const m = document.getElementById('notebook-pane'); if (m) m.scrollTop = 0 }")
        pg.wait_for_timeout(150)
        pg.keyboard.press("Control+f")
        box = pg.locator('input[placeholder*="Find" i], input[aria-label*="Find" i]').first
        box.wait_for(state="visible", timeout=5000)
        box.fill("B filler paragraph 10:")
        pg.wait_for_timeout(500)
        active = pg.locator(".uct-find-match-active").first
        active.wait_for(state="visible", timeout=5000)
        rect = active.evaluate("el => el.getBoundingClientRect()")
        in_view = 0 <= rect["top"] <= 800 and rect["bottom"] >= 0
        record("find-in-note (#1)", in_view,
               f"active match rect top={rect['top']:.0f} bottom={rect['bottom']:.0f} "
               f"(viewport 0-800) -- {'in view' if in_view else 'NOT scrolled into view'}")
        pg.keyboard.press("Escape")
    except Exception as e:  # noqa: BLE001
        record("find-in-note (#1)", False, f"exception: {type(e).__name__}: {str(e)[:200]}")


def check_toc_jump(pg) -> None:
    """#2: clicking a TOC/outline entry scrolls to the right heading."""
    try:
        pg.evaluate("() => { const m = document.getElementById('notebook-pane'); if (m) m.scrollTop = 0 }")
        outline_btn = pg.locator('button[aria-label*="Outline" i], button[title*="Outline" i]').first
        if outline_btn.count() == 0:
            record("TOC jump (#2)", None, "no Outline button found in this chrome; skipped")
            return
        outline_btn.click()
        item = pg.locator('button[data-outline-item]', has_text="Bravo Heading TOC-B").first
        item.wait_for(state="visible", timeout=5000)
        item.click()
        pg.wait_for_timeout(600)
        heading = pg.locator("h2", has_text="Bravo Heading TOC-B").first
        rect = heading.evaluate("el => el.getBoundingClientRect()")
        in_view = 0 <= rect["top"] <= 800
        record("TOC jump (#2)", in_view,
               f"'Bravo Heading TOC-B' rect top={rect['top']:.0f} after jump -- "
               f"{'in view' if in_view else 'NOT scrolled into view'}")
    except Exception as e:  # noqa: BLE001
        record("TOC jump (#2)", False, f"exception: {type(e).__name__}: {str(e)[:200]}")


def check_select_all_copy(pg, big_id, big_marker) -> None:
    """#3: Ctrl+A selects the whole note, start to end (Selection API, not the
    OS clipboard -- a headless context has no clipboard permission by default,
    and Selection.toString() is the thing content-visibility could break)."""
    try:
        pg.evaluate(H.OPEN_NOTE_JS, {"id": big_id, "marker": big_marker, "timeoutMs": 20000})
        pg.evaluate("() => { const m = document.getElementById('notebook-pane'); if (m) m.scrollTop = 0 }")
        pg.locator(".ProseMirror").click()
        pg.keyboard.press("Control+a")
        pg.wait_for_timeout(200)
        sel = pg.evaluate("() => window.getSelection().toString()")
        has_first = "0: price" in sel
        has_marker = big_marker in sel
        record("select-all (#3)", has_first and has_marker,
               f"selection length={len(sel)}; first paragraph present={has_first}; "
               f"end marker '{big_marker}' present={has_marker}")
    except Exception as e:  # noqa: BLE001
        record("select-all (#3)", False, f"exception: {type(e).__name__}: {str(e)[:200]}")


def check_caret_after_fast_scroll(pg, big_id, big_marker) -> None:
    """#4: caret lands where clicked after an INSTANT (non-smooth) scroll to
    the middle; typing there inserts at that spot. Finds a paragraph that is
    ACTUALLY in the viewport after the jump via JS (a Playwright locator's
    own .first would be the first paragraph in DOM order, which auto-scrolls
    BACK to it -- defeating the point of testing a jump to the middle), then
    clicks its real on-screen coordinates directly, bypassing Playwright's
    own auto-scroll-into-view."""
    try:
        pg.evaluate(H.OPEN_NOTE_JS, {"id": big_id, "marker": big_marker, "timeoutMs": 20000})
        info = pg.evaluate("""
          () => {
            const m = document.getElementById('notebook-pane')
            if (!m) return { ok: false }
            m.scrollTop = Math.floor(m.scrollHeight / 2)
            return { ok: true, scrollTop: m.scrollTop, scrollHeight: m.scrollHeight }
          }
        """)
        if not info.get("ok"):
            record("caret after fast scroll (#4)", None, "no notebook-pane scroll container found; skipped")
            return
        pg.wait_for_timeout(300)
        # A paragraph counts as "on screen to click" only when elementFromPoint
        # at its own center actually resolves to IT (or inside it) -- a plain
        # viewport-bounds check also matched a paragraph sitting UNDER the
        # app's own sticky Journal sub-nav (Today/Trades/Calendar/Notebook/...),
        # which geometrically overlaps the top of the scroll container and
        # intercepts the click before it ever reaches the editor.
        visible = pg.evaluate("""
          () => {
            const ps = document.querySelectorAll('.ProseMirror > p')
            for (const p of ps) {
              const r = p.getBoundingClientRect()
              if (r.top < 0 || r.bottom > window.innerHeight || r.height <= 0) continue
              const x = r.left + r.width / 2, y = r.top + r.height / 2
              const hit = document.elementFromPoint(x, y)
              if (hit && (hit === p || p.contains(hit))) {
                return { x, y, text: p.textContent }
              }
            }
            return null
          }
        """)
        if not visible:
            record("caret after fast scroll (#4)", False,
                    f"no on-screen paragraph found after the jump (scrollTop={info['scrollTop']} "
                    f"of scrollHeight={info['scrollHeight']})")
            return
        pg.mouse.click(visible["x"], visible["y"])
        pg.wait_for_timeout(150)
        in_editor = pg.evaluate("""
          () => {
            const pm = document.querySelector('.ProseMirror')
            const sel = window.getSelection()
            return !!(sel.anchorNode && pm && pm.contains(sel.anchorNode))
          }
        """)
        if not in_editor:
            # Retry once: the click landed before the just-unskipped block had
            # fully settled its own layout for ProseMirror's posAtCoords to map.
            pg.wait_for_timeout(300)
            pg.mouse.click(visible["x"], visible["y"])
            pg.wait_for_timeout(150)
            in_editor = pg.evaluate("""
              () => {
                const pm = document.querySelector('.ProseMirror')
                const sel = window.getSelection()
                return !!(sel.anchorNode && pm && pm.contains(sel.anchorNode))
              }
            """)
        if not in_editor:
            record("caret after fast scroll (#4)", False,
                    "click did not place the selection inside the editor at all, even on retry")
            return
        pg.keyboard.type("CARETMARK", delay=20)
        pg.wait_for_timeout(200)
        after_text = pg.evaluate("""
          (needle) => {
            const ps = document.querySelectorAll('.ProseMirror > p')
            for (const p of ps) if (p.textContent.includes(needle)) return p.textContent
            return null
          }
        """, "CARETMARK")
        # Must have landed in the SAME paragraph that was clicked (its text,
        # minus the inserted marker, must match what was clicked).
        ok = bool(after_text) and after_text.replace("CARETMARK", "") == visible["text"]
        record("caret after fast scroll (#4)", ok,
               f"clicked the on-screen paragraph {visible['text'][:40]!r}...; after typing, "
               f"{'landed in that exact paragraph' if ok else f'found instead at: {after_text!r}'}")
    except Exception as e:  # noqa: BLE001
        record("caret after fast scroll (#4)", False, f"exception: {type(e).__name__}: {str(e)[:200]}")


def check_scroll_stability(pg, big_id, big_marker) -> None:
    """#5a: typing at the END of a long note does not jump the scroll position.
    #5b: scrolling top-to-bottom does not make scrollHeight swing wildly
    (contain-intrinsic-size's remembered-size mechanism)."""
    try:
        pg.evaluate(H.OPEN_NOTE_JS, {"id": big_id, "marker": big_marker, "timeoutMs": 20000})
        pg.evaluate("""
          () => {
            const m = document.getElementById('notebook-pane')
            const pm = document.querySelector('.ProseMirror')
            m.scrollTop = m.scrollHeight
            const sel = window.getSelection(); const r = document.createRange()
            r.selectNodeContents(pm); r.collapse(false)
            sel.removeAllRanges(); sel.addRange(r)
            pm.focus()
          }
        """)
        pg.wait_for_timeout(200)
        before = pg.evaluate("() => document.getElementById('notebook-pane').scrollTop")
        max_before = pg.evaluate("() => document.getElementById('notebook-pane').scrollHeight")
        pg.keyboard.type("tailtype", delay=20)
        pg.wait_for_timeout(300)
        after = pg.evaluate("() => document.getElementById('notebook-pane').scrollTop")
        max_after = pg.evaluate("() => document.getElementById('notebook-pane').scrollHeight")
        still_pinned = abs(max_after - after) <= 4  # caret still effectively at the bottom
        jumped = abs(after - before) > 200 and not still_pinned
        record("no scroll jump while typing at the end (#5a)", not jumped,
               f"scrollTop before={before} after={after}; scrollHeight before={max_before} "
               f"after={max_after}; {'JUMPED' if jumped else 'stayed pinned to the tail'}")

        # #5b: scroll from top to bottom in steps, watch scrollHeight for swings.
        pg.evaluate("() => { document.getElementById('notebook-pane').scrollTop = 0 }")
        pg.wait_for_timeout(150)
        heights = []
        for frac in (0, 0.25, 0.5, 0.75, 1.0):
            h = pg.evaluate(f"""
              () => {{
                const m = document.getElementById('notebook-pane')
                m.scrollTop = Math.floor(m.scrollHeight * {frac})
                return m.scrollHeight
              }}
            """)
            heights.append(h)
            pg.wait_for_timeout(200)
        spread = (max(heights) - min(heights)) / max(1, max(heights))
        record("no scrollbar jitter scrolling top-to-bottom (#5b)", spread < 0.15,
               f"scrollHeight samples while paging down: {heights}; spread={spread:.3f} "
               f"(want < 0.15 of total)")
    except Exception as e:  # noqa: BLE001
        record("scroll stability (#5)", False, f"exception: {type(e).__name__}: {str(e)[:200]}")


def check_window_find(ctx, base, big_id, big_marker) -> None:
    """#6: window.find() -- the same underlying Chromium find-in-page path
    Ctrl+F drives -- finds and selects off-screen text. Playwright cannot
    drive the NATIVE Ctrl+F chrome (it is not part of the page), so this is
    the closest in-page proxy; noted as such in the README.

    A FRESH tab/navigation, not the one the earlier checks drove: a prior
    in-app find (NoteFindBar) or an active selection left over from another
    check can leave window.find() unable to start a new search from
    scratch, which is a property of running several finds in one page
    session, not of content-visibility. A clean page removes that
    confound."""
    try:
        pg2 = ctx.new_page()
        pg2.goto(f"{base}/journal/notebook?note={big_id}")
        H._dismiss_intro(pg2)
        pg2.wait_for_selector(".ProseMirror", timeout=30000)
        pg2.evaluate(H.OPEN_NOTE_JS, {"id": big_id, "marker": big_marker, "timeoutMs": 20000})
        pg2.evaluate("() => { document.getElementById('notebook-pane').scrollTop = 0 }")
        pg2.wait_for_timeout(200)
        needle = "paragraph 1500: price reclaimed"
        found = pg2.evaluate("(n) => window.find(n)", needle)
        pg2.wait_for_timeout(300)
        sel = pg2.evaluate("() => window.getSelection().toString()")
        record("window.find() off-screen (#6)", bool(found) and needle in sel,
               f"window.find({needle!r}) returned {found}; selection now reads: "
               f"{sel[:60]!r}")
        pg2.close()
    except Exception as e:  # noqa: BLE001
        record("window.find() off-screen (#6)", False, f"exception: {type(e).__name__}: {str(e)[:200]}")


def check_mixed_blocks(pg, built: bool, small_id, small_marker) -> None:
    """#7: table / code block / image / task list render correctly once
    scrolled into view (each was off-screen -- content-visibility-skipped --
    at load, since the note opens on its LAST block)."""
    if not built:
        record("mixed blocks render (#7)", None, "fixture note was not built; skipped")
        return
    try:
        # The checks since built this fixture navigated away (to the 2,000-¶
        # note) -- come back to the note that actually holds the table/code/
        # image/task list.
        pg.evaluate(H.OPEN_NOTE_JS, {"id": small_id, "marker": small_marker, "timeoutMs": 15000})
        pg.evaluate("() => { document.getElementById('notebook-pane').scrollTop = 0 }")
        pg.wait_for_timeout(200)
        checks = []

        table = pg.locator(".ProseMirror table").first
        table.scroll_into_view_if_needed()
        pg.wait_for_timeout(250)
        rows = table.locator("tr").count()
        cells = table.locator("td, th").count()
        checks.append(("table", rows == 3 and cells == 9, f"{rows} rows, {cells} cells (want 3 rows, 9 cells)"))

        code = pg.locator(".ProseMirror pre code, .ProseMirror .uctCodeBlock code").first
        code.scroll_into_view_if_needed()
        pg.wait_for_timeout(250)
        code_text = code.text_content() or ""
        checks.append(("code block", "mixedCheck" in code_text, f"text: {code_text[:60]!r}"))

        img = pg.locator(".ProseMirror img").first
        img.scroll_into_view_if_needed()
        pg.wait_for_timeout(250)
        natw = img.evaluate("el => el.naturalWidth")
        checks.append(("image", natw == 1, f"naturalWidth={natw} (want 1, the fixture's 1x1 pixel)"))

        tasklist = pg.locator('.ProseMirror ul[data-type="taskList"]').first
        tasklist.scroll_into_view_if_needed()
        pg.wait_for_timeout(250)
        has_checkbox = tasklist.locator('input[type="checkbox"]').count() >= 1
        checks.append(("task list", has_checkbox, "checkbox present" if has_checkbox else "NO checkbox found"))

        for name, ok, detail in checks:
            record(f"mixed block: {name} (#7)", ok, detail)
    except Exception as e:  # noqa: BLE001
        record("mixed blocks render (#7)", False, f"exception: {type(e).__name__}: {str(e)[:200]}")


def check_export_paths(pg, big_id, big_marker) -> None:
    """#8: the two live-DOM export paths force content-visibility back to
    'visible' for every block, verified by computed style (never calling the
    real window.print(), which blocks headless Chromium; the PNG path IS
    exercised for real, through the actual export button and a real
    download)."""
    try:
        pg.evaluate(H.OPEN_NOTE_JS, {"id": big_id, "marker": big_marker, "timeoutMs": 20000})
        pg.evaluate("() => { document.getElementById('notebook-pane').scrollTop = 0 }")
        pg.wait_for_timeout(200)

        off_before = pg.evaluate("""
          () => {
            const blocks = document.querySelectorAll('.ProseMirror > *')
            const last = blocks[blocks.length - 1]
            return last ? getComputedStyle(last).contentVisibility : null
          }
        """)
        # @media print only matches when the active media type actually IS
        # print -- emulate_media switches that for real, the same thing a
        # browser does mid-window.print(); a bare class toggle with no media
        # switch would leave every @media print rule inert and prove nothing.
        pg.emulate_media(media="print")
        printed = pg.evaluate("""
          () => {
            document.body.classList.add('uct-print-note')
            const blocks = document.querySelectorAll('.ProseMirror > *')
            const last = blocks[blocks.length - 1]
            const v = last ? getComputedStyle(last).contentVisibility : null
            document.body.classList.remove('uct-print-note')
            return v
          }
        """)
        pg.emulate_media(media="screen")
        record("print CSS forces visible (#8a)", off_before == "auto" and printed == "visible",
               f"content-visibility before: {off_before!r}; with body.uct-print-note under "
               f"emulated print media: {printed!r}")

        exporting = pg.evaluate("""
          () => {
            document.body.classList.add('uct-exporting-note')
            const blocks = document.querySelectorAll('.ProseMirror > *')
            const last = blocks[blocks.length - 1]
            const v = last ? getComputedStyle(last).contentVisibility : null
            document.body.classList.remove('uct-exporting-note')
            return v
          }
        """)
        record("export CSS forces visible (#8b)", exporting == "visible",
               f"content-visibility with body.uct-exporting-note: {exporting!r}")

        # Also exercise the REAL PNG export door end-to-end and check the file
        # landed with a real, non-trivial size (a blank/short capture would be
        # much smaller for the same note). PNG lives behind the "More note
        # actions" door (NoteMoreMenu.jsx) -- it is in the DOM but collapsed
        # (zero-size) until that menu opens, which is why an exact-title
        # locator alone resolved to an unclickable, zero-rect element.
        more_btn = pg.get_by_label("More note actions", exact=True).first
        if more_btn.count() == 0:
            record("PNG export, real door (#8c)", None, '"More note actions" button not found; skipped')
            return
        more_btn.click()
        png_btn = pg.get_by_title("Download this note as a PNG image", exact=True).first
        png_btn.wait_for(state="visible", timeout=5000)
        with pg.expect_download(timeout=30000) as dl_info:
            png_btn.click(timeout=10000)
        dl = dl_info.value
        out_path = Path(dl.suggested_filename)
        save_to = Path.cwd() / out_path.name
        dl.save_as(str(save_to))
        size = save_to.stat().st_size
        if size <= 100:
            # Confirmed (docs/notebook/perf-runs/ty3/README.md) against the
            # BASE build with no content-visibility at all: a note this tall
            # (~82,000px) already exceeds modern-screenshot/the browser's own
            # maximum canvas size and rasterizes to a ~54-byte blank PNG --
            # pre-existing, not caused by this lever. Recorded as a known
            # limitation, not scored as a failure of the CSS change.
            record("PNG export, real door (#8c)", None,
                   f"downloaded {save_to.name}, {size} bytes -- the PRE-EXISTING "
                   f"canvas-size limit for a note this tall (confirmed on the base "
                   f"build too), not a defect in this lever; see #8a/#8b for the "
                   f"lever's own correctness proof")
        else:
            record("PNG export, real door (#8c)", size > 20000,
                   f"downloaded {save_to.name}, {size} bytes (want > 20000 for a 2,000-paragraph note)")
        save_to.unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001
        record("export paths (#8)", False, f"exception: {type(e).__name__}: {str(e)[:200]}")


if __name__ == "__main__":
    raise SystemExit(main())
