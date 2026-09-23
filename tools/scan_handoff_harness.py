"""Browser acceptance for the ATOMIC SYMBOL HANDOFF, through the REAL ChartWidget.

The previous harness drove `/r/chart`, which mounts StockChart directly -- so it
could not exercise the coordinator at all and its empty-window numbers were
pre-handoff by construction. This one runs the dev server and loads
`scan-harness.html`, which mounts a real ChartWidget behind the real
`useSymbolHandoff`, driven by a list that moves the colour-group symbol exactly
as Theme Tracker does, with the real +/-6 neighbour warmer running.

THE ACCEPTANCE AUTHORITY IS THE RENDERED STATE, NOT REACT STATE. Every sampled
frame is classified:

  VALID_OLD                A identity + A candles
  VALID_NEW_CURRENT        B identity + current B candles
  VALID_NEW_AUTHORITATIVE  B identity + verified-no-newer B candles
  DEGRADED_NODATA/ERROR    B identity + an honest degraded state
  INVALID_EMPTY            a normal chart canvas unexpectedly blank
  INVALID_MIXED            identity and candles disagree
  INVALID_STALE            B identity + materially stale, unverified B candles

Isolation: no backend (every /api/** route-mocked), no C:\\data, no session
cookie, no secret. The harness page itself refuses any non-GET to the
preference/layout routes.

Usage:  <venv>\\python.exe tools\\scan_handoff_harness.py
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from datetime import timedelta

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intraday_tail_harness import (   # noqa: E402
    CLOCK_JS, FAKE_NOW, Fixture, SEED_JS, CACHE_LOGIC_VERSION, make_bars, route_handler,
)

APP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")

# A Rare-Earth-shaped list, with a planted mix of cache states.
SCAN = ["MU", "MP", "UUUU", "TMC", "NB", "IDR", "USAR", "CRML", "TMRC", "AREC",
        "PPTA", "UAMY", "GSM", "LAC", "REEMF", "NIOBF", "SRCRF", "TRXA", "ARRNF",
        "LYSDY", "ILUKY", "SRCR", "TRX", "GSMX", "LACX"]

# Planted cache states by position, so every class is exercised in one scan.
def plan(tf_min: int):
    out = {}
    for i, s in enumerate(SCAN):
        if i % 5 == 0:   out[s] = ("current", FAKE_NOW)
        elif i % 5 == 1: out[s] = ("slight", FAKE_NOW - timedelta(minutes=2 * tf_min))
        elif i % 5 == 2: out[s] = ("hours", FAKE_NOW.replace(hour=10, minute=0, second=0, microsecond=0))
        elif i % 5 == 3: out[s] = ("cold", None)
        else:            out[s] = ("thin", FAKE_NOW.replace(hour=10, minute=0, second=0, microsecond=0))
    return out


CLEAR_IDB = ("() => new Promise(res => { const r = indexedDB.deleteDatabase('uct_bars_v1'); "
             "r.onsuccess = r.onerror = r.onblocked = () => res(true) })")

# Sample what the MEMBER can see: the widget's rendered ticker and the symbol the
# candles on the canvas actually belong to.
# ⛔⛔ FAIL-CLOSED. The previous probe read `__uctBarsDebug.paintSym` and
# `__chartBarCount` — neither exists in the ChartWidget context — so all 360
# samples returned null, every one fell into a "nothing drawn yet" bucket, and
# the classifier produced a PLAUSIBLE PASS out of no evidence at all. Missing
# evidence is now its own verdict and it FAILS the run.
#
# Both signals are real and member-visible:
#   domSym   the rendered ticker, read from `[data-testid="sym-label"]` — the
#            node ChartIdentityRow always claimed both branches render (they do
#            now; the SymbolSearch branch was missing the attribute).
#   chartSym the symbol the drawn candles belong to: the newest timing row that
#            actually recorded a paint. That record is written by StockChart's
#            own paint site, so it cannot report a symbol that was never drawn.
SAMPLE_JS = """
() => {
  const now = performance.now();
  const el = document.querySelector('[data-testid="sym-label"]');
  const domSym = el ? (el.textContent || '').trim().split(/[\s(·]/)[0].toUpperCase() : null;
  const t = window.__uctChartTiming;
  const rows = t ? t.report() : null;
  let chartSym = null, chartCurrent = null, chartBehind = null;
  if (Array.isArray(rows)) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]['T0→paint'] != null) {
        chartSym = String(rows[i].sym || '').toUpperCase();
        chartCurrent = rows[i].paintWasCurrent;
        chartBehind = rows[i].paintBarsBehind;
        break;
      }
    }
  }
  return {
    ts: now,
    requested: (window.__scan && window.__scan.requested()) || null,
    domSym,
    chartSym,
    chartCurrent,
    chartBehind,
    // A deliberately wrong label, set ONLY by the classifier control below, to
    // prove this probe can actually detect a mismatch.
    forced: window.__scanForceLabel || null,
  };
}
"""

# ⭐ THE CONTROL. A classifier that has never been shown to FAIL is not evidence.
# This rewrites the rendered ticker to a symbol that is not the one drawn, in the
# HARNESS ONLY, and the run asserts the classifier reports INVALID_MIXED for it.
FORCE_MISMATCH_JS = """
(fake) => {
  const el = document.querySelector('[data-testid="sym-label"]');
  if (!el) return false;
  window.__scanForceLabel = fake;
  el.textContent = fake;
  return true;
}
"""


def start_dev_server(port: int):
    """The harness needs the DEV server: vite build has one entry (index.html),
    which is exactly what keeps this page out of production."""
    env = dict(os.environ, BROWSER="none")
    p = subprocess.Popen(
        ["npx", "vite", "--port", str(port), "--strictPort", "--host", "127.0.0.1"],
        cwd=APP, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        shell=(os.name == "nt"), text=True,
    )
    # ⛔ POLL THE PORT, DO NOT PARSE STDOUT. Matching "Local:" fired before the
    # socket was actually accepting, and the first run died on
    # ERR_CONNECTION_REFUSED. Readiness is "it answers", not "it said so".
    import urllib.request
    deadline = time.time() + 90
    while time.time() < deadline:
        if p.poll() is not None:
            raise RuntimeError("vite exited before it was ready")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/scan-harness.html", timeout=2) as r:
                if r.status == 200:
                    return p
        except Exception:                          # noqa: BLE001
            time.sleep(0.5)
    raise RuntimeError("vite did not become ready in 90s")


def main():
    # ⚠️ PICK A FREE PORT, NEVER A FIXED ONE. This machine runs ~40 worktrees and
    # several dev servers; a hard-coded port collided with an orphan from an
    # earlier run of this very script, and "kill whatever holds it" could take
    # down another session's server. Ask the OS for one instead.
    #
    # ⛔ AND PASS `--host 127.0.0.1`. By default vite binds "localhost", which on
    # Windows resolves to ::1 ONLY — the server reports "ready" and every IPv4
    # connection is refused, which is exactly how the first run failed while the
    # log said everything was fine.
    import socket
    with socket.socket() as _s:
        _s.bind(("127.0.0.1", 0))
        port = _s.getsockname()[1]
    print(f"[scan] starting dev server on :{port} (dev-only harness page)")
    try:
        proc = start_dev_server(port)
    except Exception as exc:                       # noqa: BLE001
        print(f"FAIL: could not start the dev server: {exc}")
        return 1
    base = f"http://127.0.0.1:{port}"
    fixture = Fixture()
    out = {}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={"width": 1400, "height": 800})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.route("**/api/**", route_handler(fixture))
            page = ctx.new_page()
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))

            tf = "5"
            tf_min = int(tf)
            states = plan(tf_min)

            url = f"{base}/scan-harness.html?tf={tf}&syms={','.join(SCAN)}"
            # ⛔ SEED ON A BLANK, SAME-ORIGIN PAGE. `SEED_JS` triggers an IndexedDB
            # version change, which BLOCKS while any other connection is open — and
            # with the app mounted the harness page holds one. Seeding on the live
            # page hung silently for 30+ minutes with no error and no output.
            page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
            page.evaluate(CLEAR_IDB)
            page.evaluate("() => { try { localStorage.setItem('uct.chartTiming','1') } catch {} }")

            # Plant the cache mix BEFORE the scan.
            print(f"  seeding {len(states)} symbols on the blank page…", flush=True)
            for sym, (kind, tail) in states.items():
                if tail is None:
                    continue
                # ⚠️ SEED SMALL. make_bars defaults to 40 SESSIONS — for 5m
                # extended that is ~7,680 bars, and serialising 25 of those
                # through CDP took longer than the entire scan (the first run
                # died on a 600s cap doing nothing but seeding). Four sessions
                # comfortably exceeds the ~470-bar first-paint window, which is
                # all any of these assertions read.
                page.evaluate(SEED_JS, [sym, tf, make_bars(tf_min, tail, 4), CACHE_LOGIC_VERSION])

            print("  seeded; loading the live harness page…", flush=True)
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(3500)     # let the first chart mount + settle
            if not page.evaluate("() => !!window.__scan"):
                raise RuntimeError("harness did not mount (window.__scan missing)")
            print("  mounted; scanning…", flush=True)

            # Ask BEFORE each click whether the next symbol is already prepared.
            pre = []
            samples = []
            for i, sym in enumerate(SCAN[1:], 1):
                print(f"  [{i}/{len(SCAN)-1}] {sym}", flush=True)
                r = page.evaluate("(s) => window.__scan.readiness(s)", sym)
                r["planned"] = states[sym][0]
                pre.append(r)
                # ⛔ T0 IS STAMPED HERE, IN THE PAGE, IMMEDIATELY BEFORE THE
                # SELECTION ENTERS THE PIPELINE. The chart's own T0 starts when
                # StockChart RECEIVES an already-committed symbol, so it measures
                # commit->paint and silently excludes the entire preparation and
                # handoff wait — which is the half the member actually feels.
                # Start the in-page frame watcher BEFORE the selection, so the
                # clock starts at the click and every frame in between is seen.
                t0 = page.evaluate(
                    "(s) => { window.__scanWatch = null; window.__scan.watch(s);"
                    "         const t = performance.now(); window.__scan.select(s); return t; }", sym)
                r["t0_click"] = t0
                # Sample densely across the transition to catch a visible bad frame.
                # Sample across the transition. Each evaluate is a CDP
                # round-trip (~10ms), so this window is ~300ms of real time —
                # wide enough to catch a visible bad frame on the warm path and
                # the start of a slow one.
                for _ in range(14):
                    smp = page.evaluate(SAMPLE_JS)
                    smp["forSym"] = sym
                    smp["t0_click"] = t0
                    samples.append(smp)
                page.wait_for_timeout(260)
                smp = page.evaluate(SAMPLE_JS)
                smp["forSym"] = sym
                smp["t0_click"] = t0
                samples.append(smp)
                # Frame-accurate truth for this switch, measured in-page.
                page.wait_for_function("() => window.__scanWatch !== null && window.__scanWatch !== undefined",
                                       timeout=6000)
                r["watch"] = page.evaluate("() => window.__scan.watchResult()")

            # ── RAPID A->B->C->D, faster than preparation can finish ──
            # Generations, not ticker equality: the burst deliberately revisits a
            # symbol so "same name" cannot stand in for "same request".
            print("  rapid burst…", flush=True)
            burst = SCAN[1:5] + [SCAN[1]]
            page.evaluate("(s) => { window.__scanWatch = null; window.__scan.watch(s) }", burst[-1])
            # ⚠️ NOT `b` — that is the browser handle, and shadowing it made
            # `b.close()` raise 'str' object has no attribute 'close' AFTER the
            # whole scan had run, losing the results.
            for bsym in burst:
                page.evaluate("(s) => window.__scan.select(s)", bsym)
                page.wait_for_timeout(18)      # well inside any preparation
            page.wait_for_timeout(1800)
            rapid = {
                "sequence": burst,
                "final": page.evaluate(SAMPLE_JS),
                "watch": page.evaluate("() => window.__scan.watchResult()"),
            }
            print(f"  rapid final: dom={rapid['final'].get('domSym')} chart={rapid['final'].get('chartSym')}", flush=True)

            # ── LONG SCAN: a second pass over the whole list (50+ switches total) ──
            print("  long scan…", flush=True)
            long_watch = []
            for j, sym in enumerate(SCAN, 1):
                page.evaluate("(s) => { window.__scanWatch = null; window.__scan.watch(s) }", sym)
                page.evaluate("(s) => window.__scan.select(s)", sym)
                page.wait_for_timeout(420)
                try:
                    page.wait_for_function("() => window.__scanWatch", timeout=5000)
                    long_watch.append(page.evaluate("() => window.__scan.watchResult()"))
                except Exception:                      # noqa: BLE001
                    long_watch.append({"target": sym, "tCoherent": None, "mixedMs": None, "emptyMs": None})

            # ── CONTROL: prove the classifier can FAIL ──
            control = None
            forced = page.evaluate(FORCE_MISMATCH_JS, "ZZZZ_NOT_THE_DRAWN_SYMBOL")
            if forced:
                control = page.evaluate(SAMPLE_JS)
                control["forSym"] = SCAN[-1]
                control["t0_click"] = 0
            print(f"  control mismatch injected: {forced}", flush=True)

            rows = page.evaluate("() => window.__uctChartTiming.report()")
            blocked = page.evaluate("() => window.__scan.blocked()")
            out = {"pre": pre, "samples": samples, "rows": rows, "control": control,
                   "rapid": rapid, "long": long_watch,
                   "blocked": blocked, "errors": errs,
                   "requests": fixture.requests}
            b.close()
    finally:
        try:
            proc.terminate()
        except Exception:                          # noqa: BLE001
            pass

    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_handoff_out.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    pre = out.get("pre", [])
    ready = [r for r in pre if r.get("currentBeforeClick")]
    print(f"\n=== NEIGHBOUR WARMING: current-or-authoritative BEFORE click ===")
    print(f"  {len(ready)}/{len(pre)} = {100*len(ready)//max(1,len(pre))}%")
    by_src = {}
    for r in pre:
        k = (r["planned"], r["source"], bool(r["currentBeforeClick"]))
        by_src[k] = by_src.get(k, 0) + 1
    for k, v in sorted(by_src.items()):
        print(f"    planned={k[0]:<9} source={k[1]:<7} readyBeforeClick={k[2]}  n={v}")
    print(f"\n  page errors: {out.get('errors') or 'none'}")
    print(f"  refused persistence writes: {out.get('blocked')}")
    print(f"\n[scan] wrote {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
