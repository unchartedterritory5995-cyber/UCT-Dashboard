import { describe, expect, it, vi } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'
import {
  cardSym, injectSetupControls, loggedMisses, missedSymFrom, setupAnchor,
} from './setupFeedback'

const CARD = (sym, stamped = false) =>
  `<div class="rd-pick"${stamped ? ` data-sym="${sym}"` : ''}>` +
  `<div class="rd-pick-header"><hr class="rd-pick-hr"><span class="rd-pick-sym">${sym}</span><hr></div>` +
  '<div class="rd-pick-body"><p class="rd-pick-narrative">thesis</p></div></div>'

const BOARD = (...cards) =>
  '<section class="rd-seg" data-seg="setups"><div class="rd-seg-label">THE SETUPS</div>' +
  '<div class="rd-top-picks-grid">' + cards.join('') + '</div></section>'

const ctrl = (seg) =>
  `<span class="rd-fb"><button data-fb-vote="up" data-seg="${seg}">👍</button>` +
  `<button data-fb-vote="down" data-seg="${seg}">👎</button>` +
  `<button class="rd-fb-note" data-fb-note="${seg}">✎</button></span>`

function mount(html) {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

describe('setup feedback helpers', () => {
  it('reads the ticker from data-sym, else the card header', () => {
    const root = mount(BOARD(CARD('LITE', true), CARD('SKHY')))
    const [a, b] = root.querySelectorAll('.rd-pick')
    expect(cardSym(a)).toBe('LITE')
    expect(cardSym(b)).toBe('SKHY')
  })

  it('cleans a typed ticker and refuses junk', () => {
    expect(missedSymFrom(' $skhy ')).toBe('SKHY')
    expect(missedSymFrom('BRK.B')).toBe('BRK.B')
    expect(missedSymFrom('')).toBe('')
    expect(missedSymFrom('not a ticker')).toBe('')
  })

  it('lists the misses already logged', () => {
    expect(loggedMisses({ 'setup:LITE': {}, 'missed:SKHY': {}, 'missed:AXTI': {}, tape: {} }))
      .toEqual(['AXTI', 'SKHY'])
  })

  it('puts one control bar on every card and one missed box under the board', () => {
    const root = mount(BOARD(CARD('LITE', true), CARD('DELL')))
    injectSetupControls(root, ctrl)
    injectSetupControls(root, ctrl)                    // idempotent
    expect(root.querySelectorAll('.rd-setup-fb')).toHaveLength(2)
    expect(root.querySelectorAll('.rd-missed-fb')).toHaveLength(1)
    expect(root.querySelector('[data-seg="setup:LITE"][data-fb-vote="up"]')).not.toBeNull()
    expect(root.querySelector('[data-fb-note="setup:DELL"]')).not.toBeNull()
    expect(setupAnchor(root, 'setup:DELL')?.className).toBe('rd-setup-fb')
    expect(setupAnchor(root, 'tape')).toBeNull()
  })

  it('does nothing on a rundown with no board', () => {
    const root = mount('<section class="rd-seg" data-seg="tape"><div class="rd-seg-label">TAPE</div></section>')
    injectSetupControls(root, ctrl)
    expect(root.querySelector('.rd-setup-fb, .rd-missed-fb')).toBeNull()
  })
})

// ── the page: owner sees and uses it, a member never does ────────────────────
const RUNDOWN = BOARD(CARD('LITE', true), CARD('DELL', true))
let role = 'admin'
vi.mock('swr', () => ({
  default: vi.fn((key) => (key === '/api/rundown'
    ? { data: { html: RUNDOWN, date: '2026-10-02' } } : { data: null })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))
vi.mock('../context/AuthContext', async (orig) => ({
  ...(await orig()),
  useAuth: () => ({ user: { id: 'u1', role }, isPaid: true, plan: 'pro' }),
}))

describe('MorningWire board feedback', () => {
  it('owner: votes a card and logs a missed setup', async () => {
    role = 'admin'
    const calls = []
    global.fetch = vi.fn(async (url, opts) => {
      if (opts?.method === 'POST') calls.push(JSON.parse(opts.body))
      return { ok: true, status: 200, json: async () => ({ feedback: {} }) }
    })
    const { renderWithProviders } = await import('../test-utils')
    const { default: MorningWire } = await import('./MorningWire')
    const { container } = renderWithProviders(<MorningWire />)
    await waitFor(() => expect(container.querySelector('[data-seg="setup:LITE"]')).not.toBeNull())

    fireEvent.click(container.querySelector('[data-seg="setup:LITE"][data-fb-vote="up"]'))
    await waitFor(() => expect(calls).toContainEqual(
      { market_date: '2026-10-02', segment_key: 'setup:LITE', verdict: 'up' }))

    container.querySelector('.rd-missed-sym').value = 'skhy'
    container.querySelector('.rd-missed-note').value = 'tight under the high'
    fireEvent.click(container.querySelector('[data-fb-missed]'))
    await waitFor(() => expect(calls).toContainEqual(
      { market_date: '2026-10-02', segment_key: 'missed:SKHY', note: 'tight under the high' }))
    await waitFor(() => expect(container.querySelector('.rd-missed-status').textContent)
      .toBe('Logged today: SKHY'))
  })

  it('owner: a note the server refuses says "Save failed", never "Saved", and keeps the panel', async () => {
    role = 'admin'
    global.fetch = vi.fn(async (url, opts) => (opts?.method === 'POST'
      ? { ok: false, status: 500, json: async () => ({ detail: 'down' }) }
      : { ok: true, status: 200, json: async () => ({ feedback: {} }) }))
    const { renderWithProviders } = await import('../test-utils')
    const { default: MorningWire } = await import('./MorningWire')
    const { container } = renderWithProviders(<MorningWire />)
    await waitFor(() => expect(container.querySelector('[data-fb-note="setup:LITE"]')).not.toBeNull())
    fireEvent.click(container.querySelector('[data-fb-note="setup:LITE"]'))
    await waitFor(() => expect(container.querySelector('.rd-note-input')).not.toBeNull())
    container.querySelector('.rd-note-input').value = 'stop was too wide'
    fireEvent.click(container.querySelector('[data-fb-note-save]'))
    await waitFor(() => expect(container.querySelector('.rd-note-status').textContent).toBe('Save failed — try again'))
    expect(container.querySelector('.rd-note-panel')).not.toBeNull()
  })

  it('member: no setup controls at all', async () => {
    role = 'member'
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ feedback: {} }) }))
    const { renderWithProviders } = await import('../test-utils')
    const { default: MorningWire } = await import('./MorningWire')
    const { container } = renderWithProviders(<MorningWire />)
    await waitFor(() => expect(container.querySelector('.rd-pick')).not.toBeNull())
    expect(container.querySelector('.rd-setup-fb, .rd-missed-fb')).toBeNull()
  })
})
