import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
vi.mock('./PreEntryChecklistBlock', () => ({ default: () => { throw new Error('boom') } }))
vi.mock('./PriceStampsBlock', () => ({
  default: ({ params }) => <button type="button" aria-label="Stamp prices as I write">stamps {params.on}</button>,
}))

import BlockNodeView from './BlockNodeView'
import { BLOCK_ERROR_SENTENCE } from './blockStates'

const node = (widgetId, params = {}) => ({ attrs: { widgetId, params, searchText: '[x]' } })
const editor = (extra = {}) => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1', ...extra } } })

describe('BlockNodeView', () => {
  it('renders the block body with its params, labelled by the block name', async () => {
    render(<BlockNodeView node={node('priceStamps', { on: 'yes' })} editor={editor()} updateAttributes={() => {}} />)
    expect(await screen.findByText('stamps yes')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Price stamps' })).toBeTruthy()
  })
  it('a body that throws shows the error state and never blanks the note', async () => {
    render(<BlockNodeView node={node('preEntryChecklist')} editor={editor()} updateAttributes={() => {}} />)
    expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Pre-entry checklist' })).toBeTruthy()
  })
  it('on a public share page it renders the block line only (nothing auth-scoped mounts)', () => {
    render(<BlockNodeView node={node('priceStamps', { on: 'yes' })} editor={editor({ shareView: true })} updateAttributes={() => {}} />)
    expect(screen.getByText('[x]')).toBeTruthy()
    expect(screen.queryByText('stamps yes')).toBeNull()
  })
  it('keyboard path (S23): Tab reaches the block\'s first control, the Remove button, and leaves it again', async () => {
    const deleteNode = vi.fn()
    render(<>
      <button type="button">before</button>
      <BlockNodeView node={node('priceStamps', { on: 'yes' })} editor={editor()} updateAttributes={() => {}} deleteNode={deleteNode} />
      <button type="button">after</button>
    </>)
    await screen.findByText('stamps yes')
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'before' }).focus()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Price stamps' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stamp prices as I write' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }))   // and out again
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    await user.keyboard('{Enter}')                                                       // Enter on Remove
    expect(deleteNode).toHaveBeenCalledTimes(1)
  })
})
