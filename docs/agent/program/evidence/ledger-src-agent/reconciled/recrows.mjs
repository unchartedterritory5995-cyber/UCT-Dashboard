// scratch: rows VERIFIED in <tree doc> but not VERIFIED in <master doc>, comma-joined (cls.mjs input)
import { readFileSync } from 'node:fs'
const docRows = (f) => { const L = readFileSync(f, 'utf8').split(/\r?\n/); const s = L.findIndex(l => l.startsWith('## All actions')); const o = {}
  for (const l of L.slice(s)) { const c = l.split('|').map(x => x.trim()); if (/^C[123]-\d+$/.test(c[1] || '')) o[c[1]] = c[4] } return o }
const [m, t] = process.argv.slice(2).map(docRows)
console.log(Object.keys(t).filter(id => /^VERIFIED/.test(t[id]) && !/^VERIFIED/.test(m[id] || '')).join(','))
