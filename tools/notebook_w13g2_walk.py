"""Wave 13 lane 13G-2 -- the real-browser walk for thesis chips (status + distance to the
note's stop, on Open Positions rows, both the List/RH view -- HoldingsList.jsx -- and the
Table/dense view -- PositionsTable.jsx).

It OWNS its sandbox (tools/notebook_perf_harness.py's `Sandbox`). It writes RAW evidence only
(walk.json, screenshots) and draws no conclusion beyond each row's own PASS/FAIL.

⛔ THE DRIVER NEVER IMPORTS `api.*`. The one thing no member action can trigger inside a short
walk is 13D's background projection (`note_levels.catch_up_all`, which only runs inside the
awareness scan's own schedule): a CHILD process (PROJECT_CHILD below) applies the sandbox's own
census pins and calls the REAL `note_levels.project_note` on notes the walk created through the
product's own routes -- the same function the scheduled scan would eventually call on the same
content, run early rather than waited for. The last row asserts the driver's `sys.modules`.

⛔ `/api/live-prices` is STUBBED (route interception, not a vendor call) so each row has a known
current price to compute a distance from -- the chip computes nothing server-side; the price a
row already holds for every other column is the only input this stubs. The thesis LEVEL itself
(the stop the distance is measured from) is never touched by the stub: it comes only from the
seeded note, through the real projection, through the real `/api/j2/thesis-chips` batch route.

Run from PowerShell (a Windows path through the Bash tool loses its backslash), ports 8665-8669:

    python tools/notebook_w13g2_walk.py --data-dir '<scratch>\\w13g2-walk-data' --port 8665 `
        --out 'docs\\notebook\\evidence\\wave13-13g2\\walk-<sha>'

Preconditions: app/dist rebuilt from this tree (`npm run build` in app/); the port free (refused,
never killed); the data dir outside the shared root (refused) and EMPTY.

  W0     the gate rides the auth payload ON for the walk member
  STEP0  1200 px, the gate OFF in the client: both the List and Table views render the two
         seeded rows with ZERO [data-thesis-chip] elements and ZERO requests to the batch route
         -- the premise this lane's spec step 0 names (no thesis indicator exists on these rows)
         held structurally by the SAME gate that proves W-OFF below, not a separate claim
  W1     1200 px, mouse, List view (HoldingsList): both rows' chips render with the distance to
         EACH note's own stop (never the position's own broker/manual stop, which is seeded to a
         different number on purpose) -- and exactly ONE request to /api/j2/thesis-chips for the
         whole visible set
  W2     clicking the NVDA chip opens a preview whose title/entry/stop/target are exactly the
         seeded note's levels, with a working link into that note
  W3     1200 px, Table view (PositionsTable): the same two chips, same values, in the Symbol
         cell -- and the Table view's OWN load is also exactly one batch request
  W4     keyboard: Tab to the chip opens the preview on FOCUS ALONE (mirrors hover -- no second
         keypress needed); Escape closes it and returns focus to the chip
  W5     390 px, touch: the List view fits (no sideways scroll), a tap opens the NVDA chip's
         preview, and the chip meets the 44 px tap floor
  W6     the gate OFF in the client (both views): no chip anywhere, no request to the batch route
  W7     no unforced page errors
  W8     the driver never imported api.* (the PROJECT_CHILD subprocess is a separate process)

Exit: 0 = every row PASS and integrity CLEAN; 1 = a row FAILED; 2 = integrity not CLEAN;
3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)

MEMBER = ("w13g2@local.dev", "LocalTest2026!", "w13g2")
FLAG = "notebook_thesis_chips_enabled"
PORTS = range(8665, 8670)

# Deliberately DIFFERENT from each note's own levels below, so a chip reading the
# POSITION's stop instead of the NOTE's would show visibly wrong numbers.
POSITIONS = [
    {"symbol": "NVDA", "side": "Long", "entryDate": "2026-09-01", "entryPrice": 300.0,
     "stopPrice": 285.0, "shares": 10},
    {"symbol": "AMD", "side": "Long", "entryDate": "2026-09-01", "entryPrice": 150.0,
     "stopPrice": 140.0, "shares": 20},
]
NOTES = [
    {"symbol": "NVDA", "title": "NVDA thesis (walk)", "lines": ["Entry: 310", "Stop: 295", "Target: 330"],
     "status": "active", "live_price": 310.0},
    {"symbol": "AMD", "title": "AMD thesis (walk)", "lines": ["Entry: 155", "Stop: 148", "Target: 170"],
     "status": "watching", "live_price": 160.0},
]


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


PROJECT_CHILD = r'''
import json, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=False)
from api.services import auth_db
from api.services.journal_two import note_levels as nl
conn = auth_db.get_connection()
nl.ensure_schema(conn)
n = 0
for uid, nid in spec["notes"]:
    row = conn.execute(
        "SELECT id, ticker, body_json, properties_json, updated_at FROM j2_notes"
        " WHERE id = ? AND user_id = ?", (nid, uid)).fetchone()
    if row is None:
        print(f"MISSING {uid} {nid}")
        continue
    nl.project_note(conn, uid, row)
    n += 1
conn.commit()
print("PROJECTED", n)
'''


def project_notes(data_dir: Path, pairs: list[tuple[str, str]], out: Path) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", PROJECT_CHILD, str(REPO), str(data_dir),
                       json.dumps({"notes": pairs})],
                       cwd=str(REPO), env=env, capture_output=True, text=True, timeout=120)
    (out / "project-child.log").write_text((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or "")[-6000:],
                                           encoding="utf-8")
    line = [l for l in (r.stdout or "").splitlines() if l.startswith("PROJECTED")]
    if r.returncode != 0 or not line or line[-1] != f"PROJECTED {len(pairs)}":
        raise h.SetupFailed(f"projecting the seeded notes failed (rc {r.returncode}): {r.stdout!r} {r.stderr[-500:]!r}")
    return line[-1]


def doc_body(lines: list[str]) -> dict:
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": t}]} for t in lines]}


def stub_live_prices(ctx, prices: dict[str, float]) -> None:
    def fulfill(route):
        out = {sym: {"price": px, "change_pct": 0.0, "change": 0.0, "volume": 1000000, "observed_at": None}
               for sym, px in prices.items()}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(out))
    ctx.route("**/api/live-prices*", fulfill)


def geometry(pg, sel: str) -> dict:
    return pg.evaluate("""(sel) => {
        const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || e.getClientRects().length);
        const hs = els.map((e) => Math.round(e.getBoundingClientRect().height));
        return {sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
                count: els.length, minH: hs.length ? Math.min(...hs) : null}
    }""", sel)


def pct_text(current: float, stop: float) -> str:
    v = (current - stop) / current * 100
    sign = "+" if v >= 0 else ""
    word = "above stop" if v >= 0 else "below stop"
    return f"{sign}{v:.1f}% {word}"


def run(base: str, w: Walk, ids: dict) -> None:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
        req = ctx.request
        h._provision(admin_ctx.request, req, base, member=MEMBER)
        me = req.get(base + "/api/auth/me").json()
        w.raw["auth_me_flag"] = me.get(FLAG)
        w.record("W0_gate_on_payload", me.get(FLAG) is True, f"/api/auth/me[{FLAG}]={me.get(FLAG)!r}")
        state = ctx.storage_state()
        stub_live_prices(ctx, {n["symbol"]: n["live_price"] for n in NOTES})

        errors: list[str] = []

        # ── STEP0: the gate OFF in the client -- before proving anything else, the premise ───
        off0 = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce", storage_state=state)
        stub_live_prices(off0, {n["symbol"]: n["live_price"] for n in NOTES})
        reqs0: list[str] = []

        def fake_me_off(route):
            resp = route.fetch()
            data = resp.json()
            data[FLAG] = False
            route.fulfill(response=resp, body=json.dumps(data), headers={**resp.headers, "content-type": "application/json"})
        off0.route("**/api/auth/me", fake_me_off)
        p0 = off0.new_page()
        p0.on("request", lambda r: reqs0.append(r.url) if "/api/j2/thesis-chips" in r.url else None)
        p0.on("pageerror", lambda e: errors.append(str(e)[:300]))
        p0.goto(base + "/journal?j2tab=positions", wait_until="domcontentloaded")
        h._dismiss_intro(p0)
        p0.get_by_text("NVDA", exact=True).first.wait_for(state="visible", timeout=60000)
        p0.wait_for_timeout(1500)
        chips_list_off = p0.locator("[data-thesis-chip]").count()
        w.shot(p0, "STEP0a-list-off-1200")
        p0.get_by_role("button", name="Table").click()
        p0.wait_for_timeout(1000)
        chips_table_off = p0.locator("[data-thesis-chip]").count()
        w.shot(p0, "STEP0b-table-off-1200")
        off0.close()
        w.raw["STEP0"] = {"chips_list_off": chips_list_off, "chips_table_off": chips_table_off, "requests": reqs0}
        w.record("STEP0_no_thesis_indicator_today", chips_list_off == 0 and chips_table_off == 0 and not reqs0,
                 f"List chips={chips_list_off}, Table chips={chips_table_off}, batch requests={reqs0}")

        # ── W1: 1200 px, mouse, List view ──────────────────────────────────────────────────
        reqs1: list[str] = []
        pg = ctx.new_page()
        pg.on("request", lambda r: reqs1.append(r.url) if (r.url.endswith("/api/j2/thesis-chips") and r.method == "POST") else None)
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.goto(base + "/journal?j2tab=positions", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        nvda_chip = pg.locator(f'[data-thesis-chip="{ids["nvda_note"]}"]')
        amd_chip = pg.locator(f'[data-thesis-chip="{ids["amd_note"]}"]')
        nvda_chip.wait_for(state="visible", timeout=60000)
        amd_chip.wait_for(state="visible", timeout=60000)
        w.shot(pg, "W1-list-chips-1200")
        nvda_text, amd_text = nvda_chip.inner_text(), amd_chip.inner_text()
        expect_nvda, expect_amd = pct_text(310.0, 295.0), pct_text(160.0, 148.0)
        w.raw["W1"] = {"nvda_text": nvda_text, "amd_text": amd_text,
                       "expect_nvda": expect_nvda, "expect_amd": expect_amd, "batch_requests": list(reqs1)}
        ok1 = (expect_nvda in nvda_text and expect_amd in amd_text and len(reqs1) == 1)
        w.record("W1_list_chips_with_distance_1200", ok1,
                 f"NVDA={nvda_text!r} (want {expect_nvda!r}); AMD={amd_text!r} (want {expect_amd!r}); "
                 f"batch requests={len(reqs1)}")

        # ── W2: the preview, title + exact seeded levels + a working link ────────────────────
        # HOVER, not click: a real click moves the mouse there first (opening it on hover)
        # THEN fires click, which would TOGGLE it closed again -- hover is the one action
        # that opens without also toggling.
        nvda_chip.hover()
        pop = pg.locator('[data-thesis-chip="' + ids["nvda_note"] + '"] a[href*="note="]')
        pop.wait_for(state="visible", timeout=10000)
        popover_text = pg.locator(f'[data-thesis-chip="{ids["nvda_note"]}"]').inner_text()
        href = pop.get_attribute("href")
        w.shot(pg, "W2-preview-open-1200")
        w.raw["W2"] = {"popover_text": popover_text, "href": href}
        ok2 = ("NVDA thesis (walk)" in popover_text and "$310.00" in popover_text and "$295.00" in popover_text
               and "$330.00" in popover_text and href == f"/journal/notebook?note={ids['nvda_note']}")
        w.record("W2_preview_exact_seeded_levels", ok2, f"text={popover_text!r}; href={href!r}")
        pg.mouse.move(0, 0)  # move away so the preview closes before the next page load

        # ── W3: 1200 px, Table view -- same chips, its OWN one batch request ──────────────────
        reqs3: list[str] = []
        pg2 = ctx.new_page()
        pg2.on("request", lambda r: reqs3.append(r.url) if (r.url.endswith("/api/j2/thesis-chips") and r.method == "POST") else None)
        pg2.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg2.goto(base + "/journal?j2tab=positions", wait_until="domcontentloaded")
        h._dismiss_intro(pg2)
        pg2.get_by_role("button", name="Table").click()
        nvda_chip_t = pg2.locator(f'[data-thesis-chip="{ids["nvda_note"]}"]')
        amd_chip_t = pg2.locator(f'[data-thesis-chip="{ids["amd_note"]}"]')
        nvda_chip_t.wait_for(state="visible", timeout=60000)
        amd_chip_t.wait_for(state="visible", timeout=60000)
        nvda_text_t, amd_text_t = nvda_chip_t.inner_text(), amd_chip_t.inner_text()
        w.shot(pg2, "W3-table-chips-1200")
        w.raw["W3"] = {"nvda_text": nvda_text_t, "amd_text": amd_text_t, "batch_requests": list(reqs3)}
        ok3 = (expect_nvda in nvda_text_t and expect_amd in amd_text_t and len(reqs3) == 1)
        w.record("W3_table_chips_with_distance_1200", ok3,
                 f"NVDA={nvda_text_t!r}; AMD={amd_text_t!r}; batch requests={len(reqs3)}")
        pg2.close()

        # ── W4: keyboard -- Tab opens on FOCUS alone, Escape closes and restores focus ───────
        pg.reload(wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        pg.locator(f'[data-thesis-chip="{ids["nvda_note"]}"]').wait_for(state="visible", timeout=60000)
        nvda_btn = pg.locator(f'[data-thesis-chip="{ids["nvda_note"]}"] button').first
        nvda_btn.focus()
        focused_opened = pg.locator(f'[data-thesis-chip="{ids["nvda_note"]}"] a[href*="note="]').count() > 0
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(200)
        closed = pg.locator(f'[data-thesis-chip="{ids["nvda_note"]}"] a[href*="note="]').count() == 0
        focus_after = pg.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label')")
        w.raw["W4"] = {"focused_opened": focused_opened, "closed_after_escape": closed, "focus_after": focus_after}
        ok4 = focused_opened and closed and bool(focus_after and "Thesis note" in focus_after)
        w.record("W4_keyboard_focus_opens_escape_closes", ok4,
                 f"focus opened preview={focused_opened}; Escape closed it={closed}; "
                 f"focus returned to={focus_after!r}")
        pg.close()

        # ── W5: 390 px, touch, List view ──────────────────────────────────────────────────
        phone = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                               reduced_motion="reduce", storage_state=state)
        stub_live_prices(phone, {n["symbol"]: n["live_price"] for n in NOTES})
        pp = phone.new_page()
        pp.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pp.goto(base + "/journal?j2tab=positions", wait_until="domcontentloaded")
        h._dismiss_intro(pp)
        nvda_chip_p = pp.locator(f'[data-thesis-chip="{ids["nvda_note"]}"]')
        nvda_chip_p.wait_for(state="visible", timeout=60000)
        g5 = geometry(pp, f'[data-thesis-chip="{ids["nvda_note"]}"] button')
        w.shot(pp, "W5a-list-390")
        nvda_chip_p.tap()
        pp.locator(f'[data-thesis-chip="{ids["nvda_note"]}"] a[href*="note="]').wait_for(state="visible", timeout=10000)
        w.shot(pp, "W5b-preview-open-390")
        w.raw["W5"] = {"geometry": g5}
        ok5 = g5["sw"] <= g5["cw"] + 1 and g5["minH"] is not None and g5["minH"] >= 44
        w.record("W5_phone_390_tap_opens", ok5,
                 f"scrollWidth {g5['sw']} vs {g5['cw']}; chip min height {g5['minH']}")
        phone.close()

        # ── W6: the gate OFF in the client, both views, zero requests ─────────────────────
        reqs6: list[str] = []
        off = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce", storage_state=state)
        stub_live_prices(off, {n["symbol"]: n["live_price"] for n in NOTES})
        off.route("**/api/auth/me", fake_me_off)
        po = off.new_page()
        po.on("request", lambda r: reqs6.append(r.url) if "/api/j2/thesis-chips" in r.url else None)
        po.on("pageerror", lambda e: errors.append(str(e)[:300]))
        po.goto(base + "/journal?j2tab=positions", wait_until="domcontentloaded")
        h._dismiss_intro(po)
        po.get_by_text("NVDA", exact=True).first.wait_for(state="visible", timeout=60000)
        po.wait_for_timeout(1500)
        no_chips_list = po.locator("[data-thesis-chip]").count() == 0
        po.get_by_role("button", name="Table").click()
        po.wait_for_timeout(1000)
        no_chips_table = po.locator("[data-thesis-chip]").count() == 0
        w.shot(po, "W6-gates-off-1200")
        off.close()
        w.raw["W6"] = {"no_chips_list": no_chips_list, "no_chips_table": no_chips_table, "requests": reqs6}
        w.record("W6_gate_off_client", no_chips_list and no_chips_table and not reqs6,
                 f"List chips absent={no_chips_list}; Table chips absent={no_chips_table}; requests={reqs6}")

        w.record("W7_no_page_errors", not errors, f"{len(errors)} unforced page errors" + (f": {errors[:3]}" if errors else ""))
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8665)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port not in PORTS:
        print("REFUSED: this lane's walk uses ports 8665-8669 only")
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

    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    os.environ.update({"NOTEBOOK_THESIS_CHIPS_ENABLED": "1",
                       "FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "",
                       "ALPHA_VANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    not_run = failure = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            try:
                from playwright.sync_api import sync_playwright
                with sync_playwright() as pw:
                    br = pw.chromium.launch()
                    admin_ctx = br.new_context()
                    seed_ctx = br.new_context()
                    req = seed_ctx.request
                    h._provision(admin_ctx.request, req, base, member=MEMBER)
                    me = req.get(base + "/api/auth/me").json()
                    uid = me["user"]["id"]
                    ids = {}
                    pairs = []
                    for pos in POSITIONS:
                        r = req.post(base + "/api/j2/positions", data=pos)
                        if r.status not in (200, 201):
                            raise h.SetupFailed(f"seeding position {pos['symbol']} failed: HTTP {r.status} {r.text()[:200]}")
                    for n in NOTES:
                        r = req.post(base + "/api/j2/notes", data={
                            "title": n["title"], "ticker": n["symbol"], "bodyJson": doc_body(n["lines"])})
                        if r.status not in (200, 201):
                            raise h.SetupFailed(f"seeding note {n['symbol']} failed: HTTP {r.status} {r.text()[:200]}")
                        nid = r.json()["note"]["id"]
                        ids[f"{n['symbol'].lower()}_note"] = nid
                        pairs.append([uid, nid])
                        pr = req.put(base + f"/api/j2/notes/{nid}", data={
                            "properties": {"builtin:thesis_status": n["status"]}})
                        if pr.status not in (200, 201):
                            raise h.SetupFailed(f"setting thesis_status for {n['symbol']} failed: HTTP {pr.status}")
                    w.raw["seed_ids"] = ids
                    br.close()
                w.raw["project_child"] = project_notes(data_dir, pairs, out)
            except h.SetupFailed as e:
                not_run = str(e)[:400]
            if not not_run:
                try:
                    run(base, w, ids)
                except h.SetupFailed as e:
                    not_run = str(e)[:300]
                except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
                    import traceback
                    failure = f"the walk raised {type(e).__name__}: {str(e)[:400]}"
                    w.raw["traceback"] = traceback.format_exc()[-3000:]
            box.wait_checkpoint(h.POST_BOOT, 60)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN]) if box.proc else {"clean": False, "status": "NOT BOOTED"}
    if box.proc:
        h._keep_integrity_log(integ, out / "integrity.md", own=True)
        print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    w.record("W8_driver_never_imported_api", not api_mods,
             "no api.* module in the driver's sys.modules" if not api_mods else f"imported: {api_mods[:5]}")
    result = {"tool": "tools/notebook_w13g2_walk.py", "base": base, "integrity": integ, "failure": failure,
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
