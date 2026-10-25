// Wave 10 (Task 10.16): the catalog "Your own fields" reads, for tests. Tests only; nothing in the product imports it.
//
// It is the REAL server catalog (`serverCatalog.json`) plus the two things Task 10.9 will serve and does not yet:
//   * `formats`: the formula formats, be `widget_engine/plan.py` FORMULA_FORMATS = ("number", "money", "percent",
//     "r"), with the words the builder shows (Task 10.16 brief: Number, Money, Percent, R);
//   * per field `hourKey` and `needsTimes`: be `widget_engine/sources.py` (closed trades: `day` has
//     hour_key="hour_et"; `hold_minutes` has needs_times=True), which `plan.formula_field_infos` hands the dialect
//     (`widget_formula.FieldInfo(hour_key, needs_times)`).
// The functions, the limits and the function docs are NOT here: the builder reads them from the formula twin
// (`lib/widgetFormula`), which the shared vector file binds to the server.
import { CATALOG } from './builderFixtures'

export const FORMATS = Object.freeze([
  { key: 'number', label: 'Number' }, { key: 'money', label: 'Money' }, { key: 'percent', label: 'Percent' },
  { key: 'r', label: 'R' },
])

const FIELD_EXTRAS = new Map([
  ['closed_trades', new Map([['day', { hourKey: 'hour_et' }], ['hold_minutes', { needsTimes: true }]])],
])

export const FORMULA_CATALOG = {
  ...CATALOG,
  formats: FORMATS,
  sources: CATALOG.sources.map((s) => {
    const extras = FIELD_EXTRAS.get(s.key)
    if (!extras) return s
    return { ...s, fields: s.fields.map((f) => (extras.has(f.key) ? { ...f, ...extras.get(f.key) } : f)) }
  }),
}
