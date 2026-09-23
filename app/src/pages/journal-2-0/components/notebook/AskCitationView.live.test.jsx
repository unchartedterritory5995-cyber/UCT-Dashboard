/**
 * G-064 fix round 1 (Finding F1) — a REAL editor, mounted through
 * `useEditor` + `EditorContent` (never a bare `new Editor()`), because the
 * bug only exists when `editor.contentComponent` is real: `@tiptap/react`'s
 * default `ReactNodeView.update` (dist/index.js ~1006-1012) stores the new
 * decorations and returns `true` WITHOUT calling `updateProps` whenever
 * `newNode === this.node` -- editing a chip's PARAGRAPH leaves the chip
 * node's own identity unchanged, so the chip never showed `[n · edited]`
 * live. `askInsertNodes.test.js`'s bare `new Editor()` rails cannot see this
 * at all (their own header comment says so: with no content component,
 * `ReactNodeViewRenderer` returns `{}` and nodes render through
 * `renderHTML`). This file is the one place that mounts the real thing.
 */
import { useEffect } from 'react'
import { describe, it, expect } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { AskInsert } from '../../lib/askInsertNode'
import { AskCitation } from '../../lib/askCitationNode'

const EXT = [StarterKit, AskInsert, AskCitation]

const DOC = {
  type: 'doc',
  content: [
    {
      type: 'askInsert',
      attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'note', question: 'q' },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Margins fell ' },
            {
              type: 'askCitation',
              attrs: {
                n: 1, label: 'NVDA thesis', nav: { kind: 'note', note_id: 'n1' },
                citation: 'exact', claim: 'Margins fell .',
              },
            },
            { type: 'text', text: '.' },
          ],
        },
      ],
    },
  ],
}

function Harness({ doc, editorRef }) {
  const editor = useEditor({ extensions: EXT, content: doc })
  useEffect(() => {
    editorRef.current = editor
    return () => { if (editorRef.current === editor) editorRef.current = null }
  }, [editor, editorRef])
  return <EditorContent editor={editor} />
}

async function mount(doc) {
  const editorRef = { current: null }
  render(<MemoryRouter><Harness doc={doc} editorRef={editorRef} /></MemoryRouter>)
  await waitFor(() => expect(editorRef.current).toBeTruthy())
  return editorRef
}

describe('AskCitationView — live re-render on a decoration-only change (F1)', () => {
  it('shows [1], then [1 · edited] once its paragraph is edited, then [1] again after undo', async () => {
    const editorRef = await mount(DOC)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Source 1: NVDA thesis' })).toHaveTextContent('[1]')
    })

    // Insert text into the chip's OWN paragraph -- the chip node's identity
    // is unchanged; only the decoration (derived from the paragraph's text)
    // changes.
    act(() => {
      editorRef.current.chain().setTextSelection(2).insertContent('Really, ').run()
    })

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('[1 · edited]')
    })
    expect(screen.getByRole('button')).toHaveAccessibleName('Source 1: NVDA thesis, text edited since inserted')

    act(() => {
      editorRef.current.commands.undo()
    })

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('[1]')
    })
    expect(screen.getByRole('button')).toHaveAccessibleName('Source 1: NVDA thesis')
  })
})
