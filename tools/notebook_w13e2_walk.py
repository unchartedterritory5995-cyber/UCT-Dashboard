"""Wave 13 lane 13E-2 live walk -- the market context frozen at the fill (the card, the "why"
prompt, the one-a-day bell), in a real Chromium, against a LOCAL sandbox. It writes RAW evidence
only: docs/notebook/evidence/wave13-13e2/walk-<sha>/walk.json (+ the launcher's integrity log and
screenshots). It is NOT a pytest rail, and it draws no conclusion: each row records what the
browser and the API showed.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. It owns its sandbox through the perf harness's `Sandbox`
(scripts/hub_sandbox_boot.py, own process group, stopped gracefully so the launcher writes its
SHUTDOWN checkpoint), talks to it over HTTP only, and prints the launcher's snapshot verdict
(`SANDBOX INTEGRITY: ...`) as its FIRST output line. No model is called.

Run it from POWERSHELL with the gate in that same shell (ports 8650-8654 only):

    $env:NOTEBOOK_ENTRY_CONTEXT_ENABLED = '1'
    python tools/notebook_w13e2_walk.py --data-dir '<scratchpad>\\w13e2-data' --port 8650 `
        --out docs/notebook/evidence/wave13-13e2/walk-<sha>/walk.json --tip <sha> `
        --artifacts docs/notebook/evidence/wave13-13e2/walk-<sha>

Preconditions: app/dist built from the tip; the port free (refused, never killed); the data dir
outside the shared root (refused). `NOTEBOOK_VOICE_NOTES_ENABLED` is deliberately LEFT UNSET so
P6 (no mic) exercises the real default-off state, not a stubbed one.

One paid member (comped by the launcher's admin, hubtest@local.dev).

  P0  the gate rides the auth payload ON; the sandbox is who it says it is
  P1  log two positions today over the member's API (NVDA, AMD); open the NVDA position page
      (1200 px) -- the Entry-context card shows, every field carries an as-of
  P2  answer the prompt (1200 px, keyboard): type a "why did you take it" reason into the real
      textarea, Save; the saved view renders it back
  P3  one bell line a day: however many fills (two, this run), GET /api/alerts shows exactly ONE
      `notebook_entry_context_new_fill` row for the member; the bell UI shows it once
  P4  close the trade (member's API); open its trade page (1200 px) -- the SAME card, and the
      SAME "why" text, both stay after the close
  P5  a past-dated position (member's API) reads "not captured" on its own page -- the server's
      sentence only, never a field row, never the captured testid
  P6  no microphone with the voice flag off: a getUserMedia counter armed BEFORE the position
      page loads reads 0 after the whole walk, and no dictation control is in the DOM
  P7  390 px (touch): the trade page's card; no sideways scroll; its buttons are >= 44 px
  P8  no unforced page error across the walk
"""
from __future__ import annotations

import argparse
import json
import os
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
FLAG_KEY = "notebook_entry_context_enabled"
BELL_SOURCE = "notebook_entry_context_new_fill"
ET = ZoneInfo("America/New_York")
PORTS = range(8650, 8655)

res: dict = {"wave": 13, "lane": "13E-2", "checks": {}, "errors": [], "requests": []}
LINES: list[str] = []


