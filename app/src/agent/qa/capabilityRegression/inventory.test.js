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
import { contractOf, coverage, canonicalOps, knownGaps } from './testing/inventory'
import { coverageJson, coverageMd } from './testing/report'
import { corpus, golden } from './testing/corpus'
import backlog from './data/regressionEntries.json'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const ROOT = path.resolve(HERE, '..', '..', '..', '..', '..')
const DECISIONS = path.join(ROOT, 'docs', 'agent', 'COMPATIBILITY-DECISIONS.md')
const decided = (key) => { try { return fs.readFileSync(DECISIONS, 'utf8').split(/\r?\n/).some(l => l.trim() === `### ${key}` || l.trim().startsWith(`### ${key} `)) } catch { return false } }
const UPDATE = process.env.UPDATE_CAPREG === '1'
const write = (f, s) => fs.writeFileSync(path.join(HERE, f), s.replace(/\r\n/g, '\n'))
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'))

const catalog = await registerCatalog(ALL_KINDS)
// production's server-gated set (agentProdKinds.test.js GATED_EXPECTED) — for the report only
const PROD_GATED = new Set(['chart.describeSetup', 'stock.dailyBars', 'stock.quote', 'stock.themes'])
catalog.prod = catalog.all.filter(n => catalog.ungated.includes(n) || PROD_GATED.has(n))
const contract = contractOf(catalog.all)
const exercised = new Set([...corpus.intents.flatMap(i => [...i.capabilities, ...i.needs]), ...corpus.refusals.flatMap(r => r.capabilities),
  ...golden.workflows.flatMap(w => w.capabilities)])

describe('1 · a new capability ships with a regression entry', () => {
  it('every registered capability is exercised by the corpus / golden workflows, or listed in the backlog with an owner', () => {
    const missing = catalog.all.filter(n => !exercised.has(n) && !backlog.entries[n])
    expect(missing, `capabilities with NO regression entry — add a corpus intent (data/corpus.json) or a golden workflow, or (with a decision "### BACKLOG:<name>" in docs/agent/COMPATIBILITY-DECISIONS.md) a backlog entry: ${missing.join(', ')}`).toEqual([])
  })
  it('every backlog entry names an owner, and one added after the initial inventory has a recorded decision', () => {
    for (const [n, e] of Object.entries(backlog.entries)) {
      expect(e.owner, n).toBeTruthy()
      if (e.since !== backlog.initial) expect(decided(`BACKLOG:${n}`), `backlog entry ${n} (since ${e.since}) needs "### BACKLOG:${n}" in COMPATIBILITY-DECISIONS.md`).toBe(true)
    }
  })
  it('the backlog lists only registered, not-yet-exercised capabilities (a covered one leaves the backlog)', () => {
    for (const n of Object.keys(backlog.entries)) {
      expect(catalog.all, `backlog entry ${n} is not a registered capability`).toContain(n)
      expect(exercised.has(n), `${n} is exercised now — remove it from data/regressionEntries.json`).toBe(false)
    }
  })
})

describe('2 · the approval / undo contract is never weakened silently', () => {
  it('no capability removed or weakened without a "### CAP:<name>" decision', () => {
    const pinned = readJson('coverage/contract.json').capabilities
    const weakenings = []
    for (const [n, was] of Object.entries(pinned)) {
      const now = contract[n]
      if (!now) { weakenings.push([n, 'removed']); continue }
      if (was.risk === 'confirm' && now.risk !== 'confirm') weakenings.push([n, `risk ${was.risk} → ${now.risk}`])
      if (was.undo === 'exact' && now.undo !== 'exact') weakenings.push([n, `undo ${was.undo} → ${now.undo}`])
      if (was.reversible === false && now.reversible !== false) weakenings.push([n, 'irreversible → reversible (it would auto-apply)'])
      if (was.query && !now.query) weakenings.push([n, 'a read became a change'])
    }
    expect(weakenings.filter(([n]) => !decided(`CAP:${n}`)).map(([n, w]) => `${n}: ${w}`)).toEqual([])
  })
  it('the pinned contract covers every registered capability (UPDATE_CAPREG=1 pins a new one)', () => {
    if (UPDATE) {
      const pinned = (() => { try { return readJson('coverage/contract.json').capabilities } catch { return {} } })()
      // a pinned entry is only ever REPLACED by the live one; a removed capability stays pinned until its decision exists
      const merged = { ...Object.fromEntries(Object.entries(pinned).filter(([n]) => !contract[n] && !decided(`CAP:${n}`))), ...contract }
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
