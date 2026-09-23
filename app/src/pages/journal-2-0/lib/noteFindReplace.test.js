// Wave 5 — find AND replace, through the REAL roster (buildExtensions), so the
// callout, toggle and Ask answer containers, their paste/edge plugins and the
// member's own undo history are all the real ones.
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { undo } from '@tiptap/pm/history'
import { buildExtensions } from './tiptap'
import { buildAskInsertNode } from './askInsert'
import { findMatchesInDoc } from './noteFind'

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })
function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content } })
  return editor
}
const P = (...c) => ({ type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x)) })
const bold = (text) => ({ type: 'text', text, marks: [{ type: 'bold' }] })
const texts = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.isTextblock) o.push(n.textContent) }); return o }
const SRC = { n: 1, label: 'NVDA thesis', citation: 'exact', navigation: { kind: 'note', note_id: 'n1' } }

describe('findMatchesInDoc (regex, not a lower-cased index)', () => {
  it('case-insensitive by default; case-sensitive on request', () => {
    const ed = mount([P('Margins, margins, MARGINS.')])
    expect(findMatchesInDoc(ed.state.doc, 'margins')).toHaveLength(3)
    expect(findMatchesInDoc(ed.state.doc, 'margins', { caseSensitive: true })).toHaveLength(1)
  })

  it('a term with regex characters is matched literally', () => {
    const ed = mount([P('Target $5.00 (est) not $5x00 est')])
    expect(findMatchesInDoc(ed.state.doc, '$5.00 (est)')).toEqual([{ from: 8, to: 19 }])
  })

  it('a character whose lower case is LONGER does not shift the range (the old index did)', () => {
    // 'İ' (U+0130) lower-cases to two code units; every later offset in a
    // lower-cased copy is one too far.
    const ed = mount([P('İstanbul margin')])
    const [m] = findMatchesInDoc(ed.state.doc, 'margin')
    expect(ed.state.doc.textBetween(m.from, m.to)).toBe('margin')
  })
})

describe('Replace (one)', () => {
  it('replaces the ACTIVE match, keeps its marks, and moves to the next', () => {
    const ed = mount([P('Buy ', bold('NVDA'), ' and more NVDA later.')])
    ed.commands.noteFindSet('nvda')
    expect(ed.commands.noteFindReplace('AMD')).toBe(true)
    expect(texts(ed)).toEqual(['Buy AMD and more NVDA later.'])
    // the bold survives on the replacement
    let boldText = null
    ed.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'bold')) boldText = n.text })
    expect(boldText).toBe('AMD')
    expect(ed.storage.noteFind.matches).toHaveLength(1)
    expect(ed.storage.noteFind.activeIndex).toBe(0)
  })

  it('a replacement that contains the term advances past it (never loops on its own text)', () => {
    const ed = mount([P('a b a')])
    ed.commands.noteFindSet('a')
    ed.commands.noteFindReplace('aa')
    expect(texts(ed)).toEqual(['aa b a'])
    const { matches, activeIndex } = ed.storage.noteFind
    expect(ed.state.doc.textBetween(matches[activeIndex].from, matches[activeIndex].to)).toBe('a')
    expect(matches[activeIndex].from).toBe(6) // the original second "a", not inside "aa"
  })

  it('each replace is its own undo step -- even two ADJACENT ones, which history would otherwise join', () => {
    const ed = mount([P('xx')])
    ed.commands.noteFindSet('x')
    ed.commands.noteFindReplace('1')
    ed.commands.noteFindReplace('2')
    expect(texts(ed)).toEqual(['12'])
    undo(ed.state, ed.view.dispatch)
    expect(texts(ed)).toEqual(['1x'])
  })

  it('an empty replacement deletes exactly the match -- never the paragraph around it', () => {
    const ed = mount([P('Keep'), P('gone'), P('Keep too')])
    ed.commands.noteFindSet('gone')
    ed.commands.noteFindReplace('')
    expect(texts(ed)).toEqual(['Keep', '', 'Keep too'])
  })

  it('⛔ a stale match is never written over: an edit elsewhere moves the text, and Replace re-finds first', () => {
    const ed = mount([P('alpha beta alpha')])
    ed.commands.noteFindSet('beta')
    // The member types at the start while the bar still holds the old range.
    ed.commands.insertContentAt(1, 'NEW ')
    expect(ed.commands.noteFindReplace('GAMMA')).toBe(false) // shown the moved match, nothing written
    expect(texts(ed)).toEqual(['NEW alpha beta alpha'])
    expect(ed.commands.noteFindReplace('GAMMA')).toBe(true)
    expect(texts(ed)).toEqual(['NEW alpha GAMMA alpha'])
  })

  it('a case-sensitive replace leaves other cases alone', () => {
    const ed = mount([P('Fed fed FED')])
    ed.commands.noteFindSet('fed', { caseSensitive: true })
    ed.commands.noteFindReplaceAll('X')
    expect(texts(ed)).toEqual(['Fed X FED'])
  })

  it('a read-only editor replaces nothing', () => {
    const ed = mount([P('x')])
    ed.setEditable(false)
    ed.commands.noteFindSet('x')
    expect(ed.commands.noteFindReplace('y')).toBe(false)
    expect(ed.commands.noteFindReplaceAll('y')).toBe(false)
    expect(texts(ed)).toEqual(['x'])
  })
})

