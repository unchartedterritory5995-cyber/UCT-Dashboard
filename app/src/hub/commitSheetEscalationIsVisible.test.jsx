/**
 * The commit-sheet escalation reaches a member whose phone cannot buzz.
 *
 * ⛔ THE DEFECT. Increment 2 (B5) made the cue read the action's own `escalate` flag, so a write
 * that asks the member to commit escalates `haptics.impact()` to `haptics.warn()`. That
 * escalation is a VIBRATION and nothing else. iOS Safari exposes no `navigator.vibrate`, so
 * `haptics.js`'s `canVibrate()` is false and `warn()` returns `false` having done nothing. On an
 * iPhone the serious kind of write looked, sounded and felt exactly like the ordinary kind.
 *
 * ⭐ EVERY EXISTING ASSERTION STAYED GREEN, correctly. `actionsSheetHaptic.test.jsx` asserts "the
 * contract is the CALL, not a vibration" — and the call IS made. Nothing was lying; the escalation
 * simply had one organ and that organ does not exist on the platform. A test can only catch this
 * by asking what a PERSON perceives, which is why every assertion below is on RENDERED TEXT
 * (owner ruling, 2026-09-09: two joystick toasts shipped with every structural assertion green and
 * nothing on screen).
 *
 * The iOS case is simulated by DELETING `navigator.vibrate` — with a control that proves the
 * deletion took, and a second control proving the haptic really is inert there, so "the text is
 * present" is not passing over an environment that can still buzz.
 */
import { describe, it as vitestIt, expect, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import HubConfirmSheet from './HubConfirmSheet'
import StopConfirmSheet from './StopConfirmSheet'
import { COMMIT_NOTICE_TEXT } from './HubCommitNotice'
import { validateConfirmPayload } from './contracts'
import { modes } from './registry'
import haptics from '../components/mobile/haptics.js'

let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => { executedCount += 1; return fn(...args) })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')

const payload = (over = {}) => ({
  title: 'Set alert',
  body: 'Alert on NVDA at 178.10?',
  primaryLabel: 'Set alert',
  onConfirm: () => {},
  ...over,
})

const STOP = {
  symbol: 'AAPL', side: 'Long', entry: 178.1, shares: 100,
  currentStop: 176, originalStop: 176, stop: 177.3,
}

// ─── the iPhone ──────────────────────────────────────────────────────────────
describe('on a device with no navigator.vibrate (iOS Safari), the escalation is still THERE', () => {
  let original
  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(navigator, 'vibrate')
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true, writable: true })
  })
  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'vibrate', original)
    else delete navigator.vibrate
  })

  it('CONTROL: this environment really cannot vibrate, and the haptic really is inert', () => {
    // Without these two, every assertion below could be passing on a machine that CAN buzz —
    // which is to say, passing for the wrong reason on the one platform this exists for.
    expect(typeof navigator.vibrate).not.toBe('function')
    expect(haptics.warn(), 'warn() reported success with no vibrate API').toBe(false)
  })

  it('an escalated confirm sheet renders the escalation as WORDS', () => {
    render(<HubConfirmSheet payload={payload({ escalate: true })} onClose={() => {}} />)
    expect(screen.getByText(COMMIT_NOTICE_TEXT)).toBeInTheDocument()
    // ...and it is above the body, where the member reads before they reach the button.
    expect(screen.getByTestId('hub-confirm-body')).toHaveTextContent('Alert on NVDA at 178.10?')
  })

  it('the stop sheet — the Journal\'s write door — always carries it', () => {
    render(<StopConfirmSheet {...STOP} onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.getByText(COMMIT_NOTICE_TEXT)).toBeInTheDocument()
    expect(screen.getByTestId('hub-stop-primary')).toHaveTextContent('Set stop 177.30')
  })
})

