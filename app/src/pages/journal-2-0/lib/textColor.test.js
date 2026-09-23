// Wave 5 — text colour + highlight: a palette NAME, rendered through classes,
// readable in both themes. Against the REAL roster (buildExtensions).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { NOTE_COLORS, paletteName } from './textColor'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_CSS = fs.readFileSync(path.join(HERE, 'noteContent.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const TOKENS_CSS = fs.readFileSync(path.resolve(HERE, '../../../styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// jsdom has no ClipboardEvent; EditorView.pasteText constructs one.
if (typeof globalThis.ClipboardEvent === 'undefined') {
  globalThis.ClipboardEvent = class extends Event {
    constructor(type, opts) { super(type, opts); this.clipboardData = (opts && opts.clipboardData) || null }
  }
}

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })
function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content })
  return editor
}
const marksOf = (ed, type) => {
  const out = []
  ed.state.doc.descendants((n) => { if (n.isText) for (const m of n.marks) if (m.type.name === type) out.push([n.text, m.attrs.color]) })
  return out
}
// Type through the same door a keyboard uses, so input rules run.
function typeText(ed, text) {
  for (const ch of text) {
    const { from, to } = ed.state.selection
    const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)))
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to))
  }
}
const selectWord = (ed, word) => {
  let from = null
  ed.state.doc.descendants((n, pos) => { if (from == null && n.isText && n.text.includes(word)) from = pos + n.text.indexOf(word) })
  ed.commands.setTextSelection({ from, to: from + word.length })
}

describe('stored as a palette NAME, never a colour value', () => {
  it('setTextColor stores the name and renders a class -- no inline style', () => {
    const ed = mount('<p>Margins widened.</p>')
    selectWord(ed, 'Margins')
    expect(ed.commands.setTextColor('red')).toBe(true)
    expect(marksOf(ed, 'textColor')).toEqual([['Margins', 'red']])
    const html = ed.getHTML()
    expect(html).toContain('data-text-color="red"')
    expect(html).toContain('class="uct-tc uct-tc-red"')
    expect(html).not.toMatch(/style="[^"]*color/)
  })

  it('a value outside the palette is refused (a hex, a foreign name)', () => {
    const ed = mount('<p>Margins widened.</p>')
    selectWord(ed, 'Margins')
    expect(ed.commands.setTextColor('#ff0000')).toBe(false)
    expect(ed.commands.setTextColor('purple')).toBe(false)
    expect(marksOf(ed, 'textColor')).toEqual([])
    expect(paletteName(' Red ')).toBe('red')
    expect(paletteName('rgb(255,0,0)')).toBe(null)
  })

  it('a highlight stores its name too, and the default highlight stores none', () => {
    const ed = mount('<p>Guidance raised sharply.</p>')
    selectWord(ed, 'raised')
    ed.commands.setHighlight({ color: 'green' })
    selectWord(ed, 'sharply')
    ed.commands.toggleHighlight()
    expect(marksOf(ed, 'highlight')).toEqual([['raised', 'green'], ['sharply', null]])
    const html = ed.getHTML()
    expect(html).toContain('<mark data-color="green" class="uct-hl uct-hl-green">raised</mark>')
    expect(html).toContain('<mark class="uct-hl">sharply</mark>')
    expect(html).not.toContain('background-color')
  })

  it('HTML round-trips both marks', () => {
    const ed = mount('<p><span data-text-color="blue" class="uct-tc uct-tc-blue">a</span> <mark data-color="orange" class="uct-hl uct-hl-orange">b</mark></p>')
    expect(marksOf(ed, 'textColor')).toEqual([['a', 'blue']])
    expect(marksOf(ed, 'highlight')).toEqual([['b', 'orange']])
  })

  it('foreign colours from another app keep the words and drop the arbitrary colour', () => {
    const ed = mount('<p><span style="color: #ff00ff">pink</span> <span data-text-color="purple">violet</span> <mark style="background-color: #ffff00">marked</mark></p>')
    expect(ed.state.doc.textContent).toBe('pink violet marked')
    expect(marksOf(ed, 'textColor')).toEqual([])
    // A foreign <mark> is still a highlight -- the default one, never a stored hex.
    expect(marksOf(ed, 'highlight')).toEqual([['marked', null]])
  })
})

describe('keyboard', () => {
  it('Mod-Shift-H toggles the default highlight', () => {
    const ed = mount('<p>Guidance raised.</p>')
    selectWord(ed, 'raised')
    const ev = new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, shiftKey: true })
    expect(ed.view.someProp('handleKeyDown', (f) => f(ed.view, ev))).toBe(true)
    expect(marksOf(ed, 'highlight')).toEqual([['raised', null]])
  })

  it('typing ==text== highlights it (the same syntax the Markdown export writes)', () => {
    const ed = mount('<p></p>')
    ed.commands.setTextSelection(1)
    typeText(ed, 'see ==this== and more')
    expect(marksOf(ed, 'highlight')).toEqual([['this', null]])
    // The boundary the member typed is kept, unhighlighted, and so is what follows.
    expect(ed.state.doc.textContent).toBe('see this and more')
  })
})

