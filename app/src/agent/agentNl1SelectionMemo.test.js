// NL-1 SELECTION, MEMOISED WORD READING (2026-11-23) — the memo changes nothing a request sends.
//
// buildNl1Request reads a request's words ONCE (nl1/selection.js nl1WordsReader) for its first call and every reroute, and
// selectNl1 hands that reading to routeManifest (`groups`) instead of it being read again. That made each selection ~2x
// cheaper (agentNl1SelectionCoverage.test.js runs ~740k of them). This file holds it to BYTE-IDENTICAL output on every
// dev / exposed turn: the request's first-call selection and its reroutes (every single unselected group, and the groups an
// accepted plan asks for), at the shipped budget (with and without a pinned proposal) and the per-request limit, each equal
// to a FRESH selection that reads the words itself — and routeManifest equal with or without `groups`.
// ⛔ The SEALED sets are never opened here (filtered by split before any file is read); failures name case ids only.
import { it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { SETS, turnsOf } from './testing/sets'
import { hostFor } from './testing/fixtureHost'
import { CAP_CTX } from './testing/capture'
import { manifestFor } from './capabilities'
import { routeManifest, routingNames, selectGroups } from './routing'
import { correctTypos, lexiconFor } from './nl/lexicon'
import { buildNl1Request } from './nl1/interpreter'
import { selectNl1, nl1WordsReader, nl1GroupOf, NL1_LIMIT, NL1_BUDGET } from './nl1/selection'
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

const managesIndicators = (host) => { try { return host.charts.list().some(c => host.charts.canManageIndicators?.(c.ref) === true) } catch { return false } }
const plansOf = (e) => [e?.ops, ...(e?.alt || [])].filter(p => Array.isArray(p) && p.length)

// every open turn with the member's previous message, as captureCase passes it
function* openTurns() {
  const spec = JSON.parse(fs.readFileSync(path.join(DIR, 'corpus.json'), 'utf8'))
  for (const s of OPEN) {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, s.file), 'utf8'))
    for (const c of data.cases) {
      for (const t of turnsOf(c)) {
        const history = t.pending ? [...t.hist, { role: 'member', text: t.pending.request }] : t.hist
        const said = Array.isArray(c.turns) ? history.filter(h => h.role === 'member').map(h => h.text)
          : [...(c.hist || []).filter((_, i) => i % 2 === 0), ...(t.pending ? [t.pending.request] : [])]
        const { host } = hostFor(spec, c.fx, { state: t.state, libExtra: c.libExtra })
        yield { set: s.file, key: t.key, host, text: t.say, prevText: said[said.length - 1] || '', expect: t.expect }
      }
    }
  }
}

it('a memoised selection (first call and every reroute) is byte-identical to a fresh one on every dev / exposed turn', () => {
  let turns = 0, compared = 0
  const sets = new Set()
  for (const tu of openTurns()) {
    turns++
    sets.add(tu.set)
    const manageIndicators = managesIndicators(tu.host)
    const pinOps = (plansOf(tu.expect)[0] || []).map(o => ({ action: o.a, args: {}, target: null }))
    // the shipped budget with and without a pinned proposal; the per-request limit without
    for (const budget of [undefined, NL1_LIMIT]) {
      for (const pendingProposal of pinOps.length && budget === undefined ? [null, { ops: pinOps }] : [null]) {
        const req = buildNl1Request({ host: tu.host, text: tu.text, capCtx: CAP_CTX, manageIndicators, pendingProposal, budget, prevText: tu.prevText })
        // a FRESH selection: the same inputs buildNl1Request passes and its own typo readings (cached per text, as
        // buildNl1Request has always cached them), but NO word memo: selectNl1 reads the words itself, every time
        const readings = new Map()
        const names = routingNames(tu.host)
        const correct = (t) => {
          if (!readings.has(t)) readings.set(t, (correctTypos(t, lexiconFor(tu.host)) || []).map(v => v.text))
          return readings.get(t)
        }
        const fresh = (need) => selectNl1(req.full, {
          text: tu.text, budget, prevText: tu.prevText, names, correct,
          pinActions: (pendingProposal?.ops || []).map(o => o.action), pinGroups: [], need,
        })
        expect(JSON.stringify(req.selection), tu.key).toBe(JSON.stringify(fresh([])))
        const s = req.selection
        // every single unselected group on the plain request; the plans' needs on all three (the memo is per request, so a
        // reroute's need cannot change what it reads — the plain sweep exercises every group, the others their pins / budget)
        const needs = budget === undefined && !pendingProposal ? s.unselected.map(g => [g]) : []
        for (const p of plansOf(tu.expect)) {
          const need = [...new Set(p.map(o => nl1GroupOf(o.a)))].filter(g => s.unselected.includes(g)).sort()
          if (need.length) needs.push(need)
        }
        for (const need of needs) {
          expect(JSON.stringify(req.reselect(need)), `${tu.key} ${need.join('+')}`).toBe(JSON.stringify(fresh(need)))
          compared++
        }
      }
    }
  }
  expect([...sets].sort()).toEqual(OPEN.map(s => s.file).sort())
  expect(turns).toBeGreaterThan(600)
  console.log(`memo equivalence: ${turns} turns, ${compared} reroutes compared`)
  expect(compared).toBeGreaterThan(5000)
}, 120000)

it('routeManifest with the caller\'s word reading (`groups`) routes exactly as when it reads the words itself', () => {
  let n = 0
  for (const tu of openTurns()) {
    const full = manifestFor({ ...CAP_CTX, manageIndicators: managesIndicators(tu.host) })
    const names = routingNames(tu.host)
    const correct = (t) => (correctTypos(t, lexiconFor(tu.host)) || []).map(v => v.text)
    const opts = { enabled: true, limit: NL1_LIMIT, budget: NL1_BUDGET, names, correct, groupOf: nl1GroupOf }
    const words = nl1WordsReader({ names, correct })(tu.text)
    expect(JSON.stringify(routeManifest(full, tu.text, { ...opts, groups: words }, ['charts'])), tu.key)
      .toBe(JSON.stringify(routeManifest(full, tu.text, opts, ['charts'])))
    expect(JSON.stringify(words), tu.key).toBe(JSON.stringify(selectGroups(tu.text, { names, correct })))
    n++
  }
  expect(n).toBeGreaterThan(600)
}, 120000)

it('a shared word reading is frozen and read once per text', () => {
  let calls = 0
  const correct = () => { calls++; return [] }
  const read = nl1WordsReader({ names: null, correct })
  const a = read('add the 20 ema'), b = read('add the 20 ema')
  expect(a).toBe(b)
  expect(calls).toBe(1)
  expect(Object.isFrozen(a) && Object.isFrozen(a.selected) && Object.isFrozen(a.priority) && Object.isFrozen(a.soft)).toBe(true)
  expect(() => { a.selected.push('x') }).toThrow()
})
