import fs from 'fs'
const M = await import('file:///C:/Users/pgosz/uct-worktrees/tf4-accuracy/app/src/pages/terminal/panels/relativeMath.js')
const raw = JSON.parse(fs.readFileSync('daily.json'))
const series = {}
for (const [s, rows] of Object.entries(raw)) series[s] = M.closesFromBars({ bars: rows.map(r => ({ t: r.d, c: r.c })) })
const out = {}
// A: unix-seconds path
const gspcUnix = M.closesFromBars({ bars: raw['^GSPC'].map(r => ({ t: r.ts, c: r.c })) })
out.unixDates = gspcUnix.map(p => p.d)
// B: sma 50 on NVDA closes
out.sma50 = M.sma(series.NVDA.map(p => p.c), 50)
// C: REL
out.rel = {}
for (const lb of ['1M','3M','6M','1Y','2Y','YTD']) out.rel[lb] = M.relativePerformance(series, ['NVDA','SPY','AMD'], lb, 50)
// D: RRG daily
out.rrgD = {}
for (const s of ['XLK','XLE','NVDA','TSM']) out.rrgD[s] = M.rrgPath(series[s], series.SPY)
// F: CORR
const syms = ['NVDA','AMD','SPY','XLK','XLE','TSM']
out.corr = {}
for (const [lb, n] of Object.entries(M.LOOKBACK_SESSIONS)) out.corr[lb] = M.correlationMatrix(series, syms, n)
// G: halt edge: drop 2026-08-14 from AMD
const amdHalt = series.AMD.filter(p => p.d !== '2026-08-14')
out.corrHalt = M.correlationMatrix({ ...series, AMD: amdHalt }, ['NVDA','AMD'], 63)
// H edges
out.edges = {
  zeroNaN: M.closesFromBars({ bars: [{t:'2026-01-02',c:0},{t:'2026-01-05',c:NaN},{t:'2026-01-06',c:'x'},{t:'2026-01-07',c:10},{t:'2026-01-07',c:11},{t:'2026-01-08',close:12}] }),
  pearsonConst: M.pearson([1,1,1],[1,2,3]),
  pearsonOne: M.pearson([1],[2]),
  rebaseZero: M.rebase([0,1,2]),
  windowShort: M.windowSessions('1Y', ['2026-01-02']),
  relOneDay: M.relativePerformance({A:[{d:'2026-01-02',c:1}],B:[{d:'2026-01-02',c:1}]},['A','B']),
}
fs.writeFileSync('prod_rel.json', JSON.stringify(out))
console.log('ok')
