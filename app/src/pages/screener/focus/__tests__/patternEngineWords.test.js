// Two definitions, one name. The pattern-engine filter (`pattern_engine_id`) and the base read
// (`base_structure`, named on each row's setup line) are separate detectors that share names,
// and on production they disagree about who carries them (Flat Base 269 vs 257, 79 in both;
// VCP 386 vs 58, 6 in both). So the engine filter must read as the ENGINE's verdict, never as
// the row's structure.
import { expect, test } from 'vitest'
import { whyItsHere } from '../whyItsHere'
import { focusChipLabel, patternEngineSentence, plainMeta, structureSentence } from '../plainWords'

// Shaped as /api/screener/meta ships them (filters.py): the engine's labels come from its ids.
const engine = { key: 'pattern_engine_id', label: 'Pattern Engine', type: 'enum', presets: [
  { label: 'Any' },
  { label: 'VCP', op: 'contains', value: ',vcp,' },
  { label: 'Flat Base', op: 'contains', value: ',flat_base,' },
  { label: 'Inverse Head Shoulders', op: 'contains', value: ',inverse_head_shoulders,' },
  { label: 'NR7', op: 'contains', value: ',nr7,' },
] }
const base = { key: 'base_structure', label: 'Base Structure', type: 'enum', presets: [
  { label: 'Any' },
  { label: 'Flat Base', op: 'contains', value: ',flat-base,' },
] }
const meta = [engine, base]
const why = filters => whyItsHere({ filters, metaFilters: meta, row: { ticker: 'MU' } }).items

test('the why strip says the pattern engine flagged it, not that the stock has it', () => {
  expect(why({ pattern_engine_id: { op: 'contains', value: ',vcp,' } }))
    .toEqual([{ kind: 'note', label: 'Pattern engine flagged a VCP' }])
  expect(why({ pattern_engine_id: { op: 'contains', value: ',flat_base,' } })[0].label)
    .toBe('Pattern engine flagged a flat base')
})

test('the same name from the two detectors reads as two different claims', () => {
  const eng = why({ pattern_engine_id: { op: 'contains', value: ',flat_base,' } })[0].label
  const bas = why({ base_structure: { op: 'contains', value: ',flat-base,' } })[0].label
  expect(bas).toBe(structureSentence('Flat Base'))
  expect(eng).not.toBe(bas)
  expect(eng).toMatch(/^Pattern engine flagged/)
  expect(bas).not.toMatch(/engine/i)
})

test('a saved screen whose id the meta no longer offers still names the engine', () => {
  expect(why({ pattern_engine_id: { op: 'contains', value: ',bull_flag,' } })[0].label)
    .toBe('Pattern engine flagged a bull flag')
})

test('articles follow the sound', () => {
  expect(patternEngineSentence('Inverse Head Shoulders')).toBe('Pattern engine flagged an inverse head shoulders')
  expect(patternEngineSentence('NR7')).toBe('Pattern engine flagged an NR7')
  expect(patternEngineSentence('VCP')).toBe('Pattern engine flagged a VCP')
  expect(patternEngineSentence('U and R')).toBe('Pattern engine flagged a U and R')
  expect(patternEngineSentence('', '')).toBe('Pattern engine flagged a pattern')
})

test('the chip and the drawer heading name the engine', () => {
  expect(focusChipLabel(engine, { op: 'contains', value: ',vcp,' })).toBe('Pattern engine: VCP')
  expect(focusChipLabel(base, { op: 'contains', value: ',flat-base,' })).toBe('Base Structure: Flat Base')
  const heading = plainMeta({ filters: meta }).filters.find(f => f.key === 'pattern_engine_id').label
  expect(heading).toBe('Pattern engine')
})
