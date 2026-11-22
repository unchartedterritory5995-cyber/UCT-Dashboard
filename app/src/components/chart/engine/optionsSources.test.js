// app/src/components/chart/engine/optionsSources.test.js
//
// ⭐ 2026-11-12 — a server-owned list of choices for a `string` input (the RS
// "Pick a theme" benchmark). Pinned: the schema accepts only a LISTED source
// name; the list loads once and is shared; a failure is a state, retried on
// demand; the filter ranks a name that starts with the text first; a stored ID
// prints as its label once the list is loaded, else as words.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  OPTIONS_SOURCES, isOptionsSource, peekOptionsSource, optionLabelFor,
  humanizeOptionValue, filterOptions, cleanOptions, _resetOptionsSources,
} from './optionsSources'
import { loadOptionsSource } from '../optionsSourceLoader'
import { validateDefinition, identityTextFor } from './defSchema'
import { fieldFromInput } from '../indicatorRegistry'

beforeEach(() => { _resetOptionsSources() })

const THEMES = { options: [
  { value: 'ai_chips', label: 'AI / GPU Chips' },
  { value: 'semis', label: 'Semiconductors' },
  { value: 'chips_act', label: 'Reshoring and the CHIPS Act' },
  { value: 'cloud', label: 'Cloud Computing' },
] }
const okFetch = (body, calls = []) => (url, init) => {
  calls.push([url, init])
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

describe('the source table', () => {
  it('names the RS themes list, and nothing else is a source', () => {
    expect(Object.keys(OPTIONS_SOURCES)).toEqual(['rsThemes'])
    expect(OPTIONS_SOURCES.rsThemes.url).toBe('/api/signature/rs-themes')
    expect(isOptionsSource('rsThemes')).toBe(true)
    for (const bad of ['', 'RSTHEMES', '/api/x', 'toString', null, 7]) expect(isOptionsSource(bad), String(bad)).toBe(false)
  })

  const def = (extra) => ({
    schemaVersion: 1, id: 'p', version: 1, compute: { kind: 'server', fn: 'p', rev: 1 },
    meta: { name: 'P', category: 'Momentum', tier: 'premium', repaint: 'non-repainting' },
    placement: { target: 'pane' },
    inputs: [{ key: 'pick', type: 'string', label: 'Pick', default: '', ...extra }],
    plots: [{ key: 'line', label: 'L', style: 'line', color: '#ffffff', width: 1 }], events: [],
  })
  it('the schema accepts a listed name on a string input and refuses anything else', () => {
    expect(validateDefinition(def({ optionsSource: 'rsThemes' })).ok).toBe(true)
    const bad = validateDefinition(def({ optionsSource: 'https://evil.example/list' }))
    expect(bad.ok).toBe(false)
    expect(bad.errors.join(' ')).toMatch(/optionsSource: .* is not a known list/)
    const onEnum = validateDefinition({ ...def({}), inputs: [{ key: 'pick', type: 'enum', label: 'Pick', default: 'a',
      options: ['a'], optionsSource: 'rsThemes' }] })
    expect(onEnum.ok).toBe(false)
    expect(onEnum.errors.join(' ')).toMatch(/only a "string" input takes optionsSource/)
  })

  it('a string input naming a source is a chooser field, never a text box', () => {
    const f = fieldFromInput({ key: 'themeBenchmark', type: 'string', label: 'Theme', optionsSource: 'rsThemes',
      pattern: '^[a-z]+$', placeholder: 'Search themes' })
    expect(f).toMatchObject({ type: 'pick', optionsSource: 'rsThemes', placeholder: 'Search themes', pattern: '^[a-z]+$' })
    expect(fieldFromInput({ key: 'c', type: 'string', label: 'C' }).type).toBe('text')
  })
})

describe('loading', () => {
  it('fetches once, shares the answer, and keeps only clean entries', async () => {
    const calls = []
    const fetchImpl = okFetch({ options: [...THEMES.options, { value: '', label: 'x' }, { value: 'semis', label: 'dup' }, 7] }, calls)
    const [a, b] = await Promise.all([loadOptionsSource('rsThemes', { fetchImpl }), loadOptionsSource('rsThemes', { fetchImpl })])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['/api/signature/rs-themes', { credentials: 'include' }])
    expect(a).toBe(b)
    expect(a.map((o) => o.value)).toEqual(['ai_chips', 'semis', 'chips_act', 'cloud'])
    expect(peekOptionsSource('rsThemes').status).toBe('ready')
    await loadOptionsSource('rsThemes', { fetchImpl })
    expect(calls).toHaveLength(1)
  })

  it('a failure is a state, retried only when forced or after the wait', async () => {
    let n = 0
    let clock = 1000
    const now = () => clock
    const failing = () => { n += 1; return Promise.resolve({ ok: false, status: 503 }) }
    expect(await loadOptionsSource('rsThemes', { fetchImpl: failing, now })).toEqual([])
    expect(peekOptionsSource('rsThemes').status).toBe('error')
    await loadOptionsSource('rsThemes', { fetchImpl: failing, now })
    expect(n).toBe(1)
    clock += 15001
    await loadOptionsSource('rsThemes', { fetchImpl: failing, now })
    expect(n).toBe(2)
    const got = await loadOptionsSource('rsThemes', { force: true, fetchImpl: okFetch(THEMES) })
    expect(got).toHaveLength(4)
    expect(peekOptionsSource('rsThemes').status).toBe('ready')
  })

  it('an unknown source never fetches', async () => {
    const calls = []
    expect(await loadOptionsSource('nope', { fetchImpl: okFetch(THEMES, calls) })).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('cleanOptions reads only {value, label} strings', () => {
    expect(cleanOptions(null)).toEqual([])
    expect(cleanOptions({ options: [{ value: 'a' }, { value: 'b', label: 'B' }] }))
      .toEqual([{ value: 'a', label: 'a' }, { value: 'b', label: 'B' }])
  })
})

describe('the search and the label', () => {
  it('a name that starts with the text first, then a word in it, then anywhere', () => {
    const opts = cleanOptions(THEMES)
    expect(filterOptions(opts, '').map((o) => o.value)).toEqual(['ai_chips', 'semis', 'chips_act', 'cloud'])
    expect(filterOptions(opts, 'chip').map((o) => o.value)).toEqual(['ai_chips', 'chips_act'])
    expect(filterOptions(opts, 'SEMI').map((o) => o.value)).toEqual(['semis'])
    expect(filterOptions(opts, 'clo').map((o) => o.value)).toEqual(['cloud'])
    expect(filterOptions(opts, 'gpu').map((o) => o.value)).toEqual(['ai_chips'])
    expect(filterOptions(opts, 'act').map((o) => o.value)).toEqual(['chips_act'])
    expect(filterOptions(opts, 'zzz')).toEqual([])
    // a name that STARTS with the text beats one where a later word does, whatever the list order
    const two = [{ value: 'a', label: 'AI Chips' }, { value: 'b', label: 'Chips Act' }, { value: 'c', label: 'Microchips' }]
    expect(filterOptions(two, 'chi').map((o) => o.value)).toEqual(['b', 'a', 'c'])
  })

  it('a stored ID reads as its label once loaded, else as words', async () => {
    expect(optionLabelFor('rsThemes', 'ai_chips')).toBeNull()
    expect(humanizeOptionValue('semiconductor_equipment')).toBe('Semiconductor Equipment')
    expect(humanizeOptionValue('')).toBe('')
    await loadOptionsSource('rsThemes', { fetchImpl: okFetch(THEMES) })
    expect(optionLabelFor('rsThemes', 'ai_chips')).toBe('AI / GPU Chips')
    expect(optionLabelFor('rsThemes', 'gone')).toBeNull()
  })

  it('the identity text of a picked theme is its name, never its ID', async () => {
    const def = {
      inputs: [
        { key: 'benchmark', type: 'enum', options: [['SPY', 'S&P 500'], ['THEME_PICK', 'Pick a theme']] },
        { key: 'themeBenchmark', type: 'string', identityFor: 'benchmark', optionsSource: 'rsThemes',
          activeWhen: { key: 'benchmark', equals: 'THEME_PICK' }, default: '' },
      ],
    }
    expect(identityTextFor(def, 'benchmark', 'THEME_PICK', { themeBenchmark: 'ai_chips' })).toBe('Ai Chips')
    expect(identityTextFor(def, 'benchmark', 'THEME_PICK', {})).toBe('Pick a theme')
    await loadOptionsSource('rsThemes', { fetchImpl: okFetch(THEMES) })
    expect(identityTextFor(def, 'benchmark', 'THEME_PICK', { themeBenchmark: 'ai_chips' })).toBe('AI / GPU Chips')
    expect(identityTextFor(def, 'benchmark', 'SPY', { themeBenchmark: 'ai_chips' })).toBe('SPY')
  })
})
