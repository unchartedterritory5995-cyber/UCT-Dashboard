// app/src/components/chart/builder/authoring/builtInOffer.test.js
//
// AN ANSWER THAT OFFERS AN ACTION (`builtInOffer.js`): the three rules, and the wire around them.
// The door half is `tests/test_named_built_ins.py`.

import { describe, it, expect, vi } from 'vitest'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { BUILT_IN_NAMES } from './checkedLibrary'
import { addInstance } from '../../engine/instanceControls'
import { offerableBuiltIns, liveOffer, withoutOffer, applyOffer, settingWords, OFFER_ADD_BUILT_IN } from './builtInOffer'
import { converseBody, converseTurn, offerOf, builtInIds, ACCEPTS, BUILT_INS_LIMITS, OFFER_INPUTS_LIMITS } from './converseClient'
import { modelTurn, initialTranscript } from './authoringSession'
import { newAuthoringState } from './index'

const yes = () => true
const no = () => false
const RATING = { kind: OFFER_ADD_BUILT_IN, indicator: 'rsRating' }
const instancesOf = (cs, defId) => (cs.indicatorInstances || []).filter((i) => i.defId === defId)

describe('the library names that are UCT\'s own built-in indicators', () => {
  it('each names a definition of this registry, by the registry\'s own name', () => {
    expect(BUILT_IN_NAMES.map((b) => b.id)).toEqual(['mansfield_relative_strength', 'rs_rating', 'rs_phases', 'session_vwap_bands'])
    for (const b of BUILT_IN_NAMES) {
      const def = registry.getDefinition(b.indicator)
      expect(def, b.indicator).toBeTruthy()
      expect(def.meta.name).toBe(b.builtInName)
    }
  })
})

describe('rule 1: only what this build can add is ever offered', () => {
  it('lists the built-ins the registry offers, asking the Indicators list\'s own question of each', () => {
    const asked = []
    const got = offerableBuiltIns({ registry, isOffered: (def) => { asked.push(def.id); return def.id === 'rsRating' } })
    expect(got).toEqual(['rsRating'])
    expect(asked.sort()).toEqual(['rsMansfield', 'rsPhases', 'rsRating', 'vwap'])
    expect(offerableBuiltIns({ registry, isOffered: yes })).toEqual(['rsMansfield', 'rsRating', 'rsPhases', 'vwap'])
  })

  it('lists nothing when none is offered, when the chart cannot be written, or with no registry', () => {
    expect(offerableBuiltIns({ registry, isOffered: no })).toEqual([])
    expect(offerableBuiltIns({ registry, isOffered: yes, canWrite: false })).toEqual([])
    expect(offerableBuiltIns({ registry: null, isOffered: yes })).toEqual([])
    expect(offerableBuiltIns({ registry, isOffered: null })).toEqual([])
    expect(offerableBuiltIns()).toEqual([])
    // "offered" must be exactly true: a truthy object is not a yes
    expect(offerableBuiltIns({ registry, isOffered: () => ({}) })).toEqual([])
  })

  it('the tap asks again, and writes nothing for an indicator this build no longer offers', () => {
    const cs = mergeChartSettings({})
    const out = applyOffer(RATING, { settings: cs, registry, isOffered: no })
    expect(out).toEqual({ ok: false, line: 'UCT RS Rating is not offered on this chart right now, so nothing was added.' })
  })
})

describe('rule 2: an offer names a library built-in or it is nothing', () => {
  it('reads only the indicator id; the name and the button\'s words are the window\'s own', () => {
    expect(liveOffer({ kind: 'add_built_in', indicator: 'rsRating', name: 'Something Else', label: 'Click me' }))
      .toEqual({ kind: 'add_built_in', indicator: 'rsRating', name: 'UCT RS Rating', label: 'Add UCT RS Rating to this chart' })
    expect(liveOffer({ kind: 'add_built_in', indicator: 'rsPhases' }).label).toBe('Add UCT RS Phases to this chart')
  })

  it.each([
    ['another definition of the registry', { kind: 'add_built_in', indicator: 'rsi' }],
    ['an id that is not a definition', { kind: 'add_built_in', indicator: 'nope' }],
    ['another kind of action', { kind: 'delete_everything', indicator: 'rsRating' }],
    ['no kind', { indicator: 'rsRating' }],
    ['an id that is not a word', { kind: 'add_built_in', indicator: ['rsRating'] }],
    ['nothing', null],
    ['a word', 'rsRating'],
  ])('%s is no offer, and a tap on it writes nothing', (_name, raw) => {
    expect(liveOffer(raw)).toBeNull()
    const cs = mergeChartSettings({})
    expect(applyOffer(raw, { settings: cs, registry, isOffered: yes })).toEqual({ ok: false, line: 'That could not be added from here.' })
  })

  it('CONTROL: the registry does hold rsi, so the refusal above is the library list\'s, not a missing definition', () => {
    expect(registry.getDefinition('rsi')).toBeTruthy()
  })
})

