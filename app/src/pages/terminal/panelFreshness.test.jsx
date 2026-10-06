// V8 — terminal panel freshness badges, wired to TERM-006's FreshnessBadge/freshnessContract.
//
// Rails:
//   * a panel that reports an as-of (via `usePanelFreshness`) renders a `<FreshnessBadge>` in
//     ITS OWN PANEL HEADER, with the authority's own "LIVE" text — never a second spelling;
//   * a panel that reports nothing renders no badge (opt-in, backward-compatible default);
//   * MovePanel renders the badge instead of a raw, un-badged `as_of` string once its data lands.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { usePanelFreshness } from '../../components/terminal/terminalPanel'

// `Panel` resolves a real function code through the real registry (`functions.js`) and renders
// whatever `panelComponent(name)` returns — stub that resolver the same way
// `TerminalShell.test.jsx` does, so `Panel` itself (header, badge wiring) is exercised for real.
const stubs = vi.hoisted(() => new Map())
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, panelComponent: (name) => stubs.get(name) || null }
})

vi.mock('../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../utils/jsonFetcher'
import MovePanel from './panels/MovePanel'
import { Panel } from './TerminalShell'

function basePanelProps(overrides = {}) {
  return {
    index: 0,
    panel: { id: 'p1', code: 'MOVE', sym: 'NVDA' },
    focused: true,
    syms: {},
    auth: {},
    channel: null,
    onFocus: () => {},
    onChannelMenu: () => {},
    onRun: () => {},
    onRows: () => {},
    helpProps: {},
    onClose: () => {},
    onDuplicate: () => {},
    onPopout: () => {},
    onBringBack: () => {},
    canClose: true,
    isPhone: false,
    standalone: false,
    ...overrides,
  }
}

beforeEach(() => { stubs.clear() })

describe('terminal panel freshness (V8)', () => {
  it('a panel that reports an as-of renders a FreshnessBadge in its header with the right text', async () => {
    function ReportingPanel({ sym }) {
      usePanelFreshness({ freshnessClass: 'real_time', asOf: '2026-10-04T12:00:00Z' })
      return <div data-testid="stub-body">body for {sym}</div>
    }
    stubs.set('Move', ReportingPanel)

    render(<Panel {...basePanelProps()} />)

    await screen.findByTestId('stub-body')
    const badgeHost = screen.getByTestId('terminal-panel-freshness-0')
    expect(badgeHost).toBeTruthy()
    // The header renders the authority's OWN "LIVE" vocabulary (`freshnessContract.js`
    // `D1_FRESHNESS_PRESENTATION.real_time.label`) — never a second, panel-invented spelling.
    expect(badgeHost.textContent).toContain('LIVE')
  })

  it('a panel that reports nothing renders no badge', async () => {
    function QuietPanel({ sym }) {
      return <div data-testid="stub-body">body for {sym}</div>
    }
    stubs.set('Move', QuietPanel)

    render(<Panel {...basePanelProps()} />)

    await screen.findByTestId('stub-body')
    expect(screen.queryByTestId('terminal-panel-freshness-0')).toBeNull()
  })

  it('a panel with no sym (needs-ticker; no backing component mounted) renders no badge', () => {
    render(<Panel {...basePanelProps({ panel: { id: 'p1', code: 'MOVE' } })} />)
    expect(screen.queryByTestId('terminal-panel-freshness-0')).toBeNull()
  })

  it('MovePanel renders the FreshnessBadge (via usePanelFreshness) instead of a raw, un-badged as-of string', async () => {
    stubs.set('Move', MovePanel)
    jsonFetcher.mockResolvedValue({
      sym: 'NVDA',
      intelligence: { status: 'ok', facts: [{ kind: 'analyst', label: 'Upgraded to Buy', as_of: '2026-10-01' }] },
      catalysts: [],
      catalyst_status: 'ok',
      since_last_visit: { first_visit: true, new: [] },
    })

    render(<Panel {...basePanelProps()} />)

    await screen.findByTestId('terminal-move')
    // The panel-level freshness badge is in the HEADER, driven by the new mechanism —
    // not a second, ad hoc as-of string bolted onto the panel body.
    const badgeHost = await screen.findByTestId('terminal-panel-freshness-0')
    expect(badgeHost.textContent).toContain('LIVE')
    // The per-fact `as_of` ("2026-10-01") is still honest CONTENT on the row (a filing/analyst
    // action date, not a freshness signal) — it stays plain text, exactly where TERM-006 draws
    // the line between a data class and a value's own dated content.
    expect(screen.getByTestId('terminal-move-facts').textContent).toContain('2026-10-01')
  })

  it('MovePanel reports no freshness while loading or after a failed fetch', async () => {
    stubs.set('Move', MovePanel)
    let resolveFetch
    jsonFetcher.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve }))

    render(<Panel {...basePanelProps()} />)
    expect(screen.queryByTestId('terminal-panel-freshness-0')).toBeNull()

    resolveFetch({ intelligence: { status: 'ok', facts: [] }, catalysts: [], catalyst_status: 'ok',
      since_last_visit: { first_visit: true, new: [] } })
    await screen.findByTestId('terminal-move')
    expect(await screen.findByTestId('terminal-panel-freshness-0')).toBeTruthy()
  })
})
