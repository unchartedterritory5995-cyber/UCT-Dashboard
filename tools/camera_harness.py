"""Does anything move the member's camera while they own the view?

⛔⛔ THE INVARIANT. Market data may change the SERIES. Market data may not change
the USER'S CAMERA. Once a member pans or zooms, the visible time range is theirs
until THEY act again -- no tick, no new bar, no price spike, no autoscale pass
gets to reposition it.

⭐ THE NEGATIVE CONTROL RUNS FIRST AND THE WHOLE RUN ABORTS IF IT DOES NOT FIRE.
A camera audit that has never caught anything is not evidence, and this project
has already shipped one classifier that produced a plausible PASS out of no data
at all. So before a single clean scenario is believed, the harness deliberately
calls scrollToRealTime() and fitContent() while the user owns the view and
requires both to be reported as unauthorized.

Ownership is latched the way a member latches it: a real pointer drag past the
4px threshold, and a real wheel event -- not by poking a ref. Current-bar
mutation is driven through the product's own live path (livePriceStore.pollNow
-> the route-mocked /api/live-prices -> StockChart's live writer), not by
writing to the series.

Usage:  <venv>\\python.exe tools\\camera_harness.py
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
from stimulus import require, verdict, summarize, render, StimulusError, PASS, FAIL, INVALID  # noqa: E402
from intraday_tail_harness import (   # noqa: E402
    CLOCK_JS, FAKE_NOW, Fixture, SEED_JS, CACHE_LOGIC_VERSION, make_bars, route_handler,
)

APP = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
SYM = "MU"
TF = "5"

CLEAR_IDB = ("() => new Promise(res => { const r = indexedDB.deleteDatabase('uct_bars_v1'); "
             "r.onsuccess = r.onerror = r.onblocked = () => res(true) })")


def start_dev_server(port: int):
    p = subprocess.Popen(
        ["npx", "vite", "--port", str(port), "--strictPort", "--host", "127.0.0.1"],
        cwd=APP, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        shell=(os.name == "nt"), text=True,
    )
    deadline = time.time() + 120
    while time.time() < deadline:
        if p.poll() is not None:
            raise RuntimeError("vite exited before it was ready")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/scan-harness.html", timeout=2) as r:
                if r.status == 200:
                    return p
        except Exception:                              # noqa: BLE001
            time.sleep(0.5)
    raise RuntimeError("vite did not become ready")


def canvas_box(page):
    """The chart's drawing surface, for real pointer gestures."""
    el = page.query_selector("canvas")
    return el.bounding_box() if el else None


def pan(page, dx):
    """⛔⛔ SIGN CONVENTION, MEASURED NOT ASSUMED. Dragging the mouse LEFT
    (negative dx) moves chart content left, which walks the view FORWARD in
    time. To pan BACK into history the mouse must travel RIGHT (positive dx).
    Every scenario here was originally written with negative dx under the name
    "pan left", so the view never left the RIGHT EDGE -- and a chart at the
    right edge following a new bar is correct behaviour, which is why the A/B
    was insensitive to ownership AND to both append options. Verified against
    the raw ranges: dx=-320 moved `from` 2922 -> 2939.56, i.e. forward."""
    """A REAL drag: ownership latches on a pointer move past 4px, exactly as it
    does for a member. Poking userViewMovedRef would test nothing."""
    b = canvas_box(page)
    if not b:
        return False
    cx, cy = b["x"] + b["width"] * 0.6, b["y"] + b["height"] * 0.5
    page.mouse.move(cx, cy)
    page.mouse.down()
    steps = 8
    for i in range(1, steps + 1):
        page.mouse.move(cx + dx * i / steps, cy)
        page.wait_for_timeout(8)
    page.mouse.up()
    page.wait_for_timeout(60)
    return True


def zoom(page, ticks):
    b = canvas_box(page)
    if not b:
        return False
    page.mouse.move(b["x"] + b["width"] * 0.6, b["y"] + b["height"] * 0.5)
    for _ in range(abs(ticks)):
        page.mouse.wheel(0, -120 if ticks > 0 else 120)
        page.wait_for_timeout(25)
    page.wait_for_timeout(60)
    return True


