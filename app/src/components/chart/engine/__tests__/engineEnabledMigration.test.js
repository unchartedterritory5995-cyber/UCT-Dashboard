import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from '../../chartDefaults'
import { ENGINE_FLIPPED_DEF_IDS, ENGINE_MIGRATED_DEF_IDS, engineDrawnInputs } from '../flipState'
import * as engineRegistry from '../nativeRegistry'

// ─── ENGINE_ENABLED_MIGRATION — THE FLAG NO EXISTING USER HAS ───────────────
//
// ⛔ THE ONE THING B3 SHIPS THAT NOBODY DECIDED. Every other flagged decision on
// this branch (`MACD_HEAD_MASK`, `VWAP_SESSION_ANCHOR`) was measured, written
// down, and answered by the owner. This one was DISCOVERED — by Task 10, as the
// reason its brief's two requirements could not both hold — and then carried
// forward by Tasks 10, 11 and 12 as a sentence in a report. A sentence in a
// report is not a gate, and this file is the gate.
//
// **The fact.** `mergeChartSettings` computes `engineEnabled: parsed
// .engineEnabled === true` (`chartDefaults.js:404`). That is a read of the
// STORED BLOB, and not of `CHART_DEFAULTS`. An absent key and an explicit
// `false` are therefore the SAME ANSWER, and **flipping the default cannot heal
// either one.** Every `chart_settings` row in production predates the engine, so
// on ship day `cs.engineEnabled` is `false` for every user alive.
//
// **Why nothing is broken today, precisely.** `StockChart` activates the engine
// when `ENGINE_FLIPPED_DEF_IDS` is non-empty, flag or no flag, because a FLIPPED
// definition has no hand-written block left — gating it on the flag would not
// make the engine dark, it would DELETE the indicator. All four pilots are
// flipped, so all four draw. The flag only narrows the instance list to flipped
// ids, and while `FLIPPED === MIGRATED` that narrowing removes nothing.
//
// **What the flag still decides, and why it is a migration and not a default
// flip.** Two things, both live:
//
//   1. `engineDrawnInputs` returns EMPTY on a flag-off chart, so `ChartToolbar`
//      shows the legacy MIRROR instead of what the engine is drawing with. The
//      writers keep the mirror in sync, so this is invisible until a writer that
//      does not (a grid `settingsOverride`) puts two numbers on one line.
//   2. **A MIGRATED-BUT-UN-FLIPPED definition still needs the flag** — and no
//      user has it. That category is empty today and is exactly what B4 creates
//      the first time it migrates a fifth definition without flipping it.
//
// ⚠️ THIS FILE ASSERTS THE STATE AS IT SHIPS. It is not a claim that the state
// is right. It is the thing that goes red the day somebody "fixes" it by
// flipping `CHART_DEFAULTS.engineEnabled` and believes existing users were
// healed — which is the specific wrong move the record exists to forbid.
//
// Record: `docs/decisions/2026-08-03-engine-enabled-settings-migration.md`
// Spec row: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11

const DECISION_ID = 'ENGINE_ENABLED_MIGRATION'
/** ⛔ A DELIMITED TOKEN, NOT A SUBSTRING — and this is not hypothetical caution.
 *  The first draft used `toContain(DECISION_ID)` and a mutation renaming the §11
 *  row to `ENGINE_ENABLED_MIGRATION_DRAFT` **SURVIVED THE WHOLE SUITE**: the
 *  longer id contains the shorter one, so an architect greps for the decision,
 *  finds nothing, and the gate says the row is there. `\b` cannot fall between
 *  `N` and `_` (both are word characters), so the boundary form refuses it. */
const ID_TOKEN = new RegExp(`\\b${DECISION_ID}\\b`)
const RECORD = join(process.cwd(), '..', 'docs', 'decisions',
  '2026-08-03-engine-enabled-settings-migration.md')
const SPEC = join(process.cwd(), '..', 'docs', 'superpowers', 'specs',
  '2026-07-31-indicator-platform-design.md')
const DEFAULTS_SRC = join(process.cwd(), 'src', 'components', 'chart', 'chartDefaults.js')

/** A real pre-engine `chart_settings` row: RSI on, no engine keys anywhere.
 *  Trimmed from the July capture `ChartsWorkspace` freezes — the keys that
 *  matter here are the ones that are ABSENT. */
const PRE_ENGINE_BLOB =
  '{"chartType":"candles","preset":"custom",' +
  '"indicators":{"rsi":{"enabled":true,"period":14,"color":"#7b68ee"}}}'

/** Run `fn` with `CHART_DEFAULTS.engineEnabled` flipped, then put it back.
 *  In place, never a module mock: the claim is about the REAL default, and a
 *  mocked one would make the assertion true of the mock. */
function withDefaultFlipped(value, fn) {
  const before = CHART_DEFAULTS.engineEnabled
  CHART_DEFAULTS.engineEnabled = value
  try { return fn() } finally { CHART_DEFAULTS.engineEnabled = before }
}

