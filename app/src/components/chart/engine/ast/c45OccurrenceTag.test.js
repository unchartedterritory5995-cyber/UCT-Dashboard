// C45 item 8 — `valuewhenOccurrence` is tagged `occurrence_dependent`.
//
// The Python half (`tests/test_c45_occurrence_tag.py`) proves the five
// comparability consumers refuse the general read and that a period anchor is
// not tagged. This file is the JS half, and its subject is what did NOT move:
// the chart pane. The pane is not a comparability consumer; the tag must cost it
// nothing — no badge, no refusal, and the anchors `time("W")` translates to are
// still built.
//
// Both languages read ONE table (`closedTable.json`); every expectation below is
// read off that table or off the translator, never restated.
import { describe, it, expect } from 'vitest'
import {
  TABLE, hostAdmissible, requirementNotesOf, REQUIREMENT_NOTES,
} from './parse.js'
import { translatePine, PINE_INEXPRESSIBLE } from './pine.js'

const TAG = 'occurrence_dependent'
const COMPARABILITY = ['screener', 'sweep', 'alert', 'share', 'listing']

const script = (expr) => `//@version=6\nindicator("x")\nplot(${expr})\n`

function callNames(node, out = new Set()) {
  if (Array.isArray(node)) { node.forEach((n) => callNames(n, out)); return out }
  if (!node || typeof node !== 'object') return out
  if (node.type === 'call' && typeof node.name === 'string') out.add(node.name)
  for (const v of Object.values(node)) callNames(v, out)
  return out
}

describe('C45 — the manifest tag', () => {
  const spec = TABLE._requirement_tags[TAG]

  it('names the function, the five consumers that refuse it and the one that accepts it', () => {
    expect(spec, 'the tag is gone from the table').toBeTruthy()
    expect(spec.calls).toEqual(['valuewhenOccurrence'])
    expect([...spec.refused_by].sort()).toEqual([...COMPARABILITY].sort())
    expect(spec.accepted_by).toEqual(['pane'])
    // The entry it names really is the series-lookback one.
    expect(TABLE.functions.valuewhenOccurrence.lookback).toBe('series')
  })

  it('every series-lookback function is named by some tag — none ships uncontained', () => {
    const tagged = new Set()
    for (const [name, s] of Object.entries(TABLE._requirement_tags)) {
      if (name.startsWith('_') || !s || typeof s !== 'object') continue
      for (const c of s.calls || []) tagged.add(c)
    }
    const series = Object.entries(TABLE.functions)
      .filter(([, s]) => s && s.lookback === 'series').map(([k]) => k)
    // non-vacuity: the roster this is about is not empty
    expect(series).toContain('valuewhenOccurrence')
    expect(series.filter((k) => !tagged.has(k))).toEqual([])
  })

  it('the function is NOT added to the running-total tag — its sentence would be false of it', () => {
    expect(TABLE._requirement_tags.window_dependent.calls).not.toContain('valuewhenOccurrence')
  })
})

describe('C45 — the chart pane is not a comparability consumer', () => {
  it('the pane accepts the function (the manifest-derived host set carries it)', () => {
    expect(hostAdmissible(TABLE).has('valuewhenOccurrence')).toBe(true)
  })

  it('no pane badge is owed: the tag declares no member sentence, so the disclosure reader yields nothing', () => {
    expect(TABLE._requirement_tags[TAG].memberNote).toBeUndefined()
    expect(Object.keys(requirementNotesOf(TABLE))).not.toContain(TAG)
    expect(Object.keys(REQUIREMENT_NOTES)).not.toContain(TAG)
    // control: the reader does see a tag that declares a sentence
    expect(Object.keys(REQUIREMENT_NOTES)).toContain('window_dependent')
  })

  it('`ta.valuewhen(cond, src, n)` still translates on the host lane, to the occurrence function', () => {
    const out = translatePine(script('ta.valuewhen(close > open, close, 1)'), { strict: true })
    expect(out.ok, out.refusal && out.refusal.message).toBe(true)
    expect(callNames(out.outputs).has('valuewhenOccurrence')).toBe(true)
  })

  it.each(['W', 'M', '3M', '12M'])(
    'the period anchor `time("%s")` is still built on the host lane',
    (tf) => {
      const out = translatePine(script(`time("${tf}")`), { strict: true })
      expect(out.ok, out.refusal && out.refusal.message).toBe(true)
      // The anchor IS a `valuewhenOccurrence` tree; tagging the function did not
      // remove it from the lane the tag accepts.
      expect(callNames(out.outputs).has('valuewhenOccurrence')).toBe(true)
    },
  )
})

describe('C45 — the translate door, stated as it is', () => {
  it('the table name written directly refuses for a screen with the tag’s own reason', () => {
    const out = translatePine(script('ta.valuewhenOccurrence(close > open, close, 1)'))
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:function')
    expect(out.refusal.message).toContain(PINE_INEXPRESSIBLE.valuewhenOccurrence)
    // …and the bare spelling does not get through either
    const bare = translatePine(script('valuewhenOccurrence(close > open, close, 1)'))
    expect(bare.ok).toBe(false)
    expect(bare.refusal.guard).toBe('pine:function')
  })

  it('Pine’s own spelling still translates in the default mode (PR #166); the consumers refuse it one door later', () => {
    // ⚠️ PINNED AS A FACT, NOT AS A GOAL — § C45 decision 12. The saved
    // definition is stamped `occurrence_dependent` and the screener, the sweep,
    // an alert, a share and a listing refuse it by name
    // (`tests/test_c45_occurrence_tag.py`). If the integrator rules that the
    // translate door must refuse it too, this is the test that moves.
    const out = translatePine(script('ta.valuewhen(close > open, close, 1)'))
    expect(out.ok, out.refusal && out.refusal.message).toBe(true)
    expect(callNames(out.outputs).has('valuewhenOccurrence')).toBe(true)
  })

  it('the bar-window `valuewhen` the refusal points to is a different, untagged function', () => {
    expect(TABLE.functions.valuewhen.lookback).not.toBe('series')
    for (const [name, s] of Object.entries(TABLE._requirement_tags)) {
      if (name.startsWith('_') || !s || typeof s !== 'object') continue
      expect(s.calls || [], `${name} names the bar-window valuewhen`).not.toContain('valuewhen')
    }
  })
})
