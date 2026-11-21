// Real-browser check (REAL BROWSER: headless Chrome, CDP mouse and key input, on the LOCAL agent harness, synthetic bars).
// A right-click opens the desktop chart menu; a real Escape key press closes it; focus is then the chart's region.
// Also: a second right-click + Escape; and the backdrop click still closes it. Raw JSON to argv[2], before anyone reads it.
// From app/: BA_BASE=http://127.0.0.1:5305 node ../docs/agent/program/evidence/chart-menu-escape/probe.mjs <out.json>
import { writeFileSync } from 'node:fs'
const { startRelay, open, sleep } = await import('../../../../../app/src/testing/agent/acceptance/lib.mjs')
const R = await startRelay({ groupOfAction: () => null })
const rec = { mode: 'REAL BROWSER (headless Chrome, CDP input) on the LOCAL agent harness, synthetic bars: not production', at: new Date().toISOString(), base: process.env.BA_BASE, steps: [] }
let p
const STATE = `(() => { const m = document.querySelector('[data-guide="chart.contextMenu"]'); const a = document.activeElement
  const cell = document.querySelector('[data-widget-type="chart"]')
  return { menuOpen: !!m, rows: m ? m.querySelectorAll('[data-menu-id]').length : 0,
    active: a ? { tag: a.tagName, role: a.getAttribute('role'), tabIndex: a.tabIndex, label: (a.getAttribute('aria-label') || '').slice(0, 60), inChart: !!(cell && cell.contains(a)), isBody: a === document.body } : null } })()`
try {
  p = await open(R, { width: 1600, height: 950 })
  await sleep(2500)
  const pt = await p.b.evaluate(`(() => { const cell = document.querySelector('[data-widget-type="chart"]'); const t = cell.querySelector('.tv-lightweight-charts table'); const tr = [...t.querySelectorAll(':scope > tbody > tr, :scope > tr')].filter(x => x.getBoundingClientRect().height > 8)[0]; const plot = [...tr.children].reduce((a, b) => (b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a)).getBoundingClientRect(); return { x: Math.round(plot.left + plot.width * 0.5), y: Math.round(plot.top + plot.height * 0.15) } })()`)
  const rclick = async () => { await p.b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' }); await sleep(250); for (const type of ['mousePressed', 'mouseReleased']) await p.b.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'right', clickCount: 1 }); await sleep(600) }
  const escape = async () => { await p.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await p.b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400) }
  rec.at_point = pt
  await rclick(); rec.steps.push({ step: 'right-click (1)', ...(await p.b.evaluate(STATE)) })
  await escape(); rec.steps.push({ step: 'Escape (1)', ...(await p.b.evaluate(STATE)) })
  await rclick(); rec.steps.push({ step: 'right-click (2)', ...(await p.b.evaluate(STATE)) })
  await escape(); rec.steps.push({ step: 'Escape (2)', ...(await p.b.evaluate(STATE)) })
  // attempt-2: focus moved off the chart while the menu is open (the right-click itself focuses the chart), so the Escape
  // has to hand it back
  await rclick(); await p.b.evaluate(`document.activeElement && document.activeElement.blur()`); rec.steps.push({ step: 'right-click (2b), then focus moved off the chart', ...(await p.b.evaluate(STATE)) })
  await escape(); rec.steps.push({ step: 'Escape (2b)', ...(await p.b.evaluate(STATE)) })
  await rclick(); rec.steps.push({ step: 'right-click (3)', ...(await p.b.evaluate(STATE)) })
  await p.b.click(3, 3); await sleep(400); rec.steps.push({ step: 'click the backdrop', ...(await p.b.evaluate(STATE)) })
  rec.consoleErrors = p.errors().slice(0, 5)
} catch (e) { rec.error = String(e?.stack || e) } finally { try { await p?.close() } catch {} R.close() }
writeFileSync(process.argv[2], JSON.stringify(rec, null, 1)); console.log('written'); process.exit(0)
