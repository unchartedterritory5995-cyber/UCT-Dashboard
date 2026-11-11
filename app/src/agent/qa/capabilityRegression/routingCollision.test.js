// CAPABILITY REGRESSION · ROUTING COLLISIONS (capreg-2): a table of everyday owner phrasings, each owned by ONE routing
// group (baseline/routingCollisions.json). Asserted for every row: (1) the owner group's OWN words select it, and (2) no
// other group's words select it (except the row's `also`) — so one group's trigger words never steal another group's
// language (CG-12 "tell me about …" → alerts; CG-13 "… against …" → charts). A known collision is a gap that must fail
// as recorded (testing/corpus.js gapIt).
import { describe, expect } from 'vitest'
import { registerCatalog } from './testing/registry'
import { gapIt } from './testing/corpus'
import { GROUPS, wordsSelect } from '../../routing'
import table from './baseline/routingCollisions.json'
import { pinClock } from './testing/clock'

pinClock()                   // one fixed instant (testing/clock.js): the market clock never depends on when CI runs

await registerCatalog()
const ids = GROUPS.map(g => g.id)

describe('routing collisions — a group\'s words never steal another group\'s everyday phrasing', () => {
  for (const row of table.rows) {
    const { run, tag } = gapIt(row.gap)
    run(`"${row.text}" belongs to ${row.owner}${tag}`, () => {
      expect(ids, `unknown group ${row.owner}`).toContain(row.owner)
      for (const g of ids) {
        if (g === row.owner || (row.also || []).includes(g)) continue
        expect(wordsSelect(g, row.text), `"${row.text}" stolen by ${g}`).toBe(false)
      }
      expect(wordsSelect(row.owner, row.text), `"${row.text}" not named by its owner ${row.owner}`).toBe(true)
    })
  }
})
