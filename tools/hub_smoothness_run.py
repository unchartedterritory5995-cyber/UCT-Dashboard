"""M1 — dropped frames over a full drag→open→select→release, at 4× CPU throttle.

⛔ THIS IS THE CHECK THAT DECIDES WHETHER THE BUBBLE MAY CARRY GLASS.
`w4-material-plan.md` §0 records a measured rule: no ANIMATING element carries a
backdrop-filter, because a blurred surface that moves re-samples its backdrop every
frame. W4 pass 1 puts glass on the bubble anyway and engages it only once the fan has
SETTLED. That is a claim about frames, and a claim about frames is settled by counting
frames — not by reading the stylesheet and feeling reassured.

HOW THE NUMBERS COME BACK. There is no window hook. `hubSmoothness.js` is wired inside
`useJoystick`'s `withTrace()` under the G0 gate, and the ONLY read path is the
`data-hub-trace` attribute on the Settings card, which is gated by
`isAdmin && settings.traceGestures` and computed AT RENDER.

⛔ SO THE NAVIGATION MUST NOT BE A DOCUMENT LOAD. The trace ring is module state with no
sink; a reload destroys it. This drives `history.pushState` + a `popstate` event, which
is the same constraint the BrowserStack read path documents.

⚠️ AN EMULATED PROFILE WITH A CPU THROTTLE IS A PROXY FOR A DEVICE, NOT A DEVICE. It
throttles the main thread; it does not reproduce a phone's GPU, its compositor, its
thermal behaviour or its memory pressure — and `backdrop-filter` is precisely the kind of
work that lives off the main thread. So a PASS here is necessary and not sufficient, and
R9 still stands: flick, hold and scrub need a real finger. Label it that way in any
artifact that quotes it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hub_critique_capture import PROFILES, PTR_JS  # noqa: E402 — one authority

SETTINGS_PATH = "/settings?section=charts"


def prefs_route(theme):
    def handler(route):
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "joystick_hub": json.dumps({
                    "enabled": True,
                    "handedness": "right",
                    "surface": "simplified",
                    # G0: the trace is admin-gated AND preference-gated. The harness serves a
                    # synthetic admin, so this is the half a caller controls.
                    "traceGestures": True,
                }),
                "theme": theme,
            }),
        )
    return handler


def run_one(browser, base, prof_name, prof, theme, throttle, out, rows):
    ctx = browser.new_context(**prof)
    ctx.route("**/api/auth/preferences", prefs_route(theme))
    page = ctx.new_page()

    cdp = ctx.new_cdp_session(page)
    if throttle > 1:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": throttle})

    page.goto(f"{base}/charts", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(700)
    except Exception:
        pass

    # ── the full gesture M1 names: drag → open → select → release ──────────────────
    page.evaluate(PTR_JS, ["pointerdown", 0, 0])
    page.wait_for_timeout(60)
    page.evaluate(PTR_JS, ["pointermove", 0, -46])
    page.wait_for_timeout(420)                  # past the 0.3s settle, glass engaged
    page.evaluate(PTR_JS, ["pointermove", 18, -60])   # move onto a neighbouring wedge
    page.wait_for_timeout(180)
    page.evaluate(PTR_JS, ["pointerup", 18, -60])
    page.wait_for_timeout(400)

    # ⛔ pushState, never goto — a document load destroys the module-state ring.
    page.evaluate(
        """(p) => { history.pushState({}, '', p);
                    window.dispatchEvent(new PopStateEvent('popstate')); }""",
        SETTINGS_PATH,
    )
    page.wait_for_timeout(2500)

    raw = page.evaluate(
        """() => { const el = document.querySelector('[data-hub-trace]');
                   return el ? el.getAttribute('data-hub-trace') : null; }"""
    )
    label = f"{prof_name}/{theme}/{throttle}x"
    if not raw:
        rows.append(dict(profile=prof_name, theme=theme, throttle=throttle,
                         verdict="INCONCLUSIVE",
                         why="no data-hub-trace attribute — the trace is admin+preference "
                             "gated and computed at render; ABSENT is not the same as EMPTY"))
        print(f"  [??  ] {label}: no trace attribute")
        ctx.close()
        return

    try:
        trace = json.loads(raw)
    except Exception as e:
        rows.append(dict(profile=prof_name, theme=theme, throttle=throttle,
                         verdict="INCONCLUSIVE", why=f"trace not JSON: {type(e).__name__}"))
        print(f"  [??  ] {label}: trace not parseable")
        ctx.close()
        return

    (out / f"trace_{prof_name}_{theme}_{throttle}x.json").write_text(
        json.dumps(trace, indent=2), encoding="utf-8")

    # ⚠️ The payload's `trace` key is the SCHEMA NAME ("uct-joystick-g0"), not the data —
    # a 15-character string that `len()` happily reports as "15 entries". The gesture rows
    # are under `rows`, and only the row carrying the pointerup holds a smoothness summary.
    # ⭐ The tell was "15 entries, no smoothness summary": a plausible count from the wrong key.
    entries = trace if isinstance(trace, list) else (trace.get("rows") or [])
    smooth = [e.get("smoothness") for e in entries
              if isinstance(e, dict) and e.get("smoothness")]
    if not smooth:
        rows.append(dict(profile=prof_name, theme=theme, throttle=throttle,
                         verdict="INCONCLUSIVE",
                         why=f"trace has {len(entries)} entr(ies) but none carries a "
                             f"smoothness summary",
                         keys=sorted(entries[0].keys()) if entries and isinstance(entries[0], dict) else None))
        print(f"  [??  ] {label}: {len(entries)} entries, no smoothness summary")
        ctx.close()
        return

    for s in smooth:
        if not s.get("valid", True):
            rows.append(dict(profile=prof_name, theme=theme, throttle=throttle,
                             verdict="INCONCLUSIVE", why=f"void: {s.get('voidReason')}"))
            print(f"  [??  ] {label}: capture void ({s.get('voidReason')})")
            continue
        dropped = s.get("droppedFrames")
        gaps = s.get("gapMs") or {}
        lt = s.get("longTasks") or {}
        # M1 is ZERO dropped frames. Stating the bar beside the number.
        verdict = "PASS" if dropped == 0 else "FAIL"
        rows.append(dict(profile=prof_name, theme=theme, throttle=throttle, verdict=verdict,
                         fps=s.get("fps"), frames=s.get("frames"), dropped_frames=dropped,
                         gap_p50=gaps.get("p50"), gap_p95=gaps.get("p95"), gap_max=gaps.get("max"),
                         input_latency_ms=s.get("inputLatencyMs"),
                         long_tasks=lt.get("count"), long_task_max=lt.get("maxMs"),
                         window_ms=s.get("windowMs"), capacity=s.get("capacity"),
                         saturated_dropped=s.get("dropped")))
        mark = "ok  " if verdict == "PASS" else "FAIL"
        print(f"  [{mark}] {label}: fps={s.get('fps')} frames={s.get('frames')} "
              f"droppedFrames={dropped} gap p50/p95/max="
              f"{gaps.get('p50')}/{gaps.get('p95')}/{gaps.get('max')} "
              f"input={s.get('inputLatencyMs')}ms longTasks={lt.get('count')}")
    ctx.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8131")
    ap.add_argument("--out", default="scratchpad/smoothness")
    ap.add_argument("--throttle", type=int, default=4)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []

    from playwright.sync_api import sync_playwright

    print(f"  M1 — dropped frames over drag→open→select→release, {args.throttle}× CPU throttle")
    print("  ⚠️ emulated profile + main-thread throttle: a PROXY for a device, not a device.\n")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--force-color-profile=srgb", "--disable-lcd-text"])
        try:
            for prof_name, prof in PROFILES.items():
                for theme in ("dark",):
                    run_one(browser, args.base, prof_name, prof, theme,
                            args.throttle, out, rows)
        finally:
            browser.close()

    (out / "smoothness.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    fails = [r for r in rows if r["verdict"] == "FAIL"]
    inc = [r for r in rows if r["verdict"] == "INCONCLUSIVE"]
    print(f"\n  {len(rows)} run(s): {len(rows)-len(fails)-len(inc)} pass, "
          f"{len(fails)} FAIL, {len(inc)} inconclusive")
    if fails:
        return 1
    return 2 if inc else 0


if __name__ == "__main__":
    raise SystemExit(main())
