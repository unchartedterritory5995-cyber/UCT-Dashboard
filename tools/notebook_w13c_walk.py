"""Wave 13 lane 13C -- the real-browser walk for earnings prep (Reporting soon + a prep note).

It OWNS its sandbox (tools/notebook_perf_harness.py's `Sandbox`: scripts/hub_sandbox_boot.py through
the SIGBREAK shim, its own process group, stopped gracefully so the launcher's `finally` writes the
SHUTDOWN checkpoint). Its FIRST output line is the launcher's integrity verdict. It writes RAW
evidence only (walk.json, screenshots, the API reads it took) and draws no conclusion.

⛔ THIS DRIVER NEVER IMPORTS `api.*` (it would arm the app's import-time readers in the driver's own
process). The two stores it seeds before the boot -- the implied-move store and the earnings model's
persisted snapshot -- are written by a CHILD process that first applies the sandbox's own census
pins (`hub_sandbox_boot.apply_sandbox_env`, which also arms the shared-root tripwire). The last row
asserts the driver's `sys.modules`.

⛔ NO MODEL AND NO ALPHAVANTAGE. The launcher blanks every model key. The calendar window, which
otherwise lives in process memory or behind live vendors, is the sandbox-only calendar file
(`NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR`, read only off Railway with the conftest imported). Every
other value goes through the real code path: the implied store, the earnings model's snapshot
store, the member's own watchlist, position and note made through the product's own routes.

Run from PowerShell (a Windows path through the Bash tool loses its backslash), ports 8605-8609:

    python tools/notebook_w13c_walk.py --data-dir '<scratch>\\w13c-walk-data' --port 8605 `
        --out 'docs\\notebook\\evidence\\wave13-13c\\walk-<sha>'

Preconditions: app/dist rebuilt from this tree (`npm run build` in app/); the port free (refused,
never killed); the data dir outside the shared root (refused) and EMPTY (a re-run must not inherit
a previous run's notes).

  W0  the gate rides the auth payload ON for the walk member
  W1  1200 px: Research Home shows Reporting soon with NVDA (open position, after the close) and
      AMD (watchlist, time not announced); META reports too but is nobody's name here -- absent
  W2  nothing was created by showing the list (the note count is what the seeding left)
  W3  keyboard: Tab reaches "Create prep note for NVDA", Enter drafts and opens the new note
  W4  the note body (read back through the API): every value with "Source: ..., as of", the
      pre-report implied move, the consensus and the four reactions from the earnings model,
      the member's own note CITED by id, and labelled dashes for what UCT does not hold (the
      stored recap, closed trades)
  W5  the editor renders it (the labels are on screen, not just in storage)
  W6  back on Home, NVDA now offers Open prep note
  W7  frozen: the calendar moves NVDA's date; the list follows, the note does not change
  W8  390 px, touch: no sideways scroll on Home, the Create button is >= 44 px tall, a tap drafts
      the AMD note, whose missing timing is labelled
  W9  the ticker research workspace carries the Earnings prep entry point
  W10 gate OFF in the client (the auth payload answered false): no Reporting soon, no request
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
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)

MEMBER = ("w13c@local.dev", "LocalTest2026!", "w13c")
FLAG_KEY = "notebook_earnings_prep_enabled"
CAL_FILE = "w13c-sandbox-calendar.json"


def _iso(d: date) -> str:
    return d.isoformat()


def _next_weekday(d: date, n: int) -> date:
    out = d
    while n > 0:
        out += timedelta(days=1)
        if out.weekday() < 5:
            n -= 1
    return out


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


def text_of(node, out=None):
    out = [] if out is None else out
    if isinstance(node, dict):
        if node.get("type") == "text":
            out.append(node.get("text", ""))
        if node.get("type") == "noteLink":
            out.append(f"[[note:{(node.get('attrs') or {}).get('noteId')}]]")
        for c in node.get("content") or []:
            text_of(c, out)
    return out


# ── seeding ─────────────────────────────────────────────────────────────────────────────

def write_calendar(data_dir: Path, reporters: dict) -> Path:
    p = data_dir / CAL_FILE
    p.write_text(json.dumps({"reporters": reporters, "asOf": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                             "partial": False}, indent=1), encoding="utf-8")
    return p


def intel_payload(report_day: str, today: date) -> dict:
    """The earnings model's own payload shape (earnings_intel._build), as a stored snapshot."""
    def ago(days):
        return _iso(today - timedelta(days=days))
    quarters = [
        ("FY2027 Q2", 2027, 2, ago(37), 1.05, 46.7e9, True, 4.2, True, 1.1),
        ("FY2027 Q1", 2027, 1, ago(128), 0.96, 44.1e9, False, -1.3, None, None),
        ("FY2026 Q4", 2026, 4, ago(219), 0.89, 39.3e9, True, 2.0, True, 0.5),
        ("FY2026 Q3", 2026, 3, ago(317), 0.81, 35.1e9, True, 3.0, True, 2.0),
        ("FY2026 Q2", 2026, 2, ago(408), 0.68, 30.0e9, True, 1.0, True, 1.0),
    ]
    q_rows = [{"label": l, "fiscal_year": fy, "fiscal_quarter": fq, "report_date": rd, "reported": True,
               "eps_actual": ea, "revenue_actual": ra, "eps_beat": eb, "eps_surprise_pct": ep,
               "rev_beat": rb, "rev_surprise_pct": rp, "eps_basis": "consensus_comparable"}
              for (l, fy, fq, rd, ea, ra, eb, ep, rb, rp) in quarters]
    return {
        "ticker": "NVDA",
        "quarters": q_rows,
        "estimates": [{"label": "FY2027 Q3", "fiscal_year": 2027, "fiscal_quarter": 3, "report_date": report_day,
                       "reported": False, "eps_estimate": 1.31, "revenue_estimate": 54.0e9,
                       "eps_yoy_pct": 61.7, "rev_yoy_pct": 53.8}],
        "annual": {},
        "summary": {"next_report_date": report_day},
        "reaction": {"events": [
            {"quarter": "FY2026 Q3", "report_date": ago(317), "reaction_pct": 1.0},
            {"quarter": "FY2026 Q4", "report_date": ago(219), "reaction_pct": -8.5},
            {"quarter": "FY2027 Q1", "report_date": ago(128), "reaction_pct": 2.4},
            {"quarter": "FY2027 Q2", "report_date": ago(37), "reaction_pct": -3.1},
        ], "avg_abs_move_pct": 3.75, "n_quarters": 4},
        "next_report_date": report_day,
        "meta": {"retrieved_at": time.time(), "actuals_source": "walk-seed"},
    }


