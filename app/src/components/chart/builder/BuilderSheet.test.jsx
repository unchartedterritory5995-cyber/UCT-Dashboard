import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import acornJsx from 'acorn-jsx'

import BuilderSheet, { BuilderBoundary, buildDefinition, draftDefId } from './BuilderSheet'
import FormulaField, { evaluateFormula, canSaveFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'
import { parseFormula, astHash } from '../engine/ast/parse'
import { sentenceFor } from '../engine/ast/sentence'
import { lintRepaint, REPAINT_MODES } from '../engine/ast/lint'
import { checkBudget } from '../engine/ast/budget'
import { validateUserDefinitions, getDefinition, clearUserDefinitions } from '../engine/nativeRegistry'
// ⚠️ THE NAMESPACE, because `normalizeInstances` takes a REGISTRY and the
// namespace import is the shape `StockChart.jsx` hands it.
import * as engineRegistry from '../engine/nativeRegistry'
import { normalizeInstances } from '../engine/instances'

// ─── THE FIRST TASK OF PHASE D A USER CAN SEE ───────────────────────────────
//
// Everything before it was invisible: a parser, two interpreters, a budget
// guard, a linter, a read-back. What this file has to prove is that the surface
// hands those to a person WITHOUT adding a second opinion of its own — the
// refusal is the refusing door's sentence, the read-back is `sentenceFor`'s
// string, the badge is `lintRepaint`'s verdict, and none of the three is
// re-worded on the way to the screen.
//
// ⚠️ THE HOOK IS NOT MOCKED, ON PURPOSE. `lesson_injected_dependency_hides_the_
// fetch`: 996 green tests shipped a feature that ran in 0 of 24 charts because
// every test handed in a fake. `useUserDefinitions` runs for real here and
// `global.fetch` is the spy, so "it does not write `chart_settings`" is a claim
// about the request that actually leaves, not about a stub's argument list.

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`BuilderSheet probe: could not find the repo root from ${process.cwd()}`)
})()

// Normalise line endings. Git checks these files out with CRLF on Windows
// (BuilderSheet.jsx is 753 CRLF / 0 bare LF), so any assertion below that spans
// a line break — `toContain('UNTIL\n// TASK 16 …')` — fails on a Windows
// working copy and passes on CI. That is a fact about the checkout, not about
// the source, and a rail that reports it as a defect trains you to ignore it.
const read = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

const JSXParser = Parser.extend(acornJsx())

const H = vi.hoisted(() => ({ requests: [], writeResponse: null }))

function stubFetch() {
  H.requests = []
  H.writeResponse = null
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method !== 'GET' && H.writeResponse) {
      const r = H.writeResponse
      H.writeResponse = null
      return r
    }
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}

/** Flush microtasks under fake timers. `waitFor` schedules real intervals and
 *  hangs here, so the promise chain is drained explicitly instead. */
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function mount({ user = { id: 7 }, onClose = () => {}, onSaved = () => {} } = {}) {
  return render(
    <AuthContext.Provider value={{ user, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={onClose} onSaved={onSaved} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const field = () => screen.getByLabelText('Formula')

async function typeFormula(text) {
  fireEvent.change(field(), { target: { value: text } })
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
  await flush()
}

async function nameIt(text = 'My line') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: text } })
  await flush()
}

const saveBtn = () => screen.getByRole('button', { name: /^Sav/ })

beforeEach(() => {
  vi.useFakeTimers()
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete global.fetch
})

// ─── 1. A REFUSAL IS THE NORMAL CASE, AND IT NAMES ITS DOOR ─────────────────

describe('the builder refuses without dying', () => {
  it('an invalid formula shows an ERROR CHIP and never a blank chart', async () => {
    // Spec §6's ten instance states. State 4 is a red dot on the chip with the
    // message beside it plus a copy-diagnostic; NONE of the ten is "the page
    // died". And a parse failure is the NORMAL case on this surface — the whole
    // thing is a text box a user is halfway through typing into.
    mount()
    await typeFormula('sma(close,')
    expect(screen.getByTestId('formula-error')).toHaveTextContent(/unexpected|expected/i)
    expect(screen.getByTestId('formula-error').getAttribute('role')).toBe('alert')
    expect(screen.queryByTestId('builder-crash')).toBeNull()
    expect(saveBtn()).toBeDisabled()
  })

  it('⛔ MANDATORY: a refused formula shows its REASON, verbatim, at every door', async () => {
    // ⛔ THE SENTENCE IS THE REFUSING DOOR'S. jsep's carries a CHARACTER OFFSET,
    // the budget's carries the number that was exceeded. Neither survives a
    // rewrite, and a second vocabulary for one decision rots apart from the
    // first the day a guard is reworded. So the expectation is DERIVED by
    // calling the door — a hardcoded string would pass against a builder that
    // prints its own approximation of the same idea.
    const cases = [
      { src: 'sma(close,', guard: 'parser' },
      { src: 'close.length', guard: 'canonicalise:member' },
      { src: 'sma(close, 600)', guard: 'budget:lookback' },
      { src: 'foo(close, 3)', guard: 'resolve:function' },
      { src: 'close + high + low + open + volume + above_50sma + accdis + adr_pct + atr_pct', guard: 'budget:series' },
    ]
    for (const c of cases) {
      const expected = evaluateFormula(c.src)
      expect(expected.error, `${c.src} is not refused at all — this case proves nothing`).toBeTruthy()
      expect(expected.guard, c.src).toBe(c.guard)

      mount()
      await typeFormula(c.src)
      const chip = screen.getByTestId('formula-error')
      expect(chip.textContent, c.src).toContain(expected.error)
      expect(chip.getAttribute('data-guard'), c.src).toBe(c.guard)
      expect(screen.queryByTestId('builder-crash')).toBeNull()
      cleanup()
    }
  })

  it('the five doors say five DIFFERENT things — a shared phrase is a gate nothing can tell apart', () => {
    const msgs = [
      'sma(close,', 'close.length', 'sma(close, 600)', 'foo(close, 3)',
      'close + high + low + open + volume + above_50sma + accdis + adr_pct + atr_pct',
    ].map((s) => evaluateFormula(s).error)
    expect(msgs.every(Boolean)).toBe(true)
    expect(new Set(msgs).size).toBe(msgs.length)
  })

  it('the crash boundary is NOT vacuous — a throwing child renders `builder-crash`', () => {
    // Without this control, `queryByTestId('builder-crash')).toBeNull()` above
    // is satisfied by a component that has no boundary at all. This is the
    // SHIPPED class, not a copy of it.
    const Boom = () => { throw new Error('probe') }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<BuilderBoundary><Boom /></BuilderBoundary>)
    expect(screen.getByTestId('builder-crash')).toBeTruthy()
    cleanup()
    render(<BuilderBoundary><div data-testid="fine" /></BuilderBoundary>)
    expect(screen.queryByTestId('builder-crash')).toBeNull()
    expect(screen.getByTestId('fine')).toBeTruthy()
    err.mockRestore()
  })
})

