// Notebook widgets phase 2, wave 11 (Task 11.14): the member's words for a template's slots.
//
// A template slot is a style block whose id is `built_<k>`, `routine_<k>` or `tracker_<k>` (ruling W11-R2); its target
// lives in the block's settings. This file names a slot ("Widget: Equity curve"), says which day a routine or tracker
// slot binds to ("For the next trading day"), and holds the words for the ten "pick yours" types of a shared item.
//
// ⛔ LAZY. Imported only by the styles chunk (StyleEditor, KindSection), the share preview and the adoption sheet.
// The eager journalBlocks.js keeps its own copy of the family test (one regex, railed against this one and against
// the server's journal_styles.SLOT_ID_RE by templateSlots.test.js), so nothing eager imports this file.

import { blockLabel } from './journalBlocks'
import { widgetsWaveOn } from './notebookWidgetsFlags'
import { PLACEHOLDER_LINE_RE } from '../components/notebook/styles/outlineText'

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
 * The two keys have one reader each, and neither is a second contract with the server: the BLOCK ID is the server's
 * `slotNames` key (journal_styles.slot_names, read by StyleEditor and KindSection through `slotNamesOf`); the REF is
 * the share preview's own table (SharePreviewSheet's TemplateTravels keys a shared template's inline definitions,
 * routines and trackers by `inline:<key>`, built client-side from `travels`). A ref holds a colon and a block id
 * cannot, so the two never collide. (Merge review m-4 proposed deleting the ref lookup as dead; it is not:
 * SharePreviewSheet.test.jsx "lists each held widget, routine and tracker ..." and templateSlots.test.js redden.)
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

/**
 * R3/R4 (11.20 rehearsal), review m-3: an outline (a TipTap doc) as a member previews it, with no `{{block:<id>}}`
 * token left for a block the outline places. A placed block is one italic line naming it: a slot through
 * `slotLabel` (its settings from `blocks`, its name from `names`), any other block through `blockLabel`.
 *
 * With the style's `blocks` (an array), the SERVER's placement rule, `journal_styles.compose`, exactly:
 *   * a placeholder is a paragraph whose TEXT children alone (`_plain`: a hardBreak or a mark node is ignored),
 *     trimmed, read `{{block:<id>}}` (`_placeholder_kind`);
 *   * at the TOP level, an ENABLED block's placeholder is the block, in place; a DISABLED block's vanishes;
 *   * a placeholder for a block the style does not list is the author's own text and is kept (Review M-5);
 *   * a NESTED placeholder (in a list, a quote) becomes an empty paragraph and its block goes after the first
 *     heading, as does every enabled block no top-level placeholder placed (`_rest_after_heading`), in block order.
 * With NO block list (`blocks` null or absent: a bare template outline, a library update), every placeholder line
 * is named in place, so no token reaches the page. Total: anything that is not a doc comes back as given.
 */
/** A slot family whose release wave is off right now (the client half of `journal_styles._slot_wave_off`): every slot
 *  while wave 11 is off; a routine or tracker slot while wave 9 is off; a built slot while wave 8 is off. */
export function slotWaveOff(id) {
  const fam = slotFamily(id)
  if (!fam) return false
  if (!widgetsWaveOn(11)) return true
  return fam === 'built' ? !widgetsWaveOn(8) : !widgetsWaveOn(9)
}

export function outlineWithBlockNames(doc, blocks = null, names = {}) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.content)) return doc
  const isRec = (v) => v && typeof v === 'object'
  const plainId = (n) => {
    if (!isRec(n) || n.type !== 'paragraph' || !Array.isArray(n.content)) return null
    const m = PLACEHOLDER_LINE_RE.exec(n.content.filter((c) => isRec(c) && c.type === 'text').map((c) => c.text || '').join('').trim())
    return m ? m[1] : null
  }
  const line = (id, b) => ({ type: 'paragraph', content: [{ type: 'text', text: slotFamily(id) ? slotLabel(b || { block: id }, names) : blockLabel(id), marks: [{ type: 'italic' }] }] })
  if (!Array.isArray(blocks)) {
    const bare = (n) => {
      const id = plainId(n)
      if (id) return line(id)
      return isRec(n) && Array.isArray(n.content) ? { ...n, content: n.content.map(bare) } : n
    }
    return bare(doc)
  }
  const enabled = new Map()
  const disabled = new Set()
  for (const b of blocks) {
    if (!isRec(b) || typeof b.block !== 'string') continue
    // Review n-3: a slot whose release wave is off is DROPPED, block and placeholder, as journal_styles._served
    // does (`_slot_wave_off`), so it is treated as a disabled block: its placeholder vanishes and it is never
    // placed. Only the family gates are the client's to judge; a pinned plan's waves are the server's (it serves
    // a listed item without such a slot).
    if (b.enabled && !slotWaveOff(b.block)) { if (!enabled.has(b.block)) enabled.set(b.block, b) } else disabled.add(b.block)
  }
  const placed = new Set()
  const walk = (content, top) => {
    const out = []
    for (const n of content) {
      const id = plainId(n)
      if (id && !enabled.has(id) && !disabled.has(id)) { out.push(n); continue }     // the author's own text
      if (id) {
        if (!top) out.push({ type: 'paragraph' })
        else if (enabled.has(id)) { out.push(line(id, enabled.get(id))); placed.add(id) }
        continue                                                                       // disabled: vanishes
      }
      if (isRec(n) && Array.isArray(n.content)) {
        const kids = walk(n.content, false)
        out.push({ ...n, content: kids.length || !n.content.length ? kids : [{ type: 'paragraph' }] })
      } else out.push(n)
    }
    return out
  }
  const content = walk(doc.content, true)
  const rest = [...enabled].filter(([id]) => !placed.has(id)).map(([id, b]) => line(id, b))
  if (rest.length) {
    const at = content.findIndex((n) => isRec(n) && n.type === 'heading')
    content.splice(at < 0 ? 0 : at + 1, 0, ...rest)
  }
  return { ...doc, content }
}

/** The names a `preview-mine` answer gives its slots: each card's title and each tool's name, keyed by block id. */
export function previewSlotNames(answer) {
  const out = {}
  for (const x of [...(Array.isArray(answer?.cards) ? answer.cards : []), ...(Array.isArray(answer?.tools) ? answer.tools : [])]) {
    const name = typeof x?.title === 'string' && x.title.trim() ? x.title : x?.name
    if (typeof x?.slot === 'string' && typeof name === 'string' && name.trim()) out[x.slot] = name.trim()
  }
  return out
}
