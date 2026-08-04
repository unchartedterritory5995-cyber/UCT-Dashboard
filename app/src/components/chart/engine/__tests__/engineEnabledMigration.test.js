import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { stripComments } from './sourceScan'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from '../../chartDefaults'
import { ENGINE_FLIPPED_DEF_IDS, ENGINE_MIGRATED_DEF_IDS, engineDrawnInputs } from '../flipState'
import { setIndicatorEnabled, setIndicatorInput, isIndicatorEnabled } from '../instanceControls'
import { uctDefaultChartSettings } from '../../../../pages/charts/ChartsWorkspace'
import * as engineRegistry from '../nativeRegistry'

// ─── ENGINE_ENABLED — THE FLAG THAT DECIDED NOTHING, DELETED ────────────────
//
// ⭐ THIS FILE USED TO ASSERT THE FLAG'S BEHAVIOUR. It now asserts that the flag
// DOES NOT EXIST, and it keeps the old rule in place as the thing that must no
// longer hold — which is the only spelling that can tell "resolved" apart from
// "the assertions were deleted".
//
// **What was true, and why the obvious fix was a trap.** `mergeChartSettings`
// computed `engineEnabled: parsed.engineEnabled === true` — a read of the STORED
// BLOB, never of `CHART_DEFAULTS`. So an absent key and an explicit `false` were
// the SAME ANSWER, every `chart_settings` row in production predated the engine,
// and **flipping the default could not heal one of them.** The record priced that
// (§1, §2) and refused the flip.
//
// **What the flag still decided, and why deletion answers it.** Exactly one
// thing: it distinguished a MIGRATED-but-UN-FLIPPED definition from a FLIPPED
// one. That category exists only *inside* a migration, for the length of one
// phase, and no user has an opinion about it. B5 migrates and flips in the same
// commit for all ten remaining natives (adjudication A1), so the category is
// never created — and a flag whose only job is to describe a state that cannot
// occur is not a preference, it is a leftover. Record §7, §8.2, §11.1.
//
// **Deleted, not defaulted-true.** A default flip is a no-op for every existing
// user (§1). Deletion is not: `mergeChartSettings` is a hard allow-list, so the
// key stops being emitted at all, and a stored `engineEnabled` — `true`, `false`
// or `"1"` — is destroyed on the next read like any other unknown key.
//
// Records:
//   `docs/decisions/2026-08-03-engine-enabled-settings-migration.md` (RESOLVED here)
//   `docs/decisions/2026-08-04-engine-enabled-deleted.md`            (what deletion means)
// Spec row: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11

const DECISION_ID = 'ENGINE_ENABLED_MIGRATION'
/** ⛔ A DELIMITED TOKEN, NOT A SUBSTRING — and this is not hypothetical caution.
 *  The first draft used `toContain(DECISION_ID)` and a mutation renaming the §11
 *  row to `ENGINE_ENABLED_MIGRATION_DRAFT` **SURVIVED THE WHOLE SUITE**: the
 *  longer id contains the shorter one, so an architect greps for the decision,
 *  finds nothing, and the gate says the row is there. `\b` cannot fall between
 *  `N` and `_` (both are word characters), so the boundary form refuses it. */
const ID_TOKEN = new RegExp(`\\b${DECISION_ID}\\b`)

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`engineEnabled: could not find the repo root from ${process.cwd()}`)
})()
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8')

const RECORD_OPEN = 'docs/decisions/2026-08-03-engine-enabled-settings-migration.md'
const RECORD_DELETED = 'docs/decisions/2026-08-04-engine-enabled-deleted.md'
const SPEC = 'docs/superpowers/specs/2026-07-31-indicator-platform-design.md'

/**
 * Every SHIPPED module under `app/src` whose comment-stripped source matches
 * `re`, as `file:line` strings.
 *
 * ⛔ COMMENT-STRIPPED, AND IT IS THE WHOLE POINT OF THE PROBE. Every retirement
 * on this branch leaves a comment naming what it deleted — this one leaves five —
 * and B4 measured a mount rail that a mutation defeated by COMMENTING THE CALL
 * OUT. A raw `/engineEnabled/` over `app/src` reads this task's own tombstones as
 * the flag and stays green forever, which is exactly the state M8 demonstrated on
 * the rail in `enumerationSites.test.js`. `sourceScan.stripComments` is the one
 * stripper; its own controls live beside it, and this file adds two more below.
 */
