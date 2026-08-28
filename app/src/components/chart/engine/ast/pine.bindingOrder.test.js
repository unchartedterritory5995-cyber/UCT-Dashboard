import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { TABLE } from './parse.js'

/**
 * EVERY NAME THE ENGINE KNOWS, BOUND BY A SCRIPT, MUST MEAN WHAT THE SCRIPT SAID.
 *
 * ⚰️⚰️⚰️ THIS FILE EXISTS BECAUSE THE SAME DEFECT WAS FIXED FOUR TIMES, EACH TIME
 * AT ITS OWN CALL SITE AND NEVER AT THE RULE:
 *
 *   `ownSymbolNameOf`   `tickerid = 'SPY'` read as THIS chart's symbol.
 *   `ownTimeframeOf`    `period = "60"` read as this chart's timeframe, so a
 *                       script asking for hourly bars was answered off daily ones.
 *   `resolveName`       the manifest's 111 SCALARS beat the member's own binding,
 *                       so `nr7 = <a narrow-range test>` scanned our screener
 *                       column instead of their arithmetic — on the green roster.
 *   `resolveCall`       a user-defined `security(a, b, c) =>` lost to the built-in
 *                       carve-out for one call shape and won for another: one name,
 *                       two meanings, in one script.
 *
 * Three of the four were found in a single week. Each fix carried a comment
 * stating the rule — "the binding is consulted FIRST and the order is the whole
 * guard" — and the next site was written, or left, ignoring it.
 *
 * ⭐⭐ AND THIS FILE FOUND A FIFTH ON ITS FIRST RUN: `nz`. A member writing
 * `nz(a, b) => a + b` got the ENGINE'S `nz` for every call, because its carve-out
 * sits before the general user-function check exactly as `security`'s did. Two
 * carve-outs, the same omission, written at different times by people who had
 * each read the rule. The fix routed both through one `shadowedByDefinition`
 * so there is no third place to forget it — which is the actual lesson, and is
 * why this rail is derived rather than a list of the ones we knew about.
 *
 * ⭐ SO THIS RAIL IS DERIVED FROM THE MANIFEST RATHER THAN FROM A LIST OF THE FOUR
 * WE KNOW ABOUT. Every series, scalar and clock name the table declares is bound
 * by a generated script and the translation is checked. A name added to the
 * manifest tomorrow is covered the day it lands, which is the only way this stops
 * needing a fifth discovery.
 *
 * ⛔ WHAT IT DOES NOT CLAIM: it exercises the NAME-RESOLUTION path only. A door
 * that reads an argument's spelling somewhere else entirely — the way
 * `securityAsNode` reads its second argument — is not reachable from here, and
 * `pine.security.test.js` and `pine.tfternary.test.js` carry those controls.
 */
describe('a bound name beats the engine vocabulary, for every name', () => {
  const head = '//@version=4\nstudy("t")\n'

  /** Pine identifiers only: no dots, no leading digit, not a Pine keyword. */
  const RESERVED = new Set([
    'if', 'else', 'for', 'while', 'var', 'varip', 'true', 'false', 'na', 'and',
    'or', 'not', 'to', 'by', 'break', 'continue', 'export', 'import', 'method',
    'type', 'switch', 'series', 'simple', 'const', 'input', 'int', 'float',
    'bool', 'string', 'color', 'line', 'label', 'box', 'table', 'array', 'plot',
    'study', 'indicator', 'strategy', 'close', 'open', 'high', 'low', 'volume',
    'time', 'hl2', 'hlc3', 'ohlc4', 'hlcc4',
  ])

  const usable = (name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name)

  const namesIn = (section) => Object.keys(TABLE[section] || {}).filter(usable)

  // ⛔ DERIVED FROM THE MANIFEST. A hand-list here would be the very thing the
  // four fixes above kept re-learning: a roster that stops matching the code.
  const LEAF_NAMES = [...namesIn('scalars'), ...namesIn('clock')].sort()

  it('⛔ the manifest really does declare names to test — not vacuous', () => {
    // Without this, a renamed section would make every case below iterate over
    // nothing and pass forever.
    expect(LEAF_NAMES.length).toBeGreaterThan(50)
  })

  it('⭐⭐ a bound LEAF name resolves to the binding, for every declared name', () => {
    // `nr7 = close > open` then a read of `nr7` must be the member's comparison,
    // never our screener column of the same name.
    const stolen = []
    for (const name of LEAF_NAMES) {
      const out = translatePine(`${head}${name} = close > open\nplot(${name} ? 1 : 0)\n`)
      const row = out.refusal === null && out.outputs.find((o) => o.refusal === null)
      if (!row) { stolen.push(`${name}: refused ${out.refusal && out.refusal.guard}`); continue }
      if (row.formula !== 'close > open ? 1 : 0') stolen.push(`${name}: ${row.formula}`)
    }
    expect(stolen, 'these names were read as the ENGINE\'S rather than the script\'s')
      .toEqual([])
  })

  it('⭐ …and the same name UNBOUND still reads as ours — a scoping, not a deletion', () => {
    // ⛔ THE CONTROL THAT STOPS THE RULE ABOVE FROM BEING SATISFIED BY BREAKING
    // THE VOCABULARY. Reading a declared scalar by name is a deliberate feature;
    // only a name the member BOUND may take it from them. At least one declared
    // leaf must still resolve to itself.
    const survived = LEAF_NAMES.filter((name) => {
      const out = translatePine(`${head}plot(${name} > 0 ? 1 : 0)\n`)
      const row = out.refusal === null && out.outputs.find((o) => o.refusal === null)
      return row && row.formula === `${name} > 0 ? 1 : 0`
    })
    expect(survived.length,
      'no declared leaf resolves to the engine any more — the fix went too far')
      .toBeGreaterThan(10)
  })

  it('⭐⭐ a user FUNCTION shadows a declared function of the same name', () => {
    // The `resolveCall` half of the same rule. `security` is the one that shipped
    // wrong, but the property belongs to every declared function name.
    // ⛔ NO SLICE. An earlier draft of this line read `.slice(0, 40)` over 62
    // declared functions — a silent cap in a rail whose whole job is coverage,
    // which is the shape this file was written to catch.
    const stolen = []
    const fnNames = namesIn('functions')
    expect(fnNames.length, 'no declared functions to test').toBeGreaterThan(30)
    for (const name of fnNames) {
      const out = translatePine(
        `${head}${name}(a, b) => a + b\nplot(${name}(close, high))\n`)
      const row = out.refusal === null && out.outputs.find((o) => o.refusal === null)
      // Either their definition is used, or the door refuses BY NAME — what it
      // must never do is quietly evaluate OUR function of that name.
      if (row && row.formula !== 'close + high') stolen.push(`${name}: ${row.formula}`)
    }
    expect(stolen, 'these calls ran the ENGINE\'S function over a script that defined its own')
      .toEqual([])
  })

  it('⛔ and the built-in `security` carve-out is covered by the same rule', () => {
    // Pinned separately because it is not a manifest name and so cannot be
    // derived above — it is a door-local carve-out, and it is what made this the
    // FOURTH instance rather than the third.
    const out = translatePine(
      `${head}security(a, b, c) => a + b + c\nplot(security(syminfo.tickerid, 'W', close))\n`)
    expect(out.refusal, 'the built-in carve-out is winning over a user definition')
      .toBeTruthy()
  })
})
