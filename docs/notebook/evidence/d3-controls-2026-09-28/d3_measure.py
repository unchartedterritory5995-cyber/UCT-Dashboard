"""Design finding D-3 (lane 10E-2's design review): "up to 5 rows of controls above the note
title, with a red Delete among the first." A MEASUREMENT for lane K2 (wave 10), run before and
after the change against the same sandbox, and committed raw (R-RAW) before any summary.

    python d3_measure.py <scratch-dir-of-e2_sandbox> <out.json> [--shots <dir>]

For each width (390 and 820 on a touch context, 1200 on a desktop one) it opens the walk
account's "Alpha thesis NVDA" note by its `?note=` link and reads, from the page itself:

* every visible control of the note editor that sits wholly ABOVE the title input, grouped into
  rows: a control joins the current row when its vertical centre falls inside the row's band so
  far, otherwise it starts a new row;
* each width twice: a RETURNING visit (the dictation first-run hint already seen, the steady
  state) and a FIRST visit (the hint showing);
* where Delete is: on screen (its row, its place among the controls above the title, its colours)
  or not on screen -- and then, when a "More note actions" control exists, it is opened (a click:
  this is a layout measurement, not the keyboard walk) and Delete's place inside it is read.

Preconditions: the sandbox from `docs/notebook/proof/e2-d9e887ca0/e2_sandbox.py` (never
production, never C:\\data), identity proved by `sandbox_identity.verify` before any request, and
the walk account seeded by the keyboard walk (`e2-kbd@local.dev`).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROOF = HERE.parents[1] / "proof" / "e2-d9e887ca0"
sys.path.insert(0, str(PROOF))
import e2_common as C  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

WALK_EMAIL = "e2-kbd@local.dev"
NOTE_TITLE = "Alpha thesis NVDA"
WIDTHS = ((390, 844, True), (820, 1180, True), (1200, 800, False))
VISITS = ("returning", "first_visit")

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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("scratch")
    ap.add_argument("out")
    ap.add_argument("--shots", default="")
    ap.add_argument("--tip", default="unset")
    a = ap.parse_args()
    ready = C.ready_record(Path(a.scratch))
    base = ready["base"]
    nonce = C.require_identity(base, ready["integrity_log"])
    shots = Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    rec = {"meta": {"tool": "d3_measure", "base": base, "nonce": nonce, "tip": a.tip,
                    "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "note": NOTE_TITLE},
           "widths": {}}
    out = Path(a.out)

    def flush():
        out.write_text(json.dumps(rec, indent=1, default=str), encoding="utf-8")

    flush()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        rec["meta"]["browser_version"] = browser.version
        for (vw, vh, touch), visit in [(w, v) for w in WIDTHS for v in VISITS]:
            ctx = browser.new_context(viewport={"width": vw, "height": vh}, has_touch=touch,
                                      is_mobile=touch and vw < 700)
            if visit == "returning":
                # the dictation first-run hint has been seen (VoiceInputButton's HINT_KEY): the
                # steady state a member sees on every note after their first
                ctx.add_init_script("try { localStorage.setItem('voice.dictation.hintSeen', '1') } catch (e) {}")
            C.signup_or_login(ctx.request, base, WALK_EMAIL, C.PW, "kbd walker")
            notes = ctx.request.get(base + "/api/j2/notes?limit=200").json().get("notes") or []
            nid = next((n["id"] for n in notes if n.get("title") == NOTE_TITLE), None)
            row = {"viewport": [vw, vh], "touch": touch, "visit": visit, "note_id": nid}
            if not nid:
                row["error"] = f"no note titled {NOTE_TITLE!r} (run the keyboard walk first: it seeds it)"
                rec["widths"][f"{vw}-{visit}"] = row
                flush()
                ctx.close()
                continue
            pg = ctx.new_page()
            pg.goto(f"{base}/journal/notebook?note={nid}", wait_until="domcontentloaded")
            C.dismiss_intro(pg)
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
            rec["widths"][f"{vw}-{visit}"] = row
            flush()
            ctx.close()
        browser.close()
    rec["meta"]["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    flush()
    for w, r in rec["widths"].items():
        print(w, "rows above title:", r.get("rows_above_title"), "| Delete on screen:", bool(r.get("delete_on_screen")),
              "| error:", r.get("error"), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
