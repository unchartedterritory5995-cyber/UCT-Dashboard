import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ConciergeBox, { readBackFor } from './ConciergeBox.jsx'
import { sentenceFor } from '../engine/ast/sentence.js'
import { TABLE } from '../engine/ast/parse.js'

// ─── THE CLAIM THIS FILE EXISTS TO PROVE ────────────────────────────────────
//
// ⭐⭐ THE READ-BACK THE USER CONFIRMS IS `sentenceFor(ast)` — COMPUTED IN THE
// BROWSER, FROM THE TREE. The server's answer carries a `sentence` too, and this
// box must not show it. That is untestable by comparing text against a correct
// answer (a box that echoed a correct server sentence would look identical), so
// every case below plants a DIFFERENT, PLAUSIBLE server sentence and asserts the
// tree's is what renders. The Python half of the same claim is asserted
// structurally, over `propose`'s own AST, in `tests/test_definition_concierge.py`.

const HERE = path.dirname(fileURLToPath(import.meta.url))

// Derived, never hand-listed: the same discipline the rest of the phase applies.
const SERIES = Object.keys(TABLE.series).sort()[0]
const WINDOWED = Object.keys(TABLE.functions).sort()
  .find((f) => JSON.stringify(TABLE.functions[f].args) === JSON.stringify(['series', 'int']))

const TREE = {
  type: 'call',
  name: WINDOWED,
  args: [{ type: 'series', name: SERIES }, { type: 'num', value: 20 }],
}

/** A server answer whose `sentence` is a LIE — plausible, fluent, and about a
 *  different formula. If the box ever renders this, the rail has rotted. */
const LIE = 'a smoothed momentum oscillator of the last nine bars'

function jsonResponse(body, { status = 200, ok = true } = {}) {
  return { ok, status, json: async () => body }
}

function proposal(overrides = {}) {
  return {
    ok: true,
    ast: TREE,
    source: `${WINDOWED}(${SERIES}, 20)`,
    repaint: 'non-repainting',
    sentence: LIE,
    tokens: { input: 10, output: 5 },
    ...overrides,
  }
}

/** ⚠️ THE CLICK IS AWAITED INSIDE `act`. The submit is async, so its state update
 *  lands after the handler returns and React reports it as an un-acted update —
 *  514 lines of exactly that noise cost this branch a debugging session once. The
 *  assertions still use `findBy*`, so this only removes the warning, never the
 *  wait. */
async function draft(fetchImpl, props = {}) {
  render(<ConciergeBox fetchImpl={fetchImpl} {...props} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'average the close' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /draft a formula/i }))
  })
}

afterEach(() => cleanup())