function scanAppSrc(re) {
  const hits = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(p); continue }
      if (!/\.jsx?$/.test(entry.name)) continue
      if (entry.name.includes('.test.') || p.includes(`${path.sep}__tests__${path.sep}`)) continue
      const rel = path.relative(ROOT, p).split(path.sep).join('/')
      stripComments(fs.readFileSync(p, 'utf8')).split('\n').forEach((line, i) => {
        if (re.test(line)) hits.push(`${rel}:${i + 1}`)
      })
    }
  }
  walk(path.join(ROOT, 'app', 'src'))
  return hits.sort()
}

/**
 * Every WHOLE-BLOB payload door seven can stamp over a user's settings.
 *
 * ⚠️ THE PAYLOADS, NOT THE SITES. `controlDoorCensus.test.js` owns the site count
 * (three modules: `Settings.jsx`, `ChartToolbar.jsx`, `ChartSettingsModal.jsx`);
 * this is what those sites actually WRITE, because a user's blob receives a
 * payload and not a file path. Six of them, from four shapes:
 *
 *   · `PRESETS.<k>.settings`            ×4 — the theme buttons, twice over
 *   · `CHART_DEFAULTS`                       — `resetToDefaults` + both Reset buttons
 *   · `JSON.parse(JSON.stringify(CHART_DEFAULTS))` — `ChartSettingsModal`'s Reset
 *
 * ⛔ THE CLONE IS IN THE LIST FOR A REASON AND IT IS A TRAP, NOT A FORMALITY.
 * `JSON.stringify` DROPS an `undefined` value, so a half-deletion that left
 * `engineEnabled: undefined` on `CHART_DEFAULTS` would be INVISIBLE through the
 * clone and visible on every other payload. Keeping both in one list is what
 * makes the difference legible; `hasOwnProperty` below is what makes it fail.
 */
function doorSevenPayloads() {
  return [
    ...Object.entries(PRESETS).map(([k, p]) => [`PRESETS.${k}.settings`, p.settings]),
    ['CHART_DEFAULTS', CHART_DEFAULTS],
    ['ChartSettingsModal reset clone', JSON.parse(JSON.stringify(CHART_DEFAULTS))],
  ]
}

