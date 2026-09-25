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
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AskInsert } from '../../lib/askInsertNode'
import { AskCitation, askCitationStaleKey } from '../../lib/askCitationNode'
import { ASK_CITATION_TYPE, claimFromJson } from '../../lib/askInsert'
import styles from './AskCitationView.module.css'

const HERE = path.dirname(fileURLToPath(import.meta.url))
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

// G-064 close-out — run-together chips `[2][3]`: a tap on `[2]`'s own box
// opened source 3, because `[3]`'s enlarged touch target painted over it.
// AskCitationView.module.css now drops the LEFT extension of a chip whose
// previous element sibling is another chip. jsdom performs no layout, so the
// geometry cannot be tested here; what CAN be is the precondition the rule
// stands on, in the DOM a real TipTap React node view produces: which element
// the siblings are, and that the selector exactly as written picks the right
// chips out of it. AskCitationView.test.jsx pins the declarations.
describe('AskCitationView — adjacent chips never steal each other\'s taps (DOM precondition)', () => {
  const chip = (n) => ({
    type: 'askCitation',
    attrs: { n, label: `Note ${n}`, nav: { kind: 'note', note_id: `n${n}` }, citation: 'exact', claim: null },
  })
  // A source with no note to open (an excerpt never carries `note_id`) renders
  // as a non-interactive <span> chip.
  const noNoteChip = (n) => ({
    type: 'askCitation',
    attrs: { n, label: `Excerpt ${n}`, nav: { kind: 'excerpt' }, citation: 'exact', claim: null },
  })
  const RUN_CONTENT = [
    { type: 'text', text: 'Margins fell ' },
    chip(2), chip(3),
    { type: 'text', text: ' y' },
    chip(4),
    { type: 'text', text: ' and ' },
    { type: 'text', text: 'held', marks: [{ type: 'bold' }] },
    chip(5), noNoteChip(6), chip(7),
  ]
  // The claim an insert would have written, so no chip reads "edited".
  for (const node of RUN_CONTENT) if (node.type === 'askCitation') node.attrs.claim = claimFromJson(RUN_CONTENT)
  const RUN_DOC = {
    type: 'doc',
    content: [{
      type: 'askInsert',
      attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'note', question: 'q' },
      content: [{ type: 'paragraph', content: RUN_CONTENT }],
    }],
  }
  const NODE_CLASS = `node-${ASK_CITATION_TYPE}`

  /** The rule in the touch tier whose selector combines siblings, as written. */
  function adjacencySelector() {
    const css = fs.readFileSync(path.join(HERE, 'AskCitationView.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const touch = /@media \(max-width: 1024px\) \{([\s\S]*)\}\s*$/.exec(css)?.[1] || ''
    const rules = [...touch.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => /[+~]/.test(sel))
    expect(rules).toHaveLength(1)
    const [, sel, body] = rules[0]
    expect(body).toMatch(/left:\s*0;/)
    // What the browser sees: `:global(x)` unwrapped, local classes hashed the
    // way this module's import hashes them, the pseudo-element dropped (the
    // element it hangs off is the one a tap reaches).
    return sel.trim()
      .replace(/::after$/, '')
      .replace(/:global\(([^)]+)\)|\.([A-Za-z_][\w-]*)/g, (m, global, local) => (global ?? `.${styles[local]}`))
  }

  async function chips() {
    await mount(RUN_DOC)
    const buttons = await waitFor(() => {
      const found = [2, 3, 4, 5, 7].map((n) => screen.getByRole('button', { name: `Source ${n}: Note ${n}` }))
      return found
    })
    return buttons
  }

  /** The chip element of the no-note source `[6]`: a <span>, not a button. */
  function spanChip6() {
    const chips = [...document.querySelectorAll(`.${styles.chip}`)]
    const found = chips.filter((el) => el.textContent.includes('Source 6: Excerpt 6'))
    expect(found).toHaveLength(1)
    return found[0]
  }

  it('each chip is chip < .wrap < the node-view span, and the node-view spans are the siblings', async () => {
    const [b2, b3, b4, b5, b7] = await chips()
    const s6 = spanChip6()
    // `[6]` has no note to open: a SPAN chip, carrying the same local class
    // the touch rule positions (`.wrap .chip`), in the same sibling chain.
    expect(s6.tagName).toBe('SPAN')
    expect(s6.closest('button')).toBeNull()
    const views = [b2, b3, b4, b5, s6, b7].map((b) => {
      const wrap = b.parentElement
      expect(wrap.classList.contains(styles.wrap)).toBe(true)
      expect(wrap.children).toHaveLength(1)
      const view = wrap.parentElement
      expect(view.classList.contains(NODE_CLASS)).toBe(true)
      expect(view.children).toHaveLength(1)
      expect(view.parentElement.tagName).toBe('P')
      return view
    })
    const [v2, v3, v4, v5, v6, v7] = views
    // Text before `[2]` is not an element, so nothing precedes it.
    expect(v2.previousElementSibling).toBeNull()
    // `[2][3]` run together: element siblings, the shape the rule needs.
    expect(v3.previousElementSibling).toBe(v2)
    // `+` skips text nodes: `[3] y[4]` is ALSO adjacent, and `[4]` loses its
    // left side too -- the conservative direction, stated in the CSS comment.
    expect(v4.previousElementSibling).toBe(v3)
    // Formatted text is an element: `<strong>held</strong>[5]` is not adjacent.
    expect(v5.previousElementSibling?.tagName).toBe('STRONG')
    // `[5][6][7]`: the no-note span chip sits in the same chain, right after a
    // note chip and right before one.
    expect(v6.previousElementSibling).toBe(v5)
    expect(v7.previousElementSibling).toBe(v6)
  })

  it('the adjacency selector, exactly as written, matches the chips that follow a chip and no other', async () => {
    const [b2, b3, b4, b5, b7] = await chips()
    const selector = adjacencySelector()
    const matched = [...document.querySelectorAll(selector)]
    // `[7]` follows the span chip `[6]`, so its left side faces a chip too.
    expect(matched).toEqual([b3, b4, b7])
    expect(matched).not.toContain(b2)
    expect(matched).not.toContain(b5)
  })
})
