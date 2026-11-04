// CAPABILITY REGRESSION · the INVENTORY rails (Mission 2):
//   1. a NEW capability cannot ship without a regression entry (a corpus intent / golden workflow, or an explicit
//      backlog entry with an owner — and a backlog entry added after the initial inventory needs a recorded decision);
//   2. a capability's APPROVAL / UNDO contract cannot be weakened, nor a capability removed, silently (contract.json:
//      risk confirm → local, undo exact → none, irreversible → reversible, query → change, removal ⇒ `### CAP:<name>`);
//   3. every canonical op in the corpus and the golden workflows passes the registry's own shape check (arg validity);
//   4. the generated coverage report is current (UPDATE_CAPREG=1 regenerates it);
//   5. this suite's production kinds equal the production-kinds pin.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { registerCatalog, PROD_KINDS, ALL_KINDS } from './testing/registry'
import { shapeError, getCapability } from '../../capabilities'
import { contractOf, coverage, canonicalOps, knownGaps, exercisedBy } from './testing/inventory'
import { coverageJson, coverageMd } from './testing/report'
import { corpus, golden } from './testing/corpus'
import backlog from './baseline/regressionEntries.json'
import { parseDecisions, decidedFor, digest } from './testing/decisions'
import { pinClock, CLOCK, CLOCKS } from './testing/clock'
import clockExpectations from './baseline/clockExpectations.json'

pinClock()                   // one fixed instant (testing/clock.js): the market clock never depends on when CI runs

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const ROOT = path.resolve(HERE, '..', '..', '..', '..', '..')
const DECISIONS = path.join(ROOT, 'docs', 'agent', 'COMPATIBILITY-DECISIONS.md')
const DECIDED = (() => { try { return parseDecisions(fs.readFileSync(DECISIONS, 'utf8')) } catch { return {} } })()
// CAP: the pinned contract entry -> the live one (or removed); BACKLOG: nothing -> the backlog entry
const capBinds = (was, now) => `${digest(was)}->${now ? digest(now) : 'removed'}`
const backlogBinds = (entry) => `${'0'.repeat(16)}->${digest(entry)}`
const UPDATE = process.env.UPDATE_CAPREG === '1'
const write = (f, s) => fs.writeFileSync(path.join(HERE, f), s.replace(/\r\n/g, '\n'))
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'))

const catalog = await registerCatalog(ALL_KINDS)
// production's server-gated set (agentProdKinds.test.js GATED_EXPECTED) — for the report only
const PROD_GATED = new Set(['chart.describeSetup', 'stock.dailyBars', 'stock.quote', 'stock.themes'])
catalog.prod = catalog.all.filter(n => catalog.ungated.includes(n) || PROD_GATED.has(n))
const contract = contractOf(catalog.all)
const ENTRIES = [...corpus.intents, ...corpus.refusals, ...golden.workflows]
// review #769 nit 2: a capability counts as exercised only when an assertion actually runs it (testing/inventory.exercisedBy)
const exercised = new Set(ENTRIES.flatMap(e => [...exercisedBy(e)]))

describe('1 · a new capability ships with a regression entry', () => {
  it('every registered capability is exercised by the corpus / golden workflows, or listed in the backlog with an owner', () => {
    const missing = catalog.all.filter(n => !exercised.has(n) && !backlog.entries[n])
    expect(missing, `capabilities with NO regression entry — add a corpus intent (baseline/corpus.json) or a golden workflow, or (with a decision "### BACKLOG:<name>" in docs/agent/COMPATIBILITY-DECISIONS.md) a backlog entry: ${missing.join(', ')}`).toEqual([])
  })
  it.each(ENTRIES.map(e => [e.id, e]))('%s: every capability it LISTS is actually exercised by its assertions', (_id, e) => {
    expect(e.capabilities.filter(n => !exercisedBy(e).has(n)), `${e.id} lists capabilities no assertion of it runs`).toEqual([])
  })
  it('every backlog entry names an owner, and one added after the initial inventory has a recorded decision', () => {
    for (const [n, e] of Object.entries(backlog.entries)) {
      expect(e.owner, n).toBeTruthy()
      if (e.since !== backlog.initial) expect(decidedFor(DECIDED, `BACKLOG:${n}`, backlogBinds(e)), `backlog entry ${n} (since ${e.since}) needs "### BACKLOG:${n}" with Date, Decided by and "- Binds: ${backlogBinds(e)}" in COMPATIBILITY-DECISIONS.md`).toBe(true)
    }
  })
  it('the backlog lists only registered, not-yet-exercised capabilities (a covered one leaves the backlog)', () => {
    for (const n of Object.keys(backlog.entries)) {
      expect(catalog.all, `backlog entry ${n} is not a registered capability`).toContain(n)
      expect(exercised.has(n), `${n} is exercised now — remove it from baseline/regressionEntries.json`).toBe(false)
    }
  })
})

