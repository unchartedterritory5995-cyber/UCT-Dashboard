// Screen-reader pass 2026-10-09, finding F2: the Table tool bar is ONE Tab stop.
//
// It was `role="toolbar"` with twelve buttons, each its own Tab stop: from the note heading,
// Tab reached the body on the 29th press on a note with a table, while the Editor toolbar two
// stops earlier was one stop with arrow roving (docs/notebook/screen-reader-pass.md, F2).
//
// Two halves, for two reasons. The WIRING is read from the source tree (the shared hook, called
// once, its handlers on the toolbar element) so the bar cannot quietly grow a second arrow
// walk beside the hook. The BEHAVIOUR is measured on a real editor with a real table: exactly
// one enabled control in the Tab order, Left/Right wrap, Home/End jump, Escape still hands
// focus back to the cell. The hook's own cases live in lib/useToolbarRoving.test.jsx.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { useEffect, useReducer } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from '../../lib/tiptap'
import TableToolbar from './TableToolbar'

// ── the wiring, read from the source ───────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, 'TableToolbar.jsx'), 'utf8').replace(/\r\n/g, '\n')
const AST = Parser.extend(jsx()).parse(SRC, { ecmaVersion: 'latest', sourceType: 'module' })

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit))
    else if (v && typeof v.type === 'string') walk(v, visit)
  }
}
const attr = (el, name) => el.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name)
const text = (n) => SRC.slice(n.start, n.end)

const toolbars = []
walk(AST, (n) => {
  if (n.type === 'JSXOpeningElement' && attr(n, 'role')?.value?.value === 'toolbar') toolbars.push(n)
})

describe('F2 wiring: the table toolbar is wired to the one-stop hook', () => {
  it('NON-VACUITY: there is exactly one toolbar element in the file', () => {
    expect(toolbars.length).toBe(1)
    expect(text(attr(toolbars[0], 'aria-label').value)).toContain('TABLE_TOOLBAR_LABEL')
  })

  it('it takes the hook\'s focus handler, and its key handler reaches the hook\'s', () => {
    const el = toolbars[0]
    expect(text(attr(el, 'onFocus').value)).toBe('{rovingFocus}')
    expect(text(attr(el, 'onKeyDown').value)).toBe('{onBarKeyDown}')
    expect(SRC).toMatch(/rovingKeyDown\(e\)/)
  })

  it('the hook\'s ref is the DOM ref, and the bar\'s own placement ref is mirrored from it', () => {
    expect(text(attr(toolbars[0], 'ref').value)).toBe('{rovingRef}')
    // the hook call is destructured, so `rovingRef`, `rovingKeyDown` and `rovingFocus` are its
    const decl = []
    walk(AST, (n) => {
      if (n.type === 'VariableDeclarator' && n.init?.type === 'CallExpression'
        && n.init.callee.name === 'useToolbarRoving') decl.push(n)
    })
    expect(decl.length).toBe(1)
    expect(decl[0].id.type).toBe('ObjectPattern')
    const names = Object.fromEntries(decl[0].id.properties.map((p) => [p.key.name, p.value.name]))
    expect(names).toEqual({ ref: 'rovingRef', onKeyDown: 'rovingKeyDown', onFocus: 'rovingFocus' })
    expect(SRC).toMatch(/barRef\.current = rovingRef\.current/)      // placement + Alt+F10 see the same element
  })

  it('the hook is the shared one, called once, and the hand-rolled arrow walk is gone', () => {
    expect(SRC).toMatch(/import useToolbarRoving from '\.\.\/\.\.\/lib\/useToolbarRoving'/)
    const calls = []
    walk(AST, (n) => { if (n.type === 'CallExpression' && n.callee.name === 'useToolbarRoving') calls.push(n) })
    expect(calls.length).toBe(1)
    // the old walk: a querySelectorAll over the enabled buttons indexed by activeElement
    expect(SRC).not.toMatch(/buttons\.indexOf\(document\.activeElement\)/)
  })
})

// ── the behaviour, on a real editor ────────────────────────────────────────────────────────

let editor
afterEach(() => { cleanup(); editor?.destroy(); editor = null; document.body.innerHTML = '' })

function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content } })
  return editor
}
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const cell = (t, type = 'tableCell') => ({ type, content: [P(t)] })
const row = (...cells) => ({ type: 'tableRow', content: cells })
const TABLE = {
  type: 'table',
  content: [
    row(cell('Sym', 'tableHeader'), cell('R', 'tableHeader')),
    row(cell('NVDA'), cell('2.1')),
    row(cell('AMD'), cell('1.4')),
  ],
}

