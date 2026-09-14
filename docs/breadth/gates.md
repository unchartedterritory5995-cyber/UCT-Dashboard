# Breadth → Data Charts — frontend gate records

Each merge is gated with `python scripts/gate_shards.py --shards 6` on a clean tree and judged against the failing set
measured on the tree it started from. A merge passes when it adds no failing test and every named-list rail still names
the same files. A name that differs is re-run alone before it is classified. Manifests stay local (scratchpad); the
failing sets are copied here. Test names only — no member data (D-018).

---

## Baseline — before C1 (2026-09-13 11:03)

Tree `5091a81cf` at start and end · wrapper `scripts/gate_shards.py` blob `7164d491f` · 1,309 test files on disk,
reconciles · **12 failing tests in 11 files, 19,339 passed**. The branch touched nothing under `app/`
(`git diff --name-only f4fc5d1c1 5091a81cf -- app` is empty), so every entry is master's. None is this program's to fix.

| Failing test (file › case) | What it names | Owner (last commit on the named file) | Kind |
|---|---|---|---|
| `components/chart/ChartDrawingOverlay.surfaces.test.jsx` › entering edit mode is not a resize | — | charts drawings, `8de4da43b` | rail red |
| `components/chart/builder/EvidenceTab.doors.test.js` › the derived importer set is the named pair | — | evidence builder, `811328eb8` | load (15 s timeout) |
| `components/chart/engine/ast/manifestProse.test.js` › every key the product reads survives the strip | — | indicator manifest, `b280131b8` | rail red |
| `components/chart/engine/ast/pine.blindCorpus.test.js` › the accepted floor moves one way too | — | Pine parity, `b1a901970` | rail red |
| `components/screener/reachable.test.js` › nothing committed is connected to nothing | `lib/context/focusDivergence.js` | S4 context (R-29), `76c62c494` | rail red |
| `hooks/pollingSites.rail.test.js` › no new bare polling site | `components/chart/useBoundDrawingAlerts.js` (charts `d26695853`), `floor2/hooks/useFloor.js` (community `cc195e888`), `hooks/useFilingWatch.js` (S7 `611bcf92e`), `hooks/useWatchlistIntelligence.js` (Seam 8 `22452cff7`) | four sessions | rail red |
| `lib/presentation/presentationSingleFormatter.test.js` › nothing outside lib/presentation imports formatPercent | — | S10 presentation, `de9551dd9` | load (15 s timeout) |
| `pages/ThemeTrackerPage.chartmount.test.jsx` › passes stored=null with no onStore | — | charts, `7adfdda2b` | load-sensitive (~4 s) |
| `pages/ThemeTrackerPage.chartmount.test.jsx` › selecting a holding mounts ChartPane | — | charts, `7adfdda2b` | load-sensitive (~4 s) |
| `pages/journal-2-0/lib/importer/convert.test.js` › long meeting/daily-notes log (SIZE regime) | — | Notebook importer, `89dd17d59` | load-sensitive |
| `pages/journal-2-0/lib/iteratorGlobalFloor.test.js` › every built asset is clear | — | Notebook, `d261d0731` | rail red |
| `styles/tapFloor.test.js` › no stylesheet declares a finger target on the phone only | `journal-2-0/components/notebook/CaptureDialog.module.css: .actions` | Notebook Wave L, `5d3f5f1be` | rail red |

## C1 honest states (2026-09-13 12:41)

Tree `32f480a77` at start and end · same wrapper blob · 1,314 test files on disk (the baseline's 1,309 plus C1's five
new files), reconciles · **9 failing tests in 8 files, 19,382 passed**.

- **Failing only on C1: none.** Nine failing tests are in both sets.
- **Failing only in the baseline: three**, each a load timeout, each passing when run alone on the C1 tree (3 files,
  35/35): `EvidenceTab.doors` (15 s timeout in the baseline), `presentationSingleFormatter` (15 s timeout),
  `importer/convert` SIZE regime. C1 touches none of their files.