describe('ConciergeBox', () => {
  it('renders the READ-BACK FROM THE TREE and never the server\'s sentence', async () => {
    // ⭐ THE FLAGSHIP. The response's `sentence` is fluent nonsense about another
    // indicator; `sentenceFor(TREE)` is the truth. Both are asserted, so a box
    // that showed NEITHER (a blank panel) fails too.
    const fetchImpl = vi.fn(async () => jsonResponse(proposal()))
    await draft(fetchImpl)

    const shown = await screen.findByTestId('concierge-sentence')
    expect(shown).toHaveTextContent(sentenceFor(TREE))
    expect(shown.textContent).not.toBe(LIE)
    expect(screen.queryByText(LIE)).toBeNull()
    // Non-vacuity: the two really are different strings, so the assertion above
    // is not satisfied by them being equal.
    expect(sentenceFor(TREE)).not.toBe(LIE)
  })

  it('does not read `sentence` off the response AT ALL — proved by DELETING it', async () => {
    // ⛔ THE STRUCTURAL HALF, BEHAVIOURALLY. A box that read `body.sentence` with
    // the tree's as a fallback would pass the case above. With the field absent
    // entirely, a reader breaks and a deriver does not.
    const body = proposal()
    delete body.sentence
    await draft(vi.fn(async () => jsonResponse(body)))
    expect(await screen.findByTestId('concierge-sentence')).toHaveTextContent(sentenceFor(TREE))
  })

  it('does not mention `sentence` from the response anywhere in its source', async () => {
    // The absence of a read is not behaviourally observable once the two agree,
    // so it is asserted over the file itself — the same reason `defSchema`'s and
    // `nativeRegistry`'s absence claims are source scans.
    const src = fs.readFileSync(path.join(HERE, 'ConciergeBox.jsx'), 'utf8')
    const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
    expect(code).not.toMatch(/body\s*\.\s*sentence/)
    expect(code).toMatch(/sentenceFor\(/)          // the positive control
  })

  it('sends the prompt AND the bars the chart is holding', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(proposal()))
    const bars = [{ t: 1, o: 1, h: 2, l: 0, c: 1.5, v: 10 }]
    await draft(fetchImpl, { bars })
    await screen.findByTestId('concierge-proposal')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/user-definitions/propose')
    expect(init.method).toBe('POST')
    const sent = JSON.parse(init.body)
    expect(sent.prompt).toBe('average the close')
    expect(sent.bars).toEqual(bars)
  })

  it('sends the KIND it was mounted for, and defaults to an indicator', async () => {
    // ⭐ THE SERVER'S CONDITION STAGE IS UNREACHABLE UNLESS THE REQUEST SAYS WHAT
    // IS BEING ASKED FOR. A screen is `<tree> != 0`, so a tree that produces a
    // number is a fine indicator and a wrong answer to "find me stocks where…" —
    // and a box that always asked for an indicator would be a box whose scan
    // stage can never fire, with every test on both sides still green.
    const asScan = vi.fn(async () => jsonResponse(proposal()))
    await draft(asScan, { kind: 'scan' })
    expect(JSON.parse(asScan.mock.calls[0][1].body).kind).toBe('scan')

    cleanup()
    const asDefault = vi.fn(async () => jsonResponse(proposal()))
    await draft(asDefault)
    expect(JSON.parse(asDefault.mock.calls[0][1].body).kind).toBe('indicator')
  })

  it('asks for the SCREEN in plain English, and still derives the read-back', async () => {
    // The copy moves with the kind; the ONE rule does not. The planted server
    // sentence is still ignored on the scan path — a second render path is the
    // cheapest place for a second read-back to appear.
    const fetchImpl = vi.fn(async () => jsonResponse(proposal()))
    render(<ConciergeBox fetchImpl={fetchImpl} kind="scan" />)
    expect(screen.getByLabelText(/plain English/i)).toBeTruthy()
    expect(screen.getByTestId('concierge-box')).toHaveAttribute('data-kind', 'scan')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'trending stocks' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /draft a formula/i }))
    })
    expect(await screen.findByTestId('concierge-sentence')).toHaveTextContent(sentenceFor(TREE))
    expect(screen.queryByText(LIE)).toBeNull()
  })

  it('shows a REFUSAL with its door and NO formula', async () => {
    // ⛔ A formula beside a refusal is a formula somebody uses. The tree is not in
    // the body at all (the server refuses to send one) and nothing formula-shaped
    // may be rendered from a refusal.
    await draft(vi.fn(async () => jsonResponse({
      ok: false, gate: 'lint:repaint',
      reason: "the assistant's formula would repaint, so it was not accepted",
    })))
    expect(await screen.findByTestId('concierge-refusal')).toHaveTextContent(/would repaint/)
    expect(screen.getByTestId('concierge-gate')).toHaveTextContent('lint:repaint')
    expect(screen.queryByTestId('concierge-proposal')).toBeNull()
    expect(screen.queryByTestId('concierge-sentence')).toBeNull()
    expect(screen.queryByTestId('concierge-source')).toBeNull()
    expect(screen.queryByRole('button', { name: /use this formula/i })).toBeNull()
  })

  it('a 402 reads as a PLAN message, not as "no answer"', async () => {
    // ⚠️ C Task 13's precondition, inherited: this route is paid-gated, so a 402
    // looks exactly like a quiet answer unless the status is read BEFORE the body.
    await draft(vi.fn(async () => jsonResponse({ detail: 'nope' }, { status: 402, ok: false })))
    expect(await screen.findByTestId('concierge-refusal')).toHaveTextContent(/paid plan/i)
    expect(screen.getByTestId('concierge-gate')).toHaveTextContent('http:402')
  })

  it('a tree the read-back cannot say becomes a REFUSAL, not a blank screen', async () => {
    // ⚠️ ERROR ISOLATION. `sentenceFor` THROWS for a tree it has no English for,
    // and spec §6's ten instance states do not include "the page died".
    const alien = { type: 'call', name: 'zzNotInTheTable', args: [] }
    await draft(vi.fn(async () => jsonResponse(proposal({ ast: alien, source: 'zz()' }))))
    expect(await screen.findByTestId('concierge-refusal')).toBeTruthy()
    expect(screen.getByTestId('concierge-gate')).toHaveTextContent('sentence')
    expect(screen.queryByTestId('concierge-proposal')).toBeNull()
  })

  it('hands the ACCEPTED proposal up with the TREE\'S sentence attached', async () => {
    // ⛔ THE BOX NEVER SAVES. It calls `onAccept`; the builder writes, through the
    // same store door a typed formula goes through.
    const onAccept = vi.fn()
    await draft(vi.fn(async () => jsonResponse(proposal())), { onAccept })
    fireEvent.click(await screen.findByRole('button', { name: /use this formula/i }))
    expect(onAccept).toHaveBeenCalledTimes(1)
    const handed = onAccept.mock.calls[0][0]
    expect(handed.ast).toEqual(TREE)
    expect(handed.sentence).toBe(sentenceFor(TREE))
    expect(handed.repaint).toBe('non-repainting')
  })

  it('Discard clears the proposal without touching the network', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(proposal()))
    await draft(fetchImpl)
    fireEvent.click(await screen.findByRole('button', { name: /discard/i }))
    await waitFor(() => expect(screen.queryByTestId('concierge-proposal')).toBeNull())
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a network throw is a refusal, and the button comes back', async () => {
    await draft(vi.fn(async () => { throw new Error('offline') }))
    expect(await screen.findByTestId('concierge-refusal')).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /draft a formula/i })).not.toBeDisabled())
  })

  it('will not fire on an empty prompt', () => {
    const fetchImpl = vi.fn()
    render(<ConciergeBox fetchImpl={fetchImpl} />)
    expect(screen.getByRole('button', { name: /draft a formula/i })).toBeDisabled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('readBackFor returns a message instead of throwing', () => {
    expect(readBackFor(TREE).text).toBe(sentenceFor(TREE))
    const bad = readBackFor({ type: 'call', name: 'zzNope', args: [] })
    expect(bad.text).toBeUndefined()
    expect(bad.error).toMatch(/read-back/)
  })
})
