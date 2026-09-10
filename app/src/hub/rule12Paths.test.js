/**
 * RULE 12 — this branch must not edit the Notebook workstream's files.
 *
 * ⛔ WHY A RAIL AND NOT A PROMISE. That workstream is in a 2026-09-10 -> 2026-09-17 observation
 * window and pushes to master many times a day. Increment 3 integrates with the Notebook through
 * the URL contract AS IT EXISTS TODAY; it reads and imports from those files and edits none of
 * them. An edit would land inside someone else's observation window, and the person who made it
 * would not be the person who noticed.
 *
 * ⭐ IT CHECKS THE COMMITTED DIFF *AND* THE WORKING TREE. A working-tree-only check clears a file
 * committed an hour ago — the provenance defect CLAUDE.md records ("Provenance:
 * `git show <sha>:<file>`, never `git status`"). A committed-only check catches the edit at review
 * time instead of the moment it is made. Both halves, so neither gap exists.
 *
 * ⚠️ IT FAILS RATHER THAN SKIPS when git or the base ref cannot be resolved. A rail whose important
 * half is opt-in is how a blind watcher shipped in Increment 2.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'

/** Paths this branch may not modify. The second is subsumed by the first; both are named because
 *  the ruling named both, and the first case below proves the containment rather than assuming it. */
const FORBIDDEN_PREFIX = 'app/src/pages/journal-2-0/'
const FORBIDDEN_FILE = 'app/src/pages/journal-2-0/tabs/NotebookTab.jsx'

const git = (args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim()

/** The base this branch is measured against. Tries the refs a checkout might actually have. */
function mergeBase() {
  const tried = []
  for (const ref of ['origin/master', 'master', 'origin/HEAD']) {
    try {
      return { ref, sha: git(['merge-base', ref, 'HEAD']) }
    } catch (e) {
      tried.push(`${ref}: ${String(e.message || e).split('\n')[0]}`)
    }
  }
  throw new Error(
    'RULE 12 RAIL CANNOT RUN — no base ref resolved, so the forbidden-path check would pass ' +
    `vacuously. Tried:\n  ${tried.join('\n  ')}`,
  )
}

/**
 * Every path this branch touches: its commits, its uncommitted edits, and its untracked files.
 *
 * ⛔ NO STATUS-PREFIX PARSING. The first version of this rail sliced `git status --porcelain` at a
 * fixed offset and ate the first character off every modified path ("pp/src/..." instead of
 * "app/src/..."), so the forbidden-prefix check could never match and the rail PASSED a real
 * violation. Its own mutation proof is what caught it. These three commands return plain
 * repo-relative paths with nothing to parse.
 */
function changedPaths() {
  const { sha } = mergeBase()
  const committed = git(['diff', '--name-only', `${sha}..HEAD`]).split('\n')
  const tracked = git(['diff', '--name-only', 'HEAD']).split('\n')
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n')
  return [...new Set([...committed, ...tracked, ...untracked].map((f) => f.trim()).filter(Boolean))]
}

describe('rule 12 — the Notebook workstream owns these paths', () => {
  it('the named file is inside the named prefix — containment proved, not assumed', () => {
    expect(FORBIDDEN_FILE.startsWith(FORBIDDEN_PREFIX)).toBe(true)
  })

  it('the rail can actually see this branch\'s changes — the non-vacuity control', () => {
    const { sha } = mergeBase()
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/)
    expect(changedPaths().length, 'the file list came back empty — the rail is looking at nothing')
      .toBeGreaterThan(0)
  })

  it('⛔ no file under the Notebook workstream\'s paths is touched by this branch', () => {
    const { ref, sha } = mergeBase()
    const offenders = changedPaths().filter((f) => f.startsWith(FORBIDDEN_PREFIX))
    expect(
      offenders,
      'RULE 12 VIOLATION — this branch touches files the Notebook workstream owns, and it is in an ' +
      `observation window until 2026-09-17. Base ${ref} (${sha.slice(0, 9)}). Offending paths:\n` +
      `  ${offenders.join('\n  ')}\n` +
      'The hub integrates through the URL contract as it exists today. If the seam needs a change ' +
      'on the notebook side, that is a STOP and a report to the owner, not an edit.',
    ).toEqual([])
  })
})
