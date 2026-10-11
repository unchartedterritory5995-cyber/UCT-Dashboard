// app/src/components/provenance/documentOrigin.test.js
//
// TERM-050 — the adapter from the Notebook's document vocabulary to
// <Provenance> props. The words are read from documentProvenance (the one
// authority), never retyped here.

import { describe, it, expect } from 'vitest'
import { documentOriginLabel, documentSourceProvenance } from './documentOrigin'
import { SCANNED_TEXT_LABEL, SCANNED_TEXT_HINT }
  from '../../pages/journal-2-0/lib/documentProvenance'

const ROW = { n: 1, label: 'q3-filing.pdf · p.4' }

describe('documentSourceProvenance', () => {
  it('a scanned row carries the scanned-text origin, in the authority\'s words', () => {
    const p = documentSourceProvenance({ ...ROW, textOrigin: 'ocr' })
    expect(p.value).toBe(ROW.label)
    expect(p.origin).toEqual({ label: SCANNED_TEXT_LABEL, hint: SCANNED_TEXT_HINT })
  })

  it('a native row, and a row with no origin at all, carry none', () => {
    expect(documentSourceProvenance({ ...ROW, textOrigin: 'native' }).origin).toBeNull()
    expect(documentSourceProvenance(ROW).origin).toBeNull()
  })

  it('passes NO detail fields, so a row that is itself a button never nests one', () => {
    const p = documentSourceProvenance({ ...ROW, textOrigin: 'ocr' })
    expect(p.provenance).toEqual({})
  })

  it('documentOriginLabel names the origin for an accessible name, or null', () => {
    expect(documentOriginLabel({ ...ROW, textOrigin: 'ocr' })).toBe(SCANNED_TEXT_LABEL)
    expect(documentOriginLabel(ROW)).toBeNull()
    expect(documentOriginLabel(null)).toBeNull()
  })
})
