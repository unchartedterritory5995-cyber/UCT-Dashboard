// app/src/components/chart/builder/BuilderSheet.dynamicColour.test.jsx
//
// ─── ⭐⭐ C1-A, THE DOCUMENT HALF ────────────────────────────────────────────
//
// The translator can now read `plot(x, color = up ? green : red)` and the binder
// can now DRAW `colorMode: 'column:<key>'`. This is the piece between them: the
// sheet has to turn the carried rule into a real document — a hidden column
// holding the condition, and a visible plot whose mode names it.
//
// ⛔ WITHOUT THIS THE OTHER TWO ARE UNREACHABLE, which is the failure mode this
// repo names most often: built, tested, green, and connected to nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'

const UP = '#4CAF50'
const DOWN = '#FF5252'

/** What `PineBox` hands back for `plot(close, color = close > open ? g : r)`. */
const SINGLE = {
  source: 'close',
  inputs: [],
  presentation: {
    output: {
      colorUp: UP,
      colorDown: DOWN,
      colorCondition: { formula: 'close > open' },
    },
  },
  outputs: [{ source: 'close', title: 'Close', presentation: {}, inputs: [] }],
}

/** Two plots, the SECOND of which carries the rule. */
const MULTI = {
  source: 'close',
  inputs: [],
  presentation: { output: {} },
  outputs: [
    { source: 'close', title: 'Close', presentation: {}, inputs: [] },
    {
      source: 'high',
      title: 'High',
      inputs: [],
      presentation: {
        colorUp: UP, colorDown: DOWN, colorCondition: { formula: 'high > low' },
      },
    },
  ],
}

const H = vi.hoisted(() => ({ requests: [], payload: null }))

vi.mock('./PineBox', () => {
  const Fake = ({ onPick }) => (
    <button type="button" data-testid="fake-pine-use" onClick={() => onPick(H.payload)}>use</button>
  )
  return { __esModule: true, PINE_DEBOUNCE_MS: 250, ImportBox: (p) => <Fake {...p} />, default: Fake }
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  H.requests = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_cccccccccccc', version: 1, rev: 1 }) }
  })
})
afterEach(() => { vi.useRealTimers(); cleanup(); vi.restoreAllMocks() })

const settle = async () => {
  for (let i = 0; i < 2; i += 1) {
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
  }
}

async function importAndSave(payload) {
  H.payload = payload
  render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
  await act(async () => { await Promise.resolve() })
  fireEvent.click(screen.getByRole('tab', { name: /^import$/i }))
  await act(async () => { fireEvent.click(screen.getByTestId('fake-pine-use')) })
  await settle()
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Coloured' } })
  })
  await settle()
  const save = screen.getByRole('button', { name: /^save$/i })
  expect(save.disabled, 'the document should be saveable').toBe(false)
  await act(async () => { fireEvent.click(save) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  const post = H.requests.find((r) => r.method === 'POST')
  expect(post, 'a definition should have been POSTed').toBeTruthy()
  return JSON.parse(post.body).definition
}

describe('a carried colour rule becomes a real document', () => {
  it('⭐⭐ single plot: a hidden condition column, and a mode that names it', async () => {
    const doc = await importAndSave(SINGLE)
    const byKey = Object.fromEntries(doc.plots.map((p) => [p.key, p]))

    // The condition is a COLUMN of this document — it has a tree, like any other.
    expect(byKey.value_c).toBeTruthy()
    expect(byKey.value_c.hidden).toBe(true)
    expect(doc.compute.trees.value_c).toBeTruthy()

    // And the visible plot colours from it, with both colours.
    expect(byKey.value.colorMode).toBe('column:value_c')
    expect(byKey.value.colorUp).toBe(UP)
    expect(byKey.value.colorDown).toBe(DOWN)
  })

  it('⭐ multi-plot: the rule lands on the row that carried it, not on plot 1', async () => {
    const doc = await importAndSave(MULTI)
    const byKey = Object.fromEntries(doc.plots.map((p) => [p.key, p]))
    const coloured = doc.plots.find((p) => p.colorMode)
    expect(coloured).toBeTruthy()
    expect(coloured.key).not.toBe('value')
    expect(byKey[coloured.colorMode.slice('column:'.length)]).toBeTruthy()
    expect(byKey[coloured.colorMode.slice('column:'.length)].hidden).toBe(true)
    // ⛔ AND PLOT 1, WHICH CARRIED NO RULE, DECLARES NO MODE. A rule applied to
    // the wrong row is a wrong picture that still validates.
    expect(byKey.value.colorMode).toBeUndefined()
  })

  it('⛔ MUTATION CONTROL: no rule ⇒ no hidden column and no mode', async () => {
    const plain = { ...SINGLE, presentation: { output: {} } }
    const doc = await importAndSave(plain)
    expect(doc.plots.some((p) => p.colorMode)).toBe(false)
    expect(doc.plots.some((p) => p.hidden)).toBe(false)
    expect(Object.keys(doc.compute.trees || {})).not.toContain('value_c')
  })

  it('⛔ a rule missing one of its two colours is NOT carried', async () => {
    // `defSchema` refuses a `column:` mode without both, so a half-set row would
    // make the whole document unsaveable — the sheet must not build one.
    const half = {
      ...SINGLE,
      presentation: { output: { colorUp: UP, colorCondition: { formula: 'close > open' } } },
    }
    const doc = await importAndSave(half)
    expect(doc.plots.some((p) => p.colorMode)).toBe(false)
  })
})
