"""Measure Research Home's ONE Ask section in a REAL browser (P0.7 fix round 1).

WHY IT EXISTS. jsdom lays nothing out. P0.7 merged the home's two Ask doors into one flex-column
section; `align-items: flex-start` on it shrank EVERY child to its content width, so the opened
"Or tell Notebook what to change" box (request textarea, review list, applied/undo views) collapsed
where the old `.aiSlot` block let it fill the home column. A unit test cannot see that. This tool
measures it, and measures where the Ask question door's popover lands now that the door sits at the
LEFT of the column instead of the far right.

WHAT IT DOES. Attaches to an already-serving sandbox (see Precondition), signs in a fresh paid member
at each viewport (1280x900 desktop; 390x844 touch), creates two notes and favourites one so the home
is in its FULL state, then records getBoundingClientRect() for:
  * the Ask section and its parent column (column width = min(820, the parent's content width), the
    home column's own max-width);
  * AFTER opening "Or tell Notebook what to change", in THREE states: idle (the request box), review
    (a plan to approve) and done (applied, with Undo): the AI actions wrapper, its opened panel and
    the request textarea. The idle form carries a ~230-character hint paragraph that props its natural
    width up to the panel's 760 px cap, so the idle state alone CANNOT show a collapse (measured: the
    old rule left it at 760 px); the review and done states hold short lines and can. The plan and
    apply answers are fabricated with `page.route` (no model key in the sandbox); the layout under
    test is the real product code in a real browser;
  * AFTER opening the Ask door: its popover (desktop) or Sheet (touch), against the viewport, against
    its nearest horizontally clipping ancestor, and by elementFromPoint at five points inside it.

BARS (a missing measurement is its own failure, never a pass):
  1. the AI panel is >= 90% of the column width in EVERY one of the three states (the panel carries
     its own 760 px max-width, so on a 820 px column that is 92.7%: the bar is on the panel, not on a
     stretched wrapper);
  2. the Ask popover/Sheet is fully inside the viewport, fully inside its clipping ancestor, and every
     probe point inside it hits the popover (nothing paints over it).
Exit 0 = every bar holds; 1 = a break was measured; 2 = INCONCLUSIVE (nothing measurable).

R-RAW: rects.json is written BEFORE any verdict is computed or printed, screenshots beside it.

Precondition: a sandbox from THIS tree (app/dist rebuilt) is serving, e.g. (PowerShell, data dir
single-quoted, outside the repo):
    python tools/notebook_fin_walk.py --config c2 --data-root '<dir>' --port 8132 --out '<dir>' --tip <sha> --serve-only
Usage:
    python tools/notebook_home_ask_measure.py --base http://127.0.0.1:8132 --out docs/notebook/evidence --tip <sha>
    ... --control   POSITIVE CONTROL: injects the pre-fix rule (`align-items: flex-start` on the Ask
                    section). The width bar MUST then FAIL. With --control: exit 0 = it failed as it
                    must, 1 = it did not (the tool cannot fail and every PASS it printed is void).
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

VIEWPORTS = [("desktop", 1280, 900), ("phone", 390, 844)]
WIDTH_BAR = 0.90
COLUMN_MAX = 820      # ResearchHome.module.css .askSection / .homeTop max-width
BODY = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Home ask probe."}]}]}
OLD_RULE = 'section[aria-label="Ask your Notebook"] { align-items: flex-start !important }'
AI_NAME = "Or tell Notebook what to change"
# A SHORT plan on purpose: long lines would prop the panel's natural width up and hide a collapse.
PLAN = {
    "id": "homeaskprobe0001", "request": "tag it", "summary": None, "status": "planned", "skipped": [],
    "changes": [
        {"id": "c1", "noteId": "nA", "noteTitle": "A", "op": "add_tag", "label": "Tag x", "before": "", "after": "x",
         "status": "planned", "ai": True},
        {"id": "c2", "noteId": "nB", "noteTitle": "B", "op": "add_tag", "label": "Tag x", "before": "", "after": "x",
         "status": "planned", "ai": True},
    ],
}
APPLIED = {"results": [{"id": c["id"], "noteId": c["noteId"], "status": "applied", "message": None} for c in PLAN["changes"]],
           "revisions": [], "changeSet": {**PLAN, "status": "applied"}}

R_DEF = """
  const R = (b) => ({ left: +b.left.toFixed(2), right: +b.right.toFixed(2), top: +b.top.toFixed(2),
                      bottom: +b.bottom.toFixed(2), width: +b.width.toFixed(2), height: +b.height.toFixed(2) })
