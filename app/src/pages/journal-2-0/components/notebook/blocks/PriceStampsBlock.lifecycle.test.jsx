/**
 * P2a Task 10, pre-merge round (R-T10-4): the stamp plugin's life inside a REAL EditorContent, where the
 * block body is a React node view that mounts and unmounts as transactions move or delete it.
 *
 * - N-1: the last holder's unregister never runs INSIDE a transaction's own `view.updateState` (a node
 *   view created with flushSync flushes the old portal's cleanup re-entrantly). It is deferred to a
 *   microtask that re-checks the holders and `isDestroyed`.
 * - N-2: registering or unregistering a plugin rebuilds every plugin view, and one of them
 *   (notebookPlaceholder) dispatches from its constructor, so each costs exactly ONE meta-only
 *   transaction, and then the editor settles: no further transactions or commits.
 * - N-3: that rebuild also destroys the suggestion plugins' views, whose `onExit` removes an open menu.
 *   So nothing attaches or detaches while a "/", ":", "@" or "[[" menu is open; it waits for it to close.
 * - N-4: a settle with no plugin left dispatches nothing.
 */
import { StrictMode, Profiler } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { buildExtensions } from '../../../lib/tiptap'
import { PRICE_STAMPS_KEY, attachPriceStamps, settle } from '../../../lib/blocks/priceStamps'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../lib/offline/notebookFlags'
import PriceStampsBlock from './PriceStampsBlock'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
document.elementFromPoint = () => null

const stamps = (ed) => ed.state.plugins.filter((p) => p.spec.key === PRICE_STAMPS_KEY).length
const block = (on = 'yes') => ({ type: 'widgetEmbed', attrs: { widgetId: 'priceStamps', params: { on } } })
const para = (t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const menuOpen = (ed) => ed.state.plugins.some((p) => { const s = p.getState(ed.state); return s?.active === true && !!s.range })

function newEditor(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const ed = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content } })
  ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), noteId: 'n1', noteTicker: () => null }
  return ed
}
function mounted(content, { strict = false } = {}) {
  const ed = newEditor(content)
  const tree = <EditorContent editor={ed} />
  render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  return ed
}
/** Records each register / unregister with the `view.updateState` depth it ran at. */
function instrument(ed) {
  const st = { depth: 0, calls: [] }
  const view = ed.view
  const upd = view.updateState.bind(view)
  view.updateState = (s) => { st.depth += 1; try { return upd(s) } finally { st.depth -= 1 } }
  const reg = ed.registerPlugin.bind(ed), unreg = ed.unregisterPlugin.bind(ed)
  ed.registerPlugin = (p, f) => { st.calls.push(['reg', st.depth]); return reg(p, f) }
  ed.unregisterPlugin = (k) => { st.calls.push(['unreg', st.depth]); return unreg(k) }
  return st
}
const consistent = (ed) => {
  expect(ed.view.docView.node).toBe(ed.state.doc)
  expect(ed.view.dom.childNodes.length).toBe(ed.state.doc.childCount)
  expect(ed.view.pluginViews.length).toBe(ed.state.plugins.filter((p) => p.spec.view).length)
}

beforeEach(() => { __resetNotebookFlags(); latchNotebookFlags({ notebook_journal_styles_enabled: true }) })
afterEach(() => { cleanup(); __resetNotebookFlags() })

