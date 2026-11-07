// UCT Agent VISUAL TEACHING — the browser runner that proves a walkthrough rings the real control (dev-only, never bundled).
//
//   One line (from app/, with the dev server up on 127.0.0.1:5302 — see README in this folder):
//     node src/testing/agent/guide/teach.mjs [--filter <regex on id or words>] [--out <file.json>]
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
const CASES = JSON.parse(readFileSync(path.join(HERE, 'cases.inventory.json'), 'utf8'))

if (!process.env.TEACH_CASE) {
  // ── the driver: one child per case ──
  const filter = arg('--filter') ? new RegExp(arg('--filter'), 'i') : null
  const out = arg('--out') || 'teach-results.json'
  const picked = CASES.map((c, i) => [c, i]).filter(([c]) => !filter || filter.test(c.id) || filter.test(c.say))
  const results = []
  for (const [c, i] of picked) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, TEACH_CASE: String(i) }, encoding: 'utf8', timeout: 150000 })
    let rec = null
    try { rec = JSON.parse(String(r.stdout).trim().split('\n').filter(l => l.startsWith('{"')).pop()) } catch { rec = null }
    if (!rec) rec = { ...c, pass: false, error: r.error ? String(r.error.message || r.error) : `no result (exit ${r.status}) ${String(r.stderr).slice(-300)}` }
    results.push(rec)
    console.log(`${rec.pass ? 'PASS' : 'FAIL'}  ${c.id}  ${c.say}${rec.pass ? '' : `  — ${rec.why || rec.error || ''}`}`)
  }
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base: process.env.BA_BASE || null, results }, null, 1))
  console.log(`\n${results.filter(r => r.pass).length}/${results.length} pass → ${out}`)
  process.exit(0)
}

// ── one case ──
const { startRelay, open, sleep } = await import('../acceptance/lib.mjs')
const c = CASES[Number(process.env.TEACH_CASE)]
const chart = (id, color, x, y, w, h) => ({ id, type: 'chart', color, x, y, w, h, opts: { tf: 'D' } })
const board = (widgets, groups) => ({ charts_workspace_layout: JSON.stringify({ version: 1, cols: 24, widgets }), charts_workspace_groups: JSON.stringify(groups) })
// one chart and one watchlist fill the board: a widget the walkthrough adds goes through the real Place step
const BOARD = board([chart('w-chart-a', 'A', 0, 0, 16, 20), { id: 'w-watch', type: 'watchlist', color: 'A', x: 16, y: 0, w: 8, h: 20, opts: {} }], { A: 'SPY', B: 'AAPL', C: 'AMD', D: 'MSFT' })

// widget data the harness does not serve, so a control that shows only with data can show (one price alert)
const FIXTURES = { routes: [{ match: '^GET /api/watchlist-alerts', body: [{ id: 1, sym: 'NVDA', direction: 'above', price: 150, is_active: true }] }] }
const R = await startRelay({ groupOfAction: () => null })
const rec = { ...c, pass: false, steps: [] }
let p = null
const STATE = `(async () => {
  const G = await import('/src/agent/guide/guideStore.js'); const T = await import('/src/agent/guide/targets.js')
  const st = G.guideState(); if (!st) return null
  const step = st.steps[st.index]; const ring = document.querySelector('[data-testid="guide-ring"]')
  const r = ring && ring.getBoundingClientRect()
  const el = T.findTarget(step.target, st); const b = el && el.getBoundingClientRect()
  const encloses = !!(r && b && b.width > 0 && b.left >= r.left - 3 && b.top >= r.top - 3 && b.right <= r.right + 3 && b.bottom <= r.bottom + 3)
  const text = document.querySelector('[data-testid="guide-text"]')?.textContent || ''
  const next = [...document.querySelectorAll('[data-testid="guide-card"] button')].find(x => /^(Next|Skip|Done)/.test(x.textContent.trim()))
  return { index: st.index, last: st.index === st.steps.length - 1, own: text === step.text, text: text.slice(0, 140), encloses, ring: r && { x: r.left + r.width / 2, y: r.top + r.height / 2 }, next: next ? next.textContent.trim() : null, right: /right-click/i.test(step.text), field: !!el?.matches?.('input,textarea,select'), picker: /one of your own lists|Click a list/i.test(step.text) }
})()`
try {
  p = await open(R, { prefs: BOARD, query: 'layouts=1', fixtures: FIXTURES, width: 1600, height: 950 })
  await p.openPanel()
  await p.say(c.say)
  await p.idle(20000)
  await sleep(800)
  for (let n = 0, waits = 0; n < 14; n++) {
    const s = await p.b.evaluate(STATE)
    if (!s) { rec.why = rec.steps.length ? 'the walkthrough ended before its last step' : `no walkthrough: ${(await p.last()).slice(0, 160)}`; break }
    rec.steps.push({ i: s.index, text: s.text, encloses: s.encloses, own: s.own })
    if (s.last) {
      if (s.encloses && s.own) { rec.pass = true; break }
      if (!s.ring && waits++ < 6) { await sleep(1500); continue }
      rec.why = !s.ring ? 'last step: no ring (its control is not on screen)' : !s.own ? `last step shows its fallback: ${s.text}` : 'last step: the ring is not on the control'
      break
    }
    if (!s.ring) { if (waits++ < 6) { await sleep(1500); continue } rec.why = `step ${s.index + 1}: no ring`; break }
    waits = 0
    if (s.picker) {
      const pt = await p.b.evaluate(`(() => { const c = document.querySelector('[data-widget-type="watchlist"] [data-guide="watchlist.picker"]'); const el = c && [...c.querySelectorAll('button,[role=button],div')].find(e => /Momentum/.test(e.textContent) && e.children.length < 4); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 } })()`)
      if (pt) { await p.b.click(pt.x, pt.y); await sleep(1500); continue }
    }
    if (s.right) {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await p.b.send('Input.dispatchMouseEvent', { type, x: s.ring.x, y: s.ring.y, button: type === 'mouseMoved' ? 'none' : 'right', clickCount: 1 })
    } else if (!s.field) await p.b.click(s.ring.x, s.ring.y)
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
