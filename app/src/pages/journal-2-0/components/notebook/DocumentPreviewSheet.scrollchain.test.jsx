// ⛔⛔ WAVE P5 — THE SCROLL CHAIN OF THE DOCUMENT VIEWER ON A PHONE.
//
// ⚰️ Why this file exists. The Scanned text panel is `position: sticky;
// bottom: 0` inside the viewer. A sticky control pins to the bottom of ITS
// scrollport — so the whole feature's visibility on a phone rests on one
// question nothing was asking: is the viewer's scrollport the part of the
// screen a member can see? Twice it was not. First the viewer sized to its
// content (1461px inside an 842px sheet) and the toggle sat at y=1174. Then
// `max-height: 100%` bounded it to the body's WHOLE content box, ignoring the
// 94px bar above it, and the toggle sat at y=845 — one pixel past the fold,
// which is the worse failure because it reads as fixed.
//
// jsdom cannot measure any of that (`lesson_a_green_suite_can_hide_a_layout
// _regression`), and the live proof is a browser measurement recorded in the
// Wave P5 doc. What CAN be railed here is the STRUCTURE that measurement
// depends on, so a silent revert goes red instead of shipping an invisible
// control: the viewer must live inside a body this module styles, and that
// body + the viewer must together form a bounded, non-percentage scroll chain.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DocumentPreviewSheet from './DocumentPreviewSheet'
import sheetStyles from './DocumentPreviewSheet.module.css'

vi.mock('./PdfDocumentViewer', () => ({
  default: () => <div data-testid="pdf-viewer-stub" />,
}))

const HERE = dirname(fileURLToPath(import.meta.url))
const readCss = (name) => readFileSync(join(HERE, name), 'utf8')

// The declarations of one rule, by selector — read off the SOURCE, because the
// class NAMES are hashed and the values are what carry the contract.
function block(css, selector) {
  const at = css.indexOf(`${selector} {`)
  expect(at, `${selector} is missing from the stylesheet`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
    // strip comments: this file is heavily annotated and a word in prose is
    // not a declaration.
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('the viewer sits in a body this sheet controls', () => {
  it('renders the viewer INSIDE the element carrying the styled body class', () => {
    render(<DocumentPreviewSheet open href="/f.pdf" name="report.pdf" onClose={vi.fn()} />)
    const stub = screen.getByTestId('pdf-viewer-stub')
    // ⛔ Compare against the IMPORTED token, never a hand-typed class name —
    // CSS-module class names are hashes, not arguments.
    const styled = stub.closest(`.${sheetStyles.body}`)
    expect(styled, 'the viewer is not inside the body this module styles')
      .not.toBeNull()
  })
})

describe('the chain is bounded, and bounded by flex rather than a percentage', () => {
  it('the sheet body is a column that does not scroll', () => {
    const b = block(readCss('DocumentPreviewSheet.module.css'), '.body')
    expect(b).toMatch(/display:\s*flex/)
    expect(b).toMatch(/flex-direction:\s*column/)
    // ⛔ If the body scrolls, the viewer stacks below the bar and can overflow
    // it — which is exactly how the sticky control went off-screen.
    expect(b).toMatch(/overflow:\s*hidden/)
  })

  it('the viewer takes the space that is LEFT, and may shrink to it', () => {
    const s = block(readCss('PdfDocumentViewer.module.css'), '.scroll')
    expect(s).toMatch(/flex:\s*1/)
    // ⛔ Without `min-height: 0` a flex item refuses to shrink below its
    // content, and a 1461px-tall scrollport comes straight back.
    expect(s).toMatch(/min-height:\s*0/)
    expect(s).toMatch(/overflow:\s*auto/)
  })

  it('refuses a percentage height on the viewer', () => {
    // ⚰️ `max-height: 100%` resolved against the body's whole content box and
    // ignored the bar above it: bounded, and still 78px off-screen.
    const s = block(readCss('PdfDocumentViewer.module.css'), '.scroll')
    expect(s).not.toMatch(/(max-)?height:\s*\d+%/)
  })
})

describe('the control this exists for is still pinned to that bottom edge', () => {
  it('the Scanned text panel sticks to the bottom of the viewer it lives in', () => {
    // If this stops being sticky the chain above stops mattering — and the
    // rails would keep passing while the panel scrolled away with the pages.
    const w = block(readCss('ScannedTextPanel.module.css'), '.wrap')
    expect(w).toMatch(/position:\s*sticky/)
    expect(w).toMatch(/bottom:\s*0/)
  })
})
