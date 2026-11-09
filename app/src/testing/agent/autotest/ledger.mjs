// UCT Agent AUTOTEST: the COVERAGE LEDGER. Development coverage kept apart from what members can do TODAY.
//
//   node src/testing/agent/autotest/ledger.mjs --d <recount json> --d-label "<tree>" --p <recount json> --p-label "<tree>" --out <md>
//
// Each recount JSON is recount.mjs --out run on that tree (its own vitest JSON and its own browser results, its own inventory
// documents). Column D = the newest development branches; column P = the production tree (origin/master with only the harness files
// added); column R = a real model in a real production browser: NOT MEASURED (it needs a bounded paid run the owner and AUDIT agree).
// Per family (the inventory's area): execution rows counted, P0 rows counted, walkthrough rows VERIFIED in that tree's teach document.
// Read-only: it writes the one Markdown file it is given.
import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync } from 'node:fs'

const { values: A } = parseArgs({ options: {
  d: { type: 'string' }, 'd-label': { type: 'string', default: 'development' }, p: { type: 'string' }, 'p-label': { type: 'string', default: 'production' }, out: { type: 'string' }, note: { type: 'string', multiple: true, default: [] },
} })
const D = JSON.parse(readFileSync(A.d, 'utf8')), P = JSON.parse(readFileSync(A.p, 'utf8'))
for (const [n, x] of [['d', D], ['p', P]]) if (!x.ledger) throw new Error(`--${n}: a recount JSON from a recount.mjs that writes the ledger section`)

const areas = [...new Set(Object.values(D.ledger.rows).map(r => r.area))]
const count = (X, area, fn) => Object.entries(X.ledger.rows).filter(([, r]) => r.area === area && fn(r)).length
const line = (cells) => `| ${cells.join(' | ')} |`
const rows = areas.map(area => {
  const inScope = count(D, area, () => true)
  const p0 = count(D, area, r => r.p0)
  return { area, inScope, p0,
    dExec: count(D, area, r => r.executed), pExec: count(P, area, r => r.executed),
    dP0: count(D, area, r => r.p0 && r.executed), pP0: count(P, area, r => r.p0 && r.executed),
    dTeach: count(D, area, r => r.teach === 'VERIFIED'), pTeach: count(P, area, r => r.teach === 'VERIFIED') }
})
const tot = (k) => rows.reduce((n, r) => n + r[k], 0)
const md = [
  '# Charts Agent coverage ledger',
  '',
  'Development coverage, kept apart from what members can do today. Regenerate with `node src/testing/agent/autotest/ledger.mjs` (from `app/`); the command and inputs are below.',
  '',
  `- **D (development):** ${A['d-label']}`,
  `- **P (production tree):** ${A['p-label']}`,
  '- **R (real model, real production browser):** not measured. It needs a bounded paid run that the owner and AUDIT agree to.',
  '',
  '**Method.** Scripted model (BROWSER-MOCK-MODEL) in a local headless browser on the agent harness with fixture data, plus the `src/agent` vitest suite of the same tree, counted by `recount.mjs`. An execution row counts when every test its inventory evidence cites passed, or when every browser request naming the row passed (one failure takes it out). Refusals, how-to and unsupported requests never count as execution. Walkthrough rows are the VERIFIED rows of that tree\'s own `CHARTS_TEACH_STATUS.md`: the recount cannot re-prove a walkthrough. A request names every row of its family, so browser counts are an upper bound.',
  '',
  line(['Family (area)', 'In scope', 'Exec D', 'Exec P', 'P0 rows', 'P0 D', 'P0 P', 'Walkthrough D', 'Walkthrough P', 'R']),
  line(Array(10).fill('---')),
  ...rows.map(r => line([r.area, r.inScope, r.dExec, r.pExec, r.p0, r.dP0, r.pP0, r.dTeach, r.pTeach, 'not measured'])),
  line(['**Total**', tot('inScope'), tot('dExec'), tot('pExec'), tot('p0'), tot('dP0'), tot('pP0'), tot('dTeach'), tot('pTeach'), 'not measured']),
  '',
  `Inputs: D = \`${D.ledger.source}\`; P = \`${P.ledger.source}\`.`,
  '',
  ...(A.note.length ? ['**Notes.**', '', ...A.note.map(n => `- ${n}`), ''] : []),
].join('\n')
writeFileSync(A.out, md)
console.log(JSON.stringify({ areas: rows.length, total: { inScope: tot('inScope'), dExec: tot('dExec'), pExec: tot('pExec'), p0: tot('p0'), dP0: tot('dP0'), pP0: tot('pP0'), dTeach: tot('dTeach'), pTeach: tot('pTeach') } }))
