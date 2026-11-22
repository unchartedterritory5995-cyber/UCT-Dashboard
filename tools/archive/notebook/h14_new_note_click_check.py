"""H14 browser check: the "+ New note" click after browser Back is never lost (2026-09-26).

The defect (measured on the LIVE build as the smoke account, 2026-09-26): after Back from a note
made with "+ New note", focus sits on the Notebook pane heading; the heading showed on :focus as an
IN-FLOW block, the press that blurred it collapsed it, the toolbar moved between mousedown and
mouseup, and the next "+ New note" click sent no request and made no note.

This runs the same sequence against a census-pinned sandbox of the current tree (never C:\\data;
`tools/notebook_perf_harness.Sandbox`, the launcher's integrity checkpoints) in real Chromium:
  A. three reps of: "+ New note" -> Back -> "+ New note"; every second click must POST and open.
  B. keyboard focus: the Notebook's skip link, Enter -> the heading is SHOWN (focus-visible) and the
     "+ New note" button's box does not move; the next click still POSTs.
Writes JSON evidence to --out. Exit 0 = every check PASS, 1 = a FAIL, 2 = could not run.

Usage (from PowerShell, so the Windows path survives):
    python tools\\h14_new_note_click_check.py --data-dir 'C:\\data-h14fix' --port 8233 --out <dir>
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.notebook_perf_harness import Sandbox, _provision  # noqa: E402

NEW_NOTE = '[data-tour="new-note"]'
NOTES_POST = re.compile(r"/api/j2/notes/?$")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8233)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    if Path(a.data_dir).resolve().as_posix().lower().rstrip("/") in ("c:/data", "/data"):
        print("REFUSED: never the shared data root")
        return 2
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{a.port}"
    sb = Sandbox(a.data_dir, a.port, out / "sandbox.log")
    result = {"checks": [], "integrity": None}
    sb.start()
    try:
        if not sb.wait_healthy(base, 240):
            result["error"] = "sandbox never became healthy"
            return 2
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch()
            admin = browser.new_context()
            member = browser.new_context(viewport={"width": 1280, "height": 860})
            _provision(admin.request, member.request, base)
            for i in range(2):
                member.request.post(base + "/api/j2/notes", data={"title": f"h14 seed {i}"})
            page = member.new_page()
            posts = []
            page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and NOTES_POST.search(r.url) else None)
            page.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded")
            page.wait_for_timeout(1500)
            page.keyboard.press("Escape")
            btn = page.locator(NEW_NOTE).first
            btn.wait_for(state="visible", timeout=60000)

            def click_new() -> tuple[int, str]:
                before = len(posts)
                btn.click()
                try:
                    page.wait_for_url(re.compile(r"[?&]note="), timeout=8000)
                except Exception:  # noqa: BLE001 - a lost click is the thing being measured
                    pass
                return len(posts) - before, page.url

            for rep in range(1, 4):
                n1, u1 = click_new()
                page.go_back()
                btn.wait_for(state="visible", timeout=30000)
                # the scenario is only reproduced when focus has landed on the pane heading
                try:
                    page.wait_for_function("() => document.activeElement && document.activeElement.tagName === 'H2'",
                                           timeout=6000)
                    on_heading = True
                except Exception:  # noqa: BLE001
                    on_heading = False
                active = page.evaluate("() => document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className)")
                n2, u2 = click_new()
                ok = n1 == 1 and n2 == 1 and "note=" in u2
                verdict = ("PASS" if ok else "FAIL") if on_heading else "INCONCLUSIVE (focus never reached the heading)"
                result["checks"].append({"check": f"A{rep} back-then-new-note", "first_posts": n1,
                                         "focus_after_back": active, "second_posts": n2, "second_url": u2,
                                         "verdict": verdict})
                page.go_back()
                btn.wait_for(state="visible", timeout=30000)

            page.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded")
            page.wait_for_timeout(1500)
            page.keyboard.press("Escape")
            btn.wait_for(state="visible", timeout=60000)
            box0 = btn.bounding_box()
            page.focus('a[href="#notebook-pane"]')          # the Notebook's own skip link
            skip = page.evaluate("() => document.activeElement && document.activeElement.textContent")
            page.keyboard.press("Enter")                      # a KEYBOARD activation -> :focus-visible
            page.wait_for_timeout(500)
            shown = page.evaluate("""() => { const h = document.activeElement; if (!h || h.tagName !== 'H2') return null;
                const s = getComputedStyle(h); return {text: h.textContent, position: s.position,
                pointerEvents: s.pointerEvents, width: h.getBoundingClientRect().width,
                focusVisible: h.matches(':focus-visible')} }""")
            box1 = btn.bounding_box()
            n3, u3 = click_new()
            moved = None if not (box0 and box1) else abs(box0["y"] - box1["y"]) + abs(box0["x"] - box1["x"])
            ok = bool(shown) and shown["focusVisible"] and shown["position"] == "absolute" and \
                shown["width"] > 1 and moved == 0 and n3 == 1
            result["checks"].append({"check": "B keyboard focus shows the heading, moves nothing",
                                     "skip_link": skip, "heading": shown, "button_moved_px": moved,
                                     "next_click_posts": n3, "verdict": "PASS" if ok else "FAIL"})
            page.screenshot(path=str(out / "after-keyboard-click.png"))
            browser.close()
    finally:
        result["stop"] = sb.stop()
        result["integrity"] = sb.labels()
        (out / "result.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
        shutil.rmtree(a.data_dir, ignore_errors=True)
    # A FAIL fails the run. A-rows read INCONCLUSIVE where the sandbox leaves focus on the body after
    # Back (it did on 2026-09-26; production put it on the heading) -- recorded, never a pass. B is the
    # discriminating row: FAIL on the old CSS (the button moved 32 px, the click sent nothing), PASS on the fix.
    fails = [c for c in result["checks"] if c["verdict"] == "FAIL"]
    if not any(c["verdict"] == "PASS" for c in result["checks"] if c["check"].startswith("B")):
        fails.append({"check": "B did not pass"})
    print(json.dumps({"checks": [(c["check"], c["verdict"]) for c in result["checks"]],
                      "integrity": result["integrity"]}, indent=1))
    return 1 if fails or not result["checks"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
