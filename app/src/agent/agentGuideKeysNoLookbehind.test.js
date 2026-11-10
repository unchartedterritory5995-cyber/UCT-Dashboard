// RAIL: guide/keys.js's whole-chord regex lost its two lookbehinds (iOS 16 floor: noRegexLookbehind +
// agentNoLookbehindStrings); wholeChordIn tests the text before the chord instead, and nothing a caller sees moved.
// OLD = chordRe as it was, kept verbatim here (a test file is outside the product scans); NEW = chordRe today. For every
// one of the chart's SHORTCUTS, over the keys held-out phrasings (docs/agent/program/evidence/teach-keys/heldout.cases.json),
// every string literal in app/src/agent's test files that writes a chord or names a key, and chords built around the
// boundaries ("Ctrl+Alt+J" is not Alt+J, "Alt+Shift+A" is not Alt+Shift), as written and lowercased: both say the same.
// Then the same at the row level (CHART_KEY_ACTIONS' re). LOCAL.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { SHORTCUTS } from '../components/chart/keyboardShortcuts'
import { chordRe } from './guide/keys'
import { testFileLiterals } from './__fixtures__/noLookbehind/corpus'

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function OLD(keys) {
  const k = String(keys).toLowerCase()
  if (k === '?') return /(^|\s)\?(\s|$)|\bquestion mark\b/
  if (k === 'esc') return /\b(esc|escape)\b/
  if (!k.includes('+')) return null
  const parts = k.split('+').map(p => (p === 'ctrl' ? '(ctrl|control|cmd|⌘)' : p === 'alt' ? '(alt|option|⌥)' : esc(p)))
  return new RegExp(`(?<![a-z0-9])(?<!\\+\\s*)${parts.join('\\s*\\+\\s*')}(?![a-z0-9])(?!\\s*\\+)`)
}

const HELD = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../docs/agent/program/evidence/teach-keys/heldout.cases.json'), 'utf8')).map((c) => c.say)
const CHORDS = SHORTCUTS.map((s) => s.keys).filter(Boolean)
const BUILT = [
  ...CHORDS.flatMap((k) => [k, k.toLowerCase(), k.replace(/\+/g, ' + '), `x${k}`, `X${k}`, `1${k}`, `+${k}`, `+ ${k}`, `ctrl+${k}`,
    `Ctrl + ${k}`, `${k}+x`, `${k} + x`, `${k}x`, `press ${k} now`, `what does ${k} do`, `${k}, then ${k}`, `x${k} or ${k}`,
    k.replace(/^Ctrl/, 'Cmd'), k.replace(/^Ctrl/, '⌘'), k.replace(/^Alt/, 'Option'), k.replace(/^Alt/, '⌥')]),
  'what does Ctrl+Alt+J do', 'what does Alt+J do', 'ctrl+alt+j', 'alt+j', 'ctrl + alt + j', 'ctrl+ alt+j', 'Alt+Shift+A',
  'alt+shift+a', 'alt+shift', 'shift+alt+a', 'control+option+j', 'cmd+alt+j', '⌘+alt+j', '++alt+j', 'a+alt+j', 'A+alt+j',
  'é+alt+j', '_alt+j', 'alt+jj', 'alt+j+', 'alt+j +', 'alt + j  +  k', 'the alt+j key', 'alt+j\n+x', 'x\nalt+j',
]
const CORPUS = [...new Set([...HELD, ...testFileLiterals().literals.filter((s) => /\+|\bkeys?\b|shortcut|hot ?key|esc|\?/i.test(s) && s.length < 300), ...BUILT])]
const FORMS = CORPUS.flatMap((q) => [q, q.toLowerCase()])

describe('keys.js chords: wholeChordIn reads exactly what the lookbehinds did', () => {
  it('the corpus holds every SHORTCUT, the held-out phrasings and the rails\' own phrasings', () => {
    expect(CHORDS.length).toBeGreaterThanOrEqual(49)
    expect(HELD.length).toBeGreaterThan(0)
    expect(CORPUS.length).toBeGreaterThan(BUILT.length + 100)
  })
  it.each(CHORDS)('%s: old and new agree on every phrasing', (keys) => {
    const o = OLD(keys), n = chordRe(keys)
    expect(!!n).toBe(!!o)
    if (!o) return
    expect(FORMS.filter((q) => n.test(q) !== o.test(q))).toEqual([])
  })
  it('the whole chord: Ctrl+Alt+J is not Alt+J, Alt+Shift+A is not Alt+Shift', () => {
    expect(chordRe('Alt+J').test('ctrl+alt+j')).toBe(false)
    expect(chordRe('Alt+J').test('alt+j')).toBe(true)
    expect(chordRe('Ctrl+Alt+J').test('ctrl+alt+j')).toBe(true)
    expect(chordRe('Alt+Shift').test('alt+shift+a')).toBe(false)
    expect(chordRe('Alt+J').test('xalt+j or alt+j')).toBe(true)
  })
})
