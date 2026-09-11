/* The timeframe door on the phone chart shell — top-right of the symbol strip
 * since 2026-09-11 (owner call: the bottom row is being freed for shortcut
 * tools). Three rails: the strip renders it and it opens the sheet; the bottom
 * toolbar no longer carries one (a second timeframe door is the thing this
 * move exists to avoid); and the shell actually WIRES the strip's door — a
 * component test alone is blind to a severed wire.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { test, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MobileSymbolStrip from './MobileSymbolStrip'
import MobileChartToolbar from './MobileChartToolbar'

vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useBreadthSymbols', () => ({ default: () => new Map() }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => null }))

const here = path.dirname(fileURLToPath(import.meta.url))

test('the strip carries the timeframe door, labelled with the current timeframe, and it opens the sheet', () => {
  const onOpenTf = vi.fn()
  render(<MobileSymbolStrip sym="NVDA" onOpenSearch={() => {}} tf="D" onOpenTf={onOpenTf} />)
  const btn = screen.getByRole('button', { name: 'Timeframe — 1D' })
  expect(btn.textContent).toBe('1D')
  expect(btn.getAttribute('aria-haspopup')).toBe('dialog')
  fireEvent.click(btn)
  expect(onOpenTf).toHaveBeenCalledTimes(1)
  // It is the LAST control in the strip — the top-RIGHT corner.
  const buttons = screen.getAllByRole('button')
  expect(buttons[buttons.length - 1]).toBe(btn)
})

test('a strip given no timeframe renders no dead door', () => {
  render(<MobileSymbolStrip sym="NVDA" onOpenSearch={() => {}} />)
  expect(screen.queryByRole('button', { name: /^Timeframe/ })).toBeNull()
})

test('the bottom toolbar no longer carries a timeframe door — the other four doors remain', () => {
  render(<MobileChartToolbar onOpenType={() => {}} onOpenIndicators={() => {}} onOpenWatchlist={() => {}} onOpenMore={() => {}} />)
  expect(screen.queryByRole('button', { name: /^Timeframe/ })).toBeNull()
  for (const name of ['Chart type', 'Indicators', 'Watchlist', 'More tools']) {
    expect(screen.getByRole('button', { name })).toBeTruthy()
  }
  expect(screen.getAllByRole('button')).toHaveLength(4)
})

test('WIRE · the shell hands the strip the timeframe and the sheet opener', () => {
  const src = fs.readFileSync(path.join(here, 'MobileChartsApp.jsx'), 'utf8')
  const strip = /<MobileSymbolStrip\b([\s\S]*?)\/>/.exec(src)
  expect(strip, 'MobileSymbolStrip is no longer mounted by the shell').toBeTruthy()
  expect(strip[1]).toMatch(/\btf=\{tf\}/)
  expect(strip[1]).toMatch(/onOpenTf=\{\(\) => setSheet\('tf'\)\}/)
  // And the toolbar is NOT also given one.
  const toolbar = /<MobileChartToolbar\b([\s\S]*?)\/>/.exec(src)
  expect(toolbar, 'MobileChartToolbar is no longer mounted by the shell').toBeTruthy()
  expect(toolbar[1]).not.toMatch(/onOpenTf/)
})
