// F-16 widened (owner 2026-11-10): the server's chip table (api/services/uct_agent/turn.py `_FLOW_CHIPS`, `_FLOW_CHIP_WORD`) is the
// same set of chips as the Options Flow widget's own rows (widgets/widgetControls.js `optionsflow`), so a chip added, renamed or
// dropped on one side and not the other fails here — the server never lets through a value the widget has no chip for, and never
// refuses one it has. Evidence: LOCAL, vitest (node), reads the real files.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ownControls } from '../widgets/widgetControls'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
// line endings normalised: a CRLF checkout (core.autocrlf=true) must read the same table (AUDIT #1029 mutation run: the
// table regex found nothing on a fresh CRLF worktree, so the whole file failed to load)
const PY = readFileSync(resolve(ROOT, 'api/services/uct_agent/turn.py'), 'utf8').replace(/\r\n/g, '\n')
const table = (() => {
  const body = /\n_FLOW_CHIPS = (\{[\s\S]*?\n\})\n/.exec(PY)[1]
  return JSON.parse(body.replace(/\s+/g, ' ').replace(/,\s*\}/g, '}'))
})()
const word = new RegExp(/\n_FLOW_CHIP_WORD = re\.compile\(r"(.*)"\)\n/.exec(PY)[1])
const rows = ownControls('optionsflow')

describe('the server\'s Options Flow chips are the widget\'s chips', () => {
  it('the same four controls', () => {
    expect(Object.keys(table).sort()).toEqual(rows.map(f => f.key).sort())
  })
  it('every chip, by stored value and by the word on it, maps to its stored value; nothing else is accepted', () => {
    for (const f of rows) {
      const want = {}
      for (const v of f.options) {
        want[String(v).toLowerCase()] = String(v)
        if (f.shown?.[v] != null) want[String(f.shown[v]).toLowerCase()] = String(v)
      }
      expect(table[f.key], f.key).toEqual(want)
    }
  })
  it('every chip word a member types (less All / Any) and every `also` word is one the server reads as a chip request', () => {
    for (const f of rows) {
      const words = [...Object.entries(f.shown || {}).filter(([v]) => v !== 'all' && v !== '0').map(([, w]) => w), ...Object.values(f.also || {}).flat()]
      for (const w of words) expect(word.test(` only ${w.toLowerCase()} on the options flow`), `${f.key}: ${w}`).toBe(true)
    }
    expect(word.test(' only balls on the options flow')).toBe(false)
  })
})
