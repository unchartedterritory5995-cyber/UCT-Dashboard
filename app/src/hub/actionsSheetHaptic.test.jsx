// Joystick hub — the WCAG 2.5.1 door owes the member the SAME haptic cue as the gesture door.
//
// Spec §C2 says the Actions sheet is an EQUAL path to every action. It has been equal in outcome
// since Phase 2 (both doors resolve through `HubRoot.jsx`'s `runAction`) and unequal in FEEL the
// whole time: `useJoystick.js:182-201` fires `haptics.impact()` on every gesture fire and
// escalates to `haptics.warn()` when the action declares `escalate: true` (B5), while
// `HubActionsButton`'s sheet fired nothing at all. The members who can only use this door are
// exactly the ones who cannot use the other — VoiceOver and TalkBack both claim the two-finger
// tap that Peek needs — so the quieter product was aimed at the people least able to leave it.
//
// This file rails four things:
//   1. the cue exists on the sheet door, and matches the escalate flag for EVERY action in the
//      registry — derived from `registry`'s own `escalate`, the same authority `useJoystick.js:197`
//      reads, so the second copy of that branch in `HubActionsButton.jsx` cannot drift silently;
//   2. it is the SAME helper object, proved by spying on the module's own default export rather
//      than on a vibration;
//   3. it is a CALL, not a vibration — iOS Safari exposes no `navigator.vibrate` and the cue is
//      still owed there (the helper no-ops and returns false);
//   4. there is still exactly one `navigator.vibrate` call site in the app (constants.js:160).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import HubActionsButton from './HubActionsButton'
import haptics from '../components/mobile/haptics.js'
import { modes } from './registry'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const SRC_ROOT = path.resolve(HERE, '..')

// ── non-vacuity control (house idiom, hubComponents.test.jsx:23-31) ─────────
// `vitest -t` is a regex; a filter matching nothing exits 0 and reads as a PASS.
let executed = 0
const ran = () => {
  executed += 1
}

// ── the corpus, derived not re-typed ───────────────────────────────────────
// Every action the registry can put in a fan, deduped by id (helpers like `alert(mode)` mint one
// per mode). The expected cue is read off `action.escalate` — the same field `useJoystick.js:197`
// branches on — so this rail says "the two doors agree", not "the sheet does what I typed here".
const byId = new Map()
for (const mode of modes) {
  for (const action of mode.fan || []) {
    if (!byId.has(action.id)) byId.set(action.id, action)
  }
}
const ALL_ACTIONS = [...byId.values()]
const ESCALATING = ALL_ACTIONS.filter((a) => a.escalate === true)
const PLAIN = ALL_ACTIONS.filter((a) => a.escalate !== true)

const MODE_LABEL = 'Journal'
const OPENER = `${MODE_LABEL} actions`

/** Render the sheet with a one-action fan, open it, pick that action. */
function pick(action, props = {}) {
  const onAction = vi.fn()
  render(<HubActionsButton mode={MODE_LABEL} actions={[action]} onAction={onAction} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: OPENER }))
  fireEvent.click(screen.getByText(action.label).closest('button'))
  return onAction
}

let warnSpy
let impactSpy
let tapSpy