describe('Replace all', () => {
  it('replaces every match in ONE undo step -- one undo restores all of them, and nothing else', () => {
    const ed = mount([P('margin one'), P('margin two, margin')])
    // Typed a moment before, RIGHT BESIDE the last match (the first one a
    // back-to-front replace writes): history joins adjacent steps inside its
    // grouping window, so without a closed history the undo below would take
    // this typing away with the replacements.
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, '!')
    ed.commands.noteFindSet('margin')
    expect(ed.commands.noteFindReplaceAll('spread')).toBe(true)
    expect(ed.storage.noteFind.lastReplaced).toBe(3)
    expect(texts(ed)).toEqual(['spread one', 'spread two, spread!'])
    undo(ed.state, ed.view.dispatch)
    expect(texts(ed)).toEqual(['margin one', 'margin two, margin!'])
  })

  it('works INSIDE a callout, a toggle (title and body) and an Ask answer, leaving each container whole', () => {
    const INSERT = buildAskInsertNode({ answer: 'Margins fell [1].', sources: [SRC], question: 'q', scope: 'note', insertedAt: '2026-09-22T12:00:00.000Z' })
    const ed = mount([
      P('Margins outside.'),
      { type: 'callout', attrs: { emoji: '🔥' }, content: [P('Callout margins.')] },
      { type: 'toggle', attrs: { open: true }, content: [
        { type: 'toggleSummary', content: [{ type: 'text', text: 'Margins title' }] },
        { type: 'toggleContent', content: [P('Body margins.')] },
      ] },
      INSERT,
    ])
    ed.commands.noteFindSet('margins')
    expect(ed.commands.noteFindReplaceAll('Spreads')).toBe(true)
    // The answer's edge filter (askInsertNode.jsx) accepted every step: all
    // five are replaced, including the one inside the answer.
    const all = texts(ed).join(' | ')
    expect(all).not.toMatch(/margins/i)
    for (const t of ['Spreads outside.', 'Callout Spreads.', 'Spreads title', 'Body Spreads.', 'Spreads fell']) expect(all).toContain(t)
    expect(ed.storage.noteFind.lastReplaced).toBe(5)
    const types = []
    ed.state.doc.forEach((n) => types.push(n.type.name))
    expect(types.slice(0, 4)).toEqual(['paragraph', 'callout', 'toggle', 'askInsert'])
    ed.state.doc.check()
  })

  it('an empty replacement inside an Ask answer\'s ONLY paragraph leaves the answer standing', () => {
    const INSERT = buildAskInsertNode({ answer: 'drop', sources: [], question: 'q', scope: 'note', insertedAt: '2026-09-22T12:00:00.000Z' })
    const ed = mount([P('Mine.'), INSERT])
    ed.commands.noteFindSet('drop')
    ed.commands.noteFindReplaceAll('')
    let answers = 0
    ed.state.doc.descendants((n) => { if (n.type.name === 'askInsert') answers += 1 })
    expect(answers).toBe(1)
    expect(texts(ed)[0]).toBe('Mine.')
  })
})
