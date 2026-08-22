"""Offline reproduction harness for the intraday (5m) chart stall.

Drives a REAL browser (Playwright/Chromium) against the LOCAL app (Vite :5173 → backend
:8000), seeds bloated 5m entries into IndexedDB, switches the chart between tickers on
5m, and measures the wall-clock time-to-paint for each switch — so the "10s stall" can be
reproduced + a fix verified in seconds instead of a 10-min deploy.

Prereqs (run-local.ps1 or the two uvicorn/vite servers): backend on :8000, Vite on :5173,
an admin account (repro@local.dev / Repro2026!). Run:  .venv\\Scripts\\python.exe tools\\intraday_repro.py
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("REPRO_BASE", "http://localhost:5173")
EMAIL = os.environ.get("REPRO_EMAIL", "repro@local.dev")
PASSWORD = os.environ.get("REPRO_PASSWORD", "Repro2026!")
TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMD"]
BLOAT_BARS = int(os.environ.get("REPRO_BLOAT_BARS", "20000"))   # ~a year of 5m — the stall trigger
OUT = os.path.join(os.path.dirname(__file__), "intraday_repro_out")
os.makedirs(OUT, exist_ok=True)


# JS injected into the page to seed IDB with big 5m series (recent tail so it's "fresh").
SEED_JS = """
async ([tickers, nBars, cacheVer]) => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('uct_bars_v1');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  // End the seed at the PRIOR closed session (~yesterday 15:55 ET) to mimic the intraday
  // PACK (prior sessions only; today fills via the since-fetch). realistic scale so the
  // real since-fetch merges cleanly.
  const dayMs = 86400000;
  const yst = new Date(Date.now() - dayMs);
  // yesterday 15:55 ET ≈ 19:55 UTC (EDT). Coarse but fine for the repro.
  const endSec = Math.floor(Date.UTC(yst.getUTCFullYear(), yst.getUTCMonth(), yst.getUTCDate(), 19, 55, 0) / 1000);
  const step = 300; // 5m
  function series(base) {
    const bars = new Array(nBars);
    for (let i = 0; i < nBars; i++) {
      const t = endSec - (nBars - 1 - i) * step;
      const p = base + Math.sin(i / 40) * (base * 0.02);
      bars[i] = { t, o: p, h: p * 1.002, l: p * 0.998, c: p, v: 1000 + (i % 500) };
    }
    return bars;
  }
  const tx = db.transaction('bars', 'readwrite');
  const st = tx.objectStore('bars');
  let bases = { AAPL: 230, MSFT: 500, NVDA: 180, GOOGL: 344, AMD: 165 };
  for (const sym of tickers) {
    const bars = series(bases[sym] || 100);
    st.put({ key: sym + '_5', bars, lastT: bars[bars.length - 1].t, savedAt: Date.now(), v: cacheVer });
  }
  await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; tx.onabort = res; });
  return tickers.map(s => s + '_5');
}
"""

# Read CACHE_LOGIC_VERSION from barsIDB.js so the seed matches (else idbGet treats it as absent).
def _cache_ver():
    import re
    src = open(os.path.join(os.path.dirname(__file__), "..", "app", "src", "utils", "barsIDB.js"), encoding="utf-8").read()
    m = re.search(r"CACHE_LOGIC_VERSION\s*=\s*(\d+)", src)
    return int(m.group(1)) if m else 6


def main():
    cache_ver = _cache_ver()
    print(f"[repro] cache version {cache_ver}, bloat {BLOAT_BARS} bars/ticker, base {BASE}")
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("PW_CHROME") or None, headless=True)
        ctx = browser.new_context(viewport={"width": 1600, "height": 900})
        page = ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))

        # Auth: POST via the context request API so the cookie lands in the jar.
        resp = page.request.post(f"{BASE}/api/auth/login",
                                 data={"email": EMAIL, "password": PASSWORD})
        print(f"[repro] login → {resp.status}")
        if resp.status != 200:
            print("[repro] LOGIN FAILED — is the backend up + account created?"); sys.exit(1)

        page.goto(f"{BASE}/charts", wait_until="domcontentloaded", timeout=30000)
        # Dismiss the cinematic intro (plays ~9s on every load). Click SKIP; fall back to keys.
        page.wait_for_timeout(1500)
        for _ in range(4):
            try:
                page.get_by_text("Skip", exact=False).first.click(timeout=1500)
                break
            except Exception:
                try:
                    page.keyboard.press("Escape"); page.keyboard.press("Space")
                except Exception:
                    pass
                page.wait_for_timeout(600)
        page.wait_for_timeout(3500)

        # Seed the bloated entries (IDB persists; chart reads them on the next symbol switch).
        keys = page.evaluate(SEED_JS, [TICKERS, BLOAT_BARS, cache_ver])
        print(f"[repro] seeded {keys}")

        page.screenshot(path=os.path.join(OUT, "01_charts.png"))

        # Select 5m on the (first) chart's TF bar.
        try:
            page.get_by_text("5m", exact=True).first.click(timeout=3000)
            page.wait_for_timeout(600)
        except Exception as e:
            print("[repro] 5m click failed:", e)

        def switch_and_measure(sym, hold_ms=9000):
            # Focus the chart body, then type-to-search the ticker (chart is tabIndex=0:
            # typing opens SymbolSearch prefilled; Enter switches).
            page.mouse.click(760, 430)
            page.wait_for_timeout(150)
            # Start a main-thread block monitor: the biggest gap between rAF ticks == the
            # longest time the main thread was blocked (the render stall).
            page.evaluate("""(hold) => {
              window.__mb = 0; const start = performance.now(); let last = start;
              (function tick(){ const n = performance.now(); const g = n - last;
                if (g > window.__mb) window.__mb = g; last = n;
                if (n - start < hold) requestAnimationFrame(tick); })();
            }""", hold_ms + 1500)
            t0 = time.time()
            page.keyboard.type(sym, delay=25)
            page.wait_for_timeout(250)
            page.keyboard.press("Enter")
            page.wait_for_timeout(hold_ms)
            mb = page.evaluate("() => window.__mb")
            # what the readout close currently shows (to confirm the switch landed)
            readout = page.evaluate("""() => {
              const t = [...document.querySelectorAll('*')].map(e=>e.textContent||'');
              const hdr = document.querySelector('[class*=header] , h1, h2'); return (document.title||'').slice(0,30);
            }""")
            return mb, round(time.time() - t0, 1)

        print("\n[repro] === switch timings (max main-thread block per switch) ===")
        for sym in ["AAPL", "MSFT", "NVDA", "AAPL", "GOOGL"]:
            mb, wall = switch_and_measure(sym)
            flag = "  <-- STALL" if mb > 1000 else ""
            print(f"[repro] switch->{sym}: max block {mb:.0f}ms (waited {wall}s){flag}")
        page.screenshot(path=os.path.join(OUT, "02_after_switch.png"))

        for l in logs[-15:]:
            print("  console:", l[:160])
        browser.close()


if __name__ == "__main__":
    main()
