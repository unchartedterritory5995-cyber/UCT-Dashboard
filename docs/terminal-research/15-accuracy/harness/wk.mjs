import fs from 'fs'
const M = await import('file:///C:/Users/pgosz/uct-worktrees/tf4-accuracy/app/src/pages/terminal/panels/relativeMath.js')
const W = JSON.parse(fs.readFileSync('weekly_yf.json'))
const D = JSON.parse(fs.readFileSync('daily.json'))
// SPY weekly the way the equity store keys it: last daily close of each ISO week, Friday key
const byWk = new Map()
for (const r of D.SPY) { const k = M.isoWeekFriday(r.d); byWk.set(k, r.c) }
const spyW = { bars: [...byWk].filter(([k]) => k >= '2025-06-01').map(([t, c]) => ({ t, c })) }
const gspcIdx = { bars: W['^GSPC'].map(r => ({ t: r.ts, c: r.c })) }
const old = M.rrgPath(M.closesFromBars(gspcIdx), M.closesFromBars(spyW))
const neu = M.rrgPath(M.closesFromBars(gspcIdx, { weekly: true }), M.closesFromBars(spyW, { weekly: true }))
console.log('before fix:', old)
console.log('after fix :', neu && { ratio: neu.ratio, momentum: neu.momentum, quadrant: neu.quadrant, asOf: neu.asOf, tail: neu.tail.length })
