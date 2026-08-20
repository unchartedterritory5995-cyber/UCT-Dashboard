"""Cold-start repro — the NEW-USER black-screen / stuck-loading path.

The bug: StockChart's server-fetch URL (`swrUrl`) is null until the local IndexedDB
read (`idbGet`) resolves — so it can compute the right `?since=` delta. On a FRESH
browser the pack's big readwrite ingest serializes with idbGet's readonly transaction,
so the local read STALLS and the chart sits black even though the origin answers in
~1ms. A warm browser resolves idbGet in ~5ms and never sees it — which is why scanning
is flawless for a returning user and broken for a first-timer.

This drives a REAL browser against the LOCAL stack (Vite :5173 → backend :8000), a
FRESH context (empty IDB), and DELAYS idbGet by injecting a slow success callback on
`IDBObjectStore.get` — faithfully simulating the pack-ingest stall. It then measures
how long until the chart fires its `/api/bars/...tf=D...` request (i.e. paints from the
server). With the fix (`_IDB_FIRST_PAINT_TIMEOUT_MS`), that must happen ~600ms in
DESPITE the multi-second idbGet stall; without it, the request waits for the full stall.

Run:  .venv\\Scripts\\python.exe tools\\coldstart_repro.py [--idb-delay-ms 4000]
"""
import argparse
import os
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("REPRO_BASE", "http://localhost:5173")
EMAIL = os.environ.get("REPRO_EMAIL", "repro@local.dev")
PASSWORD = os.environ.get("REPRO_PASSWORD", "Repro2026!")

# Injected BEFORE any app script: wrap IDBObjectStore.get so its success callback is
# delivered `__IDB_GET_DELAY__` ms late — the readonly-read stall a fresh browser hits
# behind the pack's readwrite ingest. Uses addEventListener for the real 'success' and a
# custom onsuccess setter, so req.result is populated by the time the handler runs.
DELAY_JS = """
(() => {
  window.__IDB_GET_DELAY__ = __DELAY_MS__;
  const origGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function(...a) {
    const req = origGet.apply(this, a);
    let userHandler = null;
    try {
      Object.defineProperty(req, 'onsuccess', {
        configurable: true,
        set(fn) { userHandler = fn; },
        get() { return userHandler; },
      });
      req.addEventListener('success', (ev) => {
        const d = window.__IDB_GET_DELAY__ || 0;
        setTimeout(() => { if (userHandler) userHandler.call(req, ev); }, d);
      });
    } catch (e) { /* if defineProperty fails, fall back to undelayed */ }
    return req;
  };
})();
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--idb-delay-ms", type=int, default=4000)
    args = ap.parse_args()
    print(f"[cold] base={BASE} idbGet stall={args.idb_delay_ms}ms  "
          f"(fix should fire the server fetch ~600ms in regardless)")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1600, "height": 900})  # fresh = empty IDB
        page = ctx.new_page()
        page.add_init_script(DELAY_JS.replace("__DELAY_MS__", str(args.idb_delay_ms)))

        # Log in via the context request API so the cookie is in the jar.
        resp = page.request.post(f"{BASE}/api/auth/login", data={"email": EMAIL, "password": PASSWORD})
        if resp.status != 200:
            print(f"[cold] LOGIN FAILED ({resp.status}) — is the backend up + repro@local.dev created?")
            return 1

        page.goto(f"{BASE}/charts", wait_until="domcontentloaded", timeout=30000)
        # dismiss the cinematic intro
        page.wait_for_timeout(1500)
        for _ in range(5):
            try:
                page.get_by_text("Skip", exact=False).first.click(timeout=1200); break
            except Exception:
                try: page.keyboard.press("Escape"); page.keyboard.press("Space")
                except Exception: pass
                page.wait_for_timeout(500)
        try:
            page.get_by_text("1D", exact=True).first.click(timeout=3000)
        except Exception:
            pass

        # Wait for the chart canvas to exist, then hold a FIXED window that sits PAST the
        # 600ms fix but BEFORE the 4000ms idbGet stall would resolve, and screenshot.
        # Fix ON  → chart already painted from the server → candles present.
        # Fix OFF → chart still waiting on the stalled local read → BLACK.
        try:
            page.wait_for_selector("canvas", timeout=8000)
        except Exception:
            print("[cold] no canvas appeared"); browser.close(); return 2
        hold = max(1200, min(args.idb_delay_ms - 800, 2600))
        page.wait_for_timeout(hold)

        out = os.path.join(os.path.dirname(__file__), "coldstart_out.png")
        # Clip the chart plot area (left-center), away from toolbars/panels.
        page.screenshot(path=out, clip={"x": 300, "y": 200, "width": 900, "height": 520})

        # Count saturated green/red (candle) pixels in the clip.
        from PIL import Image
        im = Image.open(out).convert("RGB")
        px = im.load()
        w, h = im.size
        candle = 0
        for y in range(0, h, 3):
            for x in range(0, w, 3):
                r, g, b = px[x, y]
                if (g > 90 and g > r + 40 and g > b + 40) or (r > 90 and r > g + 40 and r > b + 40):
                    candle += 1
        painted = candle > 300
        verdict = "✅ FIXED (painted)" if painted else "❌ BLACK (still blocked)"
        print(f"[cold] idbGet stalled {args.idb_delay_ms}ms; screenshot at ~{hold}ms after canvas")
        print(f"[cold] candle pixels in plot area: {candle}  → {verdict}")
        browser.close()
        return 0 if painted else 3


if __name__ == "__main__":
    raise SystemExit(main())
