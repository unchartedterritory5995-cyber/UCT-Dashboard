// app/src/components/chart/engine/pineDataCatalog.js
//
// ─── THE CHART'S HALF OF THE PINE DATA FAMILIES (data unit S4-0, 2026-11-19) ──────────────────
//
// `pineDataCatalog.json` names every non-price series a member's Pine script may read: the
// TradingView-compatible built-ins (`request.earnings`, `request.dividends`, `request.splits`,
// `request.financial`) and UCT's own series (`uct.*`, `UCT:` symbols). This module answers, for a
// family or one Pine spelling, whether it may be served, and if not, the sentence that refuses it.
//
// ⭐ ONE AUTHORITY FOR THE CLASS: `api/services/provider_licensing_class.py`. The chart cannot import
// it, so each family's `licence` block is GENERATED from it (`python -m api.services.pine_data_catalog
// --write`) and tests/test_pine_data_catalog.py fails when the block and the table disagree. This module
// reads the block and decides nothing the server's half (`api/services/pine_data_catalog.py`) does not:
// same JSON, same templates, same order (unknown, then licence, then hold).
//
// ⛔ A REFUSAL REACHES THE MEMBER, so it names the Pine spellings, the family's label, the class and the
// register row, and NEVER the vendor (register T-46: a vendor may forbid being named as the source).
//
// Nothing reads this yet: the supply that will is S4-3 onward.
import CATALOG from './pineDataCatalog.json'

export const DATA_LICENCE_GUARD = 'data:licence'
export const DATA_UNKNOWN_GUARD = 'data:unknown-family'
export const DATA_FIELD_GUARD = 'data:field-unserved'

const fill = (template, values) => Object.entries(values)
  .reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), template)

const namesOf = (spec) => (spec.pine || []).join('`, `')

const rowText = (row) => (!row || row === 'n/a' ? 'no licensing register row' : `licensing register row ${row}`)

const own = (obj, key) => (obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined)

/** The family a Pine spelling belongs to, or null. A `UCT:` spelling takes the longest declared prefix. */
export function dataFamilyOf(name, catalog = CATALOG) {
  const s = String(name == null ? '' : name).trim()
  if (!s) return null
  let best = null
  let bestLen = -1
  for (const [fam, spec] of Object.entries(catalog.families || {})) {
    if (spec.refusedNames && Object.prototype.hasOwnProperty.call(spec.refusedNames, s)) return fam
    for (const declared of spec.pine || []) {
      const hit = declared.endsWith(':') ? s.toUpperCase().startsWith(declared.toUpperCase()) : s === declared
      if (hit && declared.length > bestLen) { best = fam; bestLen = declared.length }
    }
  }
  return best
}

/** null when the family may be served; else `{guard, message}` naming it. */
export function dataFamilyRefusal(family, catalog = CATALOG) {
  const sentences = catalog.sentences
  const spec = own(catalog.families, family)
  if (!spec) return { guard: DATA_UNKNOWN_GUARD, message: fill(sentences.unknown, { family }) }
  const servable = new Set((catalog.rules && catalog.rules.servableClasses) || [])
  const lic = spec.licence || null
  // ⛔ A family with no generated block is unlicensed here: the chart never infers a class.
  const cls = lic && lic.class ? lic.class : 'U'
  if (!servable.has(cls)) {
    return { guard: DATA_LICENCE_GUARD, message: fill(sentences.licence, {
      names: namesOf(spec), label: spec.label, class: cls, rowText: rowText(lic && lic.registerRow) }) }
  }
  if (spec.hold) {
    return { guard: spec.hold.code, message: fill(sentences.hold, { names: namesOf(spec), reason: spec.hold.reason }) }
  }
  return null
}

/** The decision for ONE Pine spelling (a field the family never serves is refused by its own sentence). */
export function dataNameRefusal(name, catalog = CATALOG) {
  const fam = dataFamilyOf(name, catalog)
  if (fam === null) return { guard: DATA_UNKNOWN_GUARD, message: fill(catalog.sentences.unknown, { family: name }) }
  const reason = own(catalog.families[fam].refusedNames, name)
  if (reason !== undefined) return { guard: DATA_FIELD_GUARD, message: fill(catalog.sentences.field, { name, reason }) }
  return dataFamilyRefusal(fam, catalog)
}

/** The sentence the member door shows beside a served family's values. */
export function dataDisclosure(family, catalog = CATALOG) {
  const spec = own(catalog.families, family)
  return spec ? spec.disclosure : null
}

export { CATALOG as PINE_DATA_CATALOG }