// ─── 2. THE READ-BACK IS SHOWN, NEVER PARAPHRASED ───────────────────────────

describe('the read-back', () => {
  it('the READ-BACK is shown before Save, and Save is disabled until it is', async () => {
    // The read-back is the contract with the user: what they confirm is what
    // runs.
    mount()
    expect(screen.queryByTestId('readback')).toBeNull()
    expect(saveBtn()).toBeDisabled()
    await typeFormula('sma(close, 20)')
    expect(screen.getByTestId('readback')).toHaveTextContent('the 20-bar average of close')
    // …and the NAME is the other half of a savable document.
    expect(saveBtn()).toBeDisabled()
    await nameIt()
    expect(saveBtn()).toBeEnabled()
  })

  it("⛔ MANDATORY: the read-back is `sentenceFor`'s OWN string — not the source, not a paraphrase", async () => {
    // ⛔ `sentence.js` DELIBERATELY REFUSES TO SMOOTH. `&&`, `||` and `?:` state
    // all three cases with NaN as "nothing", because the tempting reading of
    // `?:` — "{1} when {0}, otherwise {2}" — is a LIE for the NaN case, and NaN
    // is what the binder draws there. A UI that re-words this is a second
    // description of the maths and the user confirms the one that is NOT
    // running. So the expectation is `sentenceFor`'s return value, computed
    // here, character for character.
    const sources = [
      'sma(close, 20)',
      'close - sma(close, 20)',
      '(high + low) / 2',
      'close > sma(close, 50) ? 1 : 0',
      'crossOver(close, sma(close, 20))',
    ]
    for (const src of sources) {
      const parsed = parseFormula(src)
      expect(parsed.ok, src).toBe(true)
      const want = sentenceFor(parsed.ast, undefined)

      mount()
      await typeFormula(src)
      const node = screen.getByTestId('readback')
      expect(node.textContent, src).toBe(want)
      // …and it is NOT the maths. A read-back rendered from `compute.source` is
      // the mutation this case exists to kill, and it is invisible unless the
      // two strings are asserted to DIFFER.
      expect(node.textContent, src).not.toBe(src)
      cleanup()
    }
  })

  it('the ternary read-back states ALL THREE cases, including the NaN one', async () => {
    // The specific smoothing `sentence.js` rejected. If the UI ever truncates or
    // clamps the read-back, this is the sentence that loses its third term — and
    // the lost term is the one a reader would not have guessed.
    mount()
    await typeFormula('close > sma(close, 50) ? 1 : 0')
    const text = screen.getByTestId('readback').textContent
    expect(text).toMatch(/is not zero/)
    expect(text).toMatch(/is zero/)
    expect(text).toMatch(/nothing while/)
  })

  it('a formula with NO read-back cannot be saved', async () => {
    mount()
    await nameIt()
    await typeFormula('foo(close, 3)')
    expect(screen.queryByTestId('readback')).toBeNull()
    expect(saveBtn()).toBeDisabled()
  })
})

// ─── 3. THE BADGE IS A GATE, NOT A LABEL ────────────────────────────────────