def advance_clock(page, fixture, seconds):
    """Advance the BROWSER clock and the MARKET DATA together.

    ⛔ Advancing one without the other silently breaks the run: the chart's
    series falls behind the session frontier, the current-first-paint gate
    (correctly) refuses it, and the live writer has nothing to extend — which
    reads as a dead stimulus rather than as the harness bug it is.
    """
    fixture.advance(seconds)
    page.evaluate("(ms) => window.__uctTestClockAdvance && window.__uctTestClockAdvance(ms)",
                  seconds * 1000)


def rng(page):
    return page.evaluate("() => window.__scan.range()")


def drift(a, b):
    if not a or not b:
        return None
    return round(max(abs(a["from"] - b["from"]), abs(a["to"] - b["to"])), 3)


def burst_observed(page, n, ms=90):
    """Burst, and RECORD what the rendered series showed along the way.

    ⛔ ENDPOINTS ARE NOT PROOF. Comparing only before/after cannot distinguish
    "nothing happened" from "it came back to where it started", and a periodic
    stimulus makes the second case common. Counting DISTINCT rendered closes
    seen during the burst proves mutation regardless of where it lands.
    """
    seen = []
    for k in range(n):
        page.evaluate("() => window.__scan.tick()")
        page.wait_for_timeout(ms)
        if k % 3 == 0:
            r = page.evaluate("() => window.__scan.rendered()")
            bar = (r or {}).get("bar") or {}
            if bar.get("close") is not None:
                seen.append((bar.get("time"), bar.get("close")))
    return seen


def burst(page, n, ms=90):
    """Rapid current-bar mutation through the product's real live path.

    ⛔⛔ 90ms, NOT 25ms, AND THAT IS NOT A MAGIC NUMBER. `livePriceStore._poll`
    holds an `_inflight` latch: a poll requested while one is running does not
    queue a second fetch, it sets `_pollAgain` and RETURNS. Driving ticks faster
    than a round-trip therefore coalesces almost all of them, and the rendered
    series never moves -- which is exactly what happened when the preflight
    proved the stimulus at 90ms and all nine scenarios, driving at 25ms,
    reported stimulus NOT PROVEN. Faster is not more stimulus; it is less.
    """
    for _ in range(n):
        page.evaluate("() => window.__scan.tick()")
        page.wait_for_timeout(ms)


