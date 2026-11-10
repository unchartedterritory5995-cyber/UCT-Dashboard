// scratch: node undodiff.mjs <attempt dir> ids...: per row, which snapshot keys differ before vs after-undo, and whether each is in the oracle's undo fingerprint (worldPrint)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const [dir, ...ids] = process.argv.slice(2)
const PRINTED = new Set(['charts', 'widgets', 'wl', 'drawings', 'alerts', 'ialerts', 'layouts', 'grid', 'wlCols'])
for (const id of ids) {
  const f = JSON.parse(readFileSync(join(dir, 'failures', id, 'failure.json'), 'utf8'))
  const b = f.before || {}, u = f.undoAfter || {}
  const out = []
  for (const k of [...new Set([...Object.keys(b), ...Object.keys(u)])]) {
    if (JSON.stringify(b[k]) === JSON.stringify(u[k])) continue
    if (k === 'written' || k === 'wlCols') {
      const bk = b[k] || {}, uk = u[k] || {}
      for (const s of [...new Set([...Object.keys(bk), ...Object.keys(uk)])]) if (JSON.stringify(bk[s]) !== JSON.stringify(uk[s]))
        out.push(`${k}.${s}: ${bk[s] === undefined ? 'ABSENT' : 'set'} -> ${uk[s] === undefined ? 'ABSENT' : JSON.stringify(uk[s]).slice(0, 60)}  [${PRINTED.has(k) ? 'IN undo fingerprint' : 'not in undo fingerprint'}]`)
    } else out.push(`${k} differs [${PRINTED.has(k) ? 'IN undo fingerprint' : 'not in undo fingerprint'}]`)
  }
  console.log(`${id} (${f.row.say.join(' | ')})`); for (const o of out) console.log('   ' + o)
}
