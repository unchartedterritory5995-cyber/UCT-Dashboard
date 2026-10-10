// TERM-056 — the command string as an interchange format. Pure; the Notebook paste side and the
// shell's `?cmd=` arrival are tested where they live (NoteEditorPage.terminalLinks.test.jsx,
// TerminalShell.audit2.test.jsx).
import { describe, it, expect } from 'vitest'
import { asTerminalCommand, commandOfHref, terminalCommandHref, TERMINAL_PATH } from './commandInterchange'
import parseCommand from './parseCommand'

describe('asTerminalCommand: what a pasted line IS', () => {
  it.each([
    ['NVDA GRADE', 'NVDA GRADE'],
    ['  NVDA GP  ', 'NVDA GP'],
    ['GP SPY', 'GP SPY'],
    ['NVDA GP.', 'NVDA GP'],                 // trailing sentence punctuation, as the command line drops it
    ['B:semis-daily', 'B:semis-daily'],      // a board address keeps its slug as written
    ['b:Semis', 'B:Semis'],
    ['N:42', 'N:42'],                        // a saved-item address
    ['l:12', 'L:12'],
    ['BOARD GP NVDA AMD', 'BOARD GP NVDA AMD'],
  ])('%j is the command %j', (text, want) => {
    expect(asTerminalCommand(text)).toBe(want)
  })

  it.each([
    ['NVDA'],                    // a bare ticker is a word in a note, not a command
    ['nvda grade'],              // lower case reads as prose
    ['Revenue was up 12% on the quarter'],
    ['HELP GP'],
    ['ASK what moved semis'],
    ['NVDA AMD MSFT TSLA'],      // a pasted list
    ['NVDA GRADE\nAMD GRADE'],   // more than one line
    ['X'.repeat(81)],
    [''], ['   '],
  ])('%j stays plain text', (text) => {
    expect(asTerminalCommand(text)).toBeNull()
  })

  it('never answers for a value that is not text', () => {
    for (const v of [null, undefined, 42, {}, []]) expect(asTerminalCommand(v)).toBeNull()
  })

  it('every command it returns is one the ONE parser accepts (or the shell\'s own B: address)', () => {
    for (const t of ['NVDA GRADE', 'GP SPY', 'N:42', 'BOARD GP NVDA AMD']) {
      const cmd = asTerminalCommand(t)
      expect(parseCommand(cmd).ok, cmd).toBe(true)
    }
  })
})

describe('terminalCommandHref / commandOfHref: the URL a note stores', () => {
  it('round-trips a command through the shell\'s ?cmd= door', () => {
    for (const c of ['NVDA GRADE', 'B:semis-daily', 'N:42', 'BRK.B GP']) {
      const href = terminalCommandHref(c)
      expect(href.startsWith(`${TERMINAL_PATH}?cmd=`)).toBe(true)
      expect(commandOfHref(href)).toBe(c)
    }
  })

  it('encodes, so a space or a colon cannot break the URL', () => {
    expect(terminalCommandHref('NVDA GRADE')).toBe('/terminal?cmd=NVDA%20GRADE')
    expect(terminalCommandHref('B:x')).toBe('/terminal?cmd=B%3Ax')
  })

  it('answers null for every other href', () => {
    for (const h of ['/journal/notebook?note=1', 'https://example.com/terminal?cmd=X', '/terminal',
      '/terminal?cmd=', '/terminalx?cmd=NVDA', null, 7]) {
      expect(commandOfHref(h)).toBeNull()
    }
  })
})
