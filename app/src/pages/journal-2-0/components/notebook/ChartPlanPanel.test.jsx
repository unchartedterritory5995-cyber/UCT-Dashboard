// Wave 13 lane 13H-2 — ChartPlanPanel: roles on drawn levels, the server's plan reading sized by
// the starter formulas (or Compass), alerts through 13H-1's adapter, follow-the-line through the
// EXISTING bound-alert hook, and the touch claim.
//
// ⛔ The numbers the panel shows are asserted against `sizePlan` run on the SAME server answer —
// not against literals retyped here — so the rail holds "the panel shows what the starter
// formulas / Compass say", which is the claim, rather than "the panel shows 400".
//
// CONTRACT: the plan reading, the account inputs, Compass's answer and the alert route's answers
// are the REAL server's (`__fixtures__/contract`, written by tools/notebook_contract_fixtures.py
// from POST /api/j2/chart-plan/size and /alerts). The drawings the panel is given are the same
// client-shaped drawings those answers were recorded for. The two routes this wave did not add
// (`/api/watchlist-alerts`, `/api/bars`) keep small stand-ins, the alert rows in the server's
// own row shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import ChartPlanPanel, { boundAlertId, roleDirection } from './ChartPlanPanel'
import { sizePlan, SIZED_BY_LABEL } from '../../lib/chartPlan'
import { _resetBoundAlertSync } from '../../../../components/chart/useBoundDrawingAlerts'
import { contract, contractBody, contractResponse } from '../../__fixtures__/contract'

// The replay engine draws with its own lightweight-charts instance; jsdom has no canvas.
const chartCalls = vi.hoisted(() => ({ setMarkers: [], lines: [] }))
vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({
      setData: () => {}, update: () => {},
      createPriceLine: (o) => chartCalls.lines.push(o),
    }),
    timeScale: () => ({ setVisibleRange: () => {} }),
    remove: () => {},
  }),
  createSeriesMarkers: () => ({ setMarkers: (m) => chartCalls.setMarkers.push(m) }),
  CandlestickSeries: {},
  LineStyle: { Dashed: 2 },
  ColorType: { Solid: 'solid' },
}))

const line = (id, price, extra = {}) => ({ id, type: 'horizontal', points: [{ time: 1758000000, price }], ...extra })
const ANNS = [
  line('e', 101.5, { role: 'entry' }),
  line('s', 97.25),
  line('t', 112),
  line('rsi', 30, { pane: 'pane1' }),             // another pane: never a plan level
  { id: 'tx', type: 'text', points: [{ time: 1, price: 99 }], text: 'note' },
]
const attrsWith = (annotations, ta = null) => ({
  widgetId: 'chart', embedId: 'emb-1', params: { symbol: 'CPNV', tf: 'D', to: '2026-03-13' },
  annotations, ta, capturedAt: '2026-03-13T20:00:00Z',
})

// Daily bars around the note's as-of (2026-03-13): two before, three after.
const BARS = [
  { t: '2026-03-11', o: 100, h: 101, l: 99, c: 100.5 },
  { t: '2026-03-12', o: 100.5, h: 102, l: 100, c: 101.6 },
  { t: '2026-03-13', o: 101.6, h: 103, l: 101, c: 102 },   // the note
  { t: '2026-03-16', o: 102, h: 104, l: 101.5, c: 103 },
  { t: '2026-03-17', o: 103, h: 113, l: 102.5, c: 112.5 }, // target reached
  { t: '2026-03-18', o: 112.5, h: 113, l: 96, c: 97 },     // then the stop
]

// The server's answer for a member Compass does not size: the starter formulas run. It WAS the
// free-plan answer; the security lane made the route paid (I-7), so a free member now answers
// 402 and that fixture is a refusal. The same reading for a paid member is the Compass-silent
// answer (the brain pack not installed, which is production's state while its flags are off).
const STARTER = () => contractBody('chart-plan.size.compass-unavailable')
const PLAN = STARTER().plan
const ACCOUNT = STARTER().account
// The drawings above carry the same three levels the answers were recorded for.
const RECORDED = contract('chart-plan.size')._contract.requestBody.annotations

let calls
let alertsList
let sizeAnswer
function installFetch() {
  calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, method, body })
    const ok = (data) => ({ ok: true, status: 200, json: async () => data })
    if (url === '/api/j2/chart-plan/size') return ok(sizeAnswer)
    if (url === '/api/j2/chart-plan/alerts') return contractResponse('chart-plan.alerts.armed')
    if (url.startsWith('/api/watchlist-alerts/bound/')) return ok({ ok: true, updated: 1 })
    if (url === '/api/watchlist-alerts') return ok(alertsList)
    if (url.startsWith('/api/bars/')) return ok({ bars: BARS })
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

