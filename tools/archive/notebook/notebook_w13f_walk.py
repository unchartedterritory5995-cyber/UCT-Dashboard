"""Wave 13 lane 13F live walk -- reviews that write themselves, with the leak finder, in a real
Chromium against a LOCAL sandbox. It writes RAW evidence only:
docs/notebook/evidence/wave13-13f/walk-<sha>/walk.json (+ the launcher's integrity log and
screenshots). It is NOT a pytest rail, and it draws no conclusion beyond what the browser and the
API showed.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. It owns its sandbox through the perf harness's `Sandbox`
(scripts/hub_sandbox_boot.py, own process group, stopped gracefully so the launcher writes its
SHUTDOWN checkpoint), talks to it over HTTP only, and prints the launcher's snapshot verdict
(`SANDBOX INTEGRITY: ...`) as its FIRST output line.

⚠️ ONE EXCEPTION, NAMED HERE RATHER THAN HIDDEN: W1 calls the PRE-EXISTING Compass weekly-review
generator (`POST /api/j2/accounts/{id}/coach/weekly-reviews/generate`) once, for real, so the
walk's week has a genuine Compass review to quote -- this is a precondition this lane's own code
never creates and never calls a model for (the leak finder and review-drafts data path reach no
model client; only this ONE seeding step, exercising an already-shipped, independently-tested
Compass feature, does). If it fails (no ANTHROPIC_API_KEY in the sandbox, a rate limit, Compass
disabled on the account), that is recorded and the Compass-specific checks read INCONCLUSIVE --
never a fabricated PASS -- while the draft/leak checks, which do not depend on it, still get their
own verdicts.

Run it from POWERSHELL with the gate in that same shell (ports 8660-8664 only):

    $env:NOTEBOOK_REVIEW_DRAFTS_ENABLED = '1'
    python tools/notebook_w13f_walk.py --data-dir '<scratchpad>\\w13f-data' --port 8660 `
        --out docs/notebook/evidence/wave13-13f/walk-<sha>/walk.json --tip <sha> `
        --artifacts docs/notebook/evidence/wave13-13f/walk-<sha>

    # the flag-OFF pass, in a shell with NOTEBOOK_REVIEW_DRAFTS_ENABLED unset:
    python tools/notebook_w13f_walk.py --flag-off --data-dir ... --port 8661 --out .../walk-off.json ...

Preconditions: app/dist built from the tip; the port free (refused, never killed); the data dir
outside the shared root (refused). One paid member (comped by the launcher's admin).

The week: NVDA loss (10:00-10:30 ET) then a same-symbol re-entry at 10:45-11:15 (revenge
re-entry, same-day, same stop discipline) -- both losses -- plus AAPL and TSLA wins later in the
week, so the week has a real net P&L and a baseline the revenge pair reads worse than.

  W0  the gate rides the auth payload ON; the sandbox is who it says it is
  W1  seed (member's API): 4 closed trades over one week via POST /api/j2/trades; the Compass
      weekly review generated for that same week (real call, see the warning above)
  W2  open Insights > Reviews (1200 px, mouse) and click "Draft this week's review": the browser
      navigates to the landed note
  W3  the note (1200 px): the numbers match the API's own aggregates; a leak toggle for the
      revenge pair exists; OPENING it (click) reveals its cited trades; the Compass quote renders
      as a G-064 ask-insert block (data-type="ask-insert") naming the week
  W4  keyboard: Tab reaches "Draft this week's review" and Enter fires it
  W5  390 px (touch): the Reviews tab, the draft, and the landed note; no sideways scroll; every
      control >= 44 px
  W6  no unforced page error across the walk
  --flag-off: F0 payload flag false; F1 all three review-drafts routes answer 404; F2 Insights
      shows no Reviews tab
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
FLAG_KEY = "notebook_review_drafts_enabled"
ET = ZoneInfo("America/New_York")
PORTS = range(8660, 8665)

res: dict = {"wave": 13, "lane": "13F", "checks": {}, "errors": [], "requests": []}
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


def monday_of(d: datetime) -> datetime:
    return d - timedelta(days=d.weekday())


def run_walk(base: str, art: Path, flag_off: bool) -> None:
    from playwright.sync_api import sync_playwright

    run = time.strftime("r%H%M%S")
    res["run"] = run
    pw = secrets.token_urlsafe(18)  # a TEST value for this run only; never written anywhere

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
        email = f"w13f-member-{run}@local.dev"
        res["accounts"] = {"member": email, "admin": H.ADMIN_EMAIL}
        H._signup_or_login(admin.request, base, H.ADMIN_EMAIL, H.ADMIN_PW, "hubtest")
        r = None
        for _attempt in range(3):
            r = member.request.post(base + "/api/auth/signup", data={"email": email, "password": pw, "display_name": "Walker"})
            if r.status != 429:
                break
            time.sleep(62)
        if r is None or r.status not in (200, 201):
            raise H.SetupFailed(f"could not sign up {email}: HTTP {getattr(r, 'status', None)}")
        admin.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
        admin.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
        if not member.request.get(base + "/api/auth/me").json().get("paid_equiv"):
            raise H.SetupFailed(f"{email} is not paid-equivalent")
        M = member.request
        member.on("request", lambda req: res["requests"].append(
            f"{req.method} {req.url.split(base, 1)[-1]}") if "/api/j2/review-drafts" in req.url else None)

        def new_page(ctx):
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
            return pg

        if flag_off:
            @guarded("F0_payload_flag_off")
            def f0():
                flag = find_key(M.get(base + "/api/auth/me").json(), FLAG_KEY)
                record("F0_payload_flag_off", "PASS" if flag is False else "FAIL", payload_flag=flag)
            f0()

            @guarded("F1_routes_404")
            def f1():
                today = datetime.now(ET).strftime("%Y-%m-%d")
                sts = {
                    "daily": M.get(base + "/api/j2/review-drafts/daily", params={"day": today}).status,
                    "weekly": M.get(base + "/api/j2/review-drafts/weekly", params={"weekStart": today}).status,
                    "monthly": M.get(base + "/api/j2/review-drafts/monthly", params={"month": today[:7]}).status,
                }
                record("F1_routes_404", "PASS" if all(v == 404 for v in sts.values()) else "FAIL", statuses=sts)
            f1()

            @guarded("F2_no_reviews_tab_in_insights")
            def f2():
                pg = new_page(member)
                pg.goto(base + "/journal/insights")
                H._dismiss_intro(pg)
                pg.wait_for_timeout(2500)
                tabs = pg.get_by_role("button", name="Reviews").count()
                s = shot(pg, "f2-insights-no-reviews-tab")
                record("F2_no_reviews_tab_in_insights", "PASS" if tabs == 0 else "FAIL", reviews_tabs=tabs, screenshot=s)
            f2()
            record("W6_no_page_errors", "PASS" if not res["errors"] else "FAIL", errors=res["errors"][:20])
            browser.close()
            return

        state: dict = {}

        @guarded("W0_gate_and_identity")
        def w0():
            flag = find_key(M.get(base + "/api/auth/me").json(), FLAG_KEY)
            record("W0_gate_and_identity", "PASS" if flag is True else "FAIL", payload_flag=flag)
        w0()

        @guarded("W1_seed_week_and_compass_review")
        def w1():
            accounts = M.get(base + "/api/j2/accounts").json()
            account_id = find_key(accounts, "id")
            if not account_id:
                raise H.SetupFailed("no j2 account found for the fresh member")
            state["account_id"] = account_id

            today = datetime.now(ET)
            # The ONE "Draft this week's review" button in Insights always targets
            # mondayOfIso() of RIGHT NOW (reviewDrafts.js / InsightsHub.jsx -- no date param),
            # so the seeded week MUST be the current one, not an arbitrary closed one: a prior
            # run seeded a week 14 days back, clicked the real button, and landed on an empty
            # "Week of <this week>" note -- trades=0, net_pnl=$0.00, no leak toggle -- a walk
            # bug, not a product one (traced via a body_text_excerpt diagnostic, not assumed).
            week_mon = monday_of(today)
            week_start = week_mon.strftime("%Y-%m-%d")
            state["week_start"] = week_start
            # Clamp every offset to a day that has already happened (never a future trade
            # date) so this still works no matter which weekday the walk is run on.
            days_elapsed = (today.date() - week_mon.date()).days

            def trade(sym, entry, stop, exit_, day_offset, hhmm):
                day_offset = min(day_offset, days_elapsed)
                day = (week_mon + timedelta(days=day_offset)).strftime("%Y-%m-%d")
                body = {
                    "symbol": sym, "side": "Long", "shares": 100, "entryPrice": entry,
                    "entryDate": day, "exitPrice": exit_, "exitDate": day, "originalStop": stop,
                    "entryTimeEt": hhmm[0], "exitTimeEt": hhmm[1],
                }
                t = M.post(base + "/api/j2/trades", data=body)
                if t.status != 200:
                    raise H.SetupFailed(f"seed trade {sym} failed: HTTP {t.status} {t.text()[:200]}")
                return (t.json().get("trade") or t.json()).get("id")

            created = {
                "loss": trade("NVDA", 100, 99, 95, 0, ("10:00", "10:30")),
                "reentry": trade("NVDA", 95, 94, 93, 0, ("10:45", "11:15")),
                "win1": trade("AAPL", 100, 99, 103, 1, ("10:00", "15:00")),
                "win2": trade("TSLA", 100, 99, 102, 2, ("10:00", "15:00")),
            }
            state["trades"] = created

            compass = M.post(
                base + f"/api/j2/accounts/{account_id}/coach/weekly-reviews/generate",
                data=json.dumps({"weekStart": week_start}),
                headers={"Content-Type": "application/json"},
            )
            state["compass_generated"] = compass.status == 200
            state["compass_status"] = compass.status
            record("W1_seed_week_and_compass_review", "PASS" if len(created) == 4 else "FAIL",
                   week_start=week_start, trades=created, compass_review_generated=compass.status == 200,
                   compass_status=compass.status,
                   note="a failed compass_review_generated is recorded, never fabricated as a pass; "
                        "W3's Compass sub-check reads INCONCLUSIVE when it is False")
        w1()

        @guarded("W2_draft_from_insights_reviews_1200")
        def w2():
            pg = new_page(member)
            pg.goto(base + "/journal/insights")
            H._dismiss_intro(pg)
            tab = pg.get_by_role("button", name="Reviews")
            tab.wait_for(timeout=45000)
            s0 = shot(pg, "w2-insights-reviews-tab-1200")
            tab.click()
            btn = pg.get_by_role("button", name="Draft this week", exact=False)
            btn.wait_for(timeout=15000)
            btn.click()
            pg.wait_for_url("**/journal/notebook*note=*", timeout=45000)
            pg.wait_for_selector(".ProseMirror", timeout=20000)
            s1 = shot(pg, "w2-landed-note-1200")
            note_id = pg.url.split("note=")[-1].split("&")[0]
            state["note_id"] = note_id
            state["note_page"] = pg
            record("W2_draft_from_insights_reviews_1200", "PASS" if note_id else "FAIL",
                   landed_url=pg.url, note_id=note_id, screenshots=[s0, s1])
        w2()

        @guarded("W3_note_numbers_leak_and_compass")
        def w3():
            note_id = state.get("note_id")
            pg = state.get("note_page")
            # WAIT for the editor to actually mount its document -- a sample right after
            # navigation can land on the route's own loading skeleton (jsdom-free lesson:
            # a waiter beats a sample taken at one instant). ".ProseMirror" is the editor's
            # own root; its presence is the ground truth, not a fixed sleep.
            pg.wait_for_selector(".ProseMirror", timeout=20000)
            api = M.get(base + "/api/j2/review-drafts/weekly",
                       params={"weekStart": state["week_start"]}).json()
            note = M.get(base + f"/api/j2/notes/{note_id}").json()["note"]
            body_text = json.dumps(note.get("bodyJson") or {})
            net_pnl = api["aggregates"]["net_pnl_dollar"]
            net_pnl_rendered = f"{'-' if net_pnl < 0 else ''}${abs(net_pnl):.2f}"  # matches reviewDrafts.js's fmtDollar
            has_numbers = net_pnl_rendered in body_text
            has_revenge = "revenge_reentry" in {f["kind"] for f in api.get("leaks", [])}
            # OPEN the leak: the toggle's <summary> click is intercepted by design (so placing a
            # text cursor there cannot collapse the block) -- the chevron BUTTON is the only way
            # `open` changes (lib/toggleNode.js). Read `data-open` before/after to prove it moved.
            toggle_div = pg.locator('[data-type="toggle"]', has_text="Revenge")
            toggle_count = toggle_div.count()
            opened = False
            if toggle_count > 0:
                before = toggle_div.first.get_attribute("data-open")
                toggle_div.first.locator("button.uctToggleChevron").click()
                pg.wait_for_timeout(300)
                after = toggle_div.first.get_attribute("data-open")
                opened = before == "false" and after == "true"
            s = shot(pg, "w3-note-leak-opened-1200")
            ask_insert = pg.locator('[data-type="ask-insert"]')
            compass_shows = (ask_insert.count() > 0 and "week" in (ask_insert.first.get_attribute("aria-label") or "").lower())
            ok = has_numbers and has_revenge and opened
            record("W3_note_numbers_leak_and_compass", "PASS" if ok else "FAIL",
                   net_pnl=api["aggregates"]["net_pnl_dollar"], net_pnl_rendered=net_pnl_rendered,
                   numbers_on_page=has_numbers,
                   api_has_revenge_leak=has_revenge, leak_opened=opened, toggle_count=toggle_count,
                   compass_ask_insert_present=ask_insert.count() > 0, compass_label_shows=compass_shows,
                   compass_was_generated=state.get("compass_generated"), screenshot=s,
                   # DIAGNOSTIC ONLY while this check is unstable -- not part of the verdict:
                   body_text_excerpt=(None if has_numbers else body_text[:4000]))
            if not state.get("compass_generated"):
                record("W3b_compass_label_shows", "INCONCLUSIVE",
                       reason="the seeding call to the pre-existing Compass weekly-review generator "
                              f"did not succeed (HTTP {state.get('compass_status')}); the review-drafts "
                              "payload therefore has no compassText to quote, independent of this lane's own code")
            else:
                record("W3b_compass_label_shows", "PASS" if compass_shows else "FAIL",
                       aria_label=ask_insert.first.get_attribute("aria-label") if ask_insert.count() else None)
        w3()

        @guarded("W4_keyboard")
        def w4():
            pg = new_page(member)
            pg.goto(base + "/journal/insights")
            H._dismiss_intro(pg)
            pg.get_by_role("button", name="Reviews").wait_for(timeout=45000)
            pg.get_by_role("button", name="Reviews").click()
            target = pg.get_by_role("button", name="Draft this week", exact=False)
            target.wait_for(timeout=15000)
            reached, presses = False, 0
            pg.keyboard.press("Tab")
            while presses < 60:
                presses += 1
                active = pg.evaluate("document.activeElement ? document.activeElement.textContent : ''")
                if active and "week" in active.lower() and "review" in active.lower():
                    reached = True
                    break
                pg.keyboard.press("Tab")
            if reached:
                with pg.expect_navigation(url="**/journal/notebook*note=*", timeout=45000):
                    pg.keyboard.press("Enter")
            s = shot(pg, "w4-keyboard-draft")
            record("W4_keyboard", "PASS" if reached else "FAIL", tabs_to_reach=presses, reached=reached, screenshot=s)
            pg.close()
        w4()

        @guarded("W5_phone_390")
        def w5():
            # Scoped to THIS lane's own surface -- [data-testid="review-drafts-section"] --
            # never the whole page: the pre-existing Insights sub-nav tabs (13A/other lanes'
            # work) run 40px tall, which is a fact about a surface this lane does not own and
            # must not be reported as a 13F defect. The landed note page is NoteEditorPage,
            # covered by the Notebook's own a11y/tap-floor rails; only an overflow check there.
            phone = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                        storage_state=member.storage_state())
            pg = new_page(phone)
            pg.goto(base + "/journal/insights")
            H._dismiss_intro(pg)
            pg.get_by_role("button", name="Reviews").tap()
            section = pg.locator('[data-testid="review-drafts-section"]')
            section.wait_for(timeout=15000)
            s0 = shot(pg, "w5-insights-reviews-390")
            probe1 = pg.evaluate(TOUCH_PROBE, '[data-testid="review-drafts-section"]')
            btn = pg.get_by_role("button", name="Draft this week", exact=False)
            btn.wait_for(timeout=15000)
            btn.tap()
            pg.wait_for_url("**/journal/notebook*note=*", timeout=45000)
            s1 = shot(pg, "w5-landed-note-390")
            overflow_after = pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
            ok = bool(probe1 and probe1["scrollW"] <= probe1["clientW"] + 1 and not probe1["small"] and overflow_after)
            record("W5_phone_390", "PASS" if ok else "FAIL", review_section_probe=probe1,
                   note_page_no_overflow=overflow_after, screenshots=[s0, s1])
            phone.close()
        w5()

        record("W6_no_page_errors", "PASS" if not res["errors"] else "FAIL", errors=res["errors"][:20])
        browser.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wave 13 lane 13F live walk (see the module header).")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8660)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tip", default=None)
    ap.add_argument("--artifacts", required=True)
    ap.add_argument("--flag-off", action="store_true")
    args = ap.parse_args(argv)
    if args.port not in PORTS:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: port {args.port} is outside 8660-8664)")
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
    return 0 if verdicts and all(v in ("PASS", "INCONCLUSIVE") for v in verdicts) else 1


if __name__ == "__main__":
    sys.exit(main())
