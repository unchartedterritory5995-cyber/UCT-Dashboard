// UCT Agent GUIDE GEOMETRY: where the walkthrough ring sits against the control it rings, measured in a real Chromium.
// REAL BROWSER (Chromium automation), scripted model: the real Charts board and the real guide overlay on agent-harness.html,
// the planner scripted (guide.show), never a paid call. Read-only: no product file changes.
//
//   node src/testing/agent/guide-geometry/geometryRun.mjs --out dir --cache dir [--ids regex] [--port 5307] [--drag-steps 60]
//
// For each case: start the walkthrough, reach the step, then measure
//   static   the ring's rect against the target's getBoundingClientRect, per edge, in CSS px (ring minus target: the overlay pads
//            by its own `rectOf(el, 4)`, so a clean ring reads 4 px outside on every edge; the report gives the raw number)
//   drag     (the resize corner) a continuous pointer drag of the corner, the ring and the handle sampled every animation frame
//            in the page: per-frame distance between the ring's centre and the handle's centre in px, and how long ago the handle was where the ring
//            is now (ms), plus how long after release the ring catches up
//   scroll   the nearest scrollable ancestor of the target scrolled by 80 px: the same per-frame sampling while it moves
// The ring is read by its rendered getBoundingClientRect (the fix places it by transform). Matrix: 2 viewports x 2 boards x zoom 100 / 125 (125 = the zoom a browser applies: devicePixelRatio 1.25 and a CSS viewport
// 1/1.25 the size, set through CDP device metrics), plus a scrolled-container variant. A screenshot per case.
import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { startServer } from '../autotest/selectionServe.mjs'

const { values: A } = parseArgs({ options: {
  ids: { type: 'string', default: '' }, out: { type: 'string', default: 'geometry-out' }, cache: { type: 'string', default: '' }, port: { type: 'string', default: '5307' },
  'drag-steps': { type: 'string', default: '60' }, label: { type: 'string', default: '' },
} })
if (!A.cache) throw new Error('--cache: a scratch folder of this run\'s own')
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'UCT_AGENT_EVAL_API_KEY']) delete process.env[k]

const MODE = 'REAL BROWSER (Chromium automation), scripted model'
const server = await startServer({ port: Number(A.port), cacheDir: A.cache })
process.env.BA_BASE = server.base
const { startRelay, open, sleep } = await import('../acceptance/lib.mjs')
const { BOARDS } = await import('../autotest/boards.mjs')
const { scripted } = await import('../autotest/plan.mjs')
const { runProfile } = await import('../../../econHarness/cdp.mjs')
const { claimProfile, reapOrphans, freeProfile } = await import('../autotest/profileGuard.mjs')
const { groupOfAction } = await import(pathToFileURL(server.routing).href)
const say = (line) => console.log(`[GEOMETRY] ${line}`)
const q = (s) => JSON.stringify(s)

// ── the targets: (a) a chart's edge (its boundary, top to bottom), (b) the resize corner, (c) a toolbar button, (d) a menu row,
//    (e) a widget control. `sel` finds the candidates; the one the ring overlaps most is the target measured
const TARGETS = {
  plot: { kind: 'a chart boundary (chart.plot, after arming the trendline tool)', feature: 'drawing', detail: 'trendline', say: 'how do I draw a trendline on this chart', sel: '[data-guide="chart.plot"]', steps: [['clickRinged', '[data-guide="chart.tool.trendline"]'], ['waitRingOn', '[data-guide="chart.plot"]']] },
  edge: { kind: 'a chart boundary (resize edge)', feature: 'widgetResize', say: 'how do I resize this chart', sel: '[data-guide="widget.resize.e"],[data-guide="workspace.seam"]', steps: [] },
  corner: { kind: 'a chart-resize corner', feature: 'widgetResize', say: 'how do I resize this chart', sel: '[data-guide="widget.resize.se"]', steps: [['next']], drag: true },
  toolbar: { kind: 'a toolbar button (timeframe)', feature: 'timeframe', say: 'how do I change the timeframe on this chart', sel: '[data-guide="chart.timeframe"]', steps: [] },
  menu: { kind: 'a menu row (custom interval, in the timeframe menu)', feature: 'timeframeCustom', say: 'how do I add a custom timeframe to this chart', sel: '[data-guide="chart.timeframeMenu"] [aria-label="Interval count"]', steps: [['clickRinged', '[data-guide="chart.timeframeMore"]'], ['waitSel', '[data-guide="chart.timeframeMenu"]']] },
  widget: { kind: 'a widget control (link colour dot)', feature: 'link', say: 'how do I change the link colour of this chart', sel: '[data-guide="widget.link"]', steps: [] },
}
const VIEWPORTS = { L: [1500, 900], S: [1100, 700], XS: [1100, 480] }
const LAYOUTS = { TWO: 'A', FOUR: 'TL' }      // the board and the chart the walkthrough is asked on
const cases = []
for (const [t, T] of Object.entries(TARGETS)) for (const v of ['L', 'S']) for (const [b, role] of Object.entries(LAYOUTS)) for (const z of [100, 125])
  cases.push({ id: `${t}-${b}-${v}-z${z}`, target: t, board: b, role, vp: v, zoom: z, scroll: false })
