"""Throwaway debug: why does typing `[[Beta thesis AMD` never show a link-suggestion
option? Fast reboot against the SAME sandbox data dir drf_walk.py already seeded (its
own notes n1..n6 already exist) -- signs in, opens n1, types the trigger, and dumps the
popup DOM (or its absence) plus a screenshot, instead of guessing from a timeout alone.

    python docs/notebook/proof/drf-instrument/drf_debug_link.py --data-dir '...' \
        --port 8396 --note-id <n1> --out-dir '...'
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools"))
sys.path.insert(0, str(REPO / "docs" / "notebook" / "proof" / "drr-instrument"))
import notebook_perf_harness as H  # noqa: E402
import drr_walk as W  # noqa: E402

DUMP_JS = r"""
() => {
  const popup = document.querySelector('[class*="popupWrap"]');
  const listbox = document.querySelector('[role="listbox"]');
  return {
    popupPresent: !!popup,
    popupHTML: popup ? popup.outerHTML.slice(0, 2000) : null,
    listboxPresent: !!listbox,
    listboxHTML: listbox ? listbox.outerHTML.slice(0, 2000) : null,
    bodyHasNoMatching: document.body.textContent.includes('No matching notes'),
  };
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--note-id", required=True)
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{args.port}"
    import os
    os.environ.update(W.FLAGS)

    sb = H.Sandbox(args.data_dir, args.port, out_dir / "debug_sandbox.log")
    started = False
    try:
        sb.start()
        started = True
        if not sb.wait_healthy(base, 180.0):
            print("REFUSED: never healthy")
            return 3
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            br = pw.chromium.launch()
            ctx = br.new_context(viewport={"width": 1280, "height": 900})
            H._signup_or_login(ctx.request, base, W.WALK_EMAIL, W.WALK_PW, "drf debug")
            pg = ctx.new_page()
            pg.on("console", lambda m: print(f"[console:{m.type}] {m.text}"[:300]))
            pg.on("pageerror", lambda e: print(f"[pageerror] {e}"[:300]))
            pg.on("requestfinished", lambda r: (
                print(f"[net] {r.method} {r.url} -> {r.response().status if r.response() else '?'}")
                if "j2/notes" in r.url else None
            ))
            pg.goto(f"{base}/journal/notebook?note={args.note_id}")
            H._dismiss_intro(pg)
            pg.wait_for_selector(".ProseMirror", timeout=20000)
            print("[step] ProseMirror ready")
            pg.locator(".ProseMirror").click()
            pg.keyboard.press("End")
            pg.keyboard.type(" See ")
            pg.screenshot(path=str(out_dir / "debug-0-before-trigger.png"))
            pg.keyboard.type("[[")
            pg.wait_for_timeout(400)
            print("[dump after [[ ]", pg.evaluate(DUMP_JS))
            pg.screenshot(path=str(out_dir / "debug-1-after-brackets.png"))
            pg.keyboard.type("Beta thesis AMD")
            pg.wait_for_timeout(1200)
            print("[dump after full query]", pg.evaluate(DUMP_JS))
            pg.screenshot(path=str(out_dir / "debug-2-after-query.png"))
            pg.wait_for_timeout(2000)
            print("[dump after extra wait]", pg.evaluate(DUMP_JS))
            pg.screenshot(path=str(out_dir / "debug-3-after-wait.png"))
            br.close()
    finally:
        if started:
            sb.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