describe('the tap', () => {
  it('makes the Indicators list\'s own write: one instance of the built-in, at its defaults', () => {
    const cs = mergeChartSettings({})
    expect(instancesOf(cs, 'rsRating')).toHaveLength(0)
    const out = applyOffer(RATING, { settings: cs, registry, isOffered: yes })
    expect(out.ok).toBe(true)
    expect(out.line).toBe('Added UCT RS Rating to this chart.')
    expect(instancesOf(out.next, 'rsRating')).toHaveLength(1)
    expect(out.next.indicators.rsRating.enabled).toBe(true)
    expect(out.next.preset).toBe('custom')
    expect(instancesOf(cs, 'rsRating')).toHaveLength(0)                    // the settings handed in are not touched
  })

  it('never adds a second copy of one already on the chart', () => {
    const once = applyOffer(RATING, { settings: mergeChartSettings({}), registry, isOffered: yes }).next
    expect(applyOffer(RATING, { settings: once, registry, isOffered: yes }))
      .toEqual({ ok: false, line: 'UCT RS Rating is already on this chart.' })
  })

  it('says so when there is no chart to write', () => {
    expect(applyOffer(RATING, { settings: null, registry, isOffered: yes }).ok).toBe(false)
    expect(applyOffer(RATING, { settings: mergeChartSettings({}), registry: null, isOffered: yes }).ok).toBe(false)
  })
})

describe('the wire', () => {
  const state = newAuthoringState()

  it('this build tells the door it accepts an offer, and which built-ins it can add', () => {
    expect(ACCEPTS).toContain('offer')
    const body = converseBody({ message: 'Add the RS Rating', state, gateCtx: { symbol: 'AAPL', tf: 'D', builtIns: ['rsRating', 'rsPhases'] } })
    expect(body.accepts).toContain('offer')
    expect(body.addable).toEqual(['rsRating', 'rsPhases'])
  })

  it('says nothing about built-ins when it can add none', () => {
    expect('addable' in converseBody({ message: 'x', state, gateCtx: { symbol: 'AAPL', tf: 'D' } })).toBe(false)
    expect('addable' in converseBody({ message: 'x', state, gateCtx: { builtIns: [] } })).toBe(false)
    expect(builtInIds(['ok', '', 7, null, 'y'.repeat(BUILT_INS_LIMITS.maxChars + 1)])).toEqual(['ok'])
    expect(builtInIds(Array.from({ length: 60 }, (_v, i) => `id${i}`))).toHaveLength(BUILT_INS_LIMITS.max)
    expect(builtInIds('rsRating')).toEqual([])
  })

  it('keeps the offer of an answer, as kind and indicator id only', async () => {
    const answer = {
      ok: true, disposition: 'answer', reply: 'RS Rating is one of UCT\'s own indicators.', turn: 'offer',
      envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply: 'RS Rating is one of UCT\'s own indicators.' },
      offer: { kind: 'add_built_in', indicator: 'rsRating', name: 'UCT RS Rating', label: 'Add UCT RS Rating to this chart', extra: 'dropped' },
    }
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => answer }))
    const res = await converseTurn({ message: 'Add the RS Rating', state, fetchImpl })
    expect(res.ok).toBe(true)
    expect(res.offer).toEqual({ kind: 'add_built_in', indicator: 'rsRating' })
    expect(offerOf({ offer: 'rsRating' })).toEqual({})
    expect(offerOf({ offer: { kind: 'add_built_in' } })).toEqual({})
    expect(offerOf({})).toEqual({})
  })

  it('an answer with an offer becomes a transcript entry that carries it; one without does not', async () => {
    const answer = (offer) => async () => ({
      ok: true, disposition: 'answer', reply: 'It is one of UCT\'s own indicators.', turn: 'offer',
      envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply: 'It is one of UCT\'s own indicators.' },
      notUnderstood: [], unavailable: [], ...(offer ? { offer } : {}),
    })
    const withOffer = await modelTurn(state, () => state, 'Add the RS Rating', { converse: answer(RATING) })
    expect(withOffer.ok).toBe(true)
    expect(withOffer.state).toBeNull()                                     // nothing is built by the answer
    expect(withOffer.entries[0].kind).toBe('answer')
    expect(withOffer.entries[0].offer).toEqual({ kind: 'add_built_in', indicator: 'rsRating', name: 'UCT RS Rating', label: 'Add UCT RS Rating to this chart' })
    const none = await modelTurn(state, () => state, 'What is it?', { converse: answer(null) })
    expect('offer' in none.entries[0]).toBe(false)
    const foreign = await modelTurn(state, () => state, 'x', { converse: answer({ kind: 'add_built_in', indicator: 'rsi' }) })
    expect('offer' in foreign.entries[0]).toBe(false)
  })
})

