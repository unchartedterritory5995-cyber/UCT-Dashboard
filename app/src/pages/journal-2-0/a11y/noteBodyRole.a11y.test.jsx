// Tier 4 fix round 2 (the live scorecard, 2026-11-05): axe reported `aria-prohibited-attr` (serious) on `.tiptap`
// at every profile. The editable root carried `aria-label="Note body"` and no role, and `aria-label` is not allowed
// on a role-less div. It is a multi-line text field, so it says so: role="textbox", aria-multiline="true".
//
// ⚠️ Why it was missed: Tiptap injects role="textbox" when it CREATES the view, so a fresh editor (every recipe)
// looks right. Any later setOptions re-applies editorProps.attributes WITHOUT the injected role (Tiptap 3.23
// createView vs setOptions), and the root keeps the label with no role. This rail sets options once, as the page
// does, and runs axe on an empty body; the control proves the old attributes are the violation production saw.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import axe from 'axe-core'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { installFetch, Providers } from './fixtures'
import NoteEditorPage, { NOTE_BODY_ARIA } from '../components/notebook/NoteEditorPage'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

let editor
afterEach(() => { cleanup(); editor?.destroy(); editor = null })

/** A bare editor with these root attributes and NO content (the case axe reports as a violation). */
function emptyBody(attributes) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: [StarterKit], content: '', editorProps: { attributes } })
  // ⛔ THE MECHANISM: Tiptap adds role="textbox" only at createView. Any later setOptions (setEditable, the lock
  // guard, @tiptap/react re-applying options) hands ProseMirror OUR attributes alone, and the role is gone. Production
  // was in that state; so is this rail.
  editor.setEditable(true)
  return editor.view.dom
}
const prohibited = async (node) => {
  const r = await axe.run(node, { runOnly: { type: 'rule', values: ['aria-prohibited-attr', 'aria-allowed-attr', 'aria-input-field-name'] } })
  // jsdom has no layout, so axe files this rule under "needs review" rather than a violation here: both count.
  return [...r.violations, ...r.incomplete].map((v) => v.id)
}

describe('the note body is a named, multi-line text field', () => {
  it('an empty body with the page\'s attributes has no serious aria violation', async () => {
    const dom = emptyBody({ ...NOTE_BODY_ARIA, tabindex: '0' })
    expect(dom.getAttribute('role')).toBe('textbox')
    expect(dom.getAttribute('aria-multiline')).toBe('true')
    expect(await prohibited(dom)).toEqual([])
  })

  it('CONTROL: the old attributes (a label, no role) are the violation production reported', async () => {
    const dom = emptyBody({ 'aria-label': 'Note body', tabindex: '0' })
    expect(await prohibited(dom)).toContain('aria-prohibited-attr')
  })

  it('the real NoteEditorPage stamps them on its ProseMirror root', async () => {
    installFetch()
    render(
      <Providers route="/journal/notebook?note=n1">
        <NoteEditorPage noteId="n1" onBack={() => {}} showBack={false} />
      </Providers>,
    )
    await screen.findByPlaceholderText('Title')
    const dom = await waitFor(() => {
      const el = document.querySelector('.ProseMirror')
      if (!el) throw new Error('editor not mounted')
      return el
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(dom.getAttribute('role')).toBe('textbox')
    expect(dom.getAttribute('aria-multiline')).toBe('true')
    expect(dom.getAttribute('aria-label')).toBe('Note body')
    expect(screen.getByRole('textbox', { name: 'Note body' })).toBe(dom)
  })
})
