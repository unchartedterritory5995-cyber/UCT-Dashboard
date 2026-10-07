// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/embedBlockActions.a11y.test.jsx
//
// Landing 12-15: the "Block actions" button on a chart block (finish program, lane FE round 3,
// components/notebook/EmbedBlockActions.jsx) through 8A's axe harness. It arrived with no entry
// in a11y/notebookSurfaces.js, so `surfaceCoverage.test.js` failed by name in CI (run
// 37624329151). It gets a recipe of its own rather than a `coveredBy`: the editor recipes run in
// jsdom, where the block toolbar's 1024 px rule never applies and the button's chunk is fetched
// on demand, so no other recipe is known to render it.
//
// ONE state: the button at rest, with its menu proved to open (so the button is live, not a
// stub). ⛔ The OPEN MENU is deliberately not an axe surface here, and that is a finding, not a
// pass: the menu is the app-wide shared `components/mobile/ContextPopover.jsx`, whose anchored
// form is `role="menu"` (line 168) with plain <button> children. axe reports
// `aria-required-children` (critical) on it. That file is identical to master's and is used
// across the app; fixing it belongs to its owner and to a pass of its own, not to a landing.
// Measured 2026-10-07 with this harness. No Notebook recipe opens that popover today.
import { describe, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Editor, Node } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { axeSurface } from './surface'
import EmbedBlockActions, { BLOCK_ACTIONS_LABEL } from '../components/notebook/EmbedBlockActions'

const Block = Node.create({
  name: 'widgetEmbed', group: 'block', atom: true, selectable: true,
  parseHTML() { return [{ tag: 'div[data-block]' }] },
  renderHTML() { return ['div', { 'data-block': '' }] },
})
const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })

let editor
function mount() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  editor = new Editor({
    element: host, extensions: [Document, Paragraph, Text, Block],
    content: { type: 'doc', content: [p('one'), { type: 'widgetEmbed' }, p('two')] },
  })
  let at = null
  editor.state.doc.descendants((n, pos) => { if (n.type.name === 'widgetEmbed') at = pos })
  return render(
    <main><EmbedBlockActions editor={editor} getPos={() => at} deleteNode={vi.fn()} /></main>,
  )
}

describe('the chart block\'s "Block actions" button', () => {
  afterEach(() => { editor?.destroy(); editor = null })

  axeSurface('embed-block-actions', async () => {
    const { container } = mount()
    const btn = screen.getByRole('button', { name: BLOCK_ACTIONS_LABEL })
    // Non-vacuity: it opens its three actions, then closes again, before axe reads the button.
    fireEvent.click(btn)
    const names = within(screen.getByRole('menu')).getAllByRole('button').map((b) => b.textContent)
    if (names.join('|') !== 'Move up|Move down|Remove block') throw new Error(`menu items: ${names.join('|')}`)
    fireEvent.click(btn)
    if (btn.getAttribute('aria-expanded') !== 'false') throw new Error('the menu did not close')
    return { root: container }
  })
})
