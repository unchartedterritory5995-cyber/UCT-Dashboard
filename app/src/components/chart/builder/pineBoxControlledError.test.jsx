// P0 0L — a translator THROW reaches the member as a controlled error, is logged,
// and the box keeps answering (it used to freeze silently inside a setTimeout).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('../engine/ast/thinkscript', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    translateThinkScript: (src, opts) => {
      if (String(src).includes('BOOM')) throw new TypeError('synthetic translator fault')
      return real.translateThinkScript(src, opts)
    },
  }
})

import { ImportBox, inspectSource } from './PineBox'

const paste = (text) => fireEvent.change(
  screen.getByLabelText(/^script or formula$/i), { target: { value: text } })

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('controlled error at the import boundary', () => {
  it('inspectSource returns an ERROR verdict instead of throwing', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = inspectSource('def x = close; # BOOM\nplot p = x;')
    expect(r.ok).toBe(false)
    expect(r.outcome.verdict).toBe('error')
    expect(r.refusal.guard).toBe('import:internal-error')
    expect(log).toHaveBeenCalled()
  })

  it('the box shows the failure, and answers the next paste', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ImportBox onPick={vi.fn()} />)
    paste('def x = close; # BOOM\nplot p = x;')
    const v = await screen.findByTestId('import-outcome')
    expect(v.dataset.outcome).toBe('error')
    expect(screen.getByTestId('pine-refusal').dataset.guard).toBe('import:internal-error')
    expect(screen.getByTestId('pine-use')).toBeDisabled()
    paste('plot p = Average(close, 20);')
    await vi.waitFor(() => expect(screen.getByTestId('import-outcome').dataset.outcome).toBe('exact'))
  })
})
