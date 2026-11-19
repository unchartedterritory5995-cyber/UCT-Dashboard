// Share a panel: the picture. The layout maths as pure functions, and the draw with a stub context.
//   * nothing is ever clipped: text wraps at a space, a long word breaks inside the word, and
//     every drawn word sits inside the picture;
//   * column widths: room to spare is shared out, too little is taken from what can wrap, never
//     below a column's longest word until even those do not fit;
//   * row heights follow the tallest cell; a two-line cell is a taller row;
//   * the picture is 600 px wide at twice the density (1200 px), wider only for a wide table, and
//     never larger than the caps; a long list is cut at the cap AND SAYS SO;
//   * the head carries the title, the command and the as-of time; the foot the source, when it
//     was shared, and whose it is.
import { describe, it, expect } from 'vitest'
import { IMAGE, capRows, drawShare, fitColumns, imageScale, layoutShare, measureTable, shareFonts, wrapRuns } from './shareImage'

/** A ruler that is not a canvas: 7 px a character at 13 px, scaled by the font's size, wider in bold. */
const sizeOf = (font) => Number(/(\d+(\.\d+)?)px/.exec(font)[1])
const measure = (text, font) => String(text).length * 7 * (sizeOf(font) / 13) * (/^(600|700)/.test(font) ? 1.05 : 1)
const fonts = shareFonts('Test Sans')
const run = (text, color = '', bold = false) => ({ text, color, bold })
const cell = (...lines) => ({ lines: lines.map((l) => (Array.isArray(l) ? l : [run(l)])), align: 'left' })
const num = (...lines) => ({ ...cell(...lines), align: 'right' })
const row = (no, ...cells) => ({ no, cells })

const LINES = {
  title: 'Top Flow picks (each pick and how its contract has done)', command: 'TOPF OPEN', asOf: 'As of 2026-07-06',
  source: 'Source: UCT options flow tape (picks), daily option prices from Massive with Schwab as backup', shared: 'Shared Nov 17, 2026, 3:45 PM ET',
}
const table = (rows) => ({
  caption: '',
  columns: [{ text: 'Symbol', align: 'left' }, { text: 'Contract', align: 'left' }, { text: 'Latest price', align: 'right' }],
  rows,
})
const READ = {
  notes: ['Showing the first 3 of 80, newest first.'],
  tables: [table([
    row('1', cell('ZZA'), cell('200C', 'exp 8/21/2026'), num([run('$2.50 '), run('+25.0%', 'rgb(47, 175, 104)')], 'as of 2026-07-06')),
    row('2', cell('ZZB'), cell('27.5P', 'exp 6/20'), num('Too new to score')),
    row('3', cell('ZZC'), cell('50C'), num([run('-60.0%', 'rgb(232, 120, 120)')])),
  ])],
}
const textSteps = (layout) => layout.steps.filter((s) => s.op === 'text')
/** The left and right edge of a drawn piece of text. */
const span = (s) => {
  const w = measure(s.text, s.font)
  return s.align === 'right' ? [s.x - w, s.x] : [s.x, s.x + w]
}

describe('wrapping: nothing is cut off', () => {
  it('breaks at a space, and never leaves a line ending or starting on one', () => {
    const lines = wrapRuns([run('Showing the first three of eighty')], 100, measure, fonts)
    expect(lines.map((l) => l.map((r) => r.text).join(''))).toEqual(['Showing the', 'first three of', 'eighty'])
    for (const l of lines) expect(l.reduce((n, r) => n + r.w, 0)).toBeLessThanOrEqual(100)
  })

  it('a word wider than the column breaks inside the word, losing no character', () => {
    const lines = wrapRuns([run('Supercalifragilisticexpialidocious ok')], 70, measure, fonts)
    expect(lines.length).toBeGreaterThan(3)
    expect(lines.map((l) => l.map((r) => r.text).join('')).join('').replace(/\s/g, '')).toBe('Supercalifragilisticexpialidociousok')
    for (const l of lines) expect(l.reduce((n, r) => n + r.w, 0)).toBeLessThanOrEqual(70)
  })

  it('keeps each run\'s colour and weight across a break', () => {
    const lines = wrapRuns([run('$2.50 '), run('+25.0% since entry', 'green', true)], 80, measure, fonts)
    expect(lines.flat().filter((r) => r.color === 'green').map((r) => r.text).join(' ')).toBe('+25.0% since entry')
    expect(lines.flat().every((r) => r.text === r.text.trim() || r.color === '')).toBe(true)
    expect(lines.flat().find((r) => r.color === 'green').bold).toBe(true)
  })

  it('text that fits stays on one line, and empty text is no line', () => {
    expect(wrapRuns([run('ZZA')], 200, measure, fonts)).toHaveLength(1)
    expect(wrapRuns([run('   ')], 200, measure, fonts)).toEqual([])
    expect(wrapRuns([], 200, measure, fonts)).toEqual([])
  })
})

