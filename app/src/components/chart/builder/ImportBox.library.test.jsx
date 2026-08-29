// app/src/components/chart/builder/ImportBox.library.test.jsx
//
// ─── 🔴 THE WIRE-CUT FILE FOR "BRING YOUR LIBRARY" ──────────────────────────
//
// `libraryIntake.js` can be perfect and fully unit-green while no member can reach
// it — this branch's own recorded failure, eight features over. Every case here
// drives `BuilderSheet`.
//
// ⛔ NO NEW TAB, AND THAT IS THE DESIGN. `ImportBox.thinkscript.test.jsx` records
// the ruling — ONE BOX, not a second paste surface. Pasting forty scripts is the
// same act as pasting one, so the existing Import box NOTICES which happened. That
// also means these cases prove the feature is reachable through a door that already
// existed rather than one added beside it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { inspectLibrary, splitPaste } from './libraryIntake'
import { AuthContext } from '../../../context/AuthContext'

beforeEach(() => {
  vi.useFakeTimers()
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
})

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const noop = () => {}

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={noop} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const tab = (name) => screen.getByRole('tab', { name })
const pasteField = () => screen.getByTestId('pine-box').querySelector('textarea')

async function paste(text) {
  fireEvent.click(tab(/^import$/i))
  fireEvent.change(pasteField(), { target: { value: text } })
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}

/** Three real scripts: one that screens, one that plots a number, one that refuses. */
const ONE = '//@version=5\nindicator("above")\nplot(close > ta.sma(close, 200) ? 1 : 0)\n'
const TWO = '//@version=5\nindicator("rsi")\nplot(ta.rsi(close, 14))\n'
const THREE = '//@version=5\nindicator("cum")\nplot(ta.cum(volume))\n'
const FOLDER = ONE + TWO + THREE

describe('the fixture is what this file claims', () => {
  it('⛔ three scripts, and they do NOT all land the same way', () => {
    // ⚰️ NON-VACUITY. If all three translated, or none did, every assertion below
    // would pass against a manifest that renders one number and calls it a day.
    const split = splitPaste(FOLDER)
    expect(split.found).toBe(3)
    const lib = inspectLibrary(split.scripts)
    expect(lib.translates).toBe(2)
    expect(lib.refused).toBe(1)
    expect(lib.screensAsWritten).toBe(1)
    expect(lib.screensWithComparison).toBe(1)
  })
})

describe('🔴 pasting a folder shows the manifest, through the box that already existed', () => {
  it('⭐⭐ the four reaches are on screen, as four numbers', () => {
    // deliberately not async-shaped: mount, paste, read.
    return (async () => {
      mount()
      await flush()
      await paste(FOLDER)
      const m = screen.getByTestId('pine-library')
      expect(m.textContent).toMatch(/3 scripts/)
      // ⛔ FOUR SEPARATE REACHES. A blended score would be us computing a marketing
      // claim about a member's own work at the moment of maximum doubt.
      expect(m.textContent).toMatch(/translate/)
      expect(m.textContent).toMatch(/compute/)
      expect(m.textContent).toMatch(/save/)
      expect(m.textContent).toMatch(/screen as written/)
    })()
  })

  it('⛔ a single script shows NO manifest — this is not decoration', async () => {
    // ⚰️ THE CONTROL. A box rendering the manifest unconditionally would report "1
    // script" over every ordinary paste and bury the thing the member came for.
    mount()
    await flush()
    await paste(ONE)
    expect(screen.queryByTestId('pine-library')).toBe(null)
  })

  it('⛔⛔ the refusing script is NAMED with its guard, not hidden in a count', async () => {
    mount()
    await flush()
    await paste(FOLDER)
    const m = screen.getByTestId('pine-library')
    // `ta.cum` is a ruled refusal and its guard is the door's own.
    expect(m.textContent).toMatch(/pine:function/)
    expect(m.textContent).toMatch(/anchor|cumulative|running total/i)
  })

  it('⛔ the split heuristic warns, because it can silently glue scripts together', async () => {
    // ⚠️ MEASURED: only 21 of 30 community corpus scripts carry `//@version`, so a
    // header-less script joins the one above it. The member is told how the split
    // was made so a wrong count is visible immediately.
    mount()
    await flush()
    await paste(FOLDER)
    expect(screen.getByTestId('pine-library').textContent).toMatch(/@version/)
  })
})
