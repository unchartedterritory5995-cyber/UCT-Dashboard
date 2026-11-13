// UCT Agent VISUAL TEACHING — the browser runner that proves a walkthrough rings the real control (dev-only, never bundled).
//
//   One line (from app/, with the dev server up on 127.0.0.1:5302 — see README in this folder):
//     node src/testing/agent/guide/teach.mjs [--filter <regex on id or words>] [--out <file.json>] [--cases <file.json>]
//
// Cases: cases.inventory.json (made by `GUIDE_CASES_OUT=src/testing/agent/guide/cases.inventory.json npx vitest run
// src/agent/agentGuideInventory`): an inventory row's OWN words, kept only when they reach the walkthrough a person assigned
// to that row (expected.json). For each case, a fresh headless Chrome (temp profile, deleted on close) opens the agent
// harness (real ChartsWorkspace and AgentPanel, fixture lists and layouts, synthetic bars), the words are TYPED into the real
// composer, and the walkthrough is followed with real CDP input — a left click on the ringed control, a right-click where the
// card asks for one, the card's own Next where a step has nothing to click (typing, dragging, a key). A case PASSES only when
// the walkthrough reaches its LAST step and the gold ring encloses the element that step names — its primary control, not a
// fallback (the card shows the step's own sentence, not its "not here yet" sentence).
//
// ⛔ THE MODEL IS SCRIPTED (BA relay): the guide answers on its instant path, so no model is asked. A pass says the
// walkthrough works on this harness; it says nothing about the real planner, production data or production layout.
// Each case runs in its own node process with a hard timeout, so one hung page can never stall the run.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
// --cases <file>: another case set of the same shape (a held-out set's own phrasings); the children read it through the env
const CASES_FILE = process.env.TEACH_CASES_FILE || arg('--cases') || path.join(HERE, 'cases.inventory.json')
const CASES = JSON.parse(readFileSync(CASES_FILE, 'utf8'))

if (!process.env.TEACH_CASE) {
  // ── the driver: one child per case ──
  const filter = arg('--filter') ? new RegExp(arg('--filter'), 'i') : null
  const out = arg('--out') || 'teach-results.json'
  const picked = CASES.map((c, i) => [c, i]).filter(([c]) => !filter || filter.test(c.id) || filter.test(c.say))
  const results = []
  for (const [c, i] of picked) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, TEACH_CASE: String(i), TEACH_CASES_FILE: CASES_FILE }, encoding: 'utf8', timeout: 150000 })
    let rec = null
    try { rec = JSON.parse(String(r.stdout).trim().split('\n').filter(l => l.startsWith('{"')).pop()) } catch { rec = null }
    if (!rec) rec = { ...c, pass: false, error: r.error ? String(r.error.message || r.error) : `no result (exit ${r.status}) ${String(r.stderr).slice(-300)}` }
    results.push(rec)
    console.log(`${rec.pass ? 'PASS' : 'FAIL'}  ${c.id}  ${c.say}${rec.pass ? '' : `  — ${rec.why || rec.error || ''}`}`)
  }
  writeFileSync(out, JSON.stringify({ mode: 'BROWSER-MOCK-MODEL', evidence: 'LOCAL agent harness, scripted model, synthetic bars and fixtures: not production, not gate evidence', at: new Date().toISOString(), base: process.env.BA_BASE || null, results }, null, 1))
  console.log(`\n${results.filter(r => r.pass).length}/${results.length} pass → ${out}`)
  process.exit(0)
}

// ── one case ──
const { startRelay, open, sleep } = await import('../acceptance/lib.mjs')
const c = CASES[Number(process.env.TEACH_CASE)]
const { givenFor, boardFor, fixturesFor, queryFor } = await import('./given.mjs')
const given = givenFor(c)

