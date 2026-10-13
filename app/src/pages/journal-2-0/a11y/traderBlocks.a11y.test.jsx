// app/src/pages/journal-2-0/a11y/traderBlocks.a11y.test.jsx
//
// Notebook P2a: the trader block platform through 8A's axe harness. One recipe renders BlockNodeView
// with each of the three block ids (their REAL bodies since M2; each body's own states have a recipe in
// this file's siblings); a second renders the REAL BlockNodeView with one body that throws,
// so the whole composition (the named group, its Remove button, then the error state with "Try again")
// is audited -- not a hand-built frame. An empty screen cannot pass as a clean one in either.
import { render, screen, within } from '@testing-library/react'
import { vi, expect, afterEach } from 'vitest'
import { axeSurface } from './surface'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
// Task 11's real body reads settings, accounts and the regime (its own recipe is
// traderBlockSizing.a11y.test.jsx); Task 7's checklist reads settings, the selected account and rules
// (its own states are audited in traderBlockChecklist.a11y.test.jsx). One member, account a1, no setups.
vi.mock('../hooks/useJ2Settings', () => ({ default: () => ({ settings: { accountSize: 50000, setups: [], setupRules: {} }, accountId: 'a1', accountName: 'Main' }) }))
vi.mock('../hooks/useJ2Accounts', () => ({ default: () => ({ accounts: [{ id: 'a1', name: 'Main' }], isLoading: false }) }))
vi.mock('../hooks/useJ2CurrentRegime', () => ({ default: () => ({ regime: { regime: 'green', asOf: '2026-10-13' } }) }))
vi.mock('../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', accounts: [{ id: 'a1', name: 'Main' }] }) }))
vi.mock('../hooks/useJournalRules', () => ({ default: () => ({ rules: [] }) }))
import userEvent from '@testing-library/user-event'
import BlockNodeView, { BLOCK_COMPONENTS } from '../components/notebook/blocks/BlockNodeView'
import { BLOCK_ERROR_SENTENCE } from '../components/notebook/blocks/blockStates'
import { contractBody } from '../__fixtures__/contract'

// A failed assertion in the recipe must not leave the stubbed fetch behind for the next recipe.
afterEach(() => vi.unstubAllGlobals())

const editor = { isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1' } } }
const node = (widgetId, params = {}) => ({ attrs: { widgetId, params, searchText: `[${widgetId}]` } })

// P2b: part b's bodies are stubs until their own tasks. Task 10 flipped the four prep blocks and Task 11
// the review block, so each of those has a real expectation below instead of the stub sentence.
const PART_B = ['My rules']
const PREP_BLOCKS = ['Morning wire and exposure', 'Earnings for my names', 'My movers', 'Key levels from my plans']

axeSurface('trader-block-platform', async () => {
  // The review block, with no trade picked, reads the member's closed trades (the REAL server answer).
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => contractBody('trader-blocks.review.trades') })))
  render(<div>
    {['preEntryChecklist', 'priceStamps', 'positionSizing',
      'myRules', 'prepWire', 'prepEarnings', 'prepMovers', 'prepLevels', 'tradeReview'].map((id) => (
      <BlockNodeView key={id} node={node(id)} editor={editor} updateAttributes={() => {}} deleteNode={() => {}} />
    ))}
  </div>)
  for (const name of ['Pre-entry checklist', 'Price stamps', 'Position sizing', ...PART_B]) {
    expect(await screen.findByRole('group', { name })).toBeTruthy()
    expect(screen.getByRole('button', { name: `Remove ${name}` })).toBeTruthy()
  }
  // Every body painted (an unloaded chunk would read as a clean, empty block), each inside its OWN
  // named group. Each body is its own lazy chunk behind its own Suspense, so they commit at different
  // ticks: wait PER GROUP for that body's own control or sentence. (A findAll resolves on the FIRST
  // match, so a count read from it is a sample; R-T7-2 I-1 reproduced that red with one chunk 300 ms late.)
  // M2: Tasks 7, 10 and 11 replaced every stub, so no body may still say the stub sentence.
  const group = (name) => within(screen.getByRole('group', { name }))
  expect(await group('Pre-entry checklist').findByText(/You have no setups yet/)).toBeTruthy()
  expect(await group('Price stamps').findByRole('switch', { name: 'Stamp prices as I write' })).toBeTruthy()
  expect(await group('Position sizing').findByRole('spinbutton', { name: 'Entry' })).toBeTruthy()
  for (const name of ['Pre-entry checklist', 'Price stamps', 'Position sizing']) {
    expect(group(name).queryByText('This block is being built.')).toBeNull()
  }
  // P2b Task 2: part b's stubs each paint until their body task replaces them (Task 8: My rules).
  for (const name of PART_B) expect(await group(name).findByText('This block is being built.')).toBeTruthy()
  // P2b Task 10: an uncaptured prep block offers "Capture now" and has read nothing (never on mount).
  for (const name of PREP_BLOCKS) {
    expect(await group(name).findByRole('button', { name: 'Capture now' })).toBeTruthy()
    expect(group(name).queryByText('This block is being built.')).toBeNull()
  }
  // P2b Task 11: the review block, with no trade picked, lists the closed trades to pick from.
  expect(await group('Post-trade review').findByRole('combobox', { name: 'Trade to review' })).toBeTruthy()
  expect(group('Post-trade review').queryByText('This block is being built.')).toBeNull()
})

axeSurface('trader-block-platform:error', async () => {
  // The same pattern as WidgetEmbedView.unknownKind's chunk-fail case: a fresh BlockNodeView imported
  // AFTER the body module is mocked to throw at render.
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.resetModules()
  vi.doMock('../components/notebook/blocks/PriceStampsBlock', () => ({
    default: () => { throw new Error('a body that fails') },
  }))
  try {
    const { default: FreshBlockNodeView } = await import('../components/notebook/blocks/BlockNodeView')
    const { BLOCK_ERROR_SENTENCE: sentence } = await import('../components/notebook/blocks/blockStates')
    expect(sentence).toBe(BLOCK_ERROR_SENTENCE)
    render(<FreshBlockNodeView node={node('priceStamps')} editor={editor} updateAttributes={() => {}} deleteNode={() => {}} />)
    const group = await screen.findByRole('group', { name: 'Price stamps' })
    expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
    expect(group.contains(screen.getByText(BLOCK_ERROR_SENTENCE))).toBe(true)     // inside the block's own frame
    expect(screen.getByRole('button', { name: 'Remove Price stamps' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  } finally {
    vi.doUnmock('../components/notebook/blocks/PriceStampsBlock')
    vi.resetModules()
    spy.mockRestore()
  }
})

axeSurface('trader-block-platform:reload', async () => {
  // R-T6-3: a stale chunk after a deploy. The first failure offers "Try again"; the retry fails the
  // same way, so the REAL BlockNodeView escalates to "Reload". Audited in that state.
  const real = BLOCK_COMPONENTS.priceStamps
  BLOCK_COMPONENTS.priceStamps = () => Promise.reject(new Error('Failed to fetch dynamically imported module'))
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    render(<BlockNodeView node={node('priceStamps')} editor={editor} updateAttributes={() => {}} deleteNode={() => {}} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }, { timeout: 3000 }))
    const reload = await screen.findByRole('button', { name: 'Reload to see Price stamps' }, { timeout: 3000 })
    expect(reload.textContent).toBe('Reload')
    expect(screen.getByRole('group', { name: 'Price stamps' }).contains(reload)).toBe(true)
    expect(screen.getByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  } finally {
    BLOCK_COMPONENTS.priceStamps = real
    spy.mockRestore()
  }
})
