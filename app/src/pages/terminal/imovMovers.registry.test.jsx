// IMOV and the MOVERS alias through the REAL grammar, registry and shell Panel: what a member types
// reaches the panel as the props it needs, and an alias is one function under a second spelling.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import parseCommand, { formatCommand } from './parseCommand'
import { applyArgs, argsEcho } from './args'
import { BY_CODE, CODE_ALIASES, FUNCTIONS, aliasesOf, canonicalCode, isCode, suggest } from './functions'
import { aliasNameRefusal } from './grammar'
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

describe('IMOV through the grammar', () => {
  it('IMOV 1W: market-wide with a window; NVDA IMOV 3M: the security and a window; nothing ignored', () => {
    const a = props('imov 1w')
    expect(a.cmd).toMatchObject({ code: 'IMOV', sym: null })
    expect(a.applied.props).toEqual({ win: '1W' })
    const b = props('NVDA IMOV 3M')
    expect(b.cmd).toMatchObject({ code: 'IMOV', sym: 'NVDA' })
    expect(b.applied).toMatchObject({ props: { win: '3M' }, ignored: [] })
    expect(props('IMOV SMH').cmd).toMatchObject({ code: 'IMOV', sym: 'SMH' })
  })

  it('a window IMOV does not offer is echoed as not applied, never dropped', () => {
    const { applied } = props('IMOV 1Y')
    expect(applied.ignored).toEqual(['1Y'])
    expect(argsEcho('IMOV', applied)).toBe(
      'Not applied: "1Y" — IMOV takes a window (1D, 1W, 1M, 3M) or a theme name (IMOV SEMICONDUCTORS).')
  })

  it('a theme can be NAMED: one long word, a quoted multi-word name, or the THEME marker the panel writes', () => {
    expect(props('IMOV semiconductors')).toMatchObject({ cmd: { sym: null }, applied: { props: { theme: 'SEMICONDUCTORS' }, ignored: [] } })
    expect(props('IMOV "AI / GPU Chips"')).toMatchObject({ cmd: { sym: null }, applied: { props: { theme: 'AI / GPU CHIPS' } } })
    expect(props('imov ai / gpu chips 1w')).toMatchObject({ cmd: { sym: null }, applied: { props: { theme: 'AI / GPU CHIPS', win: '1W' } } })
    expect(props('IMOV THEME SEMIS')).toMatchObject({ cmd: { sym: null }, applied: { props: { theme: 'SEMIS' } } })
    expect(props('NVDA IMOV semis')).toMatchObject({ cmd: { sym: 'NVDA' }, applied: { props: { theme: 'SEMIS' } } })
    expect(argsEcho('IMOV', props('IMOV semiconductors').applied)).toBe('IMOV: applied theme "SEMICONDUCTORS".')
    // ONE free word is still a ticker, so the established grammar holds; `$` forces it too.
    expect(props('IMOV NVDA 1W')).toMatchObject({ cmd: { sym: 'NVDA' }, applied: { props: { win: '1W' } } })
    expect(props('IMOV SMH').applied.props).toEqual({})
    expect(props('IMOV $AI').cmd).toMatchObject({ sym: 'AI', args: [] })
    // A bare marker names nothing and is said to be not applied.
    expect(props('IMOV THEME').applied.ignored).toEqual(['THEME'])
  })

  it('the marker in the registry is the one args.js names', async () => {
    const { THEME_MARKER } = await import('./args')
    expect(BY_CODE.IMOV.market.args.find((s) => s.rest)).toMatchObject({ kind: 'themeName', prop: 'theme', marker: THEME_MARKER })
    expect(BY_CODE.IMOV.ticker.args.find((s) => s.rest)).toMatchObject({ marker: THEME_MARKER })
    expect(resolvePanel({ code: 'IMOV', args: ['THEME', 'AI_SOFTWARE', '1W'] }, {}, {}))
      .toMatchObject({ state: 'ready', name: 'Imov', props: { theme: 'AI_SOFTWARE', win: '1W' } })
  })

  it('resolves to the Imov panel either way, and is a row-command panel (onRun / onRows)', () => {
    expect(BY_CODE.IMOV.ticker.panel).toBe('Imov')
    expect(BY_CODE.IMOV.market.panel).toBe('Imov')
    expect(PANEL_IMPORTERS.Imov).toBeTypeOf('function')
    expect(COMMAND_PANELS.has('Imov')).toBe(true)
    expect(resolvePanel({ code: 'IMOV', args: ['1M'] }, {}, {})).toMatchObject({ state: 'ready', name: 'Imov', sym: null, props: { win: '1M' } })
    expect(resolvePanel({ code: 'IMOV', sym: 'NVDA', args: [] }, {}, {})).toMatchObject({ state: 'ready', name: 'Imov', sym: 'NVDA' })
  })

  it('the shell hands IMOV its security, its window AND onRun / onRows', async () => {
    const seen = {}
    stubs.set('Imov', (p) => { seen.Imov = p; return <div data-testid="stub-imov" /> })
    const onRun = vi.fn()
    render(<Panel index={0} focused syms={{}} auth={{}} channel={null} onFocus={() => {}} onChannelMenu={() => {}}
      onRows={() => {}} helpProps={{}} onClose={() => {}} onDuplicate={() => {}} onPopout={() => {}} onBringBack={() => {}}
      canClose isPhone={false} standalone={false} onRun={onRun}
      panel={{ id: 'p1', code: 'IMOV', sym: 'NVDA', args: ['1W'] }} />)
    await screen.findByTestId('stub-imov')
    expect(seen.Imov).toMatchObject({ sym: 'NVDA', win: '1W' })
    // `here` re-runs a command in this panel's own slot (IMOV writing a picked theme into its args).
    seen.Imov.onRun('NVDA IMOV THEME SEMICONDUCTORS', { here: true })
    expect(onRun).toHaveBeenLastCalledWith('NVDA IMOV THEME SEMICONDUCTORS', { here: true, slot: 1 })
    seen.Imov.onRun('$AMD', { keepFunction: true })
    expect(onRun).toHaveBeenLastCalledWith('$AMD', { keepFunction: true })
    expect(typeof seen.Imov.onRows).toBe('function')
  })
})

