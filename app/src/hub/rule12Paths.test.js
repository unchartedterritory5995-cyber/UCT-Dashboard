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
 * ⚠️ AS OF 2026-09-10 THE FLAG IS STILL FALSE and the window has not closed; the flip is
 * later tonight IF the evidence carries it. This exception stands on the owner's ruling,
 * not on a flip that has not happened. The owner
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

/**
 * ⛔⛔ WHOSE CHANGE SET IS THIS? — B7, and it decides whether this rail says anything at all.
 *
 * Rule 12 is a JOYSTICK-PROGRAMME rule: this build integrates with the Notebook through the URL
 * contract as it exists today and edits none of its files. So the rail has to fire on joystick
 * work and nowhere else. Fired unconditionally it cannot tell the case it was written for from
 * that case's exact opposite — the Notebook workstream editing its own code — which is
 * `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`, and it cost that workstream a
 * hand-written waiver on every gate it ran between 2026-09-10 and 2026-09-13.
 *
 * ⚰️ The first attempt was `OWNER_BRANCH = 'notebook-primary-platform'`, ONE literal branch name,
 * added by the Notebook workstream on the day it bit them. Right about the mechanism, too narrow
 * by a family: that workstream also ships from `feat/notebook-*`, `hotfix/notebook-*`,
 * `notebook-flip` and `rollback/notebook-*`, and every one of those still tripped.
 *
 * ⭐ THE PRIMARY IDENTIFIER IS THE DIFF, NOT THE BRANCH NAME — a branch name is typed and drifts,
 * a change set is evidence. Measured against this programme's OWN branches the name is by far the
 * weaker signal: `fix/d46-d48-closeout`, `docs/scope-reconciliation`, `launch/closure` and
 * `docs/d45-ruling` are all joystick branches and not one contains the word. Every one of them
 * touches `app/src/hub/` or `docs/plans/joystick/`.
 *
 * ⚠️ THE RESIDUAL HOLE, STATED RATHER THAN HIDDEN: a joystick branch whose name says nothing and
 * whose diff touches ONLY `journal-2-0/` files reads as Notebook work and is scoped out. From a
 * diff alone those two cases are genuinely indistinguishable. The trade is deliberate — the
 * programme is CLOSED, so such a branch is close to hypothetical, while the false positive it
 * replaces was firing on somebody else's gate every day.
 */
const NOTEBOOK_BRANCH = /(^|[/_-])notebook([/_-]|$)/i
const JOYSTICK_BRANCH = /(^|[/_-])(joystick|hub)([/_-]|$)/i

/** Paths the joystick programme owns; a change set touching any of them is joystick work.
 *  ⛔ Every prefix is proved against real tracked files by a rail below. A prefix with a typo
 *  matches nothing, and a list that silently matches nothing is the shape of every vacuous gate
 *  this repo has had to unpick. */
const HUB_OWNED_PREFIXES = [
  'app/src/hub/',
  'docs/plans/joystick/',
  'tools/hub_',
  'scripts/hub',
]

/** ⚰️ 2026-09-24: the six-shard gate writes its manifest under `docs/plans/joystick/gate-runs/`
 *  for EVERY workstream — that directory is where `scripts/gate_shards.py` defaults its output.
 *  A red sweep that recorded its gate there and fixed two Notebook-side test mocks tripped this
 *  rail as a "joystick change set": a gate receipt is shared plumbing, not hub work. Owner
 *  ruling under the red sweep: a path under a SHARED artifact directory identifies nobody.
 *  ⛔ Deliberately narrow — `docs/plans/joystick/` itself still counts; only the gate receipts
 *  are carved out, and a case below proves the carve-out cannot swallow the parent. */
const SHARED_ARTIFACT_PREFIXES = [
  'docs/plans/joystick/gate-runs/',
]
const hubOwned = (f) => HUB_OWNED_PREFIXES.some((p) => f.startsWith(p))
  && !SHARED_ARTIFACT_PREFIXES.some((p) => f.startsWith(p))

