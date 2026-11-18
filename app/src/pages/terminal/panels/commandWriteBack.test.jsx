// commandWriteBack: a chip writes its choice into its panel's command only when the registry takes
// it. Rails:
//   * the command is built only when the code's market variant applies every token;
//   * a token the variant does not take, an unknown code and a code with no market variant give null;
//   * the hook re-runs in the panel's own slot, and is a no-op outside the shell.
//   * a per-stock panel passes its security: the TICKER variant is asked, and the command is
//     `SYM CODE TOKEN`; a market-only code given a security gives null.
// The registered codes used here are existing ones (THMS takes a window, INS takes nothing, GP is
// per-stock and takes a timeframe, MYH is per-stock and takes a Journal account).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import { usePanelWriteBack, writeBackCommand } from './commandWriteBack'

afterEach(cleanup)

function Probe({ tokens, sym }) {
  const writeBack = usePanelWriteBack()
  return <button type="button" onClick={(e) => { e.currentTarget.dataset.wrote = String(sym === undefined ? writeBack(tokens) : writeBack(tokens, sym)) }}>write</button>
}
function renderProbe(tokens, { code = 'THMS', rerun = vi.fn(), shell = true, sym = undefined } = {}) {
  const ui = <Probe tokens={tokens} sym={sym} />
  render(shell
    ? (
      <PanelListContext.Provider value={{ rerun, run: vi.fn(), open: vi.fn() }}>
        <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{ui}</TerminalPanelContext.Provider>
      </PanelListContext.Provider>
    )
    : ui)
  return { rerun, button: screen.getByRole('button', { name: 'write' }) }
}

describe('writeBackCommand (pure)', () => {
  it('builds the command when the registry applies every token', () => {
    expect(writeBackCommand('THMS', ['1W'])).toBe('THMS 1W')
    expect(writeBackCommand('thms', [' 1M '])).toBe('THMS 1M')
    expect(writeBackCommand('MOST', ['UP'])).toBe('MOST UP')
  })

  it('no tokens is the bare command, and blank tokens are dropped', () => {
    expect(writeBackCommand('THMS', [])).toBe('THMS')
    expect(writeBackCommand('THMS', [null, '', '  '])).toBe('THMS')
    expect(writeBackCommand('INS')).toBe('INS')
  })

  it('a token the variant does not take gives null, never a command that would not apply', () => {
    expect(writeBackCommand('THMS', ['BOGUS'])).toBeNull()
    expect(writeBackCommand('THMS', ['1W', 'LOWS'])).toBeNull()
    expect(writeBackCommand('INS', ['1W'])).toBeNull()
  })

  it('an unknown code, an empty code and a code that needs a ticker give null', () => {
    expect(writeBackCommand('NOTACODE', [])).toBeNull()
    expect(writeBackCommand('', ['1W'])).toBeNull()
    expect(writeBackCommand(null, [])).toBeNull()
    expect(writeBackCommand('DES', [])).toBeNull()
  })

  it('with a security, a per-stock code writes `SYM CODE TOKEN` from its ticker variant', () => {
    expect(writeBackCommand('MYH', ['2'], 'NVDA')).toBe('NVDA MYH 2')
    expect(writeBackCommand('myh', ['ALL'], ' nvda ')).toBe('NVDA MYH ALL')
    expect(writeBackCommand('MYH', [], 'NVDA')).toBe('NVDA MYH')
    expect(writeBackCommand('GP', ['W'], 'AMD')).toBe('AMD GP W')
    // a token the ticker variant does not take, and a per-stock code with no security, still give null
    expect(writeBackCommand('MYH', ['BOGUS'], 'NVDA')).toBeNull()
    expect(writeBackCommand('MYH', ['2'])).toBeNull()
    expect(writeBackCommand('MYH', ['2'], '')).toBeNull()
    // a market-only code is never written with a security in front of it
    expect(writeBackCommand('THMS', ['1W'], 'NVDA')).toBeNull()
    expect(writeBackCommand('PERF', ['2'], 'NVDA')).toBeNull()
    expect(writeBackCommand('PERF', ['2'])).toBe('PERF 2')
  })
})

describe('usePanelWriteBack', () => {
  it('re-runs the panel\'s own command and says it did', () => {
    const { rerun, button } = renderProbe(['1W'])
    fireEvent.click(button)
    expect(rerun).toHaveBeenCalledWith('THMS 1W')
    expect(button.dataset.wrote).toBe('true')
  })

  it('does nothing when the registry does not take the tokens', () => {
    const { rerun, button } = renderProbe(['LOWS'])
    fireEvent.click(button)
    expect(rerun).not.toHaveBeenCalled()
    expect(button.dataset.wrote).toBe('false')
  })

  it('is a no-op outside the shell', () => {
    const { button } = renderProbe(['1W'], { shell: false })
    fireEvent.click(button)
    expect(button.dataset.wrote).toBe('false')
  })

  it('a per-stock panel re-runs its command with its security', () => {
    const { rerun, button } = renderProbe(['ALL'], { code: 'MYH', sym: 'NVDA' })
    fireEvent.click(button)
    expect(rerun).toHaveBeenCalledWith('NVDA MYH ALL')
    expect(button.dataset.wrote).toBe('true')
    cleanup()
    const bare = renderProbe(['ALL'], { code: 'MYH' })
    fireEvent.click(bare.button)
    expect(bare.rerun).not.toHaveBeenCalled()
    expect(bare.button.dataset.wrote).toBe('false')
  })
})