describe('column widths', () => {
  const sum = (a) => a.reduce((x, y) => x + y, 0)

  it('shares out room to spare in proportion, and always fills the width', () => {
    const w = fitColumns([100, 200, 100], [50, 50, 50], 600)
    expect(w).toEqual([150, 300, 150])
    expect(sum(w)).toBeCloseTo(600)
  })

  it('takes too little room from the columns that can wrap, never below their longest word', () => {
    const w = fitColumns([100, 400, 100], [100, 120, 100], 500)
    expect(w[0]).toBe(100)
    expect(w[2]).toBe(100)
    expect(w[1]).toBeCloseTo(300)
    expect(sum(w)).toBeCloseTo(500)
  })

  it('when even the longest words do not fit, every column gives way and the total still fits', () => {
    const w = fitColumns([300, 300], [200, 200], 300)
    expect(w).toEqual([150, 150])
    expect(sum(w)).toBeCloseTo(300)
  })

  it('an exact fit and an empty table are left alone', () => {
    expect(fitColumns([100, 200], [50, 50], 300)).toEqual([100, 200])
    expect(fitColumns([], [], 300)).toEqual([])
  })

  it('measures a table: natural width is its widest line, the floor its longest word, the gutter its row numbers', () => {
    const plan = measureTable(READ.tables[0], measure, fonts)
    const pad = IMAGE.cellPadX * 2
    expect(plan.natural[0]).toBeCloseTo(measure('Symbol', fonts.head) + pad)
    expect(plan.natural[1]).toBeCloseTo(measure('exp 8/21/2026', fonts.body) + pad)
    expect(plan.natural[2]).toBeCloseTo(measure('as of 2026-07-06', fonts.body) + pad)
    expect(plan.floors[2]).toBeCloseTo(measure('2026-07-06', fonts.body) + pad)
    expect(plan.gutter).toBeGreaterThan(0)
    expect(measureTable(table([row(null, cell('ZZA'), cell('1'), num('2'))]), measure, fonts).gutter).toBe(0)
  })
})

describe('the size of the picture', () => {
  it('is 600 px wide for an ordinary list: 1200 px across at twice the density', () => {
    const layout = layoutShare(READ, LINES, measure, { fonts })
    expect(layout.width).toBe(IMAGE.minWidth)
    expect(layout.width * imageScale(layout.width, layout.height, 1)).toBe(1200)
  })

  it('grows for a wide table, up to the cap, and wraps after that', () => {
    const wide = (n) => ({ notes: [], tables: [{ caption: '', columns: Array.from({ length: n }, (_, i) => ({ text: `Column ${i}`, align: 'left' })),
      rows: [row(null, ...Array.from({ length: n }, () => cell('a value of some length')))] }] })
    const some = layoutShare(wide(5), LINES, measure, { fonts })
    expect(some.width).toBeGreaterThan(IMAGE.minWidth)
    expect(some.width).toBeLessThanOrEqual(IMAGE.maxWidth)
    const many = layoutShare(wide(12), LINES, measure, { fonts })
    expect(many.width).toBe(IMAGE.maxWidth)
    for (const s of textSteps(many)) {
      const [l, r] = span(s)
      expect(l, s.text).toBeGreaterThanOrEqual(IMAGE.pad - 0.01)
      expect(r, s.text).toBeLessThanOrEqual(many.width - IMAGE.pad + 0.01)
    }
  })

  it('density: at least 2, the screen\'s own when higher, lowered only to stay inside the caps', () => {
    expect(imageScale(600, 800, 1)).toBe(2)
    expect(imageScale(600, 800, 3)).toBe(3)
    expect(imageScale(600, 800, NaN)).toBe(2)
    expect(imageScale(600, 8000, 2)).toBe(1)
    expect(600 * 8000 * imageScale(600, 8000, 2) ** 2).toBeLessThanOrEqual(IMAGE.maxArea)
    const s = imageScale(880, 6000, 3)
    expect(880 * s * 6000 * s).toBeLessThanOrEqual(IMAGE.maxArea + 1)
    expect(6000 * s).toBeLessThanOrEqual(IMAGE.maxEdge)
    expect(imageScale(0, 0, 2)).toBe(2)
  })

  it('a long list is cut at the cap, says how many there were, and stays inside the bitmap caps at 2x', () => {
    const long = { notes: [], tables: [table(Array.from({ length: 300 }, (_, i) => row(String(i + 1), cell(`Z${i}`), cell('200C', 'exp 8/21/2026'), num('+1.0%'))))] }
    const layout = layoutShare(long, LINES, measure, { fonts })
    expect(layout.shown).toBe(IMAGE.rowCap)
    expect(layout.total).toBe(300)
    const said = textSteps(layout).map((s) => s.text).join(' ')
    expect(said).toContain(`This picture shows the first ${IMAGE.rowCap} of the 300 rows on screen.`)
    expect(said).toContain(`Z${IMAGE.rowCap - 1}`)
    expect(said).not.toContain(`Z${IMAGE.rowCap} `)
    expect(imageScale(layout.width, layout.height, 2)).toBe(2)
    expect(layout.height * 2).toBeLessThanOrEqual(IMAGE.maxEdge)
  })

  it('capRows: the first rows in order across tables, a table left empty is dropped, a band rides with its rows', () => {
    const read = { tables: [
      { caption: 'A', columns: [], rows: [{ band: 'G1' }, row(null, cell('a1')), row(null, cell('a2'))] },
      { caption: 'B', columns: [], rows: [{ band: 'G2' }, row(null, cell('b1'))] },
    ] }
    const cut = capRows(read, 2)
    expect(cut).toMatchObject({ shown: 2, total: 3 })
    expect(cut.tables).toHaveLength(1)
    expect(cut.tables[0].rows).toHaveLength(3)
    expect(capRows(read, 50)).toMatchObject({ shown: 3, total: 3 })
    expect(capRows(read, 50).tables).toHaveLength(2)
    expect(capRows(read, 0).tables).toEqual([])
    expect(capRows(null)).toEqual({ tables: [], shown: 0, total: 0 })
  })
})

