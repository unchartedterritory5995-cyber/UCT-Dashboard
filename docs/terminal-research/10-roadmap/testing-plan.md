---
id: H-06
title: Testing strategy — the doctrine this repo already paid for, stated once, with the gate it implies
role: >
  The testing deliverable. MASTER_CHECKLIST item 36, gate item 36. Written by H-06, who also
  owns gate item 25 (`10-roadmap/observability-plan.md`), so §4.6 of that document and §4 of
  this one are deliberately the same four proof methods seen from two sides: there it is how a
  signal proves it can fire, here it is what makes a rail count.
wave: 4
group: ROADMAP
category: strategy
inputs: >
  `C:\Users\Patrick\uct-worktrees\_merge-master\CLAUDE.md` (5,823 lines, read in sections —
  the testing sections are the primary source and are cited by HEADING, never by line) ·
  the executable artifacts themselves: `scripts/gate_shards.py`, `tools/pytest_chunks.py`,
  `tools/gate_carry_over.py`, `tools/gate_box_lock.py`, `tools/mutation_check.py`,
  `tools/check_repo_hygiene.py`, `tools/ci_extract.py`, `conftest.py`, `pytest.ini`,
  `app/vite.config.js`, `.github/workflows/master-deploy-gate.yml`,
  `docs/plans/joystick/gate-baseline.json`, `docs/test-baseline/python-failures.md` ·
  `10-roadmap/observability-plan.md` (gate item 25, draft) §4.6, §4.9, G-2 ·
  `05-product-strategy/anti-patterns.md` (gate item 11, draft) — the `INST-*`, `GATE-*`,
  `REACH-*` families and its detector tally ·
  `07-technical-architecture/realtime-performance-architecture.md` (gate item 24, draft) §1 ·
  `12-decisions/DECISION_CARDS_2026-09-26.md` CARDS 16 and 17.
scope: >
  Source read READ-ONLY in the sibling worktree `C:\Users\Patrick\uct-worktrees\_merge-master`;
  nothing written there. ⛔ NO git command of any kind (another session owns the commit), so
  **SHA not pinned (no git by instruction)** wherever a SHA would normally appear. ⛔ NO test,
  NO suite, NO script, NO network request, NO `curl`, NO `railway`, NO production call. The
  only commands run were filesystem walks (`find`, `ls`, `wc`), content searches, file reads,
  and two `python -c` reads of a JSON artifact. One file written: this one.
confidence: >
  🟢 high on everything with a `file:line` — each was opened, not grepped-and-assumed.
  🟢 high on the four counts I took myself (§0 table), each with its exact command in SOURCES.
  🟢 high on the doctrine: every rule below names a dated incident recorded in `CLAUDE.md` or
  in the tool's own docstring, and where the repo contradicts itself §5 says so and picks.
  🟡 on any wall-clock figure (the 46–92 min gate, the 260–427 ms gesture floor, the 15,000 ms
  timeout): carried from the recorded measurement, not re-taken here.
  🟡 on what is RED today — see the evidence ceiling. The baseline I cite is an artifact with a
  date on it, not a statement about the tree as it stands.
evidence_ceiling: >
  ⛔⛔ NOT ONE TEST WAS EXECUTED, by instruction, and that bounds this document precisely: every
  number here is a **file count or a source fact**, never a pass count. I do not know the
  current failing set. ⛔ The baseline I quote (126 named failures across 43 files, master
  `73a4286d0`, measured 2026-09-24) is read out of
  `docs/plans/joystick/gate-baseline.json`; with no git available I could not check whether
  that SHA is still an ancestor of master, and the tree has grown since (§0). ⛔ No detector
  was run, so a "YES, a rail exists" is a claim that a named file exists at a cited path — it
  is never a claim that the rail passes. ⛔ No device, no browser, no pod: every statement about
  BrowserStack, about production, and about what Cloudflare does is carried from items 24 and
  25 and from `CLAUDE.md`, labelled where it is carried.
status: draft
---

# Testing strategy (H-06)

## 0. Headline

**Three conclusions. The first two are about what a gate can be; the third is the sentence the
whole strategy reduces to.**