const renderPanel = (props) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <ChartPlanPanel noteId="note-1" open updateAttributes={vi.fn()} {...props} />
  </SWRConfig>,
)

const realFetch = global.fetch
beforeEach(() => {
  _resetBoundAlertSync()
  alertsList = []
  sizeAnswer = STARTER()
  installFetch()
})
afterEach(() => { global.fetch = realFetch })

describe('the drawings under test are the ones the server answers were recorded for', () => {
  it('same shape (the level is the line own anchor) and the same three prices', () => {
    const byRole = Object.fromEntries(RECORDED.map((d) => [d.role, d]))
    for (const d of RECORDED) {
      expect(Object.keys(d).sort()).toEqual(['id', 'points', 'role', 'type'])
      expect('price' in d).toBe(false)
    }
    expect(byRole.entry.points[0].price).toBe(ANNS.find((d) => d.id === 'e').points[0].price)
    expect(byRole.stop.points[0].price).toBe(ANNS.find((d) => d.id === 's').points[0].price)
    expect(byRole.target.points[0].price).toBe(ANNS.find((d) => d.id === 't').points[0].price)
    expect([PLAN.entry, PLAN.stop, PLAN.target]).toEqual([101.5, 97.25, 112])
    expect(PLAN.side).toBe('long')
  })
})

describe('levels and roles', () => {
  it('lists only flat price-pane levels, highest first', () => {
    renderPanel({ attrs: attrsWith(ANNS) })
    const rows = screen.getByRole('list', { name: 'Drawn levels' }).querySelectorAll('li')
    expect([...rows].map((r) => r.getAttribute('data-level-id'))).toEqual(['t', 'e', 's'])
  })

  it('marking a line Stop writes the role ON the drawing through setPlanRole — no price copy', () => {
    const updateAttributes = vi.fn()
    renderPanel({ attrs: attrsWith(ANNS), updateAttributes })
    const group = screen.getByRole('radiogroup', { name: 'Role of the line at 97.25' })
    fireEvent.click(group.querySelector('[data-role="stop"]'))
    const next = updateAttributes.mock.calls[0][0].annotations
    const s = next.find((d) => d.id === 's')
    expect(s.role).toBe('stop')
    expect('price' in s).toBe(false)               // the line's own anchor is the level
    expect(next.find((d) => d.id === 'e').role).toBe('entry')
  })

  it('with no level drawn it says how to start, and offers nothing to click', () => {
    renderPanel({ attrs: attrsWith([]) })
    expect(screen.getByText(/Draw a horizontal line on this chart/)).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })
})

