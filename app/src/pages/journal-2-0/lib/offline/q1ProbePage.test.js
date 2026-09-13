/**
 * ⚰️ THE PROBE PAGE MUST PARSE, AND THIS EXISTS BECAUSE IT DID NOT.
 *
 * `app/public/q1-probe.html` is the Wave Q1 browser certification instrument.
 * It shipped to production with a SyntaxError: a `'\n'` written through a shell
 * heredoc arrived as a literal newline inside a single-quoted JavaScript string,
 * so the entire script failed to compile.
 *
 * What that cost is the point. The page still rendered — the heading, the copy,
 * the button, all of it — so it looked completely healthy. A real iPhone 15 on
 * iOS 17.5 loaded it, the Run button was tapped twice, and NOTHING happened:
 * no error banner, no console the operator could see, just a page that sat
 * there. The same broken page was handed to Firefox and WebKit, which reported
 * "probe did not finish" — a sentence that reads like a browser limitation and
 * was actually our own typo. A certification instrument that cannot run is
 * worse than none, because its silence is indistinguishable from a finding.
 *
 * ⛔ So: parse the deployed artifact, not a copy of it, on every suite run.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PAGE = path.resolve(HERE, '../../../../../public/q1-probe.html')

const scriptOf = (html) => {
  const m = html.match(/<script>([\s\S]*?)<\/script>/)
  return m ? m[1] : null
}

describe('the Q1 browser probe page', () => {
  it('exists where the route serves it from', () => {
    expect(fs.existsSync(PAGE)).toBe(true)
  })

  it('⛔ its script COMPILES', () => {
    const src = scriptOf(fs.readFileSync(PAGE, 'utf8'))
    expect(src).toBeTruthy()
    // `new Function` parses without executing — exactly the check the browser
    // makes before anything on the page can work.
    expect(() => new Function(src)).not.toThrow()
  })

  it('⭐ and the check can actually fail — a broken script is rejected', () => {
    // THE CONTROL, and it is the same defect verbatim: a literal newline inside
    // a single-quoted string. Without this, a rail that only ever sees valid
    // input proves nothing about its own sensitivity.
    const broken = "var s = 'oops\nstill in the string';"
    expect(() => new Function(broken)).toThrow()
  })

  it('names no real Notebook database in any CODE it runs', () => {
    // The page's delete helper refuses names outside its prefix at runtime;
    // this pins that no literal ever tempts anyone to loosen it. Comments may
    // (and do) name `uct_notebook_<account>` — saying what must never be
    // touched is the point of them — so the check is on executable lines.
    const src = scriptOf(fs.readFileSync(PAGE, 'utf8')) || ''
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    expect(code).not.toMatch(/uct_notebook/)
    expect(code).toMatch(/uct_q1_browser_probe/)
  })
})