def record(key, verdict, **facts):
    res["checks"][key] = {"verdict": verdict, **facts}
    line = f"[{verdict}] {key}: " + json.dumps(facts, default=str, ensure_ascii=True)[:800]
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
  const c = document.querySelector('[data-testid="entry-context-card"]')
  if (!c) return null
  const fields = {}
  for (const row of c.querySelectorAll('[data-field]')) fields[row.getAttribute('data-field')] = row.innerText.replace(/\s+/g, ' ').trim()
  return { text: c.innerText.replace(/\s+/g, ' ').trim(), fields, late: !!c.querySelector('[data-testid="entry-context-late"]') }
}
"""

# Armed BEFORE any page navigates (Playwright add_init_script), so it wraps the REAL
# getUserMedia on every document this context creates -- the only way to prove the mic was
# never requested rather than merely "the button isn't on screen right now".
GUM_COUNTER_INIT = r"""
(() => {
  window.__gumCalls = 0;
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = (...args) => { window.__gumCalls += 1; return orig(...args); };
  }
})();
"""


def run_walk(base: str, art: Path) -> None:
    from playwright.sync_api import sync_playwright

    run = time.strftime("r%H%M%S")
    res["run"] = run
    today = datetime.now(ET).strftime("%Y-%m-%d")
    past = (datetime.now(ET) - timedelta(days=10)).strftime("%Y-%m-%d")

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
        member.add_init_script(GUM_COUNTER_INIT)
        email = f"w13e2-member-{run}@local.dev"
        pw = "W13e2Walk!2026"
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
            f"{req.method} {req.url.split(base, 1)[-1]}") if "/api/j2/entry-context" in req.url else None)

        def new_page(ctx):
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
            return pg

        def open_position(pg, sym):
            pg.goto(base + f"/journal-2-0/position/{sym}")
            H._dismiss_intro(pg)

        def open_trade(pg, tid):
            pg.goto(base + f"/journal-2-0/trade/{tid}")
            H._dismiss_intro(pg)

        state: dict = {}

        @guarded("P0_gate_and_identity")
        def p0():
            flag = find_key(M.get(base + "/api/auth/me").json(), FLAG_KEY)
            voice = find_key(M.get(base + "/api/auth/me").json(), "notebook_voice_notes_enabled")
            record("P0_gate_and_identity", "PASS" if flag is True and voice is not True else "FAIL",
                   payload_flag=flag, voice_flag=voice, note="voice_flag must NOT be True for P6 to mean anything")
        p0()

        @guarded("P1_log_a_position_the_card_shows_1200")
        def p1():
            nvda = M.post(base + "/api/j2/positions", data={
                "symbol": "NVDA", "side": "Long", "shares": 10, "entryPrice": 100.0,
                "stopPrice": 95.0, "entryDate": today,
            }).json()
            amd = M.post(base + "/api/j2/positions", data={
                "symbol": "AMD", "side": "Long", "shares": 5, "entryPrice": 150.0,
                "stopPrice": 145.0, "entryDate": today,
            }).json()
            state["nvda_id"] = nvda["id"]
            state["amd_id"] = amd["id"]
            pg = new_page(member)
            open_position(pg, "NVDA")
            pg.locator('[data-testid="entry-context-card"]').wait_for(timeout=30000)
            card = pg.evaluate(CARD_TEXT)
            s = shot(pg, "p1-card-1200")
            state["position_page"] = pg
            ok = bool(card) and "Regime" in card["text"] and all(
                k in card["fields"] for k in ("regime", "exposure", "breadth_pct_above_50", "rs_rank",
                                              "days_to_earnings", "uct_scans"))
            record("P1_log_a_position_the_card_shows_1200", "PASS" if ok else "FAIL",
                   nvda_position=nvda["id"], amd_position=amd["id"], card=card, screenshot=s,
                   how="both positions logged over the member's API; the card read from the NVDA page")
        p1()

        @guarded("P2_answer_the_prompt_keyboard_1200")
        def p2():
            pg = state["position_page"]
            box = pg.locator("#why-prompt-text")
            box.wait_for(timeout=15000)
            box.click()
            pg.keyboard.type("Tight flag at the 21EMA, volume dried up", delay=12)
            pg.get_by_role("button", name="Save").click()
            saved = pg.locator('[data-testid="why-prompt-saved"]')
            saved.wait_for(timeout=15000)
            text = saved.inner_text()
            s = shot(pg, "p2-why-saved-1200")
            state["why_text"] = "Tight flag at the 21EMA, volume dried up"
            record("P2_answer_the_prompt_keyboard_1200", "PASS" if state["why_text"] in text else "FAIL",
                   saved_text=text, screenshot=s)
        p2()

        @guarded("P3_one_bell_line_a_day")
        def p3():
            alerts = M.get(base + "/api/alerts").json()
            bell_rows = [a for a in alerts if a.get("type") == BELL_SOURCE]
            # AlertBell is mounted in MobileNav (<=1024px), not the desktop NavBar (commented out
            # there pending a restore -- app/src/components/NavBar.jsx:225) -- so the UI half of
            # this check rides a touch-width context, sharing the member's signed-in session.
            touch = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
                                        is_mobile=True, storage_state=member.storage_state())
            pg = new_page(touch)
            pg.goto(base + "/journal")
            H._dismiss_intro(pg)
            pg.get_by_role("button", name="Notifications").click()
            pg.get_by_text("New fill captured").first.wait_for(timeout=15000)
            bell_on_screen = pg.get_by_text("New fill captured").count()
            s = shot(pg, "p3-bell-390")
            touch.close()
            ok = len(bell_rows) == 1 and bell_on_screen == 1
            record("P3_one_bell_line_a_day", "PASS" if ok else "FAIL",
                   bell_rows_for_today=len(bell_rows), bell_rows=bell_rows, bell_on_screen=bell_on_screen,
                   fills_logged_today=2, screenshot=s,
                   how="two positions froze today (NVDA, AMD); the per-day claim allows exactly one; "
                       "the UI read is from MobileNav's AlertBell (the desktop NavBar has none mounted)")
        p3()

        @guarded("P4_close_the_trade_the_card_stays_1200")
        def p4():
            closed = M.post(base + f"/api/j2/positions/{state['nvda_id']}/close", data={
                "shares": 10, "exitPrice": 112.0, "exitDate": today,
            }).json()
            trade = closed.get("trade") or closed
            tid = trade["id"]
            state["trade_id"] = tid
            pg = new_page(member)
            open_trade(pg, tid)
            pg.locator('[data-testid="entry-context-card"]').wait_for(timeout=30000)
            card = pg.evaluate(CARD_TEXT)
            saved = pg.locator('[data-testid="why-prompt-saved"]')
            saved.wait_for(timeout=15000)
            why_text = saved.inner_text()
            s = shot(pg, "p4-trade-card-1200")
            state["trade_page"] = pg
            ok = bool(card) and card["text"] and state["why_text"] in why_text
            record("P4_close_the_trade_the_card_stays_1200", "PASS" if ok else "FAIL",
                   trade=tid, card=card, why_text=why_text, screenshot=s,
                   how="same (symbol, entry day) key -- the trade page reads the position's frozen row")
        p4()

        @guarded("P5_a_past_day_reads_not_captured")
        def p5():
            msft = M.post(base + "/api/j2/positions", data={
                "symbol": "MSFT", "side": "Long", "shares": 3, "entryPrice": 400.0,
                "stopPrice": 390.0, "entryDate": past,
            }).json()
            state["msft_id"] = msft["id"]
            pg = new_page(member)
            open_position(pg, "MSFT")
            nc = pg.locator('[data-testid="entry-context-not-captured"]')
            nc.wait_for(timeout=30000)
            text = nc.inner_text()
            card_absent = pg.locator('[data-testid="entry-context-card"]').count() == 0
            s = shot(pg, "p5-not-captured-1200")
            ok = card_absent and ("captured" in text.lower() or "entry day" in text.lower())
            record("P5_a_past_day_reads_not_captured", "PASS" if ok else "FAIL",
                   position=msft["id"], entry_date=past, text=text, card_absent=card_absent, screenshot=s)
        p5()

        @guarded("P6_no_microphone_with_voice_off")
        def p6():
            pg = state["trade_page"]
            no_voice_btn = pg.get_by_test_id("why-prompt-voice").count() == 0
            no_start_voice = pg.get_by_role("button", name="Start voice input").count() == 0
            gum_calls = pg.evaluate("() => window.__gumCalls || 0")
            total_gum = 0
            for other in (state["position_page"],):
                try:
                    total_gum += other.evaluate("() => window.__gumCalls || 0")
                except Exception:  # noqa: BLE001 -- a closed/navigated page is fine to skip
                    pass
            total_gum += gum_calls
            ok = no_voice_btn and no_start_voice and total_gum == 0
            record("P6_no_microphone_with_voice_off", "PASS" if ok else "FAIL",
                   voice_button_present=not no_voice_btn, start_voice_button_present=not no_start_voice,
                   getUserMedia_calls=total_gum,
                   how="getUserMedia wrapped by an init script present on every document in this context")
        p6()

        @guarded("P7_phone_390")
        def p7():
            phone = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                        storage_state=member.storage_state())
            pg = new_page(phone)
            open_trade(pg, state["trade_id"])
            pg.locator('[data-testid="entry-context-card"]').wait_for(timeout=30000)
            pg.locator('[data-testid="entry-context-card"]').scroll_into_view_if_needed()
            probe = pg.evaluate(TOUCH_PROBE, '[data-testid="entry-context-card"]')
            s = shot(pg, "p7-trade-card-390")
            ok = bool(probe) and probe["scrollW"] <= probe["clientW"] and not probe["small"]
            record("P7_phone_390", "PASS" if ok else "FAIL", probe=probe, screenshot=s)
            phone.close()
        p7()

        record("P8_no_page_errors", "PASS" if not res["errors"] else "FAIL", errors=res["errors"][:20])
        browser.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wave 13 lane 13E-2 live walk (see the module header).")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8650)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tip", default=None)
    ap.add_argument("--artifacts", required=True)
    args = ap.parse_args(argv)
    if args.port not in PORTS:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: port {args.port} is outside 8650-8654)")
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
