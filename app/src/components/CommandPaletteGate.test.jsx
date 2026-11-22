import { createRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let resolvePalette
let rejectPalette
let importCalls = 0
const shortcuts = vi.hoisted(() => ({ fn: null }))

vi.mock('./CommandPalette', async () => {
  importCalls += 1
  const { forwardRef, useEffect, useImperativeHandle, useState } = await import('react')
  const { registerShortcuts } = await import('../pages/command/shortcutRegistry')
  await new Promise((res, rej) => { resolvePalette = res; rejectPalette = rej })
  return {
    default: forwardRef(function FakePalette(_p, ref) {
      const [open, setOpen] = useState(false)
      useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), [])
      // The real palette takes the binding on mount: a clash with the gate would throw here.
      useEffect(() => registerShortcuts({ 'palette.toggle': () => setOpen((v) => !v) }), [])
      return open ? <div role="dialog" aria-label="palette" /> : <div data-testid="closed" />
    }),
  }
})

import CommandPaletteGate from './CommandPaletteGate'

const pressK = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

describe('CommandPaletteGate', () => {
  beforeEach(() => { importCalls = 0; shortcuts.fn = null })
  afterEach(() => { vi.restoreAllMocks() })

  it('a press before the palette has landed opens it when it does', async () => {
    render(<CommandPaletteGate />)
    pressK()
    await waitFor(() => expect(resolvePalette).toBeTypeOf('function'))
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => { resolvePalette() })
    await screen.findByRole('dialog', { name: 'palette' })
  })

  it('the shell never imports the palette statically', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/Layout.jsx'), 'utf8')
    expect(src).not.toMatch(/from ['"]\.\/CommandPalette['"]/)
    const gate = readFileSync(join(process.cwd(), 'src/components/CommandPaletteGate.jsx'), 'utf8')
    expect(gate).not.toMatch(/from ['"]\.\/CommandPalette['"]/)
    // CONTROL: the same pattern does see the gate's own import in Layout.
    expect(src).toMatch(/from ['"]\.\/CommandPaletteGate['"]/)
  })

  it('the open handle works through the gate', async () => {
    const ref = createRef()
    render(<CommandPaletteGate ref={ref} />)
    act(() => { ref.current.open() })
    await waitFor(() => expect(resolvePalette).toBeTypeOf('function'))
    await act(async () => { resolvePalette() })
    await screen.findByRole('dialog', { name: 'palette' })
    expect(rejectPalette).toBeTypeOf('function')
  })
})