describe('what the picture holds', () => {
  const layout = layoutShare(READ, LINES, measure, { fonts })
  const said = textSteps(layout)
  const find = (text) => said.find((s) => s.text === text)

  it('every piece of text sits inside the picture, top to bottom and side to side', () => {
    for (const s of said) {
      const [l, r] = span(s)
      expect(l, s.text).toBeGreaterThanOrEqual(IMAGE.pad - 0.01)
      expect(r, s.text).toBeLessThanOrEqual(layout.width - IMAGE.pad + 0.01)
      expect(s.y, s.text).toBeGreaterThan(IMAGE.pad)
      expect(s.y, s.text).toBeLessThanOrEqual(layout.height - IMAGE.pad / 2)
    }
  })

  it('the head: the plain name, the mark in gold, then the command and the data\'s as-of time', () => {
    // The title wraps beside the mark instead of running under it, and loses no word.
    const title = said.filter((s) => s.ink === 'bright')
    expect(title.length).toBeGreaterThan(1)
    expect(title.map((s) => s.text).join(' ')).toBe(LINES.title)
    expect(said[0]).toBe(title[0])
    const brandLeft = layout.steps.find((s) => s.op === 'logo').x
    for (const s of title) expect(span(s)[1], s.text).toBeLessThanOrEqual(brandLeft)
    expect(find('UCT Intelligence')).toMatchObject({ ink: 'gold', align: 'right', x: layout.width - IMAGE.pad })
    expect(find('TOPF OPEN \u00B7 As of 2026-07-06')).toMatchObject({ ink: 'muted' })
    expect(layout.steps.find((s) => s.op === 'logo')).toMatchObject({ size: 18 })
    // gold is on the mark and nowhere else
    expect(said.filter((s) => s.ink === 'gold')).toHaveLength(1)
  })

  it('the foot: the source, when it was shared, and where it is from', () => {
    expect(said.slice(-4).map((s) => s.text)).toEqual([
      'Showing the first 3 of 80, newest first.', LINES.source, 'Shared Nov 17, 2026, 3:45 PM ET', 'uctintelligence.com',
    ])
    expect(find('uctintelligence.com')).toMatchObject({ align: 'right', ink: 'muted', y: find('Shared Nov 17, 2026, 3:45 PM ET').y })
    // A source too long for one line wraps, and loses no word.
    const long = `${LINES.source}, and a second clause that makes this line far too long for one row of the picture`
    const wrapped = textSteps(layoutShare(READ, { ...LINES, source: long }, measure, { fonts })).filter((s) => long.includes(s.text) && s.text !== 'TOPF OPEN')
    expect(wrapped.length).toBeGreaterThan(1)
    expect(wrapped.map((s) => s.text).join(' ')).toBe(long)
  })

  it('a number column is drawn to its right edge, text to its left, the row number in the gutter', () => {
    const head = find('Latest price')
    const gain = find('+25.0%')
    expect(gain.color).toBe('rgb(47, 175, 104)')
    expect(find('-60.0%').color).toBe('rgb(232, 120, 120)')
    const right = (s) => span(s)[1]
    expect(right(head)).toBeCloseTo(right(gain), 0)
    expect(right(head)).toBeCloseTo(layout.width - IMAGE.pad - IMAGE.cellPadX, 0)
    expect(find('ZZA').x).toBeCloseTo(find('ZZC').x)
    expect(find('1')).toMatchObject({ align: 'right', ink: 'muted' })
    expect(find('1').x).toBeLessThan(find('ZZA').x)
  })

  it('a two-line row is taller than a one-line row, and rows never overlap', () => {
    const y = (text) => find(text).y
    expect(y('exp 8/21/2026') - y('200C')).toBe(IMAGE.lineH)
    const tall = y('ZZB') - y('ZZA')
    const short = IMAGE.lineH + IMAGE.cellPadY * 2
    expect(tall).toBe(2 * IMAGE.lineH + IMAGE.cellPadY * 2)
    expect(tall).toBeGreaterThan(short)
    const rules = layout.steps.filter((s) => s.op === 'rule').map((s) => s.y)
    expect(rules).toEqual([...rules].sort((a, b) => a - b))
    expect(new Set(rules).size).toBe(rules.length)
  })

  it('several tables each get their caption; a band is drawn across; a stripe is drawn when the panel stripes', () => {
    const two = { notes: [], tables: [
      { caption: 'Leaders', zebra: 'rgb(23, 24, 27)', columns: [{ text: 'Theme', align: 'left' }, { text: '1W', align: 'right' }],
        rows: [{ band: 'Semis' }, row(null, cell('Chips'), num('+2.0%')), row(null, cell('Memory'), num('+1.0%'))] },
      { caption: 'Laggards', rule: false, columns: [{ text: 'Theme', align: 'left' }, { text: '1W', align: 'right' }], rows: [row(null, cell('Solar'), num('-3.0%'))] },
    ] }
    const l = layoutShare(two, { ...LINES, source: '' }, measure, { fonts })
    const t = textSteps(l).map((s) => s.text)
    for (const word of ['Leaders', 'Semis', 'Chips', 'Laggards', 'Solar']) expect(t).toContain(word)
    expect(t.indexOf('Leaders')).toBeLessThan(t.indexOf('Semis'))
    expect(l.steps.filter((s) => s.op === 'rect')).toEqual([expect.objectContaining({ color: 'rgb(23, 24, 27)' })])
    expect(t.some((x) => x.startsWith('Source'))).toBe(false)
  })
})

