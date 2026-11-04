// Track D workflow "themeRotation" — `stock.themeRotation` (DARK, UCT_AGENT_WORKFLOWS). The cross-period logic over
// SYNTHETIC theme envelopes: re-ranking (never the adapter's order), ties sharing a rank (incl. at the top-10 boundary),
// themes missing from a period ("outside the top 30", never a rank), an unread period, duplicates; the card; the REAL
// panel (3 themes reads), dark by default, a later config switching it off, isolation. No real market value anywhere.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handshake from './__fixtures__/program/isolation.json'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, ONE } from './testing/panelHarness'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { allCapabilityNames, getCapability } from './capabilities'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { groupOfAction, wordsSelect } from './routing'
import { _resetTurns } from './trace'
import {
  ranksOf, rotationOf, answerFromRotation, match, themeRotationServed, registerThemeRotationCapability, _resetThemeRotationForTest, CAPABILITY, LIMIT,
} from './capabilities/themeRotation'
import { DESCRIPTIVE } from './capabilities/workflowGate'

registerBuiltins()

const AS_OF = '2026-11-03T21:00:00Z'      // Tue, Nov 3 close (synthetic)
// returns per theme (synthetic), keyed by a made-up ticker; a missing key = outside that period's top 30
const T = (name, ticker, ret) => ({ name, ticker, sector: null, return_pct: ret, holdings: 10 })
function themesEnv(period, rows, o = {}) {
  return { contract: 'MD-1.0', kind: 'themes', params_echo: { period }, status: 'ok', freshness: 'periodic', as_of: AS_OF, fetched_at: AS_OF, stale: false,
    source: 'uct-themes', coverage: null, provider_calls: 0, notes: ['a note that must never be echoed'],
    data: { period, order: 'leaders', themes: rows, live_applied_at: null }, ...o }
}
const names = Array.from({ length: 14 }, (_, i) => `Theme ${String.fromCharCode(65 + i)}`)        // Theme A … Theme N
const tk = (n) => `TH${n.slice(-1)}`
// 1w: A..N with A best; 1m: the same order except K, L lead (A..J lower) and M missing; 3m: M, N best then A..L
const W = names.map((n, i) => T(n, tk(n), 20 - i))
const M1 = [T('Theme K', 'THK', 30), T('Theme L', 'THL', 29), ...names.slice(0, 10).map((n, i) => T(n, tk(n), 20 - i)), T('Theme N', 'THN', 1)]
const M3 = [T('Theme M', 'THM', 50), T('Theme N', 'THN', 49), ...names.slice(0, 12).map((n, i) => T(n, tk(n), 40 - i))]
const ENVS = { '1w': themesEnv('1w', W), '1m': themesEnv('1m', M1), '3m': themesEnv('3m', M3) }

