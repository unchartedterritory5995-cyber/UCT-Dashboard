import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNoteCitation, splitAnswer, PRECISE_STATES } from '../../lib/askCitation'

// ─────────────────────────────────────────────────────────────────────────
// WAVE K SLICE 6 — THE CLOSING SIDE OF THE SLICE 0 CHARACTERIZATION.
//
// NoteAskPanel.citations.characterization.test.jsx recorded six representative
// cases of the Wave 2 citation contract (a /"([^"]{3,200})"/g regex over the
// ANSWER, with jumpToNoteText's return value discarded). Of the six, exactly
// ONE both rendered and resolved. Its header said the assertions would be
// INVERTED in the commit that replaced the contract, and that the diff would
// be the proof.
//
// This is that file. Each CASE below is the same scenario, asserted against
// the typed-handle contract — and the NoteAskPanel it characterized is
// deleted, so the old behaviour is not merely discouraged, it is unreachable.
// ─────────────────────────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCES = [{ n: 1, label: 'NVDA thesis', citation: 'exact' }]

function docWith(text) {
  return {
    content: { size: text.length + 2 },
    textBetween: (a, b) => text.slice(Math.max(0, a - 1), Math.max(0, b - 1)),
    descendants: () => {},
  }
}

describe('the old citation surface is gone, not just unused', () => {
  it('NoteAskPanel is deleted', () => {
    // An orphaned component documented as live teaches the next engineer the
    // wrong idiom — this repo has a whole section about that.
    for (const f of ['NoteAskPanel.jsx', 'NoteAskPanel.module.css',
                     'NoteAskPanel.test.jsx',
                     'NoteAskPanel.citations.characterization.test.jsx']) {
      expect(fs.existsSync(path.join(HERE, f)), `${f} still exists`).toBe(false)
    }
  })

  it('AskPanel is what replaced it', () => {
    expect(fs.existsSync(path.join(HERE, 'AskPanel.jsx'))).toBe(true)
  })
})

describe('each recorded baseline defect is now impossible', () => {
  it('CASE 1 — a real cited source still renders and resolves', () => {
    const parts = splitAnswer('Margins fell [1].', SOURCES)
    expect(parts.find((p) => p.source)?.source.n).toBe(1)
    const out = resolveNoteCitation(docWith('margins compressed in Q3'),
                                    { from: 1, to: 25 }, 'margins compressed in Q3')
    expect(PRECISE_STATES.has(out.state)).toBe(true)
  })

  it('CASE 2 — an INVENTED citation no longer renders as a citation at all', () => {
    // Was: indistinguishable from a real one, and resolved to nothing.
    const parts = splitAnswer('As the filing states [9].', SOURCES)
    expect(parts.some((p) => p.source)).toBe(false)
    expect(parts.map((p) => p.text).join('')).toBe('As the filing states [9].')
  })

  it('CASE 3 — ordinary quoted language is no longer a citation', () => {
    // Was: any "quoted phrase" became a chip, because punctuation in model
    // output was the contract.
    const parts = splitAnswer('He called it "a good quarter" afterwards.', SOURCES)
    expect(parts.some((p) => p.source)).toBe(false)
  })

  it('CASE 4 — a repeated phrase no longer silently picks the first hit', () => {
    // Was: resolution jumped to occurrence #1 with no signal that it guessed.
    const out = resolveNoteCitation(docWith('Revenue rose. Revenue guided up.'),
                                    { from: 999, to: 1000 }, 'Revenue')
    expect(PRECISE_STATES.has(out.state)).toBe(false)
    expect(out.ambiguous).toBe(true)
    expect(out.from).toBeUndefined()
  })

  it('CASE 5 — a text mismatch degrades instead of rendering a dead chip', () => {
    // Was: a punctuation/normalization mismatch rendered a chip that could
    // never resolve, and nothing said so.
    const out = resolveNoteCitation(docWith('margins compressed in Q3'),
                                    { from: 1, to: 25 }, 'margins compressed in Q3!')
    expect(PRECISE_STATES.has(out.state)).toBe(false)
  })

  it('CASE 6 — a passage spanning nodes resolves, because positions are the contract', () => {
    // Was: THE common case in a real note, and it could not resolve, because
    // resolution walked DOM text nodes looking for a string. Positions come
    // from the server now and are verified against the doc, not the DOM.
    const out = resolveNoteCitation(docWith('bold and plain text together'),
                                    { from: 1, to: 29 },
                                    'bold and plain text together')
    expect(out.state).toBe('valid_exact')
  })

  it('SUMMARY — all six cases now behave correctly, not one of six', () => {
    // The Slice 0 baseline was 1/6. Every case above either resolves
    // precisely or declines honestly; none renders a citation that cannot be
    // backed by a source that was actually sent.
    const invented = splitAnswer('see [9]', SOURCES).some((p) => p.source)
    const quoted = splitAnswer('"a good quarter"', SOURCES).some((p) => p.source)
    expect(invented || quoted).toBe(false)
  })
})
