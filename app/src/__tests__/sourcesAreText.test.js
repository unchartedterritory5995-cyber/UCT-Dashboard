// A JS/JSX source file with a NUL byte in it is INVISIBLE to review.
//
// This is not a style rail. `binder.js` shipped on this branch with a raw U+0000
// and a raw U+0001 as delimiters inside a template literal (valid UTF-8, valid
// JS, module loads, 444 engine tests green) — and the consequences were entirely
// in the tooling:
//
//   * `git diff` classifies the file as BINARY. The review diff handed to the
//     re-reviewer said "Binary files a/…/binder.js and b/…/binder.js differ" and
//     `--numstat` said `-  -`, so three of that wave's headline fixes landed with
//     NO textual diff at all, in the one file the engine's own header calls "THE
//     ONLY FILE IN THE ENGINE THAT TOUCHES LIGHTWEIGHT-CHARTS". GitHub's PR view
//     shows the same nothing.
//   * ripgrep SKIPS binary files by default, so searching the engine directory
//     for `inputsSignature` — a function defined AND called in that file —
//     returned "No files found". Same for `toPoints`, `guideSpecs`,
//     `createBinder`. An engineer grepping for a binder symbol concludes it does
//     not exist.
//
// Nothing in the test suite could fail on that, because nothing about it is a
// runtime defect. This is the thing that fails on it.
//
// ⚠️ The fix is to write the delimiter as an ESCAPE (`\u0000`), which produces a
// byte-identical runtime string from a pure-ASCII source. Do not "fix" a future
// failure here by deleting the delimiter or by adding `*.js text` to
// `.gitattributes` — the latter placates git and leaves ripgrep blind.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = path.resolve(SRC_DIR, '..')
const REPO_DIR = path.resolve(APP_DIR, '..')

const EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'])

/** Tracked sources under `app/src`, from git — the authority on what is "in the
 *  repo" and therefore on what a reviewer's diff and a grep will cover. */
function trackedSources() {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--', 'app/src'],
    { cwd: REPO_DIR, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 },
  )
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter(rel => EXTS.has(path.extname(rel)))
    .map(rel => path.join(REPO_DIR, rel))
}

/** Fallback for a checkout with no usable git (a tarball, a sandbox). It walks
 *  the same tree rather than skipping — a guard that silently does nothing when
 *  its preferred input is missing is the failure mode this file is about. */
function walkedSources(dir = SRC_DIR, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walkedSources(full, acc)
    else if (EXTS.has(path.extname(entry))) acc.push(full)
  }
  return acc
}

function sourceFiles() {
  try {
    const files = trackedSources()
    if (files.length) return { files, via: 'git ls-files' }
  } catch {
    /* fall through to the walk */
  }
  return { files: walkedSources(), via: 'filesystem walk' }
}

/** Every byte a text file must never contain: the C0 controls minus \t, \n, \r.
 *  U+0000 is the one that makes git call a file binary, but the whole class is
 *  unreviewable and none of them belongs in source. */
function controlBytes(buf) {
  const hits = []
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b < 0x09 || (b > 0x0d && b < 0x20) || b === 0x7f) hits.push({ offset: i, byte: b })
  }
  return hits
}

describe('every JS/JSX source under app/src is TEXT', () => {
  const { files, via } = sourceFiles()

  it('found sources to scan (an empty scan would pass vacuously)', () => {
    expect(files.length, `no sources found via ${via}`).toBeGreaterThan(100)
    // Name the file the rail was written for. If the lister ever stops covering
    // the engine, this fails by name instead of quietly scanning nothing.
    const binder = files.find(f => f.endsWith(path.join('chart', 'engine', 'binder.js')))
    expect(binder, `binder.js not in the ${via} listing`).toBeTruthy()
    expect(statSync(binder).size).toBeGreaterThan(0)
  })

  it('contains no NUL or other C0 control byte', () => {
    const offenders = []
    for (const file of files) {
      const hits = controlBytes(readFileSync(file))
      if (!hits.length) continue
      const rel = path.relative(REPO_DIR, file).replace(/\\/g, '/')
      const buf = readFileSync(file)
      for (const { offset, byte } of hits.slice(0, 4)) {
        const line = buf.subarray(0, offset).toString('utf8').split('\n').length
        offenders.push(
          `${rel}:${line} — 0x${byte.toString(16).padStart(2, '0')} at byte ${offset}`,
        )
      }
    }
    expect(
      offenders,
      offenders.length
        ? 'A control byte makes the file BINARY to git and to ripgrep: its diff reads ' +
          '"Binary files … differ" and a grep for any symbol in it finds nothing. Write the ' +
          'character as an escape (\\u0000) instead — the runtime string is identical.\n  ' +
          offenders.join('\n  ')
        : '',
    ).toEqual([])
  })
})
