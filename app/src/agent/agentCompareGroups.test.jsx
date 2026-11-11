// C1-035 / C1-037 / C1-040 — chartSetup.compareGroup: the Compare Symbols panel's GROUP controls (add a whole
// theme / sector / industry, remove a group, a group's scale) through the panel's own list writers and group reads.
// Parity: the Agent's next comparison list is checked against what the REAL panel hands setComparison for the same click.
import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { wordsSelect } from './routing'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import CompareSymbolsPanel from '../pages/charts/CompareSymbolsPanel'
import { matchGroup } from './capabilities/compareGroup'

registerBuiltins()
const CTX = { surface: 'charts' }
const WAIT = { timeout: 5000 }

// Two charts; only the targeted one may change.
function host2({ c1 = null, c2 = null } = {}) {
  const st = { c1: { stored: c1, symbol: 'NVDA' }, c2: { stored: c2, symbol: 'AAPL' } }
  const read = (ref) => (st[ref] ? { ref, label: `Chart (${st[ref].symbol})`, symbol: st[ref].symbol, tf: 'D', stored: st[ref].stored, cs: mergeChartSettings(st[ref].stored || {}), linkedCount: 0 } : null)
  return {
    st,
    charts: { list: () => ['c1', 'c2'].map(read), read, commit(ref, patch) { if ('settings' in patch) st[ref].stored = patch.settings; return true } },
    otherWidgets: () => [],
  }
}
const op = (args, target = 'c1') => ({ action: 'chartSetup.compareGroup', target, args: { groupType: 'any', scale: null, ...args } })
async function plan(host, ops) {
  buildContext(host, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(host, ['chart']), ops, env, CTX), env }
}

// ── the panel's group reads, faked at the network ──
const GROUPS = {
  theme: [{ name: 'AI Chips', count: 3 }],
  sector: [{ name: 'Technology', count: 4 }],
  industry: [{ name: 'Semiconductors', count: 3 }, { name: 'Semiconductor Equipment', count: 2 }, { name: 'Software', count: 2 }],
}
const MEMBERS = {
  'AI Chips': ['NVDA', 'AMD', 'AVGO'], Technology: ['AAPL', 'MSFT', 'NVDA', 'ORCL'],
  Semiconductors: ['AMD', 'AVGO', 'MU'], 'Semiconductor Equipment': ['AMAT', 'LRCX'], Software: ['MSFT', 'ORCL'],
}
let failType = null
const res = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body })
beforeEach(() => {
  failType = null
  globalThis.fetch = vi.fn((url) => {
    const u = new URL(String(url), 'http://x')
    if (u.pathname === '/api/compare/groups') {
      const t = u.searchParams.get('type')
      return t === failType ? res({ detail: 'down' }, 503) : res({ groups: GROUPS[t] || [] })
    }
    if (u.pathname === '/api/compare/group-members') {
      const n = u.searchParams.get('name')
      return res({ name: n, symbols: MEMBERS[n] || [], total: (MEMBERS[n] || []).length, truncated: false })
    }
    return res({})
  })
})
afterEach(() => { vi.restoreAllMocks() })

const QQQ = { sym: 'QQQ', enabled: true, color: '#60a5fa', scaleMode: 'new' }

// The REAL panel: what it hands setComparison after one click.
function makeApi(initial) {
  let comp = initial
  return { getComparison: vi.fn(() => comp), setComparison: vi.fn((a) => { comp = a }), getPercentScale: () => false, setPercentScale: vi.fn() }
}
function Panel({ api }) {
  const byId = useRef(new Map([['c1', api]]))
  const active = useRef('c1')
  return <CompareSymbolsPanel chartApiById={byId} activeChartRef={active} onClose={() => {}} />
}

