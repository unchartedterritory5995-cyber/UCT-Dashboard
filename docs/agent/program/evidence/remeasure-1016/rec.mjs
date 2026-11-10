// reconciled coverage ledger: every in-scope execution row, its state on each tree (that tree's own document + whether that tree's own
// src/agent vitest run re-proved it), and for rows VERIFIED on a branch but not on master: NEW CAPABILITY vs EXISTING CAPABILITY NEWLY VERIFIED
// node rec.mjs <cfg.json> <out.md>
import { readFileSync, writeFileSync } from 'node:fs'
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const docRows = (f) => { const L = readFileSync(f, 'utf8').split(/\r?\n/); const s = L.findIndex(l => l.startsWith('## All actions')); const o = {}
  for (const l of L.slice(s)) { const c = l.split('|').map(x => x.trim()); if (/^C[123]-\d+$/.test(c[1] || '')) o[c[1]] = { area: c[2], action: c[3], state: c[4], ev: c[5] || '' } } return o }
const short = (s) => { s = String(s || ''); return /^VERIFIED/.test(s) ? 'V' : /^PARTIAL/.test(s) ? 'P' : /^IMPLEMENTED/.test(s) ? 'I' : /^MISSING/.test(s) ? 'M' : /^BLOCKED/.test(s) ? 'B' : /^UNMAPPED/.test(s) ? 'U' : s === 'NOT ON /CHARTS' ? 'N' : '?' }
const vit = (f) => { if (!f) return null; const V = JSON.parse(readFileSync(f, 'utf8')); const m = new Map()
  for (const r of V.testResults) { const base = r.name.split(String.fromCharCode(92)).join('/').split('/').pop(); const st = r.assertionResults.map(a => a.status); m.set(base, { pass: st.filter(x => x === 'passed').length, fail: st.filter(x => x === 'failed').length }) } return m }
const T = cfg.trees.map(t => ({ ...t, doc: docRows(t.doc), rc: t.recount ? JSON.parse(readFileSync(t.recount, 'utf8')) : null, cls: t.cls ? JSON.parse(readFileSync(t.cls, 'utf8')) : {}, vit: vit(t.vitest) }))
// a doc-VERIFIED row the recount's reader could not match: every test FILE its citation names ran in that tree's run, all passed
const filesOk = (t, id) => { const ev = t.doc[id]?.ev || ''; const names = [...new Set((ev.match(/[A-Za-z][\w.-]*?\.(?:outcome\.)?test\.jsx?|[a-z][A-Za-z]+\.outcome|agent[A-Z][A-Za-z]+/g) || []))]
  if (!names.length || !t.vit) return false
  return names.every(n => { const hits = [...t.vit.entries()].filter(([b]) => b === n || b.startsWith(n.replace(/\.test\.jsx?$/, '') + '.test.') || b.startsWith(n + '.')); return hits.length && hits.every(([, v]) => v.pass > 0 && v.fail === 0) }) }
const M = T[0]
const ids = Object.keys(M.doc).filter(id => M.doc[id].state !== 'NOT ON /CHARTS')
const cell = (t, id) => { const d = short(t.doc[id]?.state); const r = t.rc?.ledger?.rows?.[id]; const raised = (t.rc?.execution?.raisedByTest || []).includes(id) || (t.rc?.execution?.raisedByBrowser || []).includes(id)
  if (!t.rc) return d; if (r?.executed) return raised && d !== 'V' ? `${d}+R` : `${d}*`; if (d === 'V' && filesOk(t, id)) return 'V~'; return d }
const line = (c) => `| ${c.join(' | ')} |`
const counts = T.map(t => ({ tag: t.tag, docV: ids.filter(id => short(t.doc[id]?.state) === 'V').length, exec: t.rc ? ids.filter(id => t.rc.ledger.rows[id]?.executed).length : null, fileOk: t.rc ? ids.filter(id => !t.rc.ledger.rows[id]?.executed && short(t.doc[id]?.state) === 'V' && filesOk(t, id)).length : null,
  newCap: ids.filter(id => t.cls[id]?.cls === 'NEW CAPABILITY').length, newlyVer: ids.filter(id => t.cls[id]?.cls === 'EXISTING CAPABILITY NEWLY VERIFIED').length }))
const out = [...cfg.head, '',
  line(['Tree', 'Commit', 'Doc VERIFIED (of ' + ids.length + ')', 'Re-proved by its own src/agent run (*)', 'Doc VERIFIED, citation unmatched, its named test files all passed (V~)', 'VERIFIED here, not on master: NEW CAPABILITY', '... EXISTING CAPABILITY NEWLY VERIFIED']), line(Array(7).fill('---')),
  ...T.map((t, i) => line([t.label, t.sha, counts[i].docV, counts[i].exec ?? 'not run', counts[i].fileOk ?? '-', i ? counts[i].newCap : '-', i ? counts[i].newlyVer : '-'])), '',
  ...cfg.legend, '',
  line(['Row', 'Area', 'Action', ...T.map(t => t.tag), 'Not on master: class (tree)', 'Product commits (not upstream)']), line(Array(5 + T.length).fill('---')),
  ...ids.map(id => { const c = T.slice(1).map(t => t.cls[id] ? { t, ...t.cls[id] } : null).filter(Boolean)
    const cls = [...new Set(c.map(x => x.cls))].map(k => `${k} (${c.filter(x => x.cls === k).map(x => x.t.tag).join(',')})`).join('; ')
    const pc = [...new Set(c.flatMap(x => [...x.productCommits, ...x.actionsNotOnMaster.map(a => `new action ${a}`)]))].join(', ')
    return line([id, M.doc[id].area, M.doc[id].action, ...T.map(t => cell(t, id)), cls, pc]) }),
  '', ...cfg.tail]
writeFileSync(process.argv[3], out.join('\n') + '\n')
console.log(JSON.stringify(counts))
