// P0 0G/0I/0L — the import box SHOWS the verdict, shows semantic differences
// without a toggle, and never freezes on a translator throw.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { ImportBox } from './PineBox'

const paste = (text) => fireEvent.change(
  screen.getByLabelText(/^(pine script|script or formula)$/i), { target: { value: text } })

beforeEach(() => { cleanup() })
afterEach(() => { vi.restoreAllMocks() })

describe('the import box tells the truth about what it imported', () => {
  it('EXACT is shown as the verdict', async () => {
    render(<ImportBox onPick={vi.fn()} />)
    paste('//@version=5\nindicator("x")\nplot(ta.sma(close, 20))')
    const v = await screen.findByTestId('import-outcome')
    expect(v.dataset.outcome).toBe('exact')
  })

  it('PARTIAL names the missing plot', async () => {
    render(<ImportBox onPick={vi.fn()} />)
    paste('def a = Average(close, 20);\nplot P1 = a;\nplot P2 = MACD(12, 26, 9).Value;')
    const v = await screen.findByTestId('import-outcome')
    expect(v.dataset.outcome).toBe('partial')
    expect(v.textContent).toMatch(/not imported: P2/)
  })

  it('a SEMANTIC difference is visible with no toggle pressed; presentation stays collapsed', async () => {
    render(<ImportBox onPick={vi.fn()} />)
    paste('declare lower;\nplot e = ExpAverage(close, 9);\ne.SetDefaultColor(Color.RED);')
    const v = await screen.findByTestId('import-outcome')
    expect(v.dataset.outcome).toBe('disclosed')
    const sem = screen.getByTestId('import-semantic-notes')
    expect(sem.textContent).toMatch(/thinkorswim/)
    // the collapsed list holds only the non-semantic lines, and is still collapsed
    expect(screen.queryByTestId('pine-notes')).toBeNull()
    expect(screen.getByTestId('pine-notes-toggle').textContent).toMatch(/Show 2 lines/)
  })

  it('a foreign language is named, not refused as TC2000', async () => {
    render(<ImportBox onPick={vi.fn()} />)
    paste('Inputs: Len(20);\nVars: Avg(0);\nAvg = Average(Close, Len);\nPlot1(Avg, "Avg");')
    const v = await screen.findByTestId('import-outcome')
    expect(v.dataset.outcome).toBe('unsupported')
    expect(v.textContent).toMatch(/EasyLanguage/)
    expect(screen.getByTestId('pine-refusal').dataset.guard).toBe('language')
  })

  it('the once-throwing corpus script yields a verdict instead of a frozen box', async () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), '..',
      'corpus/committed/smart-money-breakouts-chartprime__ea79c79a67.pine'), 'utf8')
    render(<ImportBox onPick={vi.fn()} />)
    paste(src)
    const v = await screen.findByTestId('import-outcome', {}, { timeout: 5000 })
    expect(v.dataset.outcome).toBe('unsupported')
  })
})
