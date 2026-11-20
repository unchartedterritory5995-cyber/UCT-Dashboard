// The drill chart's marks (the owner, 2026-11-17: "the arrow and the text/font could look much better and be a lot more of
// a cool production"): each mark's kind from its word, the sign ahead of the word, the size for the screen.
import { describe, it, expect } from 'vitest'
import { MARK_GLYPH, markKind, studyMarkLook, studyMarks } from './chartMarks'
import { markSize } from '../../../components/chart/chartMarkLayout'
import { tradeMarkers } from '../challenges/tradeMarks'

describe('markKind', () => {
  it('names each drill mark by its word', () => {
    expect(markKind({ text: 'DECISION DAY' })).toBe('decision')
    expect(markKind({ text: 'DECISION BAR' })).toBe('decision')
    expect(markKind({ text: 'BOUGHT' })).toBe('entry')
    expect(markKind({ text: 'SHORTED' })).toBe('short')
    expect(markKind({ text: '3R' })).toBe('target')
    expect(markKind({ text: '5R' })).toBe('target')
    expect(markKind({ text: '2.5R' })).toBe('target')
    expect(markKind({ text: 'STOPPED' })).toBe('stop')
    expect(markKind({ text: 'CLOSED UNDER' })).toBe('stop')
    expect(markKind({ text: 'CLOSED OVER' })).toBe('stop')
    expect(markKind({ text: '' })).toBe('dot')
    expect(markKind({})).toBe('dot')
    expect(markKind({ text: 'SOMETHING ELSE' })).toBe('note')
  })
})

describe('studyMarks', () => {
  it('gives each mark its kind and sign and keeps its time, side, colour and word', () => {
    const m = { time: '2025-01-21', position: 'belowBar', shape: 'arrowUp', color: '#dcbb5e', text: 'DECISION DAY', size: 1.2 }
    const [out] = studyMarks([m])
    expect(out).toEqual({ ...m, kind: 'decision', glyph: 'diamond' })
  })

  it('a trade reads BOUGHT with an up sign, its R marks with a tick, the stop with a cross, in their own colours', () => {
    const bars = Array.from({ length: 12 }, (_, i) => ({ t: `2025-02-${String(i + 1).padStart(2, '0')}`, o: 100, h: 101, l: 99, c: 100 }))
    const plan = { kind: 'plan', long: true, entry: 100, stop: 95, t1: 115, t2: 125, t1At: 2, t2At: 4, stoppedSession: 6, trim_r: [3, 5] }
    const out = studyMarks(tradeMarkers(plan, bars, 4))
    expect(out.map((m) => [m.text, m.kind, m.glyph, m.color])).toEqual([
      ['BOUGHT', 'entry', 'up', '#dcbb5e'], ['3R', 'target', 'check', '#2faf68'], ['5R', 'target', 'check', '#2faf68'], ['STOPPED', 'stop', 'cross', '#ef5350'],
    ])
    const short = studyMarks(tradeMarkers({ ...plan, long: false, t1At: null, t2At: null, stoppedSession: null }, bars, 4))
    expect(short.map((m) => [m.text, m.glyph])).toEqual([['SHORTED', 'down']])
  })

  it('a word-less mark (the hourly open bars, the RS session) gets no sign', () => {
    expect(studyMarks([{ time: 1, text: '', shape: 'circle', color: '#ffffff' }])[0]).toMatchObject({ kind: 'dot', glyph: null })
  })

  it('passes an empty or missing list through', () => {
    expect(studyMarks(null)).toBe(null)
    expect(studyMarks([])).toEqual([])
  })

  it('every kind with a word has a sign', () => {
    for (const k of ['decision', 'entry', 'short', 'target', 'stop']) expect(MARK_GLYPH[k]).toBeTruthy()
  })
})

describe('studyMarkLook', () => {
  it('a phone gets the phone size, never under 11 px type; a wide screen the wide one', () => {
    expect(studyMarkLook(true)).toBe('phone')
    expect(markSize(studyMarkLook(true)).font).toBeGreaterThanOrEqual(11)
    expect(studyMarkLook(false)).toBe('wide')
    expect(markSize(studyMarkLook(false)).font).toBe(12)
  })
})
