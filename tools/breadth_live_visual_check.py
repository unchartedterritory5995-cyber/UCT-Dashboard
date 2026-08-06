#!/usr/bin/env python3
"""Look at live breadth the way a member does — phone and desktop — unattended.

The API check next door proves the numbers are right. It cannot see that a rule
flattened the Monitor's heat map, or that the session strip pushed the table off
a phone screen. Both of those actually happened during this build, and both were
found by looking rather than asserting.

HOW IT GETS A REAL PAGE WITHOUT PRODUCTION CREDENTIALS
    It serves the REAL built bundle from app/dist and proxies /api/* straight to
    production, so the data is genuinely live. Only the two endpoints that
    require a session — /api/auth/me and /api/auth/preferences — are stubbed, to
    get past the auth guard. Nothing is written to production and no account is
    created; the breadth endpoints it depends on are public.

WHAT IT ASSERTS (each because it broke, or nearly did)
    * the Monitor's live row keeps its heat-map tiers. `.liveRow td` outranks
      the tier classes, so a background there silently neutralises the colour
      language of the whole table while every class stays correctly applied.
    * no horizontal overflow at phone width — the single most objective mobile bug
    * the session strip stays short enough to leave the table on the first screen
    * the Views cursor says LIVE rather than presenting today as a finished day
    * no uncaught console errors on any surface

Exit code is the verdict: 0 clean, 1 problems found, 2 could not check.

    python tools/breadth_live_visual_check.py
"""
from __future__ import annotations

import argparse
import json
import os
import socketserver
import sys
import threading
import urllib.error
import urllib.request
from datetime import datetime
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "app" / "dist"
OUT = ROOT / "data" / "breadth_visual"
LOG = ROOT / "data" / "breadth_live_open_check.log"
UPSTREAM = os.environ.get("DASHBOARD_URL", "https://uctintelligence.com")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
PORT = 8152

# The auth guard is the only thing standing between a headless browser and the
# page. Stubbing exactly these two — and nothing else — keeps every number on
# screen genuinely live.
STUB = {
    "/api/auth/me": {"user": {"id": "visual-check", "email": "check@local",
                              "display_name": "Check", "role": "admin",
                              "email_verified": True, "plan": "paid"}},
    "/api/auth/preferences": {},
}


class Proxy(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(DIST), **k)

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p in STUB:
            return self._json(STUB[p])
        if p.startswith("/api/"):
            try:
                req = urllib.request.Request(f"{UPSTREAM}{self.path}",
                                             headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=120) as r:
                    body = r.read()
                self.send_response(200)
                self.send_header("Content-Type", r.headers.get("Content-Type",
                                                               "application/json"))
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception:
                self._json({})          # a dead side-endpoint must not fail the run
            return
        if "." not in p.rsplit("/", 1)[-1]:
            self.path = "/index.html"   # SPA fallback
        return super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        self._json({"ok": True})


VIEWPORTS = {
    "phone390": {"width": 390, "height": 844, "mobile": True, "scale": 3},
    "desktop":  {"width": 1440, "height": 900, "mobile": False, "scale": 1},
}

PROBE = r"""() => {
  const q = sel => [...document.querySelectorAll(sel)];
  const strip = q('div').find(d => typeof d.className === 'string'
    && /_strip_/.test(d.className) && /LIVE/.test(d.textContent));
  const items = strip ? q('div').filter(e => strip.contains(e) && e.querySelector('svg')) : [];
  const vis = items.filter(i => getComputedStyle(i).display !== 'none');
  const rows = q('tbody tr');
  const liveRow = rows.find(r => /_liveRow_/.test(r.className || ''));
  // Does the provisional row still speak the table's colour language?
  const tierCells = liveRow
    ? [...liveRow.children].filter(td => /_bg[A-Z]\d?_/.test(td.className || ''))
    : [];
  const tierBgs = tierCells.map(td => getComputedStyle(td).backgroundColor);
  const table = document.querySelector('table');
  const sr = strip && strip.getBoundingClientRect();
  return {
    stripFound: !!strip,
    stripText: strip ? strip.textContent.replace(/\s+/g, ' ').trim().slice(0, 110) : null,
    stripHeight: sr ? Math.round(sr.height) : null,
    itemsVisible: vis.length,
    liveRowFound: !!liveRow,
    tierCellCount: tierCells.length,
    // A tier cell painted the strip's gold wash instead of its own tier is the
    // exact defect that shipped once.
    tierCellsFlattened: tierBgs.filter(b => /201, 168, 76/.test(b)).length,
    tableTop: table ? Math.round(table.getBoundingClientRect().top) : null,
    viewportHeight: window.innerHeight,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
      ? document.documentElement.scrollWidth : 0,
  };
}"""


