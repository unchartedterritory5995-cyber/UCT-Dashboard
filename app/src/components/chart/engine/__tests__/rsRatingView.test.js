// app/src/components/chart/engine/__tests__/rsRatingView.test.js
//
// ─── UCT RS · Deepvue round 2 — the RS Rating Reading (rev 5, 2026-11-08) ────
//
// Against the REGISTERED definition (never a copy). What this file pins:
//
//   1. the rev and the option: version and `compute.rev` 5; 'RS Rating' is a
//      `requiresServer` option of the Reading, hidden until the live row's `view`
//      enum names it, and no preset sets it (members pick the Reading);
//   2. the plots: the rating in info blue, its 21-session average dashed in the
//      neutral, the 80 / 90 guides solid in the neutral and only under this Reading, no
//      gold; both lines `requiresServer`;
//   3. the readout: the glance row under its Reading only, the server summary in
//      the normal ink, the reason muted, the numbers block, the pane label's last
//      value, the card's copy (the honesty sentence, plain words);
//   4. detectPreset: an instance on the RS Rating Reading reads as no preset, and
//      every preset still reads back as itself from it.
import { describe, it, expect } from 'vitest'
import * as engineRegistry from '../nativeRegistry'
import { getDefinition } from '../nativeRegistry'
import { readoutRows } from '../readoutSchema'
import { validateDefinition } from '../defSchema'
import { readoutFallbackValue, resolvedInputsOf } from '../readout'
import { planBindings, seriesOptionsForPlot, includeRangeProvider, AUTOSCALE_EXCLUDE } from '../pool'
import { mergeChartSettings } from '../../chartDefaults'
import { setIndicatorEnabled, findInstance, applyPresetInputs, detectPreset, presetsOf } from '../instanceControls'
import { legacyInstanceId } from '../instances'
import { fieldsForInstance, visiblePresets } from '../../indicatorRegistry'
import { IND_TOKENS } from '../../designTokens'

const RS = getDefinition('rsLine')
const HONESTY = 'No published hit rate exists for this signal and UCT has not measured one yet.'
const NB = ' '
const V4_VIEWS = ['ratio', 'mansfield', 'rotation', 'quality', 'vars']
const V4_INPUTS = RS.meta.serverInputs
const declared = (views) => ({ inputs: V4_INPUTS,
  options: { benchmark: ['SPY', 'RSP', 'SECTOR', 'QQQ', 'IWM', 'INDUSTRY', 'CUSTOM'], maType: ['EMA', 'SMA'], view: views } })

const HISTORY = Object.freeze({ value: 82, average: 79.43, change20: 6, sessions: 187, asof: '2026-11-06',
  stale: false, summary: `82, up${NB}6 in 20${NB}sessions`, reason: null })
const PAYLOAD = Object.freeze({
  rating: { ibd: 82, fast: 80, asof: '2026-11-06', d5: 1, d20: 6, m1: 70, m3: 85, m6: 80, m9: 78, m12: 84,
    source: 'row', summary: '82 · fast 80', components: '1M 70 · 3M 85 · 6M 80 · 9M 78 · 12M 84' },
  benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500 (SPY)', note: null },
  legend: { lastValue: 0.4187, asOf: 20261105, summary: 'Above its 21 EMA' },
  ratingHistory: HISTORY,
})

describe('1 · the rev, the option and the gate', () => {
  it('version and compute.rev are 5, and the definition validates', () => {
    expect(RS).toMatchObject({ version: 5, compute: { kind: 'server', fn: 'rsLine', rev: 5 } })
    expect(validateDefinition(RS).ok).toBe(true)
  })

  it("'RS Rating' is the Reading's last option, requiresServer on its own", () => {
    const view = RS.inputs.find((i) => i.key === 'view')
    expect(view.options.at(-1)).toEqual(['rating', 'RS Rating', { requiresServer: true }])
    expect(view.tooltip).toMatch(/RS Rating: the 1 to 99 rating itself, session by session, on daily charts\./)
    expect(RS.meta.serverInputs).toContain('view')
  })

  it('hidden on a live row whose enum does not name it (the rev 4 row today), listed once it does', () => {
    const opts = (d) => fieldsForInstance(RS, null, { declared: d }).all.find((f) => f.key === 'view').options.map((o) => o[0])
    expect(opts(declared(V4_VIEWS))).toEqual(V4_VIEWS)
    expect(opts(declared([...V4_VIEWS, 'rating']))).toEqual([...V4_VIEWS, 'rating'])
  })

  it('no preset sets the Reading, so every preset still lists on both rows', () => {
    for (const p of RS.meta.presets) expect(p.inputs.view, p.id).not.toBe('rating')
    expect(visiblePresets(RS, declared(V4_VIEWS)).map((p) => p.id))
      .toEqual(visiblePresets(RS, declared([...V4_VIEWS, 'rating'])).map((p) => p.id))
    expect(RS.meta.presets).toHaveLength(10)
  })
})