describe('the repaint verdict gates the form', () => {
  it('⛔ a `repaints` verdict BLOCKS save — the gate, in isolation', () => {
    // ⛔ THE BADGE IS NOT DECORATION AND IT IS NOT THE USER'S TO SET (spec §1.3:
    // repaint badges are machine-or-audit-assigned, NEVER self-disclosed). This
    // drives the DECISION FUNCTION rather than the form, because with the
    // shipped manifest no table-legal tree can reach it through the form — see
    // the declared-property case below. A gate reachable only by injecting a
    // fake table into the product would be the
    // `lesson_injected_dependency_hides_the_fetch` shape; a pure function with
    // its own test is not.
    expect(canSaveFormula({ ok: true, verdict: { mode: 'non-repainting' } })).toBe(true)
    expect(canSaveFormula({ ok: true, verdict: { mode: 'repaints' } })).toBe(false)
    // …and no acknowledgement rescues it. There is no checkbox that makes an
    // unbounded forward reference safe.
    expect(canSaveFormula({ ok: true, verdict: { mode: 'repaints' } }, true)).toBe(false)
  })

  it('`preview-repaints` requires an ACKNOWLEDGEMENT — both directions', () => {
    const r = { ok: true, verdict: { mode: 'preview-repaints', forward: 26 } }
    expect(canSaveFormula(r, false)).toBe(false)
    expect(canSaveFormula(r, true)).toBe(true)
  })

  it('an inadmissible formula is never savable whatever its badge says', () => {
    expect(canSaveFormula({ ok: false, verdict: { mode: 'non-repainting' } }, true)).toBe(false)
    expect(canSaveFormula(null)).toBe(false)
    expect(canSaveFormula({ ok: true, verdict: null })).toBe(true)
  })

  it('the gate covers EVERY value of the closed vocabulary — none falls through', () => {
    // A vocabulary member the gate has no branch for is a badge that reaches
    // "savable" by accident.
    expect(REPAINT_MODES.length).toBe(3)
    for (const mode of REPAINT_MODES) {
      const r = { ok: true, verdict: { mode } }
      const [without, withAck] = [canSaveFormula(r, false), canSaveFormula(r, true)]
      if (mode === 'non-repainting') expect([without, withAck]).toEqual([true, true])
      if (mode === 'preview-repaints') expect([without, withAck]).toEqual([false, true])
      if (mode === 'repaints') expect([without, withAck]).toEqual([false, false])
    }
  })

  it('⚠️ DECLARED PROPERTY: with the shipped manifest, every ADMISSIBLE tree lints `non-repainting`', () => {
    // Every `lookback` in `closedTable.json` is ≥0 or `"argK"`, so `astReach`
    // returns forward 0 for any table-legal tree — which means the only trees
    // that carry another badge are ones `checkBudget` has ALREADY refused at
    // `resolve:function` / `resolve:window`. Pinned rather than discovered: the
    // day the manifest declares a negative lookback this case goes red and the
    // acknowledgement path stops being unreachable.
    const admissible = [
      'sma(close, 20)', 'ema(close, 9) - ema(close, 21)', '(high + low) / 2',
      'crossOver(close, sma(close, 20))', 'change(close)', 'abs(close)',
      'highest(high, 20) - lowest(low, 20)', 'close > sma(close, 50) ? 1 : 0',
      'stdev(close, 20)', 'max(close, open)', 'min(close, open)', '-close', '!close',
    ]
    for (const src of admissible) {
      const r = evaluateFormula(src)
      expect(r.ok, `${src}: ${r.error}`).toBe(true)
      expect(r.verdict.mode, src).toBe('non-repainting')
    }
    expect(admissible.length).toBeGreaterThan(10)

    // …and the OTHER half, which is what makes this a property and not a
    // coincidence: a tree the linter brands `repaints` is refused by a door that
    // names the REAL defect, never by the badge.
    for (const src of ['foo(close, 3)', 'sma(close, 5 + 5)', 'sma(close, close)']) {
      const r = evaluateFormula(src)
      expect(r.ok, src).toBe(false)
      expect(r.verdict.mode, src).toBe('repaints')
      expect(['resolve:function', 'resolve:window'], src).toContain(r.guard)
    }
  })

  it('🔴 THE WRONG DOOR: `foo(close, 3)` is refused as an UNKNOWN FUNCTION, never as a repaint', async () => {
    // The wrong-door defect has appeared four times on this branch and every
    // occurrence was a correct NUMBER produced by the wrong MECHANISM. The
    // linter genuinely measures `repaints` here (it fails closed), and that is
    // NOT the reason — so the badge must not be printed as one.
    mount()
    await typeFormula('foo(close, 3)')
    const chip = screen.getByTestId('formula-error')
    expect(chip.getAttribute('data-guard')).toBe('resolve:function')
    expect(chip).toHaveTextContent(/unknown function/i)
    expect(chip.textContent).not.toMatch(/repaint/i)
    expect(screen.queryByTestId('repaint-badge')).toBeNull()
    expect(saveBtn()).toBeDisabled()
  })

  it("the badge shown IS the linter's own measurement", async () => {
    mount()
    await typeFormula('sma(close, 20)')
    const badge = screen.getByTestId('repaint-badge')
    expect(badge.getAttribute('data-mode'))
      .toBe(lintRepaint(parseFormula('sma(close, 20)').ast).mode)
    expect(REPAINT_MODES).toContain(badge.getAttribute('data-mode'))
  })
})

// ─── 4. THE DOCUMENT: MACHINE-ASSIGNED BADGE, ONE SERIES, ONE HASH ──────────

describe('the stored document', () => {
  const docFor = (src, name = 'My line') => {
    const ast = parseFormula(src).ast
    return buildDefinition({
      defId: draftDefId(), name, source: src, ast,
      mode: lintRepaint(ast).mode, readback: sentenceFor(ast, undefined),
    })
  }

  it('passes the SHIPPED registration door — `validateUserDefinitions`, not a second validator', () => {
    const { defs, errors } = validateUserDefinitions([docFor('sma(close, 20)')])
    expect(errors).toEqual([])
    expect(defs).toHaveLength(1)
    expect(defs[0].compute.kind).toBe('ast')
  })

  it('⛔ a HAND-SET badge that disagrees with the linter is REFUSED — in both directions', () => {
    const doc = docFor('sma(close, 20)')
    expect(doc.meta.repaint).toBe('non-repainting')
    // over-claiming…
    const over = { ...doc, meta: { ...doc.meta, repaint: 'repaints' } }
    expect(validateUserDefinitions([over]).errors.join('\n')).toMatch(/meta\.repaint/)
    expect(validateUserDefinitions([over]).defs).toHaveLength(0)
    // …and the badge missing altogether.
    const none = { ...doc, meta: { ...doc.meta } }
    delete none.meta.repaint
    expect(validateUserDefinitions([none]).errors.join('\n')).toMatch(/meta\.repaint/)
    expect(validateUserDefinitions([none]).defs).toHaveLength(0)
  })

  it('`compute.fn` IS the astHash, and `compute.source` parses back to `compute.ast`', () => {
    const doc = docFor('close - sma(close, 20)')
    expect(doc.compute.fn).toBe(astHash(doc.compute.ast))
    expect(astHash(parseFormula(doc.compute.source).ast)).toBe(doc.compute.fn)
  })

  it('ONE formula is ONE series — exactly one data-bearing plot', () => {
    const doc = docFor('sma(close, 20)')
    expect(doc.plots).toHaveLength(1)
    const two = { ...doc, plots: [...doc.plots, { ...doc.plots[0], key: 'second' }] }
    expect(validateUserDefinitions([two]).errors.join('\n')).toMatch(/one data-bearing plot/i)
  })

  it('`meta.description` IS the read-back — derived from the tree, never typed', () => {
    const doc = docFor('sma(close, 20)')
    expect(doc.meta.description).toBe(sentenceFor(doc.compute.ast, undefined))
  })

  it('the minted draft id is legal for the store — `u_` + 12 hex', () => {
    for (let i = 0; i < 25; i++) expect(draftDefId()).toMatch(/^u_[0-9a-f]{12}$/)
  })
})

// ─── 5. IT DOES NOT WRITE `chart_settings` ──────────────────────────────────

