# The inherited-red ledger — the full frontend suite on `master`

**Measured 2026-09-09** on `notebook-primary-platform`, whose only difference
from `origin/master` is Wave Q1 work. **Re-verified against `184a7e77b`** after
master moved mid-session — see "Re-verification" below.

⭐ **NEWEST MEASUREMENT: deploy #4's pre-flight, at `aee7922b5`** — see
**"Re-measured for deploy #4"** at the end of this file. The numbers below are
the 2026-09-09 reading and are kept because the row-by-row blame was done against
them; ⛔ do not quote them as current.

```
Test Files   8 failed | 1164 passed | 1 skipped  (1173)
     Tests   9 failed | 16899 passed | 9 skipped (16917)
journal-2-0 alone: 231 files / 2391 tests — GREEN AT REST (see row 9: one
                   load-sensitive timeout appears under sustained load)
```

## Why this file exists

The last two Wave Q sessions each spent real time proving their own work was not
the cause of a red they inherited — and the `NoteEditorPage.durable.test.jsx`
red had been sitting on `master` since the activation rollback with **nobody
owning it**, because there was nowhere to write it down. A list is cheap. A
mystery is not.

⛔ **"Did my change cause this?" is answered with `git show <sha>:<file>` and
`git log -1 -- <file>`, never with `git status`.** Every row below was blamed
that way. Note that one offender (`CaptureDialog.module.css`) sits *inside*
`journal-2-0` and is still not Wave Q's — a working-set argument would have
mis-assigned it.

⛔ **Repo-green must never be claimed.** Report `journal-2-0` and the full suite
as two separate numbers, always.

## The ledger


### ⚰️ 2026-09-11 — ROW 2 NO LONGER FAILS, AND I MIS-ATTRIBUTED IT

`src/components/screener/reachable.test.js` passed on the full sharded gate of
`53c28d52b` (7 failing / 18,807 vs a baseline of 8). **Baseline 8 → 7.**

⛔ **I first recorded the cause as "the abandoned `ScannerResultsBase` orphan was
deleted". That is FALSE** and is corrected here rather than left in the history:

* `git log --all -- '*ScannerResultsBase*'` is **empty** — the file was never
  committed anywhere. It existed only in a working tree and was removed before
  any commit, so it was never in any failing set and its deletion cannot have
  healed anything.
* every module row 2 names is **still present on `origin/master`**.
* and neither master's merged range nor this branch's range contains a single
  commit touching those modules.

⭐ **So the cause is NOT ESTABLISHED, and that is the honest entry.** What is
measured: it failed when the baseline was re-measured on `origin/master`
`62a228e5d`, and passes on this branch. Row 9 records that this repo already has
a *population* of load-sensitive reds; this may belong to it. It is not being
claimed as fixed by anyone's change until someone runs it at both hashes and
says which.

⛔ The lesson is the one this file exists for: **provenance is `git show
<sha>:<file>`, never a guess that fits.** I had a plausible story and shipped it
in a commit message before checking whether the file had ever existed.

