// app/src/components/chart/builder/pineBoxSuggestVoice.test.jsx
//
// ─── 🔴 A SUGGESTION MUST NOT NAME THE WRONG VENDOR ──────────────────────────
//
// The suggestion block introduced every `refusal.suggest` with:
//
//   "thinkorswim doesn't publish these defaults, so this engine won't assume
//    them. The conventional call is: …"
//
// ⛔⛔ AND THE PINE DOOR EMITS SUGGESTIONS TOO. Measured through `inspectSource`
// — the door a member types at:
//
//   plot(ta.wma(close, 27.5))                      → pine:window,  hma(close, 55)
//   request.security(syminfo.tickerid, "240", …)   → pine:request, timeframe.period
//
// Ordinary Pine. Both read a sentence about thinkorswim, and a REASON that is
// false of each: `hma` is offered because this engine DECLARES it and it spares a
// hand-expansion; `timeframe.period` is not a "default" in any sense.
//
// ⚠️ AND THE COMMITTED FIXTURES CANNOT SHOW IT, which is why this file constructs
// its scripts. A first pass "measured" four corpus Pine scripts carrying a
// suggest — true of `translatePine` called directly, FALSE through the door,
// where the member-input translation lands all four on an earlier wall
// (07-hull-suite: pine:window + hma → pine:request + nothing). Measuring the
// engine and reporting it as the member's experience is the mistake this note
// exists to stop the next reader repeating.
//
// ⭐ THIS FILE ALREADY RULED ON THE SHAPE, for the heading: "a heading that still
// said 'Pine' over a thinkScript paste would be a sentence that is false about
// the text on screen." Same fix, same source of truth — the DETECTED dialect.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import PineBox, { ImportBox, inspectSource } from './PineBox'

// ⚠️ `ImportBox` IS THE MULTI-DIALECT DOOR, and the default export is not.
// `PineBox` is the Pine-ONLY box: it takes no `dialect` prop and always reads the
// paste as Pine, so handing it a thinkScript file translates it as Pine and lands
// on `pine:no-output`. `BuilderSheet` mounts `ImportBox`. A first draft of this
// file rendered `PineBox` with `dialect="auto"` — a prop it ignores — and the
// thinkScript case failed for a reason that had nothing to do with the sentence
// under test.

const PINE_WMA = '//@version=5\nindicator("t")\nplot(ta.wma(close, 27.5))\n'
const PINE_SEC = '//@version=5\nindicator("t")\n'
  + 'x = request.security(syminfo.tickerid, "240", close)\nplot(x)\n'
const TS_RSI = fs.readFileSync(path.resolve(process.cwd(), '..',
  'tests/fixtures/thinkscript/16-scan-rsi-crosses-30-70.ts'), 'utf8')

const paste = (text) => fireEvent.change(
  screen.getByLabelText(/^(pine script|script or formula)$/i), { target: { value: text } })

beforeEach(() => { cleanup() })

describe('the suggestion speaks about the script the member actually pasted', () => {
  it('⛔ all three reach the member WITH a suggestion — through the shipped door', () => {
    // ⚠️ NON-VACUITY, AND IT IS THE ASSERTION THIS FILE GOT WRONG FIRST TIME.
    // `inspectSource` is what the component calls; `translatePine` is not, and the
    // two disagree about which wall these scripts hit.
    for (const [label, src] of [['wma', PINE_WMA], ['security', PINE_SEC], ['ts', TS_RSI]]) {
      const r = inspectSource(src, 'auto')
      expect(r.refusal, label).toBeTruthy()
      expect(r.refusal.suggest, `${label} no longer reaches the member with a suggestion`)
        .toBeTruthy()
    }
    expect(inspectSource(PINE_WMA, 'auto').dialect).toBe('pine')
    expect(inspectSource(TS_RSI, 'auto').dialect).toBe('thinkscript')
  })

  it('⭐⭐ a PINE paste is never told about thinkorswim', async () => {
    for (const src of [PINE_WMA, PINE_SEC]) {
      cleanup()
      render(<ImportBox onPick={vi.fn()} />)
      paste(src)
      const box = await screen.findByTestId('import-suggest')
      expect(box.textContent).not.toMatch(/thinkorswim/i)
      // …and it does not claim a missing DEFAULT either — the other half of the
      // old sentence, equally untrue of `hma(close, 55)`.
      expect(box.textContent).not.toMatch(/default/i)
      expect(box.textContent).toMatch(/does translate/i)
    }
  })

  it('⭐ a thinkScript paste KEEPS its vendor sentence, because there it is true', async () => {
    // ⛔ THE CONTROL. Deleting the vendor sentence everywhere would pass the case
    // above and lose a true, hard-won explanation: thinkorswim publishes the RULE
    // ("default values should be used") without the NUMBERS, which is exactly why
    // this engine refuses to invent them.
    render(<ImportBox onPick={vi.fn()} />)
    paste(TS_RSI)
    const box = await screen.findByTestId('import-suggest')
    expect(box.textContent).toMatch(/thinkorswim/i)
    expect(box.textContent).toMatch(/publish/i)
  })

  it('⭐ and each renders the CALL itself, which is the part the member copies', async () => {
    for (const [src, wanted] of [[PINE_WMA, 'hma('], [PINE_SEC, 'timeframe.period'],
      [TS_RSI, 'RSI(']]) {
      cleanup()
      render(<ImportBox onPick={vi.fn()} />)
      paste(src)
      const box = await screen.findByTestId('import-suggest')
      expect(box.textContent).toContain(wanted)
    }
  })
})
