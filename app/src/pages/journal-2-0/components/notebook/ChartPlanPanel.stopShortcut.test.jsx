// @vitest-environment jsdom
// Finish program, lane KEYS3 (Q21): arm an alert at the drawn stop, on a keyboard.
//
// It was 15 keys against a budget of 4. Opening the plan puts focus in it (lane KEYS), and the
// stop's "Arm alert at this level" was then 12 Tab stops on: each level row is four stops (its
// price, its role, an alert direction, the button) and the stop is the lowest line, so the
// last row. A row cannot become one arrow-key stop: its price field and its role radios both
// own the arrow keys.
//
// So the plan has ONE documented key, Ctrl+Alt+S (Cmd+Option+S on a Mac): from anywhere inside
// an open plan it moves focus to the stop's alert button. It arms nothing by itself: Enter on
// the button does. It is declared in the shared shortcut registry (`notebook.planStopAlert`),
// never a raw key listener, and the plan says so in a line of its own.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import ChartPlanPanel from './ChartPlanPanel'
import { shortcutById } from '../../../command/shortcutRegistry'
import { _resetBoundAlertSync } from '../../../../components/chart/useBoundDrawingAlerts'

vi.mock('lightweight-charts', () => ({
  createChart: () => ({ addSeries: () => ({}), timeScale: () => ({}), remove: () => {} }),
  createSeriesMarkers: () => ({ setMarkers: () => {} }),
  CandlestickSeries: {}, LineStyle: { Dashed: 2 }, ColorType: { Solid: 'solid' },
}))

const line = (id, price, role) => ({ id, type: 'horizontal', points: [{ time: 1758000000, price }], ...(role ? { role } : {}) })
const PLAN = [line('d-target', 180, 'target'), line('d-entry', 150, 'entry'), line('d-stop', 140, 'stop')]
const attrsWith = (annotations, embedId = 'emb-1') => ({
  widgetId: 'chart', embedId, params: { symbol: 'NVDA', tf: 'D', to: '2026-03-13' },
  annotations, ta: null, capturedAt: '2026-03-13T20:00:00Z',
})

let alerts
const realFetch = global.fetch
beforeEach(() => {
  _resetBoundAlertSync()
  alerts = []
  global.fetch = vi.fn(async (url) => {
    const ok = (data) => ({ ok: true, status: 200, json: async () => data })
    if (url === '/api/j2/chart-plan/size') {
      return ok({ plan: { entry: 150, stop: 140, target: 180, side: 'long' }, account: {}, compass: { ok: false } })
    }
    if (String(url).startsWith('/api/watchlist-alerts')) return ok(alerts)
    return ok({})
  })
})
afterEach(() => { global.fetch = realFetch })

const Panel = ({ annotations = PLAN, embedId = 'emb-1', open = true }) => (
  <ChartPlanPanel noteId="note-1" open={open} attrs={attrsWith(annotations, embedId)} updateAttributes={vi.fn()} />
)
const ui = (children) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <button type="button">Plan</button>
    {children}
  </SWRConfig>
)
const panels = () => [...document.querySelectorAll('[data-chart-plan-panel]')]
const chord = (extra = {}) => fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true, altKey: true, ...extra })
const armStop = (root = panels()[0]) => within(root).getByRole('button', { name: 'Arm alert at this level, 140.00' })
const TABBABLE = 'a[href], button:not([disabled]), select, input, textarea'
/** How many Tab stops lie between the panel taking focus and `el` (el included). */
const stopsTo = (root, el) => {
  const order = [...root.querySelectorAll(TABBABLE)].filter((n) => n.tabIndex >= 0)
  return order.indexOf(el) + 1
}

