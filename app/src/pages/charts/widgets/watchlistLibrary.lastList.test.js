// Owner 11-15 (live bug): two people on one browser saw each other's last Watchlist — a fresh widget
// titled "Flagged (<the other person>)". The last list is now kept per account.
import { describe, it, expect } from 'vitest'
import { readLastList, rememberList, lastListKey, LAST_LIST_KEY } from './watchlistLibrary'

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m } }

describe('last Watchlist list, per account (owner 11-15)', () => {
  it('one account never reads another account\'s last list', () => {
    const s = mem()
    rememberList({ key: 'flagged', name: 'Flagged (Person A)', tab: 'mine' }, s, 1)
    expect(readLastList(s, 1)).toEqual({ key: 'flagged', name: 'Flagged (Person A)', tab: 'mine' })
    expect(readLastList(s, 2)).toBe(null)
    rememberList({ key: 'user:9', name: 'Swing', tab: 'mine' }, s, 2)
    expect(readLastList(s, 1).key).toBe('flagged')
    expect(readLastList(s, 2).key).toBe('user:9')
  })
  it('no account → the shared legacy key, exactly as before', () => {
    const s = mem()
    rememberList({ key: 'user:3', name: 'X', tab: 'mine' }, s)
    expect(s.m.has(LAST_LIST_KEY)).toBe(true)
    expect(readLastList(s).key).toBe('user:3')
    expect(lastListKey(7)).toBe(`${LAST_LIST_KEY}.u7`)
  })
})
