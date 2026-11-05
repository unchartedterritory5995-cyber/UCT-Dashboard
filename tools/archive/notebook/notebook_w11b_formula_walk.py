"""Wave 11 lane 11B: the real-browser walk for formula and rollup properties.

In a REAL browser (Playwright Chromium) against a LOCAL SANDBOX (never C:\\data, never
production), with NOTEBOOK_FORMULAS_ENABLED=1 on the sandbox only, a paid member:

  1. opens a trade-plan note and, from the Properties section, creates four NUMBER
     properties (Entry, Stop, Target, Exit) and types their values -- keyboard only;
  2. adds the R-multiple formula from the starter picker and reads its live preview
     and then its saved value on the note;
  3. opens a parent note that links to two trade plans and creates a ROLLUP averaging
     R-multiple across the notes it links to -- keyboard only;
  4. opens the table view and sorts by the rollup (Enter on its header, twice), then
     filters it through the header's filter dialog -- keyboard only.

⛔ THE DRIVER NEVER IMPORTS api.*: every fixture (the other trade plans, the parents and
their links) is written through the sandboxed server's own HTTP endpoints, as the member.
Selects are driven by keyboard type-ahead; a select that would not take type-ahead is
set programmatically and the step SAYS so ("fallback") rather than claiming the keyboard.

PRECONDITIONS: app/dist REBUILT from the tree under test; scratchpad MEASURING.flag
absent; the data dir passed from PowerShell or quoted (never through a mangling shell).

R-RAW: the raw record (and the screenshots) are written to --out before any summary.

    python tools/notebook_w11b_formula_walk.py --data-dir <scratch>/w11b-walk1 --port 8583 \\
        --out docs/notebook/evidence/wave11-11b/walk-<run>.json --log <scratch>/w11b-walk1.log
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:  # noqa: BLE001
        pass

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import notebook_perf_harness as ph  # noqa: E402  -- ONE sandbox recipe, never a copy

MEMBER = ("w11b@local.dev", "LocalTest2026!", "w11b")
SANDBOX_ENV = {
    "NOTEBOOK_FORMULAS_ENABLED": "1",   # the gate under test, on the SANDBOX only
    "ANTHROPIC_API_KEY": "",
    "OPENAI_API_KEY": "",
}


def _doc(*paras):
    return {"type": "doc", "content": list(paras) or [{"type": "paragraph"}]}


def _p(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def _link(note_id):
    return {"type": "paragraph", "content": [{"type": "noteLink", "attrs": {"noteId": note_id}}]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8583)
    ap.add_argument("--out", required=True)
    ap.add_argument("--log", required=True)
    args = ap.parse_args(argv)
    if args.data_dir.strip().rstrip("\\/").lower() in ph.SHARED_ROOTS:
        print("REFUSED: the data dir is the shared root")
        return 3
    base = f"http://127.0.0.1:{args.port}"
    out = pathlib.Path(args.out)
    shots = out.with_suffix("")
    shots.mkdir(parents=True, exist_ok=True)
    rec: dict = {"tool": "notebook_w11b_formula_walk", "base": base, "data_dir": args.data_dir,
                 "started_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                 "sandbox_env": {k: ("(blank)" if v == "" else v) for k, v in SANDBOX_ENV.items()},
                 "rows": [], "keyboard": [], "screenshots": []}

    def row(name, result, **detail):
        rec["rows"].append({"row": name, "result": result, **detail})
        why = detail.get("why") or detail.get("saw")
        print(f"  [{result}] {name}" + (f" -- {why}" if why else ""), flush=True)

    os.environ.update(SANDBOX_ENV)
    sb = ph.Sandbox(args.data_dir, args.port, pathlib.Path(args.log))
    sb.start()
    try:
        if not sb.wait_healthy(base, 240):
            row("sandbox answers /api/health", "INCONCLUSIVE", why="never healthy")
        else:
            sb.wait_checkpoint(ph.POST_BOOT, ph.POST_BOOT_WAIT_S)
            try:
                _drive(base, row, rec, shots)
            except Exception as e:  # noqa: BLE001 -- recorded, never swallowed silently
                row("the walk ran to the end", "FAIL", why=f"{type(e).__name__}: {str(e)[:400]}")
            sb.wait_checkpoint(ph.PREWARM, ph.PREWARM_WAIT_S)
    finally:
        rec["stop"] = sb.stop()
        integ = ph.read_integrity(sb.integrity_path(), [ph.PRE_BOOT, ph.POST_BOOT, ph.PREWARM, ph.SHUTDOWN])
        rec["integrity"] = integ
        rec["integrity_line"] = ph.integrity_line(integ)
        rec["finished_utc"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        out.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")   # R-RAW before the summary
        print(rec["integrity_line"], flush=True)
    bad = [r["row"] for r in rec["rows"] if r["result"] == "FAIL"]
    unrun = [r["row"] for r in rec["rows"] if r["result"] == "INCONCLUSIVE"]
    print(f"WALK: FAIL {bad or 'none'}; INCONCLUSIVE {unrun or 'none'}; evidence {out}")
    return 1 if bad or unrun or not rec["integrity"].get("clean") else 0


def _drive(base: str, row, rec: dict, shots: pathlib.Path) -> None:
    from playwright.sync_api import sync_playwright

    def kb(pg, what: str, *keys: str):
        for k in keys:
            pg.keyboard.press(k)
        rec["keyboard"].append({"step": what, "keys": list(keys)})

    def kb_select(pg, loc, label: str, value: str, what: str, landed=None):
        """Choose an option by keyboard: type-ahead first, then Home + ArrowDown; say so
        when it had to fall back to a programmatic select. `landed` answers "did the
        choice take" for a select that resets itself after acting (the starter picker
        always shows its placeholder again, so its own value cannot say)."""
        took = landed or (lambda: loc.input_value() == value)
        loc.focus()
        pg.keyboard.type(label[:3].rstrip(), delay=40)
        pg.wait_for_timeout(150)
        if took():
            rec["keyboard"].append({"step": what, "keys": [f"type-ahead {label[:3].rstrip()!r}"]})
            return "keyboard"
        if landed is None:
            n_opts = loc.locator("option").count()
            pg.keyboard.press("Home")
            keys = ["Home"]
            for _ in range(n_opts):
                if took():
                    rec["keyboard"].append({"step": what, "keys": keys})
                    return "keyboard"
                pg.keyboard.press("ArrowDown")
                keys.append("ArrowDown")
            if took():
                rec["keyboard"].append({"step": what, "keys": keys})
                return "keyboard"
        loc.select_option(value)
        rec["keyboard"].append({"step": what, "keys": ["fallback: select_option"], "fallback": True})
        return "fallback"

    def shot(pg, name):
        p = shots / f"{len(rec['screenshots']) + 1:02d}-{name}.png"
        pg.screenshot(path=str(p), full_page=False)
        rec["screenshots"].append(p.name)

    def wait_value(row_loc, want: str, timeout=12000) -> str:
        """Wait until the row's computed value (ComputedValue's own element) reads `want`.
        Run 1 matched the ROW's text against a word-boundary regex: the row's inner text
        runs the label and the value together ("R-multiple2Edit"), so a correct value had
        no word boundary and the walk failed on its own instrument, not the product."""
        cell = row_loc.locator("[data-computed-empty]").first
        cell.wait_for(state="visible", timeout=timeout)
        end = dt.datetime.now().timestamp() + timeout / 1000
        got = ""
        while dt.datetime.now().timestamp() < end:
            got = cell.inner_text().strip()
            if got == want:
                return got
            row_loc.page.wait_for_timeout(200)
        raise RuntimeError(f"the computed value read {got!r}, not {want!r}")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        admin = browser.new_context()
        member = browser.new_context(viewport={"width": 1400, "height": 900})
        req = member.request
        ph._provision(admin.request, req, base, member=MEMBER)
        row("provision: a paid, verified member", "PASS")
        me = req.get(base + "/api/auth/me").json()
        flag = me.get("notebook_formulas_enabled")
        row("the auth payload carries notebook_formulas_enabled = true", "PASS" if flag is True else "FAIL", saw=flag)

        tag = dt.datetime.now().strftime("%H%M%S")
        rec["run_tag"] = tag

        def note(title, body):
            r = req.post(base + "/api/j2/notes", data={"title": title, "bodyJson": body})
            if r.status not in (200, 201):
                raise RuntimeError(f"fixture {title!r}: HTTP {r.status} {r.text()[:200]}")
            return r.json()["note"]["id"]

        # Fixtures, through HTTP only: the note the member fills in by hand, two more
        # trade plans, and two parents that LINK to them (a body noteLink -- the same
        # door the [[ menu writes through).
        a = note(f"Trade plan NVDA {tag}", _doc(_p("Breakout over the pivot.")))
        b = note(f"Trade plan AMD {tag}", _doc(_p("Pullback to the 21.")))
        c = note(f"Trade plan TSLA {tag}", _doc(_p("Gap and go.")))
        p1 = note(f"Week plan {tag}", _doc(_p("This week's ideas:"), _link(a), _link(b)))
        p2 = note(f"Month plan {tag}", _doc(_p("This month's idea:"), _link(c)))
        rec["fixtures"] = {"a": a, "b": b, "c": c, "p1": p1, "p2": p2}
        row("fixtures written through the sandbox's HTTP doors (5 notes, 3 links)", "PASS")

        pg = member.new_page()
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        rec["page_errors"] = errors
        pg.goto(f"{base}/journal/notebook?note={a}", wait_until="domcontentloaded", timeout=45000)
        ph._dismiss_intro(pg)
        pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
        shot(pg, "trade-plan-open")

        # ── 1. four number properties, keyboard only ────────────────────────────
        def add_number(name, value):
            pg.get_by_role("button", name="Add property").filter(visible=True).first.focus()
            kb(pg, f"open the property picker ({name})", "Enter")
            new_btn = pg.get_by_role("button", name="+ New property…").filter(visible=True).first
            new_btn.focus()
            kb(pg, f"+ New property ({name})", "Enter")
            name_box = pg.get_by_role("textbox", name="Property name")
            name_box.wait_for(state="visible", timeout=8000)
            pg.keyboard.type(name, delay=20)
            rec["keyboard"].append({"step": f"type the name {name}", "keys": [f"type {name!r}"]})
            how = kb_select(pg, pg.get_by_role("combobox", name="Property type"), "Number", "number", f"type of {name}")
            pg.get_by_role("button", name="Create").focus()
            kb(pg, f"Create {name}", "Enter")
            # focus lands on the new property's own control (the section's focus rule)
            row_loc = pg.locator("li[data-prop-row]").filter(has_text=name).first
            row_loc.wait_for(state="visible", timeout=10000)
            box = row_loc.locator("input").first
            box.wait_for(state="visible", timeout=8000)
            focused_ok = box.evaluate("e => e === document.activeElement")
            if not focused_ok:
                box.focus()
            pg.keyboard.type(str(value), delay=20)
            kb(pg, f"commit {name} = {value}", "Enter")
            return how, focused_ok

        for name, value in (("Entry", 100), ("Stop", 95), ("Target", 115), ("Exit", 110)):
            how, focused = add_number(name, value)
            row(f"create the number property {name} and set it to {value} (keyboard)", "PASS",
                select=how, focus_landed_on_its_input=focused)
        pg.wait_for_timeout(800)
        props = {p["name"]: p.get("value") for p in req.get(f"{base}/api/j2/notes/{a}/properties").json()["properties"]}
        good = all(props.get(k) == v for k, v in (("Entry", 100), ("Stop", 95), ("Target", 115), ("Exit", 110)))
        row("the server holds Entry 100 / Stop 95 / Target 115 / Exit 110 on the trade plan",
            "PASS" if good else "FAIL", saw={k: props.get(k) for k in ("Entry", "Stop", "Target", "Exit")})
        shot(pg, "four-numbers")

        # ── 2. the R-multiple formula from the starter picker ──────────────────
        pg.get_by_role("button", name="Add property").filter(visible=True).first.focus()
        kb(pg, "open the property picker (formula)", "Enter")
        pg.get_by_role("button", name="+ New property…").filter(visible=True).first.focus()
        kb(pg, "+ New property (formula)", "Enter")
        pg.get_by_role("textbox", name="Property name").wait_for(state="visible", timeout=8000)
        how_t = kb_select(pg, pg.get_by_role("combobox", name="Property type"), "Formula", "formula", "type Formula")
        formula_box = pg.get_by_role("textbox", name="Formula")
        how_s = kb_select(pg, pg.get_by_role("combobox", name="Start from a trader formula"), "R-multiple",
                          "r_multiple", "starter R-multiple",
                          landed=lambda: formula_box.input_value() == "({Exit} - {Entry}) / ({Entry} - {Stop})")
        status = pg.get_by_role("status").filter(has_text=re.compile("On this note")).first
        status.wait_for(state="visible", timeout=8000)
        preview = status.inner_text().strip()
        row("the live preview reads the value on the open note before saving",
            "PASS" if preview == "On this note: 2" else "FAIL", saw=preview, selects=[how_t, how_s])
        name_val = pg.get_by_role("textbox", name="Property name").input_value()
        row("the starter names the property", "PASS" if name_val == "R-multiple" else "FAIL", saw=name_val)
        shot(pg, "formula-preview")
        pg.get_by_role("button", name="Create").focus()
        kb(pg, "Create R-multiple", "Enter")
        r_row = pg.locator("li[data-prop-row]").filter(has_text="R-multiple").first
        r_row.wait_for(state="visible", timeout=10000)
        row("the R-multiple row shows 2 on the trade plan", "PASS", saw=wait_value(r_row, "2"))
        defs = {d["name"]: d for d in req.get(base + "/api/j2/property-defs").json()["propertyDefs"]}
        expr = (defs.get("R-multiple") or {}).get("config", {}).get("expression", "")
        ids_ok = all("{@" + defs[n]["id"] + "}" in expr for n in ("Entry", "Stop", "Exit")) and "{Exit}" not in expr
        row("the formula is STORED by property id, not by name", "PASS" if ids_ok else "FAIL", saw=expr)
        shot(pg, "formula-saved")

        # change an input by keyboard: the formula recomputes on the next read
        exit_box = pg.locator("li[data-prop-row]").filter(has_text="Exit").first.locator("input").first
        exit_box.focus()
        kb(pg, "select the Exit value", "Control+a")
        pg.keyboard.type("120", delay=20)
        kb(pg, "commit Exit = 120", "Enter")
        row("changing Exit to 120 recomputes R-multiple to 4", "PASS",
            saw=wait_value(pg.locator("li[data-prop-row]").filter(has_text="R-multiple").first, "4"))

        # the other trade plans' values, through HTTP (B: R 0.4, C: R 3)
        ids = {n: defs[n]["id"] for n in ("Entry", "Stop", "Target", "Exit")}
        for nid, (e, s, t, x) in ((b, (50, 45, 60, 52)), (c, (20, 18, 30, 26))):
            r = req.put(f"{base}/api/j2/notes/{nid}", data={"properties": {
                ids["Entry"]: e, ids["Stop"]: s, ids["Target"]: t, ids["Exit"]: x}})
            if r.status != 200:
                raise RuntimeError(f"fixture values: HTTP {r.status} {r.text()[:200]}")
        row("fixture values for the other two trade plans (R 0.4 and R 3) through HTTP", "PASS")

        # ── 3. the rollup on a parent note, keyboard only ──────────────────────
        pg.goto(f"{base}/journal/notebook?note={p1}", wait_until="domcontentloaded", timeout=45000)
        pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
        pg.get_by_role("button", name="Add property").filter(visible=True).first.focus()
        kb(pg, "open the property picker (rollup)", "Enter")
        pg.get_by_role("button", name="+ New property…").filter(visible=True).first.focus()
        kb(pg, "+ New property (rollup)", "Enter")
        pg.get_by_role("textbox", name="Property name").wait_for(state="visible", timeout=8000)
        pg.keyboard.type("Avg R", delay=20)
        rec["keyboard"].append({"step": "type the name Avg R", "keys": ["type 'Avg R'"]})
        sels = [
            kb_select(pg, pg.get_by_role("combobox", name="Property type"), "Rollup", "rollup", "type Rollup"),
            kb_select(pg, pg.get_by_role("combobox", name="Summarise"), "Notes this", "links_from_this", "source"),
            kb_select(pg, pg.get_by_role("combobox", name="Calculate"), "Average", "avg", "aggregate"),
            kb_select(pg, pg.get_by_role("combobox", name="Of the property"), "R-multiple", defs["R-multiple"]["id"], "property"),
        ]
        sentence = pg.get_by_role("status").filter(has_text=re.compile("Average of")).first.inner_text().strip()
        row("the rollup editor says what it will compute", "PASS"
            if sentence == "Average of R-multiple across notes this note links to" else "FAIL", saw=sentence, selects=sels)
        shot(pg, "rollup-editor")
        pg.get_by_role("button", name="Create").focus()
        kb(pg, "Create Avg R", "Enter")
        avg_row = pg.locator("li[data-prop-row]").filter(has_text="Avg R").first
        avg_row.wait_for(state="visible", timeout=10000)
        row("Avg R on the week plan is 2.2 -- the average of R 4 and R 0.4", "PASS",
            saw=wait_value(avg_row, "2.2"))        # (4 + 0.4) / 2
        shot(pg, "rollup-saved")
        r2 = {p["name"]: p.get("value") for p in req.get(f"{base}/api/j2/notes/{p2}/properties").json()["properties"]}
        row("the month plan's Avg R is 3 (one linked plan, R 3), computed on the server",
            "PASS" if r2.get("Avg R") == 3 else "FAIL", saw=r2.get("Avg R"))

        # ── 4. the table: sort by the rollup, then filter it ────────────────────
        pg.goto(f"{base}/journal/notebook?view=all", wait_until="domcontentloaded", timeout=45000)
        ph._dismiss_intro(pg)
        tbtn = pg.get_by_role("button", name="Table view").filter(visible=True).first
        tbtn.wait_for(state="visible", timeout=20000)
        tbtn.focus()
        kb(pg, "switch to the table view", "Enter")
        sort_btn = pg.get_by_role("button", name=re.compile(r"^Avg R")).filter(visible=True).first
        sort_btn.wait_for(state="visible", timeout=15000)
        shot(pg, "table")

        def order():
            titles = pg.locator("table tbody tr").all_inner_texts()
            want = {f"Week plan {tag}": "week", f"Month plan {tag}": "month"}
            seen = []
            for t in titles:
                for full, short in want.items():
                    if full in t and short not in seen:
                        seen.append(short)
            return seen

        sort_btn.focus()
        kb(pg, "sort by Avg R (ascending)", "Enter")
        pg.wait_for_function(
            "() => { const th = [...document.querySelectorAll('th')].find(t => t.textContent.startsWith('Avg R'));"
            " return th && th.getAttribute('aria-sort') === 'ascending' }", timeout=15000)
        pg.wait_for_timeout(1200)
        asc = order()
        row("Enter on the Avg R header sorts ascending: week (2.2) before month (3)",
            "PASS" if asc == ["week", "month"] else "FAIL", saw=asc)
        first_rows = pg.locator("table tbody tr").all_inner_texts()[:2]
        row("ascending puts the valued rows first and the empties last",
            "PASS" if any(f"Week plan {tag}" in t for t in first_rows) else "FAIL",
            saw=[t.split("\n")[0] for t in first_rows])
        shot(pg, "table-sorted-asc")
        pg.get_by_role("button", name=re.compile(r"^Avg R")).filter(visible=True).first.focus()
        kb(pg, "sort by Avg R (descending)", "Enter")
        pg.wait_for_function(
            "() => { const th = [...document.querySelectorAll('th')].find(t => t.textContent.startsWith('Avg R'));"
            " return th && th.getAttribute('aria-sort') === 'descending' }", timeout=15000)
        pg.wait_for_timeout(1200)
        desc = order()
        row("Enter again sorts descending: month (3) before week (2.2)",
            "PASS" if desc == ["month", "week"] else "FAIL", saw=desc)
        top = pg.locator("table tbody tr").first.inner_text()
        row("descending puts the month plan at the very top", "PASS" if f"Month plan {tag}" in top else "FAIL",
            saw=top.split("\n")[0])
        shot(pg, "table-sorted-desc")

        fbtn = pg.get_by_role("button", name="Filter Avg R").filter(visible=True).first
        fbtn.focus()
        kb(pg, "open the Avg R filter", "Enter")
        dialog = pg.get_by_role("dialog", name="Filter Avg R")
        dialog.wait_for(state="visible", timeout=8000)
        how_f = kb_select(pg, dialog.get_by_role("combobox"), "is above", "gt", "filter op")
        dialog.get_by_role("spinbutton", name="Number").focus()
        pg.keyboard.type("2.5", delay=20)
        kb(pg, "apply the filter", "Enter")
        # ⚰️ Run 2 waited on document.body -- and the sidebar's RECENTS list names the week
        # plan, so the page never stopped saying it. The table body is the claim.
        pg.wait_for_function(
            "(t) => { const b = document.querySelector('table tbody');"
            " return b && !b.innerText.includes(t) }", arg=f"Week plan {tag}", timeout=15000)
        body = pg.locator("table tbody").inner_text()
        ok = f"Month plan {tag}" in body and f"Week plan {tag}" not in body
        row("filter Avg R is above 2.5 leaves the month plan and drops the week plan",
            "PASS" if ok else "FAIL", select=how_f)
        shot(pg, "table-filtered")
        row("no uncaught page error during the walk", "PASS" if not errors else "FAIL", saw=errors[:5])
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
