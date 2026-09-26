// Wave 5 — code blocks: syntax highlighting + the language picker.
//
// Written against the REAL roster (buildExtensions) so a rail can only pass if
// the node the editor actually runs is the highlighted one.
//
// Wave 7 (lane I3): the highlighter loads ON DEMAND, the first time a document holds
// a code block, so every assertion about COLOUR first waits for it (`settled`). The
// lazy load itself -- never fetched for a note without a code block, plain text until
// it arrives -- is railed in codeBlockNode.lazyHighlighter.test.js, in a fresh module.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { undo } from '@tiptap/pm/history'
import { buildExtensions } from './tiptap'
import { CODE_LANGUAGES, grammarAliases, notebookLowlight } from './codeHighlight'
import { CODE_LANGUAGE_ALIASES, CODE_LANGUAGES as ROSTER, canonicalLanguage, languageLabel, loadHighlighter } from './codeLanguages'
import { CODE_LANGUAGE_PICKER_LABEL } from './codeBlockNode'

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })

function mount(content, opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content }, ...opts })
  return editor
}
const CODE = (text, language) => ({ type: 'codeBlock', attrs: { language: language ?? null }, content: [{ type: 'text', text }] })
const PY = 'def total(xs):\n    return sum(xs)  # add them up'
const hljsSpans = (ed) => [...ed.view.dom.querySelectorAll('[class*="hljs-"]')]
const picker = (ed) => ed.view.dom.querySelector('select.uctCodeLang')
const firstCodePos = (ed) => { let p = null; ed.state.doc.descendants((n, pos) => { if (p == null && n.type.name === 'codeBlock') p = pos }); return p }
// The highlighter has arrived and the plugin's re-decoration has been dispatched.
const settled = async () => { await loadHighlighter(); await new Promise((r) => setTimeout(r, 0)) }

describe('highlighting', () => {
  it('a Python block is coloured by token: `def` is a keyword, the comment is a comment', async () => {
    const ed = mount([CODE(PY, 'python')])
    await settled()
    const kw = hljsSpans(ed).filter((s) => s.className.includes('hljs-keyword')).map((s) => s.textContent)
    expect(kw).toContain('def')
    expect(kw).toContain('return')
    const comments = hljsSpans(ed).filter((s) => s.className.includes('hljs-comment')).map((s) => s.textContent)
    expect(comments).toEqual(['# add them up'])
  })

  it('a block with NO language is plain text — never auto-detected (every keystroke would guess again)', async () => {
    const ed = mount([CODE(PY, null)])
    await settled()
    expect(hljsSpans(ed)).toEqual([])
  })

  it('an alias a pasted fence carries (```py) highlights as its language', async () => {
    const ed = mount([CODE(PY, 'py')])
    await settled()
    expect(hljsSpans(ed).some((s) => s.className.includes('hljs-keyword'))).toBe(true)
  })

  it('a language outside the roster renders as plain text and is KEPT on save', async () => {
    const ed = mount([CODE('plot(close)', 'pinescript')])
    await settled()
    expect(hljsSpans(ed)).toEqual([])
    expect(ed.getJSON().content[0].attrs.language).toBe('pinescript')
  })

  it('highlighting is decoration only: the saved JSON and HTML carry no hljs markup', async () => {
    const ed = mount([CODE(PY, 'python')])
    await settled()
    expect(hljsSpans(ed).length).toBeGreaterThan(0) // non-vacuity: it IS highlighted
    expect(JSON.stringify(ed.getJSON())).not.toContain('hljs')
    expect(ed.getHTML()).not.toContain('hljs')
    expect(ed.getHTML()).toContain('<code class="language-python">')
  })

  it('re-highlights as the member types (a keyword typed into the block is coloured)', async () => {
    const ed = mount([CODE('x = 1', 'python')])
    await settled()
    expect(hljsSpans(ed).filter((s) => s.className.includes('hljs-keyword'))).toEqual([])
    ed.commands.setTextSelection(1)
    ed.commands.insertContent('import os\n')
    const kw = hljsSpans(ed).filter((s) => s.className.includes('hljs-keyword')).map((s) => s.textContent)
    expect(kw).toContain('import')
  })
})

