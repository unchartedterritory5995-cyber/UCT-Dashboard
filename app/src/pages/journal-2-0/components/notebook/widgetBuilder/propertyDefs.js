// Notebook widgets phase 2 (wave 10, Task 10.17): the member's note property definitions, for the builder's property
// filter and its chips: each property's name, its type and (a select) its options, which the value picker lists and a
// chip reads its value by. `GET /api/j2/property-defs` (the member's own definitions, `note_properties.list_property_defs`).
//
// ⛔ LAZY: only the builder's chunk imports this. ⛔ Which properties a widget may filter by is NOT decided here: the
// pick list is the server's own (`GET /vocabulary?field=property`, the notes source's rule, `sources.member_property`);
// these definitions only name what a plan already holds and list a select's options.
export const PROPERTY_DEFS_URL = '/api/j2/property-defs'

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The member's property definitions by id, each `{name, type, options}`. Read again on each call (a property made
 *  since is there). Rejects when the read fails. */
export async function loadPropertyDefs() {
  const r = await fetch(PROPERTY_DEFS_URL, { credentials: 'include' })
  if (!r || !r.ok) throw new Error(`property definitions: ${r ? r.status : 'no answer'}`)
  const body = await r.json()
  const out = new Map()
  for (const d of Array.isArray(body?.propertyDefs) ? body.propertyDefs : []) {
    if (!isRecord(d) || typeof d.id !== 'string' || !d.id) continue
    out.set(d.id, {
      name: typeof d.name === 'string' ? d.name : '',
      type: typeof d.type === 'string' ? d.type : null,
      options: Array.isArray(d.options) ? d.options.filter(isRecord) : [],
    })
  }
  return out
}
