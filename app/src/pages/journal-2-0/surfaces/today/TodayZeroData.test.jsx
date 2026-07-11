/**
 * TodayZeroData — the fresh-account funnel front door.
 *
 * P0 First-Insight evolution: with the `firstInsight` flag ON (default), the
 * three onboarding paths render as prominent cards under a "find your edge"
 * headline, and the Import CSV path names the competitor presets explicitly.
 * With the flag OFF, the ORIGINAL guided checklist renders unchanged (the legacy
 * kill-switch path).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setFeatureFlag } from '../../featureFlags'
import TodayZeroData from './TodayZeroData'

function renderZero(props = {}) {
  return render(
    <MemoryRouter>
      <TodayZeroData onImport={vi.fn()} onLogTrade={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear() // reset the firstInsight flag override → default ON
})

describe('TodayZeroData — flag ON (First-Insight funnel)', () => {
  it('renders the three prominent paths under the "find your edge" headline', () => {
    renderZero()
    expect(screen.getByTestId('today-zero-data')).toBeInTheDocument()
    expect(screen.getByText(/find your edge/i)).toBeInTheDocument()
    // the three paths, named
    expect(screen.getByText(/connect your broker/i)).toBeInTheDocument()
    expect(screen.getByText(/import a csv/i)).toBeInTheDocument()
    expect(screen.getByText(/log your first trade/i)).toBeInTheDocument()
  })

  it('names the competitor CSV presets explicitly under Import CSV', () => {
    renderZero()
    // "Import from TradeZella, Tradervue, TraderSync, or any broker CSV"
    const preset = screen.getByText(/TradeZella, Tradervue, TraderSync/i)
    expect(preset).toBeInTheDocument()
    expect(preset).toHaveTextContent(/any broker csv/i)
  })

  it('fires onImport / onLogTrade from the path buttons', async () => {
    const onImport = vi.fn()
    const onLogTrade = vi.fn()
    renderZero({ onImport, onLogTrade })
    screen.getByRole('button', { name: /import csv/i }).click()
    screen.getByRole('button', { name: /log a trade/i }).click()
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onLogTrade).toHaveBeenCalledTimes(1)
  })
})

describe('TodayZeroData — flag OFF (legacy checklist)', () => {
  beforeEach(() => {
    setFeatureFlag('firstInsight', false)
  })

  it('renders the original guided checklist, not the path cards', () => {
    renderZero()
    expect(screen.getByTestId('today-zero-data')).toBeInTheDocument()
    expect(screen.getByText(/set up your journal/i)).toBeInTheDocument()
    // the First-Insight headline + card heads are absent
    expect(screen.queryByText(/find your edge/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/connect your broker/i)).not.toBeInTheDocument()
    // the legacy checklist still lists the competitor exports + a broker connect
    expect(screen.getByText(/connect a broker/i)).toBeInTheDocument()
    expect(screen.getByText(/TradeZella, Tradervue, TraderSync/i)).toBeInTheDocument()
  })
})
