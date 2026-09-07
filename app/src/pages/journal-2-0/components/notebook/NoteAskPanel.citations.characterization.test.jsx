import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NoteAskPanel, { jumpToNoteText } from './NoteAskPanel'

// ─────────────────────────────────────────────────────────────────────────
// WAVE K SLICE 0 — CHARACTERIZATION RAIL, NOT AN ENDORSEMENT.
//
// These tests document what the CURRENT Ask Current Note citation affordance
// actually does, so the typed/validated citation system that replaces it can
// be measured against a recorded baseline instead of a memory of one.
//
// The current contract (note_ask.SYNTH_SYSTEM + NoteAskPanel.jsx):
//   - the model is asked to quote short exact phrases in "double quotes"
//   - NoteAskPanel applies /"([^"]{3,200})"/g to the ANSWER TEXT
//   - every match renders as a clickable citation chip
//   - clicking calls jumpToNoteText(dom, quote), which returns true/false
//   - ⛔ THE RETURN VALUE IS DISCARDED (`onCitationClick` ignores it)
//
// So "is this a citation?" is decided by punctuation in model output, and
// "did the citation resolve?" is never asked. Every test below marked
// ⛔ BASELINE DEFECT asserts behaviour that MUST become impossible once
// citations are backend-authorized handles validated against retrieved
// evidence. When that lands, those assertions get inverted in the same
// commit — the diff is the proof the defect closed.
//
// Nothing here is a regression rail for the current behaviour. Do not
// "fix" a failure in this file by making the new system behave like the
// old one.
// ─────────────────────────────────────────────────────────────────────────

function sseBody(events) {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
}

function mockAnswer(text) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, body: sseBody([{ type: 'delta', text }]),
  })
}

// jsdom implements no layout, so Element.scrollIntoView is undefined — and
// jumpToNoteText calls it on the SUCCESS path only. Without this stub every
// case where resolution WORKS throws, which inverts the signal: the passing
// tests would be the broken citations. Sibling NoteAskPanel.test.jsx stubs it
// per-element; this file stubs the prototype because several cases resolve
// against elements the test never names.
beforeEach(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}
})

/** A stand-in for the note's rendered TipTap DOM. `html` is the note body as
 * the editor would have painted it — including, where relevant, the mark
 * splitting TipTap really produces. */
