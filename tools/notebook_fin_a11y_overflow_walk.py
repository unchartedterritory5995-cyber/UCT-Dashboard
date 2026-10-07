"""Finish program, lane A11Y round 3 -- sideways overflow at phone, tablet and desktop widths.

Overflow is a layout fact jsdom cannot see, so this measures it in a real browser. For five
screens, at 390, 820 and 1280 px, it records `document.documentElement.scrollWidth` against
`clientWidth`, the same pair for the PAGE SCROLLER (this app scrolls an inner <main>, so the
document never grows), the elements whose right edge runs past it (never ones inside their own
horizontal scroller), and the box of the saved "why" Edit control on the entry context card. It writes RAW JSON and judges nothing but "wider than the window".

It OWNS its sandbox (tools/notebook_perf_harness.py's `Sandbox`: scripts/hub_sandbox_boot.py,
stopped gracefully so the launcher writes its SHUTDOWN checkpoint) and boots it TWICE on the
same port and data dir:

  boot OFF  no Notebook capability variable set (what production has for these two).
  boot ON   NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED=1, plus NOTEBOOK_ENTRY_CONTEXT_ENABLED=1 (so the
            entry context card and its Edit control are on screen) and the earnings prep and
            trade canvas switches (each adds a button to the research workspace header, so
            this is that header at its fullest).

Run from PowerShell (a Windows path through the Bash tool can lose its backslash):

    python tools/notebook_fin_a11y_overflow_walk.py --data-dir 'C:/data-fin-a11y' --port 8135 `
        --out 'docs/notebook/evidence/fin-a11y/before'

Preconditions: app/dist rebuilt from the tree being measured; the port free (refused, never
killed); the data dir outside the shared root (refused).

Exit: 0 = ran and integrity CLEAN on both boots; 2 = integrity not CLEAN; 3 = refused / not run.
The verdict about overflow is in walk.json (`summary`), not in the exit code: a "before" run is
expected to show overflow.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.*

MEMBER = ("fina11y@local.dev", "LocalTest2026!", "fina11y")
PORT = 8135
# Transcript capture is the state asked for. Entry context puts the card (and its Edit control)
# on screen. Earnings prep and the trade canvas each add a button to the research workspace
# header, so ON is also that header at its fullest.
ENV_ON = ("NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED", "NOTEBOOK_ENTRY_CONTEXT_ENABLED",
          "NOTEBOOK_EARNINGS_PREP_ENABLED", "NOTEBOOK_TRADE_CANVAS_ENABLED")
WIDTHS = {390: {"width": 390, "height": 844}, 820: {"width": 820, "height": 1180}, 1280: {"width": 1280, "height": 900}}
TAP_FLOOR = 44

MEASURE_JS = """() => {
  const de = document.documentElement
  const vw = de.clientWidth
  // ⛔ This app's page does not scroll the document: the shell is overflow hidden and an inner
  // <main> scrolls. So `documentElement.scrollWidth` reads the window's width whatever the page
  // does, and the number that says "the page scrolls sideways" is the PAGE SCROLLER's own
  // scrollWidth against its clientWidth. Both are recorded. (The first run of this tool read
  // only the document and reported no overflow anywhere; its raw rows already held the
  // scroller's 534 / 470 / 406.)
  let page = null
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue
    const r = el.getBoundingClientRect()
    if (r.width < vw * 0.6) continue
    if (!page || el.clientHeight > page.clientHeight) page = el
  }
  const pr = page ? page.getBoundingClientRect() : { left: 0, right: vw }
  const limit = Math.min(vw, Math.round(pr.left) + (page ? page.clientWidth : vw))
  const insideOwnScroller = (el) => {
    for (let p = el.parentElement; p && p !== page && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true
    }
    return false
  }
  const out = []
  for (const el of (page || document.body).querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right <= limit + 1) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue
    if (insideOwnScroller(el)) continue
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 90),
      testid: el.getAttribute('data-testid'), tour: el.getAttribute('data-tour'),
      text: (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 50),
      left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
      depth: (() => { let d = 0; for (let p = el; p; p = p.parentElement) d++; return d })(),
    })
  }
  // widest first; among equals the OUTERMOST, which is the container to fix
  out.sort((a, b) => b.right - a.right || a.depth - b.depth)
  const pageScroll = page ? { tag: page.tagName.toLowerCase(), cls: (typeof page.className === 'string' ? page.className : '').slice(0, 60),
                              scrollWidth: page.scrollWidth, clientWidth: page.clientWidth } : null
  const overflowPx = Math.max(de.scrollWidth - vw, pageScroll ? pageScroll.scrollWidth - pageScroll.clientWidth : 0)
  return { url: location.pathname + location.search, innerWidth, clientWidth: vw, scrollWidth: de.scrollWidth,
           documentOverflowPx: de.scrollWidth - vw, pageScroll, overflowPx,
           offenders: out.slice(0, 8), offenderCount: out.length }
}"""

EDIT_JS = """() => {
  const wrap = document.querySelector('[data-testid="why-prompt-saved"]')
  if (!wrap) return null
  const btn = Array.from(wrap.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Edit')
  if (!btn) return { found: false }
  const r = btn.getBoundingClientRect()
  return { found: true, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 }
}"""


def _today_et() -> str:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _seed(req, base: str, raw: dict, phase: str) -> dict:
    """An open position (the position page and its entry context card) and a closed trade
    (the trade page and the closed-trades toolbar). Idempotent across the two boots."""
    out = {"tradeId": None, "positionSymbol": "NVDA"}
    today = _today_et()
    positions = req.get(base + "/api/j2/positions").json()
    positions = positions.get("positions") if isinstance(positions, dict) else positions
    trades = req.get(base + "/api/j2/trades").json()
    trades = trades.get("trades") if isinstance(trades, dict) else trades
    log = raw.setdefault(f"{phase}_seed", {})
    if not any((p or {}).get("symbol") == "NVDA" for p in (positions or [])):
        r = req.post(base + "/api/j2/positions", data={
            "symbol": "NVDA", "side": "Long", "shares": 10, "entryPrice": 100, "stopPrice": 95,
            "entryDate": today})
        log["open_position"] = r.status
    if not trades:
        r = req.post(base + "/api/j2/positions", data={
            "symbol": "AMD", "side": "Long", "shares": 10, "entryPrice": 100, "stopPrice": 95,
            "entryDate": today})
        log["position_to_close"] = r.status
        if r.status in (200, 201):
            pid = r.json().get("id")
            c = req.post(base + f"/api/j2/positions/{pid}/close", data={
                "exitPrice": 110, "exitDate": today, "shares": 10})
            log["close"] = c.status
            if c.status not in (200, 201):
                log["close_body"] = c.text()[:300]
        trades = req.get(base + "/api/j2/trades").json()
        trades = trades.get("trades") if isinstance(trades, dict) else trades
    if trades:
        out["tradeId"] = trades[0].get("id")
    if phase == "on":
        # The context is frozen when a position is ADDED while the switch is on, so the card
        # needs a position opened in this boot (NVDA was opened with it off).
        sym = "MSFT"
        if not any((p or {}).get("symbol") == sym for p in (positions or [])):
            r = req.post(base + "/api/j2/positions", data={
                "symbol": sym, "side": "Long", "shares": 10, "entryPrice": 100, "stopPrice": 95,
                "entryDate": today})
            log["context_position"] = r.status
        out["positionSymbol"] = sym
        for _ in range(10):  # the capture runs after the create response
            time.sleep(1.5)
            w = req.put(base + "/api/j2/entry-context/why", data={
                "symbol": sym, "entryDay": today, "text": "Tight flag at the 21EMA, volume dried up."})
            if w.status in (200, 201):
                break
        log["why"] = w.status
        if w.status not in (200, 201):
            log["why_body"] = w.text()[:300]
    log["tradeId"] = out["tradeId"]
    return out


def _screens(seed: dict) -> list[tuple[str, str]]:
    s = [("research workspace", "/journal/notebook/research/NVDA"),
         ("closed trades", "/journal/trades?seg=closed"),
         ("help", "/support"),
         ("position page (entry context)", f"/journal-2-0/position/{seed['positionSymbol']}")]
    if seed.get("tradeId"):
        s.insert(2, ("trade page", f"/journal-2-0/trade/{seed['tradeId']}"))
    return s


def run_phase(phase: str, base: str, out: Path, raw: dict, rows: list) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        try:
            admin_ctx = br.new_context()
            setup_ctx = br.new_context()
            h._provision(admin_ctx.request, setup_ctx.request, base, member=MEMBER)
            state = setup_ctx.storage_state()
            me = setup_ctx.request.get(base + "/api/auth/me").json()
            raw[f"{phase}_auth_me"] = {k: me.get(k) for k in (
                "notebook_transcript_capture_enabled", "notebook_entry_context_enabled", "paid_equiv", "role")}
            seed = _seed(setup_ctx.request, base, raw, phase)
            for width, viewport in WIDTHS.items():
                ctx = br.new_context(viewport=viewport, reduced_motion="reduce", storage_state=state,
                                     has_touch=width != 1280)
                try:
                    for name, path in _screens(seed):
                        pg = ctx.new_page()
                        try:
                            pg.goto(base + path, wait_until="domcontentloaded", timeout=60000)
                            h._dismiss_intro(pg)
                            try:
                                pg.wait_for_load_state("networkidle", timeout=15000)
                            except Exception:  # noqa: BLE001 -- a polling page never idles
                                pass
                            pg.wait_for_timeout(2500)
                            m = pg.evaluate(MEASURE_JS)
                            row = {"phase": phase, "width": width, "screen": name, **m}
                            if "entry context" in name:
                                row["editControl"] = pg.evaluate(EDIT_JS)
                            shot = f"{phase}-{width}-{name.split(' (')[0].replace(' ', '-')}.png"
                            if width == 390:   # the phone is the evidence; 30 full shots a run is noise
                                pg.screenshot(path=str(out / shot))
                                row["screenshot"] = shot
                            rows.append(row)
                            ps = m.get("pageScroll") or {}
                            print(f"  {phase} {width:>4} {name:<32} page {ps.get('scrollWidth')} / {ps.get('clientWidth')}"
                                  f"  (document {m['scrollWidth']} / {m['clientWidth']})  over {m['overflowPx']}"
                                  + (f"  edit {row['editControl']}" if row.get("editControl") else ""), flush=True)
                        finally:
                            pg.close()
                finally:
                    ctx.close()
        finally:
            br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sha", default="")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port != PORT:
        print(f"REFUSED: this lane's walk uses port {PORT} only")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this walk never kills it")
        return 3
    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{args.port}"
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)

    raw, rows, boots, failure, not_run = {}, [], {}, None, None
    for phase in ("off", "on"):
        for k in ENV_ON:
            if phase == "on":
                os.environ[k] = "1"
            else:
                os.environ.pop(k, None)
        print(f"== boot {phase.upper()} ==", flush=True)
        if h.port_busy(args.port):
            failure = f"port {args.port} still had a listener before boot {phase}"
            break
        box = h.Sandbox(str(data_dir), args.port, out / f"sandbox-{phase}.log")
        box.start()
        try:
            if not box.wait_healthy(base, 300):
                failure = f"boot {phase}: the sandbox never answered /api/health"
            else:
                try:
                    run_phase(phase, base, out, raw, rows)
                except h.SetupFailed as e:
                    not_run = f"boot {phase}: {str(e)[:300]}"
                except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
                    import traceback
                    failure = f"boot {phase}: the walk raised {type(e).__name__}: {str(e)[:400]}"
                    raw[f"{phase}_traceback"] = traceback.format_exc()[-3000:]
                box.wait_checkpoint(h.POST_BOOT, 60)
        finally:
            box.stop()
        integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
        h._keep_integrity_log(integ, out / f"integrity-{phase}.md", own=True)
        print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run), flush=True)
        released = False
        for _ in range(40):
            if not h.port_busy(args.port):
                released = True
                break
            time.sleep(0.5)
        boots[phase] = {"integrity": integ, "stop": box.stop_how, "port_released": released}
        if failure or not_run:
            break
    for k in ENV_ON:
        os.environ.pop(k, None)

    summary = [{"phase": r["phase"], "width": r["width"], "screen": r["screen"],
                "documentScrollWidth": r["scrollWidth"], "documentClientWidth": r["clientWidth"],
                "pageScrollWidth": (r.get("pageScroll") or {}).get("scrollWidth"),
                "pageClientWidth": (r.get("pageScroll") or {}).get("clientWidth"),
                "overflowPx": r["overflowPx"],
                "widest": (r["offenders"][0] if r["offenders"] else None),
                "editControl": r.get("editControl")} for r in rows]
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    result = {"tool": "tools/notebook_fin_a11y_overflow_walk.py", "sha": args.sha, "base": base,
              "data_dir": str(data_dir), "boots": boots, "failure": failure, "not_run": not_run,
              "driver_imported_api": api_mods, "summary": summary, "rows": rows, "raw": raw}
    (out / "walk.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    over = [s for s in summary if s["overflowPx"] > 1]
    print(f"== {len(rows)} measurements, {len(over)} wider than the window; failure={failure!r} not_run={not_run!r}")
    if failure or not_run:
        return 3
    return 0 if all(b["integrity"].get("clean") is True and b["port_released"] for b in boots.values()) else 2


if __name__ == "__main__":
    sys.exit(main())
