// C1-123 real-browser probe (LOCAL agent harness, synthetic bars; REAL BROWSER input via CDP, not production).
// Real right-clicks on the chart's open price area, price axis and volume; for each: the menu's rows, and for the
// "Add indicator…" row its rect and document.elementFromPoint at its centre. Then a real left click at that centre and
// whether the indicator library opened. Raw JSON to argv[2]; written before anyone reads it.
// From app/: BA_BASE=http://127.0.0.1:5303 node ../docs/agent/program/evidence/chart-menu-add-indicator/probe.mjs <out.json>
import { writeFileSync } from 'node:fs'
const { startRelay, open, sleep } = await import('../../../../../app/src/testing/agent/acceptance/lib.mjs')
const out = process.argv[2]
const R = await startRelay({ groupOfAction: () => null })
const rec = { mode: 'REAL BROWSER (headless Chrome, CDP mouse input) on the LOCAL agent harness, synthetic bars: not production', at: new Date().toISOString(), base: process.env.BA_BASE, tries: [] }
let p
const GEOM = `(() => {
  const cell = document.querySelector('[data-widget-type="chart"]')
  const table = cell && cell.querySelector('.tv-lightweight-charts table')
  if (!table) return null
  const rows = [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')].filter(tr => tr.getBoundingClientRect().height > 8)
  const tds = [...rows[0].children]
  const plot = tds.reduce((a, b) => (b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a))
  const axis = tds[tds.indexOf(plot) + 1]
  const B = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height } }
  return { widgetId: cell.getAttribute('data-widget-id'), plot: B(plot), axis: axis ? B(axis) : null }
})()`
const MENU = `(() => {
  const m = document.querySelector('[data-guide="chart.contextMenu"]')
  if (!m) return { open: false }
  const ids = [...m.querySelectorAll('[data-menu-id]')].map(b => b.getAttribute('data-menu-id'))
  const row = m.querySelector('[data-menu-id="ind-add"]')
  let hit = null
  if (row) {
    const r = row.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const e = document.elementFromPoint(cx, cy)
    hit = { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], centre: { x: Math.round(cx), y: Math.round(cy) },
      elementFromPoint: e ? { tag: e.tagName, menuId: e.closest('[data-menu-id]')?.getAttribute('data-menu-id') || null, text: (e.textContent || '').trim().slice(0, 40) } : null,
      isTheRow: !!(e && (e === row || row.contains(e))), text: row.textContent.trim() }
  }
  return { open: true, ids, addIndicator: hit }
})()`
const rclick = async (x, y) => {
  await p.b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(250)
  for (const type of ['mousePressed', 'mouseReleased']) await p.b.send('Input.dispatchMouseEvent', { type, x, y, button: 'right', clickCount: 1 })
  await sleep(600)
}
const menuUp = () => p.b.evaluate(`!!document.querySelector('[data-guide="chart.contextMenu"]')`)
// close an open menu, as a person would (Escape, then a click on the backdrop if it stayed); returns whether it closed
const esc = async () => {
  if (!(await menuUp())) return true
  await p.b.key('Escape'); await sleep(300)
  if (await menuUp()) { const bd = await p.b.evaluate(`(() => { const e = document.querySelector('[class*="chartCtxBackdrop"]'); if (!e) return null; return { x: 3, y: 3 } })()`); if (bd) { await p.b.click(bd.x, bd.y); await sleep(300) } }
  return !(await menuUp())
}
try {
  p = await open(R, { width: 1600, height: 950 })
  await sleep(2500)
  const g = await p.b.evaluate(GEOM)
  rec.geometry = g
  const at = (b, fx, fy) => ({ x: Math.round(b.left + b.width * fx), y: Math.round(b.top + b.height * fy) })
  const plan = [
    ['price area (upper plot, off the candles)', at(g.plot, 0.5, 0.12)],
    ['price area (mid plot)', at(g.plot, 0.5, 0.45)],
    ['price axis', g.axis ? at(g.axis, 0.5, 0.4) : null],
    ['volume (bottom of plot)', at(g.plot, 0.6, 0.95)],
  ]
  for (const [where, pt] of plan) {
    if (!pt) { rec.tries.push({ where, skipped: 'no such region' }); continue }
    await rclick(pt.x, pt.y)
    const menu = await p.b.evaluate(MENU)
    rec.tries.push({ where, at: pt, menu, closedAfter: await esc() })
  }
  // the real click: reopen at the first point that offered the row, left-click the row's centre
  const first = rec.tries.find(t => t.menu?.addIndicator?.isTheRow)
  if (first) {
    let m = null
    rec.click = { where: first.where, reopen: [] }
    for (let k = 0; k < 3; k++) {
      await esc()
      await rclick(first.at.x, first.at.y)
      m = await p.b.evaluate(MENU)
      rec.click.reopen.push(m)
      if (m.addIndicator?.isTheRow) break
    }
    if (!m.addIndicator?.isTheRow) throw new Error('reopen: the row was not offered (see click.reopen)')
    rec.click.before = m.addIndicator
    await p.b.click(m.addIndicator.centre.x, m.addIndicator.centre.y)
    await sleep(1500)
    rec.click.after = await p.b.evaluate(`({ menuOpen: !!document.querySelector('[data-guide="chart.contextMenu"]'), libraryOpen: !!document.querySelector('[aria-label="Search indicators"]') })`)
  } else rec.click = { skipped: 'no point offered the row' }
  rec.consoleErrors = p.errors().slice(0, 5)
} catch (e) { rec.error = String(e?.stack || e) } finally {
  try { await p?.close() } catch { /* */ }
  R.close()
}
writeFileSync(out, JSON.stringify(rec, null, 1))
console.log('written', out)
process.exit(0)
