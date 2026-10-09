// The palette's terminal row loads off the first-open path (notebook bytes budget, 2026-10-09).
import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import usePaletteCommandRow from './usePaletteCommandRow'
import { terminalCommandRow } from './paletteGrammar'

describe('usePaletteCommandRow', () => {
  it('answers the same row terminalCommandRow answers, once the parser has loaded', async () => {
    const { result } = renderHook(({ q }) => usePaletteCommandRow(q, true), { initialProps: { q: 'nvda gp' } })
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current).toEqual(terminalCommandRow('nvda gp'))
  })
  it('no shell, or an empty query → no row', () => {
    expect(renderHook(() => usePaletteCommandRow('nvda gp', false)).result.current).toBeNull()
    expect(renderHook(() => usePaletteCommandRow('', true)).result.current).toBeNull()
  })
  it('⛔ rail: the palette (mounted on every page) never statically imports the shell parser', () => {
    const src = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/components/CommandPalette.jsx'), 'utf8')
    expect(src).not.toMatch(/from ['"][^'"]*terminal\/(paletteGrammar|parseCommand|grammar|args)['"]/)
    const hook = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/pages/terminal/usePaletteCommandRow.js'), 'utf8')
    expect(hook).not.toMatch(/^import .*paletteGrammar/m)
  })
})
