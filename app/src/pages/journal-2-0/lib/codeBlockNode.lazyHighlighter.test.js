// Wave 7 (lane I3) — the code highlighter is fetched ON DEMAND.
//
// highlight.js core + 19 grammars + lowlight (~100 KB) used to ship in the editor
// chunk of every note. Now the decoration plugin (codeBlockNode.js) asks for them
// through ONE door, `codeLanguages.highlighterLoader.load`, the first time a document
// holds a code block. Two rails, failing for different reasons:
//   * behaviour: a note without a code block never calls the door; one with a code
//     block calls it once, shows plain text until it resolves, then colours;
//   * structure: no module the editor imports EAGERLY names the highlighter, so the
//     bundler cannot pull it back into the first open (a static import anywhere on the
//     path would, and the behaviour rail alone would not notice).
// This file must stay its own module: the loader is page-wide state, and the
// behaviour rail needs it fresh.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { highlighterLoader, loadHighlighter } from './codeLanguages'

const JsxParser = Parser.extend(jsx())

let editors = []
afterEach(() => { editors.forEach((e) => e.destroy()); editors = []; document.body.innerHTML = '' })

function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const ed = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content } })
  editors.push(ed)
  return ed
}
const P = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const CODE = (text, language) => ({ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text }] })
const hljsSpans = (ed) => [...ed.view.dom.querySelectorAll('[class*="hljs-"]')]

describe('the highlighter is fetched only for a note that holds a code block', () => {
  it('no code block: never fetched; the first code block: fetched once, plain until it lands', async () => {
    const spy = vi.spyOn(highlighterLoader, 'load')
    const prose = mount([P('Breakout over the pivot'), P('stop under the swing low')])
    // typing prose, headings, a list: still nothing to highlight, still no fetch
    prose.commands.setTextSelection(3)
    prose.commands.insertContent('more words ')
    prose.commands.toggleHeading({ level: 2 })
    await new Promise((r) => setTimeout(r, 0))
    expect(spy).not.toHaveBeenCalled()

    // control: the same page opening a note WITH a code block fetches it, once
    const code = mount([P('setup'), CODE('def total(xs):\n    return sum(xs)', 'python')])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(hljsSpans(code)).toEqual([])            // plain <pre> text until it arrives
    await loadHighlighter()
    await new Promise((r) => setTimeout(r, 0))
    expect(hljsSpans(code).some((s) => s.className.includes('hljs-keyword'))).toBe(true)

    // a later code block, anywhere, reuses it: no second fetch
    const again = mount([CODE('select 1', 'sql')])
    expect(hljsSpans(again).length).toBeGreaterThan(0)   // highlighted at once
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

// ── structure: nothing the editor imports eagerly names the highlighter ─────────
const LIB = path.resolve(__dirname)
const HEAVY = (spec) => spec === './codeHighlight' || spec.startsWith('highlight.js') || spec === 'lowlight'
  || spec === '@tiptap/extension-code-block-lowlight'

const parse = (file) => JsxParser.parse(fs.readFileSync(path.join(LIB, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })

function staticImports(file) {
  return parse(file).body.filter((n) => n.type === 'ImportDeclaration' || (n.type.startsWith('Export') && n.source))
    .map((n) => n.source.value)
}

function dynamicImports(file) {
  const out = []
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'ImportExpression' && n.source.type === 'Literal') out.push(n.source.value)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  }
  visit(parse(file))
  return out
}

describe('no eager editor module imports the highlighter statically', () => {
  it('codeBlockNode.js and tiptap.js name none of it; codeLanguages.js imports nothing at all', () => {
    for (const file of ['codeBlockNode.js', 'tiptap.js']) {
      const imports = staticImports(file)
      expect(imports.length, `${file}: the parse found no imports at all`).toBeGreaterThan(0)
      expect(imports.filter(HEAVY), file).toEqual([])
    }
    expect(staticImports('codeLanguages.js')).toEqual([])
  })

  it('control: the detector sees codeHighlight.js\'s own static imports of it', () => {
    expect(staticImports('codeHighlight.js').filter(HEAVY)).toEqual(
      expect.arrayContaining(['highlight.js/lib/core', 'lowlight', 'highlight.js/lib/languages/python']))
  })

  it('the one door is a dynamic import of ./codeHighlight, in codeLanguages.js only', () => {
    expect(dynamicImports('codeLanguages.js')).toEqual(['./codeHighlight'])
    expect(dynamicImports('codeBlockNode.js')).toEqual([])
  })
})
