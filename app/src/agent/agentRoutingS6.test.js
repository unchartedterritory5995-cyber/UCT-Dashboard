// S6 routing stabilisation (real-model acceptance findings F1–F3 + premature past-tense proposals).
// The execution boundary (indicatorAuthoring.screenModelOps), the layout.saveAs fast path, and the
// presentation-only proposal wording (proposalWording.js) — against the REAL Indicators authoring
// interface (only the model reply is a stand-in).
import { describe, it, expect, beforeEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan } from './runtime'
import { fastParse } from './fastPath'
import { setAuthoringSources, _resetAuthoring, indicatorDraftsKind, screenModelOps, asksToApply } from './capabilities/indicatorAuthoring'
import { pendingLine, pendingLines, PAST_TO_PENDING } from './proposalWording'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { parseFormula } from '../components/chart/engine/ast/parse'
import { _simulateReload, STORAGE_KEY } from '../components/chart/builder/authoring/conversationSessions'
import { _resetDraftPreview } from '../components/chart/builder/agentAuthoring'
import alertSrc from './capabilities/alert.js?raw'
import boardSrc from './capabilities/board.js?raw'
import chartSrc from './capabilities/chart.js?raw'
import drawingsSrc from './capabilities/drawings.js?raw'
import layoutSrc from './capabilities/layout.js?raw'
import savedScreensSrc from './capabilities/savedScreens.js?raw'
import watchlistSrc from './capabilities/watchlist.js?raw'
import workspaceSrc from './capabilities/workspace.js?raw'
import indicatorEditsSrc from './capabilities/indicatorEdits.js?raw'
import indicatorsSrc from './capabilities/indicators.js?raw'
import indicatorAuthoringSrc from './capabilities/indicatorAuthoring.js?raw'

registerBuiltins()
const P = (src) => parseFormula(src).ast
const converse = async ({ state }) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
  envelope: { contract: 'uct.authoring.patch/1', baseRevision: state.revision, ops: [{ op: 'create', name: 'EMA 20', placement: 'price', outputs: [{ key: 'e', label: 'EMA 20', tree: P('ema(close, 20)') }] }], assumptions: [], disposition: 'change' } })
beforeEach(() => {
  _simulateReload(); try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  _resetAuthoring(); _resetDraftPreview()
  setAuthoringSources({ access: () => true, rows: () => [], extra: { converse } })
})
function host(n = 1) {
  const specs = [{ ref: 'L', label: 'Left chart (NVDA)', symbol: 'NVDA' }, { ref: 'R', label: 'Right chart (AAPL)', symbol: 'AAPL' }].slice(0, n)
  const store = Object.fromEntries(specs.map(s => [s.ref, mergeChartSettings(null)]))
  return {
    charts: {
      list: () => specs.map(s => ({ ...s, tf: 'D', cs: store[s.ref], stored: store[s.ref] })),
      read: (ref) => specs.find(s => s.ref === ref) || null,
      commit: () => true, canManageIndicators: () => true, canCreateIndicator: () => true,
      previewHost: () => ({ showAuthoringPreview: () => ({ ok: true, movedFrom: null }), clearAuthoringPreview: () => true }),
    },
    persist: async () => ({ ok: true }),
  }
}
const CTX = { surface: 'charts', createIndicator: true }
const screen = (h, ops, text) => screenModelOps(h, ops, text, CTX)
async function withDraft(h) {
  const ops = [{ action: 'indicator.draft', target: 'draft:new', args: { message: 'plot the EMA 20 of close', chart: 'L', edit: null } }]
  buildContext(h, CTX)
  const p = planOps(collectTargets(h, ['indicatorDrafts']), ops, await prepareOps(ops), CTX)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  expect((await commitPlan(h, p, { env: {}, ctx: CTX })).ok).toBe(true)
  return indicatorDraftsKind.list(h).find(s => s.active).ref
}

