"""Wave 13 lane 13A live walk -- plan vs execution grading in a real Chromium, against a LOCAL
sandbox. It writes RAW evidence only: docs/notebook/evidence/wave13-13a/walk-<sha>/walk.json (+ the
launcher's integrity log and screenshots). It is NOT a pytest rail, and it draws no conclusion:
each row records what the browser and the API showed.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. It owns its sandbox through the perf harness's `Sandbox`
(scripts/hub_sandbox_boot.py, own process group, stopped gracefully so the launcher writes its
SHUTDOWN checkpoint), talks to it over HTTP only, and prints the launcher's snapshot verdict
(`SANDBOX INTEGRITY: ...`) as its FIRST output line. No model is called.

Run it from POWERSHELL with the gate in that same shell (ports 8600-8604 only):

    $env:NOTEBOOK_PLAN_GRADING_ENABLED = '1'
    python tools/notebook_w13a_plan_grade_walk.py --data-dir '<scratchpad>\\w13a-data' --port 8600 `
        --out docs/notebook/evidence/wave13-13a/walk-<sha>/walk.json --tip <sha> `
        --artifacts docs/notebook/evidence/wave13-13a/walk-<sha>

Preconditions: app/dist built from the tip; the port free (refused, never killed); the data dir
outside the shared root (refused).

One paid member (comped by the launcher's admin, hubtest@local.dev).

  P0  the gate rides the auth payload ON; the sandbox is who it says it is
  P1  make a plan note (1200 px, keyboard): an NVDA note created empty over the member's API,
      then the plan TYPED into the real editor (Entry / Stop / Target / Shares lines); saved
  P2  log a trade that matches it (member's API): NVDA long, entered AFTER the plan was saved
  P3  see the grade (1200 px, mouse): the trade page's "Plan vs execution" card, four checks
  P4  edit the plan afterwards (keyboard, in the editor): Entry 100 -> 130, saved; the trade page
      and the API grade are unchanged (frozen at first match)
  P5  an unplanned trade: AMD with no plan -> "Unplanned" on its trade page and the chip in the
      Trade Journal table (1200 px; /journal/trades?seg=closed -- the surface opens on Open Positions)
  P6  the discipline record in Insights (1200 px)
  P7  keyboard: Tab-reachable Re-link opens the candidate list with Enter
  P8  390 px (touch): the trade page card and the Trade Journal chip; no sideways scroll; the
      card's buttons are >= 44 px
  P9  no unforced page error across the walk
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
FLAG_KEY = "notebook_plan_grading_enabled"
ET = ZoneInfo("America/New_York")
PORTS = range(8600, 8605)

# Wave 14 OPS: the sandbox's own environment. Two of 13A's three walks were stopped by force
# ("FORCED after 120 s without a graceful exit") and never wrote the launcher's SHUTDOWN
# checkpoint; the third reached it. The 13X walk -- same Sandbox, same stop -- reached it on all
# six runs, and it differs in exactly this: provider keys blanked, so no thread in the sandbox is
# mid-way through a vendor call when the stop arrives. The logo prewarm (a 12-worker CDN pass over
# 3,640 symbols, still running in both forced launcher logs) is switched off by its own read flag
# (`api/services/ticker_logos_prewarm.py::start_async`). Nothing 13A measures reads a vendor or a
# logo. `tests/test_w13a_walk_shutdown.py` proves every name here has a real read site.
SANDBOX_ENV = {
    "TICKER_LOGOS_PREWARM_DISABLED": "1",
    "FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "", "MASSIVE_API_KEY": "",
}
STOP_GRACE_S = 300.0    # was the harness default 120 s; the stop still records FORCED past it

res: dict = {"wave": 13, "lane": "13A", "checks": {}, "errors": [], "requests": []}
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
  for (const b of el.querySelectorAll('button, select, input, textarea, a')) {
    const r = b.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.height < 44) small.push({ text: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40), h: Math.round(r.height) })
  }
  return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, small }
}
"""

CARD_TEXT = r"""
() => {
  const c = document.querySelector('[data-testid="plan-grade-card"]')
  if (!c) return null
  const checks = {}
  for (const li of c.querySelectorAll('[data-check]')) checks[li.getAttribute('data-check')] = li.innerText.replace(/\s+/g, ' ').trim()
  return { text: c.innerText.replace(/\s+/g, ' ').trim(), checks }
}
"""


