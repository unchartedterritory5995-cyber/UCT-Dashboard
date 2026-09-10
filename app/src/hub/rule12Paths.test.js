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

/**
 * ⭐ INCREMENT 4's ONE PERMITTED EXCEPTION (R-18).
 *
 * The observation window is over and the notebook workstream flipped its flag, so the owner
 * permits exactly ONE notebook-side edit: the grid note card's root carries its note id, which is
 * what lets the hub say WHICH card the cursor is on. Everything else under the prefix is still
 * forbidden, and NotebookTab.jsx has no exception at all.
 *
 * ⛔ THE EXCEPTION IS A FILE *AND* A SHAPE. An allowance keyed only on the filename would let any
 * future change to NoteCard.jsx through under a rule that was written for one attribute — the
 * "exemption widens silently" defect. So the diff itself is checked: every added line must be an
 * existing line with exactly this attribute inserted, and nothing else may change.
 */
const PERMITTED_FILE = 'app/src/pages/journal-2-0/components/notebook/NoteCard.jsx'
const PERMITTED_INSERT = ' data-note-card-id={note.id}'

// ⛔ EVERY GIT CALL RUNS AT THE REPO ROOT. vitest's cwd is `app/`, and git resolves a PATHSPEC
// relative to the cwd — so `git diff -- app/src/...` from `app/` looks for `app/app/src/...`,
// matches nothing, and returns an EMPTY diff. The shape check below then compared zero added
// lines against zero removed lines and passed a real off-shape edit. Its own mutation proof is
// what caught it. `-C` removes the whole class.
const gitRaw = (args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim()
const REPO_ROOT = gitRaw(['rev-parse', '--show-toplevel'])
const git = (args) => gitRaw(['-C', REPO_ROOT, ...args])

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

  it('⛔ no file under the Notebook workstream\'s paths is touched, except the one permitted card', () => {
    const { ref, sha } = mergeBase()
    const offenders = changedPaths()
      .filter((f) => f.startsWith(FORBIDDEN_PREFIX))
      .filter((f) => f !== PERMITTED_FILE)
    expect(
      offenders,
      'RULE 12 VIOLATION — this branch touches files the Notebook workstream owns beyond the one permitted card. ' +
      `Base ${ref} (${sha.slice(0, 9)}). Offending paths:\n` +
      `  ${offenders.join('\n  ')}\n` +
      'The hub integrates through the URL contract as it exists today. Increment 4 permits exactly ' +
      `one notebook-side edit — ${PERMITTED_INSERT.trim()} on ${PERMITTED_FILE} — and nothing else. ` +
      'Any other need is a STOP and a report to the owner, not an edit.',
    ).toEqual([])
  })

  it('⛔ the permitted file may ONLY gain the attribute — the exception is a shape, not a filename', () => {
    const { sha } = mergeBase()
    const committed = git(['diff', '-U0', `${sha}..HEAD`, '--', PERMITTED_FILE])
    const working = git(['diff', '-U0', 'HEAD', '--', PERMITTED_FILE])
    const lines = (committed + '\n' + working).split('\n')
    const added = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    const removed = lines.filter((l) => l.startsWith('-') && !l.startsWith('---'))

    // Each added line must be its removed counterpart with exactly the attribute inserted. That
    // pairs them 1:1 and rejects an added line carrying anything else along with it.
    expect(added.length, 'added and removed lines do not pair 1:1').toBe(removed.length)
    const unexplained = added.filter((a, i) => (
      a.slice(1).replace(PERMITTED_INSERT, '') !== removed[i].slice(1)
    ))
    expect(
      unexplained,
      `RULE 12 — ${PERMITTED_FILE} may ONLY gain "${PERMITTED_INSERT.trim()}". These changed lines are something else:\n  ` +
      unexplained.join('\n  '),
    ).toEqual([])
  })
})
