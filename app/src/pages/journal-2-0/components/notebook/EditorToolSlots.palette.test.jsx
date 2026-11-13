// Follow-up B fix round 1, item 5: the Insert palette is held (EditorToolSlots.jsx `WidgetPaletteSlot`), not
// `lazyChunk` + Suspense, whose reveal is held back about 300 ms even with the chunk in hand, long enough for a ticker
// typed straight after pressing Insert to land in the note. With the chunk in hand the palette mounts and takes focus in
// the press's own act; on a cold press a frame takes focus at once and becomes the palette when it lands; a failed load
// says so with a Reload the member presses; the editor mounts the slot (never the lazy wrapper).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect, useRef, useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  INSERT_LOADING, INSERT_UNAVAILABLE, WidgetPaletteSlot, widgetPaletteLoaders, widgetPaletteModule,
} from './EditorToolSlots'
import { RELOAD_TO_RECOVER, pageReload } from '../../lib/heldModule'

// Stands in for WidgetPalette: a dialog whose ticker field takes focus when it mounts.
function StubPalette() {
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  return <div role="dialog" aria-label="Insert widget" data-stub-palette=""><input ref={ref} aria-label="Ticker" /></div>
}
const STUB = { default: StubPalette }
const REAL = { ...widgetPaletteLoaders }

function Editor() {
  const [open, setOpen] = useState(false)
  const opener = useRef(null)
  return (
    <div>
      <div contentEditable suppressContentEditableWarning data-testid="note-body">note</div>
      <button ref={opener} type="button" onClick={() => setOpen((o) => !o)}>Insert</button>
      {open && <WidgetPaletteSlot editor={{}} onClose={() => setOpen(false)} returnFocusTo={opener} via="palette" />}
    </div>
  )
}
const press = () => act(() => { fireEvent.click(screen.getByRole('button', { name: 'Insert' })) })

beforeEach(() => { widgetPaletteModule.resetForTests() })
afterEach(() => {
  cleanup()
  Object.assign(widgetPaletteLoaders, REAL)
  widgetPaletteModule.resetForTests()
  vi.restoreAllMocks()
})

describe('the Insert palette slot', () => {
  it('with the chunk in hand, the press mounts the palette and its field has focus in the same act', async () => {
    widgetPaletteLoaders.palette = () => Promise.resolve(STUB)
    await act(async () => { await widgetPaletteModule.warm() })
    render(<Editor />)
    press()
    expect(document.querySelector('[data-stub-palette]')).not.toBeNull()
    expect(document.querySelector('[data-palette-stand-in]')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Ticker' }))
  })

  it('a cold press draws a frame that takes focus at once (nothing typed reaches the note), then the palette', async () => {
    let resolve
    widgetPaletteLoaders.palette = () => new Promise((r) => { resolve = r })
    render(<Editor />)
    press()
    const frame = document.querySelector('[data-palette-stand-in]')
    expect(frame).not.toBeNull()
    expect(frame.contains(document.activeElement)).toBe(true)
    expect(screen.getByTestId('note-body').contains(document.activeElement)).toBe(false)
    expect(screen.getByRole('status').textContent).toBe(INSERT_LOADING)
    await act(async () => { await Promise.resolve() })            // the loader is asked on the next tick
    await act(async () => { resolve(STUB) })
    expect(document.querySelector('[data-palette-stand-in]')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Ticker' }))
  })

  it('Escape in the frame closes it and hands focus back to Insert', () => {
    widgetPaletteLoaders.palette = () => new Promise(() => {})
    render(<Editor />)
    press()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(document.querySelector('[data-palette-stand-in]')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Insert' }))
  })

  it('a failed load says so in plain words, with a Reload the member presses (never by itself)', async () => {
    widgetPaletteLoaders.palette = () => Promise.reject(new Error('boom'))
    const reload = vi.spyOn(pageReload, 'run').mockImplementation(() => {})
    render(<Editor />)
    press()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(`${INSERT_UNAVAILABLE} ${RELOAD_TO_RECOVER}`)
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('the editor mounts the slot and warms it from Insert; WidgetPalette is never a lazy wrapper there', () => {
    const src = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx'), 'utf8')
    expect(src).toContain('<WidgetPaletteSlot ')
    expect(src).not.toMatch(/lazyChunk\([^)]*WidgetPalette/)
    expect(src).not.toMatch(/import\('\.\/WidgetPalette'\)/)
    expect(src.match(/onPointerEnter=\{warmWidgetPalette\}/g)).toHaveLength(2)
  })
})