describe('storage', () => {
  it('⛔ the builder does NOT write into `chart_settings`', async () => {
    // The allow-list would destroy it on the next read (Task 10 measured this
    // against a key called `userDefinitions`), and a feature that silently
    // forgets is worse than one that refuses. ⚠️ The hook is REAL here — this
    // reads the request that actually leaves.
    mount()
    await typeFormula('sma(close, 20)')
    await nameIt()
    fireEvent.click(saveBtn())
    await flush()
    expect(screen.getByTestId('saved-note')).toBeTruthy()

    const writes = H.requests.filter((r) => r.method !== 'GET')
    expect(writes.length).toBe(1)
    expect(writes[0].url).toContain('/api/user-definitions')
    expect(writes[0].method).toBe('POST')
    // …no preference write of any kind, and the string appears nowhere in any
    // request this surface made.
    expect(H.requests.length).toBeGreaterThan(1)
    for (const r of H.requests) {
      expect(r.url).not.toContain('/api/auth/preferences')
      expect(`${r.url}${r.body || ''}`).not.toContain('chart_settings')
    }
  })

  it('the "no chart_settings" claim is NOT vacuous — the spy CAN see one', async () => {
    // The positive control. Without it, a builder that made NO request at all
    // would pass the case above, and so would a spy that recorded nothing.
    await fetch('/api/auth/preferences', { method: 'POST', body: JSON.stringify({ chart_settings: '{}' }) })
    const r = H.requests.at(-1)
    expect(r.url).toContain('/api/auth/preferences')
    expect(`${r.url}${r.body || ''}`).toContain('chart_settings')
  })

  it('the sheet reaches storage through ONE module, and it is not the preferences one', () => {
    const flat = read('app/src/components/chart/builder/BuilderSheet.jsx').replace(/\s+/g, ' ')
    // ⛔ A SOURCE CLAIM WITH ITS OWN POSITIVE CONTROL: the same scan finds the
    // import that IS there, so a scan matching nothing because it is broken
    // fails too.
    expect(flat).toContain("from '../../../hooks/useUserDefinitions'")
    expect(/import \{[^}]*usePreferences/.test(flat)).toBe(false)
    expect(/import \{[^}]*useUserDefinitions/.test(flat)).toBe(true)
  })

  it("a store refusal reaches the user as the STORE's sentence, not a paraphrase", async () => {
    mount()
    await typeFormula('sma(close, 20)')
    await nameIt()
    H.writeResponse = {
      ok: false, status: 400,
      json: async () => ({ detail: 'definition count exceeds 50 per user — delete one before creating another' }),
    }
    fireEvent.click(saveBtn())
    await flush()
    expect(screen.getByTestId('store-error'))
      .toHaveTextContent('definition count exceeds 50 per user')
    expect(screen.queryByTestId('saved-note')).toBeNull()
  })
})

// ─── 6. THE 250 ms SETTLE ───────────────────────────────────────────────────

describe("the preview is debounced, and the number is spec §6's", () => {
  it('the constant is 250', () => {
    // Pinned as a LITERAL as well as behaviourally: the behavioural half below
    // reads the constant, so a mutation to 0 would satisfy it on its own.
    expect(FORMULA_DEBOUNCE_MS).toBe(250)
  })

  // ⛔ THE NUMBERS BELOW ARE ABSOLUTE, NEVER `FORMULA_DEBOUNCE_MS ± 1`, AND THE
  // REASON IS MEASURED. Written in terms of the constant, both cases MOVE WITH A
  // MUTATION: a gauntlet run that shortened the debounce to 1 ms left them green
  // (the "advance by CONSTANT − 1" step became "advance by 0"), so the whole
  // behavioural half was carried by the literal pin above. That is the
  // "extending a control's scope without re-deriving its floor" defect, and this
  // is the re-derived floor: a real typist's cadence, against real milliseconds.
  const TYPING_GAP_MS = 30

  it('⛔ it does NOT recompute on every keystroke — 14 keystrokes, ONE evaluation', () => {
    const seen = []
    const text = 'sma(close, 20)'
    const el = (n) => (
      <FormulaField value={text.slice(0, n)} onChange={() => {}} onEvaluated={(r) => seen.push(r.source)} />
    )
    const { rerender } = render(el(1))
    // A real cadence: 30 ms a character, 14 characters — 420 ms of typing, which
    // is LONGER than the 250 ms window. A per-keystroke build evaluates fourteen
    // times here; a debounced one evaluates never, because each keystroke resets
    // the timer.
    for (let n = 2; n <= text.length; n++) {
      act(() => { vi.advanceTimersByTime(TYPING_GAP_MS) })
      rerender(el(n))
    }
    expect(seen, 'an evaluation fired while the user was still typing').toEqual([])
    act(() => { vi.advanceTimersByTime(250) })
    // ⭐ EXACTLY ONE, AND IT IS THE SETTLED TEXT — not fourteen partial trees.
    expect(seen).toEqual([text])
  })

  it('nothing evaluates before 249 ms have passed, and it does by 250', () => {
    const seen = []
    render(<FormulaField value="sma(close, 20)" onChange={() => {}} onEvaluated={(r) => seen.push(r.source)} />)
    act(() => { vi.advanceTimersByTime(249) })
    expect(seen, 'the preview ran early — the settle is shorter than spec §6\'s 250 ms').toEqual([])
    act(() => { vi.advanceTimersByTime(1) })
    expect(seen).toEqual(['sma(close, 20)'])
  })

  it('…and a LONGER settle is refused too — the window is an equality, not a floor', () => {
    // A one-sided check passes against a debounce of ten seconds, which is a
    // preview that never arrives.
    const seen = []
    render(<FormulaField value="close" onChange={() => {}} onEvaluated={(r) => seen.push(r.source)} />)
    act(() => { vi.advanceTimersByTime(250) })
    expect(seen).toEqual(['close'])
  })
})

// ─── 7. REACHABILITY IN A BROWSER — THE CSS ARTIFACT, BOTH DIRECTIONS ───────

