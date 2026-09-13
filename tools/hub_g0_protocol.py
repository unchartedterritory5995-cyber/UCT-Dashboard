"""G0-1 — drive the seven-step flick protocol with a CALIBRATED SINGLE-POINTER touch transport.

⛔⛔ WHY CDP AND NOT `page.mouse`. The hub's engine is pointer-driven and gated on
`(pointer: coarse)`; a mouse drag produces `pointerType: "mouse"` and would measure a gesture no
member can make. This dispatches real touch events through `Input.dispatchTouchEvent`, one finger,
with the timing written explicitly — which is the whole measurement, because FLICK_MS is 120 and a
transport that adds 40 ms of its own would manufacture cause A.

⛔ IT MEASURES ITS OWN TRANSPORT. Every gesture records the wall-clock it actually took
(`sentMs`), not the time it was asked to take. A run whose sentMs are all 160 ms has not tested a
flick, and the analyzer would faithfully report "flick window missed" for a defect that belongs to
this file. The summary prints the distribution so that cannot pass unnoticed.

⛔ CALIBRATION IS A MEASUREMENT, NOT A GUESS. The fan's angles come from `fanGeometry`, and this
file does not restate them: it performs one slow, deliberate drag per candidate angle and reads
which action the ENGINE resolved (`data-hub-last-action` on the hub root, written by `HubRoot`).
A hand-typed angle table beside the geometry that owns it is the defect this repo keeps paying for.

Usage:
    python tools/hub_g0_protocol.py --base http://localhost:8077 --email … --password …
    python tools/hub_g0_protocol.py --self-check
"""
from __future__ import annotations

import argparse
import json
import math
import os
import pathlib
import sys
import time

REPO = pathlib.Path(__file__).resolve().parent.parent

# The pad's declared geometry (constants.js / hub.module.css). Used only to place the finger;
# every ACTION angle is calibrated at runtime.
PAD_PX = 84
EDGE_OFFSET_PX = 24
BOTTOM_OFFSET_PX = 68

FLICK_MS = 120          # the threshold under test, from constants.js
FLICK_TARGET_MS = 70    # ⛔ NOT 90. Measured: the three CDP round trips a flick needs cost
                        # ~25-45 ms on top of whatever is asked, so 90 produced a spread of
                        # 98-146 ms and two gestures spilled PAST the 120 ms window — which
                        # the analyser then, correctly, called a missed flick. Aiming at 70
                        # leaves the overhead somewhere to go. The run still reports what it
                        # ACTUALLY sent; this only moves the target, never the measurement.
SLOW_MS = 520           # the control: unambiguously a deliberate press


def say(text: str) -> None:
    sys.stdout.buffer.write((text + "\n").encode("utf-8", "replace"))
    sys.stdout.flush()


def pad_centre(w: int, h: int) -> tuple[float, float]:
    return (w - EDGE_OFFSET_PX - PAD_PX / 2, h - BOTTOM_OFFSET_PX - PAD_PX / 2)


def point_at(cx: float, cy: float, deg: float, dist: float) -> tuple[float, float]:
    """Math degrees: 0 = right, 90 = up. The fan occupies 90-180 (upper-left quadrant)."""
    rad = math.radians(deg)
    return (cx + dist * math.cos(rad), cy - dist * math.sin(rad))


class Finger:
    """One touch pointer, driven through CDP with explicit timing."""

    def __init__(self, cdp):
        self.cdp = cdp

    def _send(self, kind: str, points):
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind,
            "touchPoints": [{"x": float(x), "y": float(y), "id": 1} for x, y in points],
        })

    # ⛔⛔ EVERY CDP CALL IS A ROUND TRIP, AND THE ROUND TRIPS ARE THE MEASUREMENT'S FLOOR.
    # First run: touchStart + 6 moves + touchEnd = 8 round trips, and the "flicks" came out at a
    # median of 161 ms against a 120 ms window — min 132, max 259. Not one of them was a flick.
    # Analysed, every single one would have classified as "flick window missed", and the verdict
    # would have been a property of this file. A flick therefore sends the FEWEST events that
    # still constitute one: press, a single move that carries the full travel, release.
    def drag(self, start, end, ms: int, steps: int = 6) -> float:
        """Press at `start`, move to `end`, release — in about `ms`. Returns the REAL elapsed ms."""
        t0 = time.perf_counter()
        self._send("touchStart", [start])
        per = (ms / 1000.0) / steps
        for i in range(1, steps + 1):
            f = i / steps
            self._send("touchMove", [(start[0] + (end[0] - start[0]) * f,
                                      start[1] + (end[1] - start[1]) * f)])
            # busy-wait: time.sleep's resolution on Windows is ~15ms, which is an eighth of the
            # window under test. A sleep-driven flick would be a transport artefact.
            target = t0 + per * i
            while time.perf_counter() < target:
                pass
        self._send("touchEnd", [])
        return (time.perf_counter() - t0) * 1000.0


