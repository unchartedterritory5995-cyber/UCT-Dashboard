// app/src/components/chart/builder/pineBoxCandleNotDrawn.test.jsx
//
// ─── ⛔⛔ H14 (2026-09-28) — THE BUILDER'S OWN PINE IMPORT, SAME HAZARD AS THE HOST DOOR ─
//
// `translatePine` expands `plotcandle` / `plotbar` into four rows. PR #233 stopped
// the HOST member door drawing them as four lines. The builder's Import tab
// (`PineBox` -> `BuilderSheet`) is a second door onto the same rows: it offered
// each candle arm as a radio "column", picked one of them BY DEFAULT for a
// candle-only script (`translatePine`'s `selected`), and carried every other arm
// as a sibling plot row — and every row the sheet writes is a `style: 'line'`
// plot. This rail drives that door, and asserts:
//   1. no candle arm reaches what the door hands back (`onPick`) or what the sheet
//      SAVES — compared by formula text against the translation's own candle rows;
//   2. the member reads the host door's sentence (`candleNotDrawn.js`), as RENDERED
//      DOM text — in a refusal when the candle was all the script drew, beside the
//      row when something else survives;
//   3. CONTROL: an ordinary `plot` in the same script is still offered, handed back
//      and saved as a line;
//   4. CONTROL: a bare price passthrough candle is unchanged (shown hidden, no
//      sentence, the plot beside it still handed back).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'

import { ImportBox, inspectSource, PINE_DEBOUNCE_MS } from './PineBox'
import BuilderSheet from './BuilderSheet'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { MULTI_OUTPUT_CALLS } from '../engine/ast/pine'
import { MULTI_OUTPUT_NOT_DRAWN } from './memberPane/candleNotDrawn'
import { AuthContext } from '../../../context/AuthContext'
import { USER_DEFINITIONS_KEY } from '../../../hooks/useUserDefinitions'

const REPO = path.resolve(process.cwd(), '..')
const corpus = (name) => fs.readFileSync(path.join(REPO, 'corpus', 'committed', `${name}.pine`), 'utf8')

// The sentence is built from the SAME map the doors read — never retyped here.
const SENTENCE = (call, line) =>
  `This script's \`${call}\` (line ${line}) ${MULTI_OUTPUT_NOT_DRAWN[call]}.`

const CORPUS = [
  { script: 'institutional-smc-order-flow-matrix-pro__0b30cae0e6', line: 85 },
  { script: 'smt-divergence-ict-01-tradingfinder-smart-money-technique__3f66e16b3c', line: 116 },
]

const CONTROL_LINE = 'plot(ta.sma(close, 20), "Control")'
const CONTROL_FORMULA = 'sma(close, 20)'
const withControl = (src) => `${src.replace(/\s*$/, '')}\n${CONTROL_LINE}\n`

const synth = (call) => [
  '//@version=5',
  'indicator("Smoothed", overlay=true)',
  `${call}(ta.ema(close, 7), ta.highest(high, 3), ta.lowest(low, 3), ta.wma(close, 9), "Smoothed")`,
].join('\n')

const PASSTHROUGH = [
  '//@version=5',
  'indicator("Pass", overlay=true)',
  'plotcandle(open, high, low, close, "Raw")',
  CONTROL_LINE,
].join('\n')

const isCandleKind = (o) => Object.prototype.hasOwnProperty.call(MULTI_OUTPUT_CALLS, o.kind)
/** The candle arms the SHIPPED translation produces for this text. */
const candleFormulas = (src) => (inspectSource(src, 'auto').outputs || [])
  .filter((o) => isCandleKind(o) && !o.hidden && o.formula)
  .map((o) => o.formula)

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const settlePine = async () => {
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}
const settleFormula = async () => {
  for (let i = 0; i < 2; i += 1) {
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) })
    await flush()
  }
}
const pasteInto = async (src) => {
  fireEvent.change(screen.getByTestId('pine-box').querySelector('textarea'), { target: { value: src } })
  await settlePine()
}
const radios = () => [...screen.getByTestId('pine-box').querySelectorAll('input[type="radio"]')]
const handedSources = (picked) => (typeof picked === 'string'
  ? [picked]
  : [picked.source, ...((picked.outputs || []).map((o) => o.source))])

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('non-vacuity: the builder door is handed four visible candle arms, and would pick one', () => {
  it.each([...CORPUS.map((c) => corpus(c.script)), synth('plotcandle'), synth('plotbar')])(
    'the translation offers four candle arms and SELECTS one of them',
    (src) => {
      const r = inspectSource(src, 'auto')
      const arms = r.outputs.filter((o) => isCandleKind(o) && !o.hidden && o.formula && !o.refusal)
      expect(arms).toHaveLength(4)
      // ⛔ the pre-fix door set `chosen` straight from this — a candle arm as plot 1.
      expect(isCandleKind(r.outputs[r.selected])).toBe(true)
    },
  )
})

