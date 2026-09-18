---
id: e-cp2-build-record
unit: E CP2
packet: packet-e-ci-gap-gate
merges-after: E CP1
status: UNSIGNED
---

# E CP2 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick
APPROVED ON:      2026-09-17
APPROVED AT SHA:  00eecb391
SCOPE APPROVED:   CP2 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

⛔ **Why this is a separate document from `packet-e-ci-gap-gate.md`.** `tools/sign_gate.py`
refuses a document carrying more than one unsigned `APPROVED AT SHA:` line — *"refusing to
guess which"* — and one block cannot hold two signatures. Packet E's block belongs to CP1.
**One checkpoint, one block, one row.** The same split was already made for `S4 CP2` and
`D3 CP2`; this is the third instance of the pattern, not a new idea.

⚠️ **This checkpoint was called CP2 by its commit and CP2 by the packet's table, and those
were two different checkpoints.** The packet's `CP2` meant *promote CI to a required check*.
It has been renumbered to **CP3**; see the ⚰️ note in `packet-e-ci-gap-gate.md` §2 for why
the unbuilt side is the side that moves.

---

## 1 · What CP2 is

**CP1 made the full suite RUN in CI. CP2 makes its result READABLE.** A `publish` job
appended to `.github/workflows/full-suite-report.yml` writes each run's machine-readable
summary to `results/<run_id>.json` and `results/latest.json` on an **orphan `ci-results`
branch**, so any later session can read a verdict with `git`, with no account and no token.

- Top-level `permissions: contents: read` is unchanged. **Only** the publish job raises
  `contents: write`, and only to write that one branch — never a source branch, never master.
- `needs: [vitest, pytest]` + `if: always()` — a RED run must publish, or the record only
  ever shows the good days.
- `concurrency` keeps `cancel-in-progress: false`: a cancelled run leaves a hole that reads
  exactly like a green one.
- `tools/ci_summarize.py` turns a runner log into that JSON and carries the traps: ANSI is
  stripped before matching (a coloured *"2 failed"* reads green otherwise), **zero collected
  is never a pass**, a missing totals line sets `ok: false`, and a missing log yields
  `totals_line_found: false` rather than a silent zero.

---

## 2 · ⛔ THE PREMISE THIS WAS BUILT ON WAS FALSE — F-CI-2

The commit message for `e767a7aab` states the motive plainly:

> *"This machine has no `gh` CLI and no `GITHUB_PERSONAL_ACCESS_TOKEN`, so run #1's result
> was UNREADABLE from here. A run whose only record is the Actions UI cannot be read by the
> next session either."*

**Measured 2026-09-14 23:45 EDT: that is false. This repository is PUBLIC, so the GitHub
REST API answers ANONYMOUSLY.**

```
GET https://api.github.com/repos/unchartedterritory5995-cyber/UCT-Dashboard   -> 200
GET .../actions/workflows/full-suite-report.yml/runs                          -> full records
GET .../actions/runs/<id>/jobs                                                -> per-job status
```

No `gh`, no token, no PAT, no browser. Run #1's result — and every job's status — had been
readable from this box the entire time.

⭐ **The reasoning error, stated so it can be recognised again: "I lack the tool I reached
for" was treated as "the thing cannot be read."** `gh` was absent and the MCP server had no
token, and from those two facts an UNREADABLE verdict was written into a report, a briefing,
this workflow's motive, and the docstring of `tools/ci_summarize.py`. **Nobody tried the
unauthenticated path**, against a repository whose public status was already recorded in user
memory (`lesson_a_public_repo_cannot_prove_authentication` — *a public repo answers
anonymously*). The instrument was chosen before the question was asked.

⛔ **CP2 IS STILL WORTH HAVING, and the distinction matters.** It is no longer the only way
to read a result; it is the way to read one **durably and mechanically** — Actions logs age
out, the API is rate-limited and requires network, and `results/latest.json` is a committed
artifact a session can diff. **Build it for the durability, not for the access.** A unit
whose stated reason evaporates deserves a re-justification, not a quiet survival.

---

## 3 · Why `ci-results` did not appear for 23 minutes, and what was NOT wrong

The previous session checked repeatedly over ~17 minutes, found no branch, and filed the
run UNREADABLE. Four causes were proposed: PUSH-NOT-LANDED, WORKFLOW-DID-NOT-TRIGGER,
PUBLISH-JOB-SKIPPED, TOKEN-READ-ONLY. **The answer is none of them, and the enumeration is
the thing that was wrong.**

