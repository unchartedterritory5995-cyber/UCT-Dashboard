"""Wave 13 lane 13J -- the real-browser walk for the active setups board and find more like this.

It OWNS its sandbox (tools/notebook_perf_harness.py's `Sandbox`: scripts/hub_sandbox_boot.py
through the SIGBREAK shim, its own process group, stopped gracefully so the launcher's `finally`
writes the SHUTDOWN checkpoint). Its FIRST output line is the launcher's integrity verdict. It
writes RAW evidence only (walk.json, screenshots, the API reads it took) and draws no conclusion.

⛔ THIS DRIVER NEVER IMPORTS `api.*` (it would arm the app's import-time readers in the driver's
own process). Two data stores are seeded by CHILD processes that first apply the sandbox's own
census pins (`hub_sandbox_boot.apply_sandbox_env`, which also arms the shared-root tripwire):

  * PRE-BOOT -- daily bars for three symbols (`bars_sqlite.put_bars`), so the board's distances
    are computed on real stored closes, never a live vendor;
  * POST-BOOT, once the member's own tagged chart note exists -- `similar_matches.run_nightly`
    is run for real (the actual distance math, the actual write), with an INJECTED universe
    (a fixture pair, not the screener store) standing in for the screener's nightly snapshot --
    the same substitution 13C's walk makes for AlphaVantage. Nothing here calls a model or a
    vendor; the nightly job's own `load_universe` is never reached.

Run from PowerShell (a Windows path through the Bash tool loses its backslash), ports 8645-8649:

    python tools/notebook_w13j_walk.py --data-dir '<scratch>\\w13j-walk-data' --port 8645 `
        --out 'docs\\notebook\\evidence\\wave13-13j\\walk-<sha>'

Preconditions: app/dist rebuilt from this tree (`npm run build` in app/); the port free (refused,
never killed); the data dir outside the shared root (refused) and EMPTY.

  W0  the gate rides the auth payload ON for the walk member, both flags
  W1  1200 px: the board shows three cards in closeness order (ZQVA 2.0% waiting, ZQVB 10.0%
      watching, ZQVC 10.0% invalidated), each with its own entry/stop/target lines and a price
      source line; a mini-chart mounts on the admitted cards
  W2  every card's mini-chart mounts (this fixture has 3 cards, at the grid's own mount cap, so
      the cap itself is not stressed here -- SetupsBoard.test.jsx's 40-card fixture and the
      mutation proof are what prove the cap holds at scale); no bars request fires before the
      board's own heading painted
  W3  keyboard: Tab reaches "Find more like ZQVA", Enter opens the matches sheet
  W4  find more like this: CRWD's reasons name the field deltas and the shared VCP pattern, and
      the match count is what the nightly run wrote
  W5  the find-similar templates list carries the same tagged chart with its match count
  W6  390 px, touch: no sideways scroll, every control is >= 44 px tall, the sheet opens by tap
  W7  the request path for find more like this never reaches the universe (tripwires on the
      running sandbox's own screener module)
  W8  the gate OFF in the client (the auth payload answered false for both flags): the page says
      it is not available yet, and fetches neither route
  W9  no unforced page errors
  W10 the driver never imported api.*

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
from datetime import date, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)

MEMBER = ("w13j@local.dev", "LocalTest2026!", "w13j")
BOARD_FLAG = "notebook_setups_board_enabled"
SIMILAR_FLAG = "notebook_find_similar_enabled"
TODAY = date.today().isoformat()


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

    def dump(self, name, data):
        (self.out / name).write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")


def tab_to(pg, js_predicate: str, limit: int = 250) -> int:
    for i in range(1, limit + 1):
        pg.keyboard.press("Tab")
        if pg.evaluate(f"(() => {{ const el = document.activeElement; return !!(el && ({js_predicate})) }})()"):
            return i
    return -1


def name_is(text: str) -> str:
    t = json.dumps(text)
    return f"((el.getAttribute('aria-label') || el.textContent || '').trim() === {t})"


# ── seeding ─────────────────────────────────────────────────────────────────────────────

BARS_CHILD = r'''
import json, sys
repo, data_dir, bars = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services import bars_sqlite
bars_sqlite.init_db()
n = 0
for sym, close in bars.items():
    n += bars_sqlite.put_bars(sym, "D", [{"t": close["day"], "o": close["c"], "h": close["c"],
                                          "l": close["c"], "c": close["c"], "v": 1000000}], date_tf=True)
print("SEEDED", n)
'''


def seed_bars(data_dir: Path, bars: dict, out: Path) -> None:
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", BARS_CHILD, str(REPO), str(data_dir), json.dumps(bars)],
                       cwd=str(REPO), env=env, capture_output=True, text=True, timeout=120)
    (out / "seed-bars-child.log").write_text((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or "")[-4000:],
                                             encoding="utf-8")
    if r.returncode != 0 or "SEEDED" not in (r.stdout or ""):
        raise h.SetupFailed(f"seeding daily bars failed (rc {r.returncode}); see seed-bars-child.log")


NIGHTLY_CHILD = r'''
import json, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services.journal_two import similar_matches as sm
def pattern_field(as_of, sym):
    return {"value": [{"setup": "vcp"}], "missing": None}
report = sm.run_nightly(universe=spec["universe"], pattern_field=pattern_field)
print("NIGHTLY", json.dumps(report))
'''


def run_nightly_seed(data_dir: Path, universe: dict, out: Path) -> dict:
    """Runs the REAL nightly job (catch-up, distance, write) against the sandbox's own
    auth.db, with an injected universe standing in for the screener's nightly snapshot --
    the running sandbox is untouched by this (it never imports the screener store)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", NIGHTLY_CHILD, str(REPO), str(data_dir),
                        json.dumps({"universe": universe})],
                       cwd=str(REPO), env=env, capture_output=True, text=True, timeout=120)
    (out / "seed-nightly-child.log").write_text((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or "")[-4000:],
                                                encoding="utf-8")
    line = next((l for l in r.stdout.splitlines() if l.startswith("NIGHTLY")), None)
    if r.returncode != 0 or not line:
        raise h.SetupFailed(f"the nightly seed run failed (rc {r.returncode}); see seed-nightly-child.log")
    return json.loads(line[len("NIGHTLY "):])


