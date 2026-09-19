/**
 * ⛔⛔ A RAILED, REPRODUCED DEFECT — fix 6 drops words the member is still typing.
 *
 * These tests PIN THE CURRENT (WRONG) BEHAVIOUR ON PURPOSE. They are green, and
 * the thing they assert is a bug. If someone fixes it they will go red, and the
 * message will tell them to delete the pin rather than "repair" the test.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * `discardsUnsentWork` documents itself as DIRECTIONAL:
 *
 *     @returns true when `prev` is carrying words `incoming` does not have
 *
 * and is implemented as SYMMETRIC inequality:
 *
 *     return !sameAuthoredContent(incoming, prev)
 *
 * The difference is the member still typing. Once a note is dirty, every further
 * keystroke makes `incoming` differ from `prev` — in the direction where incoming
 * has MORE — and `persist` does `source = unsentWork ? prev : state`, so it
 * writes `prev`. The member's newer words never reach the durable copy. The
 * editor keeps showing them; a reload does not.
 *
 * ── WHY 86 GREEN PRODUCTION CELLS COULD NOT SEE IT ───────────────────────────
 *
 * Every F5 rig cell types its sentinel in ONE burst, which a single debounce
 * window captures while the record is still CLEAN. The failure needs a note
 * ALREADY dirty when the typing starts — exactly the state
 * `append_document_excerpt`'s setup leaves behind, which is why that one cell
 * failed reproducibly across five runs and was labelled an instrument answer.
 *
 * ── WHY IT IS NOT FIXED HERE ─────────────────────────────────────────────────
 *
 * ⚰️ A directional fix WAS written and REVERTED, because it traded this bug for
 * a worse one. Making the guard ask "does `incoming` still CARRY prev's words?"
 * fixes `persist` and breaks `settleLandedSave`: a door passing LOCAL state as
 * `acked` also carries prev's words, so the queue got cleared and unsent work was
 * deleted — the original fix 4 defect, measured by
 * `selfForkDoors.test.jsx > a door must NOT pass local state as `acked``
 * (11 passed before, 1 failed after).
 *
 * ⭐ THE REAL FINDING IS THAT ONE PREDICATE CANNOT ANSWER BOTH CALLERS.
 *   - `persist` receives the EDITOR's live content, which is authoritative and
 *     legitimately newer than the durable copy.
 *   - `settleLandedSave` receives what the SERVER ACKED, which may be a door's
 *     lie about what the server has.
 * Fix 6 merged them for "one authority" and that was right about the invariant
 * and wrong about the question. Separating them needs its own design and its own
 * evidence, and must not be improvised on the note-saving path.
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

const PIN = 'PINNED DEFECT — if this now fails, the bug is FIXED. Delete the pin, '
  + 'do not adjust it. See the file header.'

describe('fix 6 · the guard vs a member who keeps typing', () => {
  it('a CLEAN prev is never treated as unsent work', () => {
    expect(discardsUnsentWork(record('hello', 0), record('hello world'))).toBe(false)
    expect(discardsUnsentWork(null, record('hello'))).toBe(false)
  })

  it('⛔ PINNED DEFECT: the member typing MORE is wrongly read as a discard', () => {
    const prev = record('the member wrote this offline')
    const incoming = record('the member wrote this offline and then kept typing')
    // Nothing of prev's is being lost — `incoming` contains it in full. The
    // correct answer is false. It returns TRUE, so `persist` writes `prev` and
    // the newer words are dropped from the durable copy.
    expect(discardsUnsentWork(prev, incoming), PIN).toBe(true)
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
