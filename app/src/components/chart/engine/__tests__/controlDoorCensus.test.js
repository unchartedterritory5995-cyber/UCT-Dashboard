import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { stripComments } from './sourceScan'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from '../../chartDefaults'
import { setIndicatorEnabled, setIndicatorInput, isIndicatorEnabled } from '../instanceControls'
import * as theWriter from '../instanceControls'
import { applyRowPatch } from '../../indicatorRegistry'
import { ENGINE_OWNED } from '../flipState'
import * as engineRegistry from '../nativeRegistry'
import { migrateLegacyToInstances } from '../instances'

// ═══════════════════════════════════════════════════════════════════════════
// ─── THE CONTROL-DOOR CENSUS ────────────────────────────────────────────────
//
// ⭐ THE EIGHTH DOOR IS WRITTEN NOW — AND IT HAS NO CALLER.
//
// Seven ways to change an indicator's enable state were found on this branch,
// ONE AT A TIME, and every one of the first six was found because a bug had
// already shipped through it:
//
//   1. the toolbar's per-indicator row          (B3; RETIRED at B4 Task 8)
//   2. the right-click **Indicators ▸** submenu (B3 Flip B)
//   3. the right-click **Hide <label>** item    (B3 Flip B)
//   4. the `Ctrl+I` / `Ctrl+O` / `Ctrl+B` family (B3 Task 11)
//   5. `Alt+U` — the chord `matchShortcut` can never deliver (B3 Task 11)
//   6. the settings tab's row                   (B3; GENERATED at B4 Task 6)
//   7. `applyPreset` ×2 + `resetToDefaults`     (B4, and of a DIFFERENT KIND)
//   8. the per-INSTANCE door                   (chart-UX Task 1; ZERO call sites)
//
// Door 7 is the one that matters most here, because no ledger walk opened it and
// no discovery scan can: it writes a WHOLE `chart_settings` blob spread from
// `CHART_DEFAULTS`, so it stamps `engineEnabled` and `indicatorInstances` over
// whatever the user had — and **a preset names no indicator**, so the "four or
// more hand-listed ids" scan in `enumerationSites.test.js` is structurally blind
// to it. It was found by reasoning about the settings migration, not by grepping.
//
// ⭐ B4 ADDED FOUR WRITE PATHS AND NO EIGHTH DOOR — and this file is what keeps
// that true. The library dialog (Task 7), the generated settings rows (Task 6),
// the unified chord dispatch (Task 4) and the voice-bus subscriber (Task 11) all
// route at `instanceControls`. So does the right-click **Add indicator…** row
// added at Task 12, which opens the dialog and writes nothing itself. They are
// USES of one writer, not new writers.
//
// ⛔ WHAT THIS FILE IS NOT. It is not a behavioural test of any door — each has
// one of its own (`stockChartWiring.test.jsx` for the menus and the chords,
// `ChartToolbar.indicatorLibrary.test.jsx` and `IndicatorLibraryDialog.test.jsx`
// for the dialog, `generatedSettingsRows.test.jsx` for the rows,
// `chartBus.test.jsx` for the voice bus, `engineEnabledMigration.test.js` for the
// presets). It is the CENSUS: how many doors there are, where they are, and that
// nothing has quietly opened another.

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`control-door census: could not find the repo root from ${process.cwd()}`)
})()

/** Every shipped module under `app/src`, comment-stripped.
 *
 *  ⚠️ COMMENT-STRIPPED IS LOAD-BEARING IN BOTH DIRECTIONS HERE, and both were
 *  measured on this branch. Four files carry `setIndicatorEnabled` in PROSE
 *  (`useChartIndicatorBus.js`, `keyboardShortcuts.js`, `indicatorRegistry.js`,
 *  `IndicatorLibraryDialog.jsx`) explaining what routes where — a raw scan reads
 *  those explanations as doors. And a mutation that COMMENTS A CALL OUT survived
 *  Wave B's mount rail for exactly the opposite reason. `sourceScan.js` is the
 *  one stripper; it carries its own controls in `enumerationSites.test.js`. */