describe('ENGINE_ENABLED_MIGRATION — a stored blob on ship day', () => {
  it('a pre-engine blob merges to engineEnabled: false', () => {
    const cs = mergeChartSettings(JSON.parse(PRE_ENGINE_BLOB))
    expect(cs.engineEnabled).toBe(false)
    expect(cs.indicatorInstances).toEqual([])
    // …and the indicator the user turned on is still on, in the legacy section.
    expect(cs.indicators.rsi.enabled).toBe(true)
  })

  // ⭐ THE LOAD-BEARING ONE. If this ever reads `true`, the resolution the whole
  // of Flip B rests on has changed underneath it and the record is stale.
  it('⛔ FLIPPING THE DEFAULT DOES NOT HEAL A STORED BLOB — the read is of the blob', () => {
    const flipped = withDefaultFlipped(true, () => ({
      absent: mergeChartSettings(JSON.parse(PRE_ENGINE_BLOB)).engineEnabled,
      explicitFalse: mergeChartSettings({ engineEnabled: false }).engineEnabled,
      // a stray truthy value is not a yes either — `=== true`, deliberately
      stringOne: mergeChartSettings({ engineEnabled: '1' }).engineEnabled,
      explicitTrue: mergeChartSettings({ engineEnabled: true }).engineEnabled,
    }))
    expect(flipped).toEqual({
      absent: false, explicitFalse: false, stringOne: false, explicitTrue: true,
    })
    // and the flip really was in place while that ran
    expect(CHART_DEFAULTS.engineEnabled).toBe(false)
  })

  it('nothing is broken today BECAUSE something is flipped — that is the whole reason', () => {
    // `StockChart`'s `engineActive = engineOn || ENGINE_FLIPPED_DEF_IDS.size > 0`.
    // The right-hand side is what carries every existing user.
    expect(ENGINE_FLIPPED_DEF_IDS.size).toBeGreaterThan(0)
    // …and the narrowing the flag performs removes nothing while these are equal.
    expect([...ENGINE_FLIPPED_DEF_IDS].sort()).toEqual([...ENGINE_MIGRATED_DEF_IDS].sort())
  })

  // Task 12 carry #2, asserted AS IT SHIPS so that closing it is a deliberate red.
  it('a flag-off chart holding a live instance shows the toolbar NOTHING', () => {
    const stored = {
      engineEnabled: false,
      indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 7, color: '#ff0000' } }],
      indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } },
    }
    const cs = mergeChartSettings(stored)
    expect(cs.engineEnabled).toBe(false)
    expect(engineDrawnInputs(cs, engineRegistry).size).toBe(0)
    // THE CONTROL — the same blob with the flag on hands over the instance, so
    // the emptiness above is the FLAG's doing and not a broken walk.
    const on = mergeChartSettings({ ...stored, engineEnabled: true })
    expect(engineDrawnInputs(on, engineRegistry).get('rsi')).toMatchObject({ period: 7 })
  })
})

