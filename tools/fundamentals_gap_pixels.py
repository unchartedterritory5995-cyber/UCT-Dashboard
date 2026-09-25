"""Historical Fundamentals -- the PIXEL proof that a canonical gap is drawn broken.

THE TEST THE 2026-09-24 ROLLOUT LACKED. The chart shipped with every canonical gap
bridged: lightweight-charts 5.2.0 connects the valued rows on either side of
whitespace, and the harness then in use counted POINTS in the gap (0), never
PIXELS. This scans the rendered canvas instead.

Per case (see app/src/testing/fundamentals/gapPixelHarness.js), on the REAL binder
and the REAL renderer drawing the committed golden v4 fixture:

  * GAP     -- every pixel column strictly inside a canonical unknown window must
               hold NO pixel of the line's (or its MA's) colour;
  * CONTROL -- every pixel column across a continuous stretch must hold one, so
               "fix it by drawing nothing" fails too.

Usage (from the repo root; app/node_modules installed):
    python tools/fundamentals_gap_pixels.py            # starts vite on a free port
    python tools/fundamentals_gap_pixels.py --url http://127.0.0.1:5199
Exit 0 = every case passed. Prints one line per case.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

CASES = ["tsla-eps", "tsla-margin", "tsla-roe", "celh-ni", "aapl-rev", "stress"]
APP = Path(__file__).resolve().parents[1] / "app"
MARGIN = 4          # px kept clear of each gap edge: a step's riser sits ON the edge bar


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait(url: str, secs: float = 90) -> None:
    # ⚠️ vite on Windows binds IPv6-only unless told --host 127.0.0.1; poll the URL, never stdout
    end = time.time() + secs
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=3)
            return
        except Exception:
            time.sleep(0.5)
    raise SystemExit(f"vite never answered {url}")


def _hex(c: str) -> tuple[int, int, int]:
    c = c.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def _near(px, rgb) -> bool:
    """HUE DOMINANCE, not an exact match: a 1-2px line is anti-aliased onto the black
    background, so its pixels are darker shades of its colour. The two colours used
    (#00ff00 line, #ff00ff MA) are chosen so dominance cannot confuse them."""
    r, g, b = px[:3]
    if rgb == (0, 255, 0):
        return g >= 60 and g >= r + 40 and g >= b + 40
    if rgb == (255, 0, 255):
        return r >= 60 and b >= 60 and r >= g + 40 and b >= g + 40
    return abs(r - rgb[0]) + abs(g - rgb[1]) + abs(b - rgb[2]) <= 60


def _columns_with(img: Image.Image, x0: int, x1: int, rgb) -> list[int]:
    w, h = img.size
    hits = []
    for x in range(max(0, x0), min(w - 1, x1) + 1):
        for y in range(h):
            if _near(img.getpixel((x, y)), rgb):
                hits.append(x)
                break
    return hits


def run_case(page, base: str, case: str) -> dict:
    page.goto(f"{base}/fundamentals-gap-harness.html?case={case}")
    page.wait_for_function("window.__gapHarness && window.__gapHarness.ready", timeout=60000)
    time.sleep(0.4)
    meta = page.evaluate("window.__gapHarness")
    img = Image.open(io.BytesIO(page.locator("#chart").screenshot())).convert("RGB")
    colours = [_hex(meta["colors"]["line"])] + ([_hex(meta["colors"]["ma"])] if meta["colors"].get("ma") else [])
    out = {"case": case, "renderSeries": meta["renderSeries"], "perf": meta.get("perf"), "gaps": [], "control": None, "ok": True}
    if case == "stress":
        # 8 lines x 29 runs + an MA each: the first bind must stay interactive, the tick cheap
        p = meta["perf"]
        out["ok"] = p["firstSyncMs"] < 1500 and p["resyncMs"] < 50 and p["paintMs"] < 1000
        return out
    for g in meta["gaps"]:
        x0, x1 = int(g[0]) + MARGIN, int(g[1]) - MARGIN
        if x1 <= x0:
            continue
        bad = {c: _columns_with(img, x0, x1, rgb) for c, rgb in zip(("line", "ma"), colours)}
        n = sum(len(v) for v in bad.values())
        out["gaps"].append({"cols": [x0, x1], "width": x1 - x0 + 1, "crossing_columns": n,
                            **{f"{k}_first": (v[:3] if v else []) for k, v in bad.items()}})
        if n:
            out["ok"] = False
    if meta.get("control"):
        # the first and last bar sit ON the plot edge: keep the scan inside it
        x0, x1 = int(meta["control"][0]) + 2, int(meta["control"][1]) - 2
        # the MA is drawn OVER the line where they coincide: either colour is "a line here"
        hit = set().union(*(set(_columns_with(img, x0, x1, rgb)) for rgb in colours))
        missing = [x for x in range(x0, x1 + 1) if x not in hit]
        out["control"] = {"cols": [x0, x1], "missing_columns": len(missing), "first_missing": missing[:5]}
        if missing:
            out["ok"] = False
    if case.startswith("tsla") and not meta["gaps"]:
        out["ok"] = False                      # a gap case that found no gap proves nothing
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url")
    ap.add_argument("--save", help="directory to save one PNG per case")
    args = ap.parse_args(argv)
    proc = None
    base = args.url
    if not base:
        port = _free_port()
        base = f"http://127.0.0.1:{port}"
        npx = "npx.cmd" if os.name == "nt" else "npx"
        proc = subprocess.Popen([npx, "vite", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
                                cwd=APP, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        _wait(f"{base}/fundamentals-gap-harness.html")
        results = []
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1240, "height": 460}, device_scale_factor=1)
            for case in CASES:
                r = run_case(page, base, case)
                if args.save:
                    Path(args.save).mkdir(parents=True, exist_ok=True)
                    page.locator("#chart").screenshot(path=str(Path(args.save) / f"{case}.png"))
                results.append(r)
                print(json.dumps(r))
            browser.close()
        ok = all(r["ok"] for r in results)
        print("PASS" if ok else "FAIL")
        return 0 if ok else 1
    finally:
        if proc:
            proc.terminate()


if __name__ == "__main__":
    sys.exit(main())