for (const t of Object.keys(TARGETS)) cases.push({ id: `${t}-FOUR-XS-z100-scrolled`, target: t, board: 'FOUR', role: 'TL', vp: 'XS', zoom: 100, scroll: true })
// tracking must STOP: drag the corner, release, end it at once (Done, Exit, Escape) or take its target away (close the chart), then
// count the guide's own callbacks over the next 2 s and what is still registered
for (const how of ['done', 'exit', 'escape', 'unmount', 'drag']) cases.push({ id: `stop-${how}-TWO-L-z100`, target: 'corner', board: 'TWO', role: 'A', vp: 'L', zoom: 100, scroll: false, stop: how })

// in the page: the ring, and the visible candidate that overlaps it most
const MEASURE = (sel) => `(() => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
  const ringEl = document.querySelector('[data-testid="guide-ring"]')
  const ring = ringEl ? R(ringEl) : null
  const cs = ringEl ? getComputedStyle(ringEl) : null
  const cands = [...document.querySelectorAll(${q(sel)})].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
  const ov = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  let best = null, bestOv = -1, bestD = 1e9
  for (const e of cands) { const r = R(e); const o = ring ? ov(ring, r) : 0; const d = ring ? Math.hypot((r.left + r.right) / 2 - (ring.left + ring.right) / 2, (r.top + r.bottom) / 2 - (ring.top + ring.bottom) / 2) : 0; if (o > bestOv || (o === bestOv && d < bestD)) { best = e; bestOv = o; bestD = d } }
  const target = best ? R(best) : null
  const cell = best?.closest?.('[data-widget-id]')
  return { ring, target, candidates: cands.length, widget: cell ? { id: cell.getAttribute('data-widget-id'), ...R(cell) } : null,
    ringStyle: cs ? { border: cs.borderTopWidth, outline: cs.outlineWidth, outlineOffset: cs.outlineOffset, boxShadow: cs.boxShadow.slice(0, 120), transition: cs.transitionProperty + ' ' + cs.transitionDuration } : null,
    dpr: devicePixelRatio, inner: [innerWidth, innerHeight], step: document.querySelector('[data-testid="guide-text"]')?.textContent?.slice(0, 120) || '' }
})()`
const edges = (m) => m.ring && m.target ? { left: +(m.target.left - m.ring.left).toFixed(2), top: +(m.target.top - m.ring.top).toFixed(2), right: +(m.ring.right - m.target.right).toFixed(2), bottom: +(m.ring.bottom - m.target.bottom).toFixed(2) } : null

