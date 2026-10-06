// The command line itself (2026-10-05 shell audit, round 2): history walks both ways, a `$`
// survives Tab, Esc clears, the echo agrees with Enter, the combobox names its active option,
// the echo is announced on a pause (not per keystroke), and an unknown ticker gets a
// "did you mean" from the ticker search the line already uses.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import CommandLine, {
  HISTORY_KEY, ECHO_ANNOUNCE_MS, acceptSuggestion, didYouMean, echoFor, registrySuggestions,
} from './CommandLine'
import { rankCandidates } from './ranking'

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

describe('shell audit round 3 (2026-10-05): the echo before Enter', () => {
  it('a market-wide code never tells the member to type $TODAY "for the ticker" — it takes no ticker', () => {
    for (const line of ['CAL TODAY', 'CAL NEXT', 'CAL PREV']) {
      const e = echoFor(line)
      expect(e.text, line).not.toMatch(/for the ticker/)
      expect(e.text, line).not.toMatch(/\$TODAY|\$NEXT|\$PREV/)
    }
    // …while a code that DOES take a ticker still names the escape.
    expect(echoFor('GP W').text).toMatch(/type \$W for the ticker/)
  })

  it('HELP with a word that is not a function says so before Enter, as Enter does', () => {
    const e = echoFor('HELP FOO')
    expect(e.tone).toBe('warn')
    expect(e.text).toMatch(/Not applied: "FOO"/)
    expect(echoFor('HELP GP').tone).toBe('ok')
  })

  it('an unknown function names the next step even when no close spelling exists', () => {
    const e = echoFor('NVDA QQQQQQ')
    expect(e.tone).toBe('error')
    expect(e.text).toMatch(/Unknown function "QQQQQQ" for NVDA/)
    expect(e.text).toMatch(/HELP/)
  })

  it('B:<name> for a board the member does not have says so before Enter', () => {
    render(<CommandLine onSubmit={() => {}} boards={[{ id: 'b1', slug: 'mine', name: 'Mine' }]} />)
    typeText('B:nope')
    expect(screen.getByTestId('terminal-echo')).toHaveTextContent('No board at B:nope. Open Boards to see yours.')
    expect(screen.getByTestId('terminal-echo').dataset.tone).toBe('error')
    typeText('B:mine')
    expect(screen.getByTestId('terminal-echo')).toHaveTextContent('Open your board Mine (B:mine)')
  })

  it('a ticker the search does not know at all is named before Enter (no silent DES)', async () => {
    tickerSearch(() => [])
    render(<CommandLine onSubmit={() => {}} />)
    typeText('ZZZZQ DES')
    await wait(320)
    const echo = screen.getByTestId('terminal-echo')
    expect(echo).toHaveTextContent('ZZZZQ is not a ticker we know')
    expect(echo).toHaveTextContent(/check the spelling/i)
    expect(echo.dataset.tone).toBe('warn')
  })

  it('a known ticker gets no warning (the exact symbol is in the answer)', async () => {
    tickerSearch((q) => (q === 'MSFT' ? [{ ticker: 'MSFT', name: 'Microsoft' }] : []))
    render(<CommandLine onSubmit={() => {}} />)
    typeText('MSFT DES')
    await wait(320)
    expect(screen.getByTestId('terminal-echo')).not.toHaveTextContent('not a ticker we know')
  })

  it('race: pausing on the ticker then typing on does not lose the "did you mean" (shared request aborted)', async () => {
    // A fetch that honours its AbortSignal, like the browser's.
    global.fetch = vi.fn((url, init) => new Promise((resolve, reject) => {
      const q = new URL(String(url), 'http://x').searchParams.get('q').toUpperCase()
      const t = setTimeout(() => resolve({ ok: true, status: 200,
        json: async () => ({ results: q.startsWith('NVDQ') ? [{ ticker: 'NVDA', name: 'NVIDIA' }] : [] }) }), 400)
      init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
    }))
    render(<CommandLine onSubmit={() => {}} />)
    typeText('NVDQ')
    await wait(300)          // completion asked at 150 ms; the echo joined that request at 250 ms
    typeText('NVDQ GP')      // …and the completion's request is cancelled here
    await wait(900)
    expect(screen.getByTestId('terminal-echo')).toHaveTextContent('did you mean NVDA?')
  })

  it('a slower, earlier ticker answer never replaces the list for what is typed now', async () => {
    global.fetch = vi.fn((url) => new Promise((resolve) => {
      const q = new URL(String(url), 'http://x').searchParams.get('q').toUpperCase()
      const rows = q === 'AM' ? [{ ticker: 'AMAT' }, { ticker: 'AMD' }] : [{ ticker: 'AMZN' }]
      setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({ results: rows }) }), q === 'AM' ? 400 : 20)
    }))
    render(<CommandLine onSubmit={() => {}} />)
    act(() => { input().focus() })
    typeText('AM')
    await wait(200)          // the slow "AM" request is in flight…
    typeText('AMZ')
    await wait(700)          // …the fast "AMZ" one lands, then the slow one would
    const rows = [...screen.getByTestId('terminal-suggestions').querySelectorAll('li')].map((li) => li.textContent)
    expect(rows.some((r) => r.startsWith('AMZN'))).toBe(true)
    expect(rows.some((r) => r.startsWith('AMAT'))).toBe(false)
  })

  it('Enter on a highlighted suggestion fills it in; Enter again runs the line', async () => {
    const ran = []
    render(<CommandLine onSubmit={(v) => ran.push(v)} />)
    act(() => { input().focus() })
    typeText('NVDA G')
    key('ArrowDown')
    key('Enter')
    expect(ran).toEqual([])
    expect(input().value).toMatch(/^NVDA G\S* $/)
    key('Enter')
    expect(ran).toHaveLength(1)
    expect(input().value).toBe('')
  })
})

