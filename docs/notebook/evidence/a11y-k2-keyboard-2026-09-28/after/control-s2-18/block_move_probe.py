"""K2 control for walk row S2-18 (it read PASS before and FAIL after on the SAME walked note):
is the keyboard block move broken at the K2 tip, or is the walked note's state the cause? On two
notes, by keyboard only: Ctrl+Home, Alt+Shift+ArrowDown, read the first two blocks, then
Alt+Shift+ArrowUp to put it back. Raw output only."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "proof" / "e2-d9e887ca0"))
import e2_common as C  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

BLOCKS = "() => Array.from(document.querySelectorAll('.ProseMirror > *')).slice(0, 3).map(e => e.tagName + ':' + (e.textContent || '').trim().slice(0, 40))"
ready = C.ready_record(Path(sys.argv[1]))
base = ready["base"]
out = {"nonce": C.require_identity(base, ready["integrity_log"]), "notes": {}}
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800})
    C.signup_or_login(ctx.request, base, "e2-kbd@local.dev", C.PW, "kbd walker")
    notes = ctx.request.get(base + "/api/j2/notes?limit=200").json()["notes"]
    for title in ("Alpha thesis NVDA", "Delta plain"):
        nid = next(n["id"] for n in notes if n["title"] == title)
        pg = ctx.new_page()
        pg.goto(f"{base}/journal/notebook?note={nid}", wait_until="domcontentloaded")
        C.dismiss_intro(pg)
        pg.wait_for_selector(".ProseMirror", timeout=15000)
        pg.wait_for_timeout(1500)
        pg.focus(".ProseMirror")
        pg.keyboard.press("Control+Home")
        before = pg.evaluate(BLOCKS)
        pg.keyboard.press("Alt+Shift+ArrowDown")
        pg.wait_for_timeout(500)
        moved = pg.evaluate(BLOCKS)
        pg.keyboard.press("Alt+Shift+ArrowUp")
        pg.wait_for_timeout(500)
        back = pg.evaluate(BLOCKS)
        out["notes"][title] = {"before": before, "after_alt_shift_down": moved, "after_alt_shift_up": back}
        pg.close()
    b.close()
print(json.dumps(out, indent=1))