// in the page: sample the ring and the target every animation frame until stopped
const SAMPLER = (sel) => `(() => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }
  const ringEl = () => document.querySelector('[data-testid="guide-ring"]')
  const pick = () => { const ring = ringEl()?.getBoundingClientRect(); const c = [...document.querySelectorAll(${q(sel)})].filter(e => e.getBoundingClientRect().width > 0); if (!ring) return c[0]; let b = c[0], bd = 1e9; for (const e of c) { const r = e.getBoundingClientRect(); const d = Math.hypot(r.left - ring.left, r.top - ring.top); if (d < bd) { b = e; bd = d } } return b }
  const target = pick()
  window.__geo = { s: [], on: true }
  const loop = () => { if (!window.__geo.on) return; window.__geo.s.push([performance.now(), R(ringEl()), R(target)]); requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
  return !!target
})()`

const PAD = 4

// in the page, installed just before the walkthrough starts: every requestAnimationFrame, ResizeObserver, interval and
// scroll / resize / pointer / key listener created from a guide module (/src/agent/guide/ in its creation stack) is wrapped, so
// its callbacks are logged and what is still registered can be counted
const INSTRUMENT = `(() => {
  if (window.__geoI) return true
  Error.stackTraceLimit = 60
  const G = /\\/src\\/agent\\/guide\\//
  const I = window.__geoI = { log: [], ro: new Set(), ls: new Map(), iv: new Map(), raf: new Map() }
  const fromGuide = () => G.test(new Error().stack || '')
  const oRaf = window.requestAnimationFrame.bind(window), oCaf = window.cancelAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) => { if (!fromGuide()) return oRaf(cb); const id = oRaf((t) => { I.raf.delete(id); I.log.push(['raf', performance.now()]); cb(t) }); I.raf.set(id, 1); return id }
  window.cancelAnimationFrame = (id) => { I.raf.delete(id); return oCaf(id) }
  const oSI = window.setInterval.bind(window), oCI = window.clearInterval.bind(window)
  window.setInterval = (fn, ms, ...a) => { if (typeof fn !== 'function' || !fromGuide()) return oSI(fn, ms, ...a); const at = ((new Error().stack || '').split('\\n').find(l => G.test(l)) || '').replace(/^.*\\/src\\//, '').replace(/[?][^:]*/, '').slice(0, 80); const id = oSI(() => { I.log.push(['interval', performance.now(), id]); fn(...a) }, ms); I.iv.set(id, ms + 'ms ' + at); return id }
  window.clearInterval = (id) => { I.iv.delete(id); return oCI(id) }
  const oCT = window.clearTimeout.bind(window)
  window.clearTimeout = (id) => { I.iv.delete(id); return oCT(id) }
  const ORO = window.ResizeObserver
  window.ResizeObserver = class extends ORO {
    constructor(cb) { const g = fromGuide(); super((e, o) => { if (g) I.log.push(['ro', performance.now()]); cb(e, o) }); this.__g = g; this.__n = new Set() }
    observe(t, o) { if (this.__g) { this.__n.add(t); I.ro.add(this) } return super.observe(t, o) }
    unobserve(t) { this.__n.delete(t); if (!this.__n.size) I.ro.delete(this); return super.unobserve(t) }
    disconnect() { this.__n.clear(); I.ro.delete(this); return super.disconnect() }
  }
  const TYPES = /^(scroll|resize|pointermove|pointerdown|pointerup|pointercancel|mousemove|mousedown|mouseup|keydown|keyup|wheel)$/
  const oAdd = EventTarget.prototype.addEventListener, oRem = EventTarget.prototype.removeEventListener
  const k2 = (type, o) => type + '|' + (typeof o === 'boolean' ? o : !!(o && o.capture))
  EventTarget.prototype.addEventListener = function (type, fn, o) {
    if (!TYPES.test(type) || typeof fn !== 'function' || !fromGuide()) return oAdd.call(this, type, fn, o)
    let per = I.ls.get(this); if (!per) { per = new Map(); I.ls.set(this, per) }
    const k = k2(type, o); let m = per.get(k); if (!m) { m = new Map(); per.set(k, m) }
    if (m.has(fn)) return
    const w = function (e) { I.log.push(['ev:' + type, performance.now()]); return fn.call(this, e) }
    m.set(fn, w); return oAdd.call(this, type, w, o)
  }
  EventTarget.prototype.removeEventListener = function (type, fn, o) {
    const m = I.ls.get(this) && I.ls.get(this).get(k2(type, o)); const w = m && m.get(fn)
    if (w) { m.delete(fn); return oRem.call(this, type, w, o) }
    return oRem.call(this, type, fn, o)
  }
  return true
})()`
const LIVE = `(() => { const I = window.__geoI; let ls = 0; const types = {}; for (const [t, per] of I.ls) for (const [k, m] of per) { ls += m.size; if (m.size) types[k + '@' + (t === window ? 'window' : t === document ? 'document' : t.nodeName || '?')] = m.size }
  return { listeners: ls, listenerTypes: types, resizeObserversObserving: I.ro.size, pendingRaf: I.raf.size, intervals: [...I.iv.values()] } })()`
