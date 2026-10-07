"""Wave 13 lane 13D -- the real-browser walk for resurfacing ("here's what you thought then").

It OWNS its sandbox (tools/notebook_perf_harness.py's `Sandbox`: scripts/hub_sandbox_boot.py through
the SIGBREAK shim, its own process group, stopped gracefully so the launcher's `finally` writes the
SHUTDOWN checkpoint). Its FIRST output line is the launcher's integrity verdict. It writes RAW
evidence only (walk.json, screenshots, the API reads and the scan children's output) and draws no
conclusion.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. The awareness scan is run ONCE per step by a CHILD process
that first applies the sandbox's own census pins (`hub_sandbox_boot.apply_sandbox_env`, which also
arms the shared-root tripwire), writes the step's price into the SHARED live-price cache
(`api.routers.live_prices.cache`, the one the scan reads), and calls the real
`awareness.engine.run_awareness_scan()` against the sandbox's auth.db. Only R1-R6's MARKET-WIDE
inputs (regime, earnings window -- live vendors a sandbox has no keys for) are stubbed in the child;
the resurfacing pass, its index, its ledger and add_insight's sub-cap are the product's own code.
The scheduler stays off (the sandbox's kill list); "run the scan once" is the child.

Run from PowerShell (a Windows path through the Bash tool loses its backslash), ports 8620-8624:

    python tools/notebook_w13d_walk.py --data-dir '<scratch>\\w13d-walk-data' --port 8620 `
        --out 'docs\\notebook\\evidence\\wave13-13d\\walk-<sha>'

Preconditions: app/dist rebuilt from this tree (`npm run build` in app/); the port free (refused,
never killed); the data dir outside the shared root (refused) and EMPTY.

  W0  the gate rides the auth payload ON for the walk member
  W1  a note naming a stop (NVDA, "Stop: 100"), then an edit adding a target: the saved version
      that named the stop exists and does NOT hold the target
  W2  scan 1 at 104 (first sighting, 4% away): no notice -- the side is recorded
  W3  scan 2 at 98 (crossed the stop): exactly one notice, kind note_level_touch, in-app only
  W4  1200 px: the in-app insights inbox (Settings > Compass, the live surface that lists
      /api/voice/insights) shows it under "Your notes" with "Open what you wrote"
  W5  click it: the note opens at ?note=<id>&resurfaceVersion=<the version that named the stop>,
      the sheet "What you wrote then" shows that version (Stop: 100, no target) beside the live
      note (which has the target); closing drops the parameter
  W6  scan 3 at 103 (crossed back, same day): silent -- still one notice
  W7  a Review Date of today on a second note: one note_date_due notice
  W8  keyboard: Tab reaches "Open what you wrote", Enter opens the sheet, Escape closes it
  W9  390 px, touch: no sideways scroll, the door is >= 44 px tall, a tap opens the sheet and its
      button is >= 44 px tall
  W10 gate OFF in the client (the auth payload answered false): the same URL opens no sheet and
      requests no version
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
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)

MEMBER = ("w13d@local.dev", "LocalTest2026!", "w13d")
FLAG_KEY = "awareness_note_resurface_enabled"
PORTS = range(8620, 8625)
#: The live in-app inbox of insights (Settings > Compass > Voice Insights Inbox).
INBOX = "/settings?section=compass"


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


def tab_to(pg, js_predicate: str, limit: int = 300) -> int:
    for i in range(1, limit + 1):
        pg.keyboard.press("Tab")
        if pg.evaluate(f"(() => {{ const el = document.activeElement; return !!(el && ({js_predicate})) }})()"):
            return i
    return -1


def text_of(node, out=None):
    out = [] if out is None else out
    if isinstance(node, dict):
        if node.get("type") == "text":
            out.append(node.get("text", ""))
        for c in node.get("content") or []:
            text_of(c, out)
    return out


def doc(*lines):
    return {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": t}]} for t in lines]}


# ── the scan child ─────────────────────────────────────────────────────────────────────────

SCAN_CHILD = r'''
import json, os, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
# The sandbox's kill list turned the engine off for the SERVER; this child is the one explicit
# scan, so it turns the two gates on for itself only.
os.environ["AWARENESS_ENGINE_ENABLED"] = "1"
os.environ["AWARENESS_NOTE_RESURFACE_ENABLED"] = "1"
from datetime import date
from api.routers.live_prices import cache, _px_key
for sym, q in spec["quotes"].items():
    cache.set(_px_key(sym), {"price": q["price"], "change_pct": q.get("change_pct", 0.0)}, ttl=600)
from api.services.awareness import engine as eng
# R1-R6's market-wide inputs need live vendors (regime classifier, earnings calendar); stubbed
# HERE, in the walk's child only. The resurfacing pass below them is the product's own code.
eng._build_market_scan_ctx = lambda user_ctxs: {
    "live_prices": {}, "regime": {"label": None, "confidence": None, "prev_label": None},
    "earnings_by_symbol": {}, "earnings_window_days": 3, "today": date.today()}
with __import__("unittest.mock").mock.patch(
        "api.services.watchlist_alert_service.deliver_alert_payload",
        side_effect=AssertionError("deliver_alert_payload reached")) as deliver:
    result = eng.run_awareness_scan()
from api.services.auth_db import get_connection
c = get_connection()
rows = [dict(r) for r in c.execute(
    "SELECT id, kind, symbol, headline, body, importance FROM voice_proactive_insights ORDER BY id")]
levels = [dict(r) for r in c.execute(
    "SELECT user_id, note_id, level_id, symbol, role, price, on_date, version_id, last_side"
    " FROM j2_note_levels WHERE role != 'none' ORDER BY note_id, level_id")]
fires = [dict(r) for r in c.execute("SELECT * FROM j2_note_resurface_fires ORDER BY insight_id")]
c.close()
print("SCAN " + json.dumps({"result": result, "insights": rows, "levels": levels, "fires": fires,
                            "deliver_calls": deliver.call_count}, default=str))
'''


def scan(data_dir: Path, quotes: dict, out: Path, label: str) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", SCAN_CHILD, str(REPO), str(data_dir),
                        json.dumps({"quotes": quotes})],
                       cwd=str(REPO), env=env, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=900)
    (out / f"scan-{label}.log").write_text((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or "")[-8000:],
                                           encoding="utf-8")
    line = [ln for ln in (r.stdout or "").splitlines() if ln.startswith("SCAN ")]
    if r.returncode != 0 or not line:
        raise h.SetupFailed(f"scan child '{label}' failed (rc {r.returncode}); see scan-{label}.log")
    data = json.loads(line[-1][5:])
    (out / f"scan-{label}.json").write_text(json.dumps(data, indent=1, default=str), encoding="utf-8")
    return data


def read_note(req, base, nid):
    r = req.get(f"{base}/api/j2/notes/{nid}")
    return r.json()["note"] if r.status == 200 else None


# ── the walk ────────────────────────────────────────────────────────────────────────────

def run(base: str, w: Walk, data_dir: Path) -> None:
    from playwright.sync_api import sync_playwright
    today_et = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    w.raw["today_et"] = today_et

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
        req = ctx.request
        h._provision(admin_ctx.request, req, base, member=MEMBER)
        me = req.get(base + "/api/auth/me").json()
        w.raw["auth_me_flag"] = me.get(FLAG_KEY)
        w.record("W0_gate_on_payload", me.get(FLAG_KEY) is True, f"/api/auth/me {FLAG_KEY}={me.get(FLAG_KEY)!r}")

        # W1 -- a note naming a stop, then an edit (the first edit checkpoints the version that named it)
        cr = req.post(base + "/api/j2/notes", data={"title": "NVDA swing plan (walk)", "ticker": "NVDA",
                                                     "bodyJson": doc("The plan", "Stop: 100")})
        if cr.status not in (200, 201):
            raise h.SetupFailed(f"creating the note failed: HTTP {cr.status} {cr.text()[:200]}")
        n0 = cr.json()["note"]
        up = req.put(f"{base}/api/j2/notes/{n0['id']}", data={
            "bodyJson": doc("The plan", "Stop: 100", "Target: 130"), "baseUpdatedAt": n0["updatedAt"]})
        vers = req.get(f"{base}/api/j2/notes/{n0['id']}/versions").json().get("versions") or []
        w.dump("versions-note1.json", vers)
        vid = vers[-1]["id"] if vers else None
        v = req.get(f"{base}/api/j2/notes/{n0['id']}/versions/{vid}").json().get("version") if vid else None
        vtext = "\n".join(text_of((v or {}).get("bodyJson") or {}))
        live = read_note(req, base, n0["id"])
        live_text = "\n".join(text_of((live or {}).get("bodyJson") or {}))
        w.raw["W1"] = {"create": cr.status, "update": up.status, "version_id": vid, "version_text": vtext,
                       "live_text": live_text}
        w.record("W1_note_and_version", up.status == 200 and len(vers) == 1 and "Stop: 100" in vtext
                 and "Target" not in vtext and "Target: 130" in live_text,
                 f"update HTTP {up.status}; {len(vers)} version(s); version {vid} holds the stop and not the "
                 f"target; the live note holds both")

        # W2 / W3 -- the scan, once per price step
        s1 = scan(data_dir, {"NVDA": {"price": 104.0}}, w.out, "1-at-104")
        stop_row = next((lv for lv in s1["levels"] if lv["role"] == "stop"), {})
        w.record("W2_first_sighting_is_silent", s1["result"]["resurface"]["fired"] == 0 and not s1["insights"]
                 and stop_row.get("last_side") == "above" and stop_row.get("version_id") == vid,
                 f"fired {s1['result']['resurface']['fired']}; stop level indexed {stop_row} (side recorded, "
                 f"version {vid})")
        s2 = scan(data_dir, {"NVDA": {"price": 98.0}}, w.out, "2-at-98")
        ins = s2["insights"]
        w.record("W3_cross_fires_one_in_app_notice",
                 s2["result"]["resurface"]["fired"] == 1 and len(ins) == 1 and ins[0]["kind"] == "note_level_touch"
                 and ins[0]["importance"] < 8 and s2["deliver_calls"] == 0,
                 f"fired {s2['result']['resurface']['fired']}; insights {ins}; deliver_alert_payload calls "
                 f"{s2['deliver_calls']}")

        hist = req.get(base + "/api/voice/insights").json().get("insights") or []
        w.dump("insights-after-cross.json", hist)
        link = next((i.get("link") for i in hist if i.get("kind") == "note_level_touch"), None)
        w.raw["link"] = link

        pg = ctx.new_page()
        errors: list[str] = []
        version_requests: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.on("request", lambda r: version_requests.append(r.url) if "/versions/" in r.url else None)

        # W4 -- the inbox
        pg.goto(base + INBOX, wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        door = pg.get_by_role("link", name="Open what you wrote")
        try:
            door.first.wait_for(state="visible", timeout=60000)
            ok4 = True
        except Exception as e:  # noqa: BLE001
            ok4 = False
            w.raw["W4_error"] = str(e)[:400]
        tile_text = door.first.locator("xpath=../..").inner_text() if ok4 else ""
        w.raw["W4_tile_text"] = tile_text
        href = door.first.get_attribute("href") if ok4 else None
        w.record("W4_inbox_shows_the_notice", ok4 and "NVDA reached 100.00" in tile_text and "your notes" in tile_text.lower()
                 and href == f"/journal/notebook?note={n0['id']}&resurfaceVersion={vid}",
                 f"door href {href}; inbox row text {tile_text!r}")
        w.shot(pg, "W4-inbox-1200")

        # W5 -- click through to the version
        ok5, detail5 = False, "door not shown"
        if ok4:
            door.first.click()
            try:
                pg.wait_for_url("**/journal/notebook?note=*", timeout=60000)
                sheet = pg.get_by_role("dialog", name="What you wrote then")
                sheet.wait_for(state="visible", timeout=60000)
                pg.get_by_test_id("note-version-preview").get_by_text("Stop: 100").wait_for(state="visible", timeout=30000)
                q = parse_qs(urlparse(pg.url).query)
                sheet_text = sheet.inner_text()
                w.raw["W5_url"] = pg.url
                w.raw["W5_sheet_text"] = sheet_text
                w.shot(pg, "W5-version-sheet-1200")
                pg.get_by_role("button", name="Back to the note as it is now").click()
                sheet.wait_for(state="detached", timeout=20000)
                pm = pg.locator(".ProseMirror").first
                pm.get_by_text("Target: 130").wait_for(state="visible", timeout=30000)
                after = parse_qs(urlparse(pg.url).query)
                ok5 = (q.get("note") == [n0["id"]] and q.get("resurfaceVersion") == [vid]
                       and "Stop: 100" in sheet_text and "Target" not in sheet_text
                       and "first named the level" in sheet_text and "resurfaceVersion" not in after
                       and after.get("note") == [n0["id"]])
                detail5 = (f"opened {pg.url}; the sheet held the version that named the stop and no target; "
                           f"closing left ?{urlparse(pg.url).query} with the live note showing the target")
                w.shot(pg, "W5-closed-live-note-1200")
            except Exception as e:  # noqa: BLE001
                detail5 = f"raised {type(e).__name__}: {str(e)[:300]}"
                w.shot(pg, "W5-error-1200")
        w.record("W5_opens_the_version_that_named_the_level", ok5, detail5)

        # W6 -- a second cross the same day is silent
        s3 = scan(data_dir, {"NVDA": {"price": 103.0}}, w.out, "3-at-103")
        w.record("W6_second_cross_is_silent", s3["result"]["resurface"]["fired"] == 0
                 and len([i for i in s3["insights"] if i["kind"] == "note_level_touch"]) == 1,
                 f"fired {s3['result']['resurface']['fired']}; note_level_touch rows "
                 f"{len([i for i in s3['insights'] if i['kind'] == 'note_level_touch'])}")

        # W7 -- a Review Date of today
        cr2 = req.post(base + "/api/j2/notes", data={"title": "AMD thesis (walk)", "ticker": "AMD",
                                                      "bodyJson": doc("Holding into the review.")})
        n2 = cr2.json()["note"]
        up2 = req.put(f"{base}/api/j2/notes/{n2['id']}", data={
            "properties": {"builtin:review_date": today_et}, "baseUpdatedAt": n2["updatedAt"]})
        s4 = scan(data_dir, {"NVDA": {"price": 103.0}}, w.out, "4-review-date")
        dd = [i for i in s4["insights"] if i["kind"] == "note_date_due"]
        w.record("W7_review_date_of_today", up2.status == 200 and s4["result"]["resurface"]["fired"] == 1
                 and len(dd) == 1 and "is today" in dd[0]["headline"],
                 f"property PUT HTTP {up2.status}; fired {s4['result']['resurface']['fired']}; {dd}")

        # W8 -- keyboard. Scoped to the NVDA door by its exact href, never by the label
        # text alone: W7's AMD review-date notice ALSO renders an "Open what you wrote"
        # door (same label), but its review-date property was set in the very PUT that
        # created it, so no version was ever checkpointed WITH that date on it (a
        # checkpoint captures the PRE-edit row -- see note_levels._versions_naming) --
        # its link therefore carries no resurfaceVersion by design, and it sorts ABOVE
        # the NVDA door (list_history orders by created_at DESC). A label-only match
        # lands keyboard/touch focus on that door first and times out waiting on a
        # sheet the product never promised for it. href_js is reused by W9 below.
        href_js = json.dumps(href)
        pg.goto(base + INBOX, wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        pg.locator(f"a[href={href_js}]").first.wait_for(state="visible", timeout=60000)
        pg.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
        presses = tab_to(pg, f"el.tagName === 'A' && el.getAttribute('href') === {href_js}")
        ok8 = False
        if presses > 0:
            pg.keyboard.press("Enter")
            try:
                sheet = pg.get_by_role("dialog", name="What you wrote then")
                sheet.wait_for(state="visible", timeout=60000)
                pg.keyboard.press("Escape")
                sheet.wait_for(state="detached", timeout=20000)
                ok8 = True
            except Exception as e:  # noqa: BLE001
                w.raw["W8_error"] = str(e)[:300]
        w.record("W8_keyboard", ok8, f"{presses} Tab presses reached the door; Enter opened the sheet, "
                 f"Escape closed it={ok8}")

        # W9 -- 390 px, touch
        state = ctx.storage_state()
        phone = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                               reduced_motion="reduce", storage_state=state)
        pp = phone.new_page()
        pp.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pp.goto(base + INBOX, wait_until="domcontentloaded")
        h._dismiss_intro(pp)
        # Scoped by href for the same reason as W8 -- not by label text, which the AMD
        # review-date door (no resurfaceVersion, sorted above NVDA's) also carries.
        pdoor = pp.locator(f"a[href={href_js}]").first
        ok9, geo = False, {}
        try:
            pdoor.wait_for(state="visible", timeout=60000)
            pdoor.scroll_into_view_if_needed()
            geo = pp.evaluate(
                """(hr) => { const a = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === hr);
                    const r = a.getBoundingClientRect();
                    return {sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, door_h: r.height, door_right: r.right} }""",
                href)
            w.shot(pp, "W9-inbox-390")
            pdoor.tap()
            sheet = pp.get_by_role("dialog", name="What you wrote then")
            sheet.wait_for(state="visible", timeout=60000)
            pp.get_by_test_id("note-version-preview").get_by_text("Stop: 100").wait_for(state="visible", timeout=30000)
            btn = pp.get_by_role("button", name="Back to the note as it is now")
            bb = btn.bounding_box()
            geo2 = pp.evaluate("() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})")
            geo.update({"sheet_sw": geo2["sw"], "sheet_cw": geo2["cw"], "button_h": bb["height"] if bb else None})
            w.shot(pp, "W9-version-sheet-390")
            ok9 = (geo["sw"] <= geo["cw"] + 1 and geo["door_h"] >= 44 and geo["door_right"] <= geo["cw"] + 1
                   and geo2["sw"] <= geo2["cw"] + 1 and (bb or {}).get("height", 0) >= 44)
        except Exception as e:  # noqa: BLE001
            w.raw["W9_error"] = str(e)[:400]
            w.shot(pp, "W9-error-390")
        w.raw["W9_geometry"] = geo
        w.record("W9_phone_390", ok9, f"geometry {geo}")
        phone.close()

        # W10 -- the gate OFF in the client
        off = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce", storage_state=state)

        def fake_me(route):
            resp = route.fetch()
            data = resp.json()
            data[FLAG_KEY] = False
            route.fulfill(response=resp, body=json.dumps(data), headers={**resp.headers, "content-type": "application/json"})
        off.route("**/api/auth/me", fake_me)
        po = off.new_page()
        off_version_requests: list[str] = []
        po.on("request", lambda r: off_version_requests.append(r.url) if "/versions/" in r.url else None)
        po.on("pageerror", lambda e: errors.append(str(e)[:300]))
        po.goto(f"{base}/journal/notebook?note={n0['id']}&resurfaceVersion={vid}", wait_until="domcontentloaded")
        h._dismiss_intro(po)
        po.locator(".ProseMirror").first.get_by_text("Target: 130").wait_for(state="visible", timeout=60000)
        po.wait_for_timeout(2500)
        absent = po.get_by_role("dialog", name="What you wrote then").count() == 0
        w.record("W10_gate_off_client", absent and not off_version_requests,
                 f"sheet absent={absent}; version requests={off_version_requests}")
        w.shot(po, "W10-gate-off-1200")
        off.close()

        w.raw["version_requests_on"] = version_requests
        w.record("W11_no_page_errors", not errors, f"{len(errors)} unforced page errors" + (f": {errors[:3]}" if errors else ""))
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8620)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port not in PORTS:
        print("REFUSED: this lane's walk uses ports 8620-8624 only")
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
    # ⛔ Written for the CHILDREN (Popen inherits it), never read here: the gate's one parse lives in
    # the app (notebook_flags.flag_on). Provider keys are blanked so no value comes from a live vendor.
    os.environ.update({"AWARENESS_NOTE_RESURFACE_ENABLED": "1",
                       "FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": ""})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    not_run = failure = None
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
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN]) if box.proc else {"clean": False, "status": "NOT BOOTED"}
    if box.proc:
        h._keep_integrity_log(integ, out / "integrity.md", own=True)
        print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    w.record("W12_driver_never_imported_api", not api_mods,
             "no api.* module in the driver's sys.modules" if not api_mods else f"imported: {api_mods[:5]}")
    result = {"tool": "tools/notebook_w13d_walk.py", "base": base, "integrity": integ, "failure": failure,
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