// widget data the harness does not serve as a fixed route (the price alerts are the page's own simulated route: see `given`)
const R = await startRelay({ groupOfAction: () => null })
const rec = { ...c, given: Object.keys(given), pass: false, steps: [] }
let p = null
// what the walkthrough is on, read from the guide's OWN store and target reader (the same modules the page runs)
const STATE = `(async () => {
  const G = await import('/src/agent/guide/guideStore.js'); const T = await import('/src/agent/guide/targets.js')
  const st = G.guideState()
  // a card on screen with an empty store: the page runs another copy of the module (Vite hot-reloaded it): a HARNESS fault
  if (!st) return document.querySelector('[data-testid="guide-card"]') ? { stale: true } : null
  const step = st.steps[st.index]; const ring = document.querySelector('[data-testid="guide-ring"]')
  const r = ring && ring.getBoundingClientRect()
  // the ring is ON the control: its centre is inside the control, and it covers most of it (the guide clips the ring to what
  // shows when a row overflows its menu, so 'encloses' is the wrong test)
  const inRing = (el) => { const b = el && el.getBoundingClientRect(); if (!r || !b || !b.width) return false; const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const ix = Math.max(0, Math.min(b.right, r.right) - Math.max(b.left, r.left)), iy = Math.max(0, Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top)); return cx >= b.left - 4 && cx <= b.right + 4 && cy >= b.top - 4 && cy <= b.bottom + 4 && ix * iy >= 0.6 * b.width * b.height }
  // the step's PRIMARY control: every entry of its target but the fallback (the last one, when the step says what it is)
  const list = Array.isArray(step.target) ? step.target : [step.target]
  const primary = step.altText && list.length > 1 ? list.slice(0, -1) : list
  const pel = primary.map(t => T.findTarget(t, st)).find(Boolean) || null
  const el = T.findTarget(step.target, st)
  const text = document.querySelector('[data-testid="guide-text"]')?.textContent || ''
  const next = [...document.querySelectorAll('[data-testid="guide-card"] button')].find(x => /^(Next|Skip|Done)/.test(x.textContent.trim()))
  const met = !!(step.waitFor && T.findTarget(step.waitFor, st))
  const box = (b) => b && [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]
  // the ringed control's own parts: a row's handlers sit on one of its cells (a list row's menu is on its symbol cell)
  const kids = el ? [...el.children].slice(0, 8).map(k => k.getBoundingClientRect()).filter(b => b.width > 4 && b.height > 4).map(b => ({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) })) : []
  // the field a typing step means: the ringed control, or the ONE field inside it a person can type in, as shown on screen
  // (a formula box's wrapper holds a hidden model textarea and the visible code editor, a contenteditable)
  const editable = (x) => { const b = x.getBoundingClientRect(); return b.width > 4 && b.height > 4 && x.getAttribute('aria-hidden') !== 'true' && x.tabIndex !== -1 }
  const typeIn = el && !el.matches?.('input,textarea,select') ? [...el.querySelectorAll('textarea, input:not([type=hidden]):not([type=radio]):not([type=checkbox]), [contenteditable="true"]')].filter(editable) : []
  const fieldEl = el?.matches?.('input,textarea,select') ? el : typeIn.length === 1 ? typeIn[0] : null
  // the ringed control is under something else at the ring's centre (a sheet's sticky footer): a person scrolls before clicking
  const hitAt = r && el ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null
  const covered = !!(hitAt && el && !el.contains(hitAt) && !hitAt.contains(el) && !(el.labels && [...el.labels].some(l => l.contains(hitAt))))
  return { covered, kids, pr: box(pel && pel.getBoundingClientRect()), rr: box(r), index: st.index, last: st.index === st.steps.length - 1, onPrimary: inRing(pel), text: text.slice(0, 140), ring: r && { x: r.left + r.width / 2, y: r.top + r.height / 2 }, next: next ? next.textContent.trim() : null, right: /right-click/i.test(step.text), onChart: step.target === 'chart.plot', stepText: step.text, met, field: !!el?.matches?.('input,textarea,select'), fieldAt: fieldEl ? (() => { const b = fieldEl.getBoundingClientRect(); return { x: Math.round(b.left + Math.min(b.width / 2, 60)), y: Math.round(b.top + Math.min(b.height / 2, 14)) } })() : null, picker: /one of your (own )?lists|Click (a|the) list/i.test(step.text), chartRef: st.chartRef || null }
})()`

