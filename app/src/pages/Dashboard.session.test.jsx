// app/src/pages/Dashboard.session.test.jsx
//
// ⭐ THE ONE THING THE FOUR-ZONE COCKPIT EXISTS TO GET RIGHT: the page must
// resolve exactly ONE session state per render, and Zone B must swap its hero
// with it. Before this, `/dashboard` rendered its weekday composition on a
// Saturday — "Markets are closed" beside an 849px dead column.
//
// ⛔ THE SESSION IS INJECTED, NOT SIMULATED WITH A CLOCK.
// `lesson_a_half_faked_clock_manufactures_false_positives`: faking Date to
// land inside an ET window makes the test a test of `resolveSession`'s
// timezone arithmetic (which `useSessionState.test.js` already owns) rather
// than of the composition. `vi.doMock` on the hook keeps this file measuring
// exactly one thing — that Zone B follows the state it is handed.
//
// ⛔ BOTH BRANCHES ARE SESSION-AWARE. jsdom computes no layout, so a render
// of <Dashboard /> mounts the desktop AND mobile branches simultaneously (CSS
// `display:none` is what separates them in a browser, and jsdom applies none
// of it). The WEEKEND assertion below — "never the weekday hero" — is
// therefore only satisfiable if the MOBILE hero swaps too. That is not a test
// artefact: a member on a phone on a Saturday saw the same dead weekday
// composition, and the fix has to reach them as well.
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { test, expect, vi, afterEach } from 'vitest'

vi.mock('swr', () => ({
  default: () => ({ data: null, error: null, isLoading: false }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock('./dashboard/TheWeek', () => ({ default: () => <div>THE WEEK</div> }))
vi.mock('../components/tiles/CatalystTable', () => ({ default: () => <div>CATALYSTS</div> }))

afterEach(() => {
  cleanup()
  vi.resetModules()
})

async function renderAt(session) {
  vi.doMock('./dashboard/useSessionState', () => ({
    default: () => session,
    resolveSession: () => session,
  }))
  const { default: Dashboard } = await import('./Dashboard')
  render(<MemoryRouter><Dashboard /></MemoryRouter>)
}

test('WEEKEND renders The Week, never the weekday hero', async () => {
  await renderAt('WEEKEND')
  expect(screen.getAllByText('THE WEEK').length).toBeGreaterThan(0)
  expect(screen.queryByText('CATALYSTS')).toBeNull()
})

for (const s of ['PREMARKET', 'LIVE', 'CLOSED']) {
  test(`${s} renders the catalyst hero`, async () => {
    await renderAt(s)
    expect(screen.getAllByText('CATALYSTS').length).toBeGreaterThan(0)
    expect(screen.queryByText('THE WEEK')).toBeNull()
  })
}
