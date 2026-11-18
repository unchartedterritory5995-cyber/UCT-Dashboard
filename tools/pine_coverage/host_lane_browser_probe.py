"""Measure a member's /charts load with one Pine script attached, on the REAL page.

docs/pine/evidence/2026-11-17-host-lane-cost/EVIDENCE.md. The question it answers: where does
the script's compute run (main thread or worker), how long does the main thread stop for, how
long until the script's values are on screen, and what each live poll costs.

WHAT IS REAL: the production bundle (`npm run build`, served by a local sandboxed backend), the
`/charts` page, the member door (Chart settings -> Indicators -> New Formula -> Import -> paste ->
"Add this script to my chart", the same clicks `tools/pine_member_pane_capture.py` makes), the
saved definition and its instance, StockChart, the binder and both lanes.

WHAT IS ANSWERED HERE, AT THE NETWORK: the bars. Every `/api/bars/{sym}?tf=D` and
`/api/bars-history/{sym}?tf=D` request is answered from the committed AAPL daily capture
(`tests/fixtures/vendor/harness/vw-deadband-ticks-aapl-1d-2026-09-28.json`, 11,534 bars from
AAPL's listing day, 1980-12-12) in the server's own payload shapes, and `/api/ticker-ipo/{sym}`
with that listing day, so the chart states `historyFromListing` exactly as it does for AAPL in
production. Each `tf=D` poll after the first moves the newest bar's close by one cent, so a poll
produces a new bars array the way a session's poll does. Nothing reaches a market-data vendor for
these, and no production data is read.

THE PROBE (an init script, so it is in place before the app's first line runs):
  - `longtask` entries (PerformanceObserver, buffered): every main-thread task over 50 ms;
  - a requestAnimationFrame heartbeat: every gap between frames over 50 ms;
  - the legend chips (`[data-instance-id]`) read every 250 ms on the main thread, so the time a
    chip first shows a digit is when the main thread was free to show it;
  - a V8 CPU profile of the page's main thread (CDP Profiler), mapped to source files by
    `profile_by_source.mjs` with the build's hidden sourcemaps (`dist/.maps`).

    python tools/pine_coverage/host_lane_browser_probe.py --base http://127.0.0.1:8141 \
        --script corpus/committed/<slug>.pine --label <name> --out <dir> [--no-script] [--poll]

Exit 0 measured, 1 the door refused or nothing drew, 2 inconclusive (rig not reachable).
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import pathlib
import sys
import time
import urllib.parse

REPO = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = REPO / "tests" / "fixtures" / "vendor" / "harness" / "vw-deadband-ticks-aapl-1d-2026-09-28.json"
sys.path.insert(0, str(REPO / "tools"))
from pine_member_pane_capture import ATTACH_JS  # noqa: E402  (the same attach click)

LISTING_DAY = "1980-12-12"

PROBE_JS = r"""
(() => {
  const P = window.__probe = { lt: [], loaf: [], gaps: [], chips: [], firstDigit: null, firstDigitText: null,
    title: null, beats: 0,
    // can a worker be told to stop mid-job? only through a SharedArrayBuffer, which needs isolation
    isolation: { crossOriginIsolated: self.crossOriginIsolated === true, sharedArrayBuffer: typeof SharedArrayBuffer } };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lt.push([e.startTime, e.duration]) })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) { P.ltError = String(e) }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.loaf.push([e.startTime, e.duration, e.blockingDuration || 0]) })
      .observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) { P.loafError = String(e) }
  let last = performance.now();
  const beat = (t) => { P.beats += 1; const g = t - last; if (g > 50) P.gaps.push([last, g]); last = t; requestAnimationFrame(beat) };
  requestAnimationFrame(beat);
  setInterval(() => {
    // the legend shows a script's values only under the crosshair: hover near the newest bars
    try {
      const cv = document.querySelector('canvas');          // the chart's main pane
      if (cv) {
        const r = cv.getBoundingClientRect();
        const x = Math.round(r.x + r.width * 0.85), y = Math.round(r.y + r.height * 0.5);
        P.hover = [x, y];
        const el = document.elementFromPoint(x, y);
        if (el) el.dispatchEvent(new MouseEvent('mousemove', { clientX: x + (P.beats % 2), clientY: y, bubbles: true }));
      }
    } catch (e) { P.hoverError = String(e) }
    const chips = [...document.querySelectorAll('[data-instance-id]')];
    const want = P.title;
    for (const c of chips) {
      // the chip grid: the label cell carries the id, the row carries the values
      const txt = ((c.parentElement || c).textContent || '').trim();
      if (!want || !txt.includes(want)) continue;
      const rest = txt.slice(txt.indexOf(want) + want.length);
      if (/\d/.test(rest)) {
        if (P.firstDigit === null) { P.firstDigit = performance.now(); P.firstDigitText = txt.slice(0, 160) }
        if (!P.chips.length || P.chips[P.chips.length - 1][1] !== txt) P.chips.push([performance.now(), txt.slice(0, 160)]);
      }
    }
  }, 250);
})();
"""

PASTE_TEXT_JS = """async (src) => {
  const ta = document.querySelector('[data-testid="pine-box"] textarea');
  if (!ta) return { ok: false };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, src);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ta.value));
  return { ok: true, len: ta.value.length,
    sha: [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('') };
}"""

DEFS_JS = """async () => {
  const r = await fetch('/api/user-definitions', { credentials: 'same-origin' }).then(r => r.json()).catch(e => ({ err: String(e) }));
  return (r.definitions || []).map((d) => {
    const def = d.definition || d;
    return { id: d.id || def.id, name: def.name || null, kind: def.compute ? def.compute.kind : null,
      plots: Array.isArray(def.plots) ? def.plots.length : 0 };
  });
}"""

ME_JS = """async () => fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).catch(e => ({ err: String(e) }))"""

#: ⭐ HOST WORKER (docs/pine/evidence/2026-11-17-host-lane-worker/EVIDENCE.md) — every job the host
#: lane's worker answered: `[posted at, post -> landed ms, {kind, workerMs, ok, bars}]` (the user-timing
#: measure `hostLaneAsync.js` records on each landing). Empty on a build without the worker.
HOST_RUNS_JS = """() => performance.getEntriesByName('host-lane:worker-run').map(e => [Math.round(e.startTime), Math.round(e.duration), e.detail || null])"""

#: The member door as it is today (UCT Signature R2, 2026-11-16): Chart settings -> Indicators ->
#: "Create indicator" -> "Paste a script". (`pine_member_pane_capture.py`'s OPEN_DOOR_JS still looks
#: for the retired "New Formula" button.)
OPEN_DOOR_NOW_JS = """async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const by = (re) => [...document.querySelectorAll('button,[role="tab"]')]
    .find(b => re.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
  const waitFor = async (sel, n = 40) => { for (let i = 0; i < n; i++) { const e = document.querySelector(sel); if (e) return e; await sleep(250) } return null };
  const gear = by(/^Chart settings$/); if (!gear) return { gear: false };
  gear.click(); await sleep(900);
  const ind = by(/^Indicators$/); if (ind) ind.click(); await sleep(900);
  const enter = await waitFor('[data-testid="add-enter"]', 20);   // "Add indicator" opens the add surface
  if (enter) { enter.click(); await sleep(700) }
  const create = await waitFor('[data-testid="settings-create-indicator"]');
  if (!create) return { gear: true, indicators: !!ind, create: false };
  create.click();
  const start = await waitFor('[data-testid="start-pine"]');
  if (!start) return { gear: true, indicators: !!ind, create: true, startPine: false };
  start.click();
  const ta = await waitFor('[data-testid="pine-box"] textarea');
  return { gear: true, indicators: !!ind, create: true, startPine: true, importTab: !!ta };
}"""

#: A fresh account's workspace is EMPTY ("This workspace is empty"): the chart is added the way a member
#: adds one, Add widget -> Chart, and the layout persists server-side for every later load.
ENSURE_CHART_JS = """async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const has = () => document.querySelectorAll('[data-widget-id]').length;
  if (has()) return { added: false, widgets: has() };
  const add = [...document.querySelectorAll('button')].find(b => /Add widget/.test(b.textContent || ''));
  if (!add) return { added: false, widgets: 0, why: 'no Add widget button' };
  add.click();
  await sleep(1200);
  const items = [...document.querySelectorAll('button,[role="menuitem"],[role="option"],li')];
  const chart = items.find(el => /Candles, drawings/.test(el.textContent || ''))
    || items.find(el => (el.textContent || '').trim() === 'Chart');
  if (!chart) return { added: false, widgets: 0, why: 'no Chart item', seen: items.slice(0, 30).map(e => (e.textContent || '').trim().slice(0, 40)) };
  chart.click();
  for (let i = 0; i < 40 && !has(); i++) await sleep(250);
  await sleep(1500);   // the layout save is debounced (500 ms)
  return { added: true, widgets: has() };
}"""


def _iso(t: int) -> str:
    return datetime.datetime.fromtimestamp(int(t), datetime.timezone.utc).strftime("%Y-%m-%d")


def load_bars():
    cap = json.loads(FIXTURE.read_text(encoding="utf-8"))
    rows = cap["bars"]["rows"]
    bars = [{"t": _iso(t), "o": o, "h": h, "l": l, "c": c, "v": v} for t, o, h, l, c, v in rows]
    assert bars[0]["t"] == LISTING_DAY, bars[0]
    return bars


class BarsServer:
    """Answers the chart's bars requests from the capture, in the server's payload shapes."""

    def __init__(self, bars):
        self.bars = bars
        self.log = []          # (perf-clock seconds, kind, detail)
        self.tail_polls = 0

    def _tail(self):
        # every tf=D tail request after the first moves the newest close by one cent
        last = dict(self.bars[-1])
        bump = 0.01 * self.tail_polls
        last["c"] = round(last["c"] + bump, 4)
        last["h"] = max(last["h"], last["c"])
        return self.bars[:-1] + [last]

    def handle(self, route, request):
        url = urllib.parse.urlparse(request.url)
        q = urllib.parse.parse_qs(url.query)
        tf = (q.get("tf") or ["D"])[0].upper()
        path = url.path
        sym = urllib.parse.unquote(path.rsplit("/", 1)[-1]).upper()
        if path.startswith("/api/ticker-ipo/"):
            self.log.append((time.time(), "ipo", sym))
            return route.fulfill(json={"symbol": sym, "list_date": LISTING_DAY, "first_trade_date": LISTING_DAY,
                                       "first_trade_final": True})
        if tf != "D":
            self.log.append((time.time(), "other-tf", f"{sym} {tf}"))
            return route.fulfill(json={"ticker": sym, "tf": tf, "bars": [], "no_data": True, "reason": "rig: daily only"})
        if path.startswith("/api/bars-history/"):
            n = int((q.get("bars") or ["12500"])[0])
            out = self.bars[:-1][-n:]   # the sealed set: everything before the newest (forming) period
            self.log.append((time.time(), "history", f"{sym} {len(out)}"))
            return route.fulfill(json={"ticker": sym, "tf": "D", "bars": out, "sealed": True})
        n = int((q.get("bars") or ["200"])[0])
        since = (q.get("since") or [""])[0]
        series = self._tail()
        self.tail_polls += 1
        if since:
            # the server's `since` is strict `>`; the newest bar is always re-sent, as a forming bar is
            keep = [b for b in series if b["t"] > since[:10]] if not since.isdigit() else series[-1:]
            if not keep or keep[-1]["t"] != series[-1]["t"]:
                keep = keep + series[-1:]
            self.log.append((time.time(), "delta", f"{sym} since={since} -> {len(keep)} (poll {self.tail_polls})"))
            return route.fulfill(json={"ticker": sym, "tf": "D", "bars": keep, "delta": True})
        out = series[-n:]
        self.log.append((time.time(), "tail", f"{sym} {len(out)} (poll {self.tail_polls})"))
        return route.fulfill(json={"ticker": sym, "tf": "D", "bars": out, "newest_bar_is_forming": False,
                                   "tail_status": "verified", "verified_through": out[-1]["t"]})


def route_bars(ctx, server):
    def is_bars(url: str) -> bool:
        p = urllib.parse.urlparse(url).path
        if "/adjustment-basis" in p:
            return False
        return p.startswith("/api/bars/") or p.startswith("/api/bars-history/") or p.startswith("/api/ticker-ipo/")
    ctx.route(lambda url: is_bars(url), server.handle)


def sign_in(page, base, email, password):
    r = page.request.post(f"{base}/api/auth/login", data={"email": email, "password": password})
    if r.ok:
        return True
    r = page.request.post(f"{base}/api/auth/signup", data={"email": email, "password": password, "display_name": "lanecost"})
    if not r.ok:
        return False
    r = page.request.post(f"{base}/api/auth/login", data={"email": email, "password": password})
    return r.ok


def _def_id(d):
    return d.get("id") or (d.get("definition") or {}).get("id")


def account_state(page, base):
    """What a synthetic account holds that the probe may touch: its saved scripts (ids) and its
    preferences (key -> stored string), with the workspace document's stamp. Held in memory only."""
    r = page.request.get(f"{base}/api/auth/preferences")
    prefs = r.json() if r.ok else None
    defs = page.request.get(f"{base}/api/user-definitions").json().get("definitions", [])
    return {"prefs": prefs if isinstance(prefs, dict) else {}, "prefsOk": r.ok,
            "stamp": r.headers.get("x-workspace-doc"), "defs": sorted(str(_def_id(d)) for d in defs if _def_id(d))}


