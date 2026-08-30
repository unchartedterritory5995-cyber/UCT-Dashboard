// app/src/pages/formulas/formulaLibrary.route.test.jsx
//
// ─── 🔴 THE WIRE, AND THE CONSENT BOUNDARY AT THE SURFACE ───────────────────
//
// ⛔⛔ TWO HALVES THAT FAIL FOR DIFFERENT REASONS, the same split
// `formulaReference.route.test.jsx` records:
//
//   1. THE ROUTE EXISTS — asserted against `App.jsx`'s SOURCE. Delete the
//      `<Route>` and this goes red while every component test below stays green.
//   2. THE PAGE IS TRUE — asserted by rendering it.
//
// ⚠️ THE SOURCE ASSERTION IS A DELIBERATE SUBSTITUTION for rendering `App` at the
// URL, for the reason the reference page's rail states in full: this route sits
// INSIDE `AuthGuard`/`Layout`, and rendering the shell in jsdom produces an empty
// body, so that test would fail for a reason unrelated to the route.
//
// ⭐ AND THE PATH IS ASSERTED BY DERIVATION, never by a retyped string — the
// module that owns it is the one `App.jsx` routes on, so a rename moves both.

import fs from 'node:fs'
import path from 'node:path'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

import FormulaLibrary from './FormulaLibrary'
import { FORMULA_LIBRARY_PATH } from './formulaShareLink'

const APP_SRC = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8')

const entry = (token, over = {}) => ({
  token, name: 'Oversold in an uptrend', shortName: 'OSU',
  description: null, repaint: 'non-repainting', placement: 'price',
  inputs: 1, published_at: 1_756_000_000, ast_hash: 'a'.repeat(16), ...over,
})

const draw = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

let calls
const route = (map) => vi.fn(async (url, opts = {}) => {
  const method = opts.method || 'GET'
  calls.push(`${method} ${url}`)
  for (const [re, reply] of map) {
    if (re.test(`${method} ${url}`)) {
      const r = typeof reply === 'function' ? reply() : reply
      return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.body }
    }
  }
  return { ok: false, status: 404, json: async () => ({ detail: 'no route' }) }
})

beforeEach(() => { calls = [] })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('🔴 the library is wired into the app', () => {
  it('⛔ `App.jsx` registers the route, and by the DERIVED constant', () => {
    expect(APP_SRC).toContain('FORMULA_LIBRARY_PATH')
    expect(APP_SRC).toMatch(/<Route\s+path=\{FORMULA_LIBRARY_PATH\}/)
    expect(APP_SRC).toContain('FormulaLibrary')
    // ⛔ AND NOT HAND-TYPED BESIDE IT. A literal path in `App.jsx` is exactly the
    // drift `formulaShareLink.js` exists to prevent, and its header records the
    // outcome: every share link a member copied resolved to a 404.
    expect(APP_SRC).not.toContain(`path="${FORMULA_LIBRARY_PATH}"`)
  })

  it('⭐ the page is lazily imported, like every other route in that block', () => {
    expect(APP_SRC).toMatch(/const FormulaLibrary = lazy\(\(\) => import\(/)
  })

  it('⛔⛔ …and something LINKS to it — a route nobody can reach is not shipped', () => {
    // ⚰️ THE DEFECT THIS REPO HUNTS HARDEST, and the neighbouring reference page
    // is the precedent: it was "reachable ONLY by typing the URL" until somebody
    // noticed, and `MoreSheet.jsx` says so in its own comment. A library is worse
    // to get wrong than a reference, because an unreachable one does not read as
    // missing — it reads as EMPTY, i.e. "nobody publishes anything here".
    //
    // ⛔ THE PATH IS DERIVED FROM THE CONSTANT, so a rename cannot leave a door
    // pointing at a route that moved. That is exactly the drift
    // `formulaShareLink.js` was created after, and the reason this asserts a
    // match rather than a hard-coded string.
    // ⚰️⚰️ THIS RAIL WAS VACUOUS ON ITS FIRST DRAFT AND THE MUTATION CAUGHT IT.
    // `formulaShareLink.js` is the module that DECLARES the path, so it contains
    // the literal — and counting it as a door made the test pass with every real
    // link deleted. A rail that cannot fail is not a rail, so the declaring file
    // is excluded BY WHAT IT CONTAINS rather than by a filename typed here, and
    // the page itself is excluded the same way.
    const roots = ['src/components', 'src/pages']
    const doors = []
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, name.name)
        if (name.isDirectory()) { walk(full); continue }
        if (!/\.(jsx?|tsx?)$/.test(name.name)) continue
        if (/\.test\.[jt]sx?$/.test(name.name)) continue
        const src = fs.readFileSync(full, 'utf8')
        if (src.includes('export const FORMULA_LIBRARY_PATH')) continue
        if (src.includes('data-testid="formula-library"')) continue
        if (src.includes(FORMULA_LIBRARY_PATH)) doors.push(full)
      }
    }
    for (const r of roots) walk(path.resolve(process.cwd(), r))
    expect(doors.length, `nothing links to ${FORMULA_LIBRARY_PATH}`).toBeGreaterThan(0)
    // ⭐ THE CONTROL: the same walk finds the reference page's doors, so an empty
    // result above would be a measurement and not a scan that reads nothing.
    const refDoors = []
    const walkRef = (dir) => {
      for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, name.name)
        if (name.isDirectory()) { walkRef(full); continue }
        if (!/\.(jsx?|tsx?)$/.test(name.name) || /\.test\./.test(name.name)) continue
        if (fs.readFileSync(full, 'utf8').includes('/formulas/reference')) refDoors.push(full)
      }
    }
    for (const r of roots) walkRef(path.resolve(process.cwd(), r))
    expect(refDoors.length).toBeGreaterThan(0)
  })
})

