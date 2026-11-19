// The regular session's own values, through the member's door: the assistant's patch is applied by
// the browser, read back in plain words, named in plain words, and DRAWN with the reader's numbers.
//
// The server's door accepts these trees (`tests/test_converse_session_functions.py`). This is the
// half that runs after it has answered ok: on 2026-11-17 a position size calculator was accepted
// there and refused here, and a member read a red error. A new function is proved on both sides.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newAuthoringState } from './index'
import { modelTurn } from './authoringSession'
import { keepAssistantName, keepAssistantLabel } from './readableName'
import { computeHeadless } from '../../engine/headlessCompute.js'
import { computeSessionRegular } from '../../indicators.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..', '..', '..', '..', '..')
const replay = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'alerts', 'replay_bars.json'), 'utf8'))
const NVDA = replay.fixtures.nvda_5m_extended.bars

const PATCH = 'uct.authoring.patch/1'
const num = (value) => ({ type: 'num', value })
const s = (name) => ({ type: 'series', name })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const reply = (state, ops) => ({
  ok: true, turn: 'patch', disposition: 'change', reply: 'done', notUnderstood: [], unavailable: [],
  envelope: { contract: PATCH, baseRevision: state.revision || 0, ops, assumptions: [], disposition: 'change', reply: 'done' },
})
const OPENING_RANGE = [{ op: 'create', name: 'Opening Range (30 min)', placement: 'price', outputs: [
  { key: 'orHigh', label: 'Opening Range High', tree: call('openingRangeHigh', num(30)) },
  { key: 'orLow', label: 'Opening Range Low', tree: call('openingRangeLow', num(30)) },
  { key: 'dayHigh', label: 'High of Day', tree: call('sessionHigh') },
  { key: 'open', label: 'Today Open', tree: call('sessionOpen') },
  { key: 'breakout', label: 'Range Breakout', tree: op('>', s('close'), call('openingRangeHigh', num(30))) },
] }]
const clean = (col) => Array.from(col, (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null))

async function build(ops) {
  const st = newAuthoringState()
  return modelTurn(st, () => st, 'the opening range of the first 30 minutes, the high of day and today\'s open', {
    converse: async () => reply(st, ops), keepCreateName: keepAssistantName, keepCreateLabel: keepAssistantLabel })
}

describe('the assistant\'s opening range is applied, read back and named', () => {
  it('the browser applies the patch the server accepted', async () => {
    const out = await build(OPENING_RANGE)
    expect(out.changed, JSON.stringify(out.entries).slice(0, 400)).toBe(true)
    expect(out.state.working.plots.map((p) => p.key)).toEqual(['orHigh', 'orLow', 'dayHigh', 'open', 'breakout'])
  })

  it('reads back in a member\'s words, and the derived labels are words too', async () => {
    const out = await build(OPENING_RANGE)
    const lines = out.entries.flatMap((e) => e.lines || []).join('\n')
    expect(lines).toContain('the highest price of the first 30 minutes of the regular session')
    expect(lines).toContain('the lowest price of the first 30 minutes of the regular session')
    expect(lines).toContain('the highest price of the regular session so far')
    expect(lines).toContain('the regular session\'s opening price')
    expect(lines).not.toMatch(/OPENINGRANGE|SESSIONHIGH|openingRangeHigh|sessionHigh/)
    // readable derived labels stay (they follow the maths); none is formula text
    const labels = Object.fromEntries(out.state.working.plots.map((p) => [p.key, p.label]))
    expect(labels.orLow).toBe('Opening range low 30')
    expect(labels.dayHigh).toBe('Session high')
    expect(labels.open).toBe('Session open')
  })

  it('a number in it is a setting: "make it 15" moves both lines', async () => {
    const made = await build(OPENING_RANGE)
    const view = made.state
    const edited = await modelTurn(view, () => view, 'make it 15', {
      converse: async () => reply(view, [{ op: 'set_slot', slot: 'orHigh#0', value: 15 }, { op: 'set_slot', slot: 'orLow#0', value: 15 }]),
      keepCreateName: keepAssistantName, keepCreateLabel: keepAssistantLabel })
    expect(edited.changed, JSON.stringify(edited.entries).slice(0, 400)).toBe(true)
    const labels = Object.fromEntries(edited.state.working.plots.map((p) => [p.key, p.label]))
    expect(labels.orLow).toBe('Opening range low 15')
  })
})

describe('…and what is drawn is the reader\'s own number', () => {
  it('on a 5-minute chart every line equals the native reader, bar for bar', async () => {
    const made = await build(OPENING_RANGE)
    const out = computeHeadless(made.state.working, NVDA, { tf: '5' })
    expect(out.refusal, JSON.stringify(out.refusal)).toBeUndefined()
    const got = Object.fromEntries(out.outputs.map((o) => [o.key, clean(o.values)]))
    expect(got.orHigh).toEqual(clean(computeSessionRegular(NVDA, '5', 'high', 30)))
    expect(got.orLow).toEqual(clean(computeSessionRegular(NVDA, '5', 'low', 30)))
    expect(got.dayHigh).toEqual(clean(computeSessionRegular(NVDA, '5', 'high')))
    expect(got.open).toEqual(clean(computeSessionRegular(NVDA, '5', 'open')))
    expect(got.orHigh.some((v) => v !== null)).toBe(true)
    expect(got.breakout.filter((v) => v === 1).length).toBeGreaterThan(0)
  })

  it('on a 60-minute chart the opening range is withheld BY NAME, in a member\'s words, plot by plot', async () => {
    const hourly = replay.fixtures.hourly_open_60m.bars
    const made = await build(OPENING_RANGE)
    const out = computeHeadless(made.state.working, hourly, { tf: '60' })
    expect(out.outputs).toBeNull()
    expect(out.refusal.code).toBe('opening-range:bars-longer')
    expect(out.refusal.message).toMatch(/longer than the opening range this indicator asks for/)
    expect(out.refusal.message).toMatch(/What would settle it here: a chart timeframe whose bars are no longer than the range/)
    expect(out.refusal.message).not.toMatch(/periodseconds|openingRangeHigh|NaN/)
    // exactly the three lines that read the range are named; the session's own two are not
    expect(Object.keys(out.refusal.plots).sort()).toEqual(['breakout', 'orHigh', 'orLow'])
  })

  it('the session\'s own lines draw on a 60-minute chart (they need no range to divide)', async () => {
    const hourly = replay.fixtures.hourly_open_60m.bars
    const st = newAuthoringState()
    const ops = [{ op: 'create', name: 'High of Day', placement: 'price', outputs: [
      { key: 'dayHigh', tree: call('sessionHigh') }, { key: 'dayLow', tree: call('sessionLow') }] }]
    const made = await modelTurn(st, () => st, 'high and low of day', { converse: async () => reply(st, ops) })
    const out = computeHeadless(made.state.working, hourly, { tf: '60' })
    expect(out.refusal, JSON.stringify(out.refusal)).toBeUndefined()
    const got = Object.fromEntries(out.outputs.map((o) => [o.key, clean(o.values)]))
    expect(got.dayHigh).toEqual(clean(computeSessionRegular(hourly, '60', 'high')))
    expect(got.dayLow).toEqual(clean(computeSessionRegular(hourly, '60', 'low')))
    expect(got.dayHigh.some((v) => v !== null)).toBe(true)
  })
})
