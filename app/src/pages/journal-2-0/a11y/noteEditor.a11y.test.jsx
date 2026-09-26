// app/src/pages/journal-2-0/a11y/noteEditor.a11y.test.jsx
//
// A1: the note editor, and the editor with each of its popups OPEN (slash menu,
// find bar with replace, outline, colour menu, table toolbar, emoji menu, note-
// link menu, link-paste menu, writing-help panel, history with its version
// preview, the widget palette). The real NoteEditorPage over a real TipTap
// editor; only the network is faked. Each popup is opened through the same
// door a member uses (a button, a typed trigger, a caret in a table), and the
// recipe asserts it is on screen before axe runs.
import { describe, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { TextSelection } from '@tiptap/pm/state'
import { installFetch, latchWave8Flags, Providers } from './fixtures'
import { axeSurface } from './surface'
import NoteEditorPage from '../components/notebook/NoteEditorPage'
import NoteMenuActions from '../components/notebook/NoteMenuActions'
import { linkPasteKey } from '../lib/linkPasteOffer'

// jsdom performs no layout: a caret measured for a popup needs a Range box.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

async function renderEditor() {
  render(
    <Providers route="/journal/notebook?note=n1">
      <NoteEditorPage
        noteId="n1"
        onBack={() => {}}
        showBack={false}
        noteMenu={(note, api) => <NoteMenuActions note={note} onUnlock={api?.unlockNote} onChanged={() => {}} />}
      />
    </Providers>,
  )
  await screen.findByPlaceholderText('Title')
  const dom = await waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el
  })
  await settle()
  return dom.editor
}

function caretAtText(editor, text) {
  let at = null
  editor.state.doc.descendants((n, pos) => { if (at == null && n.isText && n.text.includes(text)) at = pos + 1 })
  act(() => { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at))) })
}

function caretAtEnd(editor) {
  act(() => { editor.commands.focus('end') })
}

for (const flagsOn of [true, false]) {
  describe(`note editor (wave-8 flags ${flagsOn ? 'ON' : 'OFF'})`, () => {
    beforeEach(() => { installFetch(); latchWave8Flags(flagsOn) })

    axeSurface(`editor${flagsOn ? '' : ':flags-off'}`, async () => {
      await renderEditor()
      screen.getByRole('toolbar', { name: 'Editor toolbar' })
      screen.getByRole('group', { name: 'Organise this note' })
      await screen.findByText('Sym')   // the note's table rendered
    })
  })
}

describe('note editor popups', () => {
  beforeEach(() => { installFetch(); latchWave8Flags(true, { notebook_writing_help_enabled: true }) })

  axeSurface('editor-slash', async () => {
    const editor = await renderEditor()
    caretAtEnd(editor)
    act(() => { editor.commands.insertContent('/') })
    await waitFor(() => expect(document.getElementById('uct-slash-menu')).not.toBeNull())
  })

  axeSurface('editor-find', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Find in note' }))
    const bar = await screen.findByRole('search', { name: 'Find in note' })
    fireEvent.click(screen.getByRole('button', { name: 'Show replace' }))
    await waitFor(() => expect(bar.querySelectorAll('input').length).toBeGreaterThan(1))
  })

  axeSurface('editor-outline', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Outline' }))
    await screen.findAllByText('Setup')
    await settle()
  })

  axeSurface('editor-color', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Text color and highlight' }))
    await waitFor(() => expect(document.querySelector('[id^="text-color-menu"], [role="group"][aria-label*="olor"]')).not.toBeNull())
  })

  axeSurface('editor-table', async () => {
    const editor = await renderEditor()
    caretAtText(editor, 'NVDA')
    await screen.findByRole('toolbar', { name: 'Table' })
  })

  axeSurface('editor-emoji', async () => {
    const editor = await renderEditor()
    caretAtEnd(editor)
    act(() => { editor.commands.insertContent(' :smi') })
    await waitFor(() => expect(document.getElementById('uct-emoji-menu')).not.toBeNull())
  })

  axeSurface('editor-note-link', async () => {
    const editor = await renderEditor()
    caretAtEnd(editor)
    act(() => { editor.commands.insertContent('[[wee') })
    await waitFor(() => expect(document.querySelector('[id^="uct-note-link"], [role="listbox"][aria-label*="ote"]')).not.toBeNull())
    await settle(350)
  })

  axeSurface('editor-link-paste', async () => {
    const editor = await renderEditor()
    caretAtText(editor, 'Intro line')
    const from = editor.state.selection.from
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText(url, from).setMeta(linkPasteKey, {
        offer: { from, to: from + url.length, url, preview: true, embed: true },
      }))
    })
    await screen.findByRole('toolbar', { name: 'Pasted link' })
  })

  axeSurface('editor-writing-help', async () => {
    const editor = await renderEditor()
    caretAtText(editor, 'Intro line')
    fireEvent.click(screen.getByRole('button', { name: 'Writing help' }))
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())
    await settle()
  })

  axeSurface('editor-history', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Version history' }))
    await screen.findByTestId('note-version-preview')
    await settle()
  })

  axeSurface('editor-palette', async () => {
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Insert widget' }))
    await settle()
    expect(document.body.textContent).toMatch(/chart/i)
  })
})

// Keep the linter from treating the vi import as unused on a future edit.
void vi