function analyse(samples, tRelease) {
  // per frame: the distance between the ring's centre and the target's centre (independent of the ring's shape: a padded box on
  // master, a circle on a handle after the fix), and how long ago the target's centre was where the ring's centre is now
  const fr = samples.filter(s => s[1] && s[2])
  const c = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const rows = fr.map(([ts, r, t], i) => {
    const rc = c(r), o = d(rc, c(t))
    let lag = 0
    if (o > 1) { lag = null; for (let j = i; j >= 0; j--) if (d(rc, c(fr[j][2])) <= 1) { lag = ts - fr[j][0]; break } }
    return { ts, o, lag, during: tRelease == null || ts <= tRelease }
  })
  const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))].toFixed(1) }
  const dur = rows.filter(r => r.during)
  const offs = dur.map(r => r.o), lags = dur.map(r => r.lag).filter(x => x != null)
  let settle = null
  if (tRelease != null) { const after = rows.filter(r => r.ts > tRelease); const k = after.findIndex((r, i) => after.slice(i).every(x => x.o <= 1)); settle = k >= 0 ? +(after[k].ts - tRelease).toFixed(0) : 'never (within the window)' }
  const mean = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null
  return { frames: samples.length, framesBoth: fr.length, ringMissingFrames: samples.filter(s => !s[1]).length, centreDistPx: { max: offs.length ? +Math.max(...offs).toFixed(1) : null, p95: pct(offs, 0.95), mean: mean(offs), p50: pct(offs, 0.5) },
    lagMs: { max: lags.length ? +Math.max(...lags).toFixed(0) : null, p95: pct(lags, 0.95), mean: mean(lags), p50: pct(lags, 0.5), unmatchedFrames: dur.filter(r => r.lag == null).length }, settleAfterReleaseMs: settle }
}

