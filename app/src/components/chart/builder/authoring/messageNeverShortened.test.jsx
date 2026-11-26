// app/src/components/chart/builder/authoring/messageNeverShortened.test.jsx
//
// ⛔ 2026-11-25 -- THE WINDOW NEVER SHORTENS A MEMBER'S MESSAGE (coordinator: a live silent stand-in, fixed on its own).
// `converseBody` cut every message to the server's 2,000-character limit before it left the window: the member saw
// their whole paste, the assistant answered the first 2,000 characters as if they were all of it (two pasted Deepvue
// indicators, 3,262 and 2,039 characters, were answered from cut code), and the server's own sentence for a request
// that is too long never fired. Held here: the message goes whole on every path out of the window; over the limit the
// member reads the server's sentence; the composer counts before they send.
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { converseBody, converseTurn, messageLengthNote, CONVERSE_LIMITS, LENGTH_NOTE_FROM } from './converseClient'
import { memberRefusal } from './memberWords'
import MessageLength from './MessageLength'
import { newAuthoringState } from './authoringState'

const HEAD = 'globalThis.indicator = {\n'
const TAIL = '\n}'
const LONG = HEAD + 'x'.repeat(3262 - HEAD.length - TAIL.length) + TAIL   // 3,262 characters, as dv07 was
const STATE = newAuthoringState()

afterEach(() => vi.unstubAllGlobals())

describe('the message goes whole', () => {
  it('the request body carries every character of a message over the limit', () => {
    expect(LONG.length).toBe(3262)
    expect(LONG.length).toBeGreaterThan(CONVERSE_LIMITS.maxMessage)
    expect(converseBody({ message: LONG, state: STATE }).message).toBe(LONG)
  })

  it('what reaches the network is the whole message', async () => {
    const sent = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      sent.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ ok: false, gate: 'converse:too-large',
        reason: 'this conversation turn carries more than the assistant may read at once -- your request is 3,262 characters; the limit is 2,000' }),
      { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    await converseTurn({ message: LONG, state: STATE }).catch(() => null)
    expect(sent).toHaveLength(1)
    expect(sent[0].message).toBe(LONG)
  })

  it('no client path shortens a message (the source, comments aside)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const code = readFileSync(join(here, 'converseClient.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const needle = ['maxMes', 'sage'].join('')
    expect(code.includes(needle)).toBe(true)                       // CONTROL: the limit is still named in code
    expect(/\.(slice|substring|substr)\([^)]*maxMessage/.test(code)).toBe(false)
  })
})

describe('over the limit, the member reads the server', () => {
  it("the server's sentence is what the member reads, never a generic fault", () => {
    const reason = 'this conversation turn carries more than the assistant may read at once -- your request is 3,262 characters; the limit is 2,000'
    const said = memberRefusal('converse:too-large', reason)
    expect(said).toBe(reason)
    expect(said).toMatch(/3,262 characters; the limit is 2,000/)
    expect(memberRefusal('converse:view', 'x')).not.toBe('x')     // CONTROL: another converse gate keeps its own words
  })
})

describe('the composer counts', () => {
  it('nothing below the share, a count from it, an alert over the limit', () => {
    const max = CONVERSE_LIMITS.maxMessage
    expect(messageLengthNote('a'.repeat(Math.floor(max * LENGTH_NOTE_FROM) - 1))).toBeNull()
    expect(messageLengthNote('a'.repeat(1900))).toEqual({ over: false, text: '1,900 of 2,000 characters' })
    expect(messageLengthNote('a'.repeat(max))).toEqual({ over: false, text: '2,000 of 2,000 characters' })
    expect(messageLengthNote(LONG)).toEqual({ over: true, text: '3,262 characters: the limit is 2,000. Shorten it to send it.' })
  })

  it('renders the alert over the limit and nothing for a short message', () => {
    const { rerender } = render(<MessageLength message="short" testId="len" />)
    expect(screen.queryByTestId('len')).toBeNull()
    rerender(<MessageLength message={LONG} testId="len" />)
    const el = screen.getByTestId('len')
    expect(el.getAttribute('data-over')).toBe('true')
    expect(el.getAttribute('role')).toBe('alert')
    expect(el.textContent).toBe('3,262 characters: the limit is 2,000. Shorten it to send it.')
  })

  it('both composers show it (the code, comments aside)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    for (const [file, id] of [['../studio/CreateIndicatorPanel.jsx', 'create-indicator-length'], ['../ConverseBox.jsx', 'converse-length']]) {
      const code = readFileSync(join(here, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      expect(code).toMatch(new RegExp(`<MessageLength message=\\{message\\} testId="${id}"`))
    }
  })
})