describe('drawing', () => {
  function stubCtx() {
    const calls = []
    const ctx = { calls, fillStyle: '', font: '', textAlign: '', textBaseline: '' }
    for (const name of ['save', 'restore', 'scale', 'fillRect', 'fillText', 'drawImage']) ctx[name] = (...args) => { calls.push([name, ...args, ctx.fillStyle]) }
    return ctx
  }
  const theme = { bg: '#101012', text: '#f0efea', bright: '#f8f7f3', muted: '#cfcac0', border: '#2a2c31', hair: '#2a2c31', gold: '#dcbb5e' }
  const layout = layoutShare(READ, LINES, measure, { fonts })

  it('fills the whole picture with the page\'s background first, at the asked density', () => {
    const ctx = stubCtx()
    drawShare(ctx, layout, theme, { scale: 2 })
    expect(ctx.calls[0][0]).toBe('save')
    expect(ctx.calls[1]).toEqual(['scale', 2, 2, ''])
    expect(ctx.calls[2]).toEqual(['fillRect', 0, 0, layout.width, layout.height, '#101012'])
    expect(ctx.calls[ctx.calls.length - 1][0]).toBe('restore')
  })

  it('draws every word once, a gain in the page\'s own green, the mark in gold', () => {
    const ctx = stubCtx()
    drawShare(ctx, layout, theme, { scale: 2 })
    const drawn = ctx.calls.filter((c) => c[0] === 'fillText')
    expect(drawn).toHaveLength(textSteps(layout).length)
    const ink = (text) => drawn.find((c) => c[1] === text)[4]
    expect(ink('+25.0%')).toBe('rgb(47, 175, 104)')
    expect(ink('UCT Intelligence')).toBe('#dcbb5e')
    expect(ink('ZZA')).toBe('#f0efea')
    expect(ink('Symbol')).toBe('#cfcac0')
  })

  it('draws the mark only when it has loaded, and survives a context that refuses it', () => {
    const none = stubCtx()
    drawShare(none, layout, theme, { scale: 2 })
    expect(none.calls.some((c) => c[0] === 'drawImage')).toBe(false)
    const withLogo = stubCtx()
    drawShare(withLogo, layout, theme, { scale: 2, logo: { width: 400, height: 400 } })
    expect(withLogo.calls.filter((c) => c[0] === 'drawImage')).toHaveLength(1)
    const broken = stubCtx()
    broken.drawImage = () => { throw new Error('tainted') }
    expect(() => drawShare(broken, layout, theme, { scale: 2, logo: {} })).not.toThrow()
  })
})
