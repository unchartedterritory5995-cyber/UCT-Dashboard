// The command line itself (2026-10-05 shell audit, round 2): history walks both ways, a `$`
// survives Tab, Esc clears, the echo agrees with Enter, the combobox names its active option,
// the echo is announced on a pause (not per keystroke), and an unknown ticker gets a
// "did you mean" from the ticker search the line already uses.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import CommandLine, {
  HISTORY_KEY, ECHO_ANNOUNCE_MS, acceptSuggestion, didYouMean, echoFor, registrySuggestions,
} from './CommandLine'

function tickerSearch(rows) {
  global.fetch = vi.fn(async (url) => {
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
const key = (k) => fireEvent.keyDown(input(), { key: k })
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

beforeEach(() => {
  try { window.localStorage.clear() } catch { /* */ }
  tickerSearch(() => [])
})
afterEach(() => cleanup())

describe('pure helpers', () => {
  it('#7: a `$` token never completes to a function code, and accepting keeps the `$`', () => {
    const rows = registrySuggestions('$CF', { tickers: [{ value: 'CF', label: 'CF Industries' }] })
    expect(rows.map((s) => `${s.kind}:${s.value}`)).toEqual(['ticker:CF'])
    expect(acceptSuggestion('$CF', rows[0])).toBe('$CF ')
    expect(acceptSuggestion('NVDA G', { kind: 'function', value: 'GP' })).toBe('NVDA GP ')
    // a plain token still offers the code first
    expect(registrySuggestions('CF', { tickers: [{ value: 'CF', label: 'CF Industries' }] })[0])
      .toMatchObject({ kind: 'function', value: 'CF' })
  })

  it('ticker suggestions reach the SECOND token after a security code (GP NV…)', () => {
    const t = [{ value: 'NVDA', label: 'NVIDIA' }]
    expect(registrySuggestions('GP NV', { tickers: t }).some((s) => s.kind === 'ticker' && s.value === 'NVDA')).toBe(true)
    // …but not after a market-only code (CAL takes no security)
    expect(registrySuggestions('CAL NV', { tickers: t }).some((s) => s.kind === 'ticker')).toBe(false)
  })

  it('#18: the echo recognises a B:board address, and validates arguments like Enter does', () => {
    expect(echoFor('B:my-board')).toMatchObject({ tone: 'ok', text: 'Open your board B:my-board' })
    const e = echoFor('NVDA GP X')
    expect(e.tone).toBe('warn')
    expect(e.text).toMatch(/Not applied: "X"/)
    expect(echoFor('NVDA GP W').tone).toBe('ok')
  })

  it('#9: a market-wide code given a ticker says the ticker is ignored, before Enter', () => {
    const e = echoFor('NVDA DASH')
    expect(e.tone).toBe('warn')
    expect(e.text).toMatch(/DASH is market-wide; NVDA is ignored/)
    expect(e.text).not.toMatch(/on NVDA/)
  })

  it('#21: `GP W` echoes W as the timeframe and names the $ escape', () => {
    expect(echoFor('GP W').text).toMatch(/W is read as GP's argument; type \$W for the ticker/)
  })

  it('did-you-mean picks a close spelling only when the search has no exact match', () => {
    expect(didYouMean('NVDIA', [{ ticker: 'NVDA' }, { ticker: 'NVDL' }])).toBe('NVDA')
    expect(didYouMean('NVDA', [{ ticker: 'NVDA' }])).toBeNull()
    expect(didYouMean('BRK-B', [{ ticker: 'BRK.B' }])).toBeNull()
    expect(didYouMean('ZZZZZ', [{ ticker: 'AAPL' }])).toBeNull()
  })
})

describe('the rendered command line', () => {
  it('#17: ↑ walks back through history and ↓ walks forward again, to what was being typed', () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(['C3', 'B2', 'A1']))
    render(<CommandLine onSubmit={() => {}} />)
    typeText('draft')
    key('ArrowUp'); expect(input().value).toBe('C3')
    key('ArrowUp'); expect(input().value).toBe('B2')
    key('ArrowUp'); expect(input().value).toBe('A1')
    key('ArrowDown'); expect(input().value).toBe('B2')
    key('ArrowDown'); expect(input().value).toBe('C3')
    key('ArrowDown'); expect(input().value).toBe('draft')
  })

  it('Esc closes the list first, then clears a non-empty line', async () => {
    render(<CommandLine onSubmit={() => {}} />)
    act(() => { input().focus() })
    typeText('GP')
    expect(screen.getByTestId('terminal-suggestions')).toBeTruthy()
    key('Escape')
    expect(screen.queryByTestId('terminal-suggestions')).toBeNull()
    expect(input().value).toBe('GP')
    key('Escape')
    expect(input().value).toBe('')
  })

  it('#7: Tab on `$CF` keeps the ticker — it does not become the CF function', async () => {
    tickerSearch((q) => (q === 'CF' ? [{ ticker: 'CF', name: 'CF Industries' }] : []))
    render(<CommandLine onSubmit={() => {}} />)
    act(() => { input().focus() })
    typeText('$CF')
    await wait(220)
    key('Tab')
    expect(input().value).toBe('$CF ')
  })

  it('#24: the combobox names its highlighted option (aria-activedescendant ↔ option id)', () => {
    render(<CommandLine onSubmit={() => {}} />)
    act(() => { input().focus() })
    typeText('G')
    expect(input().getAttribute('aria-activedescendant')).toBeNull()
    key('ArrowDown')
    const id = input().getAttribute('aria-activedescendant')
    expect(id).toBeTruthy()
    const opt = document.getElementById(id)
    expect(opt.getAttribute('role')).toBe('option')
    expect(opt.getAttribute('aria-selected')).toBe('true')
  })

  it('#24: the echo is announced once typing PAUSES, not on every keystroke', async () => {
    render(<CommandLine onSubmit={() => {}} />)
    const live = screen.getByTestId('terminal-echo-announce')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(screen.getByTestId('terminal-echo').getAttribute('aria-live')).toBeNull()
    typeText('N'); typeText('NV'); typeText('NVDA')
    expect(live.textContent).toBe('')
    await wait(ECHO_ANNOUNCE_MS + 60)
    expect(live.textContent).toMatch(/DES: .* on NVDA/)
  })

  it('an unknown ticker gets "did you mean" from the ticker search, before Enter', async () => {
    tickerSearch((q) => (q.startsWith('NVDI') ? [{ ticker: 'NVDA', name: 'NVIDIA' }] : []))
    render(<CommandLine onSubmit={() => {}} />)
    typeText('NVDIA GP')
    await wait(320)
    const echo = screen.getByTestId('terminal-echo')
    expect(echo).toHaveTextContent('NVDIA is not a ticker we know — did you mean NVDA?')
    expect(echo.dataset.tone).toBe('warn')
  })
})