const SHIPPED = (() => {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(p); continue }
      if (!/\.jsx?$/.test(entry.name)) continue
      if (entry.name.includes('.test.') || p.includes(`${path.sep}__tests__${path.sep}`)) continue
      out.push({
        file: path.relative(ROOT, p).split(path.sep).join('/'),
        src: stripComments(fs.readFileSync(p, 'utf8')),
      })
    }
  }
  walk(path.join(ROOT, 'app', 'src'))
  return out
})()

/** The module that OWNS the write path. Excluded from every scan below by name,
 *  because it is the thing the scans are measuring distance from. */
const THE_WRITER = 'app/src/components/chart/engine/instanceControls.js'

const filesMatching = (re) => SHIPPED
  .filter(f => f.file !== THE_WRITER && re.test(f.src))
  .map(f => f.file)
  .sort()

// ─── WHO CALLS THE WRITER ───────────────────────────────────────────────────
//
// Four entries, three of which write. `ChartToolbar` is here BECAUSE it does
// not: Task 8 replaced its fifteen indicator rows with one launcher that COUNTS
// what is on (`catalogRows().filter(isOn).length`) and opens a dialog. A toolbar
// that starts writing again is a regression this table names.
const CALL_SITES = [
  {
    file: 'app/src/components/StockChart.jsx',
    writes: true,
    door: 'the right-click Indicators ▸ / Hide rows (doors 2+3) and the four chords (doors 4+5)',
  },
  {
    file: 'app/src/components/chart/indicatorRegistry.js',
    writes: true,
    door: 'applyRowPatch — the generated settings rows (door 6) and the voice bus, which imports it',
  },
  {
    file: 'app/src/components/chart/IndicatorLibraryDialog.jsx',
    writes: true,
    door: 'the library dialog — reached from the toolbar button, Alt+Shift+A and right-click Add indicator…',
  },
  {
    file: 'app/src/components/chart/ChartToolbar.jsx',
    writes: false,
    door: 'the Manage-indicators launcher COUNTS what is on and opens the dialog; it does not write',
  },
]

