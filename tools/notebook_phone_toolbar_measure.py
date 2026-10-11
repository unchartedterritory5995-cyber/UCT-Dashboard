"""Measure the Notebook editor's formatting row at phone width, in a REAL browser (P0.6 fix round 1).

WHY IT EXISTS. jsdom lays nothing out, so "the mic is on screen at 390 px" cannot be a unit-test
claim. P0.6 moved the bullet list behind Format and added a "+" insert door, believing the seven
always-visible controls would fit; measured in a real browser they came to 362 px and the mic still
ended near x=398 behind the row's clip edge near x=366. This tool is the instrument that says so,
and says when it is fixed.

WHAT IT DOES. Boots nothing: it attaches to an already-serving sandbox (see Precondition), signs in a
fresh paid member at 390x844 (is_mobile, has_touch), opens a note, and for EVERY button in
`[data-tour="note-toolbar"]` that is on screen (a control inside a collapsed `.formatRun` has no box
and is not counted) records getBoundingClientRect() and whether `elementFromPoint` at its centre lands
on it. It then opens Format and records the same, plus whether the row scrolls sideways
(scrollWidth vs clientWidth), how many visual rows it wraps to, and where the note's title input sits
against the fold.

PASS (exit 0) needs, in the CLOSED state: at least the seven expected controls present (Undo, Redo,
Format, Insert, B, I, mic), every one with right <= innerWidth - 24 and uncovered, and the row not
scrollable. In the OPEN state: no control with right > innerWidth - 24, none covered, scrollWidth <=
clientWidth. The note's title being above the fold is RECORDED, not gated (it is a judgement).
Exit 1 = a break was measured; exit 2 = INCONCLUSIVE (nothing measurable, e.g. the editor never
mounted, the mic never arrived).

R-RAW: rects.json is written BEFORE any verdict is computed or printed, and screenshots beside it.

Precondition: a sandbox from THIS tree (app/dist rebuilt) is serving, e.g. (PowerShell, data dir
single-quoted, outside the repo):
    python tools/notebook_fin_walk.py --config c2 --data-root '<dir>' --port 8132 --out '<dir>' --tip <sha> --serve-only
Usage:
    python tools/notebook_phone_toolbar_measure.py --base http://127.0.0.1:8132 --out docs/notebook/evidence
    ... --control   POSITIVE CONTROL: injects CSS that puts the pre-fix widths back (the word "Format"
                    shown, Undo / Redo / Format at their text width plus 12 px side padding). The
                    measurement MUST then FAIL on the closed row, or this tool cannot fail and every
                    PASS it prints is void. With --control: exit 0 = it failed as it must, 1 = it did not.
Never kills anything; never touches C:\\data (the sandbox owns its data dir).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import notebook_fin_walk as C  # noqa: E402
import notebook_perf_harness as h  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

GUTTER = 24          # a control must end at least this far inside the viewport
EXPECTED = ["Undo", "Redo", "Format", "Insert", "B", "I", "Start voice input"]
BODY = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "First line."}]}]}

MEASURE_JS = r"""
() => {
  const row = document.querySelector('[data-tour="note-toolbar"]')
  if (!row) return { error: 'no [data-tour="note-toolbar"] in the page' }
  const R = (b) => ({ left: +b.left.toFixed(2), right: +b.right.toFixed(2), top: +b.top.toFixed(2),
                      bottom: +b.bottom.toFixed(2), width: +b.width.toFixed(2), height: +b.height.toFixed(2) })
  const nameOf = (el) => {
    const l = el.getAttribute('aria-label')
    if (l) return l.replace(/\s+/g, ' ').trim()
    const c = el.cloneNode(true)
    c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove())
    return (c.textContent || '').replace(/\s+/g, ' ').trim()
  }
  const out = []
  for (const el of row.querySelectorAll('button, select')) {
    const rects = el.getClientRects()
    if (!rects.length) continue                       // inside a collapsed run / display:none
    const b = el.getBoundingClientRect()
    if (b.width < 2 && b.height < 2) continue         // the visually-hidden 1px label
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2
    const hit = document.elementFromPoint(cx, cy)
    const hitsSelf = !!hit && (hit === el || el.contains(hit))
    out.push({ name: nameOf(el), tag: el.tagName.toLowerCase(), rect: R(b),
               centre: { x: +cx.toFixed(2), y: +cy.toFixed(2) }, hitsSelf,
               coveredBy: hitsSelf ? null : (hit ? (hit.tagName.toLowerCase() + (hit.className && hit.className.baseVal === undefined ? '.' + String(hit.className).split(' ')[0] : '')) : 'nothing (off-screen)'),
               rightEdgeOk: b.right <= innerWidth - %(gutter)d, leftEdgeOk: b.left >= 0 })
  }
  const rb = row.getBoundingClientRect()
  const title = document.querySelector('input[placeholder="Title"]')
  const tb = title ? title.getBoundingClientRect() : null
  const tops = [...new Set(out.map((c) => Math.round(c.rect.top)))].sort((a, b) => a - b)
  return {
    innerWidth, innerHeight, docScrollWidth: document.documentElement.scrollWidth,
    row: { rect: R(rb), scrollWidth: row.scrollWidth, clientWidth: row.clientWidth,
           scrollsSideways: row.scrollWidth > row.clientWidth, overflowX: getComputedStyle(row).overflowX,
           flexWrap: getComputedStyle(row).flexWrap, dataFormatOpen: row.getAttribute('data-format-open') },
    visualRows: tops.length, rowTops: tops,
    title: tb ? { rect: R(tb), topAboveFold: tb.top < innerHeight, bottomAboveFold: tb.bottom <= innerHeight } : null,
    controls: out,
  }
}
""" % {"gutter": GUTTER}


def verdict(state: dict, closed: bool) -> list[str]:
    """Reasons this state breaks the goal; empty = holds. A missing measurement is its own reason."""
    why: list[str] = []
    if not state or "error" in state:
        return [f"unmeasurable: {state.get('error') if state else 'no state'}"]
    names = [c["name"] for c in state["controls"]]
    if closed:
        for want in EXPECTED:
            if want not in names:
                why.append(f"expected control not on screen: {want!r}")
    for c in state["controls"]:
        if not c["rightEdgeOk"]:
            why.append(f"{c['name']!r} ends at x={c['rect']['right']} > innerWidth-{GUTTER}={state['innerWidth'] - GUTTER}")
        if not c["leftEdgeOk"]:
            why.append(f"{c['name']!r} starts off-screen at x={c['rect']['left']}")
        if not c["hitsSelf"]:
            why.append(f"{c['name']!r} is covered/unreachable at its centre (hit: {c['coveredBy']})")
    if state["row"]["scrollsSideways"]:
        why.append(f"the row scrolls sideways (scrollWidth {state['row']['scrollWidth']} > clientWidth {state['row']['clientWidth']})")
    if state["docScrollWidth"] > state["innerWidth"]:
        why.append(f"the page scrolls sideways (documentElement.scrollWidth {state['docScrollWidth']} > {state['innerWidth']})")
    return why


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True, help="parent dir; a phone-toolbar-<UTC stamp>/ folder is made inside it")
    ap.add_argument("--tip", default="", help="the commit under test, recorded in rects.json")
    ap.add_argument("--control", action="store_true", help="inject the pre-fix widths; the measurement must FAIL")
    a = ap.parse_args(argv)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(a.out) / f"phone-toolbar-{stamp}"
    out.mkdir(parents=True, exist_ok=True)
    rec: dict = {"stamp": stamp, "base": a.base, "tip": a.tip, "viewport": {"width": 390, "height": 844},
                 "gutter_px": GUTTER, "expected_closed": EXPECTED, "control": a.control, "status": "INCOMPLETE (run did not finish)"}

    def save():
        (out / "rects.json").write_text(json.dumps(rec, indent=1, default=str) + "\n", encoding="utf-8", newline="\n")

    save()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            admin = browser.new_context()
            h._signup_or_login(admin.request, a.base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
            ctx, email, _me = C.member(browser, admin.request, a.base, "ptm", "390")
            r = ctx.request.post(a.base + "/api/j2/notes", data={"title": "Phone toolbar probe", "bodyJson": BODY})
            if r.status not in (200, 201):
                raise h.SetupFailed(f"create note failed HTTP {r.status}")
            nid = (r.json().get("note") or r.json()).get("id")
            pg = ctx.new_page()
            C.goto(pg, a.base, f"/journal/notebook?note={nid}", wait=".ProseMirror")
            C.settle_first_run(pg)
            pg.wait_for_timeout(800)   # the editor is rebuilt once when the note hydrates
            # the lazy mic arrives in its own Suspense boundary: wait for it, never sleep for it
            mic_seen = C.vis(pg, '[data-tour="note-toolbar"] [aria-label="Start voice input"]', 20000)
            rec["mic_arrived"] = mic_seen
            pg.wait_for_timeout(500)
            if a.control:
                # attribute selectors, not class names: CSS-module classes are hashed
                pg.add_style_tag(content=(
                    '[data-format-toggle] > span:last-child { position: static !important; width: auto !important;'
                    ' height: auto !important; margin: 0 !important; clip: auto !important; overflow: visible !important }'
                    ' [data-format-toggle], [data-tour="note-toolbar"] button[aria-label="Undo"],'
                    ' [data-tour="note-toolbar"] button[aria-label="Redo"] { width: auto !important;'
                    ' padding-left: 12px !important; padding-right: 12px !important }'))
                pg.wait_for_timeout(300)
            rec["closed"] = pg.evaluate(MEASURE_JS)
            pg.screenshot(path=str(out / "closed.png"))
            fmt = pg.locator('[data-tour="note-toolbar"]').get_by_role("button", name="Format", exact=True)
            fmt.click(timeout=10000)
            pg.wait_for_timeout(600)
            rec["open"] = pg.evaluate(MEASURE_JS)
            pg.screenshot(path=str(out / "open.png"))
            browser.close()
    except Exception as e:  # noqa: BLE001
        rec["status"] = f"INCONCLUSIVE: {type(e).__name__}: {str(e)[:300]}"
        save()
        print(rec["status"])
        print(f"raw: {out / 'rects.json'}")
        return 2
    save()   # R-RAW: the raw rects are on disk BEFORE any verdict is computed

    closed_why = verdict(rec.get("closed"), True)
    if not rec.get("mic_arrived"):
        closed_why.append("the mic never arrived in the row (a paid member must have it)")
    open_why = verdict(rec.get("open"), False)
    rec["closed_breaks"], rec["open_breaks"] = closed_why, open_why
    rec["status"] = "PASS" if not closed_why and not open_why else "FAIL"
    if a.control:
        rec["status"] = "CONTROL FAILED AS IT MUST" if closed_why else "CONTROL DID NOT FAIL (the tool cannot fail)"
    save()
    for label in ("closed", "open"):
        s = rec[label]
        print(f"--- {label}: innerWidth {s['innerWidth']}  row right {s['row']['rect']['right']}  "
              f"scrollW/clientW {s['row']['scrollWidth']}/{s['row']['clientWidth']}  visualRows {s['visualRows']}  "
              f"title top {s['title']['rect']['top'] if s['title'] else None}")
        for c in s["controls"]:
            print(f"    {c['name'][:28]:28s} x {c['rect']['left']:7.2f}..{c['rect']['right']:7.2f}  w {c['rect']['width']:6.2f}  "
                  f"y {c['rect']['top']:7.2f}  {'OK' if c['rightEdgeOk'] and c['hitsSelf'] else 'BREAK'}")
    for w in closed_why:
        print("CLOSED BREAK:", w)
    for w in open_why:
        print("OPEN BREAK:", w)
    print(f"{rec['status']}  raw: {out / 'rects.json'}")
    if a.control:
        return 0 if closed_why else 1
    return 0 if rec["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
