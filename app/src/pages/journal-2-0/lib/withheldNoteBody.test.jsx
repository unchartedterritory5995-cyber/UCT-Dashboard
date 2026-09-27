/**
 * ⛔⛔ A NOTE WHOSE BODY THE SERVER WITHHOLDS OPENS LOCKED, NEVER BLANK (wave 10,
 * lane 10D — the read side of an over-deep note).
 *
 * A note stored deeper than `notes.MAX_BODY_DEPTH` before the H14 cap used to 500
 * on every read. The router now answers 200 with the note's metadata and a
 * PLACEHOLDER body (`api/routers/journal_two.py::_WITHHELD_BODY_JSON`). If the
 * editor showed that placeholder as an empty doc, the next autosave would write it
 * over the stored note — the loss the withholding exists to prevent. So the
 * placeholder is built to be UNBUILDABLE with every type known, and the editor's
 * existing guard must LOCK it with its existing 'malformed' reason.
 *
 * The fixture is the server's object, pinned equal by
 * tests/test_note_read_side_depth.py::test_the_client_fixture_is_the_server_placeholder.
 * These drive the REAL editor and assert RENDERED TEXT.
 */
import { Editor } from '@tiptap/core'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { buildExtensions } from './tiptap'
import {
  MALFORMED_NOTE_MESSAGE, UNREADABLE_MALFORMED,
  canReadDocument, isUnreadable, noteContentGuardOptions, unreadableReason, unreadableReasonOf,
} from './noteContentGuard'
import UnreadableNoteNotice from './UnreadableNoteNotice'
import WITHHELD from './__fixtures__/withheldNoteBody.json'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const editors = []
afterEach(() => { cleanup(); editors.splice(0).forEach((ed) => ed.destroy()) })

describe('the withheld-body placeholder', () => {
  it('is read (non-vacuity): it carries the depth sentence', () => {
    expect(WITHHELD.type).toBe('doc')
    expect(JSON.stringify(WITHHELD)).toMatch(/too many lists, quotes or toggles/)
  })

  it('cannot be built by the real editor schema, and the reason is MALFORMED (not newer)', () => {
    const schema = new Editor({ extensions: buildExtensions() }).schema
    expect(canReadDocument(schema, WITHHELD)).toBe(false)
    expect(unreadableReason(schema, WITHHELD)).toBe(UNREADABLE_MALFORMED)
  })

  it('opens LOCKED, read-only, and the notice says nothing in it was changed', () => {
    const ed = new Editor({ element: document.createElement('div'), extensions: buildExtensions(),
      ...noteContentGuardOptions(), content: WITHHELD })
    editors.push(ed)
    expect(isUnreadable(ed), 'a withheld body must lock the editor, or an autosave blanks the note').toBe(true)
    expect(unreadableReasonOf(ed)).toBe(UNREADABLE_MALFORMED)
    expect(ed.isEditable).toBe(false)
    render(<UnreadableNoteNotice editor={ed} />)
    expect(screen.getByRole('alert')).toHaveTextContent(MALFORMED_NOTE_MESSAGE)
  })
})