// S1 (wave-5 review): the stock rules matched ANY `==…==` pair, so a trader's
// comparison lost both operators and highlighted the words between them.
describe('`==` in ordinary text arrives byte-for-byte', () => {
  const COMPARISON = 'if rsi == 30 and macd == 0'

  it('typed: a comparison is never highlighted and keeps both operators', () => {
    const ed = mount('<p></p>')
    ed.commands.setTextSelection(1)
    typeText(ed, `${COMPARISON} then buy`)
    expect(ed.state.doc.textContent).toBe(`${COMPARISON} then buy`)
    expect(marksOf(ed, 'highlight')).toEqual([])
  })

  it('pasted: a comparison is never highlighted and keeps both operators', () => {
    const ed = mount('<p></p>')
    ed.commands.setTextSelection(1)
    expect(ed.view.pasteText(COMPARISON)).toBe(true)
    expect(ed.state.doc.textContent).toBe(COMPARISON)
    expect(marksOf(ed, 'highlight')).toEqual([])
  })

  it('pasted: even a well-formed ==pair== stays literal text (there is no paste rule)', () => {
    const ed = mount('<p></p>')
    ed.commands.setTextSelection(1)
    ed.view.pasteText('see ==this== here')
    expect(ed.state.doc.textContent).toBe('see ==this== here')
    expect(marksOf(ed, 'highlight')).toEqual([])
  })

  it.each([
    ['x==y and z==1 ', 'glued to a word on the left'],
    ['a == b == ', 'a space just inside the opening pair'],
    ['see ==this ==. ', 'a space just inside the closing pair'],
  ])('typed %j does not fire (%s)', (typed) => {
    const ed = mount('<p></p>')
    ed.commands.setTextSelection(1)
    typeText(ed, typed)
    expect(ed.state.doc.textContent).toBe(typed)
    expect(marksOf(ed, 'highlight')).toEqual([])
  })

  it('fires on punctuation after the closing pair, and keeps the punctuation', () => {
    const ed = mount('<p></p>')
    ed.commands.setTextSelection(1)
    typeText(ed, '(==two words==), done')
    expect(marksOf(ed, 'highlight')).toEqual([['two words', null]])
    expect(ed.state.doc.textContent).toBe('(two words), done')
  })
})

// N11 (wave-5 review): every door that sets a highlight colour narrows it.
describe('a highlight colour is narrowed to the palette at every door', () => {
  it('setHighlight / toggleHighlight with a hex store the default highlight, a cased name its palette name', () => {
    const ed = mount('<p>alpha beta gamma</p>')
    selectWord(ed, 'alpha')
    ed.commands.setHighlight({ color: '#ff0000' })
    selectWord(ed, 'beta')
    ed.commands.setHighlight({ color: ' Green ' })
    selectWord(ed, 'gamma')
    ed.commands.toggleHighlight({ color: 'rgb(1,2,3)' })
    expect(marksOf(ed, 'highlight')).toEqual([['alpha', null], ['beta', 'green'], ['gamma', null]])
    expect(ed.getHTML()).not.toMatch(/#ff0000|rgb\(|uct-hl-#/)
  })

  it('parse: a cased palette name in data-color is narrowed to the name', () => {
    const ed = mount('<p><mark data-color="Green">up</mark> <span data-text-color="RED">down</span></p>')
    expect(marksOf(ed, 'highlight')).toEqual([['up', 'green']])
    expect(marksOf(ed, 'textColor')).toEqual([['down', 'red']])
  })

  it('JSON content (which never passes parseHTML) cannot render an off-palette colour as a class', () => {
    const ed = mount({
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'hex', marks: [{ type: 'highlight', attrs: { color: '#ff0000' } }] },
        { type: 'text', text: ' tc', marks: [{ type: 'textColor', attrs: { color: 'purple' } }] },
      ] }],
    })
    const html = ed.getHTML()
    expect(html).toContain('<mark class="uct-hl">hex</mark>')
    expect(html).not.toMatch(/#ff0000|uct-hl-#|purple/)
  })
})

describe('readable in BOTH themes: every palette name maps to a token that has a light-theme value', () => {
  // Every custom property that tokens.css redefines under [data-theme="light"].
  const lightBlock = TOKENS_CSS.slice(TOKENS_CSS.indexOf('[data-theme="light"]'))
  const lightTokens = new Set([...lightBlock.slice(0, lightBlock.indexOf('\n}')).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
  const rulesFor = (selector) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return [...CONTENT_CSS.matchAll(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n')
  }

  it('non-vacuity: the light block was found and holds the palette tokens', () => {
    expect(lightTokens.size).toBeGreaterThan(20)
    expect(lightTokens.has('--loss')).toBe(true)
  })

  it.each(NOTE_COLORS.map((c) => c.name))('%s: text colour and highlight both resolve through themed tokens', (name) => {
    const text = rulesFor(`.uct-tc-${name}`)
    const hl = rulesFor(`mark.uct-hl-${name}`)
    expect(text, `.uct-tc-${name} has a rule`).toMatch(/color\s*:/)
    expect(hl, `mark.uct-hl-${name} has a rule`).toMatch(/background-color\s*:/)
    for (const body of [text, hl]) {
      const vars = [...body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1])
      expect(vars.length, `${name} uses a token`).toBeGreaterThan(0)
      // At least one declaration per rule resolves through a token the light
      // theme redefines; no literal colour anywhere in the rule.
      expect(vars.some((v) => lightTokens.has(v)), `${name}: ${vars}`).toBe(true)
      expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    }
  })
})