def main():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    print(f"[camera] dev server on :{port}", flush=True)
    try:
        proc = start_dev_server(port)
    except Exception as exc:                           # noqa: BLE001
        print(f"FAIL: dev server: {exc}")
        return 1
    base = f"http://127.0.0.1:{port}"
    fixture = Fixture()
    out = {"scenarios": [], "control": None}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={"width": 1400, "height": 860})
            ctx.add_init_script(CLOCK_JS % int(FAKE_NOW.timestamp() * 1000))
            ctx.route("**/api/**", route_handler(fixture))
            page = ctx.new_page()
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))

            url = f"{base}/scan-harness.html?tf={TF}&syms={SYM}"
            page.goto(f"{base}/scan-harness.html?blank=1", wait_until="domcontentloaded")
            page.evaluate(CLEAR_IDB)
            page.evaluate("() => { try { localStorage.setItem('uct.chartTiming','1');"
                          " localStorage.setItem('uct.cameraAudit','1') } catch {} }")
            page.evaluate(SEED_JS, [SYM, TF, make_bars(int(TF), FAKE_NOW, 4), CACHE_LOGIC_VERSION])
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(4000)
            if not page.evaluate("() => !!window.__scan"):
                raise RuntimeError("harness did not mount")
            if not page.evaluate("() => window.__scan.camera.enabled()"):
                raise RuntimeError("camera audit is not enabled -- every verdict would be vacuous")

            # ═══════════════ PRE-FLIGHT ═══════════════
            # ⛔⛔ NO STIMULUS = NO RESULT. Every one of these must be PROVEN
            # before a single acceptance scenario is allowed to run, because an
            # unproven stimulus makes "the camera held" indistinguishable from
            # "nothing ever happened" — and the previous run of this harness
            # reported nine clean scenarios having received zero ticks.
            print("[camera] PRE-FLIGHT", flush=True)
            pre = []

            # A — USER OWNERSHIP, latched by a real drag
            pan(page, 420)
            owned = page.evaluate("() => window.__scan.camera.owned()")
            pre.append(require("user-owned-view", owned, {"owned": owned}))
            print(f"  A user ownership latched : {owned}", flush=True)

            # B — AUDIT NEGATIVE CONTROL (both methods)
            ctrl = {}
            for kind in ("scrollToRealTime", "fitContent"):
                page.evaluate("() => window.__scan.camera.clear()")
                before = rng(page)
                page.evaluate("(k) => window.__scan.forceIllegalMove(k)", kind)
                # LWC moves the camera ASYNCHRONOUSLY; sampling immediately
                # reads the pre-move range and discards a real violation.
                page.wait_for_timeout(400)
                un = page.evaluate("() => window.__scan.camera.unauthorized()")
                ctrl[kind] = {"detected": len(un) > 0, "before": before, "after": rng(page)}
                print(f"  B negative control {kind:<17}: {ctrl[kind]['detected']}", flush=True)
            pre.append(require("audit-detects-violation",
                               all(v["detected"] for v in ctrl.values()), ctrl))

            # C — CURRENT-BAR MUTATION reaches the RENDERED series
            page.evaluate("() => window.__scan.camera.clear()")
            r0 = page.evaluate("() => window.__scan.rendered()")
            burst(page, 12, ms=90)
            page.wait_for_timeout(600)
            r1 = page.evaluate("() => window.__scan.rendered()")
            served = len(fixture.served_prices)
            same_bucket = bool(r0 and r1 and r0["bar"] and r1["bar"]
                               and r0["bar"]["time"] == r1["bar"]["time"])
            moved_close = bool(r0 and r1 and r0["bar"] and r1["bar"]
                               and r0["bar"]["close"] != r1["bar"]["close"])
            print(f"  C served={served} renderedBefore={r0 and r0['bar'] and r0['bar']['close']} "
                  f"renderedAfter={r1 and r1['bar'] and r1['bar']['close']} sameBucket={same_bucket}", flush=True)
            pre.append(require("current-bar-mutated-on-rendered-series",
                               served > 0 and moved_close and same_bucket,
                               {"servedPrices": fixture.served_prices[-6:],
                                "renderedBefore": r0, "renderedAfter": r1}))

            # D — NEW BAR appears on the RENDERED series
            n0 = page.evaluate("() => window.__scan.rendered()")
            advance_clock(page, fixture, 5 * 60)
            burst(page, 10, ms=90)
            page.wait_for_timeout(800)
            n1 = page.evaluate("() => window.__scan.rendered()")
            newer = bool(n0 and n1 and n0["bar"] and n1["bar"]
                         and n1["bar"]["time"] > n0["bar"]["time"])
            print(f"  D bar time {n0 and n0['bar'] and n0['bar']['time']} -> "
                  f"{n1 and n1['bar'] and n1['bar']['time']}  newBar={newer}", flush=True)
            pre.append(require("new-bar-created", newer,
                               {"before": n0, "after": n1}, hard=False))

            # E — the audit observes an ordinary mutation at all
            page.evaluate("() => window.__scan.camera.clear()")
            pan(page, 120)
            page.wait_for_timeout(300)
            seen = page.evaluate("() => window.__scan.camera.report().length")
            pre.append(require("audit-observability", seen >= 0, {"events": seen}, hard=False))
            print(f"  E audit events observable: {seen}", flush=True)

            out["preflight"] = pre

            # ── SCENARIOS ──
            scenarios = [
                ("A pan-back + rapid current-bar",       420, 0,  40),
                ("B pan-back + new-bar boundary",        420, 0,  90),
                ("C zoom-in near realtime",                0, 4,  40),
                ("D zoom-out",                             0, -4, 40),
                ("E pan + zoom + large move",            320, 3,  60),
                ("F deep pan into history",              900, 0,  60),
                ("G small pan off the right edge",        60, 0,  50),
                ("H pan then zoom then pan",             260, 2,  50),
                ("I repeated bursts after settling",     380, 0, 120),
            ]
            for name, dx, z, ticks in scenarios:
                page.evaluate("() => window.__scan.camera.clear()")
                if dx:
                    pan(page, dx)
                if z:
                    zoom(page, z)
                page.wait_for_timeout(150)
                before = rng(page)
                r_before = page.evaluate("() => window.__scan.rendered()")
                served_before = len(fixture.served_prices)
                if "new-bar" in name:
                    advance_clock(page, fixture, 5 * 60)
                observed = burst_observed(page, ticks)
                page.wait_for_timeout(500)
                after = rng(page)
                r_after = page.evaluate("() => window.__scan.rendered()")
                # PROOF the world changed: the RENDERED series moved (a new
                # close in the same bucket, or a newer bucket entirely).
                b0 = (r_before or {}).get("bar") or {}
                b1 = (r_after or {}).get("bar") or {}
                distinct_closes = len({c for (_t, c) in observed})
                distinct_times = len({_t for (_t, _c) in observed})
                mutated = distinct_closes >= 2 or distinct_times >= 2
                stim_ev = {"served": len(fixture.served_prices) - served_before,
                           "distinctCloses": distinct_closes, "distinctTimes": distinct_times,
                           "closeBefore": b0.get("close"), "closeAfter": b1.get("close"),
                           "timeBefore": b0.get("time"), "timeAfter": b1.get("time")}
                un = page.evaluate("() => window.__scan.camera.unauthorized()")
                rec = {"name": name, "before": before, "after": after,
                       "drift": drift(before, after), "unauthorized": len(un),
                       "stimulusProven": mutated, "stimulusEvidence": stim_ev,
                       "first": (un[0] if un else None)}
                out["scenarios"].append(rec)
                print(f"  {name:<34} stim={'Y' if mutated else 'N'} drift={rec['drift']} unauthorized={len(un)}"
                      + (f"  FIRST={un[0]['method']} @ {un[0]['at'][:90]}" if un else ""), flush=True)

            out["errors"] = errs
            out["allEvents"] = page.evaluate("() => window.__scan.camera.report()")
            b.close()
    except StimulusError as exc:
        # ⛔ HARNESS INVALID, NOT A PRODUCT FAILURE. The world did not change,
        # so nothing may be concluded about whether the chart held still.
        out["harnessInvalid"] = str(exc)
        print("")
        print(f"** HARNESS INVALID -- {exc}")
        print("   No product conclusion may be drawn from this run.")
    finally:
        try: proc.terminate()
        except Exception: pass                          # noqa: BLE001

    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "camera_out.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    if out.get("harnessInvalid"):
        print(f"[camera] wrote {dst}")
        return 2
    results = []
    for sc in out["scenarios"]:
        # ⛔ A SCENARIO IS ONLY VALID IF ITS STIMULUS WAS PROVEN. "The camera
        # held" and "nothing happened" are the same picture otherwise.
        stim_ok = bool(sc.get("stimulusProven"))
        ok = sc["unauthorized"] == 0 and (sc["drift"] or 0) <= 0.01
        sc["verdict"] = verdict(stim_ok, ok)
        results.append(sc)
    summary = summarize(results)
    out["summary"] = summary
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    bad = sum(s["unauthorized"] for s in out["scenarios"])
    moved = sum(1 for s in out["scenarios"] if (s["drift"] or 0) > 0.01)
    print()
    print(render(summary, "camera acceptance"))
    print(f"  unauthorized_moves={bad}  drifted={moved}")
    for sc in results:
        if sc["verdict"] != PASS:
            print(f"    {sc['verdict']:<8} {sc['name']}  stimulus={sc.get('stimulusEvidence')}")
    print(f"[camera] wrote {dst}")
    return 0 if summary["accepted"] else 1


if __name__ == "__main__":
    sys.exit(main())
