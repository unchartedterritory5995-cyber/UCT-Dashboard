// THE ONE COT INDICATOR THAT FOLLOWS THE CHART SYMBOL (2026-09-30).
//
// ⭐ A member adds "COT (Commitment of Traders)" once. Stored, it names no market
// (`sym:COT:AUTO:*`); the chart resolves it for the symbol on screen — QQQ draws
// Nasdaq-100 E-Mini positioning, GLD Gold — and on AAPL it draws NOTHING. These cases
// hold that contract from the catalogue row, through the render-time view, to the
// conversion of every per-market COT group a member already saved.

import { describe, it, expect } from 'vitest'
import { marketIndicatorResults, createFromResult, tabOf, sideBySideBars, GROUP_PANE_HEIGHT } from '../discoveryCatalog'
import { cotFollowOf, resolveCotFollow, isCotFollowSource, COT_FOLLOW_DISPLAY } from '../engine/cotFollow'
import { migrateLegacyCotGroups } from '../engine/legacyCotGroups'
import { mergeChartSettings } from '../chartDefaults'
import { removeInstance, setInstanceHidden, addInstance } from '../engine/instanceControls'
import { paneOwnKeys, paneOwnerOf } from '../engine/displayTarget'
import { presentedPlot } from '../engine/presentation'
import { poolKey } from '../engine/pool'
import { paneGroupOf } from '../engine/paneReadoutPlacement'
import * as registry from '../engine/nativeRegistry'

const PARTS = ['COMM', 'LARGE', 'SMALL']
const NAMES = ['Commercials', 'Large Speculators', 'Small Speculators']
const PAL = ['cot.commercials', 'cot.largeSpecs', 'cot.smallSpecs']

const productRow = (id, display, market, groupTitle) => ({
  id, kind: 'product', symbol: id, display, short: market === 'AUTO' ? 'COT' : `${market} COT`,
  family: 'positioning', family_label: 'Positioning', source_type: 'cot', unit: 'contracts',
  presentation: 'histogram', grouped: true, group_title: groupTitle, group_note: 'Net Contracts',
  components: PARTS.map((p) => `COT:${market}:${p}`),
  component_rows: PARTS.map((p, k) => ({
    id: `COT:${market}:${p}`, short: NAMES[k], presentation: 'histogram', domain: 'signed', palette: PAL[k],
    display: market === 'AUTO' ? `COT · ${NAMES[k]}` : `${display} · ${NAMES[k]}` })),
})

const FOLLOW = productRow('COT', COT_FOLLOW_DISPLAY, 'AUTO', COT_FOLLOW_DISPLAY)
const perMarket = (m, name) => productRow(`COT:${m}`, `${name} COT`, m, `${name} · COT`)

const COT_SYMBOLS = {
  QQQ: { market: 'NQ', name: 'Nasdaq-100 E-Mini' },
  NDX: { market: 'NQ', name: 'Nasdaq-100 E-Mini' },
  SPY: { market: 'ES', name: 'S&P 500 E-Mini' },
  GLD: { market: 'GC', name: 'Gold' },
  TLT: { market: 'ZB', name: '30-Year T-Bond' },
}

const live = (cs) => (cs.indicatorInstances || []).filter((i) => i && !i.deleted && i.instanceId)
const cot = (cs) => live(cs).filter((i) => String(i.inputs?.source || '').startsWith('sym:COT:'))
const add = (row, cs = mergeChartSettings({})) =>
  createFromResult(cs, marketIndicatorResults([row])[0], registry)
const view = (cs, sym) => ({ ...cs, indicatorInstances: resolveCotFollow(cs.indicatorInstances, cotFollowOf(sym, COT_SYMBOLS)) })

