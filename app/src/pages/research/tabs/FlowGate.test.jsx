// Audit 2026-10-08 (FLOW P1): `NVDA FLOW` with the per-ticker flow switch off was refused outright.
// The terminal now opens FlowGate, which says so in words and offers the page doors that exist.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BY_CODE, flagOn } from '../../terminal/functions'
import { PANEL_IMPORTERS } from '../../terminal/panels'

let auth = {}
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('./FlowTab', () => ({ default: ({ sym }) => <div data-testid="flow-tab">flow {sym}</div> }))
// eslint-disable-next-line import/first
import FlowGate from './FlowGate'

afterEach(() => { cleanup(); auth = {} })

describe('FLOW with the per-ticker switch off', () => {
  it('the registry no longer refuses NVDA FLOW at the shell', () => {
    const v = BY_CODE.FLOW.ticker
    expect(String(PANEL_IMPORTERS[v.panel])).toMatch(/FlowGate/)
    expect(flagOn({ researchFlowTabEnabled: false }, v.flag)).toBe(true)
  })

  it('off: says so and links Options Flow and this ticker\'s GEX view', () => {
    auth = { researchFlowTabEnabled: false }
    render(<MemoryRouter><FlowGate sym="nvda" /></MemoryRouter>)
    const box = screen.getByTestId('flow-gate-off')
    expect(box.textContent).toMatch(/per-ticker flow view for NVDA isn't switched on/)
    const links = [...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/options-flow', '/options-flow?view=gex&ticker=NVDA'])
    expect(screen.queryByTestId('flow-tab')).toBeNull()
  })

  it('on: it is the flow tab', () => {
    auth = { researchFlowTabEnabled: true }
    render(<MemoryRouter><FlowGate sym="NVDA" /></MemoryRouter>)
    expect(screen.getByTestId('flow-tab').textContent).toBe('flow NVDA')
  })
})
