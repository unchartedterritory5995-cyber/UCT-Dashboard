// TERM-033 -- the two scan-results widgets (Scanner presets and Custom-Period Sort), reachable in
// the terminal as tabs on the Breadth drill board. Their fetchers used to resolve a failed read
// to `null`, and both tables read `!data` as "Loading…": a load that never finished. They now
// say the read failed and point at the footer's Refresh. `Watchlists` is only the host here
// (mocked, as in ScannerResults.journalDoor.test.jsx -- the real one OOMs a worker); the
// assertion is on the `scanEmptyText` each widget hands it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const swr = vi.fn()
vi.mock('../../../hooks/useMobileSWR', () => ({ default: (...a) => swr(...a) }))
let hostProps = null
vi.mock('../../Watchlists', () => ({ default: (props) => { hostProps = props; return null } }))
vi.mock('../WorkspaceContext', () => ({ useWorkspace: () => ({ setGroupSym: () => {}, groupSyms: {} }) }))
vi.mock('../../../utils/prefetchBars', () => ({ prefetchListDeep: () => {} }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../journal-2-0/lib/useJournalToast', () => ({ useJournalToast: () => [null, () => {}], JournalToast: () => null }))
vi.mock('../../journal-2-0/components/CaptureMenu', () => ({ default: () => null }))
vi.mock('../../journal-2-0/lib/sendToJournal', () => ({ sendCaptureToJournal: () => {} }))
vi.mock('../useListSubscribeEnabled', () => ({ default: () => false }))

import ScannerResults from './ScannerResults'
import PeriodSortResults from './PeriodSortResults'

const FAILED = { data: undefined, error: new Error('Request failed (502)'), mutate: () => {}, isValidating: false }
const LOADING = { data: undefined, error: undefined, mutate: () => {}, isValidating: true }

beforeEach(() => { swr.mockReset(); hostProps = null })

describe.each([
  { name: 'ScannerResults', el: () => <ScannerResults scanKey="highest-volume-1y" scanName="Volume" color="A" /> },
  { name: 'PeriodSortResults', el: () => <PeriodSortResults start="20260101" end="20260301" color="A" /> },
])('$name (TERM-033)', ({ el }) => {
  it('a failed read says so and points at Refresh -- not "Loading…"', () => {
    swr.mockReturnValue(FAILED)
    render(el())
    expect(hostProps.scanEmptyText).toMatch(/could not be loaded/i)
    expect(hostProps.scanEmptyText).toMatch(/refresh/i)
  })

  it('control: still loading with no error reads as loading', () => {
    swr.mockReturnValue(LOADING)
    render(el())
    expect(hostProps.scanEmptyText).toBe('Loading…')
  })
})