describe('N-1: the last unregister never runs inside a transaction', () => {
  it('T2: the lone stamps block MOVED in one transaction: no unregister during the update; one plugin once its body re-mounts', async () => {
    const ed = mounted([block(), ...'abcdefg'.split('').map(para)])
    await waitFor(() => expect(stamps(ed)).toBe(1), { timeout: 4000 })
    const st = instrument(ed)
    const node = ed.state.doc.child(0)
    const tr = ed.state.tr.delete(0, node.nodeSize)
    tr.insert(tr.doc.content.size, node)
    ed.view.dispatch(tr)
    expect(st.calls.filter(([, depth]) => depth > 0)).toEqual([])           // nothing re-entrant
    await waitFor(() => expect(st.calls.some(([k]) => k === 'reg')).toBe(true), { timeout: 4000 })
    await tick(50)
    expect(st.calls.every(([, depth]) => depth === 0)).toBe(true)
    expect(stamps(ed)).toBe(1)                                                // exactly one plugin
    expect(ed.state.plugins[0].spec.key).toBe(PRICE_STAMPS_KEY)
    const order = ed.state.doc.content.content.map((n) => n.type.name)
    expect(order.indexOf('widgetEmbed')).toBeGreaterThan(6)                  // it really moved (a trailing paragraph may follow)
    consistent(ed)
  })

  it('T3: deleted in a transaction that creates another node view: no unregister during the update; then none left', async () => {
    const ed = mounted([block(), para('a'), para('b')])
    await waitFor(() => expect(stamps(ed)).toBe(1), { timeout: 4000 })
    const st = instrument(ed)
    const node = ed.state.doc.child(0)
    const other = ed.schema.nodes.widgetEmbed.create({ widgetId: 'preEntryChecklist', params: {} })
    const tr = ed.state.tr.delete(0, node.nodeSize)
    tr.insert(tr.doc.content.size, other)
    ed.view.dispatch(tr)
    expect(st.calls.filter(([, depth]) => depth > 0)).toEqual([])
    await waitFor(() => expect(stamps(ed)).toBe(0))
    await tick(50)
    expect(st.calls).toEqual([['unreg', 0]])
    consistent(ed)
  })

  it('StrictMode, two blocks: one plugin; deleting one keeps it; deleting both lets it go', async () => {
    const ed = mounted([block(), para('a'), block(), para('b')], { strict: true })
    await waitFor(() => expect(stamps(ed)).toBe(1), { timeout: 4000 })
    await tick(100)
    expect(stamps(ed)).toBe(1)
    ed.view.dispatch(ed.state.tr.delete(0, ed.state.doc.child(0).nodeSize))
    await tick(100)
    expect(stamps(ed)).toBe(1)
    let pos = -1
    ed.state.doc.forEach((n, off) => { if (n.type.name === 'widgetEmbed') pos = off })
    ed.view.dispatch(ed.state.tr.delete(pos, pos + ed.state.doc.nodeAt(pos).nodeSize))
    await waitFor(() => expect(stamps(ed)).toBe(0))
  })

  it('a detach after the editor is destroyed does nothing and throws nothing', async () => {
    const ed = newEditor([para('x')])
    const detach = attachPriceStamps(ed)
    ed.destroy()
    expect(() => detach()).not.toThrow()
    await tick()
  })
})

describe('N-2: one meta-only transaction per attach and per detach, then the editor settles (H14)', () => {
  it('in a real EditorContent: register = 1 tx, unregister = 1 tx, both meta-only; nothing more for 600 ms', async () => {
    const ed = newEditor([block(), para('a')])
    const txs = []
    ed.on('transaction', ({ transaction }) => { txs.push(transaction) })
    const cost = { reg: [], unreg: [] }
    const reg = ed.registerPlugin.bind(ed), unreg = ed.unregisterPlugin.bind(ed)
    ed.registerPlugin = (p, f) => { const n = txs.length; const r = reg(p, f); cost.reg.push(txs.slice(n)); return r }
    ed.unregisterPlugin = (k) => { const n = txs.length; const r = unreg(k); cost.unreg.push(txs.slice(n)); return r }
    let commits = 0
    render(<StrictMode><Profiler id="ec" onRender={() => { commits += 1 }}><EditorContent editor={ed} /></Profiler></StrictMode>)
    await waitFor(() => expect(stamps(ed)).toBe(1), { timeout: 4000 })
    expect(cost.reg).toHaveLength(1)
    expect(cost.reg[0]).toHaveLength(1)
    expect(cost.reg[0][0].docChanged).toBe(false)
    const settled = { tx: txs.length, commits }
    await tick(600)
    expect({ tx: txs.length, commits }).toEqual(settled)                       // no loop
    ed.view.dispatch(ed.state.tr.delete(0, ed.state.doc.child(0).nodeSize))   // the member removes the block
    await waitFor(() => expect(stamps(ed)).toBe(0))
    expect(cost.unreg).toHaveLength(1)
    expect(cost.unreg[0]).toHaveLength(1)
    expect(cost.unreg[0][0].docChanged).toBe(false)
    const after = { tx: txs.length, commits }
    await tick(600)
    expect({ tx: txs.length, commits }).toEqual(after)
  })
})

