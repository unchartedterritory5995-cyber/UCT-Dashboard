// app/src/components/chart/builder/memberPane/test-atrSrReplay.js
//
// ⭐ H9 (2026-10-04): renamed from `atrSrReplay.js`. It is TEST INFRASTRUCTURE (an
// oracle only `hybridObjects.test.js` imports), and `reachable.test.js`'s TEST_INFRA
// rule recognises a `test-*` file as such; under its old name it read as a shipped
// module no route reaches.
//
// RT9 — a HAND REPLAY of atr-support-and-resistance's zone boxes, written from the
// script's text and Pine's documented built-ins, with no engine code in it. It is
// the oracle the hybrid-drawings rail grades a run against at a NON-default input
// (no capture exists at one): validated first at the defaults against TradingView's
// own RDDT capture, then used where no capture can reach.
//
//   ta.atr(n)  = ta.rma(ta.tr(true), n)   — bar 0's true range is high - low
//   ta.tr      = ta.tr(false)             — `na` on bar 0
//   ta.rma     = seeded by the SMA of the first n values, then (prev*(n-1)+x)/n
//   impUp      = tr >= atr*mult and close > open and tr[1] <= atr[1]
//   up box     = (low, open) when the lower wick is at most `wick`% of the bar's tr
//   down box   = (high, open) for impDown, the upper wick likewise
// A box is never deleted (array.remove takes it off the list, not off the chart),
// so every one created is held at the last bar while the count stays under 50.

/** @param {{o:number,h:number,l:number,c:number}[]} bars
 *  @returns {{top:number,bottom:number,bar:number}[]} each created box, prices sorted */
export function atrSrBoxes(bars, { period = 14, mult = 1.55, wickPct = 25 } = {}) {
  const n = bars.length
  const trTrue = new Array(n)
  const trFalse = new Array(n)
  for (let i = 0; i < n; i += 1) {
    const b = bars[i]
    const hl = b.h - b.l
    if (i === 0) { trTrue[i] = hl; trFalse[i] = NaN; continue }
    const pc = bars[i - 1].c
    trTrue[i] = Math.max(hl, Math.abs(b.h - pc), Math.abs(b.l - pc))
    trFalse[i] = trTrue[i]
  }
  const atr = new Array(n).fill(NaN)
  for (let i = period - 1; i < n; i += 1) {
    if (i === period - 1) {
      let s = 0
      for (let k = 0; k < period; k += 1) s += trTrue[k]
      atr[i] = s / period
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + trTrue[i]) / period
    }
  }
  const cut = wickPct * 0.01
  const out = []
  for (let i = 1; i < n; i += 1) {
    const b = bars[i]
    const tr = trFalse[i]
    const imp = tr >= atr[i] * mult && trFalse[i - 1] <= atr[i - 1]
    if (!imp) continue
    if (b.c > b.o && (b.o - b.l) / tr <= cut) out.push({ bar: i, top: Math.max(b.l, b.o), bottom: Math.min(b.l, b.o) })
    if (b.c < b.o && (b.h - b.o) / tr <= cut) out.push({ bar: i, top: Math.max(b.h, b.o), bottom: Math.min(b.h, b.o) })
  }
  return out
}
