"""AX probe for walk row S2-18 (the keyboard block move, 2.5.7), which read FAIL in K2's walk copy
with a fresh walker at 2fb102c74 while 10E-2's unmodified walk read PASS on the same tree.

On the fresh walker's "Delta plain" (the note the walk's S2b edits), the same keys two ways:
  A  the walk's own route into the body (focus_top, then Tab until the editable body), Ctrl+Home;
  B  K2's control route (page.focus on the body), Ctrl+Home.
E  as D, with 50 ms between Ctrl+Home and Alt+Shift+ArrowDown (the one variable);
D  as C, with the walk's S2-18 timing (Ctrl+Home and Alt+Shift+ArrowDown with no wait between);
C  the walk's S2-16/S2-17 keys in the same page (table insert, Tab x15, the exit keys), then
     route A;
then Alt+Shift+ArrowDown, read the first four blocks, Alt+Shift+ArrowUp, read again. Also records
where the caret is after Ctrl+Home (the block holding the selection). Raw output only.

    python s2_18_probe.py <scratch-dir-of-e2_sandbox> <walker-email> <out.json>
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import keyboard_walk_k2_ax as W  # noqa: E402  (the shimmed walk: focus_top, e2_common, kbd_lib)
from playwright.sync_api import sync_playwright  # noqa: E402

C, K = W.C, W.K
BLOCKS = ("() => Array.from(document.querySelectorAll('.ProseMirror > *')).slice(0, 8)"
          ".map(e => e.tagName + ':' + (e.textContent || '').trim().slice(0, 40))")
CARET = """() => { const s = getSelection(); if (!s || !s.anchorNode) return null;
  let n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
  const pm = document.querySelector('.ProseMirror');
  while (n && n.parentElement !== pm) n = n.parentElement;
  const all = Array.from(pm ? pm.children : []);
  return {block_index: n ? all.indexOf(n) : -1, block: n ? n.tagName + ':' + (n.textContent || '').trim().slice(0, 40) : null,
          active: document.activeElement && document.activeElement.className ? String(document.activeElement.className).slice(0, 40) : null}; }"""

scratch, email, out_path = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
ready = C.ready_record(scratch)
base = ready["base"]
out = {"nonce": C.require_identity(base, ready["integrity_log"]), "walker": email, "routes": {}}
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800})
    C.signup_or_login(ctx.request, base, email, C.PW, "kbd walker")
    notes = ctx.request.get(base + "/api/j2/notes?limit=200").json()["notes"]
    nid = next(n["id"] for n in notes if n["title"] == "Delta plain")
    for route in ("A_tab_route", "B_focus_route", "C_walk_replay", "D_walk_replay_walk_timing", "E_walk_replay_50ms_gap"):
        pg = ctx.new_page()
        pg.goto(f"{base}/journal/notebook?note={nid}", wait_until="domcontentloaded")
        C.dismiss_intro(pg)
        pg.wait_for_selector(".ProseMirror", timeout=20000)
        pg.wait_for_timeout(1500)
        if route in ("C_walk_replay", "D_walk_replay_walk_timing", "E_walk_replay_50ms_gap"):
            # the walk's S2-16/S2-17 keys first, in this same page, then its S2-18 route (to_body)
            W.focus_top(pg)
            K.tab_until(pg, lambda x: x.get("contenteditable") or x.get("name") == "Note body", max_presses=170)
            for key in ("Control+End", "Enter"):
                pg.keyboard.press(key)
            pg.keyboard.type("/table"); pg.wait_for_timeout(600)
            pg.keyboard.press("Enter"); pg.wait_for_timeout(700)
            for _ in range(15):
                pg.keyboard.press("Tab"); pg.wait_for_timeout(80)
            for key in ("Escape", "Control+Enter", "ArrowDown"):
                pg.keyboard.press(key); pg.wait_for_timeout(150)
            for _ in range(8):
                pg.keyboard.press("ArrowDown"); pg.wait_for_timeout(60)
            K.press(pg, "Shift+Tab", 80)
            W.focus_top(pg)
            found, n, trail, f = K.tab_until(pg, lambda x: x.get("contenteditable") or x.get("name") == "Note body", max_presses=170)
            reach = {"found": bool(found), "presses": n, "landed": K.short(f), "tail": [str(t) for t in trail[-4:]]}
        elif route == "A_tab_route":
            W.focus_top(pg)
            found, n, trail, f = K.tab_until(pg, lambda x: x.get("contenteditable") or x.get("name") == "Note body", max_presses=170)
            reach = {"found": bool(found), "presses": n, "landed": K.short(f)}
        else:
            pg.focus(".ProseMirror")
            reach = {"found": True, "presses": 0, "landed": "page.focus"}
        if route == "E_walk_replay_50ms_gap":
            # as D, with 50 ms between the two keys: the one variable between D and E
            before, caret = pg.evaluate(BLOCKS), None
            pg.keyboard.press("Control+Home")
            pg.wait_for_timeout(50)
            pg.keyboard.press("Alt+Shift+ArrowDown")
        elif route == "D_walk_replay_walk_timing":
            # the walk's own S2-18 timing: read the first block, Ctrl+Home and Alt+Shift+ArrowDown back to back
            before, caret = pg.evaluate(BLOCKS), None
            pg.keyboard.press("Control+Home")
            pg.keyboard.press("Alt+Shift+ArrowDown")
        else:
            pg.keyboard.press("Control+Home")
            pg.wait_for_timeout(200)
            before, caret = pg.evaluate(BLOCKS), pg.evaluate(CARET)
            pg.keyboard.press("Alt+Shift+ArrowDown")
        pg.wait_for_timeout(500)
        moved, caret2 = pg.evaluate(BLOCKS), pg.evaluate(CARET)
        pg.keyboard.press("Alt+Shift+ArrowUp")
        pg.wait_for_timeout(500)
        back = pg.evaluate(BLOCKS)
        out["routes"][route] = {"reach": reach, "caret_after_ctrl_home": caret, "before": before,
                                "after_alt_shift_down": moved, "caret_after_down": caret2, "after_alt_shift_up": back}
        pg.close()
    b.close()
out_path.write_text(json.dumps(out, indent=1), encoding="utf-8")
print(json.dumps(out, indent=1))