// ─── WHO WRITES THE MIRROR RAW ──────────────────────────────────────────────
//
// ⚠️ CODE SHAPES, NOT BARE NAMES. `instanceControls.js`'s own header EXPLAINS
// which raw writes were removed and why, and half the chart module tree carries
// comments naming `cs.indicators.<id>.enabled`. B3 hit that trap from both
// directions; the stripper closes it and these shapes are what is left.
//
// ⚠️ NAMED EXCEPTIONS, WITH REASONS, so an eighth joins the list by ARGUMENT
// rather than by edit. Every one below was MEASURED, not predicted.
//
// ⚠️ NOT `/g`, AND THAT IS A BUG THIS FILE ALREADY HIT. A global regex reused
// across `.test()` calls carries `lastIndex` between them, and `matchAll` seeds
// its clone FROM that index — so the non-vacuity probe at the bottom read zero
// matches for a pattern that had just matched four files. These are stateless
// and every use below is a boolean.
const RAW_WRITE_SHAPES = [
  ['A a `indicators: { … enabled:` object literal', /["']?indicators["']?\s*:\s*\{[\s\S]{0,400}?["']?enabled["']?\s*:/],
  ['B a dotted settings path ending `.enabled`', /indicators\.[^'"`\s)]*\.enabled/],
  ['C a computed `indicators[…] =` assignment', /indicators\s*\[[^\]]+\]\s*=/],
]

// ✅ B5 TASK 12 REMOVED ONE, AND THE LIST'S OWN STALE-CHECK IS WHAT REMOVED IT.
// `engine/paneMarginsProjection.js` was excused here as *"a READ-TIME projection:
// it rewrites a THROWAWAY cs FROM the instance list so `computePaneMargins` sees
// the engine's answer"*. Flip C deleted both modules — `computePaneLayout` reads
// the instance list directly, so there is no second blob to project and no raw
// write to excuse — and the stale-exception assertion below went RED by name the
// moment the file stopped existing. That is the mechanism working: an exemption
// for a write that no longer exists is what excuses the next one.
const RAW_WRITE_EXCEPTIONS = [
  ['app/src/components/chart/chartDefaults.js',
    'it IS the blob — the fifteen keyed sections and the merge allow-list'],
  ['app/src/components/chart/IndicatorLibraryDialog.jsx',
    '`volumeProfile` ONLY — a carved-out canvas overlay with NO definition, for which ' +
    '`setIndicatorEnabled` returns its input by identity and the toggle would silently ' +
    'do nothing. Every other row in that dialog goes through the writer'],
  ['app/src/components/StockChart.jsx',
    'the UN-FLIPPED lane of `setIndEnabled` — one `setCs(`indicators.${key}.enabled`)` ' +
    'inside the ONE menu writer, taken only when the id is not in ENGINE_OWNED ' +
    '(which includes `volumeProfile`, which has no definition at all). A flipped id ' +
    'leaves before it; that branch is what `stockChartWiring` drives for both'],
  ['app/src/pages/charts/ChartsWorkspace.jsx',
    'the frozen UCT-Default capture — a JSON STRING of all fifteen sections, fated B5. ' +
    'It is a default, not a control: no user action reaches it'],
]

describe('the control-door census — how many doors, and whether an eighth exists', () => {
  it('every setIndicatorEnabled / setIndicatorInput call site is a KNOWN door', () => {
    const callers = filesMatching(/\bsetIndicator(?:Enabled|Input)\s*\(/)
    const known = CALL_SITES.filter(s => s.writes).map(s => s.file).sort()

    expect(callers,
      'a shipped module calls the indicator writer and is not on the census. Either it is a ' +
      'NEW control door — add it here WITH ITS REASON, and check whether it also needs a ' +
      'behavioural gate of its own — or it is a use of an existing door reached through a ' +
      'module that should not be importing the writer directly.',
    ).toEqual(known)

    // ⛔ AND THE LAUNCHER IS NOT ONE. Task 8 deleted the toolbar's fifteen rows;
    // what is left counts and opens. This is asserted, not assumed, because the
    // toolbar is the single most likely place for a per-indicator control to come
    // back — it had fifteen.
    const toolbar = CALL_SITES.find(s => s.file.endsWith('ChartToolbar.jsx'))
    expect(toolbar.writes, 'the census table itself claims the toolbar writes').toBe(false)
    expect(callers, toolbar.door).not.toContain(toolbar.file)
    const toolbarSrc = SHIPPED.find(f => f.file === toolbar.file).src
    expect(toolbarSrc, 'the launcher stopped counting — it is a different surface now')
      .toContain('catalogRows().filter((r) => isOn(r.id)).length')

    // ⛔ NON-VACUITY, AND IT IS NOT THE `callers` LIST. Three known files matching
    // proves the regex works only if the regex could have found a fourth; the
    // stronger control is that it still matches inside the file it EXCLUDES.
    expect(callers.length, 'the census found no caller at all — a scan that finds nothing is ' +
      'a broken scan, not a tree with no doors').toBe(3)
    const writerSrc = SHIPPED.find(f => f.file === THE_WRITER)
    expect(writerSrc, 'the writer module is not in the walk — the scan cannot see its own subject')
      .toBeTruthy()
    expect(/\bsetIndicator(?:Enabled|Input)\s*\(/.test(writerSrc.src),
      'the call-site pattern matches nothing even in the module that DEFINES the writer — ' +
      'it rotted, and the list above is a broken regex rather than a census').toBe(true)
  })

  it('no shipped module outside instanceControls writes cs.indicators.<id>.enabled', () => {
    const excused = new Set(RAW_WRITE_EXCEPTIONS.map(([f]) => f))
    const offenders = []
    for (const { file, src } of SHIPPED) {
      if (file === THE_WRITER || excused.has(file)) continue
      for (const [what, re] of RAW_WRITE_SHAPES) {
        if (re.test(src)) offenders.push(`${file} :: ${what}`)
      }
    }
    expect(offenders,
      'a shipped module writes an indicator\'s enable state without going through ' +
      '`instanceControls`. For a FLIPPED id that field is the MIRROR, not the switch: the ' +
      'write ticks a box over a chart that disagrees, and no tombstone means the read-time ' +
      'migrator puts the indicator straight back on the next paint. That is doors 2, 3, 4 and ' +
      '5, each of which shipped as a real bug. If the write is legitimate, add it to ' +
      'RAW_WRITE_EXCEPTIONS **with the argument**, not just the path.',
    ).toEqual([])

    // ⛔ THE EXCEPTION LIST MUST NOT ROT EITHER. An excused file that stops
    // writing should leave the list — otherwise the list is a permanent hole
    // nobody re-reads, which is how a named exception becomes a silent one.
    const stale = RAW_WRITE_EXCEPTIONS
      .filter(([f]) => {
        const entry = SHIPPED.find(s => s.file === f)
        return !entry || !RAW_WRITE_SHAPES.some(([, re]) => re.test(entry.src))
      })
      .map(([f]) => f)
    expect(stale,
      'a named exception no longer writes the mirror raw (or the file moved). Drop it from ' +
      'the list — an exemption for a write that no longer exists excuses the next one.',
    ).toEqual([])
    expect(RAW_WRITE_EXCEPTIONS.every(([, why]) => typeof why === 'string' && why.length > 40),
      'an exception was added without an argument').toBe(true)

    // ⛔ AND EVERY SHAPE STILL MATCHES SOMETHING. Zero offenders is the EXPECTED
    // answer, which makes a broken regex indistinguishable from a clean tree —
    // so each pattern is run against the shape it is supposed to find, including
    // the quoted-key spelling the frozen JSON capture wears.
    const PROBE = 'x = { indicators: { rsi: { enabled: true } } }; ' +
      'const y = "{\\"indicators\\":{\\"rsi\\":{\\"enabled\\":false}}}"; ' +
      'setCs(`indicators.${key}.enabled`, on); indicators[id] = { enabled: true }'
    for (const [what, re] of RAW_WRITE_SHAPES) {
      expect(re.test(PROBE), `${what} matches nothing at all — it rotted`).toBe(true)
    }
  })

  // ─── DOOR SEVEN ───────────────────────────────────────────────────────────
  //
  // ⚠️ THE NARROW HALF LIVES IN `engineEnabledMigration.test.js` AND STAYS THERE
  // — that file asks "does a preset click un-migrate the user", which is the
  // settings-migration question. THIS file asks the census question the other one
  // does not: **how many bulk writers are there, and did B4 add one.** The
  // identity check below is deliberately WIDER than that file's: it covers the
  // reset target as well as the four presets, because `resetToDefaults` writes
  // `CHART_DEFAULTS` itself and a hand-written `indicatorInstances: []` there
  // would be just as invisible.
  it('the seventh writer is still spread from CHART_DEFAULTS, by object identity', () => {
    const bulkPayloads = [
      ...Object.entries(PRESETS).map(([k, p]) => [`PRESETS.${k}.settings`, p.settings]),
      // `resetToDefaults` (Settings.jsx) and the toolbar's Reset button both write
      // this object itself.
      ['CHART_DEFAULTS', CHART_DEFAULTS],
    ]
    expect(bulkPayloads.length, 'no bulk payload to check — vacuous').toBeGreaterThan(4)
    for (const [name, s] of bulkPayloads) {
      // ⭐ IDENTITY, NOT EQUALITY. A spread of `CHART_DEFAULTS` copies the array
      // REFERENCE; a hand-written `indicatorInstances: []` is deep-equal and a
      // different object, and `toEqual` cannot tell them apart. Telling them apart
      // IS the check: a literal pins the pre-migration value for everyone who
      // clicks a theme button.
      expect(s.indicatorInstances, `${name}.indicatorInstances is not CHART_DEFAULTS'`)
        .toBe(CHART_DEFAULTS.indicatorInstances)
      expect(s.engineEnabled, `${name}.engineEnabled drifted from the default`)
        .toBe(CHART_DEFAULTS.engineEnabled)
    }
  })

  // 🔴 A CENSUS FINDING, AND THE REASON A CENSUS IS WORTH RUNNING: **DOOR SEVEN
  // HAS THREE SITES, NOT TWO.** `engineEnabledMigration.test.js` recorded it as
  // *"`applyPreset` (ChartToolbar.jsx, and again in Settings.jsx) and
  // `resetToDefaults` (Settings.jsx)"* — and this scan, run for the first time,
  // named a THIRD: `ChartSettingsModal.jsx`'s own reset button
  // (`onChange?.(JSON.parse(JSON.stringify(CHART_DEFAULTS)))`), the workspace's
  // centred settings modal. Nobody had counted it, no test named it, and the
  // discovery scan is structurally blind to it because a reset names no
  // indicator. Its behaviour is CORRECT — a deep clone of the LIVE default
  // follows the default the way a spread does, which is the property door seven
  // is held to — but "correct and uncounted" is how door seven itself got missed
  // for a whole phase.
  //
  // ⚠️ AND IT IS WHY IDENTITY CANNOT BE THE TEST HERE. `JSON.parse(JSON.stringify
  // (CHART_DEFAULTS))` produces a NEW `indicatorInstances` array by construction,
  // so the `toBe` above would fail on it if it were in the list — which is
  // exactly why that assertion is scoped to the PAYLOADS (the presets and
  // `CHART_DEFAULTS` itself) and this one to the SITES.
  it('⛔ and B4 added no EIGHTH bulk writer — the whole-blob sites are the measured three', () => {
    // A bulk writer is a module that hands a WHOLE settings object to the
    // persistence path: a preset's `settings`, or `CHART_DEFAULTS` itself, by
    // spread or by clone. Neither names an indicator, so `enumerationSites`'
    // discovery scan cannot see either — this is the only place they are counted.
    const bulk = filesMatching(/PRESETS\s*\[|CHART_DEFAULTS\s*\)\s*\)?/)
    expect(bulk,
      'a module writes a whole chart_settings blob and is not one of the three known preset / ' +
      'reset surfaces. A bulk write stamps `engineEnabled` and `indicatorInstances` over ' +
      'whatever the user had; it is door SEVEN, and no ledger walk or discovery scan can see ' +
      'it — the third site below was found by this scan and by nothing else.',
    ).toEqual([
      'app/src/components/chart/ChartSettingsModal.jsx',
      'app/src/components/chart/ChartToolbar.jsx',
      'app/src/pages/Settings.jsx',
    ])
    // …and the third one really is a reset of the live default, not a frozen
    // literal — the property that makes it harmless is asserted, not assumed.
    const modal = SHIPPED.find(s => s.file === 'app/src/components/chart/ChartSettingsModal.jsx')
    expect(modal.src,
      'the modal\'s reset stopped cloning the LIVE default. A frozen capture there pins the ' +
      'pre-migration value for everyone who clicks Reset — the `ChartsWorkspace` hazard, one ' +
      'surface over.').toContain('JSON.parse(JSON.stringify(CHART_DEFAULTS))')
  })

  // ─── THE MIRROR, ON ALL FOUR B4 SURFACES ──────────────────────────────────
  //
  // ⛔ WHY THIS IS THE ASSERTION AND NOT "the instance moved" — AND THE REASON
  // CHANGED AT B5 TASK 8 RATHER THAN EXPIRING WITH IT.
  //
  // It USED to be: ten of the fourteen definitions are still drawn by a
  // hand-written legacy block gating on `cs.indicators[id].enabled`, so a door
  // that wrote only the INSTANCE would work on the four pilots every earlier
  // suite exercises and do NOTHING on the other ten. **That population is gone**
  // — all fourteen are flipped and there is no legacy block left to read the
  // mirror — so the un-flipped filter this guard stood on iterated ZERO times
  // and the guard could only fail.
  //
  // ⭐ THE MIRROR IS STILL LOAD-BEARING, FOR A DIFFERENT AND MORE DURABLE
  // READER, and that is what this case moves down to. `indicators.<id>` is the
  // shape a chart is SHARED and RESTORED in: `handleCopyShareUrl` writes exactly
  // that map, a preset / reset stamps a whole blob over `indicatorInstances`,
  // and `migrateLegacyToInstances` PROJECTS the instance list back out of it on
  // read. So a door that wrote only the instance produces a chart that is
  // correct right up until the blob makes a round trip without its instances —
  // and then the indicator is simply gone. That is DRIVEN below, per definition,
  // rather than asserted about a population that no longer exists.
  it('the four B4 surfaces all move the MIRROR as well as the instance', () => {
    const defs = engineRegistry.listDefinitions()
    expect(defs.length, 'no definitions — the loop below proves nothing').toBeGreaterThan(10)

    for (const def of defs) {
      const base = mergeChartSettings(null)

      // ── the writer three of the four surfaces call directly ──
      const on = setIndicatorEnabled(base, def.id, true, engineRegistry)
      expect(on.indicators[def.id].enabled, `${def.id}: setIndicatorEnabled left the MIRROR off`).toBe(true)
      expect((on.indicatorInstances || []).some(i => i && i.defId === def.id && !i.deleted),
        `${def.id}: setIndicatorEnabled wrote no instance`).toBe(true)

      const off = setIndicatorEnabled(on, def.id, false, engineRegistry)
      expect(off.indicators[def.id].enabled, `${def.id}: turning it off left the MIRROR on`).toBe(false)

      // ── and the one the settings rows + the voice bus go through ──
      const viaRow = applyRowPatch({ engineOwned: true, defId: def.id }, { enabled: true }, base, engineRegistry)
      expect(viaRow.indicators[def.id].enabled, `${def.id}: applyRowPatch left the MIRROR off`).toBe(true)
      expect(isIndicatorEnabled(viaRow, def.id, ENGINE_OWNED), def.id).toBe(true)

      // ⭐ AND THE MIRROR REALLY IS WHAT SURVIVES A ROUND TRIP. Drop
      // `indicatorInstances` — which is what a share link, a preset and a reset
      // all do — and the read-time migrator has to rebuild the instance from the
      // mirror alone. An instance-only write fails HERE, by name, for every
      // definition, and it does so without needing an un-flipped one to exist.
      const roundTripped = migrateLegacyToInstances({ ...on, indicatorInstances: [] }, engineRegistry)
      expect(roundTripped.some(i => i && i.defId === def.id && !i.deleted),
        `${def.id}: the mirror did not survive a blob round trip — a share link or a `
        + 'preset would drop this indicator entirely').toBe(true)
      // …and the control that the projection is not simply putting everything
      // back: the OFF blob projects nothing for it.
      expect(migrateLegacyToInstances({ ...off, indicatorInstances: [] }, engineRegistry)
        .some(i => i && i.defId === def.id), `${def.id}: an OFF mirror still projected`).toBe(false)

      // ── an INPUT write mirrors too, or the legacy block draws the old period ──
      const input = def.inputs.find(i => i.type === 'int' || i.type === 'float')
      if (input) {
        const bumped = setIndicatorInput(on, def.id, input.key, defaultFor(input), engineRegistry)
        expect(bumped.indicators[def.id][input.key],
          `${def.id}.${input.key}: setIndicatorInput left the MIRROR at the old value`)
          .toBe(defaultFor(input))
      }
    }
  })

  it('…and each of the four surfaces really does route at one of those two', () => {
    // The behavioural proof above is about the WRITERS. This is the routing: each
    // B4 surface reaches one of them, in shipped source, with its comments gone.
    const ROUTES = [
      ['app/src/components/chart/IndicatorLibraryDialog.jsx', /\bsetIndicatorEnabled\s*\(/, 'the library dialog (Task 7)'],
      ['app/src/components/chart/indicatorRegistry.js', /\bsetIndicatorEnabled\s*\(/, 'the generated settings rows (Task 6)'],
      ['app/src/components/StockChart.jsx', /\bsetIndicatorEnabled\s*\(/, 'the unified chord dispatch (Task 4)'],
      ['app/src/hooks/useChartIndicatorBus.js', /\bapplyRowPatch\s*\(/, 'the voice-bus subscriber (Task 11)'],
    ]
    const broken = ROUTES
      .filter(([f, re]) => {
        const entry = SHIPPED.find(s => s.file === f)
        return !entry || !re.test(entry.src)
      })
      .map(([f, , what]) => `${what} — ${f}`)
    expect(broken,
      'a B4 surface stopped routing at the shared writer. Whatever it does instead is door ' +
      'eight, and the raw-write scan above will only catch it if it wrote the mirror by hand.',
    ).toEqual([])
    // ⛔ AND THE VOICE BUS DOES NOT REACH THE WRITER DIRECTLY — it imports the
    // routing rule rather than re-implementing it, which is the whole reason
    // `volumeProfile` does not silently no-op through it.
    const bus = SHIPPED.find(s => s.file === 'app/src/hooks/useChartIndicatorBus.js')
    expect(/\bsetIndicator(?:Enabled|Input)\s*\(/.test(bus.src),
      'the voice bus calls the writer itself — a second copy of the engine-owned / carved-out ' +
      'routing rule is the twin this phase retires').toBe(false)
  })

  // ─── DOOR EIGHT ────────────────────────────────────────────────────────
  //
  // ⭐ THE PER-INSTANCE DOOR IS SHIPPED, AND AS OF TASK 4 IT HAS EXACTLY TWO
  //    CALLERS — `IndicatorSettingsDialog` (spec §6's per-instance settings form,
  //    Task 5) and `StockChart` (the LEGEND CHIP's own controls, Task 4).
  //
  // `setInstanceHidden` / `setInstanceInput` / `removeInstance` / `addInstance`
  // live in the SAME module as the seven above, but they are a DOOR and not a use
  // of one: every earlier door addresses a `defId` and takes
  // `legacyInstanceId(defId)` as its target, so it can only ever mean "the one
  // instance the v1→v2 fold seeded". These address ONE `instanceId` — which is
  // what the stored list, the binder and the readout have always been keyed by.
  //
  // ⛔ THE ZERO WAS AN ASSERTION, NOT AN ASSUMPTION — and this is the update it
  // asked for, not its deletion. Its own failure message said: "UPDATE this
  // census with the surface and its reason, do not delete the case." The list is
  // now a DECLARED TABLE compared by equality, so the next surface to address an
  // instance reddens here and has to say why, exactly as this one did. What the
  // zero bought is spent: while it held, the model change was a provable no-op;
  // the dialog is the surface that makes "RSI(7) settings" mean something
  // different from "RSI(14) settings", which is what the door was built for.
  //
  // 🔴 `StockChart.jsx` USED TO BE DELIBERATELY ABSENT FROM THIS LEDGER, AND THE
  // PARAGRAPH SAYING SO IS INVERTED RATHER THAN DELETED. It read: *"It mounts the
  // dialog and resolves a `defId` to an instance id through `findInstance` — a
  // READER — and writes nothing per instance itself. A door name appearing there
  // would mean a second writer had grown beside the one the dialog routes at."*
  //
  // ⭐ A DOOR NAME DOES APPEAR THERE NOW, AND IT IS NOT A SECOND WRITER — IT IS A
  // SECOND SURFACE ON THE SAME ONE. chart-UX-walls Task 4 gives every legend chip
  // its own eye / gear / × and a right-click menu, and those are the FIRST
  // controls in the product that address a chip: a chip is per INSTANCE (the
  // readout has been keyed by `instanceId` since before this phase), so hiding
  // "the RSI you right-clicked" is only expressible through this door. Every one
  // of them calls `instanceControls` — `setInstanceHidden`, `removeInstance`,
  // `withInstances` — through ONE local `writeInstance` guard, and none of them
  // touches `cs.indicatorInstances` by hand; the raw-write scan above is what
  // would catch it if one did.
  //
  // ⚠️ THE `settingsInstanceId` MOUNT IS STILL NOT A DOOR. The chip's gear sets
  // that state and the DIALOG does the writing, exactly as the right-click
  // `<label> settings…` row already did — which is why this file's ledger names
  // the two files that CALL the door and not the three surfaces that open them.
  it('⭐ door EIGHT — the per-INSTANCE door has exactly the callers this census names', () => {
    // ⚠️ CHECKED AGAINST THE MODULE, not merely typed here. A renamed door would
    // otherwise narrow the scan to a name nothing has, and its result would mean
    // nothing at all.
    const DOORS = ['setInstanceHidden', 'setInstanceInput', 'removeInstance', 'addInstance']
    expect(DOORS.filter(n => typeof theWriter[n] !== 'function'),
      'a per-instance door was renamed or removed — the caller scan below would then be ' +
      'looking for a name nothing has, and its result would prove nothing').toEqual([])

    // The ledger: file → why it addresses ONE instance.
    const LEDGER = [
      ['app/src/components/chart/IndicatorSettingsDialog.jsx',
       'spec §6 settings form, per instance (Task 5): setInstanceInput on the generated ' +
       'input rows, setInstanceHidden on the Visibility tab eye'],
      ['app/src/components/StockChart.jsx',
       'spec §6 legend chip controls (chart-UX-walls Task 4): the chip\'s eye is ' +
       'setInstanceHidden, its × is removeInstance, and its ContextPopover "Move to" is ' +
       'withInstances. A chip IS an instance — the readout has been keyed by instanceId ' +
       'since before this phase — so "hide the RSI you right-clicked" cannot be said ' +
       'through any of doors 1-7, every one of which takes legacyInstanceId(defId) and ' +
       'therefore always means the first copy'],
    ]

    const perInstance = new RegExp('\\b(' + DOORS.join('|') + ')\\s*\\(')
    const callers = SHIPPED
      .filter(f => f.file !== THE_WRITER && perInstance.test(f.src))
      .map(f => f.file)
      .sort()
    expect(callers,
      'the per-instance door\'s caller set moved — UPDATE this census with the surface and ' +
      'its reason, do not delete the case. A caller is a surface that addresses ONE ' +
      'instanceId, which is what makes "two RSIs" reachable; an unledgered one is a second ' +
      'answer to "which copy did the user mean".',
    ).toEqual(LEDGER.map(([f]) => f).sort())

    // ⛔ THE POSITIVE CONTROL. A pattern that matches nothing anywhere satisfies an
    // empty expectation just as well, so it is run against the one module it
    // EXCLUDES — the same shape the call-site census above uses. It stays even now
    // that the expectation is non-empty: it is what proves the equality above is a
    // census and not a coincidence.
    const writerSrc = SHIPPED.find(f => f.file === THE_WRITER)
    expect(writerSrc, 'the writer module is not in the walk — the scan cannot see its own subject')
      .toBeTruthy()
    expect(perInstance.test(writerSrc.src),
      'the per-instance pattern matches nothing even in the module that DEFINES the doors — ' +
      'it rotted, and the caller list above is a broken regex rather than a census')
      .toBe(true)

    // ⛔ AND EVERY LEDGERED FILE IS IN THE WALK. A ledger naming a path the scan
    // never visits would be satisfied by a file that does not exist — the equality
    // above would then be comparing two lists neither of which came from source.
    expect(LEDGER.filter(([f]) => !SHIPPED.some(s => s.file === f)).map(([f]) => f),
      'a ledgered caller is not in the walked file set — the equality above is comparing ' +
      'a typed name against a scan that cannot see it').toEqual([])
  })
})

/** A legal, DIFFERENT value for a numeric input — used to prove the mirror moved
 *  rather than that it happened to already hold the value being written. */
function defaultFor(input) {
  const min = Number.isFinite(input.min) ? input.min : 1
  const max = Number.isFinite(input.max) ? input.max : 100
  const step = input.type === 'int' ? 1 : 0.1
  const candidate = Number.isFinite(input.default) ? input.default + step : min + step
  const clamped = Math.min(Math.max(candidate, min), max)
  return input.type === 'int' ? Math.round(clamped) : Math.round(clamped * 10) / 10
}