def _doc_version(stamp):
    """`document; v=12` -> 12 (the base a revision-aware write names), else None."""
    import re  # noqa: PLC0415
    m = re.search(r"\bv=(\d+)", stamp or "")
    return int(m.group(1)) if m else None


def restore_account(page, base, before):
    """⛔ LEAVE THE ACCOUNT AS IT WAS FOUND: delete every script this run saved, write back every
    preference it changed (the product's own write, `POST /api/auth/preferences`, naming the document's
    version as the app does), and read it all again. Returns what was done (key names only)."""
    out = {"created": [], "deleted": [], "prefsChanged": [], "restored": [], "added": [], "errors": []}
    try:
        now = account_state(page, base)
        out["created"] = [i for i in now["defs"] if i not in before["defs"]]
        for i in out["created"]:
            r = page.request.delete(f"{base}/api/user-definitions/{i}")
            (out["deleted"] if r.ok else out["errors"]).append(i if r.ok else f"delete {i}: HTTP {r.status}")
        now = account_state(page, base)
        keys = sorted(set(before["prefs"]) | set(now["prefs"]))
        out["prefsChanged"] = [k for k in keys if before["prefs"].get(k) != now["prefs"].get(k)]
        for k in out["prefsChanged"]:
            if k not in before["prefs"]:
                out["added"].append(k)   # no door removes a key; said, never guessed at
                continue
            for _attempt in range(3):
                cur = account_state(page, base)
                body = {"key": k, "value": before["prefs"][k]}
                v = _doc_version(cur["stamp"])
                if v is not None:
                    body["base_version"] = v
                r = page.request.post(f"{base}/api/auth/preferences", data=json.dumps(body),
                                      headers={"Content-Type": "application/json"})
                if r.ok:
                    out["restored"].append(k)
                    break
                if r.status != 409:
                    out["errors"].append(f"restore {k}: HTTP {r.status}")
                    break
        final = account_state(page, base)
        out["defsAsFound"] = final["defs"] == before["defs"]
        out["prefsAsFound"] = all(final["prefs"].get(k) == before["prefs"].get(k) for k in before["prefs"]) \
            and not [k for k in final["prefs"] if k not in before["prefs"]]
        out["ok"] = out["defsAsFound"] and out["prefsAsFound"] and not out["errors"]
    except Exception as exc:  # noqa: BLE001 -- reported, never swallowed
        out["errors"].append(f"{type(exc).__name__}: {str(exc)[:200]}")
        out["ok"] = False
    return out