describe('Q21: Ctrl+Alt+S in an open plan goes to the stop\'s alert', () => {
  it('the declaration exists in the shared registry, with Ctrl or Cmd, Alt, and the physical S key', () => {
    const d = shortcutById('notebook.planStopAlert')
    expect(d).toBeTruthy()
    expect(d.chord).toMatchObject({ code: 'KeyS', alt: true, shift: false, mod: 'either' })
  })

  it('WITHOUT the key: the stop\'s alert is many Tab stops into the plan (the cost this removes)', () => {
    render(ui(<Panel />))
    // The stop is the last row, and its alert cell is that row's last Tab stop (the cell is
    // one stop: its direction select where one shows, else the button itself).
    const row = armStop().closest('[data-level-id]')
    const cellStop = [...row.querySelectorAll(TABBABLE)].filter((n) => n.tabIndex >= 0).pop()
    expect(stopsTo(panels()[0], cellStop)).toBeGreaterThanOrEqual(9)
  })

  it('from the panel itself, the key puts focus on the stop\'s "Arm alert at this level"', () => {
    render(ui(<Panel />))
    panels()[0].focus()                                  // where opening the plan puts focus
    chord()
    expect(document.activeElement).toBe(armStop())
  })

  it('from a field inside the plan too (the key works while typing a price)', () => {
    render(ui(<Panel />))
    screen.getByRole('spinbutton', { name: 'Price of the Target line, 180.00' }).focus()
    chord()
    expect(document.activeElement).toBe(armStop())
  })

  it('Cmd+Option+S is the same key on a Mac', () => {
    render(ui(<Panel />))
    panels()[0].focus()
    chord({ ctrlKey: false, metaKey: true })
    expect(document.activeElement).toBe(armStop())
  })

  it('focus OUTSIDE the plan: the key does nothing', () => {
    render(ui(<Panel />))
    const plan = screen.getByRole('button', { name: 'Plan' })
    plan.focus()
    chord()
    expect(document.activeElement).toBe(plan)
  })

  it('AltGr (which some layouts send as Ctrl+Alt) is never the shortcut', () => {
    render(ui(<Panel />))
    panels()[0].focus()
    const e = new KeyboardEvent('keydown', { key: 'ß', code: 'KeyS', ctrlKey: true, altKey: true, bubbles: true, cancelable: true })
    e.getModifierState = (k) => k === 'AltGraph'
    window.dispatchEvent(e)
    expect(document.activeElement).toBe(panels()[0])
  })

  it('a stop whose alert is already armed: focus goes to the stop\'s price field instead', async () => {
    alerts = [{ id: 1, sym: 'NVDA', is_active: true, drawing_id: 'nb:emb-1:d-stop', target_price: 140, direction: 'below' }]
    render(ui(<Panel />))
    await waitFor(() => expect(within(panels()[0]).getByText('Alert armed')).toBeTruthy())
    panels()[0].focus()
    chord()
    expect(document.activeElement).toBe(screen.getByRole('spinbutton', { name: 'Price of the Stop line, 140.00' }))
  })

  it('no level is marked Stop: nothing moves, and the plan does not advertise the key', () => {
    render(ui(<Panel annotations={[line('a', 150, 'entry'), line('b', 140)]} />))
    panels()[0].focus()
    chord()
    expect(document.activeElement).toBe(panels()[0])
    expect(document.querySelector('[data-plan-keys]')).toBeNull()
  })

  it('the plan says the key in words, and the button carries it for assistive tech', () => {
    render(ui(<Panel />))
    expect(document.querySelector('[data-plan-keys]').textContent).toMatch(/Ctrl\+Alt\+S goes to the stop's alert/)
    expect(armStop().getAttribute('aria-keyshortcuts')).toBe('Control+Alt+S Meta+Alt+S')
  })

  it('two plans open in one note: no conflict, and the plan that holds focus answers', () => {
    render(ui(<><Panel embedId="emb-1" /><Panel embedId="emb-2" /></>))
    const [, second] = panels()
    second.focus()
    chord()
    expect(document.activeElement).toBe(armStop(second))
  })

  it('a closed plan binds nothing: the key is free', () => {
    render(ui(<Panel open={false} />))
    const plan = screen.getByRole('button', { name: 'Plan' })
    plan.focus()
    const e = new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, altKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
  })
})
