const R = 'file:///C:/Users/pgosz/uct-worktrees/tf4-accuracy/app/src/'
const M = await import(R + 'pages/terminal/panels/moversModel.js')
const P = await import(R + 'lib/presentation/presentationPrimitives.js')
const out = []
const chk = (name, ref, prod) => out.push([name, JSON.stringify(ref), JSON.stringify(prod), JSON.stringify(ref) === JSON.stringify(prod) ? 'PASS' : 'FAIL'])
const near = (name, ref, prod, tol = 1e-9) => out.push([name, ref, prod, (ref == null && prod == null) || Math.abs(ref - prod) <= tol ? 'PASS' : 'FAIL'])
// NVDA-like fixture: prev close 187.62, pre-market print 190.10, regular close 189.11, AH 186.40
const prices = { NVDA: { price: 189.11, change_pct: (189.11 - 187.62) / 187.62 * 100, volume: 151e6, prev_close: 187.62, day_close: 189.11, ext_price: 186.40, ext_session: 'post' },
  AMD: { price: 160.2, change_pct: -2.5, volume: 40e6, prev_close: 164.31, day_close: 160.2, ext_price: 165.0, ext_session: 'pre' } }
const movers = { ripping: [{ sym: 'nvda', pct: '+0.79%' }], drilling: [{ sym: 'AMD', pct: '-2.50%' }] }
const volume = { rows: [{ sym: 'NVDA', price: 189, pct: 0.8, rvol: 1.4, rvol_day: 1.9, lit: true }, { sym: 'TSLA', price: 400, pct: 1, rvol: 3, lit: false }] }
const catalysts = { rows: [{ ticker: 'AMD', tag: 'Earnings', gap_pct: -3.1, vol_x: 2.2, price: 160, catalyst_at: 1790000000 }] }
const post = M.buildRows({ movers, catalysts, volume, prices, session: 'post' })
const nv = post.find(r => r.sym === 'NVDA'), amd = post.find(r => r.sym === 'AMD')
near('MOST post: NVDA % = regular close vs prev close', (189.11 / 187.62 - 1) * 100, nv.pct)
near('MOST post: NVDA after-hours % = ext vs 4 PM close', (186.40 / 189.11 - 1) * 100, nv.ah)
chk('MOST post: AMD ext print from PRE session is not shown as after-hours', null, amd.ah)
chk('MOST: TSLA tracked-but-not-lit, on no list -> not a mover', false, post.some(r => r.sym === 'TSLA'))
chk('MOST: vol vs avg prefers scanner rvol_day (1.9)', [1.9, 'scanner'], [nv.volVsAvg, nv.volSource])
chk('MOST: catalyst vol_x used when scanner absent', [2.2, 'catalyst'], [amd.volVsAvg, amd.volSource])
chk('MOST: catalyst_at seconds -> ms', 1790000000 * 1000, amd.catalyst.at)
const pre = M.buildRows({ movers, catalysts, volume, prices, session: 'pre' })
const amdPre = pre.find(r => r.sym === 'AMD')
near('MOST pre: AMD % = pre-market print vs prev close', (165.0 / 164.31 - 1) * 100, amdPre.pct)
chk('MOST pre: last = pre-market print', 165.0, amdPre.last)
const nvPre = pre.find(r => r.sym === 'NVDA')
chk('MOST pre: NVDA with a POST ext print falls back to movers %', 0.79, nvPre.pct)
// filters & sort
const rows = [{ sym: 'A', pct: 5, last: 4, volume: 2e5, lit: false }, { sym: 'B', pct: -7, last: 12, volume: 9e6, lit: true }, { sym: 'C', pct: null, last: null, volume: null, lit: true }, { sym: 'D', pct: 5, last: 30, volume: 1e6, lit: false }]
chk('MOST up lens keeps pct>0 only', ['A', 'D'], M.filterRows(rows, { lens: 'up' }).map(r => r.sym))
chk('MOST down lens', ['B'], M.filterRows(rows, { lens: 'down' }).map(r => r.sym))
chk('MOST min price $5 drops a no-price row', ['B', 'D'], M.filterRows(rows, { minPrice: 5 }).map(r => r.sym))
chk('MOST min vol 500K', ['B', 'D'], M.filterRows(rows, { minVolume: 5e5 }).map(r => r.sym))
chk('MOST sort |%| desc, missing last, ties by symbol', ['B', 'A', 'D', 'C'], M.sortRows(rows, { key: 'absPct', dir: 'desc' }).map(r => r.sym))
chk('MOST sort pct asc, missing last', ['B', 'A', 'D', 'C'], M.sortRows(rows, { key: 'pct', dir: 'asc' }).map(r => r.sym))
chk('MOST parsePct', [34.4, -3.1, 3.1, null, null], [M.parsePct('+34.40%'), M.parsePct('-3.1%'), M.parsePct(3.1), M.parsePct(''), M.parsePct(NaN)])
chk('MOST session labels', ['regular', 'pre', 'post', 'closed'], [M.sessionOf({ isOpen: true }), M.sessionOf({ isPremarket: true }), M.sessionOf({ isExtended: true }), M.sessionOf({})])
// compact formatting: reference by hand-derived ladder
const T = (v, m) => P.formatCompactTerminal(v, { money: m })
chk('compact terminal: 2.9134e12 money', '$2.91T', T(2.9134e12, true))
chk('compact terminal: 391.04e9', '$391.04B', T(391.04e9, true))
chk('compact terminal: 45.26e6', '45.3M', T(45.26e6))
chk('compact terminal: 950_400', '950K', T(950400))
chk('compact terminal: 812', '$812', T(812, true))
chk('compact terminal: negative money sign outside', '-$1.25B', T(-1.25e9, true))
chk('compact terminal: NaN -> em dash', '—', T(NaN))
chk('compact terminal: tier boundary 999_999 (tier picked pre-rounding)', '1000K', T(999999))
chk('compact terminal: 999_950_000', '1000.0M', T(999950000))
chk('compact default ladder: 1.234e9', '1.2B', P.formatCompact(1.234e9))
chk('formatPercent signed', ['+1.50%', '-0.25%', '-0.00%'], [P.formatPercent(1.5, { signed: true }), P.formatPercent(-0.25, { signed: true }), P.formatPercent(-0.001, { signed: true })])
chk('currency TWD label', 'TWD 535.87', P.formatCurrencyIn(535.87, 'TWD'))
chk('currency negative TWD', '-TWD 2.90', P.formatCurrencyIn(-2.9, 'twd '))
chk('currency USD/unknown = $', ['$1.00', '$1.00'], [P.formatCurrencyIn(1, 'USD'), P.formatCurrencyIn(1, null)])
chk('relabel $ text for TWD', 'TWD 1.59B', P.relabelDollarText('$1.59B', 'TWD'))
chk('relabel negative $ text for TWD', '-TWD 450M', P.relabelDollarText('-$450M', 'TWD'))
console.log(JSON.stringify(out))