#: ⭐ the workspace is ready: a widget on it, or its "Add widget" door. A cold sandbox can take 40 s
#: to draw it (measured 2026-11-17: no door at 20 s, the door at 40 s), and a fixed wait read that as
#: "no chart widget".
WORKSPACE_READY_JS = """() => document.querySelectorAll('[data-widget-id]').length > 0
  || [...document.querySelectorAll('button')].some(b => /Add widget/.test(b.textContent || ''))"""


def wait_for_workspace(page):
    try:
        page.wait_for_function(WORKSPACE_READY_JS, timeout=120000)
    except Exception:
        pass
    page.wait_for_timeout(2000)


def install(page, base, source, settle_s=0, expect_runtime=False):
    """The member door, through its UI. Returns what was saved."""
    page.goto(f"{base}/charts", wait_until="domcontentloaded")
    wait_for_workspace(page)
    chart = page.evaluate(ENSURE_CHART_JS)
    print(f"[probe] chart widget: {chart}", flush=True)
    if not chart.get("widgets"):
        return {"ok": False, "why": "no chart widget on the workspace", "chart": chart}
    page.wait_for_timeout(5000)
    opened = page.evaluate(OPEN_DOOR_NOW_JS)
    if not opened.get("importTab"):
        return {"ok": False, "why": "could not reach the Import tab", "opened": opened}
    page.wait_for_timeout(1500)
    pasted = page.evaluate(PASTE_TEXT_JS, source)
    want = hashlib.sha256(source.encode("utf-8")).hexdigest()
    if pasted.get("sha") != want:
        return {"ok": False, "why": f"textarea sha {pasted.get('sha')} != file sha {want}"}
    try:
        page.wait_for_function("""() => { const b = document.querySelector('[data-testid="pine-member-pane-attach"]');
          return !!(b && b.querySelector('button')) }""", timeout=60000)
    except Exception:
        box = page.evaluate("""() => { const b = document.querySelector('[data-testid="pine-box"]'); return b ? b.textContent.slice(0, 600) : null }""")
        return {"ok": False, "why": "the attach door never appeared", "box": box}
    if settle_s:
        # a runtime-on viewer's preview rebuilds when the server's capability verdict lands (debounced)
        page.wait_for_timeout(int(settle_s * 1000))
    if expect_runtime:
        # ⭐ the preview rebuilds on the runtime lane once the capability verdict lands; attach THAT one
        for _ in range(120):
            txt = page.evaluate("() => { const b = document.querySelector('[data-testid=\"pine-member-pane-attach\"]'); "
                                "const pane = b ? b.closest('section,div') : null; return pane ? (pane.parentElement || pane).textContent : '' }")
            if 'drawn by running it bar by bar' in (txt or ''):
                print("[probe] preview is on the runtime lane", flush=True)
                break
            page.wait_for_timeout(1000)
        else:
            print("[probe] preview never reached the runtime lane in 120 s", flush=True)
    attached = page.evaluate(ATTACH_JS)
    # ⛔ the attach tool reads the store 5 s after the click; a heavy script's preview computes on the
    # main thread first, so the save can land later: wait for the stored definition itself
    defs = page.evaluate(DEFS_JS)
    for _ in range(60):
        if defs:
            break
        page.wait_for_timeout(1000)
        defs = page.evaluate(DEFS_JS)
    attached["defs"] = defs
    attached["ok"] = bool(defs)
    attached["sha256"] = want
    return attached


