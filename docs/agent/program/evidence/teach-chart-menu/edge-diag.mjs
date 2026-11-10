// Diagnostic (REAL BROWSER CDP input on the LOCAL harness): a right-click near the chart cell's right edge. Is the menu's
// last row (ask-ai) visible past the cell (elementFromPoint across the row), and what clips? Raw JSON to argv[2].
import { writeFileSync } from 'node:fs'
const { startRelay, open, sleep } = await import('../../../../../app/src/testing/agent/acceptance/lib.mjs')
const R = await startRelay({ groupOfAction: () => null })
const rec = { mode: 'REAL BROWSER (CDP) on the LOCAL agent harness, synthetic bars: diagnostic', at: new Date().toISOString(), tries: [] }
let p
try {
  p = await open(R, { width: 1600, height: 950 })
  await sleep(2500)
  const g = await p.b.evaluate(`(() => { const cell = document.querySelector('[data-widget-type="chart"]'); const c = cell.getBoundingClientRect(); const t = cell.querySelector('.tv-lightweight-charts table'); const tr = [...t.querySelectorAll(':scope > tbody > tr, :scope > tr')].filter(x => x.getBoundingClientRect().height > 8)[0]; const plot = [...tr.children].reduce((a, b) => (b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a)).getBoundingClientRect(); return { cell: [c.left, c.top, c.width, c.height].map(Math.round), plot: [plot.left, plot.top, plot.width, plot.height].map(Math.round) } })()`)
  rec.geometry = g
  for (const fx of [0.5, 0.92]) {
    const x = Math.round(g.plot[0] + g.plot[2] * fx), y = Math.round(g.plot[1] + g.plot[3] * 0.4)
    await p.b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(250)
    for (const type of ['mousePressed', 'mouseReleased']) await p.b.send('Input.dispatchMouseEvent', { type, x, y, button: 'right', clickCount: 1 })
    await sleep(800)
    const m = await p.b.evaluate(`(() => { const m = document.querySelector('[data-guide="chart.contextMenu"]'); if (!m) return null; const r = m.getBoundingClientRect(); const row = m.querySelector('[data-menu-id="ask-ai"]'); const rr = row && row.getBoundingClientRect()
      const probe = (px, py) => { const e = document.elementFromPoint(px, py); return e ? (e.closest('[data-menu-id]')?.getAttribute('data-menu-id') || e.tagName) : null }
      // which ancestors clip (overflow not visible)
      const clips = []; for (let a = m.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflow !== 'visible' || cs.overflowX !== 'visible') { const b = a.getBoundingClientRect(); clips.push({ tag: a.tagName, cls: String(a.className).slice(0, 40), overflow: cs.overflow, box: [b.left, b.top, b.width, b.height].map(Math.round) }) } }
      return { menu: [r.left, r.top, r.width, r.height].map(Math.round), position: getComputedStyle(m).position, askAi: rr && [rr.left, rr.top, rr.width, rr.height].map(Math.round),
        hits: rr ? [0.1, 0.5, 0.9].map(f => ({ f, x: Math.round(rr.left + rr.width * f), at: probe(rr.left + rr.width * f, rr.top + rr.height / 2) })) : null, clips } })()`)
    rec.tries.push({ fx, at: { x, y }, menu: m })
    await p.b.click(2, 2); await sleep(400)
  }
  rec.consoleErrors = p.errors().slice(0, 5)
} catch (e) { rec.error = String(e?.stack || e) } finally { try { await p?.close() } catch {} R.close() }
writeFileSync(process.argv[2], JSON.stringify(rec, null, 1)); console.log('written'); process.exit(0)
