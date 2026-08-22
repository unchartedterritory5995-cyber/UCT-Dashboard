// React 19 diffs `dangerouslySetInnerHTML` by OBJECT identity (the props loop
// is `lastProp === nextProp`), so an inline `{{ __html: ... }}` literal
// re-sets the node's entire innerHTML on EVERY re-render — even when the
// string is unchanged. That silently wipes anything an effect put on the
// injected DOM (Morning Wire's feedback controls, the article reader's
// membership stars) and re-parses large payloads per render.
//
// The fix is a memoized object (`useMemo(() => ({ __html }), [html])`).
// This scan fails BY NAME on the next inline literal so the pattern cannot
// quietly return. Proven live: the 2026-08-19 article-reader bug, traced to
// react-dom's updateProperties → setProp with an identical string.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const SRC = path.dirname(fileURLToPath(import.meta.url))
const PATTERN = /dangerouslySetInnerHTML=\s*\{\s*\{/

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.jsx') && !e.name.endsWith('.test.jsx')) out.push(p)
  }
  return out
}

test('no inline {__html} literal reaches dangerouslySetInnerHTML', () => {
  const offenders = walk(SRC)
    .filter((f) => PATTERN.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(SRC, f))
  expect(offenders).toEqual([])
})

test('the scanner can actually see the pattern it polices', () => {
  // Non-vacuity control: an empty offender list must mean "none exist",
  // never "the regex matches nothing".
  expect(PATTERN.test('dangerouslySetInnerHTML={{ __html: html }}')).toBe(true)
  expect(PATTERN.test('dangerouslySetInnerHTML={ { __html: x } }')).toBe(true)
  expect(PATTERN.test('dangerouslySetInnerHTML={bodyHtml}')).toBe(false)
})
