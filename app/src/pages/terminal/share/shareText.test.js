// Share a panel: the words. Rows to a spreadsheet file and to pasted text.
//   * a cell that would run as a formula is made safe; a plain signed number is left as shown;
//   * commas, quotes and line breaks are quoted the way every spreadsheet reads them;
//   * the file opens in Excel: a byte order mark, CRLF line ends, non-ASCII kept;
//   * the first line names the panel, its as-of time and its source; a cut list says so;
//   * the as-of time is the data's own, never the time the file was made;
//   * the file name is `uct-<code>-<Eastern date>.<ext>`.
import { describe, it, expect } from 'vitest'
import {
  BOM, LINE_JOIN, NO_AS_OF, asOfLine, cellText, csvField, dayEt, safeCell, shareFileName, shareLines, sourceLine,
  stampEt, toCsv, toTsv, tsvField,
} from './shareText'

const cell = (...lines) => ({ lines: lines.map((t) => [{ text: t, color: '', bold: false }]), align: 'left' })
const row = (no, ...cells) => ({ no, cells: cells.map((c) => (typeof c === 'string' ? cell(c) : c)) })
const NOW = new Date('2026-11-17T20:45:00Z') // 3:45 PM ET

const READ = {
  rowCount: 3,
  notes: ['Showing the first 3 of 80, newest first.'],
  tables: [{
    caption: '',
    columns: [{ text: 'Symbol', align: 'left' }, { text: 'Contract', align: 'left' }, { text: 'Latest price', align: 'right' }],
    rows: [
      row('1', 'ZZA', cell('200C', 'exp 8/21/2026'), cell('$2.50 +25.0%', 'as of 2026-07-06')),
      row('2', 'ZZB', cell('27.5P', 'exp 6/20'), 'Too new to score'),
      row('3', 'ZZC', '50C', '-60.0%'),
    ],
  }],
}
const META = {
  code: 'TOPF', command: 'TOPF OPEN', label: 'Top Flow picks (each pick and how its contract has done)',
  report: { source: 'UCT options flow tape (picks), daily option prices from Massive with Schwab as backup', age: { asOfDate: '2026-07-06' } },
}