describe('N-3: nothing attaches or detaches while a suggestion menu is open', () => {
  async function openSlash(ed) {
    ed.commands.focus('end')
    ed.commands.insertContent('/')
    await waitFor(() => expect(menuOpen(ed)).toBe(true))
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
  }
  const body = (ed, on = 'yes') => <PriceStampsBlock params={{ on }} setParams={() => true} editable editor={ed} />

  it('a "/" menu open when the stamps body lands: the menu stays; stamping attaches once it closes', async () => {
    const ed = mounted([para('Long $NVDA here'), para('')])
    const listeners = () => (ed.callbacks.transaction || []).length
    const baseline = listeners()
    await openSlash(ed)
    const listbox = document.querySelector('[role="listbox"]')
    render(body(ed))                                                       // the body lands now
    expect(listeners()).toBe(baseline + 1)                                 // it waits on the editor's transactions
    await tick(50)
    expect(stamps(ed)).toBe(0)                                             // deferred
    expect(menuOpen(ed)).toBe(true)
    expect(listbox.isConnected).toBe(true)                                 // the menu was not exited
    // ...and the attach then runs OUTSIDE the transaction that closed the menu, not from inside its dispatch
    const at = { dispatching: 0, reg: [] }
    const dispatch = ed.view.dispatch.bind(ed.view)
    ed.view.dispatch = (tr) => { at.dispatching += 1; try { return dispatch(tr) } finally { at.dispatching -= 1 } }
    const reg = ed.registerPlugin.bind(ed)
    ed.registerPlugin = (p, f) => { at.reg.push(at.dispatching); return reg(p, f) }
    ed.commands.undo()                                                     // the "/" goes: the menu closes
    await waitFor(() => expect(menuOpen(ed)).toBe(false))
    await waitFor(() => expect(stamps(ed)).toBe(1))
    expect(ed.state.plugins[0].spec.key).toBe(PRICE_STAMPS_KEY)
    expect(listeners()).toBe(baseline)                                     // ...and stops listening once it has run
    expect(at.reg).toEqual([0])
  })

  it('the block let go while a menu is open: the menu stays; the plugin goes once it closes', async () => {
    const ed = mounted([para('Long $NVDA here'), para('')])
    const r = render(body(ed))
    expect(stamps(ed)).toBe(1)
    await openSlash(ed)
    const listbox = document.querySelector('[role="listbox"]')
    r.unmount()
    await tick(50)
    expect(stamps(ed)).toBe(1)                                             // deferred
    expect(listbox.isConnected).toBe(true)
    ed.commands.undo()
    await waitFor(() => expect(menuOpen(ed)).toBe(false))
    await waitFor(() => expect(stamps(ed)).toBe(0))
  })
})

describe('N-4: a settle with no plugin left dispatches nothing', () => {
  it('no transaction once the plugin is gone; one while it is there', async () => {
    const ed = newEditor([para('x')])
    let tx = 0
    ed.on('transaction', () => { tx += 1 })
    settle(ed, 7)
    expect(tx).toBe(0)
    const detach = attachPriceStamps(ed)
    const before = tx
    settle(ed, 7)
    expect(tx).toBe(before + 1)                                            // CONTROL: it does dispatch then
    detach()
    await waitFor(() => expect(stamps(ed)).toBe(0))
  })
})
