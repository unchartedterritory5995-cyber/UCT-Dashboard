// Kinds of note (spec P1.1). ⛔ ONE FACT IN TWO FILES with
// api/services/journal_two/note_kinds.py::BUILTIN_NOTE_KINDS; tests/test_note_kinds.py IMPORTS this
// module through Node and asserts equality. ⛔ NO IMPORTS in this file: plain Node must load it.
// The property that holds a note's current kind. ⛔ ONE FACT IN TWO FILES with note_kinds.NOTE_KIND_PROPERTY
// (pinned by test_the_client_property_id_equals_the_server_property_id); lib/kindOfNoteOffer.js imports it.
export const NOTE_KIND_PROPERTY = 'builtin:note_kind'

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
