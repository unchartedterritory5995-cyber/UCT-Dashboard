// `NVDA STOCK` on the command line, BEFORE Enter: the echo says which stock board opens and for
// which ticker, and a ticker the search does not know is named there too (a stock board opens
// four panels at once, so a mistyped ticker should not be found out afterwards). The parse itself
// is railed in stockBoards.test.js; what Enter does is TerminalShell.stockBoards.test.jsx.
//
//     cd app && npx vitest run src/pages/terminal/CommandLine.stockBoard.test.jsx --maxWorkers=2
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import CommandLine, { echoFor } from './CommandLine'
import { STOCK_BOARDS, defaultStockBoard } from './stockBoards'

function tickerSearch(rows) {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith('/api/ticker-search')) {
      const q = new URL(u, 'http://x').searchParams.get('q').toUpperCase()
      return { ok: true, status: 200, json: async () => ({ results: rows(q) }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

const input = () => screen.getByTestId('terminal-command')
const typeText = (v) => fireEvent.change(input(), { target: { value: v } })
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

beforeEach(() => {
  try { window.localStorage.clear() } catch { /* */ }
  tickerSearch(() => [])
})
afterEach(() => cleanup())

describe('the echo for a stock board', () => {
  it('names the board, its codes and the ticker, exactly as Enter will open it', () => {
    const b = defaultStockBoard()
    expect(echoFor('NVDA STOCK')).toMatchObject({ tone: 'ok', text: `Open the stock board ${b.name} (${b.codes.join(', ')}) for NVDA, in one color group` })
    const second = STOCK_BOARDS[1]
    expect(echoFor(`nvda stock ${second.word.toLowerCase()}`).text).toContain(`${second.name} (${second.codes.join(', ')}) for NVDA`)
    expect(echoFor('STOCK').text).toContain('for the ticker your board is on')
    expect(echoFor('NVDA STOCK SIDEWAYS')).toMatchObject({ tone: 'error' })
  })

  it('submits the line as typed (the shell opens the board; the command line adds nothing)', () => {
    const onSubmit = vi.fn()
    render(<CommandLine onSubmit={onSubmit} />)
    typeText('NVDA STOCK')
    expect(screen.getByTestId('terminal-echo')).toHaveTextContent(`Open the stock board ${defaultStockBoard().name}`)
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toBe('NVDA STOCK')
  })

  it('a ticker the search does not know is named before Enter, with a close spelling when there is one', async () => {
    tickerSearch((q) => (q.startsWith('NVDI') ? [{ ticker: 'NVDA', name: 'NVIDIA' }] : []))
    render(<CommandLine onSubmit={() => {}} />)
    typeText('NVDIA STOCK')
    await wait(320)
    const echo = screen.getByTestId('terminal-echo')
    expect(echo).toHaveTextContent('NVDIA is not a ticker we know — did you mean NVDA?')
    expect(echo.dataset.tone).toBe('warn')
    typeText('ZZZZQ STOCK')
    await wait(320)
    expect(screen.getByTestId('terminal-echo')).toHaveTextContent('ZZZZQ is not a ticker we know')
  })

  it('a known ticker gets no warning, and a bare STOCK asks the search nothing', async () => {
    tickerSearch((q) => (q === 'MSFT' ? [{ ticker: 'MSFT', name: 'Microsoft' }] : []))
    render(<CommandLine onSubmit={() => {}} />)
    typeText('MSFT STOCK')
    await wait(320)
    expect(screen.getByTestId('terminal-echo')).not.toHaveTextContent('not a ticker we know')
    expect(screen.getByTestId('terminal-echo').dataset.tone).toBe('ok')
    typeText('STOCK')
    await wait(320)
    expect(screen.getByTestId('terminal-echo')).not.toHaveTextContent('not a ticker we know')
  })
})
