// Share a panel: the actions. A picture to the clipboard (or a download where the browser will
// not copy one), a spreadsheet file, and text; each ends in the one notice the shell says aloud.
//   * what is shared is read from the panel body at the moment of the call, and no request is made;
//   * the picture goes to the clipboard inside the click (no wait before the write), and is
//     downloaded, with the notice saying so, when the browser refuses;
//   * the file is `uct-<code>-<date>.csv`, UTF-8 with a byte order mark;
//   * nothing to share, a refused copy and a canvas that cannot be had each say so plainly.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../../components/chart/chartScreenshot', () => ({ downloadBlob: vi.fn(), copyBlobToClipboard: vi.fn(async () => true) }))
import { copyBlobToClipboard, downloadBlob } from '../../../components/chart/chartScreenshot'
import { readTheme, renderShare, sharePanel, warmShare } from './shareActions'
import { BOM } from './shareText'

afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); vi.unstubAllGlobals() })

const NOW = new Date('2026-11-17T20:45:00Z')
const META = { code: 'PERF', command: 'PERF 2', label: 'My trading stats (from your Journal)', report: { source: 'Your journal', age: { asOfDate: 'Nov 17, 3:42 PM ET' } } }

function panel(rows = 3) {
  const body = document.createElement('div')
  body.innerHTML = `<table><thead><tr><th>Setup</th><th>Trades</th><th>Expectancy</th></tr></thead><tbody>${
    Array.from({ length: rows }, (_, i) => `<tr><td>Setup ${i + 1}</td><td>${10 + i}</td><td>+$${i + 1}.00</td></tr>`).join('')
  }</tbody></table>`
  document.body.appendChild(body)
  return body
}

const textOf = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsText(blob) })
const bytesOf = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob) })
const env = (over = {}) => ({
  now: () => NOW,
  download: vi.fn(),
  copyImage: vi.fn(async () => true),
  copyText: vi.fn(async () => true),
  render: vi.fn((read) => ({ blob: new Blob(['png'], { type: 'image/png' }), width: 1200, height: 600, shown: read.rowCount, total: read.rowCount })),
  theme: vi.fn(() => ({ bg: 'black' })),
  ...over,
})