- **Named-list rails unchanged:** reachability names only `lib/context/focusDivergence.js`; polling sites names the
  same four files; tap floor names only `CaptureDialog.module.css: .actions`. The new modules
  `breadth/sessionDates.js` and `breadth/chartLoadError.js` are reachable and hold no polling site.
- A mid-development combined run also timed out the polling rail's "wrapper exempts itself" case (30 s); alone it
  passed in 6.4 s, and it passed in this gate.

**Verdict: no new failure.** C1 passes.

## C2 chart mechanics (2026-09-13 13:45)

Tree `391818e44` at start and end (C1, the merge of origin/master `2b0b184cd`, and C2's six commits) · wrapper
`scripts/gate_shards.py` blob `2240e9c49` (updated by that merge) · 1,320 test files on disk, reconciles · **9 failing
tests in 8 files, 19,448 passed**.

- **Failing only on C2: none. Failing only on C1: none.** The nine are the same nine, test for test.
- **Named-list rails unchanged:** reachability names only `lib/context/focusDivergence.js`; polling sites names the same
  four files; tap floor names only `CaptureDialog.module.css: .actions`. The new modules `breadth/chartTicks.js`,
  `breadth/chartZoom.js` and `breadth/chartMagnitude.js` are reachable and hold no polling site.
- The file count rose by C2's four new test files and the test files the merge brought in from master.

**Verdict: no new failure.** C2 passes.

---

## Standing notes on reading this gate

**Shard membership is not stable, so only the union is comparable.** `vitest list` ignores `--shard`, and Vitest
partitions by hashing each spec's path — so any change to the test-file SET can move files across shards. A per-shard
table is still worth printing, but a failure appearing in a different shard is a MOVE, not a regression, and re-gating
"only the intersecting shards" after a test file is added or removed is not a valid selection: the intersection is
unknowable without running them. Full gate, or the seam rule below.

**Master moves during a 35-minute gate.** The rule (owner, 2026-09-13), applied to the delta `D` since the gated tree's
merge base: `D` touches no `app/**` and no test file → merge and push, no re-gate · `D` touches them but has no overlap
with this branch's files and nothing of ours imports from `D` → merge, then ONE targeted run of (our test files + `D`'s
test files) by explicit file list · `D` overlaps our files or our imports → merge and re-gate fully · never more than two
consecutive full gates chasing master. Which rule fired, and its file lists, is printed before every push.

**Every baseline failure carries an owner** so the next session does not rediscover it. All of them are master's; none is
this program's to fix.

| Failing test | Owner (last commit on the named file) |
|---|---|
| `ChartDrawingOverlay.surfaces` › entering edit mode is not a resize | charts drawings, `8de4da43b` |
| `builder/EvidenceTab.doors` › the derived importer set is the named pair | evidence builder, `811328eb8` (load-sensitive) |
| `engine/ast/manifestProse` › every key the product reads survives the strip | indicator manifest, `b280131b8` |
| `engine/ast/pine.blindCorpus` › the accepted floor moves one way too | Pine parity, `b1a901970` |
| `screener/reachable` › nothing committed is connected to nothing | S4 context (R-29), `76c62c494` |
| `hooks/pollingSites.rail` › no new bare polling site | four sessions: `d26695853`, `cc195e888`, `611bcf92e`, `22452cff7` |
| `lib/presentation/presentationSingleFormatter` › nothing outside lib/presentation imports formatPercent | S10 presentation, `de9551dd9` (load-sensitive) |
| `ThemeTrackerPage.chartmount` › two mount cases | charts, `7adfdda2b` (load-sensitive) |
| `journal-2-0/lib/importer/convert` › long meeting log (SIZE regime) | Notebook importer, `89dd17d59` (load-sensitive) |
| `journal-2-0/lib/iteratorGlobalFloor` › every built asset is clear | Notebook, `d261d0731` |
| `styles/tapFloor` › no stylesheet declares a finger target on the phone only | Notebook Wave L, `5d3f5f1be` |
| `desk/ArticlesSection.native` › clearing the query brings the full archive back | Desk/UI, `f30842782` (load-sensitive — see C3 below) |

