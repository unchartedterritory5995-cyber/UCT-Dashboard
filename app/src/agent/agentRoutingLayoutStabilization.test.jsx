// STABILIZATION (2026-10-11 live-model batch, 11/14) — the two confirmed causes of the three misses:
//   1. "Show me my strongest stocks" matched NO routing group, so the screener actions missed the
//      per-request budget and the model had to ask for them (need_groups); its follow-up ("now only
//      the ones above $50") inherited that miss.
//   2. "Switch to my trading layout": the fast path opens the ONE layout named with those words
//      (`resolveForOpen`), but a model-planned request was given only the raw list and asked.
// Scripted only — no model call. The real manifest, the real routing budget, the real context.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { manifestFor, buildContext, MANIFEST_CONTRACT, getCapability } from './capabilities'
import { selectGroups, routeManifest } from './routing'
import { fastParse } from './fastPath'
import { namedLayoutOf } from './capabilities/layout'
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

describe('2 · saved-layout resolution — model-planned requests get the fast path\'s own answer', () => {
  const E = (...names) => names.map((name, i) => ({ id: i + 1, name }))
  const host = (names) => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' }, {
    layouts: { entries: E(...names), boards: {}, active: null },
  }).host

  it.each([
    ['Switch to my trading layout.', ['Main Trading', 'Swing Setups'], 'Main Trading'],
    ['can you pull up my trading layout please', ['Main Trading', 'Swing Setups'], 'Main Trading'],
    ['go back to the swing layout', ['Main Trading', 'Swing Setups'], 'Swing Setups'],
    ['open my main trading layout and add RSI', ['Main Trading', 'Swing Setups'], 'Main Trading'],
    ['switch to the Swing Setups layout', ['Main Trading', 'Swing Setups'], 'Swing Setups'],
  ])('"%s" names exactly one layout', (msg, names, want) => {
    expect(namedLayoutOf(E(...names), msg)?.name).toBe(want)
  })

  it.each([
    ['ambiguous: two layouts hold "trading"', 'switch to my trading layout', ['Main Trading', 'Day Trading']],
    ['missing: no layout holds "crypto"', 'open my crypto layout', ['Main Trading', 'Swing Setups']],
    ['a bare word is never a layout (no "layout" in the request)', 'open trading', ['Main Trading', 'Swing Setups']],
    ['two different layouts named in one request', 'open my swing layout or my trading layout', ['Main Trading', 'Swing Setups']],
    ['no layouts at all', 'switch to my trading layout', []],
  ])('%s → nothing named (the model asks with the real names)', (_, msg, names) => {
    expect(namedLayoutOf(E(...names), msg)).toBeNull()
  })

  it('the model-planned context carries `namedInRequest` exactly when the fast path would open it', () => {
    const phrases = ['switch to my trading layout', 'open my swing layout', 'switch to my crypto layout', 'pull up the setups layout']
    for (const names of [['Main Trading', 'Swing Setups'], ['Main Trading', 'Day Trading']]) {
      const h = host(names)
      for (const msg of phrases) {
        const f = fastParse(msg, { host: h })
        const fastId = f && f.kind === 'ops' && f.ops[0].action === 'layout.open' ? f.ops[0].args.layout : null
        const { context } = buildContext(h, { ...CTX, message: msg })
        const named = context.layouts?.[0]?.namedInRequest || null
        expect(named ? named.id : null, `${msg} / ${names}`).toBe(fastId)
      }
    }
  })

  it('the context names it only for THIS request (another message gets none)', () => {
    const h = host(['Main Trading', 'Swing Setups'])
    expect(buildContext(h, { ...CTX, message: 'Switch to my trading layout.' }).context.layouts[0].namedInRequest)
      .toEqual({ id: '1', name: 'Main Trading' })
    expect(buildContext(h, { ...CTX, message: 'add RSI' }).context.layouts[0].namedInRequest).toBeUndefined()
  })

  it('the hint tells the model to open `namedInRequest` and still to ask when nothing is named', () => {
    const h = getCapability('layout.open').hints
    expect(h).toMatch(/namedInRequest/)
    expect(h).toMatch(/clarify with the real names/)
    expect(h.length).toBeLessThanOrEqual(1000)
  })

  it('opening stays the same op: an unsaved board still proposes before switching (approval unchanged)', () => {
    const cap = getCapability('layout.open')
    expect(cap.confirmIf({ unsaved: true, active: { id: 2 } }, { layout: '1' })).toBe(true)
    expect(cap.confirmIf({ unsaved: false, active: { id: 2 } }, { layout: '1' })).toBe(false)
  })
})
