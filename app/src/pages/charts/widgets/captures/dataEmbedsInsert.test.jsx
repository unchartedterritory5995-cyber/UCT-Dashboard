// S13.6 remainder (audit 2026-11-05, "Hidden gems"): the COT and Model Book embeds, which a member could add
// only from their own pages, are reachable from inside a note -- the / menu's Live data section and the
// Insert panel -- and insert the SAME node their page's "Save to Notebook" builds, from the same reads.
// The Screener stays on its own page (it would need the screen run outside its shell: new plumbing).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { snapshotWidgetItems, groupedSlashItems } from '../../../journal-2-0/components/notebook/SlashMenu'
import WidgetPalette from '../../../journal-2-0/components/notebook/WidgetPalette'
import { buildExtensions } from '../../../journal-2-0/lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../journal-2-0/lib/offline/notebookFlags'
import { composeWeek } from '../../../cot/cotCompose'
import { buildCotCapture } from '../../../cot/cotNotebookCapture'
import { buildModelBookCapture } from '../../../modelbook/notebookCapture'
import { normalizeParams } from '../../../../widgets/registry'
import { CAPTURE_KINDS } from '../../../journal-2-0/lib/notebookWidgets'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

// The rail's own fixture shape (PositioningRail.notebookDoor.test.jsx `mkRows`).
function mkRows(n = 200) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2022, 0, 4 + i * 7))
    out.push({
      date: d.toISOString().slice(0, 10),
      commercial_net: -200_000 + i * 1_000,
      large_spec_net: 150_000 - i * 800,
      small_spec_net: 20_000 + (i % 7) * 1_000,
      open_interest: 1_800_000 + i * 1_500,
    })
  }
  return out
}
const ROWS = mkRows()
const SYMBOLS = { groups: { 'MOST WATCHED': [{ symbol: 'ES', name: 'S&P 500 E-Mini' }, { symbol: 'J6', name: 'Japanese Yen' }],
  INDICES: [{ symbol: 'ES', name: 'S&P 500 E-Mini' }] } }
const APPEARANCES = { symbol: 'NVDA', appearances: [{ id: 1, year: 2023, gain_pct: 239 }, { id: 2, year: 2024, gain_pct: 171 }] }

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const no = (status) => ({ ok: false, status, json: async () => ({}) })
let answers
const asked = []
beforeEach(() => {
  asked.length = 0
  answers = {
    '/api/cot/ES?weeks=520': ok(ROWS),
    '/api/cot/J6?weeks=520': ok(ROWS),
    '/api/cot/symbols': ok(SYMBOLS),
    '/api/modelbook/appearances/NVDA': ok(APPEARANCES),
    '/api/modelbook/appearances/ZZZZ': ok({ symbol: 'ZZZZ', appearances: [] }),
  }
  global.fetch = vi.fn(async (url) => { asked.push(String(url)); return answers[String(url)] || no(404) })
  latchNotebookFlags({ notebook_widgets_w4_enabled: true })
})
let editor
afterEach(() => { cleanup(); __resetNotebookFlags(); editor?.destroy(); editor = null })

const mount = (content = '<p>/x</p>') => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content })
  editor.storage.uctJournalWidgets = { ...(editor.storage.uctJournalWidgets || {}), notify: vi.fn() }
  return editor
}
const embeds = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') o.push(n) }); return o }
const run = async (query) => {
  const ed = mount()
  const item = snapshotWidgetItems(query).find((it) => it.title.includes('—'))
  expect(item, `no row for /${query}`).toBeTruthy()
  const res = await item.command({ editor: ed, range: { from: 1, to: 3 } })
  return { ed, res, item }
}