"""


def page_fn(body: str) -> str:
    """One page.evaluate function expression: the rect helper, then the body."""
    return "() => {" + R_DEF + body + "}"

SECTION_JS = page_fn(r"""
  const s = document.querySelector('section[aria-label="Ask your Notebook"]')
  if (!s) return { error: 'no section[aria-label="Ask your Notebook"]' }
  const p = s.parentElement, cs = getComputedStyle(p)
  const content = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  const sc = getComputedStyle(s)
  return { innerWidth, innerHeight, docScrollWidth: document.documentElement.scrollWidth,
           section: R(s.getBoundingClientRect()), sectionAlignItems: sc.alignItems,
           parent: R(p.getBoundingClientRect()), parentContentWidth: +content.toFixed(2),
           homeHasFavorites: [...document.querySelectorAll('h2,h3')].some((e) => e.textContent.trim() === 'Favorites') }
""")

AI_JS = page_fn(r"""
  const wrap = document.querySelector('section[aria-label="%(name)s"]')
  if (!wrap) return { error: 'no AI actions wrapper' }
  const panel = wrap.querySelector('[id$="-panel"]')
  const ta = wrap.querySelector('textarea')
  return { wrap: R(wrap.getBoundingClientRect()),
           panel: panel ? R(panel.getBoundingClientRect()) : null,
           textarea: ta ? R(ta.getBoundingClientRect()) : null }
""") % {"name": AI_NAME}

ASK_JS = page_fn(r"""
  const dlg = document.querySelector('[role="dialog"][aria-label^="Ask"]')
  if (!dlg) return { error: 'no Ask dialog is open' }
  const b = dlg.getBoundingClientRect()
  const tog = document.querySelector('button[data-ask-toggle]')
  let clip = null, node = tog ? tog.parentElement : null
  while (node && node !== document.body) {
    const ox = getComputedStyle(node).overflowX
    if (ox && ox !== 'visible') { clip = { tag: node.tagName.toLowerCase(), overflowX: ox, rect: R(node.getBoundingClientRect()) }; break }
    node = node.parentElement
  }
  const probes = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].map(([fx, fy]) => {
    const x = b.left + b.width * fx, y = b.top + b.height * fy
    // only a probe that lies on screen can be hit-tested
    const on = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight
    const hit = on ? document.elementFromPoint(x, y) : null
    return { x: +x.toFixed(1), y: +y.toFixed(1), onScreen: on, hitsDialog: !!hit && (hit === dlg || dlg.contains(hit)) }
  })
  return { innerWidth, innerHeight, dialog: R(b), toggle: tog ? R(tog.getBoundingClientRect()) : null,
           clipAncestor: clip, probes, className: String(dlg.className).split(' ')[0] }
