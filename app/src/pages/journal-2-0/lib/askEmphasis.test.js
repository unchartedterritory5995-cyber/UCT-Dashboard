// Finish program, lane AI-FE, K3. The model writes Markdown bold and italic; the Ask panel and
// the block inserted into a note showed the asterisks as text. `styledParts` is the ONE
// reading both surfaces use: the marks become flags on plain text runs, the asterisks are
// dropped, citations stay where they were, and anything that is not a clean pair stays
// exactly as the model wrote it.
import { describe, it, expect } from 'vitest'
import { emphasisRuns, styledParts } from './askEmphasis'
import { buildAskInsertNode, claimFromJson } from './askInsert'
import { splitAnswer } from './askCitation'

const SRC1 = { n: 1, label: 'CRWD plan', citation: 'exact', navigation: { kind: 'note', note_id: 'n1' } }
const SRC2 = { n: 2, label: 'CRWD review', citation: 'exact', navigation: { kind: 'note', note_id: 'n2' } }
const AT = '2026-10-07T12:00:00.000Z'

const read = (answer, sources = []) => styledParts(answer, sources)
  .map((p) => (p.source ? `<${p.source.n}>` : `${p.bold ? 'B' : ''}${p.italic ? 'I' : ''}(${p.text})`)).join('')

describe('styledParts: bold and italic become flags, the asterisks go', () => {
  it('the walk’s own line', () => {
    expect(read('**Planned entry (breakout plan):** above 412 [1].', [SRC1]))
      .toBe('B(Planned entry (breakout plan):)( above 412 )<1>(.)')
  })

  it('italic, and bold-italic', () => {
    expect(read('It was *not* a ***clean*** break.')).toBe('(It was )I(not)( a )BI(clean)( break.)')
  })

  it('emphasis that runs across a citation keeps the chip and hides both markers', () => {
    expect(read('**Stop raised [1] to breakeven** after the report.', [SRC1]))
      .toBe('B(Stop raised )<1>B( to breakeven)( after the report.)')
  })

  it('every line is read on its own: a pair never spans a line break', () => {
    expect(read('**open\nclose**')).toBe('(**open\nclose**)')
  })
})

describe('styledParts: anything that is not a clean pair stays literal', () => {
  it.each([
    ['a list bullet', '* first\n* second'],
    ['arithmetic', '5 * 3 * 2 = 30'],
    ['arithmetic without spaces', '5*3*2'],
    ['a lone marker', 'up 4%** on the day'],
    ['an unclosed pair (still streaming)', '**Planned entry'],
    ['markers around spaces', '** not bold **'],
    ['a footnote star', 'the stop* was moved'],
    ['mismatched counts', '***x**'],
    ['empty', '****'],
  ])('%s', (_name, text) => {
    expect(styledParts(text, []).map((p) => p.text).join('')).toBe(text)
    expect(styledParts(text, []).some((p) => p.bold || p.italic)).toBe(false)
  })

  it('underscores are never read as emphasis (snake_case, tickers, file names)', () => {
    expect(read('see __init__ and my_note_v2')).toBe('(see __init__ and my_note_v2)')
  })

  it('an HTML-looking answer is still only text', () => {
    const parts = styledParts('**<img src=x onerror=alert(1)>**', [])
    expect(parts).toEqual([{ text: '<img src=x onerror=alert(1)>', bold: true, italic: false }])
  })
})

describe('styledParts: citations are exactly splitAnswer’s', () => {
  it.each([
    'Margins fell [1]. **Guidance** held [2].',
    '**A [1]** and *B [2]* and [9] invented.',
    'no marks at all [1][2]',
  ])('%s', (answer) => {
    const before = splitAnswer(answer, [SRC1, SRC2]).filter((p) => p.source).map((p) => [p.text, p.source.n])
    const after = styledParts(answer, [SRC1, SRC2]).filter((p) => p.source).map((p) => [p.text, p.source.n])
    expect(after).toEqual(before)
  })

  it('with no markers the parts are splitAnswer’s, text for text', () => {
    const answer = 'Margins fell [1].\n\nGuidance held [2].'
    expect(styledParts(answer, [SRC1, SRC2]).map((p) => p.text))
      .toEqual(splitAnswer(answer, [SRC1, SRC2]).map((p) => p.text))
  })

  it('emphasisRuns covers every character that is not a marker, in order', () => {
    const answer = 'a **b** c *d* e'
    expect(emphasisRuns(answer).map((r) => answer.slice(r.start, r.end)).join('')).toBe('a b c d e')
  })
})