describe('chartSetup.compareGroup — add a whole group (C1-035)', () => {
  it('writes exactly the list the panel writes for the same click; read back; Undo exact; the other chart untouched', async () => {
    const api = makeApi([QQQ])
    render(<Panel api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Industries' }, WAIT))
    fireEvent.click(await screen.findByRole('button', { name: /^Semiconductors\d/ }, WAIT))
    await waitFor(() => expect(api.setComparison).toHaveBeenCalled(), WAIT)
    const panelList = api.setComparison.mock.calls.at(-1)[0]

    const other = { comparisonSymbols: [QQQ] }
    const host = host2({ c1: { comparisonSymbols: [QQQ] }, c2: other })
    const { p, env } = await plan(host, [op({ action: 'add', group: 'Semiconductors' })])
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('apply')            // applied at once, like the panel's click (Undo on the receipt)
    expect(p.plans[0].after.cs.comparisonSymbols).toEqual(panelList)
    expect(panelList.filter(x => x.group === 'Semiconductors').map(x => x.sym)).toEqual(['AMD', 'AVGO', 'MU'])
    expect(p.lines[0]).toMatch(/^Chart \(NVDA\): Comparing NVDA with the Semiconductors industry: 3 symbols added — AMD, AVGO, MU$/)
    const r = await commitPlan(host, p, { env })
    expect(r.ok).toBe(true)
    expect(host.st.c1.stored.comparisonSymbols).toEqual(panelList)
    expect(host.st.c2.stored).toBe(other)                       // wrong-target control
    expect((await undoEntry(host, r.undo)).ok).toBe(true)
    expect(host.st.c1.stored.comparisonSymbols).toEqual([QQQ])
  })

  it('a spoken name is matched by UCT: "ai chips" → the AI Chips theme', async () => {
    const { p } = await plan(host2(), [op({ action: 'add', group: 'the ai chips group' })])
    expect(p.ok).toBe(true)
    expect(p.plans[0].after.cs.comparisonSymbols.map(x => [x.sym, x.group])).toEqual([['NVDA', 'AI Chips'], ['AMD', 'AI Chips'], ['AVGO', 'AI Chips']])
  })

  it('more than one match asks with the real names, and nothing is written', async () => {
    const host = host2()
    const { p } = await plan(host, [op({ action: 'add', group: 'semis' })])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/More than one group matches “semis”: Semiconductors \(industry\), Semiconductor Equipment \(industry\)\. Which one/)
    expect(host.st.c1.stored).toBe(null)
  })

  it('no match says so; a list that could not be read is never "no such group"', async () => {
    expect((await plan(host2(), [op({ action: 'add', group: 'Shipping' })])).p.refusals[0].reason).toMatch(/UCT has no theme, sector or industry called “Shipping”/)
    failType = 'industry'
    const r = (await plan(host2(), [op({ action: 'add', group: 'Shipping' })])).p
    expect(r.ok).toBe(false)
    expect(r.refusals[0].reason).toMatch(/couldn't read the industry list just now/)
    expect(r.refusals[0].reason).not.toMatch(/has no/)
    // an exact name in a list that WAS read still acts
    expect((await plan(host2(), [op({ action: 'add', group: 'AI Chips' })])).p.ok).toBe(true)
  })

  it('every member already compared is a no-op, not a receipt', async () => {
    const host = host2()
    const first = await plan(host, [op({ action: 'add', group: 'Software' })])
    await commitPlan(host, first.p, { env: first.env })
    const again = (await plan(host, [op({ action: 'add', group: 'Software' })])).p
    expect(again.changed).toBe(false)
    expect(again.noops.join(' ')).toMatch(/already compared/)
  })
})

describe('chartSetup.compareGroup — remove a group (C1-037) and a group\'s scale (C1-040)', () => {
  const SEMI = ['AMD', 'AVGO', 'MU'].map((sym, i) => ({ sym, enabled: true, color: `#00000${i}`, scaleMode: 'new', group: 'Semiconductors' }))
  const SOFT = ['MSFT', 'ORCL'].map((sym, i) => ({ sym, enabled: true, color: `#11111${i}`, scaleMode: 'new', group: 'Software' }))

  it('remove = the group row\'s ×: only that group goes (parity with the panel); Undo exact', async () => {
    const api = makeApi([...SEMI, QQQ, ...SOFT])
    render(<Panel api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Semiconductors' }, WAIT))
    const panelList = api.setComparison.mock.calls.at(-1)[0]
    const host = host2({ c1: { comparisonSymbols: [...SEMI, QQQ, ...SOFT] } })
    const { p, env } = await plan(host, [op({ action: 'remove', group: 'semiconductors' })])
    expect(p.plans[0].after.cs.comparisonSymbols).toEqual(panelList)
    expect(p.lines).toEqual(['Chart (NVDA): Removed the Semiconductors group (3 symbols) from this chart\'s comparisons'])
    const r = await commitPlan(host, p, { env })
    expect(host.st.c1.stored.comparisonSymbols.map(x => x.sym)).toEqual(['QQQ', 'MSFT', 'ORCL'])
    await undoEntry(host, r.undo)
    expect(host.st.c1.stored.comparisonSymbols).toEqual([...SEMI, QQQ, ...SOFT])
  })

  it('scale = the group\'s Same % scale button (parity), and only that group moves', async () => {
    const api = makeApi([...SEMI, QQQ, ...SOFT])
    render(<Panel api={api} />)
    const seg = (await screen.findAllByText('Same % scale', {}, WAIT))[0]
    fireEvent.click(seg)
    const panelList = api.setComparison.mock.calls.at(-1)[0]
    const host = host2({ c1: { comparisonSymbols: [...SEMI, QQQ, ...SOFT] } })
    const { p } = await plan(host, [op({ action: 'scale', group: 'semiconductors', scale: 'same' })])
    expect(p.plans[0].after.cs.comparisonSymbols).toEqual(panelList)
    expect(p.lines).toEqual(['Chart (NVDA): The Semiconductors group is now on the main price scale (Same % scale)'])
  })

  it('a group not on the chart, or no group named with two compared, asks with the chart\'s own groups', async () => {
    const host = host2({ c1: { comparisonSymbols: [...SEMI, ...SOFT] } })
    expect((await plan(host, [op({ action: 'remove', group: 'Retail' })])).p.refusals[0].reason).toMatch(/No group called “Retail” is compared on this chart \(it compares Semiconductors, Software\)/)
    expect((await plan(host, [op({ action: 'remove', group: 'the group' })])).p.refusals[0].reason).toMatch(/2 groups .*Semiconductors, Software\. Which one/)
    expect((await plan(host2({ c1: { comparisonSymbols: [QQQ] } }), [op({ action: 'scale', group: 'semis', scale: 'new' })])).p.refusals[0].reason).toMatch(/no compared groups/)
    expect(host.st.c1.stored.comparisonSymbols).toEqual([...SEMI, ...SOFT])
  })

  it('a percent scale is switched off when a group is on its own % scale (the panel\'s rule)', async () => {
    const host = host2({ c1: { percentScale: true, comparisonSymbols: SEMI.map(x => ({ ...x, scaleMode: 'same' })) } })
    const { p } = await plan(host, [op({ action: 'scale', group: 'Semiconductors', scale: 'new' })])
    expect(p.plans[0].after.cs.percentScale).toBe(false)
  })
})

describe('matching and routing', () => {
  it('exact beats partial; filler words are not a name', () => {
    const c = [{ name: 'Semiconductors' }, { name: 'Semiconductor Equipment' }]
    expect(matchGroup('Semiconductors', c).hit.name).toBe('Semiconductors')
    expect(matchGroup('semis', c).many.length).toBe(2)
    expect(matchGroup('semi equipment', c).hit.name).toBe('Semiconductor Equipment')
    expect(matchGroup('the group', [{ name: 'Software' }]).hit.name).toBe('Software')
    expect(matchGroup('banks', c).none).toBe(true)
  })
  it('the manifest carries it and the words reach it', () => {
    expect(getCapability('chartSetup.compareGroup')).toBeTruthy()
    for (const m of ['compare against the semis group', 'remove the semiconductors industry from the chart', 'put the semis overlay on its own scale']) {
      expect(wordsSelect('chartSetup', m)).toBe(true)
    }
  })
})