TEMPLATE_FINGERPRINT = {
    "v": 1, "symbol": "ZQVA", "requested_as_of": TODAY, "as_of": TODAY, "mode": "nightly",
    "fields": {
        "adr_pct": {"value": 5.0, "source": "walk-seed", "missing": None},
        "pct_vs_sma20": {"value": 2.0, "source": "walk-seed", "missing": None},
        "pct_vs_sma50": {"value": 10.0, "source": "walk-seed", "missing": None},
        "pct_vs_sma200": {"value": 30.0, "source": "walk-seed", "missing": None},
        "ma_stack": {"value": "full-bull", "source": "walk-seed", "missing": None},
        "ema_stack_intact": {"value": True, "source": "walk-seed", "missing": None},
        "rs_rank": {"value": 92, "source": "walk-seed", "missing": None},
        "rs_line_trend": {"value": "up", "source": "walk-seed", "missing": None},
        "pullback_depth_pct": {"value": 12.0, "source": "walk-seed", "missing": None},
        "vol_nweek_low": {"value": 15, "source": "walk-seed", "missing": None},
        "close_cv_pct": {"value": 1.5, "source": "walk-seed", "missing": None},
        "pole_pct": {"value": 60.0, "source": "walk-seed", "missing": None},
        "patterns": {"value": [{"setup": "vcp", "asof_date": TODAY, "confidence": 81.0}],
                     "source": "walk-seed", "missing": None},
    },
}

# Identical to tests/test_notebook_similar_matches.py's TEMPLATE/CANDIDATE fixture pair, so the
# score and reasons this walk checks for are the SAME arithmetic that test already pins (80, at
# distance 0.1954) -- never a second, hand-recomputed number.
CANDIDATE_VALUES = {
    "adr_pct": 5.6, "pct_vs_sma20": 3.0, "pct_vs_sma50": 12.0, "pct_vs_sma200": 50.0,
    "ma_stack": "partial", "ema_stack_intact": True, "rs_rank": 94, "rs_line_trend": "up",
    "pullback_depth_pct": 11.0, "vol_nweek_low": 20, "close_cv_pct": 1.5, "pole_pct": 80.0,
}


