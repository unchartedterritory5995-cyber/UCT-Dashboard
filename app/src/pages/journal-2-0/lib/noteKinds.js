// Kinds of note (spec P1.1). ⛔ ONE FACT IN TWO FILES with
// api/services/journal_two/note_kinds.py::BUILTIN_NOTE_KINDS; tests/test_note_kinds.py IMPORTS this
// module through Node and asserts equality. ⛔ NO IMPORTS in this file: plain Node must load it.
// The property that holds a note's current kind. ⛔ ONE FACT IN TWO FILES with note_kinds.NOTE_KIND_PROPERTY
// (pinned by test_the_client_property_id_equals_the_server_property_id); lib/kindOfNoteOffer.js imports it.
export const NOTE_KIND_PROPERTY = 'builtin:note_kind'
/** Simplify pass 2 (A4): a member reads that property as "Note type"; the server still names it "Kind of note". The
 *  client renames it where it reads a property (`key` names the id field: `id`, or `propertyId` on a suggestion).
 *  Display only: the id and the stored key never change. */
export const NOTE_TYPE_LABEL = 'Note type'
export const asNoteTypeName = (p, key = 'id') => (p && p[key] === NOTE_KIND_PROPERTY ? { ...p, name: NOTE_TYPE_LABEL } : p)
/** A response body whose `list` field holds properties, with that one renamed (the property hooks' fetchers). */
export const withNoteTypeNames = (body, list) => (Array.isArray(body?.[list])
  ? { ...body, [list]: body[list].map((p) => asNoteTypeName(p)) } : body)

export const BUILTIN_NOTE_KINDS = Object.freeze([
  { id: 'trade_plan', name: 'Trade plan', icon: 'chart' },
  { id: 'daily_prep', name: 'Daily prep', icon: 'sun' },
  { id: 'weekend_prep', name: 'Weekend prep', icon: 'calendar' },
  { id: 'earnings', name: 'Earnings', icon: 'earnings' },
  { id: 'earnings_followup', name: 'Earnings follow-up', icon: 'edit' },
  { id: 'post_trade_review', name: 'Post-trade review', icon: 'check' },
  { id: 'weekly_review', name: 'Weekly review', icon: 'refresh' },
  { id: 'thesis', name: 'Thesis', icon: 'book' },
  { id: 'watchlist_note', name: 'Watchlist note', icon: 'eye' },
].map((k) => Object.freeze(k)))

/** A kind's icon, or 'document' when it has none. The caller checks UICON_NAMES before rendering. */
export const kindIcon = (kind) => (kind && typeof kind.icon === 'string' && kind.icon) || 'document'
