// Finish program, lane KEYS round 3. The editor's formatting toolbar is ONE Tab stop.
//
// It was already `role="toolbar"`, and every one of its sixteen controls was its own Tab stop:
// a keyboard member going from the note's header to its title, or from the body up to
// "More note actions", pressed Tab sixteen times to get past it (measured: Q18's 39 Tabs to
// a block in the note, Q2's walk to the Ticker field, Q12's walk to More).
//
// The behaviour itself (one stop, Left and Right, Home and End, every control reachable, the
// stop follows focus) is tested on the hook's first user,
// WidgetEmbedView.toolbarOneStop.test.jsx. This file pins the WIRING: NoteEditorPage is too
// large to mount for one attribute, so the source is parsed and the toolbar element is read
// from the tree, never matched as text.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, 'NoteEditorPage.jsx'), 'utf8').replace(/\r\n/g, '\n')
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
  if (n.type !== 'JSXOpeningElement') return
  const role = attr(n, 'role')
  if (role?.value?.value === 'toolbar' && attr(n, 'aria-label')?.value?.value === 'Editor toolbar') toolbars.push(n)
})

describe('the editor toolbar is wired to the one-stop hook', () => {
  it('NON-VACUITY: there is exactly one element that is the editor toolbar', () => {
    expect(toolbars.length).toBe(1)
  })

  it('it takes the hook\'s key handler and focus handler', () => {
    const el = toolbars[0]
    expect(text(attr(el, 'onKeyDown').value)).toContain('editorToolbarRoving.onKeyDown')
    expect(text(attr(el, 'onFocus').value)).toContain('editorToolbarRoving.onFocus')
  })

  it('its ref reaches BOTH the hook and the ref the page already used', () => {
    const ref = text(attr(toolbars[0], 'ref').value)
    expect(ref).toContain('editorToolbarRoving.ref')
    expect(ref).toContain('toolbarRowRef')
  })

  it('the hook is the shared one, called once', () => {
    expect(SRC).toMatch(/import useToolbarRoving from '\.\.\/\.\.\/lib\/useToolbarRoving'/)
    const calls = []
    walk(AST, (n) => { if (n.type === 'CallExpression' && n.callee.name === 'useToolbarRoving') calls.push(n) })
    expect(calls.length).toBe(1)
  })
})
