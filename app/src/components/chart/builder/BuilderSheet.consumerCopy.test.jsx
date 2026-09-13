// app/src/components/chart/builder/BuilderSheet.consumerCopy.test.jsx
//
// ─── THE SHEET SAYS WHAT IT IS BEING USED FOR ───────────────────────────────
//
// ⭐ ONE SHELL, THREE CONSUMERS — `indicator`, `condition`, `infoValue` — and a
// member who opened it for one of them should not be shown an example of
// another. The title already reads "New condition"; these cases hold the rest of
// the copy to the same context.
//
// ⛔ COPY ONLY. Nothing here touches the parser, the AST, the evaluator, the
// reference language or what any consumer does with the result — those are the
// engine's and are tested where they live.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BuilderSheet from './BuilderSheet'
import { AuthContext } from '../../../context/AuthContext'
import { CONSUMER_LABEL } from './consumerAdapters'

const mount = (consumerKind) => render(
  <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
      <BuilderSheet open consumerKind={consumerKind} onClose={() => {}} onSaved={() => {}} />
    </SWRConfig>
  </AuthContext.Provider>,
)

const nameField = () => screen.getByLabelText('Name')

afterEach(cleanup)

describe('the Name example matches what is being authored', () => {
  it('⛔⛔ a CONDITION is not offered an indicator’s name', () => {
    // ⚰️ MEASURED IN A BROWSER 2026-09-13: the sheet titled "New condition"
    // offered `20-bar average` in the one field the member must fill in. The
    // example IS the instruction, and that one taught the wrong shape of answer.
    mount('condition')
    expect(screen.getByText(/New condition/i), 'the sheet is not in condition context')
      .toBeTruthy()
    const ph = nameField().getAttribute('placeholder')
    expect(ph).not.toMatch(/average/i)
    expect(ph).toBe('Trend up')
  })

  it('⭐ an INDICATOR keeps the example it always had', () => {
    mount('indicator')
    expect(nameField().getAttribute('placeholder')).toBe('20-bar average')
  })

  it('⭐ an INFO VALUE gets one of its own', () => {
    mount('infoValue')
    const ph = nameField().getAttribute('placeholder')
    expect(ph).toBeTruthy()
    expect(ph).not.toBe('20-bar average')
  })

  it('⛔ every consumer the sheet knows has an example — none falls through blank', () => {
    // Derived from the consumer vocabulary rather than from a list typed here, so
    // a fourth consumer fails this case instead of silently inheriting the
    // indicator's example.
    for (const kind of Object.keys(CONSUMER_LABEL)) {
      cleanup()
      mount(kind)
      const ph = nameField().getAttribute('placeholder')
      expect(ph, `no Name example for consumer ${kind}`).toBeTruthy()
    }
  })
})
