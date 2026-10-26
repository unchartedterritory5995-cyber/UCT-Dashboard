// Wave 10 (Task 10.17): the catalog with Options strategies and Notes in it, for the builder's tests. Tests only.
//
// `w10Catalog.json` is GENERATED from the router: `notebook_widget_definitions._static_vocabulary(tools=True, w10=True)`
// with note kinds offered, written by `tests/test_widget_definitions_router.py::write_vocabulary_fixture` beside
// `serverCatalog.json` and railed current by `test_builder_server_catalog_fixture_is_current`. Never hand-edit it.
import W10 from './w10Catalog.json'

/** The catalog wave 10 serves (wave 9 on too). */
export const W10_CATALOG = W10

/** The same catalog with note kinds NOT offered (W10-R62: the notes source's `kind` field is then not listed). */
export const W10_CATALOG_NO_KINDS = {
  ...W10,
  sources: W10.sources.map((s) => (s.key === 'notes' ? { ...s, fields: s.fields.filter((f) => f.key !== 'kind') } : s)),
}

/** A deep copy of the wave 10 catalog with `edit(notes source row)` applied: a server entry removed or changed, to
 *  prove the builder offers what the catalog serves and nothing else. */
export function w10With(edit) {
  const cat = JSON.parse(JSON.stringify(W10))
  edit(cat.sources.find((s) => s.key === 'notes'), cat)
  return cat
}

/** The two sources' rows as the server serves them. */
export const sourceRow = (key) => W10.sources.find((s) => s.key === key)

// The member's values as `GET /vocabulary?field=` answers them (`_w10_member_values`): `{id, name}` for a strategy,
// folder or kind; `{id, name, type}` for a property (uuid4 hex ids); strings for the rest.
export const P_CONV = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
export const P_GRADE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
export const P_DONE = 'cccccccccccccccccccccccccccccccc'
export const P_RISK = 'dddddddddddddddddddddddddddddddd'
export const P_LINKS = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
export const P_WHY = 'ffffffffffffffffffffffffffffffff'
export const OPT_A = '11111111111111111111111111111111'
export const OPT_B = '22222222222222222222222222222222'
export const PROPERTIES = [
  { id: P_CONV, name: 'Conviction', type: 'number' },
  { id: P_GRADE, name: 'Grade', type: 'select' },
  { id: P_DONE, name: 'Reviewed', type: 'checkbox' },
  { id: P_RISK, name: 'Risk taken', type: 'number' },
  { id: P_LINKS, name: 'Related', type: 'relation' },
  { id: P_WHY, name: 'Why', type: 'text' },
]
/** `GET /api/j2/property-defs` for the same member (`{propertyDefs}`; a select carries its options). */
export const PROPERTY_DEFS = {
  propertyDefs: [
    { id: P_CONV, name: 'Conviction', type: 'number', source: 'user_set', options: [] },
    { id: P_GRADE, name: 'Grade', type: 'select', source: 'user_set', options: [{ id: OPT_A, label: 'A+', color: 'green' }, { id: OPT_B, label: 'B', color: 'gray' }] },
    { id: P_DONE, name: 'Reviewed', type: 'checkbox', source: 'user_set', options: [] },
    { id: P_RISK, name: 'Risk taken', type: 'number', source: 'user_set', options: [] },
    { id: P_LINKS, name: 'Related', type: 'relation', source: 'user_set', options: [] },
    { id: P_WHY, name: 'Why', type: 'text', source: 'user_set', options: [] },
  ],
}
export const STRATEGIES = [{ id: 'iron_condor', name: 'Iron condor' }, { id: 'long_call', name: 'Long call' }]
export const FOLDERS = [{ id: 'f-1', name: 'Playbook' }, { id: 'f-2', name: 'Reviews' }]
export const KINDS = [{ id: 'builtin:plan', name: 'Trade plan' }, { id: 'k-own', name: 'Post-mortem' }]
export const NOTE_TAGS = ['earnings', 'psychology']
export const UNDERLYINGS = ['AAPL', 'SPY']
