// The four daily-prep blocks (Notebook P2b, Task 10; spec §P2 item 6, R-P2b-6): wire and exposure,
// earnings for my names, my movers, key levels from my plans. Each is a frozen snapshot the member
// captures: "Capture now" reads the part once, setParams freezes it, and nothing is read on mount.
//
// CONTRACT: every snapshot here is the server's REAL answer (`__fixtures__/contract`, written by
// tools/notebook_contract_fixtures.py), or that answer with one field moved (a spread, never a
// retyped literal). The levels cards are the setups board's real cards. ⛔ Copy is asserted as
// RENDERED DOM text, never as state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PrepWireBlock from './PrepWireBlock'
import PrepEarningsBlock from './PrepEarningsBlock'
import PrepMoversBlock from './PrepMoversBlock'
import PrepLevelsBlock from './PrepLevelsBlock'
import { contractBody } from '../../../__fixtures__/contract'

const FAILED = "This couldn't be read just now. Nothing was changed."
const wire = () => contractBody('trader-blocks.prep.wire.held')
const earnings = () => contractBody('trader-blocks.prep.earnings.mine')
const movers = () => contractBody('trader-blocks.prep.movers.mine')
/** A levels snapshot from the real board's cards (the setups-board fixture), the part's own envelope. */
const levels = (n = 3, total = n) => ({
  ...contractBody('trader-blocks.prep.levels'),
  missing: null, detail: null, cards: contractBody('setups-board').cards.slice(0, n), total,
})

const reply = (body, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }))

beforeEach(() => { globalThis.fetch = vi.fn() })
afterEach(() => { vi.restoreAllMocks() })