// ─── THE SEVENTH WRITER ─────────────────────────────────────────────────────
//
// Six CONTROL DOORS write one indicator's enable state, and B3 found them one at
// a time: the toolbar row, the two right-click items, the Ctrl family, Alt+U and
// the settings tab. They all route through `instanceControls` now.
//
// ⭐ THE PRESETS ARE A SEVENTH WRITER OF A DIFFERENT KIND, AND NO LEDGER WALK
// OPENED IT. `applyPreset` and the Reset buttons write a WHOLE `chart_settings`
// blob built from `CHART_DEFAULTS` — so they stamp `engineEnabled` and
// `indicatorInstances` over whatever the user had. That is the same hazard class
// as `ChartsWorkspace`'s frozen capture, which was a Flip-B ship-blocker until
// `uctDefaultChartSettings()` was made to stamp the keys from the default.
//
// 🔴 THIS NOTE USED TO NAME THE SITES — *"`applyPreset` (ChartToolbar.jsx, and
// again in Settings.jsx) and `resetToDefaults` (Settings.jsx)"* — AND IT WAS
// INCOMPLETE, measured at B4 Task 12 by the first scan anyone ran for whole-blob
// writers. It missed `ChartToolbar`'s OWN Reset button and, more importantly,
// `ChartSettingsModal.jsx`'s (`JSON.parse(JSON.stringify(CHART_DEFAULTS))`) — the
// workspace's centred settings modal, which no test named. The site list is now
// ASSERTED in `controlDoorCensus.test.js` ("the whole-blob sites are the measured
// three") rather than restated here, because a list in a comment beside a test
// that does not check it is a control that rots green — which is precisely what
// this one did.
//
// It is NOT an enumeration site — a preset names no indicator, so a sixteenth
// costs zero edits there and the discovery scan cannot see it. It IS a place the
// settings migration has to reach, because a preset click writes the default
// back over whatever the migration wrote.
describe('the seventh writer — every bulk chart_settings writer follows the default', () => {
  it('names the four presets, so a fifth cannot arrive unnoticed', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(['classic', 'light', 'oled', 'tradingview'])
  })

  it('every preset carries BOTH engine keys, taken from CHART_DEFAULTS', () => {
    for (const [key, preset] of Object.entries(PRESETS)) {
      const s = preset.settings
      expect(Object.prototype.hasOwnProperty.call(s, 'engineEnabled'), `${key}.engineEnabled`).toBe(true)
      expect(s.engineEnabled, `${key}.engineEnabled`).toBe(CHART_DEFAULTS.engineEnabled)
      // ⭐ IDENTITY, NOT EQUALITY. A spread of `CHART_DEFAULTS` copies the array
      // REFERENCE; a hand-written `indicatorInstances: []` is deep-equal and a
      // different object. `toBe` is the only spelling that can tell them apart,
      // and telling them apart is the entire check.
      expect(s.indicatorInstances, `${key}.indicatorInstances`).toBe(CHART_DEFAULTS.indicatorInstances)
    }
  })

  // The boolean cannot be caught by identity, so it is caught by SHAPE: no
  // preset may declare `engineEnabled` of its own. Reading source is the only
  // instrument that can see the difference between "spread it" and "wrote the
  // same value down", and the difference is the whole point — one follows the
  // migration, the other silently un-migrates whoever clicks a theme button.
  it('⛔ no preset hand-writes an engine key — it must inherit or the migration leaks', () => {
    const src = readFileSync(DEFAULTS_SRC, 'utf8')
    const start = src.indexOf('export const PRESETS = {')
    expect(start, 'PRESETS moved — this probe is stale, fix the anchor').toBeGreaterThan(-1)
    // ⚠️ BOUNDED TO THE OBJECT, and the bound is load-bearing: slicing to the end
    // of the file swallows `mergeChartSettings`, whose whole job is to name these
    // keys — the probe read the reader and reported the writer. Same shape as the
    // Task-12 retired-site check that matched its own explanatory comment.
    const end = src.indexOf('\nexport ', start + 1)
    expect(end, 'no export follows PRESETS — the bound is stale').toBeGreaterThan(start)
    const region = src.slice(start, end)
    for (const key of ['engineEnabled', 'indicatorInstances', 'settingsVersion']) {
      expect(region.includes(`${key}:`),
        `a preset hand-writes \`${key}\`. Presets spread CHART_DEFAULTS so the ` +
        `settings migration reaches them; a literal pins the pre-migration value ` +
        `for anyone who clicks a theme button.`).toBe(false)
    }
  })

  // What a preset click DOES today, measured rather than assumed, because the
  // migration must not make it worse and cannot be designed without knowing it.
  it('applying a preset clears a live instance AND the legacy toggle', () => {
    const cs = mergeChartSettings(PRESETS.oled.settings)
    expect(cs.engineEnabled).toBe(false)
    expect(cs.indicatorInstances).toEqual([])
    expect(cs.indicators.rsi.enabled).toBe(false)
    expect(cs.indicators.vwap.enabled).toBe(false)
  })
})

// ─── THE RECORD ─────────────────────────────────────────────────────────────
//
// The `MACD_HEAD_MASK` / `VWAP_SESSION_ANCHOR` precedent: the decision lives in
// `docs/decisions/`, gets a row in the spec's §11 adjudication log because that
// is what an architect reads first, and a test asserts BOTH still exist and
// still say what the branch believes they say. §11's VWAP row went stale for a
// whole task because nothing asserted it.
describe('ENGINE_ENABLED_MIGRATION — the record, and the spec row', () => {
  it('the decision record exists and is still OPEN', () => {
    expect(existsSync(RECORD), `missing decision record: ${RECORD}`).toBe(true)
    const md = readFileSync(RECORD, 'utf8')
    expect(md).toMatch(ID_TOKEN)
    // The STATUS LINE, isolated — not `md.includes('OPEN')`, which an "open
    // question" three paragraphs down would satisfy forever. `MACD_HEAD_MASK`
    // and `VWAP_SESSION_ANCHOR` both flipped OPEN → ACCEPTED in place, so this
    // line is the thing that moves.
    const status = md.split('\n').find(l => l.startsWith('**Status:**'))
    expect(status, 'no **Status:** line in the record').toBeTruthy()
    expect(status).toMatch(/\bOPEN\b/)
    // the two facts the resolution rests on have to be IN it, not implied by it
    expect(md).toContain('parsed.engineEnabled === true')
    expect(md).toContain('ENGINE_FLIPPED_DEF_IDS')
  })

  it('§11 carries the row, and names it as a B5 ship gate', () => {
    const spec = readFileSync(SPEC, 'utf8')
    expect(spec).toMatch(ID_TOKEN)
    // …and in the row's own spelling, which is the one an architect greps for.
    expect(spec).toContain(`\`${DECISION_ID}\``)
    expect(spec).toContain('2026-08-03-engine-enabled-settings-migration.md')
  })
})
