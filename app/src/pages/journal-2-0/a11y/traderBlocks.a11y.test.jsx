// app/src/pages/journal-2-0/a11y/traderBlocks.a11y.test.jsx
//
// Notebook P2a: the trader block platform through 8A's axe harness. One recipe renders BlockNodeView
// with each of the three block ids (the stub bodies until Tasks 7, 10 and 11 replace them, each with its
// own recipe in this file's siblings); a second renders the REAL BlockNodeView with one body that throws,
// so the whole composition (the named group, its Remove button, then the error state with "Try again")
// is audited -- not a hand-built frame. An empty screen cannot pass as a clean one in either.
import { render, screen } from '@testing-library/react'
import { vi, expect } from 'vitest'
import { axeSurface } from './surface'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
import userEvent from '@testing-library/user-event'
import BlockNodeView, { BLOCK_COMPONENTS } from '../components/notebook/blocks/BlockNodeView'
import { BLOCK_ERROR_SENTENCE } from '../components/notebook/blocks/blockStates'

const editor = { isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1' } } }
const node = (widgetId, params = {}) => ({ attrs: { widgetId, params, searchText: `[${widgetId}]` } })

axeSurface('trader-block-platform', async () => {
  render(<div>
    {['preEntryChecklist', 'priceStamps', 'positionSizing'].map((id) => (
      <BlockNodeView key={id} node={node(id)} editor={editor} updateAttributes={() => {}} deleteNode={() => {}} />
    ))}
  </div>)
  for (const name of ['Pre-entry checklist', 'Price stamps', 'Position sizing']) {
    expect(await screen.findByRole('group', { name })).toBeTruthy()
    expect(screen.getByRole('button', { name: `Remove ${name}` })).toBeTruthy()
  }
  // every stub body painted (an unloaded chunk would read as a clean, empty block)
  expect(await screen.findAllByText('This block is being built.')).toHaveLength(3)
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