describe('stock.themeRotation: the cross-period logic (pure)', () => {
  it('ranks are re-computed (shuffled input → same ranks), keyed by ticker, duplicates dropped', () => {
    const shuffled = themesEnv('1w', [...W].reverse().concat([T('Theme A dup', 'THA', -99)]))
    const r = ranksOf(shuffled)
    expect([...r.values()].sort((a, b) => a.rank - b.rank).map(x => x.name).slice(0, 3)).toEqual(['Theme A', 'Theme B', 'Theme C'])
    expect(r.get('THA')).toMatchObject({ rank: 1, ret: 20 })
    expect(r.size).toBe(14)
    expect(ranksOf({ status: 'unavailable', data: null })).toBeNull()
  })

  it('ties share a rank (competition ranking on the 2-dp return the member sees), ordered by name; a tie AT #10 keeps both', () => {
    const r = ranksOf(themesEnv('1w', [T('Zeta', 'Z', 5.004), T('Alpha', 'A', 4.996), T('Mid', 'M', 4), T('Top', 'T', 9)]))
    expect(['Top', 'Alpha', 'Zeta', 'Mid'].map(n => [...r.values()].find(x => x.name === n).rank)).toEqual([1, 2, 2, 4])
    const nine = Array.from({ length: 9 }, (_, i) => T(`L${i}`, `L${i}`, 100 - i))
    const rot = rotationOf({ '1w': themesEnv('1w', [...nine, T('Tie1', 'X1', 50), T('Tie2', 'X2', 50), T('Last', 'X3', 1)]), '1m': themesEnv('1m', nine), '3m': themesEnv('3m', nine) })
    expect(rot.leaders.map(x => x.key)).toEqual([...nine.map(x => x.ticker), 'X1', 'X2'])
    expect(rot.leaders.slice(-2).map(x => x.rank1w)).toEqual([10, 10])
    expect(rot.fresh.map(x => x.key)).toEqual(['X1', 'X2'])                       // outside the 1m top 30 → new
  })

  it('new / out / all three — each by its rule, a missing theme is "outside the top 30", never a rank', () => {
    const rot = rotationOf(ENVS)
    expect(rot.leaders.map(x => x.name)).toEqual(names.slice(0, 10))
    // 1m top 10 = K, L, A..H → A..H stay; I, J (1m #11, #12) are new
    expect(rot.fresh.map(x => x.name)).toEqual(['Theme I', 'Theme J'])
    // 3m top 10 = M, N, A..H → M (outside the 1w top 30? no: 1w #13) and N (1w #14) fell out of this week's top 10
    expect(rot.faded.map(x => [x.name, x.rank1w, x.rank3m])).toEqual([['Theme M', 13, 1], ['Theme N', 14, 2]])
    expect(rot.steady.map(x => x.name)).toEqual(names.slice(0, 8))
    // M is absent from the 1m list: null (outside), not a number
    expect(rotationOf(ENVS).faded[0].rank1m).toBeNull()
  })

  it('an unread period: its categories are not given (null), the others still are; no 1w → not ok', () => {
    const rot = rotationOf({ ...ENVS, '1m': { status: 'unavailable', data: null } })
    expect(rot.fresh).toBeNull()
    expect(rot.steady).toBeNull()
    expect(rot.faded.map(x => x.name)).toEqual(['Theme M', 'Theme N'])
    expect(rot.leaders[0].rank1m).toBeUndefined()
    expect(rotationOf({ ...ENVS, '1w': { status: 'unavailable', data: null } }).ok).toBe(false)
  })

  it('the card: dated, every list in fixed words, ranks shown, unread period said; refusal has no figure', () => {
    const a = answerFromRotation(ENVS)
    const lines = a.text.split('\n')
    expect(lines[0]).toBe('Theme rotation — UCT\'s curated themes ranked by equal-weight return over one week, one month and three months (as of the Tue, Nov 3 close):')
    expect(lines[1]).toContain('Theme A +20.00% (#1; 1m #3; 3m #3)')
    expect(lines[1]).toContain('Theme I +12.00% (#9; 1m #11; 3m #11)')
    expect(lines[2]).toBe('New to the top 10 this week (not in the one-month top 10): Theme I, Theme J.')
    expect(lines[3]).toBe('Out of this week\'s top 10 after leading over three months: Theme M (3m #1; 1w #13), Theme N (3m #2; 1w #14).')
    expect(lines[4]).toBe('In the top 10 on all three periods: Theme A, Theme B, Theme C, Theme D, Theme E, Theme F, Theme G, Theme H.')
    expect(lines.at(-1)).toBe(DESCRIPTIVE)
    expect(a.text).toContain(`Ranks are among the top ${LIMIT} themes of each period; tied returns share a rank.`)
    expect(a.text).not.toMatch(/never be echoed|\blive\b(?! feed)|\bnow\b|\bbuy\b|\bsell\b|will (rise|fall|continue)/i)
    expect(a.table.rows[0]).toEqual(['Theme A', '20.00', '1', '3', '3'])
    const part = answerFromRotation({ ...ENVS, '3m': { status: 'unavailable', data: null } }).text
    expect(part).toContain('Not compared: the three months returns could not be read')
    expect(part).toContain('3m not read')
    const none = answerFromRotation({ ...ENVS, '1w': { status: 'unavailable', data: null } }).text
    expect(none).toBe("I couldn't compare UCT's themes across periods: this week's theme returns are not available yet (theme data may be warming). No figure is stated.")
    expect(answerFromRotation({ ...ENVS, '1m': themesEnv('1m', M1, { stale: true }) }).text).toContain('Note: some theme returns were computed before the last completed session')
  })
})

