// The command line's daily-use layer (2026-10-06 audit): history search on ↑, the recall list
// on ↓, earlier commands among the suggestions, `B:` board completion, Shift+Enter, recently
// viewed tickers offered instantly and ranked first among equals. Each behaviour has a control.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import CommandLine, {
  HISTORY_KEY, COMMAND_LINE_KEYS, acceptSuggestion, boardSuggestions, historyMatches, historyWalk, withRecentTickers,
} from './CommandLine'
import { rankCandidates, recentWeights } from './ranking'
import { DEFAULT_LAYOUT, movePanel, nextLinkChannel, recentSecurities, setCount } from './boardModel'

const input = () => screen.getByTestId('terminal-command')
const typeText = (v) => fireEvent.change(input(), { target: { value: v } })
const key = (k, extra = {}) => fireEvent.keyDown(input(), { key: k, ...extra })
const rows = () => [...(screen.queryByTestId('terminal-suggestions')?.querySelectorAll('li') || [])].map((li) => li.textContent)

beforeEach(() => {
  try { window.localStorage.clear() } catch { /* */ }
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }))
})
afterEach(() => cleanup())

const HISTORY = ['NVDA GP', 'AMD FA', 'TSLA', 'AMD GP W', 'CAL']

describe('pure helpers', () => {
  it('historyWalk narrows to entries that contain the typed text, else walks everything', () => {
    expect(historyWalk('amd', HISTORY)).toEqual(['AMD FA', 'AMD GP W'])
    expect(historyWalk('', HISTORY)).toEqual(HISTORY)                   // control: nothing typed
    expect(historyWalk('zzz', HISTORY)).toEqual(HISTORY)                // no match: all of it
  })

  it('historyMatches finds letters in order, prefix before substring before scattered', () => {
    expect(historyMatches('nvgp', HISTORY).map((r) => r.value)).toEqual(['NVDA GP'])
    expect(historyMatches('gp', ['NVDA GP', 'GP W', 'AMD GP W'], 3).map((r) => r.value)).toEqual(['GP W', 'NVDA GP', 'AMD GP W'])
    expect(historyMatches('q', HISTORY)).toEqual([])                     // one character is not enough
    expect(historyMatches('xyz', HISTORY)).toEqual([])                   // control: no match, no rows
  })

  it('accepting an earlier command replaces the whole line, not the last token', () => {
    expect(acceptSuggestion('nvg', { kind: 'history', value: 'NVDA GP W' })).toBe('NVDA GP W')
    expect(acceptSuggestion('NVDA G', { kind: 'function', value: 'GP' })).toBe('NVDA GP ')   // control
  })

  it('boardSuggestions completes B: from the library by slug or name, and nothing else', () => {
    const boards = [{ slug: 'earnings-morning', name: 'Earnings morning' }, { slug: 'semis', name: 'Semis and AI' }]
    expect(boardSuggestions('B:', boards).map((r) => r.value)).toEqual(['B:earnings-morning', 'B:semis'])
    expect(boardSuggestions('b:sem', boards).map((r) => r.value)).toEqual(['B:semis'])
    expect(boardSuggestions('B:ai', boards).map((r) => r.value)).toEqual(['B:semis'])   // by name
    expect(boardSuggestions('NVDA', boards)).toEqual([])                                // control
  })

  it('withRecentTickers adds a recently viewed ticker the search has not returned', () => {
    expect(withRecentTickers('AM', [], ['AMD', 'NVDA']).map((r) => r.value)).toEqual(['AMD'])
    expect(withRecentTickers('AM', [{ value: 'AMD', label: 'Advanced Micro' }], ['AMD']))
      .toEqual([{ value: 'AMD', label: 'Advanced Micro' }])             // the search's row wins
    expect(withRecentTickers('AM', [], [])).toEqual([])                  // control
  })

  it('a recently viewed ticker wins a tie inside its class, never across a class boundary', () => {
    const t = [{ value: 'NVDA' }, { value: 'NVO' }].map((r) => ({ ...r, label: '' }))
    const first = (opts) => rankCandidates('NV', { tickers: t, codes: false, ...opts })[0].value
    expect(first({})).toBe('NVDA')                                       // control: popular first
    expect(first({ recent: ['NVO'] })).toBe('NVO')                       // learned from use
    const exact = rankCandidates('NV', { tickers: [{ value: 'NV' }, { value: 'NVDA' }], codes: false, recent: ['NVDA'] })
    expect(exact[0].value).toBe('NV')                                    // exact still wins
    expect(recentWeights(['A', 'B']).get('A')).toBeGreaterThan(recentWeights(['A', 'B']).get('B'))
  })

  it('COMMAND_LINE_KEYS names every key the input answers', () => {
    expect(COMMAND_LINE_KEYS.map((k) => k.keys)).toEqual(
      ['Enter', 'Shift+Enter', 'Tab', '↑ / ↓', '↓ on an empty line', 'Esc'])
  })
})