describe('live audit: the ticker list leads with the names members trade', () => {
  // The search's own order for "NV" (measured on production 2026-10-05): NVDA was 16th.
  const NV = ['NVA', 'NVC', 'NVD', 'NVG', 'NVO', 'NVR', 'NVS', 'NVT', 'NVX', 'NVAX', 'NVBT', 'NVBU',
    'NVBW', 'NVCR', 'NVCT', 'NVDA', 'NVDB'].map((ticker) => ({ ticker }))

  const tickers = (rows) => rows.map((r) => ({ value: r.ticker, label: '' }))
  const values = (out) => out.filter((r) => r.kind === 'ticker').map((r) => r.value)

  it('ranking: among prefix matches a widely traded ticker leads; an exact ticker still beats it', () => {
    expect(values(rankCandidates('NV', { tickers: tickers(NV), codes: false, limit: 6 }))[0]).toBe('NVDA')
    expect(values(rankCandidates('NVD', { tickers: tickers(NV), codes: false, limit: 6 }))[0]).toBe('NVD')
    // Without a popular name in the list the order is the published A-Z, unchanged.
    const plain = NV.filter((r) => r.ticker !== 'NVDA')
    expect(values(rankCandidates('NV', { tickers: tickers(plain), codes: false, limit: 30 })))
      .toEqual(plain.map((r) => r.ticker).sort())
  })

  it('ranking: personal habit still outranks popularity inside a class', () => {
    const out = rankCandidates('NV', { tickers: tickers(NV), codes: false, limit: 3, stats: { NVO: { n: 9, last: 1e10 } }, nowSec: 1e10 })
    expect(values(out).slice(0, 2)).toEqual(['NVO', 'NVDA'])
  })

  it('typing TS shows TSLA first (it asks the search for 20, not 6)', async () => {
    // TS, not NV: the search answers are cached per query for a minute across this file.
    const TS = ['TS', 'TSI', 'TSL', 'TSM', 'TSN', 'TSQ', 'TSAT', 'TSBK', 'TSLA'].map((ticker) => ({ ticker }))
    const seen = []
    global.fetch = vi.fn(async (url) => {
      seen.push(String(url))
      return { ok: true, status: 200, json: async () => ({ results: TS }) }
    })
    render(<CommandLine onSubmit={() => {}} />)
    typeText('TSX')
    await wait(50)
    typeText('TS')
    await wait(400)
    expect(seen.some((u) => u.includes('limit=20'))).toBe(true)
    const rows = [...screen.getByTestId('terminal-suggestions').querySelectorAll('li')].map((li) => li.textContent)
    expect(rows[0]).toMatch(/^TS(?!L)/)          // the exact match leads…
    expect(rows[1]).toMatch(/^TSLA/)             // …then the name members trade
    expect(rows.length).toBeLessThanOrEqual(6 + 10)
  })
})
