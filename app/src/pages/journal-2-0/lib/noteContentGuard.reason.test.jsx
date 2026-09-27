/**
 * ⛔⛔ WAVE 10 (lane 10C) — A MALFORMED NOTE IS NOT "FROM A NEWER VERSION".
 *
 * The guard locks every note the schema cannot BUILD. Before wave 10 the notice
 * said "This note has content from a newer version of the app. Reload to edit
 * it." for all of them — true for a type a newer bundle wrote, FALSE for a note
 * whose types are all known but whose body is malformed (the wave-5 walk's empty
 * text node). A member with a damaged note was told to reload, forever.
 *
 * These drive the REAL editor (buildExtensions + the guard options) and assert
 * RENDERED TEXT (CLAUDE.md: "Assert user-facing feedback by RENDERED TEXT").
 */
import { Editor } from '@tiptap/core'
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { buildExtensions } from './tiptap'
import {
  MALFORMED_NOTE_MESSAGE, UNREADABLE_NOTE_MESSAGE, UNREADABLE_MALFORMED, UNREADABLE_NEWER,
  isUnreadable, noteContentGuardOptions, replaceDocument, unreadableReason, unreadableReasonOf,
} from './noteContentGuard'
import UnreadableNoteNotice from './UnreadableNoteNotice'
import NoteVersionPreview from '../components/notebook/NoteVersionPreview'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const para = (text, marks) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })
const EMPTY_TEXT = { type: 'doc', content: [para('kept words'), { type: 'paragraph', content: [{ type: 'text', text: '' }] }] }
const UNKNOWN_NODE = { type: 'doc', content: [para('NVDA thesis'), { type: 'waveElevenDiagram' }] }
const UNKNOWN_MARK = { type: 'doc', content: [para('key level', [{ type: 'waveElevenUnderwave' }])] }
const READABLE = { type: 'doc', content: [para('fine', [{ type: 'bold' }])] }

const editors = []
function guarded(content) {
  const ed = new Editor({ element: document.createElement('div'), extensions: buildExtensions(),
    ...noteContentGuardOptions(), content })
  editors.push(ed)
  return ed
}
afterEach(() => { cleanup(); editors.splice(0).forEach((ed) => ed.destroy()) })

describe('the two sentences', () => {
  it('are different, and the malformed one never claims a newer version', () => {
    expect(MALFORMED_NOTE_MESSAGE).not.toBe(UNREADABLE_NOTE_MESSAGE)
    expect(MALFORMED_NOTE_MESSAGE).not.toMatch(/newer version/i)
    expect(MALFORMED_NOTE_MESSAGE).toMatch(/Nothing in it has been changed/)
  })
})

describe('classifying WHY a body cannot be built', () => {
  const schema = new Editor({ extensions: buildExtensions() }).schema
  it('a known-type body that is malformed reads as MALFORMED', () => {
    expect(unreadableReason(schema, EMPTY_TEXT)).toBe(UNREADABLE_MALFORMED)
  })
  it('an unknown node or mark type reads as NEWER', () => {
    expect(unreadableReason(schema, UNKNOWN_NODE)).toBe(UNREADABLE_NEWER)
    expect(unreadableReason(schema, UNKNOWN_MARK)).toBe(UNREADABLE_NEWER)
  })
})

describe('⛔⛔ the lock remembers its reason, and the notice SAYS it', () => {
  it('a malformed stored body: locked, and the notice shows the MALFORMED sentence', () => {
    const ed = guarded(EMPTY_TEXT)
    expect(isUnreadable(ed), 'the guard must still lock a malformed note').toBe(true)
    expect(unreadableReasonOf(ed)).toBe(UNREADABLE_MALFORMED)
    render(<UnreadableNoteNotice editor={ed} />)
    expect(screen.getByRole('alert')).toHaveTextContent(MALFORMED_NOTE_MESSAGE)
    expect(screen.queryByText(UNREADABLE_NOTE_MESSAGE)).toBeNull()
  })

  it('a body from a newer bundle: locked, and the notice keeps the NEWER sentence', () => {
    const ed = guarded(UNKNOWN_NODE)
    expect(unreadableReasonOf(ed)).toBe(UNREADABLE_NEWER)
    render(<UnreadableNoteNotice editor={ed} />)
    expect(screen.getByRole('alert')).toHaveTextContent(UNREADABLE_NOTE_MESSAGE)
  })

  it('a mid-session swap to a malformed body locks with the MALFORMED reason', () => {
    const ed = guarded(READABLE)
    expect(isUnreadable(ed)).toBe(false)
    expect(replaceDocument(ed, EMPTY_TEXT)).toBe(false)
    expect(unreadableReasonOf(ed)).toBe(UNREADABLE_MALFORMED)
  })

  it('a notice rendered WITHOUT its editor (NoteEditorPage today) uses the unanimous live reason', () => {
    guarded(EMPTY_TEXT)
    render(<UnreadableNoteNotice />)
    expect(screen.getByRole('alert')).toHaveTextContent(MALFORMED_NOTE_MESSAGE)
  })

  it('…and falls back to the NEWER sentence when live locked editors disagree', () => {
    guarded(EMPTY_TEXT)
    guarded(UNKNOWN_MARK)
    render(<UnreadableNoteNotice />)
    expect(screen.getByRole('alert')).toHaveTextContent(UNREADABLE_NOTE_MESSAGE)
  })
})

describe('a real surface wired with its editor', () => {
  it('the version-history preview of a malformed version shows the MALFORMED sentence', async () => {
    render(<NoteVersionPreview title="Old" subtitle={null} bodyJson={EMPTY_TEXT} />)
    expect(await screen.findByText(MALFORMED_NOTE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(UNREADABLE_NOTE_MESSAGE)).toBeNull()
  })
})
