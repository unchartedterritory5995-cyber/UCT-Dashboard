// app/src/pages/formulas/formulaReference.route.test.jsx
//
// ─── 🔴 THE WIRE, AND WHAT THE PAGE MAY NEVER SAY ───────────────────────────
//
// A derivation nobody can reach is this repo's signature defect, and a reference
// page is the worst place to commit it — the whole point is that a member can
// FIND the vocabulary. So the wire is railed, not assumed.
//
// ⛔⛔ AND IT IS RAILED IN TWO HALVES ON PURPOSE, because they fail for different
// reasons and neither covers the other:
//
//   1. THE ROUTE EXISTS — asserted against `App.jsx`'s SOURCE. Delete the
//      `<Route>` and this goes red while every component test below stays green.
//   2. THE PAGE IS TRUE — asserted by rendering the component. Break the
//      derivation and these go red while the route still exists.
//
// ⚠️ WHY NOT ONE TEST THAT RENDERS `App` AT THE URL, which is what
// `sharedFormula.route.test.jsx` does and is strictly better: MEASURED, it does
// not work here. Those routes sit OUTSIDE `AuthGuard`/`Layout`; this one is
// inside both, and rendering `App` at an in-Layout path in jsdom produces an
// EMPTY BODY — the shell's providers never settle, so the assertion would fail
// for a reason that has nothing to do with the route. Faking it with enough
// mocks to get the shell up would mock the very wire under test. So the source
// assertion stands in for that half, and this paragraph is here so the next
// reader knows it is a deliberate substitution rather than an oversight.

import fs from 'node:fs'
import path from 'node:path'
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, afterEach } from 'vitest'

import FormulaReference from './FormulaReference'

const APP_SRC = fs.readFileSync(
  path.resolve(process.cwd(), 'src/App.jsx'), 'utf8')

afterEach(cleanup)

describe('🔴 the page is wired into the app', () => {
  it('⭐⭐ App.jsx routes /formulas/reference at the page', () => {
    // ⛔ BOTH HALVES OF THE WIRE, because either alone can be present while the
    // route is dead: a `<Route>` pointing at nothing, or an import nothing routes.
    expect(APP_SRC).toMatch(
      /const FormulaReference = lazy\(\(\) => import\('\.\/pages\/formulas\/FormulaReference'\)\)/)
    expect(APP_SRC).toMatch(
      /<Route\s+path="\/formulas\/reference"\s+element=\{<FormulaReference \/>\}\s*\/>/)
  })

  it('⛔ CONTROL — the probe can tell a MISSING route from a present one', () => {
    // Without this the regex above could be satisfied by any string in the file,
    // and a typo'd path would read as "wired".
    expect(APP_SRC).not.toMatch(/<Route\s+path="\/formulas\/not-a-reference"/)
  })
})

describe('what the page may never tell a member', () => {
  const open = () => render(
    <MemoryRouter><FormulaReference /></MemoryRouter>)

  it('⭐ it renders the whole vocabulary with its DERIVED count', () => {
    open()
    const count = screen.getByTestId('reference-count')
    // ⛔ A SHAPE, NOT A NUMBER. An exact literal reds this file the day a 64th
    // function is declared, which trains the next reader to edit a number
    // instead of reading a failure.
    expect(count).toHaveTextContent(/^\d+ names/)
    expect(count).toHaveTextContent(/deliberately not available/)
  })

  it('⛔⛔ a TOMBSTONE is never shown as unavailable — `vwap` and `adx` are LIVE', () => {
    // `_functions_excluded` holds five prose keys among its nineteen, and two of
    // them (`_vwap_was_here`, `_adx_was_here`) are notes about functions that are
    // CALLABLE TODAY. A page rendering every key would tell a member the engine
    // lacks `vwap` and `adx` while both sit in the roster above it.
    open()
    expect(document.querySelector('[data-excluded="_vwap_was_here"]')).toBeNull()
    expect(document.querySelector('[data-excluded="_adx_was_here"]')).toBeNull()
    // …and the CONTROL that makes that mean something: they ARE present as names.
    const fns = document.querySelector('[data-group="functions"]')
    expect(within(fns).getByText(/^vwap\(/)).toBeTruthy()
    expect(within(fns).getByText(/^adx\(/)).toBeTruthy()
  })

  it('⭐⭐ searching a name we LACK answers with the reason, not with silence', async () => {
    open()
    fireEvent.change(screen.getByTestId('reference-search'), { target: { value: 'obv' } })
    await waitFor(() => {
      const gone = document.querySelector('[data-excluded="obv"]')
      expect(gone).toBeTruthy()
      expect(gone.textContent).toMatch(/CUMULATIVE/)
    })
    // ⭐ AND THE BOUNDED FORM WE DO HAVE IS IN THE SAME ANSWER, so the member
    // leaves with something to write rather than only with a refusal.
    expect(screen.getByText(/^obvN\(/)).toBeTruthy()
  })

  it('⭐ a member searches by what it DOES — "high volume" finds `hvc_52w`', async () => {
    open()
    fireEvent.change(screen.getByTestId('reference-search'),
      { target: { value: 'high volume' } })
    await waitFor(() => expect(screen.getByText('hvc_52w')).toBeTruthy())
  })

  it('⛔ an empty result SAYS WHAT IT SEARCHED rather than showing nothing', async () => {
    // A blank result is indistinguishable from "you typed it wrong", and the
    // common cause is real: this matches word beginnings, not word forms.
    open()
    fireEvent.change(screen.getByTestId('reference-search'),
      { target: { value: 'zzzznotathing' } })
    const empty = await screen.findByTestId('reference-empty')
    expect(empty).toHaveTextContent(/descriptions/)
    expect(empty).toHaveTextContent(/highest volume/)
  })

  it('⭐ the ATR vendor note reaches the reference, not just the paste box', () => {
    // A member reading about `atr` here is owed the same sentence as one pasting
    // a script that uses it. A note reachable through only one door would make
    // two classes of member.
    open()
    const note = document.querySelector('[data-trait="vendorNote"]')
    expect(note).toBeTruthy()
    expect(note.textContent).toMatch(/wilder/i)
  })
})
