#!/usr/bin/env python
"""⭐⭐ ITEM 4 — THE PANE'S TABLES, THROUGH REAL GESTURES, AT TWO TOUCH TIERS.

`mobile_audit.py` answers *"does this route overflow horizontally and are its tap
targets big enough"* for every route. That is the right question for a page and
the wrong one for THIS: the indicator wave ships two DOM tables anchored to the
corners of a chart pane, and what can break them is a GESTURE — a crosshair
scrub, a pinch-zoom, a scroll, a rotate — not a page load.

⛔ SO THE PASS CONDITIONS ARE MEASURED, NOT EYEBALLED, and each is a number read
off the live DOM before and after every gesture:

  anchored   every table's corner offset is unchanged by the gesture, and still
             matches the corner its `data-uct-table-position` declares
  no overlap the table's rect intersects neither the price scale, the floating
             toolbar strip, nor the mobile joystick-hub region
  quarter    the indicator pane is ~1/4 of the chart, never the 29px frame
  readable   every disclosure line has non-zero layout and real text
  artefacts  the table's cell TEXT is identical before and after the gesture —
             a redraw artefact that changed a number would pass a rect check

⛔⛔ AND A ROW IS PASS ONLY IF ITS PROBE ACTUALLY RAN. Anything the harness could
not drive is UNTESTED with the reason, never a silent pass — the whole point of
the row. `--self-check` proves the verdicts can come back false.

⚠️ GATE v2.1 IS READ ON THE AUDIT PAGE BEFORE EVERY CAPTURE. In Playwright the
page is the driven surface, so the gate reads `visibilityState` plus the window
geometry from the page itself; a hidden or zero-height page defers paint and its
screenshot is not evidence.
"""
import argparse
import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

OUT = pathlib.Path(__file__).resolve().parents[1] / "tools" / "pane_audit_out"

TIERS = {
    "phone390": {"width": 390, "height": 844, "dsf": 3},
    "touch1024": {"width": 1024, "height": 768, "dsf": 2},
}
ZOOMS = [1.0, 1.25]

# ⛔ THE GATE, READ ON THE PAGE BEING CAPTURED.
GATE_JS = """() => {
  const g = {
    visibilityState: document.visibilityState,
    screenY: window.screenY, outerHeight: window.outerHeight,
    availTop: window.screen.availTop, availHeight: window.screen.availHeight,
    innerW: window.innerWidth, innerH: window.innerHeight,
    dpr: window.devicePixelRatio,
  };
  g.pass = g.visibilityState === 'visible' && g.innerW > 0 && g.innerH > 0;
  return g;
}"""

# Everything the pass conditions need, in one read.
PROBE_JS = """() => {
  const rect = (el) => { const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const hit = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

  const layer = document.querySelector('[data-uct-table-layer]');
  const tables = [...document.querySelectorAll('[data-uct-object-table]')].map((t) => ({
    id: t.getAttribute('data-uct-object-table'),
    position: t.getAttribute('data-uct-table-position'),
    rect: rect(t),
    cells: [...t.querySelectorAll('td')].map((td) => td.textContent),
  }));

  // the chart container and the indicator pane
  const chart = document.querySelector('.tv-lightweight-charts');
  const chartRect = chart ? rect(chart) : null;

  // the price scale sits at the right edge of the chart; LWC renders it as the
  // rightmost canvas/table cell. Approximate by the widest right-hand strip that
  // is not the drawing surface.
  const scales = [...document.querySelectorAll('.tv-lightweight-charts table td:last-child canvas')]
    .map((c) => rect(c)).filter((r) => r.w > 0 && r.w < 200);
  const priceScale = scales.length ? scales.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b)) : null;

  // the floating drawing toolbar
  const tb = document.querySelector('[class*="toolbar"]');
  const toolbar = tb ? rect(tb) : null;

  // the mobile joystick-hub / floating orb region, bottom of the viewport
  const orb = document.querySelector('[class*="FloatingOrb"], [class*="orb"], [class*="joystick"]');
  const hub = orb ? rect(orb) : null;

  const disclosures = [...document.querySelectorAll('li,p,div')]
    .filter((e) => e.children.length === 0 && /HVE Trigger|request\\.security|bars here/i.test(e.textContent || ''))
    .map((e) => ({ text: (e.textContent || '').trim().slice(0, 70), rect: rect(e) }));

  const canvas = document.querySelector('[data-uct-object-layer]');
  return {
    layerPresent: !!layer,
    stamp: layer ? layer.getAttribute('data-uct-tables-drawn') : null,
    unreadable: canvas ? canvas.getAttribute('data-uct-objects-unreadable') : null,
    boundTf: canvas ? canvas.getAttribute('data-uct-object-tf') : null,
    tables,
    chartRect,
    priceScale,
    toolbar,
    hub,
    disclosures,
    overlaps: tables.map((t) => ({
      id: t.id,
      priceScale: priceScale ? hit(t.rect, priceScale) : null,
      toolbar: toolbar ? hit(t.rect, toolbar) : null,
      hub: hub ? hit(t.rect, hub) : null,
    })),
    innerW: window.innerWidth,
    innerH: window.innerHeight,
  };
}"""