| fact | measured |
|---|---|
| the push landed | `origin/feat/s7-price-level` = `e767a7aab` |
| the workflow triggered | run **#2** exists on that sha, `event: push` |
| run #1 had **no publish job** | `git show af9fe21a6:...yml` then `grep -c 'publish:'` -> **0** |
| run #2 was **still running** at every check | `vitest` `in_progress`; publish `needs` it |
| the token could write | publish pushed `ci-results` at **03:49:41Z** |

**Nothing was broken.** Run #1 fired against a commit that did not contain the publish job,
and run #2 — the first run that carries it — took **23 minutes**, because it runs the *whole*
suite (vitest alone: 1,020 s). Every check fell inside that window.

⛔ **TOKEN-READ-ONLY was the leading hypothesis and it was wrong.** The four local
`permissions:` facts verified in C2.1 were all correct and all irrelevant: they describe what
the workflow *asks for*, and none of them can distinguish "refused" from "not yet reached."
⭐ **A question that names its own candidate answers will be answered from inside that list.**
The fifth option — *the job has never run* — was not offered and was the true one; it was
found only by reading the run's own job list instead of re-reading the config.

---

## 4 · The first full-suite CI record — RED

`results/latest.json`, run `34925008177`, sha `e767a7aab`:

| suite | collected | passed | failed | skipped | wall | ok |
|---|---|---|---|---|---|---|
| vitest | **19,898** | 19,862 | **21** | 15 | 1,020 s | `false` |
| pytest | **2** | 0 | 0 | 2 | 82.7 s | `false` |

**verdict: RED.**

**vitest — 21 failures across 14 files**, the first full-suite measurement this programme
has ever had (CI previously ran **28 of 2,782** test files):

```
enumerationSites.test.js          legendFromDefinitions.test.jsx
manifestProse.test.js             readout.test.js
reachable.test.js                 pollingSites.rail.test.js
rule12Paths.test.js               surfaceMatrixIsCurrent.test.js
format.test.js                    heatmapRegistry.golden.test.js
exportRoundtrip.test.js           iteratorGlobalFloor.test.js
tapFloor.test.js                  surfaces/manifest.test.js
```

⛔ **pytest DID NOT RUN — `2 skipped, 8 warnings, 479 errors in 82.68s`.** It collected
**2** items and errored on 479. This is a COLLECTION failure, not a test failure, and it is
precisely the case `ci_summarize.py` was written to refuse to call green: `collected == 0`
or no totals line sets `ok: false`. **A suite reporting `0 failed` because it never
collected is the most flattering possible lie**, and the record says `ok: false` instead.
Cause not yet diagnosed — filed, not fixed.

⚠️ **`oom_or_timeout: true` on BOTH suites is an INSTRUMENT DEFECT, not a finding.** The
regex is `(timed out|timeout|The operation was canceled)` over the whole log, so any
occurrence of the word "timeout" anywhere — a test name, a warning, a config echo — sets it.
vitest completed with a totals line after 1,020 s and pytest after 82 s; neither was killed.
**A flag that fires on the word rather than the event will be muted within a week.** Filed
as **F-CI-3**; the fix is to anchor it to the runner's own termination lines. Also
`vitest.runner_line` came back empty — `_V_FILES` did not match this runner's output — so the
`Test Files` line is not being captured. Both are recorded here rather than repaired,
because repairing an instrument in the same breath as reading its first result destroys the
only measurement it has produced.

---

## 5 · Files, and the one-unit-one-commit proof

`e767a7aab` — the thirteenth commit on `feat/s7-price-level`:

```
.github/workflows/full-suite-report.yml   (publish job appended; top-level perms unchanged)
tools/ci_summarize.py                     (new)
tests/test_ci_summarize.py                (new)
```

Disjointness: the file set intersects **none** of the other twelve commits' file sets.
Watch coverage: no `api/**` file is touched, so **no flow-worker strand** — CI configuration
and a log parser only.

---

## 6 · Drafted ledger row — NOT written

| 78 | `e767a7aab` | 2026-09-15 | CI | 1 | E CP2: CI results publish to an orphan `ci-results` branch. First full-suite run: vitest 19,898 collected / 21 failed across 14 files; pytest **did not collect** (2 collected, 479 errors). Verdict RED. The unit's stated motive (*"unreadable without a token"*) was false — the repo is public and the REST API answers anonymously (**F-CI-2**); CP2 is kept for durability, not access. |

## 7 · Drafted RESUME delta — NOT applied

- CI is now readable two ways: `git show origin/ci-results:results/latest.json` (durable,
  committed) and the anonymous REST API (live, no auth).
- **The full suite is RED and the backend suite does not collect.** That is the next
  measurement to own, and it is a unit of its own — not a fix to fold into anything else.
- Packet E's promotion checkpoint is **CP3**, and its criterion (>=1 GREEN and >=1 RED run
  in the ledger) now has its **RED**. It does not yet have a GREEN.
