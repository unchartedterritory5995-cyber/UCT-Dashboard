// NL-1 ACTION SELECTION on the DEV and EXPOSED evaluation sets — free, local, no model call.
//
// Every turn is captured exactly as the eval capture (testing/capture.js → buildNl1Request) builds it, and
//   • the selection's invariants are held on EVERY request: at most 60 actions, the core whole and first
//     (`routing.stable`), whole groups only, nothing outside this member's available actions, and every
//     reroute either carries the groups it was asked for or is refused (never a partial one);
//   • FIRST-CALL COVERAGE is measured: the expected plan's actions are all in the request's actions
//     (any accepted alternative plan counts), and how many of the rest a reroute could still supply.
// ⛔ The SEALED sets are never opened here (filtered by split before any file is read).
import { it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { SETS } from './testing/sets'
import { captureCase } from './testing/capture'
import { isProtected } from './protectedLayouts'
import { groupOfAction } from './routing'
import { NL1_CORE_GROUPS, NL1_CORE_MAX, NL1_LIMIT, NL1_BUDGET } from './nl1/selection'
import { loadMeta, loadOptions, loadSaved, _resetScreenerCache } from './capabilities/screener'

registerBuiltins()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(HERE, '__fixtures__/nlIntent')
const OPEN = SETS.filter(s => s.split !== 'sealed')

beforeAll(async () => {
  const scr = JSON.parse(fs.readFileSync(path.join(DIR, 'screener-catalog.json'), 'utf8'))
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') return json({ fields: scr.fields })
    if (url === '/api/screener/fields?options=1') return json({ options: scr.options })
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: scr.starters })
    return json({})
  })
  _resetScreenerCache()
  await loadMeta(); await loadOptions(); await loadSaved({ force: true })
})

function capture(budget) {
  const spec = JSON.parse(fs.readFileSync(path.join(DIR, 'corpus.json'), 'utf8'))
  const catalogs = new Map()
  const rows = []
  for (const s of OPEN) {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, s.file), 'utf8'))
    const expects = new Map()
    for (const c of data.cases) {
      if (Array.isArray(c.turns)) c.turns.forEach((t, i) => expects.set(`${c.id}#${i}`, t.expect))
      else expects.set(`${c.id}#0`, c.expect)
    }
    for (const c of data.cases) {
      for (const t of captureCase(spec, c, 'nl1', { isProtectedLayout: (e) => isProtected(e), catalogs, budget })) {
        rows.push({ ...t, set: s.file, expect: expects.get(`${c.id}#${t.turn}`) })
      }
    }
  }
  return { rows, catalogs }
}

const plansOf = (e) => [e?.ops, ...(e?.alt || [])].filter(p => Array.isArray(p) && p.length)

function measure({ rows, catalogs }) {
  const bySet = {}
  for (const r of rows) {
    if (r.exact) continue
    const plans = plansOf(r.expect)
    if (!plans.length) continue
    const sent = new Set(r.body.capabilities.map(c => c.name))
    const b = (bySet[r.set] ||= { n: 0, first: 0, reroute: 0, lost: 0, sent: [] })
    b.n++
    b.sent.push(sent.size)
    if (plans.some(p => p.every(o => sent.has(o.a)))) { b.first++; continue }
    // the groups the model would have to ask for, for the closest accepted plan
    const full = new Set(catalogs.get(r.catalog).manifest.map(c => c.name))
    const reachable = plans.filter(p => p.every(o => full.has(o.a))).some(p => {
      const need = [...new Set(p.map(o => groupOfAction(o.a)))].filter(g => !r.selection.selected.includes(g)).sort()
      return need.length && r.reroutes[need.join('+')] != null
    })
    if (reachable) b.reroute++
    else b.lost++
  }
  return bySet
}

const fmt = (bySet) => Object.entries(bySet).map(([f, b]) => {
  const s = [...b.sent].sort((x, y) => x - y)
  const pct = (x) => `${((100 * x) / b.n).toFixed(1)}%`
  return `  ${f.padEnd(16)} n ${String(b.n).padStart(3)}  first call ${String(b.first).padStart(3)} (${pct(b.first)})  +reroute ${String(b.reroute).padStart(2)} (→ ${pct(b.first + b.reroute)})  not reachable ${b.lost}  actions median ${s[s.length >> 1]} max ${s[s.length - 1]}`
}).join('\n')

it('holds the selection invariants on every dev / exposed request, and reports first-call coverage', () => {
  const cap = capture(undefined)
  const { rows, catalogs } = cap
  expect(rows.length).toBeGreaterThan(300)
  for (const r of rows) {
    const full = catalogs.get(r.catalog)
    expect(full, r.key).toBeTruthy()
    const names = r.body.capabilities.map(c => c.name)
    const avail = new Set(full.manifest.map(c => c.name))
    expect(names.length, r.key).toBeLessThanOrEqual(NL1_LIMIT)
    expect(names.every(n => avail.has(n)), r.key).toBe(true)                          // nothing unavailable
    expect(new Set(names).size, r.key).toBe(names.length)
    const group = (n) => full.groupOf[n]
    const core = full.manifest.filter(c => r.selection.core.includes(group(c.name))).map(c => c.name)
    expect(core.length, r.key).toBeLessThanOrEqual(NL1_CORE_MAX)
    expect(r.selection.core.every(g => NL1_CORE_GROUPS.includes(g)), r.key).toBe(true)
    if (r.body.routing) {
      expect(names.slice(0, r.body.routing.stable), r.key).toEqual(core)               // the core, whole, first
      for (const g of r.body.routing.selected) {                                        // whole groups only
        expect(full.manifest.filter(c => group(c.name) === g).every(c => names.includes(c.name)), `${r.key} ${g}`).toBe(true)
      }
      expect(names.every(n => r.body.routing.selected.includes(group(n))), r.key).toBe(true)
    } else {
      expect(names, r.key).toEqual(full.manifest.map(c => c.name))                     // unrouted = the whole catalog
    }
    for (const [key, rr] of Object.entries(r.reroutes)) {                               // a reroute: all it asked, or refused
      if (rr) expect(key.split('+').every(g => rr.selected.includes(g)), `${r.key} ${key}`).toBe(true)
    }
  }
  const at55 = measure(cap)
  const at60 = measure(capture(NL1_LIMIT))
  console.log(`\nNL-1 selection coverage (dev / exposed only; budget ${NL1_BUDGET} shipped, ${NL1_LIMIT} for comparison)\n` +
    `budget ${NL1_BUDGET}:\n${fmt(at55)}\nbudget ${NL1_LIMIT}:\n${fmt(at60)}\n`)
  // regression floors (measured 2026-10-20: 97.5–100% first call, 100% with one reroute, on these sets)
  for (const [f, b] of Object.entries(at55)) {
    expect(b.lost, `${f}: a request whose actions no reroute can supply`).toBe(0)
    expect(b.first / b.n, `${f}: first-call coverage`).toBeGreaterThanOrEqual(0.95)
  }
}, 300000)
