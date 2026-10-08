"""Lane KEYS3 round 3: the final browser walk's two leftovers, checked in a real browser at
1280, 820 and 390 px (820 and 390 with touch).

  F1  "Skip to folder navigation" must land: with the folders panel shown, and with it hidden.
  F2  three touch controls must be at least 44 px: the template picker's "All" chip, the import
      wizard's destination select, and the label row that holds a checkbox in the wizard.

It borrows the click tool's sandbox, sign-in and seeding (tools/notebook_w13q_clicks.py,
unchanged) the way notebook_fin_keys3_typeahead_probe.py does: that tool's flow list is swapped
for ONE probe. The probe's row carries the id Q1 only because the tool keys rows by flow id;
its `outcome` is the evidence and its count is not a budget reading. All three widths are
measured inside the tool's 1280 row (each in its own browser context); the 390 row says so.

    python tools/notebook_fin_keys3_leftovers_probe.py --data-dir '<scratch>\\lo1' --port 8720 `
        --out 'docs\\notebook\\evidence\\fin-keys3\\<sha>\\leftovers-probe'
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import notebook_w13q_clicks as q  # noqa: E402

FOCUS = """() => { const el = document.activeElement; if (!el) return null;
  const r = el.getBoundingClientRect();
  return {tag: el.tagName, id: el.id || '', role: el.getAttribute('role') || '',
          name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60),
          on_screen: r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && r.width > 0} }"""
BOX = """el => { const r = el.getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height)} }"""


def _take_folder_skip(pg) -> dict:
    """From the top of the page, Tab to "Skip to folder navigation", press Enter, read focus."""
    pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur();"
                " const s = document.createElement('span'); s.tabIndex = -1; document.body.prepend(s);"
                " s.focus(); s.remove(); window.scrollTo(0, 0) }")
    tabs = 0
    for _ in range(10):
        pg.keyboard.press("Tab")
        tabs += 1
        if pg.evaluate("() => (document.activeElement.textContent || '').trim() === 'Skip to folder navigation'"):
            break
    else:
        return {"reached_link": False, "tabs": tabs}
    hidden_before = pg.get_by_role("button", name="Show folders panel").count() > 0
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(900)
    return {"reached_link": True, "tabs": tabs, "panel_hidden_before": hidden_before,
            "target_id_in_page": pg.evaluate("() => !!document.getElementById('notebook-folder-nav')"),
            "panel_hidden_after": pg.get_by_role("button", name="Show folders panel").count() > 0,
            "focus": pg.evaluate(FOCUS)}


def _one_width(cx: q.Ctx, br, state, width: int, height: int, touch: bool, md: Path) -> dict:
    ctx = br.new_context(viewport={"width": width, "height": height}, has_touch=touch, is_mobile=touch,
                         reduced_motion="reduce", storage_state=state)
    pg = ctx.new_page()
    out: dict = {"width": width, "touch": touch}
    try:
        q.open_start(pg, cx.base, "/journal/notebook?view=all")
        pg.get_by_role("button", name="Templates", exact=True).first.wait_for(state="visible", timeout=30000)
        # F1, as the page loads at this width
        out["f1_default"] = _take_folder_skip(pg)
        # F1, the other state: hide the panel if it is shown (or show it if it was hidden), again
        hide = pg.get_by_role("button", name="Hide folders panel")
        if hide.count() and hide.first.is_visible():
            hide.first.click()
            pg.wait_for_timeout(600)
            out["f1_after_hiding"] = _take_folder_skip(pg)
        # F2: the template picker's "All" chip
        pg.get_by_role("button", name="Templates", exact=True).first.click()
        dlg = pg.get_by_role("dialog", name="New note")
        dlg.wait_for(state="visible", timeout=20000)
        chip = dlg.get_by_role("button", name="All", exact=True).first
        out["f2_all_chip"] = chip.evaluate(BOX)
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(400)
        # F2: the import wizard, with one small file chosen
        pg.locator("[data-tour='import']").first.click()
        pg.locator("[data-testid='import-file-input']").set_input_files(str(md))
        dest = pg.locator("#import-dest-select")
        dest.wait_for(state="visible", timeout=30000)
        out["f2_destination_select"] = dest.evaluate(BOX)
        rows = pg.locator("label:has(input[type='checkbox'])").filter(visible=True)
        out["f2_checkbox_label_rows"] = [rows.nth(i).evaluate(BOX) for i in range(min(rows.count(), 4))]
        box = pg.locator("label:has(input[type='checkbox']) input[type='checkbox']").filter(visible=True)
        out["f2_checkbox_box"] = box.first.evaluate(BOX) if box.count() else None
    except Exception as e:  # noqa: BLE001 -- recorded, and the row then reads INCONCLUSIVE
        out["error"] = str(e)[:300]
    finally:
        ctx.close()
    return out


def probe(cx: q.Ctx, pg, m: q.Meter, width: str) -> dict:
    if width == "390":
        return {"note": "all three widths are measured in this probe's 1280 row"}
    md = Path(tempfile.mkdtemp(prefix="k3-leftovers-")) / "Imported plan.md"
    md.write_text("# Imported plan\n\nA line of text.\n", encoding="utf-8")
    br = pg.context.browser
    state = pg.context.storage_state()
    res = [_one_width(cx, br, state, w, h, t, md) for w, h, t in ((1280, 900, False), (820, 1180, True), (390, 844, True))]
    bad = []
    for r in res:
        if r.get("error"):
            bad.append(f"{r['width']}: {r['error']}")
            continue
        for k in ("f1_default", "f1_after_hiding"):
            f = r.get(k)
            if f and not (f.get("reached_link") and f.get("target_id_in_page") and f["focus"]
                          and f["focus"]["on_screen"] and not f.get("panel_hidden_after")
                          and (f["focus"]["role"] == "treeitem" or f["focus"]["id"] == "notebook-folder-nav")):
                bad.append(f"{r['width']} {k}: {f}")
        if r["touch"]:
            small = [(k, v) for k, v in (("all chip", r["f2_all_chip"]), ("destination", r["f2_destination_select"]))
                     if v["w"] < 44 or v["h"] < 44]
            small += [("checkbox label row", v) for v in r["f2_checkbox_label_rows"] if v["h"] < 44]
            if small:
                bad.append(f"{r['width']} under 44 px: {small}")
    if bad:
        raise q.Inconclusive("; ".join(bad)[:900] + f" || full: {res}"[:1500])
    return {"widths": res}


if __name__ == "__main__":
    q.FLOWS = [q.Flow("Q1", probe, modes=("keys",),
                      notes="NOT Q1: lane KEYS3's leftovers probe (walk F1 and F2), under the tool's first flow id")]
    sys.exit(q.main(sys.argv[1:] + ["--only", "Q1", "--modes", "keys", "--wide", "1280"]))
