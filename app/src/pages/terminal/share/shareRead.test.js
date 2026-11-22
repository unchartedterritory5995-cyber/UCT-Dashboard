// Share a panel: the reader. A panel's DOM to plain rows.
//   * what is read is what is drawn: the rendered rows, in order, and never a row more;
//   * a merged two-line cell is two lines; a hidden (phone-folded) column is gone from every row;
//   * a header's sort caret and button are not part of its name;
//   * a ticker cell is the plain ticker: the watchlist star's words never leak, the row number
//     rides beside the row;
//   * a tooltip (`title`) is never read as a value; an icon-only cell falls back to its words;
//   * a column of controls is dropped; a hidden table or one in a closed section is not read;
//   * what the panel says about a cut list or an older read is carried, in its own words.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cellLines, looksNumeric, readPanel, readPanelNotes, sentencesOf } from './shareRead'

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

function mount(html) {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

/** jsdom applies no stylesheet: this stands in for the page's CSS (the phone fold, the tones). */
const getStyle = (el) => {
  const cls = el.classList || { contains: () => false }
  return {
    display: cls.contains('phoneHide') || cls.contains('gone') ? 'none' : cls.contains('stack') ? 'grid' : cls.contains('rowBox') ? 'flex' : '',
    visibility: cls.contains('unseen') ? 'hidden' : '',
    color: cls.contains('up') ? 'rgb(47, 175, 104)' : cls.contains('down') ? 'rgb(232, 120, 120)' : cls.contains('muted') ? 'rgb(207, 202, 192)' : '',
    textAlign: cls.contains('num') ? 'right' : '',
    fontWeight: cls.contains('strong') ? '600' : '400',
    flexDirection: '',
    position: '', overflow: '', width: '', height: '',
    borderBottomWidth: cls.contains('lined') ? '1px' : '', borderBottomStyle: 'solid', borderBottomColor: 'rgb(42, 44, 49)',
    backgroundColor: cls.contains('striped') ? 'rgb(23, 24, 27)' : 'rgba(0, 0, 0, 0)',
  }
}
const read = (root) => readPanel(root, { getStyle })
const texts = (table) => table.rows.map((r) => (r.cells ? r.cells.map((c) => cellLines(c)) : { band: r.band }))

const STAR = '<span data-testid="watch-mark"><svg role="img"><title>On your watchlist: Leaders</title><path d="M1 1"/></svg></span>'
const symbol = (sym, marked = false) => `<button type="button" data-testid="panel-symbol-${sym}" aria-label="Load ${sym}${marked ? ', on your watchlist' : ''}" title="Load ${sym} into the linked panels">${sym}${marked ? STAR : ''}</button>`

const LIST = `
  <div class="toolbar"><button>All</button><button>Open</button></div>
  <table aria-label="Top picks, newest first, 3 of 3">
    <thead><tr>
      <th scope="col" title="Click a symbol to load it">Symbol</th>
      <th scope="col" title="The option contract">Contract</th>
      <th scope="col" class="phoneHide">Grade</th>
      <th scope="col" class="num" aria-sort="descending"><button type="button" class="sortBtn">Latest price<span aria-hidden="true"> \u25BC</span></button></th>
      <th scope="col"><span class="sr-only">Delete</span></th>
    </tr></thead>
    <tbody>
      <tr>
        <td><span class="rowNum" aria-hidden="true">1</span>${symbol('ZZA', true)}</td>
        <td>200C<br><span class="muted">exp 8/21/2026</span></td>
        <td class="phoneHide">A<br><span class="up">Bullish</span></td>
        <td class="num">$2.50 <span class="up">+25.0%</span><br><span class="muted">as of 2026\u201107\u201106</span></td>
        <td><button type="button" aria-label="Delete the pick on ZZA"><svg aria-hidden="true"><path d="M1 1"/></svg></button></td>
      </tr>
      <tr>
        <td><span class="rowNum" aria-hidden="true">2</span>${symbol('ZZB')}</td>
        <td>27.5P<br><span class="muted">exp 6/20</span></td>
        <td class="phoneHide">A+<br><span class="down">Bearish</span></td>
        <td class="num">Too new to score<br><span class="muted">1 daily price so far</span></td>
        <td><button type="button" aria-label="Delete the pick on ZZB"><svg aria-hidden="true"><path d="M1 1"/></svg></button></td>
      </tr>
      <tr>
        <td><span class="rowNum" aria-hidden="true">3</span>${symbol('ZZC')}</td>
        <td>50C<br><span class="muted">exp 9/18/2026</span></td>
        <td class="phoneHide">B<br><span class="down">Bearish</span></td>
        <td class="num">$2.00 <span class="down">-60.0%</span><br><span class="muted">as of 2026\u201107\u201106</span></td>
        <td><button type="button" aria-label="Delete the pick on ZZC"><svg aria-hidden="true"><path d="M1 1"/></svg></button></td>
      </tr>
    </tbody>
  </table>
  <span class="muted">Showing the first 3 of 80, newest first. This panel draws 300 at most.</span>
`

describe('a list panel becomes rows', () => {
  it('reads the rows on screen, in order, with merged two-line cells as two lines', () => {
    const out = read(mount(LIST))
    expect(out.rowCount).toBe(3)
    expect(out.tables).toHaveLength(1)
    const [t] = out.tables
    expect(texts(t)).toEqual([
      [['ZZA'], ['200C', 'exp 8/21/2026'], ['$2.50 +25.0%', 'as of 2026-07-06']],
      [['ZZB'], ['27.5P', 'exp 6/20'], ['Too new to score', '1 daily price so far']],
      [['ZZC'], ['50C', 'exp 9/18/2026'], ['$2.00 -60.0%', 'as of 2026-07-06']],
    ])
  })

  it('a phone-hidden column is gone from the header and from every row', () => {
    const [t] = read(mount(LIST)).tables
    expect(t.columns.map((c) => c.text)).toEqual(['Symbol', 'Contract', 'Latest price'])
    expect(JSON.stringify(t)).not.toMatch(/Bullish|Bearish|Grade/)
    // ... and with the fold open (a wide panel) the same DOM yields the column back.
    const wide = readPanel(document.body.firstChild, { getStyle: (el) => ({ ...getStyle(el), display: '' }) }).tables[0]
    expect(wide.columns.map((c) => c.text)).toEqual(['Symbol', 'Contract', 'Grade', 'Latest price'])
    expect(cellLines(wide.rows[0].cells[2])).toEqual(['A', 'Bullish'])
  })

  it('a sort caret and its button are not part of a header name, and a tooltip is never a value', () => {
    const [t] = read(mount(LIST)).tables
    expect(t.columns[2].text).toBe('Latest price')
    expect(JSON.stringify(t)).not.toMatch(/Click a symbol|The option contract|into the linked panels|\u25BC/)
  })

  it('a ticker cell is the plain ticker: the watchlist star never leaks, the row number rides beside the row', () => {
    const [t] = read(mount(LIST)).tables
    expect(t.rows.map((r) => r.no)).toEqual(['1', '2', '3'])
    expect(cellLines(t.rows[0].cells[0])).toEqual(['ZZA'])
    expect(JSON.stringify(t)).not.toMatch(/watchlist|Leaders|Load ZZA/i)
  })

  it('a column of controls (no visible header, no visible text) is dropped', () => {
    const [t] = read(mount(LIST)).tables
    expect(t.columns).toHaveLength(3)
    expect(JSON.stringify(t)).not.toMatch(/Delete/)
  })

  it('each run keeps the colour the page computed for it, and a column keeps its alignment', () => {
    const [t] = read(mount(LIST)).tables
    const gain = t.rows[0].cells[2].lines[0]
    expect(gain.map((r) => [r.text, r.color])).toEqual([['$2.50 ', ''], ['+25.0%', 'rgb(47, 175, 104)']])
    expect(t.rows[2].cells[2].lines[0][1]).toMatchObject({ text: '-60.0%', color: 'rgb(232, 120, 120)' })
    expect(t.columns.map((c) => c.align)).toEqual(['left', 'left', 'right'])
  })

  it('carries what the panel says about a cut list, in the panel\'s own words', () => {
    expect(read(mount(LIST)).notes).toEqual(['Showing the first 3 of 80, newest first.'])
  })
})

describe('never more than is on screen', () => {
  it('the rows read are exactly the rows rendered, and reading asks the network for nothing', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const root = mount(LIST)
    const rendered = root.querySelectorAll('tbody tr').length
    const out = read(root)
    expect(out.rowCount).toBe(rendered)
    expect(out.tables[0].rows.filter((r) => r.cells)).toHaveLength(rendered)
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('a row the panel has hidden is not read, and a row it removes is gone from the next read', () => {
    const root = mount(LIST)
    root.querySelectorAll('tbody tr')[1].classList.add('gone')
    expect(read(root).rowCount).toBe(2)
    root.querySelectorAll('tbody tr')[2].remove()
    const out = read(root)
    expect(out.rowCount).toBe(1)
    expect(cellLines(out.tables[0].rows[0].cells[0])).toEqual(['ZZA'])
  })

  it('a table that is hidden, or inside a closed section, is not read; an empty one is nothing to share', () => {
    const table = '<table><thead><tr><th>Key</th><th>Does</th></tr></thead><tbody><tr><td>Alt+1</td><td>Focus panel 1</td></tr></tbody></table>'
    expect(read(mount(`<details>${table}</details>`)).rowCount).toBe(0)
    expect(read(mount(`<details open><summary>Keys</summary>${table}</details>`)).rowCount).toBe(1)
    expect(read(mount(`<div hidden>${table}</div>`)).rowCount).toBe(0)
    expect(read(mount(`<div class="unseen">${table}</div>`)).rowCount).toBe(0)
    expect(read(mount('<table><thead><tr><th>Key</th></tr></thead><tbody></tbody></table>'))).toEqual({ tables: [], notes: [], rowCount: 0 })
    expect(readPanel(null)).toEqual({ tables: [], notes: [], rowCount: 0 })
  })
})

describe('cells that are not plain text', () => {
  it('an icon-only cell falls back to its words; a cell with text ignores hidden words and tooltips', () => {
    const out = read(mount(`
      <table><thead><tr><th>Setup</th><th>Confirmed</th><th>Note</th></tr></thead><tbody>
        <tr><td>Flag</td><td><svg role="img"><title>Confirmed</title></svg></td><td title="A tooltip">Held<span class="sr-only"> for three days</span></td></tr>
        <tr><td>Base</td><td><span class="sr-only">Not confirmed</span></td><td><img alt="warning" src="x.png"></td></tr>
        <tr><td>Wedge</td><td><span aria-label="Pending"></span></td><td></td></tr>
      </tbody></table>`))
    expect(texts(out.tables[0])).toEqual([
      [['Flag'], ['Confirmed'], ['Held']],
      [['Base'], ['Not confirmed'], ['warning']],
      [['Wedge'], ['Pending'], []],
    ])
  })

  it('a hidden header keeps its column when the rows hold text, named by its hidden words', () => {
    const out = read(mount(`
      <table><thead><tr><th>Symbol</th><th><span class="sr-only">Direction</span></th></tr></thead><tbody>
        <tr><td>ZZA</td><td>Above</td></tr></tbody></table>`))
    expect(out.tables[0].columns.map((c) => c.text)).toEqual(['Symbol', 'Direction'])
  })

  it('a row number is only read in the first column, and only when it leads the cell', () => {
    const out = read(mount(`
      <table><thead><tr><th>Symbol</th><th>Stars</th></tr></thead><tbody>
        <tr><td><button><span aria-hidden="true">7</span><span>ZZA</span></button></td><td><span aria-hidden="true">5</span></td></tr>
        <tr><td>ZZB <span aria-hidden="true">2</span></td><td>3</td></tr>
      </tbody></table>`))
    const [t] = out.tables
    expect(t.rows[0].no).toBe('7')
    expect(texts(t)).toEqual([[['ZZA'], ['5']], [['ZZB 2'], ['3']]])
    expect(t.rows[1].no).toBeNull()
  })

  it('a flex or grid box separates its children; inline children touch, as on screen', () => {
    const out = read(mount(`
      <table><thead><tr><th>Name</th><th>Move</th></tr></thead><tbody>
        <tr><td><div class="rowBox"><span>ZZA</span><span>Zeta Corp</span></div></td><td><span>+</span><span>12.3%</span></td></tr>
        <tr><td><div class="stack"><span>ZZB</span><span>Beta Inc</span></div></td><td>-4.0%</td></tr>
      </tbody></table>`))
    expect(texts(out.tables[0])).toEqual([[['ZZA Zeta Corp'], ['+12.3%']], [['ZZB', 'Beta Inc'], ['-4.0%']]])
  })

  it('a band across the row, a spanned cell and a footer row keep their columns true', () => {
    const out = read(mount(`
      <table><thead><tr><th>Name</th><th>1W</th><th>1M</th></tr></thead>
        <tbody>
          <tr><th colspan="3" scope="colgroup">Leaders</th></tr>
          <tr><th scope="row" rowspan="2">Chips</th><td>+2.0%</td><td>+9.0%</td></tr>
          <tr><td>+1.0%</td><td>+4.0%</td></tr>
          <tr><td>Software</td><td colspan="2">No return yet</td></tr>
        </tbody>
        <tfoot><tr><td>All</td><td>+1.5%</td><td>+6.5%</td></tr></tfoot>
      </table>`))
    expect(texts(out.tables[0])).toEqual([
      { band: 'Leaders' },
      [['Chips'], ['+2.0%'], ['+9.0%']],
      [[], ['+1.0%'], ['+4.0%']],
      [['Software'], ['No return yet'], []],
      [['All'], ['+1.5%'], ['+6.5%']],
    ])
    expect(out.rowCount).toBe(4)
    // With no alignment from the page, a column of numbers reads right and a first column left.
    expect(out.tables[0].columns.map((c) => c.align)).toEqual(['left', 'right', 'right'])
  })

  it('a table with no thead keeps a first row of header cells as its header', () => {
    const out = read(mount('<table><tbody><tr><th>Target</th><th>Price</th></tr><tr><td>1R</td><td>$10.00</td></tr></tbody></table>'))
    expect(out.tables[0].columns.map((c) => c.text)).toEqual(['Target', 'Price'])
    expect(out.rowCount).toBe(1)
  })
})

describe('several tables, and how the panel draws them', () => {
  it('each of several tables is named: its caption, else the heading it sits under, else its label', () => {
    const t = (extra, cap = '') => `<table ${extra}>${cap}<thead><tr><th>Theme</th><th>1W</th></tr></thead><tbody><tr><td>Chips</td><td>+2.0%</td></tr></tbody></table>`
    const out = read(mount(`
      <section><h3>Leaders (1)</h3><div>${t('')}</div></section>
      <section><h3>Laggards (1)</h3><div>${t('')}</div></section>
      ${t('', '<caption>Unchanged</caption>')}
      ${t('aria-label="Themes with no return"')}`))
    expect(out.tables.map((x) => x.caption)).toEqual(['Leaders (1)', 'Laggards (1)', 'Unchanged', 'Themes with no return'])
    expect(out.rowCount).toBe(4)
    // One table alone needs no name of its own: the panel's title names it.
    expect(read(mount(`<section><h3>Leaders</h3>${t('aria-label="x"')}</section>`)).tables[0].caption).toBe('')
  })

  it('reads the row hairline and a zebra stripe from the page, and says when the page gave neither', () => {
    const rows = (cls, second = '') => `<table><thead><tr><th>A</th></tr></thead><tbody><tr><td class="${cls}">1</td></tr><tr><td class="${cls} ${second}">2</td></tr></tbody></table>`
    expect(read(mount(rows('lined'))).tables[0]).toMatchObject({ rule: 'rgb(42, 44, 49)', zebra: null })
    expect(read(mount(rows('', 'striped'))).tables[0]).toMatchObject({ rule: null, zebra: 'rgb(23, 24, 27)' })
    const none = (el) => ({ ...getStyle(el), borderBottomWidth: '0px' })
    expect(readPanel(mount(rows('')), { getStyle: none }).tables[0].rule).toBe(false)
  })
})

describe('what the panel says about its list', () => {
  it('carries a cut sentence and an older-read notice, and nothing else', () => {
    const root = mount(`
      <p role="status">The Top Flow picks could not be read just now. Showing the last read.</p>
      <p class="muted">The top 50 of 5,123 names by RS rank. RS rank is a 1 to 99 percentile.</p>
      <div><span class="muted">Showing the 25 biggest of 140. </span></div>
      <span>Showing All accounts together.</span>
      <p>Showing the top 10 of 54 holdings by weight.</p>
      <p class="gone">Showing the first 2 of 9.</p>
      <table><tbody><tr><td>Showing the first 1 of 2.</td></tr></tbody></table>`)
    expect(readPanelNotes(root, { getStyle })).toEqual([
      'The Top Flow picks could not be read just now. Showing the last read.',
      'The top 50 of 5,123 names by RS rank.',
      'Showing the 25 biggest of 140.',
      'Showing the top 10 of 54 holdings by weight.',
    ])
  })

  it('splits sentences without breaking a decimal, and has no lookbehind (Safari 16.0 to 16.3)', async () => {
    expect(sentencesOf('Up 3.2% today. Showing the first 5 of 9. Done')).toEqual(['Up 3.2% today.', 'Showing the first 5 of 9.', 'Done'])
    const fs = await import('node:fs')
    const path = await import('node:path')
    for (const f of ['shareRead.js', 'shareText.js', 'shareImage.js', 'shareActions.js']) {
      const src = fs.readFileSync(path.join(process.cwd(), 'src/pages/terminal/share', f), 'utf8')
      expect(src, `${f} holds a lookbehind`).not.toMatch(/\(\?<[=!]/)
    }
  })
})

describe('looksNumeric', () => {
  it('knows a price, a percent, a count and a dash from words', () => {
    for (const t of ['$2.50', '+25.0%', '-60.0%', '1,234', '4.2M', '\u2014', '+2.5R', '99']) expect(looksNumeric(t), t).toBe(true)
    for (const t of ['ZZA', 'Too new to score', '', 'A+', '8/21/2026']) expect(looksNumeric(t), t).toBe(false)
  })
})
