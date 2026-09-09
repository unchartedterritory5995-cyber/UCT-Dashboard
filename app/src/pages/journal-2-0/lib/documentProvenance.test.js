// Wave P2 §21 — the provenance vocabulary, in one place, with its negatives.
//
// ⛔ THE NEGATIVES ARE THE POINT. A label that appears on every result says
// nothing; a label that appears on a native page is a false warning about a
// figure the member could have trusted. Both directions are railed here.
import { describe, it, expect } from 'vitest'
import {
  isScannedText, scannedPagesNotice, SCANNED_TEXT_LABEL, SCANNED_TEXT_HINT,
  TEXT_ORIGIN_OCR, TEXT_ORIGIN_NATIVE, TEXT_ORIGIN_WEB,
} from './documentProvenance'

describe('isScannedText', () => {
  it('is true only for text read from a scan', () => {
    expect(isScannedText({ textOrigin: TEXT_ORIGIN_OCR })).toBe(true)
  })

  it('is false for natively extracted text', () => {
    expect(isScannedText({ textOrigin: TEXT_ORIGIN_NATIVE })).toBe(false)
  })

  it('is false for a captured web passage', () => {
    // A web capture is not a scan, and its "page" is a capture ordinal.
    expect(isScannedText({ textOrigin: TEXT_ORIGIN_WEB })).toBe(false)
  })

  it('is false when the server said nothing at all', () => {
    // ⛔ ABSENCE IS NOT EVIDENCE. An older cached bundle, a stubbed fixture or
    // a partial response must not make a document look scanned.
    expect(isScannedText({})).toBe(false)
    expect(isScannedText(null)).toBe(false)
    expect(isScannedText(undefined)).toBe(false)
  })
})

describe('scannedPagesNotice', () => {
  it('says nothing for a document with no scanned pages', () => {
    expect(scannedPagesNotice({ pagesFromOcr: 0, pagesTotal: 4 })).toBeNull()
  })

  it('says nothing when the counts are absent', () => {
    expect(scannedPagesNotice({})).toBeNull()
    expect(scannedPagesNotice({ pagesFromOcr: 2 })).toBeNull()
    expect(scannedPagesNotice(null)).toBeNull()
  })

  it('names the PAGES when only some of them were scanned', () => {
    const s = scannedPagesNotice({ pagesFromOcr: 2, pagesTotal: 9 })
    expect(s).toContain('2 of 9')
    expect(s).toMatch(/check exact figures/i)
  })

  it('does not claim a fraction when the whole document was scanned', () => {
    const s = scannedPagesNotice({ pagesFromOcr: 3, pagesTotal: 3 })
    expect(s).not.toContain('3 of 3')
    expect(s).toMatch(/scanned pages/i)
  })

  it('uses the singular for a one-page scan', () => {
    expect(scannedPagesNotice({ pagesFromOcr: 1, pagesTotal: 1 }))
      .toMatch(/a scanned page/i)
  })
})

describe('the vocabulary itself', () => {
  it('never names the engine or its version', () => {
    // ⛔ §24 — member language, never engine language. The engine, its version
    // and its timings are internal provenance and stay in the job table.
    const words = `${SCANNED_TEXT_LABEL} ${SCANNED_TEXT_HINT} `
      + `${scannedPagesNotice({ pagesFromOcr: 1, pagesTotal: 2 })}`
    expect(words.toLowerCase()).not.toMatch(/tesseract|ocr|engine|leptonica|5\.\d/)
  })

  it('tells the member what to DO, not just what happened', () => {
    // A mechanism ("this came from OCR") is not actionable; checking the page
    // is. That is what earns the label its space in the row.
    expect(SCANNED_TEXT_HINT).toMatch(/check/i)
    expect(SCANNED_TEXT_HINT).toMatch(/page/i)
  })
})
