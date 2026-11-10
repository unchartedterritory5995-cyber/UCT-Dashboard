// UCT Agent AUTOTEST: one request through the REAL panel in a real headless Chrome (the acceptance rig: isolated profile,
// loopback, real ChartsWorkspace and AgentPanel, real typed input and clicks), graded from the components.
//
// The model behind the panel is whatever relay is passed in: the scripted relay (BROWSER-MOCK-MODEL) or the real-model
// relay (realRelay.mjs, REAL-MODEL, which cannot be built without the owner's authorization file).
import { open, sleep } from '../acceptance/lib.mjs'
import { BOARDS } from './boards.mjs'
import { scripted } from './plan.mjs'
import { grade, worldPrint } from './oracle.mjs'
import { prewarm, readRepaints, DEFINITIONS_PREWARM } from './prewarm.mjs'

const q = (s) => JSON.stringify(s)
const normTf = (t) => { const s = String(t || ''); if (/^1?D$/i.test(s)) return 'D'; if (/^1?W$/i.test(s)) return 'W'; if (/^1?M$/.test(s)) return 'M'; const h = /^(\d+)H$/i.exec(s); if (h) return String(Number(h[1]) * 60); const m = /^(\d+)m?$/.exec(s); return m ? m[1] : s }
const normScale = (s) => (/L/.test(s || '') ? 'log' : /%/.test(s || '') ? 'percent' : 'linear')

export async function snapshot(p, boardName) {
  const rows = await p.read()
  const charts = {}
  for (const [role, r] of Object.entries(BOARDS[boardName].roles)) {
    const c = rows.find(w => w.id === r.id)
    if (!c) { charts[role] = { gone: true }; continue }
    charts[role] = { sym: c.sym, tf: normTf(c.tf), scale: normScale(c.scale), session: c.session, volume: c.volume, chips: c.chips, panes: c.panes.length, panePx: c.panes, pixels: c.pixels, axis: c.text.slice(0, 40), x: c.x, y: c.y, w: c.w, h: c.h }
  }
  const raw = await p.b.evaluate(`(() => {
    const H = window.__agentHarness || {}, B = window.__ba || {}
    let draw = {}; try { draw = JSON.parse(localStorage.getItem('uct-chart-drawings') || '{}') } catch { /* */ }
    return { wl: Object.fromEntries((H.wl || []).map(w => [w.name, w.items.map(i => i.sym)])), wlNotes: Object.fromEntries((H.wl || []).map(w => [w.name, Object.fromEntries(w.items.filter(i => i.notes).map(i => [i.sym, i.notes]))])), drawings: draw, alerts: B.alerts || [], ialerts: B.ialerts || [],
      layouts: (H.lib?.mine || []).map(l => l.name), written: B.written, layoutWrites: (H.layoutWrites || []).map(w => [w.method, w.body && w.body.name]), screens: (B.screens || []).map(s => s.name) }
  })()`)
  // a board that names extra READS (boards.mjs `reads`) gets them: the Multi Chart grid as persisted plus its maximized cell and
  // Shared Chart Settings dialog on screen ('grid'), the watchlist columns as saved ('wlCols'), the scan fetches ('scanGets').
  // Other boards' snapshots are unchanged
  const reads = BOARDS[boardName].reads || []
  if (reads.length) {
    if (reads.includes('grid')) await sleep(900)        // the grid persists 500 ms after a change (useMultiChartState scheduleSave)
    const extra = await p.b.evaluate(`(() => {
      const H = window.__agentHarness || {}, want = ${q(reads)}, out = {}
      const js = (s) => { try { return JSON.parse(s || 'null') } catch { return null } }
      if (want.includes('grid')) {
        const s = js((H.prefs || {}).multichart_state)
        const maxEl = document.querySelector('[class*="cellMaximized"] [data-widget-id]')
        const dlg = [...document.querySelectorAll('[role="dialog"]')].some(d => /Shared Chart Settings/i.test(d.textContent || ''))
        out.grid = s ? { open: !!document.querySelector('[data-grid-cell-id]'), mode: s.mode || null, layout: s.layout || null, cells: (s.cells || []).length,
          syms: (s.cells || []).map(c => c.sym || null), forked: (s.cells || []).map(c => !!c.settings), syncCrosshair: !!s.syncCrosshair,
          syncTimeRange: !!s.syncTimeRange, groupsMode: !!s.groupsMode, max: maxEl ? maxEl.dataset.widgetId : null, settingsOpen: dlg } : null
      }
      if (want.includes('wlCols')) { out.wlCols = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^uct\.watchlist\.cols/.test(k)) out.wlCols[k] = js(localStorage.getItem(k)) } }
      if (want.includes('scanGets')) {
        const g = H.scanGets || [], byRoute = {}
        for (const r of g) byRoute[r] = (byRoute[r] || 0) + 1
        out.scanGets = { all: g.length, period: g.filter(r => /period-change/.test(r)).length, scanner: g.filter(r => !/period-change/.test(r)).length, byRoute }
      }
      return out
    })()`)
    Object.assign(raw, extra)
    if (extra.grid) for (const [role, r] of Object.entries(BOARDS[boardName].roles)) {
      if (!charts[role] || charts[role].gone) continue
      const i = extra.grid.syms.length ? Number(String(r.id).replace(/^g/, '')) : -1
      charts[role].cell = `${extra.grid.max === r.id ? 'max' : ''}|${extra.grid.forked[i] ? 'fork' : ''}`
    }
  }
  const drawings = Object.fromEntries(Object.entries(raw.drawings).filter(([, v]) => Array.isArray(v) && v.length))
  const faces = {}
  const harness = await p.b.evaluate('!!window.__ba')     // on production a widget's face holds real values: never read
  if (harness) for (const w of rows.filter(x => x.type !== 'chart')) faces[w.type] = await p.b.evaluate(`document.querySelector('[data-widget-id=${q(w.id)}]')?.innerText?.slice(0, 600) || ''`)
  return { charts, widgets: rows.map(w => ({ id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h })), chartCount: rows.filter(w => w.type === 'chart').length, types: rows.map(w => w.type), ...raw, drawings, drawingCount: Object.values(drawings).reduce((n, d) => n + d.length, 0), faces, unreadable: ['type', 'settingsHash'] }
}

