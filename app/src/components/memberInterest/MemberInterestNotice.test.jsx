// D-9 (UC-1): the shared "you follow X" line, asserted on RENDERED TEXT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, renderHook } from '@testing-library/react'
import { SWRConfig } from 'swr'
import MemberInterestNotice, { NOTICE_MAX_NAMED } from './MemberInterestNotice'
import { AuthContext } from '../../context/AuthContext'
import {
  followedAmong, readMemberInterestSurfaces, useMemberInterestSurface, MEMBER_INTEREST_SURFACE_KEYS,
  MEMBER_INTEREST_KEY,
} from '../../lib/memberInterest'

let reply
beforeEach(() => {
  reply = [200, { entities: {} }]
  global.fetch = vi.fn(() => Promise.resolve({
    ok: reply[0] < 400, status: reply[0], json: () => Promise.resolve(reply[1]),
  }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderIt = (props) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemberInterestNotice where="in this list" {...props} />
  </SWRConfig>,
)
const settle = () => new Promise((r) => setTimeout(r, 25))

describe('MemberInterestNotice', () => {
  it('gate off: renders nothing and never requests /api/member/interest', async () => {
    renderIt({ enabled: false, syms: ['NVDA'] })
    await settle()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.queryByTestId('member-interest-notice')).not.toBeInTheDocument()
  })

  it('gate on + followed tickers: names them in the list order, with the route’s own reasons', async () => {
    reply = [200, { entities: {
      NVDA: { weight: 3, because: ['watchlist'] },
      AAPL: { weight: 9, because: ['positions', 'flagged'] },
    } }]
    renderIt({ enabled: true, syms: ['msft', 'nvda', 'AAPL'] })
    const line = await screen.findByTestId('member-interest-notice')
    expect(global.fetch).toHaveBeenCalledWith(MEMBER_INTEREST_KEY)
    expect(line.textContent).toBe(
      'Already on your radarYou follow 2 names in this list: NVDA (on your watchlists); '
      + 'AAPL (in your open Journal positions · flagged by you).',
    )
    expect(line.textContent).not.toMatch(/—/)
  })

  it('gate on + nothing followed: renders nothing and never says "not on your watchlist"', async () => {
    reply = [200, { entities: { TSLA: { weight: 1, because: ['uct20'] } } }]
    renderIt({ enabled: true, syms: ['NVDA', 'AAPL'] })
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await settle()
    expect(screen.queryByTestId('member-interest-notice')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/not on your/i)
  })

  it('a paywalled or failed read renders nothing', async () => {
    reply = [402, { detail: 'Member interest requires a paid plan' }]
    renderIt({ enabled: true, syms: ['NVDA'] })
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await settle()
    expect(screen.queryByTestId('member-interest-notice')).not.toBeInTheDocument()
  })

  it(`names at most ${NOTICE_MAX_NAMED} and counts the rest`, async () => {
    const syms = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']
    reply = [200, { entities: Object.fromEntries(syms.map((s) => [s, { because: ['flagged'] }])) }]
    renderIt({ enabled: true, syms })
    const line = await screen.findByTestId('member-interest-notice')
    expect(screen.getAllByTestId('member-interest-hit')).toHaveLength(NOTICE_MAX_NAMED)
    expect(line.textContent).toContain('You follow 7 names in this list')
    expect(line.textContent).toMatch(/; and 2 more\.$/)
  })
})

describe('lib/memberInterest', () => {
  it('followedAmong keeps the given order, drops blanks and duplicates, keeps unknown sources by name', () => {
    const ent = { B: { because: ['tags'] }, A: { because: ['watchlist'] } }
    expect(followedAmong(ent, ['b', '', null, 'A', 'B', 'C'])).toEqual([
      { sym: 'B', reasons: ['tags'] }, { sym: 'A', reasons: ['on your watchlists'] },
    ])
  })

  it('readMemberInterestSurfaces reads each key strictly === true; absent is false', () => {
    expect(readMemberInterestSurfaces(null)).toEqual(Object.fromEntries(MEMBER_INTEREST_SURFACE_KEYS.map((k) => [k, false])))
    expect(readMemberInterestSurfaces({ member_interest_wire_enabled: 'yes' }).member_interest_wire_enabled).toBe(false)
    expect(readMemberInterestSurfaces({ member_interest_wire_enabled: true }).member_interest_wire_enabled).toBe(true)
  })

  it('useMemberInterestSurface: off outside a provider, on only for its own key inside one', () => {
    expect(renderHook(() => useMemberInterestSurface('member_interest_wire_enabled')).result.current).toBe(false)
    const value = { memberInterestSurfaces: { member_interest_wire_enabled: true, member_interest_breadth_enabled: false } }
    const wrapper = ({ children }) => <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    expect(renderHook(() => useMemberInterestSurface('member_interest_wire_enabled'), { wrapper }).result.current).toBe(true)
    expect(renderHook(() => useMemberInterestSurface('member_interest_breadth_enabled'), { wrapper }).result.current).toBe(false)
  })
})