// ─── ONE SETTING OF A BUILT-IN: VWAP's standard-deviation bands (2026-11-19) ───────────
// The door half is `tests/test_vwap_bands_offer.py`.
describe('rule 4: a setting\'s offer is the built-in with that setting, or it is nothing', () => {
  const BANDS2 = { kind: OFFER_ADD_BUILT_IN, indicator: 'vwap', inputs: { bands: '2' } }
  const bandsOf = (cs) => instancesOf(cs, 'vwap').map((i) => i.inputs.bands)
  const withVwap = () => addInstance(mergeChartSettings({}), 'vwap', registry)

  it('every library row with a setting names an input this registry declares, and values it offers', () => {
    const rows = BUILT_IN_NAMES.filter((b) => b.setting)
    expect(rows.map((b) => b.indicator)).toEqual(['vwap'])
    for (const row of rows) {
      const declared = registry.getDefinition(row.indicator).inputs.find((i) => i.key === row.setting.input)
      expect(declared, row.setting.input).toBeTruthy()
      const options = declared.options.map((o) => o[0])
      expect(row.setting.values.length).toBeGreaterThan(0)
      for (const v of row.setting.values) expect(options, v).toContain(v)
      // ⛔ never the value the definition has by default: an offer for it would be the plain add
      expect(row.setting.values).not.toContain(declared.default)
      // no plain row shares the indicator (the first row found would decide which offer it is)
      expect(BUILT_IN_NAMES.filter((b) => b.indicator === row.indicator)).toHaveLength(1)
    }
  })

  it('reads the indicator id and the one input; the words are this registry\'s own', () => {
    expect(liveOffer({ ...BANDS2, name: 'Something Else', label: 'Click me' })).toEqual({
      kind: 'add_built_in', indicator: 'vwap', name: 'Session VWAP', inputs: { bands: '2' },
      label: 'Add Session VWAP with Std dev bands: ±1σ, ±2σ to this chart',
    })
    expect(liveOffer({ ...BANDS2, inputs: { bands: '3' } }).label).toBe('Add Session VWAP with Std dev bands: ±1σ, ±2σ, ±3σ to this chart')
    expect(settingWords('vwap', 'bands', '1')).toEqual({ input: 'Std dev bands', value: '±1σ' })
    expect(settingWords('vwap', 'bands', '9')).toBeNull()
    expect(settingWords('vwap', 'nope', '1')).toBeNull()
    expect(settingWords('nope', 'bands', '1')).toBeNull()
  })

  it.each([
    ['no inputs at all (the plain add would draw no bands)', { kind: 'add_built_in', indicator: 'vwap' }],
    ['the setting turned off', { ...BANDS2, inputs: { bands: 'off' } }],
    ['a value the library does not hold', { ...BANDS2, inputs: { bands: '4' } }],
    ['a number, not the registry\'s value', { ...BANDS2, inputs: { bands: 2 } }],
    ['another setting beside it', { ...BANDS2, inputs: { bands: '2', lineWidth: '4' } }],
    ['another setting instead', { ...BANDS2, inputs: { color: '#ffffff' } }],
    ['inputs that are a list', { ...BANDS2, inputs: ['bands', '2'] }],
    ['inputs that are nothing', { ...BANDS2, inputs: null }],
    ['a plain built-in that carries inputs', { kind: 'add_built_in', indicator: 'rsRating', inputs: { bands: '2' } }],
  ])('%s is no offer, and a tap on it writes nothing', (_name, raw) => {
    expect(liveOffer(raw)).toBeNull()
    expect(applyOffer(raw, { settings: mergeChartSettings({}), registry, isOffered: yes }))
      .toEqual({ ok: false, line: 'That could not be added from here.' })
  })

  it('the tap adds ONE Session VWAP with the bands on, and every other setting at its default', () => {
    const cs = mergeChartSettings({})
    expect(instancesOf(cs, 'vwap')).toHaveLength(0)
    const out = applyOffer(BANDS2, { settings: cs, registry, isOffered: yes, tf: '5' })
    expect(out.ok).toBe(true)
    expect(out.line).toBe('Added Session VWAP to this chart with Std dev bands: ±1σ, ±2σ.')
    expect(bandsOf(out.next)).toEqual(['2'])
    expect(out.next.indicators.vwap.enabled).toBe(true)
    expect(out.next.preset).toBe('custom')
    // exactly the Indicators list's own add, with the one setting moved
    const plain = instancesOf(withVwap(), 'vwap')[0]
    expect(plain.inputs.bands).toBe('off')
    expect({ ...instancesOf(out.next, 'vwap')[0].inputs, bands: 'off' }).toEqual(plain.inputs)
    expect(instancesOf(cs, 'vwap')).toHaveLength(0)                        // the settings handed in are not touched
  })

  it('on a chart that already has Session VWAP it turns the bands on there: never a second copy', () => {
    const cs = withVwap()
    expect(bandsOf(cs)).toEqual(['off'])
    const out = applyOffer({ ...BANDS2, inputs: { bands: '3' } }, { settings: cs, registry, isOffered: yes, tf: '15' })
    expect(out.ok).toBe(true)
    expect(out.line).toBe('Session VWAP was already on this chart. Its Std dev bands setting is now ±1σ, ±2σ, ±3σ.')
    expect(bandsOf(out.next)).toEqual(['3'])
    expect(bandsOf(cs)).toEqual(['off'])
    // and a second tap for the same bands changes nothing
    expect(applyOffer({ ...BANDS2, inputs: { bands: '3' } }, { settings: out.next, registry, isOffered: yes }))
      .toEqual({ ok: false, line: 'Session VWAP is already on this chart with Std dev bands: ±1σ, ±2σ, ±3σ.' })
  })

  it('says so when the chart is on a timeframe Session VWAP does not draw on (the chart\'s own rule)', () => {
    const daily = applyOffer(BANDS2, { settings: mergeChartSettings({}), registry, isOffered: yes, tf: 'D' })
    expect(daily.ok).toBe(true)
    expect(daily.line).toBe('Added Session VWAP to this chart with Std dev bands: ±1σ, ±2σ. Session VWAP does not draw on this timeframe: it will show when the chart is on one it does.')
    const onIt = applyOffer({ ...BANDS2, inputs: { bands: '1' } }, { settings: withVwap(), registry, isOffered: yes, tf: 'W' })
    expect(onIt.line).toBe('Session VWAP was already on this chart. Its Std dev bands setting is now ±1σ. Session VWAP does not draw on this timeframe: it will show when the chart is on one it does.')
    // with no timeframe handed in, nothing is said about one
    expect(applyOffer(BANDS2, { settings: mergeChartSettings({}), registry, isOffered: yes }).line)
      .toBe('Added Session VWAP to this chart with Std dev bands: ±1σ, ±2σ.')
    // a plain built-in's line is what it was, whatever the timeframe
    expect(applyOffer(RATING, { settings: mergeChartSettings({}), registry, isOffered: yes, tf: '5' }).line).toBe('Added UCT RS Rating to this chart.')
  })

  it('a registry that does not take the asked value: nothing is written, and the line says so', () => {
    const real = registry.getDefinition('vwap')
    const narrowed = {
      getDefinition: (id) => (id === 'vwap'
        ? { ...real, inputs: real.inputs.map((i) => (i.key === 'bands' ? { ...i, options: i.options.filter((o) => o[0] !== '2') } : i)) }
        : registry.getDefinition(id)),
    }
    expect(applyOffer(BANDS2, { settings: mergeChartSettings({}), registry: narrowed, isOffered: yes }))
      .toEqual({ ok: false, line: 'Session VWAP could not be added with Std dev bands: ±1σ, ±2σ, so nothing was added.' })
    expect(applyOffer(BANDS2, { settings: withVwap(), registry: narrowed, isOffered: yes }))
      .toEqual({ ok: false, line: 'Session VWAP is on this chart, and its Std dev bands setting could not be changed from here.' })
    // CONTROL: the same two taps with the real registry write
    expect(applyOffer(BANDS2, { settings: mergeChartSettings({}), registry, isOffered: yes }).ok).toBe(true)
    expect(applyOffer(BANDS2, { settings: withVwap(), registry, isOffered: yes }).ok).toBe(true)
  })

  it('a value this window\'s own registry does not declare for the input is no offer (the words are read there)', () => {
    const real = registry.getDefinition('vwap')
    const spy = vi.spyOn(registry, 'getDefinition').mockImplementation((id) => (id === 'vwap'
      ? { ...real, inputs: real.inputs.map((i) => (i.key === 'bands' ? { ...i, options: i.options.filter((o) => o[0] !== '2') } : i)) }
      : null))
    try {
      expect(liveOffer(BANDS2)).toBeNull()
      expect(liveOffer({ ...BANDS2, inputs: { bands: '1' } }).label).toBe('Add Session VWAP with Std dev bands: ±1σ to this chart')
    } finally { spy.mockRestore() }
    expect(liveOffer(BANDS2)).not.toBeNull()
  })

  it('asks again whether this build offers it, and writes nothing when it does not', () => {
    expect(applyOffer(BANDS2, { settings: mergeChartSettings({}), registry, isOffered: no }))
      .toEqual({ ok: false, line: 'Session VWAP is not offered on this chart right now, so nothing was added.' })
  })

  it('the wire keeps the one input, and an offer whose inputs do not read is no offer at all', async () => {
    const state = newAuthoringState()
    expect(offerOf({ offer: { ...BANDS2, name: 'x', label: 'y', extra: 1 } })).toEqual({ offer: BANDS2 })
    for (const bad of [null, 'bands', ['bands'], {}, { bands: 2 }, { bands: '' }, { bands: 'x'.repeat(OFFER_INPUTS_LIMITS.maxChars + 1) },
      Object.fromEntries(Array.from({ length: OFFER_INPUTS_LIMITS.max + 1 }, (_v, i) => [`k${i}`, '1']))]) {
      expect(offerOf({ offer: { ...BANDS2, inputs: bad } }), JSON.stringify(bad)).toEqual({})
    }
    const answer = async () => ({
      ok: true, disposition: 'answer', reply: 'Session VWAP draws them itself.', turn: 'offer',
      envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply: 'Session VWAP draws them itself.' },
      notUnderstood: [], unavailable: [], offer: BANDS2,
    })
    const turn = await modelTurn(state, () => state, 'VWAP with 2 standard deviation bands', { converse: answer })
    expect(turn.entries[0].offer).toEqual({
      kind: 'add_built_in', indicator: 'vwap', name: 'Session VWAP', inputs: { bands: '2' },
      label: 'Add Session VWAP with Std dev bands: ±1σ, ±2σ to this chart',
    })
    // this build tells the door it can add Session VWAP
    expect(converseBody({ message: 'x', state, gateCtx: { builtIns: offerableBuiltIns({ registry, isOffered: yes }) } }).addable).toContain('vwap')
  })
})

describe('rule 3: a restored conversation offers nothing', () => {
  it('the words come back; the button does not', () => {
    const offer = liveOffer(RATING)
    const kept = { transcript: [
      { id: 0, role: 'member', text: 'Add the RS Rating' },
      { id: 1, role: 'uct', kind: 'answer', reply: 'It is one of UCT\'s own indicators.', lines: ['It is one of UCT\'s own indicators.'], offer },
    ] }
    const back = initialTranscript(kept)
    expect(back).toHaveLength(2)
    expect(back[1].lines).toEqual(['It is one of UCT\'s own indicators.'])
    expect('offer' in back[1]).toBe(false)
    expect(kept.transcript[1].offer).toBe(offer)                           // the stored copy is not edited in place
    expect(withoutOffer(back[0])).toBe(back[0])
    expect(withoutOffer(null)).toBeNull()
  })
})
