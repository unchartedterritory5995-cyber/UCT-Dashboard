// Diagnostic (LOCAL harness, synthetic bars; REAL BROWSER CDP input): where does a right-click offer "Candle settings"?
// For candle-pixel points (saturated pixels on the plot canvas) and a fine scan, right-click each and record the menu's
// settings-* row. Raw JSON to argv[2]. From app/: BA_BASE=... node ../docs/agent/program/evidence/teach-chart-menu/candle-diag.mjs <out>
import { writeFileSync } from 'node:fs'
const { startRelay, open, sleep } = await import('../../../../../app/src/testing/agent/acceptance/lib.mjs')
const R = await startRelay({ groupOfAction: () => null })
const rec = { mode: 'REAL BROWSER (CDP) on the LOCAL agent harness, synthetic bars: diagnostic', at: new Date().toISOString(), points: [] }
let p
try {
  p = await open(R, { width: 1600, height: 950 })
  await sleep(2500)
  const pts = await p.b.evaluate(`(() => {
    const cell = document.querySelector('[data-widget-type="chart"]'); const table = cell.querySelector('.tv-lightweight-charts table')
    const tr = [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')].filter(t => t.getBoundingClientRect().height > 8)[0]
    const plot = [...tr.children].reduce((a, b) => (b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a)).getBoundingClientRect()
    const cvs = [...cell.querySelectorAll('.tv-lightweight-charts canvas')].map(cv => { const b = cv.getBoundingClientRect(); return { w: cv.width, h: cv.height, left: b.left, top: b.top, bw: b.width, bh: b.height, z: getComputedStyle(cv).zIndex } })
    const out = { plot: { left: plot.left, top: plot.top, width: plot.width, height: plot.height }, canvases: cvs, candle: [], readError: null }
    try {
      const cv = [...cell.querySelectorAll('.tv-lightweight-charts canvas')].filter(c => { const b = c.getBoundingClientRect(); return b.width > plot.width * 0.8 && Math.abs(b.top - plot.top) < 4 })[0]
      const ctx = cv.getContext('2d'); const lb = cv.getBoundingClientRect(); const k = cv.width / lb.width
      for (const fx of [0.5, 0.7, 0.3]) { const x = Math.round(lb.width * fx * k); const d = ctx.getImageData(x, 0, 1, cv.height).data
        const runs = []; for (let y = 0; y < cv.height; y++) { const r = d[y*4], g = d[y*4+1], b = d[y*4+2]; if (Math.max(r,g,b) - Math.min(r,g,b) > 70) runs.push([y, r, g, b]) }
        out.candle.push({ fx, n: runs.length, first: runs.slice(0, 3), x: Math.round(lb.left + x / k), ys: runs.filter((_, i) => i % 4 === 0).slice(0, 6).map(([y]) => Math.round(lb.top + y / k)) }) }
    } catch (e) { out.readError = String(e) }
    return out
  })()`)
  rec.scan = pts
  const tries = []
  for (const c of pts.candle) for (const y of c.ys) tries.push({ x: c.x, y, from: 'candle-pixel' })
  for (let fy = 0.1; fy <= 0.9; fy += 0.1) tries.push({ x: Math.round(pts.plot.left + pts.plot.width * 0.5), y: Math.round(pts.plot.top + pts.plot.height * fy), from: 'scan' })
  for (const t of tries.slice(0, 24)) {
    await p.b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x, y: t.y, button: 'none' }); await sleep(200)
    for (const type of ['mousePressed', 'mouseReleased']) await p.b.send('Input.dispatchMouseEvent', { type, x: t.x, y: t.y, button: 'right', clickCount: 1 })
    await sleep(500)
    t.ids = await p.b.evaluate(`[...(document.querySelector('[data-guide="chart.contextMenu"]')?.querySelectorAll('[data-menu-id]') || [])].map(b => b.getAttribute('data-menu-id')).filter(i => /^settings-/.test(i))`)
    t.hit = await p.b.evaluate(`(() => { const e = document.elementFromPoint(${t.x}, ${t.y}); return e ? e.tagName + (e.className && typeof e.className === 'string' ? '.' + e.className.slice(0, 30) : '') : null })()`)
    rec.points.push(t)
    if (await p.b.evaluate(`!!document.querySelector('[data-guide="chart.contextMenu"]')`)) { await p.b.key('Escape'); await sleep(250) }
  }
} catch (e) { rec.error = String(e?.stack || e) } finally { try { await p?.close() } catch {} R.close() }
writeFileSync(process.argv[2], JSON.stringify(rec, null, 1)); console.log('written'); process.exit(0)
