// REL and CORR publish the names they compare (completeness audit 2026-10-07, column g): each
// table row is a numbered row that LOADS its name (`$SYM`), and the names are the panel's list for
// BOARD / the "Board of" control. Nothing is published before the comparison is on screen.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PanelListContext } from '../../../components/terminal'
import RelPanel from './RelPanel'
import CorrPanel from './CorrPanel'
import { clearClosesCache } from './useCloses'
import { fakeBarsFetch, series, weekdays, wiggle } from './__fixtures__/compareFixtures'

const realFetch = globalThis.fetch
beforeEach(() => { clearClosesCache() })
afterEach(() => { globalThis.fetch = realFetch })
const serve = (bySym) => { globalThis.fetch = vi.fn(fakeBarsFetch(bySym)) }

function harness() {
  const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [{ code: 'GP', label: 'Chart' }], pageSize: 4 }
  const wrapper = ({ children }) => <PanelListContext.Provider value={api}>{children}</PanelListContext.Provider>
  return { api, wrapper }
}

describe('REL publishes its rows', () => {
  const dates = weekdays(300)
  it('one `$SYM` row per table row, in table order, and the names as its list', async () => {
    serve({ NVDA: series(dates, () => 0.002), AMD: series(dates, () => 0), SMH: series(dates, () => 0.001) })
    const { api, wrapper } = harness()
    render(<RelPanel sym="NVDA" with0="AMD" with1="SMH" />, { wrapper })
    await screen.findByTestId('terminal-rel-table')
    await waitFor(() => expect(api.publishRows).toHaveBeenLastCalledWith(['$NVDA', '$AMD', '$SMH']))
    expect(api.publish).toHaveBeenLastCalledWith({ syms: ['NVDA', 'AMD', 'SMH'], label: 'REL 6M' })
    expect(screen.getByTestId('terminal-rel-board-open')).toHaveTextContent('Open 3')
  })

  it('CONTROL: while loading, and on a genuine empty, there is no list to address', async () => {
    serve({ NVDA: series(dates.slice(0, 5), () => 0.002), AMD: series(dates.slice(-5), () => 0) })
    const { api, wrapper } = harness()
    render(<RelPanel sym="NVDA" with0="AMD" />, { wrapper })
    expect(api.publishRows).toHaveBeenLastCalledWith([])
    await screen.findByTestId('terminal-rel-empty')
    expect(api.publishRows).toHaveBeenLastCalledWith([])
    expect(api.publish).toHaveBeenLastCalledWith(null)
  })
})

describe('CORR publishes its rows', () => {
  const dates = weekdays(200)
  it('one `$SYM` row per matrix row, in matrix order, and the names as its list', async () => {
    serve({
      AAA: series(dates, (i) => wiggle(i, 1)),
      BBB: series(dates, (i) => wiggle(i, 1), 40),
      CCC: series(dates, (i) => -wiggle(i, 1)),
    })
    const { api, wrapper } = harness()
    render(<CorrPanel sym="AAA" with0="BBB" with1="CCC" />, { wrapper })
    await screen.findByTestId('terminal-corr-matrix')
    await waitFor(() => expect(api.publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC']))
    expect(api.publish).toHaveBeenLastCalledWith({ syms: ['AAA', 'BBB', 'CCC'], label: 'CORR 3M' })
    expect(screen.getByTestId('terminal-corr-board-open')).toHaveTextContent('Open 3')
  })

  it('CONTROL: a failed read publishes no rows', async () => {
    serve({})
    const { api, wrapper } = harness()
    render(<CorrPanel sym="AAA" with0="BBB" />, { wrapper })
    await screen.findByTestId('terminal-corr-error')
    expect(api.publishRows).toHaveBeenLastCalledWith([])
    expect(api.publish).toHaveBeenLastCalledWith(null)
  })
})
