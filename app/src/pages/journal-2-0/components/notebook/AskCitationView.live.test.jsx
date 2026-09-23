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
import { AskCitation, askCitationStaleKey } from '../../lib/askCitationNode'

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

// G-064 final fix wave (I1) — a PUBLIC SHARED note serves every chip reduced to
// `{ n }` (note_shares._reduce_ask_citations, spec §7.5: the label, link,
// precision and claim describe notes the member did not share). A reduced chip
// therefore carries NO claim at all. Before this fix the attribute defaulted to
// `''`, and `''` never equals the text of a paragraph that has any, so EVERY
// chip on every shared note read "[n · edited]" -- a false statement about the
// member's own words, on the one page strangers see. A missing claim means
// "unknown", not "edited" (spec §6.3: the check works identically in
// SharedNotePage). Mounted through the real EditorContent path, not a bare
// Editor, because the words a reader sees are the node view's.
describe('AskCitationView — a share-reduced chip is not "edited" (I1)', () => {
  const SHARED_DOC = {
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
              // Exactly what resolve_share serves: the number and nothing else.
              { type: 'askCitation', attrs: { n: 1 } },
              { type: 'text', text: '.' },
            ],
          },
        ],
      },
    ],
  }

  it('reads [1], never [1 · edited], inside a paragraph that has text', async () => {
    const editorRef = await mount(SHARED_DOC)
    await waitFor(() => expect(screen.getByText('[1]')).toBeInTheDocument())
    expect(screen.queryByText(/edited/)).toBeNull()
    expect(askCitationStaleKey.getState(editorRef.current.state).find()).toHaveLength(0)
  })
})
