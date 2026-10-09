// Protected layouts (Main Trading): the Agent never changes the open protected board, never
// renames/deletes/saves into a protected layout, never Undoes into one — but may read, open and
// duplicate it.
import { describe, it, expect, beforeEach } from 'vitest'
import { protectionRefusal, undoProtectionRefusal, protectedOpenLayout, PROTECTED_LAYOUTS_KEY } from './protectedLayouts'

const host = (activeId, entries = [{ id: '1', name: 'Main Trading' }, { id: '2', name: 'Agent Test' }, { id: '3', name: 'Swing' }]) => ({
  layouts: { snapshot: () => ({ entries, active: activeId ? { scope: 'user', id: activeId } : null }) },
})
const plan = (...kinds) => ({ ok: true, plans: kinds.map(k => ({ kind: k, changed: true, ref: k })) })

beforeEach(() => { try { localStorage.removeItem(PROTECTED_LAYOUTS_KEY) } catch { /* jsdom */ } })

describe('while Main Trading is open', () => {
  it('every change that lands on its board or charts is refused — chart, board, workspace, drawing, save-current', () => {
    const h = host('1')
    expect(protectedOpenLayout(h)).toMatchObject({ name: 'Main Trading' })
    for (const k of ['chart', 'board', 'workspace', 'drawing']) {
      expect(protectionRefusal(h, plan(k), [{ action: `${k}.x` }])).toMatch(/“Main Trading” is a protected layout/)
    }
    expect(protectionRefusal(h, plan('layouts'), [{ action: 'layout.saveCurrent', args: {} }])).toMatch(/protected/)
  })
  it('…but account-level changes that do not touch the board are allowed (watchlists, alerts, settings), and so are reads', () => {
    const h = host('1')
    for (const k of ['watchlist', 'alert', 'settings', 'screener']) expect(protectionRefusal(h, plan(k), [{ action: `${k}.x` }])).toBe(null)
    expect(protectionRefusal(h, { ok: true, plans: [{ kind: 'chart', changed: false }] }, [])).toBe(null)
  })
  it('an Undo into the protected board is refused; an Undo of a watchlist change is not', () => {
    const h = host('1')
    expect(undoProtectionRefusal(h, { items: [{ kind: 'chart' }] })).toMatch(/doesn't undo changes into it/)
    expect(undoProtectionRefusal(h, { items: [{ kind: 'watchlist' }] })).toBe(null)
  })
})

describe('from any other layout', () => {
  it('the board is the Agent\'s to change; Main Trading itself is never renamed or deleted (by id or by name)', () => {
    const h = host('2')
    expect(protectionRefusal(h, plan('chart', 'board'), [{ action: 'chart.setTimeframe' }])).toBe(null)
    expect(protectionRefusal(h, plan('layouts'), [{ action: 'layout.rename', args: { layout: '1', name: 'X' } }])).toMatch(/never renames or deletes/)
    expect(protectionRefusal(h, plan('layouts'), [{ action: 'layout.delete', args: { layout: 'main trading' } }])).toMatch(/never renames or deletes/)
    expect(protectionRefusal(h, plan('layouts'), [{ action: 'layout.delete', args: { layout: '3' } }])).toBe(null)
    expect(protectionRefusal(h, plan('layouts'), [{ action: 'layout.duplicate', args: { layout: '1', name: 'Copy' } }])).toBe(null)
    expect(protectionRefusal(h, plan('layouts'), [{ action: 'layout.open', args: { layout: '1' } }])).toBe(null)
    expect(undoProtectionRefusal(h, { items: [{ kind: 'chart' }] })).toBe(null)
  })
  it('the member can protect more layouts in this browser (names or ids, case-insensitive); bad storage is ignored', () => {
    localStorage.setItem(PROTECTED_LAYOUTS_KEY, JSON.stringify(['SWING']))
    expect(protectionRefusal(host('3'), plan('chart'), [{ action: 'chart.setType' }])).toMatch(/“Swing” is a protected layout/)
    localStorage.setItem(PROTECTED_LAYOUTS_KEY, '{not json')
    expect(protectionRefusal(host('3'), plan('chart'), [])).toBe(null)
    expect(protectionRefusal(host('1'), plan('chart'), [])).toMatch(/Main Trading/)     // the built-in name always holds
  })
  it('no layout snapshot (an unsaved board) → nothing to protect', () => {
    expect(protectionRefusal({}, plan('chart'), [])).toBe(null)
    expect(protectionRefusal(host(null), plan('chart'), [])).toBe(null)
  })
})

describe('release audit (2026-10-09)', () => {
  it('FAILS CLOSED while the layout list is loading: an unconfirmed open layout named Main Trading — or with no name yet — blocks board writes', () => {
    const loading = (pending) => ({ layouts: { snapshot: () => ({ entries: [], active: null, pendingActive: pending }) } })
    expect(protectionRefusal(loading({ id: '1', name: 'Main Trading' }), plan('chart'), [])).toMatch(/“Main Trading” is a protected layout/)
    expect(protectionRefusal(loading({ id: '9', name: null }), plan('board'), [])).toMatch(/still loading/)
    expect(undoProtectionRefusal(loading({ id: '9', name: null }), { items: [{ kind: 'chart' }] })).toMatch(/still loading/)
    expect(protectionRefusal(loading({ id: '3', name: 'Swing' }), plan('chart'), [])).toBe(null)
    expect(protectionRefusal(loading({ id: '9', name: null }), plan('watchlist'), [])).toBe(null)   // not a board write
  })
  it('only the Agent imports the guard — manual Charts use cannot be affected by it', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '..')
    const hits = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
        if (!/\.(jsx?|tsx?)$/.test(e.name) || /\.test\./.test(e.name)) continue
        if (/from ['"][^'"]*protectedLayouts['"]/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p).split(path.sep).join('/'))
      }
    }
    walk(root)
    expect(hits).toEqual(['agent/useAgent.js'])
  })
  it('no Agent capability can change the protected list: the guard reads a key nothing in the Agent writes', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = path.resolve(__dirname, 'capabilities')
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      expect(/protectedLayouts|PROTECTED_LAYOUTS_KEY|localStorage\.(setItem|removeItem|clear)/.test(src), f).toBe(false)
    }
  })
})