describe('the catalogue row', () => {
  it('is ONE Positioning entry named "COT (Commitment of Traders)"', () => {
    const res = marketIndicatorResults([FOLLOW])[0]
    expect(res.name).toBe('COT (Commitment of Traders)')
    expect(tabOf(res)).toBe('positioning')
  })

  it('adds ONE pane of three side-by-side histograms whose sources name NO market', () => {
    const parts = cot(add(FOLLOW))
    expect(parts.map((p) => p.inputs.source)).toEqual(PARTS.map((p) => `sym:COT:AUTO:${p}:close`))
    expect(parts.every((p) => isCotFollowSource(p.inputs.source))).toBe(true)
    expect(parts.map((p) => p.presentation.bar)).toEqual(sideBySideBars(3))
    expect(parts[0].presentation.paneHeight).toBe(GROUP_PANE_HEIGHT)
    expect(parts.every((p) => p.group.name === COT_FOLLOW_DISPLAY && p.group.note === 'Net Contracts')).toBe(true)
    const cs = add(FOLLOW)
    expect([...paneOwnKeys(cs.indicatorInstances, cs)]).toEqual([parts[0].instanceId])
  })
})

describe('the chart symbol picks the market', () => {
  it.each([
    ['QQQ', 'NQ', 'Nasdaq-100 E-Mini · COT'],
    ['qqq', 'NQ', 'Nasdaq-100 E-Mini · COT'],
    ['NDX', 'NQ', 'Nasdaq-100 E-Mini · COT'],
    ['SPY', 'ES', 'S&P 500 E-Mini · COT'],
    ['GLD', 'GC', 'Gold · COT'],
    ['TLT', 'ZB', '30-Year T-Bond · COT'],
  ])('%s draws %s positioning, titled "%s"', (sym, market, title) => {
    const cs = add(FOLLOW)
    const v = view(cs, sym)
    const parts = cot(v)
    expect(parts.map((p) => p.inputs.source)).toEqual(PARTS.map((p) => `sym:COT:${market}:${p}:close`))
    // The same ids, so every by-id control still reaches the stored record.
    expect(parts.map((p) => p.instanceId)).toEqual(cot(cs).map((p) => p.instanceId))
    expect(paneGroupOf(parts.map((p) => ({ instanceId: p.instanceId })), v)).toMatchObject({ name: title, note: 'Net Contracts' })
    // …and it still draws as the accepted side-by-side columns in ONE pane.
    const def = registry.getDefinition('dataSeries')
    for (const p of parts) expect(poolKey(presentedPlot(def.plots[0], p))).toBe('columns')
    expect([...paneOwnKeys(v.indicatorInstances, v)]).toEqual([parts[0].instanceId])
    for (const p of parts) expect(paneOwnerOf(p, v)).toBe(parts[0].instanceId)
  })

  it.each(['AAPL', 'TQQQ', 'NVDA', '', null])('%s shows NOTHING — no pane, no legend', (sym) => {
    const cs = add(FOLLOW, addInstance(mergeChartSettings({}), 'rsi', registry))
    const v = view(cs, sym)
    expect(cot(v)).toEqual([])
    expect(live(v).some((i) => i.defId === 'rsi')).toBe(true)          // everything else draws
    expect([...paneOwnKeys(v.indicatorInstances, v)]).toEqual(
      [live(cs).find((i) => i.defId === 'rsi').instanceId])
  })

  it('before the catalogue has loaded, it draws nothing rather than guessing', () => {
    expect(cot(view(add(FOLLOW), 'QQQ')).length).toBe(3)
    const cs = add(FOLLOW)
    expect(resolveCotFollow(cs.indicatorInstances, cotFollowOf('QQQ', null))
      .filter((i) => i && String(i.inputs?.source || '').startsWith('sym:COT:'))).toEqual([])
  })

  it('⛔ the VIEW never writes: the stored blob keeps AUTO on every symbol', () => {
    const cs = add(FOLLOW)
    const snapshot = JSON.stringify(cs)
    for (const sym of ['QQQ', 'AAPL', 'GLD']) view(cs, sym)
    expect(JSON.stringify(cs)).toBe(snapshot)
  })

  it('a chart with no follow COT is returned by IDENTITY (memo-stable)', () => {
    const cs = addInstance(mergeChartSettings({}), 'rsi', registry)
    expect(resolveCotFollow(cs.indicatorInstances, cotFollowOf('AAPL', COT_SYMBOLS))).toBe(cs.indicatorInstances)
    const nq = add(perMarket('NQ', 'Nasdaq-100 E-Mini'))
    // (a per-market group converts on load; built raw here, it is left to draw as itself)
    const raw = { indicatorInstances: nq.indicatorInstances.map((i) => i) }
    expect(resolveCotFollow(raw.indicatorInstances, null)).toBe(raw.indicatorInstances)
  })

  it('remove / hide by id act on the whole stored indicator, whatever the symbol', () => {
    const cs = add(FOLLOW)
    const [host] = cot(view(cs, 'QQQ'))
    expect(cot(removeInstance(cs, host.instanceId, registry))).toEqual([])
    expect(cot(setInstanceHidden(cs, host.instanceId, true, registry)).every((p) => p.hidden)).toBe(true)
  })
})

