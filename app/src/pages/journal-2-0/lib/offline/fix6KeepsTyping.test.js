/**
 * ⛔⛔ Q1 FIX 6 — DOES THE GUARD DROP WORDS THE MEMBER IS STILL TYPING?
 *
 * `discardsUnsentWork` documents itself as DIRECTIONAL:
 *
 *     @returns true when `prev` is carrying words `incoming` does not have
 *
 * and is implemented as SYMMETRIC inequality:
 *
 *     return !sameAuthoredContent(incoming, prev)
 *
 * Those are different questions, and the difference is the member typing. Once a
 * note is dirty, every further keystroke makes `incoming` differ from `prev` —
 * in the direction where incoming has MORE, not less. `persist` then does
 * `source = unsentWork ? prev : state` and writes `prev`, so the newer words
 * never reach the durable copy.
 *
 * ⚠️ WHY THE RIG DID NOT CATCH THIS. Every F5 cell types its sentinel in ONE
 * burst, which a single debounce window captures while the record is still
 * clean. The failure needs a note that is ALREADY dirty when the typing starts —
 * which is exactly the state `append_document_excerpt`'s setup leaves behind,
 * and why that cell alone failed reproducibly.
 *
 * These tests are written to FAIL if the defect is real. They are the control
 * for a claim, not a fix.
 */
import { describe, it, expect } from 'vitest'
import { discardsUnsentWork, sameAuthoredContent } from './recoverLocalState'

const doc = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const record = (text, dirty = 1) => ({
  title: 'n', subtitle: '', bodyJson: doc(text), dirty,
})

describe('fix 6 · the guard vs a member who keeps typing', () => {
  it('a CLEAN prev is never treated as unsent work', () => {
    expect(discardsUnsentWork(record('hello', 0), record('hello world'))).toBe(false)
    expect(discardsUnsentWork(null, record('hello'))).toBe(false)
  })

  it('⛔ THE REAL CASE: prev is dirty and the member typed MORE on top of it', () => {
    const prev = record('the member wrote this offline')
    const incoming = record('the member wrote this offline and then kept typing')
    // The member has ADDED words. Nothing of prev's is being discarded — the
    // incoming copy contains prev's text in full. A guard whose job is "would
    // this write discard unsent work?" must answer NO.
    expect(discardsUnsentWork(prev, incoming)).toBe(false)
  })

  it('still answers YES when incoming genuinely drops the unsent words', () => {
    const prev = record('the member wrote this offline')
    const serverEcho = record('the title only, as the server had it')
    expect(discardsUnsentWork(prev, serverEcho)).toBe(true)
  })

  it('answers YES when incoming is a strict SUBSET (a truncation)', () => {
    const prev = record('a long sentence the member typed')
    const truncated = record('a long sentence')
    expect(discardsUnsentWork(prev, truncated)).toBe(true)
  })

  it('sameAuthoredContent itself is symmetric — that is fine, the CALLER is not', () => {
    const a = record('one')
    const b = record('one two')
    expect(sameAuthoredContent(a, b)).toBe(sameAuthoredContent(b, a))
    expect(sameAuthoredContent(a, b)).toBe(false)
  })
})