describe('the controls are reachable by a real pointer', () => {
  // ⚠️ A jsdom `click()` PROVES NOTHING ABOUT BROWSER REACHABILITY. jsdom does
  // not implement hit-testing, so `fireEvent.click` dispatches on an element no
  // pointer could reach. `.legend` is `pointer-events: none` one directory over
  // and the property INHERITS — a button once shipped literally un-clickable
  // while twenty-three click-based tests stayed green. The only honest evidence
  // is the CSS ARTIFACT, and it has to be read in both directions.
  const CSS_FILES = [
    'app/src/components/chart/builder/BuilderSheet.module.css',
    // The ONLY ancestor chain this sheet has: `Sheet` portals to `document.body`
    // and renders `.backdrop > .panel > .body`, so nothing else can inherit into
    // it.
    'app/src/components/mobile/Sheet.module.css',
  ]

  /** Every `pointer-events` DECLARATION and its value, comments removed. */
  const pointerEventRules = (css) => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
    return [...stripped.matchAll(/pointer-events\s*:\s*([a-z-]+)/g)].map((m) => m[1])
  }

  it("⛔ NOTHING on the builder's ancestor chain sets `pointer-events: none`", () => {
    for (const rel of CSS_FILES) {
      const found = pointerEventRules(read(rel))
      expect(found, `${rel} declares pointer-events: ${found.join(', ')}`).toEqual([])
    }
  })

  it('…and the scan CAN find one — the positive control, plus the comment case', () => {
    expect(pointerEventRules('.legend { color: red; pointer-events: none; }')).toEqual(['none'])
    // It ignores one written in a COMMENT, which is the half a grep gets wrong
    // in the direction that fails a clean file — and BOTH files above discuss
    // the property in prose.
    expect(pointerEventRules('/* never pointer-events: none here */ .a { color: red }')).toEqual([])
    // The subject really does contain the prose, so the comment control is not
    // hypothetical.
    expect(read(CSS_FILES[0])).toContain('pointer-events')
  })

  it('every interactive class declares the 44 px touch target', () => {
    const css = read(CSS_FILES[0])
    for (const cls of ['field', 'nameField', 'ghostBtn', 'saveBtn', 'ack', 'listRow']) {
      const block = css.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`))
      expect(block, `.${cls} has no rule at all`).toBeTruthy()
      expect(block[1], `.${cls} does not reserve --tap-min`).toContain('min-height: var(--tap-min)')
    }
  })

  it('the disabled Save uses the ATTRIBUTE, never `pointer-events`', () => {
    // The disabled attribute is what refuses the click; a `pointer-events` rule
    // would inherit into the label and be the un-clickable-button defect itself.
    const rule = read(CSS_FILES[0]).match(/\.saveBtn:disabled\s*\{([^}]*)\}/)
    expect(rule).toBeTruthy()
    expect(rule[1]).not.toContain('pointer-events')
    expect(rule[1]).toContain('cursor')
  })

  it("the builder's CSS uses ONLY the canonical 640 / 1024 breakpoints", () => {
    const css = read(CSS_FILES[0]).replace(/\/\*[\s\S]*?\*\//g, '')
    const widths = [...css.matchAll(/\((?:max|min)-width:\s*(\d+)px\)/g)].map((m) => m[1])
    expect(widths.length).toBeGreaterThan(0)
    expect([...new Set(widths)].sort()).toEqual(['640'])
  })

  it('layout is CSS `@media`, never `useMediaQuery` — which is stale at first paint', () => {
    const jsx = read('app/src/components/chart/builder/BuilderSheet.jsx')
      + read('app/src/components/chart/builder/FormulaField.jsx')
    expect(/useMediaQuery|useIsPhone|useIsTouch|useBreakpoint/.test(jsx.replace(/\/\/[^\n]*/g, ''))).toBe(false)
    expect(read(CSS_FILES[0])).toContain('@media (max-width: 640px)')
  })

  it('the builder is NOT inside the class the parity gate blinds', () => {
    // `ChartRender.jsx` injects `#chart-export [class*="legend" i]{display:none}`
    // into the only route `tools/chart_parity.py` photographs. That is why this
    // surface owes no pixel of its own — and it is also a rule: a control named
    // `…legend…` here would be invisible in the export as well as unreachable.
    const src = read('app/src/components/chart/builder/BuilderSheet.jsx')
      + read('app/src/components/chart/builder/FormulaField.jsx')
    expect(/styles\.[A-Za-z]*[Ll]egend/.test(src)).toBe(false)
    expect(/^\s*\.[A-Za-z]*[Ll]egend/m.test(read(CSS_FILES[0]))).toBe(false)
  })
})

// ─── 8. THE FOCUS TRAP THIS SHEET BUILDS FOR ITSELF ─────────────────────────