// ─── it is a STATE, not decoration ───────────────────────────────────────────
describe('the notice tracks the flag, so it keeps meaning something', () => {
  it('a confirm sheet that does NOT escalate shows no notice', () => {
    // ⛔ The control that stops this from becoming wallpaper. A banner on every sheet is a banner
    // nobody reads, and then the escalation is silent again — in a different way.
    render(<HubConfirmSheet payload={payload({ escalate: false })} onClose={() => {}} />)
    expect(screen.queryByText(COMMIT_NOTICE_TEXT)).not.toBeInTheDocument()
    expect(screen.getByTestId('hub-confirm-body')).toBeInTheDocument() // the sheet DID render
  })

  it('an absent flag is treated as not escalated', () => {
    render(<HubConfirmSheet payload={payload()} onClose={() => {}} />)
    expect(screen.queryByText(COMMIT_NOTICE_TEXT)).not.toBeInTheDocument()
  })

  it('the contract refuses a non-boolean escalate at the boundary', () => {
    // `'false'` is truthy: a string here would escalate every sheet forever and the notice would
    // stop meaning anything the first time a member saw it on something harmless.
    expect(() => validateConfirmPayload(payload({ escalate: 'false' }), 'test'))
      .toThrow(/escalate must be a boolean/)
    // CONTROL: the validator is not simply throwing at everything handed to it.
    expect(() => validateConfirmPayload(payload({ escalate: true }), 'test')).not.toThrow()
  })
})

// ─── one authority, two organs ───────────────────────────────────────────────
function jsFilesUnder(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) jsFilesUnder(full, out)
    else if (/\.(jsx?|mjs)$/.test(entry)) out.push(full)
  }
  return out
}
const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/')
const ALL_JS = jsFilesUnder(SRC)
const OWNS_SENTENCE = ALL_JS
  .filter((f) => !/\.test\./.test(f))
  .filter((f) => readFileSync(f, 'utf8').includes(COMMIT_NOTICE_TEXT))

describe('the visible escalation and the haptic one read the SAME flag', () => {
  it('CONTROL: the sweep read this repo, and the registry has an escalating confirm to reach', () => {
    expect(ALL_JS.map(rel)).toContain('hub/HubCommitNotice.jsx')
    const escalatingConfirms = modes.flatMap((m) => (m.fan ?? [])
      .filter((a) => a.kind === 'confirm' && a.escalate === true)
      .map((a) => a.id))
    // Named, not counted: a count passes a registry that lost the action and gained another.
    expect(escalatingConfirms).toContain('scan.alert')
  })

  it('exactly ONE module owns the sentence', () => {
    // Three sheets render it. If the words are retyped in any of them they will drift into three
    // different warnings for one state — and the test asserting "the member was warned" would
    // still pass on whichever copy it happened to import.
    expect(OWNS_SENTENCE.map(rel)).toEqual(['hub/HubCommitNotice.jsx'])
  })

  it('HubRoot\'s confirm branch reads `action.escalate` — the same field useJoystick does', () => {
    // ⭐ Read at the runtime CALL SITE, not restated in a harness (owner ruling after R-05: a
    // contract verified against a harness agrees with itself and not with the product).
    const root = readFileSync(path.join(SRC, 'hub/HubRoot.jsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const branch = root.slice(root.indexOf('setConfirmPayload({'))
    expect(branch, 'HubRoot no longer builds a confirm payload').toContain('primaryLabel')
    expect(
      branch.slice(0, branch.indexOf('})')),
      'the confirm payload stopped carrying `escalate`, so the sheet can no longer show the '
      + 'escalation and iOS is silent again',
    ).toMatch(/escalate:\s*action\.escalate === true/)

    // ⚰️ THIS ONCE READ `useJoystick.js` FOR `action.escalate` DIRECTLY, and went red the day the
    // branch moved into `escalateCue.js` — correctly, because the rail is about the FLAG being
    // shared, and it could no longer see where the flag was read. It now follows BOTH HOPS, so
    // deleting either one still fails it: the gesture door must delegate to the shared cue, and
    // the shared cue must read the same field the sheet payload does.
    const joystick = readFileSync(path.join(SRC, 'hub/useJoystick.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(
      joystick,
      'the gesture door no longer routes its cue through escalateCue, so the two doors can drift '
      + 'again — which is the defect that made iOS silent on the sheet door for a whole wave',
    ).toMatch(/escalateCue\(/)

    const cue = readFileSync(path.join(SRC, 'hub/escalateCue.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(cue, 'the shared cue stopped reading the same flag').toMatch(/action\?\.escalate|action\.escalate/)
  })
})