describe('buildAskInsertNode: the note gets the editor’s own bold and italic marks', () => {
  it('marks on text nodes, no asterisks, chips unchanged', () => {
    const node = buildAskInsertNode({
      answer: '**Planned entry:** above 412 [1].\n*After the report* the stop went to breakeven [2].',
      sources: [SRC1, SRC2], question: 'q', scope: 'notebook', insertedAt: AT,
    })
    const [p1, p2] = node.content
    expect(p1.content[0]).toEqual({ type: 'text', text: 'Planned entry:', marks: [{ type: 'bold' }] })
    expect(p1.content[1]).toEqual({ type: 'text', text: ' above 412 ' })
    expect(p1.content[2].type).toBe('askCitation')
    expect(p1.content[2].attrs.n).toBe(1)
    expect(p2.content[0]).toEqual({ type: 'text', text: 'After the report', marks: [{ type: 'italic' }] })
    expect(JSON.stringify(node)).not.toContain('*')
  })

  it('the claim a chip stores is the paragraph’s text without the markers, as the editor will read it', () => {
    const node = buildAskInsertNode({ answer: '**Stop** raised [1] to *breakeven*.', sources: [SRC1], insertedAt: AT })
    const chip = node.content[0].content.find((n) => n.type === 'askCitation')
    expect(chip.attrs.claim).toBe('Stop raised to breakeven.')
    expect(chip.attrs.claim).toBe(claimFromJson(node.content[0].content))
  })

  it('bold-italic carries both marks', () => {
    const node = buildAskInsertNode({ answer: '***both*** [1]', sources: [SRC1], insertedAt: AT })
    expect(node.content[0].content[0].marks).toEqual([{ type: 'bold' }, { type: 'italic' }])
  })

  it('control: an answer with no markers builds exactly what it did before', () => {
    const node = buildAskInsertNode({ answer: 'Margins fell [1].\n\nGuidance held [2].', sources: [SRC1, SRC2], insertedAt: AT })
    expect(node.content.map((p) => p.content.map((n) => n.text || `[${n.attrs.n}]`).join('')))
      .toEqual(['Margins fell [1].', 'Guidance held [2].'])
    expect(JSON.stringify(node)).not.toContain('marks')
  })
})

// ── in the real editor: the marks are the editor's own, and a chip does not read as edited ──
describe('an answer with emphasis, inserted into the real editor', () => {
  it('keeps bold and italic as marks and leaves every chip un-stale', async () => {
    const { Editor } = await import('@tiptap/core')
    const { buildExtensions } = await import('./tiptap')
    const { appendAskInsert } = await import('./askInsert')
    const { askCitationStaleKey } = await import('./askCitationNode')
    const el = document.createElement('div')
    document.body.appendChild(el)
    const editor = new Editor({ element: el, extensions: buildExtensions(), content: '<p>mine</p>' })
    try {
      const node = buildAskInsertNode({
        answer: '**Planned entry:** above 412 [1].\n*After the report* the stop went to breakeven [2].',
        sources: [SRC1, SRC2], question: 'q', scope: 'notebook', insertedAt: AT,
      })
      expect(appendAskInsert(editor, node)).toBe(true)
      const json = editor.getJSON()
      const insert = json.content.find((n) => n.type === 'askInsert')
      expect(insert.content[0].content[0]).toEqual({ type: 'text', text: 'Planned entry:', marks: [{ type: 'bold' }] })
      expect(insert.content[1].content[0]).toEqual({ type: 'text', text: 'After the report', marks: [{ type: 'italic' }] })
      expect(editor.getText()).not.toContain('*')
      // the stale decoration compares the stored claim with the live paragraph's text
      expect(askCitationStaleKey.getState(editor.state).find()).toHaveLength(0)
    } finally {
      editor.destroy()
      el.remove()
    }
  })
})