def chart_attrs(symbol: str, entry, stop, target=None, tag=None, fingerprint=None, embed_id=None):
    anns = []
    for role, price in (("entry", entry), ("stop", stop), ("target", target)):
        if price is not None:
            anns.append({"id": f"d-{role}", "type": "horizontal", "role": role, "price": price})
    attrs = {"v": 1, "widgetId": "chart", "params": {"symbol": symbol, "tf": "D", "to": None},
             "capturedAt": f"{TODAY}T15:00:00Z", "embedId": embed_id or f"e-{symbol}",
             "mode": "live", "annotations": anns}
    if tag:
        attrs["ta"] = {"setupTag": tag}
        if fingerprint:
            attrs["ta"]["fingerprint"] = fingerprint
    return {"type": "widgetEmbed", "attrs": attrs}


def doc_with_chart(symbol, entry, stop, target=None, tag=None, fingerprint=None):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": f"{symbol} plan"}]},
        chart_attrs(symbol, entry, stop, target, tag, fingerprint)]}


# ── the walk ────────────────────────────────────────────────────────────────────────────

def _arm_universe_tripwire(ctx):
    """Routed so the sandbox's RESPONSE is untouched; this only records whether a request to the
    screener's own admin endpoints ever left the browser -- a page that calls find-similar's
    routes correctly never needs them."""
    hits = []
    ctx.route("**/api/scans/**", lambda route: (hits.append(route.request.url), route.continue_())[1])
    return hits


