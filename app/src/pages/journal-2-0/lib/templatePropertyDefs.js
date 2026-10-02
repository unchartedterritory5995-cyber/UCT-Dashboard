/**
 * Wave 12, lane 12B-2: applying a built-in template's PROPERTY DEFINITIONS before its
 * note is made (docs/notebook/WAVE-12-PLAN.md §2.3, "12B-2"). Today one template declares
 * them, the Position Tracker (`propertyDefinitions` in lib/notebookTemplates.js).
 *
 * The order is the spec's: the member's definitions are created or REUSED first, then the
 * note. Definitions are the member's own, shared by every note (the Properties section
 * lists them all), so applying the template twice reuses what the first apply made; it
 * never makes a second "Entry".
 *
 * ⛔ FORMULAS OFF: with `notebook_formulas_enabled` off (latched per tab,
 * lib/offline/notebookFlags.js) the formula definitions are LEFT OUT before any request
 * is made. The server refuses a formula definition with a 400 while its gate is off
 * (`note_properties.create_property_def`), so sending one would be a refusal the member
 * never asked for. The number definitions and the note are made as usual.
 *
 * ⛔ NEVER A HALF-APPLIED WRITE (the one-write rule, api/services/journal_two/note_templates.py):
 * the note itself is ONE create carrying no property values, so a definition that could
 * not be made can never fail the note's write. A failed definition is skipped and said in
 * the result (`skipped`), a formula whose input was skipped is skipped with it, and a
 * failure here never stops the note being created (the caller treats this whole step as
 * best-effort). If the server's gate disagrees with the tab's latch (a flip mid-session),
 * the formula create is refused, recorded as skipped, and the note is still made.
 *
 * Reuse is by NAME (trimmed, case-insensitive, the server's own `_name_map` rule) AND
 * TYPE. A name the member already uses for another type (a text "Entry") is never
 * touched and never duplicated: the definition is made as "Entry (number)" instead, and
 * if that too is taken by another type it is skipped. A formula names its inputs by the
 * template's canonical names and is stored by the ids they resolved to (`{@id}`), so a
 * reused or renamed input can never make the expression ambiguous.
 *
 * After the note is made, the template's definitions are REVEALED on it for this tab
 * (`rememberTemplateReveal` / `templateRevealFor`): the Properties section hides an empty
 * property, and a tracker whose fields all start empty would otherwise show only "Add
 * property". Memory only, bounded, never written anywhere.
 */
import { STARTER_FORMULAS } from './formula/computed'
import { FormulaError, toStored } from './formula/formulaEngine'
import { notebookFlag } from './offline/notebookFlags'

const DEFS_URL = '/api/j2/property-defs'

/** The expression a formula declaration means: its starter's, or its own. */
export function declaredExpression(spec) {
  if (spec?.starter) return STARTER_FORMULAS.find((s) => s.id === spec.starter)?.expression || null
  return spec?.expression || null
}

async function fetchDefs() {
  const res = await fetch(DEFS_URL, { credentials: 'include' })
  if (!res.ok) throw new Error(`Could not read your properties (${res.status})`)
  return (await res.json()).propertyDefs || []
}

async function postDef(name, type, config) {
  const res = await fetch(DEFS_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, ...(config ? { config } : {}) }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `${res.status}`)
  }
  return (await res.json()).propertyDef
}

const norm = (s) => String(s || '').trim().toLowerCase()

/**
 * Create or reuse every definition `tpl.propertyDefinitions` declares, numbers first.
 * Returns `{ resolved: {key: def}, revealIds: [id], skipped: [{key, name, reason}] }`.
 * `formulasOn` defaults to the tab's latched flag; `listDefs` / `createDef` default to
 * the property-defs endpoints and are injectable for tests.
 */
export async function ensureTemplatePropertyDefs(tpl, {
  formulasOn = notebookFlag('notebook_formulas_enabled') === true,
  listDefs = fetchDefs,
  createDef = postDef,
} = {}) {
  const specs = Array.isArray(tpl?.propertyDefinitions) ? tpl.propertyDefinitions : []
  const resolved = {}
  const skipped = []
  if (!specs.length) return { resolved, revealIds: [], skipped }

  const wanted = []
  for (const spec of specs) {
    if (spec.type === 'formula' && !formulasOn) skipped.push({ key: spec.key, name: spec.name, reason: 'formulas_off' })
    else wanted.push(spec)
  }
  if (!wanted.length) return { resolved, revealIds: [], skipped }

  const defs = [...(await listDefs())]
  // Canonical (template) name -> the id that name resolved to, for formula inputs.
  const inputIds = new Map()

  const ordered = [...wanted.filter((s) => s.type !== 'formula'), ...wanted.filter((s) => s.type === 'formula')]
  for (const spec of ordered) {
    let def = null
    let reason = 'name_taken'
    for (const name of [spec.name, `${spec.name} (${spec.type})`]) {
      const same = defs.filter((d) => norm(d.name) === norm(name))
      if (same.length) {
        // The member's own definition of this name and type is REUSED as it is -- an
        // existing "R-multiple" formula keeps the member's expression.
        const reuse = same.find((d) => d.type === spec.type && d.source === 'user_set')
        if (reuse) { def = reuse; break }
        continue // taken by another type (or a built-in): try the next name, never duplicate it
      }
      let config
      if (spec.type === 'formula') {
        try {
          const text = declaredExpression(spec)
          if (!text) throw new FormulaError('unknown_ref', 'This template formula has no expression')
          config = { expression: toStored(text, inputIds) }
        } catch {
          reason = 'input_missing' // an input was skipped, so this formula cannot be written
          break
        }
      }
      try {
        def = await createDef(name, spec.type, config)
        if (def) defs.push(def)
      } catch {
        reason = 'create_failed'
      }
      break
    }
    if (!def) {
      // eslint-disable-next-line no-console
      console.warn(`[notebook] template property "${spec.name}" was not set up (${reason})`)
      skipped.push({ key: spec.key, name: spec.name, reason })
      continue
    }
    resolved[spec.key] = def
    if (spec.type === 'number') inputIds.set(norm(spec.name), def.id)
  }
  const revealIds = ordered.map((s) => resolved[s.key]?.id).filter(Boolean)
  return { resolved, revealIds, skipped }
}

// ── The reveal: which empty properties a just-made note shows (memory only) ──────

const REVEAL_MAX = 50
const reveals = new Map()

/** Remember that `noteId` was made from a template declaring these definitions. */
export function rememberTemplateReveal(noteId, ids) {
  if (!noteId || !Array.isArray(ids) || !ids.length) return
  reveals.delete(noteId)
  reveals.set(noteId, [...ids])
  while (reveals.size > REVEAL_MAX) reveals.delete(reveals.keys().next().value)
}

/** The definition ids to show on `noteId` even while empty ([] when none). */
export function templateRevealFor(noteId) {
  return reveals.get(noteId) || []
}

/** Tests only. */
export function __resetTemplateReveals() {
  reveals.clear()
}
