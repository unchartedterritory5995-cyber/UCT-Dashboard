// UCT Agent AUTOTEST: the request set's own checks. Free, deterministic, no browser. A request is only usable when
//   • its oracle is machine-checkable (a known outcome, known ops, at least one check, or a stated reason it has none);
//   • every scripted action exists in the manifest, with arguments its schema accepts;
//   • its board and inventory rows exist; ids are unique; no phrasing repeats (the held-out set is checked against this one).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOARDS } from './boards.mjs'
import { OUTCOMES, OPS } from './oracle.mjs'
import { KINDS } from './families/dsl.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const loadManifest = () => JSON.parse(readFileSync(join(here, '../../../agent/contract/manifest.golden.json'), 'utf8')).capabilities
export const loadInventory = () => JSON.parse(readFileSync(join(here, 'inventory.ids.json'), 'utf8')).rows

const typeOk = (v, t) => (t === 'null' ? v === null : t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' : t === 'array' ? Array.isArray(v) : t === 'object' ? v && typeof v === 'object' && !Array.isArray(v) : typeof v === t)
/** A small JSON-schema check, enough to catch a typo in a scripted plan. Strings that are tokens ($...) pass. */
export function schemaErrors(args, schema, invalidOk) {
  const errs = []
  const props = schema?.properties || {}
  if (invalidOk) return errs
  for (const k of schema?.required || []) if (!(k in args)) errs.push(`missing ${k}`)
  for (const [k, v] of Object.entries(args)) {
    if (!(k in props)) { if (schema?.additionalProperties === false) errs.push(`unknown ${k}`); continue }
    if (typeof v === 'string' && v.startsWith('$')) continue
    const p = props[k]
    if (p.enum && !p.enum.includes(v)) errs.push(`${k}=${JSON.stringify(v)} not in enum`)
    const ts = Array.isArray(p.type) ? p.type : p.type ? [p.type] : []
    if (ts.length && !ts.some(t => typeOk(v, t))) errs.push(`${k} is not ${ts.join('|')}`)
  }
  return errs
}
export const normPhrase = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function lint(list, { other = [] } = {}) {
  const caps = new Map(loadManifest().map(c => [c.name, c]))
  const inv = loadInventory()
  const errs = []
  const ids = new Set(), said = new Set(other.flatMap(r => r.turns.map(t => normPhrase(t.say))))
  for (const r of list) {
    const e = (m) => errs.push(`${r.id}: ${m}`)
    if (ids.has(r.id)) e('duplicate id')
    ids.add(r.id)
    if (!KINDS.includes(r.kind)) e(`unknown kind ${r.kind}`)
    if (!BOARDS[r.board]) e(`unknown board ${r.board}`)
    if (r.select && !BOARDS[r.board]?.roles[r.select]) e(`no chart ${r.select} on ${r.board}`)
    for (const id of r.inventory) if (!inv[id]) e(`unknown inventory row ${id}`)
    if (!r.inventory.length) e('no inventory row')
    const o = r.oracle
    if (!o || !OUTCOMES.includes(o.outcome)) { e('no oracle outcome'); continue }
    for (const c of [...(o.expect || []), ...(o.persist || [])]) if (!OPS.includes(c[1])) e(`unknown oracle op ${c[1]}`)
    if (o.outcome === 'change' && !(o.expect || []).length && !r.unverifiable.length) e('a change with no state check and no stated reason')
    if (o.outcome === 'walkthrough' && !o.guide?.steps?.length) e('a walkthrough with no steps')
    if (o.only) for (const role of o.only) if (!BOARDS[r.board]?.roles[role]) e(`oracle names chart ${role}, not on ${r.board}`)
    for (const c of o.expect || []) {
      const head = String(c[0]).split('.')[0]
      if (/^[A-Z]{1,2}$/.test(head) && !BOARDS[r.board]?.roles[head]) e(`check on chart ${head}, not on ${r.board}`)
    }
    for (const t of r.turns) {
      if (t.act) continue
      const key = normPhrase(t.say)
      if (key !== 'undo' && r.turns.length === 1 && said.has(key)) e(`phrasing repeats: ${t.say}`)
      if (r.turns.length === 1) said.add(key)
      for (const op of t.plan?.ops || []) {
        const c = caps.get(op.action)
        if (!c) { e(`no capability ${op.action}`); continue }
        for (const x of schemaErrors(op.args, c.args, r.kind === 'invalid' || o.outcome === 'refuse')) e(`${op.action}: ${x}`)
      }
    }
  }
  return errs
}

export function summarize(list) {
  const by = (k) => { const m = {}; for (const r of list) m[r[k]] = (m[r[k]] || 0) + 1; return m }
  return { requests: list.length, turns: list.reduce((n, r) => n + r.turns.length, 0), byKind: by('kind'), byFamily: by('family'), byBoard: by('board'), byOutcome: list.reduce((m, r) => { m[r.oracle.outcome] = (m[r.oracle.outcome] || 0) + 1; return m }, {}), inventoryRows: new Set(list.flatMap(r => r.inventory)).size }
}
