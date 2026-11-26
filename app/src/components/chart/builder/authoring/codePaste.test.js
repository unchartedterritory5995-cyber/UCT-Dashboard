// app/src/components/chart/builder/authoring/codePaste.test.js
// ⭐ C (2026-11-25): the browser's mirror of the code-paste import door. It reads the SAME cases as the server's
// detector (tests/fixtures/authoring/code_paste_cases.json), so the composer's count and the server's door agree on
// what is pasted code; and pasted code is counted against the import cap, never cut.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { codeKindOf, IMPORT_MAX_CHARS, DEEPVUE } from './codePaste'
import { messageLengthNote, converseBody, CONVERSE_LIMITS } from './converseClient'
import { newAuthoringState } from './authoringState'

const here = dirname(fileURLToPath(import.meta.url))
const CASES = JSON.parse(readFileSync(join(here, '../../../../../../tests/fixtures/authoring/code_paste_cases.json'), 'utf8')).cases

const paste = (chars) => {
  const head = "globalThis.indicator = {\n  name: 'Wide',\n  params: {},\n  outputs: { r: { type: 'line' } },\n  compute(bar) {\n"
  const tail = "    return { r: bar.ta.highest('high', 10) };\n  },\n};"
  const pad = '    const unused = 0;\n'
  let body = ''
  while (head.length + body.length + pad.length + tail.length <= chars) body += pad
  return (head + body + tail).padEnd(chars, ' ')
}

describe('the mirror reads the shared cases', () => {
  for (const c of CASES) {
    it(`${c.kind}: ${c.text.slice(0, 30).replace(/\n/g, ' ')}`, () => expect(codeKindOf(c.text)).toBe(c.kind))
  }
  it('CONTROL: the cases hold both kinds and chat', () => {
    expect(new Set(CASES.map((c) => c.kind))).toEqual(new Set(['deepvue', 'pine', null]))
  })
})

describe('pasted code is counted against the import cap, and sent whole', () => {
  it('a 3,262 character Deepvue paste is counted against the import cap, not the chat limit', () => {
    const p = paste(3262)
    expect(p.length).toBe(3262)
    expect(codeKindOf(p)).toBe(DEEPVUE)
    expect(messageLengthNote(p)).toEqual({ over: false, text: `3,262 of ${IMPORT_MAX_CHARS.toLocaleString('en-US')} characters of pasted code` })
  })
  it('over the import cap it is an alert in the member words', () => {
    const p = paste(IMPORT_MAX_CHARS + 10)
    expect(messageLengthNote(p).over).toBe(true)
    expect(messageLengthNote(p).text).toMatch(/characters of pasted code: the limit for pasted code is 24,000/)
  })
  it('chat over the chat limit is still the chat alert', () => {
    const chat = 'Plot the 20 day average and color it green when it rises. '.repeat(50).slice(0, 2400)
    expect(chat.length).toBe(2400)
    expect(codeKindOf(chat)).toBeNull()
    expect(messageLengthNote(chat)).toEqual({ over: true, text: `2,400 characters: the limit is ${CONVERSE_LIMITS.maxMessage.toLocaleString('en-US')}. Shorten it to send it.` })
  })
  it('the paste goes out whole', () => {
    const p = paste(3262)
    expect(converseBody({ message: p, state: newAuthoringState() }).message).toBe(p)
  })
})