// ⭐ REGION-AWARE INPUT. A right-click the card asks for lands on the REGION it names. Candidate points come from the chart
// library's own layout (its pane rows, its price-axis cell, its time-axis row), never from fixed pixels, and a candidate counts
// only when the product's own region menu answers with the row the step waits for (StockChart's resolveChartRegion decides).
const REGIONS = `((ref, text) => {
  const cell = (ref && document.querySelector('[data-widget-id="' + String(ref).split('~')[0] + '"]')) || document.querySelector('[data-widget-type="chart"]') || document
  const table = cell.querySelector('.tv-lightweight-charts table')
  if (!table) return []
  const rows = [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')].filter(tr => tr.getBoundingClientRect().height > 8)
  const panes = rows.slice(0, -1).map(tr => { const tds = [...tr.children]; const plot = tds.reduce((a, b) => (b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a)); const axis = tds[tds.indexOf(plot) + 1] || null; return { plot: plot.getBoundingClientRect(), axis: axis && axis.getBoundingClientRect() } })
  if (!panes.length) return []
  const p0 = panes[0].plot
  const at = (b, fx, fy) => ({ x: Math.round(b.left + b.width * fx), y: Math.round(b.top + b.height * fy) })
  const t = String(text).toLowerCase()
  const out = []
  if (/price numbers|right edge|price scale|price axis/.test(t)) { for (const pn of panes) if (pn.axis) for (const fy of [0.5, 0.3, 0.7]) out.push(at(pn.axis, 0.5, fy)) }
  else if (/volume/.test(t)) { for (let fy = 0.97; fy >= 0.6; fy -= 0.03) out.push(at(p0, 0.6, fy)); for (const pn of panes.slice(1)) out.push(at(pn.plot, 0.5, 0.5)) }
  else if (/drawing|a line|rectangle|trendline|fibonacci|text note|measure|on the chart. if this chart has none/.test(t)) {
    // a drawing: the pixels the app's drawing layer painted (its own canvas, above the chart's: only drawings are on it)
    const layer = [...cell.querySelectorAll('canvas')].find(cv => !cv.closest('.tv-lightweight-charts') && getComputedStyle(cv).zIndex === '4')
    if (layer && layer.width) {
      const ctx = layer.getContext('2d'); const d = ctx.getImageData(0, 0, layer.width, layer.height).data; const lb = layer.getBoundingClientRect(); const k = layer.width / lb.width
      const hits = []
      for (let y = 2; y < layer.height - 2; y += 1) for (let x = 2; x < layer.width - 2; x += 3) { const i = (y * layer.width + x) * 4; if (d[i + 3] > 90) hits.push({ x: Math.round(lb.left + x / k), y: Math.round(lb.top + y / k) }) }
      for (let i = 0; i < hits.length && out.length < 16; i += Math.max(1, Math.floor(hits.length / 16))) out.push(hits[i])
    }
  }
  // (no \b here: REGIONS is a template string, where \b is a backspace)
  // a candle, the watermark, or the empty chart: the location-aware row keys to which one is under the pointer, so a person
  // tries points down the plot until the row they were told about is offered
  else if (/ a candle/.test(' ' + t)) {
    const cvs = [...cell.querySelectorAll('.tv-lightweight-charts canvas')].filter(cv => { const b = cv.getBoundingClientRect(); return b.width > p0.width * 0.8 && Math.abs(b.top - p0.top) < 4 })
    const cv = cvs[0]
    if (cv && cv.width) {
      try {
        const ctx = cv.getContext('2d'); const lb = cv.getBoundingClientRect(); const k = cv.width / lb.width
        for (const fx of [0.92, 0.08, 0.85, 0.15, 0.78, 0.22, 0.7, 0.3, 0.5]) {
          const x = Math.round(lb.width * fx * k); const d = ctx.getImageData(x, 0, 1, cv.height).data
          for (let y = 0; y < cv.height; y++) { const r = d[y * 4], g = d[y * 4 + 1], bl = d[y * 4 + 2]; if (Math.max(r, g, bl) - Math.min(r, g, bl) > 70) { let e = y; while (e + 1 < cv.height && Math.max(d[(e + 1) * 4], d[(e + 1) * 4 + 1], d[(e + 1) * 4 + 2]) - Math.min(d[(e + 1) * 4], d[(e + 1) * 4 + 1], d[(e + 1) * 4 + 2]) > 70) e++; out.push({ x: Math.round(lb.left + x / k), y: Math.round(lb.top + (y + e) / 2 / k) }); break } }
        }
      } catch (e) { /* a canvas the page cannot read: the scan below */ }
    }
    for (const fx of [0.5, 0.75, 0.25]) for (let fy = 0.05; fy <= 0.951; fy += 0.05) out.push(at(p0, fx, fy))
  }
  else if (/ a candle|watermark|empty part/.test(' ' + t)) { for (const fx of [0.5, 0.75, 0.25]) for (let fy = 0.05; fy <= 0.951; fy += 0.05) out.push(at(p0, fx, fy)); if (/watermark/.test(t)) { const c = at(p0, 0.5, 0.5); out.sort((m, n) => Math.hypot(m.x - c.x, m.y - c.y) - Math.hypot(n.x - c.x, n.y - c.y)) } }
  else if (/moving average/.test(t)) { for (const fx of [0.6, 0.8, 0.4]) for (let fy = 0.05; fy <= 0.95; fy += 0.01) out.push(at(p0, fx, fy)) }
  else { for (const fy of [0.4, 0.5, 0.3, 0.6]) out.push(at(p0, 0.5, fy)) }
  return out
})`
async function rightClickRegion(s) {
  // a right-click on a control that is not the chart (a list's row, a layout on the bar) lands on that control
  const pts = s.onChart ? await p.b.evaluate(`${REGIONS}(${JSON.stringify(s.chartRef)}, ${JSON.stringify(s.stepText)})`) : [s.ring, ...(s.kids || [])]
  rec.tried = (rec.tried || []).concat([pts.slice(0, 4)])
  for (const pt of (pts.length ? pts : [s.ring])) {
    // a person's pointer arrives first: the drawing layer takes the click only once it has seen the pointer over a drawing
    await p.b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' })
    await sleep(250)
    for (const type of ['mousePressed', 'mouseReleased']) await p.b.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'right', clickCount: 1 })
    await sleep(450)
    let now = await p.b.evaluate(STATE)
    // a menu opened without the row: the guide may be saying the row is not offered here (GuideOverlay ABSENT_MS), as a
    // person who opened the menu and waited would see. Wait for that before trying the next point
    if (now && now.index === s.index && !now.met && await p.b.evaluate(`!!document.querySelector('[role="menu"],[data-guide$="Menu"]')`)) { await sleep(1900); now = await p.b.evaluate(STATE) }
    if (!now || now.index !== s.index || now.met) return true
    // the wrong region's menu closes, and the next candidate is tried. Escape only while a menu is open: with none, Escape is
    // the member leaving the guide (GuideOverlay's own rule)
    if (await p.b.evaluate(`!!document.querySelector('[role="menu"],[data-guide$="Menu"]')`)) await p.b.key('Escape')
    await sleep(200)
    // a menu Escape does not close (the desktop chart menu has no Escape handler: ChartWidget closes on its backdrop): a
    // person clicks away, so the next right-click opens a menu instead of landing on the backdrop and closing this one
    if (await p.b.evaluate(`!!document.querySelector('[data-guide="chart.contextMenu"]')`)) { await p.b.click(2, 2); await sleep(200) }
  }
  return false
}