describe('F1 — building an indicator in conversation is the default', () => {
  const openCreate = (request = 'plot the EMA 20 of close', defId = null) => ({ action: 'indicator.openCreate', target: 'ind:L', args: { request, defId } })
  it('"Build me a new custom indicator…" — the model\'s openCreate becomes an in-chat indicator draft on that chart, with the member\'s words', () => {
    const text = 'Build me a new custom indicator that plots the EMA 20 of close on the SPY chart.'
    const s = screen(host(), [openCreate()], text)
    expect(s.ask).toBeUndefined()
    expect(s.ops).toEqual([{ action: 'indicator.draft', target: 'draft:new', args: { message: text, chart: 'L', edit: null } }])
    expect(s.notes[0]).toMatch(/Building it with you here in the chat/)
  })
  it('an EXPLICIT request for the visual builder keeps openCreate', () => {
    for (const t of ['Open Create Indicator with an EMA 20 request', 'open the indicator builder and type: EMA 20', 'I want the visual builder for this', 'Open the panel to make an RSI indicator']) {
      expect(screen(host(), [openCreate()], t).ops[0].action, t).toBe('indicator.openCreate')
    }
  })
  it('a member WITHOUT Create Indicator access: nothing is redirected (the op is refused as before, no "building it" note)', () => {
    const s = screenModelOps(host(), [openCreate()], 'help me build an rsi indicator', { surface: 'charts', createIndicator: false })
    expect(s.ops[0].action).toBe('indicator.openCreate')
    expect(s.notes).toEqual([])
  })
  it('Modify (defId) is never rewritten', () => {
    expect(screen(host(), [openCreate(null, 'u_aaaaaaaaaaaa')], 'change my indicator').ops[0].action).toBe('indicator.openCreate')
  })
  it('the capability text no longer tells the model to open the panel for "help me build…"', () => {
    const oc = getCapability('indicator.openCreate')
    expect(oc.hints).not.toMatch(/Use for "open Create Indicator", "help me build/)
    expect(oc.hints).toMatch(/ONLY for an explicit request to open the panel/)
    expect(getCapability('indicator.draft').summary).toMatch(/^THE DEFAULT for building a custom indicator/)
  })
})

describe('F2 — "Save it as X" with an indicator draft open is never a silent layout save', () => {
  it('the fast path no longer claims "save it as X" while a draft is open; explicit layout wording still fast-paths; no draft → unchanged', async () => {
    const h = host()
    expect(fastParse('Save it as M3 Acceptance EMA 20.', { host: h })?.ops?.[0]?.action).toBe('layout.saveAs')   // no draft yet
    await withDraft(h)
    expect(fastParse('Save it as M3 Acceptance EMA 20.', { host: h })?.ops?.[0]?.action).not.toBe('layout.saveAs')
    expect(fastParse('Save this as Trend', { host: h })?.ops?.[0]?.action).not.toBe('layout.saveAs')
    expect(fastParse('Save this layout as Trend', { host: h })?.ops?.[0]?.action).toBe('layout.saveAs')
    expect(fastParse('Save this workspace as Trend', { host: h })?.ops?.[0]?.action).toBe('layout.saveAs')
  })
  it('the model picks layout.saveAs for "Save it as X" while a draft is open → ASK (both choices named), nothing planned', async () => {
    const h = host()
    await withDraft(h)
    const s = screen(h, [{ action: 'layout.saveAs', target: 'layouts', args: { name: 'M3 Acceptance EMA 20' } }], 'Save it as M3 Acceptance EMA 20.')
    expect(s.ops).toEqual([])
    expect(s.ask.text).toMatch(/save the indicator you’re building, or this workspace as a layout\?/)
    expect(s.ask.choices.map(c => c.label)).toEqual(['Save the indicator draft as M3 Acceptance EMA 20', 'Save this workspace as a new layout called M3 Acceptance EMA 20'])
    expect(s.ask.choices.every(c => !c.ref)).toBe(true)      // a choice is sent as the member's own words
  })
  it('an explicit layout save is NOT overridden, even with a draft open', async () => {
    const h = host()
    await withDraft(h)
    const op = { action: 'layout.saveAs', target: 'layouts', args: { name: 'Trend' } }
    expect(screen(h, [op], 'Save this workspace as a new layout called Trend').ops).toEqual([op])
    expect(screen(h, [op], 'save the layout as Trend').ops).toEqual([op])
  })
  it('no indicator draft open → "Save it as X" stays a layout save (layout behaviour unchanged)', () => {
    const op = { action: 'layout.saveAs', target: 'layouts', args: { name: 'Trend' } }
    expect(screen(host(), [op], 'Save it as Trend').ops).toEqual([op])
  })
  it('the reverse: the model picks indicator.saveDraft but the member said "layout" (and not indicator) → ASK', async () => {
    const h = host()
    const ref = await withDraft(h)
    const s = screen(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: 'Trend' } }], 'save the layout as Trend')
    expect(s.ops).toEqual([])
    expect(s.ask.choices).toHaveLength(2)
  })
  it('the indicator saveDraft for "save it as X" passes through unchanged', async () => {
    const h = host()
    const ref = await withDraft(h)
    const op = { action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: 'Trend' } }
    expect(screen(h, [op], 'Save it as Trend').ops).toEqual([op])
  })
})

