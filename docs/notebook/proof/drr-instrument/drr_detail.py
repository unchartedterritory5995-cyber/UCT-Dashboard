"""DR-R supplementary pass -- named target-floor detail (not just counts), a corrected
retry of the graph link insertion, and a D-2 orb-presence check at 1200. Reuses the SAME
sandbox data dir the main drr_walk.py run seeded (WALK_EMAIL already exists, notes n1..n6
already there), so this is a fast reboot, not a re-seed.

    python docs/notebook/proof/drr-instrument/drr_detail.py --data-dir '...\\drr-data' \\
        --port 8392 --out '...\\drr-detail.json'
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as H  # noqa: E402
import drr_walk as W  # noqa: E402  (WALK_EMAIL/PW, FLAGS, TARGETS_JS)

DETAIL_JS = r"""
(minPx) => {
  const sel = 'a[href],button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="checkbox"],[role="switch"],[tabindex]:not([tabindex="-1"])';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (r.width < minPx || r.height < minPx) {
      const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').replace(/\s+/g,' ').trim().slice(0, 60);
      out.push({tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), name, w: Math.round(r.width), h: Math.round(r.height)});
    }
  }
  return out;
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    why = H.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if H.port_busy(args.port):
        print(f"REFUSED: port {args.port} busy")
        return 3

    base = f"http://127.0.0.1:{args.port}"
    os.environ.update(W.FLAGS)
    out_path = Path(args.out)
    sb = H.Sandbox(args.data_dir, args.port, out_path.parent / "sandbox-detail.log")
    result: dict = {}
    started = False
    try:
        sb.start()
        started = True
        if not sb.wait_healthy(base, 240.0):
            result["setup_error"] = "sandbox never answered /api/health"
        else:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                br = pw.chromium.launch()
                ctx = br.new_context(viewport={"width": 1200, "height": 900})
                H._signup_or_login(ctx.request, base, W.WALK_EMAIL, W.WALK_PW, "drr walk")
                notes = ctx.request.get(base + "/api/j2/notes?limit=50").json().get("notes") or []
                by_title = {n["title"]: n["id"] for n in notes}
                n1 = by_title.get("Alpha thesis NVDA")
                pg = ctx.new_page()

                # -- named target-floor detail at 1200, the surfaces the main walk flagged --
                targets: dict = {}

                pg.goto(f"{base}/journal/notebook?view=all")
                H._dismiss_intro(pg)
                pg.wait_for_timeout(1200)
                targets["list"] = pg.evaluate(DETAIL_JS, 24)

                pg.get_by_role("button", name="Table view", exact=True).click()
                pg.wait_for_timeout(1000)
                targets["table"] = pg.evaluate(DETAIL_JS, 24)

                pg.get_by_role("button", name="Board view", exact=True).click()
                pg.wait_for_timeout(1000)
                targets["board"] = pg.evaluate(DETAIL_JS, 24)

                pg.get_by_role("button", name="Timeline view", exact=True).click()
                pg.wait_for_timeout(1000)
                targets["timeline"] = pg.evaluate(DETAIL_JS, 24)

                pg.goto(f"{base}/journal/notebook?view=all")
                H._dismiss_intro(pg)
                pg.wait_for_timeout(800)
                pg.get_by_role("button", name="Templates", exact=True).click()
                pg.wait_for_selector("[data-template-gallery]", timeout=10000)
                pg.wait_for_timeout(500)
                targets["templates"] = pg.evaluate(DETAIL_JS, 24)
                pg.keyboard.press("Escape")

                pg.goto(f"{base}/journal/notebook?view=all")
                H._dismiss_intro(pg)
                pg.wait_for_timeout(800)
                pg.get_by_role("tab", name="Search notes", exact=True).click()
                pg.get_by_label("Search your notes").fill("thesis")
                pg.wait_for_timeout(700)
                targets["search-sidebar"] = pg.evaluate(DETAIL_JS, 24)

                pg.keyboard.press("Control+k")
                pg.wait_for_selector('[role="dialog"][aria-label="Command palette"]', timeout=5000)
                pg.keyboard.type("amd")
                pg.wait_for_timeout(700)
                targets["search-palette"] = pg.evaluate(DETAIL_JS, 24)
                pg.keyboard.press("Escape")

                result["targets_1200"] = targets

                # -- retry the graph link insertion with a substring/first-option click --
                link: dict = {}
                if n1:
                    pg.goto(f"{base}/journal/notebook?note={n1}")
                    H._dismiss_intro(pg)
                    pg.wait_for_selector(".ProseMirror", timeout=20000)
                    pm = pg.locator(".ProseMirror")
                    pm.click()
                    pg.keyboard.press("End")
                    pg.keyboard.type(" Also see ")
                    pg.keyboard.type("[[Beta thesis AMD")
                    pg.wait_for_timeout(600)
                    opt = pg.locator('[role="option"]')
                    link["option_count"] = opt.count()
                    link["option_texts"] = opt.all_inner_texts()[:5]
                    try:
                        opt.first.click(timeout=3000)
                        link["clicked"] = True
                    except Exception as e:  # noqa: BLE001
                        pg.keyboard.press("Escape")
                        link["clicked"] = False
                        link["error"] = str(e)[:200]
                    pg.wait_for_timeout(500)
                    link["noteLink_count_after"] = pg.locator(".ProseMirror [data-note-link], .ProseMirror a").count()
                    pg.screenshot(path=str(out_path.parent / "drr-graph-link-retry-editor.png"))
                    # re-open the graph to see whether an edge now exists
                    pg.goto(f"{base}/journal/notebook?view=all")
                    H._dismiss_intro(pg)
                    pg.get_by_role("button", name="Graph view", exact=True).click(timeout=8000)
                    pg.wait_for_timeout(1500)
                    pg.screenshot(path=str(out_path.parent / "drr-graph-after-link-retry-1200.png"))
                result["graph_link_retry"] = link

                # -- D-2 detail at 1200: is the orb itself present for a paid member --
                me = ctx.request.get(base + "/api/auth/me").json()
                d2: dict = {"me_plan": me.get("plan"), "me_paid_equiv": me.get("paid_equiv")}
                pg.goto(f"{base}/journal/notebook?view=all")
                H._dismiss_intro(pg)
                pg.wait_for_timeout(1500)
                d2["orb_button_present"] = pg.locator('[data-orb-coachmark], [class*="orb" i]').count()
                d2["coachmark_seen_flag"] = pg.evaluate(
                    "() => { try { return localStorage.getItem('voice.orb.coachmarkSeen') } catch(e) { return 'ERR' } }")
                pg.screenshot(path=str(out_path.parent / "drr-d2-detail-walkaccount-1200.png"))
                result["d2_detail"] = d2

                br.close()
        sb.wait_checkpoint(H.PREWARM, 60.0)
    finally:
        stop_how = sb.stop() if started else "never-started"
    integ = H.read_integrity(sb.integrity_path(), required=["pre-boot (baseline)", "shutdown"])
    print(H.integrity_line(integ, note=f"stop: {stop_how}"))
    result["sandbox_integrity"] = integ
    out_path.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
