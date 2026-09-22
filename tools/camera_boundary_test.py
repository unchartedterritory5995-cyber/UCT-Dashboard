"""FOUR BOUNDARIES, CUMULATIVE DRIFT ZERO.

⛔⛔ THE SYMPTOM IS ACCUMULATION, NOT A JUMP. The owner's report is that a
fast-moving chart creeps back toward the right AFTER they pan -- which a
single-boundary test can register as "+1 bar, barely visible" and wave through.
The retired bars-from-right remap moved a user-owned view forward by exactly one
bar PER APPENDED CANDLE, so the product failure only becomes obvious over
several boundaries. This harness crosses at least four and requires the
CUMULATIVE visible-time drift to be zero.

⛔ AND IT MEASURES THE MEMBER'S CAMERA, WHICH IS A TIME WINDOW. Logical indices
shift underneath a stationary camera whenever a capped series rolls, so logical
drift reports phantom movement. `timeDrift` is the acceptance number;
`logicalDrift` is recorded only to characterise the fractional offset (§6): a
STABLE fraction across all four boundaries is a representation detail, an
ACCUMULATING one means the fix did not take.

⭐ NOTHING HERE IS TRUSTED UNTIL THE AUDIT HAS BEEN SHOWN TO FAIL. Preflight
runs three negative controls, including `shiftOne` -- a +1 setVisibleLogicalRange
that reproduces the EXACT shape of the production defect. The previous two
controls (scrollToRealTime, fitContent) both passed while `unauthorizedMoves()`
was blind to the real causal call, which is precisely why a control has to match
the failure it guards rather than a convenient neighbour of it.

Usage:  <venv>\\python.exe tools\\camera_boundary_test.py
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from intraday_tail_harness import (   # noqa: E402
    CLOCK_JS, FAKE_NOW, Fixture, SEED_JS, CACHE_LOGIC_VERSION, make_bars, route_handler,
)
from stimulus import require, verdict, summarize, render, StimulusError, INVALID  # noqa: E402

APP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
SYM, TF = "MU", "5"
# ⚠️ THE RTH SESSION IS THE BUDGET. The fixture starts at 13:17 ET and the
# client filters to RTH, so there are 163 minutes of appendable bars before the
# 16:00 close -- shared across every scenario on the single monotonic clock.
# 7 scenarios x 4 boundaries x 5m = 140 minutes, which fits; a fifth boundary
# would run scenarios 6 and 7 past the close, where nothing appends and the run
# reports INVALID for a reason that has nothing to do with the product.
BOUNDARIES = 4
# ⭐ A DISCRIMINATING CONTROL, NOT A GUESS. The last scenario in the run stalled
# -- two boundaries appended nothing -- and "the last scenario" and "the scenario
# furthest along the shared market clock" are the same row, so the trace cannot
# say whether the cause is that scenario or the accumulated session budget.
# Running the list backwards separates them: if the stall follows POSITION it is
# the harness's clock budget, if it follows the SCENARIO it is the product.
REVERSED = "--reverse" in sys.argv
CLEAR_IDB = ("() => new Promise(res => { const r = indexedDB.deleteDatabase('uct_bars_v1'); "
             "r.onsuccess = r.onerror = r.onblocked = () => res(true) })")


def start_dev(port):
    p = subprocess.Popen(["npx", "vite", "--port", str(port), "--strictPort", "--host", "127.0.0.1"],
                         cwd=APP, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         shell=(os.name == "nt"), text=True)
    end = time.time() + 120
    while time.time() < end:
        if p.poll() is not None:
            raise RuntimeError("vite exited")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/scan-harness.html", timeout=2) as r:
                if r.status == 200:
                    return p
        except Exception:                                   # noqa: BLE001
            time.sleep(0.5)
    raise RuntimeError("vite not ready")


def pan(page, dx):
    """POSITIVE dx = mouse travels RIGHT = the view walks BACK in time.

    ⛔ Measured, not assumed, and it cost a whole invalidated run to learn: every
    scenario originally used negative dx under the name "pan left", which walks
    the view FORWARD and parks it at the right edge -- where following a new bar
    is CORRECT behaviour. Eight "clean" scenarios and one "reproduced" verdict
    were all measuring a chart that had never left the right edge."""
    el = page.query_selector("canvas")
    b = el.bounding_box() if el else None
    if not b:
        return False
    cx, cy = b["x"] + b["width"] * 0.6, b["y"] + b["height"] * 0.5
    page.mouse.move(cx, cy); page.mouse.down()
    for i in range(1, 9):
        page.mouse.move(cx + dx * i / 8, cy); page.wait_for_timeout(10)
    page.mouse.up(); page.wait_for_timeout(150)
    return True


def zoom(page, clicks):
    el = page.query_selector("canvas")
    b = el.bounding_box() if el else None
    if not b:
        return False
    page.mouse.move(b["x"] + b["width"] * 0.5, b["y"] + b["height"] * 0.5)
    for _ in range(abs(clicks)):
        page.mouse.wheel(0, -120 if clicks > 0 else 120)
        page.wait_for_timeout(40)
    page.wait_for_timeout(150)
    return True


def snap(page):
    """Everything needed to judge one boundary, captured in one round trip."""
    return page.evaluate("""() => {
      const s = window.__scan
      const r = s.rendered() || {}
      const o = s.camera.tsOptions(null) || {}
      return {
        time: s.timeRange(), logical: s.range(),
        n: r.n, lastBar: (r.bar || {}).time, lastClose: (r.bar || {}).close,
        rightOffset: o.rightOffset, barSpacing: o.barSpacing,
        owned: s.camera.owned(),
      }
    }""")


def advance(page, holder, seconds):
    """Both clocks move together, or the freshness gate (correctly) refuses the
    now-behind series and the stimulus dies silently."""
    holder["f"].advance(seconds)
    holder["elapsed"] += seconds
    page.evaluate("(ms) => window.__uctTestClockAdvance(ms)", seconds * 1000)


def tick(page, n=26, ms=90):
    """90ms, not 25ms: livePriceStore._poll holds an `_inflight` latch that turns
    a faster caller into `_pollAgain` and returns, producing LESS stimulus."""
    seen = []
    for k in range(n):
        page.evaluate("() => window.__scan.tick()")
        page.wait_for_timeout(ms)
        if k % 3 == 0:
            r = page.evaluate("() => window.__scan.rendered()") or {}
            bar = r.get("bar") or {}
            if bar.get("close") is not None:
                seen.append((bar["time"], bar["close"]))
    return seen


def tdrift(a, b):
    if not a or not b:
        return None
    return max(abs(int(a["from"]) - int(b["from"])), abs(int(a["to"]) - int(b["to"])))


def ldrift(a, b):
    if not a or not b:
        return None
    return round(max(abs(a["from"] - b["from"]), abs(a["to"] - b["to"])), 4)


# ── PREFLIGHT ────────────────────────────────────────────────────────────────

def preflight(page, holder):
    """No scenario result means anything until each of these has been shown."""
    out = []

    def check(name, ok, evidence):
        out.append({"check": name, "ok": bool(ok), "evidence": evidence})
        print(f"  [{'OK ' if ok else 'XX '}] {name}: {evidence}", flush=True)
        return bool(ok)

    ok_all = True
    ok_all &= check("audit is armed", page.evaluate("() => window.__scan.camera.enabled()"), "flag read")

    page.evaluate("() => window.__scan.camera.clear()")
    before_owned = page.evaluate("() => window.__scan.camera.owned()")
    pan(page, 420)
    after_owned = page.evaluate("() => window.__scan.camera.owned()")
    ok_all &= check("A ownership latches on a real drag",
                    (not before_owned) and after_owned, f"{before_owned} -> {after_owned}")

    # ⛔ THE THREE NEGATIVE CONTROLS. `shiftOne` is the one that matters: it is
    # the exact shape of the production defect, and the other two were passing
    # while the filter was blind to it.
    for kind, label in (("scrollToRealTime", "B1"), ("fitContent", "B2"), ("shiftOne", "B3")):
        page.evaluate("() => window.__scan.camera.clear()")
        res = page.evaluate("(k) => window.__scan.forceIllegalMove(k)", kind)
        page.wait_for_timeout(400)
        flagged = page.evaluate("() => window.__scan.camera.unauthorized()")
        raw = page.evaluate("() => window.__scan.camera.report()")
        ok_all &= check(f"{label} audit DETECTS a forced {kind}",
                        res == "invoked" and len(flagged) >= 1,
                        f"invoke={res} flagged={len(flagged)} recorded={len(raw)}")

    # C: a current-bar mutation reaches the RENDERED series, not just the store.
    page.evaluate("() => window.__scan.camera.clear()")
    b0 = snap(page)
    seen = tick(page, 8)
    b1 = snap(page)
    ok_all &= check("C current-bar updates reach the rendered series",
                    len({c for _t, c in seen}) >= 2 and b0["lastClose"] != b1["lastClose"],
                    f"closes={sorted({c for _t, c in seen})[:4]} {b0['lastClose']} -> {b1['lastClose']}")

    # D: a boundary crossing really appends a bar.
    n0, t0 = b1["n"], b1["lastBar"]
    advance(page, holder, 5 * 60)
    tick(page, 20)
    b2 = snap(page)
    ok_all &= check("D a 5m boundary APPENDS a bar",
                    b2["n"] > n0 and b2["lastBar"] > t0,
                    f"bars {n0}->{b2['n']}  lastBar {t0}->{b2['lastBar']}")

    # E: observability -- a clean run must be distinguishable from a dead one.
    ok_all &= check("E camera observability returns structured events",
                    isinstance(page.evaluate("() => window.__scan.camera.report()"), list)
                    and b2["time"] is not None and b2["logical"] is not None,
                    f"time={bool(b2['time'])} logical={bool(b2['logical'])}")
    return ok_all, out


# ── SCENARIOS ────────────────────────────────────────────────────────────────

# ⛔ THE UNOWNED CHART HAS A DIFFERENT CONTRACT, AND CONFLATING THEM HID A
# REGRESSION. "The camera must not move" is the OWNED invariant. An untouched
# chart is a live tape: it must FOLLOW, keeping the newest candle in the same
# screen slot. Demanding zero drift from it passed a build whose right pad was
# walking 4.05 -> 0.05, i.e. a chart nobody had touched that was two boundaries
# from pushing the current candle off screen.
HOLD, FOLLOW = "hold", "follow"

SCENARIOS = [
    # (name, setup, expected ownership after setup, expected camera contract)
    ("unowned: default realtime follow", None, False, FOLLOW),
    ("owned: slight pan back", lambda p: pan(p, 200), True, HOLD),
    ("owned: moderate pan back", lambda p: pan(p, 480), True, HOLD),
    ("owned: deep pan back", lambda p: (pan(p, 700), pan(p, 700)), True, HOLD),
    ("owned: panned + zoomed IN", lambda p: (pan(p, 380), zoom(p, 5)), True, HOLD),
    ("owned: panned + zoomed OUT", lambda p: (pan(p, 380), zoom(p, -5)), True, HOLD),
    # ⭐ THE OWNER'S ACTUAL REPORT was a fast-moving name. The price ladder drifts
    # every tick regardless, so this is the same stimulus at a bigger step; it
    # exists to show the invariant does not depend on a quiet tape.
    ("owned: fast-news replay", lambda p: (pan(p, 480), zoom(p, 2)), True, HOLD),
]

_FRAME = re.compile(r"StockChart\.jsx:(\d+):")


def fetch_source(base):
    """⚠️ VITE TRANSFORMS SHIFT LINE NUMBERS. A stack frame reading
    `StockChart.jsx:7998` names a line in the SERVED module, not in the file on
    disk, and chasing the on-disk line led straight to unrelated code once
    already. Fetch what the browser actually ran and resolve against that."""
    try:
        with urllib.request.urlopen(f"{base}/src/components/StockChart.jsx", timeout=20) as r:
            return r.read().decode("utf-8", "replace").splitlines()
    except Exception:                                       # noqa: BLE001
        return []


def resolve(at, src):
    """Turn a stack string into the source lines the browser actually executed."""
    outs = []
    for m in _FRAME.finditer(at or ""):
        ln = int(m.group(1))
        if 0 < ln <= len(src):
            outs.append(f"{ln}: {src[ln - 1].strip()[:110]}")
    return outs[:3]


def cross_boundaries(page, holder, name, setup, expect_owned, contract, src, n=BOUNDARIES):
    """Cross `n` consecutive 5m boundaries, proving the stimulus at each one."""
    fixture = holder["f"]
    # ⛔⛔ A RELOAD RESETS THE BROWSER CLOCK, THE MARKET CLOCK MUST NOT FOLLOW IT
    # BACKWARDS. Handing each scenario a fresh Fixture rewound market time to
    # FAKE_NOW while IndexedDB still held the later bars from the previous
    # scenario, and every boundary in all seven scenarios then appended nothing
    # -- seven INVALIDs, which is the harness working, but measuring nothing.
    # One monotonic market clock; the page is re-synced up to it after each load.
    page.evaluate("(ms) => window.__uctTestClockAdvance(ms)", holder["elapsed"] * 1000)
    # ⛔ THE BASELINE MUST BE TAKEN ON A SETTLED SERIES. A freshly loaded chart
    # paints the IndexedDB series first and swaps in the network one a moment
    # later; a baseline captured in between belongs to a dataset the rest of the
    # scenario never sees, and boundary 1 then reports a drift (1800s) that is
    # the swap, not the product. Wait for the bar count AND the newest bar to
    # hold still. Ticks only -- this must not spend session budget.
    settled, last = False, None
    for _ in range(14):
        tick(page, 2)
        cur = snap(page)
        key = (cur["n"], cur["lastBar"])
        if last == key:
            settled = True
            break
        last = key
    page.evaluate("() => window.__scan.camera.clear()")
    if setup:
        setup(page)
    page.wait_for_timeout(250)
    base = snap(page)
    rows, prev = [], base
    stim_ok = True
    rec_settled = settled
    for k in range(1, n + 1):
        advance(page, holder, 5 * 60)
        seen = tick(page, 24)
        page.wait_for_timeout(400)
        cur = snap(page)
        proven = (cur["n"] > prev["n"] and cur["lastBar"] > prev["lastBar"]
                  and len({c for _t, c in seen}) >= 2)
        stim_ok &= proven
        rows.append({
            "boundary": k, "stimulusProven": proven,
            "bars": [prev["n"], cur["n"]], "lastBar": [prev["lastBar"], cur["lastBar"]],
            "distinctCloses": len({c for _t, c in seen}),
            "stepTimeDrift": tdrift(prev["time"], cur["time"]),
            "cumTimeDrift": tdrift(base["time"], cur["time"]),
            "cumLogicalDrift": ldrift(base["logical"], cur["logical"]),
            "logicalFrom": round(cur["logical"]["from"], 4) if cur["logical"] else None,
            # §6: the fractional part of the left edge, normalised into [0,1) so a
            # negative `from` -- a view parked left of bar 0, which is legal and was
            # the case being slammed to zero -- reports a comparable fraction.
            "logicalFrac": round(((cur["logical"]["from"] % 1) + 1) % 1, 4) if cur["logical"] else None,
            "rightOffset": cur["rightOffset"], "barSpacing": round(cur["barSpacing"] or 0, 3),
            # The right-pad contract: empty bar slots between the newest bar and
            # the right edge, meaningful for a chart actually AT the right edge.
            "rightPad": round(cur["logical"]["to"] - (cur["n"] - 1), 3) if cur["logical"] and cur["n"] else None,
            "owned": cur["owned"],
        })
        prev = cur
    final = rows[-1]
    unauth = page.evaluate("() => window.__scan.camera.unauthorized()")
    rec = {
        "scenario": name, "baseOwned": base["owned"], "expectedOwned": expect_owned,
        "baseTime": base["time"], "finalTime": prev["time"],
        "baseLogical": base["logical"], "finalLogical": prev["logical"],
        "baseRightPad": round(base["logical"]["to"] - (base["n"] - 1), 3) if base["logical"] and base["n"] else None,
        "cumulativeTimeDrift": final["cumTimeDrift"],
        "perBoundaryTimeDrift": [r["stepTimeDrift"] for r in rows],
        "cumulativeLogicalDrift": final["cumLogicalDrift"],
        "logicalFracSeries": [r["logicalFrac"] for r in rows],
        "cameraCalls": len(unauth),
        "cameraCallDetail": [{"m": e["method"], "src": resolve(e.get("at"), src),
                              "before": e.get("before"), "after": e.get("after")}
                             for e in unauth[:4]],
        "boundaries": rows,
    }
    try:
        # ⛔ THE SETUP IS ITSELF A STIMULUS. A scenario named "owned" that never
        # latched ownership is testing the unowned path under the wrong label --
        # which is exactly what a shared page produced on the first run.
        require(f"{name}: the series settled before the baseline was taken",
                rec_settled, f"stable(n,lastBar)={last}")
        require(f"{name}: ownership state is as the scenario claims",
                base["owned"] == expect_owned, f"expected {expect_owned}, got {base['owned']}")
        require(f"{name}: every boundary appended a bar with live closes",
                stim_ok, [{"b": r["boundary"], "bars": r["bars"], "closes": r["distinctCloses"]} for r in rows])
    except StimulusError as e:
        rec["verdict"] = INVALID
        rec["why"] = str(e)
        print(f"  {name:<40} INVALID -- {e}", flush=True)
        return rec

    # ⛔ EVERY BOUNDARY, NOT JUST THE SUM. A cumulative zero can hide a +1 that a
    # later -1 cancelled, and the member saw both.
    if contract == FOLLOW:
        # The tape advances by exactly the bars it appended, and the newest
        # candle holds its screen slot -- the pad is the thing that must not move.
        pads = [r["rightPad"] for r in rows]
        per_ok = (all(abs(p - rec["baseRightPad"]) < 0.01 for p in pads)
                  and all(r["stepTimeDrift"] in (300, 0) for r in rows))
        rec["contractEvidence"] = {"basePad": rec["baseRightPad"], "pads": pads}
    else:
        per_ok = all(r["stepTimeDrift"] == 0 for r in rows)
        rec["contractEvidence"] = {"perBoundaryTimeDrift": rec["perBoundaryTimeDrift"]}
    # A recorded camera call whose boundary drift is zero is the remap RESTORING a
    # shift LWC applied inside the same commit. It is reported either way, with
    # its resolved source line, but it only fails the scenario if the member's
    # window actually moved -- the commit, not the call, is what a member sees.
    rec["contract"] = contract
    rec["verdict"] = verdict(True, per_ok if contract == FOLLOW
                             else (per_ok and final["cumTimeDrift"] == 0))
    print(f"  {name:<40} {rec['verdict']:<7} cumTimeDrift={final['cumTimeDrift']}s "
          f"perBoundary={rec['perBoundaryTimeDrift']} pads={[r['rightPad'] for r in rows]} "
          f"frac={rec['logicalFracSeries']} camCalls={len(unauth)}", flush=True)
    return rec


def main():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    print(f"[bnd] dev server on :{port}", flush=True)
    proc = start_dev(port)
    fixture = Fixture()
    results, pre, console_errors = [], [], []
    pre_ok = False
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1400, "height": 860})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            # ⛔ ONE ROUTE, A SWAPPABLE FIXTURE. Each scenario needs a FRESH
            # market clock: scenario 6 ran the fixture past the session close and
            # its last boundary appended nothing -- correctly INVALID, but caused
            # by the harness rather than the product.
            holder = {"f": fixture, "elapsed": 0}
            ctx.route("**/api/**", lambda route, request: route_handler(holder["f"])(route, request))
            page = ctx.new_page()
            # ⛔ A STALLED SCENARIO LOOKS EXACTLY LIKE A CALM ONE. Scenario 7's
            # last two boundaries appended nothing and its live closes collapsed
            # to a single value; without the console there is no way to tell a
            # thrown error from a quiet fixture.
            errors = []
            page.on("console", lambda m: errors.append(f"{m.type}: {m.text[:160]}")
                    if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {str(e)[:200]}"))
            base = f"http://127.0.0.1:{port}"
            page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
            page.evaluate(CLEAR_IDB)
            page.evaluate("() => { localStorage.setItem('uct.chartTiming','1');"
                          " localStorage.setItem('uct.cameraAudit','1') }")
            page.evaluate(SEED_JS, [SYM, TF, make_bars(int(TF), FAKE_NOW, 4), CACHE_LOGIC_VERSION])
            page.goto(f"{base}/scan-harness.html?tf={TF}&syms={SYM}", wait_until="domcontentloaded")
            page.wait_for_timeout(4200)

            print("[bnd] PREFLIGHT -- prove the instrument before trusting a result:", flush=True)
            pre_ok, pre = preflight(page, holder)
            if not pre_ok:
                print("!! PREFLIGHT FAILED -- no scenario below may be believed.", flush=True)

            print("", flush=True)
            print(f"[bnd] SCENARIOS -- {BOUNDARIES} consecutive 5m boundaries each,"
                  " on a FRESH page + FRESH market clock:", flush=True)
            src = fetch_source(base)
            order = list(reversed(SCENARIOS)) if REVERSED else list(SCENARIOS)
            for name, setup, expect_owned, contract in order:
                # ⛔⛔ FULL ISOLATION PER SCENARIO, ARRIVED AT BY CONTROL RATHER
                # THAN BY GUESSING. Three separate leaks were measured here:
                #   · ownership leaked -- the scenario labelled "unowned" reported
                #     baseOwned=True because preflight's drag had latched
                #     `userViewMovedRef` and nothing cleared it;
                #   · a per-scenario Fixture rewound market time while IndexedDB
                #     still held the LATER bars, so nothing appended anywhere;
                #   · one shared monotonic clock ran the LAST scenario out of
                #     session budget. Reversing the scenario order moved the stall
                #     with the POSITION, not with the scenario, which is what
                #     proved it was the harness and not the product.
                # So each scenario gets a fresh page, a fresh market clock AND a
                # re-seeded cache: identical start state, no accumulated budget.
                page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
                page.evaluate(CLEAR_IDB)
                page.evaluate("() => { localStorage.setItem('uct.chartTiming','1');"
                              " localStorage.setItem('uct.cameraAudit','1') }")
                page.evaluate(SEED_JS, [SYM, TF, make_bars(int(TF), FAKE_NOW, 4), CACHE_LOGIC_VERSION])
                holder["f"] = Fixture()
                holder["elapsed"] = 0
                page.goto(f"{base}/scan-harness.html?tf={TF}&syms={SYM}", wait_until="domcontentloaded")
                page.wait_for_timeout(4200)
                results.append(cross_boundaries(page, holder, name, setup, expect_owned, contract, src))
            # ── §14 OWNERSHIP MUST NOT LEAK ACROSS A SYMBOL SWITCH ──────────
            # ⛔ A latch that survived a switch would hand the NEXT ticker a
            # camera the member never touched: it would open scrolled back and
            # refuse to follow the tape. This is the same class of leak that
            # made six scenarios above report the wrong contract, so it gets its
            # own check rather than an assumption.
            print("", flush=True)
            print("[bnd] SYMBOL-SWITCH OWNERSHIP RESET:", flush=True)
            page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
            page.evaluate(CLEAR_IDB)
            page.evaluate("() => { localStorage.setItem('uct.chartTiming','1');"
                          " localStorage.setItem('uct.cameraAudit','1') }")
            for _s in ("MU", "MP"):
                page.evaluate(SEED_JS, [_s, TF, make_bars(int(TF), FAKE_NOW, 4), CACHE_LOGIC_VERSION])
            holder["f"] = Fixture(); holder["elapsed"] = 0
            page.goto(f"{base}/scan-harness.html?tf={TF}&syms=MU,MP", wait_until="domcontentloaded")
            page.wait_for_timeout(4200)
            own_before = page.evaluate("() => window.__scan.camera.owned()")
            pan(page, 520)
            own_after_pan = page.evaluate("() => window.__scan.camera.owned()")
            page.evaluate("() => window.__scan.select('MP')")
            page.wait_for_timeout(2600)
            own_after_switch = page.evaluate("() => window.__scan.camera.owned()")
            # And the new ticker must actually FOLLOW, not merely report unowned.
            pad0 = snap(page)
            advance(page, holder, 5 * 60)
            tick(page, 20)
            pad1 = snap(page)
            follows = (pad1["n"] > pad0["n"]
                       and abs((pad1["logical"]["to"] - (pad1["n"] - 1))
                               - (pad0["logical"]["to"] - (pad0["n"] - 1))) < 0.01)
            switch_ok = ((not own_before) and own_after_pan and (not own_after_switch) and follows)
            switch_rec = {
                "check": "ownership does not leak across a symbol switch",
                "ok": bool(switch_ok),
                "evidence": {"ownedBefore": own_before, "ownedAfterPan": own_after_pan,
                             "ownedAfterSwitch": own_after_switch,
                             "newSymbolFollows": follows,
                             "bars": [pad0["n"], pad1["n"]],
                             "pad": [round(pad0["logical"]["to"] - (pad0["n"] - 1), 3),
                                     round(pad1["logical"]["to"] - (pad1["n"] - 1), 3)]},
            }
            print(f"  [{'OK ' if switch_ok else 'XX '}] {switch_rec['check']}: {switch_rec['evidence']}",
                  flush=True)
            pre.append(switch_rec)
            pre_ok = pre_ok and switch_ok

            console_errors = list(errors)
            browser.close()
    finally:
        try: proc.terminate()
        except Exception: pass                              # noqa: BLE001

    summary = summarize(results)
    summary["preflightPassed"] = pre_ok
    summary["consoleErrors"] = console_errors[-25:]
    # ⛔ A GREEN MATRIX BEHIND A FAILED PREFLIGHT IS NOT AN ACCEPTANCE.
    summary["accepted"] = bool(summary["accepted"] and pre_ok)
    summary["order"] = "reversed" if REVERSED else "forward"
    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "camera_boundary_out_reversed.json" if REVERSED else "camera_boundary_out.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"preflight": pre, "summary": summary, "scenarios": results}, f, indent=2)
    print("\n" + render(summary, "camera boundary acceptance"))
    if not pre_ok:
        print("  !! preflight failed -- instrument unproven")
    print(f"[bnd] wrote {dst}")
    return 0 if summary["accepted"] else 1


if __name__ == "__main__":
    sys.exit(main())