describe('the spreadsheet file', () => {
  it('downloads uct-<code>-<date>.csv holding the rows on screen, and says so', async () => {
    const on = env()
    const said = await sharePanel('csv', panel(3), META, on)
    expect(said).toEqual({ kind: 'info', text: 'Downloaded uct-perf-2026-11-17.csv: 3 rows, as shown.' })
    expect(on.download).toHaveBeenCalledTimes(1)
    const [blob, name] = on.download.mock.calls[0]
    expect(name).toBe('uct-perf-2026-11-17.csv')
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect([...(await bytesOf(blob)).slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF])
    const lines = (await textOf(blob)).replace(BOM, '').split('\r\n')
    expect(lines[0]).toContain('My trading stats (from your Journal) (PERF 2)')
    expect(lines[0]).toContain('"As of Nov 17, 3:42 PM ET"')
    expect(lines[0]).toContain('Source: Your journal')
    expect(lines.slice(2, 6)).toEqual(['Setup,Trades,Expectancy', 'Setup 1,10,+$1.00', 'Setup 2,11,+$2.00', 'Setup 3,12,+$3.00'])
  })

  it('\u26D4 shares exactly what is on screen at that moment, and asks the network for nothing', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const body = panel(5)
    const on = env()
    await sharePanel('csv', body, META, on)
    const first = (await textOf(on.download.mock.calls[0][0])).split('\r\n').filter((l) => /^Setup \d/.test(l))
    expect(first).toHaveLength(body.querySelectorAll('tbody tr').length)
    // The member filters the list down: the next share holds the two rows left, not the five.
    for (const tr of [...body.querySelectorAll('tbody tr')].slice(2)) tr.remove()
    const said = await sharePanel('csv', body, META, on)
    expect(said.text).toContain('2 rows')
    const second = (await textOf(on.download.mock.calls[1][0])).split('\r\n').filter((l) => /^Setup \d/.test(l))
    expect(second).toEqual(['Setup 1,10,+$1.00', 'Setup 2,11,+$2.00'])
    await sharePanel('image', body, META, on)
    await sharePanel('text', body, META, on)
    expect(on.render.mock.calls[0][0].rowCount).toBe(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('one row is "1 row"', async () => {
    expect((await sharePanel('csv', panel(1), META, env())).text).toBe('Downloaded uct-perf-2026-11-17.csv: 1 row, as shown.')
  })
})

describe('the picture', () => {
  it('goes to the clipboard, and says how many rows it holds', async () => {
    const on = env()
    const said = await sharePanel('image', panel(3), META, on)
    expect(said).toEqual({ kind: 'info', text: 'Copied PERF as an image: 3 rows, as shown. Paste it into Discord or a message.' })
    expect(on.copyImage).toHaveBeenCalledTimes(1)
    expect(on.copyImage.mock.calls[0][0].type).toBe('image/png')
    expect(on.download).not.toHaveBeenCalled()
    expect(on.render.mock.calls[0][1]).toBe(META)
  })

  it('the clipboard write is made inside the click: nothing is awaited before it', () => {
    const on = env()
    sharePanel('image', panel(2), META, on) // not awaited
    expect(on.copyImage).toHaveBeenCalledTimes(1)
  })

  it('is downloaded when the browser will not copy a picture, and the notice says which happened', async () => {
    const on = env({ copyImage: vi.fn(async () => false) })
    const said = await sharePanel('image', panel(3), META, on)
    expect(said).toEqual({ kind: 'info', text: 'Downloaded uct-perf-2026-11-17.png: 3 rows, as shown. Your browser did not allow copying a picture.' })
    expect(on.download).toHaveBeenCalledTimes(1)
    expect(on.download.mock.calls[0][1]).toBe('uct-perf-2026-11-17.png')
    expect(on.download.mock.calls[0][0].type).toBe('image/png')
  })

  it('says so when the picture holds only the first rows of a long list', async () => {
    const on = env({ render: vi.fn(() => ({ blob: new Blob(['png'], { type: 'image/png' }), shown: 50, total: 120 })) })
    expect((await sharePanel('image', panel(3), META, on)).text).toBe('Copied PERF as an image: the first 50 of the 120 rows on screen. Paste it into Discord or a message.')
  })

  it('a canvas that cannot be had, or a draw that throws, copies nothing and says what to do instead', async () => {
    for (const render of [vi.fn(() => null), vi.fn(() => { throw new Error('no canvas') })]) {
      const on = env({ render })
      const said = await sharePanel('image', panel(3), META, on)
      expect(said.kind).toBe('error')
      expect(said.text).toMatch(/could not be drawn.*nothing was copied.*Download spreadsheet/)
      expect(on.copyImage).not.toHaveBeenCalled()
      expect(on.download).not.toHaveBeenCalled()
    }
  })

  it('with nothing injected it uses the app\'s own clipboard write and download (one idiom)', async () => {
    const render = vi.fn((read) => ({ blob: new Blob(['png'], { type: 'image/png' }), shown: read.rowCount, total: read.rowCount }))
    await sharePanel('image', panel(2), META, { render, now: () => NOW })
    expect(copyBlobToClipboard).toHaveBeenCalledTimes(1)
    copyBlobToClipboard.mockResolvedValueOnce(false)
    await sharePanel('image', panel(2), META, { render, now: () => NOW })
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'uct-perf-2026-11-17.png')
    await sharePanel('csv', panel(2), META, { now: () => NOW })
    expect(downloadBlob).toHaveBeenLastCalledWith(expect.any(Blob), 'uct-perf-2026-11-17.csv')
  })
})

describe('text', () => {
  it('copies the rows tab-separated, and says so', async () => {
    const on = env()
    const said = await sharePanel('text', panel(2), META, on)
    expect(said).toEqual({ kind: 'info', text: 'Copied PERF as text: 2 rows, as shown. Paste it into a message or a sheet.' })
    const text = on.copyText.mock.calls[0][0]
    expect(text.split('\n').slice(2)).toEqual(['Setup\tTrades\tExpectancy', 'Setup 1\t10\t+$1.00', 'Setup 2\t11\t+$2.00'])
    expect(text.startsWith(BOM)).toBe(false)
  })

  it('a refused copy is an error that says nothing was copied', async () => {
    const said = await sharePanel('text', panel(2), META, env({ copyText: vi.fn(async () => false) }))
    expect(said.kind).toBe('error')
    expect(said.text).toMatch(/nothing was copied/)
  })

  it('the built-in copy uses the clipboard, and answers false where there is none', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText }, userAgent: 'jsdom' })
    expect((await sharePanel('text', panel(1), META, { now: () => NOW })).kind).toBe('info')
    expect(writeText).toHaveBeenCalledTimes(1)
    vi.stubGlobal('navigator', { userAgent: 'jsdom' })
    expect((await sharePanel('text', panel(1), META, { now: () => NOW })).kind).toBe('error')
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) }, userAgent: 'jsdom' })
    expect((await sharePanel('text', panel(1), META, { now: () => NOW })).kind).toBe('error')
  })
})

