// app/src/components/chart/builder/PineBox.editor.test.jsx
//
// ─── ⚰️ A PINE-AWARE EDITOR, BUILT AND TESTED, MOUNTED BY NOTHING ────────────
//
// `editor/languages.js` defines `pineLanguage` off `PINE_CALL_SHAPES` and
// `languageFor` answers `case 'pine'`. `editor/CodeEditor.test.jsx` already
// mounts the editor with `dialect: 'pine'`. And the only production caller was
// `FormulaField`, which passes
//
//     dialect={result && result.dialect === 'pcf' ? 'pcf' : 'formula'}
//
// so `'pine'` could never be the value. The Pine authoring surface — the box a
// member writes their screener in — stayed a bare `<textarea rows={8}>` while a
// Pine-aware editor with a refusal gutter sat one import away, green.
//
// ⛔ THE TEXTAREA IS NOT REPLACED. It stays as the value carrier and the
// fallback, hidden once the chunk lands — `FormulaField`'s own arrangement, and
// the reason every existing rail that types into `pine-box textarea` still
// works. A failed chunk load is the textarea, not a reload.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'

import PineBox, { ImportBox, PINE_DEBOUNCE_MS, inspectSource } from './PineBox'
import { Text } from '@codemirror/state'
import { toDiagnostics } from './editor/diagnostics'

const PINE = `//@version=6
indicator("s")
plot(ta.rsi(close, 14) < 30 ? 1 : 0)
`
const THINK = `plot scan = close > Average(close, 50);
`
const REFUSING = `//@version=6
indicator("s")
plot(ta.supertrend(3, 10) > 0 ? 1 : 0)
`

const noop = () => {}
beforeEach(() => { vi.useRealTimers() })
afterEach(() => { cleanup() })

const box = () => screen.getByTestId('pine-box')
const area = () => box().querySelector('textarea')

async function type(text) {
  fireEvent.change(area(), { target: { value: text } })
  await act(async () => { await new Promise((r) => setTimeout(r, PINE_DEBOUNCE_MS + 20)) })
}

describe('the Pine box mounts the editor that was already built for it', () => {
  it('⭐⭐ the editor appears, and it is told the PINE language', async () => {
    render(<PineBox onPick={noop} />)
    await type(PINE)
    const editor = await screen.findByTestId('pine-editor', {}, { timeout: 5000 })
    expect(editor).toBeInTheDocument()
    // ⭐ `data-dialect` is CodeEditor's own attribute, so this reads what the
    // component was actually handed rather than what this test hoped for.
    expect(editor.getAttribute('data-dialect')).toBe('pine')
  })

  it('⭐ the DETECTED dialect is what it gets — thinkScript is not called Pine', async () => {
    // ⛔ NOT A SECOND `detectDialect`. `seen` is the report's own answer, so the
    // language the editor highlights cannot disagree with the door that read it.
    render(<ImportBox onPick={noop} dialect="auto" />)
    await type(THINK)
    await waitFor(async () => {
      const editor = await screen.findByTestId('pine-editor')
      expect(editor.getAttribute('data-dialect')).toBe('thinkscript')
    }, { timeout: 5000 })
  })

  it('⛔⛔ the textarea SURVIVES, hidden — it is still the value carrier', async () => {
    // ⚠️ THE HALF THAT MUST NOT BREAK. Every existing rail in this repo types
    // into `pine-box textarea` and reads its `.value`; replacing it with the
    // editor would have broken 45 files and, worse, changed the surface a
    // member's draft lives on.
    render(<PineBox onPick={noop} />)
    await type(PINE)
    await screen.findByTestId('pine-editor', {}, { timeout: 5000 })
    expect(area()).toBeInTheDocument()
    expect(area().value).toBe(PINE)
    expect(area().getAttribute('aria-hidden')).toBe('true')
    expect(area().getAttribute('tabindex')).toBe('-1')
  })

  it('⭐ one element still answers to the label', async () => {
    // `getByLabelText` throws when two match, which is why the editor takes a
    // suffixed label rather than the same one.
    render(<PineBox onPick={noop} />)
    await type(PINE)
    await screen.findByTestId('pine-editor', {}, { timeout: 5000 })
    expect(screen.getByLabelText('Pine script')).toBe(area())
  })

  it('⭐⭐ the object handed to the gutter carries the STAMP it is gated on', () => {
    // ⚰️ THIS IS THE WIRING THAT WOULD HAVE FAILED SILENTLY. `CodeEditor` marks
    // nothing unless `diagnostics.source === view.state.doc.toString()`, and
    // `inspectSource`'s `stamp` puts `source` on the REFUSAL — not on the report
    // around it. Passing the report reads as correct, compares `undefined`
    // against the document on every render, and leaves the gutter empty forever
    // with no error anywhere to notice.
    // ⛔ `FormulaField` PASSES ITS WHOLE RESULT and is also right, because
    // `evaluateFormula` stamps THAT object. Copying its call without checking
    // which level carries the field is exactly the mistake this pins.
    const report = inspectSource(REFUSING, 'auto')
    expect(report.ok).toBe(false)
    expect(report.source, 'the REPORT is not the stamped object').toBeUndefined()
    expect(report.refusal.source, 'the refusal lost its stamp').toBe(REFUSING)
    // ⭐ AND THE SHIPPED RANGE-BUILDER ACCEPTS IT — asked the way the mount asks,
    // through a document object rather than a bare string.
    const doc = Text.of(REFUSING.split(String.fromCharCode(10)))
    const marks = toDiagnostics(doc, report.refusal)
    expect(marks.length).toBe(1)
    expect(marks[0].severity).toBe('error')
    expect(marks[0].message).toContain('ta.supertrend')
    expect(marks[0].to).toBeGreaterThan(marks[0].from)
  })
})
