"""Wave 10 D-5 -- the board's horizontal scroll cue. R-RAW: measure BEFORE building the fix,
build it, measure AFTER, commit both raw runs.

The design-recheck (docs, controller dir, row D-5) found F5's fix REAL -- the board's own
row scrolls itself, no page pans -- but its scroll AFFORDANCE unproven: the only committed
scrollbars-shown capture of the real board shows a cut-off column, and a pixel scan under the
columns "finds nothing above black". This script answers, at 1200x800, 820x900 and 390x844,
WITH SCROLLBARS SHOWN (`ignore_default_args=["--hide-scrollbars"]` -- Playwright's headless
default hides every scrollbar and reads them all as 0 px, the exact instrument gap the
design-recheck named):
  * the scroller's own scrollWidth vs clientWidth (does the board actually overflow here);
  * whether the OS/browser scrollbar THUMB is painted -- a coarse pixel scan of the strip
    under the columns, the same technique the F5 probe (docs/notebook/proof/f5-after-*/
    instrument/scrollbar_shown_probe.py) used;
  * the app's own `data-board-scroll-more` attribute on the scroller. It does not exist
    before the fix (the script records `cue_attr: null`, not a crash); after the fix it
    reads "true"/"false" -- the ground truth NoteBoardView.jsx's own effect computes;
  * a screenshot.

The Notebook always renders `builtin:thesis_status`'s 4 declared options + "No value" = 5
columns REGARDLESS of note count (NoteBoardView.jsx's `columns` memo is keyed on the
PROPERTY DEFINITION, never on `notes`), so a fresh account with zero notes already overflows
at 1200 and 820 -- exactly what the design-recheck measured. Two placeholder notes are seeded
only so the Notebook is not in its empty-notebook UI state.

Sandbox boot + sign-in reuse `tools/notebook_perf_harness.py` (Sandbox, refuse_shared_root,
port_busy, _provision, _dismiss_intro) -- NOT `tools/notebook_proof_walk.py`, which this
lane's brief excludes.

    python tools/notebook_d5_scroll_probe.py --data-dir 'C:\\data-w10d5' --port 8232 \\
        --out docs/notebook/proof/d5-before-<sha>/probe.json \\
        --art docs/notebook/proof/d5-before-<sha>/shots --tag before --tip <sha>

Exit: 0 = ran end to end (rows may still individually record an error -- read them);
3 = refused or never started (bad args, shared data root, busy port, sandbox never healthy,
or sign-in/comp failed).
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import traceback
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

VIEWPORTS = [("1200x800", 1200, 800), ("820x900", 820, 900), ("390x844", 390, 844)]

# Finds the scroller by STRUCTURE, not by CSS-module class (hashed per build) and not by the
# `data-board-scroll-more` attribute this script itself is trying to measure the arrival of
# (it does not exist before the fix). Every board column is `<section aria-label="...">`,
# a direct child of the one scrolling row -- true before and after this lane's change.
SAMPLE_JS = r"""
() => {
  const firstCol = document.querySelector('section[aria-label]')
  const el = firstCol ? firstCol.parentElement : null
  if (!el) return { found: false }
  const r = el.getBoundingClientRect()
  const cols = Array.from(el.children).filter((c) => c.tagName === 'SECTION' && c.hasAttribute('aria-label'))
  // D5 fix round 1 (I2a): cue_attr is a DOM ATTRIBUTE, not proof of paint -- a member
  // never sees an attribute, they see the browser's own COMPUTED style. Reading it
  // directly closes that gap: getComputedStyle resolves the CSS cascade (the
  // attribute selector actually matching, var(--board-fade-w) actually resolving) the
  // way the rendering engine will, independent of what the DOM attribute merely says.
  // Both spellings are read because engines disagree on which is canonical --
  // Chromium (this probe's browser) still reports through the -webkit- prefixed OM
  // property for a mask declared with both, alongside its own unprefixed maskImage.
  const cs = getComputedStyle(el)
  return {
    found: true,
    cue_attr: el.getAttribute('data-board-scroll-more'),
    computed_mask_image: cs.maskImage || null,
    computed_webkit_mask_image: cs.webkitMaskImage || null,
    scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft,
    overflowing: el.scrollWidth - el.clientWidth > 2,
    box: { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) },
    column_count: cols.length,
    column_labels: cols.map((c) => c.getAttribute('aria-label')),
  }
}
"""


def _scrollbar_thumb_painted(png_bytes: bytes, box: dict) -> dict:
    """Coarse pixel scan of the strip immediately under the scroller's own box -- where a
    horizontal scrollbar thumb paints. A presence probe (>1 distinct colour in the strip),
    the same technique the F5 probe used, not a rendering diff."""
    from PIL import Image
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    y0 = max(0, box["bottom"] - 14)
    y1 = min(img.height, box["bottom"] + 2)
    x0 = max(0, box["left"])
    x1 = min(img.width, box["right"])
    if y1 <= y0 or x1 <= x0:
        return {"scanned": False, "why": "box off-screen or zero-sized"}
    px = img.load()
    seen: dict[tuple, int] = {}
    for y in range(y0, y1, 2):
        for x in range(x0, x1, 6):
            c = px[x, y]
            seen[c] = seen.get(c, 0) + 1
    sums = [sum(c) for c in seen]
    return {
        "scanned": True, "y_range": [y0, y1], "x_range": [x0, x1],
        "distinct_colors": len(seen), "darkest_sum": min(sums) if sums else None,
        "lightest_sum": max(sums) if sums else None,
        # more than one flat colour in the strip is what a painted thumb (against its
        # track) looks like; a strip that is all one colour has nothing painted in it.
        "thumb_painted": len(seen) > 1,
    }


def measure(pg, art: Path, tag: str) -> dict:
    a = pg.evaluate(SAMPLE_JS)
    shot_path = art / f"{tag}.png"
    png = pg.screenshot(path=str(shot_path), full_page=False)
    out = {"sample": a, "screenshot": shot_path.name}
    if a.get("found"):
        out["scrollbar"] = _scrollbar_thumb_painted(png, a["box"])
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8232)
    ap.add_argument("--out", required=True)
    ap.add_argument("--art", required=True)
    ap.add_argument("--tag", required=True, choices=["before", "after"])
    ap.add_argument("--tip", required=True)
    a = ap.parse_args()

    from tools import notebook_perf_harness as H

    art = Path(a.art)
    art.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{a.port}"
    res = {"tip": a.tip, "tag": a.tag, "instrument": "notebook_d5_scroll_probe.py",
           "scrollbars": "shown", "viewports": [v[0] for v in VIEWPORTS], "rows": []}

    refused = H.refuse_shared_root(a.data_dir) or (H.port_busy(a.port) and f"port {a.port} busy")
    if refused:
        print(f"NOT RUN: {refused}")
        return 3

    sb = H.Sandbox(a.data_dir, a.port, art / "launcher.log")
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
                    try:
                        H._provision(admin_ctx.request, member_ctx.request, base,
                                      member=("d5probe@local.dev", "LocalTest2026!", "d5probe"))
                    except H.SetupFailed as e:
                        not_run = str(e)
                    else:
                        for i in range(2):
                            doc, _marker = H.paragraphs_doc(1, f"d5-{a.tag}-{i}")
                            member_ctx.request.post(base + "/api/j2/notes",
                                                     data={"title": f"D5 probe note {i + 1}", "bodyJson": doc})
                        state = member_ctx.storage_state()
                        for label, w, h in VIEWPORTS:
                            ctx = browser.new_context(viewport={"width": w, "height": h}, storage_state=state)
                            pg = ctx.new_page()
                            errors: list[str] = []
                            pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
                            try:
                                # ⛔ Bare /journal/notebook lands on `isHome` (NotebookTab.jsx:527)
                                # -- a "Research home" surface with NO view switcher at all.
                                # `?view=all` is the documented door past it (line 526, same file;
                                # also the task-reminder link's door for `?view=tasks`).
                                pg.goto(base + "/journal/notebook?view=all", wait_until="networkidle", timeout=30000)
                                H._dismiss_intro(pg)
                                pg.get_by_role("button", name="Board view").click(timeout=10000)
                                pg.wait_for_selector('section[aria-label]', timeout=10000)
                                pg.wait_for_timeout(500)
                                row = {"viewport": label, **measure(pg, art, f"{a.tag}-{label}"),
                                       "page_errors": errors[:5]}
                            except Exception as e:  # noqa: BLE001 -- recorded per row, the run continues
                                # A diagnostic shot even on failure -- R-RAW: a run with no raw
                                # artifact is inconclusive, and a failure is the run whose trail
                                # matters most.
                                diag = art / f"{a.tag}-{label}-ERROR.png"
                                try:
                                    pg.screenshot(path=str(diag))
                                except Exception:  # noqa: BLE001
                                    diag = None
                                row = {"viewport": label, "error": f"{type(e).__name__}: {e}"[:300],
                                       "page_errors": errors[:5],
                                       "error_screenshot": diag.name if diag else None}
                            finally:
                                ctx.close()
                            res["rows"].append(row)
                            s = row.get("sample", {}) or {}
                            print(json.dumps({
                                "viewport": label, "found": s.get("found"),
                                "cue_attr": s.get("cue_attr"), "overflowing": s.get("overflowing"),
                                "columns": s.get("column_count"),
                                "computed_mask_image": s.get("computed_mask_image"),
                                "thumb_painted": (row.get("scrollbar") or {}).get("thumb_painted"),
                                "error": row.get("error"),
                            }), flush=True)
                finally:
                    browser.close()
    except Exception as e:  # noqa: BLE001
        not_run = f"{type(e).__name__}: {e}"
        res["traceback"] = traceback.format_exc()[-2000:]
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        integ = H.read_integrity(ipath, [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN])
        first = H.integrity_line(integ, not_run=not_run)
        res.update(first_line=first, integrity=integ, not_run=not_run)
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
