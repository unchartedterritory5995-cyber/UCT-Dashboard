// scratch: node wtcmp.mjs <head vitest json> <fail_master.txt> <census_master.json> -> head totals, fail files, set diff vs master, census offenders diff
import { readFileSync } from 'node:fs'
const [hp, mf, cf] = process.argv.slice(2)
const r = JSON.parse(readFileSync(hp, 'utf8'))
const norm = (n) => n.split(String.fromCharCode(92)).join('/').replace(/.*\/app\//, '')
const files = r.testResults.map(t => ({ f: norm(t.name), st: t.status, a: t.assertionResults }))
const hf = new Set(files.filter(x => x.st !== 'passed' && x.st !== 'skipped').map(x => x.f))
const fileFail = files.filter(x => x.st === 'failed').length, filePass = files.filter(x => x.st === 'passed').length
console.log(`HEAD files ${fileFail} failed | ${filePass} passed (${files.length}); tests ${r.numFailedTests} failed | ${r.numPassedTests} passed | ${r.numPendingTests + r.numTodoTests} skipped (${r.numTotalTests})`)
const mset = new Set(readFileSync(mf, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean))
console.log('head-only fails:'); for (const f of [...hf].sort()) if (!mset.has(f)) console.log('  + ' + f)
console.log('master-only fails (fixed or not run on head):'); for (const f of [...mset].sort()) if (!hf.has(f)) console.log('  - ' + f)
console.log('both:', [...hf].filter(f => mset.has(f)).length)
const C = JSON.parse(readFileSync(cf, 'utf8'))
for (const [f, tests] of Object.entries(C)) {
  const h = files.find(x => x.f === f); if (!h) { console.log(`census ${f}: not in head run`); continue }
  for (const t of tests) {
    const a = h.a.find(a => a.fullName.replace(/\s+/g, ' ').trim() === t.title.replace(/\s+>\s+/g, ' ').replace(/\s+/g, ' ').trim()) || h.a.find(a => t.title.endsWith(a.title))
    const msg = a ? (a.failureMessages || []).join('\n') : ''
    const mo = (t.offenders || []).map(o => o.replace(/^\+\s*/, '').replace(/,$/, '').trim()).filter(o => o && o !== 'Received')
    const ho = mo.length || msg ? [...msg.matchAll(/^\+\s+(".*?"),?$/gm)].map(m => m[1]) : []
    const extra = ho.filter(o => !mo.includes(o)), gone = mo.filter(o => !ho.includes(o))
    console.log(`census ${f} :: ${t.title.slice(0, 80)} -> head ${a ? a.status : 'NOT FOUND'}; master offenders ${mo.length}, head ${ho.length}; head-only ${extra.length}${extra.length ? ' ' + extra.join(' ') : ''}; master-only ${gone.length}`)
  }
}