def deep_values_landed(runs, deep_bars=1000):
    """The landing time (ms on the page clock) of the first host-worker VALUES job over the deep
    history, or None. `runs` is HOST_RUNS_JS's answer: [posted at, post -> landed ms, detail]."""
    ends = [r[0] + r[1] for r in runs or []
            if isinstance(r[2], dict) and r[2].get("kind") == "values" and (r[2].get("bars") or 0) >= deep_bars]
    return min(ends) if ends else None


def measure_load(browser, base, storage, out_dir, label, title, server, poll, trace, wait_final=False):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce",
                              storage_state=storage)
    route_bars(ctx, server)
    ctx.add_init_script(PROBE_JS + (f"\nwindow.__probe.title = {json.dumps(title)};" if title else ""))
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    cdp.send("Profiler.enable")
    cdp.send("Profiler.setSamplingInterval", {"interval": 1000})
    cdp.send("Profiler.start")
    if trace:
        browser.start_tracing(page=page, path=str(out_dir / f"{label}.trace.json"), screenshots=False,
                              categories=["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute",
                                          "blink.user_timing", "loading"])
    server.log.clear()
    server.tail_polls = 0
    t_nav = time.time()
    page.goto(f"{base}/charts", wait_until="domcontentloaded")
    # settle: the script's values on screen (or no script) and five quiet seconds with no long task
    deadline = time.time() + 900
    last_lt = None
    tick = 0
    while time.time() < deadline:
        page.wait_for_timeout(1000)
        tick += 1
        try:
            hv = page.evaluate("() => window.__probe.hover || null")
            if hv:
                page.mouse.move(hv[0] + (tick % 2), hv[1])   # a real hover, near the newest bars
        except Exception:
            pass
        p = page.evaluate("() => ({ lt: window.__probe.lt.length, d: window.__probe.firstDigit, now: performance.now(),"
                          " lastLt: window.__probe.lt.length ? window.__probe.lt[window.__probe.lt.length-1] : null })")
        drawn = (p["d"] is not None) or not title
        quiet_for = (p["now"] - (p["lastLt"][0] + p["lastLt"][1])) if p["lastLt"] else p["now"]
        hist_in = any(k == "history" for _, k, _d in server.log)
        # ⭐ --wait-final: the deep history's VALUES must have landed (the final values), not just the
        # first paint's; a build or script with no worker values job settles as before after 240 s
        final_in = (not wait_final) or deep_values_landed(page.evaluate(HOST_RUNS_JS)) is not None \
            or p["now"] > 240000
        if int(p["now"] / 1000) % 15 == 0:
            print(f"[probe] {label} t={p['now'] / 1000:.0f}s longTasks={p['lt']} drawn={drawn} history={hist_in} "
                  f"final={final_in} requests={[k for _, k, _d in server.log]}", flush=True)
        if drawn and hist_in and final_in and quiet_for > 5000 and p["now"] > 15000:
            break
        if drawn and quiet_for > 5000 and p["now"] > 120000:
            print(f"[probe] {label}: settled without a deep-history request", flush=True)
            break
        last_lt = p
    load = page.evaluate("() => JSON.parse(JSON.stringify(window.__probe))")
    load["hostLaneRuns"] = page.evaluate(HOST_RUNS_JS)
    load["navToSettleS"] = round(time.time() - t_nav, 1)
    load["requests"] = [(round(t - t_nav, 2), k, d) for t, k, d in server.log]
    load["permission"] = page.evaluate("() => fetch('/api/auth/me').then(r => r.json()).then(j => j.pine_runtime_pane_enabled).catch(() => null)")
    prof = cdp.send("Profiler.stop")["profile"]
    (out_dir / f"{label}.load.cpuprofile").write_text(json.dumps(prof), encoding="utf-8")
    result = {"label": label, "load": load}
    if poll:
        cdp.send("Profiler.start")
        before = len(load["lt"])
        polls0 = server.tail_polls
        t_wait = time.time()
        while time.time() - t_wait < 360 and server.tail_polls <= polls0:
            page.wait_for_timeout(2000)
        t_poll = time.time()
        page.wait_for_timeout(30000)
        after = page.evaluate("() => JSON.parse(JSON.stringify(window.__probe))")
        host_runs_after = page.evaluate(HOST_RUNS_JS)
        prof2 = cdp.send("Profiler.stop")["profile"]
        (out_dir / f"{label}.poll.cpuprofile").write_text(json.dumps(prof2), encoding="utf-8")
        poll_perf = after["lt"][before:]
        result["poll"] = {"waitedS": round(t_poll - t_wait, 1), "polled": server.tail_polls > polls0,
                          "hostLaneRuns": host_runs_after[len(load["hostLaneRuns"]):],
                          "longTasks": poll_perf, "gaps": [g for g in after["gaps"] if g not in load["gaps"]],
                          "chips": after["chips"][-3:],
                          "requests": [(round(t - t_nav, 2), k, d) for t, k, d in server.log]}
    if trace:
        browser.stop_tracing()
    page.screenshot(path=str(out_dir / f"{label}.png"))
    ctx.close()
    return result


