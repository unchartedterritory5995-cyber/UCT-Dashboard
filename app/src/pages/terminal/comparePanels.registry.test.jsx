// RRG / REL / CORR through the REAL grammar, registry and shell Panel: what a member types reaches
// the panel as the props it needs, and the row-command panels get `onRun`/`onRows`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import parseCommand from './parseCommand'
import { applyArgs, argsEcho } from './args'
import { BY_CODE } from './functions'
import { COMMAND_PANELS, PANEL_IMPORTERS } from './panels'

const stubs = vi.hoisted(() => new Map())
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, panelComponent: (name) => stubs.get(name) || null }
})
import { Panel, resolvePanel } from './TerminalShell'

beforeEach(() => { stubs.clear() })

function props(line) {
  const cmd = parseCommand(line)
  expect(cmd.ok, line).toBe(true)
  const fn = BY_CODE[cmd.code]
  return { cmd, applied: applyArgs(cmd.sym ? fn.ticker : fn.market, cmd.args) }
}

describe('the grammar reaches the comparison panels', () => {
  it('NVDA REL AMD SMH 1Y: the security, two comparators and a window, nothing ignored', () => {
    const { cmd, applied } = props('nvda rel amd smh 1y')
    expect(cmd).toMatchObject({ code: 'REL', sym: 'NVDA' })
    expect(applied.props).toEqual({ with0: 'AMD', with1: 'SMH', lookback: '1Y' })
    expect(applied.ignored).toEqual([])
    expect(argsEcho('REL', applied)).toBe('REL: applied ticker AMD, ticker SMH, window 1Y.')
  })

  it('CORR XLK XLE XLU 6M: a bare list reads as the market variant with every name', () => {
    const { cmd, applied } = props('CORR XLK XLE XLU 6M')
    expect(cmd.sym).toBeNull()
    expect(applied.props).toEqual({ with0: 'XLK', with1: 'XLE', with2: 'XLU', lookback: '6M' })
  })

  it('RRG D: the cadence argument, and RRG with a list', () => {
    expect(props('RRG D').applied.props).toEqual({ tf: 'D' })
    expect(props('RRG SMH IGV XBI').applied.props).toEqual({ with0: 'SMH', with1: 'IGV', with2: 'XBI' })
  })

  it('a function code is never swallowed as a comparator, and the echo names what REL takes once', () => {
    const { applied } = props('NVDA REL GP')
    expect(applied.ignored).toEqual(['GP'])
    expect(argsEcho('REL', applied)).toBe(
      'Not applied: "GP" — REL takes a window (1M, 3M, 6M, 1Y, 2Y, YTD) or tickers to compare (NVDA REL AMD SMH).')
    // `$` forces the ticker reading
    expect(props('NVDA REL $GP').applied.props).toEqual({ with0: 'GP' })
  })

  it('every new code resolves to its own panel importer; existing codes are untouched', () => {
    for (const [code, name] of [['RRG', 'Rrg'], ['REL', 'Rel'], ['CORR', 'Corr']]) {
      expect(BY_CODE[code].ticker.panel).toBe(name)
      expect(BY_CODE[code].market.panel).toBe(name)
      expect(PANEL_IMPORTERS[name]).toBeTypeOf('function')
    }
    // control: an older code still parses its own arguments exactly as before
    expect(applyArgs(BY_CODE.GP.ticker, ['W']).props).toEqual({ tf: 'W' })
    expect(resolvePanel({ code: 'RRG', args: ['D'] }, {}, {})).toMatchObject({ state: 'ready', name: 'Rrg', sym: null, props: { tf: 'D' } })
  })
})

describe('the shell hands row-command panels onRun/onRows WITH their props', () => {
  const base = {
    index: 0, focused: true, syms: {}, auth: {}, channel: null, onFocus: () => {}, onChannelMenu: () => {},
    onRows: () => {}, helpProps: {}, onClose: () => {}, onDuplicate: () => {}, onPopout: () => {},
    onBringBack: () => {}, canClose: true, isPhone: false, standalone: false,
  }

  it('RRG gets with0/tf AND onRun; a non-command panel (REL) gets its props and no onRun', async () => {
    const seen = {}
    stubs.set('Rrg', (p) => { seen.Rrg = p; return <div data-testid="stub-rrg" /> })
    stubs.set('Rel', (p) => { seen.Rel = p; return <div data-testid="stub-rel" /> })
    expect(COMMAND_PANELS.has('Rrg')).toBe(true)
    expect(COMMAND_PANELS.has('Move')).toBe(true)
    const onRun = vi.fn()
    render(<Panel {...base} onRun={onRun} panel={{ id: 'p1', code: 'RRG', args: ['XLK', 'D'] }} />)
    await screen.findByTestId('stub-rrg')
    expect(seen.Rrg).toMatchObject({ with0: 'XLK', tf: 'D' })
    expect(seen.Rrg.onRun).toBe(onRun)
    expect(typeof seen.Rrg.onRows).toBe('function')
    render(<Panel {...base} onRun={onRun} index={1} panel={{ id: 'p2', code: 'REL', sym: 'NVDA', args: ['AMD'] }} />)
    await screen.findByTestId('stub-rel')
    expect(seen.Rel).toMatchObject({ sym: 'NVDA', with0: 'AMD' })
    expect(seen.Rel.onRun).toBeUndefined()
  })
})