describe('formula injection: a cell a spreadsheet would run is made safe', () => {
  it('a leading =, +, - or @ gets a leading apostrophe', () => {
    expect(safeCell('=1+1')).toBe("'=1+1")
    expect(safeCell('=HYPERLINK("http://x.test","click")')).toBe('\'=HYPERLINK("http://x.test","click")')
    expect(safeCell('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)")
    expect(safeCell("+1+cmd|' /C calc'!A0")).toBe("'+1+cmd|' /C calc'!A0")
    expect(safeCell('-2+3')).toBe("'-2+3")
    expect(safeCell('-')).toBe("'-")
    expect(safeCell('+A1')).toBe("'+A1")
  })

  it('leading space, a tab or a carriage return in front of one does not hide it', () => {
    expect(safeCell('  =1+1')).toBe("'  =1+1")
    expect(safeCell('\t=1+1')).toBe("'\t=1+1")
    expect(safeCell('\r@x')).toBe("'\r@x")
    expect(safeCell('\u00A0=1')).toBe("'\u00A0=1")
    expect(safeCell('\tplain')).toBe("'\tplain")
  })

  it('a plain signed number is left exactly as shown: it is a number, not a formula', () => {
    for (const t of ['+25.0%', '-60.0%', '-$1,204.50', '+2.5R', '-0.42', '+12', '-3 bps', '+1.2M', '-4x']) expect(safeCell(t), t).toBe(t)
  })

  it('ordinary text, a real minus sign and an empty cell are untouched', () => {
    for (const t of ['ZZA', '$2.50 +25.0%', 'Too new to score', '\u22123.2%', '\u2014', '', 'A+', 'a=b', 'me@example.test']) expect(safeCell(t), t).toBe(t)
    expect(safeCell(null)).toBe('')
    expect(safeCell(12)).toBe('12')
  })

  it('the guard holds inside a file: no line of the CSV starts a field with a live formula', () => {
    const bad = { ...READ, tables: [{ ...READ.tables[0], rows: [row('1', '=cmd', '@x', '+25.0%'), row('2', '-1+1', 'ok', '=2')] }] }
    const csv = toCsv(bad, { ...META, label: '=evil', command: '@x' }, NOW)
    for (const line of csv.replace(BOM, '').split('\r\n')) {
      for (const field of line.split(',')) expect(field, line).not.toMatch(/^"?[=@]/)
    }
    expect(csv).toContain("'=cmd,'@x,+25.0%")
    expect(csv).toContain("'-1+1,ok,'=2")
    expect(toTsv(bad, META, NOW)).toContain("'=cmd\t'@x\t+25.0%")
  })
})

describe('quoting', () => {
  it('quotes a comma, a quote, a line break and outer space; doubles a quote; leaves the rest bare', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    expect(csvField('cr\rhere')).toBe('"cr\rhere"')
    expect(csvField(' padded ')).toBe('" padded "')
    expect(csvField('$1,204.50')).toBe('"$1,204.50"')
    expect(csvField('Caf\u00E9 \u00B7 \u65E5\u672C')).toBe('Caf\u00E9 \u00B7 \u65E5\u672C')
    expect(csvField('=a,b')).toBe('"\'=a,b"')
  })

  it('pasted text has no tab or line break inside a field', () => {
    expect(tsvField('a\tb\nc')).toBe('a b c')
    expect(tsvField('"quoted", with a comma')).toBe('"quoted", with a comma')
  })

  it('a two-line cell is one field, its lines joined', () => {
    expect(cellText(cell('200C', 'exp 8/21/2026'))).toBe(`200C${LINE_JOIN}exp 8/21/2026`)
    expect(cellText(cell('ZZA'))).toBe('ZZA')
    expect(cellText({ lines: [] })).toBe('')
  })
})

describe('the file', () => {
  const csv = toCsv(READ, META, NOW)

  it('starts with a byte order mark, ends every line with CRLF, and keeps non-ASCII', () => {
    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(csv).toContain(`200C${LINE_JOIN}exp 8/21/2026`)
    // The bytes a browser writes for it open as UTF-8 with the mark first.
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF])
  })

  it('names the panel, its as-of time and its source on the first line, then what the panel says about a cut', () => {
    const lines = csv.replace(BOM, '').split('\r\n')
    expect(lines[0]).toBe('Top Flow picks (each pick and how its contract has done) (TOPF OPEN),As of 2026-07-06,'
      + '"Source: UCT options flow tape (picks), daily option prices from Massive with Schwab as backup",'
      + '"UCT Intelligence Terminal, shared Nov 17, 2026, 3:45 PM ET"')
    expect(lines[1]).toBe('"Showing the first 3 of 80, newest first."')
    expect(lines[2]).toBe('')
    expect(lines[3]).toBe('Symbol,Contract,Latest price')
  })

  it('holds the rows and columns as shown: no row number, no extra column, no extra row', () => {
    const lines = csv.replace(BOM, '').split('\r\n')
    expect(lines.slice(4)).toEqual([
      `ZZA,200C${LINE_JOIN}exp 8/21/2026,$2.50 +25.0%${LINE_JOIN}as of 2026-07-06`,
      `ZZB,27.5P${LINE_JOIN}exp 6/20,Too new to score`,
      'ZZC,50C,-60.0%',
      '',
    ])
  })

  it('several tables each get their caption, and a band keeps its place', () => {
    const two = { notes: [], tables: [
      { caption: 'Leaders', columns: [{ text: 'Theme' }, { text: '1W' }], rows: [{ band: 'Semis' }, row(null, 'Chips', '+2.0%')] },
      { caption: 'Laggards', columns: [{ text: 'Theme' }, { text: '1W' }], rows: [row(null, 'Solar', '-3.0%')] },
    ] }
    expect(toCsv(two, { code: 'THMS', command: 'THMS 1W', label: 'Theme leaderboard' }, NOW).replace(BOM, '').split('\r\n').slice(1)).toEqual([
      '', 'Leaders', 'Theme,1W', 'Semis', 'Chips,+2.0%', '', 'Laggards', 'Theme,1W', 'Solar,-3.0%', '',
    ])
  })

  it('as pasted text: the same rows, tab-separated, no mark', () => {
    const tsv = toTsv(READ, META, NOW)
    expect(tsv.startsWith(BOM)).toBe(false)
    expect(tsv.split('\n')[3]).toBe('Symbol\tContract\tLatest price')
    expect(tsv.split('\n')[6]).toBe('ZZC\t50C\t-60.0%')
  })
})

