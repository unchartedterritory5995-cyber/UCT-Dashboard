// app/src/components/chart/builder/ImportBox.sourceSurvival.test.jsx
//
// ─── 🔴 THE MEMBER'S PINE MUST SURVIVE THE SHEET ─────────────────────────────
//
// The objective is that a member WRITES their own screener. Writing is iterative:
// you type, it refuses, you look at the Library tab for the name of a function,
// you come back. Until this file, coming back found the box EMPTY.
//
// ⛔ `ImportBox` unmounts the moment `buildMode` changes, and its textarea lived
// only in `PasteBox`'s own `useState(initialSource)` — a seam with NO production
// caller passing anything into it (`grep -rn initialSource app/src` hit only
// PineBox.jsx). So the script existed in exactly one place, and that place was
// destroyed by clicking a tab.
//
// ⛔⛔ AND `dirty` COULD NOT SEE IT, WHICH IS THE PART THAT LOST WORK. It
// enumerates `source, name, plotRows, plot0, target, levelsText`; the Pine
// textarea is none of those. So Escape or Cancel with a full unsaved script took
// the silent path — in the sheet whose own comment records the last time that
// happened: *"MEASURED IN PRODUCTION 2026-08-10: Escape closed the builder and
// discarded everything typed, with no prompt."*
//
// ⭐ AND IT COMPOUNDS EXACTLY WHERE IT HURTS MOST. While a script REFUSES,
// `source` stays empty — so the member with the most unsaved work, a long script
// that does not translate yet, was the member `dirty` was blindest to.
//
// ⛔ EVERY CASE DRIVES THE REAL SHEET. A test that rendered `ImportBox` alone
// would pass with the prop unwired, which is the whole defect.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { AuthContext } from '../../../context/AuthContext'
import { translatePine } from '../engine/ast/pine'

const H = vi.hoisted(() => ({ requests: [] }))

function stubFetch() {
  H.requests = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}

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

/** ⚠️ `getByRole`, never `findByRole` — this file runs on fake timers. */
const tab = (name) => screen.getByRole('tab', { name })
const pasteField = () => screen.getByTestId('pine-box').querySelector('textarea')

async function settle() {
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}

async function typeScript(text) {
  fireEvent.click(tab(/^import$/i))
  fireEvent.change(pasteField(), { target: { value: text } })
  await settle()
}

const WORKS = `//@version=6
indicator("s")
plot(ta.rsi(close, 14) < 30 and close > ta.sma(close, 200) ? 1 : 0)
`
/** A script a member is midway through — real work, and it does NOT translate. */
const HALF_WRITTEN = `//@version=6
indicator("s")
len = input.int(14)
sig = ta.frobnicate(close, len)
plot(sig > 0 ? 1 : 0)
`

beforeEach(() => { vi.useFakeTimers(); stubFetch() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('🔴 a script survives leaving the tab and asks before being discarded', () => {
  it('the fixtures are what this file claims — one translates, one refuses', () => {
    // ⛔ NON-VACUITY FIRST. The compounding case below is only interesting if the
    // half-written script really does refuse, leaving `source` empty.
    expect(translatePine(WORKS).ok).toBe(true)
    expect(translatePine(HALF_WRITTEN).ok).toBe(false)
  })

  it('⭐⭐ leaving the Import tab and coming back keeps the script', async () => {
    mount()
    await typeScript(WORKS)
    expect(pasteField().value).toContain('ta.rsi')

    fireEvent.click(tab(/^library$/i))
    await flush()
    fireEvent.click(tab(/^import$/i))
    await flush()

    expect(pasteField().value, 'the script was destroyed by a tab click').toBe(WORKS)
  })

  it('⭐⭐ …including a script that does NOT translate', async () => {
    // ⚠️ THE CASE THE OLD SEAM WAS BLINDEST TO. A refusing script leaves `source`
    // empty, so nothing else in the sheet is holding a copy of this text.
    mount()
    await typeScript(HALF_WRITTEN)
    fireEvent.click(tab(/^conditions$/i))
    await flush()
    fireEvent.click(tab(/^import$/i))
    await flush()
    expect(pasteField().value).toBe(HALF_WRITTEN)
  })

  it('⛔⛔ Cancel with an unsaved script ASKS before discarding it', async () => {
    mount()
    await typeScript(HALF_WRITTEN)
    expect(screen.queryByTestId('discard-confirm')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    await flush()

    expect(screen.getByTestId('discard-confirm'),
      'the sheet closed on a full unsaved script with no prompt').toBeTruthy()
  })

  it('⛔ an EMPTY box still closes instantly — the gate did not become a nag', async () => {
    // ⭐ THE CONTROL. "A confirm on every close trains people to dismiss it" is
    // this sheet's own stated reason for keeping Escape instant when there is
    // nothing to lose; without this case the fix above could have been `dirty`
    // returning true always.
    mount()
    fireEvent.click(tab(/^import$/i))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    await flush()
    expect(screen.queryByTestId('discard-confirm')).toBeNull()
  })
})
