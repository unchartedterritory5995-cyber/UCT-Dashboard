"""Wave 12 lane 12B-2: the real-browser walk for the Position Tracker template.

In a REAL browser (Playwright Chromium) against a LOCAL SANDBOX (never C:\\data, never
production, never port 8077), a paid member, in ONE of two modes:

``--formulas on`` (NOTEBOOK_FORMULAS_ENABLED=1 on the sandbox only):
  1. from the ``?view=all`` landing, opens Templates and picks "Position Tracker": the
     client creates the eight definitions (five numbers, three formulas stored by id),
     THEN the note, and the new note shows the eight while they are still empty;
  2. types Entry / Stop / Shares / Account size / Exit into the note's properties --
     keyboard only -- and reads Risk per share, Position size % and R-multiple compute;
  3. makes a SECOND tracker through the ``?new=position-tracker`` deep link: every
     definition is REUSED (still eight, no duplicate name), and types its numbers;
  4. opens the table view and sorts by R-multiple (Enter on its header, twice).

``--formulas off`` (NOTEBOOK_FORMULAS_ENABLED=0 on the sandbox only):
  1. the same pick from the same landing: the note is made and opens, the five number
     definitions exist, NOT ONE formula definition was requested, and no /api/ response
     in the whole walk is a 4xx or 5xx (never a 400, never a half-applied write);
  2. a number typed into the tracker saves.

⛔ THE DRIVER NEVER IMPORTS api.*: the one fixture (a third tracker's values, for the
sort) is written through the sandboxed server's own HTTP endpoints, as the member.

PRECONDITIONS: app/dist REBUILT from the tree under test; the data dir passed from
PowerShell or single-quoted (never through a mangling shell); a port in 8595-8599.

R-RAW: the raw record (and the screenshots) are written to --out before any summary.

    python tools/notebook_w12b2_walk.py --formulas on --data-dir <scratch>/w12b2-on \\
        --port 8595 --out docs/notebook/evidence/wave12-12b2/walk-on-<run>.json --log <scratch>/w12b2-on.log
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

MEMBER = ("w12b2@local.dev", "LocalTest2026!", "w12b2")
NUMBERS = ["Entry", "Stop", "Exit", "Shares", "Account size"]
FORMULAS = ["R-multiple", "Risk per share", "Position size %"]
PORTS = range(8595, 8600)


def _own(d: dict) -> bool:
    """A member's own definition -- not one of the code-defined built-ins, which the
    list also reports as `user_set` (Thesis Status, Confidence, Research Type, Review
    Date carry `builtin:` ids; run 1 counted them as the member's)."""
    return d.get("source") == "user_set" and not str(d.get("id", "")).startswith("builtin:")


def sandbox_env(formulas_on: bool) -> dict[str, str]:
    return {
        "NOTEBOOK_FORMULAS_ENABLED": "1" if formulas_on else "0",   # the gate, on the SANDBOX only
        "ANTHROPIC_API_KEY": "",
        "OPENAI_API_KEY": "",
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--formulas", choices=("on", "off"), required=True)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8595)
    ap.add_argument("--out", required=True)
    ap.add_argument("--log", required=True)
    args = ap.parse_args(argv)
    if args.data_dir.strip().rstrip("\\/").lower() in ph.SHARED_ROOTS:
        print("REFUSED: the data dir is the shared root")
        return 3
    if args.port not in PORTS:
        print(f"REFUSED: port {args.port} is outside this lane's sandbox range 8595-8599")
        return 3
    if ph.port_busy(args.port):
        print(f"REFUSED: port {args.port} is already held")
        return 3
    on = args.formulas == "on"
    env = sandbox_env(on)
    base = f"http://127.0.0.1:{args.port}"
    out = pathlib.Path(args.out)
    shots = out.with_suffix("")
    shots.mkdir(parents=True, exist_ok=True)
    rec: dict = {"tool": "notebook_w12b2_walk", "formulas": args.formulas, "base": base,
                 "data_dir": args.data_dir,
                 "started_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                 "sandbox_env": {k: ("(blank)" if v == "" else v) for k, v in env.items()},
                 "rows": [], "keyboard": [], "screenshots": [], "api_log": []}

    def row(name, result, **detail):
        rec["rows"].append({"row": name, "result": result, **detail})
        why = detail.get("why") or detail.get("saw")
        print(f"  [{result}] {name}" + (f" -- {why}" if why is not None else ""), flush=True)

    os.environ.update(env)
    sb = ph.Sandbox(args.data_dir, args.port, pathlib.Path(args.log))
    sb.start()
    try:
        if not sb.wait_healthy(base, 240):
            row("sandbox answers /api/health", "INCONCLUSIVE", why="never healthy")
        else:
            sb.wait_checkpoint(ph.POST_BOOT, ph.POST_BOOT_WAIT_S)
            try:
                _drive(base, on, row, rec, shots)
            except Exception as e:  # noqa: BLE001 -- recorded, never swallowed silently
                row("the walk ran to the end", "FAIL", why=f"{type(e).__name__}: {str(e)[:1500]}")
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
    print(f"WALK ({args.formulas}): FAIL {bad or 'none'}; INCONCLUSIVE {unrun or 'none'}; evidence {out}")
    return 1 if bad or unrun or not rec["integrity"].get("clean") else 0


def _drive(base: str, on: bool, row, rec: dict, shots: pathlib.Path) -> None:
    from playwright.sync_api import sync_playwright

    def kb(pg, what: str, *keys: str):
        for k in keys:
            pg.keyboard.press(k)
        rec["keyboard"].append({"step": what, "keys": list(keys)})

    def shot(pg, name):
        p = shots / f"{len(rec['screenshots']) + 1:02d}-{name}.png"
        pg.screenshot(path=str(p), full_page=False)
        rec["screenshots"].append(p.name)

    def wait_value(row_loc, want: str, timeout=15000) -> str:
        """Wait until the row's computed value (ComputedValue's own element) reads `want`
        (the w11b walk's lesson: never match the row's run-together text)."""
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
        row(f"the auth payload carries notebook_formulas_enabled = {str(on).lower()}",
            "PASS" if flag is on else "FAIL", saw=flag)
        before = req.get(base + "/api/j2/property-defs").json()["propertyDefs"]
        own = [d["name"] for d in before if _own(d)]
        row("a fresh member has no definitions of their own (the four built-ins aside)",
            "PASS" if not own else "FAIL", saw=own)

        pg = member.new_page()
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        rec["page_errors"] = errors

        def on_response(resp):
            u = resp.url
            if "/api/" not in u:
                return
            entry = {"method": resp.request.method, "path": u.replace(base, ""), "status": resp.status}
            if "/api/j2/property-defs" in u and resp.request.method == "POST":
                try:
                    entry["body"] = json.loads(resp.request.post_data or "{}")
                except Exception:  # noqa: BLE001
                    entry["body"] = "(unreadable)"
            rec["api_log"].append(entry)
        pg.on("response", on_response)

        def opened_note_id(timeout=30000) -> str:
            pg.wait_for_url(re.compile(r"[?&]note="), timeout=timeout)
            m = re.search(r"[?&]note=([^&]+)", pg.url)
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            return m.group(1)

        def defs_by_name():
            ds = req.get(base + "/api/j2/property-defs").json()["propertyDefs"]
            return [d for d in ds if _own(d)]

        def type_number(def_id: str, name: str, value) -> None:
            row_loc = pg.locator(f'li[data-prop-row="{def_id}"]')
            box = row_loc.locator("input").first
            box.wait_for(state="visible", timeout=10000)
            box.focus()
            kb(pg, f"select {name}", "Control+a")
            pg.keyboard.type(str(value), delay=20)
            rec["keyboard"].append({"step": f"type {name}", "keys": [f"type {value!r}"]})
            kb(pg, f"commit {name} = {value}", "Enter")
            pg.wait_for_timeout(500)

        # ── 1. pick the template from the ?view=all landing ──────────────────────
        pg.goto(f"{base}/journal/notebook?view=all", wait_until="domcontentloaded", timeout=45000)
        ph._dismiss_intro(pg)
        tb = pg.get_by_role("button", name="Templates", exact=True).filter(visible=True).first
        tb.wait_for(state="visible", timeout=20000)
        tb.click()
        # Scoped to the dialog: an EMPTY notebook also renders the picker inline behind it,
        # and that copy's card is visible but covered by the dialog's backdrop (run 1).
        dialog = pg.get_by_role("dialog", name="New note")
        dialog.wait_for(state="visible", timeout=15000)
        card = dialog.get_by_role("button", name="Position Tracker", exact=True)
        card.wait_for(state="visible", timeout=15000)
        shot(pg, "picker")
        card.click()
        n1 = opened_note_id()
        rec["notes"] = {"n1": n1}
        row("picking Position Tracker creates a note and opens it in the editor", "PASS", saw=n1)
        pg.wait_for_timeout(1000)
        shot(pg, "tracker-open")

        defs = defs_by_name()
        by = {d["name"]: d for d in defs}
        want_names = NUMBERS + (FORMULAS if on else [])
        row("the member's definitions are exactly the template's" + ("" if on else " numbers (no formula)"),
            "PASS" if sorted(by) == sorted(want_names) and len(defs) == len(want_names) else "FAIL",
            saw=sorted(d["name"] for d in defs))
        types_ok = all(by.get(n, {}).get("type") == "number" for n in NUMBERS) and \
            all(by.get(n, {}).get("type") == "formula" for n in (FORMULAS if on else []))
        row("each definition has the declared type", "PASS" if types_ok else "FAIL",
            saw={n: by.get(n, {}).get("type") for n in want_names})

        posts = [e for e in rec["api_log"] if e["method"] == "POST" and e["path"].startswith("/api/j2/property-defs")]
        note_posts = [i for i, e in enumerate(rec["api_log"]) if e["method"] == "POST" and e["path"] == "/api/j2/notes"]
        last_def_post = max((i for i, e in enumerate(rec["api_log"]) if e in posts), default=-1)
        row("the definitions were created BEFORE the note (one note create)",
            "PASS" if len(note_posts) == 1 and last_def_post < note_posts[0] else "FAIL",
            saw={"def_posts": len(posts), "note_posts": len(note_posts)})
        formula_posts = [e for e in posts if isinstance(e.get("body"), dict) and e["body"].get("type") == "formula"]
        if on:
            ids = {by[n]["id"] for n in NUMBERS}
            exprs = {n: (by[n].get("config") or {}).get("expression", "") for n in FORMULAS}
            by_id = all(re.findall(r"\{@([^}]+)\}", e) and set(re.findall(r"\{@([^}]+)\}", e)) <= ids
                        and not re.search(r"\{[^@]", e) for e in exprs.values())
            row("every formula is stored by the ids of the template's numbers", "PASS" if by_id else "FAIL", saw=exprs)
        else:
            row("not one formula definition was requested", "PASS" if not formula_posts else "FAIL",
                saw=len(formula_posts))
        bad_api = [e for e in rec["api_log"] if e["status"] >= 400]
        row("no /api/ response so far is a 4xx or 5xx", "PASS" if not bad_api else "FAIL", saw=bad_api[:5])

        shown = pg.locator("li[data-prop-row]").evaluate_all("els => els.map(e => e.getAttribute('data-prop-row'))")
        want_ids = [by[n]["id"] for n in want_names if n in by]
        row("the new note shows the template's properties while they are empty",
            "PASS" if set(want_ids) <= set(shown) else "FAIL",
            saw=[next((n for n, d in by.items() if d["id"] == i), i) for i in shown])

        # ── 2. type the numbers, keyboard only ──────────────────────────────────
        vals1 = {"Entry": 100, "Stop": 95, "Shares": 50, "Account size": 10000}
        for name, v in vals1.items():
            type_number(by[name]["id"], name, v)
        if on:
            row("Risk per share computes to 5 (Entry 100, Stop 95)", "PASS",
                saw=wait_value(pg.locator(f'li[data-prop-row="{by["Risk per share"]["id"]}"]'), "5"))
            row("Position size % computes to 50 (50 x 100 / 10,000)", "PASS",
                saw=wait_value(pg.locator(f'li[data-prop-row="{by["Position size %"]["id"]}"]'), "50"))
        type_number(by["Exit"]["id"], "Exit", 110)
        if on:
            row("R-multiple computes to 2 once Exit 110 is typed", "PASS",
                saw=wait_value(pg.locator(f'li[data-prop-row="{by["R-multiple"]["id"]}"]'), "2"))
        pg.wait_for_timeout(800)
        props = {p["name"]: p.get("value") for p in req.get(f"{base}/api/j2/notes/{n1}/properties").json()["properties"]}
        want_vals = {**vals1, "Exit": 110}
        row("the server holds every typed number on the tracker",
            "PASS" if all(props.get(k) == v for k, v in want_vals.items()) else "FAIL",
            saw={k: props.get(k) for k in want_vals})
        if on:
            row("the server computes the same three values", "PASS"
                if (props.get("R-multiple"), props.get("Risk per share"), props.get("Position size %")) == (2, 5, 50)
                else "FAIL", saw={k: props.get(k) for k in FORMULAS})
        shot(pg, "tracker-filled")

        if not on:
            bad_api = [e for e in rec["api_log"] if e["status"] >= 400]
            row("no /api/ response in the whole walk is a 4xx or 5xx", "PASS" if not bad_api else "FAIL",
                saw=bad_api[:5])
            row("no uncaught page error during the walk", "PASS" if not errors else "FAIL", saw=errors[:5])
            browser.close()
            return

        # ── 3. a second tracker through the deep link: everything is reused ─────
        pg.goto(f"{base}/journal/notebook?new=position-tracker", wait_until="domcontentloaded", timeout=45000)
        ph._dismiss_intro(pg)
        n2 = opened_note_id()
        rec["notes"]["n2"] = n2
        pg.wait_for_timeout(1000)
        defs2 = defs_by_name()
        row("a second tracker (?new= deep link) reuses every definition: still eight, no duplicate name",
            "PASS" if len(defs2) == 8 and {d["id"] for d in defs2} == {d["id"] for d in defs} else "FAIL",
            saw=sorted(d["name"] for d in defs2))
        for name, v in (("Entry", 50), ("Stop", 45), ("Exit", 45), ("Shares", 100), ("Account size", 10000)):
            type_number(by[name]["id"], name, v)
        row("the second tracker's R-multiple computes to -1 (stopped out)", "PASS",
            saw=wait_value(pg.locator(f'li[data-prop-row="{by["R-multiple"]["id"]}"]'), "-1"))
        shot(pg, "tracker2-filled")

        # A third position through HTTP only (R 3), so the sort has three rows to order.
        tag = dt.datetime.now().strftime("%H%M%S")
        r = req.post(base + "/api/j2/notes", data={"title": f"Position fixture {tag}",
                                                    "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
        if r.status not in (200, 201):
            raise RuntimeError(f"fixture note: HTTP {r.status} {r.text()[:200]}")
        n3 = r.json()["note"]["id"]
        r = req.put(f"{base}/api/j2/notes/{n3}", data={"properties": {
            by["Entry"]["id"]: 20, by["Stop"]["id"]: 18, by["Exit"]["id"]: 26}})
        if r.status != 200:
            raise RuntimeError(f"fixture values: HTTP {r.status} {r.text()[:200]}")
        rec["notes"]["n3"] = n3
        row("a third position (R 3) through the sandbox's HTTP doors", "PASS")

        # ── 4. the table view, sorted by R-multiple ────────────────────────────
        pg.goto(f"{base}/journal/notebook?view=all", wait_until="domcontentloaded", timeout=45000)
        ph._dismiss_intro(pg)
        tbtn = pg.get_by_role("button", name="Table view").filter(visible=True).first
        tbtn.wait_for(state="visible", timeout=20000)
        tbtn.focus()
        kb(pg, "switch to the table view", "Enter")
        sort_btn = pg.get_by_role("button", name=re.compile(r"^R-multiple")).filter(visible=True).first
        sort_btn.wait_for(state="visible", timeout=15000)
        shot(pg, "table")
        mine = {n1: "n1(R 2)", n2: "n2(R -1)", n3: "n3(R 3)"}

        def order():
            ids = pg.locator("table tbody tr[data-note-card-id]").evaluate_all(
                "els => els.map(e => e.getAttribute('data-note-card-id'))")
            return [mine[i] for i in ids if i in mine]

        def sort_to(direction: str):
            pg.get_by_role("button", name=re.compile(r"^R-multiple")).filter(visible=True).first.focus()
            kb(pg, f"sort by R-multiple ({direction})", "Enter")
            pg.wait_for_function(
                "(d) => { const th = [...document.querySelectorAll('th')].find(t => t.textContent.startsWith('R-multiple'));"
                " return th && th.getAttribute('aria-sort') === d }", arg=direction, timeout=15000)
            pg.wait_for_timeout(1200)

        sort_to("ascending")
        asc = order()
        row("Enter on the R-multiple header sorts ascending: -1, 2, 3",
            "PASS" if asc == ["n2(R -1)", "n1(R 2)", "n3(R 3)"] else "FAIL", saw=asc)
        shot(pg, "table-sorted-asc")
        sort_to("descending")
        desc = order()
        row("Enter again sorts descending: 3, 2, -1",
            "PASS" if desc == ["n3(R 3)", "n1(R 2)", "n2(R -1)"] else "FAIL", saw=desc)
        shot(pg, "table-sorted-desc")
        bad_api = [e for e in rec["api_log"] if e["status"] >= 400]
        row("no /api/ response in the whole walk is a 4xx or 5xx", "PASS" if not bad_api else "FAIL", saw=bad_api[:5])
        row("no uncaught page error during the walk", "PASS" if not errors else "FAIL", saw=errors[:5])
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
