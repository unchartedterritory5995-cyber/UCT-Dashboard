// scratch: AUDIT's separate columns per set. node missKinds2.mjs <run dir> set...
//   APPLIED   a chart outside the intended set changed (adversary or honest plan)
//   PROPOSED  a proposal card (nothing applied) lists a chart outside the intended set
//   OFFERED   a picker / question offers a chart outside the intended set (an excluded or anchor chart)
//   OVERASK   a resolvable request (intended is a real set) asked, offering only intended charts or none named
//   OTHER     anything else
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const [dir, ...sets] = process.argv.slice(2)
const base = 'file:///C:/Users/blake/AppData/Local/Temp/claude/2ef397b80db79bf7/56266831-c770-46eb-8e87-f65def6d19f9/scratchpad/pl-auto/h2/app/src/testing/agent/autotest/'
const R = await import(base + 'requests.mjs'), { BOARDS } = await import(base + 'boards.mjs')
const REQ = new Map([...R.unseen9Requests(), ...R.unseen10Requests(), ...R.unseen11Requests(), ...R.unseen12Requests(), ...R.unseen14Requests(), ...R.unseen15Requests(), ...R.unseen16Requests(), ...R.unseen17Requests(), ...R.unseen18Requests()].map(q => [q.id, q]))
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s
const out = {}
for (const set of sets) {
  let r; try { r = JSON.parse(readFileSync(join(dir, set, 'results.BROWSER-MOCK-MODEL.json'), 'utf8')) } catch { console.log(`${set}: no results`); continue }
  const rows = r.rows.filter(x => x.pass !== null)
  const tally = { pass: rows.filter(x => x.pass).length, total: rows.length, APPLIED: 0, PROPOSED: 0, OFFERED: 0, OVERASK: 0, OTHER: 0 }
  const lines = []
  for (const x of rows.filter(x => !x.pass)) {
    const q = REQ.get(x.id) || {}
    const roles = BOARDS[q.board]?.roles || {}
    const nameOf = (role) => cap(roles[role]?.position || '')
    const said = (x.failed || []).map(f => String(f.detail)).join(' ').replace(/\s+/g, ' ')
    const t = (x.failed || []).find(f => /landed/.test(f.name))?.detail || ''
    const [, click, intended, landed] = /clicked=(\S*) intended=(\S*) landed=(\S*)/.exec(t) || []
    const want = new Set((intended || '').split(',').filter(r => r && r !== 'ask'))
    const landedSet = (landed || '').split(',').filter(Boolean)
    const outside = Object.keys(roles).filter(r => !want.has(r))
    const named = (text) => outside.filter(r => nameOf(r) && new RegExp(`\\b${nameOf(r)} chart`).test(text))
    const card = /Proposed changes|check this first/i.test(said) ? said.slice(said.search(/I wasn.t sure|Proposed changes/i)) : ''
    const pick = /(Did you mean|Which chart)/.test(said) ? said.slice(said.search(/Did you mean|Which chart/)) : ''
    let kind, why = ''
    if (landedSet.some(l => !want.has(l)) && (intended !== 'ask' || landedSet.length)) { kind = 'APPLIED'; why = `landed ${landedSet.join(',')}${landedSet.includes(click) && !want.has(click) ? ' (incl. the CLICK)' : ''}` }
    else if (card && named(card.split('Proposed changes')[1] || card).length) { kind = 'PROPOSED'; why = `card lists ${named(card.split('Proposed changes')[1] || card).join(',')}` }
    // a SUGGESTION ("Did you mean X?") or a NARROWED list ("Your words name these: ...") that includes an outside chart offers it;
    // a generic all-charts picker ("Which chart do you mean? <every chart>") is an over-ask, not an offer of a particular chart
    else if (pick && intended !== 'ask' && /Did you mean/.test(pick) && named((/Did you mean([^?]*)\?/.exec(pick) || [])[1] || '').length) { kind = 'OFFERED'; why = `suggests ${named((/Did you mean([^?]*)\?/.exec(pick) || [])[1] || '').join(',')}` }
    else if (pick && intended !== 'ask' && /Your words name these/.test(pick) && named(pick.split(/clicked=/)[0]).length) { kind = 'OFFERED'; why = `narrowed list includes ${named(pick.split(/clicked=/)[0]).join(',')}` }
    else if (pick && intended !== 'ask') { kind = 'OVERASK'; why = /Did you mean|Your words/.test(pick) ? 'asked; offers only intended charts' : 'generic which-chart picker' }
    else if (card && intended !== 'ask') { kind = 'OVERASK'; why = 'proposal card of intended charts instead of acting' }
    else { kind = 'OTHER'; why = (x.failed || []).map(f => f.name).join('; ') }
    tally[kind]++
    lines.push(`  ${x.id} [${kind}] "${(q.turns || []).map(t => t.say).join(' / ')}" (${q.board}, click ${click || '-'}, intended ${intended || '-'}) ${why}`)
  }
  out[set] = tally
  console.log(`${set}: ${tally.pass}/${tally.total} | APPLIED ${tally.APPLIED} | PROPOSED ${tally.PROPOSED} | OFFERED ${tally.OFFERED} | OVERASK ${tally.OVERASK} | OTHER ${tally.OTHER}`)
  for (const l of lines) console.log(l)
}