describe('R:R and size come from the server reading, sized by the starter formulas or Compass', () => {
  it('starter: the panel shows exactly sizePlan(server answer), with the engine label', async () => {
    renderPanel({ attrs: attrsWith(ANNS) })
    const expected = sizePlan({ ...PLAN, accountSize: ACCOUNT.accountSize, riskPct: ACCOUNT.riskPct, compass: sizeAnswer.compass })
    await waitFor(() => expect(document.querySelector('[data-plan-value="shares"]')).toBeTruthy())
    expect(expected.sizedBy).toBe('starter')
    // UNITS, as literals off the real answer: riskPct 1.0 is ONE PERCENT of 100,000 = $1,000 at
    // risk; 4.25 a share between entry and stop is 235 shares. Read as a fraction it would be
    // 23,529; read as a percent of a percent, 2.
    expect(sizeAnswer.account).toMatchObject({ accountSize: 100000, riskPct: 1 })
    expect(expected.accountRisk).toBe(1000)
    expect(expected.shares).toBe(235)
    expect(expected.rewardToRisk).toBeCloseTo((112 - 101.5) / (101.5 - 97.25), 6)
    expect(document.querySelector('[data-plan-value="shares"]').textContent).toBe(`${expected.shares.toLocaleString()} sh`)
    expect(document.querySelector('[data-plan-value="rr"]').textContent).toBe(`${expected.rewardToRisk.toFixed(2)}R`)
    expect(screen.getByText(SIZED_BY_LABEL.starter)).toBeInTheDocument()
    expect(screen.getByText(/^Sized by the Position size formula/)).toBeInTheDocument()
    // the body the server read was the drawings themselves (plan_extract reads them there)
    const sent = calls.find((c) => c.url === '/api/j2/chart-plan/size').body
    expect(sent.annotations.map((d) => d.id)).toEqual(ANNS.map((d) => d.id))
    expect(sent.symbol).toBe('CPNV')
    // every key the recorded request carried is one the panel sends
    expect(Object.keys(sent)).toEqual(expect.arrayContaining(Object.keys(contract('chart-plan.size')._contract.requestBody)))
  })

  it('Compass answered for a paid long: its shares, its label', async () => {
    sizeAnswer = contractBody('chart-plan.size')
    expect(sizeAnswer.compass).toMatchObject({ ok: true, sizedBy: 'compass', shares: 235 })
    renderPanel({ attrs: attrsWith(ANNS) })
    await screen.findByText(SIZED_BY_LABEL.compass)
    expect(screen.getByText(/^Sized by Compass/)).toBeInTheDocument()
    expect(document.querySelector('[data-plan-value="shares"]').textContent).toBe('235 sh')
  })

  it('no account size: no shares, the reason, and where to set it', async () => {
    // One scalar overridden on the real answer: a member who cleared their account size.
    sizeAnswer = { ...STARTER(), account: { ...ACCOUNT, accountSize: null } }
    renderPanel({ attrs: attrsWith(ANNS) })
    await screen.findByText(/No account size is set/)
    expect(document.querySelector('[data-plan-value="shares"]').textContent).toBe('—')
  })

  it('a member who never set their sizing: the server sends no max risk, and the panel says which is missing', async () => {
    sizeAnswer = contractBody('chart-plan.size.default-account')
    expect(sizeAnswer.account).toMatchObject({ accountSize: 100000, riskPct: null })
    expect(sizeAnswer.compass.ok).toBe(false)
    const expected = sizePlan({ ...sizeAnswer.plan, accountSize: sizeAnswer.account.accountSize, riskPct: sizeAnswer.account.riskPct, compass: sizeAnswer.compass })
    expect(expected.shares).toBeNull()
    expect(expected.reason).toMatch(/max risk/i)
    renderPanel({ attrs: attrsWith(ANNS.filter((d) => d.id !== 't')) })
    expect(await screen.findByText(`${expected.reason} — set it in Journal Settings, Accounts.`)).toBeInTheDocument()
    expect(document.querySelector('[data-plan-value="shares"]').textContent).toBe('—')
  })

  it('a chart with no plan line yet: the server reads no plan, and the panel says what to draw', async () => {
    sizeAnswer = contractBody('chart-plan.size.no-levels')
    expect(sizeAnswer.plan).toMatchObject({ entry: null, stop: null, target: null, side: null })
    renderPanel({ attrs: attrsWith([line('x', 50)]) })
    expect(await screen.findByText('Draw an entry and a stop to size this trade')).toBeInTheDocument()
    expect(document.querySelector('[data-plan-value="shares"]').textContent).toBe('—')
  })

  it('a refused reading is said out loud, never shown as an empty plan', async () => {
    global.fetch = vi.fn(async (url) => (url === '/api/j2/chart-plan/size'
      ? contractResponse('chart-plan.size.bad-body')
      : { ok: true, json: async () => [] }))
    renderPanel({ attrs: attrsWith(ANNS) })
    expect(await screen.findByRole('alert')).toHaveTextContent('The plan could not be sized.')
  })

  it('"Use this size" writes ta.planBlock (shares + engine) — and only on the click', async () => {
    const updateAttributes = vi.fn()
    renderPanel({ attrs: attrsWith(ANNS), updateAttributes })
    const btn = await screen.findByRole('button', { name: 'Use this size in the plan' })
    expect(updateAttributes).not.toHaveBeenCalled()
    fireEvent.click(btn)
    const ta = updateAttributes.mock.calls[0][0].ta
    expect(ta.planBlock.sizedBy).toBe('starter')
    expect(ta.planBlock.shares).toBeGreaterThan(0)
  })
})

