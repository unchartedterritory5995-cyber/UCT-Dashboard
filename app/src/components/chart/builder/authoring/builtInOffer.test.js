// app/src/components/chart/builder/authoring/builtInOffer.test.js
//
// AN ANSWER THAT OFFERS AN ACTION (`builtInOffer.js`): the three rules, and the wire around them.
// The door half is `tests/test_named_built_ins.py`.

import { describe, it, expect, vi } from 'vitest'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { BUILT_IN_NAMES } from './checkedLibrary'
import { offerableBuiltIns, liveOffer, withoutOffer, applyOffer, OFFER_ADD_BUILT_IN } from './builtInOffer'
import { converseBody, converseTurn, offerOf, builtInIds, ACCEPTS, BUILT_INS_LIMITS } from './converseClient'
import { modelTurn, initialTranscript } from './authoringSession'
import { newAuthoringState } from './index'

const yes = () => true
const no = () => false
const RATING = { kind: OFFER_ADD_BUILT_IN, indicator: 'rsRating' }
const instancesOf = (cs, defId) => (cs.indicatorInstances || []).filter((i) => i.defId === defId)

describe('the library names that are UCT\'s own built-in indicators', () => {
  it('each names a definition of this registry, by the registry\'s own name', () => {
    expect(BUILT_IN_NAMES.map((b) => b.id)).toEqual(['mansfield_relative_strength', 'rs_rating', 'rs_phases'])
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
    expect(asked.sort()).toEqual(['rsMansfield', 'rsPhases', 'rsRating'])
    expect(offerableBuiltIns({ registry, isOffered: yes })).toEqual(['rsMansfield', 'rsRating', 'rsPhases'])
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
