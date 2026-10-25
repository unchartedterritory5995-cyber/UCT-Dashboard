// Wave 10 (Task 10.16): the formula NAME screen, the client half of plan._name_chars_ok (be fix round 2, ruling
// W10-R47, and round 3, W10-R48). A name may hold an ordinary emoji (its selector, joiner and keycap parts are judged
// by the dialect's own text-literal rule, with EVERY code point of the name a neighbour) and nothing else invisible.
// The cases are the server rail's (tests/test_widget_plan_v3.py test_formula_names_keep_a_members_emoji, and the
// round 3 additions), so the two sides refuse and accept the same names.
import { describe, it, expect } from 'vitest'
import { formulaNameCharsOk } from './widgetFormula.js'

const ACCEPTED = [
  ['❤️ wins', 'heart with VS16'],
  ['👍🏽 days', 'a skin-tone modifier'],
  ['👨‍👩‍👧 family', 'joiners between emoji'],
  ['1️⃣ setup', 'a keycap after a digit and VS16'],
  ['#⃣ tag', 'a keycap straight after #'],
  ['❤︎', 'text presentation'],
  ['❤️‍🔥 hot', 'heart on fire: VS16 then a joiner (W10-R48)'],
  ['🏳️‍🌈 flag', 'the rainbow flag (W10-R48)'],
  ['👁️‍🗨️ watch', 'eye in speech bubble, VS16 on both sides (W10-R48)'],
  ['Exit efficiency', 'plain text'],
  ['R per $', 'ASCII punctuation'],
]

const REFUSED = [
  ['️start', 'a leading selector'],
  ['a ️', 'a selector after a space'],
  ['a‍b', 'a joiner outside an emoji'],
  ['‍🔥', 'a leading joiner'],
  ['🔥‍', 'a trailing joiner'],
  ['❤️‍', 'VS16 then a joiner with nothing after (W10-R48)'],
  ['❤️‍ x', 'VS16 then a joiner then a space'],
  ['a️‍🔥', 'a selector on a letter does not license a joiner'],
  ['a⃣', 'a keycap after a letter'],
  ['Edge​', 'a zero-width space'],
  ['a⁠b', 'a word joiner'],
  ['a­b', 'a soft hyphen'],
  ['﻿a', 'a BOM'],
  ['a‮b', 'a bidi override'],
  ['a؜b', 'the Arabic letter mark'],
  ['a⁦b', 'a bidi isolate'],
  ['a b', 'an internal NBSP'],
  ['a　b', 'an ideographic space'],
  ['a\tb', 'a tab'],
  ['a\nb', 'a newline'],
  ['a b', 'a line separator'],
  ['a\u{E0100}', 'a variation selector supplement'],
]

describe('formulaNameCharsOk mirrors plan._name_chars_ok (W10-R47, W10-R48)', () => {
  it.each(ACCEPTED)('accepts %j (%s)', (name) => {
    expect(formulaNameCharsOk(name)).toBe(true)
  })

  it.each(REFUSED)('refuses %j (%s)', (name) => {
    expect(formulaNameCharsOk(name)).toBe(false)
  })

  it('a name is screened by code point: an astral emoji never splits into two halves', () => {
    expect(formulaNameCharsOk('🔥')).toBe(true)
    expect(formulaNameCharsOk('\uD83D')).toBe(false)          // a lone surrogate is refused, as plan_size_ok does
  })

  it('non-strings are refused, never a throw', () => {
    for (const bad of [null, undefined, 3, {}, []]) expect(formulaNameCharsOk(bad)).toBe(false)
  })
})
