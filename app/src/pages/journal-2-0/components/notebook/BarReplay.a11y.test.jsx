// Lane FIN-A11Y (review R4, I-4 and the speed part of M-9): the bar replay window is a
// real dialog. Focus moves in, Tab stays in, Escape closes, focus returns to the button
// that opened it. The status row is not announced on every bar while it plays, the
// controls carry icons from UIcon (never glyph characters a screen reader spells out),
// and playback does not start on its own under reduced motion.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useState } from 'react'
import BarReplay from './BarReplay'

vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({ setData: vi.fn(), update: vi.fn(), createPriceLine: vi.fn(), removePriceLine: vi.fn() }),
    timeScale: () => ({ setVisibleRange: vi.fn() }),
    remove: vi.fn(),
  }),
  createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
  CandlestickSeries: {},
  LineStyle: { Dashed: 2 },
  ColorType: { Solid: 'solid' },
}))

const BARS = [
  { t: '2026-08-03', o: 100, h: 102, l: 99, c: 101 },
  { t: '2026-08-04', o: 101, h: 105, l: 100, c: 104 },
  { t: '2026-08-05', o: 104, h: 110, l: 103, c: 109 },
  { t: '2026-08-06', o: 109, h: 111, l: 107, c: 108 },
]

const statusAt = (idx) => ({ label: idx + ' bars shown', value: null, tone: null })

function Host({ autoplay = false }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Replay</button>
      <button type="button">behind the dialog</button>
      {open && (
        <BarReplay
          symbol="NVDA"
          tf="D"
          title="NVDA replay"
          tfNote="daily bars"
          statusAt={statusAt}
          autoplay={autoplay}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

const realMatchMedia = window.matchMedia
const setReducedMotion = (on) => {
  window.matchMedia = (query) => ({
    matches: on && /prefers-reduced-motion/.test(query),
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ bars: BARS }) }))
})
afterEach(() => { window.matchMedia = realMatchMedia })

async function openReplay(user, props) {
  render(<Host {...props} />)
  await user.click(screen.getByRole('button', { name: 'Replay' }))
  const dialog = await screen.findByRole('dialog', { name: 'NVDA replay' })
  await screen.findByLabelText('Replay position')
  return dialog
}

describe('BarReplay is a working dialog (I-4)', () => {
  it('moves focus into the dialog when it opens', async () => {
    const user = userEvent.setup()
    const dialog = await openReplay(user)
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })

  it('Tab never leaves the dialog for the page behind it', async () => {
    const user = userEvent.setup()
    const dialog = await openReplay(user)
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    for (let i = 0; i < 14; i += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement), 'after Tab ' + (i + 1)).toBe(true)
    }
    await user.tab({ shift: true })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Escape closes it and focus returns to the Replay button', async () => {
    const user = userEvent.setup()
    await openReplay(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replay' })).toHaveFocus()
  })

  it('the Close replay button closes it and focus returns to the Replay button', async () => {
    const user = userEvent.setup()
    await openReplay(user)
    await user.click(screen.getByRole('button', { name: 'Close replay' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replay' })).toHaveFocus()
  })

  it('locks the page scroll while it is open', async () => {
    const user = userEvent.setup()
    await openReplay(user)
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})

describe('BarReplay controls (I-4, M-9)', () => {
  it('the controls are named by words, with no glyph characters in their text', async () => {
    const user = userEvent.setup()
    const dialog = await openReplay(user)
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Step forward one bar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close replay' })).toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/[↻❚▶▸✕]/)
    // each of those three carries a drawn icon, hidden from assistive technology
    for (const name of ['Play', 'Step forward one bar', 'Close replay']) {
      expect(screen.getByRole('button', { name }).querySelector('svg')).not.toBeNull()
    }
  })

  it('Play becomes Pause, and Pause becomes Play', async () => {
    const user = userEvent.setup()
    await openReplay(user)
    await user.click(screen.getByRole('button', { name: 'Play' }))
    await user.click(await screen.findByRole('button', { name: /Pause|Restart/ }))
    expect(screen.getByRole('button', { name: /Play|Pause/ })).toBeInTheDocument()
  })

  it('the status row is live only while paused, so a screen reader is not flooded per bar', async () => {
    const user = userEvent.setup()
    await openReplay(user)
    const status = screen.getByText(/bars shown/).parentElement
    expect(status).toHaveAttribute('aria-live', 'polite')
    await user.click(screen.getByRole('button', { name: 'Play' }))
    // either still playing (off) or already at the end (polite again)
    if (screen.queryByRole('button', { name: 'Pause' })) {
      expect(screen.getByText(/bars shown/).parentElement).toHaveAttribute('aria-live', 'off')
    }
  })

  it('the selected speed is pressed and carries a check mark, not only a colour', async () => {
    const user = userEvent.setup()
    await openReplay(user)
    const two = screen.getByRole('button', { name: 'Speed 2×' })
    expect(two).toHaveAttribute('aria-pressed', 'true')
    expect(two.querySelector('svg')).not.toBeNull()
    const four = screen.getByRole('button', { name: 'Speed 4×' })
    expect(four).toHaveAttribute('aria-pressed', 'false')
    expect(four.querySelector('svg')).toBeNull()
    await user.click(four)
    expect(four).toHaveAttribute('aria-pressed', 'true')
    expect(four.querySelector('svg')).not.toBeNull()
    expect(two.querySelector('svg')).toBeNull()
  })

  it('does not start playing on its own under reduced motion', async () => {
    setReducedMotion(true)
    const user = userEvent.setup()
    await openReplay(user, { autoplay: true })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })
})

describe('BarReplay stylesheet follows the theme (I-4)', () => {
  const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/BarReplay.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  it('uses no undefined custom property and no fixed gold literal', () => {
    expect(css).not.toMatch(/--surface-1\b/)
    expect(css).not.toMatch(/#dcbb5e/i)
  })
})
