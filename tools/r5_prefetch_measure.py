"""R5 — does current+2 prefetch measurably help the phone review workflow?

⛔ WHY THIS EXISTS AS ITS OWN INSTRUMENT. The first attempt measured through a
Chrome the extension drives, and that Chrome is permanently occluded: measured
0.1 rAF fps and 1 Hz timers while reporting `hasFocus: true`. Latency sampled
there is the throttle, not the product. This launches a FOREGROUNDED Chromium
with backgrounding disabled and PROVES the instrument before collecting a single
sample — if the proof fails the run aborts rather than emitting numbers.

⭐ WARM VS COLD IS CLASSIFIED FROM EVIDENCE, NEVER ASSUMED. Every transition is
labelled by whether a `/api/bars/<SYM>` request actually went to the network
after the tap. Dwell time is varied only to PRODUCE both populations (a long
dwell lets current+2 get ahead; rapid-fire taps outrun it) — the label always
comes from the observed request, not from the dwell we intended.

T_USEFUL  first frame where the header shows the new symbol AND the chart canvas
          has changed from its pre-tap content — i.e. new candles are on screen
          and the member can begin reading the chart.
T_SETTLED first frame after which the canvas stops changing for QUIESCE_MS.
          Never a fixed sleep: quiescence is detected, and the cap is recorded
          as a censored sample rather than silently dropped.

Read-only against production. Seeds a review session through the app's OWN
sessionStorage contract (`uct.review.session`); changes no product code.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys

BASE = "https://uctintelligence.com"
QUIESCE_MS = 400
SETTLE_CAP_MS = 12000

# The measurement runs inside the page: one rAF loop owns both the canvas
# sampling and the clock, so T_USEFUL/T_SETTLED are frame-accurate rather than
# poll-accurate.
PAGE_JS = r"""
(() => {
  const q = {};
  window.__r5 = q;
  q.sym = () => {
    const b = [...document.querySelectorAll('button')]
      .find(x => /Change symbol/i.test(x.getAttribute('aria-label') || ''));
    return b ? (b.getAttribute('aria-label').match(/showing\s+(\S+)/) || [])[1] : null;
  };
  q.idx = () => {
    const b = [...document.querySelectorAll('button')]
      .find(x => /open the list/i.test(x.getAttribute('aria-label') || ''));
    return b ? (b.getAttribute('aria-label').match(/^(\d+)\s*\/\s*(\d+)/) || []).slice(1).join('/') : null;
  };
  q.btn = re => [...document.querySelectorAll('button')]
      .find(x => re.test(x.getAttribute('aria-label') || x.textContent || ''));
  // Largest canvas = the price chart. Sample a coarse grid; we only need "did
  // the picture change", not fidelity.
  q.canvas = () => {
    let best = null, area = 0;
    for (const c of document.querySelectorAll('canvas')) {
      const a = c.width * c.height;
      if (a > area) { area = a; best = c; }
    }
    return best;
  };
  q.sig = () => {
    const c = q.canvas(); if (!c) return null;
    try {
      const ctx = c.getContext('2d'); if (!ctx) return null;
      const w = c.width, h = c.height;
      const d = ctx.getImageData(0, 0, w, h).data;
      let hash = 0, step = Math.max(4, Math.floor(d.length / 4 / 4000)) * 4;
      for (let i = 0; i < d.length; i += step) hash = (hash * 31 + d[i] + d[i+1] * 3 + d[i+2] * 7) | 0;
      return hash;
    } catch (e) { return null; }
  };
  q.barsSince = (sym, t0) => performance.getEntriesByType('resource')
      .filter(r => r.name.includes('/api/bars/' + sym) && r.startTime >= t0);

  // One tap, measured to the frame.
  q.tap = (dir, quiesceMs, capMs) => new Promise(resolve => {
    const before = q.sym();
    const sigBefore = q.sig();
    const b = q.btn(dir === 'next' ? /Next symbol/ : /Previous symbol/);
    if (!b) return resolve({ err: 'no-button' });
    const t0 = performance.now();
    b.click();
    let sym = null, tUseful = null, lastSig = sigBefore, lastChange = null, frames = 0;
    const step = () => {
      frames++;
      const now = performance.now();
      const s = q.sym();
      const sig = q.sig();
      if (sig !== lastSig) { lastSig = sig; lastChange = now; }
      if (tUseful === null && s && s !== before && sig !== null && sig !== sigBefore) {
        sym = s; tUseful = now - t0;
      }
      if (tUseful !== null && lastChange !== null && now - lastChange >= quiesceMs) {
        const bars = q.barsSince(sym, t0);
        const done = bars.filter(r => r.responseEnd > 0);
        return resolve({
          before, sym, idx: q.idx(),
          tUseful: +tUseful.toFixed(1),
          tSettled: +((lastChange - t0)).toFixed(1),
          censored: false, frames,
          netFetch: done.length > 0,
          netMs: done.length ? +(Math.max(...done.map(r => r.responseEnd)) - t0).toFixed(1) : null,
        });
      }
      if (now - t0 > capMs) {
        const bars = q.barsSince(sym || before, t0);
        const done = bars.filter(r => r.responseEnd > 0);
        return resolve({
          before, sym, idx: q.idx(),
          tUseful: tUseful === null ? null : +tUseful.toFixed(1),
          tSettled: null, censored: true, frames,
          netFetch: done.length > 0,
          netMs: done.length ? +(Math.max(...done.map(r => r.responseEnd)) - t0).toFixed(1) : null,
        });
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
})();
"""


def pct(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    k = (len(s) - 1) * (p / 100)
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return round(s[lo] + (s[hi] - s[lo]) * (k - lo), 1)


def summarise(name, rows):
    useful = [r["tUseful"] for r in rows if r.get("tUseful") is not None]
    settled = [r["tSettled"] for r in rows if r.get("tSettled") is not None]
    net = [r for r in rows if r.get("netFetch")]
    return {
        "population": name,
        "n": len(rows),
        "n_useful": len(useful),
        "n_settled": len(settled),
        "censored": sum(1 for r in rows if r.get("censored")),
        "p50_useful_ms": pct(useful, 50), "p95_useful_ms": pct(useful, 95),
        "mean_useful_ms": round(statistics.fmean(useful), 1) if useful else None,
        "min_useful_ms": round(min(useful), 1) if useful else None,
        "max_useful_ms": round(max(useful), 1) if useful else None,
        "p50_settled_ms": pct(settled, 50), "p95_settled_ms": pct(settled, 95),
        "network_fetch_rate": round(len(net) / len(rows), 3) if rows else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=80)
    ap.add_argument("--symbols", type=int, default=60)
    ap.add_argument("--out", default="tools/r5_prefetch_out.json")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=[
                # The whole point: no background throttling of any kind.
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
                "--disable-features=CalculateNativeWinOcclusion",
                "--autoplay-policy=no-user-gesture-required",
            ],
        )
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=3,
            is_mobile=True, has_touch=True,
            user_agent=("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"),
        )
        page = ctx.new_page()
        page.goto(f"{BASE}/charts", wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(9000)

        # ── PROVE THE INSTRUMENT ────────────────────────────────────────────
        proof = page.evaluate("""async () => {
          const t0 = performance.now();
          let raf = 0, timer = 0;
          const iv = setInterval(() => timer++, 50);
          await new Promise(res => { const tick = () => { raf++;
            if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(); };
            requestAnimationFrame(tick); });
          clearInterval(iv);
          const el = performance.now() - t0;
          return { elapsedMs: Math.round(el), fps: +(raf / (el/1000)).toFixed(1),
                   timerHz: +(timer / (el/1000)).toFixed(1),
                   visibility: document.visibilityState, hasFocus: document.hasFocus(),
                   canvases: document.querySelectorAll('canvas').length,
                   coarse: matchMedia('(pointer: coarse)').matches,
                   mobileShell: document.documentElement.getAttribute('data-mobile-chart-shell'),
                   apiCalls: performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/')).length };
        }""")
        print("INSTRUMENT PROOF:", json.dumps(proof, indent=2))
        ok = (proof["visibility"] == "visible" and proof["fps"] >= 30
              and proof["timerHz"] >= 10 and proof["canvases"] > 0 and proof["apiCalls"] > 0)
        if not ok:
            print("INSTRUMENT PROOF FAILED — refusing to emit latency numbers.")
            browser.close()
            return 2

        # Seed a review session through the app's own contract.
        syms = page.evaluate("""async (n) => {
          const r = await fetch('/api/ticker-search?q=&limit=200').then(x=>x.json()).catch(()=>null);
          let list = (r && r.results ? r.results.map(x=>x.ticker) : []).filter(Boolean);
          if (list.length < n) list = list.concat(['AAPL','MSFT','NVDA','AMD','TSLA','META','AMZN','GOOGL','NFLX','CRM',
            'ORCL','INTC','QCOM','AVGO','TXN','MU','ADBE','NOW','SHOP','SQ','PYPL','UBER','ABNB','SNOW','DDOG',
            'NET','CRWD','ZS','OKTA','TEAM','PLTR','SMCI','ARM','ANET','PANW','WDAY','MDB','TTD','HUBS','ZM']);
          return [...new Set(list)].slice(0, n);
        }""", args.symbols)
        page.evaluate("""(syms) => {
          sessionStorage.setItem('uct.review.session', JSON.stringify({
            v:1, source:'screener', sourceId:null, label:'R5 measurement',
            sort:'measure', symbols:syms, index:0, seen:{}, pending:false
          }));
        }""", syms)
        page.goto(f"{BASE}/charts", wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(9000)
        page.evaluate(PAGE_JS)

        state = page.evaluate("() => ({sym: window.__r5.sym(), idx: window.__r5.idx()})")
        print("SESSION:", state, f"({len(syms)} symbols seeded)")
        if not state.get("idx"):
            print("Review session did not mount — aborting rather than measuring the wrong thing.")
            browser.close()
            return 3

        rows = []
        for i in range(args.samples):
            # Vary dwell ONLY to produce both populations; the label comes from
            # the observed network request, never from this choice.
            dwell = 2600 if (i % 4 == 0) else 120
            page.wait_for_timeout(dwell)
            try:
                r = page.evaluate(
                    "async ([d,q,c]) => await window.__r5.tap(d,q,c)",
                    ["next", QUIESCE_MS, SETTLE_CAP_MS])
            except Exception as e:  # noqa: BLE001
                r = {"err": str(e)[:120]}
            r["dwellMs"] = dwell
            r["i"] = i
            rows.append(r)
            if (i + 1) % 10 == 0:
                print(f"  {i+1}/{args.samples} samples")

        valid = [r for r in rows if r.get("sym") and r.get("tUseful") is not None]
        warm = [r for r in valid if not r["netFetch"]]
        cold = [r for r in valid if r["netFetch"]]

        out = {
            "base": BASE, "proof": proof,
            "samples_attempted": len(rows), "samples_valid": len(valid),
            "excluded": [{"i": r.get("i"), "reason": r.get("err") or ("no tUseful" if r.get("sym") else "no symbol change")}
                         for r in rows if r not in valid],
            "warm": summarise("WARM (no network fetch — prefetched/cached)", warm),
            "cold": summarise("COLD (network fetch occurred)", cold),
            "rows": rows,
        }
        for k in ("warm", "cold"):
            print(json.dumps(out[k], indent=2))
        w, c = out["warm"], out["cold"]
        if w["p50_useful_ms"] and c["p50_useful_ms"]:
            out["delta"] = {
                "p50_useful_abs_ms": round(c["p50_useful_ms"] - w["p50_useful_ms"], 1),
                "p50_useful_pct": round((c["p50_useful_ms"] - w["p50_useful_ms"]) / c["p50_useful_ms"] * 100, 1),
                "p95_useful_abs_ms": (round(c["p95_useful_ms"] - w["p95_useful_ms"], 1)
                                      if w["p95_useful_ms"] and c["p95_useful_ms"] else None),
                "p95_useful_pct": (round((c["p95_useful_ms"] - w["p95_useful_ms"]) / c["p95_useful_ms"] * 100, 1)
                                   if w["p95_useful_ms"] and c["p95_useful_ms"] else None),
            }
            print("DELTA:", json.dumps(out["delta"], indent=2))

        import pathlib
        pathlib.Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")
        print("wrote", args.out)
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
