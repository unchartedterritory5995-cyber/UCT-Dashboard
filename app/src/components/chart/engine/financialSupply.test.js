// ─── ⭐⭐ T4 F1b — THE CHART'S FINANCIAL DOOR: ONE ASK PER SYMBOL, NEVER `/api/bars` ───────────────────────────────
//
// `financialSupply.js` is the chart's cache of `GET /api/pine/financial/<symbol>` (F1a), built by the same factory as the
// events door (`eventSupply.js::makeDoorCache`). What these rails hold:
//   * a financial read is asked of THAT door only, once per symbol, and never of `/api/bars` or the events door;
//   * the door's answers become the entry the bind reads: 200 available, 202 pending, 404 dark (never asked again).

import { describe, it, expect, afterEach } from 'vitest'
import { ensureFinancial, fetchFinancial, clearFinancial, financialUrl } from './financialSupply'
import { ensureEvents, clearEvents } from './eventSupply'
import { ensureChartSources, financialNeededBy, eventsNeededBy } from './useSecondarySources'
import { FINANCIAL_KEY } from './pineFinancial'
import { EVENTS_KEY } from './pineEvents'
import { fetchableOtherSymbols } from './otherSymbols'
import { translatePine } from './ast/pine'
import { clearSecondaryBars } from './secondaryBars'

afterEach(() => { clearFinancial(); clearEvents(); clearSecondaryBars() })

const DOC = { schema: 'uct.pine-financial/v1', symbol: 'AAPL', state: 'ready', refreshedAt: 1763800000, familyState: 'ok', fields: {} }
const answer = (status, body) => () => (status >= 400
  ? Promise.reject(Object.assign(new Error(`HTTP ${status}`), { status })) : Promise.resolve(body))

describe('F1b — the financial door', () => {
  it('asks /api/pine/financial/<SYMBOL> once, and the answer is the entry the bind reads', async () => {
    const asked = []
    const fetcher = (url) => { asked.push(url); return Promise.resolve(DOC) }
    expect(ensureFinancial('aapl', fetcher)).toMatchObject({ status: 'loading' })
    expect(ensureFinancial('AAPL', fetcher)).toMatchObject({ status: 'loading' })
    await fetchFinancial('AAPL', fetcher)
    const e = ensureFinancial('AAPL', fetcher)
    expect(e).toMatchObject({ status: 'available', symbol: 'AAPL', financial: DOC, rev: '1763800000' })
    expect(ensureFinancial('AAPL', fetcher)).toBe(e)
    expect(asked).toEqual(['/api/pine/financial/AAPL'])
    expect(financialUrl('brk.b')).toBe('/api/pine/financial/BRK.B')
  })

  it('404 (dark for this member) is `dark`, never asked again; 202 is `pending`', async () => {
    let calls = 0
    await fetchFinancial('MSFT', () => { calls += 1; return answer(404)() })
    expect(ensureFinancial('MSFT', () => { calls += 1; return answer(404)() })).toMatchObject({ status: 'dark' })
    expect(calls).toBe(1)
    await fetchFinancial('NVDA', answer(200, { state: 'pending', symbol: 'NVDA' }))
    expect(ensureFinancial('NVDA')).toMatchObject({ status: 'pending' })
  })

  it('the two doors keep separate caches: an events answer is never a financial one', async () => {
    await fetchFinancial('AAPL', answer(404))
    expect(ensureEvents('AAPL', () => Promise.resolve({ symbol: 'AAPL', families: {} }))).toMatchObject({ status: 'loading' })
    expect(ensureFinancial('AAPL')).toMatchObject({ status: 'dark' })
  })
})

describe('F1b — a financial read reaches the financial door and nothing else', () => {
  const def = () => {
    const t = translatePine(['//@version=5', 'indicator("f")',
      'plot(request.financial(syminfo.tickerid, "TOTAL_REVENUE", "FQ"))'].join('\n'), { strict: true })
    return { id: 'u_findoor', compute: { kind: 'ast', trees: { p0: t.outputs[0].ast } },
      meta: { recurrenceOrigin: 'pine', otherSymbols: t.otherSymbols } }
  }

  it('the chart needs the financial key, never the events key, never the read\'s ticker as a bars key', () => {
    const d = def()
    expect(financialNeededBy([{ defId: 'x' }], () => d)).toBe(true)
    expect(eventsNeededBy([{ defId: 'x' }], () => d)).toBe(false)
    expect(fetchableOtherSymbols(d)).toEqual([])
  })

  it('(train e95, the 2b bind audit) a knob arm the instance does not pick fetches no financial figures; a picked one does', () => {
    const base = def()
    const pick = { type: 'op', name: '==', args: [{ type: 'series', name: 'src' }, { type: 'num', value: 1 }] }
    const tree = { type: 'op', name: '?:', args: [pick, base.compute.trees.p0, { type: 'series', name: 'close' }] }
    const d = { ...base, inputs: [{ key: 'src', type: 'enum', options: ['Price', 'Revenue'], default: 'Price' }],
      compute: { kind: 'ast', trees: { p0: tree } } }
    expect(financialNeededBy([{ defId: 'x', inputs: {} }], () => d)).toBe(false)
    expect(financialNeededBy([{ defId: 'x', inputs: { src: 'Revenue' } }], () => d)).toBe(true)
  })

  it('ensureChartSources: the financial key asks the financial door with the chart\'s symbol, and the bars door nothing', async () => {
    const asked = []
    const fetcher = (url) => { asked.push(url); return Promise.resolve(url.startsWith('/api/pine/financial/') ? DOC : { bars: [] }) }
    const out = ensureChartSources([FINANCIAL_KEY], 'D', 600, fetcher, 'AAPL')
    expect(out.get(FINANCIAL_KEY)).toMatchObject({ status: 'loading', symbol: 'AAPL' })
    expect(out.has(EVENTS_KEY)).toBe(false)
    await Promise.resolve(); await Promise.resolve()
    expect(asked).toEqual(['/api/pine/financial/AAPL'])
    expect(asked.some((u) => u.startsWith('/api/bars') || u.startsWith('/api/pine/events'))).toBe(false)
  })
})
