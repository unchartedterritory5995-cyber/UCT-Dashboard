"""Finish program, lane KEYS round 4: the folder panel by mouse, by touch and by keyboard.

The folder panel became a tree with one Tab stop. This walk confirms, in a real browser, that
nothing a member could do in the panel with a POINTER is lost, and that the keyboard can do the
same things through the tree:

  mouse at 1280, touch at 390:  expand a folder, select a folder, rename it, add a subfolder,
                                delete a folder (and confirm), the Publish action if it is there
  keyboard at 1280:             one Tab stop for the whole tree, Down / Right / Left, Enter
                                selects, Shift+F10 opens the row's menu, Rename from the menu

Every step records what it did and what the page showed. A step that could not be done is
recorded as FAILED with the reason; nothing is assumed. Raw results are written before the
verdict line is printed.

Run:
    python tools/notebook_fin_keys_folder_walk.py --data-dir C:/data-fin-clicks/folder-walk \
        --port 8720 --out docs/notebook/evidence/fin-keys2/folder-walk

Exit: 0 = ran and the sandbox integrity is CLEAN; 2 = not run or not clean; 3 = refused.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import notebook_w13q_clicks as w  # noqa: E402
h = w.h


MENU_STATE_JS = """() => { const m = document.querySelector('[role=menu]'); if (!m) return null;
  const cs = getComputedStyle(m); const first = m.querySelector('[role=menuitem]');
  const out = {style: m.getAttribute('style'), visibility: cs.visibility, display: cs.display,
               rect: JSON.stringify(m.getBoundingClientRect()), items: m.querySelectorAll('[role=menuitem]').length,
               first_disabled: first ? first.disabled : null, first_tabindex: first ? first.tabIndex : null};
  if (first) { first.focus(); out.after_manual_focus = document.activeElement === first; }
  return out; }"""


def make_folders(cx, base: str, tag: str) -> dict:
    out = {}
    r = cx.req.post(base + "/api/j2/note-folders", data={"name": f"Walk {tag} A"})
    out["a"] = r.json().get("folder", r.json())
    r = cx.req.post(base + "/api/j2/note-folders", data={"name": f"Walk {tag} B"})
    out["b"] = r.json().get("folder", r.json())
    r = cx.req.post(base + "/api/j2/note-folders", data={"name": f"Walk {tag} child", "parentId": out["a"]["id"]})
    out["child"] = r.json().get("folder", r.json())
    return out


def folder_names(cx, base: str) -> list[str]:
    r = cx.req.get(base + "/api/j2/note-folders")
    return sorted(f["name"] for f in (r.json().get("folders") or []))


def pointer_walk(br, state, cx, base: str, mode: str, out: Path) -> list[dict]:
    """mode: 'mouse' (1280) or 'taps' (390)."""
    phone = mode == "taps"
    ctx = br.new_context(viewport=w.PHONE if phone else {"width": 1280, "height": 900}, has_touch=phone,
                         is_mobile=phone, reduced_motion="reduce", storage_state=state)
    pg = ctx.new_page()
    pg.bring_to_front()
    steps: list[dict] = []
    tag = f"{mode}"
    f = make_folders(cx, base, tag)
    A, B, CH = f["a"]["name"], f["b"]["name"], f["child"]["name"]

    def act(loc):
        loc = loc.first
        loc.scroll_into_view_if_needed(timeout=15000)
        (loc.tap if phone else loc.click)(timeout=15000)

    def step(name, fn):
        try:
            detail = fn()
            steps.append({"mode": mode, "step": name, "ok": True, "detail": detail})
        except Exception as e:  # noqa: BLE001 -- recorded, the walk goes on
            steps.append({"mode": mode, "step": name, "ok": False, "detail": f"{type(e).__name__}: {str(e)[:2400]}"})

    w.open_start(pg, base, "/journal/notebook")
    if pg.locator("[data-all-notes-row]").filter(visible=True).count() == 0:
        toggle = pg.get_by_role("button", name="Show folders panel")
        if toggle.count():
            act(toggle)
    pg.get_by_role("tree", name="Folders").wait_for(state="visible", timeout=30000)
    row = lambda name: pg.get_by_role("treeitem", name=name, exact=True)  # noqa: E731

    def expand():
        act(pg.get_by_role("button", name=f"Expand {A}", exact=True))
        row(CH).wait_for(state="visible", timeout=10000)
        return {"expanded": row(A).get_attribute("aria-expanded"), "child_showing": True}
    step("expand a folder", expand)

    def select():
        act(row(B).locator("[data-tree-primary]"))
        # the selection is page state, not the address: the row says it is selected
        pg.locator(f'[data-tree-folder="{f["b"]["id"]}"][aria-selected="true"]').wait_for(state="attached", timeout=10000)
        return {"selected": row(B).get_attribute("aria-selected")}
    step("select a folder", select)

    def reopen_panel():
        if pg.get_by_role("tree", name="Folders").filter(visible=True).count() == 0:
            act(pg.get_by_role("button", name="Show folders panel"))
            pg.get_by_role("tree", name="Folders").wait_for(state="visible", timeout=10000)
        return {"panel": "showing"}
    step("the panel is still reachable after a selection", reopen_panel)

    def rename():
        act(pg.get_by_role("button", name=f"Rename {B}", exact=True))
        box = pg.get_by_role("textbox", name=f"Rename folder {B}")
        box.fill(f"{B} renamed")
        box.press("Enter")
        row(f"{B} renamed").wait_for(state="visible", timeout=10000)
        return {"server_has": f"{B} renamed" in folder_names(cx, base)}
    step("rename a folder", rename)

    def add_sub():
        act(pg.get_by_role("button", name=f"Add subfolder to {A}", exact=True))
        box = pg.get_by_role("textbox", name=f"New subfolder in {A}")
        box.fill(f"{A} sub2")
        box.press("Enter")
        row(f"{A} sub2").wait_for(state="visible", timeout=10000)
        return {"server_has": f"{A} sub2" in folder_names(cx, base)}
    step("add a subfolder", add_sub)

    def publish():
        door = pg.get_by_role("button", name=f"Publish {A}", exact=True)
        if door.count() == 0:
            return {"door": "not offered on this build (its switch is off)"}
        act(door)
        dlg = pg.get_by_role("dialog", name=f'Publish folder "{A}"')
        dlg.wait_for(state="visible", timeout=10000)
        pg.keyboard.press("Escape")
        dlg.wait_for(state="hidden", timeout=10000)
        return {"door": "opened the confirmation, closed without publishing"}
    step("the Publish action", publish)

    def delete():
        name = f"{B} renamed"
        act(pg.get_by_role("button", name=f"Delete {name}", exact=True))
        pg.get_by_text(f'Delete folder "{name}"?').wait_for(state="visible", timeout=10000)
        act(pg.get_by_role("button", name="Delete", exact=True))
        row(name).wait_for(state="detached", timeout=10000)
        return {"server_has": name in folder_names(cx, base)}
    step("delete a folder", delete)

    pg.screenshot(path=str(out / f"folder-walk-{mode}.png"))
    ctx.close()
    return steps


def keyboard_walk(br, state, cx, base: str, out: Path) -> list[dict]:
    ctx = br.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce", storage_state=state)
    pg = ctx.new_page()
    pg.bring_to_front()
    steps: list[dict] = []
    f = make_folders(cx, base, "keys")
    A = f["a"]["name"]

    def step(name, fn):
        try:
            steps.append({"mode": "keys", "step": name, "ok": True, "detail": fn()})
        except Exception as e:  # noqa: BLE001
            steps.append({"mode": "keys", "step": name, "ok": False, "detail": f"{type(e).__name__}: {str(e)[:2400]}"})

    w.open_start(pg, base, "/journal/notebook")
    tree = pg.get_by_role("tree", name="Folders")
    tree.wait_for(state="visible", timeout=30000)
    name_js = "() => { const e = document.activeElement; return e ? (e.getAttribute('role') || e.tagName) + ':' + (e.getAttribute('aria-label') || (e.textContent || '').trim().slice(0, 30)) : 'none' }"

    def one_stop():
        stops = pg.evaluate("""() => { const t = document.querySelector('[role="tree"]');
          const rows = [...t.querySelectorAll('[role="treeitem"]')].filter(e => e.getAttribute('tabindex') === '0').length;
          const inner = [...t.querySelectorAll('button, a[href], input, select')].filter(e => e.tabIndex >= 0).length;
          return {rows_in_tab_order: rows, controls_in_tab_order: inner,
                  rows: t.querySelectorAll('[role="treeitem"]').length} }""")
        if stops["rows_in_tab_order"] != 1 or stops["controls_in_tab_order"] != 0:
            raise AssertionError(f"not one stop: {stops}")
        return stops
    step("the tree is one Tab stop", one_stop)

    def tab_through():
        # from the row BEFORE the tree's stop: Tab in, Tab out, and count
        pg.evaluate("""() => document.querySelector('[role="tree"] [role="treeitem"][tabindex="0"]').focus()""")
        inside = pg.evaluate(name_js)
        pg.keyboard.press("Tab")
        after = pg.evaluate(name_js)
        left = pg.evaluate("""() => !document.querySelector('[role="tree"]').contains(document.activeElement)""")
        if not left:
            raise AssertionError(f"one Tab from the tree's stop stayed in the tree: {after}")
        return {"on": inside, "one_tab_later": after}
    step("one Tab leaves the tree", tab_through)

    def arrows():
        pg.evaluate("""() => document.querySelector('[role="tree"] [role="treeitem"]').focus()""")
        trail = [pg.evaluate(name_js)]
        pg.keyboard.press("End")
        trail.append(pg.evaluate(name_js))
        pg.keyboard.press("Home")
        trail.append(pg.evaluate(name_js))
        # type the folder's name to reach it
        for ch in "walk keys a":
            pg.keyboard.press("Space" if ch == " " else ch)
        trail.append(pg.evaluate(name_js))
        if not trail[-1].endswith(A):
            raise AssertionError(f"typing the name did not reach {A}: {trail}")
        pg.keyboard.press("ArrowRight")
        pg.get_by_role("treeitem", name=f["child"]["name"], exact=True).wait_for(state="visible", timeout=10000)
        pg.keyboard.press("ArrowRight")
        trail.append(pg.evaluate(name_js))
        pg.keyboard.press("ArrowLeft")
        trail.append(pg.evaluate(name_js))
        return {"trail": trail}
    step("Home, End, typing a name, Right into a folder, Left back out", arrows)

    def enter_selects():
        pg.keyboard.press("Enter")
        pg.locator(f'[data-tree-folder="{f["a"]["id"]}"][aria-selected="true"]').wait_for(state="attached", timeout=10000)
        return {"focus": pg.evaluate(name_js)}
    step("Enter selects the folder", enter_selects)

    def menu_rename():
        pg.get_by_role("treeitem", name=A, exact=True).focus()
        before = pg.evaluate(name_js)
        pg.evaluate("""() => { window.__ft = []; const d = (e) => (e.getAttribute && (e.getAttribute('role') || e.tagName) + ':' + (e.getAttribute('aria-label') || (e.textContent || '').trim().slice(0, 20)));
          document.addEventListener('focusin', (e) => window.__ft.push('in ' + d(e.target)), true);
          const realFocus = HTMLElement.prototype.focus;
          HTMLElement.prototype.focus = function (...a) { window.__ft.push('focus() on ' + d(this) + ' connected=' + this.isConnected + ' vis=' + getComputedStyle(this).visibility); return realFocus.apply(this, a) };
          for (const t of ['keydown', 'keyup', 'contextmenu']) document.addEventListener(t, (e) => window.__ft.push(t + ' ' + (e.key || '') + (e.defaultPrevented ? ' [prevented]' : '')), false); }""")
        pg.keyboard.press("Shift+F10")
        menu = pg.get_by_role("menu", name=A)
        try:
            menu.wait_for(state="visible", timeout=10000)
        except Exception:  # noqa: BLE001 -- say what the page showed instead
            raise AssertionError(f"no menu after Shift+F10; focus before {before!r}, now {pg.evaluate(name_js)!r}; "
                                 f"menus on page: {pg.locator('[role=menu]').count()}")
        items = menu.get_by_role("menuitem").all_inner_texts()
        # the menu takes focus once it has been placed: wait for that, as a member's eye does
        try:
            pg.wait_for_function("() => { const m = document.querySelector('[role=menu]'); return !!m && m.contains(document.activeElement) }", timeout=10000)
        except Exception:  # noqa: BLE001
            raise AssertionError(f"the menu opened and never took focus; items {items}; focus now {pg.evaluate(name_js)!r}; "
                                 f"menu still on page: {pg.locator('[role=menu]').count()}; "
                                 f"document has focus: {pg.evaluate('() => document.hasFocus()')}; "
                                 f"event trace: {pg.evaluate('() => window.__ft')}; "
                                 f"menu state: {pg.evaluate(MENU_STATE_JS)}")
        in_menu = pg.evaluate(name_js)
        pg.keyboard.press("Enter")                       # the first item: Rename
        box = pg.get_by_role("textbox", name=f"Rename folder {A}")
        try:
            box.wait_for(state="visible", timeout=10000)
        except Exception:  # noqa: BLE001
            raise AssertionError(f"no rename field after Enter on the menu's first item; focus in menu was {in_menu!r}, now {pg.evaluate(name_js)!r}")
        pg.keyboard.type(" kb")
        pg.keyboard.press("Enter")
        try:
            pg.get_by_role("treeitem", name=f"{A} kb", exact=True).wait_for(state="visible", timeout=10000)
        except Exception:  # noqa: BLE001
            raise AssertionError(f"the rename did not show; folders on the server: {folder_names(cx, base)}; focus {pg.evaluate(name_js)!r}")
        return {"menu_items": items, "server_has": f"{A} kb" in folder_names(cx, base),
                "focus_after": pg.evaluate(name_js)}
    step("Shift+F10 opens the folder's menu; Rename from it works", menu_rename)

    pg.screenshot(path=str(out / "folder-walk-keys.png"))
    ctx.close()
    return steps


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why or args.port not in w.PORTS or h.port_busy(args.port):
        print(f"REFUSED: {why or 'port not allowed or busy'}")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    result = {"tool": "tools/notebook_fin_keys_folder_walk.py",
              "tree": subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(w.REPO), capture_output=True, text=True).stdout.strip(),
              "started": datetime.now(timezone.utc).isoformat(timespec="seconds"), "steps": [],
              "status": "INCOMPLETE (run did not finish)"}
    (out / "walk.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    cal = w.write_calendar(data_dir)
    w.seed_stores(data_dir, out)
    w.seed_research_stores(data_dir, out)
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    os.environ.update(w.SANDBOX_FLAGS)
    os.environ["NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR"] = str(cal)
    os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "",
                       "ALPHA_VANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    failure = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                br = pw.chromium.launch()
                admin = br.new_context()
                seedctx = br.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
                req = seedctx.request
                h._provision(admin.request, req, base, member=w.MEMBER)
                cx = w.Ctx(base=base, req=req, wide="1280")
                w.seed_member(cx, data_dir)
                pg = seedctx.new_page()
                w.open_start(pg, base, "/journal/notebook")
                w.clear_onboarding(pg, base, next(iter(cx.seed["notes"].values()), None))
                pg.close()
                state = seedctx.storage_state()
                for mode in ("mouse", "taps"):
                    result["steps"] += pointer_walk(br, state, cx, base, mode, out)
                    (out / "walk.json").write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
                result["steps"] += keyboard_walk(br, state, cx, base, out)
                (out / "walk.json").write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
                br.close()
            box.wait_checkpoint(h.POST_BOOT, 60)
    except Exception as e:  # noqa: BLE001
        failure = f"{type(e).__name__}: {str(e)[:400]}"
    finally:
        box.stop(grace_s=300)
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=None))
    failed = [s for s in result["steps"] if not s["ok"]]
    result.update({"integrity": integ, "failure": failure,
                   "finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "status": "COMPLETE" if not failure else "NOT COMPLETE"})
    (out / "walk.json").write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
    for s in result["steps"]:
        print(f"  {s['mode']:>5}  {'ok    ' if s['ok'] else 'FAILED'}  {s['step']}  {'' if s['ok'] else s['detail']}")
    print(f"VERDICT: {len(result['steps'])} steps, {len(failed)} failed{' -- FAILURE: ' + failure if failure else ''}")
    return 0 if integ["clean"] and not failure else 2


if __name__ == "__main__":
    sys.exit(main())
