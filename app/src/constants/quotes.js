// app/src/constants/quotes.js — the UCT Quote of the Day library.
//
// ONE authority: quotes.json, beside this file. This module imports it for the
// three frontend surfaces (Dashboard FuturesStrip, the MarketStatusBar line, the
// Morning Wire banner); the FastAPI backend reads the same JSON for
// /api/quote-of-the-day, so the site and the Substack letter agree. The morning-wire HTML template used to carry a
// hand-typed second copy with a random pick; it was removed 2026-08-22.
//
// Entry shape (quotes.json): { t: text, a: author, src: where it is from, tags: [...] }
//   • `src` is the citation — a book, letter, interview, memo, talk or speech —
//     so the quote can be written into a journal with its provenance.
//   • Lines whose authorship is popular but undocumented say "attributed" in
//     `src`; lines that are really proverbs or floor wisdom are credited as such.
//     Nothing is credited to "Unknown" — the test refuses it.
//   • Text uses typographic quotes (‘ ’ “ ”) inside strings; the test refuses a
//     straight double quote so the banner markup can never be broken by one.
//   • quotes.test.js also refuses duplicates / near-duplicates and any text over
//     240 characters (the banner width), and asserts the rotation reaches every
//     entry once before any repeat.
//
// Curation rules (2026-08-22 rewrite): trading canon first — Livermore, O'Neil,
// Minervini, the Market Wizards, the swing/momentum practitioners the UCT
// Knowledge Base teaches — then risk & decision science, then Stoic and
// philosophical lines from the actual texts, then performance & discipline from
// people who are documented to have said them. Motivational-poster apocrypha
// (Einstein on insanity, Mandela on "win or learn", Churchill on "success is not
// final") were dropped or re-credited to their real source.

import QUOTES_DATA from './quotes.json'
import { dayOrdinal, pickIndex, STRIDE } from './quoteRotation'

export const QUOTES = QUOTES_DATA

// Theme vocabulary — every entry carries 1–3 of these (first = primary). The
// server's regime-aware pick (api/services/quote_of_the_day.py) selects from the
// pool whose tags fit the wire's exposure tier; this list is the contract the
// test enforces on the JSON so a typo can never create an empty pool.
export const TAGS = Object.freeze([
  'risk', 'patience', 'process', 'psychology', 'momentum',
  'sizing', 'contrarian', 'grit', 'learning',
])

// ── Rotation (offline fallback) ───────────────────────────────────────────
//
// The day → index walk lives in quoteRotation.js (pure, Node-loadable) and is
// mirrored by api/services/quote_of_the_day.py, which is what actually picks
// the quote a reader sees (regime-aware, via GET /api/quote-of-the-day). This
// client-side pick is the fallback hooks/useQuoteOfTheDay.js uses when the API
// is unreachable: the whole library, keyed on the viewer's local calendar day.
export { dayOrdinal, STRIDE }

export function quoteOfTheDay(date = new Date()) {
  return QUOTES[pickIndex(dayOrdinal(date), QUOTES.length)]
}
