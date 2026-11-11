// UCT Charts — REAL-BROWSER hit test of the Watchlist widget's title (dev-only, never bundled; nothing imports it).
//
// One headless Chrome on agent-harness.html?board=wl&watchlists=1 (the REAL ChartsWorkspace with a Watchlist widget showing the
// fixture list "Momentum" in pick mode). For each press it records the point, document.elementFromPoint at that point, the
// element the browser actually dispatched the press to, and what happened: the list menu, the picker, the selected list.
// Writes a RAW JSON artifact and screenshots. LOCAL harness; synthetic bars and fixture lists.
//
//   BA_BASE=http://127.0.0.1:5304 node src/testing/agent/acceptance/watchlistTitleHit.mjs --out <dir> --label before|after
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { startRelay, open, sleep } from './lib.mjs'

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const OUT = arg('--out') || '.'
const LABEL = arg('--label') || 'run'
mkdirSync(OUT, { recursive: true })

// a description of an element: what a reader needs to see which control got the press
const DESC = `(el) => el ? { tag: el.tagName.toLowerCase(), guide: el.getAttribute('data-guide'), aria: el.getAttribute('aria-label'), title: el.getAttribute('title'), cls: String(el.className || '').replace(/_[A-Za-z0-9]+_[a-z0-9]+_\\d+/g, m => m.split('_')[1]).slice(0, 60), text: (el.textContent || '').trim().slice(0, 40) } : null`
// the state of the widget: pick mode (its title), the picker, the list menu and its rows, the widget's list
const STATE = `(() => {
  const cell = document.querySelector('[data-widget-type="watchlist"]')
  const menu = document.querySelector('[data-guide="watchlist.rowMenu"]')
  return {
    pickMode: !!cell?.querySelector('[data-guide="watchlist.lists"]'),
    picker: !!cell?.querySelector('[data-guide="watchlist.picker"]'),
    title: (cell?.querySelector('[class*="pickTitle"]')?.textContent || '').trim() || null,
    menu: menu ? [...menu.querySelectorAll('button')].map(b => b.textContent.trim()) : null,
    focus: (${DESC})(document.activeElement),
  }
})()`
// every press the page receives, as the browser dispatched it (capture phase, never consumed)
const LISTEN = `(() => { window.__hits = []; for (const t of ['pointerdown', 'mousedown', 'click', 'contextmenu']) document.addEventListener(t, (e) => { window.__hits.push({ type: t, pointerType: e.pointerType || null, target: (${DESC})(e.target), defaultPrevented: e.defaultPrevented }) }, true) })()`
const centreOf = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] } })()`
// the CENTRE OF THE TITLE'S TEXT (its glyphs), not of its full-width label box
const TEXT_CENTRE = `(() => { const e = document.querySelector('[data-widget-type="watchlist"] [class*="pickTitle"]'); if (!e) return null; const rg = document.createRange(); rg.selectNodeContents(e); const r = rg.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] } })()`

const R = await startRelay({ groupOfAction: () => null })
const results = { label: LABEL, base: process.env.BA_BASE || null, at: new Date().toISOString(), presses: [] }
async function fresh() {
  const p = await open(R, { query: 'board=wl', width: 1500, height: 900 })
  await p.b.waitFor(`!!document.querySelector('[data-widget-type="watchlist"] [class*="pickTitle"]')`, { timeout: 30000 })
  await sleep(1200)
  await p.b.evaluate(LISTEN)
  return p
}
async function press(p, name, pt, act) {
  const before = await p.b.evaluate(STATE)
  const at = await p.b.evaluate(`(${DESC})(document.elementFromPoint(${pt.x}, ${pt.y}))`)
  await p.b.evaluate('window.__hits = []')
  await act()
  await sleep(700)
  const after = await p.b.evaluate(STATE)
  const hits = await p.b.evaluate('window.__hits')
  const png = `${LABEL}-${name}.png`
  writeFileSync(path.join(OUT, png), await p.b.shot())
  const row = { name, point: pt, elementFromPoint: at, dispatched: hits, before, after, screenshot: png }
  results.presses.push(row)
  console.log(`${name}: at=${at?.guide || at?.cls || at?.tag} menu=${JSON.stringify(after.menu)} picker=${after.picker} pickMode=${after.pickMode}`)
  return row
}
const rightClick = (p, pt) => async () => {
  await p.b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' })
  for (const type of ['mousePressed', 'mouseReleased']) await p.b.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'right', clickCount: 1 })
}
const longPress = (p, pt) => async () => {
  await p.b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await p.b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] })
  await sleep(700)
  await p.b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

try {
  let p = await fresh()
  const text = await p.b.evaluate(TEXT_CENTRE)
  results.titleText = text
  results.titleLabelBox = (await p.b.evaluate(centreOf('[data-widget-type="watchlist"] [class*="pickTitle"]')))?.box || null
  // 1. a plain LEFT click on the title's text: what it reaches, and that nothing changes
  await press(p, 'left-click-title-text', text, () => p.b.click(text.x, text.y))
  // 2. a RIGHT click on the title's text
  await press(p, 'right-click-title-text', text, rightClick(p, text))
  p.b.close()
  // 3. a LONG-PRESS (touch) on the title's text
  p = await fresh()
  await press(p, 'long-press-title-text', text, longPress(p, text))
  p.b.close()
  // 4. ⋯ List actions at its own centre
  p = await fresh()
  const dots = await p.b.evaluate(centreOf('[data-widget-type="watchlist"] [data-guide="watchlist.listMenu"]'))
  if (dots) await press(p, 'click-list-actions', dots, () => p.b.click(dots.x, dots.y))
  else results.presses.push({ name: 'click-list-actions', missing: true })
  p.b.close()
  // 5. ‹ Lists at its own centre (opens the picker: the widget's own behaviour)
  p = await fresh()
  const back = await p.b.evaluate(centreOf('[data-widget-type="watchlist"] [data-guide="watchlist.lists"]'))
  await press(p, 'click-lists', back, () => p.b.click(back.x, back.y))
  p.b.close()
} catch (e) {
  results.error = String(e?.stack || e)
  console.error(results.error)
} finally {
  writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(results, null, 1))
  R.close?.()
  process.exit(0)
}