# ⛔⛔ READING THE ATTRIBUTE AFTER THE FACT LOSES EVERY ACTION THAT NAVIGATES.
#
# `HubRoot` writes `data-hub-last-action` on the hub root, and `scan.chartIt` is a NAVIGATE: the
# moment it fires, the router swaps the page and the attribute is gone before a poll can see it.
# The first calibration sweep therefore resolved flag, alert and planTrade and reported that
# `scan.chartIt` "never resolved" — a false statement about the one action the protocol is built
# around, produced by reading a value that had already been thrown away.
#
# An observer installed BEFORE the gesture records every value the attribute ever took. React
# Router navigates without a document reload, so `window.__hubActions` survives the route change;
# a full reload would clear it, and that is why `armObserver` is re-run after every navigation.
# ⛔⛔ A FULL PAGE LOAD DESTROYS THE TRACE. THIS IS THE WHOLE REASON THIS HELPER EXISTS.
#
# `gestureTrace.js` keeps its ring buffer in MODULE state — deliberately, because the spec forbids
# a sink, so there is nowhere else for it to live. `page.goto()` is a document navigation: it tears
# down the JS context and the ring with it. The first complete run of this protocol sent 25
# gestures, the engine resolved every one of them (calibration proves that), and the mirror
# attribute then reported `recorded: 0` — an empty capture produced entirely by the harness
# walking between routes the way a script does instead of the way a member does.
#
# A member taps. A tap is a client-side route change and the module survives it. So this navigates
# the way the product does: push the history entry and let the router react to it.
SPA_GOTO = """(path) => {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  return location.pathname + location.search;
}"""


def spa_goto(page, path: str, settle: int = 2200) -> str:
    """Client-side route change — never a document load. Returns where the router actually went."""
    got = page.evaluate(SPA_GOTO, path)
    page.wait_for_timeout(settle)
    return got


ARM_OBSERVER = """() => {
  window.__hubActions = [];
  if (window.__hubObs) window.__hubObs.disconnect();
  const push = (v) => { if (v) window.__hubActions.push(v); };
  window.__hubObs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.attributeName === 'data-hub-last-action') {
        push(m.target.getAttribute('data-hub-last-action'));
      }
    }
  });
  window.__hubObs.observe(document.documentElement, {
    subtree: true, attributes: true, attributeFilter: ['data-hub-last-action'],
  });
  return true;
}"""


def arm(page) -> None:
    page.evaluate(ARM_OBSERVER)


def read_last_action(page) -> str | None:
    """The last action the ENGINE resolved during this probe — from the observer, not a poll."""
    seen = page.evaluate("() => (window.__hubActions || []).filter(Boolean)")
    return seen[-1] if seen else None


def hub_showing(page) -> bool:
    return page.evaluate(
        """() => {
            const el = document.querySelector('[data-testid="hub-root"]');
            if (!el) return false;
            const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
            return !el.hasAttribute('hidden') && cs.display !== 'none' && r.width > 0;
        }"""
    )


def recover(page, base: str) -> None:
    """Put the app back on /screener with nothing open.

    ⛔ EVERY PROBE MUST START FROM THE SAME STATE OR THE SWEEP MEASURES ITS OWN WRECKAGE. The
    first calibration run resolved `scan.scans` at 90 degrees and then NOTHING for the remaining
    nine angles — because Scans opens the saved-screens picker, and a sheet over the pad swallows
    every drag after it. A sweep that reports "the fan resolves nothing above 90 degrees" would
    have been a true statement about a blocked screen and a false one about the product.
    """
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    if not page.url.rstrip("/").endswith("/screener"):
        spa_goto(page, "/screener")


