"""Lane KEYS3 round 2: the folder tree's type-ahead and the Journal's "g then letter" keys,
checked in a real browser.

The defect (reproduced first in app/src/pages/journal-2-0/JournalLayout.test.jsx): on a folder
row, typing "ga" for a folder called Gaps moved to it AND opened the Calendar, because the
Journal binds "g then a" on the document. The fix stops a key the tree takes at the tree.

This probe borrows the click tool's own sandbox, sign-in and seeding (tools/notebook_w13q_clicks.py,
unchanged): it swaps that tool's list of flows for ONE probe and calls its `main`. The probe's
row is written under the id Q1 only because the tool keys its rows by flow id; the row's
`outcome` is this probe's evidence and its count is not a budget reading. Same ports
(8720-8724), same refusals, same integrity snapshots.

    python tools/notebook_fin_keys3_typeahead_probe.py --data-dir '<scratch>\\ta1' --port 8723 `
        --out 'docs\\notebook\\evidence\\fin-keys3\\<sha>\\typeahead-probe'

What it does, keys only, at 1280 px and 390 px:
  1. makes two folders, "Gaps" and "Goals";
  2. opens the notes list, takes "Skip to folder navigation", Tabs to the folder tree;
  3. types g then a on the focused row: the address must NOT change and focus must be on Gaps;
  4. types g then o a moment later (a new run of letters): still no move, focus on Goals;
  5. leaves the tree (focus on the page body) and presses g then j: the page MUST go to Closed trades.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import notebook_w13q_clicks as q  # noqa: E402

FOCUS = """() => { const el = document.activeElement;
  return {role: el && el.getAttribute('role'), name: el && (el.getAttribute('aria-label') || '').trim(),
          tag: el && el.tagName} }"""


def probe(cx: q.Ctx, pg, m: q.Meter, width: str) -> dict:
    for name in ("Gaps", "Goals"):
        r = cx.req.post(cx.base + "/api/j2/note-folders", data={"name": name})
        if r.status not in (200, 201, 409):
            raise q.Inconclusive(f"setup: could not make the folder {name} (HTTP {r.status})")
    q.open_start(pg, cx.base, "/journal/notebook?view=all")
    tree = pg.locator('[role="tree"]')
    try:
        tree.first.wait_for(state="visible", timeout=8000)
    except Exception:  # noqa: BLE001 -- a narrow window opens with the folders panel shut
        m.press(pg.get_by_role("button", name="Show folders panel"), "Show folders panel")
        tree.first.wait_for(state="visible", timeout=20000)
    pg.get_by_role("treeitem", name=re.compile(r"^Gaps")).first.wait_for(state="visible", timeout=20000)
    q.use_skip_link(m, r"Skip to folder navigation", "Skip to folder navigation")
    m.tab_to("el.getAttribute && el.getAttribute('role') === 'treeitem'", "a row of the folder tree")
    start = pg.evaluate(FOCUS)
    url0 = pg.url
    m.key("g", "type-ahead: g")
    m.key("a", "type-ahead: a")
    pg.wait_for_timeout(1500)
    after_ga = {"url": pg.url, "focus": pg.evaluate(FOCUS)}
    if pg.url != url0 or not after_ga["focus"]["name"].startswith("Gaps"):
        raise q.Inconclusive(f"typing g, a on a folder row: address {url0} -> {pg.url}, focus {after_ga['focus']}")
    m.key("g", "type-ahead: g")
    m.key("o", "type-ahead: o")
    pg.wait_for_timeout(1500)
    after_go = {"url": pg.url, "focus": pg.evaluate(FOCUS)}
    if pg.url != url0 or not after_go["focus"]["name"].startswith("Goals"):
        raise q.Inconclusive(f"typing g, o on a folder row: address {url0} -> {pg.url}, focus {after_go['focus']}")
    pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur() }")
    body = pg.evaluate(FOCUS)
    went = q.journal_chord(m, "j", "Closed trades", "**/journal/trades?*seg=closed*")
    if not went:
        raise q.Inconclusive(f"g then j from the page body did not navigate (address {pg.url})")
    return {"tree_row_at_start": start, "address_before": url0, "after_g_a": after_ga, "after_g_o": after_go,
            "focus_before_g_j": body, "after_g_j_from_body": pg.url}


if __name__ == "__main__":
    q.FLOWS = [q.Flow("Q1", probe, modes=("keys",),
                      notes="NOT Q1: lane KEYS3's type-ahead probe, under the tool's first flow id")]
    argv = sys.argv[1:] + ["--only", "Q1", "--modes", "keys", "--wide", "1280"]
    sys.exit(q.main(argv))
