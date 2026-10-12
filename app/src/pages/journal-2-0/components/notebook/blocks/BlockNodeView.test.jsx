import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@tiptap/react', () => ({ NodeViewWrapper: ({ children, ...p }) => <div {...p}>{children}</div> }))
vi.mock('./PreEntryChecklistBlock', () => ({ default: () => { throw new Error('boom') } }))
vi.mock('./PriceStampsBlock', () => ({
  default: ({ params }) => <button type="button" aria-label="Stamp prices as I write">stamps {params.on}</button>,
}))
// I-1 (fix round 1): the FIRST load of this body's chunk rejects, the second resolves.
const sizingChunk = vi.hoisted(() => ({ loads: 0 }))
vi.mock('./PositionSizingBlock', () => {
  sizingChunk.loads += 1
  if (sizingChunk.loads === 1) throw new Error('the chunk failed to load')
  return { default: () => <p>sizing body</p> }
})

import BlockNodeView, { BLOCK_COMPONENTS } from './BlockNodeView'
import { BLOCK_ERROR_SENTENCE } from './blockStates'

const node = (widgetId, params = {}) => ({ attrs: { widgetId, params, searchText: '[x]' } })
const editor = (extra = {}) => ({ isEditable: true, storage: { uctJournalWidgets: { noteId: 'n1', ...extra } } })

// R-T6-3: a stale chunk after a deploy. The message is the one the app's chunk-error predicate
// recognises (utils/lazyWithRetry); it names no URL, so lazyChunk's in-place retry asks the SAME
// importer once more inside each attempt -- every attempt therefore calls the importer twice.
const chunkError = () => new Error('Failed to fetch dynamically imported module')
const SizingBody = () => <p>sizing body</p>

/** Run `body` with the positionSizing importer replaced by `importer`, restoring it after. */
async function withImporter(importer, body) {
  const real = BLOCK_COMPONENTS.positionSizing
  BLOCK_COMPONENTS.positionSizing = importer
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try { await body() } finally { BLOCK_COMPONENTS.positionSizing = real; spy.mockRestore() }
}
const tryAgain = () => userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))

describe('BlockNodeView — escalation to Reload (R-T6-3)', () => {
  it('chunk fail, then the retry fails with a chunk error again: Reload is offered, and it reloads the page', async () => {
    const importer = vi.fn(() => Promise.reject(chunkError()))
    await withImporter(importer, async () => {
      render(<BlockNodeView node={node('positionSizing')} editor={editor()} updateAttributes={() => {}} />)
      expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
      expect(screen.queryByRole('button', { name: /^Reload/ })).toBeNull()        // the first failure: Try again only
      await tryAgain()
      const reload = await screen.findByRole('button', { name: 'Reload to see Position sizing' }, { timeout: 3000 })
      expect(reload.textContent).toBe('Reload')
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
      expect(importer.mock.calls.length).toBeGreaterThanOrEqual(2)               // the retry really asked again
      const realLocation = window.location
      const reloadPage = vi.fn()
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...realLocation, reload: reloadPage } })
      try {
        await userEvent.setup().click(reload)
        expect(reloadPage).toHaveBeenCalledTimes(1)
      } finally {
        Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation })
      }
    })
  })

  it('chunk fail, then the retry succeeds: the body renders and no Reload appears', async () => {
    let calls = 0
    const importer = vi.fn(() => (++calls <= 2 ? Promise.reject(chunkError()) : Promise.resolve({ default: SizingBody })))
    await withImporter(importer, async () => {
      render(<BlockNodeView node={node('positionSizing')} editor={editor()} updateAttributes={() => {}} />)
      expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
      await tryAgain()
      expect(await screen.findByText('sizing body')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /^Reload/ })).toBeNull()
      expect(screen.queryByText(BLOCK_ERROR_SENTENCE)).toBeNull()
    })
  })

  it('N-5: offline (navigator.onLine === false) a repeated chunk failure keeps "Try again", never Reload', async () => {
    const importer = vi.fn(() => Promise.reject(chunkError()))
    const desc = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
    try {
      await withImporter(importer, async () => {
        render(<BlockNodeView node={node('positionSizing')} editor={editor()} updateAttributes={() => {}} />)
        expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
        await tryAgain()
        await vi.waitFor(() => expect(importer.mock.calls.length).toBeGreaterThanOrEqual(4), { timeout: 3000 })  // the retry ran and failed
        expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: /^Reload/ })).toBeNull()
      })
    } finally {
      if (desc) Object.defineProperty(window.navigator, 'onLine', desc)
      else delete window.navigator.onLine
    }
  })

  it('N-5: a body that LOADED resets the escalation: a much later chunk error starts at "Try again" again', async () => {
    let calls = 0
    const Body = ({ params }) => { if (params.boom) throw chunkError(); return <p>sizing body</p> }
    const importer = vi.fn(() => (++calls <= 2 ? Promise.reject(chunkError()) : Promise.resolve({ default: Body })))
    await withImporter(importer, async () => {
      const { rerender } = render(<BlockNodeView node={node('positionSizing')} editor={editor()} updateAttributes={() => {}} />)
      expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
      await tryAgain()
      expect(await screen.findByText('sizing body')).toBeTruthy()                  // the retry loaded the body
      // later: something inside the loaded body fails to load (a nested chunk, say)
      rerender(<BlockNodeView node={node('positionSizing', { boom: true })} editor={editor()} updateAttributes={() => {}} />)
      expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /^Reload/ })).toBeNull()
    })
  })

  it('a render (non-chunk) error keeps "Try again" only, even after a retry fails again', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: () => { throw new Error('a bug in the body') } }))
    await withImporter(importer, async () => {
      render(<BlockNodeView node={node('positionSizing')} editor={editor()} updateAttributes={() => {}} />)
      expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
      await tryAgain()
      expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
      expect(screen.getByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
      expect(screen.queryByRole('button', { name: /^Reload/ })).toBeNull()
      expect(importer).toHaveBeenCalledTimes(2)                                    // non-vacuity: a retry happened
    })
  })
})

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
  it('I-1: after a failed chunk, "Try again" loads the body for real (a failed lazy is not reused)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<BlockNodeView node={node('positionSizing')} editor={editor()} updateAttributes={() => {}} />)
      expect(await screen.findByText(BLOCK_ERROR_SENTENCE)).toBeTruthy()
      expect(sizingChunk.loads).toBe(1)
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByText('sizing body')).toBeTruthy()
      expect(screen.queryByText(BLOCK_ERROR_SENTENCE)).toBeNull()
      expect(sizingChunk.loads).toBe(2)                     // the retry asked for the chunk again
    } finally {
      spy.mockRestore()
    }
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
