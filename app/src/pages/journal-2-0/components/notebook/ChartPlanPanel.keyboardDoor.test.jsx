// Lane FIN-A11Y (review R4, I-6). A plan level could only be made or moved by drawing on
// the chart canvas with a pointer, and everything downstream (R:R, size, alerts, the
// Setups board) needs a level. The panel now has a keyboard and screen-reader door:
//   * "Add a level at price": a number field, a role, a button;
//   * each level's price is a number field with step keys;
//   * the role radios are ONE Tab stop, moved with the arrow keys.
// The door lives in the panel. It writes the same drawing shape the canvas writes
// (a horizontal line whose anchor is the level), through the same updateAttributes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { useState } from 'react'
import ChartPlanPanel from './ChartPlanPanel'
import { canCarryPlanRole, drawingLevelPrice } from '../../lib/chartPlan'
import { _resetBoundAlertSync } from '../../../../components/chart/useBoundDrawingAlerts'

vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({ setData: () => {}, update: () => {}, createPriceLine: () => {} }),
    timeScale: () => ({ setVisibleRange: () => {} }),
    remove: () => {},
  }),
  createSeriesMarkers: () => ({ setMarkers: () => {} }),
  CandlestickSeries: {},
  LineStyle: { Dashed: 2 },
  ColorType: { Solid: 'solid' },
}))

const line = (id, price, extra = {}) => ({ id, type: 'horizontal', points: [{ time: 1758000000, price }], ...extra })
const ANNS = [
  line('e', 101.5, { role: 'entry' }),
  line('s', 97.25),
  line('t', 112),
  { id: 'tx', type: 'text', points: [{ time: 1, price: 99 }], text: 'note' },
]
const attrsWith = (annotations) => ({
  widgetId: 'chart', embedId: 'emb-1', params: { symbol: 'NVDA', tf: 'D', to: '2026-03-13' },
  annotations, ta: null, capturedAt: '2026-03-13T20:00:00Z',
})

const realFetch = global.fetch
beforeEach(() => {
  _resetBoundAlertSync()
  global.fetch = vi.fn(async (url) => {
    const ok = (data) => ({ ok: true, status: 200, json: async () => data })
    if (url === '/api/j2/chart-plan/size') {
      return ok({ plan: { entry: null, stop: null, target: null, side: null }, account: {}, compass: { ok: false } })
    }
    if (url === '/api/watchlist-alerts') return ok([])
    return { ok: true, status: 200, json: async () => ({}) }
  })
})
afterEach(() => { global.fetch = realFetch })

/** The panel over attrs that really change, as the editor's updateAttributes makes them. */
function Host({ initial, spy }) {
  const [attrs, setAttrs] = useState(initial)
  const updateAttributes = (patch) => { spy?.(patch); setAttrs((a) => ({ ...a, ...patch })) }
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ChartPlanPanel noteId="note-1" open attrs={attrs} updateAttributes={updateAttributes} />
    </SWRConfig>
  )
}
const renderHost = (annotations = ANNS) => {
  const spy = vi.fn()
  render(<Host initial={attrsWith(annotations)} spy={spy} />)
  return { spy, last: () => spy.mock.calls[spy.mock.calls.length - 1][0].annotations }
}

const group = (price) => screen.getByRole('radiogroup', { name: 'Role of the line at ' + price })
const radio = (price, name) => within(group(price)).getByRole('radio', { name })