describe('Capture now', () => {
  it('reads the part once and freezes it through setParams; never on mount', async () => {
    const snap = wire()
    globalThis.fetch = reply(snap)
    const setParams = vi.fn(() => true)
    render(<PrepWireBlock params={{}} setParams={setParams} editable />)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
    await waitFor(() => expect(setParams).toHaveBeenCalledWith({ snapshot: snap }))
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/j2/trader-blocks/prep/wire', expect.anything())
  })

  it('each block reads its OWN part', async () => {
    for (const [Block, part] of [[PrepEarningsBlock, 'earnings'], [PrepMoversBlock, 'movers'], [PrepLevelsBlock, 'levels']]) {
      globalThis.fetch = reply({ part })
      const { unmount } = render(<Block params={{}} setParams={vi.fn(() => true)} editable />)
      fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(`/api/j2/trader-blocks/prep/${part}`, expect.anything()))
      unmount()
    }
  })

  it('a read that fails says so in words, changes nothing, and can be tried again', async () => {
    globalThis.fetch = reply({ detail: 'Not found' }, false)
    const setParams = vi.fn(() => true)
    render(<PrepMoversBlock params={{}} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
    expect((await screen.findByRole('status')).textContent).toBe(FAILED)
    expect(setParams).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Capture now' }).disabled).toBe(false)
  })

  it('an answer that is not this part never lands in the note', async () => {
    globalThis.fetch = reply({ part: 'earnings', bmo: [] })
    const setParams = vi.fn(() => true)
    render(<PrepMoversBlock params={{}} setParams={setParams} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
    expect((await screen.findByRole('status')).textContent).toBe(FAILED)
    expect(setParams).not.toHaveBeenCalled()
  })

  it('a write the editor refused (setParams answers false) is said, not swallowed', async () => {
    globalThis.fetch = reply(wire())
    render(<PrepWireBlock params={{}} setParams={vi.fn(() => false)} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
    expect((await screen.findByRole('status')).textContent).toBe(FAILED)
  })

  it('CONTROL: a capture that lands shows no failure sentence', async () => {
    globalThis.fetch = reply(wire())
    render(<PrepWireBlock params={{}} setParams={vi.fn(() => true)} editable />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture now' }).disabled).toBe(false))
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('a frozen block', () => {
  it('says when it was captured (Eastern) and offers Capture again, which freezes a new snapshot', async () => {
    const fresh = { ...wire(), headline: 'A newer headline.' }
    globalThis.fetch = reply(fresh)
    const setParams = vi.fn(() => true)
    render(<PrepWireBlock params={{ snapshot: wire() }} setParams={setParams} editable />)
    // capturedAt is 2026-10-05T14:30:00Z: 10:30 in New York (EDT)
    expect(screen.getByText(/^Captured Oct 5, 2026, 10:30\sAM ET$/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Capture now' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Capture again' }))
    await waitFor(() => expect(setParams).toHaveBeenCalledWith({ snapshot: fresh }))
  })

  it('a reader sees the frozen snapshot and no button; an uncaptured block says so', () => {
    const { unmount } = render(<PrepWireBlock params={{ snapshot: wire() }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Chips led the drag and that is carrying over.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    unmount()
    render(<PrepWireBlock params={{}} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Not captured yet.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('an unreadable capture time is left out, never printed as "Invalid Date"', () => {
    render(<PrepWireBlock params={{ snapshot: { ...wire(), capturedAt: 'not a time' } }} setParams={vi.fn()} editable />)
    expect(screen.queryByText(/Captured/)).toBeNull()
    expect(screen.queryByText(/Invalid/)).toBeNull()
  })
})

describe('each gap is named', () => {
  it('a part with nothing to show says why, from the server', () => {
    const empty = contractBody('trader-blocks.prep.earnings')
    render(<PrepEarningsBlock params={{ snapshot: empty }} setParams={vi.fn()} editable />)
    expect(screen.getByText(empty.detail)).toBeTruthy()
    expect(screen.queryByText(/Before the open/)).toBeNull()
  })

  it('the wire with nothing published names its gap', () => {
    const empty = contractBody('trader-blocks.prep.wire')
    render(<PrepWireBlock params={{ snapshot: empty }} setParams={vi.fn()} editable />)
    expect(screen.getByText('The morning wire has not published yet today.')).toBeTruthy()
  })

  it('key levels with the setups board off says what it needs', () => {
    render(<PrepLevelsBlock params={{ snapshot: contractBody('trader-blocks.prep.levels.off') }} setParams={vi.fn()} editable />)
    expect(screen.getByText('This block needs the active setups board, which is not on for you.')).toBeTruthy()
  })
})

describe('wire and exposure', () => {
  it('shows the headline, "Exposure {score} ({regime word})" and the wire date', () => {
    render(<PrepWireBlock params={{ snapshot: wire() }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Chips led the drag and that is carrying over.')).toBeTruthy()
    expect(screen.getByText('Exposure 73 (Yellow)')).toBeTruthy()     // 72.5 rounds up; amber is the member's "Yellow"
    expect(screen.getByText('Wire of Oct 5, 2026')).toBeTruthy()
  })

  it('a missing regime drops the parenthesis; a missing score names the regime alone; neither is guessed', () => {
    const { unmount } = render(<PrepWireBlock params={{ snapshot: { ...wire(), regime: null } }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Exposure 73')).toBeTruthy()
    unmount()
    render(<PrepWireBlock params={{ snapshot: { ...wire(), exposure: null, exposureAsOf: null } }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Regime: Yellow')).toBeTruthy()
    expect(screen.queryByText(/Exposure/)).toBeNull()
  })

  it('a regime id the map does not own is not a word', () => {
    render(<PrepWireBlock params={{ snapshot: { ...wire(), regime: 'constructor' } }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Exposure 73')).toBeTruthy()
  })
})

describe('earnings for my names', () => {
  it('reads as sentences: before the open, after the close tonight, and last night', () => {
    render(<PrepEarningsBlock params={{ snapshot: earnings() }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Before the open: NVDA')).toBeTruthy()
    expect(screen.getByText('After the close: TSLA')).toBeTruthy()
    expect(screen.getByText('Reported last night after the close: AMD')).toBeTruthy()
    expect(screen.queryByText(/None of your names/)).toBeNull()
  })

  it('lists several names comma-separated', () => {
    render(<PrepEarningsBlock params={{ snapshot: { ...earnings(), bmo: ['NVDA', 'AMD'] } }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Before the open: NVDA, AMD')).toBeTruthy()
  })

  it('none reporting today says so, and a name that reported last night does not count as today', () => {
    render(<PrepEarningsBlock params={{ snapshot: { ...earnings(), bmo: [], amcTonight: [] } }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('None of your names report today.')).toBeTruthy()
    expect(screen.getByText('Reported last night after the close: AMD')).toBeTruthy()
    expect(screen.queryByText(/^Before the open/)).toBeNull()
    expect(screen.queryByText(/^After the close/)).toBeNull()
  })

  it('an older frozen snapshot with no amcTonight key still reads', () => {
    const { amcTonight, ...older } = earnings()   // eslint-disable-line no-unused-vars
    render(<PrepEarningsBlock params={{ snapshot: older }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Before the open: NVDA')).toBeTruthy()
    expect(screen.queryByText(/^After the close/)).toBeNull()
  })
})

describe('my movers', () => {
  it('lists each move as "SYM ±x.x% at price", the unavailable change in words, and the unquoted count', () => {
    render(<PrepMoversBlock params={{ snapshot: movers() }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('AMD −4.2% at 160.25')).toBeTruthy()
    expect(screen.getByText('NVDA +3.1% at 182.50')).toBeTruthy()
    expect(screen.getByText('MSFT at 412.50 (change unavailable)')).toBeTruthy()   // null, never 0.0%
    expect(screen.getByText('1 of your names had no quote.')).toBeTruthy()
  })

  it('a bounded scan is said under the list: "Among 200 of your 1340 names."', () => {
    render(<PrepMoversBlock params={{ snapshot: { ...movers(), scanned: 200, total: 1340 } }} setParams={vi.fn()} editable={false} />)
    const note = screen.getByText('Among 200 of your 1340 names.')
    const list = screen.getByRole('list')
    expect(list.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('CONTROL: a full scan (scanned === total) says nothing about a bound', () => {
    expect(movers().scanned).toBe(movers().total)
    render(<PrepMoversBlock params={{ snapshot: movers() }} setParams={vi.fn()} editable={false} />)
    expect(screen.queryByText(/^Among /)).toBeNull()
  })

  it('CONTROL: an older frozen snapshot without scanned and total says nothing either', () => {
    const { scanned, total, ...older } = movers()   // eslint-disable-line no-unused-vars
    render(<PrepMoversBlock params={{ snapshot: older }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('AMD −4.2% at 160.25')).toBeTruthy()
    expect(screen.queryByText(/^Among /)).toBeNull()
  })

  it('no unquoted line when every name had a quote', () => {
    render(<PrepMoversBlock params={{ snapshot: { ...movers(), unquoted: 0 } }} setParams={vi.fn()} editable={false} />)
    expect(screen.queryByText(/had no quote/)).toBeNull()
  })

  it('the unquoted count is printed as the snapshot gives it', () => {
    render(<PrepMoversBlock params={{ snapshot: { ...movers(), unquoted: 2 } }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('2 of your names had no quote.')).toBeTruthy()
  })
})

describe('key levels from my plans', () => {
  const lines = (snap) => {
    render(<PrepLevelsBlock params={{ snapshot: snap }} setParams={vi.fn()} editable={false} />)
    return screen.getAllByRole('listitem').map((li) => li.textContent)
  }

  it('one line per card, the WHOLE line: symbol, where it stands, the distance, the levels the plan drew', () => {
    // the setups board's real cards: SBAM waiting, SBTR triggered, SBTS short waiting, SBNV tagged and with a target,
    // SBME watching with no stop, SBIN through the stop, SBNP with no price
    expect(lines(levels(7))).toEqual([
      'SBAM · Waiting · 0.67% to the entry · 0.10R · Entry $150.00 · Stop $140.00',
      'SBTR · Triggered · 0.94% through the entry · 0.20R · Entry $105.00 · Stop $100.00',
      'SBTS · Waiting · 2.44% to the entry · 0.50R · Entry $200.00 · Stop $210.00',
      'SBNV · Breakout · Waiting · 2.94% to the entry · 0.60R · Entry $105.00 · Stop $100.00 · Target $120.00',
      'SBME · Watching · 7.69% to the entry · Entry $700.00',
      'SBIN · Through the stop · 5.00% from the entry · 1.00R · Entry $105.00 · Stop $100.00',
      'SBNP · No price yet · Entry $20.00 · Stop $18.00',
    ])
  })

  it('the setup the plan was tagged with leads the line; CONTROL: a card without one has no gap or placeholder', () => {
    const tagged = levels(4).cards[3]
    expect(tagged.setupTag).toBe('Breakout')
    const untagged = levels(1).cards[0]
    expect(untagged.setupTag).toBeNull()
    expect(lines({ ...levels(1), cards: [{ ...untagged, setupTag: 'VCP' }] })[0]).toMatch(/^SBAM · VCP · Waiting · /)
  })

  it('a card without a tag reads exactly as it did (no "null", no empty segment)', () => {
    const [line] = lines(levels(1))
    expect(line).toBe('SBAM · Waiting · 0.67% to the entry · 0.10R · Entry $150.00 · Stop $140.00')
    expect(line).not.toMatch(/null|undefined|· ·/)
  })

  it('a page shorter than the member total says so; CONTROL: a whole board does not', () => {
    const { unmount } = render(<PrepLevelsBlock params={{ snapshot: levels(3, 5) }} setParams={vi.fn()} editable={false} />)
    expect(screen.getByText('Showing 3 of your 5 setups.')).toBeTruthy()
    unmount()
    render(<PrepLevelsBlock params={{ snapshot: levels(3, 3) }} setParams={vi.fn()} editable={false} />)
    expect(screen.queryByText(/^Showing/)).toBeNull()
  })
})