function Harness({ ed }) {
  const [, bump] = useReducer((x) => x + 1, 0)
  useEffect(() => {
    ed.on('transaction', bump)
    return () => ed.off('transaction', bump)
  }, [ed])
  return <TableToolbar editor={ed} />
}

function caretIn(ed, t) {
  let at = null
  ed.state.doc.descendants((n, pos) => { if (at == null && n.isText && n.text === t) at = pos + 1 })
  act(() => { ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, at))) })
}

function openBar() {
  const ed = mount([P('before'), TABLE])
  render(<Harness ed={ed} />)
  caretIn(ed, 'NVDA')
  const bar = screen.getByRole('toolbar', { name: 'Table' })
  const all = within(bar).getAllByRole('button')
  const enabled = all.filter((b) => !b.disabled)
  return { ed, bar, all, enabled }
}
const key = (k) => fireEvent.keyDown(document.activeElement, { key: k })
const name = (el) => el.getAttribute('aria-label')

describe('F2 behaviour: one Tab stop, arrows within', () => {
  it('exactly one ENABLED control has tabIndex 0 and every other enabled control has -1', () => {
    const { all, enabled } = openBar()
    expect(all.length).toBeGreaterThanOrEqual(10)             // NON-VACUITY: the whole bar rendered
    expect(enabled.length).toBeGreaterThanOrEqual(6)          // and most of it is enabled here
    const stops = enabled.filter((b) => b.tabIndex === 0)
    expect(stops.map(name)).toEqual([name(enabled[0])])      // the FIRST enabled control
    expect(enabled.filter((b) => b.tabIndex === -1).length).toBe(enabled.length - 1)
    // a disabled control is never a Tab stop whatever its tabindex reads
    for (const b of all.filter((b) => b.disabled)) expect(b.disabled).toBe(true)
  })

  it('a disabled control never holds the stop and is never in the roving group', () => {
    const ed = mount([{ type: 'table', content: [row(cell('a'), cell('b'))] }])
    render(<Harness ed={ed} />)
    caretIn(ed, 'a')                                          // the only row: "Delete this row" is off
    const bar = screen.getByRole('toolbar', { name: 'Table' })
    const all = within(bar).getAllByRole('button')
    const disabled = all.filter((b) => b.disabled)
    expect(disabled.map(name)).toContain('Delete this row')   // NON-VACUITY: something IS disabled
    const enabled = all.filter((b) => !b.disabled)
    const stop = all.filter((b) => b.tabIndex === 0 && !b.disabled)
    expect(stop).toEqual([enabled[0]])
    for (const b of disabled) expect(b.hasAttribute('data-roving-item')).toBe(false)
    for (const b of enabled) expect(b.hasAttribute('data-roving-item')).toBe(true)
  })

  it('ArrowRight and ArrowLeft move one enabled control and WRAP at both ends', () => {
    const { enabled } = openBar()
    enabled[0].focus()
    key('ArrowRight')
    expect(document.activeElement).toBe(enabled[1])
    key('ArrowLeft')
    expect(document.activeElement).toBe(enabled[0])
    key('ArrowLeft')                                          // wraps backwards
    expect(document.activeElement).toBe(enabled[enabled.length - 1])
    key('ArrowRight')                                         // wraps forwards
    expect(document.activeElement).toBe(enabled[0])
    // and the stop follows: the focused control is now the ONE in the Tab order
    enabled[2].focus()
    expect(enabled.filter((b) => b.tabIndex === 0)).toEqual([enabled[2]])
  })

  it('Home and End jump to the first and last enabled control', () => {
    const { enabled } = openBar()
    enabled[1].focus()
    key('End')
    expect(document.activeElement).toBe(enabled[enabled.length - 1])
    key('Home')
    expect(document.activeElement).toBe(enabled[0])
  })

  it('Escape still hands focus back to the editor (its own key, not the hook\'s)', () => {
    const { ed, bar, enabled } = openBar()
    const focusEditor = vi.spyOn(ed.view, 'focus')
    enabled[1].focus()
    key('Escape')
    expect(bar.contains(document.activeElement)).toBe(false)
    expect(focusEditor).toHaveBeenCalledTimes(1)
  })

  it('Alt+F10 from the cell lands on the bar\'s ONE stop', () => {
    const { ed, bar, enabled } = openBar()
    enabled[2].focus()                                         // make a later control the stop
    ed.view.dom.focus?.()
    fireEvent.keyDown(ed.view.dom, { key: 'F10', altKey: true })
    expect(bar.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(enabled[2])
    expect(document.activeElement.tabIndex).toBe(0)
  })
})