def summarise(res):
    lt = res["load"]["lt"]
    s = {"longTasks": len(lt), "longTaskMs": round(sum(d for _, d in lt)), "maxLongTaskMs": round(max([d for _, d in lt] or [0])),
         "maxFrameGapMs": round(max([g for _, g in res["load"]["gaps"]] or [0])),
         "firstDigitMs": round(res["load"]["firstDigit"]) if res["load"]["firstDigit"] is not None else None}
    s["hostLaneRuns"] = len(res["load"].get("hostLaneRuns") or [])
    final = deep_values_landed(res["load"].get("hostLaneRuns"))
    s["finalValuesMs"] = round(final) if final is not None else None
    s["isolation"] = res["load"].get("isolation")
    if "poll" in res:
        plt = res["poll"]["longTasks"]
        s["poll"] = {"polled": res["poll"]["polled"], "longTasks": len(plt), "longTaskMs": round(sum(d for _, d in plt)),
                     "maxLongTaskMs": round(max([d for _, d in plt] or [0])),
                     "maxFrameGapMs": round(max([g for _, g in res["poll"]["gaps"]] or [0]))}
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--script", help="a .pine file to attach (omit with --no-script for the control)")
    ap.add_argument("--no-script", action="store_true", help="the control: the same chart, no member script")
    ap.add_argument("--title", help="the script's legend title (default: its indicator() title)")
    ap.add_argument("--label", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--email", default="lanecost@local.dev")
    ap.add_argument("--password", default="LaneCost2026!")
    ap.add_argument("--poll", action="store_true", help="also measure the next real tf=D poll (up to 6 minutes)")
    ap.add_argument("--trace", action="store_true", help="also record a Chromium performance trace")
    ap.add_argument("--synthetic", choices=["smoke", "loopback-test"],
                    help="PRODUCTION: sign in as this synthetic account through tools/synthetic_session.py (signed "
                         "out at the end); no sign-up, no other script deleted, the account restored as found. "
                         "`loopback-test` runs the same path on a local sandbox with --email/--password")
    ap.add_argument("--wait-final", action="store_true",
                    help="settle only once the deep history's values job has landed (the final values)")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--expect-runtime", action="store_true",
                    help="attach only once the preview says it is drawn bar by bar (the cost route moved it)")
    ap.add_argument("--settle-before-attach", type=float, default=0,
                    help="seconds to wait on the preview before attaching (a runtime-on capability verdict lands async)")
    args = ap.parse_args()

    import synthetic_session  # noqa: PLC0415 (tools/ is on sys.path)
    if not args.synthetic and not synthetic_session.is_loopback(args.base):
        # ⛔ the plain sign-in (and its sign-up and its clean slate) is for a LOCAL sandbox account only;
        # anything else signs in as a synthetic account, through the helper that always signs out
        print(f"[probe] REFUSED: {args.base} is not a local sandbox; use --synthetic smoke")
        return 2
    from playwright.sync_api import sync_playwright
    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    bars = load_bars()
    source = None
    title = None
    if not args.no_script:
        source = (REPO / args.script).read_text(encoding="utf-8") if not pathlib.Path(args.script).is_absolute() \
            else pathlib.Path(args.script).read_text(encoding="utf-8")
        import re
        m = re.search(r"""(?:indicator|study|strategy)\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']""", source)
        title = args.title or (m.group(1).strip() if m else None)   # a title with a trailing space never matched its chip

    account_record = None
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        # ── sign in, clear any earlier member scripts, attach this one ──
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
        server = BarsServer(bars)
        route_bars(ctx, server)
        page = ctx.new_page()
        session = None
        before = None
        if args.synthetic:
            # ⛔ PRODUCTION: the synthetic account only, through the ONE sign-in that always signs out
            # (`tools/synthetic_session.py`); never a sign-up, never another account's scripts deleted
            if args.synthetic == "loopback-test":
                # the same path on a LOCAL sandbox (`synthetic_session` refuses explicit credentials
                # anywhere else): the account is made if it is not there, then signed in the synthetic way
                if not synthetic_session.is_loopback(args.base):
                    print("[probe] INCONCLUSIVE: loopback-test is for a local sandbox only")
                    return 2
                warm = browser.new_context()
                ok = sign_in(warm.new_page(), args.base, args.email, args.password)
                warm.close()
                if not ok:
                    print(f"[probe] INCONCLUSIVE: sign-in failed at {args.base}")
                    return 2
                session = synthetic_session.sign_in_playwright(ctx, args.base, credentials=(args.email, args.password))
            else:
                session = synthetic_session.sign_in_playwright(ctx, args.base, args.synthetic)
            if not session.ok:
                print(f"[probe] INCONCLUSIVE: the {args.synthetic} sign-in answered HTTP {session.status}")
                return 2
        elif not sign_in(page, args.base, args.email, args.password):
            print(f"[probe] INCONCLUSIVE: sign-in failed at {args.base}")
            return 2
        try:
            me = json.loads(page.request.get(f"{args.base}/api/auth/me").text())
            me = me if isinstance(me, dict) else {}
            if args.synthetic:
                # what the account holds BEFORE: restored to exactly this at the end (values never written out)
                before = account_state(page, args.base)
                print(f"[probe] account before: {len(before['defs'])} saved scripts, {len(before['prefs'])} preference keys",
                      flush=True)
            else:
                defs = page.request.get(f"{args.base}/api/user-definitions").json().get("definitions", [])
                for d in defs:
                    did = d.get("id") or (d.get("definition") or {}).get("id")
                    if did:
                        page.request.delete(f"{args.base}/api/user-definitions/{did}")
            installed = None
            if source is not None:
                installed = install(page, args.base, source, args.settle_before_attach, args.expect_runtime)
                if not installed.get("ok"):
                    print(f"[probe] MEASURED FAILURE: {json.dumps(installed)[:800]}")
                    (out_dir / f"{args.label}.install.json").write_text(json.dumps(installed, indent=1), encoding="utf-8")
                    return 1
            else:
                page.goto(f"{args.base}/charts", wait_until="domcontentloaded")
                wait_for_workspace(page)
                chart = page.evaluate(ENSURE_CHART_JS)
                print(f"[probe] chart widget: {chart}", flush=True)
                if not chart.get("widgets"):
                    print(f"[probe] INCONCLUSIVE: no chart widget ({chart})")
                    return 2
                page.wait_for_timeout(5000)
            page.wait_for_timeout(3000)
            storage = ctx.storage_state()
            # the install page leaves the app, so nothing it holds writes while the load is measured
            page.goto("about:blank")
            # ── the measured load: a fresh context (cold device cache), the same account ──
            res = measure_load(browser, args.base, {"cookies": storage["cookies"], "origins": []}, out_dir, args.label,
                               title, server, args.poll, args.trace, args.wait_final)
        finally:
            if before is not None:
                account_record = restore_account(page, args.base, before)
                print(f"[probe] account after: {json.dumps(account_record)}", flush=True)
            ctx.close()
            if session is not None:
                session.close()
                account_record = dict(account_record or {}, signedOut=session.signed_out)
            browser.close()
    res["installed"] = installed
    who = (session.email if session is not None else args.email)
    res["account"] = {"email_domain": who.split("@")[-1], "role": (me.get("user") or me).get("role") if isinstance(me, dict) else None,
                      "pine_runtime_pane_enabled": me.get("pine_runtime_pane_enabled") if isinstance(me, dict) else None,
                      **({"leftAsFound": account_record} if account_record is not None else {})}
    res["title"] = title
    res["summary"] = summarise(res)
    (out_dir / f"{args.label}.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps({"label": args.label, "installed": (installed or {}).get("defs"), "summary": res["summary"]}, indent=1))
    if title and res["load"]["firstDigit"] is None:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