def run_walk(base: str, art: Path) -> None:
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
        email = f"w13a-member-{run}@local.dev"
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
            f"{req.method} {req.url.split(base, 1)[-1]}") if "/api/j2/plan-grades" in req.url else None)

        def new_page(ctx):
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
            return pg

        def get_note(nid):
            return M.get(base + f"/api/j2/notes/{nid}").json()["note"]

        def wait_note(nid, needle, timeout=30):
            end = time.time() + timeout
            note = get_note(nid)
            while time.time() < end and needle not in json.dumps(note.get("bodyJson")):
                time.sleep(0.5)
                note = get_note(nid)
            return note

        def open_trade(pg, tid):
            pg.goto(base + f"/journal-2-0/trade/{tid}")
            H._dismiss_intro(pg)
            card = pg.locator('[data-testid="plan-grade-card"]')
            card.wait_for(timeout=30000)
            return card

        state: dict = {}

        @guarded("P0_gate_and_identity")
        def p0():
            flag = find_key(M.get(base + "/api/auth/me").json(), FLAG_KEY)
            record("P0_gate_and_identity", "PASS" if flag is True else "FAIL", payload_flag=flag)
        p0()

        @guarded("P1_make_a_plan_note_by_keyboard")
        def p1():
            created = M.post(base + "/api/j2/notes", data={"title": f"NVDA plan {run}", "ticker": "NVDA"}).json()["note"]
            nid = created["id"]
            pg = new_page(member)
            pg.goto(base + f"/journal/notebook?note={nid}")
            H._dismiss_intro(pg)
            ed = pg.locator(".ProseMirror").first
            ed.wait_for(timeout=30000)
            ed.click()
            pg.keyboard.press("End")
            for i, line in enumerate(["Entry: 100", "Stop: 96", "Target: 120", "Shares: 100"]):
                if i:
                    pg.keyboard.press("Enter")
                pg.keyboard.type(line, delay=15)
            note = wait_note(nid, "Shares: 100")
            pg.wait_for_timeout(2500)          # let the last autosave land
            note = get_note(nid)
            s = shot(pg, "p1-plan-note-1200")
            state.update(note=nid, editor_page=pg, plan_saved_at=note.get("updatedAt"))
            typed = all(x in json.dumps(note.get("bodyJson")) for x in ("Entry: 100", "Stop: 96", "Target: 120", "Shares: 100"))
            record("P1_make_a_plan_note_by_keyboard", "PASS" if typed else "FAIL", note=nid, saved_at=note.get("updatedAt"),
                   ticker=note.get("ticker"), screenshot=s, how="note created empty over the member's API, plan typed in the editor")
        p1()

        @guarded("P2_log_a_matching_trade")
        def p2():
            # Enter AFTER the plan's last save: wait for the next ET minute, then enter at it.
            now = datetime.now(ET)
            nxt = (now + timedelta(minutes=1)).replace(second=1, microsecond=0)
            time.sleep(max(0.0, (nxt - now).total_seconds()))
            day, hhmm = nxt.strftime("%Y-%m-%d"), nxt.strftime("%H:%M")
            t = M.post(base + "/api/j2/trades", data={
                "symbol": "NVDA", "side": "Long", "shares": 100, "entryPrice": 100.4, "entryDate": day,
                "entryTimeEt": hhmm, "exitPrice": 110, "exitDate": day, "exitTimeEt": hhmm, "originalStop": 95,
            })
            body = t.json()
            tid = (body.get("trade") or body).get("id")
            state["trade"] = tid
            record("P2_log_a_matching_trade", "PASS" if t.status == 200 and tid else "FAIL", status=t.status,
                   trade=tid, entry=f"{day} {hhmm} ET", plan_saved_at=state.get("plan_saved_at"),
                   how="logged over the member's API (the trade is the input; the walk is about the grade)")
        p2()

        @guarded("P3_see_the_grade_1200")
        def p3():
            pg = new_page(member)
            open_trade(pg, state["trade"])
            pg.get_by_text("Kept").first.wait_for(timeout=20000)
            card = pg.evaluate(CARD_TEXT)
            api = M.get(base + f"/api/j2/plan-grades/trades/{state['trade']}").json()
            s = shot(pg, "p3-grade-1200")
            state["grade_before"] = api
            state["card_before"] = card
            ok = (api.get("status") == "planned" and api["plan"]["entry"] == 100 and api["checks"]["entry"]["state"] == "kept"
                  and api["checks"]["stop"]["state"] == "kept" and api["checks"]["size"]["state"] == "kept"
                  and card and "Kept" in card["checks"].get("entry", "") and "Honoured" in card["checks"].get("stop", ""))
            record("P3_see_the_grade_1200", "PASS" if ok else "FAIL", card=card, status=api.get("status"),
                   plan={k: api["plan"].get(k) for k in ("entry", "stop", "target", "shares", "matchTier", "matchedAt")},
                   checks={k: api["checks"][k]["state"] for k in ("entry", "stop", "size", "target")}, screenshot=s)
            state["trade_page"] = pg
        p3()

        @guarded("P4_edit_the_plan_afterwards_grade_unchanged")
        def p4():
            pg = state["editor_page"]
            pg.goto(base + f"/journal/notebook?note={state['note']}")
            H._dismiss_intro(pg)
            pg.locator(".ProseMirror").first.wait_for(timeout=30000)
            pg.get_by_text("Entry: 100", exact=True).first.click(click_count=3)
            pg.keyboard.type("Entry: 130", delay=15)
            note = wait_note(state["note"], "Entry: 130")
            pg.wait_for_timeout(2500)
            s1 = shot(pg, "p4-plan-edited")
            tp = new_page(member)
            open_trade(tp, state["trade"])
            tp.get_by_text("Kept").first.wait_for(timeout=20000)
            card = tp.evaluate(CARD_TEXT)
            api = M.get(base + f"/api/j2/plan-grades/trades/{state['trade']}").json()
            s2 = shot(tp, "p4-grade-after-edit")
            before = state["grade_before"]
            same = (api["plan"]["entry"] == before["plan"]["entry"] == 100 and api["checks"] == before["checks"]
                    and api["plan"]["matchedAt"] == before["plan"]["matchedAt"] and card == state["card_before"])
            record("P4_edit_the_plan_afterwards_grade_unchanged", "PASS" if "Entry: 130" in json.dumps(note.get("bodyJson")) and same else "FAIL",
                   note_now_says_130="Entry: 130" in json.dumps(note.get("bodyJson")), api_entry_after=api["plan"]["entry"],
                   matched_at_before=before["plan"]["matchedAt"], matched_at_after=api["plan"]["matchedAt"],
                   card_identical=card == state["card_before"], screenshots=[s1, s2])
        p4()

        @guarded("P5_unplanned_trade_flagged")
        def p5():
            day = datetime.now(ET).strftime("%Y-%m-%d")
            t = M.post(base + "/api/j2/trades", data={"symbol": "AMD", "side": "Long", "shares": 50, "entryPrice": 150,
                                                      "entryDate": day, "exitPrice": 155, "exitDate": day, "originalStop": 145})
            body = t.json()
            tid = (body.get("trade") or body).get("id")
            state["unplanned"] = tid
            pg = new_page(member)
            open_trade(pg, tid)
            pg.get_by_test_id("plan-grade-unplanned").wait_for(timeout=20000)
            s1 = shot(pg, "p5-unplanned-trade-page")
            pg.goto(base + "/journal/trades?seg=closed")
            H._dismiss_intro(pg)
            chip = pg.get_by_test_id("unplanned-chip")
            chip.first.wait_for(timeout=30000)
            rows_amd = pg.locator("tr", has_text="AMD").count()
            rows_nvda = pg.locator("tr", has_text="NVDA").count()
            chips = chip.count()
            nvda_chip = pg.locator("tr", has_text="NVDA").get_by_test_id("unplanned-chip").count()
            s2 = shot(pg, "p5-trade-journal-chip-1200")
            ok = chips == 1 and rows_amd >= 1 and rows_nvda >= 1 and nvda_chip == 0
            record("P5_unplanned_trade_flagged", "PASS" if ok else "FAIL", trade=tid, chips=chips, amd_rows=rows_amd,
                   nvda_rows=rows_nvda, nvda_chip=nvda_chip, screenshots=[s1, s2])
        p5()

        @guarded("P6_discipline_record_1200")
        def p6():
            pg = new_page(member)
            pg.goto(base + "/journal/insights?ins=discipline")
            H._dismiss_intro(pg)
            rec = pg.get_by_test_id("discipline-record")
            rec.wait_for(timeout=30000)
            text = rec.inner_text()
            s = shot(pg, "p6-discipline-1200")
            ok = "Discipline record" in text and "1 planned, 1 unplanned" in " ".join(text.split()) and "too few to judge" in text
            record("P6_discipline_record_1200", "PASS" if ok else "FAIL", text=" ".join(text.split())[:600], screenshot=s)
        p6()

        @guarded("P7_keyboard_relink")
        def p7():
            pg = new_page(member)
            open_trade(pg, state["trade"])
            btn = pg.get_by_role("button", name="Re-link")
            btn.wait_for(timeout=20000)
            presses = 0
            while presses < 400:
                pg.keyboard.press("Tab")
                presses += 1
                if pg.evaluate("() => document.activeElement && document.activeElement.textContent.trim() === 'Re-link'"):
                    break
            pg.keyboard.press("Enter")
            expanded = btn.get_attribute("aria-expanded")
            s = shot(pg, "p7-keyboard-relink")
            record("P7_keyboard_relink", "PASS" if expanded == "true" and presses < 400 else "FAIL",
                   tabs_to_reach=presses, aria_expanded=expanded, screenshot=s)
        p7()

        @guarded("P8_phone_390")
        def p8():
            phone = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                        storage_state=member.storage_state())
            pg = new_page(phone)
            open_trade(pg, state["trade"])
            pg.get_by_text("Kept").first.wait_for(timeout=20000)
            pg.locator('[data-testid="plan-grade-card"]').scroll_into_view_if_needed()
            probe = pg.evaluate(TOUCH_PROBE, '[data-testid="plan-grade-card"]')
            s1 = shot(pg, "p8-grade-390")
            pg.goto(base + "/journal/trades?seg=closed")
            H._dismiss_intro(pg)
            pg.get_by_test_id("unplanned-chip").first.wait_for(timeout=30000)
            chips = pg.get_by_test_id("unplanned-chip").count()
            s2 = shot(pg, "p8-trade-journal-chip-390")
            ok = probe and probe["scrollW"] <= probe["clientW"] and not probe["small"] and chips == 1
            record("P8_phone_390", "PASS" if ok else "FAIL", probe=probe, chips_on_phone=chips, screenshots=[s1, s2])
            phone.close()
        p8()

        record("P9_no_page_errors", "PASS" if not res["errors"] else "FAIL", errors=res["errors"][:20])
        browser.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wave 13 lane 13A live walk (see the module header).")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8600)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tip", default=None)
    ap.add_argument("--artifacts", required=True)
    ap.add_argument("--stop-grace-s", type=float, default=STOP_GRACE_S,
                    help="how long the graceful stop may take before it is FORCED (recorded)")
    args = ap.parse_args(argv)
    if args.port not in PORTS:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: port {args.port} is outside 8600-8604)")
        return 3
    base = f"http://127.0.0.1:{args.port}"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    art = Path(args.artifacts)
    art.mkdir(parents=True, exist_ok=True)
    res.update({"tip": args.tip, "base": base, "data_dir": args.data_dir,
                "instrument": os.path.relpath(__file__, REPO),
                "gate_source": "the sandbox's auth payload (row P0 payload_flag)"})
    refused = H.refuse_shared_root(args.data_dir)
    if not refused and H.port_busy(args.port):
        refused = f"port {args.port} already has a listener (never killed)"
    if refused:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: {refused})")
        return 3
    os.environ.update(SANDBOX_ENV)          # the sandbox (Popen) inherits it
    res["sandbox_env"] = sorted(SANDBOX_ENV)
    res["stop_grace_s"] = args.stop_grace_s
    sb = H.Sandbox(args.data_dir, args.port, art / "launcher.log")
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
                    run_walk(base, art)
                except Exception as e:  # noqa: BLE001 -- setup failed; the sandbox still owes its verdict
                    not_run = f"{type(e).__name__}: {e}"
                    res["traceback"] = traceback.format_exc()[-2000:]
                res["prewarm_checkpoint_reached"] = sb.wait_checkpoint(H.PREWARM, H.PREWARM_WAIT_S)
    finally:
        res["stop"] = sb.stop(grace_s=args.stop_grace_s)
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
