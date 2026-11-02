// I2 — the import box shows the four-class verdict for thinkScript / TC2000 /
// native imports, and renders Pine EXACTLY as it did before (owner-authorized
// PineBox change, 2026-11-01; record: docs/indicators/i2/PINE-COORDINATION-import-verdict.md).
//
// ⭐ THE PINE RAIL COMPARES AGAINST MASTER, NOT AGAINST ITSELF. The fixture
// `pineBoxPineRender.fixture.json` was written by THIS file run on an untouched
// `origin/master` checkout (PINEBOX_RENDER_FIXTURE_WRITE=1), before the change.
// Here, on the changed component, every Pine script must render the same
// `innerHTML`, byte for byte.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ⭐ The verdict module, wrapped so a test can see WHICH dialects reach it. The
// wrapper delegates unchanged; it exists only to make the Pine guard observable,
// because Pine's passthrough verdict renders identically and could not show it.
const verdictCalls = []
vi.mock('../engine/ast/importVerdict', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, importVerdict: (report) => { verdictCalls.push(report && report.dialect); return real.importVerdict(report) } }
})

import { ImportBox, inspectSource, PINE_DEBOUNCE_MS } from './PineBox'
import { importOutcome } from '../engine/ast/importOutcome'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, 'pineBoxPineRender.fixture.json')

const PINE_SCRIPTS = [
  '//@version=5\nindicator("x")\nplot(ta.sma(close, 20))',
  '//@version=5\nindicator("x")\nplot(ta.ema(close, 20), color = close > open ? color.green : color.red)',
  '//@version=5\nindicator("x")\nlen = input.int(14, "Length")\nplot(ta.rsi(close, len))\nhline(70)\nhline(30)',
  '//@version=5\nindicator("x")\nw = request.security(syminfo.tickerid, "W", ta.sma(close, 10))\nplot(w)',
  '//@version=5\nindicator("x")\nplot(ta.cum(volume))',
  '//@version=5\nstrategy("s")\nif ta.crossover(close, ta.sma(close, 20))\n    strategy.entry("L", strategy.long)\nplot(ta.sma(close, 20))',
]

const paste = (text) => fireEvent.change(
  screen.getByLabelText(/^(pine script|script or formula)$/i), { target: { value: text } })

async function renderedFor(text) {
  cleanup()
  const { container } = render(<ImportBox onPick={() => {}} />)
  paste(text)
  await act(async () => { await new Promise((r) => setTimeout(r, PINE_DEBOUNCE_MS + 50)) })
  await screen.findByTestId('import-outcome')
  return { container, line: screen.getByTestId('import-outcome') }
}

beforeEach(() => { cleanup() })

describe('Pine renders exactly as on master', () => {
  it('every Pine script’s import box is byte-identical to the master render', async () => {
    const now = {}
    for (const s of PINE_SCRIPTS) {
      const { container } = await renderedFor(s)
      now[s] = container.innerHTML
    }
    if (process.env.PINEBOX_RENDER_FIXTURE_WRITE === '1') {
      fs.writeFileSync(FIXTURE, `${JSON.stringify({ _: 'Written on untouched origin/master by pineBoxImportVerdict.test.jsx (PINEBOX_RENDER_FIXTURE_WRITE=1). Synthetic scripts only.', renders: now }, null, 2)}\n`)
    }
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).renders
    expect(Object.keys(committed)).toEqual(PINE_SCRIPTS)
    for (const s of PINE_SCRIPTS) {
      expect(now[s].length).toBeGreaterThan(200) // non-vacuity: a real box was rendered
      expect(now[s], s).toBe(committed[s])
    }
  }, 60000)

  it('the import box never asks the new verdict module about a Pine import', async () => {
    verdictCalls.length = 0
    for (const s of PINE_SCRIPTS) await renderedFor(s)
    expect(verdictCalls.filter((d) => d === 'pine')).toEqual([])
    verdictCalls.length = 0
    await renderedFor('plot x = close > Average(close, 20);')
    expect(verdictCalls).toContain('thinkscript') // control: the spy does see calls
  }, 60000)

  it('the Pine verdict line is importOutcome’s verdict, label and reason, unchanged', async () => {
    for (const s of PINE_SCRIPTS) {
      const { line } = await renderedFor(s)
      const o = importOutcome(inspectSource(s, 'pine'))
      expect(line.dataset.outcome).toBe(o.verdict)
      expect(line.querySelector('b').textContent).toBe(o.label)
    }
  }, 60000)
})

describe('thinkScript, TC2000 and native imports show the four-class verdict', () => {
  it('a clean thinkScript import reads "Imported, no known differences", and says it was not compared', async () => {
    const { line } = await renderedFor('plot x = close > Average(close, 20);')
    expect(line.dataset.outcome).toBe('no-known-differences')
    expect(line.textContent).toMatch(/^Imported, no known differences — translated from thinkorswim’s published definitions/)
    expect(line.textContent).toMatch(/not been compared against thinkorswim’s own/)
    expect(line.textContent).not.toMatch(/Exact import/)
  })

  it('a clean TC2000 import reads the same way, naming TC2000', async () => {
    const { line } = await renderedFor('C > AVGC50')
    expect(line.dataset.outcome).toBe('no-known-differences')
    expect(line.textContent).toMatch(/TC2000’s published definitions/)
    expect(line.textContent).not.toMatch(/Exact import/)
  })

  it('a native formula is not an import and keeps "Exact import"', async () => {
    const { line } = await renderedFor('sma(close, 10) > close')
    expect(line.dataset.outcome).toBe('exact')
    expect(line.textContent).toBe('Exact import')
  })

  it('a thinkScript value difference is disclosed and never says the values are the same', async () => {
    const { line } = await renderedFor('plot x = ExpAverage(close, 10);')
    expect(line.dataset.outcome).toBe('disclosed')
    expect(line.textContent).toMatch(/values can differ/)
    expect(line.textContent).not.toMatch(/the values are the same/)
  })

  it('a thinkScript drawing-only difference says only the drawing differs', async () => {
    const { line } = await renderedFor('plot x = Average(close, 20);\nx.SetDefaultColor(Color.RED);')
    expect(line.dataset.outcome).toBe('disclosed')
    expect(line.textContent).toMatch(/some of it is drawn differently; the values are the same/)
  })

  it('a TC2000 cross boundary is a value difference', async () => {
    const { line } = await renderedFor('XUP(C, AVGC50)')
    expect(line.dataset.outcome).toBe('disclosed')
    expect(line.textContent).toMatch(/values can differ/)
  })

  it('a thinkScript average over a weekly read is never presented as matching', async () => {
    const { line } = await renderedFor('plot x = Average(close(period = AggregationPeriod.WEEK), 10);')
    expect(line.dataset.outcome).toBe('disclosed')
    expect(line.textContent).not.toMatch(/the values are the same|no known differences|Exact import/)
  })

  it('the differences list below the verdict still renders from importOutcome', async () => {
    await renderedFor('plot x = ExpAverage(close, 10);')
    await waitFor(() => expect(document.body.textContent).toMatch(/begins from a different first window than thinkorswim/))
  })
})
