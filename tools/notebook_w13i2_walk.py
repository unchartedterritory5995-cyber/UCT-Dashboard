"""Wave 13 lane 13I-2 live walk -- the fingerprint panel, the setup-tag suggestion, the visual
playbook and before/after, in a real Chromium against a LOCAL sandbox, at 1200 and 390 px. It
writes RAW evidence only: docs/notebook/evidence/wave13-13i2/walk-<sha>/walk.json (+ the
launcher's integrity log and screenshots). It is NOT a pytest rail and draws no conclusion.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. The market stores are seeded by a SEPARATE process,
tools/notebook_w13i2_walk_seed.py (sandbox env applied first), then the sandbox boots through the
perf harness's `Sandbox`; everything after that is HTTP and a browser. No model is called.

Run it from POWERSHELL with the gates in that same shell (ports 8640-8644 only):

    $env:NOTEBOOK_TA_FINGERPRINT_ENABLED = '1'
    $env:NOTEBOOK_VISUAL_PLAYBOOK_ENABLED = '1'
    $env:NOTEBOOK_PLAN_GRADING_ENABLED = '1'
    python tools/notebook_w13i2_walk.py --data-dir '<scratchpad>\\w13i2-data' --port 8640 `
        --out docs/notebook/evidence/wave13-13i2/walk-<sha>/walk.json --tip <sha> `
        --artifacts docs/notebook/evidence/wave13-13i2/walk-<sha>

Preconditions: app/dist built from the tip; the port free (refused, never killed); the data dir
outside the shared root (refused) and fresh.

One paid member (comped by the launcher's admin, hubtest@local.dev). SEEDED (synthetic, said so in
the evidence): NVDA + SPY daily bars and one confirmed NVDA `vcp` verdict (the seed process); four
plan notes over the member's own API (AMD, TSLA, MSFT, META), each with a tagged chart whose `ta`
carries a fingerprint, and three trades graded by 13A's own route so each plan's frozen link is
13A's.

  W0  the three gates ride the auth payload ON; the sandbox is who it says it is
  W1  insert a chart (1200, keyboard: `/chart NVDA D` typed into the editor): the fingerprint
      panel appears, waits for the save, freezes, and the note's `ta.fingerprint` is SAVED (read
      back over the API) with a source per field and missing values labelled
  W2  the suggested tag: shown, NOT applied (the saved note has no tag); one click applies it
      and the saved note then carries it
  W3  the visual playbook (1200): open from the panel; filter Setup = VCP and RS rank >= 90; the
      slice stats with the R3 wording, revealed; the cards and the excluded count match the API
  W4  before and after (1200): a graded trade's page shows the entry and exit charts with the
      plan line
  W5  390 px (touch): the panel, the playbook and before/after; no sideways scroll; every
      control >= 44 px
  W6  no unforced page error across the walk
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import subprocess
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
FLAG_KEYS = ("notebook_ta_fingerprint_enabled", "notebook_visual_playbook_enabled", "notebook_plan_grading_enabled")
ET = ZoneInfo("America/New_York")
PORTS = range(8640, 8645)

res: dict = {"wave": 13, "lane": "13I-2", "checks": {}, "errors": [], "requests": [], "seeded": {}}
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


def last_session(today: datetime) -> str:
    d = today.date()
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


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


def chart_embeds(body):
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "widgetEmbed" and (n.get("attrs") or {}).get("widgetId") == "chart":
                out.append(n["attrs"])
            for c in n.get("content") or []:
                walk(c)
    walk(body)
    return out


def fp_cell(value, source="screener_row", missing=None):
    return {"value": value, "source": source, "missing": missing}


def seeded_fingerprint(symbol, day, rs, depth, adr, pole, stack="full-bull"):
    """A fingerprint in 13I-1's shape, SYNTHETIC (the evidence says so)."""
    fields = {f: fp_cell(None, missing="not_in_screener_row") for f in (
        "adr_pct", "pct_vs_sma10", "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200", "ma_stack",
        "ema_stack_intact", "rs_rank", "rs_line_trend", "base_length_bars", "base_depth_pct",
        "pullback_depth_pct", "vol_nweek_low", "close_cv_pct", "pole_pct")}
    fields.update({"rs_rank": fp_cell(rs), "base_depth_pct": fp_cell(depth, "bars"), "adr_pct": fp_cell(adr),
                   "pole_pct": fp_cell(pole), "ma_stack": fp_cell(stack), "vol_nweek_low": fp_cell(15),
                   "rs_line_trend": fp_cell("up")})
    fields["patterns"] = fp_cell(None, "pattern_vision", "patterns_current_window_only")
    return {"v": 1, "symbol": symbol, "requested_as_of": day, "as_of": day, "mode": "nightly", "fields": fields,
            "seeded": "synthetic walk seed"}


