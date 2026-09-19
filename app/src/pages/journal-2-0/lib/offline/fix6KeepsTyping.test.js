/**
 * Q1 FIX 6 — the guard vs a member who is still typing, on BOTH provenances.
 *
 * ── THE DEFECT THIS FILE FOUND ───────────────────────────────────────────────
 *
 * `discardsUnsentWork` documented itself as DIRECTIONAL and was implemented as
 * SYMMETRIC:
 *
 *     @returns true when `prev` is carrying words `incoming` does not have
 *     return !sameAuthoredContent(incoming, prev)
 *
 * Once a note is dirty, every further keystroke makes `incoming` differ from
 * `prev` — in the direction where incoming has MORE — and `persist` does
 * `source = unsentWork ? prev : state`, so it wrote `prev`. A member with unsent
 * work who kept typing had their newer words written NOWHERE. The editor kept
 * showing them; a reload did not.
 *
 * ── WHY 86 GREEN PRODUCTION CELLS COULD NOT SEE IT ───────────────────────────
 *
 * Every F5 rig cell types its sentinel in ONE burst, captured by a single
 * debounce while the record is still CLEAN. The failure needs a note ALREADY
 * dirty when typing starts — exactly what `append_document_excerpt`'s setup
 * leaves behind, which is why that ONE cell failed reproducibly across five runs
 * while everything around it passed, and spent an evening labelled an instrument
 * answer. The rig was right; the label was wrong.
 *
 * ── THE FIX: SPLIT BY PROVENANCE ─────────────────────────────────────────────
 *
 * ⚰️ The obvious single fix is WRONG and was measured to be: making the ONE
 * predicate directional fixes `persist` and BREAKS `settleLandedSave`, because a
 * door passing local state as `acked` also carries prev's words, so the queue
 * clears and unsent work is deleted — the original fix 4 defect.
 * `selfForkDoors.test.jsx` went 11 passed to 1 failed, and re-running it against
 * the parent commit proved the regression was the change's, not master's.
 *
 * ⭐ So the two callers get predicates that encode WHAT THEY ARE HANDED:
 *     persist           the EDITOR's own content   -> editorStateDiscardsUnsentWork
 *     settleLandedSave  the SERVER's ACK (a claim) -> discardsUnsentWork
 *
 * These tests assert BOTH, on the SAME pair of records, because the whole point
 * is that the right answer differs by provenance.
 */
import { describe, it, expect } from 'vitest'
import {
  discardsUnsentWork, editorStateDiscardsUnsentWork, sameAuthoredContent,
} from './recoverLocalState'

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

  it('⭐ FIXED: the member typing MORE is not a discard, on the EDITOR path', () => {
    const prev = record('the member wrote this offline')
    const incoming = record('the member wrote this offline and then kept typing')
    // Nothing of prev's is lost — incoming contains it in full.
    expect(editorStateDiscardsUnsentWork(prev, incoming)).toBe(false)
  })

  it('⛔ and the ACK path still refuses it — a door may not pass local state', () => {
    const prev = record('the member wrote this offline')
    const doorLie = record('the member wrote this offline and then kept typing')
    // The SAME two records, asked of the ack path, must still block: the server
    // has not seen these words and `acked` is only a claim that it has.
    expect(discardsUnsentWork(prev, doorLie)).toBe(true)
  })

  it('the editor path still refuses a genuine discard', () => {
    expect(editorStateDiscardsUnsentWork(record('the member wrote this offline'),
                                         record('a server echo'))).toBe(true)
    expect(editorStateDiscardsUnsentWork(record('a long sentence typed'),
                                         record('a long sentence'))).toBe(true)
  })

  it('answers YES when incoming genuinely drops the unsent words (correct)', () => {
    const prev = record('the member wrote this offline')
    const serverEcho = record('the title only, as the server had it')
    expect(discardsUnsentWork(prev, serverEcho)).toBe(true)
  })

  it('answers YES on a truncation (correct)', () => {
    expect(discardsUnsentWork(record('a long sentence the member typed'),
                              record('a long sentence'))).toBe(true)
  })

  it('identical content discards nothing (correct)', () => {
    expect(discardsUnsentWork(record('same'), record('same'))).toBe(false)
  })

  it('sameAuthoredContent is symmetric — fine in itself; the CALLER is not', () => {
    const a = record('one')
    const b = record('one two')
    expect(sameAuthoredContent(a, b)).toBe(sameAuthoredContent(b, a))
    expect(sameAuthoredContent(a, b)).toBe(false)
  })
})
