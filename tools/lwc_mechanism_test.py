"""WHICH LWC option produces the +1 drift on a new bar?

The camera audit proved the drift happens with ZERO explicit camera calls, so
the movement is implicit LWC behaviour on append. Two options can do that:

    shiftVisibleRangeOnNewBar
    rightBarStaysOnScroll

Both are set ONCE at chart creation (`shiftVisibleRangeOnNewBar: exactDateRange
? false : true`) and deliberately stripped from every later applyOptions pass,
because re-applying `rightOffset` re-scrolls the chart to the right edge. So
they keep their creation values for the life of the chart -- including after
the member takes ownership of the view.

⛔ THIS TEST MEASURES, IT DOES NOT INFER. The option names are suggestive and
the code comments already blame `shiftVisibleRangeOnNewBar` for a neighbouring
bug, but a name is not evidence. Each variant crosses a REAL 5m boundary with a
proven stimulus and reports the resulting drift.

Variants, all with the user owning the view:
    A  production defaults                    (expect drift 1 -- the repro)
    B  shiftVisibleRangeOnNewBar = false
    C  rightBarStaysOnScroll = false
    D  both false
    E  production defaults, user does NOT own (normal realtime-follow baseline)

Usage:  <venv>\\python.exe tools\\lwc_mechanism_test.py
"""
from __future__ import annotations

import json
import os
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

APP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
SYM, TF = "MU", "5"
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
    """⛔⛔ SIGN CONVENTION, MEASURED NOT ASSUMED. Dragging the mouse LEFT
    (negative dx) moves chart content left, which walks the view FORWARD in
    time. To pan BACK into history the mouse must travel RIGHT (positive dx).
    Every scenario here was originally written with negative dx under the name
    "pan left", so the view never left the RIGHT EDGE -- and a chart at the
    right edge following a new bar is correct behaviour, which is why the A/B
    was insensitive to ownership AND to both append options. Verified against
    the raw ranges: dx=-320 moved `from` 2922 -> 2939.56, i.e. forward."""
    el = page.query_selector("canvas")
    b = el.bounding_box() if el else None
    if not b:
        return False
    cx, cy = b["x"] + b["width"] * 0.6, b["y"] + b["height"] * 0.5
    page.mouse.move(cx, cy); page.mouse.down()
    for i in range(1, 9):
        page.mouse.move(cx + dx * i / 8, cy); page.wait_for_timeout(10)
    page.mouse.up(); page.wait_for_timeout(120)
    return True


def rng(page):
    return page.evaluate("() => window.__scan.range()")


def trng(page):
    """The MEMBER-VISIBLE camera: a time window. Logical indices shift when a
    capped series appends, so logical drift reports a phantom move."""
    return page.evaluate("() => window.__scan.timeRange()")


def rendered(page):
    return page.evaluate("() => window.__scan.rendered()")


def tick_for(page, fixture, n, ms=90):
    seen = []
    for k in range(n):
        page.evaluate("() => window.__scan.tick()")
        page.wait_for_timeout(ms)
        if k % 3 == 0:
            r = rendered(page)
            bar = (r or {}).get("bar") or {}
            if bar.get("close") is not None:
                seen.append((bar["time"], bar["close"]))
    return seen


def advance(page, fixture, seconds):
    """Browser clock and market data move together, or the freshness gate
    (correctly) refuses the now-behind series and the stimulus dies."""
    fixture.advance(seconds)
    page.evaluate("(ms) => window.__uctTestClockAdvance(ms)", seconds * 1000)