describe('2 · the approval / undo contract is never weakened silently', () => {
  it('no capability removed or weakened without a "### CAP:<name>" decision', () => {
    const pinned = readJson('coverage/contract.json').capabilities
    const weakenings = []
    for (const [n, was] of Object.entries(pinned)) {
      const now = contract[n]
      if (!now) { weakenings.push([n, 'removed', capBinds(was, null)]); continue }
      if (was.risk === 'confirm' && now.risk !== 'confirm') weakenings.push([n, `risk ${was.risk} → ${now.risk}`, capBinds(was, now)])
      if (was.undo === 'exact' && now.undo !== 'exact') weakenings.push([n, `undo ${was.undo} → ${now.undo}`, capBinds(was, now)])
      if (was.reversible === false && now.reversible !== false) weakenings.push([n, 'irreversible → reversible (it would auto-apply)', capBinds(was, now)])
      if (was.query && !now.query) weakenings.push([n, 'a read became a change', capBinds(was, now)])
    }
    expect(weakenings.filter(([n, , b]) => !decidedFor(DECIDED, `CAP:${n}`, b)).map(([n, w, b]) => `${n}: ${w} — needs "### CAP:${n}" with Date, Decided by and "- Binds: ${b}"`)).toEqual([])
  })
  it('the pinned contract covers every registered capability (UPDATE_CAPREG=1 pins a new one)', () => {
    if (UPDATE) {
      const pinned = (() => { try { return readJson('coverage/contract.json').capabilities } catch { return {} } })()
      // a pinned entry is only ever REPLACED by the live one; a removed capability stays pinned until its decision exists
      const merged = { ...Object.fromEntries(Object.entries(pinned).filter(([n, was]) => !contract[n] && !decidedFor(DECIDED, `CAP:${n}`, capBinds(was, null)))), ...contract }
      write('coverage/contract.json', JSON.stringify({ about: 'Pinned approval / undo contract per capability (capreg inventory.test.js rail 2). UPDATE_CAPREG=1 re-pins; a weakening still needs a decision.', capabilities: merged }, null, 1) + '\n')
    }
    const now = readJson('coverage/contract.json').capabilities
    expect(catalog.all.filter(n => !now[n])).toEqual([])
  })
})

describe('3 · arg validity: every canonical op passes the registry shape check', () => {
  it.each(canonicalOps().map(x => [`${x.where} · ${x.op.action}`, x.op]))('%s', (_w, op) => {
    expect(shapeError(op.action, op.args)).toBeNull()
  })
})

describe('4 · the coverage report is current', () => {
  it('coverage/coverage.json + coverage/COVERAGE.md equal what the registry and the data generate (UPDATE_CAPREG=1)', () => {
    const j = coverageJson(coverage(catalog.all, contract), contract, catalog)
    if (UPDATE) { write('coverage/coverage.json', JSON.stringify(j, null, 1) + '\n'); write('coverage/COVERAGE.md', coverageMd(j)) }
    expect(readJson('coverage/coverage.json')).toEqual(JSON.parse(JSON.stringify(j)))
    expect(fs.readFileSync(path.join(HERE, 'coverage/COVERAGE.md'), 'utf8').replace(/\r\n/g, '\n')).toBe(coverageMd(j))
  })
  it('every known gap carries id, reason and owner', () => {
    for (const g of knownGaps()) for (const k of ['id', 'reason', 'owner']) expect(g[k], JSON.stringify(g)).toBeTruthy()
  })
})