""")


def fake_ai_api(pg) -> None:
    """Answer the two AI-actions calls the walk makes. Everything else goes to the real sandbox."""
    pg.route("**/api/j2/ai-actions/plan", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(PLAN)))
    pg.route("**/api/j2/ai-actions/*/apply", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(APPLIED)))


def verdict(vp: dict) -> list[str]:
    """Reasons this viewport breaks a bar; empty = holds."""
    why: list[str] = []
    sec, ai, ask = vp.get("section"), vp.get("ai"), vp.get("ask")
    if not sec or "error" in sec:
        return [f"unmeasurable section: {sec}"]
    if not sec.get("homeHasFavorites"):
        why.append("the home is not in its FULL state (no Favorites section): the measurement does not cover the full return")
    col = min(COLUMN_MAX, sec["parentContentWidth"])
    vp["column_width"] = col
    ratios = {}
    for state in ("idle", "review", "done"):
        st = (ai or {}).get(state)
        if not st or "error" in st or not st.get("panel"):
            why.append(f"unmeasurable AI panel in the {state} state: {st}")
            continue
        ratio = st["panel"]["width"] / col
        ratios[state] = round(ratio, 4)
        if ratio < WIDTH_BAR:
            why.append(f"the AI panel ({state}) is {st['panel']['width']} px wide = {ratio:.1%} of the {col} px column (bar {WIDTH_BAR:.0%})")
    vp["ai_panel_ratio"] = ratios
    if not ask or "error" in ask:
        why.append(f"unmeasurable Ask popover/Sheet: {ask}")
    else:
        d, iw, ih = ask["dialog"], ask["innerWidth"], ask["innerHeight"]
        if d["left"] < 0 or d["right"] > iw or d["top"] < 0 or d["bottom"] > ih:
            why.append(f"the Ask {vp['ask_kind']} is not inside the viewport: x {d['left']}..{d['right']} of {iw}, y {d['top']}..{d['bottom']} of {ih}")
        clip = ask.get("clipAncestor")
        if clip:
            c = clip["rect"]
            if d["left"] < c["left"] - 0.5 or d["right"] > c["right"] + 0.5:
                why.append(f"the Ask {vp['ask_kind']} crosses its clipping {clip['tag']}'s horizontal edge: x {d['left']}..{d['right']} vs {c['left']}..{c['right']}")
        for p in ask["probes"]:
            if not p["onScreen"] or not p["hitsDialog"]:
                why.append(f"probe ({p['x']},{p['y']}) {'is off screen' if not p['onScreen'] else 'does not hit the Ask ' + vp['ask_kind']}")
    return why


def measure(browser, admin_req, base: str, name: str, width: int, height: int, control: bool) -> dict:
    ctx, email, _me = C.w.fresh_member(browser, admin_req, base, name[:3], width, height)
    out: dict = {"viewport": name, "width": width, "height": height, "member": email, "touch": width <= C.TOUCH_MAX}
    try:
        ids = []
        for i, title in enumerate(("Home ask probe A", "Home ask probe B")):
            r = ctx.request.post(base + "/api/j2/notes", data={"title": title, "bodyJson": BODY})
            if r.status not in (200, 201):
                raise h.SetupFailed(f"create note failed HTTP {r.status}")
            ids.append((r.json().get("note") or r.json()).get("id"))
        r = ctx.request.post(base + f"/api/j2/notes/{ids[0]}/favorite")
        if r.status not in (200, 201, 204):
            raise h.SetupFailed(f"favorite failed HTTP {r.status}")
        pg = ctx.new_page()
        C.goto(pg, base, "/journal/notebook", wait='section[aria-label="Ask your Notebook"]')
        C.settle_first_run(pg)
        pg.get_by_text("Favorites", exact=True).first.wait_for(state="visible", timeout=20000)
        pg.wait_for_timeout(500)
        if control:
            pg.add_style_tag(content=OLD_RULE)
            pg.wait_for_timeout(300)
        out["section"] = pg.evaluate(SECTION_JS)
        # 1. the change-it box: idle -> review -> done
        fake_ai_api(pg)
        out["ai"] = {}
        pg.get_by_role("button", name=AI_NAME, exact=True).click(timeout=20000)
        pg.locator(f'section[aria-label="{AI_NAME}"] textarea').first.wait_for(state="visible", timeout=10000)
        pg.wait_for_timeout(300)
        out["ai"]["idle"] = pg.evaluate(AI_JS)
        pg.screenshot(path=str(Path(out_dir) / f"{name}-ai-idle.png"), full_page=True)
        pg.locator(f'section[aria-label="{AI_NAME}"] textarea').first.fill(PLAN["request"])
        pg.get_by_role("button", name="Plan changes", exact=True).click(timeout=10000)
        pg.get_by_role("heading", name="Review 2 proposed changes").wait_for(state="visible", timeout=15000)
        pg.wait_for_timeout(300)
        out["ai"]["review"] = pg.evaluate(AI_JS)
        pg.screenshot(path=str(Path(out_dir) / f"{name}-ai-review.png"), full_page=True)
        pg.get_by_role("button", name="Apply 2 changes", exact=True).click(timeout=10000)
        pg.get_by_role("heading", name="AI change set applied").wait_for(state="visible", timeout=15000)
        pg.wait_for_timeout(300)
        out["ai"]["done"] = pg.evaluate(AI_JS)
        pg.screenshot(path=str(Path(out_dir) / f"{name}-ai-done.png"), full_page=True)
        pg.get_by_role("button", name=AI_NAME, exact=True).click()      # close it again
        pg.wait_for_timeout(300)
        # 2. the question door
        pg.locator("button[data-ask-toggle]").first.click(timeout=10000)
        pg.locator('[role="dialog"][aria-label^="Ask"]').first.wait_for(state="visible", timeout=10000)
        pg.wait_for_timeout(500)
        out["ask_kind"] = "Sheet" if out["touch"] else "popover"
        out["ask"] = pg.evaluate(ASK_JS)
        pg.screenshot(path=str(Path(out_dir) / f"{name}-ask-open.png"))
    finally:
        ctx.close()
    return out


out_dir = "."


def main(argv=None) -> int:
    global out_dir
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True, help="parent dir; a home-ask-<UTC stamp>/ folder is made inside it")
    ap.add_argument("--tip", default="", help="the commit under test, recorded in rects.json")
    ap.add_argument("--control", action="store_true", help="inject the pre-fix rule; the width bar must FAIL")
    a = ap.parse_args(argv)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(a.out) / f"home-ask-{stamp}{'-control' if a.control else ''}"
    out.mkdir(parents=True, exist_ok=True)
    out_dir = str(out)
    rec: dict = {"stamp": stamp, "base": a.base, "tip": a.tip, "control": a.control, "width_bar": WIDTH_BAR,
                 "column_max": COLUMN_MAX, "viewports": [], "status": "INCOMPLETE (run did not finish)"}

    def save():
        (out / "rects.json").write_text(json.dumps(rec, indent=1, default=str) + "\n", encoding="utf-8", newline="\n")

    save()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            admin = browser.new_context()
            h._signup_or_login(admin.request, a.base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
            for name, wd, ht in VIEWPORTS:
                rec["viewports"].append(measure(browser, admin.request, a.base, name, wd, ht, a.control))
                save()
            browser.close()
    except Exception as e:  # noqa: BLE001
        rec["status"] = f"INCONCLUSIVE: {type(e).__name__}: {str(e)[:300]}"
        save()
        print(rec["status"])
        print(f"raw: {out / 'rects.json'}")
        return 2
    save()   # R-RAW: the raw rects are on disk BEFORE any verdict is computed

    breaks = {}
    for vp in rec["viewports"]:
        breaks[vp["viewport"]] = verdict(vp)
    rec["breaks"] = breaks
    width_breaks = [w for v in breaks.values() for w in v if "AI panel" in w]
    any_break = any(breaks.values())
    if a.control:
        rec["status"] = "CONTROL FAILED THE WIDTH BAR AS IT MUST" if width_breaks else "CONTROL DID NOT FAIL THE WIDTH BAR (the tool cannot fail)"
    else:
        rec["status"] = "FAIL" if any_break else "PASS"
    save()
    for vp in rec["viewports"]:
        sec, ai, ask = vp["section"], vp.get("ai") or {}, vp.get("ask") or {}
        print(f"--- {vp['viewport']} {vp['width']}x{vp['height']}  section align-items={sec.get('sectionAlignItems')}  "
              f"column {vp.get('column_width')}  section w {sec['section']['width']}")
        for state in ("idle", "review", "done"):
            st = ai.get(state) or {}
            if st.get("panel"):
                print(f"    AI {state:6s} wrapper w {st['wrap']['width']:7}  panel w {st['panel']['width']:7}  textarea w "
                      f"{(st.get('textarea') or {}).get('width')}  panel/column {(vp.get('ai_panel_ratio') or {}).get(state)}")
        if ask.get("dialog"):
            d = ask["dialog"]
            print(f"    Ask {vp['ask_kind']} x {d['left']}..{d['right']} y {d['top']}..{d['bottom']}  "
                  f"toggle x {(ask.get('toggle') or {}).get('left')}  clip {ask.get('clipAncestor') and ask['clipAncestor']['rect']}  "
                  f"probes hit {sum(p['hitsDialog'] for p in ask['probes'])}/{len(ask['probes'])}")
        for w in breaks[vp["viewport"]]:
            print(f"    BREAK: {w}")
    print(f"{rec['status']}  raw: {out / 'rects.json'}")
    if a.control:
        return 0 if width_breaks else 1
    return 1 if any_break else 0


if __name__ == "__main__":
    sys.exit(main())