describe('ONE code block in the roster', () => {
  it('StarterKit\'s stock code block is off: no duplicate extension name is registered', () => {
    // With both, TipTap warns and registers BOTH extensions' plugins and keymaps
    // (two Mod-Alt-c toggles, two VS Code paste handlers) while the schema
    // silently keeps whichever came last.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      mount([CODE(PY, 'python')])
      const dupes = warn.mock.calls.map((c) => String(c[0])).filter((m) => /Duplicate extension names/i.test(m))
      expect(dupes).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })
})

describe('the curated roster (no lowlight/common, no auto-detect)', () => {
  it('lowlight holds exactly the picker roster — a grammar added without a picker entry fails here', () => {
    expect([...notebookLowlight.listLanguages()].sort()).toEqual(CODE_LANGUAGES.map((l) => l.id).sort())
    expect(CODE_LANGUAGES.length).toBeGreaterThanOrEqual(15) // non-vacuity
    expect(CODE_LANGUAGES.length).toBeLessThanOrEqual(22)   // curated, not `common`
  })

  it("the eager alias table is exactly the grammars' own aliases (a checked copy, never an authority)", () => {
    expect(CODE_LANGUAGE_ALIASES).toEqual(grammarAliases())
    expect(Object.keys(CODE_LANGUAGE_ALIASES).length).toBeGreaterThan(20) // non-vacuity
  })

  it("the highlighter's roster IS the eager roster, same ids, labels and order", () => {
    expect(CODE_LANGUAGES.map(({ id, label }) => ({ id, label }))).toEqual(ROSTER.map(({ id, label }) => ({ id, label })))
  })

  it('aliases come from the grammars themselves', () => {
    expect(canonicalLanguage('py')).toBe('python')
    expect(canonicalLanguage('TS')).toBe('typescript')
    expect(canonicalLanguage('sh')).toBe('bash')
    expect(canonicalLanguage('html')).toBe('xml')
    expect(canonicalLanguage('pinescript')).toBe(null)
    expect(languageLabel(null)).toBe('Plain text')
    expect(languageLabel('pinescript')).toBe('pinescript')
  })

  it('highlightAuto never colours anything (control: highlight() does)', () => {
    expect(notebookLowlight.highlightAuto('def f(): return 1').children).toEqual([{ type: 'text', value: 'def f(): return 1' }])
    const real = notebookLowlight.highlight('python', 'def f(): return 1')
    expect(JSON.stringify(real)).toContain('hljs-keyword')
  })

  it('no shipped grammar uses a regex LOOKBEHIND outside a comment (Safari < 16.4 throws on one)', () => {
    // The declared floor is iOS 16 (vite.config.js build.target). esbuild lowers a
    // lookbehind LITERAL to `new RegExp(...)`, so it would throw when the grammar
    // compiles -- on the first highlighted block -- instead of at parse time.
    for (const { id, grammar } of CODE_LANGUAGES) {
      const code = grammar.toString().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(code.includes('(?<=') || code.includes('(?<!'), id).toBe(false)
    }
  })
})