describe('2 · the plots and the palette', () => {
  const plot = (k) => RS.plots.find((p) => p.key === k)
  const ID = legacyInstanceId('rsLine')
  const registry = { getDefinition: (id) => (id === 'rsLine' ? RS : null) }
  const guideKeys = (inputs) => planBindings([{ instanceId: ID, defId: 'rsLine', inputs }], registry, null, {})
    .bind.flatMap((b) => (b.guides || []).map((g) => g.key))

  it('the rating in info blue, its average dashed in the neutral, both server columns', () => {
    expect(plot('ratingLine')).toMatchObject({ style: 'line', color: IND_TOKENS.classic.info,
      precision: 0, requiresServer: true, legend: { hide: true } })
    expect(plot('ratingLine').$refs.width).toBe('lineWidth')      // the member's Line width, like every reading
    expect(plot('ratingMa')).toMatchObject({ style: 'line', color: IND_TOKENS.classic.neutral, width: 1,
      lineStyle: 'largeDashed', requiresServer: true })
    expect(plot('ratingMa').lineStyle).toBe(plot('rsMa').lineStyle)   // the RS MA's own style
  })

  it('the 80 and 90 guides are neutral, solid 1 px like every guide in the pane, and drawn only under the RS Rating Reading', () => {
    expect(plot('ratingGuides')).toMatchObject({ style: 'hlines', levels: [80, 90], color: IND_TOKENS.classic.neutral,
      width: 1, lineStyle: 'solid', activeWhen: { key: 'view', equals: 'rating' } })
    expect(guideKeys({ view: 'rating' })).toEqual(['ratingGuides'])
    for (const view of V4_VIEWS) expect(guideKeys({ view }), view).not.toContain('ratingGuides')
  })

  // ⭐ real-screen check 2026-11-08: the pane fitted the line alone (a rating in the
  // 60s-80s), so the 90 guide was off screen; at 80-90 (run2) the 90 guide ran through the
  // pane label's row. The scale reaches the ceiling, 99, so both guides sit below the label band.
  it('the scale always spans 80 up to the 99 ceiling while the line has data, and reframes nothing without it', () => {
    expect(plot('ratingLine').autoscaleInclude).toEqual({ min: 80, max: 99 })
    const opt = seriesOptionsForPlot(plot('ratingLine'), { autoscale: 'default' })
    expect(opt.autoscaleInfoProvider).toBe(includeRangeProvider(80, 99))         // memoised by range
    const fit = (lo, hi) => opt.autoscaleInfoProvider(() => ({ priceRange: { minValue: lo, maxValue: hi }, margins: { above: 4, below: 4 } }))
    expect(fit(62, 84)).toEqual({ priceRange: { minValue: 62, maxValue: 99 }, margins: { above: 4, below: 4 } })
    expect(fit(91, 97).priceRange).toEqual({ minValue: 80, maxValue: 99 })
    expect(fit(20, 35).priceRange).toEqual({ minValue: 20, maxValue: 99 })
    // a blank series (every other Reading) answers what the library answered: nothing
    expect(opt.autoscaleInfoProvider(() => null)).toBeNull()
    // a guest on another axis is never widened
    expect(seriesOptionsForPlot(plot('ratingLine'), { autoscale: 'exclude' }).autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
    // no other RS plot declares it
    expect(RS.plots.filter((p) => p.autoscaleInclude).map((p) => p.key)).toEqual(['ratingLine'])
    const bad = (r) => validateDefinition({ ...RS, plots: RS.plots.map((p) => (p.key === 'ratingLine' ? { ...p, autoscaleInclude: r } : p)) })
    for (const r of [{ min: 90, max: 80 }, { min: 80 }, { min: 80, max: 90, pad: 1 }, [80, 90]]) {
      expect(bad(r).errors.join('\n'), JSON.stringify(r)).toMatch(/autoscaleInclude/)
    }
  })

  it('no gold anywhere on the Reading', () => {
    const gold = IND_TOKENS.classic.premium.toLowerCase()
    for (const k of ['ratingLine', 'ratingMa', 'ratingGuides']) expect(String(plot(k).color).toLowerCase(), k).not.toBe(gold)
  })
})

describe('3 · the readout', () => {
  const rows = (inputs, payload = PAYLOAD) => readoutRows(RS, payload, { inputs })
  const glance = (inputs, payload) => rows(inputs, payload).filter((r) => !r.detailOf)

  it('the glance row prints under its Reading only, in row 4, the server summary in the normal ink', () => {
    for (const view of [...V4_VIEWS, 'rating']) {
      const keys = glance({ view }).map((r) => r.key)
      expect(keys.includes('ratingView'), view).toBe(view === 'rating')
    }
    const keys = glance({ view: 'rating' }).map((r) => r.key)
    expect(keys.indexOf('ratingView')).toBe(keys.indexOf('phase') + 1)
    expect(glance({ view: 'rating' }).find((r) => r.key === 'ratingView'))
      .toMatchObject({ label: 'RS Rating', text: `82, up${NB}6 in 20${NB}sessions`, muted: false })
  })

  it('a reason prints muted: daily charts only, not yet rated', () => {
    for (const reason of ['daily charts only', 'not yet rated']) {
      const why = { ...PAYLOAD, ratingHistory: { ...HISTORY, value: null, average: null, change20: null, sessions: 0,
        summary: reason, reason } }
      expect(glance({ view: 'rating' }, why).find((r) => r.key === 'ratingView')).toMatchObject({ text: reason, muted: true })
    }
  })

  it('the numbers block', () => {
    const block = rows({ view: 'rating' }).filter((r) => r.detailOf === 'ratingView').map((r) => [r.label, r.text])
    expect(block).toEqual([['Rating', '82'], ['21-session avg', '79.43'], ['20-session change', '6'],
      ['Sessions drawn', '187'], ['Rated as of', '2026-11-06']])
  })

  // ⭐ real-screen check 2026-11-08: the bare value read `· 82  82` beside the chip's
  // rating, and a weekly chart printed the RS ratio's number over the empty pane.
  it('the pane label carries the server summary (last value first); a reason prints MUTED, never another reading', () => {
    expect(RS.meta.legendFallback.at(-1)).toEqual({ source: 'scalar:ratingHistory.summary', format: 'text',
      when: 'input:view=rating', muted: 'scalar:ratingHistory.reason' })
    expect(readoutFallbackValue(RS, PAYLOAD, 4, { view: 'rating' })).toEqual({ text: `82, up${NB}6 in 20${NB}sessions`, muted: false })
    const weekly = { ...PAYLOAD, ratingHistory: { ...HISTORY, value: null, summary: 'daily charts only', reason: 'daily charts only' } }
    expect(readoutFallbackValue(RS, weekly, 4, { view: 'rating' })).toEqual({ text: 'daily charts only', muted: true })
    // another Reading never prints it
    expect(readoutFallbackValue(RS, PAYLOAD, 4, { view: 'ratio' })).toEqual({ text: '0.4187 · Nov 5', muted: true })
    // an entry WITHOUT a muted gate keeps the old rule: Mansfield prints live
    expect(readoutFallbackValue(RS, { ...PAYLOAD, mansfield: { value: 12.3 } }, 4, { view: 'mansfield' }))
      .toEqual({ text: '+12.3%', muted: false })
  })

  it('defSchema refuses a legendFallback muted that is not a readout gate', () => {
    const lf = (muted) => validateDefinition({ ...RS, meta: { ...RS.meta,
      legendFallback: [{ source: 'scalar:ratingHistory.summary', format: 'text', when: 'input:view=rating', muted }] } })
    expect(lf('scalar:ratingHistory.reason').ok).toBe(true)
    expect(lf(true).errors.join('\n')).toMatch(/legendFallback\[0\]\.muted/)
    expect(lf('input:view=rating').errors.join('\n')).toMatch(/legendFallback\[0\]\.muted/)
  })

  it('the card: what / origin / the honesty sentence; plain words, RS never RSI, no buy or sell', () => {
    const card = RS.readout.find((e) => e.key === 'ratingView').card
    expect(Object.keys(card).sort()).toEqual(['evidence', 'origin', 'what'])
    expect(card.evidence).toBe(HONESTY)
    expect(card.what).toMatch(/21-session average/)
    expect(card.what).toMatch(/80 and 90/)
    expect(card.what).toMatch(/Daily charts only/)
    expect(card.origin).toMatch(/Deepvue/)
    for (const t of Object.values(card)) {
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u)
      expect(t).not.toMatch(/\bRSI\b|\b(buy|sell|guarantee)\b/i)
    }
  })

  it('the Components row and the ranks strip read the 9M rank', () => {
    const comp = rows({ view: 'rating', showComponents: true }).find((r) => r.key === 'ratingComponents')
    expect(comp.text).toBe('1M 70 · 3M 85 · 6M 80 · 9M 78 · 12M 84')
    expect(RS.meta.paneTable.columns.map((c) => c.label)).toEqual(['1M', '3M', '6M', '9M', '12M', 'RS'])
  })
})

