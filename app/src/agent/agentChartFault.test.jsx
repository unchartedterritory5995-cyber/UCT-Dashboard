// A board chart's adapter dies with it at its error boundary: the receipt, the words and "undo" all have to agree there is no
// way back. (Multi Chart cells keep their Undo: agentMultiChartMode.test.jsx.) Through the REAL panel; the fault is reported as a
// boundary reports it, the chart then gone from the host as it is once React has unmounted it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { noteChartFault } from '../pages/charts/chartFaults'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const ONE = () => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: bareSettings() } }], { 'N:c': 'SPY' }]
const transcript = () => screen.getByTestId('agent-transcript').textContent
const tfOf = (board) => board.state.widgets.find(w => w.id === 'c').opts?.tf || 'D'

describe('a board chart lost to its error boundary', () => {
  it('the receipt fails, Undo goes from the card and from the stack, and "undo" says there is nothing to take back', async () => {
    const { say, board, h } = p.mount(...ONE())
    await say('make this chart weekly')
    expect(tfOf(board)).toBe('W')
    const receipt = screen.getAllByTestId('agent-receipt').at(-1)
    expect(receipt.getAttribute('data-undoable')).toBe('true')
    h.charts.read = () => null
    act(() => { noteChartFault('c') })
    await waitFor(() => expect(transcript()).toMatch(/Remove the chart and add it again/))
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt').at(-1).getAttribute('data-status')).toBe('failed'))
    expect(screen.getAllByTestId('agent-receipt').at(-1).getAttribute('data-undoable')).toBe(null)
    const before = transcript()
    await say('undo')
    expect(transcript().slice(before.length)).not.toMatch(/^.*Undid/)
    expect(tfOf(board)).toBe('W')
  }, 30000)
})