describe('the language picker', () => {
  it('offers Plain text + the roster, labelled, with the stored language selected', () => {
    const ed = mount([CODE(PY, 'python')])
    const sel = picker(ed)
    expect(sel.getAttribute('aria-label')).toBe(CODE_LANGUAGE_PICKER_LABEL)
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Plain text', ...CODE_LANGUAGES.map((l) => l.label)])
    expect(sel.value).toBe('python')
  })

  it('an alias shows as its language; an unknown language is offered as itself, selected', () => {
    const ed = mount([CODE('a', 'py'), CODE('b', 'pinescript')])
    const [a, b] = ed.view.dom.querySelectorAll('select.uctCodeLang')
    expect(a.value).toBe('python')
    expect(b.value).toBe('pinescript')
    expect([...b.options].map((o) => o.value)).toContain('pinescript')
  })

  it('choosing a language sets the node attribute (and highlights); undo restores it', async () => {
    const ed = mount([CODE(PY, null)])
    await settled()
    const sel = picker(ed)
    sel.value = 'python'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    expect(ed.getJSON().content[0].attrs.language).toBe('python')
    expect(hljsSpans(ed).some((s) => s.className.includes('hljs-keyword'))).toBe(true)
    undo(ed.state, ed.view.dispatch)
    expect(ed.getJSON().content[0].attrs.language).toBe(null)
  })

  it('choosing "Plain text" stores null (never the string "")', () => {
    const ed = mount([CODE(PY, 'python')])
    const sel = picker(ed)
    sel.value = ''
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    expect(ed.getJSON().content[0].attrs.language).toBe(null)
  })

  it('typing in the block does not rebuild the picker (update() only paints a language change)', () => {
    const ed = mount([CODE('x = 1', 'python')])
    const before = picker(ed).options[1]
    ed.commands.setTextSelection(3)
    ed.commands.insertContent('y')
    expect(picker(ed).options[1]).toBe(before)
  })

  it('Mod-Alt-l moves focus to the picker from inside a code block; Escape hands it back', () => {
    const ed = mount([{ type: 'paragraph', content: [{ type: 'text', text: 'prose' }] }, CODE(PY, 'python')])
    ed.commands.setTextSelection(firstCodePos(ed) + 2)
    const handled = ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, altKey: true })))
    expect(handled).toBe(true)
    expect(document.activeElement).toBe(picker(ed))
    picker(ed).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.activeElement).not.toBe(picker(ed))
  })

  it('Mod-Alt-l outside a code block is not swallowed', () => {
    const ed = mount([{ type: 'paragraph', content: [{ type: 'text', text: 'prose' }] }, CODE(PY, 'python')])
    ed.commands.setTextSelection(2)
    const handled = ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, altKey: true })))
    expect(handled).toBeFalsy()
  })

  it('the picker is chrome: kept out of PNG/print and out of ProseMirror\'s event handling', () => {
    const ed = mount([CODE(PY, 'python')])
    const bar = picker(ed).parentElement
    expect(bar.hasAttribute('data-export-exclude')).toBe(true)
    expect(bar.getAttribute('contenteditable')).toBe('false')
  })
})

describe('read-only renderers (shared page, version preview)', () => {
  it('show the language as a label, with no control', async () => {
    const ed = mount([CODE(PY, 'python'), CODE('plain', null)], { editable: false })
    await settled()
    expect(picker(ed)).toBe(null)
    const labels = [...ed.view.dom.querySelectorAll('.uctCodeLangLabel')]
    expect(labels.map((l) => l.textContent)).toEqual(['Python', 'Plain text'])
    expect(labels[0].parentElement.hidden).toBe(false)
    expect(labels[1].parentElement.hidden).toBe(true) // nothing worth labelling
    // …and still highlight.
    expect(hljsSpans(ed).some((s) => s.className.includes('hljs-keyword'))).toBe(true)
  })
})

// N2 (wave-5 review): the picker's chord comes from the ONE Mac test.
describe('the picker names the platform\'s own chord', () => {
  afterEach(() => { delete navigator.platform })
  it.each([['MacIntel', 'Cmd+Option+L'], ['Win32', 'Ctrl+Alt+L']])('%s -> %s', (platform, chord) => {
    Object.defineProperty(navigator, 'platform', { value: platform, configurable: true })
    const ed = mount([CODE('x = 1', 'python')])
    expect(picker(ed).title).toBe(`${CODE_LANGUAGE_PICKER_LABEL} (${chord})`)
  })
})
