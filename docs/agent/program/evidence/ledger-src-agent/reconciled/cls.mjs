// classify rows VERIFIED on a tree but not on master: NEW CAPABILITY (product code added for it) vs EXISTING CAPABILITY NEWLY VERIFIED
import { readFileSync } from 'node:fs'
const [dir, tree, rowsCsv] = process.argv.slice(2)
const rd = (f) => readFileSync(`${dir}/${f}`, 'utf8')
const docRows = (sha) => { const L = rd(`../docs/${sha}.md`).split(/\r?\n/); const s = L.findIndex(l => l.startsWith('## All actions')); const o = {}
  for (const l of L.slice(s)) { const c = l.split('|').map(x => x.trim()); if (/^C[123]-\d+$/.test(c[1] || '')) o[c[1]] = { state: c[4], ev: c[5] } } return o }
const T = docRows(tree)
const capsM = new Set(rd('caps-origin_master.txt').split(/\r?\n/).filter(Boolean)), capsT = new Set(rd(`caps-${tree}.txt`).split(/\r?\n/).filter(Boolean))
const product = (f) => /^app\/src\//.test(f) && !/\.test\.|\/qa\/|\/testing\/|__fixtures__|\.md$|\.snap$|manifest\.golden|\/capabilityRegression\//.test(f)
const commits = rd(`${tree}.log`).split('@@').filter(Boolean).map(b => { const [h, ...rest] = b.split('\n'); const files = rest.filter(l => /^[\w.-]+\//.test(l) && !/\s/.test(l)); return { h: h.slice(0, 10), msg: rest.filter(l => !files.includes(l)).join('\n'), files } })
const rows = rowsCsv ? rowsCsv.split(',') : []
const out = {}
for (const id of rows) {
  const named = commits.filter(c => new RegExp('(^|[^0-9-])' + id + '([^0-9]|$)').test(c.msg))
  const prodC = named.filter(c => c.files.some(product))
  const acts = [...new Set(((T[id]?.ev || '').match(/[a-z][a-zA-Z]+[.][a-z][a-zA-Z]+/g) || []).filter(a => capsT.has(a)))]
  const newActs = acts.filter(a => !capsM.has(a))
  const cls = prodC.length || newActs.length ? 'NEW CAPABILITY' : 'EXISTING CAPABILITY NEWLY VERIFIED'
  out[id] = { cls, productCommits: prodC.map(c => c.h), testOnlyCommits: named.filter(c => !prodC.includes(c)).map(c => c.h), actions: acts, actionsNotOnMaster: newActs }
}
console.log(JSON.stringify(out, null, 1))
