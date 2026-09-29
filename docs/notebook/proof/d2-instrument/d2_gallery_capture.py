"""Wave 10 lane D2 (design finding D-4) -- the Templates gallery in a real browser.

Same sandbox and member recipe as d2_phone_measure.py. At 1200x800, 820x1180 (touch) and
390x844 (touch, mobile): open /journal/notebook?view=all, press the toolbar's "Templates",
and record, from the page itself:
  - the dialog's accessible name (aria-labelledby resolved to text) and aria-modal;
  - every gallery card: template key, name, whether it carries a preview and its lines,
    grouped under which family label -- and the catalog count the page was built from;
  - axe-core (the repo's own node_modules copy) on the open dialog;
  - focus trap: 40 Tab presses, is focus still inside the dialog every time;
  - keyboard selection: focus the first card, ArrowRight x2, which card has focus, and
    (1200 only) Enter -- the note it made (?note= and its title);
  - Escape closes the dialog and focus returns to the Templates button (a second open).
Screenshots of the open dialog at each width.

    python d2_gallery_capture.py --data-dir C:/data-w10d2 --port 8228 --out <json> --art <dir> --tip <sha>
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
sys.path.insert(0, str(REPO / "scripts"))

from tools import notebook_perf_harness as H  # noqa: E402

MEMBER = ("d2phone@local.dev", "LocalTest2026!", "d2 phone")
VIEWPORTS = [(1200, 800, False, False), (820, 1180, True, False), (390, 844, True, True)]
AXE = REPO / "app" / "node_modules" / "axe-core" / "axe.min.js"

DIALOG_JS = r"""() => {
  const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).find(d => d.querySelector('[data-template-gallery]'));
  if (!dlg) return {open: false};
  const ids = (dlg.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  const name = ids.map(id => (document.getElementById(id) || {}).textContent || '').join(' ').trim() || dlg.getAttribute('aria-label');
  const cards = Array.from(dlg.querySelectorAll('[data-template-key]')).map(b => {
    const grp = b.closest('[role="group"]');
    const famId = grp ? grp.getAttribute('aria-labelledby') : null;
    const prev = b.querySelector('[data-template-preview]');
    const r = b.getBoundingClientRect();
    return {key: b.getAttribute('data-template-key'), name: b.getAttribute('aria-label'),
            family: famId ? (document.getElementById(famId) || {}).textContent : null,
            preview: prev ? Array.from(prev.children).map(c => c.textContent) : null,
            box: {top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height)}};
  });
  return {open: true, name, modal: dlg.getAttribute('aria-modal'), cards,
          allCards: dlg.querySelectorAll('[data-template-card]').length,
          docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth};
}"""

INSIDE_JS = r"""() => { const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).find(d => d.querySelector('[data-template-gallery]'));
  const a = document.activeElement; return {inside: !!(dlg && a && dlg.contains(a)), key: a ? a.getAttribute('data-template-key') : null,
  label: a ? (a.getAttribute('aria-label') || (a.textContent || '').trim().slice(0, 40)) : null}; }"""


def open_gallery(pg) -> None:
    pg.get_by_role("button", name="Templates", exact=True).first.click(timeout=8000)
    pg.wait_for_selector('[role="dialog"] [data-template-gallery]', timeout=10000)
    pg.wait_for_timeout(600)


def run_viewport(br, base, vw, vh, touch, mobile, art, storage, do_create) -> dict:
    ctx = br.new_context(viewport={"width": vw, "height": vh}, has_touch=touch, is_mobile=mobile,
                         reduced_motion="reduce", storage_state=storage)
    ctx.add_init_script("try { localStorage.setItem('voice.orb.coachmarkSeen', '1'); } catch (e) {}")
    pg = ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    row: dict = {"viewport": f"{vw}x{vh}"}
    try:
        pg.goto(base + "/journal/notebook?view=all")
        H._dismiss_intro(pg)
        pg.wait_for_selector("[data-note-card-id]", state="attached", timeout=30000)
        pg.wait_for_timeout(1500)
        open_gallery(pg)
        row["dialog"] = pg.evaluate(DIALOG_JS)
        pg.screenshot(path=str(art / f"gallery-{vw}.png"))
        dlg = pg.locator('[role="dialog"]').filter(has=pg.locator("[data-template-gallery]")).first
        dlg.screenshot(path=str(art / f"gallery-dialog-{vw}.png"))
        # axe on the open dialog
        try:
            pg.add_script_tag(path=str(AXE))
            res = pg.evaluate("""async () => { const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).find(d => d.querySelector('[data-template-gallery]'));
                const r = await axe.run(dlg, {resultTypes: ['violations']});
                return r.violations.map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help})); }""")
            row["axe_violations"] = res
        except Exception as e:  # noqa: BLE001
            row["axe_violations"] = f"axe did not run: {type(e).__name__}: {str(e)[:160]}"
        # focus trap
        trap = []
        for _ in range(40):
            pg.keyboard.press("Tab")
            trap.append(pg.evaluate(INSIDE_JS)["inside"])
        row["focus_trap_40_tabs_all_inside"] = all(trap)
        # keyboard selection
        first = pg.locator('[role="dialog"] [data-template-card]').first
        first.focus()
        pg.keyboard.press("ArrowRight")
        pg.keyboard.press("ArrowRight")
        row["after_two_arrow_rights"] = pg.evaluate(INSIDE_JS)
        pg.keyboard.press("End")
        row["after_end"] = pg.evaluate(INSIDE_JS)
        pg.keyboard.press("Home")
        row["after_home"] = pg.evaluate(INSIDE_JS)
        # Escape closes, focus returns to the Templates button
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(600)
        row["escape"] = pg.evaluate("""() => ({open: !!Array.from(document.querySelectorAll('[role="dialog"]')).find(d => d.querySelector('[data-template-gallery]')),
            focus: document.activeElement ? (document.activeElement.textContent || '').trim().slice(0, 30) : null})""")
        if do_create:
            open_gallery(pg)
            first = pg.locator('[role="dialog"] [data-template-card]').first
            first.focus()
            pg.keyboard.press("ArrowRight")
            pg.keyboard.press("ArrowRight")
            picked = pg.evaluate(INSIDE_JS)
            pg.keyboard.press("Enter")
            pg.wait_for_selector("[data-note-title]", timeout=20000)
            pg.wait_for_timeout(1500)
            row["enter_created"] = {"picked": picked, "url": pg.url.replace(base, ""),
                                    "title": pg.eval_on_selector("[data-note-title]", "el => el.value || el.textContent")}
            pg.screenshot(path=str(art / f"gallery-created-{vw}.png"))
    except Exception as e:  # noqa: BLE001
        row["error"] = f"{type(e).__name__}: {e}"
        row["trace"] = traceback.format_exc()[-800:]
    finally:
        row["page_errors"] = errors[:5]
        ctx.close()
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8228)
    ap.add_argument("--out", required=True)
    ap.add_argument("--art", required=True)
    ap.add_argument("--tip", required=True)
    a = ap.parse_args()
    if H.refuse_shared_root(a.data_dir):
        print(H.refuse_shared_root(a.data_dir))
        return 3
    art = Path(a.art)
    art.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{a.port}"
    res: dict = {"tip": a.tip, "instrument": "d2_gallery_capture.py", "data_dir": a.data_dir,
                 "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "rows": []}
    sb = H.Sandbox(a.data_dir, a.port, art / "sandbox-boot.log")
    sb.start()
    try:
        if not sb.wait_healthy(base, 240):
            res["error"] = "sandbox never became healthy"
            return 3
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            br = p.chromium.launch(ignore_default_args=["--hide-scrollbars"])
            admin_ctx = br.new_context()
            member_ctx = br.new_context()
            H._provision(admin_ctx.request, member_ctx.request, base, member=MEMBER)
            storage = member_ctx.storage_state()
            for vw, vh, touch, mobile in VIEWPORTS:
                row = run_viewport(br, base, vw, vh, touch, mobile, art, storage, do_create=(vw == 1200))
                res["rows"].append(row)
                print(json.dumps({"viewport": row["viewport"], "error": row.get("error")}), flush=True)
            br.close()
        sb.wait_checkpoint("post-prewarm (+120s)", 200)
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        res["integrity_log"] = ipath
        res["integrity"] = H.read_integrity(ipath, []) if ipath else None
        Path(a.out).write_text(json.dumps(res, indent=1, default=str), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
