// app/src/pages/journal-2-0/a11y/traderBlocks.a11y.test.jsx
//
// Notebook P2a: the trader block platform through 8A's axe harness. One recipe renders BlockNodeView
// with each of the three block ids (the stub bodies until Tasks 7, 10 and 11 replace them, each with its
// own recipe in this file's siblings), plus the error state, so an empty screen cannot pass as a clean one.
import { render, screen } from '@testing-library/react'
import { vi, expect } from 'vitest'
import { axeSurface } from './surface'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
import BlockNodeView, { BlockBoundary } from '../components/notebook/blocks/BlockNodeView'
import { BLOCK_ERROR_SENTENCE } from '../components/notebook/blocks/blockStates'

const editor = { isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1' } } }
const node = (widgetId, params = {}) => ({ attrs: { widgetId, params, searchText: `[${widgetId}]` } })

function Throws() { throw new Error('a body that fails') }

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
  // The error state the platform shows when a body throws: rendered through the real boundary.
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    render(<div role="group" aria-label="Price stamps"><BlockBoundary><Throws /></BlockBoundary></div>)
    expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  } finally {
    spy.mockRestore()
  }
})
