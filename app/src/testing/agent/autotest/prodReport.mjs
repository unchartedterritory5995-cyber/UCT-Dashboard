// UCT Agent AUTOTEST: the PRODUCTION canary report. Value-free: ids, families, booleans, role names, check names and dollars of
// the Agent budget. No panel text, no axis text, no widget faces, no prices.
//
//   wrongTargetOf(row, req)   at run time (productionTarget), from the FULL row (with failure details, in memory only) ->
//                             { kind: APPLIED|PROPOSED|OFFERED|OVERASK|null, roles: [role names] }. Only this result is stored.
//   node src/testing/agent/autotest/prodReport.mjs <run dir> [<cap status before.json> <cap status after.json>]
//                             -> the table: per row pass / layer / first check / wrong target / rendering / ledger $ / server $,
//                                and the spend side by side (eval ledger delta vs the production server's own budget delta).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BOARDS } from './boards.mjs'

const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s

/** The same rules as pl-auto's missKinds3 (APPLIED > PROPOSED > OFFERED > OVERASK), returning role names only. */
export function wrongTargetOf(row, req) {
  if (!row || row.pass !== false) return { kind: null, roles: [] }
  const roles = BOARDS[req?.board]?.roles || {}
  const nameOf = (role) => cap(roles[role]?.position || '')
  const said = (row.failed || []).map(f => String(f.detail ?? '')).join(' ').replace(/\s+/g, ' ')
  const t = (row.failed || []).find(f => /landed/.test(f.name))?.detail || ''
  const [, , intended, landed] = /clicked=(\S*) intended=(\S*) landed=(\S*)/.exec(t) || []
  const want = new Set((intended || '').split(',').filter(r => r && r !== 'ask'))
  const landedSet = (landed || '').split(',').filter(Boolean)
  const outside = Object.keys(roles).filter(r => !want.has(r))
  const named = (text) => outside.filter(r => nameOf(r) && new RegExp(`\\b${nameOf(r)} chart`).test(text))
  const card = /Proposed changes|check this first/i.test(said) ? said.slice(said.search(/I wasn.t sure|Proposed changes/i)) : ''
  const pick = /(Did you mean|Which chart)/.test(said) ? said.slice(said.search(/Did you mean|Which chart/)) : ''
  // a role the request did not target changed (the oracle's `<role> untouched` check, tag target)
  const untouched = (row.failed || []).filter(f => / untouched$/.test(f.name)).map(f => f.name.replace(/ untouched$/, ''))
  if (untouched.length) return { kind: 'APPLIED', roles: untouched }
  if (landedSet.some(l => !want.has(l)) && (intended !== 'ask' || landedSet.length)) return { kind: 'APPLIED', roles: landedSet.filter(l => !want.has(l)) }
  const c = card && named(card.split('Proposed changes')[1] || card)
  if (c && c.length) return { kind: 'PROPOSED', roles: c }
  const dm = pick && intended !== 'ask' && /Did you mean/.test(pick) ? named((/Did you mean([^?]*)\?/.exec(pick) || [])[1] || '') : []
  if (dm.length) return { kind: 'OFFERED', roles: dm }
  const nl = pick && intended !== 'ask' && /Your words name these/.test(pick) ? named(pick.split(/clicked=/)[0]) : []
  if (nl.length) return { kind: 'OFFERED', roles: nl }
  if ((pick || card) && intended !== 'ask') return { kind: 'OVERASK', roles: [] }
  return { kind: null, roles: [] }
}

const RENDER_TAGS = new Set(['repaint', 'prewarm', 'console', 'guide'])
const money = (n) => n == null ? 'n/a' : `$${Number(n).toFixed(4)}`

export function report(dir, before = null, after = null) {
  const r = JSON.parse(readFileSync(join(dir, 'results.REAL-MODEL.json'), 'utf8'))
  const rows = r.rows || []
  const lines = ['| id | family | pass | layer | first check | wrong target | rendering | settled $ (= server delta) |', '|---|---|---|---|---|---|---|---|']
  const tally = { APPLIED: 0, PROPOSED: 0, OFFERED: 0, OVERASK: 0 }
  for (const x of rows) {
    const wt = x.wt?.kind ? `${x.wt.kind}${x.wt.roles?.length ? ` (${x.wt.roles.join(',')})` : ''}` : '-'
    if (x.wt?.kind) tally[x.wt.kind]++
    const rend = (x.failed || []).filter(f => RENDER_TAGS.has(f.tag)).map(f => f.tag)
    lines.push(`| ${x.id} | ${x.family} | ${x.pass === true ? 'PASS' : x.pass === false ? 'FAIL' : 'not run'} | ${x.pass === false ? x.layer || '?' : '-'} | ${x.pass === false ? x.firstCheck || '?' : '-'} | ${wt} | ${rend.length ? [...new Set(rend)].join(',') : 'ok'} | ${x.usd == null ? 'worst case' : money(x.usd)} |`)
  }
  const m = r.meta || {}
  const serverDelta = m.budgetStart != null && m.budgetEnd != null ? m.budgetEnd - m.budgetStart : null
  const rowSum = rows.reduce((n, x) => n + (x.usd ?? 0.25 * Math.max(1, x.turnsCount || 1)), 0)
  const ledgerDelta = before && after ? after.program_committed_usd - before.program_committed_usd : null
  const out = [
    `requests ${rows.length} · passed ${rows.filter(x => x.pass === true).length} · failed ${rows.filter(x => x.pass === false).length}`,
    `wrong target: APPLIED ${tally.APPLIED} · PROPOSED ${tally.PROPOSED} · OFFERED ${tally.OFFERED} · over-ask ${tally.OVERASK}`,
    `restored: ${m.restored ?? '?'} · protected state changed: ${(m.protectedChanged || []).length ? m.protectedChanged.join(',') : 'none'} · write violation: ${m.violation || 'none'}`,
    '', '| spend | dollars |', '|---|---|',
    `| eval ledger, program committed delta (cap status after - before) | ${money(ledgerDelta)} |`,
    `| production server budget delta (/api/agent/budget committed_usd, run end - run start) | ${money(serverDelta)} |`,
    `| sum of per-request settles (worst case where unknown) | ${money(rowSum)} |`,
    '', ...lines,
  ]
  return out.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [dir, b, a] = process.argv.slice(2)
  const rd = (p) => p ? JSON.parse(readFileSync(p, 'utf8')) : null
  console.log(report(dir, rd(b), rd(a)))
}
