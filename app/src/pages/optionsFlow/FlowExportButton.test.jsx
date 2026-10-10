// EXPORT-FLOW: the Options Flow Export door exists only when the server says so.
//
//     cd app && npx vitest run src/pages/optionsFlow/FlowExportButton.test.jsx
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FlowExportButton, { flowExportPath } from './FlowExportButton'

const armed = () => Promise.resolve({ used: 0, cap: 50 })
const dark = () => Promise.resolve(null)

describe('FlowExportButton', () => {
  it('renders nothing while the export door is dark or the plan is free (quota null)', async () => {
    const quotaFn = vi.fn(dark)
    const { container } = render(<FlowExportButton sym="NVDA" quotaFn={quotaFn} />)
    await waitFor(() => expect(quotaFn).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('when armed, Export downloads GET /api/exports/flow/{symbol} as CSV and reports the rows', async () => {
    const downloadFn = vi.fn(() => Promise.resolve({ rows: 1234 }))
    render(<FlowExportButton sym="NVDA" source="stocks" quotaFn={armed} downloadFn={downloadFn} />)
    const btn = await screen.findByRole('button', { name: 'Export' })
    fireEvent.click(btn)
    await screen.findByRole('status')
    expect(downloadFn).toHaveBeenCalledWith('/api/exports/flow/NVDA?source=stocks', { format: 'csv' })
    expect(screen.getByRole('status').textContent).toBe('Exported 1,234 rows of NVDA flow (CSV, latest session).')
  })

  it("a refused export says the server's sentence and that nothing was downloaded", async () => {
    const downloadFn = vi.fn(() => Promise.reject(new Error('Daily export limit reached (50).')))
    render(<FlowExportButton sym="SPX" source="indexes" quotaFn={armed} downloadFn={downloadFn} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Export' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Daily export limit reached (50). Nothing was downloaded.')
    expect(downloadFn).toHaveBeenCalledWith('/api/exports/flow/SPX?source=indexes', { format: 'csv' })
  })

  it('the path encodes the symbol and clamps the source to the two the route accepts', () => {
    expect(flowExportPath('BRK.B', 'stocks')).toBe('/api/exports/flow/BRK.B?source=stocks')
    expect(flowExportPath('A/B', 'wat')).toBe('/api/exports/flow/A%2FB?source=stocks')
  })

  it('the stylesheet keeps the 44px floor and colours status text only with the ink tokens', () => {
    const css = fs.readFileSync(path.join(__dirname, 'FlowExportButton.module.css'), 'utf8')
    expect(css).toMatch(/min-height:\s*var\(--tap-min,\s*44px\)/)
    expect(css).toMatch(/\.ok\s*\{[^}]*color:\s*var\(--success-ink\)/)
    expect(css).toMatch(/\.err\s*\{[^}]*color:\s*var\(--danger-ink\)/)
  })
})