describe('the board model behind the panel keys', () => {
  const board = setCount(DEFAULT_LAYOUT, 3)

  it('movePanel swaps neighbours and refuses at the edges', () => {
    const r = movePanel(board, 0, 1)
    expect(r.ok).toBe(true)
    expect(r.layout.panels.slice(0, 2).map((p) => p.code)).toEqual(['DES', 'CAL'])
    expect(r.layout.focus).toBe(1)
    expect(movePanel(board, 0, -1).ok).toBe(false)
    expect(movePanel(board, 2, 1).ok).toBe(false)                        // the last VISIBLE panel
  })

  it('nextLinkChannel steps through the groups, then unlinked, then round again', () => {
    const at = (ch) => ({ ...board, panels: board.panels.map((p, i) => (i === 1 ? { ...p, channel: ch } : p)) })
    expect(nextLinkChannel(at('A'), 1)).toBe('B')
    expect(nextLinkChannel(at('D'), 1)).toBe(null)
    expect(nextLinkChannel(at(null), 1)).toBe('A')
    expect(nextLinkChannel(board, 0)).toBeUndefined()                   // CAL follows no security
  })

  it('recentSecurities leads with the active group and interleaves the rest, de-duplicated', () => {
    const channels = board.channels.map((c) => (
      c.id === 'A' ? { ...c, history: ['NVDA', 'AMD'] } : c.id === 'B' ? { ...c, history: ['SPY', 'NVDA', 'QQQ'] } : c))
    expect(recentSecurities({ ...board, activeChannel: 'B', channels })).toEqual(['SPY', 'NVDA', 'AMD', 'QQQ'])
    expect(recentSecurities(board)).toEqual([])                          // control: nothing viewed
  })
})

describe('the rendered command line', () => {
  it('↑ with text typed walks only the commands that contain it; ↓ walks back to the draft', () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(HISTORY))
    render(<CommandLine onSubmit={() => {}} />)
    typeText('AMD')
    key('ArrowUp'); expect(input().value).toBe('AMD FA')
    key('ArrowUp'); expect(input().value).toBe('AMD GP W')
    key('ArrowUp'); expect(input().value).toBe('AMD GP W')               // the walk ends, it does not leak
    key('ArrowDown'); expect(input().value).toBe('AMD FA')
    key('ArrowDown'); expect(input().value).toBe('AMD')
  })

  it('CONTROL: ↑ on an empty line walks the whole history from the newest', () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(HISTORY))
    render(<CommandLine onSubmit={() => {}} />)
    key('ArrowUp'); expect(input().value).toBe('NVDA GP')
    key('ArrowUp'); expect(input().value).toBe('AMD FA')
  })

  it('↓ on an empty line opens the recent commands; Enter fills one, Enter again runs it', () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(HISTORY))
    const ran = []
    render(<CommandLine onSubmit={(v) => ran.push(v)} />)
    act(() => { input().focus() })
    expect(rows()).toEqual([])                                           // control: closed
    key('ArrowDown')
    expect(rows().map((r) => r.replace(/earlier command.*$/, ''))).toEqual(HISTORY)
    key('ArrowDown')                                                     // highlight the second
    key('Enter')
    expect(input().value).toBe('AMD FA')
    expect(ran).toEqual([])
    key('Enter')
    expect(ran).toEqual(['AMD FA'])
  })

  it('CONTROL: ↓ on an empty line with no history opens nothing', () => {
    render(<CommandLine onSubmit={() => {}} />)
    act(() => { input().focus() })
    key('ArrowDown')
    expect(screen.queryByTestId('terminal-suggestions')).toBeNull()
  })

  it('an earlier command that matches what is typed appears among the suggestions', () => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(['NVDA GP W']))
    render(<CommandLine onSubmit={() => {}} />)
    act(() => { input().focus() })
    typeText('nvgp')
    expect(rows().some((r) => r.startsWith('NVDA GP W') && r.includes('earlier command'))).toBe(true)
  })

  it('B: lists your boards at once, and Tab completes one', () => {
    const boards = [{ id: 'b1', slug: 'earnings-morning', name: 'Earnings morning' }, { id: 'b2', slug: 'semis', name: 'Semis' }]
    render(<CommandLine onSubmit={() => {}} boards={boards} />)
    act(() => { input().focus() })
    typeText('B:ear')
    expect(rows()).toEqual(['B:earnings-morningEarnings morningboard'])
    key('Tab')
    expect(input().value).toBe('B:earnings-morning ')
  })

  it('Shift+Enter runs the line with keepFunction; plain Enter does not', () => {
    const calls = []
    render(<CommandLine onSubmit={(...a) => calls.push(a)} />)
    typeText('AMD')
    key('Enter', { shiftKey: true })
    typeText('TSLA')
    key('Enter')
    expect(calls).toEqual([['AMD', { keepFunction: true }], ['TSLA']])
  })

  it('a recently viewed ticker is offered on the first keystrokes; without recents it is not', () => {
    const { unmount } = render(<CommandLine onSubmit={() => {}} recentTickers={['AMD']} />)
    act(() => { input().focus() })
    typeText('AM')
    expect(rows().some((r) => r.startsWith('AMD') && r.includes('recently viewed'))).toBe(true)
    unmount()
    render(<CommandLine onSubmit={() => {}} />)
    act(() => { input().focus() })
    typeText('AM')
    expect(rows().some((r) => r.startsWith('AMD'))).toBe(false)
  })
})