describe('engineEnabled is DELETED — the flag that decides nothing stops existing', () => {
  it('a July blob merges with NO engineEnabled key at all — the flag does not exist', () => {
    // ⭐ The blob is a STRING, deliberately. A fixture built as an object skips
    // the exact step being migrated (record §6 R3) — `JSON.parse` is what a real
    // `user_preferences.chart_settings` row goes through, and it is the step at
    // which an absent key stops being distinguishable from an explicit one.
    const july = JSON.parse('{"indicators":{"rsi":{"enabled":true,"period":14}},"overlays":[]}')
    const cs = mergeChartSettings(july)
    expect('engineEnabled' in cs).toBe(false)
    // …and the thing that used to be true is now impossible, not merely false.
    expect(Object.keys(CHART_DEFAULTS)).not.toContain('engineEnabled')
    // The RSI the user had on is still on, and still drawn by the engine.
    expect(cs.indicators.rsi.enabled).toBe(true)
    expect(isIndicatorEnabled(cs, 'rsi', ENGINE_FLIPPED_DEF_IDS)).toBe(true)
  })

  // ⭐ THE OLD RULE, KEPT AS THE THING THAT MUST NO LONGER HOLD.
  //
  // This replaces *"⛔ FLIPPING THE DEFAULT DOES NOT HEAL A STORED BLOB — the read
  // is of the blob"*, the assertion the record's §1 and §9 both name. That test
  // proved a default flip was a no-op; the reason it was a no-op was that the read
  // came from the blob. There is no read and no default, so the no-op is not
  // merely still true — **there is nothing left to flip and nothing left to heal.**
  it('⛔ THE OLD RULE IS NOW IMPOSSIBLE, NOT MERELY FALSE — there is no flag to flip', () => {
    expect(Object.prototype.hasOwnProperty.call(CHART_DEFAULTS, 'engineEnabled'),
      'CHART_DEFAULTS still declares the key — a default flip is back on the table, and §1 ' +
      'proves it would heal nobody').toBe(false)
    const merged = {
      absent: mergeChartSettings(JSON.parse('{"chartType":"candles"}')),
      explicitFalse: mergeChartSettings(JSON.parse('{"engineEnabled":false}')),
      stringOne: mergeChartSettings(JSON.parse('{"engineEnabled":"1"}')),
      explicitTrue: mergeChartSettings(JSON.parse('{"engineEnabled":true}')),
    }
    // All four rows of the record's §1 table collapse to ONE answer: no key.
    expect(Object.fromEntries(
      Object.entries(merged).map(([k, cs]) => [k, 'engineEnabled' in cs]),
    ), 'the allow-list re-emitted a key it no longer knows about').toEqual({
      absent: false, explicitFalse: false, stringOne: false, explicitTrue: false,
    })
  })

  it('an explicitly stored engineEnabled:false is DROPPED, not honoured', () => {
    // The old read was `parsed.engineEnabled === true`, so this blob merged to
    // false and a default flip could not heal it. There is nothing left to heal:
    // the allow-list destroys unknown keys and this is now an unknown key.
    const cs = mergeChartSettings(JSON.parse('{"engineEnabled":false,"indicators":{"rsi":{"enabled":true}}}'))
    expect('engineEnabled' in cs).toBe(false)
    // The RSI the user had on is still on, and still engine-drawn.
    expect(isIndicatorEnabled(cs, 'rsi', ENGINE_FLIPPED_DEF_IDS)).toBe(true)
  })

  it('the toolbar shows the DRAWN inputs on every chart now, not the legacy mirror', () => {
    // Record §4.2: `engineDrawnInputs` returned EMPTY flag-off, so `ChartToolbar`
    // fell back to `cs.indicators`. EVERY existing user was on that path — the
    // flag was false in every stored blob — so the divergence the fallback exists
    // to paper over was the shipped state, not the edge case. It is gone.
    const cs = setIndicatorEnabled(mergeChartSettings(null), 'rsi', true, engineRegistry)
    const withPeriod = setIndicatorInput(cs, 'rsi', 'period', 7, engineRegistry)
    expect(engineDrawnInputs(withPeriod, engineRegistry).get('rsi').period).toBe(7)
    // …and it is unconditional: a blob that explicitly said `false` gets the same
    // answer, which is the half a `?? true` default could never have delivered.
    const said = { ...withPeriod, engineEnabled: false }
    expect(engineDrawnInputs(said, engineRegistry).get('rsi').period).toBe(7)
  })

  it('the three door-seven writers no longer stamp a key that does not exist', () => {
    // Presets and `resetToDefaults` spread `CHART_DEFAULTS`; the census pins the
    // sites. This asserts the PAYLOAD, which is what a user's blob receives.
    for (const [name, payload] of doorSevenPayloads()) {
      expect(Object.prototype.hasOwnProperty.call(payload, 'engineEnabled'),
        `${name} still stamps engineEnabled over the user's blob`).toBe(false)
    }
    // Non-vacuity: the census really found six payloads behind three sites.
    expect(doorSevenPayloads()).toHaveLength(6)
    // …and the loop is not passing over a list of empty objects.
    expect(doorSevenPayloads().every(([, p]) => Object.keys(p).length > 10)).toBe(true)
    // The frozen UCT-Default capture is a FOURTH shape — a JSON string, so the
    // key can only be absent, never `undefined`. Asserted through the parse.
    expect('engineEnabled' in JSON.parse(uctDefaultChartSettings())).toBe(false)
  })

  it('ChartRender no longer writes the flag, and nothing in app/src does', () => {
    const hits = scanAppSrc(/engineEnabled/)      // comment-stripped, per sourceScan.js
    expect(hits,
      'a shipped module still names `engineEnabled` in CODE. The key does not exist: ' +
      '`mergeChartSettings` never emits it, `CHART_DEFAULTS` never declares it, and a read ' +
      'of it is a read of `undefined` that will silently take the OFF branch forever.',
    ).toEqual([])
  })

  // ⛔ THE PROBE'S OWN CONTROLS, BOTH DIRECTIONS, ON A FIXTURE — because the
  // assertion above EXPECTS an empty list, which makes a broken scan and a clean
  // tree indistinguishable. B4 measured a source probe defeated by a comment; this
  // task leaves five comments naming the deleted flag, so the stripper is not a
  // nicety here, it is the difference between a rail and a decoration.
  it('control: the scan finds the flag in CODE and refuses it in a COMMENT', () => {
    const FOUND = []
    const strip = (s) => stripComments(s)
    const probe = (src) => strip(src).split('\n').some(l => /engineEnabled/.test(l))
    expect(probe('const on = cs.engineEnabled === true'),
      'the scan cannot see the flag in live code — it rotted').toBe(true)
    expect(probe('// engineEnabled: parsed.engineEnabled === true — DELETED at B5 Task 4'),
      'a COMMENTED tombstone reads as a live flag. Every retirement on this branch leaves one, ' +
      'so a raw probe would report this task as incomplete forever — or, mutated the other way, ' +
      'report a resurrected flag as absent').toBe(false)
    expect(probe('/* engineEnabled lived here */'),
      'block comments are not stripped').toBe(false)
    // …and the walk really visits files: the scan finds something when asked for
    // something that is definitely there.
    expect(scanAppSrc(/mergeChartSettings/).length,
      'the walk found no file at all — an empty result above is a broken walk, not a clean tree',
    ).toBeGreaterThan(3)
    expect(FOUND).toEqual([])
  })
})

