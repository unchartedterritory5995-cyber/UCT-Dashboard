// Notebook widgets phase 2, wave 11 (Task 11.14): the member's words for a template's slots.
//
// A template slot is a style block whose id is `built_<k>`, `routine_<k>` or `tracker_<k>` (ruling W11-R2); its target
// lives in the block's settings. This file names a slot ("Widget: Equity curve"), says which day a routine or tracker
// slot binds to ("For the next trading day"), and holds the words for the ten "pick yours" types of a shared item.
//
// ⛔ LAZY. Imported only by the styles chunk (StyleEditor, KindSection), the share preview and the adoption sheet.
// The eager journalBlocks.js keeps its own copy of the family test (one regex, railed against this one and against
// the server's journal_styles.SLOT_ID_RE by templateSlots.test.js), so nothing eager imports this file.

/** Twin of `journal_styles.SLOT_ID_RE` (railed by templateSlots.test.js against the server's source text). */
export const SLOT_ID_RE = /^(built|routine|tracker)_[a-z0-9]{1,2}$/

const FAMILY_WORD = Object.freeze({ built: 'Widget', routine: 'Routine', tracker: 'Tracker' })

/** The slot family of a block id (`'built'`, `'routine'`, `'tracker'`), or null. Total. */
export function slotFamily(id) {
  if (typeof id !== 'string') return null
  const m = SLOT_ID_RE.exec(id)
  return m ? m[1] : null
}

/** The family's word alone (`'Widget'`, `'Routine'`, `'Tracker'`), or null for a non-family. */
export function familyWord(family) {
  return Object.hasOwn(FAMILY_WORD, family) ? FAMILY_WORD[family] : null
}

/** `'Widget: Equity curve'`, or the family word alone when the name is unknown or blank. */
export function familyLabel(family, name) {
  const word = familyWord(family)
  if (!word) return null
  const n = typeof name === 'string' ? name.trim() : ''
  return n ? `${word}: ${n}` : word
}

/** The key a slot's target is named by: its `ref` (`def:<uuid>`, `shelf:<slug>`, `routine:<uuid>`, ...), else
 *  `template:<key>` or `inline:<key>`; null when the settings name none. */
export function slotRef(settings) {
  const s = settings && typeof settings === 'object' ? settings : {}
  if (typeof s.ref === 'string' && s.ref) return s.ref
  if (typeof s.template === 'string' && s.template) return `template:${s.template}`
  if (typeof s.inline === 'string' && s.inline) return `inline:${s.inline}`
  return null
}

/**
 * A slot block's member-facing name. `block` is a style block (`{block, settings}`); `names` maps a target to its
 * name, by the slot's ref (see `slotRef`) or else by its block id. `'Widget: Equity curve'`, `'Routine: Pre-market
 * routine'`, `'Tracker: Sleep'`; the family word alone (`'Widget'`) when the name is unknown. Null for a block that
 * is not a slot.
 */
export function slotLabel(block, names = {}) {
  const fam = slotFamily(block?.block)
  if (!fam) return null
  const table = names && typeof names === 'object' ? names : {}
  const ref = slotRef(block?.settings)
  const pick = (k) => (k != null && Object.hasOwn(table, k) ? table[k] : undefined)
  return familyLabel(fam, pick(ref) ?? pick(block.block))
}

const BIND_WORDS = Object.freeze({
  'note-day': 'For the day of the note',
  'next-trading-day': 'For the next trading day',
  week: 'For the trading week',
})

/** The day a routine or tracker slot binds to, in words. A missing bind is the server's default, `note-day`;
 *  any other value (including `today`, never a template value) has no words: ''. */
export function bindWords(bind) {
  const b = bind == null ? 'note-day' : bind
  return Object.hasOwn(BIND_WORDS, b) ? BIND_WORDS[b] : ''
}

/** The ten "pick yours" types of a shared item (ruling W11-R5), in the server's words
 *  (`widget_engine/share.TYPE_LABELS`, railed by templateSlots.test.js). */
export const TYPE_LABELS = Object.freeze({
  setup: 'Setup',
  tag: 'Tag',
  symbol: 'Symbol',
  account: 'Account',
  property: 'Property',
  folder: 'Folder',
  note_kind: 'Kind of note',
  routine: 'Routine',
  tracker: 'Tracker',
  number: 'Number',
})

/**
 * The display names a served style (or a preview answer) carries for its slots (ruling W11-R21, Tasks 11.5/11.6): the
 * member's own widget, routine or tracker name, resolved by the server for that member only. Two shapes are read, so
 * this works before, while and after the server sends them:
 *   * `source.slotNames`: `{<ref or block id>: name}`;
 *   * `source.blocks[i].displayName`: the name on the block itself, keyed by its block id.
 * Only non-blank strings count. `{}` when the source names none (today's served style): `slotLabel` then reads the
 * family word, exactly as before.
 */
export function slotNamesOf(source) {
  const out = {}
  const src = source && typeof source === 'object' ? source : {}
  const keep = (k, v) => {
    if (typeof k !== 'string' || !k || typeof v !== 'string' || !v.trim()) return
    out[k] = v.trim()
  }
  if (src.slotNames && typeof src.slotNames === 'object' && !Array.isArray(src.slotNames)) {
    for (const [k, v] of Object.entries(src.slotNames)) keep(k, v)
  }
  if (Array.isArray(src.blocks)) {
    for (const b of src.blocks) {
      if (b && typeof b === 'object' && slotFamily(b.block)) keep(b.block, b.displayName)
    }
  }
  return out
}