describe('🔴 what the page shows', () => {
  it('⭐⭐ it lists what the server returned, with the facts a member chooses on', async () => {
    global.fetch = route([[/^GET .*\/library/, { body: { entries: [entry('sh_a')], next: null } }]])
    draw(<FormulaLibrary />)

    expect(await screen.findByTestId('library-entry-sh_a')).toBeTruthy()
    const card = screen.getByTestId('library-entry-sh_a')
    expect(card).toHaveTextContent('Oversold in an uptrend')
    expect(card).toHaveTextContent('never repaints')
    expect(card).toHaveTextContent('1 setting')
  })

  it('⛔⛔ it shows NO author — the page could not display one if it wanted', async () => {
    // ⚠️ A DECISION, NOT AN OMISSION. Members published a formula, not their name;
    // attribution is additive later and cannot be taken back once shipped. The
    // rail is on BOTH sides: `test_the_library_names_NO_AUTHOR` proves the server
    // sends none, and this proves the page does not invent one from anything else
    // in the payload.
    global.fetch = route([[/^GET .*\/library/, {
      body: { entries: [entry('sh_a', { author_id: 'u-someone', author: 'Pat' })], next: null },
    }]])
    draw(<FormulaLibrary />)

    await screen.findByTestId('library-entry-sh_a')
    expect(screen.queryByText(/u-someone/)).toBeNull()
    expect(screen.queryByText(/\bPat\b/)).toBeNull()
  })

  it('⛔ an EMPTY library is not an error, and does not read as one', async () => {
    global.fetch = route([[/^GET .*\/library/, { body: { entries: [], next: null } }]])
    draw(<FormulaLibrary />)

    expect(await screen.findByTestId('library-empty')).toHaveTextContent(/Nothing has been published yet/i)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('⛔ a server refusal says so, and is NOT rendered as an empty library', async () => {
    // ⚰️ THE FAILURE THIS SEPARATES. "Nothing published" and "the request failed"
    // look identical to a member if both render the same empty page — and only
    // one of them is worth retrying.
    global.fetch = route([[/^GET .*\/library/, { status: 500, body: { detail: 'boom' } }]])
    draw(<FormulaLibrary />)

    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.queryByTestId('library-empty')).toBeNull()
  })

  it('⭐ installing goes through the SHIPPED install door, on the entry’s own token', async () => {
    global.fetch = route([
      [/^GET .*\/library/, { body: { entries: [entry('sh_a')], next: null } }],
      [/^POST .*\/shared\/sh_a\/install$/, { body: { def_id: 'u_new' } }],
    ])
    draw(<FormulaLibrary />)
    fireEvent.click(await screen.findByTestId('library-install-sh_a'))

    await waitFor(() => expect(screen.getByTestId('library-install-sh_a')).toHaveTextContent('Installed'))
    expect(calls).toContain('POST /api/user-definitions/shared/sh_a/install')
  })

  it('⛔⛔ a grammar-move refusal on install names the ACTION, not just the error', async () => {
    // ⭐ THE SAME MAP THE SHARE PAGE READS. Two surfaces saying different things
    // about one refusal is the second-authority defect wearing a friendly face.
    global.fetch = route([
      [/^GET .*\/library/, { body: { entries: [entry('sh_a')], next: null } }],
      [/^POST .*\/install$/, {
        status: 409,
        body: { detail: { reason: 'table-version', message: 'shared against grammar version 2' } },
      }],
    ])
    draw(<FormulaLibrary />)
    fireEvent.click(await screen.findByTestId('library-install-sh_a'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/grammar version 2/i)
    expect(alert).toHaveTextContent(/share it again/i)
  })

  it('⭐ paging APPENDS rather than replacing what is already on screen', async () => {
    // ⛔ Replacing would silently drop everything the member scrolled past.
    let page = 0
    global.fetch = route([[/^GET .*\/library/, () => {
      page += 1
      return page === 1
        ? { body: { entries: [entry('sh_a', { name: 'First' })], next: 42 } }
        : { body: { entries: [entry('sh_b', { name: 'Second' })], next: null } }
    }]])
    draw(<FormulaLibrary />)

    fireEvent.click(await screen.findByTestId('library-more'))
    await screen.findByTestId('library-entry-sh_b')
    expect(screen.getByTestId('library-entry-sh_a')).toBeTruthy()
    expect(calls.some((c) => c.includes('after=42'))).toBe(true)
    // …and the button goes away when the server says there is no more.
    expect(screen.queryByTestId('library-more')).toBeNull()
  })
})