| # | Failing test | Offending file | Blamed to | Wave Q? |
|---|---|---|---|---|
| 1 | `src/__tests__/sourcesAreText.test.js` — "contains no NUL or other C0 control byte" | `pages/optionsFlow/wiring.guard.test.js` — two `0x08` bytes at 18747 / 18773 | `9dff9dae0` (2026-09-08) *"fix: the post-paint fetch was disabled by its own guard"* | **No** — OptionsFlow, partner-owned area |
| 2 | `src/components/screener/reachable.test.js` — "every module under app/src is REACHABLE" | 19 modules: `floor2/main.jsx`, `hub/contracts.js`, `lib/chatStreamManager.js`, `charts/widgets/DockFundamentals.jsx`, `pages/community/AckGate.jsx`, … | `cc195e888` (The Floor, 2026-09-03) · `2d8373449` (joystick hub PR #100, 2026-09-09) · `1a1066a23` (2026-07-11) | **No** — community redesign + joystick hub |
| 3 | `src/styles/tapFloor.test.js` — "no stylesheet declares a finger target on the PHONE only" | `journal-2-0/components/notebook/CaptureDialog.module.css: .actions` | `5d3f5f1be` (2026-09-08) *"Wave L Slice 2 CLOSED: phone-width certified"* | **No** — Wave L, and **byte-identical to `origin/master`** |
| 4 | `src/hooks/pollingSites.rail.test.js` — "no NEW bare polling site" | `chart/useBoundDrawingAlerts.js` (1) · `floor2/hooks/useFloor.js` (5) · `hooks/useWatchlistIntelligence.js` (1) | `2d3b2d555` (MOB-05, 2026-09-08) · `cc195e888` (The Floor) · `22452cff7` (Seam 8, 2026-09-07) | **No** — charts / community / evidence seams |
| 5 | `src/components/chart/engine/ast/manifestProse.test.js` — "every key the product READS survives the strip" | manifest key `_session` | `b280131b8` (2026-08-29) | **No** — Pine manifest |
| 6 | `src/components/chart/engine/ast/pine.blindCorpus.test.js` — "the accepted floor moves one way too" | 21 accepted vs `ACCEPT_FLOOR` 28 — a **ratchet threshold**, not a broken file | `b1a901970` (2026-09-04) | **No** — Pine corpus ratchet |
| 7 | `src/pages/ThemeTrackerPage.chartmount.test.jsx` — 2 tests, "Unable to find an element with the text: AAPL" | `pages/ThemeTrackerPage.jsx` render path | test last touched `7adfdda2b` (2026-08-05) | **No** — Theme Tracker |
| 9 | **A POPULATION of load-sensitive TIMEOUTS inside `journal-2-0`** — not one test. Observed so far: `ImportWizard.test.jsx` "audit B1" (4,179 ms) · `captureConvergence.test.js` "capture.js is the ONLY module that names the capture endpoint" (**28,705 ms**) · `CaptureHost.test.jsx` "closing returns the dialog to nothing" (4,055 ms — ⭐ **the file is NAMED as of 2026-09-10**, when it surfaced again on the deploy-#4b pre-flight and passed ALONE in 1.56 s; it was recorded as "`NoteEditorPage`-adjacent" before anyone had pinned which file it lives in) | ⚠️ **TIMEOUTS, not defects.** Each passes alone; each fails only when run immediately after the full 16,928-test suite | `521cd181a` (2026-09-05, import) · `977c59bc3` (2026-09-08, Wave L capture) — **all byte-identical to `origin/master`** | **No** — import wizard / Wave L capture |
| 8 | `src/components/chart/builder/ImportBox.thinkscript.test.jsx` — "it DECLINES while the box is one keystroke behind" | ⚠️ **line endings**: the committed test asserts `\r\n`, the code produces `\n` | `d4d5ec00f` (2026-09-01) | **No** — and likely **environment-specific**, see below |
| 10 | `src/components/chart/ChartDrawingOverlay.surfaces.test.jsx` — "the seven Model Book / surface override props still reach their decisions > ⛔ ENTERING EDIT MODE IS NOT A RESIZE" | `components/chart/ChartDrawingOverlay.jsx` — the edit-mode transition still reaches the resize path | `8de4da43b` (2026-09-09) *"feat(charts): Phase 9 — retire the Position DRAWING, keep the calculator"* | **No** — charts Phase 9 |

**Row 10 arrived with the 2026-09-10 master merge, and it is the row this ledger
was built to handle correctly.** Logged as ruling **R2** in
`docs/notebook/wave-q1-RESUME-HERE.md` → **🧾 RULINGS**; this is the evidence,
that is the decision. It appeared as the ONLY new failure in an
otherwise byte-for-byte baseline match, in `components/chart` — an area Wave Q1
does not touch. Three checks, in order, and the third is the one that settles it:

1. It fails **at rest, alone, in 1.4 s**. So it is not a member of row 9's
   load-sensitive population; that hypothesis had to die first, because a
   timeout and a defect get opposite treatment here.
2. The test, `ChartDrawingOverlay.jsx` and `drawingsStore.js` are all
   **byte-identical to `origin/master`**, and the branch changes no file under
   `app/src/components/chart/`.
3. ⭐ **The same test was RUN on a detached worktree at `origin/master`
   (`58dea4d88`) with no Wave Q1 code present, and failed identically.**

⛔ Step 3 is not redundant after step 2. "Byte-identical, therefore not mine"
is exactly the argument the deploy gate suspends when master moves under
`app/**`: files this branch never touched can still fail only in combination
with it. An argument from identity is not a measurement, and this ledger's whole
purpose is to keep those apart.

## Two notes worth carrying forward

**Row 8 is probably not a real defect.** The committed test source contains
literal CR bytes, so it asserts CRLF while the code under test emits LF. That is
a Windows-checkout artifact (`core.autocrlf`), and it may well be green in a
Linux CI. ⛔ Do not "fix" it by changing the code to emit CRLF — check the
checkout first.

**Row 9 is a POPULATION, not a test — and that distinction is the whole
finding.** The first sighting looked like one flaky file (`ImportWizard`).
Driving it again under the same load produced a DIFFERENT test
(`captureConvergence`, 28.7 s), and a third run produced a THIRD
("closing returns the dialog to nothing", 4.1 s). ⛔ Under sustained load,
whichever test happens to be slowest exceeds its budget — so naming any one of
them as "the flaky test" would be false, and "fixing" it would move the
failure rather than remove it (`lesson_an_intermittent_red_can_be_a_population_not_a_test`).

Every one of them passes alone, and journal-2-0 passed 2391/2391 in eleven
consecutive runs at rest.

⚠️ **REFINED 2026-09-10: the trigger is ambient machine load, not only a
preceding suite.** With a Chrome session running alongside, the same runs
flickered green / 1-failed / 1-failed / green, and the exposed member was
`captureConvergence` at **28.4 s** and **28.7 s** — a test that takes ~28 s
even when it passes. So "at rest" means *the machine is quiet*, not merely
*no suite ran first*. Judge a red here by re-running the file alone (21/21)
and by checking `git status` shows no changed source. Every file involved is byte-identical to
`origin/master`. ⛔ **CLAUDE.md's rule applies — a timeout is never banked as
permitted breakage** — and each was re-run alone before classification.

⚠️ **What this costs:** the wave's gate cannot be a full-suite-then-journal-2-0
run, because that ordering manufactures failures that say nothing about the
code. Run journal-2-0 AT REST for the gate, and read the full suite separately.

⛔ **Report the wave's gate as "journal-2-0 green at rest"**, not as an
unqualified green, until this is either given more time or made deterministic.
It is NOT Wave Q1's to fix, but it IS Wave Q1's to state honestly.

**Row 6 is a ratchet, not a breakage.** `ACCEPT_FLOOR` is a floor somebody
raised to 28 while the corpus currently accepts 21. It fails by design when the
number regresses; whether 21 is a regression or the floor was set optimistically
is the Pine wave's call, not this one's.

## Does any of these block the Wave Q1 canary?

**No.** The §15 canary exercises the Notebook's offline sync path in a
production browser. None of the eight touches that path — the closest,
row 3, is a touch-target rule on a different Notebook dialog. They are also
**already red on `master`**, so deploying Wave Q1 neither creates nor worsens
them.

⚠️ What that does mean: **a green full-suite run is not available as a deploy
gate on this branch.** The gate is `journal-2-0` green **at rest** (231 / 2391) plus this
ledger being unchanged — same eight, same offenders.

## Re-verification against the NEW master (`184a7e77b`), 2026-09-09

`origin/master` moved from `78ac8016b` to `184a7e77b` mid-session — three
OptionsFlow commits by Claude Fable 5. **Every row above still holds**, and the
proof is stronger than a re-blame:

```
git diff --name-only 78ac8016b..184a7e77b -- app/     →  0 files
```

⛔ **Master's new work touches nothing under `app/`** (only `api/flow_router.py`
and `tests/test_flow_prepare.py`), and the frontend suite reads only `app/`. So
the eight reds are identical at `184a7e77b` **by construction**, not by argument.

⭐ **And the converse was checked too**, because this branch ADDED a non-test
source (`lib/offline/baseline.js`) that the sweep-style rails
(`reachable`, `sourcesAreText`, `tapFloor`, `pollingSites`) do read. The full
offender lists from before and after the merge are **byte-for-byte identical**:
the new module is imported by five siblings (so reachable), is plain text, adds
no stylesheet and no polling site. Nothing this branch added appears in any red.

⚠️ A direct run of the eight files at `184a7e77b` in a scratch worktree was
attempted and **abandoned as invalid**: a fresh worktree has no `node_modules`,
and the junction recipe still left Vite resolving its temp config from the parent
repo — the result was `ERR_MODULE_NOT_FOUND`, **a startup error, not a test
result**, which CLAUDE.md warns about explicitly. It is recorded here rather than
quietly dropped, and the `app/`-diff proof above is what the claim rests on.

## Re-measured for deploy #4, at `aee7922b5` (2026-09-10)

The deploy-#4 pre-flight ran the full frontend suite as a sharded run. What it
read:

```
1207 files / 18020 tests
  10 failed   vs baseline 10
  NEW regressions: 0
```

⛔ **This is "no new failures against a measured baseline", and it is NOT a green
suite.** There is no repo-green to claim here and there never has been. Report
`journal-2-0` and the full suite as **two separate numbers**, always —
`journal-2-0` at rest on the reconciled tip read **234 files / 2448 tests green**,
which is a different measurement of a different scope.

**Two things made the run admissible, and both are worth copying:**

- ⭐ **The tree hash was identical start→end** (`aee7922b5…` → `aee7922b5…`). That
  is what says no file moved while the suite was running. The first sharded
  attempt of this wave **voided itself** for exactly that reason, and voiding it
  was correct — see **R5** in `docs/notebook/wave-q1-RESUME-HERE.md`.
- ⭐ **The file count reconciled**: files on disk (1207) against the summed shard
  totals. ⛔ A chunked run fails in the **flattering** direction — fewer files
  run, fewer failures found — so a shard total that nobody reconciled against the
  file list is not a suite result (CLAUDE.md: *"Count the files, not just the
  passes"*).

⚠️ **Stated plainly: the suite was measured at `aee7922b5` and the tip pushed was
`f093bf731`.** The whole delta is two Python files under `tools/` that no JS test
imports (`tools/engine_matrix.py`, `tools/window_check.py`), and `journal-2-0`
**was** re-run at rest on the reconciled tip. So this ledger's claim is about
`aee7922b5`, and the sentence *"the suite passed on what shipped"* is one nobody
should write.

⚠️ **`docs/plans/joystick/gate-baseline.json` moved in the same motion** (9 → 10,
sha to `58dea4d88`), because row 10 is a measurement of master and master moved.
That file belongs to a closed workstream; the reason for the edit rides in its
own `provenance_caveat` field, and the decision is logged as **R7**.

## Re-measured again for deploy #4b, at `fb5c74cf5` (2026-09-10)

```
1210 files / 18057 tests
  10 failed   vs baseline 10
  NEW regressions: 0
```

Same two admissibility properties as the #4 run: **tree hash identical
start→end** (`fb5c74cf5…` → `fb5c74cf5…`) and **files on disk reconciling with
the summed shard total**. ⛔ Same caveat too, and it is not boilerplate: the suite
was measured at `fb5c74cf5` while the tip pushed was `23f6ce271`, whose whole
delta is **one comment block in `inFlight.js`** (`git diff --stat` → 1 file,
7 insertions, 1 deletion, all comment lines). `journal-2-0` **was** re-run at rest
on the final tip: **237 files / 2483 tests green**. ⛔ Still two separate numbers,
still no repo-green.

⭐ **Row 9 earned its keep on this run.** The first at-rest `journal-2-0` pass
after the full suite failed `CaptureHost.test.jsx > "closing returns the dialog to
nothing"` — **a test row 9 already names**. Re-run **alone** it passed in
**1.56 s**; re-run as a suite at rest, green. ⛔ The ledger's own procedure settled
it in one re-run: **re-run it alone before classifying it.** Not banked as
breakage, not added as a new offender.

⚠️ **The file name in row 9 was sharpened at the same time** — it had been recorded
as "`NoteEditorPage`-adjacent" because nobody had pinned the file. It is
`CaptureHost.test.jsx`. ⛔ That is a correction to the ledger's description, **not**
a new row and **not** a change to the count of offenders.