def run_variant(page, fixture, name, patch, own_view):
    page.evaluate("() => window.__scan.camera.clear()")
    if own_view:
        pan(page, 420)      # RIGHT = back in time, off the right edge
        owned = page.evaluate("() => window.__scan.camera.owned()")
    else:
        owned = page.evaluate("() => window.__scan.camera.owned()")
    if patch:
        page.evaluate("(p) => window.__scan.camera.tsOptions(p)", patch)
    eff = page.evaluate("() => { const o = window.__scan.camera.tsOptions(null) || {};"
                        " return { shift: o.shiftVisibleRangeOnNewBar, right: o.rightBarStaysOnScroll,"
                        "          rightOffset: o.rightOffset } }")
    page.wait_for_timeout(200)
    before = rng(page)
    tbefore = trng(page)
    r0full = rendered(page) or {}
    b0 = r0full.get("bar") or {}
    n0 = r0full.get("n")
    advance(page, fixture, 5 * 60)                 # cross a REAL 5m boundary
    seen = tick_for(page, fixture, 26)
    page.wait_for_timeout(500)
    after = rng(page)
    tafter = trng(page)
    r1full = rendered(page) or {}
    b1 = r1full.get("bar") or {}
    n1 = r1full.get("n")
    d = None if not (before and after) else round(max(abs(before["from"] - after["from"]),
                                                      abs(before["to"] - after["to"])), 3)
    td = None if not (tbefore and tafter) else max(abs(int(tbefore["from"]) - int(tafter["from"])),
                                                   abs(int(tbefore["to"]) - int(tafter["to"])))
    un = page.evaluate("() => window.__scan.camera.unauthorized()")
    # ⛔ ALL events, not just the flagged ones. "zero unauthorized" can mean
    # "no calls at all" (intrinsic library behaviour) or "calls that the
    # ownership probe or the moved-range filter excused" — and those demand
    # completely different fixes. I have only ever looked at the filtered view.
    allev = page.evaluate("() => window.__scan.camera.report()")
    rec = {
        "variant": name, "effectiveOptions": eff, "userOwned": owned,
        "drift": d, "timeDrift": td, "before": before, "after": after,
        "timeBefore": tbefore, "timeAfter": tafter,
        "distinctCloses": len({c for _t, c in seen}), "distinctTimes": len({t for t, _c in seen}),
        "barTime": [b0.get("time"), b1.get("time")],
        # ⛔ THE DISAMBIGUATOR. If the count GREW, logical index N still names
        # the same bar, so logical+1 means the CAMERA advanced. If the count is
        # unchanged (a capped window that dropped its oldest bar), the data slid
        # beneath a stationary camera and logical+1 is an artifact.
        "barCount": [n0, n1],
        "newBar": bool(b0.get("time") and b1.get("time") and b1["time"] > b0["time"]),
        "unauthorizedCalls": len(un),
        "allCameraCalls": [{"m": e["method"], "owned": e["userOwned"],
                            "from": (e.get("before") or {}).get("from"),
                            "to": (e.get("after") or {}).get("from"),
                            "at": e.get("at") or ""} for e in allev],
    }
    stim = rec["newBar"] and rec["distinctCloses"] >= 2
    rec["stimulusProven"] = stim
    print(f"  {name:<44} owned={str(owned):<5} shift={eff.get('shift')} "
          f"rightStays={eff.get('right')} newBar={rec['newBar']} "
          f"bars={n0}->{n1} logicalDrift={d} TIMEDRIFT={td}s "
          f"{'' if stim else '  <-- STIMULUS NOT PROVEN (INVALID)'}", flush=True)
    return rec


def main():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    print(f"[mech] dev server on :{port}", flush=True)
    proc = start_dev(port)
    fixture = Fixture()
    out = []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            ctx = b.new_context(viewport={"width": 1400, "height": 860})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.route("**/api/**", route_handler(fixture))
            page = ctx.new_page()
            base = f"http://127.0.0.1:{port}"
            page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
            page.evaluate(CLEAR_IDB)
            page.evaluate("() => { localStorage.setItem('uct.chartTiming','1');"
                          " localStorage.setItem('uct.cameraAudit','1') }")
            page.evaluate(SEED_JS, [SYM, TF, make_bars(int(TF), FAKE_NOW, 4), CACHE_LOGIC_VERSION])
            page.goto(f"{base}/scan-harness.html?tf={TF}&syms={SYM}", wait_until="domcontentloaded")
            page.wait_for_timeout(4200)

            print("[mech] variants (each crosses a REAL 5m boundary):", flush=True)
            out.append(run_variant(page, fixture, "E baseline: NOT user-owned, prod defaults",
                                   None, own_view=False))
            out.append(run_variant(page, fixture, "A prod defaults, user-owned (the repro)",
                                   None, own_view=True))
            out.append(run_variant(page, fixture, "B shiftVisibleRangeOnNewBar=false",
                                   {"shiftVisibleRangeOnNewBar": False}, own_view=True))
            out.append(run_variant(page, fixture, "C rightBarStaysOnScroll=false",
                                   {"shiftVisibleRangeOnNewBar": True,
                                    "rightBarStaysOnScroll": False}, own_view=True))
            out.append(run_variant(page, fixture, "D both false",
                                   {"shiftVisibleRangeOnNewBar": False,
                                    "rightBarStaysOnScroll": False}, own_view=True))
            # `rightOffset` keeps N bars of padding AFTER the last bar. If LWC
            # maintains that as a live constraint, every append must slide the
            # window to preserve it -- which would produce exactly +1 bar,
            # insensitive to the two options above and to ownership.
            out.append(run_variant(page, fixture, "F rightOffset=0",
                                   {"rightOffset": 0}, own_view=True))
            out.append(run_variant(page, fixture, "G all three neutralised",
                                   {"rightOffset": 0, "shiftVisibleRangeOnNewBar": False,
                                    "rightBarStaysOnScroll": False}, own_view=True))
            b.close()
    finally:
        try: proc.terminate()
        except Exception: pass                              # noqa: BLE001

    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lwc_mechanism_out.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"\n[mech] wrote {dst}")
    invalid = [r for r in out if not r["stimulusProven"]]
    if invalid:
        print(f"!! {len(invalid)} variant(s) had no proven stimulus -- those rows prove nothing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