async function driveTurn(p, ctx, req, turn) {
  const { R, mock } = ctx
  const rc0 = await p.receipts()
  const calls0 = R.turns.length
  const worldBefore = worldPrint(await snapshot(p, req.board))
  const env = { value: null }
  const t0 = Date.now()
  await p.say(turn.say, mock ? (body) => { const s = scripted(turn, body, req.board); env.value = s; return s } : undefined)
  const idle = await p.idle(ctx.turnTimeoutMs || 20000)
  let card = null, heldUntilApply
  if (await p.proposal()) {
    card = await p.proposal()
    await sleep(150)
    heldUntilApply = worldPrint(await snapshot(p, req.board)) === worldBefore
    if (turn.approve !== false) { await p.button('Apply'); await p.idle(ctx.turnTimeoutMs || 20000) }
  }
  await p.settle(turn.settleMs || 800)
  const newReceipt = (await p.receipts()) > rc0
  const rc = await p.receipt()
  const modelCalls = R.turns.length - calls0
  R.queue.length = 0
  const envelope = mock ? env.value : R.lastEnvelope?.(calls0) ?? null
  const context = modelCalls ? R.turns[calls0]?.context ?? null : null
  return { say: turn.say, ms: Date.now() - t0, context, idle, card, heldUntilApply, newReceipt, receiptText: newReceipt ? rc?.text : null, undoable: newReceipt ? rc?.undoable : null, modelCalls, last: (await p.last()).slice(-500), envelope, unreadable: R.lastUnreadable?.(calls0) || false }
}