const currentBranch = () => {
  try { return git(['rev-parse', '--abbrev-ref', 'HEAD']) } catch { return '' }
}

/**
 * Pure on purpose, so it can be exercised against branches this checkout will never be on.
 *
 * ⛔ ORDER IS LOAD-BEARING. The owning workstream's identification wins over everything else, so
 * a Notebook branch that happens to touch a hub file — this very rail, on the day they patched
 * it — is still scoped out instead of being handed back the false positive it was patched for.
 */
function rule12Applies({ branch, changed }) {
  if (NOTEBOOK_BRANCH.test(branch)) return false
  if (JOYSTICK_BRANCH.test(branch)) return true
  return changed.some(hubOwned)
}

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

/**
 * Prove the git machinery can see SOMETHING, without assuming a branch exists.
 *
 * ⛔ ONE AUTHORITY, SHARED BY EVERY SCOPE-OUT AND CONTROL BELOW. This reasoning existed twice
 * before B7 and the two copies had already begun to differ; `lesson_a_second_authority_over_one_value`
 * is the rule, and a control that drifts from the thing it controls is worse than none.
 *
 * ⭐ THE DISTINCTION IS A POSITIVE IDENTIFICATION, NEVER AN INFERENCE FROM EMPTINESS. "Empty
 * therefore fine" is the blind-watcher shape this file's header refuses. HEAD being BYTE-EQUAL to
 * the merge base is a different, checkable fact: it says this checkout holds no commits the base
 * lacks, so zero changed paths is arithmetic rather than a broken command. On any real branch HEAD
 * differs from the base, so a broken diff still fails here.
 */
function expectMachineryCanSee(why) {
  const { sha } = mergeBase()
  const head = git(['rev-parse', 'HEAD'])

  if (head !== sha) {
    expect(changedPaths().length, `${why} — HEAD is AHEAD of the merge base (${sha.slice(0, 9)}), `
      + 'so this branch has commits and the rail can see none of them. It is looking at nothing '
      + 'and every check that reads this list would pass vacuously.')
      .toBeGreaterThan(0)
    return
  }

  // ⛔ NOT `expect(changedPaths()).toEqual([])`. That was the first attempt and it is wrong: a
  // master checkout routinely carries untracked scratch (this gate writes its own manifest into
  // the tree before anyone commits it), so the assertion failed on a perfectly healthy checkout —
  // swapping one false red for another. Point the machinery at a range that cannot legitimately
  // be empty instead, and the whole chain (git -C at the repo root, the pathspec, the parsing) is
  // exercised without needing a branch to exist.
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1)
  if (parents.length === 0) return // a root commit has no previous state to diff against
  const lastCommit = git(['diff', '--name-only', 'HEAD~1..HEAD'])
    .split('\n').map((s) => s.trim()).filter(Boolean)
  expect(lastCommit.length, `${why} — HEAD is the merge base (no branch to measure), and the diff `
    + 'machinery ALSO returned nothing for the last commit, which cannot legitimately be empty. '
    + 'So the commands themselves are broken here, exactly the failure this control exists for.')
    .toBeGreaterThan(0)
}

