// Wave 3 (#2): the panel FRAME places the security headline, once, on every panel that shows a
// security — no panel carries its own copy, and a market-wide panel gets none.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../hooks/useBreakpoint', () => ({ useIsPhone: () => false }))
vi.mock('../../components/mobile', () => ({ FiltersSheet: () => null }))
vi.mock('../../components/terminal/SecurityHeadline', () => ({
  default: ({ sym }) => <div data-testid="headline-stub" data-sym={sym} />,
}))
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, panelComponent: () => function Stub() { return <div data-testid="panel-stub" /> } }
})

import { Panel } from './TerminalShell'

afterEach(cleanup)

function renderPanel(panel) {
  return render(
    <MemoryRouter>
      <Panel index={0} panel={{ id: 'p1', args: [], ...panel }} focused syms={{}} auth={{}} channel={null}
        onFocus={() => {}} onChannelMenu={() => {}} onRun={() => {}} helpProps={{}} canClose isPhone={false}
        onClose={() => {}} onDuplicate={() => {}} onPopout={() => {}} onBringBack={() => {}} />
    </MemoryRouter>,
  )
}

describe('the panel frame draws the security headline', () => {
  it.each(['DES', 'CN', 'GP'])('%s on a ticker carries exactly one headline for it', (code) => {
    renderPanel({ code, sym: 'NVDA' })
    const strips = screen.getAllByTestId('headline-stub')
    expect(strips).toHaveLength(1)
    expect(strips[0].getAttribute('data-sym')).toBe('NVDA')
  })

  it('a market-wide panel (no security) has no headline', () => {
    renderPanel({ code: 'CAL' })
    expect(screen.queryByTestId('headline-stub')).toBeNull()
  })

  it('a popped-out panel has no headline', () => {
    renderPanel({ code: 'DES', sym: 'NVDA', popout: true })
    expect(screen.queryByTestId('headline-stub')).toBeNull()
  })
})