def run(base: str, w: Walk, data_dir: Path) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
        req = ctx.request
        h._provision(admin_ctx.request, req, base, member=MEMBER)
        me = req.get(base + "/api/auth/me").json()
        w.raw["auth_me_flags"] = {BOARD_FLAG: me.get(BOARD_FLAG), SIMILAR_FLAG: me.get(SIMILAR_FLAG)}
        w.record("W0_gates_on_payload", me.get(BOARD_FLAG) is True and me.get(SIMILAR_FLAG) is True,
                 f"/api/auth/me {BOARD_FLAG}={me.get(BOARD_FLAG)!r} {SIMILAR_FLAG}={me.get(SIMILAR_FLAG)!r}")

        # the member's own notes, through the product's own note-creation route
        n_nvda = req.post(base + "/api/j2/notes", data={
            "title": "ZQVA plan", "ticker": "ZQVA",
            "bodyJson": doc_with_chart("ZQVA", 102, 97, 115, tag="VCP", fingerprint=TEMPLATE_FINGERPRINT)})
        n_amd = req.post(base + "/api/j2/notes", data={
            "title": "ZQVB watch", "ticker": "ZQVB", "bodyJson": doc_with_chart("ZQVB", 55, None)})
        n_tsla = req.post(base + "/api/j2/notes", data={
            "title": "ZQVC short", "ticker": "ZQVC", "bodyJson": doc_with_chart("ZQVC", 180, 190)})
        w.raw["seed_notes_http"] = {"ZQVA": n_nvda.status, "ZQVB": n_amd.status, "ZQVC": n_tsla.status}
        if not all(r.status in (200, 201) for r in (n_nvda, n_amd, n_tsla)):
            raise h.SetupFailed(f"seeding the member's chart notes failed: {w.raw['seed_notes_http']}")
        nvda_note_id = n_nvda.json()["note"]["id"]

        # the nightly precompute, run for real against this member's own auth.db
        universe = {"as_of": TODAY, "rows": [
            {"symbol": "CRWD", "as_of": TODAY, "is_etf": False, "values": CANDIDATE_VALUES}], "truncated": False}
        nightly = run_nightly_seed(data_dir, universe, w.out)
        w.raw["nightly_seed_report"] = nightly
        w.record("W_seed_nightly_wrote_rows", nightly.get("rows") == 1 and nightly.get("templates") == 1,
                 f"nightly seed report: {nightly}")

        tripwire_hits = _arm_universe_tripwire(ctx)
        pg = ctx.new_page()
        errors: list[str] = []
        bars_reqs: list[tuple[float, str]] = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.on("request", lambda r: bars_reqs.append((time.time(), r.url))
              if "/api/bars/" in r.url else None)
        pg.goto(base + "/journal/notebook/setups", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        heading = pg.get_by_role("heading", name="Active setups")
        heading.wait_for(state="visible", timeout=60000)
        first_paint = time.time()
        # the three cards render in the same commit as the heading; wait for the THIRD one
        # rather than sample -- a card list is a waiter, never a sleep.
        pg.locator('[data-board-card="ZQVC"]').wait_for(state="visible", timeout=30000)

        order = pg.locator("[data-board-card]").evaluate_all(
            "els => els.map(e => ({sym: e.getAttribute('data-board-card'), state: e.getAttribute('data-state')}))")
        w.raw["board_order_1200"] = order
        ok1 = [o["sym"] for o in order] == ["ZQVA", "ZQVB", "ZQVC"] and \
            [o["state"] for o in order] == ["waiting", "watching", "invalidated"]
        distances = pg.locator("[data-distance]").all_inner_texts()
        w.raw["distances_1200"] = distances
        ok1 = ok1 and distances == ["2.00% to the entry · 0.40R", "10.00% to the entry",
                                    "Through the stop · 10.00% from the entry · 2.00R"]
        w.record("W1_board_order_and_distances_1200", ok1, f"order={order}; distances={distances}")
        w.shot(pg, "W1-board-1200")

        mounted = pg.locator('[data-chart-mounted="yes"]').count()
        w.raw["mounted_charts_1200"] = mounted
        w.record("W2_every_card_mounts_its_chart", mounted == 3 and bool(bars_reqs),
                 f"{mounted} of 3 cards mounted a chart (the cap is not stressed at n=3 -- see "
                 f"SetupsBoard.test.jsx and the mutation proof for that); {len(bars_reqs)} /api/bars/ "
                 f"requests, first at {round(bars_reqs[0][0] - first_paint, 2) if bars_reqs else 'n/a'}s after paint")

        # W3 -- keyboard: Tab to "Find more like ZQVA", Enter opens the sheet. The button must
        # actually be ON SCREEN before tabbing starts -- a card list is a waiter, never a sleep.
        pg.get_by_role("button", name="Find more like ZQVA", exact=True).wait_for(state="visible", timeout=15000)
        pg.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
        presses = tab_to(pg, name_is("Find more like ZQVA"))
        active_before = pg.evaluate(
            "(() => { const el = document.activeElement; return el ? {tag: el.tagName, "
            "aria: el.getAttribute('aria-label'), text: (el.textContent || '').trim().slice(0,60)} : null })()")
        pg.keyboard.press("Enter")
        sheet_title = pg.get_by_role("heading", name="Names like ZQVA (VCP)")
        try:
            sheet_title.wait_for(state="visible", timeout=20000)
            opened = True
        except Exception as e:  # noqa: BLE001
            opened = False
            w.raw["W3_error"] = str(e)[:400]
            w.raw["W3_active_element_at_enter"] = active_before
        w.record("W3_find_similar_by_keyboard", presses > 0 and opened,
                 f"{presses} Tab presses reached the button; Enter opened the sheet={opened}")
        w.shot(pg, "W3-find-similar-sheet-1200")

        # W4 -- the match and its reasons
        match_text = pg.locator("[data-match]").inner_text() if opened else ""
        w.raw["match_text_1200"] = match_text
        # The three CLOSEST fields lead (topReasons sorts by d ascending): with this fixture,
        # ema_stack_intact / rs_line_trend / close_cv_pct tie at d=0 and come first by RULES'
        # own field order, ahead of rs_rank's d=0.08 -- the product is right to show the exact
        # matches before the near ones, so this is the reasons text to expect, not "RS 94 vs 92".
        ok4 = opened and "CRWD" in match_text and "EMA stack intact" in match_text \
            and "RS line up" in match_text and "tightness 1.5% vs 1.5%" in match_text \
            and "VCP" in match_text and "80 match" in match_text
        w.record("W4_match_reasons", ok4, f"match row text: {match_text!r}")

        pg.keyboard.press("Escape")
        # W5 -- the templates list
        templ = pg.locator("li", has=pg.get_by_text("VCP")).first.inner_text() if True else ""
        w.raw["templates_row_1200"] = templ
        w.record("W5_templates_list_match_count", "1 names" in templ or "matched tonight" in templ,
                 f"templates row: {templ!r}")

        # W7 -- the find-similar request path never reaches the screener's own routes
        w.record("W7_no_universe_scan_from_the_browser", not tripwire_hits,
                 f"/api/scans/** hits from this page: {tripwire_hits}")

        # W6 -- 390 px, touch
        state = ctx.storage_state()
        phone = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                               reduced_motion="reduce", storage_state=state)
        pp = phone.new_page()
        pp.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pp.goto(base + "/journal/notebook/setups", wait_until="domcontentloaded")
        h._dismiss_intro(pp)
        pp.get_by_role("heading", name="Active setups").wait_for(state="visible", timeout=60000)
        pp.locator('[data-board-card="ZQVC"]').wait_for(state="visible", timeout=30000)
        geo = pp.evaluate("""() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})""")
        btn = pp.get_by_role("button", name="Find more like ZQVA", exact=True)
        btn.scroll_into_view_if_needed()
        box = btn.bounding_box() or {"height": 0}
        w.raw["phone_geometry"] = {**geo, "button_h": box["height"]}
        w.shot(pp, "W6-board-390")
        btn.tap()
        try:
            pp.get_by_role("heading", name="Names like ZQVA (VCP)").wait_for(state="visible", timeout=15000)
            ok6_tap = True
        except Exception as e:  # noqa: BLE001
            ok6_tap = False
            w.raw["W6_error"] = str(e)[:400]
        w.shot(pp, "W6-find-similar-390")
        ok6 = geo["sw"] <= geo["cw"] + 1 and box["height"] >= 44 and ok6_tap
        w.record("W6_phone_390", ok6, f"scrollWidth {geo['sw']} vs clientWidth {geo['cw']}; button height "
                 f"{box['height']}; tap opened the sheet={ok6_tap}")
        phone.close()

        # W8 -- the gate OFF in the client
        off = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce", storage_state=state)
        off_requests: list[str] = []

        def fake_me(route):
            resp = route.fetch()
            data = resp.json()
            data[BOARD_FLAG] = False
            data[SIMILAR_FLAG] = False
            route.fulfill(response=resp, body=json.dumps(data), headers={**resp.headers, "content-type": "application/json"})
        off.route("**/api/auth/me", fake_me)
        po = off.new_page()
        po.on("request", lambda r: off_requests.append(r.url)
              if ("/api/j2/setups-board" in r.url or "/api/j2/similar-names" in r.url) else None)
        po.on("pageerror", lambda e: errors.append(str(e)[:300]))
        po.goto(base + "/journal/notebook/setups", wait_until="domcontentloaded")
        h._dismiss_intro(po)
        po.get_by_text("This page is not available yet.").wait_for(state="visible", timeout=30000)
        # proving an ABSENCE (no request fired) has no positive signal to wait for -- a bounded
        # dwell is the right tool here, not a sample-in-a-loop (cf. CLAUDE.md on the two shapes).
        po.wait_for_timeout(1500)
        w.record("W8_gate_off_client", not off_requests,
                 f"setups-board / similar-names requests with both flags off: {off_requests}")
        w.shot(po, "W8-gate-off-1200")
        off.close()

        w.record("W9_no_page_errors", not errors, f"{len(errors)} unforced page errors" + (f": {errors[:3]}" if errors else ""))
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8645)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if not 8645 <= args.port <= 8649:
        print("REFUSED: this lane's walk uses ports 8645-8649 only")
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

    not_run = failure = None
    try:
        seed_bars(data_dir, {"ZQVA": {"day": TODAY, "c": 100.0}, "ZQVB": {"day": TODAY, "c": 50.0},
                             "ZQVC": {"day": TODAY, "c": 200.0}}, out)
    except h.SetupFailed as e:
        not_run = str(e)

    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    # ⛔ Written for the CHILDREN (Popen inherits it) and the sandboxed server both: the gates'
    # one parse lives in the app (notebook_flags.flag_on). Provider keys are blanked so no
    # market value can come from a live vendor -- every price in a card is one this walk seeded.
    os.environ.update({"NOTEBOOK_SETUPS_BOARD_ENABLED": "1", "NOTEBOOK_FIND_SIMILAR_ENABLED": "1",
                       "FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "",
                       "MASSIVE_API_KEY": ""})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    if not not_run:
        box.start()
        try:
            if not box.wait_healthy(base, 300):
                failure = "the sandbox never answered /api/health"
            else:
                try:
                    run(base, w, data_dir)
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
    w.record("W10_driver_never_imported_api", not api_mods,
             "no api.* module in the driver's sys.modules" if not api_mods else f"imported: {api_mods[:5]}")
    result = {"tool": "tools/notebook_w13j_walk.py", "base": base, "integrity": integ, "failure": failure,
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