describe('4 · detectPreset stays exact around the new Reading', () => {
  const ID = legacyInstanceId('rsLine')
  const fresh = () => setIndicatorEnabled(mergeChartSettings(null), 'rsLine', true, engineRegistry)
  const apply = (cs, id) => applyPresetInputs(cs, ID, RS, RS.meta.presets.find((p) => p.id === id), engineRegistry)
  const reads = (cs) => {
    const instance = findInstance(cs, ID)
    return detectPreset(presetsOf(RS), resolvedInputsOf(RS, instance.inputs), { instance, def: RS, cs })?.id ?? null
  }
  const onRating = (cs) => ({ ...cs, indicatorInstances: cs.indicatorInstances.map((i) => (i.instanceId === ID
    ? { ...i, inputs: { ...i.inputs, view: 'rating' } } : i)) })

  it('an instance on the RS Rating Reading reads as no preset, from any preset', () => {
    expect(reads(onRating(fresh()))).toBeNull()
    for (const p of RS.meta.presets) expect(reads(onRating(apply(fresh(), p.id))), p.id).toBeNull()
  })

  it('every preset reads back as itself when applied over the RS Rating Reading', () => {
    for (const p of RS.meta.presets) expect(reads(apply(onRating(fresh()), p.id)), p.id).toBe(p.id)
  })
})