try {
  p = await open(R, { prefs: boardFor(given), fixtures: fixturesFor(given), query: queryFor(given), ls: given.ls || null, iaCatalog: given.iaCatalog || null, width: 1600, height: 950 })
  // a desktop member has a mouse: headless Chrome reports no hover, and the drawing layer only hit-tests under a hovering pointer
  // (ChartDrawingOverlay's matchMedia('(hover: hover)')). Emulated, then the page loads again with it
  // (CDP's media emulation has no hover feature, so the page is told what a desktop with a mouse answers)
  await p.b.send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + (() => { const mm = window.matchMedia.bind(window); const desk = (q) => /hover|pointer/.test(q) && !/none|coarse/.test(q); window.matchMedia = (q) => { const r = mm(q); return desk(String(q)) ? { matches: true, media: r.media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } } : r } }).toString() + ')()' })
  await p.b.send('Page.reload', {})
  await sleep(1500)
  await p.b.waitFor(`!!document.querySelector('[data-testid="agent-launch"]') || !!document.querySelector('[aria-label="Message UCT Agent"]')`, { timeout: 60000 })
  await p.b.evaluate(`window.__baRead ? 1 : 0`)
  await p.openPanel()
  // ⭐ GIVEN: the state the case needs, built in the page through the app's own routes and stores (guide/given.mjs)
  if (given.setup) { const said = await p.b.evaluate(given.setup); rec.setup = said; await sleep(1200) }
  // ⭐ DECLARED GIVENS' member acts (givens.mjs prelude): real input on the app's own control, before the words are typed
  if (given.declared?.length) { const { runPreludes } = await import('./givens.mjs'); const acts = await runPreludes(given.declared, { b: p.b, sleep }); if (acts.length) { rec.prelude = acts; await sleep(800) } }
  await p.say(c.say)
  await p.idle(20000)
  await sleep(800)
  for (let n = 0, waits = 0; n < 16; n++) {
    const s = await p.b.evaluate(STATE)
    if (s?.stale) { rec.why = 'HARNESS: the page’s guide module is not the runner’s (Vite hot-reloaded it): restart Vite and run again'; rec.harness = true; break }
    // the walkthrough finished itself on the member's press of a ringed control (its own `done`: a widget added where the board
    // had room, so the optional Place step never came): the last control was reached and pressed, which is a pass
    if (!s && rec.steps.length && rec.steps.at(-1).onPrimary && await p.b.evaluate(`(async () => { const G = await import('/src/agent/guide/guideStore.js'); return G.guideEnded?.()?.reason === 'done' })()`)) { rec.pass = true; rec.note = 'ended done on the press of its ringed control'; break }
    if (!s) { const said = await p.b.evaluate(`document.querySelector('[data-testid="guide-notice"]')?.textContent || ''`); rec.why = rec.steps.length ? `the walkthrough ended before its last step${said ? `: ${said}` : ''}` : `no walkthrough: ${(await p.last()).slice(0, 160)}`; break }
    rec.steps.push({ i: s.index, text: s.text, onPrimary: s.onPrimary, pr: s.pr, rr: s.rr })
    if (s.last) {
      // PASS: the ring is on the last step's own control (a greyed-out one too: the card then says why), never on a fallback
      if (s.onPrimary) { rec.pass = true; break }
      if (!s.ring && waits++ < 6) { await sleep(1500); continue }
      rec.why = !s.ring ? 'last step: no ring (its control is not on screen)' : `last step shows its fallback: ${s.text}`
      break
    }
    if (!s.ring) { if (waits++ < 6) { await sleep(1500); continue } rec.why = `step ${s.index + 1}: no ring`; break }
    waits = 0
    if (s.picker) {
      const pt = await p.b.evaluate(`(() => { const c = document.querySelector('[data-widget-type="watchlist"] [data-guide="watchlist.picker"]'); const el = c && [...c.querySelectorAll('button,[role=button],div')].find(e => /Momentum/.test(e.textContent) && e.children.length < 4); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 } })()`)
      if (pt) { await p.b.click(pt.x, pt.y); await sleep(1500); continue }
    }
    // the card names a key chord ("Click the chart, then press Alt+Shift+A"): click where it rings, then press it, as a person would
    const chord = /\bpress ((?:(?:Ctrl|Alt|Shift|Meta|Cmd)\+)+)([A-Z0-9])\b/.exec(s.stepText || '')
    if (chord) {
      await p.b.click(s.ring.x, s.ring.y); await sleep(300)
      const mods = chord[1].split('+').filter(Boolean)
      const bit = { Alt: 1, Ctrl: 2, Meta: 4, Cmd: 4, Shift: 8 }
      const m = mods.reduce((a, k) => a | (bit[k] || 0), 0)
      const k = chord[2], code = /\d/.test(k) ? `Digit${k}` : `Key${k}`
      const key = mods.includes('Shift') ? k : k.toLowerCase()
      await p.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers: m, windowsVirtualKeyCode: k.charCodeAt(0) })
      await p.b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: m, windowsVirtualKeyCode: k.charCodeAt(0) })
      await sleep(1300); continue
    }
    // a field the card asks to type into ("Type a name for the list"): a person types something there, and the card's own
    // example when it gives one ("Type a yes-or-no formula, such as close > open.")
    if ((s.field || s.fieldAt) && /\btype\b/i.test(s.stepText || '')) {
      const example = /\bsuch as ([^.;]+?)(?:[.;]\s|[.;]?$)/i.exec(s.stepText || '')?.[1] || 'Teach list'
      // real keys on the focused field, one character at a time (a code editor such as CodeMirror reads key input, not a value)
      const at = s.fieldAt || s.ring; await p.b.click(at.x, at.y); await sleep(200)
      for (const ch of example) {
        await p.b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch })
        await p.b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
      }
      await sleep(900)
      const after = await p.b.evaluate(STATE)
      if (after && after.index === s.index && after.next) { await p.button(after.next, '[data-testid="guide-card"]'); await sleep(900) }
      continue
    }
    if (s.right) { if (!(await rightClickRegion(s))) { rec.why = `step ${s.index + 1}: no point of the region it names opened the menu row it needs`; break } await sleep(600); continue }
    // covered at the ring's centre: the mouse wheel over it, as a person scrolls a sheet until the control is clear (at most 6)
    let at = s
    for (let k = 0; at && at.covered && at.index === s.index && k < 6; k++) {
      await p.b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.ring.x, y: at.ring.y, deltaX: 0, deltaY: 160 })
      await sleep(500)
      at = await p.b.evaluate(STATE)
      rec.scrolled = (rec.scrolled || 0) + 1
    }
    if (at && at.index === s.index && at.ring) s.ring = at.ring
    if (!s.field) await p.b.click(s.ring.x, s.ring.y)
    await sleep(1300)
    const after = await p.b.evaluate(STATE)
    // a step with nothing to click (typing, dragging, a key) moves on with the card's own button
    if (after && after.index === s.index && after.next) { await p.button(after.next, '[data-testid="guide-card"]'); await sleep(900) }
  }
  rec.consoleErrors = p.errors().slice(0, 3)
} catch (e) { rec.error = String(e?.message || e) } finally {
  try { await p?.close() } catch { /* */ }
  R.close()
}
console.log(JSON.stringify(rec))
process.exit(0)
