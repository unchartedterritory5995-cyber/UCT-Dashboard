"""Wave 10 lane K2, fix round 1 (review I-1): where does the "More note actions" panel land on
screen? A MEASUREMENT, run before and after the fix against the same sandbox, raw (R-RAW).

    python more_panel_probe.py <scratch-dir-of-e2_sandbox> <out.json> [--shots <dir>] [--tip <sha>]

Cases, each at 390 / 820 (touch) and 1200 (desktop), on the walk account's "Alpha thesis NVDA":
* `unlocked`       -- the note as it is: open More (a click), read the panel's box;
* `locked`         -- the note locked first (through the product's own PATCH .../lock), so the
                      header has no Writing help: open More, read the box;
* `lock_while_open` -- unlocked, More opened, then Lock pressed INSIDE the open panel (a click):
                      the box before and after the header reflows.
A box is ON SCREEN when left >= 0 and right <= the viewport width. The note is unlocked again
through the same PATCH before the probe ends.

Preconditions: the sandbox from docs/notebook/proof/e2-d9e887ca0/e2_sandbox.py (never production,
never C:\\data), identity proved by sandbox_identity.verify before any request, and the walk
account seeded by the keyboard walk (e2-kbd@local.dev).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "proof" / "e2-d9e887ca0"))
import e2_common as C  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

NOTE = "Alpha thesis NVDA"
WIDTHS = ((390, 844, True), (820, 1180, True), (1200, 800, False))
BOX_JS = r"""() => {
  const b = document.querySelector('button[aria-label="More note actions"]');
  const p = b && document.getElementById(b.getAttribute('aria-controls'));
  if (!p || p.hidden) return null;
  const r = p.getBoundingClientRect(); const t = b.getBoundingClientRect();
  const wh = !!Array.from(document.querySelectorAll('header button')).find(x => x.getAttribute('aria-label') === 'Writing help');
  return {panel: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          trigger: [Math.round(t.left), Math.round(t.top), Math.round(t.width)],
          viewport: innerWidth, on_screen: r.left >= 0 && r.right <= innerWidth,
          writing_help_in_header: wh};
}"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("scratch")
    ap.add_argument("out")
    ap.add_argument("--shots", default="")
    ap.add_argument("--tip", default="unset")
    a = ap.parse_args()
    ready = C.ready_record(Path(a.scratch))
    base = ready["base"]
    rec = {"meta": {"tool": "more_panel_probe", "tip": a.tip, "nonce": C.require_identity(base, ready["integrity_log"]),
                    "started": time.strftime("%Y-%m-%dT%H:%M:%S%z")}, "cases": {}}
    out = Path(a.out)
    shots = Path(a.shots) if a.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    flush = lambda: out.write_text(json.dumps(rec, indent=1), encoding="utf-8")  # noqa: E731
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for vw, vh, touch in WIDTHS:
            for case in ("unlocked", "locked", "lock_while_open"):
                ctx = browser.new_context(viewport={"width": vw, "height": vh}, has_touch=touch, is_mobile=touch and vw < 700)
                ctx.add_init_script("try { localStorage.setItem('voice.dictation.hintSeen', '1') } catch (e) {}")
                C.signup_or_login(ctx.request, base, "e2-kbd@local.dev", C.PW, "kbd walker")
                nid = next(n["id"] for n in ctx.request.get(base + "/api/j2/notes?limit=200").json()["notes"] if n["title"] == NOTE)
                lock = lambda v: ctx.request.patch(f"{base}/api/j2/notes/{nid}/lock", data={"locked": v}).status  # noqa: E731
                row = {"viewport": [vw, vh], "touch": touch, "unlock_first": lock(False)}
                if case == "locked":
                    row["lock_status"] = lock(True)
                pg = ctx.new_page()
                pg.goto(f"{base}/journal/notebook?note={nid}", wait_until="domcontentloaded")
                C.dismiss_intro(pg)
                pg.wait_for_selector("[data-note-title]", state="attached", timeout=20000)
                pg.wait_for_timeout(2500)
                more = pg.locator('button[aria-label="More note actions"]').first
                more.scroll_into_view_if_needed()
                more.click()
                pg.wait_for_timeout(400)
                row["open"] = pg.evaluate(BOX_JS)
                if shots:
                    pg.screenshot(path=str(shots / f"more-{vw}-{case}-open.png"))
                if case == "lock_while_open":
                    pg.locator('[role="group"][aria-label="More note actions"] button', has_text="Lock").first.click()
                    pg.wait_for_timeout(1500)
                    row["after_lock"] = pg.evaluate(BOX_JS)
                    if shots:
                        pg.screenshot(path=str(shots / f"more-{vw}-{case}-after-lock.png"))
                row["unlock_after"] = lock(False)
                rec["cases"][f"{vw}-{case}"] = row
                flush()
                ctx.close()
        browser.close()
    rec["meta"]["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    flush()
    for k, r in rec["cases"].items():
        print(k, "open:", r.get("open"), "| after Lock:", r.get("after_lock", "-"), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