1. ⭐⭐ **Gate on "no NEW failures against a named, dated baseline", never on a green suite —
   and neither the exit code nor the task-status is the verdict.** The repo is not green and no
   single branch can make it so: the frontend baseline is **126 named failures across 43 test
   files** at master `73a4286d0`, measured 2026-09-24 (`docs/plans/joystick/gate-baseline.json`,
   keys `failures` / `files` / `sha` / `measured_at`), and the Python baseline is **66 measured,
   64 open, across 21 files** from a 71-of-71-batch sweep
   (`docs/test-baseline/python-failures.md:1-18`). The wrapper's status is uninformative in
   **both** directions — once a runner died at argument parsing having executed nothing and the
   wrapper said exit 0, and once a gate printed `GATE: 1 NEW failure(s) … GATE EXIT: 1` and the
   task notification still said exit 0 (`CLAUDE.md`, *"A test run without a totals line is not
   a run"*). The verdict is the **manifest**: the two totals lines, the file-count
   reconciliation, and the gate's own `GATE EXIT:` line, read from the file.

2. ⭐⭐ **The full-suite gate is longer than the interval between disturbances, so as a
   per-merge gate it can never finish — and that is arithmetic, not discipline.** Measured
   twice in one night: the six-shard gate takes **46–92 min** while master moved **56 commits
   in 92 min**; a rig cell takes 12–22 min while production deployed every **~13 min**, and 22
   of 23 cells came back INCONCLUSIVE on a 502 (`CLAUDE.md`, *"A measurement that takes longer
   than the gap between disturbances cannot complete"*). ⛔ **And there is no CI net under it:**
   `.github/workflows/master-deploy-gate.yml` runs **five fast checks and no vitest at all**
   (`:266-289` — shadowed definitions, VITE build-args + flag ledger, visibility flag ledger,
   line endings, plus a changed-files secret scan), which its own header states in the words
   *"FAST ONLY, ON PURPOSE"* (`:105-110`). So the local six-shard gate is the only full-suite
   verification a landing gets, and it is the one thing the box cannot reliably deliver.
   **The single highest-leverage change in this document is putting vitest on a host that is
   not this machine** (§6.1). Until then, the merge gate must be the *derived scoped* set, and
   §5 rules it that way rather than pretending otherwise.

3. ⭐⭐ **Every tier is structurally blind to a class of defect, and the engine you test in can
   contain the thing whose absence is the bug.** jsdom has `Iterator`. Chromium has `Iterator`.
   Safari below 18.4 did not — so `pdfjs-dist@6`'s own feature-detect shim threw at module
   scope, every member on iOS below 18.4 lost the Notebook, and the unit suite, the six-shard
   gate and a headless-Chromium sweep were all green that same morning (`CLAUDE.md`, *"REAL-DEVICE
   iOS FOUND A PRODUCTION CRASH jsdom AND CHROMIUM CANNOT SEE"*). The rail that replaced the
   device **simulates the engine** — `app/src/pages/journal-2-0/lib/iteratorGlobalFloor.test.js`
   deletes `globalThis.Iterator` and loads the real module chain — because a bundle text scan
   *fails the fix and passes the bug*: the safe build mentions `Iterator` eight times more
   often. ⭐ **The general form is the most useful sentence in the repo, and it is already
   written into a tool:** *"An absence is only evidence if the instrument could have seen a
   presence"* (`tools/ci_extract.py:15-18`). §4 is that sentence turned into a contract.

**What I counted myself, and how.** Every command is in SOURCES.

| quantity | measured | method |
|---|---|---|
| frontend test files under `app/src` | **1,845** | `find app/src -type f \( -name "*.test.js" -o -name "*.test.jsx" -o -name "*.spec.js" -o -name "*.spec.jsx" \) \| wc -l` — the same predicate `gate_shards.count_test_files` uses (`scripts/gate_shards.py:455-458`) |
| all `.js`/`.jsx` under `app/src` | **3,419** | same walk, no name filter. **54% of frontend source files are test files** |
| backend test files under `tests/**` | **1,651** | `find tests -type f \( -name "test_*.py" -o -name "*_test.py" \) -not -path "*__pycache__*"` |
| backend test files under `api/**` | **159** | same predicate, `api/` root. ⚰️ `pytest.ini:15` says **93**; that typed figure is stale, and the enforcement is `tests/test_test_discovery_coverage.py`, which is derived |
| tools carrying `--self-check` | **89** | `grep -rl -- "--self-check" tools/ scripts/ --include=*.py --include=*.mjs \| grep -v __pycache__` |
| mutation harnesses in `tools/` | **25** | `ls -1 tools/*mutat* tools/*gauntlet* \| grep -v __pycache__` |

⭐ **The stale denominators in prose are the point, not a footnote.** `CLAUDE.md` and
`gate_shards.py`'s own docstring quote **1,178**, **1,180**, **1,181** and **1,283** files at
various dates; the walk today answers **1,845**. Those prose figures are not the gate's input —
`count_test_files()` derives the denominator at run time, from disk, every run. **That is the
difference this whole document is about.** A derived number cannot go stale; a typed one beside
it already had (`gate-baseline.json::files_note` says so in as many words about its own
`files[]` list).

---

## 1. The doctrine this repo already has

Ten families (§1.1–§1.10). Each rule names the incident that paid for it. ⛔ Nothing here is invented; where
I add a judgement it is marked **RULING** and lives in §5 or §7.

### 1.1 A run that cannot report is not a run

| rule | the incident |
|---|---|
| **Assert the totals line before reading the exit code.** | A full-suite run launched with an invalid `--minWorkers` died at argument parsing having executed nothing; the background-task wrapper reported **exit 0**. Nothing distinguished "17,000 tests passed" from "the runner never started" — it was caught only because the log had no `Test Files` / `Tests` line. |
| **The wrapper's status is uninformative in BOTH directions.** | 2026-09-13, six-shard gate on the stage-2 merge tip: the log said `GATE: 1 NEW failure(s) against the baseline — exit 1` / `GATE EXIT: 1`, and the task notification said **"completed (exit code 0)"**. ⛔ Nobody may treat this as a solved trap. |
| **A pipe owns the exit code — and so does a trailing `echo`.** | Bit **four times on the same tool**. Three OOM-killed pytest runs read clean through `\| tail`; a lane that executed one chunk of twelve read `[exited with code 0]`; the verification command for the fix reproduced it a third time; and the fourth, 2026-09-13, was **the recipe this very section used to recommend** — `… > log 2>&1; echo "EXIT: $?"`, which prints the real code and exits with the echo's. ⭐ *"A rule that fixes the pipe and leaves the semicolon has fixed the example, not the defect."* `tests/test_pytest_chunks_runner.py` carries a reproduction of both maskings. |
| **The totals-line assertion itself must be verified.** | 2026-09-09: the assertion was written `grep '^ *Test Files'` and never matched, because vitest prefixes that line with ANSI escapes. It alarmed on **six healthy shards**. ⭐ *"The assertion that exists because exit codes lie was itself unverified"* — `scripts/gate_shards.py:1-28`; `strip_ansi` (`:70-72`) is now documented *"ALWAYS BEFORE MATCHING"* with a proof fed real captured bytes. |
| **A chunked or sharded run is reconciled against the full file list before its total is quoted.** | A directory-split gate covered **1,016 of 1,178** files and missed a known baseline row. ⭐ *"A partial suite fails in the FLATTERING direction: fewer files run, fewer failures found."* `count_test_files` (`:455-458`) is the denominator and `count_waived_files` (`:461-479`) subtracts declared waivers — added because a blunt equality *"printed ⛔ DOES NOT RECONCILE on a healthy gate"*, and **a reconcile check that cries wolf on its own waiver is one a reader learns to skip.** |
| **A gate refuses a dirty tree and records the tree hash at both ends.** | Same day: a run's shards saw **1180 files and then 1181**, because a test file was created while it ran. *"A gate whose input changes underneath it is not a gate."* |
| **A chunk with no summary line is an OOM kill until proven otherwise.** | `tools/pytest_chunks.py:35-39`. pytest always prints a summary when it completes; its absence means the process died first, so the chunk is reported **KILLED**, not folded into "0 failed" — *"the reading that let three kills pass as quiet successes."* |
| **Run the suite in its own tool call, before the commit — never in the same one.** | 2026-09-10: `npx vitest run … ; git commit …` in one Bash call. ⭐ *"The mistake is not 'forgot to run the tests' — they DID run."* The output was right there and nothing in the sequence could act on it; a non-zero exit commits exactly as happily as a zero one. |
| **A lane's self-report is evidence, never a verdict.** | Five concurrent agents plus an integrator hit the session rate limit; two lanes died, one had committed nothing, and the other reported "done" carrying **5 failing tests it never saw**. ⭐ *"A gate run in a session you cannot see is a gate you did not run."* |

### 1.2 Scope is a memory budget, and `-k` is not scope

| rule | the incident |
|---|---|
| **Scoped pytest means NAMING THE FILES.** | `pytest tests/ -q -k "journal_two or notebook or j2"` reached **11,854 MB RSS and was still climbing**. `-k` selects what *executes*; everything is still **collected**, and collection is where the memory goes. Other recorded peaks: **15.9 GB** (`tools/pytest_chunks.py:5`) and **18 GB** (`docs/runbooks/options-flow-status.md:77`). ⛔ **`--collect-only` ALONE reached 6.6 GB.** |
| **The mechanism, so the rule is not cargo-culted.** | `api/main.py` is **11,066 lines** (measured; the tool's docstring says ~9,800 — stale) mounting ~986 routes, so any collected module importing `api.main` at module scope pays that cost, and the repo-root `conftest.py` *additionally* runs an AST census over `api/**`, `scripts/` and `tools/` at import. Only giving pytest **fewer files** helps. |
| **The file list comes from the filesystem, never from `--collect-only`.** | `tools/pytest_chunks.py:20-22` — *"Asking pytest to enumerate the suite is the very thing that blows up."* It walks `pytest.ini::testpaths` directly. |
| **Sequential, never parallel.** | `:24-26` — *"Parallel chunks multiply the peak rather than divide it, and the peak is what kills the box. `-n auto` here would be worse than the unscoped run it replaces."* |
| **One gate at a time on this box.** | 2026-09-12: three concurrent sessions (an unscoped pytest, a second six-shard gate in another worktree, a render job) took free memory to **4.8 GB**; `app/node_modules` went to 2 entries, then 0, then absent, then the worktree's `.git` file was destroyed. ⭐ Two gate attempts wrote `INVALID` because shards produced no totals line — **that is the system working**, and *"never read an INVALID manifest as a signal about your branch."* |
| **The lock is a QUEUE, not a mutex, and it says so.** | `tools/gate_box_lock.py:1-30`: advisory, machine-wide, and `gate_shards.py` *"asks before it starts, and refuses its own start."* ⛔ **No TTL, by owner ruling** — *"pid alive but idle"* is a parked BrowserStack session, and a heartbeat TTL would hand the box to a second gate, which is the collision it exists to stop. |
| **The evidence of an OOM sweep is that there is no evidence.** | No traceback, no error, a suspiciously fast success line, an empty directory. A too-good-to-be-true result on a contended box is a killed run until proven otherwise. |
| **A config default that cannot fail loudly stops being true.** | `app/vite.config.js:234-240`: `execArgv: ['--max-old-space-size=8192']` lived under `poolOptions.forks.execArgv` until Vitest 4 **removed `poolOptions`** — accepted silently with a deprecation line while the heap flag reached no worker. Restoring it took a red run from 2 timeouts to 1. |
| **A per-test wall-clock bound, and the number is measured.** | `pytest.ini:31-60`: `timeout = 300`, because the slowest single test measured **84.3 s** and the next **37.3 s**. ⚰️ Two tests carried `@pytest.mark.timeout(10)` while `pytest-timeout` was **not installed** — an unregistered mark, silently ignored: *"a gate that could not fail."* ⚠️ On Windows the fallback method **kills the process** rather than failing one test, so a budget set too low turns a chunk into a dead chunk with no summary. |
| **`-ra` is a correctness setting, not verbosity.** | `pytest.ini:4-11`: a path-traversal containment test correctly skipped on a privilege-less host, and without the reason string in the summary *"did not run" and "ran and passed" were indistinguishable at a glance.* |
| **`testpaths` alone is a fix that cannot fail.** | `pytest.ini:18-23` — it is ignored the moment pytest is given a path argument, and every real runner passes explicit paths. The enforcement is `tests/test_test_discovery_coverage.py`, which fails **by name** on any collectable test file outside the declared roots. The gap it closed: 93 collectable files under `api/**` that every `tests/**` glob walked past, *"one HANGING, unnoticed, for as long as they existed."* |

### 1.3 A guard nobody has seen fire is not a guard

⭐ **This is the family that makes every other rule enforceable, and the repo treats it as
mandatory rather than aspirational: 25 mutation harnesses in `tools/` and 89 tools carrying a
`--self-check` mode (both measured, §0).**

- **Break it, watch the named rail go red, put it back — and prove step three.**
  `tools/mutation_check.py:1-33` enforces a six-step protocol: snapshot exact pre-mutation
  bytes, mutate, require the test to FAIL (optionally requiring a *named* test among the
  failures), restore the bytes in a `finally`, re-run and require PASS, and **verify the
  restoration by hashing**. ⚰️ It exists because a mutation was rolled back with
  `git checkout -- <file>`, which restored HEAD and *"silently discarded the implementation the
  mutation was testing"*. ⛔ **Never `git checkout` to restore** — a second incident in the same
  week discarded a finished twenty-minute edit the same way.
- **Probes that watch the guard actually fire, against a throwaway directory.**
  `tests/test_shared_data_root_guard.py` (940 lines) does exactly this — never against `C:\data`.
- **Mutation-proved BOTH directions.** The sandbox census rail
  (`tests/test_hub_sandbox_launcher.py`): drop the `AUTH_DB_PATH` pin → red; **re-add**
  `BARS_PREWARM_DISABLED` → red. `app/src/styles/themeIslands.test.js` likewise.
- ⭐⭐ **Proved four ways, each reverting exactly one layer.** The object-pool fix
  (`docs/pine/PARITY-ROOT-CAUSE.md:181-189`): evict the newest instead of the oldest (killed) ·
  drop `resolveCapacity` back to a flat 500 (killed) · scan the raw source again (killed) ·
  eviction skips the shared teardown (killed). ⚠️ **The fourth survived at first, and the rail
  was the thing at fault** — it asserted `new Set(ids).size === live.length`, trivially true of
  any run. It now drives a collection to its cap, where an un-spliced array refuses the run.
- ⭐⭐ **Killing one shared predicate reds BOTH fixes' rails at once — and that is the proof the
  extraction is real.** Wave Q1 fix 6: the same invariant lived in `settleLandedSave` and not in
  `persist`, so one implementation had a hole **and the hole was invisible because the other copy
  read as coverage for both**. The fix is ONE exported predicate (`discardsUnsentWork`) that both
  writers ask, never a second copy; its mutation proof reds both rails together
  (`CLAUDE.md`, *"A guard on the incoming record cannot protect the outgoing one"*).
- **Three copies of a guard cannot be mutation-proved.** Delete every copy but one — a
  three-copy invariant has no single mutation that reds it (`lesson_a_guard_repeated_is_a_guard_unproved`;
  anti-patterns GATE-2).
- **Four rails, four fixes, one per fix.** The 2026-09-10 navigation freeze shipped four fixes
  and four rails, *"each mutation-proved by reverting exactly that fix"* —
  `hubRegistrarLoop.test.jsx` (×2), `CatalystTable.renderLoop.test.jsx`,
  `Dashboard.heroMount.test.jsx`.

### 1.4 Code, never prose — and the instrument must be able to see the other answer

| rule | the incident |
|---|---|
| **Every literal-hunting check strips comments before matching.** | ⛔⛔ **Six separate instances in one session**, and a **seventh** with its fix pattern recorded (`docs/pine/WAVE2-A-PLAN.md:1840-1871`): a self-retiring check went red on its first run because the retirement note *names the constant it retired*. |
| **The fix pattern, all three parts.** | Strip comments before matching · **build the needle by concatenation** so the checking file does not contain it · carry stripper controls **both ways** (it still sees live code; it does **not** see a prose-only token). ⛔ *"The explanation is never deleted to make a check pass — the check is fixed."* |
| **A contract rail matched its own documentation.** | `app/src/hub/contractArity.test.js` (201 lines) reads the argument list from the file that actually calls each callback. Its first version matched the prose *"passed through to the mode's own onScrub(ctx, delta)"* a few lines above the real call site — *"the invented-citation defect committed by a machine."* |
| **A grep found five call sites, all five of them prose.** | Hence `app/src/components/screener/reachable.test.js` (1,172 lines) walks the real import graph **with an AST**, following `lazy(() => import(…))`, and carries a control proving the dynamic edge is load-bearing *"so it cannot pass for the wrong reason."* |
| **A text scan of a bundle cannot see a shim.** | "Grep the bundle for `Iterator.`" **fails the fix and passes the bug** — the safe build has eight times more mentions. The predicate is *unguarded access*, never presence. The bundle scan is kept only for globals nothing shims, with a rail that fails if the two lists drift. |
| **A byte-level check that measured only the tool.** | `grep -c $'\r'` through this box's Git Bash **always answers 0** — from a file or a pipe. Measured with a control: a blob holding **195 CR bytes** answered `0` while `grep -c 'a'` answered 96 and `od -c` found all 195. *"Every line-ending check written that way measured nothing about the file and everything about the tool."* The replacement counts four byte totals at once (CR / CRLF / LF / CRCRLF). |
| ⭐ **The general form, already in a tool.** | `tools/ci_extract.py:15-18`: *"ZERO IS WRITTEN DOWN, NEVER LEFT BLANK. A missing file and a clean run are the same observation to whoever reads the branch next… An absence is only evidence if the instrument could have seen a presence."* The Pine censuses implement it as paired controls — one arm must see a presence before the zero counts (`tools/pine_text_helper_census.py:546-552`). |
| **A collection error is not a test failure.** | `tools/ci_extract.py:11-13`: *"479 errors with 2 collected means the suite never ran."* Bucketing those by their final exception line turns *"the backend is red"* into *"one missing dependency."* |

### 1.5 Derive, never type

⛔ **This repo has at least nine recorded instances of a hand-typed count beside the artifact
that owns it** (anti-patterns DOC-1, *"nine recorded instances, and the programme is committing
it now"*). The ones `CLAUDE.md` names by artifact: the single-writer index said **FOUR** against
six real writers · the COT router said **"4 routes"** beside a list of five · `setupCatalog.js`
said **24 swing setups** in a file holding 26 across five families, one of them Intraday, **and
the same wrong count was in the file's own header** · the widget list enumerated **four** types
while `WidgetHost` dispatched thirteen · the themes taxonomy said *111 themes / 2049 holdings /
v4.16.0* against v4.22.0 / 112 / 2029 · `_MAX_WORKERS` documented as **2** against 6 · the IDB
`CACHE_LOGIC_VERSION` said **4** and *"bump to 5"* while the constant had read 5 for three weeks,
**and the startup fingerprint published for grep verification carried the same stale 4, so the
designated check read green** · the nav-tab list carried two phantom entries, one of which made
`tools/mobile_audit.py` audit the 404 page while five real routes were never audited at all.

The rails that answer it, all of which read an artifact rather than a list:

- `app/src/components/chart/engine/__tests__/singleWriterIndex.test.js` derives the writer set
  from `StockChart.jsx`'s **AST** — every `.update()` on `candleSeriesRef.current`,
  alias-resolved with shadowing respected — and fails **by name** on a seventh writer or a
  deleted guard. ⛔ *"Do not re-type a count here — read that test."*
- `conftest.py` derives its env pins by AST over `api/**`, `scripts/`, `tools/` — **never grep**
  — so *"a `/data` literal added tomorrow is pinned the day it lands"*, and `unpinnable` is 0.
- `app/src/hub/surfaceMatrixIsCurrent.test.js` byte-compares two generated artifacts against a
  generator that reads an **acorn parse tree**; it was regex-based twice and wrong twice.
- `app/src/widgets/registry.test.js` (503 lines) pins that the registry and the `/charts`
  bindings cannot drift.
- `gate-baseline.json::files_note` is the rule stated about the artifact itself: ⚰️ *"`files[]`
  is DERIVED from `failures[]` as of 2026-09-14 and is documentation only… It had drifted: it
  listed [three files master had fixed] while omitting [one added 2026-09-10]. **A derived list
  cannot drift; a typed one already had.**"*
- ⭐ **And the honest exception, labelled as one.** `PY_RAIL_FLOOR` in
  `tools/gate_carry_over.py` is a declared **minimum**, not a derivation, because a change to
  `scripts/gate_shards.py` has no test file in its own diff — deriving produced *"you must run
  something"* above an empty list. ⛔ *"Nothing owed is a fact — say it."*

### 1.6 A guard that cannot see the case it exists for

| shape | the instance |
|---|---|
| **A guard keyed on the incoming record cannot protect the outgoing one.** | `putNoteWithIntent` carried an explicit class guard written `else if (noteRecord.dirty)`. A writer that flips `dirty: 1 → 0` in the same transaction satisfies the `else` and deletes the member's queued words. The guard was *"correct, documented, mutation-proved at its own layer, and structurally unable to see the case it was written for."* |
| **An auditor whose aperture excludes its own failure class.** | `api/auth_surface_check.py:79` sets `MUTATING = {"POST","PUT","PATCH","DELETE"}` and `:248` iterates only those — **so the boot auditor cannot see a GET**, and the entire risk it exists for is unauthenticated GETs of vendor market data. ⭐ *"The word `MUTATING` is doing the reviewer's thinking for them."* Anti-patterns GATE-7, ⛔ **NO detector, the sharpest in the library.** |
| **A fixture that cannot distinguish is not a rail.** | A bare CRLF ban would go red on `deferred.md` the moment somebody edited it **correctly**, and *"a check that fires on the right answer is muted within a week"*; a style comparison also fails, because on a mixed file both sides answer "crlf". `tools/check_repo_hygiene.py` reports a path only when the two sides are identical **once every CR is removed**. Rails: `tests/test_repo_hygiene.py` — 11 quiet cases beside 4 firing ones, plus a **non-vacuity case**, because the check walks CHANGED paths and on a clean tree inspects nothing. |
| **Self-declaring beats threshold-guessed.** | `themeIslands.test.js`: islands declare themselves with `--theme-island: <name>`, because two files *"look like islands to a naive scan and are not"*. |
| **`vitest -t` is a REGEX, and a filter matching nothing exits 0.** | A false pass, recorded as a standing rule (`lesson_a_green_suite_can_hide_a_layout_regression`). Same disease as the filter that matched nothing and returned 0 from a process query. |
| **A rule stated in a document that no check enforces.** | C2 of the carry-over rule *"is specified in CLAUDE.md and has been structurally unevaluable on every landing — nothing in the repo emits the import graph it requires. A written check nobody can run is not a check."* |
| **Verifying the guard you wrote is not verifying the property you want.** | `scripts/hub-sandbox.ps1` refused `-DataDir C:\data`, verified against five spellings — *"and completely irrelevant: the sandbox path was correct and 71 of the 72 vars ignored it."* |
| **Never invent an env flag name.** | The kill-list set `BARS_PREWARM_DISABLED=1`, which matches nothing in the codebase. The bars seeder ran 3,160 jobs against live data while the operator believed it was off. ⛔ *"An env var nobody reads is indistinguishable from a working kill switch — both produce silence."* The census rail's flag-name check is the detector, mutation-proved by re-adding the name. |

### 1.7 A non-vacuity control on anything that shells out

> ⛔ **Owner ruling (rule 14, 2026-09-10): any rail that shells out — git, a subprocess, the
> network — carries a NON-VACUITY CONTROL: a case proving the command returned something before
> any assertion over its output means anything. Its mutation proof is run BEFORE the rail is
> called done, not after.**

**Three instances in two days, each caught only by the mutation proof, never by review:**

| rail | what the command actually returned | why it read green |
|---|---|---|
| `hub/rule12Paths.test.js` v1 | `git status --porcelain` sliced at a fixed offset, **eating the first character of every modified path** — `pp/src/pages/...` | the forbidden-prefix filter matched nothing, so a real violation passed |
| `hub/rule12Paths.test.js` v2 | `git diff -- app/src/...` run from vitest's cwd (`app/`), so the pathspec resolved to `app/app/src/...` | zero added lines compared against zero removed: **`0 === 0`** |
| `scripts/deploy_watch.py` v1 | `subprocess.run(["railway", …])` cannot resolve a `.cmd`/`.exe` shim on Windows without `shutil.which` | **forty consecutive `FileNotFoundError`s, then exit 0** |

⭐ **The three fixes generalise.** Pin the working directory (`git -C $(git rev-parse
--show-toplevel)`) rather than trusting the caller's cwd — git resolves pathspecs relative to
cwd and `--porcelain` paths relative to the repo, *"and the two disagreeing is invisible."*
Resolve executables with `shutil.which`, never `shell=True`. Parse nothing you can avoid
parsing.

⚠️ **The control must be able to fail.** `expect(files.length).toBeGreaterThan(0)` is only a
control if a broken invocation would actually make it zero. Assert on something the command
**cannot legitimately return empty**, and prefer **naming a specific expected member**
(`expect(files).toContain('HubRoot.jsx')`) over a count. ⚠️ And a **zero from a process query is
a broken query until a control says otherwise** — the first two attempts at a process counter
returned 0, *"which is [this] rule arriving in a new costume."*

### 1.8 The instrument and the world moving under it

- ⛔ **Sampling where a waiter was available — the cheapest false negative there is.** A rig
  checked for the editor with `query_selector('.ProseMirror')` every 5 s inside a sleep loop. An
  editor that mounted at t=8 s went unseen until t=12 s; one at t=34 s was never seen, and the
  cell died on *"the editor never mounted"* while the product had been ready for seconds. Same
  cell, same ceiling: sampling **3 GREEN / 3 INCONCLUSIVE / 748 s** → waiting
  (`wait_for_selector`) **6 / 0 / 211 s**. ⭐ **6 of 6 and 3.5× faster from changing how it
  waited, not what it measured.** ⛔ **And it was about to be blamed on deploy churn** — the swap
  detector recorded **zero** swap-waits for that window. Grep for `wait_for_timeout(` beside a
  `query_selector`.
- ⛔ **A timeout handler that discards its output destroys the one run you needed.**
  `except subprocess.TimeoutExpired: out, code = "TIMED OUT", 124` threw `e.stdout` away, and a
  1800 s run's `raw.txt` contained exactly those two words. ⛔ *"I read that emptiness as 'it hung
  at startup'"* — the rig Chrome's own creation timestamp proved it came up three seconds in.
  **Two defects, and fixing one was not enough:** the child was also block-buffering, so keep
  `e.stdout` **and** `reconfigure(line_buffering=True)`.
- ⚰️ **A global process count is not a measurement of YOUR run.** ~15 `vitest`-matching processes
  during a `--max-workers 1` gate was published twice as proof the CLI bound was ignored. It was
  every process on the box, including another workstream's leak. A controlled delta:
  maxWorkers 1/2/6/12 → peak node delta 5/7/9/15, monotonic. ⭐ **The bound was honoured and
  always was** — ⛔ *"and the cost of believing it would have been a code change."* Baseline,
  launch, measure the **delta**, and carry a control proving your run happened at all.
- ⛔⛔ **Two instruments agreeing is evidence about their shared input.** A vitest spy reported
  `:957` in a 563-line file and an independent acorn parse `:952`; two languages, no shared code,
  so both were declared wrong. **The file was corrupt and I had corrupted it** — 556 line endings
  became CR-CR-LF, and a bare CR *is* a terminator in ECMAScript. ⭐ *"The tell was free and I
  walked past it: `wc -l` said 563 the whole time."*
- ⛔ **A timeout is never banked as permitted breakage.** `enumerationSites.test.js`: **15,000 ms
  under the full suite, 1,461 ms alone on the same SHA**. And the 2026-09-17 run reported 4 NEW
  of which **three were timeouts**, each passing alone by a wide margin (2,856 ms / 1,218 ms /
  616 ms) — *"all three walk `app/src` with an AST or a filesystem crawl, which is exactly the
  shape that goes load-sensitive"* (`gate-baseline.json::load_sensitive_note`). ⛔ **A banked slot
  is one a real failure can later occupy unnoticed.** Re-run it alone before classifying it.
- ⛔ **A test whose outcome depends on `git status` is not flaky — it is reading the wrong thing.**
  `gate_shards.py` carried `tree_state_fn=tree_state` as a **default argument, bound at import**,
  so `monkeypatch.setattr` reached nothing; the test called the real function, found the tree
  clean, skipped the refusal and **ran a real six-shard gate inside a unit test**. ⭐⭐ It PASSED
  whenever the tree happened to be dirty and HUNG whenever it was clean — every hang just after a
  commit, every pass mid-edit — *"and from the outside those are indistinguishable. That is what
  let it survive four wrong diagnoses."* ⛔ The rail must prove the patch is **called**, not just
  that the default is `None`.
- ⛔ **Provenance is `git show <sha>:<file>`, never `git status`.** Four failing rails were caused
  by the joystick hub and **not one of the four offending files was in that branch's working set**.
- ⛔ **Kind 3b — a true record the world moved under.**
  `test_the_policy_constants_are_what_the_owner_authorised` asserted `MIN_UPTIME_S == 600` after
  the owner authorised 300: *"the rail that exists to make policy drift deliberate had itself
  drifted, and was failing on the authorised value."* ⭐ The only question that finds it is
  **"when was this last true?"**

### 1.9 The half that talks to the member

- ⛔ **PRESENT IS NOT SHOWING.** `HubRoot.jsx` keeps `<div data-testid="hub-root">` in the DOM and
  sets the HTML `hidden` attribute, so a `querySelector` presence check answers *"did React render
  the container"*, never *"can the member see it"* — **and the first touch pass therefore published
  a product defect that did not exist.** ⚠️ `offsetParent === null` is not the signal either: the
  hub is `position: fixed`. Measure the `hidden` attribute, the computed `display`, **and** a
  non-zero box — and **keep a fixture that must read SHOWING, or the checker passes by answering
  "no" to everything.**
- ⛔ **Assert user-facing feedback by rendered DOM text after the action settles, never by state.**
  Owner ruling 2026-09-09, after **two** toast defects shipped with *every structural assertion
  green*: one was passed `message` where `JournalToast` reads `msg` (rendered `''`), and both were
  owned by the element their own action unmounts, so each message *"was destroyed in the same
  commit that set it and rendered for **zero frames**."* ⭐ *"A test that asserts `setToastMsg` was
  called proves nothing about whether a human ever saw the sentence."*
  `app/src/hub/hubHideRestore.test.jsx` (319 lines) therefore has a **copy contract** section.
- **Structural corollary:** a toast/banner host must **outlive** the control that fires it —
  `HubRoot.jsx::HubToastHost` is the pattern.
- ⛔ **A green suite, a 200 and a rising uptime are all compatible with a browser that cannot
  change pages.** The 2026-09-10 freeze: gate green (1,261 files / 18,708 tests / 0 NEW),
  `/api/health` 200 throughout, five clean first-hour samples — *"because it polled the server and
  the server was never unwell."* Found by a member, live 4.5 hours.
- **A component test is structurally blind to a severed wire.** `Screener.scanmount.test.jsx`
  (635 lines) mocks **nothing on the path under test**, so it goes red when the wire is cut while
  every component stays correct. ⭐ *"That is the shape the 2026-08-08 audit said was missing"* —
  8 features built, tested, green, and connected to nothing.
- ⛔ **A count is not a fix; name the elements.** `tools/mobile_audit.py` (518 lines) flags
  horizontal overflow and sub-44px targets — a number from it is a pointer, not a verdict.

### 1.10 The data a test can reach

- ⛔ **`/data` exists as `C:\data` on this box, so a test that reaches a product path succeeds
  against production data.** That is how `C:\data\auth.db` grew to ~1 GB / 20,640 users, and how
  one daemon thread wrote ticker `A` into `C:\data\screener.db` and made the member-facing
  screener label **3,583 month-old rows "today"**.
- **The repo-root `conftest.py` (1,104 lines) does two things at IMPORT**, before any other
  conftest and before any test module, *"because the paths are captured at module import and a
  fixture's `monkeypatch.setenv` reaches none of them"*: **REDIRECT** (AST-derived env pins) and
  **TRIPWIRE** (`sqlite3.connect`/`open`/`makedirs`/… raise, **record**, and fail the run at
  `pytest_sessionfinish`).
- ⭐⭐ **THE RECORD IS THE GUARD, NOT THE RAISE.** A daemon thread's exception goes to
  `threading.excepthook` **and the test that spawned it passes green**. **Four of the five leaks
  this found were on a background thread.** ⛔ Any future guard of this shape must record, not
  merely raise.
- **A redirect alone hides the next offender** — which is why the tripwire sits beside it rather
  than instead of it. And `UCT_TEST_SHARED_ROOT_GUARD=report` is *"the audit mode that makes
  'nothing reaches `C:\data`' a MEASUREMENT rather than an assumption."*
- ⛔ **`DATA_DIR` is not an authority.** **72 environment variables** name paths inside the shared
  root and resolve independently of it (`api/services/auth_db.py:10` is the whole class in one
  line). ⚰️ Re-committed 2026-09-12: a probe set `DATA_DIR` to a scratchpad, looked sandboxed, and
  wrote two live `.db` files anyway. ⭐ **The remedy is to apply the CENSUS, never a hand-picked
  var.**
- **Hash the main `.db`; EXCLUDE `-wal`/`-shm`** — opening a WAL database read-only still rewrites
  its `-shm` index, *"so an mtime-based check cries wolf on its own diagnostics."*
- **A set difference, not a count.** The one authorised production write fingerprinted the users
  table before and after and asserted `ids_added` was exactly one and `ids_removed` empty — ⭐ *"A
  count going up by one is compatible with one row added and another silently rewritten; a set
  difference is not."*
- **One synthetic production account, and it holds no state.** `smoke@uctintelligence.internal` is
  the only account an automated production tool signs in as. ⛔ *"A smoke account that accumulates
  state stops being a control: the next run cannot tell a product change from its own leftovers."*
  ⛔⛔ And the owner's own Chrome is never its browser — measured 2026-09-25, an extension-driven
  session was found signed in as the smoke account while arming **real-member** alert data.

---

## 2. The tiers, the engine each runs in, and what that engine cannot see

⭐ **The third column is the point of this section.** A tier is chosen by the blind spot you are
trying to leave, not by its position in a pyramid.

| # | tier | engine it runs in | ⭐ structurally blind to |
|---|---|---|---|
| **T0** | Static / AST rails over source (`reachable.test.js`, `contractArity`, `singleWriterIndex`, `surfaceMatrixIsCurrent`, `conftest`'s census, `check_repo_hygiene`) | Node (acorn) or Python `ast` over **source text**, no execution | Anything that only exists at runtime. **A shim** — once another chunk defines a global the offending text is still there and now inert. Comments, unless stripped (six instances). Dynamic edges the resolver cannot follow. ⚠️ And these are the **load-sensitive** rails: all three of the 2026-09-17 timeouts were AST or filesystem walks over `app/src`. |
| **T1** | Pure decision functions, unit-tested (`_down_alert_decision`, `clamp_liveness_limit`, `compare_failures`, `parse_totals`) | The bare interpreter, no I/O | **The wire.** Whether anything calls it, whether it is registered with a scheduler, whether the seam is late-bound. The repo's own case: the insights pass was *"written, documented as scheduled, wired into no scheduler"* for weeks. |
| **T2** | jsdom component / integration (vitest, 1,845 files) | **jsdom** | **Layout** — jsdom performs none: never resolves `calc()`, never applies `env(safe-area-inset-*)`, reports **zero for every measured box**. **CSS** — it applies none, so tests see *both* breakpoint branches. **Engine-level absence** — jsdom HAS `Iterator`. **A severed wire**, whenever the path under test is mocked. **Frame lifetime** — a toast that rendered for zero frames passed every structural assertion. |
| **T3** | Python integration over FastAPI + real SQLite (1,651 + 159 files) | CPython + sqlite3, on this box | **Scale and locale of production** — `/data` is `C:\data` here (hence the tripwire), and `C:\data\auth.db`'s ~20,640 rows are a **dev** artifact against production's **26 users**, measured; a migration sized off the wrong one errs ~800× in the dangerous direction. **The single-uvicorn-process reality** (one event loop, one 64-slot anyio threadpool). **Cloudflare.** **Collection cost** — see §1.2. |
| **T4** | Headless Chromium via Playwright (`mobile_audit.py`, `hub_nav_smoke.py`, `window_check.py` 3,310 lines) | **Chromium**, real layout, real navigation | **Old-engine absence** — Chromium HAS `Iterator`; a Chromium sweep loaded `/journal/notebook` and reported the hub mounting normally **the same morning the page was crashing on iOS 17.5.** **The touch pipeline** — no finger touched glass. **Real-device performance.** **Anything needing a production session** unless it signs in as the smoke account. |
| **T5** | Real device, BrowserStack **Live** (screen mirror, human- or agent-driven) | Real Safari / Chrome on real hardware | ⛔ **Anything under ~300 ms.** Measured floor **260–427 ms per gesture**, 16 gestures, two drag lengths, read from the device's own clock; the cost is **per pointer-event round trip, not per pixel**, so shrinking the drag 6× (139 px → 23 px) made the median **worse, 280 → 329 ms**. ⛔ **Synthetic pointer events are silently discarded** — five attempts left the device's own `recorded` counter at *exactly* its previous value. ⛔ **Cannot hold a press.** ⛔ **Dies on inactivity**, so it is serialised with local gates, never parallel. ⛔ **Automate is not on this account** (`automate.browserstack.com/dashboard` redirects to `/request_access`), so there is no scripted device path at all. |
| **T6** | Post-deploy production smoke as the smoke account (`hub_nav_smoke.py`, 1,123 lines) | A real browser against the **live artifact** | Anything the synthetic account cannot reach. Anything it leaves behind (state ⇒ it stops being a control). ⭐ It is the only tier that can see *"a browser that cannot change pages"*, which is exactly what a green gate, a 200 and a rising uptime all missed. |
| **T7** | The scheduled monitor plane (`terminal-next-monitor`, cron, `--once`, no in-memory state) | Cron on a fifth Railway service | **"When was this last true?"** is the only question it answers, and it cannot answer it for a signal with no `as_of` (observability G-8). It cannot prove a guard can fire without one of §3's four methods. ⛔ It must be able to answer the question about **itself** (§4.8 of item 25). |

⭐⭐ **Three exit codes, three different facts — and collapsing the last two is itself the
defect.** `hub_nav_smoke.py` exits **2** when nothing was measurable and **1** when a break was
measured, *"precisely so [the rollback rule] cannot fire on an unmeasured deploy. 'We could not
compute it' and 'it is broken' are different facts; rolling back on the first one teaches
everyone to stop running the smoke."* The Wave Q1 probe runner goes further with **seven distinct
outcomes** *"so infrastructure failures never collapse into 'the browser cannot do it'"*, and an
undrivable real door is **INCONCLUSIVE, never a silent fallback**. On T5 every flick, double-tap
and scrub row is **INCONCLUSIVE-TRANSPORT by construction**, not FAIL.

---

## 3. What a test must carry to count — the contract

⛔ **A rail that cannot satisfy every applicable clause is not a rail yet. State the clause it
fails and why, rather than shipping it as coverage** — this repo records three separate cases of
*a detector that read as coverage and was not one* (anti-patterns §1 preamble).

| # | clause | why, in one line |
|---|---|---|
| **C-1** | **A totals line, read from the log FILE, before any exit code.** Both lines required: *"a log with `Test Files` but no `Tests` is a run that died between them, which is exactly the shape that must never read as a pass"* (`gate_shards.parse_totals`). Strip ANSI first. | The runner that executed nothing and the wrapper that said 0, in both directions. |
| **C-2** | **A denominator reconciliation, derived at run time from a filesystem walk**, with declared waivers subtracted — never against a number written in a document. | 1,016 of 1,178; 1180 → 1181 mid-run; and the prose figures are stale by 562 files today (§0). |
| **C-3** | **A non-vacuity control on anything that shells out or crawls**, able to fail, **naming an expected member** rather than asserting a count. | `0 === 0`; the sliced status offset; forty `FileNotFoundError`s then exit 0. |
| **C-4** | **A mutation proof, run BEFORE the rail is called done**, by byte snapshot → mutate → require the **named** test red → restore in a `finally` → re-run green → **hash-verify the restore**. ⛔ Never `git checkout`. | `tools/mutation_check.py:1-33`, and the restore that discarded twenty minutes of work. |
| **C-5** | **A distinguishing fixture: the rail fires on the case it exists for AND stays quiet on that case's exact opposite, and both arms are asserted.** | A CRLF ban that fires on the correct edit is muted within a week; a checker that answers "no" to everything passes. |
| **C-6** | **Every roster, count or list the rail compares against is DERIVED from the artifact that owns it.** A declared minimum is **labelled** as one. | Nine instances of a typed count beside its source; `PY_RAIL_FLOOR` is the honest exception. |
| **C-7** | **Any literal-hunting check strips comments, builds its needle by concatenation, and carries stripper controls both ways.** | Seven instances of a check matching its own prose. |
| **C-8** | **Three outcomes, never two: PASS / measured FAIL / INCONCLUSIVE** — and the raw artifact is on disk **before** any summary is computed (R-RAW); a run with no raw artifact is INCONCLUSIVE whatever the console showed. | The timeout handler that wrote two words; the sub-300 ms mirror; `sentence_lost_writes` has still never been read from a real run. |
| **C-9** | **Late-bound seams** (`fn=None`, resolved in the body) **and a rail proving the patch is CALLED**, not merely that the default is `None`. | A unit test that ran a real six-shard gate for a day and looked like flakiness. |
| **C-10** | **Member-facing behaviour is asserted by rendered DOM text after the action settles**, with a fixture that must read SHOWING and a host that outlives its trigger. | Two toast defects with every structural assertion green; a reported product defect that did not exist. |
| **C-11** | **Provenance on the number: the SHA it was measured at, the date, and for a percentile its N.** A gate expressed as a percentile that does not declare N is not comparable to its own previous reading. | Observability G-2: the p95 index on n=40 is *the second largest of forty*, 2.5 pp resolution. |
| **C-12** | **A timeout is never banked**; a load-sensitive name is recorded with its alone-measurement in ms. An `expected_red` entry without a reason string **fails the gate** (`gate_shards.unexplained`, `:212-235`). | A banked slot is one a real failure can occupy unnoticed. |

⭐ **Four proof methods for C-4/C-5, each with a precedent** — deliberately the same four as
`10-roadmap/observability-plan.md` §4.6, because a rail and an alert prove the same thing:
**(1)** a pure decision function unit-tested with a control; **(2)** a pure clamp or classifier
proved at its boundaries; **(3)** **mutation-checking the wire, not just the logic** — an AST over
the registration site plus a route-presence check, each with a control asserting the probe can see
a sibling it is not looking for (`tests/test_desk_session_audit.py`, mutation-checked four ways:
cut the scheduler wire, cut the route, delete the grace window, swap names for a count);
**(4)** a live trigger with an **injected verdict** through a late-bound seam. ⛔ **Method 3 is the
one this repo has actually needed**, because the wire is the part that has actually been cut.

---

## 4. The gate

### 4.1 What blocks a MERGE

**RULING.** The merge gate is the **derived scoped set on the LANDING tree**, plus the full
six-shard gate **only when the branch can interact with it**. This is `tools/gate_carry_over.py`'s
computation used as the gate rather than as an excuse, and §4.4 is why.

1. **C4 by explicit node id, on the landing tree (the merge), never on the branch tip** — the
   branch's own test files, the door-guard rail, and the incoming files' own test files. ⚰️ `git diff G M`
   against *master's tip* is a **symmetric** difference and reported an overlap of 35 against a
   branch of exactly 35 files: *"'C1 fails' for a provably disjoint branch."* **L is the landing
   tree.**
2. **The interaction checks C1–C3**, derived: no path overlap between `G..L` and the branch's
   three-dot diff; **no import edge either direction, transitively to depth 2, resolved by AST**;
   and nothing incoming touching vite/vitest config, global test setup, `package*.json`, the
   router, `App.jsx`, the surfaces manifest, or any `api/` the branch itself touches. ⛔ **UNKNOWN
   IS NEVER A PASS** — no import graph, or an empty one, ⇒ re-gate, and a failed git call
   **raises** rather than returning `[]`, because every check passes trivially over an empty set.
   ⚠️ C2 is today **structurally unevaluable** (§1.6): nothing emits the graph. **Until something
   does, C2 counts as UNKNOWN, which means RE-GATE** — that is the rule as written, and it is the
   honest reading.
3. **The full six-shard vitest gate against the named baseline, 0 NEW** — required whenever (2)
   fails or whenever the diff intersects the vitest read set; **not required** on a clean C0/C1–C3
   carry. ⛔ **C0's short-circuit covers the VITEST half only.** ⚰️ A landing carrying **only
   Python** answered *"C0 IDENTICAL — short-circuit"* while master's merge had brought 32 files
   into `tests/`, **including `tests/conftest.py`**: *"A check that is silent where it looks
   authoritative is the PROXY failure, in the tool built to prevent it."*
4. **Scoped Python rails by NAMED FILES** whenever the diff touches `scripts/`, `tools/`,
   `tests/` or `api/` — never `-k`, never a bare `pytest tests/`. `PY_READ_PATHS` is the read set;
   `PY_RAIL_FLOOR` is a declared minimum and a landing touching Python elsewhere **adds that
   code's own rails**.
5. **The deploy-correctness fast checks**, run locally so the CI gate is a confirmation rather
   than a discovery: `tests/test_no_shadowed_definitions.py` (440 lines) and
   `python tools/check_repo_hygiene.py`.
6. **A recorded mutation proof for every new or changed rail** (C-4), and **no banked timeout**
   (C-12).
7. ⛔ **Three C1–C3 failures in a row = STOP.** Disjoint commits that carry are not supersessions.

⛔ **Where the repo contradicts itself, and what I pick.** `CLAUDE.md` says *"The local
six-shard gate is therefore the ONLY full-suite verification a landing gets… When in doubt,
re-gate"*, and it also records that the gate's runtime exceeds the interval between landings, so
carry-over *"could never hold while [the frontend workstreams] were active — arithmetic, not
luck."* **Both cannot be operative.** I pick the derived scoped gate as the blocker and the full
gate as a scheduled instrument (§7 TEST-1), for one reason: *a gate that makes the queue slow gets
bypassed, and a bypassed gate is worse than none because it reads as coverage*
(`master-deploy-gate.yml:105-110`, about itself). The correct fix is not to relax the gate but to
move it off this box (§6.1), and the ruling reverses the day that lands.

### 4.2 What blocks a DEPLOY

1. **The `master deploy gate` workflow.** Measured from
   `.github/workflows/master-deploy-gate.yml`: a changed-files secret scan (`:183`),
   `tests/test_no_shadowed_definitions.py` (`:270`),
   `tests/test_dockerfile_vite_build_args.py` + `tests/test_vite_flag_ledger.py` (`:276`),
   `tests/test_visibility_flag_ledger.py` (`:283`), `tools/check_repo_hygiene.py` (`:286`).
   ⛔ **No vitest. No frontend build.** Its verdict decides whether `production` is promoted, and
   **`web` deploys from `production`** — so a red gate stops the member-facing deploy. ⚠️ The other
   five services (`worker`, `bars-api`, `chart-renderer`, `flow-worker`, `terminal-next-monitor`)
   deploy from **`master`** and are **not** gated by it: *"A red gate protects members; it does not
   protect the back end."*
   ⛔ `concurrency: master-deploy` with **`cancel-in-progress: false`** is the whole
   serialisation mechanism; the default would let the second push through first.
   ⚰️ And *"Railway's Wait for CI holds the build"* **is false and was false when written** —
   `checkSuites` is False on all six services, measured 2026-09-15; Railway starts building on the
   push, concurrently.
2. **The post-deploy client smoke against the live artifact**, as the smoke account. ⛔ **H15: a
   measured failure is ROLLED BACK FIRST and diagnosed second** — the 2026-09-10 freeze was live
   4.5 hours and *"essentially none of that was spent fixing it — it was spent not knowing."*
   ⚠️ **INCONCLUSIVE (exit 2) is not FAILED and must not trigger a rollback.**
3. **H14: a hazard CLASS named while the code is live is a hard stop on the next deploy.** Name the
   class not the instance, enumerate what exhibits it **from source**, check the **live build** at
   the layer the hazard would show in, and block the next deploy until those are done. ⛔ *"The tell
   to watch for in your own writing is the word 'interesting'."*
4. **Confirm a rollback at the layer the failure appeared in, never by reading the variable back.**
   `--kv` shows what the service is **configured** with. ⛔⛔ Measured: `--set` redeploys, **`delete`
   does not** — nine minutes after a delete, no new deployment and `uptime_seconds` climbing 1508 →
   2019 unbroken, *"so the variable was gone from the SERVICE and still live in the PROCESS."*
   Follow a delete with `railway redeploy --service web --yes`.
5. **Prove your code is live by ANCESTRY against `origin/production`, and your deploy by its own
   record's STATUS** (`SUCCESS` vs `REMOVED`) — never by an uptime you did not tie to a named
   deploy. A published verification once measured a *superseding* session's pod.

### 4.3 Advisory — informative, never blocking

- The **whole-range secret scan**, already labelled `ADVISORY — never gates` (`:213`).
- Any **count** from `tools/mobile_audit.py`: a pointer to elements, not a verdict.
- Any **sub-300 ms verdict from a screen mirror** — INCONCLUSIVE-TRANSPORT (§2 T5).
- **Tier-share performance readings**, reported beside the latency number and *never* as
  pass/fail, per CARD 16 — with the one named exception it keeps: a `fetch`/`miss` share above
  ~10% on intraday **during RTH**.
- **Detector verdicts in the anti-pattern library.** ⚠️ *"A 'YES' is a claim that a named rail
  exists in a cited artifact, never that it currently passes."*
- **A local shake-out**, which *"is NOT certification evidence and must not be able to overwrite
  any"* — local runs write separately and carry `"certifying": false`.

### 4.4 ⛔⛔ The arithmetic constraint

> **Before starting a long verification, measure the DISTURBANCE INTERVAL. If the run is longer
> than the gap, it will never finish, and no amount of retrying changes that.**

| measurement | takes | disturbed every | outcome |
|---|---|---|---|
| six-shard vitest gate | **46–92 min** | master moved **56 commits in 92 min** | carry-over failed; re-gate; superseded again |
| a 2.8b rig cell | 12–22 min | production deployed every **~13 min** | **22 of 23 cells INCONCLUSIVE** on `/api/auth/me` 502 |
| a memory-leak slope | needs **104 min** to see | median pod life **26 min** | a 5-sample read on a 5-minute pod read flat-to-declining on a pod leaking 7.9 MB/min |

⭐ **THE INSTRUMENT WAS RIGHT EVERY TIME.** The rig refused to measure through a swap; the
carry-over tool refused to carry a gate it could not justify. **Neither failure was a product
fact, and reading either as one would have been the error.** ⛔ **The tell is a retry that looks
reasonable** — *"the third one is where you should notice you are in a loop whose exit condition
is outside your control."*

Four consequences, stated as rules:

1. **A per-merge gate must be shorter than the interval, or run somewhere that does not share the
   box.** Narrowing the path list is **not** the fix — *"a shorter path list is a guess about what
   matters, re-made by hand every time the tree moves."* Interaction is derivable, so derive it.
2. **The full gate needs a window somebody schedules**, and ⛔ *"'the queue was clear when I
   started my gate' is true and useless"*: the guard reads the queue at the moment of the push and
   a build takes 3–5 minutes while a gate takes longer. The wait is on the **deploy**, not on the
   check.
3. ⛔ **The guard has a ~3.5-minute blind window by construction** — Railway creates the deploy
   record **minutes** after the push, measured at **3m25s** and **2m38s** by two sessions 47 s
   apart. ⛔ **Waiting longer does not close it**; two samples establish that it varies and do not
   establish a bound. Push-level serialisation comes from the GitHub concurrency group, which sees
   the push itself.
4. ⛔ **Watch for a NEW SHA, not for the timer moving.** One landing produced **five deploy
   records**, three inside 16 seconds; a waiting session saw a countdown reset `541 → 431 → 320 →
   516 → 398` while `origin/master` never moved. *"A resetting countdown with a static
   `origin/master` is a redeploy storm, not a third pusher."*

---

## 5. What Terminal-Next specifically needs that does not exist yet

Each item names the **defect class** it would catch. ⛔ Nothing here is "more coverage"; each one
closes a named blind spot from §2 or a ⛔ NO-detector row from the anti-pattern library, whose own
tally is **31 YES / 14 PARTIAL / 20 NO — and "these twenty are the work items."**

1. ⭐⭐ **vitest in CI, on a host that is not this box.** *Catches:* everything the deploy gate
   cannot see today, which is the entire frontend. *And it dissolves §4.4* — the arithmetic is a
   property of a **shared** box, not of the suite. The workflow's *"FAST ONLY, ON PURPOSE"* rule
   stays intact if the suite runs as a **separate, non-blocking-for-the-queue** job whose verdict
   gates promotion. **This is the highest-leverage item in this document and it is one workflow
   file.**
2. **A route-walking authentication audit: `import api.main:app`, walk `app.routes`.** *Catches:*
   GATE-7's class — an unauthenticated **GET** of vendor market data. The one instrument that
   looks is blind to the class by construction (`MUTATING` excludes GET), **six route families
   still declare no dependency** (`/api/stream/prices`, `/api/gex/compare` *four lines below the
   gex route that was fixed*, three `/api/dealer-positioning/*`, `/api/flow-scoreboard`, `/r/*`),
   and the sweep that found them *"was done by reading named files, not by importing
   `api.main:app`"*. ⛔ **Highest severity of any missing test in this document.**
3. **A backend reachability rail.** *Catches:* REACH-3 — a module or router built and wired to
   nothing. `reachable.test.js` sweeps `app/src`, **not `api/**`**, and the live instance is
   `api/earnings_router.py`: present, unmounted, and instructing its reader to mount a **second
   authority on earnings dates** at the exact prefix a live route already serves.
4. **A generated engine-floor rail, one arm per declared floor feature.** *Catches:* an
   engine-global absence a bundle scan cannot see. It exists for `Iterator` and
   `Promise.withResolvers` (`iteratorGlobalFloor.test.js`) and the floor is now declared
   `iOS >= 16` in both places — but **the list is hand-written**, and the second global was found
   *by the rail*, not by the device (the debugging phone was on 17.5; `Promise.withResolvers`
   landed in 17.4). ⛔ `build.target` would not have caught either: it downlevels **syntax** and
   adds no polyfills.
5. **A real-old-Safari pass in the release checklist, with a named minimum device.** *Catches:*
   the class no amount of emulation finds. ⛔ **Say plainly that this is a human or agent driving a
   mirror, not a script** — Automate is not on the account, so the CI device job
   (`.github/workflows/joystick-device.yml`) correctly takes its unfunded-skip branch on positive
   proof from `plan.json`. Priced once and **not proposed**: Desktop & Mobile at **$225/month** is
   the cheapest tier that includes real mobile devices.
6. **A p95 instrument for whatever Terminal-Next gates on.** *Catches:* **a definition of done
   nothing can evaluate** (INST-4) — the programme's own gate. Measured in observability G-2, three
   ways at once: `bars_warmth_audit.py` buckets `stale-swr` as COLD (`:27-28`) against CARD 16's
   ruling that it counts as SERVED, so daily is 100% cold, `warm_ms` is empty and **no p95 line
   prints for daily at all**; the cold branch prints **p50 and max** (`:113-116`), not p95; and
   `wall` is client wall-clock while the `dur` in `Server-Timing` is parsed away (`:62-64`). ⚠️
   Neither quantity is wrong — **what is wrong is that the gate does not name one.** §6 TEST-10
   defers to OBS-1 rather than creating a second authority.
7. **A payload-size budget in CI.** *Catches:* a response that is correct and unusable —
   `/api/flow/aggregate` serialising **23.83 MB**, `/api/watchlists` shipping **4,725
   constituents per page**, and the authenticated flow read measured at **5,289,793 bytes** in item
   24 §1.3. ⚠️ Related, with no detector either: `serve_csv()` at `api/main.py:9200` **carries no
   route decorator.**
8. **A scheduled full-suite run against master that re-measures and re-publishes the baseline,
   with a named owner.** *Catches:* kind 3b, baseline drift. The current baseline is dated
   **2026-09-24** at `73a4286d0` against **43** failing files, while the tree today holds **1,845**
   frontend test files — a baseline measured against a smaller tree understates in the flattering
   direction. ⛔ It must also publish **what it did NOT run**, because a carry that nobody re-gates
   is `documented ≠ bounded`.
9. **A cadence proof for the gate itself** — the testing plane's version of observability §4.8's
   dead-man **S6**: *when did the full gate last run, against which SHA, and which paths did it
   waive?* ⛔ It posts **even when everything is fine**, because *"silence should never need
   interpreting"*, and exactly once per day. *Catches:* the cleanest 3b instance in the record —
   two days of *"no rig window has been taken"* which was **true the whole time** and meant
   *nothing was staged*. **A runner with nothing to do looks exactly like a rig that was never
   free**, and nothing was ever red.
10. **A meta-rail that fails a NEW rail carrying no negative case.** *Catches:* the
    fixture-that-cannot-distinguish class at the point of introduction rather than a week later.
    `tests/test_mutation_harness_anchors.py` and `test_mutation_harness_hygiene.py` police the
    harness; nothing requires a rail to have a quiet arm. ⚠️ Scope it to new files only, or it
    fires on 1,845 existing ones on day one and gets muted — which would be this item committing
    the pattern it exists to catch.
11. **A `seen-to-fire` field in the rail's own docstring, and a check that it is filled.**
    *Catches:* an unproved guard reaching master. Cheap version of C-4 that survives review: the
    rail names the mutation that reds it, so the next reader can re-run it in one command instead
    of re-deriving it.

---

## 6. Defaultable rulings

⛔ Each is a **ruling, vetoable in one word**, not a question handed back. Each states what would
overturn it. ⛔ **No row carries a per-tier dimension: the entitlement axis is binary, paid or not
(CARD 17).**

| id | decision | ruling | why this default | overturned by |
|---|---|---|---|---|
| **TEST-1** | What blocks a merge | **The derived scoped set on the landing tree** (§4.1 items 1–2, 4–7). The full six-shard gate blocks only when C1–C3 fail or the diff intersects the vitest read set; otherwise it runs on a schedule against master | 46–92 min against a 10-minute landing cadence is unsatisfiable, and a gate that makes the queue slow gets bypassed — which is worse than none because it reads as coverage | **vitest landing in CI** (§5.1). Then the full gate blocks every merge, because it stops competing for this box |
| **TEST-2** | Baseline re-measurement cadence | **Weekly against master, and on any landing that changes more than 25 test files.** The artifact names its SHA and date; a baseline older than 14 days is quoted as STALE, never as the gate | The current one is 2026-09-24 against 43 files while the tree holds 1,845; understating is the flattering direction | A green suite — then the baseline is **deleted**, not maintained |
| **TEST-3** | Banking policy | **A timeout is NEVER banked.** A load-sensitive name is recorded with its alone-measurement in ms. An `expected_red` without a reason string fails the gate (already enforced, `gate_shards.unexplained`) | 15,000 ms vs 1,461 ms alone on the same SHA; three timeouts in one run all passing alone. A banked slot is one a real failure can occupy unnoticed | ⛔ Nothing cheap. I would take a veto on this one only with a named alternative for detecting occupation of a banked slot |
| **TEST-4** | Frontend shard count | **6** (shipped), and the ceiling is the **box**, not the suite | Two `INVALID` manifests came from memory pressure, not from shard arithmetic | A CI host — then shard to the runner's core count |
| **TEST-5** | Backend chunk count | **12**, sequential, file lists walked from `pytest.ini::testpaths` | Collection is the cost; parallel chunks multiply the peak rather than divide it | A measured peak RSS under 4 GB at a lower chunk count |
| **TEST-6** | Real-device cadence | **One old-Safari pass per release that touches a lazy-loaded chunk, a new dependency, or a declared-floor feature** — at `iOS >= 16`. Not per merge | The `Iterator` crash arrived through a dependency's own compatibility shim, in a lazily-loaded chunk. Per-merge is unaffordable on a mirror that dies on inactivity | Buying Automate Desktop & Mobile ($225/mo) — which converts this from a checklist step to a script |
| **TEST-7** | Mirror verdicts below its floor | **Always INCONCLUSIVE-TRANSPORT, never FAIL** | Floor 260–427 ms/gesture; the cost is per pointer-event round trip, so no drag is short enough; synthetic events are silently discarded | A transport that owns the clock |
| **TEST-8** | Test-matrix dimensions | **Entitlement is binary: paid / not-paid.** No tier axis anywhere, and `tier` stays rejected outright where it already is (`registry.js:994`) | Owner ruling, CARD 17, verbatim: *"there is one paid tier only that is it"* | ⛔ A new owner instruction **only** — this carries no reversal condition |
| **TEST-9** | Non-vacuity control form | **Name an expected member**, not a count | `toBeGreaterThan(0)` is only a control if a broken invocation makes it zero | A case where no legitimate member can be named — then assert a count **and** a named absence, both arms |
| **TEST-10** | Percentile N and quantity | **Defer to OBS-1** (client wall-clock, n ≥ 60 per timeframe, N printed beside the number) | A second authority over one value is the defect this repo keeps paying for; item 25 owns the latency question | OBS-1 being ruled differently — then follow OBS-1, which still owns it |
| **TEST-11** | Who runs the gate | **The integrator, in its own session, reading the manifest.** An agent's "done" is evidence, never a verdict | *"A gate run in a session you cannot see is a gate you did not run"* — one lane arrived with 5 reds it never saw | CI (§5.1) — then the integrator reads CI's manifest instead of producing one |
| **TEST-12** | How coverage is reported | **Three states per class — YES / PARTIAL / NO — and never a percentage** | A percentage over a population nobody enumerated is DOC-1 with a decimal point. 20 ⛔ NO rows are a work list; "68% covered" is not | An enumerated population with a derived denominator — i.e. C-2 applied to coverage itself |
| **TEST-13** | Concurrency while a gate runs | **One gate at a time on this box, via the advisory queue; at most 3 agents plus the integrator; the whisper job runs alone** | 4.8 GB free, `node_modules` swept to zero, a worktree's `.git` destroyed; five concurrent agents hit the session rate limit and killed two lanes | A second machine, or CI |

---

## GAPS — what this document could not reach

1. ⛔ **No test was run, so I do not know what is red today.** Every count here is a file count.
   The baseline I cite is an artifact with a date; whether it still describes the tree is exactly
   the question TEST-2 exists to answer, and it is unanswered here.
2. ⛔ **No git, so SHA not pinned (no git by instruction)** anywhere in this document. In
   particular I could not check whether `73a4286d0` is still an ancestor of master, nor run the
   two-line "did it SHIP / what does master SAY today" check the repo prescribes.
3. ⚠️ **I could not reconcile 1,845 against the gate's recorded 1,178/1,283.** My walk uses the
   same predicate as `count_test_files` (`gate_shards.py:455-458`), so the most likely reading is
   simple growth — but *"most likely reading"* is not a measurement, and the reconciliation is
   precisely the check C-2 mandates. **It is unperformed here and is a work item, not a
   conclusion.**
4. ⚠️ **Every wall-clock figure is carried, not re-taken**: 46–92 min, 260–427 ms, 15,000 ms,
   3m25s/2m38s, 11,854 MB, 6.6 GB. Each is cited to where it was measured; none was reproduced.
5. ⛔ **I could not tell whether the CI device job or any scheduled job is enabled today** — no
   Railway read, no Task Scheduler read. Where a schedule matters I state that a file is wired,
   never that it is running.
6. ⚠️ **The Python baseline records one group of 10 files as UNRUNNABLE**
   (`docs/test-baseline/python-failures.md:4-7`) and I did not reach what makes them so. A tier
   with 10 files nobody can run is a hole in the denominator of every Python claim above.
7. ⚠️ **`tools/window_check.py` is 3,310 lines and I read only its role**, from `CLAUDE.md` and
   from the memory index. Anything in §2 T4 about it is a statement about its documented purpose,
   not about its code.
8. ⛔ **I did not enumerate the 20 ⛔ NO-detector rows individually.** §5 picks the five that bear
   on Terminal-Next; the remaining fifteen are in gate item 11 and are that document's to own.

## SOURCES

**Measured here, with the exact command** (all read-only; run from
`C:\Users\Patrick\uct-worktrees\_merge-master`):

- `find app/src -type f \( -name "*.test.js" -o -name "*.test.jsx" -o -name "*.spec.js" -o -name "*.spec.jsx" \) | wc -l` → **1,845**
- `find app/src -type f \( -name "*.js" -o -name "*.jsx" \) | wc -l` → **3,419**
- `find tests -type f \( -name "test_*.py" -o -name "*_test.py" \) -not -path "*__pycache__*" | wc -l` → **1,651**
- `find api -type f \( -name "test_*.py" -o -name "*_test.py" \) | wc -l` → **159**
- `grep -rl -- "--self-check" tools/ scripts/ --include=*.py --include=*.mjs | grep -v __pycache__ | wc -l` → **89**
- `ls -1 tools/*mutat* tools/*gauntlet* | grep -v __pycache__ | wc -l` → **25**
- `wc -l api/main.py` → **11,066**
- `python -c "import json; d=json.load(open('docs/plans/joystick/gate-baseline.json',encoding='utf-8')); …"` →
  `failures` **126**, `files` **43**, `sha` `73a4286d0dc4b3adcaea9f6f8ec9b80a1bff8735`,
  `measured_at` 2026-09-24, `expected_red` **0**, `expected_red_reasons` **0**
- Existence + length verified by `wc -l` for every rail and tool named in §1 and §2.

**Repo source read (`_merge-master`).** `CLAUDE.md` — cited **by section heading, never by line**,
deliberately, for the reason gate item 11 gives: it is a 5,823-line living document whose own
thesis is that a positional reference beside a moving artifact is the first defect in the library.
Sections used: *A test run without a totals line is not a run* · *NEVER VERIFY A RUNNER THROUGH A
PIPE* · *Run the suite in its OWN tool call* · *An empty result is a failed invocation* ·
*Gate carry-over is judged on INTERACTION* · *A measured fact cites its artifact (R-CITE/R-RAW/
R-HON)* · *H14* · *H15* · *Contracts — verify against the RUNTIME CALL SITE* · *A citation you
cannot quote is struck* · *Provenance: `git show <sha>:<file>`* · *A themed token must be pinned in
every theme island* · *A DEFAULT ARGUMENT IS BOUND AT IMPORT* · *TWO INSTRUMENTS AGREEING* ·
*A GUARD ON THE INCOMING RECORD* · *KIND 3* · *`C:\data` IS REAL ON THIS BOX* · *Sandbox boots* ·
*SAMPLING WHERE A WAITER WAS AVAILABLE* · *A TIMEOUT HANDLER THAT DISCARDS ITS OUTPUT* ·
*A GLOBAL PROCESS COUNT* · *A MEASUREMENT THAT TAKES LONGER THAN THE GAP BETWEEN DISTURBANCES* ·
*"DOCUMENTED" IS NOT "BOUNDED"* · *AGENT CONCURRENCY* · *2026-09-12 — THREE CONCURRENT SESSIONS
OOM-SWEPT THIS BOX* · *Testing → Smoke* · *Testing → BrowserStack* · *A LIVE SCREEN MIRROR CANNOT
MEASURE A SUB-300 ms GESTURE* · *REAL-DEVICE iOS FOUND A PRODUCTION CRASH* · *Real-device testing* ·
*Mobile audit harness* · *Assert user-facing feedback by RENDERED TEXT* · *Registering a hub mode
must never re-render the registrant* · *A dismissable control needs a recovery path* ·
*The rails, and what each is for* · *Deploy windows* · *Write a file with the line endings GIT
ALREADY STORES*.

**Executable artifacts read.** `scripts/gate_shards.py:1-28, 70-72, 155-235, 455-479, 973, 1187` ·
`tools/pytest_chunks.py:1-47, 246` · `tools/gate_carry_over.py` · `tools/gate_box_lock.py:1-30` ·
`tools/mutation_check.py:1-40` · `tools/check_repo_hygiene.py` · `tools/ci_extract.py:11-23` ·
`tools/pine_text_helper_census.py:546-552, 1125-1128` · `conftest.py` · `pytest.ini:1-63` ·
`app/vite.config.js:224-242` · `.github/workflows/master-deploy-gate.yml:1-58, 102-125, 183-289` ·
`docs/plans/joystick/gate-baseline.json` (`files_note`, `provenance_caveat`,
`load_sensitive_note`, `order_sensitive_on_master`) · `docs/test-baseline/python-failures.md:1-45` ·
`docs/pine/PARITY-ROOT-CAUSE.md:160-189` · `docs/pine/WAVE2-A-PLAN.md:1830-1871`.

**Programme documents.** `10-roadmap/observability-plan.md` §0, G-2 (`:351-394`), §4.6
(`:685-721`), §4.7–4.9 (`:722-774`) · `05-product-strategy/anti-patterns.md` `:110-155` (the field
definitions, the detector tally and the family index), GATE-7 (`:889-926`), and the detector
verdicts for INST-1…9, GATE-1…8, REACH-1…5, PERF-4…6 ·
`07-technical-architecture/realtime-performance-architecture.md` §1 (`:77-196`) ·
`12-decisions/DECISION_CARDS_2026-09-26.md` CARD 16 (`:213-223`), CARD 17 (`:227-241`), and the
owner-only table (`:436-449`).

⚠️ **On reading `CLAUDE.md` as evidence, both traps navigated here.** It marks corrected claims
with ⚰️ — **a corrected claim is never cited as live**, and where the correction is the interesting
thing (the withdrawn *"Wait for CI holds the build"*, the struck directory-only carry-over rule,
the retired market-hours window) the **correction** is what is cited. And the copy of `CLAUDE.md`
inside this worktree is a **docs branch, eight recorded facts behind**, and carries its own banner
saying so; everything above is from `_merge-master`.

## ⛔ What this document does NOT decide

1. **It does not choose a CI provider, a runner size, or spend a dollar.** §5.1 and §5.5 name what
   is missing and why; procuring it is the owner's.
2. **It does not re-open CARD 17.** One paid tier. No test matrix here has a tier dimension and
   none may acquire one without a new owner instruction.
3. **It does not set the latency threshold or name the quantity.** CARD 16 owns the number and
   OBS-1 owns the quantity; TEST-10 defers to both rather than becoming a second authority.
4. **It does not rule on the four-hour browser TTL** a Cloudflare rule is putting on a live tape
   (item 24 §1.3). That is a dashboard edit and a freshness decision, explicitly the owner's.
5. **It does not close R-17.** A finding established by probe can only be retired by probe, and
   §5.2 asks for the *test*, not the closure.
6. **It does not run, fix, re-measure or adopt any baseline**, and it changes no file but itself.
7. **It does not own rollout, rollback order, or the flag ledger** — `10-roadmap/rollout-rollback.md`
   does. Where they touch (H15's roll-back-first, the post-deploy smoke's three exit codes),
   this document states the **testing** obligation only.
8. **It does not choose the observability signals.** Gate item 25 owns S1–S10; §3 borrows its four
   proof methods on purpose, so the two documents cannot drift into two answers.
9. **It does not name owners, dates or sequence.** Every item in §5 is scoped and argued; none is
   scheduled.
10. **It does not claim any rail currently passes.** Every "exists" above is a file at a cited
    path, verified by `wc -l`, and nothing more.
