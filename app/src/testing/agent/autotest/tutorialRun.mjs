// UCT Agent AUTOTEST: the TUTORIAL runner. BROWSER-MOCK-MODEL, free, never a paid call. The real Charts and Agent panel in an
// isolated headless Chrome, on a dev server this process owns. Each case asks for a walkthrough, does what a person does next
// (Exit, Escape, a click elsewhere, a new request, closing a chart...), and is graded from the guide's own store and the DOM.
//
//   node src/testing/agent/autotest/tutorialRun.mjs --out dir --cache dir [--ids regex] [--port 5303]
//
// The guide's store is read in the page through the very module the app imports (/src/agent/guide/guideStore.js on the dev
// server, one instance): read-only, no product file changes. Run it from app/.
import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { startServer } from './selectionServe.mjs'

const { values: A } = parseArgs({ options: {
  ids: { type: 'string', default: '' }, out: { type: 'string', default: 'tutorial-out' }, cache: { type: 'string', default: '' }, port: { type: 'string', default: '5303' },
} })
if (!A.cache) throw new Error('--cache: a scratch folder of this run\'s own')
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'UCT_AGENT_EVAL_API_KEY']) delete process.env[k]

const MODE = 'BROWSER-MOCK-MODEL'
const server = await startServer({ port: Number(A.port), cacheDir: A.cache })
process.env.BA_BASE = server.base
const { startRelay, open, sleep } = await import('../acceptance/lib.mjs')
const { BOARDS } = await import('./boards.mjs')
const { snapshot } = await import('./driver.mjs')
const { worldPrint } = await import('./oracle.mjs')
const { scripted } = await import('./plan.mjs')
const { gradeTutorial, tutorialFamily } = await import('./tutorialOracle.mjs')
const { tutorialCases } = await import('./tutorialCases.mjs')
const { runProfile } = await import('../../../econHarness/cdp.mjs')
const { claimProfile, reapOrphans, freeProfile } = await import('./profileGuard.mjs')
const { groupOfAction } = await import(pathToFileURL(server.routing).href)
const say = (line) => console.log(`[${MODE}] ${line}`)
const q = (s) => JSON.stringify(s)

// what the page holds: the guide's store, the ring, the card, and what the ring encloses (with the chart it sits in)
const PROBE = (roles) => `(async () => {
  let s = null, e = null, storeOk = true
  try { const m = await import('/src/agent/guide/guideStore.js'); s = m.guideState(); e = m.guideEnded() } catch { storeOk = false }
  const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (r.width < 2 || r.height < 2 || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null; return { x: r.left, y: r.top, w: r.width, h: r.height } }
  const ring = vis(document.querySelector('[data-testid="guide-ring"]'))
  const card = !!vis(document.querySelector('[data-testid="guide-card"]'))
  const roleOf = ${JSON.stringify(roles)}
  const roleAt = (x, y) => { for (const w of document.querySelectorAll('[data-widget-id]')) { const r = w.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && roleOf[w.dataset.widgetId]) return roleOf[w.dataset.widgetId] } return null }
  const near = (a, b, t) => Math.abs(a - b) <= t
  const inside = (o, i) => o.x <= i.x + 1 && o.y <= i.y + 1 && o.x + o.w >= i.x + i.w - 1 && o.y + o.h >= i.y + i.h - 1 && near(o.w, i.w, 24) && near(o.h, i.h, 24)
  const encloses = ring ? [...document.querySelectorAll('[data-guide]')].map(el => ({ el, r: vis(el) })).filter(x => x.r && inside(ring, x.r)).map(x => ({ guide: x.el.getAttribute('data-guide'), role: roleOf[x.el.closest('[data-widget-id]')?.dataset.widgetId] || null })) : []
  return { storeOk, store: { active: !!s, feature: s?.feature?.id ?? null, index: s?.index ?? null, steps: s?.steps?.length ?? null, chartRef: s?.chartRef ?? null, ended: e ? { featureId: e.featureId, reason: e.reason } : null },
    ring, card, inRole: ring ? roleAt(ring.x + ring.w / 2, ring.y + ring.h / 2) : null, encloses, text: document.querySelector('[data-testid="guide-text"]')?.textContent || '', notice: document.querySelector('[data-testid="guide-notice"]')?.textContent || '' }
})()`

