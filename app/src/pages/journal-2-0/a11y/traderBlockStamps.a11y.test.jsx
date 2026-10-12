// app/src/pages/journal-2-0/a11y/traderBlockStamps.a11y.test.jsx
//
// Notebook P2a Task 10: the price stamps block through 8A's axe harness, in the REAL BlockNodeView frame
// (its named group and Remove button), in both states a member can meet: the journal styles switch on
// (the named switch and the sentence saying how it works) and off (the switch disabled, the sentence
// saying what it needs). Each recipe asserts what painted before axe runs, so an empty screen cannot
// pass as a clean one.
import { render, screen } from '@testing-library/react'
import { vi, expect } from 'vitest'
import { axeSurface } from './surface'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
let STYLES_ON = true
vi.mock('../lib/journalStylesFlag', async (orig) => ({ ...(await orig()), journalStylesEnabled: () => STYLES_ON }))
import BlockNodeView from '../components/notebook/blocks/BlockNodeView'

const editor = { isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1' } } }
const node = { attrs: { widgetId: 'priceStamps', params: { on: 'yes' }, searchText: '[priceStamps]' } }

axeSurface('trader-block-stamps', async () => {
  STYLES_ON = true
  render(<BlockNodeView node={node} editor={editor} updateAttributes={() => {}} deleteNode={() => {}} />)
  const sw = await screen.findByRole('switch', { name: 'Stamp prices as I write' })
  expect(sw.getAttribute('aria-checked')).toBe('true')
  expect(sw.disabled).toBe(false)
  expect(screen.getByText(/Write \$NVDA and press Enter/)).toBeTruthy()
  expect(screen.getByRole('group', { name: 'Price stamps' }).contains(sw)).toBe(true)
})

axeSurface('trader-block-stamps:off', async () => {
  STYLES_ON = false
  try {
    render(<BlockNodeView node={node} editor={editor} updateAttributes={() => {}} deleteNode={() => {}} />)
    const sw = await screen.findByRole('switch', { name: 'Stamp prices as I write' })
    expect(sw.disabled).toBe(true)
    expect(screen.getByText('This block needs Journal styles, which is not on for you.')).toBeTruthy()
  } finally {
    STYLES_ON = true
  }
})
