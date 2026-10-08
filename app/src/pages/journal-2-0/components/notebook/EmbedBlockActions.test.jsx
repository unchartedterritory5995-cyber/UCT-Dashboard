// @vitest-environment jsdom
// Finish program, lane FE round 3 — a touch door for a chart block that cannot be selected.
//
// On a phone a LIVE chart cannot be selected by tap or long-press: the chart library cancels the
// touch, so the editor's click-to-select is never asked (true on master as well). Selection is how
// a block is moved (the block grip stands beside the block the caret is in), so a live chart had
// no way to be moved on a phone. This button sits in the block's own toolbar at 1024 px and
// below and opens the shared action menu: Move up, Move down, Remove block.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Editor, Node } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import EmbedBlockActions, { BLOCK_ACTIONS_LABEL } from './EmbedBlockActions'

const Block = Node.create({
  name: 'widgetEmbed', group: 'block', atom: true, selectable: true,
  addAttributes() { return { tag: { default: '' } } },
  parseHTML() { return [{ tag: 'div[data-block]' }] },
  renderHTML({ node }) { return ['div', { 'data-block': node.attrs.tag }] },
})
const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const chart = (tag) => ({ type: 'widgetEmbed', attrs: { tag } })

let editor
function make(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: [Document, Paragraph, Text, Block], content: { type: 'doc', content } })
  return editor
}
afterEach(() => { editor?.destroy(); editor = null })

const order = () => editor.getJSON().content.map((n) => (n.type === 'widgetEmbed' ? `CHART:${n.attrs.tag}` : n.content?.[0]?.text))
const posOf = (tag) => { let at = null; editor.state.doc.descendants((n, pos) => { if (n.type.name === 'widgetEmbed' && n.attrs.tag === tag) at = pos }); return at }
const mount = (tag, deleteNode = vi.fn()) => render(
  <EmbedBlockActions editor={editor} getPos={() => posOf(tag)} deleteNode={deleteNode} />,
)
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: BLOCK_ACTIONS_LABEL }))
const item = (name) => within(screen.getByRole('menu')).getByRole('menuitem', { name })

describe('the block actions button on a chart block', () => {
  it('has a real name, says it opens a menu, and offers Move up, Move down and Remove block', () => {
    make([p('one'), chart('a'), p('two')])
    mount('a')
    const btn = screen.getByRole('button', { name: 'Block actions' })
    expect(btn).toHaveAttribute('aria-haspopup', 'menu')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    openMenu()
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Move up', 'Move down', 'Remove block'])
  })

  it('Move up and Move down move THIS block one step, without it having been selected first', () => {
    make([p('one'), chart('a'), p('two'), p('three')])
    mount('a')
    openMenu(); fireEvent.click(item('Move down'))
    expect(order()).toEqual(['one', 'two', 'CHART:a', 'three'])
    openMenu(); fireEvent.click(item('Move up'))
    openMenu(); fireEvent.click(item('Move up'))
    expect(order()).toEqual(['CHART:a', 'one', 'two', 'three'])
  })

  it('with two charts, it moves the one it belongs to', () => {
    make([chart('a'), p('one'), chart('b')])
    mount('b')
    openMenu(); fireEvent.click(item('Move up'))
    expect(order()).toEqual(['CHART:a', 'CHART:b', 'one'])
  })

  it('at the top Move up is unavailable, at the bottom Move down is', () => {
    make([chart('a'), p('one')])
    const view = mount('a')
    openMenu()
    expect(item('Move up')).toBeDisabled()
    expect(item('Move down')).not.toBeDisabled()
    fireEvent.click(item('Move down'))
    view.unmount()
    mount('a')
    openMenu()
    expect(item('Move down')).toBeDisabled()
  })

  it('Remove block removes it through the block’s own delete', () => {
    make([p('one'), chart('a')])
    const deleteNode = vi.fn()
    mount('a', deleteNode)
    openMenu(); fireEvent.click(item('Remove block'))
    expect(deleteNode).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('a read-only note shows no button', () => {
    make([p('one'), chart('a')])
    editor.setEditable(false)
    mount('a')
    expect(screen.queryByRole('button', { name: BLOCK_ACTIONS_LABEL })).toBeNull()
  })
})

describe('where it shows (the stylesheet is the authority; jsdom applies none)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const css = readFileSync(resolve(here, 'WidgetEmbedView.module.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
  const view = readFileSync(resolve(here, 'WidgetEmbedView.jsx'), 'utf8')

  it('hidden by default, so a desktop never sees it', () => {
    const base = css.slice(0, css.indexOf('@media (max-width: 1024px)'))
    expect(base).toMatch(/\.blockActions\s*\{[^}]*display:\s*none/)
  })

  it('at 1024 px and below the toolbar and the button are shown, and the button is a 44 px target', () => {
    const at = css.indexOf('@media (max-width: 1024px)')
    expect(at).toBeGreaterThan(-1)
    const block = css.slice(at, css.indexOf('\n}\n', at) + 3)
    expect(block).toMatch(/\.toolbar\s*\{[^}]*display:\s*inline-flex/)
    expect(block).toMatch(/\.blockActions\s*\{[^}]*display:\s*inline-flex/)
    expect(block).toMatch(/\.blockActions\s*\{[^}]*min-width:\s*var\(--tap-min, 44px\)/)
    expect(block).toMatch(/\.blockActions\s*\{[^}]*min-height:\s*var\(--tap-min, 44px\)/)
  })

  it('the embed mounts it in its toolbar, never while drawing, and loads it only on the touch tier', () => {
    expect(view).toMatch(/\{!annotate && touchTier && \(/)
    expect(view).toContain('<EmbedBlockActions editor={editor} getPos={getPos} deleteNode={deleteNode} className={styles.blockActions} />')
    // a dynamic import, never a static one: nothing of it rides in the first open
    expect(view).toContain("const EmbedBlockActions = lazyLeaf(() => import('./EmbedBlockActions'))")
    expect(view).not.toMatch(/^import EmbedBlockActions/m)
    expect(view).toContain('const touchTier = useIsTouch()')
    expect(view).toMatch(/export default function WidgetEmbedView\(\{[^)]*\bgetPos\b/)
  })
})
