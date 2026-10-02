"""Wave 11 lane 11C -- the real-browser KEYBOARD walk for "Ask Notebook to do something".

It OWNS its sandbox (tools/notebook_perf_harness.py's `Sandbox`: scripts/hub_sandbox_boot.py
through the SIGBREAK shim, its own process group, stopped gracefully so the launcher's `finally`
writes the SHUTDOWN checkpoint). Its FIRST output line is the launcher's integrity verdict.

⛔ THIS DRIVER NEVER IMPORTS `api.*` (it would arm the app's import-time readers in the
driver's own process, pointed at whatever paths this shell has). The last row asserts it from
`sys.modules`, and tests/test_notebook_ai_actions.py reads this file's imports.

⛔ NO MODEL IS CALLED. The launcher blanks every model key; the plan call is answered by
`ai_actions`' sandbox-only stub, which this driver arms with NOTEBOOK_AI_ACTIONS_SANDBOX_STUB=1
in the CHILD's environment. The stub needs a blank ANTHROPIC_API_KEY, none of Railway's service variables and
the repo conftest imported (the launcher imports it) -- never true on a pod.

Run from PowerShell (a Windows path through the Bash tool loses its backslash):

    python tools/notebook_w11c_walk.py --data-dir '<scratch>\\w11c-walk-data' --port 8601 `
        --out '<scratch>\\w11c-walk-<ts>'

Preconditions: app/dist rebuilt from this tree (`npm run build` in app/); the port free (refused,
never killed); the data dir outside the shared root (refused).

  W1  the box is reached by Tab from the top of Research Home and opens with Enter
  W2  the request is typed and planned with Ctrl+Enter
  W3  the review groups changes by note, shows before/after, skips the locked note and the
      disallowed delete with their reasons
  W4  NOTHING was written before approval (every seeded note's revision unchanged)
  W5  one change unchecked by keyboard (Tab + Space); Apply N reached by Tab, pressed with Enter
  W6  the notes read back with exactly the approved changes (and not the unchecked one)
  W7  the AI block shows its provenance label in the editor; viewing the note writes nothing
  W8  Undo (Tab + Enter) restores every note to what it was
  W9  a second set, applied, is listed in the note's Version history and undone from there
  W10 the driver never imported api.*

Exit: 0 = every row PASS and integrity CLEAN; 1 = a row FAILED; 2 = integrity not CLEAN;
3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)

MEMBER = ("w11c@local.dev", "LocalTest2026!", "w11c")
REQUEST_1 = ('tag every note that mentions NVDA earnings with earnings-nvda; '
             'add a task "Check the NVDA print" to every note that mentions NVDA earnings; '
             'move every note that mentions 2024 trade review to folder 2024 Reviews; '
             'delete every note that mentions NVDA earnings')
REQUEST_2 = 'tag every note that mentions Rates and the dollar with macro'

NOTES = {
    "A": ("NVDA thesis", "Long NVDA into the print. NVDA earnings land Nov 19.", ["semis"]),
    "B": ("AMD vs NVDA", "AMD reports next week; NVDA earnings set the tone for the group.", []),
    "C": ("2024 trade review: MSFT", "My 2024 trade review of the MSFT breakout.", []),
    "D": ("Locked NVDA plan", "NVDA earnings plan, locked on purpose.", []),
    "E": ("Macro", "Rates and the dollar drive the tape.", []),
}


def doc(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


class Walk:
    def __init__(self, out: Path):
        self.out = out
        self.rows: list[dict] = []
        self.raw: dict = {}

    def record(self, rid, ok, detail):
        self.rows.append({"id": rid, "verdict": "PASS" if ok else "FAIL", "detail": detail})
        print(f"  {rid}: {'PASS' if ok else 'FAIL'} -- {detail}")

    def shot(self, pg, name):
        p = self.out / f"{name}.png"
        pg.screenshot(path=str(p), full_page=True)
        return p.name


def tab_to(pg, js_predicate: str, limit: int = 250) -> int:
    """Press Tab until `js_predicate(document.activeElement)` is true. -> presses, or -1."""
    for i in range(1, limit + 1):
        pg.keyboard.press("Tab")
        if pg.evaluate(f"(() => {{ const el = document.activeElement; return !!(el && ({js_predicate})) }})()"):
            return i
    return -1


def name_is(text: str) -> str:
    t = json.dumps(text)
    return (f"((el.getAttribute('aria-label') || el.textContent || '').trim() === {t})")


def name_starts(text: str) -> str:
    t = json.dumps(text)
    return (f"((el.getAttribute('aria-label') || el.textContent || '').trim().startsWith({t}))")


def read_note(req, base, nid):
    r = req.get(f"{base}/api/j2/notes/{nid}")
    return r.json()["note"] if r.status == 200 else None


def run(base: str, w: Walk) -> None:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
        req = ctx.request
        h._provision(admin_ctx.request, req, base, member=MEMBER)
        me = req.get(base + "/api/auth/me").json()
        w.raw["flag_on_payload"] = me.get("notebook_ai_actions_enabled")
        ids = {}
        for k, (title, text, tags) in NOTES.items():
            r = req.post(base + "/api/j2/notes", data={"title": title, "bodyJson": doc(text), "tags": tags})
            if r.status not in (200, 201):
                raise h.SetupFailed(f"seeding {k} failed: HTTP {r.status}")
            ids[k] = r.json()["note"]["id"]
        lk = req.patch(f"{base}/api/j2/notes/{ids['D']}/lock", data={"locked": True})
        if lk.status != 200:
            raise h.SetupFailed(f"locking D failed: HTTP {lk.status}")
        before = {k: read_note(req, base, nid) for k, nid in ids.items()}
        w.raw["ids"] = ids
        w.raw["before"] = {k: {"updatedAt": n["updatedAt"], "tags": n["tags"], "folderId": n["folderId"],
                               "bodyJson": n["bodyJson"]} for k, n in before.items()}

        pg = ctx.new_page()
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        toggle = pg.get_by_role("button", name="Ask Notebook to do something", exact=True)
        toggle.wait_for(state="visible", timeout=30000)

        # W1 -- reach the box by Tab, open with Enter
        pg.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
        presses = tab_to(pg, name_is("Ask Notebook to do something"))
        pg.keyboard.press("Enter")
        box = pg.get_by_role("textbox", name="What should Notebook do?")
        box.wait_for(state="visible", timeout=10000)
        focused = pg.evaluate("document.activeElement && document.activeElement.getAttribute('aria-describedby') !== null"
                              " && document.activeElement.tagName === 'TEXTAREA'")
        w.record("W1_box_by_keyboard", presses > 0 and focused,
                 f"{presses} Tab presses reached the toggle; Enter opened it; the request box has focus={focused}")
        w.shot(pg, "W1-open")

        # W2 -- type and plan with Ctrl+Enter
        pg.keyboard.type(REQUEST_1, delay=2)
        pg.keyboard.press("Control+Enter")
        heading = pg.get_by_role("heading", name="Review 5 proposed changes")
        try:
            heading.wait_for(state="visible", timeout=60000)
            planned = True
        except Exception:  # noqa: BLE001
            planned = False
        head_focus = pg.evaluate("document.activeElement && document.activeElement.tagName") if planned else None
        w.record("W2_planned_by_keyboard", planned and head_focus == "H3",
                 f"Ctrl+Enter planned it; review heading shown={planned}, focus on {head_focus}")
        w.shot(pg, "W2-review")
        if not planned:
            w.raw["page_text"] = pg.inner_text("body")[:4000]
            return

        # W3 -- grouping, before/after, skipped reasons
        legends = pg.locator("fieldset legend").all_inner_texts()
        boxes = pg.get_by_role("checkbox").all()
        descs = [b.evaluate("el => document.getElementById(el.getAttribute('aria-describedby')).innerText") for b in boxes]
        names = [b.evaluate("el => document.querySelector(`label[for=\"${el.id}\"]`).innerText") for b in boxes]
        pg.get_by_text("Skipped (5) — not changed").click()  # a <summary> -- opened by click only to READ it
        skipped = pg.get_by_role("list", name="Skipped changes").inner_text()
        w.raw["review"] = {"legends": legends, "labels": names, "descriptions": descs, "skipped": skipped}
        ok3 = (legends == ["NVDA thesis", "AMD vs NVDA", "2024 trade review: MSFT"]
               and all(b.is_checked() for b in boxes) and len(boxes) == 5
               and skipped.count("That note is locked, so it is never changed.") == 2
               and skipped.count("Notebook AI can't do that") == 3
               and any("Before:" in d and "After:" in d for d in descs))
        w.record("W3_review_list", ok3, f"groups {legends}; {len(boxes)} checkboxes all checked; "
                 f"skipped: 2 locked + 3 disallowed (delete) with their reasons")
        w.shot(pg, "W3-review-skipped")

        # W4 -- nothing written before approval
        mid = {k: read_note(req, base, nid) for k, nid in ids.items()}
        unchanged = all(mid[k]["updatedAt"] == before[k]["updatedAt"] for k in ids)
        w.record("W4_no_write_before_approve", unchanged,
                 "every seeded note's updatedAt is what it was before the plan" if unchanged
                 else f"a revision moved: {[k for k in ids if mid[k]['updatedAt'] != before[k]['updatedAt']]}")

        # W5 -- uncheck the first change (A's tag) by keyboard, Apply by keyboard
        pg.get_by_role("heading", name="Review 5 proposed changes").focus()
        t1 = tab_to(pg, "el.type === 'checkbox'", 20)
        first_label = pg.evaluate("document.querySelector(`label[for=\"${document.activeElement.id}\"]`).innerText")
        pg.keyboard.press("Space")
        unchecked = not pg.evaluate("document.activeElement.checked")
        t2 = tab_to(pg, name_starts("Apply "), 40)
        apply_name = pg.evaluate("document.activeElement.textContent.trim()")
        pg.keyboard.press("Enter")
        done = pg.get_by_role("heading", name="AI change set applied")
        done.wait_for(state="visible", timeout=60000)
        status = pg.get_by_role("status").first.inner_text()
        w.record("W5_uncheck_and_apply_by_keyboard",
                 t1 > 0 and unchecked and first_label.startswith("Add tag") and apply_name == "Apply 4 changes"
                 and status == "Applied 4 changes.",
                 f"Tab x{t1} to '{first_label}', Space unchecked it; Tab x{t2} to '{apply_name}', Enter; "
                 f"status: {status!r}")
        w.shot(pg, "W5-applied")

        # W6 -- the notes read back with exactly the approved changes
        after = {k: read_note(req, base, nid) for k, nid in ids.items()}
        w.raw["after_apply"] = {k: {"updatedAt": n["updatedAt"], "tags": n["tags"], "folderId": n["folderId"],
                                    "lastBlock": (n["bodyJson"].get("content") or [None])[-1]} for k, n in after.items()}
        a_last, b_last = after["A"]["bodyJson"]["content"][-1], after["B"]["bodyJson"]["content"][-1]
        folders = req.get(base + "/api/j2/note-folders").json()
        flist = folders.get("folders", folders) if isinstance(folders, dict) else folders
        c_folder = next((f["name"] for f in flist if f["id"] == after["C"]["folderId"]), None)
        ok6 = (after["A"]["tags"] == ["semis"]                          # the unchecked tag was NOT applied
               and after["B"]["tags"] == ["earnings-nvda"]
               and a_last["type"] == "askInsert" and a_last["attrs"]["action"] == "ai_change"
               and a_last["content"][0]["type"] == "taskList"
               and b_last["type"] == "askInsert"
               and c_folder == "2024 Reviews"
               and after["D"]["updatedAt"] == before["D"]["updatedAt"]
               and after["E"]["updatedAt"] == before["E"]["updatedAt"])
        w.record("W6_notes_after_apply", ok6,
                 f"A tags {after['A']['tags']} (its tag was unchecked) + AI task block; B tags {after['B']['tags']} + "
                 f"AI task block; C in folder {c_folder!r}; locked D and unrelated E untouched")

        # W7 -- provenance label in the editor; viewing writes nothing
        pg2 = ctx.new_page()
        pg2.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg2.goto(f"{base}/journal/notebook?note={ids['A']}", wait_until="domcontentloaded")
        h._dismiss_intro(pg2)
        label = pg2.get_by_text("Compass · AI change", exact=False)
        try:
            label.first.wait_for(state="visible", timeout=30000)
            shown = True
        except Exception:  # noqa: BLE001
            shown = False
        group = pg2.get_by_role("group", name=f"Added by an AI change set: {REQUEST_1}")
        has_group = group.count() > 0
        pg2.wait_for_timeout(4000)
        w.shot(pg2, "W7-provenance-in-editor")
        pg2.close()
        a_view = read_note(req, base, ids["A"])
        w.record("W7_provenance_and_view_is_read_only", shown and has_group
                 and a_view["updatedAt"] == after["A"]["updatedAt"],
                 f"label 'Compass · AI change' shown={shown}; named group={has_group}; "
                 f"A's revision unchanged after viewing={a_view['updatedAt'] == after['A']['updatedAt']}")

        # W8 -- Undo by keyboard restores everything
        pg.bring_to_front()
        done.focus()
        t3 = tab_to(pg, name_is("Undo this change set"), 20)
        pg.keyboard.press("Enter")
        pg.get_by_role("heading", name="AI change set undone").wait_for(state="visible", timeout=60000)
        undo_status = pg.get_by_role("status").first.inner_text()
        restored = {k: read_note(req, base, nid) for k, nid in ids.items()}
        w.raw["after_undo"] = {k: {"updatedAt": n["updatedAt"], "tags": n["tags"], "folderId": n["folderId"]}
                               for k, n in restored.items()}
        ok8 = all(restored[k]["tags"] == before[k]["tags"] and restored[k]["folderId"] == before[k]["folderId"]
                  and restored[k]["bodyJson"] == before[k]["bodyJson"] for k in ids)
        w.record("W8_undo_by_keyboard_restores", t3 > 0 and ok8,
                 f"Tab x{t3} to Undo, Enter; status {undo_status!r}; every note's tags, folder and body are "
                 f"what they were before the set={ok8}")
        w.shot(pg, "W8-undone")

        # W9 -- a second set, undone from the note's Version history
        pg.get_by_role("heading", name="AI change set undone").focus()
        tab_to(pg, name_is("Ask for something else"), 20)
        pg.keyboard.press("Enter")
        pg.get_by_role("textbox", name="What should Notebook do?").wait_for(state="visible", timeout=10000)
        pg.keyboard.type(REQUEST_2, delay=2)
        pg.keyboard.press("Control+Enter")
        pg.get_by_role("heading", name="Review 1 proposed change").wait_for(state="visible", timeout=60000)
        tab_to(pg, name_starts("Apply "), 40)
        pg.keyboard.press("Enter")
        pg.get_by_role("heading", name="AI change set applied").wait_for(state="visible", timeout=60000)
        e_tagged = read_note(req, base, ids["E"])
        pg3 = ctx.new_page()
        pg3.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg3.goto(f"{base}/journal/notebook?note={ids['E']}", wait_until="domcontentloaded")
        h._dismiss_intro(pg3)
        pg3.get_by_role("button", name="Version history").first.wait_for(state="attached", timeout=30000)
        pg3.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
        tm = tab_to(pg3, "el.tagName === 'BUTTON' && el.getAttribute('aria-label') === 'More note actions'", 150)
        pg3.keyboard.press("Enter")
        th = tab_to(pg3, "el.getAttribute('aria-label') === 'Version history'", 40)
        pg3.keyboard.press("Enter")
        undo_btn = pg3.get_by_role("button", name=f"Undo AI change set “{REQUEST_2}”")
        try:
            undo_btn.wait_for(state="visible", timeout=30000)
            listed = True
        except Exception:  # noqa: BLE001
            listed = False
        w.shot(pg3, "W9-history-lists-the-set")
        tu = tab_to(pg3, f"(el.getAttribute('aria-label') || '') === {json.dumps('Undo AI change set “' + REQUEST_2 + '”')}", 80) if listed else -1
        if tu > 0:
            pg3.keyboard.press("Enter")
            pg3.get_by_text("Undid 1 change. Your notes are back as they were.").wait_for(state="visible", timeout=30000)
        w.shot(pg3, "W9-history-undone")
        e_after = read_note(req, base, ids["E"])
        w.raw["w9"] = {"tags_after_apply": e_tagged["tags"], "tags_after_history_undo": e_after["tags"],
                       "tabs": {"more": tm, "history": th, "undo": tu}}
        w.record("W9_history_lists_and_undoes", listed and tu > 0 and e_tagged["tags"] == ["macro"]
                 and e_after["tags"] == [],
                 f"E tagged {e_tagged['tags']} by the second set; Version history listed it={listed}; "
                 f"Undo reached by Tab x{tu}; E tags now {e_after['tags']}")
        pg3.close()
        w.raw["page_errors"] = errors
        w.record("W_no_page_errors", not errors, f"{len(errors)} unforced page errors" + (f": {errors[:3]}" if errors else ""))
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8601)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if not 8600 <= args.port <= 8620:
        print("REFUSED: this lane's walk uses ports 8600-8620 only")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this walk never kills it")
        return 3
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    # The CHILD's environment (Popen inherits it): the gate on, the sandbox stub armed, and no
    # Railway variable or model key the stub would refuse to run beside.
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    # ⛔ Written for the CHILD, never read here: the gate's one parse lives in the app
    # (notebook_flags.flag_on), and tests/test_notebook_flag_parse.py holds every reader to it.
    os.environ.update({"NOTEBOOK_AI_ACTIONS_ENABLED": "1", "NOTEBOOK_AI_ACTIONS_SANDBOX_STUB": "1",
                       "ANTHROPIC_API_KEY": ""})
    w = Walk(out)
    box = h.Sandbox(args.data_dir, args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    failure = not_run = None
    box.start()
    try:
        if not box.wait_healthy(base, 240):
            failure = "the sandbox never answered /api/health"
        else:
            try:
                run(base, w)
            except h.SetupFailed as e:
                not_run = str(e)[:300]
            except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
                failure = f"the walk raised {type(e).__name__}: {str(e)[:400]}"
            box.wait_checkpoint(h.POST_BOOT, 60)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    w.record("W10_driver_never_imported_api", not api_mods,
             "no api.* module in the driver's sys.modules" if not api_mods else f"imported: {api_mods[:5]}")
    result = {"tool": "tools/notebook_w11c_walk.py", "base": base, "requests": [REQUEST_1, REQUEST_2],
              "integrity": integ, "failure": failure, "not_run": not_run, "rows": w.rows, "raw": w.raw}
    (out / "walk.json").write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT: FAIL -- {failure}")
        return 1
    if any(r["verdict"] != "PASS" for r in w.rows):
        print("VERDICT: FAIL -- " + ", ".join(r["id"] for r in w.rows if r["verdict"] != "PASS"))
        return 1
    if not integ["clean"]:
        print(f"VERDICT: INTEGRITY {integ['status']}")
        return 2
    print(f"VERDICT: PASS -- {len(w.rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
