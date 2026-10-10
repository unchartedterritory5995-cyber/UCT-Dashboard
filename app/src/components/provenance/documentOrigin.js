// app/src/components/provenance/documentOrigin.js
//
// TERM-050: the adapter between the Notebook's document vocabulary and S8's
// one provenance renderer.
//
// The Notebook Ask panel's Sources rows used to draw "where this page's words
// came from" themselves, straight off `documentProvenance` (a local chip with
// its own class). That was a second provenance renderer beside `<Provenance>`.
// This module turns a cited source row into `<Provenance>` props, so the panel
// composes the shared renderer and nothing else.
//
// ⛔ THE WORDS STAY WHERE THEY ARE. `documentProvenance.js` is still the one
// authority for the vocabulary ("Scanned text", the hint), shared with Search
// and the document status line. This file only adapts it; it never restates it.
//
// ⛔ NO DETAIL FIELDS. A Sources row is itself a <button>, and `<Provenance>`
// draws a detail toggle <button> whenever it has a source/as-of/calc/tie-break
// to disclose. Passing none keeps the row free of a nested button. The row's
// `label` IS its source, so there is nothing true left to disclose anyway.

import { isScannedText, SCANNED_TEXT_LABEL, SCANNED_TEXT_HINT }
  from '../../pages/journal-2-0/lib/documentProvenance'

/** The origin words for a row's accessible name, or null when there are none. */
export function documentOriginLabel(row) {
  return isScannedText(row) ? SCANNED_TEXT_LABEL : null
}

/** `<Provenance>` props for one cited source row. */
export function documentSourceProvenance(row) {
  return {
    value: row ? row.label : null,
    provenance: {},
    origin: isScannedText(row) ? { label: SCANNED_TEXT_LABEL, hint: SCANNED_TEXT_HINT } : null,
  }
}