// ─── A STORED JULY BLOB, ON CUTOVER DAY, MEASURED ───────────────────────────
//
// The plan's §A2 table, RE-MEASURED rather than copied. Every row is driven from
// a JSON STRING through the real `mergeChartSettings`, exactly as
// `flipBStoredBlobs.test.jsx` drives its twenty-five — because a fixture built as
// an OBJECT skips the parse, and the parse is the step at which "the key is
// absent" and "the key is explicitly false" became the same answer (record §6 R3).
//
// **The user does nothing.** No reset, no re-tick, no re-login. What this asserts
// is that the blob they already have, read by the code as it now stands, still
// produces the chart they already had.
const JULY_BLOB = JSON.stringify({
  chartType: 'candles',
  preset: 'custom',
  indicators: {
    rsi: { enabled: true, period: 9, color: '#ff00aa' },
    bb: { enabled: true, period: 34, stdDev: 3, color: 'rgba(1,2,3,0.5)' },
    macd: { enabled: true, fastPeriod: 8, slowPeriod: 21, signalPeriod: 5, macdColor: '#111111', signalColor: '#222222' },
    vwap: { enabled: true, color: '#abcdef', opacity: 40, lineStyle: 'dashed', lineWidth: 3 },
    stoch: { enabled: true, kPeriod: 21, dPeriod: 5, kColor: '#333333', dColor: '#444444' },
    atr: { enabled: true, period: 21, color: '#555555' },
    // ⭐ ADDED AT B5 TASK 6, WHICH FLIPPED THESE TWO. Without them the "every
    // FLIPPED indicator the blob had on is engine-drawn" case below could only be
    // satisfied by weakening its expectation to whatever the fixture happened to
    // carry — a comparison that can never fail. A July user could have had SAR
    // and Ichimoku on, with their own colours, and this is that user.
    sar: { enabled: true, step: 0.03, maxStep: 0.3, color: '#888888' },
    ichimoku: {
      enabled: true,
      tenkanColor: '#991111', kijunColor: '#992222', spanAColor: '#993333',
      spanBColor: '#994444', chikouColor: '#995555',
    },
    // ⭐ ADDED AT B5 TASK 7, WHICH FLIPPED THESE THREE, for the same reason the
    // Task 6 pair above was added: the "every FLIPPED indicator the blob had on
    // is engine-drawn" case compares against the WHOLE flip set, so a fixture
    // that stops naming every flipped id could only be repaired by weakening
    // that expectation into one that can never fail.
    mfi: { enabled: true, period: 21, color: '#aa1111' },
    cci: { enabled: true, period: 34, color: '#aa2222' },
    williamsR: { enabled: true, period: 28, color: '#aa3333' },
    volumeProfile: { enabled: true, bins: 48, color: '#666666', pocColor: '#777777' },
  },
})

