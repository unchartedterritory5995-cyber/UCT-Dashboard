// NL-1 ACTION SELECTION (nl1/selection.js, owner 2026-10-20): a fixed core + bounded additions, under the
// unchanged 60-action limit. Pure: the real registry's manifest in, the request's actions out — no model, no panel.
//
// Holds it to:
//   • the core is charts + indicators + screener + agent, whole, ≤ 45, built ONLY from actions this member may use;
//   • never more than 60 actions, never a partial group, never an action outside manifestFor(ctx);
//   • pinned groups (a waiting proposal, the last change, a pending question's request) ride along;
//   • the word router only ADDS groups — it never removes the core — and a group that cannot fit is named, not cut;
//   • a reroute either carries every group the model asked for, or reports that it cannot (never a partial one);
//   • deterministic: the same inputs give the same request;
//   • the assembled list matches the eval runner's Python mirror (tests/fixtures/nl1_assemble_parity.json).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { manifestFor } from './capabilities'
import { GROUPS, groupOfAction } from './routing'
import { selectNl1, assembleNl1, coreOf, NL1_CORE_GROUPS, NL1_CORE_MAX, NL1_LIMIT, NL1_BUDGET, NL1_MAX_NEED } from './nl1/selection'

registerBuiltins()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GOLDEN = JSON.parse(fs.readFileSync(path.resolve(HERE, 'contract/manifest.golden.json'), 'utf8')).capabilities
const PARITY = path.resolve(HERE, '../../../tests/fixtures/nl1_assemble_parity.json')

const ADMIN = { surface: 'charts', createIndicator: true, manageIndicators: true }
const full = () => manifestFor(ADMIN)
const names = (m) => m.map(c => c.name)
const groupsIn = (m) => [...new Set(m.map(c => groupOfAction(c.name)))]
const NAMES = { layouts: ['Swing Board', 'Day Trading'], watchlists: ['Momentum', 'Earnings Week'], screens: ['Tight Bases'] }

function invariants(f, s) {
  expect(s.manifest.length).toBeLessThanOrEqual(NL1_LIMIT)
  const avail = new Set(names(f))
  expect(names(s.manifest).every(n => avail.has(n))).toBe(true)
  for (const g of groupsIn(s.manifest)) {                         // whole groups only
    expect(f.filter(c => groupOfAction(c.name) === g).every(c => s.manifest.includes(c))).toBe(true)
  }
  for (const g of s.core) expect(s.selected).toContain(g)          // the core is never removed
  if (s.routing) {
    const core = f.filter(c => s.core.includes(groupOfAction(c.name)))
    expect(names(s.manifest.slice(0, s.routing.stable))).toEqual(names(core))
    expect(s.routing.selected.length + s.unselected.length).toBe(s.routing.groups.length)
  }
}

describe('the core', () => {
  it('is charts, indicators, screener and agent — whole, within 45, from this member\'s available actions', () => {
    const f = full()
    expect(f.length).toBeGreaterThan(NL1_LIMIT)                       // why selection exists
    expect(coreOf(f)).toEqual(NL1_CORE_GROUPS)
    const core = f.filter(c => NL1_CORE_GROUPS.includes(groupOfAction(c.name)))
    expect(core.length).toBeLessThanOrEqual(NL1_CORE_MAX)
    expect(core.length).toBe(42)                                      // charts 21 + indicators 12 (P1: + discardDraft) + screener 8 + agent 1
    const s = selectNl1(f, { text: 'hello' })
    expect(s.core).toEqual(NL1_CORE_GROUPS)
    invariants(f, s)
  })

  it('never adds an action the member cannot use: without indicator management or creation, those actions are absent', () => {
    for (const ctx of [{ surface: 'charts', createIndicator: false, manageIndicators: false }, { surface: 'charts', createIndicator: false, manageIndicators: true }]) {
      const f = manifestFor(ctx)
      const s = selectNl1(f, { text: 'add rsi' })
      const avail = new Set(names(f))
      expect(names(s.manifest).every(n => avail.has(n))).toBe(true)
      expect(names(s.manifest).filter(n => !avail.has(n))).toEqual([])
      if (!ctx.createIndicator) expect(names(s.manifest)).not.toContain('indicator.draft')
      invariants(f, s)
    }
  })

  it('off the Charts surface the available catalog fits one request: it is sent whole, unrouted', () => {
    const f = manifestFor({ surface: 'dashboard' })
    expect(f.length).toBeLessThanOrEqual(NL1_BUDGET)
    const s = selectNl1(f, { text: 'add AMD to momentum' })
    expect(s.routing).toBe(null)
    expect(names(s.manifest)).toEqual(names(f))
  })

  it('a core group over the 45 budget is left out of the core (named like any other group), never cut', () => {
    const f = full()
    const fat = [...f, ...Array.from({ length: 10 }, (_, i) => ({ ...f.find(c => c.name.startsWith('screener.')), name: `screener.fake${i}` }))]
    const core = coreOf(fat)                                          // charts 21 + indicators 11 + screener 18 = 50 > 45
    expect(core).toEqual(['charts', 'indicators', 'agent'])
    const s = selectNl1(fat, { text: 'hello' })
    invariants(fat, s)
  })
})