describe('rule 12 — the Notebook workstream owns these paths', () => {
  it('the named file is inside the named prefix — containment proved, not assumed', () => {
    expect(FORBIDDEN_FILE.startsWith(FORBIDDEN_PREFIX)).toBe(true)
  })

  it("the rail can actually see this branch's changes — the non-vacuity control", () => {
    const { sha } = mergeBase()
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/)

    // ⚰️ THIS CONTROL FIRED ON MASTER, AND IT WAS RIGHT TO — the fix was to tell the two empty
    // states apart, NOT to soften it. That reasoning now lives in ONE place, above.
    expectMachineryCanSee('the non-vacuity control')
  })

  it('⛔ the on-base branch is IDENTIFIED, not guessed — the control keeps its teeth', () => {
    // Non-vacuity for the branch above (`lesson_gate_that_cannot_fail`). If `onBase` were somehow
    // true on a real feature branch, the strict assertion would be skipped everywhere and this
    // rail would never fail again. So pin the two facts that decide it, from git itself.
    const { sha } = mergeBase()
    const head = git(['rev-parse', 'HEAD'])
    expect(head).toMatch(/^[0-9a-f]{40}$/)
    expect(sha).toMatch(/^[0-9a-f]{40}$/)

    // And the equality is a real discriminator: HEAD's parent is never HEAD, so a checkout with
    // any commit at all distinguishes the two.
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1)
    if (parents.length > 0) {
      expect(parents, 'HEAD lists itself as its own parent — the comparison that decides `onBase` '
        + 'cannot discriminate anything').not.toContain(head)
    }
  })

  it('⛔ no file under the Notebook workstream\'s paths is touched, except the one permitted card', () => {
    const { ref, sha } = mergeBase()
    // ⚰️ 2026-09-10, ADDED BY THE NOTEBOOK WORKSTREAM; widened into a scope decision
    // 2026-09-13 (B7). This rail failed on the NOTEBOOK BRANCH ITSELF, where "this branch must
    // not edit the Notebook workstream's files" is false by definition, and it would have failed
    // on every Notebook deploy from then on, blocking the workstream it protects.
    // ⛔ An IDENTITY ASSUMPTION: it assumed any branch running it is this programme's.
    // A guard that cannot say WHO it guards guards everyone.
    // ⛔ NOT A SKIP, A SCOPE -- it still asserts something falsifiable here.
    if (!rule12Applies({ branch: currentBranch(), changed: changedPaths() })) {
      expectMachineryCanSee('scoped out — this change set is not joystick work')
      return
    }
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

/**
 * ⛔ B7 — THE SCOPE DECISION GETS ITS OWN RAIL, because the thing most likely to break this file
 * is not the git plumbing, it is the predicate quietly answering "no" everywhere.
 *
 * ⭐ EVERY BRANCH NAME BELOW IS REAL, read off `git branch -r` on 2026-09-13, not invented. An
 * invented fixture proves the regex matches itself; a real one proves it matches the branches
 * this repository actually ships from.
 */
describe('rule 12 — the rail fires on joystick work and nowhere else (B7)', () => {
  const CASES = [
    // ── The Notebook workstream's own family. Every one of these tripped the rail before B7,
    //    and the one-literal fix covered only the first.
    { applies: false, branch: 'notebook-primary-platform',
      changed: ['app/src/pages/journal-2-0/tabs/NotebookTab.jsx'] },
    { applies: false, branch: 'feat/notebook-kill-switch',
      changed: ['app/src/pages/journal-2-0/lib/offline/offlineFlag.js'] },
    { applies: false, branch: 'hotfix/notebook-ios17-iterator',
      changed: ['app/src/pages/journal-2-0/lib/pdfjs.js'] },
    { applies: false, branch: 'rollback/notebook-offline-default-off',
      changed: ['app/src/pages/journal-2-0/components/notebook/NoteCard.jsx'] },
    // ⭐ The case the one-literal fix could not reach at all: the owning workstream touching a hub
    //    file. It happened — they edited THIS rail to add their escape.
    { applies: false, branch: 'notebook-flip',
      changed: ['app/src/hub/rule12Paths.test.js', 'app/src/pages/journal-2-0/tabs/NotebookTab.jsx'] },

    // ── This programme's branches. ⛔ NOT ONE of them contains "joystick" or "hub", which is
    //    exactly why the diff is the primary identifier and the name is the fallback.
    { applies: true, branch: 'fix/d46-d48-closeout',   changed: ['app/src/hub/HubKnob.jsx'] },
    { applies: true, branch: 'docs/d46-d48-sha-fix',   changed: ['docs/plans/joystick/deferred.md'] },
    { applies: true, branch: 'launch/closure',         changed: ['docs/plans/joystick/closure.md'] },
    { applies: true, branch: 'fix/d44-step-semantics', changed: ['tools/hub_surface_matrix.mjs'] },

    // ── Shared artifacts are nobody's change set (2026-09-24). A gate receipt under
    //    docs/plans/joystick/gate-runs/ beside a Notebook-side test fix must NOT read as the hub
    //    editing Notebook files; the parent directory, and a hub source file, still must.
    { applies: false, branch: 'fix/master-red-sweep',
      changed: ['docs/plans/joystick/gate-runs/2026-09-24T18-04-13.json',
        'docs/plans/joystick/gate-runs/2026-09-24T18-04-13.md',
        'app/src/pages/journal-2-0/components/trade/TradeDetailPage.test.jsx'] },
    { applies: true, branch: 'fix/master-red-sweep',
      changed: ['docs/plans/joystick/gate-runs/2026-09-24T18-04-13.json', 'docs/plans/joystick/closure.md'] },
    { applies: true, branch: 'fix/master-red-sweep',
      changed: ['docs/plans/joystick/gate-runs/2026-09-24T18-04-13.json', 'app/src/hub/sections/chartDrawDoor.test.jsx'] },
    { applies: true, branch: 'docs/scope-reconciliation',
      changed: ['docs/plans/joystick/scope-reconciliation.md'] },
    // …and by NAME, for a joystick branch whose first commit has not landed yet.
    { applies: true, branch: 'feat/joystick-hub', changed: [] },

    // ── Other workstreams, minding their own business. The rail owes them silence.
    { applies: false, branch: 'feat/s7-price-level', changed: ['app/src/pages/Calendar.jsx'] },
    { applies: false, branch: 'terminal-research',   changed: ['api/routers/calendar.py'] },
    { applies: false, branch: 'feat/indicator-r0r1', changed: ['app/src/components/chart/engine/ast/pine.js'] },

    // ⛔ THE ONE THAT LOOKS LIKE A HUB BRANCH AND IS NOT: "git" + "hub". A bare /hub/ substring
    //    match would claim this branch, so the separator boundaries are load-bearing.
    { applies: false, branch: 'fix/github-actions-cache', changed: ['.github/workflows/vite.yml'] },
  ]

  for (const c of CASES) {
    it(`${c.applies ? '⛔ FIRES' : '⭐ scopes out'} on ${c.branch}`, () => {
      expect(rule12Applies({ branch: c.branch, changed: c.changed })).toBe(c.applies)
    })
  }

  it('⛔ the table discriminates — it is not quietly one answer for everything', () => {
    // `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`, applied to the fixture itself:
    // a predicate hard-wired to `false` would pass twelve of these cases.
    const answers = new Set(CASES.map((c) => c.applies))
    expect(answers.size, 'every case expects the same answer, so this table cannot catch a '
      + 'predicate that returns a constant').toBe(2)
  })

  it('⛔ every HUB_OWNED prefix matches real tracked files — a typo matches nothing', () => {
    const tracked = git(['ls-files']).split('\n').map((s) => s.trim()).filter(Boolean)
    expect(tracked.length, 'git ls-files returned nothing, so this check proves nothing')
      .toBeGreaterThan(100)
    for (const p of HUB_OWNED_PREFIXES) {
      expect(
        tracked.some((f) => f.startsWith(p)),
        `HUB_OWNED_PREFIXES contains "${p}", which matches NO tracked file. Either it is a typo `
        + 'or the paths moved; either way the predicate silently stopped recognising that part of '
        + 'the programme as joystick work.',
      ).toBe(true)
    }
  })

  it('⛔ the prefixes do not claim the paths they exist to protect', () => {
    // A prefix that matched `app/src/pages/journal-2-0/` would make every Notebook edit read as
    // joystick work and invert the rail.
    for (const p of HUB_OWNED_PREFIXES) {
      expect(FORBIDDEN_PREFIX.startsWith(p), `"${p}" claims the forbidden prefix itself`).toBe(false)
    }
    expect(rule12Applies({ branch: 'whatever', changed: [FORBIDDEN_FILE] }), 'a change set of '
      + 'nothing but Notebook files reads as joystick work').toBe(false)
  })
})