SEED_CHILD = r'''
import json, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services import implied_store, fundamentals_snapshot_store as snap, earnings_intel
for row in spec["implied"]:
    implied_store.record_implied(row["sym"], row["report_date"], {"pct": row["pct"], "dollar": row["dollar"],
                                 "source": "walk-seed"}, row["captured_at"])
snap.put(earnings_intel._KIND, "NVDA", spec["intel"], 7 * 86400)
print("SEEDED", implied_store.DB_PATH, len(implied_store.get_implied_history("NVDA")))
'''


def seed_stores(data_dir: Path, spec: dict, out: Path) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", SEED_CHILD, str(REPO), str(data_dir), json.dumps(spec)],
                       cwd=str(REPO), env=env, capture_output=True, text=True, timeout=600)
    (out / "seed-child.log").write_text((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or "")[-6000:],
                                        encoding="utf-8")
    if r.returncode != 0 or "SEEDED" not in (r.stdout or ""):
        raise h.SetupFailed(f"seeding the stores failed (rc {r.returncode}); see seed-child.log")
    return [l for l in r.stdout.splitlines() if l.startswith("SEEDED")][-1]


# ── the walk ────────────────────────────────────────────────────────────────────────────

def list_prep_notes(req, base):
    r = req.get(base + "/api/j2/notes?tag=earnings-prep&sort=created")
    return (r.json().get("notes") or []) if r.status == 200 else []


def count_notes(req, base):
    r = req.get(base + "/api/j2/notes?limit=500")
    return len(r.json().get("notes") or []) if r.status == 200 else -1


def read_note(req, base, nid):
    r = req.get(f"{base}/api/j2/notes/{nid}")
    return r.json()["note"] if r.status == 200 else None


def wait_note_open(pg, timeout_ms=60000) -> str | None:
    pg.wait_for_url("**/journal/notebook?note=*", timeout=timeout_ms)
    pm = pg.locator(".ProseMirror")
    pm.first.wait_for(state="visible", timeout=timeout_ms)
    pg.get_by_text("The report", exact=True).first.wait_for(state="visible", timeout=timeout_ms)
    from urllib.parse import parse_qs, urlparse
    return (parse_qs(urlparse(pg.url).query).get("note") or [None])[0]