describe('F3 — Save and "add to a chart" are separate intents', () => {
  const save = (addTo) => ({ action: 'indicator.saveDraft', target: 'draft:create:x', args: { addTo, name: 'Trend' } })
  it('an unrequested chart add is dropped (with a note); a requested one is kept', () => {
    const a = screen(host(), [save(['L'])], 'Save the indicator draft as Trend.')
    expect(a.ops[0].args.addTo).toEqual([])
    expect(a.notes).toContain('Saving only — I won’t add it to a chart unless you ask.')
    expect(screen(host(), [save(['L'])], 'Save it as Trend and add it to my chart.').ops[0].args.addTo).toEqual(['L'])
    expect(screen(host(), [save(['L', 'R'])], 'Save it and put it on both charts').ops[0].args.addTo).toEqual(['L', 'R'])
  })
  it('asksToApply: negated clauses are not requests', () => {
    for (const t of ['Save it as X and add it to my chart.', 'save it, then apply it to the left chart', 'Save the indicator and add it to both.', 'save it and put it on the NVDA chart']) expect(asksToApply(t), t).toBe(true)
    for (const t of ['Save the indicator draft as X. Do not add it to any chart yet.', 'save it as X', 'save it without adding it to a chart', 'Save it as X, don’t put it on a chart']) expect(asksToApply(t), t).toBe(false)
  })
  it('an invalid chart ref is rejected at plan with a truthful sentence; the draft is not touched', async () => {
    const h = host()
    const ref = await withDraft(h)
    const rev0 = indicatorDraftsKind.list(h).find(s => s.ref === ref).status.revision
    const ops = [{ action: 'indicator.saveDraft', target: ref, args: { addTo: ['c99'], name: null } }]
    const p = planOps(collectTargets(h, ['indicatorDrafts']), ops, await prepareOps(ops), CTX)
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/That isn’t a chart on this board, so nothing was saved or added/)
    expect(indicatorDraftsKind.list(h).find(s => s.ref === ref).status.revision).toBe(rev0)
  })
  it('the saveDraft hint states the separation', () => {
    expect(getCapability('indicator.saveDraft').hints).toMatch(/addTo = \[\] UNLESS the member asked in this message/)
    expect(getCapability('indicator.saveDraft').hints).toMatch(/NOT the workspace layout/)
  })
})