describe('nothing to share', () => {
  it('a panel with no rows says so, and copies or downloads nothing', async () => {
    const empty = document.createElement('div')
    empty.innerHTML = '<p>Loading</p><table><thead><tr><th>Setup</th></tr></thead><tbody></tbody></table>'
    for (const kind of ['image', 'csv', 'text']) {
      const on = env()
      expect(await sharePanel(kind, empty, META, on)).toEqual({ kind: 'info', text: 'PERF shows no list to share right now.' })
      expect(on.download).not.toHaveBeenCalled()
      expect(on.copyImage).not.toHaveBeenCalled()
      expect(on.copyText).not.toHaveBeenCalled()
      expect(on.render).not.toHaveBeenCalled()
    }
    expect((await sharePanel('csv', null, META, env())).text).toBe('PERF shows no list to share right now.')
  })

  it('an unknown way of sharing is refused', async () => {
    expect((await sharePanel('fax', panel(1), META, env())).kind).toBe('error')
  })
})

describe('the picture\'s colours and canvas', () => {
  it('reads the background, text, header grey and hairline from the page; the rest from the theme', () => {
    const body = panel(2)
    const styles = new Map([
      [document.body, { backgroundColor: 'rgb(16, 16, 18)' }],
      [body, { backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(240, 239, 234)', fontFamily: 'Test Sans' }],
      [body.querySelector('th'), { color: 'rgb(207, 202, 192)' }],
      [body.querySelector('td'), { borderBottomWidth: '1px', borderBottomColor: 'rgb(42, 44, 49)' }],
    ])
    const theme = readTheme(body, (el) => styles.get(el) || {})
    expect(theme).toMatchObject({ bg: 'rgb(16, 16, 18)', text: 'rgb(240, 239, 234)', muted: 'rgb(207, 202, 192)', hair: 'rgb(42, 44, 49)', family: 'Test Sans' })
    // What the page does not say comes from the theme tokens (their jsdom fallbacks here), never undefined.
    const bare = readTheme(body, () => ({}))
    for (const key of ['bg', 'text', 'bright', 'muted', 'border', 'hair', 'gold']) expect(bare[key], key).toMatch(/^#|^rgb/)
    expect(bare.hair).toBe(bare.border)
    expect(() => readTheme(body, () => { throw new Error('detached') })).not.toThrow()
  })

  it('draws at twice the density onto a canvas sized to the layout, and hands back PNG bytes', () => {
    const calls = []
    const ctx = { font: '', fillStyle: '', measureText: (t) => ({ width: String(t).length * 7 }) }
    for (const name of ['save', 'restore', 'scale', 'fillRect', 'fillText', 'drawImage']) ctx[name] = (...a) => calls.push([name, ...a])
    const canvas = { width: 0, height: 0 }
    const read = { rowCount: 1, notes: [], tables: [{ caption: '', columns: [{ text: 'Setup', align: 'left' }], rows: [{ no: null, cells: [{ lines: [[{ text: 'Flag', color: '', bold: false }]], align: 'left' }] }] }] }
    const made = renderShare(read, META, { bg: 'black', text: 'white', family: 'Test Sans' }, {
      now: NOW, dpr: 1, canvasOf: () => ({ canvas, ctx }), toPng: (c) => ({ png: true, w: c.width }),
    })
    expect(made).toMatchObject({ shown: 1, total: 1, width: 1200 })
    expect(canvas.width).toBe(1200)
    expect(canvas.height).toBe(made.height)
    expect(calls.find((c) => c[0] === 'scale')).toEqual(['scale', 2, 2])
    expect(calls.filter((c) => c[0] === 'fillText').map((c) => c[1])).toEqual(expect.arrayContaining(['Flag', 'Setup', 'UCT Intelligence', 'Source: Your journal', 'uctintelligence.com']))
    expect(made.blob).toEqual({ png: true, w: 1200 })
  })

  it('where no canvas can be had (this test environment) it answers null instead of throwing', () => {
    expect(renderShare({ rowCount: 0, notes: [], tables: [] }, META, { bg: 'black' }, { now: NOW })).toBeNull()
    expect(() => warmShare()).not.toThrow()
    expect(() => warmShare()).not.toThrow()
  })
})
