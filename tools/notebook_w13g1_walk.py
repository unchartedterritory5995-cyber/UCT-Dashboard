"""Wave 13 lane 13G-1 -- the real-browser walk for research capture (a transcript passage saved
into a note as a cited excerpt, and the passed-setups journal).

It OWNS its sandbox (tools/notebook_perf_harness.py's `Sandbox`: scripts/hub_sandbox_boot.py through
the SIGBREAK shim, its own process group, stopped gracefully so the launcher's `finally` writes the
SHUTDOWN checkpoint). It writes RAW evidence only (walk.json, screenshots, the API reads it took)
and draws no conclusion beyond each row's own PASS/FAIL.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. The two stores it seeds before the boot -- the stored
transcript index (`transcript_index.db`) and the daily bars (`bars.db`) -- are written by a CHILD
process that first applies the sandbox's own census pins (`hub_sandbox_boot.apply_sandbox_env`,
which also arms the shared-root tripwire). The last row asserts the driver's `sys.modules`.

⛔ NOTHING IS FETCHED. Provider keys (FMP, Finnhub, AlphaVantage) are blanked for the boot: the
transcript is the one the child stored, the bars are the ones the child stored. Everything else
goes through the product's own routes (the member's note, the scanner capture in a note, a
position).

Run from PowerShell (a Windows path through the Bash tool loses its backslash), ports 8630-8634:

    python tools/notebook_w13g1_walk.py --data-dir '<scratch>\\w13g1-walk-data' --port 8630 `
        --out 'docs\\notebook\\evidence\\wave13-13g1\\walk-<sha>'

Preconditions: app/dist rebuilt from this tree (`npm run build` in app/); the port free (refused,
never killed); the data dir outside the shared root (refused) and EMPTY.

  W0  both gates ride the auth payload ON for the walk member
  W1  1200 px, mouse: the ticker research workspace's "Save from a transcript" -> the held call
      (FY2026 Q2, its call date) -> "Quote from turn 2" -> trim -> Save; the sheet says how it
      is cited (source, date, turn, speaker)
  W2  the cited excerpt: the note's body carries the documentExcerpt node, the excerpt reads back
      with its source + date in the document name and the turn as its page, and the EDITOR shows
      the card with that citation
  W3  keyboard: in the open note, "/transcript" + Enter opens the sheet; Tab/Enter quote turn 3
      and save; the card lands in the editor and, after the autosave, the stored body holds both
      excerpts -- and no sync-conflict copy of the note was made
  W4  a passage that is NOT on the turn is refused (422) and writes nothing
  W5  390 px, touch: the sheet fits (no sideways scroll, controls >= 44 px), a tap quotes turn 4,
      the cited line shows
  W6  1200 px: Research Home's Passed setups lists NVDA from a SCANNER CAPTURE in a note, scored
      +1/+5/+10/+20 and best-in-20 exactly as the seeded bars say
  W7  keyboard: add PLTR (bars stop after 3 sessions) and ZZZZ (no bars) by hand: PLTR's +5 reads
      "Bars missing from the store", ZZZZ says it has no stored bars -- no number is invented
  W8  a name the member traded within 10 sessions (TSLA) leaves the list and is counted
  W9  390 px, touch: Passed setups fits, its controls are >= 44 px, a tap removes a row
  W10 both gates OFF in the client: no transcript door, no Passed setups, no research-capture request
  W11 no unforced page errors
  W12 the driver never imported api.*

Exit: 0 = every row PASS and integrity CLEAN; 1 = a row FAILED; 2 = integrity not CLEAN;
3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)

MEMBER = ("w13g1@local.dev", "LocalTest2026!", "w13g1")
FLAGS = ("notebook_transcript_capture_enabled", "notebook_passed_setups_enabled")
PORTS = range(8630, 8635)

CONTENT = (
    "Operator: Good afternoon. Welcome to the NVIDIA second quarter call.\n"
    "Colette Kress: Revenue was a record, up 56% year over year. Data center revenue grew\n"
    "sequentially, and gross margin was 72.4%.\n"
    "Jensen Huang: Blackwell demand is extraordinary. We are sold out through next year.\n"
    "Analyst One: Can you talk about supply?\n"
    "Jensen Huang: Supply is improving every quarter.\n"
)
DOC_NAME = "NVDA earnings call FY2026 Q2 · 2026-08-27 · FMP transcript"


def sessions_before(today: date, n: int) -> list[str]:
    """The last `n` weekdays strictly before `today`, oldest first."""
    out, d = [], today
    while len(out) < n:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            out.append(d.isoformat())
    return out[::-1]


def bars_spec(today: date) -> tuple[dict, dict]:
    days = sessions_before(today, 40)
    base_i = len(days) - 26                 # 25 sessions after the pass day are stored
    D = days[base_i]
    after = days[base_i + 1:]

    def series(start, step, n, pad):
        rows = [[D, start, start + pad]] + [[after[i], start + step * (i + 1), start + step * (i + 1) + pad]
                                            for i in range(n)]
        return rows
    spec = {
        "SPY": [[d, 500.0, 501.0] for d in days],          # the session calendar
        "NVDA": series(200.0, 2.0, 25, 1.0),               # +1 / +5 / +10 / +20 = 1 / 5 / 10 / 20 %, best 20.5 %
        "PLTR": series(50.0, 0.5, 3, 0.25),                # three sessions, then the store has no more
        "TSLA": series(300.0, 3.0, 25, 1.0),
    }
    meta = {"pass_day": D, "after": after[:25]}
    return spec, meta


class Walk:
    def __init__(self, out: Path):
        self.out = out
        self.rows: list[dict] = []
        self.raw: dict = {}

    def record(self, rid, ok, detail):
        self.rows.append({"id": rid, "verdict": "PASS" if ok else "FAIL", "detail": detail})
        print(f"  {rid}: {'PASS' if ok else 'FAIL'} -- {detail}", flush=True)

    def shot(self, pg, name):
        p = self.out / f"{name}.png"
        pg.screenshot(path=str(p), full_page=True)
        return p.name

    def dump(self, name, data):
        (self.out / name).write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")


SEED_CHILD = r'''
import json, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services import transcript_index, bars_sqlite
transcript_index.put("NVDA", 2026, 2, "2026-08-27", spec["content"])
bars_sqlite.init_db()
c = bars_sqlite._conn()
n = 0
for sym, rows in spec["bars"].items():
    for day, close, high in rows:
        c.execute("INSERT OR REPLACE INTO ohlcv (ticker, tf, ts, o, h, l, c, v) VALUES (?,?,?,?,?,?,?,?)",
                  (sym, "D", int(day.replace("-", "")), close, high, close - 1.0, close, 1000000))
        n += 1
c.commit()
print("SEEDED", transcript_index.DB_PATH, bars_sqlite._DB_PATH, n)
'''


def seed_stores(data_dir: Path, spec: dict, out: Path) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", SEED_CHILD, str(REPO), str(data_dir), json.dumps(spec)],
                       cwd=str(REPO), env=env, capture_output=True, text=True, timeout=600)
    (out / "seed-child.log").write_text((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or "")[-6000:],
                                        encoding="utf-8")
    line = [l for l in (r.stdout or "").splitlines() if l.startswith("SEEDED")]
    if r.returncode != 0 or not line:
        raise h.SetupFailed(f"seeding the stores failed (rc {r.returncode}); see seed-child.log")
    if str(data_dir).lower() not in line[-1].lower():
        raise h.SetupFailed(f"a seeded store resolved outside the sandbox: {line[-1]}")
    return line[-1]


def tab_to(pg, js_predicate: str, limit: int = 120) -> int:
    for i in range(1, limit + 1):
        pg.keyboard.press("Tab")
        if pg.evaluate(f"(() => {{ const el = document.activeElement; return !!(el && ({js_predicate})) }})()"):
            return i
    return -1


def name_is(text: str) -> str:
    t = json.dumps(text)
    return f"((el.getAttribute('aria-label') || el.textContent || '').trim() === {t})"


def note_excerpt_ids(req, base, nid):
    r = req.get(f"{base}/api/j2/notes/{nid}")
    body = (r.json().get("note") or {}).get("bodyJson") or {} if r.status == 200 else {}
    return [((n.get("attrs") or {}).get("excerptId")) for n in body.get("content") or []
            if n.get("type") == "documentExcerpt"]


def all_notes(req, base):
    r = req.get(base + "/api/j2/notes?limit=500")
    return (r.json().get("notes") or []) if r.status == 200 else []


def geometry(pg, sel_buttons: str) -> dict:
    return pg.evaluate("""(sel) => {
        const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || e.getClientRects().length);
        const hs = els.map((e) => Math.round(e.getBoundingClientRect().height));
        return {sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
                count: els.length, minH: hs.length ? Math.min(...hs) : null, heights: hs.slice(0, 20)}
    }""", sel_buttons)


def pct_text(v: float) -> str:
    return f"{'+' if v > 0 else ''}{v:.1f}%"


def row_cells(pg, sym: str) -> dict:
    return pg.evaluate("""(sym) => {
        const li = document.querySelector(`[data-passed-symbol="${sym}"]`)
        if (!li) return null
        const out = {}
        li.querySelectorAll('[data-outcome]').forEach((c) => {
            out[c.dataset.outcome] = c.lastElementChild ? c.lastElementChild.textContent : c.textContent })
        const nb = li.querySelector('[data-no-bars]')
        return {cells: out, noBars: nb ? nb.textContent : null, text: li.innerText}
    }""", sym)


def run(base: str, w: Walk, meta: dict) -> None:
    from playwright.sync_api import sync_playwright
    D = meta["pass_day"]
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
        req = ctx.request
        h._provision(admin_ctx.request, req, base, member=MEMBER)
        me = req.get(base + "/api/auth/me").json()
        w.raw["auth_me_flags"] = {k: me.get(k) for k in FLAGS}
        w.record("W0_gates_on_payload", all(me.get(k) is True for k in FLAGS), f"/api/auth/me {w.raw['auth_me_flags']}")

        # The member's note and a scanner capture saved into a note, through the product's routes.
        note = req.post(base + "/api/j2/notes", data={
            "title": "NVDA thesis (walk)", "ticker": "NVDA",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": "The call is the story."}]}]}})
        thesis = note.json()["note"]["id"] if note.status in (200, 201) else None
        captured_at = f"{D}T21:30:00+00:00"            # after that day's close (17:30 ET)
        scan = req.post(base + "/api/j2/notes", data={
            "title": "Gainers scan (walk)",
            "bodyJson": {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": {
                "widgetId": "scanner", "capturedAt": captured_at, "mode": "snapshot",
                "params": {"scanKey": "gainers", "scanName": "Gainers", "rows": [{"sym": "NVDA"}]}}}]}})
        pos = req.post(base + "/api/j2/positions", data={
            "symbol": "TSLA", "side": "Long", "entryDate": meta["after"][4],
            "shares": 10, "entryPrice": 315.0, "stopPrice": 300.0})
        w.raw["seed_http"] = {"thesis": note.status, "scan_note": scan.status, "position": pos.status,
                              "thesis_id": thesis}
        if not (thesis and scan.status in (200, 201) and pos.status in (200, 201)):
            raise h.SetupFailed(f"seeding the member's notes failed: {w.raw['seed_http']}")

        errors: list[str] = []
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))

        # ── W1: the workspace door, by mouse at 1200 ──────────────────────────────────────
        pg.goto(base + "/journal/notebook/research/NVDA", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        door = pg.get_by_role("button", name="Save from a transcript")
        door.wait_for(state="visible", timeout=90000)
        w.shot(pg, "W1a-workspace-1200")
        door.click()
        sheet = pg.locator("[data-save-transcript]")
        sheet.wait_for(state="visible", timeout=30000)
        pg.get_by_role("button", name="Quote from turn 2").wait_for(state="visible", timeout=30000)
        quarter_opt = pg.get_by_role("combobox", name="Call quarter").evaluate(
            "(s) => s.options[s.selectedIndex].textContent")
        source_line = sheet.locator("p").filter(has_text="FMP transcript").first.inner_text()
        pg.get_by_role("button", name="Quote from turn 2").click()
        box = pg.get_by_label("Passage from turn 2", exact=False)
        prefilled = box.input_value()
        box.fill("gross margin was 72.4%")
        pg.get_by_role("button", name="Save passage").click()
        done = pg.locator("[data-saved-excerpt]")
        done.wait_for(state="visible", timeout=30000)
        cited = done.inner_text()
        w.raw["W1"] = {"quarter_option": quarter_opt, "source_line": source_line, "prefilled": prefilled,
                       "cited": cited, "excerpt_id": done.get_attribute("data-saved-excerpt")}
        ok1 = (quarter_opt == "FY2026 Q2 · 2026-08-27" and "call of 2026-08-27" in source_line
               and prefilled.startswith("Revenue was a record") and not prefilled.startswith("Colette")
               and f"Cited as {DOC_NAME} · turn 2 (Colette Kress)" in cited)
        w.record("W1_save_passage_1200", ok1, f"option={quarter_opt!r}; cited={cited!r}")
        w.shot(pg, "W1b-saved-1200")
        ex1 = w.raw["W1"]["excerpt_id"]

        # ── W2: the cited excerpt, stored and rendered ────────────────────────────────────
        exs = req.get(f"{base}/api/j2/notes/{thesis}/excerpts").json().get("excerpts") or []
        w.dump("excerpts-after-W1.json", exs)
        stored = next((e for e in exs if e["id"] == ex1), {})
        pg.goto(f"{base}/journal/notebook?note={thesis}", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        card = pg.locator("[data-document-excerpt]").first
        card.wait_for(state="visible", timeout=60000)
        pg.locator("button[data-type='documentExcerptCitation']").first.wait_for(state="visible", timeout=30000)
        card_text = card.inner_text()
        w.raw["W2"] = {"stored": stored, "card_text": card_text, "body_excerpts": note_excerpt_ids(req, base, thesis)}
        ok2 = (stored.get("documentName") == DOC_NAME and stored.get("pageNumber") == 2
               and stored.get("capturedText") == "gross margin was 72.4%" and stored.get("sourceKind") == "web"
               and ex1 in w.raw["W2"]["body_excerpts"]
               and "gross margin was 72.4%" in card_text and f"{DOC_NAME} · p.2" in card_text)
        w.record("W2_cited_excerpt_in_note", ok2, f"stored page={stored.get('pageNumber')} name={stored.get('documentName')!r}; "
                 f"card={card_text!r}")
        w.shot(pg, "W2-note-card-1200")

        # ── W3: keyboard, the editor's /transcript insert ─────────────────────────────────
        pm = pg.locator(".ProseMirror").first
        pm.click()
        pg.keyboard.press("Control+End")
        pg.keyboard.press("Enter")
        pg.keyboard.type("/transcript")
        pg.get_by_text("Transcript passage", exact=True).first.wait_for(state="visible", timeout=20000)
        pg.keyboard.press("Enter")
        pg.locator("[data-save-transcript]").wait_for(state="visible", timeout=30000)
        pg.get_by_role("button", name="Quote from turn 3").wait_for(state="visible", timeout=30000)
        presses = tab_to(pg, name_is("Quote from turn 3"))
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(300)
        focus_is_passage = pg.evaluate("document.activeElement && document.activeElement.id === 'tc-passage'")
        presses_save = tab_to(pg, name_is("Save passage"), limit=10)
        pg.keyboard.press("Enter")
        pg.locator("[data-saved-excerpt]").wait_for(state="visible", timeout=30000)
        ex2 = pg.locator("[data-saved-excerpt]").get_attribute("data-saved-excerpt")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(500)
        cards = pg.locator("[data-document-excerpt]")
        try:
            pg.wait_for_function("() => document.querySelectorAll('[data-document-excerpt]').length >= 2", timeout=20000)
        except Exception:  # noqa: BLE001 -- the count below records it
            pass
        n_cards = cards.count()
        # Let the autosave land, then read the stored body and the note list.
        deadline = time.time() + 30
        body_ids = []
        while time.time() < deadline:
            body_ids = note_excerpt_ids(req, base, thesis)
            if ex2 in body_ids and ex1 in body_ids:
                break
            pg.wait_for_timeout(1000)
        pg.wait_for_timeout(2500)
        body_ids = note_excerpt_ids(req, base, thesis)
        notes_now = all_notes(req, base)
        forks = [n for n in notes_now if "sync-conflict" in (n.get("tags") or [])]
        w.raw["W3"] = {"tab_presses_to_turn3": presses, "focus_on_passage_after_enter": focus_is_passage,
                       "tab_presses_to_save": presses_save, "excerpt_id": ex2, "editor_cards": n_cards,
                       "stored_body_excerpts": body_ids, "notes": [(n["id"], n.get("title"), n.get("tags")) for n in notes_now]}
        ok3 = (presses > 0 and presses_save > 0 and bool(ex2) and n_cards >= 2
               and ex1 in body_ids and ex2 in body_ids and len(body_ids) == len(set(body_ids)) and not forks)
        w.record("W3_keyboard_slash_insert", ok3, f"{presses} Tabs to turn 3, {presses_save} to Save; editor cards={n_cards}; "
                 f"stored body excerpts={body_ids}; sync-conflict copies={len(forks)}")
        w.shot(pg, "W3-editor-two-cards-1200")

        # ── W4: a passage not on the turn is refused and writes nothing ──────────────────
        before = len(req.get(f"{base}/api/j2/notes/{thesis}/excerpts").json().get("excerpts") or [])
        bad = req.post(base + "/api/j2/research-capture/transcripts/save", data={
            "noteId": thesis, "symbol": "NVDA", "quarter": "2026Q2", "turn": 2, "passage": "gross margin was 75.0%"})
        after = len(req.get(f"{base}/api/j2/notes/{thesis}/excerpts").json().get("excerpts") or [])
        w.raw["W4"] = {"status": bad.status, "body": bad.json() if bad.status != 200 else None, "before": before, "after": after}
        w.record("W4_altered_quote_refused", bad.status == 422 and before == after,
                 f"status {bad.status}; excerpts {before} -> {after}; detail={w.raw['W4']['body']}")

        # ── W6/W7/W8: Passed setups at 1200 ───────────────────────────────────────────────
        pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        pg.get_by_role("heading", name="Passed setups").wait_for(state="visible", timeout=60000)
        pg.locator('[data-passed-symbol="NVDA"]').wait_for(state="visible", timeout=60000)
        nv = row_cells(pg, "NVDA")
        api_list = req.get(base + "/api/j2/research-capture/passed-setups").json()
        w.dump("passed-setups-1.json", api_list)
        expect_nv = {"r1": pct_text(1.0), "r5": pct_text(5.0), "r10": pct_text(10.0), "r20": pct_text(20.0),
                     "best20": pct_text(20.5)}
        nv_item = next((i for i in api_list.get("items", []) if i["symbol"] == "NVDA"), {})
        w.raw["W6"] = {"row": nv, "expected": expect_nv, "item": nv_item}
        ok6 = (nv and nv["cells"] == expect_nv and nv_item.get("source") == "scanner"
               and nv_item.get("baseDate") == D and "Scanner" in nv["text"])
        w.record("W6_scanner_capture_scored_1200", bool(ok6), f"NVDA cells={nv and nv['cells']}; source={nv_item.get('source')}; "
                 f"from the {nv_item.get('baseDate')} close")
        w.shot(pg, "W6-passed-setups-1200")

        # keyboard: type a ticker, set the day, Enter submits the form
        def add_by_keyboard(sym, day):
            tick = pg.get_by_label("Ticker you passed on")
            tick.focus()
            pg.keyboard.type(sym)
            pg.get_by_label("Day you passed on it").fill(day)
            tick.focus()
            pg.keyboard.press("Enter")
            pg.locator(f'[data-passed-symbol="{sym}"]').wait_for(state="attached", timeout=30000)
        for sym in ("PLTR", "ZZZZ", "TSLA"):
            try:
                add_by_keyboard(sym, D)
            except Exception as e:  # noqa: BLE001 -- TSLA must NOT appear; recorded below
                w.raw[f"W7_add_{sym}_wait"] = str(e)[:200]
        pg.wait_for_timeout(1500)
        pl, zz = row_cells(pg, "PLTR"), row_cells(pg, "ZZZZ")
        w.raw["W7"] = {"PLTR": pl, "ZZZZ": zz}
        ok7 = (pl and pl["cells"].get("r1") == pct_text(1.0) and pl["cells"].get("r5") == "Bars missing from the store"
               and pl["cells"].get("best20") == "Bars missing from the store"
               and zz and zz["noBars"] == "No stored daily bars for this name on or before the save."
               and not zz["cells"])
        w.record("W7_gaps_labelled_never_invented", bool(ok7), f"PLTR={pl and pl['cells']}; ZZZZ={zz and zz['noBars']!r}")
        traded_note = pg.get_by_role("note").filter(has_text="traded within").first
        traded_text = traded_note.inner_text() if traded_note.count() else ""
        tsla_listed = pg.locator('[data-passed-symbol="TSLA"]').count()
        api2 = req.get(base + "/api/j2/research-capture/passed-setups").json()
        w.dump("passed-setups-2.json", api2)
        w.raw["W8"] = {"traded_note": traded_text, "tsla_rows": tsla_listed, "tradedCount": api2.get("tradedCount")}
        w.record("W8_traded_leaves_the_list", tsla_listed == 0 and api2.get("tradedCount") == 1
                 and traded_text == "1 name you traded within 10 sessions of saving is not listed.",
                 f"TSLA rows={tsla_listed}; tradedCount={api2.get('tradedCount')}; note={traded_text!r}")
        w.shot(pg, "W7-W8-passed-setups-1200")

        # ── W5 + W9: 390 px, touch ────────────────────────────────────────────────────────
        state = ctx.storage_state()
        phone = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                               reduced_motion="reduce", storage_state=state)
        pp = phone.new_page()
        pp.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pp.goto(base + "/journal/notebook/research/NVDA", wait_until="domcontentloaded")
        h._dismiss_intro(pp)
        pdoor = pp.get_by_role("button", name="Save from a transcript")
        pdoor.wait_for(state="visible", timeout=90000)
        pdoor.tap()
        pp.get_by_role("button", name="Quote from turn 4").wait_for(state="visible", timeout=30000)
        g5 = geometry(pp, "[data-save-transcript] button, [data-save-transcript] select, [data-save-transcript] input")
        w.shot(pp, "W5a-sheet-390")
        pp.get_by_role("button", name="Quote from turn 4").tap()
        pp.get_by_role("button", name="Save passage").tap()
        pp.locator("[data-saved-excerpt]").wait_for(state="visible", timeout=30000)
        cited5 = pp.locator("[data-saved-excerpt]").inner_text()
        w.shot(pp, "W5b-saved-390")
        w.raw["W5"] = {"geometry": g5, "cited": cited5}
        ok5 = (g5["sw"] <= g5["cw"] + 1 and g5["minH"] is not None and g5["minH"] >= 44
               and f"{DOC_NAME} · turn 4 (Analyst One)" in cited5)
        w.record("W5_phone_390_transcript", ok5, f"scrollWidth {g5['sw']} vs {g5['cw']}; min control height {g5['minH']}; cited={cited5!r}")

        pp.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        h._dismiss_intro(pp)
        pp.locator('[data-passed-symbol="NVDA"]').wait_for(state="visible", timeout=60000)
        pp.locator('[data-passed-setups]').scroll_into_view_if_needed()
        g9 = geometry(pp, "[data-passed-setups] button, [data-passed-setups] input")
        w.shot(pp, "W9a-passed-setups-390")
        nv390 = row_cells(pp, "NVDA")
        pp.get_by_role("button", name="Remove ZZZZ from passed setups").tap()
        try:
            pp.wait_for_function("() => !document.querySelector('[data-passed-symbol=\"ZZZZ\"]')", timeout=20000)
            removed = True
        except Exception:  # noqa: BLE001
            removed = False
        w.shot(pp, "W9b-removed-390")
        w.raw["W9"] = {"geometry": g9, "nvda_cells": nv390 and nv390["cells"], "removed_ZZZZ": removed}
        ok9 = (g9["sw"] <= g9["cw"] + 1 and g9["minH"] is not None and g9["minH"] >= 44 and removed
               and nv390 and nv390["cells"] == expect_nv)
        w.record("W9_phone_390_passed", ok9, f"scrollWidth {g9['sw']} vs {g9['cw']}; min control height {g9['minH']}; "
                 f"ZZZZ removed={removed}")
        phone.close()

        # ── W10: both gates OFF in the client ─────────────────────────────────────────────
        rc_requests: list[str] = []
        off = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce", storage_state=state)

        def fake_me(route):
            resp = route.fetch()
            data = resp.json()
            for k in FLAGS:
                data[k] = False
            route.fulfill(response=resp, body=json.dumps(data), headers={**resp.headers, "content-type": "application/json"})
        off.route("**/api/auth/me", fake_me)
        po = off.new_page()
        po.on("request", lambda r: rc_requests.append(r.url) if "/api/j2/research-capture/" in r.url else None)
        po.on("pageerror", lambda e: errors.append(str(e)[:300]))
        po.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        h._dismiss_intro(po)
        po.get_by_role("heading", name="Continue working").first.wait_for(state="visible", timeout=60000)
        po.wait_for_timeout(2500)
        no_passed = po.get_by_role("heading", name="Passed setups").count() == 0
        po.goto(base + "/journal/notebook/research/NVDA", wait_until="domcontentloaded")
        po.get_by_role("heading", name="NVDA", exact=True).first.wait_for(state="visible", timeout=90000)
        po.wait_for_timeout(1500)
        no_door = po.get_by_role("button", name="Save from a transcript").count() == 0
        w.shot(po, "W10-gates-off-1200")
        off.close()
        w.raw["W10"] = {"no_passed": no_passed, "no_door": no_door, "requests": rc_requests}
        w.record("W10_gates_off_client", no_passed and no_door and not rc_requests,
                 f"Passed setups absent={no_passed}; transcript door absent={no_door}; research-capture requests={rc_requests}")

        w.record("W11_no_page_errors", not errors, f"{len(errors)} unforced page errors" + (f": {errors[:3]}" if errors else ""))
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8630)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port not in PORTS:
        print("REFUSED: this lane's walk uses ports 8630-8634 only")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this walk never kills it")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty -- a re-run must not inherit a previous run's notes")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    w = Walk(out)

    spec_bars, meta = bars_spec(date.today())
    w.raw["meta"] = meta
    not_run = failure = None
    try:
        w.raw["seed_child"] = seed_stores(data_dir, {"content": CONTENT, "bars": spec_bars}, out)
    except h.SetupFailed as e:
        not_run = str(e)

    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    # ⛔ Written for the CHILD (Popen inherits it), never read here: the gates' one parse lives in
    # the app (notebook_flags.flag_on). Provider keys are blanked so nothing can be fetched.
    os.environ.update({"NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED": "1", "NOTEBOOK_PASSED_SETUPS_ENABLED": "1",
                       "FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "",
                       "ALPHA_VANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    if not not_run:
        box.start()
        try:
            if not box.wait_healthy(base, 300):
                failure = "the sandbox never answered /api/health"
            else:
                try:
                    run(base, w, meta)
                except h.SetupFailed as e:
                    not_run = str(e)[:300]
                except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
                    import traceback
                    failure = f"the walk raised {type(e).__name__}: {str(e)[:400]}"
                    w.raw["traceback"] = traceback.format_exc()[-3000:]
                box.wait_checkpoint(h.POST_BOOT, 60)
        finally:
            box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN]) if not not_run or box.proc else {"clean": False, "status": "NOT BOOTED"}
    if box.proc:
        h._keep_integrity_log(integ, out / "integrity.md", own=True)
        print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    w.record("W12_driver_never_imported_api", not api_mods,
             "no api.* module in the driver's sys.modules" if not api_mods else f"imported: {api_mods[:5]}")
    result = {"tool": "tools/notebook_w13g1_walk.py", "base": base, "integrity": integ, "failure": failure,
              "not_run": not_run, "rows": w.rows, "raw": w.raw}
    (out / "walk.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT: FAIL -- {failure}")
        return 1
    if any(r["verdict"] != "PASS" for r in w.rows):
        print("VERDICT: FAIL -- " + ", ".join(r["id"] for r in w.rows if r["verdict"] != "PASS"))
        return 1
    if not integ.get("clean"):
        print(f"VERDICT: INTEGRITY {integ.get('status')}")
        return 2
    print(f"VERDICT: PASS -- {len(w.rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