describe('/cot -- the COT positioning card from inside a note', () => {
  it('inserts the node the COT rail saves for the latest week: same reads, same builder', async () => {
    const { ed, res, item } = await run('cot ES')
    expect(item.title).toBe('COT positioning — ES')
    expect(res.ok).toBe(true)
    const [node] = embeds(ed)
    expect(node.attrs.widgetId).toBe('cot')
    const { snap, read } = composeWeek(ROWS, ROWS.length - 1, { symbol: 'ES', name: 'S&P 500 E-Mini' })
    expect(node.attrs.params).toEqual(normalizeParams('cot', buildCotCapture({ symbol: 'ES', name: 'S&P 500 E-Mini', snap, read })))
    // ⛔ `market`, never `symbol` (an 'ES' symbol would be filed as Eversource).
    expect(node.attrs.params).not.toHaveProperty('symbol')
    expect(node.attrs.params.market).toBe('ES')
  })

  it('takes a CFTC code with a digit (J6), which a ticker rule would refuse', async () => {
    const { ed, res } = await run('cot J6')
    expect(res.ok).toBe(true)
    expect(embeds(ed)[0].attrs.params).toMatchObject({ market: 'J6', marketName: 'Japanese Yen' })
  })

  it('asks only the stored CFTC reads the COT tab makes', async () => {
    await run('cot ES')
    expect(asked.sort()).toEqual(['/api/cot/ES?weeks=520', '/api/cot/symbols'])
  })

  it('an unknown market inserts nothing and says so', async () => {
    const { ed, res } = await run('cot QQ')
    expect(res.ok).toBe(false)
    expect(res.message).toBe('There is no COT market called QQ, so nothing was added.')
    expect(embeds(ed)).toHaveLength(0)
  })

  it('a bare /cot asks for a market', () => {
    expect(snapshotWidgetItems('cot').find((it) => it.cmd === 'cot')?.description).toBe('Type a market — e.g. /cot ES')
  })
})

describe('/modelbook -- the Model Book card from inside a note', () => {
  it('inserts the reference the Model Book saves, at the stock\'s most recent year', async () => {
    const { ed, res, item } = await run('modelbook NVDA')
    expect(item.title).toBe('Model Book — NVDA')
    expect(res.ok).toBe(true)
    const [node] = embeds(ed)
    expect(node.attrs.widgetId).toBe('modelbook')
    expect(node.attrs.params).toEqual(normalizeParams('modelbook', buildModelBookCapture({ year: 2024, symbol: 'NVDA' })))
    expect(asked).toEqual(['/api/modelbook/appearances/NVDA'])
  })

  it('a stock never in the Model Book inserts nothing (never a false "removed" card) and says so', async () => {
    const { ed, res } = await run('modelbook ZZZZ')
    expect(res.ok).toBe(false)
    expect(res.message).toBe('ZZZZ is not in the Model Book, so nothing was added.')
    expect(embeds(ed)).toHaveLength(0)
  })

  it('a paid-gated read says the plan, not "could not be loaded"', async () => {
    answers['/api/modelbook/appearances/NVDA'] = no(402)
    const { res } = await run('modelbook NVDA')
    expect(res.message).toBe('The Model Book needs a paid plan, so nothing was added.')
  })
})

describe('reachable: the Live data section and the Insert panel', () => {
  it('a bare / lists both under Live data', () => {
    const rows = groupedSlashItems([], snapshotWidgetItems(''))
    for (const title of ['COT positioning', 'Model Book']) {
      expect(rows.find((it) => it.title === title)?.section, title).toBe('live')
    }
  })

  it('the Insert panel lists both; COT asks for a market from the COT tab\'s own list', async () => {
    render(<WidgetPalette editor={mount('<p></p>')} />)
    const row = (title) => screen.getByText(title, { selector: 'span' }).closest('button')
    expect(row('Model Book').textContent).toContain('Choose a ticker, then insert a snapshot')
    expect(row('COT positioning').textContent).toContain('Choose a market, then insert a snapshot')
    fireEvent.click(row('COT positioning'))
    expect(screen.getByLabelText('Market')).toHaveAttribute('placeholder', 'e.g. ES, CL, GC')
    await waitFor(() => expect(document.querySelectorAll('#uct-palette-markets option')).toHaveLength(2))
    expect([...document.querySelectorAll('#uct-palette-markets option')].map((o) => o.value)).toEqual(['ES', 'J6'])
  })

  it('the Screener is still not offered from inside a note (deferred: it would need new plumbing)', () => {
    expect(CAPTURE_KINDS.some((k) => k.id === 'screener')).toBe(false)
  })
})