const SERVED = { stream: false, nl1: false, data: true, scan: false, data_kinds: ['themes'], workflows: ['themeRotation'] }
let p, reads, config
function wirePanel() {
  reads = []
  p = setupPanel()
  const harness = globalThis.fetch
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/config') return json(config)
    if (u === '/api/agent/data') {
      const b = JSON.parse(init.body); reads.push(b)
      if (b.kind === 'themes') return json(ENVS[b.params.period])
      return json({ status: 'refused', data: null })
    }
    return harness(url, init)
  })
}

describe('stock.themeRotation: served panel, dark, isolation', () => {
  beforeEach(() => { _resetAgentConfig(); _resetTurns(); _resetThemeRotationForTest(); config = SERVED; wirePanel() })
  afterEach(() => { _resetTurns(); _resetThemeRotationForTest(); vi.restoreAllMocks() })

  it('fast path: 0 model turns, exactly three themes reads (1w, 1m, 3m; leaders; limit 30); nothing changed', async () => {
    const { say, h } = p.mount(...ONE('QQQ'))
    const before = h.charts.list().map(c => c.symbol)
    const out = await say('which themes are rotating?')
    expect(p.turns()).toBe(0)
    expect(reads.map(r => [r.kind, r.params])).toEqual(['1w', '1m', '3m'].map(period => ['themes', { period, order: 'leaders', limit: 30 }]))
    expect(reads.every(r => r.purpose === 'answer' && typeof r.turn_id === 'string')).toBe(true)
    expect(out).toContain('New to the top 10 this week (not in the one-month top 10): Theme I, Theme J.')
    expect(out).toContain(DESCRIPTIVE)
    expect(h.charts.list().map(c => c.symbol)).toEqual(before)
  })

  it('dark by default, and a LATER config that switches it off takes it and its routing words out', async () => {
    for (const c of [{ workflows: [] }, { workflows: ['relativeStrength'] }, { data: false }, { data_kinds: ['quotes'] }]) {
      _resetAgentConfig(); _resetThemeRotationForTest()
      config = { ...SERVED, ...c }
      await loadAgentConfig()
      expect(themeRotationServed()).toBe(false)
      expect(registerThemeRotationCapability()).toBe(false)
      expect(allCapabilityNames()).not.toContain(CAPABILITY)
      expect(match('which themes are rotating')).toBeNull()
    }
    expect(wordsSelect('data', 'which themes are rotating')).toBe(false)
    _resetAgentConfig(); config = SERVED
    await loadAgentConfig()
    expect(registerThemeRotationCapability()).toBe(true)
    expect(wordsSelect('data', 'which themes are rotating')).toBe(true)
    _resetAgentConfig(); config = { ...SERVED, workflows: [] }
    await loadAgentConfig()
    registerServerGatedBuiltins()
    expect(allCapabilityNames()).not.toContain(CAPABILITY)
    expect(wordsSelect('data', 'which themes are rotating')).toBe(false)
    expect(reads).toEqual([])
  })

  it('isolation and shape: a served NON-local market query in the data group; fast-path phrasings', async () => {
    await loadAgentConfig()
    registerServerGatedBuiltins()
    const cap = getCapability(CAPABILITY)
    expect(cap).toMatchObject({ query: true, target: 'market' })
    expect(cap.localOnly).toBeFalsy()
    expect(handshake.local_only_actions).not.toContain(CAPABILITY)
    expect(handshake.isolated_kinds).not.toContain('themes')
    expect(groupOfAction(CAPABILITY)).toBe('data')
    for (const t of ['theme rotation', 'show me the theme rotation this week', 'which themes are fading', 'what themes are new leaders this week', 'emerging themes']) expect(match(t), t).toEqual({ action: CAPABILITY, params: {} })
    for (const t of ['which themes are leading this week', 'apply the midnight theme', 'rotate the chart', 'theme tracker']) expect(match(t), t).toBeNull()
  })
})
