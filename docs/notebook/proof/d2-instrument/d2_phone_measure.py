"""Wave 10 lane D2 (design finding D-1) -- how far down a phone has to look before the Notebook.

Boots the census-pinned sandbox (scripts/hub_sandbox_boot.py, through the perf harness's own
`Sandbox`, which reads the launcher's integrity checkpoints), provisions a paid member through the
harness's `_provision` recipe, seeds four notes, and at 390x844 (touch, mobile) and 820x1180
(touch) reads, in a real Chromium over app/dist:

  LIST   /journal/notebook?view=all
         - every piece of chrome above the Notebook (the app's fixed top bar, the Journal header,
           its title, its action row, the Journal section strip) as boxes;
         - `nb_top`: where the Notebook's own box starts; `first_note_y`: the first note row;
         - the section strip: is every Journal tab ON SCREEN (one tap, no swipe)?
  DEEP   /journal/notebook?note=<id>   (a fresh page load, i.e. a pasted / shared link)
         - is the folder panel displayed, where, and how tall;
         - where the note's title and its first body line are; are they on the first screen;
         - what a finger at the centre of the first screen below the top bar lands on
           (folder panel / note / journal chrome) -- "what it paints first", as a hit, not a guess.
  BACK   (a) list -> tap the first note -> browser Back: is the list back, with no `?note=`?
         (b) the deep link -> the phone's own "back to notes" control, if the page has one:
             does it land on the list?
  MENUS  on the Notebook route: open the Journal header's More menu and the Log Trade split,
         and hit-test the centre of each item (the wave-10 L1a defect was a menu clipped so a
         finger landed on the backdrop).

Every reading is taken with the Layout's <main> scrolled to 0. The "Meet Compass" card is marked
seen before load (it is first-run chrome with its own lane; F5 measured it), so the numbers are the
steady-state screen.

    python d2_phone_measure.py --data-dir C:/data-w10d2 --port 8228 --out <json> --art <dir> --tip <sha>
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
VIEWPORTS = [(390, 844, True), (820, 1180, False)]  # (w, h, is_mobile); both has_touch
SEED_TITLES = ["D2 alpha thesis", "D2 beta review", "D2 gamma plan", "D2 delta notes"]

SAMPLE_JS = r"""(kind) => {
  const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el);
    return el.getClientRects().length > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const box = (el) => { if (!el || !vis(el)) return null; const r = el.getBoundingClientRect();
    return {top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
            left: Math.round(r.left), right: Math.round(r.right)}; };
  const vw = innerWidth, vh = innerHeight;
  const topbar = document.querySelector('header[class*="topBar"]');
  const h1 = Array.from(document.querySelectorAll('h1')).find(h => /Trade Journal/.test(h.textContent || ''));
  const jHeader = h1 ? h1.parentElement : document.querySelector('[data-journal-header]');
  const jRight = jHeader ? jHeader.querySelector('[class*="headerRight"]') : null;
  const strip = document.querySelector('nav[aria-label="Journal sections (mobile)"]');
  const rail = document.querySelector('nav[aria-label="Journal sections"]');
  const pane = document.getElementById('notebook-pane');
  const wrap = pane ? pane.parentElement : null;
  const sidebar = wrap ? wrap.querySelector('[class*="sidebarSlot"]') : null;
  const firstCard = Array.from(document.querySelectorAll('[data-note-card-id]')).find(vis) || null;
  // the first row of the NOTES LIST itself (the folder panel's Recents also carry the attribute)
  const firstListRow = pane ? (Array.from(pane.querySelectorAll('[data-note-card-id]')).find(vis) || null) : null;
  const toolsToggle = document.querySelector('[data-journal-tools-toggle]');
  const title = document.querySelector('[data-note-title]');
  const pm = document.querySelector('.ProseMirror');
  const firstBody = pm ? (Array.from(pm.children).find(vis) || pm) : null;
  const navItems = (n) => n && vis(n) ? Array.from(n.querySelectorAll('a,button')).map(a => {
      const r = a.getBoundingClientRect();
      return {label: (a.textContent || '').trim().slice(0, 20), left: Math.round(r.left), right: Math.round(r.right),
              top: Math.round(r.top), on_screen: r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh,
              active: /Active/.test(String(a.className))}; }) : null;
  const topbarBottom = box(topbar) ? box(topbar).bottom : 0;
  const probeY = Math.round(topbarBottom + (vh - topbarBottom) / 2);
  const hit = document.elementFromPoint(Math.round(vw / 2), probeY);
  const region = (el) => {
    if (!el) return 'nothing';
    if (sidebar && sidebar.contains(el)) return 'folder panel';
    if (pane && pane.contains(el)) return (el.closest('[data-note-pane]') ? 'note' : 'notes list pane');
    if (jHeader && jHeader.contains(el)) return 'journal header';
    if (strip && strip.contains(el)) return 'journal section strip';
    return (el.tagName || '?').toLowerCase() + '.' + String(el.className || '').slice(0, 40);
  };
  // What a reader meets first inside the Notebook, in paint order down the screen.
  const nbFirst = (() => {
    const cands = [['folder panel', box(sidebar)], ['note title', box(title)], ['first list row', box(firstListRow)]]
      .filter(c => c[1]);
    cands.sort((a, b) => a[1].top - b[1].top);
    return cands.length ? cands[0][0] : null;
  })();
  const main = document.querySelector('main');
  return {
    kind, path: location.pathname + location.search, vw, vh,
    main_scrollTop: main ? main.scrollTop : null,
    topbar: box(topbar), journal_header: box(jHeader), journal_title: box(h1), journal_actions: box(jRight),
    section_strip: box(strip), section_rail: box(rail),
    strip_items: navItems(strip), rail_items: navItems(rail),
    nb_top: box(wrap) ? box(wrap).top : null,
    journal_chrome_px: (box(wrap) ? box(wrap).top : 0) - topbarBottom,
    folder_panel: box(sidebar), folder_panel_displayed: vis(sidebar),
    first_note_row: box(firstCard), first_list_row: box(firstListRow),
    tools_toggle: box(toolsToggle), tools_expanded: toolsToggle ? toolsToggle.getAttribute('aria-expanded') : null,
    note_title: box(title), note_first_body: box(firstBody),
    note_title_on_first_screen: !!(box(title) && box(title).top >= 0 && box(title).bottom <= vh),
    nb_first_thing: nbFirst,
    centre_probe: {x: Math.round(vw / 2), y: probeY, region: region(hit)},
    phone_back: box(document.querySelector('[data-nb-phone-back]')),
    // the Notebook's own landing (Research Home) -- where a bare /journal/notebook opens
    home_visible: !!(pane && /Continue working/i.test(pane.textContent || '')),
  };
}"""

HIT_JS = r"""(sel) => { const el = document.querySelector(sel); if (!el) return {present: false};
  const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {present: true, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right),
          inside: !!(hit && el.contains(hit)), in_viewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth}; }"""


def seed(req, base: str) -> dict[str, str]:
    have = {}
    r = req.get(base + "/api/j2/notes?limit=200")
    for n in (r.json().get("notes") or []) if r.ok else []:
        if n.get("title") in SEED_TITLES:
            have[n["title"]] = n["id"]
    for t in SEED_TITLES:
        if t in have:
            continue
        body, _ = H.paragraphs_doc(6, t.replace(" ", "-"))
        c = req.post(base + "/api/j2/notes", data={"title": t, "bodyJson": body})
        if c.status not in (200, 201):
            raise H.SetupFailed(f"seeding {t!r}: HTTP {c.status} {c.text()[:200]}")
        have[t] = c.json()["note"]["id"]
    return have


def top0(pg) -> None:
    pg.evaluate("() => { const m = document.querySelector('main'); if (m) m.scrollTop = 0; window.scrollTo(0, 0); }")
    pg.wait_for_timeout(300)


def open_page(pg, base: str, path: str, wait_sel: str) -> None:
    pg.goto(base + path)
    H._dismiss_intro(pg)
    pg.wait_for_selector(wait_sel, state="attached", timeout=30000)
    pg.wait_for_timeout(2500)
    top0(pg)


def close_menu(pg) -> None:
    bd = pg.locator('[class*="menuBackdrop"]')
    if bd.count():
        bd.first.dispatch_event("click")
    pg.wait_for_timeout(300)


def menus(pg, art: Path, tag: str) -> dict:
    out = {}
    # A phone header collapsed behind a tools toggle: open it first (a real tap), and say so.
    tog = pg.locator("[data-journal-tools-toggle]")
    out["tools_toggle"] = {"present": bool(tog.count() and tog.first.is_visible())}
    if out["tools_toggle"]["present"]:
        out["tools_toggle"]["hit"] = pg.evaluate(HIT_JS, "[data-journal-tools-toggle]")
        tog.first.click(timeout=5000)
        pg.wait_for_timeout(300)
        out["tools_toggle"]["expanded_after_tap"] = tog.first.get_attribute("aria-expanded")
    more = pg.locator('button[aria-label="More"]').first
    try:
        more.click(timeout=5000)
        pg.wait_for_timeout(400)
        out["more_menu"] = {"community": pg.evaluate(HIT_JS, '[data-testid="j2-more-menu"] a[href="/journal/community"]'),
                            "accounts": pg.evaluate(HIT_JS, '[data-testid="j2-more-menu"] a[href="/journal/accounts"]')}
        pg.screenshot(path=str(art / f"{tag}-more-menu.png"))
        close_menu(pg)
    except Exception as e:  # noqa: BLE001 -- recorded, never silent
        out["more_menu"] = {"error": f"{type(e).__name__}: {str(e)[:160]}"}
    pg.wait_for_timeout(300)
    try:
        header = pg.locator('[class*="logTradeWrap"] button').first
        header.click(timeout=5000)
        pg.wait_for_timeout(400)
        items = pg.evaluate(r"""() => Array.from(document.querySelectorAll('[role="menu"][aria-label="Log a trade"] [role="menuitem"]'))
            .map(b => { const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                        return {label: (b.textContent || '').trim().slice(0, 30), inside: !!(hit && b.contains(hit)),
                                in_viewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth}; })""")
        out["log_trade_menu"] = {"items": items}
        pg.screenshot(path=str(art / f"{tag}-logtrade-menu.png"))
        close_menu(pg)
    except Exception as e:  # noqa: BLE001
        out["log_trade_menu"] = {"error": f"{type(e).__name__}: {str(e)[:160]}"}
    return out


def run_viewport(br, base: str, notes: dict[str, str], vw: int, vh: int, mobile: bool, art: Path, storage) -> dict:
    ctx = br.new_context(viewport={"width": vw, "height": vh}, has_touch=True, is_mobile=mobile,
                         reduced_motion="reduce", storage_state=storage)
    ctx.add_init_script("try { localStorage.setItem('voice.orb.coachmarkSeen', '1'); } catch (e) {}")
    pg = ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    row: dict = {"viewport": f"{vw}x{vh}", "is_mobile": mobile}
    alpha = notes[SEED_TITLES[0]]
    try:
        open_page(pg, base, "/journal/notebook?view=all", "[data-note-card-id]")
        row["list"] = pg.evaluate(SAMPLE_JS, "list")
        pg.screenshot(path=str(art / f"list-{vw}.png"))

        open_page(pg, base, f"/journal/notebook?note={alpha}", "[data-note-title]")
        row["deep"] = pg.evaluate(SAMPLE_JS, "deep")
        pg.screenshot(path=str(art / f"deep-{vw}.png"))

        # BACK (b): the phone's own control, from the deep link.
        back_b = {"control_present": False}
        if pg.locator("[data-nb-phone-back]").count() and pg.locator("[data-nb-phone-back]").first.is_visible():
            back_b["control_present"] = True
            pg.locator("[data-nb-phone-back]").first.click(timeout=5000)
            pg.wait_for_timeout(1500)
            top0(pg)
            s = pg.evaluate(SAMPLE_JS, "after-phone-back")
            back_b.update({"path": s["path"], "note_param_gone": "note=" not in s["path"],
                           "list_row_visible": s["first_list_row"] is not None, "sample": s})
            pg.screenshot(path=str(art / f"back-control-{vw}.png"))
        row["back_from_deep_link_control"] = back_b

        # BACK (a): list -> tap a note -> browser Back.
        open_page(pg, base, "/journal/notebook?view=all", "[data-note-card-id]")
        card = pg.locator(f'#notebook-pane [data-note-card-id="{alpha}"]').first
        if not card.count():
            card = pg.locator("#notebook-pane [data-note-card-id]").first
        card.scroll_into_view_if_needed(timeout=5000)
        card.click(timeout=5000)
        pg.wait_for_selector("[data-note-title]", timeout=15000)
        pg.wait_for_timeout(1200)
        opened = pg.evaluate(SAMPLE_JS, "opened-from-list")
        pg.go_back()
        pg.wait_for_timeout(1800)
        top0(pg)
        backed = pg.evaluate(SAMPLE_JS, "after-browser-back")
        row["back_browser_from_list"] = {"opened_path": opened["path"], "opened_title_on_first_screen": opened["note_title_on_first_screen"],
                                         "path_after_back": backed["path"], "note_param_gone": "note=" not in backed["path"],
                                         "list_row_visible": backed["first_list_row"] is not None,
                                         "title_gone": backed["note_title"] is None}

        # BACK (c): list -> tap a note -> the phone's own back control (when the page has one).
        back_c = {"control_present": False}
        open_page(pg, base, "/journal/notebook?view=all", "[data-note-card-id]")
        card = pg.locator(f'#notebook-pane [data-note-card-id="{alpha}"]').first
        card.scroll_into_view_if_needed(timeout=5000)
        card.click(timeout=5000)
        pg.wait_for_selector("[data-note-title]", timeout=15000)
        pg.wait_for_timeout(1200)
        if pg.locator("[data-nb-phone-back]").count() and pg.locator("[data-nb-phone-back]").first.is_visible():
            back_c["control_present"] = True
            pg.locator("[data-nb-phone-back]").first.click(timeout=5000)
            pg.wait_for_timeout(1500)
            top0(pg)
            s2 = pg.evaluate(SAMPLE_JS, "after-phone-back-from-list")
            back_c.update({"path": s2["path"], "note_param_gone": "note=" not in s2["path"],
                           "list_row_visible": s2["first_list_row"] is not None, "sample": s2})
            pg.screenshot(path=str(art / f"back-control-from-list-{vw}.png"))
        row["back_control_from_list"] = back_c

        # MENUS on the Notebook route.
        open_page(pg, base, "/journal/notebook?view=all", "[data-note-card-id]")
        row["menus"] = menus(pg, art, f"menus-{vw}")
    except Exception as e:  # noqa: BLE001 -- the row says why, the run continues
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
    res: dict = {"tip": a.tip, "instrument": "d2_phone_measure.py", "data_dir": a.data_dir, "port": a.port,
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
            notes = seed(member_ctx.request, base)
            res["notes"] = notes
            storage = member_ctx.storage_state()
            for vw, vh, mobile in VIEWPORTS:
                row = run_viewport(br, base, notes, vw, vh, mobile, art, storage)
                res["rows"].append(row)
                print(json.dumps({k: row.get(k) for k in ("viewport", "error")}), flush=True)
            br.close()
        # hold the sandbox to its +120 s checkpoint, so the verdict covers the prewarm window
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