## C3 touch & ARIA (2026-09-13)

Gated three times as master moved. The run that stands is **`47109cc47`** at 16:27 — tree identical at start and end,
wrapper blob `2240e9c49`, **1,323 test files on disk, reconciles**, 10 failing tests in 9 files, 19,468 passed.

**Per-shard table, C3 (`166c161dd`, the run before master's app/** delta) vs the C2 baseline (`391818e44`):**

| shard | baseline | C3 | delta |
|---|---|---|---|
| 1 | 4 | 4 | (empty) |
| 2 | 1 | 1 | (empty) |
| 3 | 2 | 2 | (empty) |
| 4 | 0 | 0 | (empty) |
| 5 | 2 | 2 | (empty) |
| 6 | 0 | 0 | (empty) |

Union 9 vs 9 — none new, none gone. ⚠️ Shard 2's delta is **empty**, not "−AuthContext": `AuthContext.test.jsx` was never
in the C2 baseline. It failed only in the discarded intermediate run at `0af0f66f0`, which is what `3512348c5` addresses.
`reachable.test.js` is baseline, not new.

### The two reds that appeared during C3, and what each one was

**`AuthContext.test.jsx` › 503 on a REFETCH — FIXED (`3512348c5`, D-036).** Direction established before any edit: the
post-restart master delta touched nothing under `app/`; this branch touches no auth file; the test last changed
2026-09-12, before the baseline; Vitest runs `pool: 'forks'` with per-file isolation, so cross-file pollution is not the
mechanism. Green 3/3 alone and again in a re-run of its own shard with the same file list and `--maxWorkers=2`.
Mechanism: the case reads three values and only two were inside the `waitFor` its own ⚰️ comment added; `authTransient`
was read synchronously after `act`, which React 19 can flush in a later Scheduler task. Test-only, own commit,
inverted-expectation control.

**`desk/ArticlesSection.native.test.jsx` › clearing the query brings the full archive back — NOT FIXED, recorded.**
Unchanged since 2026-08-24, absent from this branch's diff and from master's incoming delta. Green 3/3 alone and in a
re-run of its own shard. The failure is a `waitFor` timeout, and that `waitFor` is correctly placed: `test-setup.js`
already configures `asyncUtilTimeout: 4000` against a 250 ms debounce in `ArticlesSection.jsx`, so it had ~16× the
headroom it needed. That is starvation under the full suite, not a misplaced assertion — the class `vite.config.js`
documents at length in its pool-sizing comment. Rewriting it would mean raising a global timeout in another session's
area to hide load, so it is listed above as pre-existing and load-sensitive.

**Named-list rails unchanged:** reachability names only `lib/context/focusDivergence.js`; polling sites the same four
files; tap floor only `CaptureDialog.module.css: .actions` — C3 moved this tab's finger targets to the touch tier and the
app-wide rail's list did not move.

**Seam run (rule 3) after master's final 86-file delta, which touched no `app/**`:** our five test files green (58 tests),
and master's 14 incoming backend test files green (461 passed, 2 skipped). Three errors there are environmental — those
tests mount the real FastAPI app, which serves `app/dist/assets`, and this worktree has never run a frontend build.

**Verdict: no failure attributable to this branch.** C3 merges.

---

## R1 registry unification (2026-09-13 19:27)

Tree `59e1c9a76` at start **and** end · wrapper blob `2240e9c49` · **1,325 test files on disk, reconciles with the
summed shard total** · **8 failing tests in 7 files, 19,498 passed**.

| shard | test files | tests |
|---|---|---|
| 1 | 3 failed / 221 | 4 failed / 2,781 passed |
| 2 | 1 failed / 221 | 1 failed / 3,037 passed |
| 3 | 2 failed / 221 | 2 failed / 3,972 passed |
| 4 | 0 failed / 221 | 0 failed / 3,080 passed |
| 5 | 1 failed / 221 | 1 failed / 2,547 passed |
| 6 | 0 failed / 220 | 0 failed / 4,081 passed |
| **Σ** | **7 failed / 1,325** | **8 failed / 19,498 passed** |

**Union diff — every failing file is a documented baseline row; none is new, none is this branch's.**

| Failing file | In the baseline table? | Owner |
|---|---|---|
| `ChartDrawingOverlay.surfaces` | yes | charts drawings, `8de4da43b` |
| `engine/ast/manifestProse` | yes | indicator manifest, `b280131b8` |
| `engine/ast/pine.blindCorpus` | yes | Pine parity, `b1a901970` |
| `screener/reachable` | yes | S4 context (R-29), `76c62c494` |
| `hooks/pollingSites.rail` | yes | four sessions |
| `ThemeTrackerPage.chartmount` | yes | charts, `7adfdda2b` (load-sensitive) |
| `styles/tapFloor` | yes | Notebook Wave L, `5d3f5f1be` |

Five load-sensitive baseline names were **green** this run (`EvidenceTab.doors`, `presentationSingleFormatter`,
`importer/convert`, `iteratorGlobalFloor`, `desk/ArticlesSection.native`) — fewer failures than C3's 10-in-9, which is
the load-sensitivity already recorded for them, not a fix.

⚠️ **The wrapper reported "1 NEW failure" and it is MASTER'S, proved by direction, not by citing this document.**
The wrapper compares against its own baseline `258c5609d` (re-measured on origin/master `62a228e5d`), which predates
R-29 landing. `screener/reachable` run alone names exactly one module — `app/src/lib/context/focusDivergence.js` —
which this branch does not touch: our whole `app/src` diff is the five R1 files, **zero** under `lib/context`. The
module and every reference to it are master's (`76c62c494`, S4 CP1, 2026-09-12). A reachability verdict about that file
cannot be moved by changes confined to `pages/breadth/`. ⛔ Add it to the wrapper's baseline citing `62a228e5d`; it
blocks nothing.

**Master moved 11 commits DURING the gate** (`9fe247cb0` → `e659454bb`). Delta `D` = 49 files, `app/**` = **0**,
overlap with this branch's 13 files = **0**, our imports from `D` = **0**. `D`'s 14 "test" paths are **all backend
pytest under `tests/`** — zero vitest — so they cannot move the vitest partition or change a vitest result.
**Rule 1 fires: merge and push, no re-gate.**

⚠️ The overlap number must be computed against the **merge base**, not `origin/master..HEAD`. Once master moves, that
range replays master's own newer commits in reverse and reports a large fake overlap — it listed `api/main.py` and nine
`discord_render` files here, none of which this branch has ever touched.

**Verdict: no new failure attributable to R1. Passes.**

---

## The gate sequence, and the freeze is the part people get wrong

Owner ruling, 2026-09-13. In order:

1. **Merge master into the branch** — so the tree that gets gated is the tree that gets pushed.
2. **Freeze the tree.** No commits, no doc edits, no `git add`, nothing, for the entire run.
3. **Gate.**
4. **Apply the delta rule** only if master moved *during* the gate.
5. **Push the exact gated hash.**

⛔ **Any edit during a gate voids it, by wrapper design.** `scripts/gate_shards.py` records the tree hash at both ends
and refuses a run whose tree moved — *"the tree it ran against is not the tree it would report on"* — then clears the
partial shard logs so an empty log directory can never later read as a completed run.

⚰️ Written down because it happened: the R1 gate was started at `8a8718ec4` and finished at `936da1aba` because the
session kept committing documentation into the same worktree while the six shards ran. Thirty minutes, void. **The
wrapper was not being pessimistic — it was right**: docs committed mid-run are in the pushed tree but were never in the
gated one, and nothing downstream could tell the difference.

⭐ **Documentation you want to write during a run goes in a scratch file OUTSIDE the worktree** and is committed after
the gate reports. A gate is ~35 minutes and the urge to fill it with "harmless" doc edits is the whole failure mode —
there is no such thing as a harmless edit to a frozen tree.

⛔ An `INVALID-*.md` manifest is **never** a signal about the branch. It is the environment, or the operator. Never
merge on one, and never read one as a red.

## Reading THIS run's diff: decide on the union, print per-shard for the record

R1's gated tree merged 27 master commits carrying **14 incoming test files**. Vitest partitions by hashing spec paths,
so a changed test-file SET moves files across shards by construction.

- **A failure that changes shard is a MOVE, not a regression.**
- **The union set is the only comparison that decides the merge** — which tests fail, not where they ran.
- Print the per-shard table anyway, for the record and for anyone diagnosing a shard-local timeout.

## Hook coverage while `tools/secret_scrub.py` lives on one branch (measured 2026-09-13)

The pre-push secret scan needs that file. Where it actually resolves, tested by running the installed hook from each
root:

| Pushing from | Scan runs? |
|---|---|
| `uct-dashboard` (main checkout) | ✅ via the `../uct-worktrees/breadth-charts` fallback |
| `uct-worktrees/breadth-charts` | ✅ locally |
| `uct-worktrees/<sibling>` | ⚠️ **no** — prints the WARNING, allows the push |
| `uct-dashboard/.claude/worktrees/*` (~12 agent worktrees) | ⚠️ **no** — same |

Verified end-to-end from `uct-worktrees/notebook-flip`: the hook printed *"the secret scan did NOT run. This is not a
pass."*, exited 0, and left that worktree clean.

⛔ **It self-resolves as each worktree merges master after R1** — the file is then local and the real branch runs. It is
deliberately NOT patched with more filesystem path guesses: a `$root/../<name>` guess is right for one layout and wrong
for the agent-worktree layout, which would turn a visible warning into a *silent* miss on the roots it still got wrong.
Pointing another worktree's hook at this branch's working tree would also mean executing an unrelated branch's code at
push time, and would break the day this worktree is removed.

⭐ **If a pre-merge fix is ever needed again, resolve the scanner from a REF, not a checkout path** —
`git show origin/master:tools/secret_scrub.py` into a temp file — so the hook depends on something git guarantees
rather than on somebody's directory still existing.

## Never commit on red — and never amend a merge

Two rules from failures on the password-change fix (2026-09-13/14), not from theory.

**1. The commit step runs the test file(s) its message claims, and refuses if the last result printed any failure. A
message stating a count must match the run that produced it.**

⚰️ `dd220b2aa` was authored against a run that printed `1 failed, 5 passed`, with a message claiming six passing. The
run happened; its output was on screen; nothing in the sequence acted on it. That is the same disease as chaining
`npx vitest … ; git commit …` — two calls, and the second is issued only after READING the first.

⛔ **A fixture can be wrong for five tests and fatal for the sixth.** The cause there was a test domain:
`AdminResetRequest.email` is an `EmailStr`, and the validator refuses special-use domains **by name** — `*.invalid`
422s before the endpoint is ever reached, while `.internal` (RFC 8375) passes. The five service-level cases never
touch Pydantic and passed regardless, so the suite looked 5/6 healthy rather than structurally wrong. **Check a
fixture domain against the schema's validators before trusting it across both service-level and endpoint-level
tests** — `*.invalid` and `*.example` are the two that look safest and are not.

**2. After any `--amend`, print `git log -1 --format='%h %p %s'` and confirm the parent count is 1. Never amend a
merge commit.**

⚰️ The correction to the above was amended onto a MERGE commit (two parents), which left the red test in history and
put the corrected message on the wrong object. It was caught only by reading the parent list. A branch that is still
local can be restructured (`git reset --soft origin/master` then one commit); one that has been pushed cannot.

⭐ **The push guards firing is the EXPECTED behaviour, not an exception.** On that same change the pre-push 502 guard
refused twice — once for another session's `BUILDING` deploy, once for a SUCCESS only 143s settled — and each refusal
came with master having moved, so the merge commit was rebuilt onto the new tip. **Rebuild onto the new tip; never
`--force`, never `UCT_SKIP_PREPUSH_GUARD=1` to get past a refusal you did not expect.**

## ⛔⛔ A COMPUTED `import.meta.env` READ IS UNDEFINED IN THE BUNDLE — and perfect in vitest

> **Read a `VITE_*` flag as the full static literal — `import.meta.env.VITE_THING` — never
> through a variable, a constant, or a computed key. Vite substitutes these TEXTUALLY at
> build time; anything it cannot see as a literal is not substituted and is `undefined` in
> the shipped bundle.**

⚰️ **Committed 2026-09-14 on V2-1, and it would have shipped a flag that could never be on.**
`app/src/pages/breadth/v2/flag.js` was written as:

```js
export const V2_FLAG = 'VITE_BREADTH_CHARTS_V2_ENABLED'
export function v2Enabled(env = import.meta.env) { return env?.[V2_FLAG] === '1' }   // ⛔ WRONG
```

That form is **correct JavaScript and passes every frontend test**, because under vitest
`import.meta.env` is an ordinary object and `vi.stubEnv` writes to it. In a production build
there is no object to index — Vite has already replaced the literal reads and left this one
alone — so the flag reads `undefined` for every member, forever, and the only symptom is a
feature that never turns on.

⭐ **WHAT CAUGHT IT IS THE LEDGER RAIL, AND THAT IS THE POINT.**
`tests/test_vite_flag_ledger.py` compares the declared rows against
`tools/vite_flag_index.names_read()`, which derives the names by reading the frontend. It
reported *"docs/feature_flags.json declares build flags the frontend no longer reads:
VITE_BREADTH_CHARTS_V2_ENABLED"* — a message about bookkeeping, whose real cause was a flag
Vite could not bake. **The name the index cannot find is the name the bundler cannot
substitute**, because both are looking for the same literal. A "stale row" report on a flag
you just wired is not a ledger problem; it is this bug.

⛔ **Do not add a second rail for it.** The index already fails on the dynamic form, and a
source sweep for the literal would match its own documentation — the CODE-NEVER-PROSE trap
this repo has committed six times in one session. Fix the read; keep the one authority.

⚠️ The same applies to destructuring (`const {VITE_X} = import.meta.env`) and to
`Object.entries(import.meta.env)` — Vite's own docs say so, and neither is visible to the
index either.

---

## ⛔⛔ A STACKED PUSH KILLED A LIVE REQUEST AND A HEALTH CHECK — 2026-09-14

**Two hashes and two times, because the timeline is the whole finding.**

| UTC | what |
|---|---|
| 12:29:23 | `7705c2d3b` (breadth request timing, §2b) pushed. Guard green: *"web is SUCCESS on `00b029552`, 333s settled — safe to push."* |
| ~12:33 | deployment reports SUCCESS; a production `days=8000` smoke is issued |
| **12:32:16** | **`9e2b93805` pushed by another workstream — 173 s after the first, while it was still `BUILDING`** |
| 12:34:42 | the new pod boots; the first deployment is marked `REMOVED` |
| ~12:35:03 | the in-flight request dies: **HTTP 500 after 93,491 ms** |
| ~12:35:15 | **`/api/health` → 502** |
| ~12:36:00 | five consecutive probes → 200. Recovered without intervention. |

⭐ **THE FIRST DIAGNOSIS WAS WRONG AND THE COST OF ACTING ON IT WOULD HAVE BEEN REAL.** A 500 on a
paid route followed by a 502 reads as *"the deep read OOM'd the pod"*, which is a plausible,
alarming, and entirely fabricated conclusion — H15 would have had me revert a correct merge.
⛔ What settled it was reading the DEPLOYMENT LIST rather than the symptom: a second deployment
existed, created after mine, with mine marked `REMOVED`. The pod never crashed; it was replaced.

⚠️ **`railway logs` could not have answered it.** The buffer holds ~500 lines and began at the new
pod's boot — the evidence from the instance that served the request was already gone when the
question was asked. Read the deployment list first; it outlives the pod.

⭐ **And the memory hypothesis was disproved rather than dropped**: the timing instrument shipped
in that very merge recorded `rss_before_mb=3032.5 rss_after_mb=2959.7` across the 114-second read.
Resident memory FELL. A pod does not OOM while giving memory back.

**Rule this produced:** *a push is not clear until its web deploy reaches SUCCESS* —
`docs/runbooks/deploy-windows.md` and `CLAUDE.md`.

### Hourly stacked-push audit

`python tools/pre_push_guard.py --audit` runs hourly (Task Scheduler job
**`UCT-StackedPushAudit`**) and appends to **`logs/stacked-push-audit.log`**, which is
gitignored. It reports
SUSPECTED and never CONFIRMED: Railway's deployment list carries only `status` and
`createdAt`, with no "reached SUCCESS at" timestamp, so it can show that two distinct
commits were deployed closer together than a build takes and cannot show the first was
still building.

⭐ **Its first run is the reason §2 of the 2026-09-14 ruling exists.** Against the live
list it found **six** suspected stacked pushes on 2026-09-14 alone — including four
consecutive between 06:14 and 06:24 UTC — which is what turned "a stacked push
happened to me" into "this is routine and the client hook is not holding".

⛔ **WHY THE HOURLY OUTPUT DOES NOT WRITE ITSELF INTO THIS FILE, which is what was
asked for.** A scheduled job appending to a TRACKED file leaves the tree permanently
dirty, and `scripts/gate_shards.py` refuses a dirty tree — so an hourly writer would
turn every gate run into an `INVALID` for a reason unrelated to the branch under test,
which is exactly the "infrastructure failure collapsing into a code verdict" this repo
keeps paying for. The log is gitignored; the table below is curated from it, and the
table is the artifact. ⚠️ That is a tradeoff, not a solved problem: a finding reaches
this file only when a session folds it in.

⚠️ Once the `master deploy gate` workflow and Railway's Wait for CI are both on, this
audit becomes a REGRESSION DETECTOR rather than a live problem report: a suspected
stack after that date means the serialisation is not working, and the pair of hashes
is the evidence to open with.

| run (UTC) | suspected pairs | note |
|---|---|---|
| 2026-09-14 (first, manual) | 6 | `9e2b93805`/`7705c2d3b` 173 s · `98a18b969`/`7a2b54369` 294 s · `94798e838`/`59de6a14b` 172 s · `59de6a14b`/`e269f2b10` 202 s · `e269f2b10`/`956df0913` 214 s · `afef0bfde`/`2d7ae7795` 170 s |

⚠️ **A WORKED FALSE POSITIVE, AND IT IS MINE.** The first scheduled run flagged
`b4c141948` landing **234 s** after `db23f17e8` — and that push was compliant: the
guard had reported *"SUCCESS on db23f17e8, 217s settled"* before it, i.e. the earlier
deploy had **finished**. The heuristic cannot tell "landed 234 s later while the first
was still building" from "landed 234 s later because the first took 200 s and then
succeeded", because the list carries no completion time.

⭐ **Do not fix this by narrowing the window.** The 2026-09-14 incident itself was
**173 s**, so a window tight enough to exclude the false positive would also exclude
the true positive it exists to catch. The right resolution is the one already in
flight: once `master deploy gate` + Railway **Wait for CI** serialise pushes, a
suspected stack becomes a REGRESSION SIGNAL to investigate rather than a number to
tune — and investigating one costs a minute of reading two deploy records.

### Wait for CI — the two-push verification (2026-09-14)

**Push B of this test was made with `UCT_SKIP_PREPUSH_GUARD=1` on purpose.** The
client guard would have refused it, and refusing it is not what needed proving: the
whole reason for the GitHub-side gate is that a client hook cannot stop a session
that bypasses it. Bypassing it deliberately is the only honest test of the
server-side serialisation.

| UTC | event |
|---|---|
| (filled in below by the run) | |

