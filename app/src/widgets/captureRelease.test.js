/**
 * ⛔⛔ THE RELEASE NOTE, AS ASSERTIONS.
 *
 * This deploy tells members: "Nothing changes for members ... the new Notebook
 * capture tools in this release are switched off until a later update turns
 * them on." Wave R built four doors with NO gate at all, so that sentence was
 * false on the branch. This file is what keeps it true.
 *
 * ⭐ Two of the four doors (the ticker menu, the scanner header) are proved
 * BEHAVIOURALLY, by rendered DOM, in their own rails —
 * `TickerActions.sendNote.test.jsx` and `ScannerResults.journalDoor.test.jsx`,
 * each in both directions. This file owns the other two: the widgets, whose
 * "door" is menu membership.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  WAVE_R_CAPTURE_ON, CAPTURE_FLAG_KEY, UNRELEASED_CAPTURE_WIDGETS,
  captureEnabled, releasedTypes,
} from './captureRelease'
import {
  WIDGET_REGISTRY, menuGroups,
  WORKSPACE_MENU_TYPES, TAB_MENU_TYPES, MOBILE_MENU_TYPES, JOURNAL_MENU_TYPES,
  WORKSPACE_MENU_TYPES_ALL, TAB_MENU_TYPES_ALL,
} from './registry'

/** An injected store, so this rail never depends on the test environment. */
const store = (v) => ({ getItem: () => v })

describe('⛔ the switch itself', () => {
  it('⛔⛔ DEFAULTS OFF — pinning the literal, so it cannot be flipped unnoticed', () => {
    // Pinning the VALUE and not just the behaviour is deliberate: a flip is a
    // release decision that must show up as a diff on this line, not as a test
    // someone "fixed" to match.
    expect(WAVE_R_CAPTURE_ON).toBe(false)
    expect(captureEnabled(store(null))).toBe(false)
  })

  it('a browser can opt IN, and back out, without a deploy', () => {
    expect(captureEnabled(store('1'))).toBe(true)
    expect(captureEnabled(store('0'))).toBe(false)
    expect(CAPTURE_FLAG_KEY).toBe('uct.nb.capture.enabled')
  })

  it('survives a storage that throws (private mode) by falling back to the default', () => {
    const hostile = { getItem: () => { throw new Error('denied') } }
    expect(captureEnabled(hostile)).toBe(WAVE_R_CAPTURE_ON)
  })
})

describe('⛔ the two Wave R widgets are not offered anywhere', () => {
  it('⭐ NON-VACUITY: they really are registered — this rail is about a gate, not a typo', () => {
    expect(UNRELEASED_CAPTURE_WIDGETS.length).toBeGreaterThan(0)
    for (const id of UNRELEASED_CAPTURE_WIDGETS) {
      expect(WIDGET_REGISTRY[id], `${id} is not in the registry at all`).toBeTruthy()
    }
    // And they really are things the ungated registry would have offered —
    // otherwise the assertions below would pass over an empty difference.
    for (const id of UNRELEASED_CAPTURE_WIDGETS) {
      expect(WORKSPACE_MENU_TYPES_ALL, `${id} was never in the add menu`).toContain(id)
      expect(TAB_MENU_TYPES_ALL, `${id} was never in the tab menu`).toContain(id)
    }
  })

  it('⛔ no add-widget menu, no add-tab menu, no phone sheet, no slash menu, no palette', () => {
    for (const id of UNRELEASED_CAPTURE_WIDGETS) {
      expect(WORKSPACE_MENU_TYPES, `${id} is in the workspace add menu`).not.toContain(id)
      expect(TAB_MENU_TYPES, `${id} is in the add-tab menu`).not.toContain(id)
      expect(MOBILE_MENU_TYPES, `${id} is in the phone sheet`).not.toContain(id)
      expect(JOURNAL_MENU_TYPES, `${id} is in the journal menu`).not.toContain(id)
    }
  })

  it('⛔ and menuGroups() — the GROUPED menu the gallery renders — does not leak them', () => {
    // The grouped menu reads the arrays through _MENU_TYPE_SETS. A gate applied
    // to the flat lists but not the grouped one would be invisible to the tests
    // above and perfectly visible to a member.
    for (const menu of ['workspace', 'tab', 'mobile', 'journal']) {
      const flat = menuGroups(menu).flatMap(g => g.items)
      for (const id of UNRELEASED_CAPTURE_WIDGETS) {
        expect(flat, `${id} leaked into menuGroups('${menu}')`).not.toContain(id)
      }
    }
  })

  it('⭐ BOTH DIRECTIONS — released, they come back. A gate proved one way is not a gate', () => {
    const on = releasedTypes(WORKSPACE_MENU_TYPES_ALL, true)
    for (const id of UNRELEASED_CAPTURE_WIDGETS) expect(on).toContain(id)
    // ...and the gate removes exactly those, nothing else.
    const off = releasedTypes(WORKSPACE_MENU_TYPES_ALL, false)
    expect(on.filter(id => !off.includes(id)).sort())
      .toEqual([...UNRELEASED_CAPTURE_WIDGETS].sort())
  })

  it('⛔⛔ OFF IS NOT DELETED — a note that already stores such an embed still renders', () => {
    // Turning a door off has never been permission to stop honouring what a
    // member already saved. The registry must still describe the type, with its
    // params schema intact, or a stored embed degrades to a broken chip.
    for (const id of UNRELEASED_CAPTURE_WIDGETS) {
      const w = WIDGET_REGISTRY[id]
      expect(Array.isArray(w.paramsSchema), `${id} lost its params schema`).toBe(true)
      expect(w.paramsSchema.length, `${id} has an empty params schema`).toBeGreaterThan(0)
      expect(typeof w.labels.header, `${id} lost its header label`).toBe('string')
    }
  })
})

describe('⛔ the two capture BUTTONS consult the gate', () => {
  // Behaviour is proved in each door's own rail; this is the cheap tripwire that
  // the import cannot be deleted quietly while a weakened behavioural test still
  // passes. Comments are stripped first — this repo has matched its own prose
  // nine times.
  const ROOT = path.join(process.cwd(), 'src')
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const DOORS = [
    'components/TickerActions.jsx',
    'pages/charts/widgets/ScannerResults.jsx',
  ]

  it('⭐ NON-VACUITY: the door files are on disk and readable', () => {
    for (const rel of DOORS) {
      expect(fs.readFileSync(path.join(ROOT, rel), 'utf8').length).toBeGreaterThan(500)
    }
  })

  it('⛔ each imports captureRelease and calls captureEnabled()', () => {
    const missing = DOORS.filter((rel) => {
      const code = strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
      return !/captureRelease/.test(code) || !/captureEnabled\s*\(/.test(code)
    })
    expect(missing, 'these capture doors do not consult the release gate').toEqual([])
  })
})