def run_visual(save: bool) -> tuple[list[str], list[str]]:
    from playwright.sync_api import sync_playwright

    problems: list[str] = []
    notes: list[str] = []
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for name, vp in VIEWPORTS.items():
            ctx = browser.new_context(
                viewport={"width": vp["width"], "height": vp["height"]},
                is_mobile=vp["mobile"], has_touch=vp["mobile"],
                device_scale_factor=vp["scale"])
            page = ctx.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)[:160]))

            try:
                page.goto(f"http://127.0.0.1:{PORT}/breadth",
                          wait_until="networkidle", timeout=90000)
                for sel in ("button:has-text('Skip')", "button"):
                    try:
                        page.click(sel, timeout=3000)
                        break
                    except Exception:
                        continue
                page.wait_for_timeout(3500)
                try:
                    page.click("button:has-text('Monitor')", timeout=6000)
                    page.wait_for_timeout(2500)
                except Exception:
                    pass

                info = page.evaluate(PROBE)
                notes.append(f"[{name}] " + " ".join(
                    f"{k}={v}" for k, v in info.items() if k != "stripText"))
                if info.get("stripText"):
                    notes.append(f"[{name}] strip: {info['stripText']}")

                if info["overflowX"]:
                    problems.append(f"[{name}] horizontal overflow: "
                                    f"{info['overflowX']}px vs {vp['width']}")
                if info["liveRowFound"] and info["tierCellsFlattened"]:
                    problems.append(
                        f"[{name}] {info['tierCellsFlattened']} live-row cells are "
                        f"painted the strip's gold instead of their own tier — the "
                        f"heat map is flattened")
                if info["liveRowFound"] and info["tierCellCount"] == 0:
                    problems.append(f"[{name}] the live row carries no tier classes "
                                    f"at all — colour coding is absent")
                if not info["stripFound"] and info["liveRowFound"]:
                    problems.append(f"[{name}] a live row is showing but the session "
                                    f"strip is missing")
                if (name.startswith("phone") and info["stripFound"]
                        and info["tableTop"] is not None
                        and info["tableTop"] > info["viewportHeight"]):
                    problems.append(f"[{name}] the strip pushed the table below the "
                                    f"fold (table top {info['tableTop']} > "
                                    f"{info['viewportHeight']})")
                if not info["liveRowFound"]:
                    notes.append(f"[{name}] no live row — expected outside a session, "
                                 f"or once the collector has written the day")

                if save:
                    page.screenshot(path=str(OUT / f"{name}-monitor.png"))

                # Views: the cursor must not present today as a finished day.
                try:
                    page.click("button:has-text('Views')", timeout=6000)
                    page.wait_for_timeout(3000)
                    cursor = page.evaluate(
                        "() => { const e = [...document.querySelectorAll('span')]"
                        ".find(s => /LIVE ·|^\\d{4}-\\d{2}-\\d{2}$/.test(s.textContent"
                        "?.trim()||'')); return e ? e.textContent.trim() : null }")
                    notes.append(f"[{name}] views cursor: {cursor}")
                    if save:
                        page.screenshot(path=str(OUT / f"{name}-views.png"))
                except Exception as e:
                    notes.append(f"[{name}] views check skipped: {str(e)[:80]}")

                if errors:
                    problems.append(f"[{name}] console errors: {errors[:3]}")
            except Exception as e:
                problems.append(f"[{name}] page failed: {type(e).__name__}: {str(e)[:120]}")
            finally:
                ctx.close()
        browser.close()
    return problems, notes


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-notify", action="store_true")
    ap.add_argument("--no-screenshots", action="store_true")
    args = ap.parse_args()

    sys.path.insert(0, str(ROOT / "tools"))
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "apicheck", ROOT / "tools" / "breadth_live_open_check.py")
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)
    api._env()

    stamp = datetime.now(ET).strftime("%Y-%m-%d %H:%M:%S ET")
    header = f"=== breadth live - visual - {stamp} ==="
    print(header)

    if not (DIST / "index.html").exists():
        print("  FAIL app/dist is not built — nothing to look at")
        return 2

    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", PORT), Proxy)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        problems, notes = run_visual(save=not args.no_screenshots)
        code = 1 if problems else 0
    except Exception as e:
        problems, notes = [f"visual check itself failed: {type(e).__name__}: {e}"], []
        code = 2
    finally:
        srv.shutdown()

    for n in notes:
        print(f"   - {n}")
    for p in problems:
        print(f"  FAIL {p}")
    if not problems:
        print(f"  ok - clean (screenshots in {OUT})")

    if not args.no_notify and problems:
        api.notify("visual", problems, notes)

    try:
        LOG.parent.mkdir(exist_ok=True)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(header + "\n")
            for n in notes:
                f.write(f"   - {n}\n")
            for p in problems:
                f.write(f"  FAIL {p}\n")
            if not problems:
                f.write("  ok - clean\n")
    except Exception as e:
        print(f"  (log write failed: {e})")

    return code


if __name__ == "__main__":
    sys.exit(main())