describe('focus is trapped inside the panel', () => {
  // ⚠️ `Sheet` SHIPS NO TRAP — measured, and both the plan and this task's brief
  // claim otherwise. It focuses the panel on open, handles Escape, locks body
  // scroll and restores focus on close; nothing stops Tab walking out.
  //
  // ⚠️ AND `userEvent.tab()` IGNORES A TRAP'S `preventDefault` — a focus test
  // passed against a broken trap on this branch. `fireEvent` is what observes
  // the handler's own decision.
  const ring = () => [...document.querySelector('[role="dialog"]')
    .querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),'
      + 'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]

  it('`Sheet` itself ships no trap — the premise, asserted rather than assumed', () => {
    expect(/Tab/.test(read('app/src/components/mobile/Sheet.jsx'))).toBe(false)
  })

  it('Tab from the LAST control wraps to the first, and Shift+Tab from the first to the last', async () => {
    mount()
    await typeFormula('sma(close, 20)')
    await nameIt()
    const items = ring()
    expect(items.length).toBeGreaterThan(3)
    const [first, last] = [items[0], items[items.length - 1]]

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    first.focus()
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('a MIDDLE control is left alone — the trap wraps, it does not capture', async () => {
    // The control that says the trap is a RING and not a cage. Without it, a
    // handler that called `preventDefault()` on every Tab would pass the case
    // above and make the whole form un-tabbable.
    mount()
    await typeFormula('sma(close, 20)')
    await nameIt()
    const items = ring()
    const middle = items[Math.floor(items.length / 2)]
    expect(middle).not.toBe(items[0])
    expect(middle).not.toBe(items[items.length - 1])
    middle.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    middle.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(middle)
  })

  it('Tab from the PANEL itself enters the ring rather than leaving the modal', async () => {
    mount()
    await typeFormula('sma(close, 20)')
    const panel = document.querySelector('[role="dialog"]')
    panel.focus()
    fireEvent.keyDown(panel, { key: 'Tab' })
    expect(ring()).toContain(document.activeElement)
  })
})

// ─── 9. THE ENTRY POINT ─────────────────────────────────────────────────────

/**
 * 🔴 THIS RAIL USED TO COUNT `<BuilderSheet` WITH A REGEX OVER THE RAW FILE,
 * AND A COMMENT REDDED IT — which is not a hypothetical: `ChartToolbar.jsx`
 * carries a paragraph that has to explain, in prose, that it must not spell the
 * JSX tag, or the rail reports a second mount. The source was contorted to
 * please a broken probe.
 *
 * ⛔ AND THE FAILURE IS WORSE THAN NOISE, because of how it reads. "2 mounts
 * expected 1" tells the next engineer *"you added a second mount"* — a true
 * sentence about a file where nothing was added — so the fix they reach for is
 * deleting a mount that does not exist, or deleting the comment that explains
 * why it must not be deleted. `lesson_probe_names_must_be_derived_not_typed`:
 * **verify with an AST, never a grep.**
 *
 * The three claims below are the same three the regex was standing in for,
 * asserted against the parse tree instead of the bytes.
 */
const toolbarTree = () => JSXParser.parse(read('app/src/components/chart/ChartToolbar.jsx'),
  { ecmaVersion: 'latest', sourceType: 'module' })

function walkAst(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach(c => walkAst(c, fn))
    else if (v && typeof v.type === 'string') walkAst(v, fn)
  }
}

/** Every real `<Name …>` ELEMENT in a tree. Comments are not in the AST at all,
 *  which is the entire point. */
function jsxMountsOf(tree, name) {
  const found = []
  walkAst(tree, (n) => {
    if (n.type === 'JSXElement' && n.openingElement?.name?.name === name) found.push(n)
  })
  return found
}

/** Is `node` inside a `<guard> && …` short-circuit? */
function guardedBy(tree, node, guard) {
  let guarded = false
  walkAst(tree, (n) => {
    if (n.type !== 'LogicalExpression' || n.operator !== '&&') return
    let mentionsGuard = false
    walkAst(n.left, (m) => {
      if (m.type === 'Identifier' && m.name === guard) mentionsGuard = true
    })
    if (!mentionsGuard) return
    walkAst(n.right, (m) => { if (m === node) guarded = true })
  })
  return guarded
}

describe('the one entry point', () => {
  it('`ChartToolbar` mounts the builder behind the SAME pair the library uses', () => {
    const src = read('app/src/components/chart/ChartToolbar.jsx')
    expect(src).toContain("import BuilderSheet from './builder/BuilderSheet'")

    const tree = toolbarTree()
    const mounts = jsxMountsOf(tree, 'BuilderSheet')
    expect(mounts, 'the builder is mounted somewhere other than exactly once')
      .toHaveLength(1)

    // A read-only chart passes no `onUpdateSettings`, so `canManageIndicators`
    // is false and no author surface exists (spec §5's mount-site scoping).
    expect(guardedBy(tree, mounts[0], 'canManageIndicators'),
      'the builder mount escaped its `canManageIndicators &&` guard — a chart '
      + 'with no `onUpdateSettings` now sprouts an authoring surface').toBe(true)
  })

  it('the launcher is WIRED, not merely named — passed down and bound back', () => {
    // ⛔ REPLACES `(src.match(/onOpenFormulaBuilder/g)||[]).length === 3`. That
    // number was a proxy for three RELATIONSHIPS (the panel's prop, its
    // onClick, the toolbar's binding); a hand-typed count beside the thing it
    // describes is this repo's most-repeated defect, and it counted comments.
    const tree = toolbarTree()
    let declared = false   // the toolbar receives it
    let passedDown = false // …and hands it to the panel as a prop
    let invoked = false    // …and something calls it
    walkAst(tree, (n) => {
      if (n.type === 'Property' && n.key?.name === 'onOpenFormulaBuilder') declared = true
      if (n.type === 'JSXAttribute' && n.name?.name === 'onOpenFormulaBuilder') passedDown = true
      // ⚠️ THE CALL IS OPTIONAL (`onOpenFormulaBuilder?.()`), so acorn wraps it
      // in a `ChainExpression` and the callee is a bare Identifier — not the
      // MemberExpression shape a first guess reaches for. Both are accepted.
      if (n.type === 'CallExpression'
          && (n.callee?.name === 'onOpenFormulaBuilder'
              || n.callee?.property?.name === 'onOpenFormulaBuilder')) invoked = true
    })
    expect(declared, '`onOpenFormulaBuilder` is not a declared prop of ChartToolbar').toBe(true)
    expect(passedDown, '`onOpenFormulaBuilder` is never handed to a child — the '
      + 'settings panel cannot open the builder').toBe(true)
    expect(invoked, '`onOpenFormulaBuilder` is passed but never called').toBe(true)
  })

  // ── the controls: a rail nobody has seen fire is not a rail ────────────────

  it('🔴 A COMMENT NAMING THE TAG NO LONGER REDS IT', () => {
    // The exact regression. `ChartToolbar.jsx` really does discuss the mount in
    // prose, and under the old probe that prose was a second mount.
    const withProse = `
      import BuilderSheet from './builder/BuilderSheet'
      export default function T({ canManageIndicators }) {
        /* one sheet, two openers — the <BuilderSheet /> below is the only mount */
        return <>{canManageIndicators && <BuilderSheet open />}</>
      }`
    const tree = JSXParser.parse(withProse, { ecmaVersion: 'latest', sourceType: 'module' })
    const mounts = jsxMountsOf(tree, 'BuilderSheet')
    expect(mounts).toHaveLength(1)
    expect(guardedBy(tree, mounts[0], 'canManageIndicators')).toBe(true)
    // …and the probe the AST replaced would have said two, which is the proof
    // this control is measuring a real difference and not restating itself.
    expect((withProse.match(/<BuilderSheet/g) || []).length).toBe(2)
  })

  it('🔴 A REAL SECOND MOUNT STILL DOES', () => {
    // The other direction. Without this the case above is satisfied by a probe
    // that returns 1 for everything.
    const twice = `
      export default function T({ canManageIndicators }) {
        return <>{canManageIndicators && <BuilderSheet open />}<BuilderSheet open /></>
      }`
    const tree = JSXParser.parse(twice, { ecmaVersion: 'latest', sourceType: 'module' })
    expect(jsxMountsOf(tree, 'BuilderSheet')).toHaveLength(2)
  })

  it('🔴 AN UNGUARDED MOUNT STILL DOES', () => {
    const bare = `
      export default function T() { return <BuilderSheet open /> }`
    const tree = JSXParser.parse(bare, { ecmaVersion: 'latest', sourceType: 'module' })
    const mounts = jsxMountsOf(tree, 'BuilderSheet')
    expect(mounts).toHaveLength(1)
    expect(guardedBy(tree, mounts[0], 'canManageIndicators')).toBe(false)
  })
})

// ─── 10. THE EVALUATOR ITSELF ───────────────────────────────────────────────

describe('evaluateFormula', () => {
  it('never throws, for anything', () => {
    const junk = ['', '   ', 'sma(', ')(', '$$$', 'close =', '[1,2][0]', 'this', 'a;b',
      'close.length', 'foo()', '1e400', 'sma(close, -1)', String.fromCharCode(0)]
    for (const s of junk) expect(() => evaluateFormula(s), s).not.toThrow()
    for (const s of [null, undefined, 42, {}, []]) expect(() => evaluateFormula(s)).not.toThrow()
  })

  it('reports the FIRST admissibility failure, and the doors answer in order', () => {
    // `sma(close, 600)` is over the lookback cap AND has a perfectly good
    // read-back; the budget is the door that must answer, and the answer is the
    // budget's own.
    expect(evaluateFormula('sma(close, 600)').guard).toBe('budget:lookback')
    expect(checkBudget(parseFormula('sma(close, 600)').ast, undefined).guard).toBe('budget:lookback')
    // …a computed window is refused by the guard that OWNS windows, not by the
    // read-back that also cannot spell it.
    expect(evaluateFormula('sma(close, 5 + 5)').guard).toBe('resolve:window')
  })

  it('an empty box is not an error — it is an empty box', () => {
    const r = evaluateFormula('')
    expect(r.ok).toBe(false)
    expect(r.error).toBeNull()
    expect(r.empty).toBe(true)
  })
})

// ─── 🔴 THE BUILDER ADDS AN INSTANCE ON SAVE (PHASE D TASK 16) ──────────────
//
// Task 11 deliberately did NOT, and measured why: nothing installed a user
// definition into the registry the binder resolves through, so an instance
// written here would name a definition `getDefinition` answered null for and
// `normalizeInstances` would drop it on the very next paint. `installUserDefinitions`
// closes that, so the write is now honest — and these cases are what make
// "honest" a thing that can fail.

describe('🔴 saving a formula puts it ON THE CHART', () => {
  /** Mount with the settings pair `ChartToolbar` passes, recording every write. */
  function mountWithChart({ settings = { indicators: {}, indicatorInstances: [] } } = {}) {
    const writes = []
    const utils = render(
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet
            open
            onClose={() => {}}
            onSaved={() => {}}
            settings={settings}
            onChange={(next) => writes.push(next)}
          />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    return { ...utils, writes }
  }

  afterEach(() => { clearUserDefinitions() })

  it('installs the STORED definition and writes ONE instance naming the STORE\'s id', async () => {
    // ⛔ THE SERVER MINTS THE ID. `draftDefId()` is a placeholder that exists only
    // so the document can be validated before it is sent; the store overwrites it
    // (`user_definitions.create_definition` sets `definition["id"] = def_id`). An
    // instance naming the draft would be dropped by `normalizeInstances` on the
    // next paint — the defect this task closes, re-created one field over.
    const { writes } = mountWithChart()
    await typeFormula('sma(close, 20)')
    await nameIt('My line')
    await act(async () => { fireEvent.click(saveBtn()) })
    await flush()

    expect(getDefinition('u_aaaaaaaaaaaa'),
      'the saved definition did not install — an instance for it would be dropped').toBeTruthy()
    expect(writes, 'no settings write — the formula saved and the chart never heard about it')
      .toHaveLength(1)

    const list = writes[0].indicatorInstances
    expect(list).toHaveLength(1)
    expect(list[0].defId, 'the instance names the DRAFT id, not the one the store minted')
      .toBe('u_aaaaaaaaaaaa')

    // ⭐ AND THE INSTANCE IS ONE `normalizeInstances` KEEPS. This is the whole
    // claim: a control that writes an instance the renderer drops is the "live
    // control that writes nowhere" defect wearing a success message.
    const norm = normalizeInstances(list, engineRegistry)
    expect(norm.dropped.map(d => d.reason)).toEqual([])
    expect(norm.kept).toHaveLength(1)
  })

  it('⛔ writes NOTHING when the store REFUSES the save', async () => {
    // The instance must not exist for a definition the store never took. Writing
    // one would put a formula on the chart that no reload can bring back.
    const { writes } = mountWithChart()
    H.writeResponse = { ok: false, status: 400, json: async () => ({ detail: 'nope' }) }
    await typeFormula('sma(close, 20)')
    await nameIt('My line')
    await act(async () => { fireEvent.click(saveBtn()) })
    await flush()

    expect(screen.getByTestId('store-error')).toBeTruthy()
    expect(writes, 'the chart was written for a formula the store refused').toEqual([])
  })

  it('⛔ writes NOTHING, and SAYS SO, when the definition cannot INSTALL', async () => {
    // A definition the store accepts and the registry refuses — here because a
    // SHIPPED id already owns the name the store handed back. The save stands;
    // the instance does not; and the refusal reaches the user rather than being
    // swallowed into a success message. ⚠️ Silence here is indistinguishable
    // from a save that worked, which is the failure mode this whole phase exists
    // to retire.
    const { writes } = mountWithChart()
    H.writeResponse = { ok: true, status: 200, json: async () => ({ def_id: 'rsi', version: 1, rev: 1 }) }
    await typeFormula('sma(close, 20)')
    await nameIt('My line')
    await act(async () => { fireEvent.click(saveBtn()) })
    await flush()

    expect(writes).toEqual([])
    expect(screen.getByTestId('store-error').textContent)
      .toMatch(/a SHIPPED definition already owns this id/)
    // …and the shipped definition really is untouched.
    expect(getDefinition('rsi').compute.kind).toBe('native')
  })

  it('a READ-ONLY mount still saves and still refuses to touch a chart it has no handle on', async () => {
    // `ChartToolbar` renders the builder only behind `chartSettings &&
    // onUpdateSettings`, so this pair is never half-present in the product — but
    // the component must not assume it. Without the guard this throws inside the
    // save and the user loses the formula they just wrote.
    const writes = []
    render(
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={() => {}} onSaved={() => {}} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    await typeFormula('sma(close, 20)')
    await nameIt('My line')
    await act(async () => { fireEvent.click(saveBtn()) })
    await flush()

    expect(screen.getByTestId('saved-note')).toBeTruthy()
    expect(writes).toEqual([])
    // The definition still installs: it is this TAB's registry, and the sheet
    // may be mounted beside a chart that is about to read it.
    expect(getDefinition('u_aaaaaaaaaaaa')).toBeTruthy()
  })

  it('⛔ THE COMMENT THAT WAS FALSIFIED IS REWRITTEN IN THE PAST TENSE, NOT DELETED', () => {
    // B5 Task 4's rule, applied to the paragraph this task made false. Task 11's
    // refusal was a MEASUREMENT and it is the reason the wiring is in the order
    // it is in; deleting it would leave the next reader asking why the install
    // happens between the store write and the instance write.
    const src = read('app/src/components/chart/builder/BuilderSheet.jsx')
    expect(src, 'the falsified paragraph was deleted rather than inverted')
      .toContain('IT ADDS AN INSTANCE TO THE CHART ON SAVE')
    expect(src).toContain('UNTIL\n// TASK 16 IT DELIBERATELY DID NOT')
    // The quoted original, verbatim enough to be recognisable as the old claim.
    expect(src).toContain('an instance written here would validate against a definition the renderer')
    expect(src).toContain('cannot resolve and be DROPPED on the next paint')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// PHASE D TASK 13 — THE AI DOOR IS MOUNTED ON THIS SHEET.
// ═══════════════════════════════════════════════════════════════════════════
//
// `ConciergeBox.jsx` shipped complete: a documented prop contract, a
// derived-from-the-tree read-back, and twelve of its own green cases. It had
// ZERO non-test importers. `BuilderSheet` — the one surface that could host it,
// and the one `ChartToolbar` mounts — imported `FormulaField` and nothing from
// `ConciergeBox`, so `POST /api/user-definitions/propose` (cost-guarded,
// `MAX_MODEL_CALLS = 2`) had no product caller and "describe an indicator in
// English" existed on no screen in the product.
//
// ⛔ SO EVERY CASE HERE DRIVES THE BOX **THROUGH THE SHEET**. Rendering
// `ConciergeBox` on its own is what `ConciergeBox.test.jsx` already does twelve
// times, and all twelve stayed green for the entire time the feature was
// unreachable. These fail if the mount is removed while both components remain
// perfectly correct — which is the only thing that distinguishes a wiring test
// from a component test.

describe('the AI door is reachable FROM the builder (Task 13)', () => {
  // DERIVED: the tree, the read-back and the badge all come from the shipped
  // evaluator, so a renamed function or a reworded sentence can never leave this
  // asserting against a formula the parser would refuse.
  const PROPOSED_SOURCE = 'sma(close, 20)'
  const PROPOSED = evaluateFormula(PROPOSED_SOURCE)

  /** A server `sentence` that is fluent, plausible, and about a DIFFERENT
   *  indicator. The box is contracted to ignore it; the sheet must show the
   *  tree's read-back, which is the same claim one hop further out. */
  const LIE = 'a nine-bar momentum oscillator of the high'

  const englishBox = () => screen.getByLabelText(/plain English/i)
  const draftBtn = () => screen.getByRole('button', { name: /draft a formula/i })
  const useBtn = () => screen.getByRole('button', { name: /use this formula/i })

  async function draft(prompt = 'the twenty bar average of the close') {
    H.writeResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        ast: PROPOSED.ast,
        source: PROPOSED_SOURCE,
        repaint: PROPOSED.verdict.mode,
        sentence: LIE,
      }),
    }
    fireEvent.change(englishBox(), { target: { value: prompt } })
    await act(async () => { fireEvent.click(draftBtn()) })
    await flush()
  }

  it('⭐ the box is mounted INSIDE the sheet, above the typed field', async () => {
    mount()
    await flush()
    const panel = document.querySelector('[role="dialog"]')
    const box = screen.getByTestId('concierge-box')
    // `panel.contains` is the whole claim: an importable component that nothing
    // renders satisfies every other assertion in this file.
    expect(panel.contains(box)).toBe(true)
    expect(box.compareDocumentPosition(field()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('⭐ drafting from the sheet issues the REAL propose request', async () => {
    // ⚠️ NO `fetchImpl`. The box's injection point is for tests only, and
    // `lesson_injected_dependency_hides_the_fetch` is precisely the trap: 996
    // green tests once shipped a feature that ran in 0 of 24 charts because
    // every test handed in a fake. The sheet passes no fake, so this observes
    // the request that actually leaves.
    mount()
    await draft()
    const propose = H.requests.filter(r => r.url.includes('/api/user-definitions/propose'))
    expect(propose, 'the sheet issued no propose request — the AI door is not wired')
      .toHaveLength(1)
    expect(propose[0].method).toBe('POST')
    expect(JSON.parse(propose[0].body).prompt).toBe('the twenty bar average of the close')
  })

  it('⭐⭐ accepting a proposal lands in the SHEET\'S OWN formula state', async () => {
    mount()
    await draft()
    expect(screen.getByTestId('concierge-proposal')).toBeTruthy()

    await act(async () => { fireEvent.click(useBtn()) })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS) })
    await flush()

    // The accepted source is in the field the user types in — so the proposal
    // goes through the SAME parse, budget walk, linter and read-back a typed
    // formula does. Handing `body.ast` straight to `buildDefinition` would be a
    // second write path with a second set of gates to keep in step.
    expect(field().value).toBe(PROPOSED_SOURCE)
    expect(screen.getByTestId('readback')).toHaveTextContent(PROPOSED.readback)
    expect(screen.getByTestId('repaint-badge').getAttribute('data-mode')).toBe(PROPOSED.verdict.mode)
    // …and the server's sentence reached no pixel, one hop further out than
    // `ConciergeBox.test.jsx` can assert it.
    expect(screen.queryByText(LIE)).toBeNull()
    // Save is still the user's decision: the name is still empty.
    expect(saveBtn()).toBeDisabled()
  })

  it('⛔ THE BOX STILL NEVER SAVES — accepting writes nothing', async () => {
    // The reason it is worth mounting at all: `onAccept` fills a text field and
    // the ordinary Save button does the writing, through the one store door.
    mount()
    await draft()
    await act(async () => { fireEvent.click(useBtn()) })
    await flush()
    const writes = H.requests.filter(r => r.method !== 'GET' && !r.url.includes('/propose'))
    expect(writes, 'accepting a proposal wrote a definition — the concierge has become a second write path')
      .toEqual([])
  })
})
