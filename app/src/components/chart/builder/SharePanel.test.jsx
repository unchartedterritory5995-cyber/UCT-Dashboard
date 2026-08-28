import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

import SharePanel, { shareUrlFor } from './SharePanel'

/**
 * The DOOR onto W5b.
 *
 * ⛔⛔ THE FIRST CASE IS THE ONE THAT MATTERS. Sharing publishes a member's work,
 * so the panel must not create a link as a side effect of being opened. The
 * server enforces that too (`GET {id}/share` is read-only) — this asserts the
 * client half, because two locks on a publishing action is the right number.
 */
describe('SharePanel', () => {
  let calls

  const jsonRoute = (map) => vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET'
    calls.push(`${method} ${url}`)
    for (const [pattern, reply] of map) {
      if (pattern.test(`${method} ${url}`)) {
        const r = typeof reply === 'function' ? reply() : reply
        return {
          ok: r.status === undefined || r.status < 400,
          status: r.status || 200,
          json: async () => r.body,
        }
      }
    }
    return { ok: false, status: 404, json: async () => ({ detail: 'no route' }) }
  })

  beforeEach(() => { calls = [] })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('⛔⛔ opening the panel READS the link state and never MINTS one', async () => {
    global.fetch = jsonRoute([[/^GET .*\/share$/, { body: { token: null } }]])
    render(<SharePanel defId="u_abc" />)

    await screen.findByText(/This formula is private/i)
    expect(calls).toEqual(['GET /api/user-definitions/u_abc/share'])
    // ⛔ THE ASSERTION THAT COUNTS: not one POST anywhere in that sequence.
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false)
  })

  it('⭐ …and the button is what mints, once, on a press', async () => {
    global.fetch = jsonRoute([
      [/^GET .*\/share$/, { body: { token: null } }],
      [/^POST .*\/share$/, { body: { token: 'sh_' + 'a'.repeat(32) } }],
    ])
    render(<SharePanel defId="u_abc" />)

    fireEvent.click(await screen.findByRole('button', { name: /Create a share link/i }))
    const box = await screen.findByLabelText('Share link')
    expect(box.value).toContain('sh_' + 'a'.repeat(32))
    expect(calls.filter((c) => c.startsWith('POST')).length).toBe(1)
  })

  it('⭐ an existing link is shown on open, with no press and no mint', async () => {
    global.fetch = jsonRoute([[/^GET .*\/share$/, { body: { token: 'sh_' + 'b'.repeat(32) } }]])
    render(<SharePanel defId="u_abc" />)

    const box = await screen.findByLabelText('Share link')
    expect(box.value).toContain('sh_' + 'b'.repeat(32))
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false)
  })

  it('⭐ turning the link off puts the panel back to private', async () => {
    global.fetch = jsonRoute([
      [/^GET .*\/share$/, { body: { token: 'sh_' + 'c'.repeat(32) } }],
      [/^DELETE .*\/share$/, { body: { ok: true, revoked: true } }],
    ])
    render(<SharePanel defId="u_abc" />)

    fireEvent.click(await screen.findByRole('button', { name: /Turn the link off/i }))
    await screen.findByText(/This formula is private/i)
    expect(screen.queryByLabelText('Share link')).toBeNull()
  })

  // ─── the three refusals ───────────────────────────────────────────────────

  it('⛔⛔ a grammar-move refusal says what it is AND what to do about it', async () => {
    // ⭐ THE ACCEPTANCE CRITERION, AT THE SURFACE A MEMBER READS. The formula is
    // unchanged and the hash verifies — and it could still compute something
    // else, because the numbers live in the table the names resolve against. The
    // member's next question is "did they send me something broken?" and the
    // answer is no, so the panel says so and names the one action that helps.
    global.fetch = jsonRoute([
      [/^GET .*\/share$/, { body: { token: null } }],
      [/^GET .*\/shared\//, {
        status: 409,
        body: { detail: { reason: 'table-version', message: 'shared against grammar version 2 and this engine now reads version 3' } },
      }],
    ])
    render(<SharePanel defId="u_abc" />)

    fireEvent.change(await screen.findByLabelText('Paste a share link'),
      { target: { value: 'sh_' + 'd'.repeat(32) } })
    fireEvent.click(screen.getByRole('button', { name: /Look up/i }))

    await screen.findByText(/grammar version 2/i)
    expect(screen.getByText(/share it again/i)).toBeTruthy()
  })

  it('⛔ a revoked link and a deleted one say DIFFERENT things', async () => {
    // ⛔ NOT ONE SENTENCE FOR BOTH. "Ask them for a new link" is useless advice
    // about a formula that no longer exists, and "they deleted it" is wrong about
    // one that was merely unshared.
    for (const [reason, message, expected] of [
      ['revoked', 'the member who shared this has since turned the link off', /Ask them for a new link/i],
      ['gone', 'the member who shared this has since deleted it', /nothing to install/i],
    ]) {
      global.fetch = jsonRoute([
        [/^GET .*\/share$/, { body: { token: null } }],
        [/^GET .*\/shared\//, { status: 410, body: { detail: { reason, message } } }],
      ])
      render(<SharePanel defId="u_abc" />)
      fireEvent.change(await screen.findByLabelText('Paste a share link'),
        { target: { value: 'sh_' + 'e'.repeat(32) } })
      fireEvent.click(screen.getByRole('button', { name: /Look up/i }))
      await screen.findByText(expected)
      cleanup()
    }
  })

  // ─── installing ───────────────────────────────────────────────────────────

  it('⭐ a preview shows whose formula it is BEFORE anything is installed', async () => {
    global.fetch = jsonRoute([
      [/^GET .*\/share$/, { body: { token: null } }],
      [/^GET .*\/shared\//, {
        body: {
          definition: { meta: { name: 'Gap And Go' } },
          author_id: 'u-someone', origin_version: 3,
        },
      }],
    ])
    render(<SharePanel defId="u_abc" />)

    fireEvent.change(await screen.findByLabelText('Paste a share link'),
      { target: { value: 'sh_' + 'f'.repeat(32) } })
    fireEvent.click(screen.getByRole('button', { name: /Look up/i }))

    await screen.findByText('Gap And Go')
    // ⛔ NOTHING WAS INSTALLED BY LOOKING. A preview that wrote would be a panel
    // that adds a formula to your account because you pasted a link into a box.
    expect(calls.some((c) => c.includes('/install'))).toBe(false)
  })

  it('⭐ a member can paste the whole URL, not just the token', async () => {
    // People copy links, not tokens. Refusing a pasted URL would be a refusal
    // about our formatting rather than about anything real.
    global.fetch = jsonRoute([
      [/^GET .*\/share$/, { body: { token: null } }],
      [/^GET .*\/shared\//, { body: { definition: { meta: { name: 'Pasted' } }, origin_version: 1 } }],
    ])
    render(<SharePanel defId="u_abc" />)

    const token = 'sh_' + '1'.repeat(32)
    fireEvent.change(await screen.findByLabelText('Paste a share link'),
      { target: { value: `https://uctintelligence.com/formulas/shared/${token}` } })
    fireEvent.click(screen.getByRole('button', { name: /Look up/i }))

    await screen.findByText('Pasted')
    expect(calls.some((c) => c.includes(`/shared/${token}`))).toBe(true)
  })

  it('⭐ installing reports the new row to its caller', async () => {
    const onInstalled = vi.fn()
    global.fetch = jsonRoute([
      [/^GET .*\/share$/, { body: { token: null } }],
      [/^GET .*\/shared\//, { body: { definition: { meta: { name: 'Theirs' } }, origin_version: 1 } }],
      [/^POST .*\/install$/, { body: { def_id: 'u_mine', version: 1 } }],
    ])
    render(<SharePanel defId="u_abc" onInstalled={onInstalled} />)

    fireEvent.change(await screen.findByLabelText('Paste a share link'),
      { target: { value: 'sh_' + '2'.repeat(32) } })
    fireEvent.click(screen.getByRole('button', { name: /Look up/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Install my own copy/i }))

    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith({ def_id: 'u_mine', version: 1 }))
  })

  // ─── history ──────────────────────────────────────────────────────────────

  it('⭐ history lists every version, and names a tombstone as deleted', async () => {
    global.fetch = jsonRoute([
      [/^GET .*\/share$/, { body: { token: null } }],
      [/^GET .*\/history$/, {
        body: {
          versions: [
            { version: 1, ast_hash: 'sha256:aaaaaaaabbbb', definition: { meta: { name: 'First' } } },
            { version: 2, ast_hash: 'sha256:ccccccccdddd', definition: { meta: { name: 'Second' } } },
            { version: 3, ast_hash: 'sha256:eeeeeeeeffff', deleted_at: 172, definition: null },
          ],
        },
      }],
    ])
    render(<SharePanel defId="u_abc" />)

    fireEvent.click(await screen.findByRole('button', { name: /Show every saved version/i }))
    await screen.findByText('First')
    expect(screen.getByText('Second')).toBeTruthy()
    // ⛔ A TOMBSTONE IS NAMED, not rendered as an untitled blank — "deleted" is
    // the fact the row carries and the reason it has no definition to show.
    expect(screen.getByText('deleted')).toBeTruthy()
  })

  it('⛔ a transport failure says try again, and does not look like "nothing shared"', async () => {
    // ⚠️ THE FAILURE THIS PANEL MUST NOT MAKE: rendering "This formula is private"
    // when the server never answered would tell a member their link is off when
    // it may be perfectly live.
    global.fetch = vi.fn(async () => { throw new Error('offline') })
    render(<SharePanel defId="u_abc" />)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toMatch(/check your connection/i)
  })

  it('⭐ the share URL is built from the token, and is empty without one', () => {
    expect(shareUrlFor('sh_xyz')).toMatch(/\/formulas\/shared\/sh_xyz$/)
    expect(shareUrlFor(null)).toBe('')
  })
})
