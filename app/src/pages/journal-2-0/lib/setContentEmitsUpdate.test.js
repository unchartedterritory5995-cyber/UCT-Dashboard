/**
 * Wave Q1 — `setContent(body, false)` DOES NOT SUPPRESS `onUpdate` IN TIPTAP v3.
 *
 * In v2 the second argument WAS `emitUpdate`. In v3 it is an options object,
 * destructured as `{ emitUpdate = true, … } = {}` — and `false` is not
 * `undefined`, so the parameter default never applies; the PROPERTY default does,
 * and `emitUpdate` comes out **true**. Four call sites in `NoteEditorPage` were
 * written against the v2 convention, each with a comment asserting the update was
 * suppressed, and each had been feeding `scheduleAutosave` since the v3 upgrade.
 *
 * Two rails, and they fail for different reasons — keep both:
 *
 *  1. the LIBRARY contract, measured against the installed TipTap. If a future
 *     TipTap makes a bare `false` suppress again, this goes red and someone
 *     re-reads this file instead of inheriting a stale belief.
 *  2. the SOURCE contract: no call site may pass a bare boolean. That is the one
 *     that catches a fifth call site written from memory.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const BODY = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

function editorWithUpdateCounter(content) {
  const updates = []
  const holder = {}
  holder.ed = new Editor({
    extensions: buildExtensions(),
    content,
    onUpdate: () => updates.push(1),
  })
  return { ed: holder.ed, updates }
}

describe('the TipTap contract this file exists to pin', () => {
  it('⛔ a bare `false` second argument EMITS — the v2 convention is dead', () => {
    const { ed, updates } = editorWithUpdateCounter(BODY('start'))
    const before = updates.length
    ed.commands.setContent(BODY('changed'), false)
    expect(updates.length).toBe(before + 1)
    ed.destroy()
  })

  it('⭐ `{ emitUpdate: false }` — the v3 form — does suppress', () => {
    const { ed, updates } = editorWithUpdateCounter(BODY('start'))
    const before = updates.length
    ed.commands.setContent(BODY('changed'), { emitUpdate: false })
    expect(updates.length).toBe(before)
    ed.destroy()
  })

  it('⚰️ an editor built EMPTY emits an unprovoked update; one built with content does not', () => {
    // This is the canary's trigger, isolated: `{type:'doc',content:[]}` violates
    // the schema's `block+`, so ProseMirror appends a repair transaction that
    // inserts an empty paragraph — synchronously, inside the constructor.
    const empty = editorWithUpdateCounter({ type: 'doc', content: [] })
    expect(empty.updates.length).toBe(1)
    expect(empty.ed.getJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    empty.ed.destroy()

    // The control: the same construction with real content is silent, so the
    // assertion above is about EMPTINESS and not about construction in general.
    const full = editorWithUpdateCounter(BODY('real prose'))
    expect(full.updates.length).toBe(0)
    full.ed.destroy()
  })
})

/**
 * ⛔ Comments are PROSE, not call sites. This file's own explanation of the
 * defect contains the literal `setContent(body, false)`, and the first version
 * of this rail flagged it — a sweep that cannot tell code from the paragraph
 * describing the code reports its own documentation as the bug, and the way
 * that gets "fixed" is by deleting the explanation.
 */
function stripComments(src) {
  return src
    // ⛔ Blanked, NOT removed: a block comment is replaced by the newlines it
    // spanned. Collapsing them instead shifts every line number after it, and
    // the first version of this rail duly reported the offender at line 447
    // when it was at 1463 — a location a reader cannot act on is not a report.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//')
      // `://` is a URL, not a comment start — the only case that matters here.
      return i >= 0 && line[i - 1] !== ':' ? line.slice(0, i) : line
    })
    .join('\n')
}

/**
 * Every `setContent(…)` call in `src`, with the line it starts on and its LAST
 * argument.
 *
 * ⛔ It walks to the call's OWN closing paren, balancing brackets. A regex with
 * a lazy `[\s\S]*?` reaches across the whole file: the first version of this
 * rail matched from the `setContent(` on line 447 to the `, false)` on line
 * 1479 and reported the offender at 447 — the wrong file location, for a
 * genuinely present defect. A rail that misnames what it found teaches the
 * reader to distrust it.
 */
function setContentCalls(src) {
  const calls = []
  const open = /setContent\s*\(/g
  let m
  // eslint-disable-next-line no-cond-assign
  while ((m = open.exec(src))) {
    const start = m.index + m[0].length
    let depth = 1
    let i = start
    let lastComma = -1
    for (; i < src.length && depth > 0; i += 1) {
      const c = src[i]
      if (c === '(' || c === '[' || c === '{') depth += 1
      else if (c === ')' || c === ']' || c === '}') depth -= 1
      else if (c === ',' && depth === 1) lastComma = i
    }
    if (depth !== 0 || lastComma < 0) continue      // one argument, or unbalanced
    calls.push({
      line: src.slice(0, m.index).split('\n').length,
      lastArg: src.slice(lastComma + 1, i - 1).trim(),
    })
  }
  return calls
}

/** Every `.js`/`.jsx` under journal-2-0, tests excluded. */
function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '__fixtures__') continue
      sourceFiles(full, out)
    } else if (/\.jsx?$/.test(name) && !/\.test\.jsx?$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

describe('the source contract — no call site may pass a bare boolean', () => {
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
  const files = sourceFiles(ROOT)

  it('⭐ the sweep actually reads this wave’s files (non-vacuity control)', () => {
    // A sweep over an empty or wrong directory passes every assertion below.
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => f.endsWith('NoteEditorPage.jsx'))).toBe(true)
  })

  it('⛔ no `setContent(…, true|false)` anywhere under journal-2-0', () => {
    const offenders = []
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'))
      const name = file.split(/[\\/]/).slice(-1)[0]
      for (const call of setContentCalls(src)) {
        if (/^(true|false)$/.test(call.lastArg)) {
          offenders.push(`${name}:${call.line} — setContent(…, ${call.lastArg})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('⭐ the sweep SEES an offender, IGNORES prose, and reports the RIGHT line', () => {
    // Four controls, because they fail for four different reasons: a matcher
    // that finds nothing, a comment-stripper that strips everything, a matcher
    // that flags the correct v3 form, and a matcher whose line number is a
    // guess. Each of those passes the assertion above on its own.
    const bare = setContentCalls(stripComments('editor.commands.setContent(body, false)'))
    expect(bare.map((c) => c.lastArg)).toEqual(['false'])

    expect(setContentCalls(stripComments('/* setContent(body, false) */'))).toEqual([])
    expect(setContentCalls(stripComments('x = 1 // setContent(body, false)'))).toEqual([])

    const ok = setContentCalls('editor.commands.setContent(body, { emitUpdate: false })')
    expect(ok.map((c) => c.lastArg)).toEqual(['{ emitUpdate: false }'])

    // ⛔ The line-attribution control: two calls, far apart, and the offender is
    // the SECOND one. This is the exact shape that misreported 1479 as 447.
    const twoCalls = [
      'a.commands.setContent(first, EMIT_NOTHING)',
      ...Array(40).fill('// filler'),
      'b.commands.setContent(second, false)',
    ].join('\n')
    const found = setContentCalls(stripComments(twoCalls)).filter((c) => /^(true|false)$/.test(c.lastArg))
    expect(found).toHaveLength(1)
    expect(found[0].line).toBe(42)
  })
})