describe('the lines every share carries', () => {
  it('the as-of time is the data\'s own: a named date, else the server\'s instant in Eastern time', () => {
    expect(asOfLine({ age: { asOfDate: '2026-07-06' } })).toBe('As of 2026-07-06')
    expect(asOfLine({ age: { asOfDate: 'Nov 17, 3:42 PM ET' }, observedAt: '2026-11-17T20:42:00Z' })).toBe('As of Nov 17, 3:42 PM ET')
    expect(asOfLine({ observedAt: '2026-11-17T20:42:00Z' })).toBe('As of Nov 17, 2026, 3:42 PM ET')
    expect(asOfLine({ freshnessClass: 'real_time', asOf: Date.parse('2026-11-17T20:42:00Z') })).toBe('As of Nov 17, 2026, 3:42 PM ET')
    expect(asOfLine({ asOf: Date.parse('2026-11-17T20:42:00Z') / 1000 })).toBe('As of Nov 17, 2026, 3:42 PM ET')
  })

  it('a panel that gave no as-of time gets none invented, least of all the time of sharing', () => {
    expect(asOfLine(null)).toBe('')
    expect(asOfLine({ source: 'Your journal' })).toBe('')
    expect(asOfLine({ asOf: 'not a date' })).toBe('')
    const lines = shareLines({ code: 'PERF', command: 'PERF', label: 'My trading stats (from your Journal)', report: { source: 'Your journal' } }, NOW)
    expect(lines.asOf).toBe(NO_AS_OF)
    expect(lines.asOf).not.toMatch(/Nov 17/)
    expect(lines).toMatchObject({ title: 'My trading stats (from your Journal)', command: 'PERF', source: 'Source: Your journal', shared: 'Shared Nov 17, 2026, 3:45 PM ET' })
  })

  it('names the source in the panel\'s words, and falls back to the command when there is no plain name', () => {
    expect(sourceLine({ source: '  SEC EDGAR  ' })).toBe('Source: SEC EDGAR')
    expect(sourceLine({})).toBe('')
    expect(shareLines({ code: 'ZZZ', command: 'NVDA ZZZ' }, NOW).title).toBe('NVDA ZZZ')
    expect(shareLines(null, NOW).title).toBe('UCT Terminal')
  })

  it('a one-stock panel leads with the stock, in the title and on the first line of the file', () => {
    const meta = { code: 'FTD', command: 'NVDA FTD', label: 'Fails to deliver', sym: 'nvda', report: { source: 'SEC fails-to-deliver data' } }
    expect(shareLines(meta, NOW).title).toBe(`NVDA${LINE_JOIN}Fails to deliver`)
    expect(shareLines(meta, NOW).command).toBe('NVDA FTD')
    expect(toCsv(READ, meta, NOW).replace(BOM, '').split('\r\n')[0].startsWith(`NVDA${LINE_JOIN}Fails to deliver (NVDA FTD),`)).toBe(true)
    // A market panel has no stock to lead with.
    expect(shareLines({ ...meta, sym: '' }, NOW).title).toBe('Fails to deliver')
  })

  it('stamps in Eastern time across the date line', () => {
    expect(stampEt('2026-11-18T03:30:00Z')).toBe('Nov 17, 2026, 10:30 PM ET')
    expect(dayEt('2026-11-18T03:30:00Z')).toBe('2026-11-17')
    expect(dayEt('2026-07-04T12:00:00Z')).toBe('2026-07-04')
    expect(stampEt('nope')).toBe('')
  })
})

describe('the file name', () => {
  it('is uct-<code>-<Eastern date>.<ext>, lower case, with nothing a file system refuses', () => {
    expect(shareFileName('TOPF', 'csv', NOW)).toBe('uct-topf-2026-11-17.csv')
    expect(shareFileName('PERF', 'png', new Date('2026-11-18T03:30:00Z'))).toBe('uct-perf-2026-11-17.png')
    expect(shareFileName('../../etc/passwd', 'csv', NOW)).toBe('uct-etcpasswd-2026-11-17.csv')
    expect(shareFileName('', 'C S V', NOW)).toBe('uct-panel-2026-11-17.csv')
    expect(shareFileName('H52', 'csv', NOW)).toMatch(/^uct-h52-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('a one-stock panel names the stock too, made safe the same way', () => {
    expect(shareFileName('FTD', 'csv', NOW, 'NVDA')).toBe('uct-ftd-nvda-2026-11-17.csv')
    expect(shareFileName('FTD', 'png', NOW, 'BRK.B')).toBe('uct-ftd-brkb-2026-11-17.png')
    expect(shareFileName('FTD', 'csv', NOW, '../x')).toBe('uct-ftd-x-2026-11-17.csv')
    expect(shareFileName('FTD', 'csv', NOW, '')).toBe('uct-ftd-2026-11-17.csv')
    expect(shareFileName('FTD', 'csv', NOW, null)).toBe('uct-ftd-2026-11-17.csv')
  })
})