describe.each(CORPUS)('$script — through the real ImportBox', ({ script, line }) => {
  it('candle-only: refused BY NAME, rendered, no column offered, nothing handed back', async () => {
    const onPick = vi.fn()
    render(<ImportBox onPick={onPick} dialect="auto" />)
    await pasteInto(corpus(script))
    const refusal = screen.getByTestId('pine-candle-refusal')
    expect(refusal.textContent).toContain(
      `${SENTENCE('plotcandle', line)} It plots nothing else this pane can draw.`)
    expect(radios()).toEqual([])
    const use = screen.getByTestId('pine-use')
    expect(use.disabled).toBe(true)
    fireEvent.click(use)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('CONTROL: an ordinary `plot` beside the candle is offered and handed back — alone', async () => {
    const onPick = vi.fn()
    const src = withControl(corpus(script))
    const arms = candleFormulas(src)
    expect(arms).toHaveLength(4) // non-vacuity for the comparison below
    render(<ImportBox onPick={onPick} dialect="auto" />)
    await pasteInto(src)
    expect(radios()).toHaveLength(1)
    expect(screen.getByTestId('pine-box').textContent).toContain(SENTENCE('plotcandle', line))
    fireEvent.click(screen.getByTestId('pine-use'))
    expect(onPick).toHaveBeenCalledTimes(1)
    const sent = handedSources(onPick.mock.calls[0][0])
    expect(sent).toContain(CONTROL_FORMULA)
    for (const f of arms) expect(sent).not.toContain(f)
  })
})

describe.each(['plotcandle', 'plotbar'])('%s with an ordinary plot beside it — through the real ImportBox', (call) => {
  it('the candle arms are shown, NOT offered, and each says why in the host door\'s words', async () => {
    const onPick = vi.fn()
    const src = withControl(synth(call))
    render(<ImportBox onPick={onPick} dialect="auto" />)
    await pasteInto(src)
    const rows = [0, 1, 2, 3].map((i) => screen.getByTestId(`pine-output-undrawn-${i}`))
    for (const row of rows) {
      expect(row.textContent).toContain(SENTENCE(call, 3))
      expect(row.querySelector('input')).toBeNull()
    }
    expect(radios()).toHaveLength(1)
    fireEvent.click(screen.getByTestId('pine-use'))
    const picked = onPick.mock.calls[0][0]
    expect(handedSources(picked).every((s) => s === CONTROL_FORMULA)).toBe(true)
    expect(JSON.stringify(picked)).not.toMatch(/ema\(close, 7\)|highest\(high, 3\)|lowest\(low, 3\)|wma\(close, 9\)/)
  })
})

describe('CONTROL — UNCHANGED: a bare price passthrough candle', () => {
  it('is shown hidden, says nothing about candles, and the plot beside it is handed back', async () => {
    const onPick = vi.fn()
    render(<ImportBox onPick={onPick} dialect="auto" />)
    await pasteInto(PASSTHROUGH)
    for (const i of [0, 1, 2, 3]) {
      expect(screen.getByTestId(`pine-hidden-tag-${i}`).textContent).toMatch(/hidden/)
      expect(screen.queryByTestId(`pine-output-undrawn-${i}`)).toBeNull()
    }
    expect(screen.getByTestId('pine-box').textContent).not.toMatch(/draws candles/)
    expect(screen.queryByTestId('pine-candle-refusal')).toBeNull()
    fireEvent.click(screen.getByTestId('pine-use'))
    expect(handedSources(onPick.mock.calls[0][0]).every((s) => s === CONTROL_FORMULA)).toBe(true)
  })
})

// ─── THE WHOLE DOOR: paste -> Use -> Save, and read what the sheet WRITES ────────
describe('through BuilderSheet — the saved document is what the chart draws', () => {
  const H = { requests: [] }
  beforeEach(() => {
    H.requests = []
    global.fetch = vi.fn(async (url, init = {}) => {
      const method = init.method || 'GET'
      H.requests.push({ url: String(url), method, body: init.body ?? null })
      if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
      return { ok: true, status: 200, json: async () => ({ def_id: 'u_cccccccccccc', version: 1, rev: 1 }) }
    })
  })
  const mount = async () => {
    render(
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={() => {}} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    await flush()
    fireEvent.click(screen.getByRole('tab', { name: /^import$/i }))
  }
  const savedDoc = async (name) => {
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: name } })
    await settleFormula()
    const save = screen.getByRole('button', { name: /^save$/i })
    expect(save.disabled, 'Save should be enabled').toBe(false)
    fireEvent.click(save)
    await flush()
    const post = H.requests.find((r) => r.method === 'POST' && r.url === USER_DEFINITIONS_KEY)
    expect(post, 'nothing was written').toBeTruthy()
    return JSON.parse(post.body).definition
  }
  const savedSources = (doc) => {
    const c = doc.compute || {}
    return [...new Set([c.source, ...Object.values(c.sources || {})].filter(Boolean))]
  }

  it('candle + an ordinary plot: only the plot is saved; no candle arm becomes a line', async () => {
    const src = withControl(synth('plotcandle'))
    const arms = candleFormulas(src)
    expect(arms).toHaveLength(4)
    await mount()
    await pasteInto(src)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()
    const doc = await savedDoc('Candle control')
    const sources = savedSources(doc)
    expect(sources).toEqual([CONTROL_FORMULA])
    for (const f of arms) expect(sources).not.toContain(f)
    expect((doc.plots || []).filter((p) => !p.hidden && p.style === 'line')).toHaveLength(1)
  })

  it.each(CORPUS)('$script alone: the sheet is never handed a candle arm, and says why', async ({ script, line }) => {
    await mount()
    await pasteInto(corpus(script))
    expect(screen.getByTestId('pine-candle-refusal').textContent).toContain(SENTENCE('plotcandle', line))
    const use = screen.getByTestId('pine-use')
    expect(use.disabled).toBe(true)
    fireEvent.click(use)
    await settleFormula()
    // still on the Import tab — nothing was handed to the formula box
    expect(screen.getByTestId('pine-box')).toBeTruthy()
  })
})