const centre = async (p, sel) => p.b.evaluate(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return null; e.scrollIntoView?.({ block: 'nearest' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null })()`)
const clickSel = async (p, sel) => { const c = await centre(p, sel); if (!c) throw new Error(`nothing to click: ${sel}`); await p.b.click(c.x, c.y); await sleep(400) }
const planFor = (board, plan, feature) => (body) => scripted({ plan: typeof plan === 'object' && plan ? plan : { ops: [{ action: 'guide.show', target: '$list:guide', args: { feature: plan || feature, detail: null } }] } }, body, board)

const acts = {
  click: (p, c, [, role]) => p.select(BOARDS[c.board].roles[role].id),
  canvasOf: (p, c, [, role]) => p.select(BOARDS[c.board].roles[role].id),
  symbolOf: (p, c, [, role]) => clickSel(p, `[data-widget-id=${q(BOARDS[c.board].roles[role].id)}] [data-guide="chart.symbol"]`),
  gearOf: (p, c, [, role]) => clickSel(p, `[data-widget-id=${q(BOARDS[c.board].roles[role].id)}] [data-guide="chart.settings"]`),
  clickWidget: async (p, c, [, id]) => { const r = await p.b.evaluate(`(() => { const e = document.querySelector('[data-widget-id=${id}]'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`); await p.b.click(r.x, r.y); await sleep(400) },
  next: async (p) => { if (!(await p.button('Next', '[data-testid="guide-card"]'))) await p.button('Done', '[data-testid="guide-card"]'); await sleep(500) },
  exit: (p) => clickSel(p, '[aria-label="Exit the guide"]'),
  esc: async (p) => { await p.b.key('Escape'); await sleep(400) },
  escBoard: async (p) => { await p.b.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur()'); await p.b.key('Escape'); await sleep(400) },
  closeChart: (p, c, [, role]) => clickSel(p, `[data-widget-id=${q(BOARDS[c.board].roles[role].id)}] [aria-label="Close widget"]`),
  closeAgent: (p) => clickSel(p, '[aria-label="Close UCT Agent"]'),
  reload: async (p) => { await p.b.evaluate('setTimeout(() => location.reload(), 0), 1').catch(() => {}); await sleep(2500); await p.b.waitFor(`typeof window.__baRead === 'function' && document.readyState === 'complete'`, { timeout: 30000 }); await p.settle() },
  say: async (p, c, [, text, plan]) => { await p.say(text, planFor(c.board, plan, null)); await p.idle(20000); await sleep(900) },
  wait: (p, c, [, ms]) => sleep(ms),
}

async function runCase(ctx, c) {
  const B = BOARDS[c.board]
  const roles = Object.fromEntries(Object.entries(B.roles).map(([r, v]) => [v.id, r]))
  const ev = { acts: [] }
  let p = null
  try {
    p = await open(ctx.R, { query: B.browser.query || '', prefs: B.browser.prefs || null, fixtures: { routes: [] }, iaCatalog: B.browser.iaCatalog || null, profile: ctx.profile })
    ctx.onPage(p)
    await p.settle()
    await p.openPanel()
    const up = await p.b.waitFor(`(() => { const c = window.__baRead().filter(w => w.type === 'chart'); return !c.length || c.every(x => (x.sym && x.canvases > 5) || ${q(c.board)} === 'MC' && x.id === 'g3') })()`, { timeout: 30000 })
    if (!up) throw new Error('the board never painted')
    await p.settle()
    for (const r of c.clicks) await p.select(B.roles[r].id)
    ev.worldBefore = worldPrint(await snapshot(p, c.board))
    const rc0 = await p.receipts()
    await p.say(c.say, planFor(c.board, null, c.feature))
    await p.idle(20000)
    await p.b.waitFor(`!!document.querySelector('[data-testid="guide-ring"]')`, { timeout: 4000 })
    await sleep(700)
    ev.start = await p.b.evaluate(PROBE(roles))
    ev.said = (await p.last()).slice(-300)
    for (const a of c.acts) { await acts[a[0]](p, c, a); ev.acts.push(a[0]) }
    await p.b.hover(2, 2)        // the pointer leaves, so no crosshair is in the after picture (the before had none)
    await sleep(900)
    ev.end = await p.b.evaluate(PROBE(roles))
    await p.settle()
    ev.worldAfter = worldPrint(await snapshot(p, c.board))
    const rc = await p.receipts()
    ev.newReceipt = rc > rc0
    ev.receiptText = ev.newReceipt ? (await p.receipt())?.text : null
    ev.errors = p.errors().filter(e => !/favicon|ResizeObserver|net::ERR_ABORTED/i.test(e))
    if (ctx.shots) await p.shot(join(ctx.shots, `${c.id}.png`)).catch(() => {})
  } catch (e) {
    ev.crash = String(e?.stack || e?.message || e).slice(0, 600)
  }
  try { await p?.close() } catch { /* */ }
  ctx.R.queue.length = 0
  if (ev.crash) return { ev, result: { pass: false, graded: 0, na: 0, checks: [{ name: 'the run reached the end', pass: false, detail: ev.crash, tag: 'crash' }] } }
  if (ev.start && ev.start.storeOk === false) return { ev, result: { pass: false, graded: 0, na: 0, checks: [{ name: 'the guide store is readable in the page', pass: false, detail: 'import of /src/agent/guide/guideStore.js failed', tag: 'harness' }] } }
  return { ev, result: gradeTutorial(c, ev) }
}

const all = tutorialCases()
const list = A.ids ? all.filter(c => new RegExp(A.ids).test(c.id)) : all
mkdirSync(join(A.out, 'shots'), { recursive: true })
const R = await startRelay({ groupOfAction })
const reaped = reapOrphans()
if (reaped.length) say(`reaped ${reaped.length} orphaned Chrome profile(s) from dead runs`)
let page = null, hungOnce = false
const ctx = { R, profile: claimProfile(runProfile()), shots: join(A.out, 'shots'), onPage: (p) => { page = p } }
say(`${list.length} tutorial cases, out ${A.out}, ${server.base}`)
const rows = []
for (const c of list) {
  let timer
  const hung = new Promise((resolve) => { timer = setTimeout(() => { hungOnce = true; page?.close().catch(() => {}); resolve({ ev: { crash: 'the page stopped answering' }, result: { pass: false, graded: 0, na: 0, checks: [{ name: 'the run reached the end', pass: false, detail: 'the page stopped answering', tag: 'crash' }] } }) }, 150000) })
  let { ev, result } = await Promise.race([runCase(ctx, c), hung])
  clearTimeout(timer)
  if (hungOnce) { hungOnce = false; const k = await freeProfile(ctx.profile); if (k) say(`killed ${k} stuck Chrome process(es) holding the run profile`) }
  if (/chrome did not come up/.test(ev.crash || '')) { await freeProfile(ctx.profile); ({ ev, result } = await runCase(ctx, c)) }
  const fam = result.pass ? null : (result.checks[0]?.tag === 'crash' ? 'harness' : tutorialFamily(c, result))
  const failed = result.checks.filter(x => !x.pass)
  rows.push({ id: c.id, family: c.family, board: c.board, pass: result.pass, failureFamily: fam, failed, said: ev.said, start: ev.start, end: ev.end, acts: ev.acts })
  say(`${result.pass ? 'PASS' : 'FAIL'} ${c.id}${result.pass ? '' : ` [${fam}] ${failed[0]?.name}: ${String(failed[0]?.detail || '').slice(0, 220)}`}`)
  writeFileSync(join(A.out, `results.tutorial.${MODE}.json`), JSON.stringify({ MODE, statement: 'BROWSER-MOCK-MODEL: real Charts UI, scripted model. Graded from the guide store and the DOM.', totals: { cases: rows.length, passed: rows.filter(r => r.pass).length }, rows }, null, 1))
}
const byFam = {}
for (const r of rows.filter(x => !x.pass)) (byFam[r.failureFamily] = byFam[r.failureFamily] || []).push(r.id)
writeFileSync(join(A.out, `families.tutorial.json`), JSON.stringify(byFam, null, 1))
say(`${rows.filter(r => r.pass).length}/${rows.length} passed; ${Object.keys(byFam).length} failure families`)
R.close?.()
await server.close()
process.exit(0)