// the ring around the real control, and what a click there would really hit
const RING = (target) => `(() => {
  const ring = document.querySelector('[data-testid="guide-ring"]'), card = document.querySelector('[data-testid="guide-card"]')
  if (!ring) return { ok: false, why: 'no ring' }
  const r = ring.getBoundingClientRect()
  const all = [...document.querySelectorAll(${q(`[data-guide="${target}"]`)})].filter(e => e.getBoundingClientRect().width > 0)
  if (!all.length) return { ok: false, why: 'no element carries ${target}' }
  const near = (a) => Math.abs(a.top - 4 - r.top) < 3 && Math.abs(a.height + 8 - r.height) < 3 && Math.abs(a.left - 4 - r.left) < 4
  const t = all.find(e => near(e.getBoundingClientRect()))
  if (!t) { const a = all[0].getBoundingClientRect(); return { ok: false, why: 'the ring is on another element', ring: [r.left, r.top, r.width, r.height].map(Math.round), control: [a.left, a.top, a.width, a.height].map(Math.round) } }
  const a = t.getBoundingClientRect()
  const hit = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2)
  const free = !!hit && (hit === t || t.contains(hit) || hit.contains(t))
  const c = card?.getBoundingClientRect()
  const over = c ? !(c.right <= a.left || c.left >= a.right || c.bottom <= a.top || c.top >= a.bottom) : false
  return { ok: free && !over, free, over, x: a.left + a.width / 2, y: a.top + a.height / 2 }
})()`

