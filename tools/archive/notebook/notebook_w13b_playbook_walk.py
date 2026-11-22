"""Wave 13 lane 13B live walk -- My Playbook in a real Chromium, against a LOCAL sandbox. It writes RAW
evidence only: docs/notebook/evidence/wave13-13b/walk-<sha>/walk.json (+ the launcher's integrity
log and screenshots). It is NOT a pytest rail, and it draws no conclusion: each row records what
the browser and the API showed.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. It owns its sandbox through the perf harness's `Sandbox`
(scripts/hub_sandbox_boot.py, own process group, stopped gracefully so the launcher writes its
SHUTDOWN checkpoint), talks to it over HTTP only, and prints the launcher's snapshot verdict
(`SANDBOX INTEGRITY: ...`) as its FIRST output line. No model is called.

Run it from POWERSHELL with the gates in that same shell (ports 8635-8639 only):

    $env:NOTEBOOK_PLAYBOOK_ENABLED = '1'; $env:NOTEBOOK_PLAN_GRADING_ENABLED = '1'
    python tools/notebook_w13b_playbook_walk.py --data-dir '<scratchpad>\\w13b-data' --port 8635 `
        --out docs/notebook/evidence/wave13-13b/walk-<sha>/walk.json --tip <sha> `
        --artifacts docs/notebook/evidence/wave13-13b/walk-<sha>

    # the flag-OFF pass, in a shell with NOTEBOOK_PLAYBOOK_ENABLED unset:
    python tools/notebook_w13b_playbook_walk.py --flag-off --data-dir ... --port 8636 --out .../walk-off.json ...

Preconditions: app/dist built from the tip; the port free (refused, never killed); the data dir
outside the shared root (refused). One paid member (comped by the launcher's admin).

The trades behind the patterns are seeded the way a member makes them: a plan NOTE on the ticker
first (its words are what the miner counts), then the trade a minute later, then 13A's grade read,
which FREEZES the note as that trade's plan in j2_trade_plan_links. My Playbook reads that frozen
link as "a note linked to the trade, as it stood at entry".

  W0  the gate rides the auth payload ON; the sandbox is who it says it is
  W1  seed (member's API): 42 closed trades -- Pullback 25 (normal), Breakout 12 (thin; each on its
      own ticker with a plan note written BEFORE entry: FOMO before 4 of 5 losses and 1 of 7 wins,
      patient before 4 of 7 wins), EP 3 (too few), 2 untagged; 13A's grade read freezes each plan
  W2  open My Playbook from Insights > Playbook (1200 px, mouse): three cards, the R3 labels on
      screen match the API's bands; every n on screen is the API's
  W3  drill a number (1200): Breakout's win rate opens exactly winRateStat.n trades
  W4  the too-few reveal: EP's numbers sit behind "too few to judge" until opened
  W5  a cited pattern finding: FOMO leans losses with both counts and both n; its citations list
      the trades and link the notes
  W6  the frozen snapshot note: one click; the note exists with the numbers as text
  W7  keyboard: Tab reaches a number and Enter opens its trades
  W8  390 px (touch): the page, a drill by tap; no sideways scroll; controls >= 44 px
  W9  no unforced page error across the walk
  --flag-off: F0 payload flag false; F1 GET /api/j2/my-playbook answers 404; F2 the page sends the
      member to Insights; F3 Insights > Playbook shows no door
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import sys
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))
from tools import notebook_perf_harness as H  # noqa: E402  (ONE sandbox + integrity reader)
import sandbox_identity  # noqa: E402

REQUIRED = [H.PRE_BOOT, H.POST_BOOT, H.PREWARM, H.SHUTDOWN]
FLAG_KEY = "notebook_playbook_enabled"
ET = ZoneInfo("America/New_York")
PORTS = range(8635, 8640)

res: dict = {"wave": 13, "lane": "13B", "checks": {}, "errors": [], "requests": []}
LINES: list[str] = []


def record(key, verdict, **facts):
    res["checks"][key] = {"verdict": verdict, **facts}
    line = f"[{verdict}] {key}: " + json.dumps(facts, default=str, ensure_ascii=True)[:700]
    LINES.append(line)
    print(line, file=sys.stderr, flush=True)


def guarded(key):
    def wrap(fn):
        def inner(*a, **kw):
            try:
                fn(*a, **kw)
            except Exception as e:  # noqa: BLE001 -- one row never stops the rest
                record(key, "INCONCLUSIVE", reason=f"exception: {type(e).__name__}: {e}",
                       traceback=traceback.format_exc()[-1500:])
        return inner
    return wrap


def find_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            got = find_key(v, key)
            if got is not None:
                return got
    if isinstance(obj, list):
        for v in obj:
            got = find_key(v, key)
            if got is not None:
                return got
    return None


TOUCH_PROBE = r"""
(sel) => {
  const el = document.querySelector(sel)
  if (!el) return null
  const small = []
  for (const b of el.querySelectorAll('button, select, input, textarea, a, summary')) {
    const r = b.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.height < 44) small.push({ text: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40), h: Math.round(r.height) })
  }
  return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, small }
}
"""

CARDS = r"""
() => {
  const out = {}
  for (const a of document.querySelectorAll('[data-setup]')) {
    const stats = {}
    for (const s of a.querySelectorAll('[data-stat]')) {
      const chip = s.querySelector('[data-n]')
      const det = s.querySelector('details')
      stats[s.getAttribute('data-stat')] = {
        text: s.innerText.replace(/\s+/g, ' ').trim(),
        n: chip ? Number(chip.getAttribute('data-n')) : null,
        behindReveal: det ? !det.open : false,
      }
    }
    out[a.getAttribute('data-setup')] = { head: a.querySelector('h3 + span')?.innerText || '', stats }
  }
  return out
}
"""

# The 12 Breakout trades: (ticker, R, the words of its plan note).
BREAKOUT = [
    ("AAPL", -1.0, "Felt FOMO on the gap, chasing a bit"),
    ("MSFT", -1.0, "FOMO, I want in before it runs"),
    ("AMZN", -1.0, "Some FOMO here after missing the first move"),
    ("META", -1.0, "Pure FOMO entry, size it small"),
    ("GOOGL", -1.0, "Clean base, plan is clear"),
    ("NFLX", 2.0, "Patient, waited for the pivot"),
    ("CRM", 1.5, "Patient entry on the retest"),
    ("ADBE", 3.0, "Patient, let it come to me"),
    ("ORCL", 0.8, "Patient, tight risk"),
    ("AVGO", 2.2, "A bit of fomo but the base is tight"),
    ("QCOM", 1.1, "Clean breakout through the pivot"),
    ("TXN", 0.4, "Followed the checklist"),
]


def run_walk(base: str, art: Path, flag_off: bool) -> None:
    from playwright.sync_api import sync_playwright

    run = time.strftime("r%H%M%S")
    res["run"] = run
    pw = secrets.token_urlsafe(18)   # a TEST value for this run only; never written anywhere

    def shot(pg, name):
        p = art / f"{name}.jpg"
        try:
            pg.screenshot(path=str(p), type="jpeg", quality=55, full_page=False)
            return p.name
        except Exception as e:  # noqa: BLE001
            return f"screenshot failed: {e}"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = browser.new_context(viewport={"width": 1280, "height": 900})
        member = browser.new_context(viewport={"width": 1200, "height": 900})
        email = f"w13b-member-{run}@local.dev"
        res["accounts"] = {"member": email, "admin": H.ADMIN_EMAIL}
        H._signup_or_login(admin.request, base, H.ADMIN_EMAIL, H.ADMIN_PW, "hubtest")
        for _attempt in range(3):
            r = member.request.post(base + "/api/auth/signup", data={"email": email, "password": pw, "display_name": "Walker"})
            if r.status != 429:
                break
            time.sleep(62)
        if r.status not in (200, 201):
            raise H.SetupFailed(f"could not sign up {email}: HTTP {r.status}")
        admin.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
        admin.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
        if not member.request.get(base + "/api/auth/me").json().get("paid_equiv"):
            raise H.SetupFailed(f"{email} is not paid-equivalent")
        M = member.request
        member.on("request", lambda req: res["requests"].append(
            f"{req.method} {req.url.split(base, 1)[-1]}") if "/api/j2/my-playbook" in req.url else None)

        def new_page(ctx):
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
            return pg

        def open_playbook(pg):
            pg.goto(base + "/journal-2-0/playbook")
            H._dismiss_intro(pg)
            pg.locator('[data-setup="Breakout"]').wait_for(timeout=45000)

        if flag_off:
            @guarded("F0_payload_flag_off")
            def f0():
                flag = find_key(M.get(base + "/api/auth/me").json(), FLAG_KEY)
                record("F0_payload_flag_off", "PASS" if flag is False else "FAIL", payload_flag=flag)
            f0()

            @guarded("F1_api_404")
            def f1():
                st = M.get(base + "/api/j2/my-playbook").status
                record("F1_api_404", "PASS" if st == 404 else "FAIL", status=st)
            f1()

            @guarded("F2_page_goes_to_insights")
            def f2():
                pg = new_page(member)
                pg.goto(base + "/journal-2-0/playbook")
                H._dismiss_intro(pg)
                pg.wait_for_url("**/journal/insights**", timeout=30000)
                pg.wait_for_timeout(1500)
                has_page = pg.locator('[data-testid="my-playbook"]').count()
                s = shot(pg, "f2-flag-off-redirect")
                record("F2_page_goes_to_insights", "PASS" if has_page == 0 else "FAIL", url=pg.url,
                       my_playbook_nodes=has_page, screenshot=s)
                state["insights"] = pg
            state: dict = {}
            f2()

            @guarded("F3_no_door_in_insights")
            def f3():
                pg = state.get("insights") or new_page(member)
                pg.wait_for_timeout(2500)
                doors = pg.get_by_test_id("open-my-playbook").count()
                s = shot(pg, "f3-insights-no-door")
                record("F3_no_door_in_insights", "PASS" if doors == 0 else "FAIL", doors=doors, screenshot=s)
            f3()
            record("W9_no_page_errors", "PASS" if not res["errors"] else "FAIL", errors=res["errors"][:20])
            browser.close()
            return

        state = {}

        @guarded("W0_gate_and_identity")
        def w0():
            flag = find_key(M.get(base + "/api/auth/me").json(), FLAG_KEY)
            grading = find_key(M.get(base + "/api/auth/me").json(), "notebook_plan_grading_enabled")
            record("W0_gate_and_identity", "PASS" if flag is True and grading is True else "FAIL",
                   payload_flag=flag, plan_grading_flag=grading)
        w0()

        @guarded("W1_seed_42_trades_3_setups")
        def w1():
            created, failures = [], []

            def trade(sym, setup, r, day, hhmm=None):
                body = {"symbol": sym, "side": "Long", "shares": 100, "entryPrice": 50, "entryDate": day,
                        "exitPrice": round(50 + r, 2), "exitDate": day, "originalStop": 49}
                if setup:
                    body["setup"] = setup
                if hhmm:
                    body.update(entryTimeEt=hhmm, exitTimeEt=hhmm)
                t = M.post(base + "/api/j2/trades", data=body)
                if t.status != 200:
                    failures.append({"sym": sym, "status": t.status, "body": t.text()[:200]})
                    return None
                b = t.json()
                tid = (b.get("trade") or b).get("id")
                created.append({"id": tid, "symbol": sym, "setup": setup, "r": r})
                return tid

            # Past days for the setups whose trades carry no notes.
            start = datetime(2026, 6, 1)
            for i in range(25):
                trade("SPY" if i % 2 else "QQQ", "Pullback", 2.0 if i % 5 < 2 else -1.0,
                      (start + timedelta(days=i)).strftime("%Y-%m-%d"))
            for i, r in enumerate((1.0, -1.0, 1.0)):
                trade("IWM", "EP", r, (start + timedelta(days=30 + i)).strftime("%Y-%m-%d"))
            for i in range(2):
                trade("DIA", None, 1.0, (start + timedelta(days=40 + i)).strftime("%Y-%m-%d"))

            # The Breakout trades: a plan note per ticker FIRST, then every trade at the next minute.
            notes = {}
            for sym, _r, words in BREAKOUT:
                doc = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": t}]}
                                                  for t in ("Entry: 50", "Stop: 49", words)]}
                n = M.post(base + "/api/j2/notes", data={"title": f"{sym} plan", "ticker": sym, "bodyJson": doc}).json()["note"]
                notes[sym] = n["id"]
            now = datetime.now(ET)
            nxt = (now + timedelta(minutes=1)).replace(second=1, microsecond=0)
            time.sleep(max(0.0, (nxt - now).total_seconds()))
            day, hhmm = nxt.strftime("%Y-%m-%d"), nxt.strftime("%H:%M")
            frozen = {}
            for sym, r, _w in BREAKOUT:
                tid = trade(sym, "Breakout", r, day, hhmm)
                if tid:
                    g = M.get(base + f"/api/j2/plan-grades/trades/{tid}").json()   # 13A freezes the plan
                    frozen[sym] = {"status": g.get("status"), "noteId": (g.get("plan") or {}).get("noteId"),
                                   "expected": notes[sym]}
            state.update(trades=created, notes=notes)
            all_frozen = all(v["status"] == "planned" and v["noteId"] == v["expected"] for v in frozen.values())
            ok = len(created) == 42 and not failures and len(frozen) == 12 and all_frozen
            record("W1_seed_42_trades_3_setups", "PASS" if ok else "FAIL", trades=len(created), failures=failures,
                   breakout_entry=f"{day} {hhmm} ET", plans_frozen=frozen,
                   how="trades over the member's API; Breakout plan notes written first, frozen by 13A's grade read")
        w1()

        @guarded("W2_open_from_insights_1200")
        def w2():
            pg = new_page(member)
            pg.goto(base + "/journal/insights")
            H._dismiss_intro(pg)
            door = pg.get_by_test_id("open-my-playbook")
            door.wait_for(timeout=45000)
            s0 = shot(pg, "w2-insights-door-1200")
            door.click()
            pg.locator('[data-setup="Breakout"]').wait_for(timeout=45000)
            api = M.get(base + "/api/j2/my-playbook").json()
            cards = pg.evaluate(CARDS)
            s1 = shot(pg, "w2-my-playbook-1200")
            by = {r["setup"]: r for r in api["setups"]}
            checks = {}
            for name, band, word in (("Pullback", "normal", None), ("Breakout", "thin", "thin sample"),
                                     ("EP", "too_few", "too few to judge")):
                rec, card = by.get(name), cards.get(name)
                wr = card["stats"]["Win rate"] if card else None
                checks[name] = {
                    "api_band": rec["sample"]["band"] if rec else None, "api_n": rec["tradeCount"] if rec else None,
                    "screen_head": card["head"] if card else None, "win_rate_cell": wr,
                    "ok": bool(rec and card and rec["sample"]["band"] == band and wr["n"] == rec["winRateStat"]["n"]
                               and (word is None or word in wr["text"]) and (band != "normal" or "thin" not in wr["text"])
                               and (band == "too_few") == wr["behindReveal"]),
                }
            every_n = all(st["n"] is not None and st["n"] > 0 for c in cards.values() for st in c["stats"].values())
            ok = pg.url.endswith("/journal-2-0/playbook") and all(c["ok"] for c in checks.values()) and every_n \
                and api["untagged"]["count"] == 2
            record("W2_open_from_insights_1200", "PASS" if ok else "FAIL", url=pg.url, setups=checks,
                   every_stat_has_n=every_n, untagged=api["untagged"], screenshots=[s0, s1])
            state.update(page=pg, api=api)
        w2()

        @guarded("W3_drill_a_number_1200")
        def w3():
            pg = state["page"]
            card = pg.locator('[data-setup="Breakout"]')
            card.get_by_role("button", name="Win rate", exact=False).first.click()
            drill = card.get_by_test_id("playbook-drill")
            drill.wait_for(timeout=10000)
            rows = drill.locator("tbody tr").count()
            want = next(r for r in state["api"]["setups"] if r["setup"] == "Breakout")["winRateStat"]["n"]
            s = shot(pg, "w3-drill-1200")
            record("W3_drill_a_number_1200", "PASS" if rows == want == 12 else "FAIL", rows=rows, api_n=want,
                   title=drill.locator("h4").inner_text(), screenshot=s)
        w3()

        @guarded("W4_too_few_reveal")
        def w4():
            pg = state["page"]
            card = pg.locator('[data-setup="EP"]')
            cell = card.locator('[data-stat="Win rate"]')
            hidden_before = cell.locator("details").evaluate("d => !d.open")
            cell.locator("summary").click()
            shown_after = cell.locator("details").evaluate("d => d.open")
            value = cell.locator("button").inner_text()
            s = shot(pg, "w4-too-few-revealed")
            record("W4_too_few_reveal", "PASS" if hidden_before and shown_after and value.endswith("%") else "FAIL",
                   hidden_before=hidden_before, shown_after=shown_after, value=value, screenshot=s)
        w4()

        @guarded("W5_cited_pattern_finding")
        def w5():
            pg = state["page"]
            api = state["api"]["patterns"]
            fomo = next((f for f in api.get("findings", []) if f["term"] == "FOMO"), None)
            sec = pg.get_by_test_id("playbook-patterns")
            sec.scroll_into_view_if_needed()
            li = sec.locator('[data-finding="FOMO"]')
            text = li.locator("p").inner_text()
            li.get_by_role("button").click()
            cites = li.get_by_test_id("pattern-citations").locator("[data-cite]")
            n = cites.count()
            note_links = li.get_by_test_id("pattern-citations").locator('a[href^="/journal/notebook?note="]').count()
            s = shot(pg, "w5-pattern-citations-1200")
            ok = (fomo and fomo["leans"] == "losses" and fomo["losses"] == {"k": 4, "n": 5} and fomo["wins"] == {"k": 1, "n": 7}
                  and "before 4 of 5 losses and 1 of 7 wins" in text and n == len(fomo["citations"]) == 5 and note_links == 5
                  and "Patterns, not proof" in sec.inner_text())
            record("W5_cited_pattern_finding", "PASS" if ok else "FAIL", api_finding={k: fomo[k] for k in ("term", "leans", "losses", "wins")} if fomo else None,
                   screen=text, citations_on_screen=n, note_links=note_links, status=api.get("status"),
                   noted=api.get("noted"), screenshot=s)
        w5()

        @guarded("W6_frozen_snapshot_note")
        def w6():
            pg = state["page"]
            pg.get_by_role("button", name="Save a snapshot note").click()
            pg.get_by_role("status").filter(has_text="Snapshot saved").wait_for(timeout=20000)
            notes = M.get(base + "/api/j2/notes?tag=playbook-snapshot&limit=50").json()
            items = notes.get("notes") or notes.get("items") or []
            snap = next((n for n in items if "playbook-snapshot" in (n.get("tags") or [])), None)
            body = json.dumps(M.get(base + f"/api/j2/notes/{snap['id']}").json()["note"].get("bodyJson")) if snap else ""
            s = shot(pg, "w6-snapshot-saved")
            ok = bool(snap) and "thin sample" in body and "too few to judge" in body and "widgetEmbed" not in body
            record("W6_frozen_snapshot_note", "PASS" if ok else "FAIL", note=snap and snap.get("id"),
                   title=snap and snap.get("title"), has_wording=("thin sample" in body), no_live_widget=("widgetEmbed" not in body),
                   screenshot=s)
        w6()

        @guarded("W7_keyboard_number_to_trades")
        def w7():
            pg = new_page(member)
            open_playbook(pg)
            pg.locator("body").click(position={"x": 5, "y": 5})
            presses, reached = 0, False
            while presses < 300:
                pg.keyboard.press("Tab")
                presses += 1
                label = pg.evaluate("() => document.activeElement && document.activeElement.getAttribute('aria-label')")
                if label and label.startswith("Win rate"):
                    reached = True
                    break
            pg.keyboard.press("Enter")
            opened = pg.get_by_test_id("playbook-drill").count()
            s = shot(pg, "w7-keyboard-drill")
            record("W7_keyboard_number_to_trades", "PASS" if reached and opened == 1 else "FAIL",
                   tabs_to_reach=presses, reached=reached, drill_open=opened, screenshot=s)
            pg.close()
        w7()

        @guarded("W8_phone_390")
        def w8():
            phone = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                        storage_state=member.storage_state())
            pg = new_page(phone)
            open_playbook(pg)
            probe = pg.evaluate(TOUCH_PROBE, '[data-testid="my-playbook"]')
            s1 = shot(pg, "w8-my-playbook-390")
            card = pg.locator('[data-setup="Breakout"]')
            card.get_by_role("button", name="Avg R", exact=False).first.tap()
            drill = card.get_by_test_id("playbook-drill")
            drill.wait_for(timeout=10000)
            rows = drill.locator("tbody tr").count()
            drill.scroll_into_view_if_needed()
            probe2 = pg.evaluate(TOUCH_PROBE, '[data-testid="my-playbook"]')
            s2 = shot(pg, "w8-drill-390")
            ok = (probe and probe["scrollW"] <= probe["clientW"] and not probe["small"] and rows == 12
                  and probe2["scrollW"] <= probe2["clientW"])
            record("W8_phone_390", "PASS" if ok else "FAIL", probe=probe, drill_rows=rows, probe_after_drill=probe2,
                   screenshots=[s1, s2])
            phone.close()
        w8()

        record("W9_no_page_errors", "PASS" if not res["errors"] else "FAIL", errors=res["errors"][:20])
        browser.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wave 13 lane 13B live walk (see the module header).")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8635)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tip", default=None)
    ap.add_argument("--artifacts", required=True)
    ap.add_argument("--flag-off", action="store_true")
    args = ap.parse_args(argv)
    if args.port not in PORTS:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: port {args.port} is outside 8635-8639)")
        return 3
    base = f"http://127.0.0.1:{args.port}"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    art = Path(args.artifacts)
    art.mkdir(parents=True, exist_ok=True)
    res.update({"tip": args.tip, "base": base, "data_dir": args.data_dir, "mode": "flag-off" if args.flag_off else "flag-on",
                "instrument": os.path.relpath(__file__, REPO),
                "gate_source": "the sandbox's auth payload (row W0/F0 payload_flag)"})
    refused = H.refuse_shared_root(args.data_dir)
    if not refused and H.port_busy(args.port):
        refused = f"port {args.port} already has a listener (never killed)"
    if refused:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: {refused})")
        return 3
    sb = H.Sandbox(args.data_dir, args.port, art / ("launcher-off.log" if args.flag_off else "launcher.log"))
    not_run = None
    try:
        sb.start()
        if not sb.wait_healthy(base, 300):
            not_run = "the sandbox never answered /api/health"
        else:
            sb.wait_checkpoint(H.POST_BOOT, H.POST_BOOT_WAIT_S)
            v = sandbox_identity.verify(base, sb.integrity_path())
            res["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
            if not v.ok:
                not_run = v.sentence
            else:
                try:
                    run_walk(base, art, args.flag_off)
                except Exception as e:  # noqa: BLE001 -- setup failed; the sandbox still owes its verdict
                    not_run = f"{type(e).__name__}: {e}"
                    res["traceback"] = traceback.format_exc()[-2000:]
                res["prewarm_checkpoint_reached"] = sb.wait_checkpoint(H.PREWARM, H.PREWARM_WAIT_S)
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        integ = H.read_integrity(ipath, REQUIRED)
        if ipath and Path(ipath).is_file():
            kept = out.with_suffix(".integrity.md")
            shutil.move(ipath, kept)
            integ["path"] = str(kept)
        first = H.integrity_line(integ, not_run=not_run)
        res.update({"first_line": first, "integrity": integ, "not_run": not_run})
        out.write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
        print(first)
        for line in LINES:
            print(line)
        print(f"evidence: {out}")
    if not_run:
        return 3
    verdicts = [v["verdict"] for v in res["checks"].values()]
    return 0 if verdicts and all(v == "PASS" for v in verdicts) else 1


if __name__ == "__main__":
    sys.exit(main())