describe('I-6 -- the role radios are one Tab stop, moved with the arrow keys', () => {
  it('only the checked radio (or the first) is in the Tab order', () => {
    renderHost()
    const tabbable = (price) => within(group(price)).getAllByRole('radio').filter((r) => r.tabIndex === 0)
    expect(tabbable('101.50').map((r) => r.textContent)).toEqual(['Entry'])
    expect(tabbable('97.25').map((r) => r.textContent)).toEqual(['None'])
  })

  it('ArrowRight moves focus to the next role and selects it', async () => {
    const user = userEvent.setup()
    const { last } = renderHost()
    radio('97.25', 'None').focus()
    await user.keyboard('{ArrowRight}')   // Entry
    await user.keyboard('{ArrowRight}')   // Stop
    expect(radio('97.25', 'Stop')).toHaveFocus()
    expect(radio('97.25', 'Stop')).toHaveAttribute('aria-checked', 'true')
    expect(last().find((d) => d.id === 's').role).toBe('stop')
  })

  it('ArrowLeft from the first wraps to the last; Home and End jump', async () => {
    const user = userEvent.setup()
    renderHost()
    radio('112.00', 'None').focus()
    await user.keyboard('{ArrowLeft}')
    expect(radio('112.00', 'Target')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(radio('112.00', 'None')).toHaveFocus()
    await user.keyboard('{End}')
    expect(radio('112.00', 'Target')).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(radio('112.00', 'Stop')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(radio('112.00', 'Target')).toHaveFocus()
  })

  it('the selected role carries a check mark, not only a fill colour', () => {
    renderHost()
    expect(radio('101.50', 'Entry').querySelector('svg')).not.toBeNull()
    expect(radio('101.50', 'Stop').querySelector('svg')).toBeNull()
  })
})

describe('I-6 -- every level has a typed price with step keys', () => {
  it('each level has a number field named for the line', () => {
    renderHost()
    expect(screen.getByRole('spinbutton', { name: 'Price of the Entry line, 101.50' })).toHaveValue(101.5)
    expect(screen.getByRole('spinbutton', { name: 'Price of the line at 97.25' })).toHaveValue(97.25)
  })

  it('typing a price and pressing Enter moves the line: the anchor changes, no price copy is written', async () => {
    const user = userEvent.setup()
    const { last } = renderHost()
    const field = screen.getByRole('spinbutton', { name: 'Price of the line at 97.25' })
    await user.clear(field)
    await user.type(field, '96.4{Enter}')
    const s = last().find((d) => d.id === 's')
    expect(s.points[0].price).toBe(96.4)
    expect('price' in s).toBe(false)
    expect(s.type).toBe('horizontal')
    // the other drawings are untouched
    expect(last().find((d) => d.id === 'tx')).toEqual(ANNS[3])
    expect(last().find((d) => d.id === 'e')).toEqual(ANNS[0])
  })

  it('ArrowUp and ArrowDown step by one cent and write at once; PageUp steps by ten', async () => {
    const user = userEvent.setup()
    const { last } = renderHost()
    screen.getByRole('spinbutton', { name: 'Price of the Entry line, 101.50' }).focus()
    await user.keyboard('{ArrowUp}')
    expect(last().find((d) => d.id === 'e').points[0].price).toBe(101.51)
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(last().find((d) => d.id === 'e').points[0].price).toBe(101.49)
    await user.keyboard('{PageUp}')
    expect(last().find((d) => d.id === 'e').points[0].price).toBe(101.59)
    expect(last().find((d) => d.id === 'e').role).toBe('entry')
  })

  it('focus stays on the same line while it is stepped, even when the order of the rows changes', async () => {
    const user = userEvent.setup()
    renderHost([line('a', 100), line('b', 100.01)])
    screen.getByRole('spinbutton', { name: 'Price of the line at 100.00' }).focus()
    await user.keyboard('{ArrowUp}{ArrowUp}')   // 100.02: now above b
    const rows = [...screen.getByRole('list', { name: 'Drawn levels' }).querySelectorAll('li')]
    expect(rows.map((r) => r.getAttribute('data-level-id'))).toEqual(['a', 'b'])
    expect(document.activeElement).toBe(rows[0].querySelector('input'))
  })

  it('a price of zero or nothing is refused, said aloud, and writes nothing', async () => {
    const user = userEvent.setup()
    const { spy } = renderHost()
    const field = screen.getByRole('spinbutton', { name: 'Price of the line at 97.25' })
    await user.clear(field)
    await user.type(field, '0{Enter}')
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/price above zero/i)
    expect(field).toHaveValue(97.25)
  })

  it('Escape puts back the price the line is at', async () => {
    const user = userEvent.setup()
    const { spy } = renderHost()
    const field = screen.getByRole('spinbutton', { name: 'Price of the line at 97.25' })
    await user.clear(field)
    await user.type(field, '50{Escape}')
    expect(field).toHaveValue(97.25)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('I-6 -- a level can be made without a pointer', () => {
  it('with nothing drawn, the panel offers "Add a level at price"', () => {
    renderHost([])
    expect(screen.getByRole('spinbutton', { name: 'Add a level at price' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Role of the new level' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add level' })).toBeInTheDocument()
  })

  it('adding 105 as Entry writes a real horizontal line with that role, and says so', async () => {
    const user = userEvent.setup()
    const { last } = renderHost([])
    await user.type(screen.getByRole('spinbutton', { name: 'Add a level at price' }), '105')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role of the new level' }), 'entry')
    await user.click(screen.getByRole('button', { name: 'Add level' }))
    const made = last()
    expect(made).toHaveLength(1)
    expect(made[0].type).toBe('horizontal')
    expect(made[0].role).toBe('entry')
    expect(made[0].id).toBeTruthy()
    expect(drawingLevelPrice(made[0])).toBe(105)
    expect(canCarryPlanRole(made[0])).toBe(true)
    expect('price' in made[0]).toBe(false)
    expect(await screen.findByRole('status')).toHaveTextContent(/Added a level at 105\.00.*Entry/)
  })

  it('focus lands on the new level\'s price field, and the add field is cleared', async () => {
    const user = userEvent.setup()
    renderHost(ANNS)
    const add = screen.getByRole('spinbutton', { name: 'Add a level at price' })
    await user.type(add, '108.5{Enter}')
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole('spinbutton', { name: 'Price of the line at 108.50' }),
    ))
    expect(screen.getByRole('spinbutton', { name: 'Add a level at price' })).toHaveValue(null)
  })

  it('adding a second Entry moves the role off the first (a plan has one entry)', async () => {
    const user = userEvent.setup()
    const { last } = renderHost(ANNS)
    await user.type(screen.getByRole('spinbutton', { name: 'Add a level at price' }), '103')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role of the new level' }), 'entry')
    await user.click(screen.getByRole('button', { name: 'Add level' }))
    const entries = last().filter((d) => d.role === 'entry')
    expect(entries).toHaveLength(1)
    expect(drawingLevelPrice(entries[0])).toBe(103)
    expect(last().map((d) => d.id).slice(0, 4)).toEqual(['e', 's', 't', 'tx'])
  })

  it('two levels added one after the other get different ids', async () => {
    const user = userEvent.setup()
    const { last } = renderHost([])
    const add = () => screen.getByRole('spinbutton', { name: 'Add a level at price' })
    await user.type(add(), '10{Enter}')
    await user.type(add(), '11{Enter}')
    const ids = last().map((d) => d.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('an empty or zero price is refused, said aloud, and writes nothing', async () => {
    const user = userEvent.setup()
    const { spy } = renderHost([])
    await user.click(screen.getByRole('button', { name: 'Add level' }))
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/price above zero/i)
    expect(screen.getByRole('spinbutton', { name: 'Add a level at price' })).toHaveFocus()
  })
})

describe('I-6 -- the door lives in the panel', () => {
  it('ChartPlanPanel and its controls import nothing from StockChart or the drawing overlay', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(process.cwd(), 'src/pages/journal-2-0/components/notebook')
    for (const f of ['ChartPlanPanel.jsx', 'ChartPlanLevelControls.jsx']) {
      const src = readFileSync(join(dir, f), 'utf8')
      expect(src, f).not.toMatch(/from\s+['"][^'"]*(StockChart|ChartDrawingOverlay)['"]/)
    }
  })
})
