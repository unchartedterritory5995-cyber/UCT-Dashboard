// scratch: node nmdiff.mjs <nmA> <nmB>: top-level package versions that differ / are missing
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const list = (d) => { const o = {}; for (const n of readdirSync(d)) { if (n.startsWith('.')) continue; const ns = n.startsWith('@') ? readdirSync(join(d, n)).map(x => n + '/' + x) : [n]; for (const p of ns) { const f = join(d, p, 'package.json'); if (existsSync(f)) try { o[p] = JSON.parse(readFileSync(f, 'utf8')).version } catch { o[p] = '?' } } } return o }
const [a, b] = process.argv.slice(2).map(list)
for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) if (a[k] !== b[k]) console.log(k, a[k] ?? '-', '=>', b[k] ?? '-')
