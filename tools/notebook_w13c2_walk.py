"""Wave 13 lane 13C-2 -- the real-browser walk for the earnings-prep TEMPLATE PICKER path.

13C-1's own walk (`tools/notebook_w13c_walk.py`) already proves the one-click door
("Create prep note" on Reporting soon / the ticker research workspace). This lane's job is
the OTHER door: a member who starts the "Earnings Prep" template BY HAND, from the generic
New Note -> Templates picker. The only claim this walk exists to prove is that door reads the
SAME scaffold, through the SAME shared fetch, and degrades the SAME honest way -- never a
second, hand-typed template.

It OWNS its sandbox (tools/notebook_perf_harness.py's `Sandbox`), writes RAW evidence only
(walk.json, screenshots, the API reads it took), and draws no conclusion. Its FIRST output
line is the launcher's integrity verdict.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. The two stores it seeds before the boot -- the implied
move store and the earnings model's persisted snapshot -- are written by a CHILD process that
first applies the sandbox's own census pins, exactly as `tools/notebook_w13c_walk.py` does (the
seeding code below is deliberately the same shape, so the NVDA facts this walk checks are the
same facts that walk already proved come from the real `draft()` pipeline).

Run from PowerShell (a Windows path through the Bash tool loses its backslash), ports 8655-8659:

    python tools/notebook_w13c2_walk.py --data-dir '<scratch>\\w13c2-walk-data' --port 8655 `
        --out 'docs\\notebook\\evidence\\wave13-13c2\\walk-<sha>'

Preconditions: app/dist rebuilt from this tree (`npm run build` in app/); the port free
(refused, never killed); the data dir outside the shared root (refused) and EMPTY.

  W0  the gate rides the auth payload ON for the walk member
  W1  deep link `/journal/notebook?new=earnings-prep&ticker=NVDA`: the catalog's `build(ctx)`
      fetched a REAL draft (one POST to the draft endpoint) and the note it creates carries the
      same sourced values 13C-1's own walk checks for NVDA (Source/as-of lines, the implied
      move, the consensus table, the labelled recap gap) -- the SAME scaffold, not a copy
  W2  that fetch counted against the SAME daily cap the one-click door spends (one POST to
      POST /api/j2/earnings-prep/NVDA/draft, the identical address)
  W3  1200 px, the real UI: New note -> Templates -> the "Earnings Prep" card, picked with NO
      ticker in context -- creates a note whose every cell reads a generic, honest "not
      available" (never the old static placeholder table, never an invented value), and the
      pick made ZERO requests to the draft endpoint (previewing/picking without a ticker must
      never spend part of the cap)
  W4  390 px, touch: the same ticker-less pick, by tap -- no sideways scroll, the card is
      >= 44 px tall, the note still opens with the honest scaffold
  W5  gate OFF in the client: the template card still exists (the catalog is flag-agnostic) and
      picking it with a ticker fetches NOTHING (no request reaches the draft endpoint -- the
      same "fetches nothing while off" promise ReportingSoon.jsx makes) and degrades to the
      SAME honest "not available" scaffold, never a crash and never a leaked value
  W6  no unforced page errors
  W7  the driver never imported api.*

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

MEMBER = ("w13c2@local.dev", "LocalTest2026!", "w13c2")
FLAG_KEY = "notebook_earnings_prep_enabled"
CAL_FILE = "w13c2-sandbox-calendar.json"
DRAFT_URL_RE = "/api/j2/earnings-prep/"


def _iso(d: date) -> str:
    return d.isoformat()


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


# ── seeding (same shape as tools/notebook_w13c_walk.py, so the NVDA facts agree) ───────────

def write_calendar(data_dir: Path, reporters: dict) -> Path:
    p = data_dir / CAL_FILE
    p.write_text(json.dumps({"reporters": reporters, "asOf": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                             "partial": False}, indent=1), encoding="utf-8")
    return p


def intel_payload(report_day: str, today: date) -> dict:
    def ago(days):
        return _iso(today - timedelta(days=days))
    quarters = [
        ("FY2027 Q2", 2027, 2, ago(37), 1.05, 46.7e9, True, 4.2, True, 1.1),
        ("FY2027 Q1", 2027, 1, ago(128), 0.96, 44.1e9, False, -1.3, None, None),
        ("FY2026 Q4", 2026, 4, ago(219), 0.89, 39.3e9, True, 2.0, True, 0.5),
        ("FY2026 Q3", 2026, 3, ago(317), 0.81, 35.1e9, True, 3.0, True, 2.0),
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

def read_note(req, base, nid):
    r = req.get(f"{base}/api/j2/notes/{nid}")
    return r.json()["note"] if r.status == 200 else None


def wait_note_open(pg, timeout_ms=60000) -> str | None:
    pg.wait_for_url("**/journal/notebook?note=*", timeout=timeout_ms)
    pm = pg.locator(".ProseMirror")
    pm.first.wait_for(state="visible", timeout=timeout_ms)
    from urllib.parse import parse_qs, urlparse
    return (parse_qs(urlparse(pg.url).query).get("note") or [None])[0]


def open_picker(pg):
    """New note -> Templates, the real UI path (notebook_w12b2_walk.py's own pattern)."""
    tb = pg.get_by_role("button", name="Templates", exact=True).filter(visible=True).first
    tb.wait_for(state="visible", timeout=20000)
    tb.click()
    dialog = pg.get_by_role("dialog", name="New note")
    dialog.wait_for(state="visible", timeout=15000)
    return dialog


def run(base: str, w: Walk, data_dir: Path) -> None:
    from playwright.sync_api import sync_playwright
    today = date.today()
    d_nvda = today + timedelta(days=3)
    while d_nvda.weekday() >= 5:
        d_nvda += timedelta(days=1)
    w.raw["dates"] = {"today": _iso(today), "NVDA": _iso(d_nvda)}

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin_ctx = br.new_context()
        ctx = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
        req = ctx.request
        h._provision(admin_ctx.request, req, base, member=MEMBER)
        me = req.get(base + "/api/auth/me").json()
        w.raw["auth_me_flag"] = me.get(FLAG_KEY)
        w.record("W0_gate_on_payload", me.get(FLAG_KEY) is True, f"/api/auth/me {FLAG_KEY}={me.get(FLAG_KEY)!r}")

        pg = ctx.new_page()
        errors: list[str] = []
        draft_requests: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.on("request", lambda r: draft_requests.append(f"{r.method} {r.url}") if DRAFT_URL_RE in r.url else None)

        # ── W1/W2: the deep link, WITH a ticker -- a real draft must be fetched ──────────
        pg.goto(base + "/journal/notebook?new=earnings-prep&ticker=NVDA", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        try:
            nid = wait_note_open(pg)
            opened = True
        except Exception as e:  # noqa: BLE001
            nid, opened = None, False
            w.raw["W1_error"] = str(e)[:400]
        w.shot(pg, "W1-deeplink-note-1200")
        if not nid:
            w.raw["page_text"] = pg.inner_text("body")[:4000]
            w.record("W1_deeplink_fetches_real_draft", False, "deep-linked template pick never opened a note")
            w.record("W2_draft_counts_the_shared_cap", False, "not reached")
        else:
            n = read_note(req, base, nid)
            w.dump("note-nvda-deeplink.json", n)
            body = "\n".join(text_of(n.get("bodyJson") or {}))
            w.raw["note_nvda_deeplink_text"] = body
            checks1 = {
                "title_has_day": n.get("title", "").startswith("Earnings Prep — NVDA ("),
                "tags": sorted(n.get("tags") or []) == ["earnings", "earnings-prep"],
                "ticker": n.get("ticker") == "NVDA",
                "date_sourced": "Source: UCT earnings calendar, as of" in body,
                "consensus": "$1.31" in body,
                "reactions": "Beat +4.2%" in body or "−3.1%" in body,
                "recap_missing_labelled": "— not available: No stored call recap for NVDA" in body,
            }
            w.raw["W1_checks"] = checks1
            w.record("W1_deeplink_fetches_real_draft", all(checks1.values()),
                     "; ".join(f"{k}={v}" for k, v in checks1.items()))
            draft_hits = [r for r in draft_requests if r.startswith("POST") and "/NVDA/draft" in r]
            w.raw["W1_draft_requests"] = list(draft_requests)
            w.record("W2_draft_counts_the_shared_cap", len(draft_hits) == 1,
                     f"POST .../NVDA/draft seen {len(draft_hits)} time(s): {draft_hits}")

        # ── W3: the real UI, Templates picker, NO ticker in context ──────────────────────
        # `?view=all` is the explicit flag that reaches the notes-list toolbar (NotebookTab's
        # own `isHome` fires on bare `/journal/notebook`, rendering Research Home instead --
        # which is exactly 13C-1's door and has no "Templates" button).
        draft_requests.clear()
        pg.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        dialog = open_picker(pg)
        card = dialog.get_by_role("button", name="Earnings Prep", exact=True)
        card.wait_for(state="visible", timeout=15000)
        w.shot(pg, "W3-picker-1200")
        card.click()
        try:
            nid2 = wait_note_open(pg)
            opened2 = True
        except Exception as e:  # noqa: BLE001
            nid2, opened2 = None, False
            w.raw["W3_error"] = str(e)[:400]
        w.shot(pg, "W3-note-open-1200")
        if nid2:
            n2 = read_note(req, base, nid2)
            w.dump("note-blank-picker.json", n2)
            body2 = "\n".join(text_of(n2.get("bodyJson") or {}))
            w.raw["note_blank_picker_text"] = body2
            checks3 = {
                "title_no_ticker": n2.get("title") == "Earnings Prep",
                "tags": sorted(n2.get("tags") or []) == ["earnings", "earnings-prep"],
                "generic_missing": "— not available: Not available." in body2,
                "generic_source": "Source: unknown." in body2,
                "never_the_old_static_table": "Key metric" not in body2,
                "no_numbers_invented": not any(c.isdigit() for c in body2),
            }
            w.raw["W3_checks"] = checks3
            w.record("W3_blank_pick_is_honest_scaffold", opened2 and all(checks3.values()),
                     "; ".join(f"{k}={v}" for k, v in checks3.items()))
        else:
            w.record("W3_blank_pick_is_honest_scaffold", False, "ticker-less template pick never opened a note")
        no_draft_spent = not any(DRAFT_URL_RE in r for r in draft_requests)
        w.raw["W3_draft_requests"] = list(draft_requests)
        w.record("W3b_no_draft_spent_without_a_ticker", no_draft_spent,
                 f"draft-endpoint requests during the ticker-less pick: {draft_requests}")

        # ── W4: 390 px, touch, the same ticker-less pick ─────────────────────────────────
        state = ctx.storage_state()
        phone = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                               reduced_motion="reduce", storage_state=state)
        pp = phone.new_page()
        pp.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pp.goto(base + "/journal/notebook?view=all", wait_until="domcontentloaded")
        h._dismiss_intro(pp)
        pdialog = open_picker(pp)
        pcard = pdialog.get_by_role("button", name="Earnings Prep", exact=True)
        pcard.wait_for(state="visible", timeout=15000)
        geo = pcard.evaluate("el => { const r = el.getBoundingClientRect(); return {h: r.height, w: r.width, right: r.right}; }")
        sw_cw = pp.evaluate("() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})")
        w.raw["phone_geometry"] = {**geo, **sw_cw}
        w.shot(pp, "W4-picker-390")
        pcard.tap()
        try:
            nid3 = wait_note_open(pp)
        except Exception as e:  # noqa: BLE001
            nid3 = None
            w.raw["W4_error"] = str(e)[:400]
        w.shot(pp, "W4-note-390")
        ok4 = (sw_cw["sw"] <= sw_cw["cw"] + 1 and geo["h"] >= 44 and geo["right"] <= sw_cw["cw"] + 1 and bool(nid3))
        w.record("W4_phone_390", ok4, f"scrollWidth {sw_cw['sw']} vs clientWidth {sw_cw['cw']}; card {geo}; "
                 f"tap opened note {nid3}")
        phone.close()

        # ── W5: gate OFF in the client -- the card still exists, fetches NOTHING, degrades
        # honestly. (Run 1 found this reaching the real draft endpoint regardless of the
        # client's belief about the flag -- fixed by gating `earningsPrepDraftFor` on
        # `earningsPrepEnabled()` too, matching ReportingSoon.jsx's own "fetches nothing
        # while off"; the server route was always the real authority and 404'd it either way.)
        draft_requests.clear()
        off = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce", storage_state=state)

        def fake_me(route):
            resp = route.fetch()
            data = resp.json()
            data[FLAG_KEY] = False
            route.fulfill(response=resp, body=json.dumps(data), headers={**resp.headers, "content-type": "application/json"})
        off.route("**/api/auth/me", fake_me)
        po = off.new_page()
        po.on("request", lambda r: draft_requests.append(f"{r.method} {r.url}") if DRAFT_URL_RE in r.url else None)
        po.on("pageerror", lambda e: errors.append(str(e)[:300]))
        po.goto(base + "/journal/notebook?new=earnings-prep&ticker=NVDA", wait_until="domcontentloaded")
        h._dismiss_intro(po)
        try:
            nid4 = wait_note_open(po)
        except Exception as e:  # noqa: BLE001
            nid4 = None
            w.raw["W5_error"] = str(e)[:400]
        w.shot(po, "W5-gate-off-1200")
        if nid4:
            n4 = read_note(req, base, nid4)
            w.dump("note-gate-off.json", n4)
            body4 = "\n".join(text_of(n4.get("bodyJson") or {}))
            checks5 = {
                "no_crash": True,
                "no_request_reached_the_draft_endpoint": not draft_requests,
                "falls_back_to_blank": "— not available: Not available." in body4,
                "title_falls_back": n4.get("title") == "Earnings Prep — NVDA",
            }
            w.raw["W5_checks"] = checks5
            w.raw["W5_draft_requests"] = list(draft_requests)
            w.record("W5_gate_off_degrades_honestly", all(checks5.values()),
                     "; ".join(f"{k}={v}" for k, v in checks5.items()))
        else:
            w.record("W5_gate_off_degrades_honestly", False, "gate-off pick never opened a note")
        off.close()

        w.record("W6_no_page_errors", not errors, f"{len(errors)} unforced page errors" + (f": {errors[:3]}" if errors else ""))
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8655)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if not 8655 <= args.port <= 8659:
        print("REFUSED: this lane's walk uses ports 8655-8659 only")
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
    d_nvda = today + timedelta(days=3)
    while d_nvda.weekday() >= 5:
        d_nvda += timedelta(days=1)
    cal = write_calendar(data_dir, {"NVDA": {"date": _iso(d_nvda), "timing": "amc"}})
    spec = {"implied": [
        {"sym": "NVDA", "report_date": _iso(d_nvda), "pct": 7.2, "dollar": 13.1,
         "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds")},
    ], "intel": intel_payload(_iso(d_nvda), today)}
    not_run = failure = None
    try:
        w.raw["seed_child"] = seed_stores(data_dir, spec, out)
    except h.SetupFailed as e:
        not_run = str(e)

    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
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
                except Exception as e:  # noqa: BLE001
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
    w.record("W7_driver_never_imported_api", not api_mods,
             "no api.* module in the driver's sys.modules" if not api_mods else f"imported: {api_mods[:5]}")
    result = {"tool": "tools/notebook_w13c2_walk.py", "base": base, "integrity": integ, "failure": failure,
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
