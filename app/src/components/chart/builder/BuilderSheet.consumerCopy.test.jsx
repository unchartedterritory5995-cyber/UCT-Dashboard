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
import { CONSUMER_LABEL, validateFor } from './consumerAdapters'

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

// ─── THE VISIBLE QUESTION AND THE SERVER REQUEST DESCRIBE THE SAME THING ────
//
// ⭐⭐ TRACED FROM THE SERVER, NOT FROM THE WORDS. `definition_concierge.KINDS`
// is `("indicator", "scan")`; `_KIND_BRIEF[INDICATOR_KIND]` asks for "a column of
// numbers drawn on a chart" and `_KIND_BRIEF[SCAN_KIND]` for "a yes-or-no
// CONDITION", gated — not merely hinted — by `scan_definition.is_boolean_tree`
// inside `_validate`. The response shape is identical for both kinds. So `scan`
// IS the chart Condition's generation contract, and `indicator` is the Info
// Value's; neither needed inventing.
//
// ⚰️ MEASURED: the request followed the BUILD MODE alone, so a sheet opened as a
// chart Condition asked the server for an indicator and then refused the numeric
// tree it got back at `validateFor` — a formula that would not save, with no
// reason given.
describe('the concierge asks the server for what the consumer needs', () => {
  const box = () => screen.getByTestId('concierge-box')

  it('⭐ an INDICATOR asks for an indicator, and says so', () => {
    mount('indicator')
    expect(box().getAttribute('data-kind')).toBe('indicator')
    expect(box().getAttribute('data-copy-kind')).toBe('indicator')
    expect(screen.getByLabelText(/Describe the indicator in plain English/i)).toBeTruthy()
  })

  it('⛔⛔ a CONDITION asks for a SCAN — the boolean contract — but is never told it is a screen', () => {
    mount('condition')
    expect(box().getAttribute('data-kind'), 'the request is still the numeric contract')
      .toBe('scan')
    expect(box().getAttribute('data-copy-kind')).toBe('condition')
    expect(screen.getByLabelText(/Describe the condition in plain English/i)).toBeTruthy()
    // ⛔ THE REQUEST'S VOCABULARY DOES NOT LEAK. A charting member is not
    // building a screen, whatever the server calls the contract.
    expect(document.body.textContent).not.toMatch(/screen/i)
  })

  it('⭐ an INFO VALUE reuses the numeric contract, with its own wording', () => {
    mount('infoValue')
    expect(box().getAttribute('data-kind'), 'a third server kind was invented')
      .toBe('indicator')
    expect(box().getAttribute('data-copy-kind')).toBe('infoValue')
    expect(screen.getByLabelText(/Describe the value in plain English/i)).toBeTruthy()
  })

  it('⛔ and every consumer is asked for one of the two kinds the server draughts', () => {
    for (const kind of Object.keys(CONSUMER_LABEL)) {
      cleanup()
      mount(kind)
      expect(['indicator', 'scan'], `consumer ${kind} asked for an unknown kind`)
        .toContain(box().getAttribute('data-kind'))
    }
  })
})

// ─── AND THE DOWNSTREAM GATE IS STILL THE GATE ─────────────────────────────
//
// ⛔ THE GENERATION CONTRACT IS A REQUEST, NEVER A GUARANTEE. Whatever the server
// drafts arrives through the same `validateFor` every other door uses — typing,
// import, screenshot — so a wrong-shaped tree is refused before save no matter
// which lane produced it. These cases hold that, because moving the request kind
// would be worthless if it had quietly become the only check.
describe('the consumer gate still refuses a wrong-shaped result', () => {
  const authored = (resultType, ast) => ({ resultType, ast: ast || { type: 'num', value: 1 } })

  it('⛔ a CONDITION refuses a numeric result and offers the useful next move', () => {
    const v = validateFor('condition', authored('numeric'))
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/true or false/i)
    expect(v.offer).toBe('infoValue')
  })

  it('⛔ an INFO VALUE refuses a boolean result', () => {
    const v = validateFor('infoValue', authored('boolean'))
    expect(v.ok).toBe(false)
    expect(v.offer).toBe('condition')
  })

  it('⭐ an INDICATOR takes either — a 0/1 flag is a legitimate plot', () => {
    expect(validateFor('indicator', authored('boolean')).ok).toBe(true)
    expect(validateFor('indicator', authored('numeric')).ok).toBe(true)
  })

  it('⛔⛔ a SCREENER SCALAR is refused for the chart consumers, whatever drafted it', () => {
    // `interpret` seeds a declared screener scalar as NaN when no `scalars` are
    // passed, and a chart never passes any — so `adr_pct > 5` would save and be
    // false on every bar. This is the rule the concierge path must not bypass;
    // it is enforced here, for every door, and the concierge is one of them.
    const scalarTree = {
      type: 'op', name: '>', args: [{ type: 'series', name: 'adr_pct' }, { type: 'num', value: 5 }],
    }
    const cond = validateFor('condition', authored('boolean', scalarTree))
    expect(cond.ok, 'a screener-only column passed the chart gate').toBe(false)
    const info = validateFor('infoValue', authored('numeric', scalarTree))
    expect(info.ok).toBe(false)
  })
})