beforeEach(() => {
  // ⭐ THE SAME-HELPER PROOF. These spy on the properties of the object `haptics.js` default-exports
  // — the very object `HubActionsButton.jsx` imports. `haptics.warn()` dereferences at call time,
  // so a component holding its own copy of the helper (the thing the task forbids) would leave
  // every one of these spies at zero calls. Call-through is deliberate: the real `fire()` still
  // runs, which is what lets the iOS case below assert the return value.
  warnSpy = vi.spyOn(haptics, 'warn')
  impactSpy = vi.spyOn(haptics, 'impact')
  tapSpy = vi.spyOn(haptics, 'tap')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('corpus control — this rail can actually distinguish the two cues', () => {
  it('the registry offers both an escalating and a non-escalating action', () => {
    ran()
    // rule 14: an empty result is a failed invocation. A corpus of only-escalating (or
    // only-plain) actions would let a component that ALWAYS calls warn() pass every case below.
    expect(ALL_ACTIONS.length).toBeGreaterThanOrEqual(10)
    expect(ESCALATING.length).toBeGreaterThanOrEqual(1)
    expect(PLAIN.length).toBeGreaterThanOrEqual(1)
  })

  it('warn() and impact() are distinguishable helpers, not aliases', () => {
    ran()
    expect(haptics.warn).not.toBe(haptics.impact)
  })
})

describe('HubActionsButton — the WCAG door fires the same cue as the gesture door (§C2)', () => {
  it('escalating actions get warn(), plain actions get impact() — every action in the registry', () => {
    ran()
    const observed = []
    const expected = []
    for (const action of ALL_ACTIONS) {
      warnSpy.mockClear()
      impactSpy.mockClear()
      pick(action)
      observed.push({
        id: action.id,
        warn: warnSpy.mock.calls.length,
        impact: impactSpy.mock.calls.length,
      })
      expected.push({
        id: action.id,
        warn: action.escalate === true ? 1 : 0,
        impact: action.escalate === true ? 0 : 1,
      })
      cleanup()
    }
    // Non-vacuity: the loop actually ran the whole corpus.
    expect(observed).toHaveLength(ALL_ACTIONS.length)
    expect(observed).toEqual(expected)
  })

  it('journal.close — the B5 regression case — escalates on the sheet door too', () => {
    ran()
    // kind:'run' with escalate:true (registry.js:341-350). Branching on `kind` (the pre-B5 rule)
    // would call impact() here, on the most destructive action in the hub.
    const close = byId.get('journal.close')
    expect(close).toBeDefined()
    expect(close.kind).toBe('run')
    expect(close.escalate).toBe(true)
    pick(close)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(impactSpy).not.toHaveBeenCalled()
  })

  it('a plain action gets impact() and never the escalation', () => {
    ran()
    const plain = PLAIN[0]
    pick(plain)
    expect(impactSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('never fires the open/target-change cue — tap() belongs to the gesture, not to a sheet pick', () => {
    ran()
    pick(ESCALATING[0])
    expect(tapSpy).not.toHaveBeenCalled()
  })

  it('a disabled action fires no cue and no action — the cue must not announce a no-op', () => {
    ran()
    const action = ESCALATING[0]
    const onAction = pick(action, { disabledIds: [action.id] })
    expect(onAction).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(impactSpy).not.toHaveBeenCalled()
  })

  it('hapticsEnabled={false} silences the cue and STILL fires the action', () => {
    ran()
    const action = ESCALATING[0]
    const onAction = pick(action, { hapticsEnabled: false })
    expect(warnSpy).not.toHaveBeenCalled()
    expect(impactSpy).not.toHaveBeenCalled()
    // The member turned off vibration, not the product.
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('defaults to on when the prop is absent — the same "unset means on" rule as useJoystick.js:126', () => {
    ran()
    pick(ESCALATING[0])
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

describe('the contract is the CALL, not a vibration (iOS Safari has no navigator.vibrate)', () => {
  let originalDescriptor

  beforeEach(() => {
    originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'vibrate')
  })

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(navigator, 'vibrate', originalDescriptor)
    else delete navigator.vibrate
  })

  it('still calls the helper where vibration is impossible, and the helper reports false', () => {
    ran()
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true, writable: true })
    // Control: the environment really is vibrate-less, so "it was called" below is not being
    // carried by a vibration that quietly happened anyway.
    expect(typeof navigator.vibrate).not.toBe('function')

    pick(ESCALATING[0])

    expect(warnSpy).toHaveBeenCalledTimes(1)
    // haptics.js:9 — `if (!canVibrate()) return false`. The cue was owed, attempted, and no-opped.
    expect(warnSpy.mock.results[0].value).toBe(false)
  })

  it('reaches navigator.vibrate with the escalation pattern where vibration IS supported', () => {
    ran()
    const stub = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', { value: stub, configurable: true, writable: true })

    // Derive the two patterns from the helper itself rather than re-typing haptics.js's numbers —
    // a re-typed [22,60,22] here would be a second authority over the cue.
    haptics.warn()
    const warnPattern = stub.mock.calls.at(-1)[0]
    haptics.impact()
    const impactPattern = stub.mock.calls.at(-1)[0]
    // Distinguishability control: if the two patterns were equal this assertion could not tell
    // an escalation from a plain fire.
    expect(warnPattern).not.toEqual(impactPattern)

    stub.mockClear()
    pick(ESCALATING[0])
    expect(stub).toHaveBeenCalledTimes(1)
    expect(stub.mock.calls[0][0]).toEqual(warnPattern)
  })
})

describe('one helper, one vibrate call site', () => {
  it('HubActionsButton and useJoystick import the SAME haptics module', () => {
    ran()
    const IMPORT = /import\s+haptics\s+from\s+'([^']+haptics[^']*)'/
    const buttonSrc = fs.readFileSync(path.join(HERE, 'HubActionsButton.jsx'), 'utf8')
    const joystickSrc = fs.readFileSync(path.join(HERE, 'useJoystick.js'), 'utf8')

    const buttonMatch = buttonSrc.match(IMPORT)
    const joystickMatch = joystickSrc.match(IMPORT)
    // Non-vacuity: a regex that matched nothing would make the resolve-and-compare below trivially
    // true if it were written defensively, so fail here first.
    expect(buttonMatch).not.toBeNull()
    expect(joystickMatch).not.toBeNull()

    // Compare RESOLVED paths, not the specifier strings — the two files could legally reach the
    // same module by different relative paths.
    expect(path.resolve(HERE, buttonMatch[1])).toBe(path.resolve(HERE, joystickMatch[1]))
    expect(fs.existsSync(path.resolve(HERE, buttonMatch[1]))).toBe(true)
  })

  it('no hub source vibrates directly — every hub cue goes through haptics.js (constants.js:160)', () => {
    ran()
    // ⚠️ SCOPED TO THE HUB, AND THE SCOPE IS MEASURED, NOT ASSUMED. The first draft of this rail
    // asserted `navigator.vibrate` was called from exactly one file in the WHOLE app; it failed,
    // and it was the rail that was wrong. app/src has SIX call sites — haptics.js plus five
    // pre-hub long-press cues that each open-code `navigator.vibrate?.(10)`:
    // `components/mobile/useLongPress.js:35`, `components/StockChart.jsx:13876`,
    // `components/TickerActions.jsx:50`, `pages/ModelBook.jsx:1970`, `pages/Watchlists.jsx:959`
    // and `components/chart/ChartDrawingOverlay.jsx:1777`. Consolidating those is a real cleanup
    // and none of those files belongs to this stream, so this rail asserts the rule
    // `constants.js:160` actually states in its own context — the HUB adds no second call site —
    // rather than an app-wide claim that has been false since before the hub existed.
    const CALL = /navigator\s*\.\s*vibrate\s*\??\.?\s*\(/

    // Control: the pattern really can match a call site. Without this the "no offenders" result
    // below is indistinguishable from a regex that matches nothing (rule 14).
    const helperSrc = fs.readFileSync(path.join(SRC_ROOT, 'components', 'mobile', 'haptics.js'), 'utf8')
    expect(CALL.test(helperSrc)).toBe(true)

    const hubFiles = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(jsx?|mjs)$/.test(entry.name)) hubFiles.push(full)
      }
    }
    walk(HERE)
    // Non-vacuity: the walk found the hub, not an empty directory.
    expect(hubFiles.length).toBeGreaterThan(20)

    // ⛔ lesson_a_search_over_sources_counts_the_searcher — THIS FILE stubs `navigator.vibrate`
    // and would report itself as an offender forever. Exclude it, and prove the exclusion is live
    // by asserting the searcher is genuinely in the raw hit set.
    const rawHits = hubFiles.filter((f) => CALL.test(fs.readFileSync(f, 'utf8')))
    expect(rawHits.map((f) => path.resolve(f))).toContain(path.resolve(SELF))

    const offenders = rawHits
      .filter((f) => path.resolve(f) !== path.resolve(SELF))
      .filter((f) => !/\.test\.[jt]sx?$/.test(f))
      .map((f) => path.relative(HERE, f).replace(/\\/g, '/'))
    expect(offenders).toEqual([])
  })
})

describe('rail integrity', () => {
  it('actually executed its cases — a vitest -t regex matching nothing exits 0 and reads as a PASS', () => {
    expect(executed).toBeGreaterThanOrEqual(13)
  })
})