/** Walk the walkthrough with a real mouse, as the card says to. `spec`: oracle.guide. */
async function walkGuide(p, spec) {
  const b = p.b
  const started = await b.waitFor(`!!document.querySelector('[data-testid="guide-card"]')`, { timeout: 4000 })
  if (!started) return { started: false, why: (await p.last()).slice(-200), steps: [] }
  const steps = []
  for (let i = 0; i < spec.steps.length; i++) {
    const s = spec.steps[i]
    const got = await b.waitFor(`new RegExp(${q(s.text)}, 'i').test(document.querySelector('[data-testid="guide-text"]')?.textContent || '')`, { timeout: 5000 })
    await sleep(150)
    const text = await b.evaluate(`document.querySelector('[data-testid="guide-text"]')?.textContent || ''`)
    const ring = await b.evaluate(RING(s.target))
    const row = { index: i, target: s.target, text, textOk: !!got, ringOk: !!ring.ok, ringDetail: JSON.stringify(ring).slice(0, 200) }
    steps.push(row)
    if (!got || !ring.ok) return { started: true, steps, finished: false, stoppedAt: `step ${i + 1}: ${got ? ring.why || 'ring' : text}` }
    if (s.act === 'click') {
      await b.click(ring.x, ring.y)
      row.acted = true
      if (s.then) { await sleep(200); await b.type(s.then) }
    } else {
      const clicked = await p.button(s.act === 'next' || !s.act ? 'Next' : s.act, '[data-testid="guide-card"]')
      row.acted = clicked
      if (!clicked) { row.actDetail = `no card button ${s.act || 'Next'}`; if (i === spec.steps.length - 1) { const done = await p.button('Done', '[data-testid="guide-card"]'); row.acted = done; row.actDetail = undefined } }
    }
    await sleep(350)
  }
  // a partial oracle stops part way: leave by the card's own Exit, as a person would
  if (spec.partial) {
    const x = await b.evaluate(`(() => { const e = document.querySelector('[aria-label="Exit the guide"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    if (x) await b.click(x.x, x.y)
    await sleep(500)
  }
  // the last click ends it; a card still up offers Done
  if (await b.evaluate(`!!document.querySelector('[data-testid="guide-card"]')`)) await p.button('Done', '[data-testid="guide-card"]')
  await sleep(500)
  const left = await b.evaluate(`({ ring: !!document.querySelector('[data-testid="guide-ring"]'), card: !!document.querySelector('[data-testid="guide-card"]') })`)
  return { started: true, steps, finished: !left.card, stoppedAt: left.card ? 'the card stayed after the last step' : undefined, clean: !left.ring && !left.card, leftovers: JSON.stringify(left) }
}

/** The chart a walkthrough's ring really sits on: the role whose box holds its centre. */
async function ringRole(p, req) {
  await p.b.waitFor(`!!document.querySelector('[data-testid="guide-ring"]')`, { timeout: 4000 })
  await sleep(200)
  const c = await p.b.evaluate(`(() => { const e = document.querySelector('[data-testid="guide-ring"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (!c) return null
  const rows = await p.read()
  for (const [role, r] of Object.entries(BOARDS[req.board].roles)) {
    const w = rows.find(x => x.id === r.id)
    if (w && c.x >= w.x && c.x <= w.x + w.w && c.y >= w.y && c.y <= w.y + w.h) return role
  }
  return null
}

/** One request, start to finish, on a fresh page. → { evidence, result } */
export async function runRequest(ctx, req) {
  const { R, shotPath } = ctx
  const B = BOARDS[req.board].browser
  if (req.simOnly) return { evidence: { turns: [] }, result: { pass: null, graded: 0, na: 0, checks: [] } }
  const ev = { turns: [], undo: null, guide: null, errors: [], before: null, after: null }
  let p = null
  try {
    p = ctx.openFn ? await ctx.openFn(R) : await open(R, { query: B.query || '', prefs: B.prefs || null, fixtures: { routes: [...(ctx.routes || []), ...(B.routes || [])] }, iaCatalog: B.iaCatalog || null, profile: ctx.profile || null })
    ctx.onPage?.(p)
    await p.settle()
    await p.openPanel()
    const up = await p.b.waitFor(`(() => { const c = window.__baRead().filter(w => w.type === 'chart'); return !c.length || c.every(x => (x.sym && x.canvases > 5) || ${q(req.board)} === 'MC' && x.id === 'g3') })()`, { timeout: 30000 })
    if (!up) throw new Error('the board never painted')
    // a board of lazily loaded widgets: wait until each one has published its own door (its state and writers), as a person would
    // wait for it to appear before asking about it
    if (B.waitDoors) {
      const ok = await p.b.waitFor(`(async () => { const m = await import('/src/pages/charts/widgetDoors.js'); return ${q(B.waitDoors)}.every(id => !!m.mountedWidgetDoor(id)) })()`, { timeout: 30000, step: 400 })
      if (!ok) throw new Error(`the widgets never loaded: ${B.waitDoors.join(', ')}`)
    }
    await p.settle()
    // the one-off definitions redraw (#948, see prewarm.mjs) is taken, and graded, before anything is measured
    ev.prewarm = await prewarm(p, sleep)
    if (ev.prewarm) { await p.b.hover(2, 2); await p.settle() }
    if (req.select) await p.select(BOARDS[req.board].roles[req.select].id)
    ev.before = await snapshot(p, req.board)
    for (const t of req.turns) {
      if (t.act) await ctx.acts?.[t.act]?.(p, req, t)
      else {
        ev.beforeLast = await snapshot(p, req.board); ev.clicks = await p.clicks()
        if (ev.prewarm) await readRepaints(p)
        ev.turns.push(await driveTurn(p, ctx, req, t))
        // every repaint of every chart during the request's own sentences (a click between sentences is the person's, not counted);
        // `repaintsLast` is the last sentence alone, the same window as a target request's state checks (ev.beforeLast)
        if (ev.prewarm) { const r = await readRepaints(p); ev.repaintsLast = r; ev.repaints = ev.repaints || {}; for (const [id, l] of Object.entries(r)) ev.repaints[id] = (ev.repaints[id] || l.map(() => 0)).map((n, i) => n + (l[i] || 0)) }
      }
      if (R.stopped) throw new Error(`STOP: ${R.stopped}`)
    }
    if (req.oracle.target?.ring) ev.ring = await ringRole(p, req)
    if (req.oracle.guide) ev.guide = await walkGuide(p, req.oracle.guide)
    ev.after = await snapshot(p, req.board)
    if (shotPath) await p.shot(shotPath).catch(() => {})
    if (req.oracle.undo && req.oracle.outcome === 'change') {
      const u = await driveTurn(p, ctx, req, { say: 'undo', settleMs: 1100 })
      ev.undo = { turn: u, after: await snapshot(p, req.board) }
    }
    ev.errors = p.errors().filter(e => !/favicon|ResizeObserver|net::ERR_ABORTED/i.test(e))
  } catch (e) {
    ev.crash = String(e?.stack || e?.message || e).slice(0, 800)
    if (shotPath && p) await p.shot(shotPath).catch(() => {})
  }
  try { await p?.close() } catch { /* */ }
  R.queue.length = 0
  if (ev.crash || !ev.after) return { evidence: ev, result: { pass: false, graded: 0, na: 0, checks: [{ name: 'the run reached the end', pass: false, detail: ev.crash, tag: 'crash' }] } }
  return { evidence: ev, result: grade(req, ev) }
}
