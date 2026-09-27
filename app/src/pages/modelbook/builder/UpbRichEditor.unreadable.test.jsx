/**
 * Wave 10, lane 10C, fix round 1 — My Playbook's editor passes ITS editor to the
 * unreadable notice.
 *
 * `UnreadableNoteNotice` picks one of two sentences by WHY the lock fired: a type a
 * newer bundle wrote, or a body that is merely malformed. Given its editor it answers
 * for that editor. Without one it falls back to the reason every live locked editor
 * agrees on, and to the newer-version sentence when they disagree — so an entry that
 * is malformed told the member to reload for a newer app whenever any other locked
 * editor was open. Each case below keeps a SECOND locked editor alive with the other
 * reason. The MALFORMED case is the discriminating one: there the editor-less notice
 * falls back to the newer-version sentence (mutation-proved, fix-round-1 report).
 * The NEWER case is its control -- the fallback happens to be right there -- and
 * pins that passing the editor did not flip the other answer.
 */
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../../journal-2-0/lib/tiptap'
import {
  MALFORMED_NOTE_MESSAGE, UNREADABLE_NOTE_MESSAGE, isUnreadable, noteContentGuardOptions,
} from '../../journal-2-0/lib/noteContentGuard'
import UpbRichEditor from './UpbRichEditor'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const MALFORMED = { type: 'doc', content: [para('kept words'), { type: 'paragraph', content: [{ type: 'text', text: '' }] }] }
const NEWER = { type: 'doc', content: [para('NVDA thesis'), { type: 'waveElevenDiagram' }] }

const others = []
function lockedElsewhere(content) {
  const ed = new Editor({ element: document.createElement('div'), extensions: buildExtensions(),
    ...noteContentGuardOptions(), content })
  others.push(ed)
  expect(isUnreadable(ed)).toBe(true)
  return ed
}
afterEach(() => { cleanup(); others.splice(0).forEach((ed) => ed.destroy()) })

describe('My Playbook entry that cannot be read', () => {
  it('a MALFORMED entry says malformed, even while another editor is locked on a newer body', async () => {
    lockedElsewhere(NEWER)
    render(<UpbRichEditor docJson={MALFORMED} contentKey="entry-1" onSave={async () => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(MALFORMED_NOTE_MESSAGE)
    expect(screen.queryByText(UNREADABLE_NOTE_MESSAGE)).toBeNull()
  })

  it('a NEWER entry says newer, even while another editor is locked on a malformed body', async () => {
    lockedElsewhere(MALFORMED)
    render(<UpbRichEditor docJson={NEWER} contentKey="entry-2" onSave={async () => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(UNREADABLE_NOTE_MESSAGE)
    expect(screen.queryByText(MALFORMED_NOTE_MESSAGE)).toBeNull()
  })
})