describe('MOVERS is another name for MOST', () => {
  it('parses to MOST itself, lens and all, so the panel, its URL and its history say MOST', () => {
    const { cmd, applied } = props('movers up')
    expect(cmd).toMatchObject({ ok: true, type: 'function', code: 'MOST', sym: null, args: ['UP'] })
    expect(applied.props).toEqual({ lens: 'up' })
    expect(formatCommand(cmd)).toBe('MOST UP')
    expect(props('MOVERS').cmd.code).toBe('MOST')
    expect(resolvePanel({ code: parseCommand('MOVERS RVOL').code, args: ['RVOL'] }, {}, {}))
      .toMatchObject({ state: 'ready', name: 'Movers', props: { lens: 'volume' } })
  })

  it('HELP MOVERS focuses MOST, and HELP shows the alias beside its code', () => {
    const cmd = parseCommand('HELP MOVERS')
    expect(applyArgs(BY_CODE.HELP.market, cmd.args).props).toEqual({ focusCode: 'MOST' })
    expect(aliasesOf('MOST')).toEqual(['MOVERS'])
  })

  it('the registry knows the spelling, but it is not a second function', () => {
    expect(isCode('movers')).toBe(true)
    expect(canonicalCode('movers')).toBe('MOST')
    expect(canonicalCode('GP')).toBe('GP')
    expect(BY_CODE.MOVERS).toBe(BY_CODE.MOST)
    expect(FUNCTIONS.map((f) => f.code)).not.toContain('MOVERS')
    // every alias points at a registered code, and no alias is also a code (it would shadow it)
    for (const [alias, code] of Object.entries(CODE_ALIASES)) {
      expect(FUNCTIONS.some((f) => f.code === code), alias).toBe(true)
      expect(FUNCTIONS.some((f) => f.code === alias), alias).toBe(false)
    }
  })

  it('a member alias may not shadow it, a near miss suggests it, and $MOVERS is still a ticker', () => {
    expect(aliasNameRefusal('MOVERS')).toMatch(/already a function \(Market movers/)
    expect(suggest('MOVER')).toContain('MOVERS')
    expect(parseCommand('$MOVERS')).toMatchObject({ ok: true, code: 'DES', sym: 'MOVERS' })
  })
})