async function runCase(ctx, c) {
  const B = BOARDS[c.board], T = TARGETS[c.target]
  const [w, h] = VIEWPORTS[c.vp]
  const ev = { id: c.id, kind: T.kind, board: c.board, viewport: `${w}x${h}`, zoom: c.zoom, scrolled: c.scroll }
  let p = null
  try {
    p = await open(ctx.R, { query: B.browser.query || '', prefs: B.browser.prefs || null, fixtures: { routes: [] }, iaCatalog: B.browser.iaCatalog || null, profile: ctx.profile, width: w, height: h })
    if (c.zoom !== 100) { const f = c.zoom / 100; await p.b.send('Emulation.setDeviceMetricsOverride', { width: Math.round(w / f), height: Math.round(h / f), deviceScaleFactor: f, mobile: false }); await sleep(800) }
    await p.settle()
    await p.openPanel()
    await p.b.waitFor(`window.__baRead().filter(w => w.type === 'chart').every(x => x.sym && x.canvases > 5)`, { timeout: 30000 })
    await p.settle()
    await p.select(B.roles[c.role].id)
    await p.b.evaluate(INSTRUMENT)
    await p.say(T.say, (body) => scripted({ plan: { ops: [{ action: 'guide.show', target: '$list:guide', args: { feature: T.feature, detail: T.detail || null } }] } }, body, c.board))
    await p.idle(20000)
    if (!(await p.b.waitFor(`!!document.querySelector('[data-testid="guide-ring"]')`, { timeout: 6000 }))) throw new Error('no ring after the request')
    await sleep(600)
    for (const s of T.steps) {
      if (s[0] === 'next') { await p.button('Next', '[data-testid="guide-card"]'); await sleep(700) }
      if (s[0] === 'clickRinged') { const at = await p.b.evaluate(`(() => { const ring = document.querySelector('[data-testid="guide-ring"]').getBoundingClientRect(); const c = [...document.querySelectorAll(${q(s[1])})].filter(e => e.getBoundingClientRect().width > 0); let b = null, bd = 1e9; for (const e of c) { const r = e.getBoundingClientRect(); const d = Math.hypot(r.left + r.width / 2 - ring.left - ring.width / 2, r.top + r.height / 2 - ring.top - ring.height / 2); if (d < bd) { b = r; bd = d } } return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null })()`); if (!at) throw new Error(`nothing ringed to click: ${s[1]}`); await p.b.click(at.x, at.y); await sleep(800) }
      if (s[0] === 'waitRingOn') { const ok = await p.b.waitFor(`(() => { const g = document.querySelector('[data-testid="guide-ring"]')?.getBoundingClientRect(); if (!g) return false; return [...document.querySelectorAll(${q(s[1])})].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && Math.abs((r.left + r.right) / 2 - (g.left + g.right) / 2) < 40 && Math.abs(r.top - g.top) < 40 && g.bottom > r.top + 40 }) })()`, { timeout: 5000 }); if (!ok) throw new Error(`the ring never reached ${s[1]}`); await sleep(700) }
      if (s[0] === 'waitSel') { if (!(await p.b.waitFor(`!!document.querySelector(${q(s[1])})`, { timeout: 5000 }))) throw new Error(`never appeared: ${s[1]}`); await sleep(700) }
    }
    if (c.scroll) {
      // the nearest scrollable ancestor of the target, or the page
      const sc = await p.b.evaluate(`(() => { const t = document.querySelector(${q(T.sel)}); let e = t?.parentElement; while (e && e !== document.body) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2)) { e.setAttribute('data-geo-scroller', '1'); return { tag: e.tagName, cls: String(e.className).slice(0, 60), room: [e.scrollWidth - e.clientWidth, e.scrollHeight - e.clientHeight] } } e = e.parentElement } const d = document.scrollingElement; return d.scrollHeight > d.clientHeight + 2 ? { tag: 'page', room: [0, d.scrollHeight - d.clientHeight] } : null })()`)
      ev.scroller = sc
      if (sc) {
        await p.b.evaluate(SAMPLER(T.sel))
        await sleep(200)
        const t0 = await p.b.evaluate(`(() => { const e = document.querySelector('[data-geo-scroller]') || document.scrollingElement; const vert = e.scrollHeight > e.clientHeight + 2; e.scrollBy(vert ? 0 : 80, vert ? 80 : 0); return performance.now() })()`)
        await sleep(900)
        const samples = await p.b.evaluate('(window.__geo.on = false, window.__geo.s)')
        ev.scrollTrack = analyse(samples.filter(s => s[0] >= t0), null)
        ev.scrollTrack.settleMs = (() => { const fr = samples.filter(s => s[0] >= t0 && s[1] && s[2]); const ok = (s) => Math.hypot((s[1][0] + s[1][2] - s[2][0] - s[2][2]) / 2, (s[1][1] + s[1][3] - s[2][1] - s[2][3]) / 2) <= 1; const k = fr.findIndex((s, i) => fr.slice(i).every(ok)); return k >= 0 ? +(fr[k][0] - t0).toFixed(0) : 'never (within 900 ms)' })()
      }
    }
    const m = await p.b.evaluate(MEASURE(T.sel))
    ev.static = { ...m, edgeOutsidePx: edges(m), centreDistPx: m.ring && m.target ? +Math.hypot((m.ring.left + m.ring.right - m.target.left - m.target.right) / 2, (m.ring.top + m.ring.bottom - m.target.top - m.target.bottom) / 2).toFixed(2) : null, widgetVsRing: m.ring && m.widget ? { left: +(m.widget.left - m.ring.left).toFixed(2), top: +(m.widget.top - m.ring.top).toFixed(2), right: +(m.ring.right - m.widget.right).toFixed(2), bottom: +(m.ring.bottom - m.widget.bottom).toFixed(2) } : null }
    if (ctx.shots) await p.shot(join(ctx.shots, `${c.id}.png`)).catch(() => {})
    if (c.target === 'plot' && m.ring && m.target && m.widget) {
      const fit = (box) => ({ left: +(box.left - m.ring.left).toFixed(1), top: +(box.top - m.ring.top).toFixed(1), right: +(m.ring.right - box.right).toFixed(1), bottom: +(m.ring.bottom - box.bottom).toFixed(1),
        uncoveredPx: { top: Math.max(0, +(m.ring.top - box.top).toFixed(1)), bottom: Math.max(0, +(box.bottom - m.ring.bottom).toFixed(1)), left: Math.max(0, +(m.ring.left - box.left).toFixed(1)), right: Math.max(0, +(box.right - m.ring.right).toFixed(1)) } })
      ev.wholeChart = { note: 'ring outside the box per edge (px, positive = ring outside); uncoveredPx = how much of the box the ring leaves out', vsPlot: fit(m.target), vsCell: fit(m.widget) }
      // one picture per box: the box outlined (cyan) under the ring, nothing else changed
      for (const [name, box] of [['plot', m.target], ['cell', m.widget]]) {
        await p.b.evaluate(`(() => { const d = document.createElement('div'); d.id = '__geoBox'; Object.assign(d.style, { position: 'fixed', left: '${box.left}px', top: '${box.top}px', width: '${box.width}px', height: '${box.height}px', outline: '2px dashed #00e5ff', zIndex: 2147483647, pointerEvents: 'none' }); document.body.appendChild(d); return 1 })()`)
        await sleep(120)
        if (ctx.shots) await p.shot(join(ctx.shots, `${c.id}-vs-${name}.png`)).catch(() => {})
        await p.b.evaluate(`document.getElementById('__geoBox')?.remove()`)
      }
    }
    if (T.drag && m.target && !c.stop) {
      const f = c.zoom / 100
      await p.b.evaluate(SAMPLER(T.sel))
      const t0 = await p.b.evaluate('performance.now()')
      for (let i = 1; i <= 24; i++) { await p.b.send('Emulation.setDeviceMetricsOverride', { width: Math.round((w - i * 8) / f), height: Math.round(h / f), deviceScaleFactor: f, mobile: false }); await sleep(30) }
      const t1 = await p.b.evaluate('performance.now()')
      await sleep(800)
      const samples = await p.b.evaluate('(window.__geo.on = false, window.__geo.s)')
      ev.reflow = { what: 'window narrowed 192 px in 24 steps (the board reflows, the corner moves)', durationMs: Math.round(t1 - t0), ...analyse(samples.filter(x => x[0] >= t0), t1) }
      await p.b.send('Emulation.setDeviceMetricsOverride', { width: Math.round(w / f), height: Math.round(h / f), deviceScaleFactor: f, mobile: false }); await sleep(900)
      const m2 = await p.b.evaluate(MEASURE(T.sel)); if (m2.target) Object.assign(m, { target: m2.target, ring: m2.ring })
    }
    if (c.stop && m.target) {
      const sx = (m.target.left + m.target.right) / 2, sy = (m.target.top + m.target.bottom) / 2
      const send = (type, x, y, buttons) => p.b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 })
      ev.liveDuring = await p.b.evaluate(LIVE)
      const tEnd = await p.b.evaluate('performance.now()')
      let tFrom = tEnd
      if (c.stop === 'drag') {
        await send('mouseMoved', sx, sy, 0); await sleep(100); await send('mousePressed', sx, sy, 1)
        for (let i = 1; i <= 20; i++) { await send('mouseMoved', sx - i * 3, sy - i * 2, 1); await sleep(16) }
        await send('mouseReleased', sx - 60, sy - 40, 0)
        tFrom = await p.b.evaluate('performance.now()')
      }
      if (c.stop === 'done') { if (!(await p.button('Done', '[data-testid="guide-card"]'))) throw new Error('no Done on the card') }
      if (c.stop === 'exit') { const at = await p.box('[aria-label="Exit the guide"]'); if (at) await p.b.click(at.x, at.y); else if (!(await p.button('Exit', '[data-testid="guide-card"]'))) throw new Error('no Exit on the card') }
      if (c.stop === 'escape') { await p.b.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur()'); await p.b.key('Escape') }
      if (c.stop === 'unmount') { const at = await p.box(`[data-widget-id=${q(B.roles[c.role].id)}] [aria-label="Close widget"]`); if (!at) throw new Error('no Close widget'); await p.b.click(at.x, at.y) }
      await sleep(2100)
      const log = await p.b.evaluate('window.__geoI.log.slice()')
      const count = (from) => { const o = {}; for (const [k, t] of log) if (t >= from) o[k] = (o[k] || 0) + 1; return o }
      const ivFiring = [...new Set(log.filter(x => x[0] === 'interval' && x[1] >= tFrom + 1100).map(x => x[2]))]
      ev.stopCheck = { how: c.stop, card2s: await p.b.evaluate(`(document.querySelector('[data-testid="guide-card"]')?.textContent || '').slice(0, 160)`), ringAfter: await p.b.evaluate(`!!document.querySelector('[data-testid="guide-ring"]') && getComputedStyle(document.querySelector('[data-testid="guide-ring"]')).opacity !== '0'`),
        cardAfter: await p.b.evaluate(`!!document.querySelector('[data-testid="guide-card"]')`),
        measuredFrom: c.stop === 'drag' ? 'the release' : 'the end action', callbacksFromEnd: count(tFrom), callbacksAfter150ms: count(tFrom + 150), callbacksLastSecond: count(tFrom + 1100), intervalIdsStillFiring: ivFiring, live2sAfter: await p.b.evaluate(LIVE) }
      if (ctx.shots) await p.shot(join(ctx.shots, `${c.id}.png`)).catch(() => {})
    } else if (T.drag && m.target) {
      // a continuous drag of the corner: press, move in small steps (one per ~16 ms), release; every frame sampled in the page
      const sx = (m.target.left + m.target.right) / 2, sy = (m.target.top + m.target.bottom) / 2
      const send = (type, x, y, buttons) => p.b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 })
      await p.b.evaluate(SAMPLER(T.sel))
      await send('mouseMoved', sx, sy, 0); await sleep(150)
      await send('mousePressed', sx, sy, 1); await sleep(60)
      const N = Number(A['drag-steps']), dx = -Math.min(160, m.target.left * 0.25), dy = -Math.min(120, m.target.top * 0.2)
      const tStart = await p.b.evaluate('performance.now()')
      for (let i = 1; i <= N; i++) { const k = i / N; await send('mouseMoved', sx + dx * k, sy + dy * k, 1); await sleep(16) }
      const tRelease = await p.b.evaluate('performance.now()')
      await send('mouseReleased', sx + dx, sy + dy, 0)
      await sleep(1200)
      const samples = await p.b.evaluate('(window.__geo.on = false, window.__geo.s)')
      ev.drag = { steps: N, movedPx: [Math.round(dx), Math.round(dy)], durationMs: Math.round(tRelease - tStart), ...analyse(samples.filter(s => s[0] >= tStart), tRelease) }
      { const gone = samples.find(x => x[0] >= tStart && !x[1]); ev.drag.ringGoneAtMs = gone ? Math.round(gone[0] - tStart) : null; const back = gone ? samples.find(x => x[0] > gone[0] && x[1]) : null; ev.drag.ringBackAtMs = back ? Math.round(back[0] - tStart) : null }
      ev.drag.cardAfter = await p.b.evaluate(`(document.querySelector('[data-testid="guide-card"]')?.textContent || '').slice(0, 200)`)
      ev.drag.agentSaid = (await p.last()).slice(-260)
      const after = await p.b.evaluate(MEASURE(T.sel))
      ev.drag.afterRelease = { edgeOutsidePx: edges(after), handleMoved: after.target ? [+(after.target.left - m.target.left).toFixed(1), +(after.target.top - m.target.top).toFixed(1)] : null }
      if (ctx.shots) await p.shot(join(ctx.shots, `${c.id}-after-drag.png`)).catch(() => {})
      // the mid-drag picture: a second drag on the same path back, shot at its middle (kept out of the measured pass)
      if (ctx.shots && after.target) {
        const bx = (after.target.left + after.target.right) / 2, by = (after.target.top + after.target.bottom) / 2
        await send('mouseMoved', bx, by, 0); await sleep(150); await send('mousePressed', bx, by, 1); await sleep(60)
        for (let i = 1; i <= N; i++) { const k = i / N; await send('mouseMoved', bx - dx * k, by - dy * k, 1); await sleep(16); if (i === Math.floor(N / 2)) await p.shot(join(ctx.shots, `${c.id}-mid-drag.png`)).catch(() => {}) }
        await send('mouseReleased', bx - dx, by - dy, 0); await sleep(600)
      }
    }
  } catch (e) {
    ev.crash = String(e?.stack || e?.message || e).slice(0, 500)
  }
  try { await p?.close() } catch { /* */ }
  ctx.R.queue.length = 0
  return ev
}

