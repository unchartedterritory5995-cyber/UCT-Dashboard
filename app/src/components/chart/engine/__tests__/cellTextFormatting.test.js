// app/src/components/chart/engine/__tests__/cellTextFormatting.test.js
//
// ─── ⭐⭐ `text_formatting` — THE HEADER ROW KEEPS ITS BOLD ───────────────────
//
// The acceptance dashboard bolds its entire header row:
//
//     table.cell(dashboard, 0, 0, "Symbol", …, text_formatting = text.format_bold)
//
// `text_formatting` was not in `CELL_PROPS`, and the cell converter skips an
// unrecognised property with a bare `continue` — no value read, no `dropProp`,
// no diagnostic entry. So the bold was dropped more quietly than `table.clear`
// ever was: that at least appeared in `unsupported`, while this left no trace
// anywhere. The table rendered, every cell held the right text, and the one
// row the author had marked as headings looked exactly like the data.
//
// ⛔⛔ TWO HALVES, AND EITHER ALONE IS A LIE. Carrying the property into the
// program while the renderer ignores it is "built, tested, green and
// unreachable"; teaching the renderer a weight nothing ever sets is dead code.
// This file asserts the translation AND the rendered style, and pairs each
// with a control that must read NOT-bold — otherwise "the header is bold" is
// satisfied by a renderer that bolds everything.
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'

import { translatePine } from '../ast/pine.js'
import { layoutTables } from '../objectCanvas'
import { renderTables } from '../objectTableDom'

const dom = new JSDOM('<!doctype html><div id="root"></div>')
const doc = dom.window.document
const freshRoot = () => {
  const el = doc.createElement('div')
  doc.body.appendChild(el)
  return el
}

const table = (cells, extra = {}) => ({
  id: 1, position: 'top_right', bgcolor: 'transparent', ...extra, cells,
})
const cell = (col, row, text, extra = {}) => ({
  col, row, text, text_color: '#fff', text_size: 'normal', ...extra,
})

/** Render one table and hand back its `<td>`s. */
const tds = (cells) => {
  const root = freshRoot()
  renderTables(root, layoutTables({ tables: [table(cells)] }), doc)
  return [...root.querySelectorAll('td')]
}

const HEAD = '//@version=6\nindicator("t", overlay = true)\n'

/** The cell props the translator carried, for the one cell in `src`. */
const cellProps = (src) => {
  const t = translatePine(HEAD + src, { strict: true })
  const op = (t.objects.ops || []).find((o) => o.k === 'cell')
  return op ? Object.keys(op.props || {}) : null
}

describe('⭐⭐ a bold cell survives TRANSLATION', () => {
  it('⛔ CONTROL — the same cell without it carries no formatting', () => {
    // If this ever lists `text_formatting`, the assertion below passes for the
    // wrong reason: every cell would carry it regardless of what was written.
    const props = cellProps('var t = table.new(position.top_right, 1, 1)\n'
      + 'table.cell(t, 0, 0, str.tostring(close), text_color = color.black)\n')
    expect(props).not.toContain('text_formatting')
  })

  it('⭐⭐ `text_formatting = text.format_bold` reaches the program', () => {
    const props = cellProps('var t = table.new(position.top_right, 1, 1)\n'
      + 'table.cell(t, 0, 0, str.tostring(close), text_formatting = text.format_bold)\n')
    expect(props).toContain('text_formatting')
  })

  it('⭐⭐ and so does a COMPUTED one — bold this row, plain the next', () => {
    // ⭐ THIS CASE EXISTS BECAUSE A MUTATION SURVIVED WITHOUT IT. Dropping
    // `text_formatting` from `ENUM_SLOTS` left every other assertion here
    // GREEN, because a bare `text.format_bold` resolves as a literal further
    // down and never reaches that branch. Only a value the script COMPUTES
    // does.
    //
    // ⛔ AND THE FAILURE IT GUARDS HAS SHIPPED BEFORE, one slot over: the
    // comment on that branch records a computed `position` being dropped, so
    // the table silently anchored to Pine's default corner — the opposite one
    // from the author's. The same shape here is a heading that quietly renders
    // as data. Bolding a header row by condition is how a real dashboard is
    // written, which is why this is railed rather than left to the literal.
    const props = cellProps('var t = table.new(position.top_right, 1, 1)\n'
      + 'table.cell(t, 0, 0, str.tostring(close), '
      + 'text_formatting = close > 0 ? text.format_bold : text.format_none)\n')
    expect(props).toContain('text_formatting')
  })
})

describe('⭐⭐ and the RENDERER actually draws it', () => {
  it('⛔ CONTROL — an ordinary cell is not bold', () => {
    // The control that makes the next case mean something: a renderer that
    // hard-coded bold would satisfy it and fail this.
    const [td] = tds([cell(0, 0, 'Symbol')])
    expect(td.style.fontWeight).not.toBe('bold')
  })

  it('⭐⭐ a cell carrying `bold` renders at font-weight bold', () => {
    const [td] = tds([cell(0, 0, 'Symbol', { text_formatting: 'bold' })])
    expect(td.style.fontWeight).toBe('bold')
  })

  it('⭐ italic is carried too, and separately from weight', () => {
    // ⚠️ NO corpus script writes italic — all 13 real usages are plain
    // `text.format_bold`. It is carried because the vocabulary is closed and
    // three names long, and because a renderer that knew one of three would
    // drop the others silently, which is the defect this file exists for.
    const [td] = tds([cell(0, 0, 'Symbol', { text_formatting: 'italic' })])
    expect(td.style.fontStyle).toBe('italic')
    expect(td.style.fontWeight).not.toBe('bold')
  })

  it('⛔ an unknown formatting value changes nothing rather than guessing', () => {
    const [td] = tds([cell(0, 0, 'Symbol', { text_formatting: 'wat' })])
    expect(td.style.fontWeight).not.toBe('bold')
    expect(td.style.fontStyle).not.toBe('italic')
  })
})