describe('a stored July blob on cutover day — every indicator still on, nothing resurrected', () => {
  it('carries no engine keys of its own, which is the whole premise', () => {
    const raw = JSON.parse(JULY_BLOB)
    expect('engineEnabled' in raw, 'the fixture is not a pre-engine blob').toBe(false)
    expect('indicatorInstances' in raw).toBe(false)
  })

  it('every indicator is still on, with the same period / colour / opacity / line style', () => {
    const cs = mergeChartSettings(JSON.parse(JULY_BLOB))
    const stored = JSON.parse(JULY_BLOB).indicators
    const moved = []
    for (const [id, section] of Object.entries(stored)) {
      for (const [k, v] of Object.entries(section)) {
        if (cs.indicators[id][k] !== v) moved.push(`${id}.${k}: ${JSON.stringify(cs.indicators[id][k])} ≠ ${JSON.stringify(v)}`)
      }
    }
    expect(moved,
      'a stored July value did not survive the merge. The user did nothing and their chart ' +
      'changed — which is the one outcome the deletion is not allowed to have.',
    ).toEqual([])
    // Named explicitly, because "the loop found nothing" and "the loop ran zero
    // times" read the same in a green suite.
    expect(Object.keys(stored)).toHaveLength(12)
    expect(cs.indicators.vwap.opacity).toBe(40)
    expect(cs.indicators.vwap.lineStyle).toBe('dashed')
    expect(cs.indicators.rsi.period).toBe(9)
    // B5 Task 6's two, named the same way: a float input and a colour the
    // merge could plausibly have dropped or defaulted.
    expect(cs.indicators.sar.step).toBe(0.03)
    expect(cs.indicators.ichimoku.chikouColor).toBe('#995555')
    // B5 Task 7's three — a non-default period on each, because a period is the
    // one input the merge has a second copy of (the definition's declared
    // default) and therefore the one it could silently win.
    expect(cs.indicators.mfi.period).toBe(21)
    expect(cs.indicators.cci.period).toBe(34)
    expect(cs.indicators.williamsR.period).toBe(28)
  })

  it('no key is resurrected — the merged blob names the flag nowhere', () => {
    const cs = mergeChartSettings(JSON.parse(JULY_BLOB))
    expect('engineEnabled' in cs).toBe(false)
    expect(JSON.stringify(cs)).not.toContain('engineEnabled')
    // `indicatorInstances` DOES arrive — it is a live key the allow-list still
    // emits, and it arrives EMPTY, which is what the read-time migrator needs.
    expect(cs.indicatorInstances).toEqual([])
  })

  it('every FLIPPED indicator the blob had on is engine-drawn, from the mirror alone', () => {
    const cs = mergeChartSettings(JSON.parse(JULY_BLOB))
    const on = [...ENGINE_FLIPPED_DEF_IDS]
      .filter(id => isIndicatorEnabled(cs, id, ENGINE_FLIPPED_DEF_IDS)).sort()
    expect(on, 'a flipped indicator the July user had ON is no longer reported on')
      .toEqual([...ENGINE_FLIPPED_DEF_IDS].sort())
    expect(on.length).toBeGreaterThan(0)
  })

  it('…and the MIRROR still carries every stored value, flipped or not', () => {
    // 🔴 THIS TITLE READ *"the un-migrated ten are untouched, drawn by their
    // legacy blocks"* AND STAYED GREEN WHILE FALSE: `stoch` and `atr` were
    // migrated at B5 Task 5, so two of its three subjects were engine-drawn while
    // the sentence said they were not. The assertions themselves were always
    // about the MIRROR — `cs.indicators.<id>` — which is exactly the thing that
    // must survive a flip untouched, so the claim is restated rather than moved.
    const cs = mergeChartSettings(JSON.parse(JULY_BLOB))
    expect(cs.indicators.stoch.enabled).toBe(true)
    expect(cs.indicators.stoch.kPeriod).toBe(21)
    expect(cs.indicators.atr.enabled).toBe(true)
    // `volumeProfile` is the genuinely un-migrated one — a canvas overlay with no
    // definition at all, which is why it can never be flipped.
    expect(cs.indicators.volumeProfile.enabled).toBe(true)
    expect(cs.indicators.volumeProfile.bins).toBe(48)
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
// blob built from `CHART_DEFAULTS` — so they stamp whatever the default declares
// over whatever the user had. That is the same hazard class as `ChartsWorkspace`'s
// frozen capture, which was a Flip-B ship-blocker until `uctDefaultChartSettings()`
// was made to stamp the engine keys from the default.
//
// 🔴 THIS NOTE USED TO NAME THE SITES — *"`applyPreset` (ChartToolbar.jsx, and
// again in Settings.jsx) and `resetToDefaults` (Settings.jsx)"* — AND IT WAS
// INCOMPLETE, measured at B4 Task 12 by the first scan anyone ran for whole-blob
// writers. It missed `ChartToolbar`'s OWN Reset button and, more importantly,
// `ChartSettingsModal.jsx`'s (`JSON.parse(JSON.stringify(CHART_DEFAULTS))`) — the
// workspace's centred settings modal, which no test named. The site list is
// ASSERTED in `controlDoorCensus.test.js` ("⛔ and B4 added no EIGHTH bulk writer
// — the whole-blob sites are the measured three") rather than restated here,
// because a list in a comment beside a test that does not check it is a control
// that rots green — which is precisely what this one did.
//
// It is NOT an enumeration site — a preset names no indicator, so a sixteenth
// costs zero edits there and the discovery scan cannot see it. It IS a place the
// settings migration has to reach, because a preset click writes the default back
// over whatever the migration wrote.
describe('the seventh writer — every bulk chart_settings writer follows the default', () => {
  it('names the four presets, so a fifth cannot arrive unnoticed', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(['classic', 'light', 'oled', 'tradingview'])
  })

  it('every preset still inherits indicatorInstances BY IDENTITY, from CHART_DEFAULTS', () => {
    for (const [key, preset] of Object.entries(PRESETS)) {
      const s = preset.settings
      // ⭐ IDENTITY, NOT EQUALITY. A spread of `CHART_DEFAULTS` copies the array
      // REFERENCE; a hand-written `indicatorInstances: []` is deep-equal and a
      // different object. `toBe` is the only spelling that can tell them apart,
      // and telling them apart is the entire check.
      expect(s.indicatorInstances, `${key}.indicatorInstances`).toBe(CHART_DEFAULTS.indicatorInstances)
      // …and the engine flag is gone from BOTH sides, so `toBe` on it would be
      // `undefined === undefined` — a check that passes because it asks nothing.
      // Absence is asserted by SHAPE instead, above and below.
      expect(Object.prototype.hasOwnProperty.call(s, 'engineEnabled'), `${key}.engineEnabled`).toBe(false)
    }
  })

  // The boolean cannot be caught by identity, so it is caught by SHAPE: no
  // preset may declare an engine key of its own. Reading source is the only
  // instrument that can see the difference between "spread it" and "wrote the
  // same value down", and the difference is the whole point — one follows the
  // migration, the other silently un-migrates whoever clicks a theme button.
  it('⛔ no preset hand-writes an engine key — it must inherit or the migration leaks', () => {
    const src = read('app/src/components/chart/chartDefaults.js')
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

  // What a preset click DOES today, measured rather than assumed, because Task 9's
  // migration must not make it worse and cannot be designed without knowing it.
  it('applying a preset clears a live instance AND the legacy toggle', () => {
    const cs = mergeChartSettings(PRESETS.oled.settings)
    expect('engineEnabled' in cs).toBe(false)
    expect(cs.indicatorInstances).toEqual([])
    expect(cs.indicators.rsi.enabled).toBe(false)
    expect(cs.indicators.vwap.enabled).toBe(false)
  })
})

// ─── THE RECORD ─────────────────────────────────────────────────────────────
//
// The `MACD_HEAD_MASK` / `VWAP_SESSION_ANCHOR` precedent: the decision lives in
// `docs/decisions/`, gets a row in the spec's §11 adjudication log because that
// is what an architect reads first, and a test asserts BOTH still exist and still
// say what the branch believes they say. §11's VWAP row went stale for a whole
// task because nothing asserted it.
//
// ⭐⭐ AND THE STATUS MOVED HERE, IN THE COMMIT THAT DELETED THE FLAG — NOT LATER.
// `enumerationSites.test.js` → *"creates no migrated-but-un-flipped definition
// while the settings migration is open"* reads this record's `**Status:**` header
// and `mergeChartSettings`' source TOGETHER and asserts them as one object:
//
//     the header says OPEN  ⟺  `mergeChartSettings` still reads the flag
//
// so deleting the flag while the record still said OPEN is a RED test, and
// resolving the record while the flag still existed is the same red from the other
// side. Both directions are mutation-proven. That is why this task resolves the
// record it did not plan to: the biconditional does not admit a halfway state, and
// a task that deletes the flag has already answered the question.
describe('ENGINE_ENABLED_MIGRATION — the record, and the spec row', () => {
  it('the decision record exists and is now RESOLVED', () => {
    const md = read(RECORD_OPEN)
    expect(md).toMatch(ID_TOKEN)
    // The STATUS LINE, isolated — not `md.includes('RESOLVED')`, which a sentence
    // three paragraphs down would satisfy forever. `MACD_HEAD_MASK` and
    // `VWAP_SESSION_ANCHOR` both flipped OPEN → ACCEPTED in place, so this line is
    // the thing that moves.
    const statusLines = md.split('\n').filter(l => l.startsWith('**Status:**'))
    expect(statusLines, 'the record must carry exactly ONE **Status:** header line').toHaveLength(1)
    expect(statusLines[0]).toMatch(/\bRESOLVED\b/)
    expect(statusLines[0], 'the header still says OPEN while the flag is gone — the rail in ' +
      'enumerationSites.test.js is red for exactly this').not.toMatch(/\bOPEN\b/)
    // the two facts the resolution rests on have to be IN it, not implied by it
    expect(md).toContain('parsed.engineEnabled === true')
    expect(md).toContain('ENGINE_FLIPPED_DEF_IDS')
  })

  it('the deletion has its own record, APPLIED, naming what went at each site', () => {
    const md = read(RECORD_DELETED)
    expect(md).toMatch(/\bENGINE_ENABLED_DELETED\b/)
    const statusLines = md.split('\n').filter(l => l.startsWith('**Status:**'))
    expect(statusLines).toHaveLength(1)
    expect(statusLines[0]).toMatch(/\bAPPLIED\b/)
    // It has to say what deletion MEANS, not just that it happened — the six
    // sites, and the parity numbers with BOTH build identities.
    for (const site of ['chartDefaults.js', 'flipState.js', 'StockChart.jsx',
      'ChartRender.jsx', 'ChartsWorkspace.jsx', 'binder.js']) {
      expect(md, `the record does not say what happened at ${site}`).toContain(site)
    }
  })

  it('§11 carries the row, and names it as a B5 ship gate', () => {
    const spec = read(SPEC)
    expect(spec).toMatch(ID_TOKEN)
    // …and in the row's own spelling, which is the one an architect greps for.
    expect(spec).toContain(`\`${DECISION_ID}\``)
    expect(spec).toContain('2026-08-03-engine-enabled-settings-migration.md')
  })

  it('⛔ and the two sets are still EQUAL, which is what makes deletion safe', () => {
    // Record §4.1: the flag's only remaining job was to tell a MIGRATED-but-
    // UN-FLIPPED definition from a flipped one. Deleting it is only safe while
    // that category is empty, and this is the assertion that says so HERE, beside
    // the deletion, rather than leaving it to a rail three files away.
    expect([...ENGINE_FLIPPED_DEF_IDS].sort()).toEqual([...ENGINE_MIGRATED_DEF_IDS].sort())
    expect(ENGINE_FLIPPED_DEF_IDS.size).toBeGreaterThan(0)
  })
})