def calibrate(page, finger, cx, cy, want: list[str], radius: float, base: str) -> dict:
    """Which angle resolves to which action — asked of the engine, one slow drag at a time.

    ⛔ THE RADIUS DECIDES THE RING, and that is measured, not assumed: `reachMidpointPx()` is
    `(FAN_RADIUS_INNER + FAN_RADIUS_OUTER) / 2` = (96 + 150) / 2 = 123. The first run swept at 120
    and could only ever reach the INNER ring — which is why it found `scan.scans` and never
    `scan.chartIt`. Aiming past the midpoint is what makes an outer action reachable at all.
    """
    found: dict[str, float] = {}
    for deg in range(90, 181, 10):
        recover(page, base)
        arm(page)
        finger.drag((cx, cy), point_at(cx, cy, deg, radius), SLOW_MS)
        page.wait_for_timeout(320)
        got = read_last_action(page)
        if got and got not in found:
            found[got] = float(deg)
    return {k: v for k, v in found.items() if k in want} if want else found


def self_check() -> int:
    """⛔ Prove the transport can distinguish a flick from a press BEFORE any device time."""
    fails = []
    cx, cy = pad_centre(393, 852)
    if not (300 < cx < 340 and 720 < cy < 760):
        fails.append(f"pad centre off the pad: {cx},{cy}")
    up_left = point_at(cx, cy, 135, 120)
    if not (up_left[0] < cx and up_left[1] < cy):
        fails.append("135 degrees did not go up-and-left; the angle convention is wrong")
    right = point_at(cx, cy, 0, 100)
    if not (right[0] > cx and abs(right[1] - cy) < 1):
        fails.append("0 degrees is not to the right; the angle convention is wrong")
    if FLICK_TARGET_MS >= FLICK_MS:
        fails.append("the flick is not aimed INSIDE the window it is testing")
    if SLOW_MS <= FLICK_MS * 2:
        fails.append("the control drag is not unambiguously slower than the window")
    if fails:
        say("SELF-CHECK FAILED:\n  " + "\n  ".join(fails))
        return 1
    say(f"self-check OK — pad centre ({cx:.0f},{cy:.0f}), 135deg is up-left, "
        f"flick {FLICK_TARGET_MS}ms < FLICK_MS {FLICK_MS} < control {SLOW_MS}ms")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://localhost:8077")
    ap.add_argument("--email", default=os.environ.get("SMOKE_EMAIL"))
    ap.add_argument("--password", default=os.environ.get("SMOKE_PASSWORD"))
    ap.add_argument("--out", default=str(REPO / "docs" / "plans" / "joystick" / "traces"))
    ap.add_argument("--label", default="sandbox")
    ap.add_argument("--flicks", type=int, default=10)
    ap.add_argument("--controls", type=int, default=5)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()

    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime())

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ctx = br.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=3,
                             is_mobile=True, has_touch=True)
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page)
        finger = Finger(cdp)

        page.goto(f"{args.base}/login", wait_until="domcontentloaded", timeout=45000)
        r = page.request.post(f"{args.base}/api/auth/login",
                              data={"email": args.email, "password": args.password})
        say(f"  login: {r.status}")
        if r.status != 200:
            say("⛔ INCONCLUSIVE — could not sign in; nothing measured.")
            br.close()
            return 2

        # ── the toggle, through the product's own control ────────────────────────────────────
        # ⛔ THE CARD LIVES IN THE **charts** SECTION, and Settings is section-routed
        # (`?section=` deep-linkable, Settings.jsx:1609). Loading bare /settings renders the
        # default section and the card is not on the page at all — which reads exactly like
        # "the build does not have it", and cost one INCONCLUSIVE run before it was measured.
        page.goto(f"{args.base}/settings?section=charts", wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(3000)
        toggle = page.locator('[data-testid="joystick-trace-toggle"]')
        if toggle.count() == 0:
            say("⛔ INCONCLUSIVE — the trace toggle is not on this build/account.")
            br.close()
            return 2
        if not toggle.is_checked():
            toggle.check()
        page.wait_for_timeout(800)
        page.locator('[data-testid="joystick-trace-clear"]').click()
        page.wait_for_timeout(400)

        spa_goto(page, "/screener", settle=4000)
        if not hub_showing(page):
            say("⛔ INCONCLUSIVE — the hub is not showing on /screener in this context.")
            br.close()
            return 2

        w, h = 393, 852
        cx, cy = pad_centre(w, h)
        # Past `reachMidpointPx()` (123) so the OUTER ring is what resolves — see calibrate().
        radius = 140.0
        say(f"  pad centre ({cx:.0f},{cy:.0f}); calibrating the fan's angles…")
        angles = calibrate(page, finger, cx, cy, [], radius, args.base)
        say("  calibration: " + json.dumps(angles))

        # ⛔⛔ CLEAR AFTER CALIBRATING, NOT ONLY BEFORE — the calibration is TEN MORE GESTURES and
        # they live in the same ring. The first full run left them there, so `--expect` (25 long)
        # paired against 35 recorded gestures: the first ten expectations landed on calibration
        # drags, and every label after that was shifted by ten. It read as "13 fired a different
        # action" — a geometry defect that did not exist, manufactured by an off-by-ten in the
        # harness. The analyser's own header warns that order-pairing slides; this is what that
        # looks like in practice.
        spa_goto(page, "/settings?section=charts", settle=2600)
        page.locator('[data-testid="joystick-trace-clear"]').click()
        page.wait_for_timeout(500)
        spa_goto(page, "/screener", settle=3000)
        if not hub_showing(page):
            say("⛔ INCONCLUSIVE — the hub stopped showing after the calibration clear.")
            br.close()
            return 2

        plan = []
        for wanted, count, ms in (("scan.chartIt", args.flicks, FLICK_TARGET_MS),
                                  ("scan.flag", args.flicks, FLICK_TARGET_MS),
                                  ("scan.chartIt", args.controls, SLOW_MS)):
            deg = angles.get(wanted)
            if deg is None:
                say(f"⛔ INCONCLUSIVE — calibration never resolved {wanted}; "
                    "aiming at a guessed angle would measure the guess.")
                br.close()
                return 2
            plan.append((wanted, deg, count, ms))

        sent = []
        for wanted, deg, count, ms in plan:
            say(f"  {count} x {'flick' if ms < FLICK_MS else 'SLOW CONTROL'} -> {wanted} @ {deg:.0f}deg")
            for _ in range(count):
                # A flick is three events; the slow control keeps its six, because a control that
                # travels in one jump is not the deliberate drag it is meant to represent.
                el = finger.drag((cx, cy), point_at(cx, cy, deg, radius), ms,
                                 steps=1 if ms < FLICK_MS else 6)
                sent.append({"target": wanted, "askedMs": ms, "sentMs": round(el, 1)})
                page.wait_for_timeout(1400)
                recover(page, args.base)

        # ── read the trace off the mirror attribute ──────────────────────────────────────────
        # ⛔ CLIENT-SIDE. A `goto` here would throw away the very buffer this line exists to read.
        spa_goto(page, "/settings?section=charts", settle=3200)
        raw = page.evaluate(
            "() => document.querySelector('[data-testid=\"joystick-trace-section\"]')"
            "?.getAttribute('data-hub-trace') || null"
        )
        if not raw:
            say("⛔ INCONCLUSIVE — the mirror attribute was absent; nothing to analyse.")
            br.close()
            return 2
        dest = out_dir / f"{args.label}-{stamp}.json"
        dest.write_text(raw, encoding="utf-8")
        page.locator('[data-testid="joystick-trace-toggle"]').uncheck()
        page.wait_for_timeout(600)
        br.close()

    asked = [s["sentMs"] for s in sent if s["askedMs"] < FLICK_MS]
    ctrl = [s["sentMs"] for s in sent if s["askedMs"] >= FLICK_MS]
    say("")
    say("  TRANSPORT, measured — a flick this file could not actually send is its defect, not the product's:")
    if asked:
        say(f"    flicks : min {min(asked):.0f}ms  median {sorted(asked)[len(asked)//2]:.0f}ms  max {max(asked):.0f}ms   (window {FLICK_MS}ms)")
    if ctrl:
        say(f"    control: min {min(ctrl):.0f}ms  max {max(ctrl):.0f}ms")
    say(f"  trace: {dest}")
    say(f"  gestures sent: {len(sent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