def plan_body(symbol, tag, fp, to_unix, levels):
    para = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}  # noqa: E731
    return {"type": "doc", "content": [
        para(f"Entry: {levels[0]}"), para(f"Stop: {levels[1]}"), para(f"Target: {levels[2]}"), para("Shares: 100"),
        {"type": "widgetEmbed", "attrs": {
            "v": 1, "widgetId": "chart", "params": {"symbol": symbol, "tf": "D", "to": to_unix},
            "capturedAt": datetime.now().astimezone().isoformat(), "embedId": f"seed-{symbol.lower()}",
            "mode": "snapshot", "fallback": None, "annotations": [], "layout": {"width": "full", "height": None},
            "searchText": f"[chart: {symbol} D]", "ta": {"v": 1, "setupTag": tag, "fingerprint": fp}}},
    ]}


def run_walk(base: str, art: Path, day: str) -> None:
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
        email = f"w13i2-member-{run}@local.dev"
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
        member.on("request", lambda req: res["requests"].append(f"{req.method} {req.url.split(base, 1)[-1]}")
                  if ("/api/j2/notebook-" in req.url or (req.method != "GET" and "/api/j2/notes" in req.url)) else None)

        def new_page(ctx):
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
            return pg

        def get_note(nid):
            return M.get(base + f"/api/j2/notes/{nid}").json()["note"]

        state: dict = {}

        # ── seed the playbook: four plan notes, three graded trades (13A's own route) ──────────
        to_unix = int(datetime.fromisoformat(day + "T16:00:00").replace(tzinfo=ET).timestamp())
        seeds = [("AMD", "VCP", 96, 9.5, 4.2, 71.0, (100, 96, 112), ("Win", 110)),
                 ("TSLA", "VCP", 82, 14.0, 5.8, 55.0, (200, 190, 230), ("Loss", 188)),
                 ("MSFT", "Flat Base Breakout", 91, 7.1, 2.1, 33.0, (400, 388, 436), ("Win", 420)),
                 ("META", "Bull Flag", 88, 12.0, 3.3, 41.0, (500, 480, 560), None)]
        notes = {}
        for sym, tag, rs, depth, adr, pole, lv, _ in seeds:
            body = plan_body(sym, tag, seeded_fingerprint(sym, day, rs, depth, adr, pole), to_unix, lv)
            n = M.post(base + "/api/j2/notes", data={"title": f"{sym} plan {run}", "ticker": sym, "bodyJson": body}).json()["note"]
            notes[sym] = n["id"]
        res["seeded"]["notes"] = {s: {"id": notes[s], "tag": t, "rs_rank": rs} for s, t, rs, *_ in seeds}
        now = datetime.now(ET)
        nxt = (now + timedelta(minutes=1)).replace(second=1, microsecond=0)
        time.sleep(max(0.0, (nxt - now).total_seconds()))
        tday, hhmm = nxt.strftime("%Y-%m-%d"), nxt.strftime("%H:%M")
        trades = {}
        for sym, _tag, _rs, _d, _a, _p, lv, out in seeds:
            if not out:
                continue
            t = M.post(base + "/api/j2/trades", data={
                "symbol": sym, "side": "Long", "shares": 100, "entryPrice": lv[0], "entryDate": tday, "entryTimeEt": hhmm,
                "exitPrice": out[1], "exitDate": tday, "exitTimeEt": hhmm, "originalStop": lv[1]})
            body = t.json()
            tid = (body.get("trade") or body).get("id")
            g = M.get(base + f"/api/j2/plan-grades/trades/{tid}").json()
            trades[sym] = {"id": tid, "status": g.get("status"), "noteId": (g.get("plan") or {}).get("noteId")}
        res["seeded"]["trades"] = trades
        state["trades"] = trades

        @guarded("W0_gates_and_identity")
        def w0():
            me = M.get(base + "/api/auth/me").json()
            flags = {k: find_key(me, k) for k in FLAG_KEYS}
            graded = all(t["status"] == "planned" and t["noteId"] == notes[s] for s, t in trades.items())
            record("W0_gates_and_identity", "PASS" if all(v is True for v in flags.values()) and graded else "FAIL",
                   payload_flags=flags, seeded_trades_graded_by_13a=graded, trades=trades)
        w0()

        @guarded("W1_insert_chart_fingerprint_panel_1200")
        def w1():
            created = M.post(base + "/api/j2/notes", data={"title": f"NVDA chart {run}", "ticker": "NVDA"}).json()["note"]
            nid = created["id"]
            state["nvda_note"] = nid
            pg = new_page(member)
            pg.goto(base + f"/journal/notebook?note={nid}")
            H._dismiss_intro(pg)
            ed = pg.locator(".ProseMirror").first
            ed.wait_for(timeout=30000)
            ed.click()
            pg.keyboard.press("End")
            pg.keyboard.type("/chart NVDA D", delay=40)
            pg.wait_for_timeout(600)
            pg.keyboard.press("Enter")
            panel = pg.locator('[data-testid="fingerprint-panel"]').first
            panel.wait_for(timeout=30000)
            first_text = " ".join(panel.inner_text().split())
            panel.get_by_text(" · frozen", exact=False).first.wait_for(timeout=90000)
            pg.wait_for_timeout(3000)          # the ta write's own autosave
            note = get_note(nid)
            embeds = chart_embeds(note.get("bodyJson"))
            saved_fp = ((embeds[0].get("ta") or {}).get("fingerprint") if embeds else None)
            panel.get_by_role("button", name="Show all fields and sources").click()
            rows = pg.locator('[data-fp-field]').all_inner_texts()
            s = shot(pg, "w1-panel-1200")
            block_key = embeds[0].get("embedId") if embeds else None
            block = M.get(base + f"/api/j2/notebook-fingerprint/blocks/{nid}/{block_key}").json().get("block") if block_key else None
            writes = [r for r in res["requests"] if r.startswith(("PUT /api/j2/notes", "PATCH /api/j2/notes"))]
            missing_labelled = any("Not available:" in r for r in rows)
            ok = bool(saved_fp) and saved_fp.get("symbol") == "NVDA" and block and block.get("fingerprintSource") == "note" \
                and len(rows) >= 15 and missing_labelled
            state["editor_page"] = pg
            record("W1_insert_chart_fingerprint_panel_1200", "PASS" if ok else "FAIL", note=nid,
                   panel_text_at_mount=first_text[:200], saved_fingerprint_as_of=(saved_fp or {}).get("as_of"),
                   saved_fingerprint_mode=(saved_fp or {}).get("mode"), block_source=(block or {}).get("fingerprintSource"),
                   field_rows=rows[:16], note_writes_seen=writes[:10], screenshot=s,
                   how="note created empty over the API; the chart typed as /chart NVDA D in the real editor")
        w1()

        @guarded("W2_suggested_tag_shown_not_applied_then_accepted")
        def w2():
            pg = state["editor_page"]
            sug = pg.locator('[data-testid="tag-suggestion"]').first
            sug.wait_for(timeout=20000)
            text = " ".join(sug.inner_text().split())
            pg.wait_for_timeout(2500)
            before = chart_embeds(get_note(state["nvda_note"]).get("bodyJson"))
            tag_before = ((before[0].get("ta") or {}).get("setupTag") if before else None)
            s1 = shot(pg, "w2-suggestion-1200")
            sug.get_by_role("button", name="Use “VCP”").click()
            pg.wait_for_timeout(3500)
            after = chart_embeds(get_note(state["nvda_note"]).get("bodyJson"))
            tag_after = ((after[0].get("ta") or {}).get("setupTag") if after else None)
            s2 = shot(pg, "w2-tag-accepted-1200")
            ok = "VCP" in text and "not applied" in text and tag_before is None and tag_after == "VCP"
            record("W2_suggested_tag_shown_not_applied_then_accepted", "PASS" if ok else "FAIL", suggestion=text,
                   saved_tag_before_click=tag_before, saved_tag_after_click=tag_after, screenshots=[s1, s2])
        w2()

        @guarded("W3_visual_playbook_filter_setup_and_rs_1200")
        def w3():
            pg = state["editor_page"]
            btn = pg.get_by_role("button", name="Visual playbook").first
            btn.focus()
            pg.keyboard.press("Enter")                      # opened from the keyboard
            book = pg.locator('[data-testid="visual-playbook"]')
            book.wait_for(timeout=30000)
            pg.locator('[data-testid="playbook-card"]').first.wait_for(timeout=30000)
            all_cards = pg.locator('[data-testid="playbook-card"]').count()
            s0 = shot(pg, "w3-playbook-all-1200")
            book.get_by_label("Setup").select_option("tag:VCP")
            book.get_by_label("RS rank at least").fill("90")
            pg.wait_for_timeout(1500)
            cards = pg.locator('[data-testid="playbook-card"]')
            syms = [c.split()[0] for c in cards.all_inner_texts() if c.strip()]
            stats = pg.locator('[data-testid="slice-stats"]')
            stats_text = " ".join(stats.inner_text().split())
            reveal = stats.get_by_role("button", name="Show the numbers anyway")
            revealed = None
            if reveal.count():
                reveal.click()
                revealed = " ".join(stats.inner_text().split())
            left_out = [" ".join(t.split()) for t in book.locator("p").all_inner_texts() if "left out" in t]
            s1 = shot(pg, "w3-playbook-vcp-rs90-1200")
            api = M.get(base + "/api/j2/notebook-visual-playbook/cards?setup=VCP&range=rs_rank:90:").json()
            api_syms = [c["symbol"] for c in api["cards"]]
            ok = syms == api_syms == ["AMD"] and "too few to judge" in stats_text and revealed and "Win rate" in revealed \
                and api["excludedMissing"].get("rs_rank") == 1 and left_out
            record("W3_visual_playbook_filter_setup_and_rs_1200", "PASS" if ok else "FAIL", cards_unfiltered=all_cards,
                   cards_shown=syms, cards_api=api_syms, stats=stats_text, revealed=revealed, left_out=left_out,
                   api_stats={k: api["stats"].get(k) for k in ("trades", "band", "wording", "winRate", "avgR")},
                   regime=api.get("regime"), screenshots=[s0, s1])
            pg.keyboard.press("Escape")
        w3()

        @guarded("W4_before_after_1200")
        def w4():
            tid = state["trades"]["AMD"]["id"]
            pg = new_page(member)
            pg.goto(base + f"/journal-2-0/trade/{tid}")
            H._dismiss_intro(pg)
            card = pg.locator('[data-testid="trade-before-after"]')
            card.wait_for(timeout=30000)
            pg.get_by_text("Plan levels from", exact=False).first.wait_for(timeout=20000)
            card.scroll_into_view_if_needed()
            pg.wait_for_timeout(2500)
            text = " ".join(card.inner_text().split())
            figures = card.locator("figure").count()
            canvases = card.locator("canvas").count()
            s = shot(pg, "w4-before-after-1200")
            api = M.get(base + f"/api/j2/notebook-visual-playbook/trades/{tid}/before-after").json()
            ok = "Before: AMD" in text and "After: AMD" in text and "entry 100" in text and api.get("planStatus") == "linked"
            record("W4_before_after_1200", "PASS" if ok else "FAIL", text=text[:400], figures=figures, canvases=canvases,
                   api_plan=api.get("plan"), entry_day=(api.get("trade") or {}).get("entryDay"), screenshot=s)
        w4()

        @guarded("W5_phone_390")
        def w5():
            phone = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                        storage_state=member.storage_state())
            pg = new_page(phone)
            pg.goto(base + f"/journal/notebook?note={state['nvda_note']}")
            H._dismiss_intro(pg)
            panel = pg.locator('[data-testid="fingerprint-panel"]').first
            panel.wait_for(timeout=40000)
            panel.scroll_into_view_if_needed()
            p_panel = pg.evaluate(TOUCH_PROBE, '[data-testid="fingerprint-panel"]')
            s1 = shot(pg, "w5-panel-390")
            panel.get_by_role("button", name="Visual playbook").tap()
            pg.locator('[data-testid="playbook-card"]').first.wait_for(timeout=30000)
            p_book = pg.evaluate(TOUCH_PROBE, '[data-testid="visual-playbook"]')
            s2 = shot(pg, "w5-playbook-390")
            tid = state["trades"]["AMD"]["id"]
            pg2 = new_page(phone)
            pg2.goto(base + f"/journal-2-0/trade/{tid}")
            H._dismiss_intro(pg2)
            pg2.locator('[data-testid="trade-before-after"]').wait_for(timeout=30000)
            pg2.locator('[data-testid="trade-before-after"]').scroll_into_view_if_needed()
            pg2.wait_for_timeout(1500)
            p_ba = pg2.evaluate(TOUCH_PROBE, '[data-testid="trade-before-after"]')
            s3 = shot(pg2, "w5-before-after-390")
            probes = {"panel": p_panel, "playbook": p_book, "before_after": p_ba}
            ok = all(v and v["scrollW"] <= v["clientW"] and not v["small"] for v in probes.values())
            record("W5_phone_390", "PASS" if ok else "FAIL", probes=probes, screenshots=[s1, s2, s3])
            phone.close()
        w5()

        record("W6_no_page_errors", "PASS" if not res["errors"] else "FAIL", errors=res["errors"][:20])
        browser.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wave 13 lane 13I-2 live walk (see the module header).")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8640)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tip", default=None)
    ap.add_argument("--artifacts", required=True)
    args = ap.parse_args(argv)
    if args.port not in PORTS:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: port {args.port} is outside 8640-8644)")
        return 3
    base = f"http://127.0.0.1:{args.port}"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    art = Path(args.artifacts)
    art.mkdir(parents=True, exist_ok=True)
    res.update({"tip": args.tip, "base": base, "data_dir": args.data_dir,
                "instrument": os.path.relpath(__file__, REPO),
                "gate_source": "the sandbox's auth payload (row W0 payload_flags)"})
    refused = H.refuse_shared_root(args.data_dir)
    if not refused and H.port_busy(args.port):
        refused = f"port {args.port} already has a listener (never killed)"
    if refused:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: {refused})")
        return 3
    day = last_session(datetime.now(ET))
    seed = subprocess.run([sys.executable, str(REPO / "tools" / "notebook_w13i2_walk_seed.py"),
                           "--data-dir", args.data_dir, "--through", day],
                          cwd=str(REPO), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
    res["seeded"]["market_stores"] = {"rc": seed.returncode,
                                      "line": next((ln for ln in seed.stdout.splitlines() if ln.startswith("SEED ")), None),
                                      "stderr_tail": seed.stderr[-800:]}
    if seed.returncode != 0:
        out.write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
        print("SANDBOX INTEGRITY: NOT RUN (the market-store seed failed; see seeded.market_stores)")
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
                    run_walk(base, art, day)
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