describe('5 · configuration pins', () => {
  it('PROD_KINDS equals agentProdKinds.test.js (production data kinds)', () => {
    const src = fs.readFileSync(path.join(HERE, '..', '..', 'agentProdKinds.test.js'), 'utf8')
    const m = /export const PROD_KINDS = \[([^\]]+)\]/.exec(src)
    expect(m).not.toBeNull()
    expect(m[1].match(/'[^']+'/g).map(s => s.slice(1, -1))).toEqual(PROD_KINDS)
  })
  it('the whole catalog registers every server-gated capability family (a dark capability is inventoried the day it ships)', () => {
    for (const n of ['chart.describeSetup', 'research.ask', 'history.afterEvent', 'playbook.explain']) expect(catalog.all, n).toContain(n)
  })
})

describe('6 · capability descriptions never name an action that does not exist (stale descriptions)', () => {
  // the planner reads summaries and hints as instructions: "use widget.addCharts", "chart.replay for …" — a renamed or
  // removed action left in another capability's text sends the model to a capability it cannot have
  const domains = new Set(catalog.all.map(n => n.split('.')[0]))
  const verbs = new Set(catalog.all.map(n => n.split('.')[1].split(/(?=[A-Z])/)[0]))
  it.each(catalog.all.map(n => [n]))('%s', (n) => {
    const c = getCapability(n)
    const text = `${c.summary || ''} ${c.hints || ''} ${c.shape || ''}`
    // an action-shaped token: a known domain + a verb that registered actions use (setting keys such as
    // "volume.barStyle" are nouns and are not read as actions)
    const named = [...text.matchAll(/\b([a-z][A-Za-z]*)\.([a-z][A-Za-z]+)\b/g)]
      .filter(m => domains.has(m[1]) && verbs.has(m[2].split(/(?=[A-Z])/)[0])).map(m => `${m[1]}.${m[2]}`)
    expect(named.filter(a => !catalog.all.includes(a)), `${n} names actions that are not registered`).toEqual([])
  })
})

describe('7 · decisions bind one change (review #769): fenced examples, missing fields and other bindings never count', () => {
  const b = `${'1'.repeat(16)}->removed`
  const ok = `### CAP:x.y — retired\n- Date: 2026-11-04\n- Decided by: the owner\n- Binds: ${b}\n`
  it('a complete decision counts', () => { expect(decidedFor(parseDecisions(ok), 'CAP:x.y', b)).toBe(true) })
  it.each([
    ['fenced', '```\n' + ok + '```\n'],
    ['no decider', ok.replace('- Decided by: the owner\n', '')],
    ['a placeholder decider', ok.replace('the owner', '<the owner>')],
    ['no date', ok.replace('- Date: 2026-11-04\n', '')],
    ['bound to another change', ok.replace(b, `${'2'.repeat(16)}->removed`)],
  ])('%s does not count', (_w, text) => { expect(decidedFor(parseDecisions(text), 'CAP:x.y', b)).toBe(false) })
})

describe('8 · the suite never reads the wall clock (2026-11-04: the gate went red at the 09:30 ET open)', () => {
  it('every capreg test file pins Date (testing/clock.js pinClock)', () => {
    const files = fs.readdirSync(HERE).filter(f => /\.test\.jsx?$/.test(f))
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) expect(fs.readFileSync(path.join(HERE, f), 'utf8'), `${f} calls pinClock()`).toMatch(/\npinClock\(\)/)
  })
  it('Date is the pinned instant here (it advances from it, never from the wall clock)', () => {
    expect(Math.abs(Date.now() - Date.parse(CLOCKS[CLOCK]))).toBeLessThan(30 * 60 * 1000)
  })
  it('a clock-specific expectation names a known instant and an intent that exists', () => {
    for (const [id, by] of Object.entries(clockExpectations.intents)) {
      expect(corpus.intents.map(i => i.id), id).toContain(id)
      for (const [clk, e] of Object.entries(by)) { expect(Object.keys(CLOCKS), `${id}@${clk}`).toContain(clk); expect(e.why, `${id}@${clk} says why`).toBeTruthy() }
    }
  })
})