describe('alerts at a drawn level', () => {
  it('direction follows the role and the side', () => {
    expect(roleDirection('stop', 'long')).toBe('below')
    expect(roleDirection('target', 'long')).toBe('above')
    expect(roleDirection('stop', 'short')).toBe('above')
    expect(roleDirection('entry', null)).toBeNull()
  })

  it('arms through 13H-1 adapter with the chart-namespaced drawing id and the line geometry', async () => {
    renderPanel({ attrs: attrsWith(ANNS.map((d) => (d.id === 's' ? { ...d, role: 'stop' } : d))) })
    await waitFor(() => expect(document.querySelector('[data-plan-value="shares"]')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Arm alert at this level, 97.25' }))
    await screen.findByText(/Alert armed: CPNV below 97.25/)
    const post = calls.find((c) => c.url === '/api/j2/chart-plan/alerts')
    expect(post.method).toBe('POST')
    expect(post.body).toMatchObject({
      noteId: 'note-1', embedId: 'emb-1', drawingId: boundAlertId('emb-1', 's'),
      direction: 'below', alert_type: 'line', target_price: 97.25,
    })
    // Every field the recorded request carried is one the panel sends, and the geometry the
    // server stored (direction, type, price) is the geometry the panel asked for.
    const recorded = contract('chart-plan.alerts.armed')
    expect(Object.keys(post.body)).toEqual(expect.arrayContaining(Object.keys(recorded._contract.requestBody)))
    expect(recorded.body.alert).toMatchObject({ direction: post.body.direction, alert_type: post.body.alert_type, target_price: post.body.target_price })
  })

  it('a chart the note has not saved yet says so (the adapter finds charts in the STORED note)', async () => {
    global.fetch = vi.fn(async (url) => {
      if (url === '/api/j2/chart-plan/alerts') return contractResponse('chart-plan.alerts.no-chart')
      if (url === '/api/j2/chart-plan/size') return { ok: true, json: async () => sizeAnswer }
      return { ok: true, json: async () => [] }
    })
    renderPanel({ attrs: attrsWith(ANNS) })
    fireEvent.click(screen.getByRole('button', { name: 'Arm alert at this level, 112.00' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('still saving this chart')
  })

  it('an armed level shows armed; moving its line PATCHes the bound alert; a cold mount never deletes', async () => {
    const row = contractBody('chart-plan.alerts.armed').alert       // the server's own alert row
    alertsList = [
      // armed at the OLD price of 's' -> the line has since moved to 97.25: re-point it
      { ...row, id: 'a1', drawing_id: boundAlertId('emb-1', 's'), target_price: 96.0 },
      // bound to a drawing this chart never had (another browser, not synced): leave it alone
      { ...row, id: 'a2', drawing_id: boundAlertId('emb-1', 'gone'), target_price: 90 },
    ]
    renderPanel({ attrs: attrsWith(ANNS) })
    await screen.findByText('Alert armed')
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    const patch = calls.find((c) => c.method === 'PATCH')
    expect(patch.url).toBe(`/api/watchlist-alerts/bound/${encodeURIComponent(boundAlertId('emb-1', 's'))}`)
    expect(patch.body.target_price).toBe(97.25)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([])
  })
})

describe('touch routing: the panel claims BOTH event families', () => {
  it('pointerdown, mousedown and touchstart on the panel never reach an ancestor; a sibling still does', () => {
    const seen = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    for (const t of ['pointerdown', 'mousedown', 'touchstart']) host.addEventListener(t, () => seen.push(t))
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ChartPlanPanel attrs={attrsWith(ANNS)} noteId="n" open updateAttributes={vi.fn()} />
        <button type="button" data-testid="outside">x</button>
      </SWRConfig>,
      { container: host },
    )
    const panel = document.querySelector('[data-chart-plan-panel]')
    for (const t of ['pointerdown', 'mousedown', 'touchstart']) {
      panel.querySelector('button').dispatchEvent(new Event(t, { bubbles: true }))
    }
    expect(seen).toEqual([])
    // CONTROL: the listeners are live — an event outside the panel reaches them
    screen.getByTestId('outside').dispatchEvent(new Event('touchstart', { bubbles: true }))
    expect(seen).toEqual(['touchstart'])
    host.remove()
  })
})

describe('"what happened next" — the one replay engine, from the note’s as-of', () => {
  beforeEach(() => { chartCalls.setMarkers.length = 0; chartCalls.lines.length = 0 })

  it('opens AT the note, steps forward bar by bar, and names the level hits in order', async () => {
    renderPanel({ attrs: attrsWith(ANNS), open: false, replayOpen: true, onCloseReplay: vi.fn() })
    expect(await screen.findByRole('dialog', { name: 'What happened next · CPNV' })).toBeInTheDocument()
    expect(await screen.findByText('At the note — step forward')).toBeInTheDocument()
    expect(calls.find((c) => c.url.startsWith('/api/bars/')).url).toBe('/api/bars/CPNV?tf=D&bars=5000')
    // the plan levels plan_extract read become the replay's price lines (they arrive after the bars)
    await waitFor(() => expect(chartCalls.lines.map((l) => l.title)).toEqual(['entry', 'stop', 'target']))
    expect(screen.getByText('At the note — step forward')).toBeInTheDocument()   // position kept
    const step = screen.getByRole('button', { name: 'Step forward one bar' })
    fireEvent.click(step)
    expect(screen.getByText('1 bar after the note')).toBeInTheDocument()
    expect(screen.getByText('+0.98%')).toBeInTheDocument()       // 103 vs the note's close 102
    fireEvent.click(step)
    expect(screen.getByText('2 bars after the note · target reached')).toBeInTheDocument()
    fireEvent.click(step)
    expect(screen.getByText('3 bars after the note · target reached, stop hit (target first)')).toBeInTheDocument()
    expect(step).toBeDisabled()                                  // nothing printed after the last bar
  })

  it('a chart that tracks now has nothing after it — said, not shown as an empty chart', async () => {
    const attrs = { ...attrsWith(ANNS), params: { symbol: 'CPNV', tf: 'D', to: null } }
    renderPanel({ attrs, open: false, replayOpen: true })
    expect(await screen.findByRole('alert')).toHaveTextContent('This chart tracks now')
  })
})