function noteDom(html) {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

async function askWith(answerText, dom) {
  mockAnswer(answerText)
  render(<NoteAskPanel noteId="n1" getEditorDom={() => dom} />)
  fireEvent.click(screen.getByRole('button', { name: /ask a question about this note/i }))
  fireEvent.change(screen.getByPlaceholderText(/what did i say about/i), {
    target: { value: 'what did I say about margins' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
  await screen.findByTestId('note-ask-answer')
}

/** Every chip the panel decided to render as a citation. */
function chips() {
  return screen.queryAllByRole('button', { name: /^Jump to this in the note:/ })
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { delete global.fetch; document.body.innerHTML = '' })

describe('Ask Current Note citations — recorded baseline (Wave K Slice 0)', () => {
  it('CASE 1 — a real verbatim quote renders a chip AND resolves (the only case that fully works)', async () => {
    const dom = noteDom('<p>Management said gross margins compressed in Q3.</p>')
    await askWith('The note says "gross margins compressed" this quarter.', dom)

    expect(chips()).toHaveLength(1)
    // Resolution is asserted directly, because the panel never checks it.
    expect(jumpToNoteText(dom, 'gross margins compressed')).toBe(true)
  })

  it('CASE 2 ⛔ BASELINE DEFECT — an INVENTED quote renders a chip indistinguishable from a real one, and resolves to nothing', async () => {
    const dom = noteDom('<p>Management said gross margins compressed in Q3.</p>')
    await askWith('The note says "revenue guidance was raised to $185 billion".', dom)

    // The model fabricated this phrase. It is not in the note at all.
    expect(jumpToNoteText(dom, 'revenue guidance was raised to $185 billion')).toBe(false)
    // ...and yet:
    expect(chips()).toHaveLength(1)
    // Clicking it does nothing, silently. No error, no feedback, no signal
    // to the member that the citation is fabricated.
    expect(() => fireEvent.click(chips()[0])).not.toThrow()
  })

  it('CASE 3 ⛔ BASELINE DEFECT — ordinary quoted language that is not a citation still becomes a citation chip', async () => {
    const dom = noteDom('<p>Management said gross margins compressed in Q3.</p>')
    // Nothing here is a claim about the note; the quotes are scare quotes and
    // a restatement of the member's own question.
    await askWith('You asked "what did I say about margins" — the note is not written in a "bull case" register.', dom)

    // Two chips, neither of which is a citation of anything.
    expect(chips()).toHaveLength(2)
    expect(jumpToNoteText(dom, 'what did I say about margins')).toBe(false)
    expect(jumpToNoteText(dom, 'bull case')).toBe(false)
  })

  it('CASE 4 ⛔ BASELINE DEFECT — a repeated phrase is ambiguous, and resolution silently picks the FIRST occurrence', async () => {
    const dom = noteDom(
      '<p id="a">Revenue was strong.</p>'
      + '<p id="b">Revenue guidance was raised.</p>'
      + '<p id="c">Revenue remains the focus.</p>',
    )
    await askWith('The note says "Revenue" three times.', dom)

    expect(chips()).toHaveLength(1)
    // It "resolves" — but to the first match, with no way for the citation to
    // name WHICH occurrence it meant. A typed citation carries an offset or
    // an anchor; a bare phrase cannot.
    const scrolled = []
    for (const el of dom.querySelectorAll('p')) {
      el.scrollIntoView = () => scrolled.push(el.id)
    }
    expect(jumpToNoteText(dom, 'Revenue')).toBe(true)
    expect(scrolled).toEqual(['a'])
  })

  it('CASE 5 ⛔ BASELINE DEFECT — a punctuation/normalization mismatch renders a chip that cannot resolve', async () => {
    // The note uses a typographic apostrophe and an em dash; the model
    // reproduces them as ASCII. This is ordinary model normalization, not a
    // hallucination — the member DID write this — but exact `includes()`
    // matching cannot see it.
    const dom = noteDom('<p>Management’s view — margins normalize lower.</p>')
    await askWith("The note says \"Management's view - margins normalize lower\".", dom)

    expect(chips()).toHaveLength(1)
    expect(jumpToNoteText(dom, "Management's view - margins normalize lower")).toBe(false)
  })

  it('CASE 6 ⛔ BASELINE DEFECT — a quote spanning two DOM nodes cannot resolve, which is the COMMON case in a real note', async () => {
    // TipTap splits marks into separate text nodes, so any phrase crossing a
    // bold/italic/link boundary lives in two nodes. jumpToNoteText walks text
    // nodes individually and tests `includes()` on each, so it can never
    // match across the boundary — the phrase is genuinely, verbatim in the
    // member's note and the citation still dead-ends.
    const dom = noteDom('<p>Management expects <strong>gross margins</strong> to normalize lower.</p>')
    await askWith('The note says "expects gross margins to normalize".', dom)

    expect(chips()).toHaveLength(1)
    expect(jumpToNoteText(dom, 'expects gross margins to normalize')).toBe(false)
    // The unsplit halves each resolve on their own, proving the phrase really
    // is present and only the node boundary defeats it.
    expect(jumpToNoteText(dom, 'Management expects')).toBe(true)
    expect(jumpToNoteText(dom, 'gross margins')).toBe(true)
  })

  it('BASELINE SUMMARY — of six representative cases, exactly ONE both renders and resolves', async () => {
    const dom = noteDom('<p>Management expects <strong>gross margins</strong> to normalize lower in Q3.</p>')
    const cases = [
      ['normalize lower', true],                          // 1 verbatim, single node
      ['revenue guidance was raised', false],             // 2 invented
      ['bull case', false],                               // 3 not a citation
      ['expects gross margins to normalize', false],      // 6 crosses a mark boundary
      ["Management’s view", false],                  // 5 normalization
    ]
    for (const [phrase, expected] of cases) {
      expect(jumpToNoteText(dom, phrase), phrase).toBe(expected)
    }
  })
})
