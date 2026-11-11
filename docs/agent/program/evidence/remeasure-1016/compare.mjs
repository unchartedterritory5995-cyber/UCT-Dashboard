// Old (S, stale install) vs new (N, verified install) per part and per area, from rec.mjs's ledger.md row table.
//   node compare.mjs <ledger.md>
import { readFileSync } from 'node:fs'
const L = readFileSync(process.argv[2], 'utf8').split(/\r?\n/)
const hi = L.findIndex(l => l.startsWith('| Row |'))
const hdr = L[hi].split('|').map(x => x.trim()), iN = hdr.indexOf('N'), iS = hdr.indexOf('S')
const rows = L.slice(hi + 2).filter(l => /^\| C[123]-\d+ \|/.test(l)).map(l => { const c = l.split('|').map(x => x.trim()); return { id: c[1], area: c[2], N: c[iN], S: c[iS] } })
const k = (cell) => cell === 'V*' ? 'reproved' : cell === 'V~' ? 'fileLevel' : /^V/.test(cell) ? 'notReproved' : 'notV'
const agg = (key) => { const m = new Map(); for (const r of rows) { const g = key(r); if (!m.has(g)) m.set(g, { S: {}, N: {}, n: 0 }); const o = m.get(g); o.n++
  for (const t of ['S', 'N']) { const x = k(r[t]); o[t][x] = (o[t][x] || 0) + 1 } } return m }
const f = (o, t) => { const v = (o[t].reproved || 0) + (o[t].fileLevel || 0) + (o[t].notReproved || 0); return `${v} | ${o[t].reproved || 0} | ${o[t].fileLevel || 0} | ${o[t].notReproved || 0}` }
const table = (title, m) => [`## ${title}`, '', '| Group | In scope | OLD doc V | OLD V* | OLD V~ | OLD not re-proved | NEW doc V | NEW V* | NEW V~ | NEW not re-proved |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...[...m].map(([g, o]) => `| ${g} | ${o.n} | ${f(o, 'S')} | ${f(o, 'N')} |`), '']
const all = agg(() => 'ALL'), part = agg(r => r.id.slice(0, 2)), area = agg(r => `${r.id.slice(0, 2)} ${r.area}`)
const changed = rows.filter(r => r.N !== r.S)
console.log(['# #1016 re-measure: old (stale install, VOID) vs new (verified install)', '',
  'V* = every citation matched a passed test in that run; V~ = citation unmatched, all its named test files passed; not re-proved = neither.', '',
  ...table('Total', all), ...table('By part', part), ...table('By area', area),
  `## Rows whose cell differs (${changed.length})`, '', '| Row | Area | OLD | NEW |', '|---|---|---|---|', ...changed.map(r => `| ${r.id} | ${r.area} | ${r.S} | ${r.N} |`)].join('\n'))
