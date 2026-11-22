// app/src/components/chart/builder/authoring/scriptAccepts.test.js
//
// ONLY A WINDOW THAT CAN SHOW A SCRIPT ASKS FOR ONE.
//
// ⚰️ Found live 2026-11-19, while the script lane was admin-only. Three windows send their turns
// through `converseClient`: the Create Indicator dock, the builder's own "Describe it" / Ask box
// (`ConverseBox`) and the UCT Agent door (`agentAuthoring`). The client told the door that EVERY
// one of them accepts a script answer. Only the dock checked a script with its engine and showed it,
// so an admin in the builder read "This draws a zigzag ..." about a script that was nowhere on
// the screen.
//
// The builder's box has since learned to show one (`ConverseBox.script.test.jsx`): where it can open
// the script in the script editor it asks, and everywhere else it does not.
//
// Held here, by reading the sources (a sender added later is caught without anyone remembering):
//   * every file that sends a turn is NAMED below, as one that shows a script or one that does not;
//   * the word is sent only by a sender that says `showsScripts: true`, and the only files that say
//     so are the ones named as showing one;
//   * each of those really does check a script answer with the engine and draw a script entry.
// The wire itself (`converseBody`) is held in `scriptAnswer.test.js`; the server's half (a script
// goes only to a browser that accepts one) in `tests/test_script_conversation.py`.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const BUILDER = path.resolve(process.cwd(), 'src/components/chart/builder')
const SRC = path.resolve(process.cwd(), 'src')
const read = (rel) => fs.readFileSync(path.join(BUILDER, rel), 'utf8')
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1')

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('__')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) sourceFiles(full, out)
    else if (/\.(js|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(full)
  }
  return out
}
const rel = (full) => path.relative(BUILDER, full).split(path.sep).join('/')

/** Every sender of a turn, and whether its window shows a script answer. */
const SENDERS = Object.freeze({
  'studio/useIndicatorConversation.js': true,      // the dock: `modelTurn` checks it, the panel shows it
  'ConverseBox.jsx': true,                         // the builder's own box: `settleScript` checks it, the box shows it
  'studio/CreateIndicatorPanel.jsx': false,        // hands `converseTurn` to the hook as its default; sends nothing itself
  'agentAuthoring.js': false,                      // the UCT Agent door: no script entry
})
const FLAG = ['shows', 'Scripts'].join('')          // (built here so this file is not a match for its own search)

describe('only a window that can show a script asks for one', () => {
  const all = sourceFiles(SRC)

  it('every file that sends a turn is named here', () => {
    const senders = all.filter((f) => /\bconverseTurn\b/.test(code(fs.readFileSync(f, 'utf8'))))
      .map(rel).filter((r) => r !== 'authoring/converseClient.js' && r !== 'authoring/authoringSession.js')
    expect(senders.sort()).toEqual(Object.keys(SENDERS).sort())
    // CONTROL: the search can see a sender (the client's own definition is one, and was filtered out)
    expect(/\bconverseTurn\b/.test(code(read('authoring/converseClient.js')))).toBe(true)
  })

  it('the only files that say their window shows scripts are the ones named as showing one', () => {
    const saying = all.filter((f) => code(fs.readFileSync(f, 'utf8')).includes(FLAG)).map(rel)
      .filter((r) => r !== 'authoring/converseClient.js')
    expect(saying.sort()).toEqual(Object.keys(SENDERS).filter((k) => SENDERS[k]).sort())
    for (const [file, shows] of Object.entries(SENDERS)) {
      expect(new RegExp(`${FLAG}:\\s*true`).test(code(read(file))), file).toBe(shows)
    }
  })

  it('the client sends the word for such a sender only', () => {
    const client = code(read('authoring/converseClient.js'))
    expect(client).toContain(`gateCtx.${FLAG} === true ? [ACCEPTS_SCRIPT] : []`)
    expect(/export const ACCEPTS = Object\.freeze\(\[([^\]]*)\]\)/.exec(client)[1]).not.toContain('script')
  })

  it('the dock: its turns are checked by the engine and its panel draws the script entry', () => {
    const hook = code(read('studio/useIndicatorConversation.js'))
    expect(hook).toMatch(/\bmodelTurn\(/)                                   // its turns go through the session
    const session = code(read('authoring/authoringSession.js'))
    // which checks a script answer with the engine (`scriptAnswer.checkScript`, called inside `modelTurn`)
    expect(session).toMatch(/import \{[^}]*\bcheckScript\b[^}]*\} from '\.\/scriptAnswer'/)
    expect(session.slice(session.indexOf('export async function modelTurn('))).toMatch(/\bdefaultCheckScript\b/)
    const panel = code(read('studio/CreateIndicatorPanel.jsx'))
    expect(panel).toContain('data-testid="create-indicator-script"')        // and whose panel draws the script entry
    expect(panel).toMatch(/\buseIndicatorConversation\(/)
  })

  it('the builder\'s box: the same check and repair loop, a script entry, and it asks only where it can open one', () => {
    const box = code(read('ConverseBox.jsx'))
    expect(box).toMatch(/import \{[^}]*\bsettleScript\b[^}]*\} from '\.\/authoring\/scriptAnswer'/)
    expect(box).toMatch(/\bsettleScript\(res,/)
    expect(box).toContain('data-testid="converse-script"')
    expect(box).toContain('data-testid="converse-open-script"')
    // the start view of a NEW indicator, with a host that handed it the opener; anywhere else, no word
    expect(box).toContain('const opensScripts = startWell && !editing && typeof onOpenScript === \'function\'')
    expect(box).toContain(`opensScripts ? { tf, symbol: sym, ${FLAG}: true } : { tf, symbol: sym }`)
    // and a script answer is treated as one only there
    expect(box).toContain('res.script && opensScripts')
  })

  it('the UCT Agent door draws no script entry (and so never says the word, above)', () => {
    expect(code(read('agentAuthoring.js'))).not.toMatch(/create-indicator-script|converse-script/)
  })
})