describe('every saved per-market COT group converts to the follow indicator', () => {
  const strip = (p) => ({ ...p, instanceId: undefined, group: { ...p.group, id: undefined },
    placement: p.placement ? { target: '@HOST' } : undefined })

  it('a Nasdaq group loads IDENTICAL to a fresh add of the follow row', () => {
    const saved = add(perMarket('NQ', 'Nasdaq-100 E-Mini'))
    const loaded = mergeChartSettings(JSON.parse(JSON.stringify(saved)))
    expect(cot(loaded).map((p) => p.instanceId)).toEqual(cot(saved).map((p) => p.instanceId))
    expect(cot(loaded).map(strip)).toEqual(cot(add(FOLLOW)).map(strip))
  })

  it('keeps the member\'s colours, visibility and the pane\'s place', () => {
    let saved = add(perMarket('ES', 'S&P 500 E-Mini'))
    const [host, l] = cot(saved)
    saved = setInstanceHidden(saved, host.instanceId, true, registry)
    saved = { ...saved, paneOrder: ['price', host.instanceId, 'volume'],
      indicatorInstances: saved.indicatorInstances.map((i) => (i.instanceId === l.instanceId
        ? { ...i, inputs: { ...i.inputs, color: '#ff00aa' } } : i)) }
    const loaded = migrateLegacyCotGroups(saved)
    expect(cot(loaded).every((p) => p.hidden === true && isCotFollowSource(p.inputs.source))).toBe(true)
    expect(cot(loaded)[1].inputs.color).toBe('#ff00aa')
    expect(loaded.paneOrder).toEqual(['price', host.instanceId, 'volume'])
  })

  it('a market with no related fund (Live Cattle) converts too — it drops out of the product', () => {
    const loaded = migrateLegacyCotGroups(add(perMarket('LE', 'Live Cattle')))
    expect(cot(loaded).every((p) => isCotFollowSource(p.inputs.source))).toBe(true)
    expect(cot(view(loaded, 'QQQ')).map((p) => p.inputs.source)[0]).toBe('sym:COT:NQ:COMM:close')
  })

  it('is idempotent: a converted blob, and a fresh follow add, come back by IDENTITY', () => {
    const once = migrateLegacyCotGroups(add(perMarket('NQ', 'Nasdaq-100 E-Mini')))
    expect(migrateLegacyCotGroups(once)).toBe(once)
    const fresh = add(FOLLOW)
    expect(migrateLegacyCotGroups(fresh)).toBe(fresh)
  })

  describe('anything that is not exactly the saved shape is LEFT ALONE', () => {
    const base = () => add(perMarket('NQ', 'Nasdaq-100 E-Mini'))
    const edit = (cs, k, fn) => ({ ...cs, indicatorInstances: cs.indicatorInstances.map((i) =>
      (i.instanceId === cot(cs)[k].instanceId ? fn(i) : i)) })
    const unchanged = (cs) => expect(migrateLegacyCotGroups(cs)).toBe(cs)

    it('a guest the member moved into another pane', () =>
      unchanged(edit(base(), 1, (i) => ({ ...i, placement: { target: '@inst:rsi:1' } }))))
    it('mixed markets under one group', () =>
      unchanged(edit(base(), 2, (i) => ({ ...i, inputs: { ...i.inputs, source: 'sym:COT:ES:SMALL:close' } }))))
    it('parts hidden differently', () => unchanged(edit(base(), 1, (i) => ({ ...i, hidden: true }))))
    it('a renamed group', () => unchanged({ ...base(), indicatorInstances: base().indicatorInstances.map((i) =>
      (i.group ? { ...i, group: { ...i.group, name: 'My positioning' } } : i)) }))
    it('a deleted part', () => unchanged(edit(base(), 2, (i) => ({ instanceId: i.instanceId, deleted: true }))))
  })
})