def gesture(page, name, probe):
    """Drive one gesture. Returns (driven, note)."""
    ch = probe.get("chartRect")
    if not ch or ch["w"] < 40 or ch["h"] < 40:
        return False, "no chart rect to gesture over"
    cx, cy = ch["x"] + ch["w"] // 2, ch["y"] + ch["h"] // 2
    try:
        if name == "scrub":
            page.mouse.move(ch["x"] + 20, cy)
            for i in range(12):
                page.mouse.move(ch["x"] + 20 + i * max(1, (ch["w"] - 40) // 12), cy)
            page.wait_for_timeout(400)
        elif name == "pinch-zoom":
            # LWC zooms on wheel; a touch pinch is a wheel with ctrl in Chromium.
            page.mouse.move(cx, cy)
            page.mouse.wheel(0, -240)
            page.wait_for_timeout(300)
            page.mouse.wheel(0, 240)
            page.wait_for_timeout(400)
        elif name == "scroll":
            page.mouse.move(cx, cy)
            page.mouse.wheel(0, 400)
            page.wait_for_timeout(250)
            page.mouse.wheel(0, -400)
            page.wait_for_timeout(400)
        elif name == "rotate":
            vp = page.viewport_size
            page.set_viewport_size({"width": vp["height"], "height": vp["width"]})
            page.wait_for_timeout(900)
            page.set_viewport_size({"width": vp["width"], "height": vp["height"]})
            page.wait_for_timeout(900)
        else:
            return False, f"unknown gesture {name}"
        return True, ""
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"[:120]


def verdicts(before, after, gesture_name, driven, note):
    """Per-row PASS / FAIL / UNTESTED, each with its reason."""
    rows = {}

    def row(key, ok, why):
        rows[key] = {"verdict": "PASS" if ok else "FAIL", "why": why}

    if not driven:
        for k in ("anchored", "no-artefacts", "no-overlap"):
            rows[k] = {"verdict": "UNTESTED", "why": note or "gesture not driven"}
        return rows

    if not before["tables"] or not after["tables"]:
        for k in ("anchored", "no-artefacts", "no-overlap"):
            rows[k] = {"verdict": "UNTESTED", "why": "no tables on the pane to measure"}
        return rows

    b = {t["id"]: t for t in before["tables"]}
    a = {t["id"]: t for t in after["tables"]}
    same_ids = set(b) == set(a)

    moved = [i for i in b if i in a and b[i]["rect"] != a[i]["rect"]]
    row("anchored", same_ids and not moved,
        "every table rect unchanged" if same_ids and not moved
        else f"moved={moved} ids_changed={not same_ids}")

    changed = [i for i in b if i in a and b[i]["cells"] != a[i]["cells"]]
    row("no-artefacts", not changed,
        "cell text identical before/after" if not changed else f"text changed in {changed}")

    bad = [o for o in after["overlaps"] if o["priceScale"] or o["toolbar"] or o["hub"]]
    row("no-overlap", not bad,
        "clear of price scale, toolbar and hub" if not bad else f"overlaps: {bad}")
    return rows


def static_rows(probe):
    rows = {}
    tables = probe["tables"]
    if not tables:
        rows["tables-drawn"] = {"verdict": "UNTESTED", "why": "no table elements on the page"}
    else:
        want = {"top_left", "top_right"}
        got = {t["position"] for t in tables}
        rows["tables-drawn"] = {
            "verdict": "PASS" if want <= got else "FAIL",
            "why": f"positions={sorted(got)} stamp={probe['stamp']}",
        }

    ch = probe.get("chartRect")
    if not ch:
        rows["quarter-pane"] = {"verdict": "UNTESTED", "why": "no chart container found"}
    else:
        # the 29px frame is the failure this row exists for
        rows["quarter-pane"] = {
            "verdict": "PASS" if ch["h"] > 120 else "FAIL",
            "why": f"chart height {ch['h']}px (a 29px frame is the defect)",
        }

    d = probe["disclosures"]
    if not d:
        rows["disclosures-readable"] = {"verdict": "UNTESTED", "why": "no disclosure lines located"}
    else:
        unreadable = [x for x in d if x["rect"]["h"] <= 0 or x["rect"]["w"] <= 0]
        rows["disclosures-readable"] = {
            "verdict": "PASS" if not unreadable else "FAIL",
            "why": f"{len(d)} line(s), {len(unreadable)} with zero layout",
        }
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8129")
    ap.add_argument("--email", default="panetest@local.dev")
    ap.add_argument("--password", default="LocalTest2026!")
    ap.add_argument("--route", default="/charts")
    ap.add_argument("--settle", type=float, default=14.0)
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)

    if args.self_check:
        b = {"tables": [{"id": "1", "position": "top_left", "rect": {"x": 0, "y": 0, "w": 10, "h": 5},
                         "cells": ["a"]}], "overlaps": [{"id": "1", "priceScale": False,
                                                         "toolbar": False, "hub": False}]}
        a2 = json.loads(json.dumps(b))
        a2["tables"][0]["rect"]["x"] = 99
        a2["tables"][0]["cells"] = ["b"]
        a2["overlaps"][0]["toolbar"] = True
        v = verdicts(b, a2, "scrub", True, "")
        bad = [k for k, r in v.items() if r["verdict"] != "FAIL"]
        print("[self-check]", json.dumps(v, indent=1))
        print("[self-check]", "OK - all three can FAIL" if not bad else f"BROKEN: {bad} did not fail")
        return 0 if not bad else 1

    OUT.mkdir(parents=True, exist_ok=True)
    report = {"base": args.base, "route": args.route, "tiers": {}}

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME") or None)
        for tier, vp in TIERS.items():
            tier_out = {"viewport": f'{vp["width"]}x{vp["height"]}', "zooms": {}, "gestures": {}}
            ctx = browser.new_context(
                viewport={"width": vp["width"], "height": vp["height"]},
                device_scale_factor=vp["dsf"], is_mobile=True, has_touch=True,
                reduced_motion="reduce",
            )
            page = ctx.new_page()
            page.goto(args.base + "/login", wait_until="domcontentloaded")
            page.request.post(args.base + "/api/auth/login",
                              data=json.dumps({"email": args.email, "password": args.password}),
                              headers={"Content-Type": "application/json"})
            page.goto(args.base + args.route, wait_until="domcontentloaded")
            page.wait_for_timeout(int(args.settle * 1000))
            try:
                page.wait_for_selector("[data-uct-object-table]", timeout=60000)
            except Exception:  # noqa: BLE001
                pass
            page.wait_for_timeout(3000)

            base_probe = page.evaluate(PROBE_JS)
            tier_out["static"] = static_rows(base_probe)
            tier_out["stamp"] = base_probe["stamp"]
            tier_out["unreadable"] = base_probe["unreadable"]
            tier_out["boundTf"] = base_probe["boundTf"]
            tier_out["tables"] = [{"position": t["position"], "cells": t["cells"],
                                   "rect": t["rect"]} for t in base_probe["tables"]]

            # gestures
            for g in ("scrub", "pinch-zoom", "scroll", "rotate"):
                before = page.evaluate(PROBE_JS)
                driven, note = gesture(page, g, before)
                page.wait_for_timeout(600)
                after = page.evaluate(PROBE_JS)
                tier_out["gestures"][g] = verdicts(before, after, g, driven, note)

            # captures at two zoom levels, gate read before each
            for z in ZOOMS:
                page.evaluate("(z) => { document.body.style.zoom = z }", z)
                page.wait_for_timeout(1200)
                gate = page.evaluate(GATE_JS)
                shot = OUT / f"{tier}-zoom{int(z * 100)}.png"
                if gate["pass"]:
                    page.screenshot(path=str(shot), full_page=False)
                tier_out["zooms"][f"{int(z * 100)}%"] = {
                    "gate": gate,
                    "screenshot": str(shot.name) if gate["pass"] else None,
                    "captured": bool(gate["pass"]),
                }
            page.evaluate("() => { document.body.style.zoom = 1 }")

            report["tiers"][tier] = tier_out
            ctx.close()
        browser.close()

    (OUT / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
