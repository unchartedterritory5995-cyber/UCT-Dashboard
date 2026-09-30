"""Lane DR-B -- STEP 1 check for design-review finding D-3 (the editor's row-count /
Delete-placement finding), re-measured fresh in a real Chromium at the CURRENT tip.

D-3's own text (`docs/notebook/design-review.md`): "Up to five rows of controls above
the title; a red Delete button among the first controls on every note," captured at
tree fa6710394 (`uct-editor-1200.png`).

Code review (before writing this) found the fix already landed, in the SAME wave-10
L2 PR that fixed D-1 (#242, commit f4cec49be, folded from lane K2's own commits):
NoteEditorPage.jsx's header comment says "Wave 10 lane K2 (D-3): the page-level
actions live behind ONE 'More note actions' door" and NoteMoreMenu.jsx's docstring
names the same finding. Lane K2's OWN evidence trail
(docs/notebook/evidence/d3-controls-2026-09-28/{before,after}.json, produced by
d3_measure.py in that same directory) already measured BEFORE (fa6710394: 5 rows at
1200, Delete in row 2) and AFTER (75c7ef596: 2 rows at 1200, Delete last of 10 inside
the menu). This script does not trust that history alone -- it re-runs the same
measurement fresh, in a real browser, against THIS tip, because a later regression
could have reopened the rows.

The JS payloads (MEASURE_JS, INSIDE_MORE_JS) are the ones lane K2's own
`docs/notebook/evidence/d3-controls-2026-09-28/d3_measure.py` used and are carried
over near-verbatim (same row-grouping algorithm, same Delete-detection); this script
supplies its own sandbox boot (tools/notebook_perf_harness.Sandbox, the same one
lane DR-A's dra_walk.py used) rather than lane 10E-2's e2_sandbox harness, so it has
no dependency on any other lane's sandbox instance.

    python docs/notebook/proof/drb-instrument/drb_d3_measure.py --data-dir 'C:\\...\\drb-data' \\
        --port 8243 --out docs/notebook/proof/drb-<sha>/before/d3-measure.json \\
        --shots docs/notebook/proof/drb-<sha>/before/shots --tip <sha>

Exit: 0 = ran end to end (rows may still individually record an error -- read them);
3 = refused or never started.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO))

from tools import notebook_perf_harness as H  # noqa: E402

MEMBER = ("drb-d3check@local.dev", "LocalTest2026!", "drb d3 check")
NOTE_TITLE = "DRB D3 check note"
WIDTHS = ((390, 844, True), (1200, 800, False))
VISITS = ("returning", "first_visit")

# Carried over near-verbatim from docs/notebook/evidence/d3-controls-2026-09-28/d3_measure.py
# (lane K2's own D-3 instrument): same row-grouping algorithm (a control joins the current row
# when its vertical centre falls inside the row's band so far), same Delete-detection.
MEASURE_JS = r"""
() => {
  const title = document.querySelector('[data-note-title]');
  if (!title) return {error: 'no title input'};
  const header = document.querySelector('[data-tour="ask-row"]');
  let root = title.parentElement;
  while (root && header && !root.contains(header)) root = root.parentElement;
  root = root || document.body;
  const tr = title.getBoundingClientRect();
  const sel = 'a[href],button,input,select,textarea,[role="button"],[role="menuitem"],[role="checkbox"],[tabindex]:not([tabindex="-1"])';
  const nameOf = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder')
    || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const shown = (el) => {
    if (el.closest('[hidden],[aria-hidden="true"]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
  const ctl = [];
  for (const el of root.querySelectorAll(sel)) {
    if (el === title || !shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > tr.top + 1) continue;
    const cs = getComputedStyle(el);
    ctl.push({name: nameOf(el), tag: el.tagName.toLowerCase(), x: Math.round(r.x), y: Math.round(r.y),
              w: Math.round(r.width), h: Math.round(r.height), color: cs.color, bg: cs.backgroundColor});
  }
  const order = ctl.slice();
  ctl.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const c of ctl) {
    const mid = c.y + c.h / 2;
    const row = rows[rows.length - 1];
    if (row && mid >= row.top && mid <= row.bottom) {
      row.items.push(c); row.bottom = Math.max(row.bottom, c.y + c.h); row.top = Math.min(row.top, c.y);
    } else rows.push({top: c.y, bottom: c.y + c.h, items: [c]});
  }
  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
  const isDelete = (c) => c.name === 'Delete';
  let del = null;
  rows.forEach((r, i) => r.items.forEach((c, j) => { if (isDelete(c)) del = {row: i + 1, place_in_row: j + 1, rect: [c.x, c.y, c.w, c.h], color: c.color, bg: c.bg}; }));
  if (del) del.place_among_controls_above_title = order.findIndex(isDelete) + 1;
  const more = Array.from(root.querySelectorAll('button')).find((b) => shown(b) && (b.getAttribute('aria-label') || '') === 'More note actions');
  return {
    title_rect: [Math.round(tr.x), Math.round(tr.y), Math.round(tr.width), Math.round(tr.height)],
    root_top: Math.round(root.getBoundingClientRect().top),
    rows_above_title: rows.length,
    controls_above_title: ctl.length,
    rows: rows.map((r, i) => ({row: i + 1, top: r.top, bottom: r.bottom,
      names: r.items.map((c) => c.name || `(${c.tag})`),
      x_w: r.items.map((c) => [c.x, c.w])})),
    editor_pane: (() => { const b = root.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.width)]; })(),
    delete_on_screen: del,
    more_note_actions: more ? {rect: (() => { const r = more.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })()} : null,
  };
}
"""

INSIDE_MORE_JS = r"""
() => {
  const panel = document.getElementById(document.querySelector('button[aria-label="More note actions"]')?.getAttribute('aria-controls') || '');
  if (!panel) return {error: 'no panel for More note actions'};
  const items = Array.from(panel.querySelectorAll('button,[role="menuitem"],input'))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
    .map((el) => (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40));
  const del = items.indexOf('Delete');
  return {panel_label: panel.getAttribute('aria-label'), items, delete_place: del >= 0 ? del + 1 : null,
          delete_is_last: del >= 0 && del === items.length - 1};
}
"""


def measure_one(pg, base: str, nid: str, visit: str, shots: Path | None, vw: int) -> dict:
    pg.goto(f"{base}/journal/notebook?note={nid}", wait_until="domcontentloaded")
    H._dismiss_intro(pg)
    row: dict = {}
    try:
        pg.wait_for_selector("[data-note-title]", state="attached", timeout=15000)
    except Exception as e:  # noqa: BLE001
        row["error"] = f"title never attached: {type(e).__name__}"
    pg.wait_for_timeout(2500)
    row.update(pg.evaluate(MEASURE_JS))
    if shots:
        pg.screenshot(path=str(shots / f"d3-{vw}-{visit}.png"))
    if not row.get("delete_on_screen") and row.get("more_note_actions"):
        pg.locator('button[aria-label="More note actions"]').first.click()
        pg.wait_for_timeout(500)
        row["inside_more_note_actions"] = pg.evaluate(INSIDE_MORE_JS)
        if shots:
            pg.screenshot(path=str(shots / f"d3-{vw}-{visit}-more-open.png"))
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)
    return row


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8243)
    ap.add_argument("--out", required=True)
    ap.add_argument("--shots", default="")
    ap.add_argument("--tip", default="unset")
    a = ap.parse_args()

    shots = Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{a.port}"
    res: dict = {"tip": a.tip, "instrument": "drb_d3_measure.py", "data_dir": a.data_dir, "port": a.port,
                 "note": NOTE_TITLE, "widths": {}}

    refused = H.refuse_shared_root(a.data_dir) or (H.port_busy(a.port) and f"port {a.port} busy")
    if refused:
        print(f"NOT RUN: {refused}")
        return 3

    sb = H.Sandbox(a.data_dir, a.port, (shots or Path(a.out).parent) / "sandbox-boot.log")
    not_run = None
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    def flush():
        out.write_text(json.dumps(res, indent=1, default=str), encoding="utf-8")

    flush()
    try:
        sb.start()
        if not sb.wait_healthy(base, 300):
            not_run = "sandbox never healthy"
        else:
            sb.wait_checkpoint(H.POST_BOOT, H.POST_BOOT_WAIT_S)
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch()
                res["browser_version"] = browser.version
                try:
                    admin_ctx = browser.new_context()
                    member_ctx = browser.new_context()
                    H._provision(admin_ctx.request, member_ctx.request, base, member=MEMBER)
                    doc, _marker = H.paragraphs_doc(4, "drb-d3")
                    nid = member_ctx.request.post(
                        base + "/api/j2/notes", data={"title": NOTE_TITLE, "bodyJson": doc, "tags": ["drbtag"]},
                    ).json()["note"]["id"]
                    state = member_ctx.storage_state()
                    admin_ctx.close()
                    member_ctx.close()

                    for vw, vh, touch in WIDTHS:
                        for visit in VISITS:
                            ctx = browser.new_context(viewport={"width": vw, "height": vh}, has_touch=touch,
                                                       is_mobile=touch and vw < 700, storage_state=state)
                            if visit == "returning":
                                ctx.add_init_script(
                                    "try { localStorage.setItem('voice.dictation.hintSeen', '1') } catch (e) {}"
                                )
                            pg = ctx.new_page()
                            row = measure_one(pg, base, nid, visit, shots, vw)
                            res["widths"][f"{vw}-{visit}"] = row
                            flush()
                            ctx.close()
                finally:
                    browser.close()
            sb.wait_checkpoint(H.PREWARM, 200)
    except Exception as e:  # noqa: BLE001
        not_run = f"{type(e).__name__}: {e}"
        res["traceback"] = traceback.format_exc()[-2000:]
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        integ = H.read_integrity(ipath, [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN])
        first = H.integrity_line(integ, not_run=not_run)
        res.update(integrity_log=ipath, integrity=integ, first_line=first, not_run=not_run)
        flush()
        print(first)
    for w, r in res["widths"].items():
        print(w, "rows above title:", r.get("rows_above_title"), "| Delete on screen:",
              bool(r.get("delete_on_screen")), "| error:", r.get("error"), flush=True)
    return 3 if not_run else 0


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())
