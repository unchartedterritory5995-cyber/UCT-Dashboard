"""Breadth -> Data Charts measurement + screenshot rig, as a MEMBER.

Produces the Phase 0 (before) and Phase 4 (after) evidence for the Data Charts
overhaul (`docs/breadth/`): per viewport width, the requests a member's browser
sends, React commits, layout shift, ECharts remounts and time-to-first-chart-ink
for the tab switch and for every control change, plus screenshots of each state
and of every failure state the rig can induce CLIENT-SIDE.

## What it touches, and what it deliberately does not

- ⛔ **It never writes to the member-smoke account.** Data Charts persists its
  selection to server-side preferences on every change. The rig routes
  `/api/auth/preferences`: GETs pass through with `breadth_charts_state`
  REMOVED (so "default" is what a first visit sees, not whatever a past run
  left behind), and POSTs are answered locally and COUNTED, never forwarded. A
  smoke account that accumulates state stops being a control (CLAUDE.md).
- ⛔ **Failure states are induced in the browser only** — a routed 500 / 401 /
  402 / aborted request / held response for the tab's own data call. Production
  is never asked to fail.
- ⛔ **One login per run**, paced by `flow_cold_paint_rig._pace_login` (the login
  route is 5/minute per IP), then shared across every context as storage state.
  The storage file holds a session cookie: it lives in a temp directory and is
  deleted in `finally`, never in the repo.

## Traps this encodes

- ⛔ **The Data Charts tab has no URL.** `/breadth` lands on Monitor (desktop) or
  Daily (phone); the rig CLICKS the tab, and measures the page load and the tab
  switch as two separate segments rather than one number.
- ⛔ **The tab's data call must be matched exactly.** The Monitor fires its own
  `?days=90` and `?days=150&end=…` calls during page load; a loose pattern times
  the Monitor's response as the tab's (`--data-call` follows a changed shape).
- ⛔ **The intro animation plays on every load** (~9 s). Waiting for it is part of
  the run; pressing Escape to skip it disturbs the app (measured on Options Flow,
  2026-09-12) and is not done.
- ⛔ **The app scrolls `.main`, not the window**, so a full-page screenshot of the
  document is just the viewport. Tall captures grow the viewport to the tab's own
  height instead, then restore it.
- ⛔ **A deploy swap mid-run measures two pods.** Uptime is read before and after
  and a run that straddles a swap is labelled INCONCLUSIVE (`_swap_verdict`).
- ⛔ **Layout shift right after input is excluded from CLS by definition.** A preset
  click that shoves the chart down is therefore reported as `shift_input` beside
  `cls`, never silently dropped.

Usage:
    python tools/breadth_charts_rig.py --out docs/breadth/screenshots/before \
        --json docs/breadth/measurements/before.json
    python tools/breadth_charts_rig.py --widths 1280 --no-failures     # quick
    python tools/breadth_charts_rig.py --self-check

Exit: 0 measured · 2 INCONCLUSIVE (credentials, login, access, deploy swap).
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import shutil
import sys
import tempfile
import time

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from tools import flow_cold_paint_rig as fcr   # noqa: E402  login pacing + uptime + swap verdict

BASE = fcr.BASE
UA = fcr.UA

# The four widths the programme names. Heights are ordinary devices of that width.
WIDTH_HEIGHTS = {390: 844, 768: 1024, 1280: 800, 1920: 1080}

PREFS_PATH = "/api/auth/preferences"
PREF_KEY = "breadth_charts_state"
# The tab's own history call. ⚰️ This was `?days=\d+` and it was wrong twice over:
# the Monitor (the tab /breadth lands on) fires `?days=90` and two
# `?days=150&end=…` teleports during page load, so `expect_response` could time the
# MONITOR's call as the tab's, and a failure route would break the Monitor instead
# of Data Charts. Overridable with --data-call so the after-run can follow a
# changed request shape without editing this file.
DEFAULT_DATA_CALL = r"/api/breadth-monitor\?days=365(?:&|$)"
DATA_CALL = re.compile(DEFAULT_DATA_CALL)

SETTLE_MS = 1600          # ECharts' default animation is ~1 s; measure past it
INTRO_TIMEOUT_MS = 45000

PROBE_INIT = r"""
(() => {
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || {
    renderers: new Map(), supportsFiber: true,
    inject: () => 1, onCommitFiberUnmount: () => {},
  };
  window.__dc = {commits: 0, cls: 0, shiftInput: 0, shifts: [], clsObserver: false};
  const prev = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function (...args) {
    window.__dc.commits++;
    if (typeof prev === 'function') { try { prev.apply(this, args); } catch (e) {} }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) window.__dc.shiftInput += e.value;
        else window.__dc.cls += e.value;
        if (window.__dc.shifts.length < 300) {
          window.__dc.shifts.push({t: Math.round(e.startTime), v: +e.value.toFixed(4),
                                   input: e.hadRecentInput});
        }
      }
    }).observe({type: 'layout-shift', buffered: true});
    window.__dc.clsObserver = true;
  } catch (e) { window.__dc.clsObserver = String(e).slice(0, 80); }
})();
"""

SNAP_JS = """() => {
  const ec = document.querySelector('[_echarts_instance_]');
  return {
    commits: (window.__dc && window.__dc.commits) || 0,
    cls: (window.__dc && window.__dc.cls) || 0,
    shiftInput: (window.__dc && window.__dc.shiftInput) || 0,
    echarts: ec ? ec.getAttribute('_echarts_instance_') : null,
  };
}"""

# Installed immediately before the tab click. `attached` = an ECharts canvas with a
# real size exists; `ink` = that canvas has drawn something (axes/grid count — the
# background is transparent, so any alpha is the chart painting).
PAINT_PROBE_JS = """() => {
  const t0 = performance.now();
  window.__dcPaint = {attached: null, ink: null, err: null};
  let frame = 0;
  const tick = () => {
    const p = window.__dcPaint;
    const c = document.querySelector('[_echarts_instance_] canvas');
    if (c && c.width > 0 && p.attached === null) p.attached = performance.now() - t0;
    if (c && c.width > 0 && p.ink === null && (frame++ % 4 === 0)) {
      // ⚰️ A sparse POINT grid never fired on a fully drawn chart: 2px lines and
      // 1px gridlines slip between sample points, so a painted chart read as
      // blank for 30 s. Scan whole COLUMNS instead — every series line and every
      // horizontal gridline crosses a vertical column somewhere.
      try {
        const ctx = c.getContext('2d');
        let inked = 0;
        for (let i = 1; i <= 10; i++) {
          const d = ctx.getImageData(Math.floor(c.width * i / 11), 0, 1, c.height).data;
          for (let k = 3; k < d.length; k += 4) { if (d[k] > 0) { inked++; break; } }
        }
        if (inked >= 6) p.ink = performance.now() - t0;
      } catch (e) { p.err = String(e).slice(0, 80); }
    }
    if (p.ink === null && performance.now() - t0 < 30000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""

# Geometry + hygiene of the tab, measured in PAGE coordinates (never off a scaled
# screenshot). Root = the nearest `_container_` ancestor of the "Presets" label.
GEOMETRY_JS = """() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)};
  };
  const label = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === 'Presets');
  let root = label;
  while (root && !(root.className && String(root.className).includes('_container_'))) root = root.parentElement;
  const W = window.innerWidth;
  const out = {innerWidth: W, innerHeight: window.innerHeight, root: rect(root),
               docOverflowX: document.documentElement.scrollWidth > W + 1};
  if (!root) return out;
  const ec = root.querySelector('[_echarts_instance_]');
  out.chart = rect(ec);
  const chip = root.querySelector('button[aria-label*="percentile"]');
  out.readout = rect(chip ? chip.parentElement : null);
  out.presetRow = rect(label ? label.parentElement : null);
  const over = [];
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > W + 1 && over.length < 12) {
      over.push({tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40),
                 text: (el.textContent || '').trim().slice(0, 30), right: Math.round(r.right)});
    }
  }
  out.overflowing = over;
  const small = [];
  let interactive = 0;
  for (const el of root.querySelectorAll('button, input, select, a, [role="button"], label')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    interactive++;
    if (r.height < 44 || r.width < 44) {
      small.push({tag: el.tagName.toLowerCase(), type: el.type || null,
                  name: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 28),
                  w: Math.round(r.width), h: Math.round(r.height)});
    }
  }
  out.interactive = interactive;
  out.under44 = small.length;
  out.under44Sample = small.slice(0, 14);
  // Height the viewport needs for a tall capture: the root's bottom inside the
  // scroll container, plus a margin.
  let sc = root.parentElement;
  while (sc && sc !== document.body) {
    const s = getComputedStyle(sc);
    if (/(auto|scroll)/.test(s.overflowY) && sc.scrollHeight > sc.clientHeight) break;
    sc = sc.parentElement;
  }
  const scrollTop = sc && sc !== document.body ? sc.scrollTop : window.scrollY;
  out.neededHeight = Math.ceil(root.getBoundingClientRect().bottom + scrollTop + 32);
  // Above the fold: how much of the plot a member sees before scrolling.
  if (ec) {
    const r = ec.getBoundingClientRect();
    out.chartVisibleAtLoadPx = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
  }
  // ⚰️ Matching leaf DIVS with a straight apostrophe missed the ErrorState on
  // 2026-09-13: its text is a <p>-like leaf and uses a curly ’ ("Couldn’t load").
  // Match any leaf element, and either apostrophe. C1 (A-01) replaced that
  // ErrorState with one sentence per failure; each is listed so a real state
  // never reads as "no placeholder".
  out.placeholder = [...root.querySelectorAll('*')]
    .map(d => d.children.length === 0 ? (d.textContent || '').trim() : '')
    .filter(t => /^(Loading data|No data in selected range|Pick a preset|Couldn['’]t (load|refresh)|Breadth history didn['’]t load|Your session has ended|Data Charts is part of)/.test(t))
    .slice(0, 3);
  return out;
}"""


# ── pure helpers (self-checked) ─────────────────────────────────────────────────

def api_calls(ledger, start, end=None):
    """The `/api/*` requests in ledger[start:end], as (method, path) pairs."""
    rows = ledger[start:end]
    out = []
    for r in rows:
        url = r["url"]
        if "/api/" not in url:
            continue
        path = url.split(BASE, 1)[-1] if url.startswith(BASE) else url
        out.append((r["method"], path[:120]))
    return out


def delta(before, after):
    """Interaction deltas from two SNAP_JS readings."""
    return {
        "commits": after["commits"] - before["commits"],
        "cls": round(after["cls"] - before["cls"], 4),
        "shift_input": round(after["shiftInput"] - before["shiftInput"], 4),
        "echarts_remounted": (before["echarts"] is not None and after["echarts"] is not None
                              and before["echarts"] != after["echarts"]),
        "echarts_before": before["echarts"],
        "echarts_after": after["echarts"],
    }


def tall_height(needed, current, cap=6000):
    """Viewport height for a tall capture: never smaller than the real viewport,
    never unbounded (a runaway `neededHeight` must not ask for a 50k-px image)."""
    if not isinstance(needed, (int, float)) or needed <= 0:
        return current
    return int(min(max(needed, current), cap))


def self_check() -> int:
    bad = 0

    def case(name, ok):
        nonlocal bad
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad += 0 if ok else 1

    led = [{"method": "GET", "url": BASE + "/api/breadth-monitor?days=365"},
           {"method": "GET", "url": BASE + "/assets/x.js"},
           {"method": "POST", "url": BASE + PREFS_PATH}]
    case("api_calls keeps /api/ rows and drops assets",
         api_calls(led, 0) == [("GET", "/api/breadth-monitor?days=365"), ("POST", PREFS_PATH)])
    case("⛔ CONTROL — api_calls respects the window start", api_calls(led, 2) == [("POST", PREFS_PATH)])
    s0 = {"commits": 10, "cls": 0.01, "shiftInput": 0.0, "echarts": "ec_1"}
    s1 = {"commits": 14, "cls": 0.01, "shiftInput": 0.2, "echarts": "ec_1"}
    s2 = {"commits": 14, "cls": 0.01, "shiftInput": 0.2, "echarts": "ec_7"}
    case("delta counts commits and input-shift", delta(s0, s1)["commits"] == 4
         and delta(s0, s1)["shift_input"] == 0.2)
    case("⛔ a changed ECharts instance id IS a remount", delta(s1, s2)["echarts_remounted"] is True)
    case("⛔ CONTROL — the same id is not", delta(s0, s1)["echarts_remounted"] is False)
    case("⛔ no chart before or after is not called a remount",
         delta({**s0, "echarts": None}, s2)["echarts_remounted"] is False)
    case("tall_height never shrinks the viewport", tall_height(300, 800) == 800)
    case("⛔ tall_height caps a runaway height", tall_height(99999, 800) == 6000)
    case("tall_height ignores garbage", tall_height(None, 800) == 800)
    dc = re.compile(DEFAULT_DATA_CALL)
    case("DATA_CALL matches the tab's history call", bool(dc.search("/api/breadth-monitor?days=365")))
    case("⛔ DATA_CALL never matches the live route",
         not dc.search("/api/breadth-monitor/live") and
         not dc.search("/api/breadth-monitor/live/drill/up_4pct_today"))
    case("⛔ DATA_CALL never matches the MONITOR's page-load calls (measured 2026-09-13)",
         not dc.search("/api/breadth-monitor?days=90") and
         not dc.search("/api/breadth-monitor?days=150&end=2026-09-11&anchor=le") and
         not dc.search("/api/breadth-monitor?days=3650"))
    case("every programme width has a height", all(w in WIDTH_HEIGHTS for w in (390, 768, 1280, 1920)))
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 1 if bad else 0


# ── browser plumbing ────────────────────────────────────────────────────────────

def say(msg):
    print(msg, flush=True)


def install_pref_routes(ctx, ledger, force_theme=None):
    """GET passes through minus the tab's saved state; POST is answered locally.

    `force_theme` rewrites the `theme` pref in the GET (e.g. 'light') so a theme can
    be captured without ever writing the account's real preference."""
    def handle(route, request):
        if request.method == "GET":
            resp = route.fetch()
            try:
                data = resp.json()
            except Exception:                                   # noqa: BLE001
                return route.fulfill(response=resp)
            if isinstance(data, dict):
                ledger["saved_state_present"] = PREF_KEY in data
                data.pop(PREF_KEY, None)
                if force_theme:
                    data["theme"] = force_theme
                return route.fulfill(response=resp, json=data)
            return route.fulfill(response=resp)
        ledger["pref_writes_blocked"] += 1
        try:
            key = (request.post_data_json or {}).get("key")
        except Exception:                                       # noqa: BLE001
            key = None
        ledger["pref_write_keys"].append(key)
        return route.fulfill(status=200, json={"ok": True})
    ctx.route("**" + PREFS_PATH, handle)


def new_page(browser, storage, width, ledger, prefs_ledger, force_theme=None):
    ctx = browser.new_context(storage_state=storage, user_agent=UA, device_scale_factor=1,
                              viewport={"width": width, "height": WIDTH_HEIGHTS[width]})
    ctx.add_init_script(PROBE_INIT)
    install_pref_routes(ctx, prefs_ledger, force_theme=force_theme)
    page = ctx.new_page()
    page.on("request", lambda r: ledger.append({"t": time.monotonic(), "method": r.method, "url": r.url}))
    return ctx, page


def wait_past_intro(page, notes=None):
    page.wait_for_function(
        "(() => { const t=(document.body&&document.body.innerText||'');"
        " return t.length > 600 && t.indexOf('CHARTING THE MARKET') === -1"
        " && [...document.querySelectorAll('button')].some(b => b.textContent.trim()==='Data Charts'); })()",
        timeout=INTRO_TIMEOUT_MS)
    # ⚰️ A first-visit "Meet Compass" coach mark (the voice orb's) sits over the lower
    # right of the page — measured on top of the Data Charts plot on 2026-09-13. It is
    # app chrome, not this tab, so it is RECORDED and then dismissed before any capture
    # rather than screenshotted into every state.
    try:
        got = page.get_by_role("button", name="Got it", exact=True)
        page.wait_for_timeout(800)
        if got.count() and got.first.is_visible():
            if notes is not None:
                notes.append("first-visit 'Meet Compass' coach mark was showing and was dismissed")
            got.first.click()
            page.wait_for_timeout(300)
    except Exception:                                           # noqa: BLE001
        pass


def root_of(page):
    label = page.get_by_text("Presets", exact=True).first
    return label.locator("xpath=ancestor::div[contains(@class,'_container_')][1]")


def group_button(root, name):
    return root.locator("button").filter(has_text=re.compile(r"^" + re.escape(name))).first


def ensure_group(root, name, open_):
    """Open or close a picker group. The arrow glyph says which state it is in."""
    btn = group_button(root, name)
    txt = btn.inner_text()
    is_open = "▾" in txt
    if is_open != open_:
        btn.click()


def set_metric(page, root, group, label, checked):
    ensure_group(root, group, True)
    box = root.get_by_label(label, exact=True)
    if box.is_checked() != checked:
        box.click()
    page.wait_for_timeout(120)


def capture(page, out_dir, state, width, geometry_log, tall=True, viewport_too=False):
    """Screenshot a state and record its geometry. Returns the geometry dict."""
    geo = page.evaluate(GEOMETRY_JS)
    geometry_log.setdefault(state, {})[str(width)] = geo
    out_dir.mkdir(parents=True, exist_ok=True)
    if viewport_too:
        page.screenshot(path=str(out_dir / f"{state}__{width}__viewport.jpg"), type="jpeg", quality=82)
    if tall:
        h0 = page.viewport_size["height"]
        h = tall_height(geo.get("neededHeight"), h0)
        if h != h0:
            page.set_viewport_size({"width": width, "height": h})
            page.wait_for_timeout(700)          # size-sensor → ECharts resize
        page.screenshot(path=str(out_dir / f"{state}__{width}.jpg"), type="jpeg", quality=82)
        if h != h0:
            page.set_viewport_size({"width": width, "height": h0})
            page.wait_for_timeout(500)
    return geo


def measured(page, ledger, label, fn, results):
    """Run one interaction and record requests / commits / CLS / remount across it."""
    i0 = len(ledger)
    s0 = page.evaluate(SNAP_JS)
    t0 = time.monotonic()
    fn()
    page.wait_for_timeout(SETTLE_MS)
    s1 = page.evaluate(SNAP_JS)
    row = {"interaction": label, "wall_ms": round((time.monotonic() - t0) * 1000),
           "api_requests": api_calls(ledger, i0), **delta(s0, s1)}
    results.append(row)
    return row


def open_more_and_pick(page, root, name):
    # C3 (A-24, D-032): More is a disclosure of buttons, not a listbox of options.
    root.get_by_role("button", name=re.compile(r"^More")).click()
    page.wait_for_timeout(300)
    root.get_by_role("button", name=re.compile("^" + re.escape(name))).first.click()


def run_width(browser, storage, width, out_dir, geometry_log, prefs_ledger):
    ledger = []
    ctx, page = new_page(browser, storage, width, ledger, prefs_ledger)
    res = {"width": width, "interactions": [], "errors": [], "notes": []}
    try:
        t_nav = time.monotonic()
        page.goto(BASE + "/breadth", wait_until="commit", timeout=60000)
        wait_past_intro(page, res["notes"])
        res["page_load_ms_to_tabs"] = round((time.monotonic() - t_nav) * 1000)
        res["page_load_api"] = api_calls(ledger, 0)
        page.wait_for_timeout(1500)       # let the landing tab finish its own fetches
        res["page_load_api_settled"] = api_calls(ledger, 0)

        # ── the tab switch: the number a member pays to open Data Charts ──
        i0 = len(ledger)
        s0 = page.evaluate(SNAP_JS)
        page.evaluate(PAINT_PROBE_JS)
        with page.expect_response(lambda r: bool(DATA_CALL.search(r.url)), timeout=45000) as ri:
            page.get_by_role("button", name="Data Charts", exact=True).click()
        resp = ri.value
        body = resp.body()
        page.wait_for_function("window.__dcPaint && (window.__dcPaint.ink !== null || window.__dcPaint.err)",
                               timeout=30000)
        page.wait_for_timeout(SETTLE_MS)
        s1 = page.evaluate(SNAP_JS)
        paint = page.evaluate("window.__dcPaint")
        timing = resp.request.timing or {}
        res["tab_switch"] = {
            "api_requests": api_calls(ledger, i0),
            "data_call": {"url": resp.url.split(BASE, 1)[-1], "status": resp.status,
                          "decoded_bytes": len(body),
                          "content_encoding": resp.headers.get("content-encoding"),
                          "server_ms": (round(timing["responseEnd"] - timing["requestStart"])
                                        if timing.get("responseEnd", -1) >= 0 and timing.get("requestStart", -1) >= 0
                                        else None)},
            "chart_canvas_attached_ms": paint.get("attached"),
            "chart_first_ink_ms": paint.get("ink"),
            "paint_probe_error": paint.get("err"),
            **delta(s0, s1),
        }
        try:
            rows = json.loads(body).get("rows") or []
            res["tab_switch"]["rows"] = len(rows)
            res["tab_switch"]["row_span"] = [rows[-1].get("date"), rows[0].get("date")] if rows else None
        except Exception:                                       # noqa: BLE001
            pass
        root = root_of(page)
        capture(page, out_dir, "default", width, geometry_log, viewport_too=True)

        # Zoom, then change the selection: does the zoom survive a rebuild?
        c = geometry_log["default"][str(width)].get("chart")
        if c:
            page.mouse.move(c["x"] + c["w"] * 0.5, c["y"] + c["h"] * 0.4)
            for _ in range(6):
                page.mouse.wheel(0, -240)
                page.wait_for_timeout(80)
            page.wait_for_timeout(700)
            # TALL, so the zoom slider and the x-axis dates are in the frame — a
            # viewport shot at 800px cuts both off, and the slider IS the evidence.
            capture(page, out_dir, "zoomed", width, geometry_log)
            measured(page, ledger, "check: % Above 200SMA (while zoomed)",
                     lambda: set_metric(page, root, "MA Breadth", "% Above 200SMA", True), res["interactions"])
            ensure_group(root, "MA Breadth", False)
            page.wait_for_timeout(400)
            capture(page, out_dir, "zoom-after-toggle", width, geometry_log)
            page.mouse.move(2, 2)

        pill = lambda name: root.get_by_role("button", name=name, exact=True)  # noqa: E731
        measured(page, ledger, "preset: Market Health", lambda: pill("Market Health").click(), res["interactions"])
        capture(page, out_dir, "preset-market-health", width, geometry_log)
        measured(page, ledger, "preset: Breadth vs Price", lambda: pill("Breadth vs Price").click(), res["interactions"])
        capture(page, out_dir, "preset-breadth-vs-price", width, geometry_log)

        root.get_by_role("button", name=re.compile(r"^More")).click()
        page.wait_for_timeout(400)
        capture(page, out_dir, "more-popover", width, geometry_log, tall=False, viewport_too=True)
        measured(page, ledger, "preset: Full MA Term Structure (More)",
                 lambda: root.get_by_role("button", name=re.compile(r"^Full MA Term Structure")).first.click(),
                 res["interactions"])
        capture(page, out_dir, "preset-full-ma-term-structure", width, geometry_log)

        # Volume Thrust declares reference lines on TWO families (ratio 1.0 + net 0).
        measured(page, ledger, "preset: Volume Thrust (More)",
                 lambda: open_more_and_pick(page, root, "Volume Thrust"), res["interactions"])
        capture(page, out_dir, "preset-volume-thrust", width, geometry_log)

        # Hand-picked mixed families: pct + vix + ratio -> right axis "VIX / ratio".
        measured(page, ledger, "preset: Market Health (reset for mixed)", lambda: pill("Market Health").click(),
                 res["interactions"])
        measured(page, ledger, "open group: Regime", lambda: ensure_group(root, "Regime", True), res["interactions"])
        measured(page, ledger, "check: VIX", lambda: set_metric(page, root, "Regime", "VIX", True), res["interactions"])
        measured(page, ledger, "check: Up/Down Volume",
                 lambda: set_metric(page, root, "Primary Breadth", "Up/Down Volume", True), res["interactions"])
        capture(page, out_dir, "picker-expanded", width, geometry_log)
        ensure_group(root, "Regime", False)
        ensure_group(root, "Primary Breadth", False)
        page.wait_for_timeout(500)
        capture(page, out_dir, "mixed-family", width, geometry_log)

        # Hover the plot for the tooltip.
        geo = geometry_log["mixed-family"][str(width)]
        if geo.get("chart"):
            c = geo["chart"]
            page.mouse.move(c["x"] + c["w"] * 0.6, c["y"] + c["h"] * 0.45)
            page.wait_for_timeout(500)
            capture(page, out_dir, "tooltip", width, geometry_log, tall=False, viewport_too=True)
            page.mouse.move(2, 2)

        # Clear everything -> the no-metrics placeholder.
        for g, lab in (("Score", "Health Score"), ("Score", "UCT Exposure"), ("MA Breadth", "% Above 50SMA"),
                       ("Regime", "VIX"), ("Primary Breadth", "Up/Down Volume")):
            set_metric(page, root, g, lab, False)
        for g in ("Score", "MA Breadth", "Regime", "Primary Breadth"):
            ensure_group(root, g, False)
        page.wait_for_timeout(600)
        capture(page, out_dir, "no-metrics", width, geometry_log)

        # Magnitude flattening on one shared count axis.
        set_metric(page, root, "Primary Breadth", "Universe Count", True)
        set_metric(page, root, "Highs / Lows", "52W Lows (Close)", True)
        ensure_group(root, "Primary Breadth", False)
        ensure_group(root, "Highs / Lows", False)
        page.wait_for_timeout(SETTLE_MS)
        capture(page, out_dir, "magnitude-flatten", width, geometry_log)

        # FTD markers on Market Health.
        pill("Market Health").click()
        measured(page, ledger, "toggle: Follow-through days",
                 lambda: root.get_by_label("Follow-through days").check(), res["interactions"])
        capture(page, out_dir, "ftd-on", width, geometry_log)

        # Date range: client-side filter — does it fetch?
        measured(page, ledger, "date: From -> 2025-03-31",
                 lambda: root.locator("input[type='date']").first.fill("2025-03-31"), res["interactions"])
        capture(page, out_dir, "range-full-365", width, geometry_log)
        # Breadth Thrust over the full window: its ratio axis holds up_vol_ratio (max
        # 85.94 in April 2025) beside 5D/10D ratios (≤ 9.49 / 3.70).
        measured(page, ledger, "preset: Breadth Thrust (full 365 window)",
                 lambda: pill("Breadth Thrust").click(), res["interactions"])
        capture(page, out_dir, "thrust-full-365", width, geometry_log)
        measured(page, ledger, "date: range entirely in the future",
                 lambda: (root.locator("input[type='date']").nth(1).fill("2030-02-01"),
                          root.locator("input[type='date']").first.fill("2030-01-01")),
                 res["interactions"])
        capture(page, out_dir, "empty-range", width, geometry_log)

        res["dc_final"] = page.evaluate("({cls: window.__dc.cls, shiftInput: window.__dc.shiftInput,"
                                        " commits: window.__dc.commits, clsObserver: window.__dc.clsObserver,"
                                        " shifts: window.__dc.shifts.slice(-40)})")
    except Exception as e:                                      # noqa: BLE001
        res["errors"].append(f"{type(e).__name__}: {str(e)[:300]}")
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(out_dir / f"_error__{width}.jpg"), type="jpeg", quality=70)
        except Exception:                                       # noqa: BLE001
            pass
    finally:
        ctx.close()
    return res


def sample_tab_switch(browser, storage, width, prefs_ledger):
    """One cold client (fresh context) → /breadth → click Data Charts → first ink.

    ⭐ A single sample is an anecdote: on 2026-09-13 one 768 run inked in 3.5 s and
    the others in 0.3-0.4 s on the same build. `--tab-switch-samples N` repeats this
    per width so the doc can quote a median and a worst case, each sample carrying
    its own swap verdict."""
    ledger = []
    ctx, page = new_page(browser, storage, width, ledger, prefs_ledger)
    out = {"width": width}
    try:
        u0, t0 = fcr._uptime(), time.monotonic()
        page.goto(BASE + "/breadth", wait_until="commit", timeout=60000)
        wait_past_intro(page)
        page.wait_for_timeout(1500)
        i0 = len(ledger)
        s0 = page.evaluate(SNAP_JS)
        page.evaluate(PAINT_PROBE_JS)
        with page.expect_response(lambda r: bool(DATA_CALL.search(r.url)), timeout=45000) as ri:
            page.get_by_role("button", name="Data Charts", exact=True).click()
        resp = ri.value
        resp.body()
        page.wait_for_function("window.__dcPaint && (window.__dcPaint.ink !== null || window.__dcPaint.err)",
                               timeout=30000)
        page.wait_for_timeout(600)
        s1 = page.evaluate(SNAP_JS)
        paint = page.evaluate("window.__dcPaint")
        timing = resp.request.timing or {}
        u1 = fcr._uptime()
        sw, why = fcr._swap_verdict(u0, u1, time.monotonic() - t0)
        out.update({
            "ink_ms": paint.get("ink"), "attached_ms": paint.get("attached"),
            "server_ms": (round(timing["responseEnd"] - timing["requestStart"])
                          if timing.get("responseEnd", -1) >= 0 and timing.get("requestStart", -1) >= 0 else None),
            "api": len(api_calls(ledger, i0)), "commits": s1["commits"] - s0["commits"],
            "uptime_before": u0, "deploy_swapped": sw, "swap_reason": why,
        })
    except Exception as e:                                      # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    finally:
        ctx.close()
    return out


FAILURES = {
    "error-500": lambda route: route.fulfill(status=500, json={"detail": "rig-induced 500"}),
    "error-401": lambda route: route.fulfill(status=401, json={"detail": "Not authenticated"}),
    "error-402": lambda route: route.fulfill(status=402, json={"detail": "Upgrade required"}),
    "error-network": lambda route: route.abort("failed"),
}
EXTRA_KINDS = ("theme-light", "loading")


def run_failure(browser, storage, kind, widths, out_dir, geometry_log, prefs_ledger):
    """One load at the widest width in a given condition, captured at every width."""
    ledger = []
    first = max(widths)
    ctx, page = new_page(browser, storage, first, ledger, prefs_ledger,
                         force_theme="light" if kind == "theme-light" else None)
    held = []
    out = {"kind": kind, "errors": [], "notes": []}
    try:
        if kind == "loading":
            page.route(DATA_CALL, lambda route: held.append(route))
        elif kind in FAILURES:
            page.route(DATA_CALL, FAILURES[kind])
        page.goto(BASE + "/breadth", wait_until="commit", timeout=60000)
        wait_past_intro(page, out["notes"])
        if kind in EXTRA_KINDS and kind != "loading":
            # ⚰️ A fixed 4 s wait captured the light theme as "Loading data…" on
            # 2026-09-13 — the data call can take longer than that on a pod whose
            # cache has expired. A state that should show a chart waits for INK.
            page.evaluate(PAINT_PROBE_JS)
            page.get_by_role("button", name="Data Charts", exact=True).click()
            page.wait_for_function("window.__dcPaint && (window.__dcPaint.ink !== null || window.__dcPaint.err)",
                                   timeout=45000)
            page.wait_for_timeout(SETTLE_MS)
        else:
            page.get_by_role("button", name="Data Charts", exact=True).click()
            page.wait_for_timeout(2500)
        for w in sorted(widths, reverse=True):
            page.set_viewport_size({"width": w, "height": WIDTH_HEIGHTS[w]})
            page.wait_for_timeout(700)
            geo = capture(page, out_dir, kind, w, geometry_log)
            out.setdefault("placeholder", {})[str(w)] = geo.get("placeholder")
        out["api_requests"] = api_calls(ledger, 0)[-12:]
    except Exception as e:                                      # noqa: BLE001
        out["errors"].append(f"{type(e).__name__}: {str(e)[:300]}")
    finally:
        for r in held:
            try:
                r.continue_()
            except Exception:                                   # noqa: BLE001
                pass
        ctx.close()
    return out


def main(argv=None) -> int:
    global DATA_CALL
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default="docs/breadth/screenshots/before")
    ap.add_argument("--json", default="docs/breadth/measurements/before.json")
    ap.add_argument("--widths", default="390,768,1280,1920")
    ap.add_argument("--data-call", default=DEFAULT_DATA_CALL,
                    help="regex for the tab's own data request (default: the legacy days=365 call)")
    ap.add_argument("--no-failures", action="store_true")
    ap.add_argument("--conditions", default=",".join(EXTRA_KINDS + tuple(FAILURES)),
                    help="comma list of conditions to capture (default: all)")
    ap.add_argument("--conditions-only", action="store_true",
                    help="skip the per-width interaction flow; capture only --conditions")
    ap.add_argument("--tab-switch-samples", type=int, default=0,
                    help="samples-only mode: N cold tab switches per width, nothing else")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    DATA_CALL = re.compile(a.data_call)
    conditions = [c.strip() for c in a.conditions.split(",") if c.strip()]
    for c in conditions:
        if c not in EXTRA_KINDS and c not in FAILURES:
            say(f"unknown condition {c}; choose from {EXTRA_KINDS + tuple(FAILURES)}")
            return 2

    email = os.environ.get("MEMBER_SMOKE_EMAIL")
    password = os.environ.get("MEMBER_SMOKE_PASSWORD")
    if not email or not password:
        say("INCONCLUSIVE: MEMBER_SMOKE_EMAIL / MEMBER_SMOKE_PASSWORD not set.")
        return 2
    widths = [int(w) for w in a.widths.split(",") if w.strip()]
    for w in widths:
        if w not in WIDTH_HEIGHTS:
            say(f"unknown width {w}; choose from {sorted(WIDTH_HEIGHTS)}")
            return 2
    out_dir = (REPO / a.out) if not os.path.isabs(a.out) else pathlib.Path(a.out)
    json_path = (REPO / a.json) if not os.path.isabs(a.json) else pathlib.Path(a.json)

    up = fcr._uptime()
    waited = 0
    while up is not None and up < fcr.MIN_POD_AGE_S and waited < 600:
        say(f"pod uptime {up:.0f}s < {fcr.MIN_POD_AGE_S:.0f}s floor — waiting (a cold pod is not a member's pod)")
        time.sleep(20)
        waited += 20
        up = fcr._uptime()
    if up is None:
        say("INCONCLUSIVE: /api/health unreadable (a deploy swap reads like this).")
        return 2
    t_run = time.monotonic()

    from playwright.sync_api import sync_playwright
    tmp = tempfile.mkdtemp(prefix="dc_rig_")
    storage = os.path.join(tmp, "state.json")
    report = {"base": BASE, "data_call": a.data_call,
              "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "uptime_before": up, "widths": {}, "failures": {}, "geometry": {},
              "prefs": {"saved_state_present": None, "pref_writes_blocked": 0, "pref_write_keys": []}}
    try:
        with sync_playwright() as pw:
            rq = pw.request.new_context(base_url=BASE, user_agent=UA)
            fcr._pace_login()
            r = rq.post("/api/auth/login", data={"email": email, "password": password})
            if r.status != 200:
                say(f"INCONCLUSIVE: login http {r.status}")
                return 2
            user = (r.json() or {}).get("user") or {}
            report["account"] = {"role": user.get("role")}
            probe = rq.get("/api/breadth-monitor?days=5")
            report["access_probe_status"] = probe.status
            if probe.status != 200:
                say(f"INCONCLUSIVE: the account cannot read breadth history (http {probe.status}).")
                return 2
            live = rq.get("/api/breadth-monitor/live")
            try:
                lj = live.json()
                report["live"] = {"status": live.status, "ok": lj.get("ok"), "superseded": lj.get("superseded"),
                                  "degraded": lj.get("degraded"), "market_open": lj.get("market_open"),
                                  "has_row": bool(lj.get("row"))}
            except Exception:                                   # noqa: BLE001
                report["live"] = {"status": live.status}
            rq.storage_state(path=storage)
            rq.dispose()

            browser = pw.chromium.launch(headless=True)
            try:
                if a.tab_switch_samples:
                    # Samples-only mode: nothing else runs, so the numbers are not
                    # perturbed by screenshots or interaction flows on the same browser.
                    for w in widths:
                        rows = []
                        for i in range(a.tab_switch_samples):
                            s = sample_tab_switch(browser, storage, w, report["prefs"])
                            rows.append(s)
                            say(f"   {w} sample {i + 1}: ink={s.get('ink_ms')} server={s.get('server_ms')} "
                                f"api={s.get('api')} swap={s.get('deploy_swapped')} err={s.get('error')}")
                        report.setdefault("tab_switch_samples", {})[str(w)] = rows
                    a.conditions_only, a.no_failures = True, True
                for w in ([] if a.conditions_only else widths):
                    say(f"\n── width {w} ──")
                    # ⚰️ A whole-run swap verdict threw away four widths for one swap
                    # (2026-09-13: uptime 297 s -> 211 s, and only the 768 segment showed
                    # it — a 17 s first paint). Each segment carries its OWN verdict so a
                    # re-run repeats only the segment a deploy landed in.
                    u0, t0 = fcr._uptime(), time.monotonic()
                    res = run_width(browser, storage, w, out_dir, report["geometry"], report["prefs"])
                    u1 = fcr._uptime()
                    res["deploy_swapped"], res["swap_reason"] = fcr._swap_verdict(u0, u1, time.monotonic() - t0)
                    res["uptime_before"], res["uptime_after"] = u0, u1
                    if res["deploy_swapped"]:
                        report.setdefault("swapped_segments", []).append(f"width:{w}")
                    report["widths"][str(w)] = res
                    ts = res.get("tab_switch", {})
                    say(f"   tab switch: api={len(ts.get('api_requests', []))} "
                        f"ink={ts.get('chart_first_ink_ms')}ms commits={ts.get('commits')} "
                        f"cls={ts.get('cls')} interactions={len(res['interactions'])} errors={res['errors']}")
                if not a.no_failures:
                    for kind in conditions:
                        say(f"\n── condition: {kind} ──")
                        u0, t0 = fcr._uptime(), time.monotonic()
                        report["failures"][kind] = run_failure(browser, storage, kind, widths, out_dir,
                                                               report["geometry"], report["prefs"])
                        u1 = fcr._uptime()
                        sw, why = fcr._swap_verdict(u0, u1, time.monotonic() - t0)
                        report["failures"][kind].update({"deploy_swapped": sw, "swap_reason": why,
                                                         "uptime_before": u0, "uptime_after": u1})
                        if sw:
                            report.setdefault("swapped_segments", []).append(f"condition:{kind}")
                        say(f"   placeholder={report['failures'][kind].get('placeholder')} "
                            f"errors={report['failures'][kind]['errors']}")
            finally:
                browser.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    up_after = fcr._uptime()
    swapped, why = fcr._swap_verdict(up, up_after, time.monotonic() - t_run)
    report["uptime_after"] = up_after
    report["deploy_swapped"] = swapped
    report["swap_reason"] = why
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    say(f"\nwrote {json_path}")
    say(f"screenshots in {out_dir}")
    if swapped:
        say(f"INCONCLUSIVE: {why}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
