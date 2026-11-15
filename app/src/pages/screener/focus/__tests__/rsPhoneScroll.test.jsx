// RS screens on a phone: the page scrolls as one. Seen on the live site on 2026-11-15 at 390 x 778:
// the RS controls, the ratings line, the market line and the "not in this list" line sit above the
// list, and with the list as its own scroller they left it a 152px window, about one stock, with the
// floating buttons over it. The page of an RS screen carries `data-phone-scroll`; the phone
// stylesheet makes that page the scroller (and ResultList scrolls it, ResultList.test.jsx).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { RS_NOTE_PREF } from '../rsScreens'
import { net, resetNet, installFetch, mount, pin } from './rsHarness'
import { RS_ROWS } from './rsScreensFixture'

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  net.prefs = { [RS_NOTE_PREF]: '1' }
  installFetch()
})
const landedOn = name => waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}.*Change screen`) })).toBeInTheDocument())
const page = () => screen.getByTestId('focus-screener')

test('the page of an RS screen is marked to scroll as one on a phone, and no other screen is', async () => {
  net.scan = () => ({ rows: RS_ROWS, total: RS_ROWS.length })
  pin(['starter_rs_leaders', 'starter_power_play'])
  mount()
  await landedOn('UCT RS Leaders')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  expect(page()).toHaveAttribute('data-phone-scroll')
  // the list is inside that page, which is what ResultList looks for
  expect(screen.getByRole('listbox').closest('[data-phone-scroll]')).toBe(page())

  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  fireEvent.click(await screen.findByRole('button', { name: /^Open Power plays/ }))
  await landedOn('Power plays')
  await waitFor(() => expect(page()).not.toHaveAttribute('data-phone-scroll'))
})

test('every RS screen is marked, the one that is not a list included', async () => {
  net.scan = () => ({ rows: RS_ROWS, total: RS_ROWS.length })
  pin(['starter_rs_leaders'])
  mount()
  await landedOn('UCT RS Leaders')
  for (const name of ['Top RS Rating', 'RS New Highs', 'RS New High Before Price', 'RS exit warnings']) {
    fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Open ${name}`) }))
    await landedOn(name)
    await waitFor(() => expect(page()).toHaveAttribute('data-phone-scroll'))
  }
})

test('in the Charts and Map layouts the page is not marked: they size their own scrollers', async () => {
  net.scan = () => ({ rows: RS_ROWS, total: RS_ROWS.length })
  pin(['starter_rs_leaders'])
  mount()
  await landedOn('UCT RS Leaders')
  await waitFor(() => expect(page()).toHaveAttribute('data-phone-scroll'))
  for (const layout of ['Charts', 'Map']) {
    fireEvent.click(screen.getByRole('button', { name: layout, pressed: false }))
    await waitFor(() => expect(page()).not.toHaveAttribute('data-phone-scroll'))
    fireEvent.click(screen.getByRole('button', { name: 'List', pressed: false }))
    await waitFor(() => expect(page()).toHaveAttribute('data-phone-scroll'))
  }
})

// jsdom applies no stylesheet, so the rules are read from the source: the page is the scroller, the
// list is not, the sort line sticks, and all of it only inside the phone query.
test('the phone stylesheet makes that page the one scroller', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../FocusScreener.module.css'), 'utf8').replace(/\r\n/g, '\n')
  const rules = [
    /\.page\[data-phone-scroll\]\s*\{[^}]*overflow-y:\s*auto/,
    /\.page\[data-phone-scroll\]\s*>\s*\.body\s*\{[^}]*flex:\s*none/,
    /\.page\[data-phone-scroll\]\s+\.listWrap\s*\{[^}]*flex:\s*none/,
    /\.page\[data-phone-scroll\]\s+\.list\s*\{[^}]*overflow-y:\s*visible/,
    /\.page\[data-phone-scroll\]\s+\.listHead\s*\{[^}]*position:\s*sticky/,
  ]
  // the phone block: from its query to the first rule that closes it at column 0
  const start = css.indexOf('@media (max-width: 640px) {\n  .body { flex-direction: column; }')
  expect(start).toBeGreaterThan(-1)
  const block = css.slice(start, css.indexOf('\n}\n', start))
  for (const r of rules) expect(block).toMatch(r)
  // and nowhere outside it: wider than a phone the list keeps its own scroll
  const outside = css.slice(0, start) + css.slice(start + block.length)
  expect(outside).not.toMatch(/data-phone-scroll/)
})
