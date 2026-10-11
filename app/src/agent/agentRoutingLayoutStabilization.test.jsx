// STABILIZATION (2026-10-11 live-model batch, 11/14) — the two confirmed causes of the three misses:
//   1. "Show me my strongest stocks" matched NO routing group, so the screener actions missed the
//      per-request budget and the model had to ask for them (need_groups); its follow-up ("now only
//      the ones above $50") inherited that miss.
//   2. "Switch to my trading layout": the fast path opened the ONE layout named with those words, but
//      a model-planned request was given only the raw list and asked. (Integration: ONE resolver —
//      `layoutCandidates` + layout.open `resolveArgs` — decides on every path; no prompt-only hint.)
// Scripted only — no model call. The real manifest, the real routing budget, the real context.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { manifestFor, buildContext, MANIFEST_CONTRACT, getCapability } from './capabilities'
import { selectGroups, routeManifest } from './routing'
import { fastParse } from './fastPath'
import { layoutCandidates } from './capabilities/layout'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()
const CTX = { surface: 'charts', createIndicator: true }
const FULL = manifestFor(CTX)
const BUDGET = { limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
const routed = (msg, opts = {}) => routeManifest(FULL, msg, { ...BUDGET, ...opts }).manifest.map(c => c.name)

describe('1 · screening intent — strength / leadership words route the Screener', () => {
  it.each([
    'Show me my strongest stocks.',
    'show me the strongest names',
    'relative strength leaders',
    'top momentum stocks',
    'which are the leading stocks right now',
    'show me market leaders',
    'what are my weakest names',
    'momentum leaders in my watchlist',
    'RS leaders',
  ])('"%s" → the screener group, and screener.run is in the request the model gets', (msg) => {
    expect(selectGroups(msg).selected).toContain('screener')
    expect(routed(msg)).toContain('screener.run')
    expect(routed(msg)).toContain('screener.runSaved')
  })

  it.each([
    'add RSI',
    'add a momentum indicator',            // "momentum" alone is an indicator word, not a screen
    'show momentum on the chart',
    'switch to my trading layout',
    'open NVDA',
    'make the candles stronger green',
    'change my chart to 15 minutes',
  ])('"%s" does NOT route the screener (no false screen)', (msg) => {
    expect(selectGroups(msg).selected).not.toContain('screener')
  })

  it('the follow-up ("now only the ones above $50") keeps the screener — the last plan\'s groups ride along', () => {
    expect(routed('now only the ones above $50', { recentActions: ['screener.run'] })).toContain('screener.run')
    // on its own the follow-up names no group — it is the CARRIED screener group that keeps it a screen
    expect(selectGroups('now only the ones above $50').matched).toBe(false)
    expect(selectGroups('now only the ones above $50', { recentActions: ['screener.run'] }).priority[1]).toBe('screener')
  })

  it('the model is still told what "strongest" means (RS Rank) — routing only decides what it SEES', () => {
    const run = getCapability('screener.run')
    expect(run).toBeTruthy()
  })
})

describe("2 · saved-layout resolution — model-planned requests get the fast path's own answer", () => {
  const E = (...names) => names.map((name, i) => ({ id: i + 1, name }))
  const host = (names) => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' }, {
    layouts: { entries: E(...names), boards: {}, active: null },
  }).host
  const resolve = (h, words) => getCapability('layout.open').resolveArgs({ layout: words }, h)

  it.each([
    ['my trading layout', ['Main Trading', 'Swing Setups'], 'Main Trading'],
    ['the swing layout', ['Main Trading', 'Swing Setups'], 'Swing Setups'],
    ['main trading', ['Main Trading', 'Swing Setups'], 'Main Trading'],
    ['Swing Setups', ['Main Trading', 'Swing Setups'], 'Swing Setups'],
  ])('the words "%s" name exactly one layout → resolved to its id (no question)', (words, names, want) => {
    expect(layoutCandidates(E(...names), words).map(e => e.name)).toEqual([want])
    expect(resolve(host(names), words).args.layout).toBe(String(E(...names).find(e => e.name === want).id))
  })

  it('two layouts hold the words → a question with the REAL names (never a guess)', () => {
    const r = resolve(host(['Main Trading', 'Day Trading']), 'my trading layout')
    expect(r.ask.arg).toBe('layout')
    expect(r.ask.choices.map(c => c.label)).toEqual(['Main Trading', 'Day Trading'])
  })

  it.each([
    ['missing: no layout holds "crypto"', 'my crypto layout', ['Main Trading', 'Swing Setups']],
    ['no layouts at all', 'my trading layout', []],
  ])('%s → nothing resolved (the check refuses with the real list)', (_, words, names) => {
    expect(resolve(host(names), words)).toBeNull()
  })

  it('the instant path and the model-planned path agree on every phrase', () => {
    const phrases = ['switch to my trading layout', 'open my swing layout', 'switch to my crypto layout', 'pull up the setups layout']
    for (const names of [['Main Trading', 'Swing Setups'], ['Main Trading', 'Day Trading']]) {
      const h = host(names)
      for (const msg of phrases) {
        const f = fastParse(msg, { host: h })
        const fastId = f && f.kind === 'ops' && f.ops[0].action === 'layout.open' ? f.ops[0].args.layout : null
        const words = msg.replace(/^(switch to|open|pull up)\s+/, '')
        const r = resolve(h, words)
        const modelId = r?.args?.layout ?? null
        if (fastId && /^\d+$/.test(fastId)) expect(modelId, `${msg} / ${names}`).toBe(fastId)
        else expect(r?.args, `${msg} / ${names}`).toBeUndefined()
      }
    }
  })

  it('the context no longer carries a prompt-only `namedInRequest` hint', () => {
    const h = host(['Main Trading', 'Swing Setups'])
    expect(buildContext(h, { ...CTX, message: 'Switch to my trading layout.' }).context.layouts[0].namedInRequest).toBeUndefined()
    expect(getCapability('layout.open').hints).not.toMatch(/namedInRequest/)
  })

  it('opening stays the same op: an unsaved board still proposes before switching (approval unchanged)', () => {
    const cap = getCapability('layout.open')
    expect(cap.confirmIf({ unsaved: true, active: { id: 2 } }, { layout: '1' })).toBe(true)
    expect(cap.confirmIf({ unsaved: false, active: { id: 2 } }, { layout: '1' })).toBe(false)
  })
})
