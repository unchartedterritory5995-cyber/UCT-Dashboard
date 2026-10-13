// app/src/pages/journal-2-0/a11y/traderBlockPrep.a11y.test.jsx
//
// Notebook P2b, Task 10: the four daily prep blocks (and their shared PrepCapture frame) through 8A's axe
// harness. One recipe renders every member-visible shape, each proved on screen BEFORE axe runs so an
// empty render cannot pass as a clean one:
//   · frozen snapshots with their lists: wire, earnings, movers (with the bounded-scan line), key levels
//     (with the page-shorter-than-total line);
//   · a gap (the server's `detail` sentence) and a switch the block needs (BlockNeedsSwitch);
//   · an uncaptured block, a reader's "Not captured yet.", and the failed capture's role="status" line.
// Every snapshot is the server's REAL answer (`__fixtures__/contract`).
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, expect, afterEach } from 'vitest'
import { axeSurface } from './surface'
import PrepWireBlock from '../components/notebook/blocks/PrepWireBlock'
import PrepEarningsBlock from '../components/notebook/blocks/PrepEarningsBlock'
import PrepMoversBlock from '../components/notebook/blocks/PrepMoversBlock'
import PrepLevelsBlock from '../components/notebook/blocks/PrepLevelsBlock'
import { contractBody } from '../__fixtures__/contract'

afterEach(() => vi.unstubAllGlobals())

const noop = () => true
const levelsSnapshot = {
  ...contractBody('trader-blocks.prep.levels'),
  missing: null, detail: null, cards: contractBody('setups-board').cards.slice(0, 4), total: 6,
}

axeSurface('trader-block-prep', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
  render(<div>
    <section aria-label="wire"><PrepWireBlock params={{ snapshot: contractBody('trader-blocks.prep.wire.held') }} setParams={noop} editable /></section>
    <section aria-label="earnings"><PrepEarningsBlock params={{ snapshot: contractBody('trader-blocks.prep.earnings.mine') }} setParams={noop} editable /></section>
    <section aria-label="movers"><PrepMoversBlock params={{ snapshot: { ...contractBody('trader-blocks.prep.movers.mine'), scanned: 200, total: 1340 } }} setParams={noop} editable /></section>
    <section aria-label="levels"><PrepLevelsBlock params={{ snapshot: levelsSnapshot }} setParams={noop} editable /></section>
    <section aria-label="gap"><PrepWireBlock params={{ snapshot: contractBody('trader-blocks.prep.wire') }} setParams={noop} editable /></section>
    <section aria-label="needs"><PrepLevelsBlock params={{ snapshot: contractBody('trader-blocks.prep.levels.off') }} setParams={noop} editable /></section>
    <section aria-label="uncaptured"><PrepMoversBlock params={{}} setParams={noop} editable /></section>
    <section aria-label="reader"><PrepEarningsBlock params={{}} setParams={noop} editable={false} /></section>
  </div>)
  const area = (name) => within(screen.getByRole('region', { name }))

  // frozen snapshots and their lists
  expect(area('wire').getByText('Exposure 73 (Yellow)')).toBeTruthy()
  expect(area('wire').getByText(/^Captured Oct 5, 2026, 10:30\sAM ET$/)).toBeTruthy()
  expect(area('wire').getByRole('button', { name: 'Capture again' })).toBeTruthy()
  expect(area('earnings').getByRole('list', { name: 'Earnings for your names' }).querySelectorAll('li')).toHaveLength(3)
  expect(area('movers').getByRole('list', { name: 'Moves among your names' }).querySelectorAll('li')).toHaveLength(3)
  expect(area('movers').getByText('Among 200 of your 1340 names.')).toBeTruthy()
  expect(area('levels').getByRole('list', { name: 'Setups on your board' }).querySelectorAll('li')).toHaveLength(4)
  expect(area('levels').getByText('Showing 4 of your 6 setups.')).toBeTruthy()
  // a gap, a switch the block needs
  expect(area('gap').getByText('The morning wire has not published yet today.')).toBeTruthy()
  expect(area('needs').getByRole('status').textContent).toBe('This block needs the active setups board, which is not on for you.')
  // uncaptured, and a reader's view
  expect(area('uncaptured').getByRole('button', { name: 'Capture now' })).toBeTruthy()
  expect(area('reader').getByText('Not captured yet.')).toBeTruthy()
  expect(area('reader').queryByRole('button')).toBeNull()
  // the failed capture says so in a status line (the stubbed read answers 500)
  fireEvent.click(area('uncaptured').getByRole('button', { name: 'Capture now' }))
  expect((await area('uncaptured').findByRole('status')).textContent).toBe("This couldn't be read just now. Nothing was changed.")
})