const list = A.ids ? cases.filter(c => new RegExp(A.ids).test(c.id)) : cases
mkdirSync(join(A.out, 'shots'), { recursive: true })
const R = await startRelay({ groupOfAction })
const reaped = reapOrphans()
if (reaped.length) say(`reaped ${reaped.length} orphaned Chrome profile(s)`)
const ctx = { R, profile: claimProfile(runProfile()), shots: join(A.out, 'shots') }
say(`${MODE}: ${list.length} cases, out ${A.out}, ${server.base} ${A.label}`)
const rows = []
for (const c of list) {
  let timer
  const hung = new Promise((resolve) => { timer = setTimeout(() => resolve({ id: c.id, crash: 'the page stopped answering' }), 120000) })
  let ev = await Promise.race([runCase(ctx, c), hung])
  clearTimeout(timer)
  if (/stopped answering|chrome did not come up/.test(ev.crash || '')) { await freeProfile(ctx.profile); ev = await runCase(ctx, c) }
  rows.push(ev)
  if (ev.stopCheck) say(`STOP ${c.id} from-end ${JSON.stringify(ev.stopCheck.callbacksFromEnd)} after150 ${JSON.stringify(ev.stopCheck.callbacksAfter150ms)} live ${JSON.stringify(ev.stopCheck.live2sAfter)}`)
  const e = ev.static?.edgeOutsidePx
  say(`${ev.crash ? 'CRASH' : 'OK'} ${c.id}${ev.crash ? ` ${ev.crash.slice(0, 200)}` : ` edges(out px) L${e?.left} T${e?.top} R${e?.right} B${e?.bottom} centre ${ev.static?.centreDistPx}${ev.drag ? ` drag centre max ${ev.drag.centreDistPx.max} p95 ${ev.drag.centreDistPx.p95} (ring gone at ${ev.drag.ringGoneAtMs}ms) lag max ${ev.drag.lagMs.max}ms p95 ${ev.drag.lagMs.p95}ms settle ${ev.drag.settleAfterReleaseMs}` : ''}${ev.reflow ? ` reflow centre max ${ev.reflow.centreDistPx.max} p95 ${ev.reflow.centreDistPx.p95} lag max ${ev.reflow.lagMs.max}ms settle ${ev.reflow.settleAfterReleaseMs}` : ''}${ev.scrollTrack ? ` scroll centre max ${ev.scrollTrack.centreDistPx.max} settle ${ev.scrollTrack.settleMs}` : c.scroll ? " no scroller" : ""}`}`)
  writeFileSync(join(A.out, 'results.geometry.json'), JSON.stringify({ MODE, label: A.label, pad: PAD, rows }, null, 1))
}
R.close?.()
await server.close()
process.exit(0)