describe('soft expansion, pins and limits', () => {
  it('the member\'s words and own names ADD groups; the core stays whatever they say', () => {
    const f = full()
    const s = selectNl1(f, { text: 'put the first 3 in momentum', names: NAMES })
    expect(s.selected).toContain('lists')
    invariants(f, s)
    const crowd = selectNl1(f, { text: 'open swing board, add a widget, set an alert, change settings, draw a level and add NVDA to my watchlist', names: NAMES })
    for (const g of NL1_CORE_GROUPS) expect(crowd.selected).toContain(g)
    expect(crowd.unselected.length).toBeGreaterThan(0)               // what did not fit is NAMED
    expect(crowd.wordsNotSent.length).toBeGreaterThan(0)              // …and reported (useAgent proposes instead of running)
    invariants(f, crowd)
  })

  it('nothing recognised still fills the room with whole groups (smallest first), every other group named', () => {
    const f = full()
    const s = selectNl1(f, { text: 'hmm' })
    expect(s.manifest.length).toBeGreaterThan(41)
    expect(s.wordsNotSent).toEqual([])
    invariants(f, s)
  })

  it('pins: a waiting proposal\'s, the last change\'s and a pending question\'s groups ride along with any words', () => {
    const f = full()
    const plain = selectNl1(f, { text: 'only the first one' })
    expect(plain.selected).not.toContain('workspace')
    const proposal = selectNl1(f, { text: 'only the first one', pinActions: ['widget.add'] })
    expect(proposal.selected).toContain('workspace')
    expect(proposal.pins).toEqual(['workspace'])
    const question = selectNl1(f, { text: 'the second', pinGroups: ['layouts'] })
    expect(question.selected).toContain('layouts')
    // a pin outside this member's available actions is ignored, never added
    const odd = selectNl1(manifestFor({ surface: 'dashboard' }), { text: 'x', pinActions: ['chart.setTimeframe'] })
    expect(odd.pins).toEqual([])
  })

  it('a reroute carries every group the model asked for — or says it cannot; never part of them', () => {
    const f = full()
    const one = selectNl1(f, { text: 'hmm', need: ['workspace'] })
    expect(one.needMet).toBe(true)
    expect(one.selected).toContain('workspace')
    invariants(f, one)
    const three = selectNl1(f, { text: 'hmm', need: ['workspace', 'layouts', 'lists'] })     // 41 + 12 + 9 + 9 > 55
    expect(three.needMet).toBe(false)
    invariants(f, three)
    expect(NL1_MAX_NEED).toBe(3)
    // a group id that does not exist (or is not available) is never "needed"
    expect(selectNl1(f, { text: 'hmm', need: ['nope'] }).need).toEqual([])
  })

  it('is deterministic', () => {
    const f = full()
    const a = selectNl1(f, { text: 'add AMD to momentum and open swing board', names: NAMES, pinActions: ['alert.create'] })
    const b = selectNl1(f, { text: 'add AMD to momentum and open swing board', names: NAMES, pinActions: ['alert.create'] })
    expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest))
    expect(a.routing).toEqual(b.routing)
  })

  it('the shipped budget is the contract\'s routed budget (55) under the unchanged 60-action limit', () => {
    expect(NL1_LIMIT).toBe(60)
    expect(NL1_BUDGET).toBe(55)
    expect(NL1_CORE_MAX).toBe(45)
  })
})

describe('the eval runner assembles exactly what the browser does (Python mirror)', () => {
  const core = coreOf(GOLDEN)
  const present = GROUPS.filter(g => GOLDEN.some(c => groupOfAction(c.name) === g.id)).map(g => ({ id: g.id, title: g.title }))
  const cases = [
    core,
    [...core, 'layouts'],
    [...core, 'lists', 'alerts'],
    [...core, 'workspace', 'drawings'],
    ['agent', 'charts', 'data'],
    present.map(g => g.id),
  ].map(selected => {
    const { manifest, routing } = assembleNl1(GOLDEN, core, selected)
    return { selected, names: names(manifest), routing }
  })
  const fixture = {
    about: 'nl1/selection.js assembleNl1 on manifest.golden.json — tools/agent_eval_run.py assemble_nl1 must produce the same (tests/test_agent_eval_run.py). Regenerate: UPDATE_NL1_PARITY=1 npx vitest run src/agent/agentNl1Selection.test.js',
    core,
    groupOf: Object.fromEntries(GOLDEN.map(c => [c.name, groupOfAction(c.name)])),
    groups: present,
    cases,
  }

  it('matches the committed parity fixture', () => {
    const env = globalThis.process?.env || {}
    if (env.UPDATE_NL1_PARITY === '1') fs.writeFileSync(PARITY, JSON.stringify(fixture, null, 1) + '\n')
    expect(JSON.parse(fs.readFileSync(PARITY, 'utf8'))).toEqual(fixture)
  })
})
