// scratch: node censcmp.mjs <default-reporter log> <census_master.json>: offender-level compare per census test (master side from its 'full' text)
import { readFileSync } from 'node:fs'
const [lf, cf] = process.argv.slice(2)
const CR = String.fromCharCode(13)
const log = readFileSync(lf, 'utf8').split(CR).join('')
const blocks = log.split(/\n(?= FAIL  )/).filter(b => b.startsWith(' FAIL  '))
const C = JSON.parse(readFileSync(cf, 'utf8'))
const clean = (s) => s.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim()
const offs = (lines) => lines.filter(l => /^\+\s+"/.test(l)).map(l => clean(l.replace(/^\+\s+/, '').replace(/,$/, '')))
const key = (s) => clean(s)
const uniq = (a) => [...new Set(a)]
let headOnlyTotal = 0
for (const [f, tests] of Object.entries(C)) for (const t of tests) {
  const mo = uniq(offs(String(t.full || '').split(CR).join('').split('\n')))
  const b = blocks.find(b => b.includes(f) && key(b.split('\n').slice(0, 3).join(' ')).includes(key(t.title).slice(-40)))
  if (!b) { console.log(`${f} :: ${key(t.title).slice(0, 70)} -> head NOT FAILING (or title not matched); master offenders ${mo.length}`); continue }
  const ho = uniq(offs(b.split('\n')))
  const extra = ho.filter(o => !mo.includes(o)); headOnlyTotal += extra.length
  console.log(`${f} :: ${key(t.title).slice(0, 70)} -> master ${mo.length}, head ${ho.length}, head-only ${extra.length}, master-only ${mo.filter(o => !ho.includes(o)).length}`)
  for (const e of extra) console.log('     + ' + e)
}
console.log('head-only offenders total', headOnlyTotal, '| head FAIL blocks', blocks.length)
