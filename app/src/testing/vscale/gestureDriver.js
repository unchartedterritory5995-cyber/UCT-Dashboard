// app/src/testing/vscale/gestureDriver.js
//
// ─── THE GESTURES, AND THE ONE NUMBER THAT SETTLES THE ARGUMENT ─────────────
//
// ⛔ WHY A DRIVER AND NOT JUST A MOUSE. The claim under test — "pan X must not
// compound scale Y" — needs TWENTY-PLUS navigation operations per case, across
// six pane topologies and both drag directions. Driving that by hand is neither
// repeatable nor comparable run to run. This dispatches the SAME event stream the
// browser delivers for a real drag (pointerdown → N pointermoves spread over
// frames → pointerup, each paired with its mouse event), against the real canvas,
// so lightweight-charts cannot tell the difference — and a one-shot
// down-move-up does not pan at all, which is exactly why the steps matter.
//
// ⭐⭐ AND THE MEASUREMENT IS THE **SCALE**, NOT THE CANDLE BAND. `occPct` — the
// share of the pane the visible candles fill — MOVES LEGITIMATELY as you pan,
// because different bars have a different high-low. Reading it alone cannot tell
// "the member navigated to a quieter stretch" from "the chart re-scaled itself",
// and that ambiguity is how a vertical-scale defect hides. `topPrice` / `botPrice`
// — the price at the top and bottom edge of PRICE's own pane — are properties of
// the scale only. Under the invariant they are CONSTANT through any amount of
// time navigation, whatever the bars are doing.
//
// Dev-only: imported by `vscaleHarness.jsx`, which `vite build` never sees.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A press that TRAVELS — the only kind that moves a chart. */
export async function gesture(x0, y0, x1, y1, steps = 10) {
  const el = document.elementFromPoint(x0, y0)
  if (!el) return
  const pe = (t, x, y) => new PointerEvent(t, {
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0,
    buttons: t === 'pointerup' ? 0 : 1,
  })
  const me = (t, x, y) => new MouseEvent(t, {
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
    button: 0, buttons: t === 'mouseup' ? 0 : 1,
  })
  el.dispatchEvent(pe('pointerdown', x0, y0)); el.dispatchEvent(me('mousedown', x0, y0))
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / steps)
    const y = Math.round(y0 + (y1 - y0) * i / steps)
    await sleep(14)
    const t = document.elementFromPoint(x, y) || el
    t.dispatchEvent(pe('pointermove', x, y)); t.dispatchEvent(me('mousemove', x, y))
  }
  await sleep(14)
  const t = document.elementFromPoint(Math.round(x1), Math.round(y1)) || el
  t.dispatchEvent(pe('pointerup', x1, y1)); t.dispatchEvent(me('mouseup', x1, y1))
  await sleep(70)
}

export async function wheel(x, y, deltaY) {
  const el = document.elementFromPoint(x, y)
  if (!el) return
  el.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, deltaY, deltaMode: 0,
  }))
  await sleep(70)
}

/**
 * The PRICE SCALE's own state, read off the renderer through the component's
 * read-only debug handle. `topPrice`/`botPrice` are the prices at the top and
 * bottom edge of PRICE's pane — the scale, with the data divided out.
 */
export function readScale(chartId = 'main') {
  const d = (typeof window !== 'undefined' && window.__uctChartDebug) ? window.__uctChartDebug[chartId] : null
  if (!d || !d.priceGeometry) return null
  const g = d.priceGeometry()
  if (!g || !g.paneHeight) return null
  // Two known prices give the linear map; the pane's edges follow.
  const p1 = 100, p2 = 200
  const y1 = d.priceToY(p1), y2 = d.priceToY(p2)
  if (y1 == null || y2 == null || y1 === y2) return null
  const k = (p2 - p1) / (y2 - y1)
  const vr = d.visibleRange()
  return {
    topPrice: +(p1 + (0 - y1) * k).toFixed(3),
    botPrice: +(p1 + (g.paneHeight - y1) * k).toFixed(3),
    span: +((g.paneHeight) * -k).toFixed(3),
    paneH: +g.paneHeight.toFixed(1),
    paneIndex: g.paneIndex,
    paneHeights: g.paneHeights.map((h) => (h == null ? null : Math.round(h))),
    margins: g.scaleMargins ? [+g.scaleMargins.top.toFixed(4), +g.scaleMargins.bottom.toFixed(4)] : null,
    pin: g.manualPin ? [+g.manualPin.minValue.toFixed(2), +g.manualPin.maxValue.toFixed(2)] : null,
    lock: g.viewLock ? [g.viewLock.top, g.viewLock.bottom, g.viewLock.anchorFrac] : null,
    visibleRange: vr ? [+vr.from.toFixed(2), +vr.to.toFixed(2)] : null,
  }
}

/** localStorage view-lock writes, so "no persistence churn" is a count. */
export function countLockWrites() {
  if (window.__vscaleLsPatched) return
  window.__vscaleLsPatched = true
  window.__vscaleLsWrites = 0
  const set = Storage.prototype.setItem
  Storage.prototype.setItem = function patched(k, v) {
    if (String(k).includes('viewLock')) window.__vscaleLsWrites += 1
    return set.call(this, k, v)
  }
}