def run(base: str, w: Walk, data_dir: Path) -> None:
    from playwright.sync_api import sync_playwright
    today = date.today()
    d_amd, d_meta, d_nvda = _next_weekday(today, 1), _next_weekday(today, 2), _next_weekday(today, 3)
    d_nvda_moved = _next_weekday(today, 4)
    w.raw["dates"] = {"today": _iso(today), "AMD": _iso(d_amd), "META": _iso(d_meta), "NVDA": _iso(d_nvda),
                      "NVDA_moved": _iso(d_nvda_moved)}

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
        req = ctx.request
        h._provision(admin_ctx.request, req, base, member=MEMBER)
        me = req.get(base + "/api/auth/me").json()
        w.raw["auth_me_flag"] = me.get(FLAG_KEY)
        w.record("W0_gate_on_payload", me.get(FLAG_KEY) is True, f"/api/auth/me {FLAG_KEY}={me.get(FLAG_KEY)!r}")

        # the member's own sets, through the product's own routes
        wl = req.post(base + "/api/watchlists", data={"name": "W13C walk list"})
        wl_id = (wl.json() or {}).get("id") if wl.status in (200, 201) else None
        it = req.post(f"{base}/api/watchlists/{wl_id}/items", data={"sym": "AMD"}) if wl_id else None
        pos = req.post(base + "/api/j2/positions", data={
            "symbol": "NVDA", "side": "Long", "entryDate": _iso(today - timedelta(days=10)),
            "shares": 100, "entryPrice": 180.0, "stopPrice": 170.0})
        note = req.post(base + "/api/j2/notes", data={
            "title": "NVDA thesis (walk)", "ticker": "NVDA",
            "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": "Long into the print; the data center number is the story."}]}]}})
        seeded_note = note.json()["note"]["id"] if note.status in (200, 201) else None
        w.raw["seed_http"] = {"watchlist": wl.status, "item": it.status if it else None, "position": pos.status,
                              "note": note.status, "seeded_note_id": seeded_note}
        if not (wl_id and it and it.status in (200, 201) and pos.status in (200, 201) and seeded_note):
            raise h.SetupFailed(f"seeding the member's sets failed: {w.raw['seed_http']}")
        n_seeded = count_notes(req, base)

        soon1 = req.get(base + "/api/j2/earnings-prep/soon")
        w.raw["soon_1_status"] = soon1.status
        w.dump("soon-1.json", soon1.json() if soon1.status == 200 else {"status": soon1.status})

        pg = ctx.new_page()
        errors: list[str] = []
        prep_requests: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        heading = pg.get_by_role("heading", name="Reporting soon")
        heading.wait_for(state="visible", timeout=60000)
        create_nvda = pg.get_by_role("button", name="Create prep note for NVDA")
        create_nvda.wait_for(state="visible", timeout=30000)
        section = pg.locator("[data-reporting-soon]")
        sec_text = section.inner_text()
        w.raw["home_section_text_1200"] = sec_text
        ok1 = ("$NVDA" in sec_text and "$AMD" in sec_text and "$META" not in sec_text
               and "after the close" in sec_text and "time not announced yet" in sec_text
               and "Open position" in sec_text and "Watchlist" in sec_text)
        w.record("W1_list_1200", ok1, f"section text: {sec_text!r}")
        w.shot(pg, "W1-home-1200")

        w.record("W2_no_note_without_a_click", count_notes(req, base) == n_seeded and not list_prep_notes(req, base),
                 f"notes after showing the list: {count_notes(req, base)} (seeded {n_seeded}); "
                 f"earnings-prep notes: {len(list_prep_notes(req, base))}")

        # W3 -- keyboard: Tab to the button, Enter
        pg.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
        presses = tab_to(pg, name_is("Create prep note for NVDA"))
        t0 = time.time()
        pg.keyboard.press("Enter")
        try:
            nvda_note = wait_note_open(pg)
            opened = True
        except Exception as e:  # noqa: BLE001
            nvda_note, opened = None, False
            w.raw["W3_error"] = str(e)[:400]
        took = round(time.time() - t0, 2)
        w.record("W3_create_by_keyboard", presses > 0 and opened and bool(nvda_note),
                 f"{presses} Tab presses reached the button; Enter drafted and opened note {nvda_note} in {took}s")
        w.shot(pg, "W3-note-open-1200")
        if not nvda_note:
            w.raw["page_text"] = pg.inner_text("body")[:4000]
            return

        # W4 -- the stored body
        n = read_note(req, base, nvda_note)
        w.dump("note-nvda.json", n)
        body = "\n".join(text_of(n.get("bodyJson") or {}))
        w.raw["note_nvda_text"] = body
        checks4 = {
            "title": n.get("title", "").startswith("Earnings Prep — NVDA"),
            "tags": sorted(n.get("tags") or []) == ["earnings", "earnings-prep"],
            "ticker": n.get("ticker") == "NVDA",
            "date_sourced": "Source: UCT earnings calendar, as of" in body,
            "after_the_close": "after the close" in body,
            "implied_move": "±7.2% ($13.10)" in body and "Source: Options-implied move, captured by UCT before the report, as of" in body,
            "consensus": "$1.31" in body and "$54.00B" in body and "$0.81" in body,
            "reactions": "Beat +4.2%" in body and "−3.1%" in body and "±6.9%" in body,
            "cited_note": f"[[note:{seeded_note}]]" in body,
            "position": "Long 100 shares, at $180.00, stop $170.00" in body,
            "recap_missing_labelled": "— not available: No stored call recap for NVDA" in body,
            "trades_missing_labelled": "— not available: You have no closed trades in NVDA in your journal." in body,
        }
        w.raw["W4_checks"] = checks4
        w.record("W4_body_sourced_and_labelled", all(checks4.values()),
                 "; ".join(f"{k}={v}" for k, v in checks4.items()))

        # W5 -- the editor shows it
        ed = pg.locator(".ProseMirror").first.inner_text()
        w.raw["editor_text_1200"] = ed[:6000]
        ok5 = ("Source: UCT earnings calendar" in ed and "not available: No stored call recap for NVDA" in ed
               and "NVDA thesis (walk)" in ed)
        w.record("W5_editor_renders_labels", ok5, "editor shows the source lines, the labelled recap gap and the "
                 f"cited note's title={ok5}")
        w.shot(pg, "W5-editor-labels-1200")

        # W6 -- Home now offers Open
        pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        opener = pg.get_by_role("button", name="Open the NVDA prep note")
        try:
            opener.wait_for(state="visible", timeout=30000)
            ok6 = True
        except Exception:  # noqa: BLE001
            ok6 = False
        w.record("W6_open_instead_of_redraft", ok6, f"'Open the NVDA prep note' shown={ok6}")
        w.shot(pg, "W6-home-open-1200")

        # W7 -- frozen
        before_updated = n.get("updatedAt")
        write_calendar(data_dir, {"NVDA": {"date": _iso(d_nvda_moved), "timing": "amc"},
                                  "AMD": {"date": _iso(d_amd)}, "META": {"date": _iso(d_meta), "timing": "bmo"}})
        soon2 = req.get(base + "/api/j2/earnings-prep/soon").json()
        w.dump("soon-2-after-calendar-move.json", soon2)
        moved = next((i for i in soon2.get("items", []) if i["symbol"] == "NVDA"), {})
        n2 = read_note(req, base, nvda_note)
        body2 = "\n".join(text_of(n2.get("bodyJson") or {}))
        ok7 = (moved.get("date") == _iso(d_nvda_moved) and n2.get("updatedAt") == before_updated and body2 == body)
        w.record("W7_frozen_values_survive_a_data_change", ok7,
                 f"list now says NVDA {moved.get('date')}; the note's revision unchanged="
                 f"{n2.get('updatedAt') == before_updated}, body unchanged={body2 == body}")

        # W9 -- the research workspace entry point (1200)
        # Run 2 measured this page loading AFTER a 30 s wait: the workspace's own summary read
        # resolves the company name through providers this sandbox has no keys for. The wait is
        # on the workspace HEADER (the page's own answer), and its load time is recorded.
        t9 = time.time()
        pg.goto(base + "/journal/notebook/research/NVDA", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        prep_btn = pg.get_by_role("button", name="Earnings prep")
        try:
            pg.get_by_role("heading", name="NVDA", exact=True).wait_for(state="visible", timeout=90000)
            loaded = round(time.time() - t9, 1)
            prep_btn.wait_for(state="visible", timeout=5000)
            ok9 = True
        except Exception:  # noqa: BLE001
            loaded, ok9 = None, False
        w.raw["W9_workspace_load_s"] = loaded
        w.record("W9_research_workspace_entry", ok9,
                 f"'Earnings prep' button on /journal/notebook/research/NVDA={ok9}; workspace header after {loaded}s")
        w.shot(pg, "W9-research-workspace-1200")

        # W8 -- 390 px, touch
        state = ctx.storage_state()
        phone = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                               reduced_motion="reduce", storage_state=state)
        pp = phone.new_page()
        pp.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pp.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        h._dismiss_intro(pp)
        amd = pp.get_by_role("button", name="Create prep note for AMD")
        amd.wait_for(state="visible", timeout=60000)
        amd.scroll_into_view_if_needed()
        geo = pp.evaluate("""() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
            btn: (() => { const b = document.querySelector('[aria-label="Create prep note for AMD"]'); const r = b.getBoundingClientRect(); return {h: r.height, w: r.width, right: r.right}; })()})""")
        w.raw["phone_geometry"] = geo
        w.raw["home_section_text_390"] = pp.locator("[data-reporting-soon]").inner_text()
        w.shot(pp, "W8-home-390")
        amd.tap()
        try:
            amd_note = wait_note_open(pp)
        except Exception as e:  # noqa: BLE001
            amd_note = None
            w.raw["W8_error"] = str(e)[:400]
        w.shot(pp, "W8-note-390")
        an = read_note(req, base, amd_note) if amd_note else {}
        w.dump("note-amd.json", an)
        amd_body = "\n".join(text_of((an or {}).get("bodyJson") or {}))
        ok8 = (geo["sw"] <= geo["cw"] + 1 and geo["btn"]["h"] >= 44 and geo["btn"]["right"] <= geo["cw"] + 1
               and bool(amd_note)
               and "— not available: The calendar has not said before or after the bell yet." in amd_body
               and "Source: UCT earnings calendar, as of" in amd_body)
        w.record("W8_phone_390", ok8, f"scrollWidth {geo['sw']} vs clientWidth {geo['cw']}; button {geo['btn']}; "
                 f"tap drafted note {amd_note}; timing gap labelled in its body")
        phone.close()

        # W10 -- the gate OFF in the client: the auth payload answers false
        off = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce", storage_state=state)

        def fake_me(route):
            resp = route.fetch()
            data = resp.json()
            data[FLAG_KEY] = False
            route.fulfill(response=resp, body=json.dumps(data), headers={**resp.headers, "content-type": "application/json"})
        off.route("**/api/auth/me", fake_me)
        po = off.new_page()
        po.on("request", lambda r: prep_requests.append(r.url) if "/api/j2/earnings-prep/" in r.url else None)
        po.on("pageerror", lambda e: errors.append(str(e)[:300]))
        po.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        h._dismiss_intro(po)
        po.get_by_role("heading", name="Continue working").first.wait_for(state="visible", timeout=60000)
        po.wait_for_timeout(2500)
        absent = po.get_by_role("heading", name="Reporting soon").count() == 0
        w.record("W10_gate_off_client", absent and not prep_requests,
                 f"Reporting soon absent={absent}; earnings-prep requests={prep_requests}")
        w.shot(po, "W10-home-gate-off-1200")
        off.close()

        w.record("W11_no_page_errors", not errors, f"{len(errors)} unforced page errors" + (f": {errors[:3]}" if errors else ""))
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8605)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if not 8605 <= args.port <= 8609:
        print("REFUSED: this lane's walk uses ports 8605-8609 only")
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

    today = date.today()
    d_amd, d_meta, d_nvda = _next_weekday(today, 1), _next_weekday(today, 2), _next_weekday(today, 3)
    cal = write_calendar(data_dir, {"NVDA": {"date": _iso(d_nvda), "timing": "amc"},
                                    "AMD": {"date": _iso(d_amd)},
                                    "META": {"date": _iso(d_meta), "timing": "bmo"}})
    spec = {"implied": [
        {"sym": "NVDA", "report_date": _iso(d_nvda), "pct": 7.2, "dollar": 13.1,
         "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds")},
        {"sym": "NVDA", "report_date": _iso(today - timedelta(days=37)), "pct": 6.9, "dollar": 11.0,
         "captured_at": _iso(today - timedelta(days=38)) + "T21:00:00Z"},
    ], "intel": intel_payload(_iso(d_nvda), today)}
    not_run = failure = None
    try:
        w.raw["seed_child"] = seed_stores(data_dir, spec, out)
    except h.SetupFailed as e:
        not_run = str(e)

    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    # ⛔ Written for the CHILD (Popen inherits it), never read here: the gate's one parse lives in
    # the app (notebook_flags.flag_on). The provider keys are blanked so no market value can come
    # from a live vendor: every value in the note is one this walk seeded or a labelled gap.
    os.environ.update({"NOTEBOOK_EARNINGS_PREP_ENABLED": "1",
                       "NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR": str(cal),
                       "FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": ""})
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
    w.record("W12_driver_never_imported_api", not api_mods,
             "no api.* module in the driver's sys.modules" if not api_mods else f"imported: {api_mods[:5]}")
    result = {"tool": "tools/notebook_w13c_walk.py", "base": base, "integrity": integ, "failure": failure,
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