describe('proposal wording — pending before approval, past tense only in receipts', () => {
  it('pendingLine: the leading past verb becomes pending; a "Label: " prefix is kept; other lines are untouched', () => {
    expect(pendingLine('Deleted the layout “Momentum” (permanent)')).toBe('Delete the layout “Momentum” (permanent)')
    expect(pendingLine('Saved this workspace as a new layout “X” (now open)')).toBe('Save this workspace as a new layout “X” (it becomes the open layout)')
    expect(pendingLine('Left chart (NVDA): Hid Volume')).toBe('Left chart (NVDA): Hide Volume')
    expect(pendingLine('All 4 new: Switched timeframe to 5 minutes')).toBe('All 4 new: Switch timeframe to 5 minutes')
    expect(pendingLine('Drew a horizontal line at 200 on Chart (SPY)')).toBe('Draw a horizontal line at 200 on Chart (SPY)')
    expect(pendingLine('Already Weekly')).toBe('Already Weekly')
    expect(pendingLine('Save “EMA 20” as a new indicator (draft revision 3)')).toBe('Save “EMA 20” as a new indicator (draft revision 3)')
    expect(pendingLines(['Removed RSI from Left chart', 'Opened “Swing”'])).toEqual(['Remove RSI from Left chart', 'Open “Swing”'])
  })
  it('a confirm-risk plan: the receipt (plan lines) says what happened; the proposal card says what will', async () => {
    const h = host()
    h.layouts = undefined
    const p = { lines: ['Deleted the layout “Momentum” (permanent)'] }       // describe() = receipt wording
    expect(pendingLines(p.lines)).toEqual(['Delete the layout “Momentum” (permanent)'])
  })
  it('REGISTRY AUDIT: every past-tense verb that starts a describe() string is known to pendingLine', () => {
    const SRC = { alertSrc, boardSrc, chartSrc, drawingsSrc, layoutSrc, savedScreensSrc, watchlistSrc, workspaceSrc, indicatorEditsSrc, indicatorsSrc, indicatorAuthoringSrc }
    const unknown = []
    for (const [file, src] of Object.entries(SRC)) {
      for (const block of src.split(/\n {4}describe[:(]/).slice(1)) {
        const body = block.split(/\n {4}[a-zA-Z]+[:(]/)[0]
        for (const m of body.matchAll(/[`'"]([A-Z][a-z]+ed|Hid|Drew|Made|Put|Ran|Set|Reset)\b/g)) {
          if (!PAST_TO_PENDING[m[1]]) unknown.push(`${file}: ${m[1]}`)
        }
      }
    }
    expect(unknown).toEqual([])
  })
})

describe('S6 probe P9 — a chart named through its indicators / indicatorEdits entry is that chart', () => {
  it('saveDraft.addTo with an ixe:/ind: ref plans an add to that chart; anything else is still refused', async () => {
    const h = host()
    const ref = await withDraft(h)
    for (const r of ['ixe:L', 'ind:L', 'L']) {
      const ops = [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [r], name: null } }]
      const p = planOps(collectTargets(h, ['indicatorDrafts']), ops, await prepareOps(ops), CTX)
      expect(p.ok, r + JSON.stringify(p.refusals)).toBe(true)
      expect(p.plans[0].after.ops.find(o => o.type === 'save').addTo).toEqual(['L'])
    }
    const bad = [{ action: 'indicator.saveDraft', target: ref, args: { addTo: ['ixe:ZZ'], name: null } }]
    expect(planOps(collectTargets(h, ['indicatorDrafts']), bad, await prepareOps(bad), CTX).ok).toBe(false)
  })
  it('the argRefs declare the chart-bearing kinds', () => {
    expect(getCapability('indicator.saveDraft').argRefs.addTo).toEqual(['chart', 'indicators', 'indicatorEdits'])
    expect(getCapability('indicator.previewDraft').argRefs.chart).toEqual(['chart', 'indicators', 'indicatorEdits'])
    expect(getCapability('indicator.draft').hints).toMatch(/"this indicator" \/ "the indicator" \/ "it" means that draft/)
  })
})
